---
title: "Derive capture obligations from recorded facts rather than status ordering"
modules: ["payment_gateways"]
areas: ["module-data", "testing"]
topics: ["reconciliation", "idempotency", "data-integrity"]
---

# Derive capture obligations from recorded facts rather than status ordering

**Context**: A capture-completion repair persisted a financial obligation only when the
status-transition helper returned `incompatible`. The existing state machine allows
`partially_captured` to precede `cancelled`, so that helper returned `unchanged` even though
confirmed captured funds still needed reconciliation. Replay derived a reference that the
first completion omitted. Lowercase currency values accepted by session creation also made
the stricter reconciliation parser silently discard otherwise valid legacy obligations.

**Rule**: Derive the financial obligation from the confirmed provider result and recorded
terminal outcome, independently of the status-ordering helper. Persist the same reference
atomically for first completion and replay. Normalize accepted currency representations at
the reconciliation boundary without rewriting payment history or idempotency identity.

**Evidence**: The partial/full completion matrix in `gateway-service.status-lock.test.ts`
and real PostgreSQL completion, legacy-currency, rollback and replay assertions in
`reconciliation.integration.test.ts`. Check stored obligation JSON and caller-visible
references, not only the provider status or captured amount.
