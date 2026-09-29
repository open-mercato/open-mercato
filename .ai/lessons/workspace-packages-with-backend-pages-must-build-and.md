---
title: "Workspace packages with backend pages must build and export deep TSX entrypoints"
modules: ["platform"]
areas: ["integration","architecture"]
topics: ["build-output","generated-files","module-boundaries"]
---

# Workspace packages with backend pages must build and export deep TSX entrypoints

**Context**: The new `@open-mercato/webhooks` workspace package exposed backend pages through generated imports like `@open-mercato/webhooks/modules/webhooks/backend/webhooks/page`, but the package build only compiled `src/**/*.ts` and the export map stopped before the deepest generated paths.

**Problem**: `yarn build:app` failed even though generation succeeded, because the generated app imported real package entrypoints that were neither emitted to `dist/` nor resolvable through `package.json` exports.

**Rule**: Any workspace package that contributes auto-discovered backend/frontend pages must compile both `.ts` and `.tsx` sources into `dist/`, and its export map must cover the deepest generated import paths used by `modules.generated.ts`.

**Applies to**: `packages/webhooks/build.mjs`, `packages/webhooks/package.json`, and future feature packages that expose generated page modules.
