import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { Button } from './Ui';

export type BusinessPartyRole = 'OWNER' | 'MATERIAL_SUPPLIER' | 'LABOR_SUBCONTRACTOR' | 'PROFESSIONAL_SUBCONTRACTOR' | 'EQUIPMENT_LESSOR' | 'SERVICE_PROVIDER' | 'OTHER';
export type BusinessPartyOption = {
  id: string; name: string; creditCode?: string | null; roles: BusinessPartyRole[]; status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  address?: string | null; contactName?: string | null; phone?: string | null; email?: string | null; taxNo?: string | null; invoiceTitle?: string | null;
  identityVerified?: boolean; identityVerificationNote?: string | null;
};
const roleNames: Record<BusinessPartyRole, string> = {
  OWNER: '建设单位', MATERIAL_SUPPLIER: '材料供应商', LABOR_SUBCONTRACTOR: '劳务分包',
  PROFESSIONAL_SUBCONTRACTOR: '专业分包', EQUIPMENT_LESSOR: '机械租赁', SERVICE_PROVIDER: '服务商', OTHER: '其他单位',
};

export default function BusinessPartyPicker({
  value, name, onChange, roles, label = '往来单位', required = false, autoCreateOnSubmit = false,
}: {
  value?: string | null; name: string; onChange: (id: string | null, name: string, party?: BusinessPartyOption) => void;
  roles: BusinessPartyRole[]; label?: string; required?: boolean; autoCreateOnSubmit?: boolean;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(name ?? '');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creditCode, setCreditCode] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setSearch(name ?? ''); }, [name]);
  const lookup = useQuery({
    queryKey: ['business-party-lookup', search.trim()],
    queryFn: () => api.get<BusinessPartyOption[]>(`/parties?search=${encodeURIComponent(search.trim())}`),
    enabled: open,
    staleTime: 20_000,
  });
  const rows = lookup.data ?? [];
  const selected = rows.find((p) => p.id === value);
  
  function editName(next: string) {
    setSearch(next); setOpen(true); setError('');
    onChange(null, next);
  }
  async function createParty(event: FormEvent) {
    event.preventDefault();
    if (search.trim().length < 2) { setError('单位名称至少需要 2 个字符'); return; }
    setSaving(true); setError('');
    try {
      const party = await api.post<BusinessPartyOption>('/parties', {
        name: search.trim(), creditCode: creditCode.trim() || null, roles,
        contactName: contactName.trim() || null, phone: phone.trim() || null, address: address.trim() || null,
        invoiceTitle: search.trim(), taxNo: creditCode.trim() || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['business-party-lookup'] });
      await queryClient.invalidateQueries({ queryKey: ['business-parties'] });
      onChange(party.id, party.name, party);
      setSearch(party.name); setOpen(false); setCreateOpen(false); setCreditCode(''); setContactName(''); setPhone(''); setAddress('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '创建单位档案失败，请重试');
    } finally { setSaving(false); }
  }

  return <div className={`business-party-picker ${open ? 'is-open' : ''}`}>
    <label className="business-party-picker-label">{label}{required && <b> *</b>}</label>
    <div className={`business-party-input-wrap ${open ? 'is-open' : ''}`}>
      <Search size={15} className="business-party-search-icon" />
      <input value={search} required={required} placeholder="搜索单位全称或统一社会信用代码" onFocus={() => { setOpen(true); setCreateOpen(false); }} onChange={(event) => editName(event.target.value)} onBlur={() => { /* Keep picker open for click selection; menu closes on result selection or outside dismiss. */ }} />
      {value && <button type="button" className="business-party-clear" title="清除单位关联" onClick={() => { setSearch(''); onChange(null, ''); }}><X size={14} /></button>}
      <ChevronDown size={14} className="business-party-chevron" />
    </div>
    {open && <>
      <button type="button" className="business-party-dismiss" aria-label="关闭单位选择" onClick={() => { setOpen(false); setCreateOpen(false); }} />
      <div className="business-party-results">{!createOpen && <>
        {lookup.isLoading && <div className="business-party-empty">正在搜索单位档案…</div>}
        {rows.map((party) => <button type="button" className="business-party-result" key={party.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(party.id, party.name, party); setSearch(party.name); setOpen(false); setCreateOpen(false); }}>
          <span className="business-party-result-icon"><Building2 size={16} /></span><span className="business-party-result-copy"><strong>{party.name}</strong><small>{party.creditCode || '未登记统一社会信用代码'} · {party.roles.map((role) => roleNames[role]).join('、') || '往来单位'}</small></span>{value === party.id && <Check size={15} className="business-party-selected" />}
        </button>)}
        {!lookup.isLoading && !rows.length && <div className="business-party-empty">暂未找到匹配单位。</div>}
        {!createOpen && <button type="button" className="business-party-create-trigger" onClick={() => { setCreateOpen(true); setError(''); }}><Plus size={15} />新建往来单位档案</button>}
        </>}{createOpen && createPortal(<div className="modal-backdrop party-quick-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setCreateOpen(false); }}><div className="dialog party-quick-dialog" role="dialog" aria-modal="true" aria-labelledby="party-quick-title"><div className="dialog-header"><div><h2 id="party-quick-title">快速建立单位档案</h2><p>保存后会立即回填到当前字段。</p></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => setCreateOpen(false)} disabled={saving}><X size={16} /></button></div><form className="business-party-create-form" onSubmit={createParty}>
          
          <div className="field"><label>单位全称 <b>*</b></label><input value={search} onChange={(e) => { setSearch(e.target.value); onChange(null, e.target.value); }} required minLength={2} maxLength={200} /></div>
          <div className="field"><label>统一社会信用代码</label><input value={creditCode} onChange={(e) => setCreditCode(e.target.value)} maxLength={64} placeholder="有则填写，用于去重核验" /></div>
          <div className="form-grid two-cols"><div className="field"><label>联系人</label><input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={120} /></div><div className="field"><label>联系电话</label><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={80} /></div><div className="field span-2"><label>注册地址/联系地址</label><input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} /></div></div>
          <div className="business-party-role-hints">建档角色：{roles.map((role) => roleNames[role]).join('、')}</div>
          {error && <div className="form-alert">{error}</div>}
          <div className="dialog-footer"><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>取消</Button><Button type="submit" disabled={saving}><Plus size={14} />{saving ? '保存中…' : '保存并关联'}</Button></div>
        </form></div></div>, document.body)}
      </div>
    </>}
    {selected && <div className="business-party-selected-details">
      <div className="business-party-selected-hint"><Check size={12} />已关联统一单位档案 · {selected.creditCode || '信用代码未维护'} · {selected.identityVerified ? '主体已核验' : '主体待核验'}</div>
      {(selected.contactName || selected.phone || selected.address || selected.invoiceTitle || selected.taxNo) && <div className="business-party-autofill-grid">
        {selected.contactName && <span><small>联系人</small><strong>{selected.contactName}</strong></span>}
        {selected.phone && <span><small>联系电话</small><strong>{selected.phone}</strong></span>}
        {selected.address && <span className="party-autofill-wide"><small>地址</small><strong>{selected.address}</strong></span>}
        {selected.invoiceTitle && <span><small>开票抬头</small><strong>{selected.invoiceTitle}</strong></span>}
        {selected.taxNo && <span><small>纳税人识别号</small><strong>{selected.taxNo}</strong></span>}
      </div>}
    </div>}
    {autoCreateOnSubmit && !value && name.trim().length >= 2 && <div className="business-party-free-text-hint">保存合同时，未选择既有档案的名称会尝试自动建档并关联；如存在同名单位，请明确选择档案。</div>}
  </div>;
}
