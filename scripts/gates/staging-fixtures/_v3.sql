-- Read-only: auditable contract baseline reconciliation entries.
SET search_path TO moheng_staging_test;

SELECT
  p.code,
  r."migrationKey",
  r."previousOriginalAmount",
  r."mainContractAmount",
  r."reconciledOriginalAmount",
  r."previousEffectiveAmount",
  r."reconciledEffectiveAmount",
  r.reason,
  r."createdAt"
FROM "ContractBaselineMigrationReconciliation" r
JOIN "Project" p ON p.id = r."projectId"
WHERE p.code IN ('STG-01', 'STG-02', 'STG-03')
ORDER BY p.code, r.id;
