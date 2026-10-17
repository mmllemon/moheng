import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const payloadHash = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

function normalizeSqliteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    conversationId: row.conversation_id,
    requestId: row.request_id,
    payloadHash: row.payload_hash,
    status: row.status,
    result: row.result_json == null ? null : JSON.parse(row.result_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function openSqliteProbe(filePath) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS poc_submissions (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','COMPLETED','INTERRUPTED')),
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_user_id, conversation_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS poc_submission_events (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES poc_submissions(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS poc_submission_owner_idx ON poc_submissions(owner_user_id, created_at);
    CREATE INDEX IF NOT EXISTS poc_event_submission_idx ON poc_submission_events(submission_id, created_at);
  `);

  const findStatement = db.prepare(`SELECT * FROM poc_submissions WHERE owner_user_id=? AND conversation_id=? AND request_id=?`);
  const findByIdStatement = db.prepare(`SELECT * FROM poc_submissions WHERE owner_user_id=? AND id=?`);
  const insertSubmission = db.prepare(`INSERT INTO poc_submissions(id,owner_user_id,conversation_id,request_id,payload_hash,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED',NULL,?,?)`);
  const insertEvent = db.prepare(`INSERT INTO poc_submission_events(id,submission_id,event_type,created_at) VALUES(?,?,?,?)`);
  const updateStatus = db.prepare(`UPDATE poc_submissions SET status=?,result_json=?,updated_at=? WHERE owner_user_id=? AND conversation_id=? AND request_id=? AND status IN ('QUEUED','RUNNING')`);
  const countEvents = db.prepare(`SELECT COUNT(*) AS count FROM poc_submission_events e JOIN poc_submissions s ON s.id=e.submission_id WHERE s.owner_user_id=? AND s.conversation_id=? AND s.request_id=?`);

  return {
    kind: 'sqlite-probe',
    filePath,
    submit({ ownerUserId, conversationId, requestId, payload }) {
      if (![ownerUserId, conversationId, requestId].every((item) => typeof item === 'string' && item.length > 0)) throw new Error('INVALID_SUBMISSION_KEY');
      const hash = payloadHash(payload);
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = normalizeSqliteRow(findStatement.get(ownerUserId, conversationId, requestId));
        if (existing) {
          if (existing.payloadHash !== hash) throw new Error('IDEMPOTENCY_CONFLICT');
          db.exec('COMMIT');
          return { ...existing, duplicate: true };
        }
        const id = randomUUID();
        insertSubmission.run(id, ownerUserId, conversationId, requestId, hash, now, now);
        insertEvent.run(randomUUID(), id, 'SUBMITTED', now);
        db.exec('COMMIT');
        return { id, ownerUserId, conversationId, requestId, payloadHash: hash, status: 'QUEUED', result: null, createdAt: now, updatedAt: now, duplicate: false };
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    },
    markRunning({ ownerUserId, conversationId, requestId }) {
      const now = new Date().toISOString();
      const row = normalizeSqliteRow(findStatement.get(ownerUserId, conversationId, requestId));
      if (!row) throw new Error('SUBMISSION_NOT_FOUND');
      if (row.status === 'RUNNING') return row;
      if (row.status !== 'QUEUED') throw new Error('INVALID_STATE_TRANSITION');
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = normalizeSqliteRow(findStatement.get(ownerUserId, conversationId, requestId));
        if (!current || current.status !== 'QUEUED') throw new Error('INVALID_STATE_TRANSITION');
        updateStatus.run('RUNNING', null, now, ownerUserId, conversationId, requestId);
        insertEvent.run(randomUUID(), current.id, 'RUNNING', now);
        db.exec('COMMIT');
        return normalizeSqliteRow(findStatement.get(ownerUserId, conversationId, requestId));
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    },
    complete({ ownerUserId, conversationId, requestId, result }) {
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = normalizeSqliteRow(findStatement.get(ownerUserId, conversationId, requestId));
        if (!existing) throw new Error('SUBMISSION_NOT_FOUND');
        if (existing.status === 'COMPLETED') {
          if (canonicalJson(existing.result) !== canonicalJson(result)) throw new Error('RESULT_CONFLICT');
          db.exec('COMMIT');
          return existing;
        }
        if (!['QUEUED', 'RUNNING'].includes(existing.status)) throw new Error('INVALID_STATE_TRANSITION');
        updateStatus.run('COMPLETED', JSON.stringify(result), now, ownerUserId, conversationId, requestId);
        insertEvent.run(randomUUID(), existing.id, 'COMPLETED', now);
        db.exec('COMMIT');
        return normalizeSqliteRow(findStatement.get(ownerUserId, conversationId, requestId));
      } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    },
    getForOwner({ ownerUserId, id }) { return normalizeSqliteRow(findByIdStatement.get(ownerUserId, id)); },
    eventCount({ ownerUserId, conversationId, requestId }) { return Number(countEvents.get(ownerUserId, conversationId, requestId).count); },
    close() { db.close(); },
  };
}

function normalizePgRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    conversationId: row.conversation_id,
    requestId: row.request_id,
    payloadHash: row.payload_hash,
    status: row.status,
    result: row.result_json == null ? null : (typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function openPostgresProbe(pool, schemaName) {
  if (!/^moheng_poc_[a-z0-9_]+$/.test(schemaName)) throw new Error('UNSAFE_SCHEMA_NAME');
  const schema = `"${schemaName}"`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  try {
  await pool.query(`
    CREATE TABLE ${schema}.poc_submissions (
      id text PRIMARY KEY,
      owner_user_id text NOT NULL,
      conversation_id text NOT NULL,
      request_id text NOT NULL,
      payload_hash text NOT NULL,
      status text NOT NULL CHECK (status IN ('QUEUED','RUNNING','COMPLETED','INTERRUPTED')),
      result_json jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE(owner_user_id, conversation_id, request_id)
    );
    CREATE TABLE ${schema}.poc_submission_events (
      id text PRIMARY KEY,
      submission_id text NOT NULL REFERENCES ${schema}.poc_submissions(id) ON DELETE CASCADE,
      event_type text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE INDEX poc_submission_owner_idx_${schemaName.slice(-12)} ON ${schema}.poc_submissions(owner_user_id, created_at);
    CREATE INDEX poc_event_submission_idx_${schemaName.slice(-12)} ON ${schema}.poc_submission_events(submission_id, created_at);
  `);

  const find = async (client, ownerUserId, conversationId, requestId, forUpdate = false) => {
    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const result = await client.query(`SELECT * FROM ${schema}.poc_submissions WHERE owner_user_id=$1 AND conversation_id=$2 AND request_id=$3${lockClause}`, [ownerUserId, conversationId, requestId]);
    return normalizePgRow(result.rows[0]);
  };
  return {
    kind: 'postgres-probe', schemaName,
    async submit({ ownerUserId, conversationId, requestId, payload }) {
      const hash = payloadHash(payload);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const id = randomUUID();
        const now = new Date();
        const inserted = await client.query(`INSERT INTO ${schema}.poc_submissions(id,owner_user_id,conversation_id,request_id,payload_hash,status,result_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'QUEUED',NULL,$6,$6) ON CONFLICT(owner_user_id,conversation_id,request_id) DO NOTHING RETURNING *`, [id, ownerUserId, conversationId, requestId, hash, now]);
        if (inserted.rowCount) {
          await client.query(`INSERT INTO ${schema}.poc_submission_events(id,submission_id,event_type,created_at) VALUES($1,$2,'SUBMITTED',$3)`, [randomUUID(), id, now]);
          await client.query('COMMIT');
          return { ...normalizePgRow(inserted.rows[0]), duplicate: false };
        }
        const existing = await find(client, ownerUserId, conversationId, requestId);
        if (!existing) throw new Error('SUBMISSION_NOT_FOUND');
        if (existing.payloadHash !== hash) throw new Error('IDEMPOTENCY_CONFLICT');
        await client.query('COMMIT');
        return { ...existing, duplicate: true };
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      } finally { client.release(); }
    },
    async markRunning({ ownerUserId, conversationId, requestId }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await find(client, ownerUserId, conversationId, requestId, true);
        if (!current) throw new Error('SUBMISSION_NOT_FOUND');
        if (current.status === 'RUNNING') { await client.query('COMMIT'); return current; }
        if (current.status !== 'QUEUED') throw new Error('INVALID_STATE_TRANSITION');
        const now = new Date();
        await client.query(`UPDATE ${schema}.poc_submissions SET status='RUNNING',updated_at=$1 WHERE id=$2 AND owner_user_id=$3`, [now, current.id, ownerUserId]);
        await client.query(`INSERT INTO ${schema}.poc_submission_events(id,submission_id,event_type,created_at) VALUES($1,$2,'RUNNING',$3)`, [randomUUID(), current.id, now]);
        await client.query('COMMIT');
        return find(pool, ownerUserId, conversationId, requestId);
      } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
      finally { client.release(); }
    },
    async complete({ ownerUserId, conversationId, requestId, result }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await find(client, ownerUserId, conversationId, requestId, true);
        if (!current) throw new Error('SUBMISSION_NOT_FOUND');
        if (current.status === 'COMPLETED') {
          if (canonicalJson(current.result) !== canonicalJson(result)) throw new Error('RESULT_CONFLICT');
          await client.query('COMMIT'); return current;
        }
        if (!['QUEUED', 'RUNNING'].includes(current.status)) throw new Error('INVALID_STATE_TRANSITION');
        const now = new Date();
        await client.query(`UPDATE ${schema}.poc_submissions SET status='COMPLETED',result_json=$1::jsonb,updated_at=$2 WHERE id=$3 AND owner_user_id=$4`, [JSON.stringify(result), now, current.id, ownerUserId]);
        await client.query(`INSERT INTO ${schema}.poc_submission_events(id,submission_id,event_type,created_at) VALUES($1,$2,'COMPLETED',$3)`, [randomUUID(), current.id, now]);
        await client.query('COMMIT');
        return find(pool, ownerUserId, conversationId, requestId);
      } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
      finally { client.release(); }
    },
    async getForOwner({ ownerUserId, id }) {
      const result = await pool.query(`SELECT * FROM ${schema}.poc_submissions WHERE owner_user_id=$1 AND id=$2`, [ownerUserId, id]);
      return normalizePgRow(result.rows[0]);
    },
    async eventCount({ ownerUserId, conversationId, requestId }) {
      const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${schema}.poc_submission_events e JOIN ${schema}.poc_submissions s ON s.id=e.submission_id WHERE s.owner_user_id=$1 AND s.conversation_id=$2 AND s.request_id=$3`, [ownerUserId, conversationId, requestId]);
      return Number(result.rows[0]?.count ?? 0);
    },
    async close() { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); },
  };
  } catch (error) {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    throw error;
  }
}
