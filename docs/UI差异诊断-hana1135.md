# 墨衡 vs Hana 1.1.35 前端 UI 差异诊断

> 基准：`reference/hana-1.1.35/`（与运行中 Hana 逐字节一致的 renderer 可读层）
> 对象：`apps/web/src`（36 页面 / 17 组件 / 五棵样式树）
> 日期：2026-10-21。只做静态对照，未开浏览器实测。

## 总评

**颜色、尺寸、间距、字号、动效曲线——基本抄到位了。** token 名字几乎逐一对应，
纸纹三层遮罩、squircle 系数 1.8408964152537137、`--titlebar-h: 44px`、240px 侧栏 6px 内缩、
三档动效时长，全部实证吻合。

**差的是三样：形态的密度、阴影的分层、字体的质感。** 这三样恰好是"看起来像 Hana"与
"感觉是 Hana"之间的差别，也是最难靠读 CSS 抄对的部分。

---

## 一、最显著的差距：squircle 覆盖密度（62 vs 1654）

| | Hana 1.1.35 | 墨衡 |
| --- | --- | --- |
| `corner-shape` 声明总数 | **1654** | **62** |
| 单文件最高 | CardShell 210、ChatTranscript 199、SettingsModalShell 89 | hana.css 62 全在这一个文件 |

Hana 的每个圆角几乎都成对出现 `border-radius: calc(Npx * var(--corner-radius-scale))` + `corner-shape: squircle`。
墨衡抄了系数和 @supports 检测，但只在少数规则上落了 `corner-shape`。

**影响**：在支持 `corner-shape` 的浏览器（Chrome 139+ / Edge）里，Hana 的卡片、输入框、按钮是
"超椭圆"曲线——四角过渡比普通圆角更平缓，这是它看起来"纸片感"的核心几何来源。墨衡只有 62 处
有这层，其余全是普通 `border-radius`。**这是当前视觉差异里权重最高的一项**，且不需要改任何设计决策，
纯机械补齐即可。

**做法**：以 hana.css 内所有 `border-radius` 声明为清单，凡使用 `--radius-control/-action/-compact/-card`
或 `calc(...*var(--corner-radius-scale))` 的规则，补 `corner-shape: squircle`。
例外：输入框、下拉、搜索壳、分段按钮按文档 §6 应保持 `corner-shape: round`（Hana 自己也是这么分的）。

## 二、阴影体系：墨衡自己发明了一套，Hana 是另一套

| token | Hana 1.1.35 | 墨衡 |
| --- | --- | --- |
| `--shadow-xs` | `0 1px 3px var(--shadow)` | `0 1px 3px rgba(42,38,34,.04)` |
| `--shadow-sm` | `0 1px 4px var(--shadow)` | `0 1px 4px rgba(42,38,34,.05)` |
| `--shadow-md` | `0 2px 8px var(--shadow)` | `0 2px 8px rgba(42,38,34,.07)` |
| `--shadow-lg` | `0 4px 12px var(--shadow)` | `0 4px 16px rgba(42,38,34,.08)` |
| `--shadow-xl` | `0 4px 16px var(--shadow)` | `0 8px 28px rgba(42,38,34,.10)` |
| 语义变体 | `-soft` / `-strong` 各三档、`--shadow-ring` | 无 |
| 阴影色 | 走主题变量 `--shadow`（随主题变） | 硬编码墨色 rgba |

两处结构性差异：
1. **Hana 的阴影色是主题变量**，青夜主题下自动转黑；墨衡写死 `rgba(42,38,34,…)`，深色主题靠第二段
   重复声明覆盖（hana.css 里确实有第二组 `rgba(0,0,0,.22~.38)`），但这是补丁不是体系。
2. **墨衡缺 `-soft`/`-strong` 两档语义和 `--shadow-ring`**。Hana 用 `-soft` 处理"需要极轻投影"的场合
   （行卡、输入框聚焦态），用 `--shadow-ring` 做 focus 外环。墨衡 focus 走 `--state-focus-ring` 的
   box-shadow 自绘，结果接近但不等价。

**影响**：卡片、弹层的浮起层次感比 Hana 重一档。`--shadow-lg` 墨衡用 16px 模糊而 Hana 是 12px，
`--shadow-xl` 差得更多（28px vs 16px）。**建议整组替换为 Hana 值**，并把阴影色改为主题变量。

