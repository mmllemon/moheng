## v2.19.0-rc.2 Prisma 7 security migration candidate（2026-10-17）

> **当前状态读取说明（2026-10-20）：** 本文件下方按原日期保存历史变更记录；较早条目中的“待合并”“环境限制”或“未完成”描述只代表当时的提交与执行环境，不自动代表当前主干状态。当前集成/缺陷/开发待办以 [产品范围与当前状态](docs/产品范围与当前状态.md) 和 [四阶段开发路线图](docs/后续四阶段开发路线图.md) 为准。

### 2026-10-20 增量开发（已合入 main，未正式发布）

- [PR #17](https://github.com/mmllemon/moheng/pull/17) 已合并项目上下文中的近 30 天 AI 用量摘要：按当前认证用户与授权项目聚合，区分活动任务、已结束运行以及 COMPLETE/PARTIAL/UNAVAILABLE 用量；只有完整且一致的供应商 token 元数据参与累计，不按字符数推算 token 或费用。
- [PR #18](https://github.com/mmllemon/moheng/pull/18) 已修复业主最终结算合法负差额被拒绝，以及未核验往来单位仅凭同名被自动关联的问题，并增加对应回归测试。
- [PR #19](https://github.com/mmllemon/moheng/pull/19) 更新核心经营链路审计记录，明确当前为开发阶段：历史台账核对、生产 Windows 权限/恢复演练和正式业务/审计签认是后续预投产/投产门禁，不是当前开发阻塞项。
- PR #17 与 #18 的精确头提交均通过 Assistant runtime 与 Prisma 7 migration 两组 GitHub Actions；PR #18 的两项修复也已包含于当前主干业务代码基线。主干该基线的 Assistant runtime workflow [run #39357880407](https://github.com/mmllemon/moheng/actions/runs/39357880407) 已成功。
- 根目录、API 与 Web 的包版本仍为 `2.19.0-rc.2`；上述变更已经集成到 `main`，但尚未升级 package version 或发布正式版本。自动化门禁通过不等于真实供应商 E2E、浏览器视觉验收或后续投产验收完成。

### v2.20.0 product completion — merged to main, not released

> Source integration status: merged to `main` on 2026-10-19 as commit `08696e5bc5fb106c10aae5b796616b25c159aa52`. This is **not a formal release**: package versions remain `2.19.0-rc.2`, no GitHub Release has been published, and production deployment has not been approved. Real deployment, historical-data reconciliation (if such data exists), and formal business/audit sign-off are later-stage gates after the relevant environment and materials exist, not current development prerequisites.

- Consolidated repository documentation into one current index and four-phase roadmap; archived the historical defect review and summarized old RC acceptance records rather than keeping repeated versioned design documents.
- Added styled `报表预览` overview sheets to both standard XLSX exports and Report Studio XLSX exports, including report scope, filters/template version, worksheet directory, row limit and truncation warnings.
- Added project/company report sources and default-template sections for downstream cash payments and refunds, separated from posted payables and actual costs; added exact-cent aggregation and truncated-data safeguards.
- Improved shared date/select control label targets and accessibility metadata; added static coverage for core business pages to prevent native date/select controls from returning.
- Added safe AI configuration-readiness diagnostics, bounded model-call defaults (1,800 tokens, 45-second timeout, one SDK retry), downstream cash-flow evidence in the read-only project overview, and `INDETERMINATE` cost variance when target-cost rows are truncated.
- Added/expanded XLSX, payment summary, AI configuration, cost-variance and runtime-policy tests.
- Fixed the built-in party report's `businessParty.id` field contract and added runtime validation of the PROJECT, COMPANY and PARTY default templates to the release-candidate gate.
- Consolidated system configuration and authorization governance into dedicated workbenches, including dictionary/parameter revision controls and the authorization review workbench; production acceptance remains subject to the documented RC gates. Current-head CI is required; this draft does not claim real-model E2E, real browser visual sign-off, sanitized user-staging reconciliation or production rollout approval.
- Fixed the default project report's lowercase `mainContract.amount` binding so it receives money formatting; added a release-gate regression test.
- Fixed report-preview decimal rounding for custom formats with arbitrary supported precision by using decimal-string arithmetic, and added coverage for carry, negative values, and precision beyond two places.
- Aligned report preview with common numeric Excel date formats (`yyyy-mm-dd`, `dd/mm/yyyy`, and Chinese literal patterns); locale-dependent month/day-name and time formats retain a predictable ISO-date fallback.
- Fixed report-export polling and manual result lookup to distinguish a pending job from a completed job whose artifact is missing/expired; terminal states now show actionable errors rather than a false "still processing" or success message.
- Made the report studio's 1,000,000-cell workbook safety limit a deterministic, non-retryable failure; preview returns an actionable limit message and queued exports report the same cause without wasting three worker attempts.

---

- 创建独立分支 `feat/v2.19.0-rc.2-prisma7`，从 `ceb0f335624209178e37e1279fb9c845d5f7b924` 开始；不改写 `main`，不自动合并。
- 将 `prisma` 与 `@prisma/client` 固定升级到 `7.10.1`，并增加同版本 `@prisma/adapter-pg`、`pg@8.23.1` 与 `@types/pg@8.23.1`。
- 切换 `prisma-client` 生成器，显式生成到 `apps/api/src/generated/prisma`，并将数据库连接 URL 移入 `apps/api/prisma.config.ts`。
- 迁移 API 源码中的 Prisma Client、类型与枚举导入；更新 Docker 构建为锁文件驱动的 `npm ci`，并纳入 Prisma 7 结构静态门禁。
- 此提交先由 GitHub Actions 在 Node 24 runner 重建根锁文件并校验 SHA；严格类型检查、构建、124 项 API 单测、完整 Release Candidate、隔离 PostgreSQL 迁移/恢复和 `npm audit` 结果均以实际运行日志为准。若生成客户端、类型或运行时 gate 失败，分支保留未完成状态并继续修复；R7 不自动转为 PASS。

## v2.19.0-rc.1 Gate hardening follow-up

- Root `build` generates Prisma Client before compiling API/Web; standalone API tests also generate Prisma Client.
- Add `db:validate` and run schema validation in the isolated PostgreSQL CI path. Update the orphan-run SQL and its static contract to use valid, consistently quoted target-table references.
- Use `npm ci` with committed lock files for the main workspace and the standalone Pi Durable PoC.
- Correct the UI-polish release-version assertion label to use the current package version rather than the stale v2.13.0 label.
- Align Pi Durable PoC `@langchain/core` with `langchain@1.5.18` and pin Vitest as a development dependency.
- Add separate CI coverage for Pi Durable SQLite/Vitest and isolated PostgreSQL conformance; the PoC job intentionally remains blocked until its independent lockfile is committed. Update admin-guard and report-path static assertions to match correct runtime behavior on Windows and POSIX.

## v2.19.0-rc.1（2026-10-17）

- 为 LangGraph 适配器增加仅通过代码依赖注入的模型、checkpointer 与只读工具 seam；不增加运行时环境开关，不允许 HTTP 请求启用测试 provider。
- 新增 fake chat model 成功走工具调用到最终回答的自动测试，断言回答来自工具结果。
- 助手持久化事件新增 payload 白名单与嵌套结构校验，禁止事件写入 prompt、回答正文、金额值、凭据或未知字段；`tool.completed` 仅允许固定白名单中的限制说明与字段级来源元数据，拒绝任意业务口径/正文。
- 新增日志/事件泄漏扫描器和负向测试，覆盖密钥格式、显式敏感标记、endpoint 值及事件 payload 结构；事件来源 scope 进一步约束为固定描述白名单。
- 新增隔离 PostgreSQL 恢复回归测试，固化六个 lease/取消场景，并测试宽限期内不误杀与宽限期后孤立 run 收敛；加入 fake provider 工具调用成功路径测试和 GitHub Actions CI Gate。
- 生产助手开关保持默认关闭；本版本仍为 RC，不构成生产批准。

## v2.18.0-rc.1（2026-10-17）

- 对齐 `langchain@1.5.18` 所需的 `@langchain/core@1.2.18` peer 版本，避免主 API workspace 安装被 ERESOLVE 阻断。
- 增加可选 `OPENAI_BASE_URL` 配置并通过 `ChatOpenAI.configuration.baseURL` 传递到模型客户端，支持采用 OpenAI-compatible API 的隔离测试端点；不改变工具白名单与只读权限边界。
- 从 `Project` 模型移除 5 个不存在合法反向关系的治理规则、备份运行和集成凭据关系字段；保留合法的 `systemParameterRevisions` 关系。
- 新增后台 worker 的孤立助手 run 收敛：运行至少 60 秒、且缺少有效匹配 `assistant.agent.run` queue job 的 `QUEUED/RUNNING` run 会终态化；尊重已提交的取消请求，持久化终态事件并为失败写入审计。
- SSE 失败后的 UI 状态回读以持久化 run 终态优先，并为孤立 run/worker lease 失败提供明确提示。
- 保留当前前端助手 SSE parser 的 6 项测试与全套静态发布验证。此 RC 的源码修复与用户上一轮独立 Gate 证据分开记录；用户本地完整构建、真实 PG 并发/取消/回放与浏览器 SSE 恢复结果未在当前容器独立复跑。**不批准生产启用。**

## v2.17.0-rc.1（2026-10-16）

- 将助手 SSE 事件块解析提取为无网络副作用的纯模块，并新增 6 项 Node 内置测试，覆盖事件信封、CRLF/多行 data、heartbeat、畸形 JSON、非法游标和数组 payload。
- 保持 `@assistant-ui/react` 外部存储运行时与墨衡现有 API/SSE 的解耦，不把 UI 适配器和 LangGraph checkpoint 协议混为一谈；助手仍默认关闭。
- 发布候选验证链新增 SSE parser 单测。当前执行环境仍只有 Node.js 22.16.0、且工作区依赖未安装，完整类型检查、构建、数据库和浏览器 E2E 仍受环境阻塞，不能把静态契约检查视为运行态通过。

## v2.16.0-rc.1（2026-10-16）

- 基于 `@assistant-ui/react` 建设成本工作台内的助手前端，使用 `useExternalStoreRuntime` 对接现有墨衡 REST/SSE，会话与执行状态仍由后端持久化 API 管理，不把 LangGraph 私有事件格式绑定到 UI。
- 新增 `/cost/assistant` 三栏工作台：当前项目会话列表/搜索/归档，消息时间线、快捷成本问题、Markdown/GFM 表格、取消与运行状态，以及工具来源实体/字段/行数/范围和限制说明。
- 入口仅在认证后的助手状态接口返回 enabled 时出现；路由本身仍检查开关。前端切换项目后不展示旧项目会话详情，会话列表由服务端按 projectId 收敛。
- 使用 `fetch` 读取持久化 SSE，携带现有 Authorization header，支持 refresh-session、`Last-Event-ID` 恢复与重复序号过滤；重新打开旧会话会重放最新运行的事件，恢复来源/限制面板。
- 精确固定 `@assistant-ui/react@0.15.29`、`@assistant-ui/react-markdown@0.14.23` 和 `remark-gfm@4.0.1`；从 `open-claude-ui` 只借鉴中文输入法与滚动交互模式，不引入其品牌素材或整套 Claude 外观。
- 修正会话列表非法查询分支缺少 Fastify `reply` 参数的问题；增加 `scripts/validate-assistant-ui.mjs` 并接入发布候选静态验证。
- **尚未通过完整运行态 Gate**：当前环境 Node.js 22.16.0、未安装工作区依赖，未完成 Node.js 24+ 全量类型检查/生产构建、真实 PostgreSQL 与浏览器 E2E。Assistant 仍默认关闭，不批准生产启用。

## v2.15.0-rc.1（2026-10-16）

- 基于 v2.14.0-rc.1 增量实现只读助手会话后端第一阶段：会话列表/新建/详情/归档、消息提交、运行状态、取消请求和持久化 SSE 事件回放接口；所有路由仍位于默认关闭的隐藏 PoC 模块下。
- 新增 `AssistantConversation`、`AssistantMessage`、`AssistantRun`、`AssistantRunEvent` 四个模型及追加式迁移；会话 owner 与 project 由服务端绑定，读取每次重新校验项目权限，跨用户会话按 404 处理。
- 消息请求使用 `requestId + requestHash` 幂等保护；同一会话通过事务行锁避免并发运行重叠，消息与 `assistant.agent.run` 后台任务在同一事务入队，任务 payload 不复制用户 prompt。
- 持久化运行事件使用单调递增的每 run 序号，SSE 支持 `Last-Event-ID`/`after` 重放、心跳及终态关闭；浏览器断开不会取消已提交任务，并拒绝超出当前事件序号的游标。取消、归档和关键运行状态有审计记录。
- 加固消息提交与归档并发、运行完成与取消并发：行锁后重新验证 ACTIVE 状态，完成/失败/取消使用条件状态迁移；已提交的取消请求不会被无条件完成写入覆盖。
- 新增独立 `apps/api/src/assistant/runtime/langgraph-adapter.ts`，把 LangGraph/provider SDK 与通用任务处理隔离；checkpoint schema 使用显式 setup 命令初始化，正常请求不执行 DDL。耗尽的 worker lease 会将对应助手 run 收敛为失败状态，避免 UI 永久停留 RUNNING。
- 将会话/API/SSE 静态契约检查接入 Release Candidate 验证链，并添加 runtime 依赖固定版本。尚未实现前端助手 UI；尚未在 Node.js 24+ 环境完成 TypeScript/build、Prisma Client 生成、真实 PostgreSQL 迁移/并发、SSE 浏览器重连、fake/真实模型 E2E 或恢复演练。仍为 RC，助手生产开关必须保持关闭。

## v2.14.0-rc.1（2026-10-16）

- 固化只读 AI 助手下一阶段运行时/存储决策：下一阶段以 LangGraph.js + PostgreSQL `PostgresSaver` 为集成候选，并明确不代表生产准入；Pi Durable + SQLite 的实验性 API 与单进程 storage owner 限制不作为长期默认存储。
- 将只读助手安全契约与 runtime/storage 决策一致性校验并入 Release Candidate 验证链；继续要求三工具白名单、逐次项目权限复核、失败/成功审计、无业务对象写操作及默认关闭。
- 新增助手运行时决策与下一阶段验收清单。会话 API、SSE 重连/取消、UI、真实模型端到端、备份恢复、提示注入及生产准入仍未完成。

- 新增显式账号数据范围 `ASSIGNED_PROJECTS` / `ALL_PROJECTS_READONLY`，默认所有既有账号继续仅能访问已分配项目；管理员可对普通账号授权跨项目只读，并触发会话撤销与审计。跨项目只读不授予写入、审批、外部确认、付款、成员管理或安全日志访问。已接入项目清单、经营总览、业务报表、报表工作室、往来单位经营档案及动态待办/预警的只读数据范围。
- 项目角色权限策略在服务端项目访问辅助层强制执行，仅可在代码声明的角色能力上限内收紧。内部工作流草稿/发布/历史回滚已接入变更签证状态转换；为避免发布无效配置，当前只允许 `CHANGE_INTERNAL_APPROVAL` 一个已接入的工作流代码，不宣称已有任意业务流程设计器。
- 新增 `CONTRACT_EXPIRY_WARNING_DAYS`（默认 30 天、范围 1–365）和 `TARGET_COST_OVERRUN_DANGER_PERCENT`（默认 0%、范围 0–100）两个业务可读数值参数消费点；仅已发布、`BUSINESS_READABLE`、类型与范围正确的参数生效，项目值覆盖全局值，无效值安全回退。
- PostgreSQL 业务数据库备份与 `pg_dumpall --globals-only` 全局角色/配置归档均使用 AES-256-GCM 加密、SHA-256 校验和密钥 ID 版本标记；下载仅提供加密归档。恢复演练在不同集群身份上验证并清理临时数据库。全局 SQL 仅执行解密/完整性检查，不会由演练自动在目标集群执行；灾备运维需受控人工恢复全局角色，并把它作为单独验收步骤。
- 集成凭据支持 HTTPS 连接探测和异步 JSON POST 投递，目标主机由 `INTEGRATION_ALLOWED_HOSTS` 显式允许名单控制，禁止重定向并检查 DNS 公网地址；投递使用稳定幂等键和既有后台任务重试。未实现特定 ERP/对象存储协议适配器与自动业务事件映射。
- 将登录范围变更设为强制撤销会话；修正两个报表后台任务的认证上下文 `sid`；添加跨项目只读和业务数值参数单测。巡检按钮保持透明背景，使用中性色 focus-visible 轮廓。
- 新增迁移 `20261016040000_system_security_workflow_integration`、`20261016050000_project_data_scope`。迁移仅增量追加。
- **仍为 RC**：当前 Node.js 22.16.0 且未安装工作区依赖；严格类型检查、生产构建、完整单测、Prisma 生成、PostgreSQL 迁移/并发测试、浏览器 E2E、备份恢复和 Windows 部署验收未通过或尚未执行。详见 `docs/产品范围与当前状态.md` 和 `docs/archive/阶段验收历史摘要.md`。

## v2.13.0-rc.1（2026-10-16）

- 精简主侧边导航：系统管理保留单一入口，账号、安全、权限治理、组织规则、字典、参数、运维和操作追溯移入横向滚动的二级导航；侧栏导航区独立滚动，底部账号区不再被长菜单挤出可视区域。
- 新增只读现行权限矩阵 API 和授权复核工作台：按生成时刻记录账号、项目成员角色、风险发现项，支持管理员提交复核说明，生成和复核均写审计；复核不会直接授予/撤销权限。
- 新增 `SystemAuthorizationReview` 表和追加式迁移 `20261016030000_system_authorization_reviews`。
- 字典分类、字典项、参数键按显示名称自动推荐稳定编码；用户开始手动编辑编码后不再被名称输入覆盖，服务端格式与唯一性校验保持权威。
- 数据质量巡检按钮改为低强调中性色操作，减少卡片右侧的视觉污染。
- RC Gate：需在 Node.js 24+ 与隔离 PostgreSQL 中执行严格类型检查、构建、迁移、权限/E2E 和恢复演练后才可考虑正式发布。

## v2.12.1-rc.1（2026-10-16）

- 复核用户提供的 39 项源码缺陷清单；逐条区分可复现缺陷、加固建议和误报，形成 `docs/源码缺陷审计与修复记录-v2.12.1-rc.1.md`。
- 修复系统治理页面部门/账号归属状态不同步、默认/运行中/已取消/失败状态文案和颜色、会话用户空值防御、字典表格可访问名称与选择守卫。
- 修复参数配置 API 的 params/body 错误详情、参数定义冲突查询、发布审计事实值、草稿创建事务内项目有效性复核、回滚说明静默截断；显式保护无项目范围查询的生效参数逻辑。参数值继续不写入审计快照。
- 运维增强：超时终止子进程树；备份元数据先退休再删文件，防止数据库指向不存在的备份；下载文件名校验统一；恢复前除 DNS/IP 检查外再核对 PostgreSQL system identifier，集群相同或标识不可验证时 fail-closed。
- 安全增强：新增独立 `LOGIN_ATTEMPT_HMAC_KEY`，公网模式要求它与 JWT/MFA 密钥分离，避免 JWT 密钥轮换同时重置登录限流桶；加强 MFA 加密段格式检查；强制改密加入 authVersion 乐观锁。
- 把刷新令牌签发热路径中的历史清理移入后台定期任务；后台任务状态回写失败增加独立日志；清理失败增加冷却，避免数据库故障期间每秒重复运行清理查询。
- 新增单测覆盖独立限流 HMAC key 与 JWT 轮换隔离、MFA 密文格式错误。
- **仍为 RC**：当前容器 Node.js 22.16.0 且无完整依赖；完整 TypeScript lint/build/test、Prisma 验证/生成、真实 PostgreSQL 迁移/并发、浏览器 E2E、Windows 进程树与备份恢复仍需在目标环境完成。恢复演练目标现在需要运维账号具备读取 `pg_control_system()` 的权限（通常授予只读 `pg_monitor`）。首次切换 `LOGIN_ATTEMPT_HMAC_KEY` 会改变已有登录限流桶 hash，部署时不要与 JWT 密钥轮换叠加。

## v2.12.0-rc.1（2026-10-16）

- 新增统一基础字典模型及管理页，支持内置/自定义分类、稳定编码、描述、条目排序、启停与软停用；新增付款方式、计量单位、资料分类和预警等级初始字典项。
- 新增版本化参数配置，支持字符串/数值/布尔/JSON，提供全局默认与项目级覆盖、草稿/发布/归档、发布人/时间、历史浏览与新版本回滚草稿；数据库约束保证同一键/范围最多一个已发布版本。
- 新增已认证的公共配置只读 API。字典只返回启用条目；参数只返回显式设置为 BUSINESS_READABLE 的已发布值，项目参数按项目成员权限收敛；管理员专用值不对普通业务用户开放，敏感键被拒绝或过滤。字典/参数维护、发布和回滚均写入审计摘要，审计中不复制参数原值。
- 新增迁移 `20261016020000_system_dictionaries_parameters`，接入系统管理导航和概览，并补充设计/验收文档与静态契约验证。
- 未自动将现有合同金额、变更签证、结算、付款/退款核销或核心状态机切换为动态参数/字典；每个消费方必须另行接入和验收。
- 仍为 RC：当前容器为 Node.js 22.16.0 且未安装工作区依赖；完整 Node.js 24+ 类型检查/构建/测试、Prisma 生成、PostgreSQL 迁移/事务和浏览器 E2E 尚待执行。

## v2.11.0-rc.1（2026-10-16）

- 系统管理新增组织部门、层级维护、用户部门/岗位归属；此功能不授予公司角色或项目角色。
- 新增 `GovernanceRuleVersion` 规则版本模型与草稿/发布工作流。已发布的 `CHANGE_APPROVAL` 规则由变更签证 API 服务端执行；没有发布版本时使用既有 OWNER/MANAGER 默认规则；禁止 ESTIMATOR/VIEWER 获得审批权，公司 ADMIN 也必须具有允许的项目成员角色且不得审批本人提交的业务。规则不影响外部确认金额生效。
- 新增系统状态、后台任务、存储容量和 PostgreSQL 运维工作台；数据库备份通过 `pg_dump` 生成、计算 SHA-256，下载前重验；恢复演练检查备份完整性并在独立地址的 `*_restore_test` 数据库执行 `pg_restore`，再校验 `User`、`Project`、`MainContract` 核心表。备份文件按保留期清理并保留审计元数据，至少保留最近两个成功备份文件。
- 新增集成凭据保险库，凭据采用 AES-256-GCM、上下文绑定和独立 `INTEGRATION_ENCRYPTION_KEY` 加密；支持元数据管理、启停与凭据轮换，API 与管理页均不回显密文解密后的真实值。尚未实现通用连接测试适配器。
- 新增只读数据质量巡检，覆盖项目主合同缺失、已审批变更金额缺失、外部确认资料不完整、超期金额差异复核、管理员安全待办、无部门账号和缺少集成凭据，并对每次巡检写入审计记录。
- 新增迁移 `20261016010000_system_management_expansion`，未重写或删除历史迁移。
- 真实 `pg_dump`/`pg_restore`、PostgreSQL 迁移/Client 生成、全量 TypeScript 构建、浏览器端到端与公网部署仍须在 Node.js 24+、真实目标环境中验证。本版本是候选版本，不宣称生产就绪。

## v2.10.0-rc.1（2026-10-15）

- 重组侧边导航为“经营中心 / 工作台 / 项目管理 / 系统管理”四个职责分组；经营总览、报表、待办与往来单位属于经营中心，成本工作台独立归入工作台。
- 项目档案与项目成员/角色统一归入项目管理；项目成员规范路由为 `/projects/members`，旧 `/system/members` 与 `/workspace/members` 保留兼容重定向。
- 系统管理页调整为真正的管理概览：显示账号、活跃会话、安全事件与待处理账号摘要，展示治理能力现状/验收差距和后续扩展路线；不再重复摆放项目档案和成员管理入口。
- 将操作追溯从经营中心迁入系统管理分组，并将页面入口限制为系统管理员；经营总览仍可看到当前账号权限范围内的最近操作摘要，普通成员不再看到越权的“查看全部”入口。
- 顶栏增加个人中心菜单；新增自主修改密码页面与 `POST /api/auth/password/change-self`，要求当前密码及至少 12 位新密码，MFA 已启用时还要求新的 TOTP/未使用恢复码；变更后撤销全部会话和刷新令牌并记录审计。
- 新增系统管理扩展路线：组织与权限治理、审批与规则配置、运维与灾备、数据治理与集成，并明确哪些是规划项而不是已实现功能。
- 公网异地访问仍须完成真实域名/DNS/TLS、反向代理、防火墙、Node.js 24+ 构建、Prisma 迁移和浏览器端到端验收；本版本不宣称已在公网环境正式上线。

## v2.9.0-rc.1（2026-10-15）

- 新增公网访问安全配置契约：只有配置 `PUBLIC_BASE_URL=https://...`、`NODE_ENV=production`、`COOKIE_SECURE=true` 和独立 `MFA_ENCRYPTION_KEY` 才进入公网模式；公网模式禁止启动 API 文档界面、启用 HSTS 与基础内容安全策略。
- 新增登录会话实体、会话即时吊销、刷新令牌单次消费与重放检测；旧版未消费刷新令牌会在首次刷新时迁移到会话模型，不在数据库迁移时批量失效。
- 新增登录失败按账号/IP 双维度限流桶、安全事件审计和 180 天安全事件清理策略；限流标识采用服务端密钥 HMAC，避免明文存储账号/IP 的计数键。
- 公网模式强制管理员首次登录进入 TOTP 多因素认证设置；恢复码仅生成时展示、数据库仅保存哈希；MFA 种子使用独立 32 字节 AES-256-GCM 密钥加密存储。
- 系统账号管理增加启停、密码重置、强制首次改密和 MFA 恢复；停用/改密/MFA 重置均撤销已有会话，并保护最后一个启用管理员账号。
- 系统管理工作台增加“登录安全中心”，支持查看登录事件、查看活跃会话与撤销非当前会话。
- 新增 Windows + Caddy HTTPS 反向代理示例与公网部署手册。API 仍绑定 `127.0.0.1`；公网仅开放 80/443，PostgreSQL 不对公网开放。
- 新增 TOTP、密钥加密和恢复码单元测试。当前环境为 Node.js 22，而项目要求 Node.js 24+ 且没有安装依赖，严格 TypeScript 构建、Prisma Client 生成、真实数据库迁移与浏览器 E2E 仍需在目标环境完成；此版本不得在这些验收完成前标记为生产就绪。

# 更新日志

## v2.8.0-rc.1（2026-10-15）

- 正式将原“项目工作台”命名为“成本工作台”，把前端布局组件命名为 `CostWorkspaceLayout`，内部规范路由切换为 `/cost/*`。
- 为旧 `/workspace/*` URL 增加集中兼容重定向，保留查询参数、哈希和路由状态；历史 `/workspace/members` 转至 `/system/members`，旧 `/settings/users` 转至 `/system/accounts`。旧版模块路由继续重定向到新的 `/cost/*` 路由。
- 将项目成员列表、项目角色分配统一放在“项目成员与权限”页面；“系统账号管理”页只负责公司级账号创建与列表，消除两个页面的职责重复。
- 新增“系统管理工作台”首页 `/system`，把项目档案、项目成员与权限、系统账号管理整理成独立入口；项目成员管理不再混在成本业务页签中。
- 公司级账号身份与项目内角色继续分离。项目负责人/项目经理在原授权范围内维护项目成员；系统账号创建仍仅限系统管理员；服务端权限校验和审计逻辑不变。
- 没有修改数据库 Schema、历史迁移、财务业务规则或 API 数据契约。完整 lint/build/test 和浏览器/Windows 实测仍需在项目要求的 Node.js 24+ 完整依赖环境完成。

## v2.7.0-rc.1（2026-10-15）

- 基于 `v2.6.0-rc.1` 增量修复报表预览返回流程。所有标准报表、旧版设计器和综合工作室预览入口传递安全返回目标；项目驾驶舱/往来单位快捷自动预览以 `replace` 替换一次性 `autoPreview=1` 路由，避免返回循环；直接打开/刷新预览时使用内部路径校验后的 `returnTo`，默认回报表中心。
- 检查全仓历史返回调用，原有不可靠的裸 `navigate(-1)` 仅保留在报表预览的统一处理函数中，并要求应用内路由显式标记来源可安全回退。
- 项目驾驶舱月度实际成本图扩大 Y 轴标签边距、启用 ECharts `containLabel`，并使用千分位/万/亿标签减少边缘遮挡。
- 项目工作台顶部仅保留视觉分组容器与分隔线，移除可见分组标题；无障碍分组标签保留。
- `report-studio-xlsx.ts` 将字体样式构造对象类型改为 `Partial<ExcelJS.Font>`。
- 新增 `scripts/validate-navigation-regressions.mjs` 并接入发布候选验证；静态导航/界面/XLSX 回归 10/10 通过。完整 lint、生产构建和浏览器实测仍受当前依赖/Node 环境限制，不能视为通过。


## v2.6.0-rc.1（2026-10-15）

- 直接基于 v2.5.0-rc.1 增量演进，未修改数据库 Schema、历史迁移、业务路由或财务口径。
- 精简报表中心：移除重复的三张介绍卡和 Hero 区；标准报表目录改成分类过滤+紧凑行列表，导出配置集中在同一面板，不再重复显示报表类型选择器。
- 项目级和公司级经营报表入口增加明确的“打开工作室”动作提示、箭头以及 hover/focus-visible 状态，遵循减少动效设置。
- 把“项目成员与权限”从成本/分供组移到独立项目管理分组。
- 修正侧栏“经营健康度”：它此前没有实际指标或计算逻辑，仅是静态装饰，不应产生健康评分已实现的误解；现在是可点击的“项目驾驶舱”入口。
- 新增 `scripts/validate-ui-polish.mjs` 并集成进发布候选检查；增加 v2.6 设计方案、验收记录和 WP11 清单。
- 仍为 RC：严格类型检查、生产构建和浏览器 E2E 需在 Node.js 24+、依赖完整的目标环境执行。

## v2.5.0-rc.1（2026-10-15）

- 在 `v2.4.0-rc.1` 基础上增量演进，保留既有业务状态机、金额计算模型和报表工作室旧模板；新增往来单位报表模板上下文迁移，不修改旧迁移。
- 修正报表预览表格的列宽策略：列宽按模板元数据进行有界自然宽度布局，少列宽屏不再拉伸最后一列；打印时保留独立适配规则。
- 报表中心改为业务场景导航：标准台账按成本/业主财务/分供分类浏览，并把项目综合报表、公司经营报告和单位经营档案作为一级入口。
- 在目标成本、实际成本、进度款、变更签证、分供合同/应付、业主应收/收退款、项目驾驶舱、主合同相关工作区与往来单位经营档案加入对应的预览/导出入口；单位档案同时可以打开已保存的单位专属模板编辑。统一复用报表预览链路。
- 增加 `PARTY` 报表域和 `businessPartyId` 模板上下文，往来单位经营档案提供默认报告模板，纳入单位摘要、项目、主合同、分供合同与独立成本；同一个模板不会隐式套用到另一个单位。
- 加强自动延伸区域约束：集合字段必须绑定到相同数据源和指定样板行；同一重复行的所有单元格从同一条记录读取；多集合区域独立展开；数据源排序增加稳定主键作为 tie-breaker。
- 财务单位相关的汇总以整数“分”精确累计，避免先转 JS `number` 后聚合；明细达到查询上限时，不用部分数据伪装完整总额。
- 新增报表预览列宽、模板匹配、默认单位模板、工作台入口和权限边界的静态契约/纯逻辑测试。
- 当前执行环境无法安装完整 Node.js 24+ 项目依赖，完整 `tsc`、生产构建、Prisma/PostgreSQL 集成、浏览器 E2E 及 Excel/WPS 实测仍是发布门禁。本版本保持 RC。详见 `docs/archive/阶段验收历史摘要.md`、`docs/报表中心规格与验收.md`。

## v2.4.0-rc.1（2026-10-15）

- 在 `v2.3.0-rc.1` 基础上增量演进，不重写既有合同、结算、应收应付、收付款与成本台账；未新增 Prisma migration，复用现有模板/版本和 PostgreSQL BackgroundJob 模型。
- 选择固定版本 `@univerjs/presets@1.0.4` 与 `@univerjs/preset-sheets-core@1.0.4` 作为浏览器单元格编辑界面；不引入 Univer Pro 包或转换服务。最终 XLSX 仍由既有 ExcelJS 生成，沿用 PostgreSQL 后台任务。
- 新增项目级/公司级报表工作室，支持多个白名单数据源、单元格绑定、单元格样式、独立单行重复区域自动扩展、多工作表以及模板保存/发布/版本控制。
- 新增综合报表数据源：项目档案、业主主合同、经营指标、分供合同、业主应收、收退款、实际成本、变更签证、进度款及分供应付；公司级只包括当前登录用户可访问项目，并在跨项目明细输出项目编号/名称。
- 增加标准台账与综合报表共用的正式预览页；预览可查看数据、模板版本、多个工作表、样式、截断警告，并支持打印/PDF 与确认后异步 XLSX。预览与后台导出保持模板定义一致，但导出执行时重新读取数据，尚不提供冻结业务数据快照。
- 将旧式报表设计器中的普通下拉及纯日期字段接入共享 `SelectField` 和 `DatePicker`。仓库扫描确认业务页面未再自建原生 `<select>` 或 `input type="date"`；共享控件内部保留原生代理，以兼容表单/辅助技术行为。
- 财务报告聚合以 BigInt 整数分计算；金额以十进制文本传入渲染器，超出 Excel 安全数值精度的金额按文本保留完整小数，避免 JavaScript 浮点数暗中舍入。超行数的来源不再产生看似完整的部分汇总。
- 新增 `scripts/validate-report-studio-v2.mjs`、报表动态区域/金额精度纯逻辑测试和 `docs/报表中心规格与验收.md`。
- 本轮静态候选契约、108 个 TS/TSX 源文件语法转译及 5 个报表渲染器纯逻辑测试通过；完整 TypeScript 类型检查、生产构建、Univer 浏览器实测、数据库集成、Excel/WPS 验证未能在当前环境执行。本版本仍为 RC，详见 `docs/archive/阶段验收历史摘要.md`。

## v2.3.0-rc.1（2026-10-15）

- 在 `v2.2.0-rc.1` 基础上增量演进，保留现有业务页面、API 主路径、XLSX 模板设计器与历史 Git 提交。
- 新增 PostgreSQL `BackgroundJob` 任务表及追加迁移 `20261015020000_postgresql_background_jobs`；用 `FOR UPDATE SKIP LOCKED` 实现并发安全领取、租约恢复、最大尝试次数、退避重试和 7 天结果文件保留。
- 新增 `report.xlsx.export` 任务 handler、版本化 payload、handler 注册表、幂等键/请求 hash、任务状态查询和安全下载端点；报表中心的 XLSX 导出改为后台生成，CSV 和原有同步 XLSX API 保留。
- worker 默认随 API 进程运行；新增独立 worker 入口与可选 Docker Compose `worker` profile，允许未来按负载分离进程而不改任务生产 API。
- 对用户提供的 TypeScript 构建缺陷进行根因修正：严格索引检查、正则/日期解构、遗漏导入、`number`/`bigint` 金额链、Prisma JSON/Decimal、ExcelJS PaperSize/Buffer 类型、React/Lucide/ref 和前端缺失类型等。
- 更新框架演进方案、验收记录、README、Windows/Docker 配置和静态候选检查。静态候选契约全通过；97 个 TS/TSX 文件语法转译无语法诊断；独立纯逻辑/存储路径测试 41/41 通过。
- 当前执行环境不能完成 Node.js 24+ 项目依赖安装，完整 `tsc`、build、Prisma Client 生成、真实 PostgreSQL 迁移和浏览器/Excel/WPS 实测仍是发布阻塞项。本版本保留 RC 标记，不等于生产验收通过。


## v2.2.0-rc.1（2026-10-15）

- 新增 `apps/api/src/platform/module-registry.ts`，统一挂载 15 组现有 Fastify 路由插件，并向外提供受控模块元数据目录；仍为模块化单体，不引入动态执行第三方插件的运行时机制。
- 新增 `GET /api/meta`，暴露产品/版本、API 主版本、基础路径、兼容策略和模块用途，供未来移动端与外部系统做能力发现。
- 新增 `/health/live` 与 `/health/ready`，分别检测进程存活和 PostgreSQL 就绪状态；保留 `/health` 就绪别名以兼容当前运维脚本。
- 所有 HTTP 响应附加 `x-request-id`，服务端错误日志包含请求 ID；对认证、Cookie、密码、刷新令牌和 API Secret 字段设置日志脱敏。
- 生产环境未设置 `CORS_ORIGIN` 时不再默认允许开发用 localhost:5173；开发环境保留本地 Vite Origin。
- 新增 `scripts/validate-architecture.mjs`，检查版本同步、模块路由登记、探针、API 元信息、追踪 ID、CORS 默认值、日志脱敏和无强制缓存/消息中间件依赖。
- 增加《框架演进方案 v2.2.0-rc.1》，明确模块边界、开放 API、连接器适配器、分阶段技术升级与 Gate B 生产验收要求。
- 不修改 Prisma Schema、已有数据库迁移和合同/结算/应收应付/付款退款的业务规则；不新增必需的运行时服务。
- 静态契约检查为 77/77、18/18、19/19、12/12、11/11。当前环境为 Node.js 22.16.0 且没有可复现的完整依赖安装，因此严格类型检查、构建、Prisma/PostgreSQL、Windows 浏览器 E2E 仍未通过/未执行；本版本保持 RC。


## v2.1.0-rc.1（2026-10-15）

- 八类台账报表新增服务端原生 XLSX 导出，保留 CSV；工作簿支持字段类型/格式、冻结窗格、自动筛选、打印纸张/方向、重复表头和导出说明工作表。
- 新增受控报表模板设计器：标题/副标题、列绑定/标签/顺序/显隐/宽度/对齐/格式、静态列、自定义版式行、合并/拆分、行高、打印参数、实时预览、XLSX/打印输出。
- 新增个人/项目/系统三种模板作用域、草稿/发布/归档、发布快照、乐观版本检查、版本历史恢复及审计。模板字段使用白名单，不支持任意 SQL、脚本或公式。
- 目标成本导入新增原生 XLSX 模板、结构/类型预检、表头映射、公式与不安全 ZIP 内容拒绝、行级服务端校验、提交前复核与单事务写入；原 CSV 流程保留。
- 新增 `20261015010000_report_template_designer` 数据库迁移和报表/工作簿测试源、静态报表工作台契约检查及 WP8 端到端验收清单。
- 增加 8 MB 文件、5,000 行输入、10,000 行报表与 ZIP 膨胀相关安全限制；财务台账不开放批量写入。
- 本版本仍为 RC。当前环境 Node.js 22.16.0 低于要求的 24+，依赖安装因网络超时未完成；完整类型检查、构建、真实 ExcelJS 往返、Prisma/PostgreSQL 迁移、Windows 浏览器 E2E 和 Excel/WPS 打开打印验收未通过/未执行。不得将本记录视为生产发布签字。

## v2.0.0-rc.1（2026-10-15）

- 新增八类台账 CSV 报表中心：目标成本、实际成本、进度款、变更签证、业主应收、业主到账/退款、分供合同、分供应付。每类导出由服务端按当前账号的项目访问范围重新查询，最多 10,000 条并提供截断响应头。
- 强化目标成本 CSV 导入：支持中英文表头自动匹配与手工字段映射；校验重复表头、重复映射、字段格式、重复编号、已存在编号与父子顺序；最终写入前再次预检，有错误即不允许提交。
- 新增项目成员与角色管理页面，支持按已注册邮箱添加成员、角色调整、审计写入与最后一名项目负责人保护；服务端仍是最终权限边界。
- 新增动态站内待办和预警，包括待处理变更、外部确认凭证、进度款审批、逾期应收/应付、分供结算、分供合同临期和超目标成本。它们是派生任务，不是持久化已读通知。
- 目标成本录入表单可保存/恢复当前浏览器本地草稿；正式提交仍需明确保存。本轮不实现财务离线写入。
- 增加 `validate-v2-work-packages.mjs` 并将候选检查串联原业务回归检查、工作包源码契约和 11 组审计覆盖源码检查。
- 不修改 Prisma Schema、数据库迁移、合同金额生效、结算过账、应收应付或退款冲销规则。
- WP8 的严格类型检查、production build、Prisma/PostgreSQL 集成、浏览器 E2E 与 Windows 实机验收尚未执行；当前仅为 RC 发布候选。

## v1.9.0-rc.1（2026-10-14）

- 新增全局“操作追溯”页面与 `GET /api/audit-logs` 只读查询接口，支持项目范围、业务对象、关键字和日期范围过滤及分页，展示操作者、项目、业务对象、操作类型、摘要与可展开的审计快照。
- 查询在服务端按当前用户的项目访问范围限域；管理员可查看全局单位档案日志。该界面只读，不更新或删除审计记录，不改变合同/财务状态机。
- 支持 UTF-8 BOM CSV 导出、标准 CSV 引号转义和电子表格公式注入中和；单次导出上限为最新 5,000 条匹配记录。
- 经营总览“最近操作”增加“查看全部”入口；补充开发路线图，将台账导出/导入预览、项目成员权限 UI、审计覆盖率补齐、站内通知、报表中心与离线录入按风险/依赖排期。
- 不新增数据库迁移、不修改既有 Prisma Schema、不改动合同生效、应收应付、结算和退款金额规则。
- 当前仍是发布候选。当前环境 Node.js 22，完整依赖安装、类型检查、生产构建、真实 PostgreSQL 权限联测和浏览器 E2E 尚未执行。

## v1.8.0-rc.1（2026-10-14）

- 将 UI 偏好设置从常驻条改为右上角独立浮层卡片，主题、密度、强调色、宽屏、减少动效与恢复默认归入一张分区清晰的设置面板，并带有平滑进出场过渡。
- 项目管理页不再展示冗余的顶部项目切换长条；改为项目组合摘要与经营信息卡片，展示有效合同额、目标成本、实际成本、累计回款、成本偏差、成本使用率、回款率与待跟进变更。指标来源于现有台账/经营总览快照，不凭空生成利润预测或工程物理进度。
- 新增主题统一的 `SelectField` 与 `DatePicker` 自绘控件。下拉选择器支持列表框语义、选项搜索、键盘选择、滚动跟随和表单注册代理；日期控件支持月份切换、方向键巡检、最小/最大日期约束、今天/清除/完成操作。
- 为设置卡片、下拉框、日期日历、命令面板、快捷操作、项目新建/编辑对话框与项目卡片补充受控的弹出、收回、悬停、回弹和入场错峰动效；减少动效模式压低或关闭动画。
- 未修改 API 业务逻辑、Prisma Schema、数据库迁移或财务算法；本轮为 React UI、通用表单控件、CSS 主题与文档改造。
- 当前为发布候选。完整类型检查、生产构建、浏览器端到端与 Windows 实机验收仍须在 Node.js 24+ 的完整依赖环境中执行。

## v1.7.0-rc.1（2026-10-14）

- 按 `design(1).md` 的 Pro-Tier Suite v4.2.0 规范重构墨衡前端风格，采用“专业生产力仪器”方向：克制中性色、细边框、柔和环境光、较高信息密度与受控动效，而非照搬示例中的金融业务内容。
- 新增四套材质主题：象牙雅白、香槟曜金、黑曜极光、冰川天青，支持跟随系统主题；强调色可跟随主题或切换靛青/青玉/朱砂。旧版存储的 `light`/`dark` 偏好兼容映射到象牙/黑曜主题。
- 将顶栏搜索升级为命令面板，支持 Ctrl/Cmd+K、输入过滤、↑/↓ 选择、Enter 跳转、Esc 关闭，并按业务页面/项目直达分组；保留常用业务快捷操作。
- 强化左侧 Pro 侧栏与顶部命令栏；调整导航宽度、选中态、项目上下文、卡片阴影、状态胶囊、输入焦点与按钮按压回弹；数据表使用低对比浮岛式行分隔与等宽数字。
- 增加全局表格键盘巡检：J/K 或方向键移动当前行，聚焦行后可按 Enter 触发行操作；保持输入框/选择框中的原生键盘行为。响应式布局、紧凑密度、宽屏和减少动效继续可用。
- 业务页面路由、API 接口、数据库模型及既有财务/结算规则未作功能性变更；本次为前端视觉与交互层改造。
- 当前为发布候选。静态检查可覆盖主题状态、命令面板和样式契约；实际浏览器外观、完整 TypeScript 构建和端到端键盘行为仍需在 Node.js 24+ 完整依赖环境中复核。

## v1.6.0-rc.1（2026-10-14）

- 产品名称由旧名称调整为两字古风品牌“墨衡”；统一更新登录页、侧栏 wordmark、页脚和浏览器标题，并绘制新的建筑/衡尺风格 SVG 标识，网站 favicon 使用 `apps/web/public/moheng-mark.svg`。
- 项目工作台顶部业务导航移除“业主侧·收入”“成本支出侧”文本标题；保留两组菜单容器，通过轻背景、间距、细分隔线和激活态区分业务区块，避免顶部文字标签造成拥挤。
- 重构业主“竣工结算与应收账款”页面：重点指标收敛为六张卡片；将竣工结算、应收账款、收退款流水、质保金与预付款分为四个交互页签，每次展示一个业务区；宽表采用独立限高滚动区与吸顶表头，加入平板/窄屏响应式布局，改善原页面所有表格连续堆叠、信息层级弱和横向拥挤的问题。
- 主导航下方新增 UI 偏好栏：浅色/深色/跟随系统主题、标准/紧凑密度、靛青/青玉/朱砂强调色、宽屏切换、减少动效及重置。偏好保存在当前浏览器，不影响共享业务数据；深色变量覆盖导航、面板、表格、表单、弹窗和应收页面。
- 增加了 SVG 品牌资源和 UI 偏好状态管理；更新 README、用户操作手册、开发维护指南和发布候选验收文档。
- 项目已初始化 Git 仓库，默认分支 `main`；导出源码 ZIP 与 Git bundle 两种交付，保留基线导入与本轮变更提交记录。Git 不包含 `.env`、数据库备份或受控附件。
- 本版本为发布候选。静态候选检查、独立纯逻辑测试和 TS/TSX 语法解析结果以 `docs/archive/阶段验收历史摘要.md` 为准。当前环境 Node.js 22.x，未安装项目完整依赖，尚未完成完整 `tsc`、前后端 production build、Prisma 校验/生成、真实 PostgreSQL 迁移与 Windows 浏览器 E2E；不应视为生产验收通过。

## v1.5.0-rc.1（2026-10-14）

- 修复往来单位资料编辑弹窗布局：编辑表单内部滚动，底部保存/取消操作区保持可见，避免长表单挤出视口。
- 新增业主侧竣工结算与应收账款模型：最终累计结算只过账与历史已确认累计的差额，支持正负调整、应收分期、到账/退款核销、业主预付款、质保金释放与进度款应收回填。清单明细仍为可选。
- 增加业主到账校验：普通到账不超过选定应收单余额和主合同净应收敞口；最终结算过账后，旧进度款到账入口关闭，统一走应收台账。退款保留原始与反向流水，并同步负向进度款到账明细。
- 将“分供合同与付款”和“结算与应付”合并到“分供合同与结算”工作台入口，内部保留合同台账/付款与结算/应付两个子视图；项目工作台导航按“业主侧·收入”和“成本支出侧”分组。
- 使用数据库序列表按项目、业务类型、年份自动生成可读编号；内部 ID 作为稳定关联键，合同号继续允许手工输入以适配纸面合同和外部归档号。
- 登录页面增加“记住账号”；密码只依赖浏览器/操作系统密码管理器进行保存与自动填充，应用不在 localStorage 明文保存密码。
- 新增 `20261014030000_owner_settlement_receivables_document_sequence` 迁移；不修改旧迁移。增加最终结算差额、合同净应收敞口及应收状态的纯逻辑测试。
- 本版本为发布候选。静态检查、源文件语法解析和纯逻辑测试已执行；由于当前环境 Node.js 22.x 且未完成依赖安装，尚未完成 Node.js 24+ 完整类型检查/构建、Prisma 校验/生成、真实 PostgreSQL 迁移和 Windows 浏览器端到端验收。详见 `docs/archive/阶段验收历史摘要.md`。

## v1.4.0-rc.1（2026-10-14）

- 新增统一“往来单位库”，使用 `BusinessParty` 主档管理建设单位、材料供应商、劳务/专业分包、租赁单位、服务商及其他单位；同一法律主体可以具有多个角色，不再为每类单位建立互不关联的独立库。
- 项目建设单位、业主主合同相对方、分供合同相对方和独立成本记录增加可空单位 ID 关联。原有文本名称字段保留为历史快照，单位更名不会覆盖旧合同名称。
- 合同登记支持检索选择既有单位、自动带出已维护资料，并可在合同提交时按单位名称复用或快速建档；出现同名多主体时拒绝模糊匹配。确认“同名不同法律主体”建档需管理员、独立统一社会信用代码和明确确认。
- 新增“单位经营档案”，按当前用户可访问的项目范围汇总关联项目、主合同、分供合同、结算、应付未付、付款/退款净额、发票和实际成本摘要；合同、项目及成本处的单位名称可进入单位档案。
- 新增单位身份核验标记、历史名称、单位角色、状态和审计日志；统一社会信用代码全局唯一。历史文本数据按规范化名称回填关联，但档案默认未核验并显示警示，要求复核主体身份后再将跨项目汇总用于对账。
- 沿用 v1.3.0-rc.1 的结算/应付模型，结算清单明细仍是可选项；没有合同/预算清单时可纯金额完成结算，清单明细不是必要的数据支撑。
- 新增迁移 `20261014020000_business_party_master`，不修改旧迁移；将往来单位身份、合同关联、权限范围、重复名称、可选清单以及结算/应付流程加入发布候选检查和纯逻辑测试。
- 本版本仍为发布候选，并非生产验收通过。已执行 54/54 静态候选检查、53/53 纯逻辑测试和 59 个 TS/TSX 文件语法解析；未完成 Node.js 24+ 完整依赖安装/类型检查/构建、Prisma schema 校验、真实 PostgreSQL 迁移及 Windows 浏览器端到端验收。历史单位的名称匹配可能包含主体不确定关系，单位页会提示待核验；正式上线前需完成身份复核与数据库联测，见 `docs/archive/阶段验收历史摘要.md`。

## v1.3.0-rc.1（2026-10-14）

- 新增“结算与应付”项目工作台页面；分供合同结算支持阶段结算、最终累计结算及正负调整单，内部审批、外部对方确认、正式过账分离，并保留确认凭证和审计轨迹。
- **结算清单项为可选数据**：可以纯金额方式创建、审核、确认和过账结算；有明细时再核对明细合计，不要求关联目标成本清单或合同清单。未提供清单不得阻止合同结算。
- 最终结算按“最终累计确认金额减历史已过账累计金额”只过账差额，防止阶段结算金额与最终累计金额重复累计。负向结算调整生成供应商待返还/抵扣余额，不会伪装成负数现金付款。
- 结算过账生成独立应付单；普通付款须分配到已过账应付余额，退款自动反向恢复原付款的应付核销。应付余额、预付款余额、质保金余额、供应商待返还/抵扣和付款现金流分别展示。
- 新增预付款扣回、质保金留置/释放/核销、供应商发票登记/核验/对应付来源分配；均与实际成本分开，付款和发票不自动生成或冲减实际成本。
- 新增 PostgreSQL 迁移 `20261014010000_settlement_payables_invoice_retention`；已交付旧迁移未修改。新版本 API、前端页签、静态候选检查和纯函数金额测试纳入回归覆盖。
- 这是发布候选版本，不代表财务上线认证。当前环境可执行静态候选检查、TypeScript 语法转译与独立纯逻辑测试；未完成 Node.js 24+ 完整依赖安装、Prisma Client 生成/校验、完整类型检查与前后端构建、真实 PostgreSQL 迁移和 Windows 浏览器端到端验收。见 `docs/archive/阶段验收历史摘要.md`。

## v1.2.4-rc.1（2026-10-14）

- 主合同页面从常驻大表单调整为紧凑概览：默认展示合同基准、当前有效合同额、已生效调整净额及关键条款；新建/编辑资料在对话框中完成，原始合同金额建档后仍锁定。
- 新增“项目工作台”统一入口，通过共享页签访问项目驾驶舱、业主主合同、预算与目标成本、进度款、变更签证、分供合同与付款、实际成本及成本分析；旧 URL 保留重定向兼容。
- 将“经营总览”修正为真正的跨项目视图：移除依赖当前选中项目的月度成本分析；增加项目级目标成本、实际成本、成本偏差、业主回款和回款/合同额指标；服务端按项目分组汇总。
- 新增独立的“项目驾驶舱”，展示所选项目的核心指标、业务待跟进事项和各模块入口。项目驾驶舱与成本分析分离，前者是工作总览，后者是分析报表。
- 分供合同页面名称更改为“分供合同台账”，“已结算”界面状态更精确地命名为“结算已确认”。结算确认不再禁止登记尚未支付的结算款/质保金支付或退款；新付款计划与补充协议仍受状态限制。
- 当前支付上限仍按合同当前金额校验，未引入独立的最终结算额/应付账款表；该项作为后续财务模型单独建设，避免暗示已经具备正式结算应付控制。
- 新增项目工作台、跨项目/单项目范围、主合同表单交互及结算后付款规则的静态候选检查。当前可执行检查：34 项独立测试、47 个 TS/TSX 语法解析、34 项候选静态检查通过；尚未完成完整依赖安装、类型检查/构建及真实 Windows 浏览器交互验收。

## v1.2.3-rc.1（2026-10-14）

- 新增分供合同台账：包括采购、劳务/专业分包、机械租赁、服务等合同登记、草稿/执行/完工待结算/已结算/终止状态、已生效补充协议追加记录。
- 新增分供合同付款计划与实际付款台账；付款/退款按现金流分开记录。退款必须关联同一合同下的原始非退款付款、继承其付款计划，并阻止累计退款超过原付款金额。
- 实际成本新增可选分供合同关联，旧成本支持依据发票/验收/结算依据人工补关联并写审计；付款或退款都不会自动创建/冲减实际成本。
- 业主进度款申报和变更签证新增主合同外键；旧记录按当前项目已有主合同回填，主合同补建时只补齐空关系并记录审计。
- 校正成本分析术语：把执行中/完工待结算合同当前金额合计与“未履约承诺”分开，不再将合同额减已关联实际成本的算术差额标成准确承诺余额或预计成本。
- 新增合同与成本归集设计说明、迁移说明、API 和操作维护文档；原有已发布迁移文件保持不变，新增第六个迁移 `20261013050000_downstream_contract_management`。
- 当前环境中 33 项独立测试通过、45 个 TS/TSX 文件语法转译检查通过、28 项静态候选一致性检查通过。未完成完整依赖安装、`tsc` 类型检查、Prisma 生成/验证、真实 PostgreSQL 迁移或 Windows 端到端构建验收；候选包尚无 `package-lock.json`。详见 `docs/archive/阶段验收历史摘要.md`。

## v1.2.2-rc.4（2026-10-14）

- 加固 Windows 原生启动/停止脚本：启动时将绝对 API 入口路径传给 Node.js；PID 文件指向已存在但无法匹配本项目的进程时拒绝继续，不会因为 PID 复用将它当成本系统实例。
- 停止脚本通过 Windows 进程命令行核验 `node.exe` 与本项目绝对 `server.js` 路径，并核对 CIM 与已打开进程句柄的启动时间后，才通过已验证的进程句柄结束进程；身份不匹配时保留 PID 文件并中止，避免因 PID 复用误杀其他应用。
- 启动脚本不再仅凭进程存活就报告成功，而是在 20 秒有界窗口内轮询 `/health`，要求 API 与 PostgreSQL 均健康，否则停止本次启动的进程、清理本次 PID 文件并报错。
- 扩展 `validate:release-candidate`，加入 Windows 启停脚本的身份核验、健康检查与版本一致性静态检查。
- 本轮在临时目录以全局 TypeScript 转译包内三组测试后，使用 Node.js 测试运行器实跑 18/18 项通过；41 个 TS/TSX/TypeScript 脚本文件语法转译检查通过，候选一致性检查 16/16 项通过。
- 未完成 Windows PowerShell 实机运行、Node.js 24+ 完整依赖构建、Prisma 生成/迁移或 PostgreSQL 集成验收；npm registry 连通性检查在 18 秒内超时。当前候选包也未包含 `package-lock.json`，正式构建前需生成并复核依赖锁文件。

## v1.2.2-rc.3（2026-10-13）

- 保存金额差异复核触发时的内部参考金额与外部确认金额快照，避免后续内部金额变化时把原差异显示成另一组数字。
- 将旧数据库基准重建作为全新迁移，保持已交付的 `20261013020000_contract_change_external_confirmation` 迁移文件不变。
- 基准重建优先读取正式主合同台账金额；在更改项目基准/有效金额前保存迁移前后差异台账，并对负数或超出数据库金额范围的结果中止迁移。
- 对历史已生效但外部确认金额与内部参考金额不一致的记录自动标记待复核；不改写其外部确认金额或生效状态。
- 增加发布候选静态迁移一致性检查。18 项纯函数/凭证存储测试与 39 个 TS/TSX 语法转译检查通过。
- 未声称完整构建或发布验收通过：当前环境 Node.js 22，依赖安装受 registry DNS (`EAI_AGAIN`) 阻塞，未完成 Node.js 24+ 完整构建、Prisma 生成、PostgreSQL 迁移和 Windows 实机流程验收。

## v1.2.2-rc.2（2026-10-13）

- 锁定正式主合同归档后的原始合同金额，项目资料编辑与主合同接口共同执行同一策略。
- 将旧数据库原始合同金额 reconciliation 移入独立的新迁移，不篡改已发布版本迁移；优先以正式主合同台账金额重建基准和当前有效合同额，并保存迁移前后金额差异记录。
- 对核验驳回和争议状态开放“补充材料/重新提交”路径；重提时清空旧核验结论，并将旧结论留在审计记录中；已经生效的外部确认仍不可直接覆盖。

## v1.2.2-rc.1（2026-10-13）

- 锁定已建档正式主合同或已有外部确认记录后的原始合同金额，合同增减应通过变更签证登记，不得覆盖原始基准。
- API 项目编辑和主合同保存流程在事务中锁定项目行，防止与外部确认并发修改合同基准。
- 仅在尚未建立正式主合同且没有外部确认记录的初始建档阶段允许修正原始金额。
- 项目页和主合同页对已锁定的原始金额提供只读提示；API 同时执行服务端校验。
- 新增原始合同金额锁定策略测试。

## 1.2.1 — 发布前验证候选修订

- 修复凭证上传文件名与 MIME 类型不一致的边界：即便内容声明为 PDF，也拒绝使用 `.exe` 等不受支持扩展名，避免下载时出现误导性的可执行文件名。
- 增加对应回归测试；金额计算与凭证存储独立测试共 11 项通过。
- 完成 39 个 TS/TSX 文件的语法转译检查。
- 本修订仍未完成真实依赖安装、完整类型检查/打包、PostgreSQL 迁移和 Windows 端到端验收；详见 `docs/archive/阶段验收历史摘要.md`。

## 1.2.0 — 外部确认与凭证核验

- 将原始合同金额与当前有效合同额分开保存；有效合同额按原始金额加已生效外部调整净额重算，减少项以负数计入。
- 将变更公司内部状态与外部确认生效状态分离；内部审批金额不再单独改变有效合同额，也不覆盖外部确认金额。
- 增加 A/B/C 外部凭证类别、外部确认人身份/授权、确认时间、金额、范围、凭证定位、原始上下文和凭证文件记录。
- C 类凭证进入待独立核验状态；创建人或提交人不得自核验，核验通过后立即生效，不需要再次审批金额。
- 为凭证文件增加受限本地存储、SHA-256 完整性校验、文件类型/签名检查、大小限制和下载审计。
- 增加系统管理员账号创建与项目角色分配界面，为提交人与核验人职责分离提供账号基础。
- 增加有效合同额整数分计算测试，并阻止负数有效合同额、超出 `DECIMAL(18,2)` 上限和静默舍入；按项目串行化外部确认指纹检查，阻止同一文件重复附加及高度一致的确认信息重复登记。
- 增加数据库迁移、操作手册、维护指南及部署注意事项。

### 已知限制

- 本版本仍为核心台账 MVP；公司审批链仍是固定状态流，没有公司级可配置审批流。
- 当前环境未完成依赖安装、完整 TypeScript 构建、数据库迁移或 Windows 端到端验证。发布前必须在 Node.js 24+ 的 Windows 测试环境执行安装、构建、迁移和关键流程验收。
- 凭证病毒扫描、独立对象存储/不可变归档、自助密码重置与账号停用界面暂未实现。Windows 部署应自行配置凭证目录的 NTFS ACL。
- 旧版本记录没有外部凭证数据，因此不会把旧内部审批状态自动视为外部确认生效；升级前应核对历史项目合同额并为确需计入的历史变更登记有效外部凭证。
