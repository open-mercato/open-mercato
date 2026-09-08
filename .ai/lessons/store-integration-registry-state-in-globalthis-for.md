---
title: "Store integration registry state in `globalThis` for standalone workers"
modules: ["integrations","shared","create_app"]
areas: ["integration","architecture","testing"]
topics: ["generated-files","module-boundaries","database-migrations"]
---

# Store integration registry state in `globalThis` for standalone workers

**Context**: Standalone snapshot integration tests bootstrapped `sync_excel` metadata, but the test-side queue drain loaded worker/sync-engine code through a second package module instance.

**Problem**: The integration registry used module-local Maps, so `data_sync` could not resolve `sync_excel` to provider key `excel` in the worker path and fell back to the raw integration id.

**Rule**: Shared runtime registries that translate module metadata for workers, CLI, or standalone parity must keep canonical mutable state in `globalThis`. Add isolated-module regression tests when fixing these paths.

**Applies to**: `packages/shared/src/modules/integrations/types.ts` and similar shared registries consumed after dynamic app bootstrap.
