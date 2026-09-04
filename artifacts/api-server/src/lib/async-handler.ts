import type { Request, Response, NextFunction, RequestHandler } from "express";

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async Express route handler and forwards any thrown errors to next().
 * Also handles ZodError and attaches a 400 status, and sets a 404 status for
 * errors with an explicit .status property.
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((err: unknown) => {
      if (err instanceof Error) {
        const statusErr = err as Error & { status?: number; code?: string; details?: unknown };
        if (statusErr.status) {
          res.status(statusErr.status).json({
            error: err.message,
            ...(statusErr.code ? { code: statusErr.code } : {}),
            // `details` carries caller-attached, JSON-safe structured data
            // (e.g. suggestedScopes on a "repo too large" 409). It is only
            // ever set by our own code on a deliberately-thrown error, never
            // derived from raw upstream/provider bodies, so it's safe to
            // pass straight through to the client.
            ...(statusErr.details !== undefined ? { details: statusErr.details } : {}),
          });
          return;
        }
        // ZodError: validation failure → 400
        if (statusErr.name === "ZodError") {
          res.status(400).json({ error: "Validation error", details: statusErr.message });
          return;
        }
      }
      next(err);
    });
  };
}
