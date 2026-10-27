---
title: "Integration packages must use decryption-aware find helpers for all entity reads"
modules: ["data_sync","integrations"]
areas: ["integration","module-data"]
topics: ["data-import","data-scoping","package-runtime"]
---

# Integration packages must use decryption-aware find helpers for all entity reads

**Context**: The Akeneo package had accumulated a mix of `findWithDecryption` usage and raw `em.find` / `em.findOne` reads across routes, setup presets, cleanup jobs, and importer internals.

**Problem**: Even when the currently-read fields are not encrypted, raw ORM reads bypass encryption-map handling and create silent regressions once entity fields become encrypted later.

**Rule**: In integration/provider modules, all entity reads should default to `findWithDecryption` / `findOneWithDecryption`; treat raw `em.find` / `em.findOne` as a bug unless there is a deliberate low-level reason that is documented inline.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/**/*` and future integration packages reading tenant-scoped entities.
