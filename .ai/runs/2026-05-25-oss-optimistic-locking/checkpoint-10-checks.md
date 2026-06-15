# Checkpoint 10 — QA round-5 fixes (steps 30.7, 30.8, 30.11)

**When:** 2026-06-02 (resume 4)
**Commits covered:** `67e489b77` (Pay Links + Checkout Templates), `4959f65f8` (Sidebar Customization)

## Steps
| Step | Area | Commit | Result |
|------|------|--------|--------|
| 30.7 | Pay Links + Checkout Templates | 67e489b77 | LinkTemplateForm sends header; checkout.link/template.update commands enforce. Tests 6/6; checkout suite 43/43. |
| 30.8 | Sidebar Customization | 4959f65f8 | prefs GET returns updatedAt; PUT enforces (user+role scope); editor sends header + conflict bar. Test 3/3. |
| 30.11 | #2411 System Entities save no-op | (investigated) | Confirmed SEPARATE EAV scope bug (definitions.manage read vs definitions.batch write), not locking. Documented on PR; recommend separate issue. No code change here. |

## Validation
- Per-fix focused jest tests green (independently re-run by main session): checkout 6/6, sidebar 3/3.
- Executors reported: checkout full suite 43/43; auth editable-entities guard 34/34 + ui-coverage 2/2 green; `tsc --noEmit` clean for @open-mercato/core, @open-mercato/ui, @open-mercato/checkout.
- Both fixes delivered via sequential executor subagents; main session verified clean worktree, HEAD==origin, scoped diffs, and re-ran the new tests.

## Remaining (todo) — 30.9, 30.10, 30.12, 30.13, 30.14, 30.15
- 30.9 Saved table Views ("My Views") — locate (perspectives module?).
- 30.10 System/User Entities records lock — definition editor is batch upsert (no single version token); lower-value, needs design decision.
- 30.12 #2409 Availability delete false success toast — DEFERRED to live repro (all 3 static code paths handle 409 correctly; needs running app to find the real trigger).
- 30.13 Webhooks / Integrations / Data Sync / Notification Delivery / Scheduled Jobs / Dictionaries — triage said several already OK; Data Sync schedule save + Integrations marketplace had possible gaps. Needs LIVE verification (triage vs QA conflict).
- 30.14 Workflow visual editor — triage said already protected; QA says broken. Needs LIVE verification of the node/edge save path.
- 30.15 Batched integration + Playwright verification.
