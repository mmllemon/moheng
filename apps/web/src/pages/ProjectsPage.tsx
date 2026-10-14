import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Edit3, FolderPlus, MapPin, Plus, Search, Users2, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import type { Project, ProjectStatus } from '../types';
import { Button, currentDateInputValue, dateInputToIso, EmptyState, ErrorBlock, formatDate, formatWan, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';

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
      if (!project) navigate('/workspace/contracts');
    } catch (error) { setServerError(error instanceof ApiError ? error.message : '保存失败，请稍后重试'); }
  });

  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
      <div className="dialog-header"><div><span className="eyebrow">PROJECT PROFILE</span><h2 id="project-dialog-title">{project ? '编辑项目信息' : '新建项目'}</h2><p>{project ? '项目信息变更将记录在审计流水中。' : '先建立项目档案，再录入合同和目标成本。'}</p></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
      <form onSubmit={submit} noValidate>
        <div className="form-section-title"><span>01</span>基本信息</div>
        <div className="form-grid two-cols">
          <div className="field span-2"><label>项目名称 <b>*</b></label><input {...register('name')} placeholder="例如：滨江综合服务中心项目" />{errors.name && <small className="field-error">{errors.name.message}</small>}</div>
          <div className="field"><label>项目编号</label><input {...register('code')} placeholder="留空则自动生成 XM-年份-序号" />{errors.code && <small className="field-error">{errors.code.message}</small>}</div>
          <div className="field"><label>工程类型 <b>*</b></label><select {...register('type')}><option value="HOUSING">房屋建筑</option><option value="ROAD">道路桥梁</option><option value="MUNICIPAL">市政工程</option><option value="DECORATION">装饰装修</option><option value="MEP">机电安装</option><option value="OTHER">其他</option></select></div>
          <div className="field span-2"><label>业主单位 <b>*</b></label><input {...register('ownerName')} placeholder="业主或建设单位全称" />{errors.ownerName && <small className="field-error">{errors.ownerName.message}</small>}</div>
          <div className="field"><label>原始合同金额（元）<b>*</b></label><input type="number" min="0" step="0.01" readOnly={Boolean(project?.hasMainContract || project?.hasExternalConfirmation)} {...register('contractAmount')} />{errors.contractAmount && <small className="field-error">{errors.contractAmount.message}</small>}{Boolean(project?.hasMainContract || project?.hasExternalConfirmation) && <small className="field-hint">已建立正式主合同或登记外部确认，原始金额已锁定；调整请通过变更签证处理。</small>}</div>
          <div className="field"><label>项目状态</label><select {...register('status')}><option value="CONSTRUCTION">施工中</option><option value="SETTLEMENT_PENDING">待结算</option><option value="SETTLED">已结算</option><option value="PAUSED">已暂停</option></select></div>
          <div className="field"><label>开工日期 <b>*</b></label><input type="date" {...register('startDate')} />{errors.startDate && <small className="field-error">{errors.startDate.message}</small>}</div>
          <div className="field"><label>计划竣工日期</label><input type="date" {...register('plannedEndDate')} /></div>
          <div className="field"><label>项目经理</label><input {...register('managerName')} placeholder="姓名" /></div>
          <div className="field"><label>项目地址</label><input {...register('address')} placeholder="工程所在地" /></div>
        </div>
        {serverError && <div className="form-alert">{serverError}</div>}
        <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? '正在保存…' : project ? '保存修改' : '创建项目并继续'}</Button></div>
      </form>
    </div>
  </div>;
}

const statuses: { value: string; label: string }[] = [{ value: 'ALL', label: '全部状态' }, { value: 'CONSTRUCTION', label: '施工中' }, { value: 'SETTLEMENT_PENDING', label: '待结算' }, { value: 'SETTLED', label: '已结算' }, { value: 'PAUSED', label: '已暂停' }];

export default function ProjectsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [dialog, setDialog] = useState<{ open: boolean; project?: Project }>({ open: false });
  const filtered = useMemo(() => (projectsQuery.data ?? []).filter((project) => {
    const matchQ = !q || `${project.name} ${project.code} ${project.ownerName}`.toLowerCase().includes(q.toLowerCase());
    return matchQ && (status === 'ALL' || project.status === status);
  }), [projectsQuery.data, q, status]);

  if (projectsQuery.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (projectsQuery.error) return <div className="page-wrap"><ErrorBlock message={(projectsQuery.error as Error).message} retry={() => void projectsQuery.refetch()} /></div>;

  return <div className="page-wrap">
    <PageHeader eyebrow="WORKSPACE / PROJECTS" title="项目管理" subtitle="管理施工项目基本信息与项目经营上下文。" actions={<Button onClick={() => setDialog({ open: true })}><Plus size={16} />新建项目</Button>} />
    <div className="list-toolbar"><div className="toolbar-search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索项目名称、编号或业主单位" /></div><select className="toolbar-select" value={status} onChange={(e) => setStatus(e.target.value)}>{statuses.map((s) => <option value={s.value} key={s.value}>{s.label}</option>)}</select><span className="results-count">共 {filtered.length} 个项目</span></div>
    {filtered.length === 0 ? <EmptyState title={projectsQuery.data?.length ? '没有符合条件的项目' : '项目列表还是空的'} description={projectsQuery.data?.length ? '请更换关键词或筛选状态。' : '新建项目后，可以继续维护合同、目标成本和实际成本记录。'} action={() => setDialog({ open: true })} /> : <div className="project-list-grid">{filtered.map((project, index) => <article className="project-list-card" key={project.id}>
      <div className="project-list-card-head"><span className={`project-monogram monogram-${index % 4}`}>{project.name.slice(0, 1)}</span><StatusBadge status={project.status} /><button className="icon-button card-edit-button" title="编辑项目" onClick={() => setDialog({ open: true, project })}><Edit3 size={16} /></button></div>
      <h3>{project.name}</h3><div className="project-list-code">{project.code}</div>
      <div className="project-list-owner"><Users2 size={14} />{project.ownerPartyId ? <Link to={`/parties/${project.ownerPartyId}`}>{project.ownerName} ↗</Link> : <span>{project.ownerName}</span>}</div>
      <div className="project-list-details"><div><span>当前有效合同额</span><strong>{formatWan(project.contractAmount)}</strong></div><div><span>项目经理</span><strong>{project.managerName || '未填写'}</strong></div></div>
      <div className="project-list-meta"><span><CalendarDays size={13} />开工 {formatDate(project.startDate)}</span><span><MapPin size={13} />{project.address || '未填写地址'}</span></div>
      <div className="project-card-actions"><Button variant="secondary" onClick={() => { setSelectedProjectId(project.id); navigate('/workspace'); }}>项目驾驶舱</Button><Button onClick={() => { setSelectedProjectId(project.id); navigate('/workspace'); }}>进入工作台 <FolderPlus size={14} /></Button></div>
    </article>)}</div>}
    {dialog.open && <ProjectDialog project={dialog.project} onClose={() => { setDialog({ open: false }); void queryClient.invalidateQueries({ queryKey: ['projects'] }); }} />}
  </div>;
}
