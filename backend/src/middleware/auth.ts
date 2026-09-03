import { Request, Response, NextFunction } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { CONFIG, isRequire2faAdmin } from '../config.js';
import { dbStorage } from '../db/storage.js';
import { AuditStore } from '../utils/audit.store.js';

export type UserRole = 'admin' | 'developer' | 'viewer';
export type TokenType = 'access' | 'pending2fa';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  tokenVersion: number;
  sid?: string;
  tokenType: TokenType;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

const ACCESS_EXPIRES = '24h';
const PENDING_2FA_EXPIRES = '5m';

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

  const tokenType: TokenType = candidate.typ === 'pending2fa' ? 'pending2fa' : 'access';

  return {
    id: candidate.id,
    username: candidate.username,
    role: candidate.role as UserRole,
    tokenVersion: typeof candidate.tokenVersion === 'number' ? candidate.tokenVersion : 0,
    sid: typeof candidate.sid === 'string' ? candidate.sid : undefined,
    tokenType,
  };
}

export function signToken(
  user: Pick<AuthUser, 'id' | 'username' | 'role'> & { tokenVersion?: number; sid?: string },
  opts: { type?: TokenType; expiresIn?: string } = {}
): string {
  const type = opts.type || 'access';
  if (type === 'access' && !user.sid) {
    throw new Error('Token de acesso exige sid de sessão.');
  }
  const expiresIn = (opts.expiresIn ||
    (type === 'pending2fa' ? PENDING_2FA_EXPIRES : ACCESS_EXPIRES)) as SignOptions['expiresIn'];
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
      sid: user.sid,
      typ: type,
    },
    CONFIG.JWT_SECRET,
    { expiresIn }
  );
}

function authenticateStoredUser(token: string, opts: { allowPending2fa?: boolean } = {}): AuthUser {
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

  if (claims.tokenType === 'pending2fa') {
    if (!opts.allowPending2fa) throw new Error('Complete o 2FA para continuar.');
    return { ...claims, tokenType: 'pending2fa' };
  }

  // Access tokens issued before sessions existed have no sid. Reject them so
  // a 7-day JWT cannot outlive a revoke-by-device model.
  if (!claims.sid) throw new Error('Sessão inválida');
  const session = dbStorage.getSession(claims.sid);
  if (!session || session.userId !== stored.id) throw new Error('Sessão inválida');
  if (session.revokedAt) throw new Error('Sessão revogada');
  if (Date.parse(session.expiresAt) <= Date.now()) throw new Error('Sessão expirada');
  dbStorage.touchSession(session.id);

  return {
    id: stored.id,
    username: stored.username,
    role: stored.role,
    tokenVersion: stored.tokenVersion ?? 0,
    sid: session.id,
    tokenType: 'access',
  };
}

export function authenticateToken(token: string): AuthUser {
  return authenticateStoredUser(token);
}

export function authenticatePending2fa(token: string): AuthUser {
  return authenticateStoredUser(token, { allowPending2fa: true });
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header && /^Bearer\s+\S+$/i.test(header) ? header.replace(/^Bearer\s+/i, '') : undefined;
}

export function clientIp(req: Request): string | undefined {
  const ip = req.ip || req.socket.remoteAddress;
  return ip?.replace(/^::ffff:/, '') || undefined;
}

function auditGate(req: AuthRequest, outcome: 'forbidden' | 'unauthenticated'): void {
  AuditStore.append({
    actor: req.user
      ? { id: req.user.id, username: req.user.username, role: req.user.role }
      : undefined,
    sid: req.user?.sid,
    ip: clientIp(req),
    action: `${req.method} ${req.originalUrl?.split('?')[0] || req.path}`,
    outcome,
  });
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
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

export async function pending2faMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Acesso negado: Token de autenticação não fornecido' });
    return;
  }
  try {
    req.user = authenticatePending2fa(token);
    if (req.user.tokenType !== 'pending2fa') {
      res.status(400).json({ error: 'Este passo espera o token pendente de 2FA.' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Token 2FA expirado. Faça login novamente.' });
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
  return function roleGate(req: AuthRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      auditGate(req, 'unauthenticated');
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      auditGate(req, 'forbidden');
      res.status(403).json({
        error: `Permissão insuficiente: esta ação exige o perfil ${allowed.join(' ou ')}. Seu perfil é "${req.user.role}".`,
      });
      return;
    }

    const action = `${req.method} ${req.originalUrl?.split('?')[0] || req.path}`;
    res.on('finish', () => {
      if (req.method === 'GET' && res.statusCode < 400) return;
      AuditStore.append({
        actor: { id: req.user!.id, username: req.user!.username, role: req.user!.role },
        sid: req.user!.sid,
        ip: clientIp(req),
        action,
        outcome: res.statusCode >= 400 ? 'failure' : 'success',
        meta: { status: res.statusCode },
      });
    });
    next();
  };
}

/** Anything that mutates state: blocks viewers. */
export const requireWrite = requireRole('admin', 'developer');

/** Users, secrets, shell execution, panel state import. */
export const requireAdmin = requireRole('admin');

export function adminHas2fa(userId: string): boolean {
  const stored = dbStorage.getUsers().find((u) => u.id === userId);
  return Boolean(stored?.totpEnabled && stored.totpSecret);
}

export function requireAdmin2fa(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Permissão insuficiente: esta ação exige o perfil admin.' });
    return;
  }
  if (isRequire2faAdmin() && !adminHas2fa(req.user.id)) {
    AuditStore.append({
      actor: { id: req.user.id, username: req.user.username, role: req.user.role },
      sid: req.user.sid,
      ip: clientIp(req),
      action: 'admin.2fa.required',
      outcome: 'forbidden',
    });
    res.status(403).json({
      error: 'Ative a autenticação em dois fatores para usar o terminal do host e outras ações privilegiadas.',
    });
    return;
  }
  next();
}

export function sessionExpiresAt(from = Date.now()): string {
  return new Date(from + 30 * 24 * 60 * 60 * 1000).toISOString();
}
