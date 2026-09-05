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
  MessageCircle,
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
  | 'flows'
  | 'containers'
  | 'domains'
  | 'firewall'
  | 'backups'
  | 'terminal'
  | 'monitor'
  | 'settings'
  | 'help';

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tooltip: string;
  /**
   * Reserved for state the operator must act on. Nine of eighteen entries used
   * to carry one — three of them "NOVO", which never expired and so meant
   * nothing, and the rest ("PaaS", "SQL", "1-Click", "Auto", "AI") naming a
   * category rather than a state. Only an unfinished feature earns one now.
   */
  badge?: string;
  adminOnly?: boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * Grouped by what the operator is doing, not by which layer the feature sits
 * on. The previous split put Analytics under "Plataforma" and Monitor under
 * "Sistema" though both answer "how is it going", and filed the WhatsApp
 * builder under "Infraestrutura & Rede", where nobody looks for automation.
 *
 * Labels are the shortest phrase that names the destination. "Aplicações &
 * CI/CD", "Domínios & SSL", "Segurança & Firewall" spent width on a second
 * noun that the tooltip already carries.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      {
        id: 'dashboard',
        label: 'Visão Geral',
        icon: LayoutDashboard,
        tooltip: 'Painel com métricas de CPU, RAM e status geral da VPS',
      },
    ],
  },
  {
    title: 'Implantar',
    items: [
      {
        id: 'apps',
        label: 'Aplicações',
        icon: Layers,
        tooltip: 'Deploy de sites e APIs com webhook automático, estilo Vercel',
      },
      {
        id: 'templates',
        label: 'Marketplace',
        icon: ShoppingBag,
        tooltip: 'Instale n8n, Evolution API, Typebot, WordPress e S3 em um clique',
      },
      {
        id: 'databases',
        label: 'Bancos de Dados',
        icon: Database,
        tooltip: 'PostgreSQL, MySQL, Redis e MongoDB com credenciais criptografadas',
      },
      {
        id: 'querystudio',
        label: 'SQL Studio',
        icon: Code2,
        tooltip: 'Executor de queries e visualizador de tabelas em tempo real',
      },
      {
        id: 'domains',
        label: 'Domínios',
        icon: Globe,
        tooltip: 'Mapeamento de domínios com HTTPS automático via Caddy',
      },
    ],
  },
  {
    title: 'Operar',
    items: [
      {
        id: 'flows',
        label: 'Fluxos WhatsApp',
        icon: MessageCircle,
        tooltip: 'Construtor visual de fluxos para atendimento e alertas no WhatsApp',
      },
      {
        id: 'analytics',
        label: 'Analytics',
        icon: Globe2,
        tooltip: 'Visitas, origem geográfica dos acessos e erros de cada aplicação',
      },
      {
        id: 'containers',
        label: 'Containers',
        icon: Boxes,
        tooltip: 'Gerenciador Docker: iniciar, parar, inspecionar e ler logs',
      },
      {
        id: 'cron',
        label: 'Agendador',
        icon: Clock,
        tooltip: 'Backups automáticos agendados e rotinas cron periódicas',
      },
      {
        id: 'backups',
        label: 'Backups',
        icon: HardDriveDownload,
        tooltip: 'Cópias de segurança de bancos e restauração em um clique',
      },
    ],
  },
  {
    title: 'Servidor',
    items: [
      {
        id: 'monitor',
        label: 'Monitor',
        icon: Activity,
        tooltip: 'Processos com maior consumo de CPU e RAM, telemetria profunda',
      },
      {
        id: 'terminal',
        label: 'Terminal',
        icon: Terminal,
        tooltip: 'Terminal interativo no navegador, conectado ao host ou a containers',
      },
      {
        id: 'firewall',
        label: 'Firewall',
        icon: Shield,
        tooltip: 'Controle de portas abertas e regras do UFW',
      },
      {
        id: 'filemanager',
        label: 'Arquivos',
        icon: FolderTree,
        tooltip: 'Explorador de pastas, uploads e editor de arquivos de configuração',
        adminOnly: true,
      },
      {
        id: 'nodes',
        label: 'Servidores',
        icon: Server,
        // The one honest badge: the panel still manages only its own Docker.
        badge: 'BETA',
        tooltip: 'Registre outros servidores e verifique a conexão via SSH',
      },
    ],
  },
  {
    title: 'Sistema',
    items: [
      {
        id: 'settings',
        label: 'Configurações',
        icon: Settings,
        tooltip: 'Alertas, equipe, domínio do painel, Evolution API e migração',
      },
      {
        id: 'help',
        label: 'Ajuda',
        icon: HelpCircle,
        tooltip: 'Prompts prontos para preparar um projeto para o AegisPanel',
      },
    ],
  },
];

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
  return (
    <>
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-surface-container-lowest/70 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      <aside
        className={`w-64 sm:w-60 bg-surface-container-lowest border-r border-outline-variant flex flex-col h-screen shrink-0 select-none fixed inset-y-0 left-0 z-50 lg:static lg:z-auto transition-transform duration-200 ease-in-out ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-4 border-b border-outline-variant flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded bg-primary-container/15 border border-primary/30 flex items-center justify-center shrink-0">
              <Flame className="w-[18px] h-[18px] text-primary" />
            </span>
            <div className="min-w-0">
              <h1 className="font-bold text-sm tracking-[-0.01em] text-on-surface">
                AEGIS<span className="text-primary font-normal">PANEL</span>
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" aria-hidden />
                <span className="text-2xs text-on-surface-variant/80 font-mono truncate">{serverName}</span>
              </div>
            </div>
          </div>

          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden text-on-surface-variant/70 hover:text-on-surface p-1.5 rounded hover:bg-surface-container transition-colors shrink-0"
              title="Fechar menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5 custom-scrollbar">
          {NAV_SECTIONS.map((section, index) => {
            const items = section.items.filter((item) => !item.adminOnly || role === 'admin');
            if (items.length === 0) return null;

            return (
              <div key={section.title ?? `group-${index}`} className="space-y-0.5">
                {section.title && <h2 className="px-3 pb-1.5 mono-label">{section.title}</h2>}

                {items.map((item) => {
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
                      aria-current={isActive ? 'page' : undefined}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded text-xs font-medium transition-colors group ${
                        isActive
                          ? 'bg-primary-container text-on-primary-container'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`w-4 h-4 shrink-0 transition-colors ${
                            isActive ? 'text-on-primary-container' : 'text-on-surface-variant/70 group-hover:text-on-surface'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>

                      {item.badge && (
                        <span
                          className={`text-2xs font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                            isActive
                              ? 'border-on-primary-container/30 text-on-primary-container'
                              : 'border-outline-variant text-on-surface-variant/70'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
};
