/**
 * 项目工作区文件存储。
 *
 * 布局：{WORKSPACE_STORAGE_DIR}/projects/{projectId}/...  直接映射文件系统目录树。
 *
 * 为什么不建数据库表：
 *   - 目录就是树，不需要维护 parentId/path/depth 三份冗余
 *   - 用户可以用资源管理器直接查看、直接改，不需要同步
 *   - 删库不丢文件
 *
 * 代价：没有文件元数据（谁传的、什么时候）。需要时加旁挂表，以相对路径为主键。
 *
 * 安全边界（必须全部满足）：
 *   1. 路径穿越：realpath 解析后必须仍在项目根内
 *   2. 符号链接：readdir 跳过链接；路径校验用 realpath 展开
 *   3. 扩展名白名单：禁止可执行/脚本
 *   4. 单文件大小上限
 *
 * 设计参考 Hana 服务端的 workspace-storage（bundle/index.js 的 R9 / _resolveReal / KBr）。
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';

export type WorkspaceEntry = {
  name: string;
  /** 相对项目根的 POSIX 风格路径，用 / 分隔 */
  path: string;
  /** 对齐 Hana 的 isDir：布尔比 kind 字符串更好判断 */
  isDir: boolean;
  /** 目录为 null（不是 0），与 Hana 的 KBr 一致 */
  size: number | null;
  mtime: string;
  ext?: string;
  /** 目录是否非空，决定要不要显示展开箭头 */
  hasChildren?: boolean;
};

/** 允许预览/上传的扩展名。不在表里的拒绝上传，已存在的仍可下载。 */
const ALLOWED_EXTENSIONS = new Set([
  // 文档
  '.pdf', '.txt', '.md', '.csv', '.json', '.log', '.xml', '.html',
  // 表格
  '.xlsx', '.xls',
  // 图片
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg',
  // 办公
  '.doc', '.docx', '.ppt', '.pptx',
  // 压缩（仅存储，不预览）
  '.zip', '.rar', '.7z',
  // 邮件
  '.eml',
]);

/** 明确拒绝：可执行、脚本、系统文件 */
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.ps1', '.psm1', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.sh', '.bash', '.zsh', '.dll', '.so', '.dylib',
  '.jar', '.app', '.deb', '.rpm', '.apk',
]);

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

function storageRoot(): string {
  const configured = process.env.WORKSPACE_STORAGE_DIR?.trim();
  return resolve(configured || resolve(process.cwd(), 'data', 'workspace'));
}

/** 项目根目录的绝对路径 */
export function projectDir(projectId: string, workspaceRoot?: string | null): string {
  const root = storageRoot();
  // workspaceRoot 只允许单层目录名，防止借它跳出 projects 层
  const dirName = workspaceRoot?.trim() || projectId;
  if (isAbsolute(dirName) || dirName.includes('..') || dirName.includes('/') || dirName.includes('\\')) {
    throw new Error('WORKSPACE_ROOT_INVALID');
  }
  return resolve(root, 'projects', dirName);
}

/**
 * 解析路径（跟踪符号链接）。
 *
 * 文件不存在时递归往上找最近的存在祖先目录，对它做 realpath，
 * 然后把不存在的段拼回去。这样 mkdir -p 多层目录时也能正确判断权限。
 *
 * 对齐 Hana 的 _resolveReal（bundle/index.js L91084）。
 * 返回 null 表示解析失败（权限不足、路径非法、符号链接成环）。
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

/**
 * 把用户给的相对路径解析成绝对路径，并确保没有跳出项目根。
 *
 * 两道检查：
 *   1. 原始输入不能是绝对路径（必须在剥离前导斜杠之前判）
 *   2. resolve 后用 realpath 解析，确保符号链接没有跳到根外
 *
 * Windows 大小写不敏感，所以比较前统一 toLowerCase。
 *
 * 返回的是原始路径（不是 realpath）—— realpath 只用于校验，
 * 否则前端会看到脱敏后的系统路径。
 */
