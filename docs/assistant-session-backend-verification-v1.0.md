# 墨衡只读助手会话后端第一阶段验证记录 v1.0

- 候选版本：`2.15.0-rc.1`
- 代码基线：`2.14.0-rc.1`
- 验证日期：2026-10-16
- 状态：**后端第一阶段增量完成；Gate C 未通过；不批准生产启用。**

## 本轮实现范围

- 新增会话、消息、运行和运行事件四个 Prisma 模型及追加式 PostgreSQL 迁移。
- 新增会话列表/创建/详情/归档、消息提交、取消运行和 SSE 事件流接口。所有路由仍挂在默认关闭的隐藏助手 PoC 模块下。
- 消息、run 与 `BackgroundJob` 入队通过同一事务提交；请求使用 `requestId` 幂等键与 payload hash，job payload 只放标识，不复制 prompt。
- 运行事件按 run 分配单调递增序号，支持 `Last-Event-ID`/`after` 回放、心跳、终态关闭、项目授权周期复核和游标上限检查。
- 取消、归档、提交和终态迁移补充并发保护；过期且耗尽重试次数的 worker lease 会收敛对应助手 run，避免页面持续显示运行中。
- LangGraph 与模型提供方 SDK 只在 `apps/api/src/assistant/runtime/langgraph-adapter.ts` 引入；PostgreSQL checkpoint schema 通过显式 setup 命令初始化，普通请求不执行 DDL。

## 本轮验证结果

| 验证项 | 结果 | 证据边界 |
|---|---|---|
| 发布候选静态回归 | PASS，77/77 基础检查 | 静态源码契约，不代表运行时测试 |
| 助手只读安全契约 | PASS，34 项 | 静态源码断言；G5/G6/G1/G8 原结果来自此前验收记录，本轮未独立复跑 |
| Runtime/storage 决策契约 | PASS，13 项 | 静态源码断言，不代表模型或 PostgreSQL 可用 |
| 会话 API/SSE 专项契约 | PASS，59 项 | 静态检查，不代表并发/断线场景实际跑通 |
| 事件序号 helper 单测 | PASS，3/3 | 仅验证 sequence、跨会话范围拒绝、事件类型校验 |
| 本轮修改的 TypeScript 文件转译诊断 | PASS，11 个文件 | 仅语法/转译诊断，不是 TypeScript semantic typecheck |

## 未完成 / 未验证

当前执行环境为 Node.js `22.16.0`，而项目要求 Node.js `24+`；工作区依赖未安装，环境无法访问 npm registry。因此本轮未完成：

- `tsc` 全量类型检查、API/Web 构建和完整测试套件；
- Prisma Client 生成、迁移应用和真实 PostgreSQL 并发集成测试；
- LangGraph/provider 真实调用、checkpoint 故障续跑和计费/超时验证；
- 浏览器端 SSE 重连、多个 API/worker 并发、端到端取消及重启恢复；
- 前端助手 UI、会话删除/保留期限、prompt/response/checkpoint 清理策略。

SSE 事件可在连接中断后从已持久化事件序号继续读取；这不等价于模型执行被进程终止后自动从 checkpoint 安全续跑。当前后台任务对助手设置 `maxAttempts: 1`，避免不透明重试造成重复模型费用；耗尽 lease 后 run 会变为失败或取消，需要用户以新的 requestId 发起新运行。

## 安全与发布状态

- `ASSISTANT_POC_ENABLED` 必须保持默认关闭；不在生产开启。
- 工具白名单仍固定为 `project_operating_overview`、`cost_variance` 和 `change_evidence_completeness`。
- 助手只能经过已有只读业务服务读台账；不提供任意 SQL、shell、文件、URL、业务写入或审批工具。
- Gate C 只完成后端第一阶段；前端与运行态 Gate 未通过。Gate D 和正式生产准入评审尚未开始。
