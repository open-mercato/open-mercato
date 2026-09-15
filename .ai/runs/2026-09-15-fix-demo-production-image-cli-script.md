# Include the Mercado CLI launcher in the production image

## Goal

Keep the production container's initialization and migration commands working when the app starts.

## Scope

The production Docker stage must package `apps/mercato/scripts`, including `mercato-cli.mjs`, because the app's `mercato` workspace commands depend on that launcher at runtime. Add a focused packaging regression test and leave deployment/restart operations outside this PR.

## Implementation Plan

### Phase 1: Production image packaging

1. Add the app scripts directory to the production runner stage of `Dockerfile`.
2. Add a focused test that verifies the runner copies the runtime launcher and that the source launcher exists.

### Phase 2: Verification and PR

1. Run the focused regression test, formatting/diff checks, and the applicable repository validation commands.
2. Review the final diff, push the branch, and open a PR against `develop` with the production failure evidence and validation results.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

Current PR: pending
Current status: implementation in progress.

### Phase 1: Production image packaging

- [ ] 1.1 Copy `apps/mercato/scripts` into the production runner image.
- [ ] 1.2 Add the runtime packaging regression test.

### Phase 2: Verification and PR

- [ ] 2.1 Run focused and applicable validation checks.
- [ ] 2.2 Review, push, and open the PR against `develop`.
