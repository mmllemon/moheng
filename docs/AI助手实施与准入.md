# AI 助手实施与准入

状态校准：2026-10-21。当前 UI 收口后的源码基线为 `eec9677`；PR #17 的项目级用量摘要与 PR #18 的经营链路修复已合入 `main`。历史 Assistant runtime 和 Prisma 7 migration CI 证据对应 `551d154` 与 PR 精确头提交；这不等于 `eec9677` 已跑过同一组 CI，也不等于真实模型供应商 E2E 或完整浏览器验收已完成。

## 1. 当前实现状态

运行时必须保持可替换：LangGraph/provider SDKs are isolated behind 墨衡自己的 `AssistantRuntime` 适配层；LangGraph 和 PostgreSQL checkpoint 通过该层接入，业务工具只调用墨衡自有只读服务。Pi Durable/SQLite 的实验探针不证明 Pi Durable 自带 PostgreSQL adapter，也不作为当前 API 的生产存储基座。助手 UI 不绑定 LangGraph 内部协议。

交互参考只借鉴一般的会话导航、中文输入法与滚动体验；open-claude-ui 仅作为交互研究参考，不复制 Claude 商标/品牌文案、专有二进制或视觉资产。

当前选型采用 **LangGraph.js + PostgreSQL `PostgresSaver`**，运行时封装在墨衡自己的适配层后；这一技术决定不构成生产启用批准。

源码中已有：
- LangGraph.js + PostgreSQL `PostgresSaver` 运行时适配，位于 `apps/api/src/assistant/runtime/langgraph-adapter.ts`。
- 会话、消息、运行记录、持久化事件、SSE 重放/心跳、取消请求和 requestId 幂等 API。
- 助手消息提交失败后提供重试入口并复用原 `requestId`，以便网络响应丢失时重放同一任务而不是重复创建运行；运行终态失败时可用新 `requestId` 重新提交原问题，前端连接中断而服务端任务仍活动时可重连同一运行。相应静态/运行态契约已纳入 Assistant runtime 与 Prisma 7 migration 工作流并通过对应 PR 头提交的 CI；目标浏览器中的真实交互仍需继续验收。
- 持久化后台任务处理与陈旧 run 收敛。
- 长时间运行的助手任务必须进入 PostgreSQL 持久化 `BackgroundJob` 队列，由后台 worker 处理；不得把模型执行放在 HTTP 请求生命周期内。助手 `AssistantRun` 状态与队列任务状态分别记录，并通过幂等终态转换、取消检查和陈旧任务收敛保持一致。
- 成本助手已从工作台页面改为**全局弹窗**：标题栏快捷操作旁提供入口，弹窗内包含会话列表、消息流、悬浮输入卡、工具状态、来源摘要与局限说明；成本工作台不再保留助手 tab，旧 `/cost/assistant` / `/assistant` 链接只作为打开弹窗的兼容入口。
- 项目级用量摘要端点按当前认证用户、授权项目及最近 30 天统计已结束/活动运行；只有 token 字段完整且总量一致的 `COMPLETE` 记录参与输入/输出/总量累计，`PARTIAL` / `UNAVAILABLE` 单独计数且不估算费用。
- 三个只读业务工具：`project_operating_overview`、`cost_variance`、`change_evidence_completeness`。
- `project_operating_overview` 包含分供付款/退款合计和最近流水样本，且与应付、实际成本分开；当流水扫描超过 10,000 条时，付款/退款合计返回不可用并说明限制。
- `cost_variance` 在目标成本项扫描超过 10,000 条时返回 `INDETERMINATE`，偏差额与偏差百分比为空；不得用部分目标成本计算一个看似完整的偏差。

这些实现不能被表述为完整生产 AI 已交付。当前仍为受控 POC：生产默认关闭，管理员可在隔离测试环境通过 `/system/assistant` 启用；真实模型 E2E、浏览器交互、权限/安全、成本控制、恢复与只读内测完成并独立批准前，不得作为正式生产能力发布。

## 2. 模型调用边界

