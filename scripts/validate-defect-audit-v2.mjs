import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), 'utf8');
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const [rootPackage, apiPackage, webPackage, gov, ui, ops, sec, dict, config, system, auth, authRoutes, worker, server, authTests, audit] = await Promise.all([
  read('package.json').then(JSON.parse), read('apps/api/package.json').then(JSON.parse), read('apps/web/package.json').then(JSON.parse),
  read('apps/web/src/pages/SystemGovernancePage.tsx'), read('apps/web/src/components/Ui.tsx'), read('apps/web/src/pages/SystemOperationsPage.tsx'),
  read('apps/web/src/pages/SystemSecurityPage.tsx'), read('apps/web/src/pages/SystemDictionariesPage.tsx'), read('apps/api/src/routes/system-config.ts'),
  read('apps/api/src/routes/system-management.ts'), read('apps/api/src/lib/auth.ts'), read('apps/api/src/routes/auth.ts'),
  read('apps/api/src/lib/background-job-worker.ts'), read('apps/api/src/server.ts'), read('apps/api/src/lib/auth-security.test.ts'),
  read('docs/archive/源码缺陷审计与修复记录-v2.12.1-rc.1.md'),
]);

check('all version metadata advanced coherently to the current candidate', apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version);
check('defect audit validator is part of the release candidate gate', rootPackage.scripts['validate:release-candidate'].includes('validate-defect-audit-v2.mjs'));
check('organization name and account role controls resync when refreshed props change', gov.includes('setName(department.name)') && gov.includes('setDepartmentId(user.departmentId ?? \'\')') && gov.includes('setPosition(user.position ?? \'\')'));
check('default rule, running backup and cancelled task have truthful status labels', ui.includes("DEFAULT: '内置默认'") && ui.includes("RUNNING: '执行中'") && ui.includes("CANCELLED: '已取消'") && ops.includes('status={job.status}'));
check('dictionary item inputs expose accessible labels and mutation guards missing selection', dict.includes('显示名称`}') && dict.includes('说明`}') && dict.includes('排序`}') && dict.includes('if (!selected) throw new Error'));
check('API request validation details distinguish params and body errors', config.includes('params: params.error.flatten()') && config.includes('body: parsed.error.flatten()'));
check('parameter definition conflict lookup tests conflicting definitions rather than arbitrary history row', config.includes("valueType: { not: parsed.data.valueType }") && config.includes("visibility: { not: parsed.data.visibility }"));
check('parameter publish audit records the actual number of retired published versions', config.includes('previousPublishedRevisionRetired: retiredPrevious.count > 0') && config.includes('previousPublishedRevisionCount: retiredPrevious.count'));
check('project lifecycle is rechecked inside parameter draft transaction and rollback note truncation is rejected', config.includes('PARAMETER_PROJECT_UNAVAILABLE') && config.includes('rollbackNote.length > 1000'));
check('parameter effective resolver explicitly applies project overrides only when a projectId resolves', config.includes('if (query.data.projectId) {') && config.includes("for (const row of rows.filter((item) => item.scope === 'PROJECT'") && config.includes('item.projectId === query.data.projectId'));
check('system command timeout terminates child process tree and avoids double-settling timeout', system.includes('terminateCommandTree') && system.includes("['/PID', String(child.pid), '/T', '/F']") && system.includes("process.kill(-child.pid, 'SIGTERM')") && system.includes('if (!timedOut) resolvePromise'));
check('backup metadata is retired before physical cleanup and download enforces strict filename pattern', system.includes('Commit the metadata tombstone first') && system.includes("/^moheng-[A-Za-z0-9T_-]+\\.dump\\.enc$/"));
check('restore test checks PostgreSQL cluster system identifiers and fails closed when unavailable', system.includes('pg_control_system()') && system.includes('RESTORE_TARGET_CLUSTER_NOT_ISOLATED') && system.includes('RESTORE_CLUSTER_ID_UNVERIFIABLE'));
check('login throttling HMAC key is independent from JWT signing key in public mode', auth.includes('LOGIN_ATTEMPT_HMAC_KEY') && server.includes('env.LOGIN_ATTEMPT_HMAC_KEY === env.JWT_SECRET') && server.includes('env.LOGIN_ATTEMPT_HMAC_KEY === env.MFA_ENCRYPTION_KEY'));
check('login/refresh hot path no longer prunes historical auth records on every issued refresh token', auth.includes('export function loginKeyHash') && !auth.slice(auth.indexOf('export async function issueRefreshToken'), auth.indexOf('export async function createAuthSession')).includes('deleteMany'));
check('MFA encrypted payload segments are validated before AES-GCM decryption', auth.includes('Stored MFA secret has an unsupported format') && auth.includes('parts[1]') && auth.includes('parts[2]') && auth.includes('parts[3]'));
check('forced password change uses an authVersion optimistic guard and atomically revokes sessions/tokens', authRoutes.includes('authVersion: currentUser.authVersion') && authRoutes.includes('PASSWORD_CHANGE_CONFLICT') && authRoutes.includes('consumedAt: null'));
check('background failure-state persistence is guarded and logs failure diagnostics', worker.includes('Unable to persist background job failure; lease recovery will handle the task'));
check('background cleanup failures use cooldown while preserving task polling', worker.includes('lastCleanupAt = Date.now() - CLEANUP_INTERVAL_MS + 60_000') && worker.includes('Background/auth retention cleanup failed; retrying after a cooldown'));
check('security UI and audit report document schema-backed/null-safe behavior and false positives', sec.includes('session.user?.name') && audit.includes('BUG-29 | 不成立') && audit.includes('BUG-36 | 不成立'));
check('dedicated auth tests cover HMAC rotation stability and malformed MFA encryption segments', authTests.includes('JWT') && authTests.includes('LOGIN_ATTEMPT_HMAC_KEY') && authTests.includes('malformed encrypted MFA secret segments'));
check('audit report covers all 39 findings and preserves the remaining environment gates', (audit.match(/\| BUG-\d{2} \|/g) ?? []).length === 39 && audit.includes('Node.js 24+') && audit.includes('PostgreSQL'));

for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}`);
const failed = checks.filter((item) => !item.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} defect-audit checks passed`);
if (failed.length) process.exitCode = 1;
