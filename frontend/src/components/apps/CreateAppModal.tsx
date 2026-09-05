import React, { useEffect, useState } from 'react';
import {
  Plus,
  X,
  Lock,
  ShieldCheck,
  Globe,
  Cpu,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useToast } from '../Toast.js';
import { EnvEditor } from '../EnvEditor.js';
import type { AppRecord, ServerNode } from '../../types/index.js';

const LOCAL_NODE_ID = 'node-local';

interface CreateAppModalProps {
  onCreated: (app: AppRecord) => void;
  onCancel: () => void;
}

export const CreateAppModal: React.FC<CreateAppModalProps> = ({ onCreated, onCancel }) => {
  const toast = useToast();
  const [appName, setAppName] = useState('');
  const [sourceType, setSourceType] = useState<'image' | 'git' | 'dockerfile'>('git');
  const [imageName, setImageName] = useState('nginx:alpine');
  const [gitUrl, setGitUrl] = useState('https://github.com/usuario/meu-app.git');
  const [branch, setBranch] = useState('main');
  const [githubToken, setGithubToken] = useState('');
  const [showTokenCreate, setShowTokenCreate] = useState(false);
  const [port, setPort] = useState('');
  const [internalPort, setInternalPort] = useState('3000');
  const [createDomain, setCreateDomain] = useState('');
  const [createEnvString, setCreateEnvString] = useState('NODE_ENV=production\nPORT=3000');
  const [submitting, setSubmitting] = useState(false);
  const [nodeId, setNodeId] = useState(LOCAL_NODE_ID);
  const [nodes, setNodes] = useState<ServerNode[]>([]);

  const [inspectingRepo, setInspectingRepo] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<{
    inspection: {
      type: string;
      frameworkName: string;
      packageManager: string;
      hasDockerfile: boolean;
      buildCommand: string;
      outputDir: string;
      startCommand: string;
      recommendedPort: number;
      recommendedInternalPort: number;
    };
    commit?: {
      hash: string;
      message: string;
      author: string;
      date: string;
    };
    proposedBuildConfig?: { runtime: string; version?: string; source: string };
    proposedProcesses?: Array<{ name: string; type: string; command: string }>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/nodes');
        if (cancelled) return;
        const list: ServerNode[] = Array.isArray(res.data) ? res.data : [];
        setNodes(list);
        const local =
          list.find((n) => n.id === LOCAL_NODE_ID) ||
          list.find((n) => n.isLocal) ||
          list[0];
        if (local) setNodeId(local.id);
      } catch (err) {
        console.error('Failed to fetch nodes:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedNode = nodes.find((n) => n.id === nodeId);
  const selectedNodeIsRemote =
    !!selectedNode && !selectedNode.isLocal && selectedNode.id !== LOCAL_NODE_ID;
  const showRemoteOriginWarning =
    selectedNodeIsRemote && (sourceType === 'git' || sourceType === 'dockerfile');

  const handleInspectRepo = async (urlToInspect?: string) => {
    const targetUrl = urlToInspect || gitUrl;
    if (!targetUrl || targetUrl.includes('usuario/meu-app')) return;

    try {
      setInspectingRepo(true);
      setInspectionResult(null);
      const res = await api.post('/apps/inspect-repo', {
        gitUrl: targetUrl.trim(),
        branch: branch || 'main',
        githubToken: githubToken || undefined,
      });

      if (res.data?.success && res.data.inspection) {
        setInspectionResult(res.data);
        if (res.data.inspection.recommendedInternalPort) {
          setInternalPort(res.data.inspection.recommendedInternalPort.toString());
        }
        if (res.data.inspection.suggestedEnv && Object.keys(res.data.inspection.suggestedEnv).length > 0) {
          const envLines = Object.entries(res.data.inspection.suggestedEnv)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
          setCreateEnvString(envLines);
        }
        if (!appName || appName.includes('meu-app')) {
          const cleanName = targetUrl.split('/').pop()?.replace('.git', '') || '';
          if (cleanName) setAppName(cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '-'));
        }
      }
    } catch (err: any) {
      console.warn('Repo inspection notice:', err.message);
    } finally {
      setInspectingRepo(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Only the name is required. The port field is optional by design - left
    // blank, the server allocates a free one - and requiring it here made the
    // button do nothing at all for the case the field itself recommends.
    if (!appName) return;

    try {
      setSubmitting(true);
      const envObj: Record<string, string> = {};
      createEnvString.split('\n').forEach((line) => {
        const parts = line.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const val = parts.slice(1).join('=').trim();
          if (key) envObj[key] = val;
        }
      });

      const res = await api.post('/apps', {
        name: appName,
        sourceType,
        imageName: sourceType === 'image' ? imageName : undefined,
        gitUrl: sourceType === 'git' || sourceType === 'dockerfile' ? gitUrl : undefined,
        branch: sourceType === 'git' || sourceType === 'dockerfile' ? branch : undefined,
        githubToken:
          (sourceType === 'git' || sourceType === 'dockerfile') && githubToken
            ? githubToken
            : undefined,
        // Omitted when blank, so the server assigns a free host port.
        port: port ? parseInt(port) : undefined,
        internalPort: parseInt(internalPort),
        domain: createDomain.trim() || undefined,
        env: envObj,
        nodeId,
        buildConfig: inspectionResult?.proposedBuildConfig,
        processes: inspectionResult?.proposedProcesses,
      });

      onCreated(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao criar aplicação');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-lg overflow-hidden">
        <div className="p-5 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
          <h3 className="font-bold text-white text-lg flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary" />
            Novo Deploy de Aplicação
          </h3>
          <button
            onClick={onCancel}
            className="text-on-surface-variant hover:text-white p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
              Nome da Aplicação *
            </label>
            <input
              type="text"
              required
              placeholder="ex: minha-api-node ou frontend-react"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
              Nó de destino
            </label>
            <select
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
            >
              {nodes.length === 0 ? (
                <option value={LOCAL_NODE_ID}>Este Servidor</option>
              ) : (
                nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))
              )}
            </select>
            {showRemoteOriginWarning && (
              <p className="text-[11px] text-on-surface-variant mt-1.5">
                Clone no painel; o docker build e o start rodam no Docker do nó. O Caddy continua apontando para o IP do nó.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Origem do Projeto
              </label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as 'image' | 'git' | 'dockerfile')}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
              >
                <option value="git">GitHub / Repositório Git</option>
                <option value="image">Imagem Docker / Hub</option>
              </select>
            </div>

            <div>
              <label htmlFor="create-host-port" className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Porta
              </label>
              <input
                id="create-host-port"
                type="number"
                placeholder="Automática"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary font-mono"
              />
              <p className="text-[10px] text-on-surface-variant/70 mt-1">
                Deixe vazio: o painel escolhe. O site entra pelo domínio, não por esta porta.
              </p>
            </div>
          </div>

          {sourceType === 'git' || sourceType === 'dockerfile' ? (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    URL do Repositório GitHub *
                  </label>
                  <button
                    type="button"
                    onClick={() => handleInspectRepo()}
                    disabled={inspectingRepo || !gitUrl || gitUrl.includes('usuario/meu-app')}
                    className="text-[11px] text-primary hover:text-primary font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40"
                  >
                    <Cpu className={`w-3.5 h-3.5 ${inspectingRepo ? 'animate-spin' : ''}`} />
                    <span>{inspectingRepo ? 'Inspecionando...' : 'Auto-Detectar Stack'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  placeholder="https://github.com/usuario/meu-projeto.git"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  onBlur={() => handleInspectRepo()}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>

              {inspectingRepo ? (
                <div className="p-4 rounded-lg bg-primary/10 border border-primary/30 flex items-center gap-3 animate-pulse text-xs text-primary">
                  <RefreshCw className="w-4 h-4 animate-spin text-primary shrink-0" />
                  <span>Inspecionando arquivos do repositório e identificando framework...</span>
                </div>
              ) : inspectionResult ? (
                <div className="p-4 rounded-lg bg-surface-container-lowest border border-primary/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-warn" />
                      <span className="text-xs font-bold text-white uppercase tracking-wider">Framework Detectado</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-primary/20 border border-primary/40 text-primary text-[11px] font-bold font-mono">
                      {inspectionResult.inspection.frameworkName}
                    </span>
                  </div>

                  {inspectionResult.commit && (
                    <div className="p-2.5 rounded bg-surface-container-low border border-outline-variant text-[11px] font-mono text-on-surface-variant space-y-1">
                      <div className="text-on-surface-variant flex items-center justify-between">
                        <span>Último commit ({inspectionResult.commit.hash}):</span>
                        <span>{inspectionResult.commit.author}</span>
                      </div>
                      <div className="text-ok font-semibold truncate">"{inspectionResult.commit.message}"</div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-on-surface-variant">
                    <div className="p-2 rounded bg-surface-container-low border border-outline-variant">
                      <span className="text-on-surface-variant/70 block text-[10px] uppercase">Package Manager</span>
                      <span className="text-white font-bold">{inspectionResult.inspection.packageManager.toUpperCase()}</span>
                    </div>
                    <div className="p-2 rounded bg-surface-container-low border border-outline-variant">
                      <span className="text-on-surface-variant/70 block text-[10px] uppercase">Comando de Build</span>
                      <span className="text-white font-bold truncate">{inspectionResult.inspection.buildCommand || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-semibold text-warn uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> GitHub Token (Para Repositórios Privados)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTokenCreate(!showTokenCreate)}
                    className="text-[10px] text-on-surface-variant hover:text-white"
                  >
                    {showTokenCreate ? 'Ocultar' : 'Mostrar'}
                  </button>
                </label>
                <input
                  type={showTokenCreate ? 'text' : 'password'}
                  placeholder="ghp_seu_token_aqui (apenas se o repositório for PRIVADO)"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-warn/30 rounded px-3.5 py-2.5 text-warn font-mono text-xs focus:outline-none focus:border-amber-500"
                />
                <p className="text-[10px] text-on-surface-variant mt-1 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-warn shrink-0" />
                  <span>Para repositórios privados, informe seu Personal Access Token (PAT).</span>
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Branch de Deploy
                </label>
                <input
                  type="text"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Imagem Docker *
              </label>
              <input
                type="text"
                required
                placeholder="nginx:alpine ou node:20-alpine"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
              Domínio ou Subdomínio (Opcional)
            </label>
            <input
              type="text"
              placeholder="ex: app.meusite.com.br (pode deixar vazio e vincular depois)"
              value={createDomain}
              onChange={(e) => setCreateDomain(e.target.value)}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-primary font-mono"
            />
            <p className="text-[11px] text-on-surface-variant/70 mt-1 flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>O domínio é opcional. Você pode testar pelo IP:Porta e vincular o domínio Hostinger depois.</span>
            </p>
          </div>

          <div className="pt-2">
            <EnvEditor
              initialEnv={createEnvString}
              onChange={(_, str) => setCreateEnvString(str)}
              compact={true}
              title="Variáveis de Ambiente Iniciais (.env)"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded text-on-surface-variant hover:text-white text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded bg-primary-container hover:bg-primary text-white font-semibold text-sm transition-all disabled:opacity-50"
            >
              {submitting ? 'Criando pipeline...' : 'Iniciar Deploy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
