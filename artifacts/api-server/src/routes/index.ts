import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import preferencesRouter from "./preferences";
import githubRouter from "./github";
import publicRouter from "./public";
import repoFinisherRouter from "./repo-finisher";
import repoFinisherRunsRouter from "./repo-finisher-runs";
import valuationRouter from "./valuation";
import vibeToolsRouter from "./vibe-tools";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysisRouter);
router.use(preferencesRouter);
router.use(githubRouter);
router.use(publicRouter);
router.use(repoFinisherRouter);
router.use(repoFinisherRunsRouter);
router.use(valuationRouter);
router.use(vibeToolsRouter);

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
