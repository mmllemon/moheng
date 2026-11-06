/**
 * 质保金专项扣回的路由级回归（真实 PostgreSQL）。
 *
 * 口径（2026-11-05 由业务确认）：
 *   1. 扣回是一条独立动作 DEDUCT，只减留置余额，不生成应付，也不计入实际成本；
 *   2. 只能扣「尚未释放」的余额；已释放成应付的那部分走应付调整，不走这里；
 *   3. reference 必填，保证每笔扣回都能追到维修单或索赔函；
 *   4. 错扣用负数扣回冲回，不改历史行；冲回上限是当前已扣回净额；
 *   5. 与释放、没收共用「合同必须完成最终结算」「不得超过可用余额」「并发冲突 409」三条规则。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   RETENTION_DEDUCTION_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:retention-deduction:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { downstreamFinanceRoutes } from '../routes/downstream-finance.js';

const enabled = process.env.RETENTION_DEDUCTION_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('质保金专项扣回：只扣未释放余额、不生成应付、负数冲回有上限、并发只成功一笔', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(downstreamFinanceRoutes, { prefix: '/api/projects' });
  await app.ready();

  const userIds: string[] = [];
  const projectIds: string[] = [];

  async function makeActor(label: string) {
    const user = await prisma.user.create({ data: {
      name: `Retention Fixture ${label} ${suffix}`,
      email: `retention-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role: 'USER',
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    const text = typeof response.body === 'string' ? response.body : '';
    let body: any = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } }
    return { status: response.statusCode, body };
  };

  const toCents = (value: unknown) => BigInt(Math.round(Number(value ?? 0) * 100));

  try {
    const owner = await makeActor('owner');

    const project = await prisma.project.create({ data: {
      name: `Retention Project ${suffix}`,
      code: `RET-${suffix}`.slice(0, 40),
      ownerName: `质保业主${suffix}`.slice(0, 60),
      contractAmount: '2000000.00',
      originalContractAmount: '2000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectIds.push(project.id);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: owner.userId, role: 'OWNER' } });

    async function makeContract(label: string, status: 'ACTIVE' | 'SETTLED', retained: string) {
      const contract = await prisma.downstreamContract.create({ data: {
        projectId: project.id, contractNo: `RC-${label}-${suffix}`.slice(0, 40), name: `质保合同 ${label}`,
        type: 'LABOR_SUBCONTRACT', counterpartyName: `质保分包${label}${suffix}`.slice(0, 60),
        originalAmount: '500000.00', status, signedAt: new Date('2026-01-05T00:00:00.000Z'), createdById: owner.userId,
      } });
      if (Number(retained) > 0) {
        await prisma.downstreamRetentionMovement.create({ data: {
          downstreamContractId: contract.id, type: 'RETAIN', amount: retained,
          effectiveAt: new Date('2026-06-01T00:00:00.000Z'), reference: `RES-${label}-${suffix}`.slice(0, 60), createdById: owner.userId,
        } });
      }
      return contract;
    }

    const base = (contractId: string) => `/api/projects/${project.id}/downstream-contracts/${contractId}/retention`;
    const deductBody = (amount: number, extra: Record<string, unknown> = {}) => ({ amount, effectiveAt: '2026-07-01T00:00:00.000Z', reference: `WO-${suffix}`.slice(0, 60), ...extra });

    // ———————————————— A. 主流程：扣回、超额拒绝、冲回、冲回上限 ————————————————
    const contractA = await makeContract('A', 'SETTLED', '100000.00');

    const deduct1 = await call(owner, 'POST', `${base(contractA.id)}/deduct`, deductBody(30000));
    assert.equal(deduct1.status, 201, `扣回应成功：${JSON.stringify(deduct1.body).slice(0, 300)}`);
    assert.equal(toCents(deduct1.body.data.movement.amount), 3000000n);
    assert.equal(deduct1.body.data.payable, null, '专项扣回不生成应付');
    assert.equal(await prisma.downstreamPayable.count({ where: { downstreamContractId: contractA.id } }), 0, '扣回不得留下应付单');
    const deductAudit = await prisma.auditLog.findFirst({ where: { entity: 'DownstreamRetentionMovement', entityId: deduct1.body.data.movement.id, action: 'RETENTION_DEDUCTED' } });
    assert.ok(deductAudit, '扣回应写 RETENTION_DEDUCTED 审计');
    assert.equal((deductAudit.changes as Record<string, unknown>).remainingBalance, '70000.00');

    const overdraft = await call(owner, 'POST', `${base(contractA.id)}/deduct`, deductBody(80000));
    assert.equal(overdraft.status, 409);
    assert.equal(overdraft.body.error.code, 'RETENTION_AMOUNT_EXCEEDS_BALANCE');

    const reverse1 = await call(owner, 'POST', `${base(contractA.id)}/deduct`, deductBody(-10000, { reference: `RV-${suffix}`.slice(0, 60) }));
    assert.equal(reverse1.status, 201, `红字冲回应成功：${JSON.stringify(reverse1.body).slice(0, 300)}`);
    const reverseAudit = await prisma.auditLog.findFirst({ where: { entity: 'DownstreamRetentionMovement', entityId: reverse1.body.data.movement.id, action: 'RETENTION_DEDUCTION_REVERSED' } });
    assert.ok(reverseAudit, '冲回应写 RETENTION_DEDUCTION_REVERSED 审计');

    const overReverse = await call(owner, 'POST', `${base(contractA.id)}/deduct`, deductBody(-20001));
    assert.equal(overReverse.status, 409);
    assert.equal(overReverse.body.error.code, 'RETENTION_DEDUCTION_REVERSES_EXCEEDED');

    // ———————————————— B. 已释放成应付的部分不能再扣 ————————————————
    const release = await call(owner, 'POST', `${base(contractA.id)}/release`, { amount: 80000, effectiveAt: '2026-07-05T00:00:00.000Z', reference: `REL-${suffix}`.slice(0, 60) });
    assert.equal(release.status, 201, `释放应成功：${JSON.stringify(release.body).slice(0, 300)}`);
    assert.equal(await prisma.downstreamPayable.count({ where: { downstreamContractId: contractA.id } }), 1, '释放生成一张应付');

    const deductAfterRelease = await call(owner, 'POST', `${base(contractA.id)}/deduct`, deductBody(1));
    assert.equal(deductAfterRelease.status, 409);
    assert.equal(deductAfterRelease.body.error.code, 'RETENTION_AMOUNT_EXCEEDS_BALANCE', '余额已释放完，不能再扣');

    // 冲回不受「余额为 0」限制，它恢复的是之前扣掉的那部分
    const reverseAfterRelease = await call(owner, 'POST', `${base(contractA.id)}/deduct`, deductBody(-5000));
    assert.equal(reverseAfterRelease.status, 201, `已释放完仍可冲回已扣回金额：${JSON.stringify(reverseAfterRelease.body).slice(0, 300)}`);

    // ———————————————— C. 未完成最终结算的合同不能扣回 ————————————————
    const contractB = await makeContract('B', 'ACTIVE', '100000.00');
    const notSettled = await call(owner, 'POST', `${base(contractB.id)}/deduct`, deductBody(1000));
    assert.equal(notSettled.status, 409);
    assert.equal(notSettled.body.error.code, 'RETENTION_REQUIRES_FINAL_SETTLEMENT');

    // ———————————————— D. 输入校验 ————————————————
    const missingReference = await call(owner, 'POST', `${base(contractB.id)}/deduct`, { amount: 1000, effectiveAt: '2026-07-01T00:00:00.000Z' });
    assert.equal(missingReference.status, 400);
    assert.equal(missingReference.body.error.code, 'VALIDATION_ERROR');
    const zeroAmount = await call(owner, 'POST', `${base(contractA.id)}/deduct`, deductBody(0));
    assert.equal(zeroAmount.status, 400, '金额为 0 应被拒');
    assert.equal(zeroAmount.body.error.code, 'VALIDATION_ERROR');

    // ———————————————— E. 并发：两笔各 6 万抢 10 万余额，只成功一笔 ————————————————
    const contractC = await makeContract('C', 'SETTLED', '100000.00');
    const [raceA, raceB] = await Promise.all([
      call(owner, 'POST', `${base(contractC.id)}/deduct`, deductBody(60000)),
      call(owner, 'POST', `${base(contractC.id)}/deduct`, deductBody(60000, { reference: `WO2-${suffix}`.slice(0, 60) })),
    ]);
    const accepted = [raceA, raceB].filter((row) => row.status === 201);
    assert.equal(accepted.length, 1, `并发扣回只应成功一笔，实际 ${JSON.stringify([raceA.status, raceB.status])}`);
    assert.equal([raceA, raceB].filter((row) => row.status === 409).length, 1, '另一笔应被余额校验拦下或报并发冲突');
    const movementsC = await prisma.downstreamRetentionMovement.findMany({ where: { downstreamContractId: contractC.id } });
    const balanceC = movementsC.reduce((sum, row) => sum + (row.type === 'RETAIN' ? toCents(row.amount) : -toCents(row.amount)), 0n);
    assert.equal(balanceC, 4000000n, '并发后余额应为 10 万减 6 万');

    // ———————————————— F. 台账 DTO 口径 ————————————————
    const finance = await call(owner, 'GET', `/api/projects/${project.id}/downstream-finance`);
    assert.equal(finance.status, 200, `台账应可读：${JSON.stringify(finance.body).slice(0, 200)}`);
    const rowA = (finance.body.data.items as Array<{ id: string; retentionBalanceAmount: number; retentionDeductedAmount: number }>).find((row) => row.id === contractA.id);
    assert.ok(rowA, '台账应包含合同 A');
    assert.equal(toCents(rowA.retentionBalanceAmount), 500000n, '余额 = 10 万 - 扣回 3 万 + 冲回 1 万 - 释放 8 万 + 冲回 5 千');
    assert.equal(toCents(rowA.retentionDeductedAmount), 1500000n, '已扣回净额 = 3 万 - 冲回 1 万 - 冲回 5 千');
  } finally {
    await app.close();
    try {
      for (const projectId of projectIds) {
        const contracts = await prisma.downstreamContract.findMany({ where: { projectId }, select: { id: true } });
        const contractIds = contracts.map((row) => row.id);
        const payables = await prisma.downstreamPayable.findMany({ where: { downstreamContractId: { in: contractIds } }, select: { id: true } });
        const payableIds = payables.map((row) => row.id);
        await prisma.downstreamPayableSchedule.deleteMany({ where: { payableId: { in: payableIds } } }).catch(() => undefined);
        await prisma.downstreamPayable.deleteMany({ where: { id: { in: payableIds } } }).catch(() => undefined);
        await prisma.downstreamRetentionMovement.deleteMany({ where: { downstreamContractId: { in: contractIds } } }).catch(() => undefined);
        await prisma.downstreamContract.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      const ids = userIds;
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
      await prisma.authSession.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    } catch (error) {
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
