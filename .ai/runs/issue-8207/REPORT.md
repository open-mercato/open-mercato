# Issue 8207 verification

## Scope and eligibility

Issue: https://github.com/open-mercato/open-mercato/issues/8207

Baseline: `e5774a707321fe14867a19663bc486d7a001492d`. Prerequisite PR #7986 merged as `df08109bf500d4aa59b4d1edc59d42eedd76d878`, verified as an ancestor. Its notification-access fix explicitly left this feedback issue for follow-up. Live issue/PR/timeline checks found no assignee, claim, or open implementation PR before this run claimed the issue.

The fix preserves recipient authorization and separates sharing eligibility from inaccessible recipients. Revoked owners, direct shares, role shares, and users without a share no longer receive an ineffective sharing offer. Successful comment saves show the existing localized information message for denied/skipped mentions. No title or identity data is added to the preflight response.

## Regression evidence

Runner: local. No running compose app was found. The initial `tsx` launch failed with `listen EINVAL` because the cockpit temporary directory made its Unix socket path too long. A short private task-specific temporary directory resolved this without changing repository code. The first full gate used only `TMPDIR`; an unchanged Shared test launched a child using the inherited long socket path and failed. Subsequent commands set `TMPDIR`, `TMP`, and `TEMP` together to this task’s own directory created by `mktemp -d /private/tmp/cz-XXXXXX`. Hooks use the same workaround.

| Exact command | Result |
|---|---|
| `yarn install --immutable` | PASS, warnings only |
| `yarn workspace @open-mercato/documents test --runInBand mentionAccessCheckRoute.test.ts documentCommentsReload.test.tsx` (before production fix) | Expected FAIL: 15 failed, 6 passed |
| `yarn workspace @open-mercato/documents test --runInBand mentionAccessCheckRoute.test.ts documentCommentsReload.test.tsx permissions.test.ts notificationRecipientAuthorization.test.ts commentsRouteCommands.test.ts mutationCommandContracts.test.ts` | PASS: 6 suites, 73 tests |
| `yarn workspace @open-mercato/documents typecheck` (final diff) | PASS, including integration specs |
| `yarn playwright test TC-DOCUMENTS-004 TC-DOCUMENTS-022 --config=.ai/qa/tests/playwright.config.ts --list` | PASS: 7 tests discovered in 2 files; discovery only |
| `yarn template:sync` | PASS |
| `yarn check:client-boundaries` | PASS; existing ledger warnings |
| `git diff --check` | PASS |
| `yarn workspace @open-mercato/documents test --runInBand versionRestoreUiLifecycle.test.tsx` | PASS: 1 suite / 1 test (1.917 seconds Jest); isolated check of unchanged test after workspace timeout |

## Configured ordered gate

Restarted in full with the short task-specific `TMPDIR` after the launch failure:

| Command | Result |
|---|---|
| `yarn build:packages` | PASS |
| `yarn generate` | PASS |
| `yarn build:packages` | PASS |
| `yarn i18n:check-sync` | PASS |
| `yarn i18n:check-usage` | PASS (906 seconds) |
| `yarn typecheck` | PASS |
| `yarn test` | First run: FAIL in unchanged Shared `dynamicLoader.generatedCacheRecovery.test.ts` (2 tests; `listen EINVAL`). Second run with all short temp variables: FAIL in unchanged `versionRestoreUiLifecycle.test.tsx` (preview button lookup timeout). Its isolated rerun passed. Full gate remains failed; no unrelated test repair. |
| `yarn build:app` | NOT RUN as a root gate command because the preceding gate failed. The native integration runner separately executed the app workspace's `yarn build` successfully (2,873 seconds); this does not make the ordered gate green. |

The completed Documents package portion of the first workspace test run passed **159 suites / 1,083 tests** (one suite / five tests skipped). The failing Shared test file has no diff from baseline. Workspace test execution stopped on that failure.

## Review and live evidence

An independent read-only reviewer applied the code-review checklist and found no actionable production-code defect. Its requested wrong-scope integration coverage was added and accepted: TC-DOCUMENTS-004 verifies foreign-tenant recipient eligibility, foreign caller denial, and absent recipient notifications; TC-DOCUMENTS-022 covers owner/direct-share/role-share/no-share revocation. Code-only verdict: approve, with no actionable findings. Full validation approval remains withheld pending the workspace gates and live API/browser execution; the reviewer ran no tests itself.

Hook tests provide automated client-behavior evidence for denied, mixed, granted, skipped, missing-metadata, failed-save, guarded-save, cancellation and context-change cases. Live API execution and browser screenshots remain unverified. The supplied app descriptors were stale, with absent PIDs and no listener. The parent clarified authorization for initialization strictly inside a new disposable database owned by the native runner.

`yarn test:integration:ephemeral 'TC-DOCUMENTS-(004|022)' --no-reuse-env --force-rebuild --keep` exited **124 after 3,600.5 seconds**. Fresh database initialization passed (399 seconds), package builds and generation passed, and the production app workspace build passed (2,873 seconds). The overall timeout interrupted app readiness after six seconds; **none of the seven API tests ran**. The resulting readiness/process-exit error was induced by termination, not evidence of an application defect. No unrelated service or persistent database was reused. Cleanup was verified: owned runtime descendants absent, disposable database container removed, app port free, ephemeral descriptor absent. The shared runtime slot was released.

The browser connector independently failed because of its socket-path length. A repository-native Playwright/Chromium smoke check passed with the short temporary-directory workaround, but it exercised only a data URL, **not this application**. No UI screenshot or live UI pass is claimed.

The second workspace failure is intermittent evidence in unchanged code: that same Documents test passed in the first full run and in its isolated rerun. Its cause is not proven. Host load increased further by the final check; another expensive retry was not started under those conditions. Publication is blocked by the failed full gate; no branch push or PR was attempted. The local implementation is retained for independent verification. PR review and post-publication QA were not invoked because the publication gate was not met.

Notification persistence continues to revalidate access. The preflight remains advisory: permission changes between preflight and delivery are still handled by the existing fail-closed notification checks, without a new delivery acknowledgement contract.

## Remaining QA scenarios

1. Create scoped users with owner, direct editor share, role editor share, and no share; revoke their role’s `documents.view` while retaining notification access. Mention each in a comment. Save succeeds with the information flash, no ineffective “Share and notify” dialog appears, and no document notification/title reaches the recipient.
2. Mention a mixture of a revoked recipient and a permitted user without a share. The dialog contains only the shareable recipient; sharing grants only that user and the saved comment still reports the denied mention.
3. Repeat the permitted no-share case with `documents.*` and `*`; sharing remains available. Declining sharing yields feedback after save. Failed, guarded, cancelled, or obsolete submissions do not display the notification warning as though saved.
4. Run the self-contained TC-DOCUMENTS-004 and TC-DOCUMENTS-022 API cases against an owned initialized environment, including cross-tenant caller/recipient rejection and preserved editor shares.
