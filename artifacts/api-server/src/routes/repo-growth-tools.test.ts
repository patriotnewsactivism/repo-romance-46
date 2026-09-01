import { describe, expect, it } from "vitest";
import { isDocumentationPath } from "./repo-growth-tools";

describe("documentation-only guard", () => {
  it("allows documentation sources of truth", () => {
    expect(isDocumentationPath("README.md")).toBe(true);
    expect(isDocumentationPath("AGENTS.md")).toBe(true);
    expect(isDocumentationPath("PLAN.md")).toBe(true);
    expect(isDocumentationPath("ROADMAP.v2.md")).toBe(true);
    expect(isDocumentationPath("docs/ARCHITECTURE.md")).toBe(true);
    expect(isDocumentationPath("SECURITY.md")).toBe(true);
  });

  it("rejects code, workflows, migrations, environment files, and lockfiles", () => {
    expect(isDocumentationPath("src/index.ts")).toBe(false);
    expect(isDocumentationPath(".github/workflows/ci.yml")).toBe(false);
    expect(isDocumentationPath("supabase/migrations/20260831.sql")).toBe(false);
    expect(isDocumentationPath(".env.example")).toBe(false);
    expect(isDocumentationPath("pnpm-lock.yaml")).toBe(false);
  });
});
