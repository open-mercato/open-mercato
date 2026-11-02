# Pre-merge standalone integration gate

## Goal

Catch standalone package, discovery and runtime regressions on pull requests before the snapshot publication lane runs.

## Scope

Build and pack PR workspaces without publishing, scaffold a disposable app, pin all first-party dependencies to those tarballs, production-build and start the app with snapshot-compatible settings, then run a fixed smoke suite plus affected module tests. Add an unprivileged pull-request workflow. Keep the full snapshot suite and branch protection settings unchanged.

## Risks

The first real GitHub run is required to measure duration and validate the runner image. The gate starts as a normal PR check; maintainers can require its stable job name after observing green representative runs. A second PR consolidates snapshot and local integration configuration onto this runner's environment helper.

Local validation remains blocked: three full unit-gate attempts ended in native Jest worker `SIGSEGV` crashes in different untouched suites (enterprise p2-polish, shared encryption/default-indexer, APNs message-golden). No passing full unit gate is claimed, so the PR remains draft with verification incomplete.

## Validation evidence

Runner: local, Node 24.19.0. The configured package build, generate, package rebuild, i18n sync/usage, typecheck and app production build commands all passed. `yarn test` failed as recorded above. Fourteen focused script tests passed, including corrupted/additional package files and missing/skipped smoke coverage.

A real run against a freshly provisioned disposable PostgreSQL container packed all publishable first-party workspaces, scaffolded from the packed CLI, installed and byte-verified 32 first-party packages, initialized its database, production-built and started the app. All three smoke specs passed (3.1 minutes), and the final report assertion confirmed actual successful execution for every required smoke file. Test selection chose the three fixed smoke specs from 1,461 eligible discovered files. GitHub CI and required-check rollout remain separate proof.

## Running locally

Build packages, generate registries, and build packages again. Provision a disposable PostgreSQL database, then set `STANDALONE_DATABASE_URL` explicitly and run `node scripts/ci/standalone-integration.mjs --source local --suite smoke`. Use `--suite affected --base-ref origin/main` for affected coverage or `--suite full` for the complete discovered standalone suite. The runner never defaults to a developer database.

For snapshot verification use `--source published --version <exact-version> --suite full`. The caller installs Playwright browsers before invocation. App directories and the server log are retained for inspection; the selection report records eligible specs excluded by affected selection. Module/environment discovery exclusions remain governed by the CLI's existing discovery logic.

## Implementation Plan

### Phase 1: Package and test selection

1.1 Add isolated local package packing, install provenance verification and conservative affected-test selection with regression tests.

### Phase 2: Standalone lifecycle and CI

2.1 Add a production standalone lifecycle runner and shared environment builder.
2.2 Add the unprivileged PR workflow and operational instructions.

### Phase 3: Verification

3.1 Run targeted checks, the configured validation gate, and authoritative PR review; report any environmental blockers.

## Progress

PR: #8468

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Package and test selection

- [x] 1.1 Add isolated local package packing, install provenance verification and conservative affected-test selection with regression tests. — 5cca0c98d

### Phase 2: Standalone lifecycle and CI

- [x] 2.1 Add a production standalone lifecycle runner and shared environment builder. — 72b212a2a
- [x] 2.2 Add the unprivileged PR workflow and operational instructions. — 2ca1da34f

### Phase 3: Verification

- [ ] 3.1 Run targeted checks, the configured validation gate, and authoritative PR review; report any environmental blockers.
