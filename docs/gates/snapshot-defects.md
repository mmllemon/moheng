# 源码快照缺陷清单（只列缺陷，不含修复方案）

对照对象：`moheng-v2.19.0-rc.1-r7-round1-full-source-snapshot.zip`
对照基线：本地已通过 `npm ci` / `build` / `test` / RC 的工作树（commit `a485c71`）
对照范围：353 个文件逐一比对，13 处内容差异，全部核实方向

---

## 一、构建阻断类（3 处）

### 缺陷 1：`system-management.ts:444` 读取 `AuthUser` 上不存在的 `name`

`apps/api/src/routes/system-management.ts:444`

```ts
createdBy: { id: actor.sub, name: authUser(request).name, email: authUser(request).email }
```

同包 `apps/api/src/lib/auth.ts:7` 的类型定义：

```ts
export type AuthUser = { sub: string; email: string; role: UserRole; sid: string };
```

`AuthUser` 仅有 `sub / email / role / sid`，无 `name`。`authUser()` 实现为 `return request.user as AuthUser`，纯类型断言，运行时不补字段。

实测输出：

```
system-management.ts(444,255): error TS2339: Property 'name' does not exist on type 'AuthUser'.
```

### 缺陷 2：`system-management.ts:506` 的 `parent` 类型推断成环

`apps/api/src/routes/system-management.ts:506`

```ts
const parent = await prisma.department.findUnique({
  where: { id: cursor }, select: { id: true, parentId: true, isActive: true }
});
```

同函数内 `cursor` 声明为 `string | null`（L501），在 `while (cursor)`（L503）中作为 `where.id` 输入；L508 执行 `cursor = parent.parentId`。`parent` 的类型依赖 `where` 推断，`where` 依赖 `cursor`，`cursor` 的赋值来源又是 `parent.parentId`，形成闭环，TS 无法收敛。

实测输出：

```
system-management.ts(506,15): error TS7022: 'parent' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
```

### 缺陷 3：`SystemPoliciesPage.tsx:61` 传入 `ErrorBlock` 不存在的属性

`apps/web/src/pages/SystemPoliciesPage.tsx:61`

```tsx
<ErrorBlock error={loadError} onRetry={() => { ... }} />
```

同仓库 `apps/web/src/components/Ui.tsx:47` 的组件签名：

```tsx
export function ErrorBlock({ message, retry }: { message: string; retry?: () => void })
```

组件只接收 `message` 与 `retry`，无 `error`、无 `onRetry`。该 `Ui.tsx` 在快照与基线中逐字节相同。

实测输出：

```
src/pages/SystemPoliciesPage.tsx(61,64): error TS2322: Type '{ error: Error; onRetry: () => void; }' is not assignable to type 'IntrinsicAttributes & { message: string; retry?: (() => void) | undefined; }'.
  Property 'error' does not exist on type 'IntrinsicAttributes & { message: string; retry?: (() => void) | undefined; }'.
```

---

## 二、运行期缺陷（1 处）

### 缺陷 4：`system-management.ts:440` 的 `create` 未 `include` 关联，下游访问关联对象

`apps/api/src/routes/system-management.ts:440`

```ts
const row = await tx.systemAuthorizationReview.create({
  data: { status: 'PENDING', summary: ..., snapshot, createdById: actor.sub }
});
```

该调用无 `include` 参数。`SystemAuthorizationReview` 模型定义了 `createdBy User @relation("SystemAuthorizationReviewCreator", ...)`，Prisma 默认只返回标量外键 `createdById`，不返回关联对象。同文件 L369、L552、L610、L660 的同类调用均带 `include: { createdBy: { select: { id: true, name: true, email: true } } }`。

该 `create` 的返回值经 `return row` 传给 L444 的响应体构造，L444 直接访问 `created.createdBy`。

性质：编译期不报，运行期访问关联对象得到 `undefined`。与缺陷 1 位于同一响应体构造表达式，缺陷 1 先阻断编译，此处在缺陷 1 消除后才会暴露。

---

## 三、依赖与构建产物缺失（1 处）

### 缺陷 5：根 `package-lock.json` 缺失，而 CI 强制校验其存在

快照根目录无 `package-lock.json`（`experiments/pi-durable-poc/package-lock.json` 存在）。

同快照 `.github/workflows/assistant-runtime-gates.yml:37`：

```yaml
run: test -f package-lock.json
```

第 39 行紧随 `npm ci --no-audit --no-fund`。`npm ci` 在缺少 lock 时以 `EUSAGE` 退出。

性质：该快照推送到任何启用此 workflow 的仓库后，根工作区 job 在第一步即失败，无法进入后续任何 Gate。

