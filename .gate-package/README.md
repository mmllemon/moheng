# v2.19.0-rc.1 四类缺陷补丁 — Gate 重跑报告

执行时间：2026-10-17
环境：Windows 10.0.26200 / Node v24.18.0 / npm 11.16.0 / PostgreSQL 16.15

## 结论

**Gate 通过，但补丁自身带入 2 个编译回归，修正后才跑通。**

补丁的 4 类核心修复正确（orphan SQL 引号、authRequired hook 注册、MFA IV 收窄、readonly 事件类型），
静态检查 21 组全绿印证。但它同时把两处原本能正常编译的代码改坏，
原样应用不修改的话 `npm run build` 是红的。

## lock SHA-256（两次安装）

```
第一次 npm ci（热缓存）                          : F31A4B2EB8325F3C4A85AC0CEB991896FAC79F8DEE70ABEA580E4A7BE4B92ADB
第二次 npm ci（清 node_modules + cache clean --force）: F31A4B2EB8325F3C4A85AC0CEB991896FAC79F8DEE70ABEA580E4A7BE4B92ADB
```

一致。补丁未改 `package.json` / `package-lock.json`（补丁清单仅 9 个源文件，无包管理文件）。

## 测试摘要

| 项目 | 命令 | 结果 |
|---|---|---|
| Node 版本 | `node --version` | v24.18.0（engines `>=24.0.0` 满足） |
| 依赖安装 ×1 | `npm ci` | PASS |
| 依赖安装 ×2 | `npm ci`（冷缓存） | PASS，SHA 一致 |
| 构建 | `npm run build` | PASS（修正补丁引入的 2 个错误后） |
| 单元测试 | `npm test` | 122/122 |
| 发布候选 | `npm run validate:release-candidate` | RC=0，21 组全过 |
| Schema 校验 | `prisma validate` | valid |
| 迁移 | `prisma migrate deploy` | 全部成功 |
| S1–S7 恢复集成 | `npm run test:assistant-recovery:postgres` | PASS（真实 PostgreSQL） |
| 真实 PG 并发与事件链 | `npm run test:pg` | PASS |

发布候选细项（21 组）：
```
77/77 static release-candidate checks passed
21/21 system configuration contract checks passed
18/18 report-studio static contracts passed
29/29 v2 report-studio contracts passed
20/20 WP2–WP8 source contracts passed
12/12 static audit coverage contracts passed
11/11 architecture checks passed
15/15 background-job architecture checks passed
23/23 TypeScript-defect source contracts passed
10/10 UI polish checks passed
12/12 navigation/UI/XLSX regression checks passed
28/28 public-access security checks passed
14/14 system-management/navigation/self-password checks passed
20/20 system expansion checks passed
22/22 defect-audit checks passed
23/23 system completion checks passed
19/19 system workbench checks passed
```

`23/23 TypeScript-defect source contracts` 是补丁新增检查组，专门验证 23 处 TS 修复。

## 失败与归因

### 一、环境问题：prisma generate 未执行（717 个 TS 错误）

首次 build 输出：
```
TS7006: 429 处 / TS2339: 93 处 / TS2305: 48 处 / TS18046: 44 处 / TS2694: 43 处
...
src/routes/system-management.ts(852,96): error TS2694: Namespace '...Prisma' has no exported member 'InputJsonObject'.
```

根因：第二次 `npm ci` 清掉 `node_modules` 后未跑 `prisma generate`，Prisma Client 处于空壳状态。

证据：
```
node_modules/.prisma/client/index.d.ts   修复前 3,989 bytes   修复后 7,440,021 bytes
InputJsonValue 导出                      修复前 False         修复后 True
```

执行 `prisma generate` 后错误降至 2 个。**归因：环境问题，非源码缺陷。**

`prisma validate` 曾报 P1012「Environment variable not found: DATABASE_URL」，
为该 shell 缺环境变量所致；补上 DATABASE_URL 后返回 schema valid。

### 二、源码缺陷：补丁引入的 2 个回归（阻断 build）

```
src/routes/system-management.ts(443,255): error TS2339: Property 'name' does not exist on type 'AuthUser'.
src/routes/system-management.ts(505,15): error TS7022: 'parent' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
```

用上一轮可构建版本的备份逐行比对，确认由补丁改动引入：

