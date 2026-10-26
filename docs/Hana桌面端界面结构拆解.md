# Hana 桌面端界面结构拆解

> 本文是 Hana 1.1.35 桌面端 UI 的**结构图纸**，用于 moheng 桌面端移植时对照。
> 全部结论来自源码实测，不是观察推测。每个数值都标了出处。
>
> 源码来源：
> - `reference/hana-1.1.35/styles.css`（3402 行，全局样式，SHA-256 已验）
> - `hana-frontend-recovered/assets/ChatTranscript-DhOABhoU.css`（251KB，布局主战场）
> - `hana-frontend-recovered/assets/CardShell-DVSoA_HL.js`（3MB，卡片壳实现）
> - `hana-frontend-recovered/assets/ChatTranscript-BhjBc-kF.js`（1.9MB，布局装配）
>
> 日期：2026-10-23

---

## 一、总体结论：不是三栏，是「两层容器 + 三块浮起卡片」

人眼看到的是「左中右三栏」，但源码里的实际结构是：

```
第 1 层：根容器（_root）              → flex row，撑满视口
第 2 层：窗口标题条（windowTitlebar）  → 固定在顶部，独立一层
第 3 层：三块并列的卡片               → 侧栏 / 画布 / 右侧浮动区
```

**关键认知：三栏不是「三个区域」，是「三张独立的纸」。**

每张纸都有自己的：
- `margin`（`--panel-edge-gap` = 6px）
- `border-radius`（`--panel-card-radius` × squircle 系数）
- `corner-shape: squircle`
- `border`（`--panel-card-border`）
- `box-shadow`（部分有）

所以 Hana 的「三栏」在视觉上是**三张浮在画布上的卡片**，不是被分割线切开的整块区域。

---

## 二、完整 DOM 层级

### 2.1 根结构

```html
<div class="_root_4a78b">                    ← 应用根
  <div class="_windowTitlebarFrame_f6591">   ← display: contents（不占位）
    <div class="_windowTitlebar_4b3c7">      ← 窗口标题条
      <brand icon + name />
      <窗口控制按钮区 />
    </div>
  </div>

  <div class="_fp_f9c75">                    ← ① 左侧栏（浮动卡片）
    <div class="_fpTrafficRow_5ddeb">        ← 窗控避让行（44px）
    <div class="_fpPrimaryAgentRow_18788">   ← ② 贴纸行
    <div class="_fpSidebarHost_09f83">       ← ③ 侧栏主体（flex column）
      ...
    </div>
  </div>

  <div class="_canvas_4bffb">                ← 中间画布
    <div class="_pageStage_82400">           ← 页面舞台
      <section class="_tileShell_3a897">     ← 卡片壳（每张卡一层）
        <header class="_tileTop_931a2">      ← 卡片标题层（absolute）
          <div class="_titlebarFrame_29cb1"> ← 标题内容
        </header>
        <div class="_tileContent_d5e2b">     ← 卡片内容
      </section>
    </div>
  </div>

  <div class="_fpOverlay_1c4ff">             ← ④ 右侧浮动区（fixed）
    <div class="_fpOverlayInner_ec97a">
  </div>

  <div class="_fpResizeHandle_cc543">        ← ⑤ 拖动把手（fixed）
</div>
```

### 2.2 根容器 CSS（实测）

```css
._root_4a78b {
  display: flex;
  width: 100%;
  height: 100vh;
  height: 100dvh;          /* 移动端跟随可视视口 */
  overflow: hidden;
  position: relative;
  isolation: isolate;      /* 建立层叠上下文，浮层用 */
  background: var(--bg);
  color: var(--text);
  --paper-texture-surface: var(--bg);
}
```

**注意 `display: flex` 没有 `flex-direction`，所以默认是 `row`** —— 三块横向排列。

### 2.3 窗口标题条（实测）

```css
._windowTitlebarFrame_f6591 {
  display: contents;       /* ← 关键：不生成盒子，子元素直接参与父级 flex */
}

._windowTitlebar_4b3c7 {
  display: flex;
  align-items: center;
  flex: 0 0 var(--window-titlebar-height);
  height: var(--window-titlebar-height);
  box-sizing: border-box;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-16) 0
           calc(var(--window-titlebar-leading-inset)
                + var(--card-top-btn-size)
                + var(--card-top-btn-pad) * 2
                + var(--space-8));
  background: transparent;
  color: var(--text);
  font-family: var(--font-ui);
  -webkit-app-region: drag;
}
```

