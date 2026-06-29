# Migrate Dependabot Dependency PRs to Develop

## Overview

Goal: recreate Dependabot PRs `#2003` and `#2004` on top of `develop`, then close the original PRs that target `main`.

Affected area: dependency lockfile maintenance.

Source PRs:

- `#2003` — `chore(deps): bump postcss from 8.4.31 to 8.5.15`
- `#2004` — `chore(deps): bump webpack-dev-server from 5.2.3 to 5.2.4`

## Scope

- Apply the same dependency resolution changes to `yarn.lock` on a branch based on `origin/develop`.
- Validate the dependency graph with install and focused package checks.
- Open one replacement PR against `develop`.
- Close PRs `#2003` and `#2004` with comments pointing at the replacement PR.

## Non-goals

- No runtime code changes.
- No package manifest changes unless `yarn` proves they are required for the same dependency bumps.
- No broad dependency refresh beyond `postcss` and `webpack-dev-server` transitive lockfile updates.

## Implementation Plan

### Phase 1: Baseline and Plan

1.1 Confirm source PR metadata and target mismatch.

1.2 Create this execution plan and push the task branch.

### Phase 2: Recreate Dependency Bumps

2.1 Apply the `postcss` and `webpack-dev-server` lockfile updates on `develop`.

2.2 Validate the resulting dependency graph and review the lockfile diff for scope.

### Phase 3: Publish Replacement PR and Close Originals

3.1 Open a replacement PR against `develop` with dependency labels.

3.2 Close the original Dependabot PRs with supersession comments.

## Risks

- Lockfile shape may differ from the original PRs because `develop` has moved since Dependabot opened PRs against `main`.
- Full repository validation is expensive for a lockfile-only dependency update; this run will prioritize install and focused lockfile/package validation unless the dependency change causes code or generated output changes.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Baseline and Plan

- [x] 1.1 Confirm source PR metadata and target mismatch — 316761428
- [x] 1.2 Create this execution plan and push the task branch — 316761428

### Phase 2: Recreate Dependency Bumps

- [x] 2.1 Apply the `postcss` and `webpack-dev-server` lockfile updates on `develop` — ca0791ef3
- [x] 2.2 Validate the resulting dependency graph and review the lockfile diff for scope — ca0791ef3

### Phase 3: Publish Replacement PR and Close Originals

- [x] 3.1 Open a replacement PR against `develop` with dependency labels — PR #2005
- [x] 3.2 Close the original Dependabot PRs with supersession comments — PR #2005
