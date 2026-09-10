import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import {
  loadAiCredential,
  loadStoredAiProviderSecretId,
  normalizeAiProvider,
  platformAiKey,
  platformAiProvider,
  platformAiStatus,
} from "../lib/credentials";
import {
  deleteAiVaultSecret,
  readAiVaultSecret,
  storeAiVaultSecret,
} from "../lib/ai-secret-store";
import { callAI } from "../lib/ai-provider";
import { captureException } from "../instrument";
import {
  fetchOpenRouterModels,
  OPENROUTER_MODEL_SORTS,
  OPENROUTER_REASONING_EFFORTS,
} from "../lib/openrouter-models";

const router: IRouter = Router();
const AI_PROVIDERS = ["google", "openai", "anthropic", "openrouter"] as const;
type AiProvider = (typeof AI_PROVIDERS)[number];

const READABLE_COLUMNS = [
  "user_id",
  "email_notifications",
  "schedule_enabled",
  "schedule_frequency",
  "custom_ai_provider",
  "custom_ai_model",
  "custom_ai_reasoning_effort",
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
  /** Write-only compatibility field. Values are moved into provider-scoped Vault storage. */
  custom_ai_key: z.string().trim().max(1000).nullable().optional(),
  filter_languages: z.array(z.string().max(60)).max(50).optional(),
  filter_exclude_archived: z.boolean().optional(),
  filter_min_stars: z.number().int().min(0).optional(),
  filter_max_repos: z.number().int().min(2).max(1000).optional(),
  analysis_tier: z.enum(["fast", "balanced", "deep"]).optional(),
});

const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: modelSchema.nullable().optional(),
  reasoning_effort: z.enum(OPENROUTER_REASONING_EFFORTS).nullable().optional(),
  api_key: z.string().trim().min(1).max(1000).optional(),
  clear_key: z.boolean().optional().default(false),
});

type PreferenceRow = Record<string, unknown>;
type ExistingAiRow = {
  user_id: string;
  custom_ai_provider: string | null;
  custom_ai_key: string | null;
  custom_ai_vault_secret_id: string | null;
};

type ProviderCredentialRow = {
  provider: string;
  vault_secret_id: string;
};

type StoredKeyMap = Record<AiProvider, boolean>;

function emptyStoredKeyMap(): StoredKeyMap {
  return { google: false, openai: false, anthropic: false, openrouter: false };
}

async function readPreferences(req: Parameters<typeof requireAuth>[0]): Promise<PreferenceRow | null> {
  const { data, error } = await req.supabase!
    .from("user_preferences")
    .select(`${READABLE_COLUMNS}, custom_ai_key, custom_ai_vault_secret_id`)
    .eq("user_id", req.userId!)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as PreferenceRow | null;
}

async function readProviderCredentialRows(
  supabase: NonNullable<Parameters<typeof loadAiCredential>[0]>,
  userId: string,
): Promise<ProviderCredentialRow[]> {
  const { data, error } = await supabase
    .from("ai_provider_credentials")
    .select("provider, vault_secret_id")
    .eq("user_id", userId);

  if (error) {
    // Allow a rolling deploy to keep serving the legacy credential until the
    // migration reaches the database.
    if ((error as { code?: string }).code === "42P01") return [];
    throw new Error(`Failed to load provider credential metadata: ${error.message}`);
  }

  return (data ?? []) as ProviderCredentialRow[];
}

function storedKeyMap(
  rows: ProviderCredentialRow[],
  legacyProvider?: string | null,
  legacyKeySet = false,
): StoredKeyMap {
  const result = emptyStoredKeyMap();
  for (const row of rows) {
    if (AI_PROVIDERS.includes(row.provider as AiProvider) && row.vault_secret_id) {
      result[row.provider as AiProvider] = true;
    }
  }

  if (legacyKeySet && legacyProvider) {
    const normalized = normalizeAiProvider(legacyProvider, "openrouter") as AiProvider;
    if (AI_PROVIDERS.includes(normalized)) result[normalized] = true;
  }
  return result;
}

async function saveProviderSecretReference(
  supabase: NonNullable<Parameters<typeof loadAiCredential>[0]>,
  userId: string,
  provider: AiProvider,
  vaultSecretId: string,
): Promise<void> {
  const { error } = await supabase
    .from("ai_provider_credentials")
    .upsert(
      {
        user_id: userId,
        provider,
        vault_secret_id: vaultSecretId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );
  if (error) throw new Error(`Failed to save ${provider} credential reference: ${error.message}`);
}

async function removeProviderSecretReference(
  supabase: NonNullable<Parameters<typeof loadAiCredential>[0]>,
  userId: string,
  provider: AiProvider,
): Promise<void> {
  const { error } = await supabase
    .from("ai_provider_credentials")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);
  if (error) throw new Error(`Failed to remove ${provider} credential reference: ${error.message}`);
}

