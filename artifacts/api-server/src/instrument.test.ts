import { describe, expect, it } from "vitest";
import { parseSampleRate, sanitizeUrl, scrubTelemetry } from "./instrument";

describe("Sentry telemetry privacy", () => {
  it("clamps trace sample rates and falls back on invalid values", () => {
    expect(parseSampleRate("2")).toBe(1);
    expect(parseSampleRate("-1")).toBe(0);
    expect(parseSampleRate("invalid", 0.2)).toBe(0.2);
  });

  it("removes query strings and fragments from absolute and relative URLs", () => {
    expect(sanitizeUrl("https://example.com/api/run?token=secret#part")).toBe(
      "https://example.com/api/run",
    );
    expect(sanitizeUrl("/api/run?token=secret")).toBe("/api/run");
  });

  it("recursively filters credential-shaped fields", () => {
    expect(
      scrubTelemetry({
        safe: "value",
        authorization: "Bearer secret",
        nested: { api_key: "secret", count: 2 },
      }),
    ).toEqual({
      safe: "value",
      authorization: "[Filtered]",
      nested: { api_key: "[Filtered]", count: 2 },
    });
  });
});
