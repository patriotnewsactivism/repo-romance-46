import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../lib/async-handler";
import {
  isProviderSchemaMissing,
  loadAiCredential,
  loadStoredAiProviderSecretId,
  normalizeAiProvider,
  platformAiKey,
  platformAiStatus,
} from "../lib/credentials";
import { deleteAiVaultSecret, readAiVaultSecret, storeAiVaultSecret } from "../lib/ai-secret-store";
import { encryptSecret } from "../lib/secrets";
import {
  fetchOpenRouterModels,
  OPENROUTER_MODEL_SORTS,
  OPENROUTER_REASONING_EFFORTS,
} from "../lib/openrouter-models";

const router: IRouter = Router();
const AI_PROVIDERS = ["google", "openai", "anthropic", "openrouter"] as const;
type AiProvider = (typeof AI_PROVIDERS)[number];

type ExistingAiRow = {
  user_id: string;
  custom_ai_provider: string | null;
  custom_ai_model: string | null;
  custom_ai_reasoning_effort: string | null;
  custom_ai_key: string | null;
  custom_ai_vault_secret_id: string | null;
};

type ProviderCredentialRow = { provider: string; vault_secret_id: string };

async function providerSchemaAvailable(supabase: any): Promise<boolean> {
  const { error } = await supabase.from("ai_provider_credentials").select("provider").limit(1);
  if (!error) return true;
  if (isProviderSchemaMissing(error)) return false;
  throw new Error(`Failed to inspect AI credential schema: ${error.message}`);
}

async function readPreferenceRow(supabase: any, userId: string): Promise<ExistingAiRow | null> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("user_id, custom_ai_provider, custom_ai_model, custom_ai_reasoning_effort, custom_ai_key, custom_ai_vault_secret_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read existing AI settings: ${error.message}`);
  return (data ?? null) as ExistingAiRow | null;
}

async function providerRows(supabase: any, userId: string): Promise<ProviderCredentialRow[]> {
  const { data, error } = await supabase
    .from("ai_provider_credentials")
    .select("provider, vault_secret_id")
    .eq("user_id", userId);
  if (!error) return (data ?? []) as ProviderCredentialRow[];
  if (isProviderSchemaMissing(error)) return [];
  throw new Error(`Failed to load provider credential metadata: ${error.message}`);
}

async function statusShape(supabase: any, userId: string) {
  const [credential, row, rows] = await Promise.all([
    loadAiCredential(supabase, userId),
    readPreferenceRow(supabase, userId),
    providerRows(supabase, userId),
  ]);
  const platform = platformAiStatus();
  const requestedProvider = normalizeAiProvider(row?.custom_ai_provider, platform.defaultProvider) as AiProvider;
  const storedKeys: Record<AiProvider, boolean> = {
    google: false,
    openai: false,
    anthropic: false,
    openrouter: false,
  };
  for (const ref of rows) {
    if (AI_PROVIDERS.includes(ref.provider as AiProvider) && ref.vault_secret_id) {
      storedKeys[ref.provider as AiProvider] = true;
    }
  }
  if ((row?.custom_ai_key || row?.custom_ai_vault_secret_id) && row?.custom_ai_provider) {
    const legacyProvider = normalizeAiProvider(row.custom_ai_provider, requestedProvider) as AiProvider;
    if (AI_PROVIDERS.includes(legacyProvider)) storedKeys[legacyProvider] = true;
  }

  return {
    active_provider: credential.provider,
    active_model: credential.model,
    configured: Boolean(credential.apiKey),
    credential_source: credential.source,
    stored_key_set: storedKeys[requestedProvider],
    stored_keys: storedKeys,
    requested_provider: row?.custom_ai_provider ?? platform.defaultProvider,
    requested_model: row?.custom_ai_model ?? null,
    requested_reasoning_effort: row?.custom_ai_reasoning_effort ?? null,
    platform_default: platform.defaultProvider,
    providers: platform.providers,
  };
}

const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().trim().min(1).max(200).nullable().optional(),
  reasoning_effort: z.enum(OPENROUTER_REASONING_EFFORTS).nullable().optional(),
  api_key: z.string().trim().min(1).max(1000).optional(),
  clear_key: z.boolean().optional().default(false),
});

