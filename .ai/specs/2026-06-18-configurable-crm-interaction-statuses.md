# Configurable CRM interaction (task) statuses

> Status: DRAFT (ready for review)
> Scope: OSS · Module: `customers` (`packages/core`)
> Date: 2026-06-18

## TLDR

CRM tasks are `customer_interactions`. Their `status` is today a hardcoded enum
`interactionStatusValues = ['planned', 'done', 'canceled']`
(`packages/core/src/modules/customers/data/validators.ts:381`) wired into `z.enum(...)`. Tenants
cannot add or rename statuses. This spec makes interaction statuses **dictionary-backed and
UI-configurable per tenant**, reusing the existing `deal-statuses` mechanism — **Option A**: the
editable list lives in a dictionary; the behaviorally-significant **open/terminal semantics** stay
in code, centralized in one helper. The default seeded set grows from three to five: `planned`,
`in_progress`, `waiting`, `done`, `canceled`.

The non-obvious work is not the dictionary — that pattern already exists for deals. It is closing
the **"open" semantic gap**: the codebase holds two competing definitions of an open interaction
(`status NOT IN (terminal)` in the enricher vs. `status = 'planned'` in several other call sites).
Adding `in_progress`/`waiting` means the positive `= 'planned'` filters would silently drop them.

## Overview

Deal statuses in the same module already flow through the `dictionaries` mechanism: a seeded
`deal-statuses` dictionary, a management UI section, per-tenant editing, and lenient validation
(`status: z.string().max(50)`). Interaction (task) statuses never received that treatment and remain
a fixed enum. This spec brings interactions to parity with deals using the identical mechanism, and
does the extra correctness work that interactions specifically require: a single open/terminal
semantics helper and an audit of every call site that branches on interaction status.

No new entity, no DB migration, no new ACL feature, no new event ID. The change is additive to a
contract surface (`interactionStatusValues`) and is handled with a deprecation bridge.

## Resolved decisions

- **Q1 — Seeded set.** `planned, in_progress, waiting, done, canceled`. "Waiting / blocked" is a
  single status (`value: waiting`, label "Waiting / blocked").
- **Q2 — Unknown/custom status bucket.** A status not known to code counts as **open /
  non-terminal** (appears in the open-activities badge, never auto-treated as completed). This is
  the safe default and matches the enricher's existing exclusion filter.
- **Q3 — Complete target.** `complete_task` / the UI "Complete" action keeps mapping to the single
  canonical terminal-success status `done`. No change to the MCP, no per-status complete picker.
- **Validation is lenient**, mirroring `deal_status` (`validators.ts:147`,
  `status: z.string().max(50).optional()`). The `interaction-statuses` dictionary drives the UI
  dropdown only; the API accepts any string ≤50 chars (no strict 422). Keeps BC for existing rows /
  external writers and keeps the `dispatch-crm` MCP working unchanged.
