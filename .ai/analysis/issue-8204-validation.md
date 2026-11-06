# Issue 8204 validation evidence

The sections under **Earlier attempts** preserve the evidence and limitations as they were recorded; their incomplete-gate statements describe those historical attempts. The current result is below.

## Verified candidate — 2026-11-06

All eight configured validation commands passed in order on `315ff6ee628416c9079b49ce32a24a7b2d37273e` (tree `8cc81aa910b09bcb4584d1cccc9f78c173b0c0fd`). This candidate includes canonical main through `8687fc8e2f6fb15690b3460ca0c67b8b7ba7ee3d`, the field-only injection rejection correction, and the dependent form regression assertion correction. Results below belong to this exact source; they do not claim validation of a later combined branch.

Runner: local, selected once because no compose app was running. Runtime: official Node 24.22.2 arm64 and repository-pinned Yarn 4.17.1. Normal immutable installation passed on the same lockfile before these source-only corrections. No hooks, worker settings, test timeouts, retries, assertions or validation commands were bypassed. Optional real-database test inputs were absent at the actual unit invocation; no peer URL or explicit database sentinel was supplied. The root test script's own heap and concurrency defaults remained unchanged.

| Ordered command | Result | Wall time | Native task/cache evidence |
| --- | --- | --- | --- |
| `yarn build:packages` | PASS | 8.135s | 42/42 tasks, 41 cached |
| `yarn generate` | PASS | 6.942s | Working tree remained clean |
| `yarn build:packages` | PASS | 0.685s | 42/42 tasks, 42 cached |
| `yarn i18n:check-sync` | PASS | 1.330s | 70 modules synchronized |
| `yarn i18n:check-usage` | PASS | 142.698s | Existing unused-key advisory retained |
| `yarn typecheck` | PASS | 3.062s | 42/42 tasks, 41 cached |
| `yarn test` | PASS | 284.725s | 51/51 tasks, 5 cached; core 27,055 passed/241 skipped; create-app 1,114 passed/6 skipped |
| `yarn build:app` | PASS | 88.323s | 1/1 task, zero cached; eight dynamic-filesystem tracing warnings retained |

The full sequence completed at 04:15:18 UTC. All foreground results were collected, all recorded owned validation processes exited, both source checkouts remained clean, and the lockfile and staged entries were unchanged. `git diff --check` also passed. This completes the configured local gate; it is not human QA approval.

### Corrections and regression proof

A fresh content review identified an existing injection consumer that vetoes saving with field errors but no general message. `7cb0d9492c03460ca559bfa11bc3c11aa9a5114e` makes the summary select the first non-empty translated/transformed field reason before the generic fallback. Explicit messages retain precedence, inline errors remain, repeated rejection is revealed, and successful saving does not scroll.

```sh
yarn workspace @open-mercato/ui test --runInBand src/backend/__tests__/CrudForm.injectionScroll.test.tsx
```

Corrected source: 10 passed (2.938s). Temporarily substituting only the preceding CrudForm source while retaining the new tests: two expected failures/eight passes (2.337s). Exact restoration: 10 passed (2.403s). Source restoration was verified; no other checkout, test configuration or assertion was changed.

The next full gate found a real dependent test ambiguity: `CreateDealForm.test.tsx` expected one global `Priority blocked` match, while the form now correctly renders both inline and summary messages. A first scoped correction used a saved DOM node and failed (one failed/eight passed, 4.054s). The final correction queries the current field wrapper inside `waitFor`, separately verifies the actual summary, and reacquires the current input for the successful retry. Blocked-create, guard-once, after-save completion, payload stripping, navigation and one-form checks remain intact.

```sh
yarn workspace @open-mercato/core test --runInBand src/modules/customers/components/detail/create/__tests__/CreateDealForm.test.tsx
```

PASS: nine tests, 2.924s, on `315ff6ee`, followed by the complete passing gate above. The preceding `7cb0` full run failed after 237.471s with that single ambiguous consumer test; app build was not run on the failed attempt. These were change-related failures, not baseline exceptions. Independent content review approved the field-only and current-DOM corrections. A later comparison with concurrent published work identified an additional drawer Select teardown focus race; see the open review item below.

### Open review item after the passing gate

