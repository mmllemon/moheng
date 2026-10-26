# Hana 侧栏动画与全页联动机制

> 本文是 [Hana桌面端界面结构拆解](Hana桌面端界面结构拆解.md) 的续篇，专门拆解**动画系统**。
> 所有结论来自源码实测。日期：2026-10-23
>
> 源码：
> - `contributed-keybindings-BWxnaFR2.js`（侧栏实现主文件）
> - `AnimationPrimitives-O85oXpjE.js`（动画原语与 spring 参数）
> - `ChatTranscript-DhOABhoU.css`、`reference/hana-1.1.35/styles.css`

---

## 一、最重要的结论：侧栏是「双态渲染」，不是单一动画

人眼看到的「侧栏收起 / 打开」实际是**两套独立的 DOM 状态**：

```
状态 A：侧栏展开（in-flow aside）
  ├─ 占位：width: 240px，flex-shrink: 0
  ├─ 有 resize handle
  └─ 画布被挤窄（flex 自然响应）

状态 B：侧栏收起（out-of-flow overlay）
  ├─ aside 加 fpCollapsed → width: 0, opacity: 0, pointer-events: none
  └─ 另起一个 fpOverlay（position: fixed）覆盖在画布上
     悬停时才显示，鼠标离开 300ms 后自动隐藏
```

**这不是「一个元素宽度从 240 变 0」那么简单。** 收起之后，交互模型整个换了：从「占据空间的侧栏」变成「悬浮的抽屉」。

### 1.1 源码证据

```js
// contributed-keybindings-BWxnaFR2.js

// 主侧栏 aside（展开态）
<aside className={[v.fp, collapsed ? v.fpCollapsed : '', landing ? v.fpShadowless : '']
                  .filter(Boolean).join(' ')}
       data-titlebar-mode={collapsed ? undefined : 'solid'}
       data-fp-expanded={collapsed ? undefined : ''}
       data-fp-landing={landing ? '' : undefined}
       style={collapsed ? undefined : { width }}>
  {backdrop}
  <div className={v.fpTrafficRow} />
  {renderContent(width)}
  {!collapsed && topRightAction}
</aside>

// resize handle 只在展开态存在
{!collapsed && (
  <div className={v.fpResizeHandle}
       data-fp-resize-handle
       style={{ '--fp-resize-left': `${width}px`, width: `${Ba()}px` }}
       onPointerDown={drag.onPointerDown} />
)}

// 收起态：悬浮抽屉（AnimatePresence）
<AnimatePresence custom={{ collapsed, slide: width + 12 }}>
  {overlayVisible && (
    <motion.div className={v.fpOverlay}
                data-titlebar-mode="solid"
                style={{ width }}
                custom={{ collapsed, slide: width + 12 }}
                variants={overlayVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={motion.paperGentle}
                data-fp-overlay-shell>
      {backdrop}
      <OverlayContent width={width} collapsed={collapsed}
                      onOverlayVisibleChange={setOverlayVisible}
                      renderContent={renderContent}
                      getOverlayTriggerRect={getTriggerRect} />
    </motion.div>
  )}
</AnimatePresence>
```

---

## 二、宽度变化的动画（展开 ↔ 收起）

### 2.1 CSS 层

```css
/* 侧栏卡片本体 */
._fp_f9c75 {
  transition: width var(--chalkboard-motion-duration-space) var(--chalkboard-motion-ease-ios),
              margin var(--chalkboard-motion-duration-space) var(--chalkboard-motion-ease-ios),
              opacity var(--chalkboard-motion-duration-space) var(--chalkboard-motion-ease-ios),
              border-color var(--chalkboard-motion-duration-space) var(--chalkboard-motion-ease-ios);
}

/* 收起态 */
._fpCollapsed_7bc13 {
  width: 0;
  margin-left: 0;
  margin-right: 0;
  opacity: 0;
  border-color: transparent;
  pointer-events: none;
}
```

### 2.2 动效 token 真值

