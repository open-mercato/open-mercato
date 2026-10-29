# Organization create undo lifecycle

## TLDR

Fix [#7663](https://github.com/open-mercato/open-mercato/issues/7663): undoing organization creation retains a soft-deleted row; redo restores the same identity and original creation time. The user approved this lifecycle policy on 2026-10-29.

## Overview

This is the runtime follow-up to [directory undo integration coverage](2026-10-19-directory-undo-integration-coverage.md). Scope is the organization create command and the slug allocation required to retain its tombstone safely. Other modules and shared command-bus behavior remain outside this fix.

## Problem Statement

- `packages/core/src/modules/directory/commands/organizations.ts`: create undo calls `deleteOrmEntity({ soft: false })`; `OrganizationUndoSnapshot` omits `createdAt`; the redo recreation seed does not supply it.
- `serializeOrganization` already includes `createdAt` in the action log's `snapshotAfter`. The shared `resolveRedoSnapshot` prefers `payload.undo.after`, so legacy replay needs an explicit creation-time fallback to `snapshotAfter`.
- The existing [coverage spec](2026-10-19-directory-undo-integration-coverage.md) deliberately defers this lifecycle decision. Its integration suite quarantines both regressions with links to #7663.
- `organizations_tenant_slug_uniq` includes deleted rows, while `resolveUniqueSlug` filters them out. Retaining tombstones requires slug allocation to account for their reservations.

## Proposed Solution

Use the existing tenant-qualified soft-delete path for create undo, deactivate and detach its tombstone, and retain hierarchy locking, child-parent restoration, custom-field scoping, and transaction boundaries. Redo revives the row and its after-state. Reserve tombstone slugs when allocating a slug for another organization.

Add optional serialized creation time to new undo snapshots. For recreation, recover it from the undo snapshot or the legacy action-log after-snapshot. Preserve a surviving row's original creation time. Historical logs lacking both timestamps cannot recover the original time and retain their existing fallback behavior.

## Architecture

Keep writes in `directory.organizations.create`, using the DI data engine, `withAtomicFlush({ transaction: true })`, and the existing tenant hierarchy lock. Flush tombstone scalar changes before hierarchy reads. Queue deletion side effects with the existing events/indexer configuration after the transaction so command-bus flushing refreshes projections. Redo keeps its existing creation side effects. External events already delivered cannot be retracted; replay emits the existing compensating lifecycle events.

Use `extractUndoPayload`, `resolveRedoSnapshot`, and shared date revival; do not change shared replay resolution. Tenant access checks execute before persistence. New slug checks include tombstones within the same tenant and hierarchy lock, matching the existing database unique constraint.

## Data Model

No entity or schema changes. Add optional `createdAt` to the internal serialized undo snapshot. Surviving rows keep their authoritative creation time; recreation converts a snapshot timestamp back to `Date`. Missing historical timestamps retain the pre-existing recreation fallback. `updated_at` continues to advance on persisted mutations.

## API Contracts

| Path | Required integration coverage |
| --- | --- |
| `POST /api/directory/organizations` | Create an organization with hierarchy/custom fields; a second same-name creation after undo receives a free suffixed slug. |
| `GET /api/directory/organizations` | Undone organization is hidden; redone identity, fields, hierarchy and custom fields match its after-state. |
| `POST /api/audit_logs/audit-logs/actions/undo` | Retain a tenant/id-scoped tombstone and original creation time; token consumption and null organization action-log scope remain covered. |
| `POST /api/audit_logs/audit-logs/actions/redo` | Restore the original identity and creation time while retaining an intervening same-name organization. |

Enable both quarantined lifecycle regressions in `TC-UNDO-001-organizations.spec.ts`; use its existing scoped read-only database observations. Command tests cover revival, recreation, legacy snapshots and tenant rejection. The existing update/delete hierarchy and custom-field tests remain regression coverage. No UI paths or request/response shapes change.

## Risks & Impact Review

| Scenario | Severity | Mitigation and residual risk |
| --- | --- | --- |
| Tombstone slug blocks a later create. | Medium | Allocate against all tenant rows; cover undo → same-name create → redo. Historical missing-row replay can still encounter an independently occupied slug, and its existing unique constraint rejects the conflict. |
| Legacy undo snapshot lacks creation time. | Medium | Read the action-log after-snapshot as fallback. If both lack it, historical time cannot be reconstructed. |
| Replay affects another tenant or loses hierarchy/custom values. | High | Preserve authorization, qualified target filters, lock, transaction and existing restoration helpers; run tenant unit and full directory undo integration coverage. |
| Scalar mutations disappear before hierarchy queries. | Medium | Explicitly flush the tombstone scalars before rebuilding hierarchy. |
| Validation environment is unavailable. | Medium | Record exact checks and blockers; never represent unavailable integration or CI evidence as a pass. |

## Migration & Backward Compatibility

The user explicitly approved the observable persistence and slug-reservation correction on 2026-10-29. Undone organizations now remain physically present with `deleted_at` set, consistent with #2580; supported active-record queries still hide them. Their slugs remain reserved, as required by the existing full unique constraint. Consumers inspecting raw organization rows must filter tombstones; subsequent same-slug creation receives the normal suffix.

No route, response shape, entity schema, command identifier, or exported signature is removed or renamed. The internal snapshot addition is optional, preserving old log readability. Timestamp restoration uses legacy `snapshotAfter` where available; already-lost timestamps cannot be repaired without historical evidence. Document these implications in `UPGRADE_NOTES.md`. No data migration or backfill is required. Rolling back code does not physically remove retained tombstones or reclaim their slugs.

## Implementation Plan

1. Implement scoped soft undo, timestamp-aware replay and tombstone slug allocation together with command regressions and enabled API lifecycle tests. Capture a local failing-before/passing-after comparison; deliver production code and passing tests together.
2. Run focused unit/API coverage, the configured ordered validation gate, template parity and independent review. Record environmental limits and publish the issue-linked PR with QA pending where required.

## Final Compliance Report — 2026-10-29

Reviewed root, core, shared and QA agent guidance, `BACKWARD_COMPATIBILITY.md`, and spec-folder rules. Independent scope review confirmed one cohesive fix; its green-step planning correction is incorporated. Independent implementation review found no actionable findings after tracing replay, tenant filters, hierarchy locking, date revival and actual lifecycle/index consumers. The implementation retains command-based writes, scoped access, existing locking, shared snapshot helpers and post-transaction side effects. It adds no dependency, schema, shared contract or UI surface. CI and manual QA remain required; this report grants no QA approval.

### Validation

Runner: local; Docker Desktop could not start. The configured gate was attempted in order.

- Focused directory command tests: 5 suites / 55 tests passed; the unchanged implementation failed 7 lifecycle assertions.
- Full core unit tests: 2,502 suites / 24,582 tests passed; 10 suites / 209 tests skipped by their existing conditions.
- Package builds before and after generation, generation, translation sync/usage, workspace typechecking, application build and template parity passed. IPC/server permissions required retries outside the sandbox.
- The unmodified root `yarn test` hit the docs build's fixed 1 GiB heap cap. The docs test command passed all 23 tests with a 4 GiB heap. A workspace run excluding docs completed 46 tasks but failed 81 of 928 create-app harness cases; inspected failures include its macOS sandbox rejecting Homebrew `libuv` and tracker-copy equality against pre-existing local tracker edits. Those files remain outside the fix.
- Local public API execution could not start because Docker Desktop was unavailable. [CI run 40803785321](https://github.com/open-mercato/open-mercato/actions/runs/40803785321) passed on `b9b7e3b0adf19e6d1e402a1b13f50063d5097a62`, including required builds, lint, typechecking and unit tests; [live integration passed all 61 cases](https://github.com/open-mercato/open-mercato/actions/runs/40803785321/job/123219751828), including all 7 organization undo cases. [Independent review](https://github.com/open-mercato/open-mercato/pull/8177#pullrequestreview-5697339288) confirmed the code and CI; its sole blocker was the upgrade-note conflict resolved by merging `main` and retaining both entries. The resulting merge commit requires fresh CI and reviewer recheck; manual QA remains required.

## Changelog

- 2026-10-29: User approved tombstones and creation-time preservation; implemented soft undo, timestamp-aware recreation and slug reservation, enabled lifecycle API tests, and recorded regression, review and compatibility evidence with validation limits.

- 2026-10-29: Resolved the upgrade-note conflict against `main`, preserving the scoped-attachment cache guidance; recorded passing lifecycle CI and independent review on the pre-merge head. Fresh merge-head CI and manual QA remain required.
