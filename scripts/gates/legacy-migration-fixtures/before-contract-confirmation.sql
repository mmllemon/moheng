BEGIN;

INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "isActive", "createdAt", "updatedAt")
VALUES
  ('upgrade-creator', 'Legacy Creator', 'upgrade-creator@moheng.invalid', 'ci-fixture-not-a-real-password-hash', 'ADMIN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('upgrade-submitter', 'Legacy Submitter', 'upgrade-submitter@moheng.invalid', 'ci-fixture-not-a-real-password-hash', 'USER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- These rows deliberately use the original schema before external-confirmation columns exist.
INSERT INTO "Project"
  ("id", "name", "code", "type", "ownerName", "contractAmount", "startDate", "status", "createdAt", "updatedAt")
VALUES
  ('upgrade-project-01', 'Legacy Contract Reconciliation Project', 'UPGRADE-01', 'POWER', 'North River Power Co.', 12580000.00, '2025-01-01T00:00:00Z', 'CONSTRUCTION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('upgrade-project-02', 'Legacy Distinct Counterparty Project', 'UPGRADE-02', 'POWER', 'North River Power Construction Ltd.', 5000000.00, '2025-02-01T00:00:00Z', 'CONSTRUCTION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('upgrade-project-03', 'Legacy Normalized Name Project', 'UPGRADE-03', 'POWER', ' North   River Power Co. ', 8000000.00, '2025-03-01T00:00:00Z', 'CONSTRUCTION', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "MainContract" ("id", "projectId", "contractNo", "name", "amount", "updatedAt")
VALUES
  ('upgrade-main-contract-01', 'upgrade-project-01', 'MC-UPGRADE-01', 'Signed Main Contract 01', 12000000.00, CURRENT_TIMESTAMP),
  ('upgrade-main-contract-02', 'upgrade-project-02', 'MC-UPGRADE-02', 'Signed Main Contract 02', 5000000.00, CURRENT_TIMESTAMP),
  ('upgrade-main-contract-03', 'upgrade-project-03', 'MC-UPGRADE-03', 'Signed Main Contract 03', 8000000.00, CURRENT_TIMESTAMP);

INSERT INTO "Change"
  ("id", "projectId", "code", "name", "type", "occurredAt", "submittedAmount", "approvedAmount", "status", "createdAt", "updatedAt", "deletedAt")
VALUES
  ('upgrade-change-increase', 'upgrade-project-01', 'UPGRADE-CHANGE-INC', 'Externally confirmed increase', 'ENGINEERING_CHANGE', CURRENT_TIMESTAMP, 500000.00, 500000.00, 'CONFIRMED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
  ('upgrade-change-decrease', 'upgrade-project-01', 'UPGRADE-CHANGE-DEC', 'Externally confirmed decrease', 'ENGINEERING_CHANGE', CURRENT_TIMESTAMP, 100000.00, 100000.00, 'CONFIRMED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
  ('upgrade-change-pending', 'upgrade-project-01', 'UPGRADE-CHANGE-PENDING', 'Not yet externally effective', 'ENGINEERING_CHANGE', CURRENT_TIMESTAMP, 250000.00, NULL, 'SUBMITTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
  ('upgrade-change-deleted', 'upgrade-project-01', 'UPGRADE-CHANGE-DELETED', 'Soft-deleted historical change', 'ENGINEERING_CHANGE', CURRENT_TIMESTAMP, 999000.00, 999000.00, 'CONFIRMED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "AuditLog" ("id", "projectId", "userId", "entity", "entityId", "action", "changes", "createdAt")
VALUES
  ('upgrade-audit-change-create', 'upgrade-project-01', 'upgrade-creator', 'Change', 'upgrade-change-increase', 'CREATE', '{"to":"DRAFT"}'::jsonb, CURRENT_TIMESTAMP),
  ('upgrade-audit-change-submit', 'upgrade-project-01', 'upgrade-submitter', 'Change', 'upgrade-change-increase', 'STATUS_CHANGE', '{"from":"DRAFT","to":"SUBMITTED"}'::jsonb, CURRENT_TIMESTAMP);

COMMIT;
