import React, { useEffect, useState } from 'react';
import {
  Server,
  Plus,
  Trash2,
  X,
  PlugZap,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Terminal,
  KeyRound,
} from 'lucide-react';
import { api } from '../services/api.js';
import { Badge, Tone } from '../components/ui.js';

interface NodeRecord {
  id: string;
  name: string;
  type: 'vps' | 'local' | 'cloud';
  hostIp: string;
  isLocal?: boolean;
  isCurrent: boolean;
  status: 'online' | 'offline' | 'unknown' | 'error';
  location?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  hasSshKey?: boolean;
  hasPassphrase?: boolean;
  lastCheckedAt?: string;
  lastError?: string;
  dockerVersion?: string;
  containerCount?: number;
}

interface CheckResult {
  reachable: boolean;
  message: string;
  checkedAt: string;
}

const STATUS: Record<NodeRecord['status'], { label: string; tone: Tone }> = {
  online: { label: 'Conectado', tone: 'ok' },
  error: { label: 'Falha', tone: 'crit' },
  offline: { label: 'Offline', tone: 'neutral' },
  unknown: { label: 'Não testado', tone: 'warn' },
};

export const NodesPage: React.FC = () => {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CheckResult>>({});

  const [name, setName] = useState('');
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUser, setSshUser] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [sshPassphrase, setSshPassphrase] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchNodes = async () => {
    try {
      const res = await api.get('/nodes');
      setNodes(res.data);
    } catch (err) {
      console.error('Falha ao carregar nós:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      const res = await api.post('/nodes', {
        name,
        sshHost,
        sshPort: parseInt(sshPort || '22', 10),
        sshUser,
        sshPrivateKey,
        sshPassphrase: sshPassphrase || undefined,
        location: location || undefined,
      });

      setShowAdd(false);
      setName('');
      setSshHost('');
      setSshUser('');
      setSshPrivateKey('');
      setSshPassphrase('');
      setLocation('');
      await fetchNodes();

      // Test immediately: a node that was just registered but never reached is
      // the state most likely to be misread as working.
      handleCheck(res.data.id);
    } catch (err: any) {
      alert('Erro ao registrar nó: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleCheck = async (id: string) => {
    setChecking(id);
    try {
      const res = await api.post(`/nodes/${id}/check`);
      setResults((prev) => ({ ...prev, [id]: res.data }));
      fetchNodes();
    } catch (err: any) {
      setResults((prev) => ({
        ...prev,
        [id]: {
          reachable: false,
          message: err.response?.data?.error || err.message,
          checkedAt: new Date().toISOString(),
        },
      }));
    } finally {
      setChecking(null);
    }
  };

  const handleDelete = async (node: NodeRecord) => {
    if (!confirm(`Remover o nó "${node.name}"? A chave SSH guardada para ele será apagada.`)) return;
    try {
      await api.delete(`/nodes/${node.id}`);
      fetchNodes();
    } catch (err: any) {
      alert('Erro ao remover: ' + (err.response?.data?.error || err.message));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-on-surface flex items-center gap-2.5 tracking-[-0.02em]">
            <Server className="w-6 h-6 text-primary" />
            Servidores
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">
            Registre outros servidores e verifique a conexão. O painel alcança o Docker remoto por SSH,
            sem expor nenhuma porta no nó.
          </p>
        </div>

        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded bg-primary-container hover:bg-primary text-white font-semibold text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          Registrar servidor
        </button>
      </div>

      {/* The panel is only as safe as the weakest node it holds a key for. */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-warn/30 bg-warn/10">
        <ShieldAlert className="w-5 h-5 text-warn shrink-0 mt-0.5" />
        <div>
          <h4 className="font-semibold text-warn text-sm">A chave SSH dá controle total do servidor</h4>
          <p className="text-xs text-on-surface-variant mt-1">
            Ela é guardada criptografada e nunca sai do servidor, mas quem tem acesso ao painel passa a
            ter acesso a todo nó registrado. Use uma chave dedicada por servidor — nunca a sua chave
            pessoal — e um usuário SSH exclusivo do painel.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {nodes.map((node) => {
          const status = STATUS[node.status] || STATUS.unknown;
          const result = results[node.id];

          return (
            <div
              key={node.id}
              className="relative bg-surface-container border border-outline-variant rounded-lg p-5 overflow-hidden"
            >
              <span
                className={`absolute inset-y-0 left-0 w-[3px] ${
                  node.status === 'online' ? 'bg-ok' : node.status === 'error' ? 'bg-crit' : 'bg-outline-variant'
                }`}
                aria-hidden
              />

              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-on-surface text-base tracking-[-0.01em] truncate">
                      {node.name}
                    </h3>
                    {node.isLocal && <Badge tone="info">local</Badge>}
                    <Badge tone={status.tone} dot>
                      {status.label}
                    </Badge>
                  </div>
                  <p className="font-mono text-2xs text-on-surface-variant/70 mt-1 truncate">
                    {node.isLocal
                      ? 'socket local · sem SSH'
                      : `${node.sshUser}@${node.sshHost}:${node.sshPort}`}
                  </p>
                </div>

                {!node.isLocal && (
                  <button
                    onClick={() => handleDelete(node)}
                    title="Remover servidor"
                    className="p-1.5 text-on-surface-variant/70 hover:text-crit rounded hover:bg-surface-container-high transition-colors shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-surface-container-lowest border border-outline-variant rounded p-2.5">
                  <span className="mono-label block mb-1">Docker</span>
                  <span className="font-mono text-sm text-on-surface">{node.dockerVersion || '—'}</span>
                </div>
                <div className="bg-surface-container-lowest border border-outline-variant rounded p-2.5">
                  <span className="mono-label block mb-1">Contêineres</span>
                  <span className="font-mono text-sm text-on-surface">
                    {node.containerCount ?? '—'}
                  </span>
                </div>
              </div>

              {(result || node.lastError) && (
                <div
                  className={`flex items-start gap-2 p-3 rounded border mb-4 ${
                    result?.reachable
                      ? 'border-ok/30 bg-ok/10'
                      : 'border-crit/30 bg-crit/10'
                  }`}
                >
                  {result?.reachable ? (
                    <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-crit shrink-0 mt-0.5" />
                  )}
                  <p className="text-xs text-on-surface-variant">{result?.message || node.lastError}</p>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-outline-variant">
                <span className="font-mono text-2xs text-on-surface-variant/70">
                  {node.lastCheckedAt
                    ? `testado ${new Date(node.lastCheckedAt).toLocaleString('pt-BR')}`
                    : 'nunca testado'}
                </span>

                <button
                  onClick={() => handleCheck(node.id)}
                  disabled={checking === node.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <PlugZap className={`w-3.5 h-3.5 ${checking === node.id ? 'animate-pulse' : ''}`} />
                  {checking === node.id ? 'Testando...' : 'Testar conexão'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-surface-container border border-outline-variant rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between p-5 border-b border-outline-variant sticky top-0 bg-surface-container">
              <h3 className="font-semibold text-on-surface flex items-center gap-2">
                <Server className="w-5 h-5 text-primary" />
                Registrar servidor
              </h3>
              <button
                onClick={() => setShowAdd(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdd} className="p-5 space-y-4">
              {/* Stated up front, because getting these wrong is the most
                  common reason the connection test fails. */}
              <div className="bg-surface-container-lowest border border-outline-variant rounded p-3 space-y-2">
                <span className="mono-label flex items-center gap-1.5">
                  <Terminal className="w-3 h-3" />
                  No servidor remoto, antes de continuar
                </span>
                <p className="text-xs text-on-surface-variant">
                  O usuário informado precisa ter Docker instalado e pertencer ao grupo{' '}
                  <code className="font-mono text-primary">docker</code>:
                </p>
                <pre className="font-mono text-2xs text-on-surface-variant bg-surface p-2 rounded border border-outline-variant overflow-x-auto">
{`sudo usermod -aG docker SEU_USUARIO
# e a chave pública correspondente em:
# ~/.ssh/authorized_keys`}
                </pre>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Nome *</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex: VPS Produção"
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">Host ou IP *</label>
                  <input
                    required
                    value={sshHost}
                    onChange={(e) => setSshHost(e.target.value)}
                    placeholder="203.0.113.10"
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface text-sm font-mono focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">Porta</label>
                  <input
                    type="number"
                    value={sshPort}
                    onChange={(e) => setSshPort(e.target.value)}
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface text-sm font-mono focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Usuário SSH *</label>
                <input
                  required
                  value={sshUser}
                  onChange={(e) => setSshUser(e.target.value)}
                  placeholder="aegis"
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface text-sm font-mono focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" />
                  Chave privada SSH *
                </label>
                <textarea
                  required
                  rows={5}
                  value={sshPrivateKey}
                  onChange={(e) => setSshPrivateKey(e.target.value)}
                  placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface text-2xs font-mono focus:outline-none focus:border-primary resize-y"
                />
                <p className="text-2xs text-on-surface-variant/70 mt-1">
                  Cole o arquivo inteiro, incluindo as linhas BEGIN e END. Guardada criptografada e nunca
                  exibida de volta.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  Passphrase da chave (se houver)
                </label>
                <input
                  type="password"
                  value={sshPassphrase}
                  onChange={(e) => setSshPassphrase(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface text-sm focus:outline-none focus:border-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 text-on-surface-variant hover:text-on-surface text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-primary-container hover:bg-primary text-white rounded text-xs font-semibold disabled:opacity-50"
                >
                  {saving ? 'Registrando...' : 'Registrar e testar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
