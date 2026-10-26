# Hana 深度拆解：七项细节

> 本文是 [Hana桌面端界面结构拆解](Hana桌面端界面结构拆解.md) 与 [Hana侧栏动画与全页联动](Hana侧栏动画与全页联动.md) 的第三篇，
> 补齐前两篇标记为「待挖」的七项。
> 所有结论来自源码实测。日期：2026-10-23

---

## 一、TitlebarRenderer：卡片标题层的三段布局

### 1.1 结构

```html
<header class="_tileTop_931a2" data-tile-top>          ← absolute, h=44px, 透明
  <div data-titlebar-long-press-zone />                ← 长按区（拖拽触发）

  <TitlebarRenderer left={...} right={...} titleSegment={...}>
    <div class="_titlebarFrame_29cb1">                 ← grid 容器
      <div class="_titlebarActionIsland_d8891"
           data-titlebar-action-island="left">         ← 左操作岛
        {leftActions}
      </div>
      <div class="_tileTopTitleSegment_612c0">         ← 标题段
        {titleSegment}
      </div>
      <div class="_titlebarActionIsland_d8891"
           data-titlebar-action-island="right">        ← 右操作岛
        {rightActions}
      </div>
    </div>
  </TitlebarRenderer>

  <div class="_grabber_3ca30">                         ← 拖拽把手
    {isTabsGroup && <Tabs />}
  </div>
</header>
```

### 1.2 网格布局（关键）

```css
._titlebarFrame_29cb1 {
  position: absolute;
  top: 0; left: 0; right: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);   /* ← 默认：左自动 + 右撑满 */
  align-items: start;
  column-gap: var(--space-4);
  height: calc(var(--card-top-inset, 6px) * 2 + var(--card-top-btn-size, 24px));
  padding: calc(var(--card-top-inset, 6px) - var(--card-top-btn-pad, 2px))
           max(calc(var(--card-top-inset, 6px) - var(--card-top-btn-pad, 2px)), var(--ttb-clearance-right, 0px))
           0
           max(calc(var(--card-top-inset, 6px) - var(--card-top-btn-pad, 2px)), var(--ttb-clearance, 0px));
  box-sizing: border-box;
  pointer-events: none;
}
```

**默认是两列 `auto minmax(0, 1fr)`，但实际有五种变体：**

| 变体 | 触发条件 | 列定义 |
|---|---|---|
| 默认 | — | `auto minmax(0, 1fr)` |
| 只有右侧岛 | `[data-islands=right]` | `minmax(0, 1fr)` |
| 有标题（非半透明） | `[data-has-title]:not([data-titlebar-mode=translucent])` | `minmax(0, 1fr) auto` |
| 首页聊天卡带自定义标题段 | `[data-tile-id=wb-home-chat-tile][data-has-custom-title-segment]` | `minmax(0, 1fr) auto` |
| 标题轨道拉伸 | `[data-titlebar-track=stretch]` | `minmax(0, 1fr) auto` |

**为什么变体这么多**：`auto` 列宽由内容决定，`minmax(0, 1fr)` 是可压缩的弹性列。当标题需要占满（`data-has-title`）时，标题列变成弹性列，操作岛变成 `auto` 贴边。

### 1.3 操作岛（titlebarActionIsland）

```css
._titlebarActionIsland_d8891 {
  --titlebar-action-veil: var(--chalkboard-titlebar-action-veil);
  --titlebar-action-bg: var(--chalkboard-titlebar-action-veil-bg);
  --titlebar-action-border: var(--chalkboard-titlebar-action-border);
  --titlebar-action-shadow: var(--chalkboard-titlebar-action-shadow);
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  gap: var(--chalkboard-titlebar-action-gap, 0px);
  min-width: 0;
  pointer-events: none;         /* 容器不拦截 */
  transition: color var(--duration-fast) var(--ease-out),
              opacity var(--duration-slow) var(--ease-standard);
}

/* 左/右对齐 */
._titlebarActionIsland_d8891[data-titlebar-action-island=left]  { justify-self: start; }
._titlebarActionIsland_d8891[data-titlebar-action-island=right] { justify-self: end; }

/* 岛内的按钮才接收指针 */
._titlebarActionIsland_d8891 > [data-chrome-action-id] {
  -webkit-app-region: no-drag;
  pointer-events: auto;
  transition: opacity var(--duration-slow) var(--ease-standard);
}
```

**操作岛的背景是 `:before` 伪元素，默认 `opacity: 0`：**

```css
._titlebarActionIsland_d8891:before {
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out),
              background-color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
```

只在半透明标题模式下显形：

