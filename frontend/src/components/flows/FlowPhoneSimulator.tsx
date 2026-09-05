import React, { useState } from 'react';
import { Send, RotateCcw, Smartphone, Play, Eye, Sliders, CheckCircle, AlertCircle } from 'lucide-react';
import { api } from '../../services/api.js';
import type { WaFlowNode, WaFlowRecord } from '../../types/index.js';
import { BLOCK_META } from './flow-blocks.js';

interface FlowPhoneSimulatorProps {
  flowId: string;
  flow: WaFlowRecord | null;
  selectedNode: WaFlowNode | null;
  onSelectNode: (nodeId: string) => void;
  tab: 'preview' | 'simulate' | 'inspector';
  onTabChange: (tab: 'preview' | 'simulate' | 'inspector') => void;
}

interface SimTurn {
  role: 'user' | 'bot';
  text: string;
  buttons?: string[];
  nodeId?: string;
}

export const FlowPhoneSimulator: React.FC<FlowPhoneSimulatorProps> = ({
  flowId,
  flow,
  selectedNode,
  onSelectNode,
  tab,
  onTabChange,
}) => {
  const [messages, setMessages] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [turns, setTurns] = useState<SimTurn[]>([]);
  const [simVars, setSimVars] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [lastNodeId, setLastNodeId] = useState<string | null>(null);

  const runSimulation = async (newMessages: string[]) => {
    setRunning(true);
    try {
      const res = await api.post(`/wa-flows/${flowId}/simulate`, {
        messages: newMessages,
        initialVars: simVars,
      });
      setTurns(res.data.turns || []);
      setSimVars(res.data.vars || {});
      if (res.data.lastNodeId) {
        setLastNodeId(res.data.lastNodeId);
        onSelectNode(res.data.lastNodeId);
      }
    } catch (err: any) {
      console.error('Simulation error:', err);
    } finally {
      setRunning(false);
    }
  };

  const handleSend = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const nextList = [...messages, trimmed];
    setMessages(nextList);
    setInputText('');
    void runSimulation(nextList);
  };

  const handleReset = () => {
    setMessages([]);
    setTurns([]);
    setSimVars({});
    setLastNodeId(null);
  };

  return (
    <div className="flex flex-col h-full bg-surface-container border border-outline-variant rounded-xl overflow-hidden shadow-2xl">
      {/* Header Tabs */}
      <div className="flex items-center border-b border-outline-variant bg-surface-container-high px-2 py-1.5 gap-1">
        <button
          type="button"
          onClick={() => onTabChange('preview')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            tab === 'preview'
              ? 'bg-surface-container text-white shadow-sm'
              : 'text-on-surface-variant hover:text-white'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          Preview
        </button>
        <button
          type="button"
          onClick={() => onTabChange('simulate')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            tab === 'simulate'
              ? 'bg-surface-container text-white shadow-sm'
              : 'text-on-surface-variant hover:text-white'
          }`}
        >
          <Play className="w-3.5 h-3.5" />
          Simular
        </button>
        <button
          type="button"
          onClick={() => onTabChange('inspector')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            tab === 'inspector'
              ? 'bg-surface-container text-white shadow-sm'
              : 'text-on-surface-variant hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Bloco
        </button>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col items-center justify-start bg-surface-container-lowest/50">
        {/* Phone Frame */}
        <div className="w-[280px] sm:w-[300px] h-[520px] bg-[#0b141a] rounded-[36px] border-[6px] border-[#202c33] shadow-2xl flex flex-col overflow-hidden relative">
          {/* Phone Top Notch / Speaker */}
          <div className="h-5 bg-[#202c33] flex items-center justify-center relative">
            <div className="w-16 h-2.5 bg-[#0b141a] rounded-full" />
          </div>

          {/* WhatsApp Header */}
          <div className="bg-[#202c33] px-3 py-2 flex items-center gap-2.5 border-b border-[#2b3942]">
            <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-white text-xs font-bold">
              {flow?.name?.slice(0, 1) || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold truncate leading-tight">{flow?.name || 'Aegis Bot'}</p>
              <p className="text-[10px] text-emerald-400 leading-tight">online</p>
            </div>
            {tab === 'simulate' && (
              <button
                type="button"
                onClick={handleReset}
                className="p-1 rounded text-on-surface-variant hover:text-white"
                title="Reiniciar conversa"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* WhatsApp Body Screen */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-[#0b141a] select-text">
            {tab === 'preview' ? (
              // PREVIEW TAB: Shows selected node preview
              selectedNode ? (
                <div className="space-y-2">
                  <div className="text-[10px] text-center text-on-surface-variant/80 py-1">
                    Visualização em tempo real do bloco selecionado
                  </div>
                  <div className="bg-[#202c33] text-white p-2.5 rounded-lg rounded-tl-none text-xs max-w-[85%] shadow-md border border-[#2b3942]">
                    <p className="whitespace-pre-wrap break-words">
                      {selectedNode.data.text ||
                        (selectedNode.type === 'trigger_message'
                          ? `Gatilho: ${selectedNode.data.keyword || 'Qualquer mensagem'}`
                          : BLOCK_META[selectedNode.type]?.preview(selectedNode.data as Record<string, unknown>))}
                    </p>
                    <span className="text-[9px] text-[#8696a0] block text-right mt-1">12:00</span>
                  </div>

                  {selectedNode.type === 'menu' && (selectedNode.data.buttons || []).length > 0 && (
                    <div className="space-y-1 max-w-[85%]">
                      {(selectedNode.data.buttons || []).map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          disabled
                          className="w-full py-1.5 px-3 bg-[#202c33] text-emerald-400 text-xs font-semibold rounded-md border border-[#2b3942] text-center shadow-sm"
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center p-4 text-[#8696a0]">
                  <Smartphone className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-xs">Selecione um bloco no canvas para pré-visualizar a bolha do WhatsApp.</p>
                </div>
              )
            ) : (
              // SIMULATE TAB: Interactive conversation turns
              <div className="space-y-2.5">
                {turns.length === 0 ? (
                  <div className="text-center py-6 text-[#8696a0]">
                    <p className="text-xs">Envie uma mensagem abaixo para iniciar a conversa com o fluxo.</p>
                    <button
                      type="button"
                      onClick={() => handleSend('oi')}
                      className="mt-3 px-3 py-1 bg-emerald-700/30 text-emerald-400 rounded-full text-xs font-semibold border border-emerald-600/40 hover:bg-emerald-700/50"
                    >
                      Dizer "oi"
                    </button>
                  </div>
                ) : (
                  turns.map((turn, i) => (
                    <div
                      key={i}
                      className={`flex flex-col ${turn.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`p-2.5 rounded-lg text-xs max-w-[85%] shadow-md whitespace-pre-wrap break-words ${
                          turn.role === 'user'
                            ? 'bg-[#005c4b] text-white rounded-tr-none'
                            : 'bg-[#202c33] text-white rounded-tl-none border border-[#2b3942]'
                        }`}
                      >
                        {turn.text}
                        <span className="text-[9px] text-[#8696a0] block text-right mt-1">12:0{i % 10}</span>
                      </div>

                      {/* Interactive Buttons for bot menu responses */}
                      {turn.buttons && turn.buttons.length > 0 && (
                        <div className="space-y-1 w-[85%] mt-1">
                          {turn.buttons.map((label, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleSend(label)}
                              className="w-full py-1.5 px-3 bg-[#202c33] text-emerald-400 text-xs font-semibold rounded-md border border-[#2b3942] hover:bg-[#2b3942] transition-colors text-center shadow-sm"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
                {running && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 italic">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    digitando...
                  </div>
                )}
              </div>
            )}
          </div>

          {/* WhatsApp Bottom Input Bar (Simulate mode only) */}
          {tab === 'simulate' && (
            <div className="bg-[#202c33] p-2 flex items-center gap-2 border-t border-[#2b3942]">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSend(inputText);
                }}
                placeholder="Mensagem..."
                className="flex-1 bg-[#2a3942] text-white text-xs rounded-full px-3 py-2 focus:outline-none placeholder-[#8696a0]"
              />
              <button
                type="button"
                onClick={() => handleSend(inputText)}
                disabled={!inputText.trim() || running}
                className="w-8 h-8 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center justify-center shadow-md transition-all"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Variables Inspector Drawer (in simulation mode) */}
        {tab === 'simulate' && Object.keys(simVars).length > 0 && (
          <div className="w-[280px] sm:w-[300px] mt-3 bg-surface-container border border-outline-variant rounded-lg p-2.5 space-y-1.5">
            <span className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider block">
              Variáveis da sessão (vars)
            </span>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
              {Object.entries(simVars).map(([k, v]) => (
                <div key={k} className="bg-surface-container-low p-1.5 rounded border border-outline-variant/60 truncate">
                  <span className="text-primary font-semibold block truncate">{k}:</span>
                  <span className="text-white truncate block">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
