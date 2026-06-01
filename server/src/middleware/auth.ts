import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { HttpError } from './error.js';

export type AuthedUser = {
  id: string;
  email: string;
};

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw new HttpError(401, 'Missing bearer token');

  try {
    const payload = jwt.verify(match[1], env.JWT_SECRET) as AuthedUser;
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
}

export function signToken(user: AuthedUser): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: '30d' });
}
