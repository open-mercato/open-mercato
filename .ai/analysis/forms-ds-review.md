# `forms` module — design-system compliance review

**Scope:** every `.tsx` file under `packages/core/src/modules/forms/` (Form Studio, backend
list/analytics/history/distribution/submissions pages, admin distribution panels, the public form
runner, injection widgets) plus the `.ts` state/runtime helpers that directly feed the audited
`.tsx` files. Read-only review — no source file was modified. Findings are cross-checked against
`.ai/ds-rules.md`, `.ai/ui-components.md`, `.ai/ui-backend-components.md`, `packages/ui/AGENTS.md`,
the `@open-mercato/eslint-plugin-ds` structural rules, and the `yarn i18n:check-hardcoded` scanner.

**How this review was produced:** five parallel sub-reviews (Form Studio canvas/logic/palette;
Form Studio validation/style; backend list/detail/analytics/history/submissions pages; admin
distribution panels + the public runner chrome; runner field renderers + frontend pages + injection
widgets), each reading every file in its slice in full, plus direct verification by the reviewer of
the runner field renderers, the injection widgets, the DS eslint plugin output, and the i18n
hardcoded-string scanner. Every finding below cites a real `file:line` that was actually read.

**Nuance applied throughout:** the Form Studio lets a form author pick their own theme colours for
the form they're building. Dynamic inline colour values in `studio/style/ColorControl.tsx`,
`studio/style/BackgroundControl.tsx`, `studio/style/presets.ts`, `studio/style/contrast.ts`, and the
runner's `ui/public/style/applyStyle.ts` (plus every place that renders their *output*, e.g.
`ui/public/FormRunner.tsx`'s `styleProps(...)` calls, `frontend/embed/[slug]/page.tsx`'s
`.dark`-class toggle driven by the distribution's `embed.theme` setting) are **by design** and are
**not** flagged below. Only static UI chrome (labels, buttons, borders, spacing, radius, focus
rings) around those theme pickers was audited normally.

---

## Executive summary

| Severity | Distinct finding types | Total sites | Files touched |
|---|---|---|---|
| MUST fix before merge | 10 | ~75 | 24 |
| SHOULD fix | 6 | ~45 | 20 |
| nit | 6 | ~15 | 10 |

The single highest-value finding is **item 1** below (invalid status-token role suffixes that
compile to nothing — a real rendering bug, not just a style nit) and **item 4** (two hand-rolled
`Drawer` reimplementations). The single highest-value *reuse* finding is the systemic `flash()`
raw-key bug (item 3) — it is a functional defect (toasts show untranslated key strings to end
users), not a style nit.

---

## Part 1 — Systemic patterns (ranked, ordered by site count within each tier)

### MUST fix

#### 1. Invalid/non-existent status-token role suffixes — compiles to no CSS at all (17 sites, 8 files)

`globals.css` only defines `--color-status-{error,warning,success,info,neutral,pink}-{bg,text,border,icon,solid,solid-foreground}`. None of these classes exist, so Tailwind drops them — the element renders **completely unstyled** (no colour at all), not just "non-compliant":

| File:line | Current (broken) | Fix |
|---|---|---|
| `backend/forms/[id]/studio/palette/RolesEditor.tsx:98` | `text-status-danger-foreground` | `text-status-error-text` |
| `backend/forms/[id]/studio/palette/RolesEditor.tsx:220` | `text-status-danger-foreground` | `text-status-error-text` |
| `backend/forms/[id]/studio/preview/PreviewSurface.tsx:1153` | `bg-status-error-surface` | `bg-status-error-bg` |
| `backend/forms/[id]/studio/preview/PreviewSurface.tsx:1155` (approx, `npsBandClass`) | `bg-status-warning-surface` | `bg-status-warning-bg` |
| `backend/forms/[id]/studio/preview/PreviewSurface.tsx:1158` (approx) | `bg-status-success-surface` | `bg-status-success-bg` |
| `runner/FormRunner.tsx:650` (`npsRunnerBandClass`) | `bg-status-error-surface` | `bg-status-error-bg` |
| `runner/FormRunner.tsx:653` | `bg-status-warning-surface` | `bg-status-warning-bg` |
| `runner/FormRunner.tsx:655` | `bg-status-success-surface` | `bg-status-success-bg` |
| `ui/public/components/SaveIndicator.tsx:38` | `text-status-success-foreground` | `text-status-success-text` |
| `ui/public/components/SaveIndicator.tsx:43` | `text-status-success-foreground` | `text-status-success-text` |
| `ui/public/components/SaveIndicator.tsx:46` | `text-status-warning-foreground` | `text-status-warning-text` |
| `ui/public/components/SaveIndicator.tsx:50` | `text-status-warning-foreground` | `text-status-warning-text` |
| `ui/public/components/SaveIndicator.tsx:53` | `text-status-error-foreground` | `text-status-error-text` |
| `ui/public/components/SaveIndicator.tsx:55` | `text-status-error-foreground` | `text-status-error-text` |
| `ui/public/FormRunner.tsx:424` | `text-status-warning-foreground` | `text-status-warning-text` |
| `ui/public/components/SectionStepper.tsx:46` | `bg-status-success` (missing role suffix entirely) | `bg-status-success-bg` (or `-icon` for a solid dot) |
| `widgets/injection/anonymize-button/widget.tsx:115` | `text-status-error-foreground` on a `Trash2` destructive-action icon | Per the DS colour decision tree, a destructive icon should not use a status token at all → `text-destructive` |

#### 2. Deprecated `<Alert variant="...">` instead of `status` (16 sites, 13 files)

Guarded by the `om-ds/no-legacy-alert-variant` lint rule (confirmed via `yarn lint:ds`, see Part 4).
Replace `variant="destructive"` → `status="error"`, `variant="warning"` → `status="warning"`,
`variant="default"`/`"information"` → `status="information"` (add `style="light"` to match current
visual weight):

- `backend/forms/[id]/studio/logic/HiddenFieldsPanel.tsx:103`
- `backend/forms/[id]/studio/logic/VariablesPanel.tsx:251`
- `backend/forms/[id]/studio/preview/PreviewSurface.tsx:1136`
- `backend/forms/[id]/studio/validation/PatternEditor.tsx:112`
- `backend/forms/[id]/FormStudio.tsx:3179` (`PublishDialog`, `variant="warning"`)
- `runner/FormRunner.tsx:181`, `:633`
- `frontend/forms/[id]/run/page.tsx:47`
- `ui/public/EmbeddedForm.tsx:218`
- `ui/public/FormRunner.tsx:196`, `:360`
- `ui/public/components/CompletionScreen.tsx:91`
- `ui/public/components/ReviewStep.tsx:71`
- `backend/forms/[id]/submissions/components/SubmissionDrawer.tsx:210`, `:283`

#### 3. `flash()` called with a raw, untranslated i18n key instead of `t(key)` (~20 sites, 4 files)

A functional bug, not a style nit — on the affected code paths the toast literally renders the
string `"forms.studio.autosave.error"` (etc.) to the user instead of translated copy. Proven wrong
by contrast with the *correct* pattern already present in the same files
(`FormStudio.tsx:513-514`, `:599-605` correctly call `flash(t('forms.studio.fields.deletedFlash'), 'info')`).

| File | Lines (raw-key `flash()` calls) | Fix pattern |
|---|---|---|
| `backend/forms/page.tsx` | `:109`, `:120`, `:141`, `:144` | `flash(t('forms.errors.internal'), 'error')`, `flash(t('forms.list.actions.archiveSuccess'), 'success')` (add the missing success key) |
| `backend/forms/[id]/FormStudio.tsx` | `:435`, `:453`, `:737`, `:794`, `:808`, `:983`, `:1066`, `:1079`, `:1109`, `:1138`, `:1169`, `:1297`, `:1333`, `:3160` | Wrap every literal key argument in `t(...)` |
| `backend/forms/[id]/submissions/page.tsx` | `:107`, `:118` | `flash(t('forms.errors.internal'), 'error')` |
| `backend/forms/[id]/submissions/components/SubmissionDrawer.tsx` | `:165`, `:168`, `:186`, `:189`, `:501`, `:504` | `flash(t('forms.drawer.reopen.failed'), 'error')` etc. |

