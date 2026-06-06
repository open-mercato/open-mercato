# CI 2425 Snapshot Follow-Up Stabilization

## Goal

Fix the Snapshot Release standalone failures observed on PR #2425/develop at root cause, then prove the affected paths and the full ephemeral integration suite are stable enough to unblock develop.

## Scope

- CRM advanced filter UX failures in `TC-CRM-059`, `TC-CRM-060`, and `TC-CRM-061`, where the expected active filter chips were absent after applying a status filter.
- Sales channel offer stale list-delete failure in `TC-LOCK-OSS-029` / SAL-13, where the browser flow timed out before proving the stale delete was refused.
- Local targeted validation for the changed code and affected integration specs.
- Two independent full ephemeral integration rounds with retries disabled when the targeted fixes are ready.
- A follow-up PR against `develop` with normalized labels and a CI handoff if remote checks are still running.

## Non-Goals

- No timeout-only fixes.
- No test deletion or allowlisting.
- No local database migrations.
- No behavior changes to sales document flow, CRM query semantics, public API route URLs, DataTable public props, or optimistic-lock response contracts.

## Evidence

- Snapshot Release push run `27055019655`, SHA `a3e2520ec0cd`, standalone app integration failure artifacts under `/tmp/open-mercato-gh-run-27055019655`.
- Snapshot Release PR run `27055020838`, SHA `a3e2520ec0cd`, retry evidence under `/tmp/open-mercato-gh-run-27055020838`.
- Current `origin/develop` at plan creation: `115785d8d7d6fb0d604070f7b3c2a2adcab54fe4`.

## Relevant References

- `.ai/specs/2026-05-10-crm-list-filter-redesign.md` - active filter chips are part of the CRM filter redesign and covered by `TC-CRM-059..061`.
- `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md` - custom single-record DataTable delete handlers must send the row version and surface conflict UI.
- `.ai/specs/2026-05-29-optimistic-locking-all-crudforms.md` - remaining custom-handler gap inventory explicitly includes sales channel offers.
- `packages/ui/AGENTS.md` and `packages/ui/src/backend/AGENTS.md` - backend writes outside `CrudForm` must use guarded/conflict-aware mutation patterns.

## Implementation Plan

### Phase 1: Root-Cause CRM Filter Chip Failures

1. Inspect the three failing CRM specs and current CRM list/filter components.
2. Restore the `data-testid="active-filter-chips"` surface for active CRM advanced filters without changing the v2 query contract.
3. Add or update focused tests for the chip rendering behavior.

### Phase 2: Root-Cause Sales Offer List-Delete Failure

1. Update the sales channel offers list delete path so stale deletes surface the unified record-conflict UI.
2. Make `TC-LOCK-OSS-029` deterministic around stale version capture and browser interaction, preserving product behavior coverage instead of depending on a fragile portalled menu race.
3. Add or update focused tests for the conflict-surfacing behavior.

### Phase 3: Validation

1. Run targeted unit tests for changed UI/core helpers.
2. Run targeted integration specs for `TC-CRM-059`, `TC-CRM-060`, `TC-CRM-061`, and `TC-LOCK-OSS-029` with retries disabled.
3. Run two independent full ephemeral integration rounds with retries disabled.
4. Run the relevant package/type/i18n/build checks required by the changed files.

### Phase 4: PR and CI

1. Open a PR against `develop` with `review`, `needs-qa`, and `bug` labels.
2. Post the required summary comment with verification, risk, manual QA, and rollback details.
3. Monitor PR and PR #2425/develop CI until the relevant GitHub checks are green or hand off any external blocker with exact run/job evidence.

## Risks

- Full ephemeral runs are long and may expose unrelated failures already queued on newer `develop` commits; unrelated failures will be root-caused and either fixed here if tightly coupled or split into a follow-up PR.
- CRM chip fixes touch shared advanced-filter UI surfaces; avoid changing public DataTable props or query serialization.
- Sales offer list-delete involves a custom DataTable row action. The fix must preserve optimistic-lock headers and not alter catalog offers API semantics.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Root-Cause CRM Filter Chip Failures

- [x] 1.1 Inspect CRM filter specs and components
- [x] 1.2 Restore active filter chip surface
- [x] 1.3 Add or update focused chip tests

### Phase 2: Root-Cause Sales Offer List-Delete Failure

- [x] 2.1 Surface stale delete conflicts in offers list
- [x] 2.2 Stabilize SAL-13 list-delete integration path
- [x] 2.3 Add or update focused sales conflict tests

### Phase 3: Validation

- [x] 3.1 Run targeted unit tests
- [x] 3.2 Run targeted integration specs with retries disabled
- [ ] 3.3 Run two independent full ephemeral integration rounds
- [x] 3.4 Run relevant package/type/i18n/build checks

### Phase 4: PR and CI

- [ ] 4.1 Open PR against develop
- [ ] 4.2 Apply labels and summary comment
- [ ] 4.3 Monitor GitHub CI to green or hand off exact blocker
