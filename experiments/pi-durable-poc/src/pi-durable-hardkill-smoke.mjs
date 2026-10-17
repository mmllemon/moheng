import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { defineDoc, createRegistry, Harness } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { assertSafePocSqlitePath, resolvePocRepoPath, POC_REPO_ROOT } from './safe-storage-path.mjs';

const tempRoot = process.env.PI_POC_STORAGE_PATH ? null : await mkdtemp(join(tmpdir(), 'moheng-pi-durable-hardkill-'));
const storagePath = assertSafePocSqlitePath(process.env.PI_POC_STORAGE_PATH ?? join(tempRoot, 'hardkill.sqlite'));
await mkdir(dirname(storagePath), { recursive: true, mode: 0o700 });
const ProbeDoc = defineDoc({
  kind: 'moheng.poc.hardkill-smoke',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ marker: '', committedAt: '' }),
});

const childScript = resolvePocRepoPath('experiments/pi-durable-poc/src/pi-durable-hardkill-child.mjs');
const child = spawn(process.execPath, [childScript, storagePath], { cwd: POC_REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const stdout = createInterface({ input: child.stdout });
let childStderr = '';
child.stderr.setEncoding('utf8').on('data', (chunk) => { childStderr += chunk; });
let harness;
try {
  const announcement = await new Promise((resolvePromise, reject) => {
    let done = false;
    const finish = (action, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      action(value);
    };
    const timeout = setTimeout(() => finish(reject, new Error(`CHILD_COMMIT_TIMEOUT; stderr=${childStderr.slice(-1500)}`)), 15000);
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => finish(reject, new Error(`CHILD_EXITED_BEFORE_COMMIT code=${code} signal=${signal}; stderr=${childStderr.slice(-1500)}`)));
    stdout.once('line', (line) => {
      try { finish(resolvePromise, JSON.parse(line)); } catch (error) { finish(reject, error); }
    });
  });

  child.kill('SIGKILL');
  await new Promise((resolvePromise, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolvePromise();
    child.once('exit', () => resolvePromise());
    child.once('error', reject);
  });

  harness = await Harness.open(await openNodeSqliteStorage(storagePath), { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
  harness.resume();
  const recovered = await harness.snapshot(ProbeDoc, announcement.conversationId, BACKGROUND_CONTEXT);
  assert.equal(recovered?.marker, announcement.marker, 'committed document must survive abrupt process termination');
  assert.ok(recovered?.committedAt);
  console.log(JSON.stringify({
    gate: 'PI_DURABLE_SQLITE_PROCESS_KILL_RECOVERY',
    result: 'PASS',
    storagePath,
    conversationId: announcement.conversationId,
    recoveredAfterProcessKill: true,
    storageAdapter: 'Pi Durable openNodeSqliteStorage',
    warning: '这是进程被强制终止测试，不是机器断电/主机崩溃测试。Node SQLite WAL synchronous=NORMAL 的最新提交仍可能在断电/主机故障下丢失；生产需单独评估同步策略与备份。',
  }, null, 2));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolvePromise) => child.once('exit', resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 2000)),
    ]);
  }
  if (harness) await harness.close(BACKGROUND_CONTEXT).catch(() => undefined);
  await chmod(storagePath, 0o600).catch(() => undefined);
  stdout.close();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}
