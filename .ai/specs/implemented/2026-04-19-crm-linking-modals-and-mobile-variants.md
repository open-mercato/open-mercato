# CRM Linking Modals, Mobile Person v2 & Tag Settings Refinements

**Created:** 2026-04-19
**Module:** `customers`, `ui`
**Status:** Draft — ready for implementation
**Author:** UX (Oliwia Zielińska) → Maciej (dev)
**Related:** SPEC-072 (`2026-04-06-crm-detail-pages-ux-enhancements.md`), SPEC-046 (Customer Detail v2), SPEC-046b (Interactions Unification)

---

## TLDR

Follow-up UX iteration on top of SPEC-072. The UX designer shipped a Figma changelog (CR5-equivalent) with:

1. **Shared `LinkEntityDialog` primitive** (960px, list + preview, monochrome avatars) — replaces ad-hoc linking dialogs in [PersonCompaniesSection.tsx](packages/core/src/modules/customers/components/detail/PersonCompaniesSection.tsx), [CompanyPeopleSection.tsx](packages/core/src/modules/customers/components/detail/CompanyPeopleSection.tsx), [DealLinkedEntitiesTab.tsx](packages/core/src/modules/customers/components/detail/DealLinkedEntitiesTab.tsx).
2. **"Add new" CTA** inside both linking modals — nested mini-create that reuses existing `CreatePersonDialog` / `DealDialog` without losing linking context.
3. **Link Deal orphan warning** — inline alert when the deal being linked has no other active anchors.
4. **Remove "+ Link company" header CTA** from Person v2 — deletion at [PersonDetailHeader.tsx:196-207](packages/core/src/modules/customers/components/detail/PersonDetailHeader.tsx:196); linking moves exclusively to the Zone 2 Companies tab.
5. **Mobile Person v2** — new `<MobilePersonDetail>` below the Tailwind `md` breakpoint (<768px) with a `[Details | Activity]` zone switcher; desktop layout (SPEC-072 `CollapsibleZoneLayout`) untouched above `md`.
6. **Manage Tags "arrows variant"** — up/down chevron buttons added to [ManageTagsDialog.tsx](packages/core/src/modules/customers/components/detail/ManageTagsDialog.tsx) `SortableEntryRow`, alongside (not replacing) the existing `@dnd-kit` drag handle.
7. **English copy pass** — only on screens touched by this iteration; additive i18n keys.

**Scope:**

- Modified: `PersonDetailHeader`, `PersonCompaniesSection`, `CompanyPeopleSection`, `DealLinkedEntitiesTab`, `ManageTagsDialog`, `people-v2/[id]/page.tsx`, and shared `@open-mercato/ui` primitives (dialog width, new Avatar).
- New: `packages/core/src/modules/customers/components/linking/LinkEntityDialog.tsx`, `packages/core/src/modules/customers/components/detail/MobilePersonDetail.tsx`, `packages/ui/src/primitives/avatar.tsx`.
- No schema changes, no new API routes, no new commands, no new events, no new ACL features.

**Concerns:**

- "Add new" nested dialog must preserve focus/Escape/Cmd+Enter semantics of the outer modal — verified against the existing `CreatePersonDialog` inside `CompanyPeopleSection` as precedent.
- `CollapsibleZoneLayout`'s internal 1280px/1024px breakpoint must not fight Tailwind's `md` (768px) mobile switcher — keep the two layouts mutually exclusive via `md:hidden` / `hidden md:flex` toggles.
- Monochrome avatar change must be opt-in (`variant="monochrome"`) to avoid regressing the rest of the app which uses colored entity avatars.

---

## Scope Classification

This spec is **UX-only**. No contract surfaces are modified:

- **No** DB schema changes.
- **No** new or renamed API routes / events / ACL features / commands.
- **No** changes to `makeCrudRoute`, `CrudForm`, or `CollapsibleZoneLayout` internals.
- Only **additive** i18n keys (English + Polish + de + es fallbacks).
- One **additive** primitive in `@open-mercato/ui` (`Avatar`).
- One **additive** custom dialog width class / inline `max-w-[960px]`.

The UX designer confirmed: 2300 Figma nodes translated to English is the **design-side** figure. The code-side copy pass is bounded to the screens touched by this iteration (Q6 = default).

---

## Out of Scope

- Redesign of `companies-v2` or `documents-v2` detail pages (Figma changelog does not list them beyond the shared linking modals).
- Mobile variants for `companies-v2` or `documents-v2` — this spec covers **Person v2 only** for mobile. Follow-up work will mirror the pattern if the UX designer ships variants for them.
- Changes to `CollapsibleZoneLayout` itself — mobile is a separate component picked by a parent-level `md:hidden` / `hidden md:flex` switch.
- Full module-wide i18n audit. Only screens touched by this iteration get a copy pass.
- New API endpoints for "find deal to link to person/company". The reverse Link Deal direction (Q8 = default) reuses the existing deals list endpoint with appropriate filter params (see §Enhancement 1).
- Replacing `@dnd-kit` drag handle. Arrows are **additive** — keyboard users keep both options.
- Rollout behind a feature flag (Q10 = default, in-place replacement).

---

## Overview

SPEC-072 implemented the two-zone CRM detail layout, collapsible groups, inline activity composer, roles, deal stage progress bar, and activity filtering. User testing after that rollout surfaced five friction points that this iteration addresses:

