/**
 * 业主到账与退款的分配回归（真实 PostgreSQL + 真实路由）。
 *
 * 与 owner-settlement-posting.integration.test.ts 互补：那个盯结算过账如何生成应收，
 * 这个盯应收之后的钱怎么被核销、退回，以及并发下会不会超额。
 *
 * 覆盖：
 *   1. 部分到账 → 分配行 + 状态 PARTIALLY_RECEIVED + 审计
 *   2. 到账等于未收余额 → RECEIVED
 *   3. 到账超过未收余额 → 400 RECEIPT_EXCEEDS_CONTRACT_OPEN，且不留分配行
 *   4. 负向应收不允许登记普通到账 → 409 RECEIVABLE_NOT_PAYABLE
 *   5. 期次到账超过该期余额 → 400 RECEIPT_EXCEEDS_SCHEDULE
 *   6. 退款：部分退款冲回分配、状态回落；超额退款 → 400 REFUND_EXCEEDS_RECEIPT
 *   7. 并发：两笔同时到账、单笔都不超、合计超过 → 只允许合计不超过未收余额，状态自洽
 *
 * 运行（隔离库，必须先跑迁移）：
 *   OWNER_RECEIPT_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:owner-receipt:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { ownerFinanceRoutes } from '../routes/owner-finance.js';

const enabled = process.env.OWNER_RECEIPT_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('业主到账核销与退款：分配、上限、负向应收、并发不超额', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(ownerFinanceRoutes, { prefix: '/api/projects' });
  await app.ready();

  const toCents = (value: unknown) => BigInt(Math.round(Number(value ?? 0) * 100));
  const userIds: string[] = [];
  let projectId: string | undefined;

  async function makeActor(label: string) {
    const user = await prisma.user.create({ data: {
      name: `Receipt Fixture ${label} ${suffix}`,
      email: `receipt-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role: 'ADMIN',
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    return { userId: user.id, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id })}` } };
  }

  try {
    const clerk = await makeActor('clerk');
    const call = async (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => {
      const response = await app.inject({ method, url, headers: clerk.headers, ...(payload === undefined ? {} : { payload }) });
      return { status: response.statusCode, body: response.json() };
    };

    const project = await prisma.project.create({ data: {
      name: `Receipt ${suffix}`, code: `RCP-${suffix}`, ownerName: 'Gate Owner',
      contractAmount: '1000000.00', originalContractAmount: '1000000.00', startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectId = project.id;
    const mainContract = await prisma.mainContract.create({ data: {
      projectId: project.id, contractNo: `MC-${suffix}`, name: '主合同', amount: '1000000.00', signedAt: new Date('2026-01-01T00:00:00.000Z'),
    } });

    const base = `/api/projects/${project.id}/owner-finance`;
    let receivableSeq = 0;
    const makeReceivable = async (netAmount: string, withSchedule = false) => {
      receivableSeq += 1;
      const receivable = await prisma.ownerReceivable.create({ data: {
        projectId: project.id, mainContractId: mainContract.id,
        receivableNo: `YS-T-${suffix}-${receivableSeq}`, type: 'ADJUSTMENT', title: `测试应收 ${receivableSeq}`,
        grossAmount: netAmount, netAmount, dueAt: new Date('2026-06-30T00:00:00.000Z'), status: 'OPEN',
        createdById: clerk.userId, postedAt: new Date(),
        ...(withSchedule ? { schedules: { create: [{ scheduleNo: '01', dueAt: new Date('2026-06-30T00:00:00.000Z'), amount: '400.00' }] } } : {}),
      }, include: { schedules: true } });
      return receivable;
    };

    // ---- 1. 部分到账 ----
    const ar1 = await makeReceivable('1000.00');
    const partial = await call('POST', `${base}/receivables/${ar1.id}/receipts`, { amount: 400, receivedAt: '2026-05-01T00:00:00.000Z', referenceNo: 'R-1' });
    assert.equal(partial.status, 201, JSON.stringify(partial.body));
    assert.equal(toCents(partial.body.data.amount), 40000n);
    const afterPartial = await prisma.ownerReceivable.findUniqueOrThrow({ where: { id: ar1.id } });
    assert.equal(afterPartial.status, 'PARTIALLY_RECEIVED');
    assert.equal(await prisma.ownerReceiptAllocation.count({ where: { receivableId: ar1.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: partial.body.data.id, action: 'OWNER_RECEIPT_REGISTERED' } }), 1);

    // ---- 2. 补齐余额 → RECEIVED ----
    const rest = await call('POST', `${base}/receivables/${ar1.id}/receipts`, { amount: 600, receivedAt: '2026-05-02T00:00:00.000Z' });
    assert.equal(rest.status, 201, JSON.stringify(rest.body));
    assert.equal((await prisma.ownerReceivable.findUniqueOrThrow({ where: { id: ar1.id } })).status, 'RECEIVED');

    // ---- 3. 超额到账被拒，且不留分配行 ----
    const allocationsBefore = await prisma.ownerReceiptAllocation.count({ where: { receivableId: ar1.id } });
    const over = await call('POST', `${base}/receivables/${ar1.id}/receipts`, { amount: 0.01, receivedAt: '2026-05-03T00:00:00.000Z' });
    assert.equal(over.status, 400, JSON.stringify(over.body));
    assert.equal(over.body.error.code, 'RECEIPT_EXCEEDS_CONTRACT_OPEN');
    assert.equal(await prisma.ownerReceiptAllocation.count({ where: { receivableId: ar1.id } }), allocationsBefore);

    // ---- 4. 负向应收不能登记普通到账 ----
    const credit = await makeReceivable('-500.00');
    const onCredit = await call('POST', `${base}/receivables/${credit.id}/receipts`, { amount: 100, receivedAt: '2026-05-04T00:00:00.000Z' });
    assert.equal(onCredit.status, 409, JSON.stringify(onCredit.body));
    assert.equal(onCredit.body.error.code, 'RECEIVABLE_NOT_PAYABLE');

    // ---- 5. 期次到账超过该期余额 ----
    const ar2 = await makeReceivable('1000.00', true);
    const schedule = ar2.schedules[0];
    assert.ok(schedule, '期次应已创建');
    const overSchedule = await call('POST', `${base}/receivables/${ar2.id}/receipts`, { amount: 500, receivedAt: '2026-05-05T00:00:00.000Z', scheduleId: schedule.id });
    assert.equal(overSchedule.status, 400, JSON.stringify(overSchedule.body));
    assert.equal(overSchedule.body.error.code, 'RECEIPT_EXCEEDS_SCHEDULE');
    const withinSchedule = await call('POST', `${base}/receivables/${ar2.id}/receipts`, { amount: 400, receivedAt: '2026-05-06T00:00:00.000Z', scheduleId: schedule.id });
    assert.equal(withinSchedule.status, 201, JSON.stringify(withinSchedule.body));

    // ---- 6. 退款：部分冲回、超额拒绝 ----
    const refund = await call('POST', `${base}/receipts/${withinSchedule.body.data.id}/refund`, { amount: 150, receivedAt: '2026-05-07T00:00:00.000Z', referenceNo: 'RF-1' });
    assert.equal(refund.status, 201, JSON.stringify(refund.body));
    assert.equal(toCents(refund.body.data.amount), 15000n);
    const afterRefundAllocated = await prisma.ownerReceiptAllocation.aggregate({ where: { receivableId: ar2.id }, _sum: { amount: true } });
    assert.equal(toCents(afterRefundAllocated._sum.amount ?? 0), 25000n, '净核销应为 400 - 150 = 250');
    assert.equal((await prisma.ownerReceivable.findUniqueOrThrow({ where: { id: ar2.id } })).status, 'PARTIALLY_RECEIVED');
    const overRefund = await call('POST', `${base}/receipts/${withinSchedule.body.data.id}/refund`, { amount: 251, receivedAt: '2026-05-08T00:00:00.000Z' });
    assert.equal(overRefund.status, 400, JSON.stringify(overRefund.body));
    assert.equal(overRefund.body.error.code, 'REFUND_EXCEEDS_RECEIPT');

    // ---- 7. 并发：两笔各 600，合计 1200 > 未收 1000 ----
    const ar3 = await makeReceivable('1000.00');
    const [first, second] = await Promise.all([
      call('POST', `${base}/receivables/${ar3.id}/receipts`, { amount: 600, receivedAt: '2026-05-09T00:00:00.000Z' }),
      call('POST', `${base}/receivables/${ar3.id}/receipts`, { amount: 600, receivedAt: '2026-05-09T00:00:01.000Z' }),
    ]);
    const outcomes = [first, second];
    const accepted = outcomes.filter((r) => r.status === 201);
    const rejected = outcomes.filter((r) => r.status !== 201);
    assert.ok(accepted.length >= 1, '至少一笔应成功：' + JSON.stringify(outcomes.map((r) => r.status)));
    for (const rejectedOne of rejected) {
      assert.ok([400, 409].includes(rejectedOne.status), `被拒的那笔应是 400/409，实际 ${rejectedOne.status}：${JSON.stringify(rejectedOne.body)}`);
    }
    const allocated3 = await prisma.ownerReceiptAllocation.aggregate({ where: { receivableId: ar3.id }, _sum: { amount: true } });
    assert.ok(toCents(allocated3._sum.amount ?? 0) <= 100000n, `核销合计不得超过未收余额，实际 ${String(allocated3._sum.amount)}`);
    const ar3Row = await prisma.ownerReceivable.findUniqueOrThrow({ where: { id: ar3.id } });
    const expectedStatus = toCents(allocated3._sum.amount ?? 0) === 100000n ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    assert.equal(ar3Row.status, expectedStatus, '状态必须与净核销额一致');
    assert.equal(accepted.length, 1, '两笔合计超额时不应两笔都成功');
  } finally {
    if (projectId) {
      await prisma.ownerReceiptAllocation.deleteMany({ where: { receivable: { projectId } } }).catch(() => undefined);
      // 退款是一条 type=REFUND 的 OwnerReceipt（自关联），先删退款行再删原到账行
      await prisma.ownerReceipt.deleteMany({ where: { projectId, type: 'REFUND' } }).catch(() => undefined);
      await prisma.ownerReceipt.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.ownerReceivableSchedule.deleteMany({ where: { receivable: { projectId } } }).catch(() => undefined);
      await prisma.ownerReceivable.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.mainContract.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    }
    if (userIds.length) {
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
    await app.close();
  }
});
