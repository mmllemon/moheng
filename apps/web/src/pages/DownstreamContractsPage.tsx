import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, Banknote, BarChart3, ClipboardCheck, FilePlus2, FileSignature, Plus, ReceiptText, ShieldAlert, X } from 'lucide-react';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import BusinessPartyPicker from '../components/BusinessPartyPicker';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import { ProjectLedgerReportButton } from '../components/ReportLaunchButton';
import { Button, currentDateInputValue, dateInputToIso, EmptyState, ErrorBlock, formatDate, formatMoney, LoadingBlock, PageHeader, PageNote, Section } from '../components/Ui';
import { confirmThen } from '../components/ConfirmDialog';

type DownstreamContractType = 'LABOR_SUBCONTRACT' | 'PROFESSIONAL_SUBCONTRACT' | 'MATERIAL_PURCHASE' | 'EQUIPMENT_LEASE' | 'SERVICE' | 'OTHER';
type DownstreamContractStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'SETTLED' | 'TERMINATED';
type PaymentType = 'ADVANCE' | 'PROGRESS' | 'SETTLEMENT' | 'RETENTION' | 'REFUND' | 'OTHER';
type PaymentPlan = { id: string; stageName: string; dueAt: string; plannedAmount: number; paidAmount: number; remainingAmount: number; notes?: string | null; payments: Payment[] };
type Payment = { id: string; type: PaymentType; amount: number; paidAt: string; paymentPlanId?: string | null; refundOfPaymentId?: string | null; referenceNo?: string | null; notes?: string | null };
type Amendment = { id: string; code: string; name: string; direction: 'INCREASE' | 'DECREASE'; amount: number; effectiveAt: string; documentReference: string; notes?: string | null };
type DownstreamContract = {
  id: string; contractNo: string; name: string; type: DownstreamContractType; counterpartyName: string; counterpartyPartyId?: string | null; scope?: string | null;
  signedAt?: string | null; startDate?: string | null; plannedEndDate?: string | null; originalAmount: number; currentAmount: number;
  adjustmentNetAmount: number; taxIncluded: boolean; paymentTerms?: string | null; status: DownstreamContractStatus; notes?: string | null;
  paidAmount: number; grossPaidAmount: number; refundAmount: number; linkedActualCost: number; contractValueMinusLinkedActualCost: number; linkedActualCostOverContractValue: number;
  adjustments: Amendment[]; paymentPlans: PaymentPlan[]; payments: Payment[]; payables?: { id: string; payableNo: string; type: 'SETTLEMENT' | 'ADJUSTMENT' | 'RETENTION_RELEASE'; netAmount: number; openAmount: number }[];
};
type ContractResponse = { items: DownstreamContract[]; summary: { contractCount: number; activeContractCount: number; activeAndPendingSettlementContractCount?: number; currentContractAmount: number; activeAndPendingSettlementContractAmount: number; paidAmount: number; grossPaidAmount: number; refundedAmount: number; linkedActualCost: number; contractValueMinusLinkedActualCost: number; linkedActualCostOverContractValue: number } };

const typeLabels: Record<DownstreamContractType, string> = {
  LABOR_SUBCONTRACT: '劳务分包', PROFESSIONAL_SUBCONTRACT: '专业分包', MATERIAL_PURCHASE: '材料采购',
  EQUIPMENT_LEASE: '机械租赁', SERVICE: '服务合同', OTHER: '其他合同',
};
const statusLabels: Record<DownstreamContractStatus, string> = { DRAFT: '草稿', ACTIVE: '执行中', COMPLETED: '完工待结算', SETTLED: '结算已确认', TERMINATED: '已终止' };
const statusClass: Record<DownstreamContractStatus, string> = { DRAFT: 'status-gray', ACTIVE: 'status-blue', COMPLETED: 'status-orange', SETTLED: 'status-green', TERMINATED: 'status-red' };
const paymentTypeLabels: Record<PaymentType, string> = { ADVANCE: '预付款', PROGRESS: '进度款', SETTLEMENT: '结算款', RETENTION: '质保金', REFUND: '退款/退回', OTHER: '其他付款' };

