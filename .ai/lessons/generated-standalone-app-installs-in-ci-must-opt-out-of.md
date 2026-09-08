---
title: "Generated standalone app installs in CI must opt out of immutable lockfiles"
modules: ["create_app"]
areas: ["architecture","integration","testing"]
topics: ["generated-files","database-migrations","package-runtime"]
---

# Generated standalone app installs in CI must opt out of immutable lockfiles

**Context**: Snapshot parity scaffolds a fresh standalone app from `create-mercato-app` and then runs `yarn install` inside that generated directory.

**Problem**: On CI, Yarn enables immutable installs by default. Because the scaffold intentionally ships only a minimal root workspace `yarn.lock`, the first standalone `yarn install` needs to materialize the real lockfile and otherwise fails with `YN0028`.

**Rule**: When CI or smoke tests run the first `yarn install` inside a freshly scaffolded standalone app, set `YARN_ENABLE_IMMUTABLE_INSTALLS=0`. Do this only for the generated app install/add steps, not for the monorepo install.

**Applies to**: `.github/workflows/snapshot.yml`, `scripts/test-create-app.ts`, and `scripts/test-create-app-integration.ts`.