```css
/* ChatTranscript-DhOABhoU.css */
--chalkboard-motion-ease-ios:    cubic-bezier(.22, 1, .36, 1);
--chalkboard-motion-ease-return: cubic-bezier(.16, 1, .3, 1);
--chalkboard-motion-ease-exit:   cubic-bezier(.5, 0, .75, 0);

--chalkboard-motion-duration-space:   .4s;    /* ← 侧栏宽度变化用这个 */
--chalkboard-motion-duration-page:    .36s;
--chalkboard-motion-duration-enter:   .22s;
--chalkboard-motion-duration-exit:    .2s;
--chalkboard-motion-duration-reorder: .52s;
--chalkboard-motion-duration-lift-shadow: .3s;
--chalkboard-motion-duration-lift-scale:  .28s;
```

**`.4s` + `cubic-bezier(.22, 1, .36, 1)`** 是侧栏宽度的组合。

这个 bezier 的特点：前段快速启动，后段极慢收尾（`y2 = 1` 表示终点无过冲）。手感是「推出去很快，停下来很缓」。

### 2.3 为什么用 `.4s` 而不是 `--duration-slow`（.25s）

因为侧栏宽度变化是**大位移**（240px → 0），`.25s` 会显得突兀。`.4s` 让 240px 的位移有足够时间被眼睛跟上。

对比：

| 动效 | 时长 | 位移量 | 用途 |
|---|---|---|---|
| `--duration-slow` | .25s | 小 | 颜色、边框 |
| `--chalkboard-motion-duration-space` | **.4s** | **240px** | 侧栏宽度、画布重排 |
| `--chalkboard-motion-duration-page` | .36s | 中 | 页面切换 |
| `--chalkboard-motion-duration-reorder` | .52s | 中 | 卡片重排 |

---

## 三、画布与舞台如何跟随（这是你最关心的「整页联动」）

### 3.1 核心机制：CSS 变量 + flex 自然响应

```js
// 侧栏宽度变化时，同步写入根元素的 CSS 变量
document.documentElement.style.setProperty('--bridge-panel-left', `calc(var(--panel-edge-gap, 6px) * 2 + ${width}px)`);
```

```js
const Ut = '--bridge-panel-left';

function toBridgePanelLeft(width) {
  return `calc(var(--panel-edge-gap, 6px) * 2 + ${width}px)`;
}
```

### 3.2 画布不需要动画，它靠 flex 自动跟随

**这是关键认知：`_canvas_4bffb` 和 `_tileShell_3a897` 都没有 `transition`。**

实测：

```
[_canvas_4bffb]    → (无 transition)
[_tileShell_3a897] → (无 transition)
[_fp_f9c75]        → transition: width .4s ...  ← 只有侧栏有
```

原因是：侧栏是 `flex-shrink: 0` 的固定宽度项，画布是 `flex: 1`。侧栏宽度在 `.4s` 内连续变化，画布的 `flex: 1` 会**每一帧重新计算剩余空间**，所以画布自动跟着变宽变窄。

**不需要给画布加 transition —— 加了反而会双重动画（侧栏动画 + 画布自己的动画），导致不同步。**

### 3.3 但有些元素需要绝对定位跟随

```css
/* CapabilitiesPanel：浮动面板要跟着侧栏走 */
._bridgePanelWide_3f400 {
  left: var(--bridge-panel-left, var(--sidebar-width));
  align-items: flex-end;
  padding-bottom: calc(...);
}

._stagePanel_ea0d9 {
  left: var(--bridge-panel-left, var(--sidebar-width));
  align-items: stretch;
  padding: var(--space-24) var(--space-24);
}
```

**`left: var(--bridge-panel-left, var(--sidebar-width))`** —— 用变量 + 兜底值。

兜底是必要的：变量只在侧栏存在时由 JS 注入，某些场景（如侧栏完全卸载）需要 `--sidebar-width: 240px` 作为后备。

### 3.4 正文列的对齐

