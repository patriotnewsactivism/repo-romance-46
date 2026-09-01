# Compatibility entrypoint for Google Cloud Build / Cloud Run repository triggers
# that invoke `docker build .` and therefore require a root Dockerfile.
# The canonical multi-image release still uses Dockerfile.frontend and
# Dockerfile.apiserver explicitly from .github/workflows/deploy-cloud-run.yml.
FROM node:22-slim AS builder

ARG VITE_API_BASE_URL=https://repofinisher-api-z6kubh2jtq-uc.a.run.app
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ARG VITE_SUPABASE_URL=https://rdsrxfzahhxbvugyarld.supabase.co
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ARG VITE_SUPABASE_ANON_KEY=sb_publishable_95xMusG9KjCGJemIa8dgcw_-8JqzgER
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY . .

RUN printf 'VITE_API_BASE_URL=%s\nVITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\n' \
  "${VITE_API_BASE_URL}" "${VITE_SUPABASE_URL}" "${VITE_SUPABASE_ANON_KEY}" \
  > artifacts/repo-finisher/.env.production

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/repo-finisher build

FROM node:22-slim AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY . .

RUN pnpm install --frozen-lockfile

COPY --from=builder /app/artifacts/repo-finisher/dist ./artifacts/repo-finisher/dist

WORKDIR /app/artifacts/repo-finisher

ENV PORT=8080
EXPOSE 8080

CMD ["pnpm", "run", "serve", "--", "--port", "8080"]
