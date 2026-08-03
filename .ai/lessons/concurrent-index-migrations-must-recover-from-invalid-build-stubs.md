---
title: "Concurrent index migrations must recover from invalid build stubs"
modules: ["query_index"]
areas: ["module-data","debugging","testing"]
topics: ["concurrency","database-migrations","data-integrity"]
---

# Concurrent index migrations must recover from invalid build stubs

**Context**: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` was used for a large online index build.

**Problem**: PostgreSQL can leave an invalid index relation after an interrupted concurrent build. A retry with `IF NOT EXISTS` sees the relation and skips rebuilding it, allowing the migration to finish without a usable index.

**Rule**: For a new concurrently built index, make the migration retry-safe by dropping the named index concurrently before creating it, and keep the migration non-transactional.

**Applies to**: PostgreSQL online index migrations and deployment retries after interrupted schema changes.
