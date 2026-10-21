# 墨衡 · Hana 1.1.35 视觉规范

本规范以 **Hana 1.1.35 安装版 renderer 的实际 DOM / CSS** 为基准，不引用未经验证的重绘稿。
墨衡保留工程经营管理的业务密度，但外壳、纸张、排版、控件、弹层与设置工作区统一到 Hana 的设计语言。

> 状态（2026-10-21）：当前唯一有效界面规范；UI 收口基线 `eec9677`。落地与例外见 [UI 验收 Hana](UI-验收-hana.md)，V6/Pro-Tier 文档已移入 `docs/archive/`，不再作为实现依据。
> 同日按 `reference/hana-1.1.35/` 字节精确快照（renderer 可读层）逐条复校 §2/§3/§4/§6；口径标注见各行「依据」列，快照来源见其 README。✅ = CSS/HTML 快照内直接可证；⚠ = DOM 运行时实测值，快照中未检索到对应规则（多藏于压缩 chunk，无法复证）。

## 1. 设计北极星

**一张摊开的工程经营纸。** 纸面负责安静，墨色负责判断，唯一的远山青负责交互。
不用渐变光晕、玻璃卡片堆叠、工程仪表盘式的密集描边来制造“专业感”。

## 2. 实测基准

| 项目 | Hana 1.1.35 实测 | 墨衡落地 | 依据 |
| --- | --- | --- | --- |
| 页面纸色 | `#F8F4ED` | 同值 | ✅ `themes/warm-paper.css` `--bg` |
| 卡片纸色 | `#FCFAF5` | 同值 | ✅ `warm-paper.css` `--bg-card` |
| 侧栏纸色 | `#F4F0EA` | 同值 | ✅ `warm-paper.css` `--sidebar-bg` |
| 主墨色 | `#3B3D3F` | 同值 | ✅ `warm-paper.css` `--text` |
| 侧栏宽度 | 240px（另有 `--jian-sidebar-width: 260px` 供笺侧栏） | 同值 | ✅ `styles.css` `--sidebar-width: 240px` |
| 侧栏定位 | calc(100vh − 12)，left/top 6 | 同值 | ⚠ DOM 实测，CSS 快照未检索到对应规则 |
| 侧栏圆角 | 7 × 1.8409 = 12.886 | 13px，圆角矩形 | ✅ 系数见 `themes/continuous-corners.css` `--corner-radius-scale: 1.8408964152537137`；7px 基数为 ⚠ DOM 实测 |
| 侧栏边界 | 1px rgba(0,0,0,.08) | 1px 主题 overlay | ⚠ DOM 实测 |
| 侧栏阴影 | 0 4px 32px rgba(0,0,0,.05) | 同值 | ⚠ 压缩 chunk 中存在同值阴影，未能归因到侧栏 |
| 标题层 | 44px，透明，不占内容纸面 | 同值 | ✅ `styles.css` `--titlebar-h: 44px` |
| 设置窗 | 960 × min(840, 100vh − 48)；导航 208px | 同值 | ✅ `SettingsModalShell` chunk 内 960px / 208px |
| 设置窗内容列 | 实测 722（770 高窗口得 670px 内容） | 同值 | ⚠ CSS 无 670px 定值，内容列由 calc 派生；722/670 为 DOM 实测 |
| 字号 | rem 六档：title 1 / body .9 / ui .82 / caption .78 / hint .7 / micro .62（root 16px ≈ 16 / 14.4 / 13.1 / 12.5 / 11.2 / 9.9） | 13px 基准，关键正文 12–14 | ✅ `styles.css` `--fs-title` 至 `--fs-micro`（注意还有第六档 micro，本文档旧版漏记） |
| 动效 | 0.1 / 0.15 / 0.25s | 同值 | ✅ `styles.css` `--duration-instant/fast/slow`，源码注释语义与三档分工一致 |

Hana 的窗口控制键是桌面端系统窗控；墨衡是 Web，不伪造 macOS 红黄绿，也不放 min/max/close。

