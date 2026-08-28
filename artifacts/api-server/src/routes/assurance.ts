import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middlewares/auth";
import { loadGithubCredential, requireGithubCredential } from "../lib/credentials";
import { recordOperationalMemory } from "../lib/learning-memory";

const router: IRouter = Router();

type CheckStatus = "passed" | "failed" | "warning" | "unknown";
interface AssuranceCheck {
  id: string;
  area: "security" | "product" | "delivery" | "data" | "operations";
  status: CheckStatus;
  weight: number;
  title: string;
  evidence: string;
  recommendation?: string;
}

function ghHeaders(token: string, accept = "application/vnd.github+json") {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repo-finisher-assurance",
  };
}

async function ghFetch(token: string, path: string, accept?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`https://api.github.com${path}`, { headers: ghHeaders(token, accept), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function fileText(token: string, repo: string, path: string, ref: string) {
  const response = await ghFetch(token, `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
  if (!response.ok) return null;
  const json = await response.json() as { content?: string; encoding?: string };
  if (!json.content || json.encoding !== "base64") return null;
  return Buffer.from(json.content, "base64").toString("utf-8").slice(0, 150_000);
}

function weightedScore(checks: AssuranceCheck[]) {
  const scored = checks.filter((check) => check.status !== "unknown");
  const totalWeight = scored.reduce((sum, check) => sum + check.weight, 0);
  if (!totalWeight) return 0;
  const points = scored.reduce((sum, check) => {
    const value = check.status === "passed" ? 1 : check.status === "warning" ? 0.5 : 0;
    return sum + value * check.weight;
  }, 0);
  return Math.round((points / totalWeight) * 1000) / 10;
}

function has(paths: string[], pattern: RegExp) {
  return paths.some((path) => pattern.test(path));
}

function blockedIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function blockedIp(address: string) {
  const version = isIP(address);
  if (version === 4) return blockedIpv4(address);
  if (version !== 6) return true;
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (/^(fc|fd)/.test(lower)) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  if (/^ff/.test(lower)) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blockedIpv4(mapped[1]);
  return false;
}

async function validateProbeUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid homepage URL.");
  }
  if (url.protocol !== "https:") throw new Error("Only HTTPS homepage probes are allowed.");
  if (url.username || url.password) throw new Error("Homepage URLs containing credentials are not allowed.");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Local/internal homepage targets are not allowed.");
  }
  if (isIP(hostname) && blockedIp(hostname)) throw new Error("Private, loopback, link-local, multicast, or reserved homepage targets are not allowed.");
  if (!isIP(hostname)) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length) throw new Error("Homepage hostname did not resolve.");
    if (addresses.some((entry) => blockedIp(entry.address))) {
      throw new Error("Homepage hostname resolves to a private, loopback, link-local, multicast, or reserved address.");
    }
  }
  return url;
}

function safeUrl(value: unknown) {
  if (typeof value !== "string" || !/^https:\/\//i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

async function probeHomepage(rawUrl: string | null) {
  if (!rawUrl) return { status: "unknown" as const, code: null, evidence: "No HTTPS homepage is configured." };
  let current = rawUrl;
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const url = await validateProbeUrl(current);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": "RepoFinisher-Assurance/1.0" },
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return { status: "failed" as const, code: response.status, evidence: `Homepage ${url.toString()} returned HTTP ${response.status} without a Location header.` };
        }
        if (redirects === 3) return { status: "failed" as const, code: response.status, evidence: "Homepage exceeded the safe redirect limit." };
        current = new URL(location, url).toString();
        continue;
      }

      return {
        status: response.status >= 200 && response.status < 400 ? "passed" as const : "failed" as const,
        code: response.status,
        evidence: `Homepage ${url.toString()} returned HTTP ${response.status}.`,
      };
    }
    return { status: "failed" as const, code: null, evidence: "Homepage exceeded the safe redirect limit." };
  } catch (error) {
    return { status: "failed" as const, code: null, evidence: `Homepage probe blocked or failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

router.post(
  "/repo-finisher/assurance/run",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z.object({
      repo: z.string().regex(/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/),
      headSha: z.string().regex(/^[0-9a-f]{40}$/i).optional(),
      completionRunId: z.string().uuid().optional(),
    }).parse(req.body);
    const userId = req.userId!;
    const github = requireGithubCredential(await loadGithubCredential(req.supabase!, userId));
    const repoRes = await ghFetch(github.token, `/repos/${input.repo}`);
    if (!repoRes.ok) throw Object.assign(new Error(`Repository unavailable: ${input.repo}`), { status: 404 });
    const repo = await repoRes.json() as Record<string, unknown>;
    const defaultBranch = String(repo.default_branch || "main");
    let headSha = input.headSha;
    if (!headSha) {
      const branchRes = await ghFetch(github.token, `/repos/${input.repo}/branches/${encodeURIComponent(defaultBranch)}`);
      if (!branchRes.ok) throw new Error("Unable to resolve repository head commit.");
      const branch = await branchRes.json() as { commit?: { sha?: string } };
      headSha = String(branch.commit?.sha || "");
    }

    const [treeRes, checksRes] = await Promise.all([
      ghFetch(github.token, `/repos/${input.repo}/git/trees/${headSha}?recursive=1`),
      ghFetch(github.token, `/repos/${input.repo}/commits/${headSha}/check-runs?per_page=100`),
    ]);
    if (!treeRes.ok) throw new Error("Unable to inspect repository tree.");
    const treeJson = await treeRes.json() as { tree?: Array<{ path: string; type: string; size?: number }>; truncated?: boolean };
    const paths = (treeJson.tree ?? []).filter((entry) => entry.type === "blob").map((entry) => entry.path.toLowerCase());
    const checkRuns = checksRes.ok
      ? ((await checksRes.json()) as { check_runs?: Array<{ name: string; status: string; conclusion: string | null }> }).check_runs ?? []
      : [];
    const packageJson = has(paths, /^package\.json$/) ? await fileText(github.token, input.repo, "package.json", headSha) : null;
    const envExamplePath = paths.find((path) => /(^|\/)\.env\.(example|sample|template|defaults)$/.test(path)) ?? null;
    const homepage = await probeHomepage(safeUrl(repo.homepage));

    const requiredPassed = (pattern: RegExp) => checkRuns.some((check) => pattern.test(check.name) && check.status === "completed" && ["success", "neutral", "skipped"].includes(check.conclusion || ""));
    const failedChecks = checkRuns.filter((check) => check.status === "completed" && check.conclusion && !["success", "neutral", "skipped"].includes(check.conclusion));
    const suspiciousCredentialPaths = paths.filter((path) => /(^|\/)(\.env|credentials\.json|service[-_]?account.*\.json|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key)$/.test(path) && !/\.env\.(example|sample|template|defaults)$/.test(path));
    const packageScripts = (() => {
      if (!packageJson) return {} as Record<string, string>;
      try { return (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {}; } catch { return {}; }
    })();

    const checks: AssuranceCheck[] = [
      {
        id: "credentials-not-committed", area: "security", status: suspiciousCredentialPaths.length ? "failed" : "passed", weight: 14,
        title: "Credential-bearing files",
        evidence: suspiciousCredentialPaths.length ? `Potential credential files are committed: ${suspiciousCredentialPaths.slice(0, 8).join(", ")}.` : "No obvious credential-bearing filenames were found in the repository tree.",
        recommendation: suspiciousCredentialPaths.length ? "Remove committed secrets safely, rotate exposed credentials, and add safe templates/ignore rules." : undefined,
      },
      {
        id: "security-policy", area: "security", status: has(paths, /(^|\/)security\.md$/) ? "passed" : "warning", weight: 4,
        title: "Security policy", evidence: has(paths, /(^|\/)security\.md$/) ? "SECURITY.md is present." : "SECURITY.md is missing.",
        recommendation: "Document supported versions and a private vulnerability-reporting path.",
      },
      {
        id: "dependency-updates", area: "security", status: has(paths, /^\.github\/dependabot\.ya?ml$/) ? "passed" : "warning", weight: 5,
        title: "Dependency update automation", evidence: has(paths, /^\.github\/dependabot\.ya?ml$/) ? "Dependabot configuration is present." : "No Dependabot configuration was detected.",
      },
      {
        id: "auth-tests", area: "security",
        status: has(paths, /(auth|oauth|session|permission|jwt)/) && !has(paths, /(auth|oauth|session|permission|jwt).*\.(test|spec)\.|(test|spec).*?(auth|oauth|session|permission|jwt)/) ? "warning" : "passed",
        weight: 8, title: "Authentication/authorization verification",
        evidence: has(paths, /(auth|oauth|session|permission|jwt)/) ? "Authentication/authorization code signals are present; test coverage was checked structurally." : "No authentication-sensitive surface was inferred from repository paths.",
      },
      {
        id: "database-safety", area: "data",
        status: has(paths, /(supabase\/migrations|(^|\/)migrations\/|prisma|drizzle)/) ? (has(paths, /(migration|schema).*\.(test|spec)\.|test.*migration/) ? "passed" : "warning") : "unknown",
        weight: 8, title: "Database migration validation",
        evidence: has(paths, /(supabase\/migrations|(^|\/)migrations\/|prisma|drizzle)/) ? "Database migrations/schema tooling are present." : "No database migration surface was detected.",
        recommendation: "Validate migrations against disposable infrastructure and confirm rollback/idempotency before production.",
      },
      {
        id: "ci-present", area: "delivery", status: has(paths, /^\.github\/workflows\/.*\.ya?ml$/) ? "passed" : "failed", weight: 12,
        title: "Continuous integration", evidence: has(paths, /^\.github\/workflows\/.*\.ya?ml$/) ? "GitHub Actions workflows are present." : "No GitHub Actions workflow was detected.",
      },
      {
        id: "tests-present", area: "product", status: has(paths, /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\./) ? "passed" : "failed", weight: 12,
        title: "Automated tests", evidence: has(paths, /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\./) ? "Automated test files are present." : "No automated test files were detected.",
      },
      {
        id: "test-script", area: "delivery", status: packageJson ? (packageScripts.test ? "passed" : "warning") : "unknown", weight: 5,
        title: "Test command", evidence: packageJson ? (packageScripts.test ? `package.json test script: ${packageScripts.test}` : "package.json has no test script.") : "No package.json detected.",
      },
      {
        id: "current-checks", area: "delivery", status: failedChecks.length ? "failed" : checkRuns.length ? (checkRuns.some((check) => check.status !== "completed") ? "warning" : "passed") : "unknown", weight: 12,
        title: "Current commit checks", evidence: failedChecks.length ? `Failing checks: ${failedChecks.map((check) => check.name).join(", ")}.` : checkRuns.length ? `${checkRuns.length} check run(s) were inspected.` : "No check runs were available for this commit.",
      },
      {
        id: "build-check", area: "delivery", status: requiredPassed(/build|ci|verify/i) ? "passed" : checkRuns.length ? "warning" : "unknown", weight: 7,
        title: "Build verification", evidence: requiredPassed(/build|ci|verify/i) ? "A build/CI verification check passed." : "No clearly identified passing build verification was observed.",
      },
      {
        id: "env-template", area: "operations", status: envExamplePath ? "passed" : "warning", weight: 4,
        title: "Environment configuration template", evidence: envExamplePath ? `Safe environment template found: ${envExamplePath}.` : "No .env.example/.sample/.template was detected.",
      },
      {
        id: "readme", area: "product", status: has(paths, /(^|\/)readme(\.|$)/) ? "passed" : "warning", weight: 3,
        title: "Operator/user documentation", evidence: has(paths, /(^|\/)readme(\.|$)/) ? "README documentation is present." : "README documentation is missing.",
      },
      {
        id: "deployment-config", area: "operations", status: has(paths, /(vercel\.json|firebase\.json|render\.ya?ml|cloudbuild\.ya?ml|dockerfile|docker-compose)/) ? "passed" : "warning", weight: 7,
        title: "Deployment configuration", evidence: has(paths, /(vercel\.json|firebase\.json|render\.ya?ml|cloudbuild\.ya?ml|dockerfile|docker-compose)/) ? "Deployment/container configuration was detected." : "No explicit deployment configuration was detected.",
      },
      {
        id: "live-homepage", area: "product", status: homepage.status, weight: 9,
        title: "Live product surface", evidence: homepage.evidence,
        recommendation: homepage.status === "failed" ? "Repair the deployed product surface and include smoke verification in the completion gate." : undefined,
      },
    ];

    const securityChecks = checks.filter((check) => check.area === "security" || check.area === "data");
    const productChecks = checks.filter((check) => check.area === "product" || check.area === "delivery" || check.area === "operations");
    const securityScore = weightedScore(securityChecks);
    const productScore = weightedScore(productChecks);
    const combinedScore = Math.round((securityScore * 0.4 + productScore * 0.6) * 10) / 10;
    const blockers = checks.filter((check) => check.status === "failed").map((check) => ({ id: check.id, title: check.title, evidence: check.evidence, recommendation: check.recommendation ?? null }));
    const status = blockers.length ? "failed" : checks.some((check) => check.status === "warning") ? "partial" : "passed";
    const now = new Date().toISOString();

    const { data: readiness, error: readinessError } = await req.supabase!
      .from("product_readiness_runs")
      .insert({
        user_id: userId,
        repo: input.repo,
        completion_run_id: input.completionRunId ?? null,
        head_sha: headSha,
        suite_version: "assurance-v3-security-product-ssrf-safe",
        status,
        score: combinedScore,
        checks,
        blockers,
        evidence: { securityScore, productScore, treeTruncated: Boolean(treeJson.truncated), homepage },
        created_at: now,
        completed_at: now,
      })
      .select("id")
      .single();
    if (readinessError) throw new Error(`Failed to persist product assurance result: ${readinessError.message}`);

    const readinessRunId = String((readiness as Record<string, unknown>).id);
    await Promise.all([
      recordOperationalMemory(req.supabase!, userId, {
        repo: input.repo,
        category: "security",
        memoryKey: "security-assurance",
        observation: `Security assurance score ${securityScore}/100 with ${securityChecks.filter((check) => check.status === "failed").length} blocking failure(s).`,
        recommendation: blockers.length ? `Prioritize blocking security/delivery findings before declaring the repository finished: ${blockers.slice(0, 4).map((blocker) => blocker.title).join(", ")}.` : "Preserve verified security controls and re-run assurance after material auth/data/deployment changes.",
        outcome: blockers.length ? "failure" : status === "passed" ? "success" : "partial",
        confidence: 85,
        evidence: [{ readinessRunId, securityScore, blockers }],
      }),
      recordOperationalMemory(req.supabase!, userId, {
        repo: input.repo,
        category: "product_flow",
        memoryKey: "product-readiness-assurance",
        observation: `Product/delivery readiness score ${productScore}/100; live surface ${homepage.status}.`,
        recommendation: productScore < 85 ? "Do not call the repository production-finished until its core automated delivery, tests, deployment surface, and smoke evidence meet the readiness gate." : "Preserve passing product/delivery evidence and focus future work on measured user-value gaps rather than cosmetic scope.",
        outcome: productScore >= 85 && !blockers.length ? "success" : productScore < 60 ? "failure" : "partial",
        confidence: 82,
        evidence: [{ readinessRunId, productScore, homepage }],
      }),
    ]);

    res.json({
      readinessRunId,
      repo: input.repo,
      headSha,
      status,
      score: combinedScore,
      securityScore,
      productScore,
      blockers,
      checks,
      generatedAt: now,
      caveat: "This gate validates repository, CI, deployment, and live-surface evidence. Authenticated end-to-end customer workflows still require application-specific browser-test definitions when the product needs login, payment, or privileged flows.",
    });
  }),
);

router.get(
  "/repo-finisher/assurance/:repoOwner/:repoName",
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = z.object({ repoOwner: z.string(), repoName: z.string() }).parse(req.params);
    const repo = `${params.repoOwner}/${params.repoName}`;
    const { data, error } = await req.supabase!
      .from("product_readiness_runs")
      .select("*")
      .eq("user_id", req.userId!)
      .eq("repo", repo)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`Failed to load product assurance history: ${error.message}`);
    res.json(data ?? []);
  }),
);

export default router;
