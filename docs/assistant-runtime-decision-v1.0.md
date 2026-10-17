# 墨衡只读 AI 助手运行时与存储决策 v1.0

- 日期：2026-10-16
- 决策基线：`moheng-construction-cost-management@2.14.0-rc.1`；第一阶段后端实现：`2.15.0-rc.1`
- 决策状态：**供下一阶段会话/API/SSE 开发采用；不构成生产启用批准**
- 决策范围：Agent runtime、checkpoint 存储和执行边界，不包含模型供应商最终合同、成本预算或生产运维批准。

## 1. 已有 Gate 与证据边界

按本轮用户提供的验收结果记录：

| Gate | 结果 | 证据范围 |
|---|---|---|
| Pi Durable Node SQLite 官方 Conformance | PASS | 24/24；不是生产灾备验收 |
| SQLite 关闭重开、子进程强制 kill 后恢复 | PASS | 已提交状态可恢复；不等于断电、磁盘损坏或多进程测试 |
| G5 PostgreSQL 契约 | PASS | 幂等、8 并发重复请求、状态迁移、owner 隔离、原子提交 |
| G6 LangGraph `PostgresSaver` | PASS | checkpoint 关闭并重建 saver 后可恢复；不等于 Agent API/SSE 已完成 |
| G1/G8 墨衡集成与安全 | PASS | 用户报告 Node 24 构建、113 单测、8/8 权限、5/5 写防护、6 张业务表零变化及审计完整 |

当前会话没有完整原始日志，也没有对真实 PostgreSQL/模型环境独立复跑以上 Gate。本决策不把用户报告写成“本会话独立验证”。

## 2. 决策

**下一阶段采用 LangGraph.js + PostgreSQL `PostgresSaver` 作为首选集成路线，封装在墨衡自己的 `AssistantRuntime` 边界之后；继续保留只读工具服务作为唯一业务数据访问入口。** 这只是下一阶段候选实现的采用决策，进入生产仍需单独 Gate。

选择理由：

1. 墨衡正式业务数据、后台任务和运维备份已经以 PostgreSQL 为中心；让会话元数据、运行任务和 checkpoint 继续使用 PostgreSQL，可以避免生产会话再增加一份 SQLite 存储及跨存储备份/恢复协调。
2. G6 已有真实 PostgreSQL checkpoint 关闭/重开恢复的正向证据，可以直接围绕已有证据继续补全运行时与 API 集成测试。
3. Pi Durable 文档将 API 明确标注为 experimental，并说明 SQLite/JSONL 存储只允许一个进程拥有，当前不提供跨进程共享存储的锁与 ID 分配。这些限制不符合把它直接作为未来可横向扩展 API 的默认长期基座。
4. 不能用 SQLite 与 PostgreSQL 的单次探针吞吐比作为选择依据；运维边界、持久化、恢复语义和多 worker 行为更重要。

## 3. 必须保持的模块边界

- **业务数据权威源：** 仍为现有 PostgreSQL 业务台账。Agent checkpoint 不是合同额、成本、应收应付、收付款或审批状态的权威来源。
- **运行时边界：** LangGraph 仅由 `apps/api/src/assistant/runtime/langgraph-adapter.ts` 接入；通用后台任务处理层不直接 import provider SDK。业务工具继续调用墨衡自有只读服务，测试/实验目录不作为生产 API。
- **Checkpoint：** 使用专用 schema `moheng_assistant`，不把 Agent 数据表写入 public schema，不允许自行删除或覆盖业务 schema。schema 初始化需在受控部署终端显式设置 `ASSISTANT_CHECKPOINT_SETUP_ALLOW=true`，再运行 `npm run assistant:checkpoint:setup -w @cms/api`；普通请求不自动执行 DDL。
- **身份/项目绑定：** `ownerUserId`、`projectId`、权限版本都由已认证服务端确定。客户端或模型不能提供可信 owner；工具调用每次都必须调用 `canAccessProject(..., 'PROJECT_READ')` 复核。另一个用户的会话按 404 处理，避免确认资源存在。
- **只读工具：** 继续固定为 `project_operating_overview`、`cost_variance`、`change_evidence_completeness`。模型工具 schema 不接受 `userId`、`projectId`、SQL、文件、任意 URL 或命令输入。业务读取以外只允许写入审计。
- **后台执行：** 超出 HTTP 请求生命周期的运行使用现有 PostgreSQL `BackgroundJob` 队列；不得创建 detached promise。任务 payload 使用版本化契约，取消、重试与终态必须持久化。
- **SSE：** SSE 只投影服务端已授权的事件；断线后通过持久游标/快照重放。不能把仅存在内存的事件队列作为唯一恢复来源；事件序号应在同一会话/运行范围内单调递增。
- **敏感上下文：** prompt、模型输出、模型请求体、API key 不进入普通日志与审计 changes。checkpoint 中的数据最小化、保留期限和删除策略须在 Stage C 与 Stage D 落实。

## 4. 不在本决策范围内

- 不批准 `ASSISTANT_POC_ENABLED=true` 用于生产。
- 不宣称真实模型端到端、会话列表、SSE 重连、取消、并发消息、提示注入防护、备份恢复、磁盘满、升级兼容或生产告警已通过。
- 不增加 Redis、Kafka、RabbitMQ、独立对象存储、Kubernetes 或新的常驻服务。
- 不把 LangGraph 作为领域业务规则层；合同和财务规则仍由现有应用服务与事务控制。

## 5. 下一阶段完成标准

会话/API/SSE 第一阶段后端骨架已增量实现；完整工作包仍需满足以下标准：

1. [代码已实现，待 DB Gate] 新增会话/消息/运行/事件模型与追加式迁移，约束 owner/project 绑定、requestId 幂等和软归档；保留期限规则仍待确定。
2. [第一阶段已实现，待运行态 Gate] 建立独立 LangGraph adapter，所有工具均复用只读业务服务；禁止模型选择项目或操作者。
3. [第一阶段已实现，待 E2E] 使用 `BackgroundJob` 运行任务，并以持久化事件记录支撑 SSE 事件重放、心跳和取消；前端初始快照通过会话详情 API 获取，浏览器事件去重尚待实现。
4. 对越权、提示注入、重复 requestId、相同 requestId 不同 payload、并发提交、重复取消、运行中进程重启、checkpoint 失败和模型超时完成自动化测试。
5. 使用专用测试数据库和 fake provider 完成无费用 E2E；再由用户提供受控模型账号完成真实 provider 端到端验收。
6. 只读工具边界与六张业务表零变化断言继续进入 Release Candidate 验证链。所有上述完成后仍须先开展只读内测，再单独评审生产准入。

## 6. 官方资料

- Pi Durable README（实验性 API、存储 owner 与 SQLite durability 说明）：<https://github.com/earendil-works/pi/blob/main/packages/durable/README.md>
- LangGraph.js PostgresSaver API 与首次 setup 要求：<https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph-checkpoint-postgres.PostgresSaver.html>
- LangGraph.js persistence/checkpoint 概念：<https://langchain-ai.github.io/langgraphjs/how-tos/persistence-postgres/>
