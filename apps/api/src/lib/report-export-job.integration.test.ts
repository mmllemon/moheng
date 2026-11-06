/**
 * 报表 XLSX 导出任务的路由级回归（真实 PostgreSQL）。
 *
 * 导出是异步任务，用户点两次「导出」很常见，也可能因为网络重试把同一个请求发两遍。
 * 所以这条链路上最贵的错误不是导出失败，而是「同一次导出排了两次队」或
 * 「不同范围的导出被当成同一次复用」。前者浪费算力、后者给错数据。
 *
 * 这里的核心是幂等键的三种行为：
 *   - 同键 + 同请求 → 复用同一个任务，返回 idempotentReplay；
 *   - 同键 + 不同请求 → 409 IDEMPOTENCY_KEY_REUSED，绝不把旧任务当新请求的结果；
 *   - 唯一约束是 (ownerUserId, idempotencyKey)，不同用户可以用同一个键。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   REPORT_EXPORT_JOB_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:report-export-job:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { reportStudioRoutes } from '../routes/report-studio.js';
import { reportRoutes } from '../routes/reports.js';

const enabled = process.env.REPORT_EXPORT_JOB_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('报表导出任务：幂等复用、键冲突、跨用户唯一性、范围校验与任务读取权限', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(reportStudioRoutes, { prefix: '/api/reports/studio' });
  await app.register(reportRoutes, { prefix: '/api/reports' });
  await app.ready();

  const userIds: string[] = [];
  const projectIds: string[] = [];

  async function makeActor(label: string, role: 'ADMIN' | 'USER' = 'USER') {
    const user = await prisma.user.create({ data: {
      name: `Export Fixture ${label} ${suffix}`,
      email: `export-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role,
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>, extraHeaders: Record<string, string> = {}) => {
    const response = await app.inject({ method, url, headers: { ...actor.headers, ...extraHeaders }, ...(payload === undefined ? {} : { payload }) });
    const text = typeof response.body === 'string' ? response.body : '';
    let body: any = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } }
    return { status: response.statusCode, body };
  };

  const definition = (domain: 'PROJECT' | 'COMPANY', title: string) => ({
    schemaVersion: 2,
    domain,
    title,
    description: '',
    workbook: {
      sheetOrder: ['sheet-1'],
      sheets: { 'sheet-1': { id: 'sheet-1', name: '报表', rowCount: 50, columnCount: 10, cellData: { 0: { 0: { v: title } } } } },
    },
    bindings: [],
    regions: [],
    page: { paper: 'A4', orientation: 'landscape', fitToWidth: true, includeMetadata: true, footerText: '墨衡工程经营管理系统' },
  });

  try {
    const owner = await makeActor('owner');
    const other = await makeActor('other');
    const admin = await makeActor('admin', 'ADMIN');

    const project = await prisma.project.create({ data: {
      name: `Export Project ${suffix}`,
      code: `EXP-${suffix}`.slice(0, 40),
      ownerName: `导出业主${suffix}`.slice(0, 60),
      contractAmount: '1000000.00',
      originalContractAmount: '1000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectIds.push(project.id);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: owner.userId, role: 'OWNER' } });

    const created = await call(owner, 'POST', '/api/reports/studio/templates', {
      domain: 'PROJECT', name: `导出模板 ${suffix}`, scope: 'PROJECT', projectId: project.id, definition: definition('PROJECT', '导出模板'),
    });
    assert.equal(created.status, 201, `建模版应成功：${JSON.stringify(created.body).slice(0, 300)}`);
    const templateId = created.body.data.id as string;
    const jobsUrl = `/api/reports/studio/templates/${templateId}/xlsx/jobs`;

    // —— 1. 无幂等键：正常排队 ——
    const first = await call(owner, 'POST', jobsUrl, {});
    assert.equal(first.status, 202, `首次导出应排队：${JSON.stringify(first.body).slice(0, 400)}`);
    assert.equal(first.body.data.status, 'QUEUED');
    const firstJobId = first.body.data.id as string;
    const firstJob = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: firstJobId } });
    assert.equal(firstJob.type, 'report.studio.xlsx.export');
    assert.equal((firstJob.payload as Record<string, unknown>).templateId, templateId);
    assert.equal((firstJob.payload as Record<string, unknown>).domain, 'PROJECT');
    assert.equal((firstJob.payload as Record<string, unknown>).projectId, project.id);
    assert.equal(firstJob.idempotencyKey, null);
    assert.ok(await prisma.auditLog.findFirst({ where: { entity: 'BackgroundJob', entityId: firstJobId, action: 'REPORT_STUDIO_XLSX_EXPORT_QUEUED' } }), '排队应写审计');

    // —— 2. 同键同请求：复用，不新建 ——
    const key = `export-key-${suffix}`;
    const keyed = await call(owner, 'POST', jobsUrl, {}, { 'idempotency-key': key });
    assert.equal(keyed.status, 202);
    const replay = await call(owner, 'POST', jobsUrl, {}, { 'idempotency-key': key });
    assert.equal(replay.status, 202, `同键重放应 202：${JSON.stringify(replay.body).slice(0, 200)}`);
    assert.equal(replay.body.data.id, keyed.body.data.id, '同键同请求应复用同一个任务');
    assert.equal(replay.body.data.idempotentReplay, true);
    assert.equal(await prisma.backgroundJob.count({ where: { ownerUserId: owner.userId, idempotencyKey: key } }), 1);

    // —— 3. 同键不同请求：拒绝，不能把旧任务当成新结果 ——
    const createdSecond = await call(owner, 'POST', '/api/reports/studio/templates', {
      domain: 'PROJECT', name: `导出模板B ${suffix}`, scope: 'PROJECT', projectId: project.id, definition: definition('PROJECT', '导出模板B'),
    });
    assert.equal(createdSecond.status, 201);
    const secondTemplateId = createdSecond.body.data.id as string;
    const reused = await call(owner, 'POST', `/api/reports/studio/templates/${secondTemplateId}/xlsx/jobs`, {}, { 'idempotency-key': key });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error.code, 'IDEMPOTENCY_KEY_REUSED');

    // —— 4. 幂等键按用户隔离：别人用同一个键可以自己排一个 ——
    // 先发布：草稿状态的项目模板连只读成员都看不到，发布后才能被别的成员导出。
    const publish = await call(owner, 'POST', `/api/reports/studio/templates/${templateId}/publish`);
    assert.equal(publish.status, 200, `发布模板应成功：${JSON.stringify(publish.body).slice(0, 200)}`);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: other.userId, role: 'VIEWER' } });
    const otherSameKey = await call(other, 'POST', jobsUrl, {}, { 'idempotency-key': key });
    assert.equal(otherSameKey.status, 202, `不同用户用同一键应各自排队：${JSON.stringify(otherSameKey.body).slice(0, 200)}`);
    assert.notEqual(otherSameKey.body.data.id, keyed.body.data.id);
    assert.equal(await prisma.backgroundJob.count({ where: { idempotencyKey: key } }), 2);

    // —— 5. 非法幂等键 ——
    const badKey = await call(owner, 'POST', jobsUrl, {}, { 'idempotency-key': `bad\nkey-${suffix}` });
    assert.equal(badKey.status, 400);
    assert.equal(badKey.body.error.code, 'IDEMPOTENCY_KEY_INVALID');

    // —— 6. 并发同键：只应产生一个任务 ——
    const concurrentKey = `concurrent-${suffix}`;
    const [raceA, raceB] = await Promise.all([
      call(owner, 'POST', jobsUrl, {}, { 'idempotency-key': concurrentKey }),
      call(owner, 'POST', jobsUrl, {}, { 'idempotency-key': concurrentKey }),
    ]);
    assert.equal(await prisma.backgroundJob.count({ where: { ownerUserId: owner.userId, idempotencyKey: concurrentKey } }), 1, '并发同键只能落一条任务');
    assert.deepEqual([raceA.status, raceB.status].sort(), [202, 202], `两个请求都应得到 202，实际 ${JSON.stringify([raceA.status, raceB.status])}`);
    assert.equal(raceA.body.data.id, raceB.body.data.id, '两个请求应指向同一个任务');

    // —— 7. 范围校验：项目模板不能拿去导别的项目 ——
    const otherProject = await prisma.project.create({ data: {
      name: `Export Project B ${suffix}`,
      code: `EXPB-${suffix}`.slice(0, 40),
      ownerName: `导出业主B${suffix}`.slice(0, 60),
      contractAmount: '500000.00',
      originalContractAmount: '500000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectIds.push(otherProject.id);
    await prisma.projectMember.create({ data: { projectId: otherProject.id, userId: owner.userId, role: 'OWNER' } });
    const mismatch = await call(owner, 'POST', jobsUrl, { projectId: otherProject.id });
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.body.error.code, 'REPORT_TEMPLATE_PROJECT_MISMATCH');

    // —— 8. 任务读取与下载：仅所有者与管理员可见，未完成不能下载 ——
    const ownStatus = await call(owner, 'GET', `/api/reports/jobs/${firstJobId}`);
    assert.equal(ownStatus.status, 200);
    assert.equal(ownStatus.body.data.status, 'QUEUED');
    assert.equal(ownStatus.body.data.resultAvailable, false);
    assert.equal(ownStatus.body.data.downloadUrl, null);

    const strangerStatus = await call(other, 'GET', `/api/reports/jobs/${firstJobId}`);
    assert.equal(strangerStatus.status, 404, '其他账号看不到别人的任务');
    assert.equal(strangerStatus.body.error.code, 'BACKGROUND_JOB_NOT_FOUND');

    const adminStatus = await call(admin, 'GET', `/api/reports/jobs/${firstJobId}`);
    assert.equal(adminStatus.status, 200, '管理员可查看任意任务');

    const earlyDownload = await call(owner, 'GET', `/api/reports/jobs/${firstJobId}/download`);
    assert.equal(earlyDownload.status, 409);
    assert.equal(earlyDownload.body.error.code, 'BACKGROUND_JOB_RESULT_NOT_READY');

    const strangerDownload = await call(other, 'GET', `/api/reports/jobs/${firstJobId}/download`);
    assert.equal(strangerDownload.status, 404);
  } finally {
    await app.close();
    try {
      for (const projectId of projectIds) {
        await prisma.backgroundJob.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.reportTemplateRevision.deleteMany({ where: { template: { projectId } } }).catch(() => undefined);
        await prisma.reportTemplate.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      const ids = userIds;
      await prisma.backgroundJob.deleteMany({ where: { ownerUserId: { in: ids } } }).catch(() => undefined);
      await prisma.reportTemplateRevision.deleteMany({ where: { createdById: { in: ids } } }).catch(() => undefined);
      await prisma.reportTemplate.deleteMany({ where: { createdById: { in: ids } } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
      await prisma.authSession.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
      await prisma.businessParty.deleteMany({ where: { name: { startsWith: '导出业主' } } }).catch(() => undefined);
    } catch (error) {
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
