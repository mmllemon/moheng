/**
 * 目标成本清单与三算对比口径的路由级回归（真实 PostgreSQL）。
 *
 * 三算对比是全站唯一把「预算 / 实际 / 收入」放在同一张表上的接口，
 * 它的口径直接决定超支判断与利润率，而口径散在三处：
 *   1. 目标成本只累计叶子清单项，父项金额不参与（避免父子重复计算）；
 *   2. 每个清单项的实际成本只算直接挂在该项的成本，不向上汇总到父项；
 *   3. 项目实际成本是全部未归档成本，包含没挂清单项的那部分。
 * 这三条只要有一条被改错，超支清单就会失真，而且页面看起来完全正常。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   BUDGET_THREE_WAY_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:budget-three-way:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { budgetRoutes } from '../routes/budget.js';
import { costRoutes } from '../routes/costs.js';
import { analysisRoutes } from '../routes/analysis.js';

const enabled = process.env.BUDGET_THREE_WAY_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('目标成本清单：层级约束与自动重算；三算对比：叶子口径、直属实际成本、归档剔除', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(budgetRoutes, { prefix: '/api/projects' });
  await app.register(costRoutes, { prefix: '/api/projects' });
  await app.register(analysisRoutes, { prefix: '/api' });
  await app.ready();

  const userIds: string[] = [];
  const projectIds: string[] = [];

  async function makeActor(label: string, role: 'ADMIN' | 'USER' = 'ADMIN') {
    const user = await prisma.user.create({ data: {
      name: `Budget Fixture ${label} ${suffix}`,
      email: `budget-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role,
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    const text = response.body ?? '';
    let body: any = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } }
    return { status: response.statusCode, body };
  };

  async function makeProject(label: string, contractAmount: string) {
    const project = await prisma.project.create({ data: {
      name: `Budget ${label} ${suffix}`,
      code: `BG-${label}-${suffix}`.slice(0, 40),
      ownerName: `预算业主${label}${suffix}`.slice(0, 60),
      contractAmount,
      originalContractAmount: contractAmount,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectIds.push(project.id);
    return project;
  }

  const toCents = (value: unknown) => BigInt(Math.round(Number(value ?? 0) * 100));

  try {
    const admin = await makeActor('admin');
    const viewer = await makeActor('viewer', 'USER');

    const project = await makeProject('A', '1000000.00');
    const otherProject = await makeProject('B', '0.00');
    await prisma.projectMember.create({ data: { projectId: project.id, userId: viewer.userId, role: 'VIEWER' } });

    const items = `/api/projects/${project.id}/budget/items`;

    // —— 1. 三级结构：父项 + 两个子项，level 递增 ——
    const parent = await call(admin, 'POST', items, { code: '01', name: '地下室', totalPrice: 1000000 });
    assert.equal(parent.status, 201, `父项应创建成功：${JSON.stringify(parent.body).slice(0, 200)}`);
    assert.equal(parent.body.data.level, 1);
    const childA = await call(admin, 'POST', items, { code: '01.01', name: '钢筋', parentId: parent.body.data.id, totalPrice: 250000 });
    const childB = await call(admin, 'POST', items, { code: '01.02', name: '混凝土', parentId: parent.body.data.id, totalPrice: 350000 });
    assert.equal(childA.status, 201);
    assert.equal(childA.body.data.level, 2, '子项层级应为父项 + 1');
    assert.equal(childB.status, 201);

    // —— 2. 同项目内编号唯一 ——
    const duplicated = await call(admin, 'POST', items, { code: '01.01', name: '重复编号', totalPrice: 1 });
    assert.equal(duplicated.status, 409);
    assert.equal(duplicated.body.error.code, 'BUDGET_CODE_EXISTS');

    // —— 3. 上级必须属于同一项目 ——
    const foreignItem = await prisma.budgetItem.create({ data: { projectId: otherProject.id, code: '09', name: '别的项目清单', totalPrice: '100.00' } });
    const foreignParent = await call(admin, 'POST', items, { code: '01.03', name: '挂错项目', parentId: foreignItem.id, totalPrice: 1 });
    assert.equal(foreignParent.status, 400);
    assert.equal(foreignParent.body.error.code, 'INVALID_PARENT');

    // —— 4. 既有清单项不允许改层级 ——
    const reparent = await call(admin, 'PATCH', `${items}/${childB.body.data.id}`, { parentId: null });
    assert.equal(reparent.status, 400);
    assert.equal(reparent.body.error.code, 'PARENT_CHANGE_NOT_SUPPORTED');

    // —— 5. 只改数量/单价时总价自动重算（3 × 40000 = 120000）——
    const recomputed = await call(admin, 'PATCH', `${items}/${childB.body.data.id}`, { quantity: 3, unitPrice: 40000 });
    assert.equal(recomputed.status, 200, `改数量单价应成功：${JSON.stringify(recomputed.body).slice(0, 200)}`);
    assert.equal(toCents(recomputed.body.data.totalPrice), 12000000n, '总价应按 3 × 40000 重算');
    // 复原，便于后面用固定数字断言三算口径
    await call(admin, 'PATCH', `${items}/${childB.body.data.id}`, { totalPrice: 350000 });

    // —— 6. 权限：只读成员不能写清单，错误体带错误码 ——
    const viewerWrite = await call(viewer, 'POST', items, { code: '01.04', name: '越权写入', totalPrice: 1 });
    assert.equal(viewerWrite.status, 403);
    assert.equal(viewerWrite.body?.error?.code, 'PROJECT_PERMISSION_DENIED', `权限拒绝应带错误码，实际 ${JSON.stringify(viewerWrite.body).slice(0, 160)}`);

    // —— 7. 成本：两条挂子项、一条不挂清单、一条挂了再归档 ——
    const today = new Date();
    const isoDate = (day: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day, 3, 0, 0)).toISOString();
    const costs = `/api/projects/${project.id}/costs`;
    const costA = await call(admin, 'POST', costs, { type: 'MATERIAL', date: isoDate(2), amount: 300000, description: '钢筋进场', budgetItemId: childA.body.data.id });
    const costB = await call(admin, 'POST', costs, { type: 'MATERIAL', date: isoDate(3), amount: 200000, description: '混凝土浇筑', budgetItemId: childB.body.data.id });
    const costUnlinked = await call(admin, 'POST', costs, { type: 'LABOR', date: isoDate(4), amount: 50000, description: '零散人工' });
    const costArchived = await call(admin, 'POST', costs, { type: 'MATERIAL', date: isoDate(5), amount: 10000, description: '误录待归档', budgetItemId: childB.body.data.id });
    assert.equal(costA.status, 201);
    assert.equal(costB.status, 201);
    assert.equal(costUnlinked.status, 201);
    assert.equal(costArchived.status, 201);
    const archived = await call(admin, 'POST', `${costs}/${costArchived.body.data.id}/archive`);
    assert.equal(archived.status, 200);

    // —— 8. 三算对比口径 ——
    const threeWay = await call(admin, 'GET', `/api/projects/${project.id}/analysis/three-way`);
    assert.equal(threeWay.status, 200, `三算对比应成功：${JSON.stringify(threeWay.body).slice(0, 200)}`);
    const data = threeWay.body.data;

    assert.equal(toCents(data.targetCost), 60000000n, '目标成本只累计叶子清单项：25 万 + 35 万，父项 100 万不计入');
    assert.equal(toCents(data.actualCost), 55000000n, '实际成本含未挂清单的 5 万，归档的 1 万不计');
    assert.equal(toCents(data.contractAmount), 100000000n);
    assert.equal(toCents(data.targetProfit), 40000000n, '目标利润 = 合同额 100 万 - 目标成本 60 万');

    assert.equal(data.byBudget.length, 2, 'byBudget 只返回叶子清单项');
    const leafA = data.byBudget.find((row: { code: string }) => row.code === '01.01');
    const leafB = data.byBudget.find((row: { code: string }) => row.code === '01.02');
    assert.ok(!data.byBudget.some((row: { code: string }) => row.code === '01'), '父项不出现在 byBudget 里');
    assert.equal(toCents(leafA.targetCost), 25000000n);
    assert.equal(toCents(leafA.actualCost), 30000000n, '钢筋项实际 30 万，已超预算 5 万');
    assert.equal(toCents(leafB.targetCost), 35000000n);
    assert.equal(toCents(leafB.actualCost), 20000000n, '混凝土项实际 20 万，归档的 1 万不计入');

    const typedTotal = Object.values(data.costByType as Record<string, number>).reduce((sum, value) => sum + toCents(value), 0n);
    assert.equal(typedTotal, 55000000n, '分类型合计应与实际成本一致');
    assert.equal(toCents((data.costByType as Record<string, number>).MATERIAL), 50000000n);
    assert.equal(toCents((data.costByType as Record<string, number>).LABOR), 5000000n);

    const lastMonth = data.monthlyActualCost[data.monthlyActualCost.length - 1];
    assert.equal(toCents(lastMonth.amount), 55000000n, '本月成本应落在窗口最后一个月');

    // —— 9. 没有目标成本时不编利润率 ——
    const emptyProject = await makeProject('C', '500000.00');
    const emptyThreeWay = await call(admin, 'GET', `/api/projects/${emptyProject.id}/analysis/three-way`);
    assert.equal(emptyThreeWay.status, 200);
    assert.equal(emptyThreeWay.body.data.targetCost, 0);
    assert.equal(emptyThreeWay.body.data.targetProfit, null, '没有目标成本时目标利润应为 null，不能算成 100% 利润');
    assert.equal(emptyThreeWay.body.data.targetProfitMargin, null);
  } finally {
    await app.close();
    try {
      for (const projectId of projectIds) {
        await prisma.costEntry.deleteMany({ where: { projectId } });
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.budgetItem.deleteMany({ where: { projectId, parentId: { not: null } } });
        await prisma.budgetItem.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      // 测试账号自己产生的审计行会挡住 user 删除（AuditLog_userId_fkey），先按 userId 清掉。
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
      for (const userId of userIds) {
        await prisma.authSession.deleteMany({ where: { userId } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
      }
      await prisma.businessParty.deleteMany({ where: { name: { startsWith: '预算业主' } } }).catch(() => undefined);
    } catch (error) {
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
