import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  authRequired, authUser, clearLoginFailures, clearRefreshCookie, createAuthSession, decryptMfaSecret,
  encryptMfaSecret, generateRecoveryCodes, hashRecoveryCode, hashRefreshToken, isLoginBlocked,
  issueRefreshToken, loginKeyHash, makeOtpAuthUrl, newTotpSecret, recordSecurityEvent,
  registerLoginFailure, requestRefreshCookie, restrictedAuthRequired, setRefreshCookie, verifyTotp,
} from '../lib/auth.js';
import { failure, success } from '../lib/http.js';

const loginBody = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200), totpCode: z.string().trim().max(100).optional() });
const createUserBody = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254), password: z.string().min(12, '初始密码至少 12 位').max(200) });
const passwordBody = z.object({ password: z.string().min(12, '密码至少 12 位').max(200) });
const statusBody = z.object({ isActive: z.boolean() });
const totpBody = z.object({ code: z.string().trim().min(6).max(100) });

function publicUser(user: { id: string; name: string; email: string; role: 'ADMIN' | 'USER' }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function isPublicAccessMode() {
  return Boolean(process.env.PUBLIC_BASE_URL?.trim());
}

async function publicCookieOriginGuard(request: FastifyRequest, reply: FastifyReply) {
  const configuredOrigin = process.env.PUBLIC_BASE_URL?.trim();
  if (!configuredOrigin) return;
  let expectedOrigin: string;
  try { expectedOrigin = new URL(configuredOrigin).origin; }
  catch { return failure(reply, 503, 'PUBLIC_ORIGIN_INVALID', '服务器公网源站配置无效'); }
  if (request.headers.origin !== expectedOrigin) {
    // Do not write one database row for every unauthenticated CSRF probe.
    return failure(reply, 403, 'ORIGIN_REJECTED', '请求来源不符合公网安全策略');
  }
}

function restrictedToken(app: FastifyInstance, user: { id: string; email: string; role: 'ADMIN' | 'USER'; authVersion: number }, purpose: 'mfa-enrollment' | 'password-change') {
  // Tie challenge tokens to the account security version. Password/MFA resets invalidate old challenges.
  return app.jwt.sign({ sub: user.id, email: user.email, role: user.role, authVersion: user.authVersion, purpose }, { expiresIn: '10m' });
}

export async function authRoutes(app: FastifyInstance) {
  /* 登录限流参数由 server.ts 从环境变量注入（LOGIN_RATE_LIMIT_MAX / LOGIN_RATE_LIMIT_WINDOW），
     默认 12 次 / 15 分钟。E2E 与视觉回归可调高，生产保持默认。 */
  const loginRateLimit = (app as FastifyInstance & {
    loginRateLimit?: { max: number; timeWindow: string };
  }).loginRateLimit ?? { max: 12, timeWindow: '15 minutes' };

  app.post('/login', {
    preHandler: publicCookieOriginGuard,
    config: { rateLimit: { ...loginRateLimit, keyGenerator: (request) => request.ip } },
  }, async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '请检查邮箱、密码和验证器验证码', parsed.error.flatten());
    const email = parsed.data.email.toLowerCase();
    // Pair identity and IP so an attacker cannot globally lock a victim's account from unrelated networks.
    const emailHash = loginKeyHash('email', `${email}\u001f${request.ip}`);
    const ipHash = loginKeyHash('ip', request.ip);
    if (await isLoginBlocked(emailHash, ipHash)) {
      await recordSecurityEvent({ accountEmail: email, action: 'LOGIN_RATE_LIMITED', outcome: 'BLOCKED', request });
      return failure(reply, 429, 'LOGIN_TEMPORARILY_BLOCKED', '登录尝试过多，请稍后再试');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordOk = Boolean(user && user.isActive && await bcrypt.compare(parsed.data.password, user.passwordHash));
    if (!user || !passwordOk) {
      await registerLoginFailure(emailHash, ipHash);
      await recordSecurityEvent({ userId: user?.id, accountEmail: email, action: 'LOGIN_FAILED', outcome: 'DENIED', request, details: { reason: user?.isActive === false ? 'inactive' : 'credentials' } });
      return failure(reply, 401, 'INVALID_CREDENTIALS', '邮箱或密码不正确');
    }

    if (user.mfaEnabled) {
      const supplied = parsed.data.totpCode ?? '';
      if (!supplied) return failure(reply, 401, 'MFA_REQUIRED', '该账号已启用多因素认证，请输入验证器验证码或恢复码');
      let mfaValid = false;
      let acceptedStep: bigint | null = null;
      if (/^\d{6}$/.test(supplied)) {
        try {
          if (user.mfaSecretEncrypted) acceptedStep = verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted), supplied);
        } catch (error) {
          request.log.error({ err: error, userId: user.id }, 'MFA secret could not be verified');
        }
        if (acceptedStep !== null) {
          const updated = await prisma.$executeRaw`
            UPDATE "User" SET "mfaLastUsedStep" = ${acceptedStep}
            WHERE "id" = ${user.id} AND ("mfaLastUsedStep" IS NULL OR "mfaLastUsedStep" < ${acceptedStep})
          `;
          mfaValid = updated === 1;
        }
      } else {
        const codeHash = hashRecoveryCode(supplied);
        const consumed = await prisma.mfaRecoveryCode.updateMany({ where: { userId: user.id, codeHash, usedAt: null }, data: { usedAt: new Date() } });
        mfaValid = consumed.count === 1;
      }
      if (!mfaValid) {
        await registerLoginFailure(emailHash, ipHash);
        await recordSecurityEvent({ userId: user.id, accountEmail: email, action: 'LOGIN_MFA_FAILED', outcome: 'DENIED', request });
        return failure(reply, 401, 'INVALID_MFA_CODE', '验证码或恢复码不正确，或该验证码已使用');
      }
    }

    await clearLoginFailures(emailHash, ipHash);

    if (user.passwordResetRequired) {
      await recordSecurityEvent({ userId: user.id, accountEmail: email, action: 'PASSWORD_CHANGE_REQUIRED', outcome: 'CHALLENGE', request });
      return success({ flow: 'password-change' as const, restrictedToken: restrictedToken(app, user, 'password-change'), user: publicUser(user) });
    }

    if (user.role === 'ADMIN' && isPublicAccessMode() && !user.mfaEnabled) {
      await recordSecurityEvent({ userId: user.id, accountEmail: email, action: 'ADMIN_MFA_SETUP_REQUIRED', outcome: 'CHALLENGE', request });
      return success({ flow: 'mfa-enrollment' as const, restrictedToken: restrictedToken(app, user, 'mfa-enrollment'), user: publicUser(user) });
    }

    const session = await createAuthSession(user.id, request, user.authVersion);
    const refreshToken = await issueRefreshToken(user.id, session.id, session.expiresAt);
    setRefreshCookie(reply, refreshToken);
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: session.id }, { expiresIn: '15m' });
    await recordSecurityEvent({ userId: user.id, accountEmail: email, sessionId: session.id, action: 'LOGIN_SUCCEEDED', outcome: 'ALLOWED', request });
    return success({ accessToken, user: publicUser(user) });
  });

  app.post('/refresh', { preHandler: publicCookieOriginGuard }, async (request, reply) => {
    const oldToken = requestRefreshCookie(request);
    if (!oldToken) return failure(reply, 401, 'REFRESH_TOKEN_MISSING', '登录已过期，请重新登录');
    const tokenHash = hashRefreshToken(oldToken);
    const consumed = await prisma.$queryRaw<Array<{ id: string; userId: string; sessionId: string | null }>>`
      UPDATE "RefreshToken" SET "consumedAt" = NOW()
      WHERE "tokenHash" = ${tokenHash} AND "consumedAt" IS NULL AND "expiresAt" > NOW()
      RETURNING "id", "userId", "sessionId"
    `;
    const current = consumed[0];
    if (!current) {
      const previous = await prisma.refreshToken.findUnique({ where: { tokenHash }, select: { userId: true, sessionId: true, consumedAt: true } });
      if (previous?.consumedAt && Date.now() - previous.consumedAt.getTime() <= 10_000) {
        // Parallel browser tabs may submit the same single-use cookie before the winning response updates the shared cookie jar.
        // A short retryable grace window avoids turning a benign race into a full-session logout.
        await recordSecurityEvent({ userId: previous.userId, sessionId: previous.sessionId, action: 'REFRESH_TOKEN_ROTATION_RACE', outcome: 'RETRYABLE', request });
        return failure(reply, 409, 'REFRESH_ROTATION_RACE', '登录状态正在其他标签页更新，请自动重试');
      }
      if (previous?.consumedAt) {
        if (previous.sessionId) {
          const now = new Date();
          await prisma.authSession.updateMany({ where: { id: previous.sessionId, revokedAt: null }, data: { revokedAt: now, revokeReason: 'refresh-token-reuse' } });
          await prisma.refreshToken.updateMany({ where: { sessionId: previous.sessionId, consumedAt: null }, data: { consumedAt: now } });
        }
        await recordSecurityEvent({ userId: previous.userId, sessionId: previous.sessionId, action: 'REFRESH_TOKEN_REUSE', outcome: previous.sessionId ? 'SESSION_REVOKED' : 'DENIED_NO_SESSION', request });
      }
      clearRefreshCookie(reply);
      return failure(reply, 401, 'REFRESH_TOKEN_INVALID', '登录已过期或会话已撤销，请重新登录');
    }

    const user = await prisma.user.findUnique({ where: { id: current.userId } });
    if (!user || !user.isActive) {
      if (current.sessionId) await prisma.authSession.updateMany({ where: { id: current.sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'user-disabled' } });
      clearRefreshCookie(reply);
      return failure(reply, 401, 'USER_DISABLED', '账号不可用，请联系管理员');
    }

    if (isPublicAccessMode() && user.role === 'ADMIN' && !user.mfaEnabled) {
      if (current.sessionId) await prisma.authSession.updateMany({ where: { id: current.sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'admin-mfa-required' } });
      clearRefreshCookie(reply);
      return failure(reply, 401, 'ADMIN_MFA_REQUIRED', '公网访问需要管理员先启用多因素认证，请重新登录完成设置');
    }

    let sessionId = current.sessionId;
    let sessionExpiresAt: Date;
    if (sessionId) {
      const session = await prisma.authSession.findFirst({ where: { id: sessionId, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!session) {
        clearRefreshCookie(reply);
        return failure(reply, 401, 'SESSION_REVOKED', '登录会话已失效，请重新登录');
      }
      if (session.authVersion !== user.authVersion) {
        const now = new Date();
        await prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now, revokeReason: 'auth-version-changed' } });
        await prisma.refreshToken.updateMany({ where: { sessionId: session.id, consumedAt: null }, data: { consumedAt: now } });
        await recordSecurityEvent({ userId: user.id, sessionId: session.id, action: 'AUTH_VERSION_CHANGED', outcome: 'SESSION_REVOKED', request });
        clearRefreshCookie(reply);
        return failure(reply, 401, 'SESSION_REVOKED', '账号安全信息已变化，请重新登录');
      }
      if (Date.now() - session.lastSeenAt.getTime() > 12 * 60 * 60 * 1000) {
        const now = new Date();
        await prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: now, revokeReason: 'idle-timeout' } });
        await prisma.refreshToken.updateMany({ where: { sessionId: session.id, consumedAt: null }, data: { consumedAt: now } });
        await recordSecurityEvent({ userId: user.id, sessionId: session.id, action: 'SESSION_IDLE_TIMEOUT', outcome: 'SESSION_REVOKED', request });
        clearRefreshCookie(reply);
        return failure(reply, 401, 'SESSION_IDLE_TIMEOUT', '会话因长时间无操作已失效，请重新登录');
      }
      sessionExpiresAt = session.expiresAt;
      await prisma.authSession.updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    } else {
      // Public mode must force a fresh login after migration to the Secure __Host cookie.
      // Never allow a legacy session-less refresh token to be promoted merely because a client renamed its cookie.
      if (isPublicAccessMode()) {
        clearRefreshCookie(reply);
        await recordSecurityEvent({ userId: user.id, action: 'LEGACY_REFRESH_REJECTED_PUBLIC', outcome: 'DENIED', request });
        return failure(reply, 401, 'LEGACY_REFRESH_REJECTED_PUBLIC', '公网安全升级要求重新登录，请使用账号和多因素认证重新验证');
      }
      // Promote refresh tokens issued before the session model migration only in non-public compatibility mode.
      const session = await createAuthSession(user.id, request, user.authVersion);
      sessionId = session.id;
      sessionExpiresAt = session.expiresAt;
      const linked = await prisma.refreshToken.updateMany({ where: { id: current.id, sessionId: null, consumedAt: { not: null } }, data: { sessionId } });
      if (linked.count !== 1) {
        await prisma.authSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'legacy-refresh-race' } });
        await recordSecurityEvent({ userId: user.id, sessionId: session.id, action: 'LEGACY_REFRESH_PROMOTION_RACE', outcome: 'DENIED', request });
        clearRefreshCookie(reply);
        return failure(reply, 409, 'LEGACY_REFRESH_RACE', '旧版登录状态正在迁移，请重新登录');
      }
    }

    const newToken = await issueRefreshToken(user.id, sessionId, sessionExpiresAt);
    setRefreshCookie(reply, newToken);
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email, role: user.role, sid: sessionId }, { expiresIn: '15m' });
    return success({ accessToken, user: publicUser(user) });
  });

  app.post('/logout', { preHandler: publicCookieOriginGuard }, async (request, reply) => {
    const cookie = requestRefreshCookie(request);
    let sessionId: string | undefined;
    let userId: string | undefined;
    if (cookie) {
      const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(cookie) }, select: { sessionId: true, userId: true } });
      sessionId = record?.sessionId ?? undefined;
      userId = record?.userId ?? undefined;
    }
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const claims = app.jwt.verify<{ sid?: string; sub?: string }>(header.slice(7));
        sessionId ??= claims.sid;
        userId ??= claims.sub;
      } catch { /* Logout must also work after the access token expires. */ }
    }
    if (sessionId) await prisma.authSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'logout' } });
    if (userId) await recordSecurityEvent({ userId, sessionId, action: 'LOGOUT', outcome: 'ALLOWED', request });
    clearRefreshCookie(reply);
    return success({ loggedOut: true, requestId: randomUUID() });
  });

  app.get('/users', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以查看全部账号');
    const rows = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, dataScope: true, isActive: true, passwordResetRequired: true, mfaEnabled: true, mfaEnrolledAt: true, departmentId: true, position: true, department: { select: { id: true, code: true, name: true } }, createdAt: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return success(rows);
  });

  app.post('/users', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以创建账号');
    const parsed = createUserBody.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '账号资料有误', parsed.error.flatten());
    const email = parsed.data.email.trim().toLowerCase();
    try {
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { name: parsed.data.name, email, passwordHash, role: 'USER', passwordResetRequired: true }, select: { id: true, name: true, email: true, role: true, isActive: true, passwordResetRequired: true, createdAt: true } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: created.id, action: 'USER_CREATED', changes: { name: created.name, email: created.email, role: created.role, passwordResetRequired: true } } });
        await tx.securityEvent.create({ data: { userId: created.id, accountEmail: email, action: 'USER_CREATED', outcome: 'ALLOWED', ipAddress: request.ip.slice(0, 64), userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 500) : null, details: { actorUserId: actor.sub } } });
        return created;
      });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'USER_EMAIL_EXISTS', '该邮箱已被注册');
      throw error;
    }
  });

  app.patch('/users/:id/status', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以修改账号状态');
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = statusBody.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '账号状态参数有误');
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, email: true, role: true, isActive: true } });
    if (!target) return failure(reply, 404, 'USER_NOT_FOUND', '账号不存在');
    if (!parsed.data.isActive && target.id === actor.sub) return failure(reply, 409, 'CANNOT_DISABLE_SELF', '不能停用当前登录的管理员账号');
    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (!parsed.data.isActive && target.role === 'ADMIN' && target.isActive) {
          // Lock all active admin rows so two concurrent disable requests cannot remove the final admin.
          const activeAdmins = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "role" = 'ADMIN' AND "isActive" = TRUE FOR UPDATE`;
          if (activeAdmins.length <= 1) throw new Error('LAST_ACTIVE_ADMIN');
        }
        const row = await tx.user.update({ where: { id: target.id }, data: { isActive: parsed.data.isActive, authVersion: { increment: 1 } }, select: { id: true, name: true, email: true, role: true, isActive: true } });
        if (!parsed.data.isActive) await tx.authSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'user-disabled' } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: target.id, action: parsed.data.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', changes: { isActive: parsed.data.isActive } } });
        await tx.securityEvent.create({ data: { userId: target.id, accountEmail: target.email, action: parsed.data.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', outcome: 'ALLOWED', ipAddress: request.ip.slice(0, 64), userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 500) : null, details: { actorUserId: actor.sub } } });
        return row;
      }, { isolationLevel: 'Serializable' });
      return success(updated);
    } catch (error) {
      if (error instanceof Error && error.message === 'LAST_ACTIVE_ADMIN') return failure(reply, 409, 'LAST_ACTIVE_ADMIN', '不能停用最后一个启用状态的系统管理员');
      throw error;
    }
  });


  app.patch('/users/:id/data-scope', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以调整跨项目数据范围');
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = z.object({ dataScope: z.enum(['ASSIGNED_PROJECTS', 'ALL_PROJECTS_READONLY']) }).safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '跨项目数据范围参数不正确', { ...(!params.success ? { params: params.error.flatten() } : {}), ...(!parsed.success ? { body: parsed.error.flatten() } : {}) });
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, name: true, email: true, role: true, dataScope: true, isActive: true } });
    if (!target) return failure(reply, 404, 'USER_NOT_FOUND', '账号不存在');
    if (target.role === 'ADMIN') return failure(reply, 409, 'ADMIN_SCOPE_IS_GLOBAL', '系统管理员由公司级身份控制，不能通过普通账号数据范围限制；请通过受控管理员身份流程调整');
    if (target.dataScope === parsed.data.dataScope) return success({ ...target, unchanged: true });
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({ where: { id: target.id, role: 'USER', dataScope: target.dataScope }, data: { dataScope: parsed.data.dataScope, authVersion: { increment: 1 } } });
      if (changed.count !== 1) throw new Error('USER_DATA_SCOPE_CONFLICT');
      const row = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { id: true, name: true, email: true, role: true, dataScope: true, isActive: true } });
      await tx.authSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'data-scope-changed' } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: target.id, action: 'USER_PROJECT_DATA_SCOPE_CHANGED', changes: { from: target.dataScope, to: row.dataScope, sessionsRevoked: true, readOnlyExpansion: row.dataScope === 'ALL_PROJECTS_READONLY' } } });
      await tx.securityEvent.create({ data: { userId: target.id, accountEmail: target.email, action: 'PROJECT_DATA_SCOPE_CHANGED', outcome: 'ALLOWED', ipAddress: request.ip.slice(0, 64), userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 500) : null, details: { actorUserId: actor.sub, from: target.dataScope, to: row.dataScope, sessionsRevoked: true } } });
      return row;
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'USER_DATA_SCOPE_CONFLICT') return null;
      throw error;
    });
    if (!updated) return failure(reply, 409, 'USER_DATA_SCOPE_CONFLICT', '账号授权范围已被其他管理员修改，请刷新后重试');
    return success({ ...updated, sessionsRevoked: true });
  });

  app.post('/users/:id/reset-password', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以重置账号密码');
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = passwordBody.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '新密码至少 12 位');
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, email: true } });
    if (!target) return failure(reply, 404, 'USER_NOT_FOUND', '账号不存在');
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { passwordHash, passwordResetRequired: true, authVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'password-reset' } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: target.id, action: 'USER_PASSWORD_RESET', changes: { passwordResetRequired: true, sessionsRevoked: true } } });
      await tx.securityEvent.create({ data: { userId: target.id, accountEmail: target.email, action: 'USER_PASSWORD_RESET', outcome: 'ALLOWED', ipAddress: request.ip.slice(0, 64), userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 500) : null, details: { actorUserId: actor.sub } } });
    });
    return success({ reset: true, passwordResetRequired: true, sessionsRevoked: true });
  });

  app.post('/users/:id/reset-mfa', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以重置多因素认证');
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '账号编号有误');
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, email: true, role: true, mfaEnabled: true } });
    if (!target) return failure(reply, 404, 'USER_NOT_FOUND', '账号不存在');
    if (target.id === actor.sub) return failure(reply, 409, 'CANNOT_RESET_OWN_MFA', '不能通过当前会话重置自己的 MFA，请使用已保存的恢复码或由另一位管理员处理');
    if (!target.mfaEnabled) return failure(reply, 409, 'MFA_NOT_ENABLED', '该账号尚未启用 MFA');
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaPendingSecretEncrypted: null, mfaEnrolledAt: null, mfaLastUsedStep: null, passwordResetRequired: true, authVersion: { increment: 1 } } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: target.id } });
      await tx.authSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'mfa-reset' } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: target.id, action: 'USER_MFA_RESET', changes: { mfaEnabled: false, passwordResetRequired: true, sessionsRevoked: true } } });
      await tx.securityEvent.create({ data: { userId: target.id, accountEmail: target.email, action: 'USER_MFA_RESET', outcome: 'ALLOWED', ipAddress: request.ip.slice(0, 64), userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 500) : null, details: { actorUserId: actor.sub, passwordResetRequired: true, sessionsRevoked: true } } });
    });
    return success({ reset: true, passwordResetRequired: true, sessionsRevoked: true });
  });

  app.post('/password/change-self', { preHandler: authRequired, config: { rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: (request) => request.ip } } }, async (request, reply) => {
    const actor = authUser(request);
    const parsed = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(12, '新密码至少 12 位').max(200), totpCode: z.string().trim().max(100).optional() }).safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '请输入当前密码和至少 12 位的新密码', parsed.error.flatten());

    const user = await prisma.user.findUnique({ where: { id: actor.sub }, select: { id: true, email: true, passwordHash: true, isActive: true, passwordResetRequired: true, authVersion: true, mfaEnabled: true, mfaSecretEncrypted: true } });
    if (!user || !user.isActive) return failure(reply, 401, 'USER_DISABLED', '账号不可用，请联系管理员');
    if (user.passwordResetRequired) return failure(reply, 409, 'PASSWORD_RESET_REQUIRED', '当前账号必须先完成首次/管理员要求的密码修改流程');
    if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      await recordSecurityEvent({ userId: actor.sub, accountEmail: actor.email, sessionId: actor.sid, action: 'SELF_PASSWORD_CHANGE_FAILED', outcome: 'DENIED', request });
      return failure(reply, 401, 'CURRENT_PASSWORD_INVALID', '当前密码不正确');
    }
    if (await bcrypt.compare(parsed.data.newPassword, user.passwordHash)) return failure(reply, 400, 'PASSWORD_UNCHANGED', '新密码不能与当前密码相同');

    let acceptedTotpStep: bigint | null = null;
    const suppliedMfa = parsed.data.totpCode ?? '';
    if (user.mfaEnabled) {
      if (!suppliedMfa) return failure(reply, 401, 'MFA_REQUIRED', '该账号已启用多因素认证，请输入新的验证器验证码或一次性恢复码');
      if (/^\d{6}$/.test(suppliedMfa)) {
        try { if (user.mfaSecretEncrypted) acceptedTotpStep = verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted), suppliedMfa); }
        catch (error) { request.log.error({ err: error, userId: user.id }, 'MFA secret could not be verified during self password change'); }
        if (acceptedTotpStep === null) { await recordSecurityEvent({ userId: actor.sub, accountEmail: actor.email, sessionId: actor.sid, action: 'SELF_PASSWORD_CHANGE_MFA_FAILED', outcome: 'DENIED', request }); return failure(reply, 401, 'INVALID_MFA_CODE', '多因素认证验证码不正确或已经使用'); }
      } else if (!/^[A-Fa-f0-9]{16}$/.test(suppliedMfa.replace(/[^a-zA-Z0-9]/g, ''))) {
        return failure(reply, 401, 'INVALID_MFA_CODE', '请输入 6 位验证码或有效的一次性恢复码');
      }
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    try {
      await prisma.$transaction(async (tx) => {
        if (user.mfaEnabled) {
          if (acceptedTotpStep !== null) {
            const accepted = await tx.$executeRaw`UPDATE "User" SET "mfaLastUsedStep" = ${acceptedTotpStep} WHERE "id" = ${actor.sub} AND ("mfaLastUsedStep" IS NULL OR "mfaLastUsedStep" < ${acceptedTotpStep})`;
            if (accepted !== 1) throw new Error('SELF_PASSWORD_CHANGE_MFA_REJECTED');
          } else {
            const consumed = await tx.mfaRecoveryCode.updateMany({ where: { userId: actor.sub, codeHash: hashRecoveryCode(suppliedMfa), usedAt: null }, data: { usedAt: new Date() } });
            if (consumed.count !== 1) throw new Error('SELF_PASSWORD_CHANGE_MFA_REJECTED');
          }
        }
        const updated = await tx.user.updateMany({ where: { id: actor.sub, isActive: true, authVersion: user.authVersion }, data: { passwordHash, passwordResetRequired: false, authVersion: { increment: 1 } } });
        if (updated.count !== 1) throw new Error('PASSWORD_CHANGE_CONFLICT');
        const now = new Date();
        await tx.authSession.updateMany({ where: { userId: actor.sub, revokedAt: null }, data: { revokedAt: now, revokeReason: 'self-password-changed' } });
        await tx.refreshToken.updateMany({ where: { userId: actor.sub, consumedAt: null }, data: { consumedAt: now } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: actor.sub, action: 'USER_PASSWORD_CHANGED_SELF', changes: { passwordResetRequired: false, sessionsRevoked: true } } });
        await tx.securityEvent.create({ data: { userId: actor.sub, accountEmail: user.email, sessionId: actor.sid, action: 'SELF_PASSWORD_CHANGED', outcome: 'ALLOWED', ipAddress: request.ip.slice(0, 64), userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 500) : null, details: { sessionsRevoked: true } } });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'PASSWORD_CHANGE_CONFLICT') return failure(reply, 409, 'PASSWORD_CHANGE_CONFLICT', '账号安全状态已变化，请重新登录后再试');
      if (error instanceof Error && error.message === 'SELF_PASSWORD_CHANGE_MFA_REJECTED') {
        await recordSecurityEvent({ userId: actor.sub, accountEmail: actor.email, sessionId: actor.sid, action: 'SELF_PASSWORD_CHANGE_MFA_FAILED', outcome: 'DENIED', request });
        return failure(reply, 401, 'INVALID_MFA_CODE', '多因素认证验证码不正确、已使用或恢复码无效');
      }
      throw error;
    }
    clearRefreshCookie(reply);
    return success({ changed: true, mustLoginAgain: true, sessionsRevoked: true });
  });

  app.post('/password/change', async (request, reply) => {
    if (!await restrictedAuthRequired(request, reply, 'password-change')) return;
    const actor = authUser(request);
    const parsed = passwordBody.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '新密码至少 12 位');
    const currentUser = await prisma.user.findUnique({ where: { id: actor.sub }, select: { id: true, authVersion: true, isActive: true, passwordResetRequired: true } });
    if (!currentUser || !currentUser.isActive || !currentUser.passwordResetRequired) return failure(reply, 409, 'PASSWORD_CHANGE_NOT_REQUIRED', '账号状态已变化，请重新登录');
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    try {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({ where: { id: actor.sub, isActive: true, passwordResetRequired: true, authVersion: currentUser.authVersion }, data: { passwordHash, passwordResetRequired: false, authVersion: { increment: 1 } } });
        if (changed.count !== 1) throw new Error('PASSWORD_CHANGE_CONFLICT');
        const now = new Date();
        await tx.authSession.updateMany({ where: { userId: actor.sub, revokedAt: null }, data: { revokedAt: now, revokeReason: 'password-changed' } });
        await tx.refreshToken.updateMany({ where: { userId: actor.sub, consumedAt: null }, data: { consumedAt: now } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: actor.sub, action: 'USER_PASSWORD_CHANGED', changes: { passwordResetRequired: false, sessionsRevoked: true } } });
        await tx.securityEvent.create({ data: { userId: actor.sub, accountEmail: actor.email, action: 'USER_PASSWORD_CHANGED', outcome: 'ALLOWED', ipAddress: request.ip.slice(0, 64), userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 500) : null, details: { sessionsRevoked: true } } });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'PASSWORD_CHANGE_CONFLICT') return failure(reply, 409, 'PASSWORD_CHANGE_CONFLICT', '该临时凭证已使用或账号安全状态已变化，请重新登录');
      throw error;
    }
    clearRefreshCookie(reply);
    return success({ changed: true, mustLoginAgain: true });
  });

  app.post('/mfa/enroll/start', { config: { rateLimit: { max: 4, timeWindow: '15 minutes', keyGenerator: (request) => request.ip } } }, async (request, reply) => {
    if (!await restrictedAuthRequired(request, reply, 'mfa-enrollment')) return;
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以启用管理员多因素认证');
    const current = await prisma.user.findUnique({ where: { id: actor.sub }, select: { mfaEnabled: true } });
    if (current?.mfaEnabled) return failure(reply, 409, 'MFA_ALREADY_ENABLED', '该管理员已启用多因素认证；如需恢复，请由另一位管理员通过账号管理执行 MFA 重置');
    let secret: string;
    let encrypted: string;
    try { secret = newTotpSecret(); encrypted = encryptMfaSecret(secret); }
    catch (error) { request.log.error({ err: error }, 'MFA encryption configuration is invalid'); return failure(reply, 503, 'MFA_NOT_CONFIGURED', '服务器未配置有效的 MFA_ENCRYPTION_KEY'); }
    await prisma.user.update({ where: { id: actor.sub }, data: { mfaPendingSecretEncrypted: encrypted } });
    await recordSecurityEvent({ userId: actor.sub, accountEmail: actor.email, action: 'MFA_ENROLLMENT_STARTED', outcome: 'CHALLENGE', request });
    return success({ secret, otpauthUrl: makeOtpAuthUrl(actor.email, secret), issuer: 'Moheng', account: actor.email, periodSeconds: 30 });
  });

  app.post('/mfa/enroll/confirm', { config: { rateLimit: { max: 6, timeWindow: '5 minutes', keyGenerator: (request) => request.ip } } }, async (request, reply) => {
    if (!await restrictedAuthRequired(request, reply, 'mfa-enrollment')) return;
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以启用管理员多因素认证');
    const parsed = totpBody.safeParse(request.body);
    if (!parsed.success || !/^\d{6}$/.test(parsed.data.code)) return failure(reply, 400, 'VALIDATION_ERROR', '请输入 6 位验证器验证码');
    const user = await prisma.user.findUnique({ where: { id: actor.sub }, select: { id: true, email: true, mfaPendingSecretEncrypted: true, mfaEnabled: true } });
    if (user?.mfaEnabled) return failure(reply, 409, 'MFA_ALREADY_ENABLED', '该管理员已启用多因素认证；如需恢复，请由另一位管理员执行 MFA 重置');
    if (!user || !user.mfaPendingSecretEncrypted) return failure(reply, 409, 'MFA_ENROLLMENT_NOT_STARTED', '请先开始多因素认证设置');
    let secret: string;
    let step: bigint | null;
    try { secret = decryptMfaSecret(user.mfaPendingSecretEncrypted); step = verifyTotp(secret, parsed.data.code); }
    catch { return failure(reply, 503, 'MFA_SECRET_INVALID', '无法验证服务器保存的 MFA 密钥'); }
    if (step === null) return failure(reply, 400, 'INVALID_MFA_CODE', '验证码不正确，请检查设备时间后重试');
    const recoveryCodes = generateRecoveryCodes();
    try {
      await prisma.$transaction(async (tx) => {
        const enabled = await tx.user.updateMany({ where: { id: actor.sub, mfaEnabled: false, mfaPendingSecretEncrypted: user.mfaPendingSecretEncrypted }, data: { mfaEnabled: true, mfaSecretEncrypted: user.mfaPendingSecretEncrypted, mfaPendingSecretEncrypted: null, mfaEnrolledAt: new Date(), mfaLastUsedStep: step, authVersion: { increment: 1 } } });
        if (enabled.count !== 1) throw new Error('MFA_ENROLLMENT_ALREADY_COMPLETED');
        await tx.authSession.updateMany({ where: { userId: actor.sub, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'mfa-enabled' } });
        await tx.refreshToken.updateMany({ where: { userId: actor.sub, consumedAt: null }, data: { consumedAt: new Date() } });
        await tx.mfaRecoveryCode.createMany({ data: recoveryCodes.map((code) => ({ userId: actor.sub, codeHash: hashRecoveryCode(code) })) });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: actor.sub, action: 'MFA_ENABLED', changes: { mfaEnabled: true, recoveryCodeCount: recoveryCodes.length } } });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'MFA_ENROLLMENT_ALREADY_COMPLETED') return failure(reply, 409, 'MFA_ALREADY_ENABLED', '多因素认证已在其他请求中完成，请重新登录验证');
      throw error;
    }
    await recordSecurityEvent({ userId: actor.sub, accountEmail: actor.email, action: 'MFA_ENABLED', outcome: 'ALLOWED', request, details: { recoveryCodeCount: recoveryCodes.length } });
    return success({ enabled: true, recoveryCodes, warning: '恢复码仅展示一次。请将其保存在密码管理器或其他安全位置。' });
  });

  app.get('/security/sessions', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以查看登录会话');
    const rows = await prisma.authSession.findMany({
      take: 200, orderBy: { lastSeenAt: 'desc' },
      select: { id: true, userId: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, revokeReason: true, user: { select: { name: true, email: true, role: true, isActive: true } } },
    });
    return success(rows.map((row) => ({ ...row, isCurrent: row.id === actor.sid, isValid: !row.revokedAt && row.expiresAt > new Date() && row.user.isActive })));
  });

  app.delete('/security/sessions/:id', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以撤销登录会话');
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '会话编号有误');
    const target = await prisma.authSession.findUnique({ where: { id: params.data.id }, select: { id: true, userId: true, revokedAt: true, user: { select: { email: true } } } });
    if (!target) return failure(reply, 404, 'SESSION_NOT_FOUND', '登录会话不存在');
    await prisma.$transaction(async (tx) => {
      await tx.authSession.updateMany({ where: { id: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: `revoked-by-admin:${actor.sub}` } });
      await tx.refreshToken.updateMany({ where: { sessionId: target.id, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'AuthSession', entityId: target.id, action: 'SESSION_REVOKED', changes: { targetUserId: target.userId } } });
      await tx.securityEvent.create({ data: { userId: target.userId, accountEmail: target.user.email, sessionId: target.id, action: 'SESSION_REVOKED', outcome: 'ALLOWED', ipAddress: request.ip.slice(0, 64), userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 500) : null, details: { actorUserId: actor.sub } } });
    });
    return success({ revoked: true, sessionId: target.id });
  });

  app.get('/security/events', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以查看安全事件');
    const rows = await prisma.securityEvent.findMany({
      take: 200, orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, accountEmail: true, sessionId: true, action: true, outcome: true, ipAddress: true, userAgent: true, details: true, createdAt: true, user: { select: { name: true } } },
    });
    return success(rows);
  });

  app.get('/me', { preHandler: authRequired }, async (request, reply) => {
    const identity = authUser(request);
    const user = await prisma.user.findUnique({ where: { id: identity.sub }, select: { id: true, name: true, email: true, role: true, isActive: true, mfaEnabled: true, passwordResetRequired: true } });
    if (!user || !user.isActive) return failure(reply, 401, 'USER_DISABLED', '账号不可用');
    return success({ ...publicUser(user), mfaEnabled: user.mfaEnabled, passwordResetRequired: user.passwordResetRequired });
  });
}
