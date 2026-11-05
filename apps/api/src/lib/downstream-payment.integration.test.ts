/**
 * 分供合同付款链路的路由级回归（真实 PostgreSQL）。
 *
 * 背景：金额契约（5838372/0d57849/4d54e81）把「录入 → 存库 → 读出」钉住了，业主侧也补了
 * 结算过账与到账核销两条路由级回归。分供这条链一直只有纯函数测试（downstream-payment-math），
 * 而它恰恰是唯一带「累计不超合同额」「退款冲回原付款」「referenceNo 唯一」「Serializable 重试」
 * 四个约束一起生效的写路径。这个文件把它们放到真实路由 + 真实事务里量一次。
 *
 * 断言重点是「算对了但没写对」这一类：失败请求不能留半条付款、退款必须冲减净额、
 * 并发两笔不能把累计付款顶穿合同额。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   DOWNSTREAM_PAYMENT_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:downstream-payment:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { downstreamContractRoutes } from '../routes/downstream-contracts.js';
import { downstreamFinanceRoutes } from '../routes/downstream-finance.js';
import { normalizeBusinessPartyName } from './business-party.js';

const enabled = process.env.DOWNSTREAM_PAYMENT_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('分供付款：草稿不可付、唯一凭证、超额与退款边界、并发不顶穿合同额', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(downstreamContractRoutes, { prefix: '/api/projects' });
  await app.register(downstreamFinanceRoutes, { prefix: '/api/projects' });
  await app.ready();

  const userIds: string[] = [];
  const projectIds: string[] = [];

  async function makeActor(label: string) {
    const user = await prisma.user.create({ data: {
      name: `Downstream Fixture ${label} ${suffix}`,
      email: `downstream-fixture-${label}-${suffix}@example.invalid`,
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
    const actor = await makeActor('clerk');
    const project = await prisma.project.create({ data: {
      name: `Downstream Payment ${suffix}`,
      code: `DP-${suffix}`,
      ownerName: 'Gate Owner',
      contractAmount: '5000000.00',
      originalContractAmount: '5000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectIds.push(project.id);
    const party = await prisma.businessParty.create({ data: {
      name: `分供测试单位 ${suffix}`,
      normalizedName: normalizeBusinessPartyName(`分供测试单位 ${suffix}`),
      roles: ['MATERIAL_SUPPLIER'],
      identityVerified: true,
    } });

    /** 建一份分供合同草稿；amount 为原始合同额 */
    async function makeContract(input: { no: string; amount: number }) {
      const created = await call(actor, 'POST', `/api/projects/${project.id}/downstream-contracts`, {
        contractNo: input.no,
        name: `分供合同 ${input.no}`,
        type: 'MATERIAL_PURCHASE',
        counterpartyName: party.name,
        counterpartyPartyId: party.id,
        signedAt: '2026-01-05T00:00:00.000Z',
        originalAmount: input.amount,
        taxIncluded: true,
      });
      assert.equal(created.status, 201, `创建分供合同应成功，实际 ${created.status}：${JSON.stringify(created.body).slice(0, 200)}`);
      return created.body.data.id as string;
    }

    const pay = (contractId: string, payload: Record<string, unknown>) => call(actor, 'POST', `/api/projects/${project.id}/downstream-contracts/${contractId}/payments`, {
      paidAt: '2026-02-01T00:00:00.000Z',
      ...payload,
    });

    // —— 1. 草稿阶段不允许登记付款 ——
    const contractId = await makeContract({ no: `DC-A-${suffix}`, amount: 1000000 });
    const draftPay = await pay(contractId, { type: 'PROGRESS', amount: 100000 });
    assert.equal(draftPay.status, 409);
    assert.equal(draftPay.body.error.code, 'DOWNSTREAM_CONTRACT_NOT_PAYABLE');
    assert.equal(await prisma.downstreamContractPayment.count({ where: { downstreamContractId: contractId } }), 0, '被拒绝的付款不能落库');

    // —— 2. 激活后可付款 ——
    const activated = await call(actor, 'PATCH', `/api/projects/${project.id}/downstream-contracts/${contractId}/status`, { status: 'ACTIVE' });
    assert.equal(activated.status, 200, `激活应成功，实际 ${activated.status}：${JSON.stringify(activated.body).slice(0, 200)}`);

    const firstPay = await pay(contractId, { type: 'PROGRESS', amount: 400000, referenceNo: `REF-A-${suffix}` });
    assert.equal(firstPay.status, 201);
    assert.equal(toCents(firstPay.body.data.amount), 40000000n);

    // —— 3. 同一凭证号不能重复入账 ——
    const duplicate = await pay(contractId, { type: 'PROGRESS', amount: 1000, referenceNo: `REF-A-${suffix}` });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'PAYMENT_REFERENCE_DUPLICATE');

    // —— 4. 累计净付款不得超过合同额 ——
    const overpay = await pay(contractId, { type: 'PROGRESS', amount: 700000 });
    assert.equal(overpay.status, 409);
    assert.equal(overpay.body.error.code, 'PAYMENT_EXCEEDS_CONTRACT');
    assert.equal(await prisma.downstreamContractPayment.count({ where: { downstreamContractId: contractId } }), 1, '超额付款不能落库');

    // —— 5. 退款冲减净额，且不能超过原付款剩余额度 ——
    const paymentId = firstPay.body.data.id as string;
    const refund = await pay(contractId, { type: 'REFUND', amount: 100000, refundOfPaymentId: paymentId });
    assert.equal(refund.status, 201, `退款应成功，实际 ${refund.status}：${JSON.stringify(refund.body).slice(0, 200)}`);

    const overRefund = await pay(contractId, { type: 'REFUND', amount: 300001, refundOfPaymentId: paymentId });
    assert.equal(overRefund.status, 409);
    assert.equal(overRefund.body.error.code, 'REFUND_EXCEEDS_ORIGINAL_PAYMENT');

    // —— 6. 落库结果：净额、笔数、审计三条一致 ——
    const rows = await prisma.downstreamContractPayment.findMany({ where: { downstreamContractId: contractId }, orderBy: { paidAt: 'asc' } });
    assert.equal(rows.length, 2, '应只有首笔付款与一笔退款');
    const netCents = rows.reduce((sum, row) => sum + (row.type === 'REFUND' ? -toCents(row.amount) : toCents(row.amount)), 0n);
    assert.equal(netCents, 30000000n, '净付款应为 30 万');

    const audits = await prisma.auditLog.findMany({ where: { projectId: project.id, entity: 'DownstreamContractPayment' }, orderBy: { createdAt: 'asc' } });
    assert.equal(audits.length, 2);
    assert.deepEqual(audits.map((row) => row.action), ['PAYMENT_RECORDED', 'PAYMENT_REFUND_RECORDED']);
    const recorded = audits[0]?.changes as Record<string, unknown>;
    assert.equal(recorded.cumulativeNetPaid, '400000.00', '审计里的累计净额应与当次实付一致');

    // —— 7. 汇总接口能读到这份合同，且不因退款算错应付口径 ——
    const overview = await call(actor, 'GET', `/api/projects/${project.id}/downstream-finance`);
    assert.equal(overview.status, 200);
    const row = (overview.body.data.items as { id: string; currentAmount: number }[]).find((item) => item.id === contractId);
    assert.ok(row, '汇总里应能读到该合同');
    assert.equal(toCents(row.currentAmount), 100000000n, '当前有效合同额应保持 100 万');

    // —— 8. 并发上限：两笔各 60 万抢 100 万额度，只能成功一笔 ——
    const raceContract = await makeContract({ no: `DC-B-${suffix}`, amount: 1000000 });
    const raced = await call(actor, 'PATCH', `/api/projects/${project.id}/downstream-contracts/${raceContract}/status`, { status: 'ACTIVE' });
    assert.equal(raced.status, 200);
    const [left, right] = await Promise.all([
      pay(raceContract, { type: 'PROGRESS', amount: 600000, referenceNo: `REF-B1-${suffix}` }),
      pay(raceContract, { type: 'PROGRESS', amount: 600000, referenceNo: `REF-B2-${suffix}` }),
    ]);
    const statuses = [left.status, right.status].sort();
    assert.equal(statuses.filter((status) => status === 201).length, 1, `并发两笔只能成功一笔，实际 ${JSON.stringify(statuses)}`);
    const failed = left.status === 201 ? right : left;
    assert.ok(['PAYMENT_EXCEEDS_CONTRACT', 'PAYMENT_CONFLICT'].includes(failed.body.error.code), `失败原因应为额度或并发冲突，实际 ${failed.body.error.code}`);
    const raceRows = await prisma.downstreamContractPayment.findMany({ where: { downstreamContractId: raceContract } });
    const raceNet = raceRows.reduce((sum, item) => sum + toCents(item.amount), 0n);
    assert.equal(raceNet, 60000000n, '并发后累计净付款必须仍是一笔 60 万');

    // —— 9. 结算确认状态不允许手工改：ACTIVE 直接跳 SETTLED 被状态机拦住，
    //        COMPLETED → SETTLED 进一步被「必须有已过账的最终结算」拦住 ——
    const illegal = await call(actor, 'PATCH', `/api/projects/${project.id}/downstream-contracts/${contractId}/status`, { status: 'SETTLED' });
    assert.equal(illegal.status, 409);
    assert.equal(illegal.body.error.code, 'INVALID_STATUS_TRANSITION');

    const completed = await call(actor, 'PATCH', `/api/projects/${project.id}/downstream-contracts/${contractId}/status`, { status: 'COMPLETED' });
    assert.equal(completed.status, 200);
    const forcedSettled = await call(actor, 'PATCH', `/api/projects/${project.id}/downstream-contracts/${contractId}/status`, { status: 'SETTLED' });
    assert.equal(forcedSettled.status, 409);
    assert.equal(forcedSettled.body.error.code, 'FINAL_SETTLEMENT_REQUIRED');
  } finally {
    await app.close();
    for (const projectId of projectIds) {
      const contracts = await prisma.downstreamContract.findMany({ where: { projectId }, select: { id: true } });
      const contractIds = contracts.map((row) => row.id);
      if (contractIds.length) {
        await prisma.downstreamPaymentAllocation.deleteMany({ where: { payment: { downstreamContractId: { in: contractIds } } } }).catch(() => undefined);
        await prisma.downstreamContractPayment.deleteMany({ where: { downstreamContractId: { in: contractIds } } });
        await prisma.downstreamContractAdjustment.deleteMany({ where: { downstreamContractId: { in: contractIds } } }).catch(() => undefined);
        await prisma.downstreamContract.deleteMany({ where: { id: { in: contractIds } } });
      }
      await prisma.auditLog.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    }
    await prisma.businessParty.deleteMany({ where: { name: { contains: `分供测试单位 ${suffix}` } } }).catch(() => undefined);
    for (const userId of userIds) {
      await prisma.authSession.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
});