```css
._tileShell_3a897[data-titlebar-mode=translucent] ._titlebarActionIsland_d8891:before {
  display: block;
  opacity: 1;
}
```

**这就是「毛玻璃药丸」效果：默认透明，只在内容从下方穿过（半透明标题模式）时才显示背景，避免按钮看不清。**

### 1.4 毛玻璃参数真值

```css
--chalkboard-titlebar-action-veil:       blur(8px)          /* 或 none */
--chalkboard-titlebar-action-veil-bg:    color-mix(in srgb, var(--chalkboard-titlebar-action-surface) 88%, transparent)
                                          /* 或 var(--chalkboard-titlebar-action-surface) */
--chalkboard-titlebar-action-border:     1px solid color-mix(in srgb, var(--border) 72%, transparent)
--chalkboard-titlebar-action-shadow:     none
--chalkboard-titlebar-action-gap:        0px
```

### 1.5 标题段

```css
._tileTopTitleSegment_612c0 {
  display: flex;
  align-items: center;
  max-width: 220px;             /* ← 标题最多 220px */
  min-height: calc(var(--card-top-btn-size, 24px) + var(--card-top-btn-pad, 2px) * 2);
  padding: 0 var(--space-8);
  pointer-events: none;
}
```

### 1.6 交互区域带（Electron 窗控用）

```css
._appTitlebarInteractiveRegionBand_2b506 {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

._appTitlebarInteractiveRegion_95cda {
  position: absolute;
  pointer-events: none;
  -webkit-app-region: no-drag;      /* 可点击区 */
}
```

**这两个是给 Electron 用的「拖拽区里挖出可点击洞」的机制**：整条标题栏是 `-webkit-app-region: drag`，但按钮区域要用 `no-drag` 才能点击。用绝对定位的空 div 覆盖出可点击区域。

### 1.7 Electron 窗控按钮的特殊尺寸

```css
._windowTitlebarFrame_f6591[data-window-titlebar-enabled]
  ._windowControlsIsland_5f7ae[data-window-titlebar-controls]
  ._tileTopBtn_8667c {
  width: 46px;
  height: var(--window-titlebar-height);
  padding-top: var(--space-4);
  border-width: 0;
  border-radius: 0;
}
```

Windows 窗控按钮是 **46px × 标题栏高度**，直角无边框（贴合系统窗框）。

---

## 二、贴纸行：可显隐的 agent 身份区

### 2.1 结构

```html
<div class="_fpPrimaryAgentRow_18788">              ← 贴纸行
  <button class="_fpPrimaryAgentAvatarButton_07fad"  ← 头像按钮
          aria-label="打开主 agent 设置">
    <span class="_fpPrimaryAgentAvatarRing_0e188">   ← 头像环（1px accent 描边）
      <img class="_fpPrimaryAgentAvatar_ea593" />    ← 头像
    </span>
  </button>
  <span class="_fpPrimaryAgentName_ec0fa">云</span>  ← 名字（宋体 1.125rem）
  <div class="_fpWorkspaceModeMenu_693c3">…</div>   ← 模式菜单

  <!-- 状态覆盖层（绝对定位铺满） -->
  <div class="_fpPrimaryAgentStickerProgress_010a4">  ← 进度/忙碌态
</div>
```

### 2.2 CSS 真值

```css
._fpPrimaryAgentRow_18788 {
  --fp-primary-agent-avatar-size: 30px;
  --fp-primary-agent-name-size: 1.125rem;     /* 18px，比标题大 */
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-width: 0;
  width: auto;
  margin: 0 var(--space-8) var(--space-4);
  padding: 0 var(--space-6) var(--space-6);
  gap: var(--space-10);
  color: var(--accent);
  -webkit-app-region: no-drag;                /* 可交互 */
}

._fpPrimaryAgentAvatarRing_0e188 {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--fp-primary-agent-avatar-size);   /* 30px */
  height: var(--fp-primary-agent-avatar-size);
  flex-shrink: 0;
  border-radius: 50%;
  corner-shape: round;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 34%, transparent);
}

._fpPrimaryAgentName_ec0fa {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-serif, serif);        /* ← 宋体！ */
  font-size: var(--fp-primary-agent-name-size); /* 18px */
  font-weight: 600;
  line-height: 1.4;
}

/* 忙碌态覆盖层 */
._fpPrimaryAgentStickerProgress_010a4 {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-card);
  corner-shape: squircle;
  background: var(--bg);
  color: var(--text-muted);
  font-size: var(--fs-caption);
}
```

**注意名字用 `--font-serif`（宋体）、18px** —— 比页面标题还大。这是侧栏的视觉重心。

