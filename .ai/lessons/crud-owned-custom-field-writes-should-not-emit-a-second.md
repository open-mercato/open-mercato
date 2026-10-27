---
title: "CRUD-owned custom-field writes should not emit a second entity event"
modules: ["entities","query_index","cli"]
areas: ["module-data","umes"]
topics: ["command-pattern","custom-fields","data-integrity"]
---

# CRUD-owned custom-field writes should not emit a second entity event

**Context**: Generic CRUD routes save scalar entity data and custom fields, then emit the canonical CRUD side effect with events and query-index configuration. Letting the intermediate `setCustomFields()` call also emit `<module>.<entity>.updated` creates a second event path through the query-index DI bridge.

**Problem**: The duplicate path can run inside the write transaction, swallow query-index failures as best-effort event work, and obscure the single request-owned side-effect path that is supposed to surface always-consistent index failures.

**Rule**: When a CRUD route owns both the custom-field write and the subsequent `markOrmEntityChange()` / `flushOrmEntityChanges()` call, pass `notify: false` to `setCustomFields()`. The canonical created/updated/deleted side effect should be emitted exactly once after the entity/custom-field write succeeds. That is only half of the dedupe contract: when `DataEngine` also owns an explicit `indexer`, mark its domain-event payload as query-index-managed and have the legacy DI domain bridge skip it (including `skipReindex`). Keep internal ownership markers non-enumerable so client-broadcast and persisted event payloads preserve their public shape. Otherwise the canonical domain event and the inline `query_index.upsert_one` still index the same record twice and duplicate failure logs.

**Applies to**: `packages/shared/src/lib/crud/factory.ts`, command helpers that compose custom fields with CRUD side effects, and module routes that manually combine `setCustomFields()` with query-index side effects.
