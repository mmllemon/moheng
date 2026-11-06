/**
 * 综合报表模板的版本与发布回归（真实 PostgreSQL）。
 *
 * 模板是「两个人同时改同一张报表」最容易丢工作的地方：接口用 expectedVersion
 * 做乐观锁，先比对再 updateMany 再比对影响行数，两道都在。这里把两道都真的跑一遍，
 * 包括两个请求同时拿着同一个版本号提交的场景。
 *
 * 还有两条容易被忽略的口径：
 *   - 模板不能改范围（项目级不能改成公司级），要改只能复制成新模板；
 *   - 已发布的模板给「无编辑权的人」看到的是 publishedDefinition，不是未发布的草稿定义。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   REPORT_TEMPLATE_VERSION_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:report-template-version:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { reportStudioRoutes } from '../routes/report-studio.js';

const enabled = process.env.REPORT_TEMPLATE_VERSION_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('综合报表模板：乐观锁与并发、范围不可改、发布快照、归档只读与权限', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(reportStudioRoutes, { prefix: '/api/reports/studio' });
  await app.ready();

  const userIds: string[] = [];
  const projectIds: string[] = [];

  async function makeActor(label: string, role: 'ADMIN' | 'USER' = 'USER') {
    const user = await prisma.user.create({ data: {
      name: `Template Fixture ${label} ${suffix}`,
      email: `template-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role,
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    const text = typeof response.body === 'string' ? response.body : '';
    let body: any = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; } }
    return { status: response.statusCode, body };
  };

  const definition = (domain: 'PROJECT' | 'COMPANY', title: string) => ({
    schemaVersion: 2,
    domain,
    title,
    description: '',
    workbook: {
      sheetOrder: ['sheet-1'],
      sheets: {
        'sheet-1': {
          id: 'sheet-1', name: '报表', rowCount: 50, columnCount: 10,
          cellData: { 0: { 0: { v: title } } },
        },
      },
    },
    bindings: [],
    regions: [],
    page: { paper: 'A4', orientation: 'landscape', fitToWidth: true, includeMetadata: true, footerText: '墨衡工程经营管理系统' },
  });

  try {
    const admin = await makeActor('admin', 'ADMIN');
    const owner = await makeActor('owner');
    const viewer = await makeActor('viewer');
    const outsider = await makeActor('outsider');

    const project = await prisma.project.create({ data: {
      name: `Template Project ${suffix}`,
      code: `TPL-${suffix}`.slice(0, 40),
      ownerName: `模板业主${suffix}`.slice(0, 60),
      contractAmount: '1000000.00',
      originalContractAmount: '1000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    } });
    projectIds.push(project.id);
    await prisma.projectMember.createMany({ data: [
      { projectId: project.id, userId: owner.userId, role: 'OWNER' },
      { projectId: project.id, userId: viewer.userId, role: 'VIEWER' },
    ] });

    const base = '/api/reports/studio/templates';

    // —— 1. 系统模板只有管理员能建 ——
    const staffSystem = await call(owner, 'POST', base, { domain: 'COMPANY', name: '越权系统模板', scope: 'SYSTEM', definition: definition('COMPANY', '越权') });
    assert.equal(staffSystem.status, 403);
    assert.equal(staffSystem.body.error.code, 'REPORT_TEMPLATE_ADMIN_REQUIRED');

    const systemTemplate = await call(admin, 'POST', base, { domain: 'COMPANY', name: `公司经营月报 ${suffix}`, scope: 'SYSTEM', definition: definition('COMPANY', '公司经营月报') });
    assert.equal(systemTemplate.status, 201, `管理员建系统模板应成功：${JSON.stringify(systemTemplate.body).slice(0, 600)}`);
    assert.equal(systemTemplate.body.data.version, 1);
    assert.equal(systemTemplate.body.data.status, 'DRAFT');

    // —— 2. 项目模板：非成员与只读角色都不能建 ——
    const projectBody = { domain: 'PROJECT', name: '项目月报', scope: 'PROJECT', projectId: project.id, definition: definition('PROJECT', '项目月报') };
    const outsiderCreate = await call(outsider, 'POST', base, projectBody);
    assert.equal(outsiderCreate.status, 403, `非成员建项目模板应被拒：${JSON.stringify(outsiderCreate.body).slice(0, 200)}`);
    const viewerCreate = await call(viewer, 'POST', base, { ...projectBody, scope: 'PROJECT' });
    assert.equal(viewerCreate.status, 403);
    assert.equal(viewerCreate.body.error.code, 'PROJECT_REPORT_TEMPLATE_EDIT_DENIED');

    const projectTemplate = await call(owner, 'POST', base, projectBody);
    assert.equal(projectTemplate.status, 201, `项目负责人建项目模板应成功：${JSON.stringify(projectTemplate.body).slice(0, 300)}`);
    const templateId = projectTemplate.body.data.id as string;

    // —— 3. 正常更新：版本 +1，写修订与审计 ——
    const firstUpdate = await call(owner, 'PATCH', `${base}/${templateId}`, { name: '项目月报 v2', description: '第一次修订', expectedVersion: 1, definition: definition('PROJECT', '项目月报 v2') });
    assert.equal(firstUpdate.status, 200, `首次更新应成功：${JSON.stringify(firstUpdate.body).slice(0, 300)}`);
    assert.equal(firstUpdate.body.data.version, 2);
    assert.equal(await prisma.reportTemplateRevision.count({ where: { templateId, action: 'STUDIO_UPDATED' } }), 1);

    // —— 4. 用过期版本号更新：409 ——
    const stale = await call(owner, 'PATCH', `${base}/${templateId}`, { name: '拿旧版本改', expectedVersion: 1, definition: definition('PROJECT', '拿旧版本改') });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'REPORT_TEMPLATE_VERSION_CONFLICT');

    // —— 5. 两人同时拿 version=2 提交：只能成功一个 ——
    const [concurrentA, concurrentB] = await Promise.all([
      call(owner, 'PATCH', `${base}/${templateId}`, { name: '并发改 A', expectedVersion: 2, definition: definition('PROJECT', '并发改 A') }),
      call(owner, 'PATCH', `${base}/${templateId}`, { name: '并发改 B', expectedVersion: 2, definition: definition('PROJECT', '并发改 B') }),
    ]);
    const accepted = [concurrentA, concurrentB].filter((result) => result.status === 200);
    const rejected = [concurrentA, concurrentB].filter((result) => result.status === 409);
    assert.equal(accepted.length, 1, `并发更新只允许一条成功，实际 ${JSON.stringify([concurrentA.status, concurrentB.status])}`);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.body.error.code, 'REPORT_TEMPLATE_VERSION_CONFLICT');
    const afterConcurrent = await prisma.reportTemplate.findUniqueOrThrow({ where: { id: templateId } });
    assert.equal(afterConcurrent.version, 3, '只应推进一个版本号，不能被两个请求各加一次');

    // —— 6. 不能改报表范围 ——
    const domainChange = await call(owner, 'PATCH', `${base}/${templateId}`, { name: '改成公司级', expectedVersion: 3, definition: definition('COMPANY', '改成公司级') });
    assert.equal(domainChange.status, 400);
    assert.equal(domainChange.body.error.code, 'REPORT_STUDIO_DOMAIN_MISMATCH');

    // —— 7. 非法定义被挡 ——
    const invalidDefinition = await call(owner, 'PATCH', `${base}/${templateId}`, { name: '坏定义', expectedVersion: 3, definition: { schemaVersion: 1, domain: 'PROJECT' } });
    assert.equal(invalidDefinition.status, 400);
    assert.equal(invalidDefinition.body.error.code, 'REPORT_STUDIO_DEFINITION_INVALID');

    // —— 8. 发布：固化 publishedVersion，写修订 ——
    const published = await call(owner, 'POST', `${base}/${templateId}/publish`);
    assert.equal(published.status, 200, `发布应成功：${JSON.stringify(published.body).slice(0, 300)}`);
    assert.equal(published.body.data.status, 'PUBLISHED');
    assert.equal(published.body.data.publishedVersion, 3);
    assert.equal(await prisma.reportTemplateRevision.count({ where: { templateId, action: 'STUDIO_PUBLISHED' } }), 1);

    // —— 9. 发布后无编辑权的人看到的是已发布快照，不是草稿 ——
    const readerView = await call(viewer, 'GET', `${base}/${templateId}`);
    assert.equal(readerView.status, 200, `只读成员应能读已发布模板：${JSON.stringify(readerView.body).slice(0, 200)}`);
    assert.equal(readerView.body.data.editable, false);
    assert.equal((readerView.body.data.definition as { title: string }).title, '并发改 A', '无编辑权应看到已发布版本的定义');

    // 发布后再改一次，草稿领先于发布快照
    const afterPublish = await call(owner, 'PATCH', `${base}/${templateId}`, { name: '发布后继续改', expectedVersion: 3, definition: definition('PROJECT', '发布后的草稿') });
    assert.equal(afterPublish.status, 200, `发布后仍可继续改草稿：${JSON.stringify(afterPublish.body).slice(0, 200)}`);
    assert.equal(afterPublish.body.data.version, 4);
    assert.equal(afterPublish.body.data.status, 'PUBLISHED', '有发布快照时编辑后状态仍为已发布');
    const readerAgain = await call(viewer, 'GET', `${base}/${templateId}`);
    assert.equal((readerAgain.body.data.definition as { title: string }).title, '并发改 A', '只读成员看不到尚未发布的新草稿');
    const ownerView = await call(owner, 'GET', `${base}/${templateId}`);
    assert.equal((ownerView.body.data.definition as { title: string }).title, '发布后的草稿', '有编辑权的人看到的是最新草稿');

    // —— 10. 归档后只读：编辑与发布都拒 ——
    await prisma.reportTemplate.update({ where: { id: templateId }, data: { status: 'ARCHIVED' } });
    const editArchived = await call(owner, 'PATCH', `${base}/${templateId}`, { name: '改归档模板', expectedVersion: 4, definition: definition('PROJECT', '改归档模板') });
    assert.equal(editArchived.status, 409);
    assert.equal(editArchived.body.error.code, 'REPORT_TEMPLATE_ARCHIVED');
    const publishArchived = await call(owner, 'POST', `${base}/${templateId}/publish`);
    assert.equal(publishArchived.status, 409);
    assert.equal(publishArchived.body.error.code, 'REPORT_TEMPLATE_ARCHIVED');

    // —— 11. 不存在与越权 ——
    const missing = await call(owner, 'GET', `${base}/${randomUUID()}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'REPORT_STUDIO_TEMPLATE_NOT_FOUND');
    const outsiderEdit = await call(outsider, 'PATCH', `${base}/${templateId}`, { name: '越权改', expectedVersion: 4, definition: definition('PROJECT', '越权改') });
    assert.equal(outsiderEdit.status, 403);
  } finally {
    await app.close();
    try {
      for (const projectId of projectIds) {
        await prisma.reportTemplateRevision.deleteMany({ where: { template: { projectId } } }).catch(() => undefined);
        await prisma.reportTemplate.deleteMany({ where: { projectId } }).catch(() => undefined);
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      await prisma.reportTemplateRevision.deleteMany({ where: { template: { name: { contains: suffix } } } }).catch(() => undefined);
      await prisma.reportTemplate.deleteMany({ where: { name: { contains: suffix } } }).catch(() => undefined);
      await prisma.businessParty.deleteMany({ where: { name: { startsWith: '模板业主' } } }).catch(() => undefined);
      const ids = userIds;
      await prisma.reportTemplateRevision.deleteMany({ where: { createdById: { in: ids } } }).catch(() => undefined);
      await prisma.reportTemplate.deleteMany({ where: { createdById: { in: ids } } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
      await prisma.authSession.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    } catch (error) {
      console.warn('清理测试数据失败：', error instanceof Error ? error.message.slice(0, 160) : error);
    }
    await prisma.$disconnect();
  }
});
