# Sales document workflow guards

Status: design ready; implementation pending. Refs #3533.

## TLDR

Add opt-in server enforcement for creating returns, shipments and order-linked invoices. When enabled, an action whose order is not at an eligible state returns a localized HTTP 409 before creating the document. Returns count only eligible shipment statuses. Existing deployments retain their current behavior until they opt in.

## Resolved assumptions (autonomous defaults)

| Question | Decision and rationale |
| --- | --- |
| Existing callers | `OM_SALES_DOCUMENT_WORKFLOW_GUARDS` defaults to false. Enabling new business constraints for every existing integration would silently narrow stable contracts. |
| Default status codes | Shipments/returns allow `approved`, `confirmed`, `in_fulfillment`, `fulfilled`; invoices allow `confirmed`, `in_fulfillment`, `fulfilled`. Returns count `shipped`, `in_transit`, `delivered` shipments. These are existing dictionary values, not UUIDs or translated labels. |
| Custom workflows | Replace scoped `salesDocumentWorkflowPolicy` via DI. The policy contains allowed status-value arrays per action and returnable shipment statuses; a replacement may select rules from the order scope. Missing/malformed enabled-policy configuration fails closed. |
| Split scope and UI | Ship all three creation checks together because they share one opt-in policy and transaction requirement. Keep existing error surfaces; no buttons are hidden and no new settings screen is added. |
| Historical operations | Leave undo/redo restoration and already-created documents unchanged. Standalone imported invoices without an order remain supported. Existing quantity, RBAC, optimistic-lock and cancellation protections remain in force. |

## Overview and problem statement

Sales operators can currently create documents without a common order-status precondition. `sales.returns.create` checks shipped quantity but `loadShippedQuantityByLine` counts all non-deleted shipments, including pending/cancelled rows. `sales.shipments.create` validates quantities without an order lifecycle policy. `sales.invoices.create` checks an optional order's scope but not its status. An installation that requires confirmation before billing or physical dispatch cannot enforce that policy consistently through browser and API consumers.

This extends existing shipment and return quantity guards; it does not replace sales calculations or introduce another document state machine. Reference behavior was inspected at main `c98419720f`.

## Research

