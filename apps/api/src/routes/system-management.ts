import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { basename, isAbsolute, join, parse as parsePath, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { ProjectRole, Prisma } from '../generated/prisma/client.js';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { decryptIntegrationSecret, encryptIntegrationSecret } from '../lib/integration-vault.js';
import { decryptAssistantProviderKey, encryptAssistantProviderKey, isCheckpointSchemaReady, publicAssistantProviderConfig } from '../lib/assistant-provider-config.js';
import { AssistantProviderError, fetchAssistantProviderModels, normalizeProviderBaseUrl } from '../lib/assistant-provider-client.js';
import { encryptBackupFile, decryptBackupFile, parseBackupKeyRing } from '../lib/backup-encryption.js';
import { requestIntegrationEndpoint, IntegrationHttpError } from '../lib/integration-http.js';
import { PROJECT_PERMISSION_BASELINES, PROJECT_PERMISSION_LABELS, defaultProjectPermissionPolicy, parseProjectPermissionPolicy } from '../lib/access-policy.js';
import { parseWorkflowDefinition } from '../lib/workflow-definitions.js';
import { enqueueBackgroundJob, hashJobRequest } from '../lib/background-jobs.js';
import { DEFAULT_CHANGE_APPROVER_ROLES, parseChangeApprovalDefinition } from '../lib/governance-rules.js';
import { APP_VERSION } from '../platform/app-info.js';
import { systemConfigRoutes } from './system-config.js';

const departmentCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, '部门编码应为 2-40 位大写字母、数字、下划线或连字符');
const departmentCreate = z.object({
  code: departmentCode,
  name: z.string().trim().min(1).max(120),
  parentId: z.string().trim().min(1).max(100).nullable().optional(),
});
const departmentPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().trim().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个要修改的字段');
const orgAssignment = z.object({
  departmentId: z.string().trim().min(1).max(100).nullable(),
  position: z.string().trim().max(120).nullable().optional(),
});
const changeApprovalDraft = z.object({
  changeNote: z.string().trim().min(1).max(1000),
  allowedProjectRoles: z.array(z.enum(['OWNER', 'MANAGER'])).min(1).max(2),
}).refine((value) => new Set(value.allowedProjectRoles).size === value.allowedProjectRoles.length, '审批角色不能重复');
const integrationCreate = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,79}$/),
  name: z.string().trim().min(1).max(120),
  adapterType: z.enum(['REST_API', 'WEBHOOK', 'ERP', 'OTHER']),
  endpointUrl: z.string().trim().url().max(1000).refine((value) => new URL(value).protocol === 'https:', '集成地址必须使用 HTTPS').optional().or(z.literal('')),
  description: z.string().trim().max(1000).optional(),
  secret: z.string().min(1).max(4096),
});
const assistantProviderPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: z.string().trim().max(1000).optional(),
  modelId: z.string().trim().max(200).optional(),
  apiKey: z.string().min(1).max(4096).optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个要修改的字段');
const assistantProviderLookup = z.object({
  baseUrl: z.string().trim().max(1000).optional(),
  apiKey: z.string().max(4096).optional(),
});
const accessPolicyDraft = z.object({
  changeNote: z.string().trim().min(1).max(1000),
  permissions: z.record(z.array(z.enum(['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER']))),
});
const workflowCodeSchema = z.enum(['CHANGE_INTERNAL_APPROVAL']);
const workflowDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  changeNote: z.string().trim().min(1).max(1000),
  definition: z.unknown(),
});
const integrationPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  endpointUrl: z.string().trim().url().max(1000).refine((value) => new URL(value).protocol === 'https:', '集成地址必须使用 HTTPS').nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个要修改的字段');
const secretRotation = z.object({ secret: z.string().min(1).max(4096), changeNote: z.string().trim().max(500).optional() });

