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
    <header className="h-14 bg-surface-container-lowest border-b border-outline-variant px-5 flex items-center justify-between shrink-0 sticky top-0 z-20">
      {/* Left info */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-ok"></span>
          <span className="font-semibold text-on-surface text-sm tracking-[-0.01em]">{serverName}</span>
        </div>

        {stats && (
          <div className="hidden md:flex items-center gap-3 text-2xs font-mono text-on-surface-variant bg-surface-container px-3 py-1.5 rounded border border-outline-variant">
            <span className="flex items-center gap-1.5">
              <span className="text-on-surface-variant/60 uppercase tracking-[0.12em]">SO</span>
              <span className="text-on-surface">{stats.osInfo.distro || 'Linux'}</span>
            </span>
            <span className="text-outline-variant">|</span>
            <span className="flex items-center gap-1.5">
              <span className="text-on-surface-variant/60 uppercase tracking-[0.12em]">Uptime</span>
              <span className="text-on-surface">{formatUptime(stats.osInfo.uptimeSeconds)}</span>
            </span>
            <span className="text-outline-variant">|</span>
            <span className="flex items-center gap-1.5">
              <span className="text-on-surface-variant/60 uppercase tracking-[0.12em]">Host</span>
              <span className="text-on-surface">{stats.osInfo.hostname}</span>
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
            className="p-2 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        <div className="h-5 w-px bg-outline-variant"></div>

        <div className="flex items-center gap-2 text-sm text-on-surface bg-surface-container px-2.5 py-1.5 rounded border border-outline-variant">
          <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold text-2xs">
            {username.charAt(0).toUpperCase()}
          </div>
          <span className="font-medium text-xs">{username}</span>
        </div>

        <button
          onClick={onLogout}
          title="Sair do painel"
          className="flex items-center gap-1.5 text-xs text-crit hover:bg-crit/10 px-3 py-1.5 rounded transition-colors border border-crit/25"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </div>
    </header>
  );
};