### 2.3 显隐逻辑

开关在 store 里：

```js
// index-DEPTMosq.js
chalkboardShowPrimaryAgentHeader: n,
setChalkboardShowPrimaryAgentHeader: (value) => set({ chalkboardShowPrimaryAgentHeader: value }),
```

消费处：

```jsx
function FunctionPanelBody({ width }) {
  const showHeader = useStore((s) => s.chalkboardShowPrimaryAgentHeader);
  const fullPanel = useFullPanel();          // 宽屏模式

  return (
    <Panel
      width={width}
      fullPanel={fullPanel}
      identity={showHeader && <PrimaryAgentRow />}     // ← 贴纸行
      navigation={<Nav />}
      body={
        <SessionList
          activityBars={fullPanel ? false : <ActivityBars />}   // ← 功能按钮区
          ...
        />
      }
      footer={<UserBar />}
    />
  );
}
```

**关键发现：这个开关同时控制两件事**

| 开关值 | 贴纸行 | 功能按钮区 |
|---|---|---|
| `true` | 显示 | 隐藏 |
| `false` | 隐藏 | 显示 |

源码：

```jsx
identity={showHeader && <PrimaryAgentRow />}
activityBars={fullPanel ? false : <ActivityBars />}
```

**这是「宽屏模式」与「紧凑模式」的切换**：`fullPanel` 为真时隐藏功能按钮区（因为宽屏侧栏用另一种导航形态）。

### 2.4 为什么名字用宋体

侧栏顶部是「agent 身份」，不是「页面标题」。Hana 用宋体把它和 UI 元素区分开，形成「这是一个存在，不是一个按钮」的感觉。

这与设置页的分区标题一致：**宋体 = 内容/身份，无衬线 = 界面/操作**。

---

## 三、DropZone：卡片拖放落点算法

### 3.1 完整算法

```js
const CENTER_Y_RATIO = 0.42;                  // FA

function hitThreshold(size) {                 // gf
  return Math.min(size * 0.22, 130);
}

function computeZone(rect, x, y) {            // _W
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height * CENTER_Y_RATIO;

  // 1) 先判断是否在中心区
  if (Math.abs(x - centerX) <= hitThreshold(rect.width)
      && Math.abs(y - centerY) <= hitThreshold(rect.height)) {
    return 'center';
  }

  // 2) 否则算到四边的距离，取最近的
  const edges = [
    ['top',    y - rect.top],
    ['bottom', rect.bottom - y],
    ['left',   x - rect.left],
    ['right',  rect.right - x],
  ];
  edges.sort((a, b) => a[1] - b[1]);
  const [nearestEdge, distance] = edges[0];

  // 3) 距离超过阈值则无效
  return distance <= EDGE_TOLERANCE ? nearestEdge : null;
}
```

### 3.2 三个关键设计

**① 中心点不在正中，在 42% 高度处**

```js
const CENTER_Y_RATIO = 0.42;
```

`0.42` 而不是 `0.5` —— 因为卡片顶部有 44px 标题层，视觉重心偏上。用 42% 让「中心区」落在视觉中心，而不是几何中心。

**② 命中阈值随尺寸变化，但有上限**

```js
Math.min(size * 0.22, 130)
```

- 宽度 200px 的卡片 → 阈值 44px
- 宽度 600px 的卡片 → 阈值 130px（被上限截断，不再是 132px）
- 宽度 2000px 的卡片 → 仍是 130px

**上限 130px 的作用**：超大卡片上，如果阈值按比例增长，中心区会吞掉整个卡片，导致永远无法触发「左右分栏」。130px 保证边缘区始终可用。

**③ 落点矩形计算**

```js
function zoneRect(rect, zone) {               // xg
  const inset = shrinkRect(rect);              // pS：向内缩
  const size = Math.min(MAX_SIZE, inset.width, inset.height);

  if (zone === 'center') {
    const inner = shrinkRect(rect, CENTER_INSET);   // kfe
    return { left: inner.left, top: inner.top, width: inner.width, height: inner.height };
  }

  return zone === 'top'    ? { left: inset.left, top: inset.top,             width: inset.width, height: size }
       : zone === 'bottom' ? { left: inset.left, top: inset.bottom - size,   width: inset.width, height: size }
       : zone === 'left'   ? { left: inset.left, top: inset.top,             width: size, height: inset.height }
       :                     { left: inset.right - size, top: inset.top,     width: size, height: inset.height };
}

function shrinkRect(rect, amount = EDGE_TOLERANCE) {   // pS
  const r = Math.min(amount, rect.width / 2, rect.height / 2);
  return {
    left:   rect.left + r,
    top:    rect.top + r,
    right:  rect.right - r,
    bottom: rect.bottom - r,
    width:  Math.max(0, rect.width - r * 2),
    height: Math.max(0, rect.height - r * 2),
  };
}
```