const contractSchema = z.object({
  contractNo: z.string().trim().optional().or(z.literal('')), name: z.string().trim().min(1, '请输入合同名称'),
  type: z.enum(['LABOR_SUBCONTRACT', 'PROFESSIONAL_SUBCONTRACT', 'MATERIAL_PURCHASE', 'EQUIPMENT_LEASE', 'SERVICE', 'OTHER']),
  counterpartyName: z.string().trim().min(2, '请输入供应商或分包单位'), counterpartyPartyId: z.string().nullable().optional(), scope: z.string().optional(),
  signedAt: z.string().min(1, '录入已签订合同必须填写签订日期'), startDate: z.string().optional(), plannedEndDate: z.string().optional(),
  originalAmount: z.coerce.number().positive('合同金额必须大于 0'), taxIncluded: z.boolean(), paymentTerms: z.string().optional(), notes: z.string().optional(),
});
type ContractForm = z.infer<typeof contractSchema>;
const amendmentSchema = z.object({ code: z.string().trim().min(1, '请输入补充协议编号'), name: z.string().trim().min(1, '请输入调整事项'), direction: z.enum(['INCREASE', 'DECREASE']), amount: z.coerce.number().positive('调整金额必须大于 0'), effectiveAt: z.string().min(1, '请选择生效日期'), documentReference: z.string().trim().min(1, '请填写已签署文件编号/定位'), notes: z.string().optional() });
type AmendmentForm = z.infer<typeof amendmentSchema>;
const planSchema = z.object({ stageName: z.string().trim().min(1, '请输入付款阶段'), dueAt: z.string().min(1, '请选择计划日期'), plannedAmount: z.coerce.number().positive('计划金额必须大于 0'), notes: z.string().optional() });
type PlanForm = z.infer<typeof planSchema>;
const paymentSchema = z.object({ paymentPlanId: z.string().optional(), payableId: z.string().optional(), refundOfPaymentId: z.string().optional(), type: z.enum(['ADVANCE', 'PROGRESS', 'SETTLEMENT', 'RETENTION', 'REFUND', 'OTHER']), amount: z.coerce.number().positive('付款金额必须大于 0'), paidAt: z.string().min(1, '请选择付款日期'), referenceNo: z.string().optional(), notes: z.string().optional() }).superRefine((value, ctx) => { if (value.type === 'REFUND' && !value.refundOfPaymentId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['refundOfPaymentId'], message: '请选择被退回的原始付款' }); if (value.type !== 'REFUND' && value.refundOfPaymentId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['refundOfPaymentId'], message: '只有退款才需要关联原始付款' }); });
type PaymentForm = z.infer<typeof paymentSchema>;

function dateTimePayload(value: string) { return dateInputToIso(value); }
function invalidateDownstream(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: ['downstream-contracts', projectId] });
  void queryClient.invalidateQueries({ queryKey: ['costs', projectId] });
  void queryClient.invalidateQueries({ queryKey: ['analysis', projectId] });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

