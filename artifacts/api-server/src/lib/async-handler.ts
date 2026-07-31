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
        const statusErr = err as Error & { status?: number; code?: string };
        if (statusErr.status) {
          res.status(statusErr.status).json({ error: err.message });
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
