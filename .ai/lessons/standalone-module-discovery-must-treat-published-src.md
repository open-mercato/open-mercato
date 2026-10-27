---
title: "Standalone module discovery must treat published `src/modules` as canonical over `dist/modules`"
modules: ["create_app","events","cli"]
areas: ["architecture","framework-context","umes"]
topics: ["build-output","events","generated-files"]
---

# Standalone module discovery must treat published `src/modules` as canonical over `dist/modules`

**Context**: The standalone CLI scans installed packages under `node_modules/@open-mercato/*`. Published packages include compiled `dist/modules` output and also ship `src/modules`.

**Problem**: Using `dist/modules` as the discovery source pulled in two classes of bad inputs that do not appear in monorepo source mode: helper files compiled from `.ts` to lower-case `.js` under `frontend/` and `backend/`, and stale dist-only artifacts such as legacy API handlers that no longer exist in `src/modules`. That produced bogus generated routes/imports and standalone-only build failures.

**Rule**: In standalone generation, use the package's `src/modules` tree as the canonical discovery mirror when it exists, but keep runtime imports pointed at compiled `dist` files. Do not let dist-only artifacts or extension changes in compiled output redefine what counts as a route, API file, or convention file.

**Applies to**: `packages/cli` module scanning, route/API discovery, standalone create-app flows, and any generator that inspects installed `@open-mercato/*` packages.
