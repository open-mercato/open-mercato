# Catalog variant optimistic locking

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md`, `.ai/specs/2026-10-27-catalog-variant-combination-claim.md`

## TLDR

Make `catalog.variants.update` and `catalog.variants.delete` enforce the variant's own version against a scoped transaction-locked row through commit. Direct routes and future section actions then share one canonical `catalog.variant` atomic provider.

## Overview

Variant commands coordinate SKU/GTIN/default/price behavior and are invoked from more than one UI. A façade-only version check is not sufficient because a competing command can change or remove the row before the first command flushes.

## Problem Statement

Concurrent update/update or update/delete requests can both pass a pre-command check. That permits lost updates, stale snapshots, or side effects calculated from state the command did not lock.

## Goals and Non-goals

### Goals

- Enforce the variant's own expected `updatedAt` atomically in update/delete commands.
- Preserve scoped product/variant authorization and existing command effects.
- Keep canonical resource kind `catalog.variant` identical across direct, generated, and section-policy guard paths.

### Non-goals

- Variant-create combination claims or generate-missing orchestration, which remain separate prerequisites.
- Making version headers mandatory on legacy direct routes.

## Proposed Solution

Extend update/delete command input with optional normalized `expectedUpdatedAt`. After scope-only preauthorization without a write lock, every update/delete transaction follows the variant-combination prerequisite's one global order: load the persisted parent product with tenant/organization scope and `PESSIMISTIC_WRITE`; when the product references a schema and the operation may inspect combination identity, acquire the prerequisite's scoped schema lock; then reload the target variant with `PESSIMISTIC_WRITE` and `refresh: true`; only then run `enforceCommandOptimisticLockWithGuards` once using `catalog.variant`. Any default/media/price rows are acquired only after those phases and in stable id order. Derive validations, before/after snapshots, related changes, and side-effect payloads from that locked state, mutate/flush through the same transaction manager, and emit existing success effects only after commit. Headerless/gate-off calls use the identical order.

No update/delete path may lock the target variant and later acquire its product or schema. Delete may omit the schema read only when a focused invariant proves it cannot subsequently acquire product/schema or enter combination/default/media logic; otherwise it uses the full product → schema → variant order. A row removed after preauthorization produces record-gone conflict for expected-token requests; initial missing/out-of-scope preserves the non-enumerating response.

## Architecture

| Area | Responsibility |
|---|---|
| variant route adapter | Parse/pass optional target version |
| `commands/variants.ts` | Transaction-held scoped row, guard, validation, snapshots, mutation, flush |
| guard/provider registration | Canonical `catalog.variant` semantics for every caller |

## Data Models

No migration. Existing variant `updated_at` remains authoritative.

## API Contracts

Existing route bodies, command ids, and success shapes remain. Supplied stale versions return standard `409 optimistic_lock_conflict`; missing headers retain configured compatibility. Direct create/generate/update/delete and section-policy guards use canonical resource kind `catalog.variant`.

## UI/UX

No new UI. Existing and future callers use the unified record-conflict presentation.

## Frontend Architecture Contract

No frontend boundary, provider, request, route, or bundle change is introduced.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| Two updates share one version | One commits; the other conflicts before mutation |
| Update races delete | Locked/CAS order prevents stale success |
| Record removed after scoped read | Record-gone conflict for expected-token request |
| Initially absent/out of scope | Existing non-enumerating response |
| Default/price side effect fails | Transaction rolls back database changes; no success event |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Variant side effects use stale state | High | Derive them after locked reload inside one transaction | External post-commit systems keep existing failure contract |
| Lock ordering conflicts with combination claim | High | One product → schema → variant → related-row order across every caller | Unrelated database lock cycles may still abort safely |
| Resource-kind drift bypasses guards | High | Direct/generated/policy parity tests | Future providers need fixture updates |

Rollback reverts command hardening and makes the section adopter ineligible; no data migration is needed.

## Migration & Backward Compatibility

Additive hardening only. Existing ids, routes, events, audit contracts, and headerless behavior remain. Any additive command input/output follows current package compatibility rules.

## Phasing and Implementation Plan

1. Add barrier-controlled failing contender tests and effect traces.
2. Parse/pass optional expected target versions from direct routes.
3. Move product/schema/variant ordered reload, guard, validation/snapshots, related-row mutation, and flush into one transaction manager.
4. Add resource-kind and combination-claim lock-order parity tests, including update against create/redo/undo/product-delete restore and delete/default/media paths.
5. Run focused catalog tests/build/typecheck, `git diff --check`, and configured validation.

## Integration Coverage

- current/stale/missing/malformed header and guard modes;
- update/update and update/delete barrier contenders;
- cross-operation barriers for update versus create/redo/undo/product-delete restore plus delete/default/media paths, proving product → schema → variant → stable related-row order and no variant-first cycle;
- initial missing/out-of-scope versus record-gone conflict;
- SKU/GTIN/default/price success/failure effects from locked state;
- canonical `catalog.variant` parity across direct, generate, and section-policy paths.

## Acceptance Criteria

1. Variant update/delete acquire product, applicable schema, target variant, and related rows in the global prerequisite order, then compare the expected target version while holding the scoped row lock through commit.
2. Related validation, snapshots, and database effects derive from the locked state.
3. No competing update/delete succeeds from a pre-lock snapshot.
4. Every guard/provider path uses canonical `catalog.variant`.
5. Existing compatibility and response contracts remain.
6. Focused/configured validation pass and implementation/review are by Open Mercato core team members.

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
| root optimistic-lock rules | Atomic target compare/write | Compliant | Scoped refreshed row is guarded through commit |
| catalog guide | Preserve command effects and resource kinds | Compliant | Existing effects remain and canonical kind is pinned |
| backward compatibility | Keep public surfaces stable | Compliant | No removal or mandatory legacy header |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data/API contract | Pass | Existing version and conflict contracts are reused |
| Risks/tests | Pass | Contenders, effects, and lock ordering are covered |
| Dependency boundary | Pass | Atomic provider lands independently of the adopter |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready after the combination-claim prerequisite.

## Changelog

- **2026-10-27:** Pinned update/delete to the global product → schema → variant → related-row lock order and added cross-operation deadlock barriers.
- **2026-10-27:** Defined atomic command-bound optimistic locking for variant update/delete as a catalog section-adoption prerequisite.
