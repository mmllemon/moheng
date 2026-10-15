import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Building2, Download, FilePlus2, Filter, Link2, Plus, Receipt, Search, X } from 'lucide-react';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import { ProjectLedgerReportButton } from '../components/ReportLaunchButton';
import type { BudgetItem, CostEntry, CostType } from '../types';
import BusinessPartyPicker from '../components/BusinessPartyPicker';
import { Button, currentDateInputValue, dateInputToIso, EmptyState, ErrorBlock, formatDate, formatMoney, LoadingBlock, PageHeader } from '../components/Ui';

const costTypes: { value: CostType | 'ALL'; label: string }[] = [
  { value: 'ALL', label: '全部成本' }, { value: 'LABOR', label: '人工费' }, { value: 'MATERIAL', label: '材料费' }, { value: 'MACHINE', label: '机械费' }, { value: 'SUBCONTRACT', label: '分包费' }, { value: 'INDIRECT', label: '其他间接费' },
];
const typeLabels: Record<CostType, string> = { LABOR: '人工费', MATERIAL: '材料费', MACHINE: '机械费', SUBCONTRACT: '分包费', INDIRECT: '其他间接费' };
const typeClasses: Record<CostType, string> = { LABOR: 'cost-labor', MATERIAL: 'cost-material', MACHINE: 'cost-machine', SUBCONTRACT: 'cost-subcontract', INDIRECT: 'cost-indirect' };
const costSchema = z.object({
  type: z.enum(['LABOR', 'MATERIAL', 'MACHINE', 'SUBCONTRACT', 'INDIRECT']), date: z.string().min(1, '请选择发生日期'),
  amount: z.coerce.number().positive('金额必须大于 0'), description: z.string().trim().min(1, '请输入费用说明'),
  budgetItemId: z.string().optional(), downstreamContractId: z.string().optional(), quantity: z.union([z.literal(''), z.coerce.number().min(0)]), unit: z.string().optional(), unitPrice: z.union([z.literal(''), z.coerce.number().min(0)]),
  businessPartyId: z.string().nullable().optional(), vendorName: z.string().optional(), teamName: z.string().optional(), invoiceNo: z.string().optional(), notes: z.string().optional(),
});
type CostForm = z.infer<typeof costSchema>;
function exportCosts(rows: CostEntry[]) {
  const values = [['日期', '类型', '费用说明', '关联清单', '分供合同', '供应商/班组', '金额(元)'], ...rows.map((r) => [formatDate(r.date), typeLabels[r.type], r.description, r.budgetItem ? `${r.budgetItem.code} ${r.budgetItem.name}` : '', r.downstreamContract ? `${r.downstreamContract.contractNo} ${r.downstreamContract.name}` : '', r.vendorName || r.teamName || '', r.amount])];
  const quote = (value: unknown) => { const t = String(value ?? ''); return /[",\r\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t; };
  const blob = new Blob(['\uFEFF', values.map((r) => r.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `实际成本-${currentDateInputValue()}.csv`; link.click(); URL.revokeObjectURL(url);
}

type DownstreamContractOption = { id: string; contractNo: string; name: string; counterpartyName: string; counterpartyPartyId?: string | null; status: string };
function CostDialog({ projectId, items, contracts, onClose }: { projectId: string; items: BudgetItem[]; contracts: DownstreamContractOption[]; onClose: () => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState('');
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<CostForm>({ resolver: zodResolver(costSchema) as never, defaultValues: { type: 'MATERIAL', date: currentDateInputValue(), amount: 0, description: '', budgetItemId: '', downstreamContractId: '', businessPartyId: null, quantity: '', unit: '', unitPrice: '', vendorName: '', teamName: '', invoiceNo: '', notes: '' } });
  const type = watch('type');
  const linkedContract = contracts.find((item) => item.id === watch('downstreamContractId'));
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      await api.post(`/projects/${projectId}/costs`, { ...values, businessPartyId: values.businessPartyId || null, date: dateInputToIso(values.date), budgetItemId: values.budgetItemId || null, downstreamContractId: values.downstreamContractId || null, quantity: values.quantity === '' ? null : Number(values.quantity), unitPrice: values.unitPrice === '' ? null : Number(values.unitPrice), vendorName: values.vendorName || null, teamName: values.teamName || null, invoiceNo: values.invoiceNo || null, notes: values.notes || null });
      await queryClient.invalidateQueries({ queryKey: ['costs', projectId] }); await queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }); await queryClient.invalidateQueries({ queryKey: ['downstream-contracts', projectId] }); await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    } catch (err) { setError(err instanceof ApiError ? err.message : '保存失败'); }
  });
  const typeName = typeLabels[type];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">ACTUAL COST / ENTRY</span><h2>新增成本记录</h2><p>录入已发生的成本；录入结果用于经营分析汇总。</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
    <form onSubmit={submit} noValidate><div className="form-grid two-cols">
      <div className="field"><label>费用类型 <b>*</b></label><SelectField {...register('type')}>{costTypes.filter((item) => item.value !== 'ALL').map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</SelectField></div>
      <div className="field"><label>发生日期 <b>*</b></label><DatePicker {...register('date')} />{errors.date && <small className="field-error">{errors.date.message}</small>}</div>
      <div className="field span-2"><label>费用说明 <b>*</b></label><input {...register('description')} placeholder={type === 'MATERIAL' ? '例如：HRB400 钢筋采购' : type === 'LABOR' ? '例如：基础施工人工费' : '费用用途说明'} />{errors.description && <small className="field-error">{errors.description.message}</small>}</div>
      <div className="field"><label>金额（元）<b>*</b></label><input type="number" min="0.01" step="0.01" {...register('amount')} />{errors.amount && <small className="field-error">{errors.amount.message}</small>}</div>
      <div className="field"><label>关联目标成本清单</label><SelectField {...register('budgetItemId')}><option value="">暂不关联</option>{items.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</SelectField></div>
      <div className="field span-2"><label>关联分供合同（可选）</label><SelectField {...register('downstreamContractId')}><option value="">暂不关联合同</option>{contracts.filter((item) => item.status !== 'DRAFT').map((item) => <option key={item.id} value={item.id}>{item.contractNo} · {item.name}（{item.counterpartyName}）</option>)}</SelectField><small className="field-hint">只关联同一项目的合同。此处记录已发生成本，不会因合同付款重复生成成本。</small></div>
      {type === 'MATERIAL' && <><div className="field">{linkedContract ? <><label>供应商</label><div className="inline-notice"><Building2 size={14} />{linkedContract.counterpartyPartyId ? <a href={`/parties/${linkedContract.counterpartyPartyId}`}>{linkedContract.counterpartyName}</a> : linkedContract.counterpartyName}（来自已关联合同）</div></> : <BusinessPartyPicker value={watch('businessPartyId')} name={watch('vendorName') ?? ''} label="材料供应商" roles={['MATERIAL_SUPPLIER']} onChange={(id, name) => { setValue('businessPartyId', id, { shouldDirty: true }); setValue('vendorName', name, { shouldDirty: true }); }} />}<input type="hidden" {...register('vendorName')} /></div><div className="field"><label>发票号</label><input {...register('invoiceNo')} placeholder="可后补" /></div></>}
      {type === 'LABOR' && <div className="field"><label>班组/劳务队</label><input {...register('teamName')} placeholder="班组名称" /></div>}
      {type === 'MACHINE' && <><div className="field">{linkedContract ? <><label>设备出租方</label><div className="inline-notice">{linkedContract.counterpartyName}（来自已关联合同）</div></> : <BusinessPartyPicker value={watch('businessPartyId')} name={watch('vendorName') ?? ''} label="设备出租方" roles={['EQUIPMENT_LESSOR']} onChange={(id, name) => { setValue('businessPartyId', id, { shouldDirty: true }); setValue('vendorName', name, { shouldDirty: true }); }} />}<input type="hidden" {...register('vendorName')} /></div><div className="field"><label>发票号</label><input {...register('invoiceNo')} /></div></>}
      {type === 'SUBCONTRACT' && <div className="field">{linkedContract ? <><label>分包单位</label><div className="inline-notice">{linkedContract.counterpartyName}（来自已关联合同）</div></> : <BusinessPartyPicker value={watch('businessPartyId')} name={watch('vendorName') ?? ''} label="分包单位" roles={['LABOR_SUBCONTRACTOR', 'PROFESSIONAL_SUBCONTRACTOR']} onChange={(id, name) => { setValue('businessPartyId', id, { shouldDirty: true }); setValue('vendorName', name, { shouldDirty: true }); }} />}<input type="hidden" {...register('vendorName')} /></div>}
      {type === 'INDIRECT' && <div className="field">{linkedContract ? <><label>费用对象</label><div className="inline-notice">{linkedContract.counterpartyName}（来自已关联合同）</div></> : <BusinessPartyPicker value={watch('businessPartyId')} name={watch('vendorName') ?? ''} label="供应商 / 费用对象" roles={['SERVICE_PROVIDER', 'OTHER']} onChange={(id, name) => { setValue('businessPartyId', id, { shouldDirty: true }); setValue('vendorName', name, { shouldDirty: true }); }} />}<input type="hidden" {...register('vendorName')} /></div>}
      <div className="field"><label>数量（可选）</label><input type="number" min="0" step="0.001" {...register('quantity')} /></div><div className="field"><label>计量单位</label><input {...register('unit')} placeholder="t、工日、台班" /></div>
      <div className="field"><label>参考单价（元）</label><input type="number" min="0" step="0.0001" {...register('unitPrice')} /></div>
      <div className="field span-2"><label>备注</label><textarea rows={2} {...register('notes')} placeholder="发票、签认、计量等补充说明" /></div>
    </div>{error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? '提交中…' : `保存${typeName}记录`}</Button></div></form>
  </div></div>;
}

function CostContractLinkDialog({ projectId, entry, contracts, onClose, onNotice }: { projectId: string; entry: CostEntry; contracts: DownstreamContractOption[]; onClose: () => void; onNotice: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [contractId, setContractId] = useState(entry.downstreamContract?.id ?? entry.downstreamContractId ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true); setError('');
    try {
      await api.patch(`/projects/${projectId}/costs/${entry.id}/link-contract`, { downstreamContractId: contractId || null });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['costs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['downstream-contracts', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      onNotice(contractId ? '成本记录已关联到所选下游合同；成本金额未变，合同付款也不会重复记入实际成本。' : '已解除成本记录与下游合同的关联；成本金额和实际成本总额未变。');
      onClose();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : '合同关联更新失败'); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">COST / CONTRACT LINK</span><h2>关联合同</h2><p>{entry.description} · {formatMoney(entry.amount)}</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
    <div className="inline-notice"><Link2 size={16} /><span>此操作只维护成本来源与分供合同的关联，不修改成本金额、不生成付款记录，也不改变成本累计值。请依据合同、验收、发票或结算凭据人工核对后关联。</span></div>
    <div className="field"><label>下游合同</label><SelectField value={contractId} onChange={(event) => setContractId(event.target.value)}><option value="">不关联合同</option>{contracts.filter((item) => item.status !== 'DRAFT').map((item) => <option key={item.id} value={item.id}>{item.contractNo} · {item.name}（{item.counterpartyName}）{item.status === 'TERMINATED' ? ' · 已终止（历史关联）' : ''}</option>)}</SelectField></div>
    {error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button disabled={saving} onClick={() => void submit()}><Link2 size={15} />{saving ? '保存中…' : '保存关联'}</Button></div>
  </div></div>;
}

export default function CostsPage() {
  const projectId = useUiStore((state) => state.selectedProjectId)!; const queryClient = useQueryClient();
  const [type, setType] = useState<CostType | 'ALL'>('ALL'); const [q, setQ] = useState(''); const [dialogOpen, setDialogOpen] = useState(false); const [linkingEntry, setLinkingEntry] = useState<CostEntry | null>(null); const [notice, setNotice] = useState(''); const [serverError, setServerError] = useState('');
  const costsQuery = useQuery({ queryKey: ['costs', projectId], queryFn: () => api.get<CostEntry[]>(`/projects/${projectId}/costs`) });
  const budgetQuery = useQuery({ queryKey: ['budget', projectId], queryFn: () => api.get<BudgetItem[]>(`/projects/${projectId}/budget`) });
  const downstreamQuery = useQuery({ queryKey: ['downstream-contracts', projectId], queryFn: () => api.get<{ items: DownstreamContractOption[] }>(`/projects/${projectId}/downstream-contracts`) });
  const archive = useMutation({ mutationFn: (id: string) => api.post(`/projects/${projectId}/costs/${id}/archive`), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['costs', projectId] }); await queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }); await queryClient.invalidateQueries({ queryKey: ['downstream-contracts', projectId] }); setNotice('成本记录已归档，可在审计流水中追溯。'); } });
  const rows = costsQuery.data ?? [];
  const filtered = useMemo(() => rows.filter((row) => (type === 'ALL' || row.type === type) && (!q || `${row.description} ${row.vendorName ?? ''} ${row.teamName ?? ''} ${row.budgetItem?.name ?? ''} ${row.downstreamContract?.contractNo ?? ''} ${row.downstreamContract?.counterpartyName ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [rows, type, q]);
  const total = filtered.reduce((sum, row) => sum + row.amount, 0);
  if (costsQuery.isLoading || budgetQuery.isLoading || downstreamQuery.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (costsQuery.error || budgetQuery.error || downstreamQuery.error) return <div className="page-wrap"><ErrorBlock message={(costsQuery.error ?? budgetQuery.error ?? downstreamQuery.error as Error).toString()} retry={() => { void costsQuery.refetch(); void budgetQuery.refetch(); void downstreamQuery.refetch(); }} /></div>;

  return <div className="page-wrap">
    <PageHeader eyebrow="PROJECT COST / ACTUALS" title="实际成本录入" subtitle="按人工、材料、机械、分包和间接费分类登记，形成实际发生的成本台账。" actions={<><ProjectLedgerReportButton reportKey="actual-cost" /><Button variant="secondary" onClick={() => exportCosts(filtered)}><Download size={15} />导出 CSV</Button><Button onClick={() => setDialogOpen(true)}><Plus size={16} />新增成本</Button></>} />
    {notice && <div className="success-notice">{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}{serverError && <div className="form-alert">{serverError}</div>}
    <div className="cost-type-cards">{costTypes.filter((item) => item.value !== 'ALL').map((item) => { const subtotal = rows.filter((r) => r.type === item.value).reduce((sum, row) => sum + row.amount, 0); return <button className={`cost-type-card ${type === item.value ? 'active' : ''}`} key={item.value} onClick={() => setType(type === item.value ? 'ALL' : item.value as CostType)}><span className={`cost-type-symbol ${typeClasses[item.value as CostType]}`}><Receipt size={17} /></span><span className="cost-type-label">{item.label}</span><strong>{formatMoney(subtotal, 0)}</strong><small>{rows.filter((r) => r.type === item.value).length} 条记录</small></button>; })}</div>
    <div className="panel data-table-panel"><div className="panel-heading"><div><h3>成本明细台账</h3><p>当前筛选 {filtered.length} 条 · 合计 {formatMoney(total)}</p></div><div className="table-heading-actions"><span className="filter-label"><Filter size={14} />筛选</span><SelectField value={type} onChange={(e) => setType(e.target.value as CostType | 'ALL')} className="table-filter-select">{costTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</SelectField></div></div>
      <div className="table-toolbar"><div className="toolbar-search"><Search size={15} /><input placeholder="搜索费用说明、供应商或关联清单" value={q} onChange={(e) => setQ(e.target.value)} /></div><span className="muted-note">金额单位：元</span></div>
      {!filtered.length ? <EmptyState title={rows.length ? '没有匹配的成本记录' : '还没有实际成本记录'} description={rows.length ? '请调整关键词或费用类型筛选。' : '可以先录入人工费或材料采购费用，再查看三算对比分析。'} action={() => setDialogOpen(true)} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>发生日期</th><th>类型</th><th>费用说明</th><th>关联清单</th><th>分供合同</th><th>供应商 / 班组</th><th className="align-right">金额（元）</th><th>录入人</th><th>操作</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td><span className={`cost-kind-pill ${typeClasses[row.type]}`}>{typeLabels[row.type]}</span></td><td><strong className="table-primary-text">{row.description}</strong></td><td>{row.budgetItem ? <span className="budget-association">{row.budgetItem.code} {row.budgetItem.name}</span> : <span className="muted-note">未关联</span>}</td><td>{row.downstreamContract ? <><strong className="table-primary-text">{row.downstreamContract.contractNo}</strong><small className="table-subtext">{row.downstreamContract.counterpartyName}</small></> : <span className="muted-note">未关联</span>}</td><td>{row.businessPartyId && row.businessParty ? <Link to={`/parties/${row.businessPartyId}`}>{row.businessParty.name} ↗</Link> : row.vendorName || row.teamName || '—'}</td><td className="align-right numeric amount-strong">{formatMoney(row.amount)}</td><td>{row.createdBy?.name ?? '—'}</td><td><div className="row-actions"><button className="table-action" title="关联或修正合同来源" onClick={() => setLinkingEntry(row)}><Link2 size={13} />{row.downstreamContract ? '修改关联' : '关联合同'}</button><button className="table-action table-action-danger" title="归档记录" onClick={() => { if (window.confirm(`确定归档“${row.description}”吗？归档后不再计入成本汇总，但记录不会物理删除。`)) { setServerError(''); archive.mutate(row.id, { onError: (err) => setServerError(err instanceof ApiError ? err.message : '归档失败') }); } }} disabled={archive.isPending}><Archive size={14} />归档</button></div></td></tr>)}</tbody><tfoot><tr><td colSpan={6}>当前筛选合计</td><td className="align-right numeric">{formatMoney(total)}</td><td colSpan={2} /></tr></tfoot></table></div>}
    </div>
    <div className="data-note"><span className="note-mark">i</span><span>“实际成本”仅表示已录入且未归档的发生额。请将发生额关联至相应采购/分包合同；合同付款台账只计入现金流，不能重复计入实际成本。尚未签约的剩余工作仍需通过预计成本测算管理。</span></div>
    {dialogOpen && <CostDialog projectId={projectId} items={budgetQuery.data ?? []} contracts={downstreamQuery.data?.items ?? []} onClose={() => setDialogOpen(false)} />}
    {linkingEntry && <CostContractLinkDialog projectId={projectId} entry={linkingEntry} contracts={downstreamQuery.data?.items ?? []} onClose={() => setLinkingEntry(null)} onNotice={setNotice} />}
  </div>;
}