## 3. 材质

纸纹直接采用 Hana 1.1.35 安装版原版资产，放在 `/textures/hana/`：

- `rice`：宣纸，长纤维 + 云斑
- `cotton`：棉纸，短纤维 + 柔絮
- `fine`：细纸，低对比细颗粒

每种纸纹由三层原版遮罩合成：`mottle`（云斑）、`fiber`（纤维）、`grain`（颗粒），
平铺尺寸分别为 1024 / 720 / 256px ✅（`styles.css` `--paper-texture-mottle/fiber/grain-tile`）。界面用 `data-paper-texture="rice|cotton|fine"` 切换；
`off` 时移除该属性。

明暗层 `::before` / `::after` 使用同一组 hi/lo 遮罩，按
`--paper-texture-peak: 0.09`（✅ `styles.css`，注明烘进 alpha）和 `--paper-texture-strength: 0.5–1.5`
（⚠ 运行时默认区间：由 JS 层内联注入，CSS 快照无此规则，区间来自 Hana 设置 UI 而非样式表）改变纸面明度差，
而不是把整层纹理调透明。默认强度 1；0.5 更轻，1.5 更明显。

纸纹只铺在页面底纸、侧栏和设置窗，不进入表格单元格，避免数字发灰。
铺纸容器的内部区块必须保持透明：设置导航、侧栏底部区、设置内容列不得再铺一层
`color-mix(..., var(--bg))` 或半透明纸色，否则纸纹会被盖成一块平色。分组只用边框、间距和悬浮态区分。
这些原版纹理的再分发需确认 Hana 的授权范围；若仓库对外公开，请在上线前完成素材授权复核。

## 4. 色彩与主题

Hana 1.1.35 共 10 套主题（✅ `theme-registry-data.json` + `locales/zh.json` 显示名）：
暖纸 `warm-paper`、青夜 `midnight`、素白 `high-contrast`、草香 `grass-aroma`、沉思 `contemplation`、
Absolutely、delve、deep-think、新暖纸 `new-warm-paper`、青夜·高对比 `midnight-contrast`。
墨衡主抄前三套；字体对比度五档（较淡/适中/舒服/较深/最深 = 9/11/13/15/17，默认 13，✅ `content-contrast.css`）
作用于全部主题。

三套基准主题的 **Hana 真值**（✅ 各自 `themes/*.css` 逐值核对）：

| 语义 | 暖纸 warm-paper | 素白 high-contrast | 青夜 midnight |
| --- | --- | --- | --- |
| `--bg` | #F8F4ED | #FAF8F7 | #3B4A54 |
| `--bg-card` | #FCFAF5 | #FDFBFA | #445560 |
| `--sidebar-bg` | #F4F0EA | #F3F1F0 | #34424B |
| `--text` | #3B3D3F | #1A1C1E | #E1EAF0 |
| `--text-muted` | #6B6F73 | #4A4E52 | #B7C5CE |
| `--accent` | #537D96 | #3A6B85（钢蓝） | #C99AAF（藕粉） |

> 青夜·高对比 midnight-contrast（供深色高对比场景参考）：bg #26343D / card #30414B / sidebar #202C34 /
> text #F0F6FA / muted #D3E0E8 / accent #E6B1C4。

墨衡落地 token（数值维持现状）。复刻目标实为**青夜·高对比**（midnight-contrast）；
落地表"青夜"列即其真值，已在 `hana.css` 注释中自证（`/* 青夜：Hana midnight-contrast */`），仅选择器沿用了 `data-theme="midnight"`。

| 语义 | 暖纸 | 素白 | 青夜（= 青夜·高对比 midnight-contrast） |
| --- | --- | --- | --- |
| `--bg` | #F8F4ED ✅ | #FBFAF7 | #26343D ✅ |
| `--bg-card` | #FCFAF5 ✅ | #FFFFFF | #30414B ✅ |
| `--sidebar-bg` | #F4F0EA ✅ | #F3F1EC | #202C34 ✅ |
| `--text` | #3B3D3F ✅ | #2A2A29 | #F0F6FA ✅ |
| `--text-muted` | #5F6367 | #5F6367 | #B7C8D3 |
| `--accent` | #466B80（刻意压深，见下） | #466B80 | #E6B1C4 ✅ |

