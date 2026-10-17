import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock3, Globe, Monitor, RefreshCcw, ShieldAlert, ShieldCheck, Smartphone, UserRoundX } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuthStore } from '../auth-store';
import { Button, EmptyState, ErrorBlock, formatDate, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';

type AuthSessionRow = {
  id: string; userId: string; ipAddress: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string;
  revokedAt: string | null; revokeReason: string | null; isCurrent: boolean; isValid: boolean;
  user: { name: string; email: string; role: 'ADMIN' | 'USER'; isActive: boolean };
};
type SecurityEventRow = {
  id: string; userId: string | null; accountEmail: string | null; sessionId: string | null; action: string; outcome: string;
  ipAddress: string | null; userAgent: string | null; details: unknown; createdAt: string; user: { name: string } | null;
};
const actionLabels: Record<string, string> = {
  LOGIN_SUCCEEDED: '登录成功', LOGIN_FAILED: '登录失败', LOGIN_MFA_FAILED: '多因素验证失败', LOGIN_RATE_LIMITED: '登录限流',
  LOGOUT: '退出登录', REFRESH_TOKEN_REUSE: '刷新令牌重放', ADMIN_MFA_SETUP_REQUIRED: '要求管理员启用 MFA',
  MFA_ENROLLMENT_STARTED: '开始 MFA 设置', MFA_ENABLED: '启用 MFA', PASSWORD_CHANGE_REQUIRED: '要求修改密码',
  USER_CREATED: '创建账号', USER_ACTIVATED: '启用账号', USER_DEACTIVATED: '停用账号', USER_PASSWORD_RESET: '重置密码',
  USER_PASSWORD_CHANGED: '修改密码', SESSION_REVOKED: '撤销会话',
};
function userAgentLabel(value: string | null) {
  if (!value) return '未知设备';
  const ua = value.toLowerCase();
  const device = /iphone|ipad|android|mobile/.test(ua) ? '移动设备' : /windows/.test(ua) ? 'Windows 电脑' : /mac os|macintosh/.test(ua) ? 'Mac 电脑' : '桌面/其他设备';
  const browser = /edg\//.test(ua) ? 'Edge' : /chrome\//.test(ua) && !/edg\//.test(ua) ? 'Chrome' : /firefox\//.test(ua) ? 'Firefox' : /safari\//.test(ua) && !/chrome\//.test(ua) ? 'Safari' : '浏览器';
  return `${device} · ${browser}`;
}
function displayDate(value: string | null) { return value ? formatDate(value) : '—'; }

export default function SystemSecurityPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({ queryKey: ['security-sessions'], queryFn: () => api.get<AuthSessionRow[]>('/auth/security/sessions'), enabled: user?.role === 'ADMIN' });
  const eventsQuery = useQuery({ queryKey: ['security-events'], queryFn: () => api.get<SecurityEventRow[]>('/auth/security/events'), enabled: user?.role === 'ADMIN' });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete<{ revoked: boolean; sessionId: string }>(`/auth/security/sessions/${encodeURIComponent(id)}`),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['security-sessions'] }), queryClient.invalidateQueries({ queryKey: ['security-events'] })]); },
  });

  if (user?.role !== 'ADMIN') return <div className="page-wrap"><PageHeader eyebrow="SYSTEM / SECURITY" title="安全中心" subtitle="登录事件与会话控制仅对系统管理员开放。" /><EmptyState title="没有管理权限" description="请使用系统管理员账号登录后查看安全事件。" /></div>;
  if (sessionsQuery.isLoading || eventsQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在加载登录安全信息…" /></div>;
  if (sessionsQuery.error || eventsQuery.error) return <div className="page-wrap"><ErrorBlock message={((sessionsQuery.error ?? eventsQuery.error) as Error).message} retry={() => { void sessionsQuery.refetch(); void eventsQuery.refetch(); }} /></div>;

  const sessions = sessionsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const activeSessions = sessions.filter((session) => session.isValid).length;
  const deniedEvents = events.filter((event) => event.outcome === 'DENIED' || event.outcome === 'BLOCKED' || event.outcome === 'SESSION_REVOKED').length;
  return <div className="page-wrap system-security-page">
    <PageHeader eyebrow="SYSTEM / SECURITY CENTER" title="登录安全中心" subtitle="查看近期登录安全事件、检查活跃会话，并在发现异常时撤销远程访问。IP 地址与设备信息属于受限安全数据。" actions={<Button variant="secondary" onClick={() => { void sessionsQuery.refetch(); void eventsQuery.refetch(); }}><RefreshCcw size={15} />刷新</Button>} />

    <section className="security-metrics">
      <article className="security-metric"><span className="security-metric-icon"><Monitor size={18} /></span><div><small>有效会话</small><strong>{activeSessions}</strong><span>最多显示最近 200 条记录</span></div></article>
      <article className="security-metric"><span className="security-metric-icon"><ShieldAlert size={18} /></span><div><small>近期拒绝/阻断事件</small><strong>{deniedEvents}</strong><span>统计当前展示的最近 200 条事件</span></div></article>
      <article className="security-metric"><span className="security-metric-icon"><ShieldCheck size={18} /></span><div><small>公网模式管理员保护</small><strong>HTTPS + MFA</strong><span>需配置 PUBLIC_BASE_URL 与 MFA 密钥</span></div></article>
    </section>

    {revokeMutation.error && <div className="form-alert">{revokeMutation.error instanceof ApiError ? revokeMutation.error.message : '撤销会话失败'}</div>}
    <section className="panel security-panel">
      <div className="panel-heading"><div><h3>登录会话</h3><p>撤销会话会立即阻止该会话后续 API 请求和刷新令牌。当前登录会话不能从这里撤销。</p></div><span className="table-count">{activeSessions} 个有效</span></div>
      {!sessions.length ? <EmptyState title="暂无会话记录" description="成功登录后，设备会话将显示在这里。" /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>用户 / 设备</th><th>来源 IP</th><th>最近活动</th><th>创建 / 到期</th><th>状态</th><th>操作</th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}>
        <td><strong className="table-primary-text">{session.user?.name ?? '未知账号'}</strong><small className="table-subtext">{session.user?.email ?? '账号关联不可用'}</small><small className="table-subtext"><Smartphone size={12} /> {userAgentLabel(session.userAgent)}{session.isCurrent ? ' · 当前会话' : ''}</small></td>
        <td><span className="security-ip"><Globe size={13} />{session.ipAddress || '未识别'}</span></td>
        <td>{displayDate(session.lastSeenAt)}</td>
        <td><small className="table-subtext">创建 {displayDate(session.createdAt)}</small><small className="table-subtext">到期 {displayDate(session.expiresAt)}</small></td>
        <td>{session.isValid ? <StatusBadge status="ACTIVE" /> : <span className="status-badge status-gray"><span className="status-dot" />{session.revokeReason ? '已撤销' : '已过期'}</span>}</td>
        <td>{session.isValid ? <Button size="sm" variant="danger" disabled={session.isCurrent || revokeMutation.isPending} onClick={() => { if (window.confirm(`确定撤销 ${session.user?.name ?? '该用户'} 的这个登录会话吗？`)) revokeMutation.mutate(session.id); }}><UserRoundX size={13} />撤销</Button> : <span className="table-subtext">—</span>}</td>
      </tr>)}</tbody></table></div>}
    </section>

    <section className="panel security-panel">
      <div className="panel-heading"><div><h3>安全事件</h3><p>记录登录成败、MFA、密码修改、账号状态变化、令牌重放和管理员会话撤销。</p></div><span className="table-count">最近 {events.length} 条</span></div>
      {!events.length ? <EmptyState title="暂无安全事件" description="登录和安全管理操作将在此记录。" /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>时间</th><th>事件</th><th>账号</th><th>来源 IP</th><th>结果</th><th>详情</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}>
        <td>{displayDate(event.createdAt)}</td>
        <td><strong className="table-primary-text">{actionLabels[event.action] ?? event.action}</strong><small className="table-subtext">{event.user?.name ?? '未知/未关联账号'}</small></td>
        <td>{event.accountEmail ?? '—'}</td>
        <td>{event.ipAddress ?? '—'}</td>
        <td><StatusBadge status={event.outcome === 'ALLOWED' ? 'ACTIVE' : event.outcome === 'DENIED' || event.outcome === 'BLOCKED' ? 'REJECTED' : 'UNDER_REVIEW'} /></td>
        <td><details className="security-event-details"><summary><Clock3 size={13} />查看</summary><pre>{JSON.stringify(event.details ?? {}, null, 2)}</pre>{event.sessionId && <small>会话：{event.sessionId}</small>}{event.userAgent && <small>{event.userAgent}</small>}</details></td>
      </tr>)}</tbody></table></div>}
    </section>
    <div className="data-note"><span className="note-mark"><AlertTriangle size={14} /></span><span>安全事件最多保留 180 天，登录尝试计数按策略清理。此页面不是地理定位工具；IP 地址可能因代理、运营商网络或移动网络而变化，不能单独作为认定真实位置或身份的证据。</span></div>
  </div>;
}
