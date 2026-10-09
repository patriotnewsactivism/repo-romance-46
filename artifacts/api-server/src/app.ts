import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import aiSettingsRolloutRouter from "./routes/ai-settings-rollout";
import { logger } from "./lib/logger";
import { config } from "./lib/config";
import { flushSentry, installExpressErrorHandler } from "./instrument";
import { runInBackground } from "./lib/background-tasks";
import { apiCors, installApiRateLimits } from "./middleware/api-rate-limits";

const app: Express = express();

// Behind Railway's load balancer the client IP arrives in X-Forwarded-For;
// without this the rate limiter would bucket every request under one proxy IP.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));

/**
 * `cors()` with no arguments reflects any Origin, which let any website call
 * this API with a user's session. Origins must now be listed explicitly;
 * with none configured the API accepts only same-origin (no Origin header)
 * requests, which is the correct default when the SPA is served beside it.
 */
app.use(apiCors(config.corsAllowedOrigins));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Reads share the global quota; only writes consume the tighter expensive
// quota. Client telemetry retains its own budget. All remain before auth.
installApiRateLimits(app, { logger });

// Keep AI settings usable during a rolling Supabase migration. These focused
// handlers run before the main router and fall back to the encrypted legacy
// preference column only when provider-scoped schema/RPCs are not available.
app.use("/api", aiSettingsRolloutRouter);
app.use("/api", router);

// Sentry's Express handler must sit after routes and before our final handler.
// It records unexpected failures and then forwards them so the API still owns
// the public, non-sensitive error response.
installExpressErrorHandler(app);

// Centralized error handler — thrown errors (via asyncHandler) land here.
// Attach `.status` to control the HTTP status. A trusted internal subsystem may
// also attach a pre-sanitized `.publicMessage`; raw upstream/provider bodies are
// still kept out of the client response.
app.use((err: Error & { status?: number; code?: string; publicMessage?: string; details?: unknown }, req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) {
    req.log?.error({ err }, "Unhandled error");
    runInBackground(flushSentry(), "sentry-flush");
  }

  const message = err.publicMessage || (status >= 500 ? "Internal server error" : err.message || "Request failed");
  res.status(status).json({
    error: message,
    ...(err.code ? { code: err.code } : {}),
    ...(err.details !== undefined ? { details: err.details } : {}),
  });
});

export default app;