| 位置 | 上一版（build 通过） | 补丁改成 | 后果 |
|---|---|---|---|
| L505 | `const parent: { id: string; parentId: string \| null; isActive: boolean } \| null = await ...` | `const parent = await ...`（删掉类型注解） | TS7022 |
| L443 | `createdBy: { id: actor.sub, email: actor.email }` | `createdBy: { id: actor.sub, name: authUser(request).name, email: authUser(request).email }` | TS2339 |

`AuthUser` 定义（`apps/api/src/lib/auth.ts:7`）：
```ts
export type AuthUser = { sub: string; email: string; role: UserRole; sid: string };
```
不存在 `name` 字段。补丁同时删掉了原本正确的 `email: actor.email`。

### 三、修正内容

保留补丁新增的 `if (reply.sent) return;` 保护，仅修两处：

```ts
// L439 给 create 加 include，取数据库真实用户信息
const row = await tx.systemAuthorizationReview.create({
  data: { status: 'PENDING', summary: ..., snapshot, createdById: actor.sub },
  include: { createdBy: { select: { id: true, name: true, email: true } } },
});

// L443 从关系取真实 name，与文件内其他 handler 惯例一致
createdBy: { id: created.createdBy.id, name: created.createdBy.name, email: created.createdBy.email },
reviewedBy: null

// L505 恢复显式类型注解
const parent: { id: string; parentId: string | null; isActive: boolean } | null =
  await prisma.department.findUnique({ where: { id: cursor }, select: { id: true, parentId: true, isActive: true } });
```

修正后 `tsc -p tsconfig.json --noEmit` 零错误，`npm run build` PASS。

### 四、环境问题：POC 子包依赖冲突（未纳入本次 Gate）

`experiments/pi-durable-poc` 的 `npm test` 中 vitest 缺失：
```
'vitest' is not recognized as an internal or external command
```

根因为依赖声明冲突，安装直接失败：
```
npm error Could not resolve dependency:
npm error peer @langchain/core@"^1.2.18" from langchain@1.5.18
npm error   langchain@"1.5.18" from the root project
```

`pi-durable-poc/package.json` 声明 `"@langchain/core": "1.2.17"`，
而 `langchain@1.5.18` 要求 `^1.2.18`。该子包不在 npm workspaces 内
（workspaces 仅 `apps/api`、`apps/web`），无独立 `node_modules`。

未使用 `--legacy-peer-deps` 或修改声明绕过。

影响范围：仅 `test:pi-conformance` 一项。不影响的 Gate 项：
- `test:pg`（并发与事件链）已单独跑通
- 三项 node 测试全部通过：
```
✔ PostgreSQL probe implements the same request/status/owner contract (real isolated database)
✔ SQLite probe persists state and enforces idempotency + owner isolation
✔ SQLite probe rejects invalid state transitions
```

### 五、补丁说明中的归因需更正

补丁说明指出「PostgreSQL 官方 UPDATE 语法允许目标表别名…请勿把"PostgreSQL 不支持 UPDATE alias"当作事实」。

**该说法正确，上一轮报告的归因有误。** 核对旧 SQL 发现真正的语法错误在：

```sql
AND job."payload"->>'conversationId' = run."conversationId'
```

`run."conversationId` 为双引号起始、单引号结尾，引号不匹配，触发 42601。

补丁改无别名写法本身无问题，但给出的理由归错了因。结论对、理由错。

## 隔离与合规

| 项目 | 值 |
|---|---|
| 主测试 schema | `moheng_gate_rerun` |
| POC 测试 schema | `moheng_poc_gate` |
| 生产业务 schema | `public`（未触碰） |
| PRODUCTION_DATABASE_URL | 设为不存在的地址，由测试内三重守卫校验 |
| 生产服务 | PID 25020 监听 127.0.0.1:3001（未变） |
| 生产业务数据 | 2 项目 / 2 用户 / 3 成本 / 1 合同（原样） |

测试内守卫（`assistant-recovery.integration.test.ts`）：
1. `ASSISTANT_RECOVERY_TESTS !== 'true'` 时整测试跳过
2. `DATABASE_URL` 必须存在
3. 必须不等于 `PRODUCTION_DATABASE_URL`
4. 必须匹配 localhost / 127.0.0.1 / 含 test|ci 的 URL

