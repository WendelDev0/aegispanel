import type { WaFlowNodeType, WaPanelEvent } from '../../types/index.js';

export const BLOCK_META: Record<
  WaFlowNodeType,
  { label: string; hint: string; tone: string; preview: (data: Record<string, unknown>) => string }
> = {
  trigger_message: {
    label: 'Mensagem recebida',
    hint: 'Cliente escreveu no WhatsApp',
    tone: 'bg-primary',
    preview: (d) =>
      d.match === 'contains' && d.keyword
        ? `contém “${String(d.keyword)}”`
        : d.match === 'regex' && d.keyword
          ? `regex ${String(d.keyword)}`
          : 'qualquer texto',
  },
  trigger_event: {
    label: 'Evento do painel',
    hint: 'Deploy, queda ou backup',
    tone: 'bg-warn',
    preview: (d) => EVENT_LABELS[(d.event as WaPanelEvent) || 'deploy_fail'],
  },
  send_text: {
    label: 'Enviar texto',
    hint: 'Resposta ou alerta',
    tone: 'bg-ok',
    preview: (d) => String(d.text || 'Sem texto').slice(0, 48),
  },
  menu: {
    label: 'Menu',
    hint: '2 ou 3 botões',
    tone: 'bg-tertiary',
    preview: (d) => {
      const buttons = Array.isArray(d.buttons) ? d.buttons : [];
      return buttons.map((b: { label?: string }) => b.label).filter(Boolean).join(' · ') || 'Sem opções';
    },
  },
  wait_reply: {
    label: 'Aguardar resposta',
    hint: 'Próxima mensagem do cliente',
    tone: 'bg-outline',
    preview: () => 'Espera a próxima mensagem',
  },
  condition: {
    label: 'Condição',
    hint: 'Sim ou não',
    tone: 'bg-warn',
    preview: (d) => `${d.operator === 'equals' ? 'igual a' : 'contém'} “${String(d.value || '')}”`,
  },
  end: {
    label: 'Encerrar',
    hint: 'Limpa a sessão',
    tone: 'bg-crit',
    preview: () => 'Fim do fluxo',
  },
};

export const EVENT_LABELS: Record<WaPanelEvent, string> = {
  deploy_fail: 'Deploy falhou',
  deploy_ok: 'Deploy ok',
  app_down: 'App caiu',
  backup: 'Backup',
};

export const PALETTE: WaFlowNodeType[] = [
  'trigger_message',
  'trigger_event',
  'send_text',
  'menu',
  'wait_reply',
  'condition',
  'end',
];
