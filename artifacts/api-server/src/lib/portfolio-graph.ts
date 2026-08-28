export type RelationshipType =
  | "duplicate"
  | "shared_ip"
  | "dependency"
  | "successor"
  | "frontend_backend"
  | "worker_service"
  | "merge_candidate"
  | "archive_candidate";

export interface PortfolioGraphRepo {
  repo: string;
  description?: string | null;
  topics?: string[];
  language?: string | null;
  archived?: boolean;
  completionPct?: number | null;
  productionReadinessPct?: number | null;
  dependencies?: string[];
  fileFingerprints?: string[];
}

export interface PortfolioRelationship {
  repoA: string;
  repoB: string;
  type: RelationshipType;
  confidence: number;
  evidence: string[];
  recommendation: string;
}

function words(value: string | null | undefined) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !["this", "that", "with", "from", "your", "repo", "app", "application"].includes(word)),
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function overlapRatio(a: string[] = [], b: string[] = []) {
  const left = new Set(a.map((value) => value.toLowerCase()));
  const right = new Set(b.map((value) => value.toLowerCase()));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function nameTokens(repo: string) {
  const name = repo.split("/").pop() || repo;
  return words(name.replace(/\d+/g, " "));
}

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function relationshipForPair(a: PortfolioGraphRepo, b: PortfolioGraphRepo): PortfolioRelationship[] {
  const evidence: string[] = [];
  const nameSimilarity = jaccard(nameTokens(a.repo), nameTokens(b.repo));
  const descriptionSimilarity = jaccard(words(a.description), words(b.description));
  const topicSimilarity = jaccard(new Set((a.topics ?? []).map((x) => x.toLowerCase())), new Set((b.topics ?? []).map((x) => x.toLowerCase())));
  const dependencySimilarity = overlapRatio(a.dependencies, b.dependencies);
  const fingerprintSimilarity = overlapRatio(a.fileFingerprints, b.fileFingerprints);
  if (nameSimilarity >= 0.5) evidence.push(`Repository names are ${Math.round(nameSimilarity * 100)}% token-similar.`);
  if (descriptionSimilarity >= 0.35) evidence.push(`Descriptions are ${Math.round(descriptionSimilarity * 100)}% token-similar.`);
  if (topicSimilarity >= 0.4) evidence.push(`Topics overlap ${Math.round(topicSimilarity * 100)}%.`);
  if (dependencySimilarity >= 0.45) evidence.push(`Dependency sets overlap ${Math.round(dependencySimilarity * 100)}%.`);
  if (fingerprintSimilarity >= 0.35) evidence.push(`Key file fingerprints overlap ${Math.round(fingerprintSimilarity * 100)}%.`);

  const combined = nameSimilarity * 0.2 + descriptionSimilarity * 0.25 + topicSimilarity * 0.15 + dependencySimilarity * 0.2 + fingerprintSimilarity * 0.2;
  const relationships: PortfolioRelationship[] = [];
  const aText = `${a.repo} ${a.description ?? ""} ${(a.topics ?? []).join(" ")}`.toLowerCase();
  const bText = `${b.repo} ${b.description ?? ""} ${(b.topics ?? []).join(" ")}`.toLowerCase();

  if (combined >= 0.67 || (fingerprintSimilarity >= 0.72 && dependencySimilarity >= 0.55)) {
    relationships.push({
      repoA: a.repo,
      repoB: b.repo,
      type: "duplicate",
      confidence: Math.min(98, Math.round(55 + combined * 45)),
      evidence,
      recommendation: "Treat these repositories as possible duplicate product/IP implementations. Compare canonical functionality before portfolio valuation or further parallel investment.",
    });
  } else if (combined >= 0.46) {
    relationships.push({
      repoA: a.repo,
      repoB: b.repo,
      type: "shared_ip",
      confidence: Math.min(92, Math.round(45 + combined * 50)),
      evidence,
      recommendation: "Review these repositories for reusable shared packages, duplicated modules, or a consolidation opportunity before independently rebuilding the same capability.",
    });
  }

  const aFrontend = includesAny(aText, ["frontend", "web", "ui", "react", "next", "vite"]);
  const bFrontend = includesAny(bText, ["frontend", "web", "ui", "react", "next", "vite"]);
  const aBackend = includesAny(aText, ["backend", "api", "server", "worker", "service"]);
  const bBackend = includesAny(bText, ["backend", "api", "server", "worker", "service"]);
  if ((aFrontend && bBackend) || (bFrontend && aBackend)) {
    relationships.push({
      repoA: a.repo,
      repoB: b.repo,
      type: "frontend_backend",
      confidence: Math.max(55, Math.round(55 + Math.max(topicSimilarity, descriptionSimilarity) * 35)),
      evidence: [...evidence, "Repository descriptions/topics indicate complementary frontend/backend roles."],
      recommendation: "Verify whether these repositories are two deployment surfaces of one product and score/deploy them as a linked system rather than isolated products.",
    });
  }

  const aWorker = includesAny(aText, ["worker", "relay", "queue", "processor", "cron"]);
  const bWorker = includesAny(bText, ["worker", "relay", "queue", "processor", "cron"]);
  if (aWorker !== bWorker && (descriptionSimilarity >= 0.25 || topicSimilarity >= 0.3)) {
    relationships.push({
      repoA: a.repo,
      repoB: b.repo,
      type: "worker_service",
      confidence: Math.round(55 + Math.max(descriptionSimilarity, topicSimilarity) * 35),
      evidence: [...evidence, "One repository appears worker/relay-oriented while the other appears application/service-oriented."],
      recommendation: "Model the worker as infrastructure for the product, validate their interfaces together, and avoid double-counting the worker as a separate commercial product unless it has independent value.",
    });
  }

  const aCompletion = Number(a.completionPct ?? 0);
  const bCompletion = Number(b.completionPct ?? 0);
  if (combined >= 0.42 && Math.abs(aCompletion - bCompletion) >= 25) {
    const stronger = aCompletion >= bCompletion ? a.repo : b.repo;
    const weaker = stronger === a.repo ? b.repo : a.repo;
    relationships.push({
      repoA: a.repo,
      repoB: b.repo,
      type: "archive_candidate",
      confidence: Math.min(90, Math.round(55 + combined * 35)),
      evidence: [...evidence, `${stronger} is materially more complete than ${weaker}.`],
      recommendation: `Use ${stronger} as the likely canonical base. Extract any unique value from ${weaker}, then consider archiving the redundant repository.`,
    });
  } else if (combined >= 0.5) {
    relationships.push({
      repoA: a.repo,
      repoB: b.repo,
      type: "merge_candidate",
      confidence: Math.min(88, Math.round(50 + combined * 40)),
      evidence,
      recommendation: "Evaluate a bounded consolidation plan: select the stronger canonical architecture, import unique capabilities, preserve history, and archive redundant deployment surfaces.",
    });
  }

  return relationships;
}

export function buildPortfolioRelationships(repos: PortfolioGraphRepo[], maxRelationships = 250): PortfolioRelationship[] {
  const out: PortfolioRelationship[] = [];
  for (let i = 0; i < repos.length; i += 1) {
    for (let j = i + 1; j < repos.length; j += 1) {
      out.push(...relationshipForPair(repos[i], repos[j]));
      if (out.length >= maxRelationships * 2) break;
    }
    if (out.length >= maxRelationships * 2) break;
  }
  return out
    .sort((a, b) => b.confidence - a.confidence || a.repoA.localeCompare(b.repoA) || a.repoB.localeCompare(b.repoB))
    .slice(0, Math.max(1, maxRelationships));
}
