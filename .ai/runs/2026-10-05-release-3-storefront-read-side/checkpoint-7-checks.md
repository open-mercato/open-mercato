# Checkpoint 7 — Phase 3 close (Omnibus MVP gate)

**Timestamp:** 2026-10-05T17:48:10Z
**Steps covered:** 3.9 (2ea735bc2d) — closes Phase 3 (3.1–3.9)
**Runner:** ephemeral env (fresh build of the Phase 3 code, own DB)

| Check | Result | Notes |
|---|---|---|
| `BASE_URL=<ephemeral> DATABASE_URL=<ephemeral db> yarn test:integration TC-CAT-OMNI --retries=0` | ✅ 8/8 | history capture via the price API (create/update/delete/undo, cursor, validation); EU promotion reference in preview + products list (lowest 95 / previous 110); disabled → no block; 422 backfill gate; non-EU channel gating; config validation + ACL; tenant isolation; settings panel UI save (browser) |
| Unit/typecheck | ✅ (checkpoint 6) | no code change since besides tests |

**Omnibus MVP gate (spec Phases 1–3):** history immutable + captured on every write path ✅; resolution matches the spec's worked examples (unit) and the EU promotion fixture (integration) ✅; config + backfill gate + admin UI ✅.

**Finding (pre-existing, out of scope):** `PUT /api/catalog/prices` with only `id` + amounts on a product-level price returns 403 — `updatePriceCommand` scope check appears to read an unloaded product reference (`commands/prices.ts` ~:324). Not touched by this PR (diff vs develop has no scope-check changes). Candidate follow-up issue.
