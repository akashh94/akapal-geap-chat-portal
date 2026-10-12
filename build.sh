#!/usr/bin/env bash

set -euo pipefail

# Resolve this project's root.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Deployment config: PROJECT_ID / REGION / ARTIFACT_REGISTRY / SERVICE_NAME /
# BFF_URL all come from geap.deploy.env — the single source of truth.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/geap.deploy.env"

gcloud config set project "$PROJECT_ID"

# Ensure the Artifact Registry repository exists in the deploy region.
echo "Ensuring Artifact Registry repository '${ARTIFACT_REGISTRY}' in ${REGION}..."
gcloud artifacts repositories describe "$ARTIFACT_REGISTRY" \
  --location "$REGION" >/dev/null 2>&1 || {
  echo "Repository not found; creating..."
  gcloud artifacts repositories create "$ARTIFACT_REGISTRY" \
    --repository-format docker \
    --location "$REGION"
}

# Build + push the portal image, tagged with the current short git SHA.
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY}/akapal-geap-chat-portal:$(git rev-parse --short HEAD)"
echo "$IMAGE"
gcloud builds submit . --tag "$IMAGE" --project "$PROJECT_ID"
