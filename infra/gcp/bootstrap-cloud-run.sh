#!/usr/bin/env bash
set -euo pipefail

# One-time Google Cloud bootstrap for RepoFinisher.
#
# Usage:
#   ./infra/gcp/bootstrap-cloud-run.sh <gcp-project-id> [region]
#
# This script creates IAM/service accounts, Artifact Registry, Workload Identity
# Federation for this repository, and the Secret Manager secret *resources*.
# It intentionally does not invent or print application secret values.

PROJECT_ID="${1:-}"
REGION="${2:-us-central1}"
GITHUB_REPO="patriotnewsactivism/repo-romance-46"
ARTIFACT_REPOSITORY="repofinisher"
DEPLOY_SA_NAME="repofinisher-deployer"
RUNTIME_SA_NAME="repofinisher-runtime"
POOL_ID="github-actions"
PROVIDER_ID="repofinisher"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Usage: $0 <gcp-project-id> [region]" >&2
  exit 2
fi

for command in gcloud; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command not found: ${command}" >&2
    exit 1
  fi
done

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

gcloud config set project "${PROJECT_ID}" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
DEPLOY_SA_EMAIL="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA_EMAIL="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

echo "Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  secretmanager.googleapis.com \
  --project="${PROJECT_ID}"

echo "Creating Artifact Registry repository if needed..."
if ! gcloud artifacts repositories describe "${ARTIFACT_REPOSITORY}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${ARTIFACT_REPOSITORY}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="RepoFinisher production containers" \
    --project="${PROJECT_ID}"
fi

echo "Creating service accounts if needed..."
if ! gcloud iam service-accounts describe "${DEPLOY_SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${DEPLOY_SA_NAME}" \
    --display-name="RepoFinisher GitHub deployer" \
    --project="${PROJECT_ID}"
fi
if ! gcloud iam service-accounts describe "${RUNTIME_SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_SA_NAME}" \
    --display-name="RepoFinisher Cloud Run runtime" \
    --project="${PROJECT_ID}"
fi

echo "Granting deploy permissions..."
for role in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
    --role="${role}" \
    --condition=None \
    --quiet >/dev/null
done

gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA_EMAIL}" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" \
  --project="${PROJECT_ID}" \
  --quiet >/dev/null

echo "Configuring GitHub Workload Identity Federation..."
if ! gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --location=global \
    --display-name="GitHub Actions" \
    --project="${PROJECT_ID}"
fi

if ! gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --workload-identity-pool="${POOL_ID}" \
  --location=global \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --workload-identity-pool="${POOL_ID}" \
    --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
    --display-name="RepoFinisher GitHub Actions" \
    --project="${PROJECT_ID}"
fi

gcloud iam service-accounts add-iam-policy-binding "${DEPLOY_SA_EMAIL}" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  --role="roles/iam.workloadIdentityUser" \
  --project="${PROJECT_ID}" \
  --quiet >/dev/null

echo "Creating required Secret Manager resources..."
SECRETS=(
  repofinisher-supabase-backend-key
  repofinisher-secret-encryption-key
  repofinisher-plan-signing-secret
)

for secret in "${SECRETS[@]}"; do
  if ! gcloud secrets describe "${secret}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets create "${secret}" --replication-policy=automatic --project="${PROJECT_ID}"
  fi
  for account in "${RUNTIME_SA_EMAIL}" "${DEPLOY_SA_EMAIL}"; do
    gcloud secrets add-iam-policy-binding "${secret}" \
      --member="serviceAccount:${account}" \
      --role="roles/secretmanager.secretAccessor" \
      --project="${PROJECT_ID}" \
      --quiet >/dev/null
  done
done

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "Writing non-secret deployment variables to GitHub..."
  gh variable set GCP_PROJECT_ID --repo "${GITHUB_REPO}" --body "${PROJECT_ID}"
  gh variable set GCP_REGION --repo "${GITHUB_REPO}" --body "${REGION}"
  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "${GITHUB_REPO}" --body "${WIF_PROVIDER}"
  gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo "${GITHUB_REPO}" --body "${DEPLOY_SA_EMAIL}"
  gh variable set GCP_RUNTIME_SERVICE_ACCOUNT --repo "${GITHUB_REPO}" --body "${RUNTIME_SA_EMAIL}"
else
  cat <<EOF

GitHub CLI is not authenticated, so add these repository variables manually:
  GCP_PROJECT_ID=${PROJECT_ID}
  GCP_REGION=${REGION}
  GCP_WORKLOAD_IDENTITY_PROVIDER=${WIF_PROVIDER}
  GCP_DEPLOY_SERVICE_ACCOUNT=${DEPLOY_SA_EMAIL}
  GCP_RUNTIME_SERVICE_ACCOUNT=${RUNTIME_SA_EMAIL}
EOF
fi

cat <<'EOF'

Bootstrap infrastructure is ready, but the three Secret Manager resources need
real values before the first deployment. Reuse the CURRENT production values
when migrating; do not rotate SECRET_ENCRYPTION_KEY during cutover or stored
GitHub credentials can become unreadable, and do not rotate PLAN_SIGNING_SECRET
while approved plans are in flight.

Add secret versions locally without placing values in source control or chat:

  printf %s "$SUPABASE_BACKEND_KEY" | gcloud secrets versions add repofinisher-supabase-backend-key --data-file=-
  printf %s "$SECRET_ENCRYPTION_KEY" | gcloud secrets versions add repofinisher-secret-encryption-key --data-file=-
  printf %s "$PLAN_SIGNING_SECRET" | gcloud secrets versions add repofinisher-plan-signing-secret --data-file=-

Then run the GitHub workflow named "Deploy Cloud Run". After its direct Cloud
Run health check passes, point the Netlify frontend's VITE_API_BASE_URL at the
new Cloud Run API URL and run the production smoke workflow. Keep Render intact
until the canonical frontend is confirmed against Cloud Run.
EOF
