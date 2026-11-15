---
title: "Data migrations must declare the query-index projections they invalidate"
modules: ["query_index","cli","customers"]
areas: ["module-data","architecture","debugging"]
topics: ["database-migrations","query-index","events"]
---

# Data migrations must declare the query-index projections they invalidate

**Context**: `Migration20260519120000_pipeline_stage_color_tones` rewrote `customer_dictionary_entries.color` from hex chips to semantic tones, and `Migration20260428102318` renamed three seeded `workflow_definitions.workflow_id` values. Both are plain SQL `update`s.

**Problem**: `entity_indexes.doc` for those records — and every `search_tokens` row derived from it, since `rebuildSearchTokensForRecord()` takes `doc` as its sole input — kept the pre-migration value permanently, on two independent databases. Nothing signals it: no indexer job is created, so `indexer_status_logs` is empty rather than red, and neither the record's nor the projection's `updated_at` moves, so a "projection older than record?" heuristic finds nothing. The blast radius is wider than global search — `QueryEngine.applyFilterOp()` routes a `like`/`ilike` filter on an ordinary base column to `applySearchTokens()`, so a CRUD list screen's text filter finds the record by its OLD text and misses its NEW text. An `ADD COLUMN` plus SQL backfill produces the same failure with a different symptom: the key is absent from older docs rather than wrong.

**Rule**: A migration that writes data a query-indexed document projects — an `update`, or an `ADD COLUMN` with a backfill — must export `queryIndexReindexEntityTypes` built with `declareQueryIndexReindex([...])` from `@open-mercato/shared/lib/query/migration-reindex`. `mercato db migrate` collects the declarations of the migrations it just applied and queues one persistent `query_index.reindex` per entity type after the run commits; when no event bus is reachable it prints the equivalent `mercato query_index rebuild --entity <type> --global` for an operator to run. A migration cannot discharge the obligation itself: it holds no DI container, and the projection must only be refreshed once its own transaction has committed.

**Applies to**: Every data migration, including forward-only ones. Repairing an already-applied migration needs a follow-up migration that carries only the declaration — see `Migration20260901120000_reindex_pipeline_stage_colors` and its two siblings. This is the migration-shaped half of [Projection updates that change indexed parent fields must emit query-index upserts](projection-updates-that-change-indexed-parent-fields.md), which covers command and projection write paths.