```css
/* 卡片标题层的左对齐，跟随正文列 */
._tileShell_3a897[data-tile-id=wb-home-chat-tile][data-has-custom-title-segment] ._titlebarFrame_29cb1 {
  --chat-copy-edge: calc(
    max(var(--space-24), calc((100% - var(--chat-copy-column, var(--chat-column-width))) / 2))
    + var(--space-8)
    + var(--space-2)
  );
  grid-template-columns: minmax(0, 1fr) auto;
  padding-left: max(var(--chat-copy-edge), calc(var(--ttb-clearance, 0px) + var(--space-12)));
}
```

`--chat-copy-edge` = 「正文列左边缘」= `max(24px, (容器宽 - 720px)/2) + 8px + 2px`。

**这解释了为什么侧栏展开/收起时，卡片标题会自动对齐到正文列 —— 因为 `100%` 是卡片宽度，卡片宽度随画布变化，所以整个计算链自动响应。**

---

## 四、悬停抽屉（鼠标移到边缘自动弹出）

### 4.1 触发逻辑（源码）

```js
function OverlayContent({ width, collapsed, onOverlayVisibleChange, renderContent, getOverlayTriggerRect }) {
  const overlayRef = useRef(null);
  const timerRef = useRef(null);
  const collapsedRef = useRef(collapsed);
  const onChangeRef = useRef(onOverlayVisibleChange);
  collapsedRef.current = collapsed;
  onChangeRef.current = onOverlayVisibleChange;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // 全局监听鼠标移动
  useEffect(() => {
    const onMouseMove = (event) => {
      if (!collapsedRef.current) {      // 只在收起态生效
        clearTimer();
        return;
      }

      const triggerRect = getOverlayTriggerRect();   // 触发区（通常是那个小按钮）
      const inTrigger = triggerRect !== null
        && event.clientX >= triggerRect.left && event.clientX <= triggerRect.right
        && event.clientY >= triggerRect.top && event.clientY <= triggerRect.bottom;

      const overlayRect = overlayRef.current?.getBoundingClientRect();
      const inOverlay = !!overlayRect
        && event.clientX >= overlayRect.left && event.clientX <= overlayRect.right
        && event.clientY >= overlayRect.top && event.clientY <= overlayRect.bottom;

      if (inTrigger || inOverlay) {     // 在触发区或抽屉内 → 保持
        clearTimer();
        return;
      }

      // 都不在 → 300ms 后关闭
      if (timerRef.current === null) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (collapsedRef.current) onChangeRef.current(false);
        }, 300);                        // rc = 300
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  return (
    <aside ref={overlayRef} className={styles.fpOverlayInner}
           data-fp-overlay data-session-drag-home>
      <div className={styles.fpOverlayTopSpacer} />
      {renderContent(width)}
    </aside>
  );
}
```

**关键参数：**

| 参数 | 值 | 含义 |
|---|---|---|
| 关闭延迟 | **300ms** | 鼠标离开触发区和抽屉后，等 300ms 才关 |
| 触发区 | 由 `getOverlayTriggerRect()` 返回 | 通常是「恢复侧栏」按钮的矩形 |
| 保活条件 | 在触发区内 **或** 在抽屉内 | 两者任一命中都不关 |

**300ms 的设计意图**：鼠标从按钮移到抽屉的路径上，可能会短暂离开两个区域。300ms 足够跨过这个缝隙，不会闪断。

### 4.2 抽屉的进出场动画（motion variants）

```js
const overlayVariants = {
  hidden: (custom) => ({
    x: -custom.slide,          // slide = width + 12
    opacity: 0.5,
  }),
  visible: {
    x: 0,
    opacity: 1,
  },
  exit: (custom) => custom.collapsed
    ? { x: -custom.slide, opacity: 0, transition: motion.paperGentle }
    : { x: 0, opacity: 1, transition: { duration: 0 } },
};
```

**`slide = width + 12`** —— 位移量是侧栏宽度 + 12px。12px 是额外的「滑出余量」，确保完全移出视野。

### 4.3 paperGentle 是 spring，不是 CSS transition

