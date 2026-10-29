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

Cancellation must not race a user into existence after a successful pending-state transition. Native conditional updates and the acceptance transaction coordinate this without a schema migration. No application or database container is currently running. Runner: local (compose probes found no running app); dependencies are being installed from the immutable lockfile. Spec source is materialized from #8209 and deliberately excluded from implementation commits until its separate PR merges.

### Verification evidence

- The complete customer_accounts Jest suite passed: 90 suites and 833 tests. The Windows CLI testMatch override avoids mixed-separator discovery skipping the suite.
- Both configured package builds, module generation, translation sync, workspace typecheck, and the application production build passed before syncing the latest main. Template parity and the lessons catalog also passed.
- A follow-up core typecheck after the main merge reported stale generated WMS entity IDs; regenerate those registries before the final typecheck.
- The full workspace test command is blocked by existing create-app tests invoking `spawnSync('yarn.cmd')` on Windows (`EINVAL` / null exit status). The sandbox-only Docusaurus ownership failure was cleared by rerunning outside the sandbox. No unrelated production code or tests were changed.
- The first translation-usage scan captured dictionaries before the audit label was added, then observed its call site. A final scan is running against the completed locale files.
- Independent lifecycle review passed. A second review's selected-organization, structured 409, and telemetry-failure findings were fixed and re-reviewed with no remaining findings.
- Integration/API/UI verification is running through the fully managed ephemeral runner on its own database. No developer database was migrated.
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
