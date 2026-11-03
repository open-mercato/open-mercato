---
title: "Standalone generators must reuse package-generated entity metadata instead of parsing compiled `dist` files"
modules: ["entities","cli","create_app"]
areas: ["module-data","architecture","framework-context"]
topics: ["auto-discovery","build-output","data-scoping"]
---

# Standalone generators must reuse package-generated entity metadata instead of parsing compiled `dist` files

**Context**: The standalone `create-app` flow generates app-local `.mercato` artifacts while official packages are consumed from `node_modules`.

**Problem**: The entity-id generator parsed exported classes and property declarations from module entity files. That works against monorepo `src` files, but compiled `dist/modules/**/data/entities.js` files do not preserve that source shape, so standalone generation silently dropped package entities like `organization`.

**Rule**: In standalone mode, when building app-level generated entity IDs/field shims for package-backed modules, prefer the package's shipped `generated/entities.ids.generated.ts` and `generated/entities/*/index.ts` artifacts. Do not rely on parsing compiled `dist` entity files for source-level declarations. Parsing compiled output for *class names alone* is an acceptable last resort when no generated artifact carries them — the entity-registry duplicate-class-name check prefers the package's shipped `src/modules` mirror and only falls back to `dist` for that one fact.

**Applies to**: `packages/cli/src/lib/generators/entity-ids.ts` and standalone `create-app` generation paths.
