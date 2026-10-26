# 按 Hana 设计重构工作区存储层

日期：2026-10-23

对照 `docs/Hana服务端工作区架构.md` 反推出的 Hana 设计，重构 moheng 的 `workspace-storage.ts`。

---

## 一、抄什么、改什么、不抄什么

| Hana 设计 | moheng 处理 | 理由 |
|---|---|---|
| `realpath` 路径解析 | **照抄** | 防符号链接穿越，当前实现有漏洞 |
| `_resolveReal` 的 ENOENT 向上查找 | **照抄** | 建多层目录时正确判权 |
| 隐藏文件过滤（`.` 开头） | **照抄** | `.git` / `.DS_Store` 不该出现在项目目录 |
| `isDir` + `size: null` | **照抄** | 显式 null 比 undefined 明确 |
| 批量上传逐项结果 | **照抄** | 单个失败不中断整批 |
| 四级权限模型 | **改造** | moheng 已有 16 个业务权限键，不需要再造一套 |
| 目录分级清单 | **改造** | 用 moheng 的权限键映射，不是硬编码目录名 |
| `ResourceIO` 抽象层 | **不抄** | moheng 只有本机存储，加这层是过度设计 |
| `mount capability` | **不抄** | `denyIfNoProjectAccess` 已覆盖 |
| `safeDelete` | **暂不抄** | 没有回收站，直接删够用 |

---

## 二、权限模型映射

Hana 的四级权限是**文件系统视角**，moheng 的权限是**业务视角**。两者不是一回事，但可以建立映射。

### 2.1 Hana 的四级

```js
BLOCKED     完全拒绝
READ_ONLY   只读
READ_WRITE  可读写，不可删
FULL        完全控制（可删）
```

### 2.2 moheng 的映射

moheng 的 `PROJECT_PERMISSION_BASELINES` 已有 16 个键。工作区只需要三个：

```ts
/** 工作区访问级别 */
export const WorkspaceAccess = {
  BLOCKED: 'blocked',       // 无 PROJECT_READ
  READ_ONLY: 'read_only',   // 有 PROJECT_READ，无 PROJECT_MANAGE
  READ_WRITE: 'read_write', // 有 PROJECT_MANAGE，无删除权
  FULL: 'full',             // OWNER（唯一可删）
} as const;
```

映射规则：

| moheng 权限 | Hana 级别 | 能力 |
|---|---|---|
| 无 `PROJECT_READ` | `BLOCKED` | 看不到 |
| `PROJECT_READ`（VIEWER/ESTIMATOR） | `READ_ONLY` | 列目录、预览、下载 |
| `PROJECT_MANAGE`（MANAGER） | `READ_WRITE` | 上传、建目录、重命名 |
| `OWNER` | `FULL` | 删除 |

**为什么删除只给 OWNER**：Hana 的 `delete` 只允许 `FULL`。文件删除是不可逆的，项目文件（合同扫描件、发票）尤其重要。MANAGER 可以传、可以改名，但删要 OWNER 确认。

**这是一处比 Hana 更严的设计**：Hana 的 `FULL` 是「工作区根目录」这个概念，任何有该根写权限的人都能删。moheng 用角色区分，更细。

### 2.3 动作与级别的映射（照抄 Hana）

```ts
const ACTION_LEVELS = {
  read:   new Set(['read_only', 'read_write', 'full']),
  write:  new Set(['read_write', 'full']),
  delete: new Set(['full']),
} as const;
```

---

## 三、路径解析（照抄 Hana）

### 3.1 `_resolveReal` 的实现

```ts
/**
 * 解析路径（跟踪符号链接）。
 *
 * 文件不存在时递归往上找最近的存在祖先目录，对它做 realpath，
 * 然后把不存在的段拼回去。这样 mkdir -p 多层目录时也能正确判断权限。
 *
 * 返回 null 表示解析失败（权限不足、路径非法）。
 */
function resolveReal(target: string): string | null {
  const abs = resolve(target);
  try {
    return realpathSync(abs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') return null;

    const segments: string[] = [];
    let cursor = abs;
    for (;;) {
      const parent = dirname(cursor);
      if (parent === cursor) return null;
      segments.push(basename(cursor));
      try {
        const realParent = realpathSync(parent);
        return join(realParent, ...segments.reverse());
      } catch (inner) {
        if ((inner as NodeJS.ErrnoException).code !== 'ENOENT') return null;
        cursor = parent;
      }
    }
  }
}
```

### 3.2 新的 `resolveEntry`

```ts
export function resolveEntry(
  projectId: string,
  relPath: string,
  workspaceRoot?: string | null,
): string {
  const base = projectDir(projectId, workspaceRoot);

  // 先判原始输入（在剥离前导斜杠之前）
  if (isAbsolute(relPath || '') || /^[a-zA-Z]:/.test(relPath || '')) {
    throw new Error('WORKSPACE_PATH_INVALID');
  }

  const cleaned = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  const target = resolve(base, cleaned);

  // 关键：解析真实路径，符号链接会展开
  const realTarget = resolveReal(target);
  const realBase = resolveReal(base);
  if (!realTarget || !realBase) throw new Error('WORKSPACE_PATH_INVALID');

  // Windows 大小写不敏感
  const targetLower = realTarget.toLowerCase();
  const baseLower = realBase.toLowerCase();
  if (targetLower !== baseLower && !targetLower.startsWith(`${baseLower}${sep}`)) {
    throw new Error('WORKSPACE_PATH_INVALID');
  }

  return target;   // 返回原始路径（不是 realpath），保留用户看到的路径
}
```