**`display: contents` 是个精巧设计**：`windowTitlebarFrame` 本身不占位，它的子元素（标题条）直接成为 `_root` 的 flex item，所以标题条能横跨整个窗口宽度，不受三栏分割影响。

---

## 三、左侧栏（fp）

### 3.1 结构

```html
<div class="_fp_f9c75" data-...>              ← 侧栏卡片外壳
  <div class="_fpTrafficRow_5ddeb">           ← ① 窗控避让行
    <!-- 高度 = --titlebar-h = 44px，-webkit-app-region: drag -->
  </div>

  <div class="_fpPrimaryAgentRow_18788">      ← ② 贴纸行（可显隐）
    <button class="_fpPrimaryAgentAvatarButton_07fad">
      <span class="_fpPrimaryAgentAvatarRing_0e188">
        <span class="_fpPrimaryAgentSticker_1a144">   ← 贴纸
        <span class="_fpPrimaryAgentStickerProgress_010a4">
      <span class="_fpPrimaryAgentName_ec0fa">        ← 名字
    </button>
    <div class="_fpWorkspaceTitle_915c0">     ← 工作区标题
    <button class="_fpWorkspaceModeMenu_693c3"> ← 模式菜单
  </div>

  <div class="_fpSidebarHost_09f83">          ← ③ 侧栏主体
    <!-- 功能按钮区 + 会话目录 + 页脚，见 3.3 -->
  </div>
</div>
```

### 3.2 侧栏卡片 CSS（实测）

```css
._fp_f9c75 {
  --icon-halo-bg: var(--sidebar-bg, var(--bg));
  --titlebar-surface-bg: var(--sidebar-bg, var(--bg));
  --paper-texture-surface: var(--sidebar-bg, var(--bg));
  position: relative;
  z-index: 2;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  margin: var(--panel-edge-gap);        /* 6px */
  margin-right: 0;                      /* 右侧不留缝，紧贴画布 */
  border-radius: calc(var(--panel-card-radius) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: var(--panel-card-border);
  background: var(--sidebar-bg, var(--bg));
  box-shadow: 0 4px 32px #0000000d;      /* 很淡的浮起 */
  overflow: hidden;
  transition: width var(--chalkboard-motion-duration-space) ...,
              margin ..., opacity ..., border-color ...;
}
```

**`margin-right: 0`** 是关键：侧栏和画布之间只留画布自己的 `--tile-gutter`（3px），不是两侧各 6px。

### 3.3 侧栏内部三段结构（来自 reference/styles.css）

```css
.sidebar-inner {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);       /* 240px */
  min-width: var(--sidebar-width);
  height: 100%;
  opacity: 1;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.sidebar-header {                    /* ① 顶部标题行 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-8) var(--space-16);
  flex-shrink: 0;
  -webkit-app-region: no-drag;       /* 可点击 */
}

.sidebar-title {
  font-size: var(--fs-ui);
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;         /* 小写标签式标题 */
}

.sidebar-header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.sidebar-chat-content {              /* ② 会话目录（flex: 1 吃掉剩余高度） */
  display: flex;
  flex-direction: column;
  flex: 1;
  /* overflow 由内部滚动容器处理 */
}

.sidebar-footer {                    /* ③ 底部用户/设置区 */
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) var(--space-8);
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
```

### 3.4 功能按钮区

```css
.sidebar-activity-bar {
  /* 每个功能按钮一行，图标 + 文字 */
}

.sidebar-activity-bar:hover {
  background: var(--accent-light);
  color: var(--accent);
}

.sidebar-activity-bar [data-page-nav-icon] {
  flex-shrink: 0;
}
```

按钮通过 `data-selected` 属性表达选中态（不是 className）：

```jsx
<button className="sidebar-activity-bar"
        data-selected={view === 'home' ? '' : undefined}
        data-studio-nav="home">
  <Icon />
  <span>首页</span>
</button>
```

### 3.5 收起状态

```css
.sidebar.collapsed {
  width: 0;
  border-right-color: transparent;
}

.sidebar.collapsed .sidebar-inner {
  opacity: 0;
  pointer-events: none;
}

._fpCollapsed_7bc13 {
  width: 0;
  margin-left: 0;
  margin-right: 0;
  opacity: 0;
  border-color: transparent;
  pointer-events: none;
}
```

