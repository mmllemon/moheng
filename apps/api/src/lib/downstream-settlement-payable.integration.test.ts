/**
 * 分供结算 → 应付 → 付款核销的分成链回归（真实 PostgreSQL）。
 *
 * 分工：
 *   - downstream-payment.integration.test.ts 钉的是付款本身的边界（唯一凭证、累计超合同额、退款、并发）。
 *   - 这个文件钉的是「结算过账怎么变成应付、付款怎么必须核销应付」这一段：
 *     提交人不得审批自己、未确认不能过账、过账生成应付与质保金留置、应付余额与分期约束、
 *     最终结算把合同推到 SETTLED。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   DOWNSTREAM_SETTLEMENT_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:downstream-settlement:postgres -w @cms/api
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

const enabled = process.env.DOWNSTREAM_SETTLEMENT_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('分供结算到应付：审批分离、未确认不过账、应付与质保金、付款必须核销、质保金释放与没收、分期调整、发票核销与最终结算收口', { skip: !enabled }, async () => {
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
  let projectId: string | undefined;

  async function makeActor(label: string) {
    const user = await prisma.user.create({ data: {
      name: `Settlement Fixture ${label} ${suffix}`,
      email: `settlement-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role: 'ADMIN',
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    return { status: response.statusCode, body: response.json() };
  };
  const toCents = (value: unknown) => BigInt(Math.round(Number(value ?? 0) * 100));

  try {
    const clerk = await makeActor('clerk');
    const reviewer = await makeActor('reviewer');
    const project = await prisma.project.create({ data: {
      name: `Downstream Settlement ${suffix}`,
      code: `DS-${suffix}`,
      ownerName: 'Gate Owner',
      contractAmount: '5000000.00',
      originalContractAmount: '5000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectId = project.id;
    const party = await prisma.businessParty.create({ data: {
      name: `结算测试单位 ${suffix}`,
      normalizedName: normalizeBusinessPartyName(`结算测试单位 ${suffix}`),
      roles: ['MATERIAL_SUPPLIER'],
      identityVerified: true,
    } });

    const created = await call(clerk, 'POST', `/api/projects/${project.id}/downstream-contracts`, {
      contractNo: `S-${suffix}`,
      name: '结算链路测试合同',
      type: 'MATERIAL_PURCHASE',
      counterpartyName: party.name,
      counterpartyPartyId: party.id,
      signedAt: '2026-01-05T00:00:00.000Z',
      originalAmount: 1000000,
      taxIncluded: true,
    });
    assert.equal(created.status, 201, `创建合同应成功：${JSON.stringify(created.body).slice(0, 200)}`);
    const contractId = created.body.data.id as string;
    const activated = await call(clerk, 'PATCH', `/api/projects/${project.id}/downstream-contracts/${contractId}/status`, { status: 'ACTIVE' });
    assert.equal(activated.status, 200);

    const base = `/api/projects/${project.id}/downstream-contracts/${contractId}`;
    const settle = (actor: typeof clerk, payload: Record<string, unknown>) => call(actor, 'POST', `${base}/settlements`, payload);
    const act = (actor: typeof clerk, settlementId: string, step: 'submit' | 'approve' | 'confirm' | 'post', payload?: Record<string, unknown>) =>
      call(actor, 'POST', `${base}/settlements/${settlementId}/${step}`, payload);

    /** 走完 草稿→提交→审批→外部确认，返回 settlementId 与确认后的 DTO */
    async function prepareSettlement(payload: Record<string, unknown>, confirmedAmount: number) {
      const draft = await settle(clerk, payload);
      assert.equal(draft.status, 201, `建结算单应成功：${JSON.stringify(draft.body).slice(0, 200)}`);
      const settlementId = draft.body.data.id as string;
      assert.equal((await act(clerk, settlementId, 'submit')).status, 200);
      assert.equal((await act(reviewer, settlementId, 'approve')).status, 200);
      const confirmed = await act(clerk, settlementId, 'confirm', {
        confirmedAmount,
        confirmationReference: `CONF-${settlementId.slice(-6)}`,
        confirmationDate: '2026-03-01T00:00:00.000Z',
      });
      assert.equal(confirmed.status, 200, `外部确认应成功：${JSON.stringify(confirmed.body).slice(0, 200)}`);
      return settlementId;
    }

    // —— 1. 预付款先入账，为后面的预付款抵扣准备余额 ——
    const advance = await call(clerk, 'POST', `${base}/payments`, { type: 'ADVANCE', amount: 50000, paidAt: '2026-01-20T00:00:00.000Z', referenceNo: `ADV-${suffix}` });
    assert.equal(advance.status, 201, `预付款登记应成功：${JSON.stringify(advance.body).slice(0, 200)}`);

    // —— 2. 阶段结算：提交人不得审批自己 ——
    const first = await settle(clerk, { type: 'PROGRESS', submittedAmount: 300000, lines: [] });
    assert.equal(first.status, 201);
    const s1 = first.body.data.id as string;
    assert.equal((await act(clerk, s1, 'submit')).status, 200);
    const selfApprove = await act(clerk, s1, 'approve');
    assert.equal(selfApprove.status, 403);
    assert.equal(selfApprove.body.error.code, 'SUBMITTER_CANNOT_APPROVE');
    assert.equal((await act(reviewer, s1, 'approve')).status, 200);

    // —— 3. 未经外部确认不得过账 ——
    const earlyPost = await act(clerk, s1, 'post');
    assert.equal(earlyPost.status, 409);
    assert.equal(earlyPost.body.error.code, 'SETTLEMENT_NOT_CONFIRMED');

    const confirmed1 = await act(clerk, s1, 'confirm', { confirmedAmount: 300000, confirmationReference: `C1-${suffix}`, confirmationDate: '2026-03-01T00:00:00.000Z' });
    assert.equal(confirmed1.status, 200);

    // —— 4. 过账生成应付，状态与金额都要对 ——
    const posted1 = await act(clerk, s1, 'post');
    assert.equal(posted1.status, 200, `过账应成功：${JSON.stringify(posted1.body).slice(0, 240)}`);
    assert.equal(posted1.body.data.settlement.status, 'POSTED');
    assert.equal(toCents(posted1.body.data.settlement.postedDeltaAmount), 30000000n);
    const payable1 = posted1.body.data.payable;
    assert.ok(payable1, '过账应生成应付单');
    assert.equal(toCents(payable1.grossAmount), 30000000n);
    assert.equal(toCents(payable1.netAmount), 30000000n);

    // —— 5. 同一结算单不能重复过账 ——
    const repost = await act(clerk, s1, 'post');
    assert.equal(repost.status, 409);
    assert.equal(repost.body.error.code, 'SETTLEMENT_ALREADY_POSTED', '已过账的单子再点一次，应明确告知已过账而不是“未确认”');

    // —— 6. 第二笔带预付款抵扣、质保金与其它扣款 ——
    const s2 = await prepareSettlement({ type: 'PROGRESS', submittedAmount: 200000, advanceRecoveryAmount: 50000, retentionAmount: 10000, otherDeductionAmount: 5000, lines: [] }, 200000);
    const posted2 = await act(clerk, s2, 'post');
    assert.equal(posted2.status, 200, `第二笔过账应成功：${JSON.stringify(posted2.body).slice(0, 240)}`);
    const payable2 = posted2.body.data.payable;
    assert.equal(toCents(payable2.grossAmount), 20000000n);
    assert.equal(toCents(payable2.advanceRecoveryAmount), 5000000n);
    assert.equal(toCents(payable2.retentionAmount), 1000000n);
    assert.equal(toCents(payable2.otherDeductionAmount), 500000n);
    assert.equal(toCents(payable2.netAmount), 13500000n, '应付净额应为 20 万减 5 万预付款、1 万质保金、5 千其它扣款');

    const retention = await prisma.downstreamRetentionMovement.findMany({ where: { downstreamContractId: contractId } });
    assert.equal(retention.length, 1);
    assert.equal(retention[0]?.type, 'RETAIN');
    assert.equal(toCents(retention[0]?.amount), 1000000n);

    const afterTwo = await call(clerk, 'GET', `/api/projects/${project.id}/downstream-finance`);
    assert.equal(afterTwo.status, 200);
    const row = (afterTwo.body.data.items as { id: string; advanceBalanceAmount: number; openPayableAmount: number; totalSettledAmount: number }[]).find((item) => item.id === contractId);
    assert.ok(row);
    assert.equal(toCents(row.advanceBalanceAmount), 0n, '预付款应被结算全额抵扣');
    assert.equal(toCents(row.openPayableAmount), 43500000n, '两张应付的未付余额合计应为 43.5 万（毛额减预付款、质保金与其它扣款）');
    assert.equal(toCents(row.totalSettledAmount), 50000000n, '累计已过账结算金额是差额累加（30 万 + 20 万），与应付净额不是同一个口径');

    // —— 7. 扣款超过确认额，过账时必须拒绝 ——
    const s3 = await prepareSettlement({ type: 'PROGRESS', submittedAmount: 100000, otherDeductionAmount: 120000, lines: [] }, 100000);
    const overDeduction = await act(clerk, s3, 'post');
    assert.equal(overDeduction.status, 409);
    assert.equal(overDeduction.body.error.code, 'SETTLEMENT_DEDUCTIONS_EXCEED_AMOUNT');
    assert.equal(await prisma.downstreamPayable.count({ where: { downstreamContractId: contractId } }), 2, '被拒绝的过账不能生成应付');

    // —— 8. 已有应付时，付款必须明确核销 ——
    const unallocated = await call(clerk, 'POST', `${base}/payments`, { type: 'PROGRESS', amount: 100000, paidAt: '2026-03-10T00:00:00.000Z' });
    assert.equal(unallocated.status, 409);
    assert.equal(unallocated.body.error.code, 'PAYABLE_ALLOCATION_REQUIRED');

    const overAllocate = await call(clerk, 'POST', `${base}/payments`, {
      type: 'PROGRESS', amount: 300001, paidAt: '2026-03-10T00:00:00.000Z',
      allocations: [{ payableId: payable1.id, amount: 300001 }],
    });
    assert.equal(overAllocate.status, 409);
    assert.equal(overAllocate.body.error.code, 'PAYMENT_EXCEEDS_OPEN_PAYABLE');

    const allocated = await call(clerk, 'POST', `${base}/payments`, {
      type: 'PROGRESS', amount: 300000, paidAt: '2026-03-10T00:00:00.000Z', referenceNo: `P1-${suffix}`,
      allocations: [{ payableId: payable1.id, amount: 300000 }],
    });
    assert.equal(allocated.status, 201, `核销应付的付款应成功：${JSON.stringify(allocated.body).slice(0, 240)}`);

    const clearedAgain = await call(clerk, 'POST', `${base}/payments`, {
      type: 'PROGRESS', amount: 1000, paidAt: '2026-03-11T00:00:00.000Z',
      allocations: [{ payableId: payable1.id, amount: 1000 }],
    });
    assert.equal(clearedAgain.status, 409);
    assert.equal(clearedAgain.body.error.code, 'PAYABLE_ALREADY_CLEARED');

    // —— 9. 最终结算：最终确认额是“累计确认额”（前面阶段结算已累计 50 万），本次过账差额为 6 万 ——
    //       合同先收口为 COMPLETED，最终结算过账后自动推到 SETTLED。
    assert.equal((await call(clerk, 'PATCH', `${base}/status`, { status: 'COMPLETED' })).status, 200);
    // 完工待结算但未过账最终结算时，质保金不允许处置
    const earlyRelease = await call(clerk, 'POST', `${base}/retention/release`, { amount: 1000, effectiveAt: '2026-03-20T00:00:00.000Z', reference: `RETE-${suffix}` });
    assert.equal(earlyRelease.status, 409);
    assert.equal(earlyRelease.body.error.code, 'RETENTION_REQUIRES_FINAL_SETTLEMENT');
    const finalId = await prepareSettlement({ type: 'FINAL', submittedAmount: 560000, lines: [] }, 560000);
    const postedFinal = await act(clerk, finalId, 'post');
    assert.equal(postedFinal.status, 200, `最终结算过账应成功：${JSON.stringify(postedFinal.body).slice(0, 240)}`);
    assert.equal(toCents(postedFinal.body.data.settlement.postedDeltaAmount), 6000000n, '最终结算差额应为 56 万减已过账 50 万');
    assert.equal(toCents(postedFinal.body.data.payable.netAmount), 6000000n);

    const contract = await prisma.downstreamContract.findUnique({ where: { id: contractId }, select: { status: true } });
    assert.equal(contract?.status, 'SETTLED');

    const postings = await prisma.downstreamSettlementPosting.findMany({ where: { downstreamContractId: contractId }, orderBy: { postedAt: 'asc' } });
    assert.equal(postings.length, 3, '三次过账对应的过账记录都应存在');
    assert.equal(toCents(postings[2]?.cumulativeAfter), 56000000n, '过账记录里的累计额应等于最终确认额');

    const settlementAudits = await prisma.auditLog.findMany({ where: { projectId: project.id, entity: 'DownstreamContractSettlement' } });
    const actions = settlementAudits.map((item) => item.action);
    for (const expected of ['SETTLEMENT_SUBMITTED', 'SETTLEMENT_INTERNAL_APPROVED', 'SETTLEMENT_COUNTERPARTY_CONFIRMED', 'SETTLEMENT_POSTED']) {
      assert.ok(actions.includes(expected), `审计里应包含 ${expected}`);
    }

    // —— 10. 结算确认 ≠ 已付清：合同 SETTLED 后仍可登记付款，但仍必须核销应付余额 ——
    const afterSettled = await call(clerk, 'POST', `${base}/payments`, { type: 'PROGRESS', amount: 100, paidAt: '2026-04-01T00:00:00.000Z' });
    assert.equal(afterSettled.status, 409);
    assert.equal(afterSettled.body.error.code, 'PAYABLE_ALLOCATION_REQUIRED', '结算收口后仍未付的应付还在，付款必须继续明确核销');

    // —— 11. 质保金释放与没收：结算确认后才能处置，释放生成带一期的应付 ——
    const released = await call(clerk, 'POST', `${base}/retention/release`, { amount: 4000, effectiveAt: '2026-05-01T00:00:00.000Z', reference: `RET-${suffix}` });
    assert.equal(released.status, 201, `质保金释放应成功：${JSON.stringify(released.body).slice(0, 200)}`);
    const releasePayable = released.body.data.payable;
    assert.ok(releasePayable, '释放质保金应生成应付单');
    assert.equal(releasePayable.type, 'RETENTION_RELEASE');
    assert.equal(toCents(releasePayable.netAmount), 400000n);
    assert.equal(releasePayable.schedules.length, 1, '释放应自动建一期到期安排');

    // 分期存在时，付款必须选择分期
    const noSchedule = await call(clerk, 'POST', `${base}/payments`, {
      type: 'RETENTION', amount: 4000, paidAt: '2026-05-02T00:00:00.000Z',
      allocations: [{ payableId: releasePayable.id, amount: 4000 }],
    });
    assert.equal(noSchedule.status, 409);
    assert.equal(noSchedule.body.error.code, 'PAYABLE_SCHEDULE_REQUIRED', '应付已设分期时，付款必须指明本期次');

    // 普通进度款不能用于核销质保金释放应付（要在应付未结清前验，否则会先报“已结清”）
    const wrongType = await call(clerk, 'POST', `${base}/payments`, {
      type: 'PROGRESS', amount: 100, paidAt: '2026-05-04T00:00:00.000Z',
      allocations: [{ payableId: releasePayable.id, payableScheduleId: releasePayable.schedules[0].id, amount: 100 }],
    });
    assert.equal(wrongType.status, 409);
    assert.equal(wrongType.body.error.code, 'RETENTION_RELEASE_REQUIRES_RETENTION_PAYMENT');

    const withSchedule = await call(clerk, 'POST', `${base}/payments`, {
      type: 'RETENTION', amount: 4000, paidAt: '2026-05-03T00:00:00.000Z', referenceNo: `RETP-${suffix}`,
      allocations: [{ payableId: releasePayable.id, payableScheduleId: releasePayable.schedules[0].id, amount: 4000 }],
    });
    assert.equal(withSchedule.status, 201, `按期次核销应成功：${JSON.stringify(withSchedule.body).slice(0, 240)}`);

    // 剩余的 6 千走没收，不生成应付
    const forfeited = await call(clerk, 'POST', `${base}/retention/forfeit`, { amount: 6000, effectiveAt: '2026-05-05T00:00:00.000Z', reference: `FORF-${suffix}` });
    assert.equal(forfeited.status, 201, `质保金没收应成功：${JSON.stringify(forfeited.body).slice(0, 200)}`);
    assert.equal(forfeited.body.data.payable, null, '没收不生成应付');

    // 释放额不能超过剩余质保金（4 千释放 + 6 千没收后余额为 0）
    const overRelease = await call(clerk, 'POST', `${base}/retention/release`, { amount: 1, effectiveAt: '2026-05-06T00:00:00.000Z', reference: `RET2-${suffix}` });
    assert.equal(overRelease.status, 409);
    assert.equal(overRelease.body.error.code, 'RETENTION_AMOUNT_EXCEEDS_BALANCE');

    const retentionRows = await prisma.downstreamRetentionMovement.findMany({ where: { downstreamContractId: contractId } });
    assert.deepEqual(retentionRows.map((row) => row.type).sort(), ['FORFEIT', 'RELEASE', 'RETAIN'], '应各有一条留置、释放与没收记录');

    // —— 12. 应付分期调整：未发生付款前可重排，合计必须等于净额，发生付款后锁定 ——
    const finalPayable = postedFinal.body.data.payable;
    const reschedule = (schedules: { scheduleNo: string; dueAt: string; amount: number }[]) => call(clerk, 'PUT', `${base}/payables/${finalPayable.id}/schedules`, { schedules });
    const twoInstallments = await reschedule([
      { scheduleNo: '01', dueAt: '2026-06-01T00:00:00.000Z', amount: 30000 },
      { scheduleNo: '02', dueAt: '2026-07-01T00:00:00.000Z', amount: 30000 },
    ]);
    assert.equal(twoInstallments.status, 200, `重排分期应成功：${JSON.stringify(twoInstallments.body).slice(0, 200)}`);

    const wrongTotal = await reschedule([{ scheduleNo: '01', dueAt: '2026-06-01T00:00:00.000Z', amount: 59999 }]);
    assert.equal(wrongTotal.status, 400);
    assert.equal(wrongTotal.body.error.code, 'PAYABLE_SCHEDULE_TOTAL_MISMATCH', '各期合计必须等于应付净额');

    const firstInstallment = (twoInstallments.body.data.schedules as { id: string }[])[0];
    assert.ok(firstInstallment, '重排后应返回两期分期');
    const payFirst = await call(clerk, 'POST', `${base}/payments`, {
      type: 'PROGRESS', amount: 30000, paidAt: '2026-06-02T00:00:00.000Z', referenceNo: `FP-${suffix}`,
      allocations: [{ payableId: finalPayable.id, payableScheduleId: firstInstallment.id, amount: 30000 }],
    });
    assert.equal(payFirst.status, 201, `分期付款应成功：${JSON.stringify(payFirst.body).slice(0, 200)}`);

    const lockedReschedule = await reschedule([{ scheduleNo: '01', dueAt: '2026-08-01T00:00:00.000Z', amount: 30000 }]);
    assert.equal(lockedReschedule.status, 409);
    assert.equal(lockedReschedule.body.error.code, 'PAYABLE_SCHEDULE_LOCKED_AFTER_PAYMENT', '已发生付款后不得重排分期');

    // —— 13. 供应商发票与应付核销 ——
    const invoice = await call(clerk, 'POST', `${base}/invoices`, { invoiceNo: `INV-${suffix}`, invoiceDate: '2026-05-10T00:00:00.000Z', amount: 400000, taxAmount: 0, taxIncluded: true });
    assert.equal(invoice.status, 201, `发票登记应成功：${JSON.stringify(invoice.body).slice(0, 200)}`);
    assert.equal(invoice.body.data.status, 'RECEIVED');
    const invoiceId = invoice.body.data.id as string;
    const allocateInvoice = (amount: number, payableId: string) => call(clerk, 'POST', `${base}/invoices/${invoiceId}/allocations`, { amount, payableId });

    const beforeVerify = await allocateInvoice(50000, payable2.id);
    assert.equal(beforeVerify.status, 409);
    assert.equal(beforeVerify.body.error.code, 'INVOICE_MUST_BE_VERIFIED', '未核验的发票不能去核销应付');

    const verified = await call(clerk, 'POST', `${base}/invoices/${invoiceId}/verify`, { status: 'VERIFIED' });
    assert.equal(verified.status, 200);

    const allocatePayable2 = await allocateInvoice(200000, payable2.id);
    assert.equal(allocatePayable2.status, 201, `按应付全额核销发票应成功：${JSON.stringify(allocatePayable2.body).slice(0, 240)}`);

    const exceedsPayable = await allocateInvoice(50000, payable2.id);
    assert.equal(exceedsPayable.status, 409);
    assert.equal(exceedsPayable.body.error.code, 'INVOICE_ALLOCATION_EXCEEDS_PAYABLE', '同一应付不能重复开票超过其毛额');

    const exceedsInvoice = await allocateInvoice(250000, payable1.id);
    assert.equal(exceedsInvoice.status, 409);
    assert.equal(exceedsInvoice.body.error.code, 'INVOICE_ALLOCATION_EXCEEDS_INVOICE');

    const finalOverview = await call(clerk, 'GET', `/api/projects/${project.id}/downstream-finance`);
    const finalRow = (finalOverview.body.data.items as { id: string; invoiceAmount: number; verifiedInvoiceAmount: number }[]).find((item) => item.id === contractId);
    assert.equal(toCents(finalRow?.invoiceAmount), 40000000n, '发票总额应计入合同汇总');
    assert.equal(toCents(finalRow?.verifiedInvoiceAmount), 40000000n, '核验后的发票才计入已核验口径');
  } finally {
    await app.close().catch(() => undefined);
    try {
    if (projectId) {
      const contracts = await prisma.downstreamContract.findMany({ where: { projectId }, select: { id: true } });
      const contractIds = contracts.map((row) => row.id);
      if (contractIds.length) {
        const settlementIds = (await prisma.downstreamContractSettlement.findMany({ where: { downstreamContractId: { in: contractIds } }, select: { id: true } })).map((row) => row.id);
        await prisma.downstreamInvoiceAllocation.deleteMany({ where: { OR: [{ invoice: { downstreamContractId: { in: contractIds } } }, { payable: { downstreamContractId: { in: contractIds } } }] } }).catch(() => undefined);
        await prisma.downstreamSupplierInvoice.deleteMany({ where: { downstreamContractId: { in: contractIds } } }).catch(() => undefined);
        await prisma.downstreamPaymentAllocation.deleteMany({ where: { OR: [{ payment: { downstreamContractId: { in: contractIds } } }, { payable: { downstreamContractId: { in: contractIds } } }] } }).catch(() => undefined);
        await prisma.downstreamPayableSchedule.deleteMany({ where: { payable: { downstreamContractId: { in: contractIds } } } }).catch(() => undefined);
        await prisma.downstreamPayable.deleteMany({ where: { downstreamContractId: { in: contractIds } } }).catch(() => undefined);
        await prisma.downstreamSettlementPosting.deleteMany({ where: { downstreamContractId: { in: contractIds } } }).catch(() => undefined);
        await prisma.downstreamRetentionMovement.deleteMany({ where: { downstreamContractId: { in: contractIds } } }).catch(() => undefined);
        if (settlementIds.length) await prisma.downstreamSettlementLine.deleteMany({ where: { settlementId: { in: settlementIds } } }).catch(() => undefined);
        await prisma.downstreamContractSettlement.deleteMany({ where: { downstreamContractId: { in: contractIds } } }).catch(() => undefined);
        await prisma.downstreamContractPayment.deleteMany({ where: { downstreamContractId: { in: contractIds } } }).catch(() => undefined);
        await prisma.downstreamContractAdjustment.deleteMany({ where: { downstreamContractId: { in: contractIds } } }).catch(() => undefined);
        await prisma.downstreamContract.deleteMany({ where: { id: { in: contractIds } } }).catch(() => undefined);
      }
      await prisma.auditLog.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    }
    await prisma.businessParty.deleteMany({ where: { name: { contains: `结算测试单位 ${suffix}` } } }).catch(() => undefined);
    for (const userId of userIds) {
      await prisma.authSession.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    } catch (error) {
      // 清理失败不能盖住真正的断言错误
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
