import 'dotenv/config';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { z } from 'zod';
import { prisma } from './lib/prisma.js';
import { APP_VERSION, API_MAJOR_VERSION } from './platform/app-info.js';
import { getApiModuleCatalog, registerApiModules } from './platform/module-registry.js';
import { failure, success } from './lib/http.js';
import { startBackgroundWorker } from './lib/background-job-worker.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 个字符'),
  CORS_ORIGIN: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  PUBLIC_BASE_URL: z.preprocess((value) => typeof value === 'string' && !value.trim() ? undefined : value, z.string().url().optional()),
  MFA_ENCRYPTION_KEY: z.preprocess((value) => typeof value === 'string' && !value.trim() ? undefined : value, z.string().regex(/^[a-fA-F0-9]{64}$/, 'MFA_ENCRYPTION_KEY 必须是 32 字节十六进制密钥').optional()),
  LOGIN_ATTEMPT_HMAC_KEY: z.preprocess((value) => typeof value === 'string' && !value.trim() ? undefined : value, z.string().regex(/^[a-fA-F0-9]{64}$/, 'LOGIN_ATTEMPT_HMAC_KEY 必须是独立的 32 字节十六进制密钥').optional()),
  TRUST_PROXY: z.string().optional(),
  BACKGROUND_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
  BACKGROUND_JOB_POLL_MS: z.coerce.number().int().min(250).max(60000).default(1000),
  ASSISTANT_POC_ENABLED: z.enum(['true', 'false']).default('false'),
  /* 登录限流：默认 12 次 / 15 分钟（生产值）。
     E2E 与视觉回归需要反复登录，可在 .env 中调高；
     生产环境应保持默认，不要跟随测试配置。 */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(12),
  LOGIN_RATE_LIMIT_WINDOW: z.string().default('15 minutes'),
});
const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  console.error('环境配置无效：', envResult.error.flatten().fieldErrors);
  process.exit(1);
}
const env = envResult.data;
if (env.PUBLIC_BASE_URL) {
  const publicUrl = new URL(env.PUBLIC_BASE_URL);
  const unsafeProxyRange = env.TRUST_PROXY?.split(',').some((entry) => entry.trim().endsWith('/0')) ?? false;
  const normalizedJwtSecret = env.JWT_SECRET.trim();
  const placeholderJwtSecret = ['replace-with-at-least-32-random-bytes', 'development-only-invalid-secret'].includes(normalizedJwtSecret) || !normalizedJwtSecret || normalizedJwtSecret !== env.JWT_SECRET;
  const invalidPublicMode = env.NODE_ENV !== 'production' || env.HOST !== '127.0.0.1' || !env.TRUST_PROXY?.trim() || unsafeProxyRange || placeholderJwtSecret || publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' || Boolean(publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(publicUrl.hostname) || env.COOKIE_SECURE !== 'true' || !env.MFA_ENCRYPTION_KEY || env.MFA_ENCRYPTION_KEY === env.JWT_SECRET || !env.LOGIN_ATTEMPT_HMAC_KEY || env.LOGIN_ATTEMPT_HMAC_KEY === env.JWT_SECRET || env.LOGIN_ATTEMPT_HMAC_KEY === env.MFA_ENCRYPTION_KEY;
  const mismatchedCors = corsOriginSettingForValidation(env.CORS_ORIGIN).some((origin) => origin !== publicUrl.origin);
  if (invalidPublicMode || mismatchedCors) {
    console.error('公网模式配置无效：PUBLIC_BASE_URL 必须是正式 HTTPS origin；NODE_ENV=production、HOST=127.0.0.1、明确且非全网段 TRUST_PROXY、非占位 JWT_SECRET、COOKIE_SECURE=true、与 JWT_SECRET 不同的有效 MFA_ENCRYPTION_KEY，以及独立于 JWT_SECRET/MFA_ENCRYPTION_KEY 的 LOGIN_ATTEMPT_HMAC_KEY 必须同时满足；CORS_ORIGIN 只能配置同源地址。');
    process.exit(1);
  }
}
if (env.TRUST_PROXY?.trim() && env.TRUST_PROXY.split(',').some((entry) => !entry.trim() || ['*', 'true', '1'].includes(entry.trim().toLowerCase()) || entry.trim().endsWith('/0'))) {
  console.error('TRUST_PROXY 只能填写明确受信任的代理 IP/CIDR 列表，禁止使用 *、true 或 1。');
  process.exit(1);
}
function corsOriginSettingForValidation(value: string | undefined): string[] {
  return (value?.trim() ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
}

const corsOriginSetting = env.CORS_ORIGIN?.trim() || (env.NODE_ENV === 'development' ? 'http://localhost:5173' : '');
const corsOrigins = corsOriginSetting.split(',').map((origin) => origin.trim()).filter(Boolean);

const app = Fastify({
  trustProxy: env.TRUST_PROXY?.trim() ? env.TRUST_PROXY.split(',').map((entry) => entry.trim()) : false,
  logger: {
    level: env.NODE_ENV === 'development' ? 'info' : 'warn',
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]', 'req.body.password', 'req.body.secret', 'req.body.apiKey', 'req.body.integrationSecret', 'req.body.currentPassword', 'req.body.newPassword', 'req.body.refreshToken', 'req.body.apiSecret', 'req.body.totpCode', 'req.body.recoveryCode', 'req.body.code', 'req.body.totp', 'req.body.recoveryCodes'],
      censor: '[REDACTED]',
    },
  },
  bodyLimit: 12 * 1024 * 1024,
});
app.addHook('onSend', async (request, reply, payload) => {
  reply.header('x-request-id', request.id);
  return payload;
});

