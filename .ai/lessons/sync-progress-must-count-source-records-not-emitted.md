---
title: "Sync progress must count source records, not emitted side-effect items"
modules: ["data_sync","progress","catalog"]
areas: ["module-data","integration"]
topics: ["data-import","events","testing"]
---

# Sync progress must count source records, not emitted side-effect items

**Context**: The Akeneo product adapter emits multiple import items per source product (for example product + default variant), but the sync engine was using `batch.items.length` as the user-facing processed count.

**Problem**: Progress showed inflated numbers like 1800 processed for a 1320-product Akeneo catalog, which made the run look stuck or inconsistent even when it was just finishing reconciliation after the last real source page.

**Rule**: When adapters emit derived records, they must report a separate source-level processed count, and the sync engine must use that value for progress. Batch/item counters may still track created/updated records separately, but user-facing progress should match the source system's entity count.

**Applies to**: `packages/core/src/modules/data_sync/lib/adapter.ts`, `packages/core/src/modules/data_sync/lib/sync-engine.ts`, Akeneo import batches, and any future adapter that explodes one external record into multiple local writes.
