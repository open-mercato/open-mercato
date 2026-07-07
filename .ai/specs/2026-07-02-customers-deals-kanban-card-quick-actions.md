# Customers Deals Kanban Card Quick Actions

## TLDR
**Key Points:**
- Replace the visible Call / Email / Note text buttons on `/backend/customers/deals/pipeline` deal cards with compact icon-only quick actions.
- Preserve existing activity-composer behavior, hover/focus reveal, touch fallback, disabled state, drag-and-drop protections, and i18n labels through `aria-label` and `SimpleTooltip`.
- Keep the change local to `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/DealCard.tsx`, plus focused tests.

**Scope:**
- Modify only the deal-card quick-action row in the customers deals kanban.
- Use existing DS primitives: `IconButton` for the controls and `SimpleTooltip` for visible labels/hints.
- Add focused unit coverage proving long localized labels do not render as visible inline text in the fixed-width card action row.
- Verify the interactive route visually enough to confirm the hover row remains inside the card.

**Out of scope:**
- No lane-width change. The 308 px lane fallback from `LANE_WIDTH_PX` remains intentional and user-resizable.
- No API, command, event, ACL, data model, migration, i18n key, route, or provider/bootstrap changes.
- No redesign of card content, card menu, lane header, activity composer dialog, board filtering, or drag/drop behavior.

## Related Context
- Parent kanban spec: `.ai/specs/implemented/2026-05-13-customers-deals-kanban-redesign.md`
- Kanban UX review fixes: `.ai/specs/implemented/2026-05-19-customers-deals-kanban-ux-review-fixes.md`
- Current component: `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/DealCard.tsx`
- Lane width contract: `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/constants.ts`
- DS references: `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`, `.ai/ds-rules.md`, `.ai/ui-components.md`

## Overview
The deals pipeline kanban page exposes three quick-log activity actions on each deal card: call, email, and note. Today those actions are three `Button size="sm"` controls with icons and visible localized labels in a single non-wrapping row. Polish and other longer locales overflow the fixed card width, so the hover state clips outside the card.

This spec changes the card action affordance, not the underlying behavior. The icons remain visible on hover/focus and touch devices; the full localized labels move into accessible names and tooltips. Operators still get fast card-level activity logging, while the card remains dense and stable for scanning.

