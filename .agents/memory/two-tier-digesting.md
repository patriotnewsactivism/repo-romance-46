---
name: Two-tier repo digesting
description: Large portfolios split into deep-digest and metadata-only tiers to avoid O(N) AI/GitHub API calls per repo.
---

# Two-tier repo digesting

## Rule
When a portfolio has more repos than `deepDigestLimit`, only the top N repos (scored by interest) get a full GitHub fetch + AI digest. The remainder get a compact metadata line — no per-repo API calls.

**Why:** digestRepo makes a GitHub API call per repo (tree + README + key files). At 200+ repos this would saturate rate limits and take 10+ minutes. The metadata-only tier lets the AI still see the full portfolio while keeping costs proportional to quality.

**How to apply:**
- `deepDigestLimit` is tier-aware: fast=40, balanced=75, deep=100
- `scoreRepo(repo, clusterMap)` ranks by: recency (×0.2/day decay), stars, cluster membership, description, homepage, topics, size
- Metadata-only repos get appended as a `=== ADDITIONAL REPOS ===` block in the digests array
- `portfolio_stats._strategy` stores `deep_digest_count`, `metadata_only_count`, `total_repos_seen`
- `filter_max_repos` default raised from 50 → 200; page cap raised from 5 → 10 pages
