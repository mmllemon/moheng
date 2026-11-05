/**
 * 金额精度的端到端契约：录入 → 存库 → 读出 → 汇总，逐分不差。
 *
 * 为什么单独一条：服务端内部用 BigInt 分，前端也改成按分比较，但中间那一跳是 JSON number。
 * 这条测试就是把那一跳量出来——用真实路由写入、真实 PostgreSQL 存、再把 DTO 读回来，
 * 逐个核对到分，并确认服务端聚合（`analysis/three-way` 的 actualCost，由数据库 SUM 得值）
 * 与客户端按分累加的结果一致。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   MONEY_ROUNDTRIP_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:money-roundtrip:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { costRoutes } from '../routes/costs.js';
import { analysisRoutes } from '../routes/analysis.js';

const enabled = process.env.MONEY_ROUNDTRIP_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('金额端到端：录入、存库、DTO 读出、服务端聚合逐分一致', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(costRoutes, { prefix: '/api/projects' });
  await app.register(analysisRoutes, { prefix: '/api' });
  await app.ready();

  const toCents = (value: unknown): bigint => {
    const text = String(value);
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    assert.ok(match, `金额不是两位小数的数值/字符串：${text}`);
    const [, sign, whole, fraction] = match as RegExpExecArray;
    return (sign === '-' ? -1n : 1n) * (BigInt(whole ?? '0') * 100n + BigInt((fraction ?? '').padEnd(2, '0')));
  };
  const centsToMoney = (cents: bigint) => {
    const sign = cents < 0n ? '-' : '';
    const value = cents < 0n ? -cents : cents;
    return `${sign}${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
  };

  let userId: string | undefined;
  let projectId: string | undefined;

  try {
    const user = await prisma.user.create({ data: {
      name: `Money Roundtrip ${suffix}`,
      email: `money-roundtrip-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role: 'ADMIN',
    } });
    userId = user.id;
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id })}` };

    const project = await prisma.project.create({ data: {
      name: `Money Roundtrip ${suffix}`,
      code: `MRT-${suffix}`,
      ownerName: 'Gate Owner',
      contractAmount: '1000000.00',
      originalContractAmount: '1000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectId = project.id;

    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/api/projects/${project.id}/costs`, headers, payload });

    // ---- 1. 四个刻意挑的量：最小单位、跨零位、大额带分 ----
    const inputs = ['0.01', '0.02', '1234567890.12', '99999999.99'];
    for (const amount of inputs) {
      const response = await post({ type: 'MATERIAL', date: '2026-03-01T00:00:00.000Z', amount: Number(amount), description: `roundtrip ${amount}` });
      assert.equal(response.statusCode, 201, `写入 ${amount} 应为 201，实际 ${response.statusCode}：${response.body}`);
    }

    // ---- 2. 存库：Decimal 文本必须等于录入值 ----
    const stored = await prisma.costEntry.findMany({ where: { projectId: project.id }, orderBy: { amount: 'asc' }, select: { amount: true, description: true } });
    assert.equal(stored.length, inputs.length);
    const storedText = stored.map((row) => row.amount.toFixed(2)).sort();
    assert.deepEqual(storedText, [...inputs].sort(), '库里的 Decimal 必须与录入的两位小数逐字相等');

    // ---- 3. DTO 读出：JSON number 往返后仍精确到分 ----
    const list = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/costs`, headers });
    assert.equal(list.statusCode, 200, list.body);
    const rows = list.json().data as Array<{ amount: number }>;
    assert.equal(rows.length, inputs.length);
    const readBack = rows.map((row) => centsToMoney(toCents(row.amount))).sort();
    assert.deepEqual(readBack, [...inputs].sort(), 'HTTP DTO 读回的金额必须逐分等于录入值');
    for (const row of rows) {
      const transported = JSON.parse(JSON.stringify({ amount: row.amount })).amount as number;
      assert.equal(centsToMoney(toCents(transported)), centsToMoney(toCents(row.amount)), 'JSON.stringify 往返不得改变金额');
    }

    // ---- 4. 聚合：数据库 SUM 出来的 actualCost 与客户端按分累加一致 ----
    const expected = inputs.reduce((sum, amount) => sum + toCents(amount), 0n);
    assert.equal(centsToMoney(expected), '1334567890.14');
    const threeWay = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/analysis/three-way`, headers });
    assert.equal(threeWay.statusCode, 200, threeWay.body);
    const actualCost = (threeWay.json().data as { actualCost: unknown }).actualCost;
    assert.equal(toCents(actualCost), expected, `服务端聚合应为 ${centsToMoney(expected)}，实际 ${String(actualCost)}`);
    const clientSum = rows.reduce((sum, row) => sum + toCents(row.amount), 0n);
    assert.equal(clientSum, expected);

    // ---- 5. 边界拒绝：亚分、超传输上限、零与负数 ----
    const subCent = await post({ type: 'MATERIAL', date: '2026-03-01T00:00:00.000Z', amount: 1.005, description: 'sub-cent' });
    assert.equal(subCent.statusCode, 400, subCent.body);
    assert.equal(subCent.json().error.code, 'VALIDATION_ERROR');

    const overTransport = await post({ type: 'MATERIAL', date: '2026-03-01T00:00:00.000Z', amount: 90071992547409.92, description: 'over transport range' });
    assert.equal(overTransport.statusCode, 400, overTransport.body);

    for (const invalid of [0, -1]) {
      const response = await post({ type: 'MATERIAL', date: '2026-03-01T00:00:00.000Z', amount: invalid, description: `invalid ${invalid}` });
      assert.equal(response.statusCode, 400, `金额 ${invalid} 应被拒绝：${response.body}`);
    }

    // 拒绝之后库里仍然只有最初四条
    assert.equal(await prisma.costEntry.count({ where: { projectId: project.id } }), inputs.length);
  } finally {
    if (projectId) {
      await prisma.costEntry.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
    }
    if (userId) {
      await prisma.authSession.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    }
    await app.close();
  }
});
