# 墨衡｜施工单位成本管理系统
版本：MVP 2.19.0-rc.2 验证候选（Prisma 7 迁移分支；Windows 原生部署优先）


## v2.19.0-rc.2 Prisma 7 迁移候选（2026-10-17）

本候选将 Prisma ORM 与 Client 统一到 7.10.1，使用显式 PostgreSQL driver adapter `@prisma/adapter-pg`，将数据库 URL 移入 `apps/api/prisma.config.ts`，并把生成客户端放到 `apps/api/src/generated/prisma`。所有 API 中原先从 `@prisma/client` 导入生成类型/枚举的文件改为引用项目内的生成客户端。迁移在独立分支 `feat/v2.19.0-rc.2-prisma7` 进行；只有 Node 24 构建、完整测试、隔离 PostgreSQL 迁移和漏洞审计通过后才可考虑合并。**不批准生产启用，也没有自动合并到 main。**

## 只读 AI 助手后端缺陷收敛（2026-10-17）

v2.19.0-rc.1 吸收上一轮助手运行态 Gate 的源码修复：将 `@langchain/core` 与 `langchain@1.5.18` 的 peer 范围对齐至 `1.2.18`；`OPENAI_BASE_URL` 可透传给 LangChain OpenAI-compatible endpoint；修正 `Project` 上 5 个不成立的治理/备份/集成反向关系声明；现有 PostgreSQL worker 另外定期将超过 60 秒且没有有效匹配队列任务的孤立助手 run 收敛为 `FAILED` 或尊重已有取消请求收敛为 `CANCELLED`，追加终态事件和必要审计；SSE 断开后界面回读已持久化终态，不再让已失败运行继续显示为连接错误。助手生产开关仍默认关闭。

**本包验证边界：**上一轮“五项 Gate 四项完整通过、一项部分通过”的真实环境运行态结果来自项目测试方，本轮未重跑真实模型/隔离 PG/浏览器链路。v2.19 新增 fake provider 成功路径、事件 payload 白名单、日志与事件泄漏扫描器及隔离 PostgreSQL 六场景+陈旧孤立 run 集成测试；本轮验证状态与后续 Gate 见 `docs/assistant-runtime-ci-gates-v1.0.md`。当前执行容器为 Node.js 22，且未包含用户本地生成的 workspace lock 文件/已安装依赖；因此不能用当前导出包替代 Node.js 24+ 的重复安装、全量构建、Prisma 生成与真实 PG/浏览器验收。**仍不批准生产启用。**

## v2.15.0-rc.1 助手后端阶段记录（历史状态）

v2.15.0-rc.1 新增会话/消息/运行事件持久化 API、后台任务入队、SSE 事件重放与心跳、取消请求、requestId 幂等与归档。LangGraph.js + PostgreSQL `PostgresSaver` 已封装在 `apps/api/src/assistant/runtime/`，checkpoint schema 需在受控部署终端先设置 `ASSISTANT_CHECKPOINT_SETUP_ALLOW=true`，再执行 `npm run assistant:checkpoint:setup -w @cms/api` 显式初始化。该实现仍是默认关闭的只读 PoC 后端增量：前端助手 UI、TypeScript/build、Prisma Client 生成、真实 PostgreSQL 迁移/并发、浏览器 SSE 重连及 fake/真实模型 E2E 尚未验收。当前环境为 Node.js 22.16.0（仓库要求 Node.js 24+）且未安装工作区依赖，本轮只运行静态验证。详情见 `docs/assistant-runtime-decision-v1.0.md`、`docs/assistant-next-stage-acceptance-v1.0.md`、`docs/assistant-session-backend-verification-v1.0.md`。**生产仍禁止启用 `ASSISTANT_POC_ENABLED`。**


> **v2.14.0-rc.1 系统管理关键缺口闭环**：在 v2.13 工作台与授权复核基础上，新增显式账号级“全部项目只读”数据范围（默认仍为仅已分配项目），并在报表、经营总览、项目列表和单位经营档案等读取路径执行；不会授权修改、审批、付款或成员管理。已发布项目权限矩阵只收紧既有角色能力，不能放宽代码中的权限上限；内部流程当前仅接入变更签证审批状态流转，继续保留提交人自审批禁止和外部金额确认规则。两个业务可读数值参数已接入待办预警（合同到期窗口、目标成本超支严重级别），支持全局默认和项目覆盖。数据库备份与 PostgreSQL 全局角色/配置归档均使用 AES-256-GCM 和 SHA-256；恢复演练在核验集群身份后创建临时隔离库验证业务数据库，但不会自动将全局角色 SQL 应用到目标集群。集成管理支持明确允许名单下的 HTTPS 连接测试与异步 JSON 投递/幂等键/后台重试，但不代表任何特定 ERP 已完成业务映射。巡检按钮使用透明常态背景与中性色键盘焦点轮廓。

