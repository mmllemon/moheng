-- Centralized basic dictionaries and versioned, explicitly-published system parameters.
CREATE TYPE "SystemParameterScope" AS ENUM ('GLOBAL', 'PROJECT');
CREATE TYPE "SystemParameterValueType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');
CREATE TYPE "SystemParameterVisibility" AS ENUM ('ADMIN_ONLY', 'BUSINESS_READABLE');
CREATE TYPE "SystemParameterStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

CREATE TABLE "SystemDictionary" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(1000),
  "isSystem" BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SystemDictionary_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SystemDictionary_code_key" ON "SystemDictionary"("code");
CREATE INDEX "SystemDictionary_isActive_code_idx" ON "SystemDictionary"("isActive", "code");

CREATE TABLE "SystemDictionaryItem" (
  "id" TEXT NOT NULL,
  "dictionaryId" TEXT NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(1000),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isSystem" BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SystemDictionaryItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SystemDictionaryItem_dictionaryId_code_key" ON "SystemDictionaryItem"("dictionaryId", "code");
CREATE INDEX "SystemDictionaryItem_dictionaryId_isActive_sortOrder_idx" ON "SystemDictionaryItem"("dictionaryId", "isActive", "sortOrder");
ALTER TABLE "SystemDictionaryItem" ADD CONSTRAINT "SystemDictionaryItem_dictionaryId_fkey" FOREIGN KEY ("dictionaryId") REFERENCES "SystemDictionary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SystemParameterRevision" (
  "id" TEXT NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(1000),
  "value" JSONB NOT NULL,
  "valueType" "SystemParameterValueType" NOT NULL,
  "visibility" "SystemParameterVisibility" NOT NULL DEFAULT 'ADMIN_ONLY',
  "scope" "SystemParameterScope" NOT NULL DEFAULT 'GLOBAL',
  "scopeKey" VARCHAR(120) NOT NULL,
  "projectId" TEXT,
  "version" INTEGER NOT NULL,
  "status" "SystemParameterStatus" NOT NULL DEFAULT 'DRAFT',
  "changeNote" VARCHAR(1000),
  "createdById" TEXT NOT NULL,
  "publishedById" TEXT,
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SystemParameterRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SystemParameterRevision_scope_consistency_check" CHECK (("scope" = 'GLOBAL' AND "scopeKey" = 'GLOBAL' AND "projectId" IS NULL) OR ("scope" = 'PROJECT' AND "projectId" IS NOT NULL AND "scopeKey" = 'PROJECT:' || "projectId"))
);
CREATE UNIQUE INDEX "SystemParameterRevision_key_scopeKey_version_key" ON "SystemParameterRevision"("key", "scopeKey", "version");
CREATE INDEX "SystemParameterRevision_key_scopeKey_status_version_idx" ON "SystemParameterRevision"("key", "scopeKey", "status", "version");
CREATE INDEX "SystemParameterRevision_projectId_createdAt_idx" ON "SystemParameterRevision"("projectId", "createdAt");
CREATE INDEX "SystemParameterRevision_createdById_createdAt_idx" ON "SystemParameterRevision"("createdById", "createdAt");
-- The published configuration must resolve to at most one row per key/scope.
CREATE UNIQUE INDEX "SystemParameterRevision_one_published_per_scope_key" ON "SystemParameterRevision"("key", "scopeKey") WHERE "status" = 'PUBLISHED';
ALTER TABLE "SystemParameterRevision" ADD CONSTRAINT "SystemParameterRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SystemParameterRevision" ADD CONSTRAINT "SystemParameterRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SystemParameterRevision" ADD CONSTRAINT "SystemParameterRevision_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Initial shared vocabularies. Codes are stable identifiers; labels/order/status remain administrator-managed.
INSERT INTO "SystemDictionary" ("id", "code", "name", "description", "isSystem", "isActive", "updatedAt") VALUES
('sysdict_payment_method', 'PAYMENT_METHOD', '付款方式', '用于非核心业务展示或扩展表单的付款方式选项。', TRUE, TRUE, CURRENT_TIMESTAMP),
('sysdict_measure_unit', 'MEASURE_UNIT', '计量单位', '可扩展的通用工程计量单位；现有财务字段的单位规则不因此自动改变。', TRUE, TRUE, CURRENT_TIMESTAMP),
('sysdict_document_category', 'DOCUMENT_CATEGORY', '资料分类', '项目资料和管理附件可复用的分类项。', TRUE, TRUE, CURRENT_TIMESTAMP),
('sysdict_warning_level', 'WARNING_LEVEL', '预警等级', '可供后续预警策略消费的显示等级，不直接改变现有预警算法。', TRUE, TRUE, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "SystemDictionaryItem" ("id", "dictionaryId", "code", "name", "description", "sortOrder", "isSystem", "isActive", "updatedAt") VALUES
('sysitem_payment_method_bank', 'sysdict_payment_method', 'BANK_TRANSFER', '银行转账', NULL, 10, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_payment_method_acceptance', 'sysdict_payment_method', 'ACCEPTANCE_BILL', '银行/商业承兑汇票', NULL, 20, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_payment_method_cash', 'sysdict_payment_method', 'CASH', '现金', NULL, 30, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_payment_method_other', 'sysdict_payment_method', 'OTHER', '其他', NULL, 90, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_unit_item', 'sysdict_measure_unit', 'ITEM', '项', NULL, 10, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_unit_set', 'sysdict_measure_unit', 'SET', '套', NULL, 20, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_unit_m', 'sysdict_measure_unit', 'M', '米', NULL, 30, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_unit_m2', 'sysdict_measure_unit', 'M2', '平方米', NULL, 40, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_unit_m3', 'sysdict_measure_unit', 'M3', '立方米', NULL, 50, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_unit_kg', 'sysdict_measure_unit', 'KG', '千克', NULL, 60, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_unit_ton', 'sysdict_measure_unit', 'TON', '吨', NULL, 70, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_document_commercial', 'sysdict_document_category', 'COMMERCIAL', '商务合同', NULL, 10, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_document_technical', 'sysdict_document_category', 'TECHNICAL', '技术资料', NULL, 20, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_document_quality', 'sysdict_document_category', 'QUALITY', '质量资料', NULL, 30, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_document_safety', 'sysdict_document_category', 'SAFETY', '安全资料', NULL, 40, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_document_progress', 'sysdict_document_category', 'PROGRESS', '进度资料', NULL, 50, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_document_other', 'sysdict_document_category', 'OTHER', '其他资料', NULL, 90, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_warning_info', 'sysdict_warning_level', 'INFO', '提示', NULL, 10, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_warning_warning', 'sysdict_warning_level', 'WARNING', '警告', NULL, 20, TRUE, TRUE, CURRENT_TIMESTAMP),
('sysitem_warning_critical', 'sysdict_warning_level', 'CRITICAL', '严重', NULL, 30, TRUE, TRUE, CURRENT_TIMESTAMP)
ON CONFLICT ("dictionaryId", "code") DO NOTHING;