**收起是「宽度归零 + 透明度归零 + 取消指针事件」，不是 `display: none`。** 这样过渡动画才能生效（`transition: width ... opacity ...`）。

### 3.6 左上角的收起/打开按钮

不在侧栏内部，而是在**窗口标题条的 trafficStrip 区域**：

```css
._trafficStrip_e117f {
  position: fixed;
  top: 0;
  left: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
  max-width: min(44vw, var(--titlebar-strip-max-width, 44vw));
  height: var(--titlebar-h, 44px);
  padding-top: calc(var(--panel-edge-gap)
                   + var(--card-border-width, 1px)
                   + var(--card-top-inset, 6px)
                   - var(--card-top-btn-pad, 2px));
  padding-left: 82px;                 /* 让开 macOS 红绿灯按钮 */
  padding-right: var(--space-16);
  box-sizing: border-box;
  -webkit-app-region: drag;
  pointer-events: none;               /* 容器不拦截，子按钮自己开 */
  z-index: 32;
}

._sdbBtn_e792e {
  --titlebar-action-veil: var(--chalkboard-titlebar-action-veil);
  --titlebar-action-bg: var(--chalkboard-titlebar-action-veil-bg);
  --titlebar-action-border: var(--chalkboard-titlebar-action-border);
}
```

**`padding-left: 82px` 是 macOS 红绿灯（traffic lights）的避让。** Windows 上这个值应该不同。

---

## 四、中间主页面（回答「是卡片？容器？浮层？」）

**答案：是「卡片壳（tileShell）+ 舞台（pageStage）+ 画布（canvas）」三层，卡片是 absolute 标题层 + 内容层。**

### 4.1 三层结构

```css
/* 第 1 层：画布，吃满中间剩余宽度 */
._canvas_4bffb {
  flex: 1;
  min-width: 0;
  height: 100%;
  position: relative;
  overflow: visible;                    /* 关键：不裁切，卡片可以溢出 */
  padding: calc(var(--panel-edge-gap) / 2);   /* 3px */
  box-sizing: border-box;
}

/* 第 2 层：页面舞台 */
._pageStage_82400 {
  flex: 1;
  min-width: 0;
  height: 100%;
  position: relative;
  z-index: 1;
}

/* 第 2' 层：页面表面（欢迎页等空态用） */
._pageSurface_998e1 {
  flex: 1;
  min-width: 0;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(var(--panel-edge-gap) / 2);
  box-sizing: border-box;
}
```

### 4.2 卡片壳（tileShell）

```css
._tileShell_3a897 {
  --tile-gutter: calc(var(--panel-edge-gap) / 2);    /* 3px */
  --titlebar-surface-bg: var(--panel-card-bg);
  position: relative;
  display: flex;
  flex-direction: column;
  width: calc(100% - 2 * var(--tile-gutter));
  height: calc(100% - 2 * var(--tile-gutter));
  margin: var(--tile-gutter);
  min-width: 0;
  min-height: 0;
  border-radius: calc(var(--panel-card-radius) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
}
```

**`--tile-gutter: 3px`** 是画布内边距的一半，让卡片与画布边缘保持 3px 视觉呼吸。

### 4.3 卡片有两种形态

```css
/* 形态 A：有边框和背景（实心卡片） */
._tileCard_1790b {
  --icon-halo-bg: var(--panel-card-bg);
  border: var(--card-border-width, 1px) solid
          var(--card-border-color, rgba(0, 0, 0, .08));
  background: var(--panel-card-bg);
  overflow: hidden;
}

/* 形态 B：裸卡（无边框无背景，内容直接铺在画布上） */
._tileBare_6ea80 {
  /* 默认无边框无背景 */
}
._tileBare_6ea80[data-dragging] {
  background-color: var(--panel-card-bg);
  border-color: var(--card-border-color, rgba(0, 0, 0, .08));
}
```

JSX 里的选择：

```js
const className = [styles.tileShell,
                   surface === 'bare' ? styles.tileBare : styles.tileCard,
                   closing ? styles.tileClosing : '']
                  .filter(Boolean).join(' ');
```

### 4.4 卡片内部：标题层 + 内容层

