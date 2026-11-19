# Workflow Visual Editor — Canvas Space Refactor (Focus Mode, Horizontal Layout, Compact Nodes)

## TLDR

**Key Points:**
- Give the workflow author **maximum canvas room** through one headline control — a **Focus mode** button that simultaneously collapses the backend app sidebar to its icon rail, collapses the node palette to an icon-only rail, and hides the metadata form.
- **Switch the graph flow direction Top→Bottom → Left→Right** (hard switch for all graphs), repositioning every node's control-flow handles and transposing the auto-layout algorithm.
- **Restyle nodes lighter and squarer**: width `280px → 180px`, thinner border, smaller radius/padding/typography, and migrate the node's hardcoded hex/Tailwind status colors to DS tokens (Boy-Scout).
- **Shrink the palette** from a 384px sidebar of verbose title+description cards to a compact ~190px rail that collapses to a ~56px icon rail, de-duplicating the 8 hand-written palette buttons into a single map.
- **Persist user-arranged node positions** so a saved graph re-opens exactly as the author left it (currently positions are silently dropped on save **and** ignored on load — two independent breaks), and add an explicit **"Auto-arrange / Tidy"** action for when the author wants the engine to re-lay-out.
- **Eliminate node/edge overlap** by replacing the dimension-unaware custom layout with a **layered, node-size-aware engine** (proposed: `@dagrejs/dagre` with `rankdir: 'LR'`) and switching control edges to **orthogonal (`smoothstep`) routing** so arrows bend around nodes instead of through them. The dagre `rankdir: 'LR'` delivers the horizontal switch **and** overlap avoidance in one move.

**Scope:**
- `packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx` — Focus mode orchestration, palette rail (expanded + collapsed), metadata hide, slim toolbar, respect-saved-positions load + Tidy action.
- `packages/core/src/modules/workflows/components/WorkflowNodeCard.tsx` + all `components/nodes/*.tsx` — compact styling + Left/Right handles.
- `packages/core/src/modules/workflows/lib/graph-utils.ts` — replace `calculateSmartLayout` with a dagre-backed layered layout; honor stored positions on load.
- `packages/core/src/modules/workflows/data/validators.ts` — declare an optional `_editorPosition` (or `position`) field on `workflowStepSchema` so positions survive save validation (currently stripped).
- `packages/core/src/modules/workflows/components/WorkflowTransitionEdge.tsx` — orthogonal (`getSmoothStepPath`) routing.
- `packages/core/src/modules/workflows/components/WorkflowDataMappingEdge.tsx` + `nodes/SubWorkflowNode.tsx` — resolve the data-port vs control-handle collision under horizontal flow.
- `packages/ui/src/backend/AppShell.tsx` — additive `useSidebarCollapse()` context so a page can request the app sidebar collapse and restore it on exit.
- i18n keys in `packages/core/src/modules/workflows/i18n/{en,es,de,pl}.json`.

**Concerns:**
- `AppShell` is a **shared UI contract surface** (`BACKWARD_COMPATIBILITY.md`). The sidebar-collapse context MUST be **additive** — existing `AppShell` props/behavior unchanged, new context optional, default behavior identical when no page consumes it.
- **Adding `@dagrejs/dagre` is a production dependency** → approved by author. Smaller, synchronous, battle-tested; `rankdir: 'LR'` gives the horizontal direction and overlap-free placement in one move.
- **No position-migration cost.** Because the save path has always stripped `_editorPosition` and the load path always auto-lays-out, **no existing definition holds persisted coordinates** — so the hard LR switch moves nothing today. Persistence is purely additive going forward.
- `SubWorkflowNode` already uses `Position.Left/Right` for **data-mapping ports**; horizontal control flow needs Left=in / Right=out for control too. The two MUST NOT visually or functionally collide.

---

## Overview

The workflows module composes step-based processes in a visual editor built on `@xyflow/react` v12 (`WorkflowGraphImpl.tsx`). The current editor wastes horizontal canvas space: a fixed **384px** (`w-[24rem]`) palette sidebar of large title+description cards, a top metadata form, the full backend app chrome, **wide 280px nodes**, and a **top-to-bottom** flow that grows the graph vertically while leaving the canvas sides empty.

This spec maximizes usable canvas via a single **Focus mode** toggle that orchestrates three collapses at once, switches the graph to a **left-to-right** flow that uses horizontal space, and makes nodes **compact and lighter** so more of the graph fits on screen — matching the reference flow-tool aesthetic (narrow squared nodes, icon palette, horizontal pipeline).

