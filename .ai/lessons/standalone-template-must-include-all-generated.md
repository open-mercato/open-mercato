---
title: "Standalone template must include all generated bootstrap registries"
modules: ["create_app","events"]
areas: ["architecture","integration"]
topics: ["auto-discovery","events","generated-files"]
---

# Standalone template must include all generated bootstrap registries

**Context**: Standalone integration tests failed only for UMES enricher scenarios (`TC-UMES-002`) while other tests passed.

**Problem**: `packages/create-app/template/src/bootstrap.ts` drifted from `apps/mercato/src/bootstrap.ts` and did not pass generated `enricherEntries` into `createBootstrap(...)`, so response enrichers were never registered in scaffolded apps.

**Rule**: Whenever app bootstrap wiring changes (events, analytics, enrichers, message registries, similar generated registries), mirror the same imports and `createBootstrap(...)` arguments in `packages/create-app/template/src/bootstrap.ts` in the same PR.

**Applies to**: Scaffolded standalone apps and snapshot/standalone integration workflows.
