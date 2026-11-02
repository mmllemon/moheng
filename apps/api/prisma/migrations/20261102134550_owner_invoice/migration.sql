-- CreateEnum
CREATE TYPE "OwnerInvoiceStatus" AS ENUM ('ISSUED', 'VOID');

-- CreateTable
CREATE TABLE "OwnerInvoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mainContractId" TEXT NOT NULL,
    "receivableId" TEXT,
    "invoiceNo" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
    "status" "OwnerInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerInvoice_projectId_status_invoiceDate_idx" ON "OwnerInvoice"("projectId", "status", "invoiceDate");

-- CreateIndex
CREATE INDEX "OwnerInvoice_receivableId_idx" ON "OwnerInvoice"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerInvoice_projectId_invoiceNo_key" ON "OwnerInvoice"("projectId", "invoiceNo");

-- AddForeignKey
ALTER TABLE "OwnerInvoice" ADD CONSTRAINT "OwnerInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerInvoice" ADD CONSTRAINT "OwnerInvoice_mainContractId_fkey" FOREIGN KEY ("mainContractId") REFERENCES "MainContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerInvoice" ADD CONSTRAINT "OwnerInvoice_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "OwnerReceivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerInvoice" ADD CONSTRAINT "OwnerInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
