import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { config } from "./lib/config";
import { flushSentry, installExpressErrorHandler } from "./instrument";
import { waitUntil } from "@vercel/functions";

const app: Express = express();

// Behind Cloud Run / a load balancer the client IP arrives in X-Forwarded-For;
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
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.corsAllowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — slow down." },
});

/**
 * Routes that spend money or write to someone's repository get a much tighter
 * budget than reads. Read-only GET/HEAD/OPTIONS requests are explicitly skipped
 * so status polling cannot consume the same quota as AI runs and repo writes.
 */
const expensiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS",
  message: { error: "Too many analysis or repository-write requests — try again in a minute." },
});

// A crashing browser can emit the same exception repeatedly. Keep telemetry
// useful without allowing a client-side error loop to flood Sentry or the API.
const telemetryLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many client error reports — slow down." },
});

app.use("/api", globalLimiter);
app.post("/api/preferences/ai-test", expensiveLimiter);
app.post("/api/observability/client-error", telemetryLimiter);
app.use(
  ["/api/analysis", "/api/repo-finisher", "/api/vibe-tools", "/api/valuation", "/api/investment-intelligence"],
  expensiveLimiter,
);

app.use("/api", router);

// Sentry's Express handler must sit after routes and before our final handler.
// It records unexpected failures and then forwards them so the API still owns
// the public, non-sensitive error response.
installExpressErrorHandler(app);

// Centralized error handler — thrown errors (via asyncHandler) land here.
// Attach `.status` to an Error to control the HTTP status code.
app.use((err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) {
    req.log?.error({ err }, "Unhandled error");
    if (process.env["VERCEL"]) waitUntil(flushSentry());
  }
  // Internal failures must not leak stack details or upstream messages.
  res.status(status).json({ error: status >= 500 ? "Internal server error" : err.message || "Request failed" });
});

export default app;