**`Math.min(amount, rect.width / 2, rect.height / 2)`** —— 缩进量不能超过尺寸的一半，否则矩形会变成负数。这是防御性写法。

### 3.3 落点语义

| zone | 落点矩形 | 语义 | 布局方向 |
|---|---|---|---|
| `center` | 内缩后的中心区 | 合并成 tab 组 | — |
| `top` | 上半条 | 上方插入 | column |
| `bottom` | 下半条 | 下方插入 | column |
| `left` | 左半条 | 左侧分栏 | row |
| `right` | 右半条 | 右侧分栏 | row |

```js
function zoneToDirection(zone) {              // SW
  return zone === 'left' || zone === 'right' ? 'row' : 'column';
}
```

### 3.4 禁止落点的判断

```js
function tryDrop(target, x, y) {              // Yfe
  const zone = computeZone(target.rect, x, y);
  if (!zone) return false;

  if (isForbidden(dragState.cardInstanceId, target.surfaceId)) {
    dragState.outcome = { kind: 'none' };
    setDropState(target.cardInstanceId, {
      zone,
      forbidden: true,
      state: 'forbidden',
      mode: zone === 'center' ? 'merge' : 'split',
      rect: zoneRect(target.rect, zone),
    });
    clearHover();
    return true;                              // ← 注意：仍然返回 true
  }

  dragState.outcome = { kind: 'drop', target, zone };
  setDropState(target.cardInstanceId, {
    zone,
    forbidden: false,
    mode: zone === 'center' ? 'merge' : 'split',
    rect: zoneRect(target.rect, zone),
  });
  return true;
}
```

**禁止落点时仍返回 `true`** —— 因为「禁止」也是一种有效的交互反馈（显示红色禁止标识），不是「没命中」。

### 3.5 表面边缘落点

```js
function trySurfaceEdge(surface, edge) {      // Jfe
  if (!dragState) return;

  if (isForbidden(dragState.cardInstanceId, surface.surfaceId)) {
    dragState.outcome = { kind: 'none' };
    setSurfaceDropState(surface.surfaceId, {
      zone: edge, forbidden: true, state: 'forbidden',
      mode: 'surface', rect: surfaceEdgeRect(surface, edge),
    });
    clearCardHover();
    return;
  }

  dragState.outcome = { kind: 'surface-edge', referenceNodeId: surface.referenceNodeId, edge };
  setSurfaceDropState(surface.surfaceId, {
    zone: edge, forbidden: false, mode: 'surface',
    rect: surfaceEdgeRect(surface, edge),
  });
}
```

**`mode: 'surface'` 与 `'split'` 的区别**：`split` 是把卡片切成两半（真实分栏），`surface` 是往整个表面边缘追加（不切割现有卡片）。

### 3.6 未追到的常量

`EDGE_TOLERANCE`（`_O`）、`MAX_SIZE`（`cW`）、`CENTER_INSET`（`kfe`）都是跨文件导入，压缩后符号冲突无法定位。从 `shrinkRect` 的默认参数可推断 `EDGE_TOLERANCE` 是缩进基准值。

---

## 四、卡片迁移动画：左右滑入滑出

### 4.1 四个方向

```css
@keyframes _chalkboardSlideEnterFromLeft_d9edf {
  0%  { transform: translate3d(-100%, 0, 0); }
  to  { transform: translateZ(0); }
}

@keyframes _chalkboardSlideEnterFromRight_24cbd {
  0%  { transform: translate3d(100%, 0, 0); }
  to  { transform: translateZ(0); }
}

@keyframes _chalkboardSlideLeaveToLeft_0ef1a {
  0%  { transform: translateZ(0); }
  to  { transform: translate3d(-100%, 0, 0); }
}

@keyframes _chalkboardSlideLeaveToRight_1bb30 {
  0%  { transform: translateZ(0); }
  to  { transform: translate3d(100%, 0, 0); }
}
```

**用 `translate3d` 而非 `translateX`** —— 强制 GPU 加速，避免动画期间重绘。

### 4.2 应用参数

```css
._slideEnterFromRight_3dfc7 {
  animation: _chalkboardSlideEnterFromRight_24cbd
             var(--chalkboard-motion-duration-page)    /* .36s */
             var(--chalkboard-motion-ease-ios)         /* cubic-bezier(.22, 1, .36, 1) */
             both;                                     /* 保留首尾帧 */
}
```

