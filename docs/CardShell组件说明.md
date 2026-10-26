# CardShell 组件（Hana 通用卡片壳复刻）

> 首个接入真实页面的 Hana 卡片组件。完成日期：2026-10-23。

## 1. 我之前的两个错误

### 错误一：建了组件但从未使用

上一轮交付 `CardShell.tsx` 时，我声称"建好了"，但事实上：

```
CardShell 被任何页面引用：0 次
```

**写了不等于做完。** 卸载后才验证，属于未完成状态。

### 错误二：用错了基准

第一版注释里写「对照基准：._card_28864」。查证后发现：

```css
._card_28864 {
  width: clamp(280px, 34vw, 420px);     /* ← 固定宽度的浮动卡片 */
  max-height: min(520px, calc(100vh - var(--space-32)));
  box-shadow: 0 4px 32px var(--shadow);  /* ← 有投影 */
}
```

**这是 420px 宽的浮层卡片，不是通用卡片容器。** 拿它当基准会导致：
- 抄了它的 `padding: var(--space-14)`（但通用卡片该用 16px）
- 抄了它的投影（但 Hana 卡片默认无投影）

## 2. 正确的基准

Hana `styles.css` 定义了一组卡片壳变量：

```css
--panel-card-radius: var(--radius-lg);              /* 12px 裸值 */
--panel-card-border: 1px solid rgba(0, 0, 0, 0.08);
--panel-card-bg:     var(--bg-card, var(--bg));
--panel-card-shadow: none;                          /* 默认无投影 */
```

**通用卡片壳**是 `CardShell.css` 里的 `._previewPanelBody_11fea`：

```css
._previewPanelBody_11fea {
  position: relative;
  border-radius: calc(var(--panel-card-radius) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  background: var(--panel-card-bg);
  border: var(--panel-card-border);
  box-shadow: var(--panel-card-shadow);
}
```

它有两个关键特征，和浮层卡片不同：

| 特征 | `._card_28864`（浮层） | `._previewPanelBody_11fea`（通用） |
| --- | --- | --- |
| 宽度 | `clamp(280px, 34vw, 420px)` 固定 | 自适应 |
| 投影 | `0 4px 32px var(--shadow)` | `none` |
| 变量驱动 | 硬编码值 | `--panel-card-*` 全套 |

## 3. 补全缺失的变量

moheng 原本只迁了 `--panel-card-radius`，缺另外三个：

```diff
  --panel-edge-gap: 6px;
  --panel-card-radius: var(--radius-lg);
+ --panel-card-border: 1px solid rgba(0, 0, 0, 0.08);
+ --panel-card-bg: var(--bg-card, var(--bg));
+ --panel-card-shadow: none;
  --corner-radius-scale: 1;
```

缺了它们，CardShell 只能靠 fallback 值工作，无法与 Hana 完全对齐。

## 4. 接入验证（这次真的接入了）

**`BusinessPartiesPage.tsx`** —— 往来单位台账：

```diff
- <section className="panel data-table-panel">
+ <CardShell density="dense" className="data-table-panel">
    <div className="panel-heading">...</div>
    <div className="table-toolbar">...</div>
    <table className="data-table business-party-table">...</table>
- </section>
+ </CardShell>
```

### 实测渲染值

```
定位方式: CSS Module _shell_
className: _shell_aynqu_30 _dense_aynqu_46 data-table-panel

  padding      : 14px
  radius       : 12.8863px
  border       : 1px solid rgba(0, 0, 0, 0.08)
  background   : rgb(252, 250, 245)
  box-shadow   : none
  corner-shape : superellipse(2)
```

### 圆角推导核对

```
--panel-card-radius = min(12px, 7px) = 7px
7px × 1.8408964152537137 = 12.8863px   ← 与实测一致
```

**为什么是 7px 而不是 Hana 的 12px：**

moheng 主动复刻了 Hana 的 Windows 平台封顶行为：

```css
html[data-platform="win32"]:not([data-windows-card-radius="off"]) {
  --panel-card-radius: min(var(--radius-lg), 7px);
}
```

Hana 在 Web（非 win32）下是 `12px × 1.8409 = 22.09px`，
moheng 模拟 Windows 后是 `7px × 1.8409 = 12.89px`。

**这是既有决策，不是本次改动引入的**（`hana.css:27-35` 有完整记录）。
若要改成 22.09px 与 Hana Web 版一致，需要决定是否保留这个 Windows 模拟。

## 5. 又一次踩同一个坑

CSS 注释里写了 `/* 12px 裸值 */`，嵌套注释破坏了块注释结构，导致 PostCSS 报错：

```
Parser.unknownWord  at CardShell.module.css:12
```

页面直接加载失败。**这是第二次踩**（第一次在 `CardShell.tsx` 的 JSDoc 里）。

教训：**在 `/* */` 块注释内不能出现 `/*`。** 记录值时应写「12px 裸值」而非加注释符号。

## 6. 验证结果

```
TypeScript      通过
UI 规范检查      75/75 passed
视觉回归         26 路由 0 failure
实测渲染         与 Hana 变量组一致（除 win32 封顶这一主动差异）
```

## 7. 当前状态

| 项 | 状态 |
| --- | --- |
| 组件实现 | ✅ 1 个页面已接入（`/parties`） |
| CSS Modules | ✅ |
| 依赖变量 | ✅ 4 个 `--panel-card-*` 全部定义 |
| 实测验证 | ✅ |
| 其余 25 个路由 | ❌ 仍用旧 `.panel` |

## 8. 尚未解决的问题

1. **`density="dense"` 用了 14px 内缩，但 Hana 通用卡片是 16px。**
   查证 `._previewPanelBody_11fea` 没有 padding（内缩由内部元素负责），
   而 `._card_28864` 是 14px。moheng 这边表格卡片需要 padding，
   选了 14px 是从浮层卡片抄来的值，**这个选择可能不对**，需要再确认。

2. **`panel-heading` 等内部类仍是全局类。**
   CardShell 只替换了外壳，标题区还是 `.panel-heading`。
   完全对齐需要一并替换成 SettingsSection 那样的组件化结构。

3. **其余 25 个路由的 `.panel` 未替换。**
