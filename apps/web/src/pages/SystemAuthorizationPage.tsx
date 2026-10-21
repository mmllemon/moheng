import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, RefreshCw, ShieldCheck, ShieldAlert, Users } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../auth-store';
import { ErrorBlock, LoadingBlock, PageHeader, SettingsSection, StatusBadge } from '../components/Ui';
import SystemTabs from '../components/SystemTabs';

type ProjectRole = 'OWNER' | 'MANAGER' | 'ESTIMATOR' | 'VIEWER';
type MatrixModule = { code: string; label: string; allowed: Array<ProjectRole | 'ADMIN'>; note: string };
type AccessMatrix = {
  approvalPolicy: { source: 'BUILT_IN_DEFAULT' | 'PUBLISHED' | 'INVALID'; version: number | null; allowedProjectRoles: ProjectRole[] };
  companyRoles: Array<{ role: 'ADMIN' | 'USER'; label: string; description: string }>
  projectRoles: Array<{ role: ProjectRole; label: string; read: boolean; record: boolean; approve: boolean; manageMembers: boolean; memberAssignment: ProjectRole[] }>;
  modules: MatrixModule[];
  scopeRules: Array<{ code: string; label: string; detail: string }>;
  editable: boolean;
};
type ReviewSummary = {
  capturedAt: string; totalAccounts: number; activeAccounts: number; inactiveAccounts: number; projects: number; grants: number;
  adminsWithoutMfaOrWithReset: number; disabledAccountsWithGrants: number; projectsWithoutOwner: number | null; findings: number; truncated: boolean;
};
type ReviewFinding = { code: string; severity: 'ERROR' | 'WARNING' | 'INFO'; title: string; userId?: string; projectId?: string; detail: string };
type ReviewSnapshot = {
  version: number; capturedAt: string; truncated: boolean;
  users: Array<{ id: string; name: string; email: string; role: 'ADMIN' | 'USER'; isActive: boolean; mfaEnabled: boolean; passwordResetRequired: boolean; department: { id: string; code: string; name: string; isActive: boolean } | null }>;
  memberships: Array<{ id: string; projectId: string; userId: string; role: ProjectRole; createdAt: string; user: { id: string; name: string; email: string; role: 'ADMIN' | 'USER'; isActive: boolean }; project: { id: string; code: string; name: string; status: string; deletedAt: string | null } }>;
  findings: ReviewFinding[];
};
type Review = { id: string; status: 'PENDING' | 'REVIEWED'; summary: ReviewSummary; snapshot?: ReviewSnapshot; reviewNote: string | null; createdAt: string; reviewedAt: string | null; createdBy: { id: string; name: string; email: string }; reviewedBy: { id: string; name: string; email: string } | null };

const roleNames: Record<ProjectRole, string> = { OWNER: '项目负责人', MANAGER: '项目经理', ESTIMATOR: '预算/成本经办', VIEWER: '只读成员' };
const moduleRoleNames: Record<ProjectRole | 'ADMIN', string> = { ...roleNames, ADMIN: '系统管理员' };
const severityNames: Record<ReviewFinding['severity'], string> = { ERROR: '需优先处理', WARNING: '需复核', INFO: '提示' };
function displayDate(value?: string | null) { return value ? new Date(value).toLocaleString('zh-CN') : '—'; }

