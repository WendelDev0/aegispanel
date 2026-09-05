import type { WaFlowEdge, WaFlowNode } from '../db/storage.js';

export interface WaFlowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'atendimento' | 'alerta' | 'vendas';
  nodes: WaFlowNode[];
  edges: WaFlowEdge[];
}

export const WA_FLOW_TEMPLATES: WaFlowTemplate[] = [
  {
    id: 'cardapio-pedido',
    name: 'Cardápio com pedido',
    description: 'Apresenta cardápio, captura o pedido do cliente e transfere para a cozinha.',
    category: 'vendas',
    nodes: [
      {
        id: 'trig-1',
        type: 'trigger_message',
        position: { x: 100, y: 50 },
        data: { match: 'any', keyword: 'cardapio' },
      },
      {
        id: 'txt-1',
        type: 'send_text',
        position: { x: 100, y: 180 },
        data: { text: 'Olá {{nome}}! Seja bem-vindo à nossa pizzaria 🍕' },
      },
      {
        id: 'menu-1',
        type: 'menu',
        position: { x: 100, y: 310 },
        data: {
          text: 'O que deseja hoje?',
          buttons: [
            { id: 'btn-pizza', label: 'Ver Pizzas' },
            { id: 'btn-bebida', label: 'Bebidas' },
          ],
        },
      },
      {
        id: 'cap-1',
        type: 'capture',
        position: { x: 100, y: 460 },
        data: {
          varName: 'pedido',
          captureType: 'text',
          saveLead: true,
          text: 'Digite o sabor e quantidade que deseja:',
        },
      },
      {
        id: 'txt-confirma',
        type: 'send_text',
        position: { x: 100, y: 600 },
        data: { text: 'Pedido registrado: "{{pedido}}". Encaminhando para confirmação!' },
      },
      {
        id: 'handoff-1',
        type: 'handoff',
        position: { x: 100, y: 730 },
        data: {
          notifyNumber: '5511999990000',
          notifyMessage: 'Novo pedido de {{nome}}: {{pedido}}',
          resumeMinutes: 120,
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trig-1', target: 'txt-1' },
      { id: 'e2', source: 'txt-1', target: 'menu-1' },
      { id: 'e3', source: 'menu-1', target: 'cap-1', sourceHandle: 'btn-pizza' },
      { id: 'e4', source: 'menu-1', target: 'cap-1', sourceHandle: 'btn-bebida' },
      { id: 'e5', source: 'cap-1', target: 'txt-confirma' },
      { id: 'e6', source: 'txt-confirma', target: 'handoff-1' },
    ],
  },
  {
    id: 'suporte-handoff',
    name: 'Suporte com handoff',
    description: 'Triagem de atendimento com opção de transferência para atendente humano.',
    category: 'atendimento',
    nodes: [
      {
        id: 'trig-1',
        type: 'trigger_message',
        position: { x: 100, y: 50 },
        data: { match: 'contains', keyword: 'ajuda' },
      },
      {
        id: 'menu-1',
        type: 'menu',
        position: { x: 100, y: 180 },
        data: {
          text: 'Olá {{nome}}! Como podemos te ajudar hoje?',
          buttons: [
            { id: 'btn-faq', label: 'Horários' },
            { id: 'btn-humano', label: 'Falar com Humano' },
          ],
        },
      },
      {
        id: 'txt-faq',
        type: 'send_text',
        position: { x: -50, y: 320 },
        data: { text: 'Nosso horário de atendimento é de Segunda a Sexta das 08h às 18h.' },
      },
      {
        id: 'end-faq',
        type: 'end',
        position: { x: -50, y: 450 },
        data: {},
      },
      {
        id: 'handoff-1',
        type: 'handoff',
        position: { x: 250, y: 320 },
        data: {
          notifyNumber: '5511999990000',
          notifyMessage: 'Cliente {{nome}} solicitou suporte humano.',
          resumeMinutes: 60,
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trig-1', target: 'menu-1' },
      { id: 'e2', source: 'menu-1', target: 'txt-faq', sourceHandle: 'btn-faq' },
      { id: 'e3', source: 'txt-faq', target: 'end-faq' },
      { id: 'e4', source: 'menu-1', target: 'handoff-1', sourceHandle: 'btn-humano' },
    ],
  },
  {
    id: 'deploy-falhou-ops',
    name: 'Deploy falhou (ops)',
    description: 'Notificação crítica instantânea via WhatsApp para o time de infraestrutura quando um deploy falha.',
    category: 'alerta',
    nodes: [
      {
        id: 'trig-1',
        type: 'trigger_event',
        position: { x: 100, y: 50 },
        data: { event: 'deploy_fail' },
      },
      {
        id: 'txt-alerta',
        type: 'send_text',
        position: { x: 100, y: 190 },
        data: {
          text: '🚨 *ALERTA DE DEPLOY* 🚨\n\nOcorreu uma falha no deploy da aplicação *{{app}}* no AegisPanel.\nHorário: {{agora}}\n\nAcesse o painel para verificar os logs de build.',
        },
      },
      {
        id: 'end-1',
        type: 'end',
        position: { x: 100, y: 330 },
        data: {},
      },
    ],
    edges: [
      { id: 'e1', source: 'trig-1', target: 'txt-alerta' },
      { id: 'e2', source: 'txt-alerta', target: 'end-1' },
    ],
  },
  {
    id: 'lead-captura',
    name: 'Lead com captura',
    description: 'Captação de leads qualificados com validação de e-mail e agradecimento.',
    category: 'vendas',
    nodes: [
      {
        id: 'trig-1',
        type: 'trigger_message',
        position: { x: 100, y: 50 },
        data: { match: 'any' },
      },
      {
        id: 'txt-1',
        type: 'send_text',
        position: { x: 100, y: 180 },
        data: { text: 'Olá {{nome}}! Gostaria de receber nosso catálogo exclusivo?' },
      },
      {
        id: 'cap-email',
        type: 'capture',
        position: { x: 100, y: 310 },
        data: {
          varName: 'email',
          captureType: 'email',
          saveLead: true,
        },
      },
      {
        id: 'txt-ok',
        type: 'send_text',
        position: { x: 100, y: 450 },
        data: { text: 'Perfeito, {{nome}}! Enviamos o catálogo completo para {{email}}.' },
      },
      {
        id: 'end-1',
        type: 'end',
        position: { x: 100, y: 580 },
        data: {},
      },
    ],
    edges: [
      { id: 'e1', source: 'trig-1', target: 'txt-1' },
      { id: 'e2', source: 'txt-1', target: 'cap-email' },
      { id: 'e3', source: 'cap-email', target: 'txt-ok' },
      { id: 'e4', source: 'txt-ok', target: 'end-1' },
    ],
  },
];
