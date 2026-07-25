# Reconcile payment-session amount with the authoritative order total

## Overview

Goal: close the remaining half of the client-trusted payment amount report (issue #4488, follow-up to #4486). `POST /api/payment_gateways/sessions` currently forwards the caller-supplied `amount` straight to the gateway adapter, so a caller that references an order can start a provider session for an amount that has nothing to do with what that order is actually due.

## Scope

- Add a reconciliation seam to `payment_gateways` that resolves the authoritative amount due for a referenced order before any provider call happens.
- Keep `payment_gateways` decoupled from feature modules: the seam is an optional DI contract, and the `sales` module supplies the resolver for its own orders.
- Reject mismatched amounts and currencies with a conflict response instead of creating a gateway session.
- Scope every order lookup by tenant and organization so an out-of-scope order id is indistinguishable from a missing one.
- Cover matching, lower, higher, currency-mismatch, missing, cross-scope, and no-resolver cases with unit tests.
- Document the reconciliation rule in the payment gateway specification and the API docs.

## Non-goals

- No change to capture/refund/cancel amount handling (already hardened by #4486).
- No new database columns, migrations, or persistence of the order reference on `GatewayTransaction`.
- No partial-payment or deposit workflow: the session amount must equal the amount currently due.
- No changes to the checkout package, which already derives its amount server-side and passes no `orderId`.

## Implementation Plan

### Phase 1: Reconciliation seam in payment_gateways

1. Add the shared `PaymentOrderTotalResolver` contract and a pure reconciliation helper with the amount/currency comparison rules.
2. Enforce reconciliation in `createPaymentSession` before the adapter and session-claim work runs.
3. Map conflict errors to their HTTP status in the sessions route instead of collapsing them into 502.

### Phase 2: Authoritative sales order totals

1. Implement the tenant/organization-scoped sales order total resolver and register it in the sales DI container.
2. Resolve the optional resolver in the payment_gateways DI container without hard-coupling the modules.

### Phase 3: Regression coverage and documentation

1. Add unit coverage for matching, lower, higher, currency-mismatch, missing, cross-scope, and absent-resolver cases.
2. Document the reconciliation behavior in SPEC-044 and the payment gateway API docs.

## Risks

- Rejecting an unresolvable `orderId` is a behavior change for callers that used the field as a free-form external reference; mitigated by the fact that the field is documented as the sales order reference, no in-repo caller passes it today, and the alternative (fail-open) leaves a trivial bypass.
- A stale `outstanding_amount` on legacy orders could block a session; mitigated by falling back to the grand total when nothing has been paid or refunded yet.
- Registering a new DI name in `sales` must not break tenants without the sales module; mitigated by resolving it optionally in payment_gateways and skipping reconciliation when it is absent.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Reconciliation seam in payment_gateways

- [ ] 1.1 Add the resolver contract and the reconciliation helper
- [ ] 1.2 Enforce reconciliation in createPaymentSession before provider calls
- [ ] 1.3 Return conflict statuses from the sessions route

### Phase 2: Authoritative sales order totals

- [ ] 2.1 Implement and register the scoped sales order total resolver
- [ ] 2.2 Wire the optional resolver into payment_gateways DI

### Phase 3: Regression coverage and documentation

- [ ] 3.1 Add unit coverage for the reconciliation matrix
- [ ] 3.2 Document the behavior in SPEC-044 and the API docs
