# 墨衡助手运行态 Gate 后续收敛记录 v1.0

日期：2026-10-17  
记录基线：`2.18.0-rc.1`（历史记录；当前后续收敛见 `assistant-runtime-ci-gates-v1.0.md`）  
决策：允许继续只读内测评估；不批准生产启用。

## 1. 上一轮 Gate 证据与本轮边界

上一轮五项 Gate 的结果由项目测试方提供：依赖安装可重复、类型检查/构建/单测、隔离 PostgreSQL 迁移与并发/取消/回放/权限、浏览器 SSE/切项目/断线/恢复为 PASS；fake provider + 进程中断 + 安全回归为 PARTIAL。成功回答路径未执行。该证据记录为“测试方报告”，本轮执行环境未持有其原始 workspace、lock 文件或完整测试日志，因此不将其当作本轮独立复验结果。

## 2. 本轮源码更改

1. `apps/api/package.json` 把 `@langchain/core` 固定到 `1.2.18`，与测试方报告的 `langchain@1.5.18` peer 要求一致。npm 官方包目录显示这两个版本均已发布；仍需要在目标 Node.js 24+ 环境以 lock 文件执行 `npm ci`，确认安装图没有其他 peer 冲突。
2. `OPENAI_BASE_URL` 作为可选部署环境变量传至 `ChatOpenAI` 的 `configuration.baseURL`，未配置时保持默认 API endpoint。该变量只取自服务端进程环境，不由用户消息控制。配置自定义 endpoint 不会增加 agent 工具或业务写权限。
3. 从 `Project` 模型移除 5 个不存在有效反向关系的治理规则/备份/集成凭据字段；保留有 `projectId` 关系的 `systemParameterRevisions`。
4. 新增 worker 端孤立 run 收敛。每 30 秒扫描一次；只对已超过 60 秒、状态仍为 `QUEUED/RUNNING` 且没有匹配有效 `assistant.agent.run` queue job 的 run 处理。失败时写入 `ASSISTANT_ORPHAN_RUN`、`run.failed` 与审计；已提交取消请求的记录转为 `CANCELLED` 并追加 `run.cancelled`。有效排队任务与仍持有 lease 的运行任务不会被该机制终止。
5. SSE 连接结束后，UI 从会话详情回读指定 run；若持久化记录已是终态，以该终态和 `errorCode` 覆盖较晚出现的 transport error。新增孤立 run 与 worker lease 失败文案。
6. 新增 `scripts/validate-assistant-orphan-runs.mjs` 并接入 release-candidate 验证链。

## 3. 当前可复现的本轮结果

- `npm run validate:release-candidate`：通过；主 release-candidate 套件报告 `77/77 static release-candidate checks passed`。
- 新增孤立 run 恢复静态契约：`10/10` 通过。
- `apps/web/src/assistant-sse-parser.test.mjs`：`6/6` 通过。
- 严格 TypeScript/完整构建、Prisma schema validate/generate、真实 PostgreSQL 集成与浏览器端到端：本轮未在该容器完成。执行环境 Node.js 为 `22.16.0`，项目要求 `>=24.0.0`，且 workspace 依赖未安装。

## 4. Lock 文件状态必须单独处理

本轮可用的 v2.17 源码归档没有 `package-lock.json`，用户报告中两次安装得到同 SHA-256 lock 文件的那个文件也没有随本轮消息提供。因此本候选归档**不声称包含可复现依赖锁文件**。发布前必须把测试方实际验证过的 `package-lock.json` 复制到仓库根目录并核对 SHA-256，或在 Node.js 24+ 网络/镜像可用的干净环境重新生成后完成两次独立安装验证。不要手工伪造或按推测生成 lock 文件。

## 5. 关闭 PARTIAL Gate 的最小验收步骤

使用隔离数据库和本地 fake OpenAI-compatible provider，至少补齐以下成功路径：

1. fake provider 对第一轮返回规范的 tool-call 响应，明确调用白名单中的一个只读工具；第二轮收到 tool result 后返回固定回答。断言仅发生预期只读数据访问，没有业务表写入。
2. 浏览器登录并发消息；完整事件顺序至少包含 `run.queued -> run.started -> tool.started -> tool.completed -> run.completed`，并能重新打开会话从持久化事件游标恢复。
3. 断言 run 为 `COMPLETED`、助手回答消息持久化且可在刷新/重启 worker 后读取、完成审计存在、没有 API key/原始 prompt/工具结果正文泄漏到事件或日志。
4. 对 `OPENAI_BASE_URL` 使用本地 fake endpoint；再把变量清空确认默认 endpoint 配置路径仍可构造。fake provider 的成功测试不能替代真实模型的受控烟雾测试。
5. 针对孤立 run 补数据库集成场景：`jobId = null`、缺失 job row、错误类型/不匹配 payload、有效 QUEUED job、有效 RUNNING lease、已有取消请求，分别验证只收敛应收敛的记录；验证事件唯一终态及审计事务一致性。
6. 在 Node.js 24+ 下运行 `npm ci`、API/Web 类型检查和生产构建、`prisma validate`/`prisma generate`、单测、隔离 PostgreSQL 迁移/恢复和浏览器 SSE 测试。

## 6. 发布边界

通过静态契约验证不等于成功回答、模型 endpoint 兼容性、Prisma 运行态、worker 恢复竞态或生产运维 Gate 已通过。助手必须保持 `ASSISTANT_POC_ENABLED=false`；仅允许隔离只读内测评估。生产启用仍需另行批准。
