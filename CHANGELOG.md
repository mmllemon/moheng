## v2.19.0-rc.2 Prisma 7 security migration candidate（2026-10-17）

> **当前状态读取说明（2026-10-20）：** 本文件下方按原日期保存历史变更记录；较早条目中的“待合并”“环境限制”或“未完成”描述只代表当时的提交与执行环境，不自动代表当前主干状态。当前集成/缺陷/开发待办以 [产品范围与当前状态](docs/产品范围与当前状态.md) 和 [四阶段开发路线图](docs/后续四阶段开发路线图.md) 为准。

### 2026-11-05 分供付款链路的路由级回归

分供这条链此前只有纯函数测试（`downstream-payment-math`），而它是唯一同时带「累计不超合同额」「退款冲回原付款」「凭证号唯一」「Serializable 重试」四个约束的写路径。新增 `downstream-payment.integration.test.ts`，真实 Fastify 路由 + 真实 PostgreSQL：

| 场景 | 断言 |
| --- | --- |
| 草稿阶段付款 | 409 `DOWNSTREAM_CONTRACT_NOT_PAYABLE`，库中无付款行 |
| 激活后付款 40 万 | 201，金额与录入一致 |
| 同凭证号重复入账 | 409 `PAYMENT_REFERENCE_DUPLICATE` |
| 累计超合同额（再付 70 万 / 100 万） | 409 `PAYMENT_EXCEEDS_CONTRACT`，不留半条付款 |
| 退款 10 万 | 201，净付款 30 万 |
| 退款超原付款剩余额度 | 409 `REFUND_EXCEEDS_ORIGINAL_PAYMENT` |
| 审计 | `PAYMENT_RECORDED` + `PAYMENT_REFUND_RECORDED` 各 1 条，累计净额 400000.00 |
| 两笔 60 万并发抢 100 万 | 只成功一笔，失败方为 `PAYMENT_EXCEEDS_CONTRACT` 或 `PAYMENT_CONFLICT`，净付款仍 60 万 |
| ACTIVE 直跳 SETTLED | 409 `INVALID_STATUS_TRANSITION` |
| COMPLETED 跳 SETTLED | 409 `FINAL_SETTLEMENT_REQUIRED` |

已接进 CI 的 db-integration（`test:downstream-payment:postgres` + `DOWNSTREAM_PAYMENT_TESTS=true`）。本机隔离库连跑 4 次稳定通过。

### 2026-11-05 往来单位身份冲突的浏览器交互验证（含一个布局修复）

把文档里挂了很久的「主体冲突 UI 测试」做完，走的是真实浏览器与真实接口，不是读代码推测：

1. 建一个未核验单位档案（`identityVerified=false`）。
2. 在「新增分供合同」里只输入同名、不从下拉选档案。服务端返回 409 `BUSINESS_PARTY_IDENTITY_UNVERIFIED`（直调接口已先复现），表单内的错误条显示「该名称仅匹配到未核验的单位档案；请先核验法律主体，或明确选择正确的单位档案」，弹窗保持打开。
3. 下拉里该单位标注「未登记统一社会信用代码 · 材料供应商」；选中后提示区显示「已关联统一单位档案 · 信用代码未维护 · 主体待核验」。
4. 再次提交成功，弹窗关闭。

**顺带修的布局缺陷**：`.dialog-footer` 是 sticky 的，实测与 `.form-alert` 重叠 32px，错误文字直接压在「取消 / 创建合同草稿」按钮上；而报错后内容变高、滚动位置不变，提示恰好落在底栏下面。现改为错误条 `position: sticky; bottom: 65px` 并补上底色与描边，实测 overlap 32px → 0。

验证跑完后把测试数据（3 份分供合同、7 个测试单位）从开发库清掉了。门禁 blocking 34/34，`@cms/web` lint exit 0。

### 2026-11-05 业主到账核销与退款的分配回归

接着结算过账那条链路往下补：钱进来之后怎么核销、怎么退回、并发下会不会超额。新增
`apps/api/src/lib/owner-receipt-allocation.integration.test.ts`（真实路由 + 真实 PostgreSQL）：

| 场景 | 断言 |
| --- | --- |
| 部分到账 400/1000 | 201，金额归一到分相等，分配行 +1，状态 `PARTIALLY_RECEIVED`，审计 1 条 |
| 补齐剩余 600 | 201，状态 `RECEIVED` |
| 再入账 0.01 | 400 `RECEIPT_EXCEEDS_CONTRACT_OPEN`，且分配行数量不变 |
| 负向应收登记普通到账 | 409 `RECEIVABLE_NOT_PAYABLE` |
| 期次到账超该期余额 | 400 `RECEIPT_EXCEEDS_SCHEDULE`；400 在限额内则 201 |
| 部分退款 150 | 201，净核销 250，状态回到 `PARTIALLY_RECEIVED` |
| 超额退款 251 | 400 `REFUND_EXCEEDS_RECEIPT` |
| 并发两笔各 600 / 未收 1000 | 只一笔成功，另一笔 400/409；核销合计 ≤ 1000；状态与净核销额一致 |

已接入 CI 的 db-integration（`OWNER_RECEIPT_TESTS=true`）。本地隔离库 1/1 通过。

一件发现：退款路由返回 **201** 而非 200（创建了一条 type=REFUND 的到账记录），我第一版按 200 断言直接红了。这不是缺陷，但说明“写接口状态码”在业主财务这块并不统一（结算动作返回 200、到账/退款返回 201），客户端不能按统一约定处理。

### 2026-11-05 本机环境债收尾：build 临时目录与重复 dev 进程

两件一直干扰判断的本机问题，连同排查方法写进 `docs/开发与部署指南.md` §7。

**构建失败不是源码问题。** `npm run build -w @cms/web` 在 `✓ 5244 modules transformed` 后报
`[vite:esbuild-transpile] remove ...\Temp\esbuild-xxxx: Access is denied`：转译已完成，卡在 esbuild 删除自己的
临时文件（本机 `%TEMP%` 被占用句柄）。把 `TEMP`/`TMP` 指到仓库内目录后构建全过、产物正常。手册给了可复制的
诊断命令，并注明不要在仓库里改构建配置去绕开。

**重复 dev 进程。** 反复重开会话累积了 4 个孤立的 `tsx watch src/server.ts` 与 6 个失效的 npm 包装进程，
只有一个孩子占着 3001。按“只停不持端口的”原则清了 10 个，3001 与 5173 仍监听、`/health` 与首页均 200；
同时释放了 `.tmp-dev.log`（5.6 MB）。API 自己的两个日志仍被运行中的进程持有，属预期，停服后可删。

手册里同时写了禁忌：不要整批 `taskkill /IM node.exe`，会把宿主工具自己的进程一起杀掉。

### 2026-11-05 双 target 门禁重定：第二 target 换旧内核，门禁从 advisory 升为 blocking

桌面壳属于后续阶段，所以不能靠引入 electron 来解这条债。改的是第二 target 的定义与测量方法，不动断言方向。

**两层根因（之前只查到第一层）**：

1. `launchTarget(kind)` 没分支，web 与 electron 启同一个 `CHROME_PATH`，且仓库无 electron 依赖；即便生成 `electron.json` 也是 Chrome 跟自己比。
2. `TARGET=both` 只写 `both.json`，而门禁读 `web.json` + 第二 target 文件 —— “按文档命令生成基线”永远拿不到门禁要的输入。这才是“缺基线产物”的直接成因。

**改动**：第二 target 改为 `legacy`（`LEGACY_CHROME_PATH` → 本机 `ms-playwright/chromium-*` 最大构建号 → Playwright 自解析；当前 Chromium 149 对 Chrome 156）；结果按 target 分写 `web.json` / `legacy.json`；判等改 squircle 感知（两侧都支持则圆角计数必须相等，legacy 不支持则断言退化被如实记录，tabs/面板/骨架/交互仍须相等）；引擎指纹守卫保留。

**顺带修掉的测量缺陷**：`pushState` 后死等 450ms 在旧内核上不够，`/system`、`/system/governance`、`/system/operations` 三页量到的是上一页（36 圆角 / 0 tab）；直接访问这三页两端渲染完全一致。改成等 DOM 连续 350ms 不变后，两端 26 条路由全部逐项相等。

**结果**：`gate-ui-parity` 14 项全过，`selftest-ui-parity` 8/8（新增“旧内核退化必须被记录”与“同引擎冒充必须失败”两个案子），门禁从 advisory **升为 blocking**，blocking 从 33 条增至 34 条。advisory 只剩 `source-bundle` 一条。

未完成：真正跑一次 squircle 退化路径需要一份 Chromium <139 的构建（用 `LEGACY_CHROME_PATH` 指过去即可），本机现只有 149；基线只能本机生成，UI 改动后需重跑 `npm run ui:parity` 并提交。

### 2026-11-05 金额精度的端到端契约回归

把「录入 → 存库 → 读出 → 汇总」这条链一次量完。服务端内部是 BigInt 分，前端已改成按分比较，中间那一跳仍是 JSON number，这层没人测过。

新增 `apps/api/src/lib/money-roundtrip.integration.test.ts`（真实路由 + 真实 PostgreSQL）：

| 环节 | 断言 |
| --- | --- |
| 录入 | `0.01`、`0.02`、`1234567890.12`、`99999999.99` 四条写入均 201 |
| 存库 | Decimal `toFixed(2)` 与录入值逐字相等 |
| DTO 读出 | 四个金额归一到分后与录入值逐分相等；`JSON.stringify` 往返不改变金额 |
| 服务端聚合 | `analysis/three-way` 的 `actualCost`（数据库 SUM）等于 1,334,567,890.14 元，与客户端按分累加一致 |
| 边界拒绝 | `1.005`、`90071992547409.92`、`0`、`-1` 均 400，且拒绝后库里仍只有最初的四条 |

结论：在这台机器上，面向真实金额规模的那一跳没有丢分；上限以上的值已在入口被拦住，不会走到丢分那一步。

已接入 CI（`source-gates.yml` 的 db-integration，环境变量 `MONEY_ROUNDTRIP_TESTS=true`）。本地隔离库 1/1 通过。

### 2026-11-05 业主结算过账的路由级 PostgreSQL 回归

金额契约改完后接着补写路径回归。全仓此前只有两个 `.integration.test.ts`（助手恢复、报表数据），财务写链路一条路由级测试都没有，而这个仓库最贵的事故就在这条链上。

新增 `apps/api/src/lib/owner-settlement-posting.integration.test.ts`：用真实 Fastify 路由（注册 `ownerFinanceRoutes`，jwt + 真实登录会话行）跑一条完整链路，覆盖：

| 场景 | 断言 |
| --- | --- |
| 首次最终结算 100 万、无扣款 | 200，`POSTED`，增量与累计均 100 万，生成 1 条应收 + 1 条过账记录 + 1 条审计 |
| 负向调整 -5 万、无扣款 | 200，负向应收 -50000.00，累计回落到 95 万，过账记录里前值 100 万 |
| 负差额带扣款 | 400 `NEGATIVE_DELTA_DEDUCTIONS`，且应收/过账/审计一行不多，结算单停在 `COUNTERPARTY_CONFIRMED` |
| 正差额但扣款超额 | 400 `DEDUCTIONS_EXCEED_DELTA`，同样不留痕 |
| 同一单重复过账 | 409 `INVALID_STATUS_TRANSITION` |
| 重读余额 | 两条应收净额合计 950,000.00 元，总览回读一致 |

写这个测试时先被自己的 DTO 边界拦住一次：结算 DTO 里金额是 JSON number，我第一版按字符串 `'1000000.00'` 断言全红。改成归一到分比较后通过——这反过来证明金额契约里“number 与字符串两档”的区分是真实存在的。

已接入 CI：`source-gates.yml` 的 db-integration job 增加 `test:owner-settlement-posting:postgres` 这一步，环境变量 `OWNER_FINANCE_POSTING_TESTS=true`。本地隔离库实测 1/1 通过；门禁 blocking 33/33。

仍未覆盖：应收收退款分配与并发幂等、往来单位 409 冲突的浏览器交互、金额精度在 HTTP DTO 与前端往返中的端到端契约。

### 2026-11-04 金额契约：上限收到 JSON 能精确承载的范围，前端改按分比较

先写会红的测试，再改代码。两个实测缺陷：

1. **存储上限大于传输上限。** `contract-amount-math.ts` 把上限写成 DECIMAL(18,2) 的 `10^18-1` 分，但金额在接口与前端是 JSON number，真实天花板是 `2^53-1` 分。实测 `9999999999999999.99` 元经 `Number(centsToMoney(cents))` 变成 `10000000000000000`（丢 1 分）；`9007199254740993.01` 这输入能通过两位小数校验，落库成 `9007199254740994.00` 元。
2. **前端拿浮点结果判断零/正负。** 实测 `0.3 - 0.1 - 0.2 = -2.7755575615628914e-17`，`=== 0` 判不出来。经营总览的净额、资金桶、明细合计行都可能把零差额标成负数或显示 `−0.00万`。

改法：

- `MAX_AMOUNT_CENTS` 保留 DECIMAL(18,2) 的界限给字符串路径（报表、XLSX、助手），新增 `MAX_TRANSPORT_SAFE_CENTS = 2^53-1` 与 `transportSafeCents()` 给接口写入路径；`nonNegativeMoney` / `positiveMoney` / 分供财务的 `nonNegativeMoneyInput`、`signedMoneyInput` 按传输上限拒绝。读取不受限，`moneyToCents()` 仍能精确解析已有数据。
  过程中踩到一次真实冲突：第一个版本把 `calculateEffectiveContractAmount()` 也收到 2^53-1，结果 CI 的 `report-studio-data` 集成回归红了——它拿 `90071992547410.00` 断报表精度，而这条路径输出的是字符串，本来不该受 JSON number 的限制。因此分成两档，并把这个反例写进测试。
- 新增 `apps/web/src/lib/money.ts`：`toCents` / `fromCents` / `isZeroMoney` / `moneySign` / `compareMoney` / `sumMoney`，全部按整数分运算。改到的地方：经营总览（净额、资金桶、月份表）、资金计划下钻合计行、成本分析的净额与图表底部、成本台账合计、目标成本叶子合计、变更生效净额。

测试：`apps/api/src/lib/money-contract.test.ts`（4 条，含 2^53 边界与 JSON 往返）、`apps/web/src/lib/money.test.ts`（4 条，含 0.3-0.1-0.2 与 5000 行 0.01 累加）。API 单测 271 → 275，web 单测 28 → 32。`money.test.ts` 已加入 `web-report-tests` 门禁与 `@cms/web` 的 test 脚本。

浏览器复核：`/`、`/cost/analysis`、`/cost/budget`、`/cost/costs`、`/changes`、`/cost/downstream`、`/cost/owner-finance` 七页无控制台报错、横向溢出 0，金额显示与符号正常（经营总览净额仍为 `−¥5,810,706`）。门禁 33/33，`@cms/web` 与 `@cms/api` lint exit 0。

尚未做：写路径的路由级 PostgreSQL 回归（业主结算负差额、应收过账、退款分配、审计原子性）。全仓目前只有两个 `.integration.test.ts`，财务链路一条路由级测试都没有，这是金额契约的下一步。

### 2026-11-04 UI 双 target 门禁：查清它为什么永远无法变绿，并加引擎守卫

本来要清这条 advisory 债务，结果是：**它清不掉，而且原因比文档里写得更硬。**

`docs/gates/ui-parity/web.json` 在，`electron.json` 一直缺。原记录归因为“缺基线产物”，实际是
`scripts/_targets.mjs` 的 `launchTarget(kind)` **根本没有按 kind 分支**，web 与 electron 启动的是同一个
`CHROME_PATH`；仓库里没有 electron 依赖、没有 main 进程，现有文档也零提及桌面壳。也就是说把
`electron.json` 生成出来，就是拿 Chrome 跟自己比：26 条路由必然逐项相等，门禁变绿，桌面端一行没验。
这正是本仓库反复警告的“把没测读成通过”。

**加的是守卫，不是放宽**：结果文件现在写入 `env.engine`（requested / runtime / signature / desktopShell）；
`validate-ui-parity.mjs` 在逐项比对前先验引擎 —— electron 侧必须 `desktopShell: true`，两侧 signature 必须不同，
否则直接 exit 1 并终止比对，不打印任何“逐项相等”的结论。三种输入实测：老结果（无 engine 字段）exit 1；
两份同一 Chrome exit 1（sameSignature: true）；声明真桌面壳且签名不同 exit 0（13 项全过）。
`selftest-ui-parity` 加了第 7 个案子“stub 冒充桌面端”，必须被拦下，7/7 行为正确。

**债务仍在**，但形状变了：从“没人跑过”变成“前置条件缺失，且伪造产物会被拒”。解除需 owner 二选一：
引入桌面壳（真 electron 依赖 + main 进程），或把第二 target 改成旧版 Chromium（真降级路径是 squircle
在 Chromium <139 静默退化）并接受门禁语义变更。两种都写进了 `docs/门禁债务清单.md`。

门禁 blocking 33/33；advisory 仍是 `source-bundle` 与 `gate-ui-parity` 两条，与之前数量一致。

### 2026-11-04 AI 助手边界状态与体验验收（含窄屏弹窗遮挡修复）

把「用户遇到问题时看到什么」这层逐项造出来验了一遍，顺手修掉一个窄屏缺陷。

**修的缺陷：手机宽度下弹窗被页面操作按钮盖住。** 390×844 实测，「成本助手」顶部右侧那排页面操作按钮（搜索、通知、助手、外观、账户）浮在弹窗上层，把标题右侧和关闭键整个压住。奇怪的是命中测试仍返回弹窗内部元素：看得见被挡、点得到的却是别的层。根因是弹窗 overlay 渲染在 `.app-shell` 里，与页面内容同层叠上下文，页面内容的合成层能盖过它的 `z-index: 8000`。改为 `createPortal` 挂到 `document.body` 后，弹窗成为全局层，不再受任何页面容器影响；桌面 1500 实测无变化（仍居中 1280×820）。

