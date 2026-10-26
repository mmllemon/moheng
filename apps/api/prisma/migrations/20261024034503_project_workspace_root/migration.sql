-- DropIndex
DROP INDEX "User_dataScope_role_isActive_idx";

-- AlterTable
ALTER TABLE "BusinessParty" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "workspaceRoot" TEXT;

-- RenameIndex
ALTER INDEX "ContractBaselineMigrationReconciliation_migrationKey_projectId_" RENAME TO "ContractBaselineMigrationReconciliation_migrationKey_projec_key";

-- RenameIndex
ALTER INDEX "DownstreamContractAdjustment_downstreamContractId_effectiveAt_i" RENAME TO "DownstreamContractAdjustment_downstreamContractId_effective_idx";

-- RenameIndex
ALTER INDEX "DownstreamContractSettlement_downstreamContractId_settlementNo_" RENAME TO "DownstreamContractSettlement_downstreamContractId_settlemen_key";

-- RenameIndex
ALTER INDEX "DownstreamContractSettlement_downstreamContractId_status_create" RENAME TO "DownstreamContractSettlement_downstreamContractId_status_cr_idx";

-- RenameIndex
ALTER INDEX "DownstreamContractSettlement_downstreamContractId_type_postedAt" RENAME TO "DownstreamContractSettlement_downstreamContractId_type_post_idx";

-- RenameIndex
ALTER INDEX "DownstreamRetentionMovement_downstreamContractId_effectiveAt_id" RENAME TO "DownstreamRetentionMovement_downstreamContractId_effectiveA_idx";

-- RenameIndex
ALTER INDEX "DownstreamSupplierInvoice_downstreamContractId_status_invoiceDa" RENAME TO "DownstreamSupplierInvoice_downstreamContractId_status_invoi_idx";
