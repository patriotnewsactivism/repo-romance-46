/**
 * Repository type detection.
 *
 * Classification drives scoring: a library must not lose points for having no
 * login page, and a marketing site must not gain points for shipping a
 * Dockerfile it never uses. Every classification carries the evidence that
 * produced it so a reviewer can disagree with the machine on the facts.
 */

import type { Classification, RepoIndex, RepoKind } from "./types";

interface Rule {
  kind: RepoKind;
  /** Each satisfied signal contributes its weight to the kind's raw score. */
  signals: { weight: number; label: string; test: (index: RepoIndex) => boolean }[];
}

const hasDep = (index: RepoIndex, ...names: string[]): boolean =>
  index.dependencies.some((d) => names.includes(d.name));

const hasFileMatching = (index: RepoIndex, re: RegExp): boolean => index.files.some((f) => re.test(f.path));

const RULES: Rule[] = [
  {
    kind: "monorepo",
    signals: [
      { weight: 3, label: "workspace manifest present", test: (i) => hasFileMatching(i, /^(pnpm-workspace\.yaml|lerna\.json|turbo\.json|nx\.json)$/) },
      { weight: 2, label: "multiple package manifests", test: (i) => i.files.filter((f) => f.role === "manifest" && f.path.endsWith("package.json")).length > 2 },
    ],
  },
  {
    kind: "api",
    signals: [
      { weight: 3, label: "server routes registered", test: (i) => i.signals.apiRoutes.length >= 3 },
      { weight: 2, label: "server framework dependency", test: (i) => hasDep(i, "express", "fastify", "koa", "hapi", "@nestjs/core", "hono") },
      { weight: 1, label: "OpenAPI spec present", test: (i) => hasFileMatching(i, /openapi\.(ya?ml|json)$/i) },
      { weight: 1, label: "health endpoint exposed", test: (i) => i.signals.hasHealthEndpoint },
    ],
  },
  {
    kind: "web-app",
    signals: [
      { weight: 3, label: "client routes declared", test: (i) => i.signals.frontendRoutes.length >= 2 },
      { weight: 2, label: "frontend framework dependency", test: (i) => hasDep(i, "react", "vue", "svelte", "next", "nuxt", "@angular/core") },
      { weight: 1, label: "index.html entry point", test: (i) => hasFileMatching(i, /(^|\/)index\.html$/) },
      { weight: 1, label: "bundler config present", test: (i) => hasFileMatching(i, /(^|\/)(vite|webpack|rollup)\.config\./) },
    ],
  },
  {
    kind: "saas",
    signals: [
      { weight: 3, label: "authentication present", test: (i) => i.signals.hasAuth },
      { weight: 3, label: "billing integration", test: (i) => hasDep(i, "stripe", "@stripe/stripe-js", "paddle-sdk", "lemonsqueezy") },
      { weight: 2, label: "persistent data layer", test: (i) => i.signals.hasMigrations || hasDep(i, "drizzle-orm", "prisma", "typeorm", "sequelize", "mongoose") },
      { weight: 1, label: "multi-tenant vocabulary in routes", test: (i) => i.signals.apiRoutes.some((r) => /\/(org|team|workspace|tenant|account|subscription)/.test(r)) },
    ],
  },
  {
    kind: "mobile-app",
    signals: [
      { weight: 4, label: "React Native / Expo dependency", test: (i) => hasDep(i, "react-native", "expo") },
      { weight: 3, label: "native project files", test: (i) => hasFileMatching(i, /(^|\/)(android\/|ios\/|pubspec\.yaml)/) },
      { weight: 2, label: "app config present", test: (i) => hasFileMatching(i, /(^|\/)app\.(json|config\.[jt]s)$/) },
    ],
  },
  {
    kind: "cli",
    signals: [
      { weight: 3, label: "CLI argument parser dependency", test: (i) => hasDep(i, "commander", "yargs", "clipanion", "oclif", "click", "argparse", "cobra") },
      { weight: 2, label: "bin entry or CLI source file", test: (i) => hasFileMatching(i, /(^|\/)(bin\/|cli\.[a-z]+$)/) },
    ],
  },
  {
    kind: "library",
    signals: [
      { weight: 3, label: "public exports without an app entry point", test: (i) => i.modules.some((m) => m.exports.length >= 3) && i.signals.frontendRoutes.length === 0 && i.signals.apiRoutes.length === 0 },
      { weight: 2, label: "no deployment or container config", test: (i) => !i.signals.hasDeployConfig && !i.signals.hasDockerfile },
      { weight: 1, label: "test suite present", test: (i) => i.signals.hasTests },
    ],
  },
  {
    kind: "ai-agent",
    signals: [
      { weight: 3, label: "LLM provider SDK dependency", test: (i) => hasDep(i, "openai", "@anthropic-ai/sdk", "@google/generative-ai", "langchain", "llamaindex", "ai") },
      { weight: 2, label: "agent/prompt vocabulary in module names", test: (i) => i.modules.some((m) => /(agent|prompt|llm|completion|embedding)/i.test(m.id)) },
    ],
  },
  {
    kind: "browser-extension",
    signals: [
      { weight: 4, label: "extension manifest present", test: (i) => hasFileMatching(i, /(^|\/)manifest\.json$/) && i.files.some((f) => /(^|\/)(background|content[_-]?script)/i.test(f.path)) },
    ],
  },
  {
    kind: "static-site",
    signals: [
      { weight: 3, label: "static site generator config", test: (i) => hasFileMatching(i, /(^|\/)(_config\.yml|astro\.config\.[a-z]+|hugo\.toml|gatsby-config\.[a-z]+|11ty\.[a-z]+)$/) },
      { weight: 2, label: "content-heavy repository", test: (i) => i.signals.docFileCount > i.signals.sourceFileCount },
    ],
  },
  {
    kind: "data-pipeline",
    signals: [
      { weight: 3, label: "orchestration dependency", test: (i) => hasDep(i, "airflow", "apache-airflow", "prefect", "dagster", "luigi", "kafkajs") },
      { weight: 2, label: "pipeline vocabulary in module names", test: (i) => i.modules.some((m) => /(etl|pipeline|ingest|transform|dag)/i.test(m.id)) },
    ],
  },
  {
    kind: "infrastructure",
    signals: [
      { weight: 3, label: "infrastructure-as-code files", test: (i) => hasFileMatching(i, /\.(tf|tfvars)$|(^|\/)(helm|k8s|kustomize)\//) },
      { weight: 2, label: "container orchestration config", test: (i) => i.signals.hasContainerOrchestration },
    ],
  },
  {
    kind: "ecommerce",
    signals: [
      { weight: 3, label: "commerce platform dependency", test: (i) => hasDep(i, "shopify-api-node", "@shopify/shopify-api", "medusa", "commercejs", "swell-js") },
      { weight: 2, label: "cart/checkout routes", test: (i) => [...i.signals.apiRoutes, ...i.signals.frontendRoutes].some((r) => /\/(cart|checkout|orders?|products?)/.test(r)) },
    ],
  },
  {
    kind: "game",
    signals: [
      { weight: 3, label: "game engine dependency", test: (i) => hasDep(i, "phaser", "three", "babylonjs", "pixi.js", "matter-js") },
      { weight: 2, label: "game loop vocabulary", test: (i) => i.modules.some((m) => /(scene|sprite|entity|physics)/i.test(m.id)) },
    ],
  },
  {
    kind: "dev-tool",
    signals: [
      { weight: 2, label: "tooling vocabulary in module names", test: (i) => i.modules.some((m) => /(codemod|lint|formatter|compiler|bundler|generator|scaffold)/i.test(m.id)) },
      { weight: 2, label: "compiler/AST dependency", test: (i) => hasDep(i, "typescript", "@babel/core", "esbuild", "acorn", "ts-morph") && i.signals.frontendRoutes.length === 0 },
    ],
  },
];

/** Minimum raw score before a kind is reported at all. */
const MIN_RAW_SCORE = 3;

/**
 * Detect every kind the repository plausibly is, strongest first.
 * Always returns at least one entry; falls back to `library` with low
 * confidence when nothing matches, because that penalizes the fewest things.
 */
export function classifyRepository(index: RepoIndex): Classification[] {
  const results: Classification[] = [];

  for (const rule of RULES) {
    const matched = rule.signals.filter((s) => s.test(index));
    const raw = matched.reduce((sum, s) => sum + s.weight, 0);
    if (raw < MIN_RAW_SCORE) continue;

    const max = rule.signals.reduce((sum, s) => sum + s.weight, 0);
    results.push({
      kind: rule.kind,
      confidence: Math.round((raw / max) * 100) / 100,
      evidence: matched.map((s) => s.label),
    });
  }

  if (results.length === 0) {
    return [
      {
        kind: "library",
        confidence: 0.2,
        evidence: ["No decisive product signals found — defaulting to the least-penalizing profile"],
      },
    ];
  }

  return results.sort((a, b) => b.confidence - a.confidence || a.kind.localeCompare(b.kind));
}

/**
 * The single kind whose weight profile should drive scoring.
 * `monorepo` is a structural fact rather than a product shape, so it never
 * wins on its own — the strongest product classification does.
 */
export function primaryKind(classifications: Classification[]): RepoKind {
  const productKinds = classifications.filter((c) => c.kind !== "monorepo");
  return productKinds[0]?.kind ?? classifications[0]?.kind ?? "library";
}