**边界状态逐项实测**（均造成并观察，不是读代码推断）：

| 场景 | 造法 | 结果 |
| --- | --- | --- |
| 配置未就绪 | `enabled=false` | 输入区不渲染，提示仍处于默认关闭的只读试点、启用需管理员配置模型与检查点 |
| 运行失败 | `baseUrl` 指向 `127.0.0.1:9` | 运行 `FAILED` / `ASSISTANT_RUNTIME_FAILED` / 用量 `UNAVAILABLE`，界面提示可重新提交原问题 |
| 断线 | 中断 SSE 一条流 | 出现「页面连接已中断，但服务端任务仍在排队或运行中」+「重新连接」；点击后提示消失、运行指示退出、回答落地 |
| 取消 | 运行中点取消 | 运行 `CANCELLED`，运行指示消失 |
| 空结果 | 0 条预算/成本记录 | 给 0.00 与口径说明，不编造金额 |
| 限流/互斥 | 同会话连投 / 多会话快投 | `409 ASSISTANT_RUN_ALREADY_ACTIVE`、`429 ASSISTANT_USER_RUN_*` 均带中文文案，界面直接透传 |

**体验检查**：390×844 与 768×1024 无横向溢出，关闭键可见可点；Esc 关闭；Tab 循环始终停在弹窗内；输入法合成期按 Enter 不发送（消息数不变）；长消息输入框内部滚动（173/40）；会话列表窄屏可横向滚动（1742/372）。

未覆盖项已写入文档：真实取消的上游中止效果（只验到终态与界面）、45 秒超时未在真供应商上复现、窄屏发送键 30×32 低于 44px 触摸目标。门禁 33/33，`@cms/web` lint exit 0。

### 2026-11-04 AI 助手端到端验收（fake provider + 浏览器）

按路线图阶段三的缺口做了端到端验收。过程中查出两个真缺陷，都修了。

**缺陷一：`project_operating_overview` 每次调用都失败。** 它的分供付款/退款来源写了一句白名单里没有的 scope（`downstreamContract.projectId = requested authorized project; downstream contract deletedAt = null; scan capped at 10000 rows`），写 `tool.completed` 事件时抛 `ASSISTANT_EVENT_SOURCE_SCOPE_INVALID`，整轮回答只能退回 `cost_variance` 单源。修法是把 scope 补进 `ASSISTANT_SAFE_SOURCE_SCOPES`，并加一条用例：从 `assistant-read-only-tools.ts` 里抽出所有 `scope:` 字面量与白名单比对，任何新增来源范围漏登记都会立刻失败（白名单与工具实现分居两个文件，原先没有任何机制对齐）。

**缺陷二：非 UTC 数据库会话让所有时间比较偏 8 小时。** 本机 PostgreSQL 的 `TimeZone` 是 `Asia/Shanghai`，Node 写 `2026-11-04T11:28:29.070Z`，库里落成 `11:28:29.07+08`（真实时点偏早 8 小时）。Prisma 读回来又是 11:28Z，所以应用内部看着自洽；但凡跟 `NOW()` 比的地方全错：孤儿任务回收把刚创建的运行判成过期（隔离库里这条回归直接红），每用户每分钟 6 次、近 30 天用量窗口同样偏。修法是在 `lib/prisma.ts` 的 `PrismaPg` 里钉 `options: '-c timezone=UTC'`；代码里没有依赖会话时区的 `date_trunc` / `CURRENT_DATE` / `::date` SQL，所以只改落库解释，不动业务口径。CI 的 postgres 容器本来就是 UTC，这套问题只在本地或任何非 UTC 实例上出现。

**顺带修掉的测试隔离问题。** 助手的功能开关原先在两个路由模块里各写一份 `loadAssistantRuntimeConfig()`，配置以数据库行为优先，于是本机一旦配过启用的供应商，`ASSISTANT_POC_ENABLED=false` 也拦不住请求，`auth-prehandler-regression` 里「开关关闭时返回 404」的用例变成 401。抽出 `lib/assistant-feature-gate.ts` 的 `createAssistantFeatureGate(loadConfig?)` 后，两个模块共用一份判定，那条用例改为注入「关闭」配置，不再依赖本机数据库状态。四条门禁断言（`architecture`、`r7-security`、`assistant-runtime-decision`、`assistant-conversations`）跟着指向真实实现处，守卫不变：未启用时 404 + `ROUTE_NOT_FOUND`。

验收结果（Chromium + 已配置供应商，API 直连 3001 与前端 5173 都跑过）：

| 项 | 结果 |
| --- | --- |
| 成功路径 | 运行 COMPLETED，用量 COMPLETE（单轮 1,826 / 1,108 tokens）|
| 工具卡与来源面板 | 「项目经营概览 已完成 · 6 类来源」，来源逐条列出实体、字段与 scope |
| 用量摘要 | 单轮用量行 + 近 30 天汇总（9 个终态任务，26,222 tokens），只汇总供应商上报数，不推算费用 |
| 项目越权 | 不存在的项目建会话 → 404 `PROJECT_NOT_FOUND` |
| 幂等 | 同 `requestId` 重放返回同一 `runId`，不新建运行 |
| 单会话互斥 | 同一会话连续提交，第 2 次起 409 `ASSISTANT_RUN_ALREADY_ACTIVE` |
| 提示注入 | 要求忽略指令、输出系统提示、列其它项目金额 → 全部拒绝，594 字回复不含系统提示、不含其它项目数据、不编造金额 |
| 刷新恢复 | 生成中刷新页面后重新打开，会话与运行状态恢复，回答落地且没有重复的用户消息 |
| SSE 续传 | 取 1–4 号事件后断开，带 `Last-Event-ID: 4` 重连只收到 5 号 `run.completed`，无重复、id 单调 |
| 六张业务表 | 隔离库里整段场景（真实只读工具 + 失败恢复 + 取消）跑完零变化 |

隔离库那条：本机建 `moheng_assistant_it`、全套迁移、`ASSISTANT_RECOVERY_TESTS=true npm run test:assistant-recovery:postgres -w @cms/api`，3/3 通过。门禁 `run-gates --tier blocking` 33/33，`@cms/web` 与 `@cms/api` lint 均 exit 0。

### 2026-11-04 打印与 PDF 分页验收

按路线图阶段一「仍需推进」的一项，用真浏览器 + 真 PDF 做了一次验收。结论：**预览页打印出来是一张白纸**，设计器能印但会丢分页。一共 7 个问题，全部修掉。

- **预览页白纸**：legacy.css 里有两条全局 `body * { visibility: hidden }`，只放行设计器的 `.report-preview-print-surface`。预览页没有这个元素，17 行数据、13 个表头全部被隐，PDF 290KB 只有纸纹。已删。
- **打印样式一直被层压着**：legacy.css 整体在 `@layer legacy` 里，而 hana.css 无层——层叠里无层规则永远优先。预览页那段 `body:has(...) .app-sidebar { display: none }` 从 2026-08 加上就没生效过（实测打印时 `.app-sidebar` 仍是 `display:flex`），外壳是靠上面那条“隐藏一切”顺便没印出来的。
- **v6 的打印块是空转**：写的是 `.sidebar / .topbar / .main-shell`，这三个类名 2026-08 改版后已不存在（现在是 `.app-sidebar / .app-titlebar / .app-main`）。
- **第 2 页起不参与分页**：外壳 `.app-shell / .app-main / .app-content / .route-transition` 高度钉在 100vh（内部滚动），221 行的表只印出第一页 10 行，其余 22 页空白。打印时改为 `height: auto`。
- **表头不重复、行被拦腰切断（关键）**：`.app-content > .route-transition` 上有顶栏渐隐的 `mask-image`。带 mask 的元素会被合成成单独绘制层，Chrome 就不再跨页切分它内部的内容 —— 把所有中间层改成 `display: contents` 就好了，证明病的不是布局而是合成层。打印时去掉 mask 后：221 行 → 23 页，第 2、5 页都有表头，行完整。
- **设计器 1 张纸印出 9 页空白**：旧方案用 `visibility: hidden` 隐藏界面，元素仍占高度。改成按块 `display: none`（工具条、属性栏、卡头、底注），只留纸张面；「完整报表」路径的 `.report-print-all` 原来被整块藏掉（它和屏上预览同在一个 panel 里），改成只藏 `.report-preview-viewport`。
- **纸纹每页重复**：纸纹是 `body::before/::after` 的 fixed 图层，打印时必须关掉。

重写后的打印样式集中在 `hana.css`（无层，压得住）分三组：通用外壳（侧栏、顶栏、纸纹、工具条、按钮、标签栏不上纸，业务页保留页名）、预览页纸张（卡片去壳、表格撑满、表头每页重复、行不拆）、设计器纸张。

复核（Chromium headless，`page.pdf({ preferCSSPageSize: true })`，再用内置 PDF 查看器回看）：

| 场景 | 结果 |
| --- | --- |
| 预览 目标成本清单（17 行） | A4 横向 842×595pt，2 页，元信息条 + 标题 + 表头 + 表格 + 页脚齐全 |
| 预览注入 221 行 | 23 页，第 2 / 5 页均有重复表头，行不跨页 |
| 8 张标准台账（真数据） | 1–2 页不等，均有内容 |
| 设计器直印（屏上纸） | 1 页，只有纸张面 |
| 设计器「完整报表」 | 1 页，`.report-print-all` 生效（该项目 0 行） |
| /changes、/cost/downstream、/parties、/cost/analysis | 1–3 页，外壳/按钮/工具条/纸纹都不上纸，页名保留 |

门禁：`validate-report-studio-v2` 里两条钉字面串的断言（`.report-preview-table.repeat-header thead { display:table-header-group; }`）改成正则，允许作用域前缀与 `!important`。`run-gates --tier blocking` 33/33，`@cms/web` lint exit 0。

未覆盖：无。工作室预览（`studioTemplateId` 路径）本轮已补验：用工作室页面真实保存一个项目级模板（默认 A4 横向），再通过 `PATCH /reports/studio/templates/:id` 把 `page` 改成 A3 纵向（`pageSchema` 是严格对象，只能写 paper/orientation/fitToWidth/includeMetadata/footerText 五项），注入到 180 行后出 PDF：`@page` 为 `size: a3`、MediaBox 842×1191pt、共 6 页，第 2 页起重复 3 行表头，外壳不印、卡片去了壳。验完把测试模板连同 2 条修订记录删干净。

### 2026-11-04 成本分析页收进台账卡，测卡头的 hook 退役

全站最后一块「假卡」在 `/cost/analysis`：卡面是 `::before` 按运行时测出的 `--panel-head-h` 从卡头底部画出来的，靠 `Layout` 里挂的一个 MutationObserver 监听全站 DOM。本轮把它换成真卡，那个 hook 连同它维护的 CSS 家族一起删。

- **五个面板改三件套**：卡头提到卡外（`ldg-section-head`，h2 14.4/600），图表与明细放进 `ldg-section-card.an-panel`。`an-panel` 保留为卡体类，内容选择器（`.analysis-page .an-panel X`）不用改；它自己的边框/圆角/底色去掉，改由 `.ldg-section-card` 提供，内距 16/18。
- **同行卡顶底对齐**：清单偏差的说明原本折两行（卡头 60），与右侧成本构成（42）错开 17px。说明改为「按实际发生额取前 N 项」，细框/实条由右侧图例表达；卡头统一 42 后两卡顶对齐。月度成本卡比完工估算矮 211px，区块改 flex 列、卡体 `flex: 1` 填满，两卡底边也对齐。
- **删 hook**：`lib/use-detached-panel-headers.ts`（54 行）删除，`Layout.tsx` 的 import 与调用一并去掉。以后新增区块不用担心被一个全局 observer 改写类名。
- **删样式**：`.panel-detached` 与 `.an-panel-head` 相关规则从 `hana.css` 删 59 条、摘掉 70 个选择器（含 `.settings-content` 下两条卡头对齐、卡内 `--panel-head-h` 画布、各页 `> :not(...)` 外边距）；`v6.css` 的 `.an-panel`（1px 上边线 + 12px 上内距）与 `.an-panel-head*` 四条基础皮肤删除；两处失效注释同步清理。
- **门禁**：`validate-ui-polish` 的「section headers sit outside body cards」改为断言 `.ldg-section-head` / `.ldg-section-card` 存在且 `Layout` 不再引用该 hook。
- 复核（1600 视口）：五个区块卡头均 42、h2 14.4、卡头到卡 16、卡内 16/18、圆角 14.7272；第一行两卡 273→409、第二行两卡 515→950，顶底均对齐；资金计划 664 通栏。扫 12 条路由（含报表、设置窗、台账页）无控制台错误、无残留 `.an-panel-head` / `.panel-detached`、横向溢出 0。`run-gates --tier blocking` 33/33，`@cms/web` lint exit 0。

### 2026-11-04 报表工作室两栏卡对齐

`/reports/studio` 左栏（数据绑定）与右栏（工作簿编辑器）顶边差 16px、底边差 10–126px，卡片看起来永远错位。原因两条，都在壳上，没碰编辑器内部。

- **顶边 16px**：`hana.css` 的 `.panel + .panel{margin-top:16px}` 是旧页堆叠 panel 的间距，业务页迁完后全站只剩这一处还有相邻 `.panel`，结果把右栏顶下去了。改为在 `.report-studio-workspace` 作用域内归零。
- **底边对不上**：左栏上限是 `calc(100vh - 170px)`，右栏高度是 `min(76vh,900px)` 画布加卡头与内距，两个表达式除 1142 高外永不相等（1100 高差 10px，1400 高差 126px）。现改为两栏读同一个画布高度：右栏 `min(76vh,900px) + 104px` 定高、画布 `flex: 1` 填满；左栏 `contain: size` 不参与行高计算，内部滚动。卡头文字在窄列里折行时由画布让出高度，不再靠常量校对。
- **窄屏还原**：800 以下两栏上下排列（legacy 已把网格收成单列），`contain` 与定高一并撤销，画布回到 620/460。
- **顺带修一个失效选择器**：`.app-content:has(.report-studio-layout)` 里的类名在 2026-09 已改为 `.report-studio-page`，那条“双栏工作区铺满”从那时起就没生效，工作室一直卡在 720 正文列（编辑器只剩 335px）。改回真实类名后与设计器、预览页一致。
- 复核（页面宽度默认 720 档）：1600×1100 下 `.page-wrap` 720 → 1348，配置卡 1292×158，两栏卡均 300→1240；1600×1400 均 300→1304；1200×900 均 300→1088（卡头折行，画布让出 17px）；780×800 单列还原，编辑器画布 620。五种尺寸下两栏顶底完全相等、无裁切、横向溢出 0。`run-gates --tier blocking` 33/33，`@cms/web` lint exit 0。

### 2026-11-04 清掉 `.ds-section` 死样式

`Section` / `DataPanel` / `CardHead` 退役后，它们那套壳的 CSS 已无任何元素命中。本轮只删样式，不动渲染。

- **`hana.css`**：删除「Hana 区块节奏」整块（`.ds-section` / `.ds-section-head` / `.ds-section-copy` / `.ds-section-actions` / `.ds-section-card` / `.ds-card-pad`，共 40 行）；三处分组选择器里摸掉 `.ds-section-actions .button`（字号与 32px 同高两条）与 `.ds-section-card` 的成员（空态去边框、卡内表格 18px / 16px / 窄屏 12px 三档）；`.panel.ds-panel .data-table` 两条同样无人命中，一并删除。`.v6-block .data-table` 等同组活选择器保留。
- **`stat-metrics.css`**：删除 `.ds-section-card .owner-finance-metrics` 的分隔线两条、区块卡去壳的 `:has()` 三条，以及 `.ds-section-card .metrics` 一个成员；原来编号七的段落空了，后续两节遂位改为七、八。
- 两处文档注释里的旧举例（「它和 ds-section-card 半径相同」、间距清单里的 `.ds-section 30px`）同步改成现存形态。
- 复核：`/cost/owner-finance`、`/system`、`/reports`、`/` 四页控制台无报错、横向溢出 0；空态仍不在卡内画第二层边框，指标条分隔线与卡内表格 18px 不变。四份样式文件过 postcss 解析无误，`run-gates --tier blocking` 33/33，`@cms/web` lint exit 0。

### 2026-11-04 成本分析页卡头向台账几何靠齐

`/cost/analysis` 是最后一个用另一套卡壳的业务页：`.an-panel` 靠 `useDetachedPanelHeaders` 在运行量卡头高度、用 `::before` 从卡头底下画卡面。结构本轮不动（页内图表都是自定义绘制），只把壳内几何改到与台账同一档。

- 卡头 `h2` 从 16px / letter-spacing .04em 改为 `--fs-body`（14.4）/ 600 / 0；卡头与卡面的间隙 10 → 16，卡内左右 16 → 18，首块与末块上/下 16，`.an-grid` 间距 20 → 24。
- 复核（1600 视口）：五个面板 h2 均 14.4/600、卡头到卡 16、首块距卡边 18；两列 358 / 282（gap 24），纵向 203+24 相接；页面横向溢出 0、控制台无报错。`run-gates --tier blocking` 33/33。

### 2026-11-04 报表设计器与预览页换台账卡，Ui 的三个旧卡壳组件退役

第三批之后，全仓还挂着 `.panel` 卡壳的业务页只剩报表链路。报表工作室（`/reports/studio`）内部是第三方 Univer 表格，按 `docs/组件不变量.md` 继续豁免；设计器、预览页与报表中心的外框这一轮全部换掉。

