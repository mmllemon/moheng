SET search_path TO moheng_staging_test;
-- 5. 往来单位（携带统一社会信用代码与法定代表人）
-- ============================================================
-- PA-01 与 PA-02：名称相近，信用代码不同，绝不能合并
INSERT INTO "BusinessParty" (id, name, "normalizedName", "creditCode", "legalRepresentative", roles, status, "identityVerified", address, "createdAt", "updatedAt")
VALUES
  ('stg-party-01', '华东建设集团股份有限公司', '华东建设集团股份有限公司', '91310100MA1K234X56', '陈华东', '{OWNER,OTHER}', 'ACTIVE', true, '上海市浦东新区世纪大道100号', NOW() - interval '500 days', NOW() - interval '30 days'),
  ('stg-party-02', '华东建设集团股份有限责任公司', '华东建设集团股份有限责任公司', '91310100MA1K999Y88', '陈华栋', '{MATERIAL_SUPPLIER}', 'ACTIVE', true, '上海市浦东新区世纪大道188号', NOW() - interval '400 days', NOW() - interval '30 days'),
-- PA-03 有曾用名，与 PA-04 名称相近
  ('stg-party-03', '西部数据科技有限公司', '西部数据科技有限公司', '91510100MA6L456Z12', '周西部', '{OWNER}', 'ACTIVE', true, '成都市高新区天府大道200号', NOW() - interval '450 days', NOW() - interval '20 days'),
  ('stg-party-04', '西部数据服务有限公司', '西部数据服务有限公司', '91510100MA6L777Q34', '周西东', '{SERVICE_PROVIDER}', 'ACTIVE', true, '成都市高新区天府大道266号', NOW() - interval '300 days', NOW() - interval '20 days'),
-- PA-05 完整工商名，项目 ownerName 用简称「市政工程管理处」引用它
  ('stg-party-05', '市政工程建设管理处', '市政工程建设管理处', '11500000MB0U5678W9', '李市政', '{OWNER}', 'ACTIVE', true, '重庆市渝中区人民路123号', NOW() - interval '200 days', NOW() - interval '10 days');

-- 补充曾用名
UPDATE "BusinessParty" SET "formerNames" = '{西部数据科技有限责任公司}' WHERE id = 'stg-party-03';

-- ============================================================
-- 6. 审计事件（在 actor backfill 之前就该存在）
-- ============================================================
INSERT INTO "AuditLog" (id, "projectId", "userId", entity, "entityId", action, changes, "createdAt")
VALUES
  ('stg-aud-01', 'stg-proj-01', 'stg-user-002', 'Change', 'stg-chg-01', 'CHANGE_CREATED', '{"code":"STG01-BG-0001"}', NOW() - interval '400 days'),
  ('stg-aud-02', 'stg-proj-01', 'stg-admin-001', 'Change', 'stg-chg-01', 'CHANGE_INTERNAL_APPROVED', '{"approvedAmount":1500000.00}', NOW() - interval '395 days'),
  ('stg-aud-03', 'stg-proj-01', 'stg-user-002', 'Change', 'stg-chg-01', 'CHANGE_EXTERNAL_CONFIRMED', '{"externalConfirmedAmount":1200000.00}', NOW() - interval '390 days'),
  ('stg-aud-04', 'stg-proj-02', 'stg-admin-001', 'Change', 'stg-chg-04', 'CHANGE_EXTERNAL_CONFIRMED', '{"externalConfirmedAmount":500000.00}', NOW() - interval '320 days');

-- ============================================================
-- 7. 成本记录（少量，用于验证不串项目）
-- ============================================================
INSERT INTO "CostEntry" (id, "projectId", type, description, amount, date, "createdById", "createdAt", "updatedAt")
VALUES
  ('stg-cost-01', 'stg-proj-01', 'MATERIAL', '电缆及母线槽', 3800000.00, DATE '2024-09-10', 'stg-user-003', NOW() - interval '390 days', NOW() - interval '390 days'),
  ('stg-cost-02', 'stg-proj-01', 'LABOR', '安装人工费', 2100000.00, DATE '2024-10-05', 'stg-user-003', NOW() - interval '380 days', NOW() - interval '380 days'),
  ('stg-cost-03', 'stg-proj-02', 'MATERIAL', '机电设备', 5200000.00, DATE '2024-11-20', 'stg-user-003', NOW() - interval '320 days', NOW() - interval '320 days'),
  ('stg-cost-04', 'stg-proj-03', 'MATERIAL', '管材', 800000.00, DATE '2025-02-14', 'stg-user-003', NOW() - interval '180 days', NOW() - interval '180 days');
