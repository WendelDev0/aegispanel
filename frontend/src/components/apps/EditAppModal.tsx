import React, { useEffect, useState } from 'react';
import { ChevronDown, Lock, Settings2, X } from 'lucide-react';
import { api } from '../../services/api.js';
import type { AppRecord, ServerNode } from '../../types/index.js';

const LOCAL_NODE_ID = 'node-local';

interface EditAppModalProps {
  app: AppRecord;
  onClose: () => void;
  onSaved: (app: AppRecord) => void;
}

export const EditAppModal: React.FC<EditAppModalProps> = ({ app, onClose, onSaved }) => {
  const [editName, setEditName] = useState(app.name);
  const [editPort, setEditPort] = useState(app.port.toString());
  const [editInternalPort, setEditInternalPort] = useState(app.internalPort.toString());
  const copiedHostAsInternal = app.internalPort === app.port;
  const [showInternalPort, setShowInternalPort] = useState(
    app.sourceType === 'image' || copiedHostAsInternal,
  );
  const [editImageName, setEditImageName] = useState(app.imageName || '');
  const [editGitUrl, setEditGitUrl] = useState(app.gitUrl || '');
  const [editBranch, setEditBranch] = useState(app.branch || 'main');
  // Write-only: the stored token is never sent to the browser, so the field
  // starts empty and only overwrites the stored value when filled in.
  const [editGithubToken, setEditGithubToken] = useState('');
  const [showTokenEdit, setShowTokenEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [nodeId, setNodeId] = useState(app.nodeId || LOCAL_NODE_ID);
  const [nodes, setNodes] = useState<ServerNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/nodes');
        if (cancelled) return;
        const list: ServerNode[] = Array.isArray(res.data) ? res.data : [];
        setNodes(list);
      } catch (err) {
        console.error('Failed to fetch nodes:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setSavingEdit(true);
      // An empty field is sent as '' so the server hands the app back to
      // automatic assignment, rather than being dropped as "unchanged".
      const res = await api.put(`/apps/${app.id}`, {
        name: editName,
        port: editPort === '' ? '' : parseInt(editPort),
        internalPort: parseInt(editInternalPort || '3000'),
        imageName: editImageName || undefined,
        gitUrl: editGitUrl || undefined,
        branch: editBranch || undefined,
        githubToken: editGithubToken || undefined,
        nodeId,
      });

      onSaved(res.data);
      alert(`🎉 Aplicação atualizada. Porta no host: :${res.data?.port ?? editPort}`);
    } catch (err: any) {
      alert('Erro ao atualizar: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-lg overflow-hidden p-6 space-y-4 max-h-[85vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-white text-base">Configurações: {app.name}</h3>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
              Nome da Aplicação *
            </label>
            <input
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
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
                <option value={nodeId}>{app.nodeId ? app.nodeId : 'Este Servidor'}</option>
              ) : (
                nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label htmlFor="edit-host-port" className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
              Porta
            </label>
            <input
              id="edit-host-port"
              type="number"
              placeholder="Automática"
              value={editPort}
              onChange={(e) => setEditPort(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded px-3.5 py-2.5 text-on-surface font-mono text-sm focus:outline-none focus:border-primary"
            />
            <p className="text-[10px] text-on-surface-variant/70 mt-1">
              Vazio = o painel escolhe uma porta livre. O site entra pelo domínio, não por este número.
            </p>
          </div>

          {copiedHostAsInternal && (
            <p className="text-[11px] text-warn">
              A porta interna estava igual à do host (:{app.port}). Vite, Next e Node costumam escutar em 3000 — não copie a porta do host.
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowInternalPort((open) => !open)}
            className="text-[11px] text-on-surface-variant hover:text-white flex items-center gap-1"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showInternalPort ? 'rotate-180' : ''}`} />
            {showInternalPort ? 'Ocultar porta do app' : 'O app escuta numa porta diferente?'}
          </button>

          {showInternalPort && (
            <div>
              <label htmlFor="edit-listen-port" className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Porta que o app escuta
              </label>
              <input
                id="edit-listen-port"
                type="number"
                value={editInternalPort}
                onChange={(e) => setEditInternalPort(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-primary"
              />
              <p className="text-[10px] text-on-surface-variant/70 mt-1">
                Só mude se o projeto não usar 3000 (nginx = 80, Flask = 5000). O painel detecta isso no deploy Git.
              </p>
            </div>
          )}

          {app.sourceType === 'git' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  URL do Repositório GitHub
                </label>
                <input
                  type="text"
                  required
                  value={editGitUrl}
                  onChange={(e) => setEditGitUrl(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-warn uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> GitHub Token (PAT para Repositórios Privados)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTokenEdit(!showTokenEdit)}
                    className="text-[10px] text-on-surface-variant hover:text-white"
                  >
                    {showTokenEdit ? 'Ocultar' : 'Mostrar'}
                  </button>
                </label>
                <input
                  type={showTokenEdit ? 'text' : 'password'}
                  placeholder="ghp_seu_token_aqui (necessário para repos privados)"
                  value={editGithubToken}
                  onChange={(e) => setEditGithubToken(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-warn/30 rounded px-3.5 py-2.5 text-warn font-mono text-xs focus:outline-none focus:border-amber-500"
                />
                <p className="text-[10px] text-on-surface-variant/70 mt-1">
                  💡 Para repositórios privados, crie um token em GitHub &rarr; Settings &rarr; Developer Settings &rarr; Personal Access Tokens (classic) com permissão <code>repo</code>.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Branch de Deploy
                </label>
                <input
                  type="text"
                  required
                  value={editBranch}
                  onChange={(e) => setEditBranch(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-primary"
                />
              </div>
            </>
          )}

          {app.sourceType === 'image' && (
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Imagem Docker *
              </label>
              <input
                type="text"
                required
                value={editImageName}
                onChange={(e) => setEditImageName(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-primary"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingEdit}
              className="px-5 py-2.5 bg-ok/90 hover:bg-ok text-white rounded text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              {savingEdit ? 'Salvando & Aplicando...' : 'Salvar & Fazer Deploy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