**发布边界**：本版本仍为 RC。静态源码契约不等于严格类型检查、真实数据库迁移、端到端或生产环境验收；当前开发容器 Node.js 22.16.0 且缺少工作区依赖。必须在 Node.js 24+ 环境执行构建/测试、Prisma 校验/生成、隔离 PostgreSQL 迁移与恢复、浏览器 E2E 和目标 Windows 验收后，才能评估正式发布。

> **v2.12.1-rc.1 源码缺陷修复**：对用户提供的 39 条源码缺陷清单逐项复核，修复已确认的状态同步、参数校验错误详情、发布审计准确性、项目归档竞态、回滚说明截断、子进程树超时终止、备份元数据/文件删除顺序、严格文件名校验、PostgreSQL 恢复目标集群身份检查、登录限流 HMAC 密钥耦合、刷新热路径历史数据清理、MFA 密文格式校验、强制改密并发条件等问题；另补充后台清理失败冷却与 MFA/限流单测。原缺陷清单中也有误报或产品建议，逐条理由见 `docs/源码缺陷审计与修复记录-v2.12.1-rc.1.md`。仍为 RC：完整 Node.js 24+ 构建、真实 PostgreSQL 迁移/并发、浏览器 E2E、Windows 进程树和备份恢复验证尚未完成。公网模式新增独立 `LOGIN_ATTEMPT_HMAC_KEY`；首次切换会改变已有登录限流桶 hash，不要与 JWT 密钥轮换叠加进行；恢复演练需能读取 `pg_control_system()` 的数据库运维账号（通常授予只读 `pg_monitor`）。

> **v2.12.0-rc.1 统一基础字典与参数配置**：基于 v2.11.0-rc.1 增量新增基础字典、参数版本模型与迁移，提供“统一基础字典”和“统一参数配置”两个管理员工作台；参数支持全局默认/项目级覆盖、类型校验、管理员独占/业务可读范围、草稿显式发布、历史版本和回滚草稿；另提供仅登录可读的字典/有效参数 API，并按项目成员权限过滤项目级参数。实际成本录入的计量单位字段已接入统一 `MEASURE_UNIT` 字典提示，同时保留自由输入；普通业务 API 只返回被显式设为业务可读的已发布参数。字典和参数的加入不会自动改写合同金额生效规则、变更审批、结算收付或其他核心财务状态机。当前版本仍是 RC，Node.js 24+ 完整构建、Prisma/数据库迁移、浏览器 E2E 及其余业务模块逐个接入仍待验证，详见 `docs/统一基础字典与参数配置设计-v2.12.0-rc.1.md` 与 `docs/阶段验收记录-v2.12.0-rc.1.md`。

> **v2.10.0-rc.1 导航职责、系统管理概览与个人改密**：将侧栏重组为“经营中心 / 工作台 / 项目管理 / 系统管理”，项目档案与成员授权移至项目管理，操作追溯归入管理员系统管理；新增长期账号菜单和自主修改密码，要求当前密码，新密码最少 12 位，已启用 MFA 的账号还要进行二次验证，修改后撤销全部旧会话。系统管理首页改为状态/风险概览与后续建设路线，不再重复展示全套管理入口。项目成员规范路由调整为 `/projects/members`，旧路径继续重定向兼容。公网安全候选仍未完成真实公网和完整构建验收，不代表已上线。详见 `docs/系统管理工作台与导航优化设计-v2.10.0-rc.1.md`、`docs/阶段验收记录-v2.10.0-rc.1.md`。

> **v2.11.0-rc.1 系统管理扩展**：在 v2.10 账号安全与导航基线上，增加部门/岗位归属、版本化变更审批规则（草稿与发布分离，后端实际执行）、集成凭据 AES-256-GCM 加密存储与轮换、数据质量巡检，以及 PostgreSQL 备份/校验/隔离恢复演练工作台。公司级管理员身份不自动变成项目审批角色；审批规则不改变外部业主确认金额生效政策。备份/恢复需要部署配置 `BACKUP_DIR`、`PG_DUMP_PATH`、`PG_RESTORE_PATH`、`PSQL_PATH` 与独立的 `RESTORE_TEST_DATABASE_URL`；集成凭据需要独立的 `INTEGRATION_ENCRYPTION_KEY`。运行环境级验证仍未完成，详见 `docs/系统管理扩展设计与实施方案-v2.11.0-rc.1.md` 和 `docs/阶段验收记录-v2.11.0-rc.1.md`。

