# Execution plan — refresh mutation previews while retaining completed-request dedupe (adopted from PR #7756)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-25 because PR #7756 carried no execution plan.
**PR:** #7756 · **Branch:** `fix/issue-7731-stale-mutation-preview` · **Base:** `main`
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

- [ ] 2.1 Merge main and preserve fresh pending previews plus confirmed/executing deduplication with regression tests.
- [ ] 2.2 Run focused validation, the post-merge lessons validator and code review; publish evidence and request rereview.
