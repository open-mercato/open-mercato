# Breadcrumbs — Design System Redesign + Coverage Sweep

## TLDR

Open Mercato has a working breadcrumb mechanism (server-side `breadcrumb` prop + client-side `<ApplyBreadcrumb>`) but no DS treatment: rendering is hardcoded inline in `AppShell.tsx`, no reusable primitive, no DS docs, **86% of backend pages (134/155) ship with no breadcrumb at all**, and several pages duplicate the auto-injected `Dashboard` root. The Figma DS file ([`Breadcrumbs`, node 447-8760](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=447-8760)) defines a complete component system with 3 dividers, icon/text/both modes, default/hover/active states, and a Settings page for tenant-level configuration that we don't yet have.

This spec ships the redesign as a **single atomic PR** with five logical implementation steps (kept as separate commits inside the PR for reviewer clarity, but landing together so the rollback unit stays whole). Default divider is `slash`, default first crumb has a home icon, dropdown crumbs and last-as-Link-button stay opt-in (Step 6, deferred — only when a real use case appears).

**In scope:**

- New `<Breadcrumb>` primitive in `packages/ui/src/primitives/breadcrumb.tsx` (root + sub-components, fully ARIA correct, slash/arrow/dot dividers, default/hover/active states, optional icon).
- DS docs section in `.ai/ui-components.md`.
- Refactor of `AppShell.tsx:1186-1219` to use the new primitive (no visible regression — same Dashboard-root dedup, same responsive `hidden md:inline` truncation behavior).
- Coverage sweep — add `breadcrumb` to all 134 backend pages currently missing one, with priority to detail/edit/sub-pages.
- Schema enforcement — make `labelKey` required on every breadcrumb entry in `PageMetadata`.
- New Settings page `/backend/settings/breadcrumbs` (or under existing `Personalizacja` group) where admins configure tenant-level defaults: divider style, default home icon on/off, max visible quantity (with ellipsis collapse beyond it), text/icon toggle for items.
- Portal breadcrumb API — `breadcrumb` prop and `<ApplyPortalBreadcrumb>` on `PortalShell`, parallel to backend.

**Out of scope:**

- Dropdown breadcrumb (Block 4 in Figma — mid-crumb opens a menu of alternatives). Defer until a real use case appears (e.g. Sales documents pipeline navigation).
- Last-crumb-as-Link-Button (Block 2 in Figma). Detail pages already have `FormHeader` with Actions menu, so this affordance is redundant for now.
- Breadcrumb truncation animations / "More" overflow popover beyond the simple ellipsis.
- Reordering / customizing breadcrumb items per route (out of scope; if needed → injection spot in Step 6+).
- Search bar / Cmd+K embedded in the breadcrumb (some products do this; Open Mercato has separate search affordance).

---

## Overview

`AppShell` already has the data plumbing for breadcrumbs:

- `AppShellProps.breadcrumb?: Array<{ label; labelKey?; href? }>` — server-side initial state (set in `(backend)/backend/layout.tsx` from `page.meta.ts.metadata.breadcrumb`).
- `<ApplyBreadcrumb>` (`AppShell.tsx:329`) — client-side runtime override via `HeaderContext.setBreadcrumb()`.
- `currentTitle` / `headerTitle` — fallback if no breadcrumb is supplied (renders title only).

What's missing is the **rendering layer** (no primitive, no DS treatment, hardcoded inline) and **adoption** (134/155 pages skip breadcrumbs entirely or duplicate the root).

The Figma DS frame ([node 447-8760](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=447-8760)) gives us:

- A `Breadcrumbs Group` component with `divider` (Arrow/Slash/Dot) and `quantity` (03/04/05) properties.
- A `Breadcrumb Items` sub-component with `state` (Default/Hover/Active), `text` (on/off), `icon` (on/off) — 9 variants.
- Light + dark mode examples.
- 4 production "block" patterns: classic slash, arrow + Link Button last, dot minimal, slash + dropdown chevron mid.