本项目参考《施工单位成本管理系统完整设计方案 v1.0》。全局经营总览跨项目汇总；单项目成本与合同业务统一通过“成本工作台”（`/cost`）访问。项目档案与项目成员授权统一进入“项目管理”分组；公司级系统账号、安全中心和操作追溯统一进入“系统管理”分组；成本与管理界面共享同一套业务对象、数据库和服务端权限边界。历史 `/workspace/...` 和 `/settings/users` 路径保留重定向兼容。

> **v2.9.0-rc.1 公网登录与安全管理**：新增会话与安全事件管理、公网模式 HTTPS 配置闸门、管理员 TOTP MFA、账号启停/密码重置、强制改密、刷新令牌重放防护、登录失败账号/IP 双维度限流。公网模式必须设置 `PUBLIC_BASE_URL=https://你的域名`、`COOKIE_SECURE=true`、独立 `MFA_ENCRYPTION_KEY` 与独立 `LOGIN_ATTEMPT_HMAC_KEY`；Caddy 示例和 Windows 部署顺序见 `docs/公网访问与系统安全管理设计-v2.9.0-rc.1.md` 及 `deploy/caddy/Caddyfile.example`。该版本尚需 Node.js 24+ 严格构建、Prisma 迁移、TLS/公网和浏览器端到端验证；静态验收结果见 `docs/阶段验收记录-v2.9.0-rc.1.md` 和 `docs/验证结果-v2.9.0-rc.1.txt`。


> **v2.8.0-rc.1 成本工作台定名与系统管理入口拆分**：将单项目业务入口正式命名为“成本工作台”，组件文件/导出符号调整为 `CostWorkspaceLayout`，规范路由改为 `/cost/*`；原 `/workspace/*` 路径继续重定向兼容，旧成员路径转到 `/system/members`，旧账号管理路径转到 `/system/accounts`。新增“系统管理工作台”首页（`/system`），把项目档案、项目成员与权限、系统账号管理整理为独立管理入口。成员角色规则、API 权限校验、最后一名项目负责人保护和审计写入沿用既有实现；未修改 Prisma Schema、数据库迁移和财务金额规则。静态检查与构建状态见 `docs/阶段验收记录-v2.8.0-rc.1.md`。

> **v2.7.0-rc.1 预览导航、驾驶舱图表与 XLSX 类型修正**：基于 v2.6.0-rc.1 增量修复。报表预览的应用内入口携带安全返回目标；驾驶舱自动预览用 replace 替换带 `autoPreview=1` 的中间路由，避免返回后再次跳入预览；其他预览入口都有明确返回目标，直接打开 URL 时回退至安全的应用内页面。项目驾驶舱月度成本图扩大 Y 轴空间并开启 `containLabel`；项目工作台仅保留分组视觉、不显示分组组名；`report-studio-xlsx.ts` 的字体构造类型调整为 `Partial<ExcelJS.Font>`。未修改数据库模型、历史迁移或财务业务规则。导航/界面/XLSX 静态回归 10/10 通过；完整 TypeScript 构建与浏览器实测仍需在 Node.js 24+ 完整依赖环境完成。详见 `docs/报表中心与报表工作室设计方案-v2.7.0-rc.1.md`、`docs/阶段验收记录-v2.7.0-rc.1.md` 和 `docs/WP12-报表预览返回导航图表与XLSX类型修复验收清单-v2.7.0-rc.1.md`。


> **v2.6.0-rc.1 报表中心与导航精简**：直接基于 v2.5.0-rc.1 增量调整。移除报表中心重复说明卡和重复 Hero，标准台账改成紧凑目录与单一配置面板；项目级/公司级报表入口增加明确动作提示、hover 和键盘焦点状态；项目成员与权限从成本支出分组移至独立项目管理分组；移除没有实际指标/计算的数据装饰“经营健康度”，替换为可用的“项目驾驶舱”快捷入口。没有修改数据库 Schema/migrations、财务规则或 API。静态候选检查已通过；严格类型检查、生产构建与浏览器 E2E 仍需在 Node.js 24+ 完整依赖环境完成。详见 `docs/报表中心与报表工作室设计方案-v2.6.0-rc.1.md`、`docs/阶段验收记录-v2.6.0-rc.1.md`、`docs/WP11-报表中心瘦身与导航校正验收清单-v2.6.0-rc.1.md`。

