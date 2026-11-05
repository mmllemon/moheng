/**
 * 业主结算过账的路由级回归（真实 PostgreSQL）。
 *
 * 背景：全仓此前只有两个 .integration.test.ts（助手恢复、报表数据），财务写链路一条路由级
 * 回归都没有。这个文件先用一条链路把「钱写入以后对不对」钉住：业主最终结算与调整单的
 * 过账、负向差额的拦截、应收/过账记录/审计的原子性、以及重读后余额。
 *
 * 与 owner-settlement-math.test.ts 的分工：那个测的是纯函数（BigInt 分运算），
 * 这个测的是路由 + 事务 + 额度校验 + 落库结果，覆盖「算对了但没写对」这类问题。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   OWNER_FINANCE_POSTING_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:owner-settlement-posting:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { ownerFinanceRoutes } from '../routes/owner-finance.js';

const enabled = process.env.OWNER_FINANCE_POSTING_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('业主结算过账：负向差额拦截、应收与审计原子性、重读余额', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(ownerFinanceRoutes, { prefix: '/api/projects' });
  await app.ready();

  const userIds: string[] = [];
  let projectId: string | undefined;
  let mainContractId: string | undefined;

  /** 建一个能通过 authRequired 的用户（真实会话行 + 签名 JWT），返回请求头 */
  async function makeActor(label: string) {
    const user = await prisma.user.create({ data: {
      name: `Owner Fixture ${label} ${suffix}`,
      email: `owner-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role: 'ADMIN',
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: {
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    return { status: response.statusCode, body: response.json() };
  };
  /** DTO 里金额是 JSON number，这条链路断言统一归一到“分”再比，避免 1000000 与 '1000000.00' 的写法差异。 */
  const toCents = (value: unknown) => BigInt(Math.round(Number(value ?? 0) * 100));

  try {
    const clerk = await makeActor('clerk');
    const reviewer = await makeActor('reviewer');

    const project = await prisma.project.create({ data: {
      name: `Owner Posting ${suffix}`,
      code: `OPS-${suffix}`,
      ownerName: 'Gate Owner',
      contractAmount: '1000000.00',
      originalContractAmount: '1000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectId = project.id;
    const mainContract = await prisma.mainContract.create({ data: {
      projectId: project.id,
      contractNo: `MC-${suffix}`,
      name: '主合同',
      amount: '1000000.00',
      signedAt: new Date('2026-01-01T00:00:00.000Z'),
    } });
    mainContractId = mainContract.id;

    /** 建单 → 提交 → 审核（不同人）→ 外部确认，返回结算单号与 id */
    async function prepareSettlement(input: {
      type: 'FINAL' | 'ADJUSTMENT';
      submittedAmount: number;
      confirmedAmount: number;
      deductions?: { advance?: number; retention?: number; other?: number };
    }) {
      const created = await call(clerk, 'POST', `/api/projects/${project.id}/owner-finance/settlements`, {
        type: input.type, submittedAmount: input.submittedAmount, lines: [],
        dueAt: '2026-06-30T00:00:00.000Z',
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const settlementId = created.body.data.id as string;

      assert.equal((await call(clerk, 'POST', `/api/projects/${project.id}/owner-finance/settlements/${settlementId}/action`, { action: 'SUBMIT' })).status, 200);
      assert.equal((await call(reviewer, 'POST', `/api/projects/${project.id}/owner-finance/settlements/${settlementId}/action`, { action: 'APPROVE' })).status, 200);
      const confirmed = await call(clerk, 'POST', `/api/projects/${project.id}/owner-finance/settlements/${settlementId}/action`, {
        action: 'CONFIRM',
        confirmedAmount: input.confirmedAmount,
        confirmationReference: `REF-${suffix}`,
        confirmedAt: '2026-05-31T00:00:00.000Z',
        dueAt: '2026-06-30T00:00:00.000Z',
        advanceDeductionAmount: input.deductions?.advance ?? 0,
        retentionAmount: input.deductions?.retention ?? 0,
        otherDeductionAmount: input.deductions?.other ?? 0,
      });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      return settlementId;
    }

    const countPostedState = async (settlementId: string) => ({
      receivables: await prisma.ownerReceivable.count({ where: { projectId: project.id } }),
      postings: await prisma.ownerSettlementPosting.count({ where: { settlementId } }),
      postedAudits: await prisma.auditLog.count({ where: { entityId: settlementId, action: 'OWNER_SETTLEMENT_POSTED' } }),
    });

    // ---- 1. 首次最终结算：100 万，无扣款 ----
    const finalId = await prepareSettlement({ type: 'FINAL', submittedAmount: 1000000, confirmedAmount: 1000000 });
    const finalPost = await call(clerk, 'POST', `/api/projects/${project.id}/owner-finance/settlements/${finalId}/action`, { action: 'POST' });
    assert.equal(finalPost.status, 200, JSON.stringify(finalPost.body));
    assert.equal(finalPost.body.data.status, 'POSTED');
    assert.equal(toCents(finalPost.body.data.postedDeltaAmount), 100000000n);
    assert.equal(toCents(finalPost.body.data.cumulativeAfterAmount), 100000000n);
    const afterFinal = await countPostedState(finalId);
    assert.deepEqual(afterFinal, { receivables: 1, postings: 1, postedAudits: 1 });

    const finalReceivable = await prisma.ownerReceivable.findFirstOrThrow({ where: { sourceSettlementId: finalId } });
    assert.equal(finalReceivable.netAmount.toFixed(2), '1000000.00');
    assert.equal(finalReceivable.grossAmount.toFixed(2), '1000000.00');
    assert.equal(finalReceivable.status, 'OPEN');

    // ---- 2. 负向调整：-5 万，无扣款 → 允许，生成负向应收 ----
    const creditId = await prepareSettlement({ type: 'ADJUSTMENT', submittedAmount: -50000, confirmedAmount: -50000 });
    const creditPost = await call(clerk, 'POST', `/api/projects/${project.id}/owner-finance/settlements/${creditId}/action`, { action: 'POST' });
    assert.equal(creditPost.status, 200, JSON.stringify(creditPost.body));
    assert.equal(creditPost.body.data.status, 'POSTED');
    assert.equal(toCents(creditPost.body.data.postedDeltaAmount), -5000000n);
    assert.equal(toCents(creditPost.body.data.cumulativeAfterAmount), 95000000n);
    const creditReceivable = await prisma.ownerReceivable.findFirstOrThrow({ where: { sourceSettlementId: creditId } });
    assert.equal(creditReceivable.grossAmount.toFixed(2), '-50000.00');
    assert.equal(creditReceivable.netAmount.toFixed(2), '-50000.00');
    const posting = await prisma.ownerSettlementPosting.findFirstOrThrow({ where: { settlementId: creditId } });
    assert.equal(posting.previousCumulativeAmount.toFixed(2), '1000000.00');
    assert.equal(posting.cumulativeAfterAmount.toFixed(2), '950000.00');

    // ---- 3. 负向差额带扣款 → 400，且一行都不许写 ----
    const blockedId = await prepareSettlement({ type: 'ADJUSTMENT', submittedAmount: -10000, confirmedAmount: -10000, deductions: { other: 1000 } });
    const beforeBlocked = await countPostedState(blockedId);
    const blockedPost = await call(clerk, 'POST', `/api/projects/${project.id}/owner-finance/settlements/${blockedId}/action`, { action: 'POST' });
    assert.equal(blockedPost.status, 400, JSON.stringify(blockedPost.body));
    assert.equal(blockedPost.body.error.code, 'NEGATIVE_DELTA_DEDUCTIONS');
    assert.deepEqual(await countPostedState(blockedId), beforeBlocked, '拒绝后不得留下应收、过账记录或审计');
    assert.equal((await prisma.ownerContractSettlement.findUniqueOrThrow({ where: { id: blockedId } })).status, 'COUNTERPARTY_CONFIRMED');

    // ---- 4. 正向调整但扣款超过增量 → 400，同样不留痕 ----
    const overDeductId = await prepareSettlement({ type: 'ADJUSTMENT', submittedAmount: 10000, confirmedAmount: 10000, deductions: { other: 10001 } });
    const beforeOver = await countPostedState(overDeductId);
    const overPost = await call(clerk, 'POST', `/api/projects/${project.id}/owner-finance/settlements/${overDeductId}/action`, { action: 'POST' });
    assert.equal(overPost.status, 400, JSON.stringify(overPost.body));
    assert.equal(overPost.body.error.code, 'DEDUCTIONS_EXCEED_DELTA');
    assert.deepEqual(await countPostedState(overDeductId), beforeOver);

    // ---- 5. 同一结算单不得重复过账 ----
    const repeat = await call(clerk, 'POST', `/api/projects/${project.id}/owner-finance/settlements/${finalId}/action`, { action: 'POST' });
    assert.equal(repeat.status, 409, JSON.stringify(repeat.body));
    assert.equal(repeat.body.error.code, 'INVALID_STATUS_TRANSITION');

    // ---- 6. 重读余额：应收净额合计 = 95 万，且累计与过账记录一致 ----
    const overview = await call(clerk, 'GET', `/api/projects/${project.id}/owner-finance`);
    assert.equal(overview.status, 200, JSON.stringify(overview.body));
    const receivables = await prisma.ownerReceivable.findMany({ where: { projectId: project.id }, orderBy: { receivableNo: 'asc' } });
    assert.equal(receivables.length, 2);
    const netTotal = receivables.reduce((sum, row) => sum + BigInt(Math.round(Number(row.netAmount) * 100)), 0n);
    assert.equal(netTotal, 95000000n, '应收净额合计应为 950,000.00 元');
    // 总览是只读投影，金额回到前端是 JSON number，所以按分比
    const overviewJson = JSON.stringify(overview.body);
    assert.equal(/950000(\.0+)?/.test(overviewJson), true, `总览应回读 95 万累计，实际：${overviewJson.slice(0, 400)}`);
  } finally {
    if (projectId) {
      await prisma.ownerReceivableSchedule.deleteMany({ where: { receivable: { projectId } } }).catch(() => undefined);
      await prisma.ownerReceivable.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.ownerSettlementPosting.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.ownerAdvanceMovement.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.ownerRetentionMovement.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.ownerContractSettlement.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { projectId } }).catch(() => undefined);
      // 业务编号序列按 key 存，与项目绑定；测试项目删掉后这些 key 也该清掉
      await prisma.documentSequence.deleteMany({ where: { key: { contains: projectId } } }).catch(() => undefined);
      if (mainContractId) await prisma.mainContract.deleteMany({ where: { id: mainContractId } }).catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    }
    if (userIds.length) {
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
    await app.close();
  }
});
