/**
 * Internal API Versioning middleware.
 */
import { Request, Response, NextFunction } from 'express';

const CURRENT = process.env.API_CURRENT_VERSION || 'v1';
const ENABLED = process.env.API_VERSIONING_ENABLED === 'true';

export function apiVersioning(req: Request, res: Response, next: NextFunction) {
  if (!ENABLED) return next();

  const requested = (req.headers['accept-version'] as string) || (req.query.apiVersion as string) || CURRENT;

  if (requested !== CURRENT) {
    res.setHeader('X-API-Version-Supported', CURRENT);
    // For now soft-accept; harden later with 406 if needed
  }

  res.setHeader('X-API-Version', CURRENT);
  (req as any).apiVersion = requested;
  next();
}
