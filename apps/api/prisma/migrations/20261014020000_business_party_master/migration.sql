-- Unified counterparties with multi-role support. Existing textual names are preserved
-- as historical snapshots while relations are backfilled through normalized names.
CREATE TYPE "BusinessPartyRole" AS ENUM (
  'OWNER', 'MATERIAL_SUPPLIER', 'LABOR_SUBCONTRACTOR',
  'PROFESSIONAL_SUBCONTRACTOR', 'EQUIPMENT_LESSOR', 'SERVICE_PROVIDER', 'OTHER'
);
CREATE TYPE "BusinessPartyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

CREATE TABLE "BusinessParty" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "identityVerified" BOOLEAN NOT NULL DEFAULT false,
  "identityVerificationNote" TEXT,
  "creditCode" TEXT,
  "roles" "BusinessPartyRole"[] NOT NULL DEFAULT ARRAY[]::"BusinessPartyRole"[],
  "status" "BusinessPartyStatus" NOT NULL DEFAULT 'ACTIVE',
  "formerNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "legalRepresentative" TEXT,
  "address" TEXT,
  "contactName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "taxNo" TEXT,
  "invoiceTitle" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessParty_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BusinessParty_normalizedName_idx" ON "BusinessParty"("normalizedName");
CREATE UNIQUE INDEX "BusinessParty_creditCode_key" ON "BusinessParty"("creditCode");
CREATE INDEX "BusinessParty_name_idx" ON "BusinessParty"("name");
CREATE INDEX "BusinessParty_status_updatedAt_idx" ON "BusinessParty"("status", "updatedAt");
CREATE INDEX "BusinessParty_roles_idx" ON "BusinessParty" USING GIN ("roles");

ALTER TABLE "Project" ADD COLUMN "ownerPartyId" TEXT;
ALTER TABLE "DownstreamContract" ADD COLUMN "counterpartyPartyId" TEXT;
ALTER TABLE "CostEntry" ADD COLUMN "businessPartyId" TEXT;
CREATE INDEX "Project_ownerPartyId_idx" ON "Project"("ownerPartyId");
CREATE INDEX "DownstreamContract_counterpartyPartyId_idx" ON "DownstreamContract"("counterpartyPartyId");
CREATE INDEX "CostEntry_businessPartyId_idx" ON "CostEntry"("businessPartyId");

WITH candidates AS (
  SELECT "ownerName" AS name, 'OWNER'::text AS role FROM "Project" WHERE "ownerName" IS NOT NULL AND btrim("ownerName") <> ''
  UNION ALL
  SELECT dc."counterpartyName" AS name,
    CASE dc."type"::text
      WHEN 'MATERIAL_PURCHASE' THEN 'MATERIAL_SUPPLIER'
      WHEN 'LABOR_SUBCONTRACT' THEN 'LABOR_SUBCONTRACTOR'
      WHEN 'PROFESSIONAL_SUBCONTRACT' THEN 'PROFESSIONAL_SUBCONTRACTOR'
      WHEN 'EQUIPMENT_LEASE' THEN 'EQUIPMENT_LESSOR'
      WHEN 'SERVICE' THEN 'SERVICE_PROVIDER'
      ELSE 'OTHER'
    END AS role
  FROM "DownstreamContract" dc WHERE dc."counterpartyName" IS NOT NULL AND btrim(dc."counterpartyName") <> ''
  UNION ALL
  SELECT ce."vendorName" AS name, 'OTHER'::text AS role FROM "CostEntry" ce
    WHERE ce."downstreamContractId" IS NULL AND ce."vendorName" IS NOT NULL AND btrim(ce."vendorName") <> ''
), grouped AS (
  SELECT lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) AS normalized,
         min(btrim(name)) AS name,
         array_agg(DISTINCT role::"BusinessPartyRole" ORDER BY role::"BusinessPartyRole") AS roles
  FROM candidates
  GROUP BY lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
)
INSERT INTO "BusinessParty" ("id", "name", "normalizedName", "roles", "status", "identityVerified", "identityVerificationNote", "createdAt", "updatedAt")
SELECT 'bp_legacy_' || substr(md5(normalized), 1, 20), name, normalized, roles, 'ACTIVE', false, '由历史文本名称回填；尚未按统一社会信用代码或签约主体资料核验，请复核身份及跨项目归集。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM grouped;

UPDATE "Project" p SET "ownerPartyId" = bp."id"
FROM "BusinessParty" bp
WHERE bp."normalizedName" = lower(regexp_replace(btrim(p."ownerName"), '[[:space:]]+', ' ', 'g'));

UPDATE "DownstreamContract" dc SET "counterpartyPartyId" = bp."id"
FROM "BusinessParty" bp
WHERE bp."normalizedName" = lower(regexp_replace(btrim(dc."counterpartyName"), '[[:space:]]+', ' ', 'g'));

-- Prefer the legally identified party on a linked contract over free-text cost vendor labels.
UPDATE "CostEntry" ce SET "businessPartyId" = dc."counterpartyPartyId"
FROM "DownstreamContract" dc
WHERE ce."downstreamContractId" = dc."id" AND ce."businessPartyId" IS NULL AND dc."counterpartyPartyId" IS NOT NULL;
UPDATE "CostEntry" ce SET "businessPartyId" = bp."id"
FROM "BusinessParty" bp
WHERE ce."businessPartyId" IS NULL AND ce."vendorName" IS NOT NULL
  AND bp."normalizedName" = lower(regexp_replace(btrim(ce."vendorName"), '[[:space:]]+', ' ', 'g'));

ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "BusinessParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DownstreamContract" ADD CONSTRAINT "DownstreamContract_counterpartyPartyId_fkey" FOREIGN KEY ("counterpartyPartyId") REFERENCES "BusinessParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_businessPartyId_fkey" FOREIGN KEY ("businessPartyId") REFERENCES "BusinessParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
