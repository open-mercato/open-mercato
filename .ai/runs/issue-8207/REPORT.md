# Issue 8207 verification

Issue: https://github.com/open-mercato/open-mercato/issues/8207

Document mentions now separate module-view eligibility from missing document shares. Recipients without `documents.view` receive no ineffective sharing offer. A successful comment save shows the existing localized feedback for denied or skipped mentions. Eligible recipients can still be shared with and notified. Authorization, wildcard feature handling, tenant/organization isolation, and private title/identity handling remain enforced.

## Verified candidate

Implementation verified at `1964ec2d67a5d14fc5a126b7ae24edacf45a2c2a`, including base `8687fc8e2f6fb15690b3460ca0c67b8b7ba7ee3d`. The recovered implementation patch is unchanged. Report and screenshot publication does not change application behavior.

Validation used local Node 24.22.2 and Yarn 4.17.1 in an independently installed full checkout without spaces in its path. No dependency, build, or cache directories were copied. The normal configured commands and policies were retained.

## Ordered validation gate

| Command | Result | Duration | Cache |
|---|---|---:|---|
| `yarn build:packages` | PASS, 42 tasks | 28.667s | 0 cached |
| `yarn generate` | PASS, 1 task | 8.216s | 0 cached |
| `yarn build:packages` | PASS, 42 tasks | 5.547s | 35 cached |
| `yarn i18n:check-sync` | PASS, 70 modules | 0.902s | n/a |
| `yarn i18n:check-usage` | PASS, unused-key findings advisory | ~140.210s | n/a |
| `yarn typecheck` | PASS, 42 tasks | 29.992s | 0 cached |
| `yarn test` | PASS, 51 tasks | 322.701s | 5 cached |
| `yarn build:app` | PASS, 1 task | 82.360s | 0 cached |

Sync duration is the command tool's wall time; usage duration is approximate from the last log timestamp. Other durations are reported by the commands. The Documents portion passed 161 suites/1,112 tests, with one existing skipped suite/five skipped tests. The unchanged six-suite regression subset also passed 73 tests on this candidate.

Earlier failures remain disclosed: the original checkout's spaces exposed two unchanged create-app `URL.pathname` conversion failures; the same two files passed all seven tests in the independent checkout. An initial full test there failed the unchanged browser-proxy socket teardown assertion (expected 0, observed 1). Its focused unchanged diagnostic passed 37 tests; one authorized unchanged full retry then passed. A timing cause is plausible and unproven. Historical socket-path and unchanged UI-test failures from the prior run are retained separately; they are not counted as current passing results.

## Native API evidence

```sh
OM_INTEGRATION_MODULES=documents yarn test:integration:ephemeral --filter 'TC-DOCUMENTS-(004|022)\.spec\.ts$' --screenshots --keep --no-reuse-env
```

All seven cases executed and passed on their first attempt: zero skips, flakes, errors, or operator retries; 9.760s reported duration. The existing timeout/retry/worker/cache/security settings were retained. TC-DOCUMENTS-004 covers cross-tenant denial and permission-filtered title/content search. TC-DOCUMENTS-022 covers owner/direct-share/role-share/no-share revocation, preserved editor shares, watch/mention delivery, and deduplication.

The retained native environment was used for the browser proof below, then deliberately stopped. Its outer command exited 129 after the verified owner received SIGTERM. The seven-test JSON report and UI outcomes are recorded separately from that shutdown exit.

## Live browser evidence

Unique API-created users, scoped roles, and three documents were used. The configured repository Playwright browser exercised actual UI controls and real server responses in the same native app. The MCP browser failed to initialize because of its socket-path length; the supported repository browser fallback succeeded with short temporary paths.

| Scenario | Observed behavior |
|---|---|
| Denied recipient | Real comment POST 201; no sharing dialog; translated information after success; no share or notification; recipient GET 403 with no private title; persisted after reload. |
| Eligible unshared recipient | Share & notify granted a commenter share and delivered exactly one mention notification; recipient GET 200; no false no-access warning; persisted after reload. |
| Mixed recipients | Dialog offered only the eligible recipient; POST 201 granted/notified only that user; denied recipient remained 403 and unnotified; translated information appeared after success; persisted after reload. |

The critical PNGs were visually inspected. Persistence is established by API readback and reloaded DOM snapshots; some lower comments are outside the PNG viewport. Observed labels, selected mention chips, structured `mentions` payloads, preflight privacy, saved comment persistence, effective shares, and recipient notifications were cross-checked. Earlier throwaway fixture/probe mistakes were retained and corrected against observed behavior; no application or committed test assertion was changed for them.

Limits: realtime collaboration was unavailable, so the app ran in its supported single-user mode. The login shell returned 200 and rendered in 111 ms; no broader performance claim is made. Escape on the unchanged sharing dialog submits without sharing; its comment persisted without a notification. This is a current observation plus comparison with unchanged baseline source, not an executed baseline. Cancellation semantics are not claimed or changed by this fix. Failed/guarded/obsolete saves remain covered by the regression tests.

## Cleanup and review

All created documents, users, and roles were deleted through scoped APIs. Documents returned 404 on GET readback; subsequent DELETE requests for users and roles returned 404. The unique disposable database was then removed. Browser contexts were closed; the owned app, database, processes, listeners, descriptors, and sockets were verified gone. Native capture output was archived privately and its tracked runtime file restored. No raw logs, private credentials, tokens, process files, or environment state belong in publication.

Independent code review of the recovered implementation found no actionable production defect. The current candidate is submitted for fresh independent PR review. Required mention flows passed; comprehensive QA remains requested, including narrow viewport, long content, empty/loading/error states, and locale checks not exercised during this scoped run. No QA-approval label is claimed.

Screenshots are published separately from this change branch through the tracker evidence operation and linked from the PR. The committed API integration cases use the Playwright request fixture; they are not browser-level regression tests. A follow-up browser test should create scoped denied and eligible users, compose a mixed mention through the UI, assert that only the eligible user is offered and shared with, and verify successful-save feedback, persistence, denied title privacy, and one notification for the eligible recipient.