function publicIntegration(row: {
  id: string; code: string; name: string; adapterType: string; endpointUrl: string | null; description: string | null;
  status: string; secretCiphertext: string | null; keyVersion: number; lastRotatedAt: Date | null; lastTestAt: Date | null; lastTestStatus: string | null; lastTestSummary: string | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: row.id, code: row.code, name: row.name, adapterType: row.adapterType, endpointUrl: row.endpointUrl,
    description: row.description, status: row.status, hasSecret: Boolean(row.secretCiphertext), secretVersion: row.keyVersion,
    lastRotatedAt: row.lastRotatedAt, lastTestAt: row.lastTestAt, lastTestStatus: row.lastTestStatus, lastTestSummary: row.lastTestSummary, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function parseDatabaseUrl(value: string): { host: string; port: number; database: string; username: string; password: string; sslmode?: string } {
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

function pgEnvironment(target: ReturnType<typeof parseDatabaseUrl>): NodeJS.ProcessEnv {
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

type CommandResult = { code: number; stdout: string; stderr: string };
function terminateCommandTree(child: ReturnType<typeof spawn>): void {
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

function runCommand(binary: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 10 * 60_000): Promise<CommandResult> {
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

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', rejectPromise);
    stream.once('end', resolvePromise);
  });
  return hash.digest('hex');
}

async function pruneExpiredBackups(backupRoot: string, actorUserId: string): Promise<number> {
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

async function resolveAddresses(host: string): Promise<Set<string>> {
  const records = await lookup(host, { all: true, verbatim: true });
  return new Set(records.map((record) => record.address));
}

async function assertIsolatedRestoreTarget(sourceUrl: string, targetUrl: string): Promise<ReturnType<typeof parseDatabaseUrl>> {
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

async function databaseSystemIdentifier(databaseUrl: string): Promise<string> {
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

async function writeAudit(input: { userId: string; entity: string; entityId: string; action: string; changes: Prisma.InputJsonValue }) {
  await prisma.auditLog.create({ data: input });
}

function retentionDaysFromEnv(): number {
  const parsed = Number.parseInt(process.env.BACKUP_RETENTION_DAYS ?? '30', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(3650, parsed)) : 30;
}

async function checkPgTool(binary: string): Promise<boolean> {
  const result = await runCommand(binary, ['--version'], pgBaseEnvironment(), 2_000).catch(() => null);
  return result?.code === 0;
}

function pgBaseEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'WINDIR', 'HOME', 'TMP', 'TEMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function inspectPgTools() {
  const [pgDump, pgDumpAll, pgRestore, psql] = await Promise.all([
    checkPgTool(process.env.PG_DUMP_PATH || 'pg_dump'),
    checkPgTool(process.env.PG_DUMPALL_PATH || 'pg_dumpall'),
    checkPgTool(process.env.PG_RESTORE_PATH || 'pg_restore'),
    checkPgTool(process.env.PSQL_PATH || 'psql'),
  ]);
  return { pgDump, pgDumpAll, pgRestore, psql };
}

function serialiseBackup(row: {
  id: string; type: string; status: string; fileName: string | null; fileSize: bigint | null; sha256: string | null;
  globalsFileName?: string | null; globalsFileSize?: bigint | null; globalsSha256?: string | null;
  startedAt: Date; finishedAt: Date | null; durationMs: number | null; verified: boolean; message: string | null;
  triggeredBy: { name: string; email: string }; sourceBackupId?: string | null;
}) {
  return { ...row, fileSize: row.fileSize?.toString() ?? null, globalsFileSize: row.globalsFileSize?.toString() ?? null, globalsFileName: row.globalsFileName ?? null, globalsSha256: row.globalsSha256 ?? null, triggeredBy: row.triggeredBy, sourceBackupId: row.sourceBackupId ?? null };
}

export async function systemManagementRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authRequired);
  app.addHook('preHandler', async (request, reply) => {
    if (reply.sent) return;
    if (!request.user) return reply.code(401).send(failure(reply, 401, 'UNAUTHORIZED', '请先登录'));
    if (authUser(request).role !== 'ADMIN') return reply.code(403).send(failure(reply, 403, 'ADMIN_REQUIRED', '只有系统管理员可以访问系统管理扩展'));
  });

  await app.register(systemConfigRoutes);

  app.get('/overview', async (_request, reply) => {
    let databaseStatus: 'ok' | 'failed' = 'ok';
    try { await prisma.$queryRaw`SELECT 1`; } catch { databaseStatus = 'failed'; }
    if (databaseStatus === 'failed') {
      const [memory, postgresClientTools] = [process.memoryUsage(), await inspectPgTools()];
      return success({
        appVersion: APP_VERSION, nodeVersion: process.version, uptimeSeconds: Math.floor(process.uptime()),
        memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
        database: { status: 'failed' },
        backup: { configured: Boolean(process.env.DATABASE_URL && process.env.BACKUP_GLOBALS_DATABASE_URL && process.env.BACKUP_DIR && isAbsolute(process.env.BACKUP_DIR) && process.env.BACKUP_ENCRYPTION_KEYS && process.env.BACKUP_ACTIVE_ENCRYPTION_KEY_ID), restoreDrillConfigured: Boolean(process.env.RESTORE_TEST_DATABASE_URL), retentionDays: retentionDaysFromEnv(), disk: null },
        postgresClientTools, integrationVaultConfigured: /^[a-fA-F0-9]{64}$/.test(process.env.INTEGRATION_ENCRYPTION_KEY ?? ''), backupEncryptionConfigured: (() => { try { parseBackupKeyRing(); return true; } catch { return false; } })(), globalsBackupConfigured: Boolean(process.env.BACKUP_GLOBALS_DATABASE_URL),
        backgroundJobs: { counts: {}, recent: [] }, integrations: { active: 0 }, backupRuns: [],
      });
    }
    const [jobCounts, jobs, backupRuns, integrationCount, postgresClientTools] = await Promise.all([
      prisma.backgroundJob.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.backgroundJob.findMany({ take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, createdAt: true, finishedAt: true, lastError: true } }),
      prisma.systemBackupRun.findMany({ take: 8, orderBy: { startedAt: 'desc' }, include: { triggeredBy: { select: { name: true, email: true } } } }),
      prisma.integrationCredential.count({ where: { status: 'ACTIVE' } }),
      inspectPgTools(),
    ]);
    let disk: { freeBytes: string; totalBytes: string } | null = null;
    try {
      if (!process.env.BACKUP_DIR || !isAbsolute(process.env.BACKUP_DIR)) throw new Error('BACKUP_DIRECTORY_UNAVAILABLE');
      const fsPath = resolve(process.env.BACKUP_DIR);
      const fs = await import('node:fs/promises');
      const diskStat = await fs.statfs(fsPath);
      disk = { freeBytes: String(Number(diskStat.bavail) * Number(diskStat.bsize)), totalBytes: String(Number(diskStat.blocks) * Number(diskStat.bsize)) };
    } catch { /* Disk statistics are optional until a backup location is configured. */ }
    return success({
      appVersion: APP_VERSION, nodeVersion: process.version, uptimeSeconds: Math.floor(process.uptime()),
      memory: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed, heapTotalBytes: process.memoryUsage().heapTotal },
      database: { status: databaseStatus },
      backup: { configured: Boolean(process.env.DATABASE_URL && process.env.BACKUP_GLOBALS_DATABASE_URL && process.env.BACKUP_DIR && isAbsolute(process.env.BACKUP_DIR) && process.env.BACKUP_ENCRYPTION_KEYS && process.env.BACKUP_ACTIVE_ENCRYPTION_KEY_ID), restoreDrillConfigured: Boolean(process.env.RESTORE_TEST_DATABASE_URL), retentionDays: retentionDaysFromEnv(), disk },
      postgresClientTools, integrationVaultConfigured: /^[a-fA-F0-9]{64}$/.test(process.env.INTEGRATION_ENCRYPTION_KEY ?? ''), backupEncryptionConfigured: (() => { try { parseBackupKeyRing(); return true; } catch { return false; } })(), globalsBackupConfigured: Boolean(process.env.BACKUP_GLOBALS_DATABASE_URL),
      backgroundJobs: { counts: Object.fromEntries(jobCounts.map((item) => [item.status, item._count._all])), recent: jobs.map((job) => ({ ...job, lastError: job.lastError ? '任务执行失败，详细错误请查看服务端受控日志' : null })) },
      integrations: { active: integrationCount },
      backupRuns: backupRuns.map(serialiseBackup),
    });
  });

  // This matrix documents the role guards actually enforced by project APIs.
  // It is intentionally read-only: changing it here would be misleading because
  // authorization remains enforced by each service endpoint.
  app.get('/authorization/matrix', async () => {
    const publishedApprovalRule = await prisma.governanceRuleVersion.findFirst({
      where: { ruleKey: 'CHANGE_APPROVAL', status: 'PUBLISHED' },
      orderBy: { version: 'desc' }, select: { version: true, definition: true },
    });
    const parsedApprovalRule = publishedApprovalRule ? parseChangeApprovalDefinition(publishedApprovalRule.definition) : null;
    const allowedApprovalRoles: ProjectRole[] = publishedApprovalRule
      ? (parsedApprovalRule?.allowedProjectRoles ?? [])
      : [...DEFAULT_CHANGE_APPROVER_ROLES];
    const approvalSource = !publishedApprovalRule ? 'BUILT_IN_DEFAULT' : parsedApprovalRule ? 'PUBLISHED' : 'INVALID';
    return success({
    approvalPolicy: { source: approvalSource, version: publishedApprovalRule?.version ?? null, allowedProjectRoles: allowedApprovalRoles },
    companyRoles: [
      { role: 'ADMIN', label: '系统管理员', description: '可访问系统管理；业务数据跨项目访问不受 ProjectMember 限制。高风险业务操作仍须满足业务状态机和审计规则。' },
      { role: 'USER', label: '普通账号', description: '无公司级系统管理权限；业务数据必须有对应项目成员关系。部门/岗位归属不授予任何项目访问权。' },
    ],
    projectRoles: [
      { role: 'OWNER', label: '项目负责人', read: true, record: true, approve: allowedApprovalRoles.includes('OWNER'), manageMembers: true, memberAssignment: ['MANAGER', 'ESTIMATOR', 'VIEWER'] },
      { role: 'MANAGER', label: '项目经理', read: true, record: true, approve: allowedApprovalRoles.includes('MANAGER'), manageMembers: true, memberAssignment: ['ESTIMATOR', 'VIEWER'] },
      { role: 'ESTIMATOR', label: '预算/成本经办', read: true, record: true, approve: false, manageMembers: false, memberAssignment: [] },
      { role: 'VIEWER', label: '只读成员', read: true, record: false, approve: false, manageMembers: false, memberAssignment: [] },
    ],
    modules: [
      { code: 'PROJECT_DATA', label: '项目业务数据读取', allowed: ['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER'], note: '需先具有项目成员关系；系统管理员按公司级角色绕过项目成员检查。' },
      { code: 'COST_AND_BUDGET_WRITE', label: '目标成本与实际成本录入', allowed: ['OWNER', 'MANAGER', 'ESTIMATOR'], note: '服务端逐接口校验；VIEWER 只读。' },
      { code: 'CHANGE_SUBMIT', label: '变更签证提交', allowed: ['OWNER', 'MANAGER', 'ESTIMATOR'], note: '提交后仍需独立内部审批与外部确认，不因本矩阵而跳过。' },
      { code: 'CHANGE_APPROVAL', label: '变更签证内部决定', allowed: allowedApprovalRoles, note: approvalSource === 'INVALID' ? '已发布审批规则结构无效；后端会拒绝审批，需管理员修复并重新发布。' : `${approvalSource === 'PUBLISHED' ? `按已发布 v${publishedApprovalRule?.version} 规则` : '按系统内置默认规则'}；禁止提交人审批本人单据，外部确认与合同金额生效规则独立。` },
      { code: 'MEMBER_ASSIGNMENT', label: '项目成员角色分配', allowed: ['OWNER', 'MANAGER'], note: 'OWNER 可分配 MANAGER/ESTIMATOR/VIEWER；MANAGER 仅能分配 ESTIMATOR/VIEWER；系统管理员可通过公司级管理接口分配全部项目角色。' },
      { code: 'SYSTEM_GOVERNANCE', label: '系统账号、安全、配置、备份与公司级审计', allowed: ['ADMIN'], note: '前端菜单与页面守卫不是安全边界，API 仍须执行管理员授权。' },
    ],
    scopeRules: [
      { code: 'ADMIN_CROSS_PROJECT', label: '系统管理员', detail: '可以跨项目访问业务数据；高风险写操作仍受对应业务权限、状态机和审计约束。' },
      { code: 'USER_PROJECT_MEMBERSHIP', label: '普通账号', detail: '只可访问自己所属项目；跨项目报表必须先按成员关系过滤，传入无权 projectId 时拒绝或按接口约定隐藏对象存在性。' },
      { code: 'DEPARTMENT_IS_NOT_PERMISSION', label: '部门/岗位', detail: '仅为组织目录属性，不替代公司角色或 ProjectMember 角色。' },
    ],
    editable: false,
    });
  });

  app.get('/authorization-reviews', async () => {
    const rows = await prisma.systemAuthorizationReview.findMany({
      take: 20, orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, summary: true, reviewNote: true, createdById: true, reviewedById: true, createdAt: true, reviewedAt: true,
        createdBy: { select: { id: true, name: true, email: true } }, reviewedBy: { select: { id: true, name: true, email: true } } },
    });
    return success(rows);
  });

  app.get('/authorization-reviews/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '授权复核记录编号有误', params.error.flatten());
    const row = await prisma.systemAuthorizationReview.findUnique({
      where: { id: params.data.id },
      include: { createdBy: { select: { id: true, name: true, email: true } }, reviewedBy: { select: { id: true, name: true, email: true } } },
    });
    if (!row) return failure(reply, 404, 'AUTHORIZATION_REVIEW_NOT_FOUND', '授权复核记录不存在');
    return success(row);
  });

  app.post('/authorization-reviews', async (request, reply) => {
    const actor = authUser(request);
    const now = new Date();
    // A Repeatable Read transaction keeps user, membership, and project rows on
    // one database snapshot so concurrent role changes cannot create a mixed-time review.
    const { userRows, memberRows, projectRows } = await prisma.$transaction(async (tx) => {
      const userRows = await tx.user.findMany({
        take: 2001, orderBy: [{ email: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, email: true, role: true, isActive: true, mfaEnabled: true, passwordResetRequired: true, department: { select: { id: true, code: true, name: true, isActive: true } } },
      });
      const memberRows = await tx.projectMember.findMany({
        take: 5001, orderBy: [{ projectId: 'asc' }, { userId: 'asc' }],
        select: { id: true, projectId: true, userId: true, role: true, createdAt: true,
          user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
          project: { select: { id: true, code: true, name: true, status: true, deletedAt: true } } },
      });
      const projectRows = await tx.project.findMany({ where: { deletedAt: null }, take: 2001, orderBy: [{ code: 'asc' }, { id: 'asc' }], select: { id: true, code: true, name: true, status: true } });
      return { userRows, memberRows, projectRows };
    }, { isolationLevel: 'RepeatableRead' });
    const users = userRows.slice(0, 2000);
    const memberships = memberRows.slice(0, 5000);
    const projects = projectRows.slice(0, 2000);
    const usersTruncated = userRows.length > 2000;
    const membershipsTruncated = memberRows.length > 5000;
    const projectsTruncated = projectRows.length > 2000;
    const capped = usersTruncated || membershipsTruncated || projectsTruncated;
    const membershipsByUser = new Map<string, typeof memberships>();
    const membershipsByProject = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      const userMemberships = membershipsByUser.get(membership.userId) ?? [];
      userMemberships.push(membership); membershipsByUser.set(membership.userId, userMemberships);
      const projectMemberships = membershipsByProject.get(membership.projectId) ?? [];
      projectMemberships.push(membership); membershipsByProject.set(membership.projectId, projectMemberships);
    }
    const findings: Array<{ code: string; severity: 'ERROR' | 'WARNING' | 'INFO'; title: string; userId?: string; projectId?: string; detail: string }> = [];
    for (const user of users) {
      const grants = membershipsByUser.get(user.id) ?? [];
      if (!user.isActive && grants.length) findings.push({ code: 'INACTIVE_USER_HAS_PROJECT_GRANTS', severity: 'WARNING', title: '停用账号仍保留项目授权', userId: user.id, detail: `${user.name} · ${user.email} · ${membershipsTruncated ? '至少 ' : ''}${grants.length} 个项目授权${membershipsTruncated ? '（授权总清单已截断）' : ''}；停用会阻止其登录，但应复核是否撤销历史授权。` });
      if (!usersTruncated && !membershipsTruncated && user.isActive && user.role === 'USER' && grants.length === 0) findings.push({ code: 'ACTIVE_USER_WITHOUT_PROJECT_GRANTS', severity: 'INFO', title: '启用账号未分配项目', userId: user.id, detail: `${user.name} · ${user.email}；请确认是否为有意保留的账号。` });
      if (user.isActive && user.role === 'ADMIN' && (!user.mfaEnabled || user.passwordResetRequired)) findings.push({ code: 'ADMIN_ACCOUNT_SECURITY_REVIEW', severity: 'ERROR', title: '管理员账号安全状态待复核', userId: user.id, detail: `${user.name} · MFA=${user.mfaEnabled ? '已启用' : '未启用'} · 强制改密=${user.passwordResetRequired ? '是' : '否'}` });
    }
    if (!membershipsTruncated && !projectsTruncated) {
      for (const project of projects) {
        const grants = membershipsByProject.get(project.id) ?? [];
        if (!grants.some((grant) => grant.role === ProjectRole.OWNER)) findings.push({ code: 'PROJECT_WITHOUT_OWNER', severity: 'WARNING', title: '项目未配置负责人角色', projectId: project.id, detail: `${project.code} · ${project.name}；请确认负责人是否有意缺位。` });
      }
    }
    // Do not infer missing grants/owners from a partially captured membership list.
    if (membershipsTruncated) findings.push({ code: 'MEMBERSHIP_SNAPSHOT_TRUNCATED', severity: 'WARNING', title: '成员授权明细达到快照上限', detail: '本次只快照前 5000 项成员授权；依赖授权明细的异常项可能不完整，不应据此直接撤销或认定授权缺失。' });
    if (usersTruncated) findings.push({ code: 'ACCOUNT_SNAPSHOT_TRUNCATED', severity: 'WARNING', title: '账号快照达到上限', detail: '本次只快照前 2000 个账号；账号相关异常项可能不完整。' });
    if (projectsTruncated) findings.push({ code: 'PROJECT_SNAPSHOT_TRUNCATED', severity: 'WARNING', title: '项目快照达到上限', detail: '本次只巡检前 2000 个未归档项目；项目负责人检查可能不完整。' });
    const summary = {
      capturedAt: now.toISOString(), totalAccounts: users.length, activeAccounts: users.filter((row) => row.isActive).length,
      inactiveAccounts: users.filter((row) => !row.isActive).length, projects: projects.length, grants: memberships.length,
      adminsWithoutMfaOrWithReset: users.filter((row) => row.isActive && row.role === 'ADMIN' && (!row.mfaEnabled || row.passwordResetRequired)).length,
      disabledAccountsWithGrants: findings.filter((row) => row.code === 'INACTIVE_USER_HAS_PROJECT_GRANTS').length,
      projectsWithoutOwner: membershipsTruncated || projectsTruncated ? null : findings.filter((row) => row.code === 'PROJECT_WITHOUT_OWNER').length,
      findings: findings.length, truncated: capped,
    };
    const snapshotMemberships = memberships.map((membership) => ({
      ...membership, createdAt: membership.createdAt.toISOString(),
      project: { ...membership.project, deletedAt: membership.project.deletedAt?.toISOString() ?? null },
    }));
    const snapshot = { version: 1, ...summary, users, memberships: snapshotMemberships, usersTruncated, membershipsTruncated, projectsTruncated, findings: findings.slice(0, 5000) } as unknown as Prisma.InputJsonValue;
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.systemAuthorizationReview.create({
        data: { status: 'PENDING', summary: summary as unknown as Prisma.InputJsonValue, snapshot, createdById: actor.sub },
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemAuthorizationReview', entityId: row.id, action: 'AUTHORIZATION_REVIEW_CREATED', changes: summary as unknown as Prisma.InputJsonValue } });
      return row;
    });
    return reply.code(201).send(success({ id: created.id, status: created.status, summary: created.summary, reviewNote: created.reviewNote, createdAt: created.createdAt, reviewedAt: created.reviewedAt, createdBy: created.createdBy, reviewedBy: null }));
  });

  app.patch('/authorization-reviews/:id/complete', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().trim().min(1).max(100) }).safeParse(request.params);
    const body = z.object({ reviewNote: z.string().trim().min(1).max(1000) }).safeParse(request.body);
    if (!params.success || !body.success) return failure(reply, 400, 'VALIDATION_ERROR', '复核记录编号或复核说明有误', { params: params.success ? undefined : params.error.flatten(), body: body.success ? undefined : body.error.flatten() });
    const row = await prisma.$transaction(async (tx) => {
      const changed = await tx.systemAuthorizationReview.updateMany({ where: { id: params.data.id, status: 'PENDING' }, data: { status: 'REVIEWED', reviewNote: body.data.reviewNote, reviewedById: actor.sub, reviewedAt: new Date() } });
      if (changed.count !== 1) return null;
      const saved = await tx.systemAuthorizationReview.findUniqueOrThrow({ where: { id: params.data.id } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemAuthorizationReview', entityId: saved.id, action: 'AUTHORIZATION_REVIEW_COMPLETED', changes: { status: saved.status, reviewNote: saved.reviewNote, summary: saved.summary } } });
      return saved;
    });
    if (!row) return failure(reply, 409, 'AUTHORIZATION_REVIEW_ALREADY_COMPLETED_OR_MISSING', '复核记录不存在或已由其他管理员完成，请刷新列表');
    return success(row);
  });

  app.get('/departments', async () => {
    const rows = await prisma.department.findMany({
      include: { parent: { select: { id: true, code: true, name: true } }, _count: { select: { users: true, children: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return success(rows.map((row) => ({ id: row.id, code: row.code, name: row.name, parentId: row.parentId, parent: row.parent, isActive: row.isActive, userCount: row._count.users, childCount: row._count.children, createdAt: row.createdAt, updatedAt: row.updatedAt })));
  });

  app.post('/departments', async (request, reply) => {
    const actor = authUser(request);
    const parsed = departmentCreate.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '部门资料有误', parsed.error.flatten());
    if (parsed.data.parentId) {
      const parent = await prisma.department.findUnique({ where: { id: parsed.data.parentId }, select: { id: true, isActive: true } });
      if (!parent || !parent.isActive) return failure(reply, 400, 'DEPARTMENT_PARENT_INVALID', '上级部门不存在或已停用');
    }
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.department.create({ data: { ...parsed.data, parentId: parsed.data.parentId ?? null } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'Department', entityId: created.id, action: 'DEPARTMENT_CREATED', changes: { code: created.code, name: created.name, parentId: created.parentId } } });
        return created;
      });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'DEPARTMENT_CODE_EXISTS', '部门编码已存在');
      throw error;
    }
  });

  app.patch('/departments/:id', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = departmentPatch.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '部门修改参数有误');
    const old = await prisma.department.findUnique({ where: { id: params.data.id } });
    if (!old) return failure(reply, 404, 'DEPARTMENT_NOT_FOUND', '部门不存在');
    const nextParentId = parsed.data.parentId === undefined ? old.parentId : parsed.data.parentId;
    if (nextParentId) {
      let cursor: string | null = nextParentId;
      const visited = new Set<string>([old.id]);
      while (cursor) {
        if (visited.has(cursor)) return failure(reply, 409, 'DEPARTMENT_CYCLE', '上级部门关系不能形成循环');
        visited.add(cursor);
        // Snapshot the narrowed cursor into an explicitly typed local so TS cannot
        // infer a circular dependency between the query result and cursor reassignment.
        const cursorId: string = cursor;
        const parent: { id: string; parentId: string | null; isActive: boolean } | null = await prisma.department.findUnique({ where: { id: cursorId }, select: { id: true, parentId: true, isActive: true } });
        if (!parent || !parent.isActive) return failure(reply, 400, 'DEPARTMENT_PARENT_INVALID', '上级部门不存在或已停用');
        cursor = parent.parentId;
      }
    }
    if (parsed.data.isActive === false) {
      const [activeUsers, activeChildren] = await Promise.all([
        prisma.user.count({ where: { departmentId: old.id, isActive: true } }),
        prisma.department.count({ where: { parentId: old.id, isActive: true } }),
      ]);
      if (activeUsers || activeChildren) return failure(reply, 409, 'DEPARTMENT_IN_USE', '部门仍有关联的启用账号或启用子部门，请先调整归属');
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.department.update({ where: { id: old.id }, data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'Department', entityId: old.id, action: 'DEPARTMENT_UPDATED', changes: { before: { name: old.name, parentId: old.parentId, isActive: old.isActive }, after: { name: row.name, parentId: row.parentId, isActive: row.isActive } } } });
      return row;
    });
    return success(updated);
  });

  app.patch('/users/:id/organization', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = orgAssignment.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '账号组织归属参数有误');
    const target = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, departmentId: true, position: true } });
    if (!target) return failure(reply, 404, 'USER_NOT_FOUND', '账号不存在');
    if (parsed.data.departmentId) {
      const department = await prisma.department.findUnique({ where: { id: parsed.data.departmentId }, select: { id: true, isActive: true } });
      if (!department?.isActive) return failure(reply, 400, 'DEPARTMENT_INVALID', '归属部门不存在或已停用');
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({ where: { id: target.id }, data: { departmentId: parsed.data.departmentId, ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}) }, select: { id: true, name: true, email: true, role: true, departmentId: true, position: true } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'User', entityId: target.id, action: 'USER_ORGANIZATION_UPDATED', changes: { before: { departmentId: target.departmentId, position: target.position }, after: { departmentId: row.departmentId, position: row.position } } } });
      return row;
    });
    return success(updated);
  });

  app.get('/access-policy', async () => {
    const rows = await prisma.governanceRuleVersion.findMany({
      where: { ruleKey: 'PROJECT_ACCESS_POLICY' }, orderBy: { version: 'desc' }, take: 100,
      include: { createdBy: { select: { id: true, name: true, email: true } }, publishedBy: { select: { id: true, name: true, email: true } } },
    });
    const published = rows.find((row) => row.status === 'PUBLISHED');
    const policy = published ? parseProjectPermissionPolicy(published.definition) : defaultProjectPermissionPolicy();
    return success({
      current: { source: published ? (policy ? 'PUBLISHED' : 'INVALID') : 'BUILT_IN_DEFAULT', version: published?.version ?? null, policy: policy ?? defaultProjectPermissionPolicy() },
      baselines: PROJECT_PERMISSION_BASELINES, labels: PROJECT_PERMISSION_LABELS, items: rows,
    });
  });

  app.post('/access-policy/drafts', async (request, reply) => {
    const actor = authUser(request);
    const parsed = accessPolicyDraft.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '项目权限策略草稿有误', parsed.error.flatten());
    const policy = parseProjectPermissionPolicy(parsed.data.permissions);
    if (!policy) return failure(reply, 400, 'ACCESS_POLICY_INVALID', '角色权限包含未知权限键、空角色集合、重复角色或超出源码安全上限的授权');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey: 'PROJECT_ACCESS_POLICY' }, orderBy: { version: 'desc' }, select: { version: true } });
        const version = (latest?.version ?? 0) + 1;
        const created = await tx.governanceRuleVersion.create({ data: {
          ruleKey: 'PROJECT_ACCESS_POLICY', name: '项目角色权限策略', version, status: 'DRAFT',
          definition: policy as unknown as Prisma.InputJsonValue, changeNote: parsed.data.changeNote, createdById: actor.sub,
        } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'PROJECT_ACCESS_POLICY_DRAFT_CREATED', changes: { version, changeNote: parsed.data.changeNote, permissionKeys: Object.keys(policy) } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) return failure(reply, 409, 'ACCESS_POLICY_VERSION_CONFLICT', '权限策略版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.post('/access-policy/rollback', async (request, reply) => {
    const actor = authUser(request);
    const parsed = z.object({ sourceRevisionId: z.string().min(1).max(100), changeNote: z.string().trim().min(1).max(1000) }).safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '权限策略回滚参数有误');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const source = await tx.governanceRuleVersion.findUnique({ where: { id: parsed.data.sourceRevisionId } });
        if (!source || source.ruleKey !== 'PROJECT_ACCESS_POLICY' || !parseProjectPermissionPolicy(source.definition)) throw new Error('ACCESS_POLICY_SOURCE_INVALID');
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey: 'PROJECT_ACCESS_POLICY' }, orderBy: { version: 'desc' }, select: { version: true } });
        const created = await tx.governanceRuleVersion.create({ data: { ruleKey: source.ruleKey, name: source.name, version: (latest?.version ?? 0) + 1, status: 'DRAFT', definition: source.definition as Prisma.InputJsonValue, changeNote: `${parsed.data.changeNote}（从 v${source.version} 复制为新草稿）`.slice(0, 1000), createdById: actor.sub } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'PROJECT_ACCESS_POLICY_ROLLBACK_DRAFT_CREATED', changes: { sourceRevisionId: source.id, sourceVersion: source.version, newVersion: created.version } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (error instanceof Error && error.message === 'ACCESS_POLICY_SOURCE_INVALID') return failure(reply, 400, 'ACCESS_POLICY_SOURCE_INVALID', '回滚来源不是有效的权限策略版本');
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) return failure(reply, 409, 'ACCESS_POLICY_VERSION_CONFLICT', '权限策略版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.get('/workflows', async () => {
    const items = await prisma.governanceRuleVersion.findMany({
      where: { ruleKey: { startsWith: 'WORKFLOW:' } }, orderBy: [{ ruleKey: 'asc' }, { version: 'desc' }], take: 200,
      include: { createdBy: { select: { id: true, name: true, email: true } }, publishedBy: { select: { id: true, name: true, email: true } } },
    });
    const publishedChangeWorkflow = items.find((item) => item.ruleKey === 'WORKFLOW:CHANGE_INTERNAL_APPROVAL' && item.status === 'PUBLISHED');
    return success({ items, effectiveChangeWorkflow: publishedChangeWorkflow ? { source: parseWorkflowDefinition(publishedChangeWorkflow.definition) ? 'PUBLISHED' : 'INVALID', version: publishedChangeWorkflow.version, definition: parseWorkflowDefinition(publishedChangeWorkflow.definition) } : { source: 'BUILT_IN_DEFAULT', version: null, definition: null } });
  });

  app.post('/workflows/:code/drafts', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ code: workflowCodeSchema }).safeParse(request.params);
    const parsed = workflowDraftSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '流程定义草稿参数有误', { ...(!params.success ? { params: params.error.flatten() } : {}), ...(!parsed.success ? { body: parsed.error.flatten() } : {}) });
    const definition = parseWorkflowDefinition(parsed.data.definition);
    if (!definition) return failure(reply, 400, 'WORKFLOW_DEFINITION_INVALID', '流程状态或迁移定义无效；当前执行引擎只接受受控状态集，并对角色、条件、重复迁移做校验');
    const ruleKey = `WORKFLOW:${params.data.code}`;
    try {
      const row = await prisma.$transaction(async (tx) => {
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey }, orderBy: { version: 'desc' }, select: { version: true } });
        const created = await tx.governanceRuleVersion.create({ data: { ruleKey, name: parsed.data.name, version: (latest?.version ?? 0) + 1, status: 'DRAFT', definition: definition as unknown as Prisma.InputJsonValue, changeNote: parsed.data.changeNote, createdById: actor.sub } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'WORKFLOW_DRAFT_CREATED', changes: { ruleKey, version: created.version, name: created.name, changeNote: created.changeNote, transitionCount: definition.transitions.length } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) return failure(reply, 409, 'WORKFLOW_VERSION_CONFLICT', '流程版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.post('/workflows/rollback', async (request, reply) => {
    const actor = authUser(request);
    const parsed = z.object({ sourceRevisionId: z.string().min(1).max(100), changeNote: z.string().trim().min(1).max(1000) }).safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '流程回滚参数有误');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const source = await tx.governanceRuleVersion.findUnique({ where: { id: parsed.data.sourceRevisionId } });
        if (!source || !source.ruleKey.startsWith('WORKFLOW:') || !parseWorkflowDefinition(source.definition)) throw new Error('WORKFLOW_SOURCE_INVALID');
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey: source.ruleKey }, orderBy: { version: 'desc' }, select: { version: true } });
        const created = await tx.governanceRuleVersion.create({ data: { ruleKey: source.ruleKey, name: source.name, version: (latest?.version ?? 0) + 1, status: 'DRAFT', definition: source.definition as Prisma.InputJsonValue, changeNote: `${parsed.data.changeNote}（从 v${source.version} 复制为新草稿）`.slice(0, 1000), createdById: actor.sub } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'WORKFLOW_ROLLBACK_DRAFT_CREATED', changes: { sourceRevisionId: source.id, sourceVersion: source.version, newVersion: created.version } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (error instanceof Error && error.message === 'WORKFLOW_SOURCE_INVALID') return failure(reply, 400, 'WORKFLOW_SOURCE_INVALID', '回滚来源不是有效的流程版本');
      if (typeof error === 'object' && error !== null && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) return failure(reply, 409, 'WORKFLOW_VERSION_CONFLICT', '流程版本发生并发冲突，请刷新后重试');
      throw error;
    }
  });

  app.get('/rules', async () => {
    const items = await prisma.governanceRuleVersion.findMany({ orderBy: [{ ruleKey: 'asc' }, { version: 'desc' }], take: 100, include: { createdBy: { select: { id: true, name: true, email: true } }, publishedBy: { select: { id: true, name: true, email: true } } } });
    const published = items.find((item) => item.ruleKey === 'CHANGE_APPROVAL' && item.status === 'PUBLISHED');
    return success({
      items,
      effectiveChangeApproval: published ? { ruleKey: published.ruleKey, version: published.version, status: published.status, definition: published.definition, source: 'PUBLISHED' } : { ruleKey: 'CHANGE_APPROVAL', version: null, status: 'DEFAULT', definition: { allowedProjectRoles: ['OWNER', 'MANAGER'] }, source: 'BUILT_IN_DEFAULT' },
    });
  });

  app.post('/rules/change-approval/drafts', async (request, reply) => {
    const actor = authUser(request);
    const parsed = changeApprovalDraft.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '变更审批规则内容不正确', parsed.error.flatten());
    try {
      const row = await prisma.$transaction(async (tx) => {
        const latest = await tx.governanceRuleVersion.findFirst({ where: { ruleKey: 'CHANGE_APPROVAL' }, orderBy: { version: 'desc' }, select: { version: true } });
        const version = (latest?.version ?? 0) + 1;
        const created = await tx.governanceRuleVersion.create({ data: {
          ruleKey: 'CHANGE_APPROVAL', name: '变更签证内部审批角色规则', version, status: 'DRAFT',
          definition: { allowedProjectRoles: parsed.data.allowedProjectRoles } as Prisma.InputJsonValue,
          changeNote: parsed.data.changeNote, createdById: actor.sub,
        } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: created.id, action: 'GOVERNANCE_RULE_DRAFT_CREATED', changes: { ruleKey: created.ruleKey, version, allowedProjectRoles: parsed.data.allowedProjectRoles, changeNote: parsed.data.changeNote } } });
        return created;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(success(row));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'GOVERNANCE_RULE_VERSION_CONFLICT', '规则版本号冲突，请刷新后重试');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') return failure(reply, 409, 'GOVERNANCE_RULE_VERSION_CONFLICT', '检测到并发创建，请刷新后重试');
      throw error;
    }
  });

  app.post('/rules/:id/publish', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '规则版本编号有误');
    try {
      const row = await prisma.$transaction(async (tx) => {
        const draft = await tx.governanceRuleVersion.findUnique({ where: { id: params.data.id } });
        if (!draft) throw new Error('GOVERNANCE_RULE_NOT_FOUND');
        if (draft.status !== 'DRAFT') throw new Error('GOVERNANCE_RULE_NOT_DRAFT');
        const validDefinition = draft.ruleKey === 'CHANGE_APPROVAL' ? Boolean(parseChangeApprovalDefinition(draft.definition))
          : draft.ruleKey === 'PROJECT_ACCESS_POLICY' ? Boolean(parseProjectPermissionPolicy(draft.definition))
          : draft.ruleKey.startsWith('WORKFLOW:') ? Boolean(parseWorkflowDefinition(draft.definition)) : false;
        if (!validDefinition) throw new Error('GOVERNANCE_RULE_INVALID');
        await tx.governanceRuleVersion.updateMany({ where: { ruleKey: draft.ruleKey, status: 'PUBLISHED' }, data: { status: 'RETIRED' } });
        const published = await tx.governanceRuleVersion.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedById: actor.sub, publishedAt: new Date() } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'GovernanceRuleVersion', entityId: draft.id, action: 'GOVERNANCE_RULE_PUBLISHED', changes: { ruleKey: draft.ruleKey, version: draft.version, definition: draft.definition, changeNote: draft.changeNote } } });
        return published;
      }, { isolationLevel: 'Serializable' });
      return success(row);
    } catch (error) {
      if (error instanceof Error && error.message === 'GOVERNANCE_RULE_NOT_FOUND') return failure(reply, 404, 'GOVERNANCE_RULE_NOT_FOUND', '规则版本不存在');
      if (error instanceof Error && error.message === 'GOVERNANCE_RULE_NOT_DRAFT') return failure(reply, 409, 'GOVERNANCE_RULE_NOT_DRAFT', '只有草稿版本可以发布');
      if (error instanceof Error && error.message === 'GOVERNANCE_RULE_INVALID') return failure(reply, 409, 'GOVERNANCE_RULE_INVALID', '规则定义无效，拒绝发布');
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') return failure(reply, 409, 'GOVERNANCE_RULE_CONCURRENT_PUBLISH', '检测到并发发布，请刷新后重试');
      throw error;
    }
  });

  app.get('/integrations', async () => {
    const rows = await prisma.integrationCredential.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
    return success(rows.map(publicIntegration));
  });

  app.get('/assistant-provider', async () => {
    const [row, checkpointSchemaReady] = await Promise.all([prisma.assistantProviderConfig.findUnique({ where: { id: 'default' } }), isCheckpointSchemaReady()]);
    return success(publicAssistantProviderConfig(row, checkpointSchemaReady));
  });

  app.put('/assistant-provider', async (request, reply) => {
    const actor = authUser(request);
    const parsed = assistantProviderPatch.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'ASSISTANT_PROVIDER_INPUT_INVALID', 'AI 助手配置参数有误', parsed.error.flatten());
    if (parsed.data.baseUrl) {
      try { normalizeProviderBaseUrl(parsed.data.baseUrl); }
      catch (error) {
        if (error instanceof AssistantProviderError) return failure(reply, error.statusCode, error.code, error.message);
        throw error;
      }
    }
    const current = await prisma.assistantProviderConfig.findUnique({ where: { id: 'default' } });
    const nextVersion = parsed.data.apiKey ? (current?.keyVersion ?? 0) + 1 : (current?.keyVersion ?? 1);
    let encrypted: ReturnType<typeof encryptAssistantProviderKey> | null = null;
    if (parsed.data.apiKey) {
      try { encrypted = encryptAssistantProviderKey(parsed.data.apiKey, nextVersion); }
      catch (error) {
        if (error instanceof Error && error.message === 'ASSISTANT_VAULT_NOT_CONFIGURED') return failure(reply, 503, 'ASSISTANT_VAULT_NOT_CONFIGURED', '服务端未配置 ASSISTANT_ENCRYPTION_KEY，无法安全保存模型密钥');
        throw error;
      }
    }
    const name = parsed.data.name ?? current?.name ?? 'OpenAI 兼容供应商';
    const baseUrl = parsed.data.baseUrl !== undefined ? (parsed.data.baseUrl || null) : (current?.baseUrl ?? null);
    const modelId = parsed.data.modelId !== undefined ? (parsed.data.modelId || null) : (current?.modelId ?? null);
    const enabled = parsed.data.enabled ?? current?.enabled ?? false;
    const row = await prisma.$transaction(async (tx) => {
      const saved = await tx.assistantProviderConfig.upsert({
        where: { id: 'default' },
        create: {
          id: 'default', name, baseUrl, modelId, enabled, updatedById: actor.sub, keyVersion: encrypted ? nextVersion : 1,
          ...(encrypted ? { apiKeyCiphertext: encrypted.ciphertext, apiKeyIv: encrypted.iv, apiKeyAuthTag: encrypted.authTag } : {}),
        },
        update: {
          name, baseUrl, modelId, enabled, updatedById: actor.sub,
          ...(encrypted ? { keyVersion: nextVersion, apiKeyCiphertext: encrypted.ciphertext, apiKeyIv: encrypted.iv, apiKeyAuthTag: encrypted.authTag } : {}),
        },
      });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'AssistantProviderConfig', entityId: saved.id, action: 'ASSISTANT_PROVIDER_CONFIG_UPDATED', changes: { name, baseUrl, modelId, enabled, apiKeyConfigured: Boolean(encrypted) || Boolean(current?.apiKeyCiphertext), keyVersion: saved.keyVersion } } });
      return saved;
    });
    return success(publicAssistantProviderConfig(row, await isCheckpointSchemaReady()));
  });

  app.post('/assistant-provider/models', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const actor = authUser(request);
    const parsed = assistantProviderLookup.safeParse(request.body ?? {});
    if (!parsed.success) return failure(reply, 400, 'ASSISTANT_PROVIDER_INPUT_INVALID', '模型拉取参数有误', parsed.error.flatten());
    const row = await prisma.assistantProviderConfig.findUnique({ where: { id: 'default' } });
    const baseUrl = parsed.data.baseUrl?.trim() || row?.baseUrl?.trim() || '';
    let apiKey = parsed.data.apiKey?.trim();
    if (!apiKey && row?.apiKeyCiphertext && row.apiKeyIv && row.apiKeyAuthTag) {
      try { apiKey = decryptAssistantProviderKey({ ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, authTag: row.apiKeyAuthTag }, row.keyVersion); }
      catch { apiKey = undefined; }
    }
    if (!apiKey) return failure(reply, 409, 'ASSISTANT_PROVIDER_KEY_MISSING', '请先填写模型服务密钥，或在保存配置后再拉取模型');
    try {
      const result = await fetchAssistantProviderModels({ baseUrl, apiKey });
      if (row) await prisma.assistantProviderConfig.update({ where: { id: row.id }, data: { lastModelsFetchedAt: new Date(), lastModelCount: result.models.length } });
      await prisma.auditLog.create({ data: { userId: actor.sub, entity: 'AssistantProviderConfig', entityId: 'default', action: 'ASSISTANT_PROVIDER_MODELS_FETCHED', changes: { baseUrl, modelCount: result.models.length, apiKeyStored: false } } });
      return success({ models: result.models, latencyMs: result.latencyMs });
    } catch (error) {
      if (error instanceof AssistantProviderError) return failure(reply, error.statusCode, error.code, error.message);
      throw error;
    }
  });

  app.post('/assistant-provider/test', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const actor = authUser(request);
    const row = await prisma.assistantProviderConfig.findUnique({ where: { id: 'default' } });
    if (!row?.baseUrl) return failure(reply, 409, 'ASSISTANT_PROVIDER_URL_MISSING', '请先保存供应商地址');
    let apiKey: string | undefined;
    if (row.apiKeyCiphertext && row.apiKeyIv && row.apiKeyAuthTag) {
      try { apiKey = decryptAssistantProviderKey({ ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv, authTag: row.apiKeyAuthTag }, row.keyVersion); }
      catch { apiKey = undefined; }
    }
    if (!apiKey) return failure(reply, 409, 'ASSISTANT_PROVIDER_KEY_MISSING', '请先保存模型服务密钥');
    try {
      const result = await fetchAssistantProviderModels({ baseUrl: row.baseUrl, apiKey });
      const updated = await prisma.assistantProviderConfig.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestStatus: 'SUCCEEDED', lastTestSummary: 'MODELS_OK_' + result.models.length, lastModelsFetchedAt: new Date(), lastModelCount: result.models.length } });
      await prisma.auditLog.create({ data: { userId: actor.sub, entity: 'AssistantProviderConfig', entityId: row.id, action: 'ASSISTANT_PROVIDER_TEST_SUCCEEDED', changes: { baseUrl: row.baseUrl, modelId: row.modelId, modelCount: result.models.length, latencyMs: result.latencyMs, apiKeyStored: false } } });
      return success({ provider: publicAssistantProviderConfig(updated, await isCheckpointSchemaReady()), models: result.models, latencyMs: result.latencyMs, message: '供应商连接成功；这只验证模型列表可达，不代表具体模型已通过工具调用验收' });
    } catch (error) {
      const code = error instanceof AssistantProviderError ? error.code : 'ASSISTANT_PROVIDER_TEST_FAILED';
      const message = error instanceof AssistantProviderError ? error.message : '供应商连接测试失败';
      await prisma.assistantProviderConfig.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestStatus: 'FAILED', lastTestSummary: code } }).catch(() => undefined);
      await prisma.auditLog.create({ data: { userId: actor.sub, entity: 'AssistantProviderConfig', entityId: row.id, action: 'ASSISTANT_PROVIDER_TEST_FAILED', changes: { baseUrl: row.baseUrl, code, apiKeyStored: false } } }).catch(() => undefined);
      return failure(reply, error instanceof AssistantProviderError ? error.statusCode : 502, code, message);
    }
  });

  app.post('/integrations', async (request, reply) => {
    const actor = authUser(request);
    const parsed = integrationCreate.safeParse(request.body);
    if (!parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '集成配置有误', parsed.error.flatten());
    let encrypted: ReturnType<typeof encryptIntegrationSecret>;
    try { encrypted = encryptIntegrationSecret(parsed.data.secret, parsed.data.code, 1); }
    catch (error) {
      if (error instanceof Error && error.message === 'INTEGRATION_ENCRYPTION_KEY_MISSING_OR_INVALID') return failure(reply, 503, 'INTEGRATION_VAULT_NOT_CONFIGURED', '集成凭据保险库未配置有效的 INTEGRATION_ENCRYPTION_KEY');
      throw error;
    }
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.integrationCredential.create({ data: {
          code: parsed.data.code, name: parsed.data.name, adapterType: parsed.data.adapterType,
          endpointUrl: parsed.data.endpointUrl || null, description: parsed.data.description ?? null,
          status: 'ACTIVE', secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretAuthTag: encrypted.authTag,
          keyVersion: 1, lastRotatedAt: new Date(), createdById: actor.sub, updatedById: actor.sub,
        } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'IntegrationCredential', entityId: created.id, action: 'INTEGRATION_CREDENTIAL_CREATED', changes: { code: created.code, adapterType: created.adapterType, secretConfigured: true, secretVersion: 1 } } });
        return created;
      });
      return reply.code(201).send(success(publicIntegration(row)));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return failure(reply, 409, 'INTEGRATION_CODE_EXISTS', '集成编码已存在');
      throw error;
    }
  });

  app.patch('/integrations/:id', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = integrationPatch.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '集成修改参数有误');
    const old = await prisma.integrationCredential.findUnique({ where: { id: params.data.id } });
    if (!old) return failure(reply, 404, 'INTEGRATION_NOT_FOUND', '集成配置不存在');
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.integrationCredential.update({ where: { id: old.id }, data: { ...parsed.data, updatedById: actor.sub } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'IntegrationCredential', entityId: old.id, action: 'INTEGRATION_METADATA_UPDATED', changes: { before: { name: old.name, endpointUrl: old.endpointUrl, description: old.description, status: old.status }, after: { name: updated.name, endpointUrl: updated.endpointUrl, description: updated.description, status: updated.status } } } });
      return updated;
    });
    return success(publicIntegration(row));
  });

  app.post('/integrations/:id/rotate-secret', async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = secretRotation.safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '新凭据参数有误');
    const old = await prisma.integrationCredential.findUnique({ where: { id: params.data.id } });
    if (!old) return failure(reply, 404, 'INTEGRATION_NOT_FOUND', '集成配置不存在');
    const nextVersion = old.keyVersion + 1;
    let encrypted: ReturnType<typeof encryptIntegrationSecret>;
    try { encrypted = encryptIntegrationSecret(parsed.data.secret, old.code, nextVersion); }
    catch (error) {
      if (error instanceof Error && error.message === 'INTEGRATION_ENCRYPTION_KEY_MISSING_OR_INVALID') return failure(reply, 503, 'INTEGRATION_VAULT_NOT_CONFIGURED', '集成凭据保险库未配置有效的 INTEGRATION_ENCRYPTION_KEY');
      throw error;
    }
    const row = await prisma.$transaction(async (tx) => {
      // Optimistic version guard prevents concurrent rotations from silently overwriting each other.
      const changed = await tx.integrationCredential.updateMany({ where: { id: old.id, keyVersion: old.keyVersion }, data: { secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretAuthTag: encrypted.authTag, keyVersion: nextVersion, lastRotatedAt: new Date(), updatedById: actor.sub } });
      if (changed.count !== 1) throw new Error('INTEGRATION_SECRET_ROTATION_RACE');
      const updated = await tx.integrationCredential.findUniqueOrThrow({ where: { id: old.id } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'IntegrationCredential', entityId: old.id, action: 'INTEGRATION_SECRET_ROTATED', changes: { code: old.code, previousVersion: old.keyVersion, secretVersion: nextVersion, note: parsed.data.changeNote ?? null, secretValueStored: false } } });
      return updated;
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'INTEGRATION_SECRET_ROTATION_RACE') return null;
      throw error;
    });
    if (!row) return failure(reply, 409, 'INTEGRATION_SECRET_ROTATION_RACE', '凭据已被其他管理员轮换，请刷新后重试');
    return success(publicIntegration(row));
  });

  app.post('/integrations/:id/test-connection', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '集成编号有误');
    const row = await prisma.integrationCredential.findUnique({ where: { id: params.data.id } });
    if (!row) return failure(reply, 404, 'INTEGRATION_NOT_FOUND', '集成配置不存在');
    if (!row.endpointUrl || !row.secretCiphertext || !row.secretIv || !row.secretAuthTag) return failure(reply, 409, 'INTEGRATION_ENDPOINT_OR_SECRET_MISSING', '请先配置 HTTPS 端点与有效凭据');
    let status = 'FAILED';
    let summary = 'INTEGRATION_TEST_FAILED';
    let httpStatus: number | null = null;
    let durationMs: number | null = null;
    try {
      const secret = decryptIntegrationSecret({ ciphertext: row.secretCiphertext, iv: row.secretIv, authTag: row.secretAuthTag }, row.code, row.keyVersion);
      const result = await requestIntegrationEndpoint({ endpointUrl: row.endpointUrl, method: 'HEAD', bearerSecret: secret, timeoutMs: 8_000 });
      status = 'SUCCEEDED'; summary = `HTTP_${result.statusCode}`; httpStatus = result.statusCode; durationMs = result.durationMs;
    } catch (error) {
      summary = error instanceof IntegrationHttpError ? error.code : error instanceof Error && error.message === 'INTEGRATION_ENCRYPTION_KEY_MISSING_OR_INVALID' ? 'INTEGRATION_VAULT_NOT_CONFIGURED' : 'INTEGRATION_TEST_FAILED';
    }
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.integrationCredential.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestStatus: status, lastTestSummary: summary, updatedById: actor.sub } });
      await tx.auditLog.create({ data: { userId: actor.sub, entity: 'IntegrationCredential', entityId: row.id, action: status === 'SUCCEEDED' ? 'INTEGRATION_CONNECTION_TEST_SUCCEEDED' : 'INTEGRATION_CONNECTION_TEST_FAILED', changes: { code: row.code, host: (() => { try { return new URL(row.endpointUrl!).hostname; } catch { return null; } })(), status, summary, httpStatus, durationMs } } });
      return saved;
    });
    return status === 'SUCCEEDED' ? success({ integration: publicIntegration(updated), httpStatus, durationMs, message: 'HTTPS 端点已响应；这只验证网络与 HTTP 可达性，不代表 ERP 业务映射或同步正确' })
      : failure(reply, 502, summary, '连接测试未通过。检查 HTTPS 端点、允许主机列表、DNS 解析、Bearer 凭据与目标端点日志');
  });

  app.post('/integrations/:id/dispatch', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    const parsed = z.object({ idempotencyKey: z.string().trim().min(8).max(200), payload: z.record(z.unknown()) }).safeParse(request.body);
    if (!params.success || !parsed.success) return failure(reply, 400, 'VALIDATION_ERROR', '投递参数有误；需要至少 8 位幂等键与 JSON 对象载荷');
    let payloadText = '';
    try { payloadText = JSON.stringify(parsed.data.payload); } catch { return failure(reply, 400, 'INTEGRATION_PAYLOAD_INVALID', '投递载荷不是有效 JSON'); }
    if (payloadText.length > 256 * 1024) return failure(reply, 413, 'INTEGRATION_PAYLOAD_TOO_LARGE', 'Webhook JSON 载荷不得超过 256 KB');
    const credentialLikeKey = /(?:password|secret|token|private.?key|api.?key|credential)/i;
    const inspectKeys = (value: unknown, depth = 0): boolean => {
      if (depth > 12) return true;
      if (value === null || typeof value !== 'object') return false;
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (credentialLikeKey.test(key) || inspectKeys(item, depth + 1)) return true;
      return false;
    };
    if (inspectKeys(parsed.data.payload)) return failure(reply, 400, 'INTEGRATION_PAYLOAD_CONTAINS_SECRET', '投递载荷包含疑似凭据字段；凭据只能由保险库自动附加，不能写进 JSON 载荷');
    const integration = await prisma.integrationCredential.findUnique({ where: { id: params.data.id } });
    if (!integration || integration.status !== 'ACTIVE') return failure(reply, 409, 'INTEGRATION_NOT_ACTIVE', '集成不存在或已停用');
    if (!['WEBHOOK', 'REST_API'].includes(integration.adapterType)) return failure(reply, 409, 'INTEGRATION_ADAPTER_UNSUPPORTED', '当前仅开放 WEBHOOK 与 REST_API 的通用 JSON 投递；ERP 等专用适配器需要独立映射实现');
    if (!integration.endpointUrl || !integration.secretCiphertext) return failure(reply, 409, 'INTEGRATION_ENDPOINT_OR_SECRET_MISSING', '请先配置 HTTPS 端点与加密凭据');
    const requestHash = hashJobRequest({ integrationId: integration.id, payload: parsed.data.payload });
    const existing = await prisma.backgroundJob.findFirst({ where: { ownerUserId: actor.sub, idempotencyKey: parsed.data.idempotencyKey }, select: { id: true, type: true, requestHash: true, status: true } });
    if (existing) {
      if (existing.type !== 'integration.json.dispatch' || existing.requestHash !== requestHash) return failure(reply, 409, 'IDEMPOTENCY_KEY_REUSED', '该幂等键已用于不同请求，请使用新的幂等键');
      return success({ id: existing.id, status: existing.status, idempotentReplay: true });
    }
    try {
      const job = await prisma.$transaction((tx) => enqueueBackgroundJob(tx, {
        type: 'integration.json.dispatch', payloadVersion: 1,
        payload: { integrationId: integration.id, requestBody: parsed.data.payload } as Prisma.InputJsonObject,
        ownerUserId: actor.sub, idempotencyKey: parsed.data.idempotencyKey, requestHash, maxAttempts: 5,
      }));
      await writeAudit({ userId: actor.sub, entity: 'BackgroundJob', entityId: job.id, action: 'INTEGRATION_DISPATCH_QUEUED', changes: { integrationId: integration.id, code: integration.code, adapterType: integration.adapterType, requestHash, maxAttempts: job.maxAttempts, bodyBytes: Buffer.byteLength(payloadText) } });
      return reply.code(202).send(success({ id: job.id, status: job.status, attempts: job.attempts, maxAttempts: job.maxAttempts, message: '已加入后台投递队列；网络失败及 HTTP 429/5xx 将按退避策略重试，幂等键用于阻止重复入队' }));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        const raced = await prisma.backgroundJob.findFirst({ where: { ownerUserId: actor.sub, idempotencyKey: parsed.data.idempotencyKey }, select: { id: true, type: true, requestHash: true, status: true } });
        if (raced?.type === 'integration.json.dispatch' && raced.requestHash === requestHash) return success({ id: raced.id, status: raced.status, idempotentReplay: true });
        return failure(reply, 409, 'IDEMPOTENCY_KEY_REUSED', '该幂等键已被其他并发请求占用');
      }
      throw error;
    }
  });

  app.get('/integrations/:id/deliveries', async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '集成编号有误');
    const integration = await prisma.integrationCredential.findUnique({ where: { id: params.data.id }, select: { id: true } });
    if (!integration) return failure(reply, 404, 'INTEGRATION_NOT_FOUND', '集成配置不存在');
    const rows = await prisma.backgroundJob.findMany({
      where: { type: 'integration.json.dispatch', payload: { path: ['integrationId'], equals: integration.id } },
      take: 100, orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, attempts: true, maxAttempts: true, availableAt: true, createdAt: true, startedAt: true, finishedAt: true, resultMetadata: true, lastError: true, idempotencyKey: true },
    });
    return success(rows.map((row) => ({ ...row, lastError: row.lastError ? '投递失败；已按队列策略重试或进入终态，请查看受控服务日志与目标端点记录' : null })));
  });

  app.post('/data-quality/scan', async (request, reply) => {
    const actor = authUser(request);
    const now = new Date();
    const staleReviewBefore = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [missingContracts, missingAmounts, incompleteExternal, staleReviews, adminMfa, unassignedUsers, integrationsWithoutSecret] = await Promise.all([
      prisma.project.findMany({ where: { deletedAt: null, mainContract: null }, select: { id: true, code: true, name: true }, take: 200, orderBy: { updatedAt: 'desc' } }),
      prisma.change.findMany({ where: { deletedAt: null, status: 'CONFIRMED', approvedAmount: null }, select: { id: true, projectId: true, code: true, name: true }, take: 200, orderBy: { updatedAt: 'desc' } }),
      prisma.change.findMany({ where: { deletedAt: null, externalConfirmationStatus: 'EFFECTIVE', OR: [{ externalConfirmedAt: null }, { externalConfirmedAmount: null }, { evidenceReference: null }, { externalRecordedById: null }] }, select: { id: true, projectId: true, code: true, name: true }, take: 200, orderBy: { updatedAt: 'desc' } }),
      prisma.change.findMany({ where: { deletedAt: null, internalAmountReviewStatus: 'PENDING', internalAmountReviewTriggeredAt: { lt: staleReviewBefore } }, select: { id: true, projectId: true, code: true, name: true, internalAmountReviewTriggeredAt: true }, take: 200, orderBy: { internalAmountReviewTriggeredAt: 'asc' } }),
      prisma.user.findMany({ where: { isActive: true, role: 'ADMIN', OR: [{ mfaEnabled: false }, { passwordResetRequired: true }] }, select: { id: true, name: true, email: true, mfaEnabled: true, passwordResetRequired: true }, take: 200 }),
      prisma.user.findMany({ where: { isActive: true, departmentId: null }, select: { id: true, name: true, email: true }, take: 200 }),
      prisma.integrationCredential.findMany({ where: { status: 'ACTIVE', secretCiphertext: null }, select: { id: true, code: true, name: true }, take: 200 }),
    ]);
    const findings = [
      ...missingContracts.map((row) => ({ severity: 'WARNING', code: 'PROJECT_MAIN_CONTRACT_MISSING', entity: 'Project', entityId: row.id, title: '项目缺少业主主合同', detail: `${row.code} · ${row.name}` })),
      ...missingAmounts.map((row) => ({ severity: 'ERROR', code: 'CONFIRMED_CHANGE_AMOUNT_MISSING', entity: 'Change', entityId: row.id, projectId: row.projectId, title: '内部已审批的变更缺少核定金额', detail: `${row.code} · ${row.name}` })),
      ...incompleteExternal.map((row) => ({ severity: 'ERROR', code: 'EFFECTIVE_EXTERNAL_CONFIRMATION_INCOMPLETE', entity: 'Change', entityId: row.id, projectId: row.projectId, title: '标记生效的外部确认资料不完整', detail: `${row.code} · ${row.name}` })),
      ...staleReviews.map((row) => ({ severity: 'WARNING', code: 'STALE_AMOUNT_DISCREPANCY_REVIEW', entity: 'Change', entityId: row.id, projectId: row.projectId, title: '有效金额差异复核已超过 30 天', detail: `${row.code} · ${row.name} · ${row.internalAmountReviewTriggeredAt?.toISOString() ?? ''}` })),
      ...adminMfa.map((row) => ({ severity: 'ERROR', code: 'ADMIN_SECURITY_ACTION_REQUIRED', entity: 'User', entityId: row.id, title: '管理员账号存在安全待办', detail: `${row.name} · MFA=${row.mfaEnabled ? '已启用' : '未启用'} · 强制改密=${row.passwordResetRequired ? '是' : '否'}` })),
      ...unassignedUsers.map((row) => ({ severity: 'INFO', code: 'ACTIVE_USER_WITHOUT_DEPARTMENT', entity: 'User', entityId: row.id, title: '启用账号尚未配置部门归属', detail: `${row.name} · ${row.email}` })),
      ...integrationsWithoutSecret.map((row) => ({ severity: 'ERROR', code: 'ACTIVE_INTEGRATION_SECRET_MISSING', entity: 'IntegrationCredential', entityId: row.id, title: '启用的集成未配置凭据', detail: `${row.code} · ${row.name}` })),
    ];
    const summary = { total: findings.length, errors: findings.filter((item) => item.severity === 'ERROR').length, warnings: findings.filter((item) => item.severity === 'WARNING').length, info: findings.filter((item) => item.severity === 'INFO').length, scannedAt: now.toISOString(), truncated: [missingContracts, missingAmounts, incompleteExternal, staleReviews, adminMfa, unassignedUsers, integrationsWithoutSecret].some((rows) => rows.length === 200) };
    await writeAudit({ userId: actor.sub, entity: 'SystemDataQualityScan', entityId: `scan-${now.getTime()}`, action: 'DATA_QUALITY_SCAN', changes: summary as unknown as Prisma.InputJsonValue });
    return reply.code(200).send(success({ summary, findings }));
  });

  app.get('/backups', async () => {
    const rows = await prisma.systemBackupRun.findMany({ take: 50, orderBy: { startedAt: 'desc' }, include: { triggeredBy: { select: { name: true, email: true } } } });
    return success(rows.map(serialiseBackup));
  });

  app.post('/backups', { config: { rateLimit: { max: 2, timeWindow: '1 hour' } } }, async (request, reply) => {
    const actor = authUser(request);
    const databaseUrl = process.env.DATABASE_URL;
    const globalsUrl = process.env.BACKUP_GLOBALS_DATABASE_URL;
    const backupRootSetting = process.env.BACKUP_DIR;
    if (!databaseUrl || !globalsUrl || !backupRootSetting) return failure(reply, 503, 'BACKUP_NOT_CONFIGURED', '完整备份需要 DATABASE_URL、BACKUP_GLOBALS_DATABASE_URL 与 BACKUP_DIR；全局角色备份不能静默省略');
    if (!isAbsolute(backupRootSetting)) return failure(reply, 503, 'BACKUP_DIRECTORY_INVALID', '备份目录必须是绝对路径');
    try { parseBackupKeyRing(); }
    catch { return failure(reply, 503, 'BACKUP_ENCRYPTION_NOT_CONFIGURED', '请配置 BACKUP_ENCRYPTION_KEYS 与 BACKUP_ACTIVE_ENCRYPTION_KEY_ID，并保留旧密钥直至所有对应备份过期'); }
    const backupRoot = resolve(backupRootSetting);
    if (!isAbsolute(backupRoot) || backupRoot === parsePath(backupRoot).root) return failure(reply, 503, 'BACKUP_DIRECTORY_INVALID', '备份目录必须是独立的绝对目录，不能指向文件系统根目录');
    const run = await prisma.systemBackupRun.create({ data: { type: 'BACKUP', status: 'RUNNING', triggeredById: actor.sub } });
    const started = Date.now();
    let databaseEncryptedPath = '';
    let globalsEncryptedPath = '';
    let workspace = '';
    try {
      const target = parseDatabaseUrl(databaseUrl);
      const globalsTarget = parseDatabaseUrl(globalsUrl);
      await mkdir(backupRoot, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') await chmod(backupRoot, 0o700);
      workspace = await mkdtemp(join(backupRoot, '.moheng-backup-'));
      if (process.platform !== 'win32') await chmod(workspace, 0o700);
      const token = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(8).toString('hex')}`;
      const fileName = `moheng-${token}.dump.enc`;
      const globalsFileName = `moheng-${token}.globals.sql.enc`;
      databaseEncryptedPath = join(backupRoot, fileName);
      globalsEncryptedPath = join(backupRoot, globalsFileName);
      const plainDatabase = join(workspace, 'database.dump');
      const plainGlobals = join(workspace, 'globals.sql');
      const pgDump = await runCommand(process.env.PG_DUMP_PATH || 'pg_dump', [
        '--format=custom', '--no-owner', '--no-acl', '--host', target.host, '--port', String(target.port),
        '--username', target.username, '--dbname', target.database, '--file', plainDatabase,
      ], pgEnvironment(target));
      if (pgDump.code !== 0) throw new Error('PG_DUMP_FAILED');
      const globalsDump = await runCommand(process.env.PG_DUMPALL_PATH || 'pg_dumpall', [
        '--globals-only', '--host', globalsTarget.host, '--port', String(globalsTarget.port),
        '--username', globalsTarget.username, '--file', plainGlobals,
      ], pgEnvironment(globalsTarget));
      if (globalsDump.code !== 0) throw new Error('BACKUP_GLOBALS_DUMP_FAILED');
      const [plainDbStat, plainGlobalsStat] = await Promise.all([stat(plainDatabase), stat(plainGlobals)]);
      if (!plainDbStat.isFile() || plainDbStat.size <= 0) throw new Error('BACKUP_FILE_EMPTY');
      if (!plainGlobalsStat.isFile() || plainGlobalsStat.size <= 0) throw new Error('BACKUP_GLOBALS_FILE_EMPTY');
      await Promise.all([encryptBackupFile(plainDatabase, databaseEncryptedPath), encryptBackupFile(plainGlobals, globalsEncryptedPath)]);
      // Authentication tag verification plus pg_restore --list confirms the encrypted custom archive is readable.
      const verifyPlain = join(workspace, 'verify.dump');
      await decryptBackupFile(databaseEncryptedPath, verifyPlain);
      const listed = await runCommand(process.env.PG_RESTORE_PATH || 'pg_restore', ['--list', verifyPlain], pgEnvironment(target), 60_000);
      await unlink(verifyPlain).catch(() => undefined);
      if (listed.code !== 0 || !listed.stdout.trim()) throw new Error('BACKUP_ARCHIVE_VERIFY_FAILED');
      const [dbStat, globalsStat, sha256, globalsSha256] = await Promise.all([
        stat(databaseEncryptedPath), stat(globalsEncryptedPath), sha256File(databaseEncryptedPath), sha256File(globalsEncryptedPath),
      ]);
      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.systemBackupRun.update({ where: { id: run.id }, data: {
          status: 'SUCCEEDED', fileName, fileSize: BigInt(dbStat.size), sha256,
          globalsFileName, globalsFileSize: BigInt(globalsStat.size), globalsSha256,
          finishedAt: new Date(), durationMs: Date.now() - started, verified: false,
          message: '业务数据库与 PostgreSQL 全局角色/配置均已 AES-256-GCM 加密并校验 SHA-256；仍需在隔离实例完成恢复演练。',
        } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemBackupRun', entityId: saved.id, action: 'DATABASE_BACKUP_CREATED', changes: {
          fileName, fileSize: String(dbStat.size), sha256, globalsFileName, globalsFileSize: String(globalsStat.size), globalsSha256,
          encryptedAtRest: true, globalsIncluded: true, archiveListed: true,
        } } });
        return saved;
      });
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      workspace = '';
      try { await pruneExpiredBackups(backupRoot, actor.sub); }
      catch { request.log.warn({ backupRunId: run.id }, 'Backup retention cleanup failed; no backup result was changed'); }
      return reply.code(201).send(success({
        id: updated.id, type: updated.type, status: updated.status, fileName: updated.fileName,
        fileSize: String(updated.fileSize), sha256: updated.sha256,
        globalsFileName: updated.globalsFileName, globalsFileSize: String(updated.globalsFileSize), globalsSha256: updated.globalsSha256,
        startedAt: updated.startedAt, finishedAt: updated.finishedAt, durationMs: updated.durationMs, verified: updated.verified, message: updated.message,
      }));
    } catch (error) {
      if (databaseEncryptedPath) await unlink(databaseEncryptedPath).catch(() => undefined);
      if (globalsEncryptedPath) await unlink(globalsEncryptedPath).catch(() => undefined);
      if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      const code = error instanceof Error ? error.message : 'BACKUP_FAILED';
      const errorCode = code === 'COMMAND_TIMEOUT' ? 'BACKUP_TIMEOUT'
        : code === 'BACKUP_ENCRYPTION_NOT_CONFIGURED' || code.startsWith('BACKUP_ENCRYPTION_') ? 'BACKUP_ENCRYPTION_NOT_CONFIGURED'
        : code === 'BACKUP_GLOBALS_DUMP_FAILED' ? 'BACKUP_GLOBALS_DUMP_FAILED'
        : code === 'DATABASE_URL_INVALID' ? 'DATABASE_URL_INVALID' : 'BACKUP_FAILED';
      await prisma.systemBackupRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), durationMs: Date.now() - started, message: errorCode } });
      await writeAudit({ userId: actor.sub, entity: 'SystemBackupRun', entityId: run.id, action: 'DATABASE_BACKUP_FAILED', changes: { errorCode } });
      const message = errorCode === 'BACKUP_TIMEOUT' ? '数据库备份超时，已记录失败状态'
        : errorCode === 'BACKUP_GLOBALS_DUMP_FAILED' ? '全局角色/配置备份失败。请使用具备 pg_dumpall 所需权限的 BACKUP_GLOBALS_DATABASE_URL；系统不会静默生成不完整备份'
        : errorCode === 'BACKUP_ENCRYPTION_NOT_CONFIGURED' ? '备份加密密钥未配置或有效密钥版本缺失'
        : '数据库或全局配置备份未完成。请检查受控服务日志、PostgreSQL CLI 版本和备份目录权限';
      return failure(reply, 503, errorCode, message);
    }
  });

  app.post('/backups/:id/restore-drill', { config: { rateLimit: { max: 1, timeWindow: '1 hour' } } }, async (request, reply) => {
    const actor = authUser(request);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '备份编号有误');
    const source = await prisma.systemBackupRun.findUnique({ where: { id: params.data.id } });
    if (!source || source.type !== 'BACKUP' || source.status !== 'SUCCEEDED' || !source.fileName || !source.sha256) return failure(reply, 409, 'BACKUP_NOT_RESTORABLE', '只能对已成功且具备校验和的备份执行恢复演练');
    if (!source.globalsFileName || !source.globalsSha256 || source.globalsFileSize == null) return failure(reply, 409, 'BACKUP_GLOBALS_MISSING', '该备份缺少 PostgreSQL 全局配置归档；请重新创建完整加密备份');
    if (!process.env.DATABASE_URL || !process.env.RESTORE_TEST_DATABASE_URL || !process.env.BACKUP_DIR) return failure(reply, 503, 'RESTORE_DRILL_NOT_CONFIGURED', '需要配置生产 DATABASE_URL、RESTORE_TEST_DATABASE_URL 和 BACKUP_DIR');
    if (basename(source.fileName) !== source.fileName || !/^moheng-[A-Za-z0-9T_-]+\.dump\.enc$/.test(source.fileName)) return failure(reply, 409, 'BACKUP_FILENAME_UNSAFE', '加密备份文件名校验失败');
    if (basename(source.globalsFileName) !== source.globalsFileName || !/^moheng-[A-Za-z0-9T_-]+\.globals\.sql\.enc$/.test(source.globalsFileName)) return failure(reply, 409, 'BACKUP_GLOBALS_FILENAME_UNSAFE', '全局配置备份文件名校验失败');
    const root = resolve(process.env.BACKUP_DIR);
    const backupPath = join(root, source.fileName);
    const globalsPath = join(root, source.globalsFileName);
    if (!backupPath.startsWith(`${root}${sep}`) || !globalsPath.startsWith(`${root}${sep}`)) return failure(reply, 409, 'BACKUP_PATH_UNSAFE', '备份文件路径校验失败');
    const run = await prisma.systemBackupRun.create({ data: { type: 'RESTORE_DRILL', status: 'RUNNING', sourceBackupId: source.id, fileName: source.fileName, fileSize: source.fileSize, sha256: source.sha256, globalsFileName: source.globalsFileName, globalsFileSize: source.globalsFileSize, globalsSha256: source.globalsSha256, triggeredById: actor.sub } });
    const started = Date.now();
    let workspace = '';
    let target: ReturnType<typeof parseDatabaseUrl> | null = null;
    let drillDatabase = '';
    let drillDatabaseCreated = false;
    try {
      const [dbStat, globalsStat] = await Promise.all([stat(backupPath), stat(globalsPath)]);
      if (!dbStat.isFile() || dbStat.size <= 0 || (source.fileSize != null && BigInt(dbStat.size) !== source.fileSize) || await sha256File(backupPath) !== source.sha256) throw new Error('BACKUP_INTEGRITY_FAILED');
      if (!globalsStat.isFile() || globalsStat.size <= 0 || BigInt(globalsStat.size) !== source.globalsFileSize || await sha256File(globalsPath) !== source.globalsSha256) throw new Error('BACKUP_GLOBALS_INTEGRITY_FAILED');
      const targetBase = await assertIsolatedRestoreTarget(process.env.DATABASE_URL, process.env.RESTORE_TEST_DATABASE_URL);
      workspace = await mkdtemp(join(root, '.moheng-restore-'));
      if (process.platform !== 'win32') await chmod(workspace, 0o700);
      const plainDatabase = join(workspace, 'database.dump');
      const plainGlobals = join(workspace, 'globals.sql');
      await Promise.all([decryptBackupFile(backupPath, plainDatabase), decryptBackupFile(globalsPath, plainGlobals)]);
      const globalsPlainStat = await stat(plainGlobals);
      if (!globalsPlainStat.isFile() || globalsPlainStat.size <= 0) throw new Error('BACKUP_GLOBALS_DECRYPT_FAILED');
      // Never apply pg_dumpall globals automatically during a drill; it may affect roles beyond the disposable DB.
      const token = randomBytes(6).toString('hex');
      drillDatabase = `mh_${token}_restore_test`;
      target = { ...targetBase, database: drillDatabase };
      const created = await runCommand(process.env.CREATEDB_PATH || 'createdb', [
        '--no-password', '--host', targetBase.host, '--port', String(targetBase.port), '--username', targetBase.username,
        '--maintenance-db', targetBase.database, '--template', 'template0', drillDatabase,
      ], pgEnvironment(targetBase), 30_000);
      if (created.code !== 0) throw new Error('RESTORE_TEMP_DATABASE_CREATE_FAILED');
      drillDatabaseCreated = true;
      const restore = await runCommand(process.env.PG_RESTORE_PATH || 'pg_restore', [
        '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction',
        '--host', target.host, '--port', String(target.port), '--username', target.username, '--dbname', target.database, plainDatabase,
      ], pgEnvironment(target));
      if (restore.code !== 0) throw new Error('PG_RESTORE_FAILED');
      const verify = await runCommand(process.env.PSQL_PATH || 'psql', [
        '--no-psqlrc', '--tuples-only', '--no-align', '--host', target.host, '--port', String(target.port),
        '--username', target.username, '--dbname', target.database, '--command',
        `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('User','Project','MainContract')`,
      ], pgEnvironment(target), 30_000);
      const tableCount = Number(verify.stdout.trim().split(/\s+/).at(-1));
      if (verify.code !== 0 || !Number.isFinite(tableCount) || tableCount < 3) throw new Error('RESTORE_VERIFY_FAILED');
      const drop = await runCommand(process.env.DROPDB_PATH || 'dropdb', [
        '--no-password', '--if-exists', '--force', '--host', targetBase.host, '--port', String(targetBase.port),
        '--username', targetBase.username, '--maintenance-db', targetBase.database, drillDatabase,
      ], pgEnvironment(targetBase), 30_000);
      if (drop.code !== 0) throw new Error('RESTORE_TEMP_DATABASE_CLEANUP_FAILED');
      drillDatabaseCreated = false;
      const result = await prisma.$transaction(async (tx) => {
        const saved = await tx.systemBackupRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', verified: true, finishedAt: new Date(), durationMs: Date.now() - started, message: `加密数据库归档与全局配置均通过 SHA-256/AES-GCM 校验；数据库恢复至临时隔离库并验证核心表=${tableCount}，临时库已删除。全局 SQL 已解密校验但未自动执行。` } });
        await tx.systemBackupRun.update({ where: { id: source.id }, data: { verified: true, message: `已通过隔离恢复演练 ${saved.id}；数据库与全局归档校验通过。` } });
        await tx.auditLog.create({ data: { userId: actor.sub, entity: 'SystemBackupRun', entityId: saved.id, action: 'DATABASE_RESTORE_DRILL_SUCCEEDED', changes: { sourceBackupId: source.id, sha256: source.sha256, globalsSha256: source.globalsSha256, coreTablesVerified: tableCount, temporaryDatabaseCreatedAndDropped: true, globalsApplied: false } } });
        return saved;
      });
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      workspace = '';
      return reply.code(201).send(success({ id: result.id, type: result.type, status: result.status, sourceBackupId: result.sourceBackupId, fileName: result.fileName, sha256: result.sha256, finishedAt: result.finishedAt, durationMs: result.durationMs, verified: result.verified, message: result.message }));
    } catch (error) {
      let cleanupFailed = false;
      if (drillDatabaseCreated && target && process.env.RESTORE_TEST_DATABASE_URL) {
        const base = parseDatabaseUrl(process.env.RESTORE_TEST_DATABASE_URL);
        const drop = await runCommand(process.env.DROPDB_PATH || 'dropdb', ['--no-password', '--if-exists', '--force', '--host', base.host, '--port', String(base.port), '--username', base.username, '--maintenance-db', base.database, target.database], pgEnvironment(base), 30_000).catch(() => null);
        cleanupFailed = !drop || drop.code !== 0;
      }
      if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      const rawCode = error instanceof Error ? error.message : 'RESTORE_DRILL_FAILED';
      const errorCode = ['RESTORE_TARGET_NAME_UNSAFE', 'RESTORE_TARGET_HOST_NOT_ISOLATED', 'RESTORE_TARGET_CLUSTER_NOT_ISOLATED', 'RESTORE_CLUSTER_ID_UNVERIFIABLE', 'BACKUP_INTEGRITY_FAILED', 'BACKUP_GLOBALS_INTEGRITY_FAILED', 'BACKUP_ENCRYPTION_NOT_CONFIGURED', 'BACKUP_ENCRYPTION_KEY_VERSION_UNAVAILABLE', 'BACKUP_ENCRYPTED_FORMAT_INVALID', 'BACKUP_DECRYPTION_FAILED', 'RESTORE_TEMP_DATABASE_CREATE_FAILED', 'RESTORE_TEMP_DATABASE_CLEANUP_FAILED'].includes(rawCode) ? rawCode : cleanupFailed ? 'RESTORE_TEMP_DATABASE_CLEANUP_FAILED' : rawCode === 'COMMAND_TIMEOUT' ? rawCode : 'RESTORE_DRILL_FAILED';
      await prisma.systemBackupRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), durationMs: Date.now() - started, verified: false, message: errorCode } });
      await writeAudit({ userId: actor.sub, entity: 'SystemBackupRun', entityId: run.id, action: 'DATABASE_RESTORE_DRILL_FAILED', changes: { sourceBackupId: source.id, errorCode, cleanupFailed } });
      const message = errorCode === 'RESTORE_TARGET_HOST_NOT_ISOLATED' ? '恢复目标与生产数据库解析到相同地址，已阻止恢复'
        : errorCode === 'RESTORE_TARGET_CLUSTER_NOT_ISOLATED' ? '恢复目标与生产数据库属于同一 PostgreSQL 集群，已阻止恢复'
        : errorCode === 'RESTORE_CLUSTER_ID_UNVERIFIABLE' ? '无法验证 PostgreSQL 集群标识；请为运维数据库账号授予只读 pg_monitor 权限后重试'
        : errorCode === 'BACKUP_INTEGRITY_FAILED' || errorCode === 'BACKUP_GLOBALS_INTEGRITY_FAILED' ? '数据库或全局配置备份校验失败，已阻止恢复'
        : errorCode === 'RESTORE_TEMP_DATABASE_CLEANUP_FAILED' ? '恢复演练清理临时数据库失败；请立即检查隔离 PostgreSQL 并人工删除临时库'
        : '加密备份恢复演练未通过；已记录失败状态，请检查密钥环、隔离数据库权限及受控服务日志';
      return failure(reply, 503, errorCode, message);
    }
  });

  app.get('/backups/:id/download', async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '备份编号有误');
    const row = await prisma.systemBackupRun.findUnique({ where: { id: params.data.id } });
    if (!row || row.type !== 'BACKUP' || row.status !== 'SUCCEEDED' || !row.fileName || !row.sha256 || !process.env.BACKUP_DIR) return failure(reply, 404, 'BACKUP_NOT_FOUND', '可下载的数据库备份不存在');
    if (basename(row.fileName) !== row.fileName || !/^moheng-[A-Za-z0-9T_-]+\.dump\.enc$/.test(row.fileName)) return failure(reply, 409, 'BACKUP_FILENAME_UNSAFE', '加密备份文件名校验失败');
    const filePath = join(resolve(process.env.BACKUP_DIR), row.fileName);
    let fileStat;
    let fileHash: string;
    try { fileStat = await stat(filePath); if (!fileStat.isFile()) return failure(reply, 404, 'BACKUP_FILE_MISSING', '加密备份文件不存在或无法读取'); fileHash = await sha256File(filePath); }
    catch { return failure(reply, 404, 'BACKUP_FILE_MISSING', '加密备份文件不存在或无法读取'); }
    if ((row.fileSize != null && BigInt(fileStat.size) !== row.fileSize) || fileHash !== row.sha256) return failure(reply, 409, 'BACKUP_INTEGRITY_FAILED', '加密备份文件校验失败，拒绝下载');
    await writeAudit({ userId: authUser(request).sub, entity: 'SystemBackupRun', entityId: row.id, action: 'DATABASE_BACKUP_DOWNLOADED', changes: { fileName: row.fileName, fileSize: String(fileStat.size), sha256: row.sha256, encryptedAtRest: true } });
    return reply.header('content-type', 'application/octet-stream').header('content-length', String(fileStat.size)).header('content-disposition', `attachment; filename="${row.fileName}"`).header('cache-control', 'private, no-store').send(createReadStream(filePath));
  });

  app.get('/backups/:id/globals-download', async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return failure(reply, 400, 'VALIDATION_ERROR', '备份编号有误');
    const row = await prisma.systemBackupRun.findUnique({ where: { id: params.data.id } });
    if (!row || row.type !== 'BACKUP' || row.status !== 'SUCCEEDED' || !row.globalsFileName || !row.globalsSha256 || row.globalsFileSize == null || !process.env.BACKUP_DIR) return failure(reply, 404, 'BACKUP_GLOBALS_NOT_FOUND', '完整备份中的 PostgreSQL 全局配置归档不存在');
    if (basename(row.globalsFileName) !== row.globalsFileName || !/^moheng-[A-Za-z0-9T_-]+\.globals\.sql\.enc$/.test(row.globalsFileName)) return failure(reply, 409, 'BACKUP_GLOBALS_FILENAME_UNSAFE', '全局配置归档文件名校验失败');
    const filePath = join(resolve(process.env.BACKUP_DIR), row.globalsFileName);
    try {
      const info = await stat(filePath);
      if (!info.isFile() || BigInt(info.size) !== row.globalsFileSize || await sha256File(filePath) !== row.globalsSha256) return failure(reply, 409, 'BACKUP_GLOBALS_INTEGRITY_FAILED', '全局配置归档校验失败，拒绝下载');
      await writeAudit({ userId: authUser(request).sub, entity: 'SystemBackupRun', entityId: row.id, action: 'DATABASE_BACKUP_GLOBALS_DOWNLOADED', changes: { fileName: row.globalsFileName, fileSize: String(info.size), sha256: row.globalsSha256, encryptedAtRest: true } });
      return reply.header('content-type', 'application/octet-stream').header('content-length', String(info.size)).header('content-disposition', `attachment; filename="${row.globalsFileName}"`).header('cache-control', 'private, no-store').send(createReadStream(filePath));
    } catch { return failure(reply, 404, 'BACKUP_GLOBALS_FILE_MISSING', '全局配置归档不存在或无法读取'); }
  });
}
