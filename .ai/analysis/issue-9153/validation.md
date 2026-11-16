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

## Review and QA limits

The implementing task performed the installed code-review checklists and compatibility review. The parent independently read the production, migration and spec diff and found no additional source defect; it owns final assessment and automerge eligibility. No self-review is represented as independent native approval.

No rendering component changed, so the UI-rendering branch of `om-auto-qa-pr` does not apply. Manual QA remains required for the schema/authentication change (`needs-qa`): exercise login and MFA-backed sudo with fresh codes, lockout/unlock and separate accounts, inspect notification UI/email delivery without publishing QR/proof material, and rehearse migration/rollback in a disposable environment. TC-SEC-014 now rejects fresh challenges after exhaustion; the integration helper uses a fresh next-window code within the existing default tolerance after enrollment. Live Playwright/API/UI execution and screenshots are not claimed; the scoped discovery attempt exceeded its 90-second bound without output.

Required CI, QA approval and current-head independent review continue to gate merge. The parent subsequently authorized the guarded `automerge` intent label after scoped independent assessment: existing startup/configuration/architecture are preserved. The label does not supply native review, full-gate or QA approval; `needs-qa` and the validation block remain. No remote merge is performed by this task.
