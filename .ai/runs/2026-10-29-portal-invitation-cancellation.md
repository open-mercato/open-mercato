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

Step 2.3 remains open pending validation of the review-fix head and manual QA. The earlier Windows-only workspace failures above were superseded by green head-specific CI at `e309e8afb9c441541c0dfdb17c3a1d6f55088810` ([run 40915273795](https://github.com/open-mercato/open-mercato/actions/runs/40915273795)); that result does not cover the follow-up source changes below. The PR stays draft with `changes-requested` and `needs-qa`.

### Review-fix continuation (2026-10-29)

- Spec review 5701454860 exposed three remaining runtime gaps: cancellation alone used the selected organization rather than the GET/POST authenticated organization, the new guard resource used a dot rather than the registered colon key, and resend could rotate a row after cancellation.
- DELETE now derives its permission, guard and command scope entirely from authenticated tenant/organization values, including the command interceptor context. The command independently ignores selected-organization overrides. Client guard, server guard and audit use `customer_accounts:customer_user_invitation`.
- Resend performs a refreshed pending-state lookup with a pessimistic write lock inside the same transaction as encrypted managed-entity mutation and flush. It rechecks terminal state and expiry after waiting. Cancellation first leaves the terminal row untouched and follows the existing fresh-invitation path; resend first holds the lock until flush so cancellation then revokes the rotated token. Existing entity-instance/rollback, eligibility, TTL, encryption and event contracts are preserved.
- Cancel visibility uses the existing wildcard-aware feature helper after backend capabilities are ready. View-only users retain pending details; exact invite, module wildcard and global wildcard grants permit the action. Server permission checks remain authoritative. The existing cancellation event already declares its lifecycle category, label and client broadcast metadata.
- Local runner with read-only reusable dependencies: 9 focused Jest suites / 96 tests pass, including original GET/POST callers, actual route/guard/command/service/event/audit wiring, both resend/cancel orderings, expiry during lock wait and wildcard UI behavior. A narrow TypeScript check covering changed source/tests and their imports passes. Lessons catalog and whitespace checks pass. Negative controls against prior production source fail for resend, scope/registered guards and capability visibility.
- Seven Playwright scenarios discover, including two added real API/PostgreSQL regressions for a differing organization cookie and cancellation while resend waits on a row lock. No app prepared from this source was available, so the two new scenarios have not been executed locally. No database bootstrap or local migration was performed. Earlier five-scenario browser evidence belongs to the previous implementation head.
- The scoped continuation releases its own claim after publishing; existing draft, assignee, review and QA requirements remain intact. No approval or merge is claimed.
