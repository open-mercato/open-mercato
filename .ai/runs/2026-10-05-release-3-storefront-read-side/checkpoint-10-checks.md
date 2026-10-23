# Checkpoint 10 — Phase 5 close (Buyer-Scoped Visibility Phase 2 gate)

**Timestamp:** 2026-10-06T12:26:53Z
**Steps covered:** 5.1–5.3 (457bab312e .. 283603f0d8)
**Runner:** local mode (`LANG=en_US.UTF-8`) for unit/typecheck; ephemeral env (fresh forced build incl. 5.1/5.2, own DB, started 11:40Z) for integration
**Touched areas:** ecommerce channel binding `require_authentication` (entity, validators, admin CRUD + openApi, store resolution, buyer resolver short-circuit), ecommerce migration, TC-ECOM-005.

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` | ✅ | 38/38 tasks, 0 cached |
| `yarn db:generate` | ✅ | only the intended ecommerce `add column require_authentication boolean not null default false`; unrelated wms drift deleted |
| typecheck core (`tsc --noEmit`) | ✅ | |
| `yarn workspace @open-mercato/core test` (FULL) | ✅ 19561 passed | 18 skipped (pre-existing) |
| `yarn i18n:check-sync` | ✅ | |
| `yarn test:integration TC-ECOM-005` (ephemeral) | ✅ 3/3 | anonymous on closed channel: listing 200 empty, detail 404 identical to nonexistent (handle + id), `/context` 200, never 503; portal buyer (cookie + bearer) sees the product; toggling the gate off/on takes effect immediately (no stale cache); interleaved anonymous/authenticated requests never mix |
| `yarn test:integration TC-ECOM-01` (isolation, unmodified) | ✅ 9/9 | |
| `yarn test:integration TC-ECOM-00` | ✅ 15/15 | 12 prior + 3 new |

**Gate:** Buyer-Scoped Visibility Phase 2 ✅ — "customer_groups not called" for anonymous on a closed channel asserted at unit level (5.1: resolveGroups/resolveTerms/resolveAssortmentScope not invoked); observable behavior asserted in integration.
**UI:** not touched — no screenshots.