1. **Duplicated linking dialogs** — three near-identical dialogs ([PersonCompaniesSection.tsx](packages/core/src/modules/customers/components/detail/PersonCompaniesSection.tsx) @840 lines, [CompanyPeopleSection.tsx](packages/core/src/modules/customers/components/detail/CompanyPeopleSection.tsx) @1027 lines, [DealLinkedEntitiesTab.tsx](packages/core/src/modules/customers/components/detail/DealLinkedEntitiesTab.tsx) @646 lines) with different pagination patterns (paginated vs. load-more), different selected-preview layouts, and no "add new" escape hatch. Users who can't find a target entity have to close the dialog → navigate → create → navigate back → re-open → re-select.
2. **"Link Deal" direction was unavailable** — today deals link to person/company via `DealForm`. The reverse — from a person's or company's detail page, attach an existing deal — was not exposed.
3. **No orphan-warning** when linking a deal whose only anchor is the one being edited. Users can accidentally create a deal with no discoverable home.
4. **"+ Link company" CTA on Person v2 header** duplicated the Zone 2 Companies tab's manage action, fragmenting the mental model.
5. **Mobile layout relied on browser stacking** with no consolidated way to flip between "form mode" and "activity mode" on a phone.
6. **Tag reordering** only worked through mouse drag — keyboard / low-motor users could technically use `@dnd-kit`'s KeyboardSensor but the affordance was unlabeled.
7. Residual Polish strings mixed with English-fallback `t(key, 'English')` calls on the affected screens.

---

## Proposed Solution

### Enhancement 1 — Shared `LinkEntityDialog` primitive (960px, list + preview, monochrome avatars)

#### Architecture

A single React primitive replaces the bespoke link dialogs in `PersonCompaniesSection`, `CompanyPeopleSection`, and `DealLinkedEntitiesTab`. Three entity kinds are supported through a thin adapter pattern — not three components.

```
┌────────────────────────────────────────────────────────── 960px ──┐
│ [<]  Link company to Jan Kowalski                             [X] │
│                                                                    │
│  ┌─ Search (left pane, 58%) ──┐  ┌─ Selected / Preview (right, 42%) ─┐
│  │ 🔍 [search…          ]     │  │ Selected: 2 companies              │
│  │                             │  │                                    │
│  │ □ Acme Corp       ★         │  │ ★ Acme Corp (primary)              │
│  │   acme.com                  │  │     acme.com                       │
│  │ ☑ Globex Co                 │  │   Globex Co                        │
│  │   globex.com                │  │     globex.com                     │
│  │ □ Initech                   │  │                                    │
│  │                             │  │   [ + Add new company ]            │
│  │ [← Previous] [1/3] [Next →] │  │                                    │
│  └─────────────────────────────┘  └────────────────────────────────────┘
│                                                                    │
│  [Cancel]                                              [Save links] │
└────────────────────────────────────────────────────────────────────┘
```

Width is exactly 960px via `sm:max-w-[960px]` (Tailwind arbitrary value — no tailwind.config change needed since the codebase already uses e.g. `sm:max-w-4xl`).

#### Adapter contract

```tsx
type LinkEntityKind = 'company' | 'person' | 'deal'

type LinkEntityOption = {
  id: string
  label: string
  subtitle?: string | null
  // avatarSeed decides the monochrome initials; not a color code
  avatarSeed?: string | null
}

type LinkEntityAdapter = {
  kind: LinkEntityKind
  // search the remote list (server pagination)
  searchPage: (query: string, page: number) => Promise<{
    items: LinkEntityOption[]
    totalPages: number
    total: number
  }>
  // batch fetch by ids (used to hydrate selected cache)
  fetchByIds: (ids: string[]) => Promise<LinkEntityOption[]>
  // persistence is owned by the caller — dialog only returns the diff
  emptyHint: string
  searchPlaceholder: string
  dialogTitle: string
  // for 'deal' adapter only — emits orphan warning payload
  computeOrphanWarning?: (option: LinkEntityOption) => Promise<string | null>
  // CTA for nested create; if null, hidden
  addNew?: {
    label: string
    render: (ctx: { onCreated: (created: LinkEntityOption) => void; onCancel: () => void }) => React.ReactNode
  }
}

type LinkEntityDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  adapter: LinkEntityAdapter
  initialSelectedIds: string[]
  initialPrimaryId?: string | null              // only for company adapter
  onConfirm: (next: {
    addedIds: string[]
    removedIds: string[]
    primaryId?: string | null
  }) => Promise<void>
  runGuardedMutation?: GuardedMutationRunner
  avatarVariant?: 'default' | 'monochrome'       // defaults to 'monochrome' inside this dialog
}
```

- Dialog owns: search state, pagination, selection diff, orphan-warning banner, nested-create stack, a11y wiring.
- Caller owns: persistence (existing `/api/customers/{entity}/{id}/{target}` endpoints), refresh on `onConfirm` success, flash toast, initial selection state.
- No new API routes — callers still POST/DELETE/PATCH via existing commands:
  - `customers.personCompanyLinks.{create,update,delete}`
  - `customers.dealCompanyLinks.*` (existing)
  - `customers.dealPeopleLinks.*` (existing)

#### Monochrome avatars

No `Avatar` primitive currently exists in `@open-mercato/ui` — detail headers today render inline `<div>` blocks with initials. We introduce it now to consolidate this pattern and ship the monochrome variant in one place:

```tsx
// packages/ui/src/primitives/avatar.tsx
export type AvatarProps = {
  label: string                          // drives initials fallback
  src?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'       // 20 | 28 | 36 | 48 px
  variant?: 'default' | 'monochrome'     // default = existing colored chip
  icon?: React.ReactNode                 // override for non-person entities (e.g. Building2)
  ariaLabel?: string
}
```

- `variant="monochrome"`: `bg-muted text-muted-foreground` — no color hash. Respects `prefers-reduced-motion` (no hover pulse). Dark-mode-safe via existing `muted` token.
- Only the linking modals pass `variant="monochrome"`. The rest of the product continues to render colored avatars.
- Avatar is the only new primitive; it replaces 4 inline initials blocks in linking-related components.

#### "Add new" nested CTA

Triggered from the right (selected) pane as a dashed-outline button at the bottom. On click:

1. Outer `LinkEntityDialog` becomes `inert` (ARIA attribute) — outer focus trap releases, outer `Escape` suspended.
2. Inner `CreatePersonDialog` / `DealDialog` mounts with `mode="create"`, pre-populated with any parent entity context (e.g., the person whose detail page opened the outer modal becomes the pre-selected company scope for the nested person create).
3. On success, inner dialog closes, outer dialog reactivates, newly created entity is auto-selected in the diff, and the list scrolls to show it.
4. On cancel/ESC, inner dialog closes, outer reactivates, no selection change.

