import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { ProjectRole } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';
import { canAccessProject } from './project-access.js';
import { loadReportSnapshot, type ReportFilters, type ReportKey, reportKeys } from './report-data.js';
import { buildReportWorkbook } from './report-xlsx.js';
import { validateReportTemplateDefinition } from './report-template.js';
import { backgroundJobArtifactPath, backgroundJobStorageRoot } from './background-job-storage.js';
import { PermanentBackgroundJobError } from './background-jobs.js';
import type { BackgroundJobHandler } from './background-job-types.js';
import type { AuthUser } from './auth.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const exportPayloadSchema = z.object({
  reportKey: z.enum(reportKeys),
  filters: z.object({ projectId: z.string().min(1).optional(), from: day.optional(), to: day.optional() }),
  templateDefinition: z.unknown(),
  templateName: z.string().min(1).max(100),
  templateVersion: z.number().int().positive(),
  templateId: z.string().min(1).nullable().optional(),
});

async function ensureTemplateStillReadable(templateId: string, user: AuthUser, reportKey: string): Promise<void> {
  const template = await prisma.reportTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.status === 'ARCHIVED' || template.reportKey !== reportKey) {
    throw new PermanentBackgroundJobError('REPORT_EXPORT_TEMPLATE_UNAVAILABLE');
  }
  if (template.scope === 'SYSTEM') {
    if (template.status === 'PUBLISHED' || user.role === 'ADMIN') return;
    throw new PermanentBackgroundJobError('REPORT_EXPORT_TEMPLATE_ACCESS_REVOKED');
  }
  if (template.scope === 'PERSONAL') {
    if (template.ownerUserId === user.sub) return;
    throw new PermanentBackgroundJobError('REPORT_EXPORT_TEMPLATE_ACCESS_REVOKED');
  }
  if (template.scope === 'PROJECT' && template.projectId) {
    if (!(await canAccessProject(user.sub, user.role, template.projectId, undefined, 'REPORT_EXPORT'))) {
      throw new PermanentBackgroundJobError('REPORT_EXPORT_TEMPLATE_PROJECT_ACCESS_REVOKED');
    }
    if (template.status === 'PUBLISHED' || template.ownerUserId === user.sub || user.role === 'ADMIN' ||
      await canAccessProject(user.sub, user.role, template.projectId, [ProjectRole.OWNER, ProjectRole.MANAGER], 'PROJECT_MANAGE')) return;
  }
  throw new PermanentBackgroundJobError('REPORT_EXPORT_TEMPLATE_ACCESS_REVOKED');
}

export const reportXlsxExportJobHandler: BackgroundJobHandler = async (job) => {
  if (job.payloadVersion !== 1) throw new PermanentBackgroundJobError(`UNSUPPORTED_REPORT_EXPORT_PAYLOAD_VERSION:${job.payloadVersion}`);
  const parsed = exportPayloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new PermanentBackgroundJobError('REPORT_EXPORT_PAYLOAD_INVALID');
  const payload = parsed.data;
  const user = await prisma.user.findUnique({ where: { id: job.ownerUserId }, select: { id: true, email: true, role: true, isActive: true } });
  if (!user || !user.isActive) throw new PermanentBackgroundJobError('REPORT_EXPORT_OWNER_UNAVAILABLE');
  const authUser: AuthUser = { sub: user.id, email: user.email, role: user.role, sid: `background:${job.id}` };
  if (payload.templateId) await ensureTemplateStillReadable(payload.templateId, authUser, payload.reportKey);
  const loaded = await loadReportSnapshot(payload.reportKey as ReportKey, authUser, payload.filters as ReportFilters);
  if (!loaded.ok) throw new PermanentBackgroundJobError(`REPORT_EXPORT_NOT_AUTHORIZED:${loaded.code}`);
  const validated = validateReportTemplateDefinition(payload.templateDefinition, payload.reportKey);
  if (!validated.success) throw new PermanentBackgroundJobError('REPORT_EXPORT_TEMPLATE_INVALID');
  const buffer = await buildReportWorkbook({ snapshot: loaded.snapshot, definition: validated.data, templateName: payload.templateName, templateVersion: payload.templateVersion });
  const fileName = `${job.id}-${job.attempts}.xlsx`;
  await mkdir(backgroundJobStorageRoot(), { recursive: true });
  await writeFile(backgroundJobArtifactPath(fileName), buffer);
  return {
    resultFileName: fileName,
    resultMetadata: {
      reportKey: payload.reportKey,
      rowCount: loaded.snapshot.rowCount,
      truncated: loaded.snapshot.truncated,
      generatedAt: loaded.snapshot.generatedAt.toISOString(),
      suggestedFileName: `墨衡-${payload.reportKey}-${loaded.snapshot.generatedAt.toISOString().slice(0, 10)}.xlsx`,
    },
  };
};
