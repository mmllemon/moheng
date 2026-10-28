import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Archive, CheckCircle2, Database, Download, HardDrive, RefreshCw, ServerCog, ShieldAlert } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../auth-store';
import { Button, ErrorBlock, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';
import { confirmThen } from '../components/ConfirmDialog';

type BackupRun = { id: string; type: 'BACKUP' | 'RESTORE_DRILL'; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; sourceBackupId: string | null; fileName: string | null; fileSize: string | null; sha256: string | null; globalsFileName: string | null; globalsFileSize: string | null; globalsSha256: string | null; startedAt: string; finishedAt: string | null; durationMs: number | null; verified: boolean; message: string | null; triggeredBy: { name: string; email: string } };
type Overview = {
  appVersion: string; nodeVersion: string; uptimeSeconds: number;
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
  database: { status: 'ok' | 'failed' };
  backup: { configured: boolean; restoreDrillConfigured: boolean; retentionDays: number; disk: { freeBytes: string; totalBytes: string } | null }; backupEncryptionConfigured: boolean; globalsBackupConfigured: boolean;
  backgroundJobs: { counts: Record<string, number>; recent: Array<{ id: string; type: string; status: string; attempts: number; maxAttempts: number; createdAt: string; finishedAt: string | null; lastError: string | null }> };
  integrations: { active: number }; integrationVaultConfigured: boolean; postgresClientTools: { pgDump: boolean; pgDumpAll: boolean; pgRestore: boolean; psql: boolean };
  backupRuns: BackupRun[];
};

function formatBytes(value: string | number | null | undefined) {
  if (value == null) return '—';
  let number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  while (number >= 1024 && index < units.length - 1) { number /= 1024; index += 1; }
  return `${number.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
function dateTime(value: string | null | undefined) { return value ? new Date(value).toLocaleString('zh-CN') : '—'; }
function duration(value: number | null) { if (value == null) return '—'; return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} 秒`; }

export default function SystemOperationsPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const overviewQuery = useQuery({ queryKey: ['system-ops-overview'], queryFn: () => api.get<Overview>('/system-management/overview'), refetchInterval: 60_000 });
  const backupsQuery = useQuery({ queryKey: ['system-backups'], queryFn: () => api.get<BackupRun[]>('/system-management/backups') });
  const overview = overviewQuery.data;
  const backups = backupsQuery.data ?? [];
  const reload = async () => { await Promise.all([overviewQuery.refetch(), backupsQuery.refetch()]); };
  const backupMutation = useMutation({ mutationFn: () => api.post<BackupRun>('/system-management/backups', {}), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['system-ops-overview'] }); await queryClient.invalidateQueries({ queryKey: ['system-backups'] }); }, onError: () => undefined });
  const restoreMutation = useMutation({ mutationFn: (id: string) => api.post<BackupRun>(`/system-management/backups/${id}/restore-drill`, {}), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['system-ops-overview'] }); await queryClient.invalidateQueries({ queryKey: ['system-backups'] }); }, onError: () => undefined });
  const downloadMutation = useMutation({ mutationFn: async (run: BackupRun) => ({ run, blob: await api.download(`/system-management/backups/${run.id}/download`) }), onSuccess: ({ run, blob }) => { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = run.fileName ?? 'moheng-backup.dump.enc'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } });
  const downloadGlobalsMutation = useMutation({ mutationFn: async (run: BackupRun) => ({ run, blob: await api.download(`/system-management/backups/${run.id}/globals-download`) }), onSuccess: ({ run, blob }) => { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = run.globalsFileName ?? 'moheng-globals.sql.enc'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } });

  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  if (overviewQuery.isLoading || backupsQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在检查服务、数据库、任务与备份状态…" /></div>;
  if (overviewQuery.error) return <div className="page-wrap"><ErrorBlock message={(overviewQuery.error as Error).message} retry={() => { void reload(); }} /></div>;
  if (!overview) return <div className="page-wrap"><ErrorBlock message="系统状态暂时不可用" retry={() => { void reload(); }} /></div>;

  const totalJobs = Object.values(overview.backgroundJobs.counts).reduce((sum, value) => sum + value, 0);
  return <div className="page-wrap system-expansion-page system-ops-page">
    <PageHeader eyebrow="SYSTEM MANAGEMENT / OPERATIONS" title="运行维护与备份恢复" subtitle="服务状态、后台任务、存储容量及 PostgreSQL 备份/隔离恢复演练。执行备份不等于恢复已验证；只有通过恢复演练的记录才标记为已验证。" actions={<Button size="header" variant="ghost" onClick={() => { void reload(); }}><RefreshCw size={14} />刷新状态</Button>} />
    {(backupMutation.error || restoreMutation.error || downloadMutation.error || downloadGlobalsMutation.error || backupsQuery.error) && <div className="system-expansion-notice is-error" role="alert"><ShieldAlert size={16} /><span>{((backupMutation.error ?? restoreMutation.error ?? downloadMutation.error ?? downloadGlobalsMutation.error ?? backupsQuery.error) as Error).message}</span></div>}
    {(backupMutation.data || restoreMutation.data) && <div className="system-expansion-notice" role="status"><CheckCircle2 size={16} /><span>{restoreMutation.data ? '恢复演练成功；数据库核心表校验已通过。' : '备份文件生成成功；恢复可用性仍待隔离恢复演练。'}</span></div>}

    <section className="system-ops-summary" aria-label="运行状态">
      <article className="system-ops-summary-cell">
        <span className="system-overview-icon"><ServerCog size={18} /></span>
        <div className="system-ops-summary-copy"><div className="system-ops-summary-label"><small>应用版本</small></div><strong className="ops-version">{overview.appVersion}</strong><span>Node {overview.nodeVersion} · 运行 {Math.floor(overview.uptimeSeconds / 3600)} 小时</span></div>
      </article>
      <article className="system-ops-summary-cell">
        <span className="system-overview-icon"><Database size={18} /></span>
        <div className="system-ops-summary-copy"><div className="system-ops-summary-label"><small>数据库连通</small><StatusBadge status={overview.database.status === 'ok' ? 'ACTIVE' : 'FAILED'} /></div><strong>{overview.database.status === 'ok' ? '正常' : '异常'}</strong><span>API readiness 实时探测</span></div>
      </article>
      <article className="system-ops-summary-cell">
        <span className="system-overview-icon"><Activity size={18} /></span>
        <div className="system-ops-summary-copy"><div className="system-ops-summary-label"><small>后台任务</small></div><strong>{totalJobs}</strong><span>队列、执行中、完成与失败</span></div>
      </article>
      <article className="system-ops-summary-cell">
        <span className="system-overview-icon"><HardDrive size={18} /></span>
        <div className="system-ops-summary-copy"><div className="system-ops-summary-label"><small>磁盘可用 / 总量</small></div><strong>{overview.backup.disk ? formatBytes(overview.backup.disk.freeBytes) : '未检测'}</strong><span>{overview.backup.disk ? `总量 ${formatBytes(overview.backup.disk.totalBytes)}` : '备份目录或磁盘状态不可用'}</span></div>
      </article>
    </section>

    <section className="panel system-expansion-section system-ops-backup">
      <div className="panel-heading"><div><h3><Archive size={17} />数据库备份与恢复演练</h3><p>通过 pg_dump 生成业务数据库备份，并用 pg_dumpall 归档 PostgreSQL 全局角色与配置；两份归档均使用 AES-256-GCM 加密并校验 SHA-256。演练恢复到独立数据库后校验核心表并删除临时库。</p></div><span className="system-overview-readiness-tag">保留 {overview.backup.retentionDays} 天</span></div>
      <div className="system-ops-settings">
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">加密业务数据库 + 全局角色归档</div><div className="settings-row-hint">{overview.backup.configured && overview.backupEncryptionConfigured && overview.globalsBackupConfigured ? 'BACKUP_DIR、全局归档连接、密钥环与活动密钥 ID 均已配置。' : '需配置 BACKUP_DIR、BACKUP_GLOBALS_DATABASE_URL、密钥环与活动密钥 ID。'}</div></div>
          <div className="settings-row-control"><StatusBadge status={overview.backup.configured && overview.backupEncryptionConfigured && overview.globalsBackupConfigured ? 'ACTIVE' : 'PENDING'} /></div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">隔离恢复目标</div><div className="settings-row-hint">{overview.backup.restoreDrillConfigured ? '已配置目标，执行前仍会校验数据库名和解析地址。' : '需配置 RESTORE_TEST_DATABASE_URL。'}</div></div>
          <div className="settings-row-control"><StatusBadge status={overview.backup.restoreDrillConfigured ? 'ACTIVE' : 'PENDING'} /></div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">执行数据库备份</div><div className="settings-row-hint">通过 pg_dump / pg_dumpall 生成加密归档；执行备份不等于恢复已验证。</div></div>
          <div className="settings-row-control"><button type="button" className="button-primary" disabled={!overview.backup.configured || backupMutation.isPending} onClick={() => { confirmThen('将运行 pg_dump 并写入服务端配置的备份目录，继续吗？', () => backupMutation.mutate(), { title: '立即执行数据库备份', confirmText: '开始备份' }); }}><Archive size={15} />{backupMutation.isPending ? '备份执行中…' : '立即执行备份'}</button></div>
        </div>
      </div>
      <div className="inline-notice system-ops-guidance"><ShieldAlert size={16} /><span>服务端仅提供加密归档下载；下载前重新核对文件大小与 SHA-256。全局角色 SQL 不会在演练时自动应用，避免覆盖测试/生产集群权限；需经过运维审核后按组织的数据库恢复流程执行。旧版无加密/无全局归档的备份不能通过新版完整恢复演练，应创建新版本完整备份。</span></div>
      <div className="system-ops-run-section">
        <div className="system-ops-run-heading"><div><h4>备份与恢复记录</h4><p>每次备份、下载和隔离恢复演练都保留操作结果。</p></div><span>{backups.length} 条记录</span></div>
        {backups.length ? <div className="system-ops-run-list">{backups.map((run) => <article className="system-ops-run" key={run.id}>
          <div className="system-ops-run-body">
            <div className="system-ops-run-head"><strong>{run.type === 'BACKUP' ? '数据库备份' : '隔离恢复演练'}</strong><StatusBadge status={run.status} />{run.verified ? <span className="system-ops-verified"><CheckCircle2 size={12} />恢复已验证</span> : run.type === 'BACKUP' && run.status === 'SUCCEEDED' ? <span className="system-ops-pending">等待恢复演练</span> : null}</div>
            <div className="system-ops-run-meta"><span>{dateTime(run.startedAt)}</span><span>{run.triggeredBy?.name ?? '未知账号'}</span><span>{duration(run.durationMs)}</span></div>
            {run.fileName && <div className="system-ops-run-file">
              <div><span>数据库归档</span><strong>{run.fileName}</strong><small>{formatBytes(run.fileSize)} · SHA-256 {run.sha256?.slice(0, 16) ?? '—'}…</small></div>
              {run.globalsFileName && <div><span>全局归档</span><strong>{run.globalsFileName}</strong><small>{formatBytes(run.globalsFileSize)} · SHA-256 {run.globalsSha256?.slice(0, 16) ?? '—'}…</small></div>}
            </div>}
            {!run.fileName && run.message && <p className="system-ops-run-message">{run.message}</p>}
          </div>
          {run.type === 'BACKUP' && run.status === 'SUCCEEDED' && <div className="system-ops-run-actions">
            <button type="button" className="button-quiet" disabled={downloadMutation.isPending} onClick={() => downloadMutation.mutate(run)}><Download size={14} />数据库归档</button>
            {run.globalsFileName && <button type="button" className="button-quiet" disabled={downloadGlobalsMutation.isPending} onClick={() => downloadGlobalsMutation.mutate(run)}><Download size={14} />全局归档</button>}
            <button type="button" className="button-secondary" disabled={!overview.backup.restoreDrillConfigured || restoreMutation.isPending || !run.globalsFileName} onClick={() => { confirmThen(`将加密备份恢复到独立的测试数据库。目标必须是与生产不同集群且可删除的 restore_test 数据库。继续对 ${run.fileName} 执行演练吗？`, () => restoreMutation.mutate(run.id), { title: '执行恢复演练', tone: 'danger', confirmText: '开始演练' }); }}>恢复演练</button>
          </div>}
        </article>)}</div> : <div className="system-ops-empty"><span className="system-ops-empty-icon"><Archive size={18} /></span><div><strong>暂无备份或恢复演练记录</strong><span>配置完成后执行首次备份，记录会按时间显示在这里。</span></div></div>}
      </div>
      <div className="data-note"><span className="note-mark">i</span><span>目标数据库需提前创建并允许应用数据库账号写入。程序会拒绝与生产数据库解析到相同地址的目标；执行前仍需由运维人员确认测试目标可被覆盖。此工作台不自动清理审计记录，不把应用运行环境变量完整展示给管理员。</span></div>
    </section>

    <section className="system-ops-lower-grid">
      <section className="panel system-expansion-section"><div className="panel-heading"><div><h3><Activity size={17} />后台任务健康</h3><p>当前实例可见的任务状态分布。</p></div></div><div className="system-job-counts">{Object.entries(overview.backgroundJobs.counts).map(([status, count]) => <div key={status}><span>{status}</span><strong>{count}</strong></div>)}</div><div className="system-job-list">{overview.backgroundJobs.recent.map((job) => <article key={job.id}><div><strong>{job.type}</strong><small>{dateTime(job.createdAt)} · 尝试 {job.attempts}/{job.maxAttempts}</small>{job.lastError && <small className="quality-error">失败详情已隐藏，请查受控服务日志。</small>}</div><StatusBadge status={job.status} /></article>)}{!overview.backgroundJobs.recent.length && <p className="system-quality-empty">当前没有后台任务记录。</p>}</div></section>
      <section className="panel system-expansion-section"><div className="panel-heading"><div><h3><ShieldAlert size={17} />部署与安全检查</h3><p>只显示运行时检查结果，不回显敏感配置值。</p></div></div><div className="system-readiness-line"><span>数据库连接</span><StatusBadge status={overview.database.status === 'ok' ? 'ACTIVE' : 'FAILED'} /></div><div className="system-readiness-line"><span>备份目录 / 连接配置</span><StatusBadge status={overview.backup.configured ? 'ACTIVE' : 'PENDING'} /></div><div className="system-readiness-line"><span>恢复演练目标</span><StatusBadge status={overview.backup.restoreDrillConfigured ? 'ACTIVE' : 'PENDING'} /></div><div className="system-readiness-line"><span>pg_dump / pg_dumpall / pg_restore / psql</span><StatusBadge status={overview.postgresClientTools.pgDump && overview.postgresClientTools.pgDumpAll && overview.postgresClientTools.pgRestore && overview.postgresClientTools.psql ? 'ACTIVE' : 'FAILED'} /><small>{overview.postgresClientTools.pgDump ? 'pg_dump 可用' : 'pg_dump 不可用'} · {overview.postgresClientTools.pgDumpAll ? 'pg_dumpall 可用' : 'pg_dumpall 不可用'} · {overview.postgresClientTools.pgRestore ? 'pg_restore 可用' : 'pg_restore 不可用'} · {overview.postgresClientTools.psql ? 'psql 可用' : 'psql 不可用'}</small></div><div className="system-readiness-line"><span>集成主加密密钥</span><StatusBadge status={overview.integrationVaultConfigured ? 'ACTIVE' : 'PENDING'} /></div><div className="system-readiness-line"><span>备份加密密钥环 / 全局归档连接</span><StatusBadge status={overview.backupEncryptionConfigured && overview.globalsBackupConfigured ? 'ACTIVE' : 'PENDING'} /></div><div className="system-readiness-line"><span>集成凭据总量（启用）</span><strong>{overview.integrations.active}</strong></div><p className="system-readiness-note">此页面不代表公网 TLS、反向代理、数据库备份异地副本、主机补丁或外部接口连通已完成验收；这些仍需部署环境级验证。</p></section>
    </section>
  </div>;
}
