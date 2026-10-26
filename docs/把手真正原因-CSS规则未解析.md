# 把手的真正原因：CSS 规则被裸文字打断

日期：2026-10-25

前三次都没修对，因为一直在改 JS 逻辑。真正的原因在 CSS。

## 症状

拖动本身是正常的（事件全到、`ratio` 更新、两张卡高度变化），但**看不到把手线**。所以看起来像「拖不到」「把手没了」。

## 根因

`workspace-panel.css` 里有两行裸文字：

```css
/* ── 卡片高度调节把手：逐字对齐 hana 的 ._separator_704ed ── */
.workspace-card-split-row { … }
   height: var(--separator-grab-box, 6px); margin-block: -3px; cursor: row-resize;
   :after 是 44×3px 的 accent 条，默认 scaleX(.12) + opacity 0，悬停时 scaleX(1) + opacity .35。 */
.card-split-handle { … }
```

那两行本该在 `/* … */` 注释里，但**注释开头的 `/*` 丢了**。CSS 解析器读到 `height: var(--…); margin-block: -3px;` 之后遇到 `:after 是 44×3px…` 这种非法内容，**丢弃整个块**，紧接着的 `.card-split-handle { }` 一起被吞。

结果：

```
handle.cssPosition   = "static"      ← 应该是 relative
handle.cssMarginBlock = "0px"        ← 应该是 -3px
handle.cssAlignSelf  = "auto"        ← 应该是 stretch
::after.top          = "450px"       ← 百分比参照 .workspace-panel（900px）的 50%
::before.height      = "912px"       ← 本该 18px
```

`::after` 被定位到 `y=450`（面板正中间），而把手在 `y=524`。**红线画在了完全无关的位置**，所以屏幕上就是「把手没了」。

## 验证方式

关键证据是 `getComputedStyle` 里的三个值：

```
cssPosition: "static"      ← 整条规则没生效
cssMarginBlock: "0px"
cssAlignSelf: "auto"
```

如果是被别的规则覆盖，`position` 不会退回 `static`（那是初始值）。**退回初始值 = 规则未被解析。**

## 修法

删掉裸文字，把说明并进合法注释：

```css
/* ── 卡片高度调节把手：逐字对齐 hana 的 ._separator_704ed ──
   height 6px（grid 行真实占位）；margin-block: -3px 把热区从布局上吃掉；
   :after 是 44×3px 的 accent 条，默认 scaleX(.12) + opacity 0，悬停时 scaleX(1) + opacity .35。 */
.card-split-handle {
  position: relative;
  …
}
```

修后：

```
cssPosition  : "relative"
cssMarginBlock: "-3px"
cssAlignSelf : "stretch"
::after      : top 3px, 44×3px, opacity 0.35, bg rgb(70,107,128)
::before     : 387×18px（±6px 热区）
```

截图确认：两张卡交界处有居中的 44×3px 圆头短条。

## 加了一条门禁

`validate-ui-polish.mjs` 新增检查（76 项）：

```js
check('css has no bare text outside rules (lost comment opener)', (() => {
  const stripped = cssPanel.replace(/\/\*[\s\S]*?\*\//g, '');   // 先剥掉成对注释
  return !/[}\n]\s*\n[ \t]+[\u4e00-\u9fa5]/.test(stripped)
      && !/[}\n]\s*\n[ \t]+[a-z-]+:[^;{}]*;[^\n]*[\u4e00-\u9fa5]/.test(stripped);
})());
```

覆盖「`}` 之后出现行首中文」和「行首属性 + 行尾中文」两种裸文字形态。

## 三次错在哪

| 次数 | 我改的 | 为什么没解决 |
|---|---|---|
| 第 1 次 | `setPointerCapture` | 事件本来就到，问题不在事件 |
| 第 2 次 | `data-revealed` 700ms | 只改松手后的可见性，规则本身没解析，改属性没用 |
| 第 3 次 | 命中区扩到 18px + pointerId | 同上，规则没生效 |

**三次都在 JS 侧找原因，没验证「CSS 是否真的应用了」。**

`getComputedStyle` 返回初始值（`static` / `0px` / `auto`）就是「规则未解析」的确定信号，应该在第一次就查这个，而不是继续加 JS 逻辑。

```
UI 规范检查   76/76（新增 1 条）
视觉回归      26 路由 0 failure
TypeScript    前后端通过
```
