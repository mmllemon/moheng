# Pi Durable PoC 独立锁文件与测试 Gate v1.0

## 目的

`experiments/pi-durable-poc` 不在根 npm workspaces 内，根 `package-lock.json` 不会锁定该子项目的完整依赖图。该子项目必须单独提交自己的 `package-lock.json`，CI 才能使用 `npm ci` 重现安装并运行本项目维护的 Pi Durable 存储契约回归测试集（Node + Vitest）。

本次源码已把 `@langchain/core` 从 `1.2.17` 对齐到 `1.2.18`，以满足 `langchain@1.5.18` 的 `^1.2.18` peer 要求；`vitest@5.0.5` 归类为精确固定的 `devDependency`。此处只修正依赖声明，不能在锁文件尚未生成、测试尚未执行时声称 PoC Gate 已通过。

## 在 Node.js 24+ 的干净开发环境生成并验收锁文件

PowerShell：

```powershell
node --version
npm --version
npm install --package-lock-only --prefix experiments/pi-durable-poc --no-audit --no-fund
Get-FileHash experiments/pi-durable-poc/package-lock.json -Algorithm SHA256

# 第一次干净安装；npm ls 读取已安装依赖树，因此必须在 npm ci 之后执行
npm ci --prefix experiments/pi-durable-poc --no-audit --no-fund
npm ls --prefix experiments/pi-durable-poc @langchain/core langchain vitest
$lock1 = (Get-FileHash experiments/pi-durable-poc/package-lock.json -Algorithm SHA256).Hash

# 清理后第二次干净安装，并重复检查依赖树与 lock SHA
Remove-Item experiments/pi-durable-poc/node_modules -Recurse -Force -ErrorAction SilentlyContinue
npm cache clean --force
npm ci --prefix experiments/pi-durable-poc --no-audit --no-fund
npm ls --prefix experiments/pi-durable-poc @langchain/core langchain vitest
$lock2 = (Get-FileHash experiments/pi-durable-poc/package-lock.json -Algorithm SHA256).Hash
if ($lock1 -ne $lock2) { throw "PoC lock SHA mismatch: $lock1 / $lock2" }

npm test --prefix experiments/pi-durable-poc
```

第一次与第二次 `npm ci` 都必须退出码 0；两次安装之后的 `npm ls` 均不得报告 invalid/missing peer。不要在第一次 `npm ci` 之前用 `npm ls` 判断依赖树：`npm ls` 检查已安装的 `node_modules`，仅生成 lock 文件后尚无依赖树，可能得到 `(empty)` 并以退出码 1 结束。将 `experiments/pi-durable-poc/package-lock.json` 纳入版本控制，不得只把 SHA 粘进报告而不提交锁文件。

## PostgreSQL 必须是真隔离数据库

完整 Node 测试包含 `test/postgres-conformance.test.mjs`。执行时需要独立、可销毁的 PostgreSQL 测试数据库，设置：

```powershell
$env:NODE_ENV = 'test'
$env:ASSISTANT_POC_ALLOW_PG_TESTS = 'true'
$env:ASSISTANT_POC_DATABASE_URL = '<独立的可销毁 PoC 测试数据库 URL>'
```

该 URL 不能等于应用业务 `DATABASE_URL`，测试脚本的隔离守卫必须保持启用。不要将 URL、密码或密钥写入日志或仓库。

## 验收状态规则

- 锁文件未提交：CI 的 `Require committed standalone PoC lockfile` 应失败；这是预期阻断，不得通过退回 `npm install` 或 `--legacy-peer-deps` 规避。
- 锁文件已提交且 `npm ci` 两次 SHA 一致：重复安装 Gate 才可记为 PASS。
- `npm test` 所有 Node 与 Vitest 测试通过，且实际 PostgreSQL conformance 测试未跳过：PoC conformance Gate 才可记为 PASS。
- 这组测试仅证明实验适配器/存储契约，不表示 Pi Durable 已有 PostgreSQL adapter，也不构成生产启用批准。
