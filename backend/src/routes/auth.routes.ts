import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbStorage, User } from '../db/storage.js';
import { CONFIG } from '../config.js';

export const authRouter = Router();

export interface AuthRequest extends Request {
  user?: { id: string; username: string; role: string };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Token não fornecido' });
    return;
  }

  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET) as { id: string; username: string; role: string };
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
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

// Setup initial admin account
authRouter.post('/setup', async (req: Request, res: Response): Promise<void> => {
  const users = dbStorage.getUsers();
  if (users.length > 0) {
    res.status(400).json({ error: 'O painel já possui uma conta de administrador configurada.' });
    return;
  }

  const { username, password, email, serverName } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
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

// Login
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    return;
  }

  const user = dbStorage.getUserByUsername(username);
  if (!user) {
    res.status(401).json({ error: 'Credenciais inválidas' });
    return;
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    res.status(401).json({ error: 'Credenciais inválidas' });
    return;
  }

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
