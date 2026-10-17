import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { Prisma, type UserRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { failure } from './http.js';

export type AuthUser = { sub: string; email: string; role: UserRole; sid: string };
type TokenClaims = { sub: string; email: string; role: UserRole; sid?: string; authVersion?: number; purpose?: 'mfa-enrollment' | 'password-change' };
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 8;

function isPublicAccessMode(): boolean {
  return Boolean(process.env.PUBLIC_BASE_URL?.trim());
}

export const authRequired: preHandlerHookHandler = async (request, reply) => {
  let claims: TokenClaims;
  try {
    claims = await request.jwtVerify<TokenClaims>();
  } catch {
    return reply.code(401).send(failure(reply, 401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录'));
  }
  if (!claims.sid || claims.purpose) return reply.code(401).send(failure(reply, 401, 'SESSION_REQUIRED', '该临时凭证不能访问此资源，请完成安全验证'));
  const session = await prisma.authSession.findFirst({
    where: { id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true, authVersion: true, lastSeenAt: true, user: { select: { email: true, role: true, isActive: true, mfaEnabled: true, authVersion: true } } },
  });
  if (!session || !session.user.isActive) return reply.code(401).send(failure(reply, 401, 'SESSION_REVOKED', '登录会话已失效，请重新登录'));
  if (session.authVersion !== session.user.authVersion) {
    const now = new Date();
    await prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now, revokeReason: 'auth-version-changed' } });
    await prisma.refreshToken.updateMany({ where: { sessionId: session.id, consumedAt: null }, data: { consumedAt: now } });
    await recordSecurityEvent({ userId: session.userId, sessionId: session.id, action: 'AUTH_VERSION_CHANGED', outcome: 'SESSION_REVOKED', request });
    return reply.code(401).send(failure(reply, 401, 'SESSION_REVOKED', '账号安全信息已变化，请重新登录'));
  }
  if (Date.now() - session.lastSeenAt.getTime() > SESSION_IDLE_TIMEOUT_MS) {
    const now = new Date();
    const revoked = await prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now, revokeReason: 'idle-timeout' } });
    if (revoked.count) {
      await prisma.refreshToken.updateMany({ where: { sessionId: session.id, consumedAt: null }, data: { consumedAt: now } });
      await recordSecurityEvent({ userId: session.userId, sessionId: session.id, action: 'SESSION_IDLE_TIMEOUT', outcome: 'SESSION_REVOKED', request });
    }
    return reply.code(401).send(failure(reply, 401, 'SESSION_IDLE_TIMEOUT', '会话因长时间无操作已失效，请重新登录'));
  }
  if (isPublicAccessMode() && session.user.role === 'ADMIN' && !session.user.mfaEnabled) return reply.code(401).send(failure(reply, 401, 'ADMIN_MFA_REQUIRED', '公网访问需要管理员先启用多因素认证，请重新登录完成设置'));
  // Avoid a write on every request while keeping session activity reasonably fresh.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.authSession.updateMany({ where: { id: session.id, lastSeenAt: { lt: new Date(Date.now() - 5 * 60 * 1000) }, revokedAt: null }, data: { lastSeenAt: new Date() } });
  }
  request.user = { ...claims, email: session.user.email, role: session.user.role, sid: session.id };
};

function denyRestrictedRequest(reply: FastifyReply, statusCode: number, code: string, message: string): false {
  reply.code(statusCode).send({ success: false, error: { code, message } });
  return false;
}

