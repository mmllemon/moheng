import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, ArrowUpRight, BellRing, CalendarClock, CheckCircle2, Clock3, Filter, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useUiStore } from '../auth-store';
import { Button, EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';

type Notice = { id: string; kind: string; severity: 'danger' | 'warning' | 'info'; title: string; description: string; projectId: string; projectName: string; projectCode: string; occurredAt: string; href: string; amount?: number };
type NoticeResponse = { generatedAt: string; total: number; bySeverity: { danger: number; warning: number; info: number }; items: Notice[] };
const filters = [{ key: 'ALL', label: '全部事项' }, { key: 'danger', label: '高优先级' }, { key: 'warning', label: '待处理' }, { key: 'info', label: '提醒' }] as const;
const severityLabel = { danger: '优先处理', warning: '待处理', info: '提醒' };

export default function NotificationsPage() {
  const [filter, setFilter] = useState<(typeof filters)[number]['key']>('ALL');
  const setSelectedProjectId = useUiStore((state) => state.setSelectedProjectId);
  const query = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<NoticeResponse>('/notifications'), refetchInterval: 120000 });
  const items = useMemo(() => (query.data?.items ?? []).filter((item) => filter === 'ALL' || item.severity === filter), [query.data?.items, filter]);
  const filterCounts = { ALL: query.data?.total ?? 0, danger: query.data?.bySeverity.danger ?? 0, warning: query.data?.bySeverity.warning ?? 0, info: query.data?.bySeverity.info ?? 0 };
  return <div className="page-wrap notifications-page">
    <PageHeader eyebrow="WORK QUEUE / LIVE ALERTS" title="待办与预警" subtitle="根据当前业务台账动态生成的工作清单，不是已读/未读通知。完成相应业务流程后，事项会随数据变化自动消失。" actions={<Button variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={14} className={query.isFetching ? 'notice-refreshing' : ''} />刷新清单</Button>} />
    {query.isLoading ? <LoadingBlock label="正在汇总待办与预警…" /> : query.error ? <ErrorBlock message={(query.error as Error).message} retry={() => void query.refetch()} /> : <>
      <section className="notice-summary-grid"><article className="panel notice-summary-card"><span className="notice-summary-icon danger"><AlertCircle size={18} /></span><div><small>高优先级</small><strong>{query.data?.bySeverity.danger ?? 0}</strong><span>逾期应收/应付、目标成本超支及争议凭证</span></div></article><article className="panel notice-summary-card"><span className="notice-summary-icon warning"><AlertTriangle size={18} /></span><div><small>待处理</small><strong>{query.data?.bySeverity.warning ?? 0}</strong><span>内部审批、凭证核验与分供结算</span></div></article><article className="panel notice-summary-card"><span className="notice-summary-icon info"><CalendarClock size={18} /></span><div><small>提醒</small><strong>{query.data?.bySeverity.info ?? 0}</strong><span>申报审核与合同期限</span></div></article></section>
      <section className="panel notice-list-panel"><div className="notice-list-heading"><div><h2><BellRing size={18} />工作事项</h2><p>共 {query.data?.total ?? 0} 项 · 更新时间 {query.data?.generatedAt ? new Date(query.data.generatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}</p></div><div className="notice-filter-group" role="group" aria-label="筛选待办类型"><Filter size={14} />{filters.map((item) => <button key={item.key} type="button" className={filter === item.key ? 'active' : ''} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}<small>{filterCounts[item.key]}</small></button>)}</div></div>
        {!items.length ? <EmptyState title={query.data?.total ? '此类别暂无事项' : '当前没有待处理事项'} description={query.data?.total ? '切换其他类别查看，或刷新工作清单。' : '当前可访问项目中未发现已配置规则覆盖的待办或预警。'} action={() => setFilter('ALL')} /> : <div className="notice-list">{items.map((item) => { const Icon = item.severity === 'danger' ? AlertCircle : item.severity === 'warning' ? AlertTriangle : Clock3; return <article className={`notice-item severity-${item.severity}`} key={item.id}><span className="notice-item-icon"><Icon size={17} /></span><div className="notice-item-main"><div className="notice-item-title-row"><strong>{item.title}</strong><span className={`notice-severity-pill ${item.severity}`}>{severityLabel[item.severity]}</span></div><p>{item.description}</p><div className="notice-item-meta"><span>{item.projectName}</span><code>{item.projectCode}</code><span>{new Date(item.occurredAt).toLocaleDateString('zh-CN')}</span>{item.amount != null && <strong>¥ {item.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>}</div></div><Link className="notice-open-link" to={item.href} onClick={() => setSelectedProjectId(item.projectId)} aria-label={`前往处理：${item.title}`}><span>前往处理</span><ArrowUpRight size={16} /></Link></article>; })}</div>}
      </section>
      <div className="data-note"><span className="note-mark"><ShieldCheck size={14} /></span><span>待办在服务端按当前账号的项目访问范围计算。此版本不提供“标记已读”或永久关闭操作，以免用户关闭提醒却未完成实际业务处理。</span></div>
    </>}
  </div>;
}
