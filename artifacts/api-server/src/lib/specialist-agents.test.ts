import { describe, expect, it } from "vitest";
import { selectSpecialists } from "./specialist-agents";

describe("selectSpecialists", () => {
  it("selects database and security specialists for Supabase/RLS work", () => {
    const selected = selectSpecialists({
      repo: "acme/app",
      language: "TypeScript",
      requestedNextSteps: ["Fix Supabase migration and RLS auth permissions"],
    });
    expect(selected.map((item) => item.role)).toContain("database");
    expect(selected.map((item) => item.role)).toContain("security-auth");
  });

  it("selects frontend and accessibility specialists for responsive UI work", () => {
    const selected = selectSpecialists({
      repo: "acme/dashboard",
      language: "TypeScript",
      description: "React dashboard UI",
      requestedNextSteps: ["Fix mobile navigation, keyboard focus, ARIA and contrast"],
    });
    expect(selected.map((item) => item.role)).toContain("frontend-ux");
    expect(selected.map((item) => item.role)).toContain("accessibility");
  });

  it("selects AI and reliability expertise for model-evaluation work", () => {
    const selected = selectSpecialists({
      repo: "acme/agent",
      language: "Python",
      description: "LLM retrieval service",
      requestedNextSteps: ["Add RAG evaluation, retries, regression tests and telemetry"],
    });
    expect(selected.map((item) => item.role)).toContain("data-ai");
    expect(selected.map((item) => item.role)).toContain("qa-reliability");
  });

  it("caps dynamic specialists at three", () => {
    const selected = selectSpecialists({
      repo: "acme/platform",
      language: "TypeScript",
      description: "React API platform with Supabase auth, Stripe billing and Vercel deployment",
      requestedNextSteps: ["Fix database migration, CI deployment, accessibility, OAuth and checkout"],
    });
    expect(selected.length).toBeLessThanOrEqual(3);
  });

  it("does not spawn specialists from incidental substrings", () => {
    const selected = selectSpecialists({
      repo: "acme/unknown",
      description: "Rapid decision service requiring contextual build metadata",
    });
    expect(selected.map((item) => item.role)).not.toContain("backend-api");
    expect(selected.map((item) => item.role)).not.toContain("frontend-ux");
    expect(selected.map((item) => item.role)).not.toContain("devops-deployment");
  });

  it("does not spawn specialists without repository evidence", () => {
    const selected = selectSpecialists({ repo: "acme/unknown" });
    expect(selected).toEqual([]);
  });
});
