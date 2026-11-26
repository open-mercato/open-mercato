# Stabilize main CI — 2026-11-25

## Goal
Verify the latest main baseline with the full CI suite and fix verified root causes on a single stabilization PR.

## Scope
Inspect main workflow failures, preserve full-suite selection for stabilization PRs and the ci-full label, and make the smallest evidenced fixes with regression coverage.

## Non-goals
No base-branch merge, release operations, test suppression, contract changes, or unrelated refactoring.

## Implementation Plan
### Phase 1: Diagnose and repair
1.1 Independently inspect recent main CI failures and identify actionable root causes.
1.2 Fix evidenced CI defects and verify regression coverage.
### Phase 2: Validate and review
2.1 Run the configured validation gate and the PR full suite; resolve failures until green.
2.2 Dispatch one final independent review, address findings, and apply automerge only after green evidence.

## Risks
No current CI defect was reproduced. Historical payment-menu focus failures are intermittent and pass on the latest baseline; no speculative application change is justified. Main Snapshot Release 45497186194 was still running at the audit checkpoint and is separate from PR CI. Runner: local; compose probes found no usable running app. The optional broad script attempt finished with 1,371 passed, 23 failed and 7 skipped: this worktree has no local dependency install or compiled Documents output, Docker buildx is unavailable, the inherited ancestor Hono differs from the pinned lockfile version, and the long cockpit temporary path prevents tsx IPC startup. These local results are not a green gate; the clean remote CI result is recorded separately. The focused rerun with TMPDIR=/tmp passed.

Engine: om-auto-create-pr (steps: 4, --loop: no)
Branch: stabilize/main-2026-11-25 (operator override).
Delegation: one read-only CI investigation and one final review; tightly coupled fixes stay in the parent worktree.

## Finalization gate

The [final independent review](https://github.com/open-mercato/open-mercato/pull/10579#pullrequestreview-6049807154) assessed `833e984101e5d3fb67d53a3b277f0e0ba7a08d64` as approve with no severity findings. GitHub rejected the App's self-approval; the submitted review is COMMENTED and grants no formal approval. The main ruleset still requires an approving review from another actor before merge. No merge is performed by this task.

This final progress update changes only the audit record. After pushing it, the parent will verify all workflows and reported checks for that exact final head, including all 15 integration shards and merged coverage. Only then will it apply the operator-requested `automerge` label and post the completion evidence on the PR. Checklist completion records finished investigation and review work; it does not certify a pending final-head run or claim the label has already been written. PR `Status` remains in-progress until that gate passes. No further repository changes are planned.

## Evidence

- Main baseline: `881743bf13d4409668e3e9f2ec5b4b0a14408f7d`.
- [Main CI 45497186129](https://github.com/open-mercato/open-mercato/actions/runs/45497186129): succeeded; 24 successful jobs, all 15 shards, audit scope-skipped.
- [Initial PR CI 45508075375](https://github.com/open-mercato/open-mercato/actions/runs/45508075375): succeeded on `b5f36b5b39`, all 15 shards and merged coverage. Final-head checks remain authoritative.
- Existing `FORCE_FULL_SUITE` in `.github/workflows/ci.yml` already covers trusted stabilization branches and `ci-full`; existing regression coverage passes.
- Independent investigation traced prior terminal failures to `TC-SALES-9594-scoped-payment-ui.spec.ts` focus/visibility timeouts. Main shard 12 job `138834475837` passes that test (6.7 seconds), with 276 passed and zero failed/flaky tests. These logs do not establish an unfixed production root cause.
- Earlier manual snapshot/package preview failures correctly rejected fork PRs; safeguards remain intact.
- Parent reran the investigator's 48 focused CI tests: all passed with `TMPDIR=/tmp`. The investigator branch has no tracked changes and requires no merge.
- Docs-only validation: manually reread the diff and run `git diff --check`; no docs lint command is configured. The eight configured build/generate/i18n/typecheck/test/app-build commands were not repeated locally for documentation; the PR full-suite CI supplies remote build and test evidence.
- No source, workflow, dependency, API, schema, or UI changes are needed for this verified baseline.

## Progress
PR: #10579

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair
- [x] 1.1 Independently inspect recent main CI failures and identify actionable root causes. — b5f36b5b39 (evidence above; no code defect requiring repair)
- [x] 1.2 Fix evidenced CI defects and verify regression coverage. — b5f36b5b39 (evidence above; no code defect requiring repair)

### Phase 2: Validate and review
- [x] 2.1 Run the configured validation gate and the PR full suite; resolve failures until green. — b5f36b5b39 (evidence above; no code defect requiring repair)
- [x] 2.2 Dispatch one final independent review, address findings, and apply automerge only after green evidence. — 833e984101 (independent approve assessment; no findings; automerge write remains gated on final-head CI below)
