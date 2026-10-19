# Directory undo integration coverage

Goal: automate #2580's directory undo/redo invariants and non-undoable tenant mutations with isolated fixtures.

Source doc: .ai/specs/2026-10-19-directory-undo-integration-coverage.md (design PR #7660)

## Scope

Add the directory TC-UNDO-001 suite using existing helpers, metadata, and disable flag. Preserve production behavior. Quarantine observed lifecycle defects with a tracked issue; keep other assertions active.

## Implementation Plan

### Phase 1: API integration coverage

1.1 Verify live organization/action/custom-field contracts and track lifecycle defects.
1.2 Implement create/update/delete round trips, full snapshots, hierarchy/custom fields, token consumption, null-scope regression, and tenant no-token assertions.

### Phase 2: Verification

2.1 Prove enabled/disabled runs and execute the configured local validation gate.
2.2 Independently review, address findings, and publish evidence with the ready PR.

## Risks

Create undo currently hard-deletes and redo resets creation time; those assertions need a linked quarantine. All SQL observations must target ephemeral DATABASE_URL and fixture tenant/id. Existing unrelated worktree changes are excluded from commits. Runner: local; compose probes found no configured running app.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API integration coverage

- [ ] 1.1 Verify live contracts and track lifecycle defects
- [ ] 1.2 Implement directory undo integration suite

### Phase 2: Verification

- [ ] 2.1 Prove enabled/disabled runs and validation gate
- [ ] 2.2 Independently review and publish evidence
