# Stabilize main — scheduled 08:00 run

## Goal
Repair current main workflow failures and verify a full-suite draft PR before independent review and the `automerge` label.

## Scope
Main `a0ebde7427` passes CI run 43676273536, including all 15 integration shards. Snapshot run 43676273517 fails when Yarn fetches the just-published core tarball (HTTP 404); its existing retry helper retries quarantine responses only. Investigate the publishing/install boundary and repair the demonstrated cause with regression tests. Existing trusted `stabilize/*` and `ci-full` support already forces full integration, unit and type checks.

Branch: `stabilize/main-2026-11-15-0800`, from `origin/main`. The original dated branch already merged through PR #9558, so preserve its local history and use this scheduled-run suffix.

Non-goals: publish packages, change production, merge to main, weaken assertions, bypass QA, change unrelated modules or overwrite prior stabilization work.

## Implementation Plan

### Phase 1: Diagnose and repair
1.1 Dispatch a read-only independent audit of the snapshot failure and validate its evidence.
1.2 Repair the demonstrated root cause and add focused regression coverage.

### Phase 2: Validate
2.1 Run focused checks and the configured ordered validation gate; document real environment blockers.
2.2 Run the PR full suite and repair demonstrated failures until current-head CI is green.

### Phase 3: Review and hand off
3.1 Dispatch one final review using om-auto-review-pr, validate its evidence and resolve actionable findings.
3.2 Publish evidence, promote the green reviewed PR and apply automerge; release the owned claim.

## Audit evidence
Independent audit f71bf489 verified successful core publication at 05:06:56Z, metadata readiness at 05:20:36Z, and exact tarball HTTP404 at 05:20:49Z. A later actual GET returns the published SHA1 `942aaaa7db1f9f88717b16c78df3dc7d903d224a`, proving eventual availability. Public evidence cannot distinguish npm scanning from CDN propagation internally. Parent independently verified publish logs and later HTTP200. No child diff exists against its baseline; nothing was merged. Expanded focused checks: 51 pass, including exact-version/registry restrictions, mixed HTTP errors and bounded retries.

## Final review
Independent final review 0fc50825 approved implementation head `6b35aa19d24a335f7a4f7ecc4de8db8c1eb85fed` with zero findings. [Authoritative evidence](https://github.com/open-mercato/open-mercato/pull/9588#issuecomment-6891137350). GitHub rejected native self-approval under the shared bot identity; no native approval is claimed. Reviewer source remained unchanged and the parent verified zero child diff. Final current-head CI still gates readiness and automerge.

## Risks
Registry propagation is external and cannot be deterministically reproduced with live npm. Use controlled command fixtures and exact observed failure logs. Snapshot publishing runs only on main; prove the repair without publishing from this PR. Additional failures may widen the necessary repair.

## Execution
Local ordered gate passed its first six commands. Initial `yarn test` failed only in subprocess tsx IPC because strict Turbo omitted TMPDIR; retry with `TURBO_ENV_MODE=loose TMPDIR=/tmp`. Remote full CI is independent of this cockpit path issue.
Runner: local (compose probes found no running app). Immutable install completed. Use `TMPDIR=/tmp` for tsx IPC on this host. Regression baseline: three new assertions fail before the repair; focused snapshot metadata/retry and CI scope/concurrency checks: 44 passed.
Claim-Run: 36ad2f91-5589-4e68-9574-969a2f4c3bf9
Claim-Lock-SHA: 44981e56f93b92a06f2969afc22f9076f7390776
Claim-Comment: 6890899073
Engine: om-auto-create-pr (steps: 6, --loop: no)
Reuse the invoking isolated worktree. Parent owns coupled implementation and validation. At most two dispatched tasks: read-only diagnosis and final review. Do not merge unreviewed child changes.

## Progress
PR: #9588

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Dispatch a read-only independent audit of the snapshot failure and validate its evidence — 989da5011b (read-only audit f71bf489 validated; no child changes)
- [x] 1.2 Repair the demonstrated root cause and add focused regression coverage — 989da5011b

### Phase 2: Validate

- [ ] 2.1 Run focused checks and the configured ordered validation gate
- [ ] 2.2 Run the PR full suite and repair demonstrated failures until current-head CI is green

### Phase 3: Review and hand off

- [x] 3.1 Dispatch one final review and resolve actionable findings — 6b35aa19d2 (review 0fc50825: approve, zero findings)
- [ ] 3.2 Publish evidence, promote the green reviewed PR and apply automerge
