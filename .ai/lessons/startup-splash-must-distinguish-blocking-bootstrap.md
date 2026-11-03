---
title: "Startup splash must distinguish blocking bootstrap failures from non-blocking runtime warnings"
modules: ["customers","search","create_app"]
areas: ["architecture","debugging","module-data"]
topics: ["error-states","dev-runtime","package-runtime"]
---

# Startup splash must distinguish blocking bootstrap failures from non-blocking runtime warnings

**Context**: The compact splash runtime promoted any raw log line containing `failed` or `Error:` into a blocking startup failure.

**Problem**: Non-fatal search/vector warnings such as `[SearchService] Strategy index failed ...` and `[search.customers] Failed to load ...` flipped setup/dev splash screens into a blocking error even after Next had become ready. Once warmup later succeeded, the splash still looked like launch had failed.

**Rule**: Splash startup classification must keep an explicit allowlist for known non-blocking runtime warnings, and once launch is already ready/warmed the splash must not demote the session back to failed because of later raw output. Keep this policy mirrored between the monorepo runtime and the standalone template copy.

**Applies to**: `apps/mercato/scripts/dev.mjs`, `apps/mercato/scripts/dev-runtime-log-policy.mjs`, `packages/create-app/template/scripts/dev-runtime.mjs`, and `packages/create-app/template/scripts/dev-runtime-log-policy.mjs`.
