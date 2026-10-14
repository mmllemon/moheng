-- v1.3.0-rc.1: settlement, payable, invoice, advance-recovery and retention ledgers.
-- Settlement lines are optional by design; the settlement header is a valid amount-only source.

CREATE TYPE "DownstreamSettlementType" AS ENUM ('PROGRESS', 'FINAL', 'ADJUSTMENT');
CREATE TYPE "DownstreamSettlementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'INTERNAL_APPROVED', 'COUNTERPARTY_CONFIRMED', 'POSTED', 'REJECTED');
CREATE TYPE "DownstreamPayableType" AS ENUM ('SETTLEMENT', 'ADJUSTMENT', 'RETENTION_RELEASE');
CREATE TYPE "DownstreamInvoiceStatus" AS ENUM ('RECEIVED', 'VERIFIED', 'REJECTED');
CREATE TYPE "DownstreamRetentionMovementType" AS ENUM ('RETAIN', 'RELEASE', 'FORFEIT');

CREATE TABLE "DownstreamContractSettlement" (
  "id" TEXT NOT NULL,
  "downstreamContractId" TEXT NOT NULL,
  "settlementNo" TEXT NOT NULL,
  "type" "DownstreamSettlementType" NOT NULL,
  "status" "DownstreamSettlementStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAmount" DECIMAL(18,2) NOT NULL,
  "confirmedAmount" DECIMAL(18,2),
  "postedDeltaAmount" DECIMAL(18,2),
  "advanceRecoveryAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "retentionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "otherDeductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "netPayableAmount" DECIMAL(18,2),
  "dueAt" TIMESTAMP(3),
  "confirmationReference" TEXT,
  "confirmationDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "submittedById" TEXT,
  "internalApprovedById" TEXT,
  "counterpartyRecordedById" TEXT,
  "rejectedById" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "submittedAt" TIMESTAMP(3),
  "internalApprovedAt" TIMESTAMP(3),
  "counterpartyConfirmedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DownstreamContractSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamContractSettlement_downstreamContractId_fkey" FOREIGN KEY ("downstreamContractId") REFERENCES "DownstreamContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractSettlement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractSettlement_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractSettlement_internalApprovedById_fkey" FOREIGN KEY ("internalApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractSettlement_counterpartyRecordedById_fkey" FOREIGN KEY ("counterpartyRecordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractSettlement_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamContractSettlement_amounts_nonnegative" CHECK (
    "submittedAmount" > 0 AND "advanceRecoveryAmount" >= 0 AND "retentionAmount" >= 0 AND "otherDeductionAmount" >= 0
  )
);
CREATE UNIQUE INDEX "DownstreamContractSettlement_downstreamContractId_settlementNo_key" ON "DownstreamContractSettlement"("downstreamContractId", "settlementNo");
CREATE INDEX "DownstreamContractSettlement_downstreamContractId_status_createdAt_idx" ON "DownstreamContractSettlement"("downstreamContractId", "status", "createdAt");
CREATE INDEX "DownstreamContractSettlement_downstreamContractId_type_postedAt_idx" ON "DownstreamContractSettlement"("downstreamContractId", "type", "postedAt");

CREATE TABLE "DownstreamSettlementLine" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(18,3),
  "unit" TEXT,
  "unitPrice" DECIMAL(18,4),
  "amount" DECIMAL(18,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DownstreamSettlementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamSettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "DownstreamContractSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DownstreamSettlementLine_amount_positive" CHECK ("amount" > 0)
);
CREATE INDEX "DownstreamSettlementLine_settlementId_sortOrder_idx" ON "DownstreamSettlementLine"("settlementId", "sortOrder");

CREATE TABLE "DownstreamSettlementPosting" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "downstreamContractId" TEXT NOT NULL,
  "cumulativeBefore" DECIMAL(18,2) NOT NULL,
  "deltaAmount" DECIMAL(18,2) NOT NULL,
  "cumulativeAfter" DECIMAL(18,2) NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "postedById" TEXT NOT NULL,
  CONSTRAINT "DownstreamSettlementPosting_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamSettlementPosting_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "DownstreamContractSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamSettlementPosting_downstreamContractId_fkey" FOREIGN KEY ("downstreamContractId") REFERENCES "DownstreamContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamSettlementPosting_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamSettlementPosting_nonnegative_total" CHECK ("cumulativeBefore" >= 0 AND "cumulativeAfter" >= 0 AND "cumulativeAfter" = "cumulativeBefore" + "deltaAmount")
);
CREATE UNIQUE INDEX "DownstreamSettlementPosting_settlementId_key" ON "DownstreamSettlementPosting"("settlementId");
CREATE INDEX "DownstreamSettlementPosting_downstreamContractId_postedAt_idx" ON "DownstreamSettlementPosting"("downstreamContractId", "postedAt");

CREATE TABLE "DownstreamRetentionMovement" (
  "id" TEXT NOT NULL,
  "downstreamContractId" TEXT NOT NULL,
  "settlementId" TEXT,
  "type" "DownstreamRetentionMovementType" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reference" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DownstreamRetentionMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamRetentionMovement_downstreamContractId_fkey" FOREIGN KEY ("downstreamContractId") REFERENCES "DownstreamContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamRetentionMovement_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "DownstreamContractSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamRetentionMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamRetentionMovement_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "DownstreamRetentionMovement_settlementId_key" ON "DownstreamRetentionMovement"("settlementId");
CREATE INDEX "DownstreamRetentionMovement_downstreamContractId_effectiveAt_idx" ON "DownstreamRetentionMovement"("downstreamContractId", "effectiveAt");

CREATE TABLE "DownstreamPayable" (
  "id" TEXT NOT NULL,
  "downstreamContractId" TEXT NOT NULL,
  "payableNo" TEXT NOT NULL,
  "type" "DownstreamPayableType" NOT NULL,
  "settlementId" TEXT,
  "retentionMovementId" TEXT,
  "grossAmount" DECIMAL(18,2) NOT NULL,
  "advanceRecoveryAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "retentionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "otherDeductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(18,2) NOT NULL,
  "dueAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DownstreamPayable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamPayable_downstreamContractId_fkey" FOREIGN KEY ("downstreamContractId") REFERENCES "DownstreamContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamPayable_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "DownstreamContractSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamPayable_retentionMovementId_fkey" FOREIGN KEY ("retentionMovementId") REFERENCES "DownstreamRetentionMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamPayable_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamPayable_deductions_nonnegative" CHECK ("advanceRecoveryAmount" >= 0 AND "retentionAmount" >= 0 AND "otherDeductionAmount" >= 0)
);
CREATE UNIQUE INDEX "DownstreamPayable_downstreamContractId_payableNo_key" ON "DownstreamPayable"("downstreamContractId", "payableNo");
CREATE UNIQUE INDEX "DownstreamPayable_settlementId_key" ON "DownstreamPayable"("settlementId");
CREATE UNIQUE INDEX "DownstreamPayable_retentionMovementId_key" ON "DownstreamPayable"("retentionMovementId");
CREATE INDEX "DownstreamPayable_downstreamContractId_dueAt_postedAt_idx" ON "DownstreamPayable"("downstreamContractId", "dueAt", "postedAt");
CREATE INDEX "DownstreamPayable_downstreamContractId_type_idx" ON "DownstreamPayable"("downstreamContractId", "type");

CREATE TABLE "DownstreamPayableSchedule" (
  "id" TEXT NOT NULL,
  "payableId" TEXT NOT NULL,
  "scheduleNo" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DownstreamPayableSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamPayableSchedule_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "DownstreamPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamPayableSchedule_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "DownstreamPayableSchedule_payableId_scheduleNo_key" ON "DownstreamPayableSchedule"("payableId", "scheduleNo");
CREATE INDEX "DownstreamPayableSchedule_payableId_dueAt_idx" ON "DownstreamPayableSchedule"("payableId", "dueAt");

CREATE TABLE "DownstreamPaymentAllocation" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "payableId" TEXT NOT NULL,
  "payableScheduleId" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DownstreamPaymentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "DownstreamContractPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamPaymentAllocation_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "DownstreamPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamPaymentAllocation_payableScheduleId_fkey" FOREIGN KEY ("payableScheduleId") REFERENCES "DownstreamPayableSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamPaymentAllocation_amount_nonzero" CHECK ("amount" <> 0)
);
CREATE INDEX "DownstreamPaymentAllocation_paymentId_payableId_idx" ON "DownstreamPaymentAllocation"("paymentId", "payableId");
CREATE INDEX "DownstreamPaymentAllocation_payableId_createdAt_idx" ON "DownstreamPaymentAllocation"("payableId", "createdAt");
CREATE INDEX "DownstreamPaymentAllocation_payableScheduleId_idx" ON "DownstreamPaymentAllocation"("payableScheduleId");

CREATE TABLE "DownstreamSupplierInvoice" (
  "id" TEXT NOT NULL,
  "downstreamContractId" TEXT NOT NULL,
  "invoiceNo" TEXT NOT NULL,
  "invoiceDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "taxIncluded" BOOLEAN NOT NULL DEFAULT TRUE,
  "status" "DownstreamInvoiceStatus" NOT NULL DEFAULT 'RECEIVED',
  "notes" TEXT,
  "verificationNote" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DownstreamSupplierInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamSupplierInvoice_downstreamContractId_fkey" FOREIGN KEY ("downstreamContractId") REFERENCES "DownstreamContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamSupplierInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamSupplierInvoice_amounts_positive" CHECK ("amount" > 0 AND "taxAmount" >= 0 AND "taxAmount" <= "amount")
);
CREATE UNIQUE INDEX "DownstreamSupplierInvoice_downstreamContractId_invoiceNo_key" ON "DownstreamSupplierInvoice"("downstreamContractId", "invoiceNo");
CREATE INDEX "DownstreamSupplierInvoice_downstreamContractId_status_invoiceDate_idx" ON "DownstreamSupplierInvoice"("downstreamContractId", "status", "invoiceDate");

CREATE TABLE "DownstreamInvoiceAllocation" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "payableId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DownstreamInvoiceAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DownstreamInvoiceAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "DownstreamSupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamInvoiceAllocation_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "DownstreamPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DownstreamInvoiceAllocation_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "DownstreamInvoiceAllocation_invoiceId_payableId_key" ON "DownstreamInvoiceAllocation"("invoiceId", "payableId");
CREATE INDEX "DownstreamInvoiceAllocation_payableId_idx" ON "DownstreamInvoiceAllocation"("payableId");
