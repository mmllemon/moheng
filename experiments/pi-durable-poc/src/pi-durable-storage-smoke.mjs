import assert from 'node:assert/strict';
import { mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertSafePocSqlitePath } from './safe-storage-path.mjs';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { defineDoc, createRegistry, Harness } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';

const storagePath = assertSafePocSqlitePath(process.env.PI_POC_STORAGE_PATH ?? 'experiments/pi-durable-poc/.data/pi-durable-storage-smoke.sqlite');
await mkdir(dirname(storagePath), { recursive: true, mode: 0o700 });

const ProbeDoc = defineDoc({
  kind: 'moheng.poc.storage-smoke',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ marker: '', commitCount: 0, lastWrittenAt: '' }),
});

async function open() {
  return Harness.open(await openNodeSqliteStorage(storagePath), { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
}

let harness;
try {
  harness = await open();
  const root = await harness.root(BACKGROUND_CONTEXT);
  const conversationId = root.id;
  await root.commit(async (tx) => {
    const doc = await tx.doc(ProbeDoc, conversationId);
    if (!doc.marker) doc.marker = `sqlite-proof-${Date.now()}`;
    doc.commitCount += 1;
    doc.lastWrittenAt = new Date().toISOString();
  }, BACKGROUND_CONTEXT);
  const written = await harness.snapshot(ProbeDoc, conversationId, BACKGROUND_CONTEXT);
  assert.ok(written?.marker);
  const persistedMarker = written.marker;
  const persistedCount = written.commitCount;
  await harness.close(BACKGROUND_CONTEXT);
  harness = undefined;

  // This is a real close/reopen against Pi Durable's built-in SQLite adapter, not a mock store.
  harness = await open();
  harness.resume();
  const reopenedRoot = await harness.root(BACKGROUND_CONTEXT);
  assert.equal(reopenedRoot.id, conversationId, 'root conversation id should persist after reopen');
  const recovered = await harness.snapshot(ProbeDoc, conversationId, BACKGROUND_CONTEXT);
  assert.equal(recovered?.marker, persistedMarker, 'document data should persist after reopen');
  assert.equal(recovered?.commitCount, persistedCount, 'committed state should persist after reopen');
  console.log(JSON.stringify({
    gate: 'PI_DURABLE_SQLITE_REOPEN',
    result: 'PASS',
    storagePath,
    conversationId,
    marker: recovered.marker,
    commitCount: recovered.commitCount,
    recoveredAfterCloseReopen: true,
    warning: '这验证的是干净关闭/重开；不等于强制 kill、断电、磁盘满或官方完整存储 conformance suite。',
  }, null, 2));
} finally {
  if (harness) await harness.close(BACKGROUND_CONTEXT).catch(() => undefined);
  // POSIX permissions are best-effort. Windows production deployments must set NTFS ACLs explicitly.
  await chmod(storagePath, 0o600).catch(() => undefined);
}
