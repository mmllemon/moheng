import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity, Banknote, ClipboardList, FileSignature, FolderKanban, HandCoins, ReceiptText, Workflow, FileCheck2, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const incomeTabs = [
  { to: '/workspace/contracts', label: '业主主合同', icon: FileSignature },
  { to: '/workspace/progress-bills', label: '进度款', icon: HandCoins },
  { to: '/workspace/changes', label: '变更签证', icon: Workflow },
  { to: '/workspace/owner-finance', label: '竣工结算与应收', icon: FileCheck2 },
];
const costTabs = [
  { to: '/workspace/budget', label: '预算与目标成本', icon: ClipboardList },
  { to: '/workspace/downstream', label: '分供合同与结算', icon: Banknote },
  { to: '/workspace/costs', label: '实际成本', icon: ReceiptText },
  { to: '/workspace/analysis', label: '成本分析', icon: Activity },
  { to: '/workspace/members', label: '项目成员', icon: Users },
];
function TabLink({ tab }: { tab: { to: string; label: string; icon: LucideIcon } }) {
  const Icon = tab.icon;
  return <NavLink to={tab.to} end={tab.to === '/workspace'} className={({ isActive }) => `workspace-tab ${isActive ? 'active' : ''}`}><Icon size={15} strokeWidth={1.8} /><span>{tab.label}</span></NavLink>;
}
export default function ProjectWorkspaceLayout() {
  return <div className="project-workspace">
    <nav className="project-workspace-tabs" aria-label="项目业务工作台">
      <div className="workspace-nav-overview"><TabLink tab={{ to: '/workspace', label: '项目驾驶舱', icon: FolderKanban }} /></div>
      <div className="workspace-nav-group workspace-nav-income" role="group" aria-label="业主侧业务"><div className="workspace-nav-group-tabs">{incomeTabs.map((tab) => <TabLink key={tab.to} tab={tab} />)}</div></div>
      <span className="workspace-nav-separator" aria-hidden="true"><span /></span>
      <div className="workspace-nav-group workspace-nav-cost" role="group" aria-label="成本与支出业务"><div className="workspace-nav-group-tabs">{costTabs.map((tab) => <TabLink key={tab.to} tab={tab} />)}</div></div>
    </nav>
    <div className="workspace-content"><Outlet /></div>
  </div>;
}