#### 4. Hand-rolled fixed-panel "drawer" instead of the `Drawer` primitive (2 sites)

`.ai/ui-backend-components.md` → Page scaffolding / component quick reference: "Side sheet /
secondary form → `Drawer` … never a hand-rolled fixed panel." Both sites independently reimplement
the same thing the primitive already provides for free (focus trap, Escape-to-close, ARIA wiring):

- **`backend/forms/[id]/submissions/components/SubmissionDrawer.tsx:333-372`** (`DrawerShell`) —
  `fixed inset-0` container + manual backdrop `<div>` + manual `role="dialog" aria-modal` + a manual
  `window.addEventListener('keydown', ...)` Escape handler at `:131-140`. Bundled sub-violations at
  the same site:
  - `:340` — numeric `z-50` for a cross-component overlay (ds-rules bans numeric `z-10/20/40/50` for
    anything that overlaps *other* components) → `z-modal` (or `z-modal-elevated` if it can stack
    above another drawer).
  - `:342` — `bg-foreground/40` backdrop → ds-rules specifies `bg-black/20` for a drawer/side-panel
    backdrop (or simply inherit `Drawer`'s own overlay).
  - `:362` — `aria-label="Close drawer"` hardcoded, untranslated → `t('forms.drawer.actions.close')`.
  - Fix: restructure into `Drawer`/`DrawerContent`/`DrawerHeader`/`DrawerBody`/`DrawerFooter` from
    `@open-mercato/ui/primitives/drawer`; delete the manual keydown listener.
- **`ui/admin/forms/[id]/distributions/RecipientsTable.tsx:370-475`** — same pattern: manual
  `fixed inset-0 z-modal flex justify-end` (this one at least uses the semantic `z-modal` token) +
  manual backdrop `<div>` + `<aside role="dialog" aria-modal>` + a manual `window.addEventListener`
  Escape handler at `:167-176`.
  - `:371` — `bg-foreground/40` backdrop → `bg-black/20`.
  - `:432` — bare `rounded` (not a named DS token) → `rounded-sm`/`rounded-md`.
  - `:392-397` — raw `<label htmlFor>` + `Textarea` instead of the `FormField` wrapper.
  - Fix: same restructure into `Drawer`/`DrawerContent`/etc.

#### 5. Raw `<button>` instead of `Button`/`IconButton` (9 sites/regions, 7 files)

Violates `packages/ui/AGENTS.md` Never rule #1 / Critical Primitive Rule #1 ("NEVER use raw
`<button>`"):

| File:lines | What it is | Fix |
|---|---|---|
| `backend/forms/[id]/studio/canvas/FieldRow.tsx:223-231` | Drag-handle grip button (same component already imports/uses `IconButton` for adjacent move/delete) | `IconButton` — verify dnd-kit's `PointerSensor` still fires through the wrapped element before merging |
| `backend/forms/[id]/studio/canvas/SectionContainer.tsx:196-204` | Same drag-handle pattern | `IconButton`, same caveat |
| `backend/forms/[id]/studio/palette/PaletteCard.tsx:23-37` | Draggable palette entry | `Button variant="outline"`, same dnd-kit caveat |
| `runner/FormRunner.tsx:691-704` | NPS score buttons (0-10) | `Button`/`IconButton` styled via `className`; keep the colour-band logic |
| `runner/FormRunner.tsx:750-762` | Opinion-scale (star/dot/thumb) buttons | Same |
| `runner/ScaleField.tsx:45-62` | Discrete numeric-scale button row (≤11 steps) | `Button`, same styling |
| `runner/RankingField.tsx:192-201` | Drag-handle button | `IconButton`, forwards refs/props so `{...sortable.listeners} {...sortable.attributes}` still spreads correctly |
| `runner/SignatureField.tsx:129-136` | "Clear" text-link button | `Button variant="ghost"` (or `LinkButton`, matching the current underline styling) |
| `ui/public/components/SectionStepper.tsx:54` | Step-pill button (part of the reinvented-`StepIndicator` finding, Part 2) | Resolved by swapping to `StepIndicator` |

### SHOULD fix

#### 6. Middot "·" used as a separator (11 sites, 8 files)

`.ai/ds-rules.md` § Content & Copy: "NEVER use '·' as a separator — use an em dash '—' or
restructure." (Contrast: `runner/MatrixField.tsx:141` already does this correctly with `—`.)

- `ui/admin/forms/[id]/distributions/RecipientsTable.tsx:366`
- `ui/admin/forms/[id]/distributions/DistributionsPanel.tsx:317`
- `backend/forms/[id]/studio/preview/PreviewSurface.tsx:1038`
- `backend/forms/[id]/studio/logic/ConditionBuilder.tsx:240`, `:250`, `:265`
- `backend/forms/[id]/FormStudio.tsx:1537` (`<span className="mx-2">·</span>`)
- `backend/forms/[id]/analytics/page.tsx:109`, `:120`
- `backend/forms/[id]/submissions/components/SubmissionDrawer.tsx:233`
- `backend/forms/[id]/submissions/page.tsx:229`

#### 7. Non-`CrudForm` write not wrapped in `useGuardedMutation(...).runMutation(...)` (9 sites, 4 files)

`packages/ui/AGENTS.md` Always: "Use `useGuardedMutation` for every write that cannot use
`CrudForm`." (Contrast: `widgets/injection/anonymize-button/widget.tsx` does this correctly — a
good template.)

- `backend/forms/page.tsx:138-146` (`handleArchive`, raw `apiCall(..., { method: 'DELETE' })`)
- `backend/forms/[id]/FormStudio.tsx` — `persistDraftRaw` (`:422-445`), `persistFormPatch`
  (`:1288-1301`), `persistLocalePatch` (`:1317-1338`), `PublishDialog.submit` (`:3147-3164`)
- `backend/forms/[id]/studio/palette/FormAppearancePanel.tsx:206-230` (`handleLogoFile`, `POST` to
  `/api/forms/{id}/theme-logo`)
- `backend/forms/[id]/submissions/components/SubmissionDrawer.tsx` — `handleReopen` (`:160-163`,
  POST), `handleRevokeActor` (`:181-184`, DELETE), `ActorPanel.handleAssign` (`:492-499`, POST)

#### 8. Hardcoded user-facing English strings not routed through `t()` (11 sites, 6 files)

- `backend/forms/[id]/studio/preview/PreviewSurface.tsx:847` (`'— No options configured —'`),
  `:860` (`'Select…'` placeholder)
- `backend/forms/[id]/history/page.tsx:168` (`'Base'`), `:176` (`'Against'`)
- `backend/forms/[id]/submissions/components/SubmissionDrawer.tsx:112`, `:115` (thrown error text
  rendered directly via `<AlertDescription>{error}</AlertDescription>` at `:211`), `:121`
  (`'Unknown error.'` fallback)
- `frontend/forms/[id]/run/page.tsx:34`, `:37` (`'Failed to load form.'`)
- `frontend/[orgSlug]/portal/submissions/[id]/continue/page.tsx:40` (`'Loading…'` — contrast with
  the compliant `t()`-wrapped copy one layer down in `EmbeddedForm.tsx:191`)
- `runner/FormRunner.tsx:427` (`<SelectValue placeholder="Select…" />` — contrast with the correct
  `t(...)` pattern already used elsewhere in the same file, e.g. `:610`, `:359-368`)

#### 9. Arbitrary text sizes not on the exception list (7 sites, 5 files)

ds-rules only exempts `text-[9px]` (notification badge / `Avatar size="sm"`); `text-[10px]`/
`text-[11px]` are real violations:

- `backend/forms/[id]/studio/logic/HiddenFieldsPanel.tsx:70`, `:114` → `text-xs`
- `backend/forms/[id]/studio/logic/VariablesPanel.tsx:155` → `text-xs`
- `backend/forms/[id]/studio/palette/InputParametersTab.tsx:184` (uppercase locale badge) →
  `text-overline font-semibold uppercase tracking-widest`
