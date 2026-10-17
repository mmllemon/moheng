# 墨衡助手前端接入设计 v1.0

- 候选版本：`moheng-construction-cost-management@2.17.0-rc.1`
- 基线：v2.15.0-rc.1 助手会话 API、PostgreSQL 事件日志、SSE 重连和只读工具服务
- 状态：前端工作台第一版实现；等待 Node.js 24+ 依赖安装、严格构建和浏览器/数据库 Gate
- 生产开关：保持 `ASSISTANT_POC_ENABLED=false`

## 1. 与已验证结论的关系

此实现沿用《墨衡接入 Pi Durable 可行性评估 v1.0》和《墨衡 Pi Durable PoC 与存储对照 Gate 验收报告 v0.3》的约束：

- G5 是通用 PostgreSQL 幂等、并发、状态迁移、owner 和原子提交契约的通过证据；它不证明 Pi Durable 自带 PostgreSQL adapter。
- G6 是 LangGraph `PostgresSaver` checkpoint 关闭后重新打开恢复的通过证据；它不等于完整 Agent runtime 和前端链路已经通过生产验收。
- SQLite conformance 与 kill-recovery 的既有通过证据继续保留；8.8 倍的微型探针数据不能单独决定存储引擎。
- 助手仍只使用三只读工具；合同、变更、成本、结算、应收应付和收付款等业务事实仍以墨衡业务服务/数据库为准。
- 运行时必须保持可替换。UI 不能依赖 Pi Durable/LangGraph 的内部存储格式，也不能将会话 ID 当作权限凭证。

## 2. UI 依赖选择

### `@assistant-ui/react` + 自定义 External Store Runtime

- 将 `@assistant-ui/react` 固定在 `0.15.29`；React 18/19 peer range 与当前 React 18.3 工作区兼容。
- 使用 `useExternalStoreRuntime`、`AssistantRuntimeProvider` 和 Thread/Message/Composer primitives。
- `@assistant-ui/react-markdown` 固定 `0.14.23`，`remark-gfm` 固定 `4.0.1`，用于回答中的列表、表格、代码和引用结构。
- 不接入 `@assistant-ui/react-langgraph` 预制 transport：该适配器围绕 LangGraph SDK 的 thread/stream 协议，而墨衡现有 API 是自有 REST + PostgreSQL 持久化 SSE 事件日志。本版通过 `apps/web/src/assistant-api.ts` 适配，避免前端与单一 runtime 协议耦合。
- 不使用 Assistant Cloud；会话、事件、权限和审计都留在墨衡服务端与 PostgreSQL。

### `open-claude-ui` 的精选参考

仅借鉴通用交互模式：CJK IME Enter 守卫、用户向上滚动时不抢夺视口、可控 composer、窄屏会话导航、低噪声状态标识。该仓库声明 MIT，但其 README 将项目描述为 Claude 界面的逆向还原，因此不复制 Claude 商标/品牌文案、专有二进制资产或整套外观。墨衡继续使用自身主题 token、导航、业务术语及组件层级。

## 3. UI 结构

`/cost/assistant` 位于已有成本工作台中，桌面端采用三栏布局：

1. 左栏：当前用户在当前项目范围内的会话，支持切换、搜索、归档记录与新建。
2. 中栏：助手消息、快捷问题、Markdown/GFM 回答、排队/运行/失败/取消状态、发送和取消。
3. 右栏：工具执行轨迹、来源实体/字段/行数/查询范围、数据生成时间和限制说明。

窄屏隐藏证据侧栏并把会话列表变为横向导航。所有图标使用现有 `lucide-react`，不引入 emoji 图标。助手入口仅在认证后 `/assistant-poc/status` 报告 enabled 时显示；直接打开路由时同样 fail-closed。

## 4. 事件与来源契约

SSE 客户端使用 `fetch` 流而非原生 `EventSource`，从而携带现有 Authorization header 和 refresh-session 行为。连接使用 `Last-Event-ID`，事件按持久化序号去重；断线后按事件日志恢复。切换会话会中断旧订阅，变更项目后只展示与当前项目 ID 相符的会话详情。

`tool.completed` 事件只保存精简、结构化来源元数据：entity、字段名、行数、查询范围、生成时间与限制说明。不保存工具原始结果、业务备注、用户原始 prompt 或完整模型响应到来源卡。来源卡代表工具级证据元数据，不声称每句话均精确绑定到单条业务记录。

## 5. 后端同步修正

- 会话列表查询支持服务端 `projectId` 过滤和 `includeArchived` 过滤。
- 查询参数校验失败分支显式接收 Fastify `reply`，避免非法查询产生未定义变量异常。
- 助手状态探测仅要求认证，且只返回开关状态；具体会话、工具、消息和运行接口仍受 feature gate 与认证保护。
- 已完成会话打开时，UI 回放最新运行事件以恢复来源/限制面板；不要求前端保存第二份权威事件状态。

## 6. Gate 与限制

静态契约 `scripts/validate-assistant-ui.mjs` 检查依赖版本、路由、认证、SSE 游标、IME 守卫、项目隔离和来源事件。该静态检查不替代：

- Node.js 24+ 下的依赖安装、`tsc -b` 与 Vite build；
- PostgreSQL 迁移、真实会话权限、重复 requestId/并发与取消竞态测试；
- 浏览器实际渲染、长会话滚动、中文输入法、窄屏、键盘无障碍测试；
- SSE 断线恢复、进程 kill/restart 与 fake provider/真实模型端到端；
- 备份/恢复、成本预算、告警与独立生产准入评审。

本版本仍为 RC，助手继续默认关闭，不授权财务写操作、审批或自动确认外部变更。
