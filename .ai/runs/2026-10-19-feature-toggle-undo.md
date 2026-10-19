# Feature-toggle undo integration coverage

Goal: automate issue #2581's global and tenant-override undo/redo invariants through the real API.

Source doc: .ai/specs/2026-10-19-feature-toggle-undo-integration-coverage.md (spec PR #7658)

## Scope

Add module-local tests using the existing undo harness and disable gate. Preserve production behavior, ACLs, schema and shared harness contracts. Record concrete runtime defects separately and quarantine only their affected invariants.

## Implementation Plan

### Phase 1: Test coverage

1.1 Add global CRUD undo/redo, scalar/version, related-override and permission coverage.
1.2 Add override lifecycle, token consumption and identity coverage.

### Phase 2: Validation and review

2.1 Run enabled/disabled integration tests and the configured validation gate (runner: local).
2.2 Independently review, fix findings, and publish the final PR state with validation evidence.

## Risks

- Global creation undo hard-deletes and override creation redo may change identity. Isolate each confirmed defect behind a linked fixme.
- Unrelated pre-existing worktree changes are excluded from every commit.
- The complete repository gate may expose unrelated baseline failures; retain exact commands and evidence.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Test coverage

- [x] 1.1 Add global CRUD undo/redo, scalar/version, related-override and permission coverage. — 489dd432a1
- [x] 1.2 Add override lifecycle, token consumption and identity coverage. — 489dd432a1

### Phase 2: Validation and review

- [ ] 2.1 Run enabled/disabled integration tests and the configured validation gate (runner: local).
- [ ] 2.2 Independently review, fix findings, and publish the final PR state with validation evidence.