四个方向都用同一套时长和曲线（`.36s` + `ease-ios`）。

**`both` 的作用**：动画开始前应用 `0%` 帧（避免闪一下原位置），结束后保留 `to` 帧。

### 4.3 迁移容器

```css
._pagePane_ef337 {
  position: absolute;
  inset: 0;
  display: flex;
  backface-visibility: hidden;      /* ← 防止 3D 变换时背面透出 */
}

/* 动画期间提示浏览器优化 */
._pagePane_ef337:is(._slideEnterFromRight_3dfc7,
                    ._slideEnterFromLeft_b5292,
                    ._slideLeaveToLeft_548a0,
                    ._slideLeaveToRight_4d0a0) {
  will-change: transform;
}
```

**`position: absolute; inset: 0`** —— 页面面板完全覆盖画布，多个面板可以叠放，通过 `translate3d` 滑入滑出切换。

### 4.4 迁移的完整流程

```
1. 卡片在侧栏（fp）或画布（canvas）里
2. 用户拖拽卡片到目标区域
3. DropZone 计算落点（见第三节）
4. 落点确定后：
   ├─ 旧位置的卡片加 slideLeaveToLeft/Right
   ├─ 新位置的卡片加 slideEnterFromLeft/Right
   └─ 两者同时播放（.36s）
5. 动画结束 → 从旧位置卸载 DOM
```

**方向选择规则**（从命名推断）：

| 移动方向 | 离开动画 | 进入动画 |
|---|---|---|
| 向右移动（→ 浮动区） | `slideLeaveToRight` | `slideEnterFromRight` |
| 向左移动（→ 主区） | `slideLeaveToLeft` | `slideEnterFromLeft` |

### 4.5 画布溢出的两个辅助元素

```css
/* 右侧渐隐提示（还有内容） */
._canvasOverflowFade_0a55e {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 56px;
  pointer-events: none;
  background: linear-gradient(to right, transparent, var(--panel-card-bg) 88%);
  z-index: 5;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}

/* 展开按钮（圆形，accent 底） */
._canvasOverflowExpand_674f5 {
  position: absolute;
  right: var(--space-8);
  top: 50%;
  transform: translate(18px) translateY(-50%) scale(.96);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--accent) 72%, var(--bg-card, #fff) 28%);
  border-radius: calc(var(--radius-md) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  background: var(--accent);
  color: var(--bg-card, #fff);
  box-shadow: 0 8px 22px rgba(var(--accent-rgb, 83, 125, 150), .22);
  cursor: pointer;
  padding: 0;
  opacity: 0;
  z-index: 6;
}
```

**这两个的默认 `opacity: 0`，靠 `data-*` 属性触发显形**（画布内容溢出时才出现）。

---

## 五、panelMenu：卡片右键菜单

### 5.1 容器

```css
._panelMenu_fb4a3 {
  min-width: 180px;
  padding: var(--space-4);                       /* 4px 内缩 */
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius-md) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  animation: hana-fade-up var(--duration-fast) var(--ease-out);   /* 0.15s 淡入上移 */
}
```

### 5.2 菜单项

```css
._panelMenuItem_ed7eb {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  min-height: 28px;                              /* 28px 行高 */
  padding: 0 var(--space-8);
  border: none;
  border-radius: calc(var(--radius-sm) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  background: transparent;
  font-size: var(--fs-ui);
  line-height: 20px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-instant) var(--ease-out);   /* 0.1s */
}

/* 悬停 / 键盘高亮（同一套样式） */
._panelMenuItem_ed7eb:hover,
._panelMenuItem_ed7eb[data-highlighted] {
  background: var(--overlay-light);
}

/* 禁用 */
._panelMenuItem_ed7eb:disabled,
._panelMenuItem_ed7eb[data-disabled] {
  color: var(--text-muted);
  opacity: .58;
}
```

**注意 `[data-highlighted]` 与 `:hover` 用同一套样式** —— 键盘导航和鼠标悬停视觉一致。

### 5.3 图标槽

```css
._panelMenuIconSlot_34bf3 {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 16px;                                /* 固定 16px */
  width: 16px;
  height: 16px;
  border-radius: calc(var(--radius-sm) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  color: var(--text-muted);
  transition: background var(--duration-instant) var(--ease-out),
              color var(--duration-instant) var(--ease-out),
              opacity var(--duration-instant) var(--ease-out);
}
```

### 5.4 标签

```css
._panelMenuLabel_75c9d {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;                              /* 超长截断 */
}
```

### 5.5 活动指示点

