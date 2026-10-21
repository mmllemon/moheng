# Hana 布局准则

> 来源：`scripts/hana-design-patterns.mjs` 对 Hana 1.1.35 全部 50 个 CSS 文件、37,220 条声明的统计。
> 这些不是审美偏好，是从 Hana 实际代码里量出来的分布规律。照做就能复现那种"舒服"。

## 为什么 Hana 看起来舒服

不是某个值选得妙，而是**值的分布极度克制**。四个规律：

### 规律一：用 gap 排版，不用 margin 堆叠

| 声明类型 | Hana 次数 |
|---|---|
| `gap` | **998** |
| `margin` | 732 |
| `padding` | 1162 |

`gap` 多于 `margin`，意味着间距由**容器统一决定**，而不是每个子元素自己往外推。

**效果**：同一容器里的元素间距天然相等，不会出现"第一个 12px、第二个 14px"的错位。改间距只改一处。

**做法**：
```css
/* ✅ 容器统一控制 */
.toolbar { display: flex; gap: var(--space-8); }

/* ❌ 子元素各自推 */
.toolbar > * + * { margin-left: 8px; }
.toolbar > button { margin-right: 8px; }
```

例外：与容器外部其它区块的距离，仍用 `margin`。

### 规律二：flex 优先，grid 只在二维

| display | Hana 次数 |
|---|---|
| flex | **1137** |
| inline-flex | 249 |
| grid | **161** |
| block | 176 |

flex 是 grid 的 7 倍。grid 只出现在真正的二维场景：日历、卡片矩阵、报表网格。

**效果**：flex 的 `align-items: center` 天然让元素垂直居中，横向自动分配。这是 Hana 元素总是对齐整齐的原因。

**做法**：
```css
/* ✅ 一维排列 */
.row { display: flex; align-items: center; gap: var(--space-8); }

/* ✅ 二维才用 grid */
.calendar { display: grid; grid-template-columns: repeat(7, 1fr); }

/* ❌ 一维硬用 grid */
.row { display: grid; grid-template-columns: auto auto auto; }
```

### 规律三：间距只用 8 个值

Hana 的 gap 分布：

| token | 值 | 次数 |
|---|---|---|
| `--space-8` | 8px | **307** |
| `--space-4` | 4px | 185 |
| `--space-6` | 6px | 109 |
| `--space-12` | 12px | 71 |
| `--space-16` | 16px | 65 |
| `--space-2` | 2px | 59 |
| `--space-10` | 10px | 29 |
| `--space-24` | 24px | 15 |

**8px 是绝对主力（307 次，第二名的 1.7 倍）。** 所有间距都是 8px 的倍数或分数，节奏统一。

**做法**：间距只能用这些 token，禁止裸 px。

```
允许：--space-2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 24 / 32 / 40
禁止：5px、7px、9px、11px、13px、15px、18px、20px、22px
```

### 规律四：控件高度只有三档

| 高度 | 用途 |
|---|---|
| 20px | 微控件（角标、小图标按钮） |
| 28px | 标准控件（小按钮、行内操作） |
| 32px | 主控件（输入框、主按钮、下拉） |

Hana 实际分布：14px(37) / 20px(36) / 28px(34) / 32px(26) / 24px(32) / 16px(32)。
前四档是控件主体，后两档是图标容器。

**没有 26px、30px、34px 这种"差一点"的值。**

**做法**：
```css
/* ✅ 三档 */
.icon-btn { height: 20px; }
.btn-sm { height: 28px; }
.btn, .input, .select { height: 32px; }

/* ❌ 随手写 */
.btn { height: 30px; }
.input { height: 34px; }
```

## 附则：padding 的常见组合

Hana 的高频 padding 组合（可直接复用）：

| 组合 | 次数 | 典型用途 |
|---|---|---|
| `var(--space-16)` | 51 | 卡片内边距 |
| `var(--space-8)` | 32 | 小容器 |
| `var(--space-4) var(--space-8)` | 32 | 紧凑按钮 |
| `0 var(--space-8)` | 28 | 纯横向内边距 |
| `var(--space-6) var(--space-8)` | 25 | 列表行 |
| `var(--space-24)` | 25 | 大区块 |
| `var(--space-8) var(--space-16)` | 24 | 中等按钮 |
| `var(--space-6) var(--space-12)` | 22 | 列表项 |
| `var(--space-8) var(--space-12)` | 22 | 输入框 |

## 检查方式

```bash
node scripts/lint-layout.mjs
```

输出三类违规：
1. **裸 px 间距**：`margin/padding/gap` 用了非 token 值
2. **非法控件高度**：`height` 用了 20/28/32 之外的值（图标容器除外）
3. **margin 堆叠**：连续子元素用 margin 制造间距，应改用 gap

## 适用范围

- **必须遵守**：`hana.css` 及所有新增样式
- **豁免**：`legacy.css`、`v6.css`（旧层，冻结不再改）；`styles.css`（全局重置）
- **例外需注明**：确实需要特殊值时，在规则上方写 `/* layout-exception: 理由 */`
