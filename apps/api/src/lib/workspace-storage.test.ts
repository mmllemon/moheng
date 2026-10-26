import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  assertUploadAllowed,
  listDirectory,
  makeDirectory,
  projectDir,
  readEntry,
  removeEntry,
  resolveEntry,
  safeName,
  uploadFiles,
  writeEntry,
} from './workspace-storage.js';

let ROOT: string;

before(async () => {
  ROOT = await mkdtemp(join(tmpdir(), 'moheng-ws-'));
  process.env.WORKSPACE_STORAGE_DIR = ROOT;
});

after(async () => {
  await rm(ROOT, { recursive: true, force: true });
  delete process.env.WORKSPACE_STORAGE_DIR;
});

describe('路径安全', () => {
  it('正常相对路径解析到项目根内', () => {
    const p = resolveEntry('p1', '合同/主合同.pdf');
    assert.ok(p.toLowerCase().includes('projects'));
    assert.ok(p.endsWith('主合同.pdf'));
  });

  it('拒绝 .. 穿越', () => {
    assert.throws(() => resolveEntry('p1', '../../etc/passwd'), /WORKSPACE_PATH_INVALID/);
    assert.throws(() => resolveEntry('p1', '合同/../../outside.txt'), /WORKSPACE_PATH_INVALID/);
  });

  it('拒绝绝对路径', () => {
    assert.throws(() => resolveEntry('p1', 'C:/Windows/system32'), /WORKSPACE_PATH_INVALID/);
    assert.throws(() => resolveEntry('p1', '/etc/passwd'), /WORKSPACE_PATH_INVALID/);
  });

  it('拒绝反斜杠形式的穿越', () => {
    assert.throws(() => resolveEntry('p1', '..\\..\\windows'), /WORKSPACE_PATH_INVALID/);
  });

  it('workspaceRoot 不允许带路径分隔符', () => {
    assert.throws(() => projectDir('p1', '../outside'), /WORKSPACE_ROOT_INVALID/);
    assert.throws(() => projectDir('p1', 'a/b'), /WORKSPACE_ROOT_INVALID/);
    assert.throws(() => projectDir('p1', 'C:\\abs'), /WORKSPACE_ROOT_INVALID/);
  });

  it('空路径解析到项目根', () => {
    const p = resolveEntry('p1', '');
    assert.equal(p.toLowerCase(), projectDir('p1').toLowerCase());
  });
});

describe('文件名净化', () => {
  it('去掉路径分隔符只留文件名', () => {
    assert.equal(safeName('a/b/c.txt'), 'c.txt');
    assert.equal(safeName('..\\..\\evil.txt'), 'evil.txt');
  });

  it('拒绝空名与点名', () => {
    assert.throws(() => safeName(''), /WORKSPACE_NAME_INVALID/);
    assert.throws(() => safeName('..'), /WORKSPACE_NAME_INVALID/);
  });

  it('截断超长文件名', () => {
    const long = 'a'.repeat(500) + '.txt';
    assert.ok(safeName(long).length <= 180);
  });
});

describe('扩展名白名单', () => {
  it('允许常见文档与图片', () => {
    for (const name of ['a.pdf', 'b.xlsx', 'c.png', 'd.docx', 'e.csv']) {
      assert.doesNotThrow(() => assertUploadAllowed(name));
    }
  });

  it('拒绝可执行与脚本', () => {
    for (const name of ['a.exe', 'b.bat', 'c.ps1', 'd.sh', 'e.js', 'f.dll']) {
      assert.throws(() => assertUploadAllowed(name), /WORKSPACE_EXT_BLOCKED/);
    }
  });

  it('拒绝未登记的扩展名', () => {
    assert.throws(() => assertUploadAllowed('a.xyz'), /WORKSPACE_EXT_NOT_ALLOWED/);
  });
});

describe('目录操作', () => {
  it('写文件后能列出', async () => {
    await writeEntry('p2', '合同/主合同.pdf', Buffer.from('pdf-content'));
    const entries = await listDirectory('p2', '');
    assert.equal(entries.length, 1);
    const first = entries[0];
    assert.ok(first);
    assert.equal(first.isDir, true);
    assert.equal(first.name, '合同');
    assert.equal(first.size, null);   // 目录 size 为 null，不是 0
    assert.equal(first.hasChildren, true);
  });

  it('列出单层不递归', async () => {
    await writeEntry('p2', '合同/附件/a.pdf', Buffer.from('x'));
    const root = await listDirectory('p2', '');
    assert.equal(root.filter((e) => !e.isDir).length, 0);
    const contract = await listDirectory('p2', '合同');
    assert.equal(contract.filter((e) => !e.isDir).length, 1);
    assert.equal(contract.filter((e) => e.isDir).length, 1);
  });

  it('目录排在文件前，名称按数值排序', async () => {
    await writeEntry('p3', 'b.txt', Buffer.from('b'));
    await writeEntry('p3', 'a.txt', Buffer.from('a'));
    await writeEntry('p3', '10.txt', Buffer.from('10'));
    await writeEntry('p3', '2.txt', Buffer.from('2'));
    await makeDirectory('p3', 'zzz-dir');
    const entries = await listDirectory('p3', '');
    assert.equal(entries[0]?.isDir, true);
    const files = entries.filter((e) => !e.isDir).map((e) => e.name);
    assert.deepEqual(files, ['2.txt', '10.txt', 'a.txt', 'b.txt']);
  });

  it('隐藏文件不返回', async () => {
    // 隐藏文件用 writeFile 直接建（上传白名单不允许无扩展名文件，
    // 但用户用资源管理器放进去的应该被过滤）
    const base = projectDir('p11');
    await mkdir(join(base, '.git'), { recursive: true });
    await writeFile(join(base, '.git', 'config'), 'x');
    await writeFile(join(base, '.DS_Store'), 'x');
    await writeEntry('p11', '正常.txt', Buffer.from('x'));

    const entries = await listDirectory('p11', '');
    const names = entries.map((e) => e.name);
    assert.equal(names.includes('.git'), false);
    assert.equal(names.includes('.DS_Store'), false);
    assert.equal(names.includes('正常.txt'), true);
  });

  it('空目录 hasChildren 为 false', async () => {
    await makeDirectory('p4', '空目录');
    const entries = await listDirectory('p4', '');
    assert.equal(entries[0]?.hasChildren, false);
  });

  it('不存在的目录返回空数组而不是抛错', async () => {
    const entries = await listDirectory('p5', '不存在');
    assert.deepEqual(entries, []);
  });
});

