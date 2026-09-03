import React, { useState, useEffect } from 'react';
import { Server, Lock, User, Mail, ArrowRight, ShieldCheck } from 'lucide-react';
import { api, persistSession } from '../services/api.js';

interface AuthPageProps {
  onLoginSuccess: (user: any, token: string) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onLoginSuccess }) => {
  const [isSetup, setIsSetup] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [serverName, setServerName] = useState('Meu Servidor');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Held in component state on purpose: putting a pending2fa JWT in
  // localStorage as aegis_token would make every other API call 401 and
  // wipe the login screen.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  useEffect(() => {
    api.get('/auth/status')
      .then((res) => {
        setIsSetup(!res.data.isInitialized);
        if (res.data.serverName) setServerName(res.data.serverName);
      })
      .catch(() => {
        setIsSetup(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const finishLogin = (token: string, user: unknown) => {
    persistSession(token, user);
    onLoginSuccess(user, token);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);

    try {
      if (isSetup) {
        const res = await api.post('/auth/setup', {
          username,
          password,
          email,
          serverName,
        });
        finishLogin(res.data.token, res.data.user);
        return;
      }

      if (pendingToken) {
        const res = await api.post(
          '/auth/2fa/verify',
          { code: totpCode },
          { headers: { Authorization: `Bearer ${pendingToken}` } }
        );
        finishLogin(res.data.token, res.data.user);
        return;
      }

      const res = await api.post('/auth/login', {
        username,
        password,
      });
      if (res.data.requires2fa && res.data.pendingToken) {
        setPendingToken(res.data.pendingToken);
        setTotpCode('');
        return;
      }
      finishLogin(res.data.token, res.data.user);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Erro na autenticação. Verifique os dados.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090d16] flex items-center justify-center text-on-surface-variant">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090d16] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-primary-container/15 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md bg-[#0f172a]/90 backdrop-blur-xl border border-outline-variant rounded-3xl p-8 relative z-10">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-lg bg-primary-container flex items-center justify-center text-white mx-auto mb-4">
            {pendingToken ? <ShieldCheck className="w-7 h-7" /> : <Server className="w-7 h-7" />}
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            AegisPanel <span className="text-primary text-xs font-mono uppercase bg-primary-container/20 px-2 py-0.5 rounded ml-1">Cloud</span>
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {pendingToken
              ? 'Digite o código do autenticador'
              : isSetup
                ? 'Configuração Inicial do Administrador'
                : 'Acesse seu painel de controle'}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {pendingToken ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Código 2FA
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="000000 ou código de recuperação"
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-2.5 text-white text-sm font-mono tracking-widest focus:outline-none focus:border-primary"
                />
                <p className="text-[11px] text-on-surface-variant/70 mt-1.5">
                  Use o app autenticador ou um código de recuperação de uso único.
                </p>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-3 rounded-xl bg-primary-container hover:bg-primary-container text-white font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-98"
              >
                <span>Verificar e entrar</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingToken(null);
                  setTotpCode('');
                  setErrorMsg('');
                }}
                className="w-full text-xs text-on-surface-variant hover:text-white"
              >
                Voltar ao login
              </button>
            </>
          ) : (
            <>
              {isSetup && (
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Nome do Servidor / VPS
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      placeholder="Meu Servidor"
                      className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Usuário Administrador
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-on-surface-variant/70 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl pl-10 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {isSetup && (
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    E-mail (Opcional)
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-on-surface-variant/70 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full bg-surface-container-low border border-outline-variant rounded-xl pl-10 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-on-surface-variant/70 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    minLength={isSetup ? 12 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl pl-10 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                {isSetup && (
                  <p className="text-[11px] text-on-surface-variant/70 mt-1.5">
                    Mínimo de 12 caracteres. Esta conta controla todo o servidor.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-3 rounded-xl bg-primary-container hover:bg-primary-container text-white font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-98"
              >
                <span>{isSetup ? 'Concluir Instalação & Entrar' : 'Acessar Painel'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}
        </form>

        <div className="mt-8 pt-4 border-t border-outline-variant/80 text-center text-xs text-on-surface-variant/70">
          Infraestrutura 100% sob seu controle
        </div>
      </div>
    </div>
  );
};
