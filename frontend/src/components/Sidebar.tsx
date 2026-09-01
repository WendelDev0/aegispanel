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
  Globe2,
  X
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'templates'
  | 'apps'
  | 'analytics'
  | 'nodes'
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
  role?: 'admin' | 'developer' | 'viewer';
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  serverName,
  role,
  isMobileOpen,
  onCloseMobile,
}) => {
  const menuSections = [
    {
      title: 'Plataforma & Deploys',
      items: [
        { id: 'dashboard' as NavTab, label: 'Visão Geral', icon: LayoutDashboard, tooltip: 'Painel com métricas de CPU, RAM e status geral da VPS' },
        { id: 'templates' as NavTab, label: 'Marketplace 1-Clique', icon: ShoppingBag, badge: 'NOVO', tooltip: 'Instale n8n, WhatsApp Evolution API, Typebot, WordPress e S3 em 1 clique' },
        { id: 'apps' as NavTab, label: 'Aplicações & CI/CD', icon: Layers, badge: 'PaaS', tooltip: 'Deploy de sites e APIs com Webhook automático estilo Vercel' },
        { id: 'nodes' as NavTab, label: 'Servidores', icon: Server, badge: 'BETA', tooltip: 'Registre outros servidores e verifique a conexão via SSH' },
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
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      <aside
        className={`w-64 sm:w-60 bg-surface-container-lowest border-r border-outline-variant flex flex-col h-screen shrink-0 select-none fixed inset-y-0 left-0 z-50 lg:static lg:z-auto transition-transform duration-200 ease-in-out ${
          isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="p-4 border-b border-outline-variant flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded bg-primary-container/15 border border-primary/30 flex items-center justify-center">
              <Flame className="w-[18px] h-[18px] text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-[-0.01em] text-on-surface flex items-center gap-1">
                AEGIS<span className="text-primary font-normal">PANEL</span>
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-ok"></span>
                <span className="text-2xs text-on-surface-variant/80 font-mono truncate max-w-[120px]">
                  {serverName}
                </span>
              </div>
            </div>
          </div>

          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden text-on-surface-variant/70 hover:text-on-surface p-1.5 rounded-md hover:bg-surface-container transition-colors"
              title="Fechar menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation Sections */}
        <div className="flex-1 overflow-y-auto p-3 space-y-5 custom-scrollbar">
          {menuSections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              <h2 className="px-3 mono-label">
                {section.title}
              </h2>
              <div className="space-y-0.5 pt-1">
                {section.items.filter((item) => item.id !== 'filemanager' || role === 'admin').map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        onCloseMobile?.();
                      }}
                      title={item.tooltip}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-medium transition-colors group ${
                        isActive
                          ? 'bg-primary-container text-white'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={`w-4 h-4 transition-colors ${
                            isActive ? 'text-white' : 'text-on-surface-variant/70 group-hover:text-on-surface'
                          }`}
                        />
                        <span>{item.label}</span>
                      </div>

                      {item.badge && (
                        <span
                          className={`text-2xs px-1.5 py-0.5 rounded-full font-mono tracking-tight border ${
                            isActive
                              ? 'bg-white/20 text-white border-white/25'
                              : item.badge === 'NOVO'
                              ? 'bg-ok/10 text-ok border-ok/30'
                              : 'bg-surface-container-high text-on-surface-variant border-outline-variant'
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
        <div className="p-3 border-t border-outline-variant">
          <div className="flex items-center justify-between text-2xs text-on-surface-variant/80 px-2">
            <div className="flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-primary" />
              <span className="font-mono">VPS Ready (v2.0)</span>
            </div>
            <span className="text-2xs text-ok font-mono bg-ok/10 border border-ok/30 px-1.5 py-0.5 rounded-full">
              Self-Hosted
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
