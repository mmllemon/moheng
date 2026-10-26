# 卡头按钮与文件行 meta：落地

日期：2026-10-24

## 一项重要纠正：卡头没有 ＋ / ⋯

你说「卡头按钮不对，因为窗口控制按钮占位」，我挖完后发现更根本的事实：

**files 卡片 `[h4]` 根本没有 `chrome` 字段。**

```js
[h4]: {
  titleKey: "chalkboard.tile.files",
  surface: "card",
  cardForm: "structural",
  closable: true,
  sizing: { role: "elastic", minPx: bte },
  Component: Ket,
  onClose: () => setChalkboardWorkspaceOpen(false),
}
```

没有 `chrome`，所以卡头**只有 `×` 一个按钮**，来自 `closable: true`：

```js
// dve() 生成系统按钮
n2.closable && r.push({
  id: "chalkboard.system.close",
  slot: "titlebar-right",
  rendererKind: "chalkboard.system.close",
  label: "chalkboard.tile.close",
  order: Ua.close,        // 9010
})
```

`minimize` 只在 `detached` 时出现：

```js
n2.detached && (r.push({ id: "chalkboard.system.minimize", order: Ua.minimize }),
                r.push({ id: "chalkboard.system.full-screen", order: Ua.fullScreen }))
```

files 卡片不是 detached，所以**没有 `−`**。

## ＋ / ⋯ 在哪里

在**卡内容区**，不在卡头。工作室（workspace tab）的三层结构：

```jsx
<div className={stage} data-inner={inner}>
  {inner && <Toolbar state showPreviewToggle tone="system" />}   // 工具条：预览开关 + 筛选 + 排序
  <Chrome inner query folderName onBack canAdd browse t />        // 返回 / 搜索 / 添加
  <div className={layers}>
    <div className={layerList}><MountList /></div>
    <div className={layerTree}><Tree /></div>
  </div>
</div>
```

`Chrome` 的三段：

```jsx
<div className={chrome}>
  <div className={chromeLead} data-open={inner} inert={!inner}>
    <Btn size="lg" onClick={onBack} aria-label="返回"><BackIcon /></Btn>
  </div>
  <div className={searchSlot}>
    <SearchInput className={search} size="lg" value={query} onChange={onQuery} />
  </div>
  <div className={chromeTrail} data-open={!inner && canAdd} inert={!(!inner && canAdd)}>
    <Btn size="lg" onClick={addFolder} aria-label="添加"><PlusIcon /></Btn>
  </div>
</div>
```

- **`＋`** = `chromeTrail` 的添加按钮（新建文件夹）
- **`⋯`** = `Toolbar` 的筛选 / 排序按钮

两者都受 `inner` / `canAdd` 条件控制，**不是常显的卡头按钮**。

## 卡内 tab 是滑块，不是卡片式

我之前说「Hana 的 tab 用 bg-card + border，不是滑块」——**这也是错的**。

Hana 有**两套 tab**：

| 类名前缀 | 用途 | 选中态 |
|---|---|---|
| `_tabs_22ed1` + `_tabSlider_f4978` | 对话文件 / 工作室 | **滑块位移** |
| `_tabBar_2e5d8` + `_tab_8db96` | 预览卡的多文件 tab | bg-card + border + shadow |

moheng 用的是滑块，**与 `_tabs_22ed1` 一致，是对的**。

```jsx
const tabs = Vse.map((id) => ({ id, labelKey: qse[id].titleKey }));

function WorkspaceTabs({ tabs, activeTab, onSelect }) {
  const index = Math.max(0, tabs.findIndex((t) => t.id === activeTab));
  const style = {
    '--right-workspace-active-tab-index': `${index}`,
    '--right-workspace-tab-slider-offset': index === 0 ? '0px' : 'calc(100% + 2px)',
  };
  return (
    <div className={wh.tabs} role="tablist" style={style}>
      <div className={wh.tabSlider} data-right-workspace-tab-slider />
      {tabs.map((t) => <button role="tab" aria-selected={t.id === activeTab} className={wh.tab}>{label(t)}</button>)}
    </div>
  );
}
```

## 改完的

**一、卡头按钮**：上传 / 刷新 / ×（保留 moheng 业务，`×` 对齐 `closable`）

**二、文件行 meta**：改成「大小 · 时间」

```
改造前           改造后
报表.pdf         报表.pdf
10 B             10 B · 10/24 20:00
```

```tsx
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

实测：

```
报表.pdf        10 B · 10/24 20:00
测试.pdf        13 B · 10/24 17:08
合同扫描件.pdf   672 B · 10/24 14:48
脚本.json       2 B · 10/24 20:00
```

## 两项跳过，附原因

### DrawerStack（叠纸抽屉）

Hana 的两个抽屉都是**会话专属**：

```js
const DRAWER_COMPONENTS = { progress: TodoDrawer, status: SessionStatusDrawer };
```

- `progress` = 会话的 todo 列表
- `status` = 当前模型 + 会话文件数

**moheng 没有「会话」概念**，硬做会是空壳。跳过。

CSS 真值已记录（`-10px` margin + z-index 递减 + 非末层只保下沿圆角），等 moheng 有对应数据再补。

### 预览卡左岛 tab 栏

Hana 的 `chalkboard.preview.tabs` 是**多文件预览的标签栏**（同时打开多个文件切换）。

**moheng 一次只预览一个文件**，没有多文件 tab。跳过。

## 验证

```
UI 规范检查   75/75
视觉回归      26 路由 0 failure
TypeScript    前后端通过
```

实测 tab 一致性：

```
activeTab        "工作室"
sliderOffsetVar  "calc(100% + 2px)"
sliderRect       x=1273  w=45
tab[工作室]       x=1273  w=45   selected=true    ← 完全重合
hasFileTree      true
hasArtifactList  false
```

## 这一轮的四次纠正

| 我说的 | 实际 |
|---|---|
| 卡头有 ＋ / ⋯ / × | files 卡片无 chrome，卡头只有 × |
| `−` 是卡片按钮 | `−` 只在 detached 时出现 |
| Hana tab 用 bg-card 不是滑块 | 有两套 tab，`_tabs_22ed1` 就是滑块 |
| 预览卡左岛放 tab | 那是多文件 tab，moheng 没有 |

**共同点：我在把「某个类/某个值存在」当成「它用在这里」。** 得先确认这个组件属于哪个卡片、哪个条件分支。
