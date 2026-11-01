# 抽屉内容补全与 spring 曲线

> 侧栏悬停抽屉的第二轮：补齐项目列表与页脚，并用 `linear()` 模拟 spring 回弹。
> 日期：2026-10-23

---

## 一、抽屉内容补全

### 1.1 补齐前后的对比

| 部分 | 第一版 | 现在 |
|---|---|---|
| 品牌标识 | ✅ | ✅ |
| 导航分组 | ✅ 3 组 7 项 | ✅ 3 组 7 项 |
| **项目列表** | ❌ | ✅ 前 5 项 + 「查看全部」 |
| **页脚用户区** | ❌ | ✅ 头像 + 名字 + 角色 + 2 个操作按钮 |

实测：

```
导航项:     7
导航分组:   3
项目项:     2          ← 当前账号有 2 个项目
项目区:     有
页脚:       有
用户行:     有
页脚按钮:   2          ← 系统设置 + 退出登录
```

### 1.2 复用的样式类

抽屉里的所有内容都复用主侧栏的类名，不新增样式：

```
.sidebar-nav-group / .sidebar-group-title / .sidebar-nav-link
.sidebar-projects / .sidebar-project-list / .sidebar-project
.sidebar-project-mark / .sidebar-project-copy / .sidebar-project-empty
.sidebar-project-all
.app-sidebar-footer / .sidebar-user-row / .sidebar-user-avatar
.sidebar-user-copy / .sidebar-footer-actions / .sidebar-footer-icon
```

**这样抽屉和主侧栏的视觉完全一致，滑出时不会「看起来是两个东西」。**

### 1.3 唯一需要新增的 CSS

```css
.sidebar-drawer .app-sidebar-profile { flex-shrink: 0; }
.sidebar-drawer .app-sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
```

因为抽屉是 `position: fixed` 的独立容器，需要自己声明 flex 布局的收缩行为。

### 1.4 一个踩到的坑

第一版我写 `onClick={() => { rememberSettingsOrigin(...); navigate('/system/management'); }}`，TypeScript 报错：

```
error TS2304: Cannot find name 'rememberSettingsOrigin'.
```

主侧栏实际用的是：

```jsx
onClick={(event) => { rememberPaperOrigin(event.currentTarget); navigate('/system'); }}
```

**教训：复用交互逻辑时，必须核对真实函数名和路径，不能凭语义猜。**

---

## 二、spring 曲线：三次修正

这部分我走了一段弯路，值得完整记录。

### 2.1 第一次尝试：用 paperGentle 的物理参数生成

```js
// Framer Motion 的 paperGentle
spring(350, 32, 1)   // stiffness 350, damping 32, mass 1
```

物理计算：

```
ω₀ = √(350/1) = 18.708 rad/s
ζ  = 32 / (2√350) = 0.8552
过冲 = 0.56% @ 0.324s
```

**过冲只有 0.56%，几乎看不出来。**

### 2.2 第二次尝试：查 `--ease-paper-spring`

Hana 的 `styles.css` 里有：

```css
--ease-paper-spring: linear(0, 0.01, 0.036, ..., 1.05, ..., 1);
```

49 个关键点，峰值 **1.05（过冲 5%）**。

看起来应该用这条。但查它的实际用途：

```css
/* 只出现在 SettingsForm 的两个局部动画里 */
._sourceMotion_1bdee {
  transition: opacity var(--duration-paper-spring-fade) var(--ease-out),
              transform var(--duration-paper-spring) var(--ease-paper-spring);
}
```

`--duration-paper-spring: 0.172s`。

**这是设置表单里的小元素动画，与侧栏抽屉无关。** 而且 5% 过冲与 `paperGentle` 的 0.56% 物理值对不上，说明这条曲线对应的是另一套参数。

### 2.3 第三次尝试：找到 `pl.cssEasing`

在 `AnimationPrimitives-O85oXpjE.js` 里发现另一条曲线：

```js
pl = {
  stiffness: 270,
  damping: 24,
  overshootLimit: 0.035,
  cssEasing: "linear(0, 0.0215 2%, 0.0772 4%, 0.1554 6%, 0.2467 8%, 0.3439 10%, 0.4651 12.5%, 0.5793 15%, 0.6816 17.5%, 0.7698 20%, 0.8559 23%, 0.9215 26%, 0.9809 30%, 1.0149 34%, 1.0307 38%, 1.0346 43%, 1.0294 48%, 1.0194 54%, 1.0104 60%, 1.0034 67%, 1 74%, 0.9988 82%, 0.999 90%, 1 100%)"
};
pl.stiffness, pl.damping;   // ← 这两个值实际未被使用，只有 cssEasing 生效
```

物理计算验证：

```
k=270, c=24, m=1
ω₀ = 16.432 rad/s
ζ  = 0.7303
过冲 = 3.48% @ 0.280s

曲线声明 overshootLimit = 0.035 (3.5%)
```

**3.48% vs 3.46%（曲线实际峰值）—— 完全吻合。**

这说明 `pl.cssEasing` 就是从 `(270, 24, 1)` 这组参数推导出的 CSS 曲线，是 Hana 在 CSS 里真正使用的那条。

### 2.4 最终选择

| 候选 | 过冲 | 实际用途 | 采用 |
|---|---|---|---|
| paperGentle 物理生成 | 0.56% | Framer Motion spring | ✗ 太弱 |
| `--ease-paper-spring` | 5% | SettingsForm 局部（0.172s） | ✗ 用途不符 |
| **`pl.cssEasing`** | **3.46%** | **Hana 在 CSS 里的 spring** | ✅ |

