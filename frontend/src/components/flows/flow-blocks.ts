import type { WaFlowNodeType, WaPanelEvent } from '../../types/index.js';

export interface BlockMeta {
  label: string;
  verb: string;
  hint: string;
  tone: string;
  badgeTone: string;
  preview: (data: Record<string, unknown>) => string;
  handles?: Array<{ id: string; label: string; type?: 'source' | 'target' }>;
}

export const BLOCK_META: Record<WaFlowNodeType, BlockMeta> = {
  trigger_message: {
    label: 'Quando o cliente fala',
    verb: 'Ouvir cliente',
    hint: 'Mensagem recebida no WhatsApp',
    tone: 'border-primary/40 hover:border-primary',
    badgeTone: 'bg-primary/15 text-primary border-primary/30',
    preview: (d) =>
      d.match === 'contains' && d.keyword
        ? `contém “${String(d.keyword)}”`
        : d.match === 'regex' && d.keyword
          ? `regex ${String(d.keyword)}`
          : 'qualquer texto',
  },
  trigger_event: {
    label: 'Quando o painel avisa',
    verb: 'Ouvir painel',
    hint: 'Deploy, queda de app ou backup',
    tone: 'border-warn/40 hover:border-warn',
    badgeTone: 'bg-warn/15 text-warn border-warn/30',
    preview: (d) => EVENT_LABELS[(d.event as WaPanelEvent) || 'deploy_fail'],
  },
  send_text: {
    label: 'Diga',
    verb: 'Enviar mensagem',
    hint: 'Texto formatado com variáveis',
    tone: 'border-ok/40 hover:border-ok',
    badgeTone: 'bg-ok/15 text-ok border-ok/30',
    preview: (d) => String(d.text || 'Sem texto definido').slice(0, 48),
  },
  menu: {
    label: 'Pergunte com opções',
    verb: 'Menu interativo',
    hint: 'Até 3 botões ou lista numerada',
    tone: 'border-tertiary/40 hover:border-tertiary',
    badgeTone: 'bg-tertiary/15 text-tertiary border-tertiary/30',
    preview: (d) => {
      const buttons = Array.isArray(d.buttons) ? d.buttons : [];
      return buttons.map((b: { label?: string }) => b.label).filter(Boolean).join(' · ') || 'Sem opções';
    },
  },
  wait_reply: {
    label: 'Espere a resposta',
    verb: 'Aguardar mensagem',
    hint: 'Pausa até a próxima mensagem do cliente',
    tone: 'border-outline/40 hover:border-outline',
    badgeTone: 'bg-surface-container-high text-on-surface-variant border-outline-variant',
    preview: () => 'Aguardando próxima mensagem',
  },
  capture: {
    label: 'Guarde a resposta',
    verb: 'Capturar dado',
    hint: 'Valida tipo e grava em variável ou lead',
    tone: 'border-primary/40 hover:border-primary',
    badgeTone: 'bg-primary/15 text-primary border-primary/30',
    preview: (d) => `Salvar em {{${String(d.varName || 'resposta')}}} (${String(d.captureType || 'texto')})`,
  },
  condition: {
    label: 'Decida',
    verb: 'Verificar condição',
    hint: 'Bifurcação Sim/Não por texto ou variável',
    tone: 'border-warn/40 hover:border-warn',
    badgeTone: 'bg-warn/15 text-warn border-warn/30',
    preview: (d) => {
      const src = d.source === 'var' ? `{{${String(d.varName || '')}}}` : 'mensagem';
      return `${src} ${String(d.operator || 'contém')} "${String(d.value || '')}"`;
    },
  },
  agent: {
    label: 'Deixe a IA responder',
    verb: 'Agente IA',
    hint: 'Resposta inteligente via OpenAI ou OpenRouter',
    tone: 'border-primary/50 hover:border-primary',
    badgeTone: 'bg-primary/20 text-primary border-primary/40',
    preview: (d) => `${String(d.provider || 'openai')}: ${String(d.model || 'gpt-4o-mini')}`,
  },
  http: {
    label: 'Chame minha API',
    verb: 'Requisição HTTP',
    hint: 'GET ou POST em webhook/API externa segura',
    tone: 'border-cyan-500/40 hover:border-cyan-500',
    badgeTone: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    preview: (d) => `${String(d.httpMethod || 'GET')} ${String(d.httpUrl || 'https://api...').slice(0, 36)}`,
  },
  sql: {
    label: 'Consulte o banco',
    verb: 'Consulta SQL',
    hint: 'Postgres parametrizado anti-SQLi',
    tone: 'border-violet-500/40 hover:border-violet-500',
    badgeTone: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    preview: (d) => `${String(d.sqlMode || 'read')}: ${String(d.sqlQuery || 'SELECT...').slice(0, 32)}`,
  },
  handoff: {
    label: 'Passe para um humano',
    verb: 'Transbordo humano',
    hint: 'Pausa bot e notifica atendente',
    tone: 'border-amber-500/40 hover:border-amber-500',
    badgeTone: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    preview: (d) => `Avisar ${String(d.notifyNumber || 'atendente')}`,
  },
  delay: {
    label: 'Espere um pouco',
    verb: 'Pausa (delay)',
    hint: 'Aguarde até 10s mantendo "digitando..."',
    tone: 'border-outline-variant/60 hover:border-outline',
    badgeTone: 'bg-surface-container-high text-on-surface-variant border-outline-variant',
    preview: (d) => `Pausa de ${String(d.delaySeconds || 2)} segundos`,
  },
  end: {
    label: 'Encerre',
    verb: 'Finalizar fluxo',
    hint: 'Limpa a sessão de atendimento',
    tone: 'border-crit/40 hover:border-crit',
    badgeTone: 'bg-crit/15 text-crit border-crit/30',
    preview: () => 'Sessão finalizada',
  },
};

export const EVENT_LABELS: Record<WaPanelEvent, string> = {
  deploy_fail: 'Deploy falhou',
  deploy_ok: 'Deploy ok',
  app_down: 'App caiu',
  backup: 'Backup concluído',
};

export const PALETTE: WaFlowNodeType[] = [
  'trigger_message',
  'trigger_event',
  'send_text',
  'menu',
  'wait_reply',
  'capture',
  'condition',
  'agent',
  'http',
  'sql',
  'handoff',
  'delay',
  'end',
];
