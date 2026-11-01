# 工作区按 Hana 设计重构（落地记录）

日期：2026-10-23

依据 `docs/Hana服务端工作区架构.md` 反推出的 Hana 设计，重构 `workspace-storage.ts` 与工作区 API。

---

## 一、抄了什么

| Hana 设计 | moheng 实现 | 验证 |
|---|---|---|
| `realpath` 路径解析 | `resolveReal()` + 新 `resolveEntry()` | 单测：符号链接穿越被拒 |
| `_resolveReal` 的 ENOENT 向上查找 | 同上 | 建多层目录时正确判权 |
| 隐藏文件过滤 | `listDirectory` 过滤 `.` 开头 | 单测：`.git` / `.DS_Store` 不出现 |
| `isDir` + `size: null` | `WorkspaceEntry` 字段 | API 实测：目录 `size: null` |
| 批量上传逐项结果 | `uploadFiles()` + `/workspace/upload` | 实测：3 文件 2 成功 1 拦截 |
| 四级权限模型 | 映射到 moheng 角色 | 实测：VIEWER 只读 / MANAGER 可写 / OWNER 可删 |

## 二、改造了什么

### 2.1 权限模型：映射而不是照搬

Hana 的四级是**文件系统视角**，moheng 的权限是**业务视角**。

```ts
type WorkspaceAccessLevel = 'blocked' | 'read_only' | 'read_write' | 'full';

const ACTION_LEVELS = {
  read:   new Set(['read_only', 'read_write', 'full']),
  write:  new Set(['read_write', 'full']),
  delete: new Set(['full']),
};
```

角色映射：

| 角色 | 级别 | 能力 |
|---|---|---|
| OWNER / ADMIN | `full` | 读、写、删 |
| MANAGER | `read_write` | 读、写 |
| ESTIMATOR / VIEWER | `read_only` | 只读 |
| 非成员 | `blocked` | 拒绝 |

**比 Hana 更严的一点**：删除只给 OWNER。Hana 的 `FULL` 是「工作区根可写」这个概念，moheng 用角色区分——合同扫描件、发票删了不可逆。

### 2.2 一处必须绕开的坑

第一版 `resolveAccess` 用了 `canAccessProject(..., 'PROJECT_MANAGE')`，实测 **VIEWER 也能写入**。

根因在 `project-access.ts`：

```ts
const published = await prisma.governanceRuleVersion.findFirst({ ... });
if (!published) return true;    // ← 未发布治理规则时，任意 permissionKey 都返回 true
```

所以 `PROJECT_MANAGE` 的检查在默认状态下形同虚设。

改成**直接按角色判**，不依赖 `permissionKey`：

```ts
switch (membership.role) {
  case 'OWNER': return 'full';
  case 'MANAGER': return 'read_write';
  default: return 'read_only';
}
```

## 三、不抄什么

| Hana | 原因 |
|---|---|
| `ResourceIO` 抽象层 | moheng 只有本机存储，加这层是过度设计 |
| `mount capability` | `denyIfNoProjectAccess` 已覆盖 |
| `safeDelete` | 没有回收站，直接删够用 |

---

## 四、实测

### 4.1 权限分级

```
         读     写     删
VIEWER   200   403   403
MANAGER  200   201   403
ADMIN    200   201   200
```

### 4.2 批量上传

```
✓ 合同A.pdf
✗ evil.exe  WORKSPACE_EXT_BLOCKED:.exe
✓ 说明.txt
→ ok=false，但两个合法文件都已写入
```

### 4.3 隐藏文件

```
条目: 合同A.pdf, 说明.txt
.DS_Store 出现: ✓ 已过滤
.git 出现:      ✓ 已过滤
```

### 4.4 符号链接穿越

```
项目内建 junction 指向 C:\Windows
GET /workspace/tree?path=escape → 400 WORKSPACE_PATH_INVALID ✓
```

### 4.5 字段结构

```json
{ "name": "合同A.pdf", "isDir": false, "size": 10, "mtime": "..." }
目录: { "isDir": true, "size": null }
```

### 4.6 目录缩进

```
depth 0 → grid 第一列 0px
depth 1 → grid 第一列 12px
```

### 4.7 单元测试

```
29 项 / 8 suite 全过
新增：符号链接穿越、隐藏文件过滤、批量上传逐项结果
```

---

## 五、这一轮踩的坑

### 坑一：替换脚本漏改导致预览消失

我批量把 `entry.kind === 'dir'` 改成 `entry.isDir`，但漏掉了 `selected.kind === 'file'`（它没有 `entry.` 前缀）。结果点文件后预览区完全不渲染。

**教训**：批量替换后必须 grep 残留字段名，不能只看 TypeScript 通过——`selected.kind` 在类型上仍是合法属性（因为 `selected` 是 `WorkspaceEntry | null`，TS 只在访问时检查）。

### 坑二：`min-height` 撑破容器

给 `.workspace-preview` 设 `min-height: 320px` 后，档案区底部溢出视口 23px。

**原因**：父级 `height: calc(100dvh - 326px)` 是固定值，子项 `min-height` 超过剩余空间就会溢出，即使父级有 `overflow: hidden`（那只裁内容，不阻止子项撑大）。

**修法**：`min-height: 160px`，靠 `flex: 1` 分配。

### 坑三：`100dvh - 260px` 算错

第一版用 `height: calc(100dvh - 260px)`，实测档案区底部 966，视口 900，**溢出 66px**。

260 是我猜的（顶栏 44 + 页头 + KPI + 工具栏），实际是 326。

**教训**：不要用视口减法硬编码，除非量过。量法是 `element.getBoundingClientRect().top`。

### 坑四：Chrome PDF 插件的 6px 暗边无法用 CSS 消除

试了三种参数：

| 参数 | 白像素占比 | 暗像素 |
|---|---|---|
| `view=FitH` | 99% | 6 |
| `view=Fit` | 57% | 266 |
| `zoom=page-width` | 86% | 91 |

`FitH` 最好，但右侧仍有 6px 暗边——那是 Chrome PDF 插件的固有内边距，`::-webkit-scrollbar` 和 iframe 尺寸都碰不到。

**要完全消除需要 PDF.js 自绘**（未做）。

### 坑五：点击文件夹会清掉预览

原实现 `toggle()` 对文件夹也调 `onSelect(entry)`，导致展开文件夹时正在预览的文件被取消选中。

**修法**：文件夹只切换展开，不改选中。上传目标目录改用「最后展开的文件夹」（`lastDir` state）。

---

## 六、验证

```
工作区单元测试   29/29 passed
权限分级实测     VIEWER/MANAGER/ADMIN 三档正确
批量上传实测     逐项结果正确
隐藏文件实测     已过滤
符号链接实测     400 拒绝
PDF 预览实测     99% 白像素，文字可见
UI 规范检查      75/75 passed
视觉回归         26 路由 0 failure
TypeScript       前后端通过
```

---

## 七、未做

| 项 | 原因 |
|---|---|
| PDF.js 自绘预览 | Chrome 插件够用，6px 暗边可接受 |
| 回收站 / safeDelete | 无业务需求 |
| ResourceIO 抽象 | 只有本机存储 |
| 拖拽移动文件 | 需要完整 dnd |
| XLSX 预览 | 下一步，用 `exceljs`（Hana 也用这个） |
