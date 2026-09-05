import React, { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { useToast } from '../Toast.js';
import type { AppBuildConfig, AppRecord, AppRuntime } from '../../types/index.js';

const RUNTIMES: AppRuntime[] = [
  'node',
  'python',
  'static',
  'go',
  'rust',
  'php',
  'java',
  'ruby',
  'bun',
  'deno',
  'docker',
];

const VERSIONS: Record<string, string[]> = {
  node: ['18', '20', '22'],
  python: ['3.10', '3.11', '3.12', '3.13'],
  go: ['1.21', '1.22', '1.23', '1.24'],
  php: ['8.1', '8.2', '8.3'],
  java: ['17', '21'],
  ruby: ['3.2', '3.3'],
  rust: ['stable'],
  bun: ['1'],
  deno: ['2'],
  static: ['alpine'],
  docker: ['native'],
};

const SOURCE_LABEL: Record<string, string> = {
  manual: 'manual',
  toml: 'aegis.toml',
  detected: 'detectado',
};

interface Props {
  app: AppRecord;
  onSaved: (app: AppRecord) => void;
}

export const AppBuildPanel: React.FC<Props> = ({ app, onSaved }) => {
  const toast = useToast();
  const [draft, setDraft] = useState<AppBuildConfig>(
    app.buildConfig || { runtime: 'node', version: '20', source: 'manual' }
  );
  const [recipe, setRecipe] = useState<string>('');
  const [sources, setSources] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (app.buildConfig) setDraft(app.buildConfig);
  }, [app.buildConfig]);

  useEffect(() => {
    api
      .get(`/apps/${app.id}/recipe`)
      .then((res) => {
        setRecipe(res.data.dockerfile || '');
        setSources(res.data.sourceByField || {});
      })
      .catch(() => setRecipe(''));
  }, [app.id, app.buildConfig, app.updatedAt]);

  const save = async () => {
    try {
      setSaving(true);
      const res = await api.put(`/apps/${app.id}/build-config`, { ...draft, source: 'manual' });
      onSaved(res.data);
      toast.success('Configuração de build salva');
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message, 'Erro ao salvar build');
    } finally {
      setSaving(false);
    }
  };

  const versions = VERSIONS[draft.runtime] || [];

  return (
    <div className="space-y-5">
      <div className="p-5 rounded-lg bg-surface-container border border-outline-variant space-y-4">
        <div>
          <h3 className="text-sm font-bold text-white">Build</h3>
          <p className="text-xs text-on-surface-variant mt-0.5">
            O detector propõe. O <span className="font-mono">aegis.toml</span> decide. Você confirma.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Runtime" source={sources.runtime}>
            <select
              value={draft.runtime}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  runtime: e.target.value as AppRuntime,
                  version: (VERSIONS[e.target.value] || [])[0],
                })
              }
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white"
            >
              {RUNTIMES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Versão" source={sources.version}>
            <select
              value={draft.version || ''}
              onChange={(e) => setDraft({ ...draft, version: e.target.value })}
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white"
            >
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subpasta (monorepo)" source={sources.rootDir}>
            <input
              value={draft.rootDir || ''}
              onChange={(e) => setDraft({ ...draft, rootDir: e.target.value })}
              placeholder="apps/api"
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
            />
          </Field>
          <Field label="Output (estático)" source={sources.outputDir}>
            <input
              value={draft.outputDir || ''}
              onChange={(e) => setDraft({ ...draft, outputDir: e.target.value })}
              placeholder="dist"
              className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
            />
          </Field>
        </div>
        <Field label="Install" source={sources.installCommand}>
          <input
            value={draft.installCommand || ''}
            onChange={(e) => setDraft({ ...draft, installCommand: e.target.value })}
            className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
          />
        </Field>
        <Field label="Build" source={sources.buildCommand}>
          <input
            value={draft.buildCommand || ''}
            onChange={(e) => setDraft({ ...draft, buildCommand: e.target.value })}
            className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
          />
        </Field>
        <Field label="Start" source={sources.startCommand}>
          <input
            value={draft.startCommand || ''}
            onChange={(e) => setDraft({ ...draft, startCommand: e.target.value })}
            className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-xs text-white font-mono"
          />
        </Field>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded bg-primary text-on-primary text-xs font-semibold disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Salvar build'}
        </button>
      </div>

      <div className="p-5 rounded-lg bg-surface-container border border-outline-variant space-y-2">
        <h3 className="text-sm font-bold text-white">Receita (Dockerfile)</h3>
        <pre className="p-4 bg-black/95 rounded border border-outline-variant font-mono text-[11px] text-on-surface overflow-x-auto max-h-96">
          {recipe || '# Faça um inspect ou o primeiro deploy para ver a receita.'}
        </pre>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; source?: string; children: React.ReactNode }> = ({
  label,
  source,
  children,
}) => (
  <label className="block space-y-1">
    <span className="flex items-center justify-between text-[11px] font-semibold text-on-surface-variant uppercase">
      {label}
      {source && (
        <span className="normal-case font-mono font-normal text-[10px] text-on-surface-variant/70">
          {SOURCE_LABEL[source] || source}
        </span>
      )}
    </span>
    {children}
  </label>
);
