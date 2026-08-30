import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config.js';

export type UserRole = 'admin' | 'developer' | 'viewer';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, CONFIG.JWT_SECRET) as AuthUser;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, CONFIG.JWT_SECRET, {
    expiresIn: '7d',
  });
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Acesso negado: Token de autenticação não fornecido' });
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada ou token inválido. Por favor, faça login novamente.' });
  }
}

/**
 * Role gate. Every route that can change server state must sit behind one of
 * these: a valid token alone says who the caller is, never what they may do.
 *
 *   admin     - full control, including users, secrets and shell execution
 *   developer - deploys, apps, databases, files; no user or shell management
 *   viewer    - read-only
 */
export function requireRole(...allowed: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({
        error: `Permissão insuficiente: esta ação exige o perfil ${allowed.join(' ou ')}. Seu perfil é "${req.user.role}".`,
      });
      return;
    }
    next();
  };
}

/** Anything that mutates state: blocks viewers. */
export const requireWrite = requireRole('admin', 'developer');

/** Users, secrets, shell execution, panel state import. */
export const requireAdmin = requireRole('admin');
