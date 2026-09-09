---
title: "Flush entity updates before running relation syncs that query"
modules: ["catalog"]
areas: ["module-data"]
topics: ["command-pattern","data-integrity"]
---

# Flush entity updates before running relation syncs that query

**Context**: `catalog.products.update` mutates scalar fields and then calls `syncOffers` / `syncCategoryAssignments` / `syncProductTags`, which perform `find` queries. MikroORM auto-flush + subscriber logic reset `__originalEntityData`, resulting in no change sets and no UPDATE being issued.

**Problem**: Updates to the main entity silently did not hit the database when relation syncs executed before the flush.

**Rule**: If an update command mutates scalar fields and then performs relation-sync queries, flush the main entity changes *before* those syncs (or split into two UoWs/transactions).

**Applies to**: Commands that update a core record and then call sync helpers that query/modify relations using the same `EntityManager`.
