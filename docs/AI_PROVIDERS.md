# AI Providers and Model Configuration

RepoFinisher supports both user-supplied provider credentials (BYOK) and optional platform fallback credentials.

Current supported provider identifiers:

- `google`
- `openai`
- `anthropic`
- `openrouter`

## Credentials and model identifiers are different things

Provider API keys are secrets. Model identifiers are not.

A deployment should not require one secret per model. The backend needs only the credential for a provider that should be available, for example `GEMINI_API_KEY` for Google Gemini or `OPENROUTER_API_KEY` for OpenRouter. The selected model is ordinary configuration and is resolved from, in order:

1. the user's saved model selection,
2. that provider's optional model override environment variable,
3. the provider-specific default stored in application code.

Provider model namespaces must remain isolated. A model configured for OpenRouter must never become the Google model merely because the user switches providers.

The historical provider-agnostic `AI_MODEL` variable is intentionally ignored by model resolution because one global model slug can be valid for one provider and invalid for another. This previously allowed an OpenRouter slug to be sent to the Gemini endpoint and surface as a misleading HTTP 422 model/endpoint error.

## Recommended production defaults

OpenRouter remains the preferred multi-model entry point because one credential can reach many models without changing integrations. The current automatic free-first OpenRouter chain is defined in `artifacts/api-server/src/lib/ai-provider.ts` and starts with `nex-agi/nex-n2.5-mini:free`.

Direct Google Gemini uses `gemini-3.8-flash` as the code default. Google model IDs may still be overridden explicitly with `GEMINI_MODEL`, but that variable is optional configuration rather than a required secret.

The Settings UI exposes model choices so normal users do not need to type provider IDs. Exact identifiers remain editable as optional custom overrides so newly released models are not blocked by a catalog release cycle. A listed model does not imply that a particular account has entitlement or available quota for it.

If `AI_PROVIDER` is explicitly configured and its matching platform credential exists, RepoFinisher honors it. If that provider is unusable because its server-side credential is absent, the backend automatically selects an available configured credential, preferring OpenRouter first. When no platform credential exists, Settings defaults to OpenRouter so a user can supply an OpenRouter BYOK key without being pushed toward a legacy provider.

## User BYOK flow

The Settings UI stores:

- provider,
- exact model identifier or `null` for the provider default,
- configured/not-configured credential state.

The credential itself is submitted to the persistent API and stored in Supabase Vault through service-role-only functions.

The browser must never receive the decrypted API key after save.

A user's BYOK credential takes precedence over a platform fallback credential for the selected provider.

## Platform fallback

The backend can use optional environment credentials:

```text
AI_PROVIDER

GEMINI_API_KEY or GOOGLE_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
OPENROUTER_FREE_API_KEY or OPENROUTER_API_KEY_2 or OPENROUTER_API_KEY
```

Optional provider-specific model overrides are ordinary configuration:

```text
GEMINI_MODEL
OPENAI_MODEL
ANTHROPIC_MODEL
OPENROUTER_MODEL
```

None of those model identifiers need to be stored as secrets, and none are required when the code default is acceptable.

A credential variable that is present but blank (empty or whitespace) counts as unconfigured. Blank values are normalized to absent in `loadAiCredential` and again in `callAI`, so provider selection, `platformAiStatus`, and the "no usable credential" error all agree. Stored credentials are also trimmed, so a key saved with surrounding whitespace still authenticates.

## Exact model identifiers

RepoFinisher persists the exact model identifier selected/configured by the user rather than silently substituting a different model.

Per-stage portfolio analysis may choose profiler/critique/synthesis defaults, but the identifier resolved by `loadAiCredential` — the user's saved model, else that provider's platform/code default — takes precedence. Each provider's fallback must be valid in that provider's own namespace. OpenRouter identifiers are vendor-namespaced, while direct Gemini identifiers such as `gemini-3.8-flash` are not prefixed with `google/`.

When a provider rejects a model:

- return a clear provider/model error,
- do not silently switch to another provider,
- do not require a new secret just to select another model,
- allow the user or planning policy to choose an alternative intentionally.

## OpenRouter

OpenRouter is a first-class supported provider and exposes a live model catalog in Settings. Pricing and capability metadata come from OpenRouter at runtime rather than requiring model definitions in backend secrets.

Persist and expose safe metadata about the chosen provider/model so a failed run can be attributed correctly.

## Google Gemini

Direct Gemini calls use the Gemini REST `models/{model}:generateContent` endpoint. The default model is stored in code and can be changed without rotating credentials.

Google also exposes `GET /v1beta/models` for programmatic model discovery. Future catalog expansion should prefer provider discovery over treating model names as deployment secrets.

## Provider status

Status endpoints may expose safe metadata such as:

- default provider,
- selected provider,
- selected model,
- whether a user key is configured,
- whether a platform fallback is configured.

They must not expose key values.

`GET /api/preferences/ai-status` is an authenticated API route on the persistent API service. Production smoke verification deliberately calls it without a token and expects a JSON `401`; an HTML or `404` response is treated as a deployment/routing regression.

## Credential storage

New AI BYOK credentials use Supabase Vault.

The application preference row stores an opaque `custom_ai_vault_secret_id`. Backend service-role functions store/read/delete the secret.

The historical `custom_ai_key` field remains compatibility-only for legacy encrypted records; do not write new plaintext provider credentials there.

## Settings acceptance test

For each provider that is claimed as supported, production verification should cover:

1. select provider,
2. leave the model blank and confirm Google and OpenRouter resolve their code defaults; confirm OpenAI and Anthropic resolve `null` until configured,
3. save without adding a model environment variable,
4. perform a real provider connectivity test,
5. choose an exact model and verify it is used,
6. switch providers and verify the prior provider's model slug is not reused,
7. confirm a global or unrelated provider model variable cannot leak into the new provider,
8. reload and confirm the key is shown only as configured/not-configured,
9. remove the key and verify Vault reference/secret removal behavior.

## Provider failure handling

Differentiate:

- persistence failure,
- authentication failure,
- invalid model,
- quota/rate-limit exhaustion,
- provider outage,
- network timeout,
- malformed provider response.

These are different failure modes and should become different operational-learning evidence.

## Historical Gemini notes

Older repository notes described Google/Gemini as a single hard platform default and used a provider-agnostic `AI_MODEL` override. That model override architecture is obsolete because it permits cross-provider identifier leakage.

The current architecture is provider-aware, BYOK-capable, stores credentials in Supabase Vault, and treats model identifiers as normal provider-scoped configuration.
