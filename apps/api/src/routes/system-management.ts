import type { FastifyInstance } from 'fastify';
import { isAbsolute, resolve } from 'node:path';
import { APP_VERSION } from '../platform/app-info.js';
import { failure, success } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { authRequired, authUser } from '../lib/auth.js';
import { parseBackupKeyRing } from '../lib/backup-encryption.js';
import { inspectPgTools, retentionDaysFromEnv, serialiseBackup } from './system-management/helpers.js';
import { systemConfigRoutes } from './system-config.js';
import { registerGovernanceRoutes } from './system-management/governance.js';
import { registerIntegrationsRoutes } from './system-management/integrations.js';
import { registerOperationsRoutes } from './system-management/operations.js';

export async function systemManagementRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authRequired);
  app.addHook('preHandler', async (request, reply) => {
    if (reply.sent) return;
    if (!request.user) return reply.code(401).send(failure(reply, 401, 'UNAUTHORIZED', '请先登录'));
    if (authUser(request).role !== 'ADMIN') return reply.code(403).send(failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以访问系统管理扩展'));
  });

  await app.register(systemConfigRoutes);

  app.get('/overview', async (_request, reply) => {
    let databaseStatus: 'ok' | 'failed' = 'ok';
    try { await prisma.$queryRaw`SELECT 1`; } catch { databaseStatus = 'failed'; }
    if (databaseStatus === 'failed') {
      const [memory, postgresClientTools] = [process.memoryUsage(), await inspectPgTools()];
      return success({
        appVersion: APP_VERSION, nodeVersion: process.version, uptimeSeconds: Math.floor(process.uptime()),
        memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
        database: { status: 'failed' },
        backup: { configured: Boolean(process.env.DATABASE_URL && process.env.BACKUP_GLOBALS_DATABASE_URL && process.env.BACKUP_DIR && isAbsolute(process.env.BACKUP_DIR) && process.env.BACKUP_ENCRYPTION_KEYS && process.env.BACKUP_ACTIVE_ENCRYPTION_KEY_ID), restoreDrillConfigured: Boolean(process.env.RESTORE_TEST_DATABASE_URL), retentionDays: retentionDaysFromEnv(), disk: null },
        postgresClientTools, integrationVaultConfigured: /^[a-fA-F0-9]{64}$/.test(process.env.INTEGRATION_ENCRYPTION_KEY ?? ''), backupEncryptionConfigured: (() => { try { parseBackupKeyRing(); return true; } catch { return false; } })(), globalsBackupConfigured: Boolean(process.env.BACKUP_GLOBALS_DATABASE_URL),
        backgroundJobs: { counts: {}, recent: [] }, integrations: { active: 0 }, backupRuns: [],
      });
    }
    const [jobCounts, jobs, backupRuns, integrationCount, postgresClientTools] = await Promise.all([
      prisma.backgroundJob.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.backgroundJob.findMany({ take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, createdAt: true, finishedAt: true, lastError: true } }),
      prisma.systemBackupRun.findMany({ take: 8, orderBy: { startedAt: 'desc' }, include: { triggeredBy: { select: { name: true, email: true } } } }),
      prisma.integrationCredential.count({ where: { status: 'ACTIVE' } }),
      inspectPgTools(),
    ]);
    let disk: { freeBytes: string; totalBytes: string } | null = null;
    try {
      if (!process.env.BACKUP_DIR || !isAbsolute(process.env.BACKUP_DIR)) throw new Error('BACKUP_DIRECTORY_UNAVAILABLE');
      const fsPath = resolve(process.env.BACKUP_DIR);
      const fs = await import('node:fs/promises');
      const diskStat = await fs.statfs(fsPath);
      disk = { freeBytes: String(Number(diskStat.bavail) * Number(diskStat.bsize)), totalBytes: String(Number(diskStat.blocks) * Number(diskStat.bsize)) };
    } catch { /* Disk statistics are optional until a backup location is configured. */ }
    return success({
      appVersion: APP_VERSION, nodeVersion: process.version, uptimeSeconds: Math.floor(process.uptime()),
      memory: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed, heapTotalBytes: process.memoryUsage().heapTotal },
      database: { status: databaseStatus },
      backup: { configured: Boolean(process.env.DATABASE_URL && process.env.BACKUP_GLOBALS_DATABASE_URL && process.env.BACKUP_DIR && isAbsolute(process.env.BACKUP_DIR) && process.env.BACKUP_ENCRYPTION_KEYS && process.env.BACKUP_ACTIVE_ENCRYPTION_KEY_ID), restoreDrillConfigured: Boolean(process.env.RESTORE_TEST_DATABASE_URL), retentionDays: retentionDaysFromEnv(), disk },
      postgresClientTools, integrationVaultConfigured: /^[a-fA-F0-9]{64}$/.test(process.env.INTEGRATION_ENCRYPTION_KEY ?? ''), backupEncryptionConfigured: (() => { try { parseBackupKeyRing(); return true; } catch { return false; } })(), globalsBackupConfigured: Boolean(process.env.BACKUP_GLOBALS_DATABASE_URL),
      backgroundJobs: { counts: Object.fromEntries(jobCounts.map((item) => [item.status, item._count._all])), recent: jobs.map((job) => ({ ...job, lastError: job.lastError ? '任务执行失败，详细错误请查看服务端受控日志' : null })) },
      integrations: { active: integrationCount },
      backupRuns: backupRuns.map(serialiseBackup),
    });
  });

  // This matrix documents the role guards actually enforced by project APIs.
  // It is intentionally read-only: changing it here would be misleading because
  // authorization remains enforced by each service endpoint.

  await registerGovernanceRoutes(app);
  await registerIntegrationsRoutes(app);
  await registerOperationsRoutes(app);
}