function CreateContractDialog({ projectId, existing, onClose, onNotice }: { projectId: string; existing?: DownstreamContract; onClose: () => void; onNotice: (s: string) => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState('');
  const editDate = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<ContractForm>({ resolver: zodResolver(contractSchema), defaultValues: existing ? {
    contractNo: existing.contractNo, name: existing.name, type: existing.type, counterpartyName: existing.counterpartyName, counterpartyPartyId: existing.counterpartyPartyId ?? null,
    scope: existing.scope ?? '', signedAt: editDate(existing.signedAt), startDate: editDate(existing.startDate), plannedEndDate: editDate(existing.plannedEndDate),
    originalAmount: existing.originalAmount, taxIncluded: existing.taxIncluded, paymentTerms: existing.paymentTerms ?? '', notes: existing.notes ?? '',
  } : { contractNo: '', name: '', type: 'MATERIAL_PURCHASE', counterpartyName: '', counterpartyPartyId: null, scope: '', signedAt: currentDateInputValue(), startDate: currentDateInputValue(), plannedEndDate: '', originalAmount: 0, taxIncluded: true, paymentTerms: '', notes: '' } });
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      const payload = { ...values, counterpartyPartyId: values.counterpartyPartyId ?? null, signedAt: values.signedAt ? dateTimePayload(values.signedAt) : null, startDate: values.startDate ? dateTimePayload(values.startDate) : null, plannedEndDate: values.plannedEndDate ? dateTimePayload(values.plannedEndDate) : null, scope: values.scope || null, paymentTerms: values.paymentTerms || null, notes: values.notes || null };
      if (existing) await api.patch(`/projects/${projectId}/downstream-contracts/${existing.id}`, payload);
      else await api.post(`/projects/${projectId}/downstream-contracts`, payload);
      invalidateDownstream(queryClient, projectId); onNotice(existing ? '下游合同草稿已更新。正式激活后，原始合同金额将锁定。' : '下游合同草稿已创建。核对合同资料后，将其状态激活为执行中，才计入执行中合同承诺。'); onClose();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : '下游合同创建失败'); }
  });
  return <div className="modal-backdrop"><div className="dialog dialog-wide"><div className="dialog-header"><div><span className="eyebrow">DOWNSTREAM CONTRACT / NEW</span><h2>{existing ? '编辑分供合同草稿' : '新增分供合同'}</h2><p>采购、劳务、专业分包、机械租赁和服务合同统一登记到当前项目。</p></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭"><X size={18} /></Button></div><form onSubmit={submit} noValidate><div className="form-grid two-cols">
    <div className="field"><label>合同编号</label><input {...register('contractNo')} placeholder="留空则自动生成；也可填写正式合同编号" />{errors.contractNo && <small className="field-error">{errors.contractNo.message}</small>}</div>
    <div className="field"><label>合同类别 <b>*</b></label><SelectField {...register('type')}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField></div>
    <div className="field span-2"><label>合同名称 <b>*</b></label><input {...register('name')} placeholder="例如：地下室钢筋材料采购合同" />{errors.name && <small className="field-error">{errors.name.message}</small>}</div>
    <div className="field span-2"><BusinessPartyPicker value={watch('counterpartyPartyId')} name={watch('counterpartyName') ?? ''} label="分包单位 / 供应商" autoCreateOnSubmit roles={watch('type') === 'LABOR_SUBCONTRACT' ? ['LABOR_SUBCONTRACTOR'] : watch('type') === 'PROFESSIONAL_SUBCONTRACT' ? ['PROFESSIONAL_SUBCONTRACTOR'] : watch('type') === 'EQUIPMENT_LEASE' ? ['EQUIPMENT_LESSOR'] : watch('type') === 'SERVICE' ? ['SERVICE_PROVIDER'] : watch('type') === 'MATERIAL_PURCHASE' ? ['MATERIAL_SUPPLIER'] : ['OTHER']} required onChange={(id, name) => { setValue('counterpartyPartyId', id, { shouldDirty: true, shouldValidate: true }); setValue('counterpartyName', name, { shouldDirty: true, shouldValidate: true }); }} />{errors.counterpartyName && <small className="field-error">{errors.counterpartyName.message}</small>}<input type="hidden" {...register('counterpartyName')} /></div>
    <div className="field"><label>签订日期 <b>*</b></label><DatePicker {...register('signedAt')} />{errors.signedAt && <small className="field-error">{errors.signedAt.message}</small>}</div>
    <div className="field"><label>原始合同金额（元） <b>*</b></label><input type="number" min="0.01" step="0.01" {...register('originalAmount')} />{errors.originalAmount && <small className="field-error">{errors.originalAmount.message}</small>}</div>
    <div className="field"><label>开始日期</label><DatePicker {...register('startDate')} /></div><div className="field"><label>计划结束日期</label><DatePicker {...register('plannedEndDate')} /></div>
    <div className="field"><label>价税口径</label><label className="checkbox-line"><input type="checkbox" {...register('taxIncluded')} />合同金额含税</label></div>
    <div className="field span-2"><label>合同范围</label><textarea rows={2} {...register('scope')} placeholder="说明供货范围、分包工作内容、工程部位等" /></div>
    <div className="field span-2"><label>付款约定</label><textarea rows={2} {...register('paymentTerms')} placeholder="例如：材料验收后按月结算，留 3% 质保金" /></div>
    <div className="field span-2"><label>备注</label><textarea rows={2} {...register('notes')} /></div>
  </div>{error && <div className="form-alert">{error}</div>}<div className="inline-notice"><ShieldAlert size={16} /><span>保存后先成为草稿。确认正式签约信息后再激活；原始合同金额激活后锁定，后续已生效补充协议采用独立增减记录。</span></div><div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}><FileSignature size={15} />{isSubmitting ? '保存中…' : existing ? '保存草稿修改' : '创建合同草稿'}</Button></div></form></div></div>;
}

