# Standalone Harness Optimizations Execution Plan

Source doc: .ai/specs/2026-08-14-standalone-harness-optimizations.md
Spec PR: #5294

## Goal

Make standalone-app harness runs resilient to interruption, enforce deterministic template quality gates, surface session stop causes, and provide bounded framework-contract context, while preserving existing runtime and public-contract behavior.

## Scope

- Harden scaffold template scripts and validation configuration for typecheck memory, design-system rules, and advisory hardcoded-string detection.
- Strengthen emitted spec-implementation skills with slice-level progress, reconciliation, atomic edits, and an ephemeral integration exit lane.
- Add sanitized stop-cause extraction and reporting to session-share and judge flows.
- Add the bounded framework-contract guide and route emitted agent guidance to it.
- Add failure-first harness coverage, synchronized catalog/governance assets, upgrade notes, and focused create-app tests for every changed contract.

## Non-goals

- No runner-side provider retry or backoff implementation.
- No changes to application runtime APIs, database entities or migrations, module contracts, or rendered UI.
- No forced updates of user-owned standalone `.ai/agentic.config.json` files; existing apps adopt the template gate changes through upgrade notes.
- No changes to the controller-owned `writable-ast-oracles.mjs` design-system policy implementation.

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

### Phase 3: Ephemeral integration exit gate

1. Require the final spec phase to write and run declared integration coverage through `test:integration:ephemeral`, or record an explicit blocked ledger entry.
2. Cross-reference the exit-gate contract from `om-prepare-test-env` and emitted integration guidance, with synchronized knowledge validation.

### Phase 4: Stop-cause reporting

1. Extract and sanitize additive `manifest.stopCause` evidence with deterministic classifications and unit fixtures.
2. Render stop-cause evidence in the session-share issue/report templates and update bundle snapshots.
3. Require termination classification in judge reports, retaining `unknown` compatibility for older bundles and covering provider-limit fixtures.

### Phase 5: Framework contract digest

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

### Phase 3: Ephemeral integration exit gate

- [x] 3.1 Require the final spec phase to write and run declared integration coverage through `test:integration:ephemeral`, or record an explicit blocked ledger entry. — fd4975231
- [x] 3.2 Cross-reference the exit-gate contract from `om-prepare-test-env` and emitted integration guidance, with synchronized knowledge validation. — eeaca0f28

### Phase 4: Stop-cause reporting

- [x] 4.1 Extract and sanitize additive `manifest.stopCause` evidence with deterministic classifications and unit fixtures. — acf64c42a
- [x] 4.2 Render stop-cause evidence in the session-share issue/report templates and update bundle snapshots. — cb227ad20
- [x] 4.3 Require termination classification in judge reports, retaining `unknown` compatibility for older bundles and covering provider-limit fixtures. — 51537c236

### Phase 5: Framework contract digest

- [x] 5.1 Author the bounded framework-contract guide and add anti-rot tests for every documented installed source path. — f2aa7c0ba
- [x] 5.2 Route shared-library contract questions through the guide before the bounded resolver while preserving the emitted AGENTS byte budget. — 5831d55a7
- [x] 5.3 Complete failure-first routing coverage, source-link inventory synchronization, knowledge-change validation, and the full standalone harness release gate. — c2e6307a9, 2f3464072

## Harness Gate Evidence

- `harness:validate-knowledge-change`: passed the controller-owned base-fails/head-passes proof against `origin/develop`.
- Fresh emitted controller: deterministic `harness:validate --all` passed 232/232 cases with installed sources resolved inside the dependency root.
- `integration: blocked (the packed-artifact Verdaccio lane completed publish/install, fresh generation, production builds, and ephemeral startup, then the repository-wide Playwright suite reported 15 unrelated pre-existing module failures; 1,883 passed, 96 skipped, 3 flaky)`.
- `release: blocked (native macOS sandbox-exec cannot provide the host-isolated loopback required by the complete release lane; preflight stopped before target preparation, provider invocation, or writes and requires Linux Bubblewrap)`.
