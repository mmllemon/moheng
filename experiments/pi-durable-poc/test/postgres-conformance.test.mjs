import '../src/load-root-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const databaseUrl = process.env.ASSISTANT_POC_DATABASE_URL?.trim();
const enabled = process.env.NODE_ENV === 'test' && process.env.ASSISTANT_POC_ALLOW_PG_TESTS === 'true' && Boolean(databaseUrl) && databaseUrl !== process.env.DATABASE_URL;

test('PostgreSQL probe implements the same request/status/owner contract (real isolated database)', { skip: !enabled }, async () => {
  const { Pool } = await import('pg');
  const { openPostgresProbe } = await import('../src/storage-probe.mjs');
  const { randomUUID } = await import('node:crypto');
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const input = { ownerUserId: `user-${randomUUID()}`, conversationId: `conversation-${randomUUID()}`, requestId: `request-${randomUUID()}`, payload: { promptHash: 'fixed', version: 1 } };
  const schema = `moheng_poc_test_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  let store;
  try {
    store = await openPostgresProbe(pool, schema);
    const first = await store.submit(input);
    const retry = await store.submit(input);
    assert.equal(retry.id, first.id);
    assert.equal(retry.duplicate, true);
    const concurrentRetries = await Promise.all(Array.from({ length: 8 }, () => store.submit(input)));
    assert.ok(concurrentRetries.every((item) => item.id === first.id && item.duplicate === true));
    assert.equal(await store.eventCount(input), 1, 'concurrent retries must not create duplicate SUBMITTED events');
    await assert.rejects(() => store.submit({ ...input, payload: { promptHash: 'changed' } }), /IDEMPOTENCY_CONFLICT/);
    assert.equal(await store.getForOwner({ ownerUserId: `other-${randomUUID()}`, id: first.id }), null);
    await store.markRunning(input);
    const result = { ok: true, sourceCount: 3 };
    assert.equal((await store.complete({ ...input, result })).status, 'COMPLETED');
    assert.deepEqual((await store.complete({ ...input, result })).result, result);
    assert.equal(await store.eventCount(input), 3);
  } finally {
    if (store) await store.close();
    await pool.end();
  }
});
