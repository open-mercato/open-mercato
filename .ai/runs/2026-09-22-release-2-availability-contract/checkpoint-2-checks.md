# Checkpoint 2 — Steps 2.5 – 2.9-checkpoint-fix (Phase 1 close)

**Range:** Step 2.5 through Step 2.9-checkpoint-fix (5 Steps; also closes Phase 1 — every Phase 1 row is now `done`).
**Commits:** `67f5dd809` .. `269051ee8` (see PLAN.md Tasks table for per-Step SHAs).
**Touched areas:** admin check API route + resolve-preview API route, `setup.ts`/`di.ts`/i18n, backend UI (policy list/create/edit, admin check tool), and a checkpoint-driven fix to `policyResolution.ts` + one backend page.

## Validation run (runner: local, no Docker `app` container running)

| Check | Scope | Result |
|---|---|---|
| `npx tsc --noEmit` | `packages/core` | ✅ pass, 0 errors |
| `npx turbo run typecheck` | `packages/shared` + `packages/core` | ✅ pass |
| `npx jest` (full suite) | `packages/core` | ✅ 1954/1956 suites, 17657/17663 tests pass. 2 remaining failures are the same pre-existing, unrelated `catalog` product-page tests noted at checkpoint 1 (`useLocale is not a function` inside `catalog`'s own edit page component). |
| `npx jest` (full suite) | `packages/shared` | ✅ 212/213 suites pass; the 1 `TMPDIR`-only failure noted at checkpoint 1 reproduced identically, confirmed environment-only (passes with `TMPDIR=/private/var/tmp`), not caused by this branch. |
| `yarn build:packages` | full | ✅ 38/38 tasks successful (35 cached, 3 rebuilt incl. `@open-mercato/core` — 5024 entry points). |
| `yarn generate` | full | ✅ — `backend/availability/policies{,/create,/[id]}` and `backend/availability/check` routes registered; `/api/availability/policies/resolve-preview` and `/api/availability/check` registered; 577 API paths total. |
| `yarn db:generate` | full | ✅ no-op for `availability`. Same pre-existing unrelated `wms` snapshot drift as checkpoint 1 — deleted, not committed, `wms` snapshot left untouched. |
| `i18n-check-sync` / `--fix` | full | ✅ all 5 locales in sync (pl has real translations; es/de/ko carry EN placeholders per the existing repo-wide convention for untranslated keys). |
| `i18n-check-usage` | full | ✅ 0 missing keys referenced by `availability` files. |
| `i18n-check-hardcoded` | full | ✅ 0 findings in `availability` files. |

## Regressions found and fixed during this checkpoint

A full-suite run (not caught by the availability-scoped test runs used per-Step) surfaced a real functional bug:

1. **`backend-page-route-params.test.ts`** — a workspace-wide guard for issue #5600: a module backend page MUST take its route params from the `params` **prop** (set by the `/backend/[...slug]` catch-all from the matched route manifest entry), never from `next/navigation`'s `useParams()` (which returns the catch-all's own `{ slug: [...] }` shape, not the module route's params). My `[id]/page.tsx` used `useParams()` — this is not a style nit, it is the exact bug #5600 describes: the edit page would have hung on its initial loading state with the record fetch never firing, because `params.id` would always be `undefined`. Fixed by switching to the `{ params }: { params?: { id?: string } }` prop signature every other working detail page in the repo uses.

Also, while drafting Phase 2 (Step 3.1, requires batched policy resolution for R4), a design gap in the already-committed `policyResolution.ts` (Step 2.3) became apparent: its `resolve()` issued one `AvailabilityPolicy` query per call, which would violate R4 ("`check()` MUST issue exactly one balance aggregation, one profile lookup and one policy lookup per call regardless of item count") the moment `wms`'s batched provider calls it once per item in a 200-variant listing. Added `resolveMany()` — one batched `$or` query across every scope's candidate rows, plus one batched `ProductInventoryProfile` existence check for scopes that fall through to the module default — and re-implemented `resolve()` as `resolveMany([scope])[0]` so every existing single-item call site (admin check route, resolve-preview route, the catalog-only fallback hook) is unaffected. New tests assert the query count stays constant at 2 calls (policy pool + profile batch) for a 200-scope batch.

## UI verification

Still not applicable — no live Playwright run possible in this sandbox (no container runtime for the ephemeral Postgres + dev server). Deferred to the final gate.

## Next Step

3.1 — wms sellable-quantity calculation + tests (R1, R4). Draft implementation and its 14-test suite are already written and passing (`packages/core/src/modules/wms/lib/availabilityCalculation.ts` + `__tests__/availabilityCalculation.test.ts`); landing as its own Step commit next.
