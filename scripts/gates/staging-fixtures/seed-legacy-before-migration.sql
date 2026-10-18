-- Stage 1: true legacy schema after 20261013010000 and BEFORE the external-confirmation migration.
-- Only columns present in the initial schema are used. No BusinessParty or post-migration columns here.
\set ON_ERROR_STOP on
SET search_path TO moheng_staging_test;

INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "isActive", "createdAt", "updatedAt")
VALUES
  ('stg-admin-001', '张管理', 'stg-admin@local.test', 'x', 'ADMIN', true, NOW() - interval '400 days', NOW() - interval '400 days'),
  ('stg-user-002', '李工', 'stg-engineer@local.test', 'x', 'USER', true, NOW() - interval '380 days', NOW() - interval '380 days'),
  ('stg-user-003', '王成本', 'stg-cost@local.test', 'x', 'USER', true, NOW() - interval '300 days', NOW() - interval '300 days');

INSERT INTO "Project" ("id", "name", "code", "type", "ownerName", "contractAmount", "startDate", "status", "createdAt", "updatedAt")
VALUES
  ('stg-proj-01', '滨江商务中心配电工程', 'STG-01', 'HOUSING', '华东建设集团股份有限公司', 20000000.00, DATE '2024-03-01', 'CONSTRUCTION', NOW() - interval '500 days', NOW() - interval '30 days'),
  ('stg-proj-02', '西部数据中心机电安装', 'STG-02', 'HOUSING', '西部数据科技有限公司', 18000000.00, DATE '2024-06-15', 'CONSTRUCTION', NOW() - interval '450 days', NOW() - interval '20 days'),
  ('stg-proj-03', '老旧小区管网改造', 'STG-03', 'HOUSING', '市政工程管理处', 5000000.00, DATE '2025-01-10', 'CONSTRUCTION', NOW() - interval '200 days', NOW() - interval '10 days');

INSERT INTO "MainContract" ("id", "projectId", "contractNo", "name", "signedAt", "amount", "taxIncluded", "createdAt", "updatedAt")
VALUES
  ('stg-mc-01', 'stg-proj-01', 'HD-2024-0311', '滨江商务中心配电工程施工合同', DATE '2024-03-01', 20000000.00, true, NOW() - interval '500 days', NOW() - interval '500 days'),
  ('stg-mc-02', 'stg-proj-02', 'XB-2024-0620', '西部数据中心机电安装合同', DATE '2024-06-15', 17500000.00, true, NOW() - interval '450 days', NOW() - interval '450 days');

-- These rows intentionally do NOT supply any actor or external-confirmation columns;
-- 20261013020000 must add those columns and recover creator/submittedBy from AuditLog.
INSERT INTO "Change" ("id", "projectId", "code", "name", "type", "occurredAt", "description", "submittedAmount", "approvedAmount", "status", "createdAt", "updatedAt", "deletedAt")
VALUES
  ('stg-chg-01', 'stg-proj-01', 'STG01-BG-0001', '增加应急母线槽', 'SCOPE_CHANGE', DATE '2024-08-20', '业主要求增加应急母线槽；内部批准额与外部确认额故意不同', 1500000.00, 1500000.00, 'CONFIRMED', NOW() - interval '400 days', NOW() - interval '390 days', NULL),
  ('stg-chg-02', 'stg-proj-01', 'STG01-BG-0002', '材料调差', 'PRICE_ADJUSTMENT', DATE '2025-02-11', '审核中，不应计入有效合同额', 800000.00, NULL, 'UNDER_REVIEW', NOW() - interval '100 days', NOW() - interval '100 days', NULL),
  ('stg-chg-03', 'stg-proj-01', 'STG01-BG-0003', '误报变更', 'SCOPE_CHANGE', DATE '2024-05-05', '已软删除的历史变更', 300000.00, 300000.00, 'CONFIRMED', NOW() - interval '460 days', NOW() - interval '455 days', NOW() - interval '450 days'),
  ('stg-chg-04', 'stg-proj-02', 'STG02-BG-0001', '取消备用发电机', 'SCOPE_CHANGE', DATE '2024-11-15', '外部确认的减项', 500000.00, 500000.00, 'CONFIRMED', NOW() - interval '330 days', NOW() - interval '320 days', NULL),
  ('stg-chg-05', 'stg-proj-02', 'STG02-BG-0002', '增加消防联动', 'SCOPE_CHANGE', DATE '2025-03-20', '故意保留无责任人且无审计事件的记录', 600000.00, NULL, 'UNDER_REVIEW', NOW() - interval '60 days', NOW() - interval '60 days', NULL);

