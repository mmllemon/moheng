# 源码快照对照结果

对照日期：2026-10-17
快照：`moheng-v2.19.0-rc.1-r7-round1-full-source-snapshot.zip`（457 个文件）
对照基线：本地已通过 `npm ci` / `build` / `test` / RC 的工作树（commit `a485c71`）

## 结论

**快照不能直接构建。** 它回退了两处已修复的编译错误，`npm run build` 会失败：

```
src/routes/system-management.ts(444,255): error TS2339: Property 'name' does not exist on type 'AuthUser'.
src/routes/system-management.ts(506,15): error TS7022: 'parent' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
```

这是在本地用快照文件替换后实测的 tsc 输出，不是静态推断。

其余部分与本地树一致，包括快照声明已吸收的 swagger-ui 6.1.2 与 Fastify 5.12.7 兼容修改。

## 逐文件对照

| 文件 | 结果 |
|---|---|
| `apps/api/src/lib/auth.ts` | 一致 |
| `apps/api/src/server.ts` | 一致（含 `error instanceof Error` 收窄） |
| `apps/api/src/routes/assistant-poc.ts` | 一致 |
| `apps/api/src/routes/assistant-conversations.ts` | 一致 |
| `apps/api/src/lib/auth-prehandler-regression.test.ts` | 一致 |
| `apps/api/package.json` | 一致（含 `@fastify/swagger-ui: 6.1.2`） |
| `apps/web/package.json` | 一致（`react-router-dom: 6.30.6`） |
| `system-management.ts` | **差异（回退 3 处）** |
| `package.json` | **差异（仅差异在 validate 脚本的注释性字段，见下）** |
| `scripts/validate-r7-security-remediation.mjs` | **差异（少 2 条断言）** |

## 差异 1：`system-management.ts` 回退 3 处（必须修）

### 1.1 L444 使用了不存在的 `AuthUser.name`

快照：

```ts
createdBy: { id: actor.sub, name: authUser(request).name, email: authUser(request).email }
```

但同包 `auth.ts` 的类型定义是：

```ts
export type AuthUser = { sub: string; email: string; role: UserRole; sid: string };
```

没有 `name` 字段。报 TS2339。

本地版本：

```ts
createdBy: { id: created.createdBy.id, name: created.createdBy.name, email: created.createdBy.email }
```

### 1.2 L440 的 `create` 缺少 `include`

快照：

```ts
const row = await tx.systemAuthorizationReview.create({ data: { status: 'PENDING', summary: ..., snapshot, createdById: actor.sub } })
```

没有 `include: { createdBy: { select: { id: true, name: true, email: true } } }`，因此 1.1 的 `created.createdBy` 取不到。

本地版本在 `create` 上加了这个 `include`，与同文件 L369、L552、L610、L660 处其他 handler 的既有惯例一致。

### 1.3 L506 的 `parent` 丢失显式类型注解

快照：

```ts
const parent = await prisma.department.findUnique({ where: { id: cursor }, select: { id: true, parentId: true, isActive: true } });
```

`cursor` 是 `string | null`，`select` 的推断依赖 `where` 的推断，形成循环，报 TS7022。

本地版本：

```ts
const parent: { id: string; parentId: string | null; isActive: boolean } | null = await prisma.department.findUnique({ ... });
```

### 这三处的来源

`1.1` 与 `1.3` 正是 R7 第一批补丁引入的两处回归，我在上一轮报告《R7 remediation round1 result》中记录过并修复。快照把它带回来了。

## 差异 2：`scripts/validate-r7-security-remediation.mjs` 少 2 条断言

快照 `assertions: 16`，本地 `assertions: 18`。本地多出：

```js
assert.equal(apiPackage.dependencies['@fastify/swagger-ui'], '6.1.2', 'remove the vulnerable nested @fastify/static v8 tree from swagger-ui');
assert.match(server, /error instanceof Error \? error\.message : String\(error\)/, 'Fastify 5 setErrorHandler error is unknown');
```

这两条是我在完成 swagger-ui 6.1.2 升级后补的。快照的 `apps/api/package.json` 与 `server.ts` 已包含对应实现，但静态契约没跟上，形成「实现有了、断言没加」。

## 差异 3：`package.json` 的 scope 描述

仅 `validate-r7-security-remediation.mjs` 内的 `scope` 数组文本不同（快照未含 swagger-ui 与 unknown 收窄两条），不影响功能。

## 快照已正确吸收的部分

声明属实，逐项核对通过：

- preHandler 显式发送 401/403（`auth.ts`、`system-management.ts` 钩子主体、`assistant-poc.ts`、`assistant-conversations.ts`）
- POC 关闭时 404
- `@fastify/jwt@10.2.4`、`@fastify/static@10.1.6`、`fastify@5.12.7`、`react-router-dom@6.30.6`、`@fastify/swagger-ui@6.1.2`
- `overrides.exceljs.unzipper = 0.12.3`
- `allowScripts` 六项，`protobufjs@7.6.6: false`
- `setErrorHandler` 的 `error instanceof Error` 收窄
- auth preHandler 回归测试文件
- R7 静态契约脚本与文档
- Pi Durable 独立 lockfile

## 快照未包含根 lock（符合声明）

根目录无 `package-lock.json`，仅 `experiments/pi-durable-poc/package-lock.json`（99.6 KB）。

状态说明写「不应根据 SHA 反造 lockfile」，这个判断正确。应从实际通过 `npm ci` 的工作树取该文件。

本地的 lock 现状：

```
/package-lock.json
SHA-256  3E72E5B1753E8301B2BE2D58AC69ED117E95ED61E7C9076AA886F70EE5239256
```

注意：该 SHA 对应的是 **swagger-ui 6.1.2 升级后**的 lock。若快照源码不修 `system-management.ts` 就重新生成 lock，SHA 会不同，因为它只影响源码不影响依赖，理论上不应改变 lock——但需实际验证。

## 建议

1. **不要直接把快照作为构建基线。** 先修 `system-management.ts` 三处，或直接采用本地版本该文件。
2. 把 `validate-r7-security-remediation.mjs` 的两条断言补上，否则实现与契约不一致。
3. 根 lock 从本地成功跑过 `npm ci` 的树复制，不要重生成——重生成可能因 registry 快照时间差异产生不同解析结果。
4. 快照声明的 `Critical=0 / High=3 / Moderate=6 / Total=9` 与本地实测一致，可采信。
