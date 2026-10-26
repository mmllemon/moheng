# moheng 与 Hana 对照矩阵与改造清单

> 本文确定「哪些按 Hana 改、哪些参考 Hana、哪些不动」的分界线。
> 判断依据是**形态重叠度**，不是文件大小。
> 日期：2026-10-23

---

## 一、分界原则

用户定的规则：

> moheng 独有的业务，Hana 完全没有 → **不改造**
> moheng 与 Hana 重叠的 → **按 Hana 来**
> 类似的 → **参考 Hana 修改**

所以核心工作是：**判断每个 moheng 形态属于哪一类。**

---

## 二、实测数据

### 2.1 Hana 有什么结构（按类名统计）

| Hana 组件 | 类数 | 表格 | 列表行 | 表单字段 | 卡片 | 分区 | 空态 | 搜索 | 弹窗 | 菜单 | 按钮 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SettingsModalShell | 562 | 9 | 37 | 19 | 30 | 29 | 8 | 8 | 18 | 0 | 20 |
| SettingsForm | 50 | 2 | 5 | 2 | 1 | 9 | 0 | 0 | 0 | 2 | 1 |
| CapabilitiesPanel | 296 | 3 | 16 | 6 | 28 | 5 | 9 | 2 | 13 | 0 | 9 |
| CardShell | 826 | 8 | 45 | 13 | 39 | 34 | 16 | 27 | 14 | 11 | 47 |
| ChatTranscript | 838 | 7 | 34 | 18 | 147 | 26 | 6 | 0 | 12 | 20 | 33 |
| SearchInput | 10 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| EmptyState | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| StatusBar | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ActionFeedbackIcons | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| AnimationPrimitives | 95 | 5 | 1 | 6 | 3 | 16 | 0 | 0 | 0 | 0 | 3 |

### 2.2 关键发现：Hana 的 `grid` 不是数据表格

Hana 所有含 `grid`/`table` 的类，逐个查过，**没有一个是数据表格**：

```
SettingsModalShell:  media-config-grid / access-account-grid / access-url-grid
                     access-connect-grid / access-network-grid / access-status-grid
                     → 全是设置项的 2 列配置网格

CardShell:           agentSettingsInlineGrid / coverGalleryGrid / fileGrid
                     deviceGrid / folderGrid / libGrid
                     → 文件/设备/封面的网格展示

CapabilitiesPanel:   marketGrid / entryGrid
                     → 插件市场的卡片网格
```

**结论：Hana 没有「多列表格 + 表头 + 分页」这种形态。** 它是聊天产品，数据展示用列表行（`row`），不是表格。

### 2.3 Hana 的「列表行」范式（这个可以抄）

CardShell 有 25 个 row 类，结构统一：

```
row（容器）
  ├─ chipAvatar / chipAvatarImg    ← 左侧头像/图标
  ├─ 内容区（name + meta）
  ├─ statusDot                     ← 状态点
  └─ 右侧操作
```

典型样本：

```css
/* 行容器：flex，可选中 */
._row_xxxxx {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-height: 32px;
  padding: 0 var(--space-8);
  border-radius: calc(var(--radius-sm) * var(--corner-radius-scale, 1));
  corner-shape: squircle;
  transition: background var(--duration-instant) var(--ease-out);
}

/* 悬停/选中 */
._row_xxxxx:hover, ._row_xxxxx[data-selected] {
  background: var(--overlay-light);
}

/* 头像 */
._chipAvatar_xxxxx {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  corner-shape: round;
}

/* 状态点 */
._menuItemStatusDot_xxxxx {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--accent);
}
```

**这个范式 moheng 可以直接用**，因为它是「一行内容 + 左侧标识 + 右侧操作」，业务表格的行也是这个结构。

---

## 三、moheng 36 个页面的形态分类

### 3.1 分类结果

| 形态 | 页数 | 代表页面 |
|---|---|---|
| 设置类 | 6 | AppearanceSettingsPage、AccountSecurityPage、SystemSecurityPage |
| 列表+表格类 | 7 | BusinessPartiesPage、ContractsPage、ProjectsPage、SystemDictionariesPage |
| 详情类（双栏） | 2 | BusinessPartyDetailPage、ProjectOverviewPage |
| 工作台类（多卡片） | 6 | SystemGovernancePage、SystemManagementPage、DashboardPage |
| 业务表单类 | 7 | BudgetPage、ChangesPage、DownstreamFinancePage、OwnerFinancePage |
| 报表类 | 4 | ReportDesignerPage、ReportStudioPage |
| 其他 | 4 | LoginPage、AnalysisPage、AuditLogsPage |

### 3.2 逐类对照 Hana

