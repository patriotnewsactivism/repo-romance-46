# AI Providers and Model Configuration

RepoFinisher supports both user-supplied provider credentials (BYOK) and optional platform fallback credentials.

Current supported provider identifiers:

- `google`
- `openai`
- `anthropic`
- `openrouter`
- `qwen`

## Recommended production defaults

OpenRouter is the preferred platform/BYOK entry point because one credential can reach multiple high-quality models without changing the integration.

Recommended model policy:

- default high-value model / free agent-pool sentinel: `nex-agi/nex-n2.5-mini:free`
- free models attempted across two grouped requests, because OpenRouter accepts at most three models per request: first `nex-agi/nex-n2.5-mini:free` with `nvidia/nemotron-3-super-120b-a12b:free` and `poolside/laguna-s-2.1:free`, then `nex-agi/nex-n2.5-pro:free`, `nvidia/nemotron-3.5-lightning:free`, and `nvidia/nemotron-3-ultra-550b-a55b:free`
- cheap paid continuity tail after both free batches fail: `openai/gpt-oss-120b`, `deepseek/deepseek-v4-flash-0731`, `deepseek/deepseek-v3.2`
- premium OpenRouter alternative: any live catalog slug, including `openai/gpt-5.6-sol`
- direct Google fallback: `gemini-3.8-flash`

The Settings UI exposes a **Free agent pool** choice plus the live OpenRouter catalog. MiniMax M3 Free was removed from OpenRouter and must not be used as a default. GPT-5.6 Sol, Terra, and Luna remain selectable OpenAI/OpenRouter presets. The exact identifier remains visible and editable as an optional custom override so newly released models are not blocked by the catalog release cycle. Saving a preset still uses the existing provider/model readiness test and trusted BYOK path; appearing in the catalog does not imply that an account has entitlement or available provider credit for that model.

Pool failover runs only when the saved/default model is exactly `nex-agi/nex-n2.5-mini:free`. Any other saved slug stays pinned.

If `AI_PROVIDER` is explicitly configured and its matching platform credential exists, RepoFinisher honors it. If that provider is unusable because its server-side credential is absent, the backend automatically selects an available configured credential, preferring OpenRouter first. When no platform credential exists, Settings defaults to OpenRouter so a user can supply an OpenRouter BYOK key without being pushed toward a legacy provider.

A user-saved exact model identifier takes precedence over in-code defaults. Historical `AI_MODEL` / `OPENROUTER_MODEL` / `GEMINI_MODEL` environment variables are ignored so a model slug cannot leak across providers.

## Model catalog and task routing

`artifacts/api-server/src/lib/ai-model-catalog.ts` is the single source of truth for
model IDs, tiers, capabilities, prices, and per-task routing. Provider defaults in
`ai-model-config.ts` and the Settings picker both read from it, so the API, the UI,
and the router can no longer disagree about which models exist.

Each catalog entry declares:

- provider and exact slug;
- tier (`frontier`, `balanced`, `fast`, `free`);
- context window, strict-JSON support, and reasoning-effort support;
- input/output price per million tokens;
- the RepoFinisher tasks it is genuinely good at.

Tasks are routed deliberately rather than by one global default:

| Task | Preference | Why |
| --- | --- | --- |
| `repo_grading` | balanced → frontier | Structured, repeatable scoring; cheaper and steadier than frontier. |
| `valuation` | frontier → balanced | A wrong multiple is expensive; pay for reasoning and context. |
| `builder_prompt` | frontier → balanced | The prompt is the product; this is the task that justifies a premium model. |
| `suggestion_generation` | balanced → fast | High-volume list generation at a fraction of frontier cost. |
| `market_research` | frontier → balanced | Demand claims must be evidence-backed. |
| `code_planning` | frontier → balanced | Plans become branches and PRs. |
| `long_context_review` | frontier → balanced | Needs a large window more than price efficiency. |
| `fast_classify` | fast → free → balanced | Routing and tagging should stay cheap and quick. |

`selectModelCandidates(task)` / `selectModelForTask(task)` apply the profile's JSON,
context, and price constraints, then rank by tier preference, task strength, context
fit, and price headroom. A user-pinned catalog model always wins. `describeTaskRouting()`
returns the safe, credential-free routing description used by operator diagnostics.

The OpenAI in-code default is now `gpt-5.6-terra` (balanced), replacing `gpt-4o`.
The Anthropic default remains `claude-sonnet-4-20250514`, Google remains
`gemini-3.8-flash`, Qwen remains `qwen-plus`, and OpenRouter remains the free
agent-pool sentinel because the pool fallback contract is keyed to that slug.

## User BYOK flow

The Settings UI stores:

- provider,
- exact model identifier,
- configured/not-configured credential state.

The credential itself is submitted to the persistent API and stored in Supabase Vault through service-role-only functions.

The browser must never receive the decrypted API key after save.

A user's BYOK credential takes precedence over platform fallback credentials for the selected provider.

## Platform fallback

The backend can use optional environment credentials:

```text
AI_PROVIDER

GEMINI_API_KEY or GOOGLE_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
OPENROUTER_FREE_API_KEY or OPENROUTER_API_KEY_2 or OPENROUTER_API_KEY
QWEN_API_KEY or DASHSCOPE_API_KEY
QWEN_BASE_URL
```

