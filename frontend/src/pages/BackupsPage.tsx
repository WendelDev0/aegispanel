import React, { useState, useEffect } from 'react';
import {
  HardDriveDownload,
  Plus,
  Trash2,
  Download,
  RotateCcw,
  RefreshCw,
  Database,
  FileText,
  X,
  AlertTriangle,
  Cloud,
  ShieldCheck,
} from 'lucide-react';
import { api, downloadAuthenticated } from '../services/api.js';
import { BackupRecord, BackupTargetPublic, DatabaseRecord, RemoteBackupObject } from '../types/index.js';

const SECRET_MASK = '••••••••';

export const BackupsPage: React.FC = () => {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [databases, setDatabases] = useState<DatabaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedDbId, setSelectedDbId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [target, setTarget] = useState<BackupTargetPublic | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('auto');
  const [bucket, setBucket] = useState('');
  const [prefix, setPrefix] = useState('aegis');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);
  const [testingTarget, setTestingTarget] = useState(false);
  const [runningDrill, setRunningDrill] = useState(false);

  const [remoteObjects, setRemoteObjects] = useState<RemoteBackupObject[]>([]);
  const [remoteTotal, setRemoteTotal] = useState(0);
  const [remoteError, setRemoteError] = useState('');
  const [restoringKey, setRestoringKey] = useState<string | null>(null);

  const fetchBackupsAndDbs = async () => {
    try {
      setLoading(true);
      const [resBackups, resDbs, resTarget] = await Promise.all([
        api.get('/backups'),
        api.get('/databases'),
        api.get('/backups/target').catch(() => ({ data: null })),
      ]);
      setBackups(resBackups.data);
      setDatabases(resDbs.data);
      if (resDbs.data.length > 0) {
        setSelectedDbId(resDbs.data[0].id);
      }
      const t = resTarget.data as BackupTargetPublic | null;
      setTarget(t);
      if (t) {
        setEndpoint(t.endpoint || '');
        setRegion(t.region || 'auto');
        setBucket(t.bucket || '');
        setPrefix(t.prefix || 'aegis');
        setAccessKeyId(t.accessKeyId || '');
        setSecretAccessKey(t.hasSecret ? SECRET_MASK : '');
      }
    } catch (err) {
      console.error('Failed to load backups:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRemote = async () => {
    try {
      setRemoteError('');
      const res = await api.get('/backups/remote');
      setRemoteObjects(res.data.objects || []);
      setRemoteTotal(res.data.totalBytes || 0);
    } catch (err: any) {
      setRemoteObjects([]);
      setRemoteTotal(0);
      setRemoteError(err.response?.data?.error || err.message);
    }
  };

  useEffect(() => {
    fetchBackupsAndDbs();
  }, []);

  useEffect(() => {
    if (target?.bucket) fetchRemote();
  }, [target?.bucket, target?.lastUploadAt]);

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
    const panel = backup.targetType === 'full';
    if (
      !confirm(
        panel
          ? `⚠️ ATENÇÃO: restaurar o estado do painel a partir de "${backup.filename}" substitui usuários, apps e bancos cadastrados.`
          : `⚠️ ATENÇÃO: Deseja restaurar o banco "${backup.targetName}" com "${backup.filename}"?\n\nOs dados atuais serão sobrescritos.`
      )
    ) {
      return;
    }

    try {
      setRestoringId(backup.id);
      await api.post(`/backups/${backup.id}/restore`);
      alert(panel ? 'Estado do painel restaurado.' : `Banco "${backup.targetName}" restaurado com sucesso!`);
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

  const handleDownload = async (filename: string) => {
    try {
      await downloadAuthenticated(`/backups/download/${encodeURIComponent(filename)}`, filename);
    } catch (err: any) {
      alert('Erro ao baixar backup: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingTarget(true);
      const res = await api.put('/backups/target', {
        provider: 's3',
        endpoint: endpoint.trim(),
        region: region.trim() || 'auto',
        bucket: bucket.trim(),
        prefix: prefix.trim(),
        accessKeyId: accessKeyId.trim(),
        secretAccessKey,
      });
      setTarget(res.data);
      setSecretAccessKey(res.data?.hasSecret ? SECRET_MASK : '');
      alert('Destino offsite salvo.');
      fetchRemote();
    } catch (err: any) {
      alert('Erro ao salvar destino: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingTarget(false);
    }
  };

  const handleTestTarget = async () => {
    try {
      setTestingTarget(true);
      const res = await api.post('/backups/target/test');
      alert(`Conexão OK (${res.data.latencyMs} ms).`);
    } catch (err: any) {
      alert('Teste falhou: ' + (err.response?.data?.error || err.message));
    } finally {
      setTestingTarget(false);
    }
  };

  const handleRemoteRestore = async (obj: RemoteBackupObject) => {
    if (!confirm(`Restaurar o objeto remoto "${obj.key}"? Isso sobrescreve dados no painel ou no banco correspondente.`)) {
      return;
    }
    try {
      setRestoringKey(obj.key);
      await api.post('/backups/remote/restore', { key: obj.key });
      alert('Restore remoto concluído.');
      fetchBackupsAndDbs();
    } catch (err: any) {
      alert('Erro no restore remoto: ' + (err.response?.data?.error || err.message));
    } finally {
      setRestoringKey(null);
    }
  };

  const handleDrill = async () => {
    if (!confirm('Rodar o ensaio de restore agora? O dump mais recente de cada banco sobe num container temporário; o estado atual não é sobrescrito.')) {
      return;
    }
    try {
      setRunningDrill(true);
      const res = await api.post('/backups/drill');
      alert((res.data.ok ? 'Ensaio OK\n\n' : 'Ensaio com falhas\n\n') + (res.data.summary || ''));
      fetchBackupsAndDbs();
    } catch (err: any) {
      alert('Erro no ensaio: ' + (err.response?.data?.error || err.message));
    } finally {
      setRunningDrill(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / k ** i).toFixed(1)) + ' ' + sizes[i];
  };

  const statusLabel = (b: BackupRecord) => {
    if (b.status === 'completed_local_only') return { text: 'Só neste disco', className: 'text-warn' };
    if (b.status === 'failed') return { text: 'Falhou', className: 'text-crit' };
    if (b.status === 'completed' && b.offsiteKey) return { text: 'Offsite', className: 'text-ok' };
    if (b.status === 'completed') return { text: 'Local', className: 'text-on-surface-variant' };
    return { text: b.status, className: 'text-on-surface-variant' };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <HardDriveDownload className="w-6 h-6 text-ok" />
            Backups & Restauração 1-Clique
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">
            Dumps locais, cópia cifrada no bucket S3-compatível e ensaio mensal de restore.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDrill}
            disabled={runningDrill}
            className="flex items-center gap-2 px-4 py-2.5 rounded bg-primary-container/20 hover:bg-primary-container/30 text-primary font-semibold text-sm border border-primary/30 disabled:opacity-50"
          >
            <ShieldCheck className={`w-4 h-4 ${runningDrill ? 'animate-spin' : ''}`} />
            {runningDrill ? 'Ensaiando...' : 'Ensaio de restore'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            title="Fazer backup imediato de um banco de dados"
            className="flex items-center gap-2 px-4 py-2.5 rounded bg-ok/90 hover:bg-ok text-white font-semibold text-sm transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Fazer Backup Agora
          </button>
        </div>
      </div>

      <div className="bg-surface-container rounded-lg border border-outline-variant p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Cloud className="w-4 h-4 text-primary" />
              Destino offsite (S3 / R2 / B2 / MinIO)
            </h3>
            <p className="text-xs text-on-surface-variant mt-1">
              O dump é cifrado com ENCRYPTION_KEY antes de sair. O bucket nunca vê o SQL em claro.
            </p>
          </div>
          {target?.lastUploadAt && (
            <p className="text-xs font-mono text-on-surface-variant">
              Último upload: {new Date(target.lastUploadAt).toLocaleString('pt-BR')}
            </p>
          )}
        </div>
        {target?.lastError && (
          <p className="text-xs text-warn flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {target.lastError}
          </p>
        )}
        <form onSubmit={handleSaveTarget} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-on-surface-variant">
            Endpoint (vazio = AWS)
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://xxx.r2.cloudflarestorage.com"
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-sm font-mono"
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            Região
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-sm font-mono"
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            Bucket *
            <input
              required
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-sm font-mono"
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            Prefixo
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-sm font-mono"
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            Access Key ID *
            <input
              required
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-sm font-mono"
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            Secret Access Key
            <input
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              placeholder={target?.hasSecret ? 'deixe a máscara para manter' : 'obrigatória no primeiro save'}
              className="mt-1 w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-sm font-mono"
            />
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestTarget}
              disabled={testingTarget}
              className="px-4 py-2 rounded text-xs font-semibold border border-outline-variant text-on-surface hover:bg-surface-container-high disabled:opacity-50"
            >
              {testingTarget ? 'Testando...' : 'Testar conexão'}
            </button>
            <button
              type="submit"
              disabled={savingTarget}
              className="px-4 py-2 rounded text-xs font-semibold bg-primary-container hover:bg-primary text-white disabled:opacity-50"
            >
              {savingTarget ? 'Salvando...' : 'Salvar destino'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-surface-container rounded-lg border border-outline-variant overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">Objetos no bucket</h3>
            <p className="text-xs text-on-surface-variant">
              {remoteError
                ? remoteError
                : `Tamanho listado: ${formatBytes(remoteTotal)} · ${remoteObjects.length} objeto(s)`}
            </p>
          </div>
          <button
            type="button"
            onClick={fetchRemote}
            className="text-xs text-primary hover:underline font-semibold"
          >
            Atualizar
          </button>
        </div>
        {remoteObjects.length === 0 ? (
          <p className="p-4 text-xs text-on-surface-variant">Nenhum objeto listado. Configure o destino e gere um backup.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-surface-container-low/90 text-on-surface-variant font-semibold uppercase tracking-wider border-b border-outline-variant">
                <tr>
                  <th className="py-2.5 px-4 font-sans">Chave</th>
                  <th className="py-2.5 px-4">Tamanho</th>
                  <th className="py-2.5 px-4 font-sans">Modificado</th>
                  <th className="py-2.5 px-4 text-right font-sans">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60">
                {remoteObjects.map((obj) => (
                  <tr key={obj.key}>
                    <td className="py-2.5 px-4 text-on-surface-variant truncate max-w-lg">{obj.key}</td>
                    <td className="py-2.5 px-4">{formatBytes(obj.sizeBytes)}</td>
                    <td className="py-2.5 px-4 font-sans">{new Date(obj.lastModified).toLocaleString('pt-BR')}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        disabled={restoringKey === obj.key}
                        onClick={() => handleRemoteRestore(obj)}
                        className="px-3 py-1 rounded bg-emerald-600/20 text-ok border border-ok/30 text-xs font-semibold disabled:opacity-50"
                      >
                        {restoringKey === obj.key ? 'Restaurando...' : 'Restaurar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-on-surface-variant">
          <RefreshCw className="w-6 h-6 animate-spin text-ok" />
        </div>
      ) : backups.length === 0 ? (
        <div className="bg-surface-container rounded-lg p-12 border border-outline-variant text-center">
          <div className="w-12 h-12 rounded-lg bg-ok/10 text-ok flex items-center justify-center mx-auto mb-4">
            <HardDriveDownload className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Nenhum backup gerado ainda</h3>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto mb-6">
            Mantenha seus dados seguros gerando cópias de segurança periódicas dos seus bancos de dados.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-5 py-2.5 rounded bg-ok/90 hover:bg-ok text-white font-semibold text-sm inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Criar Primeiro Backup
          </button>
        </div>
      ) : (
        <div className="bg-surface-container rounded-lg border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-surface-container-low/90 text-on-surface-variant font-semibold uppercase tracking-wider border-b border-outline-variant">
                <tr>
                  <th className="py-3.5 px-4 font-sans">Alvo / Database</th>
                  <th className="py-3.5 px-4">Arquivo Dump</th>
                  <th className="py-3.5 px-4">Tamanho</th>
                  <th className="py-3.5 px-4 font-sans">Status</th>
                  <th className="py-3.5 px-4 font-sans">Ensaio</th>
                  <th className="py-3.5 px-4 font-sans">Data de Criação</th>
                  <th className="py-3.5 px-4 text-right font-sans">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60">
                {backups.map((b) => {
                  const st = statusLabel(b);
                  return (
                    <tr key={b.id} className="hover:bg-surface-container-high/30 transition-colors">
                      <td className="py-3.5 px-4 font-sans font-bold text-on-surface">
                        <span className="flex items-center gap-2">
                          {b.targetType === 'full' ? (
                            <FileText className="w-4 h-4 text-primary" />
                          ) : (
                            <Database className="w-4 h-4 text-ok" />
                          )}
                          {b.targetName}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-on-surface-variant truncate max-w-xs">{b.filename}</td>
                      <td className="py-3.5 px-4 text-on-surface-variant">{formatBytes(b.sizeBytes)}</td>
                      <td className={`py-3.5 px-4 font-sans font-semibold ${st.className}`}>{st.text}</td>
                      <td className="py-3.5 px-4 font-sans text-on-surface-variant">
                        {b.drill
                          ? `${b.drill.ok ? 'OK' : 'Falhou'} · ${new Date(b.drill.at).toLocaleDateString('pt-BR')}`
                          : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-sans text-on-surface-variant">
                        {new Date(b.createdAt).toLocaleString('pt-BR')}
                      </td>
                      <td className="py-3.5 px-4 text-right font-sans">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleRestoreBackup(b)}
                            disabled={restoringId === b.id || b.status === 'failed'}
                            title="Restaurar este backup"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600/20 text-ok hover:bg-emerald-600/30 border border-ok/30 text-xs font-semibold transition-colors disabled:opacity-50"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${restoringId === b.id ? 'animate-spin' : ''}`} />
                            <span>{restoringId === b.id ? 'Restaurando...' : 'Restaurar'}</span>
                          </button>

                          <button
                            onClick={() => handleDownload(b.filename)}
                            title="Baixar arquivo de backup para seu computador"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-container/20 text-primary hover:bg-primary-container/30 border border-primary/30 text-xs font-medium transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download</span>
                          </button>

                          <button
                            onClick={() => handleDeleteBackup(b.id, b.filename)}
                            title="Deletar este arquivo de backup"
                            className="p-1.5 rounded-lg text-crit hover:bg-crit/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container rounded-lg border border-outline-variant w-full max-w-md overflow-hidden p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <HardDriveDownload className="w-5 h-5 text-ok" />
                Gerar Backup de Banco de Dados
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-on-surface-variant hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateBackup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Selecione o Banco de Dados *
                </label>
                <select
                  value={selectedDbId}
                  onChange={(e) => setSelectedDbId(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-ok font-mono"
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
                  className="px-4 py-2 text-on-surface-variant hover:text-white text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selectedDbId}
                  className="px-5 py-2.5 bg-ok/90 hover:bg-ok text-white rounded text-xs font-semibold transition-all disabled:opacity-50"
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