```js
// AnimationPrimitives-O85oXpjE.js
const paper =       { type: 'spring', stiffness: 500, damping: 34, mass: 0.8 };
const paperGentle = { type: 'spring', stiffness: 350, damping: 32, mass: 1 };
const paperSnap =   { type: 'spring', stiffness: 600, damping: 40, mass: 0.6 };
const pop =         { type: 'spring', stiffness: 600, damping: 31, mass: 0.6 };

const motion = { paper, paperGentle, paperSnap, pop };
```

**`paperGentle` = `stiffness: 350, damping: 32, mass: 1`**

这是 Framer Motion 的物理 spring 参数。换算成 CSS，阻尼比 ζ 约为：

```
ω₀ = √(k/m) = √350 ≈ 18.7 rad/s
ζ  = c / (2√(km)) = 32 / (2 × √350) ≈ 0.855
```

**ζ ≈ 0.855 < 1，是欠阻尼（有轻微回弹）。** 这与 CSS 的 `cubic-bezier` 本质不同：spring 是物理模拟，会先冲过头再回弹；bezier 是固定曲线，不会过冲。

### 4.4 为什么侧栏宽度用 CSS transition，抽屉用 spring

| | 侧栏宽度（in-flow） | 抽屉（overlay） |
|---|---|---|
| 实现 | CSS `transition` | Framer Motion spring |
| 曲线 | `cubic-bezier(.22, 1, .36, 1)` | `stiffness 350 / damping 32` |
| 原因 | 宽度变化要**精确可预测**，不能过冲（会露出内容） | 位移变化可以**有轻微回弹**，更有「纸张弹出」的质感 |

**这是有意区分：占位元素不能过冲（会导致布局抖动），浮动元素可以。**

---

## 五、整页联动的完整时序

### 5.1 展开 → 收起

```
t=0ms    用户点「收起」按钮
         ├─ React state: collapsed = true
         └─ aside 加 class fpCollapsed
            ├─ width: 240px → 0
            ├─ opacity: 1 → 0
            └─ pointer-events: auto → none

t=0~400ms  CSS transition 运行（.4s, cubic-bezier(.22,1,.36,1)）
         ├─ 侧栏宽度连续变化
         ├─ 画布（flex: 1）每帧重算 → 自动变宽
         ├─ 卡片（100% 宽度）跟着变宽
         ├─ 卡片标题的 --chat-copy-edge 跟着重算 → 标题位置自动对齐
         └─ resize handle 被卸载（!collapsed 条件）

t=400ms  onTransitionEnd 触发
         ├─ propertyName === 'width' 时
         ├─ 调用 onWidthTransitioning(false)
         └─ 若 overlayVisible 则关闭 overlay

之后     「恢复」按钮出现在 trafficStrip 里
         鼠标移入该按钮 → overlayVisible = true
         → AnimatePresence 挂载 fpOverlay
         → spring 动画滑入（x: -(width+12) → 0）
```

### 5.2 收起 → 展开

```
t=0ms    用户点「恢复」按钮（在 trafficStrip 里）
         ├─ React state: collapsed = false
         ├─ overlayVisible = false（抽屉关闭）
         └─ aside 移除 fpCollapsed
            ├─ width: 0 → 240px
            └─ opacity: 0 → 1

t=0~400ms  同上，画布反向变窄

t=400ms  onTransitionEnd
         └─ resize handle 重新挂载
```

### 5.3 关键：`onTransitionEnd` 只在 `propertyName === 'width'` 时处理

```js
onTransitionEnd={(event) => {
  if (event.target !== event.currentTarget) return;   // 忽略子元素冒泡
  if (event.propertyName !== 'width') return;         // 只关心 width
  onWidthTransitioning(false);
  if (!collapsed && overlayVisible) onOverlayVisibleChange(false);
}}
```

**为什么要过滤 `propertyName`**：侧栏同时 transition 了 `width`、`margin`、`opacity`、`border-color` 四个属性，会触发 4 次 `transitionend`。只处理 `width` 那一次，避免重复回调。

