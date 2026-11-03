# Execution plan — refresh mutation previews while retaining completed-request dedupe (adopted from PR #7756)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-25 because PR #7756 carried no execution plan.
**PR:** #8575 · **Branch:** `carry/pr-7756-020f` · **Base:** `main`
**Author:** @haxiorz

## Goal

Retry stale pending approvals with current previews while repeated confirmed/executing mutations still reuse their prior action within its TTL.

## Scope

AI assistant mutation preparation, pending-action repository, focused regressions, and review handoff.

## Non-goals

No API, schema, approval state-machine, policy, dependency, or QA workflow changes. Do not merge the PR.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Pending approvals must refresh after record changes | PR #7756 and issue #7731 | high |
| Merge main and retain #7630 dedupe despite changed snapshots | wojciechszyjka review 5643497392 | high |
| Live single/bulk and already-executed flows still require QA | Review and existing needs-qa label | high |

## Assumptions

A request remains identical across preview changes when its scoped agent, conversation, tool and arguments are identical. Existing TTL rules apply.

## Risks

The main risk is repeating a completed mutation or retaining a stale pending preview. Cover both through real preparation/repository call sites.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Refresh identical requests after record changes with preview-aware deduplication — 5e8bb59a3

### Phase 2: Review remediation

- [x] 2.1 Merge main and preserve fresh pending previews plus confirmed/executing deduplication with regression tests. — e893cd89d
- [x] 2.2 Run focused validation, the post-merge lessons validator and code review; publish evidence and request rereview. — e893cd89d

## Verification and handoff

Runner: local, focused fallback for the new correction under the repository CI-first override.

- Preparation, repository and stale-version recheck suites: 61 tests pass.
- New single/bulk confirmed/executing regressions: 4 fail before the correction, 4 pass with it.
- Post-merge lessons tests: 5/5 pass; catalog checker and diff checks pass.
- Review found no additional actionable code findings. Public API, schema, TTL, scoping and confirmation semantics remain intact.
- Evidence: https://github.com/open-mercato/open-mercato/pull/7756#issuecomment-6399371225
- Rereview requested from wojciechszyjka. Preserve changes-requested and needs-qa; full CI and live QA remain external merge gates.

## Carry-forward — 2026-11-03

Carried forward from #7756 by `om-auto-review-pr` autofix, preserving @haxiorz authorship. Current main `fca667374c88b5bd5cbed5cbfd68da86db583389` integrated cleanly. No production conflict resolution was needed; owner scopes, argument-based request identity, confirmed/executing TTL reuse, encryption and confirmation rechecks remain unchanged.

Runner: local, narrow fallback before the new candidate had hosted checks. Preparation/repository/recheck suites: 73 tests passed; AI-assistant package build and target-relative whitespace check passed. Fresh hosted CI and legitimate live single/bulk stale-preview and already-executed QA remain the orchestrator’s next gates. Historical NOT EXERCISED browser QA is not approval.
