---
title: "Akeneo base-field imports must not fall back across locales or channels"
modules: ["data_sync","catalog"]
areas: ["integration","debugging"]
topics: ["data-import","data-scoping","testing"]
---

# Akeneo base-field imports must not fall back across locales or channels

**Context**: Akeneo product values were being resolved with a score-based matcher that could still pick a different locale or scope when the selected locale/channel did not exist.

**Problem**: German or other scoped Akeneo content leaked into the tenant's base Open Mercato fields, so a single-locale import silently mixed languages and channel variants instead of leaving the field empty.

**Rule**: When importing into non-translation Open Mercato fields, only accept the explicitly selected Akeneo locale/channel plus Akeneo's unlocalized or unscoped fallback entries. Never fall back to a different locale or channel just to fill a value.

**Applies to**: `packages/sync-akeneo/src/modules/sync_akeneo/lib/catalog-importer.ts`, future translation import work, and any adapter that flattens layered external localized values into base fields.
