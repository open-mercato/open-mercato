# Part 1 — Existing UI Audit

> Comprehensive audit of 160 backend pages, portal, and shared UI library. Scoring rubric at the end.

---

## Audit scope

- **160 backend pages** across **34 modules**
- **Portal pages** (customer-facing: login, signup, dashboard, profile)
- **Frontend pages** (auth login/reset, public quote view)
- **Shared UI library** (`packages/ui/`) — primitives, backend components, portal components
- **Styling system** — Tailwind v4, OKLCH CSS variables, CVA variants

---

## 1.1 Screen architecture and flows

### What to check
- Does every module have a consistent flow: list → create → edit → detail?
- Are page patterns repeatable across modules?
- Are there "orphaned" screens (no navigation leading to them)?

### Control questions
- Does the user always know where they are and how to go back?
- Is the CRUD flow identical in every module?
- Are intermediate states (loading, error, empty) handled on every screen?

### Audit findings

**Consistent patterns (good):**
- **List page pattern**: `<Page>` → `<DataTable>` with filters, search, pagination, row actions — used in 46/160 pages
- **Create page pattern**: `<Page>` → `<CrudForm>` with fields/groups, custom fields, validation — used in ~20 pages
- **Detail page pattern**: `<Page>` → highlights → tabbed sections → editable fields — used in ~10 complex modules (customers, sales, catalog)

**Issues:**
- **104/160 pages (70%) do not use DataTable** — some use custom lists, cards, or raw tables
- **119/150 backend pages (79%) do not handle empty state** — empty tables without any message
- **61/150 pages (41%) have no loading state** — no loading indicator
- Some modules have a full CRUD flow, others have only a list with no ability to create

### Impact on UX
Users encounter inconsistent behavior: in one module an empty list shows a friendly message with a CTA, in another — nothing.

### Impact on consistency
Lack of enforced page patterns leads to every contributor building their screen from scratch.

### Accessibility impact
Missing loading/error states means no screen reader announcements about interface state.

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — define mandatory page patterns

---

## 1.2 Navigation and Information Architecture

### What to check
- Sidebar structure (main / settings / profile)
- Breadcrumbs
- Mobile navigation
- Command palette / quick search

### Audit findings

**Sidebar (good):**
- Three modes: main, settings, profile
- Injection points for modules (`menu:sidebar:main`, `menu:sidebar:settings`)
- Sidebar customization (reorder, rename, hide) with localStorage persistence
- Responsive: collapse to 72px on desktop, drawer 260px on mobile

**Breadcrumbs:**
- No dedicated component — rendered inline in the AppShell header
- `ApplyBreadcrumb` component sets breadcrumb via context
- On mobile, intermediate elements are hidden (`hidden md:inline`)
- Always starts from "Dashboard"

**Issues:**
- No command palette / global search — all navigation relies on the sidebar
- Breadcrumbs implemented as part of AppShell (1650+ lines), not as a reusable component
- Settings path detection based on string prefix matching — fragile approach
- `dangerouslySetInnerHTML` used to render icons from markup string — potential XSS risk

### Profile Dropdown
- Change Password, Notifications, Theme Toggle, Language selector, Sign Out
- Injection point: `menu:topbar:profile-dropdown`

### Impact on UX
No global search / command palette is noticeable with 34 modules — navigation requires many clicks.

### Fix priority: **MEDIUM** (sidebar works well, command palette is missing)

### Include in DS Phase 1: **NO** — sidebar is functional, command palette is a feature, not DS

---

## 1.3 Visual hierarchy

### What to check
- Do page headings have a consistent size and style?
- Is there a clear hierarchy: page title → section title → field label?
- Are actions (CTAs) visually distinguishable?

### Audit findings

**FormHeader — two modes:**
- **Edit mode**: compact header with back link and title
- **Detail mode**: large header with entity type label, subtitle, status badge, Actions dropdown

