import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { config, requireConfig } from "./config";

export type AsyncJobKind = "agentic_preview" | "analysis" | "ci_repair" | "portfolio_run";

export interface AsyncJobRow {
  id: string;
  user_id: string;
  kind: AsyncJobKind;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  payload: Record<string, unknown>;
  result: unknown;
  error: string | null;
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface JobEnvelopePayload {
  version: 1;
  jobId: string;
  userId: string;
  issuedAt: number;
  nonce: string;
}

export interface SignedJobEnvelope {
  payload: JobEnvelopePayload;
  signature: string;
}

function stableEnvelopeText(payload: JobEnvelopePayload) {
  return [payload.version, payload.jobId, payload.userId, payload.issuedAt, payload.nonce].join("|");
}

function signerSecret() {
  return requireConfig(config.planSigningSecret, "PLAN_SIGNING_SECRET");
}

function sign(payload: JobEnvelopePayload) {
  return createHmac("sha256", signerSecret())
    .update(`repofinisher-netlify-background-v1|${stableEnvelopeText(payload)}`)
    .digest("hex");
}

export function createSignedJobEnvelope(jobId: string, userId: string): SignedJobEnvelope {
  const payload: JobEnvelopePayload = {
    version: 1,
    jobId,
    userId,
    issuedAt: Date.now(),
    nonce: randomUUID(),
  };
  return { payload, signature: sign(payload) };
}

export function verifySignedJobEnvelope(value: unknown, maxAgeMs = 5 * 60_000): JobEnvelopePayload {
  if (!value || typeof value !== "object") throw new Error("Missing background job envelope.");
  const record = value as Record<string, unknown>;
  const rawPayload = record.payload;
  const signature = typeof record.signature === "string" ? record.signature : "";
  if (!rawPayload || typeof rawPayload !== "object" || !signature) throw new Error("Malformed background job envelope.");
  const p = rawPayload as Record<string, unknown>;
  const payload: JobEnvelopePayload = {
    version: Number(p.version) as 1,
    jobId: String(p.jobId || ""),
    userId: String(p.userId || ""),
    issuedAt: Number(p.issuedAt || 0),
    nonce: String(p.nonce || ""),
  };
  if (
    payload.version !== 1 ||
    !/^[0-9a-f-]{36}$/i.test(payload.jobId) ||
    !/^[0-9a-f-]{36}$/i.test(payload.userId) ||
    !payload.nonce ||
    !Number.isFinite(payload.issuedAt)
  ) {
    throw new Error("Invalid background job envelope fields.");
  }
  if (Math.abs(Date.now() - payload.issuedAt) > maxAgeMs) throw new Error("Background job envelope expired.");
  const expected = Buffer.from(sign(payload), "hex");
  const actual = /^[0-9a-f]{64}$/i.test(signature) ? Buffer.from(signature, "hex") : Buffer.alloc(0);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid background job signature.");
  return payload;
}

export function isNetlifyRuntime() {
  return process.env.NETLIFY === "true" || Boolean(process.env.DEPLOY_PRIME_URL && process.env.SITE_ID);
}

function netlifySiteBaseUrl() {
  const raw = process.env.DEPLOY_PRIME_URL || process.env.URL || process.env.DEPLOY_URL || "";
  if (!raw) throw new Error("Netlify runtime URL is unavailable for background dispatch.");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Unsafe Netlify background dispatch URL.");
  return url.toString().replace(/\/$/, "");
}

export async function dispatchNetlifyBackgroundJob(jobId: string, userId: string) {
  const envelope = createSignedJobEnvelope(jobId, userId);
  const response = await fetch(`${netlifySiteBaseUrl()}/.netlify/functions/worker-background`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-repofinisher-background": "1" },
    body: JSON.stringify(envelope),
  });
  if (response.status !== 202 && !response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Netlify background dispatch failed (${response.status}): ${text.slice(0, 200)}`);
  }
}

export async function createAsyncJob(
  supabase: SupabaseClient,
  userId: string,
  kind: AsyncJobKind,
  payload: Record<string, unknown>,
  maxAttempts = 3,
) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("async_jobs")
    .insert({
      user_id: userId,
      kind,
      status: "queued",
      payload,
      attempts: 0,
      max_attempts: Math.max(1, Math.min(10, maxAttempts)),
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to create background job: ${error?.message ?? "unknown database error"}`);
  return data as AsyncJobRow;
}

export async function loadAsyncJob(supabase: SupabaseClient, userId: string, jobId: string) {
  const { data, error } = await supabase
    .from("async_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load background job: ${error.message}`);
  if (!data) throw Object.assign(new Error("Background job not found."), { status: 404 });
  return data as AsyncJobRow;
}

export async function claimAsyncJob(supabase: SupabaseClient, userId: string, jobId: string) {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + 14 * 60_000).toISOString();

  await supabase
    .from("async_jobs")
    .update({ status: "queued", lease_token: null, lease_expires_at: null, updated_at: now.toISOString() })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("status", "running")
    .lt("lease_expires_at", now.toISOString());

  const current = await loadAsyncJob(supabase, userId, jobId);
  if (current.status !== "queued") return null;
  if (current.attempts >= current.max_attempts) {
    await supabase
      .from("async_jobs")
      .update({ status: "failed", error: "Background job retry budget exhausted.", completed_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", jobId)
      .eq("user_id", userId)
      .eq("status", "queued");
    return null;
  }

  const { data, error } = await supabase
    .from("async_jobs")
    .update({
      status: "running",
      attempts: current.attempts + 1,
      lease_token: leaseToken,
      lease_expires_at: leaseExpiresAt,
      started_at: current.started_at ?? now.toISOString(),
      error: null,
      updated_at: now.toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("status", "queued")
    .eq("attempts", current.attempts)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Failed to claim background job: ${error.message}`);
  return data ? data as AsyncJobRow : null;
}

export async function completeAsyncJob(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  leaseToken: string,
  result: unknown,
) {
  const now = new Date().toISOString();
  await supabase
    .from("async_jobs")
    .update({ status: "succeeded", result, error: null, lease_token: null, lease_expires_at: null, completed_at: now, updated_at: now })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("status", "running")
    .eq("lease_token", leaseToken);
}

export async function failAsyncJob(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  leaseToken: string,
  errorMessage: string,
) {
  const current = await loadAsyncJob(supabase, userId, jobId);
  const terminal = current.attempts >= current.max_attempts;
  const now = new Date().toISOString();
  await supabase
    .from("async_jobs")
    .update({
      status: terminal ? "failed" : "queued",
      error: errorMessage.slice(0, 4000),
      lease_token: null,
      lease_expires_at: null,
      completed_at: terminal ? now : null,
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("status", "running")
    .eq("lease_token", leaseToken);
}
