# Stabilize main CI — 2026-11-21

## Goal
Deliver a reviewed stabilization PR into main with the full 15-shard CI suite green, then apply automerge.

## Scope
Inspect current and recent main CI failures, reproduce the remaining root causes, and make minimal fixes on `stabilize/main-2026-11-21` from main a2b3e8bbaebe9cacb5bcab2d10a7c19a53a6878e. The workflow already supports ci-full and stabilize branches; preserve that behavior.

## Non-goals
No direct main changes, merging, unrelated feature work, weakened tests, migrations, dependencies, or QA-policy changes.

## Implementation Plan
### Phase 1: Diagnose and repair
1.1 Audit current/historical failures and apply minimal root-cause fixes with regression coverage.
### Phase 2: Verify
2.1 Run the configured ordered validation gate and full PR CI, repairing failures until green.
### Phase 3: Review and finalize
3.1 Dispatch one final independent cezar review task; validate its verdict and address findings.
3.2 Publish evidence, complete the plan, promote the draft, and apply automerge only with green CI.

## Dispatch plan
Use at most two subtasks: one read-only historical CI audit (no edits), then one final branch review. Reproduction and implementation are coupled and remain in the parent.

## Validation
Runner selected after prescribed Docker probe. Gate: build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, test, build:app. CI must include all 15 shards for the exact PR head. Preserve failures and limits in PR evidence.

## Risks
Main can advance independently of the stabilization PR. Do not claim green from partial or stale checks. Final documentation commits need fresh exact-head CI evidence.

## Investigation outcome

The eight latest failed main CI runs were audited read-only. Their causes already have corrective commits on this branch's base; no additional source or workflow changes are justified. The workflow already forces all 15 shards for same-repository `stabilize/` branches and PRs carrying `ci-full`.

| Historical failure | Existing correction | Recovery evidence |
| --- | --- | --- |
| [44760649587](https://github.com/open-mercato/open-mercato/actions/runs/44760649587): lesson catalog declared count drift | `7d79c51b14` (#10150) | Repository lesson catalog test passes in both green runs below. |
| [44492039926](https://github.com/open-mercato/open-mercato/actions/runs/44492039926): payment reference test used an obsolete actions menu | `f0cdbcc7e6` (#9867), open the payment through its row | TC-SALES-PRECISION-003 passes in shard 12 of both green runs. |
| [44456099969](https://github.com/open-mercato/open-mercato/actions/runs/44456099969), 44456075080, 44432002603, 44427141963, 44409579981: role validation test selected the wrong localized discard action | `59f204debc` (#9715) | Both TC-AUTH-8700 locales pass in shard 3 of both green runs. |
| 44409579981: recent-preset test timed out; fixture/browser authentication mismatch inferred from the corrective diff | `f0cdbcc7e6` (#9867), shared CRM authentication | TC-CRM-recently-created-preset passes in shard 7 of both green runs. |
| [44334863912](https://github.com/open-mercato/open-mercato/actions/runs/44334863912): attachment fixtures lacked routing provenance and conversation lookup mocks | `7d4003fb64` (#9729) | Attachment suites pass in both green runs. |
| 44334863912: search route handler cleanup raced an active handler | `7ae5c1ed59` (#9825), drain handlers before teardown | TC-SEARCH-015 passes in shard 15 of both green runs. |

## Verification evidence

- [PR baseline run 44835359495](https://github.com/open-mercato/open-mercato/actions/runs/44835359495), head `df3289ac1d7c34cda56e93eceaa9495ce3aa1c85`: completed successfully; all 15 integration shards, prepare, test, lint, DS lint, timezone, Docker, multi-instance documents, and merged coverage passed. Dependency audit was legitimately skipped because the PR changed no dependency files.
- [Completed main run 44873604853](https://github.com/open-mercato/open-mercato/actions/runs/44873604853), head `9dfc601f309d6fcc8edadcfbbeb07a936f4a36ef`: all 25 jobs passed, including the dependency audit and all 15 shards.
- Main subsequently advanced to `a4e729a75719411c6d057c0be3a5da572a0aa1bb`. Its [run 44879503155](https://github.com/open-mercato/open-mercato/actions/runs/44879503155) was pending at audit completion; this is not evidence of success or failure.
- Main's successful shard 15 retried TC-AGENT-UXC-001 trace-refresh visibility once. The retry passed; no final test failure remains. This observation does not justify weakening assertions or increasing timeouts.
- Runner: local after the prescribed Docker probe found no running app container. This PR changes only this execution record. The docs-only gate exemption applies: manual diff review and `git diff --check` pass; no docs lint command is configured. The eight configured build/generate/i18n/typecheck/test commands were not rerun locally. Their remote CI equivalents passed in the PR baseline, with build and test steps inspected individually.
- Read-only audit task `b3f02dab-fbdf-4912-b70c-a23233eb87ae` made no commits. Its report was checked against the historical lesson failure log, corrective commits, and exact-head job results. No child branch was merged.
- Final independent review and exact-head CI evidence will be published on PR #10200 before applying `automerge`.

## Independent review

Task `92d8a975-29e9-4ace-9b41-1bd127520969` reviewed committed tip `507a95c618caedbba515859bc97e83de731bb9a4` and returned **APPROVE**, with no findings. It independently checked the failed logs, corrective commit ancestry, and named recovery passes. Manual factual review and `git diff --check` passed under the docs-only validation exemption. The full report is published on PR #10200; the authoring App cannot submit a GitHub approving review on its own PR.

The newer main run 44879503155 subsequently completed successfully with all 15 shards. Final tracker-only actions in step 3.2 will be recorded in the PR outcome comment after exact-head CI succeeds. Keeping that final result on the PR avoids changing the tested branch head solely to record the result.

## Progress

PR: #10200

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Audit current/historical failures and apply minimal root-cause fixes with regression coverage. — df3289ac1d (audit complete; existing corrections verified, no new source fix required)

### Phase 2: Verify

- [x] 2.1 Run the configured ordered validation gate and full PR CI, repairing failures until green. — df3289ac1d (docs-only local gate; full 15-shard PR baseline passed; final-head CI remains a finalization gate)

### Phase 3: Review and finalize

- [x] 3.1 Dispatch one final independent cezar review task; validate its verdict and address findings. — 507a95c618 (independent APPROVE, no findings)
- [ ] 3.2 Publish evidence, complete the plan, promote the draft, and apply automerge only with green CI.
