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
  Flame,
  ShoppingBag,
  Clock,
  HelpCircle,
  Globe2
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'templates'
  | 'apps'
  | 'analytics'
  | 'databases'
  | 'querystudio'
  | 'filemanager'
  | 'cron'
  | 'containers'
  | 'domains'
  | 'firewall'
  | 'backups'
  | 'terminal'
  | 'monitor'
  | 'settings'
  | 'help';

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
        { id: 'templates' as NavTab, label: 'Marketplace 1-Clique', icon: ShoppingBag, badge: 'NOVO', tooltip: 'Instale n8n, WhatsApp Evolution API, Typebot, WordPress e S3 em 1 clique' },
        { id: 'apps' as NavTab, label: 'Aplicações & CI/CD', icon: Layers, badge: 'PaaS', tooltip: 'Deploy de sites e APIs com Webhook automático estilo Vercel' },
        { id: 'analytics' as NavTab, label: 'Analytics', icon: Globe2, badge: 'NOVO', tooltip: 'Visitas, origem geográfica dos acessos e erros de cada aplicação' },
        { id: 'databases' as NavTab, label: 'Bancos de Dados', icon: Database, badge: '1-Click', tooltip: 'PostgreSQL, MySQL, Redis e MongoDB com criptografia AES-256' },
        { id: 'querystudio' as NavTab, label: 'Database Studio', icon: Code2, badge: 'SQL', tooltip: 'Executor de queries SQL e visualizador de tabelas em tempo real' },
        { id: 'filemanager' as NavTab, label: 'Arquivos & .env', icon: FolderTree, tooltip: 'Explorador de pastas, uploads e editor de arquivos de configuração' },
      ],
    },
    {
      title: 'Infraestrutura & Rede',
      items: [
        { id: 'containers' as NavTab, label: 'Containers Docker', icon: Boxes, tooltip: 'Gerenciador Docker estilo Portainer (iniciar, parar, logs)' },
        { id: 'cron' as NavTab, label: 'Agendador Cron', icon: Clock, badge: 'Auto', tooltip: 'Backups automáticos agendados e rotinas cron periódicas' },
        { id: 'domains' as NavTab, label: 'Domínios & SSL', icon: Globe, tooltip: 'Mapeamento de domínios Hostinger com HTTPS grátis automático' },
        { id: 'firewall' as NavTab, label: 'Segurança & Firewall', icon: Shield, tooltip: 'Controle de portas abertas e regras de firewall UFW' },
        { id: 'backups' as NavTab, label: 'Backups & Restore', icon: HardDriveDownload, tooltip: 'Cópias de segurança de bancos e restauração em 1 clique' },
      ],
    },
    {
      title: 'Sistema & Servidor',
      items: [
        { id: 'terminal' as NavTab, label: 'Terminal Web (SSH)', icon: Terminal, tooltip: 'Terminal interativo no navegador conectado ao host ou containers' },
        { id: 'monitor' as NavTab, label: 'Monitor de Recursos', icon: Activity, tooltip: 'Processos com maior consumo de CPU/RAM e telemetria profunda' },
        { id: 'settings' as NavTab, label: 'Configurações & Equipe', icon: Settings, tooltip: 'Alertas WhatsApp/Telegram, equipe, domínio próprio e migração' },
        { id: 'help' as NavTab, label: 'Ajuda & Prompt IA', icon: HelpCircle, badge: 'AI', tooltip: 'Prompts prontos para IAs prepararem seu projeto Vercel para o AegisPanel' },
      ],
    },
  ];

  return (
    <aside className="w-64 bg-[#090d16] border-r border-slate-800/80 flex flex-col h-screen shrink-0 select-none">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-extrabold text-sm tracking-wide text-white flex items-center gap-1">
              AEGIS<span className="text-indigo-400 font-normal">PANEL</span>
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-[10px] text-slate-400 font-mono truncate max-w-[120px]">
                {serverName}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-5 custom-scrollbar">
        {menuSections.map((section, sIdx) => (
          <div key={sIdx} className="space-y-1">
            <h2 className="px-3 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              {section.title}
            </h2>
            <div className="space-y-0.5 pt-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    title={item.tooltip}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                      isActive
                        ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/20'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon
                        className={`w-4 h-4 transition-colors ${
                          isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                        }`}
                      />
                      <span>{item.label}</span>
                    </div>

                    {item.badge && (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold tracking-tight ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : item.badge === 'NOVO'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Server Badge Footer */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center justify-between text-[11px] text-slate-400 px-2">
          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-mono">VPS Ready (v2.0)</span>
          </div>
          <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
            Self-Hosted
          </span>
        </div>
      </div>
    </aside>
  );
};
