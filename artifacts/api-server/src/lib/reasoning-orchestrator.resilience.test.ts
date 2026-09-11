import { describe, expect, it } from "vitest";
import {
  buildSpecialistContext,
  buildDeterministicSpecialist,
  buildDeterministicPlan,
  type RepoEvidence,
} from "./reasoning-orchestrator";

const sampleEvidence: RepoEvidence = {
  repository: {
    repo: "patriotnewsactivism/ai-journalist",
    description: "Automated news summarization and drafting platform",
    language: "TypeScript",
    topics: ["ai", "news", "automation"],
    defaultBranch: "main",
    evidenceRef: "main",
    headSha: "a1b2c3d4e5f67890123456789012345678901234",
    stars: 12,
    forks: 3,
    openIssues: 2,
    archived: false,
  },
  treeSignals: {
    fileCount: 45,
    hasTests: true,
    hasCi: true,
    hasDocker: true,
    hasDatabaseMigrations: true,
    hasAuthSignals: true,
    hasPaymentsSignals: false,
    hasFrontendSignals: true,
    hasBackendSignals: true,
  },
  files: [
    { path: "src/app/page.tsx", content: "export default function Home() { return <div>News</div>; }" },
    { path: "src/api/routes/articles.ts", content: "export function getArticles() { return []; }" },
    { path: "supabase/migrations/20260101_init.sql", content: "CREATE TABLE articles (id uuid primary key);" },
    { path: ".github/workflows/ci.yml", content: "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest" },
  ],
};

describe("reasoning-orchestrator resilience", () => {
  describe("buildSpecialistContext", () => {
    it("filters files to only those relevant to the specialist role to avoid token bloat and timeout", () => {
      const selection = {
        role: "database" as const,
        score: 80,
        reason: "Matched database migrations and Supabase schema",
        objective: "Review schema, migrations, query behavior, RLS/data isolation",
      };
      const sharedContext = {
        repositoryEvidence: sampleEvidence,
        requestedNextSteps: ["Fix migration"],
        analysisContext: null,
        measuredLearning: { operationalMemory: ["Always verify migration rollback"] },
      };
      const diagnosis = {
        summary: "Article table missing RLS policies",
        findings: [
          {
            id: "f1",
            category: "database",
            severity: "high" as const,
            confidence: 85,
            evidence: ["supabase/migrations/20260101_init.sql"],
            rootCause: "RLS enabled without policies",
            alternativeCauses: [],
            recommendedAction: "Add RLS policies for article read/write",
            validation: "Test anonymous and authenticated queries against articles table",
          },
        ],
        unknowns: [],
      };
      const critic = {
        acceptedFindingIds: ["f1"],
        rejectedFindingIds: [],
        critique: ["Diagnosis is well supported"],
        regressionRisks: ["Existing readers might be blocked if policies are too strict"],
        missingEvidence: [],
        confidence: 90,
      };

      const context = buildSpecialistContext(selection, sharedContext, diagnosis, critic);

      expect(context.specialistRole).toBe("database");
      expect(context.repository.repo).toBe("patriotnewsactivism/ai-journalist");
      expect(context.relevantCodeSnippets).toHaveLength(1);
      expect(context.relevantCodeSnippets[0].path).toBe("supabase/migrations/20260101_init.sql");
      // Verify irrelevant files like CI workflow or frontend page are not dumped into database specialist
      expect(context.relevantCodeSnippets.map((s) => s.path)).not.toContain(".github/workflows/ci.yml");
    });
  });

  describe("buildDeterministicSpecialist", () => {
    it("creates an evidence-grounded fallback specialist result when a specialist times out", () => {
      const selection = {
        role: "qa-reliability" as const,
        reason: "Matched automated test suite and regression risks",
      };
      const fallback = buildDeterministicSpecialist(selection);

      expect(fallback.role).toBe("qa-reliability");
      expect(fallback.priorities).toContain("Matched automated test suite and regression risks");
      expect(fallback.confidence).toBe(50);
      expect(fallback.risks[0]).toContain("timed out or was unavailable");
    });
  });

  describe("buildDeterministicPlan", () => {
    it("constructs a complete fallback plan grounded in verified repository signals and operational memory", () => {
      const strategy = { version: "v4-strategy", arm: "incumbent" as const };
      const selections = [
        { role: "database" as const, reason: "Schema migrations" },
        { role: "devops-deployment" as const, reason: "CI workflow" },
      ];
      const memory = ["Check deployment preview before merge"];
      const legacy = ["Ensure test pass"];
      const plan = buildDeterministicPlan(
        "trace-123",
        "patriotnewsactivism/ai-journalist",
        strategy,
        selections,
        ["Add missing RLS"],
        memory,
        legacy,
        sampleEvidence,
        "Provider timed out; deterministic plan generated.",
      );

      expect(plan.traceId).toBe("trace-123");
      expect(plan.repo).toBe("patriotnewsactivism/ai-journalist");
      expect(plan.summary).toContain("Provider timed out");
      expect(plan.nextSteps).toContain("Add missing RLS");
      expect(plan.nextSteps).toContain("Check deployment preview before merge");
      expect(plan.evidence.repository.headSha).toBe("a1b2c3d4e5f67890123456789012345678901234");
      expect(plan.evidence.treeSignals.hasDatabaseMigrations).toBe(true);
      expect(plan.confidence).toBeGreaterThanOrEqual(35);
    });
  });
});
