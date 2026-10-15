CREATE TYPE "ReportTemplateScope" AS ENUM ('SYSTEM', 'PROJECT', 'PERSONAL');
CREATE TYPE "ReportTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "ReportTemplate" (
  "id" TEXT NOT NULL,
  "reportKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "scope" "ReportTemplateScope" NOT NULL DEFAULT 'PERSONAL',
  "status" "ReportTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "projectId" TEXT,
  "ownerUserId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "publishedVersion" INTEGER,
  "definition" JSONB NOT NULL,
  "publishedDefinition" JSONB,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReportTemplateRevision" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportTemplateRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportTemplate_reportKey_scope_status_updatedAt_idx" ON "ReportTemplate"("reportKey", "scope", "status", "updatedAt");
CREATE INDEX "ReportTemplate_ownerUserId_reportKey_status_idx" ON "ReportTemplate"("ownerUserId", "reportKey", "status");
CREATE INDEX "ReportTemplate_projectId_reportKey_status_idx" ON "ReportTemplate"("projectId", "reportKey", "status");
CREATE INDEX "ReportTemplateRevision_templateId_createdAt_idx" ON "ReportTemplateRevision"("templateId", "createdAt");
CREATE INDEX "ReportTemplateRevision_createdById_createdAt_idx" ON "ReportTemplateRevision"("createdById", "createdAt");

ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportTemplateRevision" ADD CONSTRAINT "ReportTemplateRevision_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportTemplateRevision" ADD CONSTRAINT "ReportTemplateRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
