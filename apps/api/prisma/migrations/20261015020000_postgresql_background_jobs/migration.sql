CREATE TYPE "BackgroundJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "BackgroundJob" (
  "id" TEXT NOT NULL,
  "type" VARCHAR(100) NOT NULL,
  "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
  "payloadVersion" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "resultMetadata" JSONB,
  "resultFileName" VARCHAR(255),
  "ownerUserId" TEXT NOT NULL,
  "projectId" TEXT,
  "idempotencyKey" VARCHAR(200),
  "requestHash" VARCHAR(64),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ(3),
  "lockedBy" VARCHAR(160),
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "resultExpiresAt" TIMESTAMPTZ(3),
  "lastError" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BackgroundJob_ownerUserId_idempotencyKey_key" ON "BackgroundJob"("ownerUserId", "idempotencyKey");
CREATE INDEX "BackgroundJob_status_availableAt_createdAt_idx" ON "BackgroundJob"("status", "availableAt", "createdAt");
CREATE INDEX "BackgroundJob_status_lockedAt_idx" ON "BackgroundJob"("status", "lockedAt");
CREATE INDEX "BackgroundJob_ownerUserId_createdAt_idx" ON "BackgroundJob"("ownerUserId", "createdAt");
CREATE INDEX "BackgroundJob_projectId_status_createdAt_idx" ON "BackgroundJob"("projectId", "status", "createdAt");
CREATE INDEX "BackgroundJob_resultExpiresAt_idx" ON "BackgroundJob"("resultExpiresAt");
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