POC 测试守卫（`postgres-conformance.test.mjs`）：
1. `NODE_ENV === 'test'`
2. `ASSISTANT_POC_ALLOW_PG_TESTS === 'true'`
3. `ASSISTANT_POC_DATABASE_URL` 必须存在且不等于 `DATABASE_URL`

本包不含 API Key、数据库密码、.env 内容或真实业务数据。
所有日志已按数据库密码字面量、URL 内嵌凭据模式、`sk-` 密钥模式、私钥头模式扫描，无命中。

## 并发与事件链测试的实际断言

`experiments/pi-durable-poc/test/postgres-conformance.test.mjs`：

```js
const first = await store.submit(input);
const retry = await store.submit(input);
assert.equal(retry.id, first.id);
assert.equal(retry.duplicate, true);

const concurrentRetries = await Promise.all(Array.from({ length: 8 }, () => store.submit(input)));
assert.ok(concurrentRetries.every((item) => item.id === first.id && item.duplicate === true));
assert.equal(await store.eventCount(input), 1, 'concurrent retries must not create duplicate SUBMITTED events');

await assert.rejects(() => store.submit({ ...input, payload: { promptHash: 'changed' } }), /IDEMPOTENCY_CONFLICT/);
assert.equal(await store.getForOwner({ ownerUserId: `other-${randomUUID()}`, id: first.id }), null);

await store.markRunning(input);
assert.equal((await store.complete({ ...input, result })).status, 'COMPLETED');
assert.deepEqual((await store.complete({ ...input, result })).result, result);
assert.equal(await store.eventCount(input), 3);
```

覆盖：8 路并发幂等同 id、事件唯一、幂等冲突拒绝、跨 owner 隔离、状态机流转后事件计数。

## S1–S7 场景

`apps/api/src/lib/assistant-recovery.integration.test.ts`：

| 场景 | 构造 | 期望 |
|---|---|---|
| S1 | 无 jobId，宽限期内 | RUNNING |
| S2 | 无效 job 关联，宽限期内 | RUNNING |
| S3 | 有效队列任务 + fake provider | COMPLETED，事件链 5 条 |
| S4 | 有效租约 | RUNNING |
| S5 | 已取消 + 租约耗尽 | CANCELLED，errorCode null，无审计 |
| S6 | 租约耗尽无取消 | FAILED + `ASSISTANT_WORKER_LEASE_EXPIRED` + 审计 |
| S7 | 超宽限期陈旧 orphan | FAILED + `ASSISTANT_ORPHAN_RUN` + 审计 |

事件链断言：`['run.queued','run.started','tool.started','tool.completed','run.completed']`，sequence `[1,2,3,4,5]`。

安全断言：
- 回答不含 fake provider 私有标记
- 事件 payload 不含 `100000.00|999999.00|899999.00` 任一金额
- 事件 JSONL 仅含 `entity / fields / rowCount / scope` 四类字段

## 包内文件

```
README.md                          本报告
logs/gate-ci-1.log                 第一次 npm ci
logs/gate-ci-2.log                 第二次 npm ci（冷缓存）
logs/gate-build.log                首次 build（717 错误，prisma 未生成）
logs/gate-build2.log               prisma generate 后 build（剩 2 错误）
logs/gate-build3.log               修正后 build 通过
logs/gate-test.log                 npm test 122/122
logs/gate-rc.log                   validate:release-candidate RC=0
logs/gate-s1s7.log                 S1-S7 恢复集成
logs/gate-pg.log                   真实 PG 并发与事件链
logs/gate-poc-all.log              POC 套件（vitest 缺失）
logs/gate-poc-install.log          POC 安装（peer 冲突）
artifacts/assistant-events.jsonl   S1-S7 产物，5 条事件
artifacts/assistant-forbidden-markers.txt
patched/apps/api/src/routes/system-management.ts   修正后的完整文件
sha256-lock.txt                    lock SHA-256 记录
```

## 后续建议

1. 补丁作者需修 L443 / L505 两处回归后再发布，否则应用后 build 直接失败。
2. `pi-durable-poc/package.json` 的 `@langchain/core: 1.2.17` 与 `langchain@1.5.18` 的 peer 要求冲突，
   建议上游统一为 `^1.2.18`；当前状态无法从零安装，只能沿用既有 node_modules。
3. `prisma generate` 未纳入 `npm ci` 的 postinstall，重建 node_modules 后必须手动执行，
   建议补 `postinstall` 钩子。
