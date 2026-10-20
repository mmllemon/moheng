import DatePicker from '../components/DatePicker';
import SelectField from '../components/SelectField';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, CircleAlert, ClipboardCheck, Download, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore, useUiStore } from '../auth-store';
import { Button, EmptyState, ErrorBlock, formatMoney, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';
import type { Project } from '../types';

type PortfolioProject = Project & {
  targetCost: number;
  actualCost: number;
  receivedAmount: number;
  costVarianceAmount: number | null;
  recoveryRatio: number | null;
};
type DashboardData = {
  totals: { projectCount: number; contractAmount: number; targetCost: number; actualCost: number; receivedAmount: number };
  projects: PortfolioProject[];
  pendingChanges: { id: string; projectId: string; projectName: string; code: string; name: string; status: string; submittedAmount: number }[];
  recentActivities: { id: string; action: string; entity: string; entityId: string; actor: string; projectName: string; createdAt: string }[];
};

const activityLabel: Record<string, string> = { CREATE: '新增记录', UPDATE: '更新资料', UPSERT: '更新合同', STATUS_CHANGE: '状态变更', PAYMENT_REGISTERED: '登记到账', IMPORT_CSV: '批量导入', ARCHIVE: '归档记录', PAYMENT_RECORDED: '登记付款', PAYMENT_REFUND_RECORDED: '登记退款', ASSISTANT_CONVERSATION_CREATED: '创建分析会话', ASSISTANT_RUN_STARTED: '发起分析', ASSISTANT_RUN_COMPLETED: '完成分析', REPORT_STUDIO_TEMPLATE_CREATED: '创建报表模板', REPORT_STUDIO_TEMPLATE_UPDATED: '更新报表模板', OWNER_ADVANCE_RECEIVED: '登记预付款到账', OWNER_SETTLEMENT_DRAFT_CREATED: '创建竣工结算草稿', OWNER_SETTLEMENT_CONFIRMED: '确认竣工结算', OWNER_RECEIPT_REGISTERED: '登记业主到账' };
const sortLabels = { contract: '合同额', remain: '成本余量', recovery: '回款率' } as const;
type SortKey = keyof typeof sortLabels;

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function downloadCsv(rows: Array<Array<string | number>>, filename: string) {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const currentUser = useAuthStore((state) => state.user);
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard') });
  const [sortKey, setSortKey] = useState<SortKey>('contract');
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const data = dashboard.data;
  const sortedProjects = useMemo(() => [...(data?.projects ?? [])].sort((a, b) => {
    if (sortKey === 'contract') return b.contractAmount - a.contractAmount;
    if (sortKey === 'remain') return (b.targetCost - b.actualCost) - (a.targetCost - a.actualCost);
    return (b.recoveryRatio ?? 0) - (a.recoveryRatio ?? 0);
  }), [data?.projects, sortKey]);

  if (dashboard.isLoading) return <div className="page-wrap"><LoadingBlock label="正在汇总全部可访问项目…" /></div>;
  if (dashboard.error) return <div className="page-wrap"><ErrorBlock message={(dashboard.error as Error).message} retry={() => void dashboard.refetch()} /></div>;

  const totals = data!.totals;
  const constructionCount = data!.projects.filter((project) => project.status === 'CONSTRUCTION').length;
  const settlementCount = data!.projects.filter((project) => project.status === 'SETTLEMENT_PENDING').length;
  const pausedCount = data!.projects.filter((project) => project.status === 'PAUSED').length;
  const costRatio = totals.targetCost > 0 ? totals.actualCost / totals.targetCost : null;
  const recoveryRatio = totals.contractAmount > 0 ? totals.receivedAmount / totals.contractAmount : null;
  const costRemaining = totals.targetCost - totals.actualCost;
  const pct = costRatio == null ? 0 : Math.max(0, Math.min(100, costRatio * 100));
  const asOf = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; })();
  const logActivities = data!.recentActivities.filter((activity) => activity.createdAt.slice(0, 10) === logDate);

  const exportMonth = () => {
    const rows: Array<Array<string | number>> = [
      ['经营月报', asOf],
      ['项目', '编号', '状态', '合同额', '目标成本', '已发生', '成本余量', '回款率'],
      ...data!.projects.map((project) => [project.name, project.code, project.status, project.contractAmount, project.targetCost, project.actualCost, project.targetCost - project.actualCost, project.recoveryRatio == null ? '' : `${(project.recoveryRatio * 100).toFixed(1)}%`]),
      ['合计', '', '', totals.contractAmount, totals.targetCost, totals.actualCost, costRemaining, recoveryRatio == null ? '' : `${(recoveryRatio * 100).toFixed(1)}%`],
    ];
    downloadCsv(rows, `经营月报-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return <div className="page-wrap overview-page">
    <PageHeader
      title="经营总览"
      context={<><span className="page-context-dot" /><span>全公司</span><span>·</span><span>{totals.projectCount} 个项目</span><span>·</span><span>数据截至 {asOf}</span></>}
      actions={<><Button variant="secondary" onClick={exportMonth}><Download size={15} />导出月报</Button><Button onClick={() => navigate('/projects')}><Plus size={15} />新建项目</Button></>}
    />
    {data!.projects.length === 0 ? <EmptyState title="还没有可访问的项目" description="创建项目或请管理员为你的账号分配项目权限。" action={() => navigate('/projects')} /> : <>
      <section className="v6-hero" aria-label="组合概况">
        <div className="v6-hero-main">
          <span className="v6-label">当前有效合同额</span>
          <strong className="v6-hero-num"><span className="cur">¥</span>{formatMoney(totals.contractAmount, 0).replace('¥', '')}</strong>
          <div className="v6-hero-sub">{constructionCount} 个在施 · {settlementCount} 个待结算 · {pausedCount} 个暂停；合同额按有效台账汇总</div>
          <div className="v6-ruler">
            <div className="v6-ruler-head"><span>成本执行</span><b>{costRatio == null ? '—' : `${(costRatio * 100).toFixed(1)}%`}</b><span className="v6-ruler-note">已发生 {formatMoney(totals.actualCost, 0)} / 目标 {formatMoney(totals.targetCost, 0)}</span></div>
            <div className="v6-ruler-track"><span className="v6-ruler-fill" style={{ width: `${pct}%` }} /><i className="v6-ruler-pin" style={{ left: `${pct}%` }} />{[0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100].map((tick) => <i key={tick} className={tick % 25 === 0 ? 'is-major' : ''} style={{ left: `${tick}%` }} />)}</div>
            <div className="v6-ruler-labels"><span>0</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
          </div>
        </div>
        <dl className="v6-stats">
          <div><dt>目标成本</dt><dd>{formatMoney(totals.targetCost, 0)}</dd></div>
          <div><dt>累计回款</dt><dd>{formatMoney(totals.receivedAmount, 0)}<span>{recoveryRatio == null ? '' : `${(recoveryRatio * 100).toFixed(1)}%`}</span></dd></div>
          <div><dt>成本余量</dt><dd>{formatMoney(costRemaining, 0)}</dd></div>
          <div><dt>在施项目</dt><dd>{constructionCount} 个<span>待结算 {settlementCount}</span></dd></div>
        </dl>
      </section>

      <div className="v6-split">
        <section className="v6-block" aria-label="项目台账">
          <div className="v6-block-head"><div><h2>项目台账</h2><span>按{sortLabels[sortKey]}排序</span></div><div className="ov-head-tools"><label className="ov-sort">排序<SelectField value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} aria-label="项目排序">{(Object.keys(sortLabels) as SortKey[]).map((key) => <option key={key} value={key}>{sortLabels[key]}</option>)}</SelectField></label><button type="button" className="v6-block-link inline" onClick={() => navigate('/projects')}>全部项目<ArrowRight size={14} /></button></div></div>
          <div className="table-scroll"><table className="data-table v6-table overview-table"><thead><tr><th>项目</th><th>状态</th><th className="align-right">合同额</th><th className="align-right">目标成本</th><th className="align-right">已发生</th><th className="align-right">成本余量</th><th className="align-right">回款率</th><th /></tr></thead><tbody>{sortedProjects.map((project) => <tr key={project.id} onClick={() => { setSelectedProjectId(project.id); navigate('/cost'); }} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') { setSelectedProjectId(project.id); navigate('/cost'); } }}><td><strong className="table-primary-text">{project.name}</strong><small className="table-subtext">{project.code} · {project.ownerName}</small></td><td><StatusBadge status={project.status} /></td><td className="align-right numeric">{formatMoney(project.contractAmount, 0)}</td><td className="align-right numeric">{formatMoney(project.targetCost, 0)}</td><td className="align-right numeric">{formatMoney(project.actualCost, 0)}</td><td className="align-right numeric">{formatMoney(project.targetCost - project.actualCost, 0)}</td><td className="align-right numeric">{project.recoveryRatio == null ? '—' : `${(project.recoveryRatio * 100).toFixed(1)}%`}</td><td className="align-right"><ChevronRight size={14} className="v6-row-arrow" /></td></tr>)}</tbody><tfoot><tr><td colSpan={2}>合计</td><td className="align-right numeric">{formatMoney(totals.contractAmount, 0)}</td><td className="align-right numeric">{formatMoney(totals.targetCost, 0)}</td><td className="align-right numeric">{formatMoney(totals.actualCost, 0)}</td><td className="align-right numeric">{formatMoney(costRemaining, 0)}</td><td className="align-right numeric">{recoveryRatio == null ? '—' : `${(recoveryRatio * 100).toFixed(1)}%`}</td><td /></tr></tfoot></table></div>
        </section>

        <aside className="v6-block" aria-label="待办">
          <div className="v6-block-head"><div><h2>待办</h2></div><span className="v6-count">{data!.pendingChanges.length} 项</span></div>
          <div className="v6-todo">
            {data!.pendingChanges.length === 0 ? <div className="v6-empty"><ClipboardCheck size={18} />当前没有待跟进变更</div> : data!.pendingChanges.slice(0, 6).map((item) => <button type="button" className="v6-todo-item" key={item.id} onClick={() => { setSelectedProjectId(item.projectId); navigate('/cost/changes'); }}><span className="v6-todo-title"><CircleAlert size={14} />{item.name}</span><span className="v6-todo-amt">{formatMoney(item.submittedAmount, 0)}</span><span className="v6-todo-meta">{item.projectName} · {item.code}</span></button>)}
          </div>
        </aside>
      </div>

      <section className="v6-block v6-log" aria-label="近期变动">
        <div className="v6-block-head"><div><h2>近期变动</h2></div><div className="ov-head-tools"><DatePicker className="ov-date" value={logDate} onChange={(event) => setLogDate(event.target.value)} aria-label="筛选变动日期" />{currentUser?.role === 'ADMIN' && <button type="button" className="v6-block-link inline" onClick={() => navigate('/audit-logs')}>操作日志<ArrowRight size={14} /></button>}</div></div>
        <div className="v6-log-list">
          {logActivities.length === 0 ? <div className="v6-empty">该日期没有变动记录</div> : logActivities.slice(0, 8).map((activity) => <div className="v6-log-row" key={activity.id}><time>{new Date(activity.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><div><strong>{activityLabel[activity.action] ?? activity.action}</strong><span>{activity.projectName} · {activity.entity} · {activity.actor}</span></div><span className="v6-log-date">—</span></div>)}
        </div>
      </section>
    </>}
  </div>;
}
