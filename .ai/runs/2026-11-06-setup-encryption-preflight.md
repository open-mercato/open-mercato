# Setup encryption compatibility preflight

Status: in-progress
Source doc: .ai/specs/2026-07-19-unified-starter-package.md

## Goal

Before setup mutates a reused database, establish read-only compatibility with stored encryption using existing KMS/decryption helpers. Follow-up to #8613, originally forked from 9d3b3b30f. The published original remains intact; the refreshed task branch carries only the follow-up delta onto main after #8613 merged. The original run did not merge the base or rewrite history; the 2026-11-12 resume merges current main as requested, preserving all published commits and the original PR branch.

## Scope

Setup mutation boundaries in monorepo, standalone template, and starter. Read-only inventory, authenticated decryption, redacted failure, tests, spec and operator guidance. No key creation/rotation, ciphertext rewrites, dependencies, shared database initialization or automation policy changes. The 2026-11-12 resume includes a main merge to reconcile the branch as requested.

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

- [x] 3.1 Run focused tests, then configured validation in order; document concrete blockers. — b8935fad9
- [x] 3.2 Review compatibility/security and publish evidence and resumable handoff on the new PR. — b8935fad9


## Prior branch validation evidence (superseded by refreshed verification)

Runner: local (no configured Compose app container running). Independent immutable install completed with native-addon warnings. Both package builds, generation, translation sync/usage, typecheck and optimized app build passed. Full `yarn test` failed: CLI has 119 passing / 2 failing suites and 2,529 passing / 4 failing tests; Turbo stops at 34 successful / 49 tasks. The failing CLI files are untouched by this follow-up.

Focused starter/write-boundary tests: 251 passed, 1 opt-in PostgreSQL skip. Standalone template setup: 37 passed. Separate opt-in PostgreSQL integration: passed, including real correct/wrong/missing tenant and Forms keys, GET-only Vault responses (success/403/404/503/unreachable), nested/system data, empty/missing/migration-only DBs and actual starter no-mutation rejection. Broad script suite: 1,568 pass, 5 skip, 2 Docker Buildx environment failures. Static review identified two initial gaps (fallback generation and plaintext health-only proof); both fixed and re-reviewed without remaining code findings. Final-head CI and independent approval remain pending. This draft is not merge-ready.


## Refreshed final verification

Runner: local, with task-owned temporary directories outside the repository and verified isolated Docker Buildx tooling. No repository/production dependency changes. Both package builds, generate, i18n sync/usage, typecheck, full `yarn test` and optimized app build pass. Full gate: 51/51 Turbo tasks successful; CLI 121 suites / 2,561 tests pass; core 2,700 suites / 27,124 tests pass (standard integration skips remain); create-app 1,145 tests pass / 4 standard skips. Additional scripts: 1,575 pass / 5 standard skips; standalone setup 37 pass; dedicated live PostgreSQL test passes with no skips. Latest focused shell/scanner/boundary run: 45 pass. Actual live fixture covers host/source-mounted and installed-container helper layouts, real correct/wrong/missing tenant/Forms keys, Vault GET-only success/403/404/503/unavailable, nested/system data, plaintext, empty/missing/migration-only DBs and no mutation on refusal.

Static review has no remaining findings. Initial review findings were fixed: version-suffixed plaintext recognition, Docker command coverage and fatal encryption refusal during ACL sync. The full-suite Linux harness fixture correction changes only its fake-runner location; no assertions or runtime sandbox policy are weakened. Original setup branch and published draft history are intact. Final-head CI/independent approval/QA remain external gates; this task does not merge.

## Independent review follow-up

External review/QA at 3587b60ffc identified five actionable findings. Revised proof uses five server-filtered candidate rows per store/scope, excludes known Documents CRDT columns, recognises canonical IV-shaped envelopes, preserves best-effort optional dev migration behavior while leaving remote-target guards intact, and creates unique fallback configuration only for a fresh unconfigured environment. Live reported cases (Documents, 150k plaintext and encrypted rows, URNs) now pass; revised full gate and review remain pending.


## Revised final verification after independent review

All eight configured commands pass after the fixes: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, full test (51/51 tasks), build:app. Cached package/app outputs are reused where inputs are unchanged. Script suite: 1,579 pass / 5 standard skips; expanded real PostgreSQL integration: 1 pass / no skips; standalone setup: 37 pass. No known code blockers remain in static re-review. All five independent review findings and the QA S4–S6 regressions are addressed; the optional copy-generation nit is deferred because byte-parity tests retain the established mirror pattern without changing generator contracts. Full settings remain frozen for guarded child execution and are never logged.

The proof now samples at most five server-filtered candidate rows per store/key scope. It is not a full historical decryption audit. Unknown stores/formats, external encrypted files, unselected mixed historical keys, query/time/sample limits and concurrent key/data changes remain stated limits; normal per-record guards are preserved. Existing root keys outrank company defaults; provided configuration uses the established dotenv renderer and unsupported values reject before file creation without exposing secrets. The original setup branch and superseded #8908 history remain intact. Independent re-review/QA and final-head CI remain external merge gates; no merge is performed.

## 2026-11-12 resume

Goal: resolve current-base integration issues and all requested changes, then verify locally using disposable services and publish a PR QA report. Evidence: review 5803963165 identifies the credential-panel fixture missing the encryption-preflight stub; the user explicitly requested conflict reconciliation and ephemeral local QA. The merged-result fixture reproduces 15 passes / 1 EncryptionCompatibilityError failure before the change.

Runner: local; no configured Compose app container is running. Existing developer services remain untouched. Use an independent immutable install, the configured ordered gate, complete script suite, standalone setup regressions, and the committed disposable PostgreSQL test for tenant/Forms/Vault and no-mutation boundaries. This script/backend change has no browser-rendered UI.

### Phase 4: Review feedback and ephemeral QA

- [x] 4.1 Merge current main and repair the credential-display fixture without weakening encryption enforcement. — fa78b9014c, 49db4e79f2
- [ ] 4.2 Run configured validation, merged-result scripts and disposable PostgreSQL/standalone verification.
- [ ] 4.3 Complete authoritative re-review, publish QA evidence, update PR and release the claim.

Ephemeral QA found an additional in-scope defect: invoking the helper through a symlink skips both entrypoint branches and returns success without running proof or mutation. Reproduced on macOS /tmp -> /private/tmp and with an explicit symlink regression (old helper exit 0; fixed helper exit 78 for invalid config). Compare real paths in all mirrored helpers; cover rejection in both CLI modes and successful command execution through a linked installed-script directory. Crypto/PG suite now passes 17 tests, no skips.

Initial broad script run exposed host tooling gaps (BSD grep lacks -P, GNU timeout absent, Docker CLI cannot discover Compose under a temporary HOME) and load-sensitive fixture deadlines. Test-only PATH selects GNU grep/coreutils; DOCKER_COMPOSE_BIN selects Docker Desktop’s real standalone Compose binary. Re-run the identical script set with four concurrent files to avoid fixture deadline starvation; no workflow or application dependency changes.
