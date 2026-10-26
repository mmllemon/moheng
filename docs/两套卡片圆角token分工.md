# 两套卡片圆角 token 的分工

> 澄清「适配 Windows 圆角」开关的作用范围，以及 `--panel-card-radius` / `--radius-card` 的设计分工。
> 建立日期：2026-10-23。

## 1. 直接回答：开关只影响卡片外壳

**「适配 Windows 圆角」只改一个 token：`--panel-card-radius`。**

```css
html[data-platform="win32"]:not([data-windows-card-radius="off"]) {
  --panel-card-radius: min(var(--radius-lg), 7px);
}
```

**实测影响范围：5 条路由 1611 个带圆角元素，只有 11 个变化。**

```
22.0908px → 12.8863px   (11 处)
    aside.app-sidebar              侧栏（面板级）
    main.app-content               主内容区（面板级）
    section._shell_*._padded_*     CardShell（面板级）
```

### 完全不受影响的部分

| 元素类型 | 圆角值 | 使用的 token |
| --- | --- | --- |
| 按钮 / 导航 | 9.20448px | `--radius-action` |
| 输入框 / 控件 | 11.0454px | `--radius-control` |
| 行内小操作 | 7.36359px | `--radius-compact` |
| 设置卡片 | 14.7272px | `--radius-card` |
| 弹层 | 20.2499px | 独立值 |
| 大卡片 | 29.4543px | 独立值 |
| 圆形元素 | 50% | 固定值 |
| 胶囊 | 999px | 固定值 |
| 边框 | 1px / 2px / 3px / 5px / 8px | 独立值 |

## 2. Hana 的设计：两套 token 并行，各有分工

这不是历史遗留，是刻意的分层。

| Token | 基线值 | 名字含义 | 服务于 | 典型元素 |
| --- | --- | --- | --- | --- |
| `--panel-card-radius` | `var(--radius-lg)` = 12px | **面板**级 | 整块面板外壳 | `tileShell`、`previewPanelBody`、浮动卡片、侧栏 |
| `--radius-card` | 8px | **容器**级 | 容器内的内容物 | `surfaceCard`、`row`、`entry`、`btn` |

**实测用法分布（Hana 全库 34 个 CSS）：**

```
--panel-card-radius  →  30 条规则
  主要分布：ChatTranscript 20、CardShell 4、mobile 2、PlanModeButton 2
  典型选择器：._tileShell_*、._previewPanelBody_*、._card_*、._fp_*、._workspaceCardSurface_*

--radius-card        →  58 条规则
  主要分布：SettingsModalShell 20、CapabilitiesPanel 10、MarketModalShell 8
  典型选择器：._surfaceCard_*、._row_*、._entry_*、._btn_*、._listCard_*
```

### 为什么要有两层

`--panel-card-radius` 是**外壳**，它的圆角要跟整体窗口、浮动层的视觉重量匹配。
`--radius-card` 是**内容物**，它的圆角要小一号，避免"大圆角套大圆角"的臃肿感。

两者差 4px（12 vs 8），乘上 squircle 系数后差约 7.4px（22.09 vs 14.73），
视觉上是明确的层级区分。

## 3. Windows 封顶只作用于面板级

Hana 的 win32 规则：

```css
html[data-platform="win32"]:not([data-windows-card-radius="off"]) {
  --panel-card-radius: min(var(--radius-lg), 7px);   /* 只这一个 */
}
```

**`--radius-card` 完全不受影响。** 所以在 Windows 上：

```
面板级：12px → 7px   （22.09px → 12.89px，缩小 9.2px）
内容级：8px  不变    （14.73px，保持不变）
```

这个设计的合理性：Windows 桌面窗口本身是方角矩形，如果面板圆角太大（22px），
和系统窗框的硬边会冲突。但内部小元素（卡片、行、按钮）不受这个约束。

## 4. moheng 的实现核对

### 组件分工（与 Hana 一致）

| moheng 组件 | token | 实测圆角 | 对应 Hana |
| --- | --- | --- | --- |
| `CardShell` | `--panel-card-radius` | 22.0908px | `._previewPanelBody_11fea` ✅ |
| `.app-sidebar` | `--panel-card-radius` | 22.0908px | `._tileShell_*` ✅ |
| `.app-content` | `--panel-card-radius` | 22.0908px | 面板级 ✅ |
| `SettingsSection.Card` | `--radius-card` | 14.7272px | `._surfaceCard_86326` ✅ |
| `.settings-card`（旧） | `--radius-card` | 14.7272px | 内容级 ✅ |

### 全库 token 用法统计

```
--panel-card-radius  →  2 处（hana.css:525、1004）
                        都在面板级外壳上，用法正确

--radius-card        →  51 处
                        都在内容级元素上
```

**没有混用。** 我上一轮担心"设置页会出现两种卡片圆角"是多虑了——
`SettingsSection.Card` 和旧的 `.settings-card` 用的都是 `--radius-card`，渲染值完全相同（14.7272px）。

## 5. 验证结果

```
=== token 定义（Web 观感，开关关闭）===
  --panel-card-radius      12px
  --radius-card            8px
  --radius-lg              12px
  --corner-radius-scale    1.8408964152537137

=== 预期渲染值 ===
  面板级 (12px) = 22.0908px
  内容级 (8px)  = 14.7272px

=== 实际渲染 ===
  [面板级] CardShell              22.0908px
  [面板级] .app-sidebar           22.0908px
  [面板级] .app-content           22.0908px
  [内容级] SettingsSection.Card   14.7272px

=== 判定 ===
  ✓ CardShell 走面板级
  ✓ .app-sidebar 走面板级
  ✓ .app-content 走面板级
  ✓ SettingsSection.Card 走内容级
```

## 6. 一句话总结

**开关只管"面板级外壳"那 11 个元素，从 22.09px 缩到 12.89px。按钮、输入框、行内控件、设置卡片一律不动。**

这个窄范围是 Hana 的设计，不是实现缺陷。
