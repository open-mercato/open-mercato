# Standalone Harness Optimizations Execution Plan

Source doc: .ai/specs/2026-08-14-standalone-harness-optimizations.md
Spec PR: #5294
Run status: complete — the maintainer explicitly waived the platform-only Linux/Bubblewrap release lane; the lane was not executed.

## Goal

Make standalone-app harness runs resilient to interruption, enforce deterministic template quality gates, surface session stop causes, and provide bounded framework-contract context, while preserving existing runtime and public-contract behavior.

## Scope

- Harden scaffold template scripts and validation configuration for typecheck memory, design-system rules, and advisory hardcoded-string detection.
- Strengthen emitted spec-implementation skills with slice-level progress, reconciliation, and atomic edits.
- Add sanitized stop-cause extraction and reporting to session-share and judge flows.
- Add the bounded framework-contract guide and route emitted agent guidance to it.
- Add failure-first harness coverage, synchronized catalog/governance assets, upgrade notes, and focused create-app tests for every changed contract.

## Non-goals

- No runner-side provider retry or backoff implementation.
- No changes to application runtime APIs, database entities or migrations, module contracts, or rendered UI.
- No forced updates of user-owned standalone `.ai/agentic.config.json` files; existing apps adopt the template gate changes through upgrade notes.
- No expansion of the controller-owned `writable-ast-oracles.mjs` design-system policy beyond semantic parity with the emitted scaffold checker.

## Implementation Plan

### Phase 1: Template gate hardening

1. Extend typecheck memory parity and its create-app guard test.
2. Add the deterministic `ds-check.mjs` scanner with JSON output, justified ignore handling, fixture coverage, and rule-parity coverage.
3. Wire `ds:check` into the scaffold package scripts and emitted validation gate, keeping emitted AGENTS guidance within budget.
4. Add the advisory `i18n-check-hardcoded.mjs` scanner, script entry, opt-outs, allowlist behavior, and fixture coverage.
5. Add failure-first harness cases and complete the knowledge-change synchronization and validation for the template gates.
6. Document manual adoption for existing standalone apps in `UPGRADE_NOTES.md`.

### Phase 2: Session resilience contract

1. Add the per-slice ledger-write invariant and exact evidence format to `om-implement-spec` planning guidance.
2. Add typecheck-first resume reconciliation and link the contract from the standalone `om-auto-implement-spec` override.
3. Add the atomic paired-edit rule and failure-first harness knowledge coverage.

### Phase 3: Stop-cause reporting

1. Extract and sanitize additive `manifest.stopCause` evidence with deterministic classifications and unit fixtures.
2. Render stop-cause evidence in the session-share issue/report templates and update bundle snapshots.
3. Require termination classification in judge reports, retaining `unknown` compatibility for older bundles and covering provider-limit fixtures.

### Phase 4: Framework contract digest

1. Author the bounded framework-contract guide and add anti-rot tests for every documented installed source path.
2. Route shared-library contract questions through the guide before the bounded resolver while preserving the emitted AGENTS byte budget.
3. Complete failure-first routing coverage, source-link inventory synchronization, knowledge-change validation, and the full standalone harness release gate.

## Risks

- Design-system and i18n scanners can produce false positives; focused fixtures, explicit justified ignore files, stale-ignore detection, and advisory-only i18n severity constrain the risk.
- Harness catalog or knowledge-owner drift fails closed; each knowledge-contract phase updates the owner, cases, validators, counts, inventories, release matrix, and docs together and is validated through the machine manifest.
- The new emitted `AGENTS.md` routing can exceed the 12 KiB target; the byte-budget guard must remain green without increasing the target.
- Full standalone packed-artifact and release lanes are resource-intensive; failures are fixed and rerun, while genuinely unavailable containment or model capacity remains an explicit blocker rather than a pass.
- The share manifest change is additive and old bundles remain supported through an `unknown` fallback; no frozen backward-compatibility surface is changed.

## Progress

PR: #5295

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Template gate hardening

- [x] 1.1 Extend typecheck memory parity and its create-app guard test. — ac91a8e31
- [x] 1.2 Add the deterministic `ds-check.mjs` scanner with JSON output, justified ignore handling, fixture coverage, and rule-parity coverage. — ce8ead42e
- [x] 1.3 Wire `ds:check` into the scaffold package scripts and emitted validation gate, keeping emitted AGENTS guidance within budget. — 28972c058
- [x] 1.4 Add the advisory `i18n-check-hardcoded.mjs` scanner, script entry, opt-outs, allowlist behavior, and fixture coverage. — 9d6b4df9d
- [x] 1.5 Add failure-first harness cases and complete the knowledge-change synchronization and validation for the template gates. — c2e6307a9
- [x] 1.6 Document manual adoption for existing standalone apps in `UPGRADE_NOTES.md`. — 8cd9f1560

### Phase 2: Session resilience contract

- [x] 2.1 Add the per-slice ledger-write invariant and exact evidence format to `om-implement-spec` planning guidance. — de62619e8
- [x] 2.2 Add typecheck-first resume reconciliation and link the contract from the standalone `om-auto-implement-spec` override. — 5f47824e8
- [x] 2.3 Add the atomic paired-edit rule and failure-first harness knowledge coverage. — 256542f20

### Phase 3: Stop-cause reporting

- [x] 3.1 Extract and sanitize additive `manifest.stopCause` evidence with deterministic classifications and unit fixtures. — acf64c42a
- [x] 3.2 Render stop-cause evidence in the session-share issue/report templates and update bundle snapshots. — cb227ad20
- [x] 3.3 Require termination classification in judge reports, retaining `unknown` compatibility for older bundles and covering provider-limit fixtures. — 51537c236