## 三、字体：这是最容易被忽略、但观感差最大的一项

| | Hana 1.1.35 | 墨衡 |
| --- | --- | --- |
| 标题字体 | 思源宋体（Source Han Serif）完整字重 | `MH Serif SC` + Noto Serif SC 369KB 子集 |
| 正文字体 | 系统 UI 栈 | 系统 UI 栈 ✅ 一致 |
| 等宽 | JetBrains Mono | JetBrains Mono ✅ 一致 |
| 字体资产 | `new-warm-paper-fonts.css` 513KB（含完整字重与西文衬线） | 4 个文件共 391KB，`mashanzheng-subset.woff2` 仅 2KB |

Hana 的 `new-warm-paper-fonts.css` 是 513KB 的字体总装（EB Garamond 斜体、思源宋体多字重等），
墨衡用的是 369KB 的 notoserifsc 子集 + 18KB spectral。**实际渲染上，中文标题的笔画粗细层次会少一档**。

**影响**：页面标题（`--font-heading` 27px 宋体）是墨衡最显眼的品牌面，字重层次不足会让它看起来
"轻飘"。这不是配色问题，是字形问题。

**做法**：从参考包 `themes/new-warm-paper-fonts.css` 里提取 Hana 实际使用的字重与西文衬线，
补进 `public/fonts/`。注意授权：字体本身各有 OFL/商用条款，需逐个确认（EB Garamond 是 OFL，思源宋体是 OFL）。

## 四、纸纹：装配对了，但缺一层"预览纹理"

墨衡：`rice`/`cotton`/`fine` 三套，各由 mottle/fiber/grain 三层遮罩组成 ✅ 与 Hana 一致。
`--paper-texture-peak: 0.09` ✅、tile 尺寸 ✅。

**缺的是 Hana 1.1.35 新增的"预览纸质纹理"独立维度**：Hana 把界面纸感和预览区（Markdown/代码阅读）
纸纹拆成两套独立设置（`previewPaperTextureStyle` / `previewPaperTextureStrength`）。
墨衡目前只有一套。文档 §3 没提这条，属于漏记的 1.1.35 新功能。

## 五、设置工作区：结构对了，缺两个 1.1.35 新增项

对照 `SettingsModalShell` 与墨衡 `SystemManagementPage` / `AppearanceSettingsPage`：

| 项 | Hana 1.1.35 | 墨衡 |
| --- | --- | --- |
| 960 窗 + 208 导航 + 670 内容 | ✅ | ✅ |
| 主题卡 218×72 | ✅ | ✅ |
| 字体对比度五档 | ✅ `content-contrast.css` 四档覆盖 + 默认 13 | ❌ **缺** |
| 应用图标 4 列 | ✅ | ✅ |
| 标题字体 3 列 | ✅ | ✅ |
| 预览纸纹独立设置 | ✅ | ❌ 缺 |
| 一天的结束时间 | ✅ | 不适用（业务系统无此概念） |

**字体对比度是值得补的一项**：它不依赖聊天场景，是通用的阅读舒适度开关，实现成本低
（`data-content-contrast` 属性 + 四档 CSS 覆盖），对墨衡这种数据密集界面反而更有价值。

## 六、Hana 有而墨衡不需要的部分（不算差距）

窗口控制键（系统窗控 / 红黄绿）、Electron preload 与 IPC、聊天流（ChatTranscript 199 处 squircle）、
卡片运行时（CardShell）、多智能体切换、快捷聊天窗、引导流程。这些是 Electron 桌面壳与聊天产品形态的产物，
墨衡是 Web 业务系统，不抄是对的。

## 七、优先级建议

| 优先级 | 项目 | 成本 | 收益 |
| --- | --- | --- | --- |
| P0 | squircle 覆盖从 62 补到接近全量 | 机械批量，半天 | **最高**，直接改变"纸片感" |
| P0 | 阴影组替换为 Hana 值 + 主题化阴影色 | 小 | 高，浮起层次立刻对 |
| P1 | 标题字体补字重层次 | 中（需确认授权） | 高，品牌面观感 |
| P1 | 补字体对比度五档 | 小（照抄 content-contrast.css 结构） | 中，可读性 |
| P2 | 预览纸纹独立维度 | 小 | 低（业务系统预览场景少） |
| P2 | 退役 legacy/v6 旧层 | 大（见退役审计） | 中，长期可维护性 |