**Issues:**
- **61 instances of arbitrary text sizes** (`text-[11px]`, `text-[13px]`, `text-[10px]`) instead of the Tailwind scale
- No defined typographic hierarchy — every contributor picks a size by eye
- Portal pages use `text-4xl sm:text-5xl lg:text-6xl` for hero, but backend uses `text-2xl` for page title — no consistency between frontend/backend

### Impact on UX
Inconsistent text sizes make it harder to visually scan the page.

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — typography scale is a foundation

---

## 1.4 Typography

### What to check
- Fonts (family, weights, sizes)
- Line heights
- Letter spacing
- Use of arbitrary values

### Audit findings

**Fonts:**
- **Geist Sans** — primary (sans-serif)
- **Geist Mono** — code/monospace
- Defined as CSS custom properties in globals.css

**Text sizes — usage in codebase:**

| Value | Occurrences | Context |
|-------|-------------|---------|
| `text-[9px]` | 1 | notification badge count |
| `text-[10px]` | 15 | badge small, labels |
| `text-[11px]` | 33 | uppercase labels, captions |
| `text-[12px]` | 2 | role/feature pills |
| `text-[13px]` | 7 | small buttons, links |
| `text-[14px]` | 1 | button overrides |
| `text-[15px]` | 2 | portal header subtitle |
| `text-xs` (12px) | common | general small text |
| `text-sm` (14px) | dominant | default body |
| `text-base` (16px) | frequent | larger body |
| `text-2xl` (24px) | frequent | page titles |
| `text-3xl` (30px) | rare | page subtitles |
| `text-4xl`–`text-6xl` | portal hero | responsive hero |

**Letter spacing:**
- `tracking-tight` — headings
- `tracking-wider` / `tracking-widest` / `tracking-[0.15em]` — uppercase labels (inconsistent with each other)

**Issues:**
- **61 arbitrary text sizes** break the Tailwind scale
- **3 different letter-spacing variants** for uppercase labels
- No defined typographic scale (heading 1-6, body, caption, label, overline)

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — typography scale

---

## 1.5 Color system and semantic colors

### What to check
- Color token system
- Use of semantic colors (error, success, warning, info)
- Hardcoded values vs tokens
- Dark mode support

### Audit findings

**Token system (good):**
- OKLCH color space — modern, perceptually uniform
- CSS custom properties: `--primary`, `--secondary`, `--accent`, `--destructive`, `--muted`, `--card`, `--popover`, `--border`, `--input`, `--ring`
- Sidebar-specific tokens: `--sidebar`, `--sidebar-foreground`, etc.
- Chart colors: 10 named (`--chart-blue`, `--chart-emerald`, etc.)
- Dark mode: full token set, switching via `.dark` class
- `ThemeProvider` with localStorage persistence and OS preference detection

**CRITICAL ISSUE — 372 hardcoded semantic colors:**

| Pattern | Occurrences | Example |
|---------|-------------|---------|
| `text-red-*` | 159 | `text-red-600` (107x), `text-red-800` (26x) |
| `bg-red-*` | 39 | `bg-red-50` (24x), `bg-red-100` (14x) |
| `text-green-*` | 47 | `text-green-800` (26x), `text-green-600` (18x) |
| `bg-green-*` | 31 | `bg-green-100` (26x) |
| `text-blue-*` | 69 | `text-blue-600` (27x), `text-blue-800` (25x) |
| `bg-blue-*` | 47 | `bg-blue-50` (24x), `bg-blue-100` (19x) |
| `text-emerald-*` | 16 | `text-emerald-700` (6x) |
| `bg-emerald-*` | 12 | `bg-emerald-50` (5x) |
| `border-red-*` | ~10 | `border-red-200`, `border-red-500` |

**Where this occurs:**
- Status badges (active/inactive/pending) — hardcoded per-module
- Alert/error banners in auth login (`border-red-200 bg-red-50 text-red-700`)
- Success banners (`border-emerald-200 bg-emerald-50 text-emerald-900`)
- Customer address tiles, sales document statuses, currency statuses