```css
/* 标题层：绝对定位在卡片顶部，高度 44px */
._tileTop_931a2 {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  height: var(--titlebar-h, 44px);
  background: transparent;        /* 透明！内容会从下面穿过 */
  pointer-events: none;           /* 容器不拦截 */
  -webkit-app-region: drag;
}

/* 标题内容：网格布局，左自动 + 右撑满 */
._titlebarFrame_29cb1 {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  column-gap: var(--space-4);
  height: calc(var(--card-top-inset, 6px) * 2 + var(--card-top-btn-size, 24px));
  padding: calc(var(--card-top-inset, 6px) - var(--card-top-btn-pad, 2px))
           max(calc(var(--card-top-inset, 6px) - var(--card-top-btn-pad, 2px)),
               var(--ttb-clearance-right, 0px))
           0
           max(calc(var(--card-top-inset, 6px) - var(--card-top-btn-pad, 2px)),
               var(--ttb-clearance, 0px));
  box-sizing: border-box;
  pointer-events: none;
}
```

**这是 Hana 最重要的一个设计：标题层是 `position: absolute` + 透明背景，内容从它下方穿过并被渐隐遮罩处理。**

对应关系：

```
tileShell (relative)
  ├─ header.tileTop     (absolute, top 0, h 44px, 透明, z-5)
  └─ div.tileContent    (正常流，从 0 开始，被标题层覆盖)
```

所以内容容器必须自己加 `padding-top` 或者滚动时被 mask 遮罩。

内容区留空间的规则：

```css
/* 有标题的卡片，内容区下移一个标题高度 */
._tileShell_3a897[data-has-title]:not([data-titlebar-mode=translucent]) > header + * {
  padding-top: calc(var(--card-top-inset, 6px) * 2 + var(--card-top-btn-size, 24px));
}

/* 首页卡片同理 */
._tileShell_3a897[data-tile-id=wb-home-preview-tile] > header + * {
  padding-top: calc(var(--card-top-inset, 6px) * 2 + var(--card-top-btn-size, 24px));
}
```

### 4.5 卡片标题层内部结构（JSX 实测）

```jsx
<section className={tileShell + ' ' + tileCard} data-surface=... data-titlebar-mode=...>
  {bodyForm === 'framed' && <FrameDecor />}

  <header className={tileTop} data-tile-top>
    {/* 长按区（拖拽触发） */}
    {longPressEnabled && <div data-titlebar-long-press-zone aria-hidden style={...} />}

    {/* 标题栏：左操作 + 标题段 + 右操作 */}
    <TitlebarRenderer left={leftActions} right={rightActions}
                      renderAction={...} titleSegment={titleSegment} />

    {/* 拖拽把手 */}
    <Grabber dragHandleRef={...} dragging={...} onContextMenu={...}>
      {/* 多标签时的 tab 条 */}
      {isTabsGroup && <Tabs>{tabs.map(...)}</Tabs>}
    </Grabber>
  </header>

  {/* 插件卡片的额外头 */}
  {card.HeaderExtras && <card.HeaderExtras />}

  <div className={tileContent} ref={contentRef}>
    {/* 诊断信息 / 空态 */}
  </div>

  {/* 拖放区域 */}
  <DropZone zone={...} forbidden={...} />
</section>
```

---

## 五、右侧浮动区（fpOverlay）

### 5.1 它和左侧栏用的是同一套类名前缀

| 左侧栏 | 右侧浮动区 | 差异 |
|---|---|---|
| `_fp_f9c75` | `_fpOverlay_1c4ff` | 定位方式不同 |
| `position: relative` | `position: fixed` | — |
| `margin: 6px; margin-right: 0` | `top/left/bottom: 6px` | — |
| `flex-shrink: 0`（占位） | 不占位（浮在上面） | — |
| `z-index: 2` | `z-index: 31` | — |

```css
._fpOverlay_1c4ff {
  --icon-halo-bg: var(--sidebar-bg, var(--bg));
  --titlebar-surface-bg: var(--sidebar-bg, var(--bg));
  --paper-texture-surface: var(--sidebar-bg, var(--bg));
  position: fixed;
  isolation: isolate;
  top: var(--panel-edge-gap);       /* 6px */
  left: var(--panel-edge-gap);
  bottom: var(--panel-edge-gap);
  display: flex;
  flex-direction: column;
  border-radius: calc(var(--panel-card-radius) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  border: var(--panel-card-border);
  background: var(--sidebar-bg, var(--bg));
  box-shadow: 0 4px 32px #0000000d;
  overflow: hidden;
  z-index: 31;
}
```

