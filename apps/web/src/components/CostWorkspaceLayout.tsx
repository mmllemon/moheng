import { useLayoutEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity, Banknote, ClipboardList, FileSignature, FolderKanban, HandCoins, ReceiptText, Workflow, FileCheck2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Tab = { to: string; label: string; icon: LucideIcon };

/** 全部标签，顺序即滑块索引顺序。对齐 hana 的 tabs 定义表 —— 扁平列表，
    选中态靠滑块位移，不靠文字变色。 */
const ALL_TABS: Tab[] = [
  { to: '/cost', label: '驾驶舱', icon: FolderKanban },
  { to: '/cost/contracts', label: '主合同', icon: FileSignature },
  { to: '/cost/progress-bills', label: '进度款', icon: HandCoins },
  { to: '/cost/changes', label: '变更签证', icon: Workflow },
  { to: '/cost/owner-finance', label: '结算与应收', icon: FileCheck2 },
  { to: '/cost/budget', label: '预算成本', icon: ClipboardList },
  { to: '/cost/downstream', label: '分供合同', icon: Banknote },
  { to: '/cost/costs', label: '实际成本', icon: ReceiptText },
  { to: '/cost/analysis', label: '成本分析', icon: Activity },
];

/**
 * 成本工作台底栏 —— 对齐 hana 的滑块切换：
 *
 *   ._tabs_22ed1      display:grid; grid-template-columns:repeat(N, minmax(0,1fr));
 *                     gap:2px; padding:2px; background:--overlay-subtle;
 *                     border:1px solid --overlay-light; radius-sm×scale
 *   ._tabSlider_f4978 position:absolute; inset:2px auto 2px 2px;
 *                     width:calc((100% - (N+1)*2px)/N);
 *                     transform:translateX(calc(var(--slider-index) * (100% + 2px)))
 *   ._tab_72cc3       height:20px; fs-hint; color:--text-muted
 *   ._tabActive_6f0df color:--text-muted   ← 选中态不变色，只移动滑块
 *
 * 宽度上限对齐 hana 的 --chat-input-column-width：
 *   --chat-column-width: 720px; --chat-input-column-extra: 1.25rem
 *   → 740px（比对话列宽多 20px）
 *
 * 定位：dock 排在 content 之后，用 sticky bottom:0 钉在主内容区底部。
 * 不能用 fixed（会盖住右侧工作区，实测 tabs right 1296 > panel left 1200），
 * 也不能用 absolute（.cost-workspace 随内容长高，会被推到页面外）。
 */
export default function CostWorkspaceLayout() {
  const location = useLocation();
  const [ready, setReady] = useState(false);

  /** 当前激活索引；未匹配到时退回 0（驾驶舱） */
  const activeIndex = Math.max(
    0,
    ALL_TABS.findIndex((tab) => (tab.to === '/cost' ? location.pathname === '/cost' : location.pathname.startsWith(tab.to))),
  );

  /** 布局就绪后再开过渡，避免首帧从 0 滑到目标位置 */
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="cost-workspace">
      <div className="cost-workspace-content"><Outlet /></div>
      <div className="cost-workspace-dock">
        <div
          className="cost-workspace-tabs"
          role="tablist"
          aria-label="成本工作台业务导航"
          data-ready={ready ? '' : undefined}
          style={{
            ['--tab-count' as string]: String(ALL_TABS.length),
            ['--slider-index' as string]: String(activeIndex),
          }}
        >
          <div className="cost-workspace-tab-slider" aria-hidden="true" />
          {ALL_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = ALL_TABS[activeIndex]?.to === tab.to;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/cost'}
                role="tab"
                aria-selected={active}
                className={`cost-workspace-tab${active ? ' is-active' : ''}`}
              >
                <Icon size={14} strokeWidth={1.8} />
                <span>{tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>
    </div>
  );
}
