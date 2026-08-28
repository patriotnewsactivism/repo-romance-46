export type SpecialistRole =
  | "frontend-ux"
  | "backend-api"
  | "database"
  | "devops-deployment"
  | "security-auth"
  | "payments-growth"
  | "accessibility"
  | "mobile-native"
  | "data-ai"
  | "qa-reliability"
  | "observability";

export interface SpecialistSelectionInput {
  repo: string;
  description?: string | null;
  language?: string | null;
  topics?: string[];
  requestedNextSteps?: string[];
  analysisText?: string[];
}

export interface SpecialistSelection {
  role: SpecialistRole;
  score: number;
  reason: string;
  objective: string;
}

const OBJECTIVES: Record<SpecialistRole, string> = {
  "frontend-ux": "Review the user-facing experience, responsive behavior, state handling, navigation, accessibility-adjacent UX, and frontend architecture. Propose only changes that materially improve a verified product flow.",
  "backend-api": "Review API boundaries, server behavior, data contracts, error handling, concurrency, idempotency, and service architecture. Prefer minimal interface-safe fixes with explicit integration validation.",
  database: "Review schema, migrations, query behavior, RLS/data isolation, indexes, idempotency, backup/restore assumptions, and rollback safety. Require disposable or otherwise isolated migration validation before treating database changes as production-ready.",
  "devops-deployment": "Review CI, build, deployment, runtime configuration, preview environments, infrastructure boundaries, rollback mechanics, and release reproducibility. Prefer automated evidence over deployment assumptions.",
  "security-auth": "Review authentication, authorization, secret handling, permission boundaries, input validation, abuse surfaces, and security-sensitive data flows. Never weaken controls to simplify implementation.",
  "payments-growth": "Review monetization-critical flows such as pricing, checkout, subscriptions, onboarding, activation, distribution, and measurable conversion surfaces. Do not invent revenue or demand; prioritize testable commercial readiness.",
  accessibility: "Review keyboard, screen-reader, semantic, contrast, touch-target, focus, motion, and responsive accessibility risks in user-facing flows. Require concrete acceptance checks rather than cosmetic claims.",
  "mobile-native": "Review mobile/native lifecycle, platform permissions, offline/retry behavior, deep links, push/background behavior, device constraints, store-build configuration, and touch-first interaction quality.",
  "data-ai": "Review AI/data pipelines, model/provider boundaries, retrieval quality, prompt/evaluation design, dataset assumptions, structured-output handling, cost/latency, fallback behavior, and measurable quality evidence. Do not treat model output as ground truth without validation.",
  "qa-reliability": "Review the acceptance surface across unit, integration, contract, end-to-end, regression, concurrency, retry, and failure-injection tests. Identify where the system can report success without proving the actual user journey.",
  observability: "Review runtime logs, traces, metrics, alerts, error boundaries, correlation IDs, health/readiness signals, release diagnostics, and whether operators can detect and localize production failures without exposing secrets.",
};

const KEYWORDS: Record<SpecialistRole, string[]> = {
  "frontend-ux": ["frontend", "react", "next", "vite", "ui", "ux", "web", "screen", "component", "dashboard", "navigation", "render", "css"],
  // Avoid generic nouns such as "service" here: a product description can use
  // that word without providing evidence that backend/API specialist work exists.
  "backend-api": ["backend", "api", "server", "express", "node", "worker", "webhook", "queue", "endpoint", "lambda", "function", "idempotency"],
  database: ["database", "postgres", "supabase", "sql", "migration", "schema", "rls", "prisma", "drizzle", "storage", "table", "index"],
  // "build" alone is equally generic (for example "build metadata"). Require
  // actual CI/deployment/runtime/infrastructure evidence instead.
  "devops-deployment": ["deploy", "deployment", "ci", "github actions", "docker", "vercel", "render", "cloud run", "firebase", "runtime", "release", "infrastructure"],
  "security-auth": ["security", "auth", "oauth", "login", "permission", "secret", "token", "jwt", "rls", "credential", "session", "cors", "authorization", "authentication"],
  "payments-growth": ["stripe", "payment", "billing", "subscription", "pricing", "checkout", "revenue", "seo", "growth", "marketing", "onboarding", "conversion"],
  accessibility: ["accessibility", "a11y", "screen reader", "keyboard", "aria", "contrast", "focus", "touch target", "wcag"],
  "mobile-native": ["mobile", "android", "ios", "react native", "flutter", "swift", "kotlin", "expo", "deep link", "push notification", "offline"],
  "data-ai": ["ai", "llm", "openai", "anthropic", "gemini", "model", "prompt", "rag", "retrieval", "embedding", "vector", "dataset", "inference", "evaluation"],
  "qa-reliability": ["test", "testing", "e2e", "playwright", "cypress", "vitest", "jest", "pytest", "regression", "reliability", "retry", "failure", "contract test"],
  observability: ["observability", "sentry", "logging", "logs", "metrics", "tracing", "trace", "telemetry", "alert", "health check", "readiness", "monitoring"],
};

function corpus(input: SpecialistSelectionInput) {
  return [
    input.repo,
    input.description,
    input.language,
    ...(input.topics ?? []),
    ...(input.requestedNextSteps ?? []),
    ...(input.analysisText ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function matchesKeyword(text: string, keyword: string) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text);
}

export function selectSpecialists(input: SpecialistSelectionInput, maxSpecialists = 3): SpecialistSelection[] {
  const text = corpus(input);
  const scores = (Object.keys(KEYWORDS) as SpecialistRole[]).map((role) => {
    const matches = KEYWORDS[role].filter((keyword) => matchesKeyword(text, keyword));
    let score = matches.length * 18;
    const language = String(input.language || "").toLowerCase();
    if (role === "frontend-ux" && /typescript|javascript/.test(language)) score += 8;
    if (role === "backend-api" && /python|go|rust|java|typescript|javascript/.test(language)) score += 5;
    if (role === "mobile-native" && /swift|kotlin|dart/.test(language)) score += 18;
    if (role === "data-ai" && /python/.test(language) && matches.length) score += 8;
    if (role === "security-auth" && matches.some((match) => ["auth", "oauth", "permission", "secret", "token", "credential", "rls", "authorization", "authentication"].includes(match))) score += 12;
    if (role === "database" && matches.some((match) => ["migration", "schema", "rls", "supabase", "database", "postgres"].includes(match))) score += 10;
    if (role === "qa-reliability" && matches.some((match) => ["e2e", "playwright", "cypress", "regression", "contract test"].includes(match))) score += 10;
    if (role === "observability" && matches.some((match) => ["sentry", "observability", "tracing", "telemetry", "monitoring"].includes(match))) score += 10;
    return {
      role,
      score: Math.min(100, score),
      reason: matches.length ? `Matched repository evidence: ${matches.slice(0, 5).join(", ")}.` : "No strong specialist signal.",
      objective: OBJECTIVES[role],
    };
  });

  return scores
    .filter((candidate) => candidate.score >= 18)
    .sort((a, b) => b.score - a.score || a.role.localeCompare(b.role))
    .slice(0, Math.max(0, Math.min(3, maxSpecialists)));
}

export function specialistObjective(role: SpecialistRole): string {
  return OBJECTIVES[role];
}
