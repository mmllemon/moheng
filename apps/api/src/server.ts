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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 个字符'),
  CORS_ORIGIN: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
});
const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  console.error('环境配置无效：', envResult.error.flatten().fieldErrors);
  process.exit(1);
}
const env = envResult.data;

const corsOriginSetting = env.CORS_ORIGIN?.trim() || (env.NODE_ENV === 'development' ? 'http://localhost:5173' : '');
const corsOrigins = corsOriginSetting.split(',').map((origin) => origin.trim()).filter(Boolean);

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'development' ? 'info' : 'warn',
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]', 'req.body.password', 'req.body.refreshToken', 'req.body.apiSecret'],
      censor: '[REDACTED]',
    },
  },
  bodyLimit: 12 * 1024 * 1024,
});
app.addHook('onSend', async (request, reply, payload) => {
  reply.header('x-request-id', request.id);
  return payload;
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: corsOrigins,
  credentials: true,
});
await app.register(cookie);
await app.register(jwt, { secret: env.JWT_SECRET });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
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
  return failure(reply, 500, 'INTERNAL_ERROR', env.NODE_ENV === 'production' ? '服务器暂时无法处理该请求' : error.message);
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await prisma.$connect();
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`Cost Management API listening on ${env.HOST}:${env.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
