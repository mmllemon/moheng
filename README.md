# 墨衡｜施工单位成本管理系统

版本：MVP 2.4.0-rc.1 验证候选（Windows 原生部署优先）

本项目参考《施工单位成本管理系统完整设计方案 v1.0》。全局经营总览跨项目汇总；单项目业务统一通过项目工作台访问，工作台内保留业主主合同、目标成本、进度款、变更签证、竣工结算与应收、分供合同与结算、实际成本和成本分析等独立业务页面。

> **v2.4.0-rc.1 报表中心演进**：在 v2.3.0-rc.1 基础上增量建设项目级/公司级报表工作室。前端固定引用开源 Univer Sheets Core 1.0.4 作为单元格编辑界面；业务字段绑定、多个重复数据区域自动延伸、数据权限、精确金额汇总与最终 XLSX 仍由墨衡自身的受控数据源/渲染器负责，不依赖 Univer Pro XLSX 转换服务。标准台账 XLSX 与综合报告 XLSX 均经过正式预览页面确认；旧报表设计器和业务页面统一使用共享下拉与日期控件。公司级只汇总当前用户可访问的项目；超出数据源行数限制时相关汇总不可用并显示警告，不把部分数据冒充完整财务总额。**本版本仍为 RC**：npm registry 在开发环境不可达，未完成 Univer 浏览器实测、完整严格 TypeScript/build、Prisma/数据库联测及 Excel/WPS E2E。详见 `docs/报表中心与报表工作室设计方案-v2.4.0-rc.1.md`、`docs/阶段验收记录-v2.4.0-rc.1.md` 与 `docs/WP9-报表工作室端到端验收清单-v2.4.0-rc.1.md`。

> **v2.0.0-rc.1 历史更新**：继续推进 WP2–WP8。新增八类权限过滤的 CSV 台账报表、目标成本 CSV 列映射/服务端预检/确认前复检、本机未提交草稿、项目成员与角色管理页面，以及基于当前台账动态生成的待办与预警。新增静态候选检查和审计覆盖源码契约检查。没有改动既有财务状态机、结算/应收应付金额口径或 Prisma Schema/migrations。WP8 的严格类型检查、生产构建、PostgreSQL 与浏览器 E2E、Windows 实机部署仍需在 Node.js 24+ 环境完成，详见 `docs/阶段验收记录-v2.0.0-rc.1.md` 与 `docs/WP2-WP8实施计划与状态-v2.0.0-rc.1.md`。

> **v1.9.0-rc.1 更新**：依据《施工单位成本管理系统完整设计方案 v1.0》做差距驱动的增量开发：新增“操作追溯”只读页面与权限受限查询 API，支持按项目、业务对象、关键字、日期范围检索，展开变更快照并导出防公式注入的 CSV；经营总览增加“查看全部操作”入口。未修改 Prisma Schema/数据库迁移及合同、结算、应收应付金额规则。下一阶段计划与未实现能力边界见 `docs/下一阶段开发计划与实施记录-v1.9.0-rc.1.md`，验收记录见 `docs/阶段验收记录-v1.9.0-rc.1.md`。

> **v1.8.0-rc.1 更新**：在 v1.7 Pro-Tier 视觉系统上继续完成交互层重构：UI 设置入口改为右上角独立浮层卡片，项目管理页隐藏冗余的顶部项目选择长条并将项目卡片升级为经营摘要；下拉选择器与日期日历改为项目内绘制的统一主题浮层，支持键盘操作、搜索、日期边界、今天/清除及确认；设置卡片、命令面板、快捷菜单、项目表单和控件弹层补齐弹出/收回过渡，尊重减少动效偏好。业务 API、数据模型、财务计算口径不因 UI 调整而改写。最新 UI 验收见 `docs/阶段验收记录-v1.8.0-rc.1.md`。

> **实现边界**：当前交付仍是核心台账 MVP，并非完整的 30–40 页面系统。v2.1 新增原生 XLSX 与基础模板设计器，v2.3 新增 PostgreSQL 后台导出任务，v2.4 增加项目/公司级单元格绑定报表工作室（验证候选）；本版本仍需完成完整环境验收。v1.4.0-rc.1 在 v1.3.0-rc.1 结算/应付模型之上新增统一往来单位主档、单位多业务角色、合同/成本关联、合同录入时的单位选择与快速建档、单位经营档案和按项目权限聚合。历史名称回填得到的单位身份默认为“待核验”；在信用代码、签约主体或其他可靠依据核对前，跨项目汇总只能作为待核对视图，不应直接当成最终财务对账依据。v1.3.0-rc.1 新增分供合同阶段/最终结算、结算外部确认与过账、独立应付单、付款核销关系、退款反向核销、预付款扣回、质保金留置/释放/核销和供应商发票登记/核验/应付来源分配。结算可采用纯金额模式，清单明细是可选补充信息，不是必填或必需的数据库依赖。已过账的最终结算以累计确认金额减历史过账金额产生差额，负向差额记为供应商待返还/抵扣，而不是伪装为负付款。付款、发票和结算均不自动生成/冲减实际成本。当前尚未实现正式材料入库/验收及退货、完整发票三单匹配、供应商信用抵扣自动核销、跨应收单自动抵销工作流、会计总账凭证与税务处理、材料库存/价格台账、对象存储、通知推送和 PWA 离线冲突解决；原生 XLSX 模板与 PostgreSQL 异步报表队列已在 v2.3.0-rc.1 加入，但仍待完整环境验收。内部审批链仍为固定状态流。“执行中/完工待结算合同额”仅汇总相应状态下的合同当前金额，“合同额减已关联实际成本”仅为预警差额，不等于精确未履约承诺或预计成本。

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

- 新增统一 API 模块注册表，现有 15 组路由插件由 `apps/api/src/platform/module-registry.ts` 统一挂载。
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
