import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(root, path), 'utf8');
const checks = [];
function check(name, pass) { checks.push({ name, pass: Boolean(pass) }); }

const [rootPackage, apiPackage, webPackage] = await Promise.all(['package.json', 'apps/api/package.json', 'apps/web/package.json'].map(async (p) => JSON.parse(await read(p))));
const [appInfo, layout, app, systemPage, accountPage, authRoutes, authLib, server, apiClient, dashboard, userGuide, designDoc] = await Promise.all([
  read('apps/api/src/platform/app-info.ts'), read('apps/web/src/components/Layout.tsx'), read('apps/web/src/App.tsx'),
  read('apps/web/src/pages/SystemManagementPage.tsx'), read('apps/web/src/pages/AccountSecurityPage.tsx'),
  read('apps/api/src/routes/auth.ts'), read('apps/api/src/lib/auth.ts'), read('apps/api/src/server.ts'),
  read('apps/web/src/api.ts'), read('apps/web/src/pages/DashboardPage.tsx'), read('docs/用户操作手册.md'),
  read('docs/系统管理扩展设计与实施方案-v2.11.0-rc.1.md'),
]);

check('all package and runtime versions agree on v2.19.0-rc.1', rootPackage.version === '2.19.0-rc.1' && apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version && appInfo.includes("APP_VERSION = '2.19.0-rc.1'"));
check('sidebar uses four distinct functional groups', layout.includes("['经营中心', '工作台', '项目管理', '系统管理']") && layout.includes("group: '经营中心'") && layout.includes("group: '工作台'") && layout.includes("group: '项目管理'") && layout.includes("group: '系统管理'"));
check('project archive and membership routes belong to project management, not system management', layout.includes("to: '/projects', label: '项目档案'") && layout.includes("to: '/projects/members', label: '项目成员与权限'") && !layout.includes("to: '/system/members'") && app.includes('path="projects/members" element={<NeedProject><ProjectMembersPage /></NeedProject>}') && app.includes('path="system/members" element={<Navigate to="/projects/members" replace />}'));
check('business audit is grouped under system management with an admin-only page gate', layout.includes("to: '/audit-logs', label: '操作追溯', icon: History, group: '系统管理', end: true, adminOnly: true") && app.includes('<Route path="audit-logs" element={<AdminOnly><AuditLogsPage /></AdminOnly>} />') && dashboard.includes(`currentUser?.role === 'ADMIN' && <button type="button" className="panel-header-action"`));
check('system management landing is a dashboard, not a repeated project/account navigation directory', systemPage.includes('系统管理概览') && systemPage.includes('最近 200 条中的有效会话') && systemPage.includes('需要关注的安全事件') && systemPage.includes('系统管理扩展入口') && !systemPage.includes("to: '/projects'") && !systemPage.includes("to: '/projects/members'"));
check('system management overview links to implemented governance and operations workbenches', systemPage.includes('组织与规则治理') && systemPage.includes('运行维护与备份恢复') && systemPage.includes('/system/governance') && systemPage.includes('/system/operations'));
check('account popover exposes personal security and limits system-security shortcut to admins', layout.includes('个人中心与账号安全') && layout.includes("navigate('/account/security')") && layout.includes("user?.role === 'ADMIN' && <button") && layout.includes('登录安全中心'));
check('personal password-change page loads MFA state, fails closed on unknown MFA state, and submits a current/new password pair', accountPage.includes("api.get<{ id: string; name: string; email: string; role: 'ADMIN' | 'USER'; mfaEnabled: boolean; passwordResetRequired: boolean }>('/auth/me')") && accountPage.includes('currentPassword') && accountPage.includes('newPassword') && accountPage.includes('confirmPassword') && accountPage.includes('totpCode') && accountPage.includes('if (meQuery.error || !meQuery.data)') && accountPage.includes(`window.setTimeout(() => { clearSession(); navigate('/login', { replace: true }); }, 1200)`));
check('self-service password change requires a valid session, current password, 12+ char new password, and rate limiting', authRoutes.includes("app.post('/password/change-self', { preHandler: authRequired") && authRoutes.includes("max: 5, timeWindow: '15 minutes'") && authRoutes.includes("currentPassword: z.string().min(1).max(200)") && authRoutes.includes("newPassword: z.string().min(12") && authRoutes.includes('CURRENT_PASSWORD_INVALID') && authRoutes.includes('PASSWORD_UNCHANGED'));
check('MFA-enabled password change requires and consumes a fresh TOTP step or a one-time recovery code', authRoutes.includes("action: 'SELF_PASSWORD_CHANGE_MFA_FAILED'") && authRoutes.includes('mfaLastUsedStep') && authRoutes.includes('hashRecoveryCode(suppliedMfa)') && authRoutes.includes('usedAt: null'));
check('successful self password change atomically invalidates every session and refresh token and audits the event', authRoutes.includes('authVersion: user.authVersion') && authRoutes.includes('authVersion: { increment: 1 }') && authRoutes.includes("revokeReason: 'self-password-changed'") && authRoutes.includes("action: 'USER_PASSWORD_CHANGED_SELF'") && authRoutes.includes("action: 'SELF_PASSWORD_CHANGED'") && authRoutes.includes("changed: true, mustLoginAgain: true, sessionsRevoked: true"));
check('security logger redacts current/new passwords, TOTP and recovery-code request fields', server.includes('req.body.currentPassword') && server.includes('req.body.newPassword') && server.includes('req.body.totpCode') && server.includes('req.body.recoveryCode'));
check('legacy member URL redirects to canonical project-management path and query/hash remain preserved', app.includes("suffix === '/members' ? '/projects/members'") && app.includes("suffix === '/members' ? '/projects/members'"));
check('docs distinguish implemented source mechanisms from pending real public-deployment validation', userGuide.includes('个人中心与自主修改密码') && designDoc.includes('真实公网') && designDoc.includes('真实公网') && designDoc.includes('不能认为已经正式上线'));

const failures = checks.filter((entry) => !entry.pass);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}`);
console.log(`\n${checks.length - failures.length}/${checks.length} system-management/navigation/self-password checks passed.`);
if (failures.length) process.exitCode = 1;
