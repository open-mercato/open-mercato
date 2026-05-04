# Pre-Implementation Analysis: CRM Post-Upgrade Bug Fixes — Batch 2

**Spec under review:** [.ai/specs/2026-04-27-crm-post-upgrade-fixes-batch-2.md](../2026-04-27-crm-post-upgrade-fixes-batch-2.md)
**Analysis date:** 2026-04-27
**Analyst:** pre-implement-spec skill (Claude)
**Verdict:** ✅ **All 3 Critical blockers RESOLVED in spec on 2026-04-27. Ready to implement; 6 Important gaps reduced to follow-ups documented inline.**

> **Update (2026-04-27):** All three Critical blockers below have been closed via direct spec edits — see the spec's [Changelog](../2026-04-27-crm-post-upgrade-fixes-batch-2.md#changelog) entry dated 2026-04-27. Remaining Important / Nice-to-have items are non-blocking and tracked here for the implementing agent.

---

## Executive Summary

The spec is high-quality, structurally complete, and overwhelmingly additive from a backward-compatibility standpoint. All six phases sit on top of confirmed root causes — code verification matched the spec's file/line references in 22 of 25 spot checks. The reference module (customers) is the right host, the proposed BC verdicts are sound, and the test plan is one-to-one with the manual scenarios.

**Three findings block clean implementation if not resolved first:**
1. **Phase 3** — the event ID `customers.personCompanyLink.deleted` does **not exist** in `events.ts`. The spec's "verify it exists" branch must become an authoritative "what is the actual emitted event ID, declare it, and subscribe to that exact ID." This is the load-bearing pivot of Phase 3.
2. **Phase 2** — the spec name-checks both `createCrudFormError` and `raiseCrudError` interchangeably; only `createCrudFormError` (UI package) is confirmed. Importing UI helpers from a server-side command is a layering violation. The spec must pick the actual server-side helper or document a new one.
3. **Phase 6** — the spec claims `customers.companies.detail.primary` "already exists" in locales; grep confirms it does **not**. The phase needs to add it across en/pl/es/de.

The remaining six Important gaps are all about pinning down details the spec leaves with hedge-language ("if not, add it", "or the equivalent helper", "audit other usages") so the implementer doesn't have to make policy calls mid-PR.

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | BC #5 (Event IDs) | Phase 3 references event ID `customers.personCompanyLink.deleted` and proposes "verify it has `clientBroadcast: true`. If not, add the flag." Code search shows no such event ID exists in `customers/events.ts`. The actual emit chain runs through `emitCrudSideEffects` with `entityType: 'customers:customer_person_company_link'`, which probably resolves to a different ID format (likely `customers.customer_person_company_link.deleted` derived from the entity type). | **Critical** | Read the actual emitted event ID at runtime, declare it explicitly in `customers/events.ts`, then subscribe to that **exact** ID. Adding a new declared event ID is BC-additive (per BC #5 "MAY add new event IDs freely"). Document the resolved ID in the spec before implementation. |
| 2 | BC #4 (Import paths) — server-side cross-package import | Phase 2 Step 2 imports `createCrudFormError` from `@open-mercato/ui/backend/utils/serverErrors` into a server-side command (`packages/core/src/modules/customers/commands/companies.ts`). UI → core import is a layering inversion. | **Warning** | Either (a) move the helper to `@open-mercato/shared/lib/crud` (additive — preserves the UI re-export) or (b) use the already-existing `CrudHttpError` pattern visible in `personCompanyLinks.ts:529` (`throw new CrudHttpError(404, ...)`) for the 422. Confirm which is canonical before implementation. |

All other 13 BC surfaces are clean (additive or no-op). The spec's own "Migration & Backward Compatibility" table is accurate where it doesn't depend on the two findings above.

### Missing BC Section

**None.** The spec includes a "Migration & Backward Compatibility" section that walks all relevant surfaces with verdicts. This is one of the spec's strengths.

---

## Spec Completeness

### Missing Sections

