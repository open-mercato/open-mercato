# Issue 9153 validation and review evidence

## Scope and behavior

The repair uses module-local PostgreSQL state and the existing ORM, event and notification mechanisms. The existing attempt limit and challenge timeout govern an account-wide failure window and temporary lock. Successful TOTP proofs, including enrollment confirmation, retain their matched absolute step. Account accounting, accepted provider metadata and challenge consumption commit under one tenant/user transaction lock.

No startup command, environment variable, dependency, DI key, provider interface or HTTP schema changes. The additive schema requires the normal migration rollout; see [Migration & Backward Compatibility](../../specs/enterprise/2026-11-16-mfa-verification-budget-and-replay.md#migration--backward-compatibility). No project `db:migrate` was run. The generated migration creates only the new table/constraint; its explicitly authorized narrow down drops only that table. Unrelated generated migration drift was removed.

## Runner and bounds

Runner: local; the documented compose probe found no running application container. Commands used `TMPDIR=/tmp`, serial Turbo tasks, bounded Node heaps, bounded Jest workers and command timeouts. `--env-mode=loose` is required on the full test runner so Turbo forwards the short temporary path to child `tsx` processes. These are validation-process settings, not application configuration changes.

## Focused regression evidence

Command (240-second bound, 2 GiB Node heap):

```sh
TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=2048 OM_PG_INTEGRATION=1 timeout 240 yarn workspace @open-mercato/enterprise test --runInBand --runTestsByPath src/modules/security/services/__tests__/MfaVerificationService.postgres.test.ts src/modules/security/services/__tests__/MfaVerificationService.test.ts src/modules/security/lib/__tests__/TotpProvider.test.ts src/modules/security/subscribers/__tests__/mfa-verification-locked-notification.test.ts
```

**PASS: four suites, 44 tests, 4.398 seconds.** Seven PostgreSQL cases use actual independent entity managers and a three-connection pool, including actual migration execution up/down, uniqueness and preservation of existing MFA data. Other cases prove failure accounting across fresh challenges, lock expiry without extension, cross-instance replay, concurrent success/failure, unrelated-account liveness, wrong-owner/tenant isolation, and rollback after provider evaluation. Unit coverage includes both synchronous and asynchronous provider validation errors, drifted counters and enrollment-proof reuse. Subscriber coverage checks scoped recipient resolution and idempotent delivery grouping without proof variables.

An independent parent task reran these same four suites: **44/44 PASS in 7.293 seconds**. This is scoped independent source/test assessment, not native GitHub approval or a full-gate signoff.

Before the repair, five new tests in the original 31-test focused subset failed against the original service/provider source at `08dada96243eeaf690d00314f18844a12382ab1c`; restoring the repair made that subset pass. Later coverage increased the total to 44.

```sh
TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=1024 timeout 120 node --test apps/docs/__tests__/notification-registry.test.mjs
```

**PASS: 7/7.** The new notification row and registry denominator match the source. The direct shared bootstrap temporary-path recheck also passes **2/2**.

## Configured validation gate

| Configured command | Result | Bounded local equivalent / evidence |
| --- | --- | --- |
| `yarn build:packages` | PASS | `NODE_OPTIONS=--max-old-space-size=2048 timeout 600 yarn build:packages --concurrency=1` |
| `yarn generate` | PASS | `NODE_OPTIONS=--max-old-space-size=2048 OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_SECURITY=true timeout 300 yarn generate --concurrency=1 --env-mode=loose`; optional security registry verified |
| `yarn build:packages` | PASS | Same serial package build after generation |
| `yarn i18n:check-sync` | PASS | 300-second bound, 2 GiB heap |
| `yarn i18n:check-usage` | PASS | 600-second bound, 2 GiB heap; unused-key advisories remain advisory |
| `yarn typecheck` | PASS | `NODE_OPTIONS=--max-old-space-size=4096 timeout 600 yarn typecheck --concurrency=1`; 42 successful tasks |
| `yarn test` | INCOMPLETE | `NODE_OPTIONS=--max-old-space-size=1024 timeout --kill-after=10s 600 yarn turbo run test --concurrency=1 --env-mode=loose`; exit 124 at 600 seconds, 27/49 Turbo tasks successful; no assertion failure reported in that retry |
| `yarn build:app` | PASS | `NODE_OPTIONS=--max-old-space-size=4096 timeout 900 yarn build:app --concurrency=1`; production compilation/typechecking succeeded |

Every command above also used `TMPDIR=/tmp`. The full repository unit gate is **not green** and cannot support approval. Its corrected run passed the shared suite (270 suites, 3351 tests) and UI suite (330 suites, 2973 tests), but core/remaining tasks had not completed at the bound.

The complete affected security suite additionally passed with `TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=2048 timeout 300 yarn workspace @open-mercato/enterprise test --runInBand src/modules/security`: **42 suites / 391 tests PASS**, with only the explicit PostgreSQL opt-in suite skipped there. All seven PostgreSQL cases passed separately in the 44-test run above. Thus the full module has coverage across both runs; this does not replace the incomplete full repository gate.

Historical failures corrected during this run: Korean locale key ordering; missing notification-map row/count; and two shared bootstrap tests failing when Turbo strict mode discarded `TMPDIR`, producing an overlong `tsx` socket path. None is treated as a successful run. The corrected full test command is the serial equivalent `TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=1024 yarn turbo run test --concurrency=1 --env-mode=loose`.

## Hosted CI continuation: OTP integration semantics

The original head `b5a74178f64ebffd5f7a201678b2d134a0980501` failed [ephemeral integration](https://github.com/open-mercato/open-mercato/actions/runs/43781116468/job/133019833018) because TC-SEC-003 still expected success after exhausting the account. TC-SEC-014 had been updated, but the email OTP counterpart was missed. Production correctly returned 401; changing the security control to satisfy that expectation would be wrong.

TC-SEC-003 now verifies a successful OTP response (`200`, `ok`, redirect) on its newly created, unlocked fixture before failures. It then exhausts another challenge and requires 401/error when the exhausted account submits the correct code on a fresh challenge. The existing non-pending-token refusal, exhausted-challenge check, enrollment/UI and cleanup coverage remain. The invalid proof is deliberately different from the generated OTP, removing the random chance of choosing a valid negative-test code. No production source, API, migration or configuration changes accompany this follow-up.

| Failure | Diagnosis / owner | Evidence / disposition |
| --- | --- | --- |
| Hosted TC-SEC-003 expected 200, received 401 (including retry) | Stale test semantics; Agent/QA, high confidence | Hosted log plus downloaded error-context artifacts identify the post-exhaustion success assertion. Fixed without weakening production behavior or removing positive coverage. |
| First local managed run stopped before tests, app build could not find `cross-env` | Local launcher environment; Agent, high confidence | The direct CLI launcher lacked the root dependency-bin path normally supplied by Yarn. Repaired its temporary PATH; no dependency or committed launcher/config change. |

The actual scoped repository CLI was rerun with an isolated Postgres database, full runner-provided environment and owned teardown:

```sh
PATH="/tmp/9153-testbin:$PWD/node_modules/.bin:$PATH" TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=4096 OM_ENABLE_ENTERPRISE_MODULES=true OM_ENABLE_ENTERPRISE_MODULES_SECURITY=true OM_TEST_MODE=true OM_ENABLE_TEST_CHANNEL_SEEDING=true OM_WEBHOOKS_ALLOW_PRIVATE_URLS=1 SELF_SERVICE_ONBOARDING_ENABLED=true OM_OPTIMISTIC_LOCK=all OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS=180 MOCK_INBOUND_WEBHOOK_SECRET=ephemeral-9153-webhook-secret timeout --kill-after=15s 1200 node packages/cli/dist/bin.js test:integration TC-SEC-003
```

`/tmp/9153-testbin/yarn` is an uncommitted resource adapter that forwards Yarn and adds only existing `--concurrency=1 --env-mode=loose` flags to package builds launched by the CLI. The root dependency-bin PATH preserves normal script resolution. The CLI owns the disposable database initialization, application build, complete Playwright environment injection and teardown; no project database migration command was run.

**PASS: 1 test, 0 skipped, 0 flaky/unexpected, 4.871 seconds in the test.** Playwright took 221.372 seconds including discovery; the full cold CLI run took 460.039 seconds, including an application build of 161 seconds. The configured Email OTP methods page screenshot was inspected and contains no proof/secret data; it is retained in the cockpit artifacts as `mfa-otp-after.png`. This is scoped browser/API evidence, not broad manual QA or approval. The CLI removed its ephemeral state and stopped its environment. Test-created tracked email-capture output was restored without publishing it.

The follow-up must start CI on its own exact new head; prior-head green checks are historical, not a signoff for the new commit. The historical full local unit timeout remains reported, and `automerge`, `needs-qa` and review/native gates remain unchanged under parent assessment.

## Review and QA limits

The implementing task performed the installed code-review checklists and compatibility review. The parent independently read the production, migration and spec diff and found no additional source defect; it owns final assessment and automerge eligibility. No self-review is represented as independent native approval.

No rendering component changed, so the UI-rendering branch of `om-auto-qa-pr` does not apply. Manual QA remains required for the schema/authentication change (`needs-qa`): exercise login and MFA-backed sudo with fresh codes, lockout/unlock and separate accounts, inspect notification UI/email delivery without publishing QR/proof material, and rehearse migration/rollback in a disposable environment. TC-SEC-014 now rejects fresh challenges after exhaustion; the integration helper uses a fresh next-window code within the existing default tolerance after enrollment. Initial publication did not claim live Playwright/API/UI evidence (its discovery attempt exceeded 90 seconds). The continuation above now supplies actual scoped TC-SEC-003 API/browser execution and an inspected screenshot; broader manual QA remains unclaimed.

Required CI, QA approval and current-head independent review continue to gate merge. The parent subsequently authorized the guarded `automerge` intent label after scoped independent assessment: existing startup/configuration/architecture are preserved. The label does not supply native review, full-gate or QA approval; `needs-qa` and the validation block remain. No remote merge is performed by this task.
