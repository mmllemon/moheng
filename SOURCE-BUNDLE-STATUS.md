# 墨衡 v2.19.0-rc.1 R7 第一批修订源码快照（等待根锁文件）

- 生成日期：2026-10-17
- 源码基线：用户交付的 `moheng-v2.19.0-rc.1-assistant-runtime-ci-gates.zip`
- 合并层：已提供的四缺陷文件集、Gate-hardening patch、R7 第一批修复，以及用户本轮 Node.js 24 实测报告明确的后续修正。
- 本源码目录不包含 `.git` 远端历史；没有向 GitHub 推送或把合成历史冒充远端 commit。
- 版本仍为 `2.19.0-rc.1`，这是源码快照版，不是“R7 通过”版。

## 已吸收的实现

1. 受保护 Fastify preHandler 明确发送 401/403，禁止返回普通对象后继续执行 handler。
2. Assistant POC 关闭时发送 404，不继续执行对应 handler。
3. 调整 `@fastify/jwt@10.2.4`、`@fastify/static@10.1.6`、`fastify@5.12.7`、`react-router-dom@6.30.6`。
4. 加入 `exceljs -> unzipper@0.12.3` override 与精确版本 `allowScripts` 策略。
5. `@fastify/swagger-ui@6.1.2`，以及 Fastify 5.12.7 `setErrorHandler` 的 `error: unknown` 兼容修改。
6. 新增 auth preHandler 回归测试、R7 静态契约脚本与 R7 报告文档。
7. 纳入 Gate-hardening 文件与独立 Pi Durable lockfile。

## 验收限制

- 此环境没有用户 Node 24 实测产生的根 `package-lock.json` 正文。报告给出的最新 SHA-256：`3E72E5B1753E8301B2BE2D58AC69ED117E95ED61E7C9076AA886F70EE5239256`。不应根据 SHA 反造 lockfile；应从实际通过 `npm ci` 的工作树复制该文件并核验哈希。
- 本次导出环境 Node 为 22.16.0、npm 10.9.2；用户报告环境是 Node 24.18.0、npm 11.16.0。用户报告里的 Windows 构建、测试、HTTP、XLSX、锁重复性结果作为独立证据记录，未伪称为此环境复跑结果。
- R7 仍 BLOCK：用户报告的 audit 为 Critical=0 / High=3 / Moderate=6 / Total=9；3 个 High 都在 Prisma 6→7 迁移链。R1 真实 Ubuntu CI、R2 带授权凭据的 endpoint 冒烟以及升级后完整 S1–S7 / R3 / R4 重跑未完成。
- 本包不得直接作为生产部署批准。完成 root lockfile 归档、干净安装、全量审计和缺失 Gate 后再评估。

## 本次源码复核修复（2026-10-17）

- 已修复 `system-management.ts` 的 `AuthUser.name` 类型错误及创建授权复核未 include `createdBy` 的运行期缺陷。
- 已修复部门层级检查的 `cursor` 类型推断闭环风险。
- 已修复 `SystemPoliciesPage.tsx` 调用 `ErrorBlock` 时传入错误属性名的问题。
- 已扩展 R7 静态契约并加入源包根锁文件前置验证；由于 root lock 缺失，`validate:release-candidate` 在本快照里应明确 BLOCK，不可按完整 CI-ready 源码使用。
- 用户本地更新的 `business-parameters.ts`、`assistant-event-safety.test.ts`、`fake-assistant-provider.ts` 未提供具体 diff，因此未合入；不应整体覆盖用户工作树。详见 `R7-源码缺陷复核与修复记录.md`。
