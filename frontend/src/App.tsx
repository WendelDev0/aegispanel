import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/Sidebar.js';
import { Navbar } from './components/Navbar.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { TemplatesPage } from './pages/TemplatesPage.js';
import { AppsPage } from './pages/AppsPage.js';
import { DatabasesPage } from './pages/DatabasesPage.js';
import { ContainersPage } from './pages/ContainersPage.js';
import { DomainsPage } from './pages/DomainsPage.js';
import { TerminalPage } from './pages/TerminalPage.js';
import { SystemMonitorPage } from './pages/SystemMonitorPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { HelpPage } from './pages/HelpPage.js';
import { FileManagerPage } from './pages/FileManagerPage.js';
import { QueryStudioPage } from './pages/QueryStudioPage.js';
import { FirewallPage } from './pages/FirewallPage.js';
import { BackupsPage } from './pages/BackupsPage.js';
import { CronPage } from './pages/CronPage.js';
import { AuthPage } from './pages/AuthPage.js';
import { api } from './services/api.js';
import { socket } from './services/socket.js';
import { OverviewData, SystemStats, User } from './types/index.js';

export function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('aegis_token'));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('aegis_user');
    return raw ? JSON.parse(raw) : null;
  });

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
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
    if (token) {
      fetchOverview();

      // Listen for WebSocket real-time metrics
      socket.on('system:metrics', (metrics: SystemStats) => {
        setRealtimeStats(metrics);
      });

      return () => {
        socket.off('system:metrics');
      };
    }
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
    setToken(null);
    setUser(null);
  };

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
        return <AppsPage />;
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
        return <SettingsPage />;
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
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

export default App;
