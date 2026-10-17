# 墨衡只读 Agent PoC 与存储对照（实验功能，默认关闭）

目标源码基线：`moheng-construction-cost-management@2.14.0-rc.1`。本实验只增加受控只读工具与单独的 agent/storage 验证，不改变墨衡原有合同、变更、成本、支付、审批和报表台账。

## 安全边界

- 生产 API 的 `ASSISTANT_POC_ENABLED` 默认 `false`；不开启时返回通用 404。不要在生产环境打开此开关。
- 三个工具严格限于 `project_operating_overview`、`cost_variance`、`change_evidence_completeness`。每次调用由墨衡 `canAccessProject(..., 'PROJECT_READ')` 复核项目权限；业务读取之外只增加 `AuditLog` 记录。
- 模型工具的输入不含 `projectId`、`userId`、SQL、文件路径、HTTP URL 或命令；操作人和项目由 CLI/服务端绑定。
- `poc:pi-agent` 和 `poc:langgraph-agent` 是**本地受控实验 CLI**，不是生产 API；必须显式设置 PoC 开关。仅使用开发/测试库、专用测试账号与测试模型密钥。
- PostgreSQL 检查须使用单独的可销毁测试数据库，并设置 `NODE_ENV=test`、`ASSISTANT_POC_ALLOW_PG_TESTS=true`、`ASSISTANT_POC_DATABASE_URL`。脚本加载仓库 `.env` 与 `apps/api/.env` 以检测并拒绝与业务 `DATABASE_URL` 同址；不要只因变量名称不同就认定是隔离库。
- SQLite 文件存放在 `experiments/pi-durable-poc/.data/` 或显式临时目录，不要放进 `apps/web/dist`。Windows 部署必须配置合适的 NTFS ACL 并纳入备份/恢复策略。
- 只读工具并不让任意自然语言自动化变安全。不要给助手合同变更、外部确认、审批、收付款、结算确认、核销、权限、系统配置、备份密钥等写工具。

## 要求

- Node.js **24 或更高版本**（仓库 `engines` 约束）。
- PostgreSQL 16+ 可作为可选真实对照库；LLM Agent 对照需有专用模型 API Key。
- API 依赖要已安装、Prisma Client 已生成、数据库 schema 已迁移。不要对生产数据库运行实验。

## 安装

从仓库根目录执行：

```powershell
npm install
npm run db:generate
npm ci --prefix experiments/pi-durable-poc
```

直接依赖版本在 `package.json` 中精确锁定；为了可重复安装，本 PoC 还必须提交独立的 `package-lock.json`。该子项目不属于 npm workspaces，根目录的 `package-lock.json` 不会锁定其依赖图。若独立锁文件尚不存在，CI 会明确失败，而不是使用 `npm install` 临时解析版本。参见 `docs/pi-durable-poc-lockfile-gate-v1.0.md`。

## 第一段：本机可运行的安全与轻量存储检查

```powershell
npm run validate:assistant-poc
npm test --prefix experiments/pi-durable-poc  # 含 Pi Durable 官方 Storage Conformance Suite
npm run storage:compare --prefix experiments/pi-durable-poc
```

`storage:compare` 默认仅测试内置 SQLite 探针。如果没有独立 PostgreSQL 测试库，它必须输出 `SKIPPED`，不得用 SQLite 或模拟结果冒充 PostgreSQL 数据。

## 第二段：Pi Durable 实际 SQLite 存储

```powershell
npm run poc:pi-storage
npm run poc:pi-storage-hardkill
```

完整 `npm test --prefix experiments/pi-durable-poc` 还会用 Pi Durable 官方 `registerStorageConformance` 测试套件验证内置 Node SQLite 存储适配器。第一条是额外的写入、干净关闭/重开及 conversation/doc 检查；第二条由子进程写入已提交文档后被父进程强制终止，再重新打开同一存储检查恢复。两者不需要 LLM Key；需要已安装 Pi Durable 包。

SQLite 适合单进程拥有一个 storage 的实验场景；不支持多进程共享同一个文件并发写。Pi Durable 文档说明其 Node adapter 使用 WAL 与 `synchronous=NORMAL`：已确认提交通常可跨进程崩溃恢复，但最新提交在断电/主机故障时可能丢失。进程 kill 测试**不等于断电测试**，也不取代官方完整 Storage Conformance Suite。

## 第三段：真实 PostgreSQL 对照

创建一个专门用于本实验的 disposable PostgreSQL database，确认它与仓库 `.env` / `apps/api/.env` 的 `DATABASE_URL` 完全不同。然后在 PowerShell 设置变量（URL 只在本地环境里设置，不要写入日志或提交源码）：

