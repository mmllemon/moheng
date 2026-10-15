import { mkdir, writeFile } from 'node:fs/promises';
import { ProjectRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { canAccessProject } from './project-access.js';
import { backgroundJobArtifactPath, backgroundJobStorageRoot } from './background-job-storage.js';
import { PermanentBackgroundJobError } from './background-jobs.js';
import type { BackgroundJobHandler } from './background-job-types.js';
import type { AuthUser } from './auth.js';
import { z } from 'zod';
import { loadReportStudioDataset } from './report-studio-data.js';
import { domainFromStudioReportKey, studioReportKey, validateReportStudioDefinition } from './report-studio-definition.js';
import { buildReportStudioWorkbook } from './report-studio-xlsx.js';

const payloadSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.number().int().positive(),
  templateDefinition: z.unknown(),
  domain: z.enum(['PROJECT', 'COMPANY', 'PARTY']),
  projectId: z.string().min(1).optional(),
  businessPartyId: z.string().min(1).optional(),
});

async function canAccessBusinessParty(userId: string, role: string, businessPartyId: string): Promise<boolean> {
  const party = await prisma.businessParty.findUnique({ where: { id: businessPartyId }, select: { id: true } });
  if (!party) return false;
  if (role === 'ADMIN') return true;
  const project = await prisma.project.findFirst({ where: { deletedAt: null, members: { some: { userId } }, OR: [
    { ownerPartyId: businessPartyId },
    { downstreamContracts: { some: { counterpartyPartyId: businessPartyId, deletedAt: null } } },
    { costEntries: { some: { businessPartyId, downstreamContractId: null, deletedAt: null } } },
  ] }, select: { id: true } });
  return Boolean(project);
}

export const reportStudioXlsxExportJobHandler: BackgroundJobHandler = async (job) => {
  if (job.payloadVersion !== 1) throw new PermanentBackgroundJobError(`UNSUPPORTED_REPORT_STUDIO_PAYLOAD_VERSION:${job.payloadVersion}`);
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new PermanentBackgroundJobError('REPORT_STUDIO_EXPORT_PAYLOAD_INVALID');
  const payload = parsed.data;
  if (payload.domain === 'PROJECT' && !payload.projectId) throw new PermanentBackgroundJobError('REPORT_STUDIO_PROJECT_REQUIRED');
  if (payload.domain === 'PARTY' && !payload.businessPartyId) throw new PermanentBackgroundJobError('REPORT_STUDIO_PARTY_REQUIRED');
  const [user, template] = await Promise.all([
    prisma.user.findUnique({ where: { id: job.ownerUserId }, select: { id: true, email: true, role: true, isActive: true } }),
    prisma.reportTemplate.findUnique({ where: { id: payload.templateId } }),
  ]);
  if (!user || !user.isActive) throw new PermanentBackgroundJobError('REPORT_STUDIO_EXPORT_OWNER_UNAVAILABLE');
  if (!template || template.status === 'ARCHIVED' || template.reportKey !== studioReportKey(payload.domain)) throw new PermanentBackgroundJobError('REPORT_STUDIO_EXPORT_TEMPLATE_UNAVAILABLE');
  const authUser: AuthUser = { sub: user.id, email: user.email, role: user.role };
  if (template.scope === 'SYSTEM') {
    if (template.status !== 'PUBLISHED' && user.role !== 'ADMIN') throw new PermanentBackgroundJobError('REPORT_STUDIO_TEMPLATE_ACCESS_REVOKED');
  } else if (template.scope === 'PERSONAL') {
    if (template.ownerUserId !== user.id) throw new PermanentBackgroundJobError('REPORT_STUDIO_TEMPLATE_ACCESS_REVOKED');
  } else if (template.scope === 'PROJECT' && template.projectId) {
    const projectReadable = await canAccessProject(user.id, user.role, template.projectId);
    const canManage = await canAccessProject(user.id, user.role, template.projectId, [ProjectRole.OWNER, ProjectRole.MANAGER]);
    if (!projectReadable || (template.status !== 'PUBLISHED' && template.ownerUserId !== user.id && user.role !== 'ADMIN' && !canManage)) throw new PermanentBackgroundJobError('REPORT_STUDIO_TEMPLATE_ACCESS_REVOKED');
  } else throw new PermanentBackgroundJobError('REPORT_STUDIO_TEMPLATE_ACCESS_REVOKED');
  if (payload.domain === 'PROJECT' && template.projectId && payload.projectId !== template.projectId) throw new PermanentBackgroundJobError('REPORT_STUDIO_TEMPLATE_PROJECT_MISMATCH');
  if (payload.domain === 'PARTY' && template.businessPartyId && payload.businessPartyId !== template.businessPartyId) throw new PermanentBackgroundJobError('REPORT_STUDIO_TEMPLATE_PARTY_MISMATCH');
  if (payload.projectId && !(await canAccessProject(user.id, user.role, payload.projectId))) throw new PermanentBackgroundJobError('REPORT_STUDIO_PROJECT_ACCESS_REVOKED');
  if (payload.businessPartyId && !(await canAccessBusinessParty(user.id, user.role, payload.businessPartyId))) throw new PermanentBackgroundJobError('REPORT_STUDIO_PARTY_ACCESS_REVOKED');
  const validated = validateReportStudioDefinition(payload.templateDefinition);
  if (!validated.success || validated.data.domain !== payload.domain) throw new PermanentBackgroundJobError('REPORT_STUDIO_TEMPLATE_INVALID');
  const dataset = await loadReportStudioDataset(authUser, payload.domain, payload.projectId, payload.businessPartyId);
  const buffer = await buildReportStudioWorkbook({ definition: validated.data, dataset, templateName: template.name, templateVersion: payload.templateVersion });
  const fileName = `${job.id}-${job.attempts}.xlsx`;
  await mkdir(backgroundJobStorageRoot(), { recursive: true });
  await writeFile(backgroundJobArtifactPath(fileName), buffer);
  return {
    resultFileName: fileName,
    resultMetadata: {
      templateId: template.id, templateName: template.name, templateVersion: payload.templateVersion,
      domain: payload.domain, projectId: payload.projectId ?? null, businessPartyId: payload.businessPartyId ?? null, warnings: dataset.warnings,
      suggestedFileName: `墨衡-${payload.domain === 'PROJECT' ? '项目综合经营报表' : payload.domain === 'PARTY' ? '往来单位经营档案报表' : '公司经营汇总报表'}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    },
  };
};
