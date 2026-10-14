BEGIN;

CREATE TYPE "DownstreamContractType" AS ENUM (
  'LABOR_SUBCONTRACT',
  'PROFESSIONAL_SUBCONTRACT',
  'MATERIAL_PURCHASE',
  'EQUIPMENT_LEASE',
  'SERVICE',
  'OTHER'
);
CREATE TYPE "DownstreamContractStatus" AS ENUM (
  'DRAFT', 'ACTIVE', 'COMPLETED', 'SETTLED', 'TERMINATED'
);
CREATE TYPE "DownstreamPaymentType" AS ENUM (
  'ADVANCE', 'PROGRESS', 'SETTLEMENT', 'RETENTION', 'REFUND', 'OTHER'
);

-- Bind income-side applications and variations to the specific main contract.
-- Nullable links preserve historic rows for projects that have no MainContract yet.
ALTER TABLE "ProgressBill" ADD COLUMN "mainContractId" TEXT;
UPDATE "ProgressBill" pb
SET "mainContractId" = mc."id"
FROM "MainContract" mc
WHERE mc."projectId" = pb."projectId";
ALTER TABLE "ProgressBill"
  ADD CONSTRAINT "ProgressBill_mainContractId_fkey"
  FOREIGN KEY ("mainContractId") REFERENCES "MainContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ProgressBill_mainContractId_idx" ON "ProgressBill"("mainContractId");

ALTER TABLE "Change" ADD COLUMN "mainContractId" TEXT;
UPDATE "Change" c
SET "mainContractId" = mc."id"
FROM "MainContract" mc
WHERE mc."projectId" = c."projectId";
ALTER TABLE "Change"
  ADD CONSTRAINT "Change_mainContractId_fkey"
  FOREIGN KEY ("mainContractId") REFERENCES "MainContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Change_mainContractId_idx" ON "Change"("mainContractId");

-- Downstream (procurement/subcontract/service) contract registry.
CREATE TABLE "DownstreamContract" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractNo" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "DownstreamContractType" NOT NULL,
  "counterpartyName" TEXT NOT NULL,
  "scope" TEXT,
  "signedAt" TIMESTAMP(3),
  "startDate" TIMESTAMP(3),
  "plannedEndDate" TIMESTAMP(3),
  "originalAmount" DECIMAL(18,2) NOT NULL,
  "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
  "paymentTerms" TEXT,
  "status" "DownstreamContractStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DownstreamContract_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamContract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContract_projectId_contractNo_key" UNIQUE ("projectId", "contractNo")
);
CREATE INDEX "DownstreamContract_projectId_status_deletedAt_idx" ON "DownstreamContract"("projectId", "status", "deletedAt");
CREATE INDEX "DownstreamContract_projectId_type_idx" ON "DownstreamContract"("projectId", "type");
CREATE INDEX "DownstreamContract_counterpartyName_idx" ON "DownstreamContract"("counterpartyName");

-- Amount changes are append-only and only recorded after an effective signed amendment exists.
CREATE TABLE "DownstreamContractAdjustment" (
  "id" TEXT NOT NULL,
  "downstreamContractId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "direction" "ChangeDirection" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "documentReference" TEXT NOT NULL,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DownstreamContractAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamContractAdjustment_downstreamContractId_fkey" FOREIGN KEY ("downstreamContractId") REFERENCES "DownstreamContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractAdjustment_downstreamContractId_code_key" UNIQUE ("downstreamContractId", "code")
);
CREATE INDEX "DownstreamContractAdjustment_downstreamContractId_effectiveAt_idx" ON "DownstreamContractAdjustment"("downstreamContractId", "effectiveAt");

CREATE TABLE "DownstreamPaymentPlan" (
  "id" TEXT NOT NULL,
  "downstreamContractId" TEXT NOT NULL,
  "stageName" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "plannedAmount" DECIMAL(18,2) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DownstreamPaymentPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamPaymentPlan_downstreamContractId_fkey" FOREIGN KEY ("downstreamContractId") REFERENCES "DownstreamContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DownstreamPaymentPlan_downstreamContractId_dueAt_idx" ON "DownstreamPaymentPlan"("downstreamContractId", "dueAt");

CREATE TABLE "DownstreamContractPayment" (
  "id" TEXT NOT NULL,
  "downstreamContractId" TEXT NOT NULL,
  "paymentPlanId" TEXT,
  "refundOfPaymentId" TEXT,
  "type" "DownstreamPaymentType" NOT NULL DEFAULT 'PROGRESS',
  "amount" DECIMAL(18,2) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "referenceNo" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DownstreamContractPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamContractPayment_downstreamContractId_fkey" FOREIGN KEY ("downstreamContractId") REFERENCES "DownstreamContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractPayment_paymentPlanId_fkey" FOREIGN KEY ("paymentPlanId") REFERENCES "DownstreamPaymentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "DownstreamContractPayment_downstreamContractId_paidAt_idx" ON "DownstreamContractPayment"("downstreamContractId", "paidAt");
CREATE INDEX "DownstreamContractPayment_paymentPlanId_idx" ON "DownstreamContractPayment"("paymentPlanId");
CREATE INDEX "DownstreamContractPayment_refundOfPaymentId_idx" ON "DownstreamContractPayment"("refundOfPaymentId");
ALTER TABLE "DownstreamContractPayment" ADD CONSTRAINT "DownstreamContractPayment_refundOfPaymentId_fkey" FOREIGN KEY ("refundOfPaymentId") REFERENCES "DownstreamContractPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "DownstreamContractPayment_downstreamContractId_referenceNo_key" ON "DownstreamContractPayment"("downstreamContractId", "referenceNo");

-- Link cost events back to the contract that caused them. Legacy costs remain valid and unlinked.
ALTER TABLE "CostEntry" ADD COLUMN "downstreamContractId" TEXT;
ALTER TABLE "CostEntry"
  ADD CONSTRAINT "CostEntry_downstreamContractId_fkey"
  FOREIGN KEY ("downstreamContractId") REFERENCES "DownstreamContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CostEntry_downstreamContractId_deletedAt_idx" ON "CostEntry"("downstreamContractId", "deletedAt");

COMMIT;
