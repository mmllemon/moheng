import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProjectWorkspaceLayout from './components/ProjectWorkspaceLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
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

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="parties" element={<BusinessPartiesPage />} />
        <Route path="parties/:id" element={<BusinessPartyDetailPage />} />
        <Route path="workspace" element={<NeedProject><ProjectWorkspaceLayout /></NeedProject>}>
          <Route index element={<ProjectOverviewPage />} />
          <Route path="contracts" element={<ContractsPage />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="progress-bills" element={<ProgressBillsPage />} />
          <Route path="changes" element={<ChangesPage />} />
          <Route path="downstream" element={<DownstreamWorkspacePage />} />
          <Route path="downstream-contracts" element={<Navigate to="/workspace/downstream" replace />} />
          <Route path="downstream-finance" element={<Navigate to="/workspace/downstream?view=finance" replace />} />
          <Route path="owner-finance" element={<OwnerFinancePage />} />
          <Route path="costs" element={<CostsPage />} />
          <Route path="analysis" element={<AnalysisPage />} />
        </Route>
        {/* Compatibility redirects preserve links/bookmarks from v1.2.x. */}
        <Route path="contracts" element={<Navigate to="/workspace/contracts" replace />} />
        <Route path="downstream-contracts" element={<Navigate to="/workspace/downstream" replace />} />
        <Route path="downstream-finance" element={<Navigate to="/workspace/downstream?view=finance" replace />} />
        <Route path="budget" element={<Navigate to="/workspace/budget" replace />} />
        <Route path="costs" element={<Navigate to="/workspace/costs" replace />} />
        <Route path="progress-bills" element={<Navigate to="/workspace/progress-bills" replace />} />
        <Route path="changes" element={<Navigate to="/workspace/changes" replace />} />
        <Route path="analysis" element={<Navigate to="/workspace/analysis" replace />} />
        <Route path="settings/users" element={<UserManagementPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Route>
  </Routes>;
}
