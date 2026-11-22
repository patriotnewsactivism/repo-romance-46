/**
 * Builder-AI prompt composition.
 *
 * The product question is not "what should I improve?" — any model can list
 * ten generic ideas. It is "what exact prompt do I hand a builder model so it
 * comes back finished instead of 80% done?"
 *
 * So every suggestion here carries its own self-contained builder prompt, and
 * the master prompt is a *finality contract*: scope, ordered work, acceptance
 * criteria, verification gates, stop conditions, and a required evidence
 * report. The prompt quality rubric at the bottom is an executable check that
 * the composed prompt actually contains each of those clauses — not a vibe.
 */

import type { RepoBusinessReport, RepoSignalInput } from "./repo-business-engine";

export const BUILDER_PROMPT_VERSION = "builder-finality-prompt-v1";

export type SuggestionCategory =
  | "correctness"
  | "testing"
  | "security"
  | "deploy"
  | "docs"
  | "ux"
  | "performance"
  | "observability"
  | "monetization"
  | "data"
  | "compliance"
  | "growth";

export interface ImprovementSuggestion {
  id: string;
  category: SuggestionCategory;
  title: string;
  problem: string;
  action: string;
  why: string;
  /** 1–5. How much finishing this moves the repository toward done. */
  impact: number;
  /** 1–5. Engineering effort. */
  effort: number;
  /** 0–100. Impact relative to effort. */
  priority: number;
  acceptance: string[];
  evidence: string[];
  /** A standalone prompt a builder model can execute for this one gap. */
  builderPrompt: string;
}

interface RuleContext {
  input: RepoSignalInput;
  report: RepoBusinessReport;
}

interface RuleDefinition {
  id: string;
  category: SuggestionCategory;
  impact: number;
  effort: number;
  when: (ctx: RuleContext) => boolean;
  build: (ctx: RuleContext) => {
    title: string;
    problem: string;
    action: string;
    why: string;
    acceptance: string[];
    evidence: string[];
  };
}

function isFalse(value: boolean | null | undefined): boolean {
  return value === false;
}

function isTrue(value: boolean | null | undefined): boolean {
  return value === true;
}

