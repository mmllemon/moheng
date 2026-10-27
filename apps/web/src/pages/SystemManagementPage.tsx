import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, BookOpen, Database, Fingerprint, KeyRound, RefreshCw, ServerCog, ShieldAlert, ShieldCheck, SlidersHorizontal, Users, ClipboardCheck } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../auth-store';
import { ErrorBlock, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';

type ManagedUser = { id: string; name: string; email: string; role: 'ADMIN' | 'USER'; isActive: boolean; mfaEnabled: boolean; passwordResetRequired: boolean; createdAt: string };
type AuthSession = { id: string; isValid: boolean; createdAt: string; lastSeenAt: string; user: { name: string; email: string }; ipAddress: string | null };
type SecurityEvent = { id: string; action: string; outcome: string; createdAt: string; accountEmail: string | null; ipAddress: string | null; user?: { name: string } | null };

const eventLabels: Record<string, string> = {
  LOGIN_FAILED: '登录失败', LOGIN_SUCCEEDED: '登录成功', LOGIN_MFA_FAILED: 'MFA 验证失败', LOGIN_RATE_LIMITED: '登录尝试被限流',
  REFRESH_TOKEN_REUSE: '检测到刷新令牌重放', SESSION_REVOKED: '会话已撤销', USER_DEACTIVATED: '账号已停用',
  USER_PASSWORD_RESET: '管理员重置密码', SELF_PASSWORD_CHANGED: '用户修改密码', MFA_ENABLED: '启用多因素认证',
  USER_MFA_RESET: '管理员重置 MFA', ADMIN_MFA_SETUP_REQUIRED: '管理员需设置 MFA',
};
function displayDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function SystemManagementPage() {
  const user = useAuthStore((state) => state.user);
  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<ManagedUser[]>('/auth/users'), enabled: user?.role === 'ADMIN' });
  const sessionsQuery = useQuery({ queryKey: ['security-sessions'], queryFn: () => api.get<AuthSession[]>('/auth/security/sessions'), enabled: user?.role === 'ADMIN' });
  const eventsQuery = useQuery({ queryKey: ['security-events'], queryFn: () => api.get<SecurityEvent[]>('/auth/security/events'), enabled: user?.role === 'ADMIN' });

  const users = usersQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const activeSessions = sessions.filter((session) => session.isValid);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentRiskEvents = useMemo(() => events.filter((event) =>
    ['DENIED', 'BLOCKED', 'SESSION_REVOKED'].includes(event.outcome)
      || ['REFRESH_TOKEN_REUSE', 'LOGIN_RATE_LIMITED', 'LOGIN_MFA_FAILED', 'USER_DEACTIVATED'].includes(event.action),
  ).slice(0, 6), [events]);
  const newEventsLast7Days = events.filter((event) => new Date(event.createdAt).getTime() >= sevenDaysAgo).length;
  const accountsNeedingAttention = users.filter((managedUser) => managedUser.isActive && (managedUser.passwordResetRequired || (managedUser.role === 'ADMIN' && !managedUser.mfaEnabled))).length;

  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  if (usersQuery.isLoading || sessionsQuery.isLoading || eventsQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在汇总系统管理状态…" /></div>;
  const failedQuery = usersQuery.error ? usersQuery : sessionsQuery.error ? sessionsQuery : eventsQuery.error ? eventsQuery : null;
  if (failedQuery) return <div className="page-wrap"><ErrorBlock message={(failedQuery.error as Error).message} retry={() => { void usersQuery.refetch(); void sessionsQuery.refetch(); void eventsQuery.refetch(); }} /></div>;

  return <div className="page-wrap system-management-page">
    {/* 页面级操作按钮：PageHeader 在设置窗内会自动 portal 到标题栏，
        不再占用内容区顶部一行。 */}
    <PageHeader eyebrow="SYSTEM MANAGEMENT / OVERVIEW" title="系统管理概览" subtitle="这里展示系统状态、需要关注的安全事项和治理建设进度。字典、参数、组织与运维分别进入专门工作台，避免在概览页重复摆放复杂表单。" actions={<button type="button" className="panel-header-action" onClick={() => { void usersQuery.refetch(); void sessionsQuery.refetch(); void eventsQuery.refetch(); }}><RefreshCw size={14} />刷新状态</button>} />

    <section className="system-overview-metrics" aria-label="系统管理指标">
      <article className="panel system-overview-metric"><span className="system-overview-icon"><Users size={18} /></span><div><small>启用账号</small><strong>{users.filter((managedUser) => managedUser.isActive).length}<em> / {users.length}</em></strong><span>停用账号不能继续建立会话</span></div><Link to="/system/accounts" aria-label="查看系统账号"><ArrowRight size={15} /></Link></article>
      <article className="panel system-overview-metric"><span className="system-overview-icon"><Fingerprint size={18} /></span><div><small>最近 200 条中的有效会话</small><strong>{activeSessions.length}</strong><span>最长 7 天 · 闲置 12 小时失效</span></div><Link to="/system/security" aria-label="查看登录会话"><ArrowRight size={15} /></Link></article>
      <article className="panel system-overview-metric"><span className="system-overview-icon"><ShieldAlert size={18} /></span><div><small>近 7 天安全事件</small><strong>{newEventsLast7Days}</strong><span>显示最近 200 条事件中的匹配记录</span></div><Link to="/system/security" aria-label="查看安全事件"><ArrowRight size={15} /></Link></article>
      <article className="panel system-overview-metric"><span className="system-overview-icon"><KeyRound size={18} /></span><div><small>账号待处理</small><strong>{accountsNeedingAttention}</strong><span>强制改密或管理员 MFA 尚待检查</span></div><Link to="/system/accounts" aria-label="处理账号安全问题"><ArrowRight size={15} /></Link></article>
    </section>

    <section className="system-overview-two-column">
      <section className="panel system-overview-events">
        <div className="panel-heading"><div><h3><Activity size={17} />需要关注的安全事件</h3><p>优先显示失败、阻断、会话撤销和高风险认证事件。</p></div><Link className="panel-header-action" to="/system/security">完整安全中心 <ArrowRight size={14} /></Link></div>
        {!recentRiskEvents.length ? <div className="system-overview-empty"><ShieldCheck size={18} /><span><strong>当前展示范围内没有需要关注的事件</strong><small>这不代表系统已经通过公网安全验收，只说明最近 200 条事件中未发现匹配项。</small></span></div> : <div className="system-overview-event-list">{recentRiskEvents.map((event) => <div className="system-overview-event-row" key={event.id}>
          <span className={`system-event-mark ${['DENIED', 'BLOCKED'].includes(event.outcome) ? 'is-risk' : ''}`}><ShieldAlert size={15} /></span>
          <div className="system-overview-event-copy"><strong>{eventLabels[event.action] ?? event.action}</strong><span>{event.accountEmail ?? event.user?.name ?? '未关联账号'} · {event.ipAddress ?? '来源未记录'}</span></div>
          <time>{displayDate(event.createdAt)}</time>
        </div>)}</div>}
      </section>

      <section className="panel system-overview-readiness">
        <div className="panel-heading"><div><h3><ServerCog size={17} />当前治理能力</h3><p>区分源码已落地、需部署配置与仍需环境验收的事项。</p></div><span className="system-overview-readiness-tag">RC 候选</span></div>
        <div className="system-readiness-line"><span><ShieldCheck size={15} />账号、会话与安全事件</span><StatusBadge status="ACTIVE" /></div>
        <div className="system-readiness-line"><span><ShieldCheck size={15} />管理员 TOTP MFA</span><StatusBadge status="ACTIVE" /></div>
        <div className="system-readiness-line"><span><ShieldCheck size={15} />组织与版本化审批规则</span><StatusBadge status="ACTIVE" /></div>
        <div className="system-readiness-line"><span><BookOpen size={15} />统一基础字典</span><StatusBadge status="ACTIVE" /></div>
        <div className="system-readiness-line"><span><SlidersHorizontal size={15} />统一参数配置</span><StatusBadge status="ACTIVE" /></div>
        <div className="system-readiness-line"><span><Database size={15} />备份恢复验证工作台</span><StatusBadge status="ACTIVE" /></div>
        <div className="system-readiness-line"><span><RefreshCw size={15} />真实公网 TLS 与端到端验收</span><StatusBadge status="PENDING" /></div>
        <p className="system-readiness-note">公网访问需由部署人员完成真实域名、证书、防火墙、数据库迁移与浏览器端到端测试。这里的“已实现”表示源码已有对应机制，不代表当前部署已对公网开放。</p>
      </section>
    </section>

    <div className="data-note"><span className="note-mark">i</span><span>当前首页为管理概览，不替代“系统账号管理”“登录安全中心”“操作追溯”等专门页面。MFA、TLS 与项目授权等状态在开发环境或未完成部署时仍需结合实际环境复核。</span></div>
  </div>;
}
