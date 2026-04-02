import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const message = err instanceof Error ? err.message : 'Internal server error';
  const status = (err as { status?: number })?.status || 500;
  if (status >= 500) logger.error('Unhandled error', { err });
  if (!res.headersSent) {
    res.status(status).json({
      error: message,
      code: status === 409 ? 'conflict' : status >= 500 ? 'internal_error' : 'error',
    });
  }
}
