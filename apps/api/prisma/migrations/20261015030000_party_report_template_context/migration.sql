-- Enables unit-profile report templates to be bound to a specific business party.
ALTER TABLE "ReportTemplate" ADD COLUMN "businessPartyId" TEXT;
CREATE INDEX "ReportTemplate_businessPartyId_reportKey_status_idx" ON "ReportTemplate"("businessPartyId", "reportKey", "status");
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_businessPartyId_fkey" FOREIGN KEY ("businessPartyId") REFERENCES "BusinessParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