> **Reference**: The target visual is a horizontal pipeline editor (left→right) with compact ~170–200px nodes, a narrow icon+label palette, and a small map card — i.e. the dense, canvas-first layout common to n8n / scraping-pipeline tools. We adopt the **layout density and direction**, not any specific node taxonomy (our step types are unchanged).

## Problem Statement

1. **Palette eats ~384px of canvas permanently.** `page.tsx:1177` hardcodes `w-[24rem]`; the 8 palette entries are copy-pasted blocks (`page.tsx:1186-1303`) each with a title **and** description, plus a "How to use" Alert — all consuming width even when the author knows the node types.
2. **No way to reclaim the app chrome.** The backend sidebar (`AppShell.tsx`) collapses to an 80px rail, but **only via its own button**; a page cannot request it. There is no "distraction-free" mode.
3. **Metadata form competes for vertical space.** `showMetadata` exists (`page.tsx:113`) but is ephemeral (not persisted) and is a separate control from palette/chrome — collapsing everything takes three actions.
4. **Nodes are wide and heavy.** `WorkflowNodeCard.tsx`: `w-[280px] rounded-xl border-2 p-4`, `text-base` title, `w-5 h-5` icon — fewer nodes fit per screen, and the look is heavier than the reference. Handle/accent colors are hardcoded hex (`!bg-[#0080FE]`, `border-[#0080FE]`) and Tailwind shades (`text-emerald-500`) — DS violations.
5. **Top→bottom flow under-uses the canvas.** `calculateSmartLayout` (`graph-utils.ts:393`) places each level lower (`y = startY + level * spacing.vertical`), so long pipelines scroll vertically while the wide canvas sits empty horizontally.
6. **User-arranged positions are never persisted — two independent breaks.** Drag *is* captured into parent state (`page.tsx:225-227` `setNodes(applyNodeChanges(...))`) and save passes `includePositions: true` (`page.tsx:366,415`), writing `step._editorPosition` (`graph-utils.ts:119`). **(a)** `workflowStepSchema` (`validators.ts:331`) is a plain `z.object` with no `_editorPosition` field and no `.passthrough()`, so Zod **strips it** before the row is written. **(b)** The load call `definitionToGraph(definition.definition, { childContracts })` (`page.tsx:201`) omits `autoLayout: false`, so it defaults to `true` and stored positions are only honored `if (!autoLayout)` (`graph-utils.ts:246`). Net effect: every refresh re-runs auto-layout and the author's arrangement is lost.
7. **No overlap management.** `calculateSmartLayout` spreads siblings by a fixed `horizontal: 300` gap with **no awareness of node width/height** and no crossing-minimization, so dense levels and merge points overlap. Control edges use `getStraightPath` (`WorkflowTransitionEdge.tsx`) → straight lines that cut across intervening nodes.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **One `focusMode` boolean orchestrates 3 collapses** (app sidebar + palette + metadata), persisted via `usePersistedBooleanFlag('om:wf-editor-focus')` | Single headline control = the "ultimate goal". Reuses the existing flicker-free persisted-flag primitive (`packages/ui/src/backend/crud/usePersistedBooleanFlag.ts`). |
| **App-sidebar collapse via additive `useSidebarCollapse()` context** exported from `AppShell` | Cleanest, typed, BC-safe way for a page to drive the sidebar. Mirrors the **existing** force-collapse precedent for settings/profile routes (`AppShell.tsx:649-660`) — not a new pattern, just an exposed one. Restores the user's prior collapse state on Focus exit. |
| **Hard switch to Left→Right for all graphs** (product decision) | Cleaner, denser look immediately. Direction is implemented as a `direction: 'LR' \| 'TB'` parameter (default `'LR'`) so it stays testable/reversible even though the shipped default is LR everywhere. |
| **Node width `280 → 180px`**, `border-2 → border`, `rounded-xl → rounded-lg`, `p-4 → p-2.5`, title `text-base → text-sm`, status icon `w-5 → w-4`, description `line-clamp-2 → line-clamp-1` | Matches the reference density; `NODE_WIDTH` becomes a shared constant consumed by both the card and the layout spacing. |
| **Palette: ~190px expanded rail + ~56px collapsed icon rail**, persisted via `usePersistedBooleanFlag('om:wf-editor-palette')`; 8 buttons de-duplicated into one `.map()` over `NODE_TYPE_LABELS` | Removes ~120 lines of duplication; descriptions move to `title`/tooltip; "How to use" moves to a popover. Focus mode forces the collapsed rail. |
| **Migrate node colors to DS tokens** (`bg-primary`, `border-border`, semantic status tokens) while restyling | Boy-Scout rule: we are already touching every line; clears existing hardcoded-color DS violations. |
| **SubWorkflow data ports move to Top/Bottom under horizontal flow** | Control flow takes Left (target) / Right (source); data-mapping ports relocate to Top/Bottom so the two handle classes never overlap. `WorkflowDataMappingEdge` `sourcePosition`/`targetPosition` updated to match. |
| **Adopt `@dagrejs/dagre` for auto-layout** (`rankdir: 'LR'`, node-size-aware ranks + crossing minimization) replacing `calculateSmartLayout` | One library delivers both the horizontal direction and overlap-free placement; synchronous (fits the existing sync `definitionToGraph`), tiny, and the de-facto React Flow layout companion. The hand-transpose in the original Phase 3 is dropped in favor of this. *Alternative if the dep is rejected:* extend the custom algorithm to read measured node dimensions and add ordering — more code, weaker results. |
| **Persist positions: declare `_editorPosition` on `workflowStepSchema`; load with `autoLayout: false` when any step carries a stored position** | Fixes both breaks. Field is additive to the jsonb `definition` (no DB migration, no API contract change). "Stored positions present → respect them; none present (legacy/code graphs) → auto-arrange." |
| **Explicit "Auto-arrange / Tidy" toolbar action** re-runs dagre and overwrites positions | Reconciles persistence vs auto-layout: default respects the author's manual placement, the button is the *only* thing that re-lays-out an arranged graph. Also the on-demand normalizer for the LR switch. |
| **Orthogonal control edges** (`getSmoothStepPath`) | Right-angle routing reads cleanly in a left→right pipeline and avoids the straight-line-through-node problem. Data-mapping edges keep their bezier style for visual distinction. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Three independent toggles, no orchestrator | Fails the "one button" goal; user must click three controls to clear the canvas. |
| Drive app sidebar via cookie + `storage` event (no context) | Works but implicit and racy; the additive context is typed and matches the existing force-collapse logic. |
| Adopt `dagre`/`elk` for layout while switching direction | Larger dependency + behavior change; the existing custom layered layout transposes cleanly to horizontal with far less risk. |
| Keep TB, add a per-user LR/TB toggle | Rejected by product (hard switch). Direction param is retained internally regardless. |
| CSS-only node shrink (no shared constant) | Layout spacing must know node width to avoid overlap; a shared `NODE_WIDTH` keeps card and layout in sync. |

