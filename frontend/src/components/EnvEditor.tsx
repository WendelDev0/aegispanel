import React, { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  Check,
  Sparkles,
  Key,
  Code2,
  List,
  Search,
  AlertCircle,
  HelpCircle,
  FileText,
  RotateCcw
} from 'lucide-react';

export interface EnvRow {
  id: string;
  key: string;
  value: string;
  showSecret: boolean;
}

export interface EnvEditorProps {
  /** Initial env record or string */
  initialEnv?: Record<string, string> | string;
  /** Callback fired whenever the variables change */
  onChange: (envRecord: Record<string, string>, envString: string) => void;
  /** Optional placeholder / title */
  title?: string;
  /** Compact mode for embedded creation modals */
  compact?: boolean;
}

export const parseEnvString = (raw: string): EnvRow[] => {
  if (!raw) return [];
  const lines = raw.split('\n');
  const rows: EnvRow[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      if (trimmed) {
        rows.push({
          id: `row-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
          key: trimmed,
          value: '',
          showSecret: false,
        });
      }
      return;
    }

    const key = trimmed.substring(0, eqIndex).trim();
    let val = trimmed.substring(eqIndex + 1).trim();

    // Remove quotes if present
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.substring(1, val.length - 1);
    }

    if (key) {
      rows.push({
        id: `row-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
        key,
        value: val,
        showSecret: false,
      });
    }
  });

  return rows;
};

export const rowsToEnvRecord = (rows: EnvRow[]): Record<string, string> => {
  const obj: Record<string, string> = {};
  rows.forEach((r) => {
    const k = r.key.trim();
    if (k) {
      obj[k] = r.value;
    }
  });
  return obj;
};

export const rowsToEnvString = (rows: EnvRow[]): string => {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => `${r.key.trim()}=${r.value}`)
    .join('\n');
};

