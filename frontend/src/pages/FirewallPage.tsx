import React, { useState, useEffect } from 'react';
import {
  Shield,
  Plus,
  Trash2,
  Lock,
  Unlock,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  X,
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import { api } from '../services/api.js';
import { FirewallRule } from '../types/index.js';

export const FirewallPage: React.FC = () => {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Form states
  const [port, setPort] = useState('');
  const [protocol, setProtocol] = useState<'tcp' | 'udp' | 'both'>('tcp');
  const [action, setAction] = useState<'allow' | 'deny'>('allow');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * Whether ufw can actually be driven from this process. The panel usually
   * runs in a container without ufw, and rules listed here were previously
   * shown as active while nothing had been applied on the host.
   */
  const [enforcement, setEnforcement] = useState<{ available: boolean; reason: string } | null>(null);

  const fetchEnforcement = async () => {
    try {
      const res = await api.get('/firewall/status');
      setEnforcement(res.data);
    } catch {
      setEnforcement(null);
    }
  };

  const fetchRules = async () => {
    try {
      setLoading(true);
      const res = await api.get('/firewall/rules');
      setRules(res.data);
    } catch (err) {
      console.error('Failed to fetch firewall rules:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
    fetchEnforcement();
  }, []);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!port) return;

    try {
      setSubmitting(true);
      await api.post('/firewall/rules', {
        port: parseInt(port),
        protocol,
        action,
        comment: comment.trim() || `Regra de Porta ${port}`,
      });

      setShowAddModal(false);
      setPort('');
      setComment('');
      fetchRules();
    } catch (err: any) {
      alert('Erro ao adicionar regra: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRule = async (id: string, portNum: number) => {
    if (!confirm(`Tem certeza que deseja remover a regra da porta ${portNum}?`)) return;
    try {
      await api.delete(`/firewall/rules/${id}`);
      fetchRules();
    } catch (err: any) {
      alert('Erro ao deletar regra: ' + (err.response?.data?.error || err.message));
    }
  };

  const applyPreset = (presetPort: number, presetComment: string) => {
    setPort(presetPort.toString());
    setComment(presetComment);
    setShowAddModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-400" />
            Segurança & Firewall UFW
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Controle as portas abertas no servidor da sua VPS e proteja sua máquina contra acessos não autorizados.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          title="Adicionar nova porta permitida ou bloqueada"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nova Regra de Porta
        </button>
      </div>

      {enforcement && !enforcement.available && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-amber-500/40 bg-amber-500/10">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-amber-200 text-sm">As regras abaixo não estão sendo aplicadas no sistema</h4>
            <p className="text-xs text-amber-100/80 mt-1">{enforcement.reason}</p>
            <p className="text-xs text-amber-100/60 mt-1">
              Elas ficam registradas no painel como documentação, mas o bloqueio real precisa ser feito no host
              com <code className="font-mono">sudo ufw</code>.
            </p>
          </div>
        </div>
      )}

      {/* Security Audit Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-[#0f172a]/80 p-5 rounded-2xl border border-slate-800 flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Firewall Ativo</h4>
            <p className="text-xs text-slate-400 mt-1">
              Todas as portas não autorizadas explicitamente são bloqueadas pelo kernel Linux.
            </p>
          </div>
        </div>

        <div className="bg-[#0f172a]/80 p-5 rounded-2xl border border-slate-800 flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Proteção SSH & 22</h4>
            <p className="text-xs text-slate-400 mt-1">
              Acesso seguro com autenticação criptografada e proteção por chave privada.
            </p>
          </div>
        </div>

        <div className="bg-[#0f172a]/80 p-5 rounded-2xl border border-slate-800 flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Fail2ban & Brute-Force</h4>
            <p className="text-xs text-slate-400 mt-1">
              IPs com tentativas repetidas de senha incorreta são banidos automaticamente.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Presets */}
      <div className="bg-[#0f172a]/60 rounded-2xl p-5 border border-slate-800">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
          Atalhos de Portas Comuns:
        </h4>
        <div className="flex flex-wrap gap-2 text-xs font-mono">
          {[
            { port: 22, name: 'SSH (22)' },
            { port: 80, name: 'HTTP Web (80)' },
            { port: 443, name: 'HTTPS SSL (443)' },
            { port: 5432, name: 'PostgreSQL (5432)' },
            { port: 3306, name: 'MySQL (3306)' },
            { port: 6379, name: 'Redis (6379)' },
            { port: 27017, name: 'MongoDB (27017)' },
          ].map((p) => (
            <button
              key={p.port}
              onClick={() => applyPreset(p.port, p.name)}
              title={`Clique para configurar regra para porta ${p.port}`}
              className="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
            >
              + {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Rules Table */}
      <div className="bg-[#0f172a]/80 rounded-2xl border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <Lock className="w-4 h-4 text-indigo-400" />
            Regras de Firewall Configuradas
          </h3>
          <button
            onClick={fetchRules}
            title="Atualizar lista de regras"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/90 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Porta</th>
                <th className="py-3 px-4">Protocolo</th>
                <th className="py-3 px-4">Ação</th>
                <th className="py-3 px-4 font-sans">Descrição / Serviço</th>
                <th className="py-3 px-4 text-right font-sans">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-500 font-sans">
                    Nenhuma regra cadastrada.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-200">:{rule.port}</td>
                    <td className="py-3 px-4 text-slate-400 uppercase">{rule.protocol}</td>
                    <td className="py-3 px-4 font-sans">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          rule.action === 'allow'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {rule.action === 'allow' ? 'Liberada' : 'Bloqueada'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-sans text-slate-300">{rule.comment}</td>
                    <td className="py-3 px-4 text-right font-sans">
                      <button
                        onClick={() => handleDeleteRule(rule.id, rule.port)}
                        title={`Remover regra da porta ${rule.port}`}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Nova Regra */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Shield className="w-5 h-5 text-indigo-400" />
                Criar Regra de Firewall
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddRule} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Número da Porta *
                </label>
                <input
                  type="number"
                  required
                  placeholder="ex: 8080 ou 5432"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Protocolo
                  </label>
                  <select
                    value={protocol}
                    onChange={(e: any) => setProtocol(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="both">Ambos (TCP/UDP)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Ação
                  </label>
                  <select
                    value={action}
                    onChange={(e: any) => setAction(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="allow">Permitir (Allow)</option>
                    <option value="deny">Bloquear (Deny)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Descrição / Identificação
                </label>
                <input
                  type="text"
                  placeholder="ex: API Backend Node ou Painel"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
                >
                  {submitting ? 'Salvando...' : 'Salvar Regra'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
