/**
 * 项目工作区：目录浏览、文件读取、上传、删除。
 *
 * 挂载在 /api/projects，路径形如：
 *   GET    /api/projects/:projectId/workspace/tree?path=
 *   GET    /api/projects/:projectId/workspace/file?path=
 *   GET    /api/projects/:projectId/workspace/raw?path=
 *   POST   /api/projects/:projectId/workspace/file
 *   POST   /api/projects/:projectId/workspace/dir
 *   DELETE /api/projects/:projectId/workspace/entry?path=
 *
 * 权限：全部走 denyIfNoProjectAccess，与项目内其他模块一致。
 * 上传用 base64 而非 multipart，与 evidence-storage 保持一致，避免引入新依赖。
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { denyIfNoProjectAccess, canAccessProject } from '../lib/project-access.js';import {
  listDirectory,
  makeDirectory,
  openEntry,
  readEntry,
  removeEntry,
  safeName,
  uploadFiles,
  writeEntry,
} from '../lib/workspace-storage.js';
const pathBody = z.object({ path: z.string().max(1024).optional().default('') });

const uploadBody = z.object({
  dir: z.string().max(1024).optional().default(''),
  fileName: z.string().trim().min(1).max(180),
  contentBase64: z.string().min(1),
});

const batchUploadBody = z.object({
  dir: z.string().max(1024).optional().default(''),
  files: z.array(z.object({
    name: z.string().trim().min(1).max(180),
    contentBase64: z.string().min(1),
  })).min(1).max(50),
});

const mkdirBody = z.object({ path: z.string().trim().min(1).max(1024) });

/**
 * 工作区访问级别。
 *
 * 对齐 Hana 的四级模型（bundle/index.js 的 go / OBr），但映射到 moheng 已有的业务权限键：
 *
 *   BLOCKED     无 PROJECT_READ                    看不到
 *   READ_ONLY   有 PROJECT_READ，无 PROJECT_MANAGE  列目录、预览、下载
 *   READ_WRITE  有 PROJECT_MANAGE（MANAGER）         上传、建目录、重命名
 *   FULL        OWNER                                额外可删
 *
 * 删除只给 OWNER：合同扫描件、发票这类文件删了不可逆，
 * 比 Hana 的「工作区根可写即可删」更严。
 */
type WorkspaceAccessLevel = 'blocked' | 'read_only' | 'read_write' | 'full';

/** 动作 → 允许的级别（照抄 Hana 的 OBr） */
const ACTION_LEVELS: Record<'read' | 'write' | 'delete', ReadonlySet<WorkspaceAccessLevel>> = {
  read: new Set(['read_only', 'read_write', 'full']),
  write: new Set(['read_write', 'full']),
  delete: new Set(['full']),
};

/** 存储层错误码 → HTTP 响应 */
function storageFailure(reply: FastifyReply, error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.startsWith('WORKSPACE_PATH_INVALID') || raw.startsWith('WORKSPACE_ROOT_INVALID')) {
    return failure(reply, 400, 'WORKSPACE_PATH_INVALID', '路径不合法');
  }
  if (raw.startsWith('WORKSPACE_EXT_BLOCKED')) {
    return failure(reply, 400, 'WORKSPACE_EXT_BLOCKED', '该类型文件不允许上传');
  }
  if (raw.startsWith('WORKSPACE_EXT_NOT_ALLOWED')) {
    return failure(reply, 400, 'WORKSPACE_EXT_NOT_ALLOWED', '不支持的文件类型');
  }
  if (raw.startsWith('WORKSPACE_TOO_LARGE')) {
    return failure(reply, 413, 'WORKSPACE_TOO_LARGE', '文件超过大小上限');
  }
  if (raw.startsWith('WORKSPACE_NAME_INVALID')) {
    return failure(reply, 400, 'WORKSPACE_NAME_INVALID', '文件名不合法');
  }
  if (raw.startsWith('WORKSPACE_CANNOT_REMOVE_ROOT')) {
    return failure(reply, 400, 'WORKSPACE_CANNOT_REMOVE_ROOT', '不能删除项目根目录');
  }
  if (raw.startsWith('WORKSPACE_NOT_A_FILE')) {
    return failure(reply, 400, 'WORKSPACE_NOT_A_FILE', '目标不是文件');
  }
  if (raw.includes('EEXIST')) return failure(reply, 409, 'WORKSPACE_EXISTS', '同名文件或目录已存在');
  if (raw.includes('ENOENT')) return failure(reply, 404, 'WORKSPACE_NOT_FOUND', '文件或目录不存在');
  return failure(reply, 500, 'WORKSPACE_ERROR', '工作区操作失败');
}