**注意 `left: var(--panel-edge-gap)`**：它不是从右边对齐的。实际宽度由 JS 控制（`--fp-resize-left`），拖动把手用这个变量定位。

### 5.2 拖动把手

```css
._fpResizeHandle_cc543 {
  position: fixed;
  top: var(--panel-edge-gap);
  left: calc(var(--panel-edge-gap) + var(--fp-resize-left) + var(--panel-edge-gap) / 2);
  transform: translate(-50%);       /* 居中对齐到边缘 */
  bottom: var(--panel-edge-gap);
  cursor: col-resize;
  z-index: 30;                      /* 比浮层低 1，但在内容之上 */
  -webkit-app-region: no-drag;      /* 可以拖动 */
}
```

**宽度由 JS 通过 `--fp-resize-left` 注入**，不是 CSS 固定值。

### 5.3 收起状态

```css
._fpCollapsed_7bc13 {
  width: 0;
  margin-left: 0;
  margin-right: 0;
  opacity: 0;
  border-color: transparent;
  pointer-events: none;
}
```

---

## 六、层级（z-index）总表

| 层 | z-index | 元素 | 说明 |
|---|---|---|---|
| 应用根 | — | `_root_4a78b` | `isolation: isolate` |
| 左侧栏 | **2** | `_fp_f9c75` | 正常流内 |
| 画布 | — | `_canvas_4bffb` | `overflow: visible` |
| 卡片标题层 | **5** | `_tileTop_931a2` | 卡片内绝对定位 |
| 拖动把手 | **30** | `_fpResizeHandle_cc543` | fixed |
| 右侧浮层 | **31** | `_fpOverlay_1c4ff` | fixed |
| 窗口标题条带 | **32** | `_trafficStrip_e117f` | fixed，最高 |

**层级逻辑：**
1. 三栏卡片是基础层（z 2 及以下）
2. 卡片内的标题层浮在内容上（z 5）
3. 右侧浮层和拖动把手在卡片之上（z 30-31）
4. 窗口标题条带（含红绿灯避让、侧栏切换按钮）最高（z 32）

---

## 七、关键尺寸变量总表

| 变量 | 值 | 出处 | 用途 |
|---|---|---|---|
| `--sidebar-width` | **240px** | reference/styles.css | 侧栏宽度 |
| `--titlebar-h` | **44px** | reference/styles.css | 标题条高度 |
| `--window-titlebar-height` | 未在 CSS 定义（JS 注入） | — | 窗口标题条高度 |
| `--panel-edge-gap` | **6px** | reference/styles.css | 卡片外边距 |
| `--tile-gutter` | `calc(6px / 2)` = **3px** | ChatTranscript | 卡片内边距 |
| `--panel-card-radius` | `var(--radius-lg)` = **12px** | reference/styles.css | 卡片圆角基准 |
| `--corner-radius-scale` | **1.8408964152537137** | themes/continuous-corners.css | squircle 缩放系数 |
| `--card-top-inset` | `var(--panel-edge-gap)` = **6px** | ChatTranscript | 标题层内缩 |
| `--card-top-btn-size` | **24px** | ChatTranscript | 标题按钮尺寸 |
| `--card-top-btn-pad` | **2px** | ChatTranscript | 标题按钮内边距 |
| `--card-border-width` | **1px** | ChatTranscript | 卡片边框 |

**Windows 特殊规则：**

```css
html[data-platform="win32"] {
  --panel-card-radius: min(var(--radius-lg), 7px);   /* 封顶到 7px */
}
```

即 Windows 上卡片圆角是 `7px × 1.8409 = 12.89px`，Web 是 `12px × 1.8409 = 22.09px`。

---

## 八、布局的滚动模型

**这是最容易搞错的地方。**

### 8.1 各层的滚动职责

```
_root           overflow: hidden       ← 根不滚
  _fp           overflow: hidden       ← 侧栏卡片不滚（内部各段自己滚）
    _fpSidebarHost   内部滚动
  _canvas       overflow: visible      ← 画布不滚，允许卡片溢出
    _tileShell       overflow: hidden  ← 卡片壳裁切
      _tileContent   ← 内容区，由卡片自己决定滚不滚
  _fpOverlay    overflow: hidden       ← 浮层裁切，内部自己滚
```