export default function SystemAuthorizationPage() {
  const user = useAuthStore((state) => state.user);
  const client = useQueryClient();
  const [tab, setTab] = useState<'matrix' | 'reviews'>('matrix');
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [reviewNote, setReviewNote] = useState('已逐项核对当前授权快照；需要调整的成员授权已转交项目管理人员按既有流程处理。');
  const matrixQuery = useQuery({ queryKey: ['system-authorization-matrix'], queryFn: () => api.get<AccessMatrix>('/system-management/authorization/matrix') });
  const reviewsQuery = useQuery({ queryKey: ['system-authorization-reviews'], queryFn: () => api.get<Review[]>('/system-management/authorization-reviews') });
  const detailQuery = useQuery({ queryKey: ['system-authorization-review', selectedReviewId], queryFn: () => api.get<Review>(`/system-management/authorization-reviews/${selectedReviewId}`), enabled: Boolean(selectedReviewId) });
  const refresh = async () => { await Promise.all([matrixQuery.refetch(), reviewsQuery.refetch(), ...(selectedReviewId ? [detailQuery.refetch()] : [])]); };
  const createReview = useMutation({ mutationFn: () => api.post<Review>('/system-management/authorization-reviews', {}), onSuccess: async (row) => { setSelectedReviewId(row.id); await client.invalidateQueries({ queryKey: ['system-authorization-reviews'] }); await client.invalidateQueries({ queryKey: ['system-authorization-review', row.id] }); }, onError: () => undefined });
  const completeReview = useMutation({ mutationFn: (input: { id: string; reviewNote: string }) => api.patch<Review>(`/system-management/authorization-reviews/${input.id}/complete`, { reviewNote: input.reviewNote }), onSuccess: async (row) => { setSelectedReviewId(row.id); await client.invalidateQueries({ queryKey: ['system-authorization-reviews'] }); await client.invalidateQueries({ queryKey: ['system-authorization-review', row.id] }); }, onError: () => undefined });
  const matrix = matrixQuery.data;
  const reviews = reviewsQuery.data ?? [];
  const detail = detailQuery.data;
  const snapshot = detail?.snapshot;
  const findings = useMemo(() => snapshot?.findings ?? [], [snapshot]);

  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  const failedQuery = [matrixQuery, reviewsQuery].find((query) => query.error);
  if (matrixQuery.isLoading || reviewsQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在读取权限基线与授权复核记录…" /></div>;
  if (failedQuery?.error) return <div className="page-wrap"><ErrorBlock message={(failedQuery.error as Error).message} retry={() => { void refresh(); }} /></div>;

  return <div className="page-wrap system-expansion-page system-authorization-page">
    <PageHeader eyebrow="SYSTEM MANAGEMENT / AUTHORIZATION" title="权限治理与授权复核" subtitle="展示现行服务端角色规则，按项目成员关系复核跨项目访问。该页面不直接授予权限；角色分配仍通过项目管理流程完成。" actions={<button type="button" className="panel-header-action" onClick={() => { void refresh(); }}><RefreshCw size={14} />刷新</button>} />
    <SystemTabs ariaLabel="授权复核分区" value={tab} onChange={(id) => setTab(id as 'matrix' | 'reviews')} items={[{ id: 'matrix', label: '权限矩阵', count: matrix?.projectRoles.length ?? 0 }, { id: 'reviews', label: '授权复核', count: reviews.length }]} />

    {(createReview.error || completeReview.error || detailQuery.error) && <div className="system-expansion-notice is-error" role="alert"><ShieldAlert size={16} /><span>{((createReview.error ?? completeReview.error ?? detailQuery.error) as Error).message}</span></div>}
    {(createReview.data || completeReview.data) && <div className="system-expansion-notice" role="status"><CheckCircle2 size={16} /><span>{completeReview.data ? '授权复核已确认，复核说明与当前快照已写入审计。' : '已生成当前授权快照；请查看发现项并完成复核。'}</span></div>}

    {matrix && <>
      <SettingsSection title="访问边界" description="公司角色、普通账号与部门岗位的边界；本页只读展示，不直接授予权限。">
        <div className="system-authorization-scope-grid">
          {matrix.scopeRules.map((item) => <article className="system-authorization-scope-card" key={item.code}><span className="system-authorization-scope-icon"><ShieldCheck size={16} /></span><div><strong>{item.label}</strong><p>{item.detail}</p></div></article>)}
        </div>
      </SettingsSection>
      <SettingsSection hidden={tab !== 'matrix'} title="现行角色权限矩阵" description="只读基线。矩阵按当前项目访问守卫和成员分配约束归纳；实际每次请求仍由具体服务端 API 判权。" actions={<span className="system-overview-readiness-tag">只读政策基线</span>}>
        <div className="system-authorization-company-roles">{matrix.companyRoles.map((role) => <article key={role.role}><strong>{role.label} <code>{role.role}</code></strong><p>{role.description}</p></article>)}</div>
        <div className="table-scroll"><table className="data-table system-expansion-table system-authorization-matrix"><thead><tr><th>项目角色</th><th>读取项目数据</th><th>录入业务数据</th><th>内部审批</th><th>管理成员</th><th>可分配的成员角色</th></tr></thead><tbody>{matrix.projectRoles.map((role) => <tr key={role.role}><td><strong>{role.label}</strong><small><code>{role.role}</code></small></td><td><StatusBadge status={role.read ? 'ACTIVE' : 'INACTIVE'} /></td><td><StatusBadge status={role.record ? 'ACTIVE' : 'INACTIVE'} /></td><td><StatusBadge status={role.approve ? 'ACTIVE' : 'INACTIVE'} /></td><td><StatusBadge status={role.manageMembers ? 'ACTIVE' : 'INACTIVE'} /></td><td>{role.memberAssignment.length ? role.memberAssignment.map((item) => roleNames[item]).join('、') : '—'}</td></tr>)}</tbody></table></div>
        <div className="settings-subhead"><div><h3>业务模块权限边界</h3><p>列出当前路由/服务端检查执行的主要边界；此表为只读说明，不支持在本页动态改权。</p></div><span className="system-overview-readiness-tag">{matrix.approvalPolicy.source === 'PUBLISHED' ? `审批规则 v${matrix.approvalPolicy.version}` : matrix.approvalPolicy.source === 'INVALID' ? '审批规则无效' : '内置默认审批规则'}</span></div>
        <div className="table-scroll"><table className="data-table system-expansion-table"><thead><tr><th>模块/动作</th><th>允许的项目角色</th><th>约束说明</th></tr></thead><tbody>{matrix.modules.map((module) => <tr key={module.code}><td><strong>{module.label}</strong><small><code>{module.code}</code></small></td><td>{module.allowed.length ? module.allowed.map((item) => moduleRoleNames[item]).join('、') : module.code === 'CHANGE_APPROVAL' && matrix.approvalPolicy.source === 'INVALID' ? '已禁用（审批规则无效）' : '—'}</td><td>{module.note}</td></tr>)}</tbody></table></div>
        <div className="inline-notice"><ShieldAlert size={16} /><span>公司 ADMIN 可跨项目读取业务数据，但不自动越过单据状态机、自审批防护、外部确认和财务过账规则。普通账号仅因项目成员关系获得项目范围；部门和岗位不是授权依据。权限矩阵当前用于可视化现行后端规则，不会自动重配各业务 API 的授权逻辑。</span></div>
      </SettingsSection>
    </>}

    <SettingsSection hidden={tab !== 'reviews'} title="授权复核记录" description="生成账号、项目与成员角色的时间点快照，列出停用账号仍有项目授权、启用普通账号未分配项目、管理员安全状态和缺少项目负责人的情况。" actions={<button type="button" className="button-secondary" onClick={() => createReview.mutate()} disabled={createReview.isPending}><ClipboardCheck size={14} />{createReview.isPending ? '生成快照中…' : '生成授权快照'}</button>}>
      <div className="system-authorization-review-history"><div className="table-scroll"><table className="data-table system-expansion-table"><thead><tr><th>生成时间</th><th>状态</th><th>账号 / 项目 / 授权</th><th>异常项</th><th>创建人 / 复核人</th><th>操作</th></tr></thead><tbody>{reviews.map((row) => <tr key={row.id} className={selectedReviewId === row.id ? 'is-selected' : ''}><td>{displayDate(row.createdAt)}</td><td><StatusBadge status={row.status === 'REVIEWED' ? 'ACTIVE' : 'PENDING'} /></td><td>{row.summary.totalAccounts} 个账号 / {row.summary.projects} 个项目 / {row.summary.grants} 项授权{row.summary.truncated && <small>快照有截断</small>}</td><td><strong>{row.summary.findings}</strong><small>管理员安全 {row.summary.adminsWithoutMfaOrWithReset} · 停用账号授权 {row.summary.disabledAccountsWithGrants}</small></td><td>{row.createdBy?.name ?? '—'}<small>{row.reviewedBy ? `复核：${row.reviewedBy.name}` : '尚未复核'}</small></td><td><button type="button" className="table-action" onClick={() => { setSelectedReviewId(row.id); setReviewNote(row.reviewNote ?? '已逐项核对当前授权快照；需要调整的成员授权已转交项目管理人员按既有流程处理。'); }}>查看快照</button></td></tr>)}{!reviews.length && <tr><td colSpan={6} className="table-empty">还没有授权复核记录。首次生成快照后即可开始审核。</td></tr>}</tbody></table></div></div>
    </SettingsSection>

    {selectedReviewId && <SettingsSection hidden={tab !== 'reviews'} className="system-authorization-detail" title={detail ? `快照详情 · ${displayDate(detail.createdAt)}` : '快照详情'} description="快照只反映生成时刻的授权状态，不会随之后的成员变更而改写。" actions={detail ? <StatusBadge status={detail.status === 'REVIEWED' ? 'ACTIVE' : 'PENDING'} /> : null}>
      {detailQuery.isLoading ? <LoadingBlock label="正在读取授权复核快照…" /> : detailQuery.error ? <ErrorBlock message={(detailQuery.error as Error).message} retry={() => { void detailQuery.refetch(); }} /> : detail ? <>
        {snapshot?.truncated && <p className="system-quality-truncated settings-inset-block">本次快照触及记录上限，标记为截断；不能将统计视为全量授权清单。</p>}
        <div className="system-quality-summary system-authorization-stats"><div><small>启用账号</small><strong>{detail.summary.activeAccounts}</strong></div><div><small>项目授权</small><strong>{detail.summary.grants}</strong></div><div><small>需复核项目</small><strong className={detail.summary.projectsWithoutOwner == null || detail.summary.projectsWithoutOwner > 0 ? 'quality-warning' : ''}>{detail.summary.projectsWithoutOwner == null ? '未完整计算' : detail.summary.projectsWithoutOwner}</strong></div><div><small>发现项</small><strong className={detail.summary.findings ? 'quality-warning' : 'quality-ok'}>{detail.summary.findings}</strong></div></div>
        <div className="settings-subhead"><div><h3>发现项</h3><p>以下为复核提示，并不代表系统已自动更改授权。</p></div></div>
        {findings.length ? <div className="table-scroll"><table className="data-table system-expansion-table"><thead><tr><th>级别</th><th>检查项</th><th>对象</th><th>详情</th></tr></thead><tbody>{findings.map((item, index) => <tr key={`${item.code}-${item.userId ?? item.projectId ?? ''}-${index}`}><td><span className={`quality-pill quality-${item.severity.toLowerCase()}`}>{severityNames[item.severity]}</span></td><td><strong>{item.title}</strong><small>{item.code}</small></td><td>{item.userId ? snapshot?.users.find((candidate) => candidate.id === item.userId)?.email ?? item.userId : item.projectId ? snapshot?.memberships.find((grant) => grant.projectId === item.projectId)?.project.code ?? item.projectId : '—'}</td><td>{item.detail}</td></tr>)}</tbody></table></div> : <div className="system-quality-empty">当前快照没有发现需要提示的授权项。</div>}
        <div className="settings-subhead"><div><h3>成员授权明细</h3><p>只展示当前快照中记录的项目成员关系。</p></div><span className="system-overview-readiness-tag">{snapshot?.memberships.length ?? 0} 项</span></div>
        <div className="table-scroll"><table className="data-table system-expansion-table"><thead><tr><th>账号</th><th>公司角色 / 账号状态</th><th>项目</th><th>项目角色</th><th>授权建立时间</th></tr></thead><tbody>{(snapshot?.memberships ?? []).slice(0, 1000).map((grant) => <tr key={grant.id}><td><strong>{grant.user.name}</strong><small>{grant.user.email}</small></td><td>{grant.user.role === 'ADMIN' ? '系统管理员' : '普通账号'}<small>{grant.user.isActive ? '账号启用' : '账号停用'}</small></td><td><strong>{grant.project.name}</strong><small>{grant.project.code}</small></td><td>{roleNames[grant.role]} <code>{grant.role}</code></td><td>{displayDate(grant.createdAt)}</td></tr>)}</tbody></table></div>
        {(snapshot?.memberships.length ?? 0) > 1000 && <p className="system-quality-truncated settings-inset-block">页面明细仅展示前 1000 项；快照记录的总授权数为 {detail.summary.grants}。</p>}
        {detail.status === 'PENDING' ? <form className="system-authorization-review-form" onSubmit={(event) => { event.preventDefault(); completeReview.mutate({ id: detail.id, reviewNote: reviewNote.trim() }); }}><label><span>复核说明</span><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} required minLength={1} maxLength={1000} rows={3} /></label><button type="submit" className="button-primary" disabled={completeReview.isPending || !reviewNote.trim()}><CheckCircle2 size={14} />{completeReview.isPending ? '提交复核中…' : '确认已复核'}</button></form> : <div className="system-authorization-reviewed-note"><CheckCircle2 size={16} /><div><strong>已完成复核 · {detail.reviewedBy?.name ?? '未知复核人'} · {displayDate(detail.reviewedAt)}</strong><p>{detail.reviewNote}</p></div></div>}
      </> : null}
    </SettingsSection>}
  </div>;
}
