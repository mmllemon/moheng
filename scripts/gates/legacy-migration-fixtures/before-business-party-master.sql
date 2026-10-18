BEGIN;

INSERT INTO "DownstreamContract"
  ("id", "projectId", "contractNo", "name", "type", "counterpartyName", "originalAmount", "status", "createdById", "createdAt", "updatedAt")
VALUES
  ('upgrade-supplier-contract', 'upgrade-project-01', 'SC-UPGRADE-01', 'Legacy Material Supply Contract', 'MATERIAL_PURCHASE', 'Acme Power Equipment Ltd', 650000.00, 'ACTIVE', 'upgrade-creator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "CostEntry"
  ("id", "projectId", "type", "date", "amount", "description", "vendorName", "downstreamContractId", "createdById", "createdAt", "updatedAt")
VALUES
  ('upgrade-cost-linked', 'upgrade-project-01', 'MATERIAL', CURRENT_TIMESTAMP, 12000.00, 'Linked cost: signed counterparty is authoritative', 'Conflicting Legacy Free Text', 'upgrade-supplier-contract', 'upgrade-creator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('upgrade-cost-unlinked', 'upgrade-project-01', 'MATERIAL', CURRENT_TIMESTAMP, 3000.00, 'Unlinked cost with normalized legacy vendor spelling', ' acme   power equipment ltd ', NULL, 'upgrade-creator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

COMMIT;
