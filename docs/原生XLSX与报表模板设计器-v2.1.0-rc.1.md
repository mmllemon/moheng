# 墨衡原生 XLSX 与可视化报表模板设计器设计说明

版本：`v2.1.0-rc.1`  
状态：实现候选；不是生产验收完成证明。

## 1. 决策摘要

本版本把原有八类 CSV 台账报表升级为 CSV + 原生 XLSX 双格式，并新增受控报表模板设计器。选择服务端 `ExcelJS 4.4.0` 生成 XLSX，前端自行实现轻量、受控的布局编辑器；暂不嵌入 Univer、Handsontable、积木报表、帆软或 ReportBro。

决策依据：

- 墨衡的八类报表是固定的业务数据集，不需要向普通用户开放任意 SQL 或通用数据源配置。
- 服务端生成 XLSX 可复用 Fastify、现有项目权限、Prisma 台账口径和审计；不需要引入单独 Java/Python 报表服务。
- ExcelJS 的 MIT 许可证和固定版本便于纳入现有 Node.js 工作区。ExcelJS 不提供公式计算引擎，模板/导出不依赖计算公式作为权威业务结果。
- Univer 的 XLSX 导入/导出与打印需要核验 Pro 能力；Handsontable 的商业使用需要相应授权；ReportBro 的 AGPL/商业双轨许可需单独评估；积木报表、帆软虽适合用作交互及报表能力基准，嵌入前仍要核验授权与运行环境。产品比较不能代替法务对具体版本许可证的确认。

## 2. 目标与非目标

### 本轮目标

1. 八类报表继续保留 CSV，并新增原生 XLSX 导出。
2. 工作簿使用真实数值/日期单元格、固定列类型、冻结表头、筛选、打印纸张与方向、重复表头、页码及可选导出说明页。
3. 用户能够自定义报表标题/副标题、模板名称和说明、数据字段、列名、列次序、显隐、列宽、对齐、数值格式；新增/删除数据列和自定义版式行；调整标题/副标题/表头/明细行高；在自定义版式行中合并/拆分单元格；设置纸张方向、宽度适配、重复表头、页脚和页码。
4. 支持个人、项目共享、系统模板；草稿、发布、归档；查看版本历史和把旧版恢复为新的编辑版本。
5. 报表预览基于真实权限过滤的数据；屏幕预览默认最多 80 行；完整打印数据单独请求且最多 10,000 行，若超出有截断提示。
6. 目标成本清单支持原生 XLSX 模板下载、解析、字段映射、服务端预检、提交前再次校验和单事务写入。CSV 导入保留。
7. 所有业务值仍由墨衡业务 API/数据库决定；报表模板不直接访问数据库、不改变台账、不承载任意 SQL 或 JavaScript。

### 本轮非目标

- 不复刻完整 Excel；不支持任意单元格公式、宏、外部数据连接、数据透视或 VBA。
- 不允许修改报表结果中的业务记录；导出的 XLSX 只是只读数据快照。
- 不开放变更、应收收退款、结算、应付、付款及实际成本的通用批量导入。
- 不承诺 XLSX、PDF 和浏览器打印像素级一致。三种输出共享字段和版式语义，但分页由各自渲染机制决定。
- 不在第一版引入报表异步任务队列、对象存储、多数据源、用户自定义 SQL、表达式/脚本执行或服务端公式引擎。

## 3. 报表目录和字段契约

由 `apps/api/src/lib/report-data.ts` 集中注册八类报表：

- `target-cost`：目标成本清单
- `actual-cost`：实际成本台账
- `progress-bills`：业主进度款申报
- `changes`：变更签证台账
- `owner-receivables`：业主应收台账
- `owner-receipts`：业主到账与退款流水
- `downstream-contracts`：分供合同台账
- `downstream-payables`：分供应付台账

每个字段具有稳定 key、中文标签、字段类型和默认列宽。模板只允许绑定相应报表 key 的白名单字段。字段 key 由报表类型与原数据字段索引组成；若未来字段语义或顺序发生变化，应迁移 `schemaVersion` 或引入字段 ID 映射，不能静默复用旧索引指代另一字段。

查询仍按登录账号可访问的项目范围过滤，显式请求无权项目返回 403。报表按既有业务字段和金额口径输出；不重算资金分配、合同金额生效或结算过账结果。单次最多 10,000 条，超过时返回截断状态并在工作簿说明页/数据页提示。

## 4. 工作簿约定

### 4.1 通用报表 XLSX

