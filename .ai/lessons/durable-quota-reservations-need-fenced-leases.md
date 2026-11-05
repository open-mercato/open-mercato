---
title: "Durable quota reservations need fenced leases, conditional creates, and bounded sizes"
modules: ["attachments","storage_s3"]
areas: ["architecture","module-data"]
topics: ["data-scoping","command-pattern","database-migrations"]
---

# Durable quota reservations need fenced leases, conditional creates, and bounded sizes

**Context**: Making attachment storage-quota admission atomic (2026-07-10) replaced a read-then-check against provider usage with a reservation ledger. A read-then-check cannot hold: two concurrent uploads both read the pre-write usage and both admit.

**Rule**: Model the reservation as a fenced lease with explicit state transitions (reserve → storing → stored → commit/release), admit under an advisory lock, make provider writes create-only so a retry cannot silently overwrite a committed object, and bound signed-upload sizes exactly. Retain reserved capacity until the object's absence is *proven* — releasing on an unverified failure double-counts the quota in the other direction.

**Applies to**: any capacity or rate ledger admitting concurrent writers against an external store, and any recovery worker that reconciles reservations against provider state.