export async function workspaceRoutes(app: FastifyInstance) {
  /**
   * 判定当前用户对该项目工作区的访问级别。
   *
   * 对齐 Hana 的四级模型，但**不依赖 canAccessProject 的 permissionKey**：
   * 那个函数在未发布治理规则时对任意 permissionKey 都返回 true
   * （见 project-access.ts：`if (!published) return true`），
   * 用它判 PROJECT_MANAGE 会让 VIEWER 也拿到写权限。
   *
   * 所以这里直接按角色判：
   *   OWNER              → full（可删）
   *   MANAGER            → read_write
   *   ESTIMATOR / VIEWER → read_only
   *   非成员             → blocked
   *   ADMIN              → full
   */
  async function resolveAccess(
    userId: string,
    globalRole: Parameters<typeof denyIfNoProjectAccess>[1],
    projectId: string,
  ): Promise<WorkspaceAccessLevel> {
    if (globalRole === 'ADMIN') return 'full';

    const membership = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (!membership) {
      // 非成员：只有跨项目读授权能拿到只读
      const canRead = await canAccessProject(userId, globalRole, projectId, undefined, 'PROJECT_READ');
      return canRead ? 'read_only' : 'blocked';
    }

    switch (membership.role) {
      case 'OWNER': return 'full';
      case 'MANAGER': return 'read_write';
      default: return 'read_only';
    }
  }

  /**
   * 校验权限，不足时写 403 并返回 null。
   * 返回 { project, access } 表示通过。
   */
  async function guard(
    projectId: string,
    request: Parameters<typeof authUser>[0],
    reply: FastifyReply,
    action: 'read' | 'write' | 'delete',
  ) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, workspaceRoot: true },
    });
    if (!project) {
      failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');
      return null;
    }

    const user = authUser(request);
    const access = await resolveAccess(user.sub, user.role, projectId);
    if (!ACTION_LEVELS[action].has(access)) {
      const message = access === 'blocked'
        ? '无权访问该项目'
        : action === 'delete'
          ? '只有项目负责人可以删除文件'
          : '当前角色只能查看，不能修改文件';
      failure(reply, 403, 'WORKSPACE_FORBIDDEN', message);
      return null;
    }

    return { project, access };
  }

  /** 列出目录（单层，懒加载） */
  app.get('/:projectId/workspace/tree', { preHandler: authRequired }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = pathBody.safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '参数不合法');

    const guarded = await guard(projectId, request, reply, 'read');
    if (!guarded) return;
    const { project } = guarded;

    try {
      const entries = await listDirectory(projectId, query.data.path, project.workspaceRoot);
      return success({ path: query.data.path, entries });
    } catch (error) {
      return storageFailure(reply, error);
    }
  });

  /** 读文件内容（预览用，限 2MB） */
  app.get('/:projectId/workspace/file', { preHandler: authRequired }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = z.object({ path: z.string().min(1).max(1024) }).safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '缺少文件路径');

    const guarded = await guard(projectId, request, reply, 'read');
    if (!guarded) return;
    const { project } = guarded;

    try {
      const { bytes, mimeType } = await readEntry(projectId, query.data.path, project.workspaceRoot);
      reply.header('Content-Type', mimeType);
      reply.header('Content-Length', String(bytes.length));
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'private, max-age=60');
      return reply.send(bytes);
    } catch (error) {
      return storageFailure(reply, error);
    }
  });

  /** 流式下载 / PDF 内嵌（不限 2MB）
   *
   * <iframe> 和 <img> 无法自定义 Authorization 头，所以这个端点额外接受
   * ?token= 查询参数。其余端点仍只认 Authorization 头。
   * 风险：token 会进入访问日志和浏览器历史。只用于预览/下载，不改状态。 */
  app.get('/:projectId/workspace/raw', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = z
      .object({ path: z.string().min(1).max(1024), token: z.string().optional() })
      .safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '缺少文件路径');

    let userId: string;
    let role: Parameters<typeof denyIfNoProjectAccess>[1];
    try {
      const raw = query.data.token
        ? await app.jwt.verify<{ sub: string; role: Parameters<typeof denyIfNoProjectAccess>[1]; sid?: string; purpose?: string }>(query.data.token)
        : await request.jwtVerify<{ sub: string; role: Parameters<typeof denyIfNoProjectAccess>[1]; sid?: string; purpose?: string }>();
      if (!raw.sid || raw.purpose) return failure(reply, 401, 'SESSION_REQUIRED', '凭证不能访问此资源');
      userId = raw.sub;
      role = raw.role;
    } catch {
      return failure(reply, 401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录');
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, workspaceRoot: true },
    });
    if (!project) return failure(reply, 404, 'PROJECT_NOT_FOUND', '项目不存在');

    // 与其余读端点一致的权限分级（此处不能走 guard，因为已经手动解出 userId/role）
    const access = await resolveAccess(userId, role, projectId);
    if (!ACTION_LEVELS.read.has(access)) {
      return failure(reply, 403, 'WORKSPACE_FORBIDDEN', '无权访问该项目');
    }

    let opened: Awaited<ReturnType<typeof openEntry>> | null = null;
    try {
      opened = await openEntry(projectId, query.data.path, project.workspaceRoot);
      const inline = /^(application\/pdf|image\/|text\/)/.test(opened.mimeType);
      reply.header('Content-Type', opened.mimeType);
      reply.header('Content-Length', String(opened.size));
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(opened.name)}`,
      );
      // 用 FileHandle 自己的 createReadStream，不要用 createReadStream('', { fd }) ——
      // 后者会在 GC 时重复关闭 fd，导致 EBADF 并拖垮进程。
      return reply.send(opened.handle.createReadStream({ autoClose: true }));
    } catch (error) {
      if (opened) await opened.handle.close().catch(() => {});
      return storageFailure(reply, error);
    }
  });

  /** 上传（base64） */
  app.post('/:projectId/workspace/file', { preHandler: authRequired }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = uploadBody.safeParse(request.body);
    if (!body.success) return failure(reply, 400, 'VALIDATION_ERROR', '参数不合法');

    const guarded = await guard(projectId, request, reply, 'write');
    if (!guarded) return;
    const { project } = guarded;

    let name: string;
    try {
      name = safeName(body.data.fileName);
    } catch {
      return failure(reply, 400, 'WORKSPACE_NAME_INVALID', '文件名不合法');
    }

    const bytes = Buffer.from(body.data.contentBase64, 'base64');
    if (!bytes.length) return failure(reply, 400, 'WORKSPACE_EMPTY_FILE', '文件内容为空');

    const relPath = [body.data.dir.replace(/^\/+|\/+$/g, ''), name].filter(Boolean).join('/');

    try {
      const result = await writeEntry(projectId, relPath, bytes, project.workspaceRoot);
      return reply.status(201).send(success(result));
    } catch (error) {
      return storageFailure(reply, error);
    }
  });

  /** 批量上传（base64）。单个失败不中断整批，返回逐项结果 —— 对齐 Hana */
  app.post('/:projectId/workspace/upload', { preHandler: authRequired }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = batchUploadBody.safeParse(request.body);
    if (!body.success) return failure(reply, 400, 'VALIDATION_ERROR', '参数不合法');

    const guarded = await guard(projectId, request, reply, 'write');
    if (!guarded) return;
    const { project } = guarded;

    try {
      const result = await uploadFiles(projectId, body.data.dir, body.data.files, project.workspaceRoot);
      return reply.status(201).send(success(result));
    } catch (error) {
      return storageFailure(reply, error);
    }
  });

  /** 新建目录 */
  app.post('/:projectId/workspace/dir', { preHandler: authRequired }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = mkdirBody.safeParse(request.body);
    if (!body.success) return failure(reply, 400, 'VALIDATION_ERROR', '参数不合法');

    const guarded = await guard(projectId, request, reply, 'write');
    if (!guarded) return;
    const { project } = guarded;

    try {
      const path = await makeDirectory(projectId, body.data.path, project.workspaceRoot);
      return reply.status(201).send(success({ path }));
    } catch (error) {
      return storageFailure(reply, error);
    }
  });

  /** 删除文件或目录 */
  app.delete('/:projectId/workspace/entry', { preHandler: authRequired }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = z.object({ path: z.string().min(1).max(1024) }).safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '缺少路径');

    const guarded = await guard(projectId, request, reply, 'delete');
    if (!guarded) return;
    const { project } = guarded;

    try {
      await removeEntry(projectId, query.data.path, project.workspaceRoot);
      return success({ removed: query.data.path });
    } catch (error) {
      return storageFailure(reply, error);
    }
  });
}
