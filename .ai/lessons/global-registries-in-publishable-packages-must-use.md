---
title: "Global registries in publishable packages must use `globalThis`, not module-local state"
modules: ["shared","create_app"]
areas: ["architecture","module-data"]
topics: ["events","module-boundaries","package-runtime"]
---

# Global registries in publishable packages must use `globalThis`, not module-local state

**Context**: Standalone `create-mercato-app` loaded `@open-mercato/shared/lib/db/mikro` through multiple server chunk/module instances while the monorepo dev app used a single source-tree instance.

**Problem**: Bootstrap registered ORM entities in one module instance, but `/api/events/stream` created a request container through another instance. Because the entity registry lived in a module-local variable, the second instance saw an empty registry and crashed with `[Bootstrap] ORM entities not registered`.

**Rule**: Any publishable cross-package registry that must be visible across bootstrap, API routes, and request containers must persist via `globalThis` with a stable key. Do not store bootstrap-critical registries only in module-local variables.

**Applies to**: ORM/entity registries, DI registrars, module registries, and other standalone-sensitive bootstrap state in `@open-mercato/*` packages.
