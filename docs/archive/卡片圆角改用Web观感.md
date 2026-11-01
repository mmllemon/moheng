# 卡片圆角：采用 Hana Web 观感

> 移除 Windows 平台圆角封顶。完成日期：2026-10-23。

## 1. 决策

**采用 Hana 的 Web 观感，不实施 Windows 平台封顶。**

```css
/* Hana Web（非 win32） */
--panel-card-radius: var(--radius-lg);   /* 12px */
卡片圆角 = 12px × 1.8409 = 22.09px

/* Hana Windows（win32） */
--panel-card-radius: min(var(--radius-lg), 7px);   /* 7px */
卡片圆角 = 7px × 1.8409 = 12.89px
```

**选前者：22.09px 大圆角。**

## 2. 原实现为什么是 7px

`Layout.tsx` 会写 `data-platform` 标记：

```tsx
useEffect(() => {
  const p = navigator.platform || '';
  const isWin = /Win/i.test(p) || /Windows/i.test(navigator.userAgent);
  document.documentElement.dataset.platform = isWin ? 'win32' : 'darwin';
}, []);
```

配合 `hana.css` 的规则：

```css
html[data-platform="win32"]:not([data-windows-card-radius="off"]) {
  --panel-card-radius: min(var(--radius-lg), 7px);
}
```

在 Windows 上浏览时，卡片圆角被压到 7px。

**这个实现本身是对的**——它准确地复刻了 Hana 在 Windows 桌面端的真实行为。但 moheng 是 Web 应用，用户看到的应该是 Hana 的 Web 观感。

## 3. 改动内容

### Layout.tsx

移除 `data-platform` 写入：

```diff
- useEffect(() => {
-   const p = navigator.platform || '';
-   const isWin = /Win/i.test(p) || /Windows/i.test(navigator.userAgent);
-   document.documentElement.dataset.platform = isWin ? 'win32' : (/Mac/i.test(p) ? 'darwin' : 'linux');
- }, []);
+ /* 平台标记已移除。原用途：让 win32 规则生效压到 7px。
+    现采用 Web 观感，不再压制卡片圆角。 */
```

### hana.css

删除封顶规则，并保留注释说明原委：

```diff
- html[data-platform="win32"]:not([data-windows-card-radius="off"]) {
-   --panel-card-radius: min(var(--radius-lg), 7px);
- }
+ /* Windows 卡片圆角封顶已移除（2026-10-23）。
+    若恢复，需同时恢复本规则与 Layout.tsx 的 data-platform 写入。 */
```

同时订正了 3 处过期注释（顶部 token 说明、圆角推导注释）。

## 4. 验证：只有 53 处变化，全部是卡片

改动前后各记录 26 条路由上每个元素的圆角，逐项比对：

```
比较的元素: 1609
圆角值变化: 53
改动前有、改动后无: 0
改动后新增: 0

=== 差异分组 ===
12.8863px → 22.0908px   (53 处)
```

**变化的元素类型（去重）只有 3 类：**

| 元素 | 说明 |
| --- | --- |
| `aside.app-sidebar` | 侧栏（也是卡片壳） |
| `main.app-content` | 主内容区（卡片壳） |
| `section._shell_*._dense_*` | CardShell 组件 |

**没有一处误伤**：按钮 9.20448px、紧凑控件 7.36359px、圆角 2px 的那 169 个元素全部未变。

## 5. 最终确认

`/parties` 页面的 CardShell 实测：

```
section._shell_aynqu_30._dense_aynqu_46#1  radius=22.0908px
期望（Hana Web）: 12px × 1.8409 = 22.0908px
```

**精确匹配。**

## 6. 一处可以恢复的设计

`hana.css` 里保留了完整的原规则和说明。若要恢复 Windows 封顶（比如将来真的做桌面端时）：

1. 恢复 `Layout.tsx` 的 `data-platform` 写入
2. 恢复 `hana.css` 的 `html[data-platform="win32"]` 规则

两处都在文件里留了明确注释指向对方。

## 7. 验证结果

```
TypeScript      通过
UI 规范检查      75/75 passed
视觉回归         26 路由 0 failure
圆角逐元素比对   53 处变化，全部是卡片壳，零误伤
```

## 8. 遗留

1. **`density="dense"` 的 14px 内缩可能不对**。Hana 通用卡片壳 `._previewPanelBody_11fea` 没有 padding，内缩由内部元素负责。14px 是从浮层卡片 `._card_28864` 抄来的，需要再确认表格卡片该用多少。
2. **`panel-heading` 等内部类仍是全局类**，未组件化。
3. **其余 25 个路由的 `.panel` 未替换为 CardShell。**
