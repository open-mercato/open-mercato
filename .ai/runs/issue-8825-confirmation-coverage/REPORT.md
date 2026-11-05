# Issue #8825 — workflow confirmation browser regression

Issue: https://github.com/open-mercato/open-mercato/issues/8825
Runner: local; Node 24.22.2, Yarn 4.18.1, Docker 29.9.2, Playwright Chromium.

## Result

The module-native `packages/core/src/modules/workflows/__integration__/TC-WF-073.spec.ts` passed all four EN/PL × Control/Meta cases in 28.0 seconds through the repository managed integration runner. Each case creates four own API definitions and executor-started instances (selected/control FAILED and PAUSED), asserts exact localized identifier/no raw token, Cancel/Escape full-record equality/no action request, keyboard mutation targeting/unchanged controls, and 100-character identifiers plus actions contained at 390×844. Finally cancels fixtures, discovers instances by definition ID even when start-response handling fails, and deletes created execution data and definitions transactionally. No seeded workflow data is used.

Test source SHA-256: `de26296e6a0c5b43dc831d329f781953fb1933b83809c2d53cc88ca870b96487`.

## Dependencies and attribution

- The browser run used the parent-authorized validation-only #8805 overlay: removed the second getTelemetryRuntime import from warranty_claims detail lines 9/13. The original file was restored before committing; that fix is not shipped here. Thus browser/build/typecheck evidence is conditional on #8805, not an exact unmodified-head green gate.
- Source fix #7907 remains open. Its original authored commit 7b69580c19c4ddc91e56545ed05c58b6602e59e5 was reused as d86055c161, preserving Oskar Wojciechowski's authorship. This adds browser coverage to that fix; it does not claim its contribution. Merge #7907 first or retain the attributed prerequisite commit.

## Exact validation

All Yarn commands below used `mise exec node@24.22.2 --`; testing used TMPDIR=/tmp TMP=/tmp TEMP=/tmp and **unset** DOTENV_CONFIG_OVERRIDE. Managed runner received a generated disposable JWT secret without printing or committing it.

| Command | Actual result |
|---|---|
| `yarn install --immutable` | Passed; optional cpu-features build warning. |
| `yarn build:packages` → `yarn generate` → `yarn build:packages` | Passed, 42 build tasks per build. |
| `yarn i18n:check-sync` | Passed. |
| `yarn i18n:check-usage` | Passed; unused-key advisory. |
| `yarn typecheck` | Passed 42 tasks with #8805 overlay; unmodified head fails the duplicate import. |
| `yarn test --env-mode=loose` | 50/51 Turbo tasks passed; only create-app OMH-057 failed, required context 115086 bytes > 114688. Core: 2691 suites / 27038 tests passed; app: 116 suites / 808 tests passed. No harness edits made. |
| `yarn build:app` | Unmodified head fails #8805. Managed runner's production app build passed with overlay. |
| `yarn jest --config packages/core/jest.config.cjs packages/core/src/modules/workflows/backend/instances/__tests__/page.confirmDialogs.test.tsx --runInBand` | 3/3 passed. |
| `yarn jest --config packages/shared/jest.config.cjs packages/shared/src/lib/bootstrap/__tests__/dynamicLoader.generatedCacheRecovery.test.ts --runInBand` | 2/2 passed under corrected temp environment. |
| `yarn playwright test --config=.ai/qa/tests/playwright.config.ts TC-WF-073 --list` | Discovered all four cases; syntax/discovery only. |
| `yarn mercato test:integration TC-WF-073` | Final run `/tmp/issue-8825-integration8.log`: 4/4 passed, 28.0s test time; managed provisioning/build/run 224.8s. |
| `git diff --check` | Passed. |

## Failed attempts and diagnosis

- Initial absent Docker/dependencies: restored Docker Desktop and installed the lockfile under Node 24.
- Missing generated entity registries: resolved by build/generate/build.
- Root Jest invocation TS5011: used authoritative core package Jest config; tests passed.
- Long cezar TMPDIR caused macOS tsx socket EINVAL: use /tmp; Turbo strict environment lost overrides, so broad tests used --env-mode=loose.
- DOTENV_CONFIG_OVERRIDE=false is a truthy string to dotenv/config, which overwrote managed JWT/scheduler environment with .env. A local boolean-only probe established the assignment stack. Unset the variable entirely. Earlier managed initialization attempts with that variable cannot be confidently called isolated: database override may also have been replaced by .env (not independently verified); parent notified. No manual developer-database or migration command was run.
- Production startup rejected the runner's default signing secret: supplied a generated disposable secret via process environment.
- First actual browser matrix failed all four cases on missing required fixture activityName (400); corrected.
- Next browser matrix opened the confirmation but queried dialog instead of its observed alertdialog role; corrected; redundant repetitions interrupted by the exact Playwright PID.

## Review and QA limits

No public contract, schema, ACL, or shared production code changed. Remaining merge blockers are #8805 and the create-app harness budget gate. Native browser evidence covers EN/PL only, admin role, list Retry/Cancel, both shortcuts and 390px; it does not claim all-locale or permissions coverage. No qa-approved label is authorized. Review/PR and screenshot evidence are linked in the subsequent run artifacts/comments.

## Published handoff

PR: https://github.com/open-mercato/open-mercato/pull/8836
Review: https://github.com/open-mercato/open-mercato/pull/8836#issuecomment-6667494153
QA evidence: https://github.com/open-mercato/open-mercato/pull/8836#issuecomment-6667521835

The review found no additional workflow-code issue but requests changes for the unmodified #8805 and create-app budget blockers. GitHub refused a native self-review because this account authored the PR; the findings are a comment, not a native approval. QA is PARTIAL because evidence used the authorized overlay; all four requested scenarios passed. Screenshots are on a separate qa-evidence-pr-8836-workflows-fbc0d1bc branch, never the change branch. No merge, qa-approved or qa-self-verified action was taken.

Implementation commit: d52346eb53c782edc10ced03214bccf601781e6f. Original authored prerequisite: d86055c161e1e27e7f03176657a39708a87e989c (source #7907 commit retained with original author). Base sync: b9f50c678a00494f14282c2cb2cdb88cf03b81ac, incorporating only the newer customers base commit. Earlier evidence commits: 46a33390cbf53bfe1c4a3f263f3f586bbc3451e2 and 3b42eb272144b015b6e2a7a27a6611237dfdb96e. Subsequent commits only finalize these evidence artifacts.