> **v2.5.0-rc.1（历史版本）报表使用体验与数据边界修正**：在 v2.4.0-rc.1 基础上增量开发。报表预览采用有界自然列宽；目标成本、实际成本、进度款、变更签证、分供合同/应付、业主应收/收退款及项目驾驶舱提供统一预览/导出入口；往来单位经营档案提供绑定 `businessPartyId` 的默认报告模板与模板编辑入口。重复区域所有绑定字段共享同一数据记录，查询排序含稳定主键；金额汇总使用整数分。新增迁移 `20261015030000_party_report_template_context`。历史验收见 `docs/阶段验收记录-v2.5.0-rc.1.md`、`docs/报表中心与报表工作室设计方案-v2.5.0-rc.1.md` 与 `docs/WP10-报表中心修正与入口增强验收清单-v2.5.0-rc.1.md`。

> **v2.0.0-rc.1 历史更新**：继续推进 WP2–WP8。新增八类权限过滤的 CSV 台账报表、目标成本 CSV 列映射/服务端预检/确认前复检、本机未提交草稿、项目成员与角色管理页面，以及基于当前台账动态生成的待办与预警。新增静态候选检查和审计覆盖源码契约检查。没有改动既有财务状态机、结算/应收应付金额口径或 Prisma Schema/migrations。WP8 的严格类型检查、生产构建、PostgreSQL 与浏览器 E2E、Windows 实机部署仍需在 Node.js 24+ 环境完成，详见 `docs/阶段验收记录-v2.0.0-rc.1.md` 与 `docs/WP2-WP8实施计划与状态-v2.0.0-rc.1.md`。

> **v1.9.0-rc.1 更新**：依据《施工单位成本管理系统完整设计方案 v1.0》做差距驱动的增量开发：新增“操作追溯”只读页面与权限受限查询 API，支持按项目、业务对象、关键字、日期范围检索，展开变更快照并导出防公式注入的 CSV；经营总览增加“查看全部操作”入口。未修改 Prisma Schema/数据库迁移及合同、结算、应收应付金额规则。下一阶段计划与未实现能力边界见 `docs/下一阶段开发计划与实施记录-v1.9.0-rc.1.md`，验收记录见 `docs/阶段验收记录-v1.9.0-rc.1.md`。

> **v1.8.0-rc.1 更新**：在 v1.7 Pro-Tier 视觉系统上继续完成交互层重构：UI 设置入口改为右上角独立浮层卡片，项目管理页隐藏冗余的顶部项目选择长条并将项目卡片升级为经营摘要；下拉选择器与日期日历改为项目内绘制的统一主题浮层，支持键盘操作、搜索、日期边界、今天/清除及确认；设置卡片、命令面板、快捷菜单、项目表单和控件弹层补齐弹出/收回过渡，尊重减少动效偏好。业务 API、数据模型、财务计算口径不因 UI 调整而改写。最新 UI 验收见 `docs/阶段验收记录-v1.8.0-rc.1.md`。

> **实现边界**：当前交付仍是核心台账 MVP，并非完整的 30–40 页面系统。v2.1 新增原生 XLSX 与基础模板设计器，v2.3 新增 PostgreSQL 后台导出任务，v2.4 增加项目/公司级单元格绑定报表工作室，v2.5 补齐台账工作区快捷预览、单位经营档案默认模板和稳定的重复区域数据绑定（均为验证候选）；本版本仍需完成完整环境验收。v1.4.0-rc.1 在 v1.3.0-rc.1 结算/应付模型之上新增统一往来单位主档、单位多业务角色、合同/成本关联、合同录入时的单位选择与快速建档、单位经营档案和按项目权限聚合。历史名称回填得到的单位身份默认为“待核验”；在信用代码、签约主体或其他可靠依据核对前，跨项目汇总只能作为待核对视图，不应直接当成最终财务对账依据。v1.3.0-rc.1 新增分供合同阶段/最终结算、结算外部确认与过账、独立应付单、付款核销关系、退款反向核销、预付款扣回、质保金留置/释放/核销和供应商发票登记/核验/应付来源分配。结算可采用纯金额模式，清单明细是可选补充信息，不是必填或必需的数据库依赖。已过账的最终结算以累计确认金额减历史过账金额产生差额，负向差额记为供应商待返还/抵扣，而不是伪装为负付款。付款、发票和结算均不自动生成/冲减实际成本。当前尚未实现正式材料入库/验收及退货、完整发票三单匹配、供应商信用抵扣自动核销、跨应收单自动抵销工作流、会计总账凭证与税务处理、材料库存/价格台账、对象存储、通知推送和 PWA 离线冲突解决；原生 XLSX 模板与 PostgreSQL 异步报表队列已在 v2.3.0-rc.1 加入，但仍待完整环境验收。内部审批链仍为固定状态流。“执行中/完工待结算合同额”仅汇总相应状态下的合同当前金额，“合同额减已关联实际成本”仅为预警差额，不等于精确未履约承诺或预计成本。

