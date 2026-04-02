import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './auth.middleware.js';
import type { UserRole } from '../types/auth.types.js';

export function roleMiddleware(...allowed: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', code: 'wrong_role' });
    }
    next();
  };
}
