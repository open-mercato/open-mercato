# Frozen copy of the run script of the ci.yml prepare step "Compute integration scope" as it
# was before the CI scope resolver replaced it (spec 2026-11-25, Phase 2 step 4). The parity
# tests run it as the reference for the pre-resolver behaviour. Do not edit.
FULL_SHARDS='["1/15","2/15","3/15","4/15","5/15","6/15","7/15","8/15","9/15","10/15","11/15","12/15","13/15","14/15","15/15"]'
SINGLE_SHARD='["none"]'

if [ "${{ github.event_name }}" != "pull_request" ] || [ "$FORCE_FULL_SUITE" = "true" ]; then
  echo "skip=false" >> "$GITHUB_OUTPUT"
  echo "modules=" >> "$GITHUB_OUTPUT"
  echo "shard_matrix=${FULL_SHARDS}" >> "$GITHUB_OUTPUT"
  exit 0
fi

CHANGED=$(git diff --name-only HEAD^1 HEAD)

# These paths affect behaviour across all modules — run the full sharded suite.
# `packages/cli/src/lib/testing/` is the ephemeral harness that boots, drives and tears
# down this very suite. A change there matches no `src/modules/` path, so without this
# entry the job that would exercise it is the one job it can never trigger.
FULL_SUITE_PATTERN='^\.github/workflows/ci\.yml$|^packages/shared/|^packages/ui/|^packages/events/|^packages/queue/|^packages/cache/|^packages/search/|^packages/onboarding/|^packages/webhooks/|^packages/core/src/lib/|^packages/enterprise/src/lib/|^packages/cli/src/lib/testing/|^apps/mercato/src/(app|lib|components|layout\.|page\.)'
if echo "$CHANGED" | grep -qE "$FULL_SUITE_PATTERN"; then
  echo "skip=false" >> "$GITHUB_OUTPUT"
  echo "modules=" >> "$GITHUB_OUTPUT"
  echo "shard_matrix=${FULL_SHARDS}" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Extract module folder names from module-specific paths.
# Match any workspace package or app that follows the src/modules/ convention.
MODULES=$(echo "$CHANGED" | \
  grep -oP '(?:packages/[^/]+|apps/[^/]+)/src/modules/\K[^/]+' | \
  sort -u | paste -sd,)

if [ -z "$MODULES" ]; then
  # Only non-module files changed (CI, docs, scripts) — skip integration.
  echo "skip=true" >> "$GITHUB_OUTPUT"
  echo "modules=" >> "$GITHUB_OUTPUT"
  echo "shard_matrix=${SINGLE_SHARD}" >> "$GITHUB_OUTPUT"
else
  # Module-specific changes — single runner with affected-only filter.
  echo "skip=false" >> "$GITHUB_OUTPUT"
  echo "modules=$MODULES" >> "$GITHUB_OUTPUT"
  echo "shard_matrix=${SINGLE_SHARD}" >> "$GITHUB_OUTPUT"
fi
