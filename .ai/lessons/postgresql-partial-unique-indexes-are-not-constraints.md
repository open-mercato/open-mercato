---
title: "PostgreSQL partial unique indexes are not constraints"
modules: ["platform"]
areas: ["module-data","debugging"]
topics: ["data-integrity","data-scoping","testing"]
---

# PostgreSQL partial unique indexes are not constraints

**Context**: AI token usage rollups created partial unique indexes for nullable `organization_id`, then the raw UPSERT tried `ON CONFLICT ON CONSTRAINT ai_token_usage_daily_tenant_day_agent_model_org_uq`.

**Problem**: PostgreSQL `ON CONFLICT ON CONSTRAINT` can only target named table constraints. A partial unique index is only inferable through `ON CONFLICT (...) WHERE ...`, so the recorder logged a non-fatal failure on every token-usage write.

**Rule**: When a nullable scope needs separate partial unique indexes (`organization_id IS NULL` / `IS NOT NULL`), raw UPSERTs must use conflict inference with the exact indexed columns and predicate. Add repository-level SQL-shape tests for every raw UPSERT against partial indexes.

**Applies to**: `packages/**/data/repositories/**`, MikroORM migrations with partial unique indexes, and any raw `INSERT ... ON CONFLICT` SQL.
