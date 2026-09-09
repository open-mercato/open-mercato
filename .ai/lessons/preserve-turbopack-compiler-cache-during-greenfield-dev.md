---
title: "Preserve Turbopack compiler cache during greenfield dev warmup"
modules: ["cache","auth","create_app"]
areas: ["module-data","architecture","debugging"]
topics: ["dev-runtime","runtime-startup","template-sync"]
---

# Preserve Turbopack compiler cache during greenfield dev warmup

**Context**: `yarn dev:greenfield` was changed to purge the whole configured Next.js distDir before booting the app.

**Problem**: Removing all of `apps/mercato/.mercato/next` also deletes `.mercato/next/dev/cache/turbopack`. That turns `/login`, `POST /api/auth/login`, and especially `/backend` warmup into cold compiles, making greenfield startup much slower than regular `yarn dev` and slower than `main`.

**Rule**: Greenfield cleanup may remove stale route/middleware manifests and lock files before startup, but must preserve `.mercato/next/dev/cache/turbopack`. Do not purge Next/Turbopack caches between warmup requests; cache reuse should make each subsequent warmup request faster. Only clear `.mercato/next/dev` for explicit `yarn dev:reset` or the one-shot corrupted Turbopack cache recovery path.

**Applies to**: `scripts/dev-cache-purge.mjs`, `packages/create-app/template/scripts/dev-cache-purge.mjs`, `scripts/dev.mjs`, `packages/create-app/template/scripts/dev.mjs`, `apps/mercato/scripts/dev.mjs`, `packages/create-app/template/scripts/dev-runtime.mjs`, `scripts/dev-ephemeral.ts`, and related dev-server tests.