```css
/* 文字后面（行内） */
._panelMenuActivityDot_c71bd {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: var(--space-6);
  border-radius: 50%;
  corner-shape: round;
  background: var(--accent);
  vertical-align: middle;
}

/* 按钮角上（绝对定位） */
._panelMenuButtonActivityDot_95e40 {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--accent);
  pointer-events: none;
}
```

### 5.6 尺寸总表

| 项 | 值 |
|---|---|
| 菜单最小宽 | 180px |
| 菜单内缩 | 4px |
| 菜单圆角 | `--radius-md` × squircle |
| 菜单入场 | `hana-fade-up` 0.15s |
| 行最小高 | 28px |
| 行横向内缩 | 8px |
| 行圆角 | `--radius-sm` × squircle |
| 图标槽 | 16×16 |
| 标签最大宽 | 240px |
| 活动点 | 5×5 |

---

## 六、getOverlayTriggerRect：侧栏抽屉的触发区

### 6.1 两种实现

**studio 窗口（独立窗口）：没有触发区**

```jsx
<FunctionPanel
  width={width}
  collapsed={collapsed}
  overlayVisible={overlayVisible}
  onWidthChange={...}
  onOverlayVisibleChange={setOverlayVisible}
  onWidthTransitioning={() => {}}
  minWidth={MIN}
  maxWidth={MAX}
  renderContent={() => <StudioPanelContent />}
  getOverlayTriggerRect={() => null}       // ← 永远返回 null
  backdrop={<Backdrop />}
/>
```

`() => null` 意味着：**没有触发区，鼠标一离开抽屉就开始 300ms 倒计时**。

**主窗口：由函数返回按钮矩形**

```js
function FunctionPanelRoot({ renderContent }) {
  const collapsed = useStore((s) => s.chalkboardFunctionPanelCollapsed);
  const width = useStore((s) => s.chalkboardFunctionPanelWidth);
  const overlayVisible = useStore((s) => s.chalkboardFunctionPanelOverlayVisible);

  const getOverlayTriggerRect = () =>
    restoreButtonRef.current?.getBoundingClientRect()
    ?? { left: 0, top: 0, right: SCREEN_W, bottom: SCREEN_H };

  return <FunctionPanel ... getOverlayTriggerRect={getOverlayTriggerRect} />;
}
```

### 6.2 触发区的作用

```js
const inTrigger = triggerRect !== null
  && x >= triggerRect.left && x <= triggerRect.right
  && y >= triggerRect.top  && y <= triggerRect.bottom;

const inOverlay = overlayRect !== null
  && x >= overlayRect.left && x <= overlayRect.right
  && y >= overlayRect.top  && y <= overlayRect.bottom;

if (inTrigger || inOverlay) { clearTimer(); return; }   // 保活
```

**触发区是「恢复侧栏」按钮的矩形。** 鼠标停在按钮上时抽屉保持打开，离开按钮但还在抽屉里也保持，两者都不在才倒计时。

### 6.3 兜底矩形的含义

```js
?? { left: 0, top: 0, right: SCREEN_W, bottom: SCREEN_H }
```

如果拿不到按钮（比如按钮还没渲染），兜底是**整个屏幕** —— 相当于「任何位置都算在触发区内」，也就是**永不自动关闭**。

**这是一个安全兜底**：宁可抽屉不自动关（用户手动关），也不要因为拿不到矩形导致抽屉狂闪。

### 6.4 为什么 studio 窗口不需要触发区

studio 是独立窗口，没有 trafficStrip 里的恢复按钮。收起后要重新展开，用户得点别的地方（或快捷键）。没有按钮就没有触发区。

---

## 七、侧栏会话列表的拖拽重排

### 7.1 会话项的状态属性（完整）

```jsx
<button className={sessionItem + (singleLine ? ' ' + sessionItemSingleLine : '')
                                + (active ? ' ' + sessionItemActive : '')
                                + (dropTarget ? ' ' + dropTarget : '')}
        data-session-path={session.path}
        data-studio-folder-drop={dropTarget ? '' : undefined}
        data-row-mode={rowMode}
        data-unread-output={unread ? 'true' : 'false'}
        data-switch-pending={pending ? 'true' : 'false'}
        data-session-pointer-draggable={draggable ? draggable : undefined}
        data-session-row-dragging={dragging ? '' : undefined}
        data-session-row-handoff={handoff}
        data-session-slot={slotOpen ? 'open' : 'closed'}
        data-session-slot-animate={animate ? '' : undefined}
        data-session-arrival={arrival}
        style={{
          ...(dragging ? { opacity: 0 } : {}),     // ← 拖拽时原位置隐藏
          ...(slotAnimate ? {
            maxHeight: closed ? 0 : measuredHeight,
            minHeight: closed ? 0 : undefined,
            overflow: 'hidden',
            padding: closed ? 0 : undefined,
            margin: closed ? 0 : undefined,
          } : {}),
        }}>
```

