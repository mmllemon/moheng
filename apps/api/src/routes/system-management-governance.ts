import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProjectRole, Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { success, failure } from '../lib/http.js';
import { authUser } from '../lib/auth.js';
import { departmentCreate, departmentPatch, orgAssignment, changeApprovalDraft, accessPolicyDraft, workflowCodeSchema, workflowDraftSchema } from './system-management.schemas.js';
import { DEFAULT_CHANGE_APPROVER_ROLES, parseChangeApprovalDefinition } from '../lib/governance-rules.js';
import { PROJECT_PERMISSION_BASELINES, PROJECT_PERMISSION_LABELS, defaultProjectPermissionPolicy, parseProjectPermissionPolicy } from '../lib/access-policy.js';
import { parseWorkflowDefinition } from '../lib/workflow-definitions.js';

export async function registerGovernanceRoutes(app: FastifyInstance) {
  app.get('/authorization/matrix', async () => {
    const publishedApprovalRule = await prisma.governanceRuleVersion.findFirst({
      where: { ruleKey: 'CHANGE_APPROVAL', status: 'PUBLISHED' },
      orderBy: { version: 'desc' }, select: { version: true, definition: true },
    });
    const parsedApprovalRule = publishedApprovalRule ? parseChangeApprovalDefinition(publishedApprovalRule.definition) : null;
    const allowedApprovalRoles: ProjectRole[] = publishedApprovalRule
      ? (parsedApprovalRule?.allowedProjectRoles ?? [])
      : [...DEFAULT_CHANGE_APPROVER_ROLES];
    const approvalSource = !publishedApprovalRule ? 'BUILT_IN_DEFAULT' : parsedApprovalRule ? 'PUBLISHED' : 'INVALID';
    return success({
    approvalPolicy: { source: approvalSource, version: publishedApprovalRule?.version ?? null, allowedProjectRoles: allowedApprovalRoles },
    companyRoles: [
      { role: 'ADMIN', label: '系统管理员', description: '可访问系统管理；业务数据跨项目访问不受 ProjectMember 限制。高风险业务操作仍须满足业务状态机和审计规则。' },
      { role: 'USER', label: '普通账号', description: '无公司级系统管理权限；业务数据必须有对应项目成员关系。部门/岗位归属不授予任何项目访问权。' },
    ],
    projectRoles: [
      { role: 'OWNER', label: '项目负责人', read: true, record: true, approve: allowedApprovalRoles.includes('OWNER'), manageMembers: true, memberAssignment: ['MANAGER', 'ESTIMATOR', 'VIEWER'] },
      { role: 'MANAGER', label: '项目经理', read: true, record: true, approve: allowedApprovalRoles.includes('MANAGER'), manageMembers: true, memberAssignment: ['ESTIMATOR', 'VIEWER'] },
      { role: 'ESTIMATOR', label: '预算/成本经办', read: true, record: true, approve: false, manageMembers: false, memberAssignment: [] },
      { role: 'VIEWER', label: '只读成员', read: true, record: false, approve: false, manageMembers: false, memberAssignment: [] },
    ],
    modules: [
      { code: 'PROJECT_DATA', label: '项目业务数据读取', allowed: ['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER'], note: '需先具有项目成员关系；系统管理员按公司级角色绕过项目成员检查。' },
      { code: 'COST_AND_BUDGET_WRITE', label: '目标成本与实际成本录入', allowed: ['OWNER', 'MANAGER', 'ESTIMATOR'], note: '服务端逐接口校验；VIEWER 只读。' },
      { code: 'CHANGE_SUBMIT', label: '变更签证提交', allowed: ['OWNER', 'MANAGER', 'ESTIMATOR'], note: '提交后仍需独立内部审批与外部确认，不因本矩阵而跳过。' },
      { code: 'CHANGE_APPROVAL', label: '变更签证内部决定', allowed: allowedApprovalRoles, note: approvalSource === 'INVALID' ? '已发布审批规则结构无效；后端会拒绝审批，需管理员修复并重新发布。' : `${approvalSource === 'PUBLISHED' ? `按已发布 v${publishedApprovalRule?.version} 规则` : '按系统内置默认规则'}；禁止提交人审批本人单据，外部确认与合同金额生效规则独立。` },
      { code: 'MEMBER_ASSIGNMENT', label: '项目成员角色分配', allowed: ['OWNER', 'MANAGER'], note: 'OWNER 可分配 MANAGER/ESTIMATOR/VIEWER；MANAGER 仅能分配 ESTIMATOR/VIEWER；系统管理员可通过公司级管理接口分配全部项目角色。' },
      { code: 'SYSTEM_GOVERNANCE', label: '系统账号、安全、配置、备份与公司级审计', allowed: ['ADMIN'], note: '前端菜单与页面守卫不是安全边界，API 仍须执行管理员授权。' },
    ],
    scopeRules: [
      { code: 'ADMIN_CROSS_PROJECT', label: '系统管理员', detail: '可以跨项目访问业务数据；高风险写操作仍受对应业务权限、状态机和审计约束。' },
      { code: 'USER_PROJECT_MEMBERSHIP', label: '普通账号', detail: '只可访问自己所属项目；跨项目报表必须先按成员关系过滤，传入无权 projectId 时拒绝或按接口约定隐藏对象存在性。' },
      { code: 'DEPARTMENT_IS_NOT_PERMISSION', label: '部门/岗位', detail: '仅为组织目录属性，不替代公司角色或 ProjectMember 角色。' },
    ],
    editable: false,
    });
  });

  app.get('/authorization-reviews', async () => {
    const rows = await prisma.systemAuthorizationReview.findMany({
      take: 20, orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, summary: true, reviewNote: true, createdById: true, reviewedById: true, createdAt: true, reviewedAt: true,
        createdBy: { select: { id: true, name: true, email: true } }, reviewedBy: { select: { id: true, name: true, email: true } } },
    });
    return success(rows);
  });

  app.get('/authorization-reviews/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '授权复核记录编号有误', params.error.flatten());
    const row = await prisma.systemAuthorizationReview.findUnique({
      where: { id: params.data.id },
      include: { createdBy: { select: { id: true, name: true, email: true } }, reviewedBy: { select: { id: true, name: true, email: true } } },
    });
    if (!row) return failure(reply, 404, 'AUTHORIZATION_REVIEW_NOT_FOUND', '授权复核记录不存在');
    return success(row);
  });

  app.post('/authorization-reviews', async (request, reply) => {
    const actor = authUser(request);
    const now = new Date();
    // A Repeatable Read transaction keeps user, membership, and project rows on
    // one database snapshot so concurrent role changes cannot create a mixed-time review.
    const { userRows, memberRows, projectRows } = await prisma.$transaction(async (tx) => {
      const userRows = await tx.user.findMany({
        take: 2001, orderBy: [{ email: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, email: true, role: true, isActive: true, mfaEnabled: true, passwordResetRequired: true, department: { select: { id: true, code: true, name: true, isActive: true } } },
      });
      const memberRows = await tx.projectMember.findMany({
        take: 5001, orderBy: [{ projectId: 'asc' }, { userId: 'asc' }],
        select: { id: true, projectId: true, userId: true, role: true, createdAt: true,
          user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
          project: { select: { id: true, code: true, name: true, status: true, deletedAt: true } } },
      });
      const projectRows = await tx.project.findMany({ where: { deletedAt: null }, take: 2001, orderBy: [{ code: 'asc' }, { id: 'asc' }], select: { id: true, code: true, name: true, status: true } });
      return { userRows, memberRows, projectRows };
    }, { isolationLevel: 'RepeatableRead' });
    const users = userRows.slice(0, 2000);
    const memberships = memberRows.slice(0, 5000);
    const projects = projectRows.slice(0, 2000);
    const usersTruncated = userRows.length > 2000;
    const membershipsTruncated = memberRows.length > 5000;
    const projectsTruncated = projectRows.length > 2000;
    const capped = usersTruncated || membershipsTruncated || projectsTruncated;
    const membershipsByUser = new Map<string, typeof memberships>();
    const membershipsByProject = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      const userMemberships = membershipsByUser.get(membership.userId) ?? [];
      userMemberships.push(membership); membershipsByUser.set(membership.userId, userMemberships);
      const projectMemberships = membershipsByProject.get(membership.projectId) ?? [];
      projectMemberships.push(membership); membershipsByProject.set(membership.projectId, projectMemberships);
    }
    const findings: Array<{ code: string; severity: 'ERROR' | 'WARNING' | 'INFO'; title: string; userId?: string; projectId?: string; detail: string }> = [];
    for (const user of users) {
      const grants = membershipsByUser.get(user.id) ?? [];
      if (!user.isActive && grants.length) findings.push({ code: 'INACTIVE_USER_HAS_PROJECT_GRANTS', severity: 'WARNING', title: '停用账号仍保留项目授权', userId: user.id, detail: `${user.name} · ${user.email} · ${membershipsTruncated ? '至少 ' : ''}${grants.length} 个项目授权${membershipsTruncated ? '（授权总清单已截断）' : ''}；停用会阻止其登录，但应复核是否撤销历史授权。` });
      if (!usersTruncated && !membershipsTruncated && user.isActive && user.role === 'USER' && grants.length === 0) findings.push({ code: 'ACTIVE_USER_WITHOUT_PROJECT_GRANTS', severity: 'INFO', title: '启用账号未分配项目', userId: user.id, detail: `${user.name} · ${user.email}；请确认是否为有意保留的账号。` });
      if (user.isActive && user.role === 'ADMIN' && (!user.mfaEnabled || user.passwordResetRequired)) findings.push({ code: 'ADMIN_ACCOUNT_SECURITY_REVIEW', severity: 'ERROR', title: '管理员账号安全状态待复核', userId: user.id, detail: `${user.name} · MFA=${user.mfaEnabled ? '已启用' : '未启用'} · 强制改密=${user.passwordResetRequired ? '是' : '否'}` });
    }
    if (!membershipsTruncated && !projectsTruncated) {
      for (const project of projects) {
        const grants = membershipsByProject.get(project.id) ?? [];
        if (!grants.some((grant) => grant.role === ProjectRole.OWNER)) findings.push({ code: 'PROJECT_WITHOUT_OWNER', severity: 'WARNING', title: '项目未配置负责人角色', projectId: project.id, detail: `${project.code} · ${project.name}；请确认负责人是否有意缺位。` });
      }
    }
    // Do not infer missing grants/owners from a partially captured membership list.
    if (membershipsTruncated) findings.push({ code: 'MEMBERSHIP_SNAPSHOT_TRUNCATED', severity: 'WARNING', title: '成员授权明细达到快照上限', detail: '本次只快照前 5000 项成员授权；依赖授权明细的异常项可能不完整，不应据此直接撤销或认定授权缺失。' });
    if (usersTruncated) findings.push({ code: 'ACCOUNT_SNAPSHOT_TRUNCATED', severity: 'WARNING', title: '账号快照达到上限', detail: '本次只快照前 2000 个账号；账号相关异常项可能不完整。' });
    if (projectsTruncated) findings.push({ code: 'PROJECT_SNAPSHOT_TRUNCATED', severity: 'WARNING', title: '项目快照达到上限', detail: '本次只巡检前 2000 个未归档项目；项目负责人检查可能不完整。' });
    const summary = {
      capturedAt: now.toISOString(), totalAccounts: users.length, activeAccounts: users.filter((row) => row.isActive).length,
      inactiveAccounts: users.filter((row) => !row.isActive).length, projects: projects.length, grants: memberships.length,
      adminsWithoutMfaOrWithReset: users.filter((row) => row.isActive && row.role === 'ADMIN' && (!row.mfaEnabled || row.passwordResetRequired)).length,
      disabledAccountsWithGrants: findings.filter((row) => row.code === 'INACTIVE_USER_HAS_PROJECT_GRANTS').length,
      projectsWithoutOwner: membershipsTruncated || projectsTruncated ? null : findings.filter((row) => row.code === 'PROJECT_WITHOUT_OWNER').length,
      findings: findings.length, truncated: capped,
    };
    const snapshotMemberships = memberships.map((membership) => ({
      ...membership, createdAt: membership.createdAt.toISOString(),
      project: { ...membership.project, deletedAt: membership.project.deletedAt?.toISOString() ?? null },
    }));
    const snapshot = { version: 1, ...summary, users, memberships: snapshotMemberships, usersTruncated, membershipsTruncated, projectsTruncated, findings: findings.slice(0, 5000) } as unknown as Prisma.InputJsonValue;
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.systemAuthorizationReview.create({
        data: { status: 'PENDING', summary: summary as unknown as Prisma.InputJsonValue, snapshot, createdById: actor.sub },
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemAuthorizationReview', entityId: row.id, action: 'AUTHORIZATION_REVIEW_CREATED', changes: summary as unknown as Prisma.InputJsonValue } });
      return row;
    });
    return reply.code(201).send(success({ id: created.id, status: created.status, summary: created.summary, reviewNote: created.reviewNote, createdAt: created.createdAt, reviewedAt: created.reviewedAt, createdBy: created.createdBy, reviewedBy: null }));
  });

  app.patch('/authorization-reviews/:id/complete', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().trim().min(1).max(100) }).safeParse(request.params);
    const body = z.object({ reviewNote: z.string().trim().min(1).max(1000) }).safeParse(request.body);
    if (!params.success || !body.success) return failure(reply, 400, 'VALIDATION_ERROR', '复核记录编号或复核说明有误', { params: params.success ? undefined : params.error.flatten(), body: body.success ? undefined : body.error.flatten() });
    const row = await prisma.$transaction(async (tx) => {
      const changed = await tx.systemAuthorizationReview.updateMany({ where: { id: params.data.id, status: 'PENDING' }, data: { status: 'REVIEWED', reviewNote: body.data.reviewNote, reviewedById: actor.sub, reviewedAt: new Date() } });
      if (changed.count !== 1) return null;
      const saved = await tx.systemAuthorizationReview.findUniqueOrThrow({ where: { id: params.data.id } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemAuthorizationReview', entityId: saved.id, action: 'AUTHORIZATION_REVIEW_COMPLETED', changes: { status: saved.status, reviewNote: saved.reviewNote, summary: saved.summary } } });
      return saved;
    });
    if (!row) return failure(reply, 409, 'AUTHORIZATION_REVIEW_ALREADY_COMPLETED_OR_MISSING', '复核记录不存在或已由其他管理员完成，请刷新列表');
    return success(row);
  });

  app.get('/departments', async () => {
    const rows = await prisma.department.findMany({
      include: { parent: { select: { id: true, code: true, name: true } }, _count: { select: { users: true, children: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return success(rows.map((row) => ({ id: row.id, code: row.code, name: row.name, parentId: row.parentId, parent: row.parent, isActive: row.isActive, userCount: row._count.users, childCount: row._count.children, createdAt: row.createdAt, updatedAt: row.updatedAt })));
  });

  app.post('/departments', async (request, reply) => {
    const actor = authUser(request);
    const parsed = departmentCreate.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '部门资料有误', parsed.error.flatten());
    if (parsed.data.parentId) {
      const parent = await prisma.department.findUnique({ where: { id: parsed.data.parentId }, select: { id: true, isActive: true } });
      if (!parent || !parent.isActive) return failure(reply, 400, 'DEPARTMENT_PARENT_INVALID', '上级部门不存在或已停用');
    }
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.department.create({ data: { ...parsed.data, parentId: parsed.data.parentId ?? null } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'Department', entityId: created.id, action: 'DEPARTMENT_CREATED', changes: { code: created.code, name: created.name, parentId: created.parentId } } });
        return created;
      });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'DEPARTMENT_CODE_EXISTS', '部门编码已存在');
      throw error;
    }
  });

  app.patch('/departments/:id', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = departmentPatch.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '部门修改参数有误');
    const old = await prisma.department.findUnique({ where: { id: params.data.id } });
    if (!old) return failure(reply, 404, 'DEPARTMENT_NOT_FOUND', '部门不存在');
    const nextParentId = parsed.data.parentId === undefined ? old.parentId : parsed.data.parentId;
    if (nextParentId) {
      let cursor: string | null = nextParentId;
      const visited = new Set<string>([old.id]);
      while (cursor) {
        if (visited.has(cursor)) return failure(reply, 409, 'DEPARTMENT_CYCLE', '上级部门关系不能形成循环');
        visited.add(cursor);
        // Snapshot the narrowed cursor into an explicitly typed local so TS cannot
        // infer a circular dependency between the query result and cursor reassignment.
        const cursorId: string = cursor;
        const parent: { id: string; parentId: string | null; isActive: boolean } | null = await prisma.department.findUnique({ where: { id: cursorId }, select: { id: true, parentId: true, isActive: true } });
        if (!parent || !parent.isActive) return failure(reply, 400, 'DEPARTMENT_PARENT_INVALID', '上级部门不存在或已停用');
        cursor = parent.parentId;
      }
    }
    if (parsed.data.isActive === false) {
      const [activeUsers, activeChildren] = await Promise.all([
        prisma.user.count({ where: { departmentId: old.id, isActive: true } }),
        prisma.department.count({ where: { parentId: old.id, isActive: true } }),
      ]);
      if (activeUsers || activeChildren) return failure(reply, 409, 'DEPARTMENT_IN_USE', '部门仍有关联的启用账号或启用子部门，请先调整归属');
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.department.update({ where: { id: old.id }, data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'Department', entityId: old.id, action: 'DEPARTMENT_UPDATED', changes: { before: { name: old.name, parentId: old.parentId, isActive: old.isActive }, after: { name: row.name, parentId: row.parentId, isActive: row.isActive } } } });
      return row;
    });
    return success(updated);
  });

  app.patch('/users/:id/organization', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = orgAssignment.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '账号组织归属参数有误');
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, departmentId: true, position: true } });
    if (!target) return failure(reply, 404, 'USER_NOT_FOUND', '账号不存在');
    if (parsed.data.departmentId) {
      const department = await prisma.department.findUnique({ where: { id: parsed.data.departmentId }, select: { id: true, isActive: true } });
      if (!department?.isActive) return failure(reply, 400, 'DEPARTMENT_INVALID', '归属部门不存在或已停用');
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({ where: { id: target.id }, data: { departmentId: parsed.data.departmentId, ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}) }, select: { id: true, name: true, email: true, role: true, departmentId: true, position: true } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: target.id, action: 'USER_ORGANIZATION_UPDATED', changes: { before: { departmentId: target.departmentId, position: target.position }, after: { departmentId: row.departmentId, position: row.position } } } });
      return row;
    });
    return success(updated);
  });

  app.get('/access-policy', async () => {
    const rows = await prisma.governanceRuleVersion.findMany({
      where: { ruleKey: 'PROJECT_ACCESS_POLICY' }, orderBy: { version: 'desc' }, take: 100,
      include: { createdBy: { select: { id: true, name: true, email: true } }, publishedBy: { select: { id: true, name: true, email: true } } },
    });
    const published = rows.find((row) => row.status === 'PUBLISHED');
    const policy = published ? parseProjectPermissionPolicy(published.definition) : defaultProjectPermissionPolicy();
    return success({
      current: { source: published ? (policy ? 'PUBLISHED' : 'INVALID') : 'BUILT_IN_DEFAULT', version: published?.version ?? null, policy: policy ?? defaultProjectPermissionPolicy() },
      baselines: PROJECT_PERMISSION_BASELINES, labels: PROJECT_PERMISSION_LABELS, items: rows,
    });
  });

  app.post('/access-policy/drafts', async (request, reply) => {
    const actor = authUser(request);
    const parsed = accessPolicyDraft.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '项目权限策略草稿有误', parsed.error.flatten());
    const policy = parseProjectPermissionPolicy(parsed.data.permissions);
    if (!policy) return failure(reply, 400, 'ACCESS_POLICY_INVALID', '角色权限包含未知权限键、空角色集合、重复角色或超出源码安全上限的授权');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey: 'PROJECT_ACCESS_POLICY' }, orderBy: { version: 'desc' }, select: { version: true } });
        const version = (latest?.version ?? 0) + 1;
        const created = await tx.governanceRuleVersion.create({ data: {
          ruleKey: 'PROJECT_ACCESS_POLICY', name: '项目角色权限策略', version, status: 'DRAFT',
          definition: policy as unknown as Prisma.InputJsonValue, changeNote: parsed.data.changeNote, createdById: actor.sub,
        } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'PROJECT_ACCESS_POLICY_DRAFT_CREATED', changes: { version, changeNote: parsed.data.changeNote, permissionKeys: Object.keys(policy) } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) return failure(reply, 409, 'ACCESS_POLICY_VERSION_CONFLICT', '权限策略版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.post('/access-policy/rollback', async (request, reply) => {
    const actor = authUser(request);
    const parsed = z.object({ sourceRevisionId: z.string().min(1).max(100), changeNote: z.string().trim().min(1).max(1000) }).safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '权限策略回滚参数有误');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const source = await tx.governanceRuleVersion.findUnique({ where: { id: parsed.data.sourceRevisionId } });
        if (!source || source.ruleKey !== 'PROJECT_ACCESS_POLICY' || !parseProjectPermissionPolicy(source.definition)) throw new Error('ACCESS_POLICY_SOURCE_INVALID');
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey: 'PROJECT_ACCESS_POLICY' }, orderBy: { version: 'desc' }, select: { version: true } });
        const created = await tx.governanceRuleVersion.create({ data: { ruleKey: source.ruleKey, name: source.name, version: (latest?.version ?? 0) + 1, status: 'DRAFT', definition: source.definition as Prisma.InputJsonValue, changeNote: `${parsed.data.changeNote}（从 v${source.version} 复制为新草稿）`.slice(0, 1000), createdById: actor.sub } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'PROJECT_ACCESS_POLICY_ROLLBACK_DRAFT_CREATED', changes: { sourceRevisionId: source.id, sourceVersion: source.version, newVersion: created.version } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (error instanceof Error && error.message === 'ACCESS_POLICY_SOURCE_INVALID') return failure(reply, 400, 'ACCESS_POLICY_SOURCE_INVALID', '回滚来源不是有效的权限策略版本');
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) return failure(reply, 409, 'ACCESS_POLICY_VERSION_CONFLICT', '权限策略版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.get('/workflows', async () => {
    const items = await prisma.governanceRuleVersion.findMany({
      where: { ruleKey: { startsWith: 'WORKFLOW:' } }, orderBy: [{ ruleKey: 'asc' }, { version: 'desc' }], take: 200,
      include: { createdBy: { select: { id: true, name: true, email: true } }, publishedBy: { select: { id: true, name: true, email: true } } },
    });
    const publishedChangeWorkflow = items.find((item) => item.ruleKey === 'WORKFLOW:CHANGE_INTERNAL_APPROVAL' && item.status === 'PUBLISHED');
    return success({ items, effectiveChangeWorkflow: publishedChangeWorkflow ? { source: parseWorkflowDefinition(publishedChangeWorkflow.definition) ? 'PUBLISHED' : 'INVALID', version: publishedChangeWorkflow.version, definition: parseWorkflowDefinition(publishedChangeWorkflow.definition) } : { source: 'BUILT_IN_DEFAULT', version: null, definition: null } });
  });

  app.post('/workflows/:code/drafts', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ code: workflowCodeSchema }).safeParse(request.params);
    const parsed = workflowDraftSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '流程定义草稿参数有误', { ...(!params.success ? { params: params.error.flatten() } : {}), ...(!parsed.success ? { body: parsed.error.flatten() } : {}) });
    const definition = parseWorkflowDefinition(parsed.data.definition);
    if (!definition) return failure(reply, 400, 'WORKFLOW_DEFINITION_INVALID', '流程状态或迁移定义无效；当前执行引擎只接受受控状态集，并对角色、条件、重复迁移做校验');
    const ruleKey = `WORKFLOW:${params.data.code}`;
    try {
      const row = await prisma.$transaction(async (tx) => {
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey }, orderBy: { version: 'desc' }, select: { version: true } });
        const created = await tx.governanceRuleVersion.create({ data: { ruleKey, name: parsed.data.name, version: (latest?.version ?? 0) + 1, status: 'DRAFT', definition: definition as unknown as Prisma.InputJsonValue, changeNote: parsed.data.changeNote, createdById: actor.sub } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'WORKFLOW_DRAFT_CREATED', changes: { ruleKey, version: created.version, name: created.name, changeNote: created.changeNote, transitionCount: definition.transitions.length } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) return failure(reply, 409, 'WORKFLOW_VERSION_CONFLICT', '流程版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.post('/workflows/rollback', async (request, reply) => {
    const actor = authUser(request);
    const parsed = z.object({ sourceRevisionId: z.string().min(1).max(100), changeNote: z.string().trim().min(1).max(1000) }).safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '流程回滚参数有误');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const source = await tx.governanceRuleVersion.findUnique({ where: { id: parsed.data.sourceRevisionId } });
        if (!source || !source.ruleKey.startsWith('WORKFLOW:') || !parseWorkflowDefinition(source.definition)) throw new Error('WORKFLOW_SOURCE_INVALID');
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey: source.ruleKey }, orderBy: { version: 'desc' }, select: { version: true } });
        const created = await tx.governanceRuleVersion.create({ data: { ruleKey: source.ruleKey, name: source.name, version: (latest?.version ?? 0) + 1, status: 'DRAFT', definition: source.definition as Prisma.InputJsonValue, changeNote: `${parsed.data.changeNote}（从 v${source.version} 复制为新草稿）`.slice(0, 1000), createdById: actor.sub } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'WORKFLOW_ROLLBACK_DRAFT_CREATED', changes: { sourceRevisionId: source.id, sourceVersion: source.version, newVersion: created.version } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (error instanceof Error && error.message === 'WORKFLOW_SOURCE_INVALID') return failure(reply, 400, 'WORKFLOW_SOURCE_INVALID', '回滚来源不是有效的流程版本');
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) return failure(reply, 409, 'WORKFLOW_VERSION_CONFLICT', '流程版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.get('/rules', async () => {
    const items = await prisma.governanceRuleVersion.findMany({ orderBy: [{ ruleKey: 'asc' }, { version: 'desc' }], take: 100, include: { createdBy: { select: { id: true, name: true, email: true } }, publishedBy: { select: { id: true, name: true, email: true } } } });
    const published = items.find((item) => item.ruleKey === 'CHANGE_APPROVAL' && item.status === 'PUBLISHED');
    return success({
      items,
      effectiveChangeApproval: published ? { ruleKey: published.ruleKey, version: published.version, status: published.status, definition: published.definition, source: 'PUBLISHED' } : { ruleKey: 'CHANGE_APPROVAL', version: null, status: 'DEFAULT', definition: { allowedProjectRoles: ['OWNER', 'MANAGER'] }, source: 'BUILT_IN_DEFAULT' },
    });
  });

  app.post('/rules/change-approval/drafts', async (request, reply) => {
    const actor = authUser(request);
    const parsed = changeApprovalDraft.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '变更审批规则内容不正确', parsed.error.flatten());
    try {
      const row = await prisma.$transaction(async (tx) => {
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey: 'CHANGE_APPROVAL' }, orderBy: { version: 'desc' }, select: { version: true } });
        const version = (latest?.version ?? 0) + 1;
        const created = await tx.governanceRuleVersion.create({ data: {
          ruleKey: 'CHANGE_APPROVAL', name: '变更签证内部审批角色规则', version, status: 'DRAFT',
          definition: { allowedProjectRoles: parsed.data.allowedProjectRoles } as Prisma.InputJsonValue,
          changeNote: parsed.data.changeNote, createdById: actor.sub,
        } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'GOVERNANCE_RULE_DRAFT_CREATED', changes: { ruleKey: created.ruleKey, version, allowedProjectRoles: parsed.data.allowedProjectRoles, changeNote: parsed.data.changeNote } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'GOVERNANCE_RULE_VERSION_CONFLICT', '规则版本号冲突，请刷新后重试');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') return failure(reply, 409, 'GOVERNANCE_RULE_VERSION_CONFLICT', '检测到并发创建，请刷新后重试');
      throw error;
    }
  });

  app.post('/rules/:id/publish', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '规则版本编号有误');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const draft = await tx.governanceRuleVersion.findUnique({ where: { id: params.data.id } });
        if (!draft) throw new Error('GOVERNANCE_RULE_NOT_FOUND');
        if (draft.status !== 'DRAFT') throw new Error('GOVERNANCE_RULE_NOT_DRAFT');
        const validDefinition = draft.ruleKey === 'CHANGE_APPROVAL' ? Boolean(parseChangeApprovalDefinition(draft.definition))
          : draft.ruleKey === 'PROJECT_ACCESS_POLICY' ? Boolean(parseProjectPermissionPolicy(draft.definition))
          : draft.ruleKey.startsWith('WORKFLOW:') ? Boolean(parseWorkflowDefinition(draft.definition)) : false;
        if (!validDefinition) throw new Error('GOVERNANCE_RULE_INVALID');
        await tx.governanceRuleVersion.updateMany({ where: { ruleKey: draft.ruleKey, status: 'PUBLISHED' }, data: { status: 'RETIRED' } });
        const published = await tx.governanceRuleVersion.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedById: actor.sub, publishedAt: new Date() } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: draft.id, action: 'GOVERNANCE_RULE_PUBLISHED', changes: { ruleKey: draft.ruleKey, version: draft.version, definition: draft.definition, changeNote: draft.changeNote } } });
        return published;
      }, { isolationLevel: 'Serializable' });
      return success(row);
    } catch (error) {
      if (error instanceof Error && error.message === 'GOVERNANCE_RULE_NOT_FOUND') return failure(reply, 404, 'GOVERNANCE_RULE_NOT_FOUND', '规则版本不存在');
      if (error instanceof Error && error.message === 'GOVERNANCE_RULE_NOT_DRAFT') return failure(reply, 409, 'GOVERNANCE_RULE_NOT_DRAFT', '只有草稿版本可以发布');
      if (error instanceof Error && error.message === 'GOVERNANCE_RULE_INVALID') return failure(reply, 409, 'GOVERNANCE_RULE_INVALID', '规则定义无效，拒绝发布');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') return failure(reply, 409, 'GOVERNANCE_RULE_CONCURRENT_PUBLISH', '检测到并发发布，请刷新后重试');
      throw error;
    }
  });
}