## User Stories / Use Cases

- A workflow author wants **one click to clear all chrome** (app sidebar, palette, metadata) so the canvas fills the screen, and one click (or `Esc`) to restore it.
- An author wants the palette **collapsed to icons by default-able** so node types stay reachable without a 384px sidebar.
- An author wants **horizontal pipelines** so a long chain reads left→right and uses the wide canvas.
- An author wants **compact nodes** so more of the graph is visible at once.
- A returning author wants their **Focus / palette-collapse preference remembered** across sessions.
- An author who drags nodes into a deliberate arrangement wants that arrangement **saved and restored on reload** — not reset to an auto-layout every refresh.
- An author with a messy graph wants a **one-click "Auto-arrange"** that lays nodes out left→right **without overlaps** and routes arrows around nodes.

## Phased Implementation

### Phase 1 — Compact, lighter nodes (low risk, visual)
- `WorkflowNodeCard.tsx`: introduce `NODE_WIDTH = 180` (exported), apply `w-[180px] rounded-lg border p-2.5`, `text-sm` title, `w-4 h-4` status icon, `line-clamp-1` description.
- Replace hardcoded handle/accent colors with DS tokens across `WorkflowNodeCard.tsx` and `components/nodes/*` handle `className`s (`!bg-primary !border-background`, selection ring via `ring-primary`).
- No handle-position change yet (still TB) — keeps this phase independently shippable.
- Tests: snapshot/render test asserting node width constant + DS-token classes; `yarn workspace @open-mercato/core build`.

