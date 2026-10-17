# R7 — 依赖安装脚本与依赖安全审查

执行时间：2026-10-17
环境：Windows 10.0.26200 / Node v24.18.0 / npm 11.16.0
基线：v2.19.0-rc.1 + gate-hardening 补丁 + 文档顺序修正（`4d57797`）

## 结论

**R7 判定：BLOCK（有条件）。**

依赖安装脚本本身经审查无可疑行为，但因存在 2 个 critical、8 个 high 漏洞且均为直接依赖，
以及 1 个无许可声明的传递依赖，按 Gate 判据「有未处置的阻断项」记为 BLOCK。

本轮同时修复了 R7 过程中发现的一个真实鉴权缺陷（详见「附带发现」）。

## 一、安装脚本审查（6 个包）

来源：`npm ci` 输出的 `allow-scripts` 警告。逐包审查脚本文件实际内容。

| 包 | 脚本 | 文件大小 | 外网 URL | 访问 registry | 调用子进程 | 结论 |
|---|---|---|---|---|---|---|
| `@prisma/client@6.19.3` | postinstall | 12,864 chars | 2 | 否 | 是 | 批准（必要） |
| `@prisma/engines@6.19.3` | postinstall | 1,092 chars | 0 | 否 | 否 | 批准（必要） |
| `@tailwindcss/oxide@4.1.13` | postinstall | 4,043 chars | 1 | 是 | 否 | 批准（必要） |
| `esbuild@0.25.12` | postinstall | 11,160 chars | 4 | 是 | 是 | 批准（必要） |
| `prisma@6.19.3` | preinstall | 26,331 chars | 0 | 否 | 否 | 批准（必要） |
| `protobufjs@7.6.6` | postinstall | 1,071 chars | 0 | 否 | 否 | 批准（必要） |

### 逐项理由

**`@prisma/client` postinstall** — Prisma Client 生成入口。脚本含 `child_process` 调用，
用于探测项目结构并触发 `prisma generate`。两个 URL 均为文档链接
（`github.com/cameronhunter/npm-config-user-agent-parser`、`pnpm.io/only-allow-pnpm`），
非下载地址。必要时序：Prisma Client 不生成则 TypeScript 无法编译。

**`@prisma/engines` postinstall** — 1 KB，无网络、无子进程。校验引擎二进制存在性。
必要。

**`@tailwindcss/oxide` postinstall** — 含 `registry.npmjs.org` 下载逻辑，用于拉取对应
平台的 native binding（`win32-x64-msvc`）。这是 Tailwind 4 的架构要求。
风险点：从 registry 下载二进制。缓解：锁文件已固定版本，registry 为官方源。
必要，Web 构建依赖。

**`esbuild` postinstall** — 含 `registry.npmjs.org` 下载与 `child_process`。
用于下载平台专用二进制（`@esbuild/win32-x64`）。4 个 URL 中 3 个为文档
（`nodejs.org/dist`、`snapcraft.io`、GitHub issue），1 个为 registry 模板。
必要，Vite 构建依赖。

**`prisma@6.19.3` preinstall** — 26 KB 纯逻辑，零网络、零子进程、零文件写入。
经静态审查确认只做环境与版本检查。

**`protobufjs` postinstall** — 1 KB。经逐行阅读，仅检查依赖方的 `versionScheme`
字段并打印警告，无任何副作用。**可安全拒绝**，但批准亦无风险。

### 未执行的操作

未运行 `npm approve-scripts --allow-scripts-pending`。Gate 判据明确禁止一次性
全量批准。当前工作树的 `package.json` 未添加 `allowScripts` 白名单，
安装时这些脚本仍处于「未覆盖」状态，仅产生警告。

## 二、漏洞审计

### 根工作区（生产依赖，`--omit=dev`）

```
info: 0  low: 0  moderate: 5  high: 8  critical: 2  total: 15
```

### critical（2）

**`@fastify/jwt` 9.1.0 — 直接依赖**

经 `fast-jwt` 传递，含 3 条 advisory：
- `GHSA-hm7r-c7qw-ghp6` — fast-jwt 接受未知 `crit` header 扩展（RFC 7515 违反）
- `GHSA-mvf2-f6gm-w987` — CVE-2023-48223 未完整修复：空白前缀 RSA 公钥导致 JWT 算法混淆
- `GHSA-rp9m-7r4c-75qg` — `cacheKeyBuilder` 碰撞导致不同 token 的 claims 混淆（身份混淆）

修复版本：`@fastify/jwt@10.2.4`

**`fast-jwt` ≤6.3.3 — 传递依赖**

同上三条的承载包。

**本项目实际暴露面评估**：`server.ts:94` 注册为
`await app.register(jwt, { secret: env.JWT_SECRET })`，未显式指定 `algorithms`。
密钥为 HMAC 对称密钥，不使用 RSA 公钥。因此「算法混淆」类攻击的利用面受限。
但「claims 混淆」（cacheKeyBuilder 碰撞）与「非法 crit 扩展」与密钥类型无关，
仍可能被触发。**未做针对性攻击验证，不宣称安全。**

### high（8）