- 暖纸列四行底色/墨色与青夜（midnight-contrast）列五行逐值对齐 Hana 真值 ✅（muted 与暖纸 accent 除外，见下）。
- Hana `--text-muted` 实测：warm-paper `#6B6F73`，midnight-contrast `#D3E0E8`。表中 #5F6367 / #B7C8D3 为墨衡自制选择，
  旧版记作"Hana 实测"不成立；跟齐与否同样归入下方素白条目的实现决策。
- 素白列（#FBFAF7 等）与 Hana 真值 `high-contrast`（#FAF8F7 / #FDFBFA / #F3F1F0 / #1A1C1E / #4A4E52）差一步；
  且素白 accent 是钢蓝 #3A6B85 而非远山青。跟齐则逐值替换并复跑对比度验收；不跟齐则改标为墨衡自制主题。
- Hana 原始 accent 为 `#537D96`（✅ `warm-paper.css`，hover `#456A80`）；墨衡统一压深到 `#466B80`，让 10–12px 文字、链接和主按钮达到 WCAG AA（4.5:1），色相仍是远山青。
- 语义色只用于状态：成功 `--green`、危险 `--danger`、提示 `--warning`。不要用装饰色表达状态。
- 青夜主题的主按钮文字改用深墨 `--on-accent`，避免粉底白字对比不足。

## 5. 外壳

```
.app-shell
├─ .app-sidebar        fixed; 6px 四周内缩；240px；13px 圆角
│  ├─ 44px toolbar     收起 / 搜索
│  ├─ 品牌行
│  ├─ 业务导航
│  ├─ 项目快速切换
│  └─ 用户 / 系统设置
└─ .app-main           margin-left: 246px
   ├─ .app-titlebar    44px 透明；上下文 + 右侧浮岛
   └─ .app-content     独立滚动
```

- 标题层不是第二条导航栏：左侧是当前页上下文，右侧是 30px 浮岛图标组。
- 全局搜索收进图标，通过 `⌘K` 打开命令面板，不再常驻一条 300px 搜索框。
- 项目切换收进标题层；全局页面显示“全公司”。
- 页脚版本号移除，版本只在设置/关于出现。
- Hana 的卡片圆角按平台分叉：`html[data-platform="win32"]:not([data-windows-card-radius="off"])` 施加
  `--panel-card-radius: min(var(--radius-lg), 7px)`（✅ 快照 `styles.css`），Windows 桌面端把卡片圆角封顶 7px；
  墨衡是 Web 不会命中该分支，现状等价于 Hana 非 win32 观感。若墨衡将来打包桌面端，需重新决定是否复刻这一封顶。

## 6. 页面与组件

