# PR #7341 remediation plan

## Goal

Resolve the existing merge conflict against current main while preserving Person interaction state, labels, and active/revoked conversation-share history through delete, undo, redo, and repeated undo.

## Evidence

- PR #7341 and issue #7314 define the conversation-share deletion and restoration fix.
- Review https://github.com/open-mercato/open-mercato/pull/7341#pullrequestreview-5564698801 identifies the people.ts conflict and requires retaining #7204 and #7575 behavior.
- Existing PR tests and current-head CI passed before this base update; new-head CI remains authoritative.

## Non-goals

No schema, API, ACL, email visibility-policy, dependency, UI, or architecture changes. No history rewrite, PR merge, self-approval, or QA approval.

## Assumptions

The PR's current base main is authoritative over the historic develop references. The only unresolved review finding is the merge conflict. The prior independent source pass found no other confirmed code findings.

## Validation

Use GitHub checks for the full gate and focused local regression coverage for the combined conflict resolution when the new head has no usable CI signal. Run the merged lessons catalog validator. Record exact commands and runner in the PR summary.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Preserve conversation-share history during Person deletion and undo — 1e8ee78de2ca5ca5665271debce8cf79e7c09009

### Phase 2: Resolve inherited review finding

- [x] 2.1 Merge current main and preserve all three restoration paths — 589a04f6db8f3f5218cfc64aacc3dbba6faadc21
- [x] 2.2 Verify combined restoration regressions and merged lessons catalog — 589a04f6db8f3f5218cfc64aacc3dbba6faadc21
- [ ] 2.3 Review the resolved diff, publish evidence, and request independent re-review
