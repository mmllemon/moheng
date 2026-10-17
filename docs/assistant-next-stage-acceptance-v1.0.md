# 墨衡只读 AI 助手下一阶段验收清单 v1.0

- 基线：`moheng-construction-cost-management@2.14.0-rc.1`；后端候选：`2.15.0-rc.1`；前端工作台候选：`2.16.0-rc.1`
- 当前状态：安全/存储 Gate 已冻结；会话 API、运行事件、SSE 回放和后台执行后端已实现；v2.16.0-rc.1 已实现 assistant-ui 前端第一版并通过静态 UI 契约，但未完成 Node 24+ 严格类型检查、真实数据库/浏览器运行态与端到端验收。
- 本清单用于防止把 PoC 状态误记为产品完成。

## Gate A — 已有证据冻结

- [x] 只读工具 ID 固定为三个：`project_operating_overview`、`cost_variance`、`change_evidence_completeness`。
- [x] 逐次调用执行服务端项目权限复核。
- [x] 越权/失败调用与成功调用均写审计事件（审计服务故障时的可用性策略仍需评估）。
- [x] Agent 工具没有业务写服务。
- [x] `ASSISTANT_POC_ENABLED` 默认关闭，POC 路由需要认证并限流，且不在公开集成目录显示。
- [x] 将只读 PoC 静态契约验证纳入发布候选验证链。
- [ ] 目标环境再次跑原始 Gate：保留数据库输出、执行命令、Node/npm/Prisma/PostgreSQL 版本、测试数据库身份和最终摘要，便于独立审计。

## Gate B — 运行时/存储路线

- [x] 下一阶段采用 LangGraph.js + PostgreSQL `PostgresSaver` 作为集成候选。
- [x] 不采用 Pi Durable + SQLite 作为长期默认会话存储；其 Conformance/恢复结果仍保留作实验基线。
- [x] 业务 PostgreSQL 仍为财务台账事实源；Agent checkpoint 不得成为业务状态来源。
- [x] 将 LangGraph adapter 放在 `apps/api/src/assistant/runtime/` 独立边界；provider SDK 仅在该边界内调用。
- [ ] 使用同一会话多并发请求、取消/重试、进程重启及 checkpoint 故障执行端到端测试。

## Gate C — 会话 API、SSE 与 UI（代码实现已扩展，运行态 Gate 未通过）

- [x] 后端提供会话列表、新建、详情与归档接口；删除/保留期限策略仍需 Gate D 明确。
- [x] 会话绑定服务端 owner 与 project；列表/详情/消息/事件按 owner 过滤并重新检查当前项目权限；未实现下载接口。
- [x] 消息提交使用稳定 requestId；同 ID 同 payload 幂等，同 ID 不同 payload 返回冲突。
- [x] 长时间任务走 `BackgroundJob`；消息、运行记录与任务入队在同一请求事务中完成。
- [x] SSE 提供按 run 序号的持久事件 ID、`Last-Event-ID`/`after` 重放、心跳与终态关闭；会话 GET 作为页面快照接口。
- [x] 取消状态由服务端持久化；排队任务可取消，运行中请求协作式取消；断开浏览器连接不会取消任务。
- [x] 消息提交在锁后重新核对会话 ACTIVE 状态；完成/失败终态转换通过条件更新处理取消竞态；SSE 拒绝大于当前事件序号的游标。
- [x] `/cost/assistant` 第一版工作台已实现：assistant-ui primitives、自定义 External Store Runtime、当前项目会话/搜索/归档、消息与 Markdown/GFM、运行状态/取消、来源与限制面板。
- [x] UI 通过 30 项静态契约；SSE 事件按持久序号去重，重连使用 `Last-Event-ID`，保留无序号的 `access.revoked` / `stream.error` 终止事件；CJK IME Enter 守卫已加入。
- [x] 服务端会话列表加项目过滤；助手导航受认证状态接口返回的开关约束；事件源/限制面板使用服务端元数据。
- [ ] 在 Node.js 24+ 安装依赖并执行 API/Web strict typecheck、生产构建与组件实际渲染；当前环境没有工作区依赖，构建失败于缺失 `@types/node`，不代表源码逻辑测试失败或通过。
- [ ] 浏览器真实测试：中文输入法、键盘无障碍、窄屏、长表格与长回答、滚动锚定、切换项目/会话后的旧事件流隔离。
- [ ] 多 API 实例、并发提交、真实 SSE 重连/取消和进程中断恢复的运行态测试；当前只有静态契约和事件 helper 单测，不视为并发 Gate 已通过。
- [ ] 对会话与 checkpoint 中 prompt/response 的保留期限、导出/删除策略形成正式决策并执行。

## Gate D — 只读内测与生产准入（未完成）

- [ ] fake provider E2E 覆盖正常回答、工具调用、空结果、超时、部分失败、重复请求、取消、重连和重启恢复。
- [ ] 越权项目、会话 ID 猜测、提示注入、超长输入、模型构造额外工具参数全部拒绝并审计。
- [ ] 测试前后核对 `MainContract`、`Change`、`CostEntry`、`DownstreamContract`、`ProgressBill`、`OwnerReceivable` 六张业务表零变化。
- [ ] 记录 token/成本上限、每用户/每项目限流、模型超时、最大工具调用数与日志脱敏策略。
- [ ] 执行 PostgreSQL 备份/恢复、数据保留/清理、checkpoint/schema 升级及运行告警演练。
- [ ] 成本人员进行受限只读试点，报告答案来源、口径与过期数据提示是否足够。
- [ ] 单独作出生产准入决定；当前 PoC 开关保持默认关闭。

## 当前结论

当前完成范围包括 Gate A 契约固化、Gate B 候选路线以及 Gate C 的后端 API/任务/SSE 和前端工作台代码。v2.16.0-rc.1 的发布候选静态验证链通过（包括 77/77 基础检查、35 项助手安全契约、13 项 runtime/storage 决策契约、59 项会话 API/SSE 契约、30 项 UI 契约）；11 个修改的 TypeScript 文件仅通过语法/转译诊断。Node.js 24+ 严格构建、真实 PostgreSQL/浏览器运行态 Gate 与 Gate D 的只读试点/生产准入仍未通过；不得将墨衡助手标记为正式功能，不得在生产启用 PoC 开关。