**十个状态属性，全部用 `data-*`。** 这是 Hana 的样式驱动范式的典型样本。

### 7.2 拖拽时的「原位置留白」

```jsx
style={{ ...(dragging ? { opacity: 0 } : {}) }}
```

**拖拽时原位置的元素 `opacity: 0`（不是 `display: none`）** —— 保持占位，避免列表塌陷。同时另起一个 `position: fixed` 的「幽灵元素」跟随鼠标：

```jsx
{portal && ghostVisible && (
  <Portal root={document.body}>
    <div className={sessionItem + ' ' + sessionItemActive}
         data-session-row-dragging=""
         data-session-row-handoff={handoff}
         data-drag-lift=""
         aria-hidden="true"
         style={{ ...ghostStyle, '--session-lift-shadow': LIFT_SHADOW }}>
      {/* 完整复制会话项内容 */}
    </div>
  </Portal>
)}
```

### 7.3 「拾起」效果

```css
@keyframes _session-list-lift-pickup_2ae29 {
  0%  { background-color: transparent; box-shadow: none; }
  to  { background-color: var(--bg); box-shadow: var(--session-lift-shadow); }
}

@keyframes _session-list-lift-pickup-active_bf6b3 {
  0%  { background-color: color-mix(in srgb, var(--text) 6%, transparent); box-shadow: none; }
  to  { background-color: var(--bg); box-shadow: var(--session-lift-shadow); }
}

@keyframes _fp-nav-lift-pickup_0d7ff {
  0%  { background-color: transparent; box-shadow: none; }
  to  { background-color: var(--bg); box-shadow: var(--fp-nav-lift-shadow); }
}
```

**两个变体的差别只在起始背景**：已选中的项起始有 6% 墨色底，未选中的起始透明。

### 7.4 重排时的 slot 动画（最高级的部分）

**会话项的高度是动态的**（`maxHeight` 由 JS 测量），收起时：

```css
._sessionItem_4eaf6[data-session-slot],
._pinnedRow_73b79[data-session-slot] {
  overflow: hidden;
}

._sessionItem_4eaf6[data-session-slot-animate] {
  transition: transform var(--chalkboard-motion-duration-enter, var(--duration-fast)) var(--chalkboard-motion-ease-ios, var(--ease-out)),
              max-height var(--chalkboard-motion-duration-enter, var(--duration-fast)) var(--chalkboard-motion-ease-ios, var(--ease-out)),
              min-height var(--chalkboard-motion-duration-enter, var(--duration-fast)) var(--chalkboard-motion-ease-ios, var(--ease-out)),
              padding ..., margin ...;
}
```

**为什么 animate 是单独属性**：重排过程中需要动画，但**重排结束时必须关掉动画**，否则会有「回弹抖动」：

```css
._sessionListScroller_5f4dd[data-session-reorder-settle] ._pinnedRow_73b79,
._sessionListScroller_5f4dd[data-session-reorder-settle] ._pinned {
  transition: none;              /* ← 落定瞬间关闭过渡 */
}
```

**这是一个非常精细的处理：`data-session-reorder-settle` 只在重排落定的那一帧存在。**

### 7.5 新会话到达的动画（三阶段）

```css
._sessionItem_4eaf6[data-session-arrival] {
  --session-arrival-slot-duration:   .18s;      /* 槽位展开 */
  --session-arrival-reveal-duration: .16s;      /* 内容显形 */
  --session-arrival-reveal-delay:    90ms;      /* 显形延迟 */
  --session-arrival-landed-duration: .14s;      /* 落定 */
}
```

三个阶段：

```
① slot 展开（.18s）
   max-height: 0 → 实测高度

② 内容显形（.16s，延迟 90ms 开始）
   用 mask-image 做「从上往下揭开」

③ 落定（.14s，无延迟）
   缩短时长，快速收尾
```

显形的 mask 技巧：

```css
._sessionItem_4eaf6[data-session-arrival=open],
._sessionItem_4eaf6[data-session-arrival=landed] {
  mask-image: linear-gradient(to bottom,
    #000 0%, #000 40%,        /* 上 40% 不透明 */
    transparent 60%, transparent 100%);   /* 下 40% 透明 */
  mask-size: 100% 250%;        /* ← 遮罩比元素高 2.5 倍 */
  mask-repeat: no-repeat;
  animation: _sessionArrivalReveal_e2b6b var(--session-arrival-reveal-duration) var(--ease-out);
}

@keyframes _sessionArrivalReveal_e2b6b {
  0%  { opacity: 0; transform: translateY(-3px); mask-position: 0 100%; }
  to  { opacity: 1; transform: none;               mask-position: 0 0; }
}
```

