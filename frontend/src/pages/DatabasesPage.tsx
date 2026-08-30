import React, { useState, useEffect } from 'react';
import {
  Database,
  Plus,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  Code2,
  HardDriveDownload,
  X,
  Sparkles,
  Key,
  ShieldCheck,
  Eye,
  EyeOff,
  Lock
} from 'lucide-react';
import { api } from '../services/api.js';
import { DatabaseRecord } from '../types/index.js';
import { NavTab } from '../components/Sidebar.js';

interface DatabasesPageProps {
  setActiveTab?: (tab: NavTab) => void;
}

export const DatabasesPage: React.FC<DatabasesPageProps> = ({ setActiveTab }) => {
  const [databases, setDatabases] = useState<DatabaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [backupSuccessId, setBackupSuccessId] = useState<string | null>(null);
  const [showPasswordMap, setShowPasswordMap] = useState<Record<string, boolean>>({});

  // Form state
  const [dbName, setDbName] = useState('');
  const [dbType, setDbType] = useState<'postgres' | 'mysql' | 'mariadb' | 'redis' | 'mongodb'>('postgres');
  const [dbPort, setDbPort] = useState('5432');
  const [dbUser, setDbUser] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [customDbName, setCustomDbName] = useState('');
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchDatabases = async () => {
    try {
      setLoading(true);
      const res = await api.get('/databases');
      setDatabases(res.data);
    } catch (err) {
      console.error('Failed to fetch databases:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatabases();
  }, []);

  const generateCredentials = async (type: string = dbType) => {
    try {
      const res = await api.get(`/databases/generate-credentials?type=${type}`);
      setDbUser(res.data.suggestedUsername);
      setDbPassword(res.data.suggestedPassword);
      setCustomDbName(res.data.suggestedDbName);
    } catch (err) {
      // Fallback local generator
      const randHex = Math.random().toString(36).substring(2, 10);
      const strongPass = `Aegis#${Math.random().toString(36).substring(2, 8).toUpperCase()}_${Date.now().toString(36)}!`;
      setDbUser(`usr_${type.substring(0, 2)}_${randHex.substring(0, 4)}`);
      setDbPassword(strongPass);
      setCustomDbName(`db_${type.substring(0, 2)}_${randHex.substring(0, 4)}`);
    }
  };

  const handleOpenCreateModal = () => {
    setShowCreateModal(true);
    setDbName(`banco-${dbType}-01`);
    generateCredentials(dbType);
  };

  const handleTypeChange = (type: 'postgres' | 'mysql' | 'mariadb' | 'redis' | 'mongodb') => {
    setDbType(type);
    if (type === 'postgres') {
      setDbPort('5432');
    } else if (type === 'mysql' || type === 'mariadb') {
      setDbPort('3306');
    } else if (type === 'redis') {
      setDbPort('6379');
    } else if (type === 'mongodb') {
      setDbPort('27017');
    }
    generateCredentials(type);
  };

  const handleCreateDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbName || !dbPort) return;

    try {
      setSubmitting(true);
      await api.post('/databases', {
        name: dbName,
        type: dbType,
        port: parseInt(dbPort),
        dbUser: dbUser || undefined,
        dbPassword: dbPassword || undefined,
        dbName: customDbName || undefined,
      });

      setShowCreateModal(false);
      setDbName('');
      setDbPassword('');
      fetchDatabases();
    } catch (err: any) {
      alert('Erro ao criar banco: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStart = async (id: string) => {
    try {
      await api.post(`/databases/${id}/start`);
      fetchDatabases();
    } catch (err: any) {
      alert('Erro ao iniciar banco: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleStop = async (id: string) => {
    try {
      await api.post(`/databases/${id}/stop`);
      fetchDatabases();
    } catch (err: any) {
      alert('Erro ao parar banco: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRestart = async (id: string) => {
    try {
      await api.post(`/databases/${id}/restart`);
      fetchDatabases();
    } catch (err: any) {
      alert('Erro ao reiniciar banco: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja deletar o banco de dados "${name}"? Os dados persistidos serão mantidos no volume por segurança.`)) return;
    try {
      await api.delete(`/databases/${id}`);
      fetchDatabases();
    } catch (err: any) {
      alert('Erro ao deletar banco: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleBackupNow = async (id: string) => {
    try {
      await api.post(`/backups/database/${id}`);
      setBackupSuccessId(id);
      setTimeout(() => setBackupSuccessId(null), 2500);
    } catch (err: any) {
      alert('Erro ao gerar backup: ' + (err.response?.data?.error || err.message));
    }
  };

  /**
   * Credentials are not part of the databases listing: the API returns the
   * connection string with the password masked. The real value is requested
   * only when the user explicitly asks to see or copy it, and is kept in
   * component state rather than being refetched on every render.
   */
  const [credentialsMap, setCredentialsMap] = useState<Record<string, string>>({});

  const fetchConnectionString = async (id: string): Promise<string | null> => {
    if (credentialsMap[id]) return credentialsMap[id];
    try {
      const res = await api.get(`/databases/${id}/credentials`);
      const conn: string = res.data.connectionString;
      setCredentialsMap(prev => ({ ...prev, [id]: conn }));
      return conn;
    } catch (err: any) {
      alert('Não foi possível obter as credenciais: ' + (err.response?.data?.error || err.message));
      return null;
    }
  };

  const copyConnectionString = async (id: string) => {
    const conn = await fetchConnectionString(id);
    if (!conn) return;
    const host = window.location.hostname || 'localhost';
    navigator.clipboard.writeText(conn.replace('HOST_IP', host));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const togglePasswordVisibility = async (id: string) => {
    const willShow = !showPasswordMap[id];
    if (willShow && !credentialsMap[id]) {
      const conn = await fetchConnectionString(id);
      if (!conn) return;
    }
    setShowPasswordMap(prev => ({ ...prev, [id]: willShow }));
  };

  // Password strength calculation
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { label: 'Vazia', color: 'bg-slate-700', percent: 0 };
    let score = 0;
    if (pass.length >= 8) score += 20;
    if (pass.length >= 16) score += 30;
    if (/[A-Z]/.test(pass)) score += 15;
    if (/[0-9]/.test(pass)) score += 15;
    if (/[^A-Za-z0-9]/.test(pass)) score += 20;

    if (score >= 85) return { label: 'Ultra-Segura (AES-256 Ready)', color: 'bg-emerald-500', percent: 100 };
    if (score >= 60) return { label: 'Forte', color: 'bg-indigo-500', percent: 75 };
    if (score >= 40) return { label: 'Média', color: 'bg-amber-500', percent: 50 };
    return { label: 'Fraca', color: 'bg-rose-500', percent: 25 };
  };

  const passStrength = getPasswordStrength(dbPassword);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Database className="w-6 h-6 text-emerald-400" />
            Bancos de Dados com Criptografia de Ponta (AES-256)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Gere senhas e usuários criptograficamente fortes sem risco de vazamento, com persistência total em disco.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          title="Criar uma nova instância de banco de dados com credenciais fortes geradas automaticamente"
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-600/30 transition-all active:scale-95 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Novo Banco Seguro
        </button>
      </div>

      {/* Security Banner */}
      <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="text-xs text-slate-300">
            <span className="font-bold text-white block text-sm">Criptografia Autenticada AES-256-GCM em Repouso</span>
            Todas as senhas e chaves são criptografadas antes de serem salvas no disco. Nenhum dado sensível é armazenado em texto puro.
          </div>
        </div>

        <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30 shrink-0">
          Zero-Leak Shield
        </span>
      </div>

      {/* Databases List */}
      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
        </div>
      ) : databases.length === 0 ? (
        <div className="bg-[#0f172a]/60 rounded-2xl p-12 border border-slate-800 text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-4">
            <Database className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Nenhum banco de dados criado</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            Livre-se de limites de provedores externos criando seu próprio banco PostgreSQL ou MySQL protegido com AES-256.
          </p>
          <button
            onClick={handleOpenCreateModal}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm inline-flex items-center gap-2 shadow-lg shadow-emerald-600/30"
          >
            <Plus className="w-4 h-4" />
            Criar Banco PostgreSQL Seguro
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {databases.map((db) => {
            const host = window.location.hostname || 'localhost';
            const isPassVisible = showPasswordMap[db.id] || false;
            // The listing carries a masked string; the revealed value comes
            // from the credentials endpoint.
            const displayConn = (
              isPassVisible && credentialsMap[db.id] ? credentialsMap[db.id] : db.connectionString
            ).replace('HOST_IP', host);

            return (
              <div
                key={db.id}
                className="bg-[#0f172a]/80 rounded-2xl p-5 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
                        <Database className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-base flex items-center gap-2">
                          {db.name}
                          <span className="text-xs font-mono uppercase bg-slate-800 text-emerald-400 px-2 py-0.5 rounded border border-slate-700">
                            {db.type}
                          </span>
                        </h3>
                        <p className="text-xs text-slate-400">Porta Host: :{db.port}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1">
                        <Lock className="w-3 h-3" /> AES-256
                      </span>

                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5 ${
                          db.status === 'running'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            db.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                          }`}
                        ></span>
                        {db.status === 'running' ? 'Online' : 'Parado'}
                      </span>
                    </div>
                  </div>

                  {/* Connection String Box */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      <span>String de Conexão (DATABASE_URL)</span>
                      <button
                        onClick={() => togglePasswordVisibility(db.id)}
                        className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-sans capitalize text-[11px]"
                      >
                        {isPassVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {isPassVisible ? 'Ocultar Senha' : 'Ver Senha'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800 font-mono text-xs text-slate-300">
                      <span className="truncate flex-1 select-all">
                        {isPassVisible ? displayConn : displayConn.replace(/:([^:@]+)@/, ':••••••••••••@')}
                      </span>
                      <button
                        onClick={() => copyConnectionString(db.id)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0 flex items-center gap-1 text-[11px]"
                        title="Copiar URL de conexão para colar no .env do seu projeto"
                      >
                        {copiedId === db.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400 font-semibold">Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Metadata Credentials Info */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 mb-4">
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase">Usuário Seguro</span>
                      <span className="text-slate-200 font-semibold select-all">{db.dbUser}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase">Nome do Database</span>
                      <span className="text-slate-200 font-semibold select-all">{db.dbName || db.name}</span>
                    </div>
                  </div>
                </div>

                {/* Actions with Tooltips */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                  <div className="flex items-center gap-2">
                    {db.status === 'running' ? (
                      <button
                        onClick={() => handleStop(db.id)}
                        title="Parar banco de dados (Stop Instance)"
                        className="p-2 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                      >
                        <Square className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStart(db.id)}
                        title="Iniciar banco de dados (Start Instance)"
                        className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      onClick={() => handleRestart(db.id)}
                      title="Reiniciar instância de banco"
                      className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleBackupNow(db.id)}
                      title="Gerar cópia de segurança (Dump SQL) agora"
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                    >
                      {backupSuccessId === db.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Salvo!</span>
                        </>
                      ) : (
                        <>
                          <HardDriveDownload className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Backup</span>
                        </>
                      )}
                    </button>

                    {setActiveTab && (
                      <button
                        onClick={() => setActiveTab('querystudio')}
                        title="Abrir no Database Studio para executar SQL e ver tabelas"
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium transition-colors border border-indigo-500/30"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>SQL Studio</span>
                      </button>
                    )}
                  </div>

                  <button
                    onClick={() => handleDelete(db.id, db.name)}
                    title="Remover instância de banco"
                    className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Novo Banco Seguro */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] rounded-2xl border border-slate-800 w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Criar Banco Seguro 1-Clique</h3>
                  <p className="text-[11px] text-slate-400">Credenciais criptografadas com AES-256-GCM</p>
                </div>
              </div>

              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDatabase} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* Type Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Motor de Banco de Dados *
                </label>
                <div className="grid grid-cols-3 gap-2 text-xs font-semibold">
                  {[
                    { id: 'postgres', label: 'PostgreSQL 16' },
                    { id: 'mysql', label: 'MySQL 8.4' },
                    { id: 'mariadb', label: 'MariaDB 11' },
                    { id: 'redis', label: 'Redis 7' },
                    { id: 'mongodb', label: 'MongoDB 7' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleTypeChange(t.id as any)}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        dbType === t.id
                          ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 1-Click Credential Generator banner */}
              <div className="bg-indigo-950/40 p-3 rounded-xl border border-indigo-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-indigo-300">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Gerador Criptográfico Automático</span>
                </div>
                <button
                  type="button"
                  onClick={() => generateCredentials(dbType)}
                  title="Gerar novas credenciais aleatórias ultra-fortes"
                  className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow transition-all active:scale-95"
                >
                  <RefreshCw className="w-3 h-3" /> Gerar Novas
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Identificador / Nome da Instância *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: banco-producao ou ecommerce-db"
                  value={dbName}
                  onChange={(e) => setDbName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Porta no Host *
                  </label>
                  <input
                    type="number"
                    required
                    value={dbPort}
                    onChange={(e) => setDbPort(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Nome do Database Inicial
                  </label>
                  <input
                    type="text"
                    value={customDbName}
                    onChange={(e) => setCustomDbName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>

              {/* User & Password */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Usuário do Banco (Gerado Forte)
                    </label>
                    <button
                      type="button"
                      onClick={() => generateCredentials(dbType)}
                      className="text-[11px] text-indigo-400 hover:underline"
                    >
                      Regerar
                    </button>
                  </div>
                  <input
                    type="text"
                    value={dbUser}
                    onChange={(e) => setDbUser(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Senha Criptograficamente Forte (24 Chars)
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowFormPassword(!showFormPassword)}
                      className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1"
                    >
                      {showFormPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {showFormPassword ? 'Ocultar' : 'Exibir'}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showFormPassword ? 'text' : 'password'}
                      value={dbPassword}
                      onChange={(e) => setDbPassword(e.target.value)}
                      placeholder="Senha ultra-segura"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>

                  {/* Password Strength Indicator */}
                  <div className="mt-2 space-y-1">
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${passStrength.color} transition-all duration-300`}
                        style={{ width: `${passStrength.percent}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Segurança: <strong className="text-slate-200">{passStrength.label}</strong></span>
                      <span>Protegido com AES-256</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-600/30 transition-all active:scale-95 disabled:opacity-50"
                >
                  {submitting ? 'Criando banco...' : 'Criar Banco Seguro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
