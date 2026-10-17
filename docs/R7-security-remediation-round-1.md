# v2.19.0-rc.1 — R7 安全修复第一批

日期：2026-10-17
基线：`moheng-v2.19.0-rc.1-assistant-runtime-ci-gates.zip` + 已验收四缺陷补丁 + Gate-hardening 补丁 + 用户提供的 R1–R7 报告。
状态：**源代码修改已准备；需更新正式根 lock 并在 Node 24 环境重跑后，才可判定这些漏洞是否实际清除。R7 总体仍为 BLOCK。**

## 1. 本批范围

本批只处理四个报告中有明确修复目标的直接依赖、已知 preHandler 行为缺陷、安装脚本策略，以及 `buffers@0.1.1` 未声明许可的传递链。Prisma 6 → 7 是另一项有明显 breaking changes 的迁移，不混在这批快修里。

### 版本目标

| 包 | 原版本 | 第一批目标 | 目标理由 |
|---|---:|---:|---|
| `@fastify/jwt` | 9.1.0 | 10.2.4 | 报告中的 2 个 Critical 与相关 `fast-jwt` advisory 的修复目标；同时验证 Fastify 5 兼容性 |
| `@fastify/static` | 8.2.0 | 10.1.6 | 报告指定的高危路径/鉴权相关 advisory 修复目标；配合 Fastify 5 测试 |
| `fastify` | 5.5.0 | 5.12.7 | 报告指定的高危 body/header/host 处理修复目标 |
| `react-router-dom` | 6.30.1 | 6.30.6 | 报告指定的 open-redirect 修复版本 |

这些是 `package.json` 中的精确 pin。当前环境 DNS 无法访问 npm registry，因此本包没有生成或伪造新的根 `package-lock.json`；要判断实际修复版本是否已解析，必须在 Node.js 24 工作树中更新 lock、执行 `npm ci` 和 audit。R7 改动了依赖清单，原锁 SHA `F31A4B2E…` 是升级前证据；新锁 SHA 预期应变化，最终通过标准是新的锁文件在两次独立 clean install 中保持一致，而不是继续等于旧 SHA。

**React Router 的剩余中危项**：`react-router-dom@6.30.6` 是报告中 GHSA-jjmj-jmhj-qwj2 的修复版本，但截至本轮检索，另一个 advisory GHSA-wrjc-x8rr-h8h6 仍将 `react-router` `>=6.0.0,<7.18.0` 列为受影响，修复版本为 `7.18.0`。参考：[GHSA-wrjc-x8rr-h8h6](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6)。本批仍把 React Router 维持在 v6 来控制升级面，因此 **这不等于 Router advisories 全部清零**；最终 `npm audit` 必须记录剩余中危项，再另开 v7 迁移和兼容性测试任务，不能静默忽略。报告 R7 的 Critical/High 阻断目标与全量零漏洞目标要分别记录。

## 2. 已补充的运行时安全修复

- `authRequired` 六个拒绝分支现在显式 `reply.code(401).send(failure(...))`。`failure()` 自身只设置状态并生成普通对象；在 Fastify `preHandler` 中单纯 `return failure(...)` 不会终止后续 handler。
- `assistant-poc.ts` 和 `assistant-conversations.ts` 的关闭开关拒绝分支现在显式发送 404，避免 `ASSISTANT_POC_ENABLED=false` 时仍执行路由 handler。
- 系统管理第二个钩子先检查 `reply.sent`，再检查 `request.user` 是否存在，最后显式发送 USER 的 403，防止依赖异常路径挡住鉴权错误。
- 新增 API 回归测试：无 token 的受保护 handler 必须返回 401 且 handler 不执行；POC 开关关闭时 `/tools` 必须返回 `ROUTE_NOT_FOUND`，不得回显工具列表。

这些新测试已加入 API `test` 命令，但当前容器没有安装工作区依赖，**此处只通过了源码/配置静态检查，未声称新增 TypeScript 测试已运行通过**。用户报告中同类缺陷的实际 HTTP 回归证据可以保留，但仍需在应用本批代码后重跑一次。

## 3. 安装脚本策略

根 `package.json#allowScripts` 对用户报告逐项审查的 6 个包作出版本固定决策：

- 允许：`@prisma/client@6.19.3`、`@prisma/engines@6.19.3`、`@tailwindcss/oxide@4.1.13`、`esbuild@0.25.12`、`prisma@6.19.3`。
- 拒绝：`protobufjs@7.6.6`。报告的逐行检查结论是它只读取 `versionScheme` 并输出警告，不需要安装脚本权限。

