import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqliteProbe } from '../src/storage-probe.mjs';

const baseInput = { ownerUserId: 'user-a', conversationId: 'conversation-1', requestId: 'request-1', payload: { text: 'hello', toolset: 'readonly-v1' } };

test('SQLite probe persists state and enforces idempotency + owner isolation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moheng-storage-test-'));
  const path = join(dir, 'store.sqlite');
  let store;
  try {
    store = openSqliteProbe(path);
    const first = store.submit(baseInput);
    assert.equal(first.status, 'QUEUED');
    const retry = store.submit(baseInput);
    assert.equal(retry.id, first.id);
    assert.equal(retry.duplicate, true);
    assert.equal(store.eventCount(baseInput), 1, 'idempotent retry must not create a second submission event');
    assert.throws(() => store.submit({ ...baseInput, payload: { text: 'different content' } }), /IDEMPOTENCY_CONFLICT/);
    assert.equal(store.getForOwner({ ownerUserId: 'user-b', id: first.id }), null, 'another owner must not retrieve the submission');
    store.markRunning(baseInput);
    const result = { answer: 'read only', sources: ['CostEntry.amount'], generatedAt: '2026-10-16T00:00:00.000Z' };
    const completed = store.complete({ ...baseInput, result });
    assert.equal(completed.status, 'COMPLETED');
    assert.deepEqual(completed.result, result);
    assert.deepEqual(store.complete({ ...baseInput, result }).result, result, 'same completion retry must be idempotent');
    assert.equal(store.eventCount(baseInput), 3);
    store.close();
    store = undefined;

    // Opening a new process/store handle acts as the portable baseline for restart recovery.
    store = openSqliteProbe(path);
    const recovered = store.getForOwner({ ownerUserId: 'user-a', id: first.id });
    assert.equal(recovered?.status, 'COMPLETED');
    assert.deepEqual(recovered?.result, result);
  } finally {
    store?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('SQLite probe rejects invalid state transitions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moheng-storage-state-'));
  const store = openSqliteProbe(join(dir, 'state.sqlite'));
  try {
    store.submit(baseInput);
    const result = { ok: true };
    store.complete({ ...baseInput, result });
    assert.throws(() => store.markRunning(baseInput), /INVALID_STATE_TRANSITION/);
    assert.throws(() => store.complete({ ...baseInput, result: { ok: false } }), /RESULT_CONFLICT/);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
