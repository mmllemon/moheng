-- Read-only: same-normalized-name identities and unverified legacy party records.
SET search_path TO moheng_staging_test;

SELECT
  bp."normalizedName",
  COUNT(*) AS record_count,
  STRING_AGG(bp.id || ' [' || bp.name || ']', '; ' ORDER BY bp.id) AS party_records,
  STRING_AGG(COALESCE(bp."creditCode", '<no-credit-code>'), '; ' ORDER BY bp.id) AS credit_codes,
  BOOL_OR(bp."identityVerified") AS has_verified_record,
  BOOL_OR(NOT bp."identityVerified") AS has_unverified_record
FROM "BusinessParty" bp
GROUP BY bp."normalizedName"
HAVING COUNT(*) > 1
ORDER BY bp."normalizedName";

SELECT
  bp.id,
  bp.name,
  bp."normalizedName",
  bp."creditCode",
  bp."identityVerified",
  bp."identityVerificationNote",
  p.code AS linked_project_code
FROM "BusinessParty" bp
LEFT JOIN "Project" p ON p."ownerPartyId" = bp.id
WHERE bp."identityVerified" = false
  AND bp."creditCode" IS NULL
ORDER BY bp."normalizedName", bp.id, p.code;
