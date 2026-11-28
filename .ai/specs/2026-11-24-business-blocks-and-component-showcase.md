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
| Tokens and themes | existing token CSS, theming spec | platform | admin (default), merchant brand; shapes via role radius tokens |
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
- Every block accepts `status`. `loading` renders `LoadingMessage`, `error` renders `ErrorMessage` with `errorMessage`, `empty` renders the `emptyState` slot or the default `EmptyState` primitive; each replaces the block content. List blocks (KeyValue, Timeline) also treat an empty item list as `empty`. Timeline keeps its `header` and filters above these states so filters stay usable. EntityHeader has no empty state and renders normally for `empty`. Purely static layout blocks (Stack, Inline) take no `status`.
- Block-specific fields must not reuse the shared prop names (`status`, `errorMessage`, `emptyState`, `className`).
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

- **Input:** `title`, `subtitle?`, `avatar?: { src?: string; initials: string }`, `badge?: { label: string; tone: BlockTone }`, `meta?: { key: string; label: string; value: string }[]`, `actions?: BlockAction[]`, `primaryActionKey?: string`.
- **Events:** `onAction(actionKey)`.
- **Slots:** `leading`, `trailing`, `below`.
- **State:** none; overflow menu open state only.
- **Never:** knows the entity type, links to module routes by itself.

### KeyValue

- **Input:** `items: { key: string; label: string; icon?: React.ReactNode; value: React.ReactNode; hint?: string; editable?: boolean; editor?: 'text' | 'textarea' | 'select' | 'date'; options?: { value: string; label: string }[] }[]`, `columns?: 1 | 2`, `layout?: 'horizontal' | 'vertical'` (default horizontal: label column beside the value, stacked below `sm`), `bordered?: boolean`.
- **Look:** rows of a list, not a card per pair; labels in sentence case, `text-muted-foreground`, never uppercase. The edit button shows on row hover or focus for fine pointers and stays visible on touch.
- **Events:** `onEdit(key, nextValue) => Promise<void>`.
- **Slots:** per-item `value` (rich display), `footer`.
- **State:** the block owns the edit draft of the item being edited; it commits through `onEdit` and returns to read mode on resolve, keeps the draft on reject.
- **Never:** validates domain rules (the caller rejects the promise with a message).
- **Today:** `KeyValueList` (`packages/ui/src/ai/records/RecordCardShell.tsx`) covers the read-only case.

### Timeline

- **Input:** `items: TimelineItem[]`, `groupBy?: 'day' | 'period' | 'none'` (`period`: This week, then months, a year heading for earlier years; sections collapse), `order: 'desc' | 'asc'` (describes the order the caller already applied; the block does not sort), `filters?: { key: string; label: string; count?: number }[]`, `activeFilterKey?: string`, `hasMore?: boolean`.
- **`TimelineItem`:** `id`, `occurredAt`, `kind: string`, `icon?: LucideIconName`, `title`, `body?: React.ReactNode`, `author?: { name: string; avatarSrc?: string }`, `attachments?: { name: string; href?: string; format?: string }[]`, `status?: { label: string; tone: BlockTone }`, `changes?: { key?: string; label: string; icon?: LucideIconName; from?: React.ReactNode; to: React.ReactNode }[]` (more than three collapse behind a toggle), `target?: { label: string; href?: string; icon?: LucideIconName; avatarSrc?: string }`, `actions?: BlockAction[]`.
- **Look:** an event icon on a vertical rail for every item; the author avatar sits in the sentence (author, verb, target chip, relative time); text bodies sit in a bordered card and clamp to three lines.
- **Events:** `onItemAction(itemId, actionKey)`, `onFilterChange(filterKey)`, `onLoadMore() => Promise<void>`.
- **Slots:** `renderItemBody(item)` override, `header`.
- **State:** expanded change lists, expanded bodies and collapsed period sections; ordering and filtering of data are the caller's (the block only groups what it receives).
- **Never:** merges sources or pages (CRM history merges cursor-paged and page-numbered endpoints; that stays in the module adapter).
- **Visual source:** Figma Activity Feed `166035:46833` and the `activity-feed` primitive.

### Kanban