**Problem:**
The system has defined tokens (`--destructive`, `--accent`), but **372 places in the code ignore them** and use direct Tailwind colors. These colors:
- Do not respond to dark mode
- Are not centralized — changing the semantics of "error" requires editing 159 files
- Different shades of red (`red-500`, `red-600`, `red-700`, `red-800`, `red-900`) used interchangeably

### Alert/Notice/Badge comparison:

| Component | Error | Success | Warning | Info |
|-----------|-------|---------|---------|------|
| Alert | `destructive` variant | `border-emerald-600/30 bg-emerald-500/10 text-emerald-900` | `border-amber-500/30 bg-amber-400/10 text-amber-950` | `border-sky-600/30 bg-sky-500/10 text-sky-900` |
| Notice | `border-red-200 bg-red-50 text-red-800` | none | `border-amber-200 bg-amber-50 text-amber-800` | `border-blue-200 bg-blue-50 text-blue-900` |
| FlashMessages | `emerald-600` | `red-600` | `amber-500` | `blue-600` |
| Notifications | `text-destructive` | `text-green-500` | `text-amber-500` | `text-blue-500` |

**4 different components, 4 different palettes for the same semantic states.**

### Fix priority: **CRITICAL**

### Include in DS Phase 1: **YES** — semantic color tokens are the absolute minimum

---

## 1.6 Spacing and Layout

### What to check
- Spacing scale
- Gap/padding/margin consistency
- Grid system
- Layout patterns

### Audit findings

**Spacing — usage distribution:**

| Value | gap | space-y | padding (p-) |
|-------|-----|---------|-------------|
| 0.5 (2px) | 7 | 9 | — |
| 1 (4px) | 101 | 168 | 166 |
| 1.5 (6px) | 29 | 44 | — |
| 2 (8px) | **525** | **268** | **559** |
| 3 (12px) | 207 | 163 | 336 |
| 4 (16px) | 82 | 136 | 250 |
| 5 (20px) | 7 | 4 | — |
| 6 (24px) | 13 | 66 | 69 |
| 8 (32px) | 2 | 15 | — |

**Observations:**
- `gap-2`, `space-y-2`, `p-2` dominate (45%+ usage) — but no documented rationale
- Values of 5 (`gap-5`, `space-y-5`) are nearly unused — suggests the 2-3-4-6-8 scale is "natural" for the project
- Outlier: `py-20`, `p-20` — one-off hacks
- **27 different arbitrary heights** (`h-[50vh]`, `h-[60vh]`, `h-[90vh]`, etc.)
- **20 different arbitrary widths** (`w-[120px]`, `w-[200px]`, `w-[480px]`, etc.)

