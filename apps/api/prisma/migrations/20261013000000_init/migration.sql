CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER');
CREATE TYPE "ProjectStatus" AS ENUM ('CONSTRUCTION', 'SETTLEMENT_PENDING', 'SETTLED', 'PAUSED');
CREATE TYPE "CostType" AS ENUM ('LABOR', 'MATERIAL', 'MACHINE', 'SUBCONTRACT', 'INDIRECT');
CREATE TYPE "ProgressBillStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'REJECTED');
CREATE TYPE "ChangeStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Project" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'HOUSING',
  "ownerName" TEXT NOT NULL,
  "contractAmount" DECIMAL(18,2) NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "plannedEndDate" TIMESTAMP(3),
  "status" "ProjectStatus" NOT NULL DEFAULT 'CONSTRUCTION',
  "address" TEXT,
  "managerName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");
CREATE INDEX "Project_status_deletedAt_idx" ON "Project"("status", "deletedAt");

CREATE TABLE "ProjectMember" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ProjectRole" NOT NULL DEFAULT 'ESTIMATOR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

CREATE TABLE "MainContract" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractNo" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3),
  "amount" DECIMAL(18,2) NOT NULL,
  "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
  "retentionRate" DECIMAL(7,5) NOT NULL DEFAULT 0.03,
  "advanceDeductionRate" DECIMAL(7,5) NOT NULL DEFAULT 0,
  "paymentTerms" TEXT,
  "guaranteeEndAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MainContract_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MainContract_projectId_key" ON "MainContract"("projectId");

CREATE TABLE "BudgetItem" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "parentId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT,
  "quantity" DECIMAL(18,3),
  "unitPrice" DECIMAL(18,4),
  "totalPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "level" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetItem_projectId_code_key" ON "BudgetItem"("projectId", "code");
CREATE INDEX "BudgetItem_projectId_parentId_sortOrder_idx" ON "BudgetItem"("projectId", "parentId", "sortOrder");

CREATE TABLE "CostEntry" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" "CostType" NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "taxAmount" DECIMAL(18,2),
  "budgetItemId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(18,3),
  "unit" TEXT,
  "unitPrice" DECIMAL(18,4),
  "invoiceNo" TEXT,
  "vendorName" TEXT,
  "teamName" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CostEntry_projectId_type_date_deletedAt_idx" ON "CostEntry"("projectId", "type", "date", "deletedAt");

CREATE TABLE "ProgressBill" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "periodNo" INTEGER NOT NULL,
  "applyDate" TIMESTAMP(3) NOT NULL,
  "measureDate" TIMESTAMP(3),
  "amount" DECIMAL(18,2) NOT NULL,
  "approvedAmount" DECIMAL(18,2),
  "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" "ProgressBillStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ProgressBill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProgressBill_projectId_periodNo_key" ON "ProgressBill"("projectId", "periodNo");
CREATE INDEX "ProgressBill_projectId_status_idx" ON "ProgressBill"("projectId", "status");

CREATE TABLE "ProgressPayment" (
  "id" TEXT NOT NULL,
  "progressBillId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "referenceNo" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Change" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'ENGINEERING_CHANGE',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "description" TEXT,
  "submittedAmount" DECIMAL(18,2) NOT NULL,
  "approvedAmount" DECIMAL(18,2),
  "status" "ChangeStatus" NOT NULL DEFAULT 'DRAFT',
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Change_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Change_projectId_code_key" ON "Change"("projectId", "code");
CREATE INDEX "Change_projectId_status_idx" ON "Change"("projectId", "status");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "projectId" TEXT,
  "userId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "changes" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MainContract" ADD CONSTRAINT "MainContract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_budgetItemId_fkey" FOREIGN KEY ("budgetItemId") REFERENCES "BudgetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgressBill" ADD CONSTRAINT "ProgressBill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgressPayment" ADD CONSTRAINT "ProgressPayment_progressBillId_fkey" FOREIGN KEY ("progressBillId") REFERENCES "ProgressBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Change" ADD CONSTRAINT "Change_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
