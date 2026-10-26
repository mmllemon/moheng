# moheng 主内容区审查：与 Hana 的差异清单

日期：2026-10-24

## 实测数据（moheng 现状）

```
app-shell      1600×900    display: flex; flex-direction: row
app-sidebar     240×888    x=6   radius 22.0908  corner superellipse(2)
app-main       1354×900    x=246 flex column
app-content    1348×888    x=246 y=6   radius 22.0908  overflow hidden
app-titlebar   1348×44     y=6   position: absolute  z=50  pointer-events: none
               display: grid  padding: 4px 12px 4px 44px
titlebar-cluster 186×30    x=1396 y=10  bg color(srgb .97 .96 .93 / .72)  radius 9.20448
route-transition 1348×888  overflow: hidden auto

顶栏按钮：
  全局搜索    28×28  border 1px transparent  bgClip border-box  radius 9.20448
  面板菜单    28×28  同上
  待办与预警  28×28  同上
  快捷操作    28×28  同上
  界面设置    28×28  同上
  账号头像    28×28  radius 50%
```

## 五项差异

### 差异一：顶栏缺「左岛 / 右岛」两段结构

**Hana**：

```jsx
<div className={titlebarFrame} data-islands="both">
  <div data-titlebar-slot="left"  data-titlebar-action-island="left">
    {left.map(renderAction)}
    {titleSegment}
  </div>
  <div data-titlebar-slot="right" data-titlebar-action-island="right">
    {right.map(renderAction)}
  </div>
</div>
```

左岛 = 面板按钮 + 标题段，右岛 = 系统按钮。

**moheng**：只有一个 `.titlebar-cluster`（186px），所有按钮挤在一起，没有左右分岛。

**影响**：面板按钮和系统按钮没有分组，顺序靠 DOM 排列，没有 `order` 机制。

### 差异二：面板按钮是「一个菜单」而不是「两个开关 + 一个菜单」

**Hana**：三个独立开关（preview / workspace / browser）+ 一个菜单按钮。

```js
preview:   order 10
workspace: order 20
browser:   order 25
panel-menu: order 30
```

**moheng**：只有一个「面板菜单」按钮（28×28），点开是下拉菜单（预览 / 工作区两项）。

**影响**：用户要开工作区，必须先点菜单再选，两步。Hana 是一步（直接点 workspace 开关）。

### 差异三：按钮尺寸的「透明边框」机制

**Hana**：

```css
width:  calc(24px + 2px * 2);      /* 28 */
height: calc(24px + 2px * 2);      /* 28 */
border: 3px solid transparent;
background-clip: padding-box;      /* 悬停背景只填内部 22×22 */
```

**moheng**：

```css
width: 28px; height: 28px;
border: 1px solid transparent;
background-clip: border-box;       /* 悬停背景填满 28×28 */
```

**视觉差异**：Hana 悬停时高亮区是 22×22（四周留 3px），moheng 是 28×28（填满）。所以 Hana 的按钮看起来更「疏」，间距感更大。

### 差异四：按下态的实现

**Hana**：

```css
[data-chrome-button-action-id^="chalkboard.chat.panel-"][aria-pressed=true],
[data-chrome-button-action-id^="chalkboard.chat.panel-"][aria-pressed=true]:hover {
  color: var(--accent);
}
```

只有**文字/图标变 accent 色**，没有背景。

**moheng**：需查（当前用 `aria-pressed` 但样式未确认）。

### 差异五：图标尺寸与来源

| 图标 | Hana | moheng |
|---|---|---|
| preview | Lucide `file-text`，15px | ？ |
| workspace | 自定义 SVG，15×15，strokeWidth 1.889，g transform | ？ |
| 菜单 | Lucide `layers`，16px | ？ |

moheng 的按钮图标目前是 lucide 默认（可能 14px 或 16px），需要逐个改。

## 一项结构差异（非缺陷，需说明）

**Hana 的主内容区是 `tileShell` 卡片，moheng 是 `.app-content`**。

```
Hana:  _root → windowTitlebarFrame(display:contents) → [sidebar | canvas → tileShell → tileTop + tileContent | previewPanel]
moheng: app-shell(flex row) → [app-sidebar | app-main(flex column) → app-content + app-titlebar | workspace-panel]
```

**层级等价**：

| Hana | moheng | 是否一致 |
|---|---|---|
| `_root` flex row 100dvh | `.app-shell` flex row | ✓ |
| `_canvas` flex:1 padding 3px | `.app-main` flex column | 近似 |
| `_tileShell` width calc(100% - 6px) margin 3px | `.app-content` margin 6px 6px 6px 0 | ✓ 间隙一致 |
| `_tileTop` absolute top 0 z-5 h=44 | `.app-titlebar` absolute z-50 h=44 | ✓ 高度一致，z 不同 |
| `_tileContent` 正常流 | `.route-transition` | ✓ |
| `_previewPanel` flex-shrink:0 580px | `.workspace-panel` flex-shrink:0 | ✓ |

**z-index 差异**：Hana 是 5，moheng 是 50。这个差异是因为 moheng 有更多浮层（设置窗 8000、抽屉 31），50 是给顶栏留的位置。**不影响视觉，保留。**

## 实施顺序

1. **顶栏改两岛结构**（左岛放面板按钮，右岛放系统按钮）
2. **面板按钮拆成两个独立开关 + 菜单**
3. **按钮尺寸改 `border: 3px transparent` + `background-clip: padding-box`**
4. **图标按真值替换**
5. **三张卡的 tab 样式对齐**（`padding 4.8px 8.8px`、`fs 11.2px`、激活态用 `bg-card + border + shadow`）
6. **预览卡加多文件标签栏**

## 需要确认的一点

**moheng 的顶栏现在有 5 个系统按钮**（全局搜索 / 待办与预警 / 快捷操作 / 界面设置 / 账号头像），这些都是 moheng 自有功能，Hana 没有对应物。

按「重叠部分按 hana，moheng 独有暂不改造」的原则：

- **左岛**：面板开关（preview / workspace）+ 菜单 → 按 Hana 做
- **右岛**：moheng 的 5 个系统按钮 → 保持现状，只调整容器结构

这样可以吗？还是希望右岛也按 Hana 的「收藏 / 截图 / 最小化 / 关闭」来？
