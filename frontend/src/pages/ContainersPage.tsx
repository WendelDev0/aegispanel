import React, { useState, useEffect } from 'react';
import {
  Boxes,
  Play,
  Square,
  RefreshCw,
  Trash2,
  FileText,
  Activity,
  X,
  AlertTriangle,
  Server,
  CheckCircle2,
  Plug,
  ExternalLink,
  ShieldAlert
} from 'lucide-react';
import { api } from '../services/api.js';
import { ContainerInfo } from '../types/index.js';

interface DockerStatusInfo {
  isAvailable: boolean;
  connectionType: string;
  message: string;
}

export const ContainersPage: React.FC = () => {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [dockerStatus, setDockerStatus] = useState<DockerStatusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [selectedLogsContainer, setSelectedLogsContainer] = useState<ContainerInfo | null>(null);
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  const fetchContainersAndStatus = async () => {
    try {
      setLoading(true);
      const [resStatus, resContainers] = await Promise.all([
        api.get('/docker/status'),
        api.get('/docker/containers'),
      ]);
      setDockerStatus(resStatus.data);
      setContainers(resContainers.data);
    } catch (err) {
      console.error('Failed to load containers or status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContainersAndStatus();
    const interval = setInterval(fetchContainersAndStatus, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleReconnect = async () => {
    try {
      setReconnecting(true);
      const res = await api.post('/docker/reconnect');
      if (res.data.isAvailable) {
        alert('🎉 Docker Engine conectado com sucesso!');
      } else {
        alert('⚠️ Não foi possível conectar ao Docker Engine. Verifique se o Docker Desktop está aberto no Windows ou se o serviço docker está ativo na VPS.');
      }
      fetchContainersAndStatus();
    } catch (err: any) {
      alert('Erro ao reconectar: ' + (err.response?.data?.error || err.message));
    } finally {
      setReconnecting(false);
    }
  };

  const handleStart = async (id: string) => {
    try {
      await api.post(`/docker/containers/${id}/start`);
      fetchContainersAndStatus();
    } catch (err: any) {
      alert('Erro ao iniciar contêiner: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleStop = async (id: string) => {
    try {
      await api.post(`/docker/containers/${id}/stop`);
      fetchContainersAndStatus();
    } catch (err: any) {
      alert('Erro ao parar contêiner: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRestart = async (id: string) => {
    try {
      await api.post(`/docker/containers/${id}/restart`);
      fetchContainersAndStatus();
    } catch (err: any) {
      alert('Erro ao reiniciar contêiner: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja remover o contêiner "${name}"?`)) return;
    try {
      await api.delete(`/docker/containers/${id}`);
      fetchContainersAndStatus();
    } catch (err: any) {
      alert('Erro ao remover contêiner: ' + (err.response?.data?.error || err.message));
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
            <Boxes className="w-6 h-6 text-indigo-400" />
            Gerenciador Docker Engine (Portainer Style)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Gerencie contêineres Docker, visualize logs e monitore recursos em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            title="Tentar restabelecer conexão com o Docker Socket"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reconnecting ? 'animate-spin text-indigo-400' : ''}`} />
            <span>{reconnecting ? 'Conectando...' : 'Reconectar Docker'}</span>
          </button>
        </div>
      </div>

      {/* Docker Engine Status Diagnostic Card */}
      <div className={`p-5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
        dockerStatus?.isAvailable
          ? 'bg-emerald-950/20 border-emerald-500/30'
          : 'bg-amber-950/30 border-amber-500/30'
      }`}>
        <div className="flex items-start gap-3.5">
          <div className={`p-2.5 rounded-xl shrink-0 ${
            dockerStatus?.isAvailable ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
          }`}>
            {dockerStatus?.isAvailable ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-white text-sm">
                Status do Docker Engine: {dockerStatus?.isAvailable ? 'Ativo & Conectado' : 'Offline / Aguardando Ativação'}
              </h3>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                dockerStatus?.isAvailable ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
              }`}>
                {dockerStatus?.connectionType || 'Detectando...'}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              {dockerStatus?.isAvailable
                ? 'O motor Docker está respondendo normalmente a todos os comandos de criação e deploy.'
                : '💡 No Windows, abra o Docker Desktop. Em um servidor Linux, o Docker roda como serviço do sistema.'}
            </p>
          </div>
        </div>

        {!dockerStatus?.isAvailable && (
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold shrink-0 shadow transition-all active:scale-95 disabled:opacity-50"
          >
            {reconnecting ? 'Verificando...' : 'Verificar Agora'}
          </button>
        )}
      </div>

      {/* Containers List */}
      {loading && containers.length === 0 ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      ) : containers.length === 0 ? (
        <div className="bg-[#0f172a]/60 rounded-2xl p-12 border border-slate-800 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto mb-4">
            <Boxes className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Nenhum contêiner ativo encontrado</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Assim que você criar um banco de dados, deploy de aplicação ou instalar um template pelo Marketplace, seus contêineres aparecerão listados aqui.
          </p>
        </div>
      ) : (
        <div className="bg-[#0f172a]/80 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/90 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4 font-sans">Nome do Contêiner</th>
                  <th className="py-3.5 px-4">Imagem</th>
                  <th className="py-3.5 px-4">Status / Estado</th>
                  <th className="py-3.5 px-4">Portas Mapeadas</th>
                  <th className="py-3.5 px-4 text-right font-sans">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {containers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 px-4 font-sans font-bold text-white flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${c.state === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></div>
                      <span>{c.name}</span>
                    </td>

                    <td className="py-3.5 px-4 text-slate-300 truncate max-w-xs">{c.image}</td>

                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        c.state === 'running'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {c.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-slate-300">
                      {c.ports.length === 0 ? (
                        <span className="text-slate-600">-</span>
                      ) : (
                        c.ports.map((p, idx) => (
                          <span key={idx} className="inline-block bg-slate-900 px-1.5 py-0.5 rounded text-[10px] mr-1 border border-slate-800">
                            {p.publicPort ? `:${p.publicPort}➔` : ''}:{p.privatePort}/{p.type}
                          </span>
                        ))
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        {c.state === 'running' ? (
                          <button
                            onClick={() => handleStop(c.id)}
                            title="Parar contêiner"
                            className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                          >
                            <Square className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStart(c.id)}
                            title="Iniciar contêiner"
                            className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => handleRestart(c.id)}
                          title="Reiniciar contêiner"
                          className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => openLogs(c)}
                          title="Ver logs deste contêiner"
                          className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleDelete(c.id, c.name)}
                          title="Remover contêiner"
                          className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Container Logs */}
      {selectedLogsContainer && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0f1c] rounded-2xl border border-slate-800 w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
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
              {logsLoading ? 'Carregando logs...' : logsText}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
