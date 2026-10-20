# 墨衡全仓核心经营链路审计记录（2026-10-20）

## 结论边界

本记录是对当前 `main` 核心经营链路源码、业务数学函数及相关测试的静态审查结果，并跟踪本轮已识别缺陷。两项修复已提交到独立分支 `fix/core-operating-chain-audit`，通过 PR #18 提议合入。**当前没有足够证据宣告全链路验收完成**：截至本记录编写时，PR 最新头提交没有从已连接的 GitHub Checks/Workflow 查询得到可验证的运行结果；本轮没有可用的本地仓库与 PostgreSQL/Windows 实机，故没有声称执行了构建、全量测试或真实环境验收。

## 审查范围

| 链路 | 已核对的主要实现 | 本轮核对点 |
|---|---|---|
| 主合同基线与有效合同额 | `apps/api/src/routes/contracts.ts`、`apps/api/src/lib/contract-amount.ts`、`apps/api/src/lib/contract-amount-math.ts` | 原合同基线锁定；仅将未删除、外部确认状态为 `EFFECTIVE` 且有外部确认金额的变更纳入重算；项目行锁防并发丢更新；金额以分为单位计算 |
| 变更签证 | `apps/api/src/routes/changes.ts`、`apps/api/src/lib/workflow-definitions.ts`、`apps/api/src/lib/governance-rules.ts` | 内部审批与外部确认分离；提交人/创建人自审批阻断；内部流程与权限策略服务端复核；外部确认凭证/重复检测/金额差异复核留痕 |
| 业主进度款、结算、应收、收款/退款 | `apps/api/src/routes/progress-bills.ts`、`apps/api/src/routes/owner-finance.ts`、`apps/api/src/lib/owner-settlement-math.ts` | 进度款状态不允许从审批完成状态回退；收款在 Serializable 事务内重新计算余额；最终结算按最终累计额减此前已过账累计额；退款关联原到账并追加反向核销 |
| 分供合同、结算、应付、付款/退款、发票、质保金 | `apps/api/src/routes/downstream-contracts.ts`、`apps/api/src/routes/downstream-finance.ts`、`apps/api/src/lib/downstream-settlement-math.ts`、`apps/api/src/lib/downstream-payment-math.ts` | 合同行锁和 Serializable 事务；只在已确认结算过账时创建应付；最终结算只过账差额；付款核销应付、退款反向恢复核销；发票需先核验且受应付正向金额约束 |
| 实际成本 | `apps/api/src/routes/costs.ts`、`apps/api/src/lib/downstream-contract-math.ts` | 成本与付款/应付/发票保持独立；合同关联同项目校验及往来单位一致性；合同摘要将“合同额减已关联实际成本”明确限定为算术差额而非完工预测 |
| 项目访问与审计 | `apps/api/src/lib/project-access.ts`、`apps/api/src/lib/access-policy.ts`、`apps/api/src/lib/project-data-scope.ts`、`scripts/check-audit-coverage.mjs` | 服务端项目成员/角色/发布策略检查；跨项目只读不能扩大为业务写权限；核心写操作审计覆盖存在静态契约 |

以上核对证明了相关实现路径存在，不等于已经用真实代表性数据覆盖了所有状态组合。

## 本轮已识别并修复的缺陷（PR #18）

### AUD-CORE-001 — 业主最终结算负差额无法过账

- 严重度：P1（阻断一类合法财务业务）。
- 复现条件：此前已过账的结算累计为 5,000,000.00，外部确认的最终累计结算为 4,700,000.00；本次正确过账增量应为 -300,000.00，且预付款扣回、质保金、其他扣款均为 0。
- 根因：路由先允许负向差额，但随后无条件检查 `deductions > delta`。当 `delta < 0` 且 `deductions = 0` 时，`0 > -300000` 恒为真，误报扣款超额，合法负向差额无法入账。
- 修复：将有符号差额的扣款校验抽为 `ownerSettlementDeductionError`。当差额小于或等于零时，只允许普通扣款为零；只有正向差额才执行扣款总额上限校验。
- 回归覆盖：负向最终结算、负/零差额不得重复扣款、正向扣款不得超过增量。
- 文件：`apps/api/src/lib/owner-settlement-math.ts`、`apps/api/src/lib/owner-settlement-math.test.ts`、`apps/api/src/routes/owner-finance.ts`。