[Odoo invoicing policies](https://www.odoo.com/documentation/19.0/applications/sales/sales/invoicing/invoicing_policy.html) distinguish invoicing ordered from delivered quantities and treat confirmation as a lifecycle transition. [ERPNext delivery notes](https://docs.frappe.io/erpnext/delivery-note) distinguish submitted orders from draft documents and support configurable direct-invoice workflows. The inference for this platform is to make enforcement explicit and replaceable, rather than infer universal business meaning from arbitrary tenant labels. Do not adopt either product's additional accounting or stock models.

## Proposed solution and architecture

Add a functional default policy factory in `sales/lib/documentWorkflowPolicy.ts`, registered as scoped `salesDocumentWorkflowPolicy` in `sales/di.ts`. Use `parseBooleanWithDefault` to read the environment flag. With the flag off, return immediately without resolving the policy or issuing additional reads. With it on, normalize values (trim/lowercase, spaces/hyphens to underscores), validate the policy shape, and enforce the action's allowed order statuses through one helper accepting the command context and scoped order. HTTP 409 contains `code: sales_document_workflow_restricted` plus `action`, and a localized recovery message. No status label or ID is given business meaning.

Enforce return policy after the existing parent-order lock, before line effects. Pass optional allowed shipment statuses to the existing shipped-quantity helper only for a new return; filter shipments before looking up their items. Preserve the existing quantity ceiling and per-line availability checks.

Enforce shipment policy inside its transaction after locking/reloading the scoped order, before persistence. Refuse creating a shipment when all positive-quantity order lines have already been fully returned; retain existing per-line shipped quantity ceilings.

For an order-linked invoice, when enabled, use one transaction for the scoped parent lock/read, policy check and invoice header/lines/custom fields. Emit side effects after that transaction commits. With the flag off retain the existing transaction arrangement. Number-sequence consumption remains the existing behavior: a rejected request may consume a number, but writes no invoice or line. Invoices without orderId retain existing behavior.

## Data models

No new entity, column, relationship, migration, settings row, or database write for the policy. Existing `SalesOrder.status`, `SalesShipment.status`, `quantity`, and `returnedQuantity` supply the facts. New editable entities are not introduced.

## API contracts

Existing paths remain: `POST /api/sales/returns`, `POST /api/sales/shipments`, `POST /api/sales/invoices`. With enforcement disabled, retain current request/response behavior. Enabled refusals add HTTP 409 with the stable error envelope above; existing 400/403/404/409 guards still apply. Direct command-bus callers receive the same rejection. No permission is added or weakened. Order and shipment reads remain tenant/organization scoped.

## UI/UX

Existing dialog/form error handling displays translated refusals and tells the operator to confirm/check the order first. The server remains authoritative when a dialog is stale or a caller bypasses the UI. No UI-rendering file, new dialog or mockup is needed.

## Migration & Backward Compatibility

Disabled-by-default is the bridge for existing callers and custom statuses. Enable only after mapping the organization's workflow values to the documented default policy or supplying a scoped DI replacement. Disabling restores prior creation rules without rewriting records. The optional shipment-status helper argument is additive. The DI key and environment flag are additive; routes, entities, signatures and status IDs remain intact. Do not change the default in a patch release. Document activation and customization in framework sales docs; no template environment edit is needed.

## 📝 Delta

### ADDED: opt-in creation policy

- WHEN disabled, THEN existing creation behavior and quantity rules remain unchanged.
- WHEN enabled and the order state is not allowed for an action, THEN return 409 without creating a header/line or emitting a created event.
- WHEN enabled and a custom status is allowed by the scoped DI policy, THEN continue through existing scope, quantity and mutation protections.
- WHEN an invoice omits orderId, THEN retain standalone import behavior.

### MODIFIED: eligible return quantity when enabled

- WHEN only pending/cancelled shipments exist, THEN their quantities cannot justify a new return.
- WHEN a shipped/in-transit/delivered row exists, THEN only its scoped quantities count, with prior returns subtracted as today.
- WHEN all order quantities were already returned, THEN a new shipment is refused before a new shipment row is written.

## Risks & impact review

| Scenario | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Custom status names rejected unexpectedly | Medium | Opt-in flag; replaceable policy; codes rather than labels; explicit documentation | Enabling without mapping may reject legitimate work |
| Status changes race with creation | High | Hold the parent row lock in the same write transaction; existing child mutation locking remains | An external writer bypassing platform locking remains outside contract |
| Scope leakage | High | Reuse existing scoped parent reads and shipment helper | No new scope expansion |
| Historical undo becomes blocked | Medium | Only new creation paths receive the policy | Later undo can restore a historical state, intentionally unchanged |
| Pending/cancelled shipment counted | Medium | Filter eligible rows before item aggregation; mixed-status regression | Custom shipment status requires policy mapping |
| Policy unavailable when enabled | Medium | Fail closed with internal configuration error; no permissive fallback | Misconfigured deployment must fix configuration or disable opt-in |

## Implementation Plan

### Phase 1: compatible shared policy

1. Add default policy, activation helper, localized refusals and DI registration; unit-test activation, custom statuses, malformed policy and disabled compatibility.
2. Extend shipped quantity aggregation with optional status filtering; prove pending/cancelled rows cannot contribute when enabled.

### Phase 2: real command call sites

3. Enforce returns and shipments after parent locks and before writes; exercise rejected/allowed paths and fully-returned order behavior.
4. Enforce order-linked invoices within their write transaction; preserve standalone/disabled paths and after-commit effects.

### Phase 3: coverage and delivery

5. Add self-contained integration coverage for all three API creation paths and the disabled/custom-policy cases where executable fixtures support them. Reuse temporary products/orders/shipments, clean up all records. Run focused tests, configured validation gate and generation, documenting any environmental limits.
6. Publish exactly one implementation PR referencing this design PR and closing #3533; resume the existing independent review task for the final implementation head. Keep `needs-qa` until the pipeline supplies QA approval.

## Final Compliance Report

Design review: additive activation and DI policy; no new ORM/module relationship or dependency; existing scope and mutations retained; API integration coverage required. Implementation, concurrency regressions, full validation and review are pending. No implementation result or merge approval is claimed by this design document.

## Changelog

- 2026-11-22: Initial autonomous design for #3533, with compatible activation and recorded status-policy defaults.
