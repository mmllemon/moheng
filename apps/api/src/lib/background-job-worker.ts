import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { backgroundJobArtifactPath, backgroundJobStorageRoot } from './background-job-storage.js';
import { claimNextBackgroundJob, PermanentBackgroundJobError, reconcileOrphanAssistantRuns } from './background-jobs.js';
import type { BackgroundJobHandlerResult, ClaimedBackgroundJob } from './background-job-types.js';
import { backgroundJobHandlers } from '../platform/background-job-registry.js';

const RESULT_RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
type WorkerOptions = { pollIntervalMs?: number; leaseSeconds?: number };

async function executeClaimedJob(job: ClaimedBackgroundJob, workerId: string, leaseSeconds: number, logger: FastifyBaseLogger): Promise<void> {
  const handler = backgroundJobHandlers.get(job.type);
  const heartbeatInterval = setInterval(() => {
    void prisma.backgroundJob.updateMany({
      where: { id: job.id, status: 'RUNNING', lockedBy: workerId },
      data: { lockedAt: new Date(), updatedAt: new Date() },
    }).catch((error: unknown) => logger.error({ err: error, jobId: job.id }, 'Background job lease heartbeat failed'));
  }, Math.max(10_000, Math.floor(leaseSeconds * 1000 / 3)));
  heartbeatInterval.unref?.();
  let generatedFileName: string | undefined;
  try {
    if (!handler) throw new PermanentBackgroundJobError(`NO_HANDLER_REGISTERED:${job.type}`);
    const result: BackgroundJobHandlerResult | void = await handler(job);
    generatedFileName = result?.resultFileName;
    const finishedAt = new Date();
    const data: Prisma.BackgroundJobUpdateManyMutationInput = {
      status: 'SUCCEEDED', finishedAt, lockedAt: null, lockedBy: null, updatedAt: finishedAt, lastError: null,
      ...(result?.resultFileName ? { resultFileName: result.resultFileName, resultExpiresAt: new Date(finishedAt.getTime() + RESULT_RETENTION_DAYS * 24 * 60 * 60 * 1000) } : {}),
      ...(result?.resultMetadata ? { resultMetadata: result.resultMetadata } : {}),
    };
    const updated = await prisma.backgroundJob.updateMany({ where: { id: job.id, status: 'RUNNING', lockedBy: workerId }, data });
    if (updated.count !== 1) {
      if (generatedFileName) await rm(backgroundJobArtifactPath(generatedFileName), { force: true }).catch((cleanupError: unknown) => logger.warn({ err: cleanupError, jobId: job.id }, 'Stale worker artifact cleanup failed'));
      logger.warn({ jobId: job.id }, 'Background job completion ignored because worker no longer owns the lease');
    } else logger.info({ jobId: job.id, type: job.type, attempts: job.attempts }, 'Background job completed');
  } catch (error) {
    const permanent = error instanceof PermanentBackgroundJobError || (error instanceof Error && 'retryable' in error && error.retryable === false);
    const exhausted = job.attempts >= job.maxAttempts;
    const status = permanent || exhausted ? 'FAILED' : 'QUEUED';
    const backoffSeconds = Math.min(300, 5 * (2 ** Math.max(0, job.attempts - 1)));
    const lastError = (error instanceof Error ? error.message : 'UNKNOWN_BACKGROUND_JOB_ERROR').slice(0, 1900);
    try {
      await prisma.backgroundJob.updateMany({
        where: { id: job.id, status: 'RUNNING', lockedBy: workerId },
        data: { status, availableAt: status === 'QUEUED' ? new Date(Date.now() + backoffSeconds * 1000) : new Date(),
          finishedAt: status === 'FAILED' ? new Date() : null, lockedAt: null, lockedBy: null, lastError, updatedAt: new Date() },
      });
    } catch (persistError) {
      // Keep the worker alive. The lease enables recovery when the database becomes available again.
      logger.error({ err: persistError, jobId: job.id, workerId }, 'Unable to persist background job failure; lease recovery will handle the task');
    }
    logger.error({ err: error, jobId: job.id, type: job.type, attempts: job.attempts, maxAttempts: job.maxAttempts, nextStatus: status }, 'Background job failed');
  } finally { clearInterval(heartbeatInterval); }
}