默认每次模型请求最多生成 1,800 tokens，HTTP 请求超时为 45 秒，最多进行 1 次 SDK 重试；LangGraph 单次运行的 recursion limit 为 12。 模型用量只采信供应商/SDK 返回的 token 元数据：优先读取 LangChain `AIMessage.usage_metadata` 的 `input_tokens`、`output_tokens`、`total_tokens`，并兼容两种常见 response metadata 形态；多次模型调用按每次返回的计数累加，不按消息字符长度推算。只有所有生成的模型消息都返回完整、非负且 `total = input + output` 的计数时，才将用量保存为 `COMPLETE`；部分缺失则为 `PARTIAL`，完全没有元数据则为 `UNAVAILABLE`，后二者的计数均保持 `null`。这些是供应商报告的 token 数，不等同于账单金额或发票；供应商未报告的用量保持未知，需在真实供应商 E2E 中核验。 每个用户跨所有会话最多同时保留 2 个 `QUEUED`/`RUNNING` 任务；提交事务会锁定对应用户行后再统计活动任务，确保并发提交不能绕过上限。该限制用于控制队列积压和费用暴露，并不替代按供应商账户设置账单告警。 同一用户每个滚动 60 秒最多提交 6 个新模型任务；计数包括已完成、失败和取消的 run，避免通过快速结束任务或切换会话绕过限制。复用同一 `requestId` 的幂等重放不会创建新 run，也不消耗新名额。 用户取消运行后，worker 每 1.5 秒检查一次持久化取消标记，并将 `AbortSignal` 传给 LangGraph 调用；运行状态仍由数据库条件更新决定。具体供应商 SDK 是否中止底层 HTTP 请求/费用停止，必须在受控真实供应商验收中确认，不能只凭 `AbortSignal` 传递宣称已经验证。 单次模型请求的消息上下文最多 24,000 个 JavaScript UTF-16 代码单元；在这一预算下，只保留最近且能够完整装入的历史消息和当前问题，不截断当前问题，也不把半条历史消息拼进上下文。若早期历史被省略，系统提示会要求模型不得假设该历史内容。该字符预算是供应商无关的输入规模上限，不等于精确 token 计数或真实账单成本。此设置限制单轮延迟与费用暴露，但不替代按用户/项目限流、供应商账单告警和真实模型成本评估。若实际选用的 OpenAI-compatible 服务不支持该 token 参数，应在适配层显式处理并通过真实供应商 E2E 验收，不得静默假设限制生效。

## 3. 模型与数据库配置

服务端目前读取以下配置：

| 变量 | 用途 |
|---|---|
| `OPENAI_API_KEY` | 模型 API 凭据 |
| `ASSISTANT_POC_MODEL_ID` | 具体模型 ID |
| `OPENAI_BASE_URL` | 可选 OpenAI-compatible 服务地址；留空时使用 SDK 默认地址 |
| `ASSISTANT_CHECKPOINT_DATABASE_URL` | 可选独立 checkpoint 连接；未设置时使用 `DATABASE_URL` |
| `ASSISTANT_POC_ENABLED` | 无数据库配置时的环境变量回退开关；默认关闭 |
| `ASSISTANT_ENCRYPTION_KEY` | 可视化配置保存供应商 API Key 所需的独立 AES-256-GCM 密钥（64 位十六进制）|

checkpoint 需在受控部署过程中显式初始化：设置 `ASSISTANT_CHECKPOINT_SETUP_ALLOW=true` 后运行 `npm run assistant:checkpoint:setup -w @cms/api`。普通 HTTP 请求不得执行 DDL。

### 3.1 可视化供应商配置（2026-10-20）

管理员可在 `/system/assistant` 配置 OpenAI 兼容供应商：

- 填写供应商名称、接口地址与 API Key；
- “拉取供应商模型”会由服务端请求 `{baseUrl}/models`，密钥不进入浏览器 localStorage，也不回显；
- 从实时返回的模型列表选择模型，也允许手动填写；
- “保存配置”将 API Key 用 `ASSISTANT_ENCRYPTION_KEY` 加密后写入 `AssistantProviderConfig`；
- “测试连接并刷新模型”只验证 `/models` 可达，不代表具体模型已通过 tool calling、金额口径与越权拒绝验收；
- 配置写入数据库后优先于环境变量；没有数据库行时才回退到 `OPENAI_API_KEY` / `ASSISTANT_POC_MODEL_ID` / `OPENAI_BASE_URL`；
- 页面同时显示检查点连接串、`moheng_assistant` schema、后台 worker 与加密保险库的就绪状态。