### Phase 2 — Palette shrink + collapse rail
- Refactor palette block (`page.tsx:1176-1321`) into a compact rail component: map over the ordered node-type list (`['start','userTask','automated','invokeAgent','waitForSignal','waitForTimer','subWorkflow','end']`), `px-2 py-1.5 text-xs`, description as `title`/tooltip.
- Add `paletteCollapsed` via `usePersistedBooleanFlag('om:wf-editor-palette')`; expanded ~`w-[12rem]`, collapsed ~`w-14` icon-only with tooltips; toggle button reusing the `PanelLeftOpen/PanelLeftClose` idiom.
- Move "How to use" Alert into a popover trigger.
- Tests: palette renders all node types from the map; collapsed rail shows icons only; click-to-add still calls `handleAddNode`.

### Phase 3 — Horizontal (Left→Right) layout + overlap-free engine
> Requires the dependency decision (dagre vs custom-improve). Plan below assumes **dagre** (recommended).
- Add `@dagrejs/dagre` to `packages/core`. In `graph-utils.ts`, replace `calculateSmartLayout` with a `layoutWithDagre(steps, transitions, { direction: 'LR', nodeWidth: NODE_WIDTH, nodeHeight })` helper: build a `dagre.graphlib.Graph`, `setGraph({ rankdir: 'LR', nodesep, ranksep })`, add nodes with measured/estimated dimensions, add edges, run `dagre.layout()`, read back `x/y` (convert dagre's center-origin to React Flow's top-left). Keep the `DefinitionToGraphOptions.autoLayout` flag.
- All `components/nodes/*.tsx`: control-flow handles `target Position.Top→Left`, `source Position.Bottom→Right` (StartNode source→Right, EndNode target→Left, Fork/Join fan on Right/Left).
- `SubWorkflowNode.tsx`: relocate data-mapping ports to `Position.Top`(in)/`Position.Bottom`(out); `WorkflowDataMappingEdge.tsx`: set `sourcePosition`/`targetPosition` accordingly.
- `WorkflowTransitionEdge.tsx`: swap `getStraightPath` → `getSmoothStepPath` (orthogonal) using the now-horizontal handle positions.
- Tests: `graph-utils` unit test asserting LR ordering (a downstream step's `x` > its predecessor's, no two nodes share a bounding box); round-trip `graphToDefinition`/`definitionToGraph` preserved; handle ids unchanged (`'target'`/`'source'`, `in:`/`out:`) so existing edges still bind.
- *If the dep is rejected:* implement `layoutLayered` in-house — transpose the level math to `x`, and offset siblings by accumulated node heights (read from a measured-dimensions map) instead of a fixed gap; document the weaker crossing behavior.

### Phase 5 — Persist user positions + Tidy action
- `validators.ts`: add `_editorPosition: z.object({ x: z.number(), y: z.number() }).optional()` to `workflowStepSchema` so it survives save validation (additive jsonb field — no migration).
- `graph-utils.ts` `definitionToGraph`: when **any** step has `_editorPosition`, default to honoring stored positions (effectively `autoLayout: false` for those) and only auto-layout steps that lack one (newly added nodes); when **none** do, run dagre. `page.tsx:201` updated to drop the implicit always-auto-layout.
- Save already passes `includePositions: true`; verify the create/update route (`api/definitions`) round-trips the new field (it now passes validation).
- Add a toolbar **"Auto-arrange"** button → re-runs dagre over the current graph, overwrites node positions in state, marks dirty (so it persists). This is the single intentional full re-layout entry point.
- **Debounced autosave on drag (v1):** on `onNodeDragStop` (or a debounced node-position change), PUT the definition so positions persist without an explicit Save — matching the reference's "Auto saving". Guard: only when a definition `id` already exists (new unsaved drafts fall back to Save); debounce ~800ms–1s; reuse the existing `handleSave` PUT path with `includePositions: true`; skip in `isCodeOnly`. Surface the same "Auto saving…/Saved" affordance in the toolbar.
- Tests: save→reload round-trip preserves dragged coordinates; a graph with no stored positions auto-arranges while a graph with some stored positions keeps them and only new nodes get placed; debounced autosave fires once per drag burst and is suppressed for unsaved drafts / code-only; "Auto-arrange" replaces positions and persists.

