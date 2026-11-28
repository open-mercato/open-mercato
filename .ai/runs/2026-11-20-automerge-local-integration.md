# Run Playwright in the local automerge gate

## Goal

Extend the local CI mirror introduced in open-mercato/skills#194 so both
autofix skills require this repository's applicable Playwright integration
suite before recording a passing local CI signal.

## Scope

Add repo-local extensions for both autofix skills with one shared procedure.
Use the target PR's CI scope rules and the existing ephemeral runner.
Keep the regular validation gate and GitHub Actions workflow unchanged.

## Implementation plan

### Phase 1: Local integration gate

1.1 Wire both repo-local overrides to the CI-scoped integration procedure.
1.2 Walk each scope and failure path against the current CI and skill contracts.

## Risks

The ephemeral runner needs the CI-supported Node version, Chromium and
Docker. An unavailable runner must leave local CI unverified.

## Progress

PR: #10098

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Local integration gate

- [x] 1.1 Wire both repo-local overrides to the CI-scoped integration procedure. — 0e0b463b19
- [x] 1.2 Walk each scope and failure path against the current CI and skill contracts. — 0e0b463b19

## Verification

- Both installed autofix skills load the registered repo-local overrides and
  provide A3. Both override links resolve to the same integration procedure.
- CI's scope step selected full for shared, harness, workflow and forced CI
  cases, deduplicated the module IDs for module-only changes and skipped a
  documentation-only change.
- The skill tier validator and all 21 installer tests passed on the local host.
  This documentation diff falls outside CI's Playwright scope.