export function resolveEntry(projectId: string, relPath: string, workspaceRoot?: string | null): string {
  const base = projectDir(projectId, workspaceRoot);

  // 先判原始输入。注意要在剥离前导斜杠之前判，
  // 否则 /etc/passwd 会被规范化成相对路径而绕过检查。
  if (isAbsolute(relPath || '') || /^[a-zA-Z]:/.test(relPath || '')) {
    throw new Error('WORKSPACE_PATH_INVALID');
  }

  const cleaned = (relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (isAbsolute(cleaned)) throw new Error('WORKSPACE_PATH_INVALID');

  const target = resolve(base, cleaned);

  // 关键：用 realpath 展开符号链接后再比对。
  // 只用 resolve + startsWith 挡不住“项目内建链接指向系统目录”。
  const realTarget = resolveReal(target);
  const realBase = resolveReal(base);
  if (!realTarget || !realBase) throw new Error('WORKSPACE_PATH_INVALID');

  const targetLower = realTarget.toLowerCase();
  const baseLower = realBase.toLowerCase();
  // 必须严格在 base 之内（base 自身也允许，表示项目根）
  if (targetLower !== baseLower && !targetLower.startsWith(`${baseLower}${sep}`)) {
    throw new Error('WORKSPACE_PATH_INVALID');
  }

  return target;
}

/** 把绝对路径转回相对项目根的 POSIX 路径 */
function toRelative(projectId: string, absolute: string, workspaceRoot?: string | null): string {
  const base = projectDir(projectId, workspaceRoot);
  const rel = absolute.slice(base.length).replace(/\\/g, '/').replace(/^\/+/, '');
  return rel;
}

/** 校验扩展名：上传用 */
export function assertUploadAllowed(fileName: string): void {
  const ext = extname(fileName).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) throw new Error(`WORKSPACE_EXT_BLOCKED:${ext}`);
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error(`WORKSPACE_EXT_NOT_ALLOWED:${ext || '(无扩展名)'}`);
}

