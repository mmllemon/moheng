import SelectField from '../components/SelectField';
import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, FilePlus2, Search, Users, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Button, EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';
import type { BusinessPartyOption, BusinessPartyRole } from '../components/BusinessPartyPicker';
import { useAuthStore } from '../auth-store';

const roleLabels: Record<BusinessPartyRole, string> = {
  OWNER: '建设单位', MATERIAL_SUPPLIER: '材料供应商', LABOR_SUBCONTRACTOR: '劳务分包',
  PROFESSIONAL_SUBCONTRACTOR: '专业分包', EQUIPMENT_LESSOR: '机械租赁', SERVICE_PROVIDER: '服务商', OTHER: '其他单位',
};
const roles = Object.keys(roleLabels) as BusinessPartyRole[];
const blank = { name: '', creditCode: '', roles: ['OTHER'] as BusinessPartyRole[], legalRepresentative: '', address: '', contactName: '', phone: '', email: '', taxNo: '', invoiceTitle: '', notes: '', confirmDifferentEntity: false, identityVerified: false, identityVerificationNote: '' };

export default function BusinessPartiesPage() {
  const navigate = useNavigate(); const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user); const isAdmin = currentUser?.role === 'ADMIN';
  const [search, setSearch] = useState(''); const [roleFilter, setRoleFilter] = useState('ALL'); const [includeInactive, setIncludeInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false); const [form, setForm] = useState(blank); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const query = useQuery({ queryKey: ['business-parties', search, includeInactive], queryFn: () => api.get<BusinessPartyOption[]>(`/parties?search=${encodeURIComponent(search.trim())}&includeInactive=${includeInactive}`) });
  const rows = useMemo(() => (query.data ?? []).filter((p) => roleFilter === 'ALL' || p.roles.includes(roleFilter as BusinessPartyRole)), [query.data, roleFilter]);
  const resetForm = () => { setForm(blank); setError(''); setCreateOpen(false); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const party = await api.post<BusinessPartyOption>('/parties', { ...form, name: form.name.trim(), creditCode: form.creditCode.trim() || null, legalRepresentative: form.legalRepresentative || null, address: form.address || null, contactName: form.contactName || null, phone: form.phone || null, email: form.email || null, taxNo: form.taxNo.trim() || null, invoiceTitle: form.invoiceTitle.trim() || form.name.trim(), notes: form.notes || null });
      await queryClient.invalidateQueries({ queryKey: ['business-parties'] });
      await queryClient.invalidateQueries({ queryKey: ['business-party-lookup'] });
      resetForm(); navigate(`/parties/${party.id}`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : '创建单位档案失败，请重试'); }
    finally { setSaving(false); }
  };

  if (query.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (query.error) return <div className="page-wrap"><ErrorBlock message={(query.error as Error).message} retry={() => void query.refetch()} /></div>;
  return <div className="page-wrap business-parties-page">
    <PageHeader eyebrow="BUSINESS PARTIES / MASTER DATA" title="往来单位库" subtitle="统一维护建设单位、材料供应商、分包、租赁与服务单位；合同相对方通过统一单位 ID 关联。主体身份未核验前，跨项目汇总仅作初步查询。" actions={<Button onClick={() => { setCreateOpen(true); setError(''); }}><FilePlus2 size={15} />新建单位档案</Button>} />
    <section className="business-party-summary-strip"><div><Building2 size={18} /><span><strong>{query.data?.length ?? 0}</strong><small>搜索匹配单位</small></span></div><div><Users size={18} /><span><strong>{new Set((query.data ?? []).flatMap((p) => p.roles)).size}</strong><small>已使用角色类型</small></span></div><p>单位档案是公司级主数据；单位经营档案的项目金额只统计当前账号有权限访问的项目。</p></section>
    <section className="panel data-table-panel"><div className="panel-heading"><div><h3>往来单位台账</h3><p>统一维护建设单位、材料供应商、分包与租赁服务单位；合同相对方通过统一单位 ID 关联。</p></div><span className="table-count">{rows.length} 家单位</span></div><div className="table-toolbar"><div className="toolbar-search"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索单位全称、统一社会信用代码……" /></div><SelectField className="toolbar-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="ALL">全部单位角色</option>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</SelectField>{isAdmin && <label className="toolbar-check"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />显示停用/归档</label>}</div>
      {!rows.length ? <EmptyState title={search ? '没有匹配的单位' : '还没有单位档案'} description={search ? '尝试使用完整单位名称或统一社会信用代码搜索。' : '可以先从建设单位或分供合同录入；合同录入时系统也支持快速建档。'} action={() => setCreateOpen(true)} /> : <div className="table-scroll"><table className="data-table business-party-table"><thead><tr><th>单位名称 / 识别信息</th><th>业务角色</th><th>联系人</th><th>联系电话</th><th>开票识别</th><th>主体核验</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map((party) => <tr key={party.id}><td><Link className="business-party-name-link" to={`/parties/${party.id}`}><Building2 size={16} /><span><strong>{party.name}</strong><small>{party.creditCode || '未登记统一社会信用代码'}</small></span></Link></td><td><div className="business-party-role-list">{party.roles.map((r) => <span key={r} className="neutral-pill">{roleLabels[r]}</span>)}</div></td><td>{party.contactName || '—'}</td><td>{party.phone || '—'}</td><td>{party.taxNo || '—'}</td><td><span className={`status-badge ${party.identityVerified ? 'status-green' : 'status-amber'}`}><span className="status-dot" />{party.identityVerified ? '已核验' : '待核验'}</span></td><td><span className={`status-badge ${party.status === 'ACTIVE' ? 'status-green' : 'status-gray'}`}><span className="status-dot" />{party.status === 'ACTIVE' ? '正常' : party.status === 'INACTIVE' ? '停用' : '已归档'}</span></td><td><Link className="table-action" to={`/parties/${party.id}`}>查看经营档案 ↗</Link></td></tr>)}</tbody></table></div>}
    </section>
    {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) resetForm(); }}><div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="business-party-new-title"><div className="dialog-header"><div><span className="eyebrow">BUSINESS PARTY / CREATE</span><h2 id="business-party-new-title">新建往来单位档案</h2><p>单位可同时具有多种业务角色；同名不同主体需管理员确认并填写独立统一社会信用代码。</p></div><button className="icon-button" onClick={resetForm} aria-label="关闭" disabled={saving}><X size={16} /></button></div><form onSubmit={submit} noValidate><div className="form-grid two-cols">
      <div className="field span-2"><label>单位全称 <b>*</b></label><input required minLength={2} maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, invoiceTitle: form.invoiceTitle || e.target.value })} /></div>
      <div className="field span-2"><label>统一社会信用代码</label><input maxLength={64} value={form.creditCode} onChange={(e) => setForm({ ...form, creditCode: e.target.value, taxNo: form.taxNo || e.target.value })} placeholder="如有请填写" /></div>
      <div className="field span-2"><label>业务角色（可多选） <b>*</b></label><div className="business-party-role-checks">{roles.map((role) => <label key={role}><input type="checkbox" checked={form.roles.includes(role)} onChange={(e) => setForm({ ...form, roles: e.target.checked ? [...new Set([...form.roles, role])] : form.roles.filter((r) => r !== role) })} />{roleLabels[role]}</label>)}</div></div>
      <div className="field"><label>法定代表人</label><input value={form.legalRepresentative} onChange={(e) => setForm({ ...form, legalRepresentative: e.target.value })} /></div><div className="field"><label>联系人</label><input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
      <div className="field"><label>联系电话</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div><div className="field"><label>邮箱</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      <div className="field span-2"><label>地址</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div><div className="field"><label>纳税人识别号</label><input value={form.taxNo} onChange={(e) => setForm({ ...form, taxNo: e.target.value })} /></div><div className="field"><label>发票抬头</label><input value={form.invoiceTitle} onChange={(e) => setForm({ ...form, invoiceTitle: e.target.value })} /></div><div className="field span-2"><label>档案备注</label><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>{isAdmin && <><div className="field span-2"><label className="party-verification-check"><input type="checkbox" checked={form.confirmDifferentEntity} onChange={(e) => setForm({ ...form, confirmDifferentEntity: e.target.checked })} />确认该单位与同名档案属于不同法律主体（需填写独立统一社会信用代码）</label></div><div className="field span-2"><label className="party-verification-check"><input type="checkbox" checked={form.identityVerified} onChange={(e) => setForm({ ...form, identityVerified: e.target.checked })} />已核验该单位主体身份</label><textarea rows={2} value={form.identityVerificationNote} onChange={(e) => setForm({ ...form, identityVerificationNote: e.target.value })} placeholder="核验依据：统一社会信用代码证照、签约主体资料等" /></div></>}
    </div>{error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button type="button" variant="secondary" onClick={resetForm} disabled={saving}>取消</Button><Button type="submit" disabled={saving || form.name.trim().length < 2 || form.roles.length === 0}>{saving ? '保存中…' : '保存单位档案'}</Button></div></form></div></div>}
  </div>;
}
