# Setup encryption compatibility preflight

Status: in-progress
Source doc: .ai/specs/2026-07-19-unified-starter-package.md

## Goal

Before setup mutates a reused database, establish read-only compatibility with stored encryption using existing KMS/decryption helpers. Follow-up to #8613, originally forked from 9d3b3b30f. The published original remains intact; the refreshed task branch carries only the follow-up delta onto main after #8613 merged. No base merge or history rewrite was performed; do not modify the original PR branch.

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

A preflight snapshot cannot prevent concurrent application writes or later external key rotation. Incomplete inventory, unknown encrypted stores, permissions, limits and unavailable dependencies must reject rather than imply compatibility. Standalone built-helper resolution must be tested. Full gate uses an independent dependency install in this worktree. The prior full-gate failures were traced to inherited task TMP/TEMP paths inside the repository; clearing all three temp-directory variables makes the two failing CLI suites pass (30 tests). Refreshed branch avoids the squash-history conflict without rewriting old history. Remaining validation runs use isolated temporary tooling for Buildx.

## Resume notes

Continuation is autonomous. Finish the refreshed branch, publish a new follow-up and supersede old draft #8908 after the replacement exists. Preserve the original setup branch and published draft history. Re-run the full configured gate with TMPDIR/TMP/TEMP all set outside the repository and a usable isolated Docker Buildx plugin. Final review and publication remain required.

## Progress

PR: replacement pending (supersedes #8908)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design

- [ ] 1.1 Trace setup writes and persisted encryption formats; specify empty/plaintext and unsupported-store policy.

### Phase 2: Guard

- [ ] 2.1 Implement isolated read-only scanner using existing cryptographic helpers and wire every setup mutation boundary.
- [ ] 2.2 Add meaningful cryptographic and no-mutation tests for successful/rejected reuse and new databases.

### Phase 3: Verification and publication

- [ ] 3.1 Run focused tests, then configured validation in order; document concrete blockers.
- [ ] 3.2 Review compatibility/security and publish evidence and resumable handoff on the new PR.


## Validation evidence

Runner: local (no configured Compose app container running). Independent immutable install completed with native-addon warnings. Both package builds, generation, translation sync/usage, typecheck and optimized app build passed. Full `yarn test` failed: CLI has 119 passing / 2 failing suites and 2,529 passing / 4 failing tests; Turbo stops at 34 successful / 49 tasks. The failing CLI files are untouched by this follow-up.

Focused starter/write-boundary tests: 251 passed, 1 opt-in PostgreSQL skip. Standalone template setup: 37 passed. Separate opt-in PostgreSQL integration: passed, including real correct/wrong/missing tenant and Forms keys, GET-only Vault responses (success/403/404/503/unreachable), nested/system data, empty/missing/migration-only DBs and actual starter no-mutation rejection. Broad script suite: 1,568 pass, 5 skip, 2 Docker Buildx environment failures. Static review identified two initial gaps (fallback generation and plaintext health-only proof); both fixed and re-reviewed without remaining code findings. Final-head CI and independent approval remain pending. This draft is not merge-ready.
