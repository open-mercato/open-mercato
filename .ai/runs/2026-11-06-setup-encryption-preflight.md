# Setup encryption compatibility preflight

Status: complete
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

Implementation, local gate and authoritative review are complete on #8913; old draft #8908 is superseded. Independent approval, configured QA and final-head CI remain reviewer/maintainer merge gates, not unfinished implementation. No merge is performed by this task.

## Progress

PR: #8913 (supersedes #8908)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design

- [x] 1.1 Trace setup writes and persisted encryption formats; specify empty/plaintext and unsupported-store policy. — 36963e02c

### Phase 2: Guard

- [x] 2.1 Implement isolated read-only scanner using existing cryptographic helpers and wire every setup mutation boundary. — 36963e02c
- [x] 2.2 Add meaningful cryptographic and no-mutation tests for successful/rejected reuse and new databases. — 36963e02c

### Phase 3: Verification and publication

- [x] 3.1 Run focused tests, then configured validation in order; document concrete blockers. — 823a589d0
- [x] 3.2 Review compatibility/security and publish evidence and resumable handoff on the new PR. — 823a589d0


## Prior branch validation evidence (superseded by refreshed verification)

Runner: local (no configured Compose app container running). Independent immutable install completed with native-addon warnings. Both package builds, generation, translation sync/usage, typecheck and optimized app build passed. Full `yarn test` failed: CLI has 119 passing / 2 failing suites and 2,529 passing / 4 failing tests; Turbo stops at 34 successful / 49 tasks. The failing CLI files are untouched by this follow-up.

Focused starter/write-boundary tests: 251 passed, 1 opt-in PostgreSQL skip. Standalone template setup: 37 passed. Separate opt-in PostgreSQL integration: passed, including real correct/wrong/missing tenant and Forms keys, GET-only Vault responses (success/403/404/503/unreachable), nested/system data, empty/missing/migration-only DBs and actual starter no-mutation rejection. Broad script suite: 1,568 pass, 5 skip, 2 Docker Buildx environment failures. Static review identified two initial gaps (fallback generation and plaintext health-only proof); both fixed and re-reviewed without remaining code findings. Final-head CI and independent approval remain pending. This draft is not merge-ready.


## Refreshed final verification

Runner: local, with task-owned temporary directories outside the repository and verified isolated Docker Buildx tooling. No repository/production dependency changes. Both package builds, generate, i18n sync/usage, typecheck, full `yarn test` and optimized app build pass. Full gate: 51/51 Turbo tasks successful; CLI 121 suites / 2,561 tests pass; core 2,700 suites / 27,124 tests pass (standard integration skips remain); create-app 1,145 tests pass / 4 standard skips. Additional scripts: 1,575 pass / 5 standard skips; standalone setup 37 pass; dedicated live PostgreSQL test passes with no skips. Latest focused shell/scanner/boundary run: 45 pass. Actual live fixture covers host/source-mounted and installed-container helper layouts, real correct/wrong/missing tenant/Forms keys, Vault GET-only success/403/404/503/unavailable, nested/system data, plaintext, empty/missing/migration-only DBs and no mutation on refusal.

Static review has no remaining findings. Initial review findings were fixed: version-suffixed plaintext recognition, Docker command coverage and fatal encryption refusal during ACL sync. The full-suite Linux harness fixture correction changes only its fake-runner location; no assertions or runtime sandbox policy are weakened. Original setup branch and published draft history are intact. Final-head CI/independent approval/QA remain external gates; this task does not merge.