None of the required sections are missing. TLDR, Problem Statement, Resolved Decisions, Bug Inventory & Verified Root Causes, Implementation Phases, Migration & BC, Risks, Final Compliance Report, Implementation Status, and Changelog are all present.

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Phase 1 — Scope | Spec only enumerates `CrudForm.tsx` + `CollapsibleGroup.tsx` + new file. Doesn't list **all consumers** of `SortableGroupItem` / sortable form groups across modules (customers, sales, auth, etc.) that will see the behavior change. | Add a "Consumer inventory" subsection: grep for `SortableGroupItem`, `sortable: true` form-group flag, etc., and list affected modules so QA can plan regression coverage. |
| Phase 2 — Step 4 (defensive transaction) | "running counts again with `withAtomicFlush` (`{ transaction: true }`) so race conditions ... don't slip through" — the actual `withAtomicFlush` API is for write phases, not for re-counting inside a read transaction. Pattern needs validation against the [SPEC-018](../implemented/SPEC-018-2026-02-05-safe-entity-flush.md) helper. | Either replace with an explicit `em.transactional(async em => { recount; throw if > 0; cascade; remove })`, or remove the belt-and-braces and accept the very narrow race window (counts → throw → cascade → flush is already protected by the FK constraint as a final safety net, which would just re-surface the original 500 — but only on millisecond-timing). |
| Phase 3 — Subscriber payload filter | `useAppEvent('customers.personCompanyLink.deleted', () => loadVisiblePeople())` will refetch on **every** unlink across the entire tenant, not just unlinks affecting the current company. Wasteful at scale. | Subscriber must filter on the broadcast payload (`personId`, `companyId`) and only refetch when the deleted link's `companyId` matches the page's company (and the equivalent for the Person side). Spec must enumerate the payload shape and add a filter clause. |
| Phase 3 — `useGuardedMutation` integration | Spec says "wrap the write in `useGuardedMutation(...).runMutation(...)` per the UI rule" but doesn't reference the **page-level** mutation runner. Per the lesson at `.ai/lessons.md:575-583`, detail sections must route writes through page-level guarded mutations injected via context — not section-local `useGuardedMutation` instances. | Add explicit step: receive `runGuardedMutation` from page-level injection context (mirroring the pattern already used by other customer detail sections); do not instantiate `useGuardedMutation` locally inside `PersonCompaniesSection`. |
| Phase 4 — `loadPersonProfileSnapshot` helper | Server-derivation step uses `await loadPersonProfileSnapshot(em, id)` — unverified whether this helper exists with that signature. | Verify whether `loadPersonProfileSnapshot` is already exported from `commands/people.ts` (analogous helpers exist in `personCompanyLinks.ts`). If not, either reuse `findOneWithDecryption` or add a small private snapshot loader and enumerate it in the step list. |
| Phase 5 — "Other sections" enumeration | "Mirror this for any other section that uses `onActionChange` and expects persistence (Activities, Notes, Deals, Roles)" — open-ended. | Run `grep -rn 'onActionChange' packages/core/src/modules/customers/` and list the exact files in scope. The handler change is one-line per page but the regression risk is real if one is missed. |
| Phase 5 — Race-condition fix robustness | `setTasksSectionAction((prev) => action !== null ? action : prev)` papers over a React effect-cleanup race. If a future TasksSection refactor removes the `null` cleanup emission entirely, the parent will hold a stale action across unmount. | Either (a) document this as a known fragility with a follow-up to make `TasksSection` emit the action declaratively (props or render-prop) instead of via effect, or (b) add a unit test that validates the action is cleared **only** when the section actually unmounts (not on intra-render cleanup). |
| Phase 6 — Boy-Scout sweep target list | "Audit other CRM 'primary marker' usages" without enumeration. | Grep the customers detail tree for `<Badge variant="default">.*[Pp]rimary` and `'PRIMARY'` literals; list the exact files Boy-Scout will touch in this PR so reviewers can validate scope. Otherwise scope creep is unbounded. |

