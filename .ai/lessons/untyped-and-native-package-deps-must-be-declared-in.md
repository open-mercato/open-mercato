---
title: "Untyped and native deps belong in the app"
modules: ["documents","app"]
areas: ["architecture","integration"]
topics: ["build-output","package-runtime","template-sync"]
---

# Untyped and native deps belong in the app

**Context**: The documents module pulls in `html-to-docx` (untyped) and `puppeteer-core` (heavy Node CJS with dynamic requires).

**Problem**: The Next app build can't see a workspace package's `src/types/*.d.ts` ambient shim.

**Rule**: An untyped dep used by a package route needs its `declare module` in `apps/mercato/types/<mod>/index.d.ts` (a `typeRoots` folder), and heavy Node CJS deps with dynamic requires need `serverExternalPackages` in `next.config.ts`. Mirror both into the create-app template in the same change.

**Applies to**: any package dependency reaching the app build. Package typecheck passes; only `yarn build:app` surfaces either failure.
