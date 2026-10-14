
-- Preserve the existing progress-bill cash ledger when an owner receipt is refunded.
ALTER TABLE "ProgressPayment" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'RECEIPT';
ALTER TABLE "ProgressPayment" ADD COLUMN "originalReceiptNo" TEXT;
CREATE INDEX "ProgressPayment_progressBillId_paidAt_idx" ON "ProgressPayment"("progressBillId", "paidAt");

CREATE TYPE "OwnerSettlementType" AS ENUM ('FINAL', 'ADJUSTMENT');
CREATE TYPE "OwnerSettlementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'INTERNAL_APPROVED', 'COUNTERPARTY_CONFIRMED', 'POSTED', 'REJECTED');
CREATE TYPE "OwnerReceivableType" AS ENUM ('PROGRESS_BILL', 'FINAL_SETTLEMENT', 'ADJUSTMENT', 'RETENTION_RELEASE', 'MANUAL_ADJUSTMENT');
CREATE TYPE "OwnerReceivableStatus" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'VOID');
CREATE TYPE "OwnerReceiptType" AS ENUM ('RECEIPT', 'REFUND', 'ADVANCE', 'ADVANCE_REFUND');
CREATE TYPE "OwnerRetentionMovementType" AS ENUM ('WITHHOLD', 'RELEASE', 'WAIVE');
CREATE TYPE "OwnerAdvanceMovementType" AS ENUM ('RECEIPT', 'DEDUCTION', 'REFUND');

CREATE TABLE "DocumentSequence" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentSequence_key_key" ON "DocumentSequence"("key");

CREATE TABLE "OwnerContractSettlement" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "mainContractId" TEXT NOT NULL,
  "settlementNo" TEXT NOT NULL,
  "type" "OwnerSettlementType" NOT NULL,
  "status" "OwnerSettlementStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAmount" DECIMAL(18,2) NOT NULL,
  "confirmedAmount" DECIMAL(18,2),
  "postedDeltaAmount" DECIMAL(18,2),
  "previousCumulativeAmount" DECIMAL(18,2),
  "cumulativeAfterAmount" DECIMAL(18,2),
  "advanceDeductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "retentionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "otherDeductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "netReceivableAmount" DECIMAL(18,2),
  "dueAt" TIMESTAMP(3),
  "confirmationReference" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "submittedById" TEXT,
  "approvedById" TEXT,
  "confirmedById" TEXT,
  "rejectedById" TEXT,
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OwnerContractSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerContractSettlement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerContractSettlement_mainContractId_fkey" FOREIGN KEY ("mainContractId") REFERENCES "MainContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerContractSettlement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerContractSettlement_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerContractSettlement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerContractSettlement_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerContractSettlement_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OwnerContractSettlement_projectId_settlementNo_key" ON "OwnerContractSettlement"("projectId", "settlementNo");
CREATE INDEX "OwnerContractSettlement_projectId_status_type_idx" ON "OwnerContractSettlement"("projectId", "status", "type");
CREATE INDEX "OwnerContractSettlement_mainContractId_status_idx" ON "OwnerContractSettlement"("mainContractId", "status");

