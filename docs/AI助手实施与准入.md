# AI 助手实施与准入

## 1. 当前实现状态

当前选型采用 **LangGraph.js + PostgreSQL `PostgresSaver`**，运行时封装在墨衡自己的适配层后；这一技术决定不构成生产启用批准。

源码中已有：
- LangGraph.js + PostgreSQL `PostgresSaver` 运行时适配，位于 `apps/api/src/assistant/runtime/langgraph-adapter.ts`。
- 会话、消息、运行记录、持久化事件、SSE 重放/心跳、取消请求和 requestId 幂等 API。
- 持久化后台任务处理与陈旧 run 收敛。
- `/cost/assistant` 第一版工作台，包含会话列表、消息流、工具状态、来源摘要与局限说明。
- 三个只读业务工具：`project_operating_overview`、`cost_variance`、`change_evidence_completeness`。

这些实现不能被表述为完整生产 AI 已交付。当前功能开关 `ASSISTANT_POC_ENABLED` 必须保持关闭，直到真实模型 E2E、浏览器交互、权限/安全、成本控制、恢复与只读内测完成并独立批准。

## 2. 模型与数据库配置

服务端目前读取以下配置：

| 变量 | 用途 |
|---|---|
| `OPENAI_API_KEY` | 模型 API 凭据 |
| `ASSISTANT_POC_MODEL_ID` | 具体模型 ID |
| `OPENAI_BASE_URL` | 可选 OpenAI-compatible 服务地址 |
| `ASSISTANT_CHECKPOINT_DATABASE_URL` | 可选独立 checkpoint 连接；未设置时使用 `DATABASE_URL` |
| `ASSISTANT_POC_ENABLED` | 显式功能开关；默认关闭 |

checkpoint 需在受控部署过程中显式初始化：设置 `ASSISTANT_CHECKPOINT_SETUP_ALLOW=true` 后运行 `npm run assistant:checkpoint:setup -w @cms/api`。普通 HTTP 请求不得执行 DDL。

不得将任何真实 API key/数据库口令写入源码、文档、CI artifacts、普通日志或审计变化字段。状态接口只允许返回是否就绪，不得返回秘密原文。

## 3. 只读与项目隔离原则

1. 权威业务事实来自墨衡 PostgreSQL 台账，不来自模型记忆或 checkpoint。
2. 服务端从已验证登录会话确定操作者，不能接受模型生成的 `userId` 或可信项目 ID。
3. 每次工具调用再次验证当前项目读取权限。
4. 工具 schema 只暴露有边界的业务参数；不接受 SQL、shell、任意 URL、文件路径或动态代码。
5. 不能写入合同额、成本、应收应付、收付款、审批/外部确认状态。
6. 回答应说明工具、数据范围、生成时间与限制；不得夸大证据精确度。
7. Prompt/模型输出/API key 不进入普通日志；持久化内容遵守数据最小化与保留政策。

## 4. 产品开发清单

- [ ] 配置状态与错误指引：模型 ID/凭据/checkpoint 未配置时显示可理解的原因；不在状态或错误响应中泄漏密钥。
- [ ] 完整问答闭环：空结果、模型超时、工具失败、限流、取消、重试和持久化终态一致。
- [ ] SSE 重连/事件回放：断线后从持久化序号恢复，不重复消息、不覆盖新会话。
- [ ] 可解释来源：工具、字段/实体、范围、生成时间及口径/局限。
- [ ] 体验打磨：空白会话、建议问题、中文输入法、长消息滚动、窄屏、键盘导航、错误重试。
- [ ] fake provider E2E、真实 provider 的受控 E2E；验证并发、重启恢复、越权/提示注入，并确认 `MainContract`、`Change`、`CostEntry`、`DownstreamContract`、`ProgressBill`、`OwnerReceivable` 六张业务表零变化。
- [ ] 明确 token/成本上限、请求/项目限流、超时、数据保留/删除和告警。
- [ ] 造价/成本人员只读试点并记录回答口径问题；完成独立生产准入评审。

## 5. 模型供应商与启用

代码支持 OpenAI-compatible 配置，但此能力不等于已连接用户真实供应商或已完成真实端到端验收。开发方可先完成不依赖真实密钥的代码和 fake-provider 测试；真实模型验收时由授权人员在受控环境设置密钥，不通过聊天传递。

在安全验收和只读内测未完成前，不得把 `ASSISTANT_POC_ENABLED=true` 作为发布默认值，也不得赋予 AI 财务写入或审批能力。
