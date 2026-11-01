# 弹窗按 hana token 精修

日期：2026-10-26

## 背景

`ProgressBillsPage` 的审批功能完整（`DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED / REJECTED`），但 UI 是 `modal-backdrop + dialog` 弹窗。决定保持弹窗形态，只按 hana 的 token 精修视觉。

## 一个被推翻的推荐

上一轮我推荐「审批动作卡」，理由是 hana 有 `_cronConfirmCard` 家族（18 个类、28 条 CSS 规则）。

实测证明这是**死代码**：

```
CSS   28 条规则
JS    32 处，全部是 `cronConfirmCard: Yte` 这种类名映射赋值
渲染  0 处
```

hana 自己从未渲染过这个组件。我看 CSS 有 18 个类就当成「有可复刻的组件」，没验证 JS 里是否使用。

## hana 弹窗的真值

四组同类组件，规格高度一致：

```css
/* 通用 dialog（CapabilitiesPanel） */
._dialog_4aa1f {
  width: 420px;
  background-color: var(--bg-card);
  border-radius: calc(var(--radius-lg) * var(--corner-radius-scale, 1));   /* 22.09px */
  corner-shape: squircle;
  box-shadow: var(--shadow-2xl);
  overflow: hidden;
}

/* 确认弹窗（SettingsModalShell） */
._confirmDialog_da969 {
  width: 320px; padding: var(--space-16);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-card) * var(--corner-radius-scale, 1)); /* 14.73px */
  corner-shape: squircle;
  box-shadow: var(--shadow-lg);
}

/* 大弹窗（App） */
._modal_35680 {
  background: color-mix(in srgb, var(--bg) 94%, white 6%);
  border: 1px solid var(--overlay-light);
  border-radius: calc(var(--radius-lg) * var(--corner-radius-scale, 1));
  box-shadow: 0 16px 48px var(--shadow);
}

/* 侧边 sheet（ChatTranscript） */
._sheet_b064f {
  background: var(--bg-card);
  border: 1px solid var(--overlay-light);
  border-radius: calc(var(--radius-lg) * var(--corner-radius-scale, 1));
  box-shadow: 0 8px 32px rgba(0, 0, 0, .18);
}
```

共同点：`--bg-card` 底色、`calc(radius × 1.84)` 圆角、squircle、`--shadow-2xl/lg` 阴影。

## moheng 修前

`hana.css` 已用 `!important` 覆盖了 legacy/v6 的 `2px` 圆角，但值不对：

```css
border-radius: 20px !important;      /* 硬编码，不是 22.09 */
background: var(--bg) !important;    /* 不是 --bg-card */
border: 1px solid var(--overlay-medium);
```

纸纹层的 `oklch(from var(--bg) ...)` 也跟着用了 `--bg`。

## 修正

```css
.dialog, .ldg-drawer {
  border: 1px solid var(--border) !important;
  border-radius: calc(var(--radius-lg) * var(--corner-radius-scale, 1)) !important;
  corner-shape: squircle;
  background: var(--bg-card) !important;
  box-shadow: var(--shadow-2xl) !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
}

/* 纸纹层底色参照同步改为 --bg-card */
html[data-paper-texture] .dialog::before {
  background: oklch(from var(--bg-card) calc(l + var(--paper-texture-peak) * ...) c h);
}
```

标题与按钮区：

```css
.dialog-header h2, .dialog-title {
  font-size: var(--fs-title, 16px) !important;
  font-weight: 600 !important;
  line-height: 1.35;
  color: var(--text) !important;
}
.dialog-footer { gap: var(--space-8, 8px) !important; background: transparent !important; }
```

## 一处与 hana 的有意偏离

hana 的 `_dialog_4aa1f` 是 `overflow: hidden`，因为它的弹窗有 `_dialogBody` 中间层负责滚动。

moheng 的弹窗结构是 `dialog > header + form（含 fields + footer）`，**没有中间层**（实测全仓 0 个 `.dialog-body`）。所以滚动必须留在 dialog 自己身上：

```css
overflow-x: hidden !important;
overflow-y: auto !important;
```

只关横向，避免长表单被截断。

## 实测

弹窗外框：

```
radius     22.0908px
bg         rgb(252,250,245) = --bg-card
border     1px solid rgba(122,96,88,0.18)
squircle   superellipse(2)
shadow     rgba(45,43,40,0.07) 0 26px 70px
title      16px / 600 / --text
paper      ::before 存在
```

弹窗内控件（全部在 hana token 体系内）：

```
输入框      32px 高  radius 11.0454px（--radius-input × 1.84）
textarea    11.0454px
主按钮      32px  9.20448px（--radius-action × 1.84）  accent 底 白字
次按钮      32px  9.20448px  overlay 3%
关闭按钮    32×32  9.20448px
label       11.2px
```

## 覆盖 5 个页面的弹窗

`ProgressBillsPage`、`ChangesPage`、`ContractsPage` 等 5 个页面用的都是同一套 `.dialog` 类，所以这次改动一次覆盖全部。

```
UI 规范检查   76/76
视觉回归      26 路由 0 failure
```
