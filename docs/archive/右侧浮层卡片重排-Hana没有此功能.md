# 右侧浮层卡片重排：Hana 没有这个功能

日期：2026-10-24

## 结论

**Hana 的右侧浮层没有「卡片拖拽重排」。**

我按你说的去找，挖到了 chalkboard 卡片系统的完整重排实现，但那套机制服务的是**画布上的卡片**（可以拖出成独立窗口、跨容器迁移的那种），不是右侧浮层里的两张卡。

右侧浮层里的第二张卡（`_jianDrawer`）在 Hana 里是一个**抽屉**，只有开/合两态，固定在底部，不可拖动、不可换位。

## 挖到的证据

### 1. Hana 确实有卡片重排机制

`CardShell-DVSoA_HL.js` 里：

```js
dispatchChalkboardLayoutCommand({
  kind: "reorderContainerChild",
  reason: "drop-reorder",
  nodeId: r.nodeId,
  childNodeId: r.childNodeId,
  toIndex: r.toIndex,
})
```

配套两个纯函数：

```js
// mfe：由指针位置算目标下标
function mfe(node, selfIndex, along, cross) {
  const pos = node.horizontal ? along : cross;
  let target = node.slots.length;
  for (let i = 0; i < node.slots.length; i += 1) {
    const slot = node.slots[i];
    if (pos < slot.start + slot.size / 2) { target = i; break; }
  }
  return target === selfIndex || target === selfIndex + 1
    ? null
    : target > selfIndex ? target - 1 : target;
}

// vfe：纯函数重排
function vfe(arr, from, to) {
  const next = [...arr];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}
```

容器协议：

```
[data-layout-panel-node-id]   容器节点
[data-layout-panel-child-id]  子节点
[data-layout-orientation]     row / column
```

### 2. 但这套机制不作用于右侧浮层

右侧浮层的真实结构：

```jsx
h.jsxs("div", {
  className: `${ir.previewPanel}${d ? "" : ` ${ir.previewPanelCollapsed}`}`,
  id: "previewPanel",
  "data-preview-open": d ? "true" : "false",
  children: [
    h.jsx($i, {}),      // = Hd，纸纹层（data-paper-texture-layer）
    h.jsx(xae, {}),     // = Xv，资源刷新副作用，无视觉
    h.jsx("div", { className: "resize-handle resize-handle-left" }),
    Vt,                 // 实际内容
  ],
})
```

**没有 `data-layout-panel-node-id`，没有 layout 容器。**

`$i` 是纸纹层，`xae` 是无视觉的副作用组件。所以「两张卡片」不是 previewPanel 的直接子节点，而是 `Vt` 内部的结构。

### 3. 第二张卡是抽屉，不是可移动卡片

```jsx
h.jsxs("section", {
  className: wn.jianDrawer,
  "data-jian-drawer": "",
  "data-open": n2 ? "true" : "false",
  role: "region",
  "aria-label": r,
  children: [
    h.jsx("div", { className: wn.jianHeader,
      children: h.jsx("span", { className: wn.jianTitle, children: r }) }),
    h.jsx("div", { className: wn.jianBody,
      children: h.jsx(HJe, { showHeader: false }) }),
  ],
})
```

```jsx
// 唯一的状态：open 布尔值，由按钮切换
function UJe() {
  const open = O((s) => s.jianDrawerOpen);
  const setOpen = O((s) => s.setJianDrawerOpen);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  return h.jsx("button", {
    className: wn.jianToggle,
    "data-jian-toggle": "",
    "aria-expanded": open,
    onClick: toggle,
    children: h.jsx(VJe, { open }),
  });
}
```

```css
._jianDrawer_57159 {
  position: absolute;
  left: 6px; right: 6px; bottom: 6px;
  height: 320px;                              /* data-open */
}
._jianDrawer[data-open="false"] { height: 40px; }
```

**固定在底部，`bottom: 6px` 写死，只有高度在 40 / 320 之间切换。**

### 4. CSS 里也没有任何重排视觉

在 `CardShell-B3PSoerL.css` 里搜：

```
dropIndicator   0 条
dragGhost       0 条
dragClone       0 条
cardLift        0 条
reorderSlot     0 条
slotPlaceholder 0 条
```

拖拽重排的视觉全在画布层（chalkboard），右侧浮层里没有。

## 我做错了什么

**你上一轮说「可拖动重排的卡片」，我把 `$et`（工作室挂载点列表）的重排当成了答案。** 那确实是完整实现，但它是**工作室内部的挂载点列表**，不是右侧浮层里的两张卡。

然后我又把重排接到了侧栏项目列表（更错，你说不要），再改成接右侧两张卡。

**三次都是同一个问题：先找到「Hana 有一个重排机制」，就假设它作用在你说的那个地方。**

正确做法应该是：先确认「右侧浮层的 DOM 里有没有 layout 容器」，再决定要不要实现。

## 已回滚的东西

全部撤掉了，没留半截代码：

| 项 | 状态 |
|---|---|
| `apps/web/src/lib/use-project-reorder.ts` | 已删 |
| `apps/web/src/lib/use-card-reorder.ts` | 已删 |
| `ProjectList.tsx` 的拖拽属性 | 已撤 |
| `WorkspacePanel.tsx` 的卡片容器 | 已撤 |
| `projects.ts` 的 `/reorder` 接口 | 已撤 |
| `schema.prisma` 的 `sortOrder` 字段 | 已撤 |
| 迁移 `20261024123409_add_project_sort_order` | 目录已删，数据库列已 DROP |

验证：

```
UI 规范检查   75/75
视觉回归      26 路由 0 failure
TypeScript    前后端通过
```

## 如果要做，两个选择

**A. 按 Hana 的卡片系统做（大工程）**

需要先有 chalkboard 那套：`chalkboardLayoutDocument`（布局文档）、`data-layout-panel-node-id` 容器协议、`dispatchChalkboardLayoutCommand` 命令总线、独立窗口（`detachCard`）。

右侧浮层只是它的一个宿主。这套东西 moheng 完全没有，做一个「只有重排」的子集也要先建布局文档模型。

**B. 只做「预览卡可拖动调高」**

Hana 的 `resize-handle` 是死代码（只有 hover 视觉，没有 JS 绑定）。但**它存在本身说明设计意图**。

moheng 可以把这个做成真的：预览卡顶部加一个 8px 热区，拖动改 `height`，范围 40px ~ 面板高度的 70%。这不需要布局文档，只改一个 CSS 变量。

**这个是有意义的**，因为预览卡固定在 320px 时，PDF 只能显示半页。

要选哪个，还是这一项就跳过？

## 本轮另外完成的两件事

这一轮前半段做完的 A / B / C 三项仍然有效：

**A（拖动宽度）**：侧栏宽度可拖动，240 → 340，主内容跟着让位，刷新后保持。这个对齐 Hana 的 `--fpResizeHandle` + `--bridge-panel-left`，是真实存在的功能。

**B（文件图标与操作）**：文件类型图标逐字取自 Hana 的 `Os` 图标表（Lucide 原始 node 数据），11 种类型；行操作按钮预览 / 下载 / 删除。

**C（两套数据源）**：「对话文件」标签显示项目产物（变更单外部凭证附件，新建 `/artifacts` API），「工作室」标签显示项目目录树。实测：

```
对话文件  产物 2 条（image / pdf），来源显示变更单编号
工作室    目录树 7 个文件
```

这才是我理解你说的「对话文件做什么、工作室做什么」之后应该做的。