function AmendmentDialog({ projectId, contract, onClose, onNotice }: { projectId: string; contract: DownstreamContract; onClose: () => void; onNotice: (s: string) => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AmendmentForm>({ resolver: zodResolver(amendmentSchema), defaultValues: { code: '', name: '', direction: 'INCREASE', amount: 0, effectiveAt: currentDateInputValue(), documentReference: '', notes: '' } });
  const submit = handleSubmit(async (values) => {
    setError('');
    try { await api.post(`/projects/${projectId}/downstream-contracts/${contract.id}/adjustments`, { ...values, effectiveAt: dateTimePayload(values.effectiveAt), notes: values.notes || null }); invalidateDownstream(queryClient, projectId); onNotice('已登记已生效补充协议，合同当前金额已重算；原始金额未被覆盖。'); onClose(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '补充协议登记失败'); }
  });
  return <div className="modal-backdrop"><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">SIGNED AMENDMENT</span><h2>登记已生效补充协议</h2><p>{contract.contractNo} · 当前合同额 {formatMoney(contract.currentAmount)}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X size={18} /></Button></div><form onSubmit={submit} noValidate><div className="form-grid two-cols">
    <div className="field"><label>补充协议编号 <b>*</b></label><input {...register('code')} />{errors.code && <small className="field-error">{errors.code.message}</small>}</div>
    <div className="field"><label>调整方向</label><SelectField {...register('direction')}><option value="INCREASE">增加合同额</option><option value="DECREASE">减少合同额</option></SelectField></div>
    <div className="field span-2"><label>调整事项 <b>*</b></label><input {...register('name')} />{errors.name && <small className="field-error">{errors.name.message}</small>}</div>
    <div className="field"><label>调整金额（元） <b>*</b></label><input type="number" min="0.01" step="0.01" {...register('amount')} />{errors.amount && <small className="field-error">{errors.amount.message}</small>}</div>
    <div className="field"><label>生效日期 <b>*</b></label><DatePicker {...register('effectiveAt')} />{errors.effectiveAt && <small className="field-error">{errors.effectiveAt.message}</small>}</div>
    <div className="field span-2"><label>已签署文件编号 / 归档定位 <b>*</b></label><input {...register('documentReference')} placeholder="补充协议编号、档案号等" />{errors.documentReference && <small className="field-error">{errors.documentReference.message}</small>}</div>
    <div className="field span-2"><label>备注</label><textarea rows={2} {...register('notes')} /></div>
  </div>{error && <div className="form-alert">{error}</div>}<div className="inline-notice"><ShieldAlert size={16} /><span>本操作用于登记已签署并已生效的补充协议，不用于登记待审批的谈判金额。提交后作为追加记录保留。</span></div><div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}><BadgeCheck size={15} />{isSubmitting ? '保存中…' : '登记生效协议'}</Button></div></form></div></div>;
}

