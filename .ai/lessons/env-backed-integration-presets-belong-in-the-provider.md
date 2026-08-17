---
title: "Env-backed integration presets belong in the provider module, not core"
modules: ["integrations","data_sync","cli"]
areas: ["integration","architecture"]
topics: ["data-import","data-scoping","module-boundaries"]
---

# Env-backed integration presets belong in the provider module, not core

**Context**: Akeneo needed a way to come up preconfigured on fresh installs from deployment environment variables, while still supporting a manual rerun later.

**Problem**: Pushing provider-specific bootstrap logic into core integration or data-sync modules would couple generic infrastructure to one connector and make every future provider preset harder to maintain.

**Rule**: Provider-specific env bootstrapping should live in the provider package itself, exposed through that module's own `setup.ts` and `cli.ts`, and should reuse the same helper for automatic tenant init and manual reruns.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/setup.ts`, `packages/sync-akeneo/src/modules/sync_akeneo/cli.ts`, and future integration packages that need env-driven bootstrap.
