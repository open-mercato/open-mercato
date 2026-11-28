# Sales order line validation focus

Extends: .ai/specs/2026-11-04-issue-8204-rejected-save-visibility.md

## TLDR

When a sales operator clicks Create on an order without line items, bring the existing validation message into view and focus it. The message tells the operator what to add and sits next to the line-item controls.

## Resolved assumptions (autonomous defaults)

- Use the existing inline message as the destination. The optional notification would repeat the same action.

## Problem statement

On the sales document creation page, the header Create button can be visible while the reason for rejecting an empty order is below the fold. The operator has to find the reason manually. The same form also offers a footer Create button and handles quote creation. [Issue #10679](https://github.com/open-mercato/open-mercato/issues/10679)

## Scope

Order creation feedback on the existing sales document form, including both Create buttons and repeated submissions.

## Architecture and UI/UX

`SalesDocumentForm` already rejects empty orders before calling the create API and passes the translated error to the `lines` field. Associate a reveal request with each missing-lines rejection. After `SalesOrderDraftLines` renders its existing inline alert, use the alert itself as the focus target. Scroll it into the viewport immediately, then focus it with `preventScroll` so focus does not cause a second scroll. Keep `role="alert"` and use `tabIndex={-1}` for programmatic focus.

The related #8204 design covers shared error visibility. The sales line field owns its inline alert, so the existing sales client components can handle this interaction directly. The GOV.UK Design System likewise moves focus to validation feedback. The browser's native scrolling and focus methods provide the positioning for this form. [GOV.UK error summary](https://design-system.service.gov.uk/components/error-summary/) · [CSSOM View](https://drafts.csswg.org/cssom-view/#dom-element-scrollintoview) · [HTML focus](https://html.spec.whatwg.org/multipage/interaction.html#dom-focus-dev)

Keep the existing Create controls, error styling, and translations, including English and Polish. The order check continues to run after other required-field checks. Only a missing-lines rejection requests focus. Quote creation, editing the draft, and successful submission keep their existing behavior.

The route, data model, API, and module exports remain compatible. The change uses the existing client components with zero new client entry points, providers, dependencies, or requests.

## 📝 Delta

### Capability: sales-order-creation

#### ADDED Requirement: Reveal the missing line items alert

The order creation form SHALL reveal and focus its inline line-items alert on every missing-lines rejection.

##### Scenario: Create without line items

- WHEN a valid draft order has no line items and the operator tries to create it from either Create button
- THEN the alert appears within the viewport and receives focus, including when the operator retries with the same empty draft.

## Integration coverage

Extend sales browser coverage at a 1366 × 768 viewport. Use a test-created customer and valid order form values. Submit from the header, verify the existing alert's text, viewport position, and focus, then retry the same draft. Exercise the footer entry point as well. Verify that the form sends no order creation request on these attempts. Clean up the customer fixture. Existing sales API coverage in `TC-SALES-4021-order-requires-line.spec.ts` remains the authority for rejecting empty orders on the server.

## Implementation Plan

### Phase 1: Order creation feedback

1. Connect the missing-lines rejection to the existing alert and focus it after render. Cover repeated rejection and clearing the alert in the targeted component tests.
2. Verify the header and footer Create flows with the sales Playwright suite. Archive the sales order creation requirement and record the validation and review evidence on the implementation PR.

## Changelog

- 2026-11-26 — Specified focus and viewport behavior for #10679.
