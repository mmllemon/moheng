# 适配 Windows 圆角：从「删掉功能」到「做成开关」

> 修正一个错误决定：把用户可选的偏好当成硬编码删掉了。
> 完成日期：2026-10-23。

## 1. 我犯的错

上一轮你说「Web 观感」，我的做法是：

```diff
- html[data-platform="win32"]:not([data-windows-card-radius="off"]) {
-   --panel-card-radius: min(var(--radius-lg), 7px);
- }
```

```diff
- document.documentElement.dataset.platform = isWin ? 'win32' : ...;
```

**直接删除了规则和平台标记。**

问题在于：`data-windows-card-radius="off"` 这个属性名本身就说明，
Hana 把它做成了一个**用户可切换的开关**。我却把整个功能砍了，
用户从此只能用一种观感。

## 2. Hana 的真实实现

### 文案（locales/zh.json）

```json
"windowsCardRadius": {
  "title": "适配 Windows 圆角",
  "description": "在 Windows 上使用较小的卡片圆角。"
}
```

位于 `settings.experiments`（实验）分组，标注 **Beta · 低风险 · 立即生效**。

### 逻辑（App-CfhKQJ81.js）

```js
// 平台判断
function isWin32() {
  return document.documentElement.getAttribute('data-platform') === 'win32';
}

// 应用开关
function applyWindowsCardRadius(enabled) {
  enabled === false
    ? document.documentElement.setAttribute('data-windows-card-radius', 'off')
    : document.documentElement.removeAttribute('data-windows-card-radius');
}

// 默认值
useEffect(() => {
  if (!isWin32()) {
    document.documentElement.removeAttribute('data-windows-card-radius');
    return;
  }
  applyWindowsCardRadius(true);   // ← Windows 上默认启用封顶
  // 之后监听实验事件覆盖
}, []);
```

**属性语义（与直觉相反，要注意）：**

| `data-windows-card-radius` | 含义 | 圆角 |
| --- | --- | --- |
| `"off"` | 关闭封顶 | 12px × 1.8409 ≈ **22.09px**（Web 观感） |
| 属性不存在 | 启用封顶 | 7px × 1.8409 ≈ **12.89px**（Windows 观感） |

## 3. moheng 的实现

### 默认值差异（有意为之）

| | Hana | moheng |
| --- | --- | --- |
| 默认 | `true`（Windows 上封顶） | **`false`（Web 观感）** |
| 理由 | 桌面应用，跟随系统观感 | Web 应用，展示 Hana 的网页版观感 |

### auth-store.ts

新增偏好字段：

```ts
type UiPreferences = {
  ...
  /* 适配 Windows 圆角（对齐 Hana settings.experiments.windowsCardRadius）：
     true  = 较小卡片圆角（7px × scale ≈ 12.89px）
     false = Web 观感（12px × scale ≈ 22.09px） */
  windowsCardRadius: boolean;
};

const defaultUiPreferences = {
  ...
  windowsCardRadius: false,
};
```

应用逻辑：

```ts
export function applyUiPreferences(value: UiPreferences) {
  ...
  /* 属性名是 off —— 与 Hana 一致：data-windows-card-radius="off" 表示不封顶 */
  if (value.windowsCardRadius) root.removeAttribute('data-windows-card-radius');
  else root.setAttribute('data-windows-card-radius', 'off');
}
```

带 toggle 方法：

```ts
toggleWindowsCardRadius: () =>
  set((state) => updateUiPreferences(set, state, { windowsCardRadius: !state.windowsCardRadius })),
```

### Layout.tsx

恢复 `data-platform` 写入（开关依赖平台判断）：

```tsx
useEffect(() => {
  const p = navigator.platform || '';
  const isWin = /Win/i.test(p) || /Windows/i.test(navigator.userAgent);
  document.documentElement.dataset.platform = isWin ? 'win32' : (/Mac/i.test(p) ? 'darwin' : 'linux');
}, []);
```

### hana.css

恢复封顶规则：

```css
html[data-platform="win32"]:not([data-windows-card-radius="off"]) {
  --panel-card-radius: min(var(--radius-lg), 7px);
}
```

### 设置页面

位置：外观 → 外观分区，紧挨「减少动效」。

```tsx
<div className="settings-row">
  <div className="settings-row-copy">
    <strong>适配 Windows 圆角</strong>
    <span>在 Windows 上使用较小的卡片圆角；关闭则使用网页版的圆角尺寸。</span>
  </div>
  <button
    type="button"
    className={`settings-toggle ${windowsCardRadius ? 'is-on' : ''}`}
    role="switch"
    aria-checked={windowsCardRadius}
    aria-label="适配 Windows 圆角"
    onClick={toggleWindowsCardRadius}
  >
    <i />
  </button>
</div>
```

## 4. 实测验证（四态全过）

```
=== 初始（默认 Web 观感）===
  platform           win32
  cardRadiusAttr     off
  panelCardRadius    12px
  cardRadius         22.0908px

=== 点击后 ===
  cardRadiusAttr     null
  panelCardRadius    min(12px, 7px)
  cardRadius         12.8863px

=== 再点回 ===
  cardRadiusAttr     off
  panelCardRadius    12px
  cardRadius         22.0908px

=== 判定 ===
  ✓ 初始为 Web 观感（22.09px）
  ✓ 开启后变 Windows 观感（12.89px）
  ✓ 关闭后复原 Web 观感
  ✓ 属性语义正确（off = 不封顶）
```

## 5. 顺带修正：CardShell 的 padding

上一轮遗留的疑点已查清。

### Hana 的分工

```css
/* 通用卡片壳：无 padding */
._previewPanelBody_11fea {
  border-radius: ...;
  background: var(--panel-card-bg);
  border: var(--panel-card-border);
  /* 没有 padding */
}

/* 内缩由内部元素各自负责 */
._previewPanelBody_11fea .preview-markdown {
  padding: var(--space-24) var(--editor-markdown-content-padding-x) var(--space-16);
}
```

### moheng 的选择

moheng 的表格卡片内部是 `<table>`，让每个内部元素自己加内缩不现实，
所以**由卡片壳提供 padding**。这是有意识的差异。

```css
.padded {
  padding: var(--card-inset, var(--space-16));   /* 16px */
}
```

**修正**：旧版 `dense` 用 14px，是从浮层卡片 `._card_28864` 抄来的错值
（那张卡片是 420px 浮层，不是通用容器）。`/parties` 已改为默认密度 16px。

实测：

```
className    : _shell_ah471_30 _padded_ah471_48 data-table-panel
padding      : 16px
radius       : 22.0908px
box-shadow   : none
corner-shape : superellipse(2)
--card-inset : 1rem
```

## 6. 验证结果

```
TypeScript      通过
UI 规范检查      75/75 passed
视觉回归         26 路由 0 failure
圆角逐元素比对   0 变化（padding 改动不影响圆角）
开关四态实测     全部通过
```

## 7. 教训

**先查有没有对应的用户设置项，再决定删不删。**

这次的信号其实很明显：CSS 选择器写的是
`:not([data-windows-card-radius="off"])` —— 那个 `off` 值的存在，
本身就在说「这东西可以被关掉」。我却把它当成了死代码的遗留。

同理适用于：任何带 `:not([...])`、`data-*="off"`、`data-*="disabled"`
这类形态的选择器，都值得先查一遍有没有对应的开关实现。
