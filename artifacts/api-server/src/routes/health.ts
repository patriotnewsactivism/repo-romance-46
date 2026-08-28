import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getSentryStatus } from "../instrument";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    observability: { sentry: getSentryStatus() },
  });
  res.json(data);
});

export default router;
