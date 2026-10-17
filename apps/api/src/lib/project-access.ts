import type { FastifyReply } from 'fastify';
import type { ProjectRole, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { failure } from './http.js';
import { parseProjectPermissionPolicy, type ProjectPermissionKey } from './access-policy.js';
import { hasCrossProjectReadScope } from './project-data-scope.js';

export async function canAccessProject(
  userId: string,
  globalRole: UserRole,
  projectId: string,
  allowedRoles?: ProjectRole[],
  permissionKey?: ProjectPermissionKey,
): Promise<boolean> {
  if (globalRole === 'ADMIN') return true;
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  if (!membership) {
    if (!permissionKey || !(await hasCrossProjectReadScope(userId, globalRole, permissionKey))) return false;
    // A cross-project read grant never revives soft-deleted/archived project records.
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } });
    return Boolean(project);
  }
  if (allowedRoles && !allowedRoles.includes(membership.role)) return false;
  if (!permissionKey) return true;

  // Published matrix is an additional server-side restriction, never a way to widen the
  // endpoint's code-defined ceiling. An invalid published policy fails closed for keyed APIs.
  const published = await prisma.governanceRuleVersion.findFirst({
    where: { ruleKey: 'PROJECT_ACCESS_POLICY', status: 'PUBLISHED' },
    orderBy: { version: 'desc' }, select: { definition: true },
  });
  if (!published) return true;
  const policy = parseProjectPermissionPolicy(published.definition);
  if (!policy) return false;
  return policy[permissionKey].includes(membership.role);
}

export async function denyIfNoProjectAccess(
  userId: string,
  globalRole: UserRole,
  projectId: string,
  reply: FastifyReply,
  allowedRoles?: ProjectRole[],
  permissionKey?: ProjectPermissionKey,
): Promise<boolean> {
  const hasAccess = await canAccessProject(userId, globalRole, projectId, allowedRoles, permissionKey);
  if (!hasAccess) {
    failure(reply, 403, permissionKey ? 'PROJECT_PERMISSION_DENIED' : 'PROJECT_ACCESS_DENIED', permissionKey ? '当前项目角色未获此业务操作的授权；请联系系统管理员核查已发布权限策略' : '你没有访问或操作该项目的权限');
    return true;
  }
  return false;
}