The spec maps these properties to a single primitive composable from sub-components, then drives them via tenant-level defaults configurable in Settings.

---

## Problem Statement

### P1 — No reusable primitive, no DS treatment

`AppShell.tsx:1186-1219` renders breadcrumbs inline:

```tsx
<nav className="flex items-center gap-2 text-sm min-w-0">
  {items.map((b, i) => (
    <React.Fragment key={i}>
      {i > 0 && <span className="text-muted-foreground hidden md:inline">/</span>}
      {b.href ? <Link className="text-muted-foreground hover:text-foreground">{b.label}</Link>
              : <span className="font-medium truncate">{b.label}</span>}
    </React.Fragment>
  ))}
</nav>
```

No `aria-label`, no `aria-current="page"` on the last item, no underline on hover (Figma defines it), no `text-disabled` on separators (Figma uses `#d1d1d1`, current uses `muted-foreground` which is darker), no token mapping. Cannot be reused by Portal, by injection widgets, or by anyone who needs "breadcrumb in a non-AppShell context" (e.g. embedded in a side panel, in dialog header, etc.).

### P2 — 86% adoption gap

Breadcrumb audit results (full sweep across `packages/core/src/modules/**/backend/**/page.meta.ts` and `apps/mercato/src/**`):

| Metric | Count |
|---|---|
| Backend pages with `breadcrumb` declared | 21 / 155 |
| Backend pages without `breadcrumb` (rely on AppShell's auto-Dashboard root) | 134 / 155 |
| Pages declaring `labelKey` on every entry | not enforced |
| Pages with duplicate Dashboard root (already auto-added by AppShell) | ≥ 3 confirmed |
| Portal pages with breadcrumb | 0 (PortalShell has no API) |

Detail/edit pages (e.g. `business_rules/sets/[id]`, `entities/user/[entityId]`, `shipping_carriers/*/create`, settings sub-pages) are the worst offenders — exactly the routes where a back-affordance is most needed.

### P3 — No tenant-level configurability

Figma defines a Settings UX where admins can adjust divider style (arrow/slash/dot) and item rendering (text/icon/both). We have no equivalent today; styling is hardcoded.

### P4 — Portal has no breadcrumb mechanism at all

`PortalShell` exposes no `breadcrumb` prop, no context, no `<ApplyPortalBreadcrumb>` helper. Customers in the portal cannot get the same back-navigation affordance as admin staff.

---

## Proposed Solution

A composable primitive following the shadcn-style pattern, scoped to the Open Mercato DS tokens already in `globals.css`. Five ordered implementation steps, all landing in a single atomic PR (one commit per step for reviewer clarity).

### Component shape

```tsx
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from '@open-mercato/ui/primitives/breadcrumb'

<Breadcrumb divider="slash">
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink href="/backend" icon={<HomeIcon />} aria-label="Dashboard" />
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbLink href="/backend/customers/people">Customers</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>Jan Kowalski</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

### State / token mapping

| State | Figma token | OM DS class | Behavior |
|---|---|---|---|
| Default link | `text/sub-600` (#5c5c5c) | `text-muted-foreground` | no underline |
| Hover link | `text/strong-950` (#171717) + underline | `hover:text-foreground hover:underline` | underline appears on hover |
| Active page (current) | `text/strong-950` (#171717), no underline | `text-foreground font-medium` (no link, no underline) | renders as `<span aria-current="page">` |
| Separator | `text/disabled-300` (#d1d1d1) | `text-text-disabled` (token already in `globals.css`) | inert, `aria-hidden` |
| Typography | Inter Medium 14 / 20 | `text-sm font-medium leading-5 tracking-tight` | shared by all states |
| Icon | 20×20, home by default | `size-5` (lucide `Home`) | optional via `icon` prop on `BreadcrumbLink` |
| Gap | 6px | `gap-1.5` | between items, separators, and icon-text inside item |

### Divider rendering

| `divider` | Element | OM equivalent of Figma |
|---|---|---|
| `slash` (default) | `<span aria-hidden>/</span>` with `text-text-disabled` | matches "/" with disabled tone |
| `arrow` | `<ChevronRight aria-hidden className="size-5 text-text-disabled">` | lucide `ChevronRight` (DS already imports it) |
| `dot` | `<span aria-hidden>·</span>` with `text-text-disabled` | typographic mid-dot |

### Default values

- `divider` defaults to `'slash'` — preserves the current visual contract.
- First `BreadcrumbLink` in `AppShell` automatically gets a `Home` icon (matches Figma's home-smile-2-line on first crumb in every example).
- `BreadcrumbPage` (last item) is always rendered with `aria-current="page"`.

### Tenant-level configuration (Settings page)

A new page at `/backend/settings/breadcrumbs` (under the **Personalizacja** group, gated by `auth.sidebar.manage` or new `breadcrumbs.manage` feature) lets admins tune the global default:

| Setting | Type | Default | Effect |
|---|---|---|---|
| Default divider | radio: arrow / slash / dot | `slash` | Used by `AppShell` and all pages that don't override |
| First-item home icon | toggle | `on` | Drops/keeps the home icon prefix |
| Default item rendering | radio: text only / icon only / icon + text | `text only` (icons only on first) | Per-tenant default for `<BreadcrumbLink>` rendering |
| Max visible items | number 3–10 | `5` | When breadcrumb has > N items, collapse middle behind `<BreadcrumbEllipsis>` (popover with hidden items) |
| Mobile behavior | radio: ellipsis / current-only / back-link | `ellipsis` | Controls `< md` rendering — see Mobile Strategy section |

Persistence: per-tenant key on the `tenant_preferences` table (or equivalent feature-toggle store), surfaced via `BackendChromeProvider` so pages get the resolved settings without round-trips.

---

## Architecture

### Step 1 — Primitive + DS docs + AppShell refactor

Files:

- **`packages/ui/src/primitives/breadcrumb.tsx`** — new file, ~150 lines including types and forwardRef wrappers.
  - `<Breadcrumb>` — `<nav role="navigation" aria-label="Breadcrumb">` accepting `divider` prop via context.
  - `<BreadcrumbList>` — `<ol class="flex items-center gap-1.5 ...">`.
  - `<BreadcrumbItem>` — `<li class="inline-flex items-center gap-1.5">`.
  - `<BreadcrumbLink>` — `<Link>` with `text-muted-foreground hover:text-foreground hover:underline transition-colors`. Accepts `icon?: ReactNode` and renders it before the label.
  - `<BreadcrumbPage>` — `<span aria-current="page" class="text-foreground font-medium truncate max-w-[45vw] md:max-w-[60vw]">`.
  - `<BreadcrumbSeparator>` — reads `divider` from context, renders `<ChevronRight>` / `/` / `·` with `text-text-disabled` and `aria-hidden`.
  - `<BreadcrumbEllipsis>` — wraps `Popover` from `@open-mercato/ui/primitives/popover`, trigger is `<MoreHorizontal>` icon, content lists hidden items as links. (May be Step 4-only — initial Step 1 ships a stub that renders `…` without popover, popover added when Settings allows max-quantity tuning.)
- **`.ai/ui-components.md`** — new section "Breadcrumb" with sizes/variants/MUST rules/examples (~80 lines).
- **`packages/ui/src/backend/AppShell.tsx`** lines 1186-1219 — replaced with composition of new primitive. Dedup logic for auto-Dashboard root preserved verbatim. Responsive `hidden md:inline` moved to a `BreadcrumbItem` className override (or built into the primitive via a `collapseOnMobile` prop on `<BreadcrumbItem>`). The auto-Home-icon on the first item happens inside `AppShell`, not the primitive (primitive stays unopinionated).
- **`packages/ui/src/backend/__tests__/AppShell.test.tsx`** — extend the existing breadcrumb test ("renders navigation and breadcrumbs with translations applied via ApplyBreadcrumb") to assert the new DOM structure and `aria-current="page"`.
- **`packages/ui/src/primitives/__tests__/breadcrumb.test.tsx`** — new file. Tests: render order, separator rendering for each `divider`, `aria-current="page"` on last item, hover styling not asserted (visual), ellipsis collapse when count exceeds limit.

Visual contract: **no regression**. Same look-and-feel as today with `slash` divider; the only visible change is hover-underline (Figma spec).

### Step 2 — Coverage sweep

Files:

- 134 × `page.meta.ts` updated with `breadcrumb: [{ labelKey, label, href }]` entries pointing to the parent list.
  - Priority order: detail/edit pages (≥ 40), then sub-pages (`[id]/records`, `[id]/edit`), then settings sub-pages, then long-tail.
  - Each entry uses an existing list-page label (so `labelKey` matches an existing key — no new translations).
  - Where an entry's parent is itself a sub-route, use intermediate breadcrumbs (e.g. `Customers / People / Edit`).
- Cleanup of duplicate Dashboard roots: scan all existing `breadcrumb` entries for `label === 'Dashboard'` or `href === '/backend'` and remove (AppShell auto-injects).
- 4 × i18n locale files (`apps/mercato/src/i18n/{en,pl,de,es}.json`) — add any missing list-page label keys discovered during the sweep.

This step is mostly mechanical. Drives 86% → ≥ 95% adoption (some pages are intentionally crumb-less — e.g. login, splash, error).

### Step 3 — Schema enforcement

Files:

- **`packages/shared/src/modules/registry/types.ts`** (or wherever `PageMetadata` lives) — narrow the breadcrumb entry type so `labelKey` is required (not optional). `label` becomes a fallback only.

  ```ts
  // BEFORE
  type BreadcrumbEntry = { label: string; labelKey?: string; href?: string }
  // AFTER
  type BreadcrumbEntry = { labelKey: string; label?: string; href?: string }
  ```

- TypeScript compiler will surface every page that ships only `label`. Step 2 has already added `labelKey` everywhere in our sweep; if Step 2 is complete, Step 3 is a 1-line type change + green typecheck.
- A `tsx` codemod under `scripts/` to bulk-add `labelKey` to any third-party-installed module that we missed (advisory; not run automatically).
- Update `.ai/specs/AGENTS.md` MUST rules to mention the new requirement.

### Step 4 — Settings page + tenant-level config

Files:

- **`apps/mercato/src/app/(backend)/backend/settings/breadcrumbs/page.tsx`** + `page.meta.ts` — new page under `Personalizacja` settings group.
- **CrudForm** with 4 fields (radio for divider, switch for home icon, radio for item rendering, number for max quantity).
- **Persistence**: lean on `tenant_preferences` (`packages/core/src/modules/auth/...` — verify exact location during implementation). New keys: `breadcrumbs.divider`, `breadcrumbs.firstHomeIcon`, `breadcrumbs.itemRendering`, `breadcrumbs.maxVisible`.
- **API**: a tenant-level GET/PUT under `/api/auth/preferences/breadcrumbs` (or extend an existing preferences endpoint).
- **`BackendChromeProvider`** — fetches the resolved settings on shell hydration (the same place that already resolves `groups`, `settingsSections`, etc.) and threads them into `AppShellProps` as `breadcrumbConfig?: { divider; firstHomeIcon; itemRendering; maxVisible }`.
- **`AppShell.tsx`** — passes the resolved divider into `<Breadcrumb divider={...}>` and applies the rest of the config to the rendered items.
- **i18n**: 4 × `apps/mercato/src/i18n/*.json` — add labels for the settings page (~10 keys).
- **Unit tests**: settings form submit + chrome reads the new settings; `Breadcrumb` primitive honors `divider` prop transitions.

### Step 5 — Portal API

Files:

- **`packages/ui/src/portal/PortalShell.tsx`** — add `breadcrumb?: Array<{ labelKey; label?; href? }>` prop and `<ApplyPortalBreadcrumb>` helper analogous to backend's `ApplyBreadcrumb`.
- **`packages/ui/src/portal/PortalHeader.tsx`** (or wherever the header renders) — render the same `<Breadcrumb>` primitive.
- A few high-traffic portal pages (orders detail, profile, settings) get sample breadcrumb metadata to validate the integration.
- Update `packages/ui/AGENTS.md` "Portal Extension" section to document the new prop.

### Mobile Strategy

The default mobile pattern is **Home + Ellipsis + Current** (Option B from the design discussion):

| Breakpoint | Behavior |
|---|---|
| `< md` (640px and below) | `<BreadcrumbList>` shows only: first crumb (`<BreadcrumbLink icon={<Home />}>` — icon-only when no label, label-only when no icon, both when both), `<BreadcrumbEllipsis>` collapsing every middle crumb into a popover, last crumb (`<BreadcrumbPage>` with `truncate max-w-[60vw]`). Separators between the 3 visible elements use the configured divider. If the path has only 2 crumbs total (e.g. `Dashboard / List`), the ellipsis is omitted. |
| `md` and above (768px+) | Full path visible, no ellipsis. iPad portrait (768px) and landscape (1024px) get the desktop treatment because they are typical admin contexts. |

**`<BreadcrumbEllipsis>` interaction**:
- Trigger: button rendering `<MoreHorizontal>` icon (`size-5 text-muted-foreground hover:text-foreground`).
- Click/tap opens a `<Popover>` (`@open-mercato/ui/primitives/popover`) listing the hidden middle crumbs as `<BreadcrumbLink>` items, in order, each navigable to its `href`.
- Keyboard: trigger is a `<button>` so it inherits Tab/Enter focus + activation. Popover content uses the existing primitive's keyboard contract.
- Aria: trigger has `aria-label="Show {n} more navigation steps"` (i18n key `breadcrumbs.ellipsis.aria`); popover has `role="menu"`.

**Implementation in `<BreadcrumbList>`**:

The list component computes visible/hidden split based on its children count and the active viewport (a `useViewport` or media-query hook — verify whether the project already has one; if not, use `matchMedia('(min-width: 768px)')` with SSR-safe default = "show all"). On `< md`, children at indexes `[1 .. length-2]` collapse into a single `<BreadcrumbEllipsis items={hidden}>` slot. On `md+` everything renders inline.

**Tenant-level override (Step 4)**: admins can override the mobile strategy globally per tenant via a new `mobileBehavior` setting:

| Value | Effect on `< md` |
|---|---|
| `ellipsis` (default) | Home + ellipsis + current — the recommended UX |
| `current-only` | Last crumb only (current `AppShell.tsx:1186-1219` behavior, kept as a fallback) |
| `back-link` | Renders a single `← {parent label}` link instead of the breadcrumb list (native iOS/Android-style back affordance). Implemented as an alternate render branch in `<Breadcrumb>` when `mobileBehavior === 'back-link'` and the path has ≥ 2 crumbs |

`md+` rendering is unaffected by `mobileBehavior` — full path is always shown above 768px.

**Mobile drawer interaction risk**: `<BreadcrumbEllipsis>` popover must escape the mobile drawer's stacking context if breadcrumbs ever render inside the drawer (today they don't; topbar lives outside the drawer). Step 1 unit test asserts the popover renders into the document portal, not inside the breadcrumb DOM subtree. Risk row updated below.

### Step 6 — Deferred follow-ups (NOT in this PR)

- **Dropdown crumb** (Figma Block 4) — for the rare case where a mid-crumb has multiple sibling alternatives (e.g. switching between sales documents in a pipeline). Adds `<BreadcrumbDropdown>` sub-component that wraps `<Popover>` and a chevron.
- **Last-as-Link-Button** (Figma Block 2) — alternate styling where the current crumb is rendered as a CTA button. Skip until a use case appears (FormHeader already has Actions menu for detail pages).
- **Breadcrumb injection spot** — `breadcrumb:trail` injection so modules can decorate crumbs with status badges, counts, etc.
- **Cmd+K integration** — ARIA-marked breadcrumb list as a Cmd+K palette source ("jump to {section}").

---

## Data Models

Step 4 adds a tenant-level preference shape:

```ts
type BreadcrumbsTenantPreferences = {
  divider: 'arrow' | 'slash' | 'dot'                  // default 'slash'
  firstHomeIcon: boolean                              // default true
  itemRendering: 'text' | 'icon' | 'both'             // default 'text' (with first-icon override)
  maxVisible: number                                  // default 5; range 3..10
  mobileBehavior: 'ellipsis' | 'current-only' | 'back-link' // default 'ellipsis'
}
```

No new tables required if `tenant_preferences` already has a generic JSON column (verify during implementation; otherwise create a small `tenant_breadcrumb_preferences` table). No `organization_id` scoping initially — it's a tenant-wide UX preference.

Steps 1–3 require no data model changes.

Step 5 (Portal) requires no data model changes; portal-side breadcrumb config can reuse the backend tenant preferences.

---

## API Contracts

Steps 1, 2, 3, 5 — no API changes.

Step 4 introduces:

- `GET /api/auth/preferences/breadcrumbs` — returns the resolved `BreadcrumbsTenantPreferences` for the current tenant. Falls back to factory defaults when none stored.
- `PUT /api/auth/preferences/breadcrumbs` — accepts a partial `BreadcrumbsTenantPreferences`, merges into stored settings, returns the merged value. Gated by the same feature as the Settings page itself (`breadcrumbs.manage` or `auth.sidebar.manage`).
- Both endpoints integrate with the existing `BackendChromePayload` so chrome data fetched at hydration includes `breadcrumbConfig`. No new SSE channels or events.

---

## Migration & Backward Compatibility

| Surface | Step | Change | BC |
|---|---|---|---|
| `<ApplyBreadcrumb>` API | 1 | Unchanged signature, internally renders new primitive | ✅ |
| `AppShellProps.breadcrumb` shape | 1 | Unchanged at the type level until Step 3 in the same PR | ✅ |
| `PageMetadata.breadcrumb` entry shape | 3 | `labelKey` becomes required; `label` becomes the fallback | ⚠️ Breaking for third-party modules that ship `label` only — covered by codemod + AGENTS.md update + RELEASE_NOTES |
| `BackendChromePayload` | 4 | Adds optional `breadcrumbConfig` field | ✅ Additive |
| `PortalShellProps.breadcrumb` | 5 | New optional prop, no callers required | ✅ Additive |
| Visual rendering | 1 | Identical to today + hover underline (Figma spec) + ellipsis on `< md` | ⚠️ Mobile rendering visibly changes (per spec); flagged in test plan |

**Step 3 deprecation protocol**: because all five steps land atomically in one PR, every internal call site (every `page.meta.ts` covered in Step 2) is updated in the same diff and the project compiles cleanly. The breaking change therefore only affects **third-party modules outside the monorepo**. We ship:

- Codemod under `scripts/codemods/breadcrumb-labelkey/` that auto-adds `labelKey` derived from `label` slug for any external `page.meta.ts`.
- RELEASE_NOTES.md entry calling out the type change and pointing at the codemod.
- A one-minor-version runtime bridge: at runtime, `breadcrumb` entries missing `labelKey` log a single `console.warn` with the offending href and continue using `label` as both the key and the displayed text. The warning is removed in the next minor release.

---

## Integration Test Coverage

| Test | Source step | Type |
|---|---|---|
| Renders main + section sidebars side-by-side (existing) | n/a | already passing — should not regress |
| `Breadcrumb` primitive — render order, separator types, `aria-current` | 1 | unit (`packages/ui/src/primitives/__tests__/breadcrumb.test.tsx`) |
| Mobile ellipsis — middle items collapsed at `< md`, popover lists hidden items | 1 | unit (`breadcrumb.test.tsx` with `matchMedia` mock) |
| `AppShell` breadcrumb refactor — Dashboard auto-root + dedup, `<ApplyBreadcrumb>` override, hover underline visible | 1 | unit (`AppShell.test.tsx` extension) |
| Coverage sweep — every detail/edit page renders a non-empty breadcrumb | 2 | new integration spec `TC-NAV-001 backend breadcrumb coverage` (visits N representative routes, asserts > 1 crumb in DOM) |
| Schema enforcement — TypeScript build catches a stripped `labelKey` | 3 | typecheck CI gate (no extra spec) + a `tsc --noEmit` snapshot test asserting the type rejects `{ label }`-only entries |
| Settings page — submit form, hydrate chrome, breadcrumb reflects new divider/mobileBehavior | 4 | integration spec `TC-NAV-002 breadcrumb settings configuration` |
| Portal breadcrumb — `PortalShell` renders breadcrumb when prop supplied | 5 | unit + minimal integration |

CI inheritance: existing matrix runs `AppShell` on every backend page, so any rendering regression in Step 1 gets caught indirectly through the full ephemeral suite.

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Visual regression because `text-text-disabled` separators are lighter than current `text-muted-foreground` | Medium | every backend page header | Side-by-side screenshot review with Figma examples before merging | Subjective DS judgment — if Piotr/UX disagrees with the Figma spec we adjust the token, not the primitive |
| Single-PR scope is large (~150 files: primitive + ~134 page.meta.ts + Settings + Portal) — merge conflicts with concurrent feature work likely | High | every backend module + portal | Single short-lived branch; rebase against `develop` immediately before merge; commits are split per logical step inside the PR so a reviewer can review them sequentially; CI runs full ephemeral suite to catch any regression introduced by mechanical edits | Manual conflict resolution likely on `page.meta.ts` files; mitigated by trivial nature of those edits |
| Step 3 breaking change for third-party modules shipping `label`-only breadcrumbs | High | downstream consumers | 1-minor runtime bridge (console warn + fallback to `label`-as-key), codemod, RELEASE_NOTES; internal monorepo is fully covered by Step 2's sweep so no internal call site breaks | Some downstream modules may take a release cycle to migrate — acceptable |
| Settings page coupling to chrome hydration could regress chrome-bootstrap timing | Medium | `BackendChromeProvider`, every backend page | Lean on the existing `BackendChromePayload` channel — no new round-trip; add unit test for the merged payload shape | None expected; chrome already merges multiple settings sources |
| Portal adoption is opt-in, but if widely used it'll surface latent ARIA bugs (different shell, different routing) | Low | customer-facing portal | Step 5 in this PR introduces only the API + sample pages; tenants opt in by setting breadcrumbs on their portal page metadata | Some portal pages may need their own `labelKey` audit before they can opt in |
| `BreadcrumbEllipsis` collapse interaction conflicts with mobile drawer (popover trapped inside drawer) | Low | mobile only | Validate during Step 4 implementation; use popover `portal` prop to escape stacking context | UX nit, easy to fix in follow-up |
| Settings Page widget (Step 4) accidentally exposes UX flag to non-admin tenants | Medium | tenant config integrity | Page gated by feature `breadcrumbs.manage` (declared in `acl.ts`); RBAC test in spec | None if RBAC plumbing follows the convention |

---

## Final Compliance Report

### DS rules ([`.ai/ds-rules.md`](../ds-rules.md))

- Semantic tokens only: `text-muted-foreground`, `text-foreground`, `text-text-disabled` (existing CSS token in `globals.css`), `hover:text-foreground`, `hover:underline`, `font-medium`, `text-sm`, `leading-5`, `tracking-tight`, `gap-1.5`, `size-5`. No hex literals, no Tailwind status-color shades, no `dark:` overrides.
- No arbitrary value spacing or text sizes (`text-[Npx]`, `p-[Npx]`, `rounded-[Npx]`, `z-[N]`).
- One typography exception: Figma's `letterSpacing: -0.084px` approximates as `tracking-tight`. The 0.06px difference is below the perception threshold; documented.
- Icon library: lucide (`Home`, `ChevronRight`, `MoreHorizontal`) — already a project dep.

### Component MVP compliance

- ARIA: `<nav aria-label="Breadcrumb">`, `<ol>` for ordered list, `aria-current="page"` on the active item, `aria-hidden` on separators and decorative icons.
- Keyboard: links inherit native focusable behavior; `BreadcrumbEllipsis` popover follows the existing `Popover` keyboard contract.
- Reduced motion: hover-underline transitions respect `prefers-reduced-motion` via the existing `transition-colors` utility (no custom animation).

### BC compliance

- Primitive is purely additive — no removed exports.
- Step 1 keeps `AppShell.tsx` public surface (`AppShellProps.breadcrumb`, `<ApplyBreadcrumb>`, `currentTitle`) unchanged.
- Step 3's `labelKey` requirement is the only intentional breaking change — flagged via deprecation protocol per root `AGENTS.md` Backward Compatibility Contract; runtime bridge keeps the next minor compatible while downstream codemod runs.
- No DB schema changes in Steps 1–3 and 5; Step 4 adds an additive JSON preferences key (no migration required if `tenant_preferences` is already a JSON store).

---

## Changelog

- **2026-05-05** — Initial spec. Anchored on Figma DS file [`Breadcrumbs`, node 447-8760](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS---Open-Mercato?node-id=447-8760). **Single atomic PR** with 5 logical implementation steps as separate commits: primitive + AppShell refactor, coverage sweep, schema enforcement, Settings page + tenant config, Portal API. Mobile strategy = Home + Ellipsis + Current (per Piotr/Oliwia decision 2026-05-05). Step 6 deferred (dropdown crumb, Link-button-as-last, injection spots, Cmd+K) — opened only when concrete use cases land.
- **2026-05-14** — Step 1 implemented (primitive + DS docs + AppShell refactor + tests). New: `packages/ui/src/primitives/breadcrumb.tsx`, `packages/ui/src/primitives/__tests__/breadcrumb.test.tsx` (15 tests). Modified: `packages/ui/src/backend/AppShell.tsx` (header breadcrumb refactored to composition), `.ai/ui-components.md`, `packages/ui/AGENTS.md`, `apps/mercato/src/i18n/*.json` (`appShell.breadcrumb.collapsed` in en/pl/de/es). UX decisions during implementation: AppShell uses `divider="arrow"` (not `slash` default); first crumb is icon-only `<Home className="size-4">` with `aria-label`; truncate + native `title` on every link; `BreadcrumbStatic` added for non-clickable middle crumbs; mobile shows `<BreadcrumbEllipsis>` as visible affordance (popover deferred to Step 4). **Steps 2–5 NOT implemented** in this PR — coverage sweep (134 missing pages), schema enforcement (`labelKey` required), Settings page + tenant config, Portal API tracked separately. The topbar UX work that landed in the same PR (sticky topbar, sidebar toggle on divider line, OrgSwitcher Popover, notifications panel rewrite + Sheet primitive, inline search, mobile drawer with section tabs, mobile More menu, notification badge indigo) is documented in [`2026-05-14-topbar-redesign.md`](2026-05-14-topbar-redesign.md).