- **Input:** `columns: { id: string; title: string; count?: number; remaining?: number; summary?: React.ReactNode; hasMore?: boolean; status?: 'loading' | 'error' | 'ready'; errorMessage?: string; cards: { id: string }[] }[]`. `count` is the server total, not the number of loaded cards; `remaining` labels "Show more (N)". `reorderable?: boolean` (default false): without it the card lands at the top and `toIndex` is 0.
- **Events:** `onMove(cardId, toColumnId, toIndex) => Promise<void>`, `canMove?(cardId, toColumnId) => true | { reason: string }`, `onLoadMoreColumn(columnId) => Promise<void>`, `onCardOpen(cardId)`.
- **Slots:** `renderCard(card, { pending, dragging })` (required), `renderDragPreview?(card, { count })`, `columnHeader(column)`, `columnFooter(column)` (add-card affordance), `emptyColumn(column)`, `trailing` (e.g. an "add stage" column).
- **State:** the block owns the optimistic position of a card while `onMove` is pending and reverts on rejection; column data is the caller's. A column with `status` shows its own loading or error state without replacing the board.
- **Accessibility:** a built-in "Move to" menu on every card is the keyboard alternative to drag (Enter and Space stay free for `onCardOpen`); pick up, move, drop, cancel and `canMove` rejections are announced via a live region with translated messages.
- **Never:** decides transition rules; it asks `canMove` and shows the returned reason. Never shows `onMove` error text: the caller handles conflicts (409) and retries.
- **Reconciled sources:** CRM deals pipeline and Staff time tracking board. Both move cards between columns only, show a server count and a sum, page columns, add cards per column and end with an "add column" column. Deferred, single-board needs: multi-select with group drag and column resize (CRM). Not added: collapse, WIP limits, swimlanes. The DS Figma file has no kanban design; the approved mapping composes the board from existing primitives.

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

### Validation rules beyond the field lists

The schemas enforce these constraints in addition to the fields listed above:

- Avatar initials are at most 3 characters.
- `disabledReason` requires `disabled: true`.
- Each callback-gated feature requires its handler:
  - EntityHeader actions require `onAction`.
  - KeyValue editable items require `editor` and `onEdit`; select editors also require `options`.
  - Timeline `hasMore` requires `onLoadMore`, item actions require `onItemAction`, and filters require `onFilterChange`.
  - Kanban `hasMore` requires `onLoadMoreColumn`.
- `primaryActionKey` and `activeFilterKey` must reference existing keys.
- Ids and keys are unique within their list. Kanban card ids are unique across the whole board.
- Wizard needs at least one step, and `activeStepId` must match a step id.
- Stack and Inline accept `gap` values 0, 1, 2, 3, 4, 5, 6, 8, 10 and 12; `align` of start, center, end, stretch or baseline; `justify` of start, center, end or between; plus `wrap`, `className` and `children`.
- Slots and events carry schema metadata `kind: 'slot' | 'event'` so the registry export can list them.

## Module wiring (not part of blocks)

- **Reads:** TanStack Query v5 (already shipped: `packages/ui/src/theme/QueryProvider.tsx`) with `fetchCrudList`; cache keys include organization scope, as in the example `TodosTable`. One cache client.
- **Writes:** existing CRUD helpers, `useGuardedMutation`, `buildOptimisticLockHeader`, `surfaceRecordConflict`, undo registered from the command response.
- **Action contract** the module fills for each block event: required feature, target record id and version, confirmation copy, conflict handling, views to refresh. The block receives a label, a state and a callback.
- Public data hooks in `@open-mercato/ui/data/*` are published only after two modules share the same contract; until then wiring lives in modules.

## Distribution

- **Default:** import from `@open-mercato/ui/blocks/<name>`; fixes arrive with package updates.
- **Copy:** `mercato ui add <block> --module <module>` copies the block source into `src/modules/<module>/components/blocks/` when the author needs a different structure, section order or action set. Never into `apps/mercato/src`.
- **Traceability:** `blocks.lock.json` in the module records block name, version and source hash. First release: diff against the registry version and safe re-install. Three-way update later.
- **Source of the copy:** the installed `@open-mercato/ui` package (`src/blocks/<block>/`), so the command needs no network and the copied version always matches the package the app runs. Tests and gallery fixtures are left out; imports of `../contracts/*` are rewritten to `@open-mercato/ui/blocks/contracts`. A block that reaches outside its folder any other way fails the copy.
- **Commands:** `mercato ui list [--json]`, `mercato ui add <block> --module <module> [--force] [--json]`, `mercato ui diff [<block>] --module <module> [--exit-code] [--json]`. `add` refuses to overwrite a copy whose files differ from the lock, or files the lock does not track, unless `--force` is passed; an untouched copy is updated in place and files dropped upstream are removed. `diff` prints a unified diff of the local copy against the installed registry version and says whether the registry source changed since the copy.
- **Lock format (`version: 1`):** `{ "version": 1, "blocks": { "<block>": { "package", "packageVersion", "hash", "target", "files": { "<path>": "<sha256>" } } } }`. Hashes cover the files as written, so a local edit is detected without the package.
- Interaction hooks stay imported, so behaviour fixes reach copies too; changes to copied JSX (including accessibility) need the diff.

## Registry

