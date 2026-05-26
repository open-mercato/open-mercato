# Release Existing No Version Push

## Overview

Goal: prevent the release workflow's `existing` mode from creating and pushing a version-change commit, because that mode publishes the version already present in `package.json`.

Scope:
- `.github/workflows/release.yml`
- A focused script/workflow regression test under `scripts/__tests__/`

Affected area:
- GitHub Actions release workflow
- Release automation behavior for `workflow_dispatch.inputs.bump == existing`

Non-goals:
- Do not change package publishing behavior.
- Do not change patch/minor/major release version bump behavior.
- Do not modify package versions, changelog content, tags, or npm publish scripts.

## Implementation Plan

### Phase 1: Workflow Guard

1. Add an explicit guard to the release workflow so `Commit version changes` exits early when `inputs.bump` is `existing`.
2. Keep later tag and GitHub Release steps running from the existing version output.

### Phase 2: Regression Coverage

1. Add a small Node test that parses `.github/workflows/release.yml` and verifies the `Commit version changes` step contains the `existing` no-op guard before `git add -A`.
2. Run the focused script test and targeted syntax validation.

### Phase 3: Review And PR

1. Run targeted checks and a self-review for backward compatibility and workflow scope.
2. Open a PR against `develop`, apply labels, and post the auto-create-pr summary.

## Risks

- YAML expression placement is easy to get subtly wrong; the guard should run inside the shell step and compare the rendered workflow input string.
- The workflow still needs to tag and create a GitHub Release in `existing` mode, so only the commit/push step should no-op.
- Full repository validation may be expensive for a CI-only YAML change; any skipped or blocked full-gate command must be documented in the PR.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Workflow Guard

- [x] 1.1 Add existing-mode no-op guard to release commit step — a1c593136

### Phase 2: Regression Coverage

- [x] 2.1 Add workflow regression test — 557aac351
- [x] 2.2 Run targeted validation — dc582804a

### Phase 3: Review And PR

- [x] 3.1 Complete self-review and open PR — a5dc45e8b