> **Market Reference**: Odoo CRM documents pipeline and activity workflows as central CRM surfaces ([Odoo CRM docs](https://www.odoo.com/documentation/18.0/applications/sales/crm.html)). OpenProject's board documentation treats drag/drop cards as a dense overview where moving cards updates records in-place ([OpenProject boards docs](https://www.openproject.org/docs/user-guide/agile-boards/)). This spec keeps Open Mercato aligned with those patterns: board cards stay compact, primary card movement remains untouched, and secondary actions are available without widening the card.

## Problem Statement
The current quick-action row cannot reliably fit inside a deal card:

- `DealCard.tsx` renders three ghost text buttons in one flex row.
- Each button includes an icon, visible text, `shrink-0`, and `whitespace-nowrap`.
- The lane fallback width is fixed at 308 px to match the SPEC-048 kanban design.
- Longer localized labels such as `Wyślij e-mail` exceed available width, causing visual clipping.

The fix must not:
- introduce hover-time layout shift,
- reduce kanban density by widening every lane,
- solve only one locale by shortening copy,
- regress keyboard/touch accessibility,
- break the dnd-kit pointer-capture workaround already documented in `DealCard.tsx`.

## Proposed Solution
Replace the visible text buttons with three icon-only quick actions:

| Action | Icon | Accessible label / tooltip source |
| --- | --- | --- |
| Call | `Phone` | `customers.deals.kanban.card.action.call` |
| Email | `Mail` | `customers.deals.kanban.card.action.email` |
| Note | `StickyNote` | `customers.deals.kanban.card.action.note` |

Implementation boundaries:
- Import `IconButton` from `@open-mercato/ui/primitives/icon-button`.
- Import `SimpleTooltip` from `@open-mercato/ui/primitives/tooltip`.
- Keep lucide icons from `lucide-react`, using DS icon sizing (`size-4` or existing `size-3.5` only if preserving the current visual rhythm requires it).
- Do not use raw `<button>`.
- Do not use `Button size="icon"` for the new icon-only controls.
- Do not use raw `title` for the disabled explanation. The tooltip docs explicitly reject `title` for non-trivial hints.
- Keep each control `type="button"` and `aria-label={localizedLabel}`.
- Keep `data-card-action="true"` and `onPointerDown={stopPointerDown}` at the quick-action boundary so actions neither navigate to the deal nor trigger dnd-kit pointer capture.
- Preserve touch behavior: quick actions remain visible by default under `@media(hover:none)`.
- Preserve disabled behavior when `deal.primaryCompany` is missing. Disabled actions should still expose the same explanatory text through `SimpleTooltip`; if a native disabled button would prevent tooltip pointer/focus events, use a small wrapper element as the tooltip trigger while keeping the `IconButton` visually disabled.

### Design Decisions
| Decision | Rationale |
| --- | --- |
| Icon-only visible controls | Removes locale-dependent width from the fixed card layout. |
| Tooltip + `aria-label` instead of visible text | Keeps meaning discoverable for mouse, keyboard, and screen-reader users without expanding the row. |
| Keep hover/focus/touch reveal behavior | Parent specs intentionally make quick actions quiet at rest and visible on touch devices. |
| Keep 308 px lane width | The lane width is a board-level contract and already user-resizable; changing it would reduce board density. |
| Keep action behavior unchanged | This is a layout fix, not an activity workflow or API change. |

### Alternatives Considered
| Alternative | Why rejected |
| --- | --- |
| Allow the row to wrap | Fixes overflow but changes card height on hover/focus and creates board jitter. |
| Widen lanes globally | Reduces visible stage count and works against CRM kanban density. |
| Shorten translations | Locale-specific and brittle; another language or custom translation can overflow again. |
| Move actions into the kebab menu | Solves width but makes high-frequency activity logging slower and deviates from SPEC-048. |
| Show one primary action plus overflow | Adds new prioritization rules and state for a three-action row that should stay simple. |

## User Stories / Use Cases
- **Sales rep** wants to hover a deal card and log a call, email, or note without visual clipping.
- **Sales rep using Polish UI** wants the kanban card to remain readable when localized labels are longer than English.
- **Keyboard user** wants to tab to each quick action and hear the localized action name.
- **Touch user** wants the same three quick actions visible without hover.
- **Operator dragging cards** wants quick-action pointer handling not to interfere with drag/drop or card navigation.

## Architecture
No new module, package, API route, command, event, worker, subscriber, DI registration, or generated registry is introduced.

### Component Boundary
```
Lane.tsx
└── DealCard.tsx
    ├── useDraggable(...)              existing
    ├── Checkbox                       existing
    ├── DealCardMenu                   existing
    └── QuickActionsRow                modified only here
        ├── SimpleTooltip + IconButton Phone
        ├── SimpleTooltip + IconButton Mail
        └── SimpleTooltip + IconButton StickyNote
```

### Interaction Flow
```
User hovers/focuses DealCard
  -> QuickActionsRow becomes opacity-100
  -> User activates icon action
  -> handleActionClick(type) stops propagation
  -> onComposeActivity(deal.id, type)
  -> existing ActivityComposerDialog flow opens from page state
```

The `data-card-action="true"` boundary stays intact. This prevents the card root `onClick` from opening the deal detail and keeps dnd-kit from capturing action pointer-down events.

## Frontend Architecture Contract
### Server/Client Boundary Map
| Route / surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| `/backend/customers/deals/pipeline` | Existing auto-discovered backend route/page | Existing `DealCard.tsx` island under `Lane.tsx` | Existing customers deals API/page state | No new route, provider, data source, or page-root client boundary. |

### `"use client"` Ledger
| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
| --- | --- | --- | --- | --- | --- |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/DealCard.tsx` | Existing interactive card: drag/drop, selection, menu, activity actions, hover/focus row | `Lane.tsx` | Existing `@dnd-kit/core` and `lucide-react`; no new heavy deps | Low; local control swap inside an existing client island | Server rendering is not viable because card actions and dnd-kit are browser interactions. |

### Client Blob Guardrail
- No new client page/root files.
- `DealCard.tsx` is already over the 300 LOC advisory, but this spec must keep the diff local and avoid adding a new abstraction unless tests or readability require a tiny private helper such as `QuickActionIconButton`.
- No table/editor/calendar/graph/browser SDK dependency is added.

### Budgets
| Budget | Default target | Spec value |
| --- | --- | --- |
| Generated backend page-root `"use client"` | 0 new unallowlisted | 0 |
| Touched client page/root files over 300 LOC | 0 unless justified | 0 page/root files; existing leaf component touched |
| Heavy browser libraries at page/provider root | 0 | 0 |
| Per-route hydration smoke test | required for changed interactive route | Required: load `/backend/customers/deals/pipeline` during UI verification when feasible |
| Performance evidence | static check + one runtime/build/bundle/RSS signal when feasible | Focused component test + visual route smoke; no bundle impact expected |

### Provider / Bootstrap Scope
| Provider/bootstrap | Global? | Scope | Why | Exit criteria to narrow |
| --- | --- | --- | --- | --- |
| None | N/A | N/A | No provider or bootstrap change | N/A |

### Test and Evidence Plan
- Component test: render a deal with localized long labels and assert the visible quick-action row contains three icon buttons with accessible names, not inline text labels.
- Component test: each action calls `onComposeActivity(deal.id, type)` and does not call `onOpenDetail`.
- Component test: disabled/no-company state preserves disabled affordance and exposes the existing explanatory tooltip content.
- Visual/manual or Playwright route smoke: hover a deal card at default lane width and confirm the actions remain inside the card.

## Data Models
No data model changes.

N/A rationale:
- No entity, column, setting, or migration is introduced.
- No tenant or organization scoping changes.
- No sensitive fields are added.
- No encryption map changes are needed.

## API Contracts
No API contract changes.

Reused behavior:
- The card still calls the existing page-level `onComposeActivity(dealId, type)` callback.
- Activity creation remains owned by the existing `ActivityComposerDialog` / page flow.
- No request/response shapes, OpenAPI exports, or mutation guards are changed by this spec.

## Internationalization (i18n)
No new keys are required.

Existing keys remain the single source of truth:
- `customers.deals.kanban.card.action.call`
- `customers.deals.kanban.card.action.email`
- `customers.deals.kanban.card.action.note`
- `customers.deals.kanban.card.action.disabledNoCompany`

Implementation must continue to read labels via `useT()` + `translateWithFallback(...)`. Visible tooltips and `aria-label` values use the same localized strings so translation behavior stays consistent.

## UI/UX
### Resting State
- Card appearance remains unchanged.
- The quick-action row remains hidden via opacity on hover-capable devices.
- The row still occupies stable layout space as today, avoiding hover-time height changes.

### Hover / Focus State
- The row reveals three compact ghost icon buttons.
- Buttons are same size and aligned in one row.
- Each button has a tooltip with the localized action label.
- No visible action text is rendered in the row.

### Touch State
- Existing touch fallback remains: quick actions are visible by default under `@media(hover:none)`.
- Tooltips are not the only way to perform actions; icons remain the direct touch targets and accessible labels remain present.

### Disabled / No Company State
- When `deal.primaryCompany` is missing, all three quick actions remain visually disabled as today.
- The explanatory `disabledNoCompany` copy is still available through `SimpleTooltip`.
- Do not rely on raw `title`. If native `disabled` blocks tooltip events, wrap the `IconButton` in a small tooltip trigger element and keep the button visually/semantically disabled.

### Accessibility
- Every icon-only button must have an `aria-label`.
- Keyboard focus must reveal the row through the existing `focus-within` opacity classes.
- Pressing Enter/Space on focused actions must trigger the matching action and not navigate to the deal.
- The card root `aria-label` / `aria-roledescription` behavior remains unchanged.

## Configuration
No configuration changes.

## Migration & Compatibility
- Backward compatible: no public contract changes.
- URL, page metadata, ACL features, widget IDs, injection spots, i18n keys, API routes, commands, events, and DB schema remain unchanged.
- Existing localized strings are reused; no translation migration is needed.
- The visual behavior changes only the visible representation of the quick actions from icon+text to icon-only with tooltip.

## Implementation Plan
### Phase 1: Deal Card Quick-Action Fit
1. Import `IconButton` and `SimpleTooltip` in `DealCard.tsx`.
2. Replace the three quick-action `Button` controls with three same-size `IconButton` controls.
3. Derive localized labels once near the existing quick-action row to avoid repeating `translateWithFallback`.
4. Wrap each icon button in `SimpleTooltip` using the localized label; use the disabled explanation tooltip when actions are disabled.
5. Remove visible `<span>` label text from the quick-action row.
6. Preserve `handleActionClick`, `disabled`, `aria-disabled` or semantic disabled behavior, `data-card-action`, `onPointerDown`, and `onClick` propagation handling.
7. Add focused unit tests.
8. Run focused validation.
9. Run a visual route smoke if a dev server/test environment is available.

### File Manifest
| File | Action | Purpose |
| --- | --- | --- |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/DealCard.tsx` | Modify | Swap visible text quick-action buttons for icon-only DS controls with tooltips. |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/__tests__/DealCard.quickActions.test.tsx` | Create or modify | Cover action accessibility, behavior, disabled tooltip, and absence of visible inline labels. |
| `.ai/specs/2026-07-02-customers-deals-kanban-card-quick-actions.md` | Modify | Keep implementation-accurate spec and changelog. |

## Implementation Status -- 2026-07-02
### Phase 1: Deal Card Quick-Action Fit
Status: **Implemented**

Implemented changes:
- Replaced the three visible quick-action text buttons in `DealCard.tsx` with compact `IconButton` controls.
- Moved localized action labels to `aria-label` and `SimpleTooltip`.
- Refined the visual treatment after review: the quick-action row is centered, uses larger 32px icon buttons, and uses `size-5` icons so the affordance reads as an intentional toolbar rather than small controls at the card edge.
- Preserved the existing `data-card-action` boundary, pointer-down propagation guard, hover/focus reveal, touch fallback classes, disabled behavior, and `onComposeActivity` callback flow.
- Removed raw `title` usage for the disabled no-company explanation and exposed that copy through `SimpleTooltip` on a wrapper trigger.
- Added focused regression coverage for accessible names, no visible inline labels, action click behavior, detail-navigation isolation, and disabled tooltip behavior.

Verification:
```bash
yarn workspace @open-mercato/core test src/modules/customers/backend/customers/deals/pipeline/components/__tests__/DealCard.quickActions.test.tsx --runInBand
```

## Testing Strategy
Focused commands:
```bash
yarn workspace @open-mercato/core test -- DealCard.quickActions
yarn workspace @open-mercato/core typecheck
```

Broader validation if the focused change or test setup touches shared UI behavior:
```bash
yarn workspace @open-mercato/ui test
yarn typecheck
```

Manual/visual verification:
- Open `/backend/customers/deals/pipeline`.
- Hover a populated card at default 308 px lane width.
- Confirm the three quick actions stay inside the card.
- Confirm keyboard tab focus reveals the row and each action opens the expected composer.
- Confirm a deal without `primaryCompany` shows disabled actions with the no-company explanation.

## Risks & Impact Review
### Data Integrity Failures
No persistence changes are introduced. Existing activity creation remains downstream of the unchanged composer flow. A failed activity save behaves exactly as it does before this spec.

### Cascading Failures & Side Effects
No new events, subscribers, cache invalidations, commands, or background work are introduced. The only side effect remains the existing `onComposeActivity` callback.

### Tenant & Data Isolation Risks
No data reads or writes are added. Existing deal and activity APIs retain their current tenant and organization scoping.

### Migration & Deployment Risks
No migration or backfill is required. The change can ship as a static UI update.

### Operational Risks
The blast radius is isolated to the customers deals kanban deal-card quick-action row. If the implementation is wrong, users may lose quick card-level access to activity composers, but deal detail navigation, card menu actions, drag/drop, and list/detail APIs remain unchanged.

### Risk Register
#### Tooltip Does Not Open For Disabled Actions
- **Scenario**: A native disabled icon button does not receive pointer/focus events, so the no-company explanation becomes inaccessible.
- **Severity**: Medium
- **Affected area**: Customers deals kanban quick-action row.
- **Mitigation**: Use `SimpleTooltip` on a wrapper trigger for disabled actions when necessary; add a focused test for the disabled/no-company state.
- **Residual risk**: Low. The disabled state already exists; the implementation only changes how the explanation is surfaced.

#### Icon-Only Actions Become Ambiguous
- **Scenario**: Users cannot distinguish call/email/note actions from icons alone.
- **Severity**: Low
- **Affected area**: Customers deals kanban quick-action row.
- **Mitigation**: Use familiar lucide icons, localized `aria-label`, and localized `SimpleTooltip` content for each action.
- **Residual risk**: Low. These are conventional CRM activity icons and the actions remain in the same order.

#### DnD Pointer Capture Regression
- **Scenario**: Moving the action controls changes pointer-down propagation, causing action clicks to navigate or start drag capture.
- **Severity**: High
- **Affected area**: Deal card click/drag behavior on the pipeline board.
- **Mitigation**: Preserve `data-card-action="true"` and `onPointerDown={stopPointerDown}`; add behavior tests for action click vs `onOpenDetail`.
- **Residual risk**: Medium. dnd-kit pointer behavior is subtle, so visual/manual route smoke is required.

#### Touch Layout Regression
- **Scenario**: The row stays hidden on touch devices because hover-only classes are changed incorrectly.
- **Severity**: Medium
- **Affected area**: Mobile/touch usage of the deals kanban.
- **Mitigation**: Preserve the existing `[@media(hover:none)]` visibility classes; include touch fallback in manual verification.
- **Residual risk**: Low.

## Final Compliance Report -- 2026-07-02
### AGENTS.md Files Reviewed
- `AGENTS.md` (root, provided in conversation)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/ds-rules.md`
- `.ai/ui-components.md`
- `.ai/skills/om-spec-writing/SKILL.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| root AGENTS.md | Check specs before modifying a module | Compliant | Parent kanban specs and UX review specs were reviewed. |
| root AGENTS.md | Preserve behavior unless explicitly changing it | Compliant | Only visible quick-action representation changes; callbacks and composer flow stay unchanged. |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | Existing i18n keys provide labels and tooltips. |
| root AGENTS.md | Never use raw buttons | Compliant | Spec requires `IconButton`. |
| root AGENTS.md | Use closest package/module AGENTS.md | Compliant | Core, customers, UI, backend UI, DS docs reviewed. |
| packages/core/AGENTS.md | Preserve auto-discovery contracts | N/A | No module file shape or generated registry changes. |
| packages/core/AGENTS.md | API routes export `openApi` | N/A | No API route changes. |
| packages/core/AGENTS.md | Implement domain writes through commands | N/A | No writes added. Existing composer flow unchanged. |
| packages/core/src/modules/customers/AGENTS.md | Use guarded mutation for non-`CrudForm` backend writes | N/A | No new write path. |
| packages/core/src/modules/customers/AGENTS.md | Deals must link to a person or company; activities reference parent entity | Compliant | Existing no-company disabled behavior is preserved. |
| packages/ui/AGENTS.md | Use existing UI primitives first | Compliant | Uses `IconButton` and `SimpleTooltip`. |
| packages/ui/AGENTS.md | Use `useT()` for user-facing copy | Compliant | Spec requires existing `useT()` / `translateWithFallback` path. |
| packages/ui/AGENTS.md | Never use raw `<button>` | Compliant | Spec explicitly rejects raw buttons. |
| packages/ui/src/backend/AGENTS.md | Use `Button` or `IconButton`; `IconButton` for icon-only controls | Compliant | Spec requires `IconButton`. |
| `.ai/ds-rules.md` | Icon-only buttons must have `aria-label` | Compliant | Spec requires localized `aria-label` for each action. |
| `.ai/ds-rules.md` | Use lucide icons, not inline SVG | Compliant | Existing lucide `Phone`, `Mail`, `StickyNote` remain. |
| `.ai/ui-components.md` | Use `SimpleTooltip`/Tooltip, not raw `title`, for non-trivial hints | Compliant | Spec explicitly forbids raw `title` for disabled explanation. |
| om-spec-writing | Include frontend architecture contract for UI work | Compliant | Contract included with boundary map, ledger, budgets, provider scope, and tests. |

### Internal Consistency Check
| Check | Status | Notes |
| --- | --- | --- |
| Data models match API contracts | Pass | Both are N/A; no data/API changes. |
| API contracts match UI/UX section | Pass | UI reuses existing callback and composer flow. |
| Risks cover all write operations | Pass | No new writes; risks cover action dispatch and existing downstream composer. |
| Commands defined for all mutations | Pass | No new mutations; existing activity mutation remains outside this spec. |
| Cache strategy covers all read APIs | Pass | No read API or cache changes. |
| DS rules cover changed controls | Pass | `IconButton`, `SimpleTooltip`, lucide icons, `aria-label`, no raw `title`. |
| Frontend architecture contract matches scope | Pass | Existing client leaf only; no provider/root boundary change. |

### Non-Compliant Items
None.

### Verdict
**Fully compliant**: Approved -- ready for implementation.

## Changelog
### 2026-07-02
- Initial skeleton spec for the deal-card quick-action overflow fix.
- Expanded into full implementation-ready spec with market reference, frontend architecture contract, phased implementation, risk register, review, and compliance gate.
- Implemented Phase 1 in `DealCard.tsx` and added focused quick-action regression tests.
- Refined Phase 1 UX to use a centered quick-action toolbar with larger icon buttons and larger icon glyphs after visual review feedback.

### Review -- 2026-07-02
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
