import SelectField from '../components/SelectField';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuthStore, useUiStore } from '../auth-store';
import { Button, EmptyState, ErrorBlock, formatDate, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';

type ProjectRole = 'OWNER' | 'MANAGER' | 'ESTIMATOR' | 'VIEWER';
type ProjectMember = { id: string; userId?: string; name: string; email: string; role: ProjectRole };
type ManagedUser = {
  id: string; name: string; email: string; role: 'ADMIN' | 'USER'; isActive: boolean; createdAt: string;
  memberships: { projectId: string; role: ProjectRole }[];
};
const projectRoles: { value: ProjectRole; label: string }[] = [
  { value: 'OWNER', label: '项目负责人' },
  { value: 'MANAGER', label: '项目经理' },
  { value: 'ESTIMATOR', label: '预算/成本经办' },
  { value: 'VIEWER', label: '只读查看' },
];

function roleLabel(role: ProjectRole) { return projectRoles.find((item) => item.value === role)?.label ?? role; }

export default function UserManagementPage() {
  const currentUser = useAuthStore((state) => state.user);
  const projectId = useUiStore((state) => state.selectedProjectId);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleDrafts, setRoleDrafts] = useState<Record<string, ProjectRole>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<ManagedUser[]>('/auth/users'), enabled: currentUser?.role === 'ADMIN' });
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get<ProjectMember[]>(`/projects/${projectId}/members`),
    enabled: Boolean(projectId) && currentUser?.role === 'ADMIN',
  });
  const membersByUser = useMemo(() => new Map<string, ProjectMember>((membersQuery.data ?? []).map((member) => [member.email.toLowerCase(), member] as const)), [membersQuery.data]);

  const createUser = useMutation({
    mutationFn: () => api.post<ManagedUser>('/auth/users', { name: name.trim(), email: email.trim(), password }),
    onSuccess: async (created) => {
      setName(''); setEmail(''); setPassword(''); setError('');
      setNotice(`账号“${created.name}”已创建。请再为其分配项目角色。`);
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : '账号创建失败'),
  });

  const assignRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) => {
      if (!projectId) throw new Error('请先选择项目');
      return api.post<ProjectMember>(`/projects/${projectId}/members`, { userId, role });
    },
    onSuccess: async (member) => {
      setError(''); setNotice(`已将 ${member.name} 设置为“${roleLabel(member.role)}”。`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-members', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : '项目角色分配失败'),
  });

  if (currentUser?.role !== 'ADMIN') {
    return <div className="page-wrap"><PageHeader eyebrow="SYSTEM / USERS" title="账号与项目权限" subtitle="仅系统管理员可维护用户账号与项目成员角色。" /><EmptyState title="没有管理权限" description="请使用系统管理员账号登录后维护账号与项目权限。" /></div>;
  }

  if (usersQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在加载账号列表…" /></div>;
  if (usersQuery.error) return <div className="page-wrap"><ErrorBlock message={(usersQuery.error as Error).message} retry={() => void usersQuery.refetch()} /></div>;

  const users = usersQuery.data ?? [];
  return <div className="page-wrap">
    <PageHeader eyebrow="SYSTEM / USERS & ROLES" title="账号与项目权限" subtitle="为不同经办人与核验人建立独立账号，避免业务提交人自审或自核验。" />
    {notice && <div className="success-notice"><ShieldCheck size={16} />{notice}</div>}
    {error && <div className="form-alert">{error}<button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><X size={14} /></button></div>}
    <div className="two-panel-grid">
      <section className="panel">
        <div className="panel-heading"><div><h3>创建业务账号</h3><p>新账号默认是普通用户；项目权限在下方按项目单独分配。</p></div><span className="panel-icon"><UserPlus size={18} /></span></div>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); setNotice(''); setError(''); createUser.mutate(); }}>
          <div className="field"><label>姓名 <b>*</b></label><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入真实姓名" /></div>
          <div className="field"><label>登录邮箱 <b>*</b></label><input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></div>
          <div className="field"><label>初始密码 <b>*</b></label><input required type="password" minLength={12} maxLength={200} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 位" /><small className="field-hint">请使用临时强密码，并通过安全渠道告知账号本人。</small></div>
          <Button type="submit" disabled={createUser.isPending || !name.trim() || !email.trim() || password.length < 12}><UserPlus size={15} />{createUser.isPending ? '创建中…' : '创建账号'}</Button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h3>项目成员分配</h3><p>选中的项目：账号角色只对当前项目生效。</p></div><span className="panel-icon"><Users size={18} /></span></div>
        {!projectId ? <EmptyState title="尚未选择项目" description="请从页面顶部选择一个项目，再分配项目角色。" /> : membersQuery.isLoading ? <LoadingBlock label="正在加载项目成员…" /> : membersQuery.error ? <ErrorBlock message={(membersQuery.error as Error).message} retry={() => void membersQuery.refetch()} /> : <>
          <div className="inline-notice"><KeyRound size={17} /><span>建议由经办人提交变更，另一名具备权限的负责人核验 C 类外部确认凭证。系统会在接口层阻止提交人自核验。</span></div>
          <div className="role-legend">项目角色：{projectRoles.map((role) => <span key={role.value}>{role.label}</span>)}</div>
        </>}
      </section>
    </div>
    <section className="panel user-table-panel">
      <div className="panel-heading"><div><h3>系统账号</h3><p>账号创建后还需加入具体项目，才能访问该项目业务。</p></div><span className="table-count">{users.length} 个账号</span></div>
      {!users.length ? <EmptyState title="暂无账号" description="请先创建至少两个不同账号，才能进行提交人与核验人分离测试。" /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>账号</th><th>全局权限</th><th>当前项目角色</th><th>创建日期</th><th>操作</th></tr></thead><tbody>{users.map((user) => {
        const member = membersByUser.get(user.email.toLowerCase());
        const selectedRole = roleDrafts[user.id] ?? member?.role ?? 'ESTIMATOR';
        return <tr key={user.id}>
          <td><strong className="table-primary-text">{user.name}</strong><small className="table-subtext">{user.email}</small></td>
          <td><StatusBadge status={user.role === 'ADMIN' ? 'ADMIN' : 'USER'} /><small className="table-subtext">{user.isActive ? '账号启用' : '账号停用'}</small></td>
          <td>{projectId ? <SelectField aria-label={`${user.name} 的项目角色`} value={selectedRole} onChange={(event) => setRoleDrafts((prev) => ({ ...prev, [user.id]: event.target.value as ProjectRole }))} disabled={!user.isActive}><option value="OWNER">项目负责人</option><option value="MANAGER">项目经理</option><option value="ESTIMATOR">预算/成本经办</option><option value="VIEWER">只读查看</option></SelectField> : <span className="text-muted">先选择项目</span>}</td>
          <td>{formatDate(user.createdAt)}</td>
          <td>{projectId ? <Button variant="secondary" disabled={!user.isActive || assignRole.isPending || (member?.role === selectedRole)} onClick={() => assignRole.mutate({ userId: user.id, role: selectedRole })}>{member ? '更新角色' : '加入项目'}</Button> : <span className="text-muted">—</span>}</td>
        </tr>;
      })}</tbody></table></div>}
    </section>
    <div className="data-note"><span className="note-mark">i</span><span>系统账号负责登录认证，项目角色负责业务授权。只有系统管理员可以创建账号；成员角色变更和账号创建均记录在审计日志中。</span></div>
  </div>;
}
