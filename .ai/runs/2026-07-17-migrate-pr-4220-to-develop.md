# Migrate PR 4220 to develop

## Overview

Goal: migrate the dependency update from PR #4220 onto `develop` as a replacement PR, then close the original PR only after the replacement exists and is linked.

Source PR: https://github.com/open-mercato/open-mercato/pull/4220

Original author: `dependabot[bot]`

Original commit: `ca661905601cb913b29f8378e7c372f049a040bf` (`build(deps): bump websocket-driver from 0.7.4 to 0.7.5`)

## Scope

- Recreate the `websocket-driver` transitive lockfile bump on a fresh branch from `origin/develop`.
- Preserve Dependabot authorship and credit in commit metadata and the replacement PR body.
- Open a replacement PR against `develop`.
- Link and close PR #4220 only after the replacement PR exists.

## Non-goals

- Do not update unrelated dependencies.
- Do not modify application code.
- Do not touch PRs #4064, #3961, #3950, or the #4222-#4256 review batch.
- Do not change branch automation or QA policy.

## Implementation Plan

### Phase 1: Prepare the migration branch

1.1 Create the tracking plan on a fresh `develop` branch.

### Phase 2: Apply the dependency update

2.1 Apply the PR #4220 lockfile update onto `develop` while preserving author credit.

### Phase 3: Validate and publish

3.1 Run the dependency-update validation strategy.
3.2 Open the replacement PR against `develop`, normalize labels, and run the review pass.
3.3 Link the replacement PR from PR #4220 and close PR #4220.

## Risks

- The original PR targets `main`, so the lockfile hunk may differ on `develop`; resolve by regenerating or applying only the equivalent `websocket-driver` lock entry change.
- Full CI-style validation is expensive for a lockfile-only dependency update; if local validation is limited by environment or time, record the exact blocker and leave clear re-run commands.
- PR #4220 must stay open until the replacement PR URL is known and posted back.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Prepare the migration branch

- [x] 1.1 Create the tracking plan on a fresh `develop` branch. — 2fb403738

### Phase 2: Apply the dependency update

- [ ] 2.1 Apply the PR #4220 lockfile update onto `develop` while preserving author credit.

### Phase 3: Validate and publish

- [ ] 3.1 Run the dependency-update validation strategy.
- [ ] 3.2 Open the replacement PR against `develop`, normalize labels, and run the review pass.
- [ ] 3.3 Link the replacement PR from PR #4220 and close PR #4220.
