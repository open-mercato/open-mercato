# Design System Live Component Gallery — `design_system` Module

## TLDR

Add a new core module `design_system` that renders a living, in-app component gallery at `/backend/design-system`. Every primitive from `packages/ui/src/primitives` and every backend component family (charts, filters, detail sections, page scaffolding, banners, notifications, schedule, messages, forms chrome) gets a gallery entry with live rendered variants, a copyable code snippet, and — where the node is known — a deep link into the DS Figma file. The gallery is data-driven: entries live in colocated registry files inside the module, grouped into lazy-loaded family sections, so adding a component to the DS and adding it to the gallery happen in the same review. Access is gated by a new `design_system.view` ACL feature granted to admin and employee roles by default, and the module ships in the create-app template because the gallery is an adopter's first hour with the design system. This is item 2 of the DS DX roadmap; the guardian tooling it dogfoods is defined in the companion spec [`2026-07-05-ds-system-guardian-refresh.md`](2026-07-05-ds-system-guardian-refresh.md).

## Overview

- **Track:** DS DX roadmap, item 2 (companion to the guardian refresh spec, item 1)
- **Branch:** `spec/ds-dx-developer-experience` (spec only; implementation lands on a feature branch)
- **New code:** `packages/core/src/modules/design_system/` (module, gallery registry, backend page, ACL, setup, i18n, tests)
- **Touched:** `apps/mercato/src/modules.ts` and `packages/create-app/template/src/modules.ts` (enable the module), locale files for gallery chrome
- **Not touched:** `packages/ui` itself — the gallery consumes primitives and backend components exactly as any other module does; no primitive gains gallery-specific props

## Problem Statement

The design system is documented in `.ai/ui-components.md` (5,654 lines), `.ai/ds-rules.md`, and `packages/ui/AGENTS.md`. That corpus is accurate and exhaustive, and it is the right format for agents — but it is the wrong format for a human's first contact with the DS:

1. **Markdown does not render.** A newcomer reading the `Button` section sees variant names (`destructive-soft`, `muted`) and prop tables but never sees the component. They open a random backend page, inspect the DOM, and reverse-engineer what the docs already say. Every DS has learned this lesson; ours currently has no visual surface at all.
2. **5,600 lines is a wall.** The ToC alone lists ~75 primitives plus specialized inputs. Finding "the thing that renders a date range" means scrolling or grepping, not browsing. Discovery of what exists is the single most common DS question from new contributors and from adopters scaffolding their first module.
3. **Backend families are even less discoverable.** `packages/ui/src/backend` holds the components people actually build pages from — charts, filters, detail sections, `SectionPage` scaffolding, notification chrome, schedule views, message composers, `FormHeader`/`FormFooter` — and these have no single reference document, only scattered sections in `packages/ui/AGENTS.md`. Their catalog document is a deliverable of the companion guardian spec; this gallery is their visual counterpart.
4. **Drift is invisible.** When a primitive gains a variant, nothing forces documentation or examples to follow. A live gallery whose registry is coverage-guarded by a test turns "we forgot to document it" into a CI failure.
5. **Adopters get nothing.** A team scaffolding an app with `create-app` receives the full `@open-mercato/ui` package and zero guidance on what is inside it. The docs live in the monorepo's `.ai/` tree, which does not ship.

## Proposed Solution

A standard auto-discovered core module, `design_system`, exposing one backend page that renders the gallery:

- **Route:** `backend/design-system.tsx` → `/backend/design-system`, with `page.meta.ts` declaring `requireAuth`, `requireFeatures: ['design_system.view']`, and a `nav` block (group `Developer`, label `Design system`) so the entry appears through standard nav auto-discovery — no hardcoded injection.
- **Shell:** the page uses the DS's own `SectionPage`/`SectionNav` scaffolding — family list on the left, active family's entries on the right, a `SearchInput` that filters entries by title/id across all families, and a query param (`?family=charts&entry=kpi-card`) for deep links so URLs are shareable in review comments.
- **Entries:** each gallery entry renders its variants live (real components, real tokens, real dark mode), shows the import line and a copyable code snippet per variant, links to its section in `.ai/ui-components.md` (or the backend components doc), and — where a Figma node is known — links into the DS Figma file.
- **Registry:** entries are plain data files colocated in the module (`gallery/entries/<family>.tsx`), one file per family, lazy-loaded. See the architecture decision below for why this beats MDX-in-docs and page-per-family.
- **Coverage guard:** a unit test enumerates `packages/ui/src/primitives/*.tsx` and fails when a component file has no registry entry (with an explicit allowlist for non-component files such as `date-format.ts`). The gallery stays living by construction, not by discipline.
- **Dogfooding:** the gallery is itself a DS consumer. Its pages MUST pass `yarn lint:ds` (the static DS lint delivered by the companion guardian spec; until that script lands, `bash .ai/scripts/ds-health-check.sh` scoped to the module is the interim gate) and a guardian REVIEW pass with zero findings. A gallery that violates the DS it showcases would be worse than no gallery.

## Architecture

### Module layout

```
packages/core/src/modules/design_system/
├── index.ts                      # module metadata (id: 'design_system')
├── acl.ts                        # design_system.view
├── setup.ts                      # defaultRoleFeatures grants
├── i18n/                         # en.json, pl.json, es.json, de.json (+ .hardcoded-allowlist.json)
├── backend/
│   ├── design-system.tsx         # the gallery page (client component shell)
│   └── design-system.meta.ts     # requireAuth, requireFeatures, nav block
├── gallery/
│   ├── types.ts                  # GalleryEntry / GalleryVariant / GalleryFamily
│   ├── registry.ts               # family manifest: id, labelKey, lazy loader per family
│   ├── entries/
│   │   ├── buttons.tsx           # Button, IconButton, LinkButton, SocialButton, FancyButton, ButtonGroup
│   │   ├── inputs.tsx            # Input + specialized inputs, Textarea, Select, Checkbox, Switch, Radio, Slider…
│   │   ├── dates.tsx             # DatePicker, DateRangePicker, TimePicker, Calendar
│   │   ├── feedback.tsx          # Alert, Notification, EmptyState, Skeleton, Progress, Spinner, Rating, StepIndicator
│   │   ├── overlays.tsx          # Dialog, Drawer, Sheet, Popover, Tooltip, CommandMenu
│   │   ├── navigation.tsx        # Tabs, Breadcrumb, Pagination, SegmentedControl, Accordion
│   │   ├── display.tsx           # Badge, StatusBadge, Tag, Avatar, Kbd, Table, Card, Separator, ActivityFeed, LogList
│   │   ├── charts.tsx            # BarChart, LineChart, PieChart, Sparkline, KpiCard, TopNTable
│   │   ├── filters.tsx           # FilterBar, QuickFilters, ActiveFilterChips, AdvancedFilterBuilder, empty states
│   │   ├── detail.tsx            # DetailFieldsSection, NotesSection, AddressesSection, AttachmentsSection, Loading/ErrorMessage
│   │   ├── scaffolding.tsx       # SectionPage, SectionNav, Page, SectionHeader, FormHeader/FormFooter, ActionsDropdown
│   │   ├── banners.tsx           # FlashMessages, NextStepCallout, ContextHelp, ErrorNotice
│   │   ├── notifications.tsx     # NotificationBell, NotificationPanel, NotificationItem (mocked data)
│   │   ├── schedule.tsx          # ScheduleView, ScheduleAgenda, ScheduleToolbar (mocked events)
│   │   └── messages.tsx          # MessageComposer, EmailThreadsPanel, priority selector (mocked threads)
│   └── components/
│       ├── GalleryShell.tsx      # SectionPage wiring, search, deep-link handling
│       ├── EntryCard.tsx         # title, description, import line, Figma/docs links
│       ├── VariantPreview.tsx    # live render inside a bordered stage
│       └── CodeSnippet.tsx       # <pre> + copy-to-clipboard button + flash toast
└── __integration__/
    └── design-system-gallery.spec.ts
```

`yarn generate` picks up the page through standard auto-discovery; no registry files are hand-edited.

### Registry contract

