import React, { useEffect, useState } from 'react';
import { Shield, Copy, Check, Smartphone, KeyRound, Monitor, Trash2 } from 'lucide-react';
import { api } from '../../services/api.js';
import { User } from '../../types/index.js';

interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip?: string;
  userAgent?: string;
  current: boolean;
  revoked: boolean;
}

interface SecuritySectionProps {
  currentUser: User | null;
  onUserUpdate: (user: User) => void;
}

export const SecuritySection: React.FC<SecuritySectionProps> = ({ currentUser, onUserUpdate }) => {
  const [totpEnabled, setTotpEnabled] = useState(Boolean(currentUser?.totpEnabled));
  const [setupSecret, setSetupSecret] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const loadSessions = async () => {
    try {
      const res = await api.get('/auth/sessions');
      setSessions(res.data);
    } catch {
      /* viewer still has own sessions; ignore */
    }
  };

  useEffect(() => {
    setTotpEnabled(Boolean(currentUser?.totpEnabled));
    loadSessions();
  }, [currentUser?.totpEnabled]);

  const startSetup = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await api.post('/auth/2fa/setup', {});
      setSetupSecret(res.data.secret);
      setOtpauth(res.data.otpauthUrl);
      setConfirmCode('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível iniciar o 2FA.');
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.post('/auth/2fa/confirm', { code: confirmCode });
      setTotpEnabled(true);
      setSetupSecret('');
      setOtpauth('');
      setRecoveryCodes(res.data.recoveryCodes || []);
      if (res.data.user) onUserUpdate(res.data.user);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Código inválido.');
    } finally {
      setBusy(false);
    }
  };

  const disable2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.post('/auth/2fa/disable', { password: disablePassword, code: disableCode });
      setTotpEnabled(false);
      setDisablePassword('');
      setDisableCode('');
      if (res.data.user) onUserUpdate(res.data.user);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível desativar o 2FA.');
    } finally {
      setBusy(false);
    }
  };

  const copyRecovery = async () => {
    if (!recoveryCodes?.length) return;
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const revokeSession = async (id: string) => {
    if (!confirm('Encerrar esta sessão? O dispositivo será desconectado em até 30 segundos.')) return;
    try {
      await api.delete(`/auth/sessions/${id}`, { data: {} });
      await loadSessions();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Falha ao revogar a sessão.');
    }
  };

  return (
    <div className="bg-surface-container rounded-lg p-6 border border-outline-variant space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="p-2 rounded bg-primary/10 text-primary">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-white text-base">Segurança</h3>
          <p className="text-xs text-on-surface-variant">
            Autenticação em dois fatores e sessões ativas neste dispositivo.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">{error}</div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-on-surface">
            <Smartphone className="w-4 h-4 text-on-surface-variant" />
            <span>2FA (TOTP)</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold ${
                totpEnabled ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'
              }`}
            >
              {totpEnabled ? 'ATIVO' : 'DESLIGADO'}
            </span>
          </div>
          {!totpEnabled && !setupSecret && (
            <button
              type="button"
              disabled={busy}
              onClick={startSetup}
              className="px-3 py-1.5 rounded bg-primary-container text-white text-xs font-semibold disabled:opacity-50"
            >
              Ativar 2FA
            </button>
          )}
        </div>

        {setupSecret && (
          <form onSubmit={confirmSetup} className="space-y-3 rounded border border-outline-variant p-4 bg-surface-container-low">
            <p className="text-xs text-on-surface-variant">
              Adicione esta chave no autenticador (Google Authenticator, Aegis, 1Password). O segredo
              nunca volta a ser mostrado depois de confirmar.
            </p>
            <code className="block text-sm font-mono text-white break-all bg-surface-container-lowest px-3 py-2 rounded">
              {setupSecret}
            </code>
            <p className="text-[10px] font-mono text-on-surface-variant/70 break-all">{otpauth}</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                inputMode="numeric"
                required
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="Código de 6 dígitos"
                className="flex-1 bg-surface-container-lowest border border-outline-variant rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded bg-ok/20 text-ok text-xs font-semibold disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </form>
        )}

        {recoveryCodes && (
          <div className="rounded border border-warn/40 p-4 bg-warn/5 space-y-2">
            <p className="text-xs text-warn font-semibold">
              Guarde estes códigos agora. Eles não serão mostrados de novo.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-xs text-on-surface">
              {recoveryCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={copyRecovery}
              className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-white"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado' : 'Copiar códigos'}
            </button>
          </div>
        )}

        {totpEnabled && (
          <form onSubmit={disable2fa} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">
                Senha
              </label>
              <input
                type="password"
                required
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">
                Código 2FA
              </label>
              <input
                type="text"
                required
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded px-3 py-2 text-white text-sm font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-2 rounded bg-crit/15 text-crit text-xs font-semibold disabled:opacity-50"
            >
              Desativar 2FA
            </button>
          </form>
        )}
      </div>

      <div className="pt-4 border-t border-outline-variant space-y-3">
        <div className="flex items-center gap-2 text-sm text-on-surface">
          <Monitor className="w-4 h-4 text-on-surface-variant" />
          Sessões
        </div>
        {sessions.length === 0 ? (
          <p className="text-xs text-on-surface-variant">Nenhuma sessão listada.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-3 rounded border border-outline-variant p-3 bg-surface-container-low"
              >
                <div className="min-w-0">
                  <p className="text-xs text-on-surface truncate">
                    {s.userAgent || 'Cliente desconhecido'}
                    {s.current && (
                      <span className="ml-2 text-[10px] font-mono text-ok">ESTA SESSÃO</span>
                    )}
                  </p>
                  <p className="text-[10px] text-on-surface-variant font-mono mt-0.5">
                    {s.ip || '—'} · visto {new Date(s.lastSeenAt).toLocaleString('pt-BR')}
                  </p>
                </div>
                {!s.current && !s.revoked && (
                  <button
                    type="button"
                    onClick={() => revokeSession(s.id)}
                    className="shrink-0 p-1.5 text-crit hover:bg-crit/10 rounded"
                    title="Revogar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-on-surface-variant/70 flex items-center gap-1">
          <KeyRound className="w-3 h-3" />
          Sair do painel revoga esta sessão no servidor, não só o token no navegador.
        </p>
      </div>
    </div>
  );
};