| 包 | 直接 | 关键 advisory | 修复版本 |
|---|---|---|---|
| `@fastify/static` 8.2.0 | 是 | 目录列表路径穿越、编码分隔符绕过路由守卫、非规范 URL 鉴权绕过 | 10.1.6 |
| `fastify` 5.5.0 | 是 | sendWebStream 无界内存分配 DoS、Content-Type tab 绕过 body 校验、X-Forwarded-Proto/Host 欺骗 | 5.12.7 |
| `react-router-dom` 6.30.1 | 是 | 开放重定向、`//` 协议相对 URL 重解释、反斜杠开放重定向 | 6.30.6 |
| `prisma` 6.19.3 | 是 | 经 `@prisma/config` → `deepmerge-ts` 栈耗尽 | 7.10.1 |
| `@prisma/config` | 否 | 传递 | 7.10.1 |
| `deepmerge-ts` | 否 | 递归对象图合并导致栈耗尽 | 8.0.0 |
| `@remix-run/router` | 否 | 传递 | 6.30.6 |
| `react-router` | 否 | 传递 | 6.30.6 |

### `@fastify/static` 路径穿越 — 已实测

生产服务（PID 25020，端口 3001）实测 5 类穿越请求：

| 请求 | 状态 | 内容 |
|---|---|---|
| `/../../../etc/passwd` | 200 | SPA 首页 577 B |
| `/..%2f..%2f..%2fetc%2fpasswd` | 200 | SPA 首页 577 B |
| `/%2e%2e%2f%2e%2e%2fpackage.json` | 200 | SPA 首页 577 B |
| `/..\..\package.json` | 200 | SPA 首页 577 B |
| `/static/../../../apps/api/package.json` | 200 | SPA 首页 577 B |

全部返回 577 字节 SPA HTML，**未读到任何文件**。原因：`server.ts:120` 注册为
`{ root: webDistPath, prefix: '/', wildcard: false, index: false }`，`wildcard: false`
阻断了通配路径匹配。

**判定：路径穿越在本项目配置下不可达。** 但「鉴权绕过」类 advisory 与通配设置无关，
未做等价验证，不宣称整体安全。

### 路由守卫绕过实测

| 请求 | 状态 | 说明 |
|---|---|---|
| `/api/system-management/overview` | 401 | 鉴权生效 |
| `/api/system-management%2foverview` | 404 | 路由未匹配 |
| `//api/system-management/overview` | 200 | **返回 SPA 首页**，非 API 数据 |
| `/api/./system-management/overview` | 401 | 鉴权生效 |
| `/api/%2e/system-management/overview` | 401 | 鉴权生效 |
| `/api\system-management\overview` | 401 | 鉴权生效 |
| `/api/system-management/overview/` | 404 | 路由未匹配 |

双斜杠返回 SPA 首页而非 API 数据，不构成绕过。

### POC 子项目

```
info: 0  low: 0  moderate: 0  high: 0  critical: 0  total: 0
```

零漏洞。

## 三、许可证审查

### 根工作区（502 个顶层包）

| 许可证 | 数量 |
|---|---|
| MIT | 422 |
| ISC | 38 |
| Apache-2.0 | 14 |
| BSD-3-Clause | 10 |
| BlueOak-1.0.0 | 8 |
| MPL-2.0 | 2 |
| (MIT AND Zlib) | 1 |
| CC-BY-4.0 | 1 |
| BSD-2-Clause | 1 |
| 0BSD | 1 |
| Unlicense | 1 |
| (MIT OR GPL-3.0-or-later) | 1 |
| UNKNOWN | 1 |
| MIT/X11 | 1 |

### 需处置的两项

**1. `jszip` — `(MIT OR GPL-3.0-or-later)`**

双许可，可选择 MIT。**无阻碍**，建议在合规记录中明确选择 MIT。

**2. `buffers@0.1.1` — 无 license 字段（UNKNOWN）**

传递链：

```
exceljs@4.4.0
  └── unzipper@0.10.14
        └── binary@0.3.0
              └── buffers@0.1.1
```

`buffers` 的 `package.json` 中 `license` 字段为空。作者 James Halliday (substack)，
仓库 `github.com/substack/node-buffers`。

**这是合规缺口**：无许可声明不等于可自由使用。exceljs 是生产依赖，
用于报表 XLSX 导出，因此该包进入生产构建。

处置建议：
- 检查该包实际是否被 exceljs 运行时调用（可能仅用于 zip 解析的可选路径）
- 若确需保留，在合规记录中标注风险并说明供应链来源
- 若可替换，考虑升级 exceljs 或使用 `@fastify/static` 之外的 XLSX 方案

## 四、附带发现：修复一个真实鉴权缺陷

R7 过程中测试路由守卫时发现 `system-management` 的鉴权存在缺陷，
已修复并验证。此发现不属于 R7 原定范围，但属同类安全审查产物。

### 缺陷

`apps/api/src/lib/auth.ts` 的 `authRequired` 所有拒绝分支使用 `return failure(reply, ...)`。

`lib/http.ts` 的 `failure()` 实现为：

```ts
export function failure(reply, statusCode, code, message, details?) {
  reply.code(statusCode);
  return { success: false as const, error: {...} };
}
```

