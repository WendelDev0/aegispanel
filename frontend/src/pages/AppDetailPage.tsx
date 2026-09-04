import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Play,
  RefreshCw,
  Rocket,
  Square,
  Activity,
  Variable,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { api } from '../services/api.js';
import { useToast } from '../components/Toast.js';
import { EnvEditor } from '../components/EnvEditor.js';
import type { AppRecord, DeploymentRecord, AppMetricsSnapshot } from '../types/index.js';

type Tab = 'deploys' | 'env' | 'saude';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'deploys', label: 'Deploys', icon: <Clock className="w-3.5 h-3.5" /> },
  { id: 'env', label: 'Variáveis', icon: <Variable className="w-3.5 h-3.5" /> },
  { id: 'saude', label: 'Saúde', icon: <Activity className="w-3.5 h-3.5" /> },
];

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface AppDetailPageProps {
  appId: string;
  onBack: () => void;
}

/**
 * One application, addressable by URL.
 *
 * The apps list previously carried every action as an icon on the card and
 * every view behind a modal, so nothing about an application could be linked
 * to: "look at this failed build" was not a URL anyone could send. The route
 * already carried an id (`/apps/<id>`); nothing read it.
 */
export const AppDetailPage: React.FC<AppDetailPageProps> = ({ appId, onBack }) => {
  const toast = useToast();
  const [app, setApp] = useState<AppRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('deploys');
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [metrics, setMetrics] = useState<AppMetricsSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [envDraft, setEnvDraft] = useState<Record<string, string> | null>(null);
  const [envLoaded, setEnvLoaded] = useState<Record<string, string> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/apps');
      const found = (res.data as AppRecord[]).find((a) => a.id === appId) || null;
      setApp(found);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Falha ao carregar a aplicação');
    } finally {
      setLoading(false);
    }
  }, [appId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab !== 'deploys') return;
    api
      .get(`/apps/${appId}/deployments`)
      .then((res) => setDeployments(Array.isArray(res.data) ? res.data : []))
      .catch(() => setDeployments([]));
  }, [appId, tab]);

  useEffect(() => {
    if (tab !== 'saude') return;
    api
      .get(`/apps/${appId}/metrics`)
      .then((res) => setMetrics(res.data))
      .catch(() => setMetrics(null));
  }, [appId, tab]);

  useEffect(() => {
    // The list response masks values, so the editor needs the real ones.
    if (tab !== 'env' || envLoaded) return;
    api
      .get(`/apps/${appId}/env`)
      .then((res) => setEnvLoaded(res.data?.env || {}))
      .catch((err) => toast.error(err.response?.data?.error || err.message, 'Falha ao ler variáveis'));
  }, [appId, tab, envLoaded, toast]);

  const act = async (action: string, label: string) => {
    try {
      setBusy(action);
      await api.post(`/apps/${appId}/${action}`);
      toast.success(`${label} concluído.`);
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, `Erro ao ${label.toLowerCase()}`);
    } finally {
      setBusy(null);
    }
  };

  const deployNow = async () => {
    try {
      setBusy('deploy');
      await api.post(`/apps/${appId}/deploy`, {});
      toast.info('O build começou. Acompanhe pelos logs.', 'Deploy disparado');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao disparar deploy');
    } finally {
      setBusy(null);
    }
  };

  const redeploy = async (dep: DeploymentRecord) => {
    const alvo = dep.commitHash ? `#${dep.commitHash}` : 'este deploy';
    if (!confirm(`Reconstruir ${alvo} do zero com a configuração atual?`)) return;
    try {
      setBusy(dep.id);
      await api.post(`/apps/${appId}/deployments/${dep.id}/redeploy`);
      toast.info('O build começou. Acompanhe pelos logs.', 'Redeploy disparado');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao redeployar');
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (dep: DeploymentRecord) => {
    if (!confirm('Voltar para a imagem já construída deste deploy? Leva segundos, sem recompilar.')) return;
    try {
      setBusy(dep.id);
      const res = await api.post(`/apps/${appId}/rollback/${dep.id}`);
      toast.success(res.data.message);
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao reverter');
    } finally {
      setBusy(null);
    }
  };

  const saveEnv = async () => {
    if (!envDraft) return;
    try {
      setBusy('env');
      await api.put(`/apps/${appId}/env`, { env: envDraft });
      // Build-time values are baked into the image, so saving alone does not
      // change what a browser downloads. Saying so here avoids the silent
      // failure of an operator editing a value and seeing nothing change.
      const temPublica = Object.keys(envDraft).some(
        (k) => k.startsWith('NEXT_PUBLIC_') || k.startsWith('VITE_')
      );
      toast.success(
        temPublica
          ? 'Variáveis salvas. As que começam com NEXT_PUBLIC_ ou VITE_ são assadas na imagem — use Redeploy para aplicá-las.'
          : 'Variáveis salvas. Reinicie a aplicação para aplicá-las.'
      );
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao salvar variáveis');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="p-6 text-xs text-on-surface-variant">Carregando aplicação...</div>;
  }
  if (!app) {
    return (
      <div className="p-6 space-y-3">
        <button onClick={onBack} className="text-xs text-primary flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar
        </button>
        <p className="text-sm text-on-surface">Aplicação não encontrada.</p>
      </div>
    );
  }

  const health = app.health?.status;
  const badge =
    app.status !== 'running'
      ? { label: app.status === 'building' ? 'Publicando' : app.status === 'error' ? 'Erro' : 'Parado', cls: 'text-on-surface-variant border-outline-variant bg-surface-container-high' }
      : health === 'unhealthy'
        ? { label: 'Não responde', cls: 'text-crit border-crit/30 bg-crit/10' }
        : health === 'starting'
          ? { label: 'Subindo', cls: 'text-warn border-warn/30 bg-warn/10' }
          : { label: 'Online', cls: 'text-ok border-ok/30 bg-ok/10' };

  return (
    <div className="p-6 space-y-5">
      <button
        onClick={onBack}
        className="text-xs text-on-surface-variant hover:text-white flex items-center gap-1.5"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Aplicações
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white truncate">{app.name}</h1>
            <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          {app.domain ? (
            <a
              href={`https://${app.domain}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1.5"
            >
              {app.domain} <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <p className="text-xs text-on-surface-variant/70">Sem domínio · porta :{app.port}</p>
          )}
          {app.health?.lastError && (
            <p className="text-[11px] text-crit">Última sondagem: {app.health.lastError}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={deployNow}
            disabled={busy === 'deploy'}
            className="px-3 py-2 rounded text-xs font-semibold bg-primary/10 text-primary border border-primary/30 hover:bg-primary/15 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Rocket className="w-3.5 h-3.5" /> Deploy
          </button>
          {app.status === 'running' ? (
            <button
              onClick={() => act('stop', 'Parar')}
              disabled={busy === 'stop'}
              className="px-3 py-2 rounded text-xs font-semibold bg-surface-container-high text-on-surface-variant border border-outline-variant hover:text-white disabled:opacity-50 flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5" /> Parar
            </button>
          ) : (
            <button
              onClick={() => act('start', 'Iniciar')}
              disabled={busy === 'start'}
              className="px-3 py-2 rounded text-xs font-semibold bg-ok/10 text-ok border border-ok/30 hover:bg-ok/15 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" /> Iniciar
            </button>
          )}
          <button
            onClick={() => act('restart', 'Reiniciar')}
            disabled={busy === 'restart'}
            className="px-3 py-2 rounded text-xs font-semibold bg-surface-container-high text-on-surface-variant border border-outline-variant hover:text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy === 'restart' ? 'animate-spin' : ''}`} /> Reiniciar
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-outline-variant">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-white'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'deploys' && (
        <div className="space-y-2">
          {deployments.length === 0 ? (
            <p className="text-xs text-on-surface-variant/70 py-6">Nenhum deploy registrado ainda.</p>
          ) : (
            deployments.map((dep) => (
              <div
                key={dep.id}
                className="p-4 rounded-lg bg-surface-container-low border border-outline-variant flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {dep.status === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-ok shrink-0" />
                    ) : dep.status === 'building' || dep.status === 'queued' ? (
                      <RefreshCw className="w-4 h-4 text-warn animate-spin shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-crit shrink-0" />
                    )}
                    <span className="font-bold text-on-surface text-xs truncate">
                      {dep.commitMessage || 'Deploy'}
                    </span>
                    <span className="text-[10px] font-mono text-primary bg-primary/20 px-2 py-0.5 rounded shrink-0">
                      {dep.branch}
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant font-mono">
                    {dep.commitHash ? `#${dep.commitHash} · ` : ''}
                    {dep.authorName} · {new Date(dep.createdAt).toLocaleString('pt-BR')} ·{' '}
                    {dep.durationSeconds}s
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => redeploy(dep)}
                    disabled={busy === dep.id}
                    title="Reconstruir este commit com a configuração atual"
                    className="px-3 py-1.5 rounded bg-primary/10 hover:bg-primary/15 text-primary border border-primary/30 text-xs font-semibold disabled:opacity-50 flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busy === dep.id ? 'animate-spin' : ''}`} />
                    Redeploy
                  </button>
                  {dep.status === 'success' && (
                    <button
                      onClick={() => rollback(dep)}
                      disabled={busy === dep.id}
                      title="Voltar para a imagem já construída — sem recompilar"
                      className="px-3 py-1.5 rounded bg-warn/10 hover:bg-warn/15 text-warn border border-warn/30 text-xs font-semibold disabled:opacity-50"
                    >
                      ⏪ Rollback
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'env' && (
        <div className="space-y-3">
          {envLoaded === null ? (
            <p className="text-xs text-on-surface-variant/70">Carregando variáveis...</p>
          ) : (
            <>
              <EnvEditor initialEnv={envLoaded} onChange={(record) => setEnvDraft(record)} />
              <div className="flex justify-end">
                <button
                  onClick={saveEnv}
                  disabled={busy === 'env' || !envDraft}
                  className="px-5 py-2.5 rounded text-xs font-semibold bg-ok/90 hover:bg-ok text-white disabled:opacity-50"
                >
                  {busy === 'env' ? 'Salvando...' : 'Salvar variáveis'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'saude' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="p-4 rounded-lg bg-surface-container-low border border-outline-variant">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">Sondagem</p>
            <p className="text-sm text-on-surface">
              {health === 'healthy'
                ? 'Respondendo normalmente'
                : health === 'unhealthy'
                  ? 'Sem resposta'
                  : health === 'starting'
                    ? 'Aguardando resposta'
                    : 'Ainda não verificada'}
            </p>
            {app.health?.checkedAt && (
              <p className="text-[10px] text-on-surface-variant/70 mt-1">
                {new Date(app.health.checkedAt).toLocaleString('pt-BR')}
              </p>
            )}
          </div>
          <div className="p-4 rounded-lg bg-surface-container-low border border-outline-variant">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">Recursos</p>
            {metrics?.available ? (
              <p className="text-sm text-on-surface font-mono">
                CPU {metrics.cpuPercent}% · RAM {formatBytes(metrics.memoryUsedBytes)}
                {metrics.memoryLimitBytes ? ` / ${formatBytes(metrics.memoryLimitBytes)}` : ''}
              </p>
            ) : (
              <p className="text-sm text-on-surface-variant/70">Indisponível (contêiner parado)</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
