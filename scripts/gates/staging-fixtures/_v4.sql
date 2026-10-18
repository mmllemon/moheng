-- Read-only: legacy creator/submitter backfill coverage plus all actor fields for review.
SET search_path TO moheng_staging_test;

SELECT
  c.code,
  c.name,
  c.status,
  c."createdById",
  c."submittedById",
  c."internalApprovedById",
  c."externalRecordedById",
  COUNT(a.id) AS audit_event_count,
  COUNT(a.id) FILTER (WHERE a.action = 'CREATE') AS migration_recognized_create_events,
  COUNT(a.id) FILTER (
    WHERE a.action = 'STATUS_CHANGE' AND a.changes->>'to' = 'SUBMITTED'
  ) AS migration_recognized_submit_events,
  (c."createdById" IS NULL OR c."submittedById" IS NULL) AS creator_or_submitter_unresolved
FROM "Change" c
LEFT JOIN "AuditLog" a
  ON a.entity = 'Change'
 AND a."entityId" = c.id
WHERE c.code LIKE 'STG%'
GROUP BY c.id, c.code, c.name, c.status, c."createdById", c."submittedById",
         c."internalApprovedById", c."externalRecordedById"
ORDER BY c.code;
