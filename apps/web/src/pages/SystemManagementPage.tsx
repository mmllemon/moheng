import { ArrowRight, FolderKanban, ShieldCheck, UserCog, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../auth-store';
import { PageHeader } from '../components/Ui';

type ManagementEntry = {
  title: string;
  eyebrow: string;
  description: string;
  detail: string;
  to: string;
  icon: typeof FolderKanban;
};

export default function SystemManagementPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const entries: ManagementEntry[] = [
    {
      title: '项目档案',
      eyebrow: 'PROJECT REGISTER',
      description: '维护项目基础档案，查看可访问的项目并进入对应成本工作台。',
      detail: '项目级业务数据仍按项目权限隔离',
      to: '/projects',
      icon: FolderKanban,
    },
    {
      title: '项目成员与权限',
      eyebrow: 'PROJECT MEMBERS',
      description: '为当前项目分配项目负责人、项目经理、预算/成本经办或只读角色。',
      detail: '成员角色仅对对应项目生效',
      to: '/system/members',
      icon: Users,
    },
    ...(user?.role === 'ADMIN' ? [{
      title: '系统账号管理',
      eyebrow: 'SYSTEM ACCOUNTS',
      description: '创建公司级登录账号，并查看账号身份与当前项目角色的关联。',
      detail: '仅系统管理员可以创建系统账号',
      to: '/system/accounts',
      icon: UserCog,
    }] : []),
  ];

  return <div className="page-wrap system-management-page">
    <PageHeader
      eyebrow="SYSTEM MANAGEMENT"
      title="系统管理工作台"
      subtitle="集中处理项目组织、成员授权与公司级账号管理。此处是统一管理入口，不代表独立数据库或独立业务系统。"
    />

    <section className="system-management-boundary" aria-label="管理边界说明">
      <div className="system-management-boundary-item">
        <span className="system-management-boundary-icon"><ShieldCheck size={18} /></span>
        <div><strong>项目级授权</strong><p>项目成员与角色按项目分别维护；项目负责人、项目经理的可操作范围仍由现有权限规则决定。</p></div>
      </div>
      <div className="system-management-boundary-item">
        <span className="system-management-boundary-icon"><UserCog size={18} /></span>
        <div><strong>公司级账号身份</strong><p>系统管理员身份与项目角色相互独立。菜单迁移不会自动授予新权限，服务端仍是最终校验边界。</p></div>
      </div>
    </section>

    <section className="section-block system-management-entry-section">
      <div className="section-heading"><div><h2>管理入口</h2><p>当前入口复用已有项目、成员和账号功能；尚未实现的管理能力不会伪装成可用功能。</p></div><span className="system-management-count">{entries.length} 个可用入口</span></div>
      <div className="system-management-grid">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return <button key={entry.to} type="button" className="system-management-card" onClick={() => navigate(entry.to)}>
            <span className="system-management-card-icon"><Icon size={19} strokeWidth={1.8} /></span>
            <span className="system-management-card-copy">
              <span className="system-management-card-eyebrow">{entry.eyebrow}</span>
              <strong>{entry.title}</strong>
              <span className="system-management-card-description">{entry.description}</span>
              <small>{entry.detail}</small>
            </span>
            <ArrowRight size={16} className="system-management-card-arrow" />
          </button>;
        })}
      </div>
    </section>

    <section className="panel system-management-roadmap">
      <div className="panel-heading"><div><h3>后续扩展边界</h3><p>根据实际岗位职责逐步增加，不提前制造空菜单或重复数据入口。</p></div><span className="panel-icon"><ShieldCheck size={18} /></span></div>
      <div className="system-management-roadmap-items"><span>角色与数据范围配置</span><span>审批流程配置</span><span>基础资料与字典</span><span>集成、备份与运行状态</span></div>
    </section>
  </div>;
}
