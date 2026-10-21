import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import CostWorkspaceLayout from './components/CostWorkspaceLayout';
import LoginPage from './pages/LoginPage';
import AccountSecurityStepPage from './pages/AccountSecurityStepPage';
import DashboardPage from './pages/DashboardPage';
const ReportStudioPage = lazy(() => import('./pages/ReportStudioPage'));
const ReportPreviewPage = lazy(() => import('./pages/ReportPreviewPage'));
const CostAssistantPage = lazy(() => import('./pages/CostAssistantPage'));
const AssistantProviderPage = lazy(() => import('./pages/AssistantProviderPage'));
const AppearanceSettingsPage = lazy(() => import('./pages/AppearanceSettingsPage'));
const SystemSecurityPage = lazy(() => import('./pages/SystemSecurityPage'));
const AccountSecurityPage = lazy(() => import('./pages/AccountSecurityPage'));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'));
const ReportCenterPage = lazy(() => import('./pages/ReportCenterPage'));
const ReportDesignerPage = lazy(() => import('./pages/ReportDesignerPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const ProjectMembersPage = lazy(() => import('./pages/ProjectMembersPage'));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage'));
const SystemManagementPage = lazy(() => import('./pages/SystemManagementPage'));
const SystemGovernancePage = lazy(() => import('./pages/SystemGovernancePage'));
const SystemOperationsPage = lazy(() => import('./pages/SystemOperationsPage'));
const SystemDictionariesPage = lazy(() => import('./pages/SystemDictionariesPage'));
const SystemParametersPage = lazy(() => import('./pages/SystemParametersPage'));
const SystemAuthorizationPage = lazy(() => import('./pages/SystemAuthorizationPage'));
const SystemPoliciesPage = lazy(() => import('./pages/SystemPoliciesPage'));
const BusinessPartiesPage = lazy(() => import('./pages/BusinessPartiesPage'));
const BusinessPartyDetailPage = lazy(() => import('./pages/BusinessPartyDetailPage'));
import ProjectOverviewPage from './pages/ProjectOverviewPage';
import ProjectsPage from './pages/ProjectsPage';
import ContractsPage from './pages/ContractsPage';
import DownstreamContractsPage from './pages/DownstreamContractsPage';
import DownstreamFinancePage from './pages/DownstreamFinancePage';
import DownstreamWorkspacePage from './pages/DownstreamWorkspacePage';
import OwnerFinancePage from './pages/OwnerFinancePage';
import BudgetPage from './pages/BudgetPage';
import CostsPage from './pages/CostsPage';
import ProgressBillsPage from './pages/ProgressBillsPage';
import ChangesPage from './pages/ChangesPage';
import AnalysisPage from './pages/AnalysisPage';
import { useAuthStore, useUiStore } from './auth-store';
import { api } from './api';
import { EmptyState, LoadingBlock } from './components/Ui';

function ProtectedRoute() {
  const token = useAuthStore((state) => state.accessToken);
  const clearSession = useAuthStore((state) => state.clearSession);
  const restrictedFlow = useAuthStore((state) => state.restrictedFlow);
  const [ready, setReady] = useState(Boolean(token));
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    let active = true;
    if (token) { setReady(true); return; }
    api.refreshSession().then((ok) => {
      if (!active) return;
      if (!ok) { clearSession(); navigate('/login', { replace: true, state: { from: location.pathname + location.search + location.hash } }); }
      setReady(true);
    }).catch(() => { if (active) { clearSession(); setReady(true); navigate('/login', { replace: true, state: { from: location.pathname + location.search + location.hash } }); } });
    return () => { active = false; };
  }, [token, clearSession, navigate, location.pathname, location.search, location.hash]);
  if (restrictedFlow) return <Navigate to="/account/security-step" replace />;
  if (!ready) return <div className="full-screen-loading"><LoadingBlock label="正在验证登录状态…" /></div>;
  if (!useAuthStore.getState().accessToken) return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  return <Outlet />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function NeedProject({ children }: { children: ReactNode }) {
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);
  const navigate = useNavigate();
  // The global layout fills the initial project selection from the accessible project list.
  if (!selectedProjectId) return <div className="page-wrap"><EmptyState title="先选择一个项目" description="目标成本、合同和成本记录均按项目管理。请先创建或选择项目。" action={() => navigate('/projects')} /></div>;
  return <>{children}</>;
}

function LegacyWorkspaceRedirect() {
  const location = useLocation();
  const suffix = location.pathname.replace(/^\/workspace(?=\/|$)/, '');
  const targetPath = suffix === '/members' ? '/projects/members' : `/cost${suffix}`;
  return <Navigate to={{ pathname: targetPath, search: location.search, hash: location.hash }} state={location.state} replace />;
}

function LegacySettingsUsersRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/system/accounts', search: location.search, hash: location.hash }} state={location.state} replace />;
}

export default function App() {
  return <Suspense fallback={<div className="full-screen-loading"><LoadingBlock label="正在加载页面…" /></div>}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/account/security-step" element={<AccountSecurityStepPage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="audit-logs" element={<AdminOnly><AuditLogsPage /></AdminOnly>} />
        <Route path="reports" element={<ReportCenterPage />} />
        <Route path="reports/designer" element={<ReportDesignerPage />} />
        <Route path="reports/studio" element={<Suspense fallback={<div className="page-wrap"><LoadingBlock label="正在加载报表工作室…" /></div>}><ReportStudioPage /></Suspense>} />
        <Route path="reports/preview" element={<Suspense fallback={<div className="page-wrap"><LoadingBlock label="正在加载报表预览…" /></div>}><ReportPreviewPage /></Suspense>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="parties" element={<BusinessPartiesPage />} />
        <Route path="parties/:id" element={<BusinessPartyDetailPage />} />
        <Route path="cost" element={<NeedProject><CostWorkspaceLayout /></NeedProject>}>
          <Route index element={<ProjectOverviewPage />} />
          <Route path="members" element={<Navigate to="/projects/members" replace />} />
          <Route path="contracts" element={<ContractsPage />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="progress-bills" element={<ProgressBillsPage />} />
          <Route path="changes" element={<ChangesPage />} />
          <Route path="downstream" element={<DownstreamWorkspacePage />} />
          <Route path="downstream-contracts" element={<Navigate to="/cost/downstream" replace />} />
          <Route path="downstream-finance" element={<Navigate to="/cost/downstream?view=finance" replace />} />
          <Route path="owner-finance" element={<OwnerFinancePage />} />
          <Route path="costs" element={<CostsPage />} />
          <Route path="analysis" element={<AnalysisPage />} />
          <Route path="assistant" element={<Suspense fallback={<div className="page-wrap"><LoadingBlock label="正在加载成本助手…" /></div>}><CostAssistantPage /></Suspense>} />
        </Route>
        <Route path="system" element={<AdminOnly><SystemManagementPage /></AdminOnly>} />
        <Route path="system/security" element={<AdminOnly><SystemSecurityPage /></AdminOnly>} />
        <Route path="system/authorization" element={<AdminOnly><SystemAuthorizationPage /></AdminOnly>} />
        <Route path="system/policies" element={<AdminOnly><SystemPoliciesPage /></AdminOnly>} />
        <Route path="system/governance" element={<AdminOnly><SystemGovernancePage /></AdminOnly>} />
        <Route path="system/operations" element={<AdminOnly><SystemOperationsPage /></AdminOnly>} />
        <Route path="system/dictionaries" element={<AdminOnly><SystemDictionariesPage /></AdminOnly>} />
        <Route path="system/parameters" element={<AdminOnly><SystemParametersPage /></AdminOnly>} />
        <Route path="system/accounts" element={<AdminOnly><UserManagementPage /></AdminOnly>} />
        <Route path="system/assistant" element={<AdminOnly><AssistantProviderPage /></AdminOnly>} />
        <Route path="projects/members" element={<NeedProject><ProjectMembersPage /></NeedProject>} />
        <Route path="account/security" element={<AccountSecurityPage />} />
        <Route path="settings" element={<Navigate to="/settings/appearance" replace />} />
        <Route path="settings/appearance" element={<Suspense fallback={<div className="page-wrap"><LoadingBlock label="正在打开界面设置…" /></div>}><AppearanceSettingsPage /></Suspense>} />
        <Route path="system/members" element={<Navigate to="/projects/members" replace />} />
        <Route path="workspace" element={<LegacyWorkspaceRedirect />} />
        <Route path="workspace/*" element={<LegacyWorkspaceRedirect />} />
        {/* Compatibility redirects preserve links/bookmarks from earlier releases. */}
        <Route path="contracts" element={<Navigate to="/cost/contracts" replace />} />
        <Route path="downstream-contracts" element={<Navigate to="/cost/downstream" replace />} />
        <Route path="downstream-finance" element={<Navigate to="/cost/downstream?view=finance" replace />} />
        <Route path="budget" element={<Navigate to="/cost/budget" replace />} />
        <Route path="costs" element={<Navigate to="/cost/costs" replace />} />
        <Route path="progress-bills" element={<Navigate to="/cost/progress-bills" replace />} />
        <Route path="changes" element={<Navigate to="/cost/changes" replace />} />
        <Route path="analysis" element={<Navigate to="/cost/analysis" replace />} />
        <Route path="settings/users" element={<LegacySettingsUsersRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Route>
  </Routes></Suspense>;
}