- **报表设计器**：顶部工具条与筛选条各是一张完整的卡，保留 16px 内距；「模板属性」与「实时预览」两块工作区卡体归零，分区线因此能拉通到卡边（原来 16+16 双内距，分隔线是缩进的）。页面按 100% 宽度铺开，右栏预览纸从 160px 恢复到 863px。
- **报表预览**：元信息条改 `ldg-section-card` 并补 18px 横向内距；表格「纸」与标准台账面卡体归零，表头与页脚跟着退到 18px。纸面表格原先靠 `.panel` 的 16px 内距缩进，卡体归零后会贴着卡边（实测表头 x 与卡内边重合），这条必须补。页面按台账宽度档（1240）走，九列台账不用把项目名折三行。
- **分供合同台账（/cost/downstream）**：最后一处 `<Section>` 换成 `ldg-section` 三件套，卡头改 14.4px 并补计数。操作列原本六个按钮一行，min-content 推到 1229（卡内可用 1148，横向滚 83px，最后一列被裁）；允许 `.row-actions` 换行后表 1146、`scrollWidth - clientWidth` 为 0。底部两条口径说明从 16px 收到 18px。
- **三个旧卡壳组件退役**：`Ui.tsx` 的 `Section`（`ds-section` 三件套）、`DataPanel`（`.panel` + `CardHead`）、`CardHead` 已无调用方，一并删除。`validate-ui-polish` 里那两条断言原本在保护 `.ds-section-head` / `.ds-section-card`，改为校验 `ldg-section-head` 与 `.ldg-section-card > .table-scroll .data-table`，让门禁盯住真正在用的那套壳。
- 复核（1600 视口）：/reports/designer `.page-wrap` 1348，四卡 1292×90 / 1292×88 / 415×879 / 863×449，卡体 0 与 16 两种内距按设计分流，圆角 14.7272、残留 `.panel` 0、横向溢出 0；/reports/preview `.page-wrap` 1240，元信息条 1184×77（内距 16/18）、标准台账面 1184×1298（卡体 0），表 1119 起于卡内边 +18；/cost/downstream 卡 1184×235、表 1146 无横滚、卡头到卡 16、横向溢出 0。三页控制台无报错。`run-gates --tier blocking` 33/33，`@cms/web` lint（`tsc --noEmit`）exit 0。

### 2026-11-04 业务页第三批：项目驾驶舱、项目成员、系统管理概览

第三批三个页面。驾驶舱与成员页是「带卡头的业务区块」，系统概览页是「指标格 + 入口卡」，后者在设置窗里已经长成真卡，只是还挂着 `.panel` 这个类。

- **项目驾驶舱**：hero 改 `ldg-section-card`；月度成本图与待跟进业务拆成 `ldg-section` 两列，卡头挪到卡外（h2 带 `Activity` / `CircleAlert`），两列里的 `.ldg-section` 底距归零；分供合同与付款概览改成卡头 + 三格指标带。图表卡内距 16/18/18（原来靠 `panel-detached` 的 16px 外边距），待跟进行与说明条的 16px 收到 18px，跨列分隔线同步。
- **项目成员与权限**：项目横幅改 `ldg-section-card`；「添加成员」与「角色边界」两张卡拆成 `ldg-section` 两列，卡内 17/18/18（`legacy` 里 `.members-two-column > .panel{padding:17px}` 换壳后不命中）；成员表卡 `padding: 0`，表 1146。
- **系统管理概览**：4 个指标卡与 5 个工作台入口共 9 处 `panel` 换成 `ldg-section-card`。这 9 个元素本来已经是真卡（边框、圆角、底色都来自 `.panel` 与四条 `article.panel.*` 规则竞争），所以 `stat-metrics.css` 里 30 处 `article.panel.X` 选择器同步改为 `article.X`，保持它们之间的优先级关系不变。实测指标卡 327×102、内距 14/16（原 16，`panel-detached` 时期那条兑底不再生效）、底色从透明改成卡色；入口卡 330×64 与 670×64、12/14 不变。
- **报表工作室（/reports/studio）未动**：内部是第三方 Univer 表格组件，`docs/组件不变量.md` 已把它列为故意豁免项（改升级会丢），本轮只保留外框，不再往里穿透。
- 复核（1600 视口）：/cost hero 664×274、图表卡 370×347、待跟进卡 270×292、分供概览卡 664×86；/projects/members 横幅 1184×95、两列卡 585×279 与 585×309 顶对齐、成员表卡 1184×134；/system 四张指标卡 327×102、五个入口卡 330/670×64。三页 `leftoverPanel` 均 0、卡头 42、卡头到卡 16、圆角 14.7272、页面横向溢出 0、控制台无报错。`run-gates --tier blocking` 33/33，`@cms/web` lint（`tsc --noEmit`）exit 0。

### 2026-11-04 业务页第二批：实际成本、分供合同财务、进度款、报表中心

第二批四个页面的 `.panel` 壳换台账卡。这四页的旧壳分三类：`.panel.data-table-panel` + `.panel-heading`（成本、进度款）、每份合同一张 `.panel` + `.panel-heading`（分供财务）、`.panel` 当按钮/工作区壳（报表中心）。

- **实际成本**：`div.panel.data-table-panel` 拆成 `ldg-section` + `ldg-section-card cost-table-card`，h2 带 `Receipt`，筛选计数进说明行，右侧留「清除类型筛选」。工具条原本靠 `.panel.data-table-panel.panel-detached > .table-toolbar` 给 12/18 内距与 18px 缩进的分界线，换壳后这两条不命中（回落成 `.table-toolbar` 的 17px 内距 + 通长底线），页面作用域补回。
- **分供合同与付款**：每份合同一个 `ldg-section`，合同编号与名称进 `ldg-section-head`，右侧三个按钮留在卡头；卡体 `padding: 0`，指标条退 18px、四个 `details.finance-section` 从 17px 收到 18px，末块补 6px 底距。`legacy.css` 里 `.downstream-finance-contract > .panel-heading` 四条与窄屏反向规则同步改到新宿主。
- **进度款**：申报记录与到账明细两张卡，表 1146 / 左 347（卡 1184 + 18px）。`.payments-panel` 的 16px 上边距保留，与 `.ldg-section` 的 24px 相邻回落成 24。
- **报表中心**：两个 `button.panel.report-studio-entry-card` 换成 `ldg-section-card`，但这两张卡本来是指标条写法（`html .report-studio-entry-card` 把边框、圆角、底色全清掉只留 1px 左边线，`html body ... > :first-child` 又把首格左边线与左内距清零），必须用 c=3 的选择器才能压过；入口容器自身那两条上下通长线与 16px 内距一并归零。`section.panel.report-standard-workspace` 拆成 `ldg-section` + `ldg-section-head`（h2 带 `FileSpreadsheet`、右侧胶囊）+ `ldg-section-card`，`report-standard-layout` 的内距从 `.panel.panel-detached > …` 的 14/16/16 改到卡内 16/18/18，两列变 250 + 34 + 342。`report-workspace-section` 这层 flex 壳删掉，否则 `gap: 8` 会顶掉卡头到卡的 16px。
- **卡内空态统一 18px**：新增 `.ldg-section-card > .empty-state { padding-left/right: 18px }`，与表格同宽。
- 复核（1600 视口）：/cost/costs 卡 664×278（空态）、卡头 42、卡头到卡 16、工具条 12/18；/cost/progress-bills 两卡 1184×83 与 1184×68、表 1146 无横滚；/cost/downstream?view=finance 卡 664×397、指标条与展开区均自 18px 起；/reports 两张入口卡 324×121.6（gap 16）、标准台账卡 664×516（两列 250 / 34 / 342，胶囊与卡头底边对齐）。四页 `leftoverPanel` 均为 0、页面横向溢出 0、控制台无报错。`run-gates --tier blocking` 33/33，`@cms/web` lint（`tsc --noEmit`）exit 0。

### 2026-11-04 业务页起手四页：待办、变更签证、主合同、往来单位详情换台账卡

设置窗与往来单位库收完后，全仓只剩一套「台账卡」和一套 `.panel`（尚未迁的 12 个业务页）。这 12 页的卡壳靠 `use-detached-panel-headers` 在运行时量标题高度、用 `::before` 从标题底下画假卡面，卡头在卡内、内距 16px，与台账页的「卡头在卡外 + 卡内 18px」不是一回事。本轮先迁四页验证口径。

- **待办与预警**：`section.panel.notice-list-panel` 拆成 `ldg-section` + `ldg-section-card notice-list-card`，卡头留在卡外（h2 带 `BellRing`，计数进说明行）；筛选胶囊从卡头旁边挪到 `.ldg-section-head` 右侧，样式按新宿主重写（`.notice-filter-group` 及其 button / button.active / svg 四条），`align-items: flex-end` 下胶囊底边与 h2 对齐。卡体 `padding: 0`，列表自己撑 `16px 18px 10px`。
- **变更签证台账**：`section.panel.change-table-panel` + `CardHead` 换成三件套，h2 带 `FileCheck2`，右侧 `{changes.length} 条`。空态嵌在卡内，不再画第二层边框。
- **主合同**：空态与 hero 两张 `section.panel` 改 `ldg-section-card`（各自自带背景与排版，不再叠 `.panel` 的 16px）；「合同关键条款」拆成 `ldg-section` 三件套，字段网格改由 `.ldg-section-card > .owner-contract-detail-grid` 给 18px。
- **往来单位详情**：`section.panel.business-party-profile-hero` 改 `ldg-section-card`，保留自己的 20px 内距。
- **补 18px 是必须的**：`.panel` 的 16px 内距和 `.panel.panel-detached > :not(...)` 的 16px 外边距是旧对齐来源。合同条款网格换壳后这两条都不生效，首列文字距卡边只剩 1px，两个 `span-detail-wide` 的横线甚至溢出卡外 15px。现在卡体给 18px，跨列项负边距与内距一起从 16 收到 18（`stat-metrics.css`），行首格清零，实测各行首格文字距卡边统一 19px（原为 33 / 1 / −15 三种）。
- 复核（1600 视口）：/notifications 卡 664、卡头到卡 16、圆角 14.7272、页内残留 `.panel` 0、横向溢出 0；/changes 同规格，空态卡 664×222；/contracts hero 与条款卡 664，条款网格四行首格 19px 对齐；/parties/:id hero 1184×127（padding 20）、四个区块卡头均 42。控制台无报错。`run-gates --tier blocking` 33/33，`@cms/web` lint（`tsc --noEmit`）exit 0。

### 2026-11-04 最后一页：个人中心与账号安全、往来单位库改用台账卡，SettingsSection 组件退役

设置窗十二页统一后，设置窗外还剩两页在用 `SettingsSection`（Hana Section 组件的 1:1 复刻）：`/account/security` 与 `/parties`。它们是这套组件的最后两个使用者，卡头 16px、卡内 16px、区块节奏 40px，与台账页的 14.4px / 18px / 24px 不是一回事。本轮把这两页收进台账结构，组件连同它的 CSS 一起删掉。

- **两页改用 `ldg-section` + `ldg-section-head` + `ldg-section-card`**：账号安全页 3 块（当前账号、登录凭据、会话与恢复）、往来单位库 1 块（台账）。计数、说明改走 `.ldg-section-count` 与卡头 `<p>`。
- **`SettingsSection` 彻底退役**：删除 `components/SettingsSection.tsx` 与 `SettingsSection.module.css`（168 行）；`Ui.tsx` 里同名但无调用方的死导出一并删；`hana.css` 的 `.settings-section*` 规则族（含 `.settings-section-card` 的 padding / 圆角 / 表格内距、`.settings-section-head` 的卡头几何、`.settings-section-actions .button` 的两处合并选择器）共 20 余条规则、`stat-metrics.css` 里那一条去壳规则一并删除，`.page-wrap > [class*="_section_"]` 兜底也没人再命中。保留下来的只有仍在用的 `.settings-subhead`。
- **设置窗外补 18px**：这两页不经过 `.settings-content`，卡内 `.settings-row` 原本 16px。页面作用域规则把行左右退到 18px、分隔线同宽、首行上内距 16px，与设置窗内口径一致（实测 `padding-left: 18px`、首行 `padding-top: 16px`）。
- **往来单位台账工具条换 `.ldg-toolbar`**：原是 `.table-toolbar`（内距 12/17、6% 通长底线），换成台账共用件（12/18、分界线两边内缩 18px）；搜索框从 `.toolbar-search` 换 `.ldg-search`（285 × 32，图标与输入框同层）。表格 `width: calc(100% - 36px)` → 1146，`scrollWidth - clientWidth` 实测 0；空态嵌在卡内不画第二层边框。
- 迁完后全仓只剩一套卡壳（`ldg-section-card`）与 `.panel` / `.ds-section-card` 两类业务壳，不再有三套并存。
- 复核（1600 视口）：账号安全页卡宽 704、卡头 42（h2 14.4/600）、卡头到卡 16、圆角 14.7272、区块间距 24、页面横向溢出 0；往来单位库卡 1184×659、工具条 12/18、表 1146 八列、空态 220、区块间距 24、控制台无报错。授权复核页（同类选择器被删）复查：三张 scope 卡仍一行三列（183/269/193，gap 12）、公司角色两列 334、页面横向溢出 0。`run-gates --tier blocking` 33/33，`@cms/web` lint（`tsc --noEmit`）exit 0。

### 2026-11-04 系统设置窗六页：账号、登录安全、权限与流程、AI 助手、操作追溯、界面

设置窗内上一批四页换到 `ldg-section` 三件套后，剩下六页还在用三套不同的卡壳：账号、登录安全、权限与流程用 `.panel` + `.panel-heading`（卡头在卡内、卡内缩进 16px），操作追溯与界面用 `SettingsSection`，AI 助手是自定义 grid 外壳。切页签时卡头高度与表格左边线能看到跳动。本轮把这六页也收到与台账页同一套几何。

- **六页全部改用 `ldg-section` + `ldg-section-head` + `ldg-section-card`**：账号页 3 块（创建、重置、列表）、安全页 2 块、策略页 3 块、助手页 2 块（供应商、接入检查）、审计页 2 块（筛选、流水）、界面页 3 块；页面根统一加 `system-expansion-page` 压掉旧页级 `display: grid`。计数一律 `.ldg-section-count`。`SettingsSection` 组件本轮未动（当时往来单位库、AccountSecurity 仍在用），同日下一条已将它退役。
- **两处旧结构必须留住**（`validate-ui-polish` 断言）：账号页的 `.sys-split` / `.sys-split-main`（设置窗内把 gap 归零，让 `.ldg-section` 的 24px 成为唯一间距），AI 助手页的 `.assistant-provider-shell`（轨道 190 → 168px，详情区 480 → 502px；`assistant-provider.css` 里那两条 `:has(.assistant-provider-page)` 的左右 24px 补丁一并删掉，`page-wrap` 回到 670）。
- **七张多列表格改自动布局**：`.settings-content .data-table` 的 640px 下界与固定列宽在 632px 卡内必溢出。账号表挂 `system-fluid-table` 后 745 → 632（管理列按钮不再被挤出可视区）；安全页 6 列表 640 → 632，另补单元格内距 8px（6 列共省 24px，min-content 落到 632 以内）；策略页权限矩阵 `min-width: 780` → 632；审计流水表保留 `table-layout: fixed`（列宽有设计意图），只把 `min-width` 归零，640 → 632。所有表 `scrollWidth - clientWidth` 实测 0。
- **审计页两处真缺陷**：业务对象列 108px，枚举名 `SystemAuthorizationReview` 会溢出单元格叠到操作类型列上，切到单行省略；同时补 `SystemAuthorizationReview` 与 `AUTHORIZATION_REVIEW_CREATED/COMPLETED` 的中文标签（原本显示裸枚举名与 `AUTHORIZA…`），现在是「授权复核 · 保存复核快照」。
- **AI 助手接入检查改成「summary 当卡头」**：原来是 `<details>` 套一层自带卡头的面板，卡头在卡内，与上方供应商卡错开 18px。现在 `summary` 直接做成 `ldg-section-head`（h2 + 可启用/待完善胶囊），卡体是 `ldg-section-card`，折叠时显式 `display: none`（实测不写这条会溢出 177px）；五项检查从两列换单列，避免 234px 一列里「缺少 ASSISTANT_ENCRYPTION_KEY」折四行。
- **卡内一律 18px / 首块 16px**：审计筛选卡、流水卡改 `padding: 0` 交给行与分页自缩；界面页三卡的行与两块样张退到 18px；账号页重置卡保留原来的 accent 38% 强调边框（实测 `border-color` 与普通卡不同），姓名列不再折行（「商务经理（演示）」原会断在括号中间），表格仍 632 无横滚。
- 卡头右侧的图标按钮（重置密码卡的取消）在设置窗内改 `align-self: center`，flex-end 会把 28px 图标沉到说明行下面。
- 复核（1600 视口）：六页 `.page-wrap` 均 670、页面横向溢出 0；卡头到卡 16、圆角 14.7272、区块间距 24。账号两卡 670×263 / 670×177、表 632 六列；安全卡 670×1253、事件页签 670×802；策略卡 670×1419（权限矩阵 5 列 632）、流程页签 670×679；助手卡 670×548、轨道 168 + 详情 502、接入检查展开 670×775；审计筛选卡 670×364、流水卡 670×1324、表 632 七列（变更摘要列按设计隐藏）；界面三卡 670×311 / 419 / 223。`run-gates --tier blocking` 33/33。

### 2026-11-04 系统设置余下四页：换真卡、多列表格改自动布局

授权复核、基础字典、运维备份、参数配置这四页还在用旧的卡壳（其中授权页是 `.settings-section`）。上一轮把概览与治理页换到 `ldg-section` 三件套后，同组五页里就剩它们是另一种卡头和内外距，切换页签就能看出卡头高度、表格左边线在两处不一致。本轮收尾。

