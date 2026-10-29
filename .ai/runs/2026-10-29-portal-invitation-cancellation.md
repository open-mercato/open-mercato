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

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Lifecycle and staff API

- [ ] 1.1 Add atomic scoped cancellation and transactional acceptance coordination, with service regression tests.
- [ ] 1.2 Add guarded cancellation API, command/event wiring, schema, OpenAPI, and route tests.

### Phase 2: Staff workflow and verification

- [ ] 2.1 Add translated confirmation/action and widget regression tests.
- [ ] 2.2 Add self-contained integration tests for lifecycle, authorization, and scope isolation.
- [ ] 2.3 Run configured validation, review, and UI QA where the environment permits.
