# Issue 9150 — implementation and validation report

Status: partial pending independent review and live API QA.
PR: https://github.com/open-mercato/open-mercato/pull/9329
Branch: fix/issue-9150-protect-superadmin-mfa
Source commit: 92a176abbd71c0022b2270dccf85e29924b7f4a0

## Change and review scope

The existing core superadmin-target guard now protects MFA status, route reset and direct reset-command entrypoints. Route scope checks still precede it, and sudo remains mandatory for route resets. The command retains the existing service scope. All calls use bound RBAC from trusted actor context. No service/route schemas, signatures, ACL identifiers, DB, startup/configuration, architecture or dependencies changed. No core/auth implementation or shared compatibility/governance files were edited.

Reviewed the actual published diff against main, existing MFA cross-tenant spec and core grant-check policy, repository compatibility contract and review/security checklists. The initial author review missed the direct-command scope ordering; the parent review caught it and the follow-up below corrects it. Additional SQL statement count was not measured because no runnable app was available; the new guard delegates its queries to the established core helper.

## Regression evidence

- Before the fix: real-guard entrypoint regression failed for both direct and role-based protected targets (status returned 200 instead of 403).
- After the fix: final security suite, 42 suites / 390 tests PASS.
- The nine new real-guard cases independently deny each of three entrypoints for direct/role target grants and preserve ordinary-target and superadmin-actor success.
- Existing route/service regressions retain cross-tenant/out-of-org denial, sudo and error mapping.
- TC-SEC-016-issue-9150 supplies self-contained API fixtures and cleanup. Live API execution is NOT VERIFIED: bounded Playwright startup attempts produced no completed execution, localhost:3000 refused connections, and no reusable test-env descriptor/entrypoint was available. No out-of-scope environment/configuration changes were made.

## Configured validation

Runner: local. No configured compose app container was running. Each gate command had a 300-second process limit and ran in configured order.

| Command | Initial result |
| --- | --- |
| yarn build:packages | PASS (0) |
| yarn generate | PASS (0) |
| yarn build:packages | PASS (0) |
| yarn i18n:check-sync | FAIL (1) |
| yarn i18n:check-usage | FAIL (1) |
| yarn typecheck | PASS (0) |
| yarn test | FAIL (1) |
| yarn build:app | PASS (0) |

Translation sync/usage initially failed with a long agent TMPDIR socket EINVAL; both PASS with TMPDIR=/tmp.
Full tests failed in shared dynamicLoader.generatedCacheRecovery.test.ts because strict Turbo environment propagation discarded shortened TMPDIR; a strict retry reproduced it. TMPDIR=/tmp yarn test --env-mode=loose then reached the 300-second bound (exit 124; 32/49 tasks completed). No full-suite pass is claimed.
Direct enterprise typecheck (before generation completed) reported unresolved generated aliases and unchanged record_locks/backend/settings/record-locks/page.tsx:44; no changed-file error was observed.
Template parity PASS with TMPDIR=/tmp (initial attempt hit the same runner socket issue).
Dependency installation completed without lockfile changes, with existing peer/native optional-build warnings.

## Publication and pipeline

User explicitly authorized a new dedicated branch/PR and automerge labeling when startup/configuration/architecture remain unchanged. Those conditions hold; automerge was added, with no native auto-merge enabled and no PR/base merge performed.
Labels: bug, security, enterprise, priority-low (inherited urgency), risk-high (auth-rule risk takes precedence over issue risk-low), needs-qa, backport release/v0.9.x, automerge. Review/pipeline and claim meta labels are maintained on the PR.
No QA approval or self-QA label was applied. Independent formal approval is not earned by an author self-review; remaining limits are reported on the PR.

## Claim audit

Issue atomic lock 5efd4ef771f08a28798fc5931a48a3cd87b35f32 was acquired only after rechecking open state, all comments, assignees, implementing PRs and audited resets. Claim comment 6822172708 was marked released; in-progress removed; exact-SHA lease deletion verified absence.
PR claim 384241ab49f9a7049478226c1c8bdeabf71f1981 / comment 6822370112 continues the same run through final evidence publication. Its terminal cleanup is recorded in the PR release comment and parent task report.
Operator GitHub App exception followed: no self-assignment and no foreign assignment edits. No children dispatched.

Review and QA evidence: see PR conversation and final task report.

## Changed files

