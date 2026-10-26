# Radius token 语义对齐 Hana

> 把「缩放预先算进 token」改成「token 存裸值，缩放在使用处」。
> 完成日期：2026-10-23。

## 1. 为什么必须改

moheng 原有的写法：

```css
/* token 定义：把两步合成一步 */
--radius-card: calc(var(--radius-card-base) * var(--corner-radius-scale));

/* 使用处：直接取 */
border-radius: var(--radius-card);
```

Hana 的写法：

```css
/* token 只存裸值 */
--radius-card: 8px;

/* 缩放只在使用处 */
border-radius: calc(var(--radius-card) * var(--corner-radius-scale, 1));
```

### 三个实际代价

1. **无法本地取消缩放**。想要一个不随 squircle 放大的圆角，得写 `calc(var(--radius-card) / var(--corner-radius-scale))`。
2. **语义不可推断**。看到 `--radius-card: 14.73px` 无法知道基准是 8px。
3. **与 Hana 源码不兼容**。从 Hana 复制的 CSS 必须手工改写，而且容易改错。

### 第 3 条是真实踩过的坑

建 `SettingsSection` 组件时，我照抄 Hana 原式：

```css
border-radius: calc(var(--settings-surface-radius, var(--radius-card, 8px)) * var(--corner-radius-scale, 1));
```

结果圆角变成 **27.11px**（14.73 × 1.8409，重复缩放）。

当时的处置是「在 moheng 里去掉那个乘法」。**这是绕过，不是解决。** 结果是同一个组件在两边的写法不一致，以后每次从 Hana 抄东西都要重新判断一次。

## 2. 改动内容

### token 定义（hana.css）

```diff
- --radius-control: calc(var(--radius-input) * var(--corner-radius-scale));
- --radius-action: calc(5px * var(--corner-radius-scale));
- --radius-compact: calc(4px * var(--corner-radius-scale));
- --radius-card: calc(var(--radius-card-base) * var(--corner-radius-scale));
+ --radius-control: var(--radius-input);      /* 6px */
+ --radius-action: 5px;
+ --radius-compact: 4px;
+ --radius-card: var(--radius-card-base);     /* 8px */
```

### 使用处（207 处）

```diff
- border-radius: var(--radius-action);
+ border-radius: calc(var(--radius-action) * var(--corner-radius-scale, 1));
```

分布：

| 文件 | 替换数 |
|---|---|
| hana.css | 195 |
| assistant-provider.css | 8 |
| legacy.css | 4 |
| **合计** | **207** |

### 手工处理 2 处（stat-metrics.css）

这两处含兜底值，语义变化后兜底值含义也变了：

```diff
- border-radius: var(--radius-action, 8px);
+ border-radius: calc(var(--radius-action, 5px) * var(--corner-radius-scale, 1));

- border-radius: calc(var(--radius-action, 8px) - 2px);
+ border-radius: calc(calc(var(--radius-action, 5px) * var(--corner-radius-scale, 1)) - 2px);
```

兜底值从 `8px` 改为 `5px`：因为现在 token 存裸值，`--radius-action` 的裸值就是 5px。

### 组件内同步修正（3 处）

`SettingsSection.module.css` 和 `CardShell.module.css` 里之前为了绕过而写的简化式，现在可以恢复成 Hana 原式：

```diff
- border-radius: var(--settings-surface-radius, var(--radius-card));
+ border-radius: calc(var(--settings-surface-radius, var(--radius-card)) * var(--corner-radius-scale, 1));
```

## 3. 一个关键前提：只有 hana.css 的 token 生效

改动前我担心 `legacy.css` 的 `--radius-card: 10px` 和 `v6.css` 的 `2px` 会干扰。实测确认不会：

```
=== 各文件对 --radius-card 的声明 ===
  [legacy #2]  10px
  [v6     #3]  2px
  [hana   #4]  calc(var(--radius-card-base) * var(--corner-radius-scale))

=== 运行时最终生效值 ===
  --radius-card = calc(8px * 1.8408964152537137)
```

