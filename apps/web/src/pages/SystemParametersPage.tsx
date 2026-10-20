import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, History, Plus, RefreshCw, RotateCcw, Send, SlidersHorizontal } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../auth-store';
import type { Project } from '../types';
import { ErrorBlock, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';
import SystemTabs from '../components/SystemTabs';
import { suggestCodeFromName } from '../utils/code-suggestion';
import SelectField from '../components/SelectField';

type ValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';
type Scope = 'GLOBAL' | 'PROJECT';
type Visibility = 'ADMIN_ONLY' | 'BUSINESS_READABLE';
type ParameterRevision = { id: string; key: string; name: string; description: string | null; value: unknown; valueType: ValueType; visibility: Visibility; scope: Scope; scopeKey: string; projectId: string | null; version: number; status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'; changeNote: string | null; createdAt: string; publishedAt: string | null; createdBy: { id: string; name: string; email: string }; publishedBy: { id: string; name: string; email: string } | null; project: { id: string; code: string; name: string } | null };
type EffectiveParameters = { projectId: string | null; items: Array<Omit<ParameterRevision, 'createdBy' | 'publishedBy'> & { sourceScope: Scope }> };
const valueTypeNames: Record<ValueType, string> = { STRING: '字符串', NUMBER: '数值', BOOLEAN: '布尔值', JSON: 'JSON' };
function formatValue(value: unknown) { const text = typeof value === 'string' ? value : JSON.stringify(value); return (text ?? 'null').length > 180 ? `${(text ?? '').slice(0, 180)}…` : (text ?? 'null'); }
function parseValue(valueType: ValueType, raw: string): unknown {
  if (valueType === 'STRING') return raw;
  if (valueType === 'NUMBER') { const value = Number(raw); if (!raw.trim() || !Number.isFinite(value)) throw new Error('数值参数必须填写有限数字'); return value; }
  if (valueType === 'BOOLEAN') { if (raw !== 'true' && raw !== 'false') throw new Error('布尔参数请选择 true 或 false'); return raw === 'true'; }
  try { return JSON.parse(raw) as unknown; } catch { throw new Error('JSON 参数格式不正确，请检查逗号、引号和括号'); }
}

export default function SystemParametersPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'create' | 'effective' | 'history'>('create');
  const [scope, setScope] = useState<Scope>('GLOBAL');
  const [projectId, setProjectId] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [valueType, setValueType] = useState<ValueType>('NUMBER');
  const [visibility, setVisibility] = useState<Visibility>('ADMIN_ONLY');
  const [rawValue, setRawValue] = useState('0.8');
  const [changeNote, setChangeNote] = useState('初始参数配置');
  const [effectiveProjectId, setEffectiveProjectId] = useState('');
  const projectsQuery = useQuery({ queryKey: ['system-parameter-projects'], queryFn: () => api.get<Project[]>('/projects') });
  const revisionsQuery = useQuery({ queryKey: ['system-parameter-revisions'], queryFn: () => api.get<{ items: ParameterRevision[]; truncated: boolean }>('/system-management/parameters/revisions') });
  const effectiveQuery = useQuery({ queryKey: ['system-parameters-effective', effectiveProjectId], queryFn: () => api.get<EffectiveParameters>(`/system-management/parameters/effective${effectiveProjectId ? `?projectId=${encodeURIComponent(effectiveProjectId)}` : ''}`) });
  const revisions = revisionsQuery.data?.items ?? [];
  const effective = effectiveQuery.data?.items ?? [];
  const projects = projectsQuery.data ?? [];
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['system-parameter-revisions'] }), queryClient.invalidateQueries({ queryKey: ['system-parameters-effective'] })]); };
  const createDraft = useMutation({ mutationFn: () => api.post<ParameterRevision>('/system-management/parameters/drafts', { key, name, description: description || null, valueType, visibility, value: parseValue(valueType, rawValue), scope, projectId: scope === 'PROJECT' ? projectId : null, changeNote }), onSuccess: async () => { setNotice('参数草稿已创建。草稿不会影响有效配置，发布后才生效。'); setKey(''); setKeyTouched(false); setName(''); setDescription(''); setRawValue(valueType === 'BOOLEAN' ? 'true' : valueType === 'JSON' ? '{\n  "enabled": true\n}' : valueType === 'NUMBER' ? '0.8' : ''); setChangeNote(''); await refresh(); }, onError: (error) => setNotice((error as Error).message) });
  const publishDraft = useMutation({ mutationFn: (id: string) => api.post<ParameterRevision>(`/system-management/parameters/${id}/publish`, {}), onSuccess: async () => { setNotice('参数已发布；上一生效版本已归档，完整历史仍保留。'); await refresh(); }, onError: (error) => setNotice((error as Error).message) });
  const rollback = useMutation({ mutationFn: (id: string) => api.post<ParameterRevision>(`/system-management/parameters/${id}/rollback`, { changeNote: `由系统参数工作台创建回滚草稿` }), onSuccess: async (row) => { setNotice(`已基于历史版本创建 v${row.version} 草稿；请检查后显式发布。`); await refresh(); }, onError: (error) => setNotice((error as Error).message) });
  const histories = useMemo(() => [...revisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [revisions]);
  let valuePreview = '';
  let valueError = '';
  try { valuePreview = JSON.stringify(parseValue(valueType, rawValue)); } catch (error) { valueError = (error as Error).message; }

  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  if (projectsQuery.isLoading || revisionsQuery.isLoading || effectiveQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在读取统一参数与版本历史…" /></div>;
  const failedQuery = [projectsQuery, revisionsQuery, effectiveQuery].find((query) => query.error);
  if (failedQuery?.error) return <div className="page-wrap"><ErrorBlock message={(failedQuery.error as Error).message} retry={() => { void projectsQuery.refetch(); void revisionsQuery.refetch(); void effectiveQuery.refetch(); }} /></div>;

  return <div className="page-wrap system-expansion-page system-config-page">
    <PageHeader eyebrow="SYSTEM MANAGEMENT / PARAMETERS" title="统一参数配置" subtitle="配置采用版本化草稿与显式发布；支持全局默认值、项目级覆盖和历史版本回滚。敏感密钥必须存入环境变量或集成凭据保险库，不作为普通参数保存。" actions={<button type="button" className="panel-header-action" onClick={() => { void refresh(); }}><RefreshCw size={14} />刷新</button>} />
    {notice && <div className="system-expansion-notice" role="status"><CheckCircle2 size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}

    <SystemTabs ariaLabel="参数配置分区" value={tab} onChange={(id) => setTab(id as 'create' | 'effective' | 'history')} items={[{ id: 'create', label: '新建版本' }, { id: 'effective', label: '当前有效' }, { id: 'history', label: '版本历史' }]} />

    <section className="panel system-expansion-section" hidden={tab !== 'create'}>
      <div className="panel-heading"><div><h3><Plus size={17} />新建参数版本</h3><p>同一个参数键可以保留多次修改记录；每次提交都会产生新版本，而不是覆盖历史值。</p></div><span className="system-overview-readiness-tag">{revisions.length} 个版本{revisionsQuery.data?.truncated ? ' · 展示最近 250 条' : ''}</span></div>
      <form className="system-expansion-form system-parameter-form" onSubmit={(event) => { event.preventDefault(); try { parseValue(valueType, rawValue); createDraft.mutate(); } catch (error) { setNotice((error as Error).message); } }}>
        <label><span>显示名称</span><input value={name} onChange={(event) => { const next = event.target.value; setName(next); if (!keyTouched) setKey(suggestCodeFromName(next, 100)); }} maxLength={120} required placeholder="如 成本预警比例" /></label>
        <label><span>参数键（自动推荐）</span><input value={key} onChange={(event) => { setKey(event.target.value.toUpperCase()); setKeyTouched(true); }} maxLength={100} pattern="[A-Z][A-Z0-9_.-]{1,99}" required placeholder="根据显示名称自动推荐" /></label>
        <label><span>值类型</span><SelectField value={valueType} onChange={(event) => { const next = event.currentTarget.value as ValueType; setValueType(next); setRawValue(next === 'BOOLEAN' ? 'true' : next === 'JSON' ? '{\n  "enabled": true\n}' : next === 'NUMBER' ? '0.8' : ''); }} aria-label="参数值类型"><option value="STRING">字符串</option><option value="NUMBER">数值</option><option value="BOOLEAN">布尔值</option><option value="JSON">JSON</option></SelectField></label>
        <label><span>业务模块读取</span><SelectField value={visibility} onChange={(event) => setVisibility(event.currentTarget.value as Visibility)} aria-label="参数读取范围"><option value="ADMIN_ONLY">仅系统管理员可读</option><option value="BUSINESS_READABLE">已登录业务模块可读</option></SelectField></label>
        <label><span>适用范围</span><SelectField value={scope} onChange={(event) => setScope(event.currentTarget.value as Scope)} aria-label="参数适用范围"><option value="GLOBAL">全局默认</option><option value="PROJECT">项目级覆盖</option></SelectField></label>
        {scope === 'PROJECT' && <label><span>所属项目</span><SelectField value={projectId} onChange={(event) => setProjectId(event.currentTarget.value)} aria-label="所属项目"><option value="">请选择项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.code} · {project.name}</option>)}</SelectField></label>}
        <label className="system-parameter-description"><span>用途说明</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="参数用途及消费该参数的功能" /></label>
        {valueType === 'BOOLEAN' ? <label><span>参数值</span><SelectField value={rawValue} onChange={(event) => setRawValue(event.currentTarget.value)} aria-label="布尔参数值"><option value="true">true / 启用</option><option value="false">false / 关闭</option></SelectField></label> : valueType === 'JSON' ? <label className="system-parameter-value-json"><span>参数值（JSON）</span><textarea value={rawValue} onChange={(event) => setRawValue(event.target.value)} required rows={5} maxLength={16000} spellCheck={false} /></label> : <label><span>参数值</span><input value={rawValue} onChange={(event) => setRawValue(event.target.value)} required maxLength={valueType === 'STRING' ? 4000 : 100} inputMode={valueType === 'NUMBER' ? 'decimal' : 'text'} /></label>}
        <label className="system-parameter-note"><span>变更说明</span><input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={1000} required placeholder="说明新增/修改该参数的原因" /></label>
        <div className="system-parameter-submit"><div className={valueError ? 'system-config-validation is-error' : 'system-config-validation'}>{valueError ? <><AlertTriangle size={14} />{valueError}</> : <>解析值：<code>{valuePreview.length > 100 ? `${valuePreview.slice(0, 100)}…` : valuePreview}</code></>}</div><button type="submit" className="button-primary" disabled={createDraft.isPending || !key.trim() || !name.trim() || !changeNote.trim() || Boolean(valueError) || (scope === 'PROJECT' && !projectId)}><Plus size={14} />创建草稿</button></div>
      </form>
    </section>

    <section className="panel system-expansion-section" hidden={tab !== 'effective'}>
      <div className="panel-heading"><div><h3><SlidersHorizontal size={17} />当前有效参数</h3><p>项目值优先于同键的全局默认值。这里只展示已发布版本；草稿不参与计算。普通业务模块只读取被显式标记为“业务可读”的参数。</p></div><span className="system-overview-readiness-tag">{effective.length} 个有效参数</span></div>
      <div className="system-effective-scope"><label><span>查看生效范围</span><SelectField value={effectiveProjectId} onChange={(event) => setEffectiveProjectId(event.currentTarget.value)} aria-label="当前有效参数项目"><option value="">仅查看全局默认</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.code} · {project.name}</option>)}</SelectField></label><small>{effectiveProjectId ? '全局参数作为缺省值，项目同键参数覆盖全局值。' : '切换到具体项目可查看该项目覆盖后的最终取值。'}</small></div>
      <div className="table-scroll"><table className="data-table system-expansion-table"><thead><tr><th>参数键 / 名称</th><th>有效值</th><th>类型 / 读取范围</th><th>来源</th><th>版本</th><th>发布时间</th></tr></thead><tbody>{effective.map((item) => <tr key={`${item.key}-${item.scopeKey}`}><td><strong>{item.key}</strong><small>{item.name}</small></td><td><code className="system-parameter-value">{formatValue(item.value)}</code></td><td>{valueTypeNames[item.valueType]}<small>{item.visibility === 'BUSINESS_READABLE' ? '业务可读' : '仅管理员'}</small></td><td>{item.sourceScope === 'PROJECT' ? `项目覆盖${item.project ? ` · ${item.project.name}` : ''}` : '全局默认'}</td><td>v{item.version}</td><td>{item.publishedAt ? new Date(item.publishedAt).toLocaleString('zh-CN') : '—'}</td></tr>)}</tbody></table></div>
      {!effective.length && <div className="system-config-empty">暂无已发布参数。创建草稿并显式发布后，才会显示在这里。</div>}
    </section>

    <section className="panel system-expansion-section" hidden={tab !== 'history'}>
      <div className="panel-heading"><div><h3><History size={17} />参数版本历史</h3><p>发布会归档原生效版本；回滚将复制历史值生成一个新草稿，不会改写既有版本。</p></div></div>
      <div className="table-scroll"><table className="data-table system-expansion-table system-parameter-history-table"><thead><tr><th>参数</th><th>范围</th><th>业务读取</th><th>版本 / 状态</th><th>值快照</th><th>变更说明 / 操作者</th><th>操作</th></tr></thead><tbody>{histories.map((item) => <tr key={item.id}><td><strong>{item.key}</strong><small>{item.name}</small></td><td>{item.scope === 'PROJECT' ? `项目 · ${item.project?.name ?? item.projectId}` : '全局'}</td><td>{item.visibility === 'BUSINESS_READABLE' ? '业务可读' : '仅管理员'}</td><td><strong>v{item.version}</strong><small><StatusBadge status={item.status} /></small></td><td><code className="system-parameter-value">{formatValue(item.value)}</code><small>{valueTypeNames[item.valueType]}</small></td><td><span>{item.changeNote || '无说明'}</span><small>创建：{item.createdBy.name}{item.publishedBy ? ` · 发布：${item.publishedBy.name}` : ''}</small></td><td><div className="system-config-row-actions">{item.status === 'DRAFT' && <button type="button" className="button-primary" onClick={() => publishDraft.mutate(item.id)} disabled={publishDraft.isPending}><Send size={13} />发布</button>}{item.status === 'RETIRED' && <button type="button" className="button-secondary" onClick={() => rollback.mutate(item.id)} disabled={rollback.isPending}><RotateCcw size={13} />创建回滚草稿</button>}</div></td></tr>)}</tbody></table></div>
      {!histories.length && <div className="system-config-empty">尚无参数版本记录。</div>}
    </section>
    <div className="data-note"><span className="note-mark">i</span><span>版本化参数为统一配置基础设施。本阶段不会隐式替换现有合同金额生效规则、结算算法或业务状态机；业务模块必须显式读取对应参数，并增加规则级测试后才可以声明其已受参数控制。密钥、密码和 Token 不允许通过本页面保存。</span></div>
  </div>;
}
