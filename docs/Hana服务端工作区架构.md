# Hana 服务端工作区架构（从 bundle 反推）

日期：2026-10-23

来源：`resources/seed/server-1.1.35-beta-win32-x64.tar.gz` → `bundle/index.js`（12.77MB，328,687 行，未压缩、保留源码结构）。

**这份文件是唯一可读的服务端实现**。安装包里没有 TS 源码，但 `bundle/index.js` 是 ESM 形式、带原始注释、变量名被压缩但逻辑完整，可以准确反推架构。

---

## 一、核心发现：四级访问权限模型

Hana 不是「在不在根目录内」这种二元判断，而是四级：

```js
const go = {
  BLOCKED: "blocked",      // 完全拒绝
  READ_ONLY: "read_only",  // 只读
  READ_WRITE: "read_write",// 可读写，不可删
  FULL: "full"             // 完全控制（可删）
};
```

**动作与级别的映射表**：

```js
const OBr = {
  read:   new Set([READ_ONLY, READ_WRITE, FULL]),
  write:  new Set([READ_WRITE, FULL]),
  delete: new Set([FULL]),
  stage:  new Set([READ_ONLY, READ_WRITE, FULL])
};
```

注意 `stage`（把文件复制进缓存）**门槛与 read 相同**，注释写得很清楚：

> stage 的动作是读原文件、把副本复制进 `{HANA_HOME}/session-files/` 缓存（该缓存目录本就在授权写范围内），不向原路径写回，所以原路径门槛与 read 相同，可读即可交付。

---

## 二、目录分级清单

```js
// 完全 BLOCKED（敏感凭据）
const dTt = ["auth.json", "models.json", "added-models.yaml", "crash.log"];
const fTt = ["browser-data", "playwright-browsers"];

// READ_ONLY（人格文件，不可改）
const hTt = ["AGENTS.md", "ishiki.md", "config.yaml", "identity.md", "yuan.md"];

// READ_ONLY（用户资产）
const pTt = ["user", "skills", "session-files", "app-customizations"];

// READ_WRITE（agent 运行时数据）
const mTt = ["memory", "sessions", "desk", "heartbeat", ...];
```

`hTt` 里 `ishiki.md` 的注释值得注意：

> 人格文件的旧名字。启动时会把它改名成 AGENTS.md，但改名可能因为权限或文件被占用而失败；那种情况下旧文件还躺在 agent 目录里，这里留着它，免得一份本该只读的人格文件因为改名没成功就变成可写的。

**这是防御性设计**：改名失败时，旧文件仍在，如果不把它列入只读清单，它就会变成可写。moheng 没有这种「迁移后残留」的问题，但这个思路值得记：**清单要覆盖旧名字**。

---

## 三、路径解析：`_resolveReal`

```js
_resolveReal(e) {
  const r = S.resolve(e);
  try {
    return O.realpathSync(r);
  } catch (n) {
    if (n.code !== "ENOENT") return null;
    const s = [];
    let i = r;
    for (;;) {
      const o = S.dirname(i);
      if (o === i) return null;
      s.push(S.basename(i));
      try {
        const a = O.realpathSync(o);
        return s.reverse(), S.join(a, ...s);
      } catch (a) {
        if (a.code !== "ENOENT") return null;
        i = o;
      }
    }
  }
}
```

**这个实现解决了我踩过的坑。** 注释说：

> 文件不存在时递归往上找到最近的存在的祖先目录，对它做 realpath，然后把不存在的段拼回去。这样 mkdir -p 多层目录时也能正确判断权限。

我的 `workspace-storage.ts` 里 `makeDirectory` 就是因为父目录不存在而报 `ENOENT`，当时的修法是先 `mkdir` 父级。**Hana 的做法更正确**：先解析权限（向上找存在的祖先做 realpath），再决定能不能建。

**`realpath` 是关键**：只有它能把符号链接解析成真实路径，`resolve` 不会。如果只做 `resolve` + `startsWith`，符号链接可以链到任意位置。

---

## 四、API 契约

### 4.1 路由

```
GET  /api/workspace/files?subdir=       列一层
GET  /api/workspace/search?q=           按文件名搜
GET  /api/workspace/content             读内容
POST /api/workspace/actions             12 种写操作
POST /api/workspace/upload              批量上传
```

同一组路由注册了四个前缀（`/mobile/...`、`/workspace/...`、以及两个内部前缀），说明**手机端和桌面端共用同一套 API**。

