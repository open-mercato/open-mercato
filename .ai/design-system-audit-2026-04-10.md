# Open Mercato — Design System Audit & Foundation Plan

**Date:** 2026-04-10
**Branch:** develop
**Author:** Claude (commissioned by Product/Design Lead)
**Status:** Working document

---

## Table of contents

- [Part 1 — Audit of existing UI](#part-1--audit-of-existing-ui)
- [Part 2 — Design Principles](#part-2--design-principles)
- [Part 3 — Foundations](#part-3--foundations)
- [Part 4 — Component MVP](#part-4--component-mvp)
- [A. Executive Summary](#a-executive-summary)
- [B. Hackathon plan](#b-hackathon-plan)
- [C. Deliverables](#c-deliverables)
- [D. Priority table](#d-priority-table)

---

# PART 1 — AUDIT OF EXISTING UI

## Audit scope

- **160 backend pages** across **34 modules**
- **Portal pages** (customer-facing: login, signup, dashboard, profile)
- **Frontend pages** (auth login/reset, public quote view)
- **Shared UI library** (`packages/ui/`) — primitives, backend components, portal components
- **Styling system** — Tailwind v4, OKLCH CSS variables, CVA variants

---

## 1.1 Screen architecture and flow

### What to check
- Does every module have a consistent flow: list → create → edit → detail?
- Are page patterns reusable across modules?
- Are there "orphaned" screens (no navigation path to them)?

### Control questions
- Does the user always know where they are and how to go back?
- Is the CRUD flow identical across every module?
- Are intermediate states (loading, error, empty) handled on every screen?

### Audit findings

**Consistent patterns (good):**
- **List page pattern**: `<Page>` → `<DataTable>` with filters, search, pagination, row actions — used on 46/160 pages
- **Create page pattern**: `<Page>` → `<CrudForm>` with fields/groups, custom fields, validation — used on ~20 pages
- **Detail page pattern**: `<Page>` → highlights → tabbed sections → editable fields — used in ~10 complex modules (customers, sales, catalog)

**Problems:**
- **104/160 pages (70%) do not use DataTable** — some use custom lists, cards, or raw tables
- **119/150 backend pages (79%) do not handle empty state** — empty tables with no message
- **61/150 pages (41%) have no loading state** — no loading indicator
- Some modules have a full CRUD flow; others have only a list with no ability to create

### UX impact
Users encounter inconsistent behavior: in one module an empty list displays a friendly message with a CTA; in another — a blank screen.

### Impact on system consistency
The absence of an enforced page pattern causes every contributor to build their screen from scratch.

### Accessibility impact
Missing loading/error states means no screen-reader announcements about interface state.

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
- Responsive: collapses to 72px on desktop, 260px drawer on mobile

**Breadcrumbs:**
- No dedicated component — rendered inline in the AppShell header
- `ApplyBreadcrumb` component sets the breadcrumb via context
- Intermediate items hidden on mobile (`hidden md:inline`)
- Always starts from "Dashboard"

**Problems:**
- No command palette / global search — all navigation relies on the sidebar
- Breadcrumbs implemented as part of AppShell (1650+ lines), not as a reusable component
- Settings path detection based on string prefix matching — fragile solution
- `dangerouslySetInnerHTML` used to render icons from markup strings — potential XSS risk

### Profile Dropdown
- Change Password, Notifications, Theme Toggle, Language selector, Sign Out
- Injection point: `menu:topbar:profile-dropdown`

### UX impact
The absence of global search / command palette is noticeable across 34 modules — navigation requires many clicks.

### Fix priority: **MEDIUM** (sidebar works well; command palette is a feature, not a DS issue)

### Include in DS Phase 1: **NO** — sidebar is functional; command palette is a feature, not DS

---

## 1.3 Visual hierarchy

### What to check
- Do page headings have a consistent size and style?
- Is there a clear hierarchy: page title → section title → field label?
- Are actions (CTAs) visually distinguishable?

### Audit findings

**FormHeader — two modes:**
- **Edit mode**: compact header with a back link and title
- **Detail mode**: large header with entity type label, subtitle, status badge, Actions dropdown

**Problems:**
- **61 uses of arbitrary text sizes** (`text-[11px]`, `text-[13px]`, `text-[10px]`) instead of the Tailwind scale
- No defined typographic hierarchy — each contributor chooses a size by eye
- Portal pages use `text-4xl sm:text-5xl lg:text-6xl` for hero content, while the backend uses `text-2xl` for page titles — no consistency between frontend/backend

### UX impact
Inconsistent text sizes make scanning pages with the eye harder.

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

**Text sizes — usage in the codebase:**

| Value | Occurrences | Context |
|---------|-------------|----------|
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
- `tracking-wider` / `tracking-widest` / `tracking-[0.15em]` — uppercase labels (inconsistent with one another)

**Problems:**
- **61 arbitrary text sizes** break the Tailwind scale
- **3 different letter-spacing variants** for uppercase labels
- No defined typographic scale (heading 1–6, body, caption, label, overline)

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — typography scale

---

## 1.5 Color usage and color semantics

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
- Dark mode: full token set, toggled via `.dark` class
- `ThemeProvider` with localStorage persistence and OS preference detection

**CRITICAL PROBLEM — 372 hardcoded semantic colors:**

| Pattern | Occurrences | Example |
|---------|-------------|---------|
| `text-red-*` | 159 | `text-red-600` (107×), `text-red-800` (26×) |
| `bg-red-*` | 39 | `bg-red-50` (24×), `bg-red-100` (14×) |
| `text-green-*` | 47 | `text-green-800` (26×), `text-green-600` (18×) |
| `bg-green-*` | 31 | `bg-green-100` (26×) |
| `text-blue-*` | 69 | `text-blue-600` (27×), `text-blue-800` (25×) |
| `bg-blue-*` | 47 | `bg-blue-50` (24×), `bg-blue-100` (19×) |
| `text-emerald-*` | 16 | `text-emerald-700` (6×) |
| `bg-emerald-*` | 12 | `bg-emerald-50` (5×) |
| `border-red-*` | ~10 | `border-red-200`, `border-red-500` |

**Where this appears:**
- Status badges (active/inactive/pending) — hardcoded per module
- Alert/error banners in auth login (`border-red-200 bg-red-50 text-red-700`)
- Success banners (`border-emerald-200 bg-emerald-50 text-emerald-900`)
- Customer address tiles, sales document statuses, currency statuses

**Problem:**
The system has defined tokens (`--destructive`, `--accent`), but **372 places in the codebase ignore them** and use direct Tailwind colors. These colors:
- Do not respond to dark mode
- Are not centralized — changing the semantics of "error" requires editing 159 files
- Use different shades of red (`red-500`, `red-600`, `red-700`, `red-800`, `red-900`) interchangeably

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

## 1.6 Spacing and layout

### What to check
- Spacing scale
- Consistency of gap/padding/margin
- Grid system
- Layout patterns

### Audit findings

**Spacing — usage distribution:**

| Value | gap | space-y | padding (p-) |
|---------|-----|---------|-------------|
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
- `gap-2`, `space-y-2`, `p-2` dominate (45%+ of usage) — but there is no documented rationale
- Values of 5 (`gap-5`, `space-y-5`) are almost unused — suggests the 2-3-4-6-8 scale is "natural" for this project
- Outliers: `py-20`, `p-20` — one-off hacks
- **27 different arbitrary heights** (`h-[50vh]`, `h-[60vh]`, `h-[90vh]`, etc.)
- **20 different arbitrary widths** (`w-[120px]`, `w-[200px]`, `w-[480px]`, etc.)

**Layout patterns:**
- `<Page>` wrapper: `space-y-6`
- `<PageBody>`: `space-y-4`
- Grid: 1–2–3 responsive columns (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`)
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
- Auto flash messaging on success/failure
- Keyboard shortcuts: `Cmd/Ctrl+Enter` submit, `Escape` cancel
- Injection: `crud-form:<entityId>:fields`

**Input components:**
- `DatePicker`, `DateTimePicker`, `TimePicker`
- `ComboboxInput` — searchable select with async loading
- `TagsInput` — multi-select tags
- `LookupSelect` — lookup table
- `PhoneNumberField` — phone with formatting
- `SwitchableMarkdownInput` — rich text with markdown toggle

**Problems:**
- No **Form Field wrapper** component (label + input + description + error) as a reusable primitive
- Portal pages build forms manually (`gap-4` between fields, `gap-1.5` inside fields) instead of using CrudForm
- Auth login page uses its own form layout with hardcoded styles
- **No consistent Form Field** — label styling differs between modules:
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
- Used on 46/160 pages

**Card patterns — inconsistent:**
- `packages/ui/src/primitives/card.tsx` — generic Card with CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- `packages/ui/src/portal/components/PortalCard.tsx` — portal-specific `rounded-xl border bg-card p-5 sm:p-6`
- `PortalFeatureCard` — 3-column grid cards with icon
- `PortalStatRow` — statistics inside a card
- Settings pages use a card-grid for navigation

**Problem — 15+ Section components with a repeated pattern:**

Customers module:
- `TagsSection`, `CustomDataSection`, `ActivitiesSection`, `DetailFieldsSection`, `AddressesSection`, `DealsSection`, `CompanyPeopleSection`, `TasksSection`

Sales module:
- `AdjustmentsSection`, `ShipmentsSection`, `PaymentsSection`, `AddressesSection`, `ItemsSection`, `ReturnsSection`

Each section independently implements: header + content + action + empty state + loading. No shared base component exists.

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
|--------|-----------|-----------|---------|
| Flash messages | `FlashMessages` | 3s auto-dismiss | Programmatic `flash()` or URL params |
| Notices | `Notice` / `Alert` | Persistent inline | Rendered in JSX |
| Notifications | `NotificationBell` + panel | Persistent, SSE-based | Server events |
| Confirm dialogs | `useConfirmDialog` | Until user action | Programmatic `confirm()` |

**Flash messages (good):**
- 4 variants: success (emerald-600), error (red-600), warning (amber-500), info (blue-600)
- Fixed positioning: top-right on desktop, bottom sheet on mobile
- 3s auto-dismiss with manual close

**Notice vs Alert — duplication:**
- `Notice`: 3 variants (error, info, warning) — uses hardcoded colors (`border-red-200`, `bg-red-50`)
- `Alert`: 5 variants (default, destructive, success, warning, info) — uses more abstract classes
- **Both components serve the same purpose** — inline messages on the page

**ErrorNotice:**
- Wrapper around `Notice variant="error"`
- Default i18n title and message

**Empty states — poor coverage:**
- `EmptyState` component exists (centered layout, dashed border, muted bg, optional icon + CTA)
- `TabEmptyState` wrapper for sections inside tabs
- **But 79% of backend pages use neither of them**

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

**Problems:**
- Tab navigation is not tested systematically
- Some custom inline editors may not support keyboard navigation
- Focus trapping in modals: Dialog uses Radix (good), ConfirmDialog uses native `<dialog>` (also acceptable)

### Fix priority: **MEDIUM**

### Include in DS Phase 1: **NO** — current state is acceptable; can be improved iteratively

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
- Semantic HTML: `<nav>`, `<h1>`–`<h2>`, `<button>`, `<label>`
- Forms: `htmlFor` on labels

**Problems:**
- **370+ interactive elements without aria-label** — mainly icon buttons across various modules
- Some inline SVG icons lack `aria-hidden="true"`
- No skip-to-content link
- No focus indicator on some custom components
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

**Problems:**
- Breadcrumbs hide intermediate items on mobile — may be confusing
- DataTable on mobile — no specialized view (horizontal scroll only)
- Touch targets — not checked systematically (minimum 44×44px)

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

**Problems:**
- **Portal frontend pages have hardcoded English text** — signup, login, landing page
- Some component descriptions and error messages do not use i18n
- No guidelines for content tone (formal vs informal, technical vs user-friendly)

### Fix priority: **LOW** (core coverage is good)

### Include in DS Phase 1: **NO** — this is content work, not DS

---

## 1.14 UX patterns and component duplication

### What to check
- Are there patterns that repeat across modules but are implemented independently?
- Are there components that do the same thing differently?

### Audit findings

**Duplications:**

1. **Notice vs Alert** — two components for inline messages, different APIs, different colors
2. **15+ Section components** — every module implements sections independently (header + content + empty + loading)
3. **Icon system** — `lucide-react` (official library) vs custom inline SVG (portal, sales) — different stroke widths (`1.5` vs `2`), different sizing (`size-4` vs `size-5`)
4. **Status badges** — every module defines its own status colors (hardcoded)
5. **Markdown rendering** — the same pseudo-selectors copied between files (`[&_ul]:ml-4 [&_ul]:list-disc ...`)

**Raw fetch vs apiCall:**
- 8 places use raw `fetch()` instead of the `apiCall` wrapper — auth login, auth reset, workflows demo, currency providers

### Fix priority: **HIGH**

### Include in DS Phase 1: **YES** — Notice/Alert unification, Section component, Icon system

---

## 1.15 Border radius

### What to check
- Consistency of border-radius usage
- Semantics (when to use rounded-md vs rounded-lg vs rounded-xl)

### Audit findings

| Value | Occurrences | % |
|---------|-------------|---|
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

**Problem:** Tokens exist, but there are no guidelines for when to use which. `rounded-md` and `rounded-lg` are used interchangeably (84% of usage) with no semantic distinction. The portal uses `rounded-xl`, auth login uses `rounded-md`, and primitives mix both.

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

**Problems:**
- No defined elevation scale
- No `shadow.*` tokens beyond Tailwind defaults
- z-index is not centralized — potential conflicts with larger numbers of overlays

### Fix priority: **LOW**

### Include in DS Phase 1: **YES** — define 3–4 elevation levels

---

## Audit summary — Scoring Rubric

| # | Area | Score (1–5) | Priority | In DS MVP |
|---|--------|-------------|-----------|-----------|
| 1 | Screen architecture | 3 | High | Yes |
| 2 | Navigation and IA | 4 | Medium | No |
| 3 | Visual hierarchy | 2 | High | Yes |
| 4 | Typography | 2 | High | Yes |
| 5 | Color usage and semantics | 2 | **Critical** | Yes |
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

**Score scale:**
- 5 = Consistent, documented, well-functioning
- 4 = Mostly consistent, minor gaps
- 3 = Partially consistent, requires standardization
- 2 = Inconsistent, requires immediate work
- 1 = Missing or severely broken

**Priority criteria:**
- **Critical**: Actively damages UX and blocks consistency (e.g. 372 hardcoded colors)
- **High**: Visible UX impact, easy to fix with DS
- **Medium**: UX impact, but current state is functional
- **Low**: Cosmetic or can be addressed later

**Recommended action order after audit:**
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

# PART 2 — DESIGN PRINCIPLES

## Proposed Design Principles for Open Mercato

### Principle 1: Clarity Over Cleverness

**Definition:** Every interface element should be obvious in its purpose. Zero magic, zero hidden behavior.

**Elaboration:** In an open-source project, contributors have varying levels of experience. The interface must be understandable to both the end user and the developer reading the code. If you need to explain what a component does — it is too complex.

**Why it matters in OSS:** New contributors must understand UI patterns without mentoring. Clear patterns reduce onboarding time.

**Decisions it supports:**
- Explicit props over magic defaults
- Descriptive naming over abbreviations
- Visible state over hidden state
- Documentation of "why" not just "how"

**Good example:** `<EmptyState title="No customers yet" description="Create your first customer" action={{ label: "Add customer", onClick: handleCreate }} />` — every behavior visible in props.

**Violation:** A component that changes its behavior depending on the parent context, with no visible prop.

**Impact on contributor:** Can build UI without studying internals.
**Impact on UX:** The user always knows what is happening and why.
**Impact on consistency:** Explicit patterns are easier to replicate.

---

### Principle 2: Consistency Is a Feature

**Definition:** The same problems are solved the same way. Always.

**Elaboration:** Consistency is not a constraint — it is a product. A user learns patterns once and applies them everywhere. A contributor builds a new module faster because the patterns are familiar.

**Why it matters in OSS:** 34 modules, many contributors. Without consistency every module looks like a separate application.

**Decisions it supports:**
- Use an existing component instead of creating a new one
- Apply the same spacing, colors, and typography tokens
- The same CRUD flow in every module
- The same error/success pattern everywhere

**Good example:** Every list of users, products, and orders looks and behaves identically — DataTable with the same filters, actions, and pagination.

**Violation:** Portal signup page with a manually built form that has different spacing and labels than the rest of the system.

**Impact on contributor:** Fewer decisions = faster building.
**Impact on UX:** The user feels "at home" in every module.
**Impact on consistency:** Eliminates design debt before it accumulates.

---

### Principle 3: Accessible by Default

**Definition:** Accessibility is not an add-on or a checklist item. It is built into every component from the start.

**Elaboration:** A component without an aria-label is not "almost done" — it is incomplete. The DS must guarantee that by using components from the system, a contributor automatically delivers accessible UI.

**Why it matters in OSS:** Contributors with varying a11y awareness contribute to the project. The system must enforce good practices.

**Decisions it supports:**
- Required `aria-label` on IconButton (enforced via TypeScript)
- Semantic HTML as default (not `<div>` with onClick)
- Focus management in every interactive component
- Color contrast checked at the token level
- Keyboard navigation as part of the definition of "done"

**Good example:** `<IconButton aria-label="Delete customer">` — TypeScript error if aria-label is missing.

**Violation:** 370+ interactive elements without aria-label in the current codebase.

**Impact on contributor:** Does not need to remember a11y — the system enforces it.
**Impact on UX:** The product is usable by everyone.
**Impact on consistency:** Accessibility rules are part of the design system contract.

---

### Principle 4: Reuse Over Reinvention

**Definition:** Do not build what already exists. Extend existing components instead of creating new ones.

**Elaboration:** Every new component has a maintenance cost. In OSS this cost is distributed across many maintainers. Fewer components means easier maintenance, testing, and documentation.

**Why it matters in OSS:** Duplication is a natural effect of decentralized contribution. 15+ Section components in Open Mercato are proof.

**Decisions it supports:**
- Check existing components before building a new one
- Use composition (children, slots) instead of creating variants
- One Alert component instead of Notice + Alert + ErrorNotice
- One way to display statuses instead of hardcoded colors per module

**Good example:** Using `<DataTable>` with customization instead of building a custom list.

**Violation:** `Notice` and `Alert` — two components doing the same thing with different APIs and colors.

**Impact on contributor:** Less to learn, less to maintain.
**Impact on UX:** Consistent feedback behavior.
**Impact on consistency:** Reduces the surface area of the system.

---

### Principle 5: Predictable Behavior

**Definition:** Users should be able to predict UI behavior before they click. No surprises.

**Elaboration:** If a "Delete" button in one module shows a confirmation dialog, it must do so in every module. If `Escape` closes a form, it must close every form.

**Why it matters in OSS:** Different contributors may implement the same pattern differently. The system must guarantee consistent behavior.

**Decisions it supports:**
- Destructive actions always require confirmation
- Keyboard shortcuts are global and consistent
- Loading states are always visible
- Error messages always appear in the same location

**Good example:** `Cmd/Ctrl+Enter` submit in every form, `Escape` cancel — unified through CrudForm.

**Violation:** Auth login form that does not handle `Escape` to cancel.

**Impact on contributor:** Clear rules = fewer edge cases to handle.
**Impact on UX:** Users build muscle memory.
**Impact on consistency:** Behaviors are part of the system, not part of the module.

---

### Principle 6: System Thinking

**Definition:** Every component is part of a larger system. Do not design in isolation.

**Elaboration:** Changing a button's color affects contrast against the background, text legibility, dark mode, and alert states. Changing the spacing of one component affects the layout of the entire page. Consider dependencies.

**Why it matters in OSS:** A contributor sees their PR, not the whole system. The design system must enforce systemic thinking.

**Decisions it supports:**
- Use tokens instead of hardcoded values
- Test changes in the context of the full page, not just the component
- Understand dependencies between components
- Document side effects of changes

**Good example:** Changing the `--destructive` color token automatically updates all error states across the system.

**Violation:** 372 hardcoded colors — changing the semantics of "error" requires editing 159 files.

**Impact on contributor:** A change in one place propagates correctly.
**Impact on UX:** A consistent system with no "holes".
**Impact on consistency:** The system is self-reinforcing.

---

### Principle 7: Progressive Disclosure

**Definition:** Show only what is needed now. The rest is available on demand.

**Elaboration:** A form with 30 fields is overwhelming. A table with 20 columns is unreadable. Show the minimum; let the user reveal more when needed.

**Why it matters in OSS:** New contributors add fields "just in case". The system must encourage minimalism.

**Decisions it supports:**
- Default column set in DataTable (5–7 columns), rest in the column chooser
- Grouped form fields with collapsible sections
- Summary view → detail view pattern
- Advanced filters hidden behind a "More filters" trigger

**Good example:** DataTable with column chooser — 5 columns by default; the user adds more.

**Violation:** A form with 20 visible fields and no grouping.

**Impact on contributor:** Clear guidelines for how many fields/columns is "too many".
**Impact on UX:** Lower cognitive load.
**Impact on consistency:** All lists and forms have a similar information density.

---

### Principle 8: Contribution-Friendly Design

**Definition:** The design system must be easy to use correctly and hard to use incorrectly.

**Elaboration:** A contributor should be able to build a consistent screen using 5–10 components without reading 100 pages of documentation. TypeScript should catch errors before they reach PR review.

**Why it matters in OSS:** A design system for a closed team can rely on tribal knowledge. OSS must be self-documenting.

**Decisions it supports:**
- Simple component APIs (few required props, sensible defaults)
- TypeScript enforcement (required aria-label, required variant)
- Component templates instead of building from scratch
- Good error messages in dev mode
- Reference example (customers module)

**Good example:** `<CrudForm fields={[...]} onSubmit={fn} />` — the contributor supplies fields and a submit handler; the rest is automatic.

**Violation:** A component with 25 props, 15 of which are required.

**Impact on contributor:** Fast start, hard to make mistakes.
**Impact on UX:** Every contributor delivers similar-quality UI.
**Impact on consistency:** The system enforces good practices instead of relying on them.

---

## Condensed principles (for README)

```
## Design Principles

1. **Clarity Over Cleverness** — Every UI element should be obvious in purpose
2. **Consistency Is a Feature** — Same problems, same solutions, always
3. **Accessible by Default** — A11y is built-in, not bolted-on
4. **Reuse Over Reinvention** — Extend existing components, don't create new ones
5. **Predictable Behavior** — Users should predict UI behavior before clicking
6. **System Thinking** — Every component is part of a larger system
7. **Progressive Disclosure** — Show what's needed now, reveal more on demand
8. **Contribution-Friendly** — Easy to use correctly, hard to use wrong
```

## Design Review / PR Review Checklist (based on principles)

### Clarity
- [ ] Does the component have an obvious purpose without reading documentation?
- [ ] Are prop names descriptive and unambiguous?
- [ ] Are states (loading, error, empty) explicitly handled?

### Consistency
- [ ] Were existing tokens (colors, spacing, typography) used?
- [ ] Is the CRUD flow identical to that of other modules?
- [ ] Does error/success feedback use the same components?
- [ ] Is spacing consistent with the system scale?

### Accessibility
- [ ] Does every interactive element have an aria-label or visible label?
- [ ] Is semantic HTML used (button, nav, heading)?
- [ ] Is the component keyboard-navigable?
- [ ] Is the contrast ratio sufficient?

### Reuse
- [ ] Were existing components checked before building a new one?
- [ ] Has the logic of another component been duplicated?
- [ ] Was composition used instead of a new variant?

### Predictability
- [ ] Do destructive actions have a confirmation dialog?
- [ ] Are keyboard shortcuts consistent with the rest of the system?
- [ ] Does the user know what will happen after clicking?

### System Thinking
- [ ] Were design tokens used instead of hardcoded values?
- [ ] Does the change work correctly in dark mode?
- [ ] Does the component work correctly in different contexts (modal, page, sidebar)?

### Progressive Disclosure
- [ ] Does the form have no more than 7–10 visible fields?
- [ ] Does the table have no more than 7 default columns?
- [ ] Are advanced options hidden behind a trigger?

### Contribution-Friendly
- [ ] Can a new contributor use the component without mentoring?
- [ ] Does TypeScript catch common mistakes?
- [ ] Does a usage example exist (in the customers module or Storybook)?

---

# PART 3 — FOUNDATIONS

## 3.1 Color System

### What it covers
A complete color system covering: palette, semantic tokens, status colors, surface colors, interactive colors, chart colors.

### Why it is needed
Eliminates 372 hardcoded colors. Enables dark mode. Centralizes color decisions.

### Decisions to make
- Retain OKLCH? (YES — already implemented, modern, good)
- How many status colors? (4: error, success, warning, info)
- Add a "neutral" status? (e.g. draft, archived)
- How to map to Tailwind utilities?

### Architectural decision: Flat tokens, NOT opacity-based

**Use flat tokens** — a separate CSS custom property per role (bg, text, border, icon) with a full color value. Every token has a separate value for light and dark mode.

```
YES:  --status-error-bg: oklch(0.965 0.015 25);     /* full value, controlled contrast */
      .dark { --status-error-bg: oklch(0.220 0.025 25); }

NO:   --status-error: oklch(0.577 0.245 27);         /* single base color */
      bg-status-error/5                                /* opacity in Tailwind */
```

**Why:** Opacity-based tokens (`bg-status-error/5`) do not control contrast in dark mode. `oklch(0.577 0.245 27) / 5%` on a white background produces a subtle pink, but on a black background it is nearly invisible. Flat tokens give full control over contrast in both modes.

**Naming convention:**
- CSS variable: `--status-{status}-{role}` e.g. `--status-error-bg`
- Tailwind class: `{property}-status-{status}-{role}` e.g. `bg-status-error-bg`, `text-status-error-text`
- Tailwind mapping: `--color-status-{status}-{role}: var(--status-{status}-{role})`

### Current state
Good: `--primary`, `--secondary`, `--destructive`, `--muted`, `--accent`, `--card`, `--popover`, `--border`, chart colors.
Missing: semantic status tokens, surface hierarchy, interactive state tokens.

### Tokens to define

```
// Primitive palette (already exists in OKLCH)
color.primary.DEFAULT / foreground
color.secondary.DEFAULT / foreground
color.destructive.DEFAULT / foreground
color.muted.DEFAULT / foreground
color.accent.DEFAULT / foreground

// Semantic status (MISSING — critical)
color.status.error.bg / text / border / icon
color.status.success.bg / text / border / icon
color.status.warning.bg / text / border / icon
color.status.info.bg / text / border / icon
color.status.neutral.bg / text / border / icon

// Surface hierarchy (partially exists)
color.surface.page          // --background
color.surface.card          // --card
color.surface.popover       // --popover
color.surface.sidebar       // --sidebar
color.surface.overlay       // bg-black/50

// Interactive (partially in CVA)
color.interactive.focus      // --ring
```
color.interactive.disabled   // opacity-50

// Border
color.border.default         // --border
color.border.input           // --input
color.border.focus           // --ring
```

### Errors without this layer
- 372 hardcoded colors — every contributor "guesses" which color to use
- Dark mode broken for semantic colors
- Changing the palette requires grep+replace across the entire codebase

### MVP: **YES** — semantic status tokens (eliminates 80% of the problem)
### Later: palette refinement, surface hierarchy documentation

---

## 3.2 Typography

### What it covers
Font family, size scale, weight scale, line height, letter spacing, text style tokens.

### Why it is needed
Eliminates 61 arbitrary text sizes. Provides a clear visual hierarchy.

### Decisions to make
- How many heading levels? (4–6)
- How many body sizes? (2–3: default, small, large)
- What special styles? (caption, label, overline, code)
- Keep Geist Sans/Mono? (YES — already implemented)

### Tokens to define

```
// Font family (exists)
font.sans           // Geist Sans
font.mono           // Geist Mono

// Size scale (mapping to Tailwind)
text.display        // text-4xl (36px) — hero, landing
text.heading.1      // text-2xl (24px) — page titles
text.heading.2      // text-xl (20px) — section titles
text.heading.3      // text-lg (18px) — subsections
text.heading.4      // text-base font-semibold (16px) — card titles
text.body.default   // text-sm (14px) — primary body
text.body.large     // text-base (16px) — emphasized body
text.caption        // text-xs (12px) — secondary info
text.label          // text-xs font-medium uppercase tracking-wider — form labels, overlines
text.overline       // text-[11px] font-semibold uppercase tracking-wider — section labels (alias for existing pattern)
text.code           // text-sm font-mono — code blocks

// Weight
font.weight.regular    // 400
font.weight.medium     // 500
font.weight.semibold   // 600
font.weight.bold       // 700

// Line height
leading.tight       // 1.25 — headings
leading.normal      // 1.5 — body
leading.relaxed     // 1.75 — long text

// Letter spacing
tracking.tight      // -0.01em — headings
tracking.normal     // 0 — body
tracking.wide       // 0.05em — labels, overlines
```

### Errors without this layer
- `text-[11px]` vs `text-xs` vs `text-[12px]` — 3 ways to express "small text"
- 3 different letter-spacing variants for uppercase labels
- No hierarchy = every contributor picks a size by eye

### MVP: **YES** — size scale + text style tokens
### Later: line height fine-tuning, responsive typography

---

## 3.3 Spacing Scale

### What it covers
Spacing grid, gap/padding/margin scale, breakpoints.

### Why it is needed
Standardizes spacing. Eliminates "why gap-3 here but gap-4 there?".

### Decisions to make
- What base? (4px = Tailwind default)
- Which values are "official"?
- How to document "which spacing when"?

### Tokens to define

```
// Spacing scale (Tailwind defaults, but with naming)
space.0      // 0px
space.0.5    // 2px — micro spacing (icon-to-text)
space.1      // 4px — tight spacing (between related elements)
space.1.5    // 6px — between form label and input
space.2      // 8px — default gap between related items
space.3      // 12px — gap between form fields
space.4      // 16px — gap between sections
space.6      // 24px — page section spacing
space.8      // 32px — major section breaks

// Semantic spacing (aliases)
space.inline.xs     // space.1 — tight inline gap
space.inline.sm     // space.2 — default inline gap
space.inline.md     // space.3 — comfortable inline gap
space.stack.xs      // space.1 — tight vertical gap
space.stack.sm      // space.2 — default vertical gap
space.stack.md      // space.3 — form field gap
space.stack.lg      // space.4 — section gap
space.stack.xl      // space.6 — page section gap
space.inset.sm      // space.2 — compact padding
space.inset.md      // space.3 — default padding
space.inset.lg      // space.4 — comfortable padding
space.inset.xl      // space.6 — spacious padding

// Page layout
space.page.gutter    // space.6 (Page component: space-y-6)
space.page.body      // space.4 (PageBody component: space-y-4)
space.page.section   // space.4
```

### Usage guidelines
- `gap-2` (8px): default gap between related elements (buttons, badges, inline items)
- `gap-3` (12px): gap between form fields
- `gap-4` (16px): gap between sections on the page
- `gap-6` (24px): gap between major page sections
- **DO NOT use** `gap-5`, `gap-7` — these values are not in the official scale

### MVP: **YES** — usage guidelines document + lint rules
### Later: semantic spacing tokens as CSS variables

---

## 3.4 Border Radius

### What it covers
Corner radius values for different contexts.

### Tokens to define

```
// Already exist in globals.css:
radius.sm      // 0.25rem — small inputs, tags
radius.md      // 0.375rem — buttons, inputs, badges
radius.lg      // 0.625rem — cards, alerts, containers
radius.xl      // 1.025rem — modals, portal cards
radius.full    // 9999px — avatars, pills, circular buttons
radius.none    // 0 — tables, embedded elements
```

### Usage guidelines
- `rounded-sm`: tags, small tokens
- `rounded-md`: buttons, inputs, badges, small elements
- `rounded-lg`: cards, alerts, containers
- `rounded-xl`: modals, portal cards, large containers
- `rounded-full`: avatars, pills, status dots
- `rounded-none`: tables, elements embedded in a container

### MVP: **YES** — documentation only (tokens already exist)
### Later: enforcement via lint

---

## 3.5 Borders

### What it covers
Thickness, style, border colors.

### Tokens to define

```
border.width.default    // 1px
border.width.thick      // 2px — focus ring, active tab
border.color.default    // --border
border.color.input      // --input
border.color.focus      // --ring
border.color.error      // color.status.error.border
border.color.success    // color.status.success.border
border.style.default    // solid
border.style.dashed     // dashed — empty states, drop zones
```

### MVP: **YES** — as part of color tokens
### Later: separate tokens

---

## 3.6 Elevation / Shadows

### What it covers
Shadow and layering system for depth perception.

### Tokens to define

```
shadow.none         // none — flat elements
shadow.sm           // subtle — cards at rest
shadow.md           // moderate — dropdowns, popovers
shadow.lg           // strong — modals, overlays
shadow.inner        // inset — pressed states, inputs
```

### Z-index scale

```
z.base          // 0 — page content
z.sticky        // 10 — sticky headers, progress bar
z.dropdown      // 20 — dropdown menus, popovers
z.overlay       // 30 — mobile sidebar overlay
z.modal         // 40 — dialog/modal
z.toast         // 50 — flash messages, toasts
z.tooltip       // 60 — tooltips (always on top)
```

### MVP: **YES** — z-index scale (prevents layering conflicts)
### Later: shadow tokens

---

## 3.7 Iconography

### What it covers
Icon library, sizing, stroke width, usage patterns.

### Current state
- **Official library:** `lucide-react` (v0.556.0) in root package.json
- **Problem:** Portal and some modules use custom inline SVGs with different stroke widths (1.5 vs 2) and sizing (size-4 vs size-5)

### Decisions to make
- Standardize on lucide-react everywhere
- Single stroke width (2px — lucide default)
- Single sizing system

### Tokens to define

```
icon.size.xs      // size-3 (12px) — inline, badge icons
icon.size.sm      // size-4 (16px) — default icon size
icon.size.md      // size-5 (20px) — prominent icons
icon.size.lg      // size-6 (24px) — hero icons, empty states
icon.size.xl      // size-8 (32px) — feature icons
icon.stroke       // 2 (lucide default)
```

### MVP: **YES** — standardize on lucide-react, remove inline SVGs
### Later: custom icon set if needed

---

## 3.8 Motion / Animation

### What it covers
Timing, easing, transition patterns.

### Current state
- AI-specific animations in globals.css (pulse, glow, sparkle)
- Flash message: `slide-in` 300ms ease-out
- Dialog: Radix animations (fade-in/out, slide-in/out)
- No defined timing scale

### Tokens to define

```
motion.duration.instant    // 0ms — immediate state change
motion.duration.fast       // 100ms — micro interactions (hover, focus)
motion.duration.normal     // 200ms — standard transitions
motion.duration.slow       // 300ms — complex animations (modals, drawers)
motion.duration.slower     // 500ms — page transitions

motion.easing.default      // ease-out
motion.easing.spring       // cubic-bezier(0.34, 1.56, 0.64, 1) — bouncy
motion.easing.smooth       // ease-in-out
```

### MVP: **NO** — current animations are sufficient
### Later: standardize duration/easing tokens

---

## 3.9 Interaction States

### What it covers
Hover, focus, active, disabled, selected, loading states.

### Tokens to define

```
state.hover.opacity        // used for bg-opacity changes
state.disabled.opacity     // 0.5
state.focus.ring.width     // 3px
state.focus.ring.color     // --ring
state.focus.ring.offset    // 0
state.selected.bg          // bg-accent
state.loading.opacity      // 0.7
```

### MVP: **NO** — CVA already handles states in buttons
### Later: centralize in tokens

---

## 3.10 Accessibility Foundations

### What it covers
Focus management, color contrast, screen reader support, reduced motion, touch targets.

### Decisions to make
- WCAG level: AA (minimum) or AAA?
- Minimum touch target: 44x44px
- Focus visible strategy
- Reduced motion support

### Tokens / rules

```
a11y.focus.visible          // focus-visible:ring-[3px] focus-visible:ring-ring/50
a11y.touch.target.min       // 44px
a11y.contrast.min           // 4.5:1 (AA for normal text)
a11y.contrast.large.min     // 3:1 (AA for large text)
a11y.motion.reduced         // prefers-reduced-motion: reduce
```

### MVP: **YES** — required aria-label on IconButton (TypeScript), skip-to-content link
### Later: automated contrast checking, WCAG AAA

---

## 3.11 Content Foundations

### What it covers
Tone of voice, microcopy patterns, error message guidelines.

### Decisions to make
- Formal vs informal tone?
- Technical vs user-friendly error messages?
- Max length for button labels?
- Empty state copy patterns?

### Guidelines

```
// Error messages
"Could not save changes. Please try again."      // GOOD
"Error 500: Internal Server Error"                // BAD

// Empty states
"No customers yet"                                // Title
"Create your first customer to get started."      // Description
"Add customer"                                    // Action

// Button labels
"Save"                                            // GOOD (short, clear)
"Click here to save your changes"                 // BAD (too long)
"Submit"                                          // OK (generic)
"Save customer"                                   // BETTER (contextual)

// Confirmation dialogs
"Delete this customer?"                           // Title
"This action cannot be undone."                   // Description
"Delete" / "Cancel"                               // Actions
```

### MVP: **NO** — this is content work
### Later: content style guide

---

## Foundations — implementation order

```
1. Color System (semantic status tokens)     ← eliminates 372 hardcoded colors
   ↓
2. Typography Scale                          ← eliminates 61 arbitrary sizes
   ↓
3. Spacing Scale (documentation)             ← standardizes 793+ spacing decisions
   ↓
4. Border Radius (documentation)             ← tokens already exist, need documentation
   ↓
5. Iconography (lucide-react standard)       ← eliminates custom inline SVGs
   ↓
6. Z-index / Elevation                       ← prevents layering conflicts
   ↓
7. Accessibility Foundations                 ← TypeScript enforcement
   ↓
8. Motion                                    ← can be deferred
   ↓
9. Content Foundations                       ← can be deferred
```

**Dependencies:**
- Typography depends on spacing (line height)
- Border/Elevation depends on the Color System
- Iconography is independent
- Accessibility is cross-cutting — applies to everything

**Hackathon MVP:**
1. Semantic color tokens (CSS variables + Tailwind mapping)
2. Typography scale (Tailwind config + documentation)
3. Spacing guidelines (documentation)
4. Z-index scale (CSS variables)
5. Border radius guidelines (documentation)

---

# PART 4 — COMPONENT MVP

## Methodology

Components are evaluated against:
- **Priority**: how important to system consistency
- **Reuse**: how often used across the codebase
- **Complexity risk**: risk that the component becomes too complex
- **Hackathon MVP**: whether it can be done in 2–3 days

---

## 4.1 Button

| | |
|---|---|
| **Category** | Actions |
| **Priority** | P0 — critical |
| **Rationale** | Most frequently used interactive element. Already exists and works well. |
| **When to use** | Every user action: submit, cancel, delete, create, navigate |
| **When NOT to use** | Navigation to another page (use Link). Display-only text. |
| **Anatomy** | `[icon?] [label] [icon?]` |
| **Variants** | default, destructive, outline, secondary, ghost, muted, link |
| **Sizes** | sm (h-8), default (h-9), lg (h-10), icon (size-9) |
| **States** | default, hover, focus, active, disabled, loading |
| **Accessibility** | `aria-label` required if icon-only. `disabled` prevents interaction. Focus ring visible. |
| **Dependencies** | color tokens, typography, spacing, border-radius, focus ring |
| **Complexity risk** | Low — already well implemented with CVA |
| **Status** | **EXISTS** — `packages/ui/src/primitives/button.tsx` |
| **Hackathon** | NO — already done, documentation only if needed |

---

## 4.2 Icon Button

| | |
|---|---|
| **Category** | Actions |
| **Priority** | P0 |
| **Rationale** | Used in row actions, close buttons, toolbars. |
| **When to use** | Action represented by an icon (close, delete, edit, more) |
| **When NOT to use** | If the action requires a label (use Button). If it is decorative. |
| **Anatomy** | `[icon]` |
| **Variants** | outline, ghost |
| **Sizes** | xs (size-6), sm (size-7), default (size-8), lg (size-9) |
| **States** | default, hover, focus, active, disabled |
| **Accessibility** | `aria-label` **REQUIRED** (TypeScript enforcement) |
| **Dependencies** | icon system, color tokens, border-radius |
| **Complexity risk** | Low |
| **Status** | **EXISTS** — `packages/ui/src/primitives/icon-button.tsx` |
| **Hackathon** | NO — already done, needs TypeScript enforcement for aria-label |

---

## 4.3 Link

| | |
|---|---|
| **Category** | Navigation |
| **Priority** | P1 |
| **Rationale** | Navigation between pages. Next.js Link is used directly. |
| **When to use** | Navigation to another page, external link |
| **When NOT to use** | In-place action (use Button) |
| **Anatomy** | `[icon?] [text] [external-icon?]` |
| **Variants** | default (underline), subtle (no underline), nav (sidebar item) |
| **States** | default, hover, focus, active, visited |
| **Accessibility** | External links: `target="_blank" rel="noopener"` + visual indicator |
| **Dependencies** | typography, color tokens |
| **Complexity risk** | Low |
| **Status** | Partially exists (Button variant="link"), no dedicated component |
| **Hackathon** | NO — low priority, Button variant="link" is sufficient |

---

## 4.4 Input

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P0 |
| **Rationale** | Core form element |
| **When to use** | Single-line text: name, email, url, number, password |
| **When NOT to use** | Multi-line text (Textarea), selection from a list (Select) |
| **Anatomy** | `[prefix?] [input] [suffix?]` |
| **Variants** | default, error |
| **States** | default, focus, disabled, readonly, error |
| **Accessibility** | Associated `<label>` via htmlFor. `aria-invalid` on error. `aria-describedby` for description/error. |
| **Dependencies** | color tokens (border, focus ring), typography, spacing, border-radius |
| **Complexity risk** | Low |
| **Status** | **EXISTS** — `packages/ui/src/primitives/input.tsx` |
| **Hackathon** | NO — already done |

---

## 4.5 Textarea

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/textarea.tsx` |
| **Hackathon** | NO |

---

## 4.6 Select / Combobox

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P0 |
| **Status** | **EXISTS** — `ComboboxInput` in `packages/ui/src/backend/inputs/` |
| **Hackathon** | NO |

---

## 4.7 Checkbox

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/checkbox.tsx` |
| **Hackathon** | NO |

---

## 4.8 Switch

| | |
|---|---|
| **Category** | Forms |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/switch.tsx` |
| **Hackathon** | NO |

---

## 4.9 Form Field Wrapper

| | |
|---|---|
| **Category** | Forms |
| **Priority** | **P0 — CRITICAL, DOES NOT EXIST** |
| **Rationale** | No consistent wrapper for label + input + description + error. Every module implements this manually. |
| **When to use** | Every form field outside CrudForm |
| **When NOT to use** | Inside CrudForm (has a built-in wrapper) |
| **Anatomy** | `[label] [required-indicator?] → [input (slot)] → [description?] → [error-message?]` |
| **Variants** | default, horizontal (label next to input) |
| **States** | default, error, disabled |
| **Accessibility** | Auto-generated `id` and `htmlFor`. `aria-describedby` linking description/error. `aria-invalid` on error. `aria-required` on required. |
| **Dependencies** | typography (label style), color tokens (error), spacing |
| **Complexity risk** | Low — this is a wrapper, not logic |
| **Status** | **DOES NOT EXIST** — `<Label>` exists but no wrapper composing label+input+error |
| **Hackathon** | **YES** — priority component to create |

---

## 4.10 Card

| | |
|---|---|
| **Category** | Layout |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/card.tsx` (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter) |
| **Problem** | Portal has a separate `PortalCard` with different padding/radius. Needs to be unified. |
| **Hackathon** | NO — exists, requires unification with PortalCard |

---

## 4.11 Badge

| | |
|---|---|
| **Category** | Data Display |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/badge.tsx` |
| **Problem** | Variants (default, secondary, destructive, outline, muted) do not cover status colors. Modules use hardcoded colors on badges instead of variants. |
| **Hackathon** | YES — add status variants (success, warning, info) based on semantic tokens |

---

## 4.12 Alert / Notice (UNIFICATION)

| | |
|---|---|
| **Category** | Feedback |
| **Priority** | **P0 — CRITICAL** |
| **Rationale** | Two components (Alert + Notice) doing the same thing. 4 different color palettes. |
| **When to use** | Inline messages on the page: error, success, warning, info |
| **When NOT to use** | Temporary feedback (use Flash/Toast). Action confirmation (use ConfirmDialog). |
| **Anatomy** | `[icon] [title?] [description] [action?] [close?]` |
| **Variants** | error, success, warning, info, default |
| **States** | default, dismissible |
| **Accessibility** | `role="alert"` for error/warning. `aria-live="polite"` for info/success. |
| **Dependencies** | semantic color tokens (CRITICAL), typography, spacing, border-radius, icon system |
| **Complexity risk** | Medium — Notice users need to be migrated to the unified component |
| **Status** | Alert exists with 5 variants, Notice exists with 3 variants, ErrorNotice is a wrapper |
| **Hackathon** | **YES** — unify into a single component based on semantic tokens |

---

## 4.13 Toast / Flash Message

| | |
|---|---|
| **Category** | Feedback |
| **Priority** | P1 |
| **Status** | **EXISTS** — `FlashMessages` with `flash()` API |
| **Problem** | Colors hardcoded (emerald-600, red-600). Should use semantic tokens. |
| **Hackathon** | YES — migrate to semantic color tokens |

---

## 4.14 Modal / Dialog

| | |
|---|---|
| **Category** | Overlay |
| **Priority** | P0 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/dialog.tsx` (Radix-based) + `useConfirmDialog` |
| **Hackathon** | NO — works well |

---

## 4.15 Dropdown Menu

| | |
|---|---|
| **Category** | Navigation / Actions |
| **Priority** | P1 |
| **Status** | **EXISTS** — `RowActions` uses dropdown, `ProfileDropdown` has a custom dropdown |
| **Hackathon** | NO |

---

## 4.16 Tabs

| | |
|---|---|
| **Category** | Navigation |
| **Priority** | P1 |
| **Status** | **EXISTS** — `packages/ui/src/primitives/tabs.tsx` |
| **Hackathon** | NO |

---

## 4.17 Table

| | |
|---|---|
| **Category** | Data Display |
| **Priority** | P0 |
| **Status** | **EXISTS** — `DataTable` (1000+ lines, feature-rich) + primitives `table.tsx` |
| **Hackathon** | NO — already very feature-rich |

---

## 4.18 Empty State

| | |
|---|---|
| **Category** | Feedback |
| **Priority** | **P0 — CRITICAL** |
| **Status** | **EXISTS** but 79% of pages do not use it |
| **Hackathon** | **YES** — documentation + enforcement guidelines, not a new component |

---

## 4.19 Loader / Skeleton

| | |
|---|---|
| **Category** | Feedback |
| **Priority** | P1 |
| **Status** | **EXISTS** — `Spinner`, `LoadingMessage`. No Skeleton. |
| **Hackathon** | NO — Spinner is sufficient for now |

---

## 4.20 Page Header / Section Header

| | |
|---|---|
| **Category** | Layout |
| **Priority** | P1 |
| **Status** | **EXISTS** — `PageHeader` in `Page.tsx`, `FormHeader` in `forms/` |
| **Problem** | No shared `SectionHeader` — 15+ sections implement their own header |
| **Hackathon** | **YES** — `SectionHeader` component (title + action + collapse) |

---

## 4.21 Pagination

| | |
|---|---|
| **Category** | Navigation |
| **Priority** | P1 |
| **Status** | **EXISTS** — built into DataTable |
| **Hackathon** | NO |

---

## 4.22 Status Badge (NEW)

| | |
|---|---|
| **Category** | Data Display |
| **Priority** | **P0 — CRITICAL, DOES NOT EXIST AS A SEPARATE COMPONENT** |
| **Rationale** | Every module hardcodes status colors. A component mapping status → color via semantic tokens is needed. |
| **When to use** | Displaying status: active/inactive, draft/published, paid/unpaid, open/closed |
| **Anatomy** | `[dot?] [label]` |
| **Variants** | success, warning, error, info, neutral, custom (color prop) |
| **Hackathon** | **YES** — based on Badge + semantic color tokens |

---

## Component implementation priorities

### Must Have — Hackathon (days 1–3)

| # | Component | Type | Rationale |
|---|-----------|------|-----------|
| 1 | Semantic Color Tokens | Foundation | Eliminates 372 hardcoded colors |
| 2 | Alert (unified) | Refactor | Replaces Notice + Alert + ErrorNotice |
| 3 | FormField Wrapper | New | Missing wrapper for label+input+error |
| 4 | Status Badge | New | Eliminates hardcoded status colors |
| 5 | Badge (status variants) | Refactor | Add success/warning/info variants |
| 6 | Flash Messages | Refactor | Migrate to semantic tokens |
| 7 | SectionHeader | New | Eliminates 15+ duplicates |
| 8 | Empty State guidelines | Docs | Enforcement on 79% of pages |

### Should Have — post-hackathon (weeks 1–2)

| # | Component | Rationale |
|---|-----------|-----------|
| 9 | Typography scale | Tailwind config + documentation |
| 10 | Icon system standardization | lucide-react everywhere |
| 11 | Card unification | Card + PortalCard merge |
| 12 | Skeleton loader | Progressive loading |
| 13 | Accessibility audit pass | 370+ missing aria-labels |

### Nice to Have — later

| # | Component | Rationale |
|---|-----------|-----------|
| 14 | Command palette | Navigation improvement |
| 15 | Breadcrumb component | Extraction from AppShell |
| 16 | Content style guide | Tone, microcopy |
| 17 | Motion tokens | Animation standardization |
| 18 | Responsive DataTable | Mobile view |

---

# A. EXECUTIVE SUMMARY

## Key takeaways

1. **Open Mercato has solid UI foundations**: Tailwind v4, OKLCH color system, shadcn/ui primitives, CVA variants, Radix UI. The infrastructure is modern.

2. **The main problem is the missing semantic layer**: 372 hardcoded colors, 61 arbitrary text sizes, 4 different feedback components with different palettes. The system has base tokens but lacks a semantic layer.

3. **Patterns are good but not enforced**: CrudForm, DataTable, Page layout exist and work well. The problem is that 70% of pages do not use them or use them only partially.

4. **Duplication is natural for OSS**: 15+ Section components, Notice vs Alert, custom SVG vs lucide — this is the classic effect of many contributors without shared guidelines.

## Biggest risks

1. **Dark mode broken**: 372 hardcoded colors do not respond to dark mode — users see white text on white background or unreadable contrast
2. **Accessibility debt**: 370+ interactive elements without aria-label — potential legal risk (WCAG compliance)
3. **Scaling problem**: Without a design system every new module adds its own patterns — technical debt grows linearly with the number of modules

## Key quick wins

1. **Semantic color tokens** (CSS variables) — 1 day of work, eliminates 80% of the color problem
2. **Typography scale documentation** — half a day, eliminates "which size to use?"
3. **Alert unification** — 1 day, turns 3 components into 1
4. **FormField wrapper** — half a day, a new simple component
5. **Empty state enforcement** — documentation + PR review checklist

## Recommended order of actions

```
Week 1 (hackathon):
  → Semantic color tokens
  → Typography scale
  → Alert unification
  → FormField wrapper
  → Status Badge
  → SectionHeader
  → Documentation

Weeks 2–3:
  → Icon standardization
  → Card unification
  → Spacing guidelines enforcement
  → Accessibility audit (aria-labels)

Week 4+:
  → Storybook setup
  → Migration of existing pages
  → Content style guide
  → Motion tokens
```

---

# B. HACKATHON PLAN

**Duration:** 11 April 2026 (Friday) 9:00 – 12 April 2026 (Saturday) 11:00
**Time budget:** ~18 working hours (26 calendar hours minus sleep/breaks)
**Strategy:** Foundations first, then components, documentation last. Every block ends with a commit.

---

## BLOCK 1 — Friday 9:00–12:00 (3h): Foundations + Tokens

**Goal: working semantic color tokens in Tailwind + foundation documentation**

- [ ] Add 20 CSS custom properties to `globals.css` (light mode)
- [ ] Add 20 CSS custom properties to `.dark` (dark mode)
- [ ] Add `text-overline` token (11px)
- [ ] Add `@theme inline` mappings for Tailwind v4
- [ ] Verify contrast in Chrome DevTools (light + dark) — all 5 statuses
- [ ] Document typography scale (table)
- [ ] Document spacing guidelines (usage rules)
- [ ] `yarn lint && yarn typecheck` — confirm nothing is broken
→ **Commit:** `feat(ds): add semantic status tokens, text-overline, and foundation docs`

## BLOCK 2 — Friday 13:00–17:00 (4h): Primitive migration

**Goal: all primitives use semantic tokens**

- [ ] Replace Alert CVA variants with flat semantic tokens (`alert.tsx` — 4 lines)
- [ ] Replace Notice colors with semantic tokens + deprecation warning (`Notice.tsx`)
- [ ] Replace FlashMessages colors (`FlashMessages.tsx`)
- [ ] Replace Notification severity colors
- [ ] Add status variants to Badge (`badge.tsx` — success, warning, info)
- [ ] Migrate CrudForm FieldControl colors (`text-red-600` → `text-destructive`)
- [ ] `yarn lint && yarn typecheck && yarn test`
→ **Commit:** `refactor(ds): migrate all primitives to semantic status tokens`

## BLOCK 3 — Friday 18:00–20:00 (2h): New components

**Goal: FormField + StatusBadge ready (Section as stretch goal)**

- [ ] Create `FormField` wrapper (`packages/ui/src/primitives/form-field.tsx`)
- [ ] Create `StatusBadge` (`packages/ui/src/primitives/status-badge.tsx`)
- [ ] If time allows: `Section` / `SectionHeader` (`packages/ui/src/backend/Section.tsx`)
- [ ] `yarn lint && yarn typecheck`
→ **Commit:** `feat(ds): add FormField, StatusBadge components`

## Friday 20:00–21:00: BREAK / BUFFER

Rest. If Block 3 ran over — finish it now. Do not start new work.

## BLOCK 4 — Friday 21:00–22:00 (1h): Documentation (light work)

**Goal: principles and checklist ready (low-risk work at end of day)**

- [ ] Write Design Principles — condensed version for README
- [ ] Write PR Review Checklist (DS compliance checkboxes)
- [ ] Define z-index scale + border-radius usage guidelines
→ **Commit:** `docs(ds): add principles, PR review checklist, foundation guidelines`

## BLOCK 5 — Saturday 8:00–10:00 (2h): Customers module migration

**Goal: proof of concept — one module fully migrated (fresh mind)**

- [ ] Run `ds-migrate-colors.sh` on `packages/core/src/modules/customers/`
- [ ] Run `ds-migrate-typography.sh` on the same module
- [ ] Manual review + fix edge cases
- [ ] Screenshot before/after (light + dark)
- [ ] `yarn lint && yarn typecheck && yarn test`
→ **Commit:** `refactor(ds): migrate customers module to DS tokens`

## BLOCK 6 — Saturday 10:00–11:00 (1h): Wrap-up

**Goal: system ready for adoption**

- [ ] Update AGENTS.md with DS rules
- [ ] Update PR template with DS compliance checkboxes
- [ ] Run `ds-health-check.sh` — record baseline
- [ ] Final `yarn lint && yarn typecheck` pass
→ **Commit:** `docs(ds): update AGENTS.md, PR template, baseline report`

---

**Buffer:** The plan covers ~13h. ~5h buffer remains for:
- Edge cases in the customers migration
- Debugging dark mode contrast
- Section component (if it did not fit in Block 3)
- Unexpected issues in CrudForm FieldControl

---

## B.1 Cut Lines — what if we run out of time

### MUST HAVE — 8h minimum (Blocks 1 + 2)

**Definition of success:** Semantic color tokens exist and are used by existing components. New PRs can use the tokens. Dark mode works.

Commits:
1. `feat(ds): add semantic status tokens, text-overline, and foundation docs`
2. `refactor(ds): migrate all primitives to semantic status tokens`

**What this delivers:**
- 20 semantic tokens in globals.css (light + dark)
- Alert, Notice, Badge, FlashMessages, Notifications — all on tokens
- CrudForm FieldControl — error colors on tokens
- Typography scale and spacing guidelines documented
- Foundation on which everything else is built

**If nothing else gets done** — the hackathon is a success. We have a token system that eliminates 80% of the color problem. Every new PR from now on can use `text-status-error-text` instead of `text-red-600`.

### SHOULD HAVE — 14h (+ Blocks 3, 4)

**Additional commits:**
3. `feat(ds): add FormField, StatusBadge components`
4. `docs(ds): add principles, PR review checklist, foundation guidelines`

**What this adds:**
- New components ready to use immediately
- Principles and PR checklist — enforcement for contributors
- Z-index scale and border-radius guidelines

### NICE TO HAVE — 18h (+ Blocks 5, 6)

**Additional commits:**
5. `refactor(ds): migrate customers module to DS tokens`
6. `docs(ds): update AGENTS.md, PR template, baseline report`

**What this adds:**
- Proof of concept: entire module migrated
- AGENTS.md rules — AI agents generate DS-compliant code
- Baseline health report for tracking progress
- Section component (if it fit in the buffer)

---

# C. DELIVERABLES

After the hackathon (Sat 12.04 11:00) the following should be ready:

1. **Audit checklist** — this document (Part 1) ✅ (ready before hackathon)
2. **Design Principles** — 8 principles with checklist for PR review (BLOCK 5)
3. **Foundations v0** — semantic color tokens in globals.css, typography scale, spacing guidelines, z-index scale, border-radius guidelines (BLOCK 1 + BLOCK 5)
4. **Component MVP list** — with priorities and status ✅ (ready before hackathon)
5. **New/updated components** (BLOCK 2 + BLOCK 3):
   - Alert (semantic tokens + compact + dismissible)
   - Notice (deprecated, delegates to Alert)
   - FormField wrapper
   - StatusBadge
   - SectionHeader / Section
   - Badge (+ status variants)
   - FlashMessages (semantic tokens)
   - CrudForm FieldControl (semantic tokens)
6. **Migrated reference module** — customers module (BLOCK 4)
7. **Documentation** (BLOCK 5):
   - Design Principles document
   - PR Review Checklist (checkboxes)
   - AGENTS.md update with DS rules
   - PR template update
   - ds-health-check.sh baseline report

---

# D. PRIORITY TABLE

| Area | Description | Priority | Impact consistency | Impact UX | Effort | Hackathon |
|------|-------------|----------|--------------------|-----------|--------|-----------|
| Semantic color tokens | CSS variables for status colors | **Critical** | 5/5 | 4/5 | Medium | **YES** |
| Alert unification | Notice + Alert → 1 component | **Critical** | 5/5 | 4/5 | Medium | **YES** |
| Typography scale | Documentation + Tailwind config | High | 4/5 | 3/5 | Low | **YES** |
| FormField wrapper | New component | High | 4/5 | 4/5 | Low | **YES** |
| StatusBadge | New component | High | 4/5 | 3/5 | Low | **YES** |
| SectionHeader | New component | High | 3/5 | 2/5 | Low | **YES** |
| Badge status variants | Badge extension | High | 3/5 | 3/5 | Low | **YES** |
| Flash semantic tokens | Color migration | High | 3/5 | 2/5 | Low | **YES** |
| Spacing guidelines | Documentation | High | 4/5 | 2/5 | Low | **YES** |
| Z-index scale | CSS variables | Medium | 2/5 | 1/5 | Low | **YES** |
| Border-radius docs | Documentation | Medium | 2/5 | 1/5 | Low | **YES** |
| Empty state enforcement | Guidelines + review | High | 3/5 | 4/5 | Low | **YES** (docs) |
| Design Principles | Document | High | 5/5 | 3/5 | Low | **YES** |
| PR Review Checklist | Checklist | High | 5/5 | 2/5 | Low | **YES** |
| Icon standardization | Migrate to lucide | Medium | 3/5 | 2/5 | Medium | No |
| Card unification | Card + PortalCard | Medium | 2/5 | 2/5 | Medium | No |
| Accessibility audit | 370+ aria-labels | High | 2/5 | 4/5 | High | No |
| Skeleton loader | New component | Low | 1/5 | 3/5 | Medium | No |
| Command palette | New feature | Low | 1/5 | 4/5 | High | No |
| Content style guide | Documentation | Low | 2/5 | 3/5 | Medium | No |
| Motion tokens | CSS variables | Low | 1/5 | 2/5 | Low | No |
| Responsive DataTable | Refactor | Low | 1/5 | 3/5 | High | No |

**Effort legend:** Low = <4h, Medium = 4-8h, High = >8h

**Impact legend:** 1 = minimal, 5 = critical

---

---

# SUPPLEMENT: ENFORCEMENT, METRICS, APIs, RISK ANALYSIS

> The sections below supplement the main document with an enforcement layer, measurability, concrete component APIs, and migration strategies.

---

# E. ENFORCEMENT & MIGRATION PLAN

## E.1 Hardcoded Colors (372 occurrences)

### ESLint Rule

Add a custom rule to `eslint.config.mjs` that blocks semantic color classes in new files:

```javascript
// eslint-plugin-open-mercato/no-hardcoded-status-colors.js
// Blocks: text-red-*, bg-red-*, border-red-*, text-green-*, bg-green-*,
//         text-emerald-*, bg-emerald-*, text-blue-* (status contexts),
//         text-amber-*, bg-amber-*
// Allowed: text-destructive, bg-destructive/*, text-status-*, bg-status-*

const BLOCKED_PATTERNS = [
  /\btext-red-\d+/,
  /\bbg-red-\d+/,
  /\bborder-red-\d+/,
  /\btext-green-\d+/,
  /\bbg-green-\d+/,
  /\bborder-green-\d+/,
  /\btext-emerald-\d+/,
  /\bbg-emerald-\d+/,
  /\bborder-emerald-\d+/,
  /\btext-amber-\d+/,
  /\bbg-amber-\d+/,
  /\bborder-amber-\d+/,
  /\btext-blue-\d+/,   // only in status contexts
  /\bbg-blue-\d+/,
  /\bborder-blue-\d+/,
]
```

**Strategy:** Enable as `warn` from day 1 (does not block the build). After 2 sprints, switch to `error` for new files. After 4 sprints — `error` globally.

### Codemod / regex strategy

**Phase 1 — Error states (`text-red-600` → semantic token):**

```bash
# Find all occurrences
rg 'text-red-600' --type tsx -l
# 107 occurrences — mostly error messages and required indicators

# Replace in CrudForm FieldControl (internal):
# text-red-600 → text-destructive
# Applies to: required indicator, error message

# Mapping:
# text-red-600  → text-destructive
# text-red-700  → text-destructive
# text-red-800  → text-destructive (darker context)
# bg-red-50     → bg-destructive/5
# bg-red-100    → bg-destructive/10
# border-red-200 → border-destructive/20
# border-red-500 → border-destructive/60
```

**Phase 2 — Success states:**

```bash
# Mapping:
# text-green-600  → text-status-success
# text-green-800  → text-status-success
# bg-green-100    → bg-status-success-bg
# bg-green-50     → bg-status-success/5
# text-emerald-*  → text-status-success (interchangeable)
# bg-emerald-*    → bg-status-success/*
```

**Phase 3 — Warning/Info states:**

```bash
# Mapping:
# text-amber-500  → text-status-warning
# text-amber-800  → text-status-warning
# bg-amber-50     → bg-status-warning/5
# text-blue-600   → text-status-info
# text-blue-800   → text-status-info
# bg-blue-50      → bg-status-info/5
# bg-blue-100     → bg-status-info/10
```

### Migration strategy: per-module, not an atomic PR

**Module order:**

| # | Module | Reason | Effort | Files |
|---|--------|--------|--------|-------|
| 1 | `packages/ui/src/primitives/` | Foundation — Notice, Alert, Badge | Low | 4 files |
| 2 | `packages/ui/src/backend/` | CrudForm FieldControl, FlashMessages, EmptyState | Medium | ~10 files |
| 3 | `packages/core/src/modules/customers/` | Most complex, reference module | Medium | ~15 files |
| 4 | `packages/core/src/modules/auth/` | Frontend login with hardcoded alert colors | Low | 3 files |
| 5 | `packages/core/src/modules/sales/` | Status badges on documents | Medium | ~10 files |
| 6 | `packages/core/src/modules/portal/` | Frontend pages with hardcoded colors | Low | 4 files |
| 7 | Remaining modules | Catalog migration | Medium | ~40 files |

**One PR per module.** Each PR:
- Replaces hardcoded colors with semantic tokens
- Adds a `// DS-MIGRATED` comment on the last line of the file (for tracking)
- Verified visually (screenshot before/after)

---

## E.2 Arbitrary Text Sizes (61 occurrences)

### Mapping table

| Old | New | Rationale |
|-----|-----|-----------|
| `text-[9px]` | `text-[9px]` (exception) | Notification badge count — too small for the standard scale, keep as-is |
| `text-[10px]` | `text-xs` (12px) | Round up, more readable |
| `text-[11px]` | `text-xs` (12px) or new `text-overline` | 33 occurrences — this is a de facto "overline" pattern |
| `text-[12px]` | `text-xs` | Identical to text-xs |
| `text-[13px]` | `text-sm` (14px) | Round up by 1px |
| `text-[14px]` | `text-sm` | Identical to text-sm |
| `text-[15px]` | `text-base` (16px) or `text-sm` | Depends on context |

**Option: add `text-overline` to Tailwind config:**

```css
/* globals.css - in @theme section */
--font-size-overline: 0.6875rem; /* 11px */
--font-size-overline--line-height: 1rem;
```

This allows `text-[11px]` to be replaced with `text-overline` without an arbitrary value.

### Lint rule

```javascript
// Blocks text-[Npx] in new files
// Exceptions: text-[9px] (badge count)
const BLOCKED = /\btext-\[\d+px\]/
const ALLOWED = ['text-[9px]']
```

---

## E.3 Notice → Alert Migration

### Scope

- **Notice**: 7 files
- **Alert**: 18 files
- **ErrorNotice**: 2 files
- **Total to migrate**: 9 files (Notice + ErrorNotice)

### Strategy: Adapter → Hard Replace

**Step 1 (hackathon):** Deprecation notice in Notice.tsx

```typescript
// packages/ui/src/primitives/Notice.tsx
/**
 * @deprecated Use <Alert variant="error|warning|info"> instead.
 * Will be removed in v0.6.0.
 * Migration: Notice variant="error" → Alert variant="destructive"
 *            Notice variant="warning" → Alert variant="warning"
 *            Notice variant="info" → Alert variant="info"
 */
export function Notice(props: NoticeProps) {
  if (process.env.NODE_ENV === 'development') {
    console.warn('[DS] Notice is deprecated. Use Alert instead. See migration guide.')
  }
  // ... existing implementation
}
```

**Step 2 (one week after the hackathon):** Migrate 7 Notice files → Alert

| Old (Notice) | New (Alert) |
|--------------|-------------|
| `<Notice variant="error" title="..." message="..." />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice variant="warning" title="..." />` | `<Alert variant="warning"><AlertTitle>...</AlertTitle></Alert>` |
| `<Notice variant="info" message="..." />` | `<Alert variant="info"><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice compact message="..." />` | `<Alert variant="info" compact><AlertDescription>...</AlertDescription></Alert>` |
| `<Notice action={<Button>...</Button>} />` | `<Alert variant="info"><AlertDescription>...<AlertAction>...</AlertAction></AlertDescription></Alert>` |
| `<ErrorNotice title="..." message="..." />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...</AlertDescription></Alert>` |

**Step 3 (v0.6.0):** Remove Notice.tsx and ErrorNotice.tsx

### Files to migrate (specific)

**Notice (7 files):**
1. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/signup/page.tsx`
2. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/page.tsx`
3. `packages/core/src/modules/portal/frontend/[orgSlug]/portal/login/page.tsx`
4. `packages/core/src/modules/auth/frontend/login.tsx`
5. `packages/core/src/modules/audit_logs/components/AuditLogsActions.tsx`
6. `packages/core/src/modules/data_sync/backend/data-sync/page.tsx`
7. `packages/core/src/modules/data_sync/components/IntegrationScheduleTab.tsx`

**ErrorNotice (2 files):**
8. `packages/core/src/modules/customers/backend/customers/deals/pipeline/page.tsx`
9. `packages/core/src/modules/entities/backend/entities/user/[entityId]/page.tsx`

---

## E.4 Icon System (inline SVG → lucide-react)

### Scope: 14 files with inline `<svg>`

**Custom SVG → lucide equivalent mapping:**

| File | Custom SVG | Lucide equivalent |
|------|-----------|-------------------|
| Portal `signup/page.tsx` | CheckIcon, XIcon | `Check`, `X` |
| Portal `dashboard/page.tsx` | BellIcon, WidgetIcon | `Bell`, `LayoutGrid` |
| Portal `page.tsx` | ShoppingBagIcon, UserIcon, ShieldIcon | `ShoppingBag`, `User`, `Shield` |
| `auth/lib/profile-sections.tsx` | Custom icons | Verify per-icon |
| `workflows/checkout-demo/page.tsx` | CheckIcon, decorative SVG | `Check`, `CircleCheck` |
| `workflows/definitions/[id]/page.tsx` | Flow icons | `Workflow`, `GitBranch` |
| `workflows/EdgeEditDialog.tsx` | Edge icons | `ArrowRight`, `Cable` |
| `workflows/NodeEditDialog.tsx` | Node icons | `Square`, `Circle` |
| `workflows/BusinessRulesSelector.tsx` | Rule icon | `Scale`, `Gavel` |
| `integrations/.../widget.client.tsx` | External ID icon | `ExternalLink`, `Link2` |
| `staff/team-members/page.tsx` | Team icon | `Users`, `UserPlus` |
| `staff/team-roles/page.tsx` | Role icon | `Shield`, `Key` |

**2 test files** (`__tests__/`) — SVG in mocks, no migration required.

### Strategy

```bash
# Find all inline SVGs (excluding tests)
rg '<svg' --type tsx -l --glob '!**/__tests__/**' packages/core/src/modules/
# 12 files to migrate (2 test files excluded)
```

Migration per-file. Each PR replaces inline SVG with a lucide import.

---

## E.5 PR Template Update

Add to `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
### Design System Compliance
- [ ] No hardcoded status colors (`text-red-*`, `bg-green-*`, etc.) — use semantic tokens
- [ ] No arbitrary text sizes (`text-[Npx]`) — use typography scale
- [ ] Empty state handled for list/data pages
- [ ] Loading state handled for async pages
- [ ] `aria-label` on all icon-only buttons
- [ ] Uses existing DS components (Button, Alert, Badge) — no custom replacements
```

---

## E.6 AGENTS.md Update

Add to the root `AGENTS.md` in the `## Conventions` section or as a new `## Design System Rules` section:

```markdown
## Design System Rules

### Colors
- NEVER use hardcoded Tailwind colors for status semantics (`text-red-*`, `bg-green-*`, etc.)
- USE semantic tokens: `text-status-error-text`, `bg-status-success-bg`, `border-status-warning-border`
- Status colors: `destructive` (error), `status-success`, `status-warning`, `status-info`, `status-neutral`

### Typography
- NEVER use arbitrary text sizes (`text-[11px]`, `text-[13px]`)
- USE Tailwind scale: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`
- For 11px overline pattern: use `text-overline` (custom utility)

### Feedback
- USE `Alert` for inline messages (NOT `Notice` — deprecated)
- USE `flash()` for transient toast messages
- USE `useConfirmDialog()` for destructive action confirmation
- Every list page MUST handle empty state via `<EmptyState>`
- Every async page MUST show loading via `<LoadingMessage>` or `<Spinner>`

### Icons
- USE `lucide-react` for all icons — NEVER inline `<svg>` elements
- Icon sizes: `size-3` (xs), `size-4` (sm/default), `size-5` (md), `size-6` (lg)

### Components
- USE `Button`/`IconButton` — NEVER raw `<button>`
- USE `apiCall()`/`apiCallOrThrow()` — NEVER raw `fetch()` in backend pages
- USE `StatusBadge` for entity status display — NEVER hardcoded color Badge
- USE `FormField` wrapper for standalone forms — CrudForm handles internally
- USE `SectionHeader` for collapsible detail sections
```

---

## E.7 Boy Scout Rule

**Policy:** Every PR that touches a file containing hardcoded status colors MUST migrate at minimum the touched lines.

**Implementation:**
- Add to the PR review checklist
- Add a comment in AGENTS.md:

```markdown
### Boy Scout Rule (Design System)
When modifying a file that contains hardcoded status colors (text-red-*, bg-green-*, etc.),
you MUST migrate at minimum the lines you touched to semantic tokens.
Optionally migrate the entire file if scope allows.
```

- CI check (optional): a script comparing `git diff --name-only` against the list of files containing hardcoded colors. If a PR touches a file from the list but does not reduce the count — warning.

---

# F. SUCCESS METRICS & TRACKING

## KPI Dashboard

| # | Metric | Current value | Target | Target date | How to measure |
|---|--------|--------------|--------|-------------|----------------|
| 1 | Hardcoded semantic colors | 372 | 0 | v0.6.0 (8 wks.) | `rg 'text-red-\|bg-red-\|text-green-\|bg-green-\|text-emerald-\|bg-emerald-\|text-amber-\|bg-amber-\|text-blue-[0-9]\|bg-blue-[0-9]' --type tsx -c \| awk -F: '{s+=$2} END{print s}'` |
| 2 | Arbitrary text sizes | 61 | 1 (exception: `text-[9px]`) | v0.6.0 | `rg 'text-\[\d+px\]' --type tsx -c \| awk -F: '{s+=$2} END{print s}'` |
| 3 | Empty state coverage | 21% (31/150) | 80% | v0.7.0 (12 wks.) | Manual audit + grep for EmptyState/TabEmptyState imports |
| 4 | Loading state coverage | 59% (89/150) | 90% | v0.7.0 | Grep for LoadingMessage/Spinner/isLoading patterns |
| 5 | aria-label coverage | ~50% | 95% | v0.7.0 | Automated a11y scan (axe-core in Playwright) |
| 6 | Notice component usage | 7 files | 0 | v0.6.0 | `rg "from.*Notice" --type tsx -l \| wc -l` |
| 7 | ErrorNotice usage | 2 files | 0 | v0.6.0 | `rg "ErrorNotice" --type tsx -l \| wc -l` |
| 8 | Inline SVG count | 12 files | 0 | v0.7.0 | `rg '<svg' --type tsx -l --glob '!**/__tests__/**' \| wc -l` |
| 9 | Raw fetch() count | 8 | 0 | v0.7.0 | `rg 'fetch\(' --type tsx --glob '**/backend/**' -l \| wc -l` |
| 10 | StatusBadge adoption | 0 | 100% status displays | v0.7.0 | Manual audit |

## Reporting script

```bash
#!/bin/bash
# ds-health-check.sh — run every sprint
# Usage: bash .ai/scripts/ds-health-check.sh
# Portable: works on macOS and Linux

set -euo pipefail

REPORT_DIR=".ai/reports"
mkdir -p "$REPORT_DIR"

DATE=$(date +%Y-%m-%d)
REPORT_FILE="$REPORT_DIR/ds-health-$DATE.txt"

# Helper: write to stdout and file simultaneously
report() {
  echo "$1" | tee -a "$REPORT_FILE"
}

# Clear report file (new report)
> "$REPORT_FILE"

report "=== DESIGN SYSTEM HEALTH CHECK ==="
report "Date: $DATE"
report ""

report "--- Hardcoded Status Colors ---"
HC=$(rg 'text-red-[0-9]|bg-red-[0-9]|border-red-[0-9]|text-green-[0-9]|bg-green-[0-9]|border-green-[0-9]|text-emerald-[0-9]|bg-emerald-[0-9]|border-emerald-[0-9]|text-amber-[0-9]|bg-amber-[0-9]|border-amber-[0-9]|text-blue-[0-9]|bg-blue-[0-9]|border-blue-[0-9]' \
  --type tsx --glob '!**/__tests__/**' --glob '!**/node_modules/**' -c 2>/dev/null | \
  awk -F: '{s+=$2} END{print s+0}')
report "  Count: $HC (target: 0)"

report ""
report "--- Arbitrary Text Sizes ---"
AT=$(rg 'text-\[\d+px\]' --type tsx --glob '!**/__tests__/**' -c 2>/dev/null | \
  awk -F: '{s+=$2} END{print s+0}')
report "  Count: $AT (target: 1)"

report ""
report "--- Deprecated Notice Usage ---"
NC=$(rg "from.*primitives/Notice" --type tsx -l 2>/dev/null | wc -l | tr -d ' ')
report "  Notice imports: $NC (target: 0)"
EN=$(rg "ErrorNotice" --type tsx -l 2>/dev/null | wc -l | tr -d ' ')
report "  ErrorNotice imports: $EN (target: 0)"

report ""
report "--- Inline SVG ---"
SVG=$(rg '<svg' --type tsx --glob '!**/__tests__/**' --glob '!**/node_modules/**' -l 2>/dev/null | wc -l | tr -d ' ')
report "  Files with inline SVG: $SVG (target: 0)"

report ""
report "--- Raw fetch() in Backend ---"
RF=$(rg 'fetch\(' --type tsx --glob '**/backend/**' --glob '!**/node_modules/**' -l 2>/dev/null | wc -l | tr -d ' ')
report "  Raw fetch files: $RF (target: 0)"

report ""
report "--- Empty State Coverage ---"
PAGES=$(find packages/core/src/modules/*/backend -name "page.tsx" 2>/dev/null | wc -l | tr -d ' ')
ES=$(rg 'EmptyState|TabEmptyState' --type tsx --glob '**/backend/**/page.tsx' -l 2>/dev/null | wc -l | tr -d ' ')
PCT=$(( ES * 100 / PAGES ))
report "  Pages with empty state: $ES / $PAGES ($PCT%)"

report ""
report "--- Loading State Coverage ---"
LS=$(rg 'LoadingMessage|isLoading|Spinner' --type tsx --glob '**/backend/**/page.tsx' -l 2>/dev/null | wc -l | tr -d ' ')
LPCT=$(( LS * 100 / PAGES ))
report "  Pages with loading state: $LS / $PAGES ($LPCT%)"

report ""
report "=== END REPORT ==="

# Compare with previous report
PREV=$(ls -1 "$REPORT_DIR"/ds-health-*.txt 2>/dev/null | grep -v "$DATE" | sort | tail -1)
if [ -n "${PREV:-}" ] && [ -f "$PREV" ]; then
  echo ""
  echo "=== DELTA vs $(basename "$PREV") ==="
  diff --unified=0 "$PREV" "$REPORT_FILE" | grep '^[+-]  ' | head -20 || echo "  (no changes)"
else
  echo ""
  echo "=== First report — no previous data to compare ==="
fi

echo ""
echo "Report saved to: $REPORT_FILE"
```

**Tracking cadence:** Run at the start of each sprint. The report is saved to `.ai/reports/ds-health-YYYY-MM-DD.txt`. Comparison with the previous report is automatic.

---

# G. COMPONENT API PROPOSALS

## G.1 FormField

### TypeScript Interface

```typescript
import type { ReactNode } from 'react'

export type FormFieldProps = {
  /** Visible label text. If omitted, field is label-less (aria-label should be on input). */
  label?: string
  /** Auto-generated if not provided. Links label → input via htmlFor/id. */
  id?: string
  /** Show required indicator (*) next to label */
  required?: boolean
  /** Label variant. 'default' = text-sm font-medium (backend forms). 'overline' = text-overline font-semibold uppercase tracking-wider (portal/compact contexts). */
  labelVariant?: 'default' | 'overline'
  /** Help text below input */
  description?: ReactNode
  /** Error message below input (replaces description when present) */
  error?: string
  /** Layout direction */
  orientation?: 'vertical' | 'horizontal'
  /** Disabled state — propagates to label styling */
  disabled?: boolean
  /** Additional className on root wrapper */
  className?: string
  /** The input element (slot) */
  children: ReactNode
}
```

### Decision: Label style

**Default style:** `text-sm font-medium text-foreground` — consistent with the existing `<Label>` primitive and CrudForm FieldControl. This is the style used in 95% of the backend.

**`overline` variant:** `text-overline font-semibold uppercase tracking-wider text-muted-foreground` — used in portal pages and compact contexts. Available via `labelVariant="overline"`, NOT the default.

**Label rendering implementation:**

```typescript
const labelStyles = {
  default: 'text-sm font-medium text-foreground',
  overline: 'text-overline font-semibold uppercase tracking-wider text-muted-foreground',
}

// In render:
{label && (
  <Label htmlFor={fieldId} className={labelStyles[labelVariant ?? 'default']}>
    {label}
    {required && <span className="text-destructive ml-0.5">*</span>}
  </Label>
)}
```

**Error message style:** `text-xs text-destructive` with `role="alert"` — consistent with CrudForm.

**Description style:** `text-xs text-muted-foreground` — consistent with CrudForm (but without an Info icon — FormField is simpler).

**Portal forms:** Use `<FormField labelVariant="overline">`. The portal does not need its own component — a variant is sufficient.

**Sharing with CrudForm:** Long-term (after the hackathon), CrudForm FieldControl should extract sub-components `FieldLabel`, `FieldError`, `FieldDescription` to a shared location (`packages/ui/src/primitives/form-field-parts.tsx`). Both FormField and CrudForm FieldControl would then import from there. This ensures a consistent style without duplication. **Do not do this at the hackathon** — too high a risk of regression in CrudForm.

### Usage examples

**Default (vertical):**
```tsx
<FormField label="Email" required error={errors.email}>
  <Input
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
  />
</FormField>
```

**Horizontal layout:**
```tsx
<FormField label="Active" orientation="horizontal">
  <Switch checked={isActive} onCheckedChange={setIsActive} />
</FormField>
```

**With description:**
```tsx
<FormField
  label="API Key"
  description="Your API key is used for authentication. Keep it secret."
  error={errors.apiKey}
>
  <Input type="password" value={apiKey} onChange={...} />
</FormField>
```

**Without label (custom input):**
```tsx
<FormField error={errors.color}>
  <ColorPicker value={color} onChange={setColor} aria-label="Pick a color" />
</FormField>
```

### Implementation — auto-generated id

```typescript
const generatedId = React.useId()
const fieldId = props.id ?? generatedId
const descriptionId = props.description ? `${fieldId}-desc` : undefined
const errorId = props.error ? `${fieldId}-error` : undefined

// Clones child to inject id, aria-describedby, aria-invalid
const child = React.cloneElement(children, {
  id: fieldId,
  'aria-describedby': [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
  'aria-invalid': !!props.error,
  'aria-required': props.required,
})
```

### Relationship with CrudForm

- CrudForm **does NOT use** FormField — it has its own built-in `FieldControl` (line 3367 of CrudForm.tsx)
- FormField is intended for **standalone forms** (portal, auth, custom pages)
- Long-term: CrudForm may be refactored to use FormField internally, but this is not a hackathon goal
- **No logic duplication** — FormField is a simple wrapper; CrudForm FieldControl also handles loadOptions, field types, and validation triggers

### Storybook stories

1. `Default` — label + input + submit
2. `Required` — with asterisk
3. `WithError` — error message visible
4. `WithDescription` — help text
5. `Horizontal` — switch/checkbox layout
6. `Disabled` — disabled state
7. `WithoutLabel` — custom input with aria-label
8. `Composed` — multiple FormFields in a form

### Test cases

- Unit: renders label, links htmlFor→id, shows error, shows description, hides description when error present
- Unit: auto-generates id when not provided
- Unit: injects aria-describedby, aria-invalid on child
- Unit: horizontal orientation renders flex-row
- a11y: axe-core passes on all variants

### Accessibility checklist

- [ ] Label linked to input via htmlFor/id
- [ ] `aria-describedby` links input to description/error
- [ ] `aria-invalid="true"` when error present
- [ ] `aria-required="true"` when required
- [ ] Error message has `role="alert"`
- [ ] Required indicator is visible AND communicated to screen readers

---

## G.2 StatusBadge

### Badge vs StatusBadge relationship

```
StatusBadge (semantic: "what this status MEANS")
  └── Badge (visual: "how it LOOKS")
       └── semantic color tokens (foundation: "which COLOR")
```

**Badge** = low-level visual component. Variants: `default`, `secondary`, `destructive`, `outline`, `muted`, + new: `success`, `warning`, `info`. No status mapping logic. Use it when you know the variant:
```tsx
<Badge variant="success">Active</Badge>
```

**StatusBadge** = semantic wrapper. Accepts `variant: StatusBadgeVariant` and **internally renders `<Badge>`** with the appropriate variant + an optional dot indicator. Modules define a `StatusMap` mapping a business status → variant:
```tsx
<StatusBadge variant={statusMap[person.status]} dot>{t(`status.${person.status}`)}</StatusBadge>
```

**This is NOT duplication.** Badge is "how to draw a coloured pill". StatusBadge is "which colour for 'active'?". StatusBadge without Badge makes no sense. Badge without StatusBadge is fine for non-status contexts (e.g. count badge, label badge).

### TypeScript Interface

```typescript
import type { ReactNode } from 'react'

export type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export type StatusBadgeProps = {
  /** Visual variant — maps to semantic color tokens */
  variant: StatusBadgeVariant
  /** Badge text */
  children: ReactNode
  /** Show colored dot before text */
  dot?: boolean
  /** Additional className */
  className?: string
}

/**
 * Helper: map arbitrary status string to variant.
 * Modules define their own mapping.
 */
export type StatusMap<T extends string = string> = Record<T, StatusBadgeVariant>
```

### Implementation — StatusBadge renders Badge

```typescript
import { Badge } from './badge'

// Mapping StatusBadge variant → Badge variant (new variants in Badge)
const variantToBadge: Record<StatusBadgeVariant, string> = {
  success: 'success',
  warning: 'warning',
  error:   'destructive',  // Badge uses "destructive" not "error"
  info:    'info',
  neutral: 'muted',        // Badge uses "muted" not "neutral"
}

export function StatusBadge({ variant, dot, children, className }: StatusBadgeProps) {
  return (
    <Badge variant={variantToBadge[variant]} className={className}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </Badge>
  )
}
```

**Badge CVA — new status variants (add to badge.tsx):**

```typescript
// Existing:
default: 'border-transparent bg-primary text-primary-foreground shadow',
secondary: 'border-transparent bg-secondary text-secondary-foreground',
destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
outline: 'text-foreground',
muted: 'border-transparent bg-muted text-muted-foreground',

// New:
success: 'border-status-success-border bg-status-success-bg text-status-success-text',
warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
info:    'border-status-info-border bg-status-info-bg text-status-info-text',
```

> The `destructive` Badge already exists and uses the `--destructive` token. After the color migration in section I, the destructive Badge will automatically use semantic error colors. There is no need to add a separate `error` variant to Badge.

### How modules define statuses

Each module defines its own `StatusMap`:

```typescript
// packages/core/src/modules/customers/lib/status.ts
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

export const personStatusMap: StatusMap<'active' | 'inactive' | 'archived'> = {
  active: 'success',
  inactive: 'neutral',
  archived: 'warning',
}

// Usage in component:
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { personStatusMap } from '../lib/status'

<StatusBadge variant={personStatusMap[person.status]} dot>
  {t(`customers.status.${person.status}`)}
</StatusBadge>
```

**Per-module examples:**

```typescript
// Sales documents
const documentStatusMap: StatusMap = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  rejected: 'error',
  expired: 'warning',
}

// Currencies
const currencyStatusMap: StatusMap = {
  active: 'success',
  inactive: 'neutral',
  base: 'info',
}

// Workflows
const workflowStatusMap: StatusMap = {
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
  pending: 'neutral',
}
```

### Unknown/custom statuses

```typescript
// Fallback for unknown statuses:
<StatusBadge variant={statusMap[status] ?? 'neutral'}>
  {status}
</StatusBadge>
```

### Storybook stories

1. `AllVariants` — success, warning, error, info, neutral
2. `WithDot` — dot indicator
3. `WithStatusMap` — example with personStatusMap
4. `Unknown` — fallback to neutral

### Test cases

- Unit: renders correct variant classes
- Unit: renders dot when `dot={true}`
- Unit: renders children text
- a11y: sufficient contrast for all variants in light + dark mode

### Accessibility checklist

- [ ] Text has sufficient contrast (AA minimum) on colored background
- [ ] Dark mode colors maintain contrast
- [ ] Dot is decorative (`aria-hidden="true"`)

---

## G.3 SectionHeader

### TypeScript Interface

```typescript
import type { ReactNode } from 'react'

export type SectionHeaderProps = {
  /** Section title */
  title: string
  /** Optional item count badge */
  count?: number
  /** Action button(s) on the right */
  action?: ReactNode
  /** Enable collapse/expand */
  collapsible?: boolean
  /** Controlled collapsed state */
  collapsed?: boolean
  /** Callback when collapse state changes */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Default collapsed state (uncontrolled) */
  defaultCollapsed?: boolean
  /** Additional className */
  className?: string
}

export type SectionProps = {
  /** Section header props (or custom header via children) */
  header: SectionHeaderProps
  /** Empty state — rendered when children is null/empty */
  emptyState?: {
    title: string
    description?: string
    action?: { label: string; onClick: () => void }
  }
  /** Section content */
  children?: ReactNode
  /** Additional className on content wrapper */
  contentClassName?: string
}
```

### Usage examples

**With action:**
```tsx
<Section
  header={{ title: 'Tags', count: tags.length, action: <Button variant="ghost" size="sm" onClick={addTag}>Add</Button> }}
  emptyState={{ title: 'No tags', description: 'Add tags to organize this record' }}
>
  {tags.map(tag => <TagChip key={tag.id} tag={tag} />)}
</Section>
```

**With collapse:**
```tsx
<Section
  header={{ title: 'Activities', count: 12, collapsible: true, defaultCollapsed: false }}
>
  <ActivitiesList items={activities} />
</Section>
```

**Without action (simple):**
```tsx
<Section header={{ title: 'Custom Data' }}>
  <CustomFieldsGrid fields={fields} />
</Section>
```

### How it replaces 15+ existing sections

| Current component | Change |
|-------------------|--------|
| `TagsSection` | `<Section header={{ title, count, action }}>` + tag content |
| `ActivitiesSection` | `<Section header={{ title, count, collapsible }}>` + activity list |
| `AddressesSection` | `<Section header={{ title, count, action }}>` + address tiles |
| `DealsSection` | `<Section header={{ title, count }}>` + deal cards |
| `CustomDataSection` | `<Section header={{ title }}>` + custom fields |
| `TasksSection` | `<Section header={{ title, count, action }}>` + task list |
| `CompanyPeopleSection` | `<Section header={{ title, count }}>` + people list |
| Sales `ItemsSection` | `<Section header={{ title, count, action }}>` + line items table |
| Sales `PaymentsSection` | `<Section header={{ title, count }}>` + payments list |
| Sales `ShipmentsSection` | `<Section header={{ title, count }}>` + shipments list |

**No immediate migration required** — sections can be refactored opportunistically (Boy Scout Rule). SectionHeader is a composition pattern: the header is new, the content remains owned by the module.

### Storybook stories

1. `Default` — title only
2. `WithCount` — title + count badge
3. `WithAction` — title + action button
4. `Collapsible` — expand/collapse
5. `CollapsedByDefault` — starts collapsed
6. `WithEmptyState` — no children, empty state visible
7. `FullExample` — all features combined

### Test cases

- Unit: renders title, count badge, action
- Unit: collapse toggle works (click → hide content)
- Unit: empty state renders when no children
- Unit: controlled collapsed state
- a11y: collapsible uses `aria-expanded`

### Accessibility checklist

- [ ] Title is semantic heading (`<h3>` or `role="heading"`)
- [ ] Collapse button has `aria-expanded`
- [ ] Collapse button has descriptive `aria-label` ("Collapse Tags section")
- [ ] Count is communicated to screen readers

---

## G.4 Alert (unified)

### TypeScript Interface (new version)

```typescript
import type { ReactNode } from 'react'

export type AlertVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info'

export type AlertProps = {
  variant?: AlertVariant
  /** Compact mode — less padding, no icon */
  compact?: boolean
  /** Dismissible — shows close button */
  dismissible?: boolean
  /** Callback when dismissed */
  onDismiss?: () => void
  /** Additional className */
  className?: string
  /** Role override — default: "alert" for destructive/warning, "status" for others */
  role?: 'alert' | 'status'
  children: ReactNode
}

// Sub-components (composition pattern):
export type AlertTitleProps = React.HTMLAttributes<HTMLHeadingElement>
export type AlertDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>
export type AlertActionProps = { children: ReactNode; className?: string }
```

### Migration guide: old API → new API

| Old (Notice) | New (Alert) | Notes |
|--------------|-------------|-------|
| `variant="error"` | `variant="destructive"` | Name aligned with Button |
| `variant="info"` | `variant="info"` | Unchanged |
| `variant="warning"` | `variant="warning"` | Unchanged |
| `title="..."` | `<AlertTitle>...</AlertTitle>` | Composition pattern |
| `message="..."` | `<AlertDescription>...</AlertDescription>` | Composition pattern |
| `action={<Button>}` | `<AlertAction><Button></AlertAction>` | Explicit slot |
| `compact` | `compact` | Prop preserved |
| `children` | `children` | Preserved — renders inside AlertDescription |

| Old (ErrorNotice) | New (Alert) | Notes |
|-------------------|-------------|-------|
| `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>{defaultTitle}</AlertTitle><AlertDescription>{defaultMsg}</AlertDescription></Alert>` | Defaults must be explicit |
| `title="X" message="Y"` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>Y</AlertDescription></Alert>` | 1:1 mapping |
| `action={btn}` | `<AlertAction>{btn}</AlertAction>` | Explicit slot |

### Backward compatibility

**Approach: backward compatible with deprecation warnings.**

Alert already exists with 5 variants. Changes:
1. **Add** `compact` prop (new, additive)
2. **Add** `dismissible` + `onDismiss` props (new, additive)
3. **Add** `AlertAction` sub-component (new, additive)
4. **Color change** in Alert to semantic tokens (visual change, not an API change)

**NOT a breaking change** — existing Alert usages work without modification. Only Notice is deprecated.

### Dismissible behavior

```typescript
const [visible, setVisible] = React.useState(true)

if (!visible) return null

return (
  <div role={role} className={cn(alertVariants({ variant }), className)}>
    {/* ... content ... */}
    {dismissible && (
      <IconButton
        variant="ghost"
        size="xs"
        aria-label="Dismiss"
        onClick={() => { setVisible(false); onDismiss?.() }}
        className="absolute top-2 right-2"
      >
        <X className="size-3" />
      </IconButton>
    )}
  </div>
)
```

### Color tokens (semantic, instead of hardcoded)

```typescript
const alertVariants = cva('...base...', {
  variants: {
    variant: {
      default:     'border-border bg-card text-card-foreground',
      destructive: 'border-status-error-border bg-status-error-bg text-status-error-text [&_svg]:text-status-error-icon',
      success:     'border-status-success-border bg-status-success-bg text-status-success-text [&_svg]:text-status-success-icon',
      warning:     'border-status-warning-border bg-status-warning-bg text-status-warning-text [&_svg]:text-status-warning-icon',
      info:        'border-status-info-border bg-status-info-bg text-status-info-text [&_svg]:text-status-info-icon',
    },
  },
})
```

### Storybook stories

1. `Default` — neutral alert
2. `Destructive` — error state
3. `Success` — success state
4. `Warning` — warning state
5. `Info` — informational
6. `WithTitle` — title + description
7. `WithAction` — with action button
8. `Dismissible` — close button
9. `Compact` — compact mode
10. `MigrationFromNotice` — side-by-side old Notice vs new Alert

### Test cases

- Unit: renders all 5 variants
- Unit: renders title, description, action
- Unit: dismissible — click close → hidden
- Unit: compact mode — smaller padding
- Unit: correct role attribute per variant
- a11y: `role="alert"` for destructive/warning, `role="status"` for info/success

### Accessibility checklist

- [ ] `role="alert"` for destructive and warning (announced immediately)
- [ ] `role="status"` for info and success (polite announcement)
- [ ] Dismiss button has `aria-label="Dismiss"`
- [ ] Icon is `aria-hidden="true"` (decorative)
- [ ] Contrast ratio meets AA for all variants in light + dark mode

---

# H. MIGRATION RISK ANALYSIS

## Risk 1: Breaking changes in Alert/Notice unification

| | |
|---|---|
| **Description** | 7 files import Notice, 2 import ErrorNotice. An API change requires editing those files. Contributors may have open PRs that use Notice. |
| **Probability** | Low — Notice is used in 9 files, not widely adopted |
| **Impact** | Low — migration is mechanical, 1:1 prop mapping |
| **Mitigation** | 1. Deprecation warning in Notice (not removed immediately). 2. Notice wrapper internally delegates to Alert (backward compatible). 3. Migration guide in PR description. 4. 2 minor versions with deprecation before removal. |
| **Rollback** | Restore Notice.tsx — git revert. Zero data loss, zero runtime risk. |

## Risk 2: Semantic tokens with insufficient contrast in dark mode

| | |
|---|---|
| **Description** | OKLCH colors are difficult to verify manually for contrast. New semantic tokens may have insufficient contrast in dark mode. |
| **Probability** | Low (after the flat tokens decision) — each status has dedicated light/dark values. Risk mainly concerns choosing correct OKLCH lightness values. |
| **Impact** | High — unreadable alerts/badges in dark mode |
| **Mitigation** | 1. Flat tokens eliminate the main risk (each mode has dedicated values). 2. Test EVERY token in Chrome DevTools Color Contrast checker. 3. axe-core automated scan in Playwright. 4. Screenshot comparison light vs dark for each component before merge. |
| **Rollback** | Changing CSS custom properties — immediate, zero code to revert. |

**Solution applied:** Flat tokens with dedicated values per mode (section I). Opacity-based approach was rejected at the design stage — see section 3.1 "Architectural decision".

## Risk 3: 372 color migrations — visual regression

| | |
|---|---|
| **Description** | Replacing 372 hardcoded colors with semantic tokens may cause unexpected visual changes. Different shades (red-500 vs red-600 vs red-700) are replaced with a single token. |
| **Probability** | Medium — most replacements are 1:1, but nuances (e.g. red-800 used intentionally as a darker variant) may be lost |
| **Impact** | Medium — visual changes, not functional |
| **Mitigation** | 1. Per-module migration (not an atomic PR) — easier to review. 2. Screenshot before/after for each PR. 3. Reviewer must confirm it looks visually correct. 4. For intentional nuances (deliberate use of red-800): add a comment `/* intentional: darker shade for X */` and use a token with a modifier (e.g. `text-status-error dark:text-status-error-emphasis`). |
| **Rollback** | Git revert per-module PR. |

**Visual regression tools:**
- Playwright screenshot comparison (already in the stack)
- Manual review in PR (screenshot before/after as attachment)
- Optional: Chromatic / Percy for automated visual diff (cost)

## Risk 4: External contributor confusion

| | |
|---|---|
| **Description** | Contributors with open PRs may be using the old API (Notice, hardcoded colors). After the DS changes are merged, their PRs will have conflicts or lint errors. |
| **Probability** | Medium — depends on the number of active PRs |
| **Impact** | Medium — contributor frustration, longer merge times |
| **Mitigation** | 1. **Changelog entry** in the DS changes PR — clear description of what changed. 2. **Migration guide** in `MIGRATION.md` or a section in AGENTS.md. 3. **Deprecation warnings** (not hard breaks) for 2 minor versions. 4. **GitHub Discussion / Issue** announcing DS changes before the hackathon. 5. Lint rules as `warn` (not `error`) for the first sprint. |
| **Rollback** | N/A — this is a communication risk, not a technical one. |

## Risk 5: CrudForm coupling

| | |
|---|---|
| **Description** | FormField wrapper and CrudForm FieldControl do similar things (label + input + error). Risk that logic begins to diverge. |
| **Probability** | Low — FormField is a simple wrapper (zero validation logic), CrudForm FieldControl is complex (loadOptions, field types, validation triggers) |
| **Impact** | Medium — inconsistent form styles between CrudForm and standalone forms |
| **Mitigation** | 1. FormField **does NOT duplicate** CrudForm logic — it is a pure layout wrapper. 2. CrudForm retains its own FieldControl. 3. Shared elements (label style, error style) extracted to **shared CSS classes** or **shared sub-components** (e.g. `FieldLabel`, `FieldError`). 4. Long-term (v1.0): CrudForm may be refactored to use FormField internally. |
| **Rollback** | N/A — FormField is additive, does not change CrudForm. |

**Target architecture:**

```
FormField (layout wrapper)
  ├── FieldLabel (shared)
  ├── {children} (input slot)
  ├── FieldDescription (shared)
  └── FieldError (shared)

CrudForm FieldControl (logic wrapper)
  ├── FieldLabel (shared)       ← same sub-components
  ├── {field type renderer}
  ├── FieldDescription (shared) ← same sub-components
  └── FieldError (shared)       ← same sub-components
```

## Risk 6: Performance — large components

| | |
|---|---|
| **Description** | AppShell (1650 lines), CrudForm (1800 lines), DataTable (1000+ lines). DS refactors (e.g. color changes, adding tokens) in these files may affect render performance. |
| **Probability** | Low — changes are CSS-only (Tailwind classes), not render logic |
| **Impact** | Low — Tailwind classes are resolved at build time, not runtime |
| **Mitigation** | 1. The DS hackathon **does NOT refactor** AppShell/CrudForm/DataTable — it only changes CSS classes. 2. Larger refactors (e.g. extracting SectionHeader from CrudForm) only in phase 2 with a performance benchmark. 3. React DevTools Profiler before and after changes. 4. `React.memo` is already used on FieldControl — preserve it. |
| **Rollback** | CSS class changes are trivial to revert. |

---

## Risk Matrix — Summary

| Risk | Probability | Impact | Overall | Mitigation priority |
|------|-------------|--------|---------|---------------------|
| R1: Alert/Notice breaking | Low | Low | **Low** | Deprecation path |
| R2: Dark mode contrast | Low (flat tokens) | High | **Medium** | Test every token |
| R3: Visual regression | Medium | Medium | **Medium** | Per-module PR + screenshots |
| R4: Contributor confusion | Medium | Medium | **Medium** | Communication plan |
| R5: CrudForm coupling | Low | Medium | **Low** | Shared sub-components |
| R6: Performance | Low | Low | **Low** | CSS-only changes |

**Top risk requiring immediate action:** R3 (visual regression from migrating 372 colors) — per-module PRs with before/after screenshots. R2 is mitigated by flat tokens, but contrast verification in Chrome DevTools remains mandatory.

---

---

# I. CONCRETE TOKEN VALUES (DRAFT)

## Existing palette context

The project uses the OKLCH color space. Key existing reference values:

```
Light:  --background: oklch(1 0 0)          /* white */
        --foreground: oklch(0.145 0 0)       /* near black */
        --card:       oklch(1 0 0)           /* white */
        --destructive: oklch(0.577 0.245 27.325) /* red */
        --muted:      oklch(0.97 0 0)        /* light grey */
        --border:     oklch(0.922 0 0)       /* grey border */

Dark:   --background: oklch(0.145 0 0)       /* near black */
        --foreground: oklch(0.985 0 0)       /* near white */
        --card:       oklch(0.205 0 0)       /* dark grey */
        --destructive: oklch(0.704 0.191 22.216)  /* lighter red */
        --muted:      oklch(0.269 0 0)       /* dark grey */
        --border:     oklch(1 0 0 / 10%)     /* white 10% */
```

## Token design principles

1. **Hue angles** drawn from existing chart colors (palette consistency):
   - Error: ~25° (hue from `--destructive` = 27.325°, `--chart-rose` = 16.439°)
   - Success: ~160° (hue from `--chart-emerald` = 163.225°)
   - Warning: ~80° (hue from `--chart-amber` = 70.08°, `--chart-4` = 84.429°)
   - Info: ~260° (hue from `--chart-blue` = 262.881°)

2. **Lightness ranges:**
   - Light mode bg: L=0.95-0.97 (subtle, near white with a tint)
   - Light mode text: L=0.30-0.40 (dark, high contrast)
   - Light mode border: L=0.80-0.85 (intermediate)
   - Light mode icon: L=0.55-0.65 (saturated, visible)
   - Dark mode bg: L=0.20-0.25 (subtle, dark with a tint)
   - Dark mode text: L=0.80-0.90 (light, high contrast)
   - Dark mode border: L=0.35-0.45 (intermediate)
   - Dark mode icon: L=0.65-0.75 (saturated, visible)

3. **Chroma (saturation):**
   - bg: low (0.01-0.03) — subtle tint, unobtrusive
   - text: medium (0.06-0.12) — distinct color, readable
   - border: low-medium (0.04-0.08)
   - icon: high (0.12-0.20) — expressive, draws the eye

## Proposed values — Light Mode

```css
:root {
  /* ═══ ERROR (hue ~25°) ═══ */
  --status-error-bg:     oklch(0.965 0.015 25);
  --status-error-text:   oklch(0.365 0.120 25);
  --status-error-border: oklch(0.830 0.060 25);
  --status-error-icon:   oklch(0.577 0.245 27.325); /* = existing --destructive */

  /* ═══ SUCCESS (hue ~160°) ═══ */
  --status-success-bg:     oklch(0.965 0.015 160);
  --status-success-text:   oklch(0.350 0.080 160);
  --status-success-border: oklch(0.830 0.050 160);
  --status-success-icon:   oklch(0.596 0.145 163.225); /* ≈ --chart-emerald */

  /* ═══ WARNING (hue ~80°) ═══ */
  --status-warning-bg:     oklch(0.970 0.020 80);
  --status-warning-text:   oklch(0.370 0.090 60);  /* hue shift to 60° — warmer, more readable */
  --status-warning-border: oklch(0.830 0.070 80);
  --status-warning-icon:   oklch(0.700 0.160 70);

  /* ═══ INFO (hue ~260°) ═══ */
  --status-info-bg:     oklch(0.965 0.015 260);
  --status-info-text:   oklch(0.370 0.100 260);
  --status-info-border: oklch(0.830 0.060 260);
  --status-info-icon:   oklch(0.546 0.245 262.881); /* = --chart-blue */

  /* ═══ NEUTRAL (achromatic) ═══ */
  --status-neutral-bg:     oklch(0.965 0 0);     /* ≈ --muted */
  --status-neutral-text:   oklch(0.445 0 0);
  --status-neutral-border: oklch(0.850 0 0);
  --status-neutral-icon:   oklch(0.556 0 0);     /* = --muted-foreground */
}
```

## Proposed values — Dark Mode

```css
.dark {
  /* ═══ ERROR (hue ~25°) ═══ */
  --status-error-bg:     oklch(0.220 0.025 25);
  --status-error-text:   oklch(0.850 0.090 25);
  --status-error-border: oklch(0.400 0.060 25);
  --status-error-icon:   oklch(0.704 0.191 22.216); /* = existing dark --destructive */

  /* ═══ SUCCESS (hue ~160°) ═══ */
  --status-success-bg:     oklch(0.220 0.025 160);
  --status-success-text:   oklch(0.850 0.080 160);
  --status-success-border: oklch(0.400 0.050 160);
  --status-success-icon:   oklch(0.696 0.170 162.480); /* = dark --chart-emerald */

  /* ═══ WARNING (hue ~80°) ═══ */
  --status-warning-bg:     oklch(0.225 0.025 80);
  --status-warning-text:   oklch(0.870 0.080 80);
  --status-warning-border: oklch(0.420 0.060 80);
  --status-warning-icon:   oklch(0.820 0.160 84.429); /* = dark --chart-amber */

  /* ═══ INFO (hue ~260°) ═══ */
  --status-info-bg:     oklch(0.220 0.025 260);
  --status-info-text:   oklch(0.840 0.080 260);
  --status-info-border: oklch(0.400 0.060 260);
  --status-info-icon:   oklch(0.623 0.214 259.815); /* = dark --chart-blue */

  /* ═══ NEUTRAL (achromatic) ═══ */
  --status-neutral-bg:     oklch(0.230 0 0);
  --status-neutral-text:   oklch(0.750 0 0);
  --status-neutral-border: oklch(0.380 0 0);
  --status-neutral-icon:   oklch(0.708 0 0);     /* = dark --muted-foreground */
}
```

## Contrast Ratio — Light Mode

| Pair | Text L | Bg L | Estimated CR | WCAG AA (4.5:1) | WCAG AAA (7:1) |
|------|--------|------|-------------|-----------------|----------------|
| error text / error bg | 0.365 / 0.965 | ~7.0:1 | PASS | PASS |
| error text / white bg | 0.365 / 1.000 | ~7.5:1 | PASS | PASS |
| error text / card bg | 0.365 / 1.000 | ~7.5:1 | PASS | PASS |
| success text / success bg | 0.350 / 0.965 | ~7.5:1 | PASS | PASS |
| success text / white bg | 0.350 / 1.000 | ~8.0:1 | PASS | PASS |
| warning text / warning bg | 0.370 / 0.970 | ~6.8:1 | PASS | BORDERLINE |
| warning text / white bg | 0.370 / 1.000 | ~7.2:1 | PASS | PASS |
| info text / info bg | 0.370 / 0.965 | ~6.8:1 | PASS | BORDERLINE |
| info text / white bg | 0.370 / 1.000 | ~7.2:1 | PASS | PASS |
| neutral text / neutral bg | 0.445 / 0.965 | ~4.7:1 | PASS | FAIL |
| neutral text / white bg | 0.445 / 1.000 | ~5.0:1 | PASS | FAIL |

## Contrast Ratio — Dark Mode

| Pair | Text L | Bg L | Estimated CR | WCAG AA (4.5:1) | WCAG AAA (7:1) |
|------|--------|------|-------------|-----------------|----------------|
| error text / error bg | 0.850 / 0.220 | ~6.5:1 | PASS | BORDERLINE |
| error text / card bg | 0.850 / 0.205 | ~7.0:1 | PASS | PASS |
| success text / success bg | 0.850 / 0.220 | ~6.5:1 | PASS | BORDERLINE |
| success text / card bg | 0.850 / 0.205 | ~7.0:1 | PASS | PASS |
| warning text / warning bg | 0.870 / 0.225 | ~6.5:1 | PASS | BORDERLINE |
| warning text / card bg | 0.870 / 0.205 | ~7.5:1 | PASS | PASS |
| info text / info bg | 0.840 / 0.220 | ~6.3:1 | PASS | BORDERLINE |
| info text / card bg | 0.840 / 0.205 | ~7.0:1 | PASS | PASS |
| neutral text / neutral bg | 0.750 / 0.230 | ~5.0:1 | PASS | FAIL |
| neutral text / card bg | 0.750 / 0.205 | ~5.5:1 | PASS | FAIL |

> **Note:** Contrast ratio in OKLCH is approximate (L is not linear as in sRGB). Final values MUST be verified in Chrome DevTools after implementation. All text/bg pairs pass WCAG AA. For AAA on colored backgrounds — borderline. On neutral backgrounds (card, background) — all pass AAA except neutral.

## Tailwind v4 Integration

```css
/* globals.css — in the @theme inline section */
@theme inline {
  --color-status-error-bg: var(--status-error-bg);
  --color-status-error-text: var(--status-error-text);
  --color-status-error-border: var(--status-error-border);
  --color-status-error-icon: var(--status-error-icon);

  --color-status-success-bg: var(--status-success-bg);
  --color-status-success-text: var(--status-success-text);
  --color-status-success-border: var(--status-success-border);
  --color-status-success-icon: var(--status-success-icon);

  --color-status-warning-bg: var(--status-warning-bg);
  --color-status-warning-text: var(--status-warning-text);
  --color-status-warning-border: var(--status-warning-border);
  --color-status-warning-icon: var(--status-warning-icon);

  --color-status-info-bg: var(--status-info-bg);
  --color-status-info-text: var(--status-info-text);
  --color-status-info-border: var(--status-info-border);
  --color-status-info-icon: var(--status-info-icon);

  --color-status-neutral-bg: var(--status-neutral-bg);
  --color-status-neutral-text: var(--status-neutral-text);
  --color-status-neutral-border: var(--status-neutral-border);
  --color-status-neutral-icon: var(--status-neutral-icon);
}
```

**Usage in components:**

```tsx
// Instead of: className="border-red-200 bg-red-50 text-red-800"
// Now:        className="border-status-error-border bg-status-error-bg text-status-error-text"

// Instead of: className="border-emerald-200 bg-emerald-50 text-emerald-900"
// Now:        className="border-status-success-border bg-status-success-bg text-status-success-text"
```

## Pre-merge verification — mandatory checklist

- [ ] All text/bg pairs verified in Chrome DevTools → Contrast ratio
- [ ] Light mode: screenshot AlertError, AlertSuccess, AlertWarning, AlertInfo, AlertNeutral
- [ ] Dark mode: screenshot AlertError, AlertSuccess, AlertWarning, AlertInfo, AlertNeutral
- [ ] Badge in light mode: StatusBadge all variants
- [ ] Badge in dark mode: StatusBadge all variants
- [ ] Flash message in both modes
- [ ] Text on `--background` (page) + `--card` (card) + status bg — 3 contexts

---

# J. MIGRATION MAPPING TABLES

## J.1 Typography Mapping

### Replacement table

| Current | Replace with | Context | Files | Replacement type |
|--------|-----------|----------|--------|-------------|
| `text-[9px]` | `text-[9px]` (KEEP) | Notification badge count — 9px is below the minimum scale. Single usage, exception. | 1 | None |
| `text-[10px]` | `text-xs` (12px) | Badge small, compact labels. 2px difference is acceptable — we gain consistency. | 15 | Regex: `s/text-\[10px\]/text-xs/g` |
| `text-[11px]` | `text-overline` (new token, 11px) | Uppercase labels, section headers, captions. This is de facto an "overline" pattern used in 33 places — deserves its own token. | 33 | 1. Add token to CSS. 2. Regex: `s/text-\[11px\]/text-overline/g` |
| `text-[12px]` | `text-xs` | Identical to text-xs (12px). 1:1 replacement. | 2 | Regex: `s/text-\[12px\]/text-xs/g` |
| `text-[13px]` | `text-sm` (14px) | Small buttons, links. 1px difference. We gain consistency at the cost of a micro visual change. | 7 | Regex: `s/text-\[13px\]/text-sm/g` |
| `text-[14px]` | `text-sm` | Identical to text-sm (14px). 1:1 replacement. | 1 | Regex: `s/text-\[14px\]/text-sm/g` |
| `text-[15px]` | `text-base` (16px) OR `text-sm` | Portal header subtitle. Context-dependent decision — if it's a subtitle under a large heading, `text-base` is better. | 2 | Manual — check context |

### `text-overline` token — definition

```css
/* globals.css — add in @theme inline */
@theme inline {
  --font-size-overline: 0.6875rem;      /* 11px */
  --font-size-overline--line-height: 1rem; /* 16px */
}
```

**Usage:**
```tsx
// Before:
<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">

// After:
<span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
```

### Letter spacing — standardization

Three variants (`tracking-wider`, `tracking-widest`, `tracking-[0.15em]`) used interchangeably with `text-[11px] uppercase`.

| Current | Replace with | Rationale |
|--------|-----------|-------------|
| `tracking-wider` | `tracking-wider` (keep) | Tailwind standard: 0.05em |
| `tracking-widest` | `tracking-wider` | Too wide (0.1em). 0.05em is sufficient. |
| `tracking-[0.15em]` | `tracking-wider` | Arbitrary. Standardizing to a single value. |

### Codemod — full script

```bash
#!/bin/bash
# ds-migrate-typography.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Run per module, then review diff

set -euo pipefail
MODULE_PATH="$1"  # e.g. packages/core/src/modules/customers

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-typography.sh <module-path>"
  exit 1
fi

echo "=== Typography migration: $MODULE_PATH ==="

# Portable in-place replace using perl (works identically on macOS and Linux)
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

replace 's/text-\[10px\]/text-xs/g'
echo "  text-[10px] → text-xs: done"

replace 's/text-\[11px\]/text-overline/g'
echo "  text-[11px] → text-overline: done"

replace 's/text-\[12px\]/text-xs/g'
echo "  text-[12px] → text-xs: done"

replace 's/text-\[13px\]/text-sm/g'
echo "  text-[13px] → text-sm: done"

replace 's/text-\[14px\]/text-sm/g'
echo "  text-[14px] → text-sm: done"

replace 's/tracking-widest/tracking-wider/g'
echo "  tracking-widest → tracking-wider: done"

replace 's/tracking-\[0\.15em\]/tracking-wider/g'
echo "  tracking-[0.15em] → tracking-wider: done"

echo "=== MANUAL CHECK NEEDED: text-[15px] (2 instances, contextual decision) ==="
rg 'text-\[15px\]' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
```

---

## J.2 Color Mapping (Semantic)

### Error colors

| Current | Occurrences | Replace with | Replacement type | Notes |
|--------|-----------|-----------|-------------|-------|
| `text-red-600` | 107 | `text-status-error-text` | Regex 1:1 | Primarily error messages, required indicators |
| `text-red-700` | 19 | `text-status-error-text` | Regex 1:1 | Error text in darker context |
| `text-red-800` | 26 | `text-status-error-text` | Regex 1:1 | Error text on light background (Notice) |
| `text-red-500` | 6 | `text-status-error-icon` | Regex 1:1 | Error icons |
| `text-red-900` | 1 | `text-status-error-text` | Regex 1:1 | |
| `bg-red-50` | 24 | `bg-status-error-bg` | Regex 1:1 | Error background |
| `bg-red-100` | 14 | `bg-status-error-bg` | Regex 1:1 | Slightly more intense bg — same token |
| `bg-red-600` | 1 | `bg-destructive` | Manual | Solid error button bg — use existing `destructive` |
| `border-red-200` | ~5 | `border-status-error-border` | Regex 1:1 | Error border |
| `border-red-500` | ~5 | `border-status-error-border` | Regex 1:1 | More intense error border |
| `text-destructive` | (keep) | — | Do not change | Already a token — correct usage |

**Note:** `text-red-600` used as a required indicator in CrudForm FieldControl (line 3418) is an internal change in `packages/ui/src/backend/CrudForm.tsx`. One PR, large impact.

### Success colors

| Current | Occurrences | Replace with | Replacement type |
|--------|-----------|-----------|-------------|
| `text-green-600` | 18 | `text-status-success-text` | Regex 1:1 |
| `text-green-700` | 2 | `text-status-success-text` | Regex 1:1 |
| `text-green-800` | 26 | `text-status-success-text` | Regex 1:1 |
| `text-green-500` | 1 | `text-status-success-icon` | Regex 1:1 |
| `bg-green-100` | 26 | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-50` | 4 | `bg-status-success-bg` | Regex 1:1 |
| `bg-green-200` | 1 | `bg-status-success-bg` | Manual — check intensity |
| `border-green-*` | ~5 | `border-status-success-border` | Regex 1:1 |
| `text-emerald-600` | 4 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-700` | 6 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-800` | 2 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-900` | 3 | `text-status-success-text` | Regex 1:1 |
| `text-emerald-300` | 1 | `text-status-success-icon` | Manual — dark context? |
| `bg-emerald-100` | 2 | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-50` | 5 | `bg-status-success-bg` | Regex 1:1 |
| `bg-emerald-500` | 4 | `bg-status-success-icon` | Manual — solid bg? May need `bg-status-success-text` |
| `bg-emerald-600` | 1 | `bg-status-success-icon` | Manual |
| `border-emerald-*` | ~5 | `border-status-success-border` | Regex 1:1 |

### Warning colors

| Current | Occurrences | Replace with | Replacement type |
|--------|-----------|-----------|-------------|
| `text-amber-500` | ~10 | `text-status-warning-icon` | Regex 1:1 |
| `text-amber-800` | ~5 | `text-status-warning-text` | Regex 1:1 |
| `text-amber-950` | ~2 | `text-status-warning-text` | Regex 1:1 |
| `bg-amber-50` | ~5 | `bg-status-warning-bg` | Regex 1:1 |
| `bg-amber-400/10` | ~2 | `bg-status-warning-bg` | Regex 1:1 |
| `border-amber-200` | ~3 | `border-status-warning-border` | Regex 1:1 |
| `border-amber-500/30` | ~2 | `border-status-warning-border` | Regex 1:1 |

### Info colors

| Current | Occurrences | Replace with | Replacement type |
|--------|-----------|-----------|-------------|
| `text-blue-600` | 27 | `text-status-info-text` | Regex 1:1 |
| `text-blue-800` | 25 | `text-status-info-text` | Regex 1:1 |
| `text-blue-700` | 8 | `text-status-info-text` | Regex 1:1 |
| `text-blue-900` | 9 | `text-status-info-text` | Regex 1:1 |
| `text-blue-500` | ~5 | `text-status-info-icon` | Regex 1:1 |
| `bg-blue-50` | 24 | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-100` | 19 | `bg-status-info-bg` | Regex 1:1 |
| `bg-blue-600` | 4 | `bg-status-info-icon` | Manual — solid bg for active state? |
| `border-blue-200` | ~3 | `border-status-info-border` | Regex 1:1 |
| `border-blue-500` | ~2 | `border-status-info-border` | Regex 1:1 |
| `border-sky-600/30` | ~2 | `border-status-info-border` | Regex 1:1 |
| `bg-sky-500/10` | ~2 | `bg-status-info-bg` | Regex 1:1 |
| `text-sky-900` | ~2 | `text-status-info-text` | Regex 1:1 |

### Codemod — full script

```bash
#!/bin/bash
# ds-migrate-colors.sh
# Portable: macOS + Linux (uses perl -i -pe instead of sed -i)
# Run per module, then review diff

set -euo pipefail
MODULE_PATH="$1"

if [ -z "$MODULE_PATH" ]; then
  echo "Usage: bash ds-migrate-colors.sh <module-path>"
  exit 1
fi

echo "=== Color migration: $MODULE_PATH ==="

# Portable in-place replace using perl
replace() {
  find "$MODULE_PATH" -name "*.tsx" -exec perl -i -pe "$1" {} +
}

# ═══ ERROR ═══
for shade in 600 700 800 900; do
  replace "s/text-red-$shade/text-status-error-text/g"
done
replace 's/text-red-500/text-status-error-icon/g'
for shade in 50 100; do
  replace "s/bg-red-$shade/bg-status-error-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-red-$shade/border-status-error-border/g"
done

# ═══ SUCCESS (green) ═══
for shade in 500 600 700 800; do
  replace "s/text-green-$shade/text-status-success-text/g"
done
for shade in 50 100 200; do
  replace "s/bg-green-$shade/bg-status-success-bg/g"
done
for shade in 200 300 500; do
  replace "s/border-green-$shade/border-status-success-border/g"
done

# ═══ SUCCESS (emerald) ═══
for shade in 300 600 700 800 900; do
  replace "s/text-emerald-$shade/text-status-success-text/g"
done
for shade in 50 100; do
  replace "s/bg-emerald-$shade/bg-status-success-bg/g"
done
for shade in 200 300; do
  replace "s/border-emerald-$shade/border-status-success-border/g"
done

# ═══ WARNING (amber) ═══
for shade in 500 800 950; do
  replace "s/text-amber-$shade/text-status-warning-text/g"
done
replace "s/bg-amber-50/bg-status-warning-bg/g"
for shade in 200 500; do
  replace "s/border-amber-$shade/border-status-warning-border/g"
done

# ═══ INFO (blue) ═══
for shade in 600 700 800 900; do
  replace "s/text-blue-$shade/text-status-info-text/g"
done
replace 's/text-blue-500/text-status-info-icon/g'
for shade in 50 100; do
  replace "s/bg-blue-$shade/bg-status-info-bg/g"
done
for shade in 200 500; do
  replace "s/border-blue-$shade/border-status-info-border/g"
done

# ═══ INFO (sky — used in Alert component) ═══
replace 's/text-sky-900/text-status-info-text/g'
replace 's/border-sky-600\/30/border-status-info-border/g'
replace 's/bg-sky-500\/10/bg-status-info-bg/g'

echo "=== MANUAL REVIEW NEEDED ==="
echo "  Check: bg-red-600, bg-emerald-500, bg-emerald-600, bg-blue-600"
echo "  These are solid backgrounds — may need different token (icon/emphasis)"
rg 'bg-red-600|bg-emerald-[56]00|bg-blue-600' "$MODULE_PATH" --type tsx || echo "  (none in this module)"

echo "=== Done. Review with: git diff $MODULE_PATH ==="
```

### Replacement in Alert component (packages/ui/src/primitives/alert.tsx)

**Current CVA variants → new:**

```typescript
// BEFORE:
destructive: 'border-destructive/60 bg-destructive/10 text-destructive [&_svg]:text-destructive',
success:     'border-emerald-600/30 bg-emerald-500/10 text-emerald-900 [&_svg]:text-emerald-600',
warning:     'border-amber-500/30 bg-amber-400/10 text-amber-950 [&_svg]:text-amber-600',
info:        'border-sky-600/30 bg-sky-500/10 text-sky-900 [&_svg]:text-sky-600',

// AFTER:
destructive: 'border-status-error-border bg-status-error-bg text-status-error-text [&_svg]:text-status-error-icon',
success:     'border-status-success-border bg-status-success-bg text-status-success-text [&_svg]:text-status-success-icon',
warning:     'border-status-warning-border bg-status-warning-bg text-status-warning-text [&_svg]:text-status-warning-icon',
info:        'border-status-info-border bg-status-info-bg text-status-info-text [&_svg]:text-status-info-icon',
```

### Replacement in Notice component (packages/ui/src/primitives/Notice.tsx)

```typescript
// BEFORE:
error:   { border: 'border-red-200',   bg: 'bg-red-50',   text: 'text-red-800',   iconBorder: 'border-red-500' }
warning: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', iconBorder: 'border-amber-500' }
info:    { border: 'border-blue-200',  bg: 'bg-blue-50',  text: 'text-blue-900',  iconBorder: 'border-blue-500' }

// AFTER (if keeping Notice with deprecation warning):
error:   { border: 'border-status-error-border',   bg: 'bg-status-error-bg',   text: 'text-status-error-text',   iconBorder: 'border-status-error-icon' }
warning: { border: 'border-status-warning-border', bg: 'bg-status-warning-bg', text: 'text-status-warning-text', iconBorder: 'border-status-warning-icon' }
info:    { border: 'border-status-info-border',    bg: 'bg-status-info-bg',    text: 'text-status-info-text',    iconBorder: 'border-status-info-icon' }
```

### Replacement in FlashMessages (packages/ui/src/backend/FlashMessages.tsx)

```typescript
// BEFORE:
const kindColors: Record<FlashKind, string> = {
  success: 'emerald-600',
  error:   'red-600',
  warning: 'amber-500',
  info:    'blue-600',
}

// AFTER:
const kindColors: Record<FlashKind, string> = {
  success: 'status-success-icon',
  error:   'status-error-icon',
  warning: 'status-warning-icon',
  info:    'status-info-icon',
}
```

### Replacement in Notifications (packages/ui/src/backend/notifications/)

```typescript
// BEFORE:
const severityColors = {
  info:    'text-blue-500',
  warning: 'text-amber-500',
  success: 'text-green-500',
  error:   'text-destructive',
}

// AFTER:
const severityColors = {
  info:    'text-status-info-icon',
  warning: 'text-status-warning-icon',
  success: 'text-status-success-icon',
  error:   'text-status-error-icon',
}
```

---

## J.3 Component Mapping (Notice → Alert)

### Prop-level mapping

| Notice usage | Alert equivalent | Notes |
|-------------|-----------------|-------|
| `<Notice variant="error">` | `<Alert variant="destructive">` | Name changed to "destructive" — consistent with Button |
| `<Notice variant="info">` | `<Alert variant="info">` | Unchanged |
| `<Notice variant="warning">` | `<Alert variant="warning">` | Unchanged |
| `title="Title"` | `<AlertTitle>Title</AlertTitle>` | Composition pattern instead of prop |
| `message="Content"` | `<AlertDescription>Content</AlertDescription>` | Composition pattern instead of prop |
| `action={<Button>Retry</Button>}` | `<AlertAction><Button>Retry</Button></AlertAction>` | Explicit slot |
| `compact` | `compact` | Preserved — less padding, no icon |
| `children` | `children` (inside Alert) | Preserved |
| `className="..."` | `className="..."` | Preserved |

### ErrorNotice mapping

| ErrorNotice usage | Alert equivalent |
|-------------------|-----------------|
| `<ErrorNotice />` (no props) | `<Alert variant="destructive"><AlertTitle>{t('ui.errors.defaultTitle')}</AlertTitle><AlertDescription>{t('ui.errors.defaultMessage')}</AlertDescription></Alert>` |
| `<ErrorNotice title="X" />` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>{t('ui.errors.defaultMessage')}</AlertDescription></Alert>` |
| `<ErrorNotice title="X" message="Y" />` | `<Alert variant="destructive"><AlertTitle>X</AlertTitle><AlertDescription>Y</AlertDescription></Alert>` |
| `<ErrorNotice action={btn} />` | `<Alert variant="destructive"><AlertTitle>...</AlertTitle><AlertDescription>...<AlertAction>{btn}</AlertAction></AlertDescription></Alert>` |

### File-by-file migration plan

| # | File | Current | Replace with | Complexity |
|---|------|--------|-----------|-----------|
| 1 | `portal/signup/page.tsx` | `<Notice variant="error" message={...} />` | `<Alert variant="destructive"><AlertDescription>{...}</AlertDescription></Alert>` | Low |
| 2 | `portal/page.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Low |
| 3 | `portal/login/page.tsx` | `<Notice variant="error" message={...} />` | `<Alert variant="destructive">...` | Low |
| 4 | `auth/frontend/login.tsx` | `<Notice variant="error" ...>` + custom error banners | `<Alert variant="destructive">...` + migration of hardcoded banners | **Medium** — also has manually styled banners |
| 5 | `audit_logs/AuditLogsActions.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Low |
| 6 | `data_sync/backend/.../page.tsx` | `<Notice variant="warning" ...>` | `<Alert variant="warning">...` | Low |
| 7 | `data_sync/.../IntegrationScheduleTab.tsx` | `<Notice variant="info" ...>` | `<Alert variant="info">...` | Low |
| 8 | `customers/deals/pipeline/page.tsx` | `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>...` | Low |
| 9 | `entities/user/[entityId]/page.tsx` | `<ErrorNotice />` | `<Alert variant="destructive"><AlertTitle>...` | Low |

**Estimated effort:** 6 files → 15 min each = 1.5h. 2 files require more attention (auth login, data_sync page) = +1h. **Total: ~2.5h.**

---

## J.4 Operation order for the hackathon

**Timing:** FRI 11.04.2026 9:00 – SAT 12.04.2026 11:00 (~13h work + ~5h buffer)

Synchronized with section B. Detailed step-by-step:

```
FRIDAY 9:00–12:00 (BLOCK 1 — Foundations):
  1. Add 20+20 CSS custom properties (flat tokens, light + dark) to globals.css
  2. Add @theme inline mappings (--color-status-*-* → var(--status-*-*))
  3. Add text-overline token (--font-size-overline: 0.6875rem)
  4. Verify contrast in Chrome DevTools (light + dark) — 5 statuses × 2 modes
  5. Document typography scale + spacing guidelines
  6. yarn lint && yarn typecheck
  → Commit: "feat(ds): add semantic status tokens and text-overline"

FRIDAY 13:00–17:00 (BLOCK 2 — Primitives migration):
  7. Replace Alert CVA variants with flat semantic tokens (alert.tsx — 4 lines)
  8. Replace Notice colors with flat tokens + add deprecation (Notice.tsx)
  9. Replace FlashMessages colors (FlashMessages.tsx)
  10. Replace Notification severity colors
  11. Add Badge status variants: success, warning, info (badge.tsx)
  12. Migrate CrudForm FieldControl colors (text-red-600 → text-destructive)
  13. yarn lint && yarn typecheck && yarn test
  → Commit: "refactor(ds): migrate all primitives to semantic status tokens"

FRIDAY 18:00–20:00 (BLOCK 3 — New components):
  14. Create FormField (packages/ui/src/primitives/form-field.tsx) with labelVariant
  15. Create StatusBadge (packages/ui/src/primitives/status-badge.tsx) — renders Badge
  16. Stretch: Section/SectionHeader (packages/ui/src/backend/Section.tsx)
  17. yarn lint && yarn typecheck
  → Commit: "feat(ds): add FormField, StatusBadge components"

FRIDAY 20:00–21:00: BREAK / BUFFER

FRIDAY 21:00–22:00 (BLOCK 4 — Documentation):
  18. Write Design Principles — condensed version for README
  19. Write PR Review Checklist
  20. Define z-index scale + border-radius guidelines
  → Commit: "docs(ds): add principles, PR review checklist, guidelines"

SATURDAY 8:00–10:00 (BLOCK 5 — Customers migration):
  21. Run ds-migrate-colors.sh on packages/core/src/modules/customers/
  22. Run ds-migrate-typography.sh on the same module
  23. Manual review + fix edge cases + screenshots before/after
  24. yarn lint && yarn typecheck && yarn test
  → Commit: "refactor(ds): migrate customers module to DS tokens"

SATURDAY 10:00–11:00 (BLOCK 6 — Wrap-up):
  25. Update AGENTS.md with DS rules
  26. Update PR template with DS compliance checkboxes
  27. Run ds-health-check.sh — save baseline to .ai/reports/
  28. Final yarn lint && yarn typecheck
  → Commit: "docs(ds): update AGENTS.md, PR template, baseline report"
```

**Buffer:** ~5h for edge cases, Section component (if not completed in B3), dark mode fine-tuning.
**Cut lines:** See section B.1 — MUST HAVE is Blocks 1+2 (8h).

---

---

## K. Module Scaffold & Contributor Guardrails

### K.1 Page Templates

Three templates cover ~95% of pages in the system. Each uses exclusively components from the design system.

#### K.1.1 List Page Template

```tsx
// backend/<module>/page.tsx — list page template
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type ColumnDef } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function ListPage() {
  const t = useT()
  const { confirm } = useConfirmDialog()
  const [rows, setRows] = useState<YourEntity[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    apiCall(`/api/your-module?page=${pagination.page}&pageSize=${pagination.pageSize}&search=${search}`)
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setRows(res.result.data)
          setPagination((prev) => ({ ...prev, total: res.result.total, totalPages: res.result.totalPages }))
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [pagination.page, pagination.pageSize, search])

  const columns: ColumnDef<YourEntity>[] = [
    { accessorKey: 'name', header: t('module.name', 'Name') },
    {
      accessorKey: 'status',
      header: t('module.status', 'Status'),
      cell: ({ row }) => (
        <StatusBadge variant={mapStatusToVariant(row.original.status)}>
          {t(`module.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
  ]

  // ✅ REQUIRED: EmptyState when no data (do not rely on an empty table)
  if (!isLoading && rows.length === 0 && !search) {
    return (
      <Page>
        <PageBody>
          <EmptyState
            title={t('module.empty.title', 'No items yet')}
            description={t('module.empty.description', 'Create your first item to get started.')}
            action={{ label: t('module.create', 'Create item'), onClick: () => router.push('create') }}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading}
          pagination={pagination}
          onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
          searchValue={search}
          onSearchChange={setSearch}
          headerActions={
            <Button size="sm" onClick={() => router.push('create')}>
              <Plus className="mr-2 h-4 w-4" />
              {t('module.create', 'Create')}
            </Button>
          }
        />
      </PageBody>
    </Page>
  )
}

// Metadata — required for RBAC and breadcrumbs
export const metadata = {
  title: 'module.list.title',
  requireAuth: true,
  requireFeatures: ['module.view'],
  breadcrumb: [{ labelKey: 'module.list.title', label: 'Items' }],
}
```

#### K.1.2 Create Page Template

```tsx
// backend/<module>/create/page.tsx — create page template
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { useRouter } from 'next/navigation'

export default function CreatePage() {
  const t = useT()
  const router = useRouter()

  const fields: CrudField[] = [
    { id: 'name', label: t('module.name', 'Name'), type: 'text', required: true },
    { id: 'status', label: t('module.status', 'Status'), type: 'select', options: STATUS_OPTIONS },
    { id: 'description', label: t('module.description', 'Description'), type: 'textarea' },
  ]

  const handleSubmit = async (values: Record<string, unknown>) => {
    const customFields = collectCustomFieldValues(values)
    const result = await createCrud('/api/your-module', { ...values, customFields })
    if (!result.ok) {
      throw createCrudFormError(
        t('module.create.error', 'Failed to create item'),
        result.errors,
      )
    }
    flash(t('module.create.success', 'Item created'), 'success')
    router.push(`/backend/your-module/${result.result.id}`)
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('module.create.title', 'Create item')}
          fields={fields}
          entityIds={['your_entity']}  {/* ← custom fields */}
          onSubmit={handleSubmit}
          backHref="/backend/your-module"
          cancelHref="/backend/your-module"
          submitLabel={t('common.create', 'Create')}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  title: 'module.create.title',
  requireAuth: true,
  requireFeatures: ['module.create'],
  breadcrumb: [
    { labelKey: 'module.list.title', label: 'Items', href: '/backend/your-module' },
    { labelKey: 'module.create.title', label: 'Create' },
  ],
}
```

#### K.1.3 Detail Page Template

```tsx
// backend/<module>/[id]/page.tsx — detail page template
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function DetailPage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const { confirm } = useConfirmDialog()
  const [data, setData] = useState<YourEntity | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiCall(`/api/your-module/${params.id}`)
      .then((res) => {
        if (cancelled) return
        if (res.ok) setData(res.result)
        else setError(t('module.detail.notFound', 'Item not found'))
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [params.id])

  // ✅ REQUIRED: LoadingMessage instead of raw Spinner
  if (isLoading) return <LoadingMessage />
  // ✅ REQUIRED: ErrorMessage instead of raw text
  if (error || !data) return <ErrorMessage message={error ?? t('module.detail.notFound', 'Not found')} />

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t('module.delete.confirm.title', 'Delete item?'),
      description: t('module.delete.confirm.description', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const result = await deleteCrud(`/api/your-module/${params.id}`)
    if (result.ok) {
      flash(t('module.delete.success', 'Item deleted'), 'success')
      router.push('/backend/your-module')
    } else {
      flash(t('module.delete.error', 'Failed to delete'), 'error')
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{data.name}</h2>
            <StatusBadge variant={mapStatusToVariant(data.status)}>
              {t(`module.status.${data.status}`, data.status)}
            </StatusBadge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push(`edit`)}>
              {t('common.edit', 'Edit')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('common.delete', 'Delete')}
            </Button>
          </div>
        </div>
        {/* Detail sections — tab layout if >3 sections */}
      </PageBody>
    </Page>
  )
}

export const metadata = {
  title: 'module.detail.title',
  requireAuth: true,
  requireFeatures: ['module.view'],
}
```

### K.2 Reference Module Documentation

The **customers** module (`packages/core/src/modules/customers/`) is the reference pattern with ~300 files. Below are the key files to study when building a new module:

| Pattern | Reference file | What to study |
|---------|-------------------|--------------|
| List with DataTable | `backend/customers/companies/page.tsx` | Columns, pagination, filters, RowActions, bulk actions |
| Create with CrudForm | `backend/customers/companies/create/page.tsx` | Form fields, validation, custom fields, flash |
| Detail with tabs | `backend/customers/companies/[id]/page.tsx` | Loading, tabs, sections, guarded mutations |
| CRUD API route | `api/companies/route.ts` | makeCrudRoute, openApi, query engine |
| Commands (Command pattern) | `commands/companies.ts` | create/update/delete with undo, before/after snapshots |
| Zod validators | `data/validators.ts` | Schema per entity, reusability |
| ORM entities | `data/entities.ts` | PK, FK, organization_id, timestamps |
| ACL features | `acl.ts` | Convention `module.action`, granularity |
| Tenant setup | `setup.ts` | defaultRoleFeatures, seedDefaults |
| Events | `events.ts` | createModuleEvents, CRUD events |
| Search config | `search.ts` | Fulltext fields, facets, entity mapping |
| Custom entities | `ce.ts` | Field declarations per entity |
| Translations | `i18n/en.json` | Keys, structure, fallbacks |

**Rule**: before writing a new module, read the **entire** `packages/core/src/modules/customers/AGENTS.md`.

### K.3 Scaffold Script

Script generating a new module skeleton with built-in page templates:

```bash
#!/usr/bin/env bash
# ds-scaffold-module.sh — scaffold a new module with DS-compliant templates
# Usage: ./ds-scaffold-module.sh <module_name> <entity_name>
# Example: ./ds-scaffold-module.sh invoices invoice

set -euo pipefail

MODULE="$1"
ENTITY="$2"

if [[ -z "$MODULE" || -z "$ENTITY" ]]; then
  echo "Usage: $0 <module_name> <entity_name>"
  echo "  module_name: plural, snake_case (e.g., invoices)"
  echo "  entity_name: singular, snake_case (e.g., invoice)"
  exit 1
fi

# Validate naming convention
if [[ "$MODULE" =~ [A-Z] ]]; then
  echo "ERROR: module_name must be snake_case (got: $MODULE)"
  exit 1
fi

MODULE_DIR="packages/core/src/modules/${MODULE}"

if [[ -d "$MODULE_DIR" ]]; then
  echo "ERROR: Module directory already exists: $MODULE_DIR"
  exit 1
fi

ENTITY_CAMEL=$(echo "$ENTITY" | perl -pe 's/_(\w)/uc($1)/ge')
ENTITY_PASCAL=$(echo "$ENTITY_CAMEL" | perl -pe 's/^(\w)/uc($1)/e')
MODULE_CAMEL=$(echo "$MODULE" | perl -pe 's/_(\w)/uc($1)/ge')

echo "Scaffolding module: $MODULE (entity: $ENTITY)"

# Create directory structure
mkdir -p "$MODULE_DIR"/{api/"$MODULE",backend/"$MODULE"/{create,"[id]"},commands,components,data,i18n,lib,widgets}

# index.ts
cat > "$MODULE_DIR/index.ts" << 'TMPL'
import type { ModuleMetadata } from '@open-mercato/shared/lib/module'

export const metadata: ModuleMetadata = {
  id: '__MODULE__',
  label: '__ENTITY_PASCAL__s',
}
TMPL
perl -i -pe "s/__MODULE__/$MODULE/g; s/__ENTITY_PASCAL__/$ENTITY_PASCAL/g" "$MODULE_DIR/index.ts"

# acl.ts
cat > "$MODULE_DIR/acl.ts" << 'TMPL'
import type { FeatureDefinition } from '@open-mercato/shared/lib/acl'

export const features: FeatureDefinition[] = [
  { id: '__MODULE__.view', label: 'View __MODULE__' },
  { id: '__MODULE__.create', label: 'Create __MODULE__' },
  { id: '__MODULE__.update', label: 'Update __MODULE__' },
  { id: '__MODULE__.delete', label: 'Delete __MODULE__' },
]
TMPL
perl -i -pe "s/__MODULE__/$MODULE/g" "$MODULE_DIR/acl.ts"

# data/validators.ts
cat > "$MODULE_DIR/data/validators.ts" << 'TMPL'
import { z } from 'zod'

export const __ENTITY_CAMEL__Schema = z.object({
  name: z.string().min(1),
})

export type __ENTITY_PASCAL__Input = z.infer<typeof __ENTITY_CAMEL__Schema>
TMPL
perl -i -pe "s/__ENTITY_CAMEL__/$ENTITY_CAMEL/g; s/__ENTITY_PASCAL__/$ENTITY_PASCAL/g" "$MODULE_DIR/data/validators.ts"

# i18n/en.json — translation keys
cat > "$MODULE_DIR/i18n/en.json" << TMPL
{
  "$MODULE": {
    "list": { "title": "${ENTITY_PASCAL}s" },
    "create": { "title": "Create $ENTITY_PASCAL", "success": "$ENTITY_PASCAL created", "error": "Failed to create" },
    "detail": { "title": "$ENTITY_PASCAL details", "notFound": "$ENTITY_PASCAL not found" },
    "delete": {
      "success": "$ENTITY_PASCAL deleted",
      "error": "Failed to delete",
      "confirm": { "title": "Delete $ENTITY_PASCAL?", "description": "This action cannot be undone." }
    },
    "empty": { "title": "No ${ENTITY_PASCAL}s yet", "description": "Create your first $ENTITY_PASCAL to get started." },
    "name": "Name",
    "status": "Status"
  }
}
TMPL

echo ""
echo "✓ Module scaffolded at: $MODULE_DIR"
echo ""
echo "Next steps:"
echo "  1. Add entities in data/entities.ts (copy pattern from customers)"
echo "  2. Add backend pages (templates already follow DS guidelines)"
echo "  3. Add API routes in api/$MODULE/route.ts"
echo "  4. Register in apps/mercato/src/modules.ts"
echo "  5. Run: yarn generate && yarn db:generate"
echo "  6. Run: yarn lint && yarn build:packages"
echo ""
echo "Reference: packages/core/src/modules/customers/"
```

**Key scaffold features:**
- Enforces snake_case for module names
- Generates i18n keys immediately (no hardcoded strings)
- Creates directory structure aligned with auto-discovery
- Does not generate pages — contributors copy from K.1 templates and adapt

---

## L. Structural Lint Rules

Six ESLint rules for enforcing the design system. The project uses ESLint v9 flat config (`eslint.config.mjs`). Rules implemented as a custom plugin `eslint-plugin-open-mercato-ds`.

### L.0 Rollout strategy

```
eslint-plugin-open-mercato-ds/
├── index.ts                    — plugin entry, exports rules + recommended config
├── rules/
│   ├── require-empty-state.ts
│   ├── require-page-wrapper.ts
│   ├── no-raw-table.ts
│   ├── require-loading-state.ts
│   ├── require-status-badge.ts
│   └── no-hardcoded-status-colors.ts
└── utils/
    └── ast-helpers.ts          — shared AST selectors
```

Adding to `eslint.config.mjs`:

```js
import omDs from './eslint-plugin-open-mercato-ds/index.js'

export default [
  // ... existing config
  {
    plugins: { 'om-ds': omDs },
    files: ['packages/core/src/modules/**/backend/**/*.tsx'],
    rules: {
      'om-ds/require-empty-state': 'warn',      // warn → error after migration
      'om-ds/require-page-wrapper': 'error',
      'om-ds/no-raw-table': 'error',
      'om-ds/require-loading-state': 'warn',
      'om-ds/require-status-badge': 'warn',
      'om-ds/no-hardcoded-status-colors': 'error',
    },
  },
]
```

**Rollout plan**: All rules start as `warn` on existing code. New modules (created after the hackathon) use `error`. After migrating a module → switch to `error` globally.

### L.1 `om-ds/require-empty-state`

**Goal**: Every page with a DataTable must have an EmptyState.

```ts
// rules/require-empty-state.ts — pseudo-implementation
import type { Rule } from 'eslint'

export const requireEmptyState: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require EmptyState component in pages that use DataTable',
    },
    messages: {
      missingEmptyState:
        'Pages with DataTable must include an EmptyState component for the zero-data case. ' +
        'Import EmptyState from @open-mercato/ui/backend/EmptyState.',
    },
    schema: [],
  },
  create(context) {
    let hasDataTable = false
    let hasEmptyState = false

    return {
      // Look for DataTable import
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source === 'string' && source.includes('DataTable')) {
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'DataTable') {
              hasDataTable = true
            }
          }
        }
        if (typeof source === 'string' && source.includes('EmptyState')) {
          hasEmptyState = true
        }
      },
      // Look for <EmptyState usage in JSX
      JSXIdentifier(node: any) {
        if (node.name === 'EmptyState') {
          hasEmptyState = true
        }
      },
      'Program:exit'(node) {
        if (hasDataTable && !hasEmptyState) {
          context.report({ node, messageId: 'missingEmptyState' })
        }
      },
    }
  },
}
```

### L.2 `om-ds/require-page-wrapper`

**Goal**: Backend pages must use `<Page>` + `<PageBody>` as a wrapper.

```ts
// rules/require-page-wrapper.ts — pseudo-implementation
export const requirePageWrapper: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require Page and PageBody wrappers in backend pages',
    },
    messages: {
      missingPage: 'Backend pages must wrap content in <Page><PageBody>...</PageBody></Page>. ' +
        'Import from @open-mercato/ui/backend/Page.',
      missingPageBody: 'Found <Page> without <PageBody> child.',
    },
    schema: [],
  },
  create(context) {
    let hasPageImport = false
    let hasPageBodyImport = false
    let hasPageJSX = false
    let hasPageBodyJSX = false

    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source === 'string' && source.includes('/Page')) {
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier') {
              if (spec.imported.name === 'Page') hasPageImport = true
              if (spec.imported.name === 'PageBody') hasPageBodyImport = true
            }
          }
        }
      },
      JSXIdentifier(node: any) {
        if (node.name === 'Page') hasPageJSX = true
        if (node.name === 'PageBody') hasPageBodyJSX = true
      },
      'Program:exit'(node) {
        // Only files in backend/ with a default export (page components)
        const filename = context.filename ?? context.getFilename()
        if (!filename.includes('/backend/')) return

        const hasDefaultExport = node.body.some(
          (n: any) => n.type === 'ExportDefaultDeclaration' ||
            (n.type === 'ExportNamedDeclaration' && n.declaration?.declarations?.[0]?.id?.name === 'default'),
        )
        if (!hasDefaultExport) return

        if (!hasPageJSX) {
          context.report({ node, messageId: 'missingPage' })
        } else if (!hasPageBodyJSX) {
          context.report({ node, messageId: 'missingPageBody' })
        }
      },
    }
  },
}
```

### L.3 `om-ds/no-raw-table`

**Goal**: Prohibit use of `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>`, `<th>` directly in backend pages. Enforce DataTable or primitives/table.

```ts
// rules/no-raw-table.ts — pseudo-implementation
const RAW_TABLE_ELEMENTS = ['table', 'thead', 'tbody', 'tr', 'td', 'th']

export const noRawTable: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw HTML table elements in backend pages',
    },
    messages: {
      noRawTable:
        'Do not use raw <{{element}}> in backend pages. ' +
        'Use DataTable from @open-mercato/ui/backend/DataTable or ' +
        'Table primitives from @open-mercato/ui/primitives/table.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node: any) {
        const filename = context.filename ?? context.getFilename()
        if (!filename.includes('/backend/')) return

        if (node.name.type === 'JSXIdentifier' && RAW_TABLE_ELEMENTS.includes(node.name.name)) {
          context.report({
            node,
            messageId: 'noRawTable',
            data: { element: node.name.name },
          })
        }
      },
    }
  },
}
```

### L.4 `om-ds/require-loading-state`

**Goal**: Pages with asynchronous data fetching must have a LoadingMessage or pass `isLoading` to DataTable.

```ts
// rules/require-loading-state.ts — pseudo-implementation
export const requireLoadingState: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require explicit loading state handling in pages with async data',
    },
    messages: {
      missingLoadingState:
        'Pages using apiCall() must handle loading state. ' +
        'Use LoadingMessage from @open-mercato/ui/backend/detail ' +
        'or pass isLoading prop to DataTable.',
    },
    schema: [],
  },
  create(context) {
    let hasApiCall = false
    let hasLoadingMessage = false
    let hasIsLoadingProp = false
    let hasSpinner = false

    return {
      CallExpression(node: any) {
        if (node.callee.name === 'apiCall' || node.callee.name === 'apiCallOrThrow') {
          hasApiCall = true
        }
      },
      JSXIdentifier(node: any) {
        if (node.name === 'LoadingMessage') hasLoadingMessage = true
        if (node.name === 'Spinner') hasSpinner = true
      },
      JSXAttribute(node: any) {
        if (node.name?.name === 'isLoading') hasIsLoadingProp = true
      },
      'Program:exit'(node) {
        if (hasApiCall && !hasLoadingMessage && !hasIsLoadingProp && !hasSpinner) {
          context.report({ node, messageId: 'missingLoadingState' })
        }
      },
    }
  },
}
```

### L.5 `om-ds/require-status-badge`

**Purpose**: Statuses (active/inactive, draft/published, etc.) must use StatusBadge, not raw text or a custom `<span>`.

```ts
// rules/require-status-badge.ts — pseudo-implementation
// Heuristic: look for DataTable columns with accessorKey containing 'status'
// that do not render StatusBadge in the cell renderer

export const requireStatusBadge: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require StatusBadge for status-like columns in DataTable',
    },
    messages: {
      useStatusBadge:
        'Status columns should use <StatusBadge> for consistent visual treatment. ' +
        'Import from @open-mercato/ui/primitives/status-badge.',
    },
    schema: [],
  },
  create(context) {
    // Heuristic: collect column definitions with accessorKey containing 'status'
    // and check whether the cell renderer contains JSX with StatusBadge or Badge

    let hasStatusBadgeImport = false
    let hasBadgeImport = false

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value)
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier') {
            if (spec.imported.name === 'StatusBadge') hasStatusBadgeImport = true
            if (spec.imported.name === 'Badge') hasBadgeImport = true
          }
        }
      },
      // Look for objects with accessorKey: '...status...' and no StatusBadge in cell
      Property(node: any) {
        if (
          node.key?.name === 'accessorKey' &&
          node.value?.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          node.value.value.toLowerCase().includes('status')
        ) {
          // If the module does not import StatusBadge or Badge — report
          if (!hasStatusBadgeImport && !hasBadgeImport) {
            context.report({ node, messageId: 'useStatusBadge' })
          }
        }
      },
    }
  },
}
```

### L.6 `om-ds/no-hardcoded-status-colors`

**Purpose**: Prohibit hardcoded status colors. Enforce semantic tokens.

```ts
// rules/no-hardcoded-status-colors.ts — pseudo-implementation
// Extension of the existing logic from section E

const FORBIDDEN_PATTERNS = [
  // Tailwind hardcoded status colors
  /\b(?:text|bg|border)-(?:red|green|yellow|orange|blue|emerald|amber|rose|lime)-\d{2,3}\b/,
  // Inline style colors for statuses
  /color:\s*(?:#(?:ef4444|f59e0b|10b981|3b82f6|dc2626|eab308))/i,
  // hardcoded oklch (should be tokens)
  /oklch\(\s*0\.(?:577|704)\s+0\.(?:245|191)\s+(?:27|22)\b/,
]

const ALLOWED_REPLACEMENTS: Record<string, string> = {
  'text-red-600': 'text-destructive',
  'text-red-500': 'text-destructive',
  'bg-red-50': 'bg-status-error-bg',
  'bg-red-100': 'bg-status-error-bg',
  'border-red-200': 'border-status-error-border',
  'text-green-600': 'text-status-success-text',
  'text-green-500': 'text-status-success-text',
  'bg-green-50': 'bg-status-success-bg',
  'bg-green-100': 'bg-status-success-bg',
  'text-yellow-600': 'text-status-warning-text',
  'text-amber-600': 'text-status-warning-text',
  'bg-yellow-50': 'bg-status-warning-bg',
  'bg-amber-50': 'bg-status-warning-bg',
  'text-blue-600': 'text-status-info-text',
  'bg-blue-50': 'bg-status-info-bg',
}

export const noHardcodedStatusColors: Rule.RuleModule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description: 'Disallow hardcoded status colors — use semantic DS tokens',
    },
    messages: {
      hardcodedColor:
        'Hardcoded status color "{{found}}" detected. ' +
        'Use semantic token instead: {{replacement}}. ' +
        'See globals.css for --status-* tokens.',
    },
    schema: [],
  },
  create(context) {
    return {
      // Check className attributes in JSX
      JSXAttribute(node: any) {
        if (node.name?.name !== 'className') return

        const value = node.value
        if (!value) return

        // String literal
        if (value.type === 'Literal' && typeof value.value === 'string') {
          checkClassString(context, node, value.value)
        }

        // Template literal
        if (value.type === 'JSXExpressionContainer' && value.expression?.type === 'TemplateLiteral') {
          for (const quasi of value.expression.quasis) {
            checkClassString(context, node, quasi.value.raw)
          }
        }
      },
    }

    function checkClassString(ctx: Rule.RuleContext, node: any, classStr: string) {
      const classes = classStr.split(/\s+/)
      for (const cls of classes) {
        const replacement = ALLOWED_REPLACEMENTS[cls]
        if (replacement) {
          ctx.report({
            node,
            messageId: 'hardcodedColor',
            data: { found: cls, replacement },
          })
        }
      }
    }
  },
}
```

### L.7 Rule Summary

| Rule | Severity (new code) | Severity (legacy) | Auto-fix |
|--------|---------------------|--------------------|----------|
| `om-ds/require-empty-state` | error | warn | ✗ |
| `om-ds/require-page-wrapper` | error | error | ✗ |
| `om-ds/no-raw-table` | error | error | ✗ |
| `om-ds/require-loading-state` | error | warn | ✗ |
| `om-ds/require-status-badge` | error | warn | ✗ |
| `om-ds/no-hardcoded-status-colors` | error | error | ✓ (suggestion) |

**Success metric**: 0 warnings on new modules, legacy warnings ↓30% per sprint.

---

## M. Contributor Onboarding — "Your First Module" Guide

### M.1 Before-You-Start Checklist

Before writing the first line of code for a new module, verify:

- [ ] **Read AGENTS.md** — the Task Router points to the relevant guides
- [ ] **Read `packages/core/AGENTS.md`** — auto-discovery, module files, conventions
- [ ] **Read `packages/core/src/modules/customers/AGENTS.md`** — the reference CRUD module
- [ ] **Read `packages/ui/AGENTS.md`** — UI components, DataTable, CrudForm
- [ ] **Checked `.ai/specs/`** — confirm whether a spec exists for your module
- [ ] **Tools installed**: `yarn`, Node ≥20, Docker (for DB)
- [ ] **Project built**: `yarn initialize` completed without errors
- [ ] **Dev server running**: `yarn dev` works, dashboard visible in the browser

### M.2 Step-by-Step: Creating a Module

**Step 1 — Scaffold**
```bash
# Option A: scaffold script (from section K.3)
./ds-scaffold-module.sh invoices invoice

# Option B: manually — copy the structure from customers and clean it up
```

**Step 2 — Define the entity**
```
data/entities.ts → MikroORM entity with id, organization_id, timestamps
data/validators.ts → Zod schema per endpoint
```
Reference: `packages/core/src/modules/customers/data/entities.ts`

**Step 3 — Add CRUD API**
```
api/<module>/route.ts → makeCrudRoute + openApi export
```
Reference: `packages/core/src/modules/customers/api/companies/route.ts`

**Step 4 — Create backend pages**
```
backend/<module>/page.tsx       → List (template K.1.1)
backend/<module>/create/page.tsx → Create (template K.1.2)
backend/<module>/[id]/page.tsx   → Detail (template K.1.3)
```
**IMPORTANT**: Every template requires — `Page`+`PageBody`, `useT()`, `EmptyState`, `LoadingMessage`/`isLoading`, `StatusBadge` for statuses.

**Step 5 — ACL + Setup**
```
acl.ts   → features: view, create, update, delete
setup.ts → defaultRoleFeatures (admin = all, user = view)
```

**Step 6 — i18n**
```
i18n/en.json → all user-facing strings
i18n/pl.json → translations (if applicable)
```

**Step 7 — Registration**
```
apps/mercato/src/modules.ts → add module
yarn generate && yarn db:generate && yarn db:migrate
```

**Step 8 — Verification**
```bash
yarn lint                 # 0 errors, 0 warnings
yarn build:packages       # builds clean
yarn test                 # existing tests pass
yarn dev                  # new module visible in sidebar
```

### M.3 Self-Check: 10 Questions Before PR

Answer YES to every question before opening a Pull Request:

| # | Question | Concerns |
|---|---------|---------|
| 1 | Does **every** list page have `<EmptyState>` with a create action? | UX |
| 2 | Do detail/edit pages have `<LoadingMessage>` and `<ErrorMessage>`? | UX |
| 3 | Do **all** user-facing strings use `useT()` / `resolveTranslations()`? | i18n |
| 4 | Are statuses rendered via `<StatusBadge>` (not raw text/span)? | Design System |
| 5 | Do status colors use semantic tokens (`text-destructive`, `bg-status-*-bg`)? | Design System |
| 6 | Do forms use `<CrudForm>` (not a manual `<form>`)? | Consistency |
| 7 | Do API routes have an `openApi` export? | Documentation |
| 8 | Do pages have `metadata` with `requireAuth` and `requireFeatures`? | Security |
| 9 | Does `setup.ts` declare `defaultRoleFeatures` for features from `acl.ts`? | RBAC |
| 10 | Does `yarn lint && yarn build:packages` pass without errors? | CI |

### M.4 Top 5 Anti-Patterns

| # | Anti-pattern | Why it's wrong | What to use instead |
|---|-------------|--------------|------------|
| 1 | **Hardcoded strings** `<h1>My Module</h1>` | Breaks i18n, blocks translations | `<h1>{t('module.title', 'My Module')}</h1>` |
| 2 | **Empty table instead of EmptyState** — DataTable with 0 rows and no CTA | User does not know what to do, bounce rate ↑ | Conditional `<EmptyState>` with a create action when `rows.length === 0 && !search` |
| 3 | **Raw `fetch()`** instead of `apiCall()` | No auth, cache, or error handling | `apiCall('/api/...')` from `@open-mercato/ui/backend/utils/apiCall` |
| 4 | **Tailwind color classes** `text-red-600`, `bg-green-100` for statuses | Inconsistent with dark mode, no central governance | Semantic tokens: `text-destructive`, `bg-status-success-bg` |
| 5 | **Missing `metadata` with RBAC** — page without `requireAuth` / `requireFeatures` | Every logged-in user sees the page, even without permissions | Add `metadata.requireFeatures: ['module.view']` |

---

---

## N. Stakeholder Buy-in Strategy

### N.1 Elevator Pitch (30 seconds)

#### Variant 1 — For a module maintainer

> Open Mercato has 372 hardcoded colors and 4 different feedback components doing the same thing — which means every PR with UI changes requires 2–3 review rounds to catch inconsistencies, and dark mode breaks every time someone adds `text-red-600`. The design system gives you 20 semantic tokens and 5 components that eliminate this entire class of bugs. Migrating your module takes 1–2 hours with the codemod script. In return: less review friction, zero dark mode regressions, and a new contributor to your module is productive in an hour instead of two days.

#### Variant 2 — For a new contributor

> Want to add a new screen to Open Mercato? Without a design system you have to browse 5 different modules to guess which colors, spacings, and components to use — and the reviewer will still send your PR back because you used `text-green-600` instead of a semantic token. With the DS you get 3 ready-made page templates (list, create, detail), 5 components that cover 95% of cases, and lint rules that tell you what to fix BEFORE you submit a PR. First screen in 30 minutes, not 3 hours.

#### Variant 3 — For a project lead / non-technical stakeholder

> Open Mercato has 34 modules and each looks slightly different — 79% of pages do not handle the empty state, status colors differ between modules, dark mode is broken in many places. To a user it looks like 34 separate applications glued together. A design system is a set of shared rules and components that makes the entire product look and behave consistently. Investment: 1 hackathon (26 h) for the foundation + 2 h per module to migrate. Return: a coherent product, faster contributor onboarding, accessibility compliance at no extra cost.

### N.2 Before/After Demo Strategy

**When to show: AFTER the hackathon** (Friday evening or Saturday morning).

Rationale: a demo BEFORE the hackathon builds expectations but has nothing to show — it is a pitch, not a demo. A demo AFTER delivers a concrete artifact: the same screen in two versions. People believe their eyes, not slides.

**What to show — 4 screenshots:**

1. **Before (light mode):** Customers list page with hardcoded `text-red-600` / `bg-green-100` status badges, no empty state, different shades of red across sections. Clearly visible: the same "active" status in one module is green `bg-green-100`, in another `bg-emerald-50`.

2. **After (light mode):** The same screen with `StatusBadge variant="success"`, `EmptyState` on the empty list, consistent colors from semantic tokens. Visually: everything "breathes" the same way, colors match each other.

3. **Before (dark mode) — KILLER DEMO:** Customers page in dark mode. Hardcoded `text-red-600` on a dark background — text barely visible. `bg-green-100` creates a garish patch. `border-red-200` is almost invisible. Notice with `bg-red-50` looks like a white rectangle.

4. **After (dark mode):** The same screen with flat semantic tokens. `--status-error-bg: oklch(0.220 0.025 25)` gives a controlled dark red. `--status-success-text: oklch(0.750 0.150 163)` is readable. Contrast is verified, not guessed.

**Where to share:** GitHub Discussion with the "Show & Tell" category. Post with 4 side-by-side screenshots. Link to that post in the project README for 2 weeks ("See what's changing"). Discussions allow async comments — no synchronous call required, which is realistic in OSS.

**Dark mode killer demo scenario script:**

> "Let me show you something. This is the customers list page — dark mode. See that 'Active' badge? `bg-green-100` on a black background. Looks like a bug. Because it is a bug — 372 times in the codebase. Now the same page after migration. Same badge, but the color comes from a token that has a separate value for dark mode. Zero changes to the logic, zero changes to the layout — the only difference is where the color comes from. Multiply that by 34 modules. That is the design system — not new components, not a redesign. It is fixing 372 colors so that dark mode just works."

### N.3 "What's In It For You" — per persona

#### 1. Module maintainer (e.g. Sales)

- **Fewer review rounds:** Instead of 2–3 rounds of comments "change text-red-600 to text-destructive", the lint rule catches it before the PR. Saves 20–30 min per review.
- **Dark mode works out of the box:** Semantic tokens switch automatically in dark mode. Zero manual testing, zero bugs of the "white text on white background" type.
- **New contributor to your module is productive faster:** Instead of explaining "how we build pages in Sales", point to the list page template from section K.1 and say "copy it, customize it". Onboarding from 2 days to 2 hours.

#### 2. New contributor (first PR)

- **Zero guessing:** 3 page templates cover 95% of cases. Copy, replace the entity name, add fields. Done.
- **Lint tells you what is wrong BEFORE the reviewer:** `om-ds/require-empty-state` highlights the issue in the editor. You do not find out about it during review after 2 days of waiting.
- **Fewer decisions:** No need to choose between `text-red-500`, `text-red-600`, `text-red-700`, `text-destructive`. There is one answer: semantic token. Always.

#### 3. Power contributor (10+ PRs, has their own approaches)

- **Your patterns become official:** If your module has well-built status badges — show how. The DS formalizes the best patterns from the codebase, it does not invent new ones.
- **Smaller diffs in PRs:** Consistent base components mean smaller page files — less code to write, less to review, smaller diffs.
- **Influence over component APIs:** The Champions program (section P) gives you a voice in shaping the API. Better to influence a standard than to migrate to it later.

#### 4. End user (Open Mercato customer)

- **Product looks professional:** Consistent colors, typography, and behavior across modules = trust in the product.
- **Dark mode actually works:** 372 fixed colors mean dark mode is usable, not decorative.
- **Empty states are not dead ends:** 79% of pages without an empty state → 0%. You always know what to do when there is no data.

#### 5. Project lead

- **Measurable progress:** `ds-health-check.sh` gives a baseline and a trend. You know how much work remains and how much has been done.
- **Accessibility without a dedicated audit:** Semantic tokens + enforced aria-labels + contrast-checked palette = WCAG 2.1 AA compliance "for free".
- **Reduced maintenance cost:** 4 feedback components → 1. 372 hardcoded colors → 20 tokens. Less code = fewer bugs = less work.

---

## O. Contributor Experience (CX) Design

### O.1 Contributor Journey Map

#### Step 1: Discovery — "What components exist?"

| | Current state (without DS) | Target state (with DS) |
|---|---|---|
| **What they do** | Browse `packages/ui/src/primitives/`, grep "import.*from.*ui", open customers module and read code | Open `packages/ui/DS.md`, scan the component index |
| **What they are looking for** | "Is there a component for status?" "What is Notice vs Alert?" | Component list with a one-line description and a link |
| **What can go wrong** | Finds Notice and Alert, does not know which to use. Builds their own. | Sees clearly: "Alert (unified) — use this. Notice is deprecated." |
| **How DS helps** | — | Single entry point with a searchable component list, with "when to use" |

#### Step 2: Decision — "Which component to use?"

| | Current state | Target state |
|---|---|---|
| **What they do** | Compares 3–4 modules, looks at how others solved the problem. Copies from the one that looks most recent. | Looks at the decision tree in DS docs: "Displaying a status? → StatusBadge. A list of data? → DataTable. A form? → CrudForm." |
| **What can go wrong** | Copies from a module that has legacy patterns (hardcoded colors). Now legacy has propagated to the new module. | Decision tree points to the correct component. Template from K.1 provides ready-made code. |
| **How DS helps** | — | Decision tree + "Use This Not That" table (Notice❌ → Alert✅, raw table❌ → DataTable✅) |

#### Step 3: Implementation — "How do I use it?"

| | Current state | Target state |
|---|---|---|
| **What they do** | Opens customers module, copies page.tsx, modifies it. Does not know about EmptyState, does not know about StatusBadge. | Copies template from K.1, replaces names. TypeScript suggests props. |
| **What can go wrong** | Forgets the empty state (79% of pages). Uses hardcoded colors (because they copied from an old module). | Template includes EmptyState. Lint rule catches hardcoded colors. |
| **How DS helps** | — | Templates with built-in best practices + lint rules as a safety net |

#### Step 4: Self-check — "Did I do it right?"

| | Current state | Target state |
|---|---|---|
| **What they do** | `yarn lint` (catches only TypeScript/ESLint basics). Visually checks in the browser. | `yarn lint` catches DS violations. 10-question self-check from M.3. |
| **What can go wrong** | Lint does not catch a missing EmptyState. Contributor does not know they should check dark mode. | 6 DS lint rules give specific feedback. Self-check reminds about dark mode. |
| **How DS helps** | — | Lint rules + self-check checklist + ds-health-check.sh on their module |

#### Step 5: PR review — "What does the reviewer check?"

| | Current state | Target state |
|---|---|---|
| **What they do** | Waits for review 1–3 days. Reviewer comments: "change color", "add empty state", "use apiCall". 2–3 rounds. | Lint caught 80% of issues before the PR. Reviewer checks logic and UX, not colors. 1 round. |
| **What can go wrong** | Reviewer does not know DS guidelines — lets hardcoded colors through. Or: reviewer is too strict — contributor gets discouraged. | PR template with DS checklist (from section E). Reviewer has clear criteria — not "my opinion" but "DS standard". |
| **How DS helps** | — | PR template + reviewer checklist + lint pre-screening |

#### Step 6: Post-merge — "How do I learn for next time?"

| | Current state | Target state |
|---|---|---|
| **What they do** | Nothing. Review feedback is lost in the closed PR. Makes the same mistakes next time. | DS entry point has a "Common Mistakes" section (M.4). Monthly digest highlights recurring issues. |
| **What can go wrong** | Tribal knowledge — contributor #2 does not see the feedback from contributor #1's PR. | Review feedback is generalized into DS docs. Anti-patterns (M.4) is a living document. |
| **How DS helps** | — | Anti-patterns doc + monthly digest + feedback channel |

### O.2 Single Entry Point

**Decision: `packages/ui/DS.md`** — at the root of the UI package.

Rationale:
- **Not AGENTS.md** — that is for AI agents, not humans. A contributor will not look for DS guidelines in AGENTS.md.
- **Not docs/** — docs/ is a separate documentation app. DS guidelines must live close to the code, not in a separate deploy.
- **Not Storybook** — Storybook is not in the project and setting it up is a separate 2+ day effort. Pragmatism > idealism.
- **Why packages/ui/** — a contributor building UI opens that package anyway. Minimum distance between "I'm looking" and "I found it".

**Content outline:**

```markdown
# Open Mercato Design System

> Consistency > Perfection. See Section T.4 for our philosophy.

## Quick Start (30 seconds)
Building a new page? Copy a template from `templates/` and customize.

## Component Reference
One-line description + import path for each DS component.
| Component | When to Use | Import |
|-----------|-------------|--------|

## Decision Tree
"What component do I need?" — flowchart from task → component.

## Tokens
Status colors, typography scale, spacing — link to globals.css with commentary.

## Use This, Not That
| Instead of... | Use... | Why |
Notice | Alert | Notice is deprecated, Alert has all variants
text-red-600 | text-destructive | Semantic token, works in dark mode
raw <table> | DataTable | Sorting, filtering, pagination built-in

## Templates
Links to K.1 templates: list page, create page, detail page.

## Self-Check Before PR
Link to M.3 — 10 questions.

## Anti-Patterns
Link to M.4 — top 5 mistakes.

## Feedback & Questions
GitHub Discussion category "Design System Feedback".
```

**Constraint: 60 seconds to find an answer.** That is why tables, not paragraphs. Links, not repeated content. Component Reference is at most 15 rows — that is how many DS components there are.

### O.3 Lint Error UX

#### 1. `om-ds/no-hardcoded-status-colors`

```
[om-ds/no-hardcoded-status-colors]
❌ Hardcoded color "text-red-600" in className. Status colors must use semantic tokens.
✅ Replace with: "text-destructive" (for text) or "text-status-error-text" (for status context)
📖 See: packages/ui/DS.md#tokens → Status Colors
```

#### 2. `om-ds/no-arbitrary-text-sizes`

```
[om-ds/no-arbitrary-text-sizes]
❌ Arbitrary text size "text-[11px]" detected. Use Tailwind scale or DS tokens.
✅ Replace with: "text-overline" (for 11px uppercase labels) or "text-xs" (for 12px small text)
📖 See: packages/ui/DS.md#tokens → Typography Scale
```

#### 3. `om-ds/require-empty-state`

```
[om-ds/require-empty-state]
❌ Page uses <DataTable> but has no <EmptyState> component.
   79% of existing pages miss this — don't add to the count.
✅ Add conditional EmptyState before DataTable:
   if (!isLoading && rows.length === 0 && !search) return <EmptyState title="..." action={{...}} />
📖 See: packages/ui/DS.md#templates → List Page Template
```

#### 4. `om-ds/require-page-wrapper`

```
[om-ds/require-page-wrapper]
❌ Backend page missing <Page> and <PageBody> wrappers.
   These provide consistent spacing (space-y-6, space-y-4) and page structure.
✅ Wrap your page content:
   <Page><PageBody>{/* your content */}</PageBody></Page>
📖 See: packages/ui/DS.md#templates → any template
```

#### 5. `om-ds/no-raw-table`

```
[om-ds/no-raw-table]
❌ Raw HTML <table> element in backend page. Use DS table components.
✅ For data lists: <DataTable> (sorting, filtering, pagination built-in)
   For simple key-value: <Table> from @open-mercato/ui/primitives/table
📖 See: packages/ui/DS.md#decision-tree → "Displaying data?"
```

#### 6. `om-ds/require-loading-state`

```
[om-ds/require-loading-state]
❌ Page uses apiCall() but has no loading state handler.
   41% of existing pages miss this — users see blank screens during data fetch.
✅ For detail pages: if (isLoading) return <LoadingMessage />
   For list pages: pass isLoading={isLoading} to <DataTable>
📖 See: packages/ui/DS.md#templates → Detail Page Template
```

---

## P. Champions Strategy

### P.1 Champion Profile

**Ideal DS champion in an OSS context:**

**Technical traits:**
- Active in a module with a large UI surface (Sales, Catalog, Customers — not CLI/Queue)
- Has at least 5 merged PRs with backend page components
- Understands Tailwind and React well enough to refactor colors without assistance

**Soft traits:**
- Responds to issues / code review comments (not a ghost contributor)
- Has expressed frustration with UI inconsistency or dark mode bugs (natural motivation)
- Has an "ownership feeling" about their module — wants it to look good

**How to find them in Open Mercato:**

```bash
# Top 10 contributors to backend page files (last 6 months)
git log --since="2025-10-01" --format="%aN" \
  -- "packages/core/src/modules/*/backend/**/*.tsx" \
  | sort | uniq -c | sort -rn | head -10

# Contributors who fixed colors/dark mode (motivation signal)
git log --since="2025-10-01" --all --oneline --grep="dark\|color\|theme" \
  -- "packages/core/src/modules/*/backend/**" | head -20

# Modules with the most DS debt (migration targets)
for module in packages/core/src/modules/*/; do
  count=$(grep -r "text-red-\|bg-green-\|bg-blue-\|text-green-\|bg-red-" "$module" 2>/dev/null | wc -l)
  echo "$count $(basename $module)"
done | sort -rn | head -10
```

**What motivates them:**
- **Recognition:** Being listed as a DS champion in the changelog and README
- **Clean code ownership:** Their module is exemplary, not legacy
- **Influence:** Shaping component APIs instead of just consuming them
- **Learning:** Gaining real-world experience with design systems

### P.2 Champion Program — concrete plan

#### 1. Identification (before the hackathon)

**Criteria:** ≥5 PRs with UI changes + activity in the last 3 months + module with >10 hardcoded status colors.

Run the commands from P.1. Select 3–5 people: ideally one each from Sales, Catalog, HR/Workflows, and Integrations.

#### 2. Recruitment (on hackathon day)

**Message (GitHub Discussion mention or DM):**

> Hey @{username}, I see you maintain the {module} module — you have a great {specific thing, e.g. "detail page with tabs"} there. We are working on design system foundations for Open Mercato and looking for 3–5 people to migrate their module as the first adopters (after customers). What you get: your module becomes the reference pattern, you have influence over the APIs of new components (StatusBadge, FormField), and you get early access to tokens + codemod scripts that automate 80% of the work. Interested? The total effort is ~2 h with codemod + 1 h manual review. DM me if you want to chat on a call or async.

#### 3. Champion onboarding (week 1)

What they receive:
- **Early access:** Branch `docs/design-system-audit-2026-04-10` with tokens and components, before it lands on main
- **15-min async walkthrough:** Loom recording (not a synchronous call — respect timezones) showing: (a) before/after demo from N.2, (b) how to use the codemod script, (c) how to verify the result
- **Their module as target:** Codemod script prepared to run on their module — the champion runs it, reviews the diff, commits

#### 4. Activation (weeks 2–3)

What they do:
- **Migrate their module** — run codemod, review diff, fix edge cases, open PR
- **Review DS PRs:** Added as reviewers on PRs in other modules labeled `design-system` — check token usage and component patterns
- **Feedback loop:** Report issues with component APIs, unclear token names, missing variants. Format: GitHub Discussion post "DS Feedback: {topic}" with a concrete example

#### 5. Recognition (ongoing)

- **Changelog mention:** "Module {name} migrated to DS tokens by @{champion}" in RELEASE_NOTES.md
- **CONTRIBUTORS.md:** "Design System Champions" section listing contributors and their modules
- **GitHub label:** `ds-champion` on their contributor profile (if the project has such mechanisms) — in practice a mention in Discussion and the changelog is sufficient

### P.3 First Follower Strategy

**Who to convince FIRST: the Sales module maintainer.**

Why Sales:
- **Largest UI surface after customers** — orders, quotes, invoices, shipments, payments. Many status badges (draft → confirmed → shipped → paid → cancelled).
- **Most hardcoded status colors** — each document type has a different color palette (quote = blue, order = green, invoice = amber). This is the most visible DS debt.
- **Success in Sales is spectacular** — changing status colors across 5 document types at once produces a wow effect. The before/after demo with the Sales module is 3× more convincing than with a simple module.
- **Sales maintainer is motivated** — dark mode in Sales is particularly broken (hardcoded colors on dark backgrounds in document tables).

**Which module migrates FIRST after customers: Sales.**

For the same reason. Customers is the proof of concept (DS maintainers do it themselves). Sales is the proof of adoption (someone else does it with DS tools). This is the transition from "we did it" to "others can do it too".

**How the first follower's success convinces the next ones:**

1. Sales champion opens a migration PR — visible in the activity feed
2. PR has before/after screenshots (dark mode fix = impressive)
3. Discussion post: "Migrated Sales to DS tokens — 47 hardcoded colors → 0. Took 2 hours with codemod."
4. Other maintainers (Catalog, Workflows, Integrations) see: this is not theory, it is 2 hours of work with a concrete result
5. FOMO effect: "My module looks worse than Sales in dark mode. I should migrate."

Migration order after Sales: **Catalog** (products, variants, prices — many statuses), then **Workflows** (visual editor, status badges on steps), then remaining modules organically.

---

## Q. Guerrilla Research Plan

### Q.1 "5 Questions, 3 People, 15 Minutes"

**Who to ask:**
1. An active module maintainer (≥10 PRs, knows the codebase)
2. An occasional contributor (2–5 PRs, knows parts of it)
3. A prospective contributor (follows the repo, may have opened 1 issue, has not committed yet)

**How to conduct it: Async survey via GitHub Discussion.**

Rationale: A synchronous call requires timezone coordination and discourages introverted contributors. A Discussion post with questions lets someone answer when they have 10 minutes. Additionally: answers are public, which sets a precedent for open communication about DS.

**5 questions:**

1. **"The last time you built a new screen (or modified an existing one) — how did you know which components to use? What did you open first?"**
   Goal: Discover the discovery path. Do they grep? Copy from another module? Ask someone?

2. **"Has a reviewer ever asked you to change a color, spacing, or component in your PR? If so — did you understand why that change was needed?"**
   Goal: Measure review friction and understand whether the contributor understands the rules or just follows orders.

3. **"If you had to build a list page with a table, statuses, and an empty state tomorrow — where would you start? Which module would you open as a reference?"**
   Goal: Discover which module is de facto the reference (may not be customers!) and what the contributor's mental model is.

4. **"What is the most annoying thing about building UI in Open Mercato? One specific thing."**
   Goal: Discover friction points invisible in a code audit. May be lack of hot reload, slow build, or unclear code navigation.

5. **"If you could change one thing about how Open Mercato UI looks or works — what would it be?"**
   Goal: Validate priorities. If 3/3 people say "dark mode is broken" — we know semantic tokens are the right priority. If they say "no mobile view" — we know our priorities may need adjustment.

**Template for results summary (1 page):**

```markdown
## DS Research Summary — [date]

### Participants
- [persona 1]: [module/role], [number of PRs]
- [persona 2]: ...
- [persona 3]: ...

### Key Findings
1. **Discovery path:** [how they find components — e.g. "2/3 copy from customers"]
2. **Review friction:** [number of rounds, whether they understand the rules — e.g. "nobody knew about semantic tokens"]
3. **Reference module:** [which module they consider exemplary]
4. **Top friction point:** [what annoys them most]
5. **Top wish:** [what they would change]

### Impact on DS Plan
- [What we confirm — e.g. "semantic tokens are the correct priority #1"]
- [What we change — e.g. "adding hot reload to hackathon scope because 2/3 people complain"]
- [What we add — e.g. "need to document why customers and not sales is the reference"]
```

### Q.2 Hallway Testing — Component APIs

**Task for the contributor (verbatim):**

> I have a TypeScript interface for a new FormField component. Without looking at documentation — write me JSX that displays a form with 3 fields: Name (text, required), Email (text, with description "We'll never share your email"), Status (select, with error "Status is required"). You can use any components inside FormField. You have 3 minutes.

```typescript
// What you give the contributor:
interface FormFieldProps {
  label?: string
  id?: string
  required?: boolean
  labelVariant?: 'default' | 'overline'
  description?: string
  error?: string
  orientation?: 'vertical' | 'horizontal'
  disabled?: boolean
  children: React.ReactNode
}
```

**What you observe (rubric):**

| Aspect | Success (5 pts) | Issues (3 pts) | Failure (1 pt) |
|--------|----------------|-------------------|-----------------|
| **Understanding the children pattern** | Immediately inserts `<Input>` as children | Asks "is this a slot?" but understands shortly after | Tries to pass input as a prop |
| **Required indicator** | Uses `required={true}` and expects the label to change | Manually adds an asterisk in the label | Does not know how to mark a field as required |
| **Error handling** | Passes `error="..."` and does not add a manual error display | Asks "does the error display automatically?" | Adds a manual `<span className="text-red-600">` below the field |
| **Naming intuition** | Does not ask about any prop name | Asks about 1 prop name | Asks about ≥3 prop names |
| **Time** | <2 min | 2–3 min | >3 min or does not finish |

**If the contributor scores ≤3 on "children pattern":** Consider changing the API to an `input` prop instead of `children`. If ≥4 on everything: the API is intuitive.

### Q.3 Observation Protocol — "Watch One, Do One"

**When: AFTER the hackathon** (week 2). Rationale: Validate whether DS artifacts (templates, tokens, lint rules) work in practice, not in theory.

**Setup:**

> "Imagine that the Sales module needs a new page: a warranties list with a table, statuses (active/expired/pending), an empty state, and the ability to create a new warranty. Build the list page. You have 30 minutes. You can use any files in the repo. Think aloud — e.g. 'opening customers to see the pattern'. Do not ask me for help — work as you would on your own."

**Observation — what you note:**

| Time | Note |
|------|----------|
| 0:00–2:00 | **Where they look:** Opens DS.md? Customers module? Greps? Googles? |
| 2:00–5:00 | **What they copy:** Which template/module? Do they use K.1? |
| 5:00–15:00 | **Where they get stuck:** Import paths? Token names? StatusBadge API? EmptyState props? |
| 15:00–25:00 | **What they skip:** Do they add EmptyState? Loading state? useT()? metadata? |
| 25:00–30:00 | **Whether lint helped:** Do they run lint? Did lint catch issues? |

**Observation rule:** Do not help, do not comment, do not nod approvingly. Take notes. The only exception: if the contributor is blocked for >3 min on the same point, you may say "move on, we'll come back to it".

**Debrief (3 questions):**

1. "What was the easiest part of building this page?"
2. "Where did you stop the longest — and why?"
3. "If you could change one tool/file/component to make it faster — what would it be?"

---

## R. Decision Log

### R.1 Decision Record Format

```markdown
### DR-NNN: [Decision title]
**Date:** YYYY-MM-DD
**Status:** Accepted | Proposed | Deprecated
**Context:** [1–2 sentences — what problem we are solving]
**Decision:** [1–2 sentences — what we decided]
**Rationale:** [2–3 sentences — why this and not something else]
**Alternatives considered:** [list of rejected options with a 1-sentence reason each]
**Consequences:** [what this means in practice]
```

**Where to store: `packages/ui/decisions/` as DR-NNN.md files.**

Rationale: Next to the code, versioned in git, reviewed in PRs. Not GitHub Discussions — those get buried in the feed and are not versioned. Not in the main DS document — it grows too fast. Separate files = easy to link from PR comments ("see DR-001 for why we don't use opacity tokens").

### R.2 Key decisions

#### DR-001: Flat tokens instead of opacity-based
**Date:** 2026-04-10
**Status:** Accepted
**Context:** We need status color tokens (error/success/warning/info) with separate values for bg, text, border, icon. Options: one base token + opacity modifiers in Tailwind (`bg-status-error/5`) vs separate flat tokens per role.
**Decision:** Flat tokens — a separate CSS custom property per role with the full color value, separate for light and dark mode.
**Rationale:** Opacity-based tokens do not control contrast in dark mode. `oklch(0.577 0.245 27) / 5%` on a white background gives a subtle pink, but on a black background it is invisible. Flat tokens give full contrast control in both modes. 20 additional custom properties is an acceptable cost for guaranteed accessibility.
**Alternatives considered:** Opacity-based (fewer tokens, but broken dark mode), hybrid (complex, two mental models).
**Consequences:** 20+20 CSS custom properties (light+dark). Naming: `--status-{status}-{role}`. Tailwind mapping via `@theme inline`.

#### DR-002: Geist Sans as primary font
**Date:** 2026-04-10
**Status:** Accepted
**Context:** The project has used Geist Sans from the start. Alternatives are Inter (popular in SaaS) or a System UI stack (zero web font loading).
**Decision:** Keep Geist Sans. Zero changes.
**Rationale:** Geist is already deployed with font optimization in Next.js. Changing the font changes the visual identity — out of scope for DS foundation. Geist has excellent rendering at small sizes, which is critical for dense data UI like ERP.
**Alternatives considered:** Inter (requires migration, minimal visual difference), System UI (inconsistent across OS).
**Consequences:** No additional work. Font loaded via `next/font/local`.

#### DR-003: lucide-react as the only icon library
**Date:** 2026-04-10
**Status:** Accepted
**Context:** The codebase uses lucide-react plus 14 files with inline SVG (portal, auth, workflows). Available alternatives: Phosphor, Heroicons, mix.
**Decision:** lucide-react as the sole icon source. Inline SVG to be migrated.
**Rationale:** lucide-react is already the dominant library in the project. It has 1400+ icons, consistent stroke width (2px default), and is tree-shakeable. Adding a second icon library guarantees inconsistency (different stroke widths, sizing conventions). 14 inline SVGs is a one-time migration.
**Alternatives considered:** Phosphor (6 weight variants — overkill), Heroicons (smaller set, different style), mix (inconsistent).
**Consequences:** New icons from lucide-react only. Inline SVG migrated as part of module migration.

#### DR-004: Alert as the unified feedback component
**Date:** 2026-04-10
**Status:** Accepted
**Context:** Two inline feedback components — Notice (3 variants, 7 imports) and Alert (5 variants, 18 imports). Different APIs, different colors.
**Decision:** Alert as primary. Notice deprecated with a bridge period of ≥1 minor version.
**Rationale:** Alert has more variants (5 vs 3), more imports (18 vs 7), and uses CVA (easy to extend). Notice adds only a `compact` prop — easy to add to Alert. Unifying 4 different color palettes (section 1.5) for the same semantic purpose requires a single source of truth.
**Alternatives considered:** Notice as primary (fewer variants, less adoption), new component (unnecessary churn), maintaining both (perpetuates inconsistency).
**Consequences:** Alert extended with `compact?`, `dismissible?`, `onDismiss?`. Notice ← `@deprecated` JSDoc + runtime console.warn. 7 Notice imports to migrate.

#### DR-005: FormField as a component separate from CrudForm
**Date:** 2026-04-10
**Status:** Accepted
**Context:** CrudForm (1800 lines) has a built-in FieldControl with label + input + error. Portal and auth pages build forms manually with inconsistent styling. A reusable form field wrapper is needed.
**Decision:** New `FormField` primitive in `packages/ui/src/primitives/form-field.tsx`, independent of CrudForm.
**Rationale:** Refactoring CrudForm to expose FieldControl as a public API requires changes to an 1800-line file used on ~20 pages — the regression risk is too high for a hackathon. A separate FormField is simple, testable, and immediately useful in portal/auth pages. CrudForm can adopt it internally in a future iteration.
**Alternatives considered:** Refactoring CrudForm (high risk, high reward but wrong timing), extract from CrudForm (tight coupling to CrudForm internals).
**Consequences:** FormField: `label?`, `required?`, `labelVariant?`, `description?`, `error?`, `children`. CrudForm still uses the internal FieldControl. Unification in a future iteration.

#### DR-006: OKLCH color space
**Date:** 2026-04-10
**Status:** Accepted
**Context:** The project already uses OKLCH in CSS custom properties (globals.css). Alternatives: HSL (more widely understood), hex (traditional).
**Decision:** Keep OKLCH.
**Rationale:** OKLCH is perceptually uniform — changing lightness by the same amount gives a perceived change in brightness. This is critical for generating consistent status palettes (error, success, warning, info) with controlled contrast. HSL is not perceptually uniform — `hsl(0, 70%, 50%)` and `hsl(120, 70%, 50%)` have different perceived brightness. OKLCH is already implemented — changing it is a cost with no benefit.
**Alternatives considered:** HSL (wider support, not perceptually uniform), hex (no manipulation possible).
**Consequences:** All new tokens in OKLCH. Contrast checking requires OKLCH-aware tooling (Chrome DevTools 120+).

#### DR-007: Tailwind scale + text-overline instead of a custom type scale
**Date:** 2026-04-10
**Status:** Accepted
**Context:** 61 arbitrary text sizes (text-[11px], text-[13px], etc.). Options: full custom typography scale (heading-1 through caption) vs leveraging Tailwind + a single custom token.
**Decision:** Tailwind scale as primary + one custom token `text-overline` (11px, uppercase, tracking-wider) for the label pattern.
**Rationale:** A full custom scale duplicates what Tailwind already provides (text-xs, text-sm, text-base, text-lg, text-xl, text-2xl). The only missing size is the 11px uppercase label (33 occurrences of text-[11px]) — it gets a dedicated token. The rest of the arbitrary sizes (text-[13px], text-[10px]) map to the nearest Tailwind size.
**Alternatives considered:** Full custom scale (maintenance burden, duplicates Tailwind), no custom tokens (loses the 11px pattern).
**Consequences:** `--font-size-overline: 0.6875rem`. Codemod maps: `text-[11px]` → `text-overline`, `text-[13px]` → `text-sm`, `text-[10px]` → `text-xs`.

#### DR-008: Per-module migration instead of big-bang
**Date:** 2026-04-10
**Status:** Accepted
**Context:** 372 hardcoded colors across 34 modules. Options: migrate everything at once (big-bang) vs module by module.
**Decision:** Per-module migration. Customers → Sales → Catalog → rest organically.
**Rationale:** Big-bang creates a massive PR (100+ files) that is impossible to review, easy to break, and blocks all other PRs during merge. Per-module: each PR is 5–15 files, reviewable in 30 minutes, merge does not block others. The codemod script (section J) automates 80% of the work. It also allows validation — if the customers migration reveals a problem with tokens, we fix it BEFORE migrating 33 more modules.
**Alternatives considered:** Big-bang (fast but high risk, unreviewable), file-by-file (too granular, PR spam).
**Consequences:** ~34 migration PRs, 1–2 h each. Lint rules `warn` on legacy, `error` on new code. Dashboard (`ds-health-check.sh`) tracks progress.

#### DR-009: warn-then-error lint strategy
**Date:** 2026-04-10
**Status:** Accepted
**Context:** 6 new DS lint rules. Options: error immediately (blocks CI), warn (informs without blocking), warn→error after migration.
**Decision:** warn on legacy, error on new modules. After module migration → error globally.
**Rationale:** Immediate error on 372 violations = blocked CI for the entire project. Nobody merges anything until someone fixes legacy. This paralyzes development. warn lets work continue while educating (contributor sees warning, learns). error on new files prevents new legacy. Gradual ramp-up.
**Alternatives considered:** Immediate error (blocks CI), warn forever (no enforcement), eslint-disable (defeats purpose).
**Consequences:** ESLint config with two blocks — strict for new files, lenient for legacy. After module migration: move files to strict.

#### DR-010: StatusBadge + StatusMap pattern
**Date:** 2026-04-10
**Status:** Accepted
**Context:** Each module defines its own status colors (hardcoded). Options: extend Badge with status variants vs a separate StatusBadge.
**Decision:** Separate StatusBadge (semantic wrapper) that renders Badge internally. Badge gets new CVA variants (success, warning, info).
**Rationale:** StatusBadge and Badge have different API contracts. Badge is a generic visual component (`variant: 'default'|'secondary'|'destructive'|...`). StatusBadge is a semantic component (`variant: 'success'|'warning'|'error'|'info'|'neutral'`) — the contributor thinks "what status?" not "what style?". A separate component enables adding a `dot` indicator, animations, and status→variant mapping without polluting Badge. Internally: `StatusBadge variant="success"` → `Badge variant="success"`.
**Alternatives considered:** Extend Badge only (mixes semantic and visual concerns), StatusBadge without Badge (duplication).
**Consequences:** `StatusBadge` in `packages/ui/src/primitives/status-badge.tsx`. Badge in `badge.tsx` ← 3 new CVA variants. Zero breaking changes to the existing Badge API.

---

## S. Success Metrics Beyond Code

### S.1 Contributor Experience Metrics

#### 1. Time to First DS-Compliant PR

| | |
|---|---|
| **How to measure** | Timestamp of first UI-related commit → timestamp of merge. Filter: PRs from new contributors (≤3 prior PRs) modifying `backend/**/*.tsx` files. |
| **Baseline** | Unknown — measure retrospectively from git log (5 most recent new contributor PRs). Estimate: 3–5 days (including review rounds). |
| **Target** | ≤2 days (including review). |
| **Cadence** | Per PR (automatic via git log), summarized monthly. |
| **Command** | `git log --format="%H %aI" --diff-filter=A -- "packages/core/src/modules/*/backend/**/*.tsx" \| head -20` |

#### 2. Review Rounds per UI PR

| | |
|---|---|
| **How to measure** | Count "changes requested" reviews on PRs modifying `backend/**/*.tsx`. Use GitHub API: `gh pr list --search "review:changes-requested" --json number,reviews`. |
| **Baseline** | Estimate: 2–3 rounds (based on audit findings — 372 hardcoded colors = many review comments). |
| **Target** | ≤1 round (lint rules catch mechanical issues, reviewer checks logic). |
| **Cadence** | Monthly aggregate. |

#### 3. DS Component Adoption Rate

| | |
|---|---|
| **How to measure** | % of new `page.tsx` files (added in the last 30 days) importing ≥3 DS components from the list: Page, PageBody, DataTable, CrudForm, EmptyState, StatusBadge, LoadingMessage, FormField. |
| **Baseline** | ~20% (estimate from audit — most pages do not use EmptyState, StatusBadge). |
| **Target** | 80% after 3 months, 95% after 6 months. |
| **Cadence** | Monthly. |
| **Command** | `git log --since="30 days ago" --diff-filter=A --name-only -- "**/backend/**/page.tsx" \| xargs grep -l "EmptyState\|StatusBadge\|LoadingMessage" \| wc -l` |

#### 4. DS Bypass Rate

| | |
|---|---|
| **How to measure** | Count lint warnings `om-ds/*` on new files in CI. New files = added in this PR (not legacy). |
| **Baseline** | N/A (lint rules do not exist yet). First measurement after the hackathon. |
| **Target** | <5% of new files with DS warnings after 1 month. 0% after 3 months. |
| **Cadence** | Per CI run (automated), summarized weekly. |

#### 5. Contributor Satisfaction (qualitative)

| | |
|---|---|
| **How to measure** | Quarterly GitHub Discussion survey (3 questions — section S.2). |
| **Baseline** | First survey = baseline. |
| **Target** | Score ≥7/10 on the quantitative question. |
| **Cadence** | Quarterly. |

### S.2 Quarterly Contributor Survey

**Format:** GitHub Discussion, category "Design System Feedback", pinned for 2 weeks.

**3 questions:**

1. **(Quantitative)** "On a scale of 1–10, how easy is it to build a new UI screen in Open Mercato using the current components and documentation?"

2. **(Qualitative)** "Describe in 1–2 sentences the last time you were building UI and did not know which component or token to use."

3. **(Actionable)** "If we could change one thing about the design system — what would help you the most?"

**Summary template:**

```markdown
## DS Survey Q[N] 2026 — Summary

**Responses:** [N]
**Avg score (Q1):** [X]/10 (prev: [Y]/10, delta: [+/-Z])

### Top themes (Q2 — friction points):
1. [theme] — mentioned by [N] respondents
2. [theme] — mentioned by [N] respondents

### Top requests (Q3 — what to change):
1. [request] — mentioned by [N] respondents
2. [request] — mentioned by [N] respondents

### Actions taken:
- [concrete action based on feedback]
- [concrete action based on feedback]

### Deferred (and why):
- [request] — deferred because [reason]
```

### S.3 Leading vs Lagging Indicators

| Metric | Type | Why | How to respond |
|---------|-----|----------|--------------|
| **DS Bypass Rate** (S.1.4) | Leading | Rising = contributors are actively circumventing the system. Problem NOW, before hardcoded colors appear in the codebase. | Immediately: investigate why they bypass it (missing component? bad API? lack of awareness?). |
| **Review Rounds** (S.1.2) | Leading | Rising = DS is not eliminating mechanical issues. Reviewers are still catching colors/spacing manually. | Within a week: check lint rules coverage, add missing rules. |
| **Hardcoded colors count** (F) | Lagging | This measures state — it decreases only when someone actively migrates. Does not signal new problems, confirms old ones. | Monthly trend. If not decreasing — no migration activity. |
| **Arbitrary text sizes** (F) | Lagging | Same as above. | Monthly trend. |
| **Empty state coverage** (F) | Lagging | Coverage measure — grows slowly with new pages and migrations. | Monthly trend. |
| **DS Adoption Rate** (S.1.3) | Leading | Low = new pages built without DS. Problem grows with every new module. | Immediately: are templates easy to find? Are lint rules working? |
| **Time to First PR** (S.1.1) | Leading | Rising = DS is not accelerating onboarding. | Within 2 weeks: observe a new contributor (Q.3), identify friction. |
| **Contributor Satisfaction** (S.1.5) | Lagging | Quarterly retrospective of state. Does not signal problems in real-time. | Quarterly trend. If decreasing — deep-dive into qualitative answers. |

**Rule:** React to leading indicators within a week. Review lagging indicators as monthly/quarterly trends.

---

## T. Iteration & Feedback Mechanism

### T.1 DS Retrospective — 2 weeks after the hackathon

**Target date:** ~25 April 2026 (Friday)
**Duration:** 30 minutes
**Participants:** DS lead + 2–3 champions (section P) + 1–2 contributors who built UI in the last 2 weeks

**Agenda:**

| Min | Block | What we do |
|-----|------|-----------|
| 0–5 | **Data review** | Result of `ds-health-check.sh` vs hackathon baseline. How many hardcoded colors decreased? How many modules migrated? Adoption rate of new components. |
| 5–10 | **What worked** | Each participant: 1 thing that went well. E.g. "codemod script saved me an hour", "lint warning saved me from a hardcoded color". |
| 10–20 | **What didn't** | 3 questions below. This is the most important part — 10 minutes, not 5. |
| 20–25 | **Token/component feedback** | Concrete issues with APIs: "StatusBadge does not have variant X", "token name Y is confusing", "FormField orientation does not work with Z". |
| 25–30 | **Next iteration** | 3 actionable items for the next 2 weeks. Recorded in a GitHub Discussion post. |

**3 questions for "what didn't" (designed to draw out the truth):**

1. **"In the last 2 weeks, did you ever bypass a DS guideline — e.g. use a hardcoded color or skip EmptyState? If so — why?"**
   Goal: Discover *why* people circumvent the system. Reasons: they did not know? Too hard? Missing variant? Time pressure? Each answer leads to a different action.

2. **"Is there a component or token you looked for and could not find — and had to create a workaround?"**
   Goal: Discover gaps in the DS. Maybe a StatusBadge variant is missing. Maybe a token for a border in a context not covered by status colors is missing. This is the TODO list for iteration 2.

3. **"If you could reverse one DS decision — what would it be?"**
   Goal: Catch decisions that looked good on paper but do not work in practice. If 2/3 people say "flat tokens have too many names" — consider simplifying. If they say "lint rules are too aggressive" — consider moving to warn.

### T.2 Feedback Channels — ongoing

#### 1. GitHub Label: `design-system`

| | |
|---|---|
| **What we tag** | Every issue, PR, or discussion concerning DS: migrations, new components, token changes, lint rules |
| **Who monitors** | DS lead (you). Weekly scan: `gh issue list --label design-system` + `gh pr list --label design-system` |
| **Cadence** | Continuous. Weekly review. |
| **What we do with feedback** | Triage: bug (fix in current sprint), feature request (add to DS backlog), question (answer + update docs if the question recurs) |

#### 2. GitHub Discussion: "Design System Feedback"

| | |
|---|---|
| **What goes here** | Questions ("should I use Alert or Notice?"), proposals ("I need variant X"), frustrations ("token naming is confusing") |
| **Who monitors** | DS lead + champions. Champions answer simple questions, escalate non-trivial ones. |
| **Cadence** | Response within ≤48 h (OSS standard). |
| **What we do with feedback** | FAQ: if a question recurs (≥3 times) — add it to DS.md. Proposal: if popular — DR + implementation. Frustration: investigate, acknowledge, fix or explain. |

#### 3. PR Review Comments: tag `[DS]`

| | |
|---|---|
| **What this is** | Reviewer adds a `[DS]` prefix to comments about the design system: `[DS] Use text-destructive instead of text-red-600` |
| **Who monitors** | DS lead. Monthly grep: `gh api search/issues -f q="[DS] repo:open-mercato/open-mercato"` |
| **What we do** | Recurring `[DS]` comments on the same topic → new lint rule or docs update. E.g. if 5 PRs have the comment "[DS] missing EmptyState" and `require-empty-state` is `warn` — consider raising to `error`. |

#### 4. Monthly DS Digest

| | |
|---|---|
| **Format** | GitHub Discussion post, max 5 bullet points |
| **Structure** | 1. Migrated modules (this month). 2. New tokens/components. 3. Top lint violations (trending). 4. Decisions made (link to DR). 5. Next month priorities. |
| **Who writes it** | DS lead |
| **Cadence** | First week of the month |
| **Why** | Gives contributors context without forcing them to follow every PR. A 2-minute read once a month. |

### T.3 Version Strategy

**Semver for DS: NO.** DS is part of the monorepo — versioned together with `@open-mercato/ui`. A separate DS version is overhead with no benefit in a monorepo. Changes to tokens/components go into the standard `RELEASE_NOTES.md` with a `[DS]` tag.

**Deprecation policy:** ≥1 minor version between deprecated and removed. Consistent with `BACKWARD_COMPATIBILITY.md`. Specifically:
- Deprecated component (e.g. Notice): add `@deprecated` JSDoc + runtime `console.warn` in dev mode
- Bridge: re-export from new location or wrapper
- After 1 minor version: remove from codebase, update migration guide

Same policy as Notice → Alert (section 1.14 of the audit): deprecation announced → bridge period → removal.

**Changelog:** Every DS change goes into `RELEASE_NOTES.md` with the `[DS]` prefix:
```
## [DS] Semantic status tokens added
- 20 new CSS custom properties (--status-{error|success|warning|info|neutral}-{bg|text|border|icon})
- Light and dark mode values with WCAG AA contrast
- Migration: see packages/ui/decisions/DR-001.md
```

**Migration guides:** Every breaking change gets a migration guide in the format of section J (mapping table + codemod script). Who writes it: the person introducing the breaking change (enforced via PR template checkbox). Reference: section J of this document.

### T.4 "Good Enough" Permission

> **Our design system does not need to be perfect. It needs to exist.**
>
> 30% adoption in the first month is success — it means new modules are being built consistently, even if legacy is not yet migrated. Tokens can change — that is why they are tokens, not hardcoded values. If a component API turns out to be wrong after 2 weeks of use, we change it — we have a deprecation policy and codemod scripts for exactly these situations. Consistency matters more than perfection: 34 modules using a "good enough" token is better than 3 modules with an ideal palette and 31 with hardcoded colors. This design system is a product — and products iterate.
>
> Build, measure, improve. In that order.
| **How we handle feedback** | Triage: bug (fix in current sprint), feature request (add to DS backlog), question (respond + update docs if the question recurs) |

#### 2. GitHub Discussion: "Design System Feedback"

| | |
|---|---|
| **What goes here** | Questions ("should I use Alert or Notice?"), proposals ("I need variant X"), frustrations ("token naming is confusing") |
| **Who monitors** | DS lead + champions. Champions answer simple questions, escalate non-trivial ones. |
| **Cadence** | Response within ≤48h (OSS standard). |
| **How we handle feedback** | FAQ: if a question recurs (≥3 times) — add it to DS.md. Proposal: if popular — DR + implementation. Frustration: investigate, acknowledge, fix or explain. |

#### 3. PR Review Comments: tag `[DS]`

| | |
|---|---|
| **What it is** | Reviewer adds `[DS]` prefix to design system–related comments: `[DS] Use text-destructive instead of text-red-600` |
| **Who monitors** | DS lead. Monthly grep: `gh api search/issues -f q="[DS] repo:open-mercato/open-mercato"` |
| **What we do** | Recurring `[DS]` comments on the same topic → new lint rule or docs update. E.g., if 5 PRs have comment "[DS] missing EmptyState" and `require-empty-state` is `warn` — consider upgrading to `error`. |

#### 4. Monthly DS Digest

| | |
|---|---|
| **Format** | GitHub Discussion post, 5 bullet points max |
| **Structure** | 1. Migrated modules (this month). 2. New tokens/components. 3. Top lint violations (trending). 4. Decisions made (link to DR). 5. Next month priorities. |
| **Who writes it** | DS lead |
| **Cadence** | First week of the month |
| **Why** | Gives contributors context without requiring them to track every PR. A 2-minute read once a month. |

### T.3 Version Strategy

**Semver for DS: NO.** DS is part of the monorepo — versioned together with `@open-mercato/ui`. A separate DS version is overhead with no benefit in a monorepo. Token/component changes go into the standard `RELEASE_NOTES.md` with a `[DS]` tag.

**Deprecation policy:** ≥1 minor version between deprecated and removed. Consistent with `BACKWARD_COMPATIBILITY.md`. Specifically:
- Deprecated component (e.g., Notice): add `@deprecated` JSDoc + runtime `console.warn` in dev mode
- Bridge: re-export from the new location or wrapper
- After 1 minor version: remove from codebase, update migration guide

Same policy as Notice → Alert (audit section 1.14): deprecation announced → bridge period → removal.

**Changelog:** Every DS change goes into `RELEASE_NOTES.md` with the `[DS]` prefix:
```
## [DS] Semantic status tokens added
- 20 new CSS custom properties (--status-{error|success|warning|info|neutral}-{bg|text|border|icon})
- Light and dark mode values with WCAG AA contrast
- Migration: see packages/ui/decisions/DR-001.md
```

**Migration guides:** Every breaking change gets a migration guide in the format from section J (mapping table + codemod script). Who writes it: the person introducing the breaking change (enforced via PR template checkbox). Reference: section J of this document.

### T.4 "Good Enough" Permission

> **Our design system does not need to be perfect. It needs to exist.**
>
> 30% adoption in the first month is a success — it means new modules are being built consistently, even if legacy modules are not yet migrated. Tokens can change — that is why they are tokens and not hardcoded values. If a component API turns out to be wrong after 2 weeks of usage, we change it — we have a deprecation policy and codemod scripts precisely for such situations. Consistency matters more than perfection: 34 modules using a "good enough" token is better than 3 modules with a perfect palette and 31 with hardcoded colors. This design system is a product — and products iterate.
>
> Build, measure, improve. In that order.

---

---

## U. Foundations Supplement — Motion, Type Hierarchy, Icons

### U.1 Motion & Animation Spec

#### Current state (from codebase audit)

The project ALREADY uses animations, but without standardization:

| Animation | Duration | Easing | Context |
|----------|----------|--------|---------|
| `slide-in` (flash messages) | 300ms | ease-out | Flash notification entry |
| `ai-pulse` / `ai-pulse-active` | 3s / 1.5s | ease-in-out | AI dot idle/active |
| `ai-glow` / `ai-glow-active` | 3s / 1.5s | ease-in-out | AI dot glow |
| `ai-spin` | 8s | linear | AI dot gradient rotation |
| Switch toggle | 200ms | default | `transition-transform` thumb slide |
| Progress bar | 300ms | ease-in-out | `transition-all` width change |
| Button/IconButton hover | default (~150ms) | default | `transition-all` |
| Dialog/Popover/Tooltip enter | tw-animate-css | — | `animate-in fade-in-0 zoom-in-95` |

**Problems:** Mix of 150ms/200ms/300ms without justification. Zero `prefers-reduced-motion` support (critical a11y gap).

#### Duration Scale [POST-HACKATHON]

| Token | CSS Variable | Value | When to use |
|-------|-------------|-------|-------------|
| `instant` | `--motion-duration-instant` | `75ms` | Hover color change, focus ring, checkbox/radio toggle |
| `fast` | `--motion-duration-fast` | `150ms` | Button hover/active, icon rotation, tooltip fade |
| `normal` | `--motion-duration-normal` | `250ms` | Switch thumb slide, popover/dropdown open, tab switch |
| `slow` | `--motion-duration-slow` | `350ms` | Dialog open/close, flash message slide-in, accordion expand |
| `decorative` | `--motion-duration-decorative` | `1000ms+` | AI pulse, progress shimmer — does not apply to UI core |

**Rule:** Direct interaction (user clicked) = `fast`/`normal`. System feedback (something appeared) = `normal`/`slow`. Decoration = `decorative`.

#### Easing Curves [POST-HACKATHON]

| Token | CSS Variable | Value | When |
|-------|-------------|-------|------|
| `default` | `--motion-ease-default` | `cubic-bezier(0.25, 0.1, 0.25, 1.0)` | General transitions (≈ ease) |
| `enter` | `--motion-ease-enter` | `cubic-bezier(0.0, 0.0, 0.2, 1.0)` | Entering elements: dialog, popover, tooltip, flash |
| `exit` | `--motion-ease-exit` | `cubic-bezier(0.4, 0.0, 1.0, 1.0)` | Exiting elements: dialog close, flash dismiss |
| `spring` | `--motion-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1.0)` | Subtle spring effects: switch thumb, bounce badge |

#### Motion Rules

**What to animate (GPU-accelerated):**
- `transform` (translate, scale, rotate)
- `opacity`
- `filter` (blur, brightness)
- `clip-path`

**What NOT to animate (layout reflow):**
- `width`, `height`, `top`, `left`, `margin`, `padding`
- Exception: `Progress` bar animates width — acceptable because it is one-shot, not repetitive

**`prefers-reduced-motion` — REQUIRED:** [HACKATHON — 15 min]

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Add to `globals.css`. Do not disable animations completely (`0.01ms` instead of `0ms`) so that `animationend`/`transitionend` events still fire.

#### Skeleton Loaders [POST-HACKATHON]

**Decision: Skeleton vs Spinner:**

| Situation | Use | Why |
|----------|-----|-----|
| Known layout (list, detail, form) | Skeleton | User sees the shape of the upcoming content — lower perceived wait time |
| Unknown layout (first load, search results) | Spinner (`LoadingMessage`) | Nothing to render |
| User action (save, delete) | Spinner in button | Feedback on click, not on layout |
| Section inside a page | `InlineLoader` with DataLoader | Do not block the rest of the page |

**Skeleton spec (when implemented):**

```css
/* Shimmer animation */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--muted) 25%,
    oklch(from var(--muted) calc(l + 0.05) c h) 50%,
    var(--muted) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s var(--motion-ease-default) infinite;
  border-radius: var(--radius-sm);
}
```

- Base color: `--muted` (consistent with loading states)
- Highlight: muted +5% lightness (in OKLCH — perceptually correct)
- Duration: 1.5s (slower = less aggressive, better for a11y)
- Border-radius: `--radius-sm` (rounded like the content they replace)
- Sizing: matched to content (text skeleton = h-4, avatar = h-10 w-10 rounded-full)

**Priority:** Skeleton component is [LATER]. `prefers-reduced-motion` is [HACKATHON].

---

### U.2 Prescriptive Type Hierarchy

Data from the audit (sections 1.3, 1.4): 61 arbitrary sizes, h1 styled as `text-2xl font-semibold` (14 occurrences) or `text-2xl font-bold tracking-tight` (3 occurrences). h2 has 5 different styles. h3 has 5 different styles.

#### Type Scale [HACKATHON]

| Semantic role | HTML | Tailwind classes | Size | Weight | Line-height | Letter-spacing | When to use |
|--------------|------|-----------------|------|--------|-------------|---------------|-------------|
| Page title | `<h1>` | `text-2xl font-semibold tracking-tight` | 24px | 600 | `leading-tight` (1.25) | -0.025em | Page title in PageHeader. Max 1 per page. |
| Section title | `<h2>` | `text-lg font-semibold` | 18px | 600 | `leading-7` (1.75rem) | — | Section title in SectionHeader, card header. |
| Subsection title | `<h3>` | `text-base font-semibold` | 16px | 600 | `leading-6` (1.5rem) | — | Subtitle inside a section, tab panel header. |
| Group title | `<h4>` | `text-sm font-semibold` | 14px | 600 | `leading-5` (1.25rem) | — | Field group header in a form, settings section. |
| Body (default) | `<p>` | `text-sm` | 14px | 400 | `leading-5` (1.25rem) | — | Default text in backend. All descriptions, paragraphs, cell content. |
| Body (large) | `<p>` | `text-base` | 16px | 400 | `leading-6` (1.5rem) | — | Portal body text, hero descriptions, feature cards. |
| Caption | `<span>` | `text-xs text-muted-foreground` | 12px | 400 | `leading-4` (1rem) | — | Auxiliary text: timestamps, metadata, helper text below fields. |
| Label | `<label>` | `text-sm font-medium` | 14px | 500 | `leading-5` (1.25rem) | — | Form labels in backend (CrudForm FieldControl). Via `<Label>` primitive. |
| Overline | `<span>` | `text-overline` | 11px | 600 | `leading-4` (1rem) | `tracking-wider` (0.05em) | Uppercase labels: entity type in FormHeader, portal field labels, category tags. |
| Code | `<code>` | `font-mono text-sm` | 14px | 400 | `leading-5` (1.25rem) | — | Code, API paths, technical values. Geist Mono. |

**CSS tokens to add:**

```css
/* In globals.css — the only custom typography token */
--font-size-overline: 0.6875rem;    /* 11px */
--font-weight-overline: 600;
--letter-spacing-overline: 0.05em;
--text-transform-overline: uppercase;

/* In @theme inline */
--font-size-overline: var(--font-size-overline);
```

**Tailwind utility (in globals.css):**

```css
.text-overline {
  font-size: var(--font-size-overline);
  font-weight: var(--font-weight-overline);
  letter-spacing: var(--letter-spacing-overline);
  text-transform: var(--text-transform-overline);
  line-height: 1rem;
}
```

#### Type Hierarchy Don'ts

| Don't | Why | Use instead |
|-------|-----|-------------|
| Skip heading levels (`h1` → `h3` without `h2`) | Breaks a11y — screen reader loses structure | Always maintain the sequence. If you do not need h2 — reduce h1. |
| Use a heading class on a non-heading (`<div className="text-2xl font-semibold">`) | Visual hierarchy ≠ semantic hierarchy. Screen reader does not see a heading. | Use `<h2>` with the appropriate class. |
| Mix sizes in the same context (`text-lg` next to `text-xl` as peer headings) | Implies different importance where there is none. | Same level = same size. |
| Use `font-bold` (700) in body text | Too heavy for body, conflicts with headings. | `font-medium` (500) for accents in body. `font-semibold` (600) for headings. |
| Use arbitrary sizes (`text-[13px]`, `text-[15px]`) | Breaks the scale, makes maintenance harder. | Map to the nearest Tailwind size (see section J mapping table). |

**Priority:** [HACKATHON] — 1 table, 15 minutes, eliminates 90% of questions about sizes.

---

### U.3 Icon Usage Guidelines

Decision DR-003: lucide-react as the sole icon library. Audit: 14 files with inline SVG to migrate.

#### Sizing Convention [HACKATHON]

| Token | Tailwind | Pixel | When to use | Example |
|-------|---------|-------|-------------|---------|
| `icon.xs` | `size-3` | 12px | Badge count, notification dot, inline indicator | Badge number overlay |
| `icon.sm` | `size-3.5` | 14px | In small buttons (`size="sm"`), compact row actions, breadcrumb separator | `<ChevronRight className="size-3.5" />` in breadcrumbs |
| `icon.default` | `size-4` | 16px | **Standard — 80% of usages.** Button icon, nav item icon, table cell icon, form field icon | `<Plus className="size-4" />` in `<Button>` |
| `icon.md` | `size-5` | 20px | Standalone icon buttons (`IconButton size="default"`), section header icon, alert icon | `<AlertCircle className="size-5" />` in `<Alert>` |
| `icon.lg` | `size-6` | 24px | Empty state icon, feature card icon, page header accent | `<Package className="size-6" />` in `<EmptyState>` |
| `icon.xl` | `size-8` | 32px | Hero illustrations, onboarding steps, large empty states | Portal feature cards, wizard step icons |

Codebase data: `size-4` (16px) dominates with 602 usages of `w-4` and 591 of `h-4`. `size-3`/`size-3.5` have 154/72 usages. `size-5` has 85 usages.

#### Stroke Width [HACKATHON]

**Decision: `strokeWidth={2}` (lucide default) — everywhere.** No exceptions.

Rationale: The audit found 19 occurrences of `strokeWidth="2"` (explicit default) and 11 occurrences of `strokeWidth="1.5"` (portal/frontend). `1.5` is legacy — thinner lines are less legible at small sizes (size-3, size-4) and inconsistent with the rest of the system. Migration: 11 changes as part of module migration.

**Do not pass `strokeWidth` in JSX** — lucide renders 2 by default. If you see explicit `strokeWidth={2}` — remove it; it is redundant.

#### Icon + Text vs Icon-Only [HACKATHON]

| Context | Icon-only allowed? | Requirements |
|---------|-------------------|--------------|
| Primary CTA (Create, Save) | ❌ NO | Always icon + text. The user must know what the button does. |
| Sidebar nav items | ❌ NO (collapsed: icon-only with tooltip) | Full navigation: icon + text. Collapsed sidebar: icon + tooltip. |
| Toolbar / row actions (Edit, Delete, More) | ✅ YES | `aria-label` REQUIRED. Tooltip RECOMMENDED. |
| Close button (X in dialog/alert) | ✅ YES | `aria-label="Close"` REQUIRED. |
| Pagination (prev/next) | ✅ YES | `aria-label="Previous page"` / `aria-label="Next page"`. |
| Status indicator (dot, check) | ✅ YES (decorative) | `aria-hidden="true"` — status conveyed through text/badge, not icon. |

**Primary rule (see Principle 3):** If the icon is the only way to understand an action → `aria-label` is REQUIRED, not recommended. TypeScript should enforce this (required `aria-label` prop on `IconButton`).

#### Top 20 Icons in Open Mercato (from codebase grep)

| # | Icon | Imports | Context |
|---|------|---------|---------|
| 1 | `Plus` | 60 | Create actions, add to list, EmptyState CTA |
| 2 | `Trash2` | 54 | Delete actions (row, bulk, form) |
| 3 | `Loader2` | 48 | Spinner (animate-spin), loading states |
| 4 | `X` | 40 | Close (dialog, flash, panel, tag remove) |
| 5 | `ChevronDown` | 29 | Dropdown trigger, collapse, select |
| 6 | `Pencil` | 27 | Edit actions (inline, row, form) |
| 7 | `AlertTriangle` | 14 | Warning states (Alert, Notice) |
| 8 | `Check` | 13 | Success indicator, checkbox, confirm |
| 9 | `ChevronRight` | 13 | Breadcrumb separator, nav expand |
| 10 | `RefreshCw` | 12 | Reload data, sync, retry |
| 11 | `Settings` | 12 | Settings navigation, config |
| 12 | `ChevronUp` | 11 | Collapse, sort ascending |
| 13 | `Save` | 10 | Save form, persist changes |
| 14 | `AlertCircle` | 10 | Error states (ErrorMessage, Alert) |
| 15 | `Mail` | 9 | Email fields, contact, send |
| 16 | `Info` | 9 | Info tooltips, helper text |
| 17 | `CheckCircle2` | 9 | Success flash, confirmed status |
| 18 | `Calendar` | 9 | Date picker, scheduling |
| 19 | `Zap` | 8 | Automation, workflows, AI |
| 20 | `ExternalLink` | 8 | Open in new tab, external URL |

**How to find an icon:** Open [lucide.dev/icons](https://lucide.dev/icons) and search by action name (e.g., "delete" → Trash2, "add" → Plus). Prefer icons from the top 20 — contributors are familiar with them.

#### Icon Don'ts

| Don't | Why | Use instead |
|-------|-----|-------------|
| Import from another library (Heroicons, Phosphor) | Inconsistent stroke, sizing, style (see DR-003) | Always `from 'lucide-react'` |
| Inline SVG (`<svg viewBox="...">`) | Not tree-shakeable, inconsistent stroke | Find the equivalent in lucide or file a request |
| `strokeWidth={1.5}` or other custom values | Thinner lines = less legible at size-4 | Remove the prop — lucide default (2) is the standard |
| Icon outside the scale (`size-7`, `size-10`, `size-[18px]`) | Breaks the scale, inconsistent with the rest of the UI | Use the nearest size from the scale: 3, 3.5, 4, 5, 6, 8 |

---

## V. Component Specs

### V.1 Component Quick Reference Table

Covers all primitives from `packages/ui/src/primitives/` and key backend components. Data from the codebase audit.

| # | Component | Import | When to use | When NOT to use | Variants | Default size | A11y | Mobile |
|---|-----------|--------|-------------|-----------------|----------|-------------|------|--------|
| 1 | **Button** | `@open-mercato/ui/primitives/button` | User action: save, create, cancel, delete | Navigation (→ `Link`), state toggle (→ `Switch`) | `default`, `destructive`, `outline`, `secondary`, `ghost`, `muted`, `link` | h-9, text-sm | Focus ring auto. Disabled = `opacity-50 pointer-events-none`. | No change — touch target h-9 (36px) OK |
| 2 | **IconButton** | `@open-mercato/ui/primitives/icon-button` | Compact icon-only action: edit, delete, close, collapse | When the action is unclear without text (→ `Button` with icon+text) | `outline`, `ghost` | size-8 (32px) | `aria-label` REQUIRED | Touch target size-8 = 32px — on mobile consider size `lg` (36px) |
| 3 | **Input** | `@open-mercato/ui/primitives/input` | Single-line text field: name, email, search | Multi-line text (→ `Textarea`), selection from a list (→ `ComboboxInput`) | No CVA | h-9 | Via `<Label htmlFor>` + `aria-invalid` | No change |
| 4 | **Textarea** | `@open-mercato/ui/primitives/textarea` | Multi-line text: description, notes, comments | Single-line (→ `Input`), rich text (→ `SwitchableMarkdownInput`) | No CVA | min-h-[80px] | Via `<Label htmlFor>` | No change |
| 5 | **Checkbox** | `@open-mercato/ui/primitives/checkbox` | Multiple selection, boolean with deferred save (form) | Immediate toggle (→ `Switch`), single choice (→ radio) | No CVA | size-4 (16px) | Radix — built-in role/state | Touch: size-4 is small — wrap in a clickable area |
| 6 | **Switch** | `@open-mercato/ui/primitives/switch` | Immediate toggle: enable/disable, on/off | Boolean in a form with submit (→ `Checkbox`) | No CVA | h-6 w-11 | `role="switch"`, keyboard Space/Enter | h-6 (24px) — acceptable |
| 7 | **Label** | `@open-mercato/ui/primitives/label` | Label for a form field | Standalone text (→ `<span>`) | No CVA | text-sm font-medium | Radix — auto `htmlFor` linkage | No change |
| 8 | **Card** | `@open-mercato/ui/primitives/card` | Grouping related content: settings, stats, features | Wrapping an entire page (→ `Page`), section in a detail (→ `Section`) | `CardHeader`, `CardContent`, `CardFooter`, `CardAction` | bg-card, gap-6 | Semantic `<div>` with border | No change — padding responsive via sub-components |
| 9 | **Badge** | `@open-mercato/ui/primitives/badge` | Metadata: count, category, tag | Entity status (→ `StatusBadge`), action (→ `Button size="sm"`) | `default`, `secondary`, `destructive`, `outline`, `muted` + (new) `success`, `warning`, `info` | text-xs h-5 | Decorative — no interaction | No change |
| 10 | **Alert** | `@open-mercato/ui/primitives/alert` | Inline message: error, success, warning, info on page | Transient feedback (→ `flash()`), system notification (→ `NotificationBell`) | `default`, `destructive`, `success`, `warning`, `info` | p-4 text-sm | `role="alert"` auto on destructive | No change |
| 11 | **Dialog** | `@open-mercato/ui/primitives/dialog` | Form/content requiring focus: create, edit, confirm | >10 fields (→ separate page), read-only content (→ `Popover`) | `DialogContent` with sub-components | Mobile: bottom sheet. Desktop: max-w-lg centered | Radix: focus trap, ESC close, aria-* | Bottom sheet with rounded-t-2xl, min-h-[50vh] |
| 12 | **Tooltip** | `@open-mercato/ui/primitives/tooltip` | Short helper text on hover/focus: icon explanation, truncated text | Interactive content (→ `Popover`), important info (→ show inline) | No CVA | text-xs, max-w-[280px] | Delay 300ms, ESC dismiss | Touch: no hover — consider inline text |
| 13 | **Popover** | `@open-mercato/ui/primitives/popover` | Interactive panel on click: filter, color picker, mini-form | Full form (→ `Dialog`), read-only hint (→ `Tooltip`) | No CVA | min-w-[280px] | Radix: focus trap, ESC close | No change — auto positioning |
| 14 | **Tabs** | `@open-mercato/ui/primitives/tabs` | Switching views in one context: detail sections, settings | Navigation between pages (→ sidebar/routing), 2 options (→ `Switch`) | `TabsList`, `TabsTrigger`, `TabsContent` | h-9 trigger | `role="tablist"`, `aria-selected` | Horizontal scroll on TabsList if >4 tabs |
| 15 | **Table** | `@open-mercato/ui/primitives/table` | Simple semantic table: key-value, comparison, static data | List with sort/filter/pagination (→ `DataTable`) | `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | text-sm, px-4 py-2 | Semantic HTML `<table>` | Horizontal scroll in overflow container |
| 16 | **Separator** | `@open-mercato/ui/primitives/separator` | Visual section divider | Spacing (→ `space-y-*` / `gap-*`), grouping (→ `Card` / `Section`) | `horizontal` (default), `vertical` | 1px, bg-border | `role="separator"` | No change |
| 17 | **Progress** | `@open-mercato/ui/primitives/progress` | Operation progress: upload, sync, wizard step | Indeterminate time (→ `Spinner`) | No CVA | h-2 | `role="progressbar"`, `aria-valuenow` | No change |
| 18 | **Spinner** | `@open-mercato/ui/primitives/spinner` | Loading indicator: data fetch, form submit, async operation | Known layout (→ Skeleton — future) | No CVA | Inherited from parent | `aria-label` or surrounding `LoadingMessage` | No change |
| 19 | **EmptyState** | `@open-mercato/ui/backend/EmptyState` | Zero data in a list/section — with CTA to create | Error (→ `ErrorMessage`), loading (→ `LoadingMessage`) | — | Centered, dashed border | Semantic: `title` + `description` readable by SR | No change — centered layout is responsive |
| 20 | **LoadingMessage** | `@open-mercato/ui/backend/detail` | Loading state in sections, tab content, detail pages | Full-page loading (→ `PageLoader`), inline in table (→ `DataTable isLoading`) | — | Spinner h-4 + text | `aria-busy` via context | No change |
| 21 | **ErrorMessage** | `@open-mercato/ui/backend/detail` | Data loading error, not found, server error | Form validation (→ `Alert` inline + field errors) | — | `role="alert"`, `text-destructive` | Auto `role="alert"` | No change |

### V.2 Deep Specs — components with issues

#### V.2.1 Button — Decision Framework [HACKATHON]

Audit (1.10): 7 variants. No guidelines for when to use which.

| Scenario | Variant | Size | Rationale |
|----------|---------|------|-----------|
| **Primary action** on the page (Save, Create, Submit) | `default` | `default` (h-9) | Primary CTA — blue background, white text. Max 1 per page section. |
| **Supporting action** (Cancel, Back, Export) | `outline` | `default` | Visible but does not compete with primary. Border without fill. |
| **Destructive action** (Delete, Remove, Revoke) | `destructive` | `default` | Red. ALWAYS with `useConfirmDialog()` — never immediate. |
| **Low-priority action** (Reset filters, Clear, Collapse) | `ghost` | `sm` (h-8) | Minimal visual weight. Visible only on hover. |
| **Inline text-style action** (inline link-style) | `link` | `sm` | Looks like a link. For actions, not navigation (navigation = `<Link>`). |
| **Action in a muted context** (toolbar, compact list) | `muted` | `sm` | Muted bg, low contrast. Does not draw attention. |
| **Action in a peer group** (2 equivalent options) | `secondary` + `secondary` | `default` | Both grey. Neither dominates. Add an icon for differentiation. |

**1-1-N rule:** Max 1 `default` (primary), max 1 `destructive`, any number of `outline`/`ghost`/`muted` per visible section.

**Conflicts (2 equivalent actions):** Use `secondary` for both + differentiate with an icon. Do not create a second `default`.

#### V.2.2 Card — Unification Plan [POST-HACKATHON]

Audit (1.8): Card (primitive), PortalCard, PortalFeatureCard, PortalStatRow, card-grid in settings.

**Taxonomy — 3 variants:**

| Variant | Component | Usage | Padding | Radius |
|---------|-----------|-------|---------|--------|
| `default` | `Card` (primitive) | Backend: settings, grouped content, data sections | px-6 py-6 (via sub-components) | `rounded-xl` (border) |
| `interactive` | `Card` + `onClick`/`asChild` | Settings navigation tiles, clickable cards | px-6 py-6 + hover state | `rounded-xl` + `hover:bg-accent/50` |
| `stat` | `Card` + custom content | Dashboard widgets, KPI tiles, metric cards | p-5 sm:p-6 | `rounded-xl` |

**PortalCard: merge with Card.** PortalCard is a `Card` with `p-5 sm:p-6 rounded-xl border bg-card` — identical to the primitive. Replace with Card import. PortalFeatureCard is a composition: `Card` + icon grid — it does not need a separate component.

**When to use Card vs Section vs another container:**

| Content | Use | Why |
|---------|-----|-----|
| Self-contained data block (address, payment info, stats) | `Card` | Has clear boundaries — border + bg-card |
| Section in a detail page (Activities, Notes, Tasks) | `Section` / `SectionHeader` | No border — it is part of the page flow |
| Entire page | `Page` + `PageBody` | Wrapper, not a container |
| Form | `CrudForm` (manages its own layout) | CrudForm has its own padding and spacing |

#### V.2.3 Dialog — Decision Matrix [HACKATHON]

Audit (1.10): Dialog (Radix), ConfirmDialog (native `<dialog>`). No sizing guidelines.

| Scenario | Use | Sizing | Why |
|----------|-----|--------|-----|
| Destructive action confirmation | `useConfirmDialog()` | auto (sm) | 2 options: confirm/cancel. Minimal UI. |
| Quick create (2-5 fields: tag, note, quick task) | `Dialog` | `max-w-md` (448px) | Stays in context. Fast turnaround. |
| Standard form (5-7 fields: create entity) | `Dialog` | `max-w-lg` (512px) — default | Focuses attention. Cmd+Enter submit. |
| Complex form (8-12 fields with groups) | `Dialog` | `max-w-xl` (576px) | On the boundary — consider a separate page. |
| >12 fields or multi-step | Separate page (`create/page.tsx`) | full page | Dialog too small. User loses context scrolling in modal. |
| Read-only detail preview | `Dialog` or `Popover` | depends on content amount | Popover: 1-2 sections. Dialog: more. |
| Bulk action confirmation | `useConfirmDialog()` with custom description | auto (sm) | "Delete 5 customers?" + consequences. |

**Mobile behavior:** All Dialogs → bottom sheet (min-h-[50vh], max-h-[70vh], rounded-t-2xl). Swipe-down to dismiss is not implemented — ESC/tap outside.

**Sizing reference (from dialog.tsx):**

| Token | Tailwind | Pixel | Desktop | Mobile |
|-------|---------|-------|---------|--------|
| sm | `max-w-sm` | 384px | Confirmation, simple choice | Bottom sheet |
| md | `max-w-md` | 448px | Quick create, 2-5 fields | Bottom sheet |
| lg (default) | `max-w-lg` | 512px | Standard form, 5-7 fields | Bottom sheet |
| xl | `max-w-xl` | 576px | Complex form, 8-12 fields | Bottom sheet |

**Rule:** If a form requires scrolling inside a Dialog — move it to a separate page.

#### V.2.4 Tooltip vs Popover [HACKATHON]

| | Tooltip | Popover |
|---|---------|---------|
| **Trigger** | Hover + focus (300ms delay) | Click |
| **Content** | Text only. Max 1-2 sentences. | Anything — buttons, links, forms, images |
| **Interactivity** | ❌ None. User cannot click tooltip content. | ✅ Full. Focus trap, keyboard nav. |
| **Dismiss** | Auto (mouse leave / blur) + ESC | Click outside / ESC / explicit close |
| **Mobile** | ⚠️ No hover — tooltip does not work. Use inline text. | ✅ Works — tap to open, tap outside to close. |
| **Sizing** | Auto (max-w-[280px]) | min-w-[280px], no max |
| **Use when** | Icon explanation, truncated text, field hint | Filter panel, color picker, mini-form, user card |
| **Do NOT use when** | Info is critical (user MUST see it) | Full form >3 fields (→ Dialog) |

**Rule:** If information is important enough that the user must see it — do not hide it in a tooltip. Show it inline (caption text, description in FormField, helper text).

---

## W. Content Guidelines + Page Patterns

### W.1 Voice & Tone Guidelines [POST-HACKATHON]

#### Voice — who we are (constant)

Open Mercato communicates as: **professional, clear, helpful, concrete.**

| We are | We are NOT |
|--------|-----------|
| Professional — we respect the user's time | Corporate — no jargon, no buzzwords |
| Clear — one sentence, one meaning | Academic — no "furthermore", "utilize", "leverage" |
| Helpful — we say what to do, not just what went wrong | Marketing — no "amazing", "powerful", "game-changing" |
| Concrete — "3 customers deleted" not "operation completed" | Casual — no emoji in UI, no "oops!", no humor in errors |

#### Tone — how we adapt (contextual)

| Context | Tone | Good ✅ | Bad ❌ |
|---------|------|---------|--------|
| Success message | Concise, confirming | "Customer saved" | "Your customer has been successfully saved!" |
| Error (server) | Calm, actionable | "Could not save. Try again or check your connection." | "Error 500: Internal Server Error" |
| Error (validation) | Precise, per-field | "Name is required" | "Please fill in all required fields" |
| Empty state | Encouraging, with CTA | "No invoices yet. Create your first invoice." | "No data found" / "Nothing here!" |
| Destructive confirm | Concrete, serious | "Delete 3 customers? This cannot be undone." | "Are you sure?" |
| Tooltip / helper | Concise, informative | "Used for tax calculations" | "This field is used to store the information about..." |
| Loading | Neutral, simple | "Loading customers..." | "Please wait while we fetch your data..." |

#### Content Formulas

**Error message:** `[What happened]. [What to do].`
```
✅ "Could not save changes. Check required fields."
✅ "Connection lost. Changes will sync when you're back online."
❌ "Error 422: Unprocessable Entity"
❌ "Oops! Something went wrong :("
❌ "An unexpected error occurred. Please contact support."
```

**Empty state:** `[Title: no X]. [Description: what to do]. [CTA: verb + object]`
```
✅ Title: "No customers yet"
   Description: "Create your first customer to get started."
   CTA: [Add customer]

❌ Title: "No data found"        (too generic)
❌ Title: "Nothing here!"        (too casual)
❌ Title: "0 results"            (technical, not human)
```

**Button label:** `[Verb]` or `[Verb + object]`
```
✅ "Save", "Create invoice", "Delete", "Export CSV"
❌ "Submit", "OK", "Yes", "Click here", "Go"

Confirmation dialog: action = what will happen, cancel = "Cancel"
✅ [Delete 3 customers] [Cancel]
❌ [Yes] [No]
❌ [OK] [Cancel]
```

**Confirmation dialog:** `[Title: What will happen?] / [Description: consequences] / [Action] [Cancel]`
```
✅ Title: "Delete this customer?"
   Description: "This will permanently remove Anna Smith and all related deals, activities, and notes."
   Action: [Delete customer]  Cancel: [Cancel]

❌ Title: "Are you sure?"
   Description: ""
   Action: [OK]  Cancel: [Cancel]
```

#### Formatting rules

| Rule | Standard | Example |
|------|----------|---------|
| Capitalization | Sentence case everywhere | "Create new invoice" not "Create New Invoice" |
| Exception | ALL CAPS only for overline labels | "CUSTOMER DETAILS" in overline |
| Titles | No trailing period | "No customers yet" |
| Descriptions | With trailing period | "Create your first customer to get started." |
| Button labels | No trailing period | "Save customer" |
| Lists | No periods on list items | "• Edit customer" not "• Edit customer." |
| Numbers | Numeric, not written out | "3 customers" not "three customers" |
| Abbreviations | Full words in UI | "information" not "info", "application" not "app" |
| i18n | REQUIRED | Every user-facing string via `t()` / `useT()` |

### W.2 Error Placement Guidelines [HACKATHON]

Audit (1.9): 4 feedback systems with no guidelines for when to use which.

| Scenario | Component | Placement | Lifetime | Trigger |
|----------|-----------|-----------|----------|---------|
| Save successful | `flash('...', 'success')` | Top-right (desktop) / bottom (mobile) | 3s auto-dismiss | After `createCrud`/`updateCrud` |
| Save failed (server) | `flash('...', 'error')` | Top-right / bottom | 5s auto-dismiss | After failed `createCrud`/`updateCrud` |
| Form validation (general) | `Alert variant="destructive"` | Inline above the form | Persistent until fixed | Form submit with errors |
| Field validation | `FormField error="..."` | Below the field | Persistent until fixed | Form submit / on blur |
| No data | `EmptyState` | In place of table/content | Persistent | When `rows.length === 0` |
| No permission | `Alert variant="warning"` | In place of page content | Persistent | Server response 403 |
| Record not found | `ErrorMessage` | In place of content | Persistent | Server response 404 |
| Destructive action | `useConfirmDialog()` | Modal overlay | Until user decides | Before delete/revoke |
| Async event | `NotificationBell` + panel | Dropdown, persistent | SSE-driven | Server event |
| Long operation progress | `ProgressTopBar` | Page top bar | Until operation completes | Background job start |

**Rule:** Never use 2 systems simultaneously for the same event. If `flash()` communicates a save error, do not also show an `Alert` on the page.

**Feedback priority:** Field error > Form alert > Flash message > Notification. Closest to context = highest priority.

### W.3 Dashboard Layout Pattern [LATER]

#### Grid Layout

```tsx
// Dashboard widget grid pattern
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
  {widgets.map((widget) => (
    <Card key={widget.id} className={cn(
      widget.size === '2x1' && 'sm:col-span-2',
      widget.size === 'full' && 'sm:col-span-2 xl:col-span-3 2xl:col-span-4',
    )}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
        {widget.action && <CardAction>{widget.action}</CardAction>}
      </CardHeader>
      <CardContent>
        {widget.content}
      </CardContent>
    </Card>
  ))}
</div>
```

#### Widget Sizing

| Size | Tailwind | When |
|------|---------|------|
| `1x1` | default (1 column) | KPI number, mini chart, todo list, notifications |
| `2x1` | `sm:col-span-2` | Line chart, wider table, activity feed |
| `full` | full row span | Summary table, timeline, calendar |

#### Widget Anatomy (from patterns in customers/widgets/dashboard/)

```
┌─ CardHeader ───────────────────────┐
│ [Title: text-sm font-medium]  [⟳] │
├─ CardContent ──────────────────────┤
│                                    │
│  Widget content:                   │
│  - KPI: value (text-2xl) + trend   │
│  - List: ul.space-y-3 > li.p-3    │
│  - Chart: recharts component       │
│                                    │
├─ States ───────────────────────────┤
│  Loading: Spinner h-6 centered     │
│  Error: text-sm text-destructive   │
│  Empty: text-sm text-muted-fg      │
│  Settings: form inputs             │
└────────────────────────────────────┘
```

#### Empty Widget

When a widget has no data: `<p className="text-sm text-muted-foreground">No data for selected period.</p>` — centered in CardContent. Do NOT use EmptyState (too large for a widget). Do NOT hide the widget (the user will think it disappeared).

### W.4 Wizard / Stepper Pattern [LATER]

#### When to use Wizard vs Inline Form

| Question | Wizard | Inline form |
|----------|--------|------------|
| How many steps? | ≥3 | 1-2 |
| Do steps require separate context? | Yes (e.g., step 1: company details, step 2: address, step 3: settings) | No — everything is related |
| Can the user return to a previous step? | Yes | N/A |
| Does data from step N affect options in step N+1? | Yes (e.g., selected country → address form) | No |

#### Anatomy

```
┌─ Step Indicator ──────────────────────┐
│  (1)───(2)───(3)───(4)               │
│   ●     ●     ○     ○                │
│ Done  Current Next  Next              │
├─ Step Content ────────────────────────┤
│                                       │
│  [Current step form]                  │
│                                       │
├─ Navigation ──────────────────────────┤
│  [← Back]              [Next step →]  │
│                    or  [Complete ✓]    │
└───────────────────────────────────────┘
```

**Step indicator:** Numbered (1/2/3), not labeled — label text in the step content title. On mobile: numbers + progress bar (e.g., "Step 2 of 4").

**Navigation rules:**

| Control | Availability | Behavior |
|---------|-------------|----------|
| Back | Always (except step 1) | Returns with data preserved. Does not reset the form. |
| Next | After validating the current step | Validate on click, not on change. Error inline. |
| Skip | Only if the step is optional — explicit label "Skip this step" | Not default. Never a ghost button — always explicit text. |
| Cancel | Always | If user has entered data → `useConfirmDialog("Discard changes?")`. If not → immediately. |
| Complete (last step) | After validation | Button `default` variant. Label = concrete action ("Create organization", not "Finish"). |

**Do not build a Stepper component for the hackathon.** This is a guideline for a future implementation. The existing onboarding in `packages/onboarding` can adopt it iteratively.

---

## X. Visual Testing + Designer Workflow

### X.1 Visual Regression Testing Strategy

#### Tier 1 — Hackathon: Manual Screenshot Protocol [HACKATHON]

Zero tooling. Systematic manual workflow.

**When:** Every PR migrating a module to DS tokens (section J codemod) MUST include before/after screenshots.

**Which screens to screenshot per module migration:**

| # | Screen | Viewport | Theme | Filename |
|---|--------|----------|-------|----------|
| 1 | List (page.tsx) | Desktop 1440px | Light | `{module}-list-light.png` |
| 2 | List (page.tsx) | Desktop 1440px | Dark | `{module}-list-dark.png` |
| 3 | Detail ([id]/page.tsx) | Desktop 1440px | Light | `{module}-detail-light.png` |
| 4 | Detail ([id]/page.tsx) | Desktop 1440px | Dark | `{module}-detail-dark.png` |
| 5 | Create (create/page.tsx) | Desktop 1440px | Light | `{module}-create-light.png` |
| 6 | Create (create/page.tsx) | Desktop 1440px | Dark | `{module}-create-dark.png` |
| 7 | List — empty state | Desktop 1440px | Light | `{module}-empty-light.png` |
| 8 | List — empty state | Desktop 1440px | Dark | `{module}-empty-dark.png` |

**Where:** In the PR description as inline images. The reviewer sees them immediately — no need to run the project.

**PR description template:**

```markdown
## Visual Verification

### Before (develop branch)
| Light | Dark |
|-------|------|
| ![list-light-before] | ![list-dark-before] |
| ![detail-light-before] | ![detail-dark-before] |

### After (this PR)
| Light | Dark |
|-------|------|
| ![list-light-after] | ![list-dark-after] |
| ![detail-light-after] | ![detail-dark-after] |

### Checklist
- [ ] All status badges use StatusBadge/semantic tokens
- [ ] Dark mode: no invisible text, no white patches
- [ ] Empty state present and styled
- [ ] Loading state present
```

#### Tier 2 — Week 2-4: Playwright Screenshot Tests [POST-HACKATHON]

The project already uses Playwright (`yarn test:integration`). Add screenshot comparison.

**Setup:**

```typescript
// tests/visual/ds-regression.spec.ts
import { test, expect } from '@playwright/test'

const DS_PAGES = [
  { path: '/backend/customers/companies', name: 'customers-list' },
  { path: '/backend/customers/companies/create', name: 'customers-create' },
  { path: '/backend/sales/orders', name: 'sales-orders-list' },
  // ... top 10 pages by traffic/importance
]

for (const page of DS_PAGES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`visual: ${page.name} (${theme})`, async ({ page: pw }) => {
      // Set theme
      await pw.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
      await pw.goto(page.path)
      await pw.waitForLoadState('networkidle')

      // Screenshot comparison
      await expect(pw).toHaveScreenshot(`${page.name}-${theme}.png`, {
        maxDiffPixelRatio: 0.01, // 1% pixel diff = failure
        threshold: 0.2,          // per-pixel color threshold
      })
    })
  }
}
```

**Top 10 screens for automated testing:**

| # | Screen | Why |
|---|--------|-----|
| 1 | Customers list | Reference module — if it breaks here, it is broken everywhere |
| 2 | Customers detail | Most complex detail page — tabs, sections, statuses |
| 3 | Customers create | Reference form with CrudForm |
| 4 | Sales orders list | Many statuses (draft/confirmed/shipped/paid) |
| 5 | Auth login | Portal entry — first impression |
| 6 | Portal landing | Customer-facing — must be perfect |
| 7 | Dashboard | Widget grid — regression-prone |
| 8 | Settings page | Card grid navigation — many cards |
| 9 | Catalog products list | Large table, filters, status badges |
| 10 | Empty state (any) | Verify EmptyState rendering |

**Threshold:** `maxDiffPixelRatio: 0.01` (1%). Subpixel rendering differences between OS → 0.2 per-pixel threshold. If too flaky — raise to 0.02.

**Baseline update:** `npx playwright test --update-snapshots` after an intentional visual change. Commit new baseline screenshots with the PR.

#### Tier 3 — Month 2+: Component Showcase [LATER]

**Decision: NOT Storybook. Component showcase page inside the product.**

Rationale: Storybook requires a separate build pipeline, config sync with Tailwind v4, duplicate imports, and ongoing maintenance. Open Mercato is a monorepo with 1 app — it does not need a separate dev environment. Instead: a `/dev/components` page (dev mode only) rendering all primitives with their variants.

**Showcase page scope:**
- Renders every primitive from V.1 in all variants
- Light + dark mode toggle
- Responsive preview (mobile/tablet/desktop)
- Copy-paste import path per component
- No separate build required — part of the app dev server

**Implementation:** New dev-only module (not registered in production builds):
```
packages/core/src/modules/dev_tools/
  backend/components/page.tsx  → /backend/dev-tools/components
```

### X.2 Component Testing Checklist [POST-HACKATHON]

#### Per-component test requirements

| Category | Tests | Required? |
|----------|-------|----------|
| **Render** | Renders without crash for every variant | ✅ YES |
| **CSS classes** | Correct Tailwind classes per variant (snapshot or assertion) | ✅ YES |
| **States** | Default, hover, focus, disabled, error, loading (where applicable) | ✅ YES |
| **Props** | Required props → error without them. Optional → sensible defaults. | ✅ YES |
| **A11y** | `axe-core` scan passes. Keyboard nav works (Tab, Enter, ESC). | ✅ YES |
| **Dark mode** | Renders with `.dark` class — no hardcoded colors | ⚠️ RECOMMENDED |
| **Mobile** | Does not break layout at 375px viewport | ⚠️ RECOMMENDED |

#### Test Template — StatusBadge (reference)

```typescript
// packages/ui/src/primitives/__tests__/status-badge.test.tsx
import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { StatusBadge } from '../status-badge'

expect.extend(toHaveNoViolations)

describe('StatusBadge', () => {
  const variants = ['success', 'warning', 'error', 'info', 'neutral'] as const

  // Render: all variants without crash
  it.each(variants)('renders variant "%s" without crash', (variant) => {
    const { container } = render(
      <StatusBadge variant={variant}>Active</StatusBadge>,
    )
    expect(container.firstChild).toBeTruthy()
  })

  // CSS: correct classes per variant
  it('applies correct semantic token classes for success variant', () => {
    render(<StatusBadge variant="success">Active</StatusBadge>)
    const badge = screen.getByText('Active')
    expect(badge.className).toContain('bg-status-success-bg')
    expect(badge.className).toContain('text-status-success-text')
    expect(badge.className).toContain('border-status-success-border')
  })

  // Props: children rendered
  it('renders children text', () => {
    render(<StatusBadge variant="info">Pending review</StatusBadge>)
    expect(screen.getByText('Pending review')).toBeInTheDocument()
  })

  // Props: dot indicator
  it('renders dot indicator when dot prop is true', () => {
    const { container } = render(
      <StatusBadge variant="success" dot>Active</StatusBadge>,
    )
    // Dot is a span with rounded-full and bg matching the variant
    const dot = container.querySelector('[data-slot="status-dot"]')
    expect(dot).toBeTruthy()
  })

  // A11y: axe scan
  it('has no accessibility violations', async () => {
    const { container } = render(
      <StatusBadge variant="error">Failed</StatusBadge>,
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  // Dark mode: no hardcoded colors
  it('does not contain hardcoded color classes', () => {
    const { container } = render(
      <StatusBadge variant="error">Error</StatusBadge>,
    )
    const html = container.innerHTML
    expect(html).not.toMatch(/text-red-|bg-red-|text-green-|bg-green-|text-blue-|bg-blue-/)
  })

  // Default variant fallback
  it('renders neutral variant as default when variant not recognized', () => {
    // @ts-expect-error — testing runtime fallback
    render(<StatusBadge variant="unknown">Test</StatusBadge>)
    expect(screen.getByText('Test')).toBeInTheDocument()
  })
})
```

**Rule:** Every new DS component (FormField, StatusBadge, SectionHeader) MUST have tests before merge. Existing primitives (Button, Card, Dialog) — tests added incrementally alongside changes.

### X.3 Designer Workflow — Design-in-Code [POST-HACKATHON]

**Decision: Code-first. No Figma.**

Rationale: Open Mercato is OSS without a dedicated designer. Contributors are developers. Building a Figma library for a designer who does not exist is waste. If a designer joins — code is the source of truth, not Figma.

#### Design-in-Code Manifesto

Design in Open Mercato happens in code:

- **Tokens** live in `globals.css` (OKLCH custom properties) — not in Figma variables
- **Components** live in `packages/ui/src/primitives/` (TSX + CVA) — not in a Figma library
- **Layout** is defined by page templates (section K.1) — not by Figma frames
- **Prototyping** = `yarn dev` + editing a component — not a Figma prototype

**You do not need Figma to contribute to the UI.** All you need is:
1. Copy a template from K.1
2. Use components from V.1
3. Run `yarn dev` and iterate in the browser

#### If someone WANTS to use Figma

Token table for manual transfer (no plugin — manual sync, once per release):

**Colors (light mode):**

| Token | OKLCH value | Hex (approximate) | Figma color name |
|-------|-------------|-------------------|-----------------|
| `--background` | `oklch(1 0 0)` | `#FFFFFF` | `surface/background` |
| `--foreground` | `oklch(0.145 0 0)` | `#1A1A1A` | `text/primary` |
| `--primary` | value from globals.css | — | `interactive/primary` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `#DC2626~` | `status/error` |
| `--status-success-bg` | `oklch(0.965 0.015 163)` | `#F0FDF4~` | `status/success/bg` |
| `--status-success-text` | `oklch(0.365 0.120 163)` | `#166534~` | `status/success/text` |
| ... | (full table in section I) | ... | ... |

**Typography:**

| Role | Font | Size | Weight | Figma text style |
|------|------|------|--------|-----------------|
| Page title | Geist Sans | 24px | Semibold (600) | `heading/h1` |
| Section title | Geist Sans | 18px | Semibold (600) | `heading/h2` |
| Body | Geist Sans | 14px | Regular (400) | `body/default` |
| Caption | Geist Sans | 12px | Regular (400) | `body/caption` |
| Overline | Geist Sans | 11px | Semibold (600), UPPERCASE | `label/overline` |
| Code | Geist Mono | 14px | Regular (400) | `code/default` |

**Spacing:** Tailwind scale: 4px (1), 8px (2), 12px (3), 16px (4), 24px (6), 32px (8). In Figma: auto layout with these values.

**Sync schedule:** After every release tagged `[DS]` in RELEASE_NOTES.md — manual update of Figma variables. Responsibility: the person who wants Figma, not the DS lead.

---

*End of supplement U-X. Sections A-X constitute the complete Design System Audit & Foundation Plan covering: audit (1), principles (2), foundations (3, U), components (4, V), patterns (K, W), usage guidelines (W.1, W.2, U.2, U.3), documentation (O, M, R), implementation (I, J, L, X), and governance (N, P, Q, S, T).*
