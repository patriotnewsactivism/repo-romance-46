#!/usr/bin/env bash
set -euo pipefail

# Run on the intended Contabo server from the reviewed checkout. No SSH,
# credentials, provisioning, or domain changes are performed by this script.
repofinisher_deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repofinisher_compose_env="${1:-${repofinisher_deploy_dir}/compose.env}"

if [[ ! -f "$repofinisher_compose_env" ]]; then
  echo 'Create deploy/contabo/compose.env from compose.env.example first.' >&2
  exit 1
fi

repofinisher_compose=(docker compose --env-file "$repofinisher_compose_env" -f "${repofinisher_deploy_dir}/compose.yml")

# Do not print expanded Compose configuration: it contains runtime credentials.
"${repofinisher_compose[@]}" config --quiet
"${repofinisher_compose[@]}" build --pull
"${repofinisher_compose[@]}" up --detach --wait --wait-timeout 180
"${repofinisher_compose[@]}" ps
curl --fail --silent --show-error http://127.0.0.1:8080/api/healthz
