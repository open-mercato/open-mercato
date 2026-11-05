# Two-session optimistic-lock integration pattern

How the `TC-LOCK-OSS-*` integration specs prove the OSS opt-in optimistic lock
deterministically — without a browser, two real concurrent clients, or any
sleeps/races. A single Playwright `request` context plays both sessions; the
"conflict" is created by replaying the same pre-edit version after the record
has already moved on.

Wire constants (import, never hardcode) from
`@open-mercato/shared/lib/crud/optimistic-lock-headers`:

- `OPTIMISTIC_LOCK_HEADER_NAME` — request header carrying the expected `updated_at`.
- `OPTIMISTIC_LOCK_CONFLICT_CODE` — `code` in the 409 body.
- `OPTIMISTIC_LOCK_CONFLICT_ERROR` — `error` in the 409 body.

Optimistic locking is **default-ON** for every `makeCrudRoute` entity, and the
guard is **opt-in per request**: it only fires when the client sends
`OPTIMISTIC_LOCK_HEADER_NAME`. So no special env is required — sending the header
arms the check; omitting it stays backward-compatible.

## Concurrent-edit pattern (5 steps)

1. **Auth once** (`getAuthToken(request, 'admin')`) and create the entity via its
   API fixture (created in setup, cleaned up in `finally`).
2. **GET the entity** and read its current `updated_at` — call it `t0`. List-shaped
   CRUD APIs expose it on `items[0].updated_at`. Normalize to ISO before sending,
   though the server also accepts the raw value (it normalizes server-side).
3. **Session A** — PUT with `OPTIMISTIC_LOCK_HEADER_NAME: t0` and a real change.
   Expect `< 300`. The record is now at `t1` (re-GET to confirm `t1 !== t0`).
4. **Session B** (the stale caller) — PUT again with the *same* `t0`. Expect **409**
   with body `{ error: OPTIMISTIC_LOCK_CONFLICT_ERROR, code:
   OPTIMISTIC_LOCK_CONFLICT_CODE, currentUpdatedAt, expectedUpdatedAt: t0 }`,
   where `currentUpdatedAt !== t0`.
5. **Cleanup** the fixture in `finally`.

## Stale-delete pattern

GET `t0` → PUT with `t0` (→ `t1`) → DELETE with header `t0` → **409**; then DELETE
with header `t1` → 200/2xx; DELETE again → already-gone contract (404 or 2xx).

## Document-aggregate (sub-resource) pattern

Sales sub-resources (lines, adjustments, shipments, payments, returns) are not
plain CRUD updates of the child — they run through commands that recalculate the
**parent order/quote** totals, advancing the *parent's* `updated_at`. The command
guards the parent via `enforceSalesDocumentOptimisticLock`. To test:

1. Create the order. GET the order's `updated_at` (`t0`).
2. Advance the order with a second action — add/update a line (no header) → the
   totals recalc dirties the order → `t1`.
3. POST another line carrying the **order's stale** header `t0` → **409**.
4. POST a line carrying the **order's fresh** header `t1` → 2xx.

## Coverage map

| Spec | Module | Entity / surface |
|------|--------|------------------|
| `customers/__integration__/TC-LOCK-OSS-005` | customers | company, person, deal (concurrent edit) |
| `catalog/__integration__/TC-LOCK-OSS-006` | catalog | product (concurrent edit) |
| `sales/__integration__/TC-LOCK-OSS-007` | sales | order (concurrent edit + stale delete) |
| `sales/__integration__/TC-LOCK-OSS-008` | sales | order line (document-aggregate guard) |
