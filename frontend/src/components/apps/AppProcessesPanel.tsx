import React, { useState } from 'react';
import { Plus, Trash2, Play } from 'lucide-react';
import { api } from '../../services/api.js';
import { useToast } from '../Toast.js';
import type { AppProcess, AppRecord } from '../../types/index.js';

interface Props {
  app: AppRecord;
  onSaved: (app: AppRecord) => void;
}

export const AppProcessesPanel: React.FC<Props> = ({ app, onSaved }) => {
  const toast = useToast();
  const [processes, setProcesses] = useState<AppProcess[]>(app.processes || []);
  const [saving, setSaving] = useState(false);
  const [runCommand, setRunCommand] = useState('');
  const [runOut, setRunOut] = useState('');
  const [running, setRunning] = useState(false);

  const save = async () => {
    try {
      setSaving(true);
      const res = await api.put(`/apps/${app.id}/processes`, { processes });
      onSaved(res.data);
      toast.success('Processos salvos');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao salvar processos');
    } finally {
      setSaving(false);
    }
  };

  const runOnce = async () => {
    if (!runCommand.trim()) return;
    try {
      setRunning(true);
      const res = await api.post(`/apps/${app.id}/run`, { command: runCommand.trim() });
      setRunOut(res.data.logs || `exit ${res.data.exitCode}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Falha no comando');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-5 rounded-lg bg-surface-container border border-outline-variant space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Processos</h3>
          <button
            onClick={() =>
              setProcesses([...processes, { name: `worker${processes.length + 1}`, type: 'worker', command: '', replicas: 1 }])
            }
            className="px-2.5 py-1 rounded bg-surface-container-high text-xs text-on-surface border border-outline-variant flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Processo
          </button>
        </div>
        {processes.length === 0 && (
          <p className="text-xs text-on-surface-variant">Nenhum processo extra. O web usa o start da receita.</p>
        )}
        {processes.map((proc, idx) => (
          <div key={`${proc.name}-${idx}`} className="p-3 rounded bg-surface-container-low border border-outline-variant grid grid-cols-1 sm:grid-cols-12 gap-2">
            <input
              value={proc.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              className="sm:col-span-2 bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-white font-mono"
            />
            <select
              value={proc.type}
              onChange={(e) => update(idx, { type: e.target.value as AppProcess['type'] })}
              className="sm:col-span-2 bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-white"
            >
              <option value="web">web</option>
              <option value="worker">worker</option>
              <option value="cron">cron</option>
              <option value="release">release</option>
            </select>
            <input
              value={proc.command}
              onChange={(e) => update(idx, { command: e.target.value })}
              placeholder="comando"
              className="sm:col-span-5 bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-white font-mono"
            />
            {proc.type === 'cron' ? (
              <input
                value={proc.schedule || ''}
                onChange={(e) => update(idx, { schedule: e.target.value })}
                placeholder="*/5 * * * *"
                className="sm:col-span-2 bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-white font-mono"
              />
            ) : proc.type === 'worker' ? (
              <input
                type="number"
                min={1}
                max={4}
                value={proc.replicas || 1}
                onChange={(e) => update(idx, { replicas: Number(e.target.value) })}
                className="sm:col-span-2 bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-white"
              />
            ) : (
              <div className="sm:col-span-2" />
            )}
            <button
              onClick={() => setProcesses(processes.filter((_, i) => i !== idx))}
              className="sm:col-span-1 p-1.5 text-on-surface-variant hover:text-crit"
            >
              <Trash2 className="w-4 h-4 mx-auto" />
            </button>
          </div>
        ))}
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded bg-primary text-on-primary text-xs font-semibold disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar processos'}
        </button>
      </div>

      <div className="p-5 rounded-lg bg-surface-container border border-outline-variant space-y-3">
        <h3 className="text-sm font-bold text-white">Comando único (one-off)</h3>
        <p className="text-xs text-on-surface-variant">Roda na imagem da última release, sem porta, e encerra.</p>
        <div className="flex gap-2">
          <input
            value={runCommand}
            onChange={(e) => setRunCommand(e.target.value)}
            placeholder="python manage.py createsuperuser --noinput"
            className="flex-1 bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
          />
          <button
            onClick={runOnce}
            disabled={running}
            className="px-3 py-2 rounded bg-surface-container-high border border-outline-variant text-xs text-white flex items-center gap-1"
          >
            <Play className="w-3.5 h-3.5" />
            {running ? 'Rodando...' : 'Executar'}
          </button>
        </div>
        {runOut && (
          <pre className="p-3 bg-black/95 rounded border border-outline-variant font-mono text-[11px] text-on-surface max-h-48 overflow-auto">
            {runOut}
          </pre>
        )}
      </div>
    </div>
  );

  function update(idx: number, patch: Partial<AppProcess>) {
    setProcesses(processes.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
};