| moheng 形态 | Hana 有对应吗 | 重叠度 | 处理方式 |
|---|---|---|---|
| **设置类**（6 页） | ✅ SettingsModalShell + SettingsForm（562+50 类） | **高** | **按 Hana 改** |
| **列表+表格类**（7 页） | ⚠️ 有列表行范式，无表格 | **中** | **参考 Hana 行范式** |
| **详情类**（2 页） | ⚠️ CardShell 有 card 嵌套 | **中** | **参考 Hana 卡片** |
| **工作台类**（6 页） | ✅ CapabilitiesPanel 是多卡片布局 | **高** | **按 Hana 改** |
| **业务表单类**（7 页） | ⚠️ SettingsForm 是表单，但业务表单更复杂 | **低-中** | **参考字段样式** |
| **报表类**（4 页） | ❌ 完全没有 | **零** | **不动** |
| **其他**（4 页） | ⚠️ LoginPage 无、AnalysisPage 有图表 | **低** | **基本不动** |

---

## 四、改造清单（按重叠度排序）

### 第一梯队：重叠度高，按 Hana 改

#### A1. 设置类页面（6 页）

**对应 Hana**：`SettingsModalShell`（562 类）+ `SettingsForm`（50 类）

**当前状态**：`SettingsSection` 组件已建（标题+卡片单元），但**整个设置窗骨架没做**。

**要做**：

| 项 | Hana 真值 | 说明 |
|---|---|---|
| 设置窗尺寸 | 960×840 | 固定尺寸模态框 |
| 左侧导航 | 208px | 分组导航 |
| 内容列 | 670px | 右侧内容区 |
| 窗内滚动 | `.settings-content` 自己滚 | 顶部标题固定 |
| 导航分组标题 | `--fs-hint` 11.2px + uppercase + muted | 小标签式 |

**已覆盖**：`SettingsSection` 的标题/卡片/描述规格（100% 对齐）
**缺口**：窗口骨架、导航、搜索、滚动容器

#### A2. 工作台类页面（6 页）

**对应 Hana**：`CapabilitiesPanel`（296 类）的多卡片布局

**当前状态**：moheng 用 `.panel` 平铺

**要做**：

| 项 | Hana 真值 | 说明 |
|---|---|---|
| 多卡片容器 | 卡片网格，gap 16px | 工作台的多个卡片 |
| 卡片独立滚动 | 每卡自己滚 | 不是整页滚 |
| 卡片标题层 | `tileTop` absolute 44px | 已挖透 |

**这块材料 100% 够**（第三篇文档已挖透 CardShell 的卡片壳）。

#### A3. 侧栏（所有页面共用）

**对应 Hana**：`_fp_*` 家族（40 类）

**当前状态**：moheng 有侧栏，但结构是单一宽度变化，没有抽屉态。

**要做**：

| 项 | Hana 真值 | 材料 |
|---|---|---|
| 双态渲染 | in-flow / overlay | ✅ 已挖透 |
| 悬停抽屉 300ms | `rc = 300` | ✅ 已挖透 |
| 宽度动画 | `.4s` + `cubic-bezier(.22,1,.36,1)` | ✅ 已挖透 |
| 空间变量 | `--bridge-panel-left` | ✅ 已挖透 |

**材料 100% 够，可以直接动手。**

#### A4. 顶栏（所有页面共用）

**状态**：✅ **已完成**（标题悬停 + 状态段 + fit-content）

---

### 第二梯队：类似，参考 Hana 改

#### B1. 列表+表格类（7 页）

**对应 Hana**：`CardShell` 的 25 个 row 类

**关键判断**：Hana 没有表格，但有**统一的列表行范式**。moheng 的表格行可以借用它的视觉语言。

**要做**：

| 项 | Hana 范式 | moheng 现状 | 怎么改 |
|---|---|---|---|
| 行高 | `min-height: 32px` | 表格行更高 | 参考，不一定照搬 |
| 行圆角 | `--radius-sm` × squircle | 表格行无圆角 | **可以加** |
| 行悬停 | `--overlay-light` | 有 hover | 对齐颜色 |
| 左侧标识 | `chipAvatar` 20px 圆形 | 有图标 | 对齐尺寸 |
| 状态点 | 5px 圆点 + accent | 有 `status-dot` | 对齐尺寸 |
| 表格容器 | `--radius-card` × squircle | 已有 | ✅ 已对齐 |

**这是「参考」，不是「照搬」**：表格必须有表头、列对齐、分页，这些 Hana 没有。但**行的视觉语言可以统一**。

#### B2. 详情类（2 页）

**对应 Hana**：`CardShell` 的 card 嵌套（`_card_` 在 `_card_` 里）

**要做**：卡片嵌套时的间距和圆角递减规则。

#### B3. 业务表单类（7 页）

**对应 Hana**：`SettingsForm` 的字段样式（50 类，只覆盖设置表单）

**要做**：字段的标签/输入/校验/错误态样式参考，但**布局不照搬**（业务表单有 2 列、3 列、跨列）。

---

### 第三梯队：重叠度低，基本不动

| 形态 | 页数 | 为什么不动 |
|---|---|---|
| 报表类 | 4 | Hana 完全没有报表设计器、报表预览 |
| LoginPage | 1 | Hana 无登录页（本地应用） |
| AnalysisPage | 1 | 图表分析，Hana 无 |
| AuditLogsPage | 1 | 已改（用了 SettingsSection） |

