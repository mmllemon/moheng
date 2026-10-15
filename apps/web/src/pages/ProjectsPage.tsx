import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Banknote, CalendarDays, CircleAlert, Coins, Edit3, FolderKanban, FolderPlus, MapPin, Plus, Search, Users2, Wallet, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import type { Project } from '../types';
import { Button, currentDateInputValue, dateInputToIso, EmptyState, ErrorBlock, formatDate, formatMoney, formatWan, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';

const schema = z.object({
  name: z.string().trim().min(2, '项目名称至少 2 个字符'),
  code: z.string().trim().max(40).regex(/^[A-Za-z0-9_-]+$/, '只支持字母、数字、下划线和短横线').optional().or(z.literal('')),
  type: z.string().min(1, '请选择工程类型'),
  ownerName: z.string().trim().min(1, '请填写业主单位'),
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
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: project ? {
      name: project.name, code: project.code, type: project.type, ownerName: project.ownerName,
      contractAmount: project.originalContractAmount ?? project.contractAmount, startDate: dateValue(project.startDate), plannedEndDate: dateValue(project.plannedEndDate),
      address: project.address ?? '', managerName: project.managerName ?? '', status: project.status,
    } : {
      name: '', code: '', type: 'HOUSING', ownerName: '',
      contractAmount: 0, startDate: currentDateInputValue(), plannedEndDate: '', address: '', managerName: '', status: 'CONSTRUCTION',
    },
  });
  const submit = handleSubmit(async (values) => {
    setServerError('');
    const body = {
      ...values,
      startDate: dateInputToIso(values.startDate),
      plannedEndDate: values.plannedEndDate ? dateInputToIso(values.plannedEndDate) : null,
      address: values.address || null, managerName: values.managerName || null,
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
          <div className="field span-2"><label>业主单位 <b>*</b></label><input {...register('ownerName')} placeholder="业主或建设单位全称" />{errors.ownerName && <small className="field-error">{errors.ownerName.message}</small>}</div>
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

  if (projectsQuery.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (projectsQuery.error) return <div className="page-wrap"><ErrorBlock message={(projectsQuery.error as Error).message} retry={() => void projectsQuery.refetch()} /></div>;

  return <div className="page-wrap projects-page">
    <PageHeader eyebrow="WORKSPACE / PROJECTS" title="项目管理" subtitle="先判断项目经营状态，再进入具体合同、目标成本、成本与结算工作。" actions={<Button onClick={() => setDialog({ open: true })}><Plus size={16} />新建项目</Button>} />
    <section className="project-management-kpis" aria-label="项目组合摘要">
      <article className="project-management-kpi"><span className="project-management-kpi-icon"><FolderKanban size={16} /></span><div><small>可访问项目</small><strong>{projects.length}</strong><span>当前账号可管理范围</span></div></article>
      <article className="project-management-kpi"><span className="project-management-kpi-icon tone-jade"><Activity size={16} /></span><div><small>施工中</small><strong>{constructionCount}</strong><span>正在实施的项目</span></div></article>
      <article className="project-management-kpi"><span className="project-management-kpi-icon tone-amber"><CircleAlert size={16} /></span><div><small>待结算</small><strong>{settlementCount}</strong><span>需关注结算与收款</span></div></article>
      <article className="project-management-kpi project-management-kpi-contract"><span className="project-management-kpi-icon tone-blue"><Banknote size={16} /></span><div><small>当前有效合同额合计</small><strong>{formatWan(totalContractAmount)}</strong><span>含符合规则已生效的合同调整</span></div></article>
    </section>
    <div className="project-list-toolbar">
      <div className="toolbar-search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索项目名称、编号或业主单位" aria-label="搜索项目" /></div>
      <SelectField className="toolbar-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="按项目状态筛选">{statuses.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</SelectField>
      <span className="results-count">显示 <strong>{filtered.length}</strong> / {projects.length} 个项目</span>
    </div>
    {filtered.length === 0 ? <EmptyState title={projects.length ? '没有符合条件的项目' : '项目列表还是空的'} description={projects.length ? '请更换关键词或筛选状态。' : '新建项目档案后，可以继续维护合同、目标成本和实际成本记录。'} action={() => setDialog({ open: true })} /> : <div className="project-list-grid">{filtered.map((project, index) => {
      const snapshot = projectMap.get(project.id);
      const pendingChanges = pendingChangeCounts.get(project.id);
      const targetCost = snapshot?.targetCost;
      const actualCost = snapshot?.actualCost;
      const receivedAmount = snapshot?.receivedAmount;
      const costRatio = targetCost != null && targetCost > 0 && actualCost != null ? actualCost / targetCost : null;
      const recoveryRatio = snapshot?.recoveryRatio;
      const variance = snapshot?.costVarianceAmount;
      const originalAmount = project.originalContractAmount;
      const changeAmount = originalAmount != null ? project.contractAmount - originalAmount : null;
      return <article className="project-list-card" key={project.id} style={{ '--card-index': index } as CSSProperties}>
        <div className="project-list-card-head"><span className={`project-monogram monogram-${index % 4}`}>{project.name.slice(0, 1)}</span><StatusBadge status={project.status} /><span className="project-card-spacer" />{pendingChanges != null && pendingChanges > 0 && <span className="project-risk-indicator"><i />{pendingChanges} 项待跟进</span>}<button className="icon-button card-edit-button" title="编辑项目档案" aria-label={`编辑${project.name}`} onClick={() => setDialog({ open: true, project })}><Edit3 size={16} /></button></div>
        <div className="project-card-title-row"><div><h3>{project.name}</h3><div className="project-list-code">{project.code}</div></div><button type="button" className="project-open-icon" aria-label={`进入${project.name}的成本工作台`} title="进入成本工作台" onClick={() => { setSelectedProjectId(project.id); navigate('/cost'); }}><FolderPlus size={16} /></button></div>
        <div className="project-list-owner"><Users2 size={14} />{project.ownerPartyId ? <Link to={`/parties/${project.ownerPartyId}`}>{project.ownerName} ↗</Link> : <span>{project.ownerName}</span>}</div>
        <section className="project-card-contract-hero"><div><span>当前有效合同额</span><strong>{formatWan(project.contractAmount)}</strong></div>{changeAmount != null && Math.abs(changeAmount) > 0.009 && <span className={`project-change-chip ${changeAmount > 0 ? 'is-up' : 'is-down'}`}>{changeAmount > 0 ? '+' : '−'}{formatWan(Math.abs(changeAmount))}</span>}<small>{originalAmount != null ? `原始合同额 ${formatWan(originalAmount)}` : '按当前有效合同台账口径统计'}</small></section>
        <div className="project-card-metrics-grid">
          <div className="project-card-operating-metric"><span><Coins size={13} />目标成本</span><strong>{snapshot ? (targetCost && targetCost > 0 ? formatWan(targetCost) : '未建立基线') : '—'}</strong></div>
          <div className="project-card-operating-metric"><span><Activity size={13} />实际成本</span><strong>{snapshot ? formatWan(actualCost ?? 0) : '加载中…'}</strong></div>
          <div className="project-card-operating-metric"><span><Wallet size={13} />累计已收款</span><strong>{snapshot ? formatWan(receivedAmount ?? 0) : '加载中…'}</strong></div>
          <div className="project-card-operating-metric"><span><CircleAlert size={13} />成本偏差</span><strong className={variance != null && variance > 0 ? 'text-danger' : variance != null && variance < 0 ? 'text-success' : ''}>{snapshot ? (variance == null ? '—' : `${variance > 0 ? '+' : ''}${formatWan(variance)}`) : '—'}</strong></div>
        </div>
        <div className="project-card-ratios">
          <div className="project-card-ratio-head"><span>成本使用率</span><b className={costRatio != null && costRatio > 1 ? 'text-danger' : ''}>{costRatio == null ? '—' : `${(costRatio * 100).toFixed(1)}%`}</b></div>
          <div className="project-card-progress"><span className={costRatio != null && costRatio > 1 ? 'is-over' : ''} style={{ width: `${costRatio == null ? 0 : Math.min(100, Math.max(0, costRatio * 100))}%` }} /></div>
          <div className="project-card-ratio-foot"><span>实际成本 / 目标成本</span><span>回款率 {recoveryRatio == null ? '—' : `${(recoveryRatio * 100).toFixed(1)}%`}</span></div>
        </div>
        <div className="project-list-meta"><span><CalendarDays size={13} />开工 {formatDate(project.startDate)}</span><span><MapPin size={13} />{project.address || '未填写地址'}</span></div>
        <div className="project-card-manager-row"><span>项目经理</span><strong>{project.managerName || '待指定'}</strong>{project.plannedEndDate && <><span className="project-manager-separator" /><span>计划竣工</span><strong>{formatDate(project.plannedEndDate)}</strong></>}</div>
        <div className="project-card-health-foot"><span>{pendingChanges != null ? <><i className={pendingChanges > 0 ? 'has-pending' : ''} />{pendingChanges > 0 ? `${pendingChanges} 项变更待跟进` : '无待跟进变更'}</> : <><i />经营摘要加载中</>}</span><span>{project.budgetItemCount != null ? `预算清单 ${project.budgetItemCount} 项` : '目标成本台账'}{project.costEntryCount != null ? ` · 成本记录 ${project.costEntryCount} 条` : ''}</span></div>
        <div className="project-card-actions"><Button variant="secondary" onClick={() => { setSelectedProjectId(project.id); navigate('/cost'); }}>查看驾驶舱</Button><Button onClick={() => { setSelectedProjectId(project.id); navigate('/cost'); }}>进入成本工作台 <FolderPlus size={14} /></Button></div>
      </article>;
    })}</div>}
    {dialog.open && <ProjectDialog project={dialog.project} onClose={() => { setDialog({ open: false }); void queryClient.invalidateQueries({ queryKey: ['projects'] }); void queryClient.invalidateQueries({ queryKey: ['dashboard'] }); }} />}
  </div>;
}
