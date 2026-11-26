# Capability: sales-order-creation

Sales operators can create an order and see which information they need to add when creation is blocked.

## Requirement: Reveal the missing line items alert

The order creation form SHALL reveal and focus its inline line-items alert on every missing-lines rejection.

### Scenario: Create without line items

- WHEN a valid draft order has no line items and the operator tries to create it from either Create button
- THEN the alert appears within the viewport and receives focus, including when the operator retries with the same empty draft.

Source: .ai/specs/2026-11-26-sales-order-line-validation-focus.md
