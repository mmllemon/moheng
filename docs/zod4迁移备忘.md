# zod v4 迁移备忘（进行中）

> 目的：记录 zod 3.25.76 → 4.x 迁移的当前状态、已验证结论、以及尚未清理项的**决策依据**，供后续批次接手时有据可依。最后更新：2026-10-30。

## 结论先行

- 升级**可行且无外部阻塞**：所有间接依赖 zod 的第三方库（`langchain`、`@langchain/*`、`openai`、`@assistant-ui/*`、`@hookform/resolvers`、`react-hook-form`）都已兼容 zod 4，`@assistant-ui` 本身甚至依赖 `zod@^4.6.5`。
- 采用**渐进分批**：先升级适配（PR①），再做运行时冒烟，然后按需分批清 deprecated（PR②）。当前已完成 PR① 与 PR② 第一批，**main 全绿、CI 双绿**。

## 已完成批次（均在 main）

| 提交 | 内容 |
|---|---|
| `c253948` | PR① 升级 `zod@^4.6.7`；适配 13 处 tsc：`z.record(x)`→`z.record(z.string(), x)`（2 处），`zodResolver(x)`→`zodResolver(x) as never`（11 处，5 个表单页）；新增 `web-checks` CI |
| `a2fa90c` | PR② 第一批：AST codemod 清 `z.string().datetime()`→`z.iso.datetime()`、`z.object({...}).strict()`→`z.strictObject({...})`（14 个 API 文件） |
| `532c325` | 前端表单运行时冒烟脚本入库 |

验证矩阵：`api tsc` EXIT=0、`web tsc` EXIT=0、Web 单测 29 全过、API 全套无回归、CI（`Web lint and unit tests` + `Assistant runtime gates`）success、zod4 前端 5 个 `as never` 表单路由挂载无 JS 错误。

## 关键实证（后续批次务必参考）

1. **v4 真正 DROP 的 API**：`error.formErrors`、`error.errors`、`invalid_type_error`、`required_error`、`errorMap`。项目实测**全部 0 命中**，所以这些不构成迁移成本。
2. **v4 只是 DEPRECATE（仍可正常跑，官方要到下个 major 才移除）**：`error.flatten()`、`error.format()`、`ctx.addIssue()`、`.strict()`/`.passthrough()`、`.email()/.url()/.datetime()`、`message` 参数。其中 `strict`/`datetime` 已清，其余见下。
3. **coerce/transform 字段的 input≠output**：zod4 把这类字段的输入类型（`unknown`）与输出类型（`number`）拆开，与 react-hook-form `Resolver<>` 泛型冲突（纯类型问题，运行时 resolver 仍 coerce 成 output）。项目沿用 `zodResolver(x) as never` 惯例（与既有 `BudgetPage` 一致，运行时行为不变）。
4. **`verbatimModuleSyntax` 陷阱**：`apps/api` 的 tsconfig **未**开启它，导致把 `interface`/`type` 用值语法 `import`/`export` 搬运时 `tsc --noEmit` 不报错、只在运行时 ESM 报 `does not provide an export`（迁移中 `report-studio-data.ts` 实际踩到并修复）。清 `flatten` 会大量搬运类型，注意一律用 `import type`/`export type`。

## 未清项与决策（后续批次计划）

| 项 | 命中 | 现状 | 为什么没在这一批清 |
|---|---|---|---|
| `.email()/.url()` | 7 | 仍可跑 | 全与 `.trim()/.max()/.refine()/.preprocess()` **链式混用**，顶层化不是等价替换，需更细的 AST 规则单独成批 |
| `error.flatten()` | 87 | 仍可跑 | 改的是**错误输出结构**，直接牵动前端 `fieldErrors` 展示契约；必须先建立表单 e2e 校验覆盖，再逐处 `error.flatten()`→`z.flattenError(error)`（结构相同）并做前端回归 |
| `error.format()` | 5 | 仍可跑 | 同上（输出结构 → `z.treeifyError(error)`），与 `flatten` 一批处理 |
| `message` 参数 | 14 | 仍可跑 | v4 仍支持位置字符串简写，改了无实际收益，建议**保留** |

共同点：这三类当前都**不阻塞**（能跑、CI 绿、v4 未移除），属代码卫生而非负债。

## 可复用工具

- codemod：`scripts/codemods/zod4-datetime-strict.cjs`。运行：`npx jscodeshift --parser=tsx -t scripts/codemods/zod4-datetime-strict.cjs apps/api/src apps/web/src`（`jscodeshift` 用 `npm i --no-save` 临时装，不进依赖）。新增转换规则时沿用「dry-run + print 审查 → 全量 → tsc + 测试」流程。
- 冒烟：`scripts/zod4-form-smoke.mjs`。前置：zod4 前端（如 `apps/web` 里 `npx vite --port 5174`）+ 后端 up + 系统 Chrome；`$env:WEB_BASE_URL`/`$env:API_BASE_URL` 指向对应端口后 `node scripts/zod4-form-smoke.mjs`。
