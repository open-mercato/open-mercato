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

## CI round 3 — red `ephemeral-integration (8/15)`, 2026-08-07 (`om-auto-continue-pr`)

`TC-CRM-087` (unsaved column widths cleared on login) failed on all three attempts of
run 31152780003, in three different places: the resize drag never widening the column,
`page.goto` returning `net::ERR_ABORTED` after the account switch, and the login form
detaching mid-`fill`. It is **not** a shard flake — the same test, in the same shard
8/15, at the same position (#33) of the same 133-test set, passed on the branch's
previous head `f961fd0` and on `develop@4dca3f1a`.

- [x] Reproduce locally: the spec alone, with `TC-CRM-086`, and the whole `--shard 8/15`
      — all green locally (11.3 min vs 35 min on CI); the race needs a slow runner
- [x] Root cause: the login page's client bundle carries the whole backoffice grid stack
      (200 360 B → 56 252 B measured with esbuild, minified, react/next external)
- [x] Fix: `login.tsx` imports `clearAllPerspectiveState` from the leaf module — 7a6c717
- [x] Regression guard: public auth screens may not import `DataTable` / `CrudForm` — 7a6c717
- [x] Full validation gate (8/8 green, local runner) + push; CI shard 8/15 is the acceptance oracle

### CI round 3 — second pass, after `7aa543e`

The bundle fix removed the two login-side failure signatures (`ERR_ABORTED` on the
post-login `goto`, the password field detaching mid-`fill`); shard 8/15 then failed
purely on the resize drag, identically in attempt and retry. The CI trace of run
31165875661 shows the companies table refetching at 6.92 s while the drag starts at
7.0 s — a re-render mid-drag unmounts the handle and `DataTable` cancels the gesture
by design. `TC-CRM-086` already solves this with a settle-wait plus up to three drag
attempts; `TC-CRM-087` had neither.

- [x] Port TC-CRM-086's gesture hardening into TC-CRM-087 — 20fa4e0
- [x] Verify on a fresh ephemeral env (086 + 087 green; the earlier local red was a
      drained database from the full-shard run, not the change)

## Docs follow-up — `zielivia`, 2026-08-10 (`om-auto-continue-pr`)

Non-blocking review note, from the design-system consistency angle: the
"Building your own “Save view” affordance" section led with the hand-built control, so a
reader's first impression is that rolling your own button is the normal path. Left that
way, every module grows its own save button in a different spot, style and copy — exactly
the drift the built-in one exists to prevent. The recommended default is
`showSaveViewButton`; a hand-built control belongs to hosts that already pass a custom
`toolbar`, where the built-in button cannot render at all.

- [ ] Docs: lead the section with `showSaveViewButton`, show its one-prop usage first, and
      reserve the `viewApiRef` walkthrough for hosts with a custom `toolbar`
- [ ] Reorder the prop table to match that hierarchy and fold the custom-`toolbar` caveat
      into the opening instead of a trailing note four paragraphs down
- [ ] Align the `packages/ui/AGENTS.md` DataTable guideline with the same hierarchy
- [ ] Keep `yarn agents:check-budget` green (the `packages/ui` chain is on the ratchet)
