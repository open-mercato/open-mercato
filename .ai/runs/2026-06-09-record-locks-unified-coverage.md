# Execution Plan — Record Locks Unified Coverage (spec-only PR)

Source spec: .ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md

## Goal
Ship the enterprise spec that plans unified `record_locks` coverage across CRM v2 (Phase 1) and every module with editable entities (Phases 2–7) as a docs-only PR against `develop`. **No implementation** of the spec's phases in this PR.

## Scope
- Add the spec file `.ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md`.
- Add a "Pending Specifications" index entry in `.ai/specs/enterprise/README.md`.
- Continue post-review spec hardening by filling identified gaps before implementation starts.

## Non-goals
- No code changes to `record_locks`, `customers`, CRM v2 screens, or any module.
- No migrations, no UI wiring, no guard changes — those are the spec's future phases.

## Tracking issues
- Tracking: #2187 (CRM ↔ enterprise record-locking). Cross-ref: #2232 (command-level pessimistic locking seam), SPEC-ENT-003 (record-locking module), SPEC-035 (mutation-guard mechanism), OSS optimistic-locking specs 2026-05-25/28/29.

## Risks (brief)
- Index table drift in README — mitigated by matching existing row format.
- Spec assumes `crudMutationGuardService` override already covers CRM v2 CRUD routes (from SPEC-ENT-003); flagged in the spec as "to confirm during implementation".

## Implementation Plan

### Phase 1: Land spec + index
- 1.1 Add spec file under `.ai/specs/enterprise/`.
- 1.2 Add Pending Specifications index entry in `.ai/specs/enterprise/README.md`.

### Phase 2: Post-review spec gap hardening
- 2.1 Audit missing failure modes and update the spec with implementable seams, coverage guards, and BC notes.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Land spec + index

- [x] 1.1 Add spec file under `.ai/specs/enterprise/` — 558523b7a
- [x] 1.2 Add Pending Specifications index entry in README — 558523b7a

### Phase 2: Post-review spec gap hardening

- [x] 2.1 Audit missing failure modes and update the spec with implementable seams, coverage guards, and BC notes — f0e93dc0e