**为什么返回 `target` 而不是 `realTarget`**：realpath 只用于校验。返回真实路径会让前端看到 `C:\Windows\System32\...` 这种脱敏后的路径，破坏用户体验。

---

## 四、目录列表（照抄 Hana 的 `KBr`）

```ts
export type WorkspaceEntry = {
  name: string;
  /** 相对项目根的 POSIX 路径 */
  path: string;
  isDir: boolean;
  /** 目录为 null，不是 0 */
  size: number | null;
  mtime: string;
  ext?: string;
  hasChildren?: boolean;
};
```

**格式化规则**（照抄）：

```ts
const entries = dirents
  .filter((d) => !d.name.startsWith('.'))      // 隐藏文件
  .filter((d) => !d.isSymbolicLink())          // 符号链接
  .map(...)
  .sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh');
  });
```

**一处有意偏离**：Hana 用 `localeCompare(name, 'zh')`，我用 `localeCompare(name, 'zh-CN', { numeric: true })`。

理由：moheng 的文件名大量带编号（`合同-001`、`发票-10`），不加 `numeric` 会出现 `发票-10` 排在 `发票-2` 前面。

---

## 五、批量上传（照抄 Hana）

```ts
export type UploadResult = {
  name: string;
  ok: boolean;
  size?: number;
  sha256?: string;
  error?: string;
};

export async function uploadFiles(
  projectId: string,
  dir: string,
  files: Array<{ name: string; contentBase64: string }>,
  workspaceRoot?: string | null,
): Promise<{ ok: boolean; results: UploadResult[] }> {
  const results: UploadResult[] = [];
  for (const file of files) {
    try {
      const bytes = Buffer.from(file.contentBase64, 'base64');
      if (!bytes.length) throw new Error('WORKSPACE_EMPTY_FILE');
      const written = await writeEntry(projectId, [dir, file.name].filter(Boolean).join('/'), bytes, workspaceRoot);
      results.push({ name: file.name, ok: true, size: written.size, sha256: written.sha256 });
    } catch (error) {
      results.push({ name: file.name, ok: false, error: error instanceof Error ? error.message : 'upload_failed' });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
```

**与 Hana 一致**：单个失败不中断，返回逐项结果。

---

## 六、权限校验接入

### 6.1 新增权限判断函数

在 `workspace.ts` 里：

```ts
async function resolveAccess(userId: string, role: UserRole, projectId: string): Promise<WorkspaceAccessLevel> {
  const canRead = await canAccessProject(userId, role, projectId, undefined, 'PROJECT_READ');
  if (!canRead) return 'blocked';

  const canManage = await canAccessProject(userId, role, projectId, undefined, 'PROJECT_MANAGE');
  if (!canManage) return 'read_only';

  // OWNER 才可删
  const membership = await prisma.projectMember.findFirst({
    where: { projectId, userId },
    select: { role: true },
  });
  if (membership?.role === 'OWNER') return 'full';
  return 'read_write';
}
```

### 6.2 每个路由校验

```ts
const access = await resolveAccess(user.id, user.role, projectId);
if (!ACTION_LEVELS.read.has(access)) return failure(reply, 403, 'WORKSPACE_FORBIDDEN', '无权访问该项目工作区');

// 写操作
if (!ACTION_LEVELS.write.has(access)) return failure(reply, 403, ...);

// 删除
if (!ACTION_LEVELS.delete.has(access)) return failure(reply, 403, 'WORKSPACE_DELETE_FORBIDDEN', '只有项目负责人可以删除文件');
```

---

## 七、实施顺序

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 | `resolveReal` + 新 `resolveEntry` | 单测：符号链接穿越被拒 |
| 2 | `WorkspaceEntry` 改 `isDir` / `size: null` | 单测 + 前端适配 |
| 3 | 隐藏文件过滤 | 单测：`.git` 不出现 |
| 4 | `uploadFiles` 逐项结果 | 单测：一个失败其余成功 |
| 5 | `resolveAccess` + 路由接入 | API 实测：VIEWER 只读、MANAGER 可写、OWNER 可删 |
| 6 | 前端适配新字段 | 浏览器实测 |

---

## 八、测试要点

**符号链接穿越**（最关键）：

```
1. 项目目录建链接 escape → C:\Windows
2. 请求 /workspace/tree?path=escape
3. 期望：400 WORKSPACE_PATH_INVALID
```

**权限分级**：

```
VIEWER:   列目录 200 / 上传 403 / 删除 403
ESTIMATOR:列目录 200 / 上传 403 / 删除 403
MANAGER:  列目录 200 / 上传 201 / 删除 403
OWNER:    列目录 200 / 上传 201 / 删除 200
```

**隐藏文件**：

```
建 .git/、.DS_Store
期望：列目录不返回这两项
```

---

## 九、风险

**一、`realpath` 在 Windows 上对 junction 的处理**

`realpathSync` 会展开 junction（`mklink /J`），但需要确认它不会因为权限不足而抛错。测试时要用 junction 覆盖。

**二、`resolveReal` 的递归深度**

路径极深时 `for(;;)` 会多次 `realpathSync`。但只在 ENOENT 时进入，正常路径一次就返回。

**三、前端字段改名**

`kind: 'file' | 'dir'` → `isDir: boolean`，`WorkspacePanel.tsx` 里所有 `entry.kind === 'dir'` 都要改。这是纯机械替换，但要全量检查。