- **Source:** the design-system gallery. New family `blocks`. Optional, additive `GalleryEntry` fields (contract owned by the gallery spec, which gets a changelog entry): `distribution?: 'package' | 'copy'`, `files?: string[]`, `propsSchema?: ZodTypeAny`, `scenarios?: string[]`, `requires?: string[]`. `GalleryEntry` keeps `importPath` and executable `render()`; preview, public import and copyable file are separate fields.
- **Generator:** extend `packages/create-app/scripts/generate-design-system-inventory.mjs` (already checks published package contents, public imports and preset availability) with installable sources and contracts, plus a publish export validated against the npm package contents. Storybook keeps using the same gallery reader.
- **Inventory fields** for every component, existing ones included: data inputs, required providers, optional host services, extension points; status as public export / working example in a module / not found; separately Figma mapping, visual confirmation, installability (see `.ai/lessons/design-system-coverage-needs-a-source-inventory.md`). Phase 1 ships a hand-written seed list; the generator takes over in phase 4.
- **JSON export:** data, slot names (`slots`), event names (`events`), scenario names, links to examples, and `install` (copy command, target folder, source hash, copied files with their hashes and `/r/files/<block>/<path>.txt` URLs); no functions. It describes installable code and is distinct from any runtime format an agent might use to generate UI on the fly.

## Themes

Blocks never carry theme-specific classes. A theme is a set of token values applied to a container.

- **Role radius tokens** (additive): `--om-radius-button`, `--om-radius-field`, `--om-radius-card`, `--om-radius-badge`, exposed as `rounded-button`, `rounded-field`, `rounded-card`, `rounded-badge`. Defaults equal today's primitive radii, so the admin look does not change. `Button`, `Input`, `Card` and `Badge` use them.
- **Preview tokens:** previews use the canonical app tokens. Inline specimens, isolated variant documents and Storybook follow the selected light or dark mode. The documentation shell uses the same tokens.
- Blocks are back-office building blocks. The storefront has its own design system (`packages/storefront-ui`), so the showcase has no storefront theme switch.

## Public showcase `apps/design`

A Next.js app (same Next and Tailwind 4 as `apps/mercato`, so previews match production), statically exported, generated from the registry. Styled with OM DS tokens (light by default, dark mode switch). The catalogue uses an Open Mercato layout. A live record example on the overview switches between service and warehouse, with local actions. Searchable indexes and isolated component examples document the library. Storefront UI v2 informs the separation of components, blocks and interaction hooks.

- **Typeset:** The Foundations registry includes an interactive work order and an operational document. Size, line height and reading measure are adjustable per preset. The preview and copyable stylesheet share the same UI package rules and theme tokens. Verify both contexts, CSS export and narrow layouts on `/foundations/typeset/`.
- **Sidebar groups:** Introduction, Foundations (tokens, themes, typography), Components (primitives), Blocks, Hooks (shown once the headless layer exists). Index pages list all components and all blocks.
- **Top bar:** dark mode toggle, repository link.
- **Component page:** title, description, tabs Usage / API / Source code. Usage lists every scenario with a heading, a Preview / Code toggle and an isolated preview frame (iframe on `/preview/<entry>/<variant>`) that fills the available width. Only examples demonstrating responsive layouts (such as wrapping rows or multi-column detail fields) opt into a resize handle, width readout and quick widths 390 / 768 / 1024 / 1440. API is generated from the zod contract (`z.toJSONSchema`, slot and event kinds from `.meta`). Source code links to the file.
- **Component page sections (optional per entry):** a metadata row under the import (since version from `GalleryEntry.since`, open issues search, edit this page); When to use first (`usage.do` / `usage.dont`); each example with a one-line `description` and an open-in-new-tab link to its preview route; Accessibility notes (`accessibility`); FAQ with concrete pitfalls (`faq`); Design tokens the component reads (`tokens`) on the API tab; an On this page table of contents (the `Anchor` primitive) from 1280 px. Translations use `design_system.gallery.{variantDescriptions,accessibility,faq}.<entry>.*` keys, enforced by the translation coverage test.

- **Entry by task** ("review overdue work", "see what happened to a record", "move work to the next stage"), with search by component name.
- **Component pages:** preview and code, install or copy command, contract table (inputs, events, slots, state), Figma link.
- **Scenario switch** on every block: default, read-only, pending action, rejected move or edit conflict, empty, narrow screen. Same scenarios run as tests.
- **Themes and foundations:** admin / merchant brand, colors, typography, spacing, charts.
- **Agent index:** `/r/<name>.json`, `/r/index.json`, `llms.txt`.

All pages render fixtures only: no tenant data, no API calls. Public files and illustrations are reviewed before publishing.

## Data models and API contracts

No database, API route or event changes. New contract surfaces, all additive: import paths `@open-mercato/ui/blocks/*` and `@open-mercato/ui/headless/*` (and later `data/*`), block prop types, optional `GalleryEntry` fields, registry JSON and `blocks.lock.json` formats (with a `version` field), CLI `mercato ui add`. Copied block code belongs to the module that copied it.