**Layout patterns:**
- `<Page>` wrapper: `space-y-6`
- `<PageBody>`: `space-y-4`
- Grid: 1-2-3 responsive columns (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`)
- Sidebar: 72px/240px/320px (3 states)
- Dialog: bottom sheet on mobile, centered on desktop

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — spacing scale

---

## 1.7 Forms

### What to check
- Form field consistency
- Validation
- Error display
- Form layout (single column, multi-column, grouped)

### Audit findings

**CrudForm (good):**
- Central form component (1800+ lines)
- Handles: fields, groups, custom fields, Zod validation, server error mapping
- Auto-flash messaging on success/failure
- Keyboard shortcuts: `Cmd/Ctrl+Enter` submit, `Escape` cancel
- Injection: `crud-form:<entityId>:fields`

**Input components:**
- `DatePicker`, `DateTimePicker`, `TimePicker`
- `ComboboxInput` — searchable select with async loading
- `TagsInput` — multi-select tags
- `LookupSelect` — lookup table
- `PhoneNumberField` — phone with formatting
- `SwitchableMarkdownInput` — rich text with markdown toggle

**Issues:**
- No **Form Field wrapper** component (label + input + description + error) as a reusable primitive
- Portal pages build forms manually (`gap-4` between fields, `gap-1.5` within fields) instead of using CrudForm
- Auth login page uses its own form layout with hardcoded styles
- **No consistent Form Field** — label styling differs across modules:
  - Portal: `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70`
  - Backend CrudForm: built-in labels
  - Auth: `<Label>` from primitives

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — FormField wrapper

---

## 1.8 Cards, lists, tables — data presentation

### What to check
- DataTable patterns
- Card patterns
- List patterns
- Detail page sections

### Audit findings

**DataTable (good):**
- Rich component (1000+ lines): sorting, filtering, pagination, row selection, bulk actions, column chooser, export, perspectives, virtual rows
- Extension points: `data-table:<tableId>:columns|:row-actions|:bulk-actions|:filters`
- Used in 46/160 pages

**Card patterns — inconsistent:**
- `packages/ui/src/primitives/card.tsx` — generic Card with CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- `packages/ui/src/portal/components/PortalCard.tsx` — portal-specific `rounded-xl border bg-card p-5 sm:p-6`
- `PortalFeatureCard` — 3-column grid cards with icon
- `PortalStatRow` — statistics in a card
- Settings pages use card-grid for navigation

**Issue — 15+ Section components with a repeating pattern:**

Customers module:
- `TagsSection`, `CustomDataSection`, `ActivitiesSection`, `DetailFieldsSection`, `AddressesSection`, `DealsSection`, `CompanyPeopleSection`, `TasksSection`

Sales module:
- `AdjustmentsSection`, `ShipmentsSection`, `PaymentsSection`, `AddressesSection`, `ItemsSection`, `ReturnsSection`

Each section independently implements: header + content + action + empty state + loading. No shared base component.

### Fix priority: **MEDIUM**

### Include in DS Phase 1: **YES** — Section component, Card component

---

## 1.9 System feedback

### What to check
- Error states
- Success feedback
- Warning messages
- Loading indicators
- Empty states

### Audit findings

**Feedback mechanisms — 4 independent systems:**

| System | Component | Lifetime | Trigger |
|--------|-----------|----------|---------|
| Flash messages | `FlashMessages` | 3s auto-dismiss | Programmatic `flash()` or URL params |
| Notices | `Notice` / `Alert` | Persistent inline | Rendered in JSX |
| Notifications | `NotificationBell` + panel | Persistent, SSE-based | Server events |
| Confirm dialogs | `useConfirmDialog` | Until user action | Programmatic `confirm()` |

**Flash messages (good):**
- 4 variants: success (emerald-600), error (red-600), warning (amber-500), info (blue-600)
- Fixed positioning: top-right desktop, bottom sheet mobile
- 3s auto-dismiss with manual close

**Notice vs Alert — duplication:**
- `Notice`: 3 variants (error, info, warning) — uses hardcoded colors (`border-red-200`, `bg-red-50`)
- `Alert`: 5 variants (default, destructive, success, warning, info) — uses more abstract classes
- **Both components serve the same purpose** — inline messages on a page

**ErrorNotice:**
- Wrapper around `Notice variant="error"`
- Default i18n title and message

**Empty states — weak coverage:**
- `EmptyState` component exists (centered layout, dashed border, muted bg, optional icon + CTA)
- `TabEmptyState` wrapper for tabbed sections
- **But 79% of backend pages do not use any of them**

**Loading states:**
- `LoadingMessage` — spinner + text in a bordered container
- `Spinner` — standalone spinner
- **41% of pages have no loading state**
- Pattern: manually managed `isLoading` state, not wrapped in a shared component

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — unify Notice/Alert, enforce empty/loading states

---

## 1.10 Interaction states

### What to check
- Hover, focus, active, disabled states
- Focus management
- Keyboard navigation

### Audit findings

**Button/IconButton (good):**
- CVA-based variants with hover/focus/disabled states
- Focus ring: `focus-visible:ring-ring/50 focus-visible:ring-[3px]`
- Disabled: `disabled:pointer-events-none disabled:opacity-50`
- 7 Button variants, 2 IconButton variants, 4 sizes each

**CrudForm keyboard shortcuts (good):**
- `Cmd/Ctrl+Enter` — submit
- `Escape` — cancel
- ConfirmDialog: `Enter` confirm, `Escape` cancel

**Issues:**
- Tab navigation is not systematically tested
- Some custom inline editors may not support keyboard navigation
- Focus trapping in modals: Dialog uses Radix (good), but ConfirmDialog uses native `<dialog>` (also ok)

### Fix priority: **MEDIUM**

### Include in DS Phase 1: **NO** — current state is acceptable, can be improved iteratively

---

## 1.11 Accessibility

### What to check
- ARIA attributes
- Semantic HTML
- Color contrast
- Screen reader support
- Keyboard navigation

### Audit findings

**Good practices:**
- `aria-label` on IconButtons (`aria-label="Close"`, `aria-label="Open menu"`)
- `role="alert"` and `aria-live="polite"` on error messages
- Semantic HTML: `<nav>`, `<h1>`-`<h2>`, `<button>`, `<label>`
- Forms: `htmlFor` on labels

**Issues:**
- **370+ interactive elements without aria-label** — mostly icon buttons across various modules
- Some inline SVG icons lack `aria-hidden="true"`
- No skip-to-content link
- Missing focus indicator on some custom components
- OKLCH colors — no automated contrast checking

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — accessibility foundations

---

## 1.12 Responsiveness

### What to check
- Breakpoints
- Mobile-first approach
- Touch targets
- Viewport scaling

### Audit findings

**Breakpoints (consistent):**
- `sm:` (640px), `md:` (768px), `lg:` (1024px), `xl:` (1280px)
- Mobile-first: base styles → modifications for larger screens

**Responsive patterns:**
- Hero: `text-4xl sm:text-5xl lg:text-6xl`
- Grid: `grid-cols-1 sm:grid-cols-3`, `md:grid-cols-2 xl:grid-cols-3`
- Padding: `p-5 sm:p-6`, `px-4 lg:px-8`
- Sidebar: `hidden lg:block` (drawer on mobile)
- Dialog: bottom sheet on mobile, centered on desktop

**Issues:**
- Breadcrumbs hide intermediate elements on mobile — can be confusing
- DataTable on mobile — no special view (horizontal scroll)
- Touch targets — not systematically checked (minimum 44x44px)

### Fix priority: **MEDIUM**

### Include in DS Phase 1: **NO** — current approach is sufficient

---

## 1.13 Content design and microcopy

### What to check
- i18n coverage
- Hardcoded strings
- Error messages
- Empty state copy
- Button labels

### Audit findings

**i18n (good):**
- 10,848 uses of translation keys (`useT()`, `t()`)
- `useT()` hook client-side, `resolveTranslations()` server-side
- Fallback pattern: `t('key', 'Default fallback text')`

**Issues:**
- **Portal frontend pages have hardcoded English text** — signup, login, landing page
- Some component descriptions and error messages do not use i18n
- No guidelines for content tone (formal vs informal, technical vs user-friendly)

### Fix priority: **LOW** (core is well covered)

### Include in DS Phase 1: **NO** — this is content work, not DS

---

## 1.14 UX patterns and component duplication

### What to check
- Are there patterns that repeat across modules but are implemented independently?
- Are there components that do the same thing but differently?

### Audit findings

**Duplications:**

1. **Notice vs Alert** — two components for inline messages, different APIs, different colors
2. **15+ Section components** — each module implements sections independently (header + content + empty + loading)
3. **Icon system** — `lucide-react` (official library) vs custom inline SVG (portal, sales) — different stroke widths (`1.5` vs `2`), different sizing (`size-4` vs `size-5`)
4. **Status badges** — each module defines its own status colors (hardcoded)
5. **Markdown rendering** — the same pseudo-selectors copied across files (`[&_ul]:ml-4 [&_ul]:list-disc ...`)

**Raw fetch vs apiCall:**
- 8 places use raw `fetch()` instead of the `apiCall` wrapper — auth login, auth reset, workflows demo, currency providers

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — Notice/Alert unification, Section component, Icon system

---

## 1.15 Border radius

### What to check
- Border radius usage consistency
- Semantics (when rounded-md vs rounded-lg vs rounded-xl)

### Audit findings

| Value | Occurrences | % |
|-------|-------------|---|
| `rounded-lg` | 279 | 47% |
| `rounded-md` | 222 | 37% |
| `rounded-full` | 104 | 18% |
| `rounded-none` | 25 | 4% |
| `rounded-xl` | 18 | 3% |
| `rounded-sm` | 1 | <1% |

**Tokens defined in globals.css:**
- `--radius: 0.625rem`
- `--radius-sm: calc(var(--radius) - 4px)` = ~0.25rem
- `--radius-md: calc(var(--radius) - 2px)` = ~0.375rem
- `--radius-lg: var(--radius)` = 0.625rem
- `--radius-xl: calc(var(--radius) + 4px)` = ~1.025rem

**Problem:** Tokens exist, but there are no guidelines for when to use which. `rounded-md` and `rounded-lg` are used interchangeably (84% of usage) without semantic distinction. Portal uses `rounded-xl`, auth login uses `rounded-md`, primitives mix them.

### Fix priority: **LOW**

### Include in DS Phase 1: **YES** — document usage guidelines

---

## 1.16 Shadows / Elevation

### What to check
- Shadow usage
- Layering / z-index management

### Audit findings

**Z-index in AppShell:**
- Sidebar: implicit (no explicit z-index, uses DOM order)
- Mobile drawer overlay: `bg-black/40`
- ProgressTopBar: `z-10`
- Flash messages: fixed positioning

**Issues:**
- No defined elevation scale
- No `shadow.*` tokens beyond Tailwind defaults
- Z-index is not centralized — potential conflicts with more overlays

### Fix priority: **LOW**

### Include in DS Phase 1: **YES** — define 3-4 elevation levels

---

## Audit summary — Scoring Rubric

| # | Area | Score (1-5) | Priority | Include in DS MVP |
|---|------|-------------|----------|-------------------|
| 1 | Screen architecture | 3 | High | Yes |
| 2 | Navigation and IA | 4 | Medium | No |
| 3 | Visual hierarchy | 2 | High | Yes |
| 4 | Typography | 2 | High | Yes |
| 5 | Color system and semantics | 2 | **Critical** | Yes |
| 6 | Spacing and layout | 3 | High | Yes |
| 7 | Forms | 3 | High | Yes |
| 8 | Data presentation | 3 | Medium | Yes |
| 9 | System feedback | 2 | High | Yes |
| 10 | Interaction states | 4 | Medium | No |
| 11 | Accessibility | 2 | High | Yes |
| 12 | Responsiveness | 4 | Medium | No |
| 13 | Content design | 4 | Low | No |
| 14 | Component duplication | 2 | High | Yes |
| 15 | Border radius | 3 | Low | Yes (docs) |
| 16 | Shadows / elevation | 3 | Low | Yes (tokens) |

**Scoring scale:**
- 5 = Consistent, documented, well-functioning
- 4 = Mostly consistent, minor gaps
- 3 = Partially consistent, requires standardization
- 2 = Inconsistent, requires immediate work
- 1 = Missing or severely broken

**Priority criteria:**
- **Critical**: Actively hurts UX and blocks consistency (e.g., 372 hardcoded colors)
- **High**: Visible UX impact, easy to fix with DS
- **Medium**: UX impact, but current state is functional
- **Low**: Cosmetic or to be addressed later

**Recommended action sequence after audit:**
1. Semantic color tokens (eliminates 372 hardcoded colors)
2. Typography scale (eliminates 61 arbitrary sizes)
3. Spacing scale documentation
4. Notice/Alert unification
5. FormField wrapper component
6. Section base component
7. Empty/loading state enforcement
8. Icon system standardization
9. Accessibility pass (aria-labels)
10. Border radius / elevation documentation

---

## See also

- [Design Principles](./principles.md) — design principles derived from this audit
- [Foundations](./foundations.md) — tokens and scales addressing the issues found
- [Components](./components.md) — component MVP for standardization
- [Executive Summary](./executive-summary.md) — summary of the most important findings
- [Priority Table](./priority-table.md) — fix priorities
