/**
 * 项目档案生命周期的路由级回归（真实 PostgreSQL）。
 *
 * 这条链路把项目当天的状态、基数与成员身份写在一起，其中两条现状需要被钉住，
 * 因为它们容易被误读成缺陷而随手「修」掉：
 *   1. 任何已登录用户都可以建项目，并自动成为该项目的 OWNER 成员（本产品的
 *      自助建档模式，不是漏写的权限校验）；
 *   2. 项目状态没有状态机约束，CONSTRUCTION / SETTLED / PAUSED 之间可任意跳转，
 *      且已结算项目仍然允许继续录入成本。后者是待定口径，测试按现状断言，
 *      要收紧属于业务决策，不能由测试替业务定。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   PROJECT_LIFECYCLE_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:project-lifecycle:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { projectRoutes } from '../routes/projects.js';
import { costRoutes } from '../routes/costs.js';
import { contractRoutes } from '../routes/contracts.js';
import { normalizeBusinessPartyName } from './business-party.js';

const enabled = process.env.PROJECT_LIFECYCLE_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('项目档案：自助建档与 OWNER 身份、编号唯一、状态无状态机、基数冻结、状态过滤与权限', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(costRoutes, { prefix: '/api/projects' });
  await app.register(contractRoutes, { prefix: '/api/projects' });
  await app.ready();

  const userIds: string[] = [];
  const projectIds: string[] = [];

  async function makeActor(label: string, role: 'ADMIN' | 'USER' = 'USER') {
    const user = await prisma.user.create({ data: {
      name: `Project Fixture ${label} ${suffix}`,
      email: `project-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role,
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    const text = response.body ?? '';
    let body: any = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } }
    return { status: response.statusCode, body };
  };

  const newProjectBody = (label: string, overrides: Record<string, unknown> = {}) => ({
    name: `生命周期项目 ${label} ${suffix}`,
    code: `PL-${label}-${suffix}`.slice(0, 40),
    ownerName: `生命周期业主${label}${suffix}`.slice(0, 60),
    contractAmount: 2000000,
    startDate: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  try {
    const staff = await makeActor('staff');
    const colleague = await makeActor('colleague');

    // —— 1. 任何已登录用户都能建项目，并自动成为 OWNER ——
    const created = await call(staff, 'POST', '/api/projects', newProjectBody('A'));
    assert.equal(created.status, 201, `自助建档应成功：${JSON.stringify(created.body).slice(0, 200)}`);
    const projectId = created.body.data.id as string;
    projectIds.push(projectId);
    const membership = await prisma.projectMember.findUniqueOrThrow({ where: { projectId_userId: { projectId, userId: staff.userId } } });
    assert.equal(membership.role, 'OWNER', '建档人应自动成为项目负责人');
    assert.equal(created.body.data.status, 'CONSTRUCTION', '未指定状态时默认在建');

    // —— 2. 项目编号唯一 ——
    const duplicated = await call(staff, 'POST', '/api/projects', newProjectBody('A2', { code: `PL-A-${suffix}`.slice(0, 40) }));
    assert.equal(duplicated.status, 409);
    assert.equal(duplicated.body.error.code, 'PROJECT_CODE_EXISTS');

    // —— 3. 编号缺省时自动生成 XM 前缀 ——
    const autoCode = await call(staff, 'POST', '/api/projects', newProjectBody('B', { code: '' }));
    assert.equal(autoCode.status, 201, `未填编号应自动生成：${JSON.stringify(autoCode.body).slice(0, 200)}`);
    projectIds.push(autoCode.body.data.id as string);
    assert.ok(String(autoCode.body.data.code).length > 0);

    // —— 4. 空更新直接拒绝（修复前这里的 EMPTY_UPDATE 分支不可达）——
    const emptyUpdate = await call(staff, 'PATCH', `/api/projects/${projectId}`, {});
    assert.equal(emptyUpdate.status, 400);
    assert.equal(emptyUpdate.body.error.code, 'EMPTY_UPDATE');

    // —— 4b. 只改一个字段时，未发的字段不得被 schema 默认值覆盖 ——
    const typed = await call(staff, 'POST', '/api/projects', newProjectBody('T', { code: `PL-T-${suffix}`.slice(0, 40), type: 'MUNICIPAL' }));
    assert.equal(typed.status, 201);
    projectIds.push(typed.body.data.id as string);
    const partialUpdate = await call(staff, 'PATCH', `/api/projects/${typed.body.data.id}`, { managerName: '张项目经理' });
    assert.equal(partialUpdate.status, 200, `只改项目经理应成功：${JSON.stringify(partialUpdate.body).slice(0, 200)}`);
    const afterPartial = await prisma.project.findUniqueOrThrow({ where: { id: typed.body.data.id } });
    assert.equal(afterPartial.type, 'MUNICIPAL', '未发送 type 时不得被默认值 HOUSING 覆盖');
    assert.equal(afterPartial.managerName, '张项目经理');
    const partialAudit = await prisma.auditLog.findFirstOrThrow({ where: { projectId: typed.body.data.id, entity: 'Project', action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
    assert.ok(!('type' in (partialAudit.changes as Record<string, unknown>)), '审计只应记实际写入的字段');

    // —— 5. 状态没有状态机：从在建直接到已结算，写审计 ——
    const settled = await call(staff, 'PATCH', `/api/projects/${projectId}`, { status: 'SETTLED' });
    assert.equal(settled.status, 200, `改状态应成功：${JSON.stringify(settled.body).slice(0, 200)}`);
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).status, 'SETTLED');
    const statusAudit = await prisma.auditLog.findFirstOrThrow({ where: { projectId, entity: 'Project', action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
    assert.equal((statusAudit.changes as Record<string, unknown>).status, 'SETTLED');

    // —— 6. 现状：已结算项目仍可录入成本（待定口径，测试只记录不背书）——
    const costOnSettled = await call(staff, 'POST', `/api/projects/${projectId}/costs`, {
      type: 'MATERIAL', date: '2026-03-01T00:00:00.000Z', amount: 100, description: '已结算后补录',
    });
    assert.equal(costOnSettled.status, 201, '当前实现不拦已结算项目的成本写入；若要拦，属于业务口径变更');

    // —— 7. 基数：无主合同时可改，建主合同后冻结 ——
    const baseline = await call(staff, 'PATCH', `/api/projects/${projectId}`, { contractAmount: 2500000 });
    assert.equal(baseline.status, 200, `无主合同时应可改基数：${JSON.stringify(baseline.body).slice(0, 200)}`);
    const afterBaseline = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    assert.equal(afterBaseline.originalContractAmount.toFixed(2), '2500000.00', '原始基数应同步改写');
    assert.equal(afterBaseline.contractAmount.toFixed(2), '2500000.00', '无生效变更时有效额跟随基数');

    const contract = await call(staff, 'PUT', `/api/projects/${projectId}/contracts/main`, { name: '总承包合同', amount: 2500000, signedAt: '2026-01-10T00:00:00.000Z' });
    assert.equal(contract.status, 200, `主合同应建立成功：${JSON.stringify(contract.body).slice(0, 200)}`);

    const frozen = await call(staff, 'PATCH', `/api/projects/${projectId}`, { contractAmount: 2800000 });
    assert.equal(frozen.status, 409);
    assert.equal(frozen.body.error.code, 'ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE');

    // —— 8. 权限：非成员看不到、估算成员改不了 ——
    const outsiderRead = await call(colleague, 'GET', `/api/projects/${projectId}`);
    assert.equal(outsiderRead.status, 403);
    // 读取入口不带 permissionKey，所以码是 PROJECT_ACCESS_DENIED；带权限键的写入口才是 PROJECT_PERMISSION_DENIED。
    assert.equal(outsiderRead.body?.error?.code, 'PROJECT_ACCESS_DENIED');

    await prisma.projectMember.create({ data: { projectId, userId: colleague.userId, role: 'ESTIMATOR' } });
    const estimatorPatch = await call(colleague, 'PATCH', `/api/projects/${projectId}`, { managerName: '越权改名' });
    assert.equal(estimatorPatch.status, 403, '项目档案维护限定负责人与项目经理');
    assert.equal(estimatorPatch.body?.error?.code, 'PROJECT_PERMISSION_DENIED');

    // —— 9. 业主单位解析：已核验档案可关联，未核验被拒 ——
    const verified = await prisma.businessParty.create({ data: {
      name: `生命周期业主C${suffix}`.slice(0, 60), normalizedName: normalizeBusinessPartyName(`生命周期业主C${suffix}`),
      roles: ['OWNER'], identityVerified: true,
    } });
    const ownerLinked = await call(staff, 'PATCH', `/api/projects/${projectId}`, { ownerName: verified.name });
    assert.equal(ownerLinked.status, 200, `关联已核验业主应成功：${JSON.stringify(ownerLinked.body).slice(0, 200)}`);
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).ownerPartyId, verified.id);

    const unverified = await prisma.businessParty.create({ data: {
      name: `生命周期业主D${suffix}`.slice(0, 60), normalizedName: normalizeBusinessPartyName(`生命周期业主D${suffix}`),
      roles: ['OWNER'], identityVerified: false,
    } });
    const unverifiedOwner = await call(staff, 'PATCH', `/api/projects/${projectId}`, { ownerName: unverified.name });
    assert.equal(unverifiedOwner.status, 409);
    assert.equal(unverifiedOwner.body.error.code, 'BUSINESS_PARTY_IDENTITY_UNVERIFIED', `实际 ${JSON.stringify(unverifiedOwner.body).slice(0, 160)}`);

    // —— 10. 列表按状态过滤能查到 ——
    const filtered = await call(staff, 'GET', '/api/projects?status=SETTLED');
    assert.equal(filtered.status, 200);
    assert.ok((filtered.body.data as { id: string }[]).some((row) => row.id === projectId), '按状态过滤应包含刚改成已结算的项目');
    const pausedFilter = await call(staff, 'GET', '/api/projects?status=PAUSED');
    assert.ok(!(pausedFilter.body.data as { id: string }[]).some((row) => row.id === projectId), '状态过滤不应串档');
  } finally {
    await app.close();
    try {
      for (const projectId of projectIds) {
        await prisma.costEntry.deleteMany({ where: { projectId } });
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.mainContract.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      // 测试账号自己产生的审计行会挡住 user 删除（AuditLog_userId_fkey），先按 userId 清掉。
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
      for (const userId of userIds) {
        await prisma.authSession.deleteMany({ where: { userId } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
      }
      await prisma.businessParty.deleteMany({ where: { name: { startsWith: '生命周期业主' } } }).catch(() => undefined);
    } catch (error) {
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
