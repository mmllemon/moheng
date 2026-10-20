# 墨衡全仓核心经营链路审计记录（2026-10-20）

## 结论与阶段边界

本记录针对墨衡**开发阶段**的核心经营链路源码、业务数学函数、回归测试和 CI 结果进行审计。两项已确认的缺陷修复已合入 `main`。本次文档校准时的业务代码基线为 `551d154de6a43344637bbcf745152e08d07be620`，其 [Assistant runtime workflow](https://github.com/mmllemon/moheng/actions/runs/39357880407) 已成功：

- PR #17「项目范围 AI 用量摘要」：合并提交 `707aa1a449b2a644731c97ded300c3a4c05d0167`。
- PR #18「核心经营链路审计缺陷修复」：合并提交 `da423be973eb86cce298b21d2c4b6633a361356f`。

这两条 PR 最新头提交上的 Assistant runtime gates 和 Prisma 7 migration gates 均成功，具体包括 `pi-durable-poc`、`assistant-runtime`、`prisma7-migration`、`legacy-data-migration-upgrade` 四个 job。该证据说明这些 CI 工作流通过，不代表所有业务场景都已经完成真实数据库和浏览器端到端验收。

**当前项目处于开发阶段。** 本轮不存在可供核对的生产历史业务数据，也不能把尚未开展的正式业务/审计签认视为代码合入的前置条件。历史数据对账、生产 Windows 权限审查、数据库与附件联合恢复演练及正式业务签认属于有相应数据、部署环境和参与方之后的预投产/投产验收事项，不列为当前开发阶段缺陷闭环的阻塞门槛。

## 审查范围

| 链路 | 已核对的主要实现 | 本轮核对点 |
|---|---|---|
| 主合同基线与有效合同额 | `apps/api/src/routes/contracts.ts`、`apps/api/src/lib/contract-amount.ts`、`apps/api/src/lib/contract-amount-math.ts` | 原合同基线；有效外部确认变更参与重算；项目行锁；以分为单位的内部金额数学 |
| 变更签证 | `apps/api/src/routes/changes.ts`、`apps/api/src/lib/workflow-definitions.ts`、`apps/api/src/lib/governance-rules.ts` | 内部审批与外部确认分离；提交人/创建人自审批阻断；确认凭证、重复检测及金额差异复核留痕 |
| 业主进度款、结算、应收、收款/退款 | `apps/api/src/routes/progress-bills.ts`、`apps/api/src/routes/owner-finance.ts`、`apps/api/src/lib/owner-settlement-math.ts` | 状态流转；Serializable 事务中的余额重算；最终结算按累计差额过账；退款关联原收款并反向核销 |
| 分供合同、结算、应付、付款/退款、发票、质保金 | `apps/api/src/routes/downstream-contracts.ts`、`apps/api/src/routes/downstream-finance.ts`、`apps/api/src/lib/downstream-settlement-math.ts`、`apps/api/src/lib/downstream-payment-math.ts` | 合同行锁及事务；已确认结算生成应付；最终结算差额；付款/退款核销；发票和质保金约束 |
| 实际成本 | `apps/api/src/routes/costs.ts`、`apps/api/src/lib/downstream-contract-math.ts` | 成本与付款/应付/发票保持独立；合同同项目及往来单位一致性校验；算术差额不冒充完工预测 |
| 项目访问与审计 | `apps/api/src/lib/project-access.ts`、`apps/api/src/lib/access-policy.ts`、`apps/api/src/lib/project-data-scope.ts`、`scripts/check-audit-coverage.mjs` | 服务端项目成员/角色/策略检查；跨项目只读与业务写权限分离；核心写操作审计覆盖的静态契约 |

静态核对和 CI 通过可以证明相应代码及自动化门禁已运行，不等于已用真实 PostgreSQL 完成所有事务分支，也不等于浏览器 UI 已完成端到端验收。

## 已修复缺陷

### AUD-CORE-001 — 业主最终结算负差额无法过账

- 严重度：P1（阻断合法财务业务）。
- 例：此前已过账累计 5,000,000.00，外部确认最终累计结算为 4,700,000.00，本次应过账 -300,000.00，普通扣款为 0。
- 根因：先允许负向差额，随后却无条件检查 `deductions > delta`；当 `delta < 0` 且扣款为零时，仍会错误触发超额。
- 修复：使用 `ownerSettlementDeductionError`。差额小于或等于零时普通扣款必须为零；正向差额才执行扣款上限校验。
- 自动化回归：覆盖负向最终结算、负/零差额拒绝普通扣款、正向差额扣款上限。
- 相关文件：`apps/api/src/lib/owner-settlement-math.ts`、`apps/api/src/lib/owner-settlement-math.test.ts`、`apps/api/src/routes/owner-finance.ts`。

### AUD-CORE-002 — 未核验往来单位仅凭名称被自动复用

- 严重度：P1（可能导致合同主体归属错误）。
- 复现：档案只有一条规范化名称匹配记录但 `identityVerified=false)，新合同仅提交名称、不提交已选档案 ID。
- 根因：`resolveBusinessParty` 曾在唯一名称匹配时直接复用记录，没有确认法律主体身份已核验。
- 修复：未核验档案不能经名称匹配自动复用；返回 `BUSINESS_PARTY_IDENTITY_UNVERIFIED`，主合同和分供合同 API 返回明确的 409 冲突。用户显式提交档案 ID 与自动名称匹配区分处理。
- 自动化回归：覆盖已核验唯一匹配、未核验唯一匹配被拒绝、显式档案 ID 的有意关联。
- 相关文件：`apps/api/src/lib/business-party.ts`、`apps/api/src/lib/business-party.test.ts`、`apps/api/src/routes/contracts.ts`、`apps/api/src/routes/downstream-contracts.ts`。

修复 PR：[#18](https://github.com/mmllemon/moheng/pull/18)，已合入 `main`。

## 开发阶段仍需补齐的验收

1. **业主最终结算路由级 PostgreSQL 集成测试：未在本轮直接执行。** 使用隔离测试数据库验证负向最终结算能生成正确的负向应收/过账记录，审计与 posting 原子提交，并重新读取核对合同净应收余额。Helper 层回归测试和 CI 通过不能替代该路由级验证。
2. **往来单位身份冲突的 UI 验收：未在本轮直接执行。** 在浏览器中验证未核验同名主体出现可理解提示，完成核验或明确选择档案后能够继续，并确保合同关联到预期主体 ID。
3. **金额端到端精度边界：需要确定产品约束或另立兼容性任务。** 内部数学使用 BigInt 分，但部分 HTTP DTO 序列化仍使用 JavaScript `Number`。应先定义单项目最大金额及允许精度，再通过边界测试确认逐分往返；如需覆盖更大的 DECIMAL 存储范围，应评估把 API 金额输入/输出改为十进制字符串或整数分。

以上是当前开发阶段的有效待办，不应描述成“历史数据/人员签认未完成所以不能合并”。

## 预投产/投产阶段门禁（当前非阻塞）

以下事项应在对应条件具备时安排，而不是要求当前开发仓库凭空完成：

- **历史数据迁移/对账**：只有在有真实历史数据、迁移计划或脱敏样本后，才核对原合同基线、有效外部变更、业主结算/应收及收退款、分供结算/应付及付款/退款、发票分配、实际成本和往来单位关联，并对差异给出原因说明。
- **部署安全与恢复**：在目标 Windows 部署环境检查最小权限账号 ACL、秘密/附件/日志/备份目录权限；具备对应环境后演练 PostgreSQL 与附件/凭证联合恢复及登录、项目权限、合同、成本、报表 smoke tests。
- **业务/财务/审计签认**：在可操作的代表性业务环境和验收材料准备好后，由相应责任方按项目实际流程执行，不作为本次代码 PR 合并条件。

## 当前状态

- PR #17 合并：是；合并提交 `707aa1a449b2a644731c97ded300c3a4c05d0167`。
- PR #18 合并：是；合并提交 `da423be973eb86cce298b21d2c4b6633a361356f`。
- 两条 PR 最新代码头的 Assistant runtime gates 与 Prisma 7 migration gates：全部成功。
- 全仓核心经营链路审计：完成静态审查和两项已确认缺陷的代码修复；路由级 PostgreSQL 集成、浏览器交互验收和金额精度边界仍需继续推进。