- **四页全部改用 `ldg-section` + `ldg-section-head` + `ldg-section-card`**：授权页 4 块、字典页 4 块、运维页 3 块、参数页 3 块。计数一律改 `.ldg-section-count`。授权页删掉 `SettingsSection` 引入（共享组件本身不动，避免影响账号管理、登录安全等页）。
- **「访问边界」不套卡壳**：三张 scope 卡自带边框底色，外层再画一层就是卡片套卡片，用 `.ldg-section-card:has(> .system-authorization-scope-grid)` 去壳，与概览页同一思路。
- **多列表格改回自动布局**：`.settings-content .system-expansion-table` 的 200/190/250 固定列宽是为三列授权矩阵写的，5 列以上会被压到 0 宽再被裁。治理页原有的 `system-governance-table` 例外规则推广为 `system-fluid-table`（`table-layout: auto; min-width: 0`），四页共 5 张表挂上这个类，`legacy.css` 里对应的 `:not(...)` 排除项同步改名。
- **卡内一律 18px**：授权页的公司角色块、统计条、复核表单、复核记录表、内嵌提示，字典页的目录行与字典项行，运维页的操作指引与记录区，原来按 16px 或 14px 写，统一到卡头与表格的 18px；卡片首块补 16px 上边距。实测授权页公司角色块 `padding-top: 16px / padding-left: 18px`，表宽 632、左 588。
- **去掉三处叠加间距**：字典页 `system-dictionary-layout` 与运维页 `system-ops-lower-grid` 的 gap 归零、字典页 `system-dictionary-create` 的 24px 上边距归零（`.ldg-section` 自带 24px，叠加后是 48px）。
- **卡头右侧不参与压缩**：670px 内容区里长说明会把卡头右侧的计数、按钮挤成两行，`.system-expansion-page .ldg-section-head > :not(:first-child)` 加 `flex: 0 0 auto` + `nowrap`。
- 复核（1600 视口）：五页所有卡宽 670、卡头 42（说明长时 60）、卡头到卡 16、圆角 14.7272、区块间距 24；表格 632/左 588、`table-layout: auto`、单元格与滚动容器溢出均为 0；运维三卡 570/273/346，字典四卡 248/212/1092/267，参数三卡 617/191/146，授权复核记录卡 163、快照详情卡 865；页面横向溢出 0。`run-gates --tier blocking` 33/33。

### 2026-11-03 系统管理概览与系统治理：换真卡、去掉叠加内距

系统设置窗里这两页还在用 `.panel.panel-detached`：卡面靠 `::before` 从标题底下画，标题与卡之间隔着 16px 兜底 margin，卡内各业务块又自带 18px 内距，两者一叠加就是 32~34px，和台账页放在一起像缩进对不齐的草稿。现按台账页统一。

- **概览页**：`需要关注的安全事件`、`当前治理能力` 两块改成 `ldg-section` + `ldg-section-head` + `ldg-section-card`，删掉 `.system-overview-two-column` 这层两列包裹（它在这个窗口里只剩一列宽，却还留着 grid 的最小列宽与 24px 间距）；新增 `.ldg-section-link` 承载卡头右侧「完整安全中心 →」，图标 17 → 16 与标题同高。
- **治理页**：5 个 `section.panel.system-expansion-section` 全换成 `ldg-section` 三件套，计数改用 `.ldg-section-count`；页签容器与首块之间补 24px，首块补 16px 上边距。页面级加了修饰类 `system-governance-page`，只把这一页的 `.page-wrap` 从 grid 改回 block 流，共享的 `.system-expansion-page` 没动（授权、字典、运维、参数页还在用它，未在本轮验收范围内）。
- **卡内一律 18px**：业务块（部门表单、规则历史、集成列表、质量摘要）自带内距，去掉 `panel-detached` 的 16px 兜底后正好回到 18px；表格走 `.ldg-section-card > .table-scroll` 的 `calc(100% - 36px)` + 18px，实测表宽 632、左边 588（卡左 570 + 18）。
- **修两个真缺陷**：其一，`.settings-content .system-expansion-table` 的 200/190/250 固定列宽是为三列授权矩阵写的，5 列组织表被压到 0 宽再被 `overflow: hidden` 裁掉，现给这几条规则加 `:not(.system-governance-table)`，治理表改回 `table-layout: auto`；其二，数据质量页在首次巡检前渲染的是一张 2px 高的空卡（内容整体包在 `quality &&` 里），现补「尚未运行巡检」空态，卡高 56px。
- 质量表列宽收成 60 / 210 / 165 / 197，检查码不再在词中间断开；卡头右侧计数加 `white-space: nowrap`，「0 个启用集成」不再折两行。
- 清掉已无引用的 `.system-overview-two-column` 4 条规则（hana.css 两处、legacy.css、v6.css）。
- 复核（1600 视口）：概览页两区块间距 24、卡头 42、卡头到卡 16、卡宽 670 圆角 14.7272；治理页四个页签卡宽均 670、表格 632、无横向滚动，页面横向溢出 0。组织表 5 列中仅隐藏的 `.select-control-proxy` 报 scrollWidth 溢出（1px 定位的 a11y 代理，视觉无溢出）。

### 2026-11-03 往来单位详情：五块内容换真卡，指标区并入 Metrics

这页的五个区块还是 `.panel.panel-detached` 那套：元素自己的背景、边框、圆角全是空，卡面靠 `::before` 在标题下方画，再靠子元素的 margin/padding 凑内距。现按台账页重写。

- **五个区块改用 `ldg-section`**：单位基础资料、关联项目、业主主合同、分供合同结算与应付、单独关联成本，全部换成 `ldg-section-head`（标题在卡外、带图标与计数）+ `ldg-section-card`。卡头高度 58 → 42（图标与标题同一行）。
- **卡内表格统一内距 18px**：新增 `.ldg-section-card > .table-scroll .data-table` 通用规则（`calc(100% - 36px)` + 18px），与 `.ldg-table`、`.ds-section-card` 的表同一个数。业主结算页原来单独写的 16px 一并改成 18（表首列文字 355 → 357，工具栏内容仍是 347），质保金三格条也跟着对齐到 347..1493、文字 357。
- **`.ldg-section-head h2` 改为 flex**：之前这条规则只写在业主页的页签作用域里，其他页一加图标就叠行（实测 h2 高 36、图标单独占 16px）。现在是共用规则，两个台账页与这页一致（h2 20、卡头 42）。
- **指标区换 `Metrics`**：11 张带边框小卡（半径 14.73、底色 `--card-bg`）改成三段式指标条，4 列、分供应付未付余额为强调格，1600 下 285.5px/格；删掉 `.business-party-metrics-grid` / `.business-party-metric` 7 条规则（含两档断点）。
- **基础资料卡的分隔线改画上边**：原来画下边，最后一行（备注）只有一格，卡底就多出一条半截线；现在首行无上边框、备注跨满整行。
- **编辑弹窗换 `Modal`**：只换外壳，`party-edit-dialog` / `party-edit-content` 两个类名和滚动区、常驻页脚的位置保持不变（弹窗 580×900、内容区 `overflow-y:auto`）。手写对话框外壳从 20 处 / 10 文件降到 19 处 / 9 文件。
- 复核：1600/1440/1280/1024 四档视口页面横向溢出均为 0；1600 下卡 1184、表 1146（文字 357），1440 下 1132，1280 下 972（表内横滚 46px），与业主结算页同步。

### 2026-11-03 业主结算与应收：工具栏与分界线跟台账页对齐

上一轮把五块内容换成了 `ldg-section-head` + `ldg-section-card` 的结构，卡是卡了，但卡里的工具栏还是自写的一套，和台账页放一起就能看出差别：标题下那条分界线一直顶到卡片圆角，工具栏内容离卡片边缘只有 17px。

- **工具栏改用共享的 `.ldg-toolbar`**：内距 12/18，`border-bottom` 归零，分界线改成 `::after`，左右各内缩 18px。原来自写 16/26/14 内距加一条通长 1px 下边框，线与圆角相切的地方最容易看出「贴边」。
- **筛选靠右补回来**：`space-between` 随旧类名一起没了，改用 `.owner-finance-filters { margin-left: auto }`。
- **卡内表格缩进 16px**：`width: calc(100% - 32px); margin: 0 var(--space-16)`，与预算清单等页一致，表格不再从卡片圆角边缘起笔。表首列文字 x=355、工具栏内容 x=347，这 8px 是 16px 卡片内距 + 10px 单元格内距的自然结果。
- **质保金页三格条归位**：它原本是通长条，`padding: 0` 加首格 `padding-left: 0`，格内文字直接贴在卡片左边框（实测 x=329，等于卡内原点），下边框又比表头线多出 16px。现在与表格同一缩进档：条 345..1495、文字 355，与表首列文字同一条线；格间竖线改成上下各缩进 12px 的伪元素，不再从上边框起笔。它自带的 `border-top` 也归零，不再与卡片上边框叠成两道。
- 顺带删掉已无引用的 7 条规则（`.owner-finance-toolbar` 三处、`.owner-finance-search` 四条，含窄屏两条）。
- 实测（1600 视口）：五个页签卡片均为 1184，卡头与卡间距 16、工具栏 12/18、分界线左右各 18。

### 2026-11-03 指标区统一到经营总览的摘要规格

全站摘要与 KPI 原本有四套写法（`.metrics` 16px/500、`.change-summary` 20px/600 带卡底、`.owner-metric` 16px/500 带渐变卡、`.cf-summary` 19px/600 带 2px 竖线），同一块「标签 + 数值 + 说明」在四个页面长得不一样。这次以经营总览的资金计划摘要为基准，把规格收进通用组件，其余页面向它看齐。

- **规格**：标签 11.52px / 行高 1.55，数值 19px / 600 / tabular-nums / 墨色，说明 11.52px / 1.5；每格左侧 2px 竖线（含首格，避免条状指标在最左侧失去左边界），格间距 14px，无卡片底色。强调格只把竖线染成 accent 45%，不改数值颜色。
- **基准页零偏移**：经营总览与成本分析的资金计划摘要从 `.cf-summary` 迁到 `Metrics` 组件后逐项实测与迁移前一致——容器 1152×72.55、gap 14px、margin-bottom 16px、padLeft 10px、说明行 top 453.05、图表 top 486.31，三格数值均为 19px/600 墨色。
- **迁移**：变更签证（4 格，净额格强调）、下游合同（5 格，有效变更净额强调）、下游结算与资金（6 格，未付应付强调）、业主结算与应收（6 格，主合同净应收敞口强调）。业主页原先的「专项资金余额」双值格把两个金额左右挤在一格里、字号只能压到 14px，改成合计值 +「预付款 … · 质保金 …」拆分说明，语义仍是这两块余额之和。
- **修掉两个真实缺陷**：其一，v6 的「全仓归一」规则 `[class*="metric"]{border-radius:var(--radius-xs)}` 给只有左边框的指标格套了 5.52px 圆角，2px 竖线两端被裁成圆头，看起来像胶囊，现已在 `.metrics`/`.metric` 上显式归零；其二，列数原先由 `data-cols` 写死，正文宽度取 640/720/800 三档用户设置时六格只有 99px/格，19px 的「¥8,000,000.00」必被截成省略号，现改为容器查询按实际容器宽度降列（6→3→2→1），竖线画在每格本体上所以换行不再出现旧方案那种「第二行多根线」。
- 复核：9 条路由在 1600 与 1024 两档视口下页面横向溢出均为 0、金额截断项为 0，全部指标格 radius 0px、数值 19px/600；`run-gates --tier blocking` 33/33。
- 补两处漏网：分供合同概览原本包在 `<Section title="数据概览">` 里，带卡壳与标题，与同组的变更签证、下游结算、业主应收裸条不一致，现改为裸条；“运维备份”四格仍是 16px/500、1px 分隔线、首格无线，现改到 `Metrics`（标签行的状态胶囊保留，原本就隐藏的图标不再保留）。复核扩到 11 条路由：溢出 0、截断 0。
- 收尾三处：操作追溯（3 格）、往来单位（2 格）、待办与预警（3 格，高优先级为强调格）也并入 `Metrics`，装饰性图标不再保留；往来单位那句“单位档案是公司级主数据”改用 `.an-basis-note` 单独成行。数值为单行省略号，因此给 `<strong>` 补了 `title`，真被截断时悬停可读全文。
- 删掉这层已经无引用的 CSS：147 条规则、385 个失效选择器分支（`change-summary` / `bill-summary` / `owner-metric` / `system-ops-summary` / `projects-kpi-strip` / `downstream-summary-grid` / `audit-summary-*` / `notice-summary-*` / `business-party-summary-strip` / `an-stats` / `ldg-stats`）。纯删除不换写法，保住原文件换行符；清理前后对 17 条路由 × 2 档视口做了计算样式快照（色、边框、圆角、内外距、字号行高、grid 列、阴影等 31 项 + 元素位置），唯一差异是设置页一条 tab 的 0.5px 宽度抖动，同配置重复跑同样出现，与清理无关。
- 新增 [指标区清单](docs/指标区清单.md)：规格数值、17 处用 `Metrics` 的汇总（含列数与强调格）、5 处保留磁贴/卡片的理由与判据，以及新增指标区时的四条规则。

### 2026-11-03 业主结算与应收：五块内容改用台账页的卡头卡身结构

这一块一直不像卡片：外层是 `.panel`，卡面靠 `panel-detached` 钩子用 `::before` 在标题下方画出来，元素自身背景/边框/圆角全是空。后果是卡片对内容不做任何约束，工具栏、搜索框、表格各自用 margin 和 padding 去凑，前几轮修的错位都是这个结构漏出来的。现按台账页（预算清单）的结构重写：

- 五个页签统一改为 `ldg-section-head`（标题在卡外，带图标、说明与计数）+ `ldg-section-card`（真实卡片包住工具栏、空态、表格）。
- **表格不再被卡片裁**：`min-width: 1160px` 降到 980（实测九列的最小内容宽），1440 窗口下卡片 1132、表格 1130 刚好装下，之前右侧「登记到账」完全在可视区外。
- **切页签不再整页变宽**：有表格的页签走 1240 台账宽度，空态页签没有 `.table-scroll` 会掉回 720，一页里宽度来回跳。现把 `.page-wrap.owner-finance-page` 宽固定在表格档。
- 工具栏不再自铺浅色底（卡内那一条色带）；卡头「N 项」与工具栏「显示 N 项」重复，删掉后者；卡头图标不再单独占一行（`h2` 改为 flex，图标与标题同行，卡头高度从 58 降到 42）。
- 复核：五个页签在 1600/1440 下卡片 1184/1132，表格 0 横滚、按钮可见、页面 0 溢出；1280 以下保持横滚（九列的自然宽度 984）。

### 2026-11-03 应收台账工具栏：「范围」折行、搜索框套三层框、卡片内距

工具栏里的「范围」两个字竖着排，「全部应收」被挤到 100px。原因是标签是 `inline-flex`，里面放了一个 `width: 100%` 的 `.select-control`：百分比在收缩宽度里解不开循环，两边互挤——标签被压到 18px（不够两个字）、选择器被压到 100px（换成长一点的选项就会被省略号吃掉）。

标签禁折行，选择器给确定宽度 132px：实测「范围」单行 23×18，选择器 132×32，切到最长的「存在未收余额」文本 91px 不截断，1280/1024/820 三档工具栏 0 横向溢出。扫了 28 条路由的 `label > span`，只有这处折行（`/system/dictionaries` 的说明文字折行是有意的）。

同一行看下去又找到两处：

- **搜索框里套了三层框**。台账页早就有一套干净的 `.ldg-search`（图标与输入框同一层，输入框不画框），应收台账却自写一套 `.owner-finance-search`：图标是 flex 兄弟节点，输入框却带着给「绝对定位图标」准备的 31px/30px 内边距，加上全站输入框规则自带的边框、圆角和底色，壳里长成「图标一个框 + 输入一个框 + 外层再一个框」（实测输入框 347×32、圆角 11px、右侧空 30px）。现改为直接用 `.ldg-search`，与预算清单等台账页同一个搜索框。
- **卡片内距三套数**。工具栏自带 16px 外边距 + 17px 内边距，搜索框比表首列文字缩进 7px；上下又只有 12px。现在工具栏占满卡片宽度（横线也跟表头一样通长），内距 16/26/14，搜索框与表首列文字都在 354px 一条线上，右侧计数与表尾列对齐；四档视口 0 溢出。

### 2026-11-03 系统管理概览：卡片错行与点击区的两个真缺陷