await app.register(helmet, {
  contentSecurityPolicy: env.PUBLIC_BASE_URL ? { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'], fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
    workerSrc: ["'self'", 'blob:'], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"],
  } } : false,
  hsts: env.PUBLIC_BASE_URL ? { maxAge: 15552000, includeSubDomains: false, preload: false } : false,
});
await app.register(cors, {
  origin: corsOrigins,
  credentials: true,
});
await app.register(cookie);
await app.register(jwt, { secret: env.JWT_SECRET });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
if (!env.PUBLIC_BASE_URL) {
await app.register(swagger, {
  openapi: {
    info: { title: '墨衡工程经营管理 API', description: '施工阶段项目成本管理 API。请求统一使用 /api 前缀。', version: APP_VERSION },
    servers: [{ url: '/' }],
    tags: [
      { name: 'auth', description: '登录与会话' }, { name: 'projects', description: '项目管理' }, { name: 'contracts', description: '主合同与下游合同' },
      { name: 'budget', description: '目标成本清单' }, { name: 'costs', description: '实际成本' },
      { name: 'progress-bills', description: '进度款' }, { name: 'owner-finance', description: '业主竣工结算与应收账款' }, { name: 'changes', description: '变更签证' },
      { name: 'analysis', description: '成本分析' }, { name: 'audit-logs', description: '操作追溯与审计记录' }, { name: 'reports', description: '台账 CSV/XLSX 报表、模板设计与版本管理' }, { name: 'notifications', description: '基于当前台账的动态待办与预警' }, { name: 'business-parties', description: '往来单位主数据与单位经营档案' },
    ],
  },
});
await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list', deepLinking: false } });
}

