import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const checks = [];
async function read(path) { return readFile(join(root, path), 'utf8'); }
function check(name, pass, details = '') { checks.push({ name, pass: Boolean(pass), details }); }

const schema = await read('apps/api/prisma/schema.prisma');
const migration = await read('apps/api/prisma/migrations/20261015040000_public_access_security/migration.sql');
const authLib = await read('apps/api/src/lib/auth.ts');
const authRoutes = await read('apps/api/src/routes/auth.ts');
const server = await read('apps/api/src/server.ts');
const env = await read('apps/api/.env.example');
const loginPage = await read('apps/web/src/pages/LoginPage.tsx');
const secureStep = await read('apps/web/src/pages/AccountSecurityStepPage.tsx');
const securityPage = await read('apps/web/src/pages/SystemSecurityPage.tsx');
const userPage = await read('apps/web/src/pages/UserManagementPage.tsx');
const systemPage = await read('apps/web/src/pages/SystemManagementPage.tsx');
const app = await read('apps/web/src/App.tsx');
const caddy = await read('deploy/caddy/Caddyfile.example');
const deploymentDoc = await read('docs/公网访问与系统安全管理设计-v2.9.0-rc.1.md');
const testFile = await read('apps/api/src/lib/auth-security.test.ts');
const apiPackage = JSON.parse(await read('apps/api/package.json'));
const rootPackage = JSON.parse(await read('package.json'));
const webPackage = JSON.parse(await read('apps/web/package.json'));
const appInfo = await read('apps/api/src/platform/app-info.ts');

