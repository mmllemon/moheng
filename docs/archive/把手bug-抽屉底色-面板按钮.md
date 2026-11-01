# 三处修正：把手 bug / 抽屉底色 / 面板按钮

日期：2026-10-25

## 一、高度把手：只能拖一次，之后悬停不显

### 根因

原来用 `window.addEventListener('pointermove' | 'pointerup')`：

```js
window.addEventListener('pointermove', move);
window.addEventListener('pointerup', up);
window.addEventListener('pointercancel', up);
```

拖动时 grid 的 `gridTemplateRows` 每帧重算，handle 所在的 grid 行位置在动。松手位置一旦落在 handle 之外（很常见，因为 handle 只有 6px），`pointerup` 可能被别的元素吞掉，`dragging` 卡在 `true`。

一旦 `dragging` 为 true：

- `data-dragging` 持续存在
- `body.cursor = 'row-resize'` 不还原
- 后续 hover 的 `:hover` 命中被 `pointer-events`/cursor 干扰

表现就是「只能移动一次，后面鼠标悬停就不显示把手」。

### 修法

改用 `setPointerCapture`：

```js
handle.setPointerCapture(event.pointerId);
handle.addEventListener('pointermove', move);
handle.addEventListener('pointerup', finish);
handle.addEventListener('pointercancel', finish);
```

pointer capture 保证后续事件必定回到 handle 本身，即使指针移出元素范围。`finish` 里 `releasePointerCapture` 并清理监听。

同时去掉 `active` state（原来靠 `onPointerEnter/Leave`），直接用 CSS `:hover` + `:active` —— 原生 hover 不会被 React 状态卡死。

### 实测

```
初始          441 / 441
第1次 +60     498 / 384   移开再悬停 opacity 0.35 scaleX(1) ✓
第2次 -60     441 / 441   移开再悬停 opacity 0.35 scaleX(1) ✓
第3次 +60     498 / 384   移开再悬停 opacity 0.35 scaleX(1) ✓
```

连续三次拖动正常，每次松手后悬停态都能恢复。

## 二、抽屉底色

之前用 `--jian-note-bg`（`#FAF0E2` 暖米色），那是「笺」（笔记）的专属色。

抽屉在 hana 里对应 `_workspaceDrawerLayer_322c5`：

```css
._workspaceDrawerLayer_322c5 { background: var(--panel-card-bg); }
```

**与卡片同色。** 改成：

```css
.workspace-jian-drawer {
  background: var(--panel-card-bg, var(--bg-card));
}
```

实测 `rgb(252, 250, 245)` = `--bg-card`。

顺带修了一个连带问题：删掉 `card-surface-main` 的 `padding-bottom` 后，文件列表被抽屉上沿切掉半个字。按 hana，让位 padding 应该加在**滚动容器自己**身上：

```css
._fileList_52df5, _tree_6bb43 {
  padding-bottom: calc(var(--right-workspace-jian-reserved, 56px) + var(--panel-edge-gap));
  scroll-padding-bottom: same;
}
```

```css
.workspace-tree,
.workspace-artifact-list {
  padding-bottom: calc(40px + var(--panel-edge-gap, 6px) * 2);
  scroll-padding-bottom: calc(40px + var(--panel-edge-gap, 6px) * 2);
}
```

实测滚到底：

```
treePadBottom 52px
lastRowBottom 353
drawerTop     396     最后一行在抽屉上沿之上 43px
```

## 三、顶栏两个面板按钮

### 之前的功能

```jsx
onClick={() => { setWorkspaceTab('files'); setWorkspaceOpen(true); }}
```

**只能开，不能关。** 点第二次没反应（已经开着），而且两个按钮都是「打开面板 + 切 tab」，语义混在一起。

### hana 的真值

```js
{ id: 'chalkboard.chat.panel-preview',   slot: 'titlebar-right', rendererKind: 'chalkboard.chat.panel-toggle', order: 10 }
{ id: 'chalkboard.chat.panel-workspace', slot: 'titlebar-right', rendererKind: 'chalkboard.chat.panel-toggle', order: 20 }
```

`rendererKind` 是 **`panel-toggle`** —— 独立开关，不是「打开并切换」。

```jsx
function Wve({ entry }) {
  const meta = zve(entry.icon ?? 'preview');
  return <dr label={meta.label} icon={meta.icon} pressed={meta.checked}
             disabled={meta.disabled} actionId={entry.id} onClick={meta.onSelect} />;
}
```

`pressed={meta.checked}` + `onSelect` 切换。

### 修法

```jsx
onClick={() => {
  if (workspaceOpen && workspaceTab === 'files') setWorkspaceOpen(false);
  else { setWorkspaceTab('files'); setWorkspaceOpen(true); }
}}
```

该 tab 已开 → 收起；否则打开并切过去。

### 实测

```
初始     aria-pressed=true    panel 1
点一次   aria-pressed=false   panel 0   走收起
再点     aria-pressed=true    panel 1   走打开
```

## 一处 JSX 结构隐患

两个按钮原来的 `>` 被写在属性行外面：

```jsx
aria-pressed={workspaceOpen && workspaceTab === 'files'}
> data-chrome-button-action-id="chalkboard.chat.panel-preview"
data-tooltip="预览"
```

这会让 `data-chrome-button-action-id` 变成文本节点而非属性，门禁靠它定位会失效。已一并修正。

```
UI 规范检查   75/75
视觉回归      26 路由 0 failure
TypeScript    前后端通过
```
