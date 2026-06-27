# Run: Workflow Visual Editor — Canvas Space Refactor

**Spec:** [`.ai/specs/2026-06-27-workflow-visual-editor-canvas-space.md`](../../specs/2026-06-27-workflow-visual-editor-canvas-space.md)
**Branch:** `feat/agent-orchestrator-mvp`
**Started:** 2026-06-27

Locked decisions: hard L→R switch; Focus mode = app sidebar + palette + metadata; node width ~180px; `@dagrejs/dagre` (`rankdir:'LR'`); respect saved positions (auto-arrange only new nodes); debounced autosave-on-drag in v1.

Execution model: one subagent per phase, run **sequentially** (shared files: `graph-utils.ts`, `page.tsx`, `components/nodes/*`). Commit + update this tracker after each phase.

---

## Progress

| Phase | Title | Status | Commit |
|-------|-------|--------|--------|
| 1 | Compact, lighter nodes (`NODE_WIDTH=180`, DS tokens) | ⬜ pending | — |
| 2 | Palette shrink + collapse rail | ⬜ pending | — |
| 3 | Horizontal (L→R) layout + dagre + orthogonal edges | ⬜ pending | — |
| 4 | Focus mode orchestrator (+ `useSidebarCollapse`) | ⬜ pending | — |
| 5 | Persist positions + Tidy + autosave-on-drag | ⬜ pending | — |

Status legend: ⬜ pending · 🟡 in progress · ✅ done · ⚠️ done with caveats

---

## Phase detail

### Phase 1 — Compact, lighter nodes
- `WorkflowNodeCard.tsx`: export `NODE_WIDTH = 180`; `w-[180px] rounded-lg border p-2.5`, title `text-sm`, status icon `w-4 h-4`, description `line-clamp-1`.
- Migrate hardcoded hex/Tailwind status colors in card + `components/nodes/*` handles to DS tokens.
- Handles stay Top/Bottom in this phase.
- Validation: build core, lint touched files.

### Phase 2 — Palette shrink + collapse
- Refactor 8 copy-pasted palette buttons into one map over node-type list; compact `px-2 py-1.5 text-xs`; descriptions → tooltip.
- `paletteCollapsed` via `usePersistedBooleanFlag('om:wf-editor-palette')`; expanded ~`w-48`, collapsed ~`w-14` icon rail.
- "How to use" Alert → popover.

### Phase 3 — Horizontal layout + dagre + orthogonal edges
- Add `@dagrejs/dagre` to `packages/core`. Replace `calculateSmartLayout` with `layoutWithDagre(..., { direction:'LR', nodeWidth: NODE_WIDTH })`.
- Node control handles → Left(target)/Right(source); Start→Right, End→Left, Fork/Join fan.
- SubWorkflow data ports → Top/Bottom; `WorkflowDataMappingEdge` positions updated.
- `WorkflowTransitionEdge`: `getStraightPath` → `getSmoothStepPath`.

### Phase 4 — Focus mode
- `AppShell.tsx`: additive `SidebarCollapseContext` + `useSidebarCollapse()` (request/release without losing user pref).
- `page.tsx`: `focusMode` via `usePersistedBooleanFlag('om:wf-editor-focus')`; enter → collapse sidebar + palette + hide metadata + slim header; exit/`Esc` restores. Headline Focus button + floating exit pill; `F`/`Esc`.

### Phase 5 — Persist positions + Tidy + autosave
- `validators.ts`: add optional `_editorPosition` to `workflowStepSchema`.
- `definitionToGraph`/`page.tsx:201`: respect stored positions; auto-arrange only nodes lacking one.
- "Auto-arrange" toolbar button (re-run dagre, overwrite, persist).
- Debounced autosave on `onNodeDragStop` (existing definition id only, ~1s, skip code-only).

---

## Log
- 2026-06-27 — Tracker created; spec finalized with phases 1–5. Beginning Phase 1.
