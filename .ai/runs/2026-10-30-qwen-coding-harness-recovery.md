# Qwen coding harness recovery

## Goal
Explain every task from the stopped local Qwen 27B experiment, correct demonstrated shared harness defects in the fewest authoritative owners, and publish proposed fixes with honest before/after evidence.

Source doc: .ai/specs/2026-10-30-coding-harness-contract-recovery.md

## Scope and decisions
- Original experiment is stopped and frozen: 13 completed coding failures and one operator-interrupted task (OMH-060), plus four passing and one failing routing result. Pending tasks remain not run.
- Analyze OMH-009/011/012/014/026/027/029/031/042/045/049/054/057 individually; account for interrupted OMH-060 separately.
- Prefer shared bounded source/fixture delivery and contract-accurate semantic oracles. Primary runtime owners: existing evaluator, case catalog, writable AST oracle and fixture seed catalog. A demonstrated stale CLI-cache restoration additionally requires its exact external build-input declaration. Use existing source/example inventories; avoid one prose patch per failure.
- Keep actual typecheck, tenant safety, sandbox confinement, behavioral probes, pass definitions and first-attempt evidence. Do not convert invalid generated apps into passing results or raise budgets to hide unrelated reads.
- Fresh local Qwen/Pi validation uses disposable targets and separate result storage. The original stopped experiment and its scores stay frozen. The experimental transport is not an official runner or release certificate.
- No production dependency, public runtime API, scaffold mode or release/PR automation change. Supporting tests, documentation and derived inventories accompany the smallest proven owners.

## Implementation plan
1. Freeze evidence, write the 14-row analysis and implementation spec, and compare pinned contracts with the branch base.
2. Establish failure-first regressions, repair bounded context and exact seeded entrypoint delivery, then correct evidenced fixture/oracle contract mismatches.
3. Validate emitted/packed scaffolds, deterministic and knowledge gates; rerun affected cases on the same local model; run eligible generated-code and release gates with explicit platform limits.
4. Run configured repository validation, authoritative review/autofix and publish the same PR with per-case outcomes and next actions.

## Risks
- Denied canonical examples and missing seeded paths coexist with real model/API/type errors; oracle corrections alone cannot establish a valid implementation.
- An installed-context search count does not bound source bytes or instructional closure; keep QA-only, unrelated-source, unsafe-path and budget negatives.
- Local Pi uses an experimental existing-runner transport. Full certified release lanes require their supported runner/platform prerequisites; do not imply certification from local Qwen scores.
- macOS/Node 26 has a previously base-reproduced sandbox package-config denial in create-app tests. Full validation may remain blocked; record exact evidence instead of weakening confinement.
- Model reruns are nondeterministic and can fail after a valid harness fix. Report first-attempt outcomes and remaining model limitations without weakening graders.

## Progress

PR: #8262

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Evidence and contract
- [x] 1.1 Freeze and analyze every observed task and write the implementation spec. — 36230bca8

### Phase 2: Minimal shared fixes

Fail-before evidence: evaluator delivery tests 6 fail / 2 control pass (existing helpers exported without behavior changes); structural recovery tests 13 fail / 13 pass; source-policy tests 16 fail / 12 pass; typed fixture contract 1 fail. Failures are semantic assertions, with separate setup failures discarded. Source-policy tests use actual source generators/inventories so disposable controller worktrees need no ignored build cache.
- [x] 2.1 Add semantic regressions that fail before the fixes. — bb271631e
- [x] 2.2 Repair bounded reference delivery and explicit seeded entrypoint prompts. — ebe878abf
- [x] 2.3 Align fixtures and structural oracles with real executable contracts. — bdb4530d8

Coding context tests: 13 pass, including all 49 writable seed declarations and protected resume fixture. Source-policy tests: 30 pass, including real MCP trace accounting and actual installed adapter/descriptor preparation.

Structural and typed-seed validation initially passed 65 tests. Review added malformed-output exit classification, exact example entrypoint disclosure and bound React callback regressions. The full read-policy sync suite passes 66 tests; separate example bounds cover the complete declared surface without raising writable routing budgets. Real typecheck/behavior gates remain unchanged.

### Phase 3: Evaluation evidence
- Cached-delivery regression: normal builds restored legacy CLI harness assets despite corrected source. `f40d9e798` declares the copied inputs; two real Turbo tests fail before and pass afterward, retaining unchanged-input cache hits. Source/create-app/CLI parity passes through normal cached builds.
- Explicit grounding: `0692dbed2` supplies declared instruction-to-source links and the immutable baseline app's actual test script. Coding context tests pass 29/29; the combined focused suites pass 351 tests. Read-only prompt bytes and sandbox grants stay unchanged.
- Round 1 is stopped and preserved: five completed full-case failures, one implementation-oracle pass (OMH-011), OMH-027 operator-interrupted, eight pending. A local transport parser missed a valid prefixed multiline JSON response in OMH-026 and unnecessarily triggered one correction; no old score is changed. The separate Round 2 parser passes 11/11 synthetic controls.
- [x] 3.1 Verify deterministic, emitted/packed scaffold and knowledge-change gates. — 0692dbed2

Fresh independent registry controller: 43 archive integrities, five authority hashes across seven source/emitted/installed surfaces, generation and baseline typecheck pass. Selected deterministic, broken-before oracle and actual writable prompt/framework preparation checks each cover 14/14. Knowledge controller v3 passes five true-base/fixed pairs. Full deterministic catalog remains 236/240 with four unchanged out-of-scope baseline budget deficits, explicitly retained in the analysis.
- [ ] 3.2 Rerun affected tasks on local Qwen in fresh disposable targets.
- [ ] 3.3 Run eligible generated-code checks, judge and release lanes.

### Phase 4: Publication
- [ ] 4.1 Run ordered repository validation and resolve relevant failures.
- [ ] 4.2 Complete authoritative review and fixes.
- [ ] 4.3 Publish the per-case evidence and PR handoff.
