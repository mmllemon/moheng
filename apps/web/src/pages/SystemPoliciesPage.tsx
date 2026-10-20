import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, GitBranch, History, LockKeyhole, Save, ShieldCheck } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../auth-store';
import { ErrorBlock, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';
import SystemTabs from '../components/SystemTabs';

type Role = 'OWNER' | 'MANAGER' | 'ESTIMATOR' | 'VIEWER';
type PermissionKey = string;
type RuleRow = { id: string; ruleKey: string; name: string; version: number; status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'; definition: unknown; changeNote: string | null; createdAt: string; publishedAt: string | null; createdBy?: { name: string }; publishedBy?: { name: string } | null };
type AccessResponse = { current: { source: string; version: number | null; policy: Record<PermissionKey, Role[]> }; baselines: Record<PermissionKey, Role[]>; labels: Record<PermissionKey, { label: string; description: string }>; items: RuleRow[] };
type WorkflowsResponse = { items: RuleRow[]; effectiveChangeWorkflow: { source: string; version: number | null; definition: WorkflowDefinition | null } };
type WorkflowTransition = { from: string; to: string; allowedProjectRoles: Role[]; selfApprovalForbidden: boolean; condition?: { field: 'submittedAmount'; op: 'LTE' | 'GT'; value: string } };
type WorkflowDefinition = { states: string[]; transitions: WorkflowTransition[] };

const roles: Role[] = ['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER'];
const roleLabels: Record<Role, string> = { OWNER: '项目负责人', MANAGER: '项目经理', ESTIMATOR: '造价/成本经办', VIEWER: '只读成员' };
const defaultWorkflow: WorkflowDefinition = {
  states: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED'],
  transitions: [
    { from: 'DRAFT', to: 'SUBMITTED', allowedProjectRoles: ['OWNER', 'MANAGER', 'ESTIMATOR'], selfApprovalForbidden: false },
    { from: 'SUBMITTED', to: 'UNDER_REVIEW', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: false },
    { from: 'SUBMITTED', to: 'REJECTED', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: false },
    { from: 'UNDER_REVIEW', to: 'CONFIRMED', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: true },
    { from: 'UNDER_REVIEW', to: 'REJECTED', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: false },
    { from: 'REJECTED', to: 'DRAFT', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: false },
  ],
};

export default function SystemPoliciesPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [policyDraft, setPolicyDraft] = useState<Record<PermissionKey, Role[]> | null>(null);
  const [policyNote, setPolicyNote] = useState('调整项目权限策略');
  const [workflowJson, setWorkflowJson] = useState(JSON.stringify(defaultWorkflow, null, 2));
  const [workflowName, setWorkflowName] = useState('变更签证内部审批流程');
  const [workflowNote, setWorkflowNote] = useState('建立受控的内部审批流程版本');
  const [notice, setNotice] = useState('');
  const [workflowError, setWorkflowError] = useState('');
  const [tab, setTab] = useState<'policy' | 'workflow'>('policy');
  const accessQuery = useQuery({ queryKey: ['system-access-policy'], queryFn: () => api.get<AccessResponse>('/system-management/access-policy') });
  const workflowQuery = useQuery({ queryKey: ['system-workflows'], queryFn: () => api.get<WorkflowsResponse>('/system-management/workflows') });
  const rulesQuery = useQuery({ queryKey: ['system-governance-rules'], queryFn: () => api.get<{ items: RuleRow[] }>('/system-management/rules') });
  const currentPolicy = accessQuery.data?.current.policy;
  const items = accessQuery.data?.items ?? [];
  const workflowItems = workflowQuery.data?.items.filter((item) => item.ruleKey === 'WORKFLOW:CHANGE_INTERNAL_APPROVAL') ?? [];
  const allLoading = accessQuery.isLoading || workflowQuery.isLoading || rulesQuery.isLoading;
  const loadError = accessQuery.error ?? workflowQuery.error ?? rulesQuery.error;
  const publish = useMutation({ mutationFn: (id: string) => api.post<RuleRow>(`/system-management/rules/${id}/publish`, {}), onSuccess: async () => { setNotice('版本已发布；后端将按新版本执行受控策略'); await Promise.all([accessQuery.refetch(), workflowQuery.refetch(), rulesQuery.refetch()]); }, onError: (error) => setNotice((error as Error).message) });
  const savePolicy = useMutation({ mutationFn: () => api.post<RuleRow>('/system-management/access-policy/drafts', { permissions: policyDraft, changeNote: policyNote }), onSuccess: async () => { setNotice('权限策略草稿已保存。草稿尚未生效，发布后才会收紧对应项目操作权限。'); setPolicyDraft(null); await Promise.all([accessQuery.refetch(), rulesQuery.refetch()]); }, onError: (error) => setNotice((error as Error).message) });
  const rollbackPolicy = useMutation({ mutationFn: (sourceRevisionId: string) => api.post<RuleRow>('/system-management/access-policy/rollback', { sourceRevisionId, changeNote: '从历史权限策略复制回滚草稿' }), onSuccess: async () => { setNotice('已从历史版本创建新的回滚草稿；请审核后发布'); await accessQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });
  const saveWorkflow = useMutation({ mutationFn: (definition: WorkflowDefinition) => api.post<RuleRow>('/system-management/workflows/CHANGE_INTERNAL_APPROVAL/drafts', { name: workflowName, changeNote: workflowNote, definition }), onSuccess: async () => { setNotice('内部审批流程草稿已保存。发布后，变更签证状态流转将在服务端执行该版本。'); setWorkflowError(''); await workflowQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });
  const rollbackWorkflow = useMutation({ mutationFn: (sourceRevisionId: string) => api.post<RuleRow>('/system-management/workflows/rollback', { sourceRevisionId, changeNote: '从历史流程复制回滚草稿' }), onSuccess: async () => { setNotice('已创建新的流程回滚草稿；发布之前不会影响当前流程'); await workflowQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });

  useEffect(() => { if (currentPolicy && !policyDraft) setPolicyDraft(structuredClone(currentPolicy)); }, [currentPolicy, policyDraft]);
  useEffect(() => { const definition = workflowQuery.data?.effectiveChangeWorkflow.definition; if (definition && workflowJson === JSON.stringify(defaultWorkflow, null, 2)) setWorkflowJson(JSON.stringify(definition, null, 2)); }, [workflowQuery.data?.effectiveChangeWorkflow.definition, workflowJson]);
  const policyHasChanges = useMemo(() => Boolean(policyDraft && currentPolicy && JSON.stringify(policyDraft) !== JSON.stringify(currentPolicy)), [policyDraft, currentPolicy]);

  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  if (allLoading) return <div className="page-wrap"><LoadingBlock label="正在加载权限与流程策略…" /></div>;
  if (loadError) return <div className="page-wrap"><ErrorBlock message={loadError instanceof Error ? loadError.message : String(loadError)} retry={() => { void accessQuery.refetch(); void workflowQuery.refetch(); void rulesQuery.refetch(); }} /></div>;

  const parseWorkflow = (): WorkflowDefinition | null => {
    try {
      const value = JSON.parse(workflowJson) as WorkflowDefinition;
      if (!value || !Array.isArray(value.states) || !Array.isArray(value.transitions)) throw new Error('必须包含 states 和 transitions 数组');
      if (value.transitions.some((transition) => !transition.from || !transition.to || !Array.isArray(transition.allowedProjectRoles))) throw new Error('每条迁移必须提供 from、to 和 allowedProjectRoles');
      setWorkflowError(''); return value;
    } catch (error) { setWorkflowError((error as Error).message || 'JSON 格式错误'); return null; }
  };

  return <div className="page-wrap system-policies-page">
    <PageHeader title="权限与流程策略" subtitle="版本化管理项目权限收紧规则与变更签证内部审批流程。草稿不生效，发布会影响服务端校验。" />
    {notice && <div className="notice-inline" role="status">{notice}</div>}
    {accessQuery.data?.current.source === 'INVALID' && <div className="system-policy-warning" role="alert"><AlertTriangle size={16} /><span>当前已发布的权限策略无法解析。服务端会拒绝普通项目成员通过受策略保护的 API；页面中的内置矩阵只是参考，不应直接假定为生效状态。请检查历史策略并从已知有效版本创建回滚草稿。</span></div>}

    <SystemTabs ariaLabel="权限与流程分区" value={tab} onChange={(id) => setTab(id as 'policy' | 'workflow')} items={[{ id: 'policy', label: '项目权限策略', count: '生效版本' }, { id: 'workflow', label: '变更审批流程', count: '运行版本' }]} />

    <section className="panel system-policy-section" hidden={tab !== 'policy'}>
      <div className="panel-heading"><div><h3><ShieldCheck size={17} />项目角色权限矩阵</h3><p>策略只允许收紧代码定义的权限上限，不允许通过配置新增角色权限；公司级 ADMIN 与项目角色继续分离。</p></div><span className="system-overview-readiness-tag">{accessQuery.data?.current.source === 'PUBLISHED' ? `生效版本 v${accessQuery.data.current.version}` : '内置默认策略'}</span></div>
      <div className="system-policy-warning"><AlertTriangle size={16} /><span>发布策略会立即收紧匹配的服务端 API。修改前先检查项目负责人、审批人和财务经办的最低必要权限；发布后如影响业务，需要从历史版本创建回滚草稿再发布。</span></div>
      <div className="table-scroll"><table className="data-table system-policy-table"><thead><tr><th>权限项</th>{roles.map((role) => <th key={role}>{roleLabels[role]}</th>)}</tr></thead><tbody>{Object.entries(accessQuery.data?.labels ?? {}).map(([key, value]) => { const allowed = policyDraft?.[key] ?? []; const baseline = accessQuery.data?.baselines[key] ?? []; return <tr key={key}><td><strong>{value.label}</strong><small>{value.description}</small><code>{key}</code></td>{roles.map((role) => { const permittedByCode = baseline.includes(role); return <td key={role} className="system-policy-check-cell"><label className={!permittedByCode ? 'is-locked' : ''}><input type="checkbox" checked={allowed.includes(role)} disabled={!permittedByCode || !policyDraft} onChange={(event) => setPolicyDraft((previous) => previous ? { ...previous, [key]: event.target.checked ? [...(previous[key] ?? []), role] : (previous[key] ?? []).filter((item) => item !== role) } : previous)} aria-label={`${value.label}：${roleLabels[role]}`} /><span>{allowed.includes(role) ? '允许' : '禁止'}</span>{!permittedByCode && <LockKeyhole size={11} aria-label="由代码安全边界锁定" />}</label></td>; })}</tr>; })}</tbody></table></div>
      <form className="system-policy-form" onSubmit={(event) => { event.preventDefault(); savePolicy.mutate(); }}><label><span>策略变更说明</span><input value={policyNote} onChange={(event) => setPolicyNote(event.target.value)} maxLength={1000} required /></label><div className="system-policy-actions"><button type="button" className="button-secondary" onClick={() => currentPolicy && setPolicyDraft(structuredClone(currentPolicy))} disabled={!policyHasChanges}>撤销本地修改</button><button type="submit" className="button-primary" disabled={!policyHasChanges || !policyNote.trim() || savePolicy.isPending}><Save size={14} />保存权限策略</button></div></form>
      <div className="system-rule-history">{items.filter((item) => item.ruleKey === 'PROJECT_ACCESS_POLICY').map((item) => <article className="system-rule-row" key={item.id}><div><strong>项目权限策略 · v{item.version}</strong><span>{item.changeNote ?? '无变更说明'}</span><small>创建：{item.createdBy?.name ?? '未知'}{item.publishedBy ? ` · 发布：${item.publishedBy.name}` : ''}</small></div><StatusBadge status={item.status} />{item.status === 'DRAFT' && <button type="button" className="button-secondary" onClick={() => publish.mutate(item.id)} disabled={publish.isPending}>发布版本</button>}{item.status !== 'DRAFT' && <button type="button" className="button-quiet" onClick={() => rollbackPolicy.mutate(item.id)} disabled={rollbackPolicy.isPending}>复制为回滚草稿</button>}</article>)}</div>
    </section>

    <section className="panel system-policy-section" hidden={tab !== 'workflow'}>
      <div className="panel-heading"><div><h3><GitBranch size={17} />变更签证内部审批流程</h3><p>当前执行引擎支持受控状态集、项目角色、金额条件及提交人自审批保护。外部业主确认和有效合同额规则独立不变。</p></div><span className="system-overview-readiness-tag">{workflowQuery.data?.effectiveChangeWorkflow.source === 'PUBLISHED' ? `运行版本 v${workflowQuery.data.effectiveChangeWorkflow.version}` : '内置默认流程'}</span></div>
      <div className="system-policy-warning"><AlertTriangle size={16} /><span>此版本已将该流程接入变更签证状态 API。状态集目前受代码约束，不支持任意新增状态或自动生成新业务路由；发布前请确保每个合法状态都有正确的迁移路径。</span></div>
      <form className="system-workflow-editor" onSubmit={(event) => { event.preventDefault(); const definition = parseWorkflow(); if (definition) saveWorkflow.mutate(definition); }}>
        <label><span>流程名称</span><input value={workflowName} onChange={(event) => setWorkflowName(event.target.value)} maxLength={120} required /></label>
        <label><span>版本说明</span><input value={workflowNote} onChange={(event) => setWorkflowNote(event.target.value)} maxLength={1000} required /></label>
        <label className="system-workflow-json-label"><span>流程定义 JSON</span><textarea value={workflowJson} onChange={(event) => setWorkflowJson(event.target.value)} spellCheck={false} rows={16} required aria-describedby="workflow-json-help" /></label>
        <p id="workflow-json-help" className="form-help">允许状态：DRAFT、SUBMITTED、UNDER_REVIEW、CONFIRMED、REJECTED。迁移字段：from、to、allowedProjectRoles、selfApprovalForbidden；金额条件可使用 submittedAmount + LTE/GT。</p>
        {workflowError && <p className="form-error" role="alert">JSON 无效：{workflowError}</p>}
        <div className="system-policy-actions"><button type="submit" className="button-primary" disabled={saveWorkflow.isPending || !workflowName.trim() || !workflowNote.trim()}><Save size={14} />验证并保存审批流程</button></div>
      </form>
      <div className="system-rule-history">{workflowItems.map((item) => <article className="system-rule-row" key={item.id}><div><strong>{item.name} · v{item.version}</strong><span>{item.changeNote ?? '无版本说明'}</span><small>创建：{item.createdBy?.name ?? '未知'}{item.publishedBy ? ` · 发布：${item.publishedBy.name}` : ''}</small></div><StatusBadge status={item.status} />{item.status === 'DRAFT' && <button type="button" className="button-secondary" onClick={() => publish.mutate(item.id)} disabled={publish.isPending}>发布流程</button>}{item.status !== 'DRAFT' && <button type="button" className="button-quiet" onClick={() => rollbackWorkflow.mutate(item.id)} disabled={rollbackWorkflow.isPending}>复制为回滚草稿</button>}</article>)}</div>
    </section>

    <section className="panel system-policy-section"><div className="panel-heading"><div><h3><History size={17} />发布审计与规则范围</h3><p>发布、回滚草稿和权限配置的版本历史由服务端保留。权限矩阵只会额外限制已有端点的授权，不替代每条 API 的原有角色与业务校验。</p></div></div><div className="data-note"><Check size={14} /><span>当前适配：项目列表与业务模块权限读取、主要写入路由的服务端权限检查，以及变更签证内部状态流转。新增业务路由必须声明权限项并补齐拒绝路径测试，否则不应自动继承“允许”。</span></div></section>
  </div>;
}