## 首选部署方式：Windows 原生

生产运行路径为：

- Node.js 24 LTS：运行 Fastify API。
- PostgreSQL 16：Windows 服务，存储业务数据及刷新令牌哈希。
- Fastify 同源提供 `apps/web/dist` 静态前端，因此生产环境只需开放一个应用端口。
- PowerShell 脚本：准备环境、启动/停止进程；可选注册 Windows 任务计划程序开机启动。
- 不需要 Redis、Docker Desktop 或 Nginx。

Node.js 与 PostgreSQL 应从官方渠道安装。Windows 上 Prisma 需要 Microsoft Visual C++ Redistributable 2015 或更高版本（现代 Windows 环境通常已安装）。参考：

- Node.js 版本状态：https://nodejs.org/en/about/previous-releases
- PostgreSQL Windows 安装：https://www.postgresql.org/download/windows/
- Prisma 系统要求：https://docs.prisma.io/docs/orm/reference/system-requirements

### 1. 安装 PostgreSQL 并创建数据库

安装并启动 PostgreSQL 16 Windows 服务，然后用 PostgreSQL 管理员账号打开 `psql` 或 pgAdmin，执行：

```sql
CREATE ROLE cms_user LOGIN PASSWORD '替换为URL安全字符的强密码';
CREATE DATABASE cost_management OWNER cms_user;
```

生产密码建议只用英文字母、数字、下划线和短横线，以避免连接 URL 编码错误。

### 2. 准备 Node.js 和项目配置

安装 Node.js 24 LTS，然后在项目根目录打开 PowerShell：

```powershell
Copy-Item apps/api/.env.example apps/api/.env
notepad apps/api/.env
```

至少修改 `DATABASE_URL`、`JWT_SECRET`、`SEED_ADMIN_EMAIL`、`SEED_ADMIN_PASSWORD`。`JWT_SECRET` 至少 32 个字符，应使用随机密钥。首次生产初始化建议设置 `SEED_DEMO_DATA=false`。示例配置不可直接用于公网生产环境。

### 3. 构建、迁移和初始化

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\prepare-windows.ps1
```

脚本会检查 Node.js 版本、安装依赖、生成 Prisma Client、构建前后端、执行数据库迁移并创建管理员。手动启动脚本会核验服务端入口路径，并在报告成功前确认 API 与 PostgreSQL 健康；停止脚本会核验进程身份，避免把复用的 PID 误当成本系统进程。若配置文件不存在，脚本会先复制模板并退出；编辑配置后再次运行即可。

### 4. 启动并访问

```powershell
.\scripts\windows\start-windows.ps1
Invoke-RestMethod http://localhost:3001/health/ready
```

默认地址：`http://localhost:3001`。API 文档：`http://localhost:3001/docs/`。日志输出在 `apps/api/logs/`。停止进程：

```powershell
.\scripts\windows\stop-windows.ps1
```

### 5. 配置开机启动（可选）

在“以管理员身份运行”的 PowerShell 中执行：

```powershell
.\scripts\windows\register-startup-task.ps1
```

这会注册名为 `ZhuhengCostManagement` 的 Windows 任务计划程序任务，以 SYSTEM 身份在开机时运行 API；异常退出时配置最多重启 5 次。日志写入 `apps/api/logs/api-service.log`。卸载任务：

```powershell
.\scripts\windows\unregister-startup-task.ps1
```

任务以 SYSTEM 运行时必须确保它可以读取项目目录、`apps/api/.env` 和构建产物；数据库必须配置为自动启动。生产内网访问应在 Windows 防火墙与 IIS/其他 HTTPS 反向代理处显式配置，不建议直接对公网开放 Node 端口。

## 开发模式

需要 Node.js 24 LTS 和一个可连接的 PostgreSQL 实例。将数据库连接写入 `apps/api/.env` 后执行：

