import DatePicker from '../components/DatePicker';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, Check, CircleDollarSign, Clock3, Plus, Send, WalletCards, X } from 'lucide-react';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import { ProjectLedgerReportButton } from '../components/ReportLaunchButton';
import type { ProgressBill, ProgressBillStatus } from '../types';
import { Button, currentDateInputValue, dateInputToIso, EmptyState, ErrorBlock, formatDate, formatMoney, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';

const createSchema = z.object({ periodNo: z.coerce.number().int().positive('期次必须大于 0'), applyDate: z.string().min(1, '请选择申报日期'), measureDate: z.string().optional(), amount: z.coerce.number().positive('申报金额必须大于 0'), notes: z.string().optional() });
type CreateForm = z.infer<typeof createSchema>;
const paymentSchema = z.object({ amount: z.coerce.number().positive('到账金额必须大于 0'), paidAt: z.string().min(1, '请选择到账日期'), referenceNo: z.string().optional(), notes: z.string().optional() });
type PaymentForm = z.infer<typeof paymentSchema>;

function BillCreateDialog({ projectId, nextPeriod, onClose }: { projectId: string; nextPeriod: number; onClose: () => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { periodNo: nextPeriod, applyDate: currentDateInputValue(), measureDate: currentDateInputValue(), amount: 0, notes: '' } });
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      await api.post(`/projects/${projectId}/progress-bills`, { periodNo: values.periodNo, applyDate: dateInputToIso(values.applyDate), measureDate: values.measureDate ? dateInputToIso(values.measureDate) : null, amount: values.amount, notes: values.notes || null });
      await queryClient.invalidateQueries({ queryKey: ['progress-bills', projectId] }); await queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }); await queryClient.invalidateQueries({ queryKey: ['dashboard'] }); onClose();
    } catch (err) { setError(err instanceof ApiError ? err.message : '申报保存失败'); }
  });
  return <div className="modal-backdrop"><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">REVENUE / PROGRESS BILL</span><h2>新建进度款申报</h2><p>先保存为草稿，再按审批流程提交。</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><form onSubmit={submit} noValidate><div className="form-grid two-cols">
    <div className="field"><label>申报期次 <b>*</b></label><input type="number" min="1" {...register('periodNo')} />{errors.periodNo && <small className="field-error">{errors.periodNo.message}</small>}</div>
    <div className="field"><label>申报日期 <b>*</b></label><DatePicker {...register('applyDate')} />{errors.applyDate && <small className="field-error">{errors.applyDate.message}</small>}</div>
    <div className="field"><label>截止计量日期</label><DatePicker {...register('measureDate')} /></div>
    <div className="field"><label>本期申报金额（元）<b>*</b></label><input type="number" min="0.01" step="0.01" {...register('amount')} />{errors.amount && <small className="field-error">{errors.amount.message}</small>}</div>
    <div className="field span-2"><label>备注</label><textarea rows={3} {...register('notes')} placeholder="本期计量范围、扣款说明等" /></div>
  </div>{error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? '保存中…' : '保存草稿'}</Button></div></form></div></div>;
}

function PaymentDialog({ bill, projectId, onClose }: { bill: ProgressBill; projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState(''); const remaining = Math.max(0, Number(bill.approvedAmount ?? bill.amount) - bill.paidAmount);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<PaymentForm>({ resolver: zodResolver(paymentSchema), defaultValues: { amount: Number(remaining.toFixed(2)), paidAt: currentDateInputValue(), referenceNo: '', notes: '' } });
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      await api.post(`/projects/${projectId}/progress-bills/${bill.id}/payments`, { ...values, paidAt: dateInputToIso(values.paidAt), referenceNo: values.referenceNo || null, notes: values.notes || null });
      await queryClient.invalidateQueries({ queryKey: ['progress-bills', projectId] }); await queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }); await queryClient.invalidateQueries({ queryKey: ['dashboard'] }); onClose();
    } catch (err) { setError(err instanceof ApiError ? err.message : '到账登记失败'); }
  });
  return <div className="modal-backdrop"><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">PAYMENT REGISTER</span><h2>登记到账</h2><p>第 {bill.periodNo} 期 · 支持多次部分到账。</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="payment-context"><div><span>核定金额</span><strong>{formatMoney(bill.approvedAmount ?? bill.amount)}</strong></div><div><span>已到账</span><strong>{formatMoney(bill.paidAmount)}</strong></div><div><span>剩余可登记</span><strong>{formatMoney(remaining)}</strong></div></div><form onSubmit={submit} noValidate><div className="form-grid two-cols"><div className="field"><label>本次到账金额（元）<b>*</b></label><input type="number" min="0.01" step="0.01" {...register('amount')} />{errors.amount && <small className="field-error">{errors.amount.message}</small>}</div><div className="field"><label>到账日期 <b>*</b></label><DatePicker {...register('paidAt')} />{errors.paidAt && <small className="field-error">{errors.paidAt.message}</small>}</div><div className="field span-2"><label>银行流水号 / 参考号</label><input {...register('referenceNo')} /></div><div className="field span-2"><label>备注</label><textarea rows={2} {...register('notes')} /></div></div>{error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? '提交中…' : '确认登记到账'}</Button></div></form></div></div>;
}

