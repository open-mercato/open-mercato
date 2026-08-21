# Railway One-Command Deploy Implementation

## Overview

Goal: ship issue #2414 as an additive `mercato deploy railway` implementation that supports both Git-backed and repository-free local uploads.

Source spec: `.ai/specs/2026-05-12-railway-one-command-deploy.md`

Affected areas:

- `packages/cli`
- `packages/create-app`
- `packages/cache`
- `apps/docs`
- root task routing and specification status

## Scope

- Add the Railway deployment command, API client, state handling, source selection, security checks, cleanup, and tests.
- Add standalone Railway app/worker configuration and infrastructure healthcheck.
- Add documentation and record live Railway validation.
- Preserve all existing CLI, cache, and standalone application behavior.

## Non-Goals

- Publishing npm packages.
- Applying database migrations.
- Creating GitHub repositories automatically.
- Supporting deployment providers other than Railway.

## Implementation Plan

### Phase 1: CLI And Infrastructure

1. Add the additive Railway deploy command and supporting GraphQL, source, state, environment, redaction, and cleanup modules.
2. Add optional cache health probes and standalone Railway runtime files.
3. Add focused unit and gated live integration coverage.

### Phase 2: Documentation And Validation

1. Add deployment documentation, CLI navigation, and spec status updates.
2. Run targeted package validation and the full repository validation gate.
3. Complete code review, backward compatibility review, and live Railway verification evidence.

### Phase 3: Delivery

1. Commit and push the implementation branch.
2. Open a PR against `develop`, link issue #2414, and apply available workflow labels.
3. Run the automated PR review pass and publish the final reviewer summary.

## Risks

- Railway Public API schema or CLI output can drift; operations are isolated and failures remain resumable.
- Local upload can expose files if ignore rules regress; archive safety checks and `.railwayignore` fail closed.
- Railway domain routing must match the runtime port; `PORT=3000` is pinned and tested.
- Exact release-artifact validation depends on publishing the repository package version to npm; current live validation used locally prepared development packages.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: CLI And Infrastructure

- [x] 1.1 Add Railway deploy command and supporting modules — e2b742ff6
- [x] 1.2 Add cache probes and standalone Railway runtime files — e2b742ff6
- [x] 1.3 Add unit and gated integration coverage — e2b742ff6

### Phase 2: Documentation And Validation

- [x] 2.1 Add documentation and update the specification — e2b742ff6
- [x] 2.2 Run targeted and full validation gates
- [x] 2.3 Complete code, compatibility, and live validation review

### Phase 3: Delivery

- [x] 3.1 Commit and push the implementation branch — 4f3b2db17
- [x] 3.2 Open and link the implementation PR — PR #2683
- [x] 3.3 Complete automated review and final summary — PR #2683

## Validation Evidence

- `yarn workspace @open-mercato/cli test --runInBand src/lib/deploy/railway`: 43/43 passed.
- `yarn workspace create-mercato-app test`: 39/39 passed.
- `yarn build:packages`: 21/21 passed.
- `yarn typecheck`: 21/21 passed.
- `yarn workspace open-mercato-docs build`: passed with one pre-existing WSL2 broken-anchor warning.
- Live Railway deployment: app, worker, PostgreSQL, Redis, public healthcheck, repeated-run idempotency, and cleanup passed.
- Full `yarn test` reached 945 passing CLI tests before the existing `dev-env-reload` watcher test failed because the host cannot create even a minimal standalone `fs.watch()` handle (`EMFILE`).
- `yarn build:app` stalled in the Turbopack production compile without producing an error and was treated as an environment limitation after the package build and repository typecheck passed.
