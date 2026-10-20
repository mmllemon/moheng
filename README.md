# 墨衡｜施工单位成本管理系统

墨衡面向施工单位的项目经营与经济成本管理，覆盖项目、合同、变更签证、目标成本、实际成本、结算、应收应付、收付款、往来单位、经营分析、报表与只读 AI 助手。

> **当前集成状态：** v2.20 产品完善已通过 [PR #4](https://github.com/mmllemon/moheng/pull/4) 合并到 `main`，后续报表打印修复也已通过 [PR #6](https://github.com/mmllemon/moheng/pull/6) 合并；Prisma 7 迁移已纳入主分支。根/API/Web 的包版本仍为 `2.19.0-rc.2`，尚未发布正式版本，项目仍处于 RC。最近一次 AI token 用量功能的 [PR #16](https://github.com/mmllemon/moheng/pull/16) 在合并前的精确头提交 `fd20433bfa59ac6e8a3c1a51f52fa0f2aa205607` 上通过 Assistant runtime gates 与 Prisma 7 migration gates；这不替代后续主分支新提交的 CI 结果。真实浏览器/Windows 验收、脱敏业务数据迁移核对及 AI 真实供应商 E2E 仍未完成。

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
- [设计系统规范](docs/设计系统规范-Pro-Tier-Suite-v4.2.0.md)
- [更新日志](CHANGELOG.md)

## 核心业务约束

- 公司内部审批与业主/授权代表的外部确认分离。
- 提交人不得审批本人提交的业务；审批链按公司统一配置执行。
- 当前有效合同额以有效外部确认金额作为变更调整依据；内部审批金额不替代外部确认金额。
- 原始合同基线、有效合同额、结算、应收应付、发票、实际成本和现金收付款是不同业务事实，不得混算。
- 业务读取必须执行服务端身份、项目范围和权限检查；关键操作留下审计记录。

## AI 功能状态

代码中已有 LangGraph 适配、PostgreSQL checkpoint、会话 API、持久化运行事件/SSE、后台任务和三个只读业务工具。生产/正式启用开关 `ASSISTANT_POC_ENABLED` **默认关闭**。真实模型配置、浏览器体验、权限与恢复端到端验收未全部完成前，不得将 AI 标记为生产已交付。

## 仓库约定

- 只提交源码、迁移、可复现测试和仍有效的文档；不提交 `.env`、密钥、数据库备份或本机测试产物。
- 依赖安装以锁文件和 `npm ci` 为准。
- 自动化门禁通过是必要条件，不等同于产品验收、用户 UI 满意度或生产发布批准。
