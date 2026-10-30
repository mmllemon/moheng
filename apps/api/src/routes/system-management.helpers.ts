import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { basename, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';

export function publicIntegration(row: {
  id: string; code: string; name: string; adapterType: string; endpointUrl: string | null; description: string | null;
  status: string; secretCiphertext: string | null; keyVersion: number; lastRotatedAt: Date | null; lastTestAt: Date | null; lastTestStatus: string | null; lastTestSummary: string | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: row.id, code: row.code, name: row.name, adapterType: row.adapterType, endpointUrl: row.endpointUrl,
    description: row.description, status: row.status, hasSecret: Boolean(row.secretCiphertext), secretVersion: row.keyVersion,
    lastRotatedAt: row.lastRotatedAt, lastTestAt: row.lastTestAt, lastTestStatus: row.lastTestStatus, lastTestSummary: row.lastTestSummary, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export function parseDatabaseUrl(value: string): { host: string; port: number; database: string; username: string; password: string; sslmode?: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('POSTGRES_URL_REQUIRED');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!url.hostname || !database || !username) throw new Error('DATABASE_URL_INCOMPLETE');
  const sslmode = url.searchParams.get('sslmode') ?? undefined;
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432), database, username, password, ...(sslmode ? { sslmode } : {}) };
}

export function pgEnvironment(target: ReturnType<typeof parseDatabaseUrl>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'WINDIR', 'HOME', 'TMP', 'TEMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PGHOST = target.host;
  env.PGPORT = String(target.port);
  env.PGDATABASE = target.database;
  env.PGUSER = target.username;
  env.PGPASSWORD = target.password;
  env.PGCONNECT_TIMEOUT = '15';
  if (target.sslmode) env.PGSSLMODE = target.sslmode;
  return env;
}

export type CommandResult = { code: number; stdout: string; stderr: string };
export function terminateCommandTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) { child.kill(); return; }
  if (process.platform === 'win32') {
    // pg_dump/pg_restore may create descendants; terminating only the Node child can leave them running.
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    killer.unref();
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already exited */ } }
  const hardKill = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* process group already exited */ } }, 1500);
  hardKill.unref();
}

export function runCommand(binary: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 10 * 60_000): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binary, args, { env, cwd: tmpdir(), windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      timedOut = true;
      terminateCommandTree(child);
      rejectPromise(new Error('COMMAND_TIMEOUT'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { if (stdout.length < 16_000) stdout += chunk.slice(0, 16_000 - stdout.length); });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { if (stderr.length < 4_000) stderr += chunk.slice(0, 4_000 - stderr.length); });
    child.once('error', (error) => { clearTimeout(timer); if (!timedOut) rejectPromise(error); });
    child.once('close', (code) => { clearTimeout(timer); if (!timedOut) resolvePromise({ code: code ?? -1, stdout, stderr }); });
  });
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', rejectPromise);
    stream.once('end', resolvePromise);
  });
  return hash.digest('hex');
}

export async function pruneExpiredBackups(backupRoot: string, actorUserId: string): Promise<number> {
  const retentionDays = retentionDaysFromEnv();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.systemBackupRun.findMany({
    where: { type: 'BACKUP', status: 'SUCCEEDED', fileName: { not: null }, startedAt: { lt: cutoff }, restoreDrills: { none: { status: 'RUNNING' } } },
    orderBy: { startedAt: 'desc' }, take: 5000, select: { id: true, fileName: true, fileSize: true, sha256: true, globalsFileName: true },
  });
  // Preserve at least the two newest successful backup files even if the retention window is short.
  const newest = await prisma.systemBackupRun.findMany({ where: { type: 'BACKUP', status: 'SUCCEEDED', fileName: { not: null } }, orderBy: { startedAt: 'desc' }, take: 2, select: { id: true } });
  const preserveIds = new Set(newest.map((row) => row.id));
  let removed = 0;
  for (const row of rows) {
    if (preserveIds.has(row.id) || !row.fileName || basename(row.fileName) !== row.fileName || !/^moheng-[A-Za-z0-9T_-]+\.dump\.enc$/.test(row.fileName)) continue;
    const path = join(backupRoot, row.fileName);
    if (!path.startsWith(`${backupRoot}${sep}`)) continue;
    // Commit the metadata tombstone first. If PostgreSQL is unavailable, leave the file intact and its DB pointer valid.
    // If unlink later fails, the worst case is an unreferenced orphan file, not a metadata row pointing to a missing file.
    await prisma.$transaction(async (tx) => {
      await tx.systemBackupRun.update({ where: { id: row.id }, data: { fileName: null, fileSize: null, sha256: null, globalsFileName: null, globalsFileSize: null, globalsSha256: null, verified: false, message: '数据库及全局配置备份文件已按保留期限清理；记录与审计历史仍保留。' } });
      await tx.auditLog.create({ data: { userId: actorUserId, entity: 'SystemBackupRun', entityId: row.id, action: 'DATABASE_BACKUP_EXPIRED', changes: { fileName: row.fileName, retentionDays, metadataRetained: true } } });
    });
    try { await unlink(path); }
    catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
        console.warn('Expired backup file cleanup failed after metadata was safely retired');
      }
    }
    if (row.globalsFileName && basename(row.globalsFileName) === row.globalsFileName && /^moheng-[A-Za-z0-9T_-]+\.globals\.sql\.enc$/.test(row.globalsFileName)) {
      const globalsPath = join(backupRoot, row.globalsFileName);
      if (globalsPath.startsWith(`${backupRoot}${sep}`)) await unlink(globalsPath).catch(() => undefined);
    }
    removed += 1;
  }
  return removed;
}

