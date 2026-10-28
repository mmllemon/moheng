import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ClipboardCheck, Download, FileCheck2, FilePlus2, GitPullRequest, Plus, Send, ShieldAlert, X } from 'lucide-react';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import { ProjectLedgerReportButton } from '../components/ReportLaunchButton';
import type { ChangeRecord, ChangeStatus, EvidenceClass, ExternalConfirmationStatus } from '../types';
import { Button, currentDateInputValue, currentDateTimeLocalInputValue, dateInputToIso, EmptyState, ErrorBlock, formatDate, formatMoney, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';
import { confirmThen } from '../components/ConfirmDialog';
import DateTimeField from '../components/DateTimeField';

const changeSchema = z.object({
  code: z.string().trim().optional().or(z.literal('')),
  name: z.string().trim().min(1, '请输入变更名称'),
  type: z.string().min(1),
  direction: z.enum(['INCREASE', 'DECREASE']),
  occurredAt: z.string().min(1, '请选择发生日期'),
  submittedAmount: z.coerce.number().min(0, '送审金额不能为负数'),
  description: z.string().optional(),
});
type ChangeForm = z.infer<typeof changeSchema>;
const decisionSchema = z.object({ approvedAmount: z.coerce.number().min(0, '内部核定金额不能为负数'), decisionNote: z.string().optional() });
type DecisionForm = z.infer<typeof decisionSchema>;
const evidenceSchema = z.object({
  evidenceClass: z.enum(['A', 'B', 'C']),
  evidenceAssessment: z.enum(['READY', 'SUPPLEMENT_NEEDED', 'DISPUTED']),
  externalConfirmerName: z.string().trim().min(1, '请填写外部确认人姓名'),
  externalConfirmerAuthority: z.string().trim().min(1, '请说明其身份或授权依据'),
  externalConfirmedAt: z.string().min(1, '请选择外部确认时间').refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime()), '请输入有效的外部确认时间'),
  externalConfirmedAmount: z.coerce.number().min(0, '外部确认金额不能为负数'),
  externalConfirmationScope: z.string().trim().min(1, '请明确确认范围'),
  evidenceReference: z.string().trim().min(1, '请填写凭证编号、邮件主题或聊天定位'),
  evidenceContext: z.string().trim().min(1, '请记录完整原始上下文或关键原文'),
});
type EvidenceForm = z.infer<typeof evidenceSchema>;
const reviewSchema = z.object({ decision: z.enum(['VERIFIED', 'REJECTED', 'DISPUTED']), decisionNote: z.string().optional() });
type ReviewForm = z.infer<typeof reviewSchema>;

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.onload = () => {
      const content = String(reader.result ?? '');
      const comma = content.indexOf(',');
      if (comma < 0) reject(new Error(`文件编码失败：${file.name}`));
      else resolve(content.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function invalidateContractQueries(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: ['changes', projectId] });
  void queryClient.invalidateQueries({ queryKey: ['analysis', projectId] });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  void queryClient.invalidateQueries({ queryKey: ['projects'] });
  void queryClient.invalidateQueries({ queryKey: ['contract', projectId] });
  void queryClient.invalidateQueries({ queryKey: ['project-summary', projectId] });
}

function ChangeCreateDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ChangeForm>({
    resolver: zodResolver(changeSchema),
    defaultValues: { code: `BG-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`, name: '', type: 'ENGINEERING_CHANGE', direction: 'INCREASE', occurredAt: currentDateInputValue(), submittedAmount: 0, description: '' },
  });
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      await api.post(`/projects/${projectId}/changes`, { ...values, occurredAt: dateInputToIso(values.occurredAt), description: values.description || null });
      invalidateContractQueries(queryClient, projectId);
      onClose();
    } catch (err) { setError(err instanceof ApiError ? err.message : '变更记录保存失败'); }
  });
  return <div className="modal-backdrop"><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">CHANGE / VARIATION</span><h2>新增变更签证</h2><p>内部审批与外部确认分开记录；只有有效外部确认金额进入当前有效合同额。</p></div><Button variant="ghost" size="icon" onClick={onClose}><X size={18} /></Button></div><form onSubmit={submit} noValidate><div className="form-grid two-cols">
    <div className="field"><label>变更编号</label><input {...register('code')} placeholder="留空则自动生成项目变更编号" />{errors.code && <small className="field-error">{errors.code.message}</small>}</div>
    <div className="field"><label>发生日期 <b>*</b></label><DatePicker {...register('occurredAt')} />{errors.occurredAt && <small className="field-error">{errors.occurredAt.message}</small>}</div>
    <div className="field span-2"><label>变更名称 <b>*</b></label><input {...register('name')} placeholder="例如：地下室局部优化" />{errors.name && <small className="field-error">{errors.name.message}</small>}</div>
    <div className="field"><label>变更类型</label><SelectField {...register('type')}><option value="ENGINEERING_CHANGE">工程变更</option><option value="SITE_VISA">现场签证</option><option value="OWNER_INSTRUCTION">业主指令</option><option value="UNFORESEEN">不可预见事项</option></SelectField></div>
    <div className="field"><label>调整方向</label><SelectField {...register('direction')}><option value="INCREASE">增加合同额</option><option value="DECREASE">减少合同额</option></SelectField></div>
    <div className="field span-2"><label>公司内部送审金额（元）<b>*</b></label><input type="number" min="0" step="0.01" {...register('submittedAmount')} />{errors.submittedAmount && <small className="field-error">{errors.submittedAmount.message}</small>}<small className="field-hint">此金额仅用于内部流程；有效合同额使用外部确认金额。</small></div>
    <div className="field span-2"><label>变更说明</label><textarea rows={3} {...register('description')} placeholder="变更原因、工程范围、计价依据等" /></div>
  </div>{error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? '保存中…' : '保存变更'}</Button></div></form></div></div>;
}

function ChangeDecisionDialog({ record, projectId, onClose, onNotice }: { record: ChangeRecord; projectId: string; onClose: () => void; onNotice: (message: string) => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<DecisionForm>({ resolver: zodResolver(decisionSchema), defaultValues: { approvedAmount: record.submittedAmount, decisionNote: '' } });
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      await api.patch(`/projects/${projectId}/changes/${record.id}/status`, { status: 'CONFIRMED', approvedAmount: values.approvedAmount, decisionNote: values.decisionNote || null });
      invalidateContractQueries(queryClient, projectId);
      onNotice('内部审批已记录；本次审批不会单独改变当前有效合同额。');
      onClose();
    } catch (err) { setError(err instanceof ApiError ? err.message : '内部审批结果保存失败'); }
  });
  return <div className="modal-backdrop"><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">INTERNAL APPROVAL</span><h2>填写内部审批结果</h2><p>{record.code} · {record.name}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X size={18} /></Button></div><form onSubmit={submit} noValidate><div className="form-grid"><div className="field"><label>内部送审金额（元）</label><input value={formatMoney(record.submittedAmount)} readOnly /></div><div className="field"><label>内部核定金额（元）<b>*</b></label><input type="number" min="0" step="0.01" {...register('approvedAmount')} />{errors.approvedAmount && <small className="field-error">{errors.approvedAmount.message}</small>}</div><div className="field"><label>内部审批意见</label><textarea rows={3} {...register('decisionNote')} placeholder="内部审核意见、成本测算差异等" /></div></div><div className="inline-notice"><ShieldAlert size={17} /><span>内部核定金额与外部确认金额分别保存，内部审批通过不代表合同金额已生效。</span></div>{error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}><BadgeCheck size={15} />{isSubmitting ? '提交中…' : '确认内部审批'}</Button></div></form></div></div>;
}