export async function restrictedAuthRequired(
  request: FastifyRequest,
  reply: FastifyReply,
  purpose: 'mfa-enrollment' | 'password-change',
): Promise<boolean> {
  let claims: TokenClaims;
  try { claims = await request.jwtVerify<TokenClaims>(); }
  catch { return denyRestrictedRequest(reply, 401, 'RESTRICTED_TOKEN_INVALID', '临时验证已过期，请重新登录'); }

  if (purpose === 'password-change' && (claims.purpose !== purpose || claims.sid)) {
    return denyRestrictedRequest(reply, 401, 'PASSWORD_CHANGE_TOKEN_REQUIRED', '请通过账号登录后的密码修改流程继续');
  }

  if (claims.purpose === purpose && !claims.sid) {
    const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, role: true, authVersion: true, isActive: true, mfaEnabled: true, passwordResetRequired: true } });
    if (!user || !user.isActive || claims.authVersion !== user.authVersion || (purpose === 'mfa-enrollment' && user.role !== 'ADMIN')) {
      return denyRestrictedRequest(reply, 401, 'RESTRICTED_TOKEN_INVALID', '临时验证已失效，请重新登录');
    }
    if (purpose === 'mfa-enrollment' && user.mfaEnabled) return denyRestrictedRequest(reply, 409, 'MFA_ALREADY_ENABLED', '该管理员已启用多因素认证');
    if (purpose === 'password-change' && !user.passwordResetRequired) return denyRestrictedRequest(reply, 409, 'PASSWORD_CHANGE_NOT_REQUIRED', '当前账号无需强制修改密码');
    request.user = { sub: user.id, email: user.email, role: user.role, purpose };
    return true;
  }

  // Only a normal session may start enrollment interactively; it cannot be used
  // to bypass the forced password-change challenge.
  if (purpose !== 'mfa-enrollment' || !claims.sid || claims.purpose) {
    return denyRestrictedRequest(reply, 401, 'RESTRICTED_TOKEN_INVALID', '临时验证已失效，请重新登录');
  }
  const session = await prisma.authSession.findFirst({
    where: { id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, authVersion: true, lastSeenAt: true, user: { select: { id: true, email: true, role: true, authVersion: true, isActive: true } } },
  });
  if (!session || !session.user.isActive || session.authVersion !== session.user.authVersion || Date.now() - session.lastSeenAt.getTime() > SESSION_IDLE_TIMEOUT_MS) return denyRestrictedRequest(reply, 401, 'SESSION_REVOKED', '登录会话已失效，请重新登录');
  if (session.user.role !== 'ADMIN') return denyRestrictedRequest(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以进行此操作');
  request.user = { sub: session.user.id, email: session.user.email, role: session.user.role, sid: session.id };
  return true;
}

export function authUser(request: FastifyRequest): AuthUser {
  return request.user as AuthUser;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export async function issueRefreshToken(userId: string, sessionId: string, sessionExpiresAt: Date): Promise<string> {
  const token = newRefreshToken();
  const expiresAt = new Date(Math.min(Date.now() + REFRESH_MAX_AGE_MS, sessionExpiresAt.getTime()));
  if (expiresAt <= new Date()) throw new Error('Authentication session has expired');
  await prisma.refreshToken.create({ data: { tokenHash: hashRefreshToken(token), userId, sessionId, expiresAt } });
  return token;
}

export async function createAuthSession(userId: string, request: FastifyRequest, authVersion: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
  const session = await prisma.authSession.create({ data: {
    userId,
    authVersion,
    ipAddress: safeIp(request.ip),
    userAgent: readUserAgent(request),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  } });
  return session;
}

export async function recordSecurityEvent(input: {
  userId?: string | null; accountEmail?: string | null; sessionId?: string | null;
  action: string; outcome: string; request?: FastifyRequest; details?: Record<string, unknown>;
}) {
  await prisma.securityEvent.create({ data: {
    userId: input.userId ?? null,
    accountEmail: input.accountEmail?.slice(0, 254) ?? null,
    sessionId: input.sessionId ?? null,
    action: input.action,
    outcome: input.outcome,
    ipAddress: input.request ? safeIp(input.request.ip) : null,
    userAgent: input.request ? readUserAgent(input.request) : null,
    details: input.details as Prisma.InputJsonValue | undefined,
  } });
}

function safeIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return ip.slice(0, 64);
}
function readUserAgent(request: FastifyRequest): string | null {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 500) : null;
}

export function loginKeyHash(kind: 'email' | 'ip', value: string): string {
  // Keep rate-limit identities stable when JWT signing keys rotate. Public mode validates this dedicated key at startup.
  const dedicatedKey = process.env.LOGIN_ATTEMPT_HMAC_KEY?.trim();
  if (dedicatedKey && /^[a-fA-F0-9]{64}$/.test(dedicatedKey)) {
    return createHmac('sha256', Buffer.from(dedicatedKey, 'hex')).update(`${kind}:${value}`).digest('hex');
  }
  if (isPublicAccessMode()) throw new Error('LOGIN_ATTEMPT_HMAC_KEY_REQUIRED');
  return createHmac('sha256', process.env.JWT_SECRET ?? 'development-only-invalid-secret').update(`${kind}:${value}`).digest('hex');
}

export async function isLoginBlocked(emailHash: string, ipHash: string): Promise<boolean> {
  const now = new Date();
  const [email, ip] = await Promise.all([
    prisma.loginAttemptBucket.findUnique({ where: { keyHash: emailHash }, select: { blockedUntil: true } }),
    prisma.loginAttemptBucket.findUnique({ where: { keyHash: ipHash }, select: { blockedUntil: true } }),
  ]);
  return Boolean((email?.blockedUntil && email.blockedUntil > now) || (ip?.blockedUntil && ip.blockedUntil > now));
}