export async function resolveAddresses(host: string): Promise<Set<string>> {
  const records = await lookup(host, { all: true, verbatim: true });
  return new Set(records.map((record) => record.address));
}

export async function assertIsolatedRestoreTarget(sourceUrl: string, targetUrl: string): Promise<ReturnType<typeof parseDatabaseUrl>> {
  const source = parseDatabaseUrl(sourceUrl);
  const target = parseDatabaseUrl(targetUrl);
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(target.database) || target.database === source.database || !/(?:_|-)restore_test$/i.test(target.database)) throw new Error('RESTORE_TARGET_NAME_UNSAFE');
  const [sourceAddresses, targetAddresses] = await Promise.all([resolveAddresses(source.host), resolveAddresses(target.host)]);
  if ([...targetAddresses].some((address) => sourceAddresses.has(address))) throw new Error('RESTORE_TARGET_HOST_NOT_ISOLATED');
  // DNS/IP separation alone does not prove separate PostgreSQL clusters (aliases and proxies can hide a shared cluster).
  const [sourceSystemId, targetSystemId] = await Promise.all([
    databaseSystemIdentifier(sourceUrl), databaseSystemIdentifier(targetUrl),
  ]);
  if (sourceSystemId === targetSystemId) throw new Error('RESTORE_TARGET_CLUSTER_NOT_ISOLATED');
  return target;
}

export async function databaseSystemIdentifier(databaseUrl: string): Promise<string> {
  const target = parseDatabaseUrl(databaseUrl);
  let result: CommandResult;
  try {
    result = await runCommand(process.env.PSQL_PATH || 'psql', [
      '--no-psqlrc', '--tuples-only', '--no-align', '--host', target.host, '--port', String(target.port),
      '--username', target.username, '--dbname', target.database, '--command',
      'SELECT system_identifier::text FROM pg_control_system()',
    ], pgEnvironment(target), 15_000);
  } catch { throw new Error('RESTORE_CLUSTER_ID_UNVERIFIABLE'); }
  const value = result.stdout.trim();
  if (result.code !== 0 || !/^\d{1,30}$/.test(value)) throw new Error('RESTORE_CLUSTER_ID_UNVERIFIABLE');
  return value;
}

export async function writeAudit(input: { userId: string; entity: string; entityId: string; action: string; changes: Prisma.InputJsonValue }) {
  await prisma.auditLog.create({ data: input });
}

export function retentionDaysFromEnv(): number {
  const parsed = Number.parseInt(process.env.BACKUP_RETENTION_DAYS ?? '30', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(3650, parsed)) : 30;
}

export async function checkPgTool(binary: string): Promise<boolean> {
  const result = await runCommand(binary, ['--version'], pgBaseEnvironment(), 2_000).catch(() => null);
  return result?.code === 0;
}

export function pgBaseEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'WINDIR', 'HOME', 'TMP', 'TEMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

export async function inspectPgTools() {
  const [pgDump, pgDumpAll, pgRestore, psql] = await Promise.all([
    checkPgTool(process.env.PG_DUMP_PATH || 'pg_dump'),
    checkPgTool(process.env.PG_DUMPALL_PATH || 'pg_dumpall'),
    checkPgTool(process.env.PG_RESTORE_PATH || 'pg_restore'),
    checkPgTool(process.env.PSQL_PATH || 'psql'),
  ]);
  return { pgDump, pgDumpAll, pgRestore, psql };
}

export function serialiseBackup(row: {
  id: string; type: string; status: string; fileName: string | null; fileSize: bigint | null; sha256: string | null;
  globalsFileName?: string | null; globalsFileSize?: bigint | null; globalsSha256?: string | null;
  startedAt: Date; finishedAt: Date | null; durationMs: number | null; verified: boolean; message: string | null;
  triggeredBy: { name: string; email: string }; sourceBackupId?: string | null;
}) {
  return { ...row, fileSize: row.fileSize?.toString() ?? null, globalsFileSize: row.globalsFileSize?.toString() ?? null, globalsFileName: row.globalsFileName ?? null, globalsSha256: row.globalsSha256 ?? null, triggeredBy: row.triggeredBy, sourceBackupId: row.sourceBackupId ?? null };
}
