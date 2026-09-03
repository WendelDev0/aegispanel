import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { dbStorage, User } from '../db/storage.js';
import {
  AuthRequest,
  UserRole,
  authMiddleware,
  requireAdmin,
  signToken,
} from '../middleware/auth.js';
import { createIpLimiter } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';
import {
  changePasswordBodySchema,
  loginBodySchema,
  setupBodySchema,
} from '../validation/schemas.js';

export const authRouter = Router();

// Re-exported so routers that imported the middleware from here keep working.
export { authMiddleware, requireAdmin, requireWrite } from '../middleware/auth.js';
export type { AuthRequest } from '../middleware/auth.js';

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/;
const MAX_PASSWORD_LENGTH = 512;

/**
 * Shared IP lockout for login, first-run setup and password changes.
 * req.ip (with trust proxy) is the identity — never the raw X-Forwarded-For.
 */
const authLimiter = createIpLimiter({
  maxAttempts: 5,
  lockTimeMs: 15 * 60 * 1000,
});

let setupInProgress = false;

function normalizeRole(role: unknown): UserRole {
  return role === 'admin' || role === 'developer' || role === 'viewer' ? role : 'viewer';
}

function publicUser(u: User) {
  return { id: u.id, username: u.username, email: u.email, role: u.role, createdAt: u.createdAt };
}

function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME.test(username)) {
    return 'O usuário deve ter entre 3 e 64 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.';
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > MAX_PASSWORD_LENGTH) {
    return `A senha deve ter entre 12 e ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}

// Check if panel needs initial setup
authRouter.get('/status', (req: Request, res: Response) => {
  const users = dbStorage.getUsers();
  res.json({
    isInitialized: users.length > 0,
    serverName: dbStorage.getSettings().serverName,
  });
});

// Setup initial admin account (only works once)
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
      // Re-check after validation and before the asynchronous hash. This closes
      // the race where two first-run requests both observed an empty database.
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
      res.json({ token: signToken(newUser), user: publicUser(newUser) });
    } finally {
      setupInProgress = false;
    }
  }
);

// Login with brute-force rate limiting
authRouter.post(
  '/login',
  authLimiter.guard,
  validateBody(loginBodySchema),
  async (req: Request, res: Response): Promise<void> => {
    const { username, password } = req.body;

    const user = dbStorage.getUserByUsername(username);

    // Always run a hash comparison so a missing user and a wrong password take
    // comparable time and cannot be told apart by response latency.
    const storedHash = user?.passwordHash || '$2a$12$0000000000000000000000000000000000000000000000000000u';
    const match = await bcrypt.compare(password, storedHash);

    if (!user || !match) {
      authLimiter.recordFailure(req);
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
    res.json({ token: signToken(user), user: publicUser(user) });
  }
);

// Current user
authRouter.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// Change own password
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
    authLimiter.clear(req);
    res.json({ success: true });
  }
);

// List team users
authRouter.get('/users', authMiddleware, requireAdmin, (req: AuthRequest, res: Response): void => {
  res.json(dbStorage.getUsers().map(publicUser));
});

// Create team user
authRouter.post('/users', authMiddleware, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, password, email, role } = req.body || {};
    const credentialError = validateCredentials(username, password);
    if (credentialError) {
      res.status(400).json({ error: credentialError });
      return;
    }

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

// Remove team user
authRouter.delete('/users/:id', authMiddleware, requireAdmin, (req: AuthRequest, res: Response): void => {
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

    // Never leave the panel without an administrator.
    if (target.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1) {
      res.status(400).json({ error: 'Não é possível remover o único administrador do painel.' });
      return;
    }

    res.json({ success: dbStorage.removeUser(req.params.id) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
