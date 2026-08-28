import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import preferencesRouter from "./preferences";
import githubRouter from "./github";
import publicRouter from "./public";
import repoFinisherRunsRouter from "./repo-finisher-runs";
import agenticFinisherRouter from "./agentic-finisher";
import portfolioFinisherRouter from "./portfolio-finisher";
import selfHealingCiRouter from "./self-healing-ci";
import valuationRouter from "./valuation";
import investmentIntelligenceRouter from "./investment-intelligence";
import portfolioIntelligenceRouter from "./portfolio-intelligence";
import tieredIntelligenceRouter from "./tiered-intelligence";
import vibeToolsRouter from "./vibe-tools";
import observabilityRouter from "./observability";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysisRouter);
router.use(preferencesRouter);
router.use(githubRouter);
router.use(publicRouter);
router.use(repoFinisherRunsRouter);
router.use(agenticFinisherRouter);
router.use(portfolioFinisherRouter);
router.use(selfHealingCiRouter);
router.use(valuationRouter);
router.use(tieredIntelligenceRouter);
router.use(portfolioIntelligenceRouter);
router.use(investmentIntelligenceRouter);
router.use(vibeToolsRouter);
router.use(observabilityRouter);

export default router;
