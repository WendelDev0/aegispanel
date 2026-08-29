import React from 'react';
import { User, LogOut, ShieldCheck, RefreshCw, Cpu, HardDrive } from 'lucide-react';
import { SystemStats } from '../types/index.js';

interface NavbarProps {
  stats?: SystemStats | null;
  serverName: string;
  username: string;
  onLogout: () => void;
  onRefresh?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  stats,
  serverName,
  username,
  onLogout,
  onRefresh,
}) => {
  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  return (
    <header className="h-16 bg-[#0d1322]/90 backdrop-blur border-b border-slate-800 px-6 flex items-center justify-between shrink-0 sticky top-0 z-20">
      {/* Left info */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
          <span className="font-semibold text-slate-200 text-sm">{serverName}</span>
        </div>

        {stats && (
          <div className="hidden md:flex items-center gap-4 text-xs font-mono text-slate-400 bg-slate-800/40 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">SO:</span>
              <span className="text-slate-300">{stats.osInfo.distro || 'Ubuntu'}</span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">Uptime:</span>
              <span className="text-slate-300">{formatUptime(stats.osInfo.uptimeSeconds)}</span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">IP Hostname:</span>
              <span className="text-slate-300">{stats.osInfo.hostname}</span>
            </span>
          </div>
        )}
      </div>

      {/* Right user & actions */}
      <div className="flex items-center gap-3">
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Atualizar dados"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        <div className="h-6 w-px bg-slate-800"></div>

        <div className="flex items-center gap-2 text-sm text-slate-300 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-700/50">
          <div className="w-6 h-6 rounded-full bg-indigo-600/30 text-indigo-400 flex items-center justify-center font-bold text-xs">
            {username.charAt(0).toUpperCase()}
          </div>
          <span className="font-medium text-xs">{username}</span>
        </div>

        <button
          onClick={onLogout}
          title="Sair do painel"
          className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-3 py-1.5 rounded-lg transition-colors border border-rose-500/20"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>
    </header>
  );
};
