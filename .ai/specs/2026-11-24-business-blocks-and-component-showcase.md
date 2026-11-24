# Business blocks: contracts, distribution and a public component showcase

- **Status:** Draft (open questions listed at the end)
- **Date:** 2026-11-24
- **Related specs:** `2026-07-05-ds-live-component-gallery.md` (gallery contract this spec extends), `2026-09-12-local-design-system-storybook.md`, `2026-07-05-ds-module-ui-scaffold.md`, `2026-07-05-ds-theming-and-brand-customization.md`, `2026-05-28-optimistic-locking-coverage-completion.md`

## TLDR

Give Open Mercato a base of reusable, simple, business-oriented UI blocks, at the level of shadcn/ui but for business apps, with no built-in data sources. Each block family is defined by an explicit contract (input types, emitted events, slots, state ownership, things it never does) before any implementation. Contracts are enforced by tests: blocks may not import domain modules, data clients or permission checks, and every block ships gallery scenarios (empty, loading, error, read-only, pending, rejected, narrow screen). Blocks are imported from `@open-mercato/ui/blocks/*` by default and copied into a module only when its author needs a different structure. The existing gallery and inventory generator become the registry, feeding the in-app gallery, Storybook, a public showcase `apps/design` and a machine-readable index for agents.

Design target: blocks, combined with the Open Mercato way of building API routes and commands, are enough for a developer or an agent to assemble a complete business app.

## Problem statement

1. **Portability is undocumented.** Whether a component can be reused outside its module is not visible from its API. A file calling `apiCall` is not automatically non-portable: `DataTable` takes `data` rows in props and runs on local data in the gallery, but may fetch perspectives or permissions on its own; `CrudForm` calls the `onSubmit` it is given; `EmailThreadsPanel` takes threads and callbacks; `LookupSelect` accepts static options or a loader. Nothing records a component's data inputs, required providers, optional host services and extension points.
2. **Business patterns live in modules.** Record headers, highlights, activity history, pipeline stepper and kanban live in `customers`; another kanban in `staff` (`lib/time-tracking-ui/KanbanBoard.tsx`); a Gantt in `workflows` (`RunGantt`); a signature field in `forms` (`SignatureField`); wizards in `backend/injection/InjectionWizard.tsx` and shipping (`useShipmentWizard`).
3. **Duplication with the design system.** The Figma DS Activity Feed (`166035:46833`) is implemented as the `activity-feed` primitive and used by no production screen, while CRM has its own timeline renderers. The same happens with step indicators and page headers.
4. **No public, machine-readable catalogue.** The gallery is behind login, Storybook is local, the docs site has no component section, and `apps/docs/docs/framework/admin-ui/data-grids.mdx` imports a `DataGrid` that does not exist.

## Goals and non-goals

**Goals**
- Written, tested contracts for the first block families.
- Blocks with no data access, no permission checks and no domain dependencies.
- Import by default, copy as an exception, with traceable copies.
- One registry feeding gallery, Storybook, public showcase and agents.

**Non-goals**
- Rewriting existing components; `DataTable`, `CrudForm`, primitives and backend components keep their public API.
- A second cache client next to the existing TanStack Query setup.
- Moving existing screens onto blocks as part of this spec (adoption is a later, per-screen decision).
- Storefront implementation before the scope question is answered.

## Architecture

| Layer | Location | Owner | Rule |
|---|---|---|---|
| Tokens and themes | existing token CSS, theming spec | platform | admin, storefront, merchant brand |
| Primitives | `@open-mercato/ui/primitives/*` (unchanged) | platform | no data access |
| Interaction hooks | `@open-mercato/ui/headless/*` (new) | platform | focus, selection, keyboard move, roving lists; extracted only when the behaviour exists and has two justified uses; plain functions where no state is needed (e.g. date grouping) |
| Blocks | `@open-mercato/ui/blocks/*` (new) | platform | follow their contract; props in, events out |
| Module wiring | inside the module | module | reads, maps records to block props, binds events to its API routes and commands, filters actions by permission; the server enforces permissions |

### Global block rules