Model IDs are not environment secrets. `AI_MODEL`, `GEMINI_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, and `OPENROUTER_MODEL` are ignored so a slug cannot leak across providers. Choose the model in Settings.

`QWEN_BASE_URL` is the one exception to that rule and is not a model variable: it selects
which DashScope region to call, not what to run there. See the Qwen section below.

A credential variable that is present but blank (empty or whitespace) counts as unconfigured. Blank values are normalized to absent in `loadAiCredential` and again in `callAI`, so provider selection, `platformAiStatus`, and the "no usable credential" error all agree. Without that rule a whitespace key is truthy, passes every readiness check, and reaches the provider as `Authorization: Bearer `, which comes back as a misleading authentication error instead of a configuration error. Stored credentials are also trimmed, so a key saved with surrounding whitespace still authenticates.

## Exact model identifiers

RepoFinisher should persist the exact model identifier selected/configured by the user rather than silently substituting a different model.

This applies to per-stage model selection as well. Portfolio analysis, finishing, CI repair, valuation, and prompts all receive the identifier resolved by `loadAiCredential` — the user's saved model, else the provider's platform default. Stage defaults are only a fallback for a provider with no configured model, and each provider's fallback must be valid for that provider: OpenRouter identifiers are vendor-namespaced (`nex-agi/nex-n2.5-mini:free`), so a bare `gpt-4o-mini` is not a usable OpenRouter default.

When the resolved OpenRouter model is the free agent-pool sentinel, RepoFinisher sends OpenRouter `models` fallback batches (free roster, then cheap paid continuity). Any other exact custom/user-selected model remains pinned and is not silently substituted. The response retains the concrete model ID reported by OpenRouter for safe runtime attribution.

When a provider rejects a model:

- return a clear provider/model error,
- do not erase the stored key unless the user requested removal,
- do not silently switch to another provider,
- allow the user or planning policy to choose an alternative intentionally.

## Qwen

Qwen is served by Alibaba Cloud Model Studio (DashScope), which exposes an OpenAI-compatible
chat-completions API. It therefore uses the same bearer-token request path as OpenAI and
OpenRouter rather than a bespoke client.

DashScope runs several regional hosts that do not share accounts, and a key issued in one
region is rejected by the others. On the legacy `dashscope` domain:

| Region | Base URL |
| --- | --- |
| Singapore (default) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| Beijing | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| US (Virginia) | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` |
| Hong Kong | `https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1` |

Alibaba also documents workspace-dedicated domains
(`https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`, which it recommends
over the legacy domain and which additionally cover Tokyo and Frankfurt) and trial domains.
`QWEN_BASE_URL` accepts any of them, so this list does not need to be exhaustive to stay
correct — check Alibaba's base-URL reference for the current set.

`QWEN_BASE_URL` selects the host. It accepts the base URL with or without a trailing slash,
and also accepts the full `/chat/completions` path. It **must be `https`** — an operator
typo using plain http would otherwise put the bearer token and every prompt on the wire in
cleartext, so a non-https value raises instead. Leave it unset for Singapore.

`QWEN_API_KEY` holds the credential; `DASHSCOPE_API_KEY` is accepted as an alias because that
is Alibaba's own conventional name. The in-code default model is the `qwen-plus` alias, which
Alibaba keeps pointed at the current stable Plus model, so the default does not pin a version
that ages out. As with every provider, a model chosen in Settings wins.

Qwen models are also reachable through OpenRouter as `qwen/<model>` without a second
credential. The direct provider exists for operators who hold a Model Studio key and want
first-party billing, quota, and latency.

Adding a provider is not only an application change. The database validates the provider
identifier in five places — the `user_preferences.custom_ai_provider` and
`ai_provider_credentials.provider` check constraints, and the three provider-scoped Vault
RPCs — so a new provider needs a forward migration widening all of them, or every save is
rejected by Postgres and BYOK is unusable while the UI still offers the choice. See
`supabase/migrations/20260924080000_add_qwen_ai_provider.sql`.

## OpenRouter

OpenRouter is a first-class supported provider. It is useful as a multi-model routing surface but should not be treated as a reason to weaken provider/model observability.

Persist and expose safe metadata about the chosen provider/model so a failed run can be attributed correctly.

## Provider status

Status endpoints may expose safe metadata such as:

- default provider,
- selected provider,
- selected model,
- whether a user key is configured,
- whether a platform fallback is configured.

They must not expose key values.

`GET /api/preferences/ai-status` is an authenticated API route on the persistent Railway API service. Production smoke verification deliberately calls it without a token and expects a JSON `401`; an HTML or `404` response is treated as a deployment/routing regression.

## Credential storage

New AI BYOK credentials use Supabase Vault.

The application preference row stores an opaque `custom_ai_vault_secret_id`. Backend service-role functions store/read/delete the secret.

The historical `custom_ai_key` field remains compatibility-only for legacy encrypted records; do not write new plaintext provider credentials there.

## Settings acceptance test

For each provider that is claimed as supported, production verification should cover:

1. select provider,
2. enter exact model,
3. enter API key,
4. save,
5. reload page,
6. confirm key is shown only as configured/not-configured,
7. perform a real provider invocation or provider connectivity test,
8. change model and verify new model is used,
9. switch provider and ensure the old provider secret is not silently reused,
10. remove key and verify Vault reference/secret removal behavior.

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

Older repository notes described Google/Gemini as a single hard platform default and referenced Vercel-hosted API behavior. Those notes are obsolete.

The current architecture is provider-aware, BYOK-capable, hosted with a persistent API on Railway, and stores user AI credentials in Supabase Vault.

Model-specific documentation files should defer to this document and `AGENTS.md` rather than preserve old hosting assumptions.
