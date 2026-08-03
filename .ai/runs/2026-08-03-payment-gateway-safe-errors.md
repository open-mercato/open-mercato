# Payment Gateway Safe Error Follow-up

## Overview

Follow up on the non-blocking review feedback from superseded PR #4870 and merged replacement PR #4894.

## Goal

Prevent internal payment-session failures from leaking through the sessions API while preserving a useful 422 response for unsupported gateway providers and strengthening the affected logger test mock.

## Scope

- Map missing gateway adapters through the existing typed HTTP error contract.
- Return a generic 502 response for unexpected payment-session failures.
- Add route and service regression coverage for the safe mappings.
- Broaden the payment-gateway idempotency test logger mock to cover the logger facade methods used by the module.

## Non-goals

- Change the payment-session API route, method, or response shape.
- Change provider execution, idempotency, claim, or transaction behavior.
- Localize all existing payment-gateway API messages.
- Modify database, event, DI, or public import contracts.

## Implementation Plan

### Phase 1: Safe payment-session error mapping

1. Route missing-adapter failures through `CrudHttpError` and map unexpected session errors to a generic 502 body.
2. Add focused service and route regression tests covering the typed 422 and generic 502 behavior.

### Phase 2: Test robustness and validation

1. Expand the idempotency suite's logger mock with no-op `debug`, `info`, and `error` methods.
2. Run focused module validation followed by the configured repository gate and review the final diff for compatibility and security concerns.

## Risks

- Some clients may have read raw provider error text from the 502 `error` field. The field and status remain stable, but the value becomes intentionally generic to prevent internal information disclosure.
- The typed 422 mapping must preserve the existing unsupported-provider behavior without relying on message substring matching.
- The configured validation gate is blocked on current `develop` by 21 unrelated missing i18n keys and unrelated app/docs test fixture failures; branch-specific tests, builds, generation, typecheck, and the app production build pass.

## Progress

PR: #4898

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Safe payment-session error mapping

- [x] 1.1 Route missing-adapter failures through a typed HTTP error and sanitize unexpected 502 responses — c88ca2ac9f
- [x] 1.2 Add focused service and route regression tests — c88ca2ac9f

### Phase 2: Test robustness and validation

- [x] 2.1 Expand the idempotency suite logger mock — 88cf0de486
- [ ] 2.2 Run the configured validation and compatibility review