- No imports from `@open-mercato/core/modules/*` or any domain package; no `apiCall`, `fetch`, `@tanstack/react-query` or `useGuardedMutation` inside `blocks/`.
- No permission checks. Actions arrive already filtered; a disallowed action is either absent or passed with `disabled` and `disabledReason`.
- Ids are strings. Dates are ISO 8601 strings; the block formats them with the shared locale helpers.
- Content props arrive translated by the caller. Block chrome (e.g. "Today", "Load more") uses `useT()` under `ui.blocks.<block>.*`.
- Event callbacks may return a promise. While it is pending the block shows the pending state on the affected control; on rejection it reverts any optimistic change and clears the pending state. Error messages are shown by the caller (flash, conflict bar), not by the block.
- Every block accepts `status` and renders the shared `LoadingMessage`, `ErrorMessage` or `EmptyState`; purely static layout blocks (Stack, Inline) do not.
- DS rules apply: semantic tokens, DS scale, no arbitrary values, lucide icons, `om-ds-guardian` clean.

### Shared types

```ts
type BlockStatus = 'loading' | 'error' | 'empty' | 'ready'

type BlockTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

type BlockAction = {
  key: string
  label: string
  icon?: LucideIconName
  tone?: 'default' | 'destructive'
  disabled?: boolean
  disabledReason?: string
}

type BlockBaseProps = {
  status?: BlockStatus
  errorMessage?: string
  emptyState?: React.ReactNode
  className?: string
}
```

## Contracts for the first block families

Each contract below becomes a TypeScript type plus a zod schema (`propsSchema`) in the gallery entry. Slots are `ReactNode` props and stay in TypeScript; the JSON export lists slot names only.

### EntityHeader

- **Input:** `title`, `subtitle?`, `avatar?: { src?: string; initials: string }`, `status?: { label: string; tone: BlockTone }`, `meta?: { key: string; label: string; value: string }[]`, `actions?: BlockAction[]`, `primaryActionKey?: string`.
- **Events:** `onAction(actionKey)`.
- **Slots:** `leading`, `trailing`, `below`.
- **State:** none; overflow menu open state only.
- **Never:** knows the entity type, links to module routes by itself.

### KeyValue

- **Input:** `items: { key: string; label: string; value: React.ReactNode; hint?: string; editable?: boolean; editor?: 'text' | 'textarea' | 'select' | 'date'; options?: { value: string; label: string }[] }[]`, `columns?: 1 | 2`.
- **Events:** `onEdit(key, nextValue) => Promise<void>`.
- **Slots:** per-item `value` (rich display), `footer`.
- **State:** the block owns the edit draft of the item being edited; it commits through `onEdit` and returns to read mode on resolve, keeps the draft on reject.
- **Never:** validates domain rules (the caller rejects the promise with a message).
- **Today:** `KeyValueList` (`packages/ui/src/ai/records/RecordCardShell.tsx`) covers the read-only case.

### Timeline

- **Input:** `items: TimelineItem[]`, `groupBy?: 'day' | 'none'`, `order: 'desc' | 'asc'`, `filters?: { key: string; label: string; count?: number }[]`, `activeFilterKey?: string`, `hasMore?: boolean`.
- **`TimelineItem`:** `id`, `occurredAt`, `kind: string`, `icon?: LucideIconName`, `title`, `body?: React.ReactNode`, `author?: { name: string; avatarSrc?: string }`, `attachments?: { name: string; href?: string; format?: string }[]`, `status?: { label: string; tone: BlockTone }`, `actions?: BlockAction[]`.
- **Events:** `onItemAction(itemId, actionKey)`, `onFilterChange(filterKey)`, `onLoadMore() => Promise<void>`.
- **Slots:** `renderItemBody(item)` override, `header`.
- **State:** none beyond focus; ordering and filtering of data are the caller's (the block only groups what it receives).
- **Never:** merges sources or pages (CRM history merges cursor-paged and page-numbered endpoints; that stays in the module adapter).
- **Visual source:** Figma Activity Feed `166035:46833` and the `activity-feed` primitive.

### Kanban

