# Setup encryption compatibility preflight

Status: in-progress
Source doc: .ai/specs/2026-07-19-unified-starter-package.md

## Goal

Before setup mutates a reused database, establish read-only compatibility with stored encryption using existing KMS/decryption helpers. Follow-up to #8613, forked from 9d3b3b30f. The current isolated task branch is intentional; do not modify the original PR branch.

## Scope

Setup mutation boundaries in monorepo, standalone template, and starter. Read-only inventory, authenticated decryption, redacted failure, tests, spec and operator guidance. No key creation/rotation, ciphertext rewrites, dependencies, shared database initialization, base merge, or automation policy changes.

## Implementation Plan

### Phase 1: Design

1.1 Trace setup writes and persisted encryption formats; specify empty/plaintext and unsupported-store policy.

### Phase 2: Guard

2.1 Implement isolated read-only scanner using existing cryptographic helpers and wire every setup mutation boundary.
2.2 Add meaningful cryptographic and no-mutation tests for successful/rejected reuse and new databases.

### Phase 3: Verification and publication

3.1 Run focused tests, then configured validation in order; document concrete blockers.
3.2 Review compatibility/security and publish evidence and resumable handoff on the new PR.

## Risks

A preflight snapshot cannot prevent concurrent application writes or later external key rotation. Incomplete inventory, unknown encrypted stores, permissions, limits and unavailable dependencies must reject rather than imply compatibility. Standalone built-helper resolution must be tested. Full gate uses an independent dependency install in this worktree. Current blockers: untouched CLI agent-files-extension and module-inspection suites fail (4 tests; full run stops at 34/49 tasks); broader script Docker COPY tests cannot run successfully without usable Buildx. GitHub reports this deliberately preserved parent-derived branch DIRTY against main. No base merge is authorized.

## Resume notes

Use `om-auto-continue-pr 8908`; start at 3.1. Confirm whether #8613 has landed and obtain an allowed integration strategy before changing the requested ancestry; do not merge base or push the original setup branch. Inspect/fix the four untouched CLI fixture failures in their owning change or rerun once the repository baseline/environment is corrected. Restore usable Docker Buildx for the two Docker COPY checks. Rerun the configured full test gate, then app build if needed, inspect final-head CI and repeat the authoritative review. Do not promote the draft or claim full validation until these blockers clear. The live PostgreSQL fixture is disposable: `OM_PG_INTEGRATION=1 timeout 240 node --test packages/starter/src/__tests__/encryption-preflight.pg.test.mjs`. Ordinary environment convergence predating the DB guard is preserved; no guarantee of zero earlier local-file changes is claimed.

## Progress

PR: #8908

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design

- [x] 1.1 Trace setup writes and persisted encryption formats; specify empty/plaintext and unsupported-store policy. — e3e0ebb5e

### Phase 2: Guard

- [x] 2.1 Implement isolated read-only scanner using existing cryptographic helpers and wire every setup mutation boundary. — 457f0f6f9
- [x] 2.2 Add meaningful cryptographic and no-mutation tests for successful/rejected reuse and new databases. — cb73a18d9

### Phase 3: Verification and publication

- [ ] 3.1 Run focused tests, then configured validation in order; document concrete blockers.
- [x] 3.2 Review compatibility/security and publish evidence and resumable handoff on the new PR. — b42904b5e


## Validation evidence

Runner: local (no configured Compose app container running). Independent immutable install completed with native-addon warnings. Both package builds, generation, translation sync/usage, typecheck and optimized app build passed. Full `yarn test` failed: CLI has 119 passing / 2 failing suites and 2,529 passing / 4 failing tests; Turbo stops at 34 successful / 49 tasks. The failing CLI files are untouched by this follow-up.

Focused starter/write-boundary tests: 251 passed, 1 opt-in PostgreSQL skip. Standalone template setup: 37 passed. Separate opt-in PostgreSQL integration: passed, including real correct/wrong/missing tenant and Forms keys, GET-only Vault responses (success/403/404/503/unreachable), nested/system data, empty/missing/migration-only DBs and actual starter no-mutation rejection. Broad script suite: 1,568 pass, 5 skip, 2 Docker Buildx environment failures. Static review identified two initial gaps (fallback generation and plaintext health-only proof); both fixed and re-reviewed without remaining code findings. Final-head CI and independent approval remain pending. This draft is not merge-ready.
