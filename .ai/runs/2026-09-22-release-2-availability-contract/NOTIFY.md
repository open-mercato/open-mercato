# Notify — 2026-09-22-release-2-availability-contract

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-22T00:00:00Z — run started
- Brief: Implement `.ai/specs/2026-08-14-availability-contract.md` §13 Phases 1 and 2 only (shared availability contract + `availability` policy module + `wms` provider). Phase 3 (reservations) and all other ecommerce-suite specs are explicit non-goals.
- External skill URLs: none
- Classified as a Spec-implementation run (spec-driven, multi-phase, new module + DB entity + migration, UI + API + tests together).

## 2026-09-22T12:30:00Z — checkpoint 1 (Steps 1.1–2.4)
- Steps landed: shared availability contract (types/registry/catalog-only fallback), `availability` module skeleton + entity/migration + policy resolution chain + commands + CRUD API route + integration spec.
- Full `packages/shared` + `packages/core` test suites and both typechecks green; `yarn generate`/`yarn db:generate` no-op check for `availability` passed.
- Fixed two full-suite regressions the new module surfaced: `auth` module's ACL-feature i18n catalog guard (added `auth.acl.features.availability.*` keys, all 5 locales) and the enterprise `record_locks` coverage guard (added the `availability:AvailabilityPolicy` decision, `status: 'enabled'`, standard `makeCrudRoute` wiring).
- Caught and fixed a real gap during Step 2.4: the create command was missing tenant/org scope validation on the client-supplied payload (present on update/delete, missing on create) — a client could otherwise have created a policy row under an arbitrary tenant. Fixed before commit.
- Decision: the new `TC-AVAIL-001-policies-crud.spec.ts` Playwright integration spec could not be executed in this sandbox (no container runtime for the ephemeral Postgres + live app server it needs) — typechecked cleanly against real helper signatures instead; deferred to the final gate for actual execution.

## 2026-09-22T13:00:00Z — checkpoint 2 (Steps 2.5–2.9-checkpoint-fix), Phase 1 close
- Landed the rest of Phase 1: admin check API route, resolve-preview endpoint, setup.ts/di.ts/i18n, backend UI (policy list/create/edit, admin check tool).
- Full checkpoint validation green (typechecks, full test suites for shared+core, build:packages 38/38, generate, db:generate no-op, i18n sync/usage/hardcoded checks).
- Fixed a real bug: `[id]/page.tsx` used `useParams()` instead of the `params` prop the backend catch-all passes (issue #5600 pattern) — caught by a workspace-wide guard test, not by anything availability-scoped. The page would have hung on its loading state in production.
- Closed an R4 gap: `policyResolution.ts`'s `resolve()` issued one query per call; `wms`'s upcoming batched provider would have called it once per item in a 200-variant batch, violating R4. Added `resolveMany()` (one batched query for the whole scope set); `resolve()` is now `resolveMany([scope])[0]`, no change to existing callers.
- Phase 1 fully complete. Started drafting Phase 2 Step 3.1 (`wms/lib/availabilityCalculation.ts`) — code + 14 tests written and passing, not yet committed as a Step at the time of this entry.

## 2026-09-22T13:30:00Z — checkpoint 3 (Steps 3.1–3.3), Phase 2 close
- Landed all of Phase 2: batched sellable-quantity calculation, cache + balance-change invalidation, and the wms AvailabilityProvider registration.
- Full checkpoint validation green; explicitly verified the Phase 2 gate (R1 safety-stock-once, R4 constant-query-count, hand-computed multi-location states) through the real end-to-end resolveAvailability() → wms provider path, not just the calculation unit in isolation.
- Design note: the cache invalidation tag deliberately deviates from §6's literal per-variant tag naming in favor of the module's own established coarse-tag precedent (documented in PLAN.md decision 5).
- Both Phase 1 and Phase 2 are now fully complete. Remaining scope: Step 4.1 (Playwright UI tests), Step 4.2 (final generate/db check + spec changelog), then the run's final gate and PR finalize.

## 2026-09-22T15:10:00Z — final gate: live QA found and fixed a real bug
- Ran the full local `validation.commands` gate: green after one real fix (`acl.ts` missing `export default features`, app-level-typecheck-only).
- Provisioned a real disposable-Postgres + live dev-server QA environment (no container runtime in this sandbox) and ran the availability-scoped Playwright suite for the first time — 11/19 executions failed.
- Root-caused every failure from actual error output: a genuine `wms` bug (raw-SQL `= any(?)` doesn't array-bind through MikroORM's `.execute()` — same class as an existing documented fix in `staff`/`dashboards`, #4669 — 500'd `/api/availability/check` for any real product) plus 3 test-only bugs (an invalid 37-char UUID from an unguarded `Date.now()` pad, a checkbox locator that should target `button[role="checkbox"]`, and two submit-button strict-mode violations needing `.first()`, all matching established patterns already used elsewhere in the repo).
- Fixed all four, rebuilt packages, restarted the dev server, reran the suite: 12/12 pass, no retries.
- Re-ran the full gate a second time: full monorepo typecheck (38/38), i18n checks (both pass), full test suite standalone-verified across shared/core/ui/app/cli (one pre-existing, branch-unrelated failure in `catalog/products/[id]` tests — a stale jest mock of `useLocale`, in files this branch never touched), `build:app` green.
- Both Phase 1 and Phase 2 remain fully complete; the live QA pass is what actually proves the Phase 1 gate ("a storefront-shaped consumer gets coherent states") and the Phase 2 gate (R1/R4 + hand-computed multi-location states) end-to-end, not just in unit-test mocks. Proceeding to PR finalize.