async function cleanupExpiredResults(logger: FastifyBaseLogger): Promise<void> {
  const expired = await prisma.backgroundJob.findMany({
    where: { resultExpiresAt: { lte: new Date() }, resultFileName: { not: null } },
    orderBy: { resultExpiresAt: 'asc' }, take: 100, select: { id: true, resultFileName: true },
  });
  for (const job of expired) {
    if (!job.resultFileName) continue;
    try {
      await rm(backgroundJobArtifactPath(job.resultFileName), { force: true });
      await prisma.backgroundJob.updateMany({ where: { id: job.id, resultFileName: job.resultFileName }, data: { resultFileName: null, updatedAt: new Date() } });
    } catch (error) { logger.error({ err: error, jobId: job.id }, 'Expired background job result cleanup failed'); }
  }
  const terminalBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const pruned = await prisma.backgroundJob.deleteMany({
    where: {
      status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] },
      finishedAt: { lte: terminalBefore },
      resultFileName: null,
    },
  });
  // Remove output files from a crashed/stale attempt after one day. Only names generated by this subsystem are eligible.
  let orphanFilesRemoved = 0;
  try {
    const root = backgroundJobStorageRoot();
    const names = await readdir(root);
    const referenced = new Set((await prisma.backgroundJob.findMany({ where: { resultExpiresAt: { gt: new Date() }, resultFileName: { not: null } }, select: { resultFileName: true } })).map((row) => row.resultFileName).filter((name): name is string => name !== null));
    for (const name of names) {
      if (!/^[A-Za-z0-9_-]+-\d+\.xlsx$/.test(name) || referenced.has(name)) continue;
      const path = backgroundJobArtifactPath(name);
      const fileInfo = await stat(path).catch(() => null);
      if (fileInfo?.isFile() && fileInfo.mtimeMs < Date.now() - 24 * 60 * 60 * 1000) {
        await rm(path, { force: true });
        orphanFilesRemoved += 1;
      }
    }
  } catch (error) {
    logger.warn({ err: error }, 'Background job orphan-file sweep failed');
  }
  const now = Date.now();
  const cleanupResults = await Promise.allSettled([
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date(now - 30 * 24 * 60 * 60 * 1000) } } }),
    prisma.loginAttemptBucket.deleteMany({ where: { updatedAt: { lt: new Date(now - 7 * 24 * 60 * 60 * 1000) } } }),
    prisma.securityEvent.deleteMany({ where: { createdAt: { lt: new Date(now - 180 * 24 * 60 * 60 * 1000) } } }),
  ]);
  for (const [index, result] of cleanupResults.entries()) {
    if (result.status === 'rejected') logger.warn({ err: result.reason, cleanup: ['refresh-tokens', 'login-attempt-buckets', 'security-events'][index] }, 'Auth retention cleanup failed');
  }
  if (expired.length > 0 || pruned.count > 0 || orphanFilesRemoved > 0 || cleanupResults.some((result) => result.status === 'fulfilled' && result.value.count > 0)) logger.info({ expiredArtifacts: expired.length, prunedJobs: pruned.count, orphanFilesRemoved, authRetentionCleanups: cleanupResults.map((result) => result.status === 'fulfilled' ? result.value.count : null) }, 'Background and auth retention cleanup completed');
}

export function startBackgroundWorker(logger: FastifyBaseLogger, options: WorkerOptions = {}): () => Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const leaseSeconds = options.leaseSeconds ?? 900;
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 150);
  let stopping = false;
  let lastCleanupAt = 0;
  let lastAssistantOrphanSweepAt = 0;
  const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));
  const loop = async () => {
    while (!stopping) {
      try {
        if (Date.now() - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
          lastCleanupAt = Date.now();
          try { await cleanupExpiredResults(logger); }
          catch (error) {
            // Avoid hammering PostgreSQL with a retention query every poll while the database is unhealthy.
            lastCleanupAt = Date.now() - CLEANUP_INTERVAL_MS + 60_000;
            logger.error({ err: error }, 'Background/auth retention cleanup failed; retrying after a cooldown');
          }
        }
        if (Date.now() - lastAssistantOrphanSweepAt >= 30_000) {
          lastAssistantOrphanSweepAt = Date.now();
          try {
            const reconciled = await reconcileOrphanAssistantRuns();
            if (reconciled > 0) logger.warn({ reconciled }, 'Orphan assistant runs reconciled to terminal state');
          } catch (error) {
            logger.error({ err: error }, 'Assistant orphan-run reconciliation failed');
          }
        }
        const job = await claimNextBackgroundJob(workerId, leaseSeconds);
        if (job) await executeClaimedJob(job, workerId, leaseSeconds, logger);
        else await sleep(pollIntervalMs);
      } catch (error) { logger.error({ err: error }, 'Background job polling failed'); await sleep(Math.min(5000, pollIntervalMs)); }
    }
  };
  const loopPromise = loop();
  logger.info({ workerId, pollIntervalMs, leaseSeconds }, 'PostgreSQL background worker started');
  return async () => { stopping = true; await loopPromise; logger.info({ workerId }, 'PostgreSQL background worker stopped'); };
}
