import type { ProjectPermissionKey, ProjectPermissionPolicy } from './access-policy.js';
import type { UserRole } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';
import { defaultProjectPermissionPolicy, parseProjectPermissionPolicy } from './access-policy.js';

export function permitsCrossProjectRead(input: {
  globalRole: UserRole | string;
  userRole: UserRole | string;
  isActive: boolean;
  dataScope: string;
  permissionKey: ProjectPermissionKey;
  policy: ProjectPermissionPolicy | null;
}): boolean {
  if (input.globalRole === 'ADMIN') return true;
  if (!input.isActive || input.userRole !== 'USER' || input.dataScope !== 'ALL_PROJECTS_READONLY') return false;
  if (input.permissionKey !== 'PROJECT_READ' && input.permissionKey !== 'REPORT_EXPORT') return false;
  if (!input.policy || !input.policy.PROJECT_READ.includes('VIEWER')) return false;
  return input.permissionKey !== 'REPORT_EXPORT' || input.policy.REPORT_EXPORT.includes('VIEWER');
}

/**
 * Cross-project access is an explicit account scope and is strictly read-only.
 * It can never grant membership-management, cost/finance writes, approval, or confirmation.
 * A virtual VIEWER must still be allowed by the active project permission policy.
 */
export async function hasCrossProjectReadScope(
  userId: string,
  globalRole: UserRole | string,
  permissionKey: ProjectPermissionKey,
): Promise<boolean> {
  if (globalRole === 'ADMIN') return true;
  if (permissionKey !== 'PROJECT_READ' && permissionKey !== 'REPORT_EXPORT') return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, dataScope: true, role: true } });
  if (!user) return false;
  const published = await prisma.governanceRuleVersion.findFirst({
    where: { ruleKey: 'PROJECT_ACCESS_POLICY', status: 'PUBLISHED' },
    orderBy: { version: 'desc' }, select: { definition: true },
  });
  const policy = published ? parseProjectPermissionPolicy(published.definition) : defaultProjectPermissionPolicy();
  return permitsCrossProjectRead({ globalRole, userRole: user.role, isActive: user.isActive, dataScope: user.dataScope, permissionKey, policy });
}