- `数据`：标题、副标题、自定义静态版式行、列头及正式数据明细。开启冻结窗格与筛选，设置真实数值格式、列宽、行高、打印区域与重复表头。
- `导出说明`（可在模板设置关闭）：报表名、标题、模板名/版本、项目范围、日期范围、生成时间、行数、上限、是否截断、只读快照与金额口径说明。
- 标识符按文本处理；业务金额和数量保留数值语义。文本以普通字符串写入，不写公式节点。
- 导出是独立数据快照；修改文件不回写系统。

### 4.2 目标成本导入 XLSX

模板工作表为 `目标成本清单` 和 `填报说明`。数据表第一行为稳定表头，不允许合并的标题行覆盖第一行字段契约。支持中英表头映射和用户手工映射。

约束：最多 8 MB、5,000 数据行、40 列、10 张工作表；ZIP 中央目录最多 128 个条目、单项解压大小最多 16 MB、总解压大小最多 40 MB。拒绝 ZIP64、加密 ZIP、不安全路径、宏/外部链接/嵌入对象/外部连接、公式单元格及 Excel 错误单元格。文件通过 ZIP/XLSX 结构预检不等于内容可信，后续仍会做行级与数据库约束检查。

编号与上级编号需使用文本格式，保留前导零。父级可引用数据库已有 ID/编号或本次文件中更早出现的编号；不支持子项先于文件中的新父项。目标合价允许留空，留空时使用当前业务默认计算；填写后作为用户提供的合价，不会被导入层静默覆盖。

## 5. 模板 JSON（schemaVersion 1）

模板保存在独立的 `ReportTemplate.definition` JSON 字段；字段包括：

- `title`、`subtitle`（支持 `{project}`、`{generatedAt}`、`{rowCount}` 占位符）。
- `columns`：ID、字段白名单 key 或静态列、列标题、宽度、显隐、对齐、类型格式和静态值。
- `customRows`：最多 12 个静态版式行、每行高度与每列文本。
- `merges`：仅针对自定义版式行的合并区间；范围必须在表格内，区间不能互相覆盖。
- `rowHeights`：标题、副标题、表头、明细默认行高。
- `page`：纸张 A4/A3/Letter、纵向/横向、横向宽度适配、重复表头、说明页、页脚和页码。

自定义版式行不是数据库数据行；明细行数由权限过滤后的查询结果决定，不能由设计器插入、删除实际业务记录。

服务端用 Zod 严格验证 JSON 结构、字段白名单、重复字段绑定、列 ID、可见列、行列上限、合并范围、重叠合并及行列数量一致性。绝不执行用户提供的 SQL、JavaScript 或任意表达式。

## 6. 模板作用域与权限

- `PERSONAL`：所有者可编辑；仅所有者读取。
- `PROJECT`：项目 OWNER/MANAGER 可编辑和发布；项目成员可读取已发布模板；草稿只对所有者、项目 OWNER/MANAGER 和系统管理员开放。
- `SYSTEM`：系统 ADMIN 可编辑、发布、归档；普通用户只读取已发布系统模板。
- 系统默认版式由服务端代码生成，是只读基线；它不是必须预先入库的数据库模板。
- 用户在只读模板上修改后保存，会生成个人副本，不会改变原模板。
- 更新、发布、归档与历史恢复均使用 `expectedVersion` 做并发保护并记录 revision/audit；版本不一致时返回 409。发布版定义与编辑定义分开存储，使未发布修改不会覆盖其他用户正在使用的已发布版本。
- 归档模板只保留历史与审计，不允许恢复后直接覆盖发布定义。

## 7. API

### 报表数据

- `GET /api/reports/catalog`
- `GET /api/reports/:reportKey/preview`
- `GET /api/reports/:reportKey.csv`
- `GET /api/reports/:reportKey.xlsx`

预览默认只返回最多 80 行；内部打印模式 `printAll=true` 最多返回 10,000 行，并显示截断标志。XLSX/CSV 导出由服务端按当前用户权限实时查询。

### 模板管理

- `GET /api/reports/templates?reportKey=&projectId=`
- `POST /api/reports/templates`
- `GET /api/reports/templates/:id`
- `PATCH /api/reports/templates/:id`（要求 `expectedVersion`）
- `POST /api/reports/templates/:id/publish`
- `POST /api/reports/templates/:id/duplicate`
- `POST /api/reports/templates/:id/archive`（要求 `expectedVersion`）
- `GET /api/reports/templates/:id/revisions`
- `POST /api/reports/templates/:id/revisions/:revisionId/restore`

