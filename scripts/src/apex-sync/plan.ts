import type { FileChange, HandoffPayload, Incident } from "./types.js";

export function buildPayload(incident: Incident, traceId: string, maxIterations = 2): HandoffPayload {
  return {
    trace_id: traceId,
    source: "repo-romance-46",
    target_system: "apex-runtime",
    incident: {
      severity: incident.severity,
      component: incident.component,
      error_signature: incident.errorSignature,
    },
    proposed_patch: {
      summary: `Minimal fix for ${incident.component}: ${incident.errorSignature}`.slice(0, 300),
      diff_preview: "",
      verification_test: incident.testPath ?? "",
    },
    debate_constraints: {
      require_test_evidence: true,
      max_iterations: maxIterations,
      fail_closed_if_unverified: true,
    },
  };
}

/**
 * Map the handoff payload onto Think Tank's real /api/debate shape ({input, customContext}).
 * Think Tank cannot run the target repo's tests, so the prompt asks for full-file blocks it can
 * parse (`=== FILE: path ===`); the Finisher verifies locally and treats the output as advisory.
 */
export function renderDebateInput(
  payload: HandoffPayload,
  files: FileChange[],
  allowedFiles: string[],
  priorFailure?: string,
): { input: string; customContext: string } {
  const input = [
    `Fix this production incident with the smallest possible change.`,
    `Severity: ${payload.incident.severity}`,
    `Component: ${payload.incident.component}`,
    `Failure signature: ${payload.incident.error_signature}`,
    ``,
    `Rules:`,
    `- Only modify these files: ${allowedFiles.join(", ")}.`,
    `- You MUST also add exactly one regression test file (*.test.ts, under a __tests__ directory in the same package) that FAILS on the current code and PASSES after your fix.`,
    `- Do not touch package.json, lockfiles, workflows, or environment files. Preserve unrelated behavior.`,
    `- Output each changed or new file in full as:`,
    `=== FILE: path/relative/to/repo/root ===`,
    "```ts",
    `<entire file contents>`,
    "```",
    `- Agreement between reviewers is not proof; the patch will be accepted only if the test fails before and passes after, run locally.`,
    priorFailure ? `\nYour previous attempt FAILED verification. Output tail:\n${priorFailure}\nRevise accordingly.` : ``,
  ].join("\n");

  const customContext = files
    .map((f) => `--- CURRENT FILE: ${f.path} ---\n${f.content}`)
    .join("\n\n");
  return { input, customContext };
}
