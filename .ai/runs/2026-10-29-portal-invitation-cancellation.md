# Portal invitation cancellation

## Goal

Implement issue #7275: staff can withdraw a pending invitation while preserving tenant/organization isolation and invitation history.

Source doc: .ai/specs/2026-10-29-portal-invitation-cancellation.md
Spec PR: #8209
Engine: om-auto-create-pr (steps: 5, --loop: no)

## Scope

Only the customer_accounts invitation lifecycle, existing staff API, pending-invitation CRM widget, translations, and regression coverage.

## Non-goals

No TTL, portal permission, user account revocation, schema, dependency, or external-module change.

## Implementation Plan

### Phase 1: Lifecycle and staff API

1.1 Add atomic scoped cancellation and transactional acceptance coordination, with service regression tests.
1.2 Add guarded cancellation API, command/event wiring, schema, OpenAPI, and route tests.

### Phase 2: Staff workflow and verification

2.1 Add translated confirmation/action and widget regression tests.
2.2 Add self-contained integration tests for lifecycle, authorization, and scope isolation.
2.3 Run configured validation, review, and UI QA where the environment permits.

## Risks

Cancellation must not race a user into existence after a successful pending-state transition. Native conditional updates and the acceptance transaction coordinate this without a schema migration. Runner: local (compose probes found no running app at gate selection); dependencies were installed from the immutable lockfile. Spec source is materialized from #8209 and deliberately excluded from implementation commits until its separate PR merges.

### Verification evidence

- The complete customer_accounts Jest suite passed: 90 suites and 833 tests. The Windows CLI testMatch override avoids mixed-separator discovery skipping the suite.
- Both configured package builds, module generation, translation sync, workspace typecheck, and the application production build passed before syncing the latest main. Template parity and the lessons catalog also passed.
- A follow-up core typecheck after the main merge reported stale generated WMS entity IDs. Regeneration fixed them, and the final core typecheck and production application build passed.
- The full workspace test command remains blocked by forty create-app failures, including `spawnSync('yarn.cmd')` on Windows (`EINVAL`), null shell exit status, containment, and installed-harness checks. The sandbox-only Docusaurus ownership failure was cleared by rerunning outside the sandbox. No unrelated production code or tests were changed.
- The final translation-usage scan passed with no missing keys; unused-key notices are advisory.
- Independent lifecycle review passed. A second review's selected-organization, structured 409, and telemetry-failure findings were fixed and re-reviewed with no remaining findings.
- Final managed integration verification passed all five scenarios in 42.9 seconds, with zero failures, skips, or flaky retries. It covers cancellation/acceptance concurrency, the CRM confirmation/keyboard workflow, token invalidation/idempotency, scope isolation with original acceptance preserved, and permissions/expired invitations. Set `OM_INTEGRATION_MODULES=customer_accounts` for bounded Playwright matching. The UI test explicitly expands the existing form panel and sends shortcuts to the dialog controls. Three screenshots capture pending, confirmation, and completed states. No developer database was migrated; the test email-capture artifact was restored after execution so one-time tokens are not committed.
- GitHub rejected a formal request-changes review because the current identity is also the PR author; the full review report is posted as a comment. No formal approval or QA sign-off is claimed.
- Standalone harness coverage is evidence-only: existing guarded action command, mutation-guard, and typed-event cases cover the mechanisms. No new discovery convention or harness knowledge owner is introduced.

## Progress

PR: #8212

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Lifecycle and staff API

- [x] 1.1 Add atomic scoped cancellation and transactional acceptance coordination, with service regression tests. — a98297a9a, 295102746
- [x] 1.2 Add guarded cancellation API, command/event wiring, schema, OpenAPI, and route tests. — 295102746, cbadb73ee

### Phase 2: Staff workflow and verification

- [x] 2.1 Add translated confirmation/action and widget regression tests. — 418d31a3d, cbadb73ee
- [x] 2.2 Add self-contained integration tests for lifecycle, authorization, and scope isolation. — cbadb73ee
- [ ] 2.3 Run configured validation, review, and UI QA where the environment permits.

Step 2.3 remains open only because the configured full workspace `yarn test` gate fails in create-app. The feature's code review, module validation, production builds, and real API/browser integration verification are complete. The PR stays draft with `changes-requested` and `needs-qa`; resume with `om-auto-continue-pr 8212` after the workspace gate can pass on a supported environment or its unrelated failures are addressed.
