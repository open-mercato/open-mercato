## 📸 UI QA evidence — FAIL

**QA head:** `4b33a7ae560fd87a8925cc288fbde75f764cf27f`. Evidence-only complex QA on a production app with disposable PostgreSQL, Chromium, enterprise modules and optimistic locking enabled.

**Outcome:** timer, conflict, error recovery and shared-project journeys passed. The 375px screen fails the mobile layout check: the grid cells overlap and document width is384px at a 375px viewport. No `qa-approved` or `qa-self-verified` is granted.

| Check | Observed result |
|---|---|
| Empty owned-user timesheet with no assignments | **PASS** — Disabled Start explained missing assignments; empty grid visible. |
| 10 UI start/stop cycles with distinct notes; persisted list read after each, picker reload after first | **PASS** — All 10 timers stopped; saved notes and project retained; note field cleared; last-started project restored after reload. |
| Save a running note with Enter | **PASS** — PUT succeeded; persisted entry contains edited note. |
| 10 stale saves against second owned supervisor, followed by Stop | **PASS** — 10/10 stale PUTs409, draft preserved; 10/10 Stops persisted end and supervisor note. Supervisor edit preserved every other listed field except description alias and updated_at. Secondary edits exercised through API with two distinct authenticated browser users. |
| Manage-own boundary on direct timer endpoints (API) | **PASS** — Attempted foreign-member start201 was safely rebound to caller own member (verified persisted owner); stopping an actual supervisor timer refused403. Both fixture timers then stopped. |
| Cold-load owned-user timesheet | **PASS** — Usable timer and grid shell in 1538ms. |
| assignments read503 and UI Retry | **PASS** — Expected fallback visible; Retry restored grid. |
| entries read503 and UI Retry | **PASS** — Expected fallback visible; Retry restored grid. |
| 375px viewport with a long draft | **FAIL** — Document width 384 at viewport 375; screenshot retains grid readability evidence. |
| English/Polish timesheet profile language switch | **PASS** — Polski selected through UI; localized placeholder and timer controls rendered. |
| Dashboard shared default in both directions, Start/Stop and stop-Undo | **PASS** — Alpha started in timesheet seeded widget; selecting and starting Beta in widget then stopping seeded Beta on timesheet. Stop-Undo returned200 after granting undo_self to fixture; timer reopened and stopped again. UI settled10s after final navigation. |

### Failure attribution and limits

- Evidence-only complex QA; risk-high requires human signoff.
- 375px mobile grid is cramped and document width 384px exceeds375px viewport. The PR description already discloses cramped 375px grid; GridView and PeriodSelector are unchanged by this diff. Base revision was not separately booted, so the 9px overflow attribution is not independently established.
- First environment expired during an interrupted timer cycle; it was discarded and all counted cycle/stale checks used fresh disposable environment.
- Fixture ACL omissions caused expected 403s before correction; those attempts are not product failures. The corrected role exercised the actual own/foreign boundary and undo paths.
- Secondary supervisor edits were API-driven with two distinct authenticated browser users. No direct database fixture writes.
- Not independently exercised here: wrong-tenant/organization cases, all closed-report/cascade interleavings, every delete/redo path, delayed-period response reversal, DE/ES rendering, mobile dashboard and full keyboard/screen-reader coverage. CI covers deterministic cascade/concurrent undo and record-lock cases; that is separate automated evidence.

### CI and cleanup

Validation source: GitHub checks. [Current-head CI attempt 3](https://github.com/open-mercato/open-mercato/actions/runs/41609375946/attempts/3) passed: 137 integration tests, 0 failed, 0 flaky, 2 skipped; real-Postgres migration suite passed. Other requested PR workflow reruns passed; conditional jobs were skipped.

Owned fixture data was created through application APIs; timer actions, note saves, Retry, language switch, widget customization and undo were driven through real UI. Teardown completed: all nine recorded environment processes are gone and port 5001 no longer responds. The disposable database contained all owned fixtures. No source changes or PR-branch pushes.

Code-review approval remains scoped to the reviewed source. This evidence does not waive the known mobile issue or the unexercised human checks; `needs-qa` remains the merge gate. A QA reviewer should evaluate the mobile failure and remaining checks before granting approval.