**为什么要过滤 `event.target`**：子元素（按钮、文字）的 transition 会冒泡上来，必须排除。

---

## 六、侧栏内部的其他动画

### 6.1 导航项的「拾起」效果（lift-pickup）

```css
@keyframes _fp-nav-lift-pickup_0d7ff {
  0%   { background-color: transparent; box-shadow: none; }
  to   { background-color: var(--bg); box-shadow: var(--fp-nav-lift-shadow); }
}

@keyframes _session-list-lift-pickup_2ae29 {
  0%   { background-color: transparent; box-shadow: none; }
  to   { background-color: var(--bg); box-shadow: var(--session-lift-shadow); }
}

/* 已选中态的拾起（起始背景不同） */
@keyframes _session-list-lift-pickup-active_bf6b3 {
  0%   { background-color: color-mix(in srgb, var(--text) 6%, transparent); box-shadow: none; }
  to   { background-color: var(--bg); box-shadow: var(--session-lift-shadow); }
}
```

**这是拖拽时的「拿起」效果**：元素从透明无阴影 → 实心背景 + 投影，视觉上「被拎起来」。

### 6.2 树形分组展开/收起

```css
@keyframes _tree-group-expand_874aa {
  0%   { grid-template-rows: 0fr; opacity: 0; }
  to   { grid-template-rows: 1fr; opacity: 1; }
}

@keyframes _tree-group-collapse_e11ba {
  0%   { grid-template-rows: 1fr; opacity: 1; }
  to   { grid-template-rows: 0fr; opacity: 0; }
}
```

**用 `grid-template-rows: 0fr → 1fr` 做高度动画**，这是现代 CSS 的标准做法：不需要知道具体高度，也不需要 JS 测量。

### 6.3 会话折叠（圆形裁剪）

```css
@keyframes _convoCollapse_36352 {
  0%   { clip-path: circle(var(--collapse-r) at var(--collapse-x) var(--collapse-y)); opacity: 1; }
  55%  { opacity: 1; }
  to   { clip-path: circle(14px at var(--collapse-x) var(--collapse-y)); opacity: 0; }
}

@keyframes _convoMaskGrow_5a7f2 {
  0%   { clip-path: circle(0px at var(--mask-x) var(--mask-y)); }
  to   { clip-path: circle(var(--mask-r) at var(--mask-x) var(--mask-y)); }
}
```

**用 `clip-path: circle()` 从点击位置「收成一个点」**，坐标由 JS 注入（`--collapse-x`、`--collapse-y`）。这是「从点击处消失」的高级实现。

---

## 七、动效 token 完整表

### 7.1 基础时长

```css
--duration-instant: 0.1s
--duration-fast:    0.15s
--duration-slow:    0.25s
--duration-spinner: 0.8s
```

### 7.2 缓动曲线

```css
--ease-out:      cubic-bezier(0.16, 1, 0.3, 1)
--ease-in:       cubic-bezier(0.7, 0, 0.84, 0)
--ease-standard: cubic-bezier(0.2, 0, 0, 1)
--ease-smooth:   cubic-bezier(0.22, 0.68, 0, 1)
```

### 7.3 纸张动效（Hana 特有）

```css
--duration-paper-spring:      0.172s
--duration-paper-spring-fade: 0.069s
--duration-paper-exit:        0.12s
--ease-paper-spring: linear(0, 0.01, 0.036, 0.075, 0.125, 0.182, 0.244, 0.309, 0.375, 0.441, 0.506, 0.568, 0.627, 0.682, 0.733, 0.78, 0.823, 0.862, 0.896, 0.925, 0.951, 0.974, 0.992, 1.008, 1.02, 1.03, 1.038, 1.043, 1.047, 1.049, 1.05, 1.05, 1.049, 1.047, 1.045, 1.042, 1.039, 1.036, 1.032, 1.029, 1.026, 1.022, 1.019, 1.017, 1.014, 1.012, 1.009, 1.007, 1)
--ease-paper-exit: cubic-bezier(0.4, 0, 1, 1)
```