- 页面标题：`--font-heading` 27px；默认思源宋体，可切换系统黑体或光谱西文衬线；设置内容标题仍为无衬线 16px。
- 卡片：`--bg-card` + 1px `--card-border` + 14px 圆角；不加投影，不用卡片套卡片。
- 分区：**小标题栏在正文卡片之外**。标题 17px/600、字距 0.05em，下方 11px 说明；右侧放排序、筛选和跳转。正文卡片独立从标题下方开始。旧页面由 `use-detached-panel-headers` 测量 `.panel-heading` 高度，用 `::before` 从标题底部绘制卡片，避免重写业务 DOM。
- 表格：表头 10px 字距 + 0.5 透明底线；表格左右各内缩 18px，行线不顶到卡片边缘；行 9px/12px 内边距；数字等宽；悬停用 8% accent。
- 操作链接：`全部项目`、`操作日志`、`查看快照` 等使用 28px 幽灵按钮（透明底、muted 文字、悬停 3% 墨底），不再用强调色胶囊或描边小按钮。
- 按钮：32px 高、9.2px 圆角（口径见下方“交互半径”）；主按钮实心 accent；危险按钮默认幽灵，悬停才染 8% danger。
- 输入框：32px 高、11.05px 圆角、1px 边框、纸白底；弹窗、筛选和表内编辑共用同一 token。聚焦使用 accent 边框 + 2px 11% 外环。
- 选择器：触发器 32px 高、11.05px 圆角、纸白底 + 1px 边框，悬停/展开转 accent；弹层 14.7px 圆角、4px 内边距，选项 30px/7.36px 圆角，悬停 accent-light，选中 accent 文字。日期选择器使用同一半径与边框。
- 设置行：左侧 13px/600 标签 + 10.5px muted 说明，右侧 220–340px 控件；行高至少 56px，分隔线左右各内缩 16px。审计筛选、运维备份、AI 助手、账号创建均改用这一结构，不再用 3–5 列表单硬塞进 670px。
- 设置搜索：32px 高、11.05px 圆角、5% 墨色底 + 1px 透明边界；10px 左侧搜索图标，右侧 20px 圆形清空按钮；输入后切换为两行搜索结果（标题 + 分组路径），并按 Hana 的搜索索引方式补充语义别名：输入“主题”命中界面，“备份”命中运维备份，“模型”命中 AI 助手，“字典”命中基础字典，不再只匹配导航标题。
- 交互半径：统一为三级 token，禁止页面写死 2/3/5/7/8/10/12px：控件 `--radius-control`（6×1.8409≈11.05），按钮/导航 `--radius-action`（5×1.8409≈9.20），行内小操作 `--radius-compact`（4×1.8409≈7.36）。卡片使用 `--radius-card`（8×1.8409≈14.73）。输入框、下拉、搜索壳、按钮和分段按钮一律 `corner-shape: round`，不再混用 squircle。系数 1.8409 本身 ✅ 实证（`continuous-corners.css`，squircle 支持时生效，否则回退 1）；各档基数 6/5/4/8 为 ⚠ DOM 实测。
- 状态 token：`--state-hover-bg`（4% 墨色）、`--state-hover-bg-strong`（7%）、`--state-selected-bg`（7% accent）、`--state-selected-border`（18% accent）、`--state-focus-bg`（4% accent）、`--state-focus-ring`（52% accent）。列表/表格/命令项/会话行共用，禁止再写 `#f6f1e5`、bronze 首列竖条或 hover 改 padding。
- 卡片 inset：`--card-inset: var(--space-16)`。卡片正文、汇总格、提示条、列表行、空状态至少 16px 横向内缩；表头/表格通过 16px 外边距而不是把首个单元格贴到卡片边缘。
- 概览指标卡：grid 统一 align-items: stretch + grid-auto-rows: 1fr，卡片 height: 100%；文字长短不再造成卡片高低不一。
- 弹层：14–20px 圆角、1px 边界、大阴影；命令面板 18px 圆角。
- 大浮层：548px 纸卡、20px 圆角、顶部 4 个分类 tab、两列入口、底部操作条；不用菜单行堆叠，参考 Hana 能力面板。快捷操作已按此重建。
- 对话框：20px 纸卡 + 纸纹；标题 17px，头部不再拉满宽底线，底部操作区透明，只用 45% hairline 和 16px 间距。输入框 10px 圆角，底部按钮 32px/9px 圆角；所有标准 `.dialog` 共用。
- 提示 / 口径 / 注释：统一为 10px 圆角的轻透底卡片。信息用 6% accent + 15% accent 边框，成功用 7% green，错误用 7% danger，中性说明用 5% 墨色 + 16% 墨色边框；不再使用左侧竖线或全宽灰条。
- 设置式业务页：页面标题 + `.settings-section` 小标题 + `.settings-card` + `.settings-row`（左侧标签/说明、右侧控件）。系统管理子页全部使用这一结构；字典目录改为“目录单列行 + 独立分类资料卡 + 字典项行卡”，目录只负责选择，字段编辑不塞进列表行中，也不再使用 6 列宽表。
- 运维页：四项运行状态合并为一张 2×2 状态卡；备份配置用设置行；备份与恢复记录改为可换行行卡，不再使用 6 列宽表，因此 733px 窗口下也没有表头线、空表行和横向滚动条。
- 设置内分段切换：28px 轨道 + 2px 内边距 + 26px 白色滑块，计数是纯文字；不使用整排胶囊按钮。`.sys-tabs` 已按此实现，宽度跟随内容。
- 滚动条：设置内容使用 4px 自绘 thumb，固定在设置窗最右缘（不是内容列右缘），随内容高度比例伸缩，可拖动；默认 20% 墨色，悬停 30%。业务表格仍用 4px 原生细滚动条。
- 空状态：虚线纸面，不用插画堆叠。

