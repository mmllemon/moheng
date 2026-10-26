/**
 * 项目产物：聚合项目内所有变更单的外部凭证附件。
 *
 * 对齐 hana 的「对话文件」面板（session-files）：
 *   hana 展示会话产物（agent 生成的文件），moheng 对应的是
 *   变更单外部确认时上传的凭证（扫描件、邮件截图）。
 *
 * 与「工作室」（项目目录树）的区别：
 *   工作室 = 用户自己组织的文件系统目录
 *   产物   = 业务流程产生的、带来源追溯的附件
 *
 * 数据来源：Change.evidenceFiles（JSON 数组，每项是 EvidenceFileMetadata）
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { denyIfNoProjectAccess } from '../lib/project-access.js';
import { readEvidenceFile, type EvidenceFileMetadata } from '../lib/evidence-storage.js';

export type ProjectArtifact = {
  /** 唯一标识：changeId:fileId */
  id: string;
  /** 文件名 */
  name: string;
  /** 大小（字节） */
  size: number;
  /** MIME */
  mimeType: string;
  /** 扩展名（带点） */
  ext: string;
  /** 上传时间 */
  uploadedAt: string;
  /** 来源：变更单编号与名称 */
  sourceKind: 'change-evidence';
  sourceCode: string;
  sourceName: string;
  sourceId: string;
  /** 凭证等级 A/B/C（hana 没有，moheng 业务特有） */
  evidenceClass?: string | null;
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function toArtifact(
  change: { id: string; code: string; name: string; evidenceClass: string | null },
  file: EvidenceFileMetadata,
): ProjectArtifact {
  return {
    id: `${change.id}:${file.id}`,
    name: file.fileName,
    size: file.sizeBytes,
    mimeType: file.mimeType,
    ext: extOf(file.fileName),
    uploadedAt: file.uploadedAt,
    sourceKind: 'change-evidence',
    sourceCode: change.code,
    sourceName: change.name,
    sourceId: change.id,
    evidenceClass: change.evidenceClass,
  };
}

export async function projectArtifactRoutes(app: FastifyInstance) {
  /** 列出项目产物（所有变更单的凭证附件） */
  app.get('/:projectId/artifacts', { preHandler: authRequired }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = z.object({ q: z.string().max(200).optional().default('') }).safeParse(request.query);
    if (!query.success) return failure(reply, 400, 'VALIDATION_ERROR', '参数不合法');

    const user = authUser(request);
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply)) return;

    const changes = await prisma.change.findMany({
      // Prisma 7 的 Json 字段不能用 `not: null` 过滤，改成取出全部再在应用层筛
      where: { projectId, deletedAt: null },
      select: { id: true, code: true, name: true, evidenceClass: true, evidenceFiles: true },
      orderBy: { updatedAt: 'desc' },
    });

    const q = query.data.q.trim().toLowerCase();
    const artifacts: ProjectArtifact[] = [];
    for (const change of changes) {
      const files = Array.isArray(change.evidenceFiles) ? (change.evidenceFiles as unknown as EvidenceFileMetadata[]) : [];
      for (const file of files) {
        if (!file || typeof file.fileName !== 'string') continue;
        if (q && !file.fileName.toLowerCase().includes(q) && !change.code.toLowerCase().includes(q)) continue;
        artifacts.push(toArtifact(change, file));
      }
    }

    // 按上传时间倒序（最新的产物在最前）
    artifacts.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));

    return success({ total: artifacts.length, artifacts });
  });

  /** 读取产物内容（预览 / 下载） */
  app.get('/:projectId/artifacts/:artifactId/content', async (request, reply) => {
    const { projectId, artifactId } = request.params as { projectId: string; artifactId: string };
    const query = z.object({ token: z.string().optional(), download: z.string().optional() }).safeParse(request.query);

    // <iframe>/<img> 无法带 Authorization 头，所以支持 ?token=
    let userId: string;
    let role: Parameters<typeof denyIfNoProjectAccess>[1];
    try {
      const raw = query.success && query.data.token
        ? await app.jwt.verify<{ sub: string; role: Parameters<typeof denyIfNoProjectAccess>[1]; sid?: string; purpose?: string }>(query.data.token)
        : await request.jwtVerify<{ sub: string; role: Parameters<typeof denyIfNoProjectAccess>[1]; sid?: string; purpose?: string }>();
      if (!raw.sid || raw.purpose) return failure(reply, 401, 'SESSION_REQUIRED', '凭证不能访问此资源');
      userId = raw.sub;
      role = raw.role;
    } catch {
      return failure(reply, 401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录');
    }

    if (await denyIfNoProjectAccess(userId, role, projectId, reply)) return;

    // artifactId = changeId:fileId
    // 注意：浏览器会把 `:` 编码成 %3A，必须解码后再 split，否则只能得到一段
    const [changeId, fileId] = decodeURIComponent(artifactId).split(':');
    if (!changeId || !fileId) return failure(reply, 400, 'ARTIFACT_ID_INVALID', '产物标识不合法');

    const change = await prisma.change.findFirst({
      where: { id: changeId, projectId, deletedAt: null },
      select: { evidenceFiles: true },
    });
    if (!change) return failure(reply, 404, 'ARTIFACT_NOT_FOUND', '产物不存在');

    const files = Array.isArray(change.evidenceFiles) ? (change.evidenceFiles as unknown as EvidenceFileMetadata[]) : [];
    const file = files.find((f) => f?.id === fileId);
    if (!file) return failure(reply, 404, 'ARTIFACT_NOT_FOUND', '产物不存在');

    try {
      const bytes = await readEvidenceFile(file);
      const inline = /^(application\/pdf|image\/|text\/)/.test(file.mimeType);
      const forceDownload = query.success && query.data.download === '1';
      reply.header('Content-Type', file.mimeType);
      reply.header('Content-Length', String(bytes.length));
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header(
        'Content-Disposition',
        `${inline && !forceDownload ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      return reply.send(bytes);
    } catch {
      return failure(reply, 500, 'ARTIFACT_READ_FAILED', '读取产物失败');
    }
  });
}
