import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthUser, JwtPayload } from '../types/auth.types.js';
import { pool } from '../db/pool.js';

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-minimum-32-characters-long';

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as jwt.SignOptions);
}

export function signRefreshToken(payload: { sub: string }): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d',
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export async function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', code: 'no_token' });
  }
  const token = header.slice(7);
  try {
    const decoded = verifyToken(token);
    const user: AuthUser = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      patientId: decoded.patientId,
      doctorId: decoded.doctorId,
    };
    if (!user.patientId && user.role === 'patient') {
      const pr = await pool.query(`SELECT id FROM patients WHERE user_id = $1`, [user.id]);
      if (pr.rows[0]) user.patientId = pr.rows[0].id;
    }
    if (!user.doctorId && user.role === 'doctor') {
      const dr = await pool.query(`SELECT id FROM doctors WHERE user_id = $1`, [user.id]);
      if (dr.rows[0]) user.doctorId = dr.rows[0].id;
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'invalid_token' });
  }
}

/** Optional auth — sets user if Bearer present */
export async function optionalAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const token = header.slice(7);
  try {
    const decoded = verifyToken(token) as JwtPayload;
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      patientId: decoded.patientId,
      doctorId: decoded.doctorId,
    };
  } catch {
    /* ignore */
  }
  next();
}
