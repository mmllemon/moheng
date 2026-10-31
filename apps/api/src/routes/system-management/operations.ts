import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { basename, isAbsolute, join, parse as parsePath, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { success, failure } from '../../lib/http.js';
import { authUser } from '../../lib/auth.js';
import { serialiseBackup, parseDatabaseUrl, pgEnvironment, runCommand, sha256File, pruneExpiredBackups, assertIsolatedRestoreTarget, writeAudit } from './helpers.js';
import { encryptBackupFile, decryptBackupFile, parseBackupKeyRing } from '../../lib/backup-encryption.js';

export async function registerOperationsRoutes(app: FastifyInstance) {
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