const RULES: RuleDefinition[] = [
  {
    id: "tests-missing",
    category: "testing",
    impact: 5,
    effort: 3,
    when: (ctx) => isFalse(ctx.input.hasTests),
    build: () => ({
      title: "Add a real automated test suite around the critical path",
      problem: "No automated tests exist, so no completion claim can be verified and every change is a regression risk.",
      action:
        "Add the repository's native test runner, then cover the primary user journey, the error paths, and one regression test per known bug.",
      why: "Tests are the evidence gate for every other score. Without them the grade is capped at 64 regardless of code quality.",
      acceptance: [
        "Test command exists and is documented in the README.",
        "The primary user journey has at least one end-to-end or integration test.",
        "A deliberately broken assertion fails the suite (the suite is not vacuous).",
        "CI runs the suite on pull requests.",
      ],
      evidence: ["No test files or test script were detected in the repository tree."],
    }),
  },
  {
    id: "ci-missing",
    category: "deploy",
    impact: 5,
    effort: 2,
    when: (ctx) => isFalse(ctx.input.hasCi),
    build: () => ({
      title: "Add CI that proves install, typecheck, test, and build",
      problem: "There is no CI workflow, so the repository cannot demonstrate that it builds or passes anything.",
      action: "Add one GitHub Actions workflow that runs install → typecheck → test → build on pull requests and the default branch.",
      why: "CI is the cheapest credible readiness signal and the only way an automated finisher can validate its own work.",
      acceptance: [
        "A workflow file exists under .github/workflows.",
        "It runs on pull_request and on the default branch.",
        "A red build is visible in the PR checks.",
        "The workflow uses the repository's pinned package manager and lockfile.",
      ],
      evidence: ["No GitHub Actions workflow was detected."],
    }),
  },
  {
    id: "deploy-missing",
    category: "deploy",
    impact: 5,
    effort: 3,
    when: (ctx) => isFalse(ctx.input.hasDocker) && isFalse(ctx.input.hasDeployConfig),
    build: () => ({
      title: "Make the app deployable with one documented command",
      problem: "No container or platform deploy configuration exists, so the app cannot be run anywhere except a developer laptop.",
      action: "Add a production Dockerfile or the platform's deploy config, an env template, and a documented start command.",
      why: "A repository that cannot be deployed cannot be sold, operated, or honestly called finished.",
      acceptance: [
        "A fresh clone can be built and started from the README alone.",
        "The build does not require secrets at build time.",
        "The running app answers a health endpoint or serves its landing route.",
      ],
      evidence: ["No Dockerfile, compose file, or deploy config was detected."],
    }),
  },
  {
    id: "readme-missing",
    category: "docs",
    impact: 4,
    effort: 1,
    when: (ctx) => isFalse(ctx.input.hasReadme),
    build: () => ({
      title: "Write the README an operator actually needs",
      problem: "There is no README, so setup, architecture, and verification are tribal knowledge.",
      action: "Write a README covering what it does, prerequisites, setup, env vars, run, test, build, deploy, and how to verify the critical path.",
      why: "Documentation is part of the product. It also reduces perceived remaining work, which directly affects valuation.",
      acceptance: [
        "A new engineer can run the app from the README without asking a question.",
        "Every required environment variable is listed with a safe example value.",
        "The verification steps are copy-pasteable commands.",
      ],
      evidence: ["No README file was detected."],
    }),
  },
  {
    id: "env-example-missing",
    category: "security",
    impact: 4,
    effort: 1,
    when: (ctx) => isFalse(ctx.input.hasEnvExample),
    build: () => ({
      title: "Add a safe environment template",
      problem: "There is no .env.example, so operators guess configuration and often paste real secrets into tracked files.",
      action: "Add .env.example with every variable name, a safe placeholder, and a comment describing where the real value comes from.",
      why: "An env template is both an onboarding document and a secret-hygiene control.",
      acceptance: [
        ".env.example contains no real credentials.",
        "Every variable read by the code appears in the template.",
        ".gitignore excludes .env files.",
      ],
      evidence: ["No .env.example or .env.sample was detected."],
    }),
  },
  {
    id: "license-missing",
    category: "compliance",
    impact: 2,
    effort: 1,
    when: (ctx) => isFalse(ctx.input.hasLicense),
    build: () => ({
      title: "Add a license",
      problem: "No license file exists, so the repository is legally ambiguous to use, contribute to, or acquire.",
      action: "Add the intended license and reference it from the README.",
      why: "A buyer or contributor cannot safely adopt an unlicensed repository.",
      acceptance: ["A LICENSE file exists.", "The README names the license."],
      evidence: ["No license file was detected."],
    }),
  },
  {
    id: "auth-hardening",
    category: "security",
    impact: 5,
    effort: 3,
    when: (ctx) => isTrue(ctx.input.hasAuthSignals),
    build: () => ({
      title: "Prove the auth boundaries, not just the login screen",
      problem: "Authentication signals exist, but there is no evidence that authorization boundaries are enforced server-side.",
      action:
        "Add tests that prove unauthenticated requests are rejected, cross-user reads fail, and privileged actions require the right role.",
      why: "Auth bugs are the highest-severity defect class in any product with accounts, and the easiest to miss from the UI.",
      acceptance: [
        "An unauthenticated request to every protected route returns 401/403.",
        "A user cannot read or mutate another user's record.",
        "Token/session expiry and revocation are handled without crashing.",
      ],
      evidence: ["Auth-related files were detected; boundary tests were not."],
    }),
  },
  {
    id: "payments-hardening",
    category: "monetization",
    impact: 5,
    effort: 4,
    when: (ctx) => isTrue(ctx.input.hasPaymentsSignals),
    build: () => ({
      title: "Harden billing before anyone can pay",
      problem: "Payment code exists, but checkout, webhook, and entitlement behavior are not verified.",
      action:
        "Add test-mode coverage for checkout creation, webhook signature verification, idempotent webhook handling, and entitlement grants/revocations.",
      why: "Billing defects are the most expensive kind: they either lose money or give product away.",
      acceptance: [
        "Checkout runs in test mode end to end.",
        "A replayed webhook does not double-grant entitlements.",
        "A failed payment revokes access correctly.",
        "No live keys exist in the repository.",
      ],
      evidence: ["Payment/billing files were detected; no billing verification was found."],
    }),
  },
  {
    id: "observability-missing",
    category: "observability",
    impact: 4,
    effort: 2,
    when: (ctx) => isFalse(ctx.input.hasObservabilitySignals),
    build: () => ({
      title: "Make failures visible in production",
      problem: "No error reporting or structured logging was detected, so production failures will be invisible.",
      action: "Add structured request logging, an error reporter (Sentry or equivalent), and a health endpoint that reflects real dependencies.",
      why: "An unobservable app cannot be operated, and operators discount repositories that cannot be supported.",
      acceptance: [
        "Unhandled errors are reported with request context.",
        "The health endpoint fails when a critical dependency is down.",
        "Logs never contain tokens, keys, or personal data.",
      ],
      evidence: ["No observability or telemetry files were detected."],
    }),
  },
  {
    id: "frontend-error-states",
    category: "ux",
    impact: 4,
    effort: 2,
    when: (ctx) => isTrue(ctx.input.hasFrontendSignals),
    build: () => ({
      title: "Replace dead ends with real loading, empty, and error states",
      problem: "A UI without designed failure states shows blank screens and fake success when the API misbehaves.",
      action: "Audit every data-driven screen and add explicit loading, empty, error, and retry states with actionable copy.",
      why: "Fake-success and dead-end states are the most common reason a demo-ready app still feels unfinished.",
      acceptance: [
        "Every async screen has loading, empty, error, and retry states.",
        "No spinner runs forever on failure.",
        "Error copy tells the user what to do next.",
      ],
      evidence: ["Frontend files were detected."],
    }),
  },
  {
    id: "frontend-responsive",
    category: "ux",
    impact: 3,
    effort: 2,
    when: (ctx) => isTrue(ctx.input.hasFrontendSignals),
    build: () => ({
      title: "Verify the mobile breakpoint end to end",
      problem: "The UI has not been verified at a phone width, where most first sessions happen.",
      action: "Walk every primary screen at 390px and 768px, fix overflow and unreachable controls, and capture evidence.",
      why: "A desktop-only product is not launch-ready and loses the majority of casual traffic.",
      acceptance: [
        "No horizontal scroll at 390px.",
        "Primary actions are reachable without pinch-zoom.",
        "Tables and charts reflow instead of clipping.",
      ],
      evidence: ["Frontend files were detected; no responsive evidence was found."],
    }),
  },
  {
    id: "frontend-accessibility",
    category: "ux",
    impact: 3,
    effort: 2,
    when: (ctx) => isTrue(ctx.input.hasFrontendSignals),
    build: () => ({
      title: "Fix the accessibility basics",
      problem: "Unlabeled controls, missing focus states, and low-contrast text make the product unusable for keyboard and assistive-technology users.",
      action: "Add labels to every control, a visible focus ring, semantic landmarks, and AA contrast on body text.",
      why: "Accessibility is a launch gate for many buyers and a cheap credibility win.",
      acceptance: [
        "Every interactive control has an accessible name.",
        "Keyboard-only navigation reaches every primary action.",
        "Body text meets WCAG AA contrast.",
      ],
      evidence: ["Frontend files were detected; no accessibility checks were found."],
    }),
  },
  {
    id: "backend-validation",
    category: "correctness",
    impact: 4,
    effort: 2,
    when: (ctx) => isTrue(ctx.input.hasBackendSignals),
    build: () => ({
      title: "Validate every request at the boundary",
      problem: "Request payloads are not provably validated, so malformed input can reach business logic and persistence.",
      action: "Add schema validation to every write endpoint and return a typed 400 with field-level errors.",
      why: "Boundary validation prevents the majority of 500s and injection-shaped bugs.",
      acceptance: [
        "Every write endpoint validates its body and params.",
        "Invalid input returns 400 with a machine-readable error.",
        "Validation errors are covered by tests.",
      ],
      evidence: ["Backend/API files were detected."],
    }),
  },
  {
    id: "backend-rate-limit",
    category: "security",
    impact: 3,
    effort: 2,
    when: (ctx) => isTrue(ctx.input.hasBackendSignals),
    build: () => ({
      title: "Add rate limits to expensive and public endpoints",
      problem: "Public and AI-backed endpoints have no demonstrated rate limiting, so one client can exhaust the service.",
      action: "Add per-identity and per-IP limits with a clear 429 response and Retry-After header.",
      why: "Cost blowups and accidental outages are the fastest way to turn a working app into a liability.",
      acceptance: [
        "Expensive endpoints are limited per identity.",
        "A 429 includes Retry-After.",
        "Limits are configurable by environment.",
      ],
      evidence: ["Backend/API files were detected."],
    }),
  },
  {
    id: "backend-graceful-shutdown",
    category: "correctness",
    impact: 3,
    effort: 2,
    when: (ctx) => isTrue(ctx.input.hasBackendSignals),
    build: () => ({
      title: "Handle shutdown and in-flight work safely",
      problem: "A restarted API can drop in-flight writes or leave background work half-done.",
      action: "Handle SIGTERM, stop accepting new work, drain in-flight requests, and release leases/locks before exit.",
      why: "Deploy safety is part of production readiness; restart loops corrupt state otherwise.",
      acceptance: [
        "SIGTERM drains in-flight requests.",
        "Background leases are released on shutdown.",
        "A restart during a write does not duplicate work.",
      ],
      evidence: ["Backend/API files were detected."],
    }),
  },
  {
    id: "db-migrations-missing",
    category: "data",
    impact: 4,
    effort: 3,
    when: (ctx) => isFalse(ctx.input.hasDatabaseMigrations) && isTrue(ctx.input.hasBackendSignals),
    build: () => ({
      title: "Make schema changes reproducible",
      problem: "No migration directory was detected, so schema state depends on manual changes.",
      action: "Introduce forward-only migrations and document how to apply, verify, and recover them.",
      why: "Unreproducible schema is a deployment blocker and a data-loss risk.",
      acceptance: [
        "Every schema change is a committed migration.",
        "Migrations run from an empty database without manual steps.",
        "Migrations are idempotent or guarded.",
      ],
      evidence: ["No migrations directory was detected."],
    }),
  },
  {
    id: "db-backup",
    category: "data",
    impact: 3,
    effort: 3,
    when: (ctx) => isTrue(ctx.input.hasDatabaseMigrations),
    build: () => ({
      title: "Document backup and restore, then test restore",
      problem: "A database exists, but there is no evidence that it can be restored after a bad deploy or deletion.",
      action: "Add an automated backup, document the restore procedure, and run one restore drill against a disposable database.",
      why: "An untested backup is not a backup. Buyers and operators ask for this before anything else.",
      acceptance: [
        "Backups run on a schedule.",
        "A restore drill succeeded and is documented.",
        "Retention and access are documented.",
      ],
      evidence: ["Database migrations were detected."],
    }),
  },
  {
    id: "monetization-surface",
    category: "monetization",
    impact: 4,
    effort: 3,
    when: (ctx) => isFalse(ctx.input.hasPaymentsSignals) && (isTrue(ctx.input.hasFrontendSignals) || isTrue(ctx.input.hasBackendSignals)),
    build: () => ({
      title: "Put a pricing surface in front of real users",
      problem: "There is no billing or pricing surface, so willingness to pay is untested and the upside is unanchored.",
      action: "Add a pricing page and a test-mode checkout that can be enabled per environment without shipping live keys.",
      why: "Demand is only proven when someone can pay. A test-mode surface is the cheapest honest validation.",
      acceptance: [
        "A pricing page exists and is linked from the app.",
        "Checkout runs in test mode.",
        "Entitlements are granted only after a verified payment event.",
      ],
      evidence: ["No payment/billing signals were detected."],
    }),
  },
  {
    id: "onboarding",
    category: "growth",
    impact: 3,
    effort: 2,
    when: (ctx) => isTrue(ctx.input.hasFrontendSignals),
    build: () => ({
      title: "Give a first-time user one obvious next step",
      problem: "A new user can land in the product without a guided first action, which hides the value behind exploration.",
      action: "Add a first-run state that explains the product in one line and routes to the single highest-value action.",
      why: "Activation is the cheapest growth lever and makes demand evidence measurable.",
      acceptance: [
        "A new account sees a clear first action.",
        "The empty state explains what happens next.",
        "Completion of the first action is measurable.",
      ],
      evidence: ["Frontend files were detected."],
    }),
  },
  {
    id: "analytics",
    category: "growth",
    impact: 3,
    effort: 2,
    when: (ctx) => isTrue(ctx.input.hasFrontendSignals) || isTrue(ctx.input.hasBackendSignals),
    build: () => ({
      title: "Instrument the activation funnel",
      problem: "Without product analytics, demand and retention claims stay speculative.",
      action: "Track the handful of events that define activation, and store them somewhere you own.",
      why: "Demand stops being a guess once you can see where users drop off.",
      acceptance: [
        "Signup, first key action, and return visit are tracked.",
        "No personal data is sent to third parties without consent.",
        "A simple funnel can be produced from the stored events.",
      ],
      evidence: ["Product surface detected; no analytics plan was found."],
    }),
  },
  {
    id: "dependency-hygiene",
    category: "security",
    impact: 3,
    effort: 1,
    when: () => true,
    build: () => ({
      title: "Lock dependencies and scan them",
      problem: "Dependencies drift and known vulnerabilities go unnoticed without a lockfile check and a scanner.",
      action: "Commit the lockfile, enable Dependabot or an equivalent scanner, and pin the runtime version.",
      why: "Supply-chain issues are a silent readiness killer and trivial to prevent.",
      acceptance: [
        "A lockfile is committed and used by CI.",
        "Automated vulnerability alerts are enabled.",
        "The runtime version is pinned.",
      ],
      evidence: ["Baseline engineering hygiene."],
    }),
  },
  {
    id: "typecheck-gate",
    category: "correctness",
    impact: 3,
    effort: 1,
    when: () => true,
    build: () => ({
      title: "Make the type checker and linter blocking",
      problem: "Static checks that only run locally do not prevent broken code from merging.",
      action: "Run typecheck and lint in CI and fail the build on errors.",
      why: "A blocking static gate catches whole classes of defects before runtime.",
      acceptance: ["CI fails on type errors.", "CI fails on lint errors.", "Both commands are documented."],
      evidence: ["Baseline engineering hygiene."],
    }),
  },
  {
    id: "smoke-path",
    category: "testing",
    impact: 4,
    effort: 2,
    when: () => true,
    build: () => ({
      title: "Add one end-to-end smoke path",
      problem: "There is no single command that proves the product works from the outside.",
      action: "Script the primary journey (load → sign in or seed → perform the core action → assert persisted result) and run it against a built app.",
      why: "A smoke path is the evidence a finisher, a buyer, and CI all share.",
      acceptance: [
        "One command runs the smoke path against a real build.",
        "It fails loudly when the core journey breaks.",
        "It is documented in the README.",
      ],
      evidence: ["Baseline product verification."],
    }),
  },
  {
    id: "error-budget",
    category: "observability",
    impact: 3,
    effort: 1,
    when: () => true,
    build: () => ({
      title: "Define what 'broken' means operationally",
      problem: "Without an explicit failure definition, every incident is discovered by a user.",
      action: "Define the top three failure signals, alert on them, and write the first-response steps.",
      why: "Operational clarity is part of production readiness and a standard buyer question.",
      acceptance: [
        "Three failure signals are defined.",
        "Alerts reach a human.",
        "First-response steps are written down.",
      ],
      evidence: ["Baseline operational hygiene."],
    }),
  },
  {
    id: "runbook",
    category: "docs",
    impact: 2,
    effort: 1,
    when: () => true,
    build: () => ({
      title: "Write the operator runbook",
      problem: "Deploy, rollback, rotate-secret, and restore procedures live only in someone's head.",
      action: "Write a one-page runbook for deploy, rollback, secret rotation, and restore.",
      why: "A repository nobody else can operate is worth less than one that anyone can.",
      acceptance: ["Deploy is documented.", "Rollback is documented.", "Secret rotation and restore are documented."],
      evidence: ["Baseline operational hygiene."],
    }),
  },
  {
    id: "release-notes",
    category: "docs",
    impact: 2,
    effort: 1,
    when: () => true,
    build: () => ({
      title: "Track releases",
      problem: "There is no release history, so users and operators cannot tell what changed.",
      action: "Add a CHANGELOG or generated release notes tied to tags.",
      why: "Release discipline is a visible signal of a maintained product.",
      acceptance: ["Releases are tagged.", "Each release has notes.", "The changelog is linked from the README."],
      evidence: ["Baseline release hygiene."],
    }),
  },
  {
    id: "secrets-scan",
    category: "security",
    impact: 4,
    effort: 1,
    when: () => true,
    build: () => ({
      title: "Prove no secrets are in the repository",
      problem: "A single committed key can invalidate the entire security story and force a painful rotation.",
      action: "Run a secret scan over the full history, remove any finding, rotate it, and add a pre-commit guard.",
      why: "This is the first thing any technical buyer checks and the cheapest catastrophic risk to remove.",
      acceptance: [
        "Full-history secret scan is clean.",
        "A pre-commit or CI guard blocks new secrets.",
        "Rotation procedure exists for every external credential.",
      ],
      evidence: ["Baseline security hygiene."],
    }),
  },
  {
    id: "ai-eval-harness",
    category: "testing",
    impact: 3,
    effort: 3,
    when: (ctx) => isTrue(ctx.input.hasBackendSignals),
    build: () => ({
      title: "Add an eval harness for model-backed behavior",
      problem: "Model output is untested, so a model or prompt change can silently degrade quality.",
      action: "Record a small golden set of inputs and expected properties, and score every prompt/model change against it in CI.",
      why: "Model-backed products regress quietly; an eval harness is the only credible guard.",
      acceptance: [
        "A golden set of at least ten cases exists.",
        "A command scores the current prompt/model against it.",
        "Regressions fail CI or block a model change.",
      ],
      evidence: ["Backend detected; model output is not evaluated."],
    }),
  },
];

