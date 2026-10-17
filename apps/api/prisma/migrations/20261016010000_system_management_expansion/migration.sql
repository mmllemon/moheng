-- System-management expansion: organization, published rule versions, verified backups and encrypted integration credentials.
CREATE TYPE "GovernanceRuleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "BackupRunType" AS ENUM ('BACKUP', 'RESTORE_DRILL');
CREATE TYPE "BackupRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "Department" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "parentId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");
CREATE INDEX "Department_parentId_isActive_idx" ON "Department"("parentId", "isActive");
CREATE INDEX "Department_isActive_name_idx" ON "Department"("isActive", "name");

ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "User" ADD COLUMN "position" VARCHAR(120);
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "GovernanceRuleVersion" (
  "id" TEXT NOT NULL,
  "ruleKey" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "GovernanceRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "definition" JSONB NOT NULL,
  "changeNote" VARCHAR(1000),
  "createdById" TEXT NOT NULL,
  "publishedById" TEXT,
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GovernanceRuleVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GovernanceRuleVersion_ruleKey_version_key" ON "GovernanceRuleVersion"("ruleKey", "version");
CREATE INDEX "GovernanceRuleVersion_ruleKey_status_version_idx" ON "GovernanceRuleVersion"("ruleKey", "status", "version");
CREATE INDEX "GovernanceRuleVersion_createdById_createdAt_idx" ON "GovernanceRuleVersion"("createdById", "createdAt");
ALTER TABLE "GovernanceRuleVersion" ADD CONSTRAINT "GovernanceRuleVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GovernanceRuleVersion" ADD CONSTRAINT "GovernanceRuleVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SystemBackupRun" (
  "id" TEXT NOT NULL,
  "type" "BackupRunType" NOT NULL,
  "status" "BackupRunStatus" NOT NULL DEFAULT 'RUNNING',
  "fileName" VARCHAR(255),
  "sourceBackupId" TEXT,
  "fileSize" BIGINT,
  "sha256" VARCHAR(64),
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  "durationMs" INTEGER,
  "verified" BOOLEAN NOT NULL DEFAULT FALSE,
  "message" VARCHAR(2000),
  "triggeredById" TEXT NOT NULL,
  CONSTRAINT "SystemBackupRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SystemBackupRun_sourceBackupId_idx" ON "SystemBackupRun"("sourceBackupId");
CREATE INDEX "SystemBackupRun_type_status_startedAt_idx" ON "SystemBackupRun"("type", "status", "startedAt");
CREATE INDEX "SystemBackupRun_triggeredById_startedAt_idx" ON "SystemBackupRun"("triggeredById", "startedAt");
ALTER TABLE "SystemBackupRun" ADD CONSTRAINT "SystemBackupRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "IntegrationCredential" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "adapterType" VARCHAR(80) NOT NULL,
  "endpointUrl" VARCHAR(1000),
  "description" VARCHAR(1000),
  "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
  "secretCiphertext" TEXT,
  "secretIv" VARCHAR(32),
  "secretAuthTag" VARCHAR(32),
  "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "lastRotatedAt" TIMESTAMPTZ(3),
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntegrationCredential_code_key" ON "IntegrationCredential"("code");
CREATE INDEX "IntegrationCredential_status_updatedAt_idx" ON "IntegrationCredential"("status", "updatedAt");
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SystemBackupRun" ADD CONSTRAINT "SystemBackupRun_sourceBackupId_fkey" FOREIGN KEY ("sourceBackupId") REFERENCES "SystemBackupRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
