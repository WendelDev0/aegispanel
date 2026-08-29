import React, { useState, useEffect } from 'react';
import {
  Clock,
  Plus,
  Play,
  Trash2,
  RefreshCw,
  X,
  CheckCircle2,
  AlertCircle,
  Terminal,
  Database,
  Webhook,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import { api } from '../services/api.js';

export interface CronJobRecord {
  id: string;
  name: string;
  schedule: string;
  type: 'shell' | 'backup' | 'webhook';
  command?: string;
  webhookUrl?: string;
  enabled: boolean;
  lastRunAt?: string;
  lastStatus?: 'success' | 'failed';
  lastOutput?: string;
  createdAt: string;
}

export const CronPage: React.FC = () => {
  const [jobs, setJobs] = useState<CronJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 3 * * *');
  const [type, setType] = useState<'backup' | 'shell' | 'webhook'>('backup');
  const [command, setCommand] = useState('docker system prune -f');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await api.get('/cron');
      setJobs(res.data);
    } catch (err) {
      console.error('Failed to load cron jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !schedule) return;

    try {
      setSubmitting(true);
      await api.post('/cron', {
        name,
        schedule,
        type,
        command: type === 'shell' ? command : undefined,
        webhookUrl: type === 'webhook' ? webhookUrl : undefined,
      });

      setShowCreateModal(false);
      setName('');
      fetchJobs();
    } catch (err: any) {
      alert('Erro ao criar tarefa cron: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunNow = async (id: string) => {
    try {
      setRunningId(id);
      await api.post(`/cron/${id}/run`);
      fetchJobs();
    } catch (err: any) {
      alert('Erro ao executar tarefa: ' + (err.response?.data?.error || err.message));
    } finally {
      setRunningId(null);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await api.post(`/cron/${id}/toggle`);
      fetchJobs();
    } catch (err: any) {
      alert('Erro ao alterar status: ' + err.message);
    }
  };

  const handleDelete = async (id: string, jobName: string) => {
    if (!confirm(`Remover o agendamento "${jobName}"?`)) return;
    try {
      await api.delete(`/cron/${id}`);
      fetchJobs();
    } catch (err: any) {
      alert('Erro ao remover: ' + err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Clock className="w-6 h-6 text-indigo-400" />
            Agendador de Tarefas Automáticas (Cron Jobs)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Programe backups noturnos automáticos, limpeza de cache e chamadas de webhook recorrentes na VPS.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          title="Criar uma nova rotina agendada"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nova Tarefa Cron
        </button>
      </div>

      {/* Jobs List */}
      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-[#0f172a]/60 rounded-2xl p-12 border border-slate-800 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Nenhuma tarefa agendada</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            Automatize rotinas de manutenção e backups periódicos para seu servidor.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm inline-flex items-center gap-2 shadow-lg shadow-indigo-600/30"
          >
            <Plus className="w-4 h-4" />
            Criar Backup Noturno Automático
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800 hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleToggle(job.id)}
                    title={job.enabled ? 'Pausar tarefa' : 'Ativar tarefa'}
                    className="text-slate-400 hover:text-white"
                  >
                    {job.enabled ? (
                      <ToggleRight className="w-6 h-6 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-slate-600" />
                    )}
                  </button>

                  <h3 className="font-bold text-white text-base truncate flex items-center gap-2">
                    {job.name}
                    <span className="text-[11px] font-mono bg-slate-900 text-indigo-400 px-2 py-0.5 rounded border border-slate-800">
                      {job.schedule}
                    </span>
                  </h3>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono text-slate-400 pl-9">
                  {job.type === 'backup' ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <Database className="w-3.5 h-3.5" /> Backup Automático dos Bancos
                    </span>
                  ) : job.type === 'shell' ? (
                    <span className="text-indigo-300 flex items-center gap-1 truncate max-w-md">
                      <Terminal className="w-3.5 h-3.5" /> {job.command}
                    </span>
                  ) : (
                    <span className="text-cyan-400 flex items-center gap-1 truncate max-w-md">
                      <Webhook className="w-3.5 h-3.5" /> {job.webhookUrl}
                    </span>
                  )}
                </div>

                {job.lastOutput && (
                  <p className="text-[11px] font-mono text-slate-500 pl-9 truncate max-w-xl">
                    Última execução: {job.lastOutput}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center pl-9 sm:pl-0">
                <button
                  onClick={() => handleRunNow(job.id)}
                  disabled={runningId === job.id}
                  title="Executar tarefa imediatamente agora"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  <Play className={`w-3.5 h-3.5 ${runningId === job.id ? 'animate-spin' : ''}`} />
                  <span>{runningId === job.id ? 'Executando...' : 'Executar Agora'}</span>
                </button>

                <button
                  onClick={() => handleDelete(job.id, job.name)}
                  title="Excluir tarefa agendada"
                  className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Nova Tarefa Cron */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Clock className="w-5 h-5 text-indigo-400" />
                Nova Rotina Cron Agendada
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Nome da Tarefa *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: Backup Noturno ou Limpeza Semanal"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Expressão Cron (Agendamento) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="0 3 * * * (Todo dia às 03:00)"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
                <div className="flex gap-2 mt-1.5 text-[10px] text-indigo-400 font-mono">
                  <button type="button" onClick={() => setSchedule('0 3 * * *')} className="hover:underline">Todo dia 3h</button>
                  <span>•</span>
                  <button type="button" onClick={() => setSchedule('0 0 * * 0')} className="hover:underline">Domingos 0h</button>
                  <span>•</span>
                  <button type="button" onClick={() => setSchedule('*/30 * * * *')} className="hover:underline">A cada 30min</button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                  Tipo de Execução *
                </label>
                <select
                  value={type}
                  onChange={(e: any) => setType(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="backup">Dump de Backup Automático de Todos os Bancos</option>
                  <option value="shell">Comando Shell Linux / Docker</option>
                  <option value="webhook">Disparo de Webhook HTTP POST</option>
                </select>
              </div>

              {type === 'shell' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    Comando Shell *
                  </label>
                  <input
                    type="text"
                    required
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm font-mono"
                  />
                </div>
              )}

              {type === 'webhook' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                    URL do Webhook *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="https://meusite.com/api/cron"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm font-mono"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
                >
                  {submitting ? 'Agendando...' : 'Salvar Agendamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
