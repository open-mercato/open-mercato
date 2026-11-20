# Carrier shipment visibility and repeat-dispatch warning

Goal: Deliver #3562 and #3563 through a scoped carrier shipment summary API, the existing order Shipments-tab injection host, and explicit acknowledgement before a repeat dispatch.

Source doc: .ai/specs/2026-11-20-carrier-shipment-visibility.md
Design PR: #10042
Status: in-progress
Engine: om-auto-create-pr (steps: 7, --loop: no)

## Scope

Shipping-carriers read API, typed response projection, paginated order widget, wizard history check and warning, five locales, focused unit/component tests and self-contained Playwright integration tests. Reuse existing DataTable, injection, permission and guarded-mutation mechanisms.

Non-goals: optional global list, quantity/fulfillment enforcement, carrier/sales-shipment linkage, schema/migrations, provider calls for listing, production dependencies, shared UI/governance changes. The design document is materialized locally from #10042 and merges through that design PR, not this implementation branch.

## Implementation Plan

### Phase 1: Scoped read API

1. Add query validation, permission checks, scoped/decrypted summaries and OpenAPI GET documentation.
2. Prove permission, scoping, deletion, ordering and pagination behavior in route tests.

### Phase 2: User-facing flows

1. Add a paginated carrier-owned section at `detail:sales.order:shipping`.
2. Add wizard history loading, acknowledgement, changed-count recheck and retry behavior.
3. Add all five locales and meaningful component regressions.

### Phase 3: Verification and delivery

1. Add self-contained integration coverage, run generation and configured validation, and capture browser evidence.
2. Review compatibility/security/design-system behavior, apply findings, publish final evidence and ready status.

## Risks

Tenant/organization leakage is prevented by trusted scope and tested explicitly. History counts are advisory: a changed count invalidates acknowledgement but simultaneous creates are not serialized by this UI. Existing create idempotency and mutation guards remain authoritative. Failed history reads block wizard submission with a retry path. No migrations or live carrier credentials are required.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Scoped read API

- [ ] 1.1 Add validated and scoped carrier shipment summaries.
- [ ] 1.2 Add route permission, scoping and pagination regressions.

### Phase 2: User-facing flows

- [ ] 2.1 Inject the paginated carrier shipment section into order shipping.
- [ ] 2.2 Add wizard acknowledgement, history recheck and retry behavior.
- [ ] 2.3 Add five-locale copy and component regressions.

### Phase 3: Verification and delivery

- [ ] 3.1 Add integration coverage and run validation/browser checks.
- [ ] 3.2 Complete review, publish evidence and mark implementation ready.