概览页的发现，都是“看着能点、看着对齐，实际没有”的那类问题。
- **同一行两张卡一高一低**。`.panel + .panel { margin-top: 16px }` 本意是竖向堆叠面板之间的间距，但工作台入口是两列网格，第 2 张起的卡都吃了这 16px，网格把它算进行高：行高 79.6px、首卡被拉到 80、后卡 64 且整体下移 16px。现在两个网格里的 `.panel` 不再吃兄弟间距，实测行高回到 63.6、五张卡全部 64px、首行对齐。
- **第 5 个入口留半格**。五个入口两列排必然剩半格，右下角一块空白；最后一张铺满整行收口（669px），1024/1280/1600 三档都是 0 横向溢出。
- **指标卡只有 22×22 的图标可点**。卡面 34698px²，链接只有 484px²（1.4%），点卡身任何位置都没反应，而卡片带箭头、带圆角边框，看起来整卡可点；同页下面的五个工作台入口却是整卡可点。现改为链接铺满整张卡（`grid-column/row: 1 / -1` + `align-self: stretch`，因为绝对定位子项在 grid 里的包含块是它所在的网格区域），箭头位置不变，实测卡面中心点命中链接并正确跳转 `/system/accounts`。
- 顺带记进 [组件不变量](docs/组件不变量.md)：网格里不能用兄弟外边距排间距，以及绝对定位子项在 grid 里的包含块陷阱。
- **首格内容贴到左边框上**。指标区那条「首格去掉左内距、贴齐内容列」是为无卡条写的，但这四格已经是独立卡片（带边框、带底色）：首格图标距边框 0px，其余三格 17px，同一个左栏两列不对齐。卡片形态下首格恢复四边 16px，四格 contentLeft 实测都是 53。`/system/authorization` 的授权范围格同一毛病，一并修掉；`/reports` 那组是无卡条，不动。
- **读数比标签只大 2.4px**。四格原本是标签 13.6 / 数值 16px·500，与经营总览的读数并排就能看出小一号。现按统一规格重排：标签 11.52 / 数值 19px·600 / 说明 11.52，行间 4px、行高 1.55，卡高 106 与参照块一致，读数重新成为主角。
- 遗留三项待定：概览的四个读数仍是 16px/500 的磁贴规格（全站新规格是 19px/600）；「近 7 天安全事件」的上限是接口的 `take: 200`，打满时显示 200 但真实值不可知；五个工作台入口与左侧导航完全重复。

### 2026-11-03 对话框结构收进共享组件，补控件与状态清单

`.modal-backdrop + .dialog + .dialog-header` 这套外壳此前在 17 个文件里手写，每处的分类小字、关闭图标尺寸（17/18）、宽窄档各写一遍。

- 新增 `Ui.Modal`：结构、遮罩点击关闭、`role="dialog"` / `aria-modal`、标题 `aria-labelledby`、17px 关闭图标只写一次，分类小字与宽窄档作为参数。业主结算与应收（8 处）、下游结算与资金（7 处）两页改为一行薄封装，15 个调用点一行未改。实测两页对话框的分类小字、标题、宽度 580、头部内距均与改动前一致，`aria-modal` 与标题关联已挂上。
- 新增 [控件与状态清单](docs/控件与状态清单.md)：共享控件的调用规模、仍手写的 20 处对话框外壳（10 个文件）与 177 处原生按钮的分类、分页两套外壳、七种界面状态的现状与缺口，以及已核实为合理变体不改的六项。实测记录一条：直写 `className="button-primary"` 与共享 `Button` 在 1600 视口下计算样式完全一致（圆角 9.20448px / squircle、高 32、内距 0 12、13.6px/500、同色），差异只在维护面。

### 2026-11-02 资金计划、台账宽度、进度款到期日与销项发票

四个功能构成一条完整的现金视角链路：先把未来现金进出画出来，再让台账能在桌面宽度下不横滚，然后把资金计划的输入端补全，最后补上开票产生的税金流出。

- **资金计划视图**（`GET /projects/:id/analysis/cashflow`）。成本分析页新增面板，按到期日给出未来六个月应收应付曲线、逐月净额与整体缺口。金额来源分三层并强制去重：应收单净额减已核销、已过账应付净额减付款核销、付款计划只覆盖尚未结算出应付的合同（否则同一笔支出算两次）。没有到期日的金额不进任何月份，单列“未设到期日”，不替业务编日期。分期摊薄有封顶：分期合计超过台账未收额时按比例摊薄，末项吸收取整余量，保证合计严格等于未收余额。13 条单测覆盖跨年分桶、窗口边界、当天到期不算逾期、摊薄不丢分。
- **台账宽度与阅读宽度分开**。实测的九条台账路由在 1600 视口下全部横向溢出（其中预算、变更、实际成本、往来单位、分供结算与项目台账视图六个是不同页面，其余路由共用项目台账视图）。根因不在列数而在宽度预算：`.page-wrap` 上限 720，内容区可用 1348，628px 闲置，同时最宽的变更签证表要把 481px 藏进滚动条。新增“表格宽度”三档（跟正文 / 1240 / 铺满，默认 1240），`.page-wrap:has(.table-scroll)` 取 `max(正文宽度, 表格宽度)`，保留项目档案、实际成本、报表工作室本来就要铺满的布局。实测 1600 视口下九条台账路由 0 溢出，分析页仍为 720，设置页不受影响。
- **进度款应收到期日落在源头**。进度款应收一直是资金计划唯一的悬空来源：审批生成时不带 `dueAt`，事后补录窗口极窄（有到账即 `SCHEDULE_LOCKED_AFTER_RECEIPT`，且各期合计必须严格等于净额）。主合同新增约定付款期限 `paymentTermDays`，审批通过时按“审批时刻 + 天数”生成到期日与首期安排；合同没约定则留空，不编日期。重写应收分期时应收单自身到期日跟随最早一期，避免“应收单与资金计划两张皮”。演示数据未设到期日应收从 700,000 归零，同时第 3 期欠付 700,000 按核定日 + 30 天正确落入逾期桶。
- **业主销项发票**。建筑业先开具发票即纳税义务发生，钱没到税先交，而资金计划此前没有这一块。新增 `OwnerInvoice`（票号、开票日、含税金额、税率、税额、关联应收、红冲），税额按含税金额反算并入库算定；开票额度受应收净额约束，红冲后额度自动回退。资金计划新增 `INVOICE_TAX` 来源，只计税额、按开票月入支出（票面金额已含在应收里，整张票再加一遍会算两次）。结算与应收页新增第五个分区“销项发票”，应收列表显示已开票与未开票。演示数据 300 万 @9% 产生销项税 247,706.42，11 月净流出由 −324.3 万变为 −349.0 万。范围限定在项目现金流与税负可见，不含申报表、预缴台账与发票查验对接。
- **公司级资金计划**（`GET /dashboard/cashflow`）。项目级视图回答“这个项目缺多少”，经营总览还要回答“公司这个月缺多少”。聚合不重写取数逻辑：把项目级取数抽成 `loadProjectCashflowSources`，先按同一 `asOf` 对每个项目各算一次，再按月份键归并、用分累加，避免一次大查询里跨项目混算去重。返回逐月汇总、逾期、未设到期日、销项税，以及按窗口净额升序的项目分行（缺钱最多的排最前），`scope` 回报覆盖项目数与是否跨项目；只列当前用户有权访问的项目，越权项目不进合计。8 条单测覆盖月份桶对齐、分行排序、空项目与合计一致。演示数据新增第二个项目 `DEMO-CHAIN-02`（合同 1800 万、付款期限 45 天、未收 300 万、付款计划 500 万），公司级窗口实测应收 927.95 万 / 应付 1509.02 万 / 净 −581.07 万，逐项目合计与汇总严格相等；1600、1440、1280、1024 四档视口复核，无横向溢出、无 console 报错。全零项目不占表格行，折叠为表下一句提示并保留点进项目补数据的入口。
- **资金计划月份下钻**。图表只回答“哪个月缺多少”，下钻回答“缺的钱是谁的”。月份列的日期边界抽成 `slotOf` 一个函数，图表与明细共用它和同一个 `asOf`，否则“柱子高度”和“点开的明细”必然会在跨日边界或跨零点时对不上。两个接口接受 `?bucket=` 参数（月份键或 `overdue`／`unscheduled`／`beyond`），带参数才返回条目级明细，首屏不返回明细；明细带回原始单据线索：应收单号与期次、应付单与分供方、付款计划阶段、发票票号与税率。金额按分计算、展示两位小数，实测 11 月 4 笔合计 6,490,206.42 与柱值严格相等，逾期桶 2 笔合计应收 700,000／应付 1,920,000 与提示文字一致。逐期空桶返回零合计而不是 null。项目级与公司级共用同一个明细组件，公司级多一列项目并给出项目小计；逾期说明旁新增“看明细”入口。演示第二个项目的分供方改为电气设备商，避免出现钢材商供应配电设备这种明显的演示数据矛盾。
- 新增迁移 `20261102120000_main_contract_payment_term_days`、`20261102134550_owner_invoice`；演示种子自检扩到 16 项（含逾期应收可落入逾期桶、销项税额入计划、已开票与可开票余额、公司级汇总等于各项目之和）；顺带修掉重复跑种子时销项发票数据残留导致的 FK 失败；`release-candidate` 门禁的应收页分区断言同步为五个分区。

### 2026-10-21 UI 收口与全局助手

- 新增 `--card-inset` 与 `--state-hover-bg` / `--state-selected-bg` / `--state-focus-ring` 等状态 token；表格行、待办、报表目录、命令项和助手会话行统一使用，移除 hover 位移、bronze 首列竖条和双横线。
- 修复报表目录 `.report-report-option` 的 border-bottom 与内缩分隔线叠加造成的双线；待办列表改为 16px 内缩行线和筛选计数。
- 项目驾驶舱改为“身份 + 四指标 + 健康条”单卡、带真实摘要的六入口和分供概览；主合同合并金额口径并删除重复的底部关联业务；变更页和卡片正文统一 16px inset。
- 账号表在窄屏改为带字段标签的卡片行，消除 713px 横向滚动。
- 成本助手从工作台页面改为标题栏快捷操作旁打开的全局弹窗：三栏会话、悬浮 composer、工具/来源卡与响应式证据抽屉；移除 `/cost/assistant` 工作台 tab。
- 全局搜索改为 760px 命令中心：搜索框、全部/页面/项目 scope、分组结果、`aria-activedescendant` 与键盘选中。
- 文档整理：新增 [UI 验收 Hana](docs/UI-验收-hana.md)；V6 设计/组件/验收与 Pro-Tier 规范移入 `docs/archive/` 并加历史说明；总索引、README、产品状态、路线图、开发指南和 Hana 对照同步到 `eec9677` 与当前 75/26/20 门禁。


### 2026-10-20 增量开发（已合入 main，未正式发布）

