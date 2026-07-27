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
| 1 | Compact, lighter nodes (`NODE_WIDTH=180`, DS tokens) | ✅ done | `8ea0da5f0` |
| 2 | Palette shrink + collapse rail | ✅ done | (this commit) |
| 3 | Horizontal (L→R) layout + dagre + orthogonal edges | ✅ done | (this commit) |
| 4 | Focus mode orchestrator (+ `useSidebarCollapse`) | ✅ done | (this commit) |
| 5 | Persist positions + Tidy + autosave-on-drag | ✅ done | (this commit) |

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
- 2026-06-27 — Phase 1 ✅ `8ea0da5f0`. Node card 280→180px, lighter (rounded-lg/border/p-2.5), `NODE_WIDTH` exported, handle/start/end colors → DS tokens. Core build PASS. Note: blue/amber/purple/cyan decorative node-type accents left as-is (no semantic DS token; spec permits).
- 2026-06-27 — Phase 2 ✅ `15c9103d6`. Palette: 8 buttons → one `.map()` over `PALETTE_NODE_TYPES`; rail `w-48` expanded / `w-14` icon-only collapsed via `usePersistedBooleanFlag('om:wf-editor-palette')`; "How to use" → disclosure; +`collapsePalette`/`expandPalette` i18n in en/es/de/pl. Net −47 lines. Build + typecheck PASS.
- 2026-06-27 — Phase 3 ✅ `9088bf2a8`. Added `@dagrejs/dagre@^3`. `calculateSmartLayout` → `layoutWithDagre` (`rankdir:'LR'`). Node handles → Left/Right (ids unchanged); SubWorkflow data ports → Top/Bottom; transition edges → orthogonal. Build + typecheck PASS; 585 workflows tests PASS.
- 2026-06-27 — Phase 4 ✅ `e1076a031`. `AppShell`: additive `useSidebarCollapse()` via separate `externalCollapseRequest` state (no-op outside provider; settings/profile collapse untouched). Editor `focusMode` collapses sidebar+palette+metadata, slim header, floating Exit pill, `F`/`Esc` guarded. +i18n ×4. ui+core build/typecheck PASS.
- 2026-06-27 — Phase 5 ✅. Traced save path: POST + PUT both validate via `workflowStepSchema` (`validators.ts:331`); added optional `_editorPosition` there → positions now persist (additive jsonb, no migration). `definitionToGraph` honors stored positions, dagre-places only steps lacking one. New `applyAutoLayout(nodes,edges)` + "Auto-arrange" toolbar button. Debounced (900ms) autosave on drag-end (`type==='position' && dragging===false`), guarded to saved non-code definitions, mirrors handleSave PUT incl. optimistic-lock header; subtle Saving…/Saved. +4 unit tests (`graph-layout-positions.test.ts`) + 3 i18n keys ×4. Full core test suite PASS (6112 tests). **All 5 phases complete.**

## Outcome
All 5 phases implemented, validated (build + typecheck + 6112 tests), and committed. New prod dep: `@dagrejs/dagre@^3`. New shared-UI export: `useSidebarCollapse` (`@open-mercato/ui/backend/AppShell`, additive). New persisted UI flags: `om:wf-editor-palette`, `om:wf-editor-focus`. Schema: additive optional `_editorPosition` on workflow steps (no DB migration). Follow-ups noted in spec: open questions (default palette state, mobile Focus); manual `needs-qa` UI pass recommended before any PR.
