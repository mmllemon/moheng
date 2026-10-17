import type { FastifyInstance } from 'fastify';
import { ChangeStatus, EvidenceClass, ExternalConfirmationStatus, Prisma, ProjectRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { canAccessProject, denyIfNoProjectAccess } from '../lib/project-access.js';
import { nonNegativeMoney } from '../lib/validation.js';
import { recalculateEffectiveContractAmount } from '../lib/contract-amount.js';
import { moneyToCents } from '../lib/contract-amount-math.js';
import { hasInternalExternalAmountMismatch } from '../lib/contract-base-policy.js';
import { publicEvidenceFile, readEvidenceFile, removeEvidenceFiles, storeEvidenceFiles, type EvidenceFileMetadata } from '../lib/evidence-storage.js';
import { nextDocumentNumber } from '../lib/document-number.js';
import { DEFAULT_CHANGE_APPROVER_ROLES, parseChangeApprovalDefinition } from '../lib/governance-rules.js';
import { DEFAULT_CHANGE_WORKFLOW, parseWorkflowDefinition, workflowTransitionAllowed } from '../lib/workflow-definitions.js';

const changeInput = z.object({
  code: z.string().trim().max(80).optional().or(z.literal('')),
  name: z.string().trim().min(1).max(180),
  type: z.string().trim().min(1).max(60).default('ENGINEERING_CHANGE'),
  direction: z.enum(['INCREASE', 'DECREASE']).default('INCREASE'),
  occurredAt: z.string().datetime(),
  description: z.string().max(4000).optional().nullable(),
  submittedAmount: nonNegativeMoney,
});

// This is the company-internal approval decision. It deliberately does not
// control whether an externally confirmed adjustment enters the effective total.
const decisionInput = z.object({
  status: z.nativeEnum(ChangeStatus),
  approvedAmount: nonNegativeMoney.optional(),
  decisionNote: z.string().max(2000).optional().nullable(),
});

const externalConfirmationInput = z.object({
  evidenceClass: z.nativeEnum(EvidenceClass),
  evidenceAssessment: z.enum(['READY', 'SUPPLEMENT_NEEDED', 'DISPUTED']).default('READY'),
  externalConfirmerName: z.string().trim().min(1).max(160),
  externalConfirmerAuthority: z.string().trim().min(1).max(500),
  externalConfirmedAt: z.string().datetime(),
  externalConfirmedAmount: nonNegativeMoney,
  externalConfirmationScope: z.string().trim().min(1).max(4000),
  evidenceReference: z.string().trim().min(1).max(1000),
  evidenceContext: z.string().trim().min(1).max(12000),
  attachments: z.array(z.object({
    fileName: z.string().trim().min(1).max(180),
    mimeType: z.string().max(120).default(''),
    contentBase64: z.string().min(1).max(12_000_000),
  })).min(1).max(8),
});

const evidenceReviewInput = z.object({
  decision: z.enum(['VERIFIED', 'REJECTED', 'DISPUTED']),
  decisionNote: z.string().trim().max(2000).optional().nullable(),
});

const amountReviewCompletionInput = z.object({
  note: z.string().trim().min(1).max(2000),
});

const transitions: Record<ChangeStatus, ChangeStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['CONFIRMED', 'REJECTED'],
  CONFIRMED: [],
  REJECTED: ['DRAFT'],
};

function serialise(row: any) {
  return {
    ...row,
    submittedAmount: Number(row.submittedAmount),
    approvedAmount: row.approvedAmount == null ? null : Number(row.approvedAmount),
    externalConfirmedAmount: row.externalConfirmedAmount == null ? null : Number(row.externalConfirmedAmount),
    evidenceFiles: Array.isArray(row.evidenceFiles) ? row.evidenceFiles.map((file: unknown) => publicEvidenceFile(file as EvidenceFileMetadata)) : [],
  };
}

function actorIsSubmitter(row: { submittedById: string | null; createdById: string | null }, userId: string): boolean {
  // The creator is also blocked, including legacy rows without a submitter id,
  // so neither the creator nor the submitter can self-approve or self-verify.
  return row.submittedById === userId || row.createdById === userId;
}


function normaliseFingerprintText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

type ConfirmationFingerprintInput = {
  externalConfirmerName: string | null;
  externalConfirmerAuthority: string | null;
  externalConfirmedAt: Date | string | null;
  externalConfirmedAmount: unknown;
  externalConfirmationScope: string | null;
  evidenceReference: string | null;
};

