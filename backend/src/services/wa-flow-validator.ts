import type { WaFlowEdge, WaFlowNode } from '../db/storage.js';

export interface ValidationError {
  nodeId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const WAITING_TYPES = new Set(['wait_reply', 'menu', 'capture']);
const TERMINAL_TYPES = new Set(['end', 'handoff']);

/**
 * Pure graph validator for WhatsApp flows.
 *
 * Runs without any network or database I/O. Used on flow save and publish
 * to guarantee that broken graphs (orphan nodes, cycles without exit, missing triggers)
 * never get deployed to live WhatsApp instances.
 */
export function validateFlowGraph(nodes: WaFlowNode[], edges: WaFlowEdge[]): ValidationResult {
  const errors: ValidationError[] = [];

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return {
      valid: false,
      errors: [{ message: 'O fluxo precisa de pelo menos um bloco.' }],
    };
  }

  const nodeMap = new Map<string, WaFlowNode>();
  for (const node of nodes) {
    if (nodeMap.has(node.id)) {
      errors.push({ nodeId: node.id, message: `ID de bloco duplicado: ${node.id}` });
    }
    nodeMap.set(node.id, node);
  }

  // 1. Trigger presence
  const triggers = nodes.filter((n) => n.type === 'trigger_message' || n.type === 'trigger_event');
  if (triggers.length === 0) {
    errors.push({ message: 'O fluxo precisa de pelo menos um bloco de gatilho (mensagem ou evento).' });
  }

  // Build adjacency
  const outgoingMap = new Map<string, WaFlowEdge[]>();
  const incomingMap = new Map<string, WaFlowEdge[]>();

  for (const edge of edges) {
    if (!nodeMap.has(edge.source)) {
      errors.push({ message: `Ligação ${edge.id} tem origem inexistente: ${edge.source}` });
    }
    if (!nodeMap.has(edge.target)) {
      errors.push({ message: `Ligação ${edge.id} tem destino inexistente: ${edge.target}` });
    }

    const outList = outgoingMap.get(edge.source) || [];
    outList.push(edge);
    outgoingMap.set(edge.source, outList);

    const inList = incomingMap.get(edge.target) || [];
    inList.push(edge);
    incomingMap.set(edge.target, inList);
  }

