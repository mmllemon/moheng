# R7 安全修复第一批 — Node 24 实测报告

执行时间：2026-10-17
环境：Windows 10.0.26200 / Node v24.18.0 / npm 11.16.0 / PostgreSQL 16.15
基线 commit：`ff3bae6`
补丁来源：`moheng-v2.19.0-rc.1-r7-security-remediation-round1.zip`
补丁 SHA-256 自校验：`7bb00dccc7e26f9c896beb213647b02657dd6cdb0231ff8f5a613d617f8e1312`（与 sidecar 一致）

## 结论

**Critical 已清零（2 → 0）。High 从 8 降到 4。R7 仍为 BLOCK。**

补丁自身的静态契约全部通过，但它在三个地方与现实不符，已在本轮修正：

1. 5 个源文件与本地已修复版本逐字相同，`git apply --check` 失败（预期，不是缺陷）
2. `overrides` 写法在特定条件下不生效，需要清 `node_modules` 才能重算
3. `@fastify/jwt` 9→10 引入 `setErrorHandler` 类型收紧，导致 build 失败

## lock SHA

```
升级前  F31A4B2EB8325F3C4A85AC0CEB991896FAC79F8DEE70ABEA580E4A7BE4B92ADB
升级后  0175BF7F48D0D184D61A52B9C25510CDDF306C4579ACC62997CD756435ABA206
```

两次 `npm ci` 后 SHA 一致。旧 SHA 是升级前证据，不应期待保持相同（补丁文档已说明）。

POC 子项目 lock 不受影响，仍为 `8A908DA864C5EFF3FF846A2F33358822501FB00960C6F3678EEB9F9D6DCB5574`。

## 依赖版本落地

| 包 | 升级前 | 升级后 | 目标 | 状态 |
|---|---:|---:|---:|---|
| `@fastify/jwt` | 9.1.0 | **10.2.4** | 10.2.4 | 达成 |
| `fast-jwt`（传递） | 5.0.6 | **6.3.5** | — | 达成 |
| `@fastify/static` | 8.2.0 | **10.1.6** | 10.1.6 | 达成 |
| `fastify` | 5.5.0 | **5.12.7** | 5.12.7 | 达成 |
| `react-router-dom` | 6.30.1 | **6.30.6** | 6.30.6 | 达成 |
| `unzipper`（override） | 0.10.14 | **0.12.3** | 0.12.3 | 达成 |
| `binary` | 0.3.0 | **已移除** | 移除 | 达成 |
| `buffers` | 0.1.1 | **已移除** | 移除 | 达成 |

`buffers@0.1.1` 无许可证链已切断。`npm ls binary buffers` 返回 `(empty)`。

## npm audit 前后对比

```
升级前  info:0 low:0 moderate:5 high:8 critical:2 total:15
升级后  info:0 low:0 moderate:7 high:4 critical:0 total:11
```

### Critical 清零明细

`@fastify/jwt` 与 `fast-jwt` 的 3 条 advisory 全部消失：
- `GHSA-hm7r-c7qw-ghp6`（未知 `crit` header 扩展）
- `GHSA-mvf2-f6gm-w987`（算法混淆）
- `GHSA-rp9m-7r4c-75qg`（claims 混淆）

### 剩余 4 个 High

| 包 | 直接 | 来源 | 处置 |
|---|---|---|---|
| `@fastify/static` | 否 | `@fastify/swagger-ui@5.2.3` 依赖的 8.3.0 仍在 `<=10.1.1` 范围 | 需升级 swagger-ui 或显式 override |
| `prisma` | 是 | Prisma 6.19.3 → 7.10.1 | 补丁文档明确留下批 |
| `@prisma/config` | 否 | 同上 | 同上 |
| `deepmerge-ts` | 否 | 同上 | 同上 |

**`@fastify/static` 这一项是本轮新发现**：直接依赖已升到 10.1.6，但 `@fastify/swagger-ui@5.2.3` 自带一份 8.3.0 嵌套副本，仍在受影响范围。

### 剩余 7 个 Moderate

`echarts`（XSS）、`echarts-for-react`、`exceljs`（经 `uuid`）、`prisma`、`react-router`、`react-router-dom`、`uuid`。

其中 `react-router-dom@6.30.6` 仍受 `GHSA-wrjc-x8rr-h8h6` 影响（修复需 v7.18.0），补丁文档已声明这一边界。我核实属实。

