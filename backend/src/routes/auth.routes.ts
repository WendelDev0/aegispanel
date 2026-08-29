import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbStorage, User } from '../db/storage.js';
import { CONFIG } from '../config.js';

export const authRouter = Router();

export interface AuthRequest extends Request {
  user?: { id: string; username: string; role: string };
}

// In-Memory Brute-Force Rate Limiter Map: IP -> { attempts: number, lockUntil?: number }
const loginAttempts = new Map<string, { attempts: number; lockUntil?: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 minutes

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Acesso negado: Token de autenticação não fornecido' });
    return;
  }

  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET) as { id: string; username: string; role: string };
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sessão expirada ou token inválido. Por favor, faça login novamente.' });
  }
}

// Check if panel needs initial setup
authRouter.get('/status', (req: Request, res: Response) => {
  const users = dbStorage.getUsers();
  res.json({
    isInitialized: users.length > 0,
    serverName: dbStorage.getSettings().serverName,
  });
});

// Setup initial admin account (Only works once!)
authRouter.post('/setup', async (req: Request, res: Response): Promise<void> => {
  const users = dbStorage.getUsers();
  if (users.length > 0) {
    res.status(403).json({ error: 'Acesso bloqueado: O painel já possui um administrador cadastrado.' });
    return;
  }

  const { username, password, email, serverName } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'A senha do administrador deve ter no mínimo 8 caracteres.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser: User = {
    id: `usr_${Date.now().toString(36)}`,
    username,
    passwordHash,
    email,
    role: 'admin',
    createdAt: new Date().toISOString(),
  };

  dbStorage.addUser(newUser);

  if (serverName) {
    dbStorage.updateSettings({ serverName });
  }

  const token = jwt.sign(
    { id: newUser.id, username: newUser.username, role: newUser.role },
    CONFIG.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role },
  });
});

// Login with Brute-Force Rate Limiting Protection
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown-ip';
  const now = Date.now();

  const attemptData = loginAttempts.get(clientIp) || { attempts: 0 };

  // Check if IP is currently locked
  if (attemptData.lockUntil && now < attemptData.lockUntil) {
    const minutesLeft = Math.ceil((attemptData.lockUntil - now) / 60000);
    res.status(429).json({
      error: `🛡️ Bloqueio de Segurança: Muitas tentativas incorretas. Seu IP está temporariamente bloqueado por mais ${minutesLeft} minuto(s).`,
    });
    return;
  }

  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    return;
  }

  const user = dbStorage.getUserByUsername(username);
  if (!user) {
    attemptData.attempts += 1;
    if (attemptData.attempts >= MAX_ATTEMPTS) {
      attemptData.lockUntil = now + LOCK_TIME_MS;
    }
    loginAttempts.set(clientIp, attemptData);
    res.status(401).json({ error: 'Usuário ou senha incorretos' });
    return;
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    attemptData.attempts += 1;
    if (attemptData.attempts >= MAX_ATTEMPTS) {
      attemptData.lockUntil = now + LOCK_TIME_MS;
      loginAttempts.set(clientIp, attemptData);
      res.status(429).json({
        error: '🛡️ Bloqueio de Segurança: Limite de 5 tentativas excedido. IP bloqueado temporariamente por 15 minutos.',
      });
      return;
    }
    loginAttempts.set(clientIp, attemptData);
    const remaining = MAX_ATTEMPTS - attemptData.attempts;
    res.status(401).json({
      error: `Usuário ou senha incorretos. (${remaining} tentativa(s) restante(s) antes do bloqueio)`,
    });
    return;
  }

  // Reset failed attempts upon successful login
  loginAttempts.delete(clientIp);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    CONFIG.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  });
});

// Get current user info
authRouter.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});
