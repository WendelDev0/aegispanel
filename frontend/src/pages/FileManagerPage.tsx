import React, { useState, useEffect } from 'react';
import {
  FolderTree,
  Folder,
  FileCode,
  FileText,
  File,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  ChevronRight,
  ArrowLeft,
  X,
  Check,
  Code
} from 'lucide-react';
import { api } from '../services/api.js';
import { FileItem } from '../types/index.js';

export const FileManagerPage: React.FC = () => {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [savingFile, setSavingFile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Modal states
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFileName, setNewFileName] = useState('');

  const fetchFiles = async (relPath: string = currentPath) => {
    try {
      setLoading(true);
      const res = await api.get(`/files/list?path=${encodeURIComponent(relPath)}`);
      setFiles(res.data);
      setCurrentPath(relPath);
    } catch (err: any) {
      alert('Erro ao listar arquivos: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles('');
  }, []);

  const handleOpenItem = async (item: FileItem) => {
    if (item.isDirectory) {
      setSelectedFile(null);
      fetchFiles(item.path);
    } else {
      // Read file
      try {
        setLoading(true);
        const res = await api.get(`/files/read?path=${encodeURIComponent(item.path)}`);
        setFileContent(res.data.content);
        setSelectedFile(item);
      } catch (err: any) {
        alert('Erro ao abrir arquivo: ' + (err.response?.data?.error || err.message));
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    try {
      setSavingFile(true);
      await api.post('/files/write', {
        path: selectedFile.path,
        content: fileContent,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      alert('Erro ao salvar arquivo: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingFile(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName) return;
    const fullPath = currentPath ? `${currentPath}/${newFolderName}` : newFolderName;
    try {
      await api.post('/files/create-folder', { path: fullPath });
      setShowNewFolderModal(false);
      setNewFolderName('');
      fetchFiles(currentPath);
    } catch (err: any) {
      alert('Erro ao criar pasta: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName) return;
    const fullPath = currentPath ? `${currentPath}/${newFileName}` : newFileName;
    try {
      await api.post('/files/write', { path: fullPath, content: '' });
      setShowNewFileModal(false);
      setNewFileName('');
      fetchFiles(currentPath);
    } catch (err: any) {
      alert('Erro ao criar arquivo: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteItem = async (item: FileItem) => {
    if (!confirm(`Tem certeza que deseja deletar "${item.name}"?`)) return;
    try {
      await api.delete(`/files/delete?path=${encodeURIComponent(item.path)}`);
      if (selectedFile?.path === item.path) {
        setSelectedFile(null);
      }
      fetchFiles(currentPath);
    } catch (err: any) {
      alert('Erro ao deletar: ' + (err.response?.data?.error || err.message));
    }
  };

  const navigateUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    fetchFiles(parts.join('/'));
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4 flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0f172a]/90 p-4 rounded-2xl border border-slate-800 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-indigo-400" />
            Gerenciador de Arquivos & Editor de Código
          </h2>
          <p className="text-xs text-slate-400">
            Navegue pelas pastas da VPS, edite arquivos de configuração (.env, json) com proteção total.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewFileModal(true)}
            title="Criar um novo arquivo neste diretório"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-indigo-400" />
            Novo Arquivo
          </button>

          <button
            onClick={() => setShowNewFolderModal(true)}
            title="Criar uma nova pasta neste diretório"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            Nova Pasta
          </button>

          <button
            onClick={() => fetchFiles(currentPath)}
            title="Recarregar lista de arquivos"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main split view: File list on left, editor on right */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        {/* Left Column: Explorer */}
        <div className="lg:col-span-5 bg-[#0f172a]/80 rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          {/* Breadcrumb path bar */}
          <div className="p-3 bg-slate-900/80 border-b border-slate-800 flex items-center gap-2 text-xs font-mono">
            {currentPath && (
              <button
                onClick={navigateUp}
                title="Voltar para a pasta anterior"
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
            <span className="text-slate-500">/data/{currentPath}</span>
          </div>

          {/* Files List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
            {files.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                Nenhum arquivo ou pasta encontrado neste diretório.
              </div>
            ) : (
              files.map((file) => (
                <div
                  key={file.path}
                  className={`flex items-center justify-between px-3.5 py-2.5 hover:bg-slate-800/40 transition-colors cursor-pointer group ${
                    selectedFile?.path === file.path ? 'bg-indigo-600/15 border-l-2 border-indigo-500' : ''
                  }`}
                  onClick={() => handleOpenItem(file)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {file.isDirectory ? (
                      <Folder className="w-4 h-4 text-indigo-400 shrink-0" />
                    ) : file.extension === 'env' || file.name.startsWith('.env') ? (
                      <Code className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span className={`text-xs truncate ${file.isDirectory ? 'font-semibold text-slate-200' : 'text-slate-300 font-mono'}`}>
                      {file.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {!file.isDirectory && (
                      <span className="text-[10px] font-mono text-slate-500">{formatBytes(file.sizeBytes)}</span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(file);
                      }}
                      title="Deletar este item"
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Code Editor */}
        <div className="lg:col-span-7 bg-[#090d16] rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          {selectedFile ? (
            <>
              {/* Editor toolbar */}
              <div className="p-3 bg-[#0d1322] border-b border-slate-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-indigo-400" />
                  <span className="font-mono text-xs font-bold text-white">{selectedFile.name}</span>
                  <span className="text-[10px] text-slate-500 font-mono">({formatBytes(selectedFile.sizeBytes)})</span>
                </div>

                <div className="flex items-center gap-2">
                  {saveSuccess && (
                    <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Salvo!
                    </span>
                  )}

                  <button
                    onClick={handleSaveFile}
                    disabled={savingFile}
                    title="Salvar alterações no arquivo (Ctrl+S)"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {savingFile ? 'Salvando...' : 'Salvar Arquivo'}
                  </button>
                </div>
              </div>

              {/* Textarea Code Editor */}
              <textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                placeholder="Conteúdo do arquivo..."
                className="flex-1 w-full bg-transparent p-4 font-mono text-xs text-slate-200 leading-relaxed resize-none focus:outline-none selection:bg-indigo-500/30"
                spellCheck={false}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs p-8 text-center">
              <FileCode className="w-10 h-10 text-slate-600 mb-3" />
              <h4 className="font-bold text-slate-300 text-sm mb-1">Nenhum arquivo selecionado</h4>
              <p className="max-w-xs text-slate-500">
                Clique em qualquer arquivo da lista à esquerda para visualizá-lo e editá-lo diretamente aqui.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Nova Pasta */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-sm overflow-hidden shadow-2xl p-5">
            <h3 className="font-bold text-white text-base mb-3">Criar Nova Pasta</h3>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                required
                placeholder="nome-da-pasta"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-3.5 py-2 text-slate-400 hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
                >
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Novo Arquivo */}
      {showNewFileModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-sm overflow-hidden shadow-2xl p-5">
            <h3 className="font-bold text-white text-base mb-3">Criar Novo Arquivo</h3>
            <form onSubmit={handleCreateFile} className="space-y-4">
              <input
                type="text"
                required
                placeholder="ex: .env.production ou config.json"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewFileModal(false)}
                  className="px-3.5 py-2 text-slate-400 hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
                >
                  Criar Arquivo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
