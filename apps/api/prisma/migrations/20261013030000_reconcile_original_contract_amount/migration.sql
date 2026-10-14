BEGIN;

-- A previously shipped migration established originalContractAmount from Project.contractAmount.
-- When a formal MainContract exists, its archived amount is the authoritative signed baseline.
-- Record any baseline/effective-total correction before applying it; never silently discard the old values.
CREATE TABLE "ContractBaselineMigrationReconciliation" (
  "id" BIGSERIAL NOT NULL,
  "migrationKey" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "previousOriginalAmount" DECIMAL(18,2) NOT NULL,
  "mainContractAmount" DECIMAL(18,2),
  "reconciledOriginalAmount" DECIMAL(18,2) NOT NULL,
  "previousEffectiveAmount" DECIMAL(18,2) NOT NULL,
  "reconciledEffectiveAmount" DECIMAL(18,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractBaselineMigrationReconciliation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractBaselineMigrationReconciliation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContractBaselineMigrationReconciliation_migrationKey_projectId_key"
    UNIQUE ("migrationKey", "projectId")
);
CREATE INDEX "ContractBaselineMigrationReconciliation_projectId_createdAt_idx"
  ON "ContractBaselineMigrationReconciliation"("projectId", "createdAt");

CREATE TEMP TABLE "_ContractBaselineReconciliationPlan" ON COMMIT DROP AS
SELECT
  p."id" AS "projectId",
  p."originalContractAmount" AS "previousOriginalAmount",
  mc."amount" AS "mainContractAmount",
  COALESCE(mc."amount", p."originalContractAmount", p."contractAmount") AS "reconciledOriginalAmount",
  p."contractAmount" AS "previousEffectiveAmount",
  COALESCE(mc."amount", p."originalContractAmount", p."contractAmount") +
    COALESCE(SUM(
      CASE c."direction"
        WHEN 'INCREASE' THEN c."externalConfirmedAmount"
        WHEN 'DECREASE' THEN -c."externalConfirmedAmount"
        ELSE 0
      END
    ) FILTER (WHERE c."id" IS NOT NULL), 0) AS "reconciledEffectiveAmount"
FROM "Project" p
LEFT JOIN "MainContract" mc ON mc."projectId" = p."id"
LEFT JOIN "Change" c
  ON c."projectId" = p."id"
  AND c."deletedAt" IS NULL
  AND c."externalConfirmationStatus" = 'EFFECTIVE'
  AND c."externalConfirmedAmount" IS NOT NULL
GROUP BY p."id", p."originalContractAmount", p."contractAmount", mc."amount";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "_ContractBaselineReconciliationPlan"
    WHERE "reconciledEffectiveAmount" < 0
       OR "reconciledEffectiveAmount" > 9999999999999999.99
  ) THEN
    RAISE EXCEPTION 'CONTRACT_BASELINE_RECONCILIATION_OUT_OF_RANGE: review main-contract ledger and effective external confirmations before retrying this migration';
  END IF;
END $$;

INSERT INTO "ContractBaselineMigrationReconciliation" (
  "migrationKey", "projectId", "previousOriginalAmount", "mainContractAmount",
  "reconciledOriginalAmount", "previousEffectiveAmount", "reconciledEffectiveAmount", "reason"
)
SELECT
  '20261013030000_reconcile_original_contract_amount', "projectId", "previousOriginalAmount", "mainContractAmount",
  "reconciledOriginalAmount", "previousEffectiveAmount", "reconciledEffectiveAmount",
  CASE
    WHEN "mainContractAmount" IS NOT NULL AND "mainContractAmount" <> "previousOriginalAmount" THEN 'MAIN_CONTRACT_LEDGER_TAKES_PRECEDENCE'
    WHEN "reconciledEffectiveAmount" <> "previousEffectiveAmount" THEN 'RECALCULATE_EFFECTIVE_EXTERNAL_CONFIRMATIONS'
    ELSE 'BASELINE_RECONCILIATION_NO_AMOUNT_CHANGE'
  END
FROM "_ContractBaselineReconciliationPlan"
WHERE "mainContractAmount" IS DISTINCT FROM "previousOriginalAmount"
   OR "reconciledEffectiveAmount" IS DISTINCT FROM "previousEffectiveAmount";

UPDATE "Project" p
SET "originalContractAmount" = plan."reconciledOriginalAmount",
    "contractAmount" = plan."reconciledEffectiveAmount"
FROM "_ContractBaselineReconciliationPlan" plan
WHERE plan."projectId" = p."id";

COMMIT;
