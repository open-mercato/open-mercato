# Port engine.io 6.6.9 to develop

## Overview

Port the dependency lockfile update from PR #4347 onto the configured `develop` base branch, validate the resulting dependency graph, open a replacement PR, and close the original `main`-targeted PR after the replacement is available.

## Goal

Land the `engine.io` 6.6.5 → 6.6.9 update (including its patched `ws` dependency) on `develop` without carrying unrelated `main`/`develop` divergence.

## Scope

- Base the replacement branch on `origin/develop`.
- Port only commit `db77937e7a393d655d062ad3e2cf38a90636be8e` from PR #4347.
- Verify the lockfile resolves `engine.io` 6.6.9 and the updated `ws` dependency.
- Run the repository validation gate, review the diff, and open a ready replacement PR.
- Close PR #4347 with a link to the replacement PR.

## Non-goals

- Do not merge the replacement PR.
- Do not modify package manifests or unrelated dependency versions.
- Do not carry unrelated changes caused by the source PR targeting `main`.

## Implementation Plan

### Phase 1: Port the dependency update

1. Apply the source PR's single dependency commit to a branch based on `develop`.
2. Confirm the resulting diff is limited to the intended lockfile resolution changes.

### Phase 2: Validate and publish

1. Run targeted dependency checks and the configured validation gate.
2. Complete backward-compatibility and automated review, finalize the replacement PR, and close PR #4347.

## Risks

- The source PR targets `main`, whose history differs substantially from `develop`; cherry-picking only its single commit avoids importing unrelated branch divergence.
- Transitive dependency resolution may differ on `develop`; the lockfile diff and install validation must be inspected before publication.
- Closing PR #4347 is deferred until the replacement PR exists so the security update remains traceable.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Port the dependency update

- [ ] 1.1 Apply PR #4347's dependency commit onto `develop`
- [ ] 1.2 Verify the port contains only intended lockfile changes

### Phase 2: Validate and publish

- [ ] 2.1 Run targeted checks and the configured validation gate
- [ ] 2.2 Review, finalize the replacement PR, and close PR #4347
