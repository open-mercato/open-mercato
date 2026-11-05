---
title: "Akeneo variant reuse must be scoped to the current product, not global SKU matches"
modules: ["catalog","data_sync"]
areas: ["integration","debugging"]
topics: ["data-import","data-scoping"]
---

# Akeneo variant reuse must be scoped to the current product, not global SKU matches

**Context**: The importer used SKU fallback when an Akeneo variant external-ID mapping was missing.

**Problem**: If a stale or orphaned Akeneo variant row with the same SKU already existed under a different product, the importer could reuse that wrong variant ID. Price creation then failed with `Variant does not belong to the provided product`, even though the Akeneo source data itself was valid.

**Rule**: Variant fallback matching must always be scoped to the current product. A missing external-ID mapping is not enough reason to reuse a same-SKU variant from another product.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/catalog-importer.ts`, Akeneo re-import logic, and any sync adapter that falls back from stable external IDs to local natural keys.
