# AI Providers and Model Configuration

RepoFinisher supports both user-supplied provider credentials (BYOK) and optional platform fallback credentials.

Current supported provider identifiers:

- `google`
- `openai`
- `anthropic`
- `openrouter`

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
AI_MODEL

GEMINI_API_KEY or GOOGLE_API_KEY
GEMINI_MODEL

OPENAI_API_KEY
OPENAI_MODEL

ANTHROPIC_API_KEY
ANTHROPIC_MODEL

OPENROUTER_API_KEY
OPENROUTER_MODEL
```

`AI_MODEL`, when set, is the common model override. Provider-specific model variables are fallback choices when a common override is absent.

## Exact model identifiers

RepoFinisher should persist the exact model identifier selected/configured by the user rather than silently substituting a different model.

When a provider rejects a model:

- return a clear provider/model error,
- do not erase the stored key unless the user requested removal,
- do not silently switch to another provider,
- allow the user or planning policy to choose an alternative intentionally.

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

The current architecture is provider-aware, BYOK-capable, hosted with a persistent API on Render, and stores user AI credentials in Supabase Vault.

Model-specific documentation files should defer to this document and `AGENTS.md` rather than preserve old hosting assumptions.