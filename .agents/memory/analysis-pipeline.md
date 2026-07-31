---
name: Analysis pipeline architecture
description: 5-stage adaptive reasoning pipeline in artifacts/api-server/src/routes/analysis.ts
---

# Analysis pipeline architecture

## Stages
1. **profilePortfolio** — metadata-only (no per-repo GitHub calls). Produces: developer_profile, domain_clusters, custom_system_prompt, strategy_summary. Fast enough to run on 500 repos.
2. **digestRepo** — per-repo: fetches file tree, README, key files, code samples. Expensive. Subject to two-tier limit (see two-tier-digesting.md).
3. **callBatchedAI** — main recommendation generation. Uses custom_system_prompt from Stage 1. Parallel batches if digests exceed token budget.
4. **critiqueResults** — self-critique pass: finds gaps, overly generic recs, missed synergies. Uses reasoning model.
5. **synthesizeWithReasoning** — final ranking + synthesis. Uses best model (o3/claude-with-thinking/gemini-2.5-pro for deep tier).

## Key constraints
- `analyses.error` column doubles as progress string while status=running
- New schema columns (developer_profile, critique_md, strategy_summary, generated_system_prompt) may not exist in older deployments — always wrapped in try/catch, fallback to portfolio_stats._strategy JSONB
- analysis_tier (fast/balanced/deep) controls deepDigestLimit and per-stage model selection
- Provider "lovable" (and any unknown provider) falls through to "No AI provider available" error — map to sensible fallback or show settings prompt
