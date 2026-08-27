from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# RepoFinisher engine: encrypted GitHub credentials must always pass through the central resolver.
replace_once(
    "artifacts/api-server/src/lib/repo-finisher-engine.ts",
    'import { loadAiCredential } from "./credentials";',
    'import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "./credentials";',
)
replace_once(
    "artifacts/api-server/src/lib/repo-finisher-engine.ts",
    """async function getConnection(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("github_connections")
    .select("github_login, access_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read GitHub connection: ${error.message}`);
  if (!data?.access_token) throw Object.assign(new Error("Connect GitHub first."), { status: 400 });
  return data as { github_login: string; access_token: string };
}

""",
    "",
)
replace_once(
    "artifacts/api-server/src/lib/repo-finisher-engine.ts",
    """  const connection = await getConnection(supabase, userId);
  const token = connection.access_token;""",
    """  const connection = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const token = connection.token;""",
)

# Legacy direct finish route had the same encrypted-token bypass.
replace_once(
    "artifacts/api-server/src/routes/repo-finisher.ts",
    'import { loadAiCredential } from "../lib/credentials";',
    'import { loadAiCredential, loadGithubCredential, requireGithubCredential } from "../lib/credentials";',
)
replace_once(
    "artifacts/api-server/src/routes/repo-finisher.ts",
    """  const { data: conn } = await supabase
    .from("github_connections")
    .select("github_login, access_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) throw Object.assign(new Error("Connect GitHub first."), { status: 400 });

  const token = conn.access_token;""",
    """  const github = requireGithubCredential(await loadGithubCredential(supabase, userId));
  const token = github.token;""",
)

# Only app.ts should own the terminal API error handler. The router-level handler leaked 5xx details.
Path("artifacts/api-server/src/routes/index.ts").write_text("""import { Router, type IRouter } from "express";
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
""")

# Minimal, secret-safe Sentry instrumentation. It is a no-op until SENTRY_DSN exists.
Path("artifacts/api-server/src/instrument.ts").write_text("""import * as Sentry from "@sentry/node";

const dsn = process.env["SENTRY_DSN"]?.trim() || "";
const rawSampleRate = Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.05");
const tracesSampleRate = Number.isFinite(rawSampleRate)
  ? Math.max(0, Math.min(1, rawSampleRate))
  : 0.05;

export const sentryEnabled = Boolean(dsn);

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment:
      process.env["SENTRY_ENVIRONMENT"] ||
      process.env["VERCEL_ENV"] ||
      process.env["NODE_ENV"] ||
      "development",
    release: process.env["SENTRY_RELEASE"] || process.env["VERCEL_GIT_COMMIT_SHA"] || undefined,
    sendDefaultPii: false,
    tracesSampleRate,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          for (const key of Object.keys(event.request.headers)) {
            if (/authorization|cookie|token|api[-_]?key|secret/i.test(key)) {
              delete event.request.headers[key];
            }
          }
        }
      }
      return event;
    },
  });
}

interface CaptureContext {
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
}

const SECRET_FIELD = /authorization|cookie|token|api[-_]?key|secret|password|credential/i;

export function captureException(error: unknown, context: CaptureContext = {}): void {
  if (!sentryEnabled) return;

  const normalized = error instanceof Error ? error : new Error(String(error));
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value !== null && value !== undefined && !SECRET_FIELD.test(key)) {
        scope.setTag(key, String(value).slice(0, 200));
      }
    }

    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context.extra ?? {})) {
      if (!SECRET_FIELD.test(key)) extras[key] = value;
    }
    if (Object.keys(extras).length > 0) scope.setExtras(extras);

    Sentry.captureException(normalized);
  });
}

export async function flushSentry(timeoutMs = 1500): Promise<boolean> {
  if (!sentryEnabled) return true;
  return Sentry.flush(timeoutMs);
}
""")

# Initialize Sentry before app/module evaluation in both deployment entrypoints.
replace_once(
    "artifacts/api-server/src/vercel.ts",
    """// Vercel entrypoint: export the Express request handler without opening a port.
import app from "./app";""",
    """// Vercel entrypoint: export the Express request handler without opening a port.
import "./instrument";
import app from "./app";""",
)
replace_once(
    "artifacts/api-server/src/index.ts",
    'import app from "./app";',
    'import "./instrument";\nimport app from "./app";',
)

# Capture all centralized 5xx errors without exposing bodies/secrets.
replace_once(
    "artifacts/api-server/src/app.ts",
    'import { config } from "./lib/config";',
    'import { config } from "./lib/config";\nimport { captureException, flushSentry } from "./instrument";\nimport { waitUntil } from "@vercel/functions";',
)
replace_once(
    "artifacts/api-server/src/app.ts",
    """  const status = err.status ?? 500;
  if (status >= 500) req.log?.error({ err }, "Unhandled error");
  // Internal failures must not leak stack details or upstream messages.
  res.status(status).json({ error: status >= 500 ? "Internal server error" : err.message || "Request failed" });""",
    """  const status = err.status ?? 500;
  if (status >= 500) {
    req.log?.error({ err }, "Unhandled error");
    captureException(err, {
      tags: { route: req.path, method: req.method, status },
    });
    if (process.env["VERCEL"]) waitUntil(flushSentry());
  }
  // Internal failures must not leak stack details or upstream messages.
  res.status(status).json({ error: status >= 500 ? "Internal server error" : err.message || "Request failed" });""",
)

# Background analysis errors never reach Express, so capture them explicitly.
replace_once(
    "artifacts/api-server/src/routes/analysis.ts",
    'import { callAI } from "../lib/ai-provider";',
    'import { callAI } from "../lib/ai-provider";\nimport { captureException, flushSentry } from "../instrument";',
)
replace_once(
    "artifacts/api-server/src/routes/analysis.ts",
    """    const msg = e instanceof Error ? e.message : "Analysis failed";
    console.error(`[analysis ${analysisId}] failed:`, msg);
    await supabase.from("analyses").update({ status: "failed", error: msg, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", analysisId);""",
    """    const msg = e instanceof Error ? e.message : "Analysis failed";
    console.error(`[analysis ${analysisId}] failed:`, msg);
    captureException(e, {
      tags: { subsystem: "analysis", analysis_id: analysisId },
      extra: { message: msg },
    });
    await supabase.from("analyses").update({ status: "failed", error: msg, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", analysisId);
    await flushSentry();""",
)
replace_once(
    "artifacts/api-server/src/routes/analysis.ts",
    """    console.error(`[analysis ${analysisId}] unexpected background error:`, e);
    const msg = e instanceof Error ? e.message : "Analysis worker stopped unexpectedly";""",
    """    console.error(`[analysis ${analysisId}] unexpected background error:`, e);
    const msg = e instanceof Error ? e.message : "Analysis worker stopped unexpectedly";
    captureException(e, {
      tags: { subsystem: "analysis-worker", analysis_id: analysisId },
      extra: { message: msg },
    });""",
)
replace_once(
    "artifacts/api-server/src/routes/analysis.ts",
    """      .update({ status: "failed", error: msg, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", analysisId);
  });""",
    """      .update({ status: "failed", error: msg, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", analysisId);
    await flushSentry();
  });""",
)
