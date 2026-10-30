# Qwen coding harness recovery

## Goal
Explain every task from the stopped local Qwen 27B experiment, correct demonstrated shared harness defects in the fewest authoritative owners, and publish proposed fixes with honest before/after evidence.

## Scope and decisions
- Original experiment is stopped and frozen: 13 completed coding failures and one operator-interrupted task (OMH-060), plus four passing and one failing routing result. Pending tasks remain not run.
- Analyze OMH-009/011/012/014/026/027/029/031/042/045/049/054/057 individually; account for interrupted OMH-060 separately.
- Prefer shared bounded source/fixture delivery and contract-accurate semantic oracles. Anticipated primary owners: existing evaluator, case catalog, writable AST oracle and fixture seed catalog. Use existing source/example inventories; avoid one prose patch per failure.
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

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Evidence and contract
- [ ] 1.1 Freeze and analyze every observed task and write the implementation spec.

### Phase 2: Minimal shared fixes
- [ ] 2.1 Add semantic regressions that fail before the fixes.
- [ ] 2.2 Repair bounded reference delivery and explicit seeded entrypoint prompts.
- [ ] 2.3 Align fixtures and structural oracles with real executable contracts.

### Phase 3: Evaluation evidence
- [ ] 3.1 Verify deterministic, emitted/packed scaffold and knowledge-change gates.
- [ ] 3.2 Rerun affected tasks on local Qwen in fresh disposable targets.
- [ ] 3.3 Run eligible generated-code checks, judge and release lanes.

### Phase 4: Publication
- [ ] 4.1 Run ordered repository validation and resolve relevant failures.
- [ ] 4.2 Complete authoritative review and fixes.
- [ ] 4.3 Publish the per-case evidence and PR handoff.
