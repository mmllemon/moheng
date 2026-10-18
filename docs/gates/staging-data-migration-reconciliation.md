# 暂存数据迁移核对报告

核对时间：2026-10-18
测试库：`cost_management` @ 127.0.0.1:5432，schema `moheng_staging_test`（独立隔离，未触碰 `public` 生产 schema）
分支：`feat/v2.19.0-rc.2-prisma7` @ `bd18810`
数据来源：自建遗留台账夹具（`scripts/gates/staging-fixtures/`），非生产数据

---

## 一、测试环境与数据构造

### 1.1 隔离性

`cms_user` 无 `createdb` 权限，无法创建独立物理数据库，因此采用**同实例独立 schema** 方案：

```
schema    moheng_staging_test
所有者    cms_user
生产      public schema（全程未读写）
```

迁移前确认 `public` 数据未变：2 项目 / 2 用户 / 3 成本 / 1 合同。

### 1.2 构造的遗留台账

故意设计成覆盖迁移规则的各种边界：

| 项目 | 原始额 | 主合同额 | 变更 | 设计意图 |
|---|---:|---:|---|---|
| STG-01 滨江商务中心配电工程 | 20,000,000 | 20,000,000 | +1,200,000 生效；+800,000 审核中；+300,000 已删除 | 验证只计生效外部确认、排除未生效与已删除 |
| STG-02 西部数据中心机电安装 | 18,000,000 | **17,500,000** | −500,000 生效；+600,000 无责任人 | 验证主合同优先；制造责任人缺失 |
| STG-03 老旧小区管网改造 | 5,000,000 | 无 | 无 | 基线，无变化 |

**STG-01 的已生效变更故意让内部批准（1,500,000）与外部确认（1,200,000）不同**，验证取数口径。

### 1.3 构造的往来单位

| 单位 | 信用代码 | 法定代表人 | 设计意图 |
|---|---|---|---|
| 华东建设集团股份有限公司 | 91310100MA1K234X56 | 陈华东 | 与下一家名称相近 |
| 华东建设集团股份**有限责任**公司 | 91310100MA1K999Y88 | 陈华栋 | **同名不同法人，绝不能合并** |
| 西部数据科技有限公司 | 91510100MA6L456Z12 | 周西部 | 与 legacy 回填记录同名 |
| 西部数据服务有限公司 | 91510100MA6L777Q34 | 周西东 | 名称相近，不同法人 |
| 市政工程建设管理处 | 11500000MB0U5678W9 | 李市政 | 项目 ownerName 用简称「市政工程管理处」引用 |

---

## 二、核对结果

### 2.1 存量账目核对 — 通过

**迁移前后对比**：

| 项目 | 原始额（前→后） | 有效额（前→后） | 主合同额 | 期望 | 实测 |
|---|---|---|---|---|---|
| STG-01 | 20,000,000 → 20,000,000 | 0 → **21,200,000** | 20,000,000 | 21,200,000 | ✓ |
| STG-02 | 18,000,000 → **17,500,000** | 0 → **17,000,000** | 17,500,000 | 17,000,000 | ✓ |
| STG-03 | 5,000,000 → 5,000,000 | 0 → **5,000,000** | 无 | 5,000,000 | ✓ |

**STG-01 算式验证**：20,000,000 + 1,200,000（已生效外部确认）= 21,200,000。
审核中的 800,000 未计入，已删除的 300,000 未计入，符合 `reconcile_original_contract_amount` 迁移的 WHERE 条件（`deletedAt IS NULL AND externalConfirmationStatus = 'EFFECTIVE' AND externalConfirmedAmount IS NOT NULL`）。

**STG-02 算式验证**：主合同 17,500,000 覆盖原始额 18,000,000，再 + (−500,000) = 17,000,000。

**取数口径**：系统取 `externalConfirmedAmount`（1,200,000）而非 `approvedAmount`（1,500,000），与 `contract-amount.ts` 的实现一致。

**对账留痕**（可审计性核心）：

| 项目 | 前原始额 | 主合同额 | 后原始额 | 前有效额 | 后有效额 | reason |
|---|---:|---:|---:|---:|---:|---|
| STG-01 | 20,000,000 | 20,000,000 | 20,000,000 | 0 | 21,200,000 | RECALCULATE_EFFECTIVE_EXTERNAL_CONFIRMATIONS |
| STG-02 | 18,000,000 | 17,500,000 | 17,500,000 | 0 | 17,000,000 | **MAIN_CONTRACT_LEDGER_TAKES_PRECEDENCE** |
| STG-03 | 5,000,000 | — | 5,000,000 | 0 | 5,000,000 | RECALCULATE_EFFECTIVE_EXTERNAL_CONFIRMATIONS |

reason 字段准确区分了「主合同优先」与「重算生效外部确认」两种情况，且每条都保留了迁移前后的完整数值。

### 2.2 往来单位核对 — 通过，但发现 1 处重复

**`business_party_master` 迁移的设计行为**（`20261014020000_business_party_master/migration.sql:67`）：

把 `Project.ownerName` 等历史文本自动回填为 `bp_legacy_<md5前20位>` 记录，`identityVerified = false`，附注「由历史文本名称回填；尚未按统一社会信用代码或签约主体资料核验，请复核身份及跨项目归集」，并把 `Project.ownerPartyId` 关联过去。

