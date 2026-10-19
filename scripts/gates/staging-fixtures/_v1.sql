-- Read-only: effective contract values in the isolated staging test schema.
SET search_path TO moheng_staging_test;

SELECT
  p.code,
  p.name AS project_name,
  p."originalContractAmount" AS original_contract_amount,
  mc.amount AS signed_main_contract_amount,
  p."contractAmount" AS effective_contract_amount,
  COALESCE(SUM(
    CASE c.direction
      WHEN 'INCREASE' THEN c."externalConfirmedAmount"
      WHEN 'DECREASE' THEN -c."externalConfirmedAmount"
      ELSE 0
    END
  ) FILTER (
    WHERE c.id IS NOT NULL
      AND c."deletedAt" IS NULL
      AND c."externalConfirmationStatus" = 'EFFECTIVE'
      AND c."externalConfirmedAmount" IS NOT NULL
  ), 0) AS effective_external_change_delta,
  COALESCE(mc.amount, p."originalContractAmount", p."contractAmount")
    + COALESCE(SUM(
      CASE c.direction
        WHEN 'INCREASE' THEN c."externalConfirmedAmount"
        WHEN 'DECREASE' THEN -c."externalConfirmedAmount"
        ELSE 0
      END
    ) FILTER (
      WHERE c.id IS NOT NULL
        AND c."deletedAt" IS NULL
        AND c."externalConfirmationStatus" = 'EFFECTIVE'
        AND c."externalConfirmedAmount" IS NOT NULL
    ), 0) AS recomputed_effective_contract_amount
FROM "Project" p
LEFT JOIN "MainContract" mc ON mc."projectId" = p.id
LEFT JOIN "Change" c ON c."projectId" = p.id
WHERE p.code IN ('STG-01', 'STG-02', 'STG-03')
GROUP BY p.id, p.code, p.name, p."originalContractAmount", mc.amount, p."contractAmount"
ORDER BY p.code;
