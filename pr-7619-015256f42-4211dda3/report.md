## 📸 MFA emergency bypass notification QA — PASS

QA head: 015256f42030ec8fbf6199a1a130fe45fcfd742a

**Evidence-only verdict:** PASS for all17 scoped scenarios below. This is execution evidence, not a QA approval, risk waiver, CI verdict or merge authorization.

**Environment:** local isolated exact-head macOS/Chromium runs; real API/subscriber/PostgreSQL and production app build. Enterprise/security enabled. Separate bypass ON (`127.0.0.1:58262`), OFF (`127.0.0.1:59266`), and isolated ON producers (`127.0.0.1:60182`). All are stopped.

**Test data:** self-contained random organizations, roles and `example.test` users; exact/nested/module/global grants, ordinary/admin-only/effective-override denials and other-org manager. API-created overdue org policies and forced MFA sudo configs. Only synthetic fixtures; no production data/credentials.

**Independent native test:** `OM_SECURITY_MFA_EMERGENCY_BYPASS=true yarn mercato test:integration TC-SEC-015-mfa-bypass-notification` → **1 passed, 0 skipped, 0 flaky, 0 unexpected**. Environment reused only within this worktree and exact head.

| # | Action / expected | Actual observation | Result / screenshot |
|---|---|---|---|
| 1 | Native TC-SEC-015 via repository CLI, bypass=true; One executed pass, zero skipped/flaky/unexpected | 1 passed; stats expected=1, skipped=0, unexpected=0, flaky=0 | PASS / `native-desktop.png` |
| 2 | Scoped successful login with bypass ON; Eligible MFA managers receive one in-app warning | HTTP200 non-pending login; warning type, severity warning, in_app channel and translated keys verified | PASS / `native-desktop.png` |
| 3 | Exact, nested, module and global wildcard audiences; security.mfa.manage, security.mfa.*, security.* and * each receive one | All four API fixture users received exactly one scoped bypass warning | PASS |
| 4 | Recipient denials; Ordinary, security.admin.manage-only and role grant overridden by user ACL receive none | Each received zero bypass warnings | PASS |
| 5 | Other organization manager with visibility into observed org; No alert without membership in observed organization | Scoped read-only SQL: zero bypass rows before any login in other org; native test repeats exclusion | PASS |
| 6 | Unauthenticated and authenticated without MFA management; Unauthenticated inbox denied; authenticated unrelated user sees no bypass alert | Anonymous GET401; authenticated own inbox GET200 with zero bypass alerts (route is auth-only) | PASS |
| 7 | Cold host, panel responsiveness and long warning body; Useful shell and readable operator instruction; panel opens/closes | Backend DOM and settled shell captured after2227ms; panel visible1231ms after click incl400ms settle; closes without navigation | PASS / `step-02-warning-desktop.png` |
| 8 | Narrow viewport390x844; Warning title and long environment-variable instruction fit panel | Bounding-box width390px; warning and operator instruction visible; screenshot visually inspected | PASS / `native-mobile.png` |
| 9 | Ordinary user empty notification panel; No bypass warning; inherited empty state readable on mobile | Zero bypass alerts; after normal dismissal of own role-assignment alert, No notifications visible at390px | PASS / `step-08-ordinary-empty-mobile.png` |
| 10 | Dismiss actual warning through browser; Warning removed from panel | Clicked warning card Dismiss; title disappears and panel closes normally | PASS / `step-04-warning-dismissed.png` |
| 11 | Repeat login and page host after dismissal; No renewed daily warning; original row persists dismissed | HTTP200 login; same notification ID status dismissed, total dismissed1; active bypass total0; browser confirms absent | PASS / `step-05-no-redelivery.png` |
| 12 | Bypass OFF login negative in a fresh isolated database; No bypass warning for eligible exact-grant manager | HTTP200 normal login and zero bypass alerts | PASS |
| 13 | Bypass OFF overdue organization policy and backend navigation; Redirect unenrolled actor to MFA enrollment, emit no bypass alert | /backend redirects to /backend/profile/security/mfa; zero bypass alerts | PASS / `step-06-bypass-off-enforcement.png` |
| 14 | Bypass OFF forced MFA-only sudo target; No password downgrade and no bypass warning | HTTP400 for unenrolled actor; zero bypass alerts | PASS |
| 15 | Bypass ON overdue page producer isolated from login; Backend access permitted and fresh warning created by page observation | Own org/type warning rows removed and DB zero verified; no subsequent login; actor stays /backend and warning appears | PASS / `step-07-page-producer-on.png` |
| 16 | Bypass ON forced MFA-only sudo producer isolated from login/page; Password challenge plus fresh scoped bypass warning | Own org/type rows cleared again; HTTP200 required=true method=password; fresh warning ID differs from removed warning | PASS |
| 17 | Fixture and resource cleanup; Remove own records and stop only owned runtimes | API fixture cleanup completed; all owned app ports58262/59266/60182 closed; recorded owned Postgres containers removed; no residual task processes | PASS |

### Limits and interpretation

- Fixtures: randomly named organizations, roles, example.test users with generated passwords; exact/nested/module/global and denied grants, other-org manager, scoped overdue enforcement and sudo configs. Notification SQL touched only test organization/type for producer isolation and cleanup. Standard seeded disposable superadmin used only for API fixture provisioning.
- No deep link is expected: spec deliberately defines actions=[] and no linkHref because MFA-management permission does not imply access to administrative routes. API and browser both verified absence.
- No custom UI component/loading/error state or .uxproof contract exists in this diff/worktree; the warning uses the existing notification panel. Cold shell, empty panel, API401 error, denied audience, full long body and mobile layout were observed. General notification transport-error UI was not fault-injected.
- Not exercised live: queue outage/timeout, enforcement-service-unavailable and compliance-check-failed branches, next UTC-day rollover, process restart/concurrent delivery, separate tenant or disabled-module recipient cases, other locales. These are coverage limits, not claimed passes; existing source unit coverage was read but not counted as execution in this QA run.
- Exploration corrections: initial expected403 for notifications.view absence was wrong because GET is auth-only; corrected probe passed200/empty plus anonymous401. A networkidle wait timed out on live backend connections; DOM/semantic readiness succeeded. Direct fixture SQL deletion left read cache stale; producer isolation was corrected to assert DB zero and require a new warning ID. No product defect inferred from these probe mistakes.
- Screenshots visually inspected; only synthetic demo identities/organization labels appear. No token, password, secret, real user data or credential screen appears in published images.
- Full configured CI gate not repeated: parent owns current hosted CI. Independently executed native feature integration scenario and documented environment build/generate/build/app preparation.

**Cleanup:** temporary API fixtures removed; all three app listeners closed, only recorded owned Postgres containers removed, no residual owned processes. Tracked runtime capture/env files restored before completion. Existing PR labels preserved apart from temporary claim/release.

**Artifacts:** `report.json`, `report.md`, native results, semantic snapshots, command logs and screenshots under `.ai/qa/artifacts_7619_4211dda3/`. Published files contain reports and selected safe screenshots only.

Native approved reviews were reused for the review-first gate. No redundant full source review or source autofix was performed.
