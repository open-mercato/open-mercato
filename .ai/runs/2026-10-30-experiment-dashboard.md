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
- Whole-repository checks may expose unrelated baseline/environment failures; retain exact evidence and keep the PR draft if required checks cannot complete.

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

- [ ] 4.1 Document producer integration and update eval/harness skills.
- [ ] 4.2 Run applicable skill and knowledge-change checks.

### Phase 5: Publication

- [ ] 5.1 Run the ordered validation gate and resolve relevant failures.
- [ ] 5.2 Complete authoritative automated review and fixes.
- [ ] 5.3 Publish the final PR evidence and handoff.
