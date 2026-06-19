# Phase 21 — Live QA reproduction & root-cause report (PR #2055)

**Date:** 2026-05-29
**Method:** Booted the monorepo app on `http://localhost:3100` from the PR-head worktree
against the shared `open-mercato` Postgres/Redis (no schema change in this PR, so sharing the
demo DB is safe). Drove it with the Playwright MCP browser + raw API probes, and ran the
existing integration harness against `:3100`.

## Environment notes (so the next run can reproduce)

- The `:3000` server is a **separate standalone app** (`/Users/piotrkarwatka/Projects/my-app`)
  consuming **published** `@open-mercato/*` from `node_modules` — it does NOT reflect this
  branch. Must boot the monorepo app to test branch code.
- `dev:ephemeral` needs Docker (not running here). The `yarn dev`/`dev:app` wrapper's
  **package-watcher crashes esbuild** under the resource pressure of a second full stack.
- **Reliable boot:** `yarn install` → `yarn build:packages` → `yarn turbo run generate` →
  `yarn build:packages` (2nd pass bundles the per-package `generated/` shims into `dist`) →
  then `next dev -p 3100` directly in `apps/mercato` (Turbopack, Rust — avoids the esbuild
  crash). Routes first-compile lazily (10–16s) on first hit.
- Integration harness works against it: `BASE_URL=http://localhost:3100
  OM_INTEGRATION_MODULES=customers yarn test:integration -g TC-LOCK-OSS-001` → **2 passed**.
- Admin login: `admin@acme.com` / `secret`.

## Findings

### ✅ Server-side OSS guard works (no change needed)
- `TC-LOCK-OSS-001` passes live: stale `x-om-ext-optimistic-lock-expected-updated-at` → **409**
  with the structured body; header-less write passes (additive).

### ✅ CRM v2 pages are ALREADY correctly wired (NO FIX NEEDED)
Proven live on `companies-v2/[id]`:
- The `PUT /api/customers/companies` save **carries** `x-om-ext-optimistic-lock-expected-updated-at`
  (captured: `2026-05-29T09:18:56.416Z`). → header is sent on update.
- Forcing a stale version (out-of-band API edit) then saving → **409 Conflict** (network proof).
- The conflict toast renders the **localized** string: *"This record was modified by someone else.
  Refresh and try again."* — NOT the raw `record_modified` key.
- Mechanism: the v2 detail page embeds `CrudForm` with `optimisticLockUpdatedAt={record.updatedAt}`;
  `CrudForm` wraps the caller's `onSubmit` (the custom `updateCrud`) in
  `withScopedApiRequestHeaders(mergedSubmitHeaders)` and surfaces the 409 via
  `t('ui.forms.flash.recordModified')`. `people-v2` uses the same mechanism; `deals` use
  `useDealFormHandlers` which already wraps update+delete with `buildOptimisticLockHeader`.
- The `companies/[id]` & `people/[id]` **v1** detail pages are **dead routes for editing** —
  the list pages route every row click and "open" action to `companies-v2`/`people-v2`
  (`companies/page.tsx:615,887,906,911`; `people/page.tsx:628,915,933,938`); only `/create`
  links to v1.

**Therefore @alinadivante's "same-user two-tab company silently overwrites" + "people-v2
unprotected" were NOT OSS client-wiring bugs.** They are explained by (a) the enterprise
pessimistic `record_locks` artifact present in her environment (same lock-owner → no
pessimistic conflict; OSS version-compare *does* 409), and/or (b) testing before the Phase 11/15
client wiring landed. With pure OSS on this branch, CRM v2 + deals 409 correctly with a
localized toast. → **Phase 23 (CRM) collapses to a no-op / regression-test-only.**

### Conflict / delete contract (for test assertions)
- Stale `updated_at` header on PUT → **409** (structured body).
- No header → **pass-through** (additive).
- DELETE on an already-deleted record → **404** (confirmed live). `TC-LOCK-OSS-004` already
  proves stale-header DELETE → 409.

### ❌ Real remaining OSS gaps (the fixes for THIS PR)
1. **Sales document detail page** (`sales/documents/[id]/page.tsx`) — `orders/[id]` AND
   `quotes/[id]` both delegate here. The inline-edit callers (`updateDocument(...)`:
   currency/dates/customer/channel/shipping+payment method/addresses/statuses/comment) and
   `handleDelete()` **do not send** the lock header → this is @alinadivante's "sales.orders can
   be edited concurrently; changes overwrite silently". → **Phase 25**.
2. **Sales document sub-sections** (Items / Adjustments / Returns / Shipments / Payments) —
   client create/update/delete **do not send** the document version header. Server already
   enforces lines/adjustments/returns via `enforceSalesDocumentOptimisticLock` (Phase 17), so
   this is **client header + conflict flash + parent reload** only. → **Phase 26** (the part of
   #2215 the user pulled forward to reach 100% OSS).
3. **Sales channels list edit/delete broken state** — deleted channel can linger in the list and
   opening it shows an empty form + `not_found`. Needs delete-conflict surfacing + list refresh +
   graceful not-found handling. → **Phase 25**.
4. **Catalog product-variant delete** (`catalog/products/[productId]/variants/[variantId]/page.tsx`)
   — the DELETE already sends the header but the `catch` flashes a generic error instead of the
   localized `recordModified` on 409. Product *update* already sends the header + surfaces
   conflict; categories edit is via CrudForm (covered). → **Phase 24**.

### Payments / Shipments header semantics (resolved decision)
Payments & Shipments use a flat `makeCrudRoute` input with a top-level `id`, so their **row-level**
`makeCrudRoute` guard fires (Phase 17.6). For 100% OSS coverage we send **the row's own
`updatedAt`** (row-level), NOT the document aggregate, and only add **conflict surfacing**. Lines /
Adjustments / Returns use the **document-aggregate** header (their CRUD route nulls `candidateId`,
so the command-level `enforceSalesDocumentOptimisticLock` is their sole guard). No double-guard.

## Net effect on the plan
- Phase 22 (framework hook) — **done** (`42e1feffd`).
- Phase 23 (CRM) — downgrade to **regression integration tests only** (v2 + deals already wired).
- Phases 24 (catalog variant delete), 25 (sales doc page + channels), 26 (sales sub-sections) —
  the real client-wiring work.
- Phase 27 — concurrent-edit + stale-delete integration specs + browser re-verify with screenshots.
