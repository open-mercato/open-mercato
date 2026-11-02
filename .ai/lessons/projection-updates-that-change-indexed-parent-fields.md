---
title: "Projection updates that change indexed parent fields must emit query-index upserts"
modules: ["query_index","customers","events"]
areas: ["module-data","debugging"]
topics: ["command-pattern","events","filters"]
---

# Projection updates that change indexed parent fields must emit query-index upserts

**Context**: Customer interaction commands recomputed `next_interaction_*` fields directly on `customer_entities`, which changed list/search-visible data without mutating the `CustomerEntity` through its normal CRUD command path.

**Problem**: The companies/people grids showed the fresh `next_interaction_name`, but `entity_indexes` and `search_tokens` for `customers:customer_entity` stayed stale. Global search and token-backed filters then missed values that were visibly present in the grid until a manual reindex happened.

**Rule**: Any command or projection that directly updates fields surfaced through query-indexed docs must also emit `query_index.upsert_one` for the affected entity records. If child/profile docs denormalize the same parent fields, review whether they need matching upserts too.

**Applies to**: Projection helpers, lifecycle commands, and any write path that bypasses the primary CRUD/indexer helpers while changing search/list-visible fields. Data migrations are the one such writer that cannot emit from where it stands — they declare instead, see [Data migrations must declare the query-index projections they invalidate](data-migrations-must-declare-the-projections-they.md).