The nested pattern is already proven inside `CompanyPeopleSection` (existing precedent at line 844) — we formalize it as part of the adapter.

#### Orphan warning (Link Deal only)

Shown when the user selects a deal whose existing active anchor count is ≤ 1. Uses the existing deals list endpoint with an enrichment hint:

```
GET /api/customers/deals?ids=uuid1,uuid2&include=anchors
→ response.items[].anchors = { companies: number; people: number }
```

If `anchors.companies + anchors.people ≤ 1`, the adapter returns a warning rendered via the existing `<Alert variant="warning">` primitive at [alert.tsx](packages/ui/src/primitives/alert.tsx) — per Design System rules "USE `Alert` for inline messages — NOT `Notice`" from root AGENTS.md:

> *This deal has no other linked entities. If you unlink it later, it will become unreachable.*

The alert appears above the selected-list with a dismiss `X`. Selection proceeds either way (non-blocking — `role="status"`, not `role="alert"` — this is guidance, not a validation error).

**Backend touch:** existing `/api/customers/deals` endpoint already returns the related counts via SPEC-072 Phase 5 enrichment. If the `anchors` sub-field isn't present yet, we use the existing enricher pattern to add it — additive only, no schema changes.

#### Files

| File | Action |
| ---- | ------ |
| `packages/ui/src/primitives/avatar.tsx` | New — monochrome + default variants |
| `packages/core/src/modules/customers/components/linking/LinkEntityDialog.tsx` | New — the shared primitive |
| `packages/core/src/modules/customers/components/linking/adapters/companyAdapter.ts` | New — wraps existing `/api/customers/companies` |
| `packages/core/src/modules/customers/components/linking/adapters/personAdapter.ts` | New — wraps existing `/api/customers/people` |
| `packages/core/src/modules/customers/components/linking/adapters/dealAdapter.ts` | New — wraps existing `/api/customers/deals`, computes orphan warning |
| `packages/core/src/modules/customers/components/detail/PersonCompaniesSection.tsx` | Modified — replace internal dialog with `<LinkEntityDialog adapter={companyAdapter}>` |
| `packages/core/src/modules/customers/components/detail/CompanyPeopleSection.tsx` | Modified — same replacement with `personAdapter` |
| `packages/core/src/modules/customers/components/detail/DealLinkedEntitiesTab.tsx` | Modified — same replacement, both people and companies adapters |
| `packages/core/src/modules/customers/i18n/{en,pl,de,es}.json` | Modified — add ~20 shared keys under `customers.linking.*` |

Estimated line deletion from consolidating the three dialog implementations: ~800 LOC net reduction.

---

### Enhancement 2 — Remove "+ Link company" from Person v2 header

#### Scope

Delete the dashed-outline "+ Link company" button at [PersonDetailHeader.tsx:196-207](packages/core/src/modules/customers/components/detail/PersonDetailHeader.tsx:196):

```tsx
{onOpenCompaniesTab ? (
  <Button ...>
    <Plus className="size-[11px]" />
    {t('customers.people.detail.header.linkCompany', 'Link company')}
  </Button>
) : null}
```

Linking remains reachable through the Zone 2 Companies tab (`PersonCompaniesSection`). The header retains: Save, Delete, Manage tags.

#### Rationale

The UX designer's "4 variants" = data-driven runtime states (0 / 1 / many companies, ±primary). All four states were showing the header CTA, competing with the tab's own manage affordance. Consolidating to one entry point reduces mental model fragmentation.

#### Backward compatibility

`onOpenCompaniesTab` prop on `PersonDetailHeader` is no longer referenced internally — but the prop is kept on the type definition as `@deprecated` for one minor version (per root `BACKWARD_COMPATIBILITY.md` protocol) in case third-party widgets inject via it. Callers that pass it see no runtime error; the prop becomes a no-op and is scheduled for removal after one release cycle.

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/components/detail/PersonDetailHeader.tsx` | Modified — remove JSX block lines 196-207; mark `onOpenCompaniesTab` prop `@deprecated` |
| `packages/core/src/modules/customers/backend/customers/people-v2/[id]/__tests__/page.test.tsx` | Modified — remove assertions referencing the CTA, add negative assertion (button absent) |
| `packages/core/src/modules/customers/i18n/{en,pl,de,es}.json` | Optional — leave `customers.people.detail.header.linkCompany` key in place (unused; purged in a future cleanup) |

---

### Enhancement 3 — Mobile Person v2 (`<MobilePersonDetail>`) with zone switcher

#### Architecture

Below `md` (<768px), the page renders a new component that replaces the desktop `<CollapsibleZoneLayout>` entirely. Desktop layout is untouched above `md`.

```tsx
// people-v2/[id]/page.tsx (modified)
return (
  <Page>
    <PageBody>
      {/* Mobile: <md */}
      <div className="md:hidden">
        <MobilePersonDetail {...props} />
      </div>
      {/* Desktop: md+ */}
      <div className="hidden md:block">
        <CollapsibleZoneLayout zone1={...} zone2={...} />
      </div>
    </PageBody>
  </Page>
)
```

Both branches receive the same props, render the same sections. State (`activeTab`, form state, dirty, etc.) is lifted to the page; the two branches are pure presentation.

#### Zone switcher

Segmented control — not a new primitive — built from two `Button`s with `role="tab"` + `aria-selected`, mirroring `PersonDetailTabs` a11y pattern:

```
┌─── Mobile Person v2 ────────────────────┐
│  PersonDetailHeader (sticky)            │
│                                         │
│  ┌─[ Details ]──[ Activity ]──────────┐ │  ← zone switcher, h-11 (44px)
│  └─────────────────────────────────────┘ │
│                                         │
│  Switch = 'details':                    │
│    Zone 1 contents (CrudForm)           │
│  Switch = 'activity':                   │
│    PersonDetailTabs (tab bar)           │
│    Zone 2 contents (tab content)        │
│                                         │
└─────────────────────────────────────────┘
```

- Zone switcher state persists in URL (`?zone=details|activity`) so deep links round-trip correctly.
- Default zone when no URL param: `'details'`.
- Touch targets: `h-11` (44px) — explicit class override on both switcher buttons, matching SPEC-072 WCAG requirement.
- `aria-label="Zone selector"`, `role="tablist"` wrapper.
- Keyboard: `ArrowLeft`/`ArrowRight` swap between the two zones (matches `PersonDetailTabs` convention).

#### Interaction with SPEC-072 collapsible zones

- `CollapsibleZoneLayout`'s 1280px internal breakpoint is never reached on mobile (<768px) because the mobile branch is rendered first. No conflict.
- The existing URL param for collapsed zone state (`om:zone1-collapsed:person-v2`) only applies on desktop — irrelevant to mobile.
- When the viewport crosses the `md` boundary (rotate, resize), React re-renders the appropriate branch. Dirty form state persists because state lives on the page, not the branch.

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/components/detail/MobilePersonDetail.tsx` | New — mobile layout + zone switcher |
| `packages/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx` | Modified — wrap existing layout in `md:hidden` / `hidden md:block` branches, lift state if needed |
| `packages/core/src/modules/customers/i18n/{en,pl,de,es}.json` | Add `customers.people.mobile.zoneSwitcher.details` / `.activity` keys |

