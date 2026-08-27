import { describe, expect, it } from "vitest";
import {
  countFunctions,
  detectStubs,
  extractApiRoutes,
  extractEnvRefs,
  extractExports,
  extractFrontendRoutes,
  extractImports,
} from "./static-analysis";

describe("detectStubs", () => {
  it("reports one hit per line with kind and line number", () => {
    const source = ["const a = 1;", "// TODO: wire this up", "// FIXME broken", "const b = 2;"].join("\n");
    const hits = detectStubs(source, "src/a.ts");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ file: "src/a.ts", line: 2, kind: "todo" });
    expect(hits[1]).toMatchObject({ line: 3, kind: "fixme" });
  });

  it("does not fire on ordinary UI copy containing the word placeholder", () => {
    expect(detectStubs(`<input placeholder="Your email" />`, "src/f.tsx")).toHaveLength(0);
  });

  it("recognizes language-specific unimplemented markers", () => {
    expect(detectStubs("raise NotImplementedError", "a.py")[0]?.kind).toBe("unimplemented");
    expect(detectStubs("todo!()", "a.rs")[0]?.kind).toBe("todo");
  });
});

describe("countFunctions", () => {
  it("counts implemented and stubbed JS/TS functions separately", () => {
    const source = `
export function real(a: number) {
  return a * 2;
}
export function hollow() {}
const arrow = () => null;
export async function alsoReal() {
  const x = await load();
  return x;
}
`;
    const { total, stubbed } = countFunctions(source);
    expect(total).toBe(4);
    expect(stubbed).toBe(2);
  });

  it("treats a throw-not-implemented body as a stub", () => {
    const { total, stubbed } = countFunctions(`function f() { throw new Error("not implemented"); }`);
    expect(total).toBe(1);
    expect(stubbed).toBe(1);
  });

  it("picks the dominant language family rather than summing all of them", () => {
    const python = ["def a():", "    return 1", "def b():", "    return 2", "def c():", "    return 3"].join("\n");
    expect(countFunctions(python).total).toBe(3);
  });

  it("never reports more stubs than functions", () => {
    const { total, stubbed } = countFunctions("raise NotImplementedError\nraise NotImplementedError\ndef a(): pass");
    expect(stubbed).toBeLessThanOrEqual(total);
  });
});

describe("extractImports", () => {
  it("separates internal specifiers from bare package names", () => {
    const source = `
import express from "express";
import { thing } from "./thing";
import type { T } from "@/lib/types";
import { z } from "zod/v4";
const fs = require("node:fs");
const lazy = await import("@scope/pkg/deep/path");
`;
    const { internal, external } = extractImports(source);
    expect(internal).toEqual(["./thing", "@/lib/types"]);
    expect(external).toEqual(["@scope/pkg", "express", "node:fs", "zod"]);
  });
});

describe("extractExports", () => {
  it("collects declarations, export lists and default exports", () => {
    const source = `
export const a = 1;
export function b() {}
export type C = string;
export { d, e as f };
export default class G {}
`;
    expect(extractExports(source)).toEqual(["C", "a", "b", "d", "default", "f"]);
  });
});

describe("extractEnvRefs", () => {
  it("finds env references across access styles", () => {
    const source = `process.env.PORT; process.env["DATABASE_URL"]; import.meta.env.VITE_API_URL;`;
    expect(extractEnvRefs(source)).toEqual(["DATABASE_URL", "PORT", "VITE_API_URL"]);
  });
});

describe("route extraction", () => {
  it("extracts server routes with their verbs", () => {
    const source = `
router.get("/health", handler);
app.post("/api/repos", handler);
router.use("/api", sub);
`;
    expect(extractApiRoutes(source)).toEqual(["GET /health", "POST /api/repos", "USE /api"]);
  });

  it("extracts client routes and ignores relative ones", () => {
    const source = `<Route path="/dashboard" /><Route path="settings" />`;
    expect(extractFrontendRoutes(source)).toEqual(["/dashboard"]);
  });
});
