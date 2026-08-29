import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Play,
  Square,
  RefreshCw,
  Trash2,
  FileText,
  Terminal,
  Activity,
  X,
  AlertCircle
} from 'lucide-react';
import { api } from '../services/api.js';
import { ContainerInfo } from '../types/index.js';

export const ContainersPage: React.FC = () => {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDockerAvailable, setIsDockerAvailable] = useState(true);
  const [selectedLogsContainer, setSelectedLogsContainer] = useState<ContainerInfo | null>(null);
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  const fetchContainers = async () => {
    try {
      setLoading(true);
      const [resStatus, resContainers] = await Promise.all([
        api.get('/docker/status'),
        api.get('/docker/containers'),
      ]);
      setIsDockerAvailable(resStatus.data.isAvailable);
      setContainers(resContainers.data);
    } catch (err) {
      console.error('Failed to fetch containers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContainers();
  }, []);

  const handleStart = async (id: string) => {
    try {
      await api.post(`/docker/containers/${id}/start`);
      fetchContainers();
    } catch (err: any) {
      alert('Erro ao iniciar container: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleStop = async (id: string) => {
    try {
      await api.post(`/docker/containers/${id}/stop`);
      fetchContainers();
    } catch (err: any) {
      alert('Erro ao parar container: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRestart = async (id: string) => {
    try {
      await api.post(`/docker/containers/${id}/restart`);
      fetchContainers();
    } catch (err: any) {
      alert('Erro ao reiniciar container: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Remover definitivamente o container "${name}"?`)) return;
    try {
      await api.delete(`/docker/containers/${id}`);
      fetchContainers();
    } catch (err: any) {
      alert('Erro ao remover container: ' + (err.response?.data?.error || err.message));
    }
  };

  const openLogs = async (container: ContainerInfo) => {
    setSelectedLogsContainer(container);
    setLogsLoading(true);
    setLogsText('');
    try {
      const res = await api.get(`/docker/containers/${container.id}/logs`);
      setLogsText(res.data.logs || 'Sem logs disponíveis.');
    } catch (err: any) {
      setLogsText('Erro ao carregar logs: ' + err.message);
    } finally {
      setLogsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Boxes className="w-6 h-6 text-cyan-400" />
            Gerenciador Docker Engine
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Supervisione todos os contêineres em execução no servidor (estilo Portainer integrado).
          </p>
        </div>

        <button
          onClick={fetchContainers}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition-colors shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar Lista
        </button>
      </div>

      {!isDockerAvailable && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-3 text-amber-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <span className="font-semibold">Docker Daemon não detectado:</span> O Docker precisa estar rodando para gerenciar containers.
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-[#0f172a]/80 rounded-2xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Container / Nome</th>
                <th className="py-3.5 px-4">Imagem</th>
                <th className="py-3.5 px-4">Portas Mapeadas</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {containers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-slate-500 font-sans">
                    Nenhum container Docker encontrado.
                  </td>
                </tr>
              ) : (
                containers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-200 font-sans text-sm">{c.name}</div>
                      <span className="text-[11px] text-slate-500">{c.id}</span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-300 truncate max-w-xs">{c.image}</td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {c.ports.length > 0
                        ? c.ports.map((p, idx) => (
                            <span
                              key={idx}
                              className="inline-block bg-slate-900 px-1.5 py-0.5 rounded mr-1 text-[11px] text-cyan-400 border border-slate-800"
                            >
                              {p.publicPort ? `${p.publicPort}:` : ''}{p.privatePort}/{p.type}
                            </span>
                          ))
                        : 'Nenhuma porta pública'}
                    </td>
                    <td className="py-3.5 px-4 font-sans">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          c.state === 'running'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            c.state === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                          }`}
                        ></span>
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        {c.state === 'running' ? (
                          <button
                            onClick={() => handleStop(c.id)}
                            title="Parar"
                            className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                          >
                            <Square className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStart(c.id)}
                            title="Iniciar"
                            className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => handleRestart(c.id)}
                          title="Reiniciar"
                          className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => openLogs(c)}
                          title="Logs"
                          className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleRemove(c.id, c.name)}
                          title="Remover"
                          className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Container Logs */}
      {selectedLogsContainer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0f1c] rounded-2xl border border-slate-800 w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-cyan-400" />
                <span className="font-bold text-white text-sm">Logs: {selectedLogsContainer.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openLogs(selectedLogsContainer)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700"
                  title="Atualizar logs"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedLogsContainer(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-auto font-mono text-xs text-slate-300 bg-black/90 whitespace-pre-wrap leading-relaxed">
              {logsLoading ? 'Carregando logs do container...' : logsText}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
