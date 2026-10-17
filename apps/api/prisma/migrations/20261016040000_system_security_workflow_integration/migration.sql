-- Encrypt database dumps at rest and retain encrypted PostgreSQL global-role/configuration companion metadata.
ALTER TABLE "SystemBackupRun"
  ADD COLUMN "globalsFileName" VARCHAR(255),
  ADD COLUMN "globalsFileSize" BIGINT,
  ADD COLUMN "globalsSha256" VARCHAR(64);

ALTER TABLE "IntegrationCredential"
  ADD COLUMN "lastTestAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastTestStatus" VARCHAR(40),
  ADD COLUMN "lastTestSummary" VARCHAR(500);

-- New backups must have both an encrypted database artifact and encrypted globals companion before marked successful.
ALTER TABLE "SystemBackupRun"
  ADD CONSTRAINT "SystemBackupRun_globals_artifact_consistency_check"
  CHECK (("globalsFileName" IS NULL AND "globalsFileSize" IS NULL AND "globalsSha256" IS NULL)
      OR ("globalsFileName" IS NOT NULL AND "globalsFileSize" IS NOT NULL AND "globalsFileSize" > 0 AND "globalsSha256" IS NOT NULL AND "globalsSha256" ~ '^[a-f0-9]{64}$'));