### 目标成本导入

- `GET /api/projects/:projectId/budget/import-template.xlsx`
- `POST /api/projects/:projectId/budget/import-xlsx/inspect`
- `POST /api/projects/:projectId/budget/import/preview`（兼容旧 `import-csv/preview`）
- `POST /api/projects/:projectId/budget/import`（兼容旧 `import-csv`）

上传 XLSX inspect 要求 OWNER/MANAGER/ESTIMATOR 权限；业务预检与提交同样再次验证权限、重复编号、父级关系和字段格式。所有导入数据在单个事务中写入，失败回滚。

## 8. 数据库变更

新迁移 `20261015010000_report_template_designer` 新增两个模型：

- `ReportTemplate`：模板身份、作用域、状态、关联项目/所有者、编辑版及发布版 JSON、版本号与创建/更新元数据。
- `ReportTemplateRevision`：版本快照、动作、创建人和时间。

新增外键与查询索引。既有合同、变更、成本、结算、应收应付、收退款业务表和金额口径不变；部署前必须先备份 PostgreSQL，再执行迁移。

## 9. 工程文件

- `apps/api/src/lib/report-data.ts`：报表注册与权限过滤查询。
- `apps/api/src/lib/report-template.ts`：模板契约与校验。
- `apps/api/src/lib/report-xlsx.ts`：原生 XLSX 报表生成。
- `apps/api/src/routes/reports.ts`：目录、预览、模板管理及导出 API。
- `apps/api/src/lib/budget-xlsx.ts`：预算导入模板、ZIP/XLSX 预检与静态值解析。
- `apps/web/src/pages/ReportDesignerPage.tsx`：受控报表设计器、实时预览、打印与版本操作。
- `apps/web/src/pages/ReportCenterPage.tsx`：CSV/XLSX 导出与模板设计入口。
- `apps/web/src/pages/BudgetPage.tsx`：CSV/XLSX 导入、映射、预检与显式提交。
- `scripts/validate-report-studio.mjs`：静态源码契约检查。

## 10. 测试与发布门槛

已有单元测试源：

- `report-template.test.ts`：默认模板、未知字段、隐藏所有列、重复绑定、行列数与合并约束。
- `report-xlsx.test.ts`：真实 XLSX 往返读取、单元格类型、前导零、字符串公式安全、合并、冻结窗格和说明页。
- `budget-xlsx.test.ts`：导入模板、表头与静态值解析、公式拒绝、文件类型与 ZIP 结构检查。

还需在目标环境完成：

1. Node.js 24+ 干净安装及 lockfile 生成/审查。
2. Prisma schema validate/generate 和真实 PostgreSQL 迁移；迁移前备份、迁移后健康检查。
3. API + Web 严格 TypeScript、lint、测试与 production build。
4. 实际 Excel 与 WPS 打开 XLSX，不出现修复提示；核对前导零、金额、日期、冻结、筛选、分页和打印表头。
5. 浏览器 E2E：三种模板作用域权限、版本冲突、历史恢复、整批导入回滚、跨项目访问拒绝、打印与 10,000 行截断。
6. 对 ZIP 膨胀、畸形工作簿、重复编号竞态、并发模板更新进行压力/故障注入测试。

当前开发环境的 Node.js 是 22.16.0，工程要求 Node.js 24+；依赖安装曾因网络超时中断，完整 `tsc`、Prisma、XLSX 实际测试、PostgreSQL 迁移和浏览器 E2E 不得视为已通过。此交付应标记为 `v2.1.0-rc.1` 候选，完成第 10 节全部门槛后再升为正式版。

## 11. 外部项目对照

- ExcelJS：<https://github.com/exceljs/exceljs>，服务端 XLSX 生成/解析基础库。
- Univer：<https://github.com/dream-num/univer>，值得借鉴网格编辑交互；XLSX 和打印需核验 Pro 授权链路。
- Handsontable：<https://github.com/handsontable/handsontable>，成熟交互参考；闭源商业用途需授权。
- 积木报表：<https://github.com/jeecgboot/JimuReport>，复杂报表交互与分页打印参考，嵌入前需核验具体版本授权。
- FineReport：<https://www.finereport.com/>，成熟商业报表能力基准。
- ReportBro：<https://github.com/jobsta/reportbro-designer>，文档式模板设计器参考；需评估 AGPL/商业授权。
