import React, { useState, useEffect } from 'react';
import {
  Code2,
  Play,
  Database,
  RefreshCw,
  Clock,
  Table,
  Terminal,
  Sparkles,
  HelpCircle
} from 'lucide-react';
import { api } from '../services/api.js';
import { DatabaseRecord } from '../types/index.js';

export const QueryStudioPage: React.FC = () => {
  const [databases, setDatabases] = useState<DatabaseRecord[]>([]);
  const [selectedDbId, setSelectedDbId] = useState<string>('');
  const [sqlQuery, setSqlQuery] = useState<string>('SELECT * FROM users LIMIT 10;');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    columns: string[];
    rows: any[];
    executionTimeMs: number;
    rowCount: number;
    rawOutput?: string;
  } | null>(null);

  useEffect(() => {
    api.get('/databases').then((res) => {
      setDatabases(res.data);
      if (res.data.length > 0) {
        setSelectedDbId(res.data[0].id);
      }
    }).catch(() => {});
  }, []);

  const handleExecuteQuery = async () => {
    if (!selectedDbId || !sqlQuery.trim()) return;

    try {
      setLoading(true);
      const res = await api.post('/query/execute', {
        databaseId: selectedDbId,
        sql: sqlQuery,
      });
      setResult(res.data);
    } catch (err: any) {
      alert('Erro ao executar query: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const selectedDb = databases.find(d => d.id === selectedDbId);

  const snippets = [
    { label: 'Listar Usuários', sql: 'SELECT * FROM users ORDER BY id DESC LIMIT 10;' },
    { label: 'Mostrar Tabelas', sql: 'SHOW TABLES;' },
    { label: 'Contar Registros', sql: 'SELECT COUNT(*) as total_records FROM users;' },
    { label: 'Ver Esquema', sql: 'SELECT table_name, column_name, data_type FROM information_schema.columns;' },
  ];

  return (
    <div className="space-y-4 flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0f172a]/90 p-4 rounded-2xl border border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
            <Code2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-white text-base flex items-center gap-2">
              Database Studio & SQL Console
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Supabase Studio Style
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Execute consultas SQL em tempo real nos seus bancos PostgreSQL e MySQL sem precisar de clientes externos.
            </p>
          </div>
        </div>

        {/* Database selector */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
            <Database className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-500 font-semibold text-[10px] uppercase">Banco:</span>
            <select
              value={selectedDbId}
              onChange={(e) => setSelectedDbId(e.target.value)}
              className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              {databases.length === 0 ? (
                <option value="">Nenhum banco criado</option>
              ) : (
                databases.map((db) => (
                  <option key={db.id} value={db.id} className="bg-slate-900 text-white">
                    {db.name} ({db.type.toUpperCase()})
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            onClick={handleExecuteQuery}
            disabled={loading || !selectedDbId}
            title="Executar comando SQL selecionado (Ctrl+Enter)"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all active:scale-95 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {loading ? 'Executando...' : 'Executar SQL'}
          </button>
        </div>
      </div>

      {/* Main workspace: SQL Editor on top, Result grid on bottom */}
      <div className="flex-1 grid grid-rows-2 gap-4 min-h-0">
        {/* Top: Query Editor */}
        <div className="bg-[#090d16] rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          {/* Snippets toolbar */}
          <div className="p-2.5 bg-[#0d1322] border-b border-slate-800 flex items-center justify-between overflow-x-auto gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-semibold uppercase text-slate-500">Snippets Rápidos:</span>
              {snippets.map((snip, idx) => (
                <button
                  key={idx}
                  onClick={() => setSqlQuery(snip.sql)}
                  title={`Inserir query: ${snip.sql}`}
                  className="px-2 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-[11px] transition-colors border border-slate-700/50"
                >
                  {snip.label}
                </button>
              ))}
            </div>

            {selectedDb && (
              <span className="text-[11px] font-mono text-slate-400 shrink-0">
                Host: localhost:{selectedDb.port} | User: {selectedDb.dbUser}
              </span>
            )}
          </div>

          <textarea
            value={sqlQuery}
            onChange={(e) => setSqlQuery(e.target.value)}
            placeholder="Digite seu comando SQL aqui... (ex: SELECT * FROM tabela;)"
            className="flex-1 w-full bg-transparent p-4 font-mono text-xs text-indigo-200 leading-relaxed resize-none focus:outline-none selection:bg-indigo-500/30"
            spellCheck={false}
          />
        </div>

        {/* Bottom: Results Grid */}
        <div className="bg-[#0f172a]/90 rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
          {/* Result bar */}
          <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Table className="w-4 h-4 text-indigo-400" /> Resultado da Consulta
              </span>
              {result && (
                <span className="text-slate-400 text-[11px]">
                  ({result.rowCount} linhas retornadas)
                </span>
              )}
            </div>

            {result && (
              <div className="flex items-center gap-1.5 text-emerald-400 text-[11px]">
                <Clock className="w-3.5 h-3.5" />
                <span>{result.executionTimeMs}ms</span>
              </div>
            )}
          </div>

          {/* Table container */}
          <div className="flex-1 overflow-auto">
            {result && result.columns.length > 0 ? (
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800">
                  <tr>
                    {result.columns.map((col, idx) => (
                      <th key={idx} className="py-2.5 px-4 font-semibold uppercase text-[10px] tracking-wider">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {result.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-800/30 transition-colors">
                      {result.columns.map((col, cIdx) => (
                        <td key={cIdx} className="py-2 px-4 text-slate-300">
                          {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? 'NULL')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs p-6 text-center">
                <Table className="w-8 h-8 text-slate-600 mb-2" />
                <span>Nenhum resultado para exibir. Escreva uma consulta SQL e clique em "Executar SQL".</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