```powershell
$env:NODE_ENV = 'test'
$env:ASSISTANT_POC_ALLOW_PG_TESTS = 'true'
$env:ASSISTANT_POC_DATABASE_URL = 'postgresql://.../moheng_poc_test'
npm run test:pg --prefix experiments/pi-durable-poc
npm run storage:compare --prefix experiments/pi-durable-poc
npm run storage:langgraph --prefix experiments/pi-durable-poc
```

- `test:pg`：对真正 PostgreSQL 上的精简 submission/event 契约执行幂等、状态迁移和所有者隔离检查；每次测试创建并删除自己命名空间唯一的 `moheng_poc_*` schema。
- `storage:langgraph`：对 LangGraph `PostgresSaver` 做真实 checkpoint 写入/关闭/重建/恢复，然后删除该次 smoke test 的隔离 schema。
- `storage:compare`：测量同一个最小 submission/event 契约的 SQLite 与 PostgreSQL 吞吐。它**不是**完整 Pi Durable Storage 的公平性能基准，不应单凭吞吐数字决定技术选型。

## 第四段：用相同三工具对照两个 agent runtime

### Pi Durable + SQLite

```powershell
$env:ASSISTANT_POC_ENABLED = 'true'
$env:ASSISTANT_POC_USER_ID = '<专用测试账号 ID>'
$env:ASSISTANT_POC_PROJECT_ID = '<该账号有权读取的测试项目 ID>'
$env:ASSISTANT_POC_MODEL_ID = '<供应商支持的准确 model id>'
$env:OPENAI_API_KEY = '<专用测试密钥>'
New-Item -ItemType Directory -Force 'experiments/pi-durable-poc/.data' | Out-Null
$env:PI_POC_STORAGE_PATH = (Join-Path (Resolve-Path 'experiments/pi-durable-poc/.data') 'readonly-agent.sqlite')
$env:ASSISTANT_POC_REQUEST_ID = 'gate1-request-001'
npm run poc:pi-agent -- '概览该项目有效合同额、目标成本与已记录实际成本，并列出来源口径'
```

同一 `ASSISTANT_POC_REQUEST_ID` 重试前应复用**完全相同输入**；不同输入必须使用新请求 ID。首次运行后，不要把此 SQLite 存储文件复制给其他用户。

### LangGraph + PostgresSaver

仍在隔离测试数据库上设置上述环境变量，另外确保变量 `ASSISTANT_POC_DATABASE_URL` 已设置，执行：

```powershell
npm run poc:langgraph-agent -- '概览该项目有效合同额、目标成本与已记录实际成本，并列出来源口径'
```

这个对照将同一业务只读工具服务接到 LangChain `createAgent`（基于 LangGraph）与 `PostgresSaver`，以按账号/项目哈希生成的 thread ID 持续保存检查点。它会在测试数据库中保留 `moheng_poc_langgraph_agent` schema（可以设置 `ASSISTANT_POC_LANGGRAPH_SCHEMA` 改名），供第二次运行验证 thread 恢复；测试完成后只删除这个实验 schema，不删除或更改业务 schema。请先确认 schema 名称仅用于此 PoC。

## 判定标准

- 安全：越权项目调用必须拒绝；工具不接受模型传入的用户/项目身份；业务表零写入，仅审计表允许新增记录；任意写操作都不可从工具目录调用。
- 持久性：重复 requestId + 相同 prompt 返回原 submission；相同 requestId + 不同 prompt 拒绝；Pi SQLite 关闭重开和进程强制终止后已确认文档可恢复。
- 存储：真实 PostgreSQL 测试不可跳过；LangGraph PostgresSaver 的 checkpoint 必须可关闭/重建后读取；Pi Durable 没有官方 PostgreSQL adapter，因此本实验**不声称 Pi Durable 已支持 PostgreSQL**。
- 上线 Gate 暂不视为通过：还需 Node 24+ clean install、完整 API/Web typecheck/build 与 API tests、真实账号/项目权限集成测试、实际 Pi packages 运行结果、真实 PG 对照、备份恢复和故障注入记录。PoC 不接用户 UI，不替代正式 AgentRuntime/API 设计。

## 相关入口

- `apps/api/src/lib/assistant-read-only-tools.ts` — 真实业务服务绑定的只读工具。
- `apps/api/src/routes/assistant-poc.ts` — 默认关闭、登录认证、限流的测试路由。
- `scripts/validate-assistant-poc.mjs` — 不依赖后端服务启动的安全契约静态检查。
- `src/storage-probe.mjs` — SQLite 与可选 PostgreSQL 的精简存储契约探针。
- `src/pi-durable-storage-smoke.mjs`、`src/pi-durable-hardkill-smoke.mjs` — Pi Durable SQLite 的干净重开和进程 kill 实验。
- `src/langgraph-postgres-smoke.mjs`、`src/moheng-langgraph-agent.ts` — LangGraph PostgreSQL checkpoint / agent 对照。