function confirmationFingerprint(row: ConfirmationFingerprintInput): string | null {
  if (!row.externalConfirmerName || !row.externalConfirmedAt || row.externalConfirmedAmount == null || !row.externalConfirmationScope || !row.evidenceReference) return null;
  const date = row.externalConfirmedAt instanceof Date ? row.externalConfirmedAt : new Date(row.externalConfirmedAt);
  if (Number.isNaN(date.getTime())) return null;
  return JSON.stringify([
    normaliseFingerprintText(row.externalConfirmerName),
    normaliseFingerprintText(row.externalConfirmerAuthority),
    date.toISOString(),
    moneyToCents(row.externalConfirmedAmount).toString(),
    normaliseFingerprintText(row.externalConfirmationScope),
    normaliseFingerprintText(row.evidenceReference),
  ]);
}

function isKnownPrismaCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export async function changeRoutes(app: FastifyInstance) {
  app.get('/:projectId/changes', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const rows = await prisma.change.findMany({ where: { projectId, deletedAt: null }, include: { mainContract: { select: { id: true, contractNo: true, name: true } } }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }] });
    return success(rows.map(serialise));
  });

  app.get('/:projectId/changes/:changeId/evidence-files/:fileId', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, changeId, fileId } = request.params as { projectId: string; changeId: string; fileId: string };
    if (!(await canAccessProject(user.sub, user.role, projectId, undefined, 'PROJECT_READ'))) return failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问该项目的权限');
    const change = await prisma.change.findFirst({ where: { id: changeId, projectId, deletedAt: null }, select: { evidenceFiles: true } });
    if (!change) return failure(reply, 404, 'CHANGE_NOT_FOUND', '变更签证记录不存在');
    const files = Array.isArray(change.evidenceFiles) ? change.evidenceFiles as unknown as EvidenceFileMetadata[] : [];
    const file = files.find((candidate) => candidate.id === fileId);
    if (!file) return failure(reply, 404, 'EVIDENCE_FILE_NOT_FOUND', '凭证附件不存在');
    try {
      const bytes = await readEvidenceFile(file);
      await prisma.auditLog.create({ data: {
        projectId, userId: user.sub, entity: 'ChangeEvidenceFile', entityId: file.id,
        action: 'EVIDENCE_FILE_DOWNLOADED',
        changes: { changeId, fileName: file.fileName, sha256: file.sha256, sizeBytes: file.sizeBytes },
      } });
      return reply
        .header('Content-Type', file.mimeType)
        .header('Content-Length', String(bytes.length))
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        .send(bytes);
    } catch (error) {
      if (error instanceof Error && error.message === 'EVIDENCE_FILE_INTEGRITY_FAILED') return failure(reply, 500, 'EVIDENCE_FILE_INTEGRITY_FAILED', '凭证文件完整性校验失败，已阻止下载');
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return failure(reply, 404, 'EVIDENCE_FILE_MISSING', '凭证文件已丢失，请联系系统管理员');
      throw error;
    }
  });

  app.post('/:projectId/changes', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId } = request.params as { projectId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'CHANGE_SUBMIT')) return;
    const parsed = changeInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '变更签证资料有误', parsed.error.flatten());
    const mainContract = await prisma.mainContract.findUnique({ where: { projectId }, select: { id: true } });
    if (!mainContract) return failure(reply, 409, 'MAIN_CONTRACT_REQUIRED', '请先建立项目主合同，再登记对业主的变更签证');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { code: true } });
        const code = parsed.data.code?.trim() || await nextDocumentNumber(tx, { projectId, projectCode: project.code, type: 'BG', date: new Date(parsed.data.occurredAt) });
        const { code: _submittedCode, ...formValues } = parsed.data;
        const created = await tx.change.create({ data: {
          projectId,
          mainContractId: mainContract.id,
          ...formValues,
          code,
          occurredAt: new Date(parsed.data.occurredAt),
          submittedAmount: String(parsed.data.submittedAmount),
          createdById: user.sub,
        } });
        await tx.auditLog.create({ data: {
          projectId, userId: user.sub, entity: 'Change', entityId: created.id, action: 'CREATE',
          changes: { ...formValues, code, mainContractId: mainContract.id, submittedAmount: String(parsed.data.submittedAmount), createdById: user.sub },
        } });
        return created;
      });
      return reply.code(201).send(success(serialise(row)));
    } catch (error) {
      if (isKnownPrismaCode(error, 'P2002')) return failure(reply, 409, 'CHANGE_CODE_EXISTS', '该项目下变更编号已存在');
      throw error;
    }
  });

  app.patch('/:projectId/changes/:changeId/status', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, changeId } = request.params as { projectId: string; changeId: string };
    const parsed = decisionInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '内部审批资料有误', parsed.error.flatten());
    const allowedRoles = parsed.data.status === 'SUBMITTED'
      ? [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR]
      : [ProjectRole.OWNER, ProjectRole.MANAGER];
    const permissionKey = parsed.data.status === 'SUBMITTED' ? 'CHANGE_SUBMIT' : 'CHANGE_APPROVE';
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, allowedRoles, permissionKey)) return;
    const old = await prisma.change.findFirst({ where: { id: changeId, projectId, deletedAt: null } });
    if (!old) return failure(reply, 404, 'CHANGE_NOT_FOUND', '变更签证记录不存在');
    if (!transitions[old.status].includes(parsed.data.status)) return failure(reply, 409, 'INVALID_STATUS_TRANSITION', `不能从“${old.status}”流转到“${parsed.data.status}”`);
    if (parsed.data.status === 'CONFIRMED' && parsed.data.approvedAmount === undefined) return failure(reply, 400, 'APPROVED_AMOUNT_REQUIRED', '内部审批通过时必须填写内部核定金额');
    if (parsed.data.status === 'CONFIRMED' && actorIsSubmitter(old, user.sub)) return failure(reply, 403, 'SELF_APPROVAL_FORBIDDEN', '提交人不能审批本人提交的变更业务');

    // Company-level ADMIN is not a project approver by virtue of being ADMIN.
    // The active rule, project membership, state transition, and audit are checked
    // in one serializable transaction below so a concurrent rule publish or role
    // change cannot authorize an approval against a stale policy snapshot.
    let approvalRuleVersion: number | null = null;
    let approvalRuleRoles: ProjectRole[] = [...DEFAULT_CHANGE_APPROVER_ROLES];
    let workflowVersion: number | null = null;

    try {
      const row = await prisma.$transaction(async (tx) => {
        const publishedWorkflow = await tx.governanceRuleVersion.findFirst({
          where: { ruleKey: 'WORKFLOW:CHANGE_INTERNAL_APPROVAL', status: 'PUBLISHED' },
          orderBy: { version: 'desc' }, select: { version: true, definition: true },
        });
        const workflow = publishedWorkflow ? parseWorkflowDefinition(publishedWorkflow.definition) : DEFAULT_CHANGE_WORKFLOW;
        if (!workflow) throw new Error('CHANGE_WORKFLOW_RULE_INVALID');
        workflowVersion = publishedWorkflow?.version ?? null;
        const membership = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId: user.sub } }, select: { role: true },
        });
        if (!membership) throw new Error('CHANGE_WORKFLOW_PROJECT_MEMBERSHIP_REQUIRED');
        const workflowDecision = workflowTransitionAllowed({
          definition: workflow, from: old.status, to: parsed.data.status, role: membership.role,
          submittedAmount: old.submittedAmount,
        });
        if (!workflowDecision.allowed) throw new Error(`CHANGE_WORKFLOW_TRANSITION_DENIED:${workflowDecision.reason ?? 'UNKNOWN'}`);
        if (workflowDecision.selfApprovalForbidden && actorIsSubmitter(old, user.sub)) throw new Error('SELF_APPROVAL_FORBIDDEN');
        if (parsed.data.status === 'CONFIRMED') {
          const publishedRule = await tx.governanceRuleVersion.findFirst({
            where: { ruleKey: 'CHANGE_APPROVAL', status: 'PUBLISHED' },
            orderBy: { version: 'desc' },
            select: { version: true, definition: true },
          });
          if (publishedRule) {
            const definition = parseChangeApprovalDefinition(publishedRule.definition);
            if (!definition) throw new Error('CHANGE_APPROVAL_RULE_INVALID');
            approvalRuleVersion = publishedRule.version;
            approvalRuleRoles = definition.allowedProjectRoles;
          }
          if (!approvalRuleRoles.includes(membership.role)) throw new Error('CHANGE_APPROVAL_ROLE_REQUIRED');
        }
        const claimed = await tx.change.updateMany({
          where: { id: changeId, projectId, deletedAt: null, status: old.status },
          data: {
            status: parsed.data.status,
            ...(parsed.data.approvedAmount !== undefined ? { approvedAmount: String(parsed.data.approvedAmount) } : {}),
            ...(parsed.data.decisionNote !== undefined ? { decisionNote: parsed.data.decisionNote } : {}),
            ...(parsed.data.status === 'SUBMITTED' ? { submittedById: user.sub } : {}),
            ...(parsed.data.status === 'CONFIRMED' ? { internalApprovedById: user.sub, internalApprovedAt: new Date() } : {}),
            ...(parsed.data.status === 'DRAFT' ? { internalApprovedById: null, internalApprovedAt: null } : {}),
          },
        });
        if (claimed.count !== 1) throw new Error('INTERNAL_CHANGE_STATE_CHANGED');
        const updated = await tx.change.findFirstOrThrow({ where: { id: changeId, projectId } });
        await tx.auditLog.create({ data: {
          projectId, userId: user.sub, entity: 'Change', entityId: changeId, action: 'INTERNAL_STATUS_CHANGE',
          changes: {
            from: old.status, to: updated.status, approvedAmount: parsed.data.approvedAmount,
            decisionNote: parsed.data.decisionNote, submitterId: updated.submittedById,
            internalApproverId: updated.internalApprovedById,
            workflowSource: workflowVersion === null ? 'BUILT_IN_DEFAULT' : 'PUBLISHED', workflowVersion,
            ...(parsed.data.status === 'CONFIRMED' ? { approvalRuleVersion, approvalRuleRoles } : {}),
          },
        } });
        return updated;
      }, { isolationLevel: 'Serializable' });
      return success(serialise(row));
    } catch (error) {
      if (error instanceof Error && error.message === 'INTERNAL_CHANGE_STATE_CHANGED') return failure(reply, 409, 'INTERNAL_CHANGE_STATE_CHANGED', '变更状态已被其他人员更新，请刷新后重试');
      if (error instanceof Error && error.message === 'CHANGE_WORKFLOW_RULE_INVALID') return failure(reply, 503, 'CHANGE_WORKFLOW_RULE_INVALID', '当前已发布的内部审批流程无效，系统已拒绝状态流转');
      if (error instanceof Error && error.message === 'CHANGE_WORKFLOW_PROJECT_MEMBERSHIP_REQUIRED') return failure(reply, 403, 'CHANGE_WORKFLOW_PROJECT_MEMBERSHIP_REQUIRED', '执行内部审批状态流转的账号必须是该项目成员');
      if (error instanceof Error && error.message.startsWith('CHANGE_WORKFLOW_TRANSITION_DENIED:')) return failure(reply, 403, 'CHANGE_WORKFLOW_TRANSITION_DENIED', `当前发布的内部审批流程不允许该角色执行此状态流转（${error.message.split(':')[1]}）`);
      if (error instanceof Error && error.message === 'SELF_APPROVAL_FORBIDDEN') return failure(reply, 403, 'SELF_APPROVAL_FORBIDDEN', '提交人不能审批本人提交的变更业务');
      if (error instanceof Error && error.message === 'CHANGE_APPROVAL_ROLE_REQUIRED') return failure(reply, 403, 'CHANGE_APPROVAL_ROLE_REQUIRED', `当前项目角色无权审批该变更；生效规则允许：${approvalRuleRoles.join('、')}`);
      if (error instanceof Error && error.message === 'CHANGE_APPROVAL_RULE_INVALID') return failure(reply, 503, 'CHANGE_APPROVAL_RULE_INVALID', '当前已发布的审批规则无效，系统已拒绝审批操作');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') return failure(reply, 409, 'CHANGE_APPROVAL_CONCURRENT_UPDATE', '审批规则或项目权限发生并发变更，请刷新后重试');
      throw error;
    }
  });

  app.post('/:projectId/changes/:changeId/external-confirmation', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, changeId } = request.params as { projectId: string; changeId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER, ProjectRole.ESTIMATOR], 'CHANGE_EXTERNAL_CONFIRM')) return;
    const parsed = externalConfirmationInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '外部确认凭证信息不完整或格式不正确', parsed.error.flatten());
    const old = await prisma.change.findFirst({ where: { id: changeId, projectId, deletedAt: null } });
    if (!old) return failure(reply, 404, 'CHANGE_NOT_FOUND', '变更签证记录不存在');
    if (!['NOT_CONFIRMED', 'PENDING_SUPPLEMENT', 'REJECTED', 'DISPUTED'].includes(old.externalConfirmationStatus)) return failure(reply, 409, 'EXTERNAL_CONFIRMATION_ALREADY_RECORDED', '已生效的外部确认不可覆盖；如需更正，请另行登记变更。待补证、核验未通过或争议记录可补充证据后重新提交。')

    const nextStatus: ExternalConfirmationStatus = parsed.data.evidenceAssessment === 'SUPPLEMENT_NEEDED' ? 'PENDING_SUPPLEMENT' : parsed.data.evidenceAssessment === 'DISPUTED' ? 'DISPUTED' : parsed.data.evidenceClass === 'C' ? 'PENDING_VERIFICATION' : 'EFFECTIVE';
    const internalReferenceAmount = old.approvedAmount ?? old.submittedAmount;
    const amountMismatchTriggersReview = nextStatus === 'EFFECTIVE' && hasInternalExternalAmountMismatch(internalReferenceAmount, parsed.data.externalConfirmedAmount);
    const amountReviewTriggeredAt = amountMismatchTriggersReview ? new Date() : null;
    let storedFiles: EvidenceFileMetadata[] = [];
    const previousFiles = Array.isArray(old.evidenceFiles) ? old.evidenceFiles as unknown as EvidenceFileMetadata[] : [];
    const allFiles = [...previousFiles];
    try {
      storedFiles = await storeEvidenceFiles(projectId, changeId, parsed.data.attachments, user.sub);
      const priorHashes = new Set(previousFiles.map((file) => file.sha256));
      const thisBatchHashes = new Set<string>();
      for (const file of storedFiles) {
        if (priorHashes.has(file.sha256) || thisBatchHashes.has(file.sha256)) throw new Error('EVIDENCE_DUPLICATE_FILE');
        thisBatchHashes.add(file.sha256);
      }
      allFiles.push(...storedFiles);
      const row = await prisma.$transaction(async (tx) => {
        // Serialize duplicate checks with all confirmations for this project.
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`);
        const activeRows = await tx.change.findMany({
          where: { projectId, id: { not: changeId }, deletedAt: null, externalConfirmationStatus: { in: ['PENDING_SUPPLEMENT', 'PENDING_VERIFICATION', 'EFFECTIVE', 'REJECTED', 'DISPUTED'] } },
          select: { direction: true, externalConfirmerName: true, externalConfirmerAuthority: true, externalConfirmedAt: true, externalConfirmedAmount: true, externalConfirmationScope: true, evidenceReference: true, evidenceFiles: true },
        });
        const submittedFingerprint = confirmationFingerprint({
          externalConfirmerName: parsed.data.externalConfirmerName,
          externalConfirmerAuthority: parsed.data.externalConfirmerAuthority,
          externalConfirmedAt: parsed.data.externalConfirmedAt,
          externalConfirmedAmount: parsed.data.externalConfirmedAmount,
          externalConfirmationScope: parsed.data.externalConfirmationScope,
          evidenceReference: parsed.data.evidenceReference,
        });
        const uploadedHashes = new Set(storedFiles.map((file) => file.sha256));
        const hasDuplicateFingerprint = submittedFingerprint && activeRows.some((candidate) => confirmationFingerprint(candidate) === submittedFingerprint);
        const hasDuplicateEvidenceForSameAdjustment = activeRows.some((candidate) => {
          if (candidate.direction !== old.direction || candidate.externalConfirmedAmount == null || !candidate.externalConfirmationScope) return false;
          if (moneyToCents(candidate.externalConfirmedAmount).toString() !== moneyToCents(parsed.data.externalConfirmedAmount).toString()) return false;
          if (normaliseFingerprintText(candidate.externalConfirmationScope) !== normaliseFingerprintText(parsed.data.externalConfirmationScope)) return false;
          const candidateFiles = Array.isArray(candidate.evidenceFiles) ? candidate.evidenceFiles : [];
          return candidateFiles.some((entry) => typeof entry === 'object' && entry !== null && 'sha256' in entry && typeof entry.sha256 === 'string' && uploadedHashes.has(entry.sha256));
        });
        if (hasDuplicateFingerprint || hasDuplicateEvidenceForSameAdjustment) throw new Error('DUPLICATE_EXTERNAL_CONFIRMATION');
        const claimed = await tx.change.updateMany({
          where: { id: changeId, projectId, deletedAt: null, externalConfirmationStatus: { in: ['NOT_CONFIRMED', 'PENDING_SUPPLEMENT', 'REJECTED', 'DISPUTED'] } },
          data: {
            evidenceClass: parsed.data.evidenceClass,
            externalConfirmerName: parsed.data.externalConfirmerName,
            externalConfirmerAuthority: parsed.data.externalConfirmerAuthority,
            externalConfirmedAt: new Date(parsed.data.externalConfirmedAt),
            externalConfirmedAmount: String(parsed.data.externalConfirmedAmount),
            externalConfirmationScope: parsed.data.externalConfirmationScope,
            evidenceReference: parsed.data.evidenceReference,
            evidenceContext: parsed.data.evidenceContext,
            evidenceFiles: allFiles as unknown as Prisma.InputJsonValue,
            externalConfirmationStatus: nextStatus,
            externalRecordedById: user.sub,
            evidenceVerifiedById: null,
            evidenceVerifiedAt: null,
            evidenceVerificationNote: null,
            internalAmountReviewStatus: amountMismatchTriggersReview ? 'PENDING' : 'NOT_REQUIRED',
            internalAmountReviewReferenceAmount: amountMismatchTriggersReview ? String(internalReferenceAmount) : null,
            internalAmountReviewExternalAmount: amountMismatchTriggersReview ? String(parsed.data.externalConfirmedAmount) : null,
            internalAmountReviewTriggeredAt: amountReviewTriggeredAt,
            internalAmountReviewCompletedAt: null,
            internalAmountReviewCompletedById: null,
            internalAmountReviewNote: null,
            effectiveAt: nextStatus === 'EFFECTIVE' ? new Date() : null,
          },
        });
        if (claimed.count !== 1) throw new Error('EXTERNAL_CONFIRMATION_STATE_CHANGED');
        const updated = await tx.change.findFirstOrThrow({ where: { id: changeId, projectId } });
        if (nextStatus === 'EFFECTIVE') await recalculateEffectiveContractAmount(tx, projectId);
        await tx.auditLog.create({ data: {
          projectId, userId: user.sub, entity: 'Change', entityId: changeId,
          action: nextStatus === 'EFFECTIVE' ? (amountMismatchTriggersReview ? 'EXTERNAL_CONFIRMATION_EFFECTIVE_AMOUNT_REVIEW_REQUIRED' : 'EXTERNAL_CONFIRMATION_EFFECTIVE') : nextStatus === 'PENDING_SUPPLEMENT' ? 'EXTERNAL_CONFIRMATION_NEEDS_SUPPLEMENT' : nextStatus === 'DISPUTED' ? 'EXTERNAL_CONFIRMATION_DISPUTED' : 'EXTERNAL_CONFIRMATION_RECORDED',
          changes: {
            evidenceClass: parsed.data.evidenceClass, externalConfirmerName: parsed.data.externalConfirmerName,
            externalConfirmerAuthority: parsed.data.externalConfirmerAuthority,
            externalConfirmedAt: parsed.data.externalConfirmedAt,
            externalConfirmedAmount: String(parsed.data.externalConfirmedAmount),
            internalReferenceAmount: String(internalReferenceAmount),
            internalExternalAmountMismatch: hasInternalExternalAmountMismatch(internalReferenceAmount, parsed.data.externalConfirmedAmount),
            internalAmountReviewStatus: amountMismatchTriggersReview ? 'PENDING' : 'NOT_REQUIRED',
            externalConfirmationScope: parsed.data.externalConfirmationScope,
            evidenceReference: parsed.data.evidenceReference, evidenceContext: parsed.data.evidenceContext,
            externalConfirmationStatus: nextStatus, evidenceAssessment: parsed.data.evidenceAssessment,
            evidenceFiles: storedFiles.map(publicEvidenceFile),
            priorEvidenceClass: old.evidenceClass, priorExternalConfirmerName: old.externalConfirmerName,
            priorExternalConfirmerAuthority: old.externalConfirmerAuthority,
            priorExternalConfirmedAt: old.externalConfirmedAt?.toISOString() ?? null,
            priorExternalConfirmedAmount: old.externalConfirmedAmount == null ? null : String(old.externalConfirmedAmount),
            priorExternalConfirmationScope: old.externalConfirmationScope, priorEvidenceReference: old.evidenceReference,
            priorEvidenceContext: old.evidenceContext, priorExternalConfirmationStatus: old.externalConfirmationStatus,
            priorEvidenceVerifiedById: old.evidenceVerifiedById, priorEvidenceVerifiedAt: old.evidenceVerifiedAt?.toISOString() ?? null,
            priorEvidenceVerificationNote: old.evidenceVerificationNote,
            effectiveAt: updated.effectiveAt?.toISOString() ?? null,
          },
        } });
        return updated;
      });
      return reply.code(201).send(success(serialise(row)));
    } catch (error) {
      await removeEvidenceFiles(storedFiles);
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE') return failure(reply, 409, 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE', '该减少项会导致当前有效合同额为负数，已阻止生效');
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_EXCEEDS_MAX') return failure(reply, 409, 'CONTRACT_AMOUNT_EXCEEDS_MAX', '当前有效合同额超过数据库 DECIMAL(18,2) 上限，已阻止生效');
      if (error instanceof Error && error.message.startsWith('EVIDENCE_FILE_TYPE_NOT_ALLOWED:')) return failure(reply, 400, 'EVIDENCE_FILE_TYPE_NOT_ALLOWED', '凭证附件仅支持 PDF、PNG、JPG、WebP、TXT、EML 文件');
      if (error instanceof Error && error.message.startsWith('EVIDENCE_FILE_SIZE_INVALID:')) return failure(reply, 400, 'EVIDENCE_FILE_SIZE_INVALID', '单个凭证文件必须大于 0 且不超过 5 MiB');
      if (error instanceof Error && error.message === 'EVIDENCE_TOTAL_SIZE_EXCEEDED') return failure(reply, 400, 'EVIDENCE_TOTAL_SIZE_EXCEEDED', '凭证附件总大小不能超过 8 MiB');
      if (error instanceof Error && error.message === 'EVIDENCE_FILE_COUNT_INVALID') return failure(reply, 400, 'EVIDENCE_FILE_COUNT_INVALID', '请上传 1—8 个凭证附件');
      if (error instanceof Error && error.message === 'EVIDENCE_DUPLICATE_FILE') return failure(reply, 409, 'EVIDENCE_DUPLICATE_FILE', '附件与本变更已保存的凭证内容重复，请勿重复上传');
      if (error instanceof Error && error.message === 'DUPLICATE_EXTERNAL_CONFIRMATION') return failure(reply, 409, 'DUPLICATE_EXTERNAL_CONFIRMATION', '项目中已存在高度相似的外部确认记录，请核对是否重复登记');
      if (error instanceof Error && error.message.startsWith('EVIDENCE_FILE_BASE64_INVALID:')) return failure(reply, 400, 'EVIDENCE_FILE_BASE64_INVALID', '凭证附件数据无效，请重新选择文件');
      if (error instanceof Error && error.message.startsWith('EVIDENCE_FILE_SIGNATURE_INVALID:')) return failure(reply, 400, 'EVIDENCE_FILE_SIGNATURE_INVALID', '文件内容与扩展名不匹配，请上传原始凭证文件');
      if (error instanceof Error && error.message === 'EXTERNAL_CONFIRMATION_STATE_CHANGED') return failure(reply, 409, 'EXTERNAL_CONFIRMATION_STATE_CHANGED', '该变更的外部确认状态已被其他人员更新，请刷新后重新操作');
      throw error;
    }
  });

  app.post('/:projectId/changes/:changeId/internal-amount-review/complete', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, changeId } = request.params as { projectId: string; changeId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER], 'CHANGE_EVIDENCE_VERIFY')) return;
    const parsed = amountReviewCompletionInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '金额差异复核意见不正确', parsed.error.flatten());
    const old = await prisma.change.findFirst({ where: { id: changeId, projectId, deletedAt: null } });
    if (!old) return failure(reply, 404, 'CHANGE_NOT_FOUND', '变更签证记录不存在');
    if (old.internalAmountReviewStatus !== 'PENDING' || old.externalConfirmationStatus !== 'EFFECTIVE') return failure(reply, 409, 'AMOUNT_REVIEW_NOT_PENDING', '该记录当前没有待处理的有效金额差异复核');
    if (actorIsSubmitter(old, user.sub)) return failure(reply, 403, 'AMOUNT_REVIEW_SELF_REVIEW_FORBIDDEN', '业务创建人或提交人不能完成本人业务的金额差异复核');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const claimed = await tx.change.updateMany({
          where: { id: changeId, projectId, deletedAt: null, externalConfirmationStatus: 'EFFECTIVE', internalAmountReviewStatus: 'PENDING' },
          data: {
            internalAmountReviewStatus: 'COMPLETED',
            internalAmountReviewCompletedAt: new Date(),
            internalAmountReviewCompletedById: user.sub,
            internalAmountReviewNote: parsed.data.note,
          },
        });
        if (claimed.count !== 1) throw new Error('AMOUNT_REVIEW_STATE_CHANGED');
        const updated = await tx.change.findFirstOrThrow({ where: { id: changeId, projectId } });
        await tx.auditLog.create({ data: {
          projectId, userId: user.sub, entity: 'Change', entityId: changeId,
          action: 'INTERNAL_AMOUNT_DISCREPANCY_REVIEW_COMPLETED',
          changes: {
            status: 'COMPLETED', internalAmountReviewCompletedById: user.sub,
            internalAmountReviewNote: parsed.data.note,
            internalReferenceAmount: String(old.internalAmountReviewReferenceAmount ?? old.approvedAmount ?? old.submittedAmount),
            externalConfirmedAmount: String(old.internalAmountReviewExternalAmount ?? old.externalConfirmedAmount),
            effectiveContractAmountUnchanged: true,
          },
        } });
        return updated;
      });
      return success(serialise(row));
    } catch (error) {
      if (error instanceof Error && error.message === 'AMOUNT_REVIEW_STATE_CHANGED') return failure(reply, 409, 'AMOUNT_REVIEW_STATE_CHANGED', '金额差异复核状态已更新，请刷新页面');
      throw error;
    }
  });

  app.post('/:projectId/changes/:changeId/external-confirmation/review', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const { projectId, changeId } = request.params as { projectId: string; changeId: string };
    if (await denyIfNoProjectAccess(user.sub, user.role, projectId, reply, [ProjectRole.OWNER, ProjectRole.MANAGER], 'CHANGE_EVIDENCE_VERIFY')) return;
    const parsed = evidenceReviewInput.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '凭证核验结果不正确', parsed.error.flatten());
    if (parsed.data.decision !== 'VERIFIED' && !parsed.data.decisionNote?.trim()) return failure(reply, 400, 'DECISION_NOTE_REQUIRED', '核验不通过或存在争议时必须填写原因');
    const old = await prisma.change.findFirst({ where: { id: changeId, projectId, deletedAt: null } });
    if (!old) return failure(reply, 404, 'CHANGE_NOT_FOUND', '变更签证记录不存在');
    if (old.evidenceClass !== 'C' || old.externalConfirmationStatus !== 'PENDING_VERIFICATION') return failure(reply, 409, 'C_EVIDENCE_NOT_PENDING', '只有待核验的 C 类凭证可以执行本操作');
    if (actorIsSubmitter(old, user.sub)) return failure(reply, 403, 'EVIDENCE_SELF_VERIFICATION_FORBIDDEN', 'C 类凭证必须由不同于业务提交人的有权限人员核验');

    const status: ExternalConfirmationStatus = parsed.data.decision === 'VERIFIED' ? 'EFFECTIVE' : parsed.data.decision === 'REJECTED' ? 'REJECTED' : 'DISPUTED';
    const internalReferenceAmount = old.approvedAmount ?? old.submittedAmount;
    const amountMismatchTriggersReview = status === 'EFFECTIVE' && old.externalConfirmedAmount != null && hasInternalExternalAmountMismatch(internalReferenceAmount, old.externalConfirmedAmount);
    const amountReviewTriggeredAt = amountMismatchTriggersReview ? new Date() : null;
    try {
      const row = await prisma.$transaction(async (tx) => {
        const claimed = await tx.change.updateMany({
          where: { id: changeId, projectId, deletedAt: null, evidenceClass: 'C', externalConfirmationStatus: 'PENDING_VERIFICATION' },
          data: {
            externalConfirmationStatus: status,
            evidenceVerifiedById: user.sub,
            evidenceVerifiedAt: new Date(),
            evidenceVerificationNote: parsed.data.decisionNote ?? null,
            internalAmountReviewStatus: amountMismatchTriggersReview ? 'PENDING' : 'NOT_REQUIRED',
            internalAmountReviewReferenceAmount: amountMismatchTriggersReview ? String(internalReferenceAmount) : null,
            internalAmountReviewExternalAmount: amountMismatchTriggersReview ? String(old.externalConfirmedAmount) : null,
            internalAmountReviewTriggeredAt: amountReviewTriggeredAt,
            internalAmountReviewCompletedAt: null,
            internalAmountReviewCompletedById: null,
            internalAmountReviewNote: null,
            effectiveAt: status === 'EFFECTIVE' ? new Date() : null,
          },
        });
        if (claimed.count !== 1) throw new Error('C_EVIDENCE_STATE_CHANGED');
        const updated = await tx.change.findFirstOrThrow({ where: { id: changeId, projectId } });
        if (status === 'EFFECTIVE') await recalculateEffectiveContractAmount(tx, projectId);
        await tx.auditLog.create({ data: {
          projectId, userId: user.sub, entity: 'Change', entityId: changeId,
          action: status === 'EFFECTIVE' ? (amountMismatchTriggersReview ? 'C_EVIDENCE_VERIFIED_EFFECTIVE_AMOUNT_REVIEW_REQUIRED' : 'C_EVIDENCE_VERIFIED_EFFECTIVE') : status === 'REJECTED' ? 'C_EVIDENCE_REJECTED' : 'C_EVIDENCE_DISPUTED',
          changes: {
            from: old.externalConfirmationStatus, to: status,
            evidenceVerifiedById: user.sub, evidenceVerificationNote: parsed.data.decisionNote ?? null,
            externalConfirmedAmount: old.externalConfirmedAmount == null ? null : String(old.externalConfirmedAmount),
            internalReferenceAmount: String(internalReferenceAmount),
            internalExternalAmountMismatch: amountMismatchTriggersReview,
            internalAmountReviewStatus: amountMismatchTriggersReview ? 'PENDING' : 'NOT_REQUIRED',
          },
        } });
        return updated;
      });
      return success(serialise(row));
    } catch (error) {
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE') return failure(reply, 409, 'CONTRACT_AMOUNT_WOULD_BE_NEGATIVE', '该减少项会导致当前有效合同额为负数，已阻止生效');
      if (error instanceof Error && error.message === 'CONTRACT_AMOUNT_EXCEEDS_MAX') return failure(reply, 409, 'CONTRACT_AMOUNT_EXCEEDS_MAX', '当前有效合同额超过数据库 DECIMAL(18,2) 上限，已阻止生效');
      if (error instanceof Error && error.message === 'C_EVIDENCE_STATE_CHANGED') return failure(reply, 409, 'C_EVIDENCE_STATE_CHANGED', '该凭证已被其他人员核验，请刷新后查看结果');
      throw error;
    }
  });
}
