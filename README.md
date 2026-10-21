# 墨衡｜施工单位成本管理系统

墨衡面向施工单位的项目经营与经济成本管理，覆盖项目、合同、变更签证、目标成本、实际成本、结算、应收应付、收付款、往来单位、经营分析、报表与只读 AI 助手。

> **当前状态（2026-10-21）：** `main` 的 UI 收口基线为 `eec9677`。根目录、API 和 Web 的 package version 仍为 `2.19.0-rc.2`，尚未发布正式版本。本轮已完成 Hana 1.1.35 全仓交互收口、项目驾驶舱/主合同/待办/报表/账号页重做、760px 全局命令中心，以及标题栏入口的全局成本助手弹窗；成本助手不再占用工作台 tab。
>
> 2026-10-21 本地门禁：Web lint/build 通过、75 项 UI 规范检查、26 路由视觉回归 0 failure、20 页面 axe 0 violation。历史 CI 证据仍对应 `551d154` 与 PR #17/#18 的精确头提交（[Assistant runtime run #39357880407](https://github.com/mmllemon/moheng/actions/runs/39357880407)）；这些历史 PASS 不能直接外推为当前 HEAD 的 CI 通过。真实供应商 AI E2E、Univer 画布内部皮肤、Windows 目标部署和投产恢复演练仍属于后续阶段。

## 技术栈

- Web：React 18、TypeScript、Vite、React Router、TanStack Query、Zustand、ECharts、Lucide SVG 图标。
- API/worker：Node.js **24+**、Fastify 5、TypeScript、Zod。
- ORM/数据库：Prisma **7.10.1**、PostgreSQL 16+、显式 `@prisma/adapter-pg`。
- 架构：模块化单体；API 与后台任务可同进程运行，也可分进程部署；后台任务使用 PostgreSQL 持久化队列。
- 首选部署：Windows 原生服务；Docker Compose 为可选项，不强制引入 Redis、Kafka 或 Kubernetes。

## 快速开始（开发/测试环境）

先安装 Node.js 24+、PostgreSQL 16+。在仓库根目录运行：

```powershell
npm ci
Copy-Item apps/api/.env.example apps/api/.env
# 编辑 apps/api/.env：设置 DATABASE_URL、JWT_SECRET、种子管理员账号等
npm run db:validate
npm run db:generate
npm run db:deploy
npm run build
npm test
npm run dev
```

**注意：** `db:deploy` 会对连接字符串指向的数据库执行迁移。首次操作请使用一次性开发/测试数据库；不得把示例密钥带入生产。生产迁移必须使用经批准的备份、恢复和切换流程。

Windows 原生脚本位于 `scripts/windows/`。正式部署之前请先阅读[开发、部署与维护指南](docs/开发与部署指南.md)。

## 产品主线与文档

- [文档总索引](docs/INDEX.md)
- [产品范围与当前状态](docs/产品范围与当前状态.md)
- [后续四阶段开发路线图](docs/后续四阶段开发路线图.md)
- [架构与核心业务规则](docs/架构与核心业务规则.md)
- [报表中心规格与验收](docs/报表中心规格与验收.md)
- [AI 助手实施与准入](docs/AI助手实施与准入.md)
- [用户操作手册](docs/用户操作手册.md)
- [开发、部署与维护指南](docs/开发与部署指南.md)
- [发布与迁移验收](docs/发布与迁移验收.md)
- [设计系统 Hana](docs/设计系统-hana.md) — 当前唯一界面规范
- [Hana 交互组件对照](docs/Hana交互组件对照.md)
- [UI 验收 Hana](docs/UI-验收-hana.md)
- [历史设计文档（V6 / Pro-Tier）](docs/INDEX.md#历史与归档)
- [更新日志](CHANGELOG.md)

## 核心业务约束

- 公司内部审批与业主/授权代表的外部确认分离。
- 提交人不得审批本人提交的业务；审批链按公司统一配置执行。
- 当前有效合同额以有效外部确认金额作为变更调整依据；内部审批金额不替代外部确认金额。
- 原始合同基线、有效合同额、结算、应收应付、发票、实际成本和现金收付款是不同业务事实，不得混算。
- 业务读取必须执行服务端身份、项目范围和权限检查；关键操作留下审计记录。

## AI 功能状态

代码中已有 LangGraph 适配、PostgreSQL checkpoint、会话 API、持久化运行事件/SSE、后台任务和三个只读业务工具。成本助手现在是标题栏入口打开的三栏全局弹窗（会话 / 对话 / 依据），旧 `/cost/assistant` / `/assistant` 仅作为兼容入口。生产/正式启用开关 `ASSISTANT_POC_ENABLED` **默认关闭**。真实模型配置、浏览器体验、权限与恢复端到端验收未全部完成前，不得将 AI 标记为生产已交付。

## 仓库约定

- 只提交源码、迁移、可复现测试和仍有效的文档；不提交 `.env`、密钥、数据库备份或本机测试产物。
- 依赖安装以锁文件和 `npm ci` 为准。
- 自动化门禁通过是必要条件，不等同于产品验收、用户 UI 满意度或生产发布批准。
- Git 分支协作规则见[开发、部署与维护指南](docs/开发与部署指南.md#10-git-分支与-pr-协作规则)：以 `main` 为唯一长期集成分支，改动通过 PR 合并；PR 合并后自动删除源分支已启用，但启用前遗留的旧分支需单独核验并清理。