function priorityOf(impact: number, effort: number): number {
  const safeEffort = Math.max(1, Math.min(5, effort));
  return Math.round(((impact * 2) / safeEffort) * 10);
}

function suggestionPrompt(input: RepoSignalInput, suggestion: Omit<ImprovementSuggestion, "builderPrompt">): string {
  const acceptance = suggestion.acceptance.map((item) => `- [ ] ${item}`).join("\n");
  return `# Targeted completion task — ${suggestion.title}

Repository: ${input.repo}
Objective: ${suggestion.action}

## Why this is the task
${suggestion.problem}

## Scope
Do only what is required to satisfy the acceptance criteria below. Do not refactor unrelated code, rename public interfaces, or change product behavior beyond this task. If the task cannot be completed safely, stop and report the blocker instead of shipping a partial change.

## Acceptance criteria
${acceptance}

## Verification
Run the repository's own install, typecheck, test, lint, and build commands. For every criterion above, paste the command you ran and the result. A criterion without evidence is not met.

## Finality contract
Return only when every acceptance criterion is verified, or when a stated stop condition prevents it. Do not return "mostly done", a plan, or a TODO list. If you stop early, name the exact blocker and the evidence that proves it.`;
}

/** Build the ranked, de-duplicated improvement list for one repository. */
export function buildImprovementSuggestions(ctx: RuleContext, options: { limit?: number } = {}): ImprovementSuggestion[] {
  const limit = Math.max(6, Math.min(30, options.limit ?? 18));
  const context: RuleContext = {
    input: ctx.input,
    report: ctx.report,
  };

  const generated: ImprovementSuggestion[] = RULES.filter((rule) => {
    try {
      return rule.when(context);
    } catch {
      return false;
    }
  }).map((rule) => {
    const built = rule.build(context);
    const base = {
      id: `${rule.id}`,
      category: rule.category,
      title: built.title,
      problem: built.problem,
      action: built.action,
      why: built.why,
      impact: Math.max(1, Math.min(5, rule.impact)),
      effort: Math.max(1, Math.min(5, rule.effort)),
      priority: priorityOf(rule.impact, rule.effort),
      acceptance: built.acceptance,
      evidence: built.evidence,
    };
    return { ...base, builderPrompt: suggestionPrompt(ctx.input, base) };
  });

  // Fold in the analysis' own suggestions so measured findings are not lost.
  const existing = [...(ctx.input.suggestions ?? [])]
    .filter((suggestion) => suggestion?.title && suggestion?.action)
    .map((suggestion, index) => {
      const impact = 3;
      const effort = Math.max(1, Math.min(5, Math.round(Number(suggestion.effort) || 3)));
      const base = {
        id: `analysis-${index + 1}`,
        category: "correctness" as SuggestionCategory,
        title: String(suggestion.title).trim(),
        problem: "Identified by the latest portfolio analysis.",
        action: String(suggestion.action).trim(),
        why: String(suggestion.why ?? "The analysis ranked this as part of the finish path.").trim(),
        impact,
        effort,
        priority: priorityOf(impact, effort),
        acceptance: ["The described change is implemented.", "The repository's tests and build pass.", "The change is demonstrated with evidence."],
        evidence: ["Latest portfolio analysis."],
      };
      return { ...base, builderPrompt: suggestionPrompt(ctx.input, base) };
    });

  const seen = new Set<string>();
  const merged: ImprovementSuggestion[] = [];
  for (const suggestion of [...generated, ...existing]) {
    const key = suggestion.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(suggestion);
  }

  merged.sort((a, b) => b.priority - a.priority || b.impact - a.impact || a.effort - b.effort);
  return merged.slice(0, limit);
}

