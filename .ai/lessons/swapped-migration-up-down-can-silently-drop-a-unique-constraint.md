---
title: "A migration with swapped up/down can silently drop a unique constraint the code relies on"
modules: ["payment_gateways"]
areas: ["module-data","debugging","testing"]
topics: ["database-migrations","data-integrity","webhooks"]
---

# A migration with swapped up/down can silently drop a unique constraint the code relies on

**Context**: Webhook dedup in `payment_gateways` (`claimWebhookProcessing`) relies on `gateway_webhook_events_idempotency_unique` raising `UniqueConstraintViolationException` for a repeated event.

**Problem**: `Migration20260313222043` had its `up` and `down` swapped, turning the unique constraint into a plain index. The entity and snapshot still declared `unique`, so `yarn db:generate` showed no drift while duplicate webhook deliveries were processed again (upstream #7155 / #7159).

**Rule**: Review every migration's `up`/`down` direction against the entity, not just the snapshot. When correctness depends on a constraint, add an integration or migration test that asserts it exists in `pg_indexes`/`pg_constraint` after migrating, and a behavior test that the duplicate path actually hits the violation.

**Applies to**: `packages/core/src/modules/payment_gateways/migrations/**`, idempotency/dedup tables, and any code that uses a unique violation as a lock.
