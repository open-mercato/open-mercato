# Customers Quick-Create Injection Spot Bridge

## TLDR

Fix issue #6017: the sales document form's Person/Company quick-create dialogs now declare `injectionSpotId` pointing at the customers module's declared CrudForm hosts (`crud-form:customers.person` / `crud-form:customers.company`), so widgets registered on those hosts render inside the dialogs. Switching away from `CrudForm`'s previously auto-derived spot id (`crud-form:customers.customer_entity`, a FROZEN surface per `BACKWARD_COMPATIBILITY.md` §6) would otherwise be a breaking removal, so `CrudForm` gains an additive `legacyInjectionSpotId` bridge prop that dual-publishes both ids' header, body, and field widgets for at least one minor version.

## Problem Statement

- Widgets registered on the customers module's declared `crud-form:customers.person` / `…company` hosts did not render in the two sales quick-create dialogs, because those dialogs never passed `injectionSpotId` and `CrudForm` fell back to auto-deriving one from `entityIds[0]` (`crud-form:customers.customer_entity`) instead.
- Simply switching the dialogs to the declared host id would remove `crud-form:customers.customer_entity` as a live surface on these two pages, which `BACKWARD_COMPATIBILITY.md` §6 (Widget Injection Spot IDs, FROZEN) prohibits without following the Deprecation Protocol.
- Separately, both hosts (`crud-form:customers.person` / `…company`) have so far only ever been published by the person/company **detail** pages, so every widget registered there has only ever rendered with `operation: 'update'` and a concrete `recordId`. These two dialogs are the first surfaces to mount either host in `operation: 'create'`, with no `recordId` — an undisclosed context change worth calling out for widget authors that assume a record always exists.

## Proposed Solution

- Bind the two quick-create `CrudForm` instances to the declared hosts via `injectionSpotId={customersExtensionPoints.hosts.personForm.spotId}` / `…companyForm.spotId`.
- Add `legacyInjectionSpotId?: string` to `CrudForm` (`packages/ui/src/backend/CrudForm.tsx`). When set, its header, body (stack/group), and field (`:fields`) widgets are dual-published alongside the primary `injectionSpotId`'s widgets — nothing that already targets the legacy id stops rendering.
- Pass `legacyInjectionSpotId={crudFormExtensionSpotId('customers.customer_entity')}` (i.e. the exact id `CrudForm` used to auto-derive here) on both dialogs, so the bridge is scoped to these two call sites only.
- Document the deprecation and the create-mode context change in `UPGRADE_NOTES.md`.
- Plan: drop `legacyInjectionSpotId` from both call sites (and, if no other caller ever adopts the prop, the `CrudForm` bridge machinery itself) after at least one minor version, per Deprecation Protocol step 1.

## Architecture

`CrudForm` already derives one "resolved" injection spot id (`resolvedInjectionSpotId`) and loads its widgets once via `useInjectionWidgets`/`useInjectionDataWidgets`, then fans the result out to several consumers: stack-placed body widgets, group-card widgets, the required-field-id set, and lifecycle event dispatch (`useInjectionSpotEvents`, called with the already-loaded widget list).

The bridge merges at that single source instead of touching every consumer:

- `useInjectionWidgets` and `useInjectionDataWidgets` are each called a second time for `legacyInjectionSpotId` (and its `:fields` child). A small `mergeByKey` helper appends the legacy widgets not already present (by `widgetId` / `metadata.id`) to the primary list, so a widget registered on both ids never renders twice.
- Every downstream consumer of the merged `injectionWidgets` / `injectedFieldWidgets` — stack rendering, group cards, required-field disclosure, event dispatch — picks up legacy widgets automatically, with no further wiring.
- The header spot is the one exception: it renders through its own `<InjectionSpot>` instance (not the merged list) because header widgets don't participate in lifecycle events the same way. A second `<InjectionSpot spotId={legacyHeaderInjectionSpotId} .../>` is rendered alongside the primary one when a legacy id is configured.
- When `legacyInjectionSpotId` is omitted (every other `CrudForm` caller today), all of the above is a no-op and the merge functions return the primary list unchanged by reference.

