import type { ProjectRole } from '@prisma/client';

export const DEFAULT_CHANGE_APPROVER_ROLES: readonly ProjectRole[] = ['OWNER', 'MANAGER'];
export type ChangeApprovalDefinition = { allowedProjectRoles: ProjectRole[] };

export function parseChangeApprovalDefinition(value: unknown): ChangeApprovalDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = (value as Record<string, unknown>).allowedProjectRoles;
  if (!Array.isArray(allowed) || allowed.length < 1 || allowed.some((role) => role !== 'OWNER' && role !== 'MANAGER')) return null;
  const roles = [...new Set(allowed as ProjectRole[])];
  if (roles.length !== allowed.length) return null;
  return { allowedProjectRoles: roles };
}
