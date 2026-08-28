import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import { encryptSecret, secretsConfigured } from "../lib/secrets";
import {
  loadAiCredential,
  normalizeAiProvider,
  platformAiStatus,
  platformAiProvider,
} from "../lib/credentials";
import { callAI } from "../lib/ai-provider";
import { captureException } from "../instrument";

const router: IRouter = Router();
const AI_PROVIDERS = ["google", "openai", "anthropic", "openrouter"] as const;

/**
 * Columns that may be read back by a client.
 *
 * `custom_ai_key` is deliberately absent: a user's provider key is write-only.
 * The client receives only whether one is stored and safe readiness metadata.
 */
const READABLE_COLUMNS = [
  "user_id",
  "email_notifications",
  "schedule_enabled",
  "schedule_frequency",
  "custom_ai_provider",
  "custom_ai_model",
  "filter_languages",
  "filter_exclude_archived",
  "filter_min_stars",
  "filter_max_repos",
  "analysis_tier",
  "created_at",
  "updated_at",
].join(", ");

const modelSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\r\n\0]/.test(value), "Model identifier contains invalid control characters");

const updateSchema = z.object({
  email_notifications: z.boolean().optional(),
  schedule_enabled: z.boolean().optional(),
  schedule_frequency: z.enum(["weekly", "monthly"]).optional(),
  custom_ai_provider: z.enum(AI_PROVIDERS).optional(),
  custom_ai_model: modelSchema.nullable().optional(),
  /** Write-only. `null` clears the stored key. */
  custom_ai_key: z.string().trim().max(1000).nullable().optional(),
  filter_languages: z.array(z.string().max(60)).max(50).optional(),
  filter_exclude_archived: z.boolean().optional(),
  filter_min_stars: z.number().int().min(0).optional(),
  filter_max_repos: z.number().int().min(2).max(500).optional(),
  analysis_tier: z.enum(["fast", "balanced", "deep"]).optional(),
});

const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: modelSchema.nullable().optional(),
  api_key: z.string().trim().min(1).max(1000).optional(),
  clear_key: z.boolean().optional().default(false),
});

type PreferenceRow = Record<string, unknown>;

async function readPreferences(req: Parameters<typeof requireAuth>[0]): Promise<PreferenceRow | null> {
  const { data, error } = await req.supabase!
    .from("user_preferences")
    .select(`${READABLE_COLUMNS}, custom_ai_key`)
    .eq("user_id", req.userId!)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as PreferenceRow | null;
}

/** Strip the secret and replace it with the only fact a client needs. */
function toClientShape(row: PreferenceRow | null): PreferenceRow {
  if (!row) return { custom_ai_key_set: false };
  const { custom_ai_key, ...rest } = row;
  return { ...rest, custom_ai_key_set: Boolean(custom_ai_key) };
}

function providerTestMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/API_KEY_INVALID|api key not valid|invalid api key|401|unauthorized/i.test(message)) {
    return "The provider rejected the configured API credential.";
  }
  if (/402|payment required|insufficient credit|insufficient balance/i.test(message)) {
    return "The provider account does not currently have enough credit for this model.";
  }
  if (/403|forbidden|permission/i.test(message)) {
    return "The credential is valid enough to reach the provider, but it does not have permission for the configured model.";
  }
  if (/429|rate limit|quota/i.test(message)) {
    return "The provider is currently rate-limited or out of quota.";
  }
  if (/404|not found|model.*not.*found/i.test(message)) {
    return "The configured provider model or endpoint is not available. Check the exact model identifier.";
  }
  if (/timed out|timeout/i.test(message)) {
    return "The provider test timed out before a usable response was received.";
  }
  return "The provider connection test failed. Check the provider credential and model identifier, then try again.";
}

async function aiStatus(supabase: NonNullable<Parameters<typeof loadAiCredential>[0]>, userId: string) {
  const credential = await loadAiCredential(supabase, userId);
  const platform = platformAiStatus();
  const { data: row } = await supabase
    .from("user_preferences")
    .select("custom_ai_provider, custom_ai_model, custom_ai_key")
    .eq("user_id", userId)
    .maybeSingle();
  const raw = row as { custom_ai_provider?: string | null; custom_ai_model?: string | null; custom_ai_key?: string | null } | null;
  return {
    active_provider: credential.provider,
    active_model: credential.model,
    configured: Boolean(credential.apiKey),
    credential_source: credential.source,
    stored_key_set: Boolean(raw?.custom_ai_key),
    requested_provider: raw?.custom_ai_provider ?? platform.defaultProvider,
    requested_model: raw?.custom_ai_model ?? null,
    platform_default: platform.defaultProvider,
    providers: platform.providers,
  };
}

