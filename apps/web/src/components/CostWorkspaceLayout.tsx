import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api';
import {
  Activity, Banknote, ClipboardList, FileSignature, FolderKanban, HandCoins, ReceiptText, Workflow, FileCheck2, Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const incomeTabs = [
  { to: '/cost/contracts', label: '业主主合同', icon: FileSignature },
  { to: '/cost/progress-bills', label: '进度款', icon: HandCoins },
  { to: '/cost/changes', label: '变更签证', icon: Workflow },
  { to: '/cost/owner-finance', label: '竣工结算与应收', icon: FileCheck2 },
];
const costTabs = [
  { to: '/cost/budget', label: '预算与目标成本', icon: ClipboardList },
  { to: '/cost/downstream', label: '分供合同与结算', icon: Banknote },
  { to: '/cost/costs', label: '实际成本', icon: ReceiptText },
  { to: '/cost/analysis', label: '成本分析', icon: Activity },
];
function TabLink({ tab }: { tab: { to: string; label: string; icon: LucideIcon } }) {
  const Icon = tab.icon;
  return <NavLink to={tab.to} end={tab.to === '/cost'} className={({ isActive }) => `cost-workspace-tab ${isActive ? 'active' : ''}`}><Icon size={15} strokeWidth={1.8} /><span>{tab.label}</span></NavLink>;
}
export default function CostWorkspaceLayout() {
  const location = useLocation();
  const navRef = useRef<HTMLElement | null>(null);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    api.get<{ enabled: boolean }>('/assistant-poc/status')
      .then((status) => { if (current) setAssistantEnabled(status.enabled); })
      .catch(() => { if (current) setAssistantEnabled(false); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('.cost-workspace-tab.active');
    if (!nav || !active) return;
    const target = active.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
    nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [location.pathname]);

  return <div className="cost-workspace">
    <nav ref={navRef} className="cost-workspace-tabs" aria-label="成本工作台业务导航">
      <div className="cost-workspace-nav-overview"><TabLink tab={{ to: '/cost', label: '项目驾驶舱', icon: FolderKanban }} /></div>
      <div className="cost-workspace-nav-group cost-workspace-nav-income" role="group" aria-label="业主侧业务"><div className="cost-workspace-nav-group-tabs">{incomeTabs.map((tab) => <TabLink key={tab.to} tab={tab} />)}</div></div>
      {assistantEnabled && <><span className="cost-workspace-nav-separator" aria-hidden="true"><span /></span><div className="cost-workspace-nav-group cost-workspace-nav-assistant" role="group" aria-label="智能分析"><div className="cost-workspace-nav-group-tabs"><TabLink tab={{ to: '/cost/assistant', label: '成本助手', icon: Sparkles }} /></div></div></>}
      <span className="cost-workspace-nav-separator" aria-hidden="true"><span /></span>
      <div className="cost-workspace-nav-group cost-workspace-nav-cost" role="group" aria-label="成本与支出业务"><div className="cost-workspace-nav-group-tabs">{costTabs.map((tab) => <TabLink key={tab.to} tab={tab} />)}</div></div>
    </nav>
    <div className="cost-workspace-content"><Outlet /></div>
  </div>;
}
