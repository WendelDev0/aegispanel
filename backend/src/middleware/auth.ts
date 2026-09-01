import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config.js';
import { dbStorage } from '../db/storage.js';

export type UserRole = 'admin' | 'developer' | 'viewer';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  tokenVersion: number;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function verifyToken(token: string): AuthUser {
  const payload = jwt.verify(token, CONFIG.JWT_SECRET);
  if (!payload || typeof payload !== 'object') throw new Error('Payload JWT inválido');

  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.username !== 'string' ||
    !['admin', 'developer', 'viewer'].includes(candidate.role as string)
  ) {
    throw new Error('Claims JWT inválidos');
  }

  return {
    id: candidate.id,
    username: candidate.username,
    role: candidate.role as UserRole,
    tokenVersion: typeof candidate.tokenVersion === 'number' ? candidate.tokenVersion : 0,
  };
}

export function signToken(user: Pick<AuthUser, 'id' | 'username' | 'role'> & { tokenVersion?: number }): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
    },
    CONFIG.JWT_SECRET,
    {
    expiresIn: '7d',
    }
  );
}

function authenticateStoredUser(token: string): AuthUser {
  const claims = verifyToken(token);
  const stored = dbStorage.getUsers().find((user) => user.id === claims.id);

  // Claims are not authority. The current database record is authoritative so
  // deleting a user, changing its role, or rotating its credentials revokes
  // every previously issued token for that account.
  if (!stored || stored.username !== claims.username || stored.role !== claims.role) {
    throw new Error('Usuário não encontrado ou permissões alteradas');
  }

  if ((stored.tokenVersion ?? 0) !== claims.tokenVersion) {
    throw new Error('Sessão revogada');
  }

  return {
    id: stored.id,
    username: stored.username,
    role: stored.role,
    tokenVersion: stored.tokenVersion ?? 0,
  };
}

export function authenticateToken(token: string): AuthUser {
  return authenticateStoredUser(token);
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header && /^Bearer\s+\S+$/i.test(header) ? header.replace(/^Bearer\s+/i, '') : undefined;
  if (!token) {
    res.status(401).json({ error: 'Acesso negado: Token de autenticação não fornecido' });
    return;
  }

  try {
    req.user = authenticateStoredUser(token);
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
