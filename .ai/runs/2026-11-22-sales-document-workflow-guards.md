# Sales document workflow guards

Source doc: .ai/specs/2026-11-22-sales-document-workflow-guards.md
Design PR: #10303
Issue: #3533
Claim-Run: eee20e76-4751-4783-bda1-cc1e2b80ca58
Claim comment: 7072872820
Claim lock: refs/om-locks/issue-3533 @ 0e928a4e8d7001d47377bc65a175a7f687d81af8

## Goal

Implement opt-in order-status and eligible-shipment guards for new returns, shipments, and order-linked invoices, preserving existing callers until activation.

## Scope

Sales policy/DI, three creation commands, optional shipment-status filtering, locales, framework documentation and regression coverage. No schema, public route, dependency, or UI layout change. Existing permissions, tenant scope, optimistic locking, money calculations and historical undo remain intact. The spec stays on its design-only PR.

## Implementation Plan

1. Add the policy and activation helpers, schema and locales, with focused regressions.
2. Filter eligible shipment rows only when requested by the enabled return creation path.
3. Enforce return/shipment creation policies inside parent-order transactions.
4. Enforce linked invoice creation with a scoped parent lock and commit before side effects.
5. Add self-contained integration coverage and activation/customization documentation.
6. Run focused and configured validation; resume the existing independent reviewer task for the final head; publish a ready implementation PR with QA requirements and honest evidence.

## Risks

Custom status codes need policy mapping before activation. Keep activation off by default, reject invalid enabled configuration, and avoid changing restoration behavior. Cover parent row locking and no writes on refusal.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: shared policy

- [ ] 1.1 Add policy, activation, schema, locales and policy regressions
- [ ] 1.2 Filter eligible return shipment quantities

### Phase 2: command integration

- [ ] 2.1 Enforce return and shipment creation
- [ ] 2.2 Enforce linked invoice creation

### Phase 3: coverage and delivery

- [ ] 3.1 Integration tests and activation documentation
- [ ] 3.2 Validation, independent review and ready implementation PR