check('workspace, API, Web and runtime all use v2.19.0-rc.1', rootPackage.version === '2.19.0-rc.1' && apiPackage.version === rootPackage.version && webPackage.version === rootPackage.version && appInfo.includes("APP_VERSION = '2.19.0-rc.1'"));
check('public mode requires production HTTPS, loopback API bind, explicit proxy trust, Secure cookies and a distinct MFA key', server.includes('env.PUBLIC_BASE_URL') && server.includes("publicUrl.protocol !== 'https:'") && server.includes("env.COOKIE_SECURE !== 'true'") && server.includes("env.HOST !== '127.0.0.1'") && server.includes('!env.TRUST_PROXY?.trim()') && server.includes('env.MFA_ENCRYPTION_KEY === env.JWT_SECRET') && server.includes('placeholderJwtSecret') && server.includes('unsafeProxyRange') && server.includes('publicUrl.username || publicUrl.password') && server.includes('normalizedJwtSecret'));
check('proxy trust rejects wildcard trust and uses a configured allowlist', server.includes('trustProxy: env.TRUST_PROXY?.trim()') && server.includes("['*', 'true', '1'].includes(entry.trim().toLowerCase())") && server.includes("entry.trim().endsWith('/0')") && env.includes('TRUST_PROXY=127.0.0.1,::1'));
check('public mode disables the Swagger UI/API documentation endpoints', server.includes('if (!env.PUBLIC_BASE_URL) {') && server.includes("routePrefix: '/docs'"));
check('public mode uses HSTS and restrictive CSP', server.includes('contentSecurityPolicy: env.PUBLIC_BASE_URL ?') && server.includes('frameAncestors: ["\'none\'"]') && server.includes('hsts: env.PUBLIC_BASE_URL ?'));
check('RefreshToken retains consumed history and links to AuthSession', schema.includes('model RefreshToken {') && schema.includes('consumedAt DateTime?') && schema.includes('model AuthSession {') && schema.includes('session   AuthSession?'));
check('new additive migration includes session, security events, MFA recovery and attempt buckets', migration.includes('CREATE TABLE "AuthSession"') && migration.includes('CREATE TABLE "SecurityEvent"') && migration.includes('CREATE TABLE "MfaRecoveryCode"') && migration.includes('CREATE TABLE "LoginAttemptBucket"') && migration.includes('ADD COLUMN "mfaSecretEncrypted"'));
check('protected API calls validate session status, idle timeout, expiry and current account status', authLib.includes('claims.sid') && authLib.includes('revokedAt: null') && authLib.includes('SESSION_IDLE_TIMEOUT_MS') && authLib.includes('session.user.isActive') && authLib.includes('ADMIN_MFA_REQUIRED'));
check('refresh token consumption is atomic and replay revokes the related session', authRoutes.includes('UPDATE "RefreshToken" SET "consumedAt" = NOW()') && authRoutes.includes('REFRESH_TOKEN_REUSE') && authRoutes.includes('REFRESH_ROTATION_RACE') && authRoutes.includes("revokeReason: 'refresh-token-reuse'") && authRoutes.includes('LEGACY_REFRESH_REJECTED_PUBLIC') && authLib.includes('function isPublicAccessMode(): boolean'));
check('refresh token issuance is tied to a bounded session and no longer deletes tokens immediately', authLib.includes('SESSION_MAX_AGE_MS') && authLib.includes('REFRESH_MAX_AGE_MS') && authLib.includes('sessionId: string, sessionExpiresAt: Date'));
check('failed logins use identity+IP and IP HMAC buckets with a 15-minute lock window without global account lockout', authLib.includes("createHmac('sha256'") && authLib.includes('LoginAttemptBucket') && authLib.includes("INTERVAL '15 minutes'") && authRoutes.includes("loginKeyHash('email', `${email}\\u001f${request.ip}`)") && authRoutes.includes('isLoginBlocked(emailHash, ipHash)'));
check('TOTP MFA setup uses AES-256-GCM and unique recovery-code hashes', authLib.includes("createCipheriv('aes-256-gcm'") && authLib.includes('hashRecoveryCode') && authLib.includes('randomBytes(8)') && authRoutes.includes('MFA_ENCRYPTION_KEY'));
check('MFA verification supports replay checks and recovery codes are atomically consumed', authRoutes.includes('mfaLastUsedStep') && authRoutes.includes('mfaRecoveryCode.updateMany') && authRoutes.includes('usedAt: null'));
check('authVersion invalidates sessions even if a sensitive-account-change request races session creation', schema.includes('authVersion  Int') && schema.includes('authVersion Int') && migration.includes('ADD COLUMN \"authVersion\" INTEGER') && authLib.includes('session.authVersion !== session.user.authVersion') && authRoutes.includes('authVersion: { increment: 1 }'));
check('MFA enrollment confirmation is an atomic one-time transition and revokes older sessions', authRoutes.includes('MFA_ENROLLMENT_ALREADY_COMPLETED') && authRoutes.includes('mfaPendingSecretEncrypted: user.mfaPendingSecretEncrypted') && authRoutes.includes("revokeReason: 'mfa-enabled'"));
check('admin public login requires MFA and uses a restricted enrollment token before activation', authRoutes.includes("user.role === 'ADMIN' && isPublicAccessMode() && !user.mfaEnabled") && authRoutes.includes("purpose: 'mfa-enrollment'") && authLib.includes('SESSION_REQUIRED'));
check('restricted password-change and MFA tokens cannot access business APIs', authLib.includes('PASSWORD_CHANGE_TOKEN_REQUIRED') && authLib.includes("if (!claims.sid || claims.purpose)"));
check('restricted challenge tokens are invalidated by authVersion changes and limited sessions enforce idle timeout', authRoutes.includes('authVersion: user.authVersion, purpose') && authLib.includes('claims.authVersion !== user.authVersion') && authLib.includes('session.authVersion !== session.user.authVersion') && authLib.includes('Date.now() - session.lastSeenAt.getTime() > SESSION_IDLE_TIMEOUT_MS'));
check('account deactivation revokes sessions and prevents disabling the last enabled admin', authRoutes.includes('USER_DEACTIVATED') && authRoutes.includes('revokeReason: \'user-disabled\'') && authRoutes.includes("throw new Error('LAST_ACTIVE_ADMIN')") && authRoutes.includes('FOR UPDATE'));
check('password reset requires subsequent change and revokes existing sessions', authRoutes.includes('passwordResetRequired: true') && authRoutes.includes('USER_PASSWORD_RESET') && authRoutes.includes('USER_PASSWORD_CHANGED'));
check('MFA reset requires another admin and forces fresh password and MFA enrollment', authRoutes.includes('CANNOT_RESET_OWN_MFA') && authRoutes.includes('USER_MFA_RESET') && userPage.includes('重置 MFA'));
check('the security-center UI can view sessions/events and revoke sessions', securityPage.includes('/auth/security/sessions') && securityPage.includes('/auth/security/events') && securityPage.includes('sessions/${encodeURIComponent(id)}') && systemPage.includes('/system/security'));
check('public cookie endpoints enforce same-origin POSTs and MFA enrollment endpoints have tighter rate limits', authRoutes.includes('publicCookieOriginGuard') && authRoutes.includes('preHandler: publicCookieOriginGuard') && (authRoutes.match(/preHandler: publicCookieOriginGuard/g) ?? []).length >= 3 && authRoutes.includes("max: 4, timeWindow: '15 minutes'") && authRoutes.includes("max: 6, timeWindow: '5 minutes'"));
const webApi = await read('apps/web/src/api.ts');
check('refresh-token rotation races retry once without revoking a healthy cross-tab session', authRoutes.includes('REFRESH_ROTATION_RACE') && authRoutes.includes('10_000') && webApi.includes('REFRESH_ROTATION_RACE') && webApi.includes('setTimeout(resolve, 180)'));
check('login UI handles TOTP and restricted enrollment/password-reset flows without local-storage token persistence', loginPage.includes('totpCode') && loginPage.includes('setRestrictedSession') && secureStep.includes('/auth/mfa/enroll/confirm') && secureStep.includes('/auth/password/change') && !secureStep.includes('localStorage.setItem'));
check('deployment template exposes only HTTPS reverse proxy and loops back to the private API port', caddy.includes('reverse_proxy 127.0.0.1:3001') && deploymentDoc.includes('不要') && deploymentDoc.includes('PostgreSQL 5432') && deploymentDoc.includes('TCP 80/443'));
check('security unit tests cover TOTP vectors, encrypted secrets and recovery-code hashing', testFile.includes('RFC 6238') && testFile.includes('encryptMfaSecret') && testFile.includes('hashRecoveryCode') && testFile.includes('sessionConfig.sessionIdleTimeoutMs') && apiPackage.scripts.test.includes('auth-security.test.ts'));
check('public security deployment guide documents host prerequisites, env, MFA, and rollback caveats', deploymentDoc.includes('MFA_ENCRYPTION_KEY') && deploymentDoc.includes('PUBLIC_BASE_URL') && deploymentDoc.includes('回滚') && deploymentDoc.includes('生产'));

const failed = checks.filter((entry) => !entry.pass);
for (const entry of checks) console.log(`${entry.pass ? 'PASS' : 'FAIL'} ${entry.name}${entry.details ? ` — ${entry.details}` : ''}`);
console.log(`\n${checks.length - failed.length}/${checks.length} public-access security checks passed`);
if (failed.length) process.exit(1);