注：快照 `SOURCE-BUNDLE-STATUS.md` 已声明「此环境没有用户 Node 24 实测产生的根 `package-lock.json` 正文」，属已知限制而非隐瞒。但其后果是快照无法独立完成 CI，这一点在状态说明中未被指出。

---

## 四、静态契约与实现不一致（1 处）

### 缺陷 6：`validate-r7-security-remediation.mjs` 缺少两条对应已实现变更的断言

`scripts/validate-r7-security-remediation.mjs`

快照 `assertions: 16`，基线 `assertions: 18`。快照缺少的两条：

```js
assert.equal(apiPackage.dependencies['@fastify/swagger-ui'], '6.1.2', 'remove the vulnerable nested @fastify/static v8 tree from swagger-ui');
assert.match(server, /error instanceof Error \? error\.message : String\(error\)/, 'Fastify 5 setErrorHandler error is unknown');
```

而快照的 `apps/api/package.json` 已含 `"@fastify/swagger-ui": "6.1.2"`，`apps/api/src/server.ts:175` 已含 `error instanceof Error ? error.message : String(error)`。

性质：实现已落地，静态契约未覆盖，形成「能通过检查但检查不到该处」的空档。

---

## 五、文档陈述与依赖状态不符（1 处）

### 缺陷 7：`docs/assistant-runtime-ci-gates-v1.0.md` 仍要求根 lock 等于升级前的 SHA

快照该文档正文：

> 必须保留并提交测试方已验证的根目录 `package-lock.json`（SHA-256 `F31A4B2E…`）。本补丁只改脚本/静态校验，不改根 workspace 依赖或版本；应用后应再次确认根 lock SHA 未变化。

事实：R7 第一批已修改根工作区直接依赖（`@fastify/jwt` 9.1.0→10.2.4、`@fastify/static` 8.2.0→10.1.6、`fastify` 5.5.0→5.12.7、`@fastify/swagger-ui` 5.2.3→6.1.2、`react-router-dom` 6.30.1→6.30.6）并新增 `overrides`。依赖图已变，根 lock 必然变化，不可能继续等于 `F31A4B2E…`。

基线版本已改为：旧 SHA 仅作升级前历史证据，应用后须重新生成并验证新 SHA 在两次 `npm ci` 中一致。

性质：文档指令与同包 `package.json` 的依赖状态自相矛盾。按该文档执行会得出「lock 被篡改」的错误判断。

---

## 六、非缺陷但有差异的项（供参考，不计入缺陷）

| 文件 | 差异 | 方向 |
|---|---|---|
| `apps/api/src/lib/business-parameters.ts` | 快照缺少 `Prisma.SystemParameterRevisionWhereInput` 断言 | 基线较新 |
| `apps/api/src/lib/assistant-event-safety.test.ts` | 快照缺少 `sourceCount: 1` | 基线较新，用于让断言命中 scope 校验 |
| `apps/api/test-support/fake-assistant-provider.ts` | 快照省略了 `createModel` / `createSaver` / `runReadOnlyTool` 的参数类型 | 基线较新 |
| `apps/api/src/routes/system-config.ts:89` | 快照在 `isUniqueConflict(error)` 之外重复判断 `typeof error === 'object' && 'code' in error && error.code === 'P2002'` | 快照冗余，函数内部已判断，不构成缺陷 |
| `docs/pi-durable-poc-lockfile-gate-v1.0.md` | 注释措辞差异 | 基线措辞更明确 |
| `CHANGELOG.md` / `README.md` / `docs/R7-security-remediation-round-1.md` | 版本描述文本 | 基线较新 |

---

## 汇总

| # | 位置 | 性质 | 何时暴露 |
|---|---|---|---|
| 1 | `system-management.ts:444` | 类型层字段不存在 | 编译期 |
| 2 | `system-management.ts:506` | 类型推断成环 | 编译期 |
| 3 | `SystemPoliciesPage.tsx:61` | 组件属性不存在 | 编译期 |
| 4 | `system-management.ts:440` | 缺 include 却访问关联 | 运行期 |
| 5 | 根 `package-lock.json` | 文件缺失 | CI 第一步 |
| 6 | `validate-r7-security-remediation.mjs` | 断言缺 2 条 | 静态检查空档 |
| 7 | `docs/assistant-runtime-ci-gates-v1.0.md` | 文档与依赖状态矛盾 | 按文档执行时 |

缺陷 1、2、3 使 `npm run build` 无法通过。缺陷 5 使 CI 无法启动。缺陷 4 需在 1 消除后才暴露。缺陷 6、7 属检查与文档层面。
