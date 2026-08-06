# DataTable public save-view / dirty-state API (issue #5047)

**Issue:** open-mercato/open-mercato#5047
**Branch:** `cez/01ad813a`
**Base:** `develop`
**Route:** feature request, small and fully scoped in triage → single implementation PR
(`om-auto-create-pr` contract, per `AGENTS.md` "Default for one-off bug fixes / small features"),
no separate design spec PR. Documented as a deliberate deviation from the `om-auto-fix-issue`
feature route in the run report and on the issue.

## Goal

`DataTable` keeps `initialSnapshotRef`, `getCurrentSettings()` and `savePerspectiveMutation`
fully internal, so a host application cannot render a toolbar "Save view" button or an
unsaved-changes indicator without patching `DataTable.tsx` (the reporter maintains a `yarn patch`).

Expose a **purely additive** public surface:

- `onColumnsDirtyChange` — read-only dirty-state callback
- `viewApiRef` — imperative handle (`getCurrentSettings`, `getDirtyState`, `saveCurrentView`, `openViewsSidebar`)
- `showSaveViewButton` — optional built-in toolbar button, **default off**

Existing call sites must behave byte-identically: no new default UI, no changed perspective UX.

## Constraints

- Additive only — `BACKWARD_COMPATIBILITY.md`: types/props are ADDITIVE-ONLY contract surfaces.
- DS tokens only, no arbitrary values, no hardcoded status colors (`.ai/ds-rules.md`).
- Toolbar buttons share `size` (h-9) per `packages/ui/AGENTS.md` → Critical Primitive Rules.
- No hardcoded user-facing strings — new `ui.dataTable.saveView.*` keys in all locales.
- `pageSize` is deliberately excluded from the dirty diff: `getCurrentSettings()` never emits it,
  so comparing it would report a permanent false-positive for saved views that carry one.

## Progress

- [x] Read `packages/ui/AGENTS.md`, `.ai/ui-components.md`, `.ai/ds-rules.md`, perspective internals
- [x] Confirm the API genuinely does not exist (FR triage gate, read-only)
- [x] Claim issue #5047 (assignee + `in-progress` + claim comment)
- [x] `packages/ui/src/backend/perspectiveDirty.ts` — pure diff helper + types
- [x] `DataTable.tsx` — baseline state, dirty computation, callback, imperative handle
- [x] `DataTable.tsx` — optional `showSaveViewButton` toolbar affordance (default off)
- [x] i18n keys in `apps/mercato/src/i18n/*` + `packages/create-app/template/src/i18n/*`
- [x] Unit tests: diff helper + DataTable public API behaviour
- [x] Docs: `apps/docs/docs/framework/admin-ui/perspectives.mdx`, `packages/ui/AGENTS.md`
- [x] Full validation gate (`.ai/agentic.config.json` → `validation.commands`)
- [x] Screenshots / UI evidence for the `needs-qa` gate
- [x] PR against `develop` + label set + rationale comment

## Review round 2 — `adeptofvoltron`, 2026-08-06 19:07 (`om-auto-fix-pr`)

- [x] Merge the latest `develop` into the PR branch (36 commits, no conflicts)
- [x] **Major** — `mergedInitialSettings` memoized on the host's own object, and the
      baseline seed guarded once per `perspectiveTableId`, so activating a view no
      longer has the next render reset the baseline to the SSR initial settings
- [x] **Minor** — dirty computation gated on `onColumnsDirtyChange || viewApiRef ||
      showSaveViewButton`, so tables that never opt in stop paying for the filter-tree
      serialization and the six-pass diff on every render
- [x] **Minor** — `saveCurrentView` returns the new `not-ready` reason while the
      perspectives permission check is still in flight, instead of `perspectives-disabled`
- [x] **Minor** — `viewDirtyStateRef` / `onColumnsDirtyChangeRef` mirrored in a layout
      effect; `currentViewSettingsRef` dropped entirely in favour of calling
      `getCurrentSettings()` — no ref is written during render any more
- [x] **Nit** — the pre-baseline dirty state reports the real `activePerspectiveId`
- [x] **Nit** — `openViewsSidebar` JSDoc + docs document the permission no-op
- [x] Regression tests: view activation with server initial settings (fails without the
      fix with exactly the reviewer's `["columnSizing","searchValue"]` signature),
      "No view" clear, role perspective, `not-ready` and `perspectives-disabled`
- [x] Follow-up issue for the locale-dependent `Intl` unit tests (repo hygiene)
