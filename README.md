# 筑衡｜施工单位成本管理系统

版本：MVP 1.5.0-rc.1 验证候选（Windows 原生部署优先）

本项目参考《施工单位成本管理系统完整设计方案 v1.0》。全局经营总览跨项目汇总；单项目业务统一通过项目工作台访问，工作台内保留主合同、目标成本、进度款、变更签证、分供合同与付款、实际成本和成本分析等独立页面。

> **v1.5.0-rc.1 更新**：新增业主侧竣工结算与应收账款；最终结算按累计确认金额减历史累计值过账差额，进度款核定形成应收，收款同时受应收单余额及主合同净应收敞口控制，退款反向恢复核销。分供合同与付款、结算与应付合并为同一工作台入口下的独立子视图；项目工作台顶部导航按业主收入侧与成本支出侧分区。新增数据库序列驱动的自动业务编号和登录“记住账号”，密码由浏览器/操作系统密码管理器管理，应用不保存明文密码。单位编辑弹窗调整为受约束的滚动区和固定操作区。完整验收情况见 `docs/阶段验收记录-v1.5.0-rc.1.md`。

> **实现边界**：当前交付仍是核心台账 MVP，并非完整的 30–40 页面系统。v1.4.0-rc.1 在 v1.3.0-rc.1 结算/应付模型之上新增统一往来单位主档、单位多业务角色、合同/成本关联、合同录入时的单位选择与快速建档、单位经营档案和按项目权限聚合。历史名称回填得到的单位身份默认为“待核验”；在信用代码、签约主体或其他可靠依据核对前，跨项目汇总只能作为待核对视图，不应直接当成最终财务对账依据。v1.3.0-rc.1 新增分供合同阶段/最终结算、结算外部确认与过账、独立应付单、付款核销关系、退款反向核销、预付款扣回、质保金留置/释放/核销和供应商发票登记/核验/应付来源分配。结算可采用纯金额模式，清单明细是可选补充信息，不是必填或必需的数据库依赖。已过账的最终结算以累计确认金额减历史过账金额产生差额，负向差额记为供应商待返还/抵扣，而不是伪装为负付款。付款、发票和结算均不自动生成/冲减实际成本。当前尚未实现正式材料入库/验收及退货、完整发票三单匹配、供应商信用抵扣自动核销、跨应收单自动抵销工作流、会计总账凭证与税务处理、材料库存/价格台账、对象存储、原生 XLSX 工作簿、报表队列、通知推送和 PWA 离线冲突解决；内部审批链仍为固定状态流。“执行中/完工待结算合同额”仅汇总相应状态下的合同当前金额，“合同额减已关联实际成本”仅为预警差额，不等于精确未履约承诺或预计成本。

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
Invoke-RestMethod http://localhost:3001/health
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

## 图标、交互与动效规范

- UI 图标全部使用 `lucide-react`，其图形由内联 SVG 绘制；品牌标记也是项目内自绘 SVG。禁止把 emoji 当作图标。
- 导航栏可折叠，项目上下文可切换，顶部支持 `Ctrl+K` 快捷搜索和快捷业务入口。
- 页面切换、按钮按压、卡片悬停、弹窗、快捷菜单、表单聚焦有对应交互动效。
- 遵循 `prefers-reduced-motion`，当用户系统偏好减少动态效果时降低动画。

## 核心脚本

```text
scripts/windows/prepare-windows.ps1       # 安装、构建、迁移、种子数据
scripts/windows/start-windows.ps1         # 以当前用户启动 API，并轮询数据库健康检查
scripts/windows/stop-windows.ps1          # 校验进程身份后停止 API，防止 PID 复用误杀
scripts/windows/register-startup-task.ps1 # 注册系统开机任务（需管理员）
scripts/windows/unregister-startup-task.ps1
scripts/windows/run-api.ps1               # 任务计划程序调用的前台运行器
```

其他命令：`npm run validate:release-candidate`（静态候选一致性检查，覆盖分供合同、可选明细结算、应付/付款核销、退款反向核销、质保金/预付款/发票、往来单位主档及单位经营档案、Windows 进程生命周期保护）、`npm test`、`npm run build`、`npm run lint`、`npm run db:generate`、`npm run db:deploy`、`npm run db:seed`。

## 安全与验收提示

1. 不要把 `.env` 提交到版本库；修改 JWT 密钥和初始管理员密码。
2. 普通用户只能访问存在 `ProjectMember` 关系的项目；全局管理员可跨项目访问。
3. PostgreSQL 使用 `DECIMAL` 保存金额；前端展示数字不应取代正式财务对账。税额、含税口径、四舍五入与冲销机制需要在正式上线前进一步统一。
4. 刷新令牌仅保存 SHA-256 哈希，刷新时使用单条 SQL 原子消费，降低令牌重放风险。
5. 本轮已完成结算/应付与往来单位主数据、单位经营档案的源码增量实现及静态/独立逻辑检查；尚未在本环境完成完整依赖安装、完整 TypeScript 类型检查、浏览器交互回归或 Windows 实机验收。最新检查结果以 `docs/阶段验收记录-v1.4.0-rc.1.md` 为准；由于当前环境缺少项目依赖且 Node 为 22（项目要求 Node 24+），这些检查不等同于完整构建或生产验收；当前候选包尚未包含 `package-lock.json`，应在可访问 npm registry 的 Node.js 24 环境中生成并复核依赖锁文件。首次部署必须在 Node.js 24+ 的 Windows 测试机验证依赖安装、迁移、登录、令牌续期、用户授权、凭证上传/下载、A/B/C 生效规则、金额并发重算、备份恢复及关键金额流程。Windows 还必须给凭证目录配置专用 NTFS ACL。

## 文档

- [用户操作手册 v1.4.0-rc.1](docs/用户操作手册-v1.4.0-rc.1.md)
- [开发维护指南 v1.4.0-rc.1](docs/开发维护指南-v1.4.0-rc.1.md)
- [往来单位主数据与经营档案设计说明](docs/往来单位主数据与经营档案设计说明-v1.4.0-rc.1.md)
- [结算与应付账款模型设计说明 v1.4.0-rc.1](docs/结算与应付账款模型设计说明-v1.4.0-rc.1.md)
- [阶段验收记录 v1.4.0-rc.1](docs/阶段验收记录-v1.4.0-rc.1.md)
- [分供合同与成本归集设计说明](docs/分供合同与成本归集设计说明.md)
- [历史阶段验收记录 v1.3.0-rc.1](docs/阶段验收记录-v1.3.0-rc.1.md)