### 8.2 卡片内容的滚动 + 渐隐

```css
/* 滚动容器上加 mask，内容在标题层高度内渐隐 */
.main-content:has(> [data-chat-title-mask]) [data-chat-selection-root],
.main-content:has(> [data-chat-title-mask]) [data-card-presentation-layer-host] {
  --chat-title-fade-span: 32px;
  --chat-title-scroll-mask: linear-gradient(
    to bottom,
    transparent 0,
    transparent var(--titlebar-h, 44px),        /* 标题层高度内完全透明 */
    rgba(0, 0, 0, .038) calc(var(--titlebar-h) + 32px * .125),
    rgba(0, 0, 0, .146) calc(var(--titlebar-h) + 32px * .25),
    rgba(0, 0, 0, .309) calc(var(--titlebar-h) + 32px * .375),
    rgba(0, 0, 0, .5)   calc(var(--titlebar-h) + 32px * .5),
    rgba(0, 0, 0, .691) calc(var(--titlebar-h) + 32px * .625),
    rgba(0, 0, 0, .854) calc(var(--titlebar-h) + 32px * .75),
    rgba(0, 0, 0, .962) calc(var(--titlebar-h) + 32px * .875),
    #000 calc(var(--titlebar-h) + 32px),
    #000 100%
  );
  -webkit-mask-image: var(--chat-title-scroll-mask);
  mask-image: var(--chat-title-scroll-mask);
  mask-repeat: no-repeat;
  mask-size: 100% 100%;
}
```

**8 段缓动曲线是关键**：不是线性渐变，是「慢入快出」，视觉上手感更自然。

### 8.3 标题遮罩的触发条件

```jsx
function ChatTitleMask() {
  const hasTitle = ...;
  return hasTitle
    ? <div className={chatTitleMask} data-chat-title-mask aria-hidden />
    : null;
}
```

这个 `div` 是**标记元素**，本身 `display: none`：

```css
._chatTitleMask_78e64 { display: none; }
```

它的唯一作用是让父级能用 `:has(> [data-chat-title-mask])` 判断「有没有标题」，从而决定是否加遮罩。

**这是一个很巧的 CSS 驱动方案：用不可见的标记元素 + `:has()` 做条件样式，不需要 JS 加类名。**

---

## 九、可拖动卡片系统（chalkboard）

右侧浮动区的内容是「可拖动卡片」，这是 Hana 的核心交互。

### 9.1 卡片的拖拽状态

```css
/* 拖动中的卡片 */
._tileBare_6ea80[data-dragging] {
  background-color: var(--panel-card-bg);
  border-color: var(--card-border-color, rgba(0, 0, 0, .08));
}

/* 拖拽把手的样式由 grabber 类控制 */
._grabber_... {
  /* 见 hge.grabber */
}
```

### 9.2 拖拽把手的行为（JSX 实测）

```jsx
<Grabber dragHandleRef={dragHandleRef}
         dragging={dragging}
         onContextMenu={(e) => {
           e.preventDefault();
           e.stopPropagation();
           setContextMenu({ x: e.clientX, y: e.clientY });   // 右键菜单
         }}>
  {isTabsGroup && <Tabs>...</Tabs>}
</Grabber>
```

右键菜单项：

```js
[
  { label: '移到主区域', action: () => moveTo(cardId, MAIN) },
  { label: '移到工作室', action: () => moveTo(cardId, STUDIO) },
  { label: '独立窗口', action: () => detach(false), disabled: !detachable },
  { label: '全屏',     action: () => detach(true),  disabled: !detachable },
]
```

### 9.3 卡片的状态属性（data-*）

卡片壳用大量 `data-*` 属性驱动样式，而不是 className：

```jsx
<section data-surface={surface}                    // 'card' | 'bare'
         data-titlebar-mode={titlebarMode}          // 'solid' | 'translucent' | ...
         data-card-body-form={bodyForm}             // 'framed' | 'self-framed' | ...
         data-card-chrome-layout={chromeLayout}
         data-card-scrolled={scrolled || undefined}
         data-has-title={hasTitle || undefined}
         data-has-custom-title-segment={customSegment ? true : undefined}
         data-titlebar-self-drawn={selfDrawn || undefined}
         data-chipless={chipless || undefined}
         data-bleed={bleed || undefined}
         data-entering={entering || undefined}
         data-dragging={dragging || undefined}>
```

