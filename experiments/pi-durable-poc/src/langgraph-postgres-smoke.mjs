import './load-root-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const databaseUrl = process.env.ASSISTANT_POC_DATABASE_URL?.trim();
if (process.env.ASSISTANT_POC_ALLOW_PG_TESTS !== 'true' || process.env.NODE_ENV !== 'test' || !databaseUrl) {
  throw new Error('真实 PostgreSQL 对照必须同时设置 NODE_ENV=test、ASSISTANT_POC_ALLOW_PG_TESTS=true 与 ASSISTANT_POC_DATABASE_URL');
}
if (process.env.DATABASE_URL && databaseUrl === process.env.DATABASE_URL) {
  throw new Error('拒绝把存储对照指向墨衡业务 DATABASE_URL；请使用独立的 disposable 测试库');
}

const suffix = `${process.pid}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
const schema = `moheng_poc_${suffix}`;
const threadId = `storage-smoke-${randomUUID()}`;
const adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
let saver;
try {
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  saver = PostgresSaver.fromConnString(databaseUrl, { schema });
  await saver.setup();
  const config = { configurable: { thread_id: threadId, checkpoint_ns: '' } };
  const marker = `pg-checkpoint-${randomUUID()}`;
  const checkpoint = {
    v: 1,
    ts: new Date().toISOString(),
    id: randomUUID(),
    channel_values: { pocMarker: marker, counter: 1 },
    channel_versions: { __start__: 1, pocMarker: 1, counter: 1 },
    versions_seen: { __input__: {} },
    pending_sends: [],
  };
  const savedConfig = await saver.put(config, checkpoint, { source: 'input', step: 0, writes: null, parents: {} }, { pocMarker: '1', counter: '1' });
  const firstRead = await saver.getTuple(savedConfig);
  assert.equal(firstRead?.checkpoint?.channel_values?.pocMarker, marker);
  await saver.end();
  saver = undefined;

  // Recreate the saver instance and re-read the same checkpoint to prove persistence across client close/reopen.
  saver = PostgresSaver.fromConnString(databaseUrl, { schema });
  await saver.setup();
  const recovered = await saver.getTuple(savedConfig);
  assert.equal(recovered?.checkpoint?.channel_values?.pocMarker, marker);
  assert.equal(recovered?.checkpoint?.channel_values?.counter, 1);
  console.log(JSON.stringify({
    gate: 'LANGGRAPH_POSTGRES_CHECKPOINT_REOPEN',
    result: 'PASS',
    schema,
    threadId,
    recoveredAfterSaverReopen: true,
    note: '这是 LangGraph PostgresSaver 的持久化 smoke test，不代表 Pi Durable PostgreSQL Storage adapter 已实现或通过 conformance。',
  }, null, 2));
} finally {
  if (saver) await saver.end().catch(() => undefined);
  // Schema name is generated and strictly restricted above; only this isolated schema is dropped.
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
  await adminPool.end();
}