describe('读写', () => {
  it('读回写入的内容', async () => {
    await writeEntry('p6', 'note.txt', Buffer.from('hello 世界', 'utf8'));
    const { bytes, mimeType } = await readEntry('p6', 'note.txt');
    assert.equal(bytes.toString('utf8'), 'hello 世界');
    assert.match(mimeType, /text\/plain/);
  });

  it('默认不覆盖已有文件', async () => {
    await writeEntry('p7', 'dup.txt', Buffer.from('first'));
    await assert.rejects(() => writeEntry('p7', 'dup.txt', Buffer.from('second')), /EEXIST/);
  });

  it('显式允许时覆盖', async () => {
    await writeEntry('p7', 'dup.txt', Buffer.from('second'), null, true);
    const { bytes } = await readEntry('p7', 'dup.txt');
    assert.equal(bytes.toString('utf8'), 'second');
  });

  it('拒绝上传黑名单扩展名', async () => {
    await assert.rejects(() => writeEntry('p8', 'evil.exe', Buffer.from('MZ')), /WORKSPACE_EXT_BLOCKED/);
  });
});

describe('批量上传', () => {
  it('单个失败不中断整批', async () => {
    const ok = Buffer.from('ok').toString('base64');
    const { ok: allOk, results } = await uploadFiles('p13', '', [
      { name: 'a.txt', contentBase64: ok },
      { name: 'evil.exe', contentBase64: ok },   // 被白名单拦下
      { name: 'b.txt', contentBase64: ok },
    ]);
    assert.equal(allOk, false);
    assert.equal(results.length, 3);
    assert.equal(results[0]?.ok, true);
    assert.equal(results[1]?.ok, false);
    assert.equal(results[2]?.ok, true);
    // 后两个成功写入
    const names = (await listDirectory('p13', '')).map((e) => e.name);
    assert.ok(names.includes('a.txt'));
    assert.ok(names.includes('b.txt'));
  });

  it('全部成功时 ok 为 true', async () => {
    const b = Buffer.from('x').toString('base64');
    const { ok, results } = await uploadFiles('p14', '子目录', [
      { name: 'x.txt', contentBase64: b },
      { name: 'y.txt', contentBase64: b },
    ]);
    assert.equal(ok, true);
    assert.equal(results.length, 2);
    const entries = await listDirectory('p14', '子目录');
    assert.equal(entries.length, 2);
  });
});

describe('删除', () => {
  it('删除文件', async () => {
    await writeEntry('p9', 'tmp.txt', Buffer.from('x'));
    await removeEntry('p9', 'tmp.txt');
    const entries = await listDirectory('p9', '');
    assert.equal(entries.length, 0);
  });

  it('递归删除目录', async () => {
    await writeEntry('p9', 'dir/a.txt', Buffer.from('x'));
    await writeEntry('p9', 'dir/sub/b.txt', Buffer.from('y'));
    await removeEntry('p9', 'dir');
    assert.deepEqual(await listDirectory('p9', ''), []);
  });

  it('拒绝删除项目根', async () => {
    await assert.rejects(() => removeEntry('p9', ''), /WORKSPACE_CANNOT_REMOVE_ROOT/);
  });
});

describe('符号链接', () => {
  it('列出目录时跳过符号链接', async () => {
    const base = projectDir('p10');
    await mkdir(base, { recursive: true });
    await writeFile(join(base, 'normal.txt'), 'ok');
    // 指向项目根之外的链接
    try {
      await symlink(tmpdir(), join(base, 'escape-link'), 'junction');
    } catch {
      // Windows 上创建符号链接需要权限，跳过该断言
      return;
    }
    const entries = await listDirectory('p10', '');
    assert.equal(entries.filter((e) => e.name === 'escape-link').length, 0);
    assert.equal(entries.filter((e) => e.name === 'normal.txt').length, 1);
  });

  it('通过符号链接访问根外路径被拒绝', async () => {
    const base = projectDir('p12');
    await mkdir(base, { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), 'moheng-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'secret');
      try {
        await symlink(outside, join(base, 'escape'), 'junction');
      } catch {
        return;   // 无权限建链接，跳过
      }
      // 经过链接的路径必须被 realpath 校验拦住
      assert.throws(() => resolveEntry('p12', 'escape/secret.txt'), /WORKSPACE_PATH_INVALID/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
