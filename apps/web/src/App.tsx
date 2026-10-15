import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import CostWorkspaceLayout from './components/CostWorkspaceLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AuditLogsPage from './pages/AuditLogsPage';
import ReportCenterPage from './pages/ReportCenterPage';
import ReportDesignerPage from './pages/ReportDesignerPage';
const ReportStudioPage = lazy(() => import('./pages/ReportStudioPage'));
const ReportPreviewPage = lazy(() => import('./pages/ReportPreviewPage'));
import NotificationsPage from './pages/NotificationsPage';
import ProjectMembersPage from './pages/ProjectMembersPage';
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
import UserManagementPage from './pages/UserManagementPage';
import SystemManagementPage from './pages/SystemManagementPage';
import BusinessPartiesPage from './pages/BusinessPartiesPage';
import BusinessPartyDetailPage from './pages/BusinessPartyDetailPage';
import { useAuthStore, useUiStore } from './auth-store';
import { api } from './api';
import { EmptyState, LoadingBlock } from './components/Ui';

function ProtectedRoute() {
  const token = useAuthStore((state) => state.accessToken);
  const clearSession = useAuthStore((state) => state.clearSession);
  const [ready, setReady] = useState(Boolean(token));
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    if (token) { setReady(true); return; }
    api.refreshSession().then((ok) => {
      if (!active) return;
      if (!ok) { clearSession(); navigate('/login', { replace: true }); }
      setReady(true);
    }).catch(() => { if (active) { clearSession(); setReady(true); navigate('/login', { replace: true }); } });
    return () => { active = false; };
  }, [token, clearSession, navigate]);
  if (!ready) return <div className="full-screen-loading"><LoadingBlock label="正在验证登录状态…" /></div>;
  if (!useAuthStore.getState().accessToken) return <Navigate to="/login" replace />;
  return <Outlet />;
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
  const targetPath = suffix === '/members' ? '/system/members' : `/cost${suffix}`;
  return <Navigate to={{ pathname: targetPath, search: location.search, hash: location.hash }} state={location.state} replace />;
}

function LegacySettingsUsersRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/system/accounts', search: location.search, hash: location.hash }} state={location.state} replace />;
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="reports" element={<ReportCenterPage />} />
        <Route path="reports/designer" element={<ReportDesignerPage />} />
        <Route path="reports/studio" element={<Suspense fallback={<div className="page-wrap"><LoadingBlock label="正在加载报表工作室…" /></div>}><ReportStudioPage /></Suspense>} />
        <Route path="reports/preview" element={<Suspense fallback={<div className="page-wrap"><LoadingBlock label="正在加载报表预览…" /></div>}><ReportPreviewPage /></Suspense>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="parties" element={<BusinessPartiesPage />} />
        <Route path="parties/:id" element={<BusinessPartyDetailPage />} />
        <Route path="cost" element={<NeedProject><CostWorkspaceLayout /></NeedProject>}>
          <Route index element={<ProjectOverviewPage />} />
          <Route path="members" element={<Navigate to="/system/members" replace />} />
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
        </Route>
        <Route path="system" element={<SystemManagementPage />} />
        <Route path="system/members" element={<NeedProject><ProjectMembersPage /></NeedProject>} />
        <Route path="system/accounts" element={<UserManagementPage />} />
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
  </Routes>;
}
