import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { dbStorage, User } from '../db/storage.js';
import {
  AuthRequest,
  UserRole,
  authMiddleware,
  pending2faMiddleware,
  requireAdmin,
  signToken,
  clientIp,
  sessionExpiresAt,
} from '../middleware/auth.js';
import { createIpLimiter } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';
import { EncryptionService } from '../utils/crypto.js';
import { AuditStore } from '../utils/audit.store.js';
import { generateTotpSecret, otpauthUrl, verifyTotp, generateRecoveryCodes } from '../utils/totp.js';
import {
  changePasswordBodySchema,
  loginBodySchema,
  setupBodySchema,
  createUserBodySchema,
  emptyBodySchema,
  totpConfirmBodySchema,
  totpDisableBodySchema,
} from '../validation/schemas.js';
import { isRequire2faAdmin } from '../config.js';

export const authRouter = Router();

export { authMiddleware, requireAdmin, requireWrite } from '../middleware/auth.js';
export type { AuthRequest } from '../middleware/auth.js';

const authLimiter = createIpLimiter({
  maxAttempts: 5,
  lockTimeMs: 15 * 60 * 1000,
});

let setupInProgress = false;
const pendingSecrets = new Map<string, { secret: string; expiresAt: number }>();

function normalizeRole(role: unknown): UserRole {
  return role === 'admin' || role === 'developer' || role === 'viewer' ? role : 'viewer';
}

function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    totpEnabled: Boolean(u.totpEnabled),
  };
}

function issueAccess(user: User, req: Request) {
  const ua = req.headers['user-agent'];
  const session = dbStorage.createSession({
    userId: user.id,
    expiresAt: sessionExpiresAt(),
    ip: clientIp(req),
    userAgent: typeof ua === 'string' ? ua.slice(0, 240) : undefined,
  });
  return {
    token: signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
      sid: session.id,
    }),
    session,
  };
}

function auditAuth(
  req: Request,
  action: string,
  outcome: 'success' | 'failure',
  actor?: { id: string; username: string; role: string },
  meta?: Record<string, unknown>
) {
  AuditStore.append({
    actor,
    ip: clientIp(req),
    action,
    outcome,
    meta,
  });
}

authRouter.get('/status', (req: Request, res: Response) => {
  const users = dbStorage.getUsers();
  const settings = dbStorage.getSettings();
  res.json({
    isInitialized: users.length > 0,
    serverName: settings.serverName,
    panelDomain: settings.panelDomain || null,
    httpsExpected: Boolean(settings.panelDomain) && process.env.NODE_ENV === 'production',
  });
});

