/**
 * 业主主合同的路由级回归（真实 PostgreSQL）。
 *
 * 主合同是收入侧所有计算的基数：应收计划、进度款、最终结算都以它为起点。
 * 这条路由上有三条互相牵制的规则，只有真库能验：
 *   1. 原始合同金额只在项目初始化阶段可改，一旦存在主合同或外部确认记录就锁死；
 *   2. 主合同台账金额必须与项目上的原始金额一致，历史数据不一致要拒绝覆盖，不能顺手改回；
 *   3. 当前有效合同额 = 原始金额 + 已生效的外部确认变更，负数必须拦下。
 * 另外首次建档时会把存量未挂合同的进度款与变更回填上 mainContractId，这个过程必须幂等。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   MAIN_CONTRACT_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:main-contract:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { contractRoutes } from '../routes/contracts.js';

const enabled = process.env.MAIN_CONTRACT_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('业主主合同：原始金额锁定、基数一致校验、有效额口径、存量回填幂等与权限', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(contractRoutes, { prefix: '/api/projects' });
  await app.ready();

  const userIds: string[] = [];
  const projectIds: string[] = [];

  async function makeActor(label: string, role: 'ADMIN' | 'USER' = 'ADMIN') {
    const user = await prisma.user.create({ data: {
      name: `Main Contract Fixture ${label} ${suffix}`,
      email: `mc-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role,
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'PUT', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    const text = response.body ?? '';
    let body: any = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } }
    return { status: response.statusCode, body };
  };

  async function makeProject(label: string, amount: string) {
    const project = await prisma.project.create({ data: {
      name: `Main Contract ${label} ${suffix}`,
      code: `MC-${label}-${suffix}`.slice(0, 40),
      ownerName: `主合同业主${label}${suffix}`.slice(0, 60),
      contractAmount: amount,
      originalContractAmount: amount,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectIds.push(project.id);
    return project;
  }

  const mainContractBody = (amount: number, extra: Record<string, unknown> = {}) => ({
    name: '施工总承包合同', amount, signedAt: '2026-01-10T00:00:00.000Z', paymentTermDays: 30, ...extra,
  });

  try {
    const admin = await makeActor('admin');
    const viewer = await makeActor('viewer', 'USER');
    const outsider = await makeActor('outsider', 'USER');

    // ———————————————— A. 首次建档：基数写入 + 存量回填 + 审计 ————————————————
    const projectA = await makeProject('A', '3000000.00');
    await prisma.projectMember.createMany({ data: [
      { projectId: projectA.id, userId: viewer.userId, role: 'VIEWER' },
      { projectId: projectA.id, userId: outsider.userId, role: 'ESTIMATOR' },
    ] });

    // 存量记录：都还没挂主合同，首次建档时应该被回填。
    const staleBill = await prisma.progressBill.create({ data: {
      projectId: projectA.id, periodNo: 1, applyDate: new Date('2026-02-01T00:00:00.000Z'), amount: '800000.00',
    } });
    const staleChange = await prisma.change.create({ data: {
      projectId: projectA.id, code: `CH-${suffix}`, name: '设计变更', occurredAt: new Date('2026-02-05T00:00:00.000Z'),
      submittedAmount: '120000.00',
    } });

    const baseA = `/api/projects/${projectA.id}/contracts/main`;
    const first = await call(admin, 'PUT', baseA, mainContractBody(3000000));
    assert.equal(first.status, 200, `首次建档应成功：${JSON.stringify(first.body).slice(0, 300)}`);
    assert.equal(Number(first.body.data.amount), 3000000);

    const savedA = await prisma.mainContract.findUniqueOrThrow({ where: { projectId: projectA.id } });
    assert.equal(savedA.amount.toFixed(2), '3000000.00');
    assert.ok(savedA.contractNo.length > 0, '未提供合同编号时应自动生成');

    const projectAAfter = await prisma.project.findUniqueOrThrow({ where: { id: projectA.id } });
    assert.equal(projectAAfter.contractAmount.toFixed(2), '3000000.00', '无生效变更时有效额等于原始额');
    assert.equal(projectAAfter.originalContractAmount.toFixed(2), '3000000.00');

    assert.equal((await prisma.progressBill.findUniqueOrThrow({ where: { id: staleBill.id } })).mainContractId, savedA.id, '存量进度款应回填');
    assert.equal((await prisma.change.findUniqueOrThrow({ where: { id: staleChange.id } })).mainContractId, savedA.id, '存量变更应回填');
    const legacyAudit = await prisma.auditLog.findMany({ where: { projectId: projectA.id, action: 'LEGACY_REVENUE_RECORDS_LINKED' } });
    assert.equal(legacyAudit.length, 1);
    const legacyChanges = (legacyAudit[0]?.changes ?? {}) as Record<string, unknown>;
    assert.equal(legacyChanges.progressBillsLinked, 1);
    assert.equal(legacyChanges.changesLinked, 1);

    // ———————————————— B. 同金额重存：幂等，不重复回填、不重复写回填审计 ————————————————
    const again = await call(admin, 'PUT', baseA, mainContractBody(3000000, { name: '施工总承包合同（重存）' }));
    assert.equal(again.status, 200, `同金额重存应成功：${JSON.stringify(again.body).slice(0, 160)}`);
    assert.equal((await prisma.auditLog.count({ where: { projectId: projectA.id, action: 'LEGACY_REVENUE_RECORDS_LINKED' } })), 1, '回填审计不应重复');
    assert.equal((await prisma.mainContract.findUniqueOrThrow({ where: { projectId: projectA.id } })).name, '施工总承包合同（重存）', '重存应更新合同档案字段');

    // ———————————————— C. 已有主合同时改原始金额：拒绝 ————————————————
    const changedBase = await call(admin, 'PUT', baseA, mainContractBody(3500000));
    assert.equal(changedBase.status, 409);
    assert.equal(changedBase.body.error.code, 'ORIGINAL_CONTRACT_AMOUNT_IMMUTABLE');
    assert.equal((await prisma.mainContract.findUniqueOrThrow({ where: { projectId: projectA.id } })).amount.toFixed(2), '3000000.00', '被拒后合同金额不得变化');

    // ———————————————— D. 项目原始金额与主合同不一致：拒绝覆盖 ————————————————
    await prisma.project.update({ where: { id: projectA.id }, data: { originalContractAmount: '3100000.00' } });
    const mismatch = await call(admin, 'PUT', baseA, mainContractBody(3000000));
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error.code, 'BASE_CONTRACT_DATA_MISMATCH');
    await prisma.project.update({ where: { id: projectA.id }, data: { originalContractAmount: '3000000.00' } });

    // ———————————————— E. 权限：只读成员与角色不符都被拒，错误体带错误码 ————————————————
    const viewerWrite = await call(viewer, 'PUT', baseA, mainContractBody(3000000));
    assert.equal(viewerWrite.status, 403);
    assert.equal(viewerWrite.body?.error?.code, 'PROJECT_PERMISSION_DENIED', `权限拒绝应带错误码，实际 ${JSON.stringify(viewerWrite.body).slice(0, 160)}`);

    const outsiderWrite = await call(outsider, 'PUT', baseA, mainContractBody(3000000));
    assert.equal(outsiderWrite.status, 200, 'ESTIMATOR 可写主合同');

    // ———————————————— F. 有效合同额 = 原始额 + 已生效的外部确认 ————————————————
    const projectF = await makeProject('F', '2000000.00');
    await prisma.change.createMany({ data: [
      { projectId: projectF.id, code: `CH-F1-${suffix}`, name: '增加内容', occurredAt: new Date('2026-02-05T00:00:00.000Z'), submittedAmount: '500000.00',
        direction: 'INCREASE', status: 'CONFIRMED', externalConfirmationStatus: 'EFFECTIVE', externalConfirmedAmount: '500000.00' },
      { projectId: projectF.id, code: `CH-F2-${suffix}`, name: '未生效变更', occurredAt: new Date('2026-02-06T00:00:00.000Z'), submittedAmount: '300000.00',
        direction: 'INCREASE', status: 'CONFIRMED', externalConfirmationStatus: 'PENDING_VERIFICATION', externalConfirmedAmount: null },
    ] });
    const baseF = `/api/projects/${projectF.id}/contracts/main`;
    const savedF = await call(admin, 'PUT', baseF, mainContractBody(2000000));
    assert.equal(savedF.status, 200, `生效变更存在时建档应成功：${JSON.stringify(savedF.body).slice(0, 200)}`);
    assert.equal(Number(savedF.body.data.effectiveAmount), 2500000, '有效额 = 原始 200 万 + 生效 50 万');
    const projectFAfter = await prisma.project.findUniqueOrThrow({ where: { id: projectF.id } });
    assert.equal(projectFAfter.contractAmount.toFixed(2), '2500000.00');
    assert.equal(projectFAfter.originalContractAmount.toFixed(2), '2000000.00', '原始额不因变更被改写');
    const upsertAudit = await prisma.auditLog.findFirstOrThrow({ where: { projectId: projectF.id, entity: 'MainContract', action: 'UPSERT' }, orderBy: { createdAt: 'desc' } });
    const changes = upsertAudit.changes as Record<string, unknown>;
    assert.equal(changes.previousBaseAmount, '2000000');
    assert.equal(changes.originalContractAmount, '2000000');
    assert.equal(changes.effectiveContractAmount, '2500000.00');

    // ———————————————— G. 有效额会被算成负数：拒绝，且整体回滚 ————————————————
    const projectG = await makeProject('G', '1000000.00');
    await prisma.change.create({ data: {
      projectId: projectG.id, code: `CH-G-${suffix}`, name: '大幅核减', occurredAt: new Date('2026-02-05T00:00:00.000Z'), submittedAmount: '1500000.00',
      direction: 'DECREASE', status: 'CONFIRMED', externalConfirmationStatus: 'EFFECTIVE', externalConfirmedAmount: '1500000.00',
    } });
    const negative = await call(admin, 'PUT', `/api/projects/${projectG.id}/contracts/main`, mainContractBody(1000000));
    assert.equal(negative.status, 409);
    assert.equal(negative.body.error.code, 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE');
    assert.equal(await prisma.mainContract.findUnique({ where: { projectId: projectG.id } }), null, '事务应整体回滚，不留下主合同');
  } finally {
    await app.close();
    try {
      for (const projectId of projectIds) {
        await prisma.change.deleteMany({ where: { projectId } });
        await prisma.progressBill.deleteMany({ where: { projectId } });
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.mainContract.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      for (const userId of userIds) {
        await prisma.authSession.deleteMany({ where: { userId } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
      }
      await prisma.businessParty.deleteMany({ where: { name: { startsWith: '主合同业主' } } }).catch(() => undefined);
    } catch (error) {
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