const generateSecureSecret = (length = 32): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!@#$%';
  let res = '';
  const cryptoObj = window.crypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const values = new Uint8Array(length);
    cryptoObj.getRandomValues(values);
    for (let i = 0; i < length; i++) {
      res += chars[values[i] % chars.length];
    }
  } else {
    for (let i = 0; i < length; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  return res;
};

export const EnvEditor: React.FC<EnvEditorProps> = ({
  initialEnv = {},
  onChange,
  title,
  compact = false,
}) => {
  const [rows, setRows] = useState<EnvRow[]>(() => {
    if (typeof initialEnv === 'string') {
      const parsed = parseEnvString(initialEnv);
      return parsed.length > 0 ? parsed : [{ id: 'row-1', key: '', value: '', showSecret: false }];
    }
    const entries = Object.entries(initialEnv || {});
    if (entries.length === 0) {
      return [{ id: 'row-1', key: '', value: '', showSecret: false }];
    }
    return entries.map(([k, v], idx) => ({
      id: `row-${idx}-${Math.random().toString(36).substring(2, 6)}`,
      key: k,
      value: v,
      showSecret: false,
    }));
  });

  const [mode, setMode] = useState<'visual' | 'raw'>('visual');
  const [rawText, setRawText] = useState<string>('');
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  // Sync state changes with parent component
  const notifyChange = (updatedRows: EnvRow[]) => {
    const record = rowsToEnvRecord(updatedRows);
    const str = rowsToEnvString(updatedRows);
    onChange(record, str);
  };

  const handleRowChange = (id: string, field: 'key' | 'value', val: string) => {
    const updated = rows.map((r) => {
      if (r.id === id) {
        return {
          ...r,
          [field]: field === 'key' ? val.replace(/\s+/g, '') : val,
        };
      }
      return r;
    });
    setRows(updated);
    notifyChange(updated);
  };

  const handleToggleSecret = (id: string) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, showSecret: !r.showSecret } : r)));
  };

  const handleGenerateSecret = (id: string) => {
    const secret = generateSecureSecret(32);
    const updated = rows.map((r) => (r.id === id ? { ...r, value: secret, showSecret: true } : r));
    setRows(updated);
    notifyChange(updated);
  };

  const handleAddRow = (presetKey = '', presetValue = '') => {
    const newRow: EnvRow = {
      id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      key: presetKey,
      value: presetValue,
      showSecret: false,
    };
    const updated = [...rows, newRow];
    setRows(updated);
    notifyChange(updated);
  };

  const handleRemoveRow = (id: string) => {
    if (rows.length === 1) {
      // Clear instead of removing last row
      const cleared = [{ id: 'row-1', key: '', value: '', showSecret: false }];
      setRows(cleared);
      notifyChange(cleared);
      return;
    }
    const updated = rows.filter((r) => r.id !== id);
    setRows(updated);
    notifyChange(updated);
  };

  const handleCopyValue = (id: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleCopyAll = () => {
    const str = rowsToEnvString(rows);
    navigator.clipboard.writeText(str);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleSwitchToRaw = () => {
    setRawText(rowsToEnvString(rows));
    setMode('raw');
  };

  const handleSwitchToVisual = () => {
    const parsed = parseEnvString(rawText);
    const updated = parsed.length > 0 ? parsed : [{ id: 'row-1', key: '', value: '', showSecret: false }];
    setRows(updated);
    notifyChange(updated);
    setMode('visual');
  };

  const handleRawTextChange = (val: string) => {
    setRawText(val);
    const parsed = parseEnvString(val);
    notifyChange(parsed);
  };

  const quickPresets = [
    { label: 'PORT=3000', key: 'PORT', value: '3000' },
    { label: 'NODE_ENV=production', key: 'NODE_ENV', value: 'production' },
    { label: 'JWT_SECRET (Aleatório)', key: 'JWT_SECRET', value: generateSecureSecret(32) },
    { label: 'DATABASE_URL', key: 'DATABASE_URL', value: 'postgresql://user:password@localhost:5432/dbname' },
    { label: 'CORS_ORIGIN=*', key: 'CORS_ORIGIN', value: '*' },
  ];

  const filteredRows = rows.filter((r) => {
    if (!searchFilter) return true;
    return r.key.toLowerCase().includes(searchFilter.toLowerCase());
  });

  const duplicateKeys = rows
    .map((r) => r.key.trim().toUpperCase())
    .filter((k, idx, arr) => k && arr.indexOf(k) !== idx);

  return (
    <div className="space-y-3">
      {/* Top Action Bar & Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-outline-variant">
        <div className="flex items-center gap-2">
          {title ? (
            <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface">{title}</h4>
          ) : (
            <span className="text-xs font-semibold text-on-surface flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-primary" />
              <span>Chaves & Variáveis de Ambiente</span>
            </span>
          )}
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant">
            {rows.filter((r) => r.key.trim()).length} definida(s)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode Switcher */}
          <div className="flex items-center bg-surface-container-lowest p-0.5 rounded-lg border border-outline-variant">
            <button
              type="button"
              onClick={mode === 'raw' ? handleSwitchToVisual : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                mode === 'visual'
                  ? 'bg-primary-container text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Linha por Linha</span>
            </button>
            <button
              type="button"
              onClick={mode === 'visual' ? handleSwitchToRaw : undefined}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                mode === 'raw'
                  ? 'bg-primary-container text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-white'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Texto .env</span>
            </button>
          </div>

          {/* Copy All .env */}
          <button
            type="button"
            onClick={handleCopyAll}
            title="Copiar todas as variáveis formatadas em .env"
            className="p-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container-high text-on-surface-variant hover:text-white border border-outline-variant text-xs flex items-center gap-1 transition-colors"
          >
            {copiedAll ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline text-[11px]">{copiedAll ? 'Copiado!' : 'Copiar .env'}</span>
          </button>
        </div>
      </div>

      {/* Duplicate Key Warning Alert */}
      {duplicateKeys.length > 0 && (
        <div className="p-2.5 rounded-lg bg-warn/15 border border-warn/30 text-warn text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            Atenção: A chave <strong className="font-mono">{duplicateKeys[0]}</strong> está duplicada.
          </span>
        </div>
      )}

      {/* Quick Presets Buttons */}
      {!compact && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-on-surface-variant uppercase tracking-wider font-semibold mr-1">
            Inserir Rápido:
          </span>
          {quickPresets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => handleAddRow(preset.key, preset.value)}
              className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-container-low hover:bg-surface-container-high text-on-surface-variant hover:text-primary border border-outline-variant transition-all active:scale-95"
            >
              + {preset.label}
            </button>
          ))}
        </div>
      )}

      {/* Search Bar when more than 4 variables */}
      {rows.length > 4 && mode === 'visual' && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filtrar por nome de variável..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-on-surface-variant/50 focus:outline-none focus:border-primary"
          />
        </div>
      )}

      {/* Content: Visual Row-by-Row Mode */}
      {mode === 'visual' ? (
        <div className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
          {/* Column Header */}
          <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider px-1">
            <div className="col-span-5 sm:col-span-4">NOME DA CHAVE (KEY)</div>
            <div className="col-span-6 sm:col-span-7">VALOR (VALUE)</div>
            <div className="col-span-1 text-right">AÇÃO</div>
          </div>

          {/* Rows List */}
          {filteredRows.map((row) => {
            const isInvalidKey = row.key && !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(row.key);

            return (
              <div
                key={row.id}
                className={`grid grid-cols-12 gap-2 items-center p-1.5 rounded-lg bg-surface-container-low border transition-all ${
                  isInvalidKey
                    ? 'border-crit/50 bg-crit/5'
                    : 'border-outline-variant/80 hover:border-primary/40 focus-within:border-primary/60'
                }`}
              >
                {/* Key Column */}
                <div className="col-span-5 sm:col-span-4 relative">
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => handleRowChange(row.id, 'key', e.target.value)}
                    placeholder="CHAVE"
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded px-2.5 py-1.5 text-xs font-mono font-bold text-white placeholder-on-surface-variant/40 focus:outline-none focus:border-primary uppercase"
                  />
                </div>

                {/* Value Column */}
                <div className="col-span-6 sm:col-span-7 relative flex items-center gap-1">
                  <div className="relative flex-1">
                    <input
                      type={row.showSecret ? 'text' : 'password'}
                      value={row.value}
                      onChange={(e) => handleRowChange(row.id, 'value', e.target.value)}
                      placeholder="valor_da_variavel"
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded pl-2.5 pr-8 py-1.5 text-xs font-mono text-ok placeholder-on-surface-variant/40 focus:outline-none focus:border-primary"
                    />

                    {/* Toggle show/hide value */}
                    <button
                      type="button"
                      onClick={() => handleToggleSecret(row.id)}
                      title={row.showSecret ? 'Ocultar valor' : 'Mostrar valor'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-white p-0.5"
                    >
                      {row.showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Generate Secret Button */}
                  <button
                    type="button"
                    onClick={() => handleGenerateSecret(row.id)}
                    title="Gerar chave secreta aleatória segura"
                    className="p-1.5 rounded bg-surface-container hover:bg-surface-container-high text-primary hover:text-primary-light border border-outline-variant shrink-0 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>

                  {/* Copy Single Value */}
                  <button
                    type="button"
                    onClick={() => handleCopyValue(row.id, row.value)}
                    title="Copiar valor"
                    className="p-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-white border border-outline-variant shrink-0 transition-colors"
                  >
                    {copiedIndex === row.id ? (
                      <Check className="w-3.5 h-3.5 text-ok" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Delete Row Column */}
                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(row.id)}
                    title="Remover linha"
                    className="p-1.5 rounded text-on-surface-variant hover:text-crit hover:bg-crit/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Add New Row Button */}
          <button
            type="button"
            onClick={() => handleAddRow()}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-outline-variant hover:border-primary text-primary hover:bg-primary/5 text-xs font-semibold transition-all active:scale-[0.99]"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Nova Variável (Linha)</span>
          </button>
        </div>
      ) : (
        /* Raw .env Text Mode */
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
            <span>Cole ou edite seu arquivo <code className="text-warn font-mono">.env</code> diretamente:</span>
            <span className="text-[10px] font-mono">Formato CHAVE=VALOR</span>
          </div>

          <textarea
            rows={ compact ? 6 : 10 }
            value={rawText}
            onChange={(e) => handleRawTextChange(e.target.value)}
            placeholder="PORT=3000&#10;NODE_ENV=production&#10;DATABASE_URL=postgresql://user:pass@host:5432/db&#10;JWT_SECRET=super_secret_token"
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg p-3 text-xs font-mono text-ok focus:outline-none focus:border-primary leading-relaxed"
          />

          <p className="text-[11px] text-on-surface-variant/70">
            Dica: Ao alternar de volta para o modo <strong>Linha por Linha</strong>, o texto será automaticamente estruturado em tabela.
          </p>
        </div>
      )}
    </div>
  );
};
