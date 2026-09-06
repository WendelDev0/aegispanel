import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  Search,
  Tag,
  MessageSquare,
  Trash2,
  BellOff,
  Bell,
  Plus,
  X,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api.js';
import type { WaContact, WaContactHistoryEntry } from '../types/index.js';
import { Panel, SectionHeader, StatCard, Badge } from '../components/ui.js';

const PAGE_SIZE = 40;

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '—';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}

/**
 * The roster of everyone who has messaged a published flow.
 *
 * There is no phone number on this page and there is none in the API that
 * feeds it: a contact is identified by a salted hash and shown by the last
 * four digits, so an exported roster is not a phone book. The full number is
 * decrypted only on the sending path.
 */
export const ContactsPage: React.FC = () => {
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WaContact | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (search.trim()) params.set('search', search.trim());
      if (activeTag) params.set('tag', activeTag);

      const [list, tagList] = await Promise.all([
        api.get(`/wa-contacts?${params.toString()}`),
        api.get('/wa-contacts/tags'),
      ]);
      setContacts(list.data.contacts || []);
      setTotal(list.data.total || 0);
      setTags(tagList.data || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Não foi possível carregar os contatos.');
    } finally {
      setLoading(false);
    }
  }, [activeTag, offset, search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const optedOut = useMemo(() => contacts.filter((c) => c.optedOut).length, [contacts]);
  const withTags = useMemo(() => contacts.filter((c) => c.tags.length > 0).length, [contacts]);

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={<Users className="w-5 h-5" />}
        title="Contatos"
        subtitle="Quem já conversou com um fluxo publicado, com o que os blocos guardaram sobre cada um"
        actions={
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-high text-xs text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Contatos" value={total} icon={<Users className="w-4 h-4" />} />
        <StatCard label="Etiquetas" value={tags.length} icon={<Tag className="w-4 h-4" />} tone="info" />
        <StatCard label="Com etiqueta" value={withTags} detail="nesta página" tone="ok" />
        <StatCard
          label="Descadastrados"
          value={optedOut}
          detail="nesta página"
          tone={optedOut ? 'warn' : 'info'}
          icon={<BellOff className="w-4 h-4" />}
        />
      </div>

      <Panel className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder="Buscar por nome ou final do número"
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-on-surface"
            />
          </div>
          {activeTag && (
            <button
              type="button"
              onClick={() => {
                setActiveTag(null);
                setOffset(0);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/15 text-primary text-xs border border-primary/30"
            >
              #{activeTag}
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {tags.map((t) => (
              <button
                key={t.tag}
                type="button"
                onClick={() => {
                  setActiveTag(t.tag === activeTag ? null : t.tag);
                  setOffset(0);
                }}
                className={`px-2 py-0.5 rounded-full text-2xs border transition-colors ${
                  t.tag === activeTag
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-surface-container-low text-on-surface-variant border-outline-variant hover:text-on-surface'
                }`}
              >
                #{t.tag} <span className="opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {error && (
        <Panel accent="crit" className="p-4 text-xs text-on-surface-variant">
          {error}
        </Panel>
      )}

      <Panel className="overflow-hidden">
        {contacts.length === 0 && !loading ? (
          <div className="p-10 text-center text-xs text-on-surface-variant">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="font-semibold text-on-surface">Nenhum contato ainda</p>
            <p className="mt-1">
              Um contato aparece aqui na primeira mensagem que um fluxo publicado responder.
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-outline-variant text-on-surface-variant">
                <th className="text-left font-medium px-4 py-2.5">Contato</th>
                <th className="text-left font-medium px-4 py-2.5 hidden md:table-cell">Etiquetas</th>
                <th className="text-left font-medium px-4 py-2.5 hidden lg:table-cell">Atributos</th>
                <th className="text-right font-medium px-4 py-2.5">Última mensagem</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr
                  key={`${contact.instance}-${contact.phoneHash}`}
                  onClick={() => setSelected(contact)}
                  className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-container-high/50 cursor-pointer"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-on-surface">
                        {contact.pushName || 'Sem nome'}
                      </span>
                      <span className="font-mono text-2xs text-on-surface-variant">
                        ···{contact.phoneTail}
                      </span>
                      {contact.optedOut && <Badge tone="warn">descadastrado</Badge>}
                    </div>
                    <span className="text-2xs text-on-surface-variant/70">
                      {contact.instance} · {contact.inboundCount} mensagens
                    </span>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <div className="flex gap-1 flex-wrap">
                      {contact.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded-full bg-surface-container-low border border-outline-variant text-2xs text-on-surface-variant"
                        >
                          #{tag}
                        </span>
                      ))}
                      {contact.tags.length === 0 && <span className="text-on-surface-variant/50">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell font-mono text-2xs text-on-surface-variant truncate max-w-[240px]">
                    {Object.entries(contact.attrs)
                      .slice(0, 3)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-on-surface-variant whitespace-nowrap">
                    {relative(contact.lastSeen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-on-surface-variant">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="px-3 py-1.5 rounded-lg bg-surface-container-high disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="px-3 py-1.5 rounded-lg bg-surface-container-high disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {selected && (
        <ContactDrawer
          contact={selected}
          onClose={() => setSelected(null)}
          onSaved={(next) => {
            setContacts((list) =>
              list.map((c) =>
                c.phoneHash === next.phoneHash && c.instance === next.instance ? next : c
              )
            );
            setSelected(next);
          }}
          onDeleted={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </div>
  );
};

const ContactDrawer: React.FC<{
  contact: WaContact;
  onClose: () => void;
  onSaved: (next: WaContact) => void;
  onDeleted: () => void;
}> = ({ contact, onClose, onSaved, onDeleted }) => {
  const [tags, setTags] = useState(contact.tags.join(', '));
  const [attrs, setAttrs] = useState<Array<[string, string]>>(Object.entries(contact.attrs));
  const [history, setHistory] = useState<WaContactHistoryEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/wa-contacts/${encodeURIComponent(contact.instance)}/${encodeURIComponent(contact.phoneHash)}`;

  useEffect(() => {
    setTags(contact.tags.join(', '));
    setAttrs(Object.entries(contact.attrs));
    api
      .get(`${base}/history?limit=40`)
      .then((res) => setHistory(res.data.messages || []))
      .catch(() => setHistory([]));
  }, [base, contact]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.put(base, patch);
      onSaved(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Apagar este contato e todo o histórico dele?')) return;
    try {
      await api.delete(base);
      onDeleted();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Não foi possível apagar.');
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="w-full max-w-md h-full bg-surface-container border-l border-outline-variant overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface-container border-b border-outline-variant px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-on-surface truncate">
              {contact.pushName || 'Sem nome'}
            </h3>
            <p className="font-mono text-2xs text-on-surface-variant">
              ···{contact.phoneTail} · {contact.instance}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-5 text-xs">
          {error && <p className="text-crit">{error}</p>}

          <div>
            <span className="mono-label">Etiquetas</span>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="lead-quente, orcamento"
                className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-1.5 text-on-surface font-mono text-xs"
              />
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  save({
                    tags: tags
                      .split(',')
                      .map((t) => t.trim().toLowerCase())
                      .filter(Boolean),
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="mono-label">Atributos</span>
              <button
                type="button"
                onClick={() => setAttrs([...attrs, ['', '']])}
                className="text-2xs text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Adicionar
              </button>
            </div>
            <div className="space-y-1.5 mt-1.5">
              {attrs.map(([key, value], index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input
                    value={key}
                    onChange={(e) => {
                      const next = [...attrs];
                      next[index] = [e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''), value];
                      setAttrs(next);
                    }}
                    className="w-1/3 bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-on-surface font-mono text-xs"
                  />
                  <input
                    value={value}
                    onChange={(e) => {
                      const next = [...attrs];
                      next[index] = [key, e.target.value];
                      setAttrs(next);
                    }}
                    className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-on-surface text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setAttrs(attrs.filter((_, i) => i !== index))}
                    className="p-1 rounded text-crit hover:bg-crit/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                // An empty value clears the key, which is how a row is removed.
                save({ attrs: Object.fromEntries(attrs.filter(([k]) => k)) })
              }
              className="mt-2 w-full py-1.5 rounded-lg bg-surface-container-high text-on-surface disabled:opacity-50"
            >
              Salvar atributos
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => save({ optedOut: !contact.optedOut })}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-surface-container-high text-on-surface disabled:opacity-50"
            >
              {contact.optedOut ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
              {contact.optedOut ? 'Recadastrar' : 'Descadastrar'}
            </button>
            <button
              type="button"
              onClick={remove}
              className="px-3 py-1.5 rounded-lg text-crit border border-crit/30 hover:bg-crit/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div>
            <span className="mono-label flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" /> Conversa
            </span>
            <div className="mt-2 space-y-2">
              {history.length === 0 && (
                <p className="text-on-surface-variant/70">Nenhuma mensagem guardada.</p>
              )}
              {history.map((entry, index) => (
                <div
                  key={index}
                  className={`rounded-lg px-2.5 py-1.5 max-w-[85%] ${
                    entry.role === 'user'
                      ? 'bg-surface-container-low border border-outline-variant text-on-surface'
                      : 'bg-primary/10 border border-primary/25 text-on-surface ml-auto'
                  }`}
                >
                  {entry.content}
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default ContactsPage;
