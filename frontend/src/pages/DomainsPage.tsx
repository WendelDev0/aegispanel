import React, { useState, useEffect } from 'react';
import {
  Globe,
  Plus,
  Trash2,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  X,
  Info,
  Lock,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ShieldAlert,
  Server,
  Zap,
  ArrowRight
} from 'lucide-react';
import { api } from '../services/api.js';
import { DomainRecord } from '../types/index.js';

interface SslModalInfo {
  domain: string;
  issuer: string;
  validTo: string;
  daysRemaining: number;
  protocol: string;
  status: string;
}

export const DomainsPage: React.FC = () => {
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [domainInput, setDomainInput] = useState('');
  const [targetPort, setTargetPort] = useState('3000');
  const [submitting, setSubmitting] = useState(false);

  // Hostinger DNS guide state
  const [serverIp, setServerIp] = useState('13.140.41.82');
  const [selectedSslModal, setSelectedSslModal] = useState<SslModalInfo | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [checkingDnsMap, setCheckingDnsMap] = useState<Record<string, boolean>>({});
  const [dnsStatusMap, setDnsStatusMap] = useState<Record<string, { status: string; message: string }>>({});
  const [renewingSslId, setRenewingSslId] = useState<string | null>(null);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      const [resDomains, resSystem] = await Promise.all([
        api.get('/domains'),
        api.get('/system/overview'),
      ]);
      setDomains(resDomains.data);
      const publicIp = resSystem.data?.system?.osInfo?.publicIp;
      if (publicIp) {
        setServerIp(publicIp);
      } else if (window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        setServerIp(window.location.hostname);
      }
    } catch (err) {
      console.error('Failed to fetch domains:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDomains();
  }, []);

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput || !targetPort) return;

    try {
      setSubmitting(true);
      await api.post('/domains', {
        domain: domainInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
        targetPort: parseInt(targetPort),
      });

      setShowAddModal(false);
      setDomainInput('');
      fetchDomains();
    } catch (err: any) {
      alert('Erro ao adicionar domínio: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDomain = async (id: string, domainName: string) => {
    if (!confirm(`Remover o domínio "${domainName}" do proxy reverso?`)) return;
    try {
      await api.delete(`/domains/${id}`);
      fetchDomains();
    } catch (err: any) {
      alert('Erro ao remover domínio: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCheckDns = async (domainObj: DomainRecord) => {
    setCheckingDnsMap(prev => ({ ...prev, [domainObj.id]: true }));
    try {
      const res = await api.post('/domains/check-dns', { domain: domainObj.domain });
      setDnsStatusMap(prev => ({
        ...prev,
        [domainObj.id]: { status: res.data.status, message: res.data.message },
      }));
    } catch (err: any) {
      setDnsStatusMap(prev => ({
        ...prev,
        [domainObj.id]: { status: 'error', message: 'Erro na verificação de DNS' },
      }));
    } finally {
      setCheckingDnsMap(prev => ({ ...prev, [domainObj.id]: false }));
    }
  };

  const handleInspectSsl = async (domainObj: DomainRecord) => {
    try {
      const res = await api.get(`/domains/${domainObj.id}/ssl-status`);
      setSelectedSslModal(res.data);
    } catch (err: any) {
      alert('Erro ao carregar detalhes SSL: ' + err.message);
    }
  };

  const handleRenewSsl = async (domainObj: DomainRecord) => {
    setRenewingSslId(domainObj.id);
    try {
      await api.post(`/domains/${domainObj.id}/renew-ssl`);
      alert(`Certificado SSL para ${domainObj.domain} renovado com sucesso!`);
      fetchDomains();
    } catch (err: any) {
      alert('Erro ao renovar SSL: ' + (err.response?.data?.error || err.message));
    } finally {
      setRenewingSslId(null);
    }
  };

  const [resettingCaddy, setResettingCaddy] = useState(false);

  const handleForceResetCaddy = async () => {
    if (!confirm('Deseja forçar a limpeza do cache SSL e regeneração do Caddyfile? Isso resolverá qualquer erro de handshake ACME.')) return;
    try {
      setResettingCaddy(true);
      const res = await api.post('/system/caddy-reset');
      alert('✅ ' + res.data.message);
      fetchDomains();
    } catch (err: any) {
      alert('Erro ao resetar Caddy: ' + (err.response?.data?.error || err.message));
    } finally {
      setResettingCaddy(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Globe className="w-6 h-6 text-indigo-400" />
            Domínios & SSL Automático (Hostinger Ready)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Conecte seus domínios comprados na Hostinger com emissão automática de HTTPS grátis (Let's Encrypt / TLS 1.3).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleForceResetCaddy}
            disabled={resettingCaddy}
            title="Limpar cache do Let's Encrypt e regenerar configurações do proxy Caddy"
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs border border-amber-500/30 shadow-lg transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${resettingCaddy ? 'animate-spin text-amber-400' : ''}`} />
            <span>{resettingCaddy ? 'Resetando...' : 'Auto-Heal SSL'}</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            title="Mapear um novo domínio ou subdomínio para uma porta do servidor"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Adicionar Domínio
          </button>
        </div>
      </div>

      {/* Hostinger DNS Setup Guide Box */}
      <div className="bg-[#0f172a]/90 border border-indigo-500/30 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Passo a Passo: Como apontar seu domínio na Hostinger (hPanel)</h3>
              <p className="text-xs text-slate-400">
                Acesse o painel da Hostinger &rarr; <strong>Domínios</strong> &rarr; <strong>Zona DNS</strong> e adicione os registros abaixo:
              </p>
            </div>
          </div>

          <span className="hidden sm:inline-block text-xs font-mono font-bold text-indigo-300 bg-indigo-500/10 px-3 py-1 rounded-lg border border-indigo-500/20">
            Hostinger Config
          </span>
        </div>

        {/* DNS Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono bg-slate-950/80 rounded-xl border border-slate-800">
            <thead className="bg-slate-900 text-slate-400 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Tipo</th>
                <th className="py-2.5 px-4">Nome / Host</th>
                <th className="py-2.5 px-4">Aponta para (Valor / IP da VPS)</th>
                <th className="py-2.5 px-4">TTL</th>
                <th className="py-2.5 px-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              <tr>
                <td className="py-2.5 px-4 font-bold text-emerald-400">A</td>
                <td className="py-2.5 px-4 text-slate-200">@ (ou seu subdomínio)</td>
                <td className="py-2.5 px-4 text-emerald-400 font-bold select-all">{serverIp}</td>
                <td className="py-2.5 px-4 text-slate-400">300 (ou Padrão)</td>
                <td className="py-2.5 px-4 text-right">
                  <button
                    onClick={() => copyToClipboard(serverIp, 'ip')}
                    title="Copiar IP da VPS para colar na Hostinger"
                    className="p-1 rounded text-emerald-400 hover:text-white"
                  >
                    {copiedKey === 'ip' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-bold text-cyan-400">CNAME</td>
                <td className="py-2.5 px-4 text-slate-200">www</td>
                <td className="py-2.5 px-4 text-slate-300">@ (ou seudominio.com.br)</td>
                <td className="py-2.5 px-4 text-slate-400">300 (ou Padrão)</td>
                <td className="py-2.5 px-4 text-right">
                  <button
                    onClick={() => copyToClipboard('@', 'cname')}
                    title="Copiar Host CNAME"
                    className="p-1 rounded text-cyan-400 hover:text-white"
                  >
                    {copiedKey === 'cname' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-slate-400">
          💡 <strong>Dica Pro:</strong> Após salvar na Hostinger, o Caddy Server emitirá o certificado SSL (HTTPS com cadeado verde) automaticamente na primeira requisição ao domínio.
        </p>
      </div>

      {/* Domains List */}
      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      ) : domains.length === 0 ? (
        <div className="bg-[#0f172a]/60 rounded-2xl p-12 border border-slate-800 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto mb-4">
            <Globe className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Nenhum domínio configurado</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            Adicione seus domínios da Hostinger para expor suas APIs e sites com SSL automático.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm inline-flex items-center gap-2 shadow-lg shadow-indigo-600/30"
          >
            <Plus className="w-4 h-4" />
            Adicionar Primeiro Domínio
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {domains.map((dom) => {
            const isCheckingDns = checkingDnsMap[dom.id] || false;
            const dnsStatus = dnsStatusMap[dom.id];

            return (
              <div
                key={dom.id}
                className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                        <Lock className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://${dom.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-white text-base hover:text-indigo-400 flex items-center gap-1.5 transition-colors"
                          >
                            {dom.domain}
                            <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                          </a>
                        </div>
                        <p className="text-xs font-mono text-slate-400 mt-1 flex items-center gap-1.5">
                          <span>Redireciona para:</span>
                          <span className="text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            Porta :{dom.targetPort} no Servidor
                          </span>
                        </p>
                      </div>
                    </div>

                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" /> SSL Ativo
                    </span>
                  </div>

                  {/* DNS Status feedback */}
                  {dnsStatus && (
                    <div className={`p-2.5 rounded-xl text-xs mb-3 font-mono flex items-center gap-2 ${
                      dnsStatus.status === 'propagated'
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                        : 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                    }`}>
                      {dnsStatus.status === 'propagated' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                      )}
                      <span>{dnsStatus.message}</span>
                    </div>
                  )}
                </div>

                {/* Actions row with Tooltips */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCheckDns(dom)}
                      disabled={isCheckingDns}
                      title="Testar se a propagação do DNS na Hostinger já está concluída"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingDns ? 'animate-spin text-indigo-400' : ''}`} />
                      <span>{isCheckingDns ? 'Checando...' : 'Verificar DNS'}</span>
                    </button>

                    <button
                      onClick={() => handleInspectSsl(dom)}
                      title="Ver detalhes do Certificado SSL Let's Encrypt e validade"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-semibold border border-indigo-500/30 transition-colors"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Detalhes SSL</span>
                    </button>

                    <button
                      onClick={() => handleRenewSsl(dom)}
                      disabled={renewingSslId === dom.id}
                      title="Forçar renovação imediata do certificado SSL"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                    >
                      <Zap className={`w-3.5 h-3.5 ${renewingSslId === dom.id ? 'animate-bounce text-amber-400' : ''}`} />
                    </button>
                  </div>

                  <button
                    onClick={() => handleDeleteDomain(dom.id, dom.domain)}
                    title="Remover mapeamento de domínio"
                    className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Detalhes SSL */}
      {selectedSslModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">Certificado SSL Let's Encrypt</h3>
              </div>
              <button onClick={() => setSelectedSslModal(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono bg-slate-950 p-4 rounded-xl border border-slate-800 mb-4">
              <div>
                <span className="text-slate-500 block text-[10px]">DOMÍNIO</span>
                <span className="text-white font-bold">{selectedSslModal.domain}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">AUTORIDADE CERTIFICADORA</span>
                <span className="text-emerald-400">{selectedSslModal.issuer}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">PROTOCOLO</span>
                <span className="text-slate-300">{selectedSslModal.protocol}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">DIAS RESTANTES & RENOVAÇÃO</span>
                <span className="text-slate-200">{selectedSslModal.daysRemaining} dias (Renovação Automática Ativa)</span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedSslModal(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Adicionar Domínio */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-400" />
                Novo Mapeamento de Domínio (Hostinger)
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddDomain} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Nome de Domínio ou Subdomínio da Hostinger *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: api.meusite.com.br ou meudominio.com"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Porta da Aplicação no Servidor *
                </label>
                <input
                  type="number"
                  required
                  placeholder="ex: 3000, 5000, 8080"
                  value={targetPort}
                  onChange={(e) => setTargetPort(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  O tráfego seguro HTTPS na porta 443 será roteado para esta porta local no servidor.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
                >
                  {submitting ? 'Configurando SSL...' : 'Salvar & Ativar SSL'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
