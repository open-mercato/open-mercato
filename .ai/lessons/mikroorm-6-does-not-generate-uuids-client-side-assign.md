---
title: "MikroORM 6 does NOT generate UUIDs client-side — assign PKs before referencing"
modules: ["cli","shared"]
areas: ["module-data"]
topics: ["data-integrity","testing","validation-errors"]
---

# MikroORM 6 does NOT generate UUIDs client-side — assign PKs before referencing

**Context**: `@PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })` configures PostgreSQL to generate UUIDs at INSERT time. When `em.create(Entity, data)` is called without an explicit `id`, the entity's `id` field is `undefined` until `em.flush()` executes the INSERT.

**Problem**: In `sales/commands/documents.ts`, the quote/order creation code called `em.create(SalesQuote, { ... })` without providing an `id`, then immediately referenced `quote.id` when re-validating inline line items via `quoteLineCreateSchema.parse({ quoteId: quote.id })`. Since `quote.id` was `undefined`, Zod validation failed with "quoteId: Invalid input: expected string, received undefined" — silently breaking inline line creation for both quotes and orders.

**Rule**: When creating an entity and immediately referencing its PK (before flush), generate the UUID client-side via `crypto.randomUUID()` and pass it explicitly: `em.create(Entity, { id: randomUUID(), ... })`. This ensures the PK is available immediately for child entity creation.

**Applies to**: Any `em.create()` call where the entity's PK is referenced before `em.flush()`, especially parent-child patterns where children need the parent's ID.
