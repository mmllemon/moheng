import { z } from 'zod';

export const departmentCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, '部门编码应为 2-40 位大写字母、数字、下划线或连字符');
export const departmentCreate = z.object({
  code: departmentCode,
  name: z.string().trim().min(1).max(120),
  parentId: z.string().trim().min(1).max(100).nullable().optional(),
});
export const departmentPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().trim().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个要修改的字段');
export const orgAssignment = z.object({
  departmentId: z.string().trim().min(1).max(100).nullable(),
  position: z.string().trim().max(120).nullable().optional(),
});
export const changeApprovalDraft = z.object({
  changeNote: z.string().trim().min(1).max(1000),
  allowedProjectRoles: z.array(z.enum(['OWNER', 'MANAGER'])).min(1).max(2),
}).refine((value) => new Set(value.allowedProjectRoles).size === value.allowedProjectRoles.length, '审批角色不能重复');
export const integrationCreate = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,79}$/),
  name: z.string().trim().min(1).max(120),
  adapterType: z.enum(['REST_API', 'WEBHOOK', 'ERP', 'OTHER']),
  endpointUrl: z.string().trim().url().max(1000).refine((value) => new URL(value).protocol === 'https:', '集成地址必须使用 HTTPS').optional().or(z.literal('')),
  description: z.string().trim().max(1000).optional(),
  secret: z.string().min(1).max(4096),
});
export const assistantProviderPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().max(1000).optional(),
  modelId: z.string().trim().max(200).optional(),
  apiKey: z.string().min(1).max(4096).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个要修改的字段');
export const assistantProviderLookup = z.object({
  baseUrl: z.string().trim().max(1000).optional(),
  apiKey: z.string().max(4096).optional(),
});
export const accessPolicyDraft = z.object({
  changeNote: z.string().trim().min(1).max(1000),
  permissions: z.record(z.array(z.enum(['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER']))),
});
export const workflowCodeSchema = z.enum(['CHANGE_INTERNAL_APPROVAL']);
export const workflowDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  changeNote: z.string().trim().min(1).max(1000),
  definition: z.unknown(),
});
export const integrationPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  endpointUrl: z.string().trim().url().max(1000).refine((value) => new URL(value).protocol === 'https:', '集成地址必须使用 HTTPS').nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个要修改的字段');
export const secretRotation = z.object({ secret: z.string().min(1).max(4096), changeNote: z.string().trim().max(500).optional() });
