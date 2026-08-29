import React, { useState, useEffect } from 'react';
import {
  HardDriveDownload,
  Plus,
  Trash2,
  Download,
  RotateCcw,
  RefreshCw,
  Database,
  CheckCircle,
  FileText,
  Clock,
  X,
  AlertTriangle
} from 'lucide-react';
import { api } from '../services/api.js';
import { BackupRecord, DatabaseRecord } from '../types/index.js';

export const BackupsPage: React.FC = () => {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [databases, setDatabases] = useState<DatabaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedDbId, setSelectedDbId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const fetchBackupsAndDbs = async () => {
    try {
      setLoading(true);
      const [resBackups, resDbs] = await Promise.all([
        api.get('/backups'),
        api.get('/databases'),
      ]);
      setBackups(resBackups.data);
      setDatabases(resDbs.data);
      if (resDbs.data.length > 0) {
        setSelectedDbId(resDbs.data[0].id);
      }
    } catch (err) {
      console.error('Failed to load backups:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackupsAndDbs();
  }, []);

  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDbId) return;

    try {
      setSubmitting(true);
      await api.post(`/backups/database/${selectedDbId}`);
      setShowCreateModal(false);
      fetchBackupsAndDbs();
    } catch (err: any) {
      alert('Erro ao gerar backup: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestoreBackup = async (backup: BackupRecord) => {
    if (!confirm(`⚠️ ATENÇÃO: Deseja restaurar o banco de dados "${backup.targetName}" com o backup "${backup.filename}"?\n\nOs dados atuais serão sobrescritos com este dump.`)) {
      return;
    }

    try {
      setRestoringId(backup.id);
      await api.post(`/backups/${backup.id}/restore`);
      alert(`Banco de dados "${backup.targetName}" restaurado com sucesso!`);
    } catch (err: any) {
      alert('Erro na restauração: ' + (err.response?.data?.error || err.message));
    } finally {
      setRestoringId(null);
    }
  };

  const handleDeleteBackup = async (id: string, filename: string) => {
    if (!confirm(`Tem certeza que deseja deletar o arquivo de backup "${filename}"?`)) return;
    try {
      await api.delete(`/backups/${id}`);
      fetchBackupsAndDbs();
    } catch (err: any) {
      alert('Erro ao deletar backup: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDownload = (filename: string) => {
    window.open(`/api/backups/download/${filename}`, '_blank');
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <HardDriveDownload className="w-6 h-6 text-emerald-400" />
            Backups & Restauração 1-Clique
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Gere dumps SQL completos dos seus bancos de dados e restaure instâncias em segundos sem perda de dados.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          title="Fazer backup imediato de um banco de dados"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-600/30 transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Fazer Backup Agora
        </button>
      </div>

      {/* Backups List */}
      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
        </div>
      ) : backups.length === 0 ? (
        <div className="bg-[#0f172a]/60 rounded-2xl p-12 border border-slate-800 text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-4">
            <HardDriveDownload className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Nenhum backup gerado ainda</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            Mantenha seus dados seguros gerando cópias de segurança periódicas dos seus bancos de dados.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm inline-flex items-center gap-2 shadow-lg shadow-emerald-600/30"
          >
            <Plus className="w-4 h-4" />
            Criar Primeiro Backup
          </button>
        </div>
      ) : (
        <div className="bg-[#0f172a]/80 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/90 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4 font-sans">Alvo / Database</th>
                  <th className="py-3.5 px-4">Arquivo Dump</th>
                  <th className="py-3.5 px-4">Tamanho</th>
                  <th className="py-3.5 px-4 font-sans">Data de Criação</th>
                  <th className="py-3.5 px-4 text-right font-sans">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {backups.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 px-4 font-sans font-bold text-slate-200 flex items-center gap-2">
                      <Database className="w-4 h-4 text-emerald-400" />
                      {b.targetName}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300 truncate max-w-xs">{b.filename}</td>
                    <td className="py-3.5 px-4 text-slate-400">{formatBytes(b.sizeBytes)}</td>
                    <td className="py-3.5 px-4 font-sans text-slate-400">
                      {new Date(b.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td className="py-3.5 px-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRestoreBackup(b)}
                          disabled={restoringId === b.id}
                          title="Restaurar este backup no banco de dados ativo"
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 text-xs font-semibold transition-colors"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${restoringId === b.id ? 'animate-spin' : ''}`} />
                          <span>{restoringId === b.id ? 'Restaurando...' : 'Restaurar'}</span>
                        </button>

                        <button
                          onClick={() => handleDownload(b.filename)}
                          title="Baixar arquivo de backup para seu computador"
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 text-xs font-medium transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </button>

                        <button
                          onClick={() => handleDeleteBackup(b.id, b.filename)}
                          title="Deletar este arquivo de backup"
                          className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* Modal: Novo Backup */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <HardDriveDownload className="w-5 h-5 text-emerald-400" />
                Gerar Backup de Banco de Dados
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateBackup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Selecione o Banco de Dados *
                </label>
                <select
                  value={selectedDbId}
                  onChange={(e) => setSelectedDbId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 font-mono"
                >
                  {databases.length === 0 ? (
                    <option value="">Nenhum banco de dados cadastrado</option>
                  ) : (
                    databases.map((db) => (
                      <option key={db.id} value={db.id}>
                        {db.name} ({db.type.toUpperCase()}) - Porta :{db.port}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selectedDbId}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-50"
                >
                  {submitting ? 'Gerando Dump...' : 'Iniciar Backup'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
