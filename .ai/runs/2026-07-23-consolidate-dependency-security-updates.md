# Consolidate dependency security updates

## Overview

Goal: consolidate the dependency fixes proposed by PRs #4344, #4345, and #4346 into one verified PR against `develop`, then close the superseded PRs.

## Scope

- Preserve the existing `tar` 7.5.20 resolution on `develop`, which already exceeds PR #4344's requested 7.5.19.
- Update the `body-parser` transitive resolution from 1.20.4 to 1.20.6.
- Update the `webpack-dev-server` transitive resolution from 5.2.5 to 5.2.6.
- Validate the combined lockfile and repository gate.
- Open one replacement PR and close PRs #4344–#4346 with supersession comments.

## Non-goals

- No application, module, API, schema, or runtime configuration changes.
- No dependency updates beyond the three source PRs and their required transitive lockfile changes.
- No downgrade of the newer `tar` version already present on `develop`.

## Implementation Plan

### Phase 1: Consolidate lockfile fixes

1. Compare each source PR with `develop` and preserve already-satisfied updates.
2. Regenerate the lockfile with the remaining dependency resolutions and verify the exact diff.

### Phase 2: Verify and publish

1. Run the configured validation gate and complete code-review and backward-compatibility checks.
2. Open, label, and auto-review the consolidated PR.
3. Close PRs #4344–#4346 as superseded by the consolidated PR.

## Risks

- A lockfile regeneration could pull unrelated versions; mitigate by reviewing the final diff and rejecting unrelated churn.
- PR #4344 targets `main` and requests `tar` 7.5.19, while `develop` already resolves 7.5.20; applying its commit literally would be a downgrade, so its fix is treated as already satisfied.
- Transitive dependency patches can affect development tooling; mitigate with the full configured validation gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Consolidate lockfile fixes

- [x] 1.1 Compare source PRs with develop and preserve satisfied updates — dbf790b9b
- [x] 1.2 Apply remaining dependency resolutions and verify the lockfile diff — dbf790b9b

### Phase 2: Verify and publish

- [ ] 2.1 Run validation and compatibility reviews
- [ ] 2.2 Open, label, and auto-review the consolidated PR
- [ ] 2.3 Close superseded PRs 4344 through 4346
