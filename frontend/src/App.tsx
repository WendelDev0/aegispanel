import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { Navbar } from './components/Navbar.js';
import { AuthPage } from './pages/AuthPage.js';
import { api, persistSession, clearSession } from './services/api.js';
import { socket, connectSocket, disconnectSocket } from './services/socket.js';
import { useRoute } from './hooks/useRoute.js';
import { OverviewData, SystemStats, User } from './types/index.js';
import { ToastProvider } from './components/Toast.js';
import { ConfirmProvider } from './components/ConfirmModal.js';

/**
 * Sections are code-split.
 *
 * Each section loads on first visit for optimum initial load time.
 */
const DashboardPage = lazy(() => import('./pages/DashboardPage.js').then(m => ({ default: m.DashboardPage })));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage.js').then(m => ({ default: m.TemplatesPage })));
const AppsPage = lazy(() => import('./pages/AppsPage.js').then(m => ({ default: m.AppsPage })));
const AppDetailPage = lazy(() => import('./pages/AppDetailPage.js').then(m => ({ default: m.AppDetailPage })));
const NodesPage = lazy(() => import('./pages/NodesPage.js').then(m => ({ default: m.NodesPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.js').then(m => ({ default: m.AnalyticsPage })));
const DatabasesPage = lazy(() => import('./pages/DatabasesPage.js').then(m => ({ default: m.DatabasesPage })));
const ContainersPage = lazy(() => import('./pages/ContainersPage.js').then(m => ({ default: m.ContainersPage })));
const DomainsPage = lazy(() => import('./pages/DomainsPage.js').then(m => ({ default: m.DomainsPage })));
const TerminalPage = lazy(() => import('./pages/TerminalPage.js').then(m => ({ default: m.TerminalPage })));
const SystemMonitorPage = lazy(() => import('./pages/SystemMonitorPage.js').then(m => ({ default: m.SystemMonitorPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage.js').then(m => ({ default: m.SettingsPage })));
const HelpPage = lazy(() => import('./pages/HelpPage.js').then(m => ({ default: m.HelpPage })));
const FileManagerPage = lazy(() => import('./pages/FileManagerPage.js').then(m => ({ default: m.FileManagerPage })));
const QueryStudioPage = lazy(() => import('./pages/QueryStudioPage.js').then(m => ({ default: m.QueryStudioPage })));
const FirewallPage = lazy(() => import('./pages/FirewallPage.js').then(m => ({ default: m.FirewallPage })));
const BackupsPage = lazy(() => import('./pages/BackupsPage.js').then(m => ({ default: m.BackupsPage })));
const CronPage = lazy(() => import('./pages/CronPage.js').then(m => ({ default: m.CronPage })));

const PageFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

export function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('aegis_token'));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('aegis_user');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      localStorage.removeItem('aegis_user');
      return null;
    }
  });

  const [activeTab, setActiveTab, routeParam] = useRoute();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [realtimeStats, setRealtimeStats] = useState<SystemStats | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const fetchOverview = async () => {
    if (!token) return;
    try {
      const res = await api.get('/system/overview');
      setOverview(res.data);
      if (!realtimeStats) {
        setRealtimeStats(res.data.system);
      }
    } catch (err) {
      console.error('Failed to load overview:', err);
    }
  };

  useEffect(() => {
    if (!token) {
      disconnectSocket();
      return;
    }

    fetchOverview();
    connectSocket();

    const onMetrics = (metrics: SystemStats) => setRealtimeStats(metrics);
    socket.on('system:metrics', onMetrics);

    return () => {
      socket.off('system:metrics', onMetrics);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(fetchOverview, 10000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .get('/auth/me')
      .then((res) => {
        if (cancelled || !res.data?.user) return;
        setUser(res.data.user);
        persistSession(token, res.data.user);
      })
      .catch(() => {
        /* 401 interceptor handles expiry */
      });

    const refreshMs = 20 * 60 * 1000;
    const refreshTimer = setInterval(async () => {
      try {
        const res = await api.post('/auth/refresh', {});
        persistSession(res.data.token, res.data.user);
        setToken(res.data.token);
        if (res.data.user) setUser(res.data.user);
        disconnectSocket();
        connectSocket();
      } catch {
        /* interceptor logs out on hard failure */
      }
    }, refreshMs);

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  }, [token]);

  const handleLoginSuccess = (newUser: any, newToken: string) => {
    persistSession(newToken, newUser);
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      /* still clear locally */
    }
    clearSession();
    disconnectSocket();
    setToken(null);
    setUser(null);
  };

  const handleUserUpdate = (next: User) => {
    setUser(next);
    persistSession(localStorage.getItem('aegis_token') || token || '', next);
  };

  useEffect(() => {
    const onAuthChange = () => {
      if (!localStorage.getItem('aegis_token')) {
        disconnectSocket();
        setToken(null);
        setUser(null);
      }
    };
    window.addEventListener('aegis_auth_change', onAuthChange);
    return () => window.removeEventListener('aegis_auth_change', onAuthChange);
  }, []);

  if (!token) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardPage overview={overview} realtimeStats={realtimeStats} setActiveTab={setActiveTab} currentUser={user} />;
      case 'templates':
        return <TemplatesPage setActiveTab={setActiveTab} />;
      case 'apps':
        // `/apps/<id>` opens one application. The route already carried the id
        // and nothing read it, so no view of an app could be linked to.
        return routeParam ? (
          <AppDetailPage appId={routeParam} onBack={() => setActiveTab('apps')} />
        ) : (
          <AppsPage
            onOpenAnalytics={(appId) => setActiveTab('analytics', appId)}
            onOpenApp={(appId) => setActiveTab('apps', appId)}
          />
        );
      case 'nodes':
        return <NodesPage />;
      case 'analytics':
        return <AnalyticsPage initialAppId={routeParam} />;
      case 'databases':
        return <DatabasesPage setActiveTab={setActiveTab} />;
      case 'querystudio':
        return <QueryStudioPage />;
      case 'filemanager':
        return user?.role === 'admin' ? <FileManagerPage /> : <DashboardPage overview={overview} realtimeStats={realtimeStats} setActiveTab={setActiveTab} currentUser={user} />;
      case 'cron':
        return <CronPage />;
      case 'containers':
        return <ContainersPage />;
      case 'domains':
        return <DomainsPage />;
      case 'firewall':
        return <FirewallPage />;
      case 'backups':
        return <BackupsPage />;
      case 'terminal':
        return <TerminalPage />;
      case 'monitor':
        return <SystemMonitorPage realtimeStats={realtimeStats} />;
      case 'settings':
        return <SettingsPage currentUser={user} onUserUpdate={handleUserUpdate} />;
      case 'help':
        return <HelpPage />;
      default:
        return <DashboardPage overview={overview} realtimeStats={realtimeStats} setActiveTab={setActiveTab} currentUser={user} />;
    }
  };

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="flex h-screen bg-surface text-on-surface font-sans overflow-hidden">
          <Sidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            serverName={overview?.settings?.serverName || 'Aegis VPS'}
            role={user?.role}
            isMobileOpen={isMobileMenuOpen}
            onCloseMobile={() => setIsMobileMenuOpen(false)}
          />

          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <Navbar
              stats={realtimeStats}
              serverName={overview?.settings?.serverName || 'Aegis VPS'}
              username={user?.username || 'admin'}
              onLogout={handleLogout}
              onRefresh={fetchOverview}
              onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
            />

            <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-7 custom-scrollbar">
              <Suspense fallback={<PageFallback />}>{renderContent()}</Suspense>
            </main>
          </div>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export default App;