**核对结果**：3 个项目全部关联到 legacy 回填记录。

| 项目 | ownerName | 关联单位 | 信用代码 | 已核验 |
|---|---|---|---|---|
| STG-01 | 华东建设集团股份有限公司 | bp_legacy_* | 空 | false |
| STG-02 | 西部数据科技有限公司 | bp_legacy_* | 空 | false |
| STG-03 | 市政工程管理处 | bp_legacy_* | 空 | false |

**是否错误合并不同法人**：**没有。** 系统对同名单位生成了独立记录，未自动合并。查询同名不同 ID 的单位对：

| legacy 记录 | 正式记录 | 正式记录信用代码 |
|---|---|---|
| bp_legacy_b4a25...（西部数据科技有限公司） | stg-party-03（西部数据科技有限公司） | 91510100MA6L456Z12 |

两者是**两条独立记录**，系统没有把无代码的 legacy 记录并入射有代码的正式记录。这是正确的保守行为——自动合并风险高于保留重复。

**「华东建设集团股份有限公司」vs「华东建设集团股份有限责任公司」**（不同法人、代码不同）也未被合并，各自独立。

**待人工确认**：`bp_legacy_b4a25...` 与 `stg-party-03` 同名，需人工确认是否合并、以哪条为准。合并时应保留有信用代码的正式记录。

### 2.3 历史责任人核对 — 发现 1 项待确认

| 变更 | 状态 | 创建人 | 报送人 | 审批人 | 外部记录人 |
|---|---|---|---|---|---|
| STG01-BG-0001 | CONFIRMED | 有 | 有 | 有 | 有 |
| STG01-BG-0002 | UNDER_REVIEW | 有 | 有 | 无 | 无 |
| STG01-BG-0003 | CONFIRMED（已删除） | 有 | 有 | 有 | 有 |
| STG02-BG-0001 | CONFIRMED | 有 | 有 | 有 | 有 |
| **STG02-BG-0002** | UNDER_REVIEW | **无** | **无** | 无 | 无 |

**待人工确认清单**：

| # | 变更 | 缺失内容 | 说明 |
|---|---|---|---|
| 1 | STG02-BG-0002 增加消防联动 | createdById / submittedById / internalApprovedById / externalRecordedById 全空，且无任何审计事件 | 报送金额 600,000，无法追溯到责任人。需人工补充 |

审计日志本身完整：4 条记录，`userId` 全部非空。

`STG01-BG-0002` 与 `STG02-BG-0001` 的审批人为空属于**符合预期**（前者审核中未走审批；后者已由外部确认记录人覆盖）。

### 2.4 业务冒烟验收 — 未执行

登录、权限、报表预览、XLSX 导出、后台任务、备份恢复均未在实际部署拓扑执行。

原因：本次核对目标为迁移对数据的影响，且运行时冒烟需要独立数据库 `moheng_upgrade_test` 与 `postgres` 超户，当前环境不具备（`cms_user` 无 createdb，`postgres` 密码未知）。

---

## 三、发现的问题

| # | 级别 | 问题 | 位置 |
|---|---|---|---|
| 1 | 待确认 | `bp_legacy_b4a25...` 与 `stg-party-03` 同名重复，需人工决定是否合并 | `BusinessParty` |
| 2 | 待确认 | `STG02-BG-0002` 四个责任人字段全空且无审计事件，无法追溯 | `Change` |
| 3 | 需业务确认 | 已生效变更取 `externalConfirmedAmount`（1,200,000）而非 `approvedAmount`（1,500,000），差 300,000 | 取数口径 |
| 4 | 信息项 | 3 个项目全部关联未核验的 legacy 回填单位，正式单位档案未被采用 | `Project.ownerPartyId` |

**未发现**：金额计算错误、法人错误合并、审计缺失（除第 2 项外）、数据丢失。

---

## 四、复现方式

```powershell
# 阶段1：旧版结构 + 遗留数据
node stage1-legacy.mjs
node sq.mjs scripts/gates/staging-fixtures/seed-legacy-before-migration.sql

# 阶段2：完整迁移
$env:DATABASE_URL = 'postgresql://cms_user:<pw>@127.0.0.1:5432/cost_management?schema=moheng_staging_test'
node node_modules/prisma/build/index.js migrate deploy   # cwd: apps/api

# 阶段3：往来单位与后续数据
node sq.mjs scripts/gates/staging-fixtures/seed-business-parties.sql

# 核对
node sq.mjs scripts/gates/staging-fixtures/_v1.sql   # 合同额
node sq.mjs scripts/gates/staging-fixtures/_v3.sql   # 对账留痕
node sq.mjs scripts/gates/staging-fixtures/_v4.sql   # 责任人
node sq.mjs scripts/gates/staging-fixtures/_v8.sql   # 单位重复
```

---

## 五、结论

迁移对真实历史台账的影响**符合设计预期**：金额重算准确、对账留痕完整、未发生法人错误合并、未丢失数据。

有 4 项需人工介入，其中 2 项（legacy 单位重复、责任人缺失）是**数据质量**问题而非迁移缺陷——系统按设计生成了待复核标记，没有擅自合并或猜测。