---

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| `customers/AGENTS.md` MUST #6 — *"MUST use `useGuardedMutation` for non-`CrudForm` backend writes (`POST`/`PUT`/`PATCH`/`DELETE`) and pass `retryLastMutation` in injection context"* | Phase 3 unlink action wiring | Spec mentions `useGuardedMutation` but not `retryLastMutation`. Must thread `retryLastMutation` through the same injection context the rest of the customer detail page uses. |
| `packages/core/AGENTS.md` — *"For custom write routes that do not use `makeCrudRoute` ... MUST wire the mutation guard contract: call `validateCrudMutationGuard` before mutation logic; call `runCrudMutationGuardAfterSuccess` after successful mutation when requested"* | Phase 2 — `deleteCompanyCommand` uses the makeCrudRoute path, which is fine. But Phase 3's per-row unlink hits an existing route; verify that route already wires the guard contract. | Verify and link the guard wiring. No code change expected, but call it out in the spec to prove the route is already compliant. |
| Root `AGENTS.md` — *"Agents MUST automatically run `yarn mercato configs cache structural --all-tenants` after enabling/disabling modules in `src/modules.ts`, adding/removing backend or frontend pages, or changing sidebar/navigation injection"* | Spec touches no nav/sidebar/module enablement. | No action — flagged here only to confirm the cache directive does **not** apply to this spec. |
| Root `AGENTS.md` Code Quality — *"Don't add docstrings/comments/type annotations to code you didn't change"* | Phase 1 inline code samples include TS comments like `// Note: the wrapper no longer carries any DOM event listeners`. | The comment is in the **spec** (acceptable). Just ensure it doesn't get pasted into the implementation as a code comment per the no-comment rule. |
| `customers/AGENTS.md` — *"MUST capture custom field snapshots in command `before`/`after` payloads for undo support"* | Phase 4 modifies `updatePersonCommand` patch path. | Confirm the new server-side derivation runs **before** the snapshot capture so audit/undo records the post-derivation `displayName`. Spec says "before the existing field-update loop" — this is correct, but the test plan should add a unit case asserting that the audit log captures the derived name. |

### Compliant Areas (no action)

- Reference module pattern (customers as template) — used. ✓
- Singularity Law (singular naming) — passes. ✓
- Tenant scoping in Phase 2 counts (`organizationId` + `tenantId`) — explicitly called out. ✓
- Soft-delete cascade preserved in Phase 2. ✓
- Design system tokens (StatusBadge, semantic tokens, no `bg-primary` hardcode) in Phase 6. ✓
- Confirm dialog (`useConfirmDialog`, not `window.confirm`) in Phase 3. ✓
- `apiCallOrThrow` (not raw fetch) in Phase 3. ✓
- `flash` for toasts. ✓
- Integration tests one-per-phase (TC-CRM-049 → TC-CRM-060). ✓
- Self-contained test fixtures. ✓
- i18n keys planned, no hardcoded user-facing strings (with the Phase 6 caveat above). ✓

