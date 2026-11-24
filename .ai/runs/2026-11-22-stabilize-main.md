# Stabilize main CI — 2026-11-22

## Goal
Verify main CI and correct demonstrated root causes on one stabilization PR into main.

## Scope
Inspect current main CI and release failures, preserve full-suite selection for stabilization branches and ci-full, fix only reproducible failures, and obtain an independent final review before applying automerge after all PR checks pass.

## Non-goals
No base-branch merge, weakening tests, unrelated product changes, dependency additions, or external official-module pointer changes.

## Implementation Plan
### Phase 1: Diagnosis and stabilization
1.1 Audit current main failures and full-suite coverage; delegate read-only snapshot diagnosis.
1.2 Implement demonstrated root-cause fixes with focused regression coverage, or document verified existing fixes when main is already green.
### Phase 2: Verification and review
2.1 Run the configured validation gate in order and the PR full suite; fix failures until green.
2.2 Dispatch one final independent review of the completed branch and address actionable findings.
2.3 Publish evidence, mark ready, and apply automerge only after verified green checks.

## Risks
Main run 44992812572 at 9b4d23d72d passed all 15 integration shards but failed the script gate: the lesson catalog declares 196 records while it indexes 197. Correct the metadata without relaxing the validator. Historical snapshot 44911867595 also exposed a false HTTP-status assertion when a version hash contained `403`; the preserved fix has ten regression cases. Local installation reports optional native-build warnings. Preserve the independent NPM preview approval guard; its historical failure is an operational approval issue, not a reason to publish or weaken the guard.

## Resume evidence
Run ee871019-6028-4fa6-bfee-738691b64bbe resumed PR #10286 after the operator requested autonomous continuation. The cockpit confirms prior run 3d778c8a-300a-4459-a976-ec0b54305c89 and its child finished, and its worktree was removed. Recovered abandoned lock SHA 363aaa36f24a218190ba83d986d110429e2159cb using an exact-SHA lease and acquired a new atomic lock. Preserve the original plan and autosaved fix rather than opening a duplicate PR.

Runner: local (no running compose app). Ten focused snapshot-status Jest cases, 48 CI workflow script cases and five catalog-checker cases pass. The catalog check reproduced the failure before the metadata correction. The configured eight-command validation sequence is running in order with `TMPDIR=/tmp` to avoid the cockpit temporary directory's Unix socket path limit; normal hooks remain enabled.

Run 2cca8c48-78e5-431a-8750-b465fea6b068 continues this same PR after explicit operator instruction to finish autonomously. Cockpit verifies previous owner ee871019 and its child are stopped. The abandoned exact-SHA claim was recovered under the force-recovery procedure, documented on the PR; no active work was displaced.

Current main 1092d0207f also failed integration shard 12 in [run 45030852346](https://github.com/open-mercato/open-mercato/actions/runs/45030852346/job/137244259795). Read-only trace analysis found TC-SALES-9594 opened its payment menu before organization-switcher initialization completed; the ensuing scope render closed the menu. The same test passed in the earlier PR run with unchanged application code. Await the unique fixture organization's ready button in each locale before payment interaction, preserving every keyboard, translation, tenant-isolation, permission and stale-write assertion — e062f75b19.

The first local unit gate reached a cockpit-only Unix socket path limit because Turbo stripped the short TMPDIR override. The affected bootstrap tests pass with TMPDIR, TMP and TEMP set to /tmp and TURBO_ENV_MODE=loose; repeat the full unit gate with these environment settings. No application or test infrastructure change is required for this local environment issue.

## Delegation
Subtask 1: read-only audit 491d4717 completed; its report and CI trace evidence were checked against the source. Its branch has no changes to merge. The previous run's completed snapshot diagnosis is retained as evidence.
Subtask 2: final independent review after implementation and validation; read-only, no merging.
Coupled implementation, regression tests, PR state, and validation remain in the parent.

## Progress
PR: #10286

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnosis and stabilization

- [x] 1.1 Audit current main failures and full-suite coverage — 4e46de0e3b
- [x] 1.2 Implement demonstrated root-cause fixes with focused regression coverage — a76908d5d4, 4e46de0e3b

### Phase 2: Verification and review

- [ ] 2.1 Run configured validation and PR full suite
- [ ] 2.2 Obtain final independent review and address findings
- [ ] 2.3 Publish evidence and apply automerge after green checks