export default function ProgressBillsPage() {
  const projectId = useUiStore((state) => state.selectedProjectId)!; const queryClient = useQueryClient(); const navigate = useNavigate();
  const [creating, setCreating] = useState(false); const [paymentBill, setPaymentBill] = useState<ProgressBill | null>(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const query = useQuery({ queryKey: ['progress-bills', projectId], queryFn: () => api.get<ProgressBill[]>(`/projects/${projectId}/progress-bills`) });
  const mainContractQuery = useQuery({ queryKey: ['contract', projectId], queryFn: () => api.get<{ id: string; contractNo: string; name: string } | null>(`/projects/${projectId}/contracts/main`) });
  const ownerFinanceQuery = useQuery({ queryKey: ['owner-finance', projectId], queryFn: () => api.get<{ settlements: Array<{ type: string; status: string }> }>(`/projects/${projectId}/owner-finance`) });
  const changeStatus = useMutation({ mutationFn: ({ billId, status, approvedAmount }: { billId: string; status: ProgressBillStatus; approvedAmount?: number }) => api.patch(`/projects/${projectId}/progress-bills/${billId}/status`, { status, approvedAmount }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['progress-bills', projectId] }); await queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }); setNotice('进度款状态已更新。'); setError(''); }, onError: (err) => setError(err instanceof ApiError ? err.message : '状态更新失败') });
  const bills = query.data ?? [];
  const finalSettlementPosted = (ownerFinanceQuery.data?.settlements ?? []).some((settlement) => settlement.type === 'FINAL' && settlement.status === 'POSTED');
  const summary = useMemo(() => ({ submitted: bills.reduce((sum, b) => sum + b.amount, 0), approved: bills.reduce((sum, b) => sum + (b.approvedAmount ?? 0), 0), paid: bills.reduce((sum, b) => sum + b.paidAmount, 0), pending: bills.filter((b) => ['SUBMITTED', 'UNDER_REVIEW'].includes(b.status)).length }), [bills]);
  if (query.isLoading || mainContractQuery.isLoading || ownerFinanceQuery.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (query.error || mainContractQuery.error || ownerFinanceQuery.error) return <div className="page-wrap"><ErrorBlock message={(query.error ?? mainContractQuery.error ?? ownerFinanceQuery.error as Error).toString()} retry={() => { void query.refetch(); void mainContractQuery.refetch(); void ownerFinanceQuery.refetch(); }} /></div>;

  const nextActions = (bill: ProgressBill) => {
    if (bill.status === 'DRAFT') return [{ label: '提交申报', status: 'SUBMITTED' as const, icon: Send }];
    if (bill.status === 'SUBMITTED') return [{ label: '进入审核', status: 'UNDER_REVIEW' as const, icon: Clock3 }];
    if (bill.status === 'UNDER_REVIEW') return [{ label: '审批通过', status: 'APPROVED' as const, icon: Check }, { label: '驳回', status: 'REJECTED' as const, icon: X }];
    if (bill.status === 'REJECTED') return [{ label: '退回草稿', status: 'DRAFT' as const, icon: ArrowDownToLine }];
    return [];
  };

  return <div className="page-wrap">
    <PageHeader eyebrow="REVENUE / CASH COLLECTION" title="进度款管理" subtitle="业主进度款申报必须关联项目主合同；申请、审批和到账记录再归集到项目。" actions={<><ProjectLedgerReportButton reportKey="progress-bills" /><Button disabled={!mainContractQuery.data} onClick={() => setCreating(true)}><Plus size={16} />新建申报</Button></>} />
    {!mainContractQuery.data && <div className="inline-notice"><WalletCards size={17} /><span>当前项目尚未建立主合同，不能新建对业主进度款申报。请先完成主合同建档。</span><Button variant="secondary" onClick={() => navigate('/contracts')}>前往主合同管理</Button></div>}
    {mainContractQuery.data && <div className="inline-notice"><WalletCards size={17} /><span>当前申报归属主合同：<strong>{mainContractQuery.data.contractNo}</strong> · {mainContractQuery.data.name}</span></div>}
    {finalSettlementPosted && <div className="inline-notice settlement-closed-notice"><Check size={17} /><span>该主合同最终结算已过账。新的到账/退款及净应收调整请统一在“竣工结算与应收”办理，避免进度款入口绕过最终结算后的应收余额控制。</span><Button variant="secondary" onClick={() => navigate('/workspace/owner-finance')}>前往竣工结算与应收</Button></div>}
    {notice && <div className="success-notice">{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}{error && <div className="form-alert">{error}<button onClick={() => setError('')}><X size={13} /></button></div>}
    <div className="bill-summary-grid"><div className="bill-summary"><span className="bill-summary-icon"><WalletCards size={18} /></span><div><small>累计申报额</small><strong>{formatMoney(summary.submitted, 0)}</strong></div></div><div className="bill-summary"><span className="bill-summary-icon icon-green"><Check size={18} /></span><div><small>累计核定额</small><strong>{formatMoney(summary.approved, 0)}</strong></div></div><div className="bill-summary"><span className="bill-summary-icon icon-purple"><CircleDollarSign size={18} /></span><div><small>累计到账额</small><strong>{formatMoney(summary.paid, 0)}</strong></div></div><div className="bill-summary"><span className="bill-summary-icon icon-orange"><Clock3 size={18} /></span><div><small>待处理申报</small><strong>{summary.pending}<em> 期</em></strong></div></div></div>
    <section className="panel data-table-panel"><div className="panel-heading"><div><h3>申报记录</h3><p>共 {bills.length} 期 · 按期次倒序 · 新申报必须关联当前项目的主合同</p></div><span className="panel-icon"><WalletCards size={18} /></span></div>
      {!bills.length ? <EmptyState title="还没有进度款申报" description={mainContractQuery.data ? "创建第一期申报，录入本期申报金额和计量日期。" : "请先建立项目主合同，随后才能登记对业主的进度款申报。"} action={mainContractQuery.data ? () => setCreating(true) : undefined} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>期次</th><th>所属主合同</th><th>申报日期</th><th className="align-right">申报金额</th><th className="align-right">核定金额</th><th className="align-right">到账金额</th><th>到账进度</th><th>状态</th><th>操作</th></tr></thead><tbody>{[...bills].sort((a, b) => b.periodNo - a.periodNo).map((bill) => { const limit = bill.approvedAmount ?? bill.amount; const progress = limit > 0 ? Math.min(100, bill.paidAmount / limit * 100) : 0; return <tr key={bill.id}><td><strong>第 {bill.periodNo} 期</strong></td><td>{bill.mainContract ? <><strong className="table-primary-text">{bill.mainContract.contractNo}</strong><small className="table-subtext">{bill.mainContract.name}</small></> : <span className="muted-note">历史记录未关联主合同</span>}</td><td>{formatDate(bill.applyDate)}</td><td className="align-right numeric">{formatMoney(bill.amount)}</td><td className="align-right numeric">{bill.approvedAmount == null ? '—' : formatMoney(bill.approvedAmount)}</td><td className="align-right numeric amount-strong">{formatMoney(bill.paidAmount)}</td><td><div className="tiny-progress"><span style={{ width: `${progress}%` }} /></div><small className="table-subtext">{progress.toFixed(0)}%</small></td><td><StatusBadge status={bill.status} /></td><td><div className="row-actions">{nextActions(bill).map((action) => { const Icon = action.icon; return <button className="table-action" key={action.status} disabled={changeStatus.isPending} onClick={() => { if (action.status === 'REJECTED' && !window.confirm('确定驳回该期进度款吗？')) return; changeStatus.mutate({ billId: bill.id, status: action.status, ...(action.status === 'APPROVED' ? { approvedAmount: bill.amount } : {}) }); }}><Icon size={13} />{action.label}</button>; })}{!finalSettlementPosted && ['APPROVED', 'PAID'].includes(bill.status) && bill.paidAmount < (bill.approvedAmount ?? bill.amount) && <button className="table-action" onClick={() => setPaymentBill(bill)}><CircleDollarSign size={13} />登记到账</button>}</div></td></tr>; })}</tbody></table></div>}
    </section>
    {bills.some((b) => b.payments?.length) && <section className="panel payments-panel"><div className="panel-heading"><div><h3>到账明细</h3><p>最近登记的到账记录</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>期次</th><th>到账日期</th><th>类型</th><th>参考号</th><th className="align-right">金额</th><th>备注</th></tr></thead><tbody>{bills.flatMap((bill) => (bill.payments ?? []).map((payment) => ({ ...payment, periodNo: bill.periodNo }))).sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()).map((payment) => <tr key={payment.id}><td>第 {payment.periodNo} 期</td><td>{formatDate(payment.paidAt)}</td><td>{payment.type === 'REFUND' ? '退款冲回' : '到账'}</td><td>{'referenceNo' in payment ? payment.referenceNo || '—' : '—'}</td><td className={`align-right numeric ${payment.amount < 0 ? 'amount-negative' : ''}`}>{formatMoney(payment.amount)}</td><td>{'notes' in payment ? payment.notes || '—' : '—'}</td></tr>)}</tbody></table></div></section>}
    <div className="data-note"><span className="note-mark">i</span><span>本版的进度款申报记录仅统计总金额，不包含逐条工程量清单计量表、质保金/预付款回扣自动计算和附件上传。请以合同条款和正式计量资料为准。</span></div>
    {creating && <BillCreateDialog projectId={projectId} nextPeriod={Math.max(0, ...bills.map((b) => b.periodNo)) + 1} onClose={() => setCreating(false)} />}
    {paymentBill && <PaymentDialog bill={paymentBill} projectId={projectId} onClose={() => setPaymentBill(null)} />}
  </div>;
}
