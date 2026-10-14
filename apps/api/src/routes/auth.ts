import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser, hashRefreshToken, issueRefreshToken, setRefreshCookie } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const createUserBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(12, '初始密码至少 12 位').max(200),
});

function publicUser(user: { id: string; name: string; email: string; role: 'ADMIN' | 'USER' }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '请检查邮箱和密码', parsed.error.flatten());
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user || !user.isActive || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return failure(reply, 401, 'INVALID_CREDENTIALS', '邮箱或密码不正确');
    }
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '15m' });
    const refreshToken = await issueRefreshToken(user.id);
    setRefreshCookie(reply, refreshToken);
    return success({ accessToken, user: publicUser(user) });
  });

  app.post('/refresh', async (request, reply) => {
    const oldToken = request.cookies.refreshToken;
    if (!oldToken) return failure(reply, 401, 'REFRESH_TOKEN_MISSING', '登录已过期，请重新登录');
    const tokenHash = hashRefreshToken(oldToken);
    // One DELETE ... RETURNING statement atomically consumes a single-use token.
    const consumed = await prisma.$queryRaw<Array<{ userId: string }>>`
      DELETE FROM "RefreshToken"
      WHERE "tokenHash" = ${tokenHash} AND "expiresAt" > NOW()
      RETURNING "userId"
    `;
    const userId = consumed[0]?.userId;
    if (!userId) {
      reply.clearCookie('refreshToken', { path: '/api/auth' });
      return failure(reply, 401, 'REFRESH_TOKEN_INVALID', '登录已过期，请重新登录');
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      reply.clearCookie('refreshToken', { path: '/api/auth' });
      return failure(reply, 401, 'USER_DISABLED', '账号不可用，请联系管理员');
    }
    const newToken = await issueRefreshToken(user.id);
    setRefreshCookie(reply, newToken);
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '15m' });
    return success({ accessToken, user: publicUser(user) });
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies.refreshToken;
    if (token) await prisma.refreshToken.deleteMany({ where: { tokenHash: hashRefreshToken(token) } });
    reply.clearCookie('refreshToken', { path: '/api/auth' });
    return success({ loggedOut: true, requestId: randomUUID() });
  });



  app.get('/users', { preHandler: authRequired }, async (request, reply) => {
    const actor = authUser(request);
    if (actor.role !== 'ADMIN') return failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以查看全部账号');
    const rows = await prisma.user.findMany({
      select: {
        id: true, name: true, email: true, role: true, isActive: true, createdAt: true,
        memberships: { select: { projectId: true, role: true } },
      },
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
        const created = await tx.user.create({
          data: { name: parsed.data.name, email, passwordHash, role: 'USER' },
          select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
        });
        await tx.auditLog.create({ data: {
          userId: actor.sub, entity: 'User', entityId: created.id, action: 'USER_CREATED',
          changes: { name: created.name, email: created.email, role: created.role },
        } });
        return created;
      });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'USER_EMAIL_EXISTS', '该邮箱已被注册');
      throw error;
    }
  });

  app.get('/me', { preHandler: authRequired }, async (request, reply) => {
    const identity = authUser(request);
    const user = await prisma.user.findUnique({ where: { id: identity.sub } });
    if (!user || !user.isActive) return failure(reply, 401, 'USER_DISABLED', '账号不可用');
    return success(publicUser(user));
  });
}
