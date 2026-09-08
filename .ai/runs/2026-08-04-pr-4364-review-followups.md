# PR #4364 — review follow-ups (om-auto-fix-pr)

**Subject PR:** open-mercato/open-mercato#4364 — `fix(scheduler,shared): stop idle-in-transaction reaps crashing the scheduler daemon`
**Driver:** `om-auto-fix-pr 4364`
**Follow-up issue:** #4934 (lease-based claim)

## 🎯 Goal

Drive #4364 to merge-ready by resolving the two `changes-requested` reviews on it
(@wojciechszyjka 2026-07-26, @patzick 2026-08-03) without touching the crash fix
itself. The PR author's branch lives in the upstream repository and this account
has read-only access to it, so the work is delivered as a small PR **targeting
that branch** instead of pushed onto it.

## 📋 Progress

- [x] Claim #4364 (comment only — assignee and `in-progress` label return HTTP 403 for a read-only account)
- [x] Merge the current `main` into the PR head so review and validation judge the real merge result
- [x] Major finding — restore an honest guarantee: startup warning + documentation for the lost cross-process exclusion
- [x] Minor finding — class docstring and the three scheduler docs pages no longer claim advisory-lock single-instance safety
- [x] Minor finding — `heldKeys` records the one-instance-per-process invariant it relies on
- [x] Nit — client-level pg error message made state-neutral (an idle reap logs through both handlers)
- [x] Nit — the never-removed client-level listener documented as a deliberate last-resort sink
- [x] Test gaps — startup warning, different keys do not block each other, key released when the claim transaction itself rejects
- [x] Validation gate (local runner): all eight configured commands green
- [x] Follow-up issue for the deferred lease implementation (#4934)
- [x] Open the delivery PR against `dokploy-runtime-error-fix`
- [ ] Author merges the delivery PR; #4364 re-reviewed and labels normalized by a maintainer

## Decisions

**Major finding — option 2, not option 1.** @patzick offered two resolutions: a
lease-based claim that advances `next_run_at` inside the claim transaction
(behavior-preserving, restores real cross-process exclusion), or a startup
warning plus documentation with the lease tracked as a follow-up — explicitly
stating "I would accept that as a resolution". This run took the second route
because #4364 is a `priority-high` production hotfix for a crash-loop: changing
when the scheduler advances `next_run_at` alters the claim/retry path of every
schedule and deserves its own PR and its own review, not a rider on a hotfix.
The deferred half is tracked in #4934 with the reviewer's exact proposal quoted.

**Docs beyond the review's ask.** The review named
`apps/docs/docs/framework/scheduler/overview.mdx`. Two further pages made the
same now-false promise — `user-guide/scheduler.mdx` ("Uses PostgreSQL advisory
locks for safety") and `cli/scheduler.mdx` ("Lock Strategy: PostgreSQL advisory
locks") — so both were corrected in the same pass rather than left to contradict
the code.

**Delivery shape.** The base-first step was performed as a *validation* step
only: `main` was merged into a scratch branch and the whole gate ran against that
merged state, so the fixes are proven against the current base. The delivery PR
itself is the two fix commits cherry-picked onto the untouched PR head, so its
diff is nine files instead of the ~1100 a merge commit would have dragged in.
Updating #4364 against `main` is one "Update branch" click for the author and
does not need to ride along here. An earlier delivery PR that did carry the merge
commit was closed for exactly this reason.

## Validation

Local runner (no compose `app` container running). Every command in
`.ai/agentic.config.json` → `validation.commands`, in order, against the merged
state: `yarn build:packages`, `yarn generate`, `yarn build:packages`,
`yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`,
`yarn build:app` — all green. `yarn test` ran 23/23 turbo tasks; the scheduler
and shared suites relevant to this change are 37 and 12 tests respectively.
`i18n:check-usage` reports 2 missing keys and 3819 unused keys as advisory
pre-existing findings unrelated to this diff (it touches no locale files).
