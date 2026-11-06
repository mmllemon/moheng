/**
 * 项目工作区文件操作的路由级回归（真实 PostgreSQL + 真实文件系统）。
 *
 * 这条链路是全仓唯一会对外部文件系统产生不可逆副作用的写路径：删一个目录，
 * 里面的合同扫描件就没了。所以权限分级必须逐级验，路径越界必须真去碰文件系统验。
 *
 * 设计要点：
 *   - 每个测试项目给一个独立的临时 workspaceRoot，不碰仓库和用户目录；
 *   - 四级权限按角色判：OWNER 可删、MANAGER 可写、ESTIMATOR/VIEWER 只读、非成员拒绝；
 *   - 路径穿越用 `../` 与绝对路径两种输入，验完还要检查临时根目录之外确实没生成文件。
 *
 * 运行（隔离库，必须先跑迁移）：
 *   WORKSPACE_FILES_TESTS=true DATABASE_URL=postgresql://.../isolated_test npm run test:workspace-files:postgres -w @cms/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from './prisma.js';
import { workspaceRoutes } from '../routes/workspace.js';

const enabled = process.env.WORKSPACE_FILES_TESTS === 'true';
const TEST_SECRET = 'test-only-jwt-secret-that-is-not-a-credential-32';

test('项目工作区：四级权限、路径越界、扩展名白名单、同名冲突与跨项目隔离', { skip: !enabled }, async () => {
  const testDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(testDatabaseUrl, 'DATABASE_URL must point to an isolated, migrated PostgreSQL test database');
  assert.ok(testDatabaseUrl !== process.env.PRODUCTION_DATABASE_URL, 'test database must not equal PRODUCTION_DATABASE_URL');
  assert.ok(/localhost|127\.0\.0\.1|postgres(?:ql)?:\/\/.*(?:test|ci)/i.test(testDatabaseUrl), 'guard refused a database URL that does not look isolated');

  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const sandbox = await mkdtemp(join(tmpdir(), 'moheng-ws-'));
  // workspaceRoot 列存的只是 projects 下的单层目录名，真正的根由 WORKSPACE_STORAGE_DIR 决定。
  // 这里把存储根指到临时目录，避免碰仓库和用户目录。
  const previousStorageDir = process.env.WORKSPACE_STORAGE_DIR;
  process.env.WORKSPACE_STORAGE_DIR = sandbox;
  const rootNameA = `ws-a-${suffix}`.slice(0, 40);
  const rootNameB = `ws-b-${suffix}`.slice(0, 40);
  const rootA = join(sandbox, 'projects', rootNameA);
  const rootB = join(sandbox, 'projects', rootNameB);
  await mkdir(rootA, { recursive: true });
  await mkdir(rootB, { recursive: true });

  const app = Fastify();
  await app.register(jwt, { secret: TEST_SECRET });
  await app.register(workspaceRoutes, { prefix: '/api/projects' });
  await app.ready();

  const userIds: string[] = [];
  const projectIds: string[] = [];

  async function makeActor(label: string, role: 'ADMIN' | 'USER' = 'USER') {
    const user = await prisma.user.create({ data: {
      name: `Workspace Fixture ${label} ${suffix}`,
      email: `workspace-fixture-${label}-${suffix}@example.invalid`,
      passwordHash: 'test-only-not-a-login-password',
      role,
    } });
    userIds.push(user.id);
    const session = await prisma.authSession.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id });
    return { userId: user.id, headers: { authorization: `Bearer ${token}` } };
  }

  const call = async (actor: { headers: Record<string, string> }, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) => {
    const response = await app.inject({ method, url, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
    const text = typeof response.body === 'string' ? response.body : '';
    let body: any = null;
    if (text) { try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; } }
    return { status: response.statusCode, body, raw: text };
  };

  async function makeProject(label: string, workspaceRoot: string) {
    const project = await prisma.project.create({ data: {
      name: `Workspace ${label} ${suffix}`,
      code: `WS-${label}-${suffix}`.slice(0, 40),
      ownerName: `工作区业主${label}${suffix}`.slice(0, 60),
      contractAmount: '1000000.00',
      originalContractAmount: '1000000.00',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      workspaceRoot,
    } });
    projectIds.push(project.id);
    return project;
  }

  try {
    const owner = await makeActor('owner');
    const manager = await makeActor('manager');
    const viewer = await makeActor('viewer');
    const outsider = await makeActor('outsider');

    const projectA = await makeProject('A', rootNameA);
    const projectB = await makeProject('B', rootNameB);
    await prisma.projectMember.createMany({ data: [
      { projectId: projectA.id, userId: owner.userId, role: 'OWNER' },
      { projectId: projectA.id, userId: manager.userId, role: 'MANAGER' },
      { projectId: projectA.id, userId: viewer.userId, role: 'VIEWER' },
    ] });

    const base = `/api/projects/${projectA.id}/workspace`;

    // —— 1. 建目录与列目录 ——
    const created = await call(owner, 'POST', `${base}/dir`, { path: '合同扫描件' });
    assert.equal(created.status, 201, `建目录应成功：${JSON.stringify(created.body).slice(0, 200)}`);
    assert.ok((await stat(join(rootA, '合同扫描件'))).isDirectory(), '目录应真的落到 workspaceRoot 下');
    const tree = await call(owner, 'GET', `${base}/tree?path=`);
    assert.equal(tree.status, 200);
    assert.ok((tree.body.data.entries as { name: string }[]).some((entry) => entry.name === '合同扫描件'));

    // —— 2. 上传与读取 ——
    const content = Buffer.from('合同的正文内容', 'utf8');
    const uploaded = await call(owner, 'POST', `${base}/file`, {
      dir: '合同扫描件', fileName: '主合同.txt', contentBase64: content.toString('base64'),
    });
    assert.equal(uploaded.status, 201, `上传应成功：${JSON.stringify(uploaded.body).slice(0, 160)}`);
    assert.equal(uploaded.body.data.size, content.length);
    assert.equal(await readFile(join(rootA, '合同扫描件', '主合同.txt'), 'utf8'), '合同的正文内容');

    const read = await call(owner, 'GET', `${base}/file?path=${encodeURIComponent('合同扫描件/主合同.txt')}`);
    assert.equal(read.status, 200);
    assert.equal(read.raw, '合同的正文内容');

    // —— 3. 同名文件不覆盖（写盘用 wx）——
    const duplicated = await call(owner, 'POST', `${base}/file`, {
      dir: '合同扫描件', fileName: '主合同.txt', contentBase64: Buffer.from('另一份').toString('base64'),
    });
    assert.equal(duplicated.status, 409);
    assert.equal(duplicated.body.error.code, 'WORKSPACE_EXISTS');
    assert.equal(await readFile(join(rootA, '合同扫描件', '主合同.txt'), 'utf8'), '合同的正文内容', '同名上传不得覆盖原文件');

    // —— 4. 扩展名白名单：可执行文件与未知类型都拒 ——
    const blockedExt = await call(owner, 'POST', `${base}/file`, { dir: '', fileName: 'setup.exe', contentBase64: Buffer.from('x').toString('base64') });
    assert.equal(blockedExt.status, 400);
    assert.equal(blockedExt.body.error.code, 'WORKSPACE_EXT_BLOCKED');
    const unknownExt = await call(owner, 'POST', `${base}/file`, { dir: '', fileName: 'weird.qqq', contentBase64: Buffer.from('x').toString('base64') });
    assert.equal(unknownExt.status, 400);
    assert.equal(unknownExt.body.error.code, 'WORKSPACE_EXT_NOT_ALLOWED');

    // —— 5. 路径越界：相对穿越与绝对路径都拒，且根外不落文件 ——
    const traversal = await call(owner, 'POST', `${base}/file`, {
      dir: '..', fileName: 'escape.txt', contentBase64: Buffer.from('escape').toString('base64'),
    });
    assert.equal(traversal.status, 400);
    assert.equal(traversal.body.error.code, 'WORKSPACE_PATH_INVALID');

    const deepTraversal = await call(owner, 'POST', `${base}/file`, {
      dir: 'sub/../../escape', fileName: 'escape3.txt', contentBase64: Buffer.from('escape').toString('base64'),
    });
    assert.equal(deepTraversal.status, 400);
    assert.equal(deepTraversal.body.error.code, 'WORKSPACE_PATH_INVALID');

    // 前导斜杠会被当成相对路径处理（路由先剥斜杠再进存储层），文件仍落在项目根内，不会跳出去。
    const leadingSlash = await call(owner, 'POST', `${base}/file`, {
      dir: '/etc', fileName: 'escape2.txt', contentBase64: Buffer.from('escape').toString('base64'),
    });
    assert.equal(leadingSlash.status, 201, `前导斜杠应退化为项目内相对路径：${JSON.stringify(leadingSlash.body).slice(0, 160)}`);
    assert.ok((await stat(join(rootA, 'etc', 'escape2.txt'))).isFile(), '文件应落在项目根内的 etc 目录');
    const outside = await readdir(sandbox);
    assert.deepEqual(outside.sort(), ['projects'], '越界写入不得在存储根之外留下任何文件');
    const projectsEntries = await readdir(join(sandbox, 'projects'));
    assert.deepEqual(projectsEntries.sort(), [rootNameA, rootNameB].sort(), 'projects 层只能有本测试的两个项目目录');

    // —— 6. 不能删根（path 为空会被 schema 当成参数不合法，用「.」才会走到存储层的根保护）——
    const emptyPath = await call(owner, 'DELETE', `${base}/entry?path=`);
    assert.equal(emptyPath.status, 400);
    assert.equal(emptyPath.body.error.code, 'VALIDATION_ERROR');
    const removeRoot = await call(owner, 'DELETE', `${base}/entry?path=.`);
    assert.equal(removeRoot.status, 400);
    assert.equal(removeRoot.body.error.code, 'WORKSPACE_CANNOT_REMOVE_ROOT');

    // —— 7. 四级权限 ——
    const managerUpload = await call(manager, 'POST', `${base}/dir`, { path: '项目经理目录' });
    assert.equal(managerUpload.status, 201, 'MANAGER 可写');

    const viewerUpload = await call(viewer, 'POST', `${base}/dir`, { path: '只读不该建' });
    assert.equal(viewerUpload.status, 403);
    assert.equal(viewerUpload.body.error.code, 'WORKSPACE_FORBIDDEN');
    assert.equal(viewerUpload.body.error.message, '当前角色只能查看，不能修改文件');

    const viewerDelete = await call(viewer, 'DELETE', `${base}/entry?path=${encodeURIComponent('合同扫描件/主合同.txt')}`);
    assert.equal(viewerDelete.status, 403);

    const managerDelete = await call(manager, 'DELETE', `${base}/entry?path=${encodeURIComponent('合同扫描件/主合同.txt')}`);
    assert.equal(managerDelete.status, 403);
    assert.equal(managerDelete.body.error.message, '只有项目负责人可以删除文件', '删除权限只给 OWNER');

    const outsiderTree = await call(outsider, 'GET', `${base}/tree?path=`);
    assert.equal(outsiderTree.status, 403);
    assert.equal(outsiderTree.body.error.code, 'WORKSPACE_FORBIDDEN');
    assert.equal(outsiderTree.body.error.message, '无权访问该项目');

    // —— 8. OWNER 删除生效 ——
    const ownerDelete = await call(owner, 'DELETE', `${base}/entry?path=${encodeURIComponent('合同扫描件/主合同.txt')}`);
    assert.equal(ownerDelete.status, 200, `OWNER 删除应成功：${JSON.stringify(ownerDelete.body).slice(0, 160)}`);
    await assert.rejects(stat(join(rootA, '合同扫描件', '主合同.txt')), '文件应真的被删掉');

    // —— 9. 跨项目隔离：B 项目的相对路径在 A 下取不到 B 的内容 ——
    await mkdir(join(rootB, '内部资料'), { recursive: true });
    await call(owner, 'POST', `${base}/file`, { dir: '', fileName: 'a-only.txt', contentBase64: Buffer.from('A').toString('base64') });
    const crossTree = await call(owner, 'GET', `/api/projects/${projectB.id}/workspace/tree?path=`);
    assert.equal(crossTree.status, 403, 'B 项目没有成员身份的用户读不到 B');
    const aTree = await call(owner, 'GET', `${base}/tree?path=`);
    assert.equal(aTree.status, 200);
    assert.ok(!(aTree.body.data.entries as { name: string }[]).some((entry) => entry.name === '内部资料'), 'A 的目录不得出现 B 的内容');

    // —— 10. 项目不存在 ——
    const missing = await call(owner, 'GET', `/api/projects/${randomUUID()}/workspace/tree?path=`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body?.error?.code, 'PROJECT_NOT_FOUND', `未知项目应带错误码，实际 ${JSON.stringify(missing.body).slice(0, 120)}`);
  } finally {
    await app.close();
    await rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
    if (previousStorageDir === undefined) delete process.env.WORKSPACE_STORAGE_DIR;
    else process.env.WORKSPACE_STORAGE_DIR = previousStorageDir;
    try {
      for (const projectId of projectIds) {
        await prisma.auditLog.deleteMany({ where: { projectId } });
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => undefined);
      }
      await prisma.businessParty.deleteMany({ where: { name: { startsWith: '工作区业主' } } }).catch(() => undefined);
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
