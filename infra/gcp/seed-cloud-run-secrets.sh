#!/usr/bin/env bash
set -euo pipefail

# Add the current RepoFinisher production values to the Secret Manager
# resources created by bootstrap-cloud-run.sh without echoing or persisting the
# values in shell history. Existing enabled versions are left untouched so this
# helper is safe to resume after an interrupted phone/Cloud Shell session.

PROJECT_ID="${1:-}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: $0 <gcp-project-id>" >&2
  exit 2
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Required command not found: gcloud" >&2
  exit 1
fi

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "No active gcloud account." >&2
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null

add_secret_version() {
  local secret_name="$1"
  local prompt_label="$2"
  local secret_value=""

  if ! gcloud secrets describe "${secret_name}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Missing Secret Manager resource: ${secret_name}" >&2
    exit 1
  fi

  if gcloud secrets versions list "${secret_name}" \
    --project="${PROJECT_ID}" \
    --filter='state=ENABLED' \
    --format='value(name)' | grep -q .; then
    echo "${secret_name} already has an enabled version; leaving it unchanged."
    return
  fi

  IFS= read -r -s -p "Paste the CURRENT production ${prompt_label}: " secret_value
  printf '\n'

  if [[ -z "${secret_value}" ]]; then
    echo "Refusing to create an empty version for ${secret_name}." >&2
    exit 1
  fi

  printf '%s' "${secret_value}" | gcloud secrets versions add "${secret_name}" \
    --data-file=- \
    --project="${PROJECT_ID}" \
    --quiet >/dev/null

  unset secret_value
  echo "Added the first enabled version for ${secret_name}."
}

add_secret_version "repofinisher-supabase-backend-key" "SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)"
add_secret_version "repofinisher-secret-encryption-key" "SECRET_ENCRYPTION_KEY"
add_secret_version "repofinisher-plan-signing-secret" "PLAN_SIGNING_SECRET"

echo "All required RepoFinisher Cloud Run secrets have enabled versions."