```powershell
npm install
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

开发模式下 Vite 使用 `http://localhost:5173`，Fastify API 使用 `http://localhost:3001`。生产构建时由 API 同源托管前端静态文件。

## 可选部署方式：Docker Compose

Docker 只作为可选路径保留。需要 Docker Engine/Desktop 与 Compose v2：

```bash
cp .env.example .env
# 编辑 .env，修改数据库密码、JWT_SECRET 和初始管理员密码
docker compose up --build -d
docker compose ps
docker compose logs -f api
```

默认 Web 地址为 `http://localhost:8080`。该 Compose 使用 PostgreSQL 容器、API 容器和 Nginx Web 容器；**不再运行 Redis**。刷新会话哈希保存在 PostgreSQL `RefreshToken` 表中。

## v1.8 Pro-Tier 界面与交互系统

登录页和应用导航使用内嵌 SVG 品牌标识“墨衡”。右上角“界面设置”入口打开独立的浮层卡片，提供象牙雅白、香槟曜金、黑曜极光、冰川天青及跟随系统主题；支持跟随主题/靛青/青玉/朱砂强调色、舒朗/紧凑密度、宽屏和减少动效。顶部命令面板支持 Ctrl/Cmd+K、方向键、Enter 与 Esc；表格行支持 J/K 和方向键巡检。经营总览采用非对称 Bento 布局，图表只展示实际台账中的项目快照，不伪造时间趋势。设置保存在当前浏览器，不写入业务数据库。

## v2.3 框架演进：模块化单体 + PostgreSQL 后台任务

- XLSX 报表可通过 `POST /api/reports/:reportKey.xlsx/jobs` 进入 PostgreSQL 任务队列，并通过 `GET /api/reports/jobs/:jobId` 查询状态、`GET /api/reports/jobs/:jobId/download` 下载；原同步 XLSX 与 CSV 接口继续兼容。
- 默认 worker 在 API 进程内运行，不增加独立常驻服务。设置 `BACKGROUND_WORKER_ENABLED=false` 后，可运行 `npm run worker -w @cms/api` 启动独立 worker；Compose 也提供 `worker` profile，需让 API 关闭内置 worker 后启用该 profile。
- 队列文件默认保存在 `apps/api/data/jobs`，Windows 应限制 NTFS ACL；Docker 使用 `job-data` 命名卷。结果默认保存 7 天，任务状态与重试信息存 PostgreSQL。
- 任务参数通过 `type` + `payloadVersion` + handler registry 隔离具体工作实现。将来接入财务/通知等服务时，可在同一业务事务内添加任务/发件箱记录，并通过 adapter 接入；核心合同、结算、资金规则不依赖消息代理。


本轮保留 React + TypeScript、Fastify、Prisma、PostgreSQL 和当前 Windows 原生部署模式，不迁移框架、不拆微服务；新增的轻量队列直接使用 PostgreSQL，不增加 Redis、RabbitMQ、Kafka 或 Kubernetes 等必需服务。

- 新增统一 API 模块注册表，18 个 API 路由模块由 `apps/api/src/platform/module-registry.ts` 统一挂载，其中 16 个出现在集成元数据目录，公共配置读取与系统管理写接口不对外公开枚举。
- 新增 `GET /api/meta`，用于发现应用版本、API 主版本和模块目录；具体接口契约仍以 `/docs/` 的 OpenAPI 文档为准。
- 新增 `/health/live` 存活探针、`/health/ready` 数据库就绪探针，并保留旧 `/health` 路径供部署脚本兼容。
- 响应提供 `x-request-id`；服务端日志对常见令牌/密码字段脱敏；生产 CORS 默认不再开放 Vite 开发来源。
- 不修改既有财务领域模型与历史迁移；本版本仅新增 `BackgroundJob` 模型及前向迁移。外部服务优先通过 REST/OpenAPI 与可选适配器接入，事件队列和独立服务以真实需求为触发条件。
- 版本仍为 RC。完整 Node.js 24+ 安装、依赖锁定、严格检查、PostgreSQL 迁移、财务联测、Windows 与浏览器 E2E 尚未全部通过。

详细设计与发布 Gate：[`docs/框架演进方案-v2.3.0-rc.1.md`](docs/框架演进方案-v2.3.0-rc.1.md)、[`docs/阶段验收记录-v2.3.0-rc.1.md`](docs/阶段验收记录-v2.3.0-rc.1.md)。历史框架边界见 v2.2 文档与 Git 历史。


## v2.1 原生 XLSX 与报表模板设计器

