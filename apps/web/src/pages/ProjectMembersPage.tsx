import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useAuthStore, useUiStore } from '../auth-store';
import type { Project } from '../types';
import SelectField from '../components/SelectField';
import { Button, EmptyState, ErrorBlock, LoadingBlock, PageHeader, StatusBadge } from '../components/Ui';

type ProjectRole = 'OWNER' | 'MANAGER' | 'ESTIMATOR' | 'VIEWER';
type Member = { id: string; userId: string; name: string; email: string; role: ProjectRole; createdAt: string };
const roleChoices: Array<{ value: ProjectRole; label: string }> = [
  { value: 'OWNER', label: '项目负责人' }, { value: 'MANAGER', label: '项目经理' }, { value: 'ESTIMATOR', label: '预算/成本经办' }, { value: 'VIEWER', label: '只读查看' },
];
const roleName = (role: ProjectRole) => roleChoices.find((item) => item.value === role)?.label ?? role;

export default function ProjectMembersPage() {
  const projectId = useUiStore((state) => state.selectedProjectId);
  const currentUser = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<ProjectRole>('ESTIMATOR');
  const [roleDrafts, setRoleDrafts] = useState<Record<string, ProjectRole>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const projectQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const memberQuery = useQuery({ queryKey: ['project-members', projectId], queryFn: () => api.get<Member[]>(`/projects/${projectId}/members`), enabled: Boolean(projectId) });
  const members = memberQuery.data ?? [];
  const self = members.find((member) => member.userId === currentUser?.id);
  const canManage = currentUser?.role === 'ADMIN' || self?.role === 'OWNER' || self?.role === 'MANAGER';
  const assignableRoles = useMemo(() => currentUser?.role === 'ADMIN'
    ? roleChoices
    : self?.role === 'OWNER' ? roleChoices.filter((role) => role.value !== 'OWNER')
      : roleChoices.filter((role) => role.value === 'ESTIMATOR' || role.value === 'VIEWER'), [currentUser?.role, self?.role]);

  const invalidate = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['project-members', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['projects'] }),
    queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    queryClient.invalidateQueries({ queryKey: ['audit-logs'] }),
  ]);
  const assign = useMutation({
    mutationFn: ({ userId, email: memberEmail, role }: { userId?: string; email?: string; role: ProjectRole }) => {
      if (!projectId) throw new Error('请先选择项目');
      return api.post<Member>(`/projects/${projectId}/members`, { ...(userId ? { userId } : { email: memberEmail }), role });
    },
    onSuccess: async (member) => { setError(''); setNotice(`已将 ${member.name} 设置为“${roleName(member.role)}”。`); setEmail(''); await invalidate(); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : '成员角色更新失败'),
  });
  function addMember(event: FormEvent) { event.preventDefault(); setError(''); setNotice(''); assign.mutate({ email: email.trim(), role: newRole }); }

  if (!projectId) return <div className="page-wrap"><PageHeader eyebrow="SYSTEM / PROJECT ACCESS" title="项目成员与权限" subtitle="项目角色决定该项目内的业务访问与操作权限。" /><EmptyState title="尚未选择项目" description="请先从顶栏选择具体项目，再维护成员角色。" /></div>;
  if (projectQuery.isLoading || memberQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在加载项目成员与权限…" /></div>;
  if (projectQuery.error || memberQuery.error) return <div className="page-wrap"><ErrorBlock message={String(projectQuery.error ?? memberQuery.error ?? '加载失败')} retry={() => { void projectQuery.refetch(); void memberQuery.refetch(); }} /></div>;
  const project = (projectQuery.data ?? []).find((item) => item.id === projectId);

  return <div className="page-wrap project-members-page">
    <PageHeader eyebrow="SYSTEM / PROJECT MEMBERS & ROLES" title="项目成员与权限" subtitle="按项目分配角色。全局账号身份与项目角色相互独立；服务端仍会执行授权校验。" />
    <section className="panel members-project-banner"><span className="members-project-icon"><Users size={19} /></span><div><small>当前项目</small><strong>{project?.name ?? projectId}</strong><code>{project?.code ?? ''}</code></div><StatusBadge status={project?.status ?? 'CONSTRUCTION'} /></section>
    {notice && <div className="success-notice"><ShieldCheck size={16} />{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {error && <div className="form-alert">{error}<button className="icon-button" aria-label="关闭错误" onClick={() => setError('')}><X size={14} /></button></div>}
    <div className="members-two-column">
      <section className="panel members-invite-panel"><div className="panel-heading"><div><h3><UserPlus size={16} />添加项目成员</h3><p>通过已注册的登录邮箱定位账号，不公开全公司账号目录。</p></div><span className="panel-icon"><KeyRound size={18} /></span></div>
        {!canManage ? <div className="inline-notice"><ShieldCheck size={16} /><span>你当前在本项目的角色为“{self ? roleName(self.role) : '未识别'}”，可以查看成员，但不能分配角色。</span></div> : <form className="form-stack" onSubmit={addMember}><div className="field"><label>成员登录邮箱 <b>*</b></label><input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" autoComplete="off" /></div><div className="field"><label>项目角色 <b>*</b></label><SelectField value={newRole} onChange={(event) => setNewRole(event.target.value as ProjectRole)} aria-label="新成员项目角色">{assignableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</SelectField></div><Button type="submit" disabled={assign.isPending || !email.trim()}><UserPlus size={15} />{assign.isPending ? '正在分配…' : '添加成员'}</Button><small className="field-hint">邮箱必须对应已启用账号。项目负责人不能通过本页面任意创建系统账号。</small></form>}
      </section>
      <section className="panel members-role-guide"><div className="panel-heading"><div><h3>角色边界</h3><p>授权只在当前项目生效。</p></div><span className="panel-icon"><ShieldCheck size={18} /></span></div><div className="members-role-guide-list"><div><strong>项目负责人</strong><p>可管理当前项目成员，并分配经理、经办和只读角色。</p></div><div><strong>项目经理</strong><p>可分配预算/成本经办和只读角色，不能任命项目负责人。</p></div><div><strong>预算/成本经办</strong><p>可处理授权范围内业务；不能通过本页提升自己的项目角色。</p></div><div><strong>只读查看</strong><p>适合查看经营数据与审计记录，不具备业务写入权限。</p></div></div></section>
    </div>
    <section className="panel members-table-panel"><div className="panel-heading"><div><h3>当前项目成员</h3><p>共 {members.length} 人 · 角色修改和添加操作均写入审计记录。</p></div><span className="table-count">{members.length} 个成员</span></div>
      {!members.length ? <EmptyState title="当前项目没有可列出的成员" description="请以系统管理员检查项目初始化成员记录。" /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>成员</th><th>登录邮箱</th><th>当前角色</th><th>加入时间</th><th>角色调整</th></tr></thead><tbody>{members.map((member) => { const selected = roleDrafts[member.userId] ?? member.role; const ownerCount = members.filter((candidate) => candidate.role === 'OWNER').length; const editable = canManage && selected !== member.role && assignableRoles.some((role) => role.value === selected) && (currentUser?.role === 'ADMIN' || member.role !== 'OWNER' || ownerCount > 1); return <tr key={member.id}><td><strong className="table-primary-text">{member.name}</strong>{member.userId === currentUser?.id && <small className="table-subtext">当前账号</small>}</td><td>{member.email}</td><td><StatusBadge status={member.role} /><small className="table-subtext">{roleName(member.role)}</small></td><td>{member.createdAt ? new Date(member.createdAt).toLocaleDateString('zh-CN') : '—'}</td><td>{canManage ? <div className="member-role-action"><SelectField aria-label={`${member.name} 的角色`} value={selected} onChange={(event) => setRoleDrafts((state) => ({ ...state, [member.userId]: event.target.value as ProjectRole }))}>{roleChoices.filter((role) => currentUser?.role === 'ADMIN' || role.value !== 'OWNER' || role.value === member.role).map((role) => <option key={role.value} value={role.value} disabled={role.value === 'OWNER' && currentUser?.role !== 'ADMIN'}>{role.label}</option>)}</SelectField><Button variant="secondary" disabled={assign.isPending || selected === member.role || !editable} onClick={() => assign.mutate({ userId: member.userId, role: selected })}>保存</Button></div> : <span className="text-muted">仅查看</span>}</td></tr>; })}</tbody></table></div>}
    </section>
    <div className="data-note"><span className="note-mark">i</span><span>为了避免项目失去负责人，当前版本不提供直接删除成员的操作；最后一名项目负责人不能被降为其他角色。需要移交负责人时，先添加另一名负责人，再调整原负责人角色。</span></div>
  </div>;
}
