# Checkpoint 2 — Steps 9.1..11.1 verified (UI-touch window)

**Timestamp:** 2026-05-25T11:10Z
**Steps covered:** 9.1, 9.2, 10.1, 10.2, 11.1 (5 resumed steps)
**SHA range:** a3d13cc5b..4e4438ad6 (CrudForm prop wiring through page-level end-to-end wiring)

## Touched packages

- `packages/ui` — `CrudForm.tsx` (new `optimisticLockUpdatedAt` prop + 2 scoped-headers merge sites), `useGuardedMutation.ts` (default 409 flash on `optimistic_lock_conflict`)
- `packages/ui/src/backend/__tests__/CrudForm.optimisticLock.test.tsx` — 4 new UI unit tests (paired with 9.1)
- `packages/ui/src/backend/injection/__tests__/useGuardedMutation.optimisticLock.test.tsx` — 4 new UI unit tests (paired with 10.1)
- `packages/core/src/modules/customers/backend/customers/companies-v2/[id]/page.tsx` — passes `optimisticLockUpdatedAt={data?.company.updatedAt}` (UI page touched)
- `packages/core/src/modules/customers/backend/customers/companies-v2/[id]/__tests__/page.test.tsx` — extended CrudForm mock to capture props + 2 new test cases asserting the prop pass-through

## Validation results

| Check | Result | Notes |
|---|---|---|
| UI tests: CrudForm + useGuardedMutation + optimisticLock | **66/66 pass** (13 suites) | All existing CrudForm tests still pass after the new prop landed (no regression). |
| Shared optimistic-lock tests | **27/27 pass** | Re-run as sanity — store + factory + helpers unchanged this checkpoint. |
| companies-v2 page test (touched) | **4/4 pass** | Includes the 2 new optimisticLockUpdatedAt pass-through assertions. |
| `yarn i18n:check-sync` | **pass** | "All translation files are in sync." (no locale touches this checkpoint) |
| `tsc --noEmit` for `packages/ui` | **0 new errors** | Only pre-existing `#generated/entities.ids.generated` baseline (identical to develop). |

## UI verification

**Approach: unit tests pinned to the contract surface (paired with each UI commit per user directive).**

Three UI files were touched in this checkpoint window:

1. `CrudForm.tsx` — paired with `CrudForm.optimisticLock.test.tsx`. Mocks `withScopedApiRequestHeaders` and asserts:
   - prop set → wrapper called with `{ 'x-om-ext-optimistic_lock-expected-updated-at': '<iso>' }`
   - prop omitted / null / empty → wrapper NOT called
2. `useGuardedMutation.ts` — paired with `useGuardedMutation.optimisticLock.test.tsx`. Mocks `flash` and asserts:
   - 409 with `code: 'optimistic_lock_conflict'` → `flash('ui.forms.flash.recordModified', 'error')` fires
   - non-optimistic 409 / 422 / success → no flash
3. `companies-v2/[id]/page.tsx` — extended existing page test with a prop-capturing CrudForm mock. Asserts:
   - when API returns `data.company.updatedAt`, CrudForm receives `optimisticLockUpdatedAt` with the same value
   - when API omits `updatedAt`, CrudForm receives `undefined` (graceful fallback)

**Playwright smoke: skipped.** Dev server is not running in this worktree and the auto-continue-pr discipline forbids spinning one up in the resume. The three new integration tests (`TC-LOCK-OSS-001`, `-002`, `-003`) execute the API-level race in the ephemeral CI stack at the next CI run. The UI prop-pass-through is sufficiently pinned by the page test's `crudFormPropsCapture` assertion. Per the skill, **UI verification MUST NEVER block development** when the dev env isn't reachable.

## Notes / decisions

- The CrudForm prop is strictly additive — when omitted, all existing CrudForm submit/delete paths take the unchanged code branch (verified by 3 of the 4 new unit tests).
- `useGuardedMutation` now emits the default flash for optimistic-lock conflicts in *addition* to the existing `dispatchBackendMutationError` event. Callers that already render their own toast for 409 will see two flashes — acceptable per spec; documented in the spec's §3.6 implementation note.
- The companies-v2 page wires `data?.company.updatedAt` even though `CompanyOverview` doesn't model the field. The API actually returns it (`api/companies/[id]/route.ts:940`); the page reads via a typed cast at the call site to avoid threading a type-only change through the shared `CompanyOverview` definition. The page test covers both the happy path and the missing-updatedAt fallback.

## Artifacts

None. Unit tests + integration test specs (which run in CI) are sufficient evidence. No screenshots captured because the dev server isn't running in the resume worktree.

## Next step

Phase 5 final gate per skill step 5: full validation gate + `auto-review-pr` autofix pass + summary comment + PR status flip to `complete`.