authRouter.post(
  '/setup',
  authLimiter.guard,
  validateBody(setupBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    const users = dbStorage.getUsers();
    if (users.length > 0) {
      res.status(403).json({ error: 'Acesso bloqueado: O painel já possui um administrador cadastrado.' });
      return;
    }

    const { username, password, email, serverName } = req.body;

    if (setupInProgress) {
      res.status(409).json({ error: 'A configuração inicial já está em andamento.' });
      return;
    }

    setupInProgress = true;
    try {
      if (dbStorage.getUsers().length > 0) {
        res.status(403).json({ error: 'Acesso bloqueado: O painel já possui um administrador cadastrado.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const newUser: User = {
        id: `usr_${Date.now().toString(36)}`,
        username,
        passwordHash,
        email: email || undefined,
        role: 'admin',
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
      };

      dbStorage.addUser(newUser);

      if (serverName) {
        dbStorage.updateSettings({ serverName });
      }

      authLimiter.clear(req);
      const issued = issueAccess(newUser, req);
      auditAuth(req, 'auth.setup', 'success', {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
      });
      res.json({ token: issued.token, user: publicUser(newUser) });
    } finally {
      setupInProgress = false;
    }
  }
);

authRouter.post(
  '/login',
  authLimiter.guard,
  validateBody(loginBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    const { username, password } = req.body;

    const user = dbStorage.getUserByUsername(username);
    const storedHash = user?.passwordHash || '$2a$12$0000000000000000000000000000000000000000000000000000u';
    const match = await bcrypt.compare(password, storedHash);

    if (!user || !match) {
      authLimiter.recordFailure(req);
      auditAuth(req, 'auth.login', 'failure', undefined, { username });
      const locked = authLimiter.isLocked(req);
      if (locked.locked) {
        res.status(429).json({
          error:
            '🛡️ Bloqueio de Segurança: Limite de 5 tentativas excedido. IP bloqueado temporariamente por 15 minutos.',
        });
        return;
      }
      res.status(401).json({
        error: 'Usuário ou senha incorretos.',
      });
      return;
    }

    authLimiter.clear(req);

    if (user.totpEnabled && user.totpSecret) {
      const pending = signToken(
        { id: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
        { type: 'pending2fa' }
      );
      auditAuth(req, 'auth.login.pending2fa', 'success', {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      res.json({ requires2fa: true, pendingToken: pending });
      return;
    }

    const issued = issueAccess(user, req);
    auditAuth(req, 'auth.login', 'success', {
      id: user.id,
      username: user.username,
      role: user.role,
    }, { sid: issued.session.id });
    res.json({ token: issued.token, user: publicUser(user) });
  }
);

authRouter.post(
  '/2fa/verify',
  authLimiter.guard,
  pending2faMiddleware,
  validateBody(totpConfirmBodySchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const user = dbStorage.getUsers().find((u) => u.id === req.user!.id);
    if (!user?.totpSecret) {
      res.status(400).json({ error: '2FA não está configurado nesta conta.' });
      return;
    }

    const secret = EncryptionService.decrypt(user.totpSecret);
    const code = String(req.body.code || '');
    let ok = verifyTotp(secret, code);

    if (!ok && user.totpRecoveryHashes?.length) {
      for (let i = 0; i < user.totpRecoveryHashes.length; i++) {
        if (await bcrypt.compare(code.replace(/\s/g, '').toUpperCase(), user.totpRecoveryHashes[i])) {
          ok = true;
          user.totpRecoveryHashes.splice(i, 1);
          dbStorage.saveUser(user);
          break;
        }
      }
    }

    if (!ok) {
      authLimiter.recordFailure(req);
      auditAuth(req, 'auth.2fa.verify', 'failure', {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      res.status(401).json({ error: 'Código 2FA inválido.' });
      return;
    }

    authLimiter.clear(req);
    const issued = issueAccess(user, req);
    auditAuth(req, 'auth.2fa.verify', 'success', {
      id: user.id,
      username: user.username,
      role: user.role,
    }, { sid: issued.session.id });
    res.json({ token: issued.token, user: publicUser(user) });
  }
);

authRouter.post(
  '/2fa/setup',
  authMiddleware,
  validateBody(emptyBodySchema),
  (req: AuthRequest, res: Response): void => {
    const user = dbStorage.getUsers().find((u) => u.id === req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }
    if (user.totpEnabled) {
      res.status(400).json({ error: '2FA já está ativo. Desative para gerar um novo segredo.' });
      return;
    }
    const secret = generateTotpSecret();
    pendingSecrets.set(user.id, { secret, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.json({
      secret,
      otpauthUrl: otpauthUrl(user.username, secret),
    });
  }
);

authRouter.post(
  '/2fa/confirm',
  authMiddleware,
  validateBody(totpConfirmBodySchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const user = dbStorage.getUsers().find((u) => u.id === req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }
    const pending = pendingSecrets.get(user.id);
    if (!pending || pending.expiresAt < Date.now()) {
      res.status(400).json({ error: 'Inicie o setup 2FA novamente. O segredo expirou.' });
      return;
    }
    if (!verifyTotp(pending.secret, String(req.body.code || ''))) {
      auditAuth(req, 'auth.2fa.confirm', 'failure', {
        id: user.id,
        username: user.username,
        role: user.role,
      });
      res.status(401).json({ error: 'Código 2FA inválido.' });
      return;
    }

    const recovery = generateRecoveryCodes();
    user.totpSecret = EncryptionService.encrypt(pending.secret);
    user.totpEnabled = true;
    user.totpRecoveryHashes = await Promise.all(recovery.map((c) => bcrypt.hash(c, 12)));
    dbStorage.saveUser(user);
    pendingSecrets.delete(user.id);
    auditAuth(req, 'auth.2fa.enable', 'success', {
      id: user.id,
      username: user.username,
      role: user.role,
    });
    res.json({ success: true, recoveryCodes: recovery, user: publicUser(user) });
  }
);

authRouter.post(
  '/2fa/disable',
  authMiddleware,
  authLimiter.guard,
  validateBody(totpDisableBodySchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const user = dbStorage.getUsers().find((u) => u.id === req.user!.id);
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      authLimiter.recordFailure(req);
      res.status(401).json({ error: 'Senha incorreta.' });
      return;
    }
    if (!user.totpSecret || !user.totpEnabled) {
      res.status(400).json({ error: '2FA não está ativo.' });
      return;
    }
    const secret = EncryptionService.decrypt(user.totpSecret);
    if (!verifyTotp(secret, String(req.body.code || ''))) {
      res.status(401).json({ error: 'Código 2FA inválido.' });
      return;
    }
    user.totpEnabled = false;
    user.totpSecret = undefined;
    user.totpRecoveryHashes = [];
    dbStorage.saveUser(user);
    authLimiter.clear(req);
    auditAuth(req, 'auth.2fa.disable', 'success', {
      id: user.id,
      username: user.username,
      role: user.role,
    });
    res.json({ success: true, user: publicUser(user) });
  }
);

authRouter.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const stored = dbStorage.getUsers().find((u) => u.id === req.user!.id);
  res.json({
    user: stored ? publicUser(stored) : req.user,
    sid: req.user!.sid,
    require2faAdmin: isRequire2faAdmin(),
  });
});

authRouter.post('/refresh', authMiddleware, validateBody(emptyBodySchema), (req: AuthRequest, res: Response): void => {
  const user = dbStorage.getUsers().find((u) => u.id === req.user!.id);
  if (!user || !req.user!.sid) {
    res.status(401).json({ error: 'Sessão inválida.' });
    return;
  }
  const session = dbStorage.extendSession(req.user!.sid, sessionExpiresAt());
  if (!session) {
    res.status(401).json({ error: 'Sessão revogada.' });
    return;
  }
  const token = signToken({
    id: user.id,
    username: user.username,
    role: user.role,
    tokenVersion: user.tokenVersion ?? 0,
    sid: session.id,
  });
  res.json({ token, user: publicUser(user) });
});

authRouter.post('/logout', authMiddleware, validateBody(emptyBodySchema), (req: AuthRequest, res: Response): void => {
  if (req.user!.sid) dbStorage.revokeSession(req.user!.sid);
  auditAuth(req, 'auth.logout', 'success', {
    id: req.user!.id,
    username: req.user!.username,
    role: req.user!.role,
  }, { sid: req.user!.sid });
  res.json({ success: true });
});

authRouter.get('/sessions', authMiddleware, (req: AuthRequest, res: Response): void => {
  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const targetUserId =
    requestedUserId && req.user!.role === 'admin' ? requestedUserId : req.user!.id;
  const mine = dbStorage.listSessions(targetUserId).filter((s) => !s.revokedAt || s.id === req.user!.sid);
  res.json(
    mine.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      ip: s.ip,
      userAgent: s.userAgent,
      current: s.id === req.user!.sid,
      revoked: Boolean(s.revokedAt),
      userId: s.userId,
    }))
  );
});

authRouter.delete('/sessions/:id', authMiddleware, validateBody(emptyBodySchema), (req: AuthRequest, res: Response): void => {
  const session = dbStorage.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Sessão não encontrada.' });
    return;
  }
  const isOwn = session.userId === req.user!.id;
  if (!isOwn && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Permissão insuficiente.' });
    return;
  }
  dbStorage.revokeSession(session.id);
  auditAuth(req, 'auth.session.revoke', 'success', {
    id: req.user!.id,
    username: req.user!.username,
    role: req.user!.role,
  }, { sid: session.id, targetUserId: session.userId });
  res.json({ success: true });
});

authRouter.post(
  '/change-password',
  authMiddleware,
  authLimiter.guard,
  validateBody(changePasswordBodySchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { currentPassword, newPassword } = req.body;

    const user = dbStorage.getUsers().find((u) => u.id === req.user!.id);
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      authLimiter.recordFailure(req);
      res.status(401).json({ error: 'Senha atual incorreta' });
      return;
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    dbStorage.saveUser(user);
    dbStorage.revokeUserSessions(user.id, req.user!.sid);
    authLimiter.clear(req);
    auditAuth(req, 'auth.password.change', 'success', {
      id: user.id,
      username: user.username,
      role: user.role,
    });
    const issued = issueAccess(user, req);
    res.json({ success: true, token: issued.token });
  }
);

authRouter.get('/users', authMiddleware, requireAdmin, (req: AuthRequest, res: Response): void => {
  res.json(dbStorage.getUsers().map(publicUser));
});

authRouter.post('/users', authMiddleware, requireAdmin, validateBody(createUserBodySchema), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, password, email, role } = req.body;
    if (dbStorage.getUserByUsername(username)) {
      res.status(400).json({ error: 'Nome de usuário já cadastrado' });
      return;
    }

    const newUser: User = {
      id: `usr-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      username,
      passwordHash: await bcrypt.hash(password, 12),
      email: email || undefined,
      role: normalizeRole(role),
      tokenVersion: 0,
      createdAt: new Date().toISOString(),
    };

    dbStorage.addUser(newUser);
    res.status(201).json(publicUser(newUser));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

authRouter.delete('/users/:id', authMiddleware, requireAdmin, validateBody(emptyBodySchema), (req: AuthRequest, res: Response): void => {
  try {
    const users = dbStorage.getUsers();
    const target = users.find((u) => u.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado' });
      return;
    }

    if (target.id === req.user!.id) {
      res.status(400).json({ error: 'Você não pode remover a própria conta.' });
      return;
    }

    if (target.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1) {
      res.status(400).json({ error: 'Não é possível remover o único administrador do painel.' });
      return;
    }

    res.json({ success: dbStorage.removeUser(req.params.id) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
