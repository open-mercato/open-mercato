# Catalog option-schema optimistic locking

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md`

## TLDR

Make `catalog.optionSchemas.update` and `catalog.optionSchemas.delete` compare the option schema's own version at the authoritative mutation seam while holding the scoped row lock through commit. Direct routes and future section-policy façades then share one atomic provider and the standard conflict contract.

## Overview

The option-schema API already accepts command-driven update/delete, but an earlier route or façade version check cannot prevent a competitor from writing between compare and flush. This prerequisite hardens the provider independently of CrudForm section adoption.

## Problem Statement

Two requests can read the same option-schema version, both pass a pre-command check, and then overwrite or delete from stale state. The section-policy framework's `target-required` contract therefore cannot advertise these commands until compare and write are atomic.

## Goals and Non-goals

### Goals

- Enforce the option schema's own expected `updatedAt` inside the command transaction.
- Preserve tenant/organization scope, command audit/events, direct-route behavior, and the standard 409 conflict body.
- Prove update/update and update/delete contenders cannot both mutate from one version.

### Non-goals

- Product-level locking, variant locking, section-policy routing, or schema redesign.
- Making the optimistic header mandatory for legacy direct callers.

## Proposed Solution

Extend update/delete command inputs with optional normalized `expectedUpdatedAt`. After existing auth and scoped preauthorization, enter `em.transactional`, reload the same tenant/organization-scoped option schema with `LockMode.PESSIMISTIC_WRITE` and `refresh: true`, and call `enforceCommandOptimisticLockWithGuards` once with canonical resource kind `catalog.optionschema`. Mutate or soft-delete, flush, and commit through the same transaction manager. The route-level guard remains defense in depth only. Headerless/gate-off calls still take the lock while the version guard no-ops.

Capture any command before/after audit snapshots from the locked row inside this transaction. Emit existing events only after commit. A row present during scoped preauthorization but removed before locked reload uses the shared record-gone conflict when an expected token was supplied; an initially absent/out-of-scope row retains the existing non-enumerating response.

## Architecture

| Area | Responsibility |
|---|---|
| option-schema route adapter | Parse the standard header and pass optional expected version |
| `commands/optionSchemas.ts` | Scoped transaction-held reload, guard, mutation, flush, and locked snapshots |
| direct and section-policy routes | Delegate once to the same command provider |

## Data Models

No migration. Existing `updated_at` is the version token.

## API Contracts

Legacy bodies and success shapes remain compatible. A supplied stale token returns the standard `409 optimistic_lock_conflict`; omitted headers retain the configured compatibility behavior. The canonical mutation-guard resource kind is `catalog.optionschema` for direct routes, policy façades, guards, and guard allowlists. Existing audit-log resource kinds are a separate stable namespace and remain unchanged.

## UI/UX

No new UI. Existing direct editors and later section adopters surface conflicts through the unified conflict path.

## Frontend Architecture Contract

No frontend file, route boundary, provider, browser request, or bundle changes are required by this prerequisite.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Two updates use one version | First commits; second reloads the committed version and conflicts before write |
| Update races delete | Lock order serializes both; stale contender conflicts or sees record-gone conflict |
| Initially absent or out of scope | Existing non-enumerating response |
| Header omitted or guard disabled | Row remains locked through write; compatibility mode applies |
| Flush/commit fails | Roll back mutation and emit no success event |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Check/write race remains | High | Guard the refreshed row under transaction-held pessimistic lock | Database deadlock may abort one request safely |
| Scope leaks through conflict | Critical | Scoped preauthorization before version details | None accepted |
| Direct/policy resource kinds diverge | High | Canonical-kind parity tests | New providers require the same fixture |

Rollback reverts command hardening while leaving schema/data unchanged; the catalog section adopter must then remain ineligible.

## Migration & Backward Compatibility

This is additive behavioral hardening. Existing command ids, routes, request bodies, events, audit ids, and headerless compatibility remain. Optional command inputs and post-flush version data follow existing contracts.

## Phasing and Implementation Plan

1. Add barrier/failure seams and failing contender tests.
2. Parse/pass optional expected versions from direct routes.
3. Move update/delete compare, locked snapshots, mutation, and flush into one scoped transaction-held command seam.
4. Add canonical resource-kind parity, event/audit, gate-mode, and exact-response coverage.
5. Run focused catalog tests/build/typecheck, `git diff --check`, and configured validation.

## Integration Coverage

- current/stale/missing/malformed header and gate modes;
- initially absent/out-of-scope versus removed-after-preauthorization;
- barrier-controlled update/update and update/delete contenders;
- canonical `catalog.optionschema` guard and allowlist parity across callers;
- rollback plus post-commit event/audit ordering.

## Acceptance Criteria

1. Update/delete compare the target version while holding the scoped row lock through same-manager commit.
2. No competing request can mutate from a pre-lock snapshot.
3. Direct and section-policy callers share canonical `catalog.optionschema` provider semantics.
4. Legacy compatibility and standard conflict/non-enumerating responses remain intact.
5. Focused and configured validation pass.
6. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/catalog/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root optimistic-lock rules | Compare/write atomically at the command seam | Compliant | Locked scoped row is guarded through commit |
| catalog guide | Preserve command effects and canonical resource ids | Compliant | Existing command/events remain and kind is `catalog.optionschema` |
| backward compatibility | Preserve public routes and ids | Compliant | Change is additive hardening |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data/API contract | Pass | Existing `updated_at` and standard header/body are reused |
| Risks/tests | Pass | Both contender classes and scope precedence are covered |
| Dependency boundary | Pass | Independently deployable before section adoption |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

- **2026-10-27:** Defined atomic command-bound optimistic locking for option-schema update/delete as a catalog section-adoption prerequisite.
