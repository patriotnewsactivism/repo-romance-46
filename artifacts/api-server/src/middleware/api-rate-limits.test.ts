import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiCors,
  installApiRateLimits,
  normalizeRateLimitPath,
  rateLimitRetryAfter,
} from "./api-rate-limits";

const servers: Server[] = [];
const canonicalOrigin = "https://portfolio.donmatthews.live";

async function harness(options: Parameters<typeof installApiRateLimits>[1] = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(apiCors([canonicalOrigin, "https://repo-romance-46-swart.vercel.app"]));
  app.use(express.json());
  installApiRateLimits(app, options);
  app.use((_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      origin: canonicalOrigin,
      "x-forwarded-for": "198.51.100.10",
      ...init.headers,
    },
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("API rate limits over HTTP", () => {
  it("exposes real cooldown headers to exact allowed origins only", async () => {
    const request = await harness({ limits: { global: 1 } });
    expect((await request("/api/preferences")).status).toBe(200);
    const limited = await request("/api/preferences/ai", { method: "PATCH" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-allow-origin")).toBe(canonicalOrigin);
    expect(limited.headers.get("access-control-allow-credentials")).toBe("true");
    expect(limited.headers.get("access-control-expose-headers")).toBe("Retry-After,RateLimit,RateLimit-Policy");
    expect(limited.headers.get("ratelimit")).toMatch(/^limit=1, remaining=0, reset=\d+$/);
    expect(limited.headers.get("ratelimit-policy")).toBe("1;w=60");
    expect(limited.headers.get("x-ratelimit-limit")).toBeNull();
    const body = await limited.json() as { retry_after: number };
    expect(body).toMatchObject({ error: "Too many requests — slow down.", code: "API_RATE_LIMITED", limiter: "global" });
    expect(body.retry_after).toBe(Number(limited.headers.get("retry-after")));
    expect(Number.isInteger(body.retry_after)).toBe(true);
    expect(body.retry_after).toBeGreaterThan(0);
    expect(body.retry_after).toBeLessThanOrEqual(60);

    const denied = await request("/api/preferences", { headers: { origin: `${canonicalOrigin}.attacker.example` } });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    expect(denied.headers.get("access-control-expose-headers")).toBeNull();
    const alternate = await request("/api/preferences", { headers: { origin: "https://repo-romance-46-swart.vercel.app" } });
    expect(alternate.headers.get("access-control-allow-origin")).toBe("https://repo-romance-46-swart.vercel.app");
  });

  it("preserves the 300-read, 10-expensive-write and 30-telemetry production budgets", async () => {
    const request = await harness();
    for (let count = 0; count < 10; count++) expect((await request("/api/preferences/ai-test", { method: "POST" })).status).toBe(200);
    const expensive = await request("/api/preferences/ai-test", { method: "POST" });
    expect(expensive.status).toBe(429);
    expect(await expensive.json()).toMatchObject({
      limiter: "expensive",
      error: "Too many analysis or repository-write requests — try again in a minute.",
    });

    for (let count = 0; count < 30; count++) expect((await request("/api/observability/client-error", { method: "POST" })).status).toBe(200);
    const telemetry = await request("/api/observability/client-error", { method: "POST" });
    expect(telemetry.status).toBe(429);
    expect(await telemetry.json()).toMatchObject({ limiter: "telemetry", error: "Too many client error reports — slow down." });

    // A separate IP gets the full global allowance, and preference saves never
    // consume the analysis/write quota.
    for (let count = 0; count < 300; count++) {
      expect((await request("/api/preferences/ai", { method: "PATCH", headers: { "x-forwarded-for": "198.51.100.11" } })).status).toBe(200);
    }
    const global = await request("/api/healthz", { headers: { "x-forwarded-for": "198.51.100.11" } });
    expect(global.status).toBe(429);
    expect(await global.json()).toMatchObject({ limiter: "global" });
  });

  it("skips inexpensive GET, HEAD and OPTIONS requests without consuming writes", async () => {
    const request = await harness({ limits: { expensive: 1 } });
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      for (let count = 0; count < 3; count++) expect((await request("/api/repo-finisher/runs/run-id", { method })).status).toBeLessThan(400);
    }
    expect((await request("/api/repo-finisher/runs/run-id/execute", { method: "POST" })).status).toBe(200);
    expect((await request("/api/repo-finisher/runs/run-id/execute", { method: "POST" })).status).toBe(429);
    // Exhausting writes still permits cheap status reads.
    expect((await request("/api/repo-finisher/runs/run-id")).status).toBe(200);
  });

  it("keeps one trusted proxy hop and cannot bypass budgets with identity claims", async () => {
    const request = await harness({ limits: { global: 2 } });
    expect((await request("/api/preferences", { headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.7", authorization: "Bearer identity-one" } })).status).toBe(200);
    expect((await request("/api/preferences", { headers: { "x-forwarded-for": "198.51.100.2, 203.0.113.7", authorization: "Bearer identity-two", "x-user-id": "different-user" } })).status).toBe(200);
    expect((await request("/api/preferences", { headers: { "x-forwarded-for": "198.51.100.3, 203.0.113.7" } })).status).toBe(429);
    expect((await request("/api/preferences", { headers: { "x-forwarded-for": "198.51.100.3, 203.0.113.8" } })).status).toBe(200);
  });

  it("logs pseudonymous bucket and bounded route labels across routes and limiters", async () => {
    const logger = { warn: vi.fn() };
    const request = await harness({ logger, limits: { expensive: 1, telemetry: 1 } });
    await request("/api/repo-finisher/runs/private-run/execute", { method: "POST" });
    const headers = { authorization: "Bearer secret-token", "content-type": "application/json" };
    await request("/api/repo-finisher/runs/private-run/execute?api_key=private-key", { method: "POST", headers, body: JSON.stringify({ apiKey: "secret-body" }) });
    await request("/api/repo-finisher/completion-sessions/private-session/resume", { method: "POST" });
    await request("/api/observability/client-error", { method: "POST" });
    await request("/api/observability/client-error", { method: "POST" });
    const fields = logger.warn.mock.calls.map((call) => call[0]);
    expect(fields).toHaveLength(3);
    expect(fields[0]).toMatchObject({
      event: "api_rate_limited", limiter: "expensive", method: "POST",
      route: "/api/repo-finisher/runs/:id/execute", limit: 1, used: 2,
      request_ip_source: "trusted_forwarded", trusted_forwarded_hops: 1,
      forwarded_header_present: true, forwarded_header_entries: 1,
      selected_ip_equals_socket_peer: false,
    });
    expect(fields[1].route).toBe("/api/repo-finisher/completion-sessions/:id/resume");
    expect(fields[2].limiter).toBe("telemetry");
    expect(fields[0].ip_bucket).toMatch(/^[a-f0-9]{24}$/);
    expect(new Set(fields.map((field) => field.ip_bucket)).size).toBe(1);
    expect(fields[0].reset_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const serialized = JSON.stringify(fields);
    for (const secret of ["private-run", "private-session", "private-key", "secret-token", "secret-body", "198.51.100.10", "api_key"]) expect(serialized).not.toContain(secret);
  });

  it("uses the actual IPv6 subnet bucket for enforcement and diagnostics", async () => {
    const logger = { warn: vi.fn() };
    const request = await harness({ logger, limits: { global: 1 } });
    const sameSubnet = ["2001:db8:abcd:1201::1", "2001:db8:abcd:12ff::2", "2001:db8:abcd:1280::3"];
    expect((await request("/api/preferences", { headers: { "x-forwarded-for": sameSubnet[0] } })).status).toBe(200);
    expect((await request("/api/preferences", { headers: { "x-forwarded-for": sameSubnet[1] } })).status).toBe(429);
    expect((await request("/api/preferences", { headers: { "x-forwarded-for": sameSubnet[2] } })).status).toBe(429);
    expect(logger.warn.mock.calls[0][0].ip_bucket).toBe(logger.warn.mock.calls[1][0].ip_bucket);
    expect((await request("/api/preferences", { headers: { "x-forwarded-for": "2001:db8:abcd:1301::1" } })).status).toBe(200);
    for (const ip of sameSubnet) expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(ip);
  });

  it("recovers after the actual memory-store window resets", async () => {
    const request = await harness({ windowMs: 100, limits: { global: 1 } });
    expect((await request("/api/preferences")).status).toBe(200);
    const limited = await request("/api/preferences");
    expect(limited.status).toBe(429);
    expect((await limited.json() as { retry_after: number }).retry_after).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await request("/api/preferences")).status).toBe(200);
  });

  it("can respond without a diagnostic logger", async () => {
    const request = await harness({ limits: { global: 1 } });
    await request("/api/preferences");
    expect((await request("/api/preferences")).status).toBe(429);
  });
});

describe("bounded diagnostic metadata", () => {
  it("normalizes repository identifiers, query strings and unknown paths", () => {
    expect(normalizeRateLimitPath("/api/repo-finisher/learning/private-owner/private-repo?token=secret")).toBe("/api/repo-finisher/learning/:owner/:repo");
    expect(normalizeRateLimitPath("/api/analysis/private-analysis/action-plan?key=secret")).toBe("/api/analysis/:id/action-plan");
    expect(normalizeRateLimitPath("/api/preferences/private-provider-key?token=secret")).toBe("/api/preferences/:unmatched");
    expect(normalizeRateLimitPath("/api/private-owner/private-repo")).toBe("/api/:unmatched");
    expect(normalizeRateLimitPath("/api/preferences/ai/?key=secret")).toBe("/api/preferences/ai");
  });

  it("sanitizes Retry-After to finite nonnegative integer seconds", () => {
    expect(rateLimitRetryAfter(new Date(5_500), 60_000, 4_000)).toBe(2);
    expect(rateLimitRetryAfter(new Date(1_000), 60_000, 4_000)).toBe(0);
    expect(rateLimitRetryAfter(new Date(NaN), 60_000, 4_000)).toBe(60);
    expect(rateLimitRetryAfter(undefined, 60_000, 4_000)).toBe(60);
  });
});