async function storedProviderKey(
  supabase: NonNullable<Parameters<typeof loadAiCredential>[0]>,
  userId: string,
  provider: AiProvider,
): Promise<string | null> {
  const secretId = await loadStoredAiProviderSecretId(supabase, userId, provider);
  if (!secretId) return null;
  return readAiVaultSecret(supabase, userId, provider, secretId);
}

function toClientShape(row: PreferenceRow | null, storedKeySet = false): PreferenceRow {
  if (!row) return { custom_ai_key_set: storedKeySet };
  const { custom_ai_key, custom_ai_vault_secret_id, ...rest } = row;
  return {
    ...rest,
    custom_ai_key_set: storedKeySet || Boolean(custom_ai_vault_secret_id || custom_ai_key),
  };
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
    return "The selected model is not available from this provider. Choose another model in Settings; no backend model ENV change is required.";
  }
  if (/timed out|timeout/i.test(message)) {
    return "The provider test timed out before a usable response was received.";
  }
  return "The provider connection test failed. Check the provider credential and selected model, then try again.";
}

async function aiStatus(supabase: NonNullable<Parameters<typeof loadAiCredential>[0]>, userId: string) {
  const credential = await loadAiCredential(supabase, userId);
  const platform = platformAiStatus();
  const [{ data: row }, credentialRows] = await Promise.all([
    supabase
      .from("user_preferences")
      .select("custom_ai_provider, custom_ai_model, custom_ai_reasoning_effort, custom_ai_key, custom_ai_vault_secret_id")
      .eq("user_id", userId)
      .maybeSingle(),
    readProviderCredentialRows(supabase, userId),
  ]);

  const raw = row as {
    custom_ai_provider?: string | null;
    custom_ai_model?: string | null;
    custom_ai_reasoning_effort?: string | null;
    custom_ai_key?: string | null;
    custom_ai_vault_secret_id?: string | null;
  } | null;
  const requestedProvider = normalizeAiProvider(raw?.custom_ai_provider, platform.defaultProvider) as AiProvider;
  const keys = storedKeyMap(
    credentialRows,
    raw?.custom_ai_provider,
    Boolean(raw?.custom_ai_vault_secret_id || raw?.custom_ai_key),
  );

  return {
    active_provider: credential.provider,
    active_model: credential.model,
    configured: Boolean(credential.apiKey),
    credential_source: credential.source,
    stored_key_set: keys[requestedProvider],
    stored_keys: keys,
    requested_provider: raw?.custom_ai_provider ?? platform.defaultProvider,
    requested_model: raw?.custom_ai_model ?? null,
    requested_reasoning_effort: raw?.custom_ai_reasoning_effort ?? null,
    platform_default: platform.defaultProvider,
    providers: platform.providers,
  };
}

router.get(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await readPreferences(req);
    const requestedProvider = normalizeAiProvider(
      (row?.custom_ai_provider as string | null | undefined) ?? platformAiProvider(),
      platformAiProvider(),
    ) as AiProvider;
    const refs = await readProviderCredentialRows(req.supabase!, req.userId!);
    const keyMap = storedKeyMap(
      refs,
      row?.custom_ai_provider as string | null | undefined,
      Boolean(row?.custom_ai_key || row?.custom_ai_vault_secret_id),
    );
    res.json(toClientShape(row, keyMap[requestedProvider]));
  }),
);

router.get(
  "/preferences/ai-status",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await aiStatus(req.supabase!, req.userId!));
  }),
);

router.get(
  "/preferences/openrouter-models",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sort = z.enum(OPENROUTER_MODEL_SORTS).catch("intelligence-high-to-low").parse(req.query.sort);
    const apiKey =
      (await storedProviderKey(req.supabase!, req.userId!, "openrouter").catch(() => null)) ??
      platformAiKey("openrouter");

    if (!apiKey) {
      throw Object.assign(
        new Error("Save an OpenRouter API key in Settings before loading the live model catalog."),
        { status: 424 },
      );
    }

    const catalog = await fetchOpenRouterModels(apiKey, sort);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.json({ ...catalog, sort });
  }),
);