- `backend/forms/[id]/studio/palette/RolesEditor.tsx:108`, `:188` → `text-xs`
- `ui/public/components/SectionStepper.tsx:64` → `text-overline` (or restructure to avoid a custom
  size for a step-ordinal)

#### 10. Missing `Label` primitive / labels not programmatically associated with their control (10 files, ~16 instances)

`packages/ui/src/primitives/label.tsx` exports `Label` (`htmlFor`-capable, `text-sm font-medium`)
— the exact combination ds-rules prescribes for "Form label." These files render a bare
`<label>`/`<span>` instead, with no `htmlFor`/`id` pairing:

- `validation/LengthRangeEditor.tsx:30-32`, `:45-47`
- `validation/NumberRangeEditor.tsx:30-32`, `:44-46`
- `validation/FileConstraintsEditor.tsx:53-55`, `:64-66`
- `validation/NpsAnchorsEditor.tsx:29-31`, `:41-43`
- `validation/MessageOverridesEditor.tsx:62-64` (repeats per loop iteration)
- `validation/OpinionIconSelect.tsx:29-31`
- `validation/GroupConfigEditor.tsx:136-138`, `:149-151`
- `validation/SignatureConfigEditor.tsx:43-46` (label also doesn't wrap the `Textarea`)
- `validation/MatrixColumnsEditor.tsx:102-104`, `:113-115` (repeats per row — a screen-reader user
  hears an undifferentiated "Value"/"Label" per row with no row context)
- `validation/MatrixRowsEditor.tsx:104-106`, `:115-117` (same per-row issue)

Fix pattern for all:
```tsx
import { Label } from '@open-mercato/ui/primitives/label'
const id = React.useId()
<Label htmlFor={id}>{t('...')}</Label>
<Input id={id} ... />
```
For the two per-row editors, additionally disambiguate: `aria-label={`${t('...')} ${index + 1}`}`.

---

## Part 2 — Reinvented components (the single highest-value reuse findings)

| File:lines | Reinvents | `packages/ui` equivalent | Mechanical swap? |
|---|---|---|---|
| `backend/forms/[id]/submissions/components/SubmissionDrawer.tsx:333-372` | Hand-rolled fixed side panel | `Drawer` (`@open-mercato/ui/primitives/drawer`) | No — restructure content into Header/Body/Footer slots |
| `ui/admin/forms/[id]/distributions/RecipientsTable.tsx:370-475` | Hand-rolled fixed side panel | `Drawer` | No — same restructure |
| `ui/public/components/SectionStepper.tsx:26-76` | Raw-button step pills with manual tone classes | `StepIndicator` (`@open-mercato/ui/primitives/step-indicator`) | No — needs a small adapter mapping `completedSet`/`currentIndex` → `status: 'complete'\|'current'\|'upcoming'` |
| `backend/forms/[id]/analytics/page.tsx:245-279` (`AnsweredVsBlankTable`) | Raw `<table>/<thead>/<tbody>` (confirmed by `om-ds/no-raw-table`, see Part 4) | `TopNTable` (`@open-mercato/ui/backend/charts`) or `DataTable` | Mostly — column/data shape already exists |
| `backend/forms/[id]/FormStudio.tsx:1468-1483` and `backend/forms/[id]/history/page.tsx:108-123` | Missing-record state shown via `ErrorMessage` | `RecordNotFoundState` (`@open-mercato/ui/backend/detail`) | Yes, once a 404 is distinguished from a generic load failure |
| `runner/ScaleField.tsx:82-96` | Raw `<input type="range">` + hand-rolled value-bubble tracking | `Slider` (`@open-mercato/ui/primitives/slider`, `value` as `[number]`) | Mostly — the bubble-tracking logic (`:72-80`) is exactly what `Slider` should own |
| `runner/MatrixField.tsx:171-183` | Raw `<input type="radio">` for single-select matrix cells | `Radio`/`RadioGroup` (`@open-mercato/ui/primitives/radio`) | Yes, scoped per row |
| `backend/forms/[id]/studio/logic/VariablesPanel.tsx:219-223` | Raw `<input type="checkbox">` list | `Checkbox`/`CheckboxField` | Yes |
| `backend/forms/[id]/studio/logic/VariablesPanel.tsx:236-243` | Raw `<textarea>` (while `Textarea` is imported/used elsewhere in the same file family) | `Textarea` | Yes |
| `backend/forms/[id]/studio/logic/ConditionBuilder.tsx:195-211` | Raw `<input type="radio">` pair for AND/OR mode | `Radio`/`RadioField` | Yes |
| `backend/forms/[id]/studio/canvas/SectionContainer.tsx:207-224` | Raw `<input>` for the section-title inline editor | `Input` (already used in sibling files) | Yes |
| `widgets/injection/access-audit-panel/widget.tsx:103-125` | Hand-rolled `<ul>/<li>` audit-trail list | `ActivityFeed` (`@open-mercato/ui/primitives/activity-feed` — DS docs name it explicitly for "audit feeds") | Mostly — actor/when/purpose/IP per row maps onto `ActivityFeedItem` |
| `backend/forms/[id]/studio/preview/PreviewSurface.tsx:392-407` | Hand-rolled `role="tablist"`/`role="tab"` page switcher | `Tabs`/`TabsList`/`TabsTrigger` (already used correctly by a sibling file, `FormPalettePanel.tsx`) | Likely for the tab strip itself; the Back/Next pagination below stays custom |
| `backend/forms/[id]/studio/logic/JumpsEditor.tsx:164`, `:174` | `IconButton` content is the literal glyphs `↑`/`↓` instead of lucide icons (a sibling file, `canvas/FieldRow.tsx`, already imports `ArrowUp`/`ArrowDown` for the identical affordance) | `ArrowUp`/`ArrowDown` from the local `lucide-icons` module | Yes, trivial |

**Not cleanly mechanical (flagging for a design decision, not a blocking defect):**
- `backend/forms/[id]/studio/style/ColorControl.tsx:226-243` — the hex `<input type="color">` +
  hex-text `Input` pair overlaps `packages/ui/src/primitives/color-picker.tsx`, but `ColorPicker` is
  hex-only while `ColorControl` implements a token-or-hex model (8 curated DS-role tokens plus
  arbitrary hex) that `ColorPicker` has no concept of. Reusing it would still require building the
  token-swatch popover from scratch.
- `backend/forms/[id]/studio/YesNoRow.tsx` — a two-`Button` boolean toggle that could map to
  `SegmentedControl`, but the label-left/buttons-right layout differs from `SegmentedControl`'s
  typical usage; needs a design call.
- `backend/forms/[id]/studio/logic/RecallTokenPicker.tsx:64-75` — a small hand-rolled filterable
  list inside a `Popover` could reuse `CommandMenu`, but the current implementation is small and
  self-contained; low priority.
- `runner/FormRunner.tsx` NPS-score buttons / opinion-scale buttons — **not** a clean `Rating`
  swap: NPS needs discrete colour-banded 0-10 buttons and opinion-scale needs a `thumb` icon option
  `Rating` likely doesn't support. Treat as a design decision, not a drop-in swap.

---

## Part 3 — Per-file findings (complete list, grouped by file/directory)

### `backend/forms/page.tsx`
- **MUST** `:138-146` `handleArchive` uses raw `apiCall(..., DELETE)` — wrap in `useGuardedMutation` (Part 1 #7).
- **MUST** `:109`, `:120`, `:141`, `:144` raw-key `flash()` calls (Part 1 #3).
- **SHOULD** `:132-136` confirm-dialog has no `description` stating what "Archive" does (not a hard violation — `useConfirmDialog` already supplies Cmd/Ctrl+Enter + Escape).

### `backend/forms/create/page.tsx`
- Clean. Correctly uses `Page`/`PageBody`, `CrudForm`, `createCrud`, `t()`.

### `backend/forms/[id]/page.tsx`
- Thin delegate to `FormStudio.tsx`; no independent findings.

### `backend/forms/[id]/FormStudio.tsx` (3205 lines)
- **MUST** `:1468-1483` missing-record shown via `ErrorMessage` instead of `RecordNotFoundState` (Part 2).
- **MUST** `:435,453,737,794,808,983,1066,1079,1109,1138,1169,1297,1333,3160` raw-key `flash()` (Part 1 #3).
- **MUST** `:3179` deprecated `<Alert variant="warning">` (Part 1 #2).
- **MUST** `:422-445,1288-1301,1317-1338,3147-3164` writes not wrapped in `useGuardedMutation` (Part 1 #7).
- **SHOULD** `:1537` middot separator (Part 1 #6).
- Compliant: no arbitrary Tailwind values, no `dark:` overrides, no raw hex in this file;
  `PublishDialog` correctly implements Cmd/Ctrl+Enter (`:3169-3174`) and relies on `Dialog`'s native
  Escape.
- (Also verified via grep: `FormStudio.tsx:891-893` configures `useSensor(KeyboardSensor, { coordinateGetter: gridKeyboardCoordinates })` alongside `PointerSensor` for the canvas `DndContext` at `:1615` — **the drag-and-drop canvas is keyboard-operable**, resolving the open accessibility question the canvas/logic/palette sub-review raised.)

### `backend/forms/[id]/analytics/page.tsx`
- **MUST** `:245-279` (`AnsweredVsBlankTable`) raw `<table>` — confirmed independently by
  `om-ds/no-raw-table` (Part 4) and by manual read (Part 2).
- **SHOULD** `:108-110`, `:120-122` middot separators (Part 1 #6).
- Compliant: correctly reuses `KpiCard`, `BarChart`, `LineChart`, `Card`, `LoadingMessage`/`ErrorMessage`, `Page`/`PageBody`.

### `backend/forms/[id]/distributions/page.tsx`
- **MUST** `:1` no `<Page><PageBody>` wrapper — confirmed by `om-ds/require-page-wrapper` (Part 4).
  Thin delegate to `ui/admin/forms/[id]/distributions/DistributionsPanel.tsx`, which itself is clean
  (see below) — add the wrapper at this outer page.

### `backend/forms/[id]/history/page.tsx`
- **MUST** `:64`/`:108-123` missing-record shown via `ErrorMessage` instead of `RecordNotFoundState` (Part 2).
- **MUST** `:168`, `:176` hardcoded `'Base'`/`'Against'` labels (Part 1 #8).
- Observation (not a hard finding): `:141-209` version list + diff viewer is a hand-rolled
  `<ol>`/`<ul>` layout — plausible bespoke "compare" UI for a handful of versions, not clearly a
  `DataTable` fit.
- Otherwise compliant: `Page`/`PageBody`, `LoadingMessage`, `Tag`, `t()` used consistently elsewhere.

### `backend/forms/[id]/page.tsx` (root `[id]/page.tsx`)
- **MUST** no `<Page><PageBody>` wrapper — confirmed by `om-ds/require-page-wrapper` (Part 4).

### `backend/forms/[id]/submissions/page.tsx`
- **MUST** `:107`, `:118` raw-key `flash()` (Part 1 #3).
- **SHOULD** `:229` middot separator (Part 1 #6).
- Compliant list page otherwise: `DataTable`, `Tag`, filters, `t()` on every column header. (Two
  `aria-label`s — `"Multiple roles"` `:184`, `"PDF available"` `:191` — are flagged by
  `yarn i18n:check-hardcoded`, Part 5; low severity, route through `t()`.)

### `backend/forms/[id]/submissions/components/SubmissionDrawer.tsx`
- **MUST** `:333-372` hand-rolled `Drawer` reimplementation, with bundled `z-50`/backdrop-opacity/aria-label sub-findings (Part 1 #4 / Part 2).
- **MUST** `:210`, `:283` deprecated `<Alert variant>` (Part 1 #2).
- **MUST** `:112`, `:115`, `:121` hardcoded error strings rendered directly to the user (Part 1 #8) — also flagged by `yarn i18n:check-hardcoded` (Part 5).
- **MUST** `:160-163`, `:181-184`, `:492-499` writes not wrapped in `useGuardedMutation` (Part 1 #7).
- **MUST** `:165,168,186,189,501,504` raw-key `flash()` (Part 1 #3).
- **SHOULD** `:233` middot separator (Part 1 #6).
- Positive: `ActorPanel`'s inline mini-form (`:512-523`) correctly implements Cmd/Ctrl+Enter +
  Escape — a good template to reuse once `DrawerShell` moves to the real `Drawer` primitive.

### `backend/forms/[id]/studio/canvas/*`
- **MUST** `FieldRow.tsx:223-231`, `SectionContainer.tsx:196-204` raw-button drag handles (Part 1 #5 / Part 2).
- **SHOULD** `SectionContainer.tsx:207-224` raw `<input>` instead of `Input` (Part 2), and the same
  input has **no** associated label/`aria-label` when not in edit mode — ds-rules § Forms: "Every
  input MUST have a visible label (never placeholder-only)." Add `aria-label={titlePlaceholder}` at
  minimum.
- `DragOverlayCard.tsx`, `DropIndicator.tsx`, `GridSlot.tsx` — clean.

### `backend/forms/[id]/studio/logic/*`
- **MUST** `HiddenFieldsPanel.tsx:103` deprecated `<Alert variant>` (Part 1 #2).
- **MUST** `VariablesPanel.tsx:251` deprecated `<Alert variant>` (Part 1 #2).
- **SHOULD** `VariablesPanel.tsx:219-223` raw checkbox list, `:236-243` raw textarea (Part 2).
- **SHOULD** `ConditionBuilder.tsx:195-211` raw radio pair (Part 2); `:240,250,265` middot separators (Part 1 #6).
- **SHOULD** `HiddenFieldsPanel.tsx:70,114`, `VariablesPanel.tsx:155` arbitrary text sizes (Part 1 #9).
- **nit** `JumpsEditor.tsx:164,174` Unicode ↑/↓ glyphs instead of lucide icons (Part 2).
- `RecallTokenPicker.tsx` — clean (nit: could reuse `CommandMenu`, low priority, see Part 2).

### `backend/forms/[id]/studio/palette/*`
- **MUST** `FormAppearancePanel.tsx:206-230` write not wrapped in `useGuardedMutation` (Part 1 #7).
- **SHOULD** `RolesEditor.tsx:98,220` invalid `text-status-danger-foreground` token (Part 1 #1).
- **SHOULD** `PaletteCard.tsx:23-37` raw-button draggable card (Part 1 #5 / Part 2).
- **SHOULD** `InputParametersTab.tsx:184`, `RolesEditor.tsx:108,188` arbitrary text sizes (Part 1 #9).
- `FormPalettePanel.tsx` — clean.

### `backend/forms/[id]/studio/preview/*`
- **MUST** `PreviewSurface.tsx:1153-1158` invalid `-surface` token (Part 1 #1).
- **MUST** `PreviewSurface.tsx:1200,1270` hardcoded focus-ring colour `focus-visible:ring-2 focus-visible:ring-accent-indigo/50` — ds-rules: "NEVER use hardcoded focus colors" → `focus-visible:outline-none focus-visible:shadow-focus`.
- **MUST** `PreviewSurface.tsx:1136` deprecated `<Alert variant>` (Part 1 #2).
- **MUST** `PreviewSurface.tsx:847,860` hardcoded strings (Part 1 #8).
- **SHOULD** `PreviewSurface.tsx:1038` middot separator (Part 1 #6); `:392-407` hand-rolled tablist (Part 2).
- `ViewportFrame.tsx` — clean.

### `backend/forms/[id]/studio/style/*`
- **SHOULD** `BackgroundControl.tsx:70,76,109,115` non-unique DOM ids (`htmlFor="forms-studio-bg-kind"` etc.) — latent bug: two instances on the same panel (form-level + section-level) will collide. Currently only one call site exists (`FormAppearancePanel.tsx:466`), so not yet triggered, but derive via `React.useId()`.
- **SHOULD** `ColorControl.tsx:176` label is a plain `<span>` not associated with the controls below it via `aria-labelledby` — a screen-reader user hears the same generic `aria-label` ("Choose a color token") on multiple instances (e.g. "Gradient from" vs "Gradient to") instead of the field-specific label.
- **nit** `ColorControl.tsx:177,196` `gap-1.5` half-step → `gap-2`.
- `presets.ts`, `contrast.ts` — by-design theme data, no findings (see nuance note at top).

### `backend/forms/[id]/studio/validation/*`
- **MUST** `PatternEditor.tsx:112` deprecated `<Alert variant>` (Part 1 #2).
- **SHOULD** ~16 missing-`Label` instances across 10 files (Part 1 #10).
- **nit** `GroupConfigEditor.tsx:72-74` `text-xs font-semibold uppercase tracking-wide` deviates from the documented `text-overline ... tracking-widest` recipe for uppercase section labels (real Tailwind token, not arbitrary syntax, so not a hard violation).
- All other validation editors (`MessageOverridesEditor.tsx`, `NpsAnchorsEditor.tsx`,
  `NumberRangeEditor.tsx`, `LengthRangeEditor.tsx`, `OpinionIconSelect.tsx`,
  `RankingExhaustiveSwitch.tsx`, `SignatureConfigEditor.tsx`, `ValidationPanel.tsx`,
  `FileConstraintsEditor.tsx`, `MatrixColumnsEditor.tsx`, `MatrixRowsEditor.tsx`) — no hardcoded
  colours, no arbitrary spacing/radius/z-index/shadow/motion, no raw `fetch`, no raw
  button/checkbox, icons all `lucide-react` with correct `aria-hidden`/`aria-label` pairing, all
  copy through `t(...)`.

### `backend/forms/[id]/studio/YesNoRow.tsx`
- Clean token/spacing usage; see Part 2 for the non-mechanical `SegmentedControl` reuse note.

### `ui/admin/forms/[id]/distributions/CreateDistributionDialog.tsx`
- Clean. `Dialog`/`FormField`/`Kbd`/`KbdShortcut` used correctly; wires Cmd/Ctrl+Enter via
  `onKeyDown` on `DialogContent` (`:167-175`, `:193`) and relies on Radix's default Escape. Mutation
  via `useGuardedMutation` + `apiCall`.

### `ui/admin/forms/[id]/distributions/DistributionsPanel.tsx`
- **SHOULD** `:317` middot separator (Part 1 #6).
- Otherwise clean: `Page`/`PageBody`/`DataTable`/`RowActions`/`useConfirmDialog`/`StatusBadge`
  correctly used, `STATUS_VARIANT` matches the `StatusMap` pattern.

### `ui/admin/forms/[id]/distributions/EmbedSettingsDialog.tsx`
- **SHOULD** `:259`, `:298` `bg-muted/40` — `40` is not on the DS opacity scale
  (`5,10,20,30,50,70,80,90,95,100`) → `bg-muted/30` or `bg-muted/50`.
- Otherwise clean: `Dialog`, Cmd/Ctrl+Enter (`:176-184`, `:201`) + Radix Escape, `Switch`/
  `FormField`/`Select` used correctly, `useGuardedMutation` for writes.

### `ui/admin/forms/[id]/distributions/RecipientsTable.tsx`
- **MUST** `:370-475` hand-rolled `Drawer` reimplementation (Part 1 #4 / Part 2).
- **SHOULD** `:366` middot separator (Part 1 #6); `:402` hardcoded placeholder flagged by
  `yarn i18n:check-hardcoded` (Part 5).
- Good: `z-modal` used correctly (`:370`), status colours correct
  (`border-status-warning-border bg-status-warning-bg text-status-warning-text`, `:416-418`),
  `IconButton`s have `aria-label` (`:380-388`, `:435-439`).

### `ui/public/EmbeddedForm.tsx`
- **MUST** `:218` deprecated `<Alert variant>` (Part 1 #2).
- Otherwise clean; proper loading/error/unavailable states via `Alert`.

### `ui/public/FormRunner.tsx`
- **MUST** `:196,360` deprecated `<Alert variant>`; `:424` invalid `-foreground` token (Part 1 #1/#2).
- Otherwise well-structured: composes `SectionStepper`/`SaveIndicator`/`LocaleSwitch`/`ResumeGate`/
  `ReviewStep`/`CompletionScreen` correctly; theme/style compilation is isolated behind
  `styleProps(...)` (the by-design themeable seam).

### `ui/public/FormTrigger.tsx`
- Clean. Uses `Dialog`, documents Escape/Cmd+Enter delegation to Radix + the inner runner.

### `ui/public/PublicFormRunnerPage.tsx`
- Clean. Minimal chrome, delegates to `EmbeddedForm`.

### `ui/public/renderers/index.tsx`
- **MUST** `:725` `className="font-[cursive] text-lg"` on the typed-signature `Input` — arbitrary
  bracket value for `font-family`; ds-rules: "Font families come from tokens … never declare
  `font-family` inline." No DS token names a script/cursive family — needs a design-token decision;
  at minimum route through a CSS custom property, not an arbitrary Tailwind value.
- **SHOULD** `:471,566,684` `bg-muted/40` — same off-scale opacity as `EmbedSettingsDialog.tsx` → `/30` or `/50`.
- Otherwise well-behaved: `FormField`-wrapped renderers throughout, correct
  `text-status-error-text`/`-icon` usage (`:268,275,299,306,327,357,613`), `lucide-react` icons
  only, icon-only buttons have `aria-label`.

### `ui/public/components/CompletionScreen.tsx`
- **SHOULD** `:91` deprecated `<Alert variant>` (Part 1 #2).
- Good: `bg-status-success-bg text-status-success-icon` correct (`:56`).

### `ui/public/components/LocaleSwitch.tsx`
- Clean. `aria-label` on `SelectTrigger` plus `sr-only` label text (`:27-29`).

### `ui/public/components/ResumeGate.tsx`
- Clean.

### `ui/public/components/ReviewStep.tsx`
- **SHOULD** `:71` deprecated `<Alert variant>` (Part 1 #2).

### `ui/public/components/SaveIndicator.tsx`
- **MUST** `:38,43,46,50,53,55` invalid `-foreground` status tokens (Part 1 #1).

### `ui/public/components/SectionStepper.tsx`
- **MUST** `:44-49,54-69` reinvented `StepIndicator` with a raw `<button>` (Part 1 #5 / Part 2).
- **MUST** `:46` invalid `bg-status-success` token (Part 1 #1).
- **SHOULD** `:64` arbitrary `text-[10px]` (Part 1 #9).

### `ui/public/style/LogoHeader.tsx`
- Clean. No dynamic colour, no DS violations.

### `runner/FormRunner.tsx`
- **MUST** `:181,633` deprecated `<Alert variant>`; `:650,653,655` invalid `-surface` token; `:691-704,750-762` raw buttons; `:427` hardcoded `"Select…"` placeholder (Part 1 #1/#2/#5/#8).
- **SHOULD** `:132` raw `error.message` surfaced directly to an anonymous respondent — prefer a translated fallback for unexpected errors.
- **nit** `:697-698,757` `focus-visible:ring-2 focus-visible:ring-accent-indigo/50` (non-standard recipe, but the token itself is legitimate); `:761` `size-7` icon outside the documented `size-3/4/5/6` scale.

### `runner/MatrixField.tsx`
- **MUST** `:171-183` raw `<input type="radio">` instead of `Radio` (Part 2).
- Verified NOT a violation: `:103` `<table>` — this is a genuine input grid (row/column headers via
  `scope`), not a data listing; `<table>` is the semantically correct element here, unlike
  `analytics/page.tsx`'s `AnsweredVsBlankTable`. `:108,116` `sticky top-0 z-10` — local stacking
  inside the table's own scroll container, explicitly allowed by ds-rules § Z-Index. `:141` uses
  `—` (em dash) correctly, not middot. `Checkbox` primitive reused correctly for multi-select cells.

### `runner/RankingField.tsx`
- **MUST** `:192-201` raw-button drag handle (Part 1 #5 / Part 2).
- Compliant otherwise: keyboard reordering via `dnd-kit`'s `sortableKeyboardCoordinates`,
  `aria-label` on list and handle, 44px (`h-11`) touch target, `:196`'s
  `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0` is the documented
  "tight layout" fallback recipe (compliant, not the default recipe but a listed exception).

### `runner/ScaleField.tsx`
- **MUST** `:53` hardcoded focus-ring colour `focus-visible:ring-2 focus-visible:ring-accent-indigo/50` → `focus-visible:outline-none focus-visible:shadow-focus`.
- **MUST** `:45-62` raw-button row; `:82-96` raw `<input type="range">` instead of `Slider` (Part 1 #5 / Part 2).
- **nit** `:41` `gap-1.5` half-step → `gap-2`.

### `runner/SignatureField.tsx`
- **MUST** `:40` `context.strokeStyle = '#111827'` — hardcoded ink colour that does **not** track
  theme (the canvas *background* at `:121` correctly uses `bg-background`, a token that flips in
  dark mode, but the stroke colour never does) → in dark mode this draws near-black ink on a
  near-black surface, making the signature **effectively invisible**. This is a genuine dark-mode
  rendering bug, not just a style nit. Fix: resolve the ink colour from the computed `--foreground`
  CSS variable at draw time, or pin the canvas surface to always-white "paper" regardless of theme
  — either is a legitimate fix; the current state is neither.
- **MUST** `:129-136` raw `<button>` "Clear" action (Part 1 #5 / Part 2).
- Verified NOT an accessibility gap: this file only implements the `'drawn'` capture mode (the
  module's own `SignatureCaptureMode = 'drawn' | 'typed'` type at `:5` suggests a second mode), and
  in isolation a canvas has no keyboard alternative — but `ui/public/renderers/index.tsx:725`
  confirms a typed-signature `<Input>` fallback *does* exist at the field-renderer level (see the
  `font-[cursive]` finding above), so a keyboard-only respondent is not actually blocked from
  signing. No separate a11y finding needed here beyond the button/colour issues above.

### `frontend/embed/[slug]/page.tsx`
- Verified NOT a violation: `:84` `root.classList.toggle('dark', dark)` is the mechanism for the
  distribution's own `embed.theme` (`light`/`dark`/`auto`) setting — form-owner-controlled theming,
  exactly the nuance this review excludes, not a component `dark:` override.

### `frontend/forms/[id]/run/page.tsx`
- **MUST** `:34,37` hardcoded `'Failed to load form.'` (Part 1 #8).
- **SHOULD** `:47` deprecated `<Alert variant>` (Part 1 #2).
- No portal `page.meta.ts` needed — this path is not under `frontend/[orgSlug]/portal/...`, so the
  portal-guard requirement doesn't apply; correctly omitted.

### `frontend/f/[slug]/page.tsx`, `frontend/i/[token]/page.tsx`
- Clean. Thin wrappers delegating to `PublicFormRunnerPage`.

### `frontend/[orgSlug]/portal/forms/[key]/page.tsx`
- Clean. Sibling `page.meta.ts` present (portal-guard requirement satisfied). Delegates to
  `EmbeddedForm`, uses `PortalShell`/`useCustomerAuth` correctly.

### `frontend/[orgSlug]/portal/submissions/[id]/continue/page.tsx`
- **MUST** `:40` hardcoded `'Loading…'` (Part 1 #8).
- Sibling `page.meta.ts` present (portal-guard requirement satisfied).

### `widgets/injection/access-audit-panel/widget.tsx`
- **SHOULD** `:103-125` reinvented `ActivityFeed` (Part 2).
- Otherwise compliant: read-only correctly skips `useGuardedMutation`, uses `apiCall`, `Tag` with a
  proper `PURPOSE_VARIANT` map (no hardcoded colours), i18n via `t()` throughout.

### `widgets/injection/anonymize-button/widget.tsx`
- **MUST** `:115` invalid `text-status-error-foreground` on a destructive-action icon → `text-destructive` (Part 1 #1).
- Otherwise a **model implementation**: real `Dialog` (not `window.confirm`) for the typed-`DELETE`
  confirmation, manual Cmd/Ctrl+Enter + Escape (`:91-102`, justified since `useConfirmDialog` can't
  express a text-match gate), write wrapped in `useGuardedMutation(...).runMutation(...)`, `flash()`
  for the result. Use this file as the reference pattern when fixing the drawer/mutation-guard
  findings above.

### `widgets/injection/embedded-form/widget.tsx`
- Clean. Pure prop-narrowing pass-through to `EmbeddedForm`, defensive runtime validation, no
  rendering of its own.

### `widgets/injection/pdf-download-button/widget.tsx`
- Clean. `apiCall` used for the read-only download and correctly reads `resp.response.blob()`/
  headers for the binary/filename case (this is **not** a raw-fetch violation — it proves `apiCall`
  supports blob responses via its `response: Response` field, see the cross-module note below).
  `SimpleTooltip` used correctly for the disabled-state explanation.

### `widgets/injection/self-audit-footer/widget.tsx`
- Clean. Static, i18n-compliant, correctly scoped by `context?.submissionId`.

---

## Part 3b — Cross-module note: `ui/public/state/runtime-client.ts` raw `fetch`

Not a `.tsx` file, but it's the shared HTTP layer every `ui/public/**` page in scope calls into, so
it was read for completeness. `triggerPdfDownload(url, headers?)` at `:84-101` uses raw `fetch(url,
{ headers, credentials: 'include' })`, shared by **both** the authenticated portal client and the
anonymous token client (`:124` onward comment: "Authenticated client (default) — verbatim port of
the inline `apiCall` logic").

- For the **anonymous/token** path, raw `fetch` is plausibly justified: `apiCall`'s signature
  (`packages/ui/src/backend/utils/apiCall.ts:63-67`) takes a `RequestInit`, so a custom bearer
  `Authorization` header could technically be passed through `init.headers` — but `apiCall` also
  layers in `scopedRequestHeaders` assuming an authenticated app-session context, which may not be
  appropriate for a fully anonymous caller. Not flagging this half as a hard violation.
- For the **authenticated** path specifically, this is **SHOULD fix**: confirmed via
  `widgets/injection/pdf-download-button/widget.tsx` (a working, in-repo precedent) that `apiCall`'s
  return value exposes the raw `response: Response` object, so `resp.response.blob()` works fine
  through `apiCall`. The authenticated client should route through `apiCall` like every other call
  in the same file (`:140` onward) instead of bypassing it with manual `fetch`+`credentials:
  'include'`, for consistency with the app's session/CSRF conventions.

---

## Part 4 — Lint coverage and verbatim output

**Root `yarn lint` does NOT cover `packages/core/src/**`.** `packages/core/package.json` has no
`lint` script at all (only `build`, `watch`, `test`, `typecheck`) — `turbo run lint` silently skips
any workspace without one, so a green `yarn lint` says nothing about this module. The command that
*does* cover it is `yarn lint:ds` (`eslint --config eslint.ds.config.mjs packages apps`), which
carries the `@open-mercato/eslint-plugin-ds` structural rules and is scoped by file globs inside
`eslint.ds.config.mjs`:
- The six structural rules (`no-raw-table`, `require-page-wrapper`, `require-loading-state`,
  `require-empty-state`, `require-status-badge`, `no-hardcoded-status-colors`) only run under
  `packages/core/src/modules/**/backend/**/*.{ts,tsx}`.
- `no-legacy-alert-variant` runs more broadly, under `packages/*/src/**/*.tsx`.

Run exactly as CI would invoke it (`export TMPDIR=/tmp` first), scoped to the `forms` module (the
`[id]` bracket directories break ESLint's own glob resolution from the shell, so files were
enumerated with `find` and passed explicitly — this reproduces the same file set the repo-wide
`packages apps` invocation would visit):

### `yarn lint:ds` — backend/** structural rules (67 files)

```
$ node --require ./scripts/typescript-js-require-hook.cjs node_modules/eslint/bin/eslint.js \
    --config eslint.ds.config.mjs $(find packages/core/src/modules/forms/backend -type f \( -name "*.ts" -o -name "*.tsx" \) ! -path "*__tests__*")

/…/packages/core/src/modules/forms/backend/forms/[id]/FormStudio.tsx
  3179:16  warning  The Alert `variant` prop is deprecated. Use `status` (+ optional `style`/`size`) instead — see .ai/skills/om-ds-guardian/references/token-mapping.md § "Legacy Alert `variant` → `status`"  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/backend/forms/[id]/analytics/page.tsx
  250:7   warning  Do not use raw <table> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table  om-ds/no-raw-table
  251:9   warning  Do not use raw <thead> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table  om-ds/no-raw-table
  252:11  warning  Do not use raw <tr> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table
  253:13  warning  Do not use raw <th> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table
  254:13  warning  Do not use raw <th> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table
  255:13  warning  Do not use raw <th> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table
  256:13  warning  Do not use raw <th> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table
  259:9   warning  Do not use raw <tbody> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table  om-ds/no-raw-table
  261:13  warning  Do not use raw <tr> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table
  262:15  warning  Do not use raw <td> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table
  270:15  warning  Do not use raw <td> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table
  271:15  warning  Do not use raw <td> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table
  272:15  warning  Do not use raw <td> in backend pages. Use DataTable from @open-mercato/ui/backend/DataTable or the Table primitives from @open-mercato/ui/primitives/table     om-ds/no-raw-table

/…/packages/core/src/modules/forms/backend/forms/[id]/distributions/page.tsx
  1:1  warning  Backend pages must wrap content in <Page><PageBody>…</PageBody></Page>. Import from @open-mercato/ui/backend/Page  om-ds/require-page-wrapper

/…/packages/core/src/modules/forms/backend/forms/[id]/page.tsx
  1:1  warning  Backend pages must wrap content in <Page><PageBody>…</PageBody></Page>. Import from @open-mercato/ui/backend/Page  om-ds/require-page-wrapper

/…/packages/core/src/modules/forms/backend/forms/[id]/studio/logic/HiddenFieldsPanel.tsx
  103:18  warning  The Alert `variant` prop is deprecated. Use `status` (+ optional `style`/`size`) instead — see .ai/skills/om-ds-guardian/references/token-mapping.md § "Legacy Alert `variant` → `status`"  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/backend/forms/[id]/studio/logic/VariablesPanel.tsx
  251:25  warning  The Alert `variant` prop is deprecated. Use `status` (+ optional `style`/`size`) instead — see .ai/skills/om-ds-guardian/references/token-mapping.md § "Legacy Alert `variant` → `status`"  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/backend/forms/[id]/studio/palette/FormAppearancePanel.tsx
  214:32  warning  Pages using apiCall() must handle loading state. Use LoadingMessage from @open-mercato/ui/backend/detail, a Spinner/DataLoader, or pass isLoading to DataTable  om-ds/require-loading-state

/…/packages/core/src/modules/forms/backend/forms/[id]/studio/preview/PreviewSurface.tsx
  1136:16  warning  The Alert `variant` prop is deprecated. Use `status` (+ optional `style`/`size`) instead — see .ai/skills/om-ds-guardian/references/token-mapping.md § "Legacy Alert `variant` → `status`"  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/backend/forms/[id]/studio/validation/PatternEditor.tsx
  112:20  warning  The Alert `variant` prop is deprecated. Use `status` (+ optional `style`/`size`) instead — see .ai/skills/om-ds-guardian/references/token-mapping.md § "Legacy Alert `variant` → `status`"  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/backend/forms/[id]/submissions/components/SubmissionDrawer.tsx
  210:16  warning  The Alert `variant` prop is deprecated. Use `status` (+ optional `style`/`size`) instead — see .ai/skills/om-ds-guardian/references/token-mapping.md § "Legacy Alert `variant` → `status`"  om-ds/no-legacy-alert-variant
  283:20  warning  The Alert `variant` prop is deprecated. Use `status` (+ optional `style`/`size`) instead — see .ai/skills/om-ds-guardian/references/token-mapping.md § "Legacy Alert `variant` → `status`"  om-ds/no-legacy-alert-variant

✖ 23 problems (0 errors, 23 warnings)
```

One structural finding not already listed above: **`om-ds/require-loading-state`** on
`FormAppearancePanel.tsx:214` — the `apiCall()` at that line has no visible loading indicator wired
around it. **SHOULD fix** — wrap with `LoadingMessage`/`Spinner` or a local `isLoading` flag.

### `yarn lint:ds` — `no-legacy-alert-variant` sweep on the rest of the module (32 non-backend `.tsx` files)

```
$ node --require ./scripts/typescript-js-require-hook.cjs node_modules/eslint/bin/eslint.js \
    --config eslint.ds.config.mjs $(find packages/core/src/modules/forms -type f -name "*.tsx" ! -path "*__tests__*" ! -path "*/backend/*")

/…/packages/core/src/modules/forms/frontend/forms/[id]/run/page.tsx
  47:16  warning  The Alert `variant` prop is deprecated. ...  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/runner/FormRunner.tsx
  181:29  warning  The Alert `variant` prop is deprecated. ...  om-ds/no-legacy-alert-variant
  633:16  warning  The Alert `variant` prop is deprecated. ...  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/ui/public/EmbeddedForm.tsx
  218:14  warning  The Alert `variant` prop is deprecated. ...  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/ui/public/FormRunner.tsx
  196:14  warning  The Alert `variant` prop is deprecated. ...  om-ds/no-legacy-alert-variant
  360:16  warning  The Alert `variant` prop is deprecated. ...  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/ui/public/components/CompletionScreen.tsx
  91:16  warning  The Alert `variant` prop is deprecated. ...  om-ds/no-legacy-alert-variant

/…/packages/core/src/modules/forms/ui/public/components/ReviewStep.tsx
  71:14  warning  The Alert `variant` prop is deprecated. ...  om-ds/no-legacy-alert-variant

✖ 8 problems (0 errors, 8 warnings)
```

(31 total `Alert`-variant warnings across both runs, matching Part 1 item 2's manually-counted 16
*sites* — the eslint rule fires once per `<Alert variant>` JSX attribute occurrence, which lines up
one-to-one with the manual count.)

---

## Part 5 — `yarn i18n:check-hardcoded` (verbatim, scoped to `forms`)

```
$ export TMPDIR=/tmp && yarn i18n:check-hardcoded --path "packages/core/src/modules/forms/**" --limit 100

[check] Hardcoded i18n strings — scanned 235 files in 66ms
Patterns: JSX text, JSX attributes (label/title/placeholder/aria-label/...), throw/createCrudFormError/raiseCrudError/toast.* calls

[core/forms] 14 hardcoded strings
  packages/core/src/modules/forms/api/form-submissions/[id]/resume-token/route.ts:34 [throw-error] "FORMS_RESUME_TOKEN_SECRET (or JWT_SECRET fallback) must be set."
  packages/core/src/modules/forms/backend/forms/[id]/studio/logic/VariablesPanel.tsx:238 [jsx-attr] (@placeholder) "{\"+\": [{\"var\": \"a\"}, {\"var\": \"b\"}]}"
  packages/core/src/modules/forms/backend/forms/[id]/studio/preview/PreviewSurface.tsx:382 [jsx-attr] (@aria-label) "Author preview"
  packages/core/src/modules/forms/backend/forms/[id]/submissions/components/SubmissionDrawer.tsx:112 [throw-error] "Failed to load submission (status ${detailResp.status})."
  packages/core/src/modules/forms/backend/forms/[id]/submissions/components/SubmissionDrawer.tsx:115 [throw-error] "Failed to load revisions (status ${revisionsResp.status})."
  packages/core/src/modules/forms/backend/forms/[id]/submissions/components/SubmissionDrawer.tsx:362 [jsx-attr] (@aria-label) "Close drawer"
  packages/core/src/modules/forms/backend/forms/[id]/submissions/page.tsx:184 [jsx-attr] (@aria-label) "Multiple roles"
  packages/core/src/modules/forms/backend/forms/[id]/submissions/page.tsx:191 [jsx-attr] (@aria-label) "PDF available"
  packages/core/src/modules/forms/services/distribution-token.ts:55 [throw-error] "FORMS_DISTRIBUTION_TOKEN_SECRET (or JWT_SECRET fallback) must be set."
  packages/core/src/modules/forms/ui/admin/forms/[id]/distributions/RecipientsTable.tsx:402 [jsx-attr] (@placeholder) "jane@example.com,Jane Doe\njohn@example.com"
  packages/core/src/modules/forms/ui/public/state/useFormRunner.ts:329 [throw-error] "Failed to save (status ${response.status})."
  packages/core/src/modules/forms/ui/public/state/useFormRunner.ts:455 [throw-error] "Failed to submit (status ${response.status})."
  packages/core/src/modules/forms/workers/pdf-snapshot.ts:59 [throw-error] "forms-pdf-snapshot requires submissionId, organizationId and tenantId"
  packages/core/src/modules/forms/workers/retention-purge.ts:60 [throw-error] "forms-retention-purge requires scope.organizationId and scope.tenantId"

Summary: 14 hardcoded • 0 allowlisted • across 1 modules
Phase 1 of the i18n remediation plan is advisory — exit code stays 0.
Allowlist format: <module>/i18n/.hardcoded-allowlist.json — see .ai/specs/2026-05-26-missing-translations-audit-and-remediation.md.
```

Of these 14, 7 are `[jsx-attr]`/user-visible (`aria-label`/`placeholder` — low severity, easy `t()`
wraps) and 7 are `[throw-error]` — of those, the two `*_SECRET must be set` config-error messages
and the four worker-guard messages are genuinely internal (never shown to an end user) and should be
prefixed `[internal]` per root `AGENTS.md` § UI & HTTP rather than translated. The `SubmissionDrawer`
and `useFormRunner.ts` `[throw-error]` entries *are* rendered to users (see Part 3's `SubmissionDrawer.tsx`
and Part 3b entries) and should be translated for real, not just marked internal.

---

## Part 6 — Dialog keyboard contract (Cmd/Ctrl+Enter submit, Escape cancel)

Every real `Dialog`-primitive-based dialog in the module was checked:

| Dialog | Cmd/Ctrl+Enter | Escape | Verdict |
|---|---|---|---|
| `ui/admin/forms/[id]/distributions/CreateDistributionDialog.tsx` | ✅ manual `onKeyDown` on `DialogContent` | ✅ Radix default | Compliant |
| `ui/admin/forms/[id]/distributions/EmbedSettingsDialog.tsx` | ✅ manual `handleKeyDown` | ✅ Radix default | Compliant |
| `widgets/injection/anonymize-button/widget.tsx` (typed-`DELETE` confirm) | ✅ manual `onKeyDown` | ✅ manual, justified (can't use `useConfirmDialog`, needs text-match gate) | Compliant |
| `backend/forms/[id]/FormStudio.tsx` `PublishDialog` | ✅ `:3169-3174` | ✅ Radix default | Compliant |
| `ui/public/FormTrigger.tsx` | ✅ delegates to Radix + inner runner (documented in its own JSDoc) | ✅ | Compliant |

No dialog in the module fails the contract. The two findings that look "drawer-shaped" —
`SubmissionDrawer.tsx`'s `DrawerShell` and `RecipientsTable.tsx`'s side panel — are **not**
`Dialog`s (they're hand-rolled side panels that should be `Drawer`s, Part 1 #4); both already
implement a manual Escape handler correctly, so there is no keyboard-contract *regression* there,
just a component-reuse and ARIA-plumbing gap.

---

## Part 7 — Accessibility summary

- **Drag-and-drop canvas keyboard operability — verified compliant.** `FormStudio.tsx:891-893`
  configures `useSensor(KeyboardSensor, { coordinateGetter: gridKeyboardCoordinates })` alongside
  `PointerSensor` for the main canvas `DndContext` (`:1615`); `runner/RankingField.tsx:106-109`
  does the same via `sortableKeyboardCoordinates`. Both drag surfaces are keyboard-reorderable.
- **Drag-handle buttons** — see Part 1 #5; several are raw `<button>`s rather than `IconButton`,
  but all carry correct `aria-label`s already.
- **Labels tied to controls** — the systemic gap is Part 1 #10 (missing `Label` primitive across
  ~10 validation editors) plus the one canvas title input noted under `SectionContainer.tsx` in
  Part 3.
- **Custom matrix/ranking/scale/signature fields:**
  - `MatrixField.tsx` — correct `scope="col"`/`scope="row"`, per-cell `aria-label` combining row +
    column label with an em dash. Compliant.
  - `RankingField.tsx` — `aria-label` on the list and the drag handle, 44px touch target,
    dnd-kit keyboard support. Compliant.
  - `ScaleField.tsx` — `role="group"` + `aria-label` on the button row; `aria-valuenow/min/max` on
    the slider fallback. Compliant (modulo the raw-button/raw-range reuse findings).
  - `SignatureField.tsx` — canvas has `role="img" aria-label`; no keyboard alternative *in this
    file*, but a typed-signature fallback exists at the renderer layer (`ui/public/renderers/
    index.tsx:725`) — verified not a gap overall, see Part 3.
- **Focus management in dialogs** — all real dialogs delegate to Radix's built-in focus trap; no
  custom focus-management code was found or needed.
- **Section stepper focus management** — `SectionStepper.tsx` doesn't manage focus explicitly
  beyond native button focus; once it's rebuilt on `StepIndicator` (Part 2) this is inherited from
  the primitive.

---

## Part 8 — Verified NOT a problem (do not re-check)

- **Dynamic/theme-derived inline colours** in `studio/style/ColorControl.tsx`,
  `studio/style/BackgroundControl.tsx`, `studio/style/presets.ts`, `studio/style/contrast.ts`,
  `ui/public/style/applyStyle.ts`, and every consumer of their output (`FormRunner.tsx`'s
  `styleProps(...)` calls, `frontend/embed/[slug]/page.tsx:84-97`'s `.dark` toggle driven by
  `settings.embed.theme`) — by design, per the task brief.
- **`runner/MatrixField.tsx:103` raw `<table>`** — a genuine accessible input grid (row/column
  `scope` headers), not a data listing; `<table>` is the correct element here, unlike
  `analytics/page.tsx`'s `AnsweredVsBlankTable` (which *is* a data listing and *is* flagged).
- **`runner/MatrixField.tsx:108,116` `sticky top-0 z-10`** — local stacking inside the table's own
  scroll container; ds-rules § Z-Index explicitly permits numeric `z-*` for this case.
- **`runner/RankingField.tsx:196` legacy focus-ring recipe** — this is the documented "tight
  layout" exception (`focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0`
  family), not a violation.
- **Anonymous-page HTTP client choice** — every anonymous/unauthenticated page in scope
  (`frontend/embed/[slug]`, `frontend/f/[slug]`, `frontend/i/[token]`, `EmbeddedForm`'s anonymous
  bootstrap) correctly uses `apiCall`/`apiCallOrThrow`, never raw `fetch`. Cross-checked against
  existing prior art for anonymous pages elsewhere in this repo (`auth/frontend/login.tsx`,
  `auth/frontend/reset/[token]/page.tsx`), which also use `apiCall` — `apiCall` is the established
  convention for unauthenticated public pages here.
- **`widgets/injection/pdf-download-button/widget.tsx`'s blob download via `apiCall`** — not a
  raw-fetch violation; it proves `apiCall`'s `response: Response` field supports arbitrary
  `.blob()`/header reads (used as supporting evidence in Part 3b).
- **i18n key coverage** — every `t('forms.*', ...)` call site audited resolves to a real key in
  `packages/core/src/modules/forms/i18n/{en,pl,es,ko,de}.json`; the module ships full locale
  coverage for the keys it declares, so the findings above are about *missing* `t()` wraps, not
  about a module with broken translation files.
- **`ColorControl.tsx`'s `TOKEN_NATIVE_HEX`/`contrast.ts`'s `TOKEN_LIGHT_HEX`** hardcoded hex maps
  — documented "display only — never persisted," exist only because the native
  `<input type="color">` and WCAG contrast math both require a concrete hex value. Not a
  hardcoded-colour violation; it's data, not chrome.

---

## Part 9 — Verification note

`git diff --stat` against the fork point (`cez/c82a4a14`) shows exactly one file changed by this
review: `.ai/analysis/forms-ds-review.md`. No source file under `packages/core/src/modules/forms/`
was modified.
