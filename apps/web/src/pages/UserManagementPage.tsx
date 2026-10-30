import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, UserCheck, UserPlus, UserRoundX, X } from 'lucide-react';
import { api, ApiError } from '../api';
import SelectField from '../components/SelectField';
import { useAuthStore } from '../auth-store';
import { Button, DataPanel, EmptyState, ErrorBlock, formatDate, LoadingBlock, PageHeader, PageNote, StatusBadge } from '../components/Ui';
import { confirmThen } from '../components/ConfirmDialog';

type ManagedUser = {
  id: string; name: string; email: string; role: 'ADMIN' | 'USER'; isActive: boolean;
  dataScope: 'ASSIGNED_PROJECTS' | 'ALL_PROJECTS_READONLY'; passwordResetRequired: boolean; mfaEnabled: boolean; mfaEnrolledAt: string | null; createdAt: string;
};

export default function UserManagementPage() {
  const currentUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<ManagedUser[]>('/auth/users'), enabled: currentUser?.role === 'ADMIN' });
  const createUser = useMutation({
    mutationFn: () => api.post<ManagedUser>('/auth/users', { name: name.trim(), email: email.trim(), password }),
    onSuccess: async (created) => {
      setName(''); setEmail(''); setPassword(''); setError('');
      setNotice(`账号“${created.name}”已创建。该用户首次登录时必须修改初始密码，且尚未获得任何项目访问权限。`);
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : '账号创建失败'),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch<ManagedUser>(`/auth/users/${encodeURIComponent(id)}/status`, { isActive }),
    onSuccess: async (updated) => {
      setError(''); setNotice(`账号“${updated.name}”已${updated.isActive ? '启用' : '停用'}。${updated.isActive ? '' : '其已有登录会话已撤销。'}`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin-users'] }), queryClient.invalidateQueries({ queryKey: ['security-sessions'] }), queryClient.invalidateQueries({ queryKey: ['security-events'] })]);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : '账号状态更新失败'),
  });
  const dataScopeMutation = useMutation({
    mutationFn: ({ id, dataScope }: { id: string; dataScope: ManagedUser['dataScope'] }) => api.patch<ManagedUser & { sessionsRevoked?: boolean }>(`/auth/users/${encodeURIComponent(id)}/data-scope`, { dataScope }),
    onSuccess: async (updated) => {
      setError(''); setNotice(`账号“${updated.name}”的数据范围已更新为“${updated.dataScope === 'ALL_PROJECTS_READONLY' ? '全部项目只读' : '仅已分配项目'}”。其登录会话已撤销，重新登录后生效。`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin-users'] }), queryClient.invalidateQueries({ queryKey: ['security-sessions'] }), queryClient.invalidateQueries({ queryKey: ['system-authorization-reviews'] })]);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : '数据范围更新失败'),
  });
  const resetMfaMutation = useMutation({
    mutationFn: (managedUser: ManagedUser) => api.post<{ reset: boolean }>(`/auth/users/${encodeURIComponent(managedUser.id)}/reset-mfa`, {}),
    onSuccess: async (_, target) => {
      setError(''); setNotice(`账号“${target.name}”的多因素认证已重置；其会话已撤销，重新登录后必须修改密码并重新设置 MFA。`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin-users'] }), queryClient.invalidateQueries({ queryKey: ['security-sessions'] }), queryClient.invalidateQueries({ queryKey: ['security-events'] })]);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'MFA 重置失败'),
  });
  const resetMutation = useMutation({
    mutationFn: () => { if (!resetTarget) throw new Error('未选择账号'); return api.post<{ reset: boolean }>(`/auth/users/${encodeURIComponent(resetTarget.id)}/reset-password`, { password: resetPassword }); },
    onSuccess: async () => {
      const targetName = resetTarget?.name ?? '目标账号';
      setResetTarget(null); setResetPassword(''); setError(''); setNotice(`账号“${targetName}”的密码已重置。下次登录必须修改密码，所有旧会话已撤销。`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin-users'] }), queryClient.invalidateQueries({ queryKey: ['security-sessions'] }), queryClient.invalidateQueries({ queryKey: ['security-events'] })]);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : '密码重置失败'),
  });

  if (currentUser?.role !== 'ADMIN') return <div className="page-wrap"><PageHeader eyebrow="SYSTEM / ACCOUNT ADMIN" title="系统账号管理" subtitle="公司级账号身份管理仅对系统管理员开放。" /><EmptyState title="没有管理权限" description="请使用系统管理员账号登录后维护系统账号。" /></div>;
  if (usersQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在加载系统账号…" /></div>;
  if (usersQuery.error) return <div className="page-wrap"><ErrorBlock message={(usersQuery.error as Error).message} retry={() => void usersQuery.refetch()} /></div>;
  const users = usersQuery.data ?? [];

  return <div className="page-wrap">
    <PageHeader eyebrow="SYSTEM / ACCOUNT ADMIN" title="系统账号管理" subtitle="维护公司级登录身份。账号创建与项目成员授权分开办理；停用账号会立即撤销其现有登录会话。" />
    {notice && <div className="success-notice"><ShieldCheck size={16} />{notice}<Button variant="ghost" size="icon" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></Button></div>}
    {error && <div className="form-alert">{error}<Button variant="ghost" size="icon" aria-label="关闭错误提示" onClick={() => setError('')}><X size={14} /></Button></div>}

    <div className="sys-split">
      <div className="sys-split-side">
    <section className="panel">
      <div className="panel-heading"><div><h3>创建系统账号</h3><p>新建账号默认是普通用户，首次登录强制修改初始密码，不会自动获得任何项目访问权限。</p></div><span className="panel-icon"><UserPlus size={18} /></span></div>
      <form className="account-rows" onSubmit={(event) => { event.preventDefault(); setNotice(''); setError(''); createUser.mutate(); }}>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">姓名</div><div className="settings-row-hint">用于账号列表与审计记录展示。</div></div>
          <div className="settings-row-control"><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入真实姓名" autoComplete="name" aria-label="姓名" /></div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">登录邮箱</div><div className="settings-row-hint">作为登录账号，不会自动获得项目访问权限。</div></div>
          <div className="settings-row-control"><input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" aria-label="登录邮箱" /></div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">初始密码</div><div className="settings-row-hint">至少 12 位；系统只存储 bcrypt 哈希，不会再次显示。</div></div>
          <div className="settings-row-control"><input required type="password" minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 位临时强密码" aria-label="初始密码" /></div>
        </div>
        <div className="settings-row-actions"><span className="settings-row-actions-note">创建后请通过安全渠道告知用户，并要求首次登录修改密码。</span><div className="settings-row-actions-buttons"><Button type="submit" disabled={createUser.isPending || !name.trim() || !email.trim() || password.length < 12}><UserPlus size={15} />{createUser.isPending ? '创建中…' : '创建账号'}</Button></div></div>
      </form>
    </section>

    {resetTarget && <section className="panel user-reset-panel">
      <div className="panel-heading"><div><h3>重置账号密码</h3><p>{resetTarget.name} · {resetTarget.email}。重置后该账号必须修改密码，所有现有会话立即失效。</p></div><Button variant="ghost" size="icon" aria-label="取消重置" onClick={() => { setResetTarget(null); setResetPassword(''); }}><X size={15} /></Button></div>
      <form className="account-rows" onSubmit={(event) => { event.preventDefault(); resetMutation.mutate(); }}>
        <div className="settings-row">
          <div className="settings-row-copy"><div className="settings-row-label">临时密码</div><div className="settings-row-hint">重置后该账号必须修改密码，所有现有会话立即失效。</div></div>
          <div className="settings-row-control"><input type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="至少 12 位临时密码" aria-label="临时密码" /></div>
        </div>
        <div className="settings-row-actions"><span className="settings-row-actions-note">{resetTarget.name} · {resetTarget.email}</span><div className="settings-row-actions-buttons"><Button type="submit" variant="danger" disabled={resetMutation.isPending || resetPassword.length < 12}><KeyRound size={15} />{resetMutation.isPending ? '正在重置…' : '确认重置密码'}</Button></div></div>
      </form>
    </section>}

      </div>
      <div className="sys-split-main">
    <DataPanel
      className="user-table-panel"
      title="系统账号列表"
      description="项目角色应在“项目管理 → 项目成员与权限”中按项目单独维护；跨项目只读只开放业务读取与报表导出，不授予写入或审批权限。"
      actions={<span className="table-count">{users.length} 个账号</span>}
      empty={!users.length}
      emptyTitle="暂无系统账号"
      emptyDescription="创建业务人员账号后，再由有权限的项目管理人员将其加入具体项目。"
    >
      <div className="table-scroll"><table className="data-table user-account-table"><thead><tr><th>账号</th><th>公司级身份</th><th>跨项目数据范围</th><th>账号 / 登录安全</th><th>创建日期</th><th>管理</th></tr></thead><tbody>{users.map((managedUser) => <tr key={managedUser.id}>
        <td data-label="账号"><strong className="table-primary-text">{managedUser.name}</strong><small className="table-subtext">{managedUser.email}</small></td>
        <td data-label="公司级身份"><StatusBadge status={managedUser.role} /></td>
        <td data-label="跨项目数据范围">{managedUser.role === 'ADMIN' ? <span className="table-subtext">公司级管理员权限单独管理</span> : <SelectField aria-label={`${managedUser.name} 的跨项目数据范围`} value={managedUser.dataScope} disabled={dataScopeMutation.isPending} onChange={(event) => { const next = event.target.value as ManagedUser['dataScope']; if (next === 'ALL_PROJECTS_READONLY') { confirmThen(`确定授予 ${managedUser.name} 跨项目只读权限吗？该权限可查看所有项目的业务数据和报表，但不能编辑合同、成本或资金记录。`, () => dataScopeMutation.mutate({ id: managedUser.id, dataScope: next }), { title: '授予跨项目只读权限', confirmText: '授予权限' }); } else { dataScopeMutation.mutate({ id: managedUser.id, dataScope: next }); } }}><option value="ASSIGNED_PROJECTS">仅已分配项目</option><option value="ALL_PROJECTS_READONLY">全部项目只读</option></SelectField>}</td>
        <td data-label="账号 / 登录安全"><div className="user-security-flags"><StatusBadge status={managedUser.isActive ? 'ACTIVE' : 'INACTIVE'} />{managedUser.mfaEnabled ? <StatusBadge status="MFA_ENABLED" /> : <span className="status-badge status-orange"><span className="status-dot" />未启用 MFA</span>}{managedUser.passwordResetRequired && <span className="status-badge status-orange"><span className="status-dot" />需改密码</span>}</div></td>
        <td data-label="创建日期">{formatDate(managedUser.createdAt)}</td>
        <td data-label="管理"><div className="user-row-actions">
          <Button size="sm" variant="secondary" onClick={() => { setResetTarget(managedUser); setResetPassword(''); setError(''); }}><KeyRound size={13} />重置密码</Button>
          {managedUser.mfaEnabled && managedUser.id !== currentUser.id && <Button size="sm" variant="secondary" disabled={resetMfaMutation.isPending} onClick={() => { confirmThen(`确定重置 ${managedUser.name} 的多因素认证吗？其会话将立即失效，并且下次登录必须修改密码和重新设置 MFA。`, () => resetMfaMutation.mutate(managedUser), { title: '重置多因素认证', tone: 'danger', confirmText: '重置 MFA' }); }}><ShieldCheck size={13} />重置 MFA</Button>}
          {managedUser.isActive ? <Button size="sm" variant="danger" disabled={managedUser.id === currentUser.id || statusMutation.isPending} onClick={() => { confirmThen(`确定停用账号 ${managedUser.name} 吗？该账号将立即退出所有设备。`, () => statusMutation.mutate({ id: managedUser.id, isActive: false }), { title: '停用系统账号', tone: 'danger', confirmText: '停用账号' }); }}><UserRoundX size={13} />停用</Button> : <Button size="sm" variant="secondary" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ id: managedUser.id, isActive: true })}><UserCheck size={13} />启用</Button>}
        </div></td>
      </tr>)}</tbody></table></div>
    </DataPanel>
      </div>
    </div>

    <PageNote>公网部署时系统管理员首次登录必须启用验证器多因素认证。关闭账号、重置密码或从安全中心撤销会话都会立即阻断该会话的后续 API 请求。登录安全事件与 IP/设备信息只能用于受控运维目的。</PageNote>
  </div>;
}