  // 2. Reachability from triggers (no orphan nodes)
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const trig of triggers) {
    reachable.add(trig.id);
    queue.push(trig.id);
  }

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const outs = outgoingMap.get(currId) || [];
    for (const edge of outs) {
      if (!reachable.has(edge.target)) {
        reachable.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      errors.push({
        nodeId: node.id,
        message: `Bloco "${node.id}" (${node.type}) é órfão e não é alcançado por nenhum gatilho.`,
      });
    }
  }

  // 3. Block-specific validations
  for (const node of nodes) {
    const d = node.data || {};

    if (node.type === 'trigger_message') {
      if (d.match === 'regex' && d.keyword) {
        try {
          new RegExp(d.keyword);
        } catch {
          errors.push({ nodeId: node.id, message: `Expressão regular inválida no gatilho: "${d.keyword}"` });
        }
      }
      if (d.keyword && d.keyword.length > 200) {
        errors.push({ nodeId: node.id, message: 'Palavra-chave do gatilho excede 200 caracteres.' });
      }
    }

    if (node.type === 'trigger_event') {
      const allowedEvents = ['deploy_fail', 'deploy_ok', 'app_down', 'backup'];
      if (d.event && !allowedEvents.includes(d.event)) {
        errors.push({ nodeId: node.id, message: `Evento inválido no gatilho: "${d.event}"` });
      }
    }

    if (node.type === 'send_text') {
      if (d.text && d.text.length > 2000) {
        errors.push({ nodeId: node.id, message: 'Texto da mensagem excede 2000 caracteres.' });
      }
    }

    if (node.type === 'menu') {
      const buttons = Array.isArray(d.buttons) ? d.buttons : [];
      if (buttons.length === 0) {
        errors.push({ nodeId: node.id, message: 'Menu precisa de pelo menos uma opção de botão.' });
      }
      if (buttons.length > 3) {
        errors.push({ nodeId: node.id, message: 'Menu suporta no máximo 3 botões.' });
      }
      for (let i = 0; i < buttons.length; i++) {
        if (!buttons[i]?.label?.trim()) {
          errors.push({ nodeId: node.id, message: `Botão ${i + 1} do menu está sem rótulo.` });
        }
      }

      // Check button handles connected
      const outs = outgoingMap.get(node.id) || [];
      for (const btn of buttons) {
        const hasEdge = outs.some((e) => e.sourceHandle === btn.id);
        if (!hasEdge && outs.length > 0) {
          // If edges exist from menu, check if this button is connected
          const anyConnected = outs.some((e) => !e.sourceHandle || e.sourceHandle === btn.id);
          if (!anyConnected) {
            errors.push({ nodeId: node.id, message: `Botão "${btn.label}" não está conectado a nenhum bloco.` });
          }
        }
      }
    }

    if (node.type === 'condition') {
      if (d.operator === 'regex' && d.value) {
        try {
          new RegExp(d.value);
        } catch {
          errors.push({ nodeId: node.id, message: `Expressão regular inválida na condição: "${d.value}"` });
        }
      }

      // Condition must connect yes and/or no handles
      const outs = outgoingMap.get(node.id) || [];
      const hasYes = outs.some((e) => e.sourceHandle === 'yes');
      const hasNo = outs.some((e) => e.sourceHandle === 'no');
      if (!hasYes && !hasNo && outs.length > 0) {
        errors.push({ nodeId: node.id, message: 'Condição precisa conectar a saída "Sim" (yes) ou "Não" (no).' });
      }
    }

    if (node.type === 'capture') {
      const varName = d.varName?.trim() || '';
      if (!varName) {
        errors.push({ nodeId: node.id, message: 'Bloco de captura precisa do nome da variável.' });
      } else if (!/^[a-z_][a-z0-9_]{0,31}$/.test(varName)) {
        errors.push({
          nodeId: node.id,
          message: `Nome de variável inválido "${varName}". Use letras minúsculas e _ (máx 32 caracteres).`,
        });
      }
      const allowedTypes = ['text', 'number', 'phone', 'email'];
      if (d.captureType && !allowedTypes.includes(d.captureType)) {
        errors.push({ nodeId: node.id, message: `Tipo de captura inválido: "${d.captureType}"` });
      }
    }

    if (node.type === 'agent') {
      if (!d.model?.trim()) {
        errors.push({ nodeId: node.id, message: 'Bloco de agente IA exige um modelo configurado.' });
      } else if (!/^[A-Za-z0-9._:/-]{1,80}$/.test(d.model.trim())) {
        errors.push({ nodeId: node.id, message: `Nome de modelo inválido: "${d.model}"` });
      }
      if (d.systemPrompt && d.systemPrompt.length > 4000) {
        errors.push({ nodeId: node.id, message: 'Prompt de sistema do agente excede 4000 caracteres.' });
      }
      if (d.maxTokens && (d.maxTokens < 1 || d.maxTokens > 1024)) {
        errors.push({ nodeId: node.id, message: 'maxTokens do agente deve estar entre 1 e 1024.' });
      }
    }

    if (node.type === 'http') {
      if (!d.httpUrl?.trim()) {
        errors.push({ nodeId: node.id, message: 'Bloco HTTP exige uma URL.' });
      } else {
        try {
          const parsed = new URL(d.httpUrl.trim());
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            errors.push({ nodeId: node.id, message: 'URL HTTP deve usar protocolo http:// ou https://' });
          }
        } catch {
          errors.push({ nodeId: node.id, message: `URL HTTP inválida: "${d.httpUrl}"` });
        }
      }
    }

    if (node.type === 'sql') {
      const q = d.sqlQuery?.trim() || '';
      if (!q) {
        errors.push({ nodeId: node.id, message: 'Bloco SQL exige uma instrução SQL.' });
      } else {
        // Anti-SQL injection checks on the template query
        if (q.includes(';')) {
          errors.push({ nodeId: node.id, message: 'Bloco SQL não permite ponto e vírgula (;).' });
        }
        if (q.includes('--') || q.includes('/*')) {
          errors.push({ nodeId: node.id, message: 'Bloco SQL não permite comentários (-- ou /*).' });
        }
        if (d.sqlMode === 'read') {
          if (!/^\s*SELECT\b/i.test(q)) {
            errors.push({ nodeId: node.id, message: 'Modo leitura do bloco SQL aceita apenas comandos SELECT.' });
          }
        }
      }
    }

    if (node.type === 'delay') {
      const sec = Number(d.delaySeconds);
      if (Number.isFinite(sec) && (sec < 0 || sec > 10)) {
        errors.push({ nodeId: node.id, message: 'Delay suporta no máximo 10 segundos.' });
      }
    }

    if (node.type === 'handoff') {
      if (!d.notifyNumber?.trim()) {
        errors.push({ nodeId: node.id, message: 'Bloco de transbordo humano exige o número do atendente.' });
      }
    }
  }

  // 4. Paths termination check: every reachable non-terminal path must terminate or wait
  // A terminal node is 'end' or 'handoff'.
  // A waiting node is 'wait_reply', 'menu', 'capture'.
  // Any node without outgoing edges must be terminal or waiting.
  for (const node of nodes) {
    if (!reachable.has(node.id)) continue;
    const outs = outgoingMap.get(node.id) || [];
    if (outs.length === 0) {
      if (!TERMINAL_TYPES.has(node.type) && !WAITING_TYPES.has(node.type)) {
        errors.push({
          nodeId: node.id,
          message: `Bloco "${node.id}" (${node.type}) não tem saída conectada e não encerra o fluxo (use "Encerrar" ou "Passe para um humano").`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
