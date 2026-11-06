/**
 * 进度款申报 → 审批 → 到账的路由级回归（真实 PostgreSQL）。
 *
 * 这条链的要点是「审批通过会顺带生成业主应收」以及「到账必须同时写应收核销」：
 * 一次操作横跨 ProgressBill、OwnerReceivable、OwnerReceivableSchedule、OwnerReceipt、
 * OwnerReceiptAllocation 五张表，任何一步没在同一个事务里就会留下半截账。
 * 另外它带一条容易忽略的口径：主合同已过账最终结算后，不许再从进度款这里登记到账，
 * 必须走应收单，否则会绕开最终结算的净额校验。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   PROGRESS_BILL_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:progress-bill:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { progressBillRoutes } from '../routes/progress-bills.js';

const enabled = process.env.PROGRESS_BILL_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('进度款：审批生成应收、到账跨五张表原子落库、超额与并发拦截、最终结算后改走应收单', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(progressBillRoutes, { prefix: '/api/projects' });
  await app.ready();

  const userIds: string[] = [];
  let projectId: string | undefined;
  let mainContractId: string | undefined;

  async function makeActor(label: string) {
    const user = await prisma.user.create({ data: {
      name: `Progress Bill Fixture ${label} ${suffix}`,
      email: `progress-bill-${label}-${suffix}@example.invalid`,
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
    const actor = await makeActor('estimator');
    const project = await prisma.project.create({ data: {
      name: `Progress Bill ${suffix}`,
      code: `PB-${suffix}`,
      ownerName: 'Gate Owner',
      contractAmount: '3000000.00',
      originalContractAmount: '3000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectId = project.id;
    await prisma.projectMember.create({ data: { projectId: project.id, userId: actor.userId, role: 'ESTIMATOR' } });

    const base = `/api/projects/${project.id}/progress-bills`;
    const createBill = (overrides: Record<string, unknown> = {}) => call(actor, 'POST', base, {
      periodNo: 1, applyDate: '2026-03-01T00:00:00.000Z', amount: 500000, ...overrides,
    });
    const setStatus = (billId: string, status: string, extra: Record<string, unknown> = {}) =>
      call(actor, 'PATCH', `${base}/${billId}/status`, { status, ...extra });
    const pay = (billId: string, amount: number, paidAt = '2026-04-01T00:00:00.000Z') =>
      call(actor, 'POST', `${base}/${billId}/payments`, { amount, paidAt });

    // —— 1. 没有主合同时不能申报 ——
    const noContract = await createBill();
    assert.equal(noContract.status, 409);
    assert.equal(noContract.body.error.code, 'MAIN_CONTRACT_REQUIRED');

    const main = await prisma.mainContract.create({ data: {
      projectId: project.id,
      contractNo: `MC-${suffix}`,
      name: '主合同',
      amount: '3000000.00',
      signedAt: new Date('2026-01-01T00:00:00.000Z'),
      paymentTermDays: 30,
    } });
    mainContractId = main.id;

    // —— 2. 期次唯一 ——
    const first = await createBill();
    assert.equal(first.status, 201, `申报应成功：${JSON.stringify(first.body).slice(0, 200)}`);
    const billId = first.body.data.id as string;
    const duplicate = await createBill();
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'BILL_PERIOD_EXISTS');

    // —— 3. 未审批不得登记到账 ——
    const earlyPay = await pay(billId, 100000);
    assert.equal(earlyPay.status, 409);
    assert.equal(earlyPay.body.error.code, 'BILL_NOT_APPROVED');

    // —— 4. 审批：不填核定金额时按报审金额核定，并自动生成业主应收 ——
    assert.equal((await setStatus(billId, 'SUBMITTED')).status, 200);
    assert.equal((await setStatus(billId, 'UNDER_REVIEW')).status, 200);
    const approved = await setStatus(billId, 'APPROVED');
    assert.equal(approved.status, 200, `审批应成功：${JSON.stringify(approved.body).slice(0, 240)}`);
    assert.equal(approved.body.data.status, 'APPROVED');
    assert.equal(toCents(approved.body.data.approvedAmount), 50000000n, '未填核定金额时按报审金额核定');

    const receivable = await prisma.ownerReceivable.findFirst({ where: { sourceProgressBillId: billId } });
    assert.ok(receivable, '审批通过应生成业主应收');
    assert.equal(toCents(receivable.netAmount), 50000000n);
    assert.match(receivable.title ?? '', /进度款第1期应收/);
    assert.ok(receivable.dueAt, '主合同约定 30 天付款期时应推算到期日');
    const dueInDays = Math.round(((receivable.dueAt as Date).getTime() - Date.now()) / 86_400_000);
    assert.ok(dueInDays >= 28 && dueInDays <= 31, `到期日应约为今天 +30 天，实际 ${dueInDays} 天`);
    const schedule = await prisma.ownerReceivableSchedule.findFirst({ where: { receivableId: receivable.id } });
    assert.ok(schedule, '有到期日时应生成一期收款计划');

    // —— 5. 到账：跨五张表同时落库 ——
    const half = await pay(billId, 200000);
    assert.equal(half.status, 201, `部分到账应成功：${JSON.stringify(half.body).slice(0, 240)}`);
    assert.equal(toCents(half.body.data.paidAmount), 20000000n);
    assert.equal(half.body.data.status, 'APPROVED', '未收齐时保持 APPROVED');

    const receiptsAfterHalf = await prisma.ownerReceipt.count({ where: { projectId: project.id } });
    const allocationsAfterHalf = await prisma.ownerReceiptAllocation.count({ where: { receivableId: receivable.id } });
    assert.equal(receiptsAfterHalf, 1, '到账应生成一条业主收款');
    assert.equal(allocationsAfterHalf, 1, '到账应同时写一条应收核销');
    const receivableHalf = await prisma.ownerReceivable.findUniqueOrThrow({ where: { id: receivable.id } });
    assert.equal(receivableHalf.status, 'PARTIALLY_RECEIVED');

    // —— 6. 超额到账被拒，且不留任何收款或核销 ——
    const over = await pay(billId, 400000);
    assert.equal(over.status, 400);
    assert.equal(over.body.error.code, 'PAYMENT_EXCEEDS_APPROVED');
    assert.equal(await prisma.ownerReceipt.count({ where: { projectId: project.id } }), 1, '被拒绝的到账不能留下收款');
    assert.equal(await prisma.ownerReceiptAllocation.count({ where: { receivableId: receivable.id } }), 1);

    // —— 7. 两笔并发到账合计超额：只成功一笔 ——
    const [left, right] = await Promise.all([pay(billId, 200000, '2026-04-02T00:00:00.000Z'), pay(billId, 200000, '2026-04-03T00:00:00.000Z')]);
    const codes = [left.status, right.status].sort();
    assert.equal(codes.filter((code) => code === 201).length, 1, `并发到账只能成功一笔，实际 ${JSON.stringify(codes)}`);
    const failed = left.status === 201 ? right : left;
    assert.ok(['PAYMENT_EXCEEDS_APPROVED', 'PAYMENT_CONFLICT', 'RECEIPT_EXCEEDS_CONTRACT_OPEN'].includes(failed.body.error.code), `失败原因应为超额或并发冲突，实际 ${failed.body.error.code}`);

    const settledBill = await prisma.progressBill.findUniqueOrThrow({ where: { id: billId } });
    assert.equal(toCents(settledBill.paidAmount), 40000000n, '并发之后累计到账应正好 40 万');
    assert.equal(settledBill.status, 'APPROVED', '还差 10 万，不应进入 PAID');

    // —— 8. 收齐后账单转 PAID、应收转 RECEIVED ——
    const finalPay = await pay(billId, 100000, '2026-04-04T00:00:00.000Z');
    assert.equal(finalPay.status, 201);
    assert.equal(finalPay.body.data.status, 'PAID');
    const receivablePaid = await prisma.ownerReceivable.findUniqueOrThrow({ where: { id: receivable.id } });
    assert.equal(receivablePaid.status, 'RECEIVED');

    const auditActions = (await prisma.auditLog.findMany({ where: { projectId: project.id, entity: 'ProgressBill' } })).map((row) => row.action);
    for (const action of ['CREATE', 'STATUS_CHANGE', 'PAYMENT_REGISTERED']) assert.ok(auditActions.includes(action), `审计里应包含 ${action}`);

    // —— 9. 主合同已过账最终结算后，进度款里不再允许登记到账 ——
    await prisma.ownerContractSettlement.create({ data: {
      projectId: project.id,
      mainContractId: main.id,
      settlementNo: `FS-${suffix}`,
      type: 'FINAL',
      status: 'POSTED',
      submittedAmount: '3000000.00',
      confirmedAmount: '3000000.00',
      postedDeltaAmount: '3000000.00',
      postedAt: new Date('2026-05-01T00:00:00.000Z'),
      createdById: actor.userId,
    } });
    const second = await createBill({ periodNo: 2, amount: 100000, applyDate: '2026-05-02T00:00:00.000Z' });
    assert.equal(second.status, 201);
    const secondId = second.body.data.id as string;
    assert.equal((await setStatus(secondId, 'SUBMITTED')).status, 200);
    assert.equal((await setStatus(secondId, 'UNDER_REVIEW')).status, 200);
    assert.equal((await setStatus(secondId, 'APPROVED')).status, 200);
    const blocked = await pay(secondId, 100000, '2026-05-03T00:00:00.000Z');
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'OWNER_SETTLEMENT_COLLECTION_REQUIRED', '最终结算过账后必须走应收单登记到账');
  } finally {
    await app.close();
    try {
      if (projectId) {
        await prisma.progressPayment.deleteMany({ where: { progressBill: { projectId } } }).catch(() => undefined);
        await prisma.ownerReceiptAllocation.deleteMany({ where: { receipt: { projectId } } }).catch(() => undefined);
        await prisma.ownerReceipt.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.ownerReceivableSchedule.deleteMany({ where: { receivable: { projectId } } }).catch(() => undefined);
        await prisma.ownerReceivable.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.progressBill.deleteMany({ where: { projectId } }).catch(() => undefined);
        if (mainContractId) await prisma.ownerContractSettlement.deleteMany({ where: { mainContractId } }).catch(() => undefined);
        await prisma.auditLog.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.projectMember.deleteMany({ where: { projectId } }).catch(() => undefined);
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