**`--ease-paper-spring` 是一条 50 个关键点的 `linear()` 曲线**，模拟 spring 的过冲回弹（注意值先到 1.05 再回落）。

这是 CSS `linear()` 函数（Chrome 113+）实现 spring 曲线的方式，不需要 JS。

### 7.4 chalkboard 空间动效

```css
--chalkboard-motion-ease-ios:    cubic-bezier(.22, 1, .36, 1)
--chalkboard-motion-ease-return: cubic-bezier(.16, 1, .3, 1)
--chalkboard-motion-ease-exit:   cubic-bezier(.5, 0, .75, 0)

--chalkboard-motion-duration-space:   .4s    /* 侧栏宽度、空间重排 */
--chalkboard-motion-duration-page:    .36s
--chalkboard-motion-duration-enter:   .22s
--chalkboard-motion-duration-exit:    .2s
--chalkboard-motion-duration-reorder: .52s
--chalkboard-motion-duration-lift-shadow: .3s
--chalkboard-motion-duration-lift-scale:  .28s
--chalkboard-motion-duration-detach-fade: .22s

--chalkboard-motion-lift-intro-scale: .985
--chalkboard-motion-flip-min: .16s
--chalkboard-motion-flip-max: .42s
--chalkboard-motion-flip-resize: .3s
--chalkboard-motion-flip-px-factor: .58
--chalkboard-motion-lift-return-min: .24s
--chalkboard-motion-lift-return-max: .52s
--chalkboard-motion-lift-return-px-factor: .72
```

### 7.5 Framer Motion spring 参数

| 名称 | stiffness | damping | mass | ζ（阻尼比） | 用途 |
|---|---|---|---|---|---|
| `paper` | 500 | 34 | 0.8 | ≈ 0.85 | 标准纸张动效 |
| **`paperGentle`** | **350** | **32** | **1** | **≈ 0.855** | **抽屉进出** |
| `paperSnap` | 600 | 40 | 0.6 | ≈ 0.82 | 快速吸附 |
| `pop` | 600 | 31 | 0.6 | ≈ 0.63 | 弹跳（回弹明显） |

---

## 八、与 moheng 现状的差距

| 维度 | Hana | moheng 现状 | 差距 |
|---|---|---|---|
| 侧栏开合 | 双态渲染（in-flow / overlay） | 单一宽度变化 | ❌ 缺抽屉态 |
| 悬停抽屉 | 300ms 延迟 + 触发区判断 | 无 | ❌ 缺 |
| 宽度动画 | `.4s` + `cubic-bezier(.22,1,.36,1)` | `--duration-slow` (.25s) | ⚠️ 时长偏短 |
| 画布跟随 | flex 自然响应（无 transition） | 同样 flex 响应 | ✅ 一致 |
| 空间变量 | `--bridge-panel-left` | 无 | ❌ 缺 |
| 抽屉动画 | Framer Motion spring | 无 | ❌ 缺 |
| 树形展开 | `grid-template-rows: 0fr→1fr` | 未确认 | ❓ |
| 圆形裁剪收起 | `clip-path: circle()` | 无 | ❌ 缺 |

---

## 九、移植建议

### 9.1 分三步，不要一次做完

**第一步：时长与曲线对齐（10 分钟，零风险）**

```diff
- transition: width var(--duration-slow) var(--ease-out), ...
+ transition: width var(--chalkboard-motion-duration-space) var(--chalkboard-motion-ease-ios), ...
```

先补 token：

```css
--chalkboard-motion-duration-space: .4s;
--chalkboard-motion-ease-ios: cubic-bezier(.22, 1, .36, 1);
```

**收益**：侧栏开合的手感立刻接近 Hana。不需要改结构。

**第二步：补 `--bridge-panel-left` 变量（半天）**