function PlanDialog({ projectId, contract, onClose, onNotice }: { projectId: string; contract: DownstreamContract; onClose: () => void; onNotice: (s: string) => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<PlanForm>({ resolver: zodResolver(planSchema), defaultValues: { stageName: '', dueAt: currentDateInputValue(), plannedAmount: 0, notes: '' } });
  const submit = handleSubmit(async (values) => { setError(''); try { await api.post(`/projects/${projectId}/downstream-contracts/${contract.id}/payment-plans`, { ...values, dueAt: dateTimePayload(values.dueAt), notes: values.notes || null }); invalidateDownstream(queryClient, projectId); onNotice('付款计划已登记；计划金额只表示预计付款，不代表已支付或实际成本。'); onClose(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : '付款计划保存失败'); } });
  return <div className="modal-backdrop"><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">PAYMENT PLAN</span><h2>新增付款计划</h2><p>{contract.contractNo} · {contract.name}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X size={18} /></Button></div><form onSubmit={submit} noValidate><div className="form-grid"><div className="field"><label>付款阶段 <b>*</b></label><input {...register('stageName')} placeholder="预付款/第 1 期进度款/结算款" />{errors.stageName && <small className="field-error">{errors.stageName.message}</small>}</div><div className="field"><label>计划日期 <b>*</b></label><DatePicker {...register('dueAt')} />{errors.dueAt && <small className="field-error">{errors.dueAt.message}</small>}</div><div className="field"><label>计划金额（元） <b>*</b></label><input type="number" min="0.01" step="0.01" {...register('plannedAmount')} />{errors.plannedAmount && <small className="field-error">{errors.plannedAmount.message}</small>}</div><div className="field"><label>备注</label><textarea rows={2} {...register('notes')} /></div></div>{error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}><FilePlus2 size={15} />{isSubmitting ? '保存中…' : '保存计划'}</Button></div></form></div></div>;
}

function PaymentDialog({ projectId, contract, onClose, onNotice }: { projectId: string; contract: DownstreamContract; onClose: () => void; onNotice: (s: string) => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState('');
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<PaymentForm>({ resolver: zodResolver(paymentSchema), defaultValues: { paymentPlanId: '', payableId: contract.payables?.find((item) => item.openAmount > 0)?.id ?? '', refundOfPaymentId: '', type: 'PROGRESS', amount: 0, paidAt: currentDateInputValue(), referenceNo: '', notes: '' } });
  const watchType = watch('type');
  const availablePayables = (contract.payables ?? []).filter((item) => item.openAmount > 0 && (watchType === 'RETENTION' ? item.type === 'RETENTION_RELEASE' : item.type !== 'RETENTION_RELEASE'));
  const refundableBalance = (payment: Payment) => payment.amount - contract.payments.filter((entry) => entry.type === 'REFUND' && entry.refundOfPaymentId === payment.id).reduce((sum, entry) => sum + entry.amount, 0);
  const refundablePayments = contract.payments.filter((payment) => payment.type !== 'REFUND' && refundableBalance(payment) > 0);
  const submit = handleSubmit(async (values) => { setError(''); try { await api.post(`/projects/${projectId}/downstream-contracts/${contract.id}/payments`, { ...values, paymentPlanId: watchType === 'REFUND' ? null : (values.paymentPlanId || null), payableId: ['REFUND', 'ADVANCE'].includes(watchType) ? null : (values.payableId || null), refundOfPaymentId: watchType === 'REFUND' ? (values.refundOfPaymentId || null) : null, paidAt: dateTimePayload(values.paidAt), referenceNo: values.referenceNo?.trim() || null, notes: values.notes || null }); invalidateDownstream(queryClient, projectId); onNotice(values.type === 'REFUND' ? '退款/退回已登记，净付款同步减少；不会冲减或删除已确认的实际成本。' : '分供合同付款已登记。该记录属于资金流，不会自动作为实际成本重复入账。'); onClose(); } catch (cause) { setError(cause instanceof ApiError ? cause.message : '分供合同付款登记失败'); } });
  return <div className="modal-backdrop"><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">OUTGOING PAYMENT</span><h2>登记支付/退款</h2><p>{contract.contractNo} · 净已付款 {formatMoney(contract.paidAmount)} / 当前合同额 {formatMoney(contract.currentAmount)}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X size={18} /></Button></div><form onSubmit={submit} noValidate><div className="form-grid"><div className="field"><label>付款类型</label><SelectField {...register('type')}>{Object.entries(paymentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField></div>{watchType === 'REFUND' ? <div className="field span-2"><label>退回哪一笔原始付款 <b>*</b></label><SelectField {...register('refundOfPaymentId')}><option value="">请选择原始付款</option>{refundablePayments.map((payment) => <option key={payment.id} value={payment.id}>{paymentTypeLabels[payment.type]} · {formatMoney(payment.amount)} · {formatDate(payment.paidAt)} · 可退 {formatMoney(refundableBalance(payment))}{payment.referenceNo ? ` · ${payment.referenceNo}` : ''}</option>)}</SelectField>{errors.refundOfPaymentId && <small className="field-error">{errors.refundOfPaymentId.message}</small>}<small className="field-hint">退款自动继承原始付款的付款计划；同一笔原始付款的累计退款不能超过原付款金额。</small></div> : <div className="field"><label>关联付款计划</label><SelectField {...register('paymentPlanId')}><option value="">不关联具体计划</option>{contract.paymentPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.stageName} · 剩余 {formatMoney(plan.remainingAmount)}</option>)}</SelectField></div>}{!['REFUND', 'ADVANCE'].includes(watchType) && (contract.payables?.length ?? 0) > 0 && <div className="field span-2"><label>核销应付单 <b>*</b></label><SelectField {...register('payableId')}><option value="">请选择有未付余额的应付单</option>{availablePayables.map((payable) => <option key={payable.id} value={payable.id}>{payable.payableNo} · {payable.type === 'RETENTION_RELEASE' ? '质保金释放' : payable.type === 'ADJUSTMENT' ? '结算调整' : '结算应付'} · 未付 {formatMoney(payable.openAmount)}</option>)}</SelectField><small>已启用正式应付台账的合同，普通付款必须核销到应付来源；质保金付款只能核销质保金释放形成的应付单。</small></div>}<div className="field"><label>{watchType === 'REFUND' ? '退款/退回金额（元）' : '实际付款金额（元）'} <b>*</b></label><input type="number" min="0.01" step="0.01" {...register('amount')} />{errors.amount && <small className="field-error">{errors.amount.message}</small>}</div><div className="field"><label>付款日期 <b>*</b></label><DatePicker {...register('paidAt')} />{errors.paidAt && <small className="field-error">{errors.paidAt.message}</small>}</div><div className="field"><label>银行流水 / 付款参考号</label><input {...register('referenceNo')} /></div><div className="field"><label>备注</label><textarea rows={2} {...register('notes')} /></div></div>{error && <div className="form-alert">{error}</div>}<div className="inline-notice"><Banknote size={16} /><span>{watchType === 'REFUND' ? '退款/退回以独立现金流记录，金额填正数并关联原始付款；系统从累计净付款与对应付款计划净额中扣减，并同时校验合同净已付款和该笔原始付款余额。已确认实际成本不会随退款自动减少。' : '付款只记录现金流；只有已发生且按规则确认的成本，才应另行关联分供合同并录入“实际成本”。'}</span></div><div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}><ReceiptText size={15} />{isSubmitting ? '保存中…' : '登记付款'}</Button></div></form></div></div>;
}

export default function DownstreamContractsPage() {
  const navigate = useNavigate();
  const projectId = useUiStore((state) => state.selectedProjectId)!; const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false); const [editing, setEditing] = useState<DownstreamContract | null>(null); const [amending, setAmending] = useState<DownstreamContract | null>(null); const [planning, setPlanning] = useState<DownstreamContract | null>(null); const [paying, setPaying] = useState<DownstreamContract | null>(null); const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['downstream-contracts', projectId], queryFn: () => api.get<ContractResponse>(`/projects/${projectId}/downstream-contracts`) });
  const changeStatus = useMutation({
    mutationFn: ({ contract, status }: { contract: DownstreamContract; status: DownstreamContractStatus }) => api.patch(`/projects/${projectId}/downstream-contracts/${contract.id}/status`, { status }),
    onSuccess: (_result, variables) => {
      invalidateDownstream(queryClient, projectId); setError('');
      const messages: Record<DownstreamContractStatus, string> = {
        DRAFT: '合同仍为草稿。', ACTIVE: '合同已激活，纳入执行中合同金额汇总。', COMPLETED: '合同已标记为完工待结算，仍纳入该状态合同金额汇总。',
        SETTLED: '合同结算已确认；未付清的结算款、质保金仍可继续登记支付或退款。', TERMINATED: '合同已终止，不再计入执行中/完工待结算合同金额汇总。',
      };
      setNotice(messages[variables.status]);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : '合同状态更新失败'),
  });
  if (query.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (query.error) return <div className="page-wrap"><ErrorBlock message={(query.error as Error).message} retry={() => void query.refetch()} /></div>;
  const rows = query.data?.items ?? []; const summary = query.data?.summary;
  return <div className="page-wrap">
    <PageHeader eyebrow="PROJECT COST / COMMITMENTS" title="分供合同台账" subtitle="统一管理分包、材料采购、机械租赁与服务合同；合同金额、实际成本和现金支付分别核算。" actions={<><ProjectLedgerReportButton reportKey="downstream-contracts" /><Button variant="secondary" onClick={() => navigate('/cost/downstream?view=finance')}>结算与应付账款<ArrowRight size={14} /></Button><Button onClick={() => setCreating(true)}><Plus size={16} />新增分供合同</Button></>} />
    {notice && <div className="success-notice">{notice}<Button variant="ghost" size="icon" onClick={() => setNotice('')} aria-label="关闭提示"><X size={14} /></Button></div>}{error && <div className="form-alert">{error}</div>}
    <Section title="数据概览" subtitle="合同数、执行中合同额、关联成本与现金流分别核算；概览数字不替代明细台账。" icon={BarChart3}>
    <div className="change-summary-grid downstream-summary-grid">
      <div className="change-summary"><span className="change-summary-label">分供合同数</span><strong>{summary?.contractCount ?? 0}</strong><small>含草稿及历史合同</small></div>
      <div className="change-summary"><span className="change-summary-label">执行中/完工待结算合同额</span><strong>{formatMoney(summary?.activeAndPendingSettlementContractAmount ?? 0, 0)}</strong><small>执行中 + 完工待结算合同当前金额合计（{summary?.activeAndPendingSettlementContractCount ?? 0} 份）</small></div>
      <div className="change-summary"><span className="change-summary-label">关联实际成本</span><strong>{formatMoney(summary?.linkedActualCost ?? 0, 0)}</strong><small>仅统计关联合同且未归档的成本记录</small></div>
      <div className="change-summary change-summary-emphasis"><span className="change-summary-label">累计净付款</span><strong>{formatMoney(summary?.paidAmount ?? 0, 0)}</strong><small>累计付款 {formatMoney(summary?.grossPaidAmount ?? 0, 0)} − 退款 {formatMoney(summary?.refundedAmount ?? 0, 0)}</small></div>
      <div className="change-summary"><span className="change-summary-label">累计退款/退回</span><strong>{formatMoney(summary?.refundedAmount ?? 0, 0)}</strong><small>单独记现金流，不自动冲减成本</small></div>
    </div>
    </Section>
    <div className="inline-notice"><ShieldAlert size={17} /><span>口径说明：合同当前金额 = 原始签约金额 + 已登记且有效的补充协议净额。执行中/完工待结算合同额是这些合同当前金额的合计，并非精确的未履约承诺额。付款计划是预计现金流，付款台账是实际现金流；只有成本录入才计入实际成本。合同额与已关联实际成本的算术差额不是预计成本或预计完工成本。</span></div>
    <Section title="明细" subtitle="合同金额调整必须登记已签署生效的补充协议，不允许直接覆盖原始金额。" icon={FileSignature}>
      {!rows.length ? <EmptyState title="当前项目还没有分供合同" description="先建立采购、劳务/专业分包或租赁合同，再按实际业务维护付款计划、实际支付和合同关联成本。" action={() => setCreating(true)} /> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>合同编号 / 名称</th><th>类型 / 对方</th><th>状态</th><th className="align-right">原始金额</th><th className="align-right">当前合同额</th><th className="align-right">累计净付款</th><th className="align-right">关联实际成本</th><th>操作</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td><strong className="table-primary-text">{row.contractNo}</strong><small className="table-subtext">{row.name}</small></td>
                    <td>{typeLabels[row.type]}<small className="table-subtext">{row.counterpartyPartyId ? <Link to={`/parties/${row.counterpartyPartyId}`}>{row.counterpartyName} ↗</Link> : row.counterpartyName}</small></td>
                    <td><span className={`status-badge ${statusClass[row.status]}`}><span className="status-dot" />{statusLabels[row.status]}</span></td>
                    <td className="align-right numeric">{formatMoney(row.originalAmount)}</td>
                    <td className="align-right numeric amount-strong">{formatMoney(row.currentAmount)}{row.adjustmentNetAmount !== 0 && <small className="table-subtext">调整净额 {formatMoney(row.adjustmentNetAmount)}</small>}</td>
                    <td className="align-right numeric">{formatMoney(row.paidAmount)}{row.refundAmount > 0 && <small className="table-subtext">累计退款 {formatMoney(row.refundAmount)}</small>}</td>
                    <td className="align-right numeric">{formatMoney(row.linkedActualCost)}{row.linkedActualCostOverContractValue > 0 && <small className="field-error">成本高于合同额 {formatMoney(row.linkedActualCostOverContractValue)}</small>}</td>
                    <td>
                      <div className="row-actions">
                        <Button size="xs" variant="ghost" onClick={() => setExpanded(expanded === row.id ? null : row.id)}><ClipboardCheck size={13} />{expanded === row.id ? '收起台账' : '查看台账'}</Button>
                        {row.status === 'DRAFT' && <>
                          <Button size="xs" variant="ghost" onClick={() => setEditing(row)}><FileSignature size={13} />编辑草稿</Button>
                          <Button size="xs" variant="ghost" disabled={changeStatus.isPending} onClick={() => { confirmThen(`确认将“${row.contractNo}”激活为执行中合同？激活后原始合同金额将锁定。`, () => changeStatus.mutate({ contract: row, status: 'ACTIVE' }), { title: '激活分供合同', confirmText: '激活' }); }}><BadgeCheck size={13} />激活合同</Button>
                        </>}
                        {['ACTIVE', 'COMPLETED'].includes(row.status) && <>
                          <Button size="xs" variant="ghost" onClick={() => setAmending(row)}><FilePlus2 size={13} />补充协议</Button>
                          <Button size="xs" variant="ghost" onClick={() => setPlanning(row)}><Plus size={13} />付款计划</Button>
                        </>}
                        {['ACTIVE', 'COMPLETED', 'SETTLED'].includes(row.status) && <Button size="xs" variant="ghost" onClick={() => setPaying(row)}><Banknote size={13} />登记支付/退款</Button>}
                        {row.status === 'ACTIVE' && <Button size="xs" variant="ghost" disabled={changeStatus.isPending} onClick={() => { confirmThen(`确认将“${row.contractNo}”标记为完工待结算？`, () => changeStatus.mutate({ contract: row, status: 'COMPLETED' }), { title: '标记完工待结算', confirmText: '标记完工' }); }}><BadgeCheck size={13} />标记完工</Button>}
                        {row.status === 'COMPLETED' && <Link className="table-action" to="/cost/downstream?view=finance"><BadgeCheck size={13} />办理最终结算</Link>}
                        {['DRAFT', 'ACTIVE', 'COMPLETED'].includes(row.status) && <Button size="xs" variant="danger" disabled={changeStatus.isPending} onClick={() => { confirmThen(`确定终止“${row.contractNo}”？请先核对未付款、履约及补偿责任。`, () => changeStatus.mutate({ contract: row, status: 'TERMINATED' }), { title: '终止分供合同', tone: 'danger', confirmText: '终止合同' }); }}><X size={13} />终止</Button>}
                      </div>
                    </td>
                  </tr>
                  {expanded === row.id && (
                    <tr><td colSpan={8}>
                      <div className="downstream-detail-grid">
                        <div>
                          <h4>有效补充协议</h4>
                          {row.adjustments.length ? row.adjustments.map((item) => <p key={item.id}><strong>{item.code}</strong> · {item.name} · {item.direction === 'DECREASE' ? '−' : '+'}{formatMoney(item.amount)}<small className="table-subtext">{formatDate(item.effectiveAt)} · {item.documentReference}</small></p>) : <p className="muted-note">暂无已生效补充协议</p>}
                        </div>
                        <div>
                          <h4>付款计划与付款记录</h4>
                          {row.paymentPlans.length ? row.paymentPlans.map((plan) => <p key={plan.id}><strong>{plan.stageName}</strong> · 计划 {formatMoney(plan.plannedAmount)} · 已付 {formatMoney(plan.paidAmount)} · 剩余 {formatMoney(plan.remainingAmount)}<small className="table-subtext">计划日期 {formatDate(plan.dueAt)}</small></p>) : <p className="muted-note">暂无付款计划</p>}
                          {row.payments.length > 0 && <div className="downstream-payment-list">{row.payments.slice(0, 8).map((payment) => <p key={payment.id}>{paymentTypeLabels[payment.type]} · {payment.type === 'REFUND' ? '−' : ''}{formatMoney(payment.amount)} · {formatDate(payment.paidAt)}<small className="table-subtext">{payment.referenceNo || '无流水号'}{payment.type === 'REFUND' ? ` · 退回原付款 ${payment.refundOfPaymentId ?? '关联缺失'}` : ''}</small></p>)}</div>}
                        </div>
                        <div>
                          <h4>合同额减已关联实际成本（预警差额）</h4><strong>{formatMoney(row.contractValueMinusLinkedActualCost)}</strong>
                          <p className="muted-note">只是两个数据的算术差额，不等于未履约承诺，也不等于预计成本。履约/验收/应计成本未完整记录时不得用于财务结算。</p>
                          <h4>合同条款</h4><p>{row.paymentTerms || '未填写付款条件'}</p><p>{row.scope || '未填写合同范围'}</p>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="detail-notes">
        <div className="inline-notice"><ShieldAlert size={16} /><span>“结算已确认”不等于“款项已付清”。已过账结算会在“结算与应付”形成独立应付来源；普通付款须核销应付余额，预付款单独管理，质保金释放后再形成应付。没有最终结算过账，不能直接修改合同状态为结算已确认。</span></div>
        <PageNote>已付款不自动生成实际成本，避免双重累计。请在“实际成本录入”选择对应分供合同后录入已发生金额；历史未关联成本需要在核对发票、验收或结算依据后手动补关联，不能仅按金额自动匹配。</PageNote>
      </div>
    </Section>
    {creating && <CreateContractDialog projectId={projectId} onClose={() => setCreating(false)} onNotice={setNotice} />}
    {editing && <CreateContractDialog key={editing.id} projectId={projectId} existing={editing} onClose={() => setEditing(null)} onNotice={setNotice} />}
    {amending && <AmendmentDialog projectId={projectId} contract={amending} onClose={() => setAmending(null)} onNotice={setNotice} />}
    {planning && <PlanDialog projectId={projectId} contract={planning} onClose={() => setPlanning(null)} onNotice={setNotice} />}
    {paying && <PaymentDialog projectId={projectId} contract={paying} onClose={() => setPaying(null)} onNotice={setNotice} />}
  </div>;
}