### AUD-CORE-002 — 未核验往来单位仅凭名称被自动复用

- 严重度：P1（影响正式合同主体归属与跨模块成本/应付分析的可信度）。
- 复现条件：往来单位档案中仅有一条规范化名称匹配记录，但 `identityVerified=false`；新建主合同或分供合同时不传已选档案 ID，只提交同样的对方名称。
- 根因：`resolveBusinessParty` 在只有一个精确规范化名称匹配项时直接复用它，没有要求法律主体已核验。因此历史回填或临时创建的未核验档案可以被名称匹配自动关联。
- 修复：未核验档案不能通过名称路径自动复用；返回 `BUSINESS_PARTY_IDENTITY_UNVERIFIED`，主合同/分供合同 API 显式返回 409，提示先核验或明确选择档案。显式提交档案 ID 与自动名称匹配路径区分开。
- 回归覆盖：已核验唯一匹配可复用、未核验唯一匹配拒绝自动复用、显式档案 ID 允许有意关联。
- 文件：`apps/api/src/lib/business-party.ts`、`apps/api/src/lib/business-party.test.ts`、`apps/api/src/routes/contracts.ts`、`apps/api/src/routes/downstream-contracts.ts`。

PR: https://github.com/mmllemon/moheng/pull/18

## 必须继续闭环的验收项

1. **当前头提交自动化门禁：未核实。** PR #18 最新头 SHA 为 `34199e6e527d6f89b24bbf003c87cbfc66c0dc33`。当前已连接查询没有返回该 SHA 的 workflow runs/statuses；这不是 PASS，也不足以认定源码失败。需要在该精确 SHA 上取得 Assistant runtime gates、Prisma 7 migration gates、完整 API/前端测试与构建的明确结果。
2. **路由级 PostgreSQL 回归：未执行。** 单元测试校验了差额与身份匹配规则，但仍需真实隔离 PostgreSQL 验证完整业主最终结算过账生成负向应收、审计与 posting 原子提交、重新读取后主合同净应收余额正确。
3. **身份核验链路浏览器验收：未执行。** 需要在 UI 中验证未核验同名主体得到可理解的 409 提示、主体核验/明确选择流程可用，且成本和新合同最终关联到同一预期主体 ID。
4. **历史数据对账：未关闭。** 用经授权的脱敏代表性数据库快照逐项目对比原合同基线、有效外部变更、已过账业主结算/应收、分供结算/应付与付款/退款分配、实际成本和往来单位关联；差异要附原因码并由业务/审计负责人签认。
5. **Windows 与恢复：未关闭。** 在最小权限服务账号下检查 ACL 与秘密/附件/备份/日志目录；演练 PostgreSQL 与附件/凭证目录联合恢复，再执行登录、项目权限、合同/成本/报表 smoke test，并批准 RPO/RTO。
6. **精度边界：需要单独决策。** 内部金额数学使用 BigInt 分，但部分 HTTP DTO 序列化仍将金额转换为 JavaScript Number。当前业务输入尺度若接近大额精度边界，JSON/前端往返可能无法逐分精确。应明确项目允许最大金额；若要求覆盖当前 DECIMAL 存储上限，需另立兼容性任务将金额 API 输入/输出改为十进制字符串或整数分，不能只靠内部 BigInt 计算宣称全链路精确。

## 放行判断

- **代码修复已推送到 PR 分支：是。**
- **PR 合并：否。**
- **当前最新 SHA 自动化验证：未取得证据。**
- **全仓核心经营链路闭环：否，仍受上述自动化、数据库路由级测试、历史对账、Windows ACL/联合恢复和业务签认约束。**

后续变更仍须在本报告标明的同一条业务链路内补测试与证据；不得把静态源码检查、旧提交绿灯或合成测试替代真实环境准入。
