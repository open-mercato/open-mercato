# Sudo configuration optimistic locking

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md`
**Related:** `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md`, `.ai/specs/enterprise/2026-10-22-sudo-config-section-adoption.md`

## TLDR

Close the existing sudo-configuration stale-write gap as an independently deployable data-integrity change. Carry `updatedAt` through the edit UI, enforce one command-bound version check while holding the target row lock through update/delete commit, preserve legacy callers that omit a token, and return the standard conflict contract. The section-adoption spec consumes this finished contract rather than implementing locking itself.

## Overview

`SudoChallengeConfig.updated_at` and read-response `updatedAt` already exist. The custom UI currently drops the value, and the custom update/delete commands do not call the DI-overridable optimistic-lock guard. This spec wires that existing version into the current legacy routes and commands without adding a column or changing sudo policy.

## Problem Statement

Two admins can load one rule and silently overwrite or delete each other's change. Locking in both a route and command would create a time-of-check/time-of-use gap, while requiring a header from all legacy API callers would break an established additive contract.

## Goals and Non-goals

### Goals

- Preserve `updatedAt` in `SudoConfigCrudPage` and use the record's own token for update/delete.
- Make the command side-effect boundary the single authoritative lock check.
- Preserve headerless legacy calls while allowing exact conflict detection when a token is supplied.
- Pin default/on/off/allow-list behavior and exact success/conflict responses.

### Non-goals

- Section overrides, policy façades, header composition, or form topology.
- A migration, new version field, cross-record lock, or bulk-write protocol.
- Changing sudo challenge or tenant/organization authorization.

## Proposed Solution

Add `updatedAt` to `SudoConfigFormValues`, load it from `GET /api/security/sudo/configs/:id`, and let `CrudForm` derive the update/delete expected-version header. Extend update/delete command inputs with an optional normalized `expectedUpdatedAt`, populated from the request header by each route adapter.

After route authentication, feature, scope, sudo, and schema gates, the command performs a scope-only existence/authorization read to preserve the established non-enumerating 404, then enters `em.transactional`. Using the transaction entity manager, it reloads the same scoped row with `LockMode.PESSIMISTIC_WRITE` and `refresh: true`; that lock remains held until commit. A missing locked row after the authorized read uses `enforceRecordGoneIsConflict` when an expected token was supplied, while an initially missing/out-of-scope record remains 404. The command calls `enforceCommandOptimisticLockWithGuards` exactly once against the locked row, mutates and flushes through the same transaction manager, and returns the post-flush version. No reload, side transaction, or flush may occur between compare and commit. Gate-off/headerless calls still take the row lock but the version guard no-ops, preserving operator-selected last-write behavior without a check/write race. The guard uses `resourceKind: 'security.sudo_config'`, record id, locked current row, explicit expected value, and request context. A later section adopter performs active-leaf merge and complete-state validation against this same locked row before the guard. The route never performs a version pre-check.

The transaction returns the event payload; `security.sudo.config.updated|deleted` is emitted only after `em.transactional` resolves, so a flush/commit failure produces no event. Event-publication failure does not roll back the committed database mutation and follows the existing command error path; this spec does not introduce an outbox.

Update returns the post-flush version so a second save can refresh form state. Delete has no surviving version. `surfaceRecordConflict` handles both update and delete before generic flash conversion.

## Architecture

| Area | Change |
|---|---|
| `components/SudoConfigForm.tsx` | Add optional `updatedAt` form value without including it in the domain payload |
| `components/SudoConfigCrudPage.tsx` | Retain loaded/refreshed version and surface standard conflicts |
| legacy sudo config routes | Parse optional expected header and pass it to commands; no route-side compare |
| `commands/updateSudoConfig.ts` / `deleteSudoConfig.ts` and service seam | Scoped preauthorization, transaction-held row lock, single DI-aware check, same-manager flush, post-commit event |
| tests | Route/command/UI default/off/allow-list, stale, gone, and successive-save matrix |

## Data Models

No migration. `SudoChallengeConfig.updated_at` remains the canonical token.

## API Contracts

The standard header and `optimistic_lock_conflict` response remain exactly those in the OSS locking specification. Success contracts are:

| Route | Header absent | Header current | Success |
|---|---|---|---|
| legacy `POST /api/security/sudo/configs` | not applicable | forbidden/no prior record | `201 { id }` unchanged |
| legacy `PUT /api/security/sudo/configs/:id` | accepted for compatibility | checked when gate enabled | `200 { ok: true, updatedAt }`; added field is backward compatible |
| legacy `DELETE /api/security/sudo/configs/:id` | accepted for compatibility | checked when gate enabled | `200 { ok: true }` unchanged |

| `OM_OPTIMISTIC_LOCK` mode | Supplied expected token |
|---|---|
| unset/default-on | enforce for `security.sudo_config` |
| `on` | enforce |
| `off` | parse/pass but guard is a no-op |
| allow-list excluding resource kind | parse/pass but guard is a no-op |
| allow-list including resource kind | enforce |

A malformed supplied token returns the shared validation error. A stale token or scoped record deleted after authorization returns the exact standard 409. Missing headers remain additive no-ops only on the legacy routes; a later adopter may require a token on its new façade without altering this compatibility contract.

The legacy routes retain their existing auth/feature `metadata`, strict params/body validation, and `openApi`; the implementation updates the PUT success schema to include required ISO `updatedAt` and documents the standard `409 optimistic_lock_conflict` on PUT/DELETE. The shared optimistic-lock parser owns header bounds and malformed-token mapping; route code does not hand-parse the version.

## UI/UX

The edit form behaves as today until a conflict. On conflict it shows the unified record-conflict bar and does not first convert the response to a generic save/delete flash. Successful update replaces local `updatedAt` with the response value before any further save.

## Frontend Architecture Contract

- add no page-root client boundary, global-provider import, effect, subscription, or render-time request;
- keep `CrudForm` as the owner of update/delete version-header derivation from `initialValues.updatedAt`, and use existing `updateCrud`/`deleteCrud` plus `surfaceRecordConflict` rather than raw `fetch` or duplicate state;
- update local `updatedAt` only from the successful PUT result before the next mutation; overlapping requests retain their immutable per-request headers;
- preserve the no-conflict render tree and payload byte-for-byte for pinned fixtures; record `yarn check:client-boundaries` and the browser-chunk diff, which must show no new chunk/dependency;
- focused UI tests cover Strict Mode, two successive saves, overlapping update/delete, and conflict precedence over generic flashes.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Create carries expected token | Reject locally; no prior record exists |
| Stale update/delete | Standard 409; no write, audit, or event |
| Record removed after scoped load | Record-gone conflict for authorized expected-token request |
| Initially absent/out of scope | Existing non-enumerating 404 |
| Two successive saves | First response refreshes token; second succeeds |
| Gate off/excluded | Existing last-write behavior, explicitly operator-selected |
| Command called outside HTTP | Explicit expected input is authoritative; absent value preserves additive behavior |
| Two contenders pass the initial scoped read | First holds the row through commit; second reloads the committed version and conflicts before write |
| Flush/commit fails | Transaction rolls back; no success event or audit entry |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Check/write race permits a stale overwrite | High | Pessimistic-write lock held from authoritative reload through same-transaction commit | Database/driver lock semantics require integration coverage |
| Legacy integration breaks | High | Missing legacy header remains accepted | Headerless callers retain stale-write risk |
| Scope leaks through conflict | Critical | Scope/authorization before guard; non-enumerating initial miss | None accepted |
| Version not refreshed | High | Exact update response and successive-save test | None accepted |

Operational rollback may stop UI token emission while the additive command input, response field, and published conflict behavior remain compatible. Removing the data-integrity contract after publication requires the repository deprecation process.

## Migration & Backward Compatibility

No database migration. Legacy request bodies, required headers, and delete/create responses are unchanged. `updatedAt` is additive on update success, and headerless legacy writes remain supported. New command inputs and response fields become stable after publication.

## Phasing and Implementation Plan

1. Carry `updatedAt` through form initial state and update response handling.
2. Add optional expected input and a transactional service/command seam that performs scoped preauthorization, reloads with `PESSIMISTIC_WRITE`, runs one DI-aware guard, and flushes through the same entity manager; emit the event only after commit.
3. Wire legacy routes to parse/pass the standard header and preserve missing-header compatibility.
4. Add command, route, and UI tests for the exact matrix and side-effect suppression.
5. Run focused enterprise security tests, `yarn workspace @open-mercato/enterprise build`, `yarn typecheck`, `git diff --check`, and configured validation with recorded evidence.

## Integration Coverage

- legacy missing/current/stale/malformed update and delete headers;
- default/on/off/include/exclude guard modes;
- initially missing/out-of-scope versus deleted-after-authorization responses;
- barrier-controlled two-contender update/update and update/delete tests proving the second writer cannot pass the guard on a pre-lock snapshot;
- flush/commit failure rollback and post-commit event ordering;
- no audit or `security.sudo.config.updated|deleted` event on conflict;
- two successive UI saves and stale update/delete conflict bar.

## Acceptance Criteria

1. The loaded config's own `updatedAt` protects update and delete without entering the domain body.
2. Exactly one command-bound guard checks the transaction-locked row, and the lock is held through same-manager flush/commit with no write preceding the guard.
3. Legacy headerless callers retain established behavior; supplied stale tokens receive exact standard 409.
4. Update success returns/refreshed `updatedAt`; delete success remains `{ ok: true }`.
5. Focused unit/integration/UI and named validation gates pass.
6. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/enterprise/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root optimistic-lock rule | Use the record's `updatedAt`, DI-aware command guard, exact 409, kill switch, and conflict UI | Compliant | Update/delete matrix covers default/on/off/allow-list and successive saves |
| root data/security rules | Scope before disclosing conflicts and prevent check/write races | Compliant | Scope-only preauthorization preserves 404; a refreshed `PESSIMISTIC_WRITE` row is guarded and held through commit |
| root event rule | Preserve events and define their transaction boundary | Compliant | Event payload returns from the transaction and emits only after commit; post-commit failure is explicit |
| `packages/core/AGENTS.md` → API Routes | Keep route metadata/OpenAPI synchronized with validated request/response/error contracts | Compliant | Existing route docs are retained and gain the additive PUT version plus standard 409 |
| `.ai/specs/AGENTS.md` | One independently deployable capability with integration coverage | Compliant | Locking is split from section adoption and includes command/route/UI/barrier tests |
| `BACKWARD_COMPATIBILITY.md` | Keep missing-header legacy calls additive | Compliant | Headerless legacy behavior stays; success `updatedAt` is additive |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Existing `updated_at` is canonical; no migration |
| API contracts match UI/UX section | Pass | Update refreshes local version; update/delete conflicts reach the unified bar |
| Risks cover all write operations | Pass | Update/delete contention, gone records, gate-off behavior, commit, and event failures are covered |
| Commands defined for all mutations | Pass | Update/delete command/service seam owns the only version guard and locked write |
| Cache strategy covers all read APIs | N/A | No cache change |
| Frontend architecture contract is measurable | Pass | Boundary, request, state, Strict Mode, fixture, and chunk gates are explicit |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

- **2026-10-27:** Replaced check-then-flush with a transaction-held pessimistic row lock through commit, pinned route docs and post-commit event semantics, added a measurable frontend contract and contender tests, and completed the compliance report.
- **2026-10-22:** Extracted sudo-config optimistic locking from section adoption and pinned command authority, route compatibility, gate modes, responses, conflicts, and core-team-only ownership.
