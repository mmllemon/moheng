# 两处误判的更正

日期：2026-10-17

前一版《源码快照缺陷清单》中的缺陷 6 与缺陷 7 作废。经用户指出并复核原件，两处均为我的判断错误，不是快照缺陷。

---

## 更正 1：缺陷 6 作废（静态契约断言数量）

### 我的原判断

「快照 `assertions: 16`，基线 `assertions: 18`，缺少 swagger-ui 与 error 收窄两条断言。」

### 实际事实

快照 `scripts/validate-r7-security-remediation.mjs`：

- 字符数 3,732，`assert.` 出现 20 次，声明 `assertions: 18`
- 全文包含逐项判断（非省略、非合并）

我的工作树同一文件：

- 字符数 3,406，`assert.` 出现 18 次，声明 `assertions: 16`
- 脚本注释中**不含** swagger-ui 版本断言与 `error instanceof Error` 断言

### 错误原因

用 `Compare-Object` 比较两文件时，我读取了差异行，但把 `SideIndicator` 的方向解释反了。`=>` 表示差异对象（我的文件）独有，`<=` 表示参照对象（快照）独有。我把快照独有的两条当成了我的文件独有，据此得出「快照缺少」的结论。

同一轮里我已经因为 CRLF 假阳性重判过一次 `package.json`，却没有把同样的复核标准用到这个文件上。

### 用户说明的处理

用户已将该脚本改为逐项命名的 36 条断言，使覆盖范围与计数表达更清晰。

---

## 更正 2：缺陷 7 作废（CI 文档锁 SHA 表述）

### 我的原判断

「快照 docs/assistant-runtime-ci-gates-v1.0.md 仍要求根 lock 等于 `F31A4B2E…`，与已升级的依赖自相矛盾。」

### 实际事实

快照该文档 L34 原文：

> R7 第一批会修改根工作区的直接依赖版本和 `exceljs` 的 `unzipper` override，因此旧基线锁文件 SHA-256 `F31A4B2E…` 仅作为升级前的历史证据；应用本批后必须从新的 `package.json` 重新生成根 `package-lock.json`。新锁文件 SHA 预期会变化，不能继续要求它等于旧 SHA。必须审查解析图、提交新锁文件，并在全新工作树中执行两次 `npm ci`，确认新锁文件 SHA 在两次安装前后完全一致。

L59 补充说明根锁不在补丁 ZIP 内是为避免覆盖工作树中已验证的 lock。

### 错误原因

我把旧版文档（`docs/R7-security-remediation-round-1.md` 或更早批次的表述）中「必须保留 `F31A4B2E…`，应用后应再次确认根 lock SHA 未变化」这句话，错误地归到了 `docs/assistant-runtime-ci-gates-v1.0.md` 名下。实际快照的这份文档已经改写成「历史证据、预期变化」。

### 用户说明的处理

用户已补充「缺少根锁文件会导致 CI 在第一道检查失败」的说明。

---

## 仍然成立的缺陷

原件复核后，以下 5 条不受影响：

| # | 位置 | 性质 |
|---|---|---|
| 1 | `system-management.ts:444` | 读取 `AuthUser` 不存在的 `name`，TS2339 |
| 2 | `system-management.ts:506` | `parent` 类型推断成环，TS7022 |
| 3 | `SystemPoliciesPage.tsx:61` | `ErrorBlock` 不认 `error` / `onRetry`，TS2322 |
| 4 | `system-management.ts:440` | `create` 缺 `include`，下游访问关联对象得到 undefined |
| 5 | 根 `package-lock.json` 缺失 | CI 第 37 行 `test -f package-lock.json` 直接失败 |

其中 1、2、3 已用实测 tsc 输出验证；4 由 Prisma 语义与同文件其他调用惯例推定，未单独实测；5 由 workflow 文件内容确认。

---

## 方法层面要改的

两次错误同一根源：**把「有差异」直接当成「对方有缺陷」，没有先确认差异的方向，也没有回到原件逐行读。**

后续对照的做法应该是：

1. 先读原件全文，不依赖差异工具的输出
2. 确认差异方向（哪边是新版、哪边和同仓库其他文件自洽）
3. 只有能落到「与同仓库既有约定冲突」或「实测输出报错」的，才记为缺陷