### Phase 4 — Focus mode orchestrator
- `AppShell.tsx`: add additive `SidebarCollapseContext` + `useSidebarCollapse()` exposing `{ collapsed, setCollapsed, requestCollapse(next), releaseRequest() }`; internal collapse state honors an external request without losing the user's manual preference (store prior value, restore on release — mirroring `collapsedBeforeSectionRef`).
- `page.tsx`: add `focusMode` via `usePersistedBooleanFlag('om:wf-editor-focus')`; on enter → `requestCollapse(true)` + force palette collapsed + `setShowMetadata(false)` + slim `FormHeader`; on exit/`Esc` → `releaseRequest()` + restore palette/metadata to pre-focus values.
- Add the headline **Focus** toolbar button + a floating "Exit focus" pill; keyboard `F` toggle / `Esc` exit (consistent with dialog conventions).
- Keep minimap + canvas controls visible in Focus mode (per product decision).
- Tests: entering focus collapses all three regions; exiting restores prior sidebar collapse state; preference persists across reload.

## Backward Compatibility

- **`AppShell` (contract surface — Ask-First/BC):** changes are **additive only**. New `SidebarCollapseContext`/`useSidebarCollapse` export; existing props, `om_sidebar_collapsed` persistence, and default render are unchanged. Pages that do not consume the context behave exactly as today. Document the new export in `RELEASE_NOTES.md`.
- **Handle ids unchanged** (`'target'`/`'source'`, data ports keep `in:`/`out:` ids) so persisted edges keep binding after the Top/Bottom→Left/Right move — only `position` changes, not `id`.
- **Saved node positions:** no migration cost — the save path has always stripped `_editorPosition` and the load path always auto-lays-out, so **no existing definition holds coordinates today**. After Phase 5, positions persist going forward; legacy/code graphs auto-arrange (dagre) on first open exactly as they do now.
- **`workflowStepSchema` change is additive** — a new optional `_editorPosition` on a jsonb field. No SQL migration, no API URL/shape change, no event/ACL change. Existing definitions without the field validate and load unchanged.
- **New production dependency `@dagrejs/dagre`** (Ask-First). Bundled only in the workflows editor path. Replaces hand-rolled layout math; no contract surface affected.
- **One additive shared-UI export** (`useSidebarCollapse`). Otherwise pure UI refactor within the workflows module.

## Integration & Test Coverage

- **Unit:** `graph-utils` horizontal-layout coordinates; node-card width/token snapshot; palette map renders every node type; focus-mode state transitions.
- **UI paths (manual QA — `needs-qa`):**
  - `/backend/definitions/visual-editor` (new) and `/backend/definitions/visual-editor?id=…` (edit existing) — verify Focus toggle collapses app sidebar + palette + metadata and restores on exit/`Esc`.
  - Add each node type from the collapsed icon rail; connect nodes left→right; edit a node/edge; save; reload and confirm horizontal render.
  - SubWorkflow node: confirm data ports (Top/Bottom) and control handles (Left/Right) do not overlap and both connect.
  - Compact viewport (<1280px) still degrades gracefully (mobile editor untouched).
- **DS:** run `om-ds-guardian` over the touched node/palette files; assert no remaining hardcoded status colors on changed lines.
- **Commands:** `yarn generate` (no new discovered files expected), `yarn workspace @open-mercato/core build`, `yarn typecheck`, `yarn lint`, `yarn test`.

## Open Questions / Review Notes

- Confirm the **default palette state** on first load — expanded ~190px (current behavior, just narrower) vs collapsed icon rail. Proposed: **expanded by default**, collapsed only in Focus mode or by explicit user toggle.
- Confirm whether Focus mode should also be reachable from the **mobile** editor (`MobileVisualEditor.tsx`) or remain desktop-only. Proposed: desktop-only (mobile already hides chrome via sheets).

## Changelog

- 2026-06-27 — Spec created (analysis + 4-phase plan). Decisions locked with author: hard LR switch, Focus = app sidebar + palette + metadata, node width ~180px, spec-first.
- 2026-06-27 — Added Phase 5 (persist positions + Tidy) and overlap-free engine after author flagged that user positions aren't stored and nodes/arrows overlap. Root-caused: positions stripped by `workflowStepSchema` on save **and** ignored by `definitionToGraph` on load. Decisions locked: adopt `@dagrejs/dagre` (`rankdir: 'LR'`) for direction + overlap + orthogonal edges; respect saved positions (auto-arrange only newly added nodes); debounced autosave-on-drag in v1.
