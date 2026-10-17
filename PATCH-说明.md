# v2.19.0-rc.1 四类缺陷修复补丁

适用于现有 `moheng-construction-cost-management@2.19.0-rc.1` 工作树。此补丁仅覆盖清单中的 9 个源文件，不包含/修改 `package.json`、`package-lock.json`、Prisma schema/migrations、环境变量或业务数据。

## 使用方式

将 ZIP 解压到项目根目录，覆盖同路径文件。应用前建议备份这 9 个文件；应用后运行完整 `npm run validate:release-candidate`、Node.js 24+ build、Prisma generate 与隔离 PostgreSQL 集成测试。

## 内容

- 孤立 run SQL：修正 `conversationId` JSON 谓词引号错误，明确校验 runId/conversationId 关联。
- 系统管理 auth：把 `authRequired` 正确注册为 preHandler，再独立检查 ADMIN 角色。
- MFA 解密：验证/收窄 IV、tag、ciphertext 后再执行 Buffer 解码。
- 事件 JSON 类型：接受 `as const` 产生的 readonly 数组/对象，保留原始测试语义。
- 静态断言：检查对应正确实现；Windows/POSIX 的 SelectField/DatePicker 路径样例均有测试。

PostgreSQL 官方 `UPDATE` 语法允许目标表别名；本补丁选择无别名写法，但真正需要修复的语法错误是旧 SQL 的 `conversationId` 谓词引号不匹配。请勿把“PostgreSQL 不支持 UPDATE alias”当作事实或唯一测试判据。
