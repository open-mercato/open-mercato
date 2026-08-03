---
title: "Standalone scaffolding and generators must not assume monorepo-only paths"
modules: ["cli","create_app"]
areas: ["architecture"]
topics: ["generated-files","package-runtime","testing"]
---

# Standalone scaffolding and generators must not assume monorepo-only paths

**Context**: Separately, the standalone `yarn generate` OpenAPI bundle still looked for `packages/shared`, `apps/mercato`, and `tsconfig.base.json`.

**Problem**: Newly scaffolded apps - `yarn generate` printed noisy OpenAPI bundle resolution errors before falling back.

**Rule**: For standalone app flows, do not hardcode monorepo paths; CLI generators must resolve app/package paths through the shared resolver (`getRootDir()`, `getAppDir()`, `getPackageRoot()`) instead of constructing `packages/*` or `apps/mercato/*` paths directly.

**Applies to**: `packages/create-app/**`, `packages/cli/**`, standalone app smoke tests, and any generator/bundler that runs inside installed npm packages.