```ts
// 侧栏宽度变化时
document.documentElement.style.setProperty(
  '--bridge-panel-left',
  `calc(var(--panel-edge-gap, 6px) * 2 + ${width}px)`
);
```

让需要绝对定位跟随侧栏的元素（浮动面板、命令面板）用这个变量，而不是硬编码。

**第三步：悬停抽屉（2-3 天，工作量最大）**

需要实现：
1. 收起态时，aside 保持 `width: 0`（不卸载）
2. 另起 `fpOverlay`（fixed），宽度 = 侧栏宽度
3. 全局 `mousemove` 监听，判断是否在触发区/抽屉内
4. 300ms 延迟关闭
5. spring 动画进出场

**这一步建议用 CSS transition 而非 Framer Motion**，理由：moheng 没有引入 motion 库，为一个抽屉引入整库不划算。用 `transform: translateX()` + `transition` 能达到 90% 的效果。

### 9.2 一个必须注意的陷阱

**不要在画布上加 `transition`。**

```css
/* ❌ 错误：会与侧栏动画打架 */
.app-content { transition: width .4s; }

/* ✅ 正确：靠 flex 自然跟随 */
.app-content { flex: 1; }
```

侧栏宽度每帧变化，画布 flex 每帧重算，本身就是连续的。加 transition 会导致画布「滞后」于侧栏，视觉上脱节。

---

## 十、待补充

- ⬜ `getOverlayTriggerRect()` 的内部实现（触发区元素由 `ki()` 提供，`ki` 经 `index-DEPTMosq.js` 间接导出，压缩过深未能追到底）
- ✅ resize handle 宽度：`kn = { coarse: 44, fine: 24 }`，触摸设备用 coarse
- ⬜ 卡片在侧栏与浮动区之间迁移的动画（`slideEnterFromRight` 等）
- ⬜ 侧栏内「会话列表」的拖拽重排动画
- ⬜ `--session-lift-shadow` 与 `--fp-nav-lift-shadow` 的具体值

### 关于触发区的已确认信息

```js
// 侧栏组件里定义
a = () => ki()?.getBoundingClientRect() ?? { left: 0, top: 0, right: xi, bottom: wi };
```

**触发区 = `ki()` 返回元素的实际矩形**（通常是 trafficStrip 里的「恢复侧栏」按钮）。
拿不到时回退到左上角一个小区域（`xi` / `wi` 是屏幕尺寸常量）。

另一个与侧栏相关的宽度常量：

```js
const kn = { coarse: 44, fine: 24 };   // resize handle 宽度
function Ba() { return sa() ? kn.coarse : kn.fine; }   // sa() = 是否触摸设备
```

即：resize handle 在触摸设备上 44px（手指宽度），鼠标设备 24px。

---

## 附录：源码定位速查

| 内容 | 文件 | 关键标识 |
|---|---|---|
| 侧栏 aside 渲染 | `contributed-keybindings-BWxnaFR2.js` | `className: [v.fp, t ? v.fpCollapsed` |
| 抽屉触发逻辑 | 同上 | `function oc({ width: e, collapsed: t` |
| 动画变体 | 同上 | `const ic = { hidden:` |
| 宽度写入变量 | 同上 | `setProperty(Ut, Oa(N))` |
| `Ut` / `Oa` | 同上 | `const Ut = "--bridge-panel-left"` |
| spring 参数 | `AnimationPrimitives-O85oXpjE.js` | `const nx = { type: "spring"` |
| 侧栏 CSS | `ChatTranscript-DhOABhoU.css` | `._fp_f9c75{` |
| 动效 token | `ChatTranscript-DhOABhoU.css` | `--chalkboard-motion-` |
| lift-pickup | `contributed-keybindings-CrbwCl0w.css` | `@keyframes _fp-nav-lift-pickup_0d7ff` |
| 树形展开 | `CardShell-B3PSoerL.css` | `@keyframes _tree-group-expand_874aa` |
| 圆形收起 | `CapabilitiesPanel-Y4qMszTt.css` | `@keyframes _convoCollapse_36352` |
