# 墨衡｜施工单位成本管理系统

墨衡是一套面向施工单位项目经营与经济成本管理的系统，主要使用者是造价、成本人员和管理人员。它把项目、合同、变更签证、目标成本与实际成本、结算、应收应付、收付款、往来单位、经营分析和报表放在同一条数据链上，并提供一个只读的 AI 助手。

系统当前处于持续开发阶段：业务主干与界面规范已经收口，但真实供应商 AI 准入、目标环境部署与备份恢复演练等投产前事项尚未完成（见[当前状态](#当前状态)）。

## 当前状态

- **版本：** 根目录、API、Web 包版本统一为 `3.0.0`，对应 tag `v3.0.0`（2026-11-05）。3.0.0 表示开发线收口，不等于投产准入。
- **自动化（2026-11-05 基线实测）：** 本地 blocking 门禁 35/35、advisory 0；API 单测 275、Web 单测 32；15 条路由级 PostgreSQL 业务链路已进 CI。
- **数据库：** 27 个迁移在空库上 `prisma migrate deploy` 全量回放通过，得到 58 张 public 表（2026-11-05 实测）。
- **AI 助手：** 开关 `ASSISTANT_POC_ENABLED` 默认关闭，不得在真实供应商验收完成前对外宣称已交付。
- **尚未闭合：** 真实供应商 AI 准入（token 元数据、超时、取消在途）；在真实业务模板上的打印验收；更多弹窗深层状态的视觉验收；Windows 目标环境部署、数据库与附件联合恢复演练。

当前状态的事实来源是[产品范围与当前状态](docs/产品范围与当前状态.md)与[更新日志](CHANGELOG.md)；发布前的证据与缺口清单在[开发阶段验证与后续投产门禁](docs/发布与迁移验收.md)。本文只保留一句话摘要，不重复这两处的明细。

## 功能范围

- **项目与主合同：** 项目档案与项目上下文、主合同、原始合同基线、当前有效合同额。
- **目标成本与实际成本：** 清单层级、目标成本、成本记录，以及成本与项目/分供合同的关联。
- **变更签证：** 公司内部审批与业主/授权代表外部确认分离，凭证与金额差异留审计。
- **业主侧财务：** 进度款、最终结算、应收、收款与退款核销、预付款、质保金。
- **分供侧财务：** 分供合同与调整、结算、应付、付款与退款核销、预付款、质保金、供应商发票核验。
- **往来单位：** 统一主数据、身份核验标记、跨项目经营档案与关联记录。
- **报表中心：** 标准 CSV/XLSX、报表工作室（字段与单元格绑定、重复区域、样式）、打印与 PDF 分页。
- **系统管理与安全：** 用户与项目成员权限、MFA、安全事件、关键动作审计、系统参数与字典、PostgreSQL 后台任务。
- **界面：** Hana 1.1.35 设计系统，纸面与外壳、三级交互半径、状态 token 全仓统一。

## 技术栈

- **Web：** React 18、TypeScript、Vite、React Router、TanStack Query、Zustand、ECharts、Lucide。
- **API 与后台任务：** Node.js 24+、Fastify 5、TypeScript、Zod。
- **数据：** Prisma 7.10.1、PostgreSQL 16+、显式 `@prisma/adapter-pg`。
- **架构：** 模块化单体；API 与后台任务可同进程，也可分进程部署；后台任务队列持久化在 PostgreSQL 里。
- **部署：** 首选 Windows 原生服务；Docker Compose 可选。不引入 Redis、Kafka 或 Kubernetes。

## 项目结构

```text
apps/api/        Fastify API、后台 worker、Prisma schema 与迁移
apps/web/        React + Vite 前端（页面、组件、报表与助手）
docs/            产品、架构、设计系统、部署与验收文档（入口：docs/INDEX.md）
scripts/         门禁与校验脚本、Windows 部署脚本（scripts/windows/）
experiments/     AI 助手与持久化运行时的试验代码
deploy/ nginx/   部署配置样例
```

## 快速开始

需要 Node.js 24+ 与 PostgreSQL 16+。在仓库根目录执行：

```bash
npm ci
cp apps/api/.env.example apps/api/.env    # PowerShell: Copy-Item
# 编辑 apps/api/.env：至少设置 DATABASE_URL、JWT_SECRET、种子管理员账号
npm run db:validate
npm run db:generate
npm run db:deploy      # 会向 DATABASE_URL 指向的库执行迁移
npm run build
npm test
npm run dev            # 并发启动 API 与 Web
```

**注意：** `db:deploy` 是真迁移，首次请指向一次性开发或测试数据库。示例密钥只用于本地，不得带入生产；生产迁移必须走经批准的备份、恢复与切换流程。

Windows 原生启动与注册服务脚本在 `scripts/windows/`，完整步骤见[开发、部署与维护指南](docs/开发与部署指南.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` / `npm run build` | 本地开发 / 构建 |
| `npm run lint` | ESLint（API + Web） |
| `npm test` | API 单元测试 |
| `npx tsc --noEmit -p apps/web` | Web 类型检查 |
| `npm run db:migrate` / `db:deploy` / `db:seed` | 开发迁移 / 部署迁移 / 种子数据 |
| `node scripts/validate-document-links.mjs` | 文档链接校验 |
| `node scripts/run-gates.mjs --tier blocking` | 本地 blocking 门禁（较慢） |
| `npm run ui:inventory` | 页面清点，配合逐页视觉签认 |
| `npm run validate:release-candidate` | 完整发布门禁（十几分钟，仅发布前跑） |

其余脚本见根目录 `package.json` 与 `apps/api/package.json`；需要数据库的用例（`test:*:postgres`）要单独的隔离库。

## 核心业务约束

以下约束是产品口径，不是实现细节，改代码前请先确认理解一致：

- 公司内部审批与业主/授权代表的外部确认分离，两者金额不可互相替代。
- 提交人不得审批本人提交的业务；审批链按公司统一配置执行。
- 当前有效合同额以有效外部确认金额作为变更调整依据。
- 原始合同基线、有效合同额、结算、应收应付、发票、实际成本、现金收付款是不同业务事实，不得混算。
- 业务读取必须执行服务端身份、项目范围与权限检查；关键操作留下审计记录。

完整规则见[架构与核心业务规则](docs/架构与核心业务规则.md)。

## AI 功能状态

代码里已有 LangGraph 适配、PostgreSQL checkpoint、会话 API、持久化运行事件与 SSE 回放、取消与重试、后台任务，以及三个只读业务工具（项目经营概览、成本偏差、变更资料完整性）。助手入口是标题栏打开的全局三栏弹窗（会话 / 对话 / 依据），旧 `/cost/assistant`、`/assistant` 仅作兼容。

生产开关 `ASSISTANT_POC_ENABLED` 默认关闭。真实模型配置、浏览器端到端与权限/恢复验收完成前，不得把 AI 标记为生产已交付。边界与准入条件见[AI 助手实施与准入](docs/AI助手实施与准入.md)。

## 产品主线与文档

- [文档总索引](docs/INDEX.md)
- [产品范围与当前状态](docs/产品范围与当前状态.md)
- [后续四阶段开发路线图](docs/后续四阶段开发路线图.md)
- [架构与核心业务规则](docs/架构与核心业务规则.md)
- [报表中心规格与验收](docs/报表中心规格与验收.md)
- [AI 助手实施与准入](docs/AI助手实施与准入.md)
- [用户操作手册](docs/用户操作手册.md)
- [开发、部署与维护指南](docs/开发与部署指南.md)
- [安全、账号与公网部署](docs/安全、账号与公网部署.md)
- [开发阶段验证与后续投产门禁](docs/发布与迁移验收.md)
- [设计系统 Hana](docs/设计系统-hana.md)（当前唯一界面规范）
- [UI 验收 Hana](docs/UI-验收-hana.md)、[Hana 交互组件对照](docs/Hana交互组件对照.md)、[组件不变量](docs/组件不变量.md)
- [更新日志](CHANGELOG.md)

## 仓库与协作约定

- 只提交源码、迁移、可复现测试和仍然有效的文档；不提交 `.env`、密钥、数据库备份或本机测试产物。
- 依赖安装以锁文件和 `npm ci` 为准，升级依赖要连带重封 lock。
- `main` 是唯一长期集成分支，改动通过 PR 合并；合并后自动删除源分支的设置在启用前遗留的旧分支需单独核验。分支与 PR 规则见[开发、部署与维护指南](docs/开发与部署指南.md#10-git-分支与-pr-协作规则)。
- 自动化门禁通过是必要条件，不等同于产品验收、UI 满意度或生产发布批准。
