import { describe, expect, it } from "vitest";
import { createSimplePdf } from "./simple-pdf";

describe("createSimplePdf", () => {
  it("creates a valid multi-page PDF envelope without external dependencies", () => {
    const blocks = Array.from({ length: 180 }, (_, index) => ({
      kind: "paragraph" as const,
      text: `Evidence-backed investor report line ${index + 1}: values are planning estimates, not audited financial results.`,
    }));
    const pdf = createSimplePdf("RepoFinisher Investor Report", blocks);
    const text = pdf.toString("utf8");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Type /Pages");
    expect(text).toContain("RepoFinisher Investor Report");
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