router.get(
  "/preferences/ai-status",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await statusShape(req.supabase!, req.userId!));
  }),
);

router.get(
  "/preferences/openrouter-models",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sort = z.enum(OPENROUTER_MODEL_SORTS).catch("intelligence-high-to-low").parse(req.query.sort);
    let apiKey: string | null = null;
    try {
      const secretId = await loadStoredAiProviderSecretId(req.supabase!, req.userId!, "openrouter");
      if (secretId) apiKey = await readAiVaultSecret(req.supabase!, req.userId!, "openrouter", secretId);
    } catch (error) {
      if (!isProviderSchemaMissing(error)) throw error;
    }
    if (!apiKey) {
      const active = await loadAiCredential(req.supabase!, req.userId!);
      if (active.provider === "openrouter") apiKey = active.apiKey;
    }
    apiKey = apiKey || platformAiKey("openrouter");
    if (!apiKey) {
      throw Object.assign(new Error("Save an OpenRouter API key in Settings before loading the live model catalog."), { status: 424 });
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
    const existing = await readPreferenceRow(req.supabase!, userId);
    let providerScoped = await providerSchemaAvailable(req.supabase!);
    let legacyEncryptedKey: string | null | undefined;

    if (providerScoped && input.clear_key) {
      try {
        const secretId = await loadStoredAiProviderSecretId(req.supabase!, userId, input.provider);
        if (secretId) await deleteAiVaultSecret(req.supabase!, userId, input.provider, secretId);
        const { error } = await req.supabase!
          .from("ai_provider_credentials")
          .delete()
          .eq("user_id", userId)
          .eq("provider", input.provider);
        if (error) throw error;
      } catch (error) {
        if (isProviderSchemaMissing(error)) providerScoped = false;
        else throw error;
      }
    }

    if (providerScoped && input.api_key) {
      let createdSecretId: string | null = null;
      try {
        const existingSecretId = await loadStoredAiProviderSecretId(req.supabase!, userId, input.provider);
        createdSecretId = await storeAiVaultSecret(
          req.supabase!,
          userId,
          input.provider,
          input.api_key,
          existingSecretId,
        );
        const { error } = await req.supabase!.from("ai_provider_credentials").upsert(
          {
            user_id: userId,
            provider: input.provider,
            vault_secret_id: createdSecretId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,provider" },
        );
        if (error) throw error;
      } catch (error) {
        if (!isProviderSchemaMissing(error)) throw error;
        providerScoped = false;
        if (createdSecretId) {
          await deleteAiVaultSecret(req.supabase!, userId, input.provider, createdSecretId).catch(() => undefined);
        }
      }
    }

    if (!providerScoped && input.api_key) {
      legacyEncryptedKey = encryptSecret(input.api_key);
    }

    const providerChanged = Boolean(
      existing?.custom_ai_provider
      && normalizeAiProvider(existing.custom_ai_provider, input.provider) !== input.provider,
    );

    const update: Record<string, unknown> = {
      custom_ai_provider: input.provider,
      custom_ai_model: input.model?.trim() || null,
      custom_ai_reasoning_effort: input.provider === "openrouter" ? input.reasoning_effort ?? null : null,
      updated_at: new Date().toISOString(),
    };

    if (providerScoped) {
      update.custom_ai_key = null;
      update.custom_ai_vault_secret_id = null;
    } else if (input.api_key) {
      update.custom_ai_key = legacyEncryptedKey ?? null;
      update.custom_ai_vault_secret_id = null;
    } else if (input.clear_key || providerChanged) {
      update.custom_ai_key = null;
      update.custom_ai_vault_secret_id = null;
    } else {
      update.custom_ai_key = existing?.custom_ai_key ?? null;
      update.custom_ai_vault_secret_id = existing?.custom_ai_vault_secret_id ?? null;
    }

    if (existing) {
      const { error } = await req.supabase!.from("user_preferences").update(update).eq("user_id", userId);
      if (error) throw new Error(`Failed to save AI settings: ${error.message}`);
    } else {
      const { error } = await req.supabase!.from("user_preferences").insert({ user_id: userId, ...update });
      if (error) throw new Error(`Failed to create AI settings: ${error.message}`);
    }

    res.json({ saved: true, ...(await statusShape(req.supabase!, userId)) });
  }),
);

export default router;
