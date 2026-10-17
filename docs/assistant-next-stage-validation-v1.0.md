# 墨衡助手下一阶段 Gate 固化验证记录 v1.0

- 日期：2026-10-16
- 源码基线：`moheng-construction-cost-management@2.14.0-rc.1`
- 本次改动：安全契约纳入 RC 检查、运行时/存储 ADR、下一阶段验收清单、修复模块数静态检查滞后。

## 执行结果

| 验证项 | 结果 | 说明 |
|---|---|---|
| `node scripts/validate-assistant-poc.mjs` | PASS | 34 项只读助手安全契约断言 |
| `node scripts/validate-assistant-runtime-decision.mjs` | PASS | 13 项运行时/存储决策与发布状态断言 |
| `npm run validate:release-candidate` | PASS | 退出码 0；完整静态发布候选检查链通过。主 RC 脚本报告 77/77；附属契约检查全部通过 |
| `scripts/validate-architecture.mjs` | PASS | 11/11。将预期模块数由 18 更正为实际 19；保持 16 个对集成目录可见、3 个隐藏模块的既有结构 |

完整命令输出随包外附文件 `moheng-next-stage-validation.log` 提供。

## 本次源码变更

1. 更新根 `package.json`，将助手安全契约与 runtime/storage 决策校验纳入 `validate:release-candidate`。
2. 加强 `scripts/validate-assistant-poc.mjs`：固定三个只读工具、身份/项目绑定、服务端权限重验、审计字段限制、POC 端点范围、模型工具参数边界、独立 PostgreSQL 测试库与 SQLite 路径隔离等断言。
3. 新增 `scripts/validate-assistant-runtime-decision.mjs`，检查候选运行时决策、后台任务边界、owner/project 授权和“未完成/未批准生产”状态没有从文档与代码契约中消失。
4. 新增 `docs/assistant-runtime-decision-v1.0.md` 与 `docs/assistant-next-stage-acceptance-v1.0.md`；同步 README/CHANGELOG 的状态声明。
5. 修复既有 `scripts/validate-architecture.mjs` 模块数量断言滞后问题；没有修改业务数据模型或数据库迁移。

## 环境与未执行事项

- 本环境：Node.js `v22.16.0`、npm `10.9.2`。
- 仓库 `engines` 要求 Node.js `>=24.0.0`；本环境未安装项目工作区依赖。
- 本次未执行 TypeScript build/typecheck、Prisma Client 生成、真实 PostgreSQL 迁移、API 数据库集成、浏览器 E2E 或真实模型调用。不得把这些项目视为通过。
- G5、G6、G1/G8 与 Pi Durable SQLite Conformance 的 PASS 来自用户提供的 Gate 报告；本次没有取得原始日志或独立复跑。

## 结论

**Gate A（冻结安全契约与持续校验）已完成；Gate B（运行时/存储决策）已完成到下一阶段候选路线确定。整体 AI 助手任务尚未完成。** Gate C 会话 API/SSE/UI 与 Gate D 只读内测、恢复演练和独立生产准入仍未通过。`ASSISTANT_POC_ENABLED` 必须保持默认关闭。