// In production, serve the compiled React SPA from the same origin as the API.
// During Vite development the dist directory may not exist, so Vite serves the UI instead.
const webDistPath = resolve(process.env.WEB_DIST_DIR ?? resolve(process.cwd(), '../web/dist'));
const webDistAvailable = existsSync(resolve(webDistPath, 'index.html'));
if (env.NODE_ENV === 'production' && !webDistAvailable) {
  throw new Error(`未找到前端构建产物：${webDistPath}。请先执行 npm run build。`);
}
if (webDistAvailable) {
  await app.register(fastifyStatic, { root: webDistPath, prefix: '/', wildcard: false, index: false });
  app.get('/assets/*', async (request, reply) => {
    const assetPath = (request.params as Record<string, string>)['*'];
    if (!assetPath || assetPath.split(/[\\/]/).some((segment) => segment === '..')) {
      return failure(reply, 404, 'ASSET_NOT_FOUND', '静态资源不存在');
    }
    // Fastify's wildcard parameter contains the path after /assets/, while Vite
    // emits files beneath <webDistPath>/assets/. Guard against traversal and
    // return a proper 404 rather than surfacing a sendFile ENOENT as a 500.
    const assetsRoot = resolve(webDistPath, 'assets');
    const fullAssetPath = resolve(assetsRoot, assetPath);
    if (!fullAssetPath.startsWith(`${assetsRoot}${sep}`) || !existsSync(fullAssetPath)) {
      return failure(reply, 404, 'ASSET_NOT_FOUND', '静态资源不存在');
    }
    return reply.sendFile(`assets/${assetPath}`);
  });
}

app.get('/health/live', async () => success({ status: 'ok', service: 'api', time: new Date().toISOString() }));

const readinessHandler = async (_request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return success({ status: 'ok', api: 'ok', database: 'ok', time: new Date().toISOString() });
  } catch {
    return failure(reply, 503, 'DATABASE_UNAVAILABLE', '数据库暂不可用');
  }
};
app.get('/health/ready', readinessHandler);
// Backward-compatible readiness alias for existing Windows scripts and monitoring.
app.get('/health', readinessHandler);

app.get('/api/meta', async () => success({
  product: '墨衡工程经营管理',
  version: APP_VERSION,
  apiMajorVersion: API_MAJOR_VERSION,
  apiBasePath: '/api',
  compatibilityPolicy: '现有 /api 路径在 v1 兼容周期内保持稳定；破坏性变更需引入新的主版本路径。',
  modules: getApiModuleCatalog(),
}));

// In production, serve the compiled React SPA from the same origin as the API.
// During Vite development the dist directory may not exist, so Vite serves the UI instead.
/* 登录限流参数下发给 auth 路由。默认 12 次 / 15 分钟；
   E2E 与视觉回归可通过 .env 调高（LOGIN_RATE_LIMIT_MAX / LOGIN_RATE_LIMIT_WINDOW），
   生产环境保持默认值，不随测试配置变化。 */
(app as typeof app & { loginRateLimit?: { max: number; timeWindow: string } }).loginRateLimit = {
  max: env.LOGIN_RATE_LIMIT_MAX,
  timeWindow: env.LOGIN_RATE_LIMIT_WINDOW,
};
await registerApiModules(app);

app.setNotFoundHandler((request, reply) => {
  // SPA history fallback: only GET page routes, never unknown API or documentation paths.
  if (webDistAvailable && request.method === 'GET' && !(request.url === '/api' || request.url.startsWith('/api/')) && !request.url.startsWith('/docs')) {
    return reply.type('text/html; charset=utf-8').sendFile('index.html');
  }
  return failure(reply, 404, 'ROUTE_NOT_FOUND', `接口不存在：${request.method} ${request.url}`);
});
app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error, requestId: request.id }, 'Unhandled request error');
  if (reply.sent) return;
  return failure(reply, 500, 'INTERNAL_ERROR', env.NODE_ENV === 'production' ? '服务器暂时无法处理该请求' : (error instanceof Error ? error.message : String(error)));
});

let stopBackgroundWorker: () => Promise<void> = async () => {};

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down');
  await stopBackgroundWorker();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await prisma.$connect();
  await app.listen({ port: env.PORT, host: env.HOST });
  if (env.BACKGROUND_WORKER_ENABLED === 'true') {
    stopBackgroundWorker = startBackgroundWorker(app.log, { pollIntervalMs: env.BACKGROUND_JOB_POLL_MS });
  }
  app.log.info(`Cost Management API listening on ${env.HOST}:${env.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
