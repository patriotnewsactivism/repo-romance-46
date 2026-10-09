import { once } from "node:events";
import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as provider from "../lib/ai-provider";
import * as credentials from "../lib/credentials";
import router from "./preferences";

vi.mock("../middlewares/auth", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = "test-user";
    req.supabase = {} as NonNullable<Request["supabase"]>;
    next();
  },
}));

vi.mock("../instrument", async (importOriginal) => ({
  ...await importOriginal<typeof import("../instrument")>(),
  captureException: vi.fn(),
}));

const servers: Server[] = [];
const credential: credentials.AiCredential = {
  provider: "qwen",
  model: "qwen-plus",
  apiKey: "private-provider-key",
  source: "byok",
  reasoningEffort: null,
};

async function probe() {
  const app = express();
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  return fetch(`http://127.0.0.1:${address.port}/api/preferences/ai-test`, { method: "POST" });
}

beforeEach(() => {
  vi.spyOn(credentials, "loadAiCredential").mockResolvedValue(credential);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("Settings provider readiness probe over HTTP", () => {
  it("returns a conservative cooldown for a real preflight provider rate limit", async () => {
    const call = vi.spyOn(provider, "callAI").mockRejectedValue(
      Object.assign(new Error("upstream private-body api_key=private-provider-key"), {
        upstreamStatus: 429,
        code: "AI_PROVIDER_RATE_LIMITED",
        publicMessage: "private upstream public message",
        retry_after: 999,
        details: { api_key: "private-provider-key" },
      }),
    );
    const response = await probe();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({
      error: "qwen / qwen-plus is rate-limited right now. Retry shortly or choose another model.",
      code: "AI_PROVIDER_RATE_LIMITED",
      retry_after: 60,
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]?.[0]).toMatchObject({ retryBudget: 0 });
  });

  it("recognizes the provider's normal message-based 429 classification", async () => {
    vi.spyOn(provider, "callAI").mockRejectedValue(
      new Error("Qwen API error 429: Too many requests — private-provider-key"),
    );
    const response = await probe();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toMatchObject({ code: "AI_PROVIDER_RATE_LIMITED", retry_after: 60 });
  });

  it.each([
    ["rejected credentials", 401, "AI_PROVIDER_UNAUTHORIZED", /key was rejected/],
    ["insufficient credit", 402, "AI_PROVIDER_PAYMENT_REQUIRED", /no credit/],
    ["timeout", undefined, "AI_PROVIDER_TIMEOUT", /did not answer/],
    ["unknown upstream status", 418, "PRIVATE_UPSTREAM_CODE", /failed its readiness check/],
  ])("keeps %s on the sanitized 422 contract", async (_label, upstreamStatus, code, message) => {
    const upstreamMessage = code === "AI_PROVIDER_TIMEOUT"
      ? "request timed out: private-body api_key=private-provider-key"
      : "private-body api_key=private-provider-key";
    vi.spyOn(provider, "callAI").mockRejectedValue(Object.assign(new Error(upstreamMessage), {
      status: upstreamStatus,
      upstreamStatus,
      code,
      publicMessage: "private upstream public message",
    }));
    const response = await probe();
    expect(response.status).toBe(422);
    expect(response.headers.get("retry-after")).toBeNull();
    const body = await response.json() as { error: string };
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error).toMatch(message);
    expect(JSON.stringify(body)).not.toMatch(/private-body|private-provider-key|PRIVATE_UPSTREAM_CODE/);
  });

  it("keeps a missing stored credential on the existing 400 contract", async () => {
    vi.mocked(credentials.loadAiCredential).mockResolvedValue({ ...credential, apiKey: null, source: "none" });
    const call = vi.spyOn(provider, "callAI");
    const response = await probe();
    expect(response.status).toBe(400);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.json()).toEqual({ error: "No usable qwen credential is configured." });
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps a provider billing-quota failure on 422 even when upstream uses HTTP 429", async () => {
    vi.spyOn(provider, "callAI").mockRejectedValue(Object.assign(
      new Error("You exceeded your current quota: private-provider-key"),
      { upstreamStatus: 429 },
    ));
    const response = await probe();
    expect(response.status).toBe(422);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.json()).toEqual({
      error: "The qwen account has no credit for qwen / qwen-plus. Add credit or pick a free model.",
    });
  });

  it("still reports the served model after a successful readiness probe", async () => {
    vi.spyOn(provider, "callAI").mockResolvedValue({ content: "ready", model: "qwen-served" });
    const response = await probe();
    expect(response.status).toBe(200);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.json()).toMatchObject({
      ok: true,
      provider: "qwen",
      model: "qwen-served",
      requested_model: "qwen-plus",
      fallback_used: true,
      credential_source: "byok",
    });
  });
});