**`mask-size: 100% 250%` + `mask-position: 0 100% → 0 0`** —— 遮罩比元素高 2.5 倍，从底部位置移到顶部位置，产生「内容从上往下逐渐显现」的效果。

**为什么不直接用 `opacity`**：`opacity` 是整体渐变，而 mask 是**逐行**揭开，视觉上像「纸从信封里抽出来」。

### 7.6 状态机

```
closed ──(插入)──→ open ──(90ms 后)──→ open（显形动画进行中）
                                        ↓
                                     landed（落定）
                                        
held  ← 拖拽悬停时的临时状态（opacity: 0）
```

| 状态 | opacity | mask | 动画 |
|---|---|---|---|
| `closed` | 0 | 无 | — |
| `held` | 0 | 无 | — |
| `open` | 1 | 有 | reveal .16s delay 90ms |
| `landed` | 1 | 有 | reveal .14s delay 0 |

---

## 八、七项的共同范式总结

挖完这七项，能看出 Hana 的三个稳定范式：

### 8.1 状态用 `data-*`，不用 className

七项里每一项都有 `data-*` 状态：

```
TitlebarRenderer: data-titlebar-action-island, data-titlebar-track, data-islands
贴纸行:          （用 store 布尔值控制渲染）
DropZone:        data-drop-zone, data-forbidden
迁移动画:        data-session-arrival, data-session-slot
panelMenu:       data-highlighted, data-disabled
会话拖拽:        data-session-row-dragging, data-session-slot-animate, data-session-reorder-settle
```

**className 只表达「这是什么」，`data-*` 表达「现在什么状态」。**

### 8.2 动画总是「可关闭」的

```css
/* 正常态有动画 */
[data-session-slot-animate] { transition: ... }

/* 落定瞬间关闭 */
[data-session-reorder-settle] { transition: none; }
```

**这是为了防止「动画叠加」和「落定回弹」。** 每个有 transition 的组件，几乎都能找到一个对应的「关闭动画」的状态。

### 8.3 阈值都有上限

```js
Math.min(size * 0.22, 130)          // DropZone 命中阈值
Math.min(amount, rect.width / 2)    // 缩进量
max-width: 220px                    // 标题段
max-width: 240px                    // 菜单标签
```

**凡是「按比例计算」的地方，都配了绝对上限。** 因为大尺寸下比例会失控。

---

## 九、仍未追到的（诚实登记）

| 项 | 原因 |
|---|---|
| `EDGE_TOLERANCE`（`_O`） | 跨文件导入，压缩后符号冲突 |
| `MAX_SIZE`（`cW`） | 同上 |
| `CENTER_INSET`（`kfe`） | 同上 |
| `--session-lift-shadow` 具体值 | 由 JS 常量 `HA` 注入，未定位到定义 |
| `--fp-nav-lift-shadow` 具体值 | 同上 |

**这些不影响结构理解，但影响像素级复刻。** 需要时可以：

1. 在实际运行界面用 DevTools 读计算值
2. 或用 REA 的 `analyze_javascript_application` 做符号解析

---

## 附录：源码定位速查

| 内容 | 文件 | 关键标识 |
|---|---|---|
| TitlebarRenderer CSS | `ChatTranscript-DhOABhoU.css` | `._titlebarActionIsland_d8891` |
| 标题段 | 同上 | `._tileTopTitleSegment_612c0` |
| 贴纸行 CSS | 同上 | `._fpPrimaryAgentRow_18788` |
| 贴纸行显隐 | `contributed-keybindings-BWxnaFR2.js` | `chalkboardShowPrimaryAgentHeader` |
| DropZone 算法 | `CardShell-DVSoA_HL.js` | `function _W(` |
| DropZone 矩形 | 同上 | `function xg(` |
| 迁移动画 | `ChatTranscript-DhOABhoU.css` | `_chalkboardSlideEnterFromRight_24cbd` |
| panelMenu | 同上 | `._panelMenu_fb4a3` |
| 触发区 | `App-CfhKQJ81.js` | `getOverlayTriggerRect: () => null` |
| 会话项状态 | `CardShell-DVSoA_HL.js` | `data-session-row-dragging` |
| 会话 slot 动画 | `CardShell-B3PSoerL.css` | `data-session-slot-animate` |
| 新会话显形 | 同上 | `_sessionArrivalReveal_e2b6b` |
