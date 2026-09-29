---
title: "Standalone scaffolds must pin the same Yarn version as the monorepo"
modules: ["create_app"]
areas: ["architecture"]
topics: ["package-runtime","template-sync","testing"]
---

# Standalone scaffolds must pin the same Yarn version as the monorepo

**Context**: `node:24-alpine` exposes Yarn `1.22.22` by default. The monorepo uses Yarn `4.12.0` via the root `packageManager` field and explicit Corepack activation in some environments.

**Problem**: The standalone template had no `packageManager` field and its Dockerfile only ran `corepack enable`, so Docker-based standalone flows could stay on Yarn 1 instead of Yarn 4.

**Rule**: Keep `packages/create-app/template/package.json.template` aligned with the monorepo `packageManager` version and have the template Dockerfile explicitly run `corepack prepare yarn@<version> --activate`.

**Applies to**: `packages/create-app/template/package.json.template`, `packages/create-app/template/Dockerfile`, and any scaffolded environment that relies on Corepack.
