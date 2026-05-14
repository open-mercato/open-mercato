# Frontend `useRef` hotspot audit

Follow-up to the client-boundary PoC review: the codebase uses many refs, and a subset are symptoms of overly large client components with imperative state machines.

## Scan result

Scope scanned:

- `packages/core/src/modules`
- `packages/ui/src`
- `apps/mercato/src`

Result:

- `370` `useRef` mentions
- `140` files with at least one `useRef`

Top hotspots:

| Count | File | Read |
| ---: | --- | --- |
| 30 | `packages/ui/src/backend/CrudForm.tsx` | highest-risk: giant form state machine |
| 14 | `packages/ui/src/backend/DataTable.tsx` | high-risk: table state/persistence/virtual scroll |
| 11 | `packages/core/src/modules/planner/components/AvailabilityRulesEditor.tsx` | module-level editor state |
| 10 | `packages/ui/src/ai/useAiChat.ts` | async/chat lifecycle state |
| 9 | `packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx` | page-root client blob |
| 8 | `packages/core/src/modules/sales/components/channels/ChannelOfferForm.tsx` | sales form state |
| 8 | `packages/ui/src/portal/hooks/usePortalEventBridge.ts` | event bridge / subscription state |
| 8 | `packages/ui/src/backend/injection/eventBridge.ts` | event bridge / subscription state |
| 7 | `packages/core/src/modules/sales/components/documents/SalesDocumentForm.tsx` | sales form state |
| 7 | `packages/ui/src/ai/AiChat.tsx` | chat UI lifecycle state |
| 6 | `packages/core/src/modules/catalog/backend/catalog/products/[id]/page.tsx` | page-root client blob |
| 6 | `packages/ui/src/backend/detail/TagsSection.tsx` | local UI/async state |
| 6 | `packages/ui/src/primitives/rich-editor.tsx` | DOM/editor integration; likely legitimate |

## Interpretation

Not every `useRef` is bad. Legitimate refs include:

- DOM handles (`inputRef`, `containerRef`, `textareaRef`);
- timers / abort controllers;
- third-party editor or virtualizer integration;
- stable event bridge internals.

Problematic refs are the ones used as hidden mutable application state:

- `valuesRef`, `isDirtyRef`, `submittingRef`, `deletingRef`;
- snapshots/baselines used to bypass React state flow;
- maps of option data that mirror derived state;
- `setSomethingRef` callback escape hatches;
- guard flags for navigation or async races spread across huge components.

These usually mean the component is too broad and mixes data, orchestration, rendering, navigation guards, and field-level interactions in one client boundary.

## Priority order

1. **`CrudForm.tsx`**
   - 30 refs in one 3k+ LOC file.
   - Split into form state reducer/store, navigation guard hook, dynamic options hook, field focus/error hook, and presentational sections.
   - This is the biggest structural target.

2. **`DataTable.tsx`**
   - 14 refs around persistence, initial snapshots, bulk progress, scroll/virtualization, and selection scope.
   - Split table controller state from rendering and isolate virtual scroll refs.

3. **Sales/catalog page roots**
   - `sales/documents/[id]/page.tsx` and `catalog/products/[id]/page.tsx` still have page-root refs.
   - These should be converted to server shells + smaller client islands before deeply refactoring every ref.

4. **Event bridges / rich editor**
   - Review, but do not blindly remove. Many are valid integration refs.

## Proposed guardrail

Add a frontend rule/CI check in warning mode first:

- flag files with `useRef` count above `8`;
- require a comment/justification for non-DOM mutable refs;
- block new page-root client components above threshold unless split into hooks/islands;
- allow known integration files with explicit allowlist.

Suggested threshold policy:

- `0-3`: normal;
- `4-8`: review if not DOM/integration refs;
- `>8`: hotspot, needs split plan;
- `>15`: architectural debt, should not grow further.

## Relation to client-boundary PoC

This is the same root problem as the client-boundary benchmarks: large client roots accumulate imperative state and force large graphs into client compilation. The immediate PoC reduced generated/bootstrap breadth. The next production-quality step is to reduce large client component state surfaces, starting with `CrudForm`, `DataTable`, and sales/catalog page roots.