/** 文件名净化：去掉控制字符、路径分隔符，限制长度 */
export function safeName(value: string): string {
  const leaf = basename(value.replace(/[\\/]/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!leaf || leaf === '.' || leaf === '..') throw new Error('WORKSPACE_NAME_INVALID');
  return leaf.slice(0, 180);
}

/** 目录是否非空。读到第一个 entry 就停，避免大目录全量扫描。 */
async function dirHasChildren(absolute: string): Promise<boolean> {
  try {
    for await (const entry of await readdir(absolute, { withFileTypes: true })) {
      void entry;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 列出一层目录（懒加载）。
 *
 * 对齐 Hana 的 KBr：
 *   - 过滤 `.` 开头的隐藏文件（.git / .DS_Store 不应出现）
 *   - 目录的 size 返回 null（不是 0）
 *   - 目录在前，同类按中文拼音排
 *
 * 一处有意偏离：排序加了 numeric，因为 moheng 的文件名大量带编号
 * （合同-001 / 发票-10），不加会出现“发票-10 排在发票-2 前面”。
 */
export async function listDirectory(
  projectId: string,
  relPath: string,
  workspaceRoot?: string | null,
): Promise<WorkspaceEntry[]> {
  const absolute = resolveEntry(projectId, relPath, workspaceRoot);

  let dirents;
  try {
    dirents = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw error;
  }

  const entries: WorkspaceEntry[] = [];
  for (const dirent of dirents) {
    // 隐藏文件不过滤会让 .git / .DS_Store 出现在项目目录里
    if (dirent.name.startsWith('.')) continue;
    // 符号链接一律跳过：可以链到系统目录，是路径穿越的常见入口
    if (dirent.isSymbolicLink()) continue;
    if (!dirent.isFile() && !dirent.isDirectory()) continue;

    const childAbs = join(absolute, dirent.name);
    const childRel = toRelative(projectId, childAbs, workspaceRoot);

    if (dirent.isDirectory()) {
      entries.push({
        name: dirent.name,
        path: childRel,
        isDir: true,
        size: null,
        mtime: '',
        hasChildren: await dirHasChildren(childAbs),
      });
    } else {
      let size: number | null = null;
      let mtime = '';
      try {
        const info = await stat(childAbs);
        size = info.size;
        mtime = info.mtime.toISOString();
      } catch { /* 读取失败仍列出，元数据留空 */ }
      entries.push({
        name: dirent.name,
        path: childRel,
        isDir: false,
        size,
        mtime,
        ext: extname(dirent.name).toLowerCase(),
      });
    }
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });

  return entries;
}

/** 读文件内容。超过 MAX_PREVIEW_BYTES 时抛错，由上层转成「太大，请下载」。 */
export async function readEntry(
  projectId: string,
  relPath: string,
  workspaceRoot?: string | null,
): Promise<{ bytes: Buffer; size: number; mimeType: string }> {
  const absolute = resolveEntry(projectId, relPath, workspaceRoot);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error('WORKSPACE_NOT_A_FILE');
  if (info.size > MAX_PREVIEW_BYTES) throw new Error(`WORKSPACE_TOO_LARGE:${info.size}`);

  const bytes = await readFile(absolute);
  return { bytes, size: info.size, mimeType: mimeFromExt(extname(relPath).toLowerCase()) };
}

/** 取文件流（下载/PDF iframe 用，不限大小） */
export async function openEntry(
  projectId: string,
  relPath: string,
  workspaceRoot?: string | null,
): Promise<{ handle: Awaited<ReturnType<typeof open>>; size: number; mimeType: string; name: string }> {
  const absolute = resolveEntry(projectId, relPath, workspaceRoot);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error('WORKSPACE_NOT_A_FILE');
  const handle = await open(absolute, 'r');
  return { handle, size: info.size, mimeType: mimeFromExt(extname(relPath).toLowerCase()), name: basename(absolute) };
}

/** 写文件。flag: 'wx' 保证不覆盖已有文件，避免并发写坏数据。 */
export async function writeEntry(
  projectId: string,
  relPath: string,
  bytes: Buffer,
  workspaceRoot?: string | null,
  overwrite = false,
): Promise<{ path: string; size: number; sha256: string }> {
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`WORKSPACE_TOO_LARGE:${bytes.length}`);

  const absolute = resolveEntry(projectId, relPath, workspaceRoot);
  const name = basename(absolute);
  assertUploadAllowed(name);

  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, bytes, { flag: overwrite ? 'w' : 'wx', mode: 0o600 });

  return {
    path: toRelative(projectId, absolute, workspaceRoot),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export type UploadResult = {
  name: string;
  ok: boolean;
  size?: number;
  sha256?: string;
  error?: string;
};

/**
 * 批量上传。
 *
 * 对齐 Hana 的 upload 行为：单个失败不中断整批，返回逐项结果。
 * 前端可以逐文件显示成功/失败，而不是一个错误就全部作废。
 */
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
      const relPath = [dir.replace(/^\/+|\/+$/g, ''), safeName(file.name)].filter(Boolean).join('/');
      const written = await writeEntry(projectId, relPath, bytes, workspaceRoot);
      results.push({ name: file.name, ok: true, size: written.size, sha256: written.sha256 });
    } catch (error) {
      results.push({
        name: file.name,
        ok: false,
        error: error instanceof Error ? error.message : 'upload_failed',
      });
    }
  }

  return { ok: results.every((r) => r.ok), results };
}

/** 新建目录 */
export async function makeDirectory(
  projectId: string,
  relPath: string,
  workspaceRoot?: string | null,
): Promise<string> {
  const absolute = resolveEntry(projectId, relPath, workspaceRoot);
  // 父目录可能还不存在（新项目第一次建目录），先递归建父级，再独占建目标
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await mkdir(absolute, { recursive: false });
  return toRelative(projectId, absolute, workspaceRoot);
}

/** 删除文件或目录（目录递归删除） */
export async function removeEntry(
  projectId: string,
  relPath: string,
  workspaceRoot?: string | null,
): Promise<void> {
  const absolute = resolveEntry(projectId, relPath, workspaceRoot);
  // 不允许删项目根
  if (absolute.toLowerCase() === projectDir(projectId, workspaceRoot).toLowerCase()) {
    throw new Error('WORKSPACE_CANNOT_REMOVE_ROOT');
  }
  await rm(absolute, { recursive: true, force: false });
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.log': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.zip': 'application/zip', '.eml': 'message/rfc822',
  };
  return map[ext] || 'application/octet-stream';
}