## Data Models

None — no schema changes.

## API Contracts

No API route changes. `legacyInjectionSpotId` is a new optional React prop; every existing `CrudForm` caller is unaffected (an omitted prop produces byte-for-byte the same widget list and render output as before this change).

## Migration & Backward Compatibility

- **`crud-form:customers.customer_entity` (§6, FROZEN) is not removed.** Any third-party widget still targeting it keeps rendering on the two sales quick-create dialogs via the new bridge. It is not published anywhere else and never was (it was this `CrudForm`'s own auto-derivation, not a spot other pages share), so the bridge's scope is exactly these two dialogs.
- **New spot ids are additive.** `crud-form:customers.person` and `crud-form:customers.company` already exist as declared hosts (published by the person/company detail pages); this change adds the two quick-create dialogs as new publishers, which §6 explicitly allows ("MAY add new spot IDs to new or existing pages").
- **Deprecation window.** `legacyInjectionSpotId` is intended to be removed from these two call sites after at least one minor version, per Deprecation Protocol step 1. Tracked in this spec's Changelog and in `UPGRADE_NOTES.md`.
- **Create-mode context change.** Widgets on `crud-form:customers.person` / `…company` (legacy or new id) now also mount with `operation: 'create'` and no `recordId` on these two dialogs, for the first time. `UPGRADE_NOTES.md`'s "Action for module authors" block documents the required tolerance (render an empty/pending state instead of querying by `recordId`).

## Verification Plan

- `packages/core/src/modules/sales/components/documents/__tests__/SalesDocumentForm.injectionHost.test.tsx` — both dialogs mount with the declared `injectionSpotId`, the legacy `legacyInjectionSpotId`, and no initial record id.
- Unit coverage in `packages/ui/src/backend/__tests__/CrudForm` (or the nearest existing CrudForm test suite) for `mergeByKey`: a widget registered on only the primary spot, only the legacy spot, and on both (deduped) all render exactly once.
- `yarn typecheck` and `yarn test` for `packages/ui`, `packages/core` (sales + customers).

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual Risk |
| --- | --- | --- | --- | --- |
| A widget registered on both the legacy and the new declared id renders twice in the dialogs. | Low | UI | `mergeByKey` dedupes by `widgetId` (body/group/stack) and `metadata.id` (fields) before rendering. | None — no in-repo widget currently targets either id from these dialogs. |
| A widget assumes a record always exists and breaks when it first mounts in create mode via the bridge. | Medium | UI | Disclosed explicitly in `UPGRADE_NOTES.md`'s "Action for module authors" block, matching the existing in-repo pattern (`customer_accounts` Account Status / Company Users groups already tolerate `recordId === undefined`). | Third-party widgets not yet audited; disclosure is the available mitigation for a public contract. |
| `legacyInjectionSpotId` bridge is forgotten and never removed, permanently doubling the spot surface. | Low | Maintainability | Tracked here and in `UPGRADE_NOTES.md` with an explicit removal target of "after at least one minor version". | Requires a future PR to actually remove it. |

## Final Compliance Report

- No API route URLs or methods changed.
- No database schema changes.
- No DI service names changed.
- Widget injection spot id `crud-form:customers.customer_entity` (§6, FROZEN) is not removed — dual-published via the new `legacyInjectionSpotId` bridge on `CrudForm`.
- New spot ids (`crud-form:customers.person`, `crud-form:customers.company` as publishers of these two dialogs) are additive per §6.
- `legacyInjectionSpotId` is a new optional prop; no existing `CrudForm` caller's behavior changes.

## Changelog

- 2026-09-16 - Initial bridge spec for issue #6017 / PR #6063.