---

### Enhancement 4 — Manage Tags "arrows variant"

#### Architecture

Inject `ChevronUp` / `ChevronDown` `IconButton`s into `SortableEntryRow` (at [ManageTagsDialog.tsx:313-413](packages/core/src/modules/customers/components/detail/ManageTagsDialog.tsx:313)), next to the existing `GripVertical` drag handle.

```
┌ row ──────────────────────────────────────────────────────── ┐
│ [⋮⋮]  [↑] [↓]   [status-label-input]  [●color]  ...  [🗑]    │
└──────────────────────────────────────────────────────────────┘
```

Arrows call `setDraftsByKind` with `arrayMove(liveEntries, index, index ± 1)` — reusing the exact same transformation that `handleDragEnd` already runs. No refactor of state ownership.

- Up arrow disabled when `index === 0`.
- Down arrow disabled when `index === liveEntries.length - 1`.
- Keyboard: arrows are normal `IconButton`s — Tab-reachable, Enter/Space activated. Combined with `@dnd-kit`'s KeyboardSensor (already wired at line 495), the dialog now supports **two** accessible reorder paths.
- Arrow clicks mutate local draft state; nothing is persisted until the dialog's global `Save` is pressed (current batch-save semantics preserved).

#### a11y

- Each arrow button: `aria-label` from i18n keys `customers.tags.manage.moveUp` / `.moveDown`.
- `GripVertical` gains a `title` + `aria-label` attribute (was previously unlabeled — boy-scout improvement within scope since we're touching the row).

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/components/detail/ManageTagsDialog.tsx` | Modified — add arrows to `SortableEntryRow`, add handlers; label grip handle |
| `packages/core/src/modules/customers/components/detail/__tests__/ManageTagsDialog.test.tsx` | Modified — add reorder-via-arrows suite; add boundary (disabled) checks |
| `packages/core/src/modules/customers/i18n/{en,pl,de,es}.json` | Add `customers.tags.manage.moveUp`, `customers.tags.manage.moveDown`, `customers.tags.manage.dragHandle` |

---

### Enhancement 5 — English copy pass on touched screens

#### Scope (strict)

Only the following files are in scope for copy normalization:

- Files modified by Enhancements 1–4.
- Any component they directly render (header, row renderer, section header, pagination).

For each string in those files:

1. If the string is already keyed (`t('key', 'English')`): confirm English fallback is accurate; ensure `en.json`, `pl.json`, `de.json`, `es.json` each have the key with the appropriate translation. If Polish was the fallback in source, replace with English and move the Polish to `pl.json`.
2. If the string is hard-coded Polish (rare — most components already pass through `t()`): add an i18n key and make English the fallback.
3. If the string is hard-coded English: leave unless the UX designer's Figma copy differs — in which case update the source fallback and all four locale files.

The UX designer provides the English master for each affected key via the Figma changelog. Polish / de / es translations follow existing workflow (Polish = existing where present, de/es = carry forward or mark `TODO` if new).

#### Non-goals

- Not touching unmodified modules (catalog, sales, auth, etc.).
- Not introducing any new locales.
- Not changing i18n infrastructure (`useT`, `resolveTranslations`).

#### Files

| File | Action |
| ---- | ------ |
| `packages/core/src/modules/customers/i18n/en.json` | Modified — ensure all new and touched keys present |
| `packages/core/src/modules/customers/i18n/pl.json` | Modified — same |
| `packages/core/src/modules/customers/i18n/de.json` | Modified — same |
| `packages/core/src/modules/customers/i18n/es.json` | Modified — same |

---

## Implementation Phases

| Phase | Enhancements | Estimate | Dependencies |
| ----- | ------------ | -------- | ------------ |
| **Phase 1** | Avatar primitive (+ monochrome variant) + `LinkEntityDialog` shared primitive + 3 adapters | 3–4 days | None |
| **Phase 2** | Adopt `LinkEntityDialog` in `PersonCompaniesSection`, `CompanyPeopleSection`, `DealLinkedEntitiesTab`; add "Add new" CTA nested-create wiring; orphan warning for deal adapter | 2–3 days | Phase 1 |
| **Phase 3** | Remove "+ Link company" header CTA from Person v2; mark prop deprecated | 0.5 day | None (independent) |
| **Phase 4** | `MobilePersonDetail` + zone switcher; page-level `md:hidden` / `hidden md:block` split | 2 days | None (independent) |
| **Phase 5** | `ManageTagsDialog` arrows variant + tests | 0.5 day | None (independent) |
| **Phase 6** | English copy pass on touched files; i18n file updates | 0.5 day | Phases 1–5 |

Total: **8–10 dev days**. Phases 3, 4, 5 can run in parallel with Phase 2 if multiple devs are available.

---

## Integration Tests

Each phase ships its integration tests as part of the same PR — per root AGENTS.md mandate and memory `feedback_integration_tests_mandatory.md`.

### TC-UX-LINK-001: Shared link dialog, 960px layout (company picker)

```
Navigate: /backend/customers/people-v2/{id}
Open Companies tab → click "Manage":
  - Verify dialog opens at exactly 960px (measure computed style, tolerance ±1px)
  - Verify left pane has search input + paginated results
  - Verify right pane has selected preview
  - Verify avatars render with monochrome palette (bg-muted, no color hash)
  - Verify [← Previous] [1/N] [Next →] pagination renders
  - Type "Acme" → verify list filters
  - Check Acme → verify it appears in right pane
  - Click Save → verify POST to /api/customers/people/{id}/companies and list refreshes
```

### TC-UX-LINK-002: Link Deal orphan warning

```
Precondition: Create a deal D linked only to company C (no person, no other company).
Navigate: /backend/customers/people-v2/{id} → Deals tab → Manage (or Link)
Search for D → select:
  - Verify orange-tone warning banner appears in right pane
  - Verify copy: "This deal has no other linked entities. If you unlink it later, it will become unreachable."
  - Verify banner dismissable with [X]
  - Confirm Save still works (non-blocking warning)
```

### TC-UX-LINK-003: "Add new" nested-create CTA

```
Navigate: /backend/customers/companies-v2/{id} → People tab → Manage
Click [+ Add new person] in right pane:
  - Verify outer modal becomes inert (aria-hidden)
  - Verify CreatePersonDialog opens with company pre-populated
  - Fill name "Test Person" → Cmd+Enter submits
  - Verify inner dialog closes
  - Verify outer modal reactivates, focus returns to outer
  - Verify "Test Person" appears in search results and is auto-selected in right pane
  - Click outer Save → verify link persisted
```

### TC-UX-LINK-004: Monochrome scope

```
Navigate: Any link dialog → inspect avatar DOM
  - Verify class includes bg-muted (not bg-primary / bg-accent)
  - Verify no dynamic color style attribute
Navigate: Person v2 Zone 2 → Deals tab → deal card avatar
  - Verify avatar is NOT monochrome (colored, variant="default")
```

### TC-UX-PERSON-005: "+ Link company" removed from Person v2 header

```
Navigate: /backend/customers/people-v2/{id}
Query DOM by button text: "Link company"
  - Verify NO button matches in the header region
Navigate: Companies tab
  - Verify [Manage] button still present (linking path intact)
```

### TC-UX-MOBILE-006: Mobile Person v2 zone switcher

```
Set viewport: 375×812 (iPhone 13)
Navigate: /backend/customers/people-v2/{id}
  - Verify MobilePersonDetail renders (assert class md:hidden on wrapper)
  - Verify [Details | Activity] switcher visible, both buttons h-11 (44px)
  - Verify Details active by default, Zone 1 CrudForm rendered below
Click [Activity]:
  - Verify Zone 2 tabs + content rendered, CrudForm unmounted (or hidden)
  - Verify URL updates to ?zone=activity
Hard-refresh with ?zone=activity:
  - Verify Activity active on load
Resize viewport to 1280×800:
  - Verify MobilePersonDetail unmounts, CollapsibleZoneLayout renders
  - Verify form dirty state (if any) preserved across breakpoint change
```

### TC-UX-TAGS-007: Reorder tags via arrow buttons

```
Navigate: Any person detail → click "Tags" → [Manage]
Select any non-system category with ≥3 entries
  - Verify each row has [↑][↓] buttons next to grip handle
Click [↓] on row 1:
  - Verify entry moves to position 2 in local draft
Click [↑] on row 0:
  - Verify button is disabled (aria-disabled="true")
Click [↓] on last row:
  - Verify button is disabled
Click dialog Save:
  - Verify reordered entries persisted (check via GET /api/customers/dictionaries/{kind})
```

### TC-UX-I18N-008: Copy pass — no stray Polish on touched screens

```
Load page with locale=en, viewport 1280:
  - Regex assert page HTML does not contain Polish-specific characters: ą, ć, ę, ł, ń, ó, ś, ź, ż
    (whitelist known-safe substrings like entity names entered by user)
Repeat for mobile viewport:
  - Same assertion on MobilePersonDetail + zone switcher + mobile tabs
Repeat for each link dialog (open via test harness) and ManageTagsDialog
```

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| Consolidating 3 link dialogs into 1 primitive regresses edge cases (primary-star logic, `excludeLinkedCompanyId` filter) | High | Keep adapter-level tests for each kind; add test coverage for primary-toggle; preserve the 4 existing `__integration__/TC-CRM-*.spec.ts` test names and update assertions, not delete. |
| Nested "Add new" dialog breaks focus management / leaks Escape to parent | Medium | Use ARIA `inert` on outer dialog root while inner is mounted; explicit event-listener `{ capture: true }` on inner Escape to stop propagation; Jest RTL tests for focus return. |
| 960px exact width doesn't fit smaller laptop widths (1366px-class) | Low | Dialog already has `max-h-[calc(100vh-4rem)]` + `sm:max-w-[960px]` + fallback `w-[calc(100vw-2rem)]`. Confirmed width clamps below 1024px. |
| Monochrome variant leaks outside linking modals (shared Avatar primitive reused elsewhere) | Medium | `variant` default is `'default'` (colored); monochrome only activated by explicit opt-in. Grep PR diff for new `variant="monochrome"` call sites before merge. |
| Mobile zone switcher conflicts with `CollapsibleZoneLayout`'s internal breakpoint state | Medium | Two layouts are mutually exclusive via `md:hidden` / `hidden md:block`. Each branch owns its own collapse/switcher state. State lifted to page — no loss on resize. |
| URL param `?zone=activity` collides with existing tab param | Low | `PersonDetailTabs` already uses `?tab=…`. `?zone=…` is namespaced distinctly. Reader precedence: `zone` selects mobile top-level mode, `tab` selects nested tab inside activity zone. |
| Arrows + drag give two ways to reorder — user confusion | Low | Both mutate the same local draft state atomically. Visual spec pairs them adjacent to signal "same operation, different input method". Keyboard users gain a labeled alternative; mouse users get the grip they already know. |
| Polish→English copy pass regresses legitimate Polish-language translations | Medium | Copy pass only modifies the **source code fallback**; `pl.json` retains the Polish rendering. Verified by explicitly loading locale=pl in TC-UX-I18N-008 exact opposite direction. |
| Dialog width 960px adds arbitrary Tailwind class — future tailwind config churn | Low | Codebase already has `sm:max-w-4xl`, `max-w-[calc(100vw-2rem)]` etc. Arbitrary values are the house pattern. No config change needed. |
| `onOpenCompaniesTab` prop deprecation ignored by third-party widgets | Low | Prop becomes no-op, not removed. Typed `@deprecated` with release-notes entry. Full removal scheduled at next major. |

---

## Accessibility Checklist

- [ ] `LinkEntityDialog`: `role="dialog"` + `aria-modal="true"` + labeled heading
- [ ] Pagination controls: `aria-label="Previous page"` / `"Next page"`; announcements via `aria-live="polite"` on page-count text
- [ ] Nested "Add new" dialog: `aria-describedby` referencing outer dialog title; Escape doesn't leak; focus returns to trigger button
- [ ] Orphan warning banner: `role="status"` (not `alert` — non-blocking); dismiss button `aria-label`
- [ ] Monochrome avatars: initials read via `aria-label` on the avatar container; decorative gradient has `aria-hidden`
- [ ] Mobile zone switcher: `role="tablist"`, `role="tab"` + `aria-selected` per button, `aria-controls` → zone content id, ArrowLeft/ArrowRight keyboard nav, h-11 (44px) touch target
- [ ] Tag arrows: both buttons keyboard-focusable; disabled state uses `aria-disabled="true"` + visual dimming; i18n'd `aria-label`
- [ ] Grip handle: newly labeled `aria-label={t('customers.tags.manage.dragHandle', 'Drag to reorder')}`
- [ ] All animations respect `prefers-reduced-motion`
- [ ] `+ Link company` deletion: verify no orphan tab-order holes remain in header

---

## Alternatives Considered

| Alternative | Why rejected |
| ----------- | ------------ |
| Keep 3 independent link dialogs, only restyle them | Misses the opportunity to halve the LOC and to give all three the same a11y + "Add new" affordance in one shot. User confusion across entity kinds was reported in UX feedback. |
| Build `LinkEntityDialog` as a generic Radix UI component in `@open-mercato/ui` | Adapter pattern is customer-domain-specific (orphan warning, primary-star, exclude-linked filter). Promoting to `ui` package would leak domain concepts upward. Keep in `customers` module; export locally. |
| Replace grip drag handle with arrows entirely | @dnd-kit drag is still the fastest reorder input method for power users. Arrows are strictly additive — additive is safer than removal. |
| Create a mobile-specific route `/backend/customers/people-v2/[id]/mobile` | Duplicates page metadata (guards, feature checks, loader). One page with a branch is simpler and keeps state lifted naturally. |
| Global `Avatar` primitive becomes monochrome by default; opt-in colored variant | Would regress every other CRM surface that relies on colored entity avatars. Inverting the default for a modal-scoped design choice is the wrong blast radius. |
| Fetch `anchors` count for orphan warning via a new dedicated endpoint | Reuses existing `/api/customers/deals` with an enricher — consistent with SPEC-072 response-enricher pattern. One less route to maintain. |

---

## Migration & Backward Compatibility

This iteration is **strictly additive or UX-only**. No removals, no renames on any of the 13 contract-surface categories from `BACKWARD_COMPATIBILITY.md`.

### New surfaces (additive — no deprecation bridge required)

| Surface | Addition | Notes |
| ------- | -------- | ----- |
| UI primitive | `@open-mercato/ui/primitives/avatar.tsx` → `Avatar` | New export; no previous name |
| Customer module components | `components/linking/LinkEntityDialog.tsx` + 3 adapters | New; replaces ad-hoc dialogs via internal wiring |
| Customer module components | `components/detail/MobilePersonDetail.tsx` | New |
| i18n keys (additive) | `customers.linking.*` (~20 keys), `customers.tags.manage.{moveUp,moveDown,dragHandle}`, `customers.people.mobile.zoneSwitcher.*` | All additive |
| Deal API response field | `items[].anchors = { companies: number; people: number }` via existing enricher | Additive on existing route; existing consumers see extra field, no breakage |

### Soft-deprecation (kept as no-op for one release cycle)

| Surface | Change | Deprecation bridge |
| ------- | ------ | ------------------ |
| `PersonDetailHeader` prop `onOpenCompaniesTab` | No longer invoked internally | Prop still accepted (typed `@deprecated` in JSDoc); documented in RELEASE_NOTES.md; removal scheduled at next minor |

### Guaranteed non-changes

- DB schema — unchanged (0 migrations).
- API route URLs and methods — unchanged. Existing `/api/customers/{entity}/{id}/{target}` endpoints serve the same request / response shapes.
- Events — no new event IDs; no removal.
- ACL features — no new, no rename.
- Commands — no new, no rename. Reuse `customers.personCompanyLinks.*`, `customers.dealCompanyLinks.*`, `customers.dealPeopleLinks.*`, `customers.people.create`, `customers.deals.create`.
- DI names — no change.
- Widget injection spot IDs — no change.
- Generated files — no contract change.

### Consumer migration guidance

Third-party modules need **no migration**. Callers that:

- Render a `PersonDetailHeader` with `onOpenCompaniesTab` — continue to work, prop is a no-op until next major.
- Inject a widget into `detail:customers.person:*` spots — unaffected.
- Consume `/api/customers/deals` responses — may optionally read new `anchors` field; absent reads still work (undefined branch).

---

## Decisions to Confirm Before Implementation

All decisions resolved at Open Questions gate on 2026-04-19 (all defaults accepted by user). Locked:

1. "Add new" CTA → nested mini-create dialog (Q1 = b)
2. Orphan warning → deal with no active company + no primary person (Q2 = a)
3. "+ Link company" removal → Zone 2 Companies tab only (Q3 = a)
4. Mobile switcher → below `md`; desktop untouched (Q4 = a)
5. Monochrome avatars → `Avatar variant="monochrome"` prop, modal-scoped (Q5 = a)
6. English copy pass → touched screens only (Q6 = a)
7. Tag arrows → additive to drag handle (Q7 = a)
8. Link Deal direction → new reverse direction from person/company (Q8 = a)
9. Person v2 "4 variants" → runtime data states (Q9 = a)
10. Rollout → in-place replacement, no feature toggle (Q10 = a)

---

## Final Compliance Report — 2026-04-19

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/shared/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | N/A | UI-only, no new data access |
| root AGENTS.md | Filter by `organization_id` in scoped queries | N/A | Reuses existing endpoints; no new queries |
| root AGENTS.md | Use DI (Awilix) | N/A | No new services |
| root AGENTS.md | Modules remain isomorphic and independent | Compliant | All additions inside `customers` + `@open-mercato/ui` |
| root AGENTS.md | Validate inputs with zod | Compliant | Nested "Add new" reuses existing `createPersonFormSchema` / deal schemas |
| root AGENTS.md | Pagination `pageSize <= 100` | Compliant | 20 items/page (existing) |
| root AGENTS.md | Every dialog: `Cmd/Ctrl+Enter` submit, `Escape` cancel | Compliant | §Enhancement 1 "Add new" nested dialog preserves this explicitly |
| root AGENTS.md | Use semantic status tokens (no hardcoded `text-red-*` / `bg-green-*`) | Compliant | Monochrome avatars use `bg-muted` / `text-muted-foreground`; orphan warning uses `Alert variant="warning"` |
| root AGENTS.md | No arbitrary text sizes | Compliant | Spec doesn't introduce any; implementation uses Tailwind scale |
| root AGENTS.md | Use `Alert` (not `Notice`) for inline messages | Compliant | Orphan warning explicitly uses `<Alert variant="warning">` |
| root AGENTS.md | Use `lucide-react` for ALL icons (no inline SVG) | Compliant | Uses `ChevronUp`, `ChevronDown`, `Building2`, `Plus`, etc. |
| root AGENTS.md | Use `apiCall` / `apiCallOrThrow`, never raw `fetch` | Compliant | All callers already use `apiCallOrThrow` |
| root AGENTS.md | Non-`CrudForm` writes use `useGuardedMutation` | Compliant | `LinkEntityDialog.onConfirm` accepts `runGuardedMutation` prop; callers pass through |
| root AGENTS.md | i18n: `useT()` client, `resolveTranslations()` server | Compliant | All new keys under `customers.linking.*`, `customers.tags.manage.*`, `customers.people.mobile.*` |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | Copy pass enforces keys on all touched screens |
| root AGENTS.md | Prefer package-level imports over deep relative | Compliant | Adapter files import from `@open-mercato/customers/...` |
| root AGENTS.md | `BACKWARD_COMPATIBILITY.md` protocol for contract surfaces | Compliant | Dedicated Migration & BC section; `onOpenCompaniesTab` soft-deprecation bridge documented |
| root AGENTS.md | Singular naming for entities/commands/events/feature IDs | Compliant | `Avatar`, `LinkEntityDialog`, `MobilePersonDetail` all singular; no new events/commands |
| packages/core/AGENTS.md | API routes MUST export `openApi` | N/A | No new API routes |
| packages/core/AGENTS.md | `makeCrudRoute` with `indexer: { entityType }` | N/A | No new CRUD routes |
| packages/core/AGENTS.md | Commands for write operations | N/A | Reuses existing `customers.personCompanyLinks.*`, `customers.dealCompanyLinks.*`, `customers.dealPeopleLinks.*`, `customers.people.create`, `customers.deals.create` |
| packages/core/AGENTS.md | `withAtomicFlush` when needed | N/A | No new DB writes |
| packages/core/src/modules/customers/AGENTS.md | Use customers as template for new CRUD | N/A | Not a new module |
| packages/core/src/modules/customers/AGENTS.md | Non-`CrudForm` backend writes use `useGuardedMutation` + `retryLastMutation` | Compliant | Contract documented in `LinkEntityDialogProps` |
| packages/ui/AGENTS.md | Shared primitives live in `packages/ui/src/primitives/` | Compliant | New `Avatar` at `packages/ui/src/primitives/avatar.tsx` |
| packages/ui/AGENTS.md | Use `IconButton` for icon-only buttons with `aria-label` | Compliant | Tag arrows and pagination buttons use `IconButton` with labeled aria |
| .ai/specs/AGENTS.md | Filename `{date}-{title}.md` kebab-case | Compliant | `2026-04-19-crm-linking-modals-and-mobile-variants.md` |
| .ai/specs/AGENTS.md | Include TLDR, Overview, Problem Statement, Proposed Solution, Risks & Impact Review, Final Compliance Report, Changelog | Compliant | All present; Data Models / API Contracts sections intentionally omitted with justification (UI-only — explicitly documented in Scope Classification) |
| .ai/specs/AGENTS.md | Integration tests defined per feature | Compliant | TC-UX-LINK-001 through TC-UX-I18N-008 |
| BACKWARD_COMPATIBILITY.md | Event IDs FROZEN — no rename/remove | Compliant | No event changes |
| BACKWARD_COMPATIBILITY.md | Widget injection spot IDs FROZEN | Compliant | No spot changes |
| BACKWARD_COMPATIBILITY.md | API route URLs STABLE; response fields additive-only | Compliant | Only additive `anchors` field on `/api/customers/deals` items |
| BACKWARD_COMPATIBILITY.md | Database schema ADDITIVE-ONLY | N/A | No schema changes |
| BACKWARD_COMPATIBILITY.md | Type definitions STABLE; required fields never removed | Compliant | `onOpenCompaniesTab` remains optional and functional (no-op) until next major |
| BACKWARD_COMPATIBILITY.md | Deprecation protocol (never remove in one release) | Compliant | `onOpenCompaniesTab` prop kept as no-op with `@deprecated` JSDoc |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | N/A | No new data models or contracts |
| API contracts match UI/UX section | Pass | Reuses existing `/api/customers/{entity}/*` endpoints; new `anchors` field on deals list matches orphan-warning UX |
| Risks cover all write operations | Pass | Link save, nested create, tag reorder all covered |
| Commands defined for all mutations | Pass | All mutations go through existing commands; no new state-mutating code paths |
| Cache strategy covers all read APIs | Pass | No new reads; existing endpoints retain their current cache behavior |
| i18n keys planned for all user-facing strings | Pass | `customers.linking.*`, `customers.tags.manage.{moveUp,moveDown,dragHandle}`, `customers.people.mobile.zoneSwitcher.*` explicitly enumerated |
| A11y coverage matches SPEC-072 bar | Pass | Dedicated Accessibility Checklist section; 44px touch targets on mobile switcher; arrow keyboard nav; `inert` on nested-dialog parent |
| Phasing is incrementally testable | Pass | Each phase ships its own integration test; Phases 3/4/5 can ship independently |

### Non-Compliant Items

None.

### Deliberate Omissions (justified)

- **No "Data Models" section** — UI-only iteration; Scope Classification at the top explicitly states no schema changes.
- **No "API Contracts" section** — only one additive field (`anchors` on `/api/customers/deals` items) documented inline in Enhancement 1. No new routes to contract.
- **No "Commands" section** — no new commands. All mutations flow through existing `customers.personCompanyLinks.*`, `customers.dealCompanyLinks.*`, `customers.dealPeopleLinks.*`, `customers.people.create`, `customers.deals.create`.
- **No cache invalidation section** — no new writes to invalidate; existing commands already declare their cache aliases.

### Verdict

**Fully compliant — approved for implementation.**

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Avatar primitive + LinkEntityDialog + 3 adapters | Done | 2026-04-19 | `Avatar` in `@open-mercato/ui`, `LinkEntityDialog` + `companyAdapter`/`personAdapter`/`dealAdapter` in `customers/components/linking/`. 10 Avatar unit tests + 7 LinkEntityDialog unit tests passing. i18n keys added under `customers.linking.*` across en/pl/de/es. |
| Phase 2 — Adopt LinkEntityDialog in 3 sections + Add new CTA + orphan warning | Done | 2026-04-19 | `PersonCompaniesSection`, `CompanyPeopleSection`, `DealLinkedEntitiesTab` refactored; `CreatePersonDialog` surfaces created record in `onPersonCreated`; existing component tests updated to new "Save links" / numbered pagination UI. |
| Phase 3 — Remove "+ Link company" header CTA | Done | 2026-04-19 | JSX block removed from `PersonDetailHeader.tsx`; `onOpenCompaniesTab` prop marked `@deprecated` (no-op, kept for one release per BC protocol); negative-assertion test added. |
| Phase 4 — MobilePersonDetail + zone switcher | Done | 2026-04-19 | New `MobilePersonDetail` with `[Details | Activity]` segmented control (`md:hidden` branch); `people-v2/[id]/page.tsx` wraps existing layout in `hidden md:block`; 44px touch targets, ArrowLeft/ArrowRight keyboard nav, `?zone=` URL persistence; 4 unit tests. |
| Phase 5 — ManageTagsDialog arrows variant | Done | 2026-04-19 | `SortableEntryRow` receives `index`/`total`; `ChevronUp`/`ChevronDown` `IconButton`s added beside drag handle (additive); `moveEntryByDelta` reuses `arrayMove`; grip handle labeled; reorder-via-arrows test added. |
| Phase 6 — English copy pass | Done | 2026-04-19 | No stray Polish characters in touched source files (verified via grep). i18n keys in en/pl/de/es added per phase (linking, mobile zone switcher, tag arrows). `pl.json` retains Polish translations. |

### Verification

- `yarn build:packages`: ✅ 18/18 tasks successful
- `yarn lint`: ✅ 0 errors (10 pre-existing warnings unrelated to this work)
- `yarn test` (core): ✅ 362 suites, 3038 tests passed
- `yarn test` (ui): ✅ 55 suites, 283 tests passed
- `npx tsc --project packages/core/tsconfig.json --noEmit`: ✅ no errors
- `npx tsc --project packages/ui/tsconfig.json --noEmit`: ✅ no errors

---

## Changelog

| Date | Change |
| ---- | ------ |
| 2026-04-19 | Skeleton drafted from Figma UX changelog (CR5). Open Questions gate published. |
| 2026-04-19 | Rev 1: Open Questions gate closed (all defaults accepted). Filled Problem Statement, Proposed Solution (5 enhancements), Phasing, Integration Tests, Risks, A11y, Alternatives, Migration & BC sections. |
| 2026-04-19 | Rev 2: Ran spec-writing Final Compliance Review against root AGENTS.md, packages/core/AGENTS.md, customers/AGENTS.md, ui/AGENTS.md, shared/AGENTS.md, specs/AGENTS.md, BACKWARD_COMPATIBILITY.md. Fully compliant. Surgical DS fixes: orphan warning pinned to `<Alert variant="warning">`; clarified there is no existing `Avatar` primitive. Ready for implementation. |
| 2026-04-19 | Rev 3: Implementation complete. All 6 phases delivered; build + lint + 3321 unit tests pass. `LinkEntityDialog` consolidates 3 linking dialogs; `MobilePersonDetail` ships responsive zone switcher; ManageTagsDialog gains arrow reorder affordance; "+ Link company" header CTA removed with deprecation-protocol soft-landing on the prop. |

### Review — 2026-04-19
- **Reviewer**: Agent (spec-writing skill, Martin Fowler lens)
- **Security**: Passed — UI-only iteration, no new attack surface; nested "Add new" reuses existing zod-validated create commands
- **Performance**: Passed — reuses existing paginated endpoints (20/page); orphan warning uses existing response-enricher pattern, no N+1
- **Cache**: Passed — no new writes, no cache invalidation changes; existing command cache aliases retained
- **Commands**: Passed — all mutations flow through existing undoable commands; no new state-mutating code paths
- **Risks**: Passed — 10 concrete risks documented with mitigations and residual risk; focus/Escape propagation risk for nested dialog has explicit `inert` + capture-listener mitigation
- **Verdict**: Approved
