import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const repairMocks = vi.hoisted(() => ({
  tryScheduleCiRepair: vi.fn(),
  markLatestRepairVerified: vi.fn(),
}));

vi.mock("../lib/ci-repair", () => repairMocks);

import { setIndividualVerification } from "./portfolio-finisher";

function successfulChain() {
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.then = (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve);
  return chain;
}

describe("Finish Portfolio verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a failed child active when bounded CI repair is scheduled", async () => {
    repairMocks.tryScheduleCiRepair.mockResolvedValue(true);
    const chain = successfulChain();
    const from = vi.fn(() => chain);

    await setIndividualVerification(
      { from } as unknown as SupabaseClient,
      "user-1",
      {
        id: "item-1",
        portfolio_run_id: "portfolio-1",
        completion_run_id: "run-1",
        status: "verifying",
      } as never,
      {
        id: "run-1",
        repo: "owner/repo",
        status: "verifying",
        branch_name: "repo-finisher/run-1",
        head_sha: "abc123",
        auto_repair_enabled: true,
        repair_attempts: 0,
        max_repair_attempts: 3,
      },
      {
        state: "failed",
        message: "One required check failed.",
        totalChecks: 2,
        completedChecks: 2,
        failedChecks: [{ name: "test", status: "completed", conclusion: "failure" }],
      } as never,
    );

    expect(repairMocks.tryScheduleCiRepair).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("portfolio_completion_items");
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "verifying",
      error: null,
      completed_at: null,
    }));
    expect(repairMocks.markLatestRepairVerified).not.toHaveBeenCalled();
  });
});
