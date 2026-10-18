-- 暂存数据迁移核对：遗留台账种子数据
-- 目标 schema: moheng_staging_test
-- 设计意图：覆盖迁移规则的各种边界，且携带可核验的法人标识
--
-- 项目设计（故意构造对账差异与合并风险）：
--   STG-01  主合同与项目额一致，有一条已生效变更 + 一条审核中 + 一条已删除
--   STG-02  主合同与项目额不一致（触发 MAIN_CONTRACT_LEDGER_TAKES_PRECEDENCE）
--   STG-03  无主合同、无变更（基线）
--
-- 往来单位设计（重点验证券人代码防误合并）：
--   PA-01 与 PA-02 名称相近但信用代码不同 → 不应合并
--   PA-03 有曾用名，与 PA-04 名称相近 → 应能区分
--   PA-05 完整工商名，被项目 ownerName 用简称引用 → 名称匹配

\set ON_ERROR_STOP on
SET search_path TO moheng_staging_test;

-- ============================================================
-- 1. 用户（责任人）
-- ============================================================
INSERT INTO "User" (id, email, name, role, "isActive", "passwordHash", "createdAt", "updatedAt")
VALUES
  ('stg-admin-001', 'stg-admin@local.test', '张管理', 'ADMIN', true, 'x', NOW() - interval '400 days', NOW() - interval '400 days'),
  ('stg-user-002',  'stg-engineer@local.test', '李工', 'USER', true, 'x', NOW() - interval '380 days', NOW() - interval '380 days'),
  ('stg-user-003',  'stg-cost@local.test', '王成本', 'USER', true, 'x', NOW() - interval '300 days', NOW() - interval '300 days');

-- ============================================================
-- 2. 项目
-- ============================================================
INSERT INTO "Project" (id, name, code, type, "ownerName", "contractAmount", "originalContractAmount", "startDate", status, "createdAt", "updatedAt")
VALUES
  ('stg-proj-01', '滨江商务中心配电工程', 'STG-01', 'HOUSING', '华东建设集团股份有限公司',
   0.00, 20000000.00, DATE '2024-03-01', 'CONSTRUCTION', NOW() - interval '500 days', NOW() - interval '30 days'),
  ('stg-proj-02', '西部数据中心机电安装', 'STG-02', 'HOUSING', '西部数据科技有限公司',
   0.00, 18000000.00, DATE '2024-06-15', 'CONSTRUCTION', NOW() - interval '450 days', NOW() - interval '20 days'),
  ('stg-proj-03', '老旧小区管网改造', 'STG-03', 'HOUSING', '市政工程管理处',
   0.00, 5000000.00, DATE '2025-01-10', 'CONSTRUCTION', NOW() - interval '200 days', NOW() - interval '10 days');

-- ============================================================
-- 3. 主合同
-- ============================================================
INSERT INTO "MainContract" (id, "projectId", "contractNo", name, "signedAt", amount, "taxIncluded", "createdAt", "updatedAt")
VALUES
  ('stg-mc-01', 'stg-proj-01', 'HD-2024-0311', '滨江商务中心配电工程施工合同', DATE '2024-03-01', 20000000.00, true, NOW() - interval '500 days', NOW() - interval '500 days'),
  -- STG-02 的主合同额与项目 originalContractAmount 不一致：故意制造对账差异
  ('stg-mc-02', 'stg-proj-02', 'XB-2024-0620', '西部数据中心机电安装合同', DATE '2024-06-15', 17500000.00, true, NOW() - interval '450 days', NOW() - interval '450 days');

-- ============================================================
-- 4. 变更
-- ============================================================
-- STG-01 变更一：已生效，外部确认 1,200,000（内部批准 1,500,000，故意不同）
INSERT INTO "Change" (id, "projectId", code, name, type, "occurredAt", description,
  "submittedAmount", "approvedAmount", "externalConfirmedAmount", status, "externalConfirmationStatus",
  direction, "createdById", "submittedById", "internalApprovedById", "externalRecordedById", "createdAt", "updatedAt")
VALUES
  ('stg-chg-01', 'stg-proj-01',  'STG01-BG-0001', '增加应急母线槽', 'SCOPE_CHANGE', DATE '2024-08-20', '业主要求增加应急母线槽',
   1500000.00, 1500000.00, 1200000.00, 'CONFIRMED', 'EFFECTIVE',
   'INCREASE', 'stg-user-002', 'stg-user-002', 'stg-admin-001', 'stg-user-002', NOW() - interval '400 days', NOW() - interval '390 days'),
-- STG-01 变更二：审核中，未生效，不计入
  ('stg-chg-02', 'stg-proj-01',  'STG01-BG-0002', '材料调差', 'PRICE_ADJUSTMENT', DATE '2025-02-11', '铜价波动调差',
   800000.00, NULL, NULL, 'UNDER_REVIEW', 'NOT_CONFIRMED',
   'INCREASE', 'stg-user-003', 'stg-user-003', NULL, NULL, NOW() - interval '100 days', NOW() - interval '100 days'),
-- STG-01 变更三：已删除，即使金额有效也不计入
  ('stg-chg-03', 'stg-proj-01',  'STG01-BG-0003', '误报变更', 'SCOPE_CHANGE', DATE '2024-05-05', '录入错误后作废',
   300000.00, 300000.00, 300000.00, 'CONFIRMED', 'EFFECTIVE',
   'INCREASE', 'stg-user-002', 'stg-user-002', 'stg-admin-001', 'stg-user-002', NOW() - interval '460 days', NOW() - interval '455 days');

UPDATE "Change" SET "deletedAt" = NOW() - interval '450 days' WHERE id = 'stg-chg-03';

-- STG-02 变更：已生效减项 500,000
INSERT INTO "Change" (id, "projectId", code, name, type, "occurredAt", description,
  "submittedAmount", "approvedAmount", "externalConfirmedAmount", status, "externalConfirmationStatus",
  direction, "createdById", "submittedById", "internalApprovedById", "externalRecordedById", "createdAt", "updatedAt")
VALUES
  ('stg-chg-04', 'stg-proj-02',  'STG02-BG-0001', '取消备用发电机', 'SCOPE_CHANGE', DATE '2024-11-15', '设计优化取消备用发电机',
   500000.00, 500000.00, 500000.00, 'CONFIRMED', 'EFFECTIVE',
   'DECREASE', 'stg-user-002', 'stg-user-002', 'stg-admin-001', 'stg-admin-001', NOW() - interval '330 days', NOW() - interval '320 days');

-- STG-02 变更二：审核中，责任人缺失（故意制造待人工确认项）
INSERT INTO "Change" (id, "projectId", code, name, type, "occurredAt", description,
  "submittedAmount", "approvedAmount", status, "externalConfirmationStatus",
  direction, "createdAt", "updatedAt")
VALUES
  ('stg-chg-05', 'stg-proj-02',  'STG02-BG-0002', '增加消防联动', 'SCOPE_CHANGE', DATE '2025-03-20', '消防规范更新',
   600000.00, NULL, 'UNDER_REVIEW',
   'NOT_CONFIRMED', 'INCREASE', NOW() - interval '60 days', NOW() - interval '60 days');

-- ============================================================
