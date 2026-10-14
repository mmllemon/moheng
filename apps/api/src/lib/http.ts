import type { FastifyReply } from 'fastify';

export function success<T>(data: T, meta?: { total: number; page: number; pageSize: number }) {
  return meta ? { success: true as const, data, meta } : { success: true as const, data };
}

export function failure(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
) {
  reply.code(statusCode);
  return {
    success: false as const,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}
