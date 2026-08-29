import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/Sidebar.js';
import { Navbar } from './components/Navbar.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { AppsPage } from './pages/AppsPage.js';
import { DatabasesPage } from './pages/DatabasesPage.js';
import { ContainersPage } from './pages/ContainersPage.js';
import { DomainsPage } from './pages/DomainsPage.js';
import { TerminalPage } from './pages/TerminalPage.js';
import { SystemMonitorPage } from './pages/SystemMonitorPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { FileManagerPage } from './pages/FileManagerPage.js';
import { QueryStudioPage } from './pages/QueryStudioPage.js';
import { FirewallPage } from './pages/FirewallPage.js';
import { BackupsPage } from './pages/BackupsPage.js';
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
    const handleAuthChange = () => {
      setToken(localStorage.getItem('aegis_token'));
      const raw = localStorage.getItem('aegis_user');
      setUser(raw ? JSON.parse(raw) : null);
    };

    window.addEventListener('aegis_auth_change', handleAuthChange);
    return () => window.removeEventListener('aegis_auth_change', handleAuthChange);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('aegis_token');
    localStorage.removeItem('aegis_user');
    setToken(null);
    setUser(null);
  };

  const handleLoginSuccess = (userData: User, tokenData: string) => {
    setUser(userData);
    setToken(tokenData);
  };

  if (!token || !user) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }

  const serverName = overview?.settings.serverName || 'Aegis VPS';

  return (
    <div className="flex h-screen bg-[#090d16] text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        serverName={serverName}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Navbar
          stats={realtimeStats}
          serverName={serverName}
          username={user.username}
          onLogout={handleLogout}
          onRefresh={fetchOverview}
        />

        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && (
              <DashboardPage
                overview={overview}
                realtimeStats={realtimeStats}
                setActiveTab={setActiveTab}
              />
            )}
            {activeTab === 'apps' && <AppsPage />}
            {activeTab === 'databases' && <DatabasesPage setActiveTab={setActiveTab} />}
            {activeTab === 'querystudio' && <QueryStudioPage />}
            {activeTab === 'filemanager' && <FileManagerPage />}
            {activeTab === 'containers' && <ContainersPage />}
            {activeTab === 'domains' && <DomainsPage />}
            {activeTab === 'firewall' && <FirewallPage />}
            {activeTab === 'backups' && <BackupsPage />}
            {activeTab === 'terminal' && <TerminalPage />}
            {activeTab === 'monitor' && (
              <SystemMonitorPage realtimeStats={realtimeStats} />
            )}
            {activeTab === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
