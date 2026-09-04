import React, { useEffect, useState } from 'react';
import {
  FolderTree,
  X,
  RefreshCw,
  Search,
  ChevronRight,
  ArrowLeft,
  Folder,
  File,
  Check,
  Copy,
  Save,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useToast } from '../Toast.js';
import type { AppRecord } from '../../types/index.js';

interface AppFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  extension?: string;
}

interface AppFilesModalProps {
  app: AppRecord;
  onClose: () => void;
}

export const AppFilesModal: React.FC<AppFilesModalProps> = ({ app, onClose }) => {
  const toast = useToast();
  const [currentSubPath, setCurrentSubPath] = useState('');
  const [appFiles, setAppFiles] = useState<AppFileItem[]>([]);
  const [selectedFileContent, setSelectedFileContent] = useState<{
    filename: string;
    path: string;
    content: string;
    sizeBytes: number;
  } | null>(null);
  const [fileContentDraft, setFileContentDraft] = useState('');
  const [savingFile, setSavingFile] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileFilterSearch, setFileFilterSearch] = useState('');
  const [copiedFileCode, setCopiedFileCode] = useState(false);

  const loadFiles = async (subPath = '') => {
    setCurrentSubPath(subPath);
    setSelectedFileContent(null);
    setFileFilterSearch('');
    try {
      setLoadingFiles(true);
      const res = await api.get(`/apps/${app.id}/files`, { params: { subPath } });
      setAppFiles(res.data.items || []);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao listar arquivos da aplicação');
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    loadFiles('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when modal opens for this app
  }, [app.id]);

  const handleOpenFileContent = async (filePath: string) => {
    try {
      setLoadingFiles(true);
      const res = await api.get(`/apps/${app.id}/files/content`, { params: { filePath } });
      setSelectedFileContent(res.data);
      setFileContentDraft(res.data.content);
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao ler arquivo');
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleSaveFileContent = async () => {
    if (!selectedFileContent) return;
    try {
      setSavingFile(true);
      await api.put(`/apps/${app.id}/files/content`, {
        filePath: selectedFileContent.path,
        content: fileContentDraft,
      });
      toast.success('✅ Arquivo salvo com sucesso!');
      setSelectedFileContent((prev) => (prev ? { ...prev, content: fileContentDraft } : null));
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao salvar arquivo');
    } finally {
      setSavingFile(false);
    }
  };

  const handleCopyFileCode = () => {
    if (!fileContentDraft) return;
    navigator.clipboard.writeText(fileContentDraft);
    setCopiedFileCode(true);
    setTimeout(() => setCopiedFileCode(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface rounded-lg border border-outline-variant w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col">
        <div className="p-4 bg-surface-container-low/90 border-b border-outline-variant flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-warn/10 text-warn">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <span>Arquivos da Aplicação: {app.name}</span>
                <span className="text-[10px] font-mono text-primary bg-primary/20 px-2 py-0.5 rounded border border-primary/30">
                  {app.branch || 'main'}
                </span>
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-on-surface-variant font-mono mt-0.5">
                <button onClick={() => loadFiles('')} className="hover:text-white underline">
                  raiz
                </button>
                {currentSubPath &&
                  currentSubPath.split('/').map((seg, idx, arr) => {
                    const sub = arr.slice(0, idx + 1).join('/');
                    return (
                      <React.Fragment key={sub}>
                        <ChevronRight className="w-3 h-3 text-outline" />
                        <button onClick={() => loadFiles(sub)} className="hover:text-white underline">
                          {seg}
                        </button>
                      </React.Fragment>
                    );
                  })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => loadFiles(currentSubPath)}
              title="Atualizar lista de arquivos"
              className="p-2 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingFiles ? 'animate-spin text-warn' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded text-on-surface-variant hover:text-white hover:bg-surface-container-high transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-72 bg-surface-container-lowest/90 border-r border-outline-variant flex flex-col">
            <div className="p-3 border-b border-outline-variant">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70" />
                <input
                  type="text"
                  placeholder="Buscar arquivo..."
                  value={fileFilterSearch}
                  onChange={(e) => setFileFilterSearch(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded pl-8 pr-3 py-1.5 text-xs text-on-surface focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
            </div>

            {currentSubPath && (
              <button
                onClick={() => {
                  const parent = currentSubPath.split('/').slice(0, -1).join('/');
                  loadFiles(parent);
                }}
                className="flex items-center gap-2 px-4 py-2.5 text-xs font-mono text-warn hover:bg-surface-container-low border-b border-outline-variant transition-colors text-left"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> .. (Voltar pasta)
              </button>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {loadingFiles && appFiles.length === 0 ? (
                <div className="p-6 text-center text-xs text-on-surface-variant/70">
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-warn" />
                  Carregando arquivos...
                </div>
              ) : appFiles.length === 0 ? (
                <div className="p-6 text-center text-xs text-on-surface-variant/70">
                  Nenhum arquivo encontrado após o deploy.
                </div>
              ) : (
                appFiles
                  .filter((f) => f.name.toLowerCase().includes(fileFilterSearch.toLowerCase()))
                  .map((f) => {
                    const isSelected = selectedFileContent?.path === f.path;
                    return (
                      <div
                        key={f.path}
                        onClick={() => {
                          if (f.isDirectory) {
                            loadFiles(f.path);
                          } else {
                            handleOpenFileContent(f.path);
                          }
                        }}
                        className={`flex items-center justify-between px-3 py-2 rounded text-xs font-mono cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-warn/15 text-warn border border-warn/30 font-bold'
                            : f.isDirectory
                            ? 'text-on-surface hover:bg-surface-container-low hover:text-white'
                            : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {f.isDirectory ? (
                            <Folder className="w-4 h-4 text-warn shrink-0" />
                          ) : (
                            <File className="w-4 h-4 text-primary shrink-0" />
                          )}
                          <span className="truncate">{f.name}</span>
                        </div>
                        {!f.isDirectory && f.sizeBytes > 0 && (
                          <span className="text-[10px] text-outline shrink-0 ml-1">
                            {(f.sizeBytes / 1024).toFixed(1)}k
                          </span>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          <div className="flex-1 bg-surface-container-lowest flex flex-col overflow-hidden">
            {selectedFileContent ? (
              <>
                <div className="p-3 bg-surface-container-lowest/80 border-b border-outline-variant flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-mono text-on-surface-variant truncate">
                    <File className="w-4 h-4 text-primary shrink-0" />
                    <span className="font-bold text-white">{selectedFileContent.path}</span>
                    <span className="text-[11px] text-on-surface-variant/70">
                      ({(selectedFileContent.sizeBytes / 1024).toFixed(2)} KB)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleCopyFileCode}
                      className="flex items-center gap-1 px-3 py-1.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-mono transition-colors"
                    >
                      {copiedFileCode ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedFileCode ? 'Copiado!' : 'Copiar'}</span>
                    </button>

                    <button
                      onClick={handleSaveFileContent}
                      disabled={savingFile}
                      className="flex items-center gap-1 px-4 py-1.5 rounded bg-warn hover:bg-amber-400 text-surface font-bold text-xs transition-all disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{savingFile ? 'Salvando...' : 'Salvar Alterações'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 p-4 overflow-auto">
                  <textarea
                    value={fileContentDraft}
                    onChange={(e) => setFileContentDraft(e.target.value)}
                    spellCheck={false}
                    className="w-full h-full bg-transparent text-ok font-mono text-xs leading-relaxed focus:outline-none resize-none selection:bg-primary-container/40 custom-scrollbar"
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-on-surface-variant/70">
                <FolderTree className="w-12 h-12 text-outline-variant mb-3" />
                <h4 className="font-bold text-white text-sm mb-1">Nenhum arquivo selecionado</h4>
                <p className="text-xs text-on-surface-variant max-w-sm">
                  Navegue pelas pastas à esquerda e clique em qualquer arquivo de código-fonte (HTML, JS, TS, JSON, .env) para visualizar e editar.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
