import type { FastifyReply } from 'fastify';
import type { ProjectRole, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { failure } from './http.js';

export async function canAccessProject(
  userId: string,
  globalRole: UserRole,
  projectId: string,
  allowedRoles?: ProjectRole[],
): Promise<boolean> {
  if (globalRole === 'ADMIN') return true;
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  if (!membership) return false;
  return !allowedRoles || allowedRoles.includes(membership.role);
}

export async function denyIfNoProjectAccess(
  userId: string,
  globalRole: UserRole,
  projectId: string,
  reply: FastifyReply,
  allowedRoles?: ProjectRole[],
): Promise<boolean> {
  const hasAccess = await canAccessProject(userId, globalRole, projectId, allowedRoles);
  if (!hasAccess) {
    failure(reply, 403, 'PROJECT_ACCESS_DENIED', '你没有访问或操作该项目的权限');
    return true;
  }
  return false;
}