**这是 Hana 的样式驱动哲学：状态用 `data-*`，样式用属性选择器，className 只负责「这是什么组件」。**

对比 moheng 现状：全部用 className 切换（`is-active`、`is-open`），样式散在全局 CSS 里。

---

## 十、与 moheng 现状的对照

| 维度 | Hana | moheng 现状 | 差距 |
|---|---|---|---|
| 根结构 | `_root` flex row，三块卡片并列 | `.app-shell` flex column + `.app` flex row | ⚠️ 结构近似但层级不同 |
| 侧栏 | 独立浮动卡片，`margin: 6px` + squircle | `.app-sidebar` 全局类，有 border/shadow | ⚠️ 视觉近似 |
| 中间区 | `canvas` + `pageStage` + `tileShell` 三层 | `.app-content` + `.route-transition` 两层 | ❌ 缺 tileShell 层 |
| 卡片标题 | `tileTop` absolute + 透明 + 内容穿过 | `.app-titlebar` absolute + 透明 | ✅ 概念一致 |
| 右侧浮动区 | `fpOverlay` fixed + 拖动把手 | 无 | ❌ 缺 |
| 窗口标题条 | `windowTitlebar` + `trafficStrip`（z-32） | 无（Web 端不需要） | — |
| 状态表达 | `data-*` 属性选择器 | className 切换 | ❌ 范式不同 |
| 滚动模型 | 卡片壳不滚、内容容器滚 | 已改为卡片壳 `overflow: hidden` + `.route-transition` 滚 | ✅ 已对齐 |
| 渐隐遮罩 | `mask-image` + 8 段曲线 | 已实现同款 | ✅ 已对齐 |

---

## 十一、移植建议（按依赖顺序）

### 第一优先：补 tileShell 层

现在 moheng 是 `.app-content` 直接装内容，缺了「卡片壳」这一层。补上后：

```
.app-content          → 相当于 canvas（不滚，overflow: hidden）
  .route-transition   → 相当于 tileShell（圆角 + squircle + 裁切）
    <内容>             → 自己滚 + mask
```

**这一步不改变视觉（因为现在 .app-content 已经有圆角），但让结构与 Hana 对齐，后续才能加右侧浮动区。**

### 第二优先：状态表达改为 data-*

把 `is-active`、`is-open` 这类 className 换成 `data-active`、`data-open`，样式用属性选择器。

**理由**：className 切换会导致「一个元素上堆 5 个状态类」，且 CSS 选择器要写组合。`data-*` 更清晰，也更容易和 JS 状态对齐。

### 第三优先：右侧浮动区

`fpOverlay` + `fpResizeHandle` + 卡片拖拽。这是最大的一块，需要：

- 浮层的开合状态管理
- 拖动把手的 `--fp-resize-left` 注入
- 卡片在「主区域 / 浮动区」之间的迁移
- 卡片的独立窗口（Electron 才需要）

### 不建议移植的

| 组件 | 原因 |
|---|---|
| `windowTitlebar` + `trafficStrip` | Electron 专用，Web 端无意义（桌面端才需要） |
| `fpTrafficRow` | macOS 红绿灯避让，Windows 不同 |
| 卡片独立窗口（detach） | Electron 多窗口能力，Web 做不到 |
| 多标签组（TabsGroup） | Hana 的卡片可以合并成 tab 组，moheng 业务页面没有这个需求 |

---

## 十二、待补充（下一轮）

本次已挖到：

- ✅ 根结构、三栏层级、z-index 总表
- ✅ 侧栏完整结构（贴纸行 / 功能按钮 / 会话目录 / 页脚）
- ✅ 中间区三层（canvas / pageStage / tileShell）
- ✅ 卡片壳的两种形态 + 标题层 absolute 设计
- ✅ 右侧浮动区 + 拖动把手
- ✅ 滚动模型 + 渐隐遮罩
- ✅ 关键尺寸变量

**还没挖透的：**

