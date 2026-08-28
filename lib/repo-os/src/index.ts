/**
 * `@workspace/repo-os` — the deterministic core of the Repository Completion
 * Operating System.
 *
 * Everything exported here is pure and testable. LLM calls, GitHub calls and
 * persistence live in the API server; this package decides *what is true* and
 * *what is allowed*, so those decisions can be unit-tested and audited rather
 * than re-derived by a model on every run.
 */

export * from "./types";
export * from "./static-analysis";
export * from "./indexing";
export * from "./classification";
export * from "./scoring";
export * from "./valuation";
export * from "./investment-intelligence";
export * from "./portfolio-valuation";
export * from "./portfolio";
export * from "./run-state";
export * from "./approvals";
export * from "./recommendations";
