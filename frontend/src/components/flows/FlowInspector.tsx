import React from 'react';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import type { WaFlowNode, WaPanelEvent } from '../../types/index.js';
import { BLOCK_META, EVENT_LABELS } from './flow-blocks.js';

interface FlowInspectorProps {
  node: WaFlowNode | null;
  onChange: (node: WaFlowNode) => void;
  onDelete: (id: string) => void;
}

const COMMON_VARS = ['nome', 'telefone_final', 'instancia', 'app', 'evento', 'ultima_mensagem', 'agora'];

export const FlowInspector: React.FC<FlowInspectorProps> = ({ node, onChange, onDelete }) => {
  if (!node) {
    return (
      <div className="p-4 text-xs text-on-surface-variant flex flex-col items-center justify-center h-full text-center">
        <HelpCircle className="w-8 h-8 text-outline-variant mb-2 opacity-60" />
        <p className="font-semibold text-white">Nenhum bloco selecionado</p>
        <p className="mt-1 text-[11px]">Clique em um bloco no canvas para configurar seu comportamento e conteúdo.</p>
      </div>
    );
  }

  const meta = BLOCK_META[node.type] || BLOCK_META.send_text;
  const patch = (data: Partial<WaFlowNode['data']>) => onChange({ ...node, data: { ...node.data, ...data } });

  const insertVar = (v: string) => {
    const current = node.data.text || '';
    patch({ text: `${current} {{${v}}}` });
  };

  return (
    <div className="p-3.5 space-y-4 text-xs">
      <div className="flex items-center justify-between pb-2 border-b border-outline-variant/60">
        <div>
          <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.badgeTone}`}>
            {meta.verb}
          </span>
          <p className="text-xs font-semibold text-white mt-1">{meta.label}</p>
        </div>
        <button
          type="button"
          onClick={() => onDelete(node.id)}
          className="p-1.5 rounded text-crit hover:bg-crit/10 transition-colors"
          title="Remover bloco"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* 1. trigger_message */}
      {node.type === 'trigger_message' && (
        <div className="space-y-3">
          <label className="block text-on-surface-variant">
            Critério de ativação
            <select
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs"
              value={node.data.match || 'any'}
              onChange={(e) => patch({ match: e.target.value as 'any' | 'contains' | 'regex' })}
            >
              <option value="any">Qualquer mensagem</option>
              <option value="contains">Contém palavra-chave</option>
              <option value="regex">Expressão Regular (Regex)</option>
            </select>
          </label>
          {node.data.match !== 'any' && (
            <label className="block text-on-surface-variant">
              Palavra ou Expressão
              <input
                className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
                placeholder={node.data.match === 'regex' ? '^([0-9]+)$' : 'oi, menu, ajuda'}
                value={node.data.keyword || ''}
                onChange={(e) => patch({ keyword: e.target.value })}
              />
            </label>
          )}
        </div>
      )}

      {/* 2. trigger_event */}
      {node.type === 'trigger_event' && (
        <div className="space-y-3">
          <label className="block text-on-surface-variant">
            Evento do painel
            <select
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs"
              value={node.data.event || 'deploy_fail'}
              onChange={(e) => patch({ event: e.target.value as WaPanelEvent })}
            >
              {(Object.keys(EVENT_LABELS) as WaPanelEvent[]).map((key) => (
                <option key={key} value={key}>
                  {EVENT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-on-surface-variant">
            Destinatário específico (opcional)
            <input
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
              placeholder="5511999998888 (ou usa Configurações)"
              value={node.data.recipient || ''}
              onChange={(e) => patch({ recipient: e.target.value })}
            />
          </label>
        </div>
      )}

      {/* 3. send_text */}
      {node.type === 'send_text' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-on-surface-variant">Mensagem</span>
            <span className="text-[10px] text-on-surface-variant">{(node.data.text || '').length}/2000</span>
          </div>
          <textarea
            className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-white text-xs min-h-[100px] font-sans focus:outline-none focus:border-primary"
            placeholder="Digite o texto da mensagem. Use {{nome}} para personalizar."
            value={node.data.text || ''}
            onChange={(e) => patch({ text: e.target.value })}
          />
          <div className="space-y-1">
            <span className="text-[10px] text-on-surface-variant">Variáveis disponíveis:</span>
            <div className="flex flex-wrap gap-1">
              {COMMON_VARS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVar(v)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-primary font-mono border border-outline-variant/60"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4. menu */}
      {node.type === 'menu' && (
        <div className="space-y-3">
          <label className="block text-on-surface-variant">
            Texto do cabeçalho
            <textarea
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-white text-xs min-h-[64px]"
              placeholder="Escolha uma opção:"
              value={node.data.text || ''}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant font-medium">Botões (até 3)</span>
              {(node.data.buttons || []).length < 3 && (
                <button
                  type="button"
                  onClick={() => {
                    const buttons = [...(node.data.buttons || [])];
                    buttons.push({ id: `btn-${Math.random().toString(36).slice(2, 7)}`, label: `Opção ${buttons.length + 1}` });
                    patch({ buttons });
                  }}
                  className="flex items-center gap-1 text-[10px] text-primary hover:underline font-semibold"
                >
                  <Plus className="w-3 h-3" /> Adicionar
                </button>
              )}
            </div>
            {(node.data.buttons || []).map((btn, i) => (
              <div key={btn.id} className="flex items-center gap-1.5">
                <span className="text-[10px] text-on-surface-variant font-mono w-4">{i + 1}.</span>
                <input
                  className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1 text-white text-xs"
                  value={btn.label}
                  placeholder={`Rótulo do botão ${i + 1}`}
                  onChange={(e) => {
                    const buttons = [...(node.data.buttons || [])];
                    buttons[i] = { ...btn, label: e.target.value };
                    patch({ buttons });
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const buttons = (node.data.buttons || []).filter((_, idx) => idx !== i);
                    patch({ buttons });
                  }}
                  className="p-1 text-on-surface-variant hover:text-crit"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. capture */}
      {node.type === 'capture' && (
        <div className="space-y-3">
          <label className="block text-on-surface-variant">
            Mensagem de solicitação (opcional)
            <textarea
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-white text-xs min-h-[60px]"
              placeholder="Por favor, digite seu e-mail:"
              value={node.data.text || ''}
              onChange={(e) => patch({ text: e.target.value })}
            />
          </label>
          <label className="block text-on-surface-variant">
            Nome da variável
            <input
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
              placeholder="ex: email, pedido, telefone"
              value={node.data.varName || ''}
              onChange={(e) => patch({ varName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
            />
          </label>
          <label className="block text-on-surface-variant">
            Tipo esperado para validação
            <select
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs"
              value={node.data.captureType || 'text'}
              onChange={(e) => patch({ captureType: e.target.value as any })}
            >
              <option value="text">Qualquer texto</option>
              <option value="number">Número (inteiro ou decimal)</option>
              <option value="phone">Telefone (8 a 16 dígitos)</option>
              <option value="email">E-mail válido</option>
            </select>
          </label>
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={Boolean(node.data.saveLead)}
              onChange={(e) => patch({ saveLead: e.target.checked })}
              className="w-3.5 h-3.5 rounded text-primary focus:ring-0"
            />
            <span className="text-on-surface-variant text-xs">Salvar como Lead (wa_leads)</span>
          </label>
        </div>
      )}

      {/* 6. condition */}
      {node.type === 'condition' && (
        <div className="space-y-3">
          <label className="block text-on-surface-variant">
            Fonte do dado
            <select
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs"
              value={node.data.source || 'lastText'}
              onChange={(e) => patch({ source: e.target.value as any })}
            >
              <option value="lastText">Última mensagem do cliente</option>
              <option value="var">Variável salva</option>
            </select>
          </label>
          {node.data.source === 'var' && (
            <label className="block text-on-surface-variant">
              Nome da variável
              <input
                className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
                placeholder="ex: email, pedido"
                value={node.data.varName || ''}
                onChange={(e) => patch({ varName: e.target.value })}
              />
            </label>
          )}
          <label className="block text-on-surface-variant">
            Operador
            <select
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs"
              value={node.data.operator || 'contains'}
              onChange={(e) => patch({ operator: e.target.value as any })}
            >
              <option value="contains">Contém</option>
              <option value="equals">Igual a</option>
              <option value="regex">Regex</option>
              <option value="exists">Existe / Não vazio</option>
              <option value="gt">Maior que (&gt;)</option>
              <option value="lt">Menor que (&lt;)</option>
            </select>
          </label>
          {node.data.operator !== 'exists' && (
            <label className="block text-on-surface-variant">
              Valor comparado
              <input
                className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs"
                placeholder="ex: sim, 10, /ativo/i"
                value={node.data.value || ''}
                onChange={(e) => patch({ value: e.target.value })}
              />
            </label>
          )}
        </div>
      )}

      {/* 7. agent */}
      {node.type === 'agent' && (
        <div className="space-y-3">
          <label className="block text-on-surface-variant">
            Provedor de IA
            <select
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs"
              value={node.data.provider || 'openai'}
              onChange={(e) => patch({ provider: e.target.value as any })}
            >
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          <label className="block text-on-surface-variant">
            Modelo
            <input
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
              placeholder="gpt-4o-mini ou meta-llama/llama-3.1-8b"
              value={node.data.model || 'gpt-4o-mini'}
              onChange={(e) => patch({ model: e.target.value })}
            />
          </label>
          <label className="block text-on-surface-variant">
            Prompt de sistema
            <textarea
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-white text-xs min-h-[90px] font-sans"
              placeholder="Você é um atendente simpático de uma hamburgueria..."
              value={node.data.systemPrompt || ''}
              onChange={(e) => patch({ systemPrompt: e.target.value })}
            />
          </label>
          <label className="block text-on-surface-variant">
            Texto de fallback (se IA falhar ou estourar cota)
            <input
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs"
              placeholder="Em breve um atendente irá te responder!"
              value={node.data.fallbackText || ''}
              onChange={(e) => patch({ fallbackText: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-on-surface-variant">
              Max Tokens
              <input
                type="number"
                min="50"
                max="1024"
                className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-xs font-mono"
                value={node.data.maxTokens ?? 512}
                onChange={(e) => patch({ maxTokens: parseInt(e.target.value, 10) || 512 })}
              />
            </label>
            <label className="block text-on-surface-variant">
              Turnos de Memória
              <input
                type="number"
                min="1"
                max="30"
                className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-xs font-mono"
                value={node.data.memoryTurns ?? 12}
                onChange={(e) => patch({ memoryTurns: parseInt(e.target.value, 10) || 12 })}
              />
            </label>
          </div>
        </div>
      )}

      {/* 8. http */}
      {node.type === 'http' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-on-surface-variant col-span-1">
              Método
              <select
                className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-xs"
                value={node.data.httpMethod || 'GET'}
                onChange={(e) => patch({ httpMethod: e.target.value as any })}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </label>
            <label className="block text-on-surface-variant col-span-2">
              Salvar resposta em
              <input
                className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-white text-xs font-mono"
                placeholder="var_api"
                value={node.data.saveAs || ''}
                onChange={(e) => patch({ saveAs: e.target.value })}
              />
            </label>
          </div>
          <label className="block text-on-surface-variant">
            URL da API
            <input
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
              placeholder="https://sua-loja.com/api/pedidos"
              value={node.data.httpUrl || ''}
              onChange={(e) => patch({ httpUrl: e.target.value })}
            />
          </label>
          {node.data.httpMethod === 'POST' && (
            <label className="block text-on-surface-variant">
              Corpo JSON (com vars)
              <textarea
                className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-white text-xs min-h-[70px] font-mono"
                placeholder='{"cliente": "{{nome}}", "item": "{{pedido}}"}'
                value={node.data.httpBody || ''}
                onChange={(e) => patch({ httpBody: e.target.value })}
              />
            </label>
          )}
        </div>
      )}

      {/* 9. sql */}
      {node.type === 'sql' && (
        <div className="space-y-3">
          <label className="block text-on-surface-variant">
            Modo
            <select
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs"
              value={node.data.sqlMode || 'read'}
              onChange={(e) => patch({ sqlMode: e.target.value as any })}
            >
              <option value="read">Leitura (SELECT)</option>
              <option value="write">Escrita (INSERT/UPDATE tabelas wa_*)</option>
            </select>
          </label>
          <label className="block text-on-surface-variant">
            Instrução SQL ($1, $2)
            <textarea
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-white text-xs min-h-[80px] font-mono"
              placeholder="SELECT id, nome FROM wa_pedidos WHERE cliente = $1"
              value={node.data.sqlQuery || ''}
              onChange={(e) => patch({ sqlQuery: e.target.value })}
            />
          </label>
          <label className="block text-on-surface-variant">
            Salvar linha em variável
            <input
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
              placeholder="pedido_db"
              value={node.data.saveAs || ''}
              onChange={(e) => patch({ saveAs: e.target.value })}
            />
          </label>
        </div>
      )}

      {/* 10. handoff */}
      {node.type === 'handoff' && (
        <div className="space-y-3">
          <label className="block text-on-surface-variant">
            Número do Atendente (com DDI e DDD)
            <input
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
              placeholder="5511999998888"
              value={node.data.notifyNumber || ''}
              onChange={(e) => patch({ notifyNumber: e.target.value })}
            />
          </label>
          <label className="block text-on-surface-variant">
            Mensagem de aviso ao atendente
            <textarea
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg p-2 text-white text-xs min-h-[60px]"
              placeholder="Cliente {{nome}} ({{telefone_final}}) aguardando atendimento."
              value={node.data.notifyMessage || ''}
              onChange={(e) => patch({ notifyMessage: e.target.value })}
            />
          </label>
          <label className="block text-on-surface-variant">
            Duração da pausa (minutos)
            <input
              type="number"
              min="5"
              max="1440"
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
              value={node.data.resumeMinutes ?? 120}
              onChange={(e) => patch({ resumeMinutes: parseInt(e.target.value, 10) || 120 })}
            />
          </label>
        </div>
      )}

      {/* 11. delay */}
      {node.type === 'delay' && (
        <div className="space-y-3">
          <label className="block text-on-surface-variant">
            Tempo de pausa (segundos)
            <input
              type="number"
              min="1"
              max="10"
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-white text-xs font-mono"
              value={node.data.delaySeconds ?? 2}
              onChange={(e) => patch({ delaySeconds: Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 2)) })}
            />
          </label>
          <p className="text-[11px] text-on-surface-variant">
            Durante este período, o WhatsApp exibirá o status "digitando..." para o cliente.
          </p>
        </div>
      )}

      {/* 12. end */}
      {node.type === 'end' && (
        <div className="text-on-surface-variant space-y-1">
          <p className="font-semibold text-white">Fim do fluxo</p>
          <p className="text-[11px]">
            Este bloco encerra a conversa e limpa a sessão viva do cliente, permitindo que uma nova mensagem reinicie pelo gatilho.
          </p>
        </div>
      )}
    </div>
  );
};
