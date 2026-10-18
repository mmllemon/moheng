-- Stage 3: run AFTER 20261014010000 and BEFORE 20261014020000_business_party_master.
\set ON_ERROR_STOP on
SET search_path TO moheng_staging_test;

INSERT INTO "DownstreamContract"
  ("id", "projectId", "contractNo", "name", "type", "counterpartyName", "originalAmount", "status", "createdById", "createdAt", "updatedAt")
VALUES
  ('stg-dc-01', 'stg-proj-01', 'STG-SC-01', '滨江项目材料供应合同', 'MATERIAL_PURCHASE', '华东建设集团股份有限公司', 650000.00, 'ACTIVE', 'stg-admin-001', NOW() - interval '400 days', NOW() - interval '30 days');

UPDATE "CostEntry"
SET "downstreamContractId" = 'stg-dc-01',
    "vendorName" = '与正式合同相冲突的旧自由文本'
WHERE id = 'stg-cost-01';