## 补丁应用中发现的三个问题

### 问题 1：补丁 5 个源文件无法应用（预期）

`git apply --check --whitespace=error` 失败于：

```
apps/api/src/lib/auth.ts:21
apps/api/src/routes/assistant-conversations.ts:10
apps/api/src/routes/assistant-poc.ts:7
apps/api/src/routes/system-management.ts:263
docs/pi-durable-poc-lockfile-gate-v1.0.md:2
```

原因是这 5 处我上一轮已修，且**与补丁期望逐字相同**：

```diff
- return failure(reply, 401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录');
+ return reply.code(401).send(failure(reply, 401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录'));
```

`system-management.ts` 的 401 分支连错误码 `UNAUTHORIZED` 和文案「请先登录」都一致。两个独立来源得出同一修复，这是正向证据。

处理方式：用 `git apply --include` 只取 3 个新增文件（回归测试、静态契约脚本、文档），版本变更按补丁清单手工应用。

### 问题 2：`overrides` 需要清 node_modules 才生效（重要）

按补丁文档执行 `npm install --package-lock-only` 后，锁文件里**没有** `0.12.3`，`binary`/`buffers` 仍在。

三次失败尝试：

| 尝试 | 操作 | 结果 |
|---|---|---|
| 1 | 有 node_modules，直接 `--package-lock-only` | 输出 `up to date in 32s`，override 未生效 |
| 2 | 删 lock 保留 node_modules | `up to date in 4s`，仍未生效 |
| 3 | 删 lock + 删 node_modules | **生效**，含 `0.12.3`，`binary`/`buffers` 消失 |

根因：npm 会读取现有 `node_modules` 判断依赖树是否最新，判定 "up to date" 就跳过重算，override 变更被忽略。

**这一条应写入补丁文档**，否则照文档执行的人会得到「override 没生效」的错误结论。

### 问题 3：Fastify 5.12.7 引入编译错误

```
src/server.ts(175,97): error TS18046: 'error' is of type 'unknown'.
```

Fastify 5.12.7 把 `setErrorHandler` 的 error 参数类型收紧为 `unknown`（原为 `Error`），`error.message` 不再合法。

修复：

```ts
// 修复前
env.NODE_ENV === 'production' ? '服务器暂时无法处理该请求' : error.message

// 修复后
env.NODE_ENV === 'production' ? '服务器暂时无法处理该请求' : (error instanceof Error ? error.message : String(error))
```

这是升级引入的真实类型回归，补丁未包含此修改。

## 验证结果

### 构建与测试

| 项目 | 结果 |
|---|---|
| `npm run build` | PASS（修正 server.ts 后） |
| `npm test` | **124/124**（原 122 + 新增 2 项 preHandler 回归） |
| `npm run validate:release-candidate` | RC=0，17 组全过 |
| `validate-r7-security-remediation.mjs` | 16 项 PASS |
| XLSX 单测（exceljs/unzipper 升级回归） | **7/7** |

### 真实 HTTP 回归（隔离实例 3099）

| 场景 | 期望 | 实测 |
|---|---|---|
| 未认证 → `/api/system-management/overview` | 401 且无数据 | 401 `{"code":"UNAUTHENTICATED"}`，零泄露 |
| USER → 同一路径 | 403 | 403 `{"code":"ADMIN_REQUIRED"}` |
| ADMIN → 同一路径 | 200 且有数据 | 200，含 `appVersion` |
| `ASSISTANT_POC_ENABLED=false` → `/api/assistant-poc/tools` | 404 且不暴露工具 | 404 `{"code":"ROUTE_NOT_FOUND"}`，无工具列表 |
| `ASSISTANT_POC_ENABLED=false` → `/api/assistant-poc/conversations` | 404 且不返回数据 | 404，无 `data` 数组 |

### 静态资源安全（`@fastify/static` v10）

| 请求 | 结果 |
|---|---|
| `/` | 200，SPA 577 字节 |
| `/../../../etc/passwd` | 200，SPA 首页，零文件读取 |
| `/..%2f..%2fpackage.json` | 200，SPA 首页 |
| `/..\..\package.json` | 200，SPA 首页 |
| `/assets/` | 404，无目录列表泄露 |

`wildcard: false` 配置在 v10 下仍有效，路径穿越不可达。

## 生产环境

