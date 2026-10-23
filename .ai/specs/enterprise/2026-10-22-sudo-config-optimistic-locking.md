# Sudo configuration optimistic locking

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md`
**Related:** `.ai/specs/enterprise/2026-10-22-sudo-config-section-adoption.md`

## TLDR

Close the existing sudo-configuration stale-write gap as an independently deployable data-integrity change. Carry `updatedAt` through the edit UI, enforce one command-bound version check for update/delete, preserve legacy callers that omit a token, and return the standard conflict contract. The section-adoption spec consumes this finished contract rather than implementing locking itself.

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
- A migration, new version field, pessimistic lock, or bulk-write protocol.
- Changing sudo challenge or tenant/organization authorization.

## Proposed Solution

Add `updatedAt` to `SudoConfigFormValues`, load it from `GET /api/security/sudo/configs/:id`, and let `CrudForm` derive the update/delete expected-version header. Extend update/delete command inputs with an optional normalized `expectedUpdatedAt`, populated from the request header by each route adapter.

After route authentication, feature, scope, sudo, and schema gates, the command transaction loads one authoritative scoped current row. A plain locking implementation calls `enforceCommandOptimisticLockWithGuards` against that row immediately before its first write. A later section adopter may perform pure active-leaf merge and complete-state validation against the same loaded row before the check, but must still run exactly one guard immediately before delegation/write and must not reload between compare and write. The guard uses `resourceKind: 'security.sudo_config'`, record id, scoped current row, explicit expected value, and request context. A scoped zero-row/reload after an expected token uses `enforceRecordGoneIsConflict`; an unauthorized or initially missing record retains the non-enumerating 404. The route never performs a competing pre-check.

Update returns the post-flush version so a second save can refresh form state. Delete has no surviving version. `surfaceRecordConflict` handles both update and delete before generic flash conversion.

## Architecture

| Area | Change |
|---|---|
| `components/SudoConfigForm.tsx` | Add optional `updatedAt` form value without including it in the domain payload |
| `components/SudoConfigCrudPage.tsx` | Retain loaded/refreshed version and surface standard conflicts |
| legacy sudo config routes | Parse optional expected header and pass it to commands; no route-side compare |
| `commands/updateSudoConfig.ts` / `deleteSudoConfig.ts` | Single DI-aware authoritative check at write boundary |
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

## UI/UX

The edit form behaves as today until a conflict. On conflict it shows the unified record-conflict bar and does not first convert the response to a generic save/delete flash. Successful update replaces local `updatedAt` with the response value before any further save.

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

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Duplicate checks create TOCTOU | High | Command-only authoritative check | Service must not write before command guard |
| Legacy integration breaks | High | Missing legacy header remains accepted | Headerless callers retain stale-write risk |
| Scope leaks through conflict | Critical | Scope/authorization before guard; non-enumerating initial miss | None accepted |
| Version not refreshed | High | Exact update response and successive-save test | None accepted |

Operational rollback may stop UI token emission while the additive command input, response field, and published conflict behavior remain compatible. Removing the data-integrity contract after publication requires the repository deprecation process.

## Migration & Backward Compatibility

No database migration. Legacy request bodies, required headers, and delete/create responses are unchanged. `updatedAt` is additive on update success, and headerless legacy writes remain supported. New command inputs and response fields become stable after publication.

## Phasing and Implementation Plan

1. Carry `updatedAt` through form initial state and update response handling.
2. Add optional expected input and one DI-aware guard to update/delete commands, including record-gone behavior.
3. Wire legacy routes to parse/pass the standard header and preserve missing-header compatibility.
4. Add command, route, and UI tests for the exact matrix and side-effect suppression.
5. Run focused enterprise security tests, `yarn workspace @open-mercato/enterprise build`, `yarn typecheck`, `git diff --check`, and configured validation with recorded evidence.

## Integration Coverage

- legacy missing/current/stale/malformed update and delete headers;
- default/on/off/include/exclude guard modes;
- initially missing/out-of-scope versus deleted-after-load responses;
- no audit or `security.sudo.config.updated|deleted` event on conflict;
- two successive UI saves and stale update/delete conflict bar.

## Acceptance Criteria

1. The loaded config's own `updatedAt` protects update and delete without entering the domain body.
2. Exactly one command-bound guard is authoritative and no write precedes it.
3. Legacy headerless callers retain established behavior; supplied stale tokens receive exact standard 409.
4. Update success returns/refreshed `updatedAt`; delete success remains `{ ok: true }`.
5. Focused unit/integration/UI and named validation gates pass.
6. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report

| Area | Status | Evidence required before implementation PR approval |
|---|---|---|
| Scope cohesion | Ready | One independently deployable sudo-config locking gap |
| Authority | Ready | One command-bound DI-aware check |
| Compatibility | Ready | Exact legacy route/mode matrix |
| Security | Ready | Non-enumerating scope and record-gone proof |
| Ownership | Ready | Core-team-only implementation and review |

## Changelog

- **2026-10-22:** Extracted sudo-config optimistic locking from section adoption and pinned command authority, route compatibility, gate modes, responses, conflicts, and core-team-only ownership.
