---
title: "Fresh standalone Yarn scaffolds must ship a runnable root workspace lockfile entry"
modules: ["create_app"]
areas: ["architecture","testing","module-data"]
topics: ["command-pattern","package-runtime","template-sync"]
---

# Fresh standalone Yarn scaffolds must ship a runnable root workspace lockfile entry

**Context**: `create-mercato-app` advertised `yarn setup` as the first command, but the scaffold only shipped an empty `yarn.lock`.

**Problem**: Yarn 4 resolves package scripts through the lockfile. In a fresh scaffold, `yarn setup` failed before `scripts/setup.mjs` could call `yarn install` with `This package doesn't seem to be present in your lockfile`.

**Rule**: Standalone templates that expect a pre-install Yarn script to run must ship a templated `yarn.lock` containing the root `"{{APP_NAME}}@workspace:."` entry. Keep the standalone smoke test exercising at least one trivial Yarn script before the first install so the regression is caught immediately.

**Applies to**: `packages/create-app/template/yarn.lock.template`, `packages/create-app/src/index.ts`, and `scripts/test-create-app.ts`.