## 7. 设置工作区

系统管理不再占用主内容区，而是覆盖式设置窗：

- 960 × min(840, 100vh − 48)，20px 圆角，纸纹；770px 高的窗口自然得到 722px（✅ 960/208 见 SettingsModalShell chunk；722/670 为 DOM 实测，见 §2）。
- 208px 导航；36px 行高，32px 搜索；内容 670px（⚠ 实测）。
- 主题卡 218 × 72；分段控件 32px；纹理强度为 5 档步进条；开关 36 × 20。
- 应用图标卡 4 列：透明底、68px 预览、14px 圆角；选中项 11% 墨底，名称转 accent；页签 favicon 同步更新。
- 标题字体卡 3 列：至少 72px 高，上部是字体预览，下部是名称与用途；选中项 accent 边框 + 内描边。
- 内容区独立滚动；页面标题直接作为设置页标题，不再重复系统导航。
- 移动端（≤760px）设置导航变为左侧抽屉：宽 310px、6px 内缩、16px 圆角、纸纹、0.28s 滑入；页面顶部保留 50px 当前页触发条，遮罩点击/Esc 关闭。搜索框在抽屉内保持相对定位，图标不会漂移。

## 8. 交互与可访问性

- 动效三档：0.1s 状态、0.15s 控件、0.25s 面板；支持系统 reduced-motion，也支持“减少动效”偏好。
- 纸张 morph：设置窗从触发按钮中心展开；按目标/起点矩形计算 translate 与 scale，480ms 弹性曲线，遮罩 100ms，内容延迟 80ms；退出 120ms 缩回。同一套 helper 通过全局点击/挂载桥接所有 `.modal-backdrop .dialog`，业务弹窗也从触发按钮展开。移动端、reduced-motion 和无触发来源时降级为淡入。
- 焦点环：独立控件 2px accent、偏移 1px；表格行/整行列表项使用 1px 内缩 accent ring（`outline-offset:-1px`），不再用整行高饱和底色或上下两条阴影代替焦点。hover 才使用 4% 墨色底，selected 使用 7% accent 底。设置打开时焦点落在当前导航项，不自动聚焦搜索框。
- 全局成本助手：标题栏快捷操作旁的 Sparkles 按钮打开，宽度 `min(1280px, 100vw - 48px)`、高度 `min(820px, 100vh - 48px)`，三栏 `236px | 1fr | 300px`；左侧会话、中间消息、底部 16px 圆角悬浮 composer、右侧工具/来源卡。≤1120px 右栏变抽屉，≤760px 全屏、左栏变横向会话条。
- 全局命令中心：760px 宽，搜索框 + 全部/页面/项目筛选 + 分组结果；行高 48px、选中态使用 `--state-selected-bg`，键盘 ↑↓/Enter/Esc，移动端全宽。
- 所有弹层使用既有 FocusTrap；Esc 先关闭最上层弹层。
- 主内容、表格、按钮在 1440 与 390 视口均无横向溢出；表格自身横向滚动。