The published branch contains a concurrent drawer repair (`99c1e7d253012b2d357ff45a5cf3d7d6c4b051c3`, published through `418d73d3180d9997765e713177ae9304cdba4a1c`) that was absent from candidate315ff6. Read-only review confirmed that Radix Select can restore trigger focus during delayed teardown after a fast rejection focused the notice. The repair preserves notice focus only when it already owns focus and adds real-Select rejection/cancel/success controls. Its isolated content is approved. Ordinary merge `bfb236ae7e568069a9867ab5fa94fff0ac23270a` preserves both315ff6 and418d73 plus all previously published work; combined-source validation remains outstanding. The eight passing commands above do not resolve or waive that finding.

### Accepted integration and manual UI evidence

At coverage commit `4d568dfd64156d1f055ed8ff0bd9653856f4d014`, [native CI run 41849313454](https://github.com/open-mercato/open-mercato/actions/runs/41849313454) passed all 15 integration shards. All four new issue cases and all three adjusted existing validation cases passed on their first attempt: dialog 5.6s, claim race 5.2s, stale status 5.4s, long page 9.9s, CAT 2.1s, CGRP 2.3s, CRM 3.1s. This supersedes the outstanding rerun requirement from the earlier failed native attempts documented below; it does not erase those attempts.

The completed [manual UI report and five screenshots](https://github.com/open-mercato/open-mercato/pull/8672#issuecomment-6633453276) cover oversized/repeated page rejection, dialog focus and keyboard retry, a real claim race, stale status rejection and successful recovery. This accepted integration and manual evidence was not duplicated for the later unit-covered field-only and dependent-test corrections. Mobile-width, restricted-role, all-locale and full perceived-performance checks remain unexercised. `needs-qa` remains required; neither `qa-approved` nor merge approval is claimed.

## Earlier attempts

## Eligibility and scope

- Canonical issue: https://github.com/open-mercato/open-mercato/issues/8204 (feature).
- Baseline: `e5774a707321fe14867a19663bc486d7a001492d`; merged PR #7421 commit `dee599a20c46f58b24c28c4f5a34fe1892f8a45a` is an ancestor. The affected behavior exists on main.
- Live pre-claim checks found no assignee, claim comment or implementation PR; subsequent publications are design #8671 and this implementation #8672 only.
- Source commit: `4ab9dee741660a3fc526a99ddeb5992a03a4a88c`, branch `cez/a6fed540`.
- Existing component contracts, mutation guards, optimistic locking, message translation and conflict banner remain intact. New shared reveal helper is integrated into CrudForm and staff TaskDrawer.

## Earlier environment

Local runner selected once: no compose app was running. Node 24.18.0; `yarn install --immutable` passed with existing peer warnings and no lockfile changes. macOS requires a private task-specific short directory made with `mktemp -d /private/tmp/cz-XXXXXX`; pass that directory as `TMPDIR`, `TMP`, `TEMP` and, for browser tools, `PWTEST_SOCKETS_DIR` to every command. No hooks were bypassed.

Browser verification uses the native ephemeral runner with a new task-owned disposable database. The earlier stale descriptor was replaced through the normal managed lifecycle. Cold start, warm reuse, live UI exploration, and a source-freshness rebuild completed successfully; no developer/shared database is used.

## Earlier ordered configured gate

Each command has a 1800-second process timeout.

| Command | Result |
| --- | --- |
| `yarn build:packages` | PASS, 42 tasks |
| `yarn generate` | PASS |
| `yarn build:packages` | PASS, 42 tasks |
| `yarn i18n:check-sync` | PASS, 70 modules |
| `yarn i18n:check-usage` | TIMEOUT after 1800 seconds; output stopped after discovering 34,919 translation keys |
| `yarn typecheck` | PASS as separate diagnostic after the gate timeout: 42 tasks, 40 cached, 3m55.658s |
| `yarn test` | TIMEOUT after 1800 seconds (exit 124): 15 of 49 Turbo tasks completed, four cached; one failure in unchanged EntityTagsDialog load-more termination (button still present); standalone native rerun passed all 15 tests (94.63 seconds), without changes; full gate remains incomplete |
| `yarn build:app` | TIMEOUT after 1800 seconds (exit 124): compilation passed in 18.8 minutes; TypeScript phase did not finish; eight tracing warnings on shutdown |

## Component regression commands

Authoritative focused package-script runs use the unmodified repository configuration:

```sh
yarn workspace @open-mercato/ui test --runInBand src/backend/__tests__/CrudForm.injectionScroll.test.tsx src/backend/__tests__/CrudForm.validation.test.tsx src/backend/__tests__/useRevealError.issue8204.test.tsx
yarn workspace @open-mercato/core test --runInBand src/modules/staff/lib/time-tracking-ui/__tests__/TaskDrawer.test.tsx
```

PASS: UI 15 tests/three suites (25.333 seconds); core 48 tests/one suite. All 63 targeted tests pass natively on committed source without temporary configuration. These package scripts already specify the correct TypeScript rootDir and Jest setup.

Earlier generic root invocation (after generation):

```sh
yarn jest --runInBand packages/ui/src/backend/__tests__/CrudForm.injectionScroll.test.tsx packages/ui/src/backend/__tests__/CrudForm.validation.test.tsx packages/ui/src/backend/__tests__/useRevealError.issue8204.test.tsx packages/core/src/modules/staff/lib/time-tracking-ui/__tests__/TaskDrawer.test.tsx
```

Root-only invocation FAIL: four suites, zero tests executed; TypeScript TS5011 requires an explicit `rootDir`. The untouched `yarn jest --runInBand packages/ui/src/backend/__tests__/CrudForm.render.test.tsx` also fails TS5011. No repository Jest/TypeScript configuration was changed. This root-entrypoint failure does not invalidate the passing package-native runs above.

For supplemental behavioral diagnostics, a temporary config preserved the repository Jest configuration and set the absolute checkout root in both Jest `rootDir` and each ts-jest transform tuple's `tsconfig.rootDir`. This does not replace the native validation gate.

```sh
yarn jest --config /tmp/issue-8204-jest.config.json --runInBand packages/ui/src/backend/__tests__/CrudForm.injectionScroll.test.tsx packages/ui/src/backend/__tests__/CrudForm.validation.test.tsx packages/ui/src/backend/__tests__/useRevealError.issue8204.test.tsx packages/core/src/modules/staff/lib/time-tracking-ui/__tests__/TaskDrawer.test.tsx
```

PASS: 63 tests, four suites on committed source `4ab9dee741` (69.181 seconds); the earlier run also passed (68.492 seconds). Coverage includes repeated page/dialog refusals, message-only injection veto, field validation, empty transformed-error fallback, success without reveal, helper cancellation, claim race/stale drawer error focus, reopening and stale-refetch protection.

### Baseline behavior comparison

Temporarily replaced only CrudForm.tsx in this isolated worktree with `git show e5774a707321fe14867a19663bc486d7a001492d:packages/ui/src/backend/CrudForm.tsx`, then restored the implementation byte-for-byte in a Python `finally` block. No other checkout or branch was changed.

```sh
yarn jest --config /tmp/issue-8204-jest.config.json --runInBand packages/ui/src/backend/__tests__/CrudForm.injectionScroll.test.tsx
```

Baseline: six failed, one passed (15.296 seconds). Failures are actual-message injection focus, repeated page refusal, repeated embedded refusal, message-only veto, required validation focus, and empty transformed-error fallback. The successful-save case passes on baseline.

### Broader diagnostic and unrelated failure

```sh
yarn jest --config /tmp/issue-8204-jest.config.json --runInBand packages/ui/src/backend/__tests__/CrudForm packages/ui/src/backend/__tests__/useRevealError.issue8204.test.tsx packages/core/src/modules/staff/lib/time-tracking-ui/__tests__/TaskDrawer.test.tsx
```

TIMEOUT after 900 seconds. Four suites passed (injection lifecycle, custom fields, asynchronous injection transforms, hidden groups); the untouched optimistic-lock suite failed because JSDOM has no global `Response`, in unchanged `serverErrors.ts:119`.

Baseline verification using the same temporary source substitution and restoration:

```sh
yarn jest --config /tmp/issue-8204-jest.config.json --runInBand packages/ui/src/backend/__tests__/CrudForm.optimisticLock.test.tsx
```

Same failure on baseline: one failed, 13 passed (11.996 seconds). This is not repaired as part of #8204.

## Review and remaining evidence

Independent read-only source review approved `4ab9dee741` with no remaining source findings, and explicitly withheld merge approval pending native checks and real browser viewport/modal-focus coverage. Review fixes already included: empty validation fallback, stable rejection identity across drawer notice refinement, ignoring obsolete async refinements, and clearing notices when closing/reopening.

Live browser exploration and inspected screenshots are complete. Self-contained Playwright tests were executed with the mixed results documented below; full native gate completion and final approving PR review remain outstanding. No QA approval or merge-readiness claim is made. Pre-commit translation and template parity hooks passed on the source commit.

The unchanged translation scanner rebuilds its 34k-key prefix index for each file. The 1800s result is a timeout, not a demonstrated hang. No scanner changes are in scope.

Browser tooling preflight: `yarn playwright --version` reports 1.61.1; repository-installed Chromium launches, renders a data-URL button and closes successfully. This is a browser smoke check only, not app UI evidence.

## CI on source commit 4ab9dee741

[Run 41809811013](https://github.com/open-mercato/open-mercato/actions/runs/41809811013) passed its test job and 13 of 15 integration shards. Shards 4/15 and 6/15 failed three existing validation scenarios: `TC-CAT-002`, `TC-CGRP-022-terms-section-negative-validation`, and `TC-CRM-002`. Their globally scoped text locators now match both the preserved inline error and the new actual-error summary. CI logs show strict-mode locator ambiguity, rather than a missing validation error. These are change-related test failures requiring field-scoped assertions and reruns; they are not baseline failures or waived checks. No unrelated source repair is proposed.

The coordinated test-only correction is committed as `fb3b3bbd6bdb79ea8db426497694153bb9cd1dc6`: scope assertions to the existing `title`, `paymentTermsDays`, `primaryEmail` and `websiteUrl` field wrappers. Error text, visibility, success URL/persistence and zero-PUT checks remain intact. Both pre-commit hooks passed. The native regression selection now includes these three scenarios.

Standalone diagnostic after the full-run failure:

```sh
yarn workspace @open-mercato/core test --runInBand src/modules/customers/components/detail/__tests__/EntityTagsDialog.test.tsx
```

PASS: 15 tests, one suite, 94.63 seconds (600-second process cap). Neither the component nor its test changed; no timeout/assertion was relaxed. This does not prove baseline reproducibility or turn the incomplete full run into a pass.

Independent follow-up review approved locator-only commit `fb3b3bbd6b`: all four assertions target the correct field containers and retain exact messages; navigation, blocked-request, correction and successful-create checks remain unchanged. No actionable findings. The reviewer explicitly withheld merge approval pending live reruns and new feature integration coverage.

## CI after field-scoped assertions

At head `fb3b3bbd6bdb79ea8db426497694153bb9cd1dc6`, [run 41815672496](https://github.com/open-mercato/open-mercato/actions/runs/41815672496) passed its test job and **all 15 integration shards**, including the previously failing shards 4 and 6. All reported checks settled: 26 successful, four skipped, none failed or pending. The three adjusted scenarios now pass in CI. This does not replace the missing new #8204 browser tests or mark the incomplete local configured gate as passed.

## Live UI exploration and integration coverage (2026-11-04)

The repository-native isolated runtime completed a cold start: disposable database initialization 311s, package build 56s, generation 35s, rebuild 3s, app build 690s, authenticated readiness 73s. A second invocation reused the same healthy owned runtime. No developer database or manual migration command was used.

Observed the actual app before writing tests. The long staff-member CrudForm kept its inline required error and focused its error summary. An oversized server rejection measured 1015.5px high in a 600px viewport; its beginning was at y=96 after both initial and repeated rejection (before retry it was above the viewport at y=-534). Successful creation returned 201, navigated to the new member, and removed the error summary.

In the job-history dialog at 1280×400, the actual server rejection received focus at y=250, height35.5, inside the modal y=20/height360. Control+Enter successfully saved the retry and closed the modal.

The staff drawer used real competing requests: a second created staff user claimed the task while the browser claim request was intercepted, causing the real 409 and specific already-taken message. Its focused notice was at y=120.5/height36. An out-of-band task update made the browser status header stale; the actual 409 produced the refreshed-version notice at y=210.5/height56, with the existing conflict banner preserved. The successful status retry cleared the notice and kept Properties visible at y=346.5. All exploration fixtures were cleaned, and the owned exploration process group was stopped after browser close.

Four new module-local integration specs and an issue-specific visibility/fixture helper now cover these observed paths. Independent review identified two test improvements, both addressed: checking the actual drawer-body clipping bounds plus full viewport intersection, and waiting for the refreshed task title before a clean status retry. The first native execution later produced three passes and four timeouts, as detailed below; the cleanup correction still requires rerunning the affected tests.

| Attempt | Result and diagnosis | Next step |
| --- | --- | --- |
| Persistent browser-tool exploration | Tool kernel timed out; no product failure inferred. | Used the repository-installed Playwright fallback with bounded owned processes. |
| Initial navigation waiting for networkidle | Timed out; app has live connections, while the DOM rendered correctly. | Use DOM readiness and observed semantic controls. |
| Early exploratory assertions | A default 5s assertion expired before the server rejection settled; stale-status generic alert locator also matched the existing conflict banner. | Observed final focused messages, used the specific notice target, and retained native shared test timeouts. |
| `yarn playwright test --config .ai/qa/tests/playwright.config.ts ISSUE-8204 --list` | Timed out at 120s during collection; no test outcome. Owned listing child confirmed exited. | Run native managed suite with a realistic command budget. |

The native source-freshness check includes new integration files. The normal rebuild passed: database initialization 96s, package build 42s, generation 31s, rebuild 3s, app build 1159s, authenticated readiness 28s. No fingerprint, timestamp, or cache metadata was changed to bypass it. The managed command `yarn mercato test:integration 'ISSUE-8204|TC-CAT-002|TC-CGRP-022|TC-CRM-002'` reused the healthy owned runtime with a 3600s process cap; its outcome is recorded below. Verbose logs remain in the local issue-specific QA artifacts directory; five inspected screenshots are retained in the local UI QA artifacts directory for the tracker evidence handoff, separate from the implementation branch.

Read-only review of the integration source approved the clipping/version assertions. Failure-artifact review subsequently identified the cleanup defect described below; the cleanup correction also passed review. Source review does not grant merge approval or waive incomplete execution.

## Native integration attempt 1

Command: `yarn mercato test:integration 'ISSUE-8204|TC-CAT-002|TC-CGRP-022|TC-CRM-002'`. The native runtime was reused; shared settings were one worker, 20s whole-test timeout, one retry, unchanged. Result: exit 1 after 1160.07s; three passed, four failed (each timed out on both attempts). Full results and traces are preserved in the ignored local `validation/integration-native-01-results` directory.

| Scenario | Result |
| --- | --- |
| Existing TC-CRM-002 | PASS, 13.1s |
| New embedded dialog | PASS, 10.1s |
| New real claim race | PASS, 12.3s |
| Existing TC-CAT-002 | TIMEOUT; retry navigation consumed 16.07s, leaving 1.58s for validation after clicking. No duplicate-text strict-mode error. |
| Existing TC-CGRP-022 | TIMEOUT; retry navigation 8.17s and locating the code field 3.43s, then expiration while preparing input. |
| New stale-status flow | TIMEOUT before the first Status click; retry dashboard navigation 11.29s plus board navigation 9.66s. No status mutation or reveal assertion reached. |
| New long-form flow | TIMEOUT with oversized rejection rendered; closed-page unroute during cleanup masked the original step. |

Read-only review found one actionable test defect: page/dialog cleanup could skip fixture deletion when unroute throws after the page closes. Both now use an independent API context, delete fixtures in afterAll, dispose through finally, and make route cleanup best-effort. The correction passed independent review. Assertions and timeouts remain unchanged; these edited tests require native reruns.

Concurrent heavy processes in another scheduled tree were observed and reported for parent coordination. Navigation timing supports runtime slowness as a contributor, but no host cause is proven and no failure is waived as baseline. No production defect is established by these traces. Further heavy validation is held for a meaningful load change. The planned retry covers CAT, CGRP, the new page/status failures, and the changed dialog test, after the normal source-freshness rebuild; unchanged claim and CRM passes remain valid.

## Native rebuild after cleanup correction

During the coordinated quiet window, `.ai/scripts/test-env-issue8204-up.sh` performed the normal source-freshness rebuild. Initialization passed in 166s, packages in 98s, generation in 129s, package rebuild in 10s, and application build in 784s. Authenticated readiness then failed after 180s: the owned database port 55021 refused connections and `docker ps -a` reported the configured Docker socket missing. Docker Desktop/backend processes were absent; only the privileged networking helper remained. No shared infrastructure was restarted or modified by this task.

Overall wrapper result: exit 1 after 1395.74s (7500s process cap, not a command timeout). The planned five-case rerun did not execute. All observed owned wrapper/native/app/worker PIDs exited, port5001 closed, and owned/native runtime descriptors were removed by the normal cleanup. Container cleanup could not be verified while Docker's API was unavailable. The successful native build cache and failed boot evidence were retained for supported recovery. This is a runtime blocker, not a passing validation gate.