**时长统一用 `--duration-space: 0.4s`**，与侧栏宽度动画同步，避免脱节。

---

## 三、一个真实的 CSS 错误

第一版我把变量裸写在规则外面：

```css
/* 注释... */
--ease-drawer-spring: linear(...);     ← 没有选择器包裹！

.sidebar-drawer { ... }
```

**CSS 变量必须写在选择器里**，裸写的声明会被整个丢弃。

实测症状：

```
root 变量:      (空)
抽屉上的变量:   (空)
computed timing: ease          ← 回退到默认值
```

修正：

```css
:root {
  --ease-drawer-spring: linear(...);
}
```

修正后：

```
computed timing: linear(0 0%, 0.0215 2%, ... 1 100%)
root 变量:       linear(0, 0.0215 2%, ...)
```

---

## 四、实测：过冲真的发生了

这是最关键的证据。采样抽屉滑出过程中每 60-100ms 的 x 坐标：

```
   0ms  x= -246  opacity=0.00     ← 起点（-100% - 12px）
  60ms  x=  -91  opacity=0.58
 120ms  x=    4  opacity=0.85     ← 已经接近目标
 200ms  x=   11  opacity=0.97     ← 过冲！超过目标 6px 达 5px
 300ms  x=    6  opacity=1.00     ← 回弹到目标
 420ms  x=    6  opacity=1.00     ← 稳定
```

**200ms 时 x=11（目标 6），超出 5px，然后回弹。**

这就是 spring 的特征。`cubic-bezier` 永远不会过冲（它的 y 值单调递增到 1），所以这个现象直接证明了 `linear()` spring 曲线在生效。

### 4.1 对比：如果用 cubic-bezier

之前的曲线是 `cubic-bezier(0.22, 1, 0.36, 1)`，前段进度对比：

| 归一化时间 | cubic-bezier | paperGentle spring |
|---|---|---|
| t=0.1 | **40.1%** | 18.3% |
| t=0.2 | **67.4%** | 48.0% |
| t=0.4 | **91.7%** | 87.1% |

**bezier 前段快了 2 倍多。** 手感差异不是「0.6% 的微小差别」，而是「冲出去很快 vs 起步更稳」。

---

## 五、验证结果

```
=== 内容完整性 ===
  导航项:     7      ✓
  导航分组:   3      ✓
  项目项:     2      ✓
  页脚用户区: 有     ✓
  spring 曲线: linear(...)  ✓

=== 动画时序 ===
  过冲: 200ms 时 x=11（目标 6）→ 回弹到 6  ✓

=== 几何零回归 ===
  expanded   sidebar   6/240    ✓
  expanded   main      246/1194 ✓
  expanded   content   246/1188 ✓
  collapsed  sidebar   0/2      ✓
  collapsed  main      2/1438   ✓
  collapsed  content   2/1432   ✓

=== 门禁 ===
  UI 规范检查   75/75 passed
  视觉回归      26 路由 0 failure
  TypeScript    通过
```

---

## 六、与 Hana 的最终差异

| 项 | Hana | moheng | 说明 |
|---|---|---|---|
| 动画实现 | Framer Motion spring | CSS `linear()` | 效果等价，无库依赖 |
| 曲线参数 | spring(350,32,1) | `pl.cssEasing`(270,24,1) | Hana 自己在 CSS 里也用这条 |
| 时长 | spring 自动推导（~0.4s） | 0.4s 固定 | 与侧栏同步 |
| 过冲 | 0.56% | 3.46% | moheng 略强，视觉上更「弹」 |
| 抽屉内容 | 完整侧栏副本 | 导航+项目+页脚（无 titlebar 交互） | 抽屉只做快速跳转 |

**关于过冲的差异**：Hana 的 Framer Motion spring 实际过冲 0.56%，而 `pl.cssEasing` 过冲 3.46%。Hana 在 CSS 场景里用的是后者（更明显）。

moheng 用 3.46% 版本，因为：
1. 它是 Hana 自己验证过的 CSS 曲线
2. 0.56% 在 240px 位移上只有 1.3px 的过冲，肉眼几乎不可见
3. 3.46% 有 8px 过冲，能感知到「弹」的手感

如果要完全贴合 Framer Motion 的 0.56%，可以换成我第一步生成的曲线：

```css
linear(0.0000 0%, 0.0314 3%, 0.1078 7%, 0.2079 10%, 0.3172 14%, 0.4258 17%, 0.5276 21%, 0.6193 24%, 0.6992 28%, 0.7670 31%, 0.8233 34%, 0.8690 38%, 0.9054 41%, 0.9339 45%, 0.9556 48%, 0.9719 52%, 0.9838 55%, 0.9922 59%, 0.9979 62%, 1.0017 66%, 1.0039 69%, 1.0051 72%, 1.0056 76%, 1.0055 79%, 1.0052 83%, 1.0047 86%, 1.0041 90%, 1.0034 93%, 1.0029 97%, 1.0000 100%)
```

但这条曲线的前段更慢（t=0.1 才 18.3%），会让抽屉看起来「启动迟滞」。3.46% 版本在启动速度和回弹感之间更平衡。

---

## 附录：改动文件

| 文件 | 改动 |
|---|---|
| `apps/web/src/components/Layout.tsx` | 抽屉加项目列表（前 5 项 + 查看全部）、页脚用户区 |
| `apps/web/src/styles/hana.css` | 加 `:root { --ease-drawer-spring }`；抽屉 transition 改用该曲线 |