router.patch(
  "/preferences/ai",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = aiSettingsSchema.parse(req.body);
    const userId = req.userId!;
    const { data: existingData, error: readError } = await req.supabase!
      .from("user_preferences")
      .select("user_id, custom_ai_provider, custom_ai_key, custom_ai_vault_secret_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(`Failed to read existing AI settings: ${readError.message}`);

    const existing = existingData as ExistingAiRow | null;
    const existingProviderSecretId = await loadStoredAiProviderSecretId(req.supabase!, userId, input.provider);

    if (input.clear_key) {
      if (existingProviderSecretId) {
        await deleteAiVaultSecret(req.supabase!, userId, input.provider, existingProviderSecretId);
      }
      await removeProviderSecretReference(req.supabase!, userId, input.provider);
    } else if (input.api_key) {
      const vaultId = await storeAiVaultSecret(
        req.supabase!,
        userId,
        input.provider,
        input.api_key,
        existingProviderSecretId,
      );
      try {
        await saveProviderSecretReference(req.supabase!, userId, input.provider, vaultId);
      } catch (error) {
        if (!existingProviderSecretId) {
          await deleteAiVaultSecret(req.supabase!, userId, input.provider, vaultId).catch(() => undefined);
        }
        throw error;
      }
    }

    const update: Record<string, unknown> = {
      custom_ai_provider: input.provider,
      custom_ai_model: input.model?.trim() || null,
      custom_ai_reasoning_effort: input.provider === "openrouter" ? input.reasoning_effort ?? null : null,
      // Legacy shared-key columns are no longer written. Provider-scoped Vault
      // references live in ai_provider_credentials.
      custom_ai_key: null,
      custom_ai_vault_secret_id: null,
      updated_at: new Date().toISOString(),
    };

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

    const { data: existingData, error: readError } = await req.supabase!
      .from("user_preferences")
      .select("user_id, custom_ai_provider, custom_ai_key, custom_ai_vault_secret_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const existing = existingData as ExistingAiRow | null;
    const { custom_ai_key: incomingKey, ...nonSecretInput } = input;
    const targetProvider = normalizeAiProvider(
      input.custom_ai_provider ?? existing?.custom_ai_provider,
      platformAiProvider(),
    ) as AiProvider;

    if ("custom_ai_key" in input) {
      const existingProviderSecretId = await loadStoredAiProviderSecretId(req.supabase!, userId, targetProvider);
      if (incomingKey === null || incomingKey === "") {
        if (existingProviderSecretId) {
          await deleteAiVaultSecret(req.supabase!, userId, targetProvider, existingProviderSecretId);
        }
        await removeProviderSecretReference(req.supabase!, userId, targetProvider);
      } else if (incomingKey !== undefined) {
        const vaultId = await storeAiVaultSecret(
          req.supabase!,
          userId,
          targetProvider,
          incomingKey,
          existingProviderSecretId,
        );
        try {
          await saveProviderSecretReference(req.supabase!, userId, targetProvider, vaultId);
        } catch (error) {
          if (!existingProviderSecretId) {
            await deleteAiVaultSecret(req.supabase!, userId, targetProvider, vaultId).catch(() => undefined);
          }
          throw error;
        }
      }
    }

    const update: Record<string, unknown> = {
      ...nonSecretInput,
      updated_at: new Date().toISOString(),
    };

    // When this compatibility route touches AI provider/key state, retire the
    // legacy shared-key columns. Merely changing repository filters does not.
    if ("custom_ai_key" in input || input.custom_ai_provider !== undefined) {
      update.custom_ai_key = null;
      update.custom_ai_vault_secret_id = null;
    }

    if (existing) {
      const { error } = await req.supabase!.from("user_preferences").update(update).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await req.supabase!.from("user_preferences").insert({ user_id: userId, ...update });
      if (error) throw new Error(error.message);
    }

    const row = await readPreferences(req);
    const requestedProvider = normalizeAiProvider(
      (row?.custom_ai_provider as string | null | undefined) ?? platformAiProvider(),
      platformAiProvider(),
    ) as AiProvider;
    const refs = await readProviderCredentialRows(req.supabase!, userId);
    const keyMap = storedKeyMap(
      refs,
      row?.custom_ai_provider as string | null | undefined,
      Boolean(row?.custom_ai_key || row?.custom_ai_vault_secret_id),
    );
    res.json(toClientShape(row, keyMap[requestedProvider]));
  }),
);

export default router;