```
PID 25020 监听 127.0.0.1:3001
健康检查：ok
业务数据：2 项目 / 2 用户 / 3 成本 / 1 合同（原样）
ASSISTANT_POC_ENABLED=false
```

测试实例 3098/3099 已停止并释放端口。

## 追加：清除 `@fastify/swagger-ui` 嵌套 `@fastify/static`（已完成）

在上述结果基础上，又单独处理了剩余 4 个 High 中最独立的一项。

### 问题

`@fastify/static` 直接依赖已升到 10.1.6，但 `@fastify/swagger-ui@5.2.3` 自带一份 `^8.0.0` 的嵌套副本，仍落在 advisory 的 `<=10.1.1` 受影响范围内。

### 版本链验证

| `@fastify/swagger-ui` | 依赖的 `@fastify/static` |
|---|---|
| 5.2.3 | `^8.0.0` |
| 5.2.6 | `^9.1.2` |
| 6.1.2 | `^10.1.0` |

只有升到 6.x 才能真正把嵌套的 static 带到 10.1.6。6.x 无 `peerDependencies` 限制，本项目只用了 `routePrefix` 与 `uiConfig` 两个参数（`server.ts:109`），API 面极小。

### 执行与结果

```
@fastify/swagger-ui  5.2.3 → 6.1.2
锁文件 SHA  3E72E5B1753E8301B2BE2D58AC69ED117E95ED61E7C9076AA886F70EE5239256
npm ci      退出码 0，added 643 packages
```

依赖树已去重：

```
@fastify/static@10.1.6
@fastify/swagger-ui@6.1.2
  └── @fastify/static@10.1.6 deduped
```

### audit 变化

```
升级前  moderate:7 high:4 total:11
升级后  moderate:6 high:3 total:9
```

`@fastify/static` 已从漏洞列表消失。

### 剩余 3 个 High 全部来自 Prisma 一条链

```
prisma            direct=true   range=6.13.0-dev.1 - 7.10.0
@prisma/config    direct=false  同上
deepmerge-ts     direct=false  <8.0.0
```

补丁文档明确将 Prisma 6 → 7 留给下一批。因此 R7 的 High 剩余项现在全部收敛到单一迁移任务。

### swagger-ui 6.1.2 功能实测（隔离实例 3099）

| 端点 | 结果 |
|---|---|
| `/docs` | 200 |
| `/docs/` | 200，873 字节，含 `swagger-ui` 标识 |
| `/docs/json` | 200，32,142 字节，`openapi=3.0.3`，`title=墨衡工程经营管理 API` |
| `/docs/static/index.html` | 200 |

OpenAPI 规范正常生成，158 条路径。

### 回归

```
npm run build                      退出码 0
npm test                           124/124
npm run validate:release-candidate RC=0，十七组全过
未认证 → 系统管理                     401，无泄露
POC=false → /tools                  404
路径穿越                            返回 SPA 首页，零文件读取
/assets/                            404，无目录列表
```

---

## R7 判定

**仍为 BLOCK。** 判据「Critical=0 且 High=0」未同时满足：

- Critical = 0 ✓
- High = 3 ✗（全部来自 Prisma 链）

可以记录的进展：**Critical 清零、`buffers` 无许可链切断、安装脚本策略落地、`@fastify/static` 嵌套副本去重**。

剩余漏洞从「四类独立问题」收敛为「一项 Prisma 7 迁移」。

## 下一步

1. **Prisma 6 → 7**：需 `prisma.config.ts`、datasource 迁移、`prisma-client` 生成路径调整、driver adapter 配置，涉及 36 个 API 源文件。这是清除最后 3 个 High 的唯一路径。
2. **React Router → 7.18.0**：清剩余 open-redirect moderate（`GHSA-wrjc-x8rr-h8h6`）。独立任务。
3. **`echarts` XSS**：未在补丁范围内，需评估是否升级。
4. **`uuid` moderate**（经 exceljs）：`<11.1.1` 缺少 buffer 边界检查。
5. **补丁文档补充**：override 需要先清 `node_modules`；Fastify 5.12.7 的 `setErrorHandler` 类型收紧；swagger-ui 5→6 才能带出 static v10。

## 未执行

- R2 真实 endpoint 冒烟（缺授权凭据）
- R1 真实 Ubuntu CI（缺规范远端）
- S1–S7 与 R3/R4 在升级后的完整重跑（本轮只做了 HTTP 鉴权回归与 XLSX 测试）