当前本地验证已用 mock provider 验证“拉取模型 → 选择 → 加密保存 → 状态生效”链路；mock 配置已在验证后清空，真实供应商仍需授权人员在受控环境填写真实密钥。

不得将任何真实 API key/数据库口令写入源码、文档、CI artifacts、普通日志或审计变化字段。状态接口只允许返回是否就绪，不得返回秘密原文。

若配置 `OPENAI_BASE_URL`，必须为绝对 HTTP(S) 地址；不接受 URL 内嵌用户名/密码、查询参数或片段。状态接口只返回 `endpointValid` 布尔值，不回显地址，也不探测供应商网络可达性。错误地址会使助手就绪状态为未就绪，消息提交 API 不会为其排队，并且后台执行层仍会再次拒绝该任务。

## 4. 只读与项目隔离原则

1. 权威业务事实来自墨衡 PostgreSQL 台账，不来自模型记忆或 checkpoint。
2. 服务端从已验证登录会话确定操作者，不能接受模型生成的 `userId` 或可信项目 ID。
3. 每次工具调用由服务端 `canAccessProject` 按认证用户、角色、当前项目和 `PROJECT_READ` 再次验证读取权限；模型输出不能覆盖该判定。
4. 工具 schema 只暴露有边界的业务参数；不接受 SQL、shell、任意 URL、文件路径或动态代码。
5. 不能写入合同额、成本、应收应付、收付款、审批/外部确认状态。
6. 回答应说明工具、数据范围、生成时间与限制；不得夸大证据精确度。
7. Prompt/模型输出/API key 不进入普通日志；持久化内容遵守数据最小化与保留政策。

## 5. 当前开发状态与待办

### 已合入主干的能力

- [x] 配置就绪诊断与错误 endpoint 拒绝入队；状态接口不回显 API 密钥或完整 endpoint。
- [x] 持久化会话/运行/事件、SSE 回放与心跳、取消请求、requestId 幂等、失败重试和陈旧 run 收敛。
- [x] 上下文预算、每用户最多 2 个活动任务、滚动 60 秒最多 6 次新提交、每次模型请求 1,800-token 输出上限、45 秒超时和最多 1 次 SDK 重试的代码配置。
- [x] 只读业务工具、服务端项目权限复核、事件/日志敏感信息契约。
- [x] 供应商报告 token 的 COMPLETE/PARTIAL/UNAVAILABLE 分类；未知值不按字符估算。
- [x] 项目范围近 30 天用量摘要：按当前认证用户及授权项目读取；展示活动/终态任务数和完整/部分/未知用量，不计算或虚构费用。

### 仍需在开发阶段继续验证

- [ ] 浏览器中覆盖配置未就绪、空结果、错误/限流、取消、失败重试、断线重连、来源面板和用量摘要。
- [ ] 在隔离数据库中补齐会话/项目隔离与业务表无写入的运行态回归；使用 fake provider 验证工具调用与恢复边界，并断言 `MainContract`、`Change`、`CostEntry`、`DownstreamContract`、`ProgressBill`、`OwnerReceivable` 六张业务表零变化。
- [ ] 在授权测试环境连接真实模型供应商，核验 token 元数据格式、真实取消/超时行为与费用/账单边界；不在聊天中传递密钥。
- [ ] 完成中文输入法、长消息滚动、窄屏、键盘导航和错误引导等体验检查。

生产/正式启用仍须独立准入：生产默认关闭，且应先完成真实 provider E2E、安全/隐私准入和只读内测；以上自动化通过不等于生产启用批准。

## 6. 模型供应商与启用

代码支持 OpenAI-compatible 配置，但此能力不等于已连接用户真实供应商或已完成真实端到端验收。开发方可先完成不依赖真实密钥的代码和 fake-provider 测试；真实模型验收时由授权人员在受控环境设置密钥，不通过聊天传递。

在安全验收和只读内测未完成前，不得把 `ASSISTANT_POC_ENABLED=true` 作为发布默认值，也不得赋予 AI 财务写入或审批能力。
