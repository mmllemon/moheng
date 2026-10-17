import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openSqliteProbe, openPostgresProbe } from './storage-probe.mjs';

const iterations = Math.max(20, Math.min(5000, Number.parseInt(process.env.ASSISTANT_POC_BENCHMARK_ITERATIONS ?? '300', 10) || 300));
const tempRoot = await mkdtemp(join(tmpdir(), 'moheng-assistant-storage-'));
const sqlitePath = join(tempRoot, 'probe.sqlite');
const results = [];

async function benchmark(store, kind) {
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const input = {
      ownerUserId: `user-${i % 5}`,
      conversationId: `conversation-${i % 12}`,
      requestId: `${kind}-${i}`,
      payload: { promptHash: `hash-${i}`, toolsetVersion: 'readonly-v1' },
    };
    const first = await store.submit(input);
    const duplicate = await store.submit(input);
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.duplicate, true);
    await store.markRunning(input);
    const completed = await store.complete({ ...input, result: { ok: true, ordinal: i, sourceCount: 3 } });
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(store.kind === 'sqlite-probe' ? store.eventCount(input) : await store.eventCount(input), 3);
    // A request key belongs to the owner; cross-user lookup must never return the row.
    assert.equal(store.kind === 'sqlite-probe'
      ? store.getForOwner({ ownerUserId: 'another-user', id: first.id })
      : await store.getForOwner({ ownerUserId: 'another-user', id: first.id }), null);
  }
  const elapsedMs = performance.now() - started;
  return { backend: kind, iterations, elapsedMs: Number(elapsedMs.toFixed(2)), iterationsPerSecond: Number((iterations / (elapsedMs / 1000)).toFixed(1)) };
}

try {
  const sqlite = openSqliteProbe(sqlitePath);
  try { results.push(await benchmark(sqlite, 'sqlite-probe')); } finally { sqlite.close(); }
  const info = await stat(sqlitePath);

  let postgres = { status: 'SKIPPED', reason: '未同时显式启用测试模式并提供独立 PostgreSQL 测试库；没有伪造 PostgreSQL 结果。' };
  if (process.env.ASSISTANT_POC_ALLOW_PG_TESTS === 'true' && process.env.NODE_ENV === 'test') {
    // Load local app env only after explicit opt-in, so ordinary SQLite-only runs need no dotenv dependency.
    await import('./load-root-env.mjs');
    const databaseUrl = process.env.ASSISTANT_POC_DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error('已启用 PostgreSQL 对照但缺少 ASSISTANT_POC_DATABASE_URL');
    if (process.env.DATABASE_URL && databaseUrl === process.env.DATABASE_URL) throw new Error('拒绝把存储对照指向墨衡业务 DATABASE_URL');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const schemaName = `moheng_poc_bench_${process.pid}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    let store;
    try {
      store = await openPostgresProbe(pool, schemaName);
      const result = await benchmark(store, 'postgres-probe');
      results.push(result);
      postgres = { status: 'MEASURED', result };
    } finally {
      if (store) await store.close().catch(() => undefined);
      await pool.end();
    }
  }

  console.log(JSON.stringify({
    gate: 'STORAGE_SUBMISSION_SEMANTICS_COMPARISON',
    measurementKind: 'same minimal submission/event contract, not a Pi Durable Storage implementation benchmark',
    environment: { node: process.version, iterations, sqliteBytesAfterClose: info.size },
    results,
    postgres,
    conclusions: [
      '本地 SQLite 测量用于快速验证请求幂等、状态迁移、事件原子写入及所有者隔离，不可直接外推到完整 Agent transcript/task/doc 存储。',
      'PostgreSQL 只有在隔离测试库真实执行后才列出实测结果；该探针只比较最小请求/状态/event 子集。',
      'Pi Durable SQLite 的实际 API/关闭重开单独由 storage:pi smoke test 检查；LangGraph 的 PostgresSaver 单独由 storage:langgraph 检查。',
    ],
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
