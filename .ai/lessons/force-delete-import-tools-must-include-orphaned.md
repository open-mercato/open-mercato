---
title: "Force-delete import tools must include orphaned imported rows, not only mapped rows"
modules: ["catalog","data_sync"]
areas: ["integration"]
topics: ["data-import","force","delete"]
---

# Force-delete import tools must include orphaned imported rows, not only mapped rows

**Context**: The Akeneo "Force delete all imported products" action originally found products only through `sync_external_id_mappings`.

**Problem**: Earlier bad imports could leave Akeneo-origin products behind after mappings were lost or overwritten. The delete tool reported success but still left imported rows in the catalog, which then polluted later re-imports and caused duplicate-SKU conflicts.

**Rule**: Destructive importer cleanup must discover imported rows from durable record metadata as well as external-ID mapping tables. Mapping tables alone are not a complete source of truth after failed or partial syncs.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/delete-imported-products.ts` and any future cleanup/reset actions for integration-owned data.