router.get(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(toClientShape(await readPreferences(req)));
  }),
);

router.get(
  "/preferences/ai-status",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await aiStatus(req.supabase!, req.userId!));
  }),
);

router.patch(
  "/preferences/ai",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = aiSettingsSchema.parse(req.body);
    const userId = req.userId!;
    const { data: existing, error: readError } = await req.supabase!
      .from("user_preferences")
      .select("user_id, custom_ai_provider, custom_ai_key")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(`Failed to read existing AI settings: ${readError.message}`);

    const existingProvider = normalizeAiProvider(
      (existing as { custom_ai_provider?: string | null } | null)?.custom_ai_provider,
      platformAiProvider(),
    );
    const providerChanged = Boolean(existing && existingProvider !== input.provider);
    const update: Record<string, unknown> = {
      custom_ai_provider: input.provider,
      custom_ai_model: input.model?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (input.clear_key || (providerChanged && !input.api_key)) {
      // A stored key belongs to the provider under which it was saved. Never
      // silently reuse a Google/OpenAI/etc key after switching providers.
      update.custom_ai_key = null;
    } else if (input.api_key) {
      if (!secretsConfigured()) {
        throw Object.assign(
          new Error("Cannot store an AI provider key because server-side secret encryption is not configured. Set SECRET_ENCRYPTION_KEY on the Render API and retry."),
          { status: 503 },
        );
      }
      update.custom_ai_key = encryptSecret(input.api_key);
    }

    if (existing) {
      const { error } = await req.supabase!.from("user_preferences").update(update).eq("user_id", userId);
      if (error) throw new Error(`Failed to save AI settings: ${error.message}`);
    } else {
      const { error } = await req.supabase!.from("user_preferences").insert({ user_id: userId, ...update });
      if (error) throw new Error(`Failed to create AI settings: ${error.message}`);
    }

    res.json({
      saved: true,
      ...(await aiStatus(req.supabase!, userId)),
    });
  }),
);

router.post(
  "/preferences/ai-test",
  requireAuth,
  asyncHandler(async (req, res) => {
    const credential = await loadAiCredential(req.supabase!, req.userId!);
    if (!credential.apiKey) {
      throw Object.assign(
        new Error(`No usable ${credential.provider} credential is configured.`),
        { status: 400 },
      );
    }

    const started = Date.now();
    try {
      const response = await Promise.race([
        callAI(
          {
            messages: [
              { role: "system", content: "Return exactly the word ready." },
              { role: "user", content: "Provider readiness check." },
            ],
          },
          credential,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("AI provider test timed out after 20 seconds")), 20_000),
        ),
      ]);

      if (!response.content.trim()) throw new Error("AI provider returned an empty readiness response");

      res.json({
        ok: true,
        provider: credential.provider,
        model: credential.model,
        credential_source: credential.source,
        latency_ms: Date.now() - started,
      });
    } catch (error) {
      captureException(error, {
        tags: { subsystem: "ai-provider-test", provider: credential.provider },
      });
      throw Object.assign(new Error(providerTestMessage(error)), { status: 422 });
    }
  }),
);

router.patch(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const userId = req.userId!;

    const { data: existing, error: readError } = await req.supabase!
      .from("user_preferences")
      .select("user_id, custom_ai_provider")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const update: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };
    if ("custom_ai_key" in input) {
      const key = input.custom_ai_key;
      if (key === null || key === "") {
        update.custom_ai_key = null;
      } else if (key !== undefined) {
        if (!secretsConfigured()) {
          throw Object.assign(
            new Error("Cannot store an AI provider key because server-side secret encryption is not configured. Set SECRET_ENCRYPTION_KEY on the Render API and retry."),
            { status: 503 },
          );
        }
        update.custom_ai_key = encryptSecret(key);
      }
    } else if (
      input.custom_ai_provider &&
      existing &&
      normalizeAiProvider((existing as { custom_ai_provider?: string | null }).custom_ai_provider, platformAiProvider()) !== input.custom_ai_provider
    ) {
      // Do not accidentally bind a prior provider's BYOK secret to the new provider.
      update.custom_ai_key = null;
    }

    if (existing) {
      const { error } = await req.supabase!.from("user_preferences").update(update).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await req.supabase!.from("user_preferences").insert({ user_id: userId, ...update });
      if (error) throw new Error(error.message);
    }

    res.json(toClientShape(await readPreferences(req)));
  }),
);

export default router;
