## 🤖 `auto-continue-pr` — resume summary (Phase 15: QA #2055 CRM + sales delete/update coverage)

**Tracking plan:** `.ai/runs/2026-05-25-oss-optimistic-locking/PLAN.md`
**Run folder:** `.ai/runs/2026-05-25-oss-optimistic-locking/`
**Branch:** `feat/oss-optimistic-locking`
**Resume point:** post-`complete` (head `99c9f851c`) → Phase 15 steps 15.1..15.5 + checkpoint 4
**Final status:** implementation complete — **awaiting re-QA** (see "How to verify"). The original 14-phase feature stays `complete`; this resume adds the QA-fix increment for @alinadivante's report. Pipeline moved `review` → `qa`.

### Code-review verdict

Independent code-review of the Phase 15 diff (`99c9f851c..HEAD`) + self-review: **0 critical / 0 high / 0 medium**. Two non-actionable Lows: (1) the shared scoped-header stack is module-level (not `AsyncLocalStorage`) — pre-existing infra, nil risk for these sequential user flows; (2) companies-v2 reads `updatedAt` via an `as`-cast — mirrors the existing `optimisticLockUpdatedAt` prop usage in the same file, degrades gracefully. Reviewer confirmed: header wiring correct for update+delete, scope timing correct (header is live when `apiCall` fires), channel 409 detection correct, unit tests genuinely prove the header is sent (not false positives), no BC/tenant regressions.

### Context — @alinadivante's QA findings, and what was already fixed

Her 2026-05-27 QA flagged: (1) raw `record_modified` flash, (2) same-user-two-tabs company silently overwrote, (3) people-v2 / (4) deals / (5) catalog products / (6) sales.orders unprotected, (7) sales channel edit/delete broken state.

A prior session already (a) fixed the flash → `ui.forms.flash.recordModified` with a human fallback in both `CrudForm` and `useGuardedMutation`, and (b) wired the `optimisticLockUpdatedAt` prop into the CrudForm **update** paths (company-v2, people-v2, catalog products). Issue **#1 (same-user-two-tabs)** is the enterprise *pessimistic* record-lock behavior (the same user owns the lock in both tabs); the OSS *version-compare* guard is per-record-version, so once company-v2 sends the header (already wired), the second tab now 409s.

### Summary of changes in this resume

The remaining real gaps were **custom (non-`CrudForm`) handlers** that issued `updateCrud`/`deleteCrud` without the expected-`updated_at` header, so the guard skipped:

- **Deals** (`useDealFormHandlers.ts`) — update **and** delete now wrap the mutation in `withScopedApiRequestHeaders(buildOptimisticLockHeader(deal.updatedAt), …)`. (`8c35339d5`)
- **company-v2 + people-v2** custom **delete** handlers — same wrapping. Update was already protected via the CrudForm prop. (`49f25480b`)
- **sales channels list delete** — same wrapping; on 409 it surfaces the localized conflict flash and refreshes the list (fixes the stale/"deleted row still shows" broken state). (`32fb756f8`)
- **TC-LOCK-OSS-004** integration spec extended with stale-DELETE→409, fresh-DELETE-succeeds, and header-less-DELETE-still-works cases. (`ed4efbdd0`)
- **Coverage-completion spec** gained an implementation-status table marking these done and `sales.order` document command endpoints + nested panels as deferred (Phases 3–4). (`5c9ceeeb0`)

Net: the **CRM (deal/company/person) and the sales channel single-record edit/delete UI paths now opt into optimistic locking on both update and delete.**

### Verification phases completed (this resume)

- **Checkpoint 4** (`checkpoint-4-checks.md`): build:packages ✓, generate ✓, i18n:check-sync ✓ (4 locales, no new keys), touched core unit tests **9/9** ✓ (deal-handler header test + company/people delete-header page tests), root TS 6.0.3 typecheck ✓.
- **Env-only failures (pre-existing, not this change):** `yarn workspace @open-mercato/core typecheck` trips `TS5103 ignoreDeprecations` (workspace TS 5.9.3 vs tsconfig `"6.0"`); lint crashes in `eslint-plugin-react` version detection. CI runs both in a clean env.
- **Playwright / integration:** could not run locally (no Postgres/Redis/.env in the sandbox). DELETE enforcement is proven by **TC-LOCK-OSS-004** in CI `ephemeral-integration` (`OM_OPTIMISTIC_LOCK=all`). The `makeCrudRoute` delete-guard path (`factory.ts` `runMutationGuards` with `operation:'delete'`) is entity-agnostic, so proving `customers.deal` proves `customers.company`/`customers.person`/`sales.channel` (all use the Phase-13 auto-registered generic reader).
- **Self code-review + independent code-review subagent** on diff `99c9f851c..HEAD` — findings below.
- **BC:** strictly additive — no contract surface touched (no new/changed routes, events, DI names, ACL features, exports, or migrations). The header is opt-in: a record without `updatedAt` → `buildOptimisticLockHeader` returns `{}` → no header → guard skips (unchanged behavior).

### How to verify (re-QA)

1. With no `OM_OPTIMISTIC_LOCK` set (default ON), open two tabs on a **deal** (`/backend/customers/deals/<id>`). Save in tab A, then save in tab B → tab B gets the localized "This record was modified by someone else…" flash.
2. Repeat for **company-v2**, **people-v2** edit, and for **delete**: edit in tab A, delete in tab B → tab B is refused with the conflict flash.
3. **Sales channels list**: edit a channel in one tab; in another tab delete the same channel from the list after the edit → conflict flash + the list refreshes to the latest state.
4. Re-run: `NODE_ENV=test yarn workspace @open-mercato/core jest useDealFormHandlers.optimisticLock "companies-v2/[id]/__tests__/page" "people-v2/[id]/__tests__/page"` and the CI `ephemeral-integration` TC-LOCK-OSS-004 job.
- **Rollback:** `git revert 8c35339d5 49f25480b 32fb756f8 ed4efbdd0 5c9ceeeb0`, or set `OM_OPTIMISTIC_LOCK=off`.

### What can go wrong (risk analysis)

- **Most likely regression:** a record whose API response omits `updatedAt` → header is empty → guard skips (no 409). This is the intended backward-compatible degrade, not a break. The page tests assert the header IS sent when `updatedAt` is present.
- **Second-order:** double-flash if a caller also catches the 409 — only the channel handler adds its own flash and it `return`s first, so no double.
- **Tenant/isolation:** none — the guard reader projects only `updated_at` under the route's own tenant/org scope.
- **Deferred (NOT covered):** `sales.order` document editing (lines/adjustments/shipments/payments, status transitions) uses command endpoints, not `makeCrudRoute` PUT — needs command-level version checks (Phase 4). Nested panels (Phase 3). Tracked in `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md`.
