# Execution plan — restore CI coverage for explicit notification channel eligibility (adopted from PR #5542)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-24 because PR #5542 carried no execution plan.
**PR:** #5542 · **Branch:** `fix/issue-5495-explicit-notification-channels` · **Base:** `develop`
**Author:** @haxiorz — this plan interprets the PR's stated intent and the failing CI evidence.

## 🎯 Goal

Keep the explicit built-in notification channel policy enforced across packages while ensuring the repository-wide test always runs under CI's package filtering.

## Scope

- Preserve the notification eligibility implementation and its catalogue-wide regression test already landed on the PR.
- Register the cross-package regression in the repository-wide guard runner required by CI.
- Re-run targeted checks, the configured validation gate, and the PR review gate before pushing the final state.

## Non-goals

- Do not change notification delivery semantics beyond the policy already implemented by PR #5542.
- Do not alter CI workflow definitions or Turbo filtering behavior.
- Do not add UI, API, database, or migration changes.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Built-in notification types must opt into their supported channels. | PR #5542 description, issue #5495, and the existing branch diff. | high |
| The regression test must run outside package filtering because it reads notification files across packages. | Failed `test` job 97284598065 and `scripts/__tests__/repo-wide-guards.test.mjs`. | high |
| Adding the test to `REPO_WIDE_GUARDS` is the intended remediation. | The CI assertion's failure message and the existing registry contract in `scripts/repo-wide-guards.mjs`. | high |

## External References

- Issue #5495: https://github.com/open-mercato/open-mercato/issues/5495 — adopted as the behavioral goal.
- Failed CI job: https://github.com/open-mercato/open-mercato/actions/runs/32675946911/job/97284598065 — adopted as the remediation evidence.

## Assumptions

- The new regression belongs in `REPO_WIDE_GUARDS`, not `CROSS_PACKAGE_EXCEPTIONS`, because CI must enforce the catalogue policy whenever any referenced package changes.
- The upstream branch remains compatible with the existing notification change; the PR was mergeable when this continuation began.

## Risks

- An incorrect guard command could make CI appear green while skipping the policy test; targeted execution of the exact registered command mitigates this.
- The goal is directly stated by the PR and issue, so no low-confidence product assumptions are required.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Declare explicit built-in notification channels and add catalogue-wide regression coverage — 07cb37e4c

### Phase 2: Restore and verify CI coverage

- [ ] 2.1 Register the cross-package notification policy test as a repo-wide guard, run the targeted and full validation gates, complete review, and push the verified fix
