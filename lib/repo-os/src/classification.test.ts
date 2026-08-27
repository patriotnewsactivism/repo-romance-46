import { describe, expect, it } from "vitest";
import { classifyRepository, primaryKind } from "./classification";
import { abandonedScaffoldFixture, healthyApiFixture, indexFixture, libraryFixture } from "./repo.fixtures";

describe("classifyRepository", () => {
  it("recognizes an Express service as an API", () => {
    const kinds = classifyRepository(healthyApiFixture()).map((c) => c.kind);
    expect(kinds).toContain("api");
    expect(primaryKind(classifyRepository(healthyApiFixture()))).toBe("api");
  });

  it("recognizes a package with exports and no app surface as a library", () => {
    const result = classifyRepository(libraryFixture());
    expect(result.map((c) => c.kind)).toContain("library");
  });

  it("attaches the evidence that produced each classification", () => {
    const api = classifyRepository(healthyApiFixture()).find((c) => c.kind === "api");
    expect(api?.evidence).toContain("server framework dependency");
    expect(api?.confidence).toBeGreaterThan(0);
    expect(api?.confidence).toBeLessThanOrEqual(1);
  });

  it("classifies a stubbed scaffold by shape, not by how finished it is", () => {
    // The scaffold exports symbols and serves nothing — that is a library
    // shape even though almost none of it is implemented. Completeness is
    // scoring's job, not classification's.
    const result = classifyRepository(abandonedScaffoldFixture());
    expect(result[0]?.kind).toBe("library");
  });

  it("falls back to the least-penalizing profile when nothing matches", () => {
    const empty = indexFixture({ repo: "acme/empty", tree: [], files: [] });
    const result = classifyRepository(empty);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("library");
    expect(result[0]?.confidence).toBeLessThan(0.5);
    expect(result[0]?.evidence[0]).toMatch(/No decisive product signals/);
  });

  it("never lets the structural monorepo tag drive scoring on its own", () => {
    expect(
      primaryKind([
        { kind: "monorepo", confidence: 1, evidence: [] },
        { kind: "web-app", confidence: 0.5, evidence: [] },
      ]),
    ).toBe("web-app");
  });
});
