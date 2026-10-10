# Notify — 2026-10-09-standalone-app-default-ci

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-09T12:24:24Z — run started
- Brief: implement .ai/specs/2026-10-09-standalone-app-default-ci.md (default CI for scaffolded standalone apps)
- External skill URLs: none

## 2026-10-09T12:24:24Z — decisions (user)
- Q10: Phase 2 uses an opt-in app-owned discovery flag on `mercato test:integration`; defaults unchanged.
- Q11: upstream guard is a post-publish canary in snapshot.yml, labelled honestly.
- Q12: real-GitHub verification deferred to a manual follow-up; local Verdaccio + docker 7 GB verification instead.
- Spec status is "draft — awaiting core-team review"; user invoked implementation explicitly. The default-on scaffold change stays an explicit core-team ask in the PR body (create-app Ask First: scaffold modes).

## 2026-10-09T14:38:31Z — checkpoint 1 failed (steps 0.1..1.6)
- Cold `yarn ci` build OOM-killed intermittently on the 7 GB / 2 vCPU shape even after Step 1.6 (4 GB build heap): 1 pass / 1 OOM in full cold runs.
- Root cause lead: Next 16.3 keeps the Turbopack build worker alive (writing its filesystem cache) until the end of `next build`, overlapping static generation.
- Decision: fix forward with appended Step 1.7; Phase 2 blocked until checkpoint 1 re-runs green.

## 2026-10-09T14:38:31Z — run paused (user request)
- User asked to stop here and continue on another machine. Work committed and pushed; draft PR #7138 stays in-progress; lock released.
- Delegations this run: Steps 1.1, 1.2, 1.3, 1.4, 1.5 ran as executor subagents (default tier); 0.1, 0.2, 1.6 inline.

## 2026-10-09 — run complete
- Steps 1.7, 1.8, 2.1–2.3, 3.1–3.2 done; checkpoint 2 passed (`checkpoint-2-checks.md`); final gate recorded (`final-gate-checks.md`).
- Review passes: changes requested on 2bfd64f3d (2 Medium); fixed. Rebased onto develop at user request; CI `test` failure (repo-wide-guards classification) fixed.
- Delegations: 2.1, 2.2, 3.1 and two review passes ran as cezar child tasks; the rest inline.
- PR #7138 marked ready, Status: complete.
