import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Sidebar } from './components/Sidebar.js';
import { Navbar } from './components/Navbar.js';
import { AuthPage } from './pages/AuthPage.js';

/**
 * Sections are code-split.
 *
 * Everything used to be pulled into a single bundle, so opening the login
 * screen downloaded the terminal emulator, the charting library and every
 * management page. Each section now loads on first visit.
 */
const DashboardPage = lazy(() => import('./pages/DashboardPage.js').then(m => ({ default: m.DashboardPage })));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage.js').then(m => ({ default: m.TemplatesPage })));
const AppsPage = lazy(() => import('./pages/AppsPage.js').then(m => ({ default: m.AppsPage })));
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
import { api } from './services/api.js';
import { socket, connectSocket, disconnectSocket } from './services/socket.js';
import { useRoute } from './hooks/useRoute.js';
import { OverviewData, SystemStats, User } from './types/index.js';

export function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('aegis_token'));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('aegis_user');
    return raw ? JSON.parse(raw) : null;
  });

  const [activeTab, setActiveTab, routeParam] = useRoute();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [realtimeStats, setRealtimeStats] = useState<SystemStats | null>(null);

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

    // The handshake carries the session token, so the socket is opened only
    // after login and closed on logout.
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

  const handleLoginSuccess = (newUser: any, newToken: string) => {
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('aegis_token');
    localStorage.removeItem('aegis_user');
    disconnectSocket();
    setToken(null);
    setUser(null);
  };

  // The API client clears the stored token on any 401 and fires this event, so
  // an expired session drops back to the login screen instead of leaving the
  // UI stuck on failing requests.
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
        return <DashboardPage overview={overview} realtimeStats={realtimeStats} setActiveTab={setActiveTab} />;
      case 'templates':
        return <TemplatesPage setActiveTab={setActiveTab} />;
      case 'apps':
        return <AppsPage onOpenAnalytics={(appId) => setActiveTab('analytics', appId)} />;
      case 'analytics':
        return <AnalyticsPage initialAppId={routeParam} />;
      case 'databases':
        return <DatabasesPage setActiveTab={setActiveTab} />;
      case 'querystudio':
        return <QueryStudioPage />;
      case 'filemanager':
        return <FileManagerPage />;
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
        return <SettingsPage currentUser={user} />;
      case 'help':
        return <HelpPage />;
      default:
        return <DashboardPage overview={overview} realtimeStats={realtimeStats} setActiveTab={setActiveTab} />;
    }
  };

  return (
    <div className="flex h-screen bg-[#070a13] text-slate-100 font-sans overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        serverName={overview?.settings?.serverName || 'Aegis VPS'}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Navbar
          stats={realtimeStats}
          serverName={overview?.settings?.serverName || 'Aegis VPS'}
          username={user?.username || 'admin'}
          onLogout={handleLogout}
          onRefresh={fetchOverview}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 custom-scrollbar">
          <Suspense fallback={<PageFallback />}>{renderContent()}</Suspense>
        </main>
      </div>
    </div>
  );
}

export default App;
