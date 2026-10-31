// 门禁源码读取器：把「断言某个具名文件含 X」升级为「断言该模块的源码集合含 X」。
//
// 背景：本仓库的内容门禁长期按单个具名文件 grep 源码。超长文件拆分后，被断言的代码
// 搬进了同模块的兄弟文件/同名子目录，入口文件不再含那段文本，门禁就会误报红——
// 守卫的产品不变量仍然成立，只是位置变了。这里显式登记拆分产物，让门禁按模块取源码。
//
// 设计约束（重要）：
//   1. 只登记「因拆分而多出来的文件」，不做目录通配的隐式扩张；新增拆分需要人工加一行。
//   2. 顺序确定（入口文件在前，其余按登记顺序），保证多次运行结果可复现。
//   3. 本模块不改变任何断言逻辑，只改变读取范围。负向断言（!includes）会随范围变大而
//      变严格，这是刻意的：禁令应在整个模块上成立。
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

// 入口文件 -> 拆分出来的兄弟文件（相对仓库根）。
const COMPANIONS = {
  'apps/api/src/lib/report-studio-data.ts': [
    'apps/api/src/lib/report-studio-sources.ts',
    'apps/api/src/lib/report-studio-party-dataset.ts',
  ],
  'apps/web/src/components/Layout.tsx': [
    'apps/web/src/components/layout-config.ts',
  ],
  'apps/web/src/components/WorkspacePanel.tsx': [
    'apps/web/src/components/WorkspacePanelTree.tsx',
    'apps/web/src/components/WorkspacePanelPreview.tsx',
    'apps/web/src/lib/workspace-types.ts',
    'apps/web/src/lib/workspace-format.ts',
  ],
};

// 入口文件 -> 同名子目录（routes/system-management.ts + routes/system-management/*.ts）。
async function dirFiles(root, entry) {
  const dir = join(root, dirname(entry), basename(entry, extname(entry)));
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.ts') || n.endsWith('.tsx'))
    .sort()
    .map((n) => `${dirname(entry)}/${basename(entry, extname(entry))}/${n}`.replace(/\\/g, '/'));
}

const cache = new Map();

export async function moduleFiles(root, entry) {
  const key = `${root}::${entry}`;
  if (!cache.has(key)) {
    cache.set(key, [entry, ...(await dirFiles(root, entry)), ...(COMPANIONS[entry] ?? [])]);
  }
  return cache.get(key);
}

/**
 * 推荐入口：沿用调用方门禁自己的 read()，只扩大文件范围，不改变读取语义。
 *
 * 为什么要传 read 而不是内部自己 readFile：各门禁的 read 并不一致，
 * 有的会把 CRLF 归一为 LF（如 validate-report-studio-v2），有的不会（如
 * validate-typescript-fixes）。多行字面量断言（includes('a:\n   select:')）对这一点敏感。
 * 继承各自的 read，才能保证“只改范围、不改语义”。
 */
export async function readModule(read, root, entry) {
  const files = await moduleFiles(root, entry);
  return (await Promise.all(files.map((f) => read(f)))).join('\n');
}

/** 读取入口文件所属模块的全部源码，按确定顺序拼接（不做行尾归一）。 */
export async function readModuleSources(root, entry) {
  return readModule((f) => readFile(join(root, f), 'utf8'), root, entry);
}
