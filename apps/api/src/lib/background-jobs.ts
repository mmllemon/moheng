import { createHash } from 'node:crypto';
import { Prisma, type BackgroundJobStatus } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';
import type { ClaimedBackgroundJob } from './background-job-types.js';
import { appendAssistantRunEvent } from './assistant-run-events.js';

export type EnqueueBackgroundJobInput = {
  type: string;
  payloadVersion?: number;
  payload: Prisma.InputJsonObject;
  ownerUserId: string;
  projectId?: string | null;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  maxAttempts?: number;
};

/** Call inside the domain transaction when enqueue must be atomic with a business write. */
export async function enqueueBackgroundJob(tx: Prisma.TransactionClient, input: EnqueueBackgroundJobInput) {
  return tx.backgroundJob.create({ data: {
    type: input.type,
    payloadVersion: input.payloadVersion ?? 1,
    payload: input.payload,
    ownerUserId: input.ownerUserId,
    projectId: input.projectId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    requestHash: input.requestHash ?? null,
    maxAttempts: input.maxAttempts ?? 3,
    status: 'QUEUED',
  } });
}

export function hashJobRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}


/**
 * Reconcile durable assistant runs that have no live matching queue job. Normally a run and
 * its job are committed atomically; this is a bounded recovery path for corrupted/manual rows,
 * old partial deployments, or a queue row that was lost outside the normal transaction.
 * The grace period avoids racing with old deployments that may still be rolling out.
 */
export async function reconcileOrphanAssistantRuns(graceSeconds = 60): Promise<number> {
  if (!Number.isInteger(graceSeconds) || graceSeconds < 1 || graceSeconds > 3600) {
    throw new RangeError('ASSISTANT_ORPHAN_GRACE_SECONDS_INVALID');
  }
  return prisma.$transaction(async (tx) => {
    const orphanRuns = await tx.$queryRaw<Array<{
      id: string;
      conversationId: string;
      ownerUserId: string;
      projectId: string;
      status: string;
      errorCode: string | null;
    }>>`
      UPDATE "AssistantRun"
      SET "status" = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN 'CANCELLED' ELSE 'FAILED' END,
          "errorCode" = CASE WHEN "cancelRequestedAt" IS NOT NULL THEN NULL ELSE 'ASSISTANT_ORPHAN_RUN' END,
          "finishedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE "status" IN ('QUEUED', 'RUNNING')
        AND COALESCE("startedAt", "createdAt") < NOW() - (${graceSeconds} * INTERVAL '1 second')
        AND NOT EXISTS (
          SELECT 1
          FROM "BackgroundJob" AS job
          WHERE job."id" = "AssistantRun"."jobId"
            AND job."type" = 'assistant.agent.run'
            AND job."payload"->>'runId' = "AssistantRun"."id"
            AND job."payload"->>'conversationId' = "AssistantRun"."conversationId"
            AND (
              (job."status" = 'QUEUED'::"BackgroundJobStatus" AND job."attempts" < job."maxAttempts")
              OR (job."status" = 'RUNNING'::"BackgroundJobStatus" AND job."lockedAt" IS NOT NULL)
            )
        )
      RETURNING "id" AS id, "conversationId" AS "conversationId",
                "ownerUserId" AS "ownerUserId", "projectId" AS "projectId",
                "status" AS status, "errorCode" AS "errorCode"
    `;
    for (const run of orphanRuns) {
      if (run.status === 'CANCELLED') {
        await appendAssistantRunEvent(tx, {
          conversationId: run.conversationId, runId: run.id, type: 'run.cancelled', payload: { runId: run.id },
        });
        continue;
      }
      const code = run.errorCode ?? 'ASSISTANT_ORPHAN_RUN';
      await appendAssistantRunEvent(tx, {
        conversationId: run.conversationId, runId: run.id, type: 'run.failed', payload: { runId: run.id, code },
      });
      await tx.auditLog.create({ data: {
        projectId: run.projectId, userId: run.ownerUserId, entity: 'AssistantRun', entityId: run.id,
        action: 'ASSISTANT_RUN_FAILED', changes: { code },
      } });
    }
    return orphanRuns.length;
  });
}

export class PermanentBackgroundJobError extends Error {
  readonly retryable = false;
  constructor(message: string) { super(message); this.name = 'PermanentBackgroundJobError'; }
}

