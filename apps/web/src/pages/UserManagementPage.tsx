import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserPlus, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuthStore } from '../auth-store';
import { Button, EmptyState, ErrorBlock, formatDate, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'USER';
  isActive: boolean;
  createdAt: string;
};

export default function UserManagementPage() {
  const currentUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<ManagedUser[]>('/auth/users'),
    enabled: currentUser?.role === 'ADMIN',
  });

  const createUser = useMutation({
    mutationFn: () => api.post<ManagedUser>('/auth/users', { name: name.trim(), email: email.trim(), password }),
    onSuccess: async (created) => {
      setName('');
      setEmail('');
      setPassword('');
      setError('');
      setNotice(`账号“${created.name}”已创建。该账号尚未获得任何项目访问权限。`);
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : '账号创建失败'),
  });

  if (currentUser?.role !== 'ADMIN') {
    return <div className="page-wrap"><PageHeader eyebrow="SYSTEM / ACCOUNT ADMIN" title="系统账号管理" subtitle="公司级账号身份管理仅对系统管理员开放。" /><EmptyState title="没有管理权限" description="请使用系统管理员账号登录后维护系统账号。" /></div>;
  }

  if (usersQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在加载系统账号…" /></div>;
  if (usersQuery.error) return <div className="page-wrap"><ErrorBlock message={(usersQuery.error as Error).message} retry={() => void usersQuery.refetch()} /></div>;

  const users = usersQuery.data ?? [];
  return <div className="page-wrap">
    <PageHeader eyebrow="SYSTEM / ACCOUNT ADMIN" title="系统账号管理" subtitle="维护公司级登录身份。账号创建与项目成员授权分开办理，避免把登录身份误当成项目访问权限。" />
    {notice && <div className="success-notice"><ShieldCheck size={16} />{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {error && <div className="form-alert">{error}<button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={14} /></button></div>}

    <section className="panel">
      <div className="panel-heading"><div><h3>创建系统账号</h3><p>新建账号默认是普通用户，不会自动获得任何项目的访问权限。</p></div><span className="panel-icon"><UserPlus size={18} /></span></div>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); setNotice(''); setError(''); createUser.mutate(); }}>
        <div className="field"><label>姓名 <b>*</b></label><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入真实姓名" autoComplete="name" /></div>
        <div className="field"><label>登录邮箱 <b>*</b></label><input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></div>
        <div className="field"><label>初始密码 <b>*</b></label><input required type="password" minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 位" /><small className="field-hint">请使用临时强密码，并通过安全渠道告知账号本人。</small></div>
        <div><Button type="submit" disabled={createUser.isPending || !name.trim() || !email.trim() || password.length < 12}><UserPlus size={15} />{createUser.isPending ? '创建中…' : '创建账号'}</Button></div>
      </form>
    </section>

    <section className="panel user-table-panel">
      <div className="panel-heading"><div><h3>系统账号列表</h3><p>项目角色应在“系统管理工作台 → 项目成员与权限”中按项目单独维护。</p></div><span className="table-count">{users.length} 个账号</span></div>
      {!users.length ? <EmptyState title="暂无系统账号" description="创建业务人员账号后，再由有权限的项目管理人员将其加入具体项目。" /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>账号</th><th>公司级身份</th><th>账号状态</th><th>创建日期</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
        <td><strong className="table-primary-text">{user.name}</strong><small className="table-subtext">{user.email}</small></td>
        <td><StatusBadge status={user.role} /></td>
        <td><span className={`status-badge ${user.isActive ? 'status-green' : 'status-gray'}`}><span className="status-dot" />{user.isActive ? '启用' : '停用'}</span></td>
        <td>{formatDate(user.createdAt)}</td>
      </tr>)}</tbody></table></div>}
    </section>

    <div className="data-note"><span className="note-mark">i</span><span>本页面只管理公司级登录账号。项目成员添加、项目角色调整、最后一名项目负责人保护和相关审计记录统一由“项目成员与权限”页面及既有服务端规则处理。账号密码重置和停用目前仍需由维护人员通过受控运维流程处理。</span></div>
  </div>;
}
