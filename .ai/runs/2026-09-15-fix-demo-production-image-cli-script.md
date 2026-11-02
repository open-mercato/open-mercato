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

Current PR: https://github.com/open-mercato/open-mercato/pull/6141
Current status: ready for review.

### Phase 1: Production image packaging

- [x] 1.1 Copy `apps/mercato/scripts` into the production runner image. — c2f287167
- [x] 1.2 Add the runtime packaging regression test. — c2f287167

### Phase 2: Verification and PR

- [x] 2.1 Run focused and applicable validation checks — `node --test scripts/__tests__/docker-production-runtime.test.mjs` passed; `yarn test:scripts` passed (952 passed, 1 skipped); repository-wide `typecheck` and `build:packages` are blocked by the pre-existing shared worktree dependency setup (`@open-mercato/web-research` / `typescript-js` resolution).
- [x] 2.2 Review, push, and open the PR against `develop` — PR #6141.
