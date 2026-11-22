import { describe, expect, it } from "vitest";
import { buildRepoBusinessReport, type RepoSignalInput } from "./repo-business-engine";
import {
  BUILDER_PROMPT_VERSION,
  buildImprovementSuggestions,
  composeFinalityPrompt,
  scorePromptQuality,
} from "./builder-prompt-composer";

const bareRepo: RepoSignalInput = {
  repo: "acme/half-built",
  description: null,
  language: "TypeScript",
  stars: 0,
  forks: 0,
  openIssues: 0,
  hasReadme: false,
  hasTests: false,
  hasCi: false,
  hasDocker: false,
  hasDeployConfig: false,
  hasEnvExample: false,
  hasLicense: false,
  hasDocs: false,
  hasFrontendSignals: true,
  hasBackendSignals: true,
  hasAuthSignals: false,
  hasPaymentsSignals: false,
};

const strongRepo: RepoSignalInput = {
  ...bareRepo,
  repo: "acme/launchpad",
  description: "Customer onboarding platform with Stripe billing",
  stars: 400,
  forks: 30,
  fileCount: 300,
  pushedAt: new Date().toISOString(),
  hasReadme: true,
  hasTests: true,
  hasCi: true,
  hasDocker: true,
  hasDeployConfig: true,
  hasEnvExample: true,
  hasLicense: true,
  hasDocs: true,
  hasContributing: true,
  hasDatabaseMigrations: true,
  hasAuthSignals: true,
  hasPaymentsSignals: true,
  hasObservabilitySignals: true,
  completionPct: 90,
  productionReadinessPct: 88,
  marketNeed: 82,
  demand: 76,
  competitivePressure: 30,
  uniquenessPct: 72,
  commercializationProbability: 70,
  evidenceConfidence: 80,
  remainingHours: 25,
};

function suggestionsFor(input: RepoSignalInput, limit = 18) {
  const report = buildRepoBusinessReport(input);
  return { report, suggestions: buildImprovementSuggestions({ input, report }, { limit }) };
}

describe("buildImprovementSuggestions", () => {
  it("produces plenty of suggestions for a bare repository", () => {
    const { suggestions } = suggestionsFor(bareRepo);
    expect(suggestions.length).toBeGreaterThanOrEqual(12);
    expect(new Set(suggestions.map((suggestion) => suggestion.id)).size).toBe(suggestions.length);
  });

  it("ranks by impact per unit of effort", () => {
    const { suggestions } = suggestionsFor(bareRepo);
    for (let index = 1; index < suggestions.length; index += 1) {
      expect(suggestions[index - 1].priority).toBeGreaterThanOrEqual(suggestions[index].priority);
    }
  });

  it("gives every suggestion its own executable builder prompt", () => {
    const { suggestions } = suggestionsFor(bareRepo);
    for (const suggestion of suggestions) {
      expect(suggestion.acceptance.length).toBeGreaterThan(0);
      expect(suggestion.builderPrompt).toContain(suggestion.title);
      expect(suggestion.builderPrompt).toContain("## Acceptance criteria");
      expect(suggestion.builderPrompt).toContain("## Finality contract");
      expect(suggestion.builderPrompt).toContain("A criterion without evidence is not met.");
    }
  });

  it("targets the actual gaps the repository has", () => {
    const { suggestions } = suggestionsFor(bareRepo);
    const titles = suggestions.map((suggestion) => suggestion.title.toLowerCase()).join(" | ");
    expect(titles).toContain("test");
    expect(titles).toContain("ci");
    expect(titles).toContain("readme");
  });

  it("does not ask a finished repository to add what it already has", () => {
    const { suggestions } = suggestionsFor(strongRepo);
    const ids = suggestions.map((suggestion) => suggestion.id);
    expect(ids).not.toContain("tests-missing");
    expect(ids).not.toContain("ci-missing");
    expect(ids).not.toContain("readme-missing");
  });

  it("folds in suggestions from the latest analysis without duplicating titles", () => {
    const input: RepoSignalInput = {
      ...bareRepo,
      suggestions: [
        { title: "Add a real automated test suite around the critical path", action: "Same as the built-in rule", effort: 3 },
        { title: "Ship an onboarding tour", action: "Guide new users to the first action", effort: 2 },
      ],
    };
    const { suggestions } = suggestionsFor(input, 30);
    const matching = suggestions.filter((suggestion) => suggestion.title.toLowerCase().includes("automated test suite"));
    expect(matching).toHaveLength(1);
    expect(suggestions.some((suggestion) => suggestion.title === "Ship an onboarding tour")).toBe(true);
  });

  it("respects the requested limit", () => {
    const { suggestions } = suggestionsFor(bareRepo, 6);
    expect(suggestions).toHaveLength(6);
  });
});

describe("composeFinalityPrompt", () => {
  it("emits a complete finality contract that passes every quality clause", () => {
    const { report, suggestions } = suggestionsFor(bareRepo);
    const composed = composeFinalityPrompt(report, bareRepo, suggestions);
    expect(composed.promptVersion).toBe(BUILDER_PROMPT_VERSION);
    expect(composed.quality.score).toBe(100);
    expect(composed.quality.checks.every((check) => check.passed)).toBe(true);
    expect(composed.includedSuggestionIds.length).toBeGreaterThanOrEqual(3);
  });

  it("contains the evidence a builder agent needs to act", () => {
    const { report, suggestions } = suggestionsFor(strongRepo);
    const composed = composeFinalityPrompt(report, strongRepo, suggestions, { topN: 5 });
    expect(composed.prompt).toContain("acme/launchpad");
    expect(composed.prompt).toContain("Grade:");
    expect(composed.prompt).toContain("Demand:");
    expect(composed.prompt).toContain("Present fair-market value:");
    expect(composed.prompt).toContain("Definition of Done");
    expect(composed.prompt).toContain("Stop conditions");
    expect(composed.prompt).toContain("Required final report");
    expect(composed.prompt).toContain("draft** pull request");
  });

  it("changes tool guidance per builder target", () => {
    const { report, suggestions } = suggestionsFor(bareRepo);
    const codex = composeFinalityPrompt(report, bareRepo, suggestions, { target: "codex" });
    const claude = composeFinalityPrompt(report, bareRepo, suggestions, { target: "claude-code" });
    expect(codex.prompt).toContain("Use Codex repository and shell tools");
    expect(claude.prompt).toContain("Use Claude Code's search, edit, and terminal tools");
    expect(codex.prompt).not.toBe(claude.prompt);
  });

  it("includes ordered work items with acceptance criteria", () => {
    const { report, suggestions } = suggestionsFor(bareRepo);
    const composed = composeFinalityPrompt(report, bareRepo, suggestions, { topN: 4 });
    expect(composed.prompt).toContain("1. ");
    expect(composed.prompt).toContain("Acceptance:");
    expect(composed.includedSuggestionIds).toHaveLength(4);
  });
});

describe("scorePromptQuality", () => {
  it("fails a prompt that only names a goal", () => {
    const quality = scorePromptQuality("Make the app better and finish it.");
    expect(quality.score).toBeLessThan(40);
    expect(quality.checks.filter((check) => check.passed)).toHaveLength(0);
  });

  it("is deterministic", () => {
    const { report, suggestions } = suggestionsFor(bareRepo);
    const first = composeFinalityPrompt(report, bareRepo, suggestions).quality;
    const second = composeFinalityPrompt(report, bareRepo, suggestions).quality;
    expect(first).toEqual(second);
  });
});