export type BuilderTarget = "provider-neutral" | "codex" | "claude-code" | "gemini-cli";

function targetGuidance(target: BuilderTarget): string {
  switch (target) {
    case "codex":
      return "Use Codex repository and shell tools: read files before editing, run commands and tests in the workspace, and commit small coherent changes. Treat CI output as the source of truth.";
    case "claude-code":
      return "Use Claude Code's search, edit, and terminal tools. Keep a running checklist tied to the acceptance criteria and verify each item against real command output before checking it off.";
    case "gemini-cli":
      return "Use Gemini CLI's codebase inspection and shell tools. Validate every claim against the current checkout and tests; never infer success from a plan.";
    default:
      return "Use whatever repository, terminal, CI, and browser tools you have. Inspect before editing, and treat current repository/runtime evidence as authoritative over this prompt if they disagree.";
  }
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export interface ComposedBuilderPrompt {
  prompt: string;
  target: BuilderTarget;
  promptVersion: string;
  quality: PromptQuality;
  includedSuggestionIds: string[];
}

export interface PromptQualityCheck {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
}

export interface PromptQuality {
  score: number;
  checks: PromptQualityCheck[];
}

/**
 * The finality contract. Every clause below exists because a builder model
 * without it reliably returns a plan, a partial patch, or a "done" claim with
 * no evidence.
 */
export function composeFinalityPrompt(
  report: RepoBusinessReport,
  input: RepoSignalInput,
  suggestions: ImprovementSuggestion[],
  options: { target?: BuilderTarget; topN?: number } = {},
): ComposedBuilderPrompt {
  const target = options.target ?? "provider-neutral";
  const top = suggestions.slice(0, Math.max(3, Math.min(12, options.topN ?? 8)));
  const grade = report.grade;
  const demand = report.demand;
  const valuation = report.valuation;
  const finality = report.finality;

  const work = top
    .map((suggestion, index) => {
      const acceptance = suggestion.acceptance.map((item) => `   - ${item}`).join("\n");
      return `${index + 1}. ${suggestion.title}  [impact ${suggestion.impact}/5, effort ${suggestion.effort}/5, priority ${suggestion.priority}]
   Problem: ${suggestion.problem}
   Do: ${suggestion.action}
   Why it matters: ${suggestion.why}
   Acceptance:
${acceptance}`;
    })
    .join("\n\n");

  const blockers = finality.blockers.length
    ? finality.blockers.map((blocker) => `- ${blocker}`).join("\n")
    : "- None recorded. Re-derive from current evidence before claiming completion.";

  const prompt = `# FINALITY CONTRACT — ${input.repo}

You are the principal engineer responsible for taking this repository from its current verified state to **genuinely finished**. "Finished" means every acceptance criterion below is met and demonstrated with evidence. It does not mean "the code compiles", "the plan is written", or "most of it is done".

## 1. Baseline

- Repository: ${input.repo}
- Default branch: ${input.language ? `(confirm from the repo) — primary language ${input.language}` : "confirm from the repository"}
- Archived: ${report.signals.archived ? "yes — do not treat as active work without confirming intent" : "no"}
- Completion evidence: ${report.signals.measuredCompletion ? "measured by analysis" : "derived from structure"} at ${report.signals.completionPct}%
- Production readiness: ${report.signals.measuredReadiness ? "measured by analysis" : "derived from structure"} at ${report.signals.productionReadinessPct}%

Before editing, resolve the current default-branch HEAD and read the repository. If the current state contradicts this brief, the repository wins: report the discrepancy and re-plan instead of forcing this prompt to fit.

## 2. Where the business actually is

- Grade: ${grade.letter} (${grade.overall}/100) — ${grade.stageLabel}
- Evidence ceiling: ${grade.evidenceCeiling}/100 (the grade cannot honestly exceed this without new evidence)
- Demand: ${demand.index}/100 — ${demand.bandLabel}
- Present fair-market value: ${money(valuation.presentValue.low)}–${money(valuation.presentValue.high)}
- Potential value if finished: ${money(valuation.potentialValue.low)}–${money(valuation.potentialValue.high)}
- Value unlocked by finishing: ${money(valuation.valueGap)}
- Finality score: ${finality.score}/100
- Valuation confidence: ${valuation.confidence} (${valuation.confidenceScore}/100)

These numbers are planning inputs, not promises. Do not optimize for the number; optimize for the evidence that would justify it.

## 3. Hard constraints

1. Do not weaken, delete, skip, or rewrite tests, CI, security controls, or acceptance criteria to obtain a green result.
2. Do not commit secrets, tokens, private keys, production env values, or customer data.
3. Do not change product behavior outside the listed work without an explicit, evidence-backed reason.
4. Work on a dedicated branch and open a **draft** pull request. Do not force-push shared branches and do not merge automatically.
5. If a required credential, permission, or environment is unavailable, stop and name it exactly. Never invent a value.

## 4. Ordered work

Execute in order. Prerequisites come first; later items may depend on earlier ones.

${work}

## 5. Known blockers

${blockers}

## 6. Execution loop

1. Inspect the current code, config, tests, CI, and runtime evidence.
2. Identify the highest-impact verified blocker and its root cause.
3. Form a hypothesis and actively look for evidence that would disprove it.
4. Implement the smallest coherent change that closes the blocker.
5. Run the relevant verification. Read the actual output.
6. Repair the root cause, not the symptom.
7. Re-check the primary user journey and security boundaries.
8. Move to the next blocker.
9. Stop only when the Definition of Done is met or a stop condition applies.

Do not churn. If two materially different attempts produce no measurable progress on the same blocker, stop guessing and re-diagnose from fresh evidence.

## 7. Verification gates

A change is not complete because code was written. Require observable evidence:

- Install, typecheck, lint, test, and production build all pass — paste the commands and results.
- The primary user journey works end to end against a real running build.
- New behavior has a test that fails without the change and passes with it.
- Security boundaries are verified: unauthenticated access is rejected, users cannot cross data boundaries, secrets stay out of the client.
- If the repository has a deploy path, build and smoke-test the deployed/preview surface.
- No new runtime errors in logs after the change.
- No placeholder, fake-success, dead navigation, or debug-only path is left in the critical journey.

## 8. Stop conditions

Stop and report — do not guess — when:

- A required secret, account, or production permission is unavailable.
- A destructive migration cannot be validated safely.
- The current HEAD moved and the plan would overwrite newer work.
- The requested behavior conflicts with verified requirements or security controls.
- The remaining blocker depends on an external service you cannot safely inspect.

## 9. Definition of Done

The repository is finished only when, for its intended scope:

- The core user/business workflow works end to end.
- Known high-severity blockers are resolved.
- Tests, CI, typecheck, lint, and build pass without weakened criteria.
- Auth/authorization and secret handling are verified where applicable.
- Deployment is reproducible and the running surface is smoke-tested where possible.
- Error, loading, empty, and retry paths are usable rather than fake-success.
- Critical responsive and accessibility behavior is acceptable for user-facing apps.
- Monitoring exposes meaningful failures on production-critical paths.
- Documentation and env templates are sufficient for another engineer to run and operate it.
- You can cite concrete command output for every completion claim.

## 10. Required final report

Return exactly:

1. Branch name and draft PR URL.
2. What changed, grouped by the work item it closes.
3. Commands run and their actual results.
4. Deployment/preview URL and smoke-test evidence, if available.
5. Security/auth/data verification performed.
6. Before/after grade and finality score with the evidence used.
7. Remaining blockers or unverified areas — never hide them behind a "done" claim.
8. The single next action if the Definition of Done is not yet met.

## 11. Anti-patterns (these are failures, not shortcuts)

- Claiming completion without command output.
- Deleting or skipping a failing test instead of fixing the defect.
- Hardcoding a passing state, a demo account, or a mock in production code.
- Broad refactors that make the diff unreviewable.
- Silent fallbacks that hide a broken dependency.
- Committing generated secrets or real credentials.

## 12. Tool guidance for this agent

${targetGuidance(target)}

Start by inspecting the repository, confirming the baseline, and then execute work item 1.`;

  const quality = scorePromptQuality(prompt);
  return {
    prompt,
    target,
    promptVersion: BUILDER_PROMPT_VERSION,
    quality,
    includedSuggestionIds: top.map((suggestion) => suggestion.id),
  };
}

/**
 * Executable rubric for "is this a prompt that drives finality?" Each check is
 * a concrete clause the prompt must contain. If the composer ever drops one,
 * the score drops and the test suite fails.
 */
export function scorePromptQuality(prompt: string): PromptQuality {
  const checks: PromptQualityCheck[] = [
    { id: "role", label: "Names the agent's role and the definition of finished", weight: 8, passed: /principal engineer/i.test(prompt) && /genuinely finished/i.test(prompt) },
    { id: "baseline", label: "Requires resolving the real baseline before editing", weight: 8, passed: /default-branch HEAD/i.test(prompt) && /repository wins/i.test(prompt) },
    { id: "state", label: "Includes current grade, demand, and value evidence", weight: 8, passed: /Grade:/i.test(prompt) && /Demand:/i.test(prompt) && /fair-market value/i.test(prompt) },
    { id: "scope", label: "Bounds scope and forbids unrelated changes", weight: 8, passed: /Hard constraints/i.test(prompt) && /outside the listed work/i.test(prompt) },
    { id: "work", label: "Provides ordered, itemized work with acceptance criteria", weight: 12, passed: /Ordered work/i.test(prompt) && /Acceptance:/i.test(prompt) },
    { id: "loop", label: "Prescribes an evidence-driven execution loop", weight: 10, passed: /Execution loop/i.test(prompt) && /root cause/i.test(prompt) },
    { id: "verification", label: "Defines executable verification gates", weight: 14, passed: /Verification gates/i.test(prompt) && /paste the commands and results/i.test(prompt) },
    { id: "stop", label: "Defines explicit stop conditions", weight: 10, passed: /Stop conditions/i.test(prompt) && /do not guess/i.test(prompt) },
    { id: "dod", label: "Defines a binary Definition of Done", weight: 10, passed: /Definition of Done/i.test(prompt) && /works end to end/i.test(prompt) },
    { id: "report", label: "Requires an evidence-backed final report", weight: 7, passed: /Required final report/i.test(prompt) && /Remaining blockers or unverified areas/i.test(prompt) },
    { id: "anti", label: "Names anti-patterns that count as failure", weight: 5, passed: /Anti-patterns/i.test(prompt) && /Deleting or skipping a failing test/i.test(prompt) },
  ];

  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  return { score: Math.round((earned / total) * 100), checks };
}
