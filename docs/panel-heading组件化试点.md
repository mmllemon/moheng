# panel-heading 组件化试点

> 两个页面试点：把卡片内标题移到卡片外，对齐 Hana 的 Section 结构。
> 日期：2026-10-23。

## 1. Hana 的设计：标题在卡片外

Hana **没有** `panel-heading` 这种「卡片内标题」的通用模式。它的做法是：

```jsx
<Section title="主题" description="选择纸张底色与侧栏墨色">
  <Section.Card>{内容}</Section.Card>
</Section>
```

渲染结构：

```html
<section class="section">
  <div class="sectionHeader">          ← 标题行在卡片外
    <h2 class="sectionTitle">主题</h2>
    <div class="sectionContext">操作位</div>
  </div>
  <div class="sectionDescription">说明</div>
  <div class="surfaceCard">            ← 卡片独立
    内容
  </div>
</section>
```

## 2. 关键发现：surface 默认应为 plain

Hana 源码的推导逻辑：

```js
const s = surface ?? (variant === "hero" || variant === "double-column" ? "plain" : "card");
```

按这个逻辑，默认是 `card`，意味着 `<Section>` 外层是卡片，`<Section.Card>` 又是卡片——**会卡片套卡片**。

但实测用法统计推翻了这个理解：

```
surface: "plain"  → 12 次
surface: "card"   →  2 次
ae.Card           →  4 次
```

**Hana 实际主要用 `plain`**：外层不分卡片，由内部 `Section.Card` 提供卡片。

所以 moheng 的 `SettingsSection` 默认改为 `plain`，避免嵌套。

## 3. 我实现时的两个错误

### 错误一：`.plain > .body > *` 误伤卡片

Hana 原规则精确限定到行组件：

```css
._sectionPlain_d88bd > ._sectionBody_5c316 > ._row_f2301 {
  padding-left: 0;
  padding-right: 0;
}
```

我写成了 `*`：

```css
.plain > .body > * { padding-left: 0; padding-right: 0; }
```

结果把 `Section.Card` 的左右 padding 也清零了，卡片内表格贴边。

**修法**：限定到 `.row` 类，不再用通配符。

### 错误二：标题里的图标换行

`SettingsSection` 的 `.title` 没有 `display: flex`（Hana 原式没有，因为它传的是纯文本）。但 moheng 有些页面传的是 `<><Icon />文字</>`，图标跑到了文字上方。

**修法**：加 `display: flex; align-items: center; gap: 6px`。纯文本场景不受影响。

## 4. 试点页面

### 审计日志 `/audit-logs`

```diff
- <section className="panel audit-table-panel">
-   <div className="panel-heading">
-     <div><h3><Activity size={17} />操作流水</h3><p>展开任意记录…</p></div>
-     <Button variant="ghost">刷新</Button>
-   </div>
+ <SettingsSection
+   title={<><Activity size={17} />操作流水</>}
+   description="展开任意记录可查看该操作保存的变更快照。"
+   context={<Button variant="ghost">刷新</Button>}
+ >
+   <SettingsSection.Card density="padded" className="audit-table-panel">
      ...表格、分页...
- </section>
+   </SettingsSection.Card>
+ </SettingsSection>
```

### 往来单位 `/parties`

```diff
- <CardShell className="data-table-panel">
-   <div className="panel-heading">
-     <div><h3>往来单位台账</h3><p>统一维护建设单位…</p></div>
-     <span className="table-count">{rows.length} 家单位</span>
-   </div>
+ <SettingsSection
+   title="往来单位台账"
+   description="统一维护建设单位、材料供应商、分包与租赁服务单位；…"
+   context={<span className="table-count">{rows.length} 家单位</span>}
+ >
+   <SettingsSection.Card density="padded" className="data-table-panel">
      ...工具条、表格...
- </CardShell>
+   </SettingsSection.Card>
+ </SettingsSection>
```

## 5. 实测结果

```
=== audit-logs ===
  .panel-heading 存在: false
  section   : {"x":489,"y":827,"w":670,"h":1488}
  title     : {"text":"操作流水","y":827,"h":37}
  desc      : {"text":"展开任意记录…","y":868,"h":19}
  card      : {"x":489,"y":903,"w":670,"h":1412}
  cardStyle : {"padding":"16px","radius":"14.7272px","border":"1px solid","bg":"rgb(252,250,245)"}
  titleStyle: {"fontSize":"14.4px","fontWeight":"600","color":"rgb(59,61,63)"}

=== parties ===
  .panel-heading 存在: false
  section   : {"x":274,"y":296,"w":1132,"h":265}
  title     : {"text":"往来单位台账","y":296,"h":20}
  desc      : {"text":"统一维护建设单位…","y":320,"h":19}
  card      : {"x":274,"y":355,"w":1132,"h":206}
  cardStyle : {"padding":"16px","radius":"14.7272px","border":"1px solid","bg":"rgb(252,250,245)"}
```

**全部符合 Hana 规格：**
- 标题字号 14.4px / 600 / 主墨色 ✅
- 说明 12.48px / muted ✅
- 卡片圆角 14.7272px（`--radius-card` × squircle）✅
- 卡片无投影 ✅
- 标题在卡片外 ✅

## 6. 视觉变化（这是预期的）

标题移出卡片，意味着：

1. **卡片顶部不再有标题区**，卡片高度减少约 41-53px
2. **页面总高度增加**，因为多了 section 的 40px 间距
3. **标题与卡片之间**多了 4px 间距（有说明时）

这是结构性变化，不是 bug。

## 7. 验证结果

```
TypeScript      通过
UI 规范检查      75/75 passed
视觉回归         26 路由 0 failure
圆角逐元素比对   52 处变化（均为上轮去掉 win32 封顶的既定结果，非本轮引入）
                 12 处消失 + 7 处新增（结构调整 + CSS Modules hash 变化）
```

## 8. 试点结论

**方案可行。** 两个结构不同的页面（单卡片带图标标题 / 表格卡片带工具条）都改造成功，
`panel-heading` 完全消失，结构对齐 Hana。

剩余工作量：`panel-heading` 还有 **46 处**，分布在 18 个文件。

## 9. 待决

1. **其余 46 处是否全量推进**。改动会触及 18 个文件，每处都有视觉高度变化。
2. **`.panel` 的其余用法**（非 `panel-heading`）是否需要一并处理。
3. **`density="padded"` 的适用范围**：表格类卡片需要，纯内容卡片可能不需要（Hana 的 `_surfaceCard` 本身无 padding）。
