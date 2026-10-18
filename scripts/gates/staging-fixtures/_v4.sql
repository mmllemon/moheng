-- Read-only: unresolved or partially attributable change records and the audit evidence available.
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
  ) AS migration_recognized_submit_events
FROM "Change" c
LEFT JOIN "AuditLog" a
  ON a.entity = 'Change'
 AND a."entityId" = c.id
WHERE c.code LIKE 'STG%'
GROUP BY c.id, c.code, c.name, c.status, c."createdById", c."submittedById",
         c."internalApprovedById", c."externalRecordedById"
HAVING c."createdById" IS NULL
    OR c."submittedById" IS NULL
    OR c."internalApprovedById" IS NULL
    OR c."externalRecordedById" IS NULL
    OR COUNT(a.id) = 0
ORDER BY c.code;
