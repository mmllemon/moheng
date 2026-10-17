# 墨衡 Pi Durable PoC 与存储对照 Gate 验收报告 v0.1

- 执行日期：2026-10-16
- 源码基线：`moheng-construction-cost-management@2.14.0-rc.1`（本会话上传的源码 ZIP）
- 本次状态：**PARTIAL — 本地最小契约与静态安全检查通过；Pi Durable 实际适配器与真实 PostgreSQL Gate 尚未执行，不得据此进入生产**
- 变更范围：仅在本工作副本添加 PoC、测试与文档；没有改动原上传 ZIP，也没有修改业务台账语义或执行真实合同/财务写入。

## 1. Gate 汇总

| Gate | 结果 | 证据 / 备注 |
|---|---|---|
| G0：核实源码基线、模块边界和实验隔离 | PARTIAL | 已基于本会话源码 ZIP `2.14.0-rc.1` 增量实现；原始 ZIP 未改。实验依赖已精确 pin，但没有 package lock，也未完成 clean install/build。 |
| G1：三只读业务工具及 API 防护 | PARTIAL | 工具服务、默认关闭的 PoC 路由、认证、限流、项目权限复核、审计、静态测试已添加。因 API 依赖和 PostgreSQL 不可用，TypeScript build 和实时数据库授权测试未跑。 |
| G1a：静态安全契约 | **PASS** | `node scripts/validate-assistant-poc.mjs`：21 项断言通过，工具白名单为 3 项。该结果是静态检查，不代表运行态安全认证。 |
| G1b：最小 SQLite submission/event 契约 | **PASS（仅限精简探针）** | Node `node:test`：2/2 通过。覆盖请求幂等、同 requestId 不同内容冲突、所有者隔离、合法/非法状态迁移、完成幂等、事件数、关闭重开恢复。 |
| G1c：SQLite 精简探针测量 | **PASS（仅限测量脚手架）** | 300 次迭代，单次实测 57.53 ms、约 5,214.9 次完整探针迭代/秒；Node v22.16.0。不能外推为 Pi Durable 性能，也不是 SQLite 与 PostgreSQL 的实测对照。 |
| G2：Pi Durable 官方 Node SQLite 适配器关闭/重开 | NOT RUN | 已实现脚本，但 Pi Durable 包未安装，因此没有实际执行结果。 |
| G3：Pi Durable 官方 Storage Conformance Suite | NOT RUN | 已添加 `registerStorageConformance` 测试，但依赖未安装、Node 版本不符合要求，未执行。 |
| G4：Pi Durable SQLite 强制结束进程恢复 | NOT RUN | 已实现 kill 子进程、重开存储并验证已提交文档的脚本；未安装实际 Pi 包，未执行。 |
| G5：真实 PostgreSQL 精简契约与并发幂等 | NOT RUN | 测试已加入并包含 8 个并发同请求重试；本环境没有 `psql`、`postgres`、Docker 或显式提供的独立测试库连接，未伪造 PG 数据。 |
| G6：LangGraph `PostgresSaver` 关闭/重开 checkpoint | NOT RUN | 已实现使用随机隔离 schema 的 smoke test；没有真实 PG 与依赖，未执行。 |
| G7：LangChain Agent + PostgresSaver 的同工具对照 | NOT RUN | 已实现 Agent CLI，继续调用同一墨衡只读工具并复查权限；没有模型密钥/数据库/依赖，未执行。 |
| G8：全仓 TypeScript、API、Web build/test | NOT RUN | 运行环境 Node v22.16.0，而项目要求 Node >=24.0.0；工作副本无 `node_modules`。不能将 JavaScript 语法检查替代 TypeScript build。 |
| UI、SSE 断线重连、会话隔离与取消 | DEFERRED | 本次执行范围是 PoC 与存储 Gate，没有接前端页面或 SSE 会话接口。 |

## 2. 本次落地内容

### 2.1 墨衡业务工具

