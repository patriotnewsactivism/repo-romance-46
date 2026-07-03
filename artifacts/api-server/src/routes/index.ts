import { Router, type IRouter } from "express";
import healthRouter from "./health";
import githubRouter from "./github";
import preferencesRouter from "./preferences";
import analysisRouter from "./analysis";
import repoFinisherRouter from "./repo-finisher";
import valuationRouter from "./valuation";
import vibeToolsRouter from "./vibe-tools";
import publicRouter from "./public";

const router: IRouter = Router();

router.use(healthRouter);
router.use(publicRouter);
router.use(githubRouter);
router.use(preferencesRouter);
router.use(analysisRouter);
router.use(repoFinisherRouter);
router.use(valuationRouter);
router.use(vibeToolsRouter);

export default router;
