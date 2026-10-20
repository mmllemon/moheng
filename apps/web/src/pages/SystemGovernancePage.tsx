import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, ClipboardCheck, KeyRound, Plus, RefreshCw, ShieldCheck, Users, Workflow } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../auth-store';
import { ErrorBlock, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';
import SelectField from '../components/SelectField';
import SystemTabs from '../components/SystemTabs';

type Department = { id: string; code: string; name: string; parentId: string | null; parent: { id: string; code: string; name: string } | null; isActive: boolean; userCount: number; childCount: number };
type SystemUser = { id: string; name: string; email: string; role: 'ADMIN' | 'USER'; isActive: boolean; departmentId?: string | null; position?: string | null; department?: { id: string; code: string; name: string } | null };
type GovernanceRule = { id: string; ruleKey: string; name: string; version: number; status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'; definition: { allowedProjectRoles?: string[] }; changeNote: string | null; createdAt: string; publishedAt: string | null; createdBy: { name: string }; publishedBy: { name: string } | null };
type RuleResponse = { items: GovernanceRule[]; effectiveChangeApproval: { ruleKey: string; version: number | null; status: string; definition: { allowedProjectRoles: string[] }; source: string } };
type Integration = { id: string; code: string; name: string; adapterType: string; endpointUrl: string | null; description: string | null; status: 'ACTIVE' | 'INACTIVE'; hasSecret: boolean; secretVersion: number; lastRotatedAt: string | null; lastTestAt: string | null; lastTestStatus: string | null; lastTestSummary: string | null; updatedAt: string };
type IntegrationDelivery = { id: string; status: string; attempts: number; maxAttempts: number; createdAt: string; finishedAt: string | null; lastError: string | null; idempotencyKey: string };
type QualityResponse = { summary: { total: number; errors: number; warnings: number; info: number; scannedAt: string; truncated: boolean }; findings: Array<{ severity: 'ERROR' | 'WARNING' | 'INFO'; code: string; entity: string; entityId: string; projectId?: string; title: string; detail: string }> };

const roleNames: Record<string, string> = { OWNER: '项目负责人', MANAGER: '项目经理' };
const severityNames: Record<string, string> = { ERROR: '错误', WARNING: '警告', INFO: '提示' };

export default function SystemGovernancePage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'org' | 'rules' | 'integrations' | 'quality'>('org');
  const [departmentCode, setDepartmentCode] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [parentId, setParentId] = useState('');
  const [allowedRoles, setAllowedRoles] = useState<string[]>(['OWNER', 'MANAGER']);
  const [changeNote, setChangeNote] = useState('初始版本');
  const [integrationCode, setIntegrationCode] = useState('');
  const [integrationName, setIntegrationName] = useState('');
  const [adapterType, setAdapterType] = useState<'REST_API' | 'WEBHOOK' | 'ERP' | 'OTHER'>('REST_API');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [integrationDescription, setIntegrationDescription] = useState('');
  const [integrationSecret, setIntegrationSecret] = useState('');
  const [integrationPayload, setIntegrationPayload] = useState('{"event":"integration.test","source":"moheng"}');
  const [deliveriesById, setDeliveriesById] = useState<Record<string, IntegrationDelivery[]>>({});
  const [rotateSecrets, setRotateSecrets] = useState<Record<string, string>>({});
  const [quality, setQuality] = useState<QualityResponse | null>(null);

  const departmentsQuery = useQuery({ queryKey: ['system-departments'], queryFn: () => api.get<Department[]>('/system-management/departments') });
  const usersQuery = useQuery({ queryKey: ['system-org-users'], queryFn: () => api.get<SystemUser[]>('/auth/users') });
  const rulesQuery = useQuery({ queryKey: ['system-governance-rules'], queryFn: () => api.get<RuleResponse>('/system-management/rules') });
  const integrationsQuery = useQuery({ queryKey: ['system-integrations'], queryFn: () => api.get<Integration[]>('/system-management/integrations') });
  const departments = departmentsQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const rules = rulesQuery.data?.items ?? [];
  const integrations = integrationsQuery.data ?? [];
  const departmentOptions = useMemo(() => departments.filter((item) => item.isActive), [departments]);

  const refreshAll = async () => { await Promise.all([departmentsQuery.refetch(), usersQuery.refetch(), rulesQuery.refetch(), integrationsQuery.refetch()]); };
  const createDepartment = useMutation({ mutationFn: () => api.post<Department>('/system-management/departments', { code: departmentCode, name: departmentName, parentId: parentId || null }), onSuccess: async () => { setDepartmentCode(''); setDepartmentName(''); setParentId(''); setNotice('部门已创建'); await refreshAll(); }, onError: (error) => setNotice((error as Error).message) });
  const patchDepartment = useMutation({ mutationFn: (input: { id: string; name?: string; isActive?: boolean }) => api.patch<Department>(`/system-management/departments/${input.id}`, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) }), onSuccess: async () => { setNotice('部门资料已更新'); await departmentsQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });
  const saveOrganization = useMutation({ mutationFn: (input: { userId: string; departmentId: string | null; position: string | null }) => api.patch<SystemUser>(`/system-management/users/${input.userId}/organization`, { departmentId: input.departmentId, position: input.position }), onSuccess: async () => { setNotice('账号组织归属已保存'); await usersQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });
  const createRuleDraft = useMutation({ mutationFn: () => api.post<GovernanceRule>('/system-management/rules/change-approval/drafts', { changeNote, allowedProjectRoles: allowedRoles }), onSuccess: async () => { setNotice('审批规则草稿已保存；草稿不会影响现行业务，发布后才生效'); setChangeNote(''); await rulesQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });
  const publishRule = useMutation({ mutationFn: (id: string) => api.post<GovernanceRule>(`/system-management/rules/${id}/publish`, {}), onSuccess: async () => { setNotice('审批规则已发布，并记录版本与发布人'); await rulesQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });
  const createIntegration = useMutation({ mutationFn: () => api.post<Integration>('/system-management/integrations', { code: integrationCode, name: integrationName, adapterType, endpointUrl, description: integrationDescription, secret: integrationSecret }), onSuccess: async () => { setIntegrationCode(''); setIntegrationName(''); setEndpointUrl(''); setIntegrationDescription(''); setIntegrationSecret(''); setNotice('集成配置已创建；真实凭据仅加密保存，不会再次回显'); await integrationsQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });
  const patchIntegration = useMutation({ mutationFn: (input: { id: string; status: 'ACTIVE' | 'INACTIVE' }) => api.patch<Integration>(`/system-management/integrations/${input.id}`, { status: input.status }), onSuccess: async () => { setNotice('集成状态已更新'); await integrationsQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });
  const rotateIntegration = useMutation({ mutationFn: (input: { id: string; secret: string }) => api.post<Integration>(`/system-management/integrations/${input.id}/rotate-secret`, { secret: input.secret, changeNote: '由系统管理工作台轮换' }), onSuccess: async (_data, variables) => { setRotateSecrets((prev) => ({ ...prev, [variables.id]: '' })); setNotice('凭据已轮换；旧值不会回显'); await integrationsQuery.refetch(); }, onError: (error) => setNotice((error as Error).message) });
  const testIntegration = useMutation({ mutationFn: (id: string) => api.post<{ integration: Integration; httpStatus: number; durationMs: number; message: string }>(`/system-management/integrations/${id}/test-connection`, {}), onSuccess: async (data) => { setNotice(`${data.message}（HTTP ${data.httpStatus}，${data.durationMs} ms）`); await integrationsQuery.refetch(); }, onError: async (error) => { setNotice((error as Error).message); await integrationsQuery.refetch(); } });
  const dispatchIntegration = useMutation({ mutationFn: (input: { id: string; payload: Record<string, unknown> }) => api.post<{ id: string; status: string; attempts?: number; maxAttempts?: number; idempotentReplay?: boolean; message?: string }>(`/system-management/integrations/${input.id}/dispatch`, { idempotencyKey: `ui-${input.id.slice(0, 12)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, payload: input.payload }), onSuccess: (data) => { setNotice(data.message ?? `投递任务已排队：${data.status}${data.idempotentReplay ? '（幂等重放）' : ''}`); }, onError: (error) => setNotice((error as Error).message) });
  const loadDeliveries = useMutation({ mutationFn: (id: string) => api.get<IntegrationDelivery[]>(`/system-management/integrations/${id}/deliveries`), onSuccess: (data, id) => setDeliveriesById((current) => ({ ...current, [id]: data })), onError: (error) => setNotice((error as Error).message) });
  const scanQuality = useMutation({ mutationFn: () => api.post<QualityResponse>('/system-management/data-quality/scan', {}), onSuccess: (data) => { setQuality(data); setNotice(`数据质量巡检完成：${data.summary.errors} 项错误、${data.summary.warnings} 项警告、${data.summary.info} 项提示`); }, onError: (error) => setNotice((error as Error).message) });

  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  const loadError = [departmentsQuery, usersQuery, rulesQuery, integrationsQuery].find((query) => query.error);
  if (departmentsQuery.isLoading || usersQuery.isLoading || rulesQuery.isLoading || integrationsQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在加载组织、规则与集成配置…" /></div>;
  if (loadError?.error) return <div className="page-wrap"><ErrorBlock message={(loadError.error as Error).message} retry={() => { void refreshAll(); }} /></div>;

  return <div className="page-wrap system-expansion-page">
    <PageHeader eyebrow="SYSTEM MANAGEMENT / GOVERNANCE" title="组织、规则与集成治理" subtitle="管理部门归属、内部审批规则版本、外部凭据与数据质量。公司账号角色和项目角色仍分离；发布规则只控制公司内部变更审批，不改变外部确认金额生效规则。" actions={<button type="button" className="panel-header-action" onClick={() => { void refreshAll(); }}><RefreshCw size={14} />刷新</button>} />
    {notice && <div className="system-expansion-notice" role="status"><CheckCircle2 size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}

    <SystemTabs ariaLabel="组织治理分区" value={tab} onChange={(id) => setTab(id as 'org' | 'rules' | 'integrations' | 'quality')} items={[{ id: 'org', label: '组织与岗位' }, { id: 'rules', label: '审批规则' }, { id: 'integrations', label: '集成凭据' }, { id: 'quality', label: '数据质量' }]} />

    <section className="panel system-expansion-section" hidden={tab !== 'org'}>
      <div className="panel-heading"><div><h3><Building2 size={17} />组织与部门</h3><p>为公司账号增加部门/岗位归属，不替代项目成员授权。</p></div><span className="system-overview-readiness-tag">{departments.length} 个部门</span></div>
      <form className="system-expansion-form system-department-form" onSubmit={(event) => { event.preventDefault(); createDepartment.mutate(); }}>
        <label><span>部门编码</span><input value={departmentCode} onChange={(event) => setDepartmentCode(event.target.value)} maxLength={40} required placeholder="如 ENGINEERING" /></label>
        <label><span>部门名称</span><input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} maxLength={120} required placeholder="如 工程管理部" /></label>
        <label><span>上级部门</span><SelectField value={parentId} onChange={(event) => setParentId(event.currentTarget.value)} aria-label="上级部门"><option value="">无（一级部门）</option>{departmentOptions.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</SelectField></label>
        <button type="submit" className="button-primary" disabled={createDepartment.isPending}><Plus size={15} />创建部门</button>
      </form>
      <div className="table-scroll"><table className="data-table system-expansion-table"><thead><tr><th>部门</th><th>上级</th><th>账号</th><th>子部门</th><th>状态</th></tr></thead><tbody>{departments.map((item) => <DepartmentRow key={item.id} department={item} saving={patchDepartment.isPending} onPatch={(input) => patchDepartment.mutate(input)} />)}</tbody></table></div>
    </section>

    <section className="panel system-expansion-section" hidden={tab !== 'org'}>
      <div className="panel-heading"><div><h3><Users size={17} />账号部门与岗位归属</h3><p>只修改组织字段，不提升公司角色、不授予项目角色。</p></div><span className="system-overview-readiness-tag">{users.length} 个账号</span></div>
      <div className="table-scroll"><table className="data-table system-expansion-table"><thead><tr><th>账号</th><th>公司角色</th><th>部门</th><th>岗位</th><th>操作</th></tr></thead><tbody>{users.map((item) => <OrgUserRow key={item.id} user={item} departments={departmentOptions} saving={saveOrganization.isPending} onSave={(input) => saveOrganization.mutate(input)} />)}</tbody></table></div>
    </section>

    <section className="panel system-expansion-section" hidden={tab !== 'rules'}>
      <div className="panel-heading"><div><h3><Workflow size={17} />版本化审批规则</h3><p>创建草稿后显式发布；发布动作会退休旧版本、记录发布人和审计日志。</p></div><StatusBadge status={rulesQuery.data?.effectiveChangeApproval.status === 'PUBLISHED' ? 'ACTIVE' : 'DEFAULT'} /></div>
      <div className="system-effective-rule"><span>当前生效规则</span><strong>{rulesQuery.data?.effectiveChangeApproval.source === 'PUBLISHED' ? `v${rulesQuery.data.effectiveChangeApproval.version}` : '内置默认规则'}</strong><div>{(rulesQuery.data?.effectiveChangeApproval.definition.allowedProjectRoles ?? ['OWNER', 'MANAGER']).map((role) => <em key={role}>{roleNames[role] ?? role}</em>)}</div></div>
      <form className="system-expansion-form" onSubmit={(event) => { event.preventDefault(); createRuleDraft.mutate(); }}>
        <fieldset className="system-role-fieldset"><legend>允许执行内部审批的项目角色</legend>{(['OWNER', 'MANAGER'] as const).map((role) => <label key={role}><input type="checkbox" checked={allowedRoles.includes(role)} onChange={(event) => setAllowedRoles((current) => event.target.checked ? [...current, role] : current.filter((value) => value !== role))} />{roleNames[role]}</label>)}</fieldset>
        <label className="system-rule-note"><span>变更说明</span><input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={1000} required placeholder="说明本次审批角色规则调整原因" /></label>
        <button type="submit" className="button-primary" disabled={createRuleDraft.isPending || allowedRoles.length === 0}><Plus size={15} />保存规则草稿</button>
      </form>
      <div className="system-rule-history">{rules.filter((rule) => rule.ruleKey === 'CHANGE_APPROVAL').map((rule) => <article className="system-rule-row" key={rule.id}><div><strong>{rule.name} · v{rule.version}</strong><span>{(rule.definition.allowedProjectRoles ?? []).map((role) => roleNames[role] ?? role).join('、')} · {rule.changeNote ?? '无变更说明'}</span><small>创建：{rule.createdBy.name}{rule.publishedBy ? ` · 发布：${rule.publishedBy.name}` : ''}{rule.publishedAt ? ` · ${new Date(rule.publishedAt).toLocaleString('zh-CN')}` : ''}</small></div><StatusBadge status={rule.status} />{rule.status === 'DRAFT' && <button type="button" className="button-secondary" onClick={() => publishRule.mutate(rule.id)} disabled={publishRule.isPending}>发布版本</button>}</article>)}</div>
    </section>

    <section className="panel system-expansion-section" hidden={tab !== 'integrations'}>
      <div className="panel-heading"><div><h3><KeyRound size={17} />集成凭据与投递</h3><p>凭据使用 AES-256-GCM 加密保存；连接测试受 HTTPS 主机白名单约束，投递任务具备幂等键、后台重试与结果追踪。</p></div><span className="system-overview-readiness-tag">{integrations.filter((item) => item.status === 'ACTIVE').length} 个启用集成</span></div>
      <form className="system-expansion-form system-integration-form" onSubmit={(event) => { event.preventDefault(); createIntegration.mutate(); }}>
        <label><span>唯一编码</span><input value={integrationCode} onChange={(event) => setIntegrationCode(event.target.value)} required maxLength={80} placeholder="如 ERP_SYNC" /></label>
        <label><span>显示名称</span><input value={integrationName} onChange={(event) => setIntegrationName(event.target.value)} required maxLength={120} placeholder="如 ERP 同步接口" /></label>
        <label><span>适配器类型</span><SelectField value={adapterType} onChange={(event) => setAdapterType(event.currentTarget.value as typeof adapterType)} aria-label="适配器类型"><option value="REST_API">REST API</option><option value="WEBHOOK">Webhook</option><option value="ERP">ERP</option><option value="OTHER">其他</option></SelectField></label>
        <label><span>HTTPS 地址（可选）</span><input value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} type="url" placeholder="https://api.example.com" /></label>
        <label className="system-form-wide"><span>用途说明</span><input value={integrationDescription} onChange={(event) => setIntegrationDescription(event.target.value)} maxLength={1000} placeholder="说明用途、负责人或轮换联系人" /></label>
        <label className="system-form-wide"><span>凭据（仅首次输入）</span><input value={integrationSecret} onChange={(event) => setIntegrationSecret(event.target.value)} type="password" autoComplete="new-password" required maxLength={4096} placeholder="明文只在提交时发送，不会在页面回显" /></label>
        <button type="submit" className="button-primary" disabled={createIntegration.isPending}><Plus size={15} />加密保存</button>
      </form>
      <div className="system-integration-payload"><label><span>通用 JSON 投递载荷（不允许携带密码、Token 等凭据字段）</span><textarea value={integrationPayload} onChange={(event) => setIntegrationPayload(event.target.value)} rows={4} spellCheck={false} aria-label="集成测试 JSON 载荷" /></label><p>先配置 <code>INTEGRATION_ALLOWED_HOSTS</code> 精确允许的外部域名。连接测试只验证 HTTPS 与 Bearer 认证响应，不代表 ERP 业务映射正确；ERP 专用适配器仍需单独实现。</p></div>
      <div className="system-integrations-list">{integrations.map((item) => <article className="system-integration-row" key={item.id}>
        <div className="system-integration-main"><strong>{item.name}</strong><span>{item.code} · {item.adapterType} · 凭据版本 {item.secretVersion}</span><small>{item.endpointUrl || '未配置端点'} · 最近轮换：{item.lastRotatedAt ? new Date(item.lastRotatedAt).toLocaleString('zh-CN') : '未记录'}</small><div className="system-secret-status"><StatusBadge status={item.status} /><span>{item.hasSecret ? '已加密保存' : '缺少凭据'}</span>{item.lastTestAt && <span>连接：{item.lastTestStatus === 'SUCCEEDED' ? '通过' : '失败'} · {new Date(item.lastTestAt).toLocaleString('zh-CN')} · {item.lastTestSummary}</span>}</div></div>
        <div className="system-secret-controls"><input aria-label={`${item.name} 新凭据`} type="password" autoComplete="new-password" value={rotateSecrets[item.id] ?? ''} onChange={(event) => setRotateSecrets((prev) => ({ ...prev, [item.id]: event.target.value }))} placeholder="输入新凭据以轮换" /><button type="button" className="button-secondary" disabled={!rotateSecrets[item.id] || rotateIntegration.isPending} onClick={() => rotateIntegration.mutate({ id: item.id, secret: rotateSecrets[item.id] })}>轮换凭据</button><button type="button" className="button-quiet" disabled={!item.endpointUrl || !item.hasSecret || testIntegration.isPending} onClick={() => testIntegration.mutate(item.id)}>测试连接</button>{item.status === 'ACTIVE' && ['REST_API','WEBHOOK'].includes(item.adapterType) && <button type="button" className="button-secondary" disabled={!item.endpointUrl || !item.hasSecret || dispatchIntegration.isPending} onClick={() => { let parsedPayload: unknown; try { parsedPayload = JSON.parse(integrationPayload); } catch { setNotice('投递载荷不是有效 JSON'); return; } if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) { setNotice('投递载荷必须是 JSON 对象'); return; } dispatchIntegration.mutate({ id: item.id, payload: parsedPayload as Record<string, unknown> }); }}>投递事件</button>}<button type="button" className="button-quiet" onClick={() => loadDeliveries.mutate(item.id)} disabled={loadDeliveries.isPending}>投递记录</button><button type="button" className="button-quiet" onClick={() => patchIntegration.mutate({ id: item.id, status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}>{item.status === 'ACTIVE' ? '停用' : '启用'}</button></div>
        {deliveriesById[item.id] && <div className="system-integration-deliveries"><strong>最近投递记录（最多 100 条）</strong>{deliveriesById[item.id].length ? deliveriesById[item.id].map((delivery) => <div key={delivery.id}><span>{delivery.status}</span><small>{new Date(delivery.createdAt).toLocaleString('zh-CN')} · 尝试 {delivery.attempts}/{delivery.maxAttempts}{delivery.lastError ? ' · 存在失败记录' : ''}</small></div>) : <small>尚无投递记录</small>}</div>}
      </article>)}</div>
      <div className="data-note"><span className="note-mark">i</span><span>当前通用 REST_API/Webhook JSON 投递已接入后台队列，支持幂等入队与网络/429/5xx 重试。外部端点实际可用性取决于部署白名单、密钥和目标服务；ERP/对象存储业务协议与映射不包含在通用投递中。</span></div>
    </section>

    <section className="panel system-expansion-section" hidden={tab !== 'quality'}>
      <div className="panel-heading system-quality-panel-heading"><div><h3><ClipboardCheck size={17} />数据质量巡检</h3><p>只读扫描业务不变量并生成审计记录；不会自动修改财务、合同或审批数据。</p></div><button type="button" className="system-quality-scan-trigger" onClick={() => scanQuality.mutate()} disabled={scanQuality.isPending}><RefreshCw size={14} className={scanQuality.isPending ? 'is-spinning' : ''} />{scanQuality.isPending ? '巡检中…' : '运行巡检'}</button></div>
      {quality && <><div className="system-quality-summary"><div><small>发现总数</small><strong>{quality.summary.total}</strong></div><div><small>错误</small><strong className="quality-error">{quality.summary.errors}</strong></div><div><small>警告</small><strong className="quality-warning">{quality.summary.warnings}</strong></div><div><small>提示</small><strong>{quality.summary.info}</strong></div></div>
        {quality.summary.truncated && <p className="system-quality-truncated">单类结果达到 200 条上限，列表可能不完整；请结合数据库统计或后续分页扫描。</p>}
        {quality.findings.length ? <div className="table-scroll"><table className="data-table system-expansion-table"><thead><tr><th>级别</th><th>检查项</th><th>对象</th><th>说明</th></tr></thead><tbody>{quality.findings.map((item, index) => <tr key={`${item.code}-${item.entityId}-${index}`}><td><span className={`quality-pill quality-${item.severity.toLowerCase()}`}>{severityNames[item.severity]}</span></td><td><strong>{item.title}</strong><small>{item.code}</small></td><td>{item.entity} · {item.entityId}</td><td>{item.detail}</td></tr>)}</tbody></table></div> : <div className="system-quality-empty"><CheckCircle2 size={18} />当前检查项未发现问题。</div>}
      </>}
    </section>
  </div>;
}

function OrgUserRow({ user, departments, saving, onSave }: { user: SystemUser; departments: Department[]; saving: boolean; onSave: (input: { userId: string; departmentId: string | null; position: string | null }) => void }) {
  const [departmentId, setDepartmentId] = useState(user.departmentId ?? '');
  const [position, setPosition] = useState(user.position ?? '');
  useEffect(() => { setDepartmentId(user.departmentId ?? ''); setPosition(user.position ?? ''); }, [user.departmentId, user.position]);
  return <tr><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.role === 'ADMIN' ? '系统管理员' : '普通账号'}</td><td><SelectField value={departmentId} onChange={(event) => setDepartmentId(event.currentTarget.value)} aria-label={`${user.name} 部门`}><option value="">未分配</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField></td><td><input value={position} onChange={(event) => setPosition(event.target.value)} aria-label={`${user.name} 岗位`} maxLength={120} placeholder="如 项目成本员" /></td><td><button type="button" className="button-secondary" disabled={saving || (departmentId === (user.departmentId ?? '') && position === (user.position ?? ''))} onClick={() => onSave({ userId: user.id, departmentId: departmentId || null, position: position || null })}>保存归属</button></td></tr>;
}

function DepartmentRow({ department, saving, onPatch }: { department: Department; saving: boolean; onPatch: (input: { id: string; name?: string; isActive?: boolean }) => void }) {
  const [name, setName] = useState(department.name);
  useEffect(() => { setName(department.name); }, [department.name]);
  return <tr><td><strong>{department.name}</strong><small>{department.code}</small></td><td>{department.parent?.name ?? '—'}</td><td>{department.userCount}</td><td>{department.childCount}</td><td><div className="system-department-actions"><StatusBadge status={department.isActive ? 'ACTIVE' : 'INACTIVE'} /><input aria-label={`${department.name} 新名称`} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /><button type="button" className="button-secondary" disabled={saving || !name.trim() || name.trim() === department.name} onClick={() => onPatch({ id: department.id, name: name.trim() })}>改名</button><button type="button" className="button-quiet" disabled={saving} onClick={() => onPatch({ id: department.id, isActive: !department.isActive })}>{department.isActive ? '停用' : '启用'}</button></div></td></tr>;
}
