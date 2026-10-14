import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import type { UserRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { failure } from './http.js';

export type AuthUser = { sub: string; email: string; role: UserRole };

export const authRequired: preHandlerHookHandler = async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return failure(reply, 401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录');
  }
};

export function authUser(request: FastifyRequest): AuthUser {
  return request.user as AuthUser;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = newRefreshToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { tokenHash: hashRefreshToken(token), userId, expiresAt } });
  // Opportunistically remove expired hashes so the session table remains bounded.
  await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return token;
}

export function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60,
  });
}