```typescript
// gallery/types.ts
export type GalleryVariant = {
  id: string                    // 'destructive-soft'
  title: string                 // human label; component/variant names are not translated
  render: () => React.ReactNode // live preview, real primitives only
  code: string                  // the snippet the copy button yields
}

export type GalleryEntry = {
  id: string                    // 'button' — unique across the whole gallery
  title: string                 // 'Button'
  importPath: string            // '@open-mercato/ui/primitives/button'
  descriptionKey?: string       // i18n key for the one-line summary
  docsAnchor?: string           // '#button' into .ai/ui-components.md (monorepo) — hidden when docs are absent
  figmaNodeId?: string          // node in file qCq9z6q1if0mpoRstV5OEA
  variants: GalleryVariant[]
}

export type GalleryFamily = {
  id: string                    // 'charts'
  labelKey: string              // 'designSystem.families.charts'
  load: () => Promise<{ entries: GalleryEntry[] }>   // next/dynamic-compatible loader
}
```

Known Figma nodes seed the initial data: Drawer `486:7366`, Table `167144:147544`, Tabs `553:734`. The Figma file id lives in one constant (`DS_FIGMA_FILE = 'qCq9z6q1if0mpoRstV5OEA'`); links render as an external-link `LinkButton` and are simply omitted when `figmaNodeId` is absent — no dead links, and nodes can be backfilled entry by entry.

### Page contract

```typescript
// backend/design-system.meta.ts
import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['design_system.view'],
  title: 'Design system',
  titleKey: 'designSystem.nav.title',
  nav: {
    group: 'Developer',
    groupKey: 'designSystem.nav.group',
    label: 'Design system',
    labelKey: 'designSystem.nav.title',
    order: 900,
    icon: 'Palette',
  },
}

export default metadata
```

```typescript
// acl.ts
export const features = [
  { id: 'design_system.view', title: 'View the design system gallery', module: 'design_system' },
]
export default features

// setup.ts
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['design_system.view'],
    employee: ['design_system.view'],
  },
}
export default setup
```

The exact feature id and grant map are the contract; icon and nav order are implementation detail.

### Lazy loading and interactive components

Each family's entry file is loaded through `next/dynamic` with a `Skeleton` fallback, keyed off the family manifest. The gallery shell itself stays a few KB; the charts family (which pulls the charting library) or the rich editor only load when their section is opened. Components that require live services (notifications SSE, messages polling, schedule data) render against inline mocked props — the gallery never calls tenant APIs and never renders tenant data, which keeps it safe to grant broadly and trivially cacheable.

Stateful overlay components (Dialog, Drawer, Sheet, CommandMenu) render a trigger button in the preview stage; the overlay opens for real. This exercises the actual focus-trap and `Escape`/`Cmd+Enter` behavior instead of a screenshot-like imitation.

### Copy snippet

`CodeSnippet` writes `variant.code` to the clipboard via `navigator.clipboard.writeText` and confirms with the standard flash toast. The snippet and the render function are maintained side by side in the same object literal; they can still drift (see Risks), so the registry integrity test asserts at minimum that every variant's `code` contains the entry's `importPath`, and review of a gallery entry always diffs both fields together — that colocation is the main drift defense.

### ACL, setup, i18n

- `acl.ts`: single feature `{ id: 'design_system.view', title: 'View the design system gallery', module: 'design_system' }`. View-only module; there is nothing to manage, so no `design_system.manage`.
- `setup.ts`: `defaultRoleFeatures: { admin: ['design_system.view'], employee: ['design_system.view'] }`. Superadmin is covered by wildcard grants. Existing tenants receive the grant through the standard ACL sync on setup, same as any new feature.
- i18n: all gallery **chrome** (nav label, family labels, search placeholder, copy button, "Open in Figma", "View docs", copied-toast) goes through module locale files in all four locales (en, pl, es, de). Component **titles and variant names** are proper nouns from the codebase (`Button`, `destructive-soft`) and are deliberately not translated. Per-entry one-line **descriptions** route through `descriptionKey` with English as the base; non-English locales may lag and fall back to English. Code snippets are code and are allowlisted via the module's `.hardcoded-allowlist.json` as developer-facing technical content.

### Ships in create-app template — decision

