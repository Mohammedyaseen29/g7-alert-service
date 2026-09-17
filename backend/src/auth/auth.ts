import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { AppStore } from '../database/store.js';

export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export async function seedAdmin(store: AppStore, rounds: number) {
  if (store.getUsers().length === 0) {
    const hash = await bcrypt.hash('admin123', rounds);
    store.addUser({ id: 'u-admin', username: 'admin', hash, role: 'ADMIN' });
  }
}

export function signTokens(user: { id: string; username: string; role: string }, secret: string, refreshSecret: string, expiresIn: string) {
  const access = jwt.sign({ sub: user.id, username: user.username, role: user.role }, secret, { expiresIn } as jwt.SignOptions);
  const refresh = jwt.sign({ sub: user.id }, refreshSecret, { expiresIn: '7d' });
  return { access, refresh };
}

export function requireAuth(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const payload = jwt.verify(h.slice(7), secret) as { sub: string; username: string; role: Role };
      (req as unknown as { user: typeof payload }).user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'invalid token' });
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as unknown as { user?: { role: Role } }).user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