- **八类台账双格式导出**：在原 CSV 基础上新增原生 XLSX，包含真实单元格类型、列格式、冻结窗格、筛选、打印布局和可选导出说明页。单次最多 10,000 条，超限会说明截断。
- **报表设计器**：支持标题/副标题、模板名称、字段白名单绑定、列标题/顺序/宽度/可见性/格式、静态列、自定义版式行、合并/拆分、行高、纸张方向、打印参数、预览、XLSX 导出和浏览器打印 PDF。
- **模板生命周期**：个人、项目共享、系统模板；草稿、发布、归档、版本历史与恢复。模板内容使用 JSON 保存并由服务端校验，未发布修改不覆盖发布快照。
- **目标成本原生 XLSX 导入**：提供下载模板、静态值解析、表头映射、服务端预检、确认前复检和单事务提交。CSV 入口继续保留。导入不接受公式、宏/外部链接、嵌入对象等内容；文件大小 8 MB、行数 5,000 限制。
- **安全边界**：模板不能执行 SQL/脚本，也不能访问任意字段或改变业务数据；财务台账不开放通用批量导入。数据仍按服务端项目权限查询并记录模板/导入审计。
- **发布状态**：当前为 `v2.3.0-rc.1` 候选。本版本在 v2.2 基础上新增 PostgreSQL 后台任务队列、异步 XLSX 导出、幂等键、任务租约/重试、独立 worker 入口和结果文件过期清理，并修复所提供 TypeScript 缺陷汇总中的根因。尚未完成 Node.js 24+ 干净依赖安装、完整类型检查、Prisma 生成/迁移和浏览器/Excel/WPS 端到端测试。见 `docs/阶段验收记录-v2.3.0-rc.1.md`、`docs/框架演进方案-v2.3.0-rc.1.md`、`docs/原生XLSX与报表模板设计器-v2.1.0-rc.1.md` 和 `docs/WP8-XLSX报表设计器端到端验收清单-v2.1.0-rc.1.md`。

## v2.0 工作包功能

- **报表中心**：目标成本、实际成本、业主进度款、变更签证、业主应收、业主收退款、分供合同、分供应付八类 CSV。每次最多 10,000 行，服务端按项目权限重新查询；这不是原生 XLSX。
- **目标成本导入**：支持常见中英文表头自动映射与手动列映射、逐行校验、服务端预检，以及提交前二次预检。存在任何错误时禁止导入；父级需先于子级。当前其他财务台账不开放批量导入。
- **项目成员与权限**：项目内根据现有角色授权添加已启用账号、更新角色；API 做真实权限检查并记录审计，最后一个项目负责人不能被降级。
- **待办与预警**：根据可访问项目实时生成审批、凭证、逾期应收/应付、待结算、合同到期及目标成本超支任务；自动刷新，不保存已读状态。
- **本机草稿**：目标成本新建/编辑可选择恢复浏览器本机草稿，正式业务写入始终需要用户显式保存。此功能不是离线同步，不支持离线提交财务事务。

## Git 仓库

本项目已初始化 Git，默认分支为 `main`。解压普通源码 ZIP 后可查看提交说明；若需获得完整 Git 提交历史，请下载交付的 `.bundle` 文件并执行：

```powershell
git clone --branch main .\moheng-v2.3.0-rc.1.bundle moheng
cd moheng
git log --oneline --decorate -5
```

继续开发建议采用短分支 + Pull Request：`git switch -c feat/模块名称`、完成后运行静态候选检查与测试，再提交合并。不要将 `.env`、访问令牌、生产数据库备份或凭证附件提交到 Git。

## 图标、交互与动效规范

- UI 图标全部使用 `lucide-react`，其图形由内联 SVG 绘制；品牌标记也是项目内自绘 SVG。禁止把 emoji 当作图标。
- 导航栏可折叠，项目上下文可切换，顶部支持 `Ctrl/Cmd+K` 命令面板、键盘结果导航和快捷业务入口；表格行支持 J/K 与方向键巡检。
- 页面切换、按钮按压、卡片悬停、弹窗、快捷菜单、表单聚焦有对应交互动效。
- 遵循 `prefers-reduced-motion`，当用户系统偏好减少动态效果时降低动画。

## 核心脚本

```text
scripts/windows/prepare-windows.ps1       # 安装、构建、迁移、种子数据
scripts/windows/verify-release-candidate.ps1 # Node 24+ 发布门禁（类型检查/测试/构建/Prisma）
scripts/windows/start-windows.ps1         # 以当前用户启动 API，并轮询数据库健康检查
scripts/windows/stop-windows.ps1          # 校验进程身份后停止 API，防止 PID 复用误杀
scripts/windows/register-startup-task.ps1 # 注册系统开机任务（需管理员）
scripts/windows/unregister-startup-task.ps1
scripts/windows/run-api.ps1               # 任务计划程序调用的前台运行器
```