CREATE TABLE "OwnerSettlementLine" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(18,3),
  "unit" TEXT,
  "unitPrice" DECIMAL(18,4),
  "amount" DECIMAL(18,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "OwnerSettlementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerSettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "OwnerContractSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OwnerSettlementLine_settlementId_sortOrder_idx" ON "OwnerSettlementLine"("settlementId", "sortOrder");

CREATE TABLE "OwnerSettlementPosting" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "mainContractId" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "previousCumulativeAmount" DECIMAL(18,2) NOT NULL,
  "deltaAmount" DECIMAL(18,2) NOT NULL,
  "cumulativeAfterAmount" DECIMAL(18,2) NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "postedById" TEXT NOT NULL,
  CONSTRAINT "OwnerSettlementPosting_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerSettlementPosting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerSettlementPosting_mainContractId_fkey" FOREIGN KEY ("mainContractId") REFERENCES "MainContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerSettlementPosting_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "OwnerContractSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerSettlementPosting_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OwnerSettlementPosting_settlementId_key" ON "OwnerSettlementPosting"("settlementId");
CREATE INDEX "OwnerSettlementPosting_projectId_postedAt_idx" ON "OwnerSettlementPosting"("projectId", "postedAt");
CREATE INDEX "OwnerSettlementPosting_mainContractId_postedAt_idx" ON "OwnerSettlementPosting"("mainContractId", "postedAt");

CREATE TABLE "OwnerRetentionMovement" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "mainContractId" TEXT NOT NULL,
  "settlementId" TEXT,
  "type" "OwnerRetentionMovementType" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerRetentionMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerRetentionMovement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerRetentionMovement_mainContractId_fkey" FOREIGN KEY ("mainContractId") REFERENCES "MainContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerRetentionMovement_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "OwnerContractSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerRetentionMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OwnerRetentionMovement_mainContractId_effectiveAt_idx" ON "OwnerRetentionMovement"("mainContractId", "effectiveAt");
CREATE INDEX "OwnerRetentionMovement_projectId_type_idx" ON "OwnerRetentionMovement"("projectId", "type");

CREATE TABLE "OwnerReceivable" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "mainContractId" TEXT NOT NULL,
  "receivableNo" TEXT NOT NULL,
  "type" "OwnerReceivableType" NOT NULL,
  "title" TEXT NOT NULL,
  "sourceSettlementId" TEXT,
  "sourceProgressBillId" TEXT,
  "sourceRetentionMovementId" TEXT,
  "grossAmount" DECIMAL(18,2) NOT NULL,
  "advanceDeductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "retentionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "otherDeductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(18,2) NOT NULL,
  "dueAt" TIMESTAMP(3),
  "status" "OwnerReceivableStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerReceivable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerReceivable_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceivable_mainContractId_fkey" FOREIGN KEY ("mainContractId") REFERENCES "MainContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceivable_sourceSettlementId_fkey" FOREIGN KEY ("sourceSettlementId") REFERENCES "OwnerContractSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceivable_sourceProgressBillId_fkey" FOREIGN KEY ("sourceProgressBillId") REFERENCES "ProgressBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceivable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE "OwnerReceivable" ADD CONSTRAINT "OwnerReceivable_sourceRetentionMovementId_fkey" FOREIGN KEY ("sourceRetentionMovementId") REFERENCES "OwnerRetentionMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "OwnerReceivable_projectId_receivableNo_key" ON "OwnerReceivable"("projectId", "receivableNo");
CREATE UNIQUE INDEX "OwnerReceivable_sourceSettlementId_key" ON "OwnerReceivable"("sourceSettlementId");
CREATE UNIQUE INDEX "OwnerReceivable_sourceProgressBillId_key" ON "OwnerReceivable"("sourceProgressBillId");
CREATE UNIQUE INDEX "OwnerReceivable_sourceRetentionMovementId_key" ON "OwnerReceivable"("sourceRetentionMovementId");
CREATE INDEX "OwnerReceivable_projectId_status_dueAt_idx" ON "OwnerReceivable"("projectId", "status", "dueAt");
CREATE INDEX "OwnerReceivable_mainContractId_status_idx" ON "OwnerReceivable"("mainContractId", "status");

CREATE TABLE "OwnerReceivableSchedule" (
  "id" TEXT NOT NULL,
  "receivableId" TEXT NOT NULL,
  "scheduleNo" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerReceivableSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerReceivableSchedule_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "OwnerReceivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OwnerReceivableSchedule_receivableId_scheduleNo_key" ON "OwnerReceivableSchedule"("receivableId", "scheduleNo");
CREATE INDEX "OwnerReceivableSchedule_dueAt_idx" ON "OwnerReceivableSchedule"("dueAt");

CREATE TABLE "OwnerReceipt" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "mainContractId" TEXT NOT NULL,
  "receiptNo" TEXT NOT NULL,
  "type" "OwnerReceiptType" NOT NULL DEFAULT 'RECEIPT',
  "amount" DECIMAL(18,2) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "referenceNo" TEXT,
  "notes" TEXT,
  "originalReceiptId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceipt_mainContractId_fkey" FOREIGN KEY ("mainContractId") REFERENCES "MainContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceipt_originalReceiptId_fkey" FOREIGN KEY ("originalReceiptId") REFERENCES "OwnerReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OwnerReceipt_projectId_receiptNo_key" ON "OwnerReceipt"("projectId", "receiptNo");
CREATE INDEX "OwnerReceipt_mainContractId_receivedAt_idx" ON "OwnerReceipt"("mainContractId", "receivedAt");
CREATE INDEX "OwnerReceipt_originalReceiptId_idx" ON "OwnerReceipt"("originalReceiptId");

CREATE TABLE "OwnerReceiptAllocation" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "receivableId" TEXT NOT NULL,
  "scheduleId" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "reversesId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerReceiptAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerReceiptAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "OwnerReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceiptAllocation_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "OwnerReceivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceiptAllocation_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "OwnerReceivableSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerReceiptAllocation_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "OwnerReceiptAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OwnerReceiptAllocation_receiptId_idx" ON "OwnerReceiptAllocation"("receiptId");
CREATE INDEX "OwnerReceiptAllocation_receivableId_idx" ON "OwnerReceiptAllocation"("receivableId");
CREATE INDEX "OwnerReceiptAllocation_scheduleId_idx" ON "OwnerReceiptAllocation"("scheduleId");

CREATE TABLE "OwnerAdvanceMovement" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "mainContractId" TEXT NOT NULL,
  "receiptId" TEXT,
  "settlementId" TEXT,
  "type" "OwnerAdvanceMovementType" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "reference" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerAdvanceMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OwnerAdvanceMovement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerAdvanceMovement_mainContractId_fkey" FOREIGN KEY ("mainContractId") REFERENCES "MainContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerAdvanceMovement_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "OwnerReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerAdvanceMovement_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "OwnerContractSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnerAdvanceMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OwnerAdvanceMovement_mainContractId_occurredAt_idx" ON "OwnerAdvanceMovement"("mainContractId", "occurredAt");
CREATE INDEX "OwnerAdvanceMovement_projectId_type_idx" ON "OwnerAdvanceMovement"("projectId", "type");

-- Backfill receivables from approved historical progress bills with an explicit main-contract link.
-- Legacy records without that source link remain untouched and can be reconciled manually later.
INSERT INTO "OwnerReceivable" ("id", "projectId", "mainContractId", "receivableNo", "type", "title", "sourceProgressBillId", "grossAmount", "advanceDeductionAmount", "retentionAmount", "otherDeductionAmount", "netAmount", "dueAt", "status", "notes", "createdById", "postedAt")
SELECT 'legacy-ar-' || LEFT(md5(pb."id"), 20), pb."projectId", pb."mainContractId", 'LEGACY-AR-' || LEFT(md5(pb."id"), 16), 'PROGRESS_BILL', '历史进度款第' || pb."periodNo" || '期', pb."id", COALESCE(pb."approvedAmount", pb."amount"), 0, 0, 0, COALESCE(pb."approvedAmount", pb."amount"), NULL,
  CASE WHEN COALESCE(pb."paidAmount", 0) >= COALESCE(pb."approvedAmount", pb."amount") THEN 'RECEIVED'::"OwnerReceivableStatus" WHEN COALESCE(pb."paidAmount", 0) > 0 THEN 'PARTIALLY_RECEIVED'::"OwnerReceivableStatus" ELSE 'OPEN'::"OwnerReceivableStatus" END,
  '由历史已核定进度款迁移生成；原始进度款与到账台账保留。', COALESCE((SELECT pm."userId" FROM "ProjectMember" pm WHERE pm."projectId" = pb."projectId" ORDER BY CASE WHEN pm."role" = 'OWNER' THEN 0 ELSE 1 END, pm."createdAt" LIMIT 1), (SELECT u."id" FROM "User" u ORDER BY u."createdAt" LIMIT 1)), pb."updatedAt"
FROM "ProgressBill" pb
WHERE pb."deletedAt" IS NULL AND pb."mainContractId" IS NOT NULL AND pb."approvedAmount" IS NOT NULL
ON CONFLICT ("sourceProgressBillId") DO NOTHING;

INSERT INTO "OwnerReceipt" ("id", "projectId", "mainContractId", "receiptNo", "type", "amount", "receivedAt", "referenceNo", "notes", "createdById", "createdAt")
SELECT 'legacy-rc-' || LEFT(md5(pp."id"), 20), pb."projectId", pb."mainContractId", 'LEGACY-RC-' || LEFT(md5(pp."id"), 16), 'RECEIPT', pp."amount", pp."paidAt", pp."referenceNo", COALESCE(pp."notes", '由历史进度款到账记录迁移生成。'), COALESCE((SELECT pm."userId" FROM "ProjectMember" pm WHERE pm."projectId" = pb."projectId" ORDER BY CASE WHEN pm."role" = 'OWNER' THEN 0 ELSE 1 END, pm."createdAt" LIMIT 1), (SELECT u."id" FROM "User" u ORDER BY u."createdAt" LIMIT 1)), pp."createdAt"
FROM "ProgressPayment" pp
JOIN "ProgressBill" pb ON pb."id" = pp."progressBillId"
JOIN "OwnerReceivable" ar ON ar."sourceProgressBillId" = pb."id"
ON CONFLICT DO NOTHING;

INSERT INTO "OwnerReceiptAllocation" ("id", "receiptId", "receivableId", "amount", "notes", "createdAt")
SELECT 'legacy-alloc-' || LEFT(md5(pp."id"), 20), 'legacy-rc-' || LEFT(md5(pp."id"), 20), ar."id", pp."amount", '由历史进度款到账流水迁移生成。', pp."createdAt"
FROM "ProgressPayment" pp
JOIN "ProgressBill" pb ON pb."id" = pp."progressBillId"
JOIN "OwnerReceivable" ar ON ar."sourceProgressBillId" = pb."id"
JOIN "OwnerReceipt" r ON r."id" = 'legacy-rc-' || LEFT(md5(pp."id"), 20)
ON CONFLICT DO NOTHING;
