# Gemini configuration status

Gemini/Google remains a supported RepoFinisher AI provider, but it is no longer documented here as a hard-coded architecture-wide default.

Use [`AI_PROVIDERS.md`](AI_PROVIDERS.md) for current provider/model/BYOK behavior and [`../AGENTS.md`](../AGENTS.md) for canonical agent rules.

Production provider configuration may come from a user's Vault-backed BYOK settings or backend platform fallback variables. Never place provider API keys in frontend `VITE_*` variables.