它只调用 `reply.code()`，**返回一个普通对象，不发送响应**。

在普通路由 handler 中这没问题（Fastify 会把返回值作为响应体）。但在 `preHandler`
钩子中，返回值被丢弃，`reply.sent` 保持 `false`，请求继续进入 handler。

### 影响

未认证或会话失效的请求，在 `authRequired` 拒绝后仍会执行到 handler。
状态码被设为 401/403，但响应体是 handler 返回的完整业务数据。

**实测证据（修复前，隔离实例 3099）**：

```
GET /api/system-management/overview  （无 token）
→ 401
→ {"success":true,"data":{"appVersion":"2.19.0-rc.1","nodeVersion":"v24.18.0",
   "memory":{...},"database":{"status":"ok"},"backgroundJobs":{...},...}}
```

状态码 401 但返回了完整系统信息。

### 为什么生产环境没暴露

生产（PID 25020）跑的是旧构建，`system-management` 第二个钩子里
`authUser(request).role` 在 `request.user` 为 `undefined` 时抛异常，
Fastify 默认错误处理器返回 401。**是异常碰巧挡住了泄露，不是设计正确。**

### 修复

`auth.ts` 6 处拒绝分支改为 `return reply.code(N).send(failure(...))`：

```ts
// 修复前
return failure(reply, 401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录');

// 修复后
return reply.code(401).send(failure(reply, 401, 'UNAUTHENTICATED', '登录状态已失效，请重新登录'));
```

`system-management.ts` 第二个钩子加未认证守卫并改为显式 send：

```ts
app.addHook('preHandler', async (request, reply) => {
  if (reply.sent) return;
  if (!request.user) return reply.code(401).send(failure(reply, 401, 'UNAUTHORIZED', '请先登录'));
  if (authUser(request).role !== 'ADMIN') return reply.code(403).send(failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以访问系统管理扩展'));
});
```

参考实现：同文件 `denyRestrictedRequest` 本来就是正确写法
（`reply.code(statusCode).send({...}); return false;`）。

### 修复验证（隔离实例 3099，真实登录会话）

| 身份 | 状态码 | 响应体 | 泄露数据 |
|---|---|---|---|
| 未认证 | 401 | `{"success":false,"error":{"code":"UNAUTHENTICATED",...}}` | 否 |
| 普通 USER | 403 | `{"success":false,"error":{"code":"ADMIN_REQUIRED",...}}` | 否 |
| 管理员 | 200 | 完整系统信息（正确） | 应返回 |

对照组：同一 USER 会话访问 `/api/projects` 返回 200，证明 403 是权限判定而非会话失效。

### 回归

```
npm test                        → 122/122，fail 0
npm run validate:release-candidate → RC=0，17 组全过
API tsc --noEmit                → 0 错误
```

## 五、R7 判据对照

| 判据 | 状态 | 证据 |
|---|---|---|
| 所有安装脚本有批准/拒绝理由 | **PASS** | 6 个包逐一审查，见第一节 |
| 必要脚本最小化 allowlist | **未做** | 未修改 `allowScripts`，仅审查 |
| 漏洞结果按既定严重性判定 | **BLOCK** | 2 critical + 8 high 未处置 |
| 无未处置阻断项 | **BLOCK** | 上项未处置 |
| 报告关联到待验收 commit | **PASS** | `4d57797` + 本轮未提交改动 |
| 安装与构建仍可重复完成 | **PASS** | 见前置 Gate 记录 |

## 六、处置建议

### 立即可做（低风险）

```bash
npm i @fastify/jwt@^10.2.4      # 清 2 critical
npm i @fastify/static@^10.1.6   # 清路径穿越/鉴权绕过
npm i fastify@^5.12.7           # 清 3 条 high
npm i react-router-dom@^6.30.6  # 清开放重定向
```

但注意：这些包在 `apps/api/package.json` 与 `apps/web/package.json` 中
**精确固定版本**（无 `^`）。升级需同步改声明、重跑 build 与全部测试。
`@fastify/jwt` 9→10 与 `@fastify/static` 8→10 含 major 变更，需验证 API 兼容性。

### 需评估（可能破坏性）

- `prisma` 6.19.3 → 7.10.1：major 升级，且 `package.json#prisma` 配置在 Prisma 7 移除
  （本项已由复核文件第 7 条提出）。建议合并处理。
- `buffers@0.1.1` 无许可证：需合规决策，非技术升级。

### 不建议

- 一次性 `npm approve-scripts --allow-scripts-pending`
- 用 `--force` 或 `--legacy-peer-deps` 绕过升级冲突
- 调高 Vite `chunkSizeWarningLimit` 关闭体积警告

## 七、未做项

- 未对 `@fastify/jwt` 的 claims 混淆做实际攻击验证
- 未对 `@fastify/static` 的鉴权绕过 advisory 做等价验证
- 未修改 `allowScripts` 白名单（仅审查，未落地最小化批准）
- 未在升级依赖后重跑完整 Gate（升级属代码变更，需单独一轮）
- 未评估 `buffers` 在 exceljs 运行时是否实际被调用
