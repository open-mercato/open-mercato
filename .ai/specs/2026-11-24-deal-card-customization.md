# Custom references on pipeline deal cards

## TLDR

Let an app render its own deal reference on the pipeline board through the existing component override registry. Sales teams can use the same identifier on the board, deals list and detail page.

## Current behavior

The lane renders the built-in card. The board maps list responses to display data and discards app-specific fields. The card derives its reference from the deal UUID.

## Proposed behavior

Register the existing card, pass the authorized list record to the override and expose the displayed reference as a prop. The built-in card supplies its existing reference as a fallback.

## Design and scope

Declare `section:customers.deals.pipelineCard` in the Customers extension-point catalog. Register the memoized card with that ID and resolve it in the existing client-side `Lane` using `useRegisteredComponent`. This extends the [board redesign](implemented/2026-05-13-customers-deals-kanban-redesign.md) and follows the quick-add dialog's override mechanism. The lane still supplies the deal ID, actions, selection and drag state.

Expose the authorized list item as `deal.record` of type `Readonly<Record<string, unknown>>` on board-produced cards. Retain the original object by reference so custom fields and response-enricher namespaces survive mapping on both initial and appended pages. An application can narrow its own field at runtime and set the optional `referenceLabel` prop with a `propsTransform` in `widgets/components.ts`. The built-in card renders a nonblank label as text and falls back to its existing short reference for missing or blank values. A change to the label must invalidate card memoization even when the deal object is the same.

### Frontend architecture and UI

The page, lane and card already run in the backend client tree. Resolve the host once in the lane component, outside the card loop. Reuse the existing override provider and page fetches. The implementation adds zero network requests per card, zero data copies per API record, and zero new client entry points or dependencies. The drag overlay keeps its existing title-only preview. Applications that require the built-in interactions should use a prop transform or wrap the original card.

## Migration & Backward Compatibility

The handle and exported card props are additive. Keep the existing card exports and make the record optional for callers that construct their own card data. The default label, keyboard navigation, selection, card menu and drag behavior stay available on existing boards. Data authorization stays at the list API. Lane totals are tracked in [#10531](https://github.com/open-mercato/open-mercato/issues/10531).

## Implementation Plan

1. Register and document the host, preserve the list record through mapping, and support the optional display label on the default card.
2. Exercise the real lane with the registry enabled. Check the default reference, a custom reference, missing data, a label-only update and registry cleanup. Cover the public app override through the board's integration path where feasible. Extend the self-contained `TC-CRM-013` board test to verify the default reference and navigation.

## Acceptance criteria

- A downstream prop transform can show `SPD-12` from a returned field without copying the card or changing its navigation target.
- With no override, or with an absent or blank display label, the card still shows `DEAL-` followed by the first six uppercase characters of its ID.
- Initial and paginated records reach the same host. App-specific properties cannot overwrite the board's normalized ID or other display fields.

## Resolved assumptions (autonomous defaults)

Use the issue author's first choice, a registered component, and the shared section-handle convention. Reuse the existing reference position. Expose the list row already returned to the browser so an app does not need a second request.

## Changelog

- 2026-11-24 — Initial design for [#7260](https://github.com/open-mercato/open-mercato/issues/7260).