export async function registerLoginFailure(emailHash: string, ipHash: string) {
  for (const keyHash of [emailHash, ipHash]) {
    await prisma.$executeRaw`
      INSERT INTO "LoginAttemptBucket" ("keyHash", "failures", "windowStartedAt", "blockedUntil", "updatedAt")
      VALUES (${keyHash}, 1, NOW(), NULL, NOW())
      ON CONFLICT ("keyHash") DO UPDATE SET
        "failures" = CASE WHEN "LoginAttemptBucket"."windowStartedAt" < NOW() - INTERVAL '15 minutes' THEN 1 ELSE "LoginAttemptBucket"."failures" + 1 END,
        "windowStartedAt" = CASE WHEN "LoginAttemptBucket"."windowStartedAt" < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE "LoginAttemptBucket"."windowStartedAt" END,
        "blockedUntil" = CASE
          WHEN "LoginAttemptBucket"."windowStartedAt" < NOW() - INTERVAL '15 minutes' THEN NULL
          WHEN "LoginAttemptBucket"."failures" + 1 >= ${LOGIN_FAILURE_LIMIT} THEN NOW() + INTERVAL '15 minutes'
          ELSE "LoginAttemptBucket"."blockedUntil" END,
        "updatedAt" = NOW()
    `;
  }
}

export async function clearLoginFailures(emailHash: string, ipHash: string) {
  await prisma.loginAttemptBucket.deleteMany({ where: { keyHash: { in: [emailHash, ipHash] } } });
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function makeOtpAuthUrl(email: string, secret: string): string {
  const issuer = 'Moheng';
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function verifyTotp(secret: string, code: string, nowMs = Date.now()): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const current = BigInt(Math.floor(nowMs / 30_000));
  // +/- 1 time step tolerates a small clock drift. Returning the matched step
  // lets the caller atomically reject replayed codes.
  for (const step of [current - 1n, current, current + 1n]) {
    const expected = totpAtStep(key, step);
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) return step;
  }
  return null;
}

export function encryptMfaSecret(secret: string): string {
  const key = getMfaEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptMfaSecret(value: string): string {
  const parts = value.split(':');
  const version = parts[0];
  const ivHex = parts[1];
  const authTagHex = parts[2];
  const ciphertextHex = parts[3];
  if (parts.length !== 4 || version !== 'v1'
    || typeof ivHex !== 'string' || !/^[a-fA-F0-9]{24}$/.test(ivHex)
    || typeof authTagHex !== 'string' || !/^[a-fA-F0-9]{32}$/.test(authTagHex)
    || typeof ciphertextHex !== 'string' || !/^(?:[a-fA-F0-9]{2})+$/.test(ciphertextHex)) {
    throw new Error('Stored MFA secret has an unsupported format');
  }
  const key = getMfaEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
}

export function hashRecoveryCode(code: string): string {
  const normalized = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return createHmac('sha256', process.env.MFA_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET || 'development-only-invalid-secret').update(`recovery:${normalized}`).digest('hex');
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(8).toString('hex').toUpperCase());
}

function getMfaEncryptionKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw || !/^[a-fA-F0-9]{64}$/.test(raw)) throw new Error('MFA_ENCRYPTION_KEY must be a 32-byte hex string');
  return Buffer.from(raw, 'hex');
}

function totpAtStep(key: Buffer, step: bigint): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function base32Encode(bytes: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let value = 0; let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0; let value = 0; const output: number[] = [];
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 value');
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(output);
}

export function setRefreshCookie(reply: FastifyReply, token: string) {
  const secure = process.env.COOKIE_SECURE === 'true';
  const cookieName = secure ? '__Host-refreshToken' : 'refreshToken';
  reply.setCookie(cookieName, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearRefreshCookie(reply: FastifyReply) {
  const secure = process.env.COOKIE_SECURE === 'true';
  const cookieName = secure ? '__Host-refreshToken' : 'refreshToken';
  reply.clearCookie(cookieName, { path: '/' });
  // Clear the pre-upgrade cookie name as well, so deployment upgrades don't leave an old cookie behind.
  reply.clearCookie('refreshToken', { path: '/api/auth' });
}

export function requestRefreshCookie(request: FastifyRequest): string | undefined {
  return process.env.COOKIE_SECURE === 'true' ? request.cookies['__Host-refreshToken'] : request.cookies.refreshToken;
}

export const sessionConfig = { sessionMaxAgeMs: SESSION_MAX_AGE_MS, sessionIdleTimeoutMs: SESSION_IDLE_TIMEOUT_MS, refreshMaxAgeMs: REFRESH_MAX_AGE_MS, loginWindowMs: LOGIN_WINDOW_MS, loginFailureLimit: LOGIN_FAILURE_LIMIT };