### 4.2 `listFiles` 返回结构

```js
async listFiles(rootId = "default", subdir = "") {
  const root = this._resolveRootInternal(rootId);
  Y3(root, "list");                       // 校验 mount capability
  const dir = mw(subdir);                 // 规范化路径
  if (!__(root, dir)) throw ro("invalid path", "invalid_path", 400);
  const list = await this._resourceIO.list(G3(root, dir));
  return {
    rootId: root.id,
    mountId: root.mountId || root.id,
    mount: m1(root, this._discloseNativeRoot),
    subdir: dir,
    files: KBr(list.items)
  };
}
```

**文件项格式化**：

```js
function KBr(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((e) => e && !String(e.name || "").startsWith("."))   // 隐藏文件一律不返回
    .map((e) => ({
      name: e.name,
      isDir: !!e.isDirectory,
      size: e.isDirectory ? null : e.size ?? null,
      mtime: new Date(e.mtimeMs || 0).toISOString()
    }))
    .sort((e, r) => e.isDir !== r.isDir ? (e.isDir ? -1 : 1) : e.name.localeCompare(r.name, "zh"));
}
```

三个细节值得抄：

1. **隐藏文件（`.` 开头）直接过滤掉**，不返回给前端
2. **目录的 `size` 返回 `null`**，不是 0
3. **排序用 `localeCompare(name, "zh")`**，中文按拼音排

我的实现里用了 `localeCompare(name, 'zh-CN', { numeric: true })`，Hana 没有 `numeric`，所以 `10` 会排在 `2` 前面。**但 Hana 的排序是"目录在前 + 中文拼音"，我多加了数字自然排序，这个偏离是有意的**（文件名里的编号需要按数值排）。

### 4.3 `actions` 支持的操作

```js
switch (action) {
  case "mkdir":      f.mkdir(...)
  case "create":     f.writeText(...)
  case "writeText":  f.writeText(...)
  case "rename":     f.rename(...)
  case "move":       f.move(...)
  case "movePaths":  f.movePaths(...)
  case "safeDelete": f.safeDelete(...)
  default: return { error: "unknown_action" }, 400
}
```

**`safeDelete` 不是 `delete`**，名字暗示它会做额外检查（可能移到回收站而非真删）。这一点比我的 `removeEntry` 谨慎。

### 4.4 上传

```js
const p = Array.isArray(a.files) ? a.files : [a];
for (const y of p) {
  try {
    const w = String(y.contentBase64 || "");
    if (!w) throw WVe("contentBase64 required", "invalid_upload", 400);
    const b = Buffer.from(w, "base64");
    if (b.byteLength > hcn) throw WVe("file too large", "file_too_large", 413);
    const _ = await f.writeFileContent(c, h, y.name, b, m);
    g.push({ name: _.filename, ok: true, size: b.byteLength });
  } catch (w) {
    g.push({ name: y?.name || null, ok: false, error: w.code || "upload_failed" });
  }
}
return { ok: g.every((y) => y.ok), ... };
```

**批量上传 + 逐项结果**：单个失败不影响其他文件，返回数组里每项有 `ok` 和 `error`。我的实现是遇到错误就 `break`，这个差异明显。

---

## 五、ResourceIO 抽象

Hana 用 `_resourceIO` 统一所有文件访问：

```js
await this._resourceIO.list(path)
await this._resourceIO.search(path, { query, mode: "name", limit })
await this._resourceIO.stat(path)
await this._resourceIO.read(path)
```

**为什么要这层抽象**：注释说得很清楚：

> 读出文件字节（经 ResourceIO）。给不能直接读本机路径的根用：其他节点上的 mount 只能这样读。

意思是：**工作区可以是本机目录，也可以是远程节点上的目录**。`mount` 有 `sourceKind`（`storage` / 其他）、`provider`（`local_fs` / 其他）、`nodeId`（远程节点）。

```js
function m1(root, discloseNativeRoot = false) {
  const { path, platform, ...rest } = root;
  return discloseNativeRoot && !root.nodeId && root.sourceKind === "storage" && root.provider === "local_fs" && typeof path === "string" && path
    ? { ...rest, nativeRootPath: path }
    : rest;
}
```

**本机路径只在特定条件下才暴露**（`discloseNativeRoot` + 无 `nodeId` + `local_fs`）。这是防止远程 mount 泄露路径。

---

## 六、mount capability 校验

