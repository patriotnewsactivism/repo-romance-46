import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import preferencesRouter from "./preferences";
import githubRouter from "./github";
import publicRouter from "./public";
import repoFinisherRunsRouter from "./repo-finisher-runs";
import valuationRouter from "./valuation";
import vibeToolsRouter from "./vibe-tools";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysisRouter);
router.use(preferencesRouter);
router.use(githubRouter);
router.use(publicRouter);
router.use(repoFinisherRunsRouter);
router.use(valuationRouter);
router.use(vibeToolsRouter);

export default router;