### Phase 4: Framework contract digest

- [x] 4.1 Author the bounded framework-contract guide and add anti-rot tests for every documented installed source path. — f2aa7c0ba
- [x] 4.2 Route shared-library contract questions through the guide before the bounded resolver while preserving the emitted AGENTS byte budget. — 5831d55a7
- [x] 4.3 Complete failure-first routing coverage, source-link inventory synchronization, knowledge-change validation, and resolve the full standalone harness release gate. — routing/inventory/knowledge validation landed in c2e6307a9 and 2f3464072; the maintainer explicitly waived the Linux/Bubblewrap-only release lane on 2026-08-14, and this record does not claim that lane ran

## Harness Gate Evidence

- The full ordered repository gate passed: `build:packages`, `generate`, post-generate `build:packages`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `test`, and `build:app`.
- Final focused autofix tests passed 164/164; the full create-app suite passed 795 tests with 5 skips and no failures (800 total); create-app typecheck, root lint, and `template:sync` passed.
- `harness:validate-knowledge-change`: passed the controller-owned base-fails/head-passes proof against `origin/develop` at `089df848f`.
- Fresh emitted controller: deterministic `harness:validate --all` passed 231/231 cases with installed sources resolved inside the dependency root after removing the user-declined integration exit-gate case.
- Packed-artifact integration exercised Verdaccio publish/install, fresh generation, production builds, and ephemeral startup; the repository-wide Playwright tail reported 15 unrelated pre-existing module failures alongside 1,883 passes, 96 skips, and 3 flaky tests, with no changed-path regression.
- The final independent review approved `089df848f` with no actionable code findings after three autofix rounds.
- `release: maintainer-waived for PR #5295 (not run; native macOS sandbox-exec cannot provide the host-isolated loopback required by the complete release lane, and preflight stopped before target preparation, provider invocation, or writes)`.

## Continuation Evidence

- Merged `origin/develop` at `bd029a2bb` without rewriting history in `a4ff8254a`; the only textual conflict was `UPGRADE_NOTES.md`, resolved by retaining both this run's standalone-gate notes and #5293's sectioned fact-sheet migration notes.
- Semantic reconciliation preserved #5293's directory/index fact-sheet model, the resume/framework routing cases, framework-contract routing, stop-cause judge evidence, and #5298's Node-only instrumentation behavior.
- Post-merge review found one fresh-template regression: IPv6 `[::1]` literals were misclassified as arbitrary Tailwind. `c0fd435dc` fixed the shared matcher semantics and added a whole-template clean-baseline regression.
- Focused DS/oracle tests passed 38/38; the shipped template scan passed across 209 files with no findings, stale ignores, or errors; the full create-app suite passed 799 tests with 5 skips and no failures.
- The continuation knowledge-change manifest passed its controller-owned base-fails/head-passes proof against `a4ff8254a` for the evaluator/oracle contract affecting OMH-185 and OMH-193.
- Ordered local validation passed both `build:packages` runs, `generate`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, and `build:app`. Repeated exact `yarn test` attempts had no assertion failures but were interrupted by varying external macOS Jest-worker `SIGSEGV`s; every affected workspace/test passed in isolation, including core 1,236/1,236 suites, enterprise 59/59 suites, CLI 87/87 suites, and the final affected CLI test 20/20.
- The contained complete release lane still requires a Linux host whose nonce-bound Bubblewrap preflight succeeds. The maintainer explicitly waived this platform-only lane for PR #5295 on 2026-08-14; it was not run and is not represented as passing.
- Requester-directed scope reconciliation removed the proposed mandatory ephemeral integration exit gate from the spec, emitted spec-delivery owner, test-environment cross-reference, root instructions, catalog, source-link inventory, count snapshots, and execution plan while preserving the pre-existing general-purpose `test:integration:ephemeral` guidance and #5293's per-module fact-sheet layout.
- Repository ID-contiguity governance required the surviving framework-contract routing case to move from OMH-232 to OMH-231; the catalog now validates at 231 cases with 49 writable cases and no Phase-3-only links or active contract wording.
- Focused overlay/coverage/source-link/evaluator tests passed 204/204; root-instruction budget regression tests passed 25/25; the full create-app suite passed 800 tests with 5 skips and no failures (805 total).
- The scope-removal knowledge-change manifest passed its controller-owned base-with-test-fails/head-passes proof against `f0ad64582`; its source-link facts validated at 30 owners, 138 topics, 115 rendered links, 8 pinned assets, and 136 dispositions.
- Current ordered local validation passed both `build:packages` runs, `generate`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, and `build:app`. Two exact `yarn test` attempts and a package-serialized full graph encountered varying macOS Jest-worker `SIGSEGV`s in three untouched suites with no assertion failure; each crashed suite passed immediately in isolation (`AiChatSessions` 7/7, `storage-s3-routes` 5/5, `integration-discovery` 7/7), while the changed create-app suite remained fully green.
- Independent review approved the scope-removal implementation; its only minor finding was a stale spec/file-manifest claim about design-system oracle parity, corrected in the final documentation follow-up.
- `om-auto-fix-pr` merged `origin/develop` at `36b364cfd` without conflicts in `1aac9aeaf`, preserving the removed exit-gate scope and #5293 per-module fact-sheet layout. The maintainer's explicit Linux/Bubblewrap waiver closes the execution ledger without weakening or disabling the release command itself.
