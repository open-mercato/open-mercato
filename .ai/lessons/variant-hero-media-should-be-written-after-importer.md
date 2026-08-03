---
title: "Variant hero media should be written after importer flush-heavy work"
modules: ["catalog","data_sync"]
areas: ["integration","module-data"]
topics: ["data-integrity","data-import","generated-files"]
---

# Variant hero media should be written after importer flush-heavy work

**Context**: Akeneo variant images were being downloaded and attached to the correct variant records, but some variants still ended the import with `default_media_id = null`.

**Problem**: Later ORM flushes in the same import path can leave the attachment in place while writing an older in-memory variant snapshot back over the hero-media fields.

**Rule**: When an importer creates variant attachments and also performs later flush-heavy work, persist the variant hero-media pointer as the final variant write in that path. Attachment assignment and hero-media selection are separate pieces of state and both must survive the last flush.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/catalog-importer.ts` and any importer that assigns attachments plus a default/hero attachment on the same entity in one transaction flow.
