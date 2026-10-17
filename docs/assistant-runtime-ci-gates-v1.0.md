# 墨衡助手成功路径、事件安全与恢复 CI Gate v1.0

日期：2026-10-17  
候选版本：`2.19.0-rc.1`  
当前裁定：**允许继续只读内测评估；不批准生产启用。**

## 1. 本轮吸收的测试方证据

测试方已报告以下真实环境结果：fake/真实模型成功回答链路中的真实模型路径、`run.queued → run.started → tool.started → tool.completed → run.completed` 事件顺序、持久化与硬杀重启恢复、自定义 `OPENAI_BASE_URL`、取消并发/权限隔离和六个恢复场景均通过。报告里逐字核对的两条 limitation 事件是固定业务口径常量，不是业务数据；来源 metadata 的字段为 `entity / fields / rowCount / scope`。这些是测试方报告，本容器未复跑其真实模型、浏览器或 PostgreSQL 环境。

仍需区分两点：测试方此前名为 `ASSISTANT_POC_FAKE_PROVIDER` 的变量不在源码中，因此“fake provider 成功”当时不是同一个真实运行路径；另外，原临时六场景脚本与 grep 检查尚未固化。v2.19 为这两项补充了自动化测试与 CI 门禁，但由于本容器缺少 workspace 依赖，新增 TypeScript/PG 测试没有在此处执行，待 CI/Node 24+ 环境复验。

## 2. 源码变化

1. **仅进程内依赖注入的 fake model seam**：`runLangGraphAssistantTurn` 接受可选测试依赖，以替换模型/checkpointer/工具执行器。正式调用默认仍使用 `ChatOpenAI`、`PostgresSaver` 和受控只读工具；HTTP 请求、环境变量或用户 prompt 不能选择 fake provider。
2. **成功工具调用单测**：确定性测试模型通过真实 `createAgent` 工具循环，根据问题选择 `cost_variance` 或 `project_operating_overview`，读取 fake 工具返回并生成最终答案；固定断言数值、方向、来源项目、预期工具以及不输出私有测试标记。
3. **事件写入前保护**：每类事件使用字段白名单；`tool.completed` 的 source metadata 只保留 `entity / fields / rowCount / scope`，限制说明必须来自固定常量，来源范围 `scope` 必须匹配固定列表。任何未知字段、原始 prompt/回答/金额字段/凭据或自定义 scope 在分配事件序号和写入数据库之前拒绝。
4. **持久化泄漏扫描**：`scripts/validate-assistant-leaks.mjs` 扫描 runtime 日志和 JSONL 事件，检测典型 provider key、凭据赋值、显式 forbidden markers、未授权 event 字段和不合法 source metadata。固定限制说明按白名单识别，避免将静态口径文本误判为业务数据泄漏。
5. **PostgreSQL 集成测试**：`apps/api/src/lib/assistant-recovery.integration.test.ts` 通过 `ASSISTANT_RECOVERY_TESTS=true` 显式开启，且检查数据库 URL 为本地/测试库且不等于 `PRODUCTION_DATABASE_URL`。它覆盖 S1 无 jobId 的新 run、S2 无效 job 关联、S3 有效队列任务+fake provider 成功到 `COMPLETED`、S4 有效 lease、S5 已请求取消且次数耗尽、S6 次数耗尽且未取消，以及 S7 超过宽限期的无关联陈旧 run。
6. **CI 工作流**：`.github/workflows/assistant-runtime-gates.yml` 在 Node 24 + 临时 PostgreSQL 16 下运行 build、API 测试、fake/event guard 测试、隔离 PG 恢复测试，然后将 runtime log 与持久化事件交给泄漏扫描器。

## 3. 本轮可复现的静态与本地结果

- `npm run validate:release-candidate`：通过；主静态发布套件 `77/77`。
- `node scripts/validate-assistant-safety-contract.mjs`：`13/13`。
- `node --test scripts/lib/assistant-leak-guard.test.mjs`：`5/5`。
- 使用全局 TypeScript `transpileModule` 对本轮涉及的 8 个 TypeScript 源/测试文件做语法转译诊断：`8/8` 无语法诊断。该项**不是**严格类型检查。
- `node` 版本为 `v22.16.0`，项目要求 `>=24.0.0`；运行 `npm run build` 在 API 阶段以 `TS2688: Cannot find type definition file for 'node'` 停止，原因是当前导出环境无 `node_modules`。
- npm registry 的 `npm install --package-lock-only` 尝试超时，未生成 `package-lock.json`。本候选 ZIP 没有包含测试方在本机验证的 lock 文件。
- 因为缺少依赖及隔离 PG，本地**未执行**新加的 TypeScript unit/integration tests、完整 build、Prisma validate/generate、实际 CI workflow 或浏览器测试。不能把静态契约结果当成运行态 PASS。

