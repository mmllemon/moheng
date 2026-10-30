/**
 * Layout 的导航与快捷操作静态数据。
 *
 * 从 Layout.tsx 拆出：纯数据/常量定义，无副作用，逻辑零改动。
 */

import {
  LayoutDashboard, FileSpreadsheet, BellRing, Building2, ClipboardList, FolderKanban, Users,
  UserCog, ShieldCheck, Workflow, BookOpen, SlidersHorizontal, Sparkles, ServerCog, History,
  Palette, Wallet, HandCoins, ReceiptText, FileText,
} from 'lucide-react';

export type NavigationItem = { to: string; label: string; icon: typeof LayoutDashboard; group: '经营中心' | '工作台' | '项目管理' | '系统管理'; end?: boolean; adminOnly?: boolean };
export const navigation: NavigationItem[] = [
  { to: '/', label: '经营总览', icon: LayoutDashboard, group: '经营中心', end: true },
  { to: '/reports', label: '报表中心', icon: FileSpreadsheet, group: '经营中心', end: true },
  { to: '/notifications', label: '待办与预警', icon: BellRing, group: '经营中心', end: true },
  { to: '/parties', label: '往来单位库', icon: Building2, group: '经营中心', end: false },
  { to: '/cost', label: '成本工作台', icon: ClipboardList, group: '工作台', end: false },
  { to: '/projects', label: '项目档案', icon: FolderKanban, group: '项目管理', end: true },
  { to: '/projects/members', label: '项目成员与权限', icon: Users, group: '项目管理', end: true },
  // 「系统管理」导航项已移除（2026-10-23）。
  // 入口统一走侧栏页脚的齿轮按钮（data-tooltip="系统设置"），
  // 避免同一个入口在导航列表和页脚各出现一次。
];

export const systemNavigation: NavigationItem[] = [
  { to: '/system', label: '概览', icon: LayoutDashboard, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/accounts', label: '账号管理', icon: UserCog, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/security', label: '登录安全', icon: ShieldCheck, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/authorization', label: '授权复核', icon: Users, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/policies', label: '权限与流程', icon: Workflow, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/governance', label: '组织规则', icon: Workflow, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/dictionaries', label: '基础字典', icon: BookOpen, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/parameters', label: '参数配置', icon: SlidersHorizontal, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/assistant', label: 'AI 助手', icon: Sparkles, group: '系统管理', end: true, adminOnly: true },
  { to: '/system/operations', label: '运维备份', icon: ServerCog, group: '系统管理', end: true, adminOnly: true },
  { to: '/audit-logs', label: '操作追溯', icon: History, group: '系统管理', end: true, adminOnly: true },
];
export const appearanceSettingsItem: NavigationItem = { to: '/settings/appearance', label: '界面', icon: Palette, group: '系统管理', end: true };
export const systemGroups = [
  { label: '系统', items: systemNavigation.slice(0, 3) },
  { label: '权限与规则', items: systemNavigation.slice(3, 5) },
  { label: '组织与数据', items: systemNavigation.slice(5, 8) },
  { label: '智能与运维', items: systemNavigation.slice(8) },
];
export const primaryGroups: NavigationItem['group'][] = ['经营中心', '工作台', '项目管理'];
export const settingsSearchAliases: Record<string, string[]> = {
  '/settings/appearance': ['界面', '外观', '主题', '图标', '字体', '纸纹', '纹理', '密度', '动效', 'theme', 'appearance', 'font'],
  '/system': ['系统', '概览', '运行状态', '版本'],
  '/system/accounts': ['账号', '用户', '成员', '角色', '密码', '权限'],
  '/system/security': ['登录', '安全', 'mfa', '双因素', '会话', '密码策略'],
  '/system/authorization': ['授权', '复核', '权限矩阵', '项目权限'],
  '/system/policies': ['权限', '流程', '审批', '策略', '角色'],
  '/system/governance': ['组织', '规则', '部门', '治理'],
  '/system/dictionaries': ['字典', '分类', '选项', '基础数据', '枚举'],
  '/system/parameters': ['参数', '配置', '版本', '全局', '项目覆盖', '草稿'],
  '/system/assistant': ['ai', '助手', '模型', '供应商', 'api', '密钥', 'openai'],
  '/system/operations': ['运维', '备份', '恢复', '演练', '数据库', '磁盘', '任务'],
  '/audit-logs': ['审计', '日志', '操作记录', '追溯'],
};
export const costWorkspacePages = [
  { to: '/cost', label: '驾驶舱' },
  { to: '/cost/contracts', label: '主合同' },
  { to: '/cost/budget', label: '预算成本' },
  { to: '/cost/progress-bills', label: '进度款' },
  { to: '/cost/changes', label: '变更签证' },
  { to: '/cost/owner-finance', label: '结算与应收' },
  { to: '/cost/downstream', label: '分供合同' },
  { to: '/cost/costs', label: '实际成本' },
  { to: '/cost/analysis', label: '成本分析' },
];
export type QuickItem = { kind: 'page' | 'project'; id: string; title: string; sub: string; to: string };
export type CommandScope = 'all' | 'page' | 'project';
export type QuickActionCategory = 'all' | 'cost' | 'funds' | 'contract';
export const quickActionCategories: Array<{ key: QuickActionCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'cost', label: '成本' },
  { key: 'funds', label: '资金' },
  { key: 'contract', label: '合同' },
];
export const quickActions: Array<{ category: Exclude<QuickActionCategory, 'all'>; title: string; description: string; to: string; icon: typeof Wallet }> = [
  { category: 'cost', title: '新增成本记录', description: '登记人工、材料、机械及其他费用', to: '/cost/costs', icon: Wallet },
  { category: 'funds', title: '进度款管理', description: '业主申报、审批与回款登记', to: '/cost/progress-bills', icon: HandCoins },
  { category: 'funds', title: '竣工结算与应收', description: '最终结算、应收余额与到账核销', to: '/cost/owner-finance', icon: ReceiptText },
  { category: 'contract', title: '分供合同与付款', description: '分包 / 采购 / 租赁合同与支付台账', to: '/cost/downstream', icon: FileText },
  { category: 'funds', title: '结算与应付账款', description: '确认结算、应付核销、质保金与发票核对', to: '/cost/downstream?view=finance', icon: ReceiptText },
  { category: 'contract', title: '变更签证', description: '查看送审与核定状态', to: '/cost/changes', icon: Workflow },
];