新增 `apps/api/src/lib/assistant-read-only-tools.ts`，绑定现有 Prisma 模型与服务，当前只开放以下三只读工具：

1. `project_operating_overview`：读取有效合同金额及其重算核对、叶子预算项目标成本、已记录实际成本、变更外部确认状态分布、下游合同数量、业主进度款记录汇总。
2. `cost_variance`：根据叶子预算项与 `CostEntry` 已记录实际成本计算差异，并返回口径、数据源与生成时间；不把它说成利润或预计完工成本。
3. `change_evidence_completeness`：只返回变更签证字段缺口代码与必要的识别信息，不把材料完整性当成审批结论或法律效力判断，不向模型回显备注正文和凭证内容。

每次工具调用都通过现有 `canAccessProject(..., 'PROJECT_READ')` 重新校验项目范围。业务实体只读；成功/失败调用尝试写 `AuditLog` 记录。有效合同额重算仅纳入 `externalConfirmationStatus = EFFECTIVE` 且存在外部确认金额的变更，不从内部审批或申报金额推断生效金额。超量记录会标记截断，不伪装成完整结果。

### 2.2 PoC 路由与开关

新增 `apps/api/src/routes/assistant-poc.ts`，注册前缀为 `/api/assistant-poc`：

- `GET /api/assistant-poc/tools`
- `POST /api/assistant-poc/run`

需登录、配置限流、请求 schema 拒绝额外字段。`ASSISTANT_POC_ENABLED` 默认 `false`，关闭时返回 404；模块在集成目录中隐藏。该路由是手动工具 harness，不是已完成的聊天 Agent API，更没有与 UI/SSE 集成。启用只应限于受控开发/测试环境。

### 2.3 存储实验与对照

新增 `experiments/pi-durable-poc/`：

- Pi Durable 内置 Node SQLite 关闭/重开 smoke test；
- Pi Durable 强制结束进程后的已提交状态恢复测试；
- 官方 `registerStorageConformance` 套件接线；
- 同一个精简 submission/event 契约的 SQLite / 可选真实 PostgreSQL 探针；
- PostgreSQL 幂等、状态迁移、所有者隔离和并发重复提交测试；
- LangGraph `PostgresSaver` checkpoint 关闭/重开测试；
- LangChain `createAgent` + `PostgresSaver` 的同三工具 Agent 对照 CLI；
- PoC 数据库 URL 必须显式配置、检查与业务 `DATABASE_URL` 不相同，PG 使用隔离 `moheng_poc_*` schema；SQLite 路径限制到 PoC `.data` 目录或系统临时目录。

这些脚本目前是**待目标环境执行的实验代码**，不能把“已编写”表述为“实际通过”。Pi Durable 的 Node SQLite 测试验证不了 PostgreSQL；LangGraph `PostgresSaver` 通过也不意味着 Pi Durable 已有官方 PostgreSQL adapter。

## 3. 本环境确实执行过的命令与结果

以下命令均在工作副本执行：

```text
node scripts/validate-assistant-poc.mjs
PASS: 21 static assertions

node --test experiments/pi-durable-poc/test/storage-probe.test.mjs
PASS: 2 tests, 0 failures

for f in experiments/pi-durable-poc/src/*.mjs experiments/pi-durable-poc/test/*.mjs; do node --check "$f"; done
PASS: all checked .mjs files parse

node experiments/pi-durable-poc/src/storage-comparison.mjs
PASS: SQLite-only probe ran for 300 iterations; PostgreSQL status SKIPPED

package.json / apps/api/package.json JSON parse
PASS

SQLite path guard test
PASS: accepts PoC data folder and OS temp folder; rejects arbitrary external path
PASS: resolves correctly when run from the experiment package working directory
```

运行 `storage-probe.test.mjs` 时 Node 22 会报告 `node:sqlite` 为 experimental feature。这是本环境 Node 版本的限制，不等于测试失败，但也不能代替 Node 24+ 上的完整检查。