---

## 五、材料充分性核对

| 改造项 | 需要什么材料 | 有吗 |
|---|---|---|
| **A3 侧栏** | 双态渲染结构、300ms 探测、动画参数 | ✅ 100% |
| **A4 顶栏** | 已完成 | ✅ |
| **A1 设置窗骨架** | 窗口尺寸、导航、滚动、分组标题 | ⚠️ **缺**（只挖了 Section 单元） |
| **A2 工作台多卡片** | tileShell 卡片壳、标题层 | ✅ 100% |
| **B1 表格行范式** | row 类的完整 CSS | ⚠️ **部分**（只知道结构，没逐个提取值） |
| **B3 表单字段** | SettingsForm 的字段样式 | ⚠️ **部分** |

**结论：A2、A3、A4 可以立刻做。A1、B1、B3 需要补挖。**

---

## 六、建议的执行顺序

### 第一批（材料齐，立刻做）

1. **A3 侧栏改造**：双态渲染 + 悬停抽屉 + `.4s` 动画
2. **A2 补 tileShell 层**：`.app-content` 加卡片壳
3. **动效 token 对齐**：`.25s → .4s`

**这三项做完，moheng 的「骨架手感」会接近 Hana。** 预计 3-5 天。

### 第二批（需补挖，先挖再做）

4. **补挖 SettingsModalShell 骨架**（72 个骨架类）
5. **A1 设置窗改造**
6. **补挖 row 类完整 CSS**
7. **B1 表格行视觉统一**

预计 5-7 天。

### 第三批（参考性质）

8. **B3 表单字段样式参考**
9. **B2 卡片嵌套规则**

---

## 七、一个必须说清的事实

**「按 Hana 改」在 A1/A2/A3 是真的按 Hana 改，在 B1/B3 只能参考。**

因为：

```
A 类（设置/工作台/侧栏/顶栏）
  → Hana 有完全对应的组件
  → 可以源码级对齐

B 类（表格/业务表单）
  → Hana 没有对应形态
  → 只能借用视觉语言（圆角、间距、颜色、行高）
  → 结构必须自己设计
```

这不是妥协，是**产品差异的必然**。Hana 是聊天产品，moheng 是成本管理系统。

**报表类完全不动**，因为 Hana 没有任何报表能力。

---

## 附录：moheng 页面清单（36 个）

| 页面 | 大小 | 形态 | 处理 |
|---|---|---|---|
| AppearanceSettingsPage | 11.5KB | 设置 | A1 按 Hana 改 |
| AccountSecurityPage | 7.0KB | 设置 | A1 已改 |
| AccountSecurityStepPage | 7.2KB | 设置 | A1 |
| AssistantProviderPage | 16.4KB | 设置 | A1 |
| SystemSecurityPage | 10.7KB | 设置 | A1 |
| UserManagementPage | 14.7KB | 设置 | A1 |
| BusinessPartiesPage | 11.1KB | 列表 | B1 已改 |
| ContractsPage | 14.3KB | 列表 | B1 |
| ProjectsPage | 20.5KB | 列表 | B1 |
| NotificationsPage | 5.6KB | 列表 | B1 |
| ProjectMembersPage | 9.9KB | 列表 | B1 |
| SystemDictionariesPage | 18.5KB | 列表 | B1 |
| SystemAuthorizationPage | 16.9KB | 列表 | B1 已改 |
| BusinessPartyDetailPage | 21.6KB | 详情 | B2 |
| ProjectOverviewPage | 14.6KB | 详情 | B2 |
| SystemGovernancePage | 27.2KB | 工作台 | A2 |
| SystemManagementPage | 9.0KB | 工作台 | A2 |
| SystemOperationsPage | 17.5KB | 工作台 | A2 |
| SystemParametersPage | 18.5KB | 工作台 | A2 |
| SystemPoliciesPage | 16.0KB | 工作台 | A2 |
| DashboardPage | 12.8KB | 工作台 | A2 |
| BudgetPage | 42.7KB | 业务表单 | B3 |
| ChangesPage | 37.6KB | 业务表单 | B3 |
| CostsPage | 22.3KB | 业务表单 | B3 |
| DownstreamContractsPage | 38.4KB | 业务表单 | B3 |
| DownstreamFinancePage | 55.1KB | 业务表单 | B3 |
| OwnerFinancePage | 45.0KB | 业务表单 | B3 |
| ProgressBillsPage | 16.8KB | 业务表单 | B3 |
| ReportCenterPage | 13.6KB | 报表 | 不动 |
| ReportDesignerPage | 52.9KB | 报表 | 不动 |
| ReportPreviewPage | 29.8KB | 报表 | 不动 |
| ReportStudioPage | 35.9KB | 报表 | 不动 |
| AuditLogsPage | 15.6KB | 其他 | 已改 |
| LoginPage | 6.6KB | 其他 | 不动 |
| AnalysisPage | 9.7KB | 其他 | 不动 |
| DownstreamWorkspacePage | 0.4KB | 其他 | 不动 |