**Recommendation: ship it.** The module lives in `@open-mercato/core`, so the code travels with every install regardless; the only real decision is whether the template's `modules.ts` enables it. Arguments considered:

- *For monorepo-only:* production backends arguably don't need a component gallery; one more nav entry.
- *For shipping (chosen):* the gallery is precisely for adopters — a team's first hour with `create-app` is when "what components exist?" matters most, and the monorepo's `.ai/` docs do not ship to them. The module renders no tenant data, adds no schema, no API surface, and is feature-gated, so a production install can turn it off by revoking `design_system.view` or removing one line from `modules.ts` (documented in the template file's comment, same pattern as the `example` module).

Enable it in both `apps/mercato/src/modules.ts` and `packages/create-app/template/src/modules.ts`.

### Architecture decision — where do gallery entries live?

Three options were analyzed:

| | A. Colocated data registry (chosen) | B. MDX pages in `apps/docs` | C. One backend page per family |
|---|---|---|---|
| Live rendering with real tokens/theme/dark mode | Yes — runs inside the actual backend shell | Partial — docs site has its own styling context; primitives would render outside `AppShell`, tokens can diverge | Yes |
| Ships to create-app adopters | Yes (core module) | No — docs site is monorepo-only | Yes |
| Adding an entry | Edit one data file; coverage test enforces it | Author an MDX page; no enforcement linking it to the primitive | New page file + meta + nav entry each time |
| Nav/route footprint | One route, one nav entry | Zero in-app | ~15 routes and nav entries polluting auto-discovery |
| Code-splitting | Per-family `next/dynamic` | N/A | Free (per page) |
| Dogfooding value | High — gallery is a DS consumer under `lint:ds` | Low — docs site has separate lint surface | High |
| Search across all components | Trivial (registry is data) | Needs docs-site search | Hard — entries scattered across routes |
| Drift risk | Snippet strings can drift from renders (mitigated, see Risks) | Highest — MDX examples aren't type-checked against real imports by default | Same as A but duplicated per page |

Option B fails the two hard requirements (in-app, ships to adopters). Option C buys per-page code-splitting that `next/dynamic` already provides, at the cost of route sprawl and unsearchable content. **Option A** — colocated data-driven registry, sections per family, lazy-loaded — wins on every axis that matters and keeps the whole gallery reviewable as data.

## Data Models

None. The gallery is a static, code-defined registry. No entities, no migrations, no tenant or organization scoping concerns (nothing tenant-owned is read or written).

## API Contracts

None. No API routes are added. The page is served through standard backend page auto-discovery; the only network activity is Next.js chunk loading for lazy family sections.

## Migration & Backward Compatibility

Analyzed against the 13 contract surfaces from [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md):

| # | Surface | Impact | Notes |
|---|---|---|---|
| 1 | Auto-discovery files | Additive | New module with standard `backend/` page + meta. |
| 2 | Types & interfaces | Additive | `GalleryEntry`/`GalleryVariant` are module-internal; not exported from `@open-mercato/ui`. |
| 3 | Function signatures | None | No existing exports change. |
| 4 | Import paths | None | Gallery imports primitives via their public paths; nothing moves. |
| 5 | Event IDs | None | No events. |
| 6 | Widget spot IDs | None | No widgets in v1 (a `design_system.gallery:entry` spot is a possible follow-up for third-party modules to register their own entries). |
| 7 | API route URLs | None | No API routes. New page URL `/backend/design-system` is additive. |
| 8 | Database schema | None | No schema. |
| 9 | DI service names | None | No DI registrations. |
| 10 | ACL feature IDs | Additive | New `design_system.view`; granted via `setup.ts`, synced by standard role-feature sync. |
| 11 | Notification IDs | None | Gallery renders notification components with mock data only. |
| 12 | CLI commands | None | — |
| 13 | Generated files | Refresh | `yarn generate` re-emits module/page registries; standard regeneration. |

No deprecations, no bridges required. The module can be disabled by removing it from `modules.ts` with zero residue.

## Implementation Phases

1. **Module skeleton** — scaffold `design_system` (index, acl, setup, i18n, page + meta, empty shell), run `yarn generate`, verify the nav entry appears and the feature gate denies/permits correctly.
2. **Gallery infrastructure** — types, family manifest, `GalleryShell`/`EntryCard`/`VariantPreview`/`CodeSnippet`, deep-link handling, search. Ship with one seed family (buttons) end to end, including the copy action and Figma link rendering.
3. **Primitive families** — fill buttons, inputs, dates, feedback, overlays, navigation, display from `.ai/ui-components.md`; land the coverage-guard test in the same PR so the enumeration is honest from day one.
4. **Backend families** — charts, filters, detail, scaffolding, banners, notifications, schedule, messages with mocked data; cross-check the entry list against the backend components doc from the companion guardian spec.
5. **Hardening** — integration suite, dark-mode pass, bundle inspection, guardian REVIEW, template enablement (`apps/mercato` + `create-app` template `modules.ts`), release-notes entry for the new feature id.

Phases 1–2 are one PR; 3 and 4 can land as follow-up PRs each keeping the coverage test green (allowlist shrinks as families fill in).

## Validation Plan

### Unit tests (`gallery/__tests__/`)

- **Registry integrity** — every entry id unique gallery-wide; every variant id unique per entry; every `code` snippet contains its entry's `importPath`; every `figmaNodeId` matches `/^\d+:\d+$/`.
- **Coverage guard** (`gallery-coverage.test.ts`) — enumerate `packages/ui/src/primitives/*.tsx`, subtract the explicit non-component allowlist (`date-format.ts`, `date-picker-helpers.ts`, `label.tsx`, `notification-stack.tsx`, …, each with a one-line reason), and fail when a primitive has no registry entry. This is the mechanism that keeps the gallery living.
- **Render smoke** — each family's entries render without throwing under jsdom (mock-heavy families like messages/schedule included).

### Integration tests (Playwright, `__integration__/design-system-gallery.spec.ts`)

Per `.ai/qa/AGENTS.md`: self-contained, fixture-creating, cleanup in `finally`, no reliance on seeded data.

| # | UI path | Assertions |
|---|---|---|
| 1 | Page loads | Fixture user with `design_system.view` opens `/backend/design-system`; gallery shell renders; first family's entries visible; no console errors. |
| 2 | Access denied | Fixture user *without* the feature gets the standard access-denied UX, not a blank page. |
| 3 | Family navigation | Clicking a family in the section nav swaps content; lazy chunk resolves (skeleton disappears); URL query param updates; direct navigation to `?family=charts&entry=kpi-card` scrolls the entry into view. |
| 4 | A11y roles | Section nav is a `nav` with an accessible name; each entry heading is a real heading element; preview stages don't trap focus; icon-only buttons (copy, Figma link) expose `aria-label`; overlay demos (Drawer trigger) open and close with `Escape`. |
| 5 | Copy snippet | Grant `clipboard-read`/`clipboard-write` permissions on the browser context; click copy on a Button variant; assert clipboard content equals the snippet and the confirmation toast appears. On engines without clipboard permission support, assert the toast only. |
| 6 | Search | Typing `drawer` filters entries across families; clearing restores; zero-hit search shows the DS `FilterEmptyState`/empty state, not a blank pane. |
| 7 | Dark mode | Toggle `prefers-color-scheme: dark` (Playwright `colorScheme`); page renders without hardcoded-light artifacts on the preview stages (smoke assertion on stage background token). |

### DS compliance gates

- `yarn lint:ds` (companion spec's static lint) scoped to `packages/core/src/modules/design_system/` — zero findings. Interim, until that script lands: `bash .ai/scripts/ds-health-check.sh` plus the guardian ANALYZE grep set on the module.
- Guardian REVIEW pass over the module before the PR leaves draft — zero findings.
- `yarn i18n:check-hardcoded` clean (with the documented snippet allowlist).
- Standard: `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn workspace @open-mercato/core build`, `yarn test`, `yarn test:integration`.

## Risks & Impact Review

| # | Risk / failure scenario | Severity | Affected | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | **Snippet drift** — a primitive's API changes, the `render` function is updated (compiler forces it) but the `code` string silently keeps the old prop; a newcomer copies broken code. | Medium | Gallery users | Colocation (render + code in one literal, always diffed together); integrity test asserts snippets reference the real `importPath`; guardian REVIEW includes gallery entries when a primitive changes. A follow-up may typecheck snippets by compiling them in a test, out of scope for v1. | Medium |
| 2 | **Gallery rot** — new primitives land without entries and the gallery quietly stops being "every component". | Medium | DS adoption | The coverage guard test fails CI on any new primitive file without an entry or allowlist reason. Backend families are manifest-based (no dir scan), so the manifest is reviewed alongside the companion spec's backend components doc. | Low |
| 3 | **Bundle bloat** — importing every primitive plus charts/schedule/messages from one route inflates the backend bundle for all pages. | High if unmitigated | All backend users | Per-family `next/dynamic` with skeleton fallbacks; the shell imports only DS chrome. Validation: `yarn build:app` bundle output inspected in the PR; the gallery route must not appear in the shared chunk graph. | Low |
| 4 | **Live components misbehave without services** — NotificationPanel/MessageComposer/ScheduleView expect hooks, SSE, or API data; mounted bare they could spin, error, or fire real `apiCall`s. | Medium | Gallery page stability | Entries render presentational components with inline mock props only; components whose data layer cannot be severed are represented by their presentational subcomponents (e.g. `NotificationItem` list rather than the live `NotificationPanel` feed) with a note in the entry description. Integration test 1 asserts zero console errors and the network log shows no `/api/` calls from the gallery route. | Low |
| 5 | **Figma links go stale** — nodes get moved/deleted in the DS file; links 404 into Figma. | Low | Gallery users with Figma access | Node ids are optional and centralized; the three seeded ids are the memorized canonical ones. Stale links degrade to Figma's own "not found", never break the page. Backfill/audit is manual by design. | Low |
| 6 | **Broad grant surprises a locked-down tenant** — employee-level users gain a new nav entry after upgrade; a compliance-heavy adopter considers any new default grant a policy change. | Low | Tenant admins | The gallery reads no tenant data whatsoever; the grant is view-only and revocable per role; release notes call out the new feature id so admins can revoke before rollout. | Low |
| 7 | **Gallery itself violates the DS** — hand-built preview stages sprout hardcoded colors or arbitrary sizes, undermining the module's credibility as the DS showcase. | Medium | DS trust | The module is inside `lint:ds` scope from its first commit and gets a guardian REVIEW gate in the Validation Plan; preview stage chrome uses only semantic tokens (`border-border`, `bg-muted`). | Low |
| 8 | **Interactive demos leak state** — an opened Drawer demo left mounted intercepts focus or scroll-locks the page after the user navigates to another family. | Low | Gallery UX | Overlay demos are uncontrolled and unmount on family switch (lazy sections unmount on change); integration test 3 asserts family switching leaves no `overflow: hidden` residue on `body`. | Low |

## Final Compliance Report

- **DS rules (`.ai/ds-rules.md`)**: gallery chrome uses semantic tokens only; no `dark:` overrides on tokens; no arbitrary values; icons from lucide; all buttons are DS primitives. Enforced by the Validation Plan gates, not just intent.
- **Module conventions (`packages/core/AGENTS.md`)**: snake_case module id, auto-discovered backend page with colocated meta, `acl.ts` + `setup.ts` grant sync, four-locale i18n, no cross-module ORM anything (no ORM at all), `yarn generate` after scaffolding.
- **Security**: feature-gated page; no API surface; no tenant data; no inputs to validate beyond a client-side search string that never leaves the browser.
- **i18n**: chrome fully translated; documented allowlist for code snippets; `descriptionKey` fallback strategy stated explicitly.
- **BC**: all 13 surfaces additive-or-none; see table above.
- **Tests**: unit (registry integrity, coverage guard, render smoke) + 7 Playwright integration paths covering load, ACL, navigation, a11y, clipboard, search, and dark mode.

## Changelog

- **2026-07-05** — Initial spec: `design_system` core module with data-driven, lazy-loaded live gallery at `/backend/design-system`; registry-vs-MDX-vs-page-per-family analysis (registry chosen); `design_system.view` granted to admin/employee; ships in create-app template; coverage-guard test keeps the gallery living.
