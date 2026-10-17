# 墨衡 v2.17.0-rc.1 助手工作台阶段验证

- 源码基线：`moheng-construction-cost-management-v2.16.0-rc.1`。
- 本轮新增：将 SSE 事件解析提取为纯 ESM 模块 `assistant-sse-parser.mjs`，通过声明文件提供 TypeScript 类型；加入 6 项 Node 内置测试并纳入 `validate:release-candidate`。
- 实际运行结果：
  - `npm run validate:release-candidate`：PASS，77/77 基础发布候选静态断言通过；助手 UI 静态契约 32 项、助手安全契约 35 项、运行时/存储决策契约 13 项、会话 API/SSE 契约 59 项通过。
  - `npm run test:assistant-ui-contracts`：PASS，6/6。
  - 全局 TypeScript 5.8.3 对无依赖的 SSE 解析器执行 `--allowJs --checkJs --noEmit --strict`：PASS。
  - `npm run build`：BLOCKED，API TypeScript 编译在依赖预检查时失败：`TS2688: Cannot find type definition file for 'node'`。项目要求 Node.js 24+，当前执行环境为 Node.js 22.16.0；工作区没有 `node_modules`，npm registry 探测超时，本次无法安装依赖。
- 未执行/未通过：完整前后端类型检查、完整生产构建、真实 PostgreSQL 迁移/并发 API 集成、浏览器 E2E、真实模型端到端、备份与故障恢复演练。
- 生产状态：助手仍默认关闭；不批准生产启用。
