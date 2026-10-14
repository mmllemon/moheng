CREATE TYPE "ChangeDirection" AS ENUM ('INCREASE', 'DECREASE');
CREATE TYPE "EvidenceClass" AS ENUM ('A', 'B', 'C');
CREATE TYPE "ExternalConfirmationStatus" AS ENUM ('NOT_CONFIRMED', 'PENDING_SUPPLEMENT', 'PENDING_VERIFICATION', 'EFFECTIVE', 'REJECTED', 'DISPUTED');

ALTER TABLE "Project" ADD COLUMN "originalContractAmount" DECIMAL(18,2);
UPDATE "Project" SET "originalContractAmount" = "contractAmount" WHERE "originalContractAmount" IS NULL;
ALTER TABLE "Project" ALTER COLUMN "originalContractAmount" SET NOT NULL;

ALTER TABLE "Change"
  ADD COLUMN "direction" "ChangeDirection" NOT NULL DEFAULT 'INCREASE',
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "submittedById" TEXT,
  ADD COLUMN "internalApprovedById" TEXT,
  ADD COLUMN "internalApprovedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceClass" "EvidenceClass",
  ADD COLUMN "externalConfirmerName" TEXT,
  ADD COLUMN "externalConfirmerAuthority" TEXT,
  ADD COLUMN "externalConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "externalConfirmedAmount" DECIMAL(18,2),
  ADD COLUMN "externalConfirmationScope" TEXT,
  ADD COLUMN "evidenceReference" TEXT,
  ADD COLUMN "evidenceContext" TEXT,
  ADD COLUMN "evidenceFiles" JSONB,
  ADD COLUMN "externalConfirmationStatus" "ExternalConfirmationStatus" NOT NULL DEFAULT 'NOT_CONFIRMED',
  ADD COLUMN "externalRecordedById" TEXT,
  ADD COLUMN "evidenceVerifiedById" TEXT,
  ADD COLUMN "evidenceVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "evidenceVerificationNote" TEXT,
  ADD COLUMN "effectiveAt" TIMESTAMP(3);

-- Backfill historical actors where a corresponding audit record exists.
UPDATE "Change" c
SET "createdById" = a."userId"
FROM "AuditLog" a
WHERE a."entity" = 'Change' AND a."entityId" = c."id" AND a."action" = 'CREATE'
  AND c."createdById" IS NULL;

UPDATE "Change" c
SET "submittedById" = a."userId"
FROM "AuditLog" a
WHERE a."entity" = 'Change' AND a."entityId" = c."id" AND a."action" = 'STATUS_CHANGE'
  AND a."changes"->>'to' = 'SUBMITTED'
  AND c."submittedById" IS NULL;

UPDATE "Change" SET "submittedById" = "createdById" WHERE "submittedById" IS NULL AND "status" <> 'DRAFT';

ALTER TABLE "Change" ADD CONSTRAINT "Change_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Change" ADD CONSTRAINT "Change_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Change" ADD CONSTRAINT "Change_internalApprovedById_fkey" FOREIGN KEY ("internalApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Change" ADD CONSTRAINT "Change_externalRecordedById_fkey" FOREIGN KEY ("externalRecordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Change" ADD CONSTRAINT "Change_evidenceVerifiedById_fkey" FOREIGN KEY ("evidenceVerifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Change_projectId_externalConfirmationStatus_idx" ON "Change"("projectId", "externalConfirmationStatus");
CREATE INDEX "Change_createdById_idx" ON "Change"("createdById");
CREATE INDEX "Change_submittedById_idx" ON "Change"("submittedById");