function ExternalConfirmationDialog({ record, projectId, onClose, onNotice }: { record: ChangeRecord; projectId: string; onClose: () => void; onNotice: (message: string) => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const { register, control, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<EvidenceForm>({
    resolver: zodResolver(evidenceSchema),
    defaultValues: { evidenceClass: 'A', evidenceAssessment: 'READY', externalConfirmerName: '', externalConfirmerAuthority: '', externalConfirmedAt: currentDateTimeLocalInputValue(), externalConfirmedAmount: record.submittedAmount, externalConfirmationScope: record.name, evidenceReference: '', evidenceContext: '' },
  });
  const evidenceClass = watch('evidenceClass');
  const submit = handleSubmit(async (values) => {
    setError('');
    if (!files.length) { setError('请上传至少一份原始凭证文件。'); return; }
    if (files.length > 8 || files.some((file) => file.size > 5 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) {
      setError('最多上传 8 个文件；每个文件不超过 5 MiB，全部文件不超过 8 MiB。'); return;
    }
    try {
      const attachments = await Promise.all(files.map(async (file) => ({ fileName: file.name, mimeType: file.type, contentBase64: await readFileBase64(file) })));
      await api.post(`/projects/${projectId}/changes/${record.id}/external-confirmation`, {
        ...values,
        externalConfirmedAt: new Date(values.externalConfirmedAt).toISOString(),
        attachments,
      });
      invalidateContractQueries(queryClient, projectId);
      onNotice(values.evidenceAssessment === 'SUPPLEMENT_NEEDED' ? '凭证已登记为待补充，暂不计入当前有效合同额；补充后可再次提交。' : values.evidenceAssessment === 'DISPUTED' ? '凭证已标记为存在争议，未计入当前有效合同额。' : values.evidenceClass === 'C' ? 'C 类凭证已登记，待另一名有权限的人员核验；核验通过后才计入有效合同额。' : '外部确认凭证已登记并生效，当前有效合同额已重新计算。');
      onClose();
    } catch (err) { setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : '外部确认凭证登记失败'); }
  });
  return <div className="modal-backdrop"><div className="dialog dialog-wide"><div className="dialog-header"><div><span className="eyebrow">EXTERNAL CONFIRMATION</span><h2>登记外部确认凭证</h2><p>{record.code} · {record.name}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X size={18} /></Button></div><form onSubmit={submit} noValidate><div className="form-grid two-cols">
    <div className="field span-2"><label>凭证类别 <b>*</b></label><SelectField {...register('evidenceClass')}><option value="A">A 类 — 正式书面签章文件</option><option value="B">B 类 — 合规电子签署或电子记录</option><option value="C">C 类 — 微信、邮件、会议纪要等非正式沟通</option></SelectField>{errors.evidenceClass && <small className="field-error">{errors.evidenceClass.message}</small>}<small className="field-hint">{evidenceClass === 'C' ? 'C 类凭证登记后先进入待核验状态，不能立即计入有效合同额。' : 'A/B 类凭证需明确外部确认人、授权依据、范围、金额并上传原始文件；材料完整且无争议时才生效。'}</small></div>
    <div className="field span-2"><label>当前证据评估</label><SelectField {...register('evidenceAssessment')}><option value="READY">材料完整、身份授权明确、金额范围无争议</option><option value="SUPPLEMENT_NEEDED">证据不足或信息有歧义，待补充材料</option><option value="DISPUTED">存在争议，不应生效</option></SelectField><small className="field-hint">待补充状态可以继续补交凭证；有争议的记录不会计入有效合同额。</small></div>
    <div className="field"><label>外部确认人姓名 <b>*</b></label><input {...register('externalConfirmerName')} />{errors.externalConfirmerName && <small className="field-error">{errors.externalConfirmerName.message}</small>}</div>
    <div className="field"><label>身份/授权依据 <b>*</b></label><input {...register('externalConfirmerAuthority')} placeholder="例如：业主项目负责人，授权文件编号" />{errors.externalConfirmerAuthority && <small className="field-error">{errors.externalConfirmerAuthority.message}</small>}</div>
    <div className="field"><label>外部确认时间 <b>*</b></label><Controller control={control} name="externalConfirmedAt" render={({ field }) => <DateTimeField value={field.value} onChange={field.onChange} onBlur={field.onBlur} name={field.name} required />} />{errors.externalConfirmedAt && <small className="field-error">{errors.externalConfirmedAt.message}</small>}</div>
    <div className="field"><label>外部确认金额（元）<b>*</b></label><input type="number" min="0" step="0.01" {...register('externalConfirmedAmount')} />{errors.externalConfirmedAmount && <small className="field-error">{errors.externalConfirmedAmount.message}</small>}<small className="field-hint">有效合同额按此金额和变更方向计算，不按内部核定金额替代或封顶。若与内部参考金额不一致，凭证生效后将单独触发内部差异复核，不影响外部金额生效。</small></div>
    <div className="field span-2"><label>确认范围 <b>*</b></label><textarea rows={2} {...register('externalConfirmationScope')} placeholder="明确对应项目、变更事项、工程范围和适用内容" />{errors.externalConfirmationScope && <small className="field-error">{errors.externalConfirmationScope.message}</small>}</div>
    <div className="field span-2"><label>原始凭证定位 <b>*</b></label><input {...register('evidenceReference')} placeholder="文件编号、电子签约流水号、邮件主题/时间、聊天对象/消息定位" />{errors.evidenceReference && <small className="field-error">{errors.evidenceReference.message}</small>}</div>
    <div className="field span-2"><label>完整原始上下文/关键原文 <b>*</b></label><textarea rows={4} {...register('evidenceContext')} placeholder="记录确认原文、前后文、时间、发送账号及金额计算依据；截图或文件须与文字上下文相互对应。" />{errors.evidenceContext && <small className="field-error">{errors.evidenceContext.message}</small>}</div>
    <div className="field span-2"><label>上传原始凭证文件 <b>*</b></label><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.eml,application/pdf,image/png,image/jpeg,image/webp,text/plain,message/rfc822" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><small className="field-hint">支持 PDF、PNG、JPG、WebP、TXT、EML；最多 8 个文件，单个不超过 5 MiB，总大小不超过 8 MiB。上传后文件保存于服务端证据目录，并记录 SHA-256 校验值。</small>{files.length > 0 && <small className="field-hint">已选择：{files.map((file) => `${file.name} (${Math.ceil(file.size / 1024)} KB)`).join('、')}</small>}</div>
  </div>{error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}><FileCheck2 size={15} />{isSubmitting ? '正在保存凭证…' : '登记外部确认'}</Button></div></form></div></div>;
}

function EvidenceReviewDialog({ record, projectId, onClose, onNotice }: { record: ChangeRecord; projectId: string; onClose: () => void; onNotice: (message: string) => void }) {
  const queryClient = useQueryClient(); const [error, setError] = useState(''); const [downloadError, setDownloadError] = useState('');
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<ReviewForm>({ resolver: zodResolver(reviewSchema), defaultValues: { decision: 'VERIFIED', decisionNote: '' } });
  const decision = watch('decision');
  const submit = handleSubmit(async (values) => {
    setError('');
    if (values.decision !== 'VERIFIED' && !values.decisionNote?.trim()) { setError('核验不通过或存在争议时，必须填写原因。'); return; }
    try {
      await api.post(`/projects/${projectId}/changes/${record.id}/external-confirmation/review`, values);
      invalidateContractQueries(queryClient, projectId);
      onNotice(values.decision === 'VERIFIED' ? 'C 类凭证核验通过，外部确认金额已立即计入当前有效合同额。' : values.decision === 'DISPUTED' ? 'C 类凭证已标记为存在争议，未计入当前有效合同额。' : 'C 类凭证核验未通过，未计入当前有效合同额。');
      onClose();
    } catch (err) { setError(err instanceof ApiError ? err.message : '凭证核验失败'); }
  });
  const downloadReviewEvidence = async (fileId: string, fileName: string) => {
    setDownloadError('');
    try {
      const blob = await api.download(`/projects/${projectId}/changes/${record.id}/evidence-files/${fileId}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setDownloadError(cause instanceof ApiError ? cause.message : '凭证下载失败'); }
  };
  return <div className="modal-backdrop"><div className="dialog dialog-wide"><div className="dialog-header"><div><span className="eyebrow">C-CLASS EVIDENCE REVIEW</span><h2>核验 C 类凭证有效性</h2><p>{record.code} · {record.name}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X size={18} /></Button></div><form onSubmit={submit} noValidate>
    <div className="inline-notice"><ShieldAlert size={17} /><span>核验仅检查外部确认凭证的真实性线索、授权、范围、金额依据及完整性；不要求核验人再次审批合同调整金额。核验人不得是业务创建人或提交人。</span></div>
    <div className="evidence-review-details"><div><span>外部确认人</span><strong>{record.externalConfirmerName || '未填写'}</strong></div><div><span>身份/授权依据</span><strong>{record.externalConfirmerAuthority || '未填写'}</strong></div><div><span>确认时间</span><strong>{record.externalConfirmedAt ? formatDate(record.externalConfirmedAt) : '未填写'}</strong></div><div><span>外部确认金额</span><strong>{formatMoney(record.externalConfirmedAmount ?? 0)}{record.direction === 'DECREASE' ? '（合同额扣减）' : ''}</strong></div><div className="evidence-review-wide"><span>确认范围</span><p>{record.externalConfirmationScope || '未填写'}</p></div><div className="evidence-review-wide"><span>原始凭证定位</span><p>{record.evidenceReference || '未填写'}</p></div><div className="evidence-review-wide"><span>完整原始上下文/关键原文</span><p>{record.evidenceContext || '未填写'}</p></div><div className="evidence-review-wide"><span>原始附件</span><div className="row-actions">{(record.evidenceFiles ?? []).map((file) => <Button size="xs" variant="ghost" key={file.id} onClick={() => void downloadReviewEvidence(file.id, file.fileName)}><Download size={13} />{file.fileName}</Button>)}</div>{downloadError && <small className="field-error">{downloadError}</small>}</div></div>
    <div className="form-grid"><div className="field"><label>核验结论</label><SelectField {...register('decision')}><option value="VERIFIED">有效性核验通过 — 立即生效</option><option value="REJECTED">核验不通过 — 不生效</option><option value="DISPUTED">存在争议 — 不生效</option></SelectField></div><div className="field"><label>{decision === 'VERIFIED' ? '核验备注（可选）' : '核验原因（必填）'}</label><textarea rows={3} {...register('decisionNote')} placeholder="说明身份/授权、范围、金额计算、上下文或争议点核查结果" />{errors.decisionNote && <small className="field-error">{errors.decisionNote.message}</small>}</div></div>
    {error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}><BadgeCheck size={15} />{isSubmitting ? '正在核验…' : '提交核验结论'}</Button></div></form></div></div>;
}

function InternalAmountReviewDialog({ record, projectId, onClose, onNotice }: { record: ChangeRecord; projectId: string; onClose: () => void; onNotice: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ note: string }>({
    resolver: zodResolver(z.object({ note: z.string().trim().min(1, '请填写差异复核处理意见').max(2000) })),
    defaultValues: { note: '' },
  });
  const internalAmount = Number(record.internalAmountReviewReferenceAmount ?? record.approvedAmount ?? record.submittedAmount);
  const externalAmount = Number(record.internalAmountReviewExternalAmount ?? record.externalConfirmedAmount ?? 0);
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      await api.post(`/projects/${projectId}/changes/${record.id}/internal-amount-review/complete`, values);
      invalidateContractQueries(queryClient, projectId);
      onNotice('内部金额差异复核已完成；外部确认金额及当前有效合同额未被改写。');
      onClose();
    } catch (err) { setError(err instanceof ApiError ? err.message : '金额差异复核提交失败'); }
  });
  return <div className="modal-backdrop"><div className="dialog"><div className="dialog-header"><div><span className="eyebrow">AMOUNT DISCREPANCY REVIEW</span><h2>内部金额差异复核</h2><p>{record.code} · {record.name}</p></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭"><X size={18} /></Button></div>
    <div className="inline-notice"><ShieldAlert size={17} /><span>外部确认金额已经按凭证规则生效。此复核用于解释和追踪金额差异，不得把外部确认金额改成内部核定金额，也不会撤销当前有效合同额。</span></div>
    <div className="evidence-review-details"><div><span>内部参考金额</span><strong>{formatMoney(internalAmount)}</strong></div><div><span>触发复核时的外部确认金额</span><strong>{formatMoney(externalAmount)}</strong></div><div><span>差异（外部 - 内部）</span><strong>{formatMoney(externalAmount - internalAmount)}</strong></div><div><span>调整方向</span><strong>{record.direction === 'DECREASE' ? '减少合同额' : '增加合同额'}</strong></div></div>
    <form onSubmit={submit} noValidate><div className="field"><label>差异复核意见 <b>*</b></label><textarea rows={4} {...register('note')} placeholder="说明外部确认金额与内部参考金额不同的原因、核对依据、后续措施或责任跟踪事项。" />{errors.note && <small className="field-error">{errors.note.message}</small>}</div>
      {error && <div className="form-alert">{error}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}><ClipboardCheck size={15} />{isSubmitting ? '正在保存…' : '完成差异复核'}</Button></div></form></div></div>;
}

function evidenceClassLabel(value?: EvidenceClass | null) {
  if (value === 'A') return 'A 类 · 正式书面凭证';
  if (value === 'B') return 'B 类 · 合规电子凭证';
  if (value === 'C') return 'C 类 · 非正式沟通凭证';
  return '未登记';
}
function externalStatusLabel(value?: ExternalConfirmationStatus) {
  const labels: Record<ExternalConfirmationStatus, string> = { NOT_CONFIRMED: '未登记外部确认', PENDING_SUPPLEMENT: '待补充证据', PENDING_VERIFICATION: '待独立核验', EFFECTIVE: '已生效', REJECTED: '核验未通过', DISPUTED: '存在争议' };
  return value ? labels[value] : labels.NOT_CONFIRMED;
}
function externalStatusClass(value?: ExternalConfirmationStatus) {
  if (value === 'EFFECTIVE') return 'status-green';
  if (value === 'PENDING_VERIFICATION' || value === 'PENDING_SUPPLEMENT') return 'status-orange';
  if (value === 'DISPUTED' || value === 'REJECTED') return 'status-red';
  return 'status-gray';
}

export default function ChangesPage() {
  const projectId = useUiStore((state) => state.selectedProjectId)!; const queryClient = useQueryClient(); const navigate = useNavigate();
  const [creating, setCreating] = useState(false); const [decision, setDecision] = useState<ChangeRecord | null>(null);
  const [externalRecord, setExternalRecord] = useState<ChangeRecord | null>(null); const [reviewRecord, setReviewRecord] = useState<ChangeRecord | null>(null); const [amountReviewRecord, setAmountReviewRecord] = useState<ChangeRecord | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const query = useQuery({ queryKey: ['changes', projectId], queryFn: () => api.get<ChangeRecord[]>(`/projects/${projectId}/changes`) });
  const projectQuery = useQuery({ queryKey: ['project-summary', projectId], queryFn: () => api.get<{ contractAmount: number; originalContractAmount: number }>(`/projects/${projectId}`), enabled: Boolean(projectId) });
  const mainContractQuery = useQuery({ queryKey: ['contract', projectId], queryFn: () => api.get<{ id: string; contractNo: string; name: string } | null>(`/projects/${projectId}/contracts/main`) });
  const updateStatus = useMutation({
    mutationFn: ({ record, status }: { record: ChangeRecord; status: ChangeStatus }) => api.patch(`/projects/${projectId}/changes/${record.id}/status`, { status }),
    onSuccess: () => { invalidateContractQueries(queryClient, projectId); setNotice('变更内部流程状态已更新。'); setError(''); },
    onError: (err) => setError(err instanceof ApiError ? err.message : '状态更新失败'),
  });
  if (query.isLoading || projectQuery.isLoading || mainContractQuery.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (query.error || projectQuery.error || mainContractQuery.error) return <div className="page-wrap"><ErrorBlock message={(query.error ?? projectQuery.error ?? mainContractQuery.error as Error).toString()} retry={() => { void query.refetch(); void projectQuery.refetch(); void mainContractQuery.refetch(); }} /></div>;
  const changes = query.data ?? [];
  const pending = changes.filter((c) => ['SUBMITTED', 'UNDER_REVIEW'].includes(c.status)).length;
  const effectiveNet = changes.reduce((sum, c) => c.externalConfirmationStatus === 'EFFECTIVE' ? sum + (c.direction === 'DECREASE' ? -1 : 1) * (c.externalConfirmedAmount ?? 0) : sum, 0);
  const pendingEvidence = changes.filter((c) => c.externalConfirmationStatus === 'PENDING_VERIFICATION').length;
  const getActions = (record: ChangeRecord) => {
    const actions: { label: string; run: () => void; danger?: boolean; icon: typeof Send }[] = [];
    if (record.status === 'DRAFT') actions.push({ label: '提交内部审批', run: () => updateStatus.mutate({ record, status: 'SUBMITTED' }), icon: Send });
    if (record.status === 'SUBMITTED') {
      actions.push({ label: '进入审核', run: () => updateStatus.mutate({ record, status: 'UNDER_REVIEW' }), icon: GitPullRequest });
      actions.push({ label: '驳回', run: () => confirmThen(`确定驳回“${record.name}”吗？`, () => updateStatus.mutate({ record, status: 'REJECTED' }), { title: '驳回变更', tone: 'danger', confirmText: '驳回' }), danger: true, icon: X });
    }
    if (record.status === 'UNDER_REVIEW') {
      actions.push({ label: '内部审批', run: () => setDecision(record), icon: BadgeCheck });
      actions.push({ label: '驳回', run: () => confirmThen(`确定驳回“${record.name}”吗？`, () => updateStatus.mutate({ record, status: 'REJECTED' }), { title: '驳回变更', tone: 'danger', confirmText: '驳回' }), danger: true, icon: X });
    }
    if (record.status === 'REJECTED') actions.push({ label: '退回草稿', run: () => updateStatus.mutate({ record, status: 'DRAFT' }), icon: FilePlus2 });
    if (['NOT_CONFIRMED', 'PENDING_SUPPLEMENT', 'REJECTED', 'DISPUTED'].includes(record.externalConfirmationStatus)) actions.push({ label: record.externalConfirmationStatus === 'NOT_CONFIRMED' ? '登记外部确认' : record.externalConfirmationStatus === 'PENDING_SUPPLEMENT' ? '补充凭证' : '补充材料/重新提交', run: () => setExternalRecord(record), icon: FileCheck2 });
    if (record.evidenceClass === 'C' && record.externalConfirmationStatus === 'PENDING_VERIFICATION') actions.push({ label: '核验 C 类凭证', run: () => setReviewRecord(record), icon: ShieldAlert });
    if (record.externalConfirmationStatus === 'EFFECTIVE' && record.internalAmountReviewStatus === 'PENDING') actions.push({ label: '处理金额差异', run: () => setAmountReviewRecord(record), icon: ClipboardCheck });
    return actions;
  };
  const downloadEvidence = async (record: ChangeRecord, fileId: string, fileName: string) => {
    try {
      const blob = await api.download(`/projects/${projectId}/changes/${record.id}/evidence-files/${fileId}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof ApiError ? err.message : '凭证下载失败'); }
  };
  return <div className="page-wrap">
    <PageHeader eyebrow="CONTRACT / CHANGES" title="变更签证" subtitle="业主侧变更必须关联主合同；内部审批、外部确认和凭证核验分开记录。" actions={<><ProjectLedgerReportButton reportKey="changes" /><Button disabled={!mainContractQuery.data} onClick={() => setCreating(true)}><Plus size={16} />新增变更</Button></>} />
    {!mainContractQuery.data && <div className="inline-notice"><FileCheck2 size={17} /><span>当前项目尚未建立主合同，不能新建业主侧变更签证。请先完成主合同建档。</span><Button variant="secondary" onClick={() => navigate('/contracts')}>前往主合同管理</Button></div>}
    {mainContractQuery.data && <div className="inline-notice"><FileCheck2 size={17} /><span>当前变更台账归属主合同：<strong>{mainContractQuery.data.contractNo}</strong> · {mainContractQuery.data.name}</span></div>}
    {notice && <div className="success-notice"><BadgeCheck size={16} />{notice}</div>}{error && <div className="form-alert">{error}</div>}
    <div className="change-summary-grid">
      <div className="change-summary"><span className="change-summary-label">变更/签证总数</span><strong>{changes.length.toString().padStart(2, '0')}</strong><small>包含所有状态</small></div>
      <div className="change-summary"><span className="change-summary-label">内部待审核</span><strong>{pending.toString().padStart(2, '0')}</strong><small>已提交或审核中</small></div>
      <div className="change-summary"><span className="change-summary-label">待核验 C 类凭证</span><strong>{pendingEvidence.toString().padStart(2, '0')}</strong><small>核验通过前不计入合同额</small></div>
      <div className="change-summary change-summary-emphasis"><span className="change-summary-label">有效变更净额</span><strong>{formatMoney(effectiveNet, 0)}</strong><small>按外部确认金额和增减方向汇总</small></div>
    </div>
    {projectQuery.data && <div className="inline-notice"><FileCheck2 size={17} /><span>当前有效合同额：<strong>{formatMoney(projectQuery.data.contractAmount)}</strong>；原始合同金额：{formatMoney(projectQuery.data.originalContractAmount)}。内部审批通过本身不会改变当前有效合同额。</span></div>}
    <section className="panel change-table-panel"><div className="panel-heading"><div><h3>变更签证台账</h3><p>提交人不能审批本人业务；C 类凭证核验人必须与业务提交人不同。</p></div><span className="panel-icon"><FileCheck2 size={19} /></span></div>
      {!changes.length ? <EmptyState title="还没有变更或签证" description="新增记录后，可分别跟踪内部审批和外部确认凭证。" action={() => setCreating(true)} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>编号</th><th>名称 / 方向</th><th>发生日期</th><th className="align-right">内部送审</th><th className="align-right">内部核定</th><th>内部流程</th><th>外部凭证 / 状态</th><th>金额差异复核</th><th>操作</th></tr></thead><tbody>{changes.map((record) => <tr key={record.id}>
        <td><span className="budget-code">{record.code}</span></td>
        <td><strong className="table-primary-text">{record.name}</strong><small className="table-subtext">{record.direction === 'DECREASE' ? '减少合同额' : '增加合同额'} · {record.type === 'SITE_VISA' ? '现场签证' : record.type === 'OWNER_INSTRUCTION' ? '业主指令' : record.type === 'UNFORESEEN' ? '不可预见事项' : '工程变更'}</small><small className="table-subtext">主合同：{record.mainContract?.contractNo ?? '历史记录未关联主合同'}</small></td>
        <td>{formatDate(record.occurredAt)}</td>
        <td className="align-right numeric">{formatMoney(record.submittedAmount)}</td>
        <td className="align-right numeric">{record.approvedAmount == null ? '—' : formatMoney(record.approvedAmount)}</td>
        <td><StatusBadge status={record.status} /><small className="table-subtext">{record.internalApprovedById ? `审批：${formatDate(record.internalApprovedAt)}` : '内部流程状态'}</small></td>
        <td><span className={`status-badge ${externalStatusClass(record.externalConfirmationStatus)}`}><span className="status-dot" />{externalStatusLabel(record.externalConfirmationStatus)}</span><small className="table-subtext">{evidenceClassLabel(record.evidenceClass)}</small>{record.externalConfirmedAmount != null && <small className="table-subtext">外部金额：{formatMoney(record.externalConfirmedAmount)}{record.direction === 'DECREASE' ? '（扣减）' : ''}</small>}{record.evidenceFiles?.length > 0 && <div className="row-actions">{record.evidenceFiles.map((file) => <Button size="xs" variant="ghost" key={file.id} onClick={() => void downloadEvidence(record, file.id, file.fileName)} title={`SHA-256: ${file.sha256}`}><Download size={12} />{file.fileName}</Button>)}</div>}</td>
        <td>{record.internalAmountReviewStatus === 'PENDING' ? <span className="status-badge status-orange"><span className="status-dot" />待内部复核</span> : record.internalAmountReviewStatus === 'COMPLETED' ? <><span className="status-badge status-green"><span className="status-dot" />已复核</span>{record.internalAmountReviewCompletedAt && <small className="table-subtext">{formatDate(record.internalAmountReviewCompletedAt)}</small>}</> : <span className="table-subtext">—</span>}</td>
        <td><div className="row-actions">{getActions(record).map(({ label, run, danger, icon: Icon }) => <Button key={label} size="xs" variant={danger ? 'danger' : 'ghost'} disabled={updateStatus.isPending} onClick={run}><Icon size={13} />{label}</Button>)}</div></td>
      </tr>)}</tbody></table></div>}
    </section>
    <div className="data-note"><span className="note-mark">i</span><span>原始凭证文件以独立存储文件保存并记录 SHA-256；审计日志记录登记、核验及生效动作。补充协议状态仍需单独跟踪，不替代外部确认生效状态。</span></div>
    {creating && <ChangeCreateDialog projectId={projectId} onClose={() => setCreating(false)} />}
    {decision && <ChangeDecisionDialog record={decision} projectId={projectId} onClose={() => setDecision(null)} onNotice={setNotice} />}
    {externalRecord && <ExternalConfirmationDialog record={externalRecord} projectId={projectId} onClose={() => setExternalRecord(null)} onNotice={setNotice} />}
    {reviewRecord && <EvidenceReviewDialog record={reviewRecord} projectId={projectId} onClose={() => setReviewRecord(null)} onNotice={setNotice} />}
    {amountReviewRecord && <InternalAmountReviewDialog record={amountReviewRecord} projectId={projectId} onClose={() => setAmountReviewRecord(null)} onNotice={setNotice} />}
  </div>;
}