- ⬜ `tileTop` 内部 `TitlebarRenderer` 的完整结构（左操作/标题段/右操作的布局细节）
- ⬜ 侧栏「贴纸行」的完整交互（`fpPrimaryAgentSticker` 的显隐逻辑）
- ⬜ 卡片的拖放区域（`DropZone`）如何计算落点
- ⬜ 卡片迁移到浮动区时的动画（`slideEnterFromRight` 等）
- ⬜ `panelMenu` / `panelMenuItem`（卡片右键菜单）的完整样式

---

## 附录 A：布局相关类名全表

完整 793 条映射见 `docs/hana-layout-classmap.json`。以下是布局核心的 60 条：

| 变量名 | 类名 | 含义 |
|---|---|---|
| `root` | `_root_4a78b` | 应用根 |
| `windowTitlebarFrame` | `_windowTitlebarFrame_f6591` | 窗口标题条容器 |
| `windowTitlebar` | `_windowTitlebar_4b3c7` | 窗口标题条 |
| `fp` | `_fp_f9c75` | 左侧栏卡片 |
| `fpCollapsed` | `_fpCollapsed_7bc13` | 侧栏收起态 |
| `fpTrafficRow` | `_fpTrafficRow_5ddeb` | 窗控避让行 |
| `fpPrimaryAgentRow` | `_fpPrimaryAgentRow_18788` | 贴纸行 |
| `fpPrimaryAgentSticker` | `_fpPrimaryAgentSticker_1a144` | 贴纸 |
| `fpWorkspaceTitle` | `_fpWorkspaceTitle_915c0` | 工作区标题 |
| `fpSidebarHost` | `_fpSidebarHost_09f83` | 侧栏主体 |
| `fpOverlay` | `_fpOverlay_1c4ff` | 右侧浮动区 |
| `fpOverlayInner` | `_fpOverlayInner_ec97a` | 浮动区内部 |
| `fpResizeHandle` | `_fpResizeHandle_cc543` | 拖动把手 |
| `canvas` | `_canvas_4bffb` | 中间画布 |
| `pageStage` | `_pageStage_82400` | 页面舞台 |
| `pageSurface` | `_pageSurface_998e1` | 页面表面（空态） |
| `pagePane` | `_pagePane_ef337` | 页面面板 |
| `tileShell` | `_tileShell_3a897` | 卡片壳 |
| `tileCard` | `_tileCard_1790b` | 实心卡片形态 |
| `tileBare` | `_tileBare_6ea80` | 裸卡形态 |
| `tileTop` | `_tileTop_931a2` | 卡片标题层 |
| `tileContent` | `_tileContent_d5e2b` | 卡片内容层 |
| `tileTopBtn` | `_tileTopBtn_8667c` | 卡片标题按钮 |
| `titlebarFrame` | `_titlebarFrame_29cb1` | 标题内容网格 |
| `titlebarActionIsland` | `_titlebarActionIsland_d8891` | 标题操作岛 |
| `trafficStrip` | `_trafficStrip_e117f` | 窗控条带 |
| `windowControlsIsland` | `_windowControlsIsland_5f7ae` | 窗控按钮区 |
| `sdbBtn` | `_sdbBtn_e792e` | 侧栏切换按钮 |
| `chatTitleBar` | `_chatTitleBar_9cebe` | 卡片标题栏 |
| `chatTitleStack` | `_chatTitleStack_8d851` | 标题栈 |
| `chatTitleText` | `_chatTitleText_f1adb` | 标题文字 |
| `chatTitleStatus` | `_chatTitleStatus_b7fb5` | 状态段 |
| `chatTitleStatusDot` | `_chatTitleStatusDot_2f4dd` | 状态圆点 |
| `chatTitleMask` | `_chatTitleMask_78e64` | 标题遮罩标记 |
| `panel` | `_panel_e39aa` | 面板 |
| `separator` | `_separator_704ed` | 分隔条 |
| `grabber` | `_grabber_...` | 拖拽把手 |

## 附录 B：复现命令

```bash
# 提取类名映射表
node scripts/_extract-classmap-full.mjs

# 定位布局类所在 CSS 文件
node scripts/_locate-layout-css.mjs

# 提取三栏骨架
node scripts/_extract-three-columns2.mjs

# 提取卡片壳 JSX
node scripts/_extract-cardshell-jsx.mjs

# 提取 fp 结构
node scripts/_extract-fp2.mjs
```
