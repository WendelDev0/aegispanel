import type { WaFlowNodeType, WaPanelEvent } from '../../types/index.js';

export interface BlockMeta {
  label: string;
  verb: string;
  hint: string;
  tone: string;
  badgeTone: string;
  bar: string;
  header: string;
  handle: string;
  minimap: string;
  preview: (data: Record<string, unknown>) => string;
}

export const BLOCK_META: Record<WaFlowNodeType, BlockMeta> = {
  trigger_message: {
    label: 'Quando o cliente fala',
    verb: 'Ouvir cliente',
    hint: 'Mensagem recebida no WhatsApp',
    tone: 'border-sky-500/50',
    badgeTone: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
    bar: 'bg-sky-400',
    header: 'bg-sky-500/10',
    handle: '!bg-sky-400',
    minimap: '#38bdf8',
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
    tone: 'border-amber-400/50',
    badgeTone: 'bg-amber-400/15 text-amber-300 border-amber-400/35',
    bar: 'bg-amber-400',
    header: 'bg-amber-400/10',
    handle: '!bg-amber-400',
    minimap: '#fbbf24',
    preview: (d) => EVENT_LABELS[(d.event as WaPanelEvent) || 'deploy_fail'],
  },
  send_text: {
    label: 'Diga',
    verb: 'Enviar mensagem',
    hint: 'Texto formatado com variáveis',
    tone: 'border-emerald-500/50',
    badgeTone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
    bar: 'bg-emerald-400',
    header: 'bg-emerald-500/10',
    handle: '!bg-emerald-400',
    minimap: '#34d399',
    preview: (d) => String(d.text || 'Sem texto definido').slice(0, 48),
  },
  menu: {
    label: 'Pergunte com opções',
    verb: 'Menu interativo',
    hint: 'Até 3 botões ou lista numerada',
    tone: 'border-violet-500/50',
    badgeTone: 'bg-violet-500/15 text-violet-300 border-violet-500/35',
    bar: 'bg-violet-400',
    header: 'bg-violet-500/10',
    handle: '!bg-violet-400',
    minimap: '#a78bfa',
    preview: (d) => {
      const buttons = Array.isArray(d.buttons) ? d.buttons : [];
      return buttons.map((b: { label?: string }) => b.label).filter(Boolean).join(' · ') || 'Sem opções';
    },
  },
  wait_reply: {
    label: 'Espere a resposta',
    verb: 'Aguardar mensagem',
    hint: 'Pausa até a próxima mensagem do cliente',
    tone: 'border-slate-400/40',
    badgeTone: 'bg-slate-500/15 text-slate-300 border-slate-400/35',
    bar: 'bg-slate-400',
    header: 'bg-slate-500/10',
    handle: '!bg-slate-400',
    minimap: '#94a3b8',
    preview: () => 'Aguardando próxima mensagem',
  },
  capture: {
    label: 'Guarde a resposta',
    verb: 'Capturar dado',
    hint: 'Valida tipo e grava em variável ou lead',
    tone: 'border-cyan-500/50',
    badgeTone: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35',
    bar: 'bg-cyan-400',
    header: 'bg-cyan-500/10',
    handle: '!bg-cyan-400',
    minimap: '#22d3ee',
    preview: (d) => `Salvar em {{${String(d.varName || 'resposta')}}} (${String(d.captureType || 'texto')})`,
  },
  condition: {
    label: 'Decida',
    verb: 'Verificar condição',
    hint: 'Bifurcação Sim/Não por texto ou variável',
    tone: 'border-orange-500/50',
    badgeTone: 'bg-orange-500/15 text-orange-300 border-orange-500/35',
    bar: 'bg-orange-400',
    header: 'bg-orange-500/10',
    handle: '!bg-orange-400',
    minimap: '#fb923c',
    preview: (d) => {
      const src = d.source === 'var' ? `{{${String(d.varName || '')}}}` : 'mensagem';
      return `${src} ${String(d.operator || 'contém')} "${String(d.value || '')}"`;
    },
  },
  agent: {
    label: 'Deixe a IA responder',
    verb: 'Agente IA',
    hint: 'Resposta inteligente via OpenAI ou OpenRouter',
    tone: 'border-fuchsia-500/50',
    badgeTone: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/35',
    bar: 'bg-fuchsia-400',
    header: 'bg-fuchsia-500/10',
    handle: '!bg-fuchsia-400',
    minimap: '#e879f9',
    preview: (d) => `${String(d.provider || 'openai')}: ${String(d.model || 'gpt-4o-mini')}`,
  },
  http: {
    label: 'Chame minha API',
    verb: 'Requisição HTTP',
    hint: 'GET ou POST em webhook/API externa segura',
    tone: 'border-teal-500/50',
    badgeTone: 'bg-teal-500/15 text-teal-300 border-teal-500/35',
    bar: 'bg-teal-400',
    header: 'bg-teal-500/10',
    handle: '!bg-teal-400',
    minimap: '#2dd4bf',
    preview: (d) => `${String(d.httpMethod || 'GET')} ${String(d.httpUrl || 'https://api...').slice(0, 36)}`,
  },
  sql: {
    label: 'Consulte o banco',
    verb: 'Consulta SQL',
    hint: 'Postgres parametrizado anti-SQLi',
    tone: 'border-indigo-500/50',
    badgeTone: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/35',
    bar: 'bg-indigo-400',
    header: 'bg-indigo-500/10',
    handle: '!bg-indigo-400',
    minimap: '#818cf8',
    preview: (d) => `${String(d.sqlMode || 'read')}: ${String(d.sqlQuery || 'SELECT...').slice(0, 32)}`,
  },
  handoff: {
    label: 'Passe para um humano',
    verb: 'Transbordo humano',
    hint: 'Pausa bot e notifica atendente',
    tone: 'border-rose-500/50',
    badgeTone: 'bg-rose-500/15 text-rose-300 border-rose-500/35',
    bar: 'bg-rose-400',
    header: 'bg-rose-500/10',
    handle: '!bg-rose-400',
    minimap: '#fb7185',
    preview: (d) => `Avisar ${String(d.notifyNumber || 'atendente')}`,
  },
  delay: {
    label: 'Espere um pouco',
    verb: 'Pausa (delay)',
    hint: 'Aguarde até 10s mantendo "digitando..."',
    tone: 'border-zinc-400/40',
    badgeTone: 'bg-zinc-500/15 text-zinc-300 border-zinc-400/35',
    bar: 'bg-zinc-400',
    header: 'bg-zinc-500/10',
    handle: '!bg-zinc-400',
    minimap: '#a1a1aa',
    preview: (d) => `Pausa de ${String(d.delaySeconds || 2)} segundos`,
  },
  end: {
    label: 'Encerre',
    verb: 'Finalizar fluxo',
    hint: 'Limpa a sessão de atendimento',
    tone: 'border-red-500/50',
    badgeTone: 'bg-red-500/15 text-red-300 border-red-500/35',
    bar: 'bg-red-500',
    header: 'bg-red-500/10',
    handle: '!bg-red-500',
    minimap: '#f87171',
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