- packages/enterprise/src/modules/security/api/users/[id]/mfa/reset/route.ts
- packages/enterprise/src/modules/security/api/users/[id]/mfa/status/route.ts
- packages/enterprise/src/modules/security/commands/resetUserMfa.ts
- packages/enterprise/src/modules/security/api/users/__tests__/mfa-reset.route.test.ts
- packages/enterprise/src/modules/security/api/users/__tests__/mfa-status.route.test.ts
- packages/enterprise/src/modules/security/api/users/__tests__/superadmin-mfa-entrypoints.test.ts
- packages/enterprise/src/modules/security/__integration__/TC-SEC-016-issue-9150.spec.ts
- .ai/specs/enterprise/2026-11-12-issue-9150-superadmin-mfa.md
- .ai/runs/issue-9150-superadmin-mfa.md

## Exact additional commands

- timeout 300 yarn install --immutable: PASS (warnings only; lockfile unchanged).
- timeout 180 yarn workspace @open-mercato/enterprise test --runInBand --runTestsByPath src/modules/security/api/users/__tests__/mfa-reset.route.test.ts src/modules/security/api/users/__tests__/mfa-status.route.test.ts src/modules/security/api/users/__tests__/superadmin-mfa-entrypoints.test.ts: PASS, initial 13 tests.
- TMPDIR=/tmp timeout 180 yarn workspace @open-mercato/enterprise test --runInBand src/modules/security: PASS, final 390 tests.
- timeout 120 yarn workspace @open-mercato/enterprise typecheck: FAIL, generated aliases and existing record_locks error described above.
- TMPDIR=/tmp timeout 60 yarn i18n:check-sync: PASS.
- TMPDIR=/tmp timeout 60 yarn i18n:check-usage: PASS (unused keys advisory).
- TMPDIR=/tmp timeout 60 yarn template:sync: PASS.
- TMPDIR=/tmp timeout 300 yarn test: FAIL, same shared bootstrap runner socket error (strict Turbo env).
- TMPDIR=/tmp timeout 300 yarn test --env-mode=loose: TIMEOUT 124 after 300 seconds, 32/49 tasks completed.
- TMPDIR=/tmp timeout 60 yarn playwright test packages/enterprise/src/modules/security/__integration__/TC-SEC-016-issue-9150.spec.ts --config=.ai/qa/tests/playwright.config.ts --retries=0: no completed test result within bound.
- OM_ENABLE_ENTERPRISE_MODULES=true TMPDIR=/tmp timeout 30 node node_modules/@playwright/test/cli.js test packages/enterprise/src/modules/security/__integration__/TC-SEC-016-issue-9150.spec.ts --config=.ai/qa/tests/playwright.config.ts --list: no usable discovery output within bound.
- git diff --check: PASS.
- PR checks at source head: lint, ds-lint, audit-scope, CLA and CodeQL checks passing; prepare pending, no failing check reported. Branch-protection required-check read returned 404, so reported checks remain required for this run.
- QA handoff: https://github.com/open-mercato/open-mercato/pull/9329#issuecomment-6822426743

## Parent-review correction — scope before privilege

Parent review confirmed a disclosure in the first version: a foreign-tenant superadmin could receive 403 from direct command invocation before MfaAdminService enforced scope, whereas missing/out-of-scope ordinary targets returned 404.

The command now performs an explicit tenant/deleted filter through the existing findOneWithDecryption helper, followed by the same organization check as the service, before invoking the superadmin-target guard. Missing tenant/target, foreign tenant, deleted user and mismatched organization all yield the existing translated 404 without querying target ACLs/roles. The existing private service loader and service scope remain unchanged; no public methods/signatures or architecture were added.

Seven regressions failed before this correction (7 failed / 9 passed) and now all 16 entrypoint regressions pass. Updated security suite: **42 suites / 397 tests PASS**.
Follow-up validation (local):
- TMPDIR=/tmp timeout 180 yarn workspace @open-mercato/enterprise test --runInBand src/modules/security: PASS, 397 tests.
- TMPDIR=/tmp timeout 120 yarn workspace @open-mercato/enterprise build: PASS.
- TMPDIR=/tmp timeout 120 yarn generate: PASS.
- TMPDIR=/tmp timeout 120 yarn workspace @open-mercato/enterprise typecheck: PASS; the earlier generated-alias/record_locks errors no longer reproduce after generation.
- git diff --check: PASS.

The earlier full-gate results are historical implementation evidence; full-suite completion and live API QA remain external validation limits. No additional broad gate loop was started for this one-module follow-up. Independent GitHub approval is a normal external gate; the author COMMENT review supplies technical evidence and is not approval.

Lesson recorded within scope: enforce record visibility before inspecting global privilege state, so stronger account protection cannot become an out-of-scope existence oracle. The shared lesson index was inspected; shared lesson-file edits are outside this task order.
