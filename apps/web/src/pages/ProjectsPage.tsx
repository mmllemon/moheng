import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import BusinessPartyPicker from '../components/BusinessPartyPicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Edit3, FolderPlus, Plus, Search, Users2, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import type { Project } from '../types';
import { Button, currentDateInputValue, dateInputToIso, EmptyState, ErrorBlock, formatDate, formatMoney, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';
import '../styles/projects-ledger.css';

const schema = z.object({
  name: z.string().trim().min(2, '项目名称至少 2 个字符'),
  code: z.string().trim().max(40).regex(/^[A-Za-z0-9_-]+$/, '只支持字母、数字、下划线和短横线').optional().or(z.literal('')),
  type: z.string().min(1, '请选择工程类型'),
  ownerName: z.string().trim().min(1, '请填写业主单位'),
  ownerPartyId: z.string().optional(),
  contractAmount: z.coerce.number().min(0, '合同金额不能小于 0'),
  startDate: z.string().min(1, '请选择开工日期'),
  plannedEndDate: z.string().optional(),
  address: z.string().optional(),
  managerName: z.string().optional(),
  status: z.enum(['CONSTRUCTION', 'SETTLEMENT_PENDING', 'SETTLED', 'PAUSED']),
});
type FormValues = z.infer<typeof schema>;

function dateValue(value?: string | null) { return value ? new Date(value).toISOString().slice(0, 10) : ''; }
function ProjectDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const queryClient = useQueryClient();
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const closeWithMotion = () => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 190);
  };
  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: project ? {
      name: project.name, code: project.code, type: project.type, ownerName: project.ownerName, ownerPartyId: project.ownerPartyId ?? '',
      contractAmount: project.originalContractAmount ?? project.contractAmount, startDate: dateValue(project.startDate), plannedEndDate: dateValue(project.plannedEndDate),
      address: project.address ?? '', managerName: project.managerName ?? '', status: project.status,
    } : {
      name: '', code: '', type: 'HOUSING', ownerName: '', ownerPartyId: '',
      contractAmount: 0, startDate: currentDateInputValue(), plannedEndDate: '', address: '', managerName: '', status: 'CONSTRUCTION',
    },
  });
  const submit = handleSubmit(async (values) => {
    setServerError('');
    const body = {
      ...values,
      startDate: dateInputToIso(values.startDate),
      plannedEndDate: values.plannedEndDate ? dateInputToIso(values.plannedEndDate) : null,
      address: values.address || null, managerName: values.managerName || null, ownerPartyId: values.ownerPartyId || null,
    };
    try {
      const saved = project ? await api.patch<Project>(`/projects/${project.id}`, body) : await api.post<Project>('/projects', body);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['business-parties'] });
      await queryClient.invalidateQueries({ queryKey: ['business-party-lookup'] });
      await queryClient.invalidateQueries({ queryKey: ['business-party-detail'] });
      if (!project) setSelectedProjectId(saved.id);
      onClose();
      if (!project) navigate('/cost/contracts');
    } catch (error) { setServerError(error instanceof ApiError ? error.message : '保存失败，请稍后重试'); }
  });

  return <div className={`modal-backdrop project-modal-backdrop ${closing ? 'is-closing' : ''}`} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closeWithMotion(); }}>
    <div className={`dialog project-dialog ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
      <div className="dialog-header"><div><span className="eyebrow">PROJECT PROFILE</span><h2 id="project-dialog-title">{project ? '编辑项目信息' : '新建项目'}</h2><p>{project ? '项目信息变更将记录在审计流水中。' : '先建立项目档案，再录入合同和目标成本。'}</p></div><button className="icon-button" onClick={closeWithMotion} aria-label="关闭"><X size={18} /></button></div>
      <form onSubmit={submit} noValidate>
        <div className="form-section-title"><span>01</span>基本信息</div>
        <div className="form-grid two-cols">
          <div className="field span-2"><label>项目名称 <b>*</b></label><input {...register('name')} placeholder="例如：滨江综合服务中心项目" />{errors.name && <small className="field-error">{errors.name.message}</small>}</div>
          <div className="field"><label>项目编号</label><input {...register('code')} placeholder="留空则自动生成 XM-年份-序号" />{errors.code && <small className="field-error">{errors.code.message}</small>}</div>
          <div className="field"><label>工程类型 <b>*</b></label><SelectField {...register('type')}><option value="HOUSING">房屋建筑</option><option value="ROAD">道路桥梁</option><option value="MUNICIPAL">市政工程</option><option value="DECORATION">装饰装修</option><option value="MEP">机电安装</option><option value="OTHER">其他</option></SelectField></div>
          <div className="field span-2"><BusinessPartyPicker label="业主单位" required value={watch('ownerPartyId') || null} name={watch('ownerName') || ''} roles={['OWNER']} onChange={(id, name) => { setValue('ownerPartyId', id ?? '', { shouldValidate: true, shouldDirty: true }); setValue('ownerName', name, { shouldValidate: true, shouldDirty: true }); }} />{errors.ownerName && <small className="field-error">{errors.ownerName.message}</small>}</div>
          <div className="field"><label>原始合同金额（元）<b>*</b></label><input type="number" min="0" step="0.01" readOnly={Boolean(project?.hasMainContract || project?.hasExternalConfirmation)} {...register('contractAmount')} />{errors.contractAmount && <small className="field-error">{errors.contractAmount.message}</small>}{Boolean(project?.hasMainContract || project?.hasExternalConfirmation) && <small className="field-hint">已建立正式主合同或登记外部确认，原始金额已锁定；调整请通过变更签证处理。</small>}</div>
          <div className="field"><label>项目状态</label><SelectField {...register('status')}><option value="CONSTRUCTION">施工中</option><option value="SETTLEMENT_PENDING">待结算</option><option value="SETTLED">已结算</option><option value="PAUSED">已暂停</option></SelectField></div>
          <div className="field"><label>开工日期 <b>*</b></label><DatePicker {...register('startDate')} />{errors.startDate && <small className="field-error">{errors.startDate.message}</small>}</div>
          <div className="field"><label>计划竣工日期</label><DatePicker {...register('plannedEndDate')} /></div>
          <div className="field"><label>项目经理</label><input {...register('managerName')} placeholder="姓名" /></div>
          <div className="field"><label>项目地址</label><input {...register('address')} placeholder="工程所在地" /></div>
        </div>
        {serverError && <div className="form-alert">{serverError}</div>}
        <div className="dialog-footer"><Button variant="secondary" onClick={closeWithMotion}>取消</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? '正在保存…' : project ? '保存修改' : '创建项目并继续'}</Button></div>
      </form>
    </div>
  </div>;
}

type ProjectDashboardSnapshot = {
  projects: Array<Project & { targetCost: number; actualCost: number; receivedAmount: number; costVarianceAmount: number | null; recoveryRatio: number | null }>;
  pendingChanges: Array<{ projectId: string; id: string }> ;
};

const statuses: { value: string; label: string }[] = [{ value: 'ALL', label: '全部状态' }, { value: 'CONSTRUCTION', label: '施工中' }, { value: 'SETTLEMENT_PENDING', label: '待结算' }, { value: 'SETTLED', label: '已结算' }, { value: 'PAUSED', label: '已暂停' }];
const projectTypes: Record<string, string> = { HOUSING: '房屋建筑', ROAD: '道路桥梁', MUNICIPAL: '市政工程', DECORATION: '装饰装修', MEP: '机电安装', OTHER: '其他' };

export default function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<ProjectDashboardSnapshot>('/dashboard') });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [dialog, setDialog] = useState<{ open: boolean; project?: Project }>({ open: false });
  const projects = projectsQuery.data ?? [];
  const projectMap = useMemo(() => new Map((dashboardQuery.data?.projects ?? []).map((project) => [project.id, project])), [dashboardQuery.data?.projects]);
  const pendingChangeCounts = useMemo(() => { const counts = new Map<string, number>(); for (const change of dashboardQuery.data?.pendingChanges ?? []) counts.set(change.projectId, (counts.get(change.projectId) ?? 0) + 1); return counts; }, [dashboardQuery.data?.pendingChanges]);
  const totalContractAmount = projects.reduce((sum, project) => sum + Number(project.contractAmount || 0), 0);
  const constructionCount = projects.filter((project) => project.status === 'CONSTRUCTION').length;
  const settlementCount = projects.filter((project) => project.status === 'SETTLEMENT_PENDING').length;
  const filtered = useMemo(() => projects.filter((project) => {
    const matchQ = !q || `${project.name} ${project.code} ${project.ownerName}`.toLowerCase().includes(q.toLowerCase());
    return matchQ && (status === 'ALL' || project.status === status);
  }), [projects, q, status]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!filtered.length) return;
    setSelectedId((current) => current && filtered.some((project) => project.id === current) ? current : filtered[0]!.id);
  }, [filtered]);
  const selected = filtered.find((project) => project.id === selectedId) ?? filtered[0] ?? null;
  const selectedSnapshot = selected ? projectMap.get(selected.id) : undefined;


  if (projectsQuery.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (projectsQuery.error) return <div className="page-wrap"><ErrorBlock message={(projectsQuery.error as Error).message} retry={() => void projectsQuery.refetch()} /></div>;

  return <div className="page-wrap projects-page projects-ledger-page">
    <PageHeader eyebrow="WORKSPACE / PROJECTS" title="项目管理" subtitle="先判断项目经营状态，再进入具体合同、目标成本、成本与结算工作。" actions={<Button onClick={() => setDialog({ open: true })}><Plus size={16} />新建项目</Button>} />

    <section className="projects-kpi-strip" aria-label="项目组合摘要">
      <div><span>可访问项目</span><strong>{projects.length}</strong><small>当前账号可管理范围</small></div>
      <div><span>施工中</span><strong>{constructionCount}</strong><small>正在实施的项目</small></div>
      <div><span>待结算</span><strong>{settlementCount}</strong><small>需关注结算与收款</small></div>
      <div><span>当前有效合同额合计</span><strong>{formatMoney(totalContractAmount, 0)}</strong><small>含符合规则已生效的合同调整</small></div>
    </section>

    <div className="projects-toolbar">
      <div className="toolbar-search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索项目名称、编号或业主单位" aria-label="搜索项目" /></div>
      <SelectField className="toolbar-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="按项目状态筛选">{statuses.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</SelectField>
      <span className="results-count">显示 <strong>{filtered.length}</strong> / {projects.length} 个项目</span>
    </div>

    {filtered.length === 0 ? <EmptyState title={projects.length ? '没有符合条件的项目' : '项目列表还是空的'} description={projects.length ? '请更换关键词或筛选状态。' : '新建项目档案后，可以继续维护合同、目标成本和实际成本记录。'} action={() => setDialog({ open: true })} /> : <div className="projects-ledger-layout">
      <section className="projects-ledger" aria-label="项目台账">
        <div className="projects-ledger-head"><div><h2>项目台账</h2><p>按合同额排序 · 选择一行查看右侧项目档案</p></div><span>{filtered.length} 个项目</span></div>
        <div className="table-scroll"><table className="data-table projects-table"><thead><tr><th>项目</th><th>状态</th><th>业主</th><th className="align-right">合同额</th><th className="align-right">目标成本</th><th className="align-right">已发生</th><th className="align-right">回款率</th></tr></thead><tbody>{filtered.map((project) => {
          const snapshot = projectMap.get(project.id);
          const pendingChanges = pendingChangeCounts.get(project.id) ?? 0;
          const targetCost = snapshot?.targetCost;
          const actualCost = snapshot?.actualCost;
          const recoveryRatio = snapshot?.recoveryRatio;
          return <tr key={project.id} className={selected?.id === project.id ? 'is-selected' : ''} tabIndex={0} aria-selected={selected?.id === project.id} onClick={() => setSelectedId(project.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(project.id); } }}>
            <td><strong className="table-primary-text">{project.name}</strong><small className="table-subtext">{project.code}{pendingChanges > 0 ? ' · ' + pendingChanges + ' 项待跟进' : ''}</small></td>
            <td><StatusBadge status={project.status} /></td>
            <td><span className="projects-owner-cell">{project.ownerPartyId ? <Link to={'/parties/' + project.ownerPartyId}>{project.ownerName} ↗</Link> : project.ownerName}</span></td>
            <td className="align-right numeric">{formatMoney(project.contractAmount, 0)}</td>
            <td className="align-right numeric">{snapshot ? (targetCost && targetCost > 0 ? formatMoney(targetCost, 0) : '未建立') : '—'}</td>
            <td className="align-right numeric">{snapshot ? formatMoney(actualCost ?? 0, 0) : '—'}</td>
            <td className="align-right numeric">{recoveryRatio == null ? '—' : (recoveryRatio * 100).toFixed(1) + '%'}</td>
          </tr>;
        })}</tbody></table></div>
      </section>

      {selected && <aside className="projects-dossier" aria-label="当前项目档案">
        <div className="projects-dossier-head">
          <div><span className="eyebrow">PROJECT DOSSIER</span><h2>{selected.name}</h2><p>{selected.code} · {selected.ownerName}</p></div>
          <div className="projects-dossier-tools"><StatusBadge status={selected.status} /><button type="button" className="icon-button" title="编辑项目档案" aria-label={'编辑' + selected.name} onClick={() => setDialog({ open: true, project: selected })}><Edit3 size={15} /></button></div>
        </div>
        <div className="projects-dossier-facts">
          <div><span>工程类型</span><strong>{projectTypes[selected.type] ?? selected.type}</strong></div>
          <div><span>项目经理</span><strong>{selected.managerName || '待指定'}</strong></div>
          <div><span>开工日期</span><strong>{formatDate(selected.startDate)}</strong></div>
          <div><span>计划竣工</span><strong>{formatDate(selected.plannedEndDate)}</strong></div>
          <div><span>项目地址</span><strong>{selected.address || '未填写'}</strong></div>
          <div><span>项目成员</span><strong>按项目单独授权</strong></div>
        </div>
        <div className="projects-dossier-finance">
          <div><span>当前有效合同额</span><strong>{formatMoney(selected.contractAmount, 0)}</strong><small>{selected.originalContractAmount != null && Math.abs(selected.contractAmount - selected.originalContractAmount) > 0.009 ? '原始 ' + formatMoney(selected.originalContractAmount, 0) + ' · 已含调整' : '按当前有效合同台账口径'}</small></div>
          <div><span>目标成本</span><strong>{selectedSnapshot ? (selectedSnapshot.targetCost > 0 ? formatMoney(selectedSnapshot.targetCost, 0) : '未建立基线') : '—'}</strong><small>{selected.budgetItemCount != null ? '清单 ' + selected.budgetItemCount + ' 项' : '目标成本清单'}</small></div>
          <div><span>实际成本</span><strong>{selectedSnapshot ? formatMoney(selectedSnapshot.actualCost ?? 0, 0) : '—'}</strong><small>{selected.costEntryCount != null ? '成本记录 ' + selected.costEntryCount + ' 条' : '已归集记录'}</small></div>
          <div><span>成本余量</span><strong>{selectedSnapshot && selectedSnapshot.targetCost > 0 ? formatMoney(selectedSnapshot.targetCost - (selectedSnapshot.actualCost ?? 0), 0) : '—'}</strong><small>目标减已发生，不是利润</small></div>
        </div>
        <div className="projects-dossier-ratio">
          <div><span>成本使用率</span><strong>{selectedSnapshot && selectedSnapshot.targetCost > 0 ? ((selectedSnapshot.actualCost ?? 0) / selectedSnapshot.targetCost * 100).toFixed(1) + '%' : '—'}</strong></div>
          <div className="projects-ratio-track"><i style={{ width: selectedSnapshot && selectedSnapshot.targetCost > 0 ? Math.min(100, Math.max(0, (selectedSnapshot.actualCost ?? 0) / selectedSnapshot.targetCost * 100)) + '%' : '0%' }} /></div>
          <div className="projects-dossier-ratio-foot"><span>实际 / 目标</span><span>回款率 {selectedSnapshot?.recoveryRatio == null ? '—' : (selectedSnapshot.recoveryRatio * 100).toFixed(1) + '%'}</span></div>
        </div>
        <div className="projects-dossier-note"><CircleAlert size={14} /><span>{pendingChangeCounts.get(selected.id) ? pendingChangeCounts.get(selected.id) + ' 项变更待跟进；进入成本工作台处理。' : '当前没有待跟进变更；目标成本与实际成本按项目独立归集。'}</span></div>
        <div className="projects-dossier-actions"><Button onClick={() => { setSelectedProjectId(selected.id); navigate('/cost'); }}><FolderPlus size={14} />进入驾驶舱</Button><Button variant="secondary" onClick={() => { setSelectedProjectId(selected.id); navigate('/projects/members'); }}><Users2 size={14} />项目成员</Button></div>
      </aside>}
    </div>}

    {dialog.open && <ProjectDialog project={dialog.project} onClose={() => { setDialog({ open: false }); void queryClient.invalidateQueries({ queryKey: ['projects'] }); void queryClient.invalidateQueries({ queryKey: ['dashboard'] }); }} />}
  </div>;
}