**hana.css 最后加载，只有它的声明生效。** legacy 和 v6 里的同名定义是被完全覆盖的死代码。

所以只改 hana.css 一处定义即可，不必动 legacy/v6 的定义（它们本来就无效）。

## 4. 验证方式：1609 个元素逐项比对

语义改动必须证明**视觉没有变化**。做法：

1. 改动前记录 26 条路由上每个可见元素的 `borderTopLeftRadius` → `docs/gates/radius-before.json`
2. 改动后再记录 → `docs/gates/radius-after.json`
3. 逐元素比对

```bash
node scripts/radius-snapshot.mjs docs/gates/radius-before.json   # 改动前
node scripts/radius-snapshot.mjs docs/gates/radius-after.json    # 改动后
node scripts/radius-compare.mjs docs/gates/radius-before.json docs/gates/radius-after.json
```

### 结果

```
比较的元素: 1600
圆角值变化: 0
```

那 9 个「消失/新增」是 CSS Modules 的 hash 变化（`_surface_14m3z` → `_surface_7gp8c`），
因为修改了 module.css 内容导致 hash 重算。**它们的圆角值都是 14.7272px，完全一致。**

### 中途抓到的真实回归

第一次比对时 `圆角值变化: 9`：

```
14.7272px → 8px   (9 处)
  /settings/appearance  div._surface_*. _surfaceCard_*
```

原因是 `SettingsSection.module.css` 里的绕过写法在 token 变成裸值后失效了。
改成 Hana 原式后消失。**这正是逐元素比对的价值：它抓到了我会漏掉的回归。**

## 5. 门禁同步更新（4 条断言）

`validate-ui-polish.mjs` 有 4 条断言硬编码了旧 token 写法：

| 断言 | 旧条件 | 新条件 |
|---|---|---|
| Hana segmented tabs | `border-radius: 10px` 或 `var(--radius-control)` | 增加 `calc(var(--radius-control)` 分支 |
| business party picker | 同上 | 同上 |
| interactive controls 32px | `calc(var(--radius-input) * scale)` 出现在文件任意处 | token 存裸值 + 使用处带 calc |
| interaction radii scale | `--radius-action: calc(5px * scale)` | `--radius-action: 5px` + 使用处带 calc |

**这是必须改的**：断言验证的写法已经不存在了。但改的时候要保住原意——都在验证「圆角走 token 且缩放生效」。

## 6. 为什么现在做，不放到样式收敛一起

查过收敛时要处理的量：

```
legacy.css   326 处 border-radius  → 仅 4 处用 token，289 处硬编码 px
v6.css       127 处 border-radius  → 0 处用 token，78 处硬编码 px
```

**98% 是硬编码 px，不是 token 引用。**

- 现在改 token 语义 → 影响 207 处（集中在 hana.css，收敛时不动它）
- 放到收敛一起做 → 那时要处理 207 + 453 = 660 处，且 453 处还要先判断「映射到哪个 token」

收敛时把 `border-radius: 5px` 映射成 token：

```css
/* token 语义正确时：直接替换 */
border-radius: 5px  →  border-radius: calc(var(--radius-sm) * var(--corner-radius-scale, 1));

/* token 语义含系数时：还要心算哪个 token 的最终值等于 5px，容易错 */
```

**先修工具，再用工具。** 反过来会边修边错，而 1-2px 的圆角错误视觉上很难发现。

## 7. 遗留

1. **legacy.css / v6.css 里的 token 定义仍是旧值**（10px / 2px）。它们是被覆盖的死代码，等样式收敛时随整层退役。
2. **备份文件保留**：`*.css.before-radius-semantics`（4 个），确认无误后可删。
3. **样式收敛尚未开始**：453 处硬编码 px 待迁移，现在映射逻辑已经变简单。