其他命令：`npm run validate:release-candidate`（串联原有业务回归契约、WP2–WP8 检查与审计覆盖源码检查）、`npm test`、`npm run build`、`npm run lint`、`npm run db:generate`、`npm run db:deploy`、`npm run db:seed`。

## 安全与验收提示

1. 不要把 `.env` 提交到版本库；修改 JWT 密钥和初始管理员密码。
2. 普通用户只能访问存在 `ProjectMember` 关系的项目；全局管理员可跨项目访问。
3. PostgreSQL 使用 `DECIMAL` 保存金额；前端展示数字不应取代正式财务对账。税额、含税口径、四舍五入与冲销机制需要在正式上线前进一步统一。
4. 刷新令牌仅保存 SHA-256 哈希，刷新时使用单条 SQL 原子消费，降低令牌重放风险。
5. 本轮已完成结算/应付与往来单位主数据、单位经营档案的源码增量实现及静态/独立逻辑检查；完整依赖安装、严格类型检查、浏览器端到端回归、Prisma/PostgreSQL 集成及 Windows 实机验收仍未完成。当前环境只有 Node.js 22（项目要求 24+），且 npm registry DNS 不可用，因此当前结果不能替代生产构建。应在 Node.js 24+ 的 Windows/CI 环境生成并提交 `package-lock.json` 后执行 WP8 验收。首次部署必须在 Node.js 24+ 的 Windows 测试机验证依赖安装、迁移、登录、令牌续期、用户授权、凭证上传/下载、A/B/C 生效规则、金额并发重算、备份恢复及关键金额流程。Windows 还必须给凭证目录配置专用 NTFS ACL。

## 文档

- [用户操作手册](docs/用户操作手册.md)
- [开发维护指南](docs/开发维护指南.md)
- [v2.0.0-rc.1 阶段验收记录](docs/阶段验收记录-v2.0.0-rc.1.md)
- [WP2–WP8 实施计划与状态](docs/WP2-WP8实施计划与状态-v2.0.0-rc.1.md)
- [WP8 Windows 与浏览器端到端验收清单](docs/WP8-Windows与浏览器端到端验收清单-v2.0.0-rc.1.md)
- [v1.9.0-rc.1 阶段验收记录（历史）](docs/阶段验收记录-v1.9.0-rc.1.md)
- [下一阶段开发计划与实施记录](docs/下一阶段开发计划与实施记录-v1.9.0-rc.1.md)
- [v1.8.0-rc.1 阶段验收记录（历史）](docs/阶段验收记录-v1.8.0-rc.1.md)
- [v1.7.0-rc.1 阶段验收记录（历史）](docs/阶段验收记录-v1.7.0-rc.1.md)
- [往来单位主数据与经营档案设计说明](docs/往来单位主数据与经营档案设计说明-v1.4.0-rc.1.md)
- [结算与应付账款模型设计说明 v1.4.0-rc.1](docs/结算与应付账款模型设计说明-v1.4.0-rc.1.md)
- [阶段验收记录 v1.4.0-rc.1](docs/阶段验收记录-v1.4.0-rc.1.md)
- [分供合同与成本归集设计说明](docs/分供合同与成本归集设计说明.md)
- [历史阶段验收记录 v1.3.0-rc.1](docs/阶段验收记录-v1.3.0-rc.1.md)


## v2.12.1-rc.1 缺陷复核说明

本版本逐条核验 39 项源码清单，修复确认缺陷；并非所有条目均被认定为真实缺陷。审计裁定及未改动项的技术理由见 `docs/源码缺陷审计与修复记录-v2.12.1-rc.1.md`。

## Clean install / Prisma / experimental PoC Gate

The root workspace requires a committed `package-lock.json` and uses `npm ci`. `npm run build` generates Prisma Client before TypeScript compilation, and API tests generate it when run independently. Run `npm run db:validate` against a shell with `DATABASE_URL` configured before deploying migrations.

`experiments/pi-durable-poc` is outside npm workspaces and has its own dependency lock requirement. Commit `experiments/pi-durable-poc/package-lock.json` before expecting the separate Pi Durable CI job to pass. See `docs/pi-durable-poc-lockfile-gate-v1.0.md`.