未使用一次性全量 approve 命令。首次安装后还应执行 `npm install-scripts ls` 核对 npm 11 实际解析的 allowlist；依赖升级后若出现新脚本，必须先审查后再添加。

## 4. buffers 无许可传递链

报告给出的链为 `exceljs@4.4.0 → unzipper@0.10.14 → binary@0.3.0 → buffers@0.1.1`，其中 `buffers` 没有 `license` 字段。本批为 ExcelJS 子依赖增加精确 override，将 `unzipper` 解析到上游 `node-unzipper` 的 `0.12.3`（上游发行记录说明该系列已移除 `binary` 依赖）。这不自动等于合规 Gate 已通过：锁文件更新后必须确认 `npm ls unzipper binary buffers` 中不再出现 `binary`/`buffers`，并运行 XLSX 导入/导出测试。若 override 与 ExcelJS 有兼容性问题，应停止合并，不能强行保留 override。

## 5. Prisma 高危项明确留在下一批

报告将 Prisma 6.19.3 → 7.10.1 列为另一项 High 修复目标。Prisma 7 是 breaking upgrade：需要 `prisma.config.ts`、把 datasource URL 配置迁出 schema、采用新的 `prisma-client` 生成路径并调整导入，且 Prisma Client 初始化要配置 PostgreSQL driver adapter。当前 36 个 API 源文件导入 `@prisma/client`，必须进行独立的迁移与编译/数据库测试，不能只改两个版本号就记为修复。

本批仍保留 `prisma` / `@prisma/client` 6.19.3。**因此 R7 仍然 BLOCK，不得因为本批静态检查通过而宣称漏洞清零。** Prisma 迁移是下一项专门的源码任务。

## 6. 本地可运行验证与未执行项

已在本容器运行：

- `npm run validate:release-candidate`：退出码 0；
- 发布候选原始静态契约：77/77；
- `validate-r7-security-remediation.mjs`：16 项静态契约通过；
- 泄漏扫描器 Node 单测：5/5（纳入 RC 静态链）。

没有执行：根 `npm ci`、根 `npm audit`、完整 API 单测、Fastify HTTP 回归测试、XLSX runtime 测试或 PostgreSQL Gate。原因是本容器没有根 `package-lock.json`/`node_modules`，且 npm registry DNS 解析失败（`EAI_AGAIN registry.npmjs.org`）。

## 7. 应用本批后在 Node.js 24 的执行命令

先应用 patch，保留原工作树已验收的根锁文件。然后：

```powershell
# 1. 根据更新后的 package.json 生成候选 lock。必须审核 diff，不能直接无审查提交。
npm install --package-lock-only --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "package-lock generation failed" }
$lockSha1 = (Get-FileHash package-lock.json -Algorithm SHA256).Hash

# 2. 第一次干净安装并确认解析版本、安装脚本策略和生产依赖审计。
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "first npm ci failed" }
npm install-scripts ls
npm ls @fastify/jwt fast-jwt @fastify/static fastify react-router-dom exceljs unzipper binary buffers
npm audit --omit=dev
if ($LASTEXITCODE -ne 0) { throw "production dependency audit blocked; inspect the full advisory list" }
$lockAfter1 = (Get-FileHash package-lock.json -Algorithm SHA256).Hash
if ($lockSha1 -ne $lockAfter1) { throw "lock changed during first clean install" }

# 3. 第二次干净安装；npm ci 会清理并重建 node_modules。
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "second npm ci failed" }
$lockSha2 = (Get-FileHash package-lock.json -Algorithm SHA256).Hash
if ($lockSha1 -ne $lockSha2) { throw "lock SHA mismatch: $lockSha1 / $lockSha2" }

# 4. Build and tests run only after dependency resolution is proven.
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }
npm test
if ($LASTEXITCODE -ne 0) { throw "unit tests failed" }
npm run validate:release-candidate
if ($LASTEXITCODE -ne 0) { throw "release-candidate gate failed" }
```

另须运行真实 HTTP 的未认证/普通 USER/ADMIN、`ASSISTANT_POC_ENABLED=false`、XLSX 导入/导出、S1–S7 PG 恢复和 R3/R4 安全回归。此补丁不附带或伪造根锁文件；通过标准包括新 lock SHA 在两次 clean install 中一致，Critical=0、High=0、`buffers@0.1.1` 不在生产解析树、所有上述回归通过，并仍无安装脚本无差别批准。注意：目前仍预计 Prisma 6.19.3 对应的 Prisma 7 迁移会阻止 High 全清，本批不能记为 R7 完整通过。
