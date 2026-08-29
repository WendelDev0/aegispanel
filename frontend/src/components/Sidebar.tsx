import React from 'react';
import {
  LayoutDashboard,
  Boxes,
  Database,
  Globe,
  Terminal,
  Activity,
  Server,
  Settings,
  Shield,
  Layers,
  FolderTree,
  Code2,
  HardDriveDownload,
  Flame
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'apps'
  | 'databases'
  | 'querystudio'
  | 'filemanager'
  | 'containers'
  | 'domains'
  | 'firewall'
  | 'backups'
  | 'terminal'
  | 'monitor'
  | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  serverName: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, serverName }) => {
  const menuSections = [
    {
      title: 'Plataforma & Deploys',
      items: [
        { id: 'dashboard' as NavTab, label: 'Visão Geral', icon: LayoutDashboard, tooltip: 'Painel com métricas de CPU, RAM e status geral da VPS' },
        { id: 'apps' as NavTab, label: 'Aplicações & CI/CD', icon: Layers, badge: 'PaaS', tooltip: 'Deploy de sites e APIs com Webhook automático estilo Vercel' },
        { id: 'databases' as NavTab, label: 'Bancos de Dados', icon: Database, badge: '1-Click', tooltip: 'PostgreSQL, MySQL, Redis e MongoDB estilo Supabase' },
        { id: 'querystudio' as NavTab, label: 'Database Studio', icon: Code2, badge: 'SQL', tooltip: 'Executor de queries SQL e visualizador de tabelas em tempo real' },
        { id: 'filemanager' as NavTab, label: 'Arquivos & .env', icon: FolderTree, tooltip: 'Explorador de pastas e editor de arquivos de configuração' },
      ],
    },
    {
      title: 'Infraestrutura & Rede',
      items: [
        { id: 'containers' as NavTab, label: 'Containers Docker', icon: Boxes, tooltip: 'Gerenciador Docker estilo Portainer (iniciar, parar, logs)' },
        { id: 'domains' as NavTab, label: 'Domínios & SSL', icon: Globe, tooltip: 'Mapeamento de domínios com HTTPS automático grátis (Let\'s Encrypt)' },
        { id: 'firewall' as NavTab, label: 'Segurança & Firewall', icon: Shield, tooltip: 'Controle de portas abertas e regras de firewall UFW' },
        { id: 'backups' as NavTab, label: 'Backups & Restore', icon: HardDriveDownload, tooltip: 'Cópias de segurança de bancos e restauração em 1 clique' },
      ],
    },
    {
      title: 'Sistema & Operação',
      items: [
        { id: 'terminal' as NavTab, label: 'Terminal Web SSH', icon: Terminal, tooltip: 'Linha de comando root direta na VPS pelo navegador' },
        { id: 'monitor' as NavTab, label: 'Monitor de Recursos', icon: Activity, tooltip: 'Processos com maior consumo de CPU, RAM e discos' },
        { id: 'settings' as NavTab, label: 'Configurações & Alertas', icon: Settings, tooltip: 'Alertas no Discord/Telegram e dados do servidor' },
      ],
    },
  ];

  return (
    <aside className="w-64 bg-[#0d1322] border-r border-slate-800 flex flex-col shrink-0">
      {/* Brand header */}
      <div className="p-5 border-b border-slate-800/80 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-bold">
          <Server className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-slate-100 text-base tracking-tight flex items-center gap-1.5">
            AegisPanel <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-mono font-medium">PRO</span>
          </h1>
          <p className="text-xs text-slate-400 truncate max-w-[140px] font-medium" title={serverName}>{serverName}</p>
        </div>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
        {menuSections.map((section, sIdx) => (
          <div key={sIdx} className="space-y-1">
            <div className="px-3 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              {section.title}
            </div>

            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  title={item.tooltip}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group relative ${
                    isActive
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 transition-transform group-hover:scale-110 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      isActive ? 'bg-indigo-500/30 text-indigo-200' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer info */}
      <div className="p-3.5 border-t border-slate-800/80 bg-[#0a0f1c]/50">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="font-medium text-slate-300">Self-Hosted</span>
          </div>
          <span className="font-mono text-[10px] text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">v2.0 Pro</span>
        </div>
      </div>
    </aside>
  );
};