- **Input:** `columns: { id: string; title: string; count?: number; summary?: React.ReactNode; hasMore?: boolean; cards: { id: string }[] }[]`.
- **Events:** `onMove(cardId, toColumnId, toIndex) => Promise<void>`, `canMove?(cardId, toColumnId) => true | { reason: string }`, `onLoadMoreColumn(columnId) => Promise<void>`, `onCardOpen(cardId)`.
- **Slots:** `renderCard(card)` (required), `columnHeader(column)`.
- **State:** the block owns the optimistic position of a card while `onMove` is pending and reverts on rejection; column data is the caller's.
- **Accessibility:** keyboard move (pick up, move between columns, drop, cancel) as a full alternative to drag; announced via live region.
- **Never:** decides transition rules; it asks `canMove` and shows the returned reason.
- **Sources to reconcile before design:** CRM deals pipeline and Staff time tracking board (column paging, drag alternative). Figma design (cards, columns, focus, narrow screen) is approved before implementation.

### Wizard

- **Input:** `steps: { id: string; title: string; description?: string; optional?: boolean; state?: 'complete' | 'error' | 'upcoming' }[]`, `activeStepId`.
- **Events:** `onNext() => Promise<boolean>` (resolves `false` when step validation fails), `onBack()`, `onStepSelect?(stepId)` (only for completed steps), `onFinish() => Promise<void>`.
- **Slots:** `children` (the active step's content), `footer`.
- **State:** step navigation pending state only; field values belong to the caller's form, so they survive a failed `onNext` or `onFinish`.
- **Never:** owns form values or calls APIs.
- **Sources:** `InjectionWizard`, shipping `useShipmentWizard`, Figma Step Indicator `3507:28` / `3507:227` / `3507:560`.

### Stack / Inline

- Layout-only: `gap` from the DS scale, `align`, `justify`, `wrap`. No `status`, no events. Shown as small gallery examples; ties to the spacing-system to-do.

### Deferred families

DataGrid stays `DataTable` until a concrete gap is shown; FormLayout starts as a documented `CrudForm` recipe; ListView, CardGrid, CommentThread, MasterDetail are extracted only when two screens need the same interaction. Gantt and Signature remain domain implementations for now.

## Module wiring (not part of blocks)

- **Reads:** TanStack Query v5 (already shipped: `packages/ui/src/theme/QueryProvider.tsx`) with `fetchCrudList`; cache keys include organization scope, as in the example `TodosTable`. One cache client.
- **Writes:** existing CRUD helpers, `useGuardedMutation`, `buildOptimisticLockHeader`, `surfaceRecordConflict`, undo registered from the command response.
- **Action contract** the module fills for each block event: required feature, target record id and version, confirmation copy, conflict handling, views to refresh. The block receives a label, a state and a callback.
- Public data hooks in `@open-mercato/ui/data/*` are published only after two modules share the same contract; until then wiring lives in modules.

## Distribution

- **Default:** import from `@open-mercato/ui/blocks/<name>`; fixes arrive with package updates.
- **Copy:** `mercato ui add <block> --module <module>` copies the block source into `src/modules/<module>/components/blocks/` when the author needs a different structure, section order or action set. Never into `apps/mercato/src`.
- **Traceability:** `blocks.lock.json` in the module records block name, version and source hash. First release: diff against the registry version and safe re-install. Three-way update later.
- Interaction hooks stay imported, so behaviour fixes reach copies too; changes to copied JSX (including accessibility) need the diff.

## Registry

- **Source:** the design-system gallery. New family `blocks`. Optional, additive `GalleryEntry` fields (contract owned by the gallery spec, which gets a changelog entry): `distribution?: 'package' | 'copy'`, `files?: string[]`, `propsSchema?: ZodTypeAny`, `scenarios?: string[]`, `requires?: string[]`. `GalleryEntry` keeps `importPath` and executable `render()`; preview, public import and copyable file are separate fields.
- **Generator:** extend `packages/create-app/scripts/generate-design-system-inventory.mjs` (already checks published package contents, public imports and preset availability) with installable sources and contracts, plus a publish export validated against the npm package contents. Storybook keeps using the same gallery reader.
- **Inventory fields** for every component, existing ones included: data inputs, required providers, optional host services, extension points; status as public export / working example in a module / not found; separately Figma mapping, visual confirmation, installability (see `.ai/lessons/design-system-coverage-needs-a-source-inventory.md`).
- **JSON export:** data, slot names, event names, scenario names, links to examples; no functions. It describes installable code and is distinct from any runtime format an agent might use to generate UI on the fly.

## Public showcase `apps/design`

A Next.js app (same Next and Tailwind 4 as `apps/mercato`, so previews match production), statically exported, generated from the registry. Own look on the OM DS; only the page structure follows ui.shadcn.com.

- **Entry by task** ("review overdue work", "see what happened to a record", "move work to the next stage"), with search by component name.
- **Component pages:** preview and code, install or copy command, contract table (inputs, events, slots, state), Figma link.
- **Scenario switch** on every block: default, read-only, pending action, rejected move or edit conflict, empty, narrow screen. Same scenarios run as tests.
- **Themes and foundations:** admin / storefront / merchant brand, colors, typography, spacing, charts.
- **Agent index:** `/r/<name>.json`, `/r/index.json`, `llms.txt`.

All pages render fixtures only: no tenant data, no API calls. Public files and illustrations are reviewed before publishing.

## Data models and API contracts

No database, API route or event changes. New contract surfaces, all additive: import paths `@open-mercato/ui/blocks/*` and `@open-mercato/ui/headless/*` (and later `data/*`), block prop types, optional `GalleryEntry` fields, registry JSON and `blocks.lock.json` formats (with a `version` field), CLI `mercato ui add`. Copied block code belongs to the module that copied it.

## Migration and backward compatibility

Nothing is removed or renamed. Existing components keep their APIs. `GalleryEntry` changes are optional fields. New paths and CLI commands are additive per `BACKWARD_COMPATIBILITY.md`. Block prop types follow the same rules as any public type once released.

## Test coverage

- **Boundary:** a test failing when any file under `blocks/` imports a domain module, `apiCall`, `fetch`, TanStack Query or `useGuardedMutation`.
- **Contract:** each block's gallery fixtures parse against its `propsSchema`; event signatures match the contract types.
- **Scenarios:** each block renders every declared scenario; interaction tests for pending and rejection (Kanban revert, KeyValue draft kept, Wizard values kept after failed `onNext`), keyboard paths (Kanban keyboard move, Timeline focus), no horizontal overflow at 390 px.
- **Registry:** generator output validated against its schema and against the npm package contents; docs examples build (catches imports like the missing `DataGrid`).
- **CLI:** `mercato ui add` copies files, writes the lock with hash, refuses to overwrite local edits without `--force`, diff reports changes.
- **`apps/design`:** build, page smoke test, `llms.txt` generated; `yarn storybook:check` clean.
- **DS and i18n:** `om-ds-guardian`, `yarn lint`, `yarn i18n:check-hardcoded`.

## Risks

| Risk | Mitigation |
|---|---|
| Contracts leak domain concepts | boundary test; contract review against two existing sources per family (e.g. CRM and Staff kanban) |
| Contracts too abstract to use | slots for every content area; scenarios show real states |
| Copies drift | default import; interaction hooks stay in the package; lock with hash and diff |
| Gallery contract grows too broad | optional fields only, owned and reviewed in the gallery spec |
| Public site exposes internals | fixtures only; file review before publishing |
| New app adds maintenance cost | static export generated from the registry; CI smoke only |

## Implementation phases

1. **Contracts:** shared types, five family contracts as TS types and zod schemas, boundary test, inventory fields for existing components, fix `data-grids.mdx`.
2. **Blocks:** implement EntityHeader, KeyValue, Timeline, Wizard, Stack/Inline in `blocks/` with gallery entries and scenarios; Figma mapping approved per block before code.
3. **Kanban:** reconcile CRM and Staff boards into the contract, Figma design approval, then implementation.
4. **Registry and CLI:** extend the inventory generator, JSON export, `mercato ui add` with lock and diff.
5. **`apps/design` MVP** (subject to open question 2).
6. **Adoption and storefront:** per-screen adoption decisions (CRM history, deals pipeline, Staff board), each keeping its module contracts; storefront on the shared contracts after the scope decision.

## Open questions

1. **Scope:** shared contracts for the whole OM with back office implemented first, storefront later in a separate package with its own dependency and bundle-size limits? Or back office only?
2. **`apps/design`:** approve a new app in `apps/`, and hosting/domain? Fallback: a `/design` section in the existing docs first.
3. **Data wiring:** confirm TanStack Query as the cache base with OM helpers for reads and writes, and public data hooks only after two modules share a contract?
4. **Kanban:** reconcile CRM and Staff boards first, then Figma, then extract?

## Changelog

- 2026-11-24: Initial draft.
