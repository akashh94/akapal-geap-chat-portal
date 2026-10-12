#!/usr/bin/env bash

set -euo pipefail

# Resolve this project's root.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Deployment config: PROJECT_ID / REGION / ARTIFACT_REGISTRY / SERVICE_NAME /
# BFF_URL all come from geap.deploy.env — the single source of truth.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/geap.deploy.env"

# The session JWT signing key must come from the environment (ideally Secret
# Manager). Never commit it. Fail loudly if it is missing.
: "${SESSION_SECRET:?export SESSION_SECRET before deploying (or wire it via Secret Manager)}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY}/akapal-geap-chat-portal:$(git rev-parse --short HEAD)"

# Pinned to a single instance: the users live in a SQLite file on the
# (ephemeral) container filesystem, so more than one instance would serve
# inconsistent user stores. Seed it after deploy with a one-off job:
#   gcloud run jobs ... // node scripts/seed.mjs
gcloud run deploy "$SERVICE_NAME" \
    --image "$IMAGE" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --port 8080 \
    --min-instances 1 \
    --max-instances 1 \
    --set-env-vars "NODE_ENV=production,COOKIE_SECURE=true,BFF_URL=${BFF_URL},SESSION_SECRET=${SESSION_SECRET}"
