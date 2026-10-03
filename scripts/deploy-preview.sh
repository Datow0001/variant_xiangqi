#!/usr/bin/env bash
set -euo pipefail
project=$1 region=$2 service=$3 image=$4 commit=$5 build=$6 trigger=$7
memory=$8 concurrency=$9 max_engines=${10}
[[ "$commit" =~ ^[a-f0-9]{40}$ && "$build" =~ ^[a-f0-9]{8}-[a-f0-9-]+$ ]]
[[ "$service" =~ ^[a-z][a-z0-9-]+$ && "$concurrency" =~ ^[1-9][0-9]*$ && "$max_engines" =~ ^[1-9][0-9]*$ ]]
tag="preview-${commit:0:7}-${build:0:8}"
mkdir -p .deployment
# Export only rollout metadata, never container env values or credentials.
gcloud run services describe "$service" --project="$project" --region="$region" \
  --format='json(metadata.name,status.traffic,status.latestReadyRevisionName,status.url)' > .deployment/before.json
gcloud run services update "$service" --project="$project" --region="$region" \
  --platform=managed --image="$image" --revision-suffix="$tag" --tag="$tag" --no-traffic \
  --cpu=1 --memory="$memory" --concurrency="$concurrency" --timeout=3600 \
  --max-instances=1 --min-instances=0 --session-affinity \
  --update-env-vars="APP_VERSION=$commit,MAX_ENGINES=$max_engines,MAX_SESSIONS=32,ENGINE_THREADS=1,ENGINE_HASH_MB=16,RECONNECT_MS=120000,RESULT_MS=120000,IDLE_MS=900000" \
  --update-labels="managed-by=gcp-cloud-build-deploy-cloud-run,commit-sha=$commit,gcb-build-id=$build,gcb-trigger-id=$trigger" \
  --quiet
gcloud run services describe "$service" --project="$project" --region="$region" \
  --format='json(metadata.name,status.traffic,status.latestReadyRevisionName,status.url)' > .deployment/after.json
printf 'Preview revision: %s-%s\n' "$service" "$tag"