const claimStatus: BackgroundJobStatus = 'RUNNING';

/** Transactional claim. PostgreSQL row locks and SKIP LOCKED prevent concurrent workers taking the same live lease. */
export async function claimNextBackgroundJob(workerId: string, leaseSeconds: number): Promise<ClaimedBackgroundJob | null> {
  return prisma.$transaction(async (tx) => {
    const expiredJobs = await tx.$queryRaw<Array<{ id: string; type: string; payload: Prisma.JsonValue; ownerUserId: string; projectId: string | null }>>`
      UPDATE "BackgroundJob"
      SET "status" = 'FAILED'::"BackgroundJobStatus",
          "lastError" = 'Worker lease expired after maximum attempts',
          "finishedAt" = NOW(), "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = NOW()
      WHERE "status" = 'RUNNING'::"BackgroundJobStatus"
        AND "attempts" >= "maxAttempts"
        AND "lockedAt" IS NOT NULL
        AND "lockedAt" < NOW() - (${leaseSeconds} * INTERVAL '1 second')
      RETURNING "id", "type", "payload", "ownerUserId", "projectId"
    `;
    // A process can be killed after an assistant run entered RUNNING. Reconcile that durable
    // run to FAILED in the same transaction that retires its exhausted job lease, so the UI/SSE
    // cannot leave it spinning forever. Other background job types are unaffected.
    for (const expired of expiredJobs) {
      if (expired.type !== 'assistant.agent.run' || !expired.payload || typeof expired.payload !== 'object' || Array.isArray(expired.payload)) continue;
      const payload = expired.payload as Record<string, unknown>;
      if (typeof payload.runId !== 'string' || typeof payload.conversationId !== 'string') continue;
      const run = await tx.assistantRun.findFirst({
        where: { id: payload.runId, conversationId: payload.conversationId, ownerUserId: expired.ownerUserId, status: { in: ['QUEUED', 'RUNNING'] } },
        select: { id: true, conversationId: true, cancelRequestedAt: true, ownerUserId: true, projectId: true },
      });
      if (!run) continue;
      const wasCancelled = run.cancelRequestedAt !== null;
      const reconciled = await tx.assistantRun.updateMany({
        where: { id: run.id, status: { in: ['QUEUED', 'RUNNING'] }, cancelRequestedAt: wasCancelled ? { not: null } : null },
        data: { status: wasCancelled ? 'CANCELLED' : 'FAILED', errorCode: wasCancelled ? null : 'ASSISTANT_WORKER_LEASE_EXPIRED', finishedAt: new Date() },
      });
      if (reconciled.count === 1) {
        await appendAssistantRunEvent(tx, { conversationId: run.conversationId, runId: run.id, type: wasCancelled ? 'run.cancelled' : 'run.failed', payload: wasCancelled ? { runId: run.id } : { runId: run.id, code: 'ASSISTANT_WORKER_LEASE_EXPIRED' } });
        if (!wasCancelled) await tx.auditLog.create({ data: { projectId: run.projectId, userId: run.ownerUserId, entity: 'AssistantRun', entityId: run.id, action: 'ASSISTANT_RUN_FAILED', changes: { code: 'ASSISTANT_WORKER_LEASE_EXPIRED' } } });
      }
    }
    const rows = await tx.$queryRaw<ClaimedBackgroundJob[]>`
      WITH candidate AS (
        SELECT "id" FROM "BackgroundJob"
        WHERE "attempts" < "maxAttempts"
          AND (
            ("status" = 'QUEUED'::"BackgroundJobStatus" AND "availableAt" <= NOW())
            OR ("status" = 'RUNNING'::"BackgroundJobStatus" AND "lockedAt" IS NOT NULL
                AND "lockedAt" < NOW() - (${leaseSeconds} * INTERVAL '1 second'))
          )
        ORDER BY "availableAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE "BackgroundJob" AS job
      SET "status" = ${claimStatus}::"BackgroundJobStatus",
          "attempts" = job."attempts" + 1,
          "lockedAt" = NOW(), "lockedBy" = ${workerId},
          "startedAt" = COALESCE(job."startedAt", NOW()), "updatedAt" = NOW()
      FROM candidate WHERE job."id" = candidate."id"
      RETURNING job.*
    `;
    return rows[0] ?? null;
  });
}
