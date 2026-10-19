import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Ledger, LedgerEntry } from "./types.js";

export interface GateConfig {
  blockedCooldownMs: number;
  prCooldownMs: number;
  dailyDebateCap: number;
  maxOpenPrs: number;
}

export const DEFAULT_GATE: GateConfig = {
  blockedCooldownMs: 24 * 60 * 60 * 1000,
  prCooldownMs: 7 * 24 * 60 * 60 * 1000,
  dailyDebateCap: 4,
  maxOpenPrs: 1,
};

export type GateDecision = { allow: true } | { allow: false; reason: string };

const day = (d: Date) => d.toISOString().slice(0, 10);

export function emptyLedger(): Ledger {
  return { entries: [], debateDay: "", debateCount: 0 };
}

/** Pure gate: every refusal happens before any LLM spend. */
export function gate(
  ledger: Ledger,
  signature: string,
  now: Date,
  openAutoFixPrs: number,
  cfg: GateConfig = DEFAULT_GATE,
): GateDecision {
  if (openAutoFixPrs >= cfg.maxOpenPrs) return { allow: false, reason: "open_pr_cap" };
  const latest = [...ledger.entries].reverse().find((e) => e.signature === signature);
  if (latest) {
    const age = now.getTime() - Date.parse(latest.at);
    const window = latest.status === "pr_opened" ? cfg.prCooldownMs : cfg.blockedCooldownMs;
    if (age < window) return { allow: false, reason: latest.status === "pr_opened" ? "already_has_pr" : "blocked_cooldown" };
  }
  const used = ledger.debateDay === day(now) ? ledger.debateCount : 0;
  if (used >= cfg.dailyDebateCap) return { allow: false, reason: "daily_debate_cap" };
  return { allow: true };
}

export function recordDebate(ledger: Ledger, now: Date): Ledger {
  const today = day(now);
  const count = ledger.debateDay === today ? ledger.debateCount : 0;
  return { ...ledger, debateDay: today, debateCount: count + 1 };
}

export function recordOutcome(ledger: Ledger, entry: LedgerEntry): Ledger {
  // Keep the file small: drop entries older than the longest cooldown.
  const cutoff = Date.parse(entry.at) - DEFAULT_GATE.prCooldownMs;
  const kept = ledger.entries.filter((e) => Date.parse(e.at) >= cutoff);
  return { ...ledger, entries: [...kept, entry] };
}

export function loadLedger(path: string): Ledger {
  if (!existsSync(path)) return emptyLedger();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Ledger>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      debateDay: typeof parsed.debateDay === "string" ? parsed.debateDay : "",
      debateCount: typeof parsed.debateCount === "number" ? parsed.debateCount : 0,
    };
  } catch {
    // A corrupt ledger must fail closed on spend, not reset the daily cap.
    throw new Error(`Ledger at ${path} is unreadable; refusing to run without spend accounting`);
  }
}

export function saveLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
}
