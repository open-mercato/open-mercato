---
title: "Materialize locking prune batches before deleting"
modules: ["payment_gateways"]
areas: ["module-data", "debugging", "testing"]
topics: ["concurrency", "postgresql", "retention", "data-integrity"]
---

# Materialize locking prune batches before deleting

**Context**: The payment-session retention worker selects an ordered, scoped batch using `FOR UPDATE SKIP LOCKED` before deleting expired claims (#4888).

**Problem**: A locking `DELETE ... WHERE id IN (SELECT ... LIMIT 2 FOR UPDATE SKIP LOCKED)` subquery was re-evaluated during deletion. The PostgreSQL integration test removed all seven fixture rows in one invocation instead of two. Mocked affected-row counts did not expose this behavior.

**Rule**: Freeze the selected IDs in an explicit `MATERIALIZED` CTE, then delete only those IDs with the same tenant and organization predicates. Keep a PostgreSQL regression that verifies both the affected-row count and the remaining IDs after every batch.

**Applies to**: Scoped retention workers and other bounded PostgreSQL deletes that lock selected rows. Regression evidence: `packages/core/src/modules/payment_gateways/__integration__/TC-PGWY-024.spec.ts`, mixed-state bounded draining case.