-- The historical migration only recognizes these exact action predicates for creator / submitter.
INSERT INTO "AuditLog" ("id", "projectId", "userId", "entity", "entityId", "action", "changes", "createdAt")
VALUES
  ('stg-aud-01', 'stg-proj-01', 'stg-user-002', 'Change', 'stg-chg-01', 'CREATE', '{"to":"DRAFT"}'::jsonb, NOW() - interval '400 days'),
  ('stg-aud-02', 'stg-proj-01', 'stg-user-003', 'Change', 'stg-chg-01', 'STATUS_CHANGE', '{"from":"DRAFT","to":"SUBMITTED"}'::jsonb, NOW() - interval '399 days'),
  ('stg-aud-03', 'stg-proj-01', 'stg-admin-001', 'Change', 'stg-chg-01', 'CHANGE_INTERNAL_APPROVED', '{"approvedAmount":1500000.00}'::jsonb, NOW() - interval '395 days'),
  ('stg-aud-04', 'stg-proj-01', 'stg-user-002', 'Change', 'stg-chg-01', 'CHANGE_EXTERNAL_CONFIRMED', '{"externalConfirmedAmount":1200000.00}'::jsonb, NOW() - interval '390 days'),
  ('stg-aud-05', 'stg-proj-01', 'stg-user-003', 'Change', 'stg-chg-02', 'CREATE', '{"to":"DRAFT"}'::jsonb, NOW() - interval '100 days'),
  ('stg-aud-06', 'stg-proj-01', 'stg-user-003', 'Change', 'stg-chg-02', 'STATUS_CHANGE', '{"from":"DRAFT","to":"SUBMITTED"}'::jsonb, NOW() - interval '99 days'),
  ('stg-aud-07', 'stg-proj-01', 'stg-user-002', 'Change', 'stg-chg-03', 'CREATE', '{"to":"DRAFT"}'::jsonb, NOW() - interval '460 days'),
  ('stg-aud-08', 'stg-proj-01', 'stg-user-003', 'Change', 'stg-chg-03', 'STATUS_CHANGE', '{"from":"DRAFT","to":"SUBMITTED"}'::jsonb, NOW() - interval '459 days'),
  ('stg-aud-09', 'stg-proj-02', 'stg-user-002', 'Change', 'stg-chg-04', 'CREATE', '{"to":"DRAFT"}'::jsonb, NOW() - interval '330 days'),
  ('stg-aud-10', 'stg-proj-02', 'stg-user-003', 'Change', 'stg-chg-04', 'STATUS_CHANGE', '{"from":"DRAFT","to":"SUBMITTED"}'::jsonb, NOW() - interval '329 days');

INSERT INTO "CostEntry" ("id", "projectId", "type", "date", "amount", "description", "vendorName", "createdById", "createdAt", "updatedAt")
VALUES
  ('stg-cost-01', 'stg-proj-01', 'MATERIAL', DATE '2024-09-10', 3800000.00, '合同关联成本；迁移前自由文本供应商名称故意冲突', '非正式文本供应商标签', 'stg-user-003', NOW() - interval '390 days', NOW() - interval '390 days'),
  ('stg-cost-02', 'stg-proj-01', 'LABOR', DATE '2024-10-05', 2100000.00, '未关联合同但名称规范化后应映射到单位档案', ' 华东建设集团股份有限公司 ', 'stg-user-003', NOW() - interval '380 days', NOW() - interval '380 days'),
  ('stg-cost-03', 'stg-proj-02', 'MATERIAL', DATE '2024-11-20', 5200000.00, '西部项目机电设备', '西部设备供应商', 'stg-user-003', NOW() - interval '320 days', NOW() - interval '320 days'),
  ('stg-cost-04', 'stg-proj-03', 'MATERIAL', DATE '2025-02-14', 800000.00, '市政项目管材', '市政管材供应商', 'stg-user-003', NOW() - interval '180 days', NOW() - interval '180 days');