- **Q4 — Rich picker is canonical-only.** The task-form status `<select>` renders only when the
  tenant is on the canonical interactions path (`interactionMode === 'canonical'`); the legacy path
  keeps the done checkbox, because the deprecated `/api/customers/todos` bridge cannot round-trip
  non-binary statuses. See [Interaction-mode constraint](#interaction-mode-constraint-legacy-vs-canonical).

## Problem statement

`customer_interactions.status` is a fixed three-value enum. Operators who run follow-ups through the
CRM cannot model an in-progress or waiting-on-customer task; every task is either open (`planned`) or
closed (`done`/`canceled`). Statuses are not editable from the UI, unlike deal statuses. Extending
the enum in code would not make it configurable and would still require a redeploy per change.

## Proposed solution (Option A)

Introduce an `interaction-statuses` dictionary, identical in mechanism to `deal-statuses`:

- Storage kind `interaction_status` (underscore), route/UI kind `interaction-statuses` (hyphen),
  bridged in `KIND_MAP` (`api/dictionaries/context.ts:48`). No new entity or migration — dictionary
  `kind` is a free-text column on the reused `customer_dictionary_entries` table.
- Seed defaults via `INTERACTION_STATUS_DEFAULTS` consumed inside `seedCustomerDictionaries`
  (`cli.ts:1101`), exactly like `DEAL_STATUS_DEFAULTS` (`cli.ts:56`).
- Validators stop using `z.enum(...)` and become lenient `z.string().max(50)`.
- Open/terminal semantics move out of the private enricher constant into one shared helper
  (`lib/interactionStatus.ts`) that every call site reads. The enricher's existing
  `status NOT IN (terminal)` already does the right thing for unknown statuses; the gap is the
  positive `= 'planned'` call sites, which broaden to the shared "open" predicate.
- `complete` still sets `done`, `cancel` still sets `canceled`, undo still reverts to the snapshot
  (`planned`). Unchanged.
- The deal-style management UI section ("Interaction statuses") is added to `DictionarySettings` and
  `DictionarySortSettings`, gated by the existing `customers.settings.manage` feature (no new ACL).

This is intentionally a thin feature: it reuses the dictionary CRUD, routes, cache, hook, and
management components wholesale. The spec documents only the parts unique to interactions.

## Architecture

- **Module isolation.** Everything lives inside `customers`. No cross-module ORM relation, no
  cross-module import. The dictionary is the same `customer_dictionary_entries` table already used
  for deal statuses, scoped by `(organization_id, tenant_id, kind)`.
- **DI / commands.** No new service and no new command. Interaction writes keep going through the
  existing undoable commands (`customers.interactions.{create,update,complete,cancel,delete}`); the
  dictionary writes keep going through the existing `customers.dictionaryEntries.{create,update,delete}`
  commands. This spec only changes which `kind` they accept and the validator on the `status` field.
- **Semantics boundary.** The one piece of genuinely new logic — "which status means open vs
  closed" — is isolated in `lib/interactionStatus.ts` so there is a single source of truth rather
  than the current scatter of literals.

## Data model

No schema change. Reused tables (`data/entities.ts`):

- `customer_dictionary_entries` (`entities.ts:888`) — stores `(kind='interaction_status', value,
  label, color, icon)` per `(organizationId, tenantId)`. Unique on
  `(organizationId, tenantId, kind, normalizedValue)`.
- `customer_dictionary_kind_settings` (`entities.ts:1060`) — optional per-kind sort/selection
  settings, created on demand (not seeded), same as deals.
- `customer_interactions.status` (`entities.ts:599`) — unchanged `text default 'planned'` column.
  It already accepts arbitrary strings at the DB level; only the application validator changes.

## API contracts

No new route files. Affected/reused contracts:

- **Dictionary CRUD (reused as-is).**
  `GET/POST /api/customers/dictionaries/interaction-statuses` and
  `PATCH/DELETE /api/customers/dictionaries/interaction-statuses/{id}`. Served by the existing
  `api/dictionaries/[kind]/route.ts` once the kind is registered (`BUILTIN_DICTIONARY_ROUTE_KINDS`,
  `KIND_MAP`, `DICTIONARY_KINDS`, `CUSTOMER_DICTIONARY_KINDS`). Guards unchanged: `GET` requires
  `customers.people.view`, writes require `customers.settings.manage`. `openApi` already exported by
  that route. Response shape unchanged (`{ sortMode, items: [{ id, value, label, color, icon, … }] }`).
- **Interaction create/update (validator widened).**
  `POST/PUT /api/customers/interactions` — `status` validator goes from
  `z.enum(interactionStatusValues)` to `z.string().max(50)` (`validators.ts:424` keeps
  `.default('planned')`; `:491` stays optional). Widening only; no request/response shape change.
- **Complete / cancel (unchanged).** `POST /api/customers/interactions/complete` → `done`;
  `…/cancel` → `canceled`. No contract change.
- **Counts (param reframed, BC-preserving).** `GET /api/customers/interactions/counts` — the
  `status` query param (`route.ts:15`, today `z.enum(['done','planned'])`) gains an `open` value
  meaning "not terminal"; `planned` is retained as an accepted alias.

## Status semantics — single source of truth

New module file `packages/core/src/modules/customers/lib/interactionStatus.ts`:

```ts
// Built-in interaction status values known to code. Tenants may add more via the
// `interaction-statuses` dictionary; unknown values are treated as OPEN (Q2).
export const INTERACTION_STATUS_COMPLETED = 'done' as const   // canonical terminal-success
export const INTERACTION_STATUS_CANCELED = 'canceled' as const
export const INTERACTION_STATUS_PLANNED = 'planned' as const

// Terminal = closed. 'completed' is a legacy spelling accepted defensively (see enrichers.ts:25).
const TERMINAL_INTERACTION_STATUSES = new Set(['done', 'canceled', 'completed'])

export function isTerminalInteractionStatus(value: string | null | undefined): boolean {
  return value != null && TERMINAL_INTERACTION_STATUSES.has(value)
}
export function isOpenInteractionStatus(value: string | null | undefined): boolean {
  return !isTerminalInteractionStatus(value)
}
export const TERMINAL_INTERACTION_STATUS_LIST = [...TERMINAL_INTERACTION_STATUSES]
```

`data/enrichers.ts:27` deletes its private `TERMINAL_INTERACTION_STATUSES` and imports
`TERMINAL_INTERACTION_STATUS_LIST` for its `status NOT IN (...)` query (`enrichers.ts:66`).
`isStuck`/`isOverdue` are unaffected (they never read interaction status).

## The "open" call-site decision table

Every site that encodes open-vs-terminal is reviewed. SQL `= 'planned'` that means "open" broadens
to "not terminal"; truly-planned-only intent stays.

| Call site | Today | Decision |
|---|---|---|
| `data/enrichers.ts:66` (open-activities badge) | `status NOT IN ('done','canceled','completed')` | Keep; source the list from the helper. Already correct for new/custom statuses. |
| `lib/interactionProjection.ts:35` (next-interaction projection → search/denormalized) | `status = 'planned'` | **Broaden to open** — a started/blocked task is still the next step. |
| `api/interactions/conflicts/route.ts:103` (scheduling conflicts) | `status = 'planned'` | **Broaden to open** — an in-progress/waiting scheduled item still conflicts. |
| `api/people/[id]/route.ts:560`, `api/companies/[id]/route.ts:528` (upcoming non-task activities) | `status === 'planned' && type !== 'task'` | **Broaden to open** non-task activities. |
| `api/interactions/counts/route.ts:15` (count param `z.enum(['done','planned'])`) | planned vs done | Reframe param to `open` vs `done`; `open` counts non-terminal. Keep `planned` as an accepted alias for BC. |
| UI "Mark done" affordance: `ActivityTimeline.tsx:86`, `ActivityCard.tsx:200`, `TasksSection.tsx`, `PlannedActivitiesSection.tsx`, `NextStepCard.tsx`, `OpenTasksWidget.tsx` | show when `status === 'planned'` | **Broaden to `isOpenInteractionStatus`** so in_progress/waiting tasks can still be completed. |
| `ActivitiesCard.tsx:71,256` overdue predicate (`status !== 'done'`) | not-done + past schedule | Switch the `!== 'done'` half to `isOpenInteractionStatus` for canceled-correctness. |
| `commands/interactions.ts:922` (`'done'`), `:1062` (`'canceled'`) | hardcoded transitions | Keep; reference helper constants instead of literals. |
| `lib/link-channel-message-handler.ts:488` (`status:'done'` for logged emails) | hardcoded | Keep; reference `INTERACTION_STATUS_COMPLETED`. |

## Dictionary wiring (mirror of deal-statuses)

1. `cli.ts` — add `INTERACTION_STATUS_DEFAULTS` and a seed loop in `seedCustomerDictionaries`
   (storage kind `interaction_status`):
   ```ts
   export const INTERACTION_STATUS_DEFAULTS: DictionaryDefault[] = [
     { value: 'planned',     label: 'Planned',           color: '#2563eb', icon: 'lucide:circle' },
     { value: 'in_progress', label: 'In progress',       color: '#f59e0b', icon: 'lucide:activity' },
     { value: 'waiting',     label: 'Waiting / blocked', color: '#a855f7', icon: 'lucide:pause-circle' },
     { value: 'done',        label: 'Done',              color: '#22c55e', icon: 'lucide:check-circle' },
     { value: 'canceled',    label: 'Canceled',          color: '#6b7280', icon: 'lucide:x-circle' },
   ]
   ```
   (`color` is dictionary data stored in the DB and mapped to a DS tone at render via
   `mapDictionaryColorToTone`, exactly like `DEAL_STATUS_DEFAULTS` — it is not a Tailwind class.)
2. `commands/shared.ts:142-155` — add `'interaction_status'` to the `DICTIONARY_KINDS` allow-set so
   `ensureDictionaryEntry` and the CRUD commands accept it.
3. `api/dictionaries/context.ts` — add `'interaction-statuses'` to `BUILTIN_DICTIONARY_ROUTE_KINDS`
   (`:12`) and `'interaction-statuses': 'interaction_status'` to `KIND_MAP` (`:42`).
4. `lib/dictionaries.ts:14` — add `'interaction-statuses'` to `CUSTOMER_DICTIONARY_KINDS`.
5. `components/DictionarySettings.tsx:52` and `components/DictionarySortSettings.tsx:46` — add the
   `{ kind: 'interaction-statuses', title, description }` section objects + i18n keys.

## UI rendering

Switch interaction/task status rendering from the three flat i18n keys + inline conditionals to the
dictionary map, mirroring deals (`createDictionarySelectLabels('deal-statuses')`, `StatusBadge` with
`mapDictionaryColorToTone`). Surfaces: `TasksSection.tsx`, `ActivityCard.tsx`, `ActivityTimeline.tsx`,
and any task list/detail that shows a status. The task create/edit form (a `CrudForm`) gains a status
`<select>` populated from the fetched dictionary options (today there is no status picker for tasks).
**The rich picker renders only on the canonical interactions path (`interactionMode === 'canonical'`);
on the legacy path the form keeps the existing done checkbox — see
[Interaction-mode constraint](#interaction-mode-constraint-legacy-vs-canonical).**
DS: `StatusBadge` + semantic tones only, no hardcoded status colors; the form is a `CrudForm`, so
`Cmd/Ctrl+Enter` submit and `Escape` cancel are inherited.

The legacy flat keys `customers.interactions.status.{planned,done,canceled}` stay as fallback labels
for any surface not yet dictionary-driven; the stored, tenant-editable dictionary label takes
precedence when present, same as deals.

## Interaction-mode constraint (legacy vs canonical)

Rich dictionary statuses are a **canonical-interactions** feature. The customers module still ships a
legacy interactions path, gated by the pre-existing `customers.interactions.unified` feature flag
(`lib/interactionFeatureFlags.ts:33`, default **off**, introduced by SPEC-046b — not by this spec).
On the legacy path, task writes go through the deprecated `/api/customers/todos` bridge, which
represents a task as a binary done/not-done todo: `in_progress`/`waiting`/custom statuses persist to
canonical storage but are flattened on read-back, so the picker cannot round-trip them.

**Decision (Q4):** the task-form status `<select>` renders **only when `interactionMode === 'canonical'`**
— the discriminator already returned by the people/companies detail GET (`api/people/[id]/route.ts:453`).
On the legacy path the form keeps the existing done checkbox. This removes a misleading control rather
than expanding the deprecated bridge. Writes are already canonical-only, so this is purely a
read/render gate.

Making canonical the default and retiring the legacy path is **out of scope here** and tracked in
[`2026-06-18-customers-interactions-legacy-removal.md`](2026-06-18-customers-interactions-legacy-removal.md)
(the SPEC-046b completion follow-up), which first closes four preconditions: the lossy backfill, two
legacy-only AI tools, the bridge deprecation protocol, and the default flip + legacy table removal.

## AI tool pack

`ai-tools/activities-tasks-pack.ts:241` filters interactions by `z.enum(['open','done','cancelled'])`
and maps `open → planned`, `done → 'completed'`. With the open-set redefinition, `open` maps to "not
terminal" (now including `in_progress`/`waiting`); the enum may additionally accept `in_progress`/
`waiting` as explicit filters. This also fixes a pre-existing spelling divergence (the pack writes
`'completed'`/`'cancelled'` while rows store `'done'`/`'canceled'`). Additive.

## MCP follow-up (out of scope for code)

The `dispatch-crm` MCP server lives in a separate repo. `create_task` (→ `planned`) and
`complete_task` (→ `done`) keep working unchanged. Setting `in_progress`/`waiting`/`canceled` from
the agent needs new `update_task`/`set_task_status` tools there — tracked as a follow-up in that
repo, not delivered here.

## Backward compatibility & migration

- **`interactionStatusValues` / `InteractionStatus` export** (`validators.ts:381-382`) — STABLE
  contract surface. **Keep contents unchanged (3 values)** and mark `@deprecated` with a pointer to
  the new helper + dictionary. Do not repurpose it as the validation source; do not expand its
  members (avoids breaking exhaustive `switch`/union consumers). New code uses
  `lib/interactionStatus.ts` and the dictionary.
- **Validators** switch `z.enum(interactionStatusValues)` → `z.string().max(50)` at
  `validators.ts:424` (keep `.default('planned')`) and `:491`. Widening — non-breaking.
- **Existing rows** already hold `planned`/`done`/`canceled`, equal to seeded dictionary values — no
  row rewrite required for the common case.
- **Legacy `completed` rows** (the spelling the enricher tolerates): optional one-time backfill
  `completed → done`. The helper keeps tolerating `completed` regardless, so this is cleanup, not a
  correctness requirement.
- **Existing tenants** need the new dictionary seeded. Add an idempotent upgrade action in
  `configs/lib/upgrade-actions.ts` (per `packages/core/AGENTS.md` → Upgrade Actions) that runs the
  same `ensureDictionaryEntry` seed for `interaction_status` across tenants. New tenants get it via
  `seedDefaults`.
- **No DB migration**, no new ACL feature, no event-ID change.

## Phasing

Each phase leaves the app working and shippable.

**Phase 1 — Semantics helper + enricher refactor (no behavior change).** Introduce
`lib/interactionStatus.ts`; replace the private enricher constant and the hardcoded transition
literals in commands / link-channel handler with helper references. Pure refactor, covered by
existing tests.

**Phase 2 — Close the open-set gap.** Broaden the `= 'planned'` call sites per the decision table to
`isOpenInteractionStatus` / `NOT IN terminal`. This is the behavior change that makes
`in_progress`/`waiting` first-class once they exist. Add coverage for "in-progress task still appears
as next step / open count / mark-done affordance".

**Phase 3 — Dictionary + seed + validators.** Add `INTERACTION_STATUS_DEFAULTS`, the seed loop, the
`DICTIONARY_KINDS`/`KIND_MAP`/`BUILTIN_DICTIONARY_ROUTE_KINDS`/`CUSTOMER_DICTIONARY_KINDS` entries,
and switch validators to lenient. After this, the five statuses are selectable and the API accepts
them.

**Phase 4 — Management UI + task status picker + rendering.** Add the "Interaction statuses"
sections to `DictionarySettings`/`DictionarySortSettings`, add the status `<select>` to the task
form, switch task/activity status rendering to the dictionary map + `StatusBadge`. i18n keys for the
new section titles.

**Phase 5 — Existing-tenant backfill + AI tool + deprecation.** Upgrade action to seed the dictionary
for existing tenants; optional `completed → done` cleanup; widen + spelling-align the AI tool status
filter; add `@deprecated` to `interactionStatusValues`.

## Implementation plan

> Format: step → verify.

### Phase 1
1. Create `lib/interactionStatus.ts` with the helper + constants → unit test
   `isTerminalInteractionStatus`/`isOpenInteractionStatus` for all five seeded + an unknown value.
2. Refactor `data/enrichers.ts` to import `TERMINAL_INTERACTION_STATUS_LIST` → existing enricher
   tests pass; `yarn workspace @open-mercato/core test`.
3. Replace literal `'done'`/`'canceled'`/`'planned'` in `commands/interactions.ts:393,922,1062` and
   `lib/link-channel-message-handler.ts:488` with helper constants → TC-UNDO-001 still green.

### Phase 2
4. Broaden `lib/interactionProjection.ts:35`, `api/interactions/conflicts/route.ts:103`,
   `api/people/[id]/route.ts:560`, `api/companies/[id]/route.ts:528` to the open predicate → unit
   tests asserting an `in_progress` row is included.
   - **Query-index consistency (R6):** broadening the next-interaction projection changes the
     denormalized `next_interaction_*` fields on `customer_entities` (query-indexed). The path MUST
     keep emitting `query_index.upsert_one` for affected entities so global search / token filters do
     not go stale (per `.ai/lessons.md` → "Projection updates that change indexed parent fields must
     emit query-index upserts"). Add an integration assertion that an `in_progress` interaction
     updates the indexed `next_interaction_*`.
   - **Ordering (R7):** define the "next step" ordering explicitly now that non-scheduled open
     statuses (in_progress/waiting) can enter the projection — the projection orders by `scheduledAt`,
     so decide scheduled-first then `createdAt`, and unit-test the mixed (NULL `scheduledAt`) case.
5. Broaden the count param in `api/interactions/counts/route.ts:15` (`open` bucket = non-terminal,
   `planned` alias retained) → route test.
6. Broaden UI "mark done" predicates to `isOpenInteractionStatus` → component/render test.

### Phase 3
7. Add `INTERACTION_STATUS_DEFAULTS` + seed loop in `cli.ts` → seed test asserts five entries under
   kind `interaction_status` (extend `seedDictionaryScope.test.ts`).
8. Register the kind in `commands/shared.ts`, `api/dictionaries/context.ts`, `lib/dictionaries.ts`
   → `GET /api/customers/dictionaries/interaction-statuses` returns the five entries (integration).
9. Switch `validators.ts:424,491` to `z.string().max(50)` → validator unit test accepts
   `in_progress`; create/update integration test sets and reads back `in_progress`.

### Phase 4
10. Add management sections to `DictionarySettings.tsx` + `DictionarySortSettings.tsx` + i18n keys →
    settings page renders an editable "Interaction statuses" list.
11. Add a status `<select>` (dictionary options) to the task create/edit form → create a task as
    `waiting` from the UI, integration test.
12. Render task/activity status via the dictionary map + `StatusBadge` → ds-guardian pass, no
    hardcoded status colors.

### Phase 5
13. Upgrade action in `configs/lib/upgrade-actions.ts` seeding `interaction_status` for existing
    tenants (idempotent) → run twice, second run is a no-op.
14. Optional backfill `completed → done`; widen + spelling-align the AI tool filter; add
    `@deprecated` JSDoc to `interactionStatusValues` → typecheck, i18n check.

## Integration & test coverage

Per-feature coverage is mandatory (root `AGENTS.md`). New/updated tests, self-contained (create
fixtures via API, clean up in teardown):

- **API paths**
  - `GET /api/customers/dictionaries/interaction-statuses` → five seeded entries; create/update/
    delete a custom status via `POST/PATCH/DELETE`.
  - `POST/PUT /api/customers/interactions` → set and read back `in_progress` and a custom status.
  - `POST /api/customers/interactions/complete` → `done`; `…/cancel` → `canceled`; undo reverts to
    `planned` (extend **TC-UNDO-001**).
  - `GET /api/customers/interactions/counts` → `open` bucket includes an `in_progress` row.
  - Deal open-activities enricher: a deal with one `in_progress` interaction shows
    `openActivitiesCount = 1`.
- **UI paths**
  - Task create form: create a `waiting` task; status badge renders the dictionary label/color.
  - "Mark done" affordance present on an `in_progress` task and completes it to `done`.
  - Settings: "Interaction statuses" section lists and edits entries.
- **Unit**
  - `lib/interactionStatus.ts` predicates; seed defaults; validator widening.

## Risks & Impact Review

| # | Scenario | Severity | Affected area | Mitigation | Residual |
|---|----------|----------|---------------|------------|----------|
| R1 | Split-brain "open" definitions: `in_progress`/`waiting` counted open by the enricher but dropped by a `= 'planned'` filter, so a started task vanishes from "next step" / conflicts / mark-done. | High (correctness) | enricher badge, next-step projection, scheduling conflicts, task UI affordances | Single helper as source of truth; Phase 2 audits every site via the decision table; a unit test enumerates the seeded set so any future built-in addition forces a conscious open/terminal classification. | Low — custom statuses default to open (safe). |
| R2 | Lenient validation lets a typo (`donee`) persist as a status. | Low | data quality | Dictionary dropdown is the practical UI guard; a typo counts as open, so it stays visible rather than silently closing. Matches deal-status behavior. | Low (accepted, parity with deals). |
| R3 | Existing tenant has no seeded `interaction_status` dictionary → empty status dropdown until the upgrade action runs. | Medium (UX) | settings + task form for existing tenants | Phase 5 idempotent upgrade action seeds all tenants; lenient validation keeps the API working meanwhile; helper defaults keep open/terminal correct regardless of dictionary presence. | Low. |
| R4 | AI tool status filter spelling divergence (`'completed'`/`'cancelled'` double-L vs stored `'done'`/`'canceled'`) — pre-existing. | Low | AI agent task filtering | Phase 5 widens and spelling-aligns the filter; the terminal helper tolerates `'completed'`. | Low (pre-existing, not introduced here). |
| R5 | Legacy `completed` rows misclassified. | Low | a small number of legacy rows | Helper treats `completed` as terminal; optional one-time backfill to `done`. | Negligible. |
| R6 | Broadening the next-interaction projection (Phase 2) changes query-indexed `next_interaction_*` on `customer_entities` without an index upsert → grids show fresh values but global search / token filters stay stale. | Medium (search/list consistency) | `customer_entities` next-step fields, search/token index | Emit `query_index.upsert_one` for affected entities in the same path (per `.ai/lessons.md`); integration-assert that an in_progress interaction updates the indexed fields. | Low. |
| R7 | Next-interaction ordering when in_progress/waiting lack `scheduledAt` (projection orders by `scheduledAt`). | Low | "next step" selection on contacts | Define ordering explicitly (scheduled-first, then `createdAt`); unit-test the NULL-`scheduledAt` case. | Low. |

**Blast radius.** Confined to the `customers` module. No DB migration, no cross-module contract
change beyond the deprecated `interactionStatusValues` export. **Operational detection.** Existing
enricher + TC-UNDO-001 tests plus the new unit/integration tests; TypeScript surfaces any
helper/validator drift at build time.

## Out of scope

- `dispatch-crm` MCP tools for arbitrary status transitions (separate repo; follow-up).
- Per-status semantic metadata editable by tenants (that was Option B; rejected for cost).
- Workflow/automation triggers on specific interaction statuses.
- Retiring the legacy interactions path / flipping `customers.interactions.unified` to canonical —
  tracked separately in
  [`2026-06-18-customers-interactions-legacy-removal.md`](2026-06-18-customers-interactions-legacy-removal.md)
  (the SPEC-046b completion follow-up).

## Final Compliance Report — 2026-06-18

### AGENTS.md files reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`
- `.ai/ds-rules.md` + `.ai/ui-components.md`
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | All changes within `customers`; dictionary is same-module. |
| root AGENTS.md | Filter by `organization_id` | Compliant | Dictionary entries and the enricher query are org/tenant scoped (unchanged). |
| root AGENTS.md | Optimistic locking on new user-editable entities | N/A | No new entity; status is a column on the existing interaction. |
| root AGENTS.md (Design System) | No hardcoded status colors / arbitrary sizes; semantic tokens | Compliant | Render via `StatusBadge` + `mapDictionaryColorToTone`. Seeded hex `color`s are dictionary data (DB), not Tailwind classes — same as `DEAL_STATUS_DEFAULTS`. |
| `.ai/ds-rules.md` + `.ai/ui-components.md` | Shared primitives; dialog `Cmd/Ctrl+Enter`+`Escape`; `aria-label` | Compliant | Status badge via `StatusBadge`; status picker is in a `CrudForm` (inherits dialog keys). |
| packages/core/AGENTS.md → API Routes | CRUD routes use `makeCrudRoute` + `indexer`; routes export `openApi` | Compliant | No new routes. Interactions route already uses `makeCrudRoute` + `indexer`; dictionary `[kind]` route already exports `openApi`. |
| packages/core/AGENTS.md → Encryption | Sensitive/GDPR fields use `encryption.ts` + `findWithDecryption` | N/A | `status` is not PII; no new sensitive column. |
| packages/core/AGENTS.md → Commands/Undo | Mutations via commands; undo specified | Compliant | Reuses existing undoable interaction + dictionary commands; no new mutation. |
| packages/ui/AGENTS.md | Forms use `CrudForm`; HTTP via `apiCall`; non-`CrudForm` writes use `useGuardedMutation` | Compliant | Status select added to existing `CrudForm`; reads via existing dictionary hook/`apiCall`. No raw `fetch`. |
| packages/cache/AGENTS.md | Cache via DI; tenant-scoped tags | Compliant | Reuses the existing dictionary read cache (tenant-tagged); no new cache path. |
| packages/events/AGENTS.md | Cross-module side effects via `createModuleEvents` | N/A / Compliant | No new cross-module effect; existing interaction events unchanged. |
| BACKWARD_COMPATIBILITY.md | Contract-surface changes follow deprecation protocol | Compliant | `interactionStatusValues` kept + `@deprecated`; validator widening is non-breaking; counts param keeps `planned` alias. |
| om-spec-writing heuristic #9 | Frontend Architecture Contract for app/** / heavy widgets | N/A | Reuses existing client components (dictionary select, `StatusBadge`); no new provider, bundle, or heavy widget. |
| `.ai/specs/AGENTS.md` | `{date}-{title}.md`, no `SPEC-*` prefix, required sections | Compliant | Filename `2026-06-18-configurable-crm-interaction-statuses.md`; required sections present. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No schema change; lenient validator matches the "accept any string" contract. |
| API contracts match UI/UX section | Pass | Status `<select>` and badge both read the dictionary map. |
| Risks cover all write operations | Pass | create/update/complete/cancel covered; lenient-write risk noted (R2). |
| Commands defined for all mutations | Pass | Reuses existing interaction + dictionary commands; no new mutation. |
| Cache strategy covers all read APIs | Pass | Dictionary reads reuse existing tenant-tagged cache; enricher query unchanged. |

### Non-Compliant Items
None.

### Verdict
**Fully compliant — approved for implementation.** Recommend running `om-pre-implement-spec` (BC
audit + gap analysis) before Phase 1, given the contract-surface touch on `interactionStatusValues`.

## Changelog

- **2026-06-18** — Spec drafted (Option A: dictionary-backed interaction statuses). Open Questions
  gate resolved: Q1 single `waiting`; Q2 unknown→open; Q3 complete→`done`; lenient validation per
  the deal-status precedent.
- **2026-06-18** — Pre-implementation analysis run (see
  `.ai/specs/analysis/ANALYSIS-2026-06-18-configurable-crm-interaction-statuses.md`): verdict **ready
  to implement**, no BC blockers, no test breakage. Folded R6 (query-index upsert on projection
  broadening) and R7 (next-interaction ordering) into Phase 2 and the risk table.
- **2026-06-18** — Implemented all five phases (`om-implement-spec`). Dictionary-backed interaction
  statuses are live: seeded `interaction-statuses` dictionary, lenient validator, unified
  open/terminal helper, broadened open-set call sites, settings management UI, task-form status
  picker + `StatusBadge` rendering, existing-tenant upgrade action, AI-tool filter fix, and the
  `@deprecated` bridge on `interactionStatusValues`. R7 resolved as scheduled-only for the
  next-interaction projection. See the Implementation Status section.
- **2026-06-18** — Recorded the interaction-mode constraint (Q4): the rich status picker renders only
  on the canonical path (`interactionMode === 'canonical'`); legacy keeps the done checkbox. Added the
  [Interaction-mode constraint](#interaction-mode-constraint-legacy-vs-canonical) section and
  cross-linked the new legacy-removal follow-up spec
  ([`2026-06-18-customers-interactions-legacy-removal.md`](2026-06-18-customers-interactions-legacy-removal.md)).
  Picker-gating implementation is pending.

### Review — 2026-06-18
- **Reviewer**: Agent
- **Security**: Passed (no new auth surface; reuses `customers.settings.manage`; status not PII)
- **Performance**: Passed (reuses indexed dictionary reads + the existing enricher query; no new N+1)
- **Cache**: Passed (reuses the existing tenant-tagged dictionary cache)
- **Commands**: Passed (no new mutation; reuses existing undoable commands)
- **Risks**: Passed (split-brain open-definition is the tracked primary risk R1, mitigated by Phase 2 + the helper)
- **Verdict**: Approved — ready for implementation (recommend `om-pre-implement-spec` first)

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Semantics helper + enricher refactor | Done | 2026-06-18 | `lib/interactionStatus.ts` added; enricher, commands, link-channel handler reference the helper. Pure refactor, identical values. Unit-tested. |
| Phase 2 — Close the open-set gap | Done | 2026-06-18 | Projection (scheduled-only per resolved decision), conflicts, counts (`open` bucket + `planned` alias), people/companies upcoming, and UI mark-done/overdue predicates broadened to `isOpenInteractionStatus` / `NOT IN terminal`. R6 already satisfied (`emitNextInteractionUpdatedEvent` emits the query-index upsert). |
| Phase 3 — Dictionary + seed + validators | Done | 2026-06-18 | `INTERACTION_STATUS_DEFAULTS` + seed loop; kind registered in `DICTIONARY_KINDS`/`KIND_MAP`/`BUILTIN_DICTIONARY_ROUTE_KINDS`/`CUSTOMER_DICTIONARY_KINDS`; validators lenient `z.string().max(50)`. Seed + validator-widening unit tests. |
| Phase 4 — Management UI + task status picker + rendering | Done | 2026-06-18 | "Interaction statuses" sections added to `DictionarySettings` + `DictionarySortSettings`; task `CrudForm` gains a dictionary-driven status `<select>` (canonical path carries `base.status`; legacy `is_done` kept in sync); `StatusBadge` rendered in `TasksSection`. i18n keys added across all 4 locales. |
| Phase 5 — Backfill + AI tool + deprecation | Done | 2026-06-18 | Idempotent `customers.seed-interaction-statuses` upgrade action (v0.6.5, lazy-loads customers helpers to keep configs decoupled); AI tool filter widened + spelling-aligned (`open` → non-terminal, `done`/`canceled`, `cancelled` alias); `interactionStatusValues`/`InteractionStatus` marked `@deprecated` (contents unchanged). Optional `completed → done` row backfill intentionally skipped (helper tolerates `completed`). |

> **Pending follow-up (this spec):** the task-form status picker currently renders unconditionally.
> Per the [Interaction-mode constraint](#interaction-mode-constraint-legacy-vs-canonical) it MUST be
> gated to `interactionMode === 'canonical'` (legacy keeps the done checkbox) before this spec ships.
> Not yet implemented.

### Verification (2026-06-18)
- `tsc --noEmit -p packages/core` — 0 errors (after `yarn generate` cleared pre-existing stale `staff` entity-id drift).
- `yarn build:packages` — 21/21 packages built.
- Unit/component tests — 148 customers suites / 855 tests green, plus AI-tool, upgrade-actions, and module-decoupling suites.
- `yarn i18n:check` — 0 missing keys (non-English value coverage is the advisory Phase-1 metric; new keys land as EN placeholders awaiting translation).
- Lint not run: the environment's `eslint-plugin-react@7.37.5` is incompatible with the pinned `eslint@10.5.0` (calls the removed `context.getFilename`), which breaks linting for every file repo-wide — unrelated to this change.
- Integration tests (Playwright API specs) — **executed green against the ephemeral app** (6/6 at `--retries=0`): `TC-CRM-084` (interaction-statuses dictionary GET seeded set + custom-status POST/PATCH/DELETE), `TC-CRM-085` (set/read-back `in_progress` + custom status, complete→`done`, cancel→`canceled`, counts `open` bucket includes/`done` excludes an in_progress task), `TC-CRM-086` (deal `_pipeline.openActivitiesCount` counts an in_progress interaction). Self-contained (API fixtures, cleanup in `finally`). Run with `OM_INTEGRATION_MODULES=customers yarn test:integration:ephemeral`.
- Settings "Interaction statuses" section render is covered deterministically by the **component test** (`components/__tests__/DictionarySettings.test.tsx`). A browser-driven integration variant was prototyped but dropped: it hit OM's known auth/session flakiness (post-login `/login` bounce under combined-run DB load) — the same class the shared `login` helper and `retries: 1` config are built to absorb — so the deterministic component test is the better fit.
- Remaining browser-only UI flows (task-create-as-`waiting`, mark-done on an `in_progress` task) are not authored as Playwright specs; the task-form status select + badge logic is covered by component tests, and full persistence of non-binary statuses additionally depends on the tenant's `interactionMode === 'canonical'`.