---

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Phase 3 event-ID assumption is wrong | Cross-side refetch never fires; bug ships "fixed" on the originating side, broken on the cross side. Worst case: belt-and-braces fallback hides the failure in dev, regresses in prod. | Resolve the actual event ID **before** writing the subscriber. Add a unit test that asserts the Phase 3 subscriber and the Phase 3 emitter use the same string literal. |
| Phase 2 server-side error-helper choice (UI vs shared vs `CrudHttpError`) | Layering inversion if the wrong helper is imported; or reinventing a 422 envelope inconsistent with the rest of the customers commands (which use `CrudHttpError`). | Survey existing customer commands for the canonical 422-throwing pattern (`personCompanyLinks.ts:529` uses `CrudHttpError(404, ...)`). Use the same style for 422. Decide before implementation. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Phase 1 drag-grip behavior change affects all sortable form-group consumers, not just CRM | Users in sales / auth / catalog form pages will lose card-grab affordance with no warning if the consumer inventory is incomplete. | Inventory all `SortableGroupItem` consumers; explicitly call them out in RELEASE_NOTES.md; expand visual QA scope beyond Person/Company/Deal pages. |
| Phase 3 `useAppEvent` over-refetching (any unlink → all open detail pages refetch) | Performance and UX flicker on busy tenants. | Add payload-based filter clause to subscriber (only refetch when `personId` or `companyId` matches the current page). |
| Phase 4 sticky-manual heuristic false-positive on identity name (user typed "John Doe" exactly matching derivation) | If user later edits first name, "their" customization gets clobbered without warning. | Spec already classifies this as Low UX risk and notes recoverability via Object History. Document in RELEASE_NOTES.md as known limitation. Optionally add a one-line UI hint near the display-name field ("auto-updates from First/Last unless customized"). |
| Phase 5 cleanup-race fix is fragile | Future React/library changes that alter cleanup timing could re-introduce the bug silently. | Add a unit test that simulates rapid `null → action → null → action` sequences and asserts persistence. Pin the test to the public `onActionChange` contract, not internal effect ordering. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Phase 2 information leak via dependent count (count of linked persons/deals revealed in 422) | Already addressed in spec: counts are not PII, and the user has `customers.companies.delete` to reach the path. | None additional. |
| Phase 6 visual regression perception (lime → semantic info color) | Pixel-watchers may file a "regression" ticket. | Spec already plans before/after screenshots and RELEASE_NOTES entry. Sufficient. |
| Phase 1 KeyboardSensor "active-element guard" double-defense | Belt-and-braces is fine but adds a guard that future React versions may render moot. | Document as belt-and-braces with the primary fix being `setActivatorNodeRef`. |

---

## Gap Analysis

### Critical Gaps (Block Implementation) — RESOLVED 2026-04-27

- ~~**Phase 3 — Resolve the actual emitted event ID.**~~ ✅ Resolved. Actual ID is `customers.person_company_link.deleted` (snake_case, per `engine.ts:533`). Already declared in `events.ts:78-80`; spec Phase 3 Step 1 adds `clientBroadcast: true` (additive metadata). Subscribers now filter on `payload.companyEntityId` / `payload.personEntityId`.
- ~~**Phase 6 — Confirm and add the locale key.**~~ ✅ Resolved. Existing key `customers.people.detail.companies.primaryBadge` (en/pl/es/de) reused — no new key needed. Boy-Scout sweep enumerated: `CompanyCard.tsx:238-242` is the only offender.
- ~~**Phase 2 — Disambiguate the server error helper.**~~ ✅ Resolved. Spec now uses `CrudHttpError(422, { error, code: 'COMPANY_HAS_DEPENDENTS' })` from `@open-mercato/shared/lib/crud/errors` (matches `personCompanyLinks.ts:529` precedent). Step 4 race-protection switched from `withAtomicFlush` to `em.transactional()` (correct primitive).

### Important Gaps (Should Address Before / During Implementation)

- **Phase 1** — Add full consumer inventory of sortable form groups (grep `SortableGroupItem` and any `sortable` form-group flag) so RELEASE_NOTES and QA scope are complete.
- **Phase 2 Step 4** — Replace `withAtomicFlush({ transaction: true })` re-count with `em.transactional()` or remove the belt-and-braces re-check (the FK constraint and the precount provide adequate guarantees against the race in practice).
- **Phase 3** — Specify subscriber payload filter (refetch only when `companyId` / `personId` match the current page).
- **Phase 3** — Use page-level `runGuardedMutation` injection per the lesson at `.ai/lessons.md:575-583`; do not instantiate `useGuardedMutation` inside `PersonCompaniesSection`.
- **Phase 4** — Verify or define `loadPersonProfileSnapshot(em, id)`; if it doesn't exist, list the new helper in the step plan.
- **Phase 5** — Enumerate the "other sections" (Activities/Notes/Deals/Roles) by exact file path so the parent-side null-ignore fix is applied uniformly.
- **Phase 6** — Enumerate Boy-Scout sweep targets explicitly.

### Nice-to-Have Gaps