```js
function Y3(root, capability) {
  if (!root.capabilities?.includes(capability))
    throw ro("mount capability denied", "mount_capability_denied", 403);
}
```

每个 mount 声明自己支持的能力（`list` / `read` / `write` / ...），调用前校验。

**这意味着权限不只看路径，还要看 mount 的能力声明**。一个只读挂载点即使路径合法也不能写。

---

## 七、对 moheng 的改进建议

### 7.1 必须改的（安全性）

**一、`realpath` 而不是 `resolve`**

我的实现：

```ts
const target = resolve(base, cleaned);
if (!targetLower.startsWith(baseLower)) throw ...
```

问题：`resolve` 不解析符号链接。如果项目目录里有人建了符号链接指向 `C:\Windows`，`resolve` 后的路径仍显示在项目内，但实际访问的是系统目录。

我的 `readdir` 跳过了符号链接（`isSymbolicLink()` 检查），但**直接访问路径时没有 realpath 校验**。

应该改成：

```ts
function resolveEntry(projectId, relPath, workspaceRoot) {
  const base = projectDir(projectId, workspaceRoot);
  const target = resolve(base, cleaned);
  // 解析真实路径（符号链接会展开）
  const real = resolveReal(target);   // ENOENT 时向上找存在的祖先
  if (!isInside(real, resolveReal(base))) throw ...
}
```

**二、`_resolveReal` 的 ENOENT 处理**

我的 `makeDirectory` 在父目录不存在时报错，修法是先建父级。Hana 的做法是先解析权限再建，更正确。

### 7.2 值得抄的（健壮性）

**三、批量上传的逐项结果**

我的实现：

```ts
for (const file of Array.from(files)) {
  try { ... } catch (error) { setNotice(...); break; }   // 一个失败就中断
}
```

应该改成收集每项结果，返回 `{ name, ok, error }`，前端逐项显示。

**四、隐藏文件过滤**

Hana 的 `KBr` 过滤 `.` 开头的文件。我的实现会返回 `.git`、`.DS_Store` 等。项目目录里这些很常见，应该过滤。

**五、`isDir` + `size: null`**

我的返回结构是 `kind: 'file' | 'dir'` 和 `size?: number`。Hana 用 `isDir: boolean` 和 `size: null`（显式 null，不是 undefined）。差异不大，但 `null` 更明确。

### 7.3 不抄的（架构不匹配）

**六、ResourceIO 抽象层**

moheng 只有本机存储，不需要为远程 mount 做抽象。加这层是过度设计。

**七、mount capability**

moheng 的项目权限已经由 `denyIfNoProjectAccess` 覆盖，不需要再叠一层 mount capability。

**八、`safeDelete`**

如果将来要做回收站，值得。现在直接删够用。

---

## 八、Hana 服务端的依赖清单（有参考价值）

```json
{
  "exceljs": "4.4.0",        // XLSX 读写
  "mammoth": "1.11.0",       // docx → HTML
  "jsdom": "29.0.2",         // HTML 解析
  "yauzl": "3.4.0",          // zip 解压
  "sharp": "0.35.4",         // 图片处理
  "better-sqlite3": "12.11.1", // 本地数据库
  "node-pty": "1.1.0",       // 终端
  "@node-rs/jieba": "2.0.1"  // 中文分词（全文搜索）
}
```

**对 moheng 工作区的直接启示**：

- XLSX 预览用 `exceljs`（Hana 也用这个，不是我之前想的 SheetJS）
- docx 预览用 `mammoth`
- 中文搜索用 `@node-rs/jieba` 分词（如果将来要做全文搜索）

---

## 九、验证

反推的依据：

```
bundle/index.js        328,687 行 / 12.77MB
ESM import 形式         未压缩成单行
保留原始中文注释        可直接读懂设计意图
```

关键类 `R9`（权限策略）、`_resolveReal`、`listFiles`、`KBr`、`m1`、`Y3` 全部定位到行号并核对过。

---

## 十、结论

**Hana 的工作区架构比我实现的更严谨，主要差在三点**：

1. **`realpath` 解析**（防符号链接穿越）
2. **四级权限模型**（不是二元判断）
3. **批量操作的逐项结果**（不因单点失败中断）

**但它的复杂有一部分是为了「远程 mount」**，moheng 只有本机存储，那部分不需要抄。

**下一步建议**：先补 `realpath` 校验和隐藏文件过滤，这两项是真实安全/体验缺口。
