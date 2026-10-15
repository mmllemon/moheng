import { createHash } from 'node:crypto';
import { Prisma, type BackgroundJobStatus } from '@prisma/client';
import { prisma } from './prisma.js';
import type { ClaimedBackgroundJob } from './background-job-types.js';

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

export class PermanentBackgroundJobError extends Error {
  readonly retryable = false;
  constructor(message: string) { super(message); this.name = 'PermanentBackgroundJobError'; }
}

const claimStatus: BackgroundJobStatus = 'RUNNING';

/** Transactional claim. PostgreSQL row locks and SKIP LOCKED prevent concurrent workers taking the same live lease. */
export async function claimNextBackgroundJob(workerId: string, leaseSeconds: number): Promise<ClaimedBackgroundJob | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "BackgroundJob"
      SET "status" = 'FAILED'::"BackgroundJobStatus",
          "lastError" = 'Worker lease expired after maximum attempts',
          "finishedAt" = NOW(), "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = NOW()
      WHERE "status" = 'RUNNING'::"BackgroundJobStatus"
        AND "attempts" >= "maxAttempts"
        AND "lockedAt" IS NOT NULL
        AND "lockedAt" < NOW() - (${leaseSeconds} * INTERVAL '1 second')
    `;
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
