import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import preferencesRouter from "./preferences";
import githubRouter from "./github";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysisRouter);
router.use(preferencesRouter);
router.use(githubRouter);

// Global error handler
router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error) {
    const status = (err as Error & { status?: number }).status ?? 500;
    if (status >= 500) {
      console.error("[error]", err.message, err.stack);
    }
    res.status(status).json({ error: err.message });
  } else {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
