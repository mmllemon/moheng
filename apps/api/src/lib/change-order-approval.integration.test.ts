/**
 * 变更签证内部审批链的路由级回归（真实 PostgreSQL）。
 *
 * 为什么挑这条链：它是全仓唯一把「公司级角色」「项目成员角色」「已发布的治理规则」
 * 「本单状态」四件事叠在一起判权限的地方，代码里用 Serializable 事务 + updateMany 抢占
 * 来防「用过期策略批准」。这类问题单测看不出来：workflow 规则查询、成员查询、状态抢占
 * 分散在三个查询里，只有走真实路由 + 真实事务才能验证它们真的原子。
 *
 * 覆盖：无项目成员的公司管理员不得审批、提交人不得自批、缺核定金额被拒、
 * 非法流转被拒、两人并发审批只成功一条、审计带 workflow 来源与版本。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   CHANGE_APPROVAL_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:change-approval:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { changeRoutes } from '../routes/changes.js';

const enabled = process.env.CHANGE_APPROVAL_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('变更签证审批：公司管理员不等于项目审批权、提交人不得自批、缺核定金额被拒、并发只成功一条、发布规则后角色受限', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(changeRoutes, { prefix: '/api/projects' });
  await app.ready();

  const userIds: string[] = [];
  let projectId: string | undefined;

  async function makeActor(label: string) {
    const user = await prisma.user.create({ data: {
      name: `Change Fixture ${label} ${suffix}`,
      email: `change-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role: 'ADMIN',
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    return { status: response.statusCode, body: response.json() };
  };
  const toCents = (value: unknown) => BigInt(Math.round(Number(value ?? 0) * 100));

  try {
    // 三个账号都是公司级 ADMIN，差别只在项目成员角色：这正是要验的点
    const estimator = await makeActor('estimator');
    const managerA = await makeActor('manager-a');
    const managerB = await makeActor('manager-b');
    const managerC = await makeActor('manager-c');
    const owner = await makeActor('owner-role');
    const outsider = await makeActor('outsider');

    const project = await prisma.project.create({ data: {
      name: `Change Approval ${suffix}`,
      code: `CA-${suffix}`,
      ownerName: 'Gate Owner',
      contractAmount: '5000000.00',
      originalContractAmount: '5000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectId = project.id;
    await prisma.mainContract.create({ data: {
      projectId: project.id,
      contractNo: `MC-${suffix}`,
      name: '主合同',
      amount: '5000000.00',
      signedAt: new Date('2026-01-01T00:00:00.000Z'),
    } });
    await prisma.projectMember.createMany({ data: [
      { projectId: project.id, userId: estimator.userId, role: 'ESTIMATOR' },
      { projectId: project.id, userId: managerA.userId, role: 'MANAGER' },
      { projectId: project.id, userId: managerB.userId, role: 'MANAGER' },
      { projectId: project.id, userId: managerC.userId, role: 'MANAGER' },
      { projectId: project.id, userId: owner.userId, role: 'OWNER' },
    ] });

    const base = `/api/projects/${project.id}/changes`;
    const createChange = (actor: typeof estimator, amount = 120000) => call(actor, 'POST', base, {
      name: '地下室增加止水钢板',
      type: 'ENGINEERING_CHANGE',
      direction: 'INCREASE',
      occurredAt: '2026-03-01T00:00:00.000Z',
      submittedAmount: amount,
    });
    const setStatus = (actor: typeof estimator, changeId: string, status: string, extra: Record<string, unknown> = {}) =>
      call(actor, 'PATCH', `${base}/${changeId}/status`, { status, ...extra });

    // —— 1. 创建：草稿 + 审计 ——
    const created = await createChange(estimator);
    assert.equal(created.status, 201, `创建变更应成功：${JSON.stringify(created.body).slice(0, 200)}`);
    assert.equal(created.body.data.status, 'DRAFT');
    assert.equal(toCents(created.body.data.submittedAmount), 12000000n);
    const changeId = created.body.data.id as string;
    const createAudit = await prisma.auditLog.findFirst({ where: { projectId: project.id, entity: 'Change', entityId: changeId, action: 'CREATE' } });
    assert.ok(createAudit, '创建应写一条 CREATE 审计');

    // —— 2. 非法流转：DRAFT 不能直接到 CONFIRMED ——
    const skip = await setStatus(managerA, changeId, 'CONFIRMED', { approvedAmount: 120000 });
    assert.equal(skip.status, 409);
    assert.equal(skip.body.error.code, 'INVALID_STATUS_TRANSITION');

    // —— 3. 提交；公司管理员没有项目成员身份时不得提交（ADMIN ≠ 项目权限）——
    //       从 DRAFT 起只能先提交，所以提交人用项目经理（后面才好验自批拦截）
    const outsiderSubmit = await setStatus(outsider, changeId, 'SUBMITTED');
    assert.equal(outsiderSubmit.status, 403);
    assert.equal(outsiderSubmit.body.error.code, 'CHANGE_WORKFLOW_PROJECT_MEMBERSHIP_REQUIRED');

    const submitted = await setStatus(managerA, changeId, 'SUBMITTED');
    assert.equal(submitted.status, 200, `提交应成功：${JSON.stringify(submitted.body).slice(0, 200)}`);
    assert.equal(submitted.body.data.status, 'SUBMITTED');

    // —— 4. 进入内部评审，缺核定金额不得通过；提交人本人审批被拒 ——
    const underReview = await setStatus(managerB, changeId, 'UNDER_REVIEW');
    assert.equal(underReview.status, 200, `转入内部评审应成功：${JSON.stringify(underReview.body).slice(0, 200)}`);
    const noAmount = await setStatus(managerB, changeId, 'CONFIRMED');
    assert.equal(noAmount.status, 400);
    assert.equal(noAmount.body.error.code, 'APPROVED_AMOUNT_REQUIRED');
    const selfApprove = await setStatus(managerA, changeId, 'CONFIRMED', { approvedAmount: 120000 });
    assert.equal(selfApprove.status, 403, `提交人自批应被拦住，实际 ${JSON.stringify(selfApprove.body).slice(0, 160)}`);
    assert.equal(selfApprove.body.error.code, 'SELF_APPROVAL_FORBIDDEN');

    // —— 5. 两位经理并发审批：状态抢占只能有一条成功 ——
    const [left, right] = await Promise.all([
      setStatus(managerB, changeId, 'CONFIRMED', { approvedAmount: 118000 }),
      setStatus(managerC, changeId, 'CONFIRMED', { approvedAmount: 121000 }),
    ]);
    const statuses = [left.status, right.status].sort();
    assert.equal(statuses.filter((value) => value === 200).length, 1, `并发审批只能成功一条，实际 ${JSON.stringify(statuses)}`);
    const failed = left.status === 200 ? right : left;
    assert.equal(failed.status, 409);
    // 两条路径都是正确的拒绝：若是读到了新状态就是流转非法，若是读到旧状态但抢占失败就是
    // INTERNAL_CHANGE_STATE_CHANGED。具体哪种取决于两条请求与事务提交的先后，所以两种都接受。
    assert.ok(['INTERNAL_CHANGE_STATE_CHANGED', 'INVALID_STATUS_TRANSITION'].includes(failed.body.error.code), `失败原因应为并发或流转拒绝，实际 ${failed.body.error.code}`);

    const winner = left.status === 200 ? left : right;
    const winnerId = winner === left ? managerB.userId : managerC.userId;
    const finalAmount = winner === left ? 118000 : 121000;

    // —— 6. 落库结果：核定金额、审批人、状态与审计都要对 ——
    const saved = await prisma.change.findUniqueOrThrow({ where: { id: changeId } });
    assert.equal(saved.status, 'CONFIRMED');
    assert.equal(toCents(saved.approvedAmount), BigInt(finalAmount) * 100n);
    assert.equal(saved.internalApprovedById, winnerId);
    assert.ok(saved.internalApprovedAt, '审批时间应写入');
    assert.equal(saved.submittedById, managerA.userId, '提交人应保留原提交人');

    const approvalAudit = await prisma.auditLog.findFirst({
      where: { projectId: project.id, entity: 'Change', entityId: changeId, action: 'INTERNAL_STATUS_CHANGE', userId: winnerId },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(approvalAudit, '审批应写一条 INTERNAL_STATUS_CHANGE 审计');
    const changes = approvalAudit.changes as Record<string, unknown>;
    assert.equal(changes.to, 'CONFIRMED');
    assert.equal(changes.workflowSource, 'BUILT_IN_DEFAULT', '未发布自定义流程时应记录内置默认来源');
    assert.equal(changes.submitterId, managerA.userId);

    // —— 7. 已确认的单子不能再走一次 ——
    const again = await setStatus(managerB, changeId, 'CONFIRMED', { approvedAmount: 120000 });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'INVALID_STATUS_TRANSITION');

    // —— 8. 校验：负数金额在入口就被拒 ——
    const negative = await call(estimator, 'POST', base, {
      name: '负数变更', occurredAt: '2026-03-02T00:00:00.000Z', submittedAmount: -1,
    });
    assert.equal(negative.status, 400);
    assert.equal(negative.body.error.code, 'VALIDATION_ERROR');

    // —— 9. 发布审批角色规则后，不在名单里的项目角色不得核定 ——
    await prisma.governanceRuleVersion.create({ data: {
      ruleKey: 'CHANGE_APPROVAL', name: '变更签发审批角色', version: 1, status: 'PUBLISHED',
      definition: { allowedProjectRoles: ['MANAGER'] }, createdById: managerA.userId,
      publishedById: managerA.userId, publishedAt: new Date('2026-04-01T00:00:00.000Z'),
    } });
    const second = await createChange(estimator, 80000);
    assert.equal(second.status, 201);
    const secondId = second.body.data.id as string;
    assert.equal((await setStatus(managerA, secondId, 'SUBMITTED')).status, 200);
    assert.equal((await setStatus(managerB, secondId, 'UNDER_REVIEW')).status, 200);

    // OWNER 默认是默认规则里的审批角色，但发布后的规则只允许 MANAGER
    const ownerRejected = await setStatus(owner, secondId, 'CONFIRMED', { approvedAmount: 80000 });
    assert.equal(ownerRejected.status, 403, `发布规则后角色不匹配应被拦住，实际 ${JSON.stringify(ownerRejected.body).slice(0, 160)}`);
    assert.equal(ownerRejected.body.error.code, 'CHANGE_APPROVAL_ROLE_REQUIRED');

    const byRule = await setStatus(managerB, secondId, 'CONFIRMED', { approvedAmount: 79000 });
    assert.equal(byRule.status, 200, `规则允许的角色应能通过：${JSON.stringify(byRule.body).slice(0, 200)}`);
    const ruleAudit = await prisma.auditLog.findFirst({
      where: { projectId: project.id, entity: 'Change', entityId: secondId, action: 'INTERNAL_STATUS_CHANGE', userId: managerB.userId },
      orderBy: { createdAt: 'desc' },
    });
    const ruleChanges = ruleAudit?.changes as Record<string, unknown> | undefined;
    assert.equal(ruleChanges?.approvalRuleVersion, 1, '审计应记录实际生效的审批规则版本');
    assert.deepEqual(ruleChanges?.approvalRuleRoles, ['MANAGER']);
  } finally {
    await app.close();
    try {
      if (projectId) {
        await prisma.change.deleteMany({ where: { projectId } });
        await prisma.governanceRuleVersion.deleteMany({ where: { ruleKey: 'CHANGE_APPROVAL', createdById: { in: userIds } } }).catch(() => undefined);
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.mainContract.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      for (const userId of userIds) {
        await prisma.authSession.deleteMany({ where: { userId } }).catch(() => undefined);
        await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
      }
    } catch (error) {
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