## 4. 为什么尚不能判定整体 Gate 通过

1. **Node 版本不符**：当前环境是 Node v22.16.0，项目根及 API workspace 的 `engines` 要求 `>=24.0.0`。
2. **依赖未安装**：工作副本不存在 `node_modules`；因此未运行实际 Pi Durable、LangGraph、Prisma API 服务或 TypeScript build。
3. **没有真实 PostgreSQL 验证条件**：当前没有 `psql`、`postgres`、Docker，也没有提供独立的 disposable PostgreSQL 测试库 URL。PostgreSQL 所有结果明确标成 NOT RUN / SKIPPED。
4. **没有模型端到端结果**：本次没有模型凭证或真实 Agent 执行结果，因此不对工具选择正确率、业务答案准确率、token 成本或模型延迟作任何结论。
5. **无 UI Gate**：没有聊天窗口、SSE 重连、会话列表或用户可见取消操作；也没有宣称这些功能已实现。

## 5. 下一步运行清单（Node 24+ 环境）

### 5.1 安装与本地检查

在独立工作副本 / 开发环境中执行：

```powershell
node --version  # 必须 >=24.0.0
npm install
npm run db:generate
npm install --prefix experiments/pi-durable-poc
npm run validate:assistant-poc
npm test --prefix experiments/pi-durable-poc
npm run storage:compare --prefix experiments/pi-durable-poc
npm run poc:pi-storage
npm run poc:pi-storage-hardkill
```

请把安装成功后产生的依赖锁文件纳入版本控制。完整测试若失败，应把原始日志与 Node/npm/数据库版本一并留存；不要仅凭脚本能启动判定通过。

### 5.2 真实 PostgreSQL 对照

使用一个**专门可销毁、确认与业务 `DATABASE_URL` 不同的 PostgreSQL 测试数据库**，而不是生产/开发业务库：

```powershell
$env:NODE_ENV = 'test'
$env:ASSISTANT_POC_ALLOW_PG_TESTS = 'true'
$env:ASSISTANT_POC_DATABASE_URL = 'postgresql://.../moheng_poc_test'
npm run test:pg --prefix experiments/pi-durable-poc
npm run storage:compare --prefix experiments/pi-durable-poc
npm run storage:langgraph --prefix experiments/pi-durable-poc
```

### 5.3 Agent 对照

只有在已生成 Prisma Client、测试库迁移完成、存在专用测试账号/项目和受控模型密钥时再运行。先运行只读 PoC；确认跨项目调用被拒绝、审计记录有来源，且合同/审批/支付等业务表没有写入，再做内部人员小范围验收。不要在生产开启 `ASSISTANT_POC_ENABLED`。

## 6. 最终决策

**本轮可以确认：** 墨衡仓库已具备一个隔离、默认关闭的三只读工具 PoC 代码骨架；本环境下静态契约和精简 SQLite 语义测试通过。

**本轮不能确认：** Pi Durable 真实 SQLite adapter / 官方 conformance / kill recovery、真实 PostgreSQL 对照、LangGraph checkpoint 持久性、Agent 工具运行态权限、全仓构建和端到端模型调用均未通过 Gate，也不是已测试失败，而是尚未执行。

**决策：暂不批准生产启用。** 下一次 Gate 应在 Node 24+、依赖安装成功和专用 PostgreSQL 测试库条件下复跑；实际 Pi Durable 数据恢复与 PostgreSQL 对照未出结果前，不应因本地精简探针的吞吐数字决定存储选型。

## 7. 参考文档

- Pi Durable 官方 README/API（注明 API 仍处于实验阶段）：<https://github.com/earendil-works/pi/blob/main/packages/durable/README.md>
- LangGraph `PostgresSaver` 官方 API：<https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph-checkpoint-postgres.PostgresSaver.html>
- LangGraph.js agent/persistence 文档：<https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph>
- PoC 安装、命令和安全说明：本目录 `README.md`。
