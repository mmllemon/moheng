import DatePicker from '../components/DatePicker';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, FileSignature, LockKeyhole, Save, ShieldCheck, X } from 'lucide-react';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import { ProjectSummaryReportButton } from '../components/ReportLaunchButton';
import { Button, dateInputToIso, ErrorBlock, formatDate, formatMoney, LoadingBlock, PageHeader } from '../components/Ui';
import { Link, useNavigate } from 'react-router-dom';
import BusinessPartyPicker from '../components/BusinessPartyPicker';

type Contract = { id: string; projectId: string; contractNo: string; name: string; signedAt?: string | null; amount: number; effectiveAmount?: number; originalContractAmount?: number; counterpartyPartyId?: string | null; counterpartyParty?: { id: string; name: string; creditCode?: string | null } | null; taxIncluded: boolean; retentionRate: number; advanceDeductionRate: number; paymentTerms?: string | null; guaranteeEndAt?: string | null; notes?: string | null };
type ProjectBrief = { id: string; name: string; code: string; ownerName: string; ownerPartyId?: string | null };
const contractSchema = z.object({
  counterpartyPartyId: z.string().nullable().optional(), counterpartyName: z.string().trim().min(2, '请选择或填写建设单位'),
  contractNo: z.string().trim().optional().or(z.literal('')), name: z.string().trim().min(1, '请输入合同名称'),
  signedAt: z.string().optional(), amount: z.coerce.number().min(0, '金额不能小于 0'), taxIncluded: z.boolean(),
  retentionRate: z.coerce.number().min(0).max(100, '比例范围为 0—100'), advanceDeductionRate: z.coerce.number().min(0).max(100, '比例范围为 0—100'),
  paymentTerms: z.string().optional(), guaranteeEndAt: z.string().optional(), notes: z.string().optional(),
});
type ContractValues = z.infer<typeof contractSchema>;
const asDate = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';
const blankValues: ContractValues = { counterpartyPartyId: null, counterpartyName: '', contractNo: '', name: '', signedAt: '', amount: 0, taxIncluded: true, retentionRate: 3, advanceDeductionRate: 0, paymentTerms: '', guaranteeEndAt: '', notes: '' };

