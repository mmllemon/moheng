# 墨衡样式退役审计（只读扫描，2026-10-21）

工具：`scripts/audit-css-dead.ps1`（可重跑）。方法：提取各 CSS 的 `.class` 选择器，
在 `apps/web/src` 全部 ts/tsx/mjs + `index.html` 文本中做整词匹配；未命中记为 dead 候选。
基线提交：`1058d7c` 之后的工作树。

## 结论一：import 链现状

`main.tsx` 按序加载 `styles.css → legacy.css → v6.css → hana.css`，另有两个页面级 CSS
（assistant-provider、projects-ledger）直接 import。四棵树共存约 660KB，其中 legacy 308KB、v6 92KB。

## 结论二：级联是干净的

- 跨层同名类中，legacy/v6 **没有任何 `#id` 前缀或 `!important` 反压规则**（扫描命中 = 0）。
- hana.css 排在最后 import，同名普通类选择器一律 hana 赢。
- 但代价是：**同规则里 hana 未重定义的属性会从旧层泄漏**（旧值继续生效）。
  重叠规模：hana 729 类中 **355 类与 legacy 同名、260 类与 v6 同名**。
  这就是"旧文件不能整删"的唯一技术原因。

## 结论三：死代码候选（全代码库无字面引用）

| 文件 | 类总数 | 未命中 | 占比 |
| --- | --- | --- | --- |
| legacy.css | 1046 | 340 | 32.5% |
| v6.css | 490 | 153 | 31.2% |
| hana.css | 729 | 93 | 12.8% |
| assistant-provider.css | 53 | 3 | 5.7% |
| projects-ledger.css | 22 | 1 | 4.5% |

完整清单：`docs/gates/dead-classes-styles_*.txt`（按文件分组，逐类一行）。

误报防线（删除前逐条确认）：
1. **运行时拼接类名**（如 `prefix + state`）不会以完整字面量出现，静态扫描会误判为 dead。
   抽样看到的 dead 名均为完整业务类（`project-cost-trend-panel`、`owner-finance-tabs` 等），拼接风险低，
   但删除前对同名前缀族做一次 `grep -o 'class-[$]'` 复核。
2. **第三方 DOM 注入类**：xterm / tiptap / CodeMirror / univerjs 会给运行期元素挂自己的类，
   代码库中同样无字面量。删除涉及这些库样式命名（`.xterm-*`、`.cm-*`、`.ProseMirror`、`.univer-*`）的条目需人工排除。
3. dead 判定基于"该字符串在源码中不出现"；若类名只出现在注释/文档里会被计为 used（保守方向，可接受）。

## 建议退役路线（分批、每批可独立回滚）

1. **第一批（纯增量，零风险）**：删除上表 dead 条目——先从 hana.css 的 93 条开始（自身规范层瘦身），
   再 legacy 340 / v6 153。每条删除时顺带记录其所在规则块。
2. **第二批（按页收敛）**：以 355/260 张重叠类清单为工单，逐类把 legacy/v6 规则中
   hana 未覆盖的属性迁入 hana.css 对应类，删除旧规则。每迁完一页跑一次视觉回归
   （墨衡已有 `__tests__` 结构，建议给关键页加截图对比）。
3. **第三批（摘除）**：某旧文件的全部活跃类都完成迁移后，从 `main.tsx` 移除 import。
   legacy/v6 各自独立成批，互不阻塞。
4. 每批完成后重跑 `pwsh scripts/audit-css-dead.ps1`，dead 列表应只减不增。
