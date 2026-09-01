# Canonical production domain

The verified Google Cloud Run domain mapping for RepoFinisher is:

```text
https://portfolio.donmatthews.live
```

It maps to the Cloud Run service `repofinisher-web` in `us-central1`.

The direct frontend service URL remains:

```text
https://repofinisher-web-z6kubh2jtq-uc.a.run.app
```

Do not treat `repofinisher.donmatthews.live` as canonical unless Google Cloud Run Domain Mappings is explicitly changed and runtime-verified. Repository documentation or deployment intent is not evidence of an active mapping.

`.github/workflows/repair-canonical-domain.yml` is the production guardrail: after Cloud Run deploys it verifies or repairs the `portfolio.donmatthews.live` mapping, aligns Cloudflare DNS, restores API CORS for the canonical frontend, and verifies both the frontend and API CORS at runtime.