export default function ContractsPage() {
  const navigate = useNavigate();
  const projectId = useUiStore((state) => state.selectedProjectId);
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const contractQuery = useQuery({ queryKey: ['contract', projectId], queryFn: () => api.get<Contract | null>(`/projects/${projectId}/contracts/main`), enabled: Boolean(projectId) });
  const projectQuery = useQuery({ queryKey: ['project-brief', projectId], queryFn: () => api.get<ProjectBrief>(`/projects/${projectId}`), enabled: Boolean(projectId) });
  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting, isDirty } } = useForm<ContractValues>({ resolver: zodResolver(contractSchema), defaultValues: blankValues });

  useEffect(() => {
    if (contractQuery.data) reset({ counterpartyPartyId: contractQuery.data.counterpartyPartyId ?? projectQuery.data?.ownerPartyId ?? null, counterpartyName: contractQuery.data.counterpartyParty?.name ?? projectQuery.data?.ownerName ?? '', contractNo: contractQuery.data.contractNo, name: contractQuery.data.name, signedAt: asDate(contractQuery.data.signedAt), amount: contractQuery.data.amount, taxIncluded: contractQuery.data.taxIncluded, retentionRate: contractQuery.data.retentionRate * 100, advanceDeductionRate: contractQuery.data.advanceDeductionRate * 100, paymentTerms: contractQuery.data.paymentTerms ?? '', guaranteeEndAt: asDate(contractQuery.data.guaranteeEndAt), notes: contractQuery.data.notes ?? '' });
    else if (contractQuery.isSuccess) reset({ ...blankValues, counterpartyPartyId: projectQuery.data?.ownerPartyId ?? null, counterpartyName: projectQuery.data?.ownerName ?? '' });
  }, [contractQuery.data, contractQuery.isSuccess, projectQuery.data?.ownerName, projectQuery.data?.ownerPartyId, reset]);

  const save = handleSubmit(async (values) => {
    if (!projectId) return;
    setError(''); setNotice('');
    try {
      await api.put(`/projects/${projectId}/contracts/main`, { ...values, counterpartyPartyId: values.counterpartyPartyId ?? null, retentionRate: values.retentionRate / 100, advanceDeductionRate: values.advanceDeductionRate / 100, signedAt: values.signedAt ? dateInputToIso(values.signedAt) : null, guaranteeEndAt: values.guaranteeEndAt ? dateInputToIso(values.guaranteeEndAt) : null, paymentTerms: values.paymentTerms || null, notes: values.notes || null });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contract', projectId] }), queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] }), queryClient.invalidateQueries({ queryKey: ['project-brief', projectId] }), queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['business-parties'] }), queryClient.invalidateQueries({ queryKey: ['business-party-lookup'] }), queryClient.invalidateQueries({ queryKey: ['business-party-detail'] })]);
      setNotice('主合同资料已保存，建设单位档案已关联，操作及合同关联历史已写入审计流水。');
      setEditorOpen(false);
    } catch (err) { setError(err instanceof ApiError ? err.message : '保存失败，请重试'); }
  });

  if (contractQuery.isLoading || projectQuery.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (contractQuery.error || projectQuery.error) return <div className="page-wrap"><ErrorBlock message={(contractQuery.error ?? projectQuery.error as Error).toString()} retry={() => { void contractQuery.refetch(); void projectQuery.refetch(); }} /></div>;

  const contract = contractQuery.data;
  const originalAmount = contract?.originalContractAmount ?? contract?.amount ?? 0;
  const effectiveAmount = contract?.effectiveAmount ?? originalAmount;
  const adjustmentNet = effectiveAmount - originalAmount;

  return <div className="page-wrap owner-contract-page">
    <PageHeader eyebrow="OWNER CONTRACT / REGISTER" title="主合同管理" subtitle="默认查看合同台账摘要；新建或编辑合同资料时再打开表单。原始合同金额建档后锁定，价款变化通过已生效的业主变更记录反映。" actions={<><ProjectSummaryReportButton label="预览 / 导出项目综合报表" /><Button onClick={() => { setError(''); setEditorOpen(true); }}>{contract ? <><FileSignature size={15} />编辑合同资料</> : <><FileSignature size={15} />登记主合同</>}</Button></>} />
    {notice && <div className="success-notice"><ShieldCheck size={16} />{notice}</div>}{error && !editorOpen && <div className="form-alert">{error}</div>}
    {!contract ? <section className="panel owner-contract-empty"><div className="owner-contract-empty-mark"><FileSignature size={24} /></div><h2>当前项目尚未建立业主主合同</h2><p>先登记合同基准与付款条款，再维护进度款申报、变更签证和有效合同额。合同正式建档后，原始金额将锁定。</p><Button onClick={() => setEditorOpen(true)}><FileSignature size={15} />登记主合同</Button></section> : <>
      <section className="panel owner-contract-hero"><div className="owner-contract-hero-copy"><span className="owner-contract-kicker">OWNER MAIN CONTRACT</span><div className="owner-contract-title-line"><h2>{contract.name}</h2><span className="contract-lock-badge"><LockKeyhole size={13} />基准已锁定</span></div><div className="owner-contract-meta"><span>{contract.contractNo}</span><span>签订日期 {formatDate(contract.signedAt)}</span><span>{projectQuery.data?.ownerPartyId ? <Link to={`/parties/${projectQuery.data.ownerPartyId}`}>{projectQuery.data?.ownerName ?? '建设单位档案'} ↗</Link> : projectQuery.data?.ownerName ?? '业主单位'}</span></div></div><div className="owner-contract-effective"><span>当前有效合同额</span><strong>{formatMoney(effectiveAmount)}</strong><small>按原始合同基准与已生效外部确认变更汇总</small></div></section>

      <section className="owner-contract-amount-grid">
        <article className="owner-contract-amount-card"><span>原始合同金额</span><strong>{formatMoney(originalAmount)}</strong><small>建档基准 · 普通编辑不可修改</small></article>
        <article className="owner-contract-amount-card"><span>生效调整净额</span><strong className={adjustmentNet > 0 ? 'text-success' : adjustmentNet < 0 ? 'text-danger' : ''}>{adjustmentNet > 0 ? '+' : ''}{formatMoney(adjustmentNet)}</strong><small>来自达到生效条件的外部确认变更</small></article>
        <article className="owner-contract-amount-card"><span>价税口径</span><strong>{contract.taxIncluded ? '含税合同价' : '不含税合同价'}</strong><small>实际以正式合同条款为准</small></article>
      </section>

      <section className="panel owner-contract-detail-panel"><div className="panel-heading"><div><h3>合同关键条款</h3><p>该区域用于查看，不将整张合同编辑表单常驻在页面中。</p></div><Button variant="secondary" onClick={() => setEditorOpen(true)}>编辑非金额资料</Button></div><div className="owner-contract-detail-grid">
        <div><span>质保金比例</span><strong>{(contract.retentionRate * 100).toFixed(2)}%</strong></div>
        <div><span>预付款回扣比例</span><strong>{(contract.advanceDeductionRate * 100).toFixed(2)}%</strong></div>
        <div><span>质保金到期日</span><strong>{formatDate(contract.guaranteeEndAt)}</strong></div>
        <div className="span-detail-wide"><span>付款方式及条件</span><p>{contract.paymentTerms || '尚未填写'}</p></div>
        <div className="span-detail-wide"><span>合同备注</span><p>{contract.notes || '无备注'}</p></div>
      </div></section>

      <section className="section-block owner-contract-shortcuts"><div className="section-heading"><div><h2>关联业务</h2><p>按业主合同链路进入计量、价款变更与项目成本控制。</p></div></div><div className="owner-contract-shortcut-grid">
        <button onClick={() => navigate('/cost/progress-bills')}><span className="owner-shortcut-icon"><CalendarDays size={17} /></span><span><strong>进度款管理</strong><small>申报、审批与实际回款</small></span><ArrowRight size={15} /></button>
        <button onClick={() => navigate('/cost/changes')}><span className="owner-shortcut-icon"><ShieldCheck size={17} /></span><span><strong>变更签证</strong><small>外部确认和有效合同额调整</small></span><ArrowRight size={15} /></button>
        <button onClick={() => navigate('/cost/budget')}><span className="owner-shortcut-icon"><Save size={17} /></span><span><strong>预算与目标成本</strong><small>查看项目成本基准</small></span><ArrowRight size={15} /></button>
      </div></section>
    </>}

    {editorOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) setEditorOpen(false); }}><div className="dialog dialog-wide owner-contract-dialog" role="dialog" aria-modal="true" aria-labelledby="main-contract-dialog-title"><div className="dialog-header"><div><span className="eyebrow">OWNER CONTRACT / DETAILS</span><h2 id="main-contract-dialog-title">{contract ? '编辑主合同资料' : '登记主合同'}</h2><p>合同基准金额在建档后锁定；调整通过变更签证，不直接覆盖原始金额。</p></div><button className="icon-button" aria-label="关闭" onClick={() => setEditorOpen(false)} disabled={isSubmitting}><X size={17} /></button></div>
      <form onSubmit={save} noValidate><div className="form-grid two-cols">
        <div className="field span-2"><BusinessPartyPicker value={watch('counterpartyPartyId')} name={watch('counterpartyName') ?? ''} label="建设单位 / 合同相对方" autoCreateOnSubmit roles={['OWNER']} required onChange={(id, name) => { setValue('counterpartyPartyId', id, { shouldDirty: true, shouldValidate: true }); setValue('counterpartyName', name, { shouldDirty: true, shouldValidate: true }); }} />{errors.counterpartyName && <small className="field-error">{errors.counterpartyName.message}</small>}<input type="hidden" {...register('counterpartyName')} /></div>
        <div className="field"><label>合同编号</label><input {...register('contractNo')} placeholder="留空则自动生成；也可填写正式合同编号" />{errors.contractNo && <small className="field-error">{errors.contractNo.message}</small>}</div>
        <div className="field"><label>签订日期</label><DatePicker {...register('signedAt')} /></div>
        <div className="field span-2"><label>合同名称 <b>*</b></label><input {...register('name')} placeholder="施工总承包合同" />{errors.name && <small className="field-error">{errors.name.message}</small>}</div>
        <div className="field span-2"><label>原始合同金额（元） <b>*</b></label><input type="number" step="0.01" min="0" readOnly={Boolean(contract)} {...register('amount')} />{errors.amount && <small className="field-error">{errors.amount.message}</small>}{contract && <small className="field-hint">正式主合同已建档，原始金额不可修改；增减调整请在“变更签证”中登记并按外部凭证生效。</small>}</div>
        <div className="field"><label>质保金比例</label><div className="input-suffix"><input type="number" min="0" max="100" step="0.1" {...register('retentionRate')} /><span>%</span></div>{errors.retentionRate && <small className="field-error">{errors.retentionRate.message}</small>}</div>
        <div className="field"><label>预付款回扣比例</label><div className="input-suffix"><input type="number" min="0" max="100" step="0.1" {...register('advanceDeductionRate')} /><span>%</span></div>{errors.advanceDeductionRate && <small className="field-error">{errors.advanceDeductionRate.message}</small>}</div>
        <div className="field"><label>质保金到期日</label><DatePicker {...register('guaranteeEndAt')} /></div>
        <div className="field"><label>价税口径</label><label className="checkbox-line"><input type="checkbox" {...register('taxIncluded')} />合同金额含税</label></div>
        <div className="field span-2"><label>付款方式及条件</label><textarea rows={3} {...register('paymentTerms')} placeholder="例如：按月计量申报，审批后 28 天内付款。以正式合同为准。" /></div>
        <div className="field span-2"><label>备注</label><textarea rows={2} {...register('notes')} placeholder="合同特别条款、暂定金说明等" /></div>
      </div>{error && <div className="form-alert">{error}</div>}<div className="inline-notice"><LockKeyhole size={15} /><span>合同金额及价款变化写入审计流水。业主变更在满足有效外部确认规则后调整当前有效合同额。</span></div><div className="dialog-footer"><Button variant="secondary" onClick={() => setEditorOpen(false)} disabled={isSubmitting}>取消</Button><Button type="submit" disabled={isSubmitting || (Boolean(contract) && !isDirty)}><Save size={15} />{isSubmitting ? '保存中…' : '保存合同资料'}</Button></div></form>
    </div></div>}
  </div>;
}