- [PR #17](https://github.com/mmllemon/moheng/pull/17) 已合并项目上下文中的近 30 天 AI 用量摘要：按当前认证用户与授权项目聚合，区分活动任务、已结束运行以及 COMPLETE/PARTIAL/UNAVAILABLE 用量；只有完整且一致的供应商 token 元数据参与累计，不按字符数推算 token 或费用。
- [PR #18](https://github.com/mmllemon/moheng/pull/18) 已修复业主最终结算合法负差额被拒绝，以及未核验往来单位仅凭同名被自动关联的问题，并增加对应回归测试。
- [PR #19](https://github.com/mmllemon/moheng/pull/19) 更新核心经营链路审计记录，明确当前为开发阶段：历史台账核对、生产 Windows 权限/恢复演练和正式业务/审计签认是后续预投产/投产门禁，不是当前开发阻塞项。
- PR #17 与 #18 的精确头提交均通过 Assistant runtime 与 Prisma 7 migration 两组 GitHub Actions；PR #18 的两项修复也已包含于当前主干业务代码基线。主干该基线的 Assistant runtime workflow [run #39357880407](https://github.com/mmllemon/moheng/actions/runs/39357880407) 已成功。
- 根目录、API 与 Web 的包版本仍为 `2.19.0-rc.2`；上述变更已经集成到 `main`，但尚未升级 package version 或发布正式版本。自动化门禁通过不等于真实供应商 E2E、浏览器视觉验收或后续投产验收完成。

### v2.20.0 product completion — merged to main, not released

> Source integration status: merged to `main` on 2026-10-19 as commit `08696e5bc5fb106c10aae5b796616b25c159aa52`. This is **not a formal release**: package versions remain `2.19.0-rc.2`, no GitHub Release has been published, and production deployment has not been approved. Real deployment, historical-data reconciliation (if such data exists), and formal business/audit sign-off are later-stage gates after the relevant environment and materials exist, not current development prerequisites.

- Consolidated repository documentation into one current index and four-phase roadmap; archived the historical defect review and summarized old RC acceptance records rather than keeping repeated versioned design documents.
- Added styled `报表预览` overview sheets to both standard XLSX exports and Report Studio XLSX exports, including report scope, filters/template version, worksheet directory, row limit and truncation warnings.
- Added project/company report sources and default-template sections for downstream cash payments and refunds, separated from posted payables and actual costs; added exact-cent aggregation and truncated-data safeguards.
- Improved shared date/select control label targets and accessibility metadata; added static coverage for core business pages to prevent native date/select controls from returning.
- Added safe AI configuration-readiness diagnostics, bounded model-call defaults (1,800 tokens, 45-second timeout, one SDK retry), downstream cash-flow evidence in the read-only project overview, and `INDETERMINATE` cost variance when target-cost rows are truncated.
- Added/expanded XLSX, payment summary, AI configuration, cost-variance and runtime-policy tests.
- Fixed the built-in party report's `businessParty.id` field contract and added runtime validation of the PROJECT, COMPANY and PARTY default templates to the release-candidate gate.
- Consolidated system configuration and authorization governance into dedicated workbenches, including dictionary/parameter revision controls and the authorization review workbench; production acceptance remains subject to the documented RC gates. Current-head CI is required; this draft does not claim real-model E2E, real browser visual sign-off, sanitized user-staging reconciliation or production rollout approval.
- Fixed the default project report's lowercase `mainContract.amount` binding so it receives money formatting; added a release-gate regression test.
- Fixed report-preview decimal rounding for custom formats with arbitrary supported precision by using decimal-string arithmetic, and added coverage for carry, negative values, and precision beyond two places.
- Aligned report preview with common numeric Excel date formats (`yyyy-mm-dd`, `dd/mm/yyyy`, and Chinese literal patterns); locale-dependent month/day-name and time formats retain a predictable ISO-date fallback.
- Fixed report-export polling and manual result lookup to distinguish a pending job from a completed job whose artifact is missing/expired; terminal states now show actionable errors rather than a false "still processing" or success message.
- Made the report studio's 1,000,000-cell workbook safety limit a deterministic, non-retryable failure; preview returns an actionable limit message and queued exports report the same cause without wasting three worker attempts.

---

- 创建独立分支 `feat/v2.19.0-rc.2-prisma7`，从 `ceb0f335624209178e37e1279fb9c845d5f7b924` 开始；不改写 `main`，不自动合并。
- 将 `prisma` 与 `@prisma/client` 固定升级到 `7.10.1`，并增加同版本 `@prisma/adapter-pg`、`pg@8.23.1` 与 `@types/pg@8.23.1`。
- 切换 `prisma-client` 生成器，显式生成到 `apps/api/src/generated/prisma`，并将数据库连接 URL 移入 `apps/api/prisma.config.ts`。
- 迁移 API 源码中的 Prisma Client、类型与枚举导入；更新 Docker 构建为锁文件驱动的 `npm ci`，并纳入 Prisma 7 结构静态门禁。
- 此提交先由 GitHub Actions 在 Node 24 runner 重建根锁文件并校验 SHA；严格类型检查、构建、124 项 API 单测、完整 Release Candidate、隔离 PostgreSQL 迁移/恢复和 `npm audit` 结果均以实际运行日志为准。若生成客户端、类型或运行时 gate 失败，分支保留未完成状态并继续修复；R7 不自动转为 PASS。

## v2.19.0-rc.1 Gate hardening follow-up

- Root `build` generates Prisma Client before compiling API/Web; standalone API tests also generate Prisma Client.
- Add `db:validate` and run schema validation in the isolated PostgreSQL CI path. Update the orphan-run SQL and its static contract to use valid, consistently quoted target-table references.
- Use `npm ci` with committed lock files for the main workspace and the standalone Pi Durable PoC.
- Correct the UI-polish release-version assertion label to use the current package version rather than the stale v2.13.0 label.
- Align Pi Durable PoC `@langchain/core` with `langchain@1.5.18` and pin Vitest as a development dependency.
- Add separate CI coverage for Pi Durable SQLite/Vitest and isolated PostgreSQL conformance; the PoC job intentionally remains blocked until its independent lockfile is committed. Update admin-guard and report-path static assertions to match correct runtime behavior on Windows and POSIX.

## v2.19.0-rc.1（2026-10-17）

- 为 LangGraph 适配器增加仅通过代码依赖注入的模型、checkpointer 与只读工具 seam；不增加运行时环境开关，不允许 HTTP 请求启用测试 provider。
- 新增 fake chat model 成功走工具调用到最终回答的自动测试，断言回答来自工具结果。
- 助手持久化事件新增 payload 白名单与嵌套结构校验，禁止事件写入 prompt、回答正文、金额值、凭据或未知字段；`tool.completed` 仅允许固定白名单中的限制说明与字段级来源元数据，拒绝任意业务口径/正文。
- 新增日志/事件泄漏扫描器和负向测试，覆盖密钥格式、显式敏感标记、endpoint 值及事件 payload 结构；事件来源 scope 进一步约束为固定描述白名单。
- 新增隔离 PostgreSQL 恢复回归测试，固化六个 lease/取消场景，并测试宽限期内不误杀与宽限期后孤立 run 收敛；加入 fake provider 工具调用成功路径测试和 GitHub Actions CI Gate。
- 生产助手开关保持默认关闭；本版本仍为 RC，不构成生产批准。

## v2.18.0-rc.1（2026-10-17）

- 对齐 `langchain@1.5.18` 所需的 `@langchain/core@1.2.18` peer 版本，避免主 API workspace 安装被 ERESOLVE 阻断。
- 增加可选 `OPENAI_BASE_URL` 配置并通过 `ChatOpenAI.configuration.baseURL` 传递到模型客户端，支持采用 OpenAI-compatible API 的隔离测试端点；不改变工具白名单与只读权限边界。
- 从 `Project` 模型移除 5 个不存在合法反向关系的治理规则、备份运行和集成凭据关系字段；保留合法的 `systemParameterRevisions` 关系。
- 新增后台 worker 的孤立助手 run 收敛：运行至少 60 秒、且缺少有效匹配 `assistant.agent.run` queue job 的 `QUEUED/RUNNING` run 会终态化；尊重已提交的取消请求，持久化终态事件并为失败写入审计。
- SSE 失败后的 UI 状态回读以持久化 run 终态优先，并为孤立 run/worker lease 失败提供明确提示。
- 保留当前前端助手 SSE parser 的 6 项测试与全套静态发布验证。此 RC 的源码修复与用户上一轮独立 Gate 证据分开记录；用户本地完整构建、真实 PG 并发/取消/回放与浏览器 SSE 恢复结果未在当前容器独立复跑。**不批准生产启用。**

## v2.17.0-rc.1（2026-10-16）

- 将助手 SSE 事件块解析提取为无网络副作用的纯模块，并新增 6 项 Node 内置测试，覆盖事件信封、CRLF/多行 data、heartbeat、畸形 JSON、非法游标和数组 payload。
- 保持 `@assistant-ui/react` 外部存储运行时与墨衡现有 API/SSE 的解耦，不把 UI 适配器和 LangGraph checkpoint 协议混为一谈；助手仍默认关闭。
- 发布候选验证链新增 SSE parser 单测。当前执行环境仍只有 Node.js 22.16.0、且工作区依赖未安装，完整类型检查、构建、数据库和浏览器 E2E 仍受环境阻塞，不能把静态契约检查视为运行态通过。

## v2.16.0-rc.1（2026-10-16）

- 基于 `@assistant-ui/react` 建设成本工作台内的助手前端，使用 `useExternalStoreRuntime` 对接现有墨衡 REST/SSE，会话与执行状态仍由后端持久化 API 管理，不把 LangGraph 私有事件格式绑定到 UI。
- 新增 `/cost/assistant` 三栏工作台：当前项目会话列表/搜索/归档，消息时间线、快捷成本问题、Markdown/GFM 表格、取消与运行状态，以及工具来源实体/字段/行数/范围和限制说明。
- 入口仅在认证后的助手状态接口返回 enabled 时出现；路由本身仍检查开关。前端切换项目后不展示旧项目会话详情，会话列表由服务端按 projectId 收敛。
- 使用 `fetch` 读取持久化 SSE，携带现有 Authorization header，支持 refresh-session、`Last-Event-ID` 恢复与重复序号过滤；重新打开旧会话会重放最新运行的事件，恢复来源/限制面板。
- 精确固定 `@assistant-ui/react@0.15.29`、`@assistant-ui/react-markdown@0.14.23` 和 `remark-gfm@4.0.1`；从 `open-claude-ui` 只借鉴中文输入法与滚动交互模式，不引入其品牌素材或整套 Claude 外观。
- 修正会话列表非法查询分支缺少 Fastify `reply` 参数的问题；增加 `scripts/validate-assistant-ui.mjs` 并接入发布候选静态验证。
- **尚未通过完整运行态 Gate**：当前环境 Node.js 22.16.0、未安装工作区依赖，未完成 Node.js 24+ 全量类型检查/生产构建、真实 PostgreSQL 与浏览器 E2E。Assistant 仍默认关闭，不批准生产启用。

## v2.15.0-rc.1（2026-10-16）

- 基于 v2.14.0-rc.1 增量实现只读助手会话后端第一阶段：会话列表/新建/详情/归档、消息提交、运行状态、取消请求和持久化 SSE 事件回放接口；所有路由仍位于默认关闭的隐藏 PoC 模块下。
- 新增 `AssistantConversation`、`AssistantMessage`、`AssistantRun`、`AssistantRunEvent` 四个模型及追加式迁移；会话 owner 与 project 由服务端绑定，读取每次重新校验项目权限，跨用户会话按 404 处理。
- 消息请求使用 `requestId + requestHash` 幂等保护；同一会话通过事务行锁避免并发运行重叠，消息与 `assistant.agent.run` 后台任务在同一事务入队，任务 payload 不复制用户 prompt。
- 持久化运行事件使用单调递增的每 run 序号，SSE 支持 `Last-Event-ID`/`after` 重放、心跳及终态关闭；浏览器断开不会取消已提交任务，并拒绝超出当前事件序号的游标。取消、归档和关键运行状态有审计记录。
- 加固消息提交与归档并发、运行完成与取消并发：行锁后重新验证 ACTIVE 状态，完成/失败/取消使用条件状态迁移；已提交的取消请求不会被无条件完成写入覆盖。
- 新增独立 `apps/api/src/assistant/runtime/langgraph-adapter.ts`，把 LangGraph/provider SDK 与通用任务处理隔离；checkpoint schema 使用显式 setup 命令初始化，正常请求不执行 DDL。耗尽的 worker lease 会将对应助手 run 收敛为失败状态，避免 UI 永久停留 RUNNING。
- 将会话/API/SSE 静态契约检查接入 Release Candidate 验证链，并添加 runtime 依赖固定版本。尚未实现前端助手 UI；尚未在 Node.js 24+ 环境完成 TypeScript/build、Prisma Client 生成、真实 PostgreSQL 迁移/并发、SSE 浏览器重连、fake/真实模型 E2E 或恢复演练。仍为 RC，助手生产开关必须保持关闭。

## v2.14.0-rc.1（2026-10-16）

- 固化只读 AI 助手下一阶段运行时/存储决策：下一阶段以 LangGraph.js + PostgreSQL `PostgresSaver` 为集成候选，并明确不代表生产准入；Pi Durable + SQLite 的实验性 API 与单进程 storage owner 限制不作为长期默认存储。
- 将只读助手安全契约与 runtime/storage 决策一致性校验并入 Release Candidate 验证链；继续要求三工具白名单、逐次项目权限复核、失败/成功审计、无业务对象写操作及默认关闭。
- 新增助手运行时决策与下一阶段验收清单。会话 API、SSE 重连/取消、UI、真实模型端到端、备份恢复、提示注入及生产准入仍未完成。

- 新增显式账号数据范围 `ASSIGNED_PROJECTS` / `ALL_PROJECTS_READONLY`，默认所有既有账号继续仅能访问已分配项目；管理员可对普通账号授权跨项目只读，并触发会话撤销与审计。跨项目只读不授予写入、审批、外部确认、付款、成员管理或安全日志访问。已接入项目清单、经营总览、业务报表、报表工作室、往来单位经营档案及动态待办/预警的只读数据范围。
- 项目角色权限策略在服务端项目访问辅助层强制执行，仅可在代码声明的角色能力上限内收紧。内部工作流草稿/发布/历史回滚已接入变更签证状态转换；为避免发布无效配置，当前只允许 `CHANGE_INTERNAL_APPROVAL` 一个已接入的工作流代码，不宣称已有任意业务流程设计器。
- 新增 `CONTRACT_EXPIRY_WARNING_DAYS`（默认 30 天、范围 1–365）和 `TARGET_COST_OVERRUN_DANGER_PERCENT`（默认 0%、范围 0–100）两个业务可读数值参数消费点；仅已发布、`BUSINESS_READABLE`、类型与范围正确的参数生效，项目值覆盖全局值，无效值安全回退。
- PostgreSQL 业务数据库备份与 `pg_dumpall --globals-only` 全局角色/配置归档均使用 AES-256-GCM 加密、SHA-256 校验和密钥 ID 版本标记；下载仅提供加密归档。恢复演练在不同集群身份上验证并清理临时数据库。全局 SQL 仅执行解密/完整性检查，不会由演练自动在目标集群执行；灾备运维需受控人工恢复全局角色，并把它作为单独验收步骤。
- 集成凭据支持 HTTPS 连接探测和异步 JSON POST 投递，目标主机由 `INTEGRATION_ALLOWED_HOSTS` 显式允许名单控制，禁止重定向并检查 DNS 公网地址；投递使用稳定幂等键和既有后台任务重试。未实现特定 ERP/对象存储协议适配器与自动业务事件映射。
- 将登录范围变更设为强制撤销会话；修正两个报表后台任务的认证上下文 `sid`；添加跨项目只读和业务数值参数单测。巡检按钮保持透明背景，使用中性色 focus-visible 轮廓。
- 新增迁移 `20261016040000_system_security_workflow_integration`、`20261016050000_project_data_scope`。迁移仅增量追加。
- **仍为 RC**：当前 Node.js 22.16.0 且未安装工作区依赖；严格类型检查、生产构建、完整单测、Prisma 生成、PostgreSQL 迁移/并发测试、浏览器 E2E、备份恢复和 Windows 部署验收未通过或尚未执行。详见 `docs/产品范围与当前状态.md` 和 `docs/archive/阶段验收历史摘要.md`。

## v2.13.0-rc.1（2026-10-16）

- 精简主侧边导航：系统管理保留单一入口，账号、安全、权限治理、组织规则、字典、参数、运维和操作追溯移入横向滚动的二级导航；侧栏导航区独立滚动，底部账号区不再被长菜单挤出可视区域。
- 新增只读现行权限矩阵 API 和授权复核工作台：按生成时刻记录账号、项目成员角色、风险发现项，支持管理员提交复核说明，生成和复核均写审计；复核不会直接授予/撤销权限。
- 新增 `SystemAuthorizationReview` 表和追加式迁移 `20261016030000_system_authorization_reviews`。
- 字典分类、字典项、参数键按显示名称自动推荐稳定编码；用户开始手动编辑编码后不再被名称输入覆盖，服务端格式与唯一性校验保持权威。
- 数据质量巡检按钮改为低强调中性色操作，减少卡片右侧的视觉污染。
- RC Gate：需在 Node.js 24+ 与隔离 PostgreSQL 中执行严格类型检查、构建、迁移、权限/E2E 和恢复演练后才可考虑正式发布。

## v2.12.1-rc.1（2026-10-16）

- 复核用户提供的 39 项源码缺陷清单；逐条区分可复现缺陷、加固建议和误报，形成 `docs/源码缺陷审计与修复记录-v2.12.1-rc.1.md`。
- 修复系统治理页面部门/账号归属状态不同步、默认/运行中/已取消/失败状态文案和颜色、会话用户空值防御、字典表格可访问名称与选择守卫。
- 修复参数配置 API 的 params/body 错误详情、参数定义冲突查询、发布审计事实值、草稿创建事务内项目有效性复核、回滚说明静默截断；显式保护无项目范围查询的生效参数逻辑。参数值继续不写入审计快照。
- 运维增强：超时终止子进程树；备份元数据先退休再删文件，防止数据库指向不存在的备份；下载文件名校验统一；恢复前除 DNS/IP 检查外再核对 PostgreSQL system identifier，集群相同或标识不可验证时 fail-closed。
- 安全增强：新增独立 `LOGIN_ATTEMPT_HMAC_KEY`，公网模式要求它与 JWT/MFA 密钥分离，避免 JWT 密钥轮换同时重置登录限流桶；加强 MFA 加密段格式检查；强制改密加入 authVersion 乐观锁。
- 把刷新令牌签发热路径中的历史清理移入后台定期任务；后台任务状态回写失败增加独立日志；清理失败增加冷却，避免数据库故障期间每秒重复运行清理查询。
- 新增单测覆盖独立限流 HMAC key 与 JWT 轮换隔离、MFA 密文格式错误。
- **仍为 RC**：当前容器 Node.js 22.16.0 且无完整依赖；完整 TypeScript lint/build/test、Prisma 验证/生成、真实 PostgreSQL 迁移/并发、浏览器 E2E、Windows 进程树与备份恢复仍需在目标环境完成。恢复演练目标现在需要运维账号具备读取 `pg_control_system()` 的权限（通常授予只读 `pg_monitor`）。首次切换 `LOGIN_ATTEMPT_HMAC_KEY` 会改变已有登录限流桶 hash，部署时不要与 JWT 密钥轮换叠加。

## v2.12.0-rc.1（2026-10-16）

- 新增统一基础字典模型及管理页，支持内置/自定义分类、稳定编码、描述、条目排序、启停与软停用；新增付款方式、计量单位、资料分类和预警等级初始字典项。
- 新增版本化参数配置，支持字符串/数值/布尔/JSON，提供全局默认与项目级覆盖、草稿/发布/归档、发布人/时间、历史浏览与新版本回滚草稿；数据库约束保证同一键/范围最多一个已发布版本。
- 新增已认证的公共配置只读 API。字典只返回启用条目；参数只返回显式设置为 BUSINESS_READABLE 的已发布值，项目参数按项目成员权限收敛；管理员专用值不对普通业务用户开放，敏感键被拒绝或过滤。字典/参数维护、发布和回滚均写入审计摘要，审计中不复制参数原值。
- 新增迁移 `20261016020000_system_dictionaries_parameters`，接入系统管理导航和概览，并补充设计/验收文档与静态契约验证。
- 未自动将现有合同金额、变更签证、结算、付款/退款核销或核心状态机切换为动态参数/字典；每个消费方必须另行接入和验收。
- 仍为 RC：当前容器为 Node.js 22.16.0 且未安装工作区依赖；完整 Node.js 24+ 类型检查/构建/测试、Prisma 生成、PostgreSQL 迁移/事务和浏览器 E2E 尚待执行。

## v2.11.0-rc.1（2026-10-16）

- 系统管理新增组织部门、层级维护、用户部门/岗位归属；此功能不授予公司角色或项目角色。
- 新增 `GovernanceRuleVersion` 规则版本模型与草稿/发布工作流。已发布的 `CHANGE_APPROVAL` 规则由变更签证 API 服务端执行；没有发布版本时使用既有 OWNER/MANAGER 默认规则；禁止 ESTIMATOR/VIEWER 获得审批权，公司 ADMIN 也必须具有允许的项目成员角色且不得审批本人提交的业务。规则不影响外部确认金额生效。
- 新增系统状态、后台任务、存储容量和 PostgreSQL 运维工作台；数据库备份通过 `pg_dump` 生成、计算 SHA-256，下载前重验；恢复演练检查备份完整性并在独立地址的 `*_restore_test` 数据库执行 `pg_restore`，再校验 `User`、`Project`、`MainContract` 核心表。备份文件按保留期清理并保留审计元数据，至少保留最近两个成功备份文件。
- 新增集成凭据保险库，凭据采用 AES-256-GCM、上下文绑定和独立 `INTEGRATION_ENCRYPTION_KEY` 加密；支持元数据管理、启停与凭据轮换，API 与管理页均不回显密文解密后的真实值。尚未实现通用连接测试适配器。
- 新增只读数据质量巡检，覆盖项目主合同缺失、已审批变更金额缺失、外部确认资料不完整、超期金额差异复核、管理员安全待办、无部门账号和缺少集成凭据，并对每次巡检写入审计记录。
- 新增迁移 `20261016010000_system_management_expansion`，未重写或删除历史迁移。
- 真实 `pg_dump`/`pg_restore`、PostgreSQL 迁移/Client 生成、全量 TypeScript 构建、浏览器端到端与公网部署仍须在 Node.js 24+、真实目标环境中验证。本版本是候选版本，不宣称生产就绪。

## v2.10.0-rc.1（2026-10-15）

- 重组侧边导航为“经营中心 / 工作台 / 项目管理 / 系统管理”四个职责分组；经营总览、报表、待办与往来单位属于经营中心，成本工作台独立归入工作台。
- 项目档案与项目成员/角色统一归入项目管理；项目成员规范路由为 `/projects/members`，旧 `/system/members` 与 `/workspace/members` 保留兼容重定向。
- 系统管理页调整为真正的管理概览：显示账号、活跃会话、安全事件与待处理账号摘要，展示治理能力现状/验收差距和后续扩展路线；不再重复摆放项目档案和成员管理入口。
- 将操作追溯从经营中心迁入系统管理分组，并将页面入口限制为系统管理员；经营总览仍可看到当前账号权限范围内的最近操作摘要，普通成员不再看到越权的“查看全部”入口。
- 顶栏增加个人中心菜单；新增自主修改密码页面与 `POST /api/auth/password/change-self`，要求当前密码及至少 12 位新密码，MFA 已启用时还要求新的 TOTP/未使用恢复码；变更后撤销全部会话和刷新令牌并记录审计。
- 新增系统管理扩展路线：组织与权限治理、审批与规则配置、运维与灾备、数据治理与集成，并明确哪些是规划项而不是已实现功能。
- 公网异地访问仍须完成真实域名/DNS/TLS、反向代理、防火墙、Node.js 24+ 构建、Prisma 迁移和浏览器端到端验收；本版本不宣称已在公网环境正式上线。

## v2.9.0-rc.1（2026-10-15）

- 新增公网访问安全配置契约：只有配置 `PUBLIC_BASE_URL=https://...`、`NODE_ENV=production`、`COOKIE_SECURE=true` 和独立 `MFA_ENCRYPTION_KEY` 才进入公网模式；公网模式禁止启动 API 文档界面、启用 HSTS 与基础内容安全策略。
- 新增登录会话实体、会话即时吊销、刷新令牌单次消费与重放检测；旧版未消费刷新令牌会在首次刷新时迁移到会话模型，不在数据库迁移时批量失效。
- 新增登录失败按账号/IP 双维度限流桶、安全事件审计和 180 天安全事件清理策略；限流标识采用服务端密钥 HMAC，避免明文存储账号/IP 的计数键。
- 公网模式强制管理员首次登录进入 TOTP 多因素认证设置；恢复码仅生成时展示、数据库仅保存哈希；MFA 种子使用独立 32 字节 AES-256-GCM 密钥加密存储。
- 系统账号管理增加启停、密码重置、强制首次改密和 MFA 恢复；停用/改密/MFA 重置均撤销已有会话，并保护最后一个启用管理员账号。
- 系统管理工作台增加“登录安全中心”，支持查看登录事件、查看活跃会话与撤销非当前会话。
- 新增 Windows + Caddy HTTPS 反向代理示例与公网部署手册。API 仍绑定 `127.0.0.1`；公网仅开放 80/443，PostgreSQL 不对公网开放。
- 新增 TOTP、密钥加密和恢复码单元测试。当前环境为 Node.js 22，而项目要求 Node.js 24+ 且没有安装依赖，严格 TypeScript 构建、Prisma Client 生成、真实数据库迁移与浏览器 E2E 仍需在目标环境完成；此版本不得在这些验收完成前标记为生产就绪。

# 更新日志

## v2.8.0-rc.1（2026-10-15）

- 正式将原“项目工作台”命名为“成本工作台”，把前端布局组件命名为 `CostWorkspaceLayout`，内部规范路由切换为 `/cost/*`。
- 为旧 `/workspace/*` URL 增加集中兼容重定向，保留查询参数、哈希和路由状态；历史 `/workspace/members` 转至 `/system/members`，旧 `/settings/users` 转至 `/system/accounts`。旧版模块路由继续重定向到新的 `/cost/*` 路由。
- 将项目成员列表、项目角色分配统一放在“项目成员与权限”页面；“系统账号管理”页只负责公司级账号创建与列表，消除两个页面的职责重复。
- 新增“系统管理工作台”首页 `/system`，把项目档案、项目成员与权限、系统账号管理整理成独立入口；项目成员管理不再混在成本业务页签中。
- 公司级账号身份与项目内角色继续分离。项目负责人/项目经理在原授权范围内维护项目成员；系统账号创建仍仅限系统管理员；服务端权限校验和审计逻辑不变。
- 没有修改数据库 Schema、历史迁移、财务业务规则或 API 数据契约。完整 lint/build/test 和浏览器/Windows 实测仍需在项目要求的 Node.js 24+ 完整依赖环境完成。

## v2.7.0-rc.1（2026-10-15）

- 基于 `v2.6.0-rc.1` 增量修复报表预览返回流程。所有标准报表、旧版设计器和综合工作室预览入口传递安全返回目标；项目驾驶舱/往来单位快捷自动预览以 `replace` 替换一次性 `autoPreview=1` 路由，避免返回循环；直接打开/刷新预览时使用内部路径校验后的 `returnTo`，默认回报表中心。
- 检查全仓历史返回调用，原有不可靠的裸 `navigate(-1)` 仅保留在报表预览的统一处理函数中，并要求应用内路由显式标记来源可安全回退。
- 项目驾驶舱月度实际成本图扩大 Y 轴标签边距、启用 ECharts `containLabel`，并使用千分位/万/亿标签减少边缘遮挡。
- 项目工作台顶部仅保留视觉分组容器与分隔线，移除可见分组标题；无障碍分组标签保留。
- `report-studio-xlsx.ts` 将字体样式构造对象类型改为 `Partial<ExcelJS.Font>`。
- 新增 `scripts/validate-navigation-regressions.mjs` 并接入发布候选验证；静态导航/界面/XLSX 回归 10/10 通过。完整 lint、生产构建和浏览器实测仍受当前依赖/Node 环境限制，不能视为通过。


## v2.6.0-rc.1（2026-10-15）

- 直接基于 v2.5.0-rc.1 增量演进，未修改数据库 Schema、历史迁移、业务路由或财务口径。
- 精简报表中心：移除重复的三张介绍卡和 Hero 区；标准报表目录改成分类过滤+紧凑行列表，导出配置集中在同一面板，不再重复显示报表类型选择器。
- 项目级和公司级经营报表入口增加明确的“打开工作室”动作提示、箭头以及 hover/focus-visible 状态，遵循减少动效设置。
- 把“项目成员与权限”从成本/分供组移到独立项目管理分组。
- 修正侧栏“经营健康度”：它此前没有实际指标或计算逻辑，仅是静态装饰，不应产生健康评分已实现的误解；现在是可点击的“项目驾驶舱”入口。
- 新增 `scripts/validate-ui-polish.mjs` 并集成进发布候选检查；增加 v2.6 设计方案、验收记录和 WP11 清单。
- 仍为 RC：严格类型检查、生产构建和浏览器 E2E 需在 Node.js 24+、依赖完整的目标环境执行。

## v2.5.0-rc.1（2026-10-15）

- 在 `v2.4.0-rc.1` 基础上增量演进，保留既有业务状态机、金额计算模型和报表工作室旧模板；新增往来单位报表模板上下文迁移，不修改旧迁移。
- 修正报表预览表格的列宽策略：列宽按模板元数据进行有界自然宽度布局，少列宽屏不再拉伸最后一列；打印时保留独立适配规则。
- 报表中心改为业务场景导航：标准台账按成本/业主财务/分供分类浏览，并把项目综合报表、公司经营报告和单位经营档案作为一级入口。
- 在目标成本、实际成本、进度款、变更签证、分供合同/应付、业主应收/收退款、项目驾驶舱、主合同相关工作区与往来单位经营档案加入对应的预览/导出入口；单位档案同时可以打开已保存的单位专属模板编辑。统一复用报表预览链路。
- 增加 `PARTY` 报表域和 `businessPartyId` 模板上下文，往来单位经营档案提供默认报告模板，纳入单位摘要、项目、主合同、分供合同与独立成本；同一个模板不会隐式套用到另一个单位。
- 加强自动延伸区域约束：集合字段必须绑定到相同数据源和指定样板行；同一重复行的所有单元格从同一条记录读取；多集合区域独立展开；数据源排序增加稳定主键作为 tie-breaker。
- 财务单位相关的汇总以整数“分”精确累计，避免先转 JS `number` 后聚合；明细达到查询上限时，不用部分数据伪装完整总额。
- 新增报表预览列宽、模板匹配、默认单位模板、工作台入口和权限边界的静态契约/纯逻辑测试。
- 当前执行环境无法安装完整 Node.js 24+ 项目依赖，完整 `tsc`、生产构建、Prisma/PostgreSQL 集成、浏览器 E2E 及 Excel/WPS 实测仍是发布门禁。本版本保持 RC。详见 `docs/archive/阶段验收历史摘要.md`、`docs/报表中心规格与验收.md`。

## v2.4.0-rc.1（2026-10-15）

- 在 `v2.3.0-rc.1` 基础上增量演进，不重写既有合同、结算、应收应付、收付款与成本台账；未新增 Prisma migration，复用现有模板/版本和 PostgreSQL BackgroundJob 模型。
- 选择固定版本 `@univerjs/presets@1.0.4` 与 `@univerjs/preset-sheets-core@1.0.4` 作为浏览器单元格编辑界面；不引入 Univer Pro 包或转换服务。最终 XLSX 仍由既有 ExcelJS 生成，沿用 PostgreSQL 后台任务。
- 新增项目级/公司级报表工作室，支持多个白名单数据源、单元格绑定、单元格样式、独立单行重复区域自动扩展、多工作表以及模板保存/发布/版本控制。
- 新增综合报表数据源：项目档案、业主主合同、经营指标、分供合同、业主应收、收退款、实际成本、变更签证、进度款及分供应付；公司级只包括当前登录用户可访问项目，并在跨项目明细输出项目编号/名称。
- 增加标准台账与综合报表共用的正式预览页；预览可查看数据、模板版本、多个工作表、样式、截断警告，并支持打印/PDF 与确认后异步 XLSX。预览与后台导出保持模板定义一致，但导出执行时重新读取数据，尚不提供冻结业务数据快照。
- 将旧式报表设计器中的普通下拉及纯日期字段接入共享 `SelectField` 和 `DatePicker`。仓库扫描确认业务页面未再自建原生 `<select>` 或 `input type="date"`；共享控件内部保留原生代理，以兼容表单/辅助技术行为。
- 财务报告聚合以 BigInt 整数分计算；金额以十进制文本传入渲染器，超出 Excel 安全数值精度的金额按文本保留完整小数，避免 JavaScript 浮点数暗中舍入。超行数的来源不再产生看似完整的部分汇总。
- 新增 `scripts/validate-report-studio-v2.mjs`、报表动态区域/金额精度纯逻辑测试和 `docs/报表中心规格与验收.md`。
- 本轮静态候选契约、108 个 TS/TSX 源文件语法转译及 5 个报表渲染器纯逻辑测试通过；完整 TypeScript 类型检查、生产构建、Univer 浏览器实测、数据库集成、Excel/WPS 验证未能在当前环境执行。本版本仍为 RC，详见 `docs/archive/阶段验收历史摘要.md`。

## v2.3.0-rc.1（2026-10-15）

- 在 `v2.2.0-rc.1` 基础上增量演进，保留现有业务页面、API 主路径、XLSX 模板设计器与历史 Git 提交。
- 新增 PostgreSQL `BackgroundJob` 任务表及追加迁移 `20261015020000_postgresql_background_jobs`；用 `FOR UPDATE SKIP LOCKED` 实现并发安全领取、租约恢复、最大尝试次数、退避重试和 7 天结果文件保留。
- 新增 `report.xlsx.export` 任务 handler、版本化 payload、handler 注册表、幂等键/请求 hash、任务状态查询和安全下载端点；报表中心的 XLSX 导出改为后台生成，CSV 和原有同步 XLSX API 保留。
- worker 默认随 API 进程运行；新增独立 worker 入口与可选 Docker Compose `worker` profile，允许未来按负载分离进程而不改任务生产 API。
- 对用户提供的 TypeScript 构建缺陷进行根因修正：严格索引检查、正则/日期解构、遗漏导入、`number`/`bigint` 金额链、Prisma JSON/Decimal、ExcelJS PaperSize/Buffer 类型、React/Lucide/ref 和前端缺失类型等。
- 更新框架演进方案、验收记录、README、Windows/Docker 配置和静态候选检查。静态候选契约全通过；97 个 TS/TSX 文件语法转译无语法诊断；独立纯逻辑/存储路径测试 41/41 通过。
- 当前执行环境不能完成 Node.js 24+ 项目依赖安装，完整 `tsc`、build、Prisma Client 生成、真实 PostgreSQL 迁移和浏览器/Excel/WPS 实测仍是发布阻塞项。本版本保留 RC 标记，不等于生产验收通过。


## v2.2.0-rc.1（2026-10-15）

- 新增 `apps/api/src/platform/module-registry.ts`，统一挂载 15 组现有 Fastify 路由插件，并向外提供受控模块元数据目录；仍为模块化单体，不引入动态执行第三方插件的运行时机制。
- 新增 `GET /api/meta`，暴露产品/版本、API 主版本、基础路径、兼容策略和模块用途，供未来移动端与外部系统做能力发现。
- 新增 `/health/live` 与 `/health/ready`，分别检测进程存活和 PostgreSQL 就绪状态；保留 `/health` 就绪别名以兼容当前运维脚本。
- 所有 HTTP 响应附加 `x-request-id`，服务端错误日志包含请求 ID；对认证、Cookie、密码、刷新令牌和 API Secret 字段设置日志脱敏。
- 生产环境未设置 `CORS_ORIGIN` 时不再默认允许开发用 localhost:5173；开发环境保留本地 Vite Origin。
- 新增 `scripts/validate-architecture.mjs`，检查版本同步、模块路由登记、探针、API 元信息、追踪 ID、CORS 默认值、日志脱敏和无强制缓存/消息中间件依赖。
- 增加《框架演进方案 v2.2.0-rc.1》，明确模块边界、开放 API、连接器适配器、分阶段技术升级与 Gate B 生产验收要求。
- 不修改 Prisma Schema、已有数据库迁移和合同/结算/应收应付/付款退款的业务规则；不新增必需的运行时服务。
- 静态契约检查为 77/77、18/18、19/19、12/12、11/11。当前环境为 Node.js 22.16.0 且没有可复现的完整依赖安装，因此严格类型检查、构建、Prisma/PostgreSQL、Windows 浏览器 E2E 仍未通过/未执行；本版本保持 RC。


## v2.1.0-rc.1（2026-10-15）

- 八类台账报表新增服务端原生 XLSX 导出，保留 CSV；工作簿支持字段类型/格式、冻结窗格、自动筛选、打印纸张/方向、重复表头和导出说明工作表。
- 新增受控报表模板设计器：标题/副标题、列绑定/标签/顺序/显隐/宽度/对齐/格式、静态列、自定义版式行、合并/拆分、行高、打印参数、实时预览、XLSX/打印输出。
- 新增个人/项目/系统三种模板作用域、草稿/发布/归档、发布快照、乐观版本检查、版本历史恢复及审计。模板字段使用白名单，不支持任意 SQL、脚本或公式。
- 目标成本导入新增原生 XLSX 模板、结构/类型预检、表头映射、公式与不安全 ZIP 内容拒绝、行级服务端校验、提交前复核与单事务写入；原 CSV 流程保留。
- 新增 `20261015010000_report_template_designer` 数据库迁移和报表/工作簿测试源、静态报表工作台契约检查及 WP8 端到端验收清单。
- 增加 8 MB 文件、5,000 行输入、10,000 行报表与 ZIP 膨胀相关安全限制；财务台账不开放批量写入。
- 本版本仍为 RC。当前环境 Node.js 22.16.0 低于要求的 24+，依赖安装因网络超时未完成；完整类型检查、构建、真实 ExcelJS 往返、Prisma/PostgreSQL 迁移、Windows 浏览器 E2E 和 Excel/WPS 打开打印验收未通过/未执行。不得将本记录视为生产发布签字。

## v2.0.0-rc.1（2026-10-15）

- 新增八类台账 CSV 报表中心：目标成本、实际成本、进度款、变更签证、业主应收、业主到账/退款、分供合同、分供应付。每类导出由服务端按当前账号的项目访问范围重新查询，最多 10,000 条并提供截断响应头。
- 强化目标成本 CSV 导入：支持中英文表头自动匹配与手工字段映射；校验重复表头、重复映射、字段格式、重复编号、已存在编号与父子顺序；最终写入前再次预检，有错误即不允许提交。
- 新增项目成员与角色管理页面，支持按已注册邮箱添加成员、角色调整、审计写入与最后一名项目负责人保护；服务端仍是最终权限边界。
- 新增动态站内待办和预警，包括待处理变更、外部确认凭证、进度款审批、逾期应收/应付、分供结算、分供合同临期和超目标成本。它们是派生任务，不是持久化已读通知。
- 目标成本录入表单可保存/恢复当前浏览器本地草稿；正式提交仍需明确保存。本轮不实现财务离线写入。
- 增加 `validate-v2-work-packages.mjs` 并将候选检查串联原业务回归检查、工作包源码契约和 11 组审计覆盖源码检查。
- 不修改 Prisma Schema、数据库迁移、合同金额生效、结算过账、应收应付或退款冲销规则。
- WP8 的严格类型检查、production build、Prisma/PostgreSQL 集成、浏览器 E2E 与 Windows 实机验收尚未执行；当前仅为 RC 发布候选。

## v1.9.0-rc.1（2026-10-14）

- 新增全局“操作追溯”页面与 `GET /api/audit-logs` 只读查询接口，支持项目范围、业务对象、关键字和日期范围过滤及分页，展示操作者、项目、业务对象、操作类型、摘要与可展开的审计快照。
- 查询在服务端按当前用户的项目访问范围限域；管理员可查看全局单位档案日志。该界面只读，不更新或删除审计记录，不改变合同/财务状态机。
- 支持 UTF-8 BOM CSV 导出、标准 CSV 引号转义和电子表格公式注入中和；单次导出上限为最新 5,000 条匹配记录。
- 经营总览“最近操作”增加“查看全部”入口；补充开发路线图，将台账导出/导入预览、项目成员权限 UI、审计覆盖率补齐、站内通知、报表中心与离线录入按风险/依赖排期。
- 不新增数据库迁移、不修改既有 Prisma Schema、不改动合同生效、应收应付、结算和退款金额规则。
- 当前仍是发布候选。当前环境 Node.js 22，完整依赖安装、类型检查、生产构建、真实 PostgreSQL 权限联测和浏览器 E2E 尚未执行。

## v1.8.0-rc.1（2026-10-14）

- 将 UI 偏好设置从常驻条改为右上角独立浮层卡片，主题、密度、强调色、宽屏、减少动效与恢复默认归入一张分区清晰的设置面板，并带有平滑进出场过渡。
- 项目管理页不再展示冗余的顶部项目切换长条；改为项目组合摘要与经营信息卡片，展示有效合同额、目标成本、实际成本、累计回款、成本偏差、成本使用率、回款率与待跟进变更。指标来源于现有台账/经营总览快照，不凭空生成利润预测或工程物理进度。
- 新增主题统一的 `SelectField` 与 `DatePicker` 自绘控件。下拉选择器支持列表框语义、选项搜索、键盘选择、滚动跟随和表单注册代理；日期控件支持月份切换、方向键巡检、最小/最大日期约束、今天/清除/完成操作。
- 为设置卡片、下拉框、日期日历、命令面板、快捷操作、项目新建/编辑对话框与项目卡片补充受控的弹出、收回、悬停、回弹和入场错峰动效；减少动效模式压低或关闭动画。
- 未修改 API 业务逻辑、Prisma Schema、数据库迁移或财务算法；本轮为 React UI、通用表单控件、CSS 主题与文档改造。
- 当前为发布候选。完整类型检查、生产构建、浏览器端到端与 Windows 实机验收仍须在 Node.js 24+ 的完整依赖环境中执行。

## v1.7.0-rc.1（2026-10-14）

- 按 `design(1).md` 的 Pro-Tier Suite v4.2.0 规范重构墨衡前端风格，采用“专业生产力仪器”方向：克制中性色、细边框、柔和环境光、较高信息密度与受控动效，而非照搬示例中的金融业务内容。
- 新增四套材质主题：象牙雅白、香槟曜金、黑曜极光、冰川天青，支持跟随系统主题；强调色可跟随主题或切换靛青/青玉/朱砂。旧版存储的 `light`/`dark` 偏好兼容映射到象牙/黑曜主题。
- 将顶栏搜索升级为命令面板，支持 Ctrl/Cmd+K、输入过滤、↑/↓ 选择、Enter 跳转、Esc 关闭，并按业务页面/项目直达分组；保留常用业务快捷操作。
- 强化左侧 Pro 侧栏与顶部命令栏；调整导航宽度、选中态、项目上下文、卡片阴影、状态胶囊、输入焦点与按钮按压回弹；数据表使用低对比浮岛式行分隔与等宽数字。
- 增加全局表格键盘巡检：J/K 或方向键移动当前行，聚焦行后可按 Enter 触发行操作；保持输入框/选择框中的原生键盘行为。响应式布局、紧凑密度、宽屏和减少动效继续可用。
- 业务页面路由、API 接口、数据库模型及既有财务/结算规则未作功能性变更；本次为前端视觉与交互层改造。
- 当前为发布候选。静态检查可覆盖主题状态、命令面板和样式契约；实际浏览器外观、完整 TypeScript 构建和端到端键盘行为仍需在 Node.js 24+ 完整依赖环境中复核。

## v1.6.0-rc.1（2026-10-14）

- 产品名称由旧名称调整为两字古风品牌“墨衡”；统一更新登录页、侧栏 wordmark、页脚和浏览器标题，并绘制新的建筑/衡尺风格 SVG 标识，网站 favicon 使用 `apps/web/public/moheng-mark.svg`。
- 项目工作台顶部业务导航移除“业主侧·收入”“成本支出侧”文本标题；保留两组菜单容器，通过轻背景、间距、细分隔线和激活态区分业务区块，避免顶部文字标签造成拥挤。
- 重构业主“竣工结算与应收账款”页面：重点指标收敛为六张卡片；将竣工结算、应收账款、收退款流水、质保金与预付款分为四个交互页签，每次展示一个业务区；宽表采用独立限高滚动区与吸顶表头，加入平板/窄屏响应式布局，改善原页面所有表格连续堆叠、信息层级弱和横向拥挤的问题。
- 主导航下方新增 UI 偏好栏：浅色/深色/跟随系统主题、标准/紧凑密度、靛青/青玉/朱砂强调色、宽屏切换、减少动效及重置。偏好保存在当前浏览器，不影响共享业务数据；深色变量覆盖导航、面板、表格、表单、弹窗和应收页面。
- 增加了 SVG 品牌资源和 UI 偏好状态管理；更新 README、用户操作手册、开发维护指南和发布候选验收文档。
- 项目已初始化 Git 仓库，默认分支 `main`；导出源码 ZIP 与 Git bundle 两种交付，保留基线导入与本轮变更提交记录。Git 不包含 `.env`、数据库备份或受控附件。
- 本版本为发布候选。静态候选检查、独立纯逻辑测试和 TS/TSX 语法解析结果以 `docs/archive/阶段验收历史摘要.md` 为准。当前环境 Node.js 22.x，未安装项目完整依赖，尚未完成完整 `tsc`、前后端 production build、Prisma 校验/生成、真实 PostgreSQL 迁移与 Windows 浏览器 E2E；不应视为生产验收通过。

## v1.5.0-rc.1（2026-10-14）

- 修复往来单位资料编辑弹窗布局：编辑表单内部滚动，底部保存/取消操作区保持可见，避免长表单挤出视口。
- 新增业主侧竣工结算与应收账款模型：最终累计结算只过账与历史已确认累计的差额，支持正负调整、应收分期、到账/退款核销、业主预付款、质保金释放与进度款应收回填。清单明细仍为可选。
- 增加业主到账校验：普通到账不超过选定应收单余额和主合同净应收敞口；最终结算过账后，旧进度款到账入口关闭，统一走应收台账。退款保留原始与反向流水，并同步负向进度款到账明细。
- 将“分供合同与付款”和“结算与应付”合并到“分供合同与结算”工作台入口，内部保留合同台账/付款与结算/应付两个子视图；项目工作台导航按“业主侧·收入”和“成本支出侧”分组。
- 使用数据库序列表按项目、业务类型、年份自动生成可读编号；内部 ID 作为稳定关联键，合同号继续允许手工输入以适配纸面合同和外部归档号。
- 登录页面增加“记住账号”；密码只依赖浏览器/操作系统密码管理器进行保存与自动填充，应用不在 localStorage 明文保存密码。
- 新增 `20261014030000_owner_settlement_receivables_document_sequence` 迁移；不修改旧迁移。增加最终结算差额、合同净应收敞口及应收状态的纯逻辑测试。
- 本版本为发布候选。静态检查、源文件语法解析和纯逻辑测试已执行；由于当前环境 Node.js 22.x 且未完成依赖安装，尚未完成 Node.js 24+ 完整类型检查/构建、Prisma 校验/生成、真实 PostgreSQL 迁移和 Windows 浏览器端到端验收。详见 `docs/archive/阶段验收历史摘要.md`。

## v1.4.0-rc.1（2026-10-14）

- 新增统一“往来单位库”，使用 `BusinessParty` 主档管理建设单位、材料供应商、劳务/专业分包、租赁单位、服务商及其他单位；同一法律主体可以具有多个角色，不再为每类单位建立互不关联的独立库。
- 项目建设单位、业主主合同相对方、分供合同相对方和独立成本记录增加可空单位 ID 关联。原有文本名称字段保留为历史快照，单位更名不会覆盖旧合同名称。
- 合同登记支持检索选择既有单位、自动带出已维护资料，并可在合同提交时按单位名称复用或快速建档；出现同名多主体时拒绝模糊匹配。确认“同名不同法律主体”建档需管理员、独立统一社会信用代码和明确确认。
- 新增“单位经营档案”，按当前用户可访问的项目范围汇总关联项目、主合同、分供合同、结算、应付未付、付款/退款净额、发票和实际成本摘要；合同、项目及成本处的单位名称可进入单位档案。
- 新增单位身份核验标记、历史名称、单位角色、状态和审计日志；统一社会信用代码全局唯一。历史文本数据按规范化名称回填关联，但档案默认未核验并显示警示，要求复核主体身份后再将跨项目汇总用于对账。
- 沿用 v1.3.0-rc.1 的结算/应付模型，结算清单明细仍是可选项；没有合同/预算清单时可纯金额完成结算，清单明细不是必要的数据支撑。
- 新增迁移 `20261014020000_business_party_master`，不修改旧迁移；将往来单位身份、合同关联、权限范围、重复名称、可选清单以及结算/应付流程加入发布候选检查和纯逻辑测试。
- 本版本仍为发布候选，并非生产验收通过。已执行 54/54 静态候选检查、53/53 纯逻辑测试和 59 个 TS/TSX 文件语法解析；未完成 Node.js 24+ 完整依赖安装/类型检查/构建、Prisma schema 校验、真实 PostgreSQL 迁移及 Windows 浏览器端到端验收。历史单位的名称匹配可能包含主体不确定关系，单位页会提示待核验；正式上线前需完成身份复核与数据库联测，见 `docs/archive/阶段验收历史摘要.md`。

## v1.3.0-rc.1（2026-10-14）

- 新增“结算与应付”项目工作台页面；分供合同结算支持阶段结算、最终累计结算及正负调整单，内部审批、外部对方确认、正式过账分离，并保留确认凭证和审计轨迹。
- **结算清单项为可选数据**：可以纯金额方式创建、审核、确认和过账结算；有明细时再核对明细合计，不要求关联目标成本清单或合同清单。未提供清单不得阻止合同结算。
- 最终结算按“最终累计确认金额减历史已过账累计金额”只过账差额，防止阶段结算金额与最终累计金额重复累计。负向结算调整生成供应商待返还/抵扣余额，不会伪装成负数现金付款。
- 结算过账生成独立应付单；普通付款须分配到已过账应付余额，退款自动反向恢复原付款的应付核销。应付余额、预付款余额、质保金余额、供应商待返还/抵扣和付款现金流分别展示。
- 新增预付款扣回、质保金留置/释放/核销、供应商发票登记/核验/对应付来源分配；均与实际成本分开，付款和发票不自动生成或冲减实际成本。
- 新增 PostgreSQL 迁移 `20261014010000_settlement_payables_invoice_retention`；已交付旧迁移未修改。新版本 API、前端页签、静态候选检查和纯函数金额测试纳入回归覆盖。
- 这是发布候选版本，不代表财务上线认证。当前环境可执行静态候选检查、TypeScript 语法转译与独立纯逻辑测试；未完成 Node.js 24+ 完整依赖安装、Prisma Client 生成/校验、完整类型检查与前后端构建、真实 PostgreSQL 迁移和 Windows 浏览器端到端验收。见 `docs/archive/阶段验收历史摘要.md`。

## v1.2.4-rc.1（2026-10-14）

- 主合同页面从常驻大表单调整为紧凑概览：默认展示合同基准、当前有效合同额、已生效调整净额及关键条款；新建/编辑资料在对话框中完成，原始合同金额建档后仍锁定。
- 新增“项目工作台”统一入口，通过共享页签访问项目驾驶舱、业主主合同、预算与目标成本、进度款、变更签证、分供合同与付款、实际成本及成本分析；旧 URL 保留重定向兼容。
- 将“经营总览”修正为真正的跨项目视图：移除依赖当前选中项目的月度成本分析；增加项目级目标成本、实际成本、成本偏差、业主回款和回款/合同额指标；服务端按项目分组汇总。
- 新增独立的“项目驾驶舱”，展示所选项目的核心指标、业务待跟进事项和各模块入口。项目驾驶舱与成本分析分离，前者是工作总览，后者是分析报表。
- 分供合同页面名称更改为“分供合同台账”，“已结算”界面状态更精确地命名为“结算已确认”。结算确认不再禁止登记尚未支付的结算款/质保金支付或退款；新付款计划与补充协议仍受状态限制。
- 当前支付上限仍按合同当前金额校验，未引入独立的最终结算额/应付账款表；该项作为后续财务模型单独建设，避免暗示已经具备正式结算应付控制。
- 新增项目工作台、跨项目/单项目范围、主合同表单交互及结算后付款规则的静态候选检查。当前可执行检查：34 项独立测试、47 个 TS/TSX 语法解析、34 项候选静态检查通过；尚未完成完整依赖安装、类型检查/构建及真实 Windows 浏览器交互验收。

## v1.2.3-rc.1（2026-10-14）

- 新增分供合同台账：包括采购、劳务/专业分包、机械租赁、服务等合同登记、草稿/执行/完工待结算/已结算/终止状态、已生效补充协议追加记录。
- 新增分供合同付款计划与实际付款台账；付款/退款按现金流分开记录。退款必须关联同一合同下的原始非退款付款、继承其付款计划，并阻止累计退款超过原付款金额。
- 实际成本新增可选分供合同关联，旧成本支持依据发票/验收/结算依据人工补关联并写审计；付款或退款都不会自动创建/冲减实际成本。
- 业主进度款申报和变更签证新增主合同外键；旧记录按当前项目已有主合同回填，主合同补建时只补齐空关系并记录审计。
- 校正成本分析术语：把执行中/完工待结算合同当前金额合计与“未履约承诺”分开，不再将合同额减已关联实际成本的算术差额标成准确承诺余额或预计成本。
- 新增合同与成本归集设计说明、迁移说明、API 和操作维护文档；原有已发布迁移文件保持不变，新增第六个迁移 `20261013050000_downstream_contract_management`。
- 当前环境中 33 项独立测试通过、45 个 TS/TSX 文件语法转译检查通过、28 项静态候选一致性检查通过。未完成完整依赖安装、`tsc` 类型检查、Prisma 生成/验证、真实 PostgreSQL 迁移或 Windows 端到端构建验收；候选包尚无 `package-lock.json`。详见 `docs/archive/阶段验收历史摘要.md`。

## v1.2.2-rc.4（2026-10-14）

- 加固 Windows 原生启动/停止脚本：启动时将绝对 API 入口路径传给 Node.js；PID 文件指向已存在但无法匹配本项目的进程时拒绝继续，不会因为 PID 复用将它当成本系统实例。
- 停止脚本通过 Windows 进程命令行核验 `node.exe` 与本项目绝对 `server.js` 路径，并核对 CIM 与已打开进程句柄的启动时间后，才通过已验证的进程句柄结束进程；身份不匹配时保留 PID 文件并中止，避免因 PID 复用误杀其他应用。
- 启动脚本不再仅凭进程存活就报告成功，而是在 20 秒有界窗口内轮询 `/health`，要求 API 与 PostgreSQL 均健康，否则停止本次启动的进程、清理本次 PID 文件并报错。
- 扩展 `validate:release-candidate`，加入 Windows 启停脚本的身份核验、健康检查与版本一致性静态检查。
- 本轮在临时目录以全局 TypeScript 转译包内三组测试后，使用 Node.js 测试运行器实跑 18/18 项通过；41 个 TS/TSX/TypeScript 脚本文件语法转译检查通过，候选一致性检查 16/16 项通过。
- 未完成 Windows PowerShell 实机运行、Node.js 24+ 完整依赖构建、Prisma 生成/迁移或 PostgreSQL 集成验收；npm registry 连通性检查在 18 秒内超时。当前候选包也未包含 `package-lock.json`，正式构建前需生成并复核依赖锁文件。

## v1.2.2-rc.3（2026-10-13）

- 保存金额差异复核触发时的内部参考金额与外部确认金额快照，避免后续内部金额变化时把原差异显示成另一组数字。
- 将旧数据库基准重建作为全新迁移，保持已交付的 `20261013020000_contract_change_external_confirmation` 迁移文件不变。
- 基准重建优先读取正式主合同台账金额；在更改项目基准/有效金额前保存迁移前后差异台账，并对负数或超出数据库金额范围的结果中止迁移。
- 对历史已生效但外部确认金额与内部参考金额不一致的记录自动标记待复核；不改写其外部确认金额或生效状态。
- 增加发布候选静态迁移一致性检查。18 项纯函数/凭证存储测试与 39 个 TS/TSX 语法转译检查通过。
- 未声称完整构建或发布验收通过：当前环境 Node.js 22，依赖安装受 registry DNS (`EAI_AGAIN`) 阻塞，未完成 Node.js 24+ 完整构建、Prisma 生成、PostgreSQL 迁移和 Windows 实机流程验收。

## v1.2.2-rc.2（2026-10-13）

- 锁定正式主合同归档后的原始合同金额，项目资料编辑与主合同接口共同执行同一策略。
- 将旧数据库原始合同金额 reconciliation 移入独立的新迁移，不篡改已发布版本迁移；优先以正式主合同台账金额重建基准和当前有效合同额，并保存迁移前后金额差异记录。
- 对核验驳回和争议状态开放“补充材料/重新提交”路径；重提时清空旧核验结论，并将旧结论留在审计记录中；已经生效的外部确认仍不可直接覆盖。

## v1.2.2-rc.1（2026-10-13）

- 锁定已建档正式主合同或已有外部确认记录后的原始合同金额，合同增减应通过变更签证登记，不得覆盖原始基准。
- API 项目编辑和主合同保存流程在事务中锁定项目行，防止与外部确认并发修改合同基准。
- 仅在尚未建立正式主合同且没有外部确认记录的初始建档阶段允许修正原始金额。
- 项目页和主合同页对已锁定的原始金额提供只读提示；API 同时执行服务端校验。
- 新增原始合同金额锁定策略测试。

## 1.2.1 — 发布前验证候选修订

- 修复凭证上传文件名与 MIME 类型不一致的边界：即便内容声明为 PDF，也拒绝使用 `.exe` 等不受支持扩展名，避免下载时出现误导性的可执行文件名。
- 增加对应回归测试；金额计算与凭证存储独立测试共 11 项通过。
- 完成 39 个 TS/TSX 文件的语法转译检查。
- 本修订仍未完成真实依赖安装、完整类型检查/打包、PostgreSQL 迁移和 Windows 端到端验收；详见 `docs/archive/阶段验收历史摘要.md`。

## 1.2.0 — 外部确认与凭证核验

- 将原始合同金额与当前有效合同额分开保存；有效合同额按原始金额加已生效外部调整净额重算，减少项以负数计入。
- 将变更公司内部状态与外部确认生效状态分离；内部审批金额不再单独改变有效合同额，也不覆盖外部确认金额。
- 增加 A/B/C 外部凭证类别、外部确认人身份/授权、确认时间、金额、范围、凭证定位、原始上下文和凭证文件记录。
- C 类凭证进入待独立核验状态；创建人或提交人不得自核验，核验通过后立即生效，不需要再次审批金额。
- 为凭证文件增加受限本地存储、SHA-256 完整性校验、文件类型/签名检查、大小限制和下载审计。
- 增加系统管理员账号创建与项目角色分配界面，为提交人与核验人职责分离提供账号基础。
- 增加有效合同额整数分计算测试，并阻止负数有效合同额、超出 `DECIMAL(18,2)` 上限和静默舍入；按项目串行化外部确认指纹检查，阻止同一文件重复附加及高度一致的确认信息重复登记。
- 增加数据库迁移、操作手册、维护指南及部署注意事项。

### 已知限制

- 本版本仍为核心台账 MVP；公司审批链仍是固定状态流，没有公司级可配置审批流。
- 当前环境未完成依赖安装、完整 TypeScript 构建、数据库迁移或 Windows 端到端验证。发布前必须在 Node.js 24+ 的 Windows 测试环境执行安装、构建、迁移和关键流程验收。
- 凭证病毒扫描、独立对象存储/不可变归档、自助密码重置与账号停用界面暂未实现。Windows 部署应自行配置凭证目录的 NTFS ACL。
- 旧版本记录没有外部凭证数据，因此不会把旧内部审批状态自动视为外部确认生效；升级前应核对历史项目合同额并为确需计入的历史变更登记有效外部凭证。
