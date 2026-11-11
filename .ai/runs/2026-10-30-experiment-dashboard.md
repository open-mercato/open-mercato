# Reusable experiment dashboard

## Goal
Ship a React dashboard for inspecting any explicitly registered local experiment, live progress, responses, generated files and evaluator outcomes, with a reusable producer contract and documented harness workflows.

Source doc: .ai/specs/2026-10-30-experiment-dashboard.md

## Scope and decisions
- Repository-owned tool in `scripts/experiment-dashboard/`, launched with `yarn experiments:dashboard`; existing React, React DOM, esbuild and test tooling only.
- Multiple experiment directories, arbitrary experiment/case/lane IDs and dynamic totals. Versioned generic snapshots plus read-only adapters for official harness results and existing summary reports.
- Loopback-only, read-only server; explicit registration, bounded validated JSON/artifacts, symlink/path/credential safeguards. Captured visible output is inert text; missing prose stays unavailable.
- React overview, experiment selector, live progress/activity, filters and case response/code/evaluation views. Reuse existing tokens/primitives where appropriate.
- Update repo-owned eval-running and harness-development skills. Keep current local Qwen experiment running and exclude its outputs, credentials, machine paths and private runtime wrappers from commits.
- Existing evaluator, oracle, result schemas, certification requirements and release/PR automation remain unchanged. The dashboard observes experiments; it does not start or alter agent runs.

## Implementation plan
1. Specify the producer/API contracts and establish regression coverage before implementation.
2. Implement validated adapters and bounded read-only loopback serving with root CLI integration.
3. Build the reusable React experience and exercise live updates and artifact inspection in a browser.
4. Add operator/developer documentation and skills, including applicable knowledge-change evidence.
5. Run configured checks, authoritative PR review and publish the same PR with verified limits.

## Risks
- Stored agent output is untrusted; never execute it or treat generated source as HTML.
- A result directory cannot establish process liveness or missing responses; require explicit live snapshots and mark unavailable data.
- Skill changes may require the harness knowledge-change gate and certified Linux lanes. Any unavailable gate remains a documented blocker, never a claimed pass.
- Whole-repository checks expose a macOS/Node 26 sandbox package-config denial: the full retry fails 13 create-app harness tests, with a representative failure reproduced at the pinned base using the same dependencies and unchanged built assets. Keep the PR draft until the full gate passes; do not weaken sandbox or grading rules.

## Progress

PR: #8259

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Contract and regression

- [x] 1.1 Write implementation spec and failing contract/security tests. — f8f3add95

### Phase 2: Reusable server

- [x] 2.1 Implement generic and existing-result adapters with derived totals. — a22e37130
- [x] 2.2 Implement safe loopback APIs, artifact access and CLI/build integration. — a22e37130

### Phase 3: React dashboard

Local runner: package build, 21 focused tests, strict tooling typecheck and the standalone real-browser integration passed. Browser proof uses synthetic experiments; live producer updates preserve filters, the active tab and selected generated file. Open Mercato logo and app chrome are verified.

- [x] 3.1 Build experiment overview and live progress/filtering and measured token throughput. — d991c8376
- [x] 3.2 Build response, generated-file and evaluator detail views. — d991c8376
- [x] 3.3 Verify browser interactions and producer updates with evidence. — d991c8376

### Phase 4: Workflow knowledge

Skill tiers/discovery, local-only installation, frontmatter/pointers, template exercises and inspect-only invocation passed. The knowledge controller passed at final tool code 089041133 against a11f57298: both focused files failed with base-plus-test-only (exit 1) and passed on head (exit 0); authoritative hashes were rechecked. A fresh current scaffold deterministic check passed 236/240: existing context ceilings fail for OMH-008 (45,340/45,056 bytes), OMH-082/153/155 (69,669/69,632). Emitted harness/template/CLI sources are unchanged from the base. This is a validation limit, not a passing release gate.

Post-implementation regression: stable path-based file identities preserve the selected file when producers insert or reorder generated files; failure-first coverage and all 22 focused tests pass. — c059d48f9

- [x] 4.1 Document producer integration and update eval/harness skills. — 89001eb29
- [x] 4.2 Run applicable skill and knowledge-change checks. — c059d48f9

### Phase 5: Publication

Runner: local. Ordered package build, generation, package rebuild, translation sync/usage, repository typecheck and production app build passed. The initial full test run hit one unchanged CrudForm timing assertion; its isolated retry and all 302 UI suites pass. The full retry finishes 50/51 Turbo tasks but fails 13 create-app harness tests (968 pass, 13 fail, 5 skipped), with a macOS/Node 26 parent package-config read denial before the fake runner executes. A representative test reproduces that denial at base a11f57298 with the same dependency tree and unchanged emitted assets. Step 5.1 remains open; resume with `om-auto-continue-pr 8259` in a compatible environment or after the baseline blocker is resolved.

Authoritative review fixed inherited-property lane IDs, mixed target-count notices and live TPS expiry while offline. Screenshot feedback then refined tabs, count badges, controls, normal capture copy and response typography. Re-review at 089041133 found no remaining verified dashboard defect. Final targeted evidence: 23 focused tests, strict tool typecheck, 3 real-Chrome integrations and the knowledge controller pass; all 26 authoritative source hashes were rechecked. GitHub rejected author self-review, so independent approval and manual QA remain required. No further CI monitoring is scheduled by this run.

Evidence: [verification and synthetic screenshots](https://github.com/open-mercato/open-mercato/pull/8259#issuecomment-6523096680), [review](https://github.com/open-mercato/open-mercato/pull/8259#issuecomment-6523317962), [handoff](https://github.com/open-mercato/open-mercato/pull/8259#issuecomment-6523799894).

- [ ] 5.1 Run the ordered validation gate and resolve relevant failures.
- [x] 5.2 Complete authoritative automated review and fixes. — 089041133
- [x] 5.3 Publish the final PR evidence and handoff. — de1657f1b
