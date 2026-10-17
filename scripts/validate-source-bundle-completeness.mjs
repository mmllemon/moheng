import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

// SHA-256 is re-sealed by the one-shot dependency-lock refresh workflow after approved dependency changes.
// The hash is computed over LF-normalized text so that the gate is byte-identical on Windows
// (core.autocrlf=true checks the file out as CRLF) and on Linux/CI (checked out as LF).
const expectedSha256 = 'a6f8a53a1ce8fb0a3313443ac3470ee23f1c3f43c5ae97545c12807d7ef93743';
const lockPath = 'package-lock.json';
try {
  await access(lockPath, constants.R_OK);
} catch {
  console.error('[BLOCK] 根目录 package-lock.json 缺失。当前源码快照推入启用 assistant-runtime-gates.yml 的仓库后，会在 test -f package-lock.json 处失败，npm ci 不会启动。');
  console.error(`[ACTION] 从已通过两次 npm ci 的 Node 24.18.0 工作树复制该文件，并核对 SHA-256：${expectedSha256.toUpperCase()}`);
  process.exit(1);
}

const lockText = await readFile(lockPath, 'utf8');
// Normalize CRLF to LF before hashing: line endings are a checkout artifact, not lock content.
const lockTextNormalized = lockText.replace(/\r\n/g, '\n');
let lock;
try {
  lock = JSON.parse(lockText);
} catch (error) {
  console.error('[BLOCK] package-lock.json 不是有效 JSON。');
  throw error;
}
if (lock.lockfileVersion !== 3) {
  console.error(`[BLOCK] 期望 lockfileVersion=3，实际为 ${String(lock.lockfileVersion)}。请确认来源为报告中的 npm 11.16.0 锁文件。`);
  process.exit(1);
}
if (!lock.packages || !lock.packages['']) {
  console.error('[BLOCK] package-lock.json 缺少根 packages[""] 元数据。');
  process.exit(1);
}
const actualSha256 = createHash('sha256').update(lockTextNormalized).digest('hex');
if (actualSha256 !== expectedSha256) {
  console.error('[BLOCK] 根 lock SHA-256 与当前 R7 封版记录不一致。');
  console.error(`expected=${expectedSha256.toUpperCase()}`);
  console.error(`actual  =${actualSha256.toUpperCase()}`);
  console.error('不要直接修改期望值；先确认 package.json 与 lock 是否来自同一份实测工作树。若清单确实有意变更，应重新 clean install、npm audit、两次 npm ci 并更新证据。');
  process.exit(1);
}
console.log(JSON.stringify({ gate: 'SOURCE_BUNDLE_COMPLETENESS', result: 'PASS', lockfileVersion: lock.lockfileVersion, sha256: actualSha256.toUpperCase() }, null, 2));