## Migration and backward compatibility

Nothing is removed or renamed. Existing components keep their APIs. `GalleryEntry` changes are optional fields. New paths and CLI commands are additive per `BACKWARD_COMPATIBILITY.md`. Block prop types follow the same rules as any public type once released.

## Test coverage

- **Boundary:** a test failing when any file under `blocks/` imports a domain module, `apiCall`, `fetch`, TanStack Query or `useGuardedMutation`. The guard checks direct imports only (and imported binding names), not transitive imports. Besides the data modules, it forbids the bindings `apiCallOrThrow`, `readApiResultOrThrow`, `fetchWithTimeout`, `fetchCrudList`, `useQuery`, `useQueries`, `useMutation`, `useQueryClient` and `useInfiniteQuery` from any module, and `window.fetch`, `globalThis.fetch` and `self.fetch` calls.
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

1. **Contracts:** shared types, five family contracts plus Stack/Inline as TS types and zod schemas, boundary test, a seed portability inventory (8 audited components) in `packages/ui/src/blocks/inventory`, to be moved into the inventory generator in phase 4, fix `data-grids.mdx`.
2. **Blocks:** implement EntityHeader, KeyValue, Timeline, Wizard, Stack/Inline in `blocks/` with gallery entries and scenarios; Figma mapping approved per block before code.
3. **Kanban:** reconcile CRM and Staff boards into the contract, Figma design approval, then implementation.
4. **Registry and CLI:** extend the inventory generator, JSON export, `mercato ui add` with lock and diff.
5. **`apps/design` MVP** (subject to open question 2).
6. **Adoption and storefront:** per-screen adoption decisions (CRM history, deals pipeline, Staff board), each keeping its module contracts; storefront on the shared contracts after the scope decision.

## Open questions

1. **Scope:** shared contracts for the whole OM with back office implemented first, storefront later in a separate package with its own dependency and bundle-size limits? Or back office only?
2. **`apps/design`:** new app in `apps/` approved; hosting/domain still open.
3. **Data wiring:** confirm TanStack Query as the cache base with OM helpers for reads and writes, and public data hooks only after two modules share a contract?
4. **Kanban:** reconcile CRM and Staff boards first, then Figma, then extract?

## Changelog

- 2026-11-26: Phase 4 (CLI and export): `mercato ui list / add / diff` with `blocks.lock.json`; the registry JSON gained `install`, `slots` and `events`; block pages and `llms.txt` show the copy command. Still open in phase 4: moving the seed portability inventory into the inventory generator and validating the export against the published npm package contents.
- 2026-11-25: Added the `Result` and `DesignScope` primitives (DesignScope backs the home page panel; the light token block also answers to `.light` so a light scope works inside a dark page); the showcase home page follows the Ant Design layout with a live token panel, a new and updated strip and a grain texture.
- 2026-11-25: Spacing roles (`--om-space-*` tokens with Tailwind keys, compact density scope, `page-grid`) applied to FormField, CrudForm, Card, Dialog and the blocks; Timeline rebuilt in the Attio style with `groupBy: 'period'`, per-item `changes` and `target`.
- 2026-11-25: KeyValue moved from a card per pair to list rows with `layout` and `bordered`, plus an optional label icon; labels across the DS and primitives switched from uppercase to sentence case.
- 2026-11-25: Component pages gained optional When to use, example descriptions, accessibility, FAQ, design tokens and an On this page table of contents; added the `BorderBeam`, `Splitter` and `Anchor` primitives.
- 2026-11-25: Removed the storefront preview theme and the Admin / Storefront switch; blocks target the back office, the storefront keeps `packages/storefront-ui`. Role radius tokens stay.
- 2026-11-24: Phase 3: Kanban contract extended after reconciling the CRM pipeline and Staff board; block implemented on existing primitives.

- 2026-11-24: Showcase redesign with a reversible record action in two example modules, responsive block specimens, searchable indexes and examples before guidance. Public block JSON and matching source files are generated from the gallery. Explicit package entry points expose the five implemented families. The copy CLI and Kanban implementation are pending.

- 2026-11-24: Storefront direction decided: showcase structure follows Storefront UI v2 docs on OM DS tokens; storefront theme uses the ecommerce Figma palette with Storefront UI shapes; additive role radius tokens.
- 2026-11-24: Phase 2 blocks implemented (EntityHeader, KeyValue, Timeline, Wizard, Stack/Inline) with gallery family `blocks`.

- 2026-11-24: Phase 1 implemented: contracts in `packages/ui/src/blocks/contracts`, import-boundary test, portability inventory in `packages/ui/src/blocks/inventory`, `data-grids.mdx` fixed.
- 2026-11-24: Documented validation rules enforced by the phase 1 contracts.
- 2026-11-24: Initial draft.