- **Phase 1** — Add an SSR-stability check for the new sortable handle (cross-reference with the lesson at `.ai/lessons.md:724-732` about deterministic dnd-kit IDs).
- **Phase 3** — Add a test that asserts the broadcast event payload contains `personId` and `companyId` so future subscribers can filter without contract drift.
- **Phase 4** — Consider a translation hook for non-Western name-ordering (East Asian "Last First" convention). Not in scope, but worth a note for future i18n epics.
- **Phase 4** — Add an audit-log assertion that the post-derivation `displayName` is captured in the snapshot pair (the existing audit-log lesson at `.ai/lessons.md:21-29` warns about identity-map staleness).
- **Phase 1** — Add coverage for textarea / contenteditable inputs (not just `<input>`) in the keyboard-activation guard; users can paste/edit multiline notes inside a sortable group.

---

## Remediation Plan

### Before Implementation (Must Do)

1. **Resolve Phase 3 event ID.** Read `personCompanyLinkCrudEvents` definition (path: `packages/core/src/modules/customers/commands/personCompanyLinks.ts:493` references it). Find its declared IDs in `events.ts` or in a colocated CRUD-events helper. Update the spec to name the exact ID literal (e.g., `customers.customer_person_company_link.deleted`). Confirm or add `clientBroadcast: true` on its `EventDefinition`.
2. **Pick the Phase 2 422 helper.** Inspect `personCompanyLinks.ts:529` (`throw new CrudHttpError(404, { error: '...' })`) and either reuse `CrudHttpError(422, { error, code: 'COMPANY_HAS_DEPENDENTS' })` or extract the helper into shared. Update the spec text and Step 2 code sample.
3. **Commit Phase 6 to adding the locale key.** Change "check; otherwise add" to "add" in en/pl/es/de. List the four diff lines.

### During Implementation (Add to Spec or Track in PR)

1. Add the `SortableGroupItem` consumer inventory under Phase 1 scope, and add each consumer to the QA matrix.
2. Add the subscriber payload-filter clause under Phase 3 (`(payload) => payload.companyId === currentCompanyId`).
3. Use page-level `runGuardedMutation` for Phase 3 unlinks; do not introduce a section-local guard.
4. Verify `loadPersonProfileSnapshot` exists or define a snapshot reader for Phase 4.
5. Replace Phase 2 Step 4's `withAtomicFlush` re-count with `em.transactional()` or drop it.
6. Enumerate Phase 5 "other sections" in the spec scope.
7. Enumerate Phase 6 Boy-Scout targets in the spec scope.

### Post-Implementation (Follow Up)

1. After Phase 1 lands, watch for QA tickets about "card-grab no longer works" and proactively respond with the RELEASE_NOTES link.
2. After Phase 3 lands, add a metrics counter (or log line) for the cross-side refetch event so we can validate the SSE bridge is delivering as expected in production. This addresses the residual risk noted in the spec's own Risk table.
3. After Phase 4 lands, monitor CRM-V1 fallback API consumers for any errors related to the new server-side fallback derivation; the spec calls this out as a Behavior change requiring RELEASE_NOTES.
4. Move spec to `.ai/specs/implemented/` once all six phases are signed off, and update cross-references per `.ai/specs/AGENTS.md`.

---

## Recommendation

**✅ READY TO IMPLEMENT (as of 2026-04-27).** All 3 Critical blockers are closed in the spec. Important gaps remain documented but are non-blocking — the implementing agent can address them inline as they touch each phase.

The spec's structure, BC discipline, test plan, and integration with the predecessor batch are all strong. The original blockers were localized to: (1) one un-verified event ID assumption, (2) one ambiguous helper import, and (3) one stale locale-key claim. All three have been closed with code-grounded fixes — see the spec's [Changelog](../2026-04-27-crm-post-upgrade-fixes-batch-2.md#changelog) for detail.

Recommended sequencing once unblocked:
1. **Phase 1** first (drag stability) — broad blast radius, deserves the freshest review attention.
2. **Phase 2** — independent of others, fixes a 500.
3. **Phase 4** — independent.
4. **Phase 3** — depends on event-ID resolution; ship after that's pinned down.
5. **Phase 5** — depends on no other phases.
6. **Phase 6** — paint job; ship last.

Each phase remains independently releasable per the spec's design.