## 4. 运行命令

在项目根目录使用 Node.js 24+，在隔离的、已迁移的 PostgreSQL 测试库里执行。R7 第一批会修改根工作区的直接依赖版本和 `exceljs` 的 `unzipper` override，因此旧基线锁文件 SHA-256 `F31A4B2E…` 仅作为升级前的历史证据；应用本批后必须从新的 `package.json` 重新生成根 `package-lock.json`。新锁文件 SHA 预期会变化，不能继续要求它等于旧 SHA。必须审查解析图、提交新锁文件，并在全新工作树中执行两次 `npm ci`，确认新锁文件 SHA 在两次安装前后完全一致。

```bash
npm ci --no-audit --no-fund
npm run db:validate
npm run db:deploy
npm run build  # build 会先执行 db:generate
npm run test -w @cms/api
npm run test:assistant-runtime-contracts
```

随后配置测试数据库（不要使用生产凭据），并执行真实恢复集成与泄漏 Gate：

```bash
mkdir -p .assistant-gate-artifacts
export ASSISTANT_RECOVERY_TESTS=true
export PRODUCTION_DATABASE_URL='postgresql://production.invalid/never-use'
export ASSISTANT_GATE_ARTIFACT_DIR="$PWD/.assistant-gate-artifacts"
npm run test:assistant-recovery:postgres -w @cms/api 2>&1 | tee "$ASSISTANT_GATE_ARTIFACT_DIR/assistant-runtime.log"
node scripts/validate-assistant-leaks.mjs \
  --logs "$ASSISTANT_GATE_ARTIFACT_DIR/assistant-runtime.log" \
  --events "$ASSISTANT_GATE_ARTIFACT_DIR/assistant-events.jsonl" \
  --markers "$ASSISTANT_GATE_ARTIFACT_DIR/assistant-forbidden-markers.txt"
```

CI 工作流通过 `npm ci` 强制使用已提交的根锁文件。**当前源码快照 ZIP 本身没有根 `package-lock.json`，因此直接推送该快照到启用了此 workflow 的仓库会在 `test -f package-lock.json` 步骤失败，后续 `npm ci` 不会运行。** 这是交付包的硬阻断，不是可忽略的提示；不得删除该检查，也不得用无锁的 `npm install` 替代 `npm ci` 来绕过它。

请从已通过两次 `npm ci` 的 Node 24.18.0 实测工作树复制根锁文件，并先用 `node scripts/validate-source-bundle-completeness.mjs` 核对它。此快照记录的目标 SHA-256 为 `3E72E5B1753E8301B2BE2D58AC69ED117E95ED61E7C9076AA886F70EE5239256`。只有该文件进入源码根目录且哈希与实测记录一致，源码包才满足根 CI 的锁文件前置条件。Pi Durable 子项目另有独立锁文件要求，见 `docs/pi-durable-poc-lockfile-gate-v1.0.md`。

## 5. 下一步 Gate

1. 在 Node 24+ 和现有经过核验的 lock 文件上完成依赖安装，并确认两次独立 clean install 的 lock SHA 一致。
2. 让 CI 实际执行 fake provider adapter 测试、隔离 PG 成功运行和 S1-S7 恢复场景；不能只看静态合同。
3. 保存一次 CI 的日志、事件 JSONL、测试报告和 lock SHA，确认泄漏扫描无误报/漏报，并将报告作为发布附件。
4. 在经过授权的真实 OpenAI-compatible endpoint 上做受控 smoke test；测试成功后仍需备份/恢复、提示注入、取消竞态、权限复核与运维演练，之后才进入单独的生产准入评审。

生产开关维持 `ASSISTANT_POC_ENABLED=false`。本 Gate 不授予助手对业务数据的写权限、不改变审批/合同金额生效规则，也不构成生产启用批准。
