export type SpecialistRole =
  | "frontend-ux"
  | "backend-api"
  | "database"
  | "devops-deployment"
  | "security-auth"
  | "payments-growth"
  | "accessibility";

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
  "backend-api": "Review API boundaries, server behavior, data contracts, error handling, concurrency, and service architecture. Prefer minimal interface-safe fixes with explicit integration validation.",
  database: "Review schema, migrations, query behavior, RLS/data isolation, indexes, idempotency, and rollback safety. Require disposable or otherwise isolated migration validation before treating database changes as production-ready.",
  "devops-deployment": "Review CI, build, deployment, runtime configuration, preview environments, observability signals, and rollback mechanics. Prefer reproducible automated validation over deployment assumptions.",
  "security-auth": "Review authentication, authorization, secret handling, permission boundaries, input validation, and security-sensitive data flows. Never weaken controls to simplify implementation.",
  "payments-growth": "Review monetization-critical flows such as pricing, checkout, subscriptions, onboarding, activation, distribution, and measurable conversion surfaces. Do not invent revenue or demand; prioritize testable commercial readiness.",
  accessibility: "Review keyboard, screen-reader, semantic, contrast, touch-target, focus, motion, and responsive accessibility risks in user-facing flows. Require concrete acceptance checks rather than cosmetic claims.",
};

const KEYWORDS: Record<SpecialistRole, string[]> = {
  "frontend-ux": ["frontend", "react", "next", "vite", "ui", "ux", "mobile", "screen", "component", "dashboard", "navigation", "render", "css"],
  "backend-api": ["backend", "api", "server", "express", "node", "worker", "webhook", "queue", "service", "endpoint", "lambda", "function"],
  database: ["database", "postgres", "supabase", "sql", "migration", "schema", "rls", "prisma", "drizzle", "storage", "table"],
  "devops-deployment": ["deploy", "deployment", "ci", "github actions", "docker", "vercel", "render", "cloud run", "firebase", "runtime", "build", "sentry"],
  "security-auth": ["security", "auth", "oauth", "login", "permission", "secret", "token", "jwt", "rls", "credential", "session", "cors"],
  "payments-growth": ["stripe", "payment", "billing", "subscription", "pricing", "checkout", "revenue", "seo", "growth", "marketing", "onboarding", "conversion"],
  accessibility: ["accessibility", "a11y", "screen reader", "keyboard", "aria", "contrast", "focus", "touch target", "wcag"],
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

export function selectSpecialists(input: SpecialistSelectionInput, maxSpecialists = 3): SpecialistSelection[] {
  const text = corpus(input);
  const scores = (Object.keys(KEYWORDS) as SpecialistRole[]).map((role) => {
    const matches = KEYWORDS[role].filter((keyword) => text.includes(keyword));
    let score = matches.length * 18;
    if (role === "frontend-ux" && /typescript|javascript/.test(String(input.language || "").toLowerCase())) score += 8;
    if (role === "backend-api" && /python|go|rust|java|typescript|javascript/.test(String(input.language || "").toLowerCase())) score += 5;
    if (role === "security-auth" && matches.some((match) => ["auth", "oauth", "permission", "secret", "token", "credential", "rls"].includes(match))) score += 12;
    if (role === "database" && matches.some((match) => ["migration", "schema", "rls", "supabase", "database"].includes(match))) score += 10;
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
