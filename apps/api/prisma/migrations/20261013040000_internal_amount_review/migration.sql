CREATE TYPE "InternalAmountReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'COMPLETED');

ALTER TABLE "Change"
  ADD COLUMN "internalAmountReviewStatus" "InternalAmountReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "internalAmountReviewTriggeredAt" TIMESTAMP(3),
  ADD COLUMN "internalAmountReviewCompletedAt" TIMESTAMP(3),
  ADD COLUMN "internalAmountReviewCompletedById" TEXT,
  ADD COLUMN "internalAmountReviewNote" TEXT,
  ADD COLUMN "internalAmountReviewReferenceAmount" DECIMAL(18,2),
  ADD COLUMN "internalAmountReviewExternalAmount" DECIMAL(18,2);

ALTER TABLE "Change"
  ADD CONSTRAINT "Change_internalAmountReviewCompletedById_fkey"
  FOREIGN KEY ("internalAmountReviewCompletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Change_projectId_internalAmountReviewStatus_idx"
  ON "Change"("projectId", "internalAmountReviewStatus");


-- Existing externally effective changes can predate this review field. Flag amount
-- differences for internal follow-up without changing their effective status or amount.
UPDATE "Change"
SET "internalAmountReviewStatus" = 'PENDING',
    "internalAmountReviewTriggeredAt" = COALESCE("effectiveAt", "updatedAt", CURRENT_TIMESTAMP),
    "internalAmountReviewReferenceAmount" = COALESCE("approvedAmount", "submittedAmount"),
    "internalAmountReviewExternalAmount" = "externalConfirmedAmount"
WHERE "deletedAt" IS NULL
  AND "externalConfirmationStatus" = 'EFFECTIVE'
  AND "externalConfirmedAmount" IS NOT NULL
  AND COALESCE("approvedAmount", "submittedAmount") <> "externalConfirmedAmount";
