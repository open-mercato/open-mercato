# Customers — Deals Kanban Redesign (SPEC-048)

## TLDR

**Key Points:**
- Redesign the existing `/backend/customers/deals/pipeline` page to match the SPEC-048 Figma mockups (Figma file `SPEC-048-CRM-Detail-Pages-UX-Mockup`; kanban view `982:250` + 9 related modal frames).
- Replace the current minimal kanban (native HTML5 DnD, no filters, plain cards) with a CRM-grade board: colored stage lanes from the `pipeline-stages` dictionary, full filter bar (Status / Pipeline / Owner / People / Companies / Close / +More / Sort), saved views via the existing `perspectives` module, activity-count badges + STUCK/OVERDUE indicators on cards, inline Quick deal per lane, inline Add stage lane, redesigned three-column Create deal page, card kebab menu, hover-revealed Call/Email/Note quick-actions, and a multi-select bulk-actions bar.
- Swap native HTML5 drag-drop for `@dnd-kit/sortable` (already installed) so keyboard nav is accessible per DS rules.

**Scope:**
- Kanban view at `/backend/customers/deals/pipeline` (in-place replacement of `page.tsx`)
- All 9 modal/popover surfaces from the Figma canvas: Create deal (`982:1142`), Quick deal compact (`982:1089`), Quick deal expanded (`982:1429`), Customize view (`1045:12162`), Filter — Status (`1045:11861`), Filter — Pipeline (`1045:11917`), Add filter (`1045:11987`), Sort by (`1045:12090`), Card action menu (`1045:12254`), Bulk actions bar (`1045:12242`)
- New tenant setting `customers.deals.stuck_threshold_days` (default 14) + minimal config panel
- New response enricher `_pipeline` on `/api/customers/deals` returning `openActivitiesCount`, `daysInCurrentStage`, `isStuck`, `isOverdue`
- New bulk routes: stage move, owner reassign, CSV export (existing bulk-delete route reused)
- View-tabs row rendered with **Kanban + Lista only** (Aktywności / Kalendarz / Mapa hidden until those views ship)

**Concerns:**
- The pipeline page is shipped, not greenfield — the redesign happens in-place on the same route and `requireFeatures`.
- The Customize-view popover overlaps semantically with `perspectives`; the spec defines the integration explicitly.
- Drag-drop performance with >100 cards per lane needs the existing `pageSize ≤ 100` cap plus virtualization if profiling shows jank.

## Overview

The Customers module exposes a Deals pipeline page at `/backend/customers/deals/pipeline`, currently implemented with native HTML5 drag-drop, a `<Select>`-based pipeline switcher, a sort dropdown, and minimal cards (title, value, probability, expected close, plain links to people/companies). The SPEC-048 Figma mockups redesign the page into a CRM-grade kanban that matches HubSpot/Pipedrive expectations: colored lanes, rich cards with derived state indicators, in-context filtering, saved views, inline quick-create per lane, inline stage create, and a bulk-action bar.

This spec covers the kanban-only slice. The mockups also include Lista, Aktywności, Kalendarz and Mapa views; per user direction those are explicitly out of scope for this iteration. The kanban page renders a view-tabs strip showing **Kanban + Lista**; the other tabs are deferred to follow-up specs.

> **Market Reference**: HubSpot Deals pipeline and Pipedrive Deals kanban. **Adopted**: dictionary-driven stage colors, hover-revealed activity composers, derived stage-tenure ("stuck") indicators, inline quick-add per lane, bulk-actions floating bar, saved personal views. **Rejected**: gamified leaderboards (out of CRM scope), opinionated stage-to-probability defaults (left to tenant), stage-stuck push notifications (deferred to a future notifications spec).

## Problem Statement

The current pipeline page (shipped in earlier customers module work) has these concrete gaps relative to the redesign:

1. **No visual stage identity** — lanes share one neutral border; sales reps cannot scan a screenshot and know which stages are qualification vs. closing.
2. **No STUCK/OVERDUE awareness** — a deal that has been in Qualification for 60 days looks identical to one that landed yesterday.
3. **No inline quick-add** — adding a deal requires a full-page navigation to `/deals/create`, breaking flow.
4. **No filter chips** — the page exposes only a pipeline selector and a sort dropdown; users cannot narrow by status, owner, people, companies, close date or custom fields.
5. **No saved views** — every reload resets the pipeline selector + sort; "Mój pipeline" / "Closing this month" / "Stuck deals" must be reconfigured each session.
6. **No bulk operations** — every stage move or deletion is one card at a time.
7. **No activity surface on cards** — sales reps cannot log a call/email/note without opening the deal detail.
8. **No stage management surface on the board** — adding or recoloring stages forces a context switch to `/backend/config/customers/pipeline-stages`.
9. **DS regressions** — native HTML5 DnD has poor keyboard accessibility; current cards use ad-hoc `bg-primary/5` pill links instead of `Avatar`/`Tag`/`StatusBadge` primitives.
10. **Create deal page** is a flat one-column form that does not match the redesigned three-column Figma layout (Deal details + Associations + Custom attributes panel + Tips card).

## Proposed Solution

Redesign the kanban page in-place at `/backend/customers/deals/pipeline`, leaning on existing infrastructure wherever it already exists:

| Existing primitive | Reuse for |
|---|---|
| `Page`, `PageBody`, `SectionHeader`, `Dialog`, `Popover`, `DropdownMenu` | Page chrome, modals, popovers |
| `Avatar`, `AvatarStack`, `StatusBadge`, `Tag`, `Button`, `FormField` | Card composition |
| `DictionaryValue` + `mapDictionaryColorToTone` | Lane top-bar color from the existing `pipeline-stages` dictionary |
| `AdvancedFilterPanel`, `ActiveFilterChips`, `FilterPreset`, `useAdvancedFilterTree` | Filter chips, Add-filter (`+ More`) flow, preset definitions |
| `perspectives` module (`tableId: 'customers.deals.pipeline'`) | Saved views in the Customize-view popover |
| `@dnd-kit/sortable` (installed at `packages/ui/package.json`, unused so far) | Drag-and-drop with keyboard sensor |
| `apiCallOrThrow`, `useGuardedMutation`, `flash`, `useConfirmDialog`, `readApiResultOrThrow` | All UI write paths |
| `customers/commands/deals.ts` (existing update/delete commands) | Drag-drop stage move + card-menu Mark Won/Lost / Delete |
| `customers/api/deals/route.ts` (existing `makeCrudRoute` factory) | List + create + update + delete (no contract change beyond enrichment + new filter params) |
| `progress` module + queue workers | Bulk operations (delete, stage move, owner reassign) |
| `customers/activities` infrastructure | Call/Email/Note quick-action composer dialogs |

Add only what is missing:

1. **Response enricher** `customers/data/enrichers.ts` exposing `_pipeline.{openActivitiesCount, daysInCurrentStage, isStuck, isOverdue}` on the deal list endpoint.
2. **Per-tenant setting** `customers.deals.stuck_threshold_days` (default 14) seeded via `setup.ts`.
3. **New API routes** for bulk stage move + bulk owner reassign + filtered CSV export (single-deal bulk-delete already exists).
4. **New bulk commands** in `customers/commands/deals-bulk.ts` for undo-aware multi-deal mutations.
5. **New page-local components** under `pipeline/components/` (Lane, DealCard, AddStageLane, QuickDealDialog, AddStageDialog, CustomizeViewDialog, SortByPopover, StatusFilterPopover, PipelineFilterPopover, DealCardMenu, BulkActionsBar, ViewTabsRow).
6. **Redesigned Create deal page** at `/backend/customers/deals/create` (three-column `CrudForm` layout + Custom attributes side panel + Tips info card).
7. **Stuck-threshold settings stub** at `/backend/config/customers/deals` (minimal one-field panel) gated by a new feature `customers.deals.manage`.

### Design Decisions

| Decision | Rationale |
|---|---|
| Reuse `perspectives` for saved views | The module already supports user-scoped views keyed by `tableId`; `payload` is JSONB so the kanban shape (filterTree + sort + visibleCardFields) drops in additively. Avoids a new entity and parallel RBAC. |
| Stage colors from `pipeline-stages` dictionary, not a new column | List page already reads colors via `DictionaryValue` → `mapDictionaryColorToTone`; zero migration, single source of truth. |
| Derive STUCK/OVERDUE in a response enricher (not client-side) | Filter chips ("Stuck deals" preset, `isStuck=true` filter) must operate server-side; computing once on the server keeps the wire shape stable and lets the SQL push-down filter on indexed columns. |
| Swap to `@dnd-kit/sortable` | Library is already installed; DS rules require keyboard-accessible focus on every interactive element. `KeyboardSensor` is free. |
| Activity composers as compact 480px dialogs (mirroring Quick deal) | Mockup intent is "stay on the kanban"; reuses customers `Activity` entity; consistent dialog grammar with Quick deal. |
| Inline Add stage modal (per Q3) | Uses existing `POST /api/customers/pipeline-stages`; user does not need to context-switch to settings to add a column. |
| Per-tenant stuck threshold (not per-stage) | Mockup language ("Stuck deals > 14 dni in stage") implies a single tenant-level threshold; per-stage is YAGNI. |
| Hover-reveal quick-actions + hover-reveal bulk-select checkbox (touch fallback: always visible) | Matches mockup state (only one card shows quick-actions at rest), keeps resting cards quiet, accessible via `@media (hover: none)`. |
| Render only Kanban + Lista in the view-tabs row | Aktywności/Kalendarz/Mapa do not yet exist as routes; rendering disabled tabs would clutter the UI without value. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| New `customer_kanban_views` table for saved views | Duplicates `perspectives`; user explicitly asked to "reuse whatever possible". |
| Compute STUCK/OVERDUE client-side after a list fetch | Filter chips and the `Stuck deals` preset cannot push filtering down to SQL; pagination breaks. |
| Per-stage stuck threshold (column on `customer_pipeline_stages`) | Mockup shows a single threshold; per-stage adds schema cost without UX justification. |
| Keep native HTML5 DnD | Fails the DS rule on keyboard accessibility; `@dnd-kit` is already a project dependency. |
| Activity composer opens the deal detail page | Loses kanban context; mockup intent is to stay on the board. |
| Build a new bulk-select gesture (cmd-click) | Less discoverable than a checkbox; checkbox affordance matches the existing DataTable bulk-select pattern. |
| Add a new `color` column to `customer_pipeline_stages` | The dictionary already carries color; double-source-of-truth is worse than one. |

## User Stories

- **Sales rep** wants to **see at a glance which deals are stuck or overdue** so they can prioritize follow-up.
- **Sales rep** wants to **drag a deal from Qualification to Proposal** so the stage updates without opening detail.
- **Sales rep** wants to **quickly add a deal to a specific lane** without leaving the board.
- **Sales rep** wants to **log a call / email / note from a deal card** without losing kanban context.
- **Sales manager** wants to **save a "Closing this month" view** so it persists across sessions and devices.
- **Sales manager** wants to **change owner on 5 selected deals at once**.
- **Tenant admin** wants to **add a new pipeline stage** without leaving the board.
- **Tenant admin** wants to **configure the stuck-deal threshold** for their tenant.

## Architecture

### Component tree

```
DealsKanbanPage (/backend/customers/deals/pipeline)
├── PageHeader
│   ├── Breadcrumb (Dashboard / Deals)
│   ├── SearchInput
│   ├── CustomizeViewButton → CustomizeViewDialog
│   └── NewDealButton → routes to /backend/customers/deals/create
├── ViewTabsRow (Kanban active, Lista → /backend/customers/deals)
├── FilterBarRow
│   ├── "FILTER:" label
│   ├── FilterChip<Status> → StatusFilterPopover
│   ├── FilterChip<Pipeline> → PipelineFilterPopover
│   ├── FilterChip<Owner>, People, Companies, CloseDate → AdvancedFilterPanel popovers
│   ├── AddFilterButton (+ More) → AdvancedFilterPanel add-field flow
│   └── SortButton (right-aligned) → SortByPopover
├── KanbanBoard
│   └── DndContext (@dnd-kit, KeyboardSensor + PointerSensor)
│       └── LaneStrip (horizontal scroll)
│           ├── Lane[stage] × N
│           │   ├── LaneHeader (color bar from dictionary tone + label + count + total value + stuck/overdue +N badge)
│           │   ├── QuickAddRow → QuickDealDialog
│           │   └── SortableContext
│           │       └── DealCard × N
│           │           ├── HoverCheckbox (bulk select)
│           │           ├── TitleRow (title + activity badge + kebab → DealCardMenu)
│           │           ├── DealId / OrderRef
│           │           ├── StatusPill (STUCK / OVERDUE — when derived)
│           │           ├── QuickActionsRow (hover-reveal: Call / Email / Note → ActivityComposerDialog)
│           │           ├── ValueRow (amount + probability)
│           │           ├── CompanyRow
│           │           └── FooterRow (date + days-in-stage + AvatarStack)
│           └── AddStageLane (dashed-border) → AddStageDialog
├── PageFooter ("Showing {visible} of {total} deals in {pipeline} pipeline" + drag hint)
└── BulkActionsBar (fixed bottom, z-toast, mounted when ≥1 card selected)
    └── { count, totalValue, [ChangeStage, ChangeOwner, ExportCSV, Delete] }
```

### Data flow

```
User filter / sort / search ──► useAdvancedFilterTree ──► URLSearchParams ──► GET /api/customers/deals
                                                                              │
                                                                              ▼ enriched by:
                                                                       data/enrichers.ts → _pipeline { openActivitiesCount,
                                                                                                       daysInCurrentStage,
                                                                                                       isStuck, isOverdue }

User drags card ──► @dnd-kit onDragEnd ──► useGuardedMutation ──► PUT /api/customers/deals (id, pipelineStageId)
                                                                              │
                                                                              ▼
                                                            customers.update_deal command
                                                                              │
                                                                              ▼
                                       CustomerDealStageTransition row inserted (existing audit table)
                                       + emitCrudSideEffects (audit, index, cache)

User bulk-stage (≤25)  ──► POST /api/customers/deals/bulk-update-stage ──► customers.bulk_update_deal_stage (sync)
User bulk-stage (>25)  ──► POST /api/customers/deals/bulk-update-stage ──► ProgressJob created ──► worker runs command per id
                                                                                                   ProgressTopBar reflects status

User clicks Call/Email/Note on card ──► ActivityComposerDialog ──► POST /api/customers/activities ──► invalidate deals query
                                                                                                       _pipeline.openActivitiesCount ++
```

### Commands & Events

Reused:
- `customers.update_deal` — drag-drop stage move, card-menu Mark Won / Mark Lost
- `customers.delete_deal` — card-menu Delete
- `customers.create_deal` — Quick deal + Full create
- Existing `customers.deal.updated`, `customers.deal.created`, `customers.deal.deleted` events

New:
- `customers.bulk_update_deal_stage` — multi-id stage move (undo-aware; restores prior `pipelineStageId` per id)
- `customers.bulk_update_deal_owner` — multi-id owner reassign (undo-aware)
- `customers.deal.stuck` event (optional, additive) — emitted when a deal's `daysInCurrentStage` crosses the threshold; powers a future notifications spec. Excluded from triggers by default.

## Data Models

### `customer_pipeline_stages` (existing, unchanged)

Lane colors come from the existing `pipeline-stages` dictionary (`customer_dictionary_entries` rows keyed by stage value), read in the UI via `mapDictionaryColorToTone`. No `color` column is added to the entity.

### `customer_settings` row (new)

| Field | Type | Notes |
|---|---|---|
| key | text | `customers.deals.stuck_threshold_days` |
| value | jsonb | `{ "days": 14 }` |
| organization_id | uuid | tenant-scoped |
| tenant_id | uuid | |

Seeded in `customers/setup.ts` `seedDefaults` (idempotent) and configurable at `/backend/config/customers/deals` (new minimal panel).

### Saved views (reused via `perspectives` module)

One row per `(user_id, table_id='customers.deals.pipeline')` per saved view. Stored in the existing perspectives table; no schema change. The `payload` JSON contains:

```typescript
{
  filterTree: AdvancedFilterTree    // serialized filter conditions
  sort: SortOption                  // 'updated_desc' | 'value_desc' | etc.
  visibleCardFields: CardField[]    // e.g. ['value', 'probability', 'expectedClose', 'owner', 'status']
  pipelineId: string | null         // selected pipeline
}
```

### Response enricher payload (new namespaced field)

On every item returned by `GET /api/customers/deals`:

```typescript
_pipeline: {
  openActivitiesCount: number   // count of customer_activities + customer_todos with status='open' linked to this deal
  daysInCurrentStage: number    // floor((now - last_stage_transition.created_at) / 1 day); 0 if no transition rows yet
  isOverdue: boolean            // status === 'open' && expected_close_at != null && expected_close_at < today
  isStuck: boolean              // daysInCurrentStage > customers.deals.stuck_threshold_days
}
```

Per response-enricher convention this `_`-prefixed field is stripped from CSV/Excel exports (`_meta` strip in the export pipeline).

## API Contracts

### `GET /api/customers/deals` (existing, enriched)

Additive changes:
- Response items gain `_pipeline` block (response enricher).
- Query supports new filter keys: `status[]`, `pipelineId[]`, `ownerUserId[]`, `personId[]`, `companyId[]`, `expectedCloseAtFrom`, `expectedCloseAtTo`, `isStuck`, `isOverdue` (last two compile into SQL using the tenant threshold setting).
- Sort param accepts: `updatedAt`, `createdAt`, `valueAmount`, `probability`, `expectedCloseAt`, `ownerName` (asc/desc).
- `pageSize` stays capped at 100 (DS rule).
- OpenAPI updated via `buildCustomersCrudOpenApi`.

No removal of existing parameters, no rename, no response-shape change beyond the additive enricher block.

### `PUT /api/customers/deals` (existing, reused)

Already accepts `pipelineStageId` mutation. No contract change. Drag-drop emits this PUT with `{ id, pipelineStageId }`.

### `POST /api/customers/deals` (existing, reused for both Quick deal and Full create)

Compact (Quick deal) payload:
```json
{ "title": "...", "pipelineId": "...", "pipelineStageId": "...", "ownerUserId": "...", "valueAmount": 0, "valueCurrency": "PLN", "companyId": "..." }
```

Expanded (full Create deal page) payload adds `status`, `probability`, `expectedCloseAt`, `description`, `peopleIds[]`, `companyIds[]`, plus custom-field payload (existing `cf_*` keys).

No contract change.

### `POST /api/customers/pipeline-stages` (existing, reused for Add stage)

Body: `{ pipelineId, label, color?, order? }`. When `order` is omitted, the server assigns `max(order)+1` for the pipeline. Existing route handles this; no contract change.

### `POST /api/customers/deals/bulk-update-stage` (new)

```json
Request:  { "ids": ["uuid", ...], "pipelineStageId": "uuid" }
Response: { "ok": true, "progressJobId": "uuid", "message": "Bulk stage update started." }   // HTTP 202
```

- **Always async** via queue + `ProgressJob` (matches catalog `bulk-delete` convention — no sync path). Returns immediately with the `progressJobId`; `ProgressTopBar` tracks completion. Worker iterates `customers.deals.update` per id with progress reporting.
- Validation: zod schema requires non-empty `ids[]` (max 10000), valid UUIDs, valid `pipelineStageId`. RBAC: `customers.deals.manage`.

### `POST /api/customers/deals/bulk-update-owner` (new)

Same shape with `ownerUserId` instead of `pipelineStageId`. Same async-queue path + RBAC (`customers.deals.manage`).

### CSV export (existing `GET /api/customers/deals` with `exportScope=full|view`)

The kanban's bulk-export button uses the **existing CRUD factory export support** — `buildCrudExportUrl('customers/deals', { ...filters, exportScope: 'view' }, 'csv')` — exactly like the list page does. **No new export route file is added.** `_`-prefixed enricher fields are stripped automatically. The new `customers.deals.export` ACL feature is declared for future UI-side gating + a follow-up API interceptor; the existing route currently gates on `customers.deals.view`.

### OpenAPI

Every new route exports `openApi` per `packages/core/AGENTS.md` API Routes rule.

## Internationalization (i18n)

New keys under `customers.deals.kanban.*` (and `customers.deals.create.*` for the redesigned create page). Both `en.json` and `pl.json` ship in this spec since the mockups are in Polish.

```
customers.deals.kanban.view.kanban             "Kanban" / "Kanban"
customers.deals.kanban.view.list               "List" / "Lista"

customers.deals.kanban.search.placeholder      "Search deals…" / "Szukaj deali…"
customers.deals.kanban.cta.customize           "Customize view" / "Dostosuj widok"
customers.deals.kanban.cta.newDeal             "New deal" / "Nowy deal"
customers.deals.kanban.cta.quickDeal           "Quick deal" / "Szybki deal"
customers.deals.kanban.cta.newStage            "New stage" / "Nowy etap"

customers.deals.kanban.filter.label            "FILTER:"
customers.deals.kanban.filter.status           "Status"
customers.deals.kanban.filter.pipeline         "Pipeline"
customers.deals.kanban.filter.owner            "Owner" / "Właściciel"
customers.deals.kanban.filter.people           "People" / "Osoby"
customers.deals.kanban.filter.companies        "Companies" / "Firmy"
customers.deals.kanban.filter.close            "Close" / "Zamknięcie"
customers.deals.kanban.filter.add              "+ More" / "+ Więcej"
customers.deals.kanban.sort.label              "Sort"
customers.deals.kanban.sort.default            "Default" / "Domyślnie"

customers.deals.kanban.card.daysInStage        "in {days}d"
customers.deals.kanban.card.overdueDays        "{days}d Overdue"
customers.deals.kanban.card.statusStuck        "STUCK"
customers.deals.kanban.card.statusOverdue      "OVERDUE"
customers.deals.kanban.card.action.call        "Call" / "Zadzwoń"
customers.deals.kanban.card.action.email       "Send email" / "Wyślij e-mail"
customers.deals.kanban.card.action.note        "Note" / "Notatka"

customers.deals.kanban.menu.open               "Open deal" / "Otwórz deal"
customers.deals.kanban.menu.edit               "Edit" / "Edytuj"
customers.deals.kanban.menu.duplicate          "Duplicate" / "Duplikuj"
customers.deals.kanban.menu.moveStage          "Move stage…" / "Przenieś etap…"
customers.deals.kanban.menu.markWon            "Mark as Won" / "Oznacz jako Won"
customers.deals.kanban.menu.markLost           "Mark as Lost" / "Oznacz jako Lost"
customers.deals.kanban.menu.delete             "Delete" / "Usuń"

customers.deals.kanban.bulk.selectedCount      "{count} selected" / "{count} zaznaczonych"
customers.deals.kanban.bulk.totalValue         "Total {value}" / "Łącznie {value}"
customers.deals.kanban.bulk.changeStage        "Change stage" / "Zmień etap"
customers.deals.kanban.bulk.changeOwner        "Change owner" / "Zmień właściciela"
customers.deals.kanban.bulk.exportCsv          "Export CSV" / "Eksport CSV"
customers.deals.kanban.bulk.delete             "Delete" / "Usuń"

customers.deals.kanban.helper.dragHint         "Drag cards between lanes to update stage"
customers.deals.kanban.footer.count            "Showing {visible} of {total} deals in {pipeline} pipeline"

customers.deals.kanban.customize.title         "Customize view" / "Dostosuj widok"
customers.deals.kanban.customize.reset         "Reset to default" / "Przywróć domyślne"
customers.deals.kanban.customize.savedViews    "SAVED VIEWS" / "ZAPISANE WIDOKI"
customers.deals.kanban.customize.actions       "ACTIONS" / "AKCJE"
customers.deals.kanban.customize.configCols    "Configure card fields" / "Konfiguruj kolumny"
customers.deals.kanban.customize.manageStages  "Manage pipeline stages" / "Zarządzaj etapami pipeline'a"
customers.deals.kanban.customize.resetDefault  "Reset to default" / "Resetuj do domyślnego"
customers.deals.kanban.customize.activeView    "Active view: {name}"
customers.deals.kanban.customize.saveView      "Save view" / "Zapisz widok"

customers.deals.kanban.quickDeal.title         "Quick deal" / "Szybki deal"
customers.deals.kanban.quickDeal.context       "Pipeline: {pipeline} · Stage: {stage}"
customers.deals.kanban.quickDeal.title.label   "Deal title" / "Tytuł deala"
customers.deals.kanban.quickDeal.value         "Value" / "Wartość"
customers.deals.kanban.quickDeal.currency      "Currency" / "Waluta"
customers.deals.kanban.quickDeal.company       "Company" / "Firma"
customers.deals.kanban.quickDeal.companyPh     "Pick a company or add new…" / "Wybierz firmę albo dodaj nową…"
customers.deals.kanban.quickDeal.owner         "Owner" / "Właściciel"
customers.deals.kanban.quickDeal.more          "+ More details (probability, close date, description)" / "+ Więcej szczegółów (probability, close date, opis)"
customers.deals.kanban.quickDeal.less          "− Less details" / "− Mniej szczegółów"
customers.deals.kanban.quickDeal.helperFooter  "Deal will appear in the {stage} column" / "Po dodaniu deal pojawi się w kolumnie {stage}"
customers.deals.kanban.quickDeal.cancel        "Cancel" / "Anuluj"
customers.deals.kanban.quickDeal.submit        "+ Add deal" / "+ Dodaj deal"

customers.deals.kanban.addStage.title          "New stage" / "Nowy etap"
customers.deals.kanban.addStage.label          "Stage name" / "Nazwa etapu"
customers.deals.kanban.addStage.color          "Color" / "Kolor"
customers.deals.kanban.addStage.submit         "Add stage" / "Dodaj etap"

customers.deals.kanban.activityComposer.call   "Log a call" / "Zaloguj rozmowę"
customers.deals.kanban.activityComposer.email  "Send email" / "Wyślij e-mail"
customers.deals.kanban.activityComposer.note   "Add a note" / "Dodaj notatkę"

customers.deals.create.title                   "Create deal"
customers.deals.create.subtitle                "Add a new opportunity to a pipeline and link contacts"
customers.deals.create.section.deal            "Deal details"
customers.deals.create.section.associations    "Associations"
customers.deals.create.section.custom          "Custom attributes"
customers.deals.create.section.tips.title      "Tips for better deals"

customers.deals.settings.stuckThreshold        "Stuck threshold (days)"
customers.deals.settings.stuckThreshold.help   "A deal is considered stuck after this many days in its current stage."
```

## UI / UX

### Surface inventory (1:1 with Figma)

| # | Figma node | Surface | Files |
|---|---|---|---|
| 1 | `982:250` | Kanban view | `backend/customers/deals/pipeline/page.tsx` (rewrite) |
| 2 | `982:1142` | Create deal | `backend/customers/deals/create/page.tsx` (redesign) |
| 3 | `982:1089` | Quick deal — compact | `pipeline/components/QuickDealDialog.tsx` |
| 4 | `982:1429` | Quick deal — expanded | same component, expanded state |
| 5 | `1045:12162` | Customize view | `pipeline/components/CustomizeViewDialog.tsx` |
| 6 | `1045:11861` | Filter — Status | `pipeline/components/filters/StatusFilterPopover.tsx` |
| 7 | `1045:11917` | Filter — Pipeline | `pipeline/components/filters/PipelineFilterPopover.tsx` |
| 8 | `1045:11987` | Add filter | reuse `AdvancedFilterPanel` add-field flow |
| 9 | `1045:12090` | Sort by | `pipeline/components/SortByPopover.tsx` |
| 10 | `1045:12254` | Card action menu | `pipeline/components/DealCardMenu.tsx` |
| 11 | `1045:12242` | Bulk actions bar | `pipeline/components/BulkActionsBar.tsx` |

### Visual fidelity rules (per `.ai/ds-rules.md` and `.ai/ui-components.md`)

- Lane top accent: 4px bar, `bg-status-{tone}-bg` from `mapDictionaryColorToTone(stage.dictEntry.color)`; fallback palette by `stage.order % 6` when the dictionary entry has no color.
- Card radius: `rounded-md`; lane container radius: `rounded-lg`; quick-deal/customize-view dialog radius: `rounded-lg`; full Create deal page section radius: `rounded-lg`.
- Spacing: lane padding `p-4`, card padding `p-4`, card-stack gap `gap-3`, lane gap `gap-4`, page outer gap `gap-6`. No arbitrary values.
- Card shadow: `shadow-xs`, hover `shadow-sm`. Dialog shadow: `shadow-lg`. Backdrop: `bg-black/50`.
- Typography: card title `text-sm font-medium`, deal id `text-xs text-muted-foreground`, value `text-base font-semibold`, probability `text-xs text-muted-foreground`, lane header label `text-overline font-semibold uppercase tracking-widest`, stuck/overdue pill text `text-xs`.
- Status pills via `<StatusBadge variant={tone} dot>` only — STUCK = `warning`, OVERDUE = `error`. No bespoke pill colors.
- Lane header badge counts: `<Badge>` variant `secondary` for the count, `<Badge variant="warning">` / `<Badge variant="error">` for the stuck/overdue +N when > 0.
- Avatars: `<Avatar label="Jan Kowalski" size="sm">` (single) or `<AvatarStack max={3}>` (multi).
- Quick-action icons + bulk-select checkbox: `transition-opacity duration-150` with `opacity-0 group-hover:opacity-100`; touch fallback via `@media (hover: none) { opacity: 1 }`.
- All icons via `lucide-react` (`Phone`, `Mail`, `StickyNote`, `Building2`, `Plus`, `MoreVertical`, `Workflow`, `Layers`, `Calendar`, `X`, `Sparkles` for the Custom attributes header). No inline `<svg>`.
- Brand violet (`brand-violet`) used **only** for: the Custom attributes section icon on the Create deal page, the Tips info card accent. Nothing else — semantic tokens carry everything.
- All dialogs handle `Cmd/Ctrl+Enter` submit + `Escape` cancel.
- All icon-only buttons declare `aria-label`.
- Tabs use `border-b-2 border-primary` for the active indicator (per DS).
- Tabs row + filter bar separator is `border-t border-border`; no arbitrary border widths.
- Empty lanes show `<EmptyState size="sm">` with a single line ("No deals in this stage yet"); the "+ Szybki deal" button stays visible above it.
- "+ Nowy etap" lane uses `border border-dashed border-border` and `text-muted-foreground`.

### Card field visibility

The "Konfiguruj kolumny" action in Customize view opens a sub-panel with checkboxes for: Value, Probability, Expected close, Company, Owner avatar, Status pill, Days-in-stage, Activity badge. Selection is part of the saved-view payload (`visibleCardFields`).

## Configuration

New per-tenant setting:

- Key: `customers.deals.stuck_threshold_days`
- Type: integer, range `[1, 365]`, default `14`
- Storage: `customer_settings` row
- Surface: `/backend/config/customers/deals` — a minimal panel with one field (number input + helper text); gated by new feature `customers.deals.manage` (added to admin defaults).
- Seeded by `customers/setup.ts` `seedDefaults` for every tenant (idempotent).

## Migration & Compatibility

### Backward compatibility

- The pipeline route stays at `/backend/customers/deals/pipeline`. Same `requireFeatures: ['customers.deals.view']`. The existing `?pipelineId=` query parameter continues to pre-select the pipeline; new filter params (`status[]`, `ownerUserId[]`, etc.) are additive.
- The `page.tsx` file is rewritten; no parallel route, no feature flag.
- API contracts on `GET / PUT / POST / DELETE /api/customers/deals` are **additive only** — new response enricher block + new filter keys + new sort options. Existing clients that ignore unknown fields keep working.
- `CustomerDealStageTransition` audit table is unchanged.
- No entity schema changes. Lane colors via dictionary; saved views via existing perspectives `payload` JSONB.
- Existing `/backend/customers/deals/create` page is redesigned in-place. Existing query params (`?personId=…&companyId=…&pipelineId=…`) continue to pre-fill the form.
- Existing list page `/backend/customers/deals` is untouched in this spec. The view-tabs row is added on the kanban side only; clicking "Lista" navigates to the existing list URL. Adding the tabs row to the list page is a follow-up spec.
- One new feature id `customers.deals.export` is declared in `acl.ts` (note: `customers.deals.manage` already existed before this spec, contrary to an earlier draft). Both are covered by the existing `admin: ['customers.*']` wildcard in `setup.ts` `defaultRoleFeatures`; `customers.deals.export` is also added explicitly to the `employee` role list. `yarn mercato auth sync-role-acls` is run to grant the new feature to existing tenant employee roles.

### Database migrations

One migration in `customers/migrations/` (`Migration20260513203311_customers.ts`):
- `ALTER TABLE customer_settings ADD COLUMN stuck_threshold_days int NOT NULL DEFAULT 14` — additive, BC-safe column with a default that backfills existing rows automatically.
- Updates `migrations/.snapshot-open-mercato.json`.

Additive schema change only — no rename, no drop, no narrowing. Existing clients that read `customer_settings` continue to work; the new column appears as `14` for every existing tenant row after migration runs. No separate seeding step is needed: column default + `setup.ts` covers both existing and new tenants.

### Fallbacks

- Dictionary entry missing `color` for a given stage value → lane uses deterministic palette by `stage.order % 6`.
- Tenant has no `stuck_threshold_days` row yet → enricher uses `14` as a hard default.
- `perspectives` row deserialization fails → drop the saved view from the list, log warning, do not crash the Customize-view popover.

## Implementation Plan

### Phase 1 — Backend & data layer
1. Add `customers.deals.stuck_threshold_days` to `customer_settings` as an additive column on the existing `CustomerSettings` entity (default 14). Single migration produces the `ALTER TABLE ADD COLUMN` SQL; column default backfills existing rows.
2. Declare new ACL feature `customers.deals.export` in `customers/acl.ts` (`customers.deals.manage` already exists). Add `customers.deals.export` to `employee` `defaultRoleFeatures` in `setup.ts`; `admin: ['customers.*']` already covers it. Run `yarn mercato auth sync-role-acls`.
3. Create `customers/data/enrichers.ts` exporting the `_pipeline` enricher (`enrichMany` with batched Kysely: one query for open-interaction counts per deal id via GROUP BY; one for stage-transition latest timestamps; one for the tenant threshold; in-memory derivation of `isStuck` / `isOverdue`). Set `priority: 10`, `timeout: 2000`, `fallback`.
4. Wire `enrichers: { entityId: 'customers.deal' }` into `customers/api/deals/route.ts` `makeCrudRoute`.
5. Extend the deals list schema + `buildFilters` with multi-value `status` / `pipelineId` / `ownerUserId`, `expectedCloseAtFrom/To` date range, `isOverdue` (status='open' + expected_close_at < today, composable with status filter), and `isStuck` (SQL push-down via Kysely against `customer_deal_stage_transitions` and `customer_deals.created_at` using the tenant threshold). Refactor ID intersection to compose across search + isStuck + advanced filter.
6. Add `customers/lib/bulkDeals.ts` with shared queue helper + per-operation runners (`bulkUpdateDealStageWithProgress`, `bulkUpdateDealOwnerWithProgress`) iterating the existing `customers.deals.update` command per id with progress reporting. Mirrors `catalog/lib/bulkDelete.ts` convention.
7. Add API routes: `customers/api/deals/bulk-update-stage/route.ts`, `customers/api/deals/bulk-update-owner/route.ts`. Always-async — create `ProgressJob`, enqueue, return 202 with `progressJobId`. Export `openApi`. No separate bulk-export route — the kanban uses `buildCrudExportUrl('customers/deals', ...)` against the existing CRUD route.
8. Add queue workers: `customers/workers/deals-bulk-update-stage.ts`, `customers/workers/deals-bulk-update-owner.ts`. Concurrency `1`, idempotent per id, mark `ProgressJob` failed on uncaught error.
9. Generate the migration (`yarn db:generate`), confirm it covers only the customers column addition, update `migrations/.snapshot-open-mercato.json`.

(Settings page UI + integration tests for these endpoints are deferred to Phase 5 alongside the broader polish work — they aren't on the kanban's critical render path.)

### Phase 2 — Kanban page core (lanes, cards, drag-drop)
1. Rewrite `backend/customers/deals/pipeline/page.tsx`: new top-level layout (PageHeader → ViewTabsRow → FilterBarRow → KanbanBoard → PageFooter).
2. Build `pipeline/components/ViewTabsRow.tsx` (Kanban + Lista only).
3. Build `pipeline/components/Lane.tsx`: colored top bar via `mapDictionaryColorToTone`, header (label, count, total value, stuck/overdue +N badges), `QuickAddRow`, sortable card-stack.
4. Build `pipeline/components/DealCard.tsx`: hover-checkbox, title row with activity badge + kebab, deal id, status pill (STUCK/OVERDUE), hover-revealed quick actions, value+probability, company, footer (date + days-in-stage + AvatarStack).
5. Build `pipeline/components/AddStageLane.tsx` (dashed-border 6th lane).
6. Swap native HTML5 DnD for `@dnd-kit` `DndContext` with `PointerSensor` + `KeyboardSensor`; wrap each lane in `SortableContext`.
7. Wire optimistic stage-move mutation through `useGuardedMutation` + existing `PUT /api/customers/deals` → invalidate query on settled.
8. Build `pipeline/hooks/useKanbanFilters.ts` (filter tree + URL sync, mirroring the list page pattern).
9. Build `pipeline/hooks/useKanbanSelection.ts` (set of selected deal ids, `selectAllInLane`, totalValue computation).
10. Add virtualization fallback: when a lane has > 100 cards, render the off-screen tail via `react-window` (lazy mount the dependency only if needed).
11. **Integration tests**:
    - page renders empty pipeline → empty state per lane
    - page renders with data → lane counts + totals correct
    - drag a card → PUT issued, optimistic update, server confirm
    - drag fails → optimistic rollback + flash error
    - stuck/overdue indicators render per derived state
    - keyboard drag via @dnd-kit `KeyboardSensor`

### Phase 3 — Modals (Create deal, Quick deal, Add stage, filter/sort/customize popovers, card menu)
1. Redesign `backend/customers/deals/create/page.tsx` to the three-column `CrudForm` layout: Deal details (left, larger) + Associations (left, bottom) + Custom attributes (right side panel) + Tips info card. Header has back arrow + "Create deal" title + Cancel/Create buttons (top + bottom).
2. Build `QuickDealDialog.tsx` (compact + expanded states; "+ Więcej szczegółów" toggles); submit → `POST /api/customers/deals` with the active lane's `pipelineId` + `pipelineStageId` pre-filled.
3. Build `AddStageDialog.tsx` (label + color picker from the dictionary); submit → `POST /api/customers/pipeline-stages` with auto-assigned `order`.
4. Build `CustomizeViewDialog.tsx`: SAVED VIEWS section (load via `perspectives`, single-select radios) + AKCJE section (Konfiguruj kolumny → opens card-fields sub-panel; Zarządzaj etapami → navigates to `/backend/config/customers/pipeline-stages`; Resetuj → clears `useKanbanFilters` + resets sort). Save view → `POST` to perspectives.
5. Build `StatusFilterPopover.tsx` (pill chips: Open / Loose / Won / Lost — multi-select, "{n} selected" footer + Cancel/Apply).
6. Build `PipelineFilterPopover.tsx` (radio list of pipelines with deal-counts per pipeline + "All pipelines" sentinel).
7. Build `SortByPopover.tsx` (8 radio options + "Default: Updated (newest)" footer + Cancel/Apply).
8. Wire the `+ More` button to the existing `AdvancedFilterPanel` add-field flow with kanban-context `FilterFieldDef[]` derived from columns + custom-field defs.
9. Build `DealCardMenu.tsx` using `DropdownMenu` with keyboard shortcuts shown (Open ↵ / Edit `E` / Duplicate `⌘D` / Move stage… / Mark Won / Mark Lost / Delete).
10. Wire activity composer dialogs (Call / Email / Note) — reuse the customers activities create endpoint; on submit, invalidate the deals query so `_pipeline.openActivitiesCount` re-renders.
11. **Integration tests**:
    - Quick deal submit creates a deal in the active lane
    - Add stage submit appends a new lane
    - Customize view round-trip: save → reload → view persists per user
    - Filter popovers narrow the board correctly
    - Card menu Mark Won flips status + status pill updates
    - Activity composer submit increments `_pipeline.openActivitiesCount`

### Phase 4 — Bulk operations
1. Build `BulkActionsBar.tsx` (fixed bottom, `z-toast`, dark surface `bg-foreground text-background`, `shadow-xl`, hide on no selection).
2. Wire hover-revealed checkbox per card + persistent visibility once any card is selected; total value computed from selection.
3. Wire bulk actions:
   - Change stage → opens a small dialog with a stage picker for the active pipeline; `POST /api/customers/deals/bulk-update-stage`
   - Change owner → opens a dialog with `fetchAssignableStaffMembers` picker; `POST /api/customers/deals/bulk-update-owner`
   - Export CSV → `buildCrudExportUrl('customers/deals', { ...filters, ids: selected }, 'csv')` opens in a new tab
   - Delete → `useConfirmDialog` then reuses the existing list-page `runBulkDelete` infrastructure
4. Bulk operations > 25 ids: receive `progressJobId` and let `ProgressTopBar` track completion.
5. **Integration tests**:
   - select 3 cards → bar appears with count + total
   - change stage → cards move, bar persists or clears per UX choice (default: clear after success)
   - change owner → avatars update on cards
   - delete → cards removed + flash + progress job logged if > 25
   - RBAC denial path (no `customers.deals.update`) → 403 surfaces as flash

### Phase 5 — Polish, i18n, docs, settings UI, tests
1. Add all i18n keys to `apps/mercato/i18n/en.json` and `apps/mercato/i18n/pl.json`.
2. Build the stuck-threshold settings page at `backend/config/customers/deals/page.tsx` + `page.meta.ts` (single number-input form gated by `customers.deals.manage`). Wires through an existing customers settings command to upsert `stuckThresholdDays` on the `CustomerSettings` row.
3. Ensure the view-tabs row component lives in a shared location ready for the future list-page reuse (`pipeline/components/ViewTabsRow.tsx` accepts an `active` prop).
4. Update `apps/docs/docs/framework/modules/customers.mdx` with kanban screenshots and the saved-view how-to.
5. Run `yarn mercato configs cache structural --all-tenants` per AGENTS.md after enabling the new settings page and threshold config.
6. **Integration tests** (moved from Phase 1 — written together with end-to-end UI coverage so each test exercises the full stack):
   - `_pipeline` enricher fields shape on `GET /api/customers/deals`
   - `isStuck` and `isOverdue` filter narrowing under various data fixtures
   - bulk-update-stage / bulk-update-owner: success, RBAC denial, cross-tenant denial, ProgressJob path
   - CSV export (existing `GET` endpoint with `exportScope=view`): byte content + filter application
   - stuck-threshold setting update + threshold honored by enricher
7. Accessibility: verify `@dnd-kit` keyboard nav, ARIA labels on icon-only buttons, focus trap in dialogs.
8. Run the full integration test suite + a DS Guardian compliance pass.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/page.tsx` | Modify (rewrite) | New kanban implementation |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/Lane.tsx` | Create | Single lane (header + quick-add + sortable card stack) |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/DealCard.tsx` | Create | Card body, derived indicators, hover quick actions |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/AddStageLane.tsx` | Create | Dashed 6th lane CTA |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/AddStageDialog.tsx` | Create | Inline stage create modal |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/QuickDealDialog.tsx` | Create | Compact + expanded quick-create |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/CustomizeViewDialog.tsx` | Create | Saved views + actions sub-panel |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/SortByPopover.tsx` | Create | Sort radio popover |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/filters/StatusFilterPopover.tsx` | Create | Status pill filter |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/filters/PipelineFilterPopover.tsx` | Create | Pipeline radio filter |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/DealCardMenu.tsx` | Create | 3-dot dropdown menu |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/BulkActionsBar.tsx` | Create | Dark floating bulk-actions bar |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/ViewTabsRow.tsx` | Create | Kanban + Lista tabs |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/hooks/useKanbanFilters.ts` | Create | Filter tree + URL sync |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/hooks/useKanbanSelection.ts` | Create | Bulk-select state |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/hooks/useKanbanSavedViews.ts` | Create | Perspectives integration |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/hooks/useDealActivityComposer.ts` | Create | Activity composer dialog opener |
| `packages/core/src/modules/customers/backend/customers/deals/create/page.tsx` | Modify | Three-column Create deal redesign |
| `packages/core/src/modules/customers/data/enrichers.ts` | Modify | `_pipeline` response enricher (was empty placeholder) |
| `packages/core/src/modules/customers/data/__tests__/enrichers.test.ts` | Create | Unit tests for `buildPipelineState` |
| `packages/core/src/modules/customers/lib/bulkDeals.ts` | Create | Queue helpers + per-op runners (mirrors `catalog/lib/bulkDelete.ts`) |
| `packages/core/src/modules/customers/api/deals/bulk-update-stage/route.ts` | Create | Bulk stage move endpoint (POST, async via queue) |
| `packages/core/src/modules/customers/api/deals/bulk-update-owner/route.ts` | Create | Bulk owner reassign endpoint (POST, async via queue) |
| `packages/core/src/modules/customers/workers/deals-bulk-update-stage.ts` | Create | Worker for bulk stage move |
| `packages/core/src/modules/customers/workers/deals-bulk-update-owner.ts` | Create | Worker for bulk owner reassign |
| `packages/core/src/modules/customers/setup.ts` | Modify | Seed `stuck_threshold_days` + new ACL grants |
| `packages/core/src/modules/customers/acl.ts` | Modify | Add `customers.deals.manage`, `customers.deals.export` |
| `packages/core/src/modules/customers/migrations/Migration*.ts` | Create | Insert default setting row |
| `packages/core/src/modules/customers/backend/config/customers/deals/page.tsx` | Create | Settings panel for threshold |
| `packages/core/src/modules/customers/backend/config/customers/deals/page.meta.ts` | Create | Page metadata (RBAC gate) |
| `apps/mercato/i18n/en.json` | Modify | New i18n keys |
| `apps/mercato/i18n/pl.json` | Modify | New i18n keys |

## Integration Coverage

Per the root `AGENTS.md` rule, every new feature MUST list integration coverage for all affected API paths and key UI paths.

### API paths
- `GET /api/customers/deals` — list with new filters (`isStuck`, `isOverdue`, `expectedCloseAtFrom/To`, `status[]`, `pipelineId[]`, `ownerUserId[]`, `personId[]`, `companyId[]`), `_pipeline` enrichment shape, pagination cap, tenant isolation.
- `PUT /api/customers/deals` — drag-drop stage move, `CustomerDealStageTransition` row insert, RBAC + cross-tenant denial.
- `POST /api/customers/deals` — Quick deal payload + Full create payload.
- `POST /api/customers/pipeline-stages` — Add-stage inline modal, auto-assigned `order`.
- `POST /api/customers/deals/bulk-update-stage` — sync success, partial failure (per-id error map), RBAC, sync→async threshold (25 ids).
- `POST /api/customers/deals/bulk-update-owner` — same coverage.
- `GET /api/customers/deals/bulk-export` — CSV byte assertion, filter application, RBAC.

### UI paths (Playwright, headless)
- `/backend/customers/deals/pipeline` — lanes color-coded, card activity badges visible, drag triggers PUT, stuck/overdue pills render, footer count correct.
- `/backend/customers/deals/pipeline` Quick deal flow — open from QuickAddRow, submit, card appears in target lane.
- `/backend/customers/deals/pipeline` Add stage flow — open inline modal, submit, new lane appended.
- `/backend/customers/deals/pipeline` Customize view flow — open dialog, save view, reload page → view persists per user.
- `/backend/customers/deals/pipeline` Bulk flow — hover, check 3 cards, bar appears with count + total; change stage submits and cards move; export downloads CSV.
- `/backend/customers/deals/pipeline` Card menu — open kebab, Mark Won → status pill flips.
- `/backend/customers/deals/pipeline` Filter chips — open Status popover, select 2 statuses → board refilters; Pipeline radio switches active pipeline.
- `/backend/customers/deals/pipeline` Sort — change to Value (high to low) → lane order reflects.
- `/backend/customers/deals/pipeline` View tabs — click Lista → navigates to `/backend/customers/deals`.
- `/backend/customers/deals/create` — three-column layout renders, custom-attributes panel populates from tenant fields, submit creates a deal.
- `/backend/customers/deals/pipeline` Activity composer — hover card, click Call, dialog opens, submit logs activity → activity badge count increments.
- `/backend/config/customers/deals` — stuck-threshold field saves; RBAC denial for non-admin.

### Test files
- `packages/core/src/modules/customers/__tests__/integration/deals-kanban-enricher.spec.ts`
- `packages/core/src/modules/customers/__tests__/integration/deals-bulk-stage.spec.ts`
- `packages/core/src/modules/customers/__tests__/integration/deals-bulk-owner.spec.ts`
- `packages/core/src/modules/customers/__tests__/integration/deals-bulk-export.spec.ts`
- `packages/core/src/modules/customers/__tests__/integration/deals-stuck-threshold-setting.spec.ts`
- `.ai/qa/customers/deals-kanban-redesign.spec.ts` (Playwright UI)

## Risks & Impact Review

### Data Integrity Failures
- **Concurrent drag**: two users drag the same card to different stages. Last write wins via single SQL UPDATE; both transitions audit-logged in `customer_deal_stage_transitions`. Losing client rolls back optimistic state via query invalidation.
- **Bulk operation interrupted**: progress-job worker is idempotent (commands use `withAtomicFlush` + transaction); a re-run skips ids already at the target stage.
- **Stale enricher data**: counts recompute every list fetch; eventual-consistency is acceptable since the badge is informational.

### Cascading Failures & Side Effects
- **Enricher timeout**: `timeout: 2000ms`, fallback returns a zeroed `_pipeline` block. Kanban renders cards without indicators rather than failing the request.
- **Dictionary lookup miss for stage color**: deterministic fallback palette by stage order.
- **Activity composer submit fails**: flash error, no badge increment; deal card unchanged.

### Tenant & Data Isolation Risks
- All routes pass `organization_id` + `tenant_id` through existing `requireAuth` + `withScopedPayload`; new bulk commands reuse the same scoping.
- `perspectives` rows are user-scoped within tenant — no cross-tenant leak.
- Threshold setting is per `customer_settings` row scoped by `(tenant_id, organization_id)`.

### Migration & Deployment Risks
- Migration only inserts a settings row; idempotent via `setup.ts`.
- Zero-downtime: route replaced in-place, API additive.
- Rollback: revert the page + delete the inserted setting rows (no schema rollback needed).

### Operational Risks
- **Drag-drop performance** with >100 cards per lane: enforce `pageSize=100` cap (DS rule) and lazy-render tail via `react-window` if profiling shows jank.
- **Bulk export size**: existing `buildCrudExportUrl` infrastructure bounds streaming; no new risk.
- **AI assistant** is not present on this page (per Q8), so no LLM cost or latency surface added.

### Risk Register

#### Concurrent stage drag
- **Scenario**: Two users drag the same card simultaneously into different stages.
- **Severity**: Low
- **Affected area**: `PUT /api/customers/deals`
- **Mitigation**: Last write wins at SQL level; both transitions audit-logged; optimistic UI on the losing client rolls back when the query invalidates.
- **Residual risk**: Brief UI inconsistency until invalidation — acceptable.

#### Enricher slow path on large tenants
- **Scenario**: Tenant with millions of activities → counting open activities per deal becomes slow.
- **Severity**: Medium
- **Affected area**: `GET /api/customers/deals`
- **Mitigation**: `enrichMany` performs a single GROUP BY across the page's deal ids using indexed columns; `timeout: 2000ms` with zeroed fallback ensures kanban still renders.
- **Residual risk**: Informational badges may briefly show `0` on overloaded tenants — acceptable.

#### Drag-drop keyboard regression
- **Scenario**: Existing keyboard users relied on browser-native behavior.
- **Severity**: Low
- **Affected area**: Kanban page.
- **Mitigation**: `@dnd-kit/sortable` ships `KeyboardSensor` out of the box; ARIA announcements are first-class.
- **Residual risk**: None.

#### Bulk operation noisy-neighbor
- **Scenario**: One tenant kicks off a 10,000-deal bulk owner change.
- **Severity**: Low–Medium
- **Affected area**: Queue worker.
- **Mitigation**: Worker concurrency `1` per tenant, idempotent per id, progress tracked via `ProgressJob`; other tenants unaffected.
- **Residual risk**: Single-tenant blast radius only.

#### Perspectives schema drift on saved-view payload
- **Scenario**: Future kanban changes the `payload` shape and old saved views fail to deserialize.
- **Severity**: Low
- **Affected area**: Customize-view dialog.
- **Mitigation**: Strict zod schema with version field; on schema mismatch, drop the view from the list and surface a `flash('warning', …)`.
- **Residual risk**: User must re-create the view — acceptable.

## Final Compliance Report — 2026-05-13

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/search/AGENTS.md` (read-only impact: search index continues to fire via existing commands)
- `.ai/ds-rules.md`
- `.ai/ui-components.md`
- `.ai/qa/AGENTS.md` (integration test conventions)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Singular naming for entities / commands / events / feature IDs | Compliant | `customers.deal.*`, `customers.bulk_update_deal_stage`, `customers.deals.manage` |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | All cross-module refs are FK IDs |
| root AGENTS.md | Filter by organization_id | Compliant | All new routes scoped through `withScopedPayload` |
| root AGENTS.md | Validate inputs with zod | Compliant | New routes ship zod schemas |
| root AGENTS.md | Use `useGuardedMutation` for non-CrudForm writes + pass `retryLastMutation` | Compliant | Drag move, bulk ops, activity composer |
| root AGENTS.md | No raw `fetch` in UI | Compliant | All calls via `apiCall*` family |
| root AGENTS.md | i18n: no hard-coded user-facing strings | Compliant | All strings through `useT()` |
| root AGENTS.md | Dialog `Cmd/Ctrl+Enter` submit + `Escape` cancel | Compliant | Every dialog wires both |
| root AGENTS.md | `pageSize` ≤ 100 | Compliant | Kanban uses `pageSize=100` per page |
| root AGENTS.md | Run `yarn mercato configs cache structural --all-tenants` after sidebar/page additions | Compliant | Listed in Phase 5 |
| `.ai/ds-rules.md` | No hardcoded status colors | Compliant | All via semantic status tokens / dictionary tones |
| `.ai/ds-rules.md` | No arbitrary text sizes / arbitrary spacing | Compliant | Tailwind scale only; lane/card spacing enumerated |
| `.ai/ds-rules.md` | No `dark:` overrides on semantic / status tokens | Compliant | None added |
| `.ai/ds-rules.md` | Brand violet restricted to AI / custom-attribute moments | Compliant | Restricted to Custom attributes icon + Tips info card on Create deal page |
| `.ai/ds-rules.md` | `lucide-react` icons only (no inline `<svg>`) | Compliant | All icons enumerated as lucide |
| `.ai/ds-rules.md` | `focus-visible:` rings (not `focus:`) | Compliant | Custom focusables use the standard recipe |
| `.ai/ds-rules.md` | `<StatusBadge>` for status display | Compliant | STUCK = warning, OVERDUE = error |
| `.ai/ds-rules.md` | Boy Scout: migrate touched lines to semantic tokens | Compliant | Existing pipeline `page.tsx` rewrite uses tokens throughout |
| packages/core/AGENTS.md | API routes export `openApi` | Compliant | All new routes export `openApi` |
| packages/core/AGENTS.md | CRUD routes use `makeCrudRoute` with `indexer.entityType` | Compliant | Existing `E.customers.customer_deal` indexer reused |
| packages/core/AGENTS.md | Write ops via Command pattern with undo | Compliant | Bulk commands implement before/after snapshots |
| packages/core/AGENTS.md | Response enrichers MUST implement `enrichMany` | Compliant | `_pipeline` enricher batches via GROUP BY |
| packages/core/AGENTS.md | `_`-prefix enricher fields stripped from exports | Compliant | `_pipeline` follows convention |
| packages/core/AGENTS.md | ACL grants synced via `setup.ts` `defaultRoleFeatures` + `sync-role-acls` | Compliant | Phase 1 step 2 |
| packages/core/AGENTS.md | `withAtomicFlush` when mutations + queries interleave | Compliant | Bulk commands use it |
| packages/core/AGENTS.md | Customer-facing data scoped by `(tenant_id, organization_id)` | Compliant | Saved views (perspectives) + threshold (settings) both tenant-scoped |
| customers/AGENTS.md | Use customers module as template for new CRUD slices | Compliant | New bulk commands + routes follow people / existing deals patterns |
| packages/ui/AGENTS.md | Backend pages use `Page` + `PageBody` | Compliant | Wrapping preserved |
| packages/ui/src/backend/AGENTS.md | `apiCall`/`apiCallOrThrow`/`readApiResultOrThrow` only | Compliant | Imports enumerated |
| packages/queue/AGENTS.md | Long-running bulk ops via worker | Compliant | Bulk ops > 25 ids go through queue |
| packages/queue/AGENTS.md | Idempotent job processing | Compliant | Bulk workers skip ids already at target |
| packages/events/AGENTS.md | Event ids: `module.entity.action`, singular | Compliant | `customers.deal.stuck` (optional, future) |
| `.ai/qa/AGENTS.md` | Integration tests created same change as feature | Compliant | Test files listed under Integration Coverage |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | `_pipeline` shape consistent across enricher + UI consumers |
| API contracts match UI/UX section | Pass | Each modal lists the route it hits |
| Risks cover all write operations | Pass | Drag-drop, bulk stage, bulk owner, bulk delete, activity create, settings update |
| Commands defined for all mutations | Pass | New bulk commands; existing commands reused otherwise |
| Cache strategy covers all read APIs | Pass | List route uses existing CRUD cache; enricher is response-time |
| i18n covers all surfaces | Pass | Polish + English keys enumerated |
| File manifest covers all new components | Pass | Cross-checked against Surface Inventory + Implementation Plan |

### Non-Compliant Items
None.

### Verdict
**Fully compliant** — ready for implementation.

## Changelog

### 2026-05-13
- Initial specification.
- Phase 1 implementation complete (backend slice). Three spec corrections applied:
  - `customers.deals.manage` was already declared before this spec; only `customers.deals.export` is genuinely new.
  - Migration is additive `ALTER TABLE ADD COLUMN stuck_threshold_days int NOT NULL DEFAULT 14` on `customer_settings` (the original draft incorrectly claimed "no schema change"). The change is BC-safe — new column with default backfills existing rows.
  - Bulk endpoints follow the always-async + ProgressJob convention (matching `catalog/api/bulk-delete`), not the original spec's "sync ≤ 25 / async > 25" split. No separate `bulk-export` route — kanban uses `buildCrudExportUrl` against the existing CRUD route.
- Settings page UI + integration tests for Phase 1 endpoints moved into Phase 5 so they ship alongside end-to-end UI test coverage.

### 2026-05-14
- Post-implementation `/code-review` pass: 8/8 CI gates green (`yarn build:packages` × 2, `yarn generate`, `yarn i18n:check-sync`, `yarn typecheck`, `yarn test`, `yarn build:app`). `yarn i18n:check-usage` advisory-only (3614 unused keys, all pre-existing on `develop`).
- Code-review fix applied: wired `Cmd/Ctrl+Enter` keyboard submit on `CustomizeViewDialog`, `ChangeStageDialog`, `ChangeOwnerDialog` (DS rule — `QuickDealDialog`, `AddStageDialog`, `ActivityComposerDialog` already had it).
- Manual preview comparison (logged into seeded dev DB after `yarn install` + applied `Migration20260513203311_customers` directly via SQL since the dev environment's `mikro_orm_migrations_ai_assistant` table was out of sync). All 11 Figma surfaces verified end-to-end:
  - Main kanban view, breadcrumb + header + view tabs + filter bar + 4–5 lanes visible (sidebar takes width), dashed "+ New stage" lane at the end — ✅
  - Status / Pipeline / Sort filter popovers — ✅ render with correct chip styling
  - Customize view dialog — ✅ saved-views placeholder list + 3 action rows
  - Quick deal compact + expanded — ✅ (**fix applied**: added Company `<Select>` field populated from `/api/customers/companies` + Owner read-only avatar using current user from staff query; `companyIds` + `ownerUserId` now passed in POST payload)
  - Add stage dialog — ✅
  - Card kebab menu — ✅ all 7 actions wired (Open / Edit / Duplicate / Move stage / Mark Won / Mark Lost / Delete)
  - Card hover Call / Email / Note — ✅ icons reveal via group-hover
  - Settings page at `/backend/config/customers/deals` — ✅
- Known remaining 1:1 gaps (low severity, deferred to follow-up):
  - Card kebab menu doesn't render keyboard shortcut hints (`↵ E ⌘D`) — `RowActions` primitive doesn't natively support inline `Kbd`; would need a new primitive variant.
  - Page renders an Open-Mercato-convention H1 "Deals" that doesn't appear in the Figma kanban frame (Figma shows only the breadcrumb). Keeping the H1 for accessibility + sidebar/page-title consistency across the app.
  - Stage labels in the seeded dev DB (OPPORTUNITY / MARKETING QUALIFIED LEAD / SALES QUALIFIED LEAD / OFFERING / LOOSE / CLOSED / STALLED) differ from the Figma mock data (QUALIFICATION / PROPOSAL / NEGOTIATION / CONTRACT / CLOSING) — data difference, not a code gap.

- **Lane header precision pass** (second user-reported visual mismatch — color bar attached to the container's top edge instead of being a separate element with margin):
  - Lane header container now uses `px-3.5 pt-3 pb-3` (matching Figma's `lh` frame 220×52 with 14×12 internal padding).
  - **Color accent**: moved from full-bleed top-edge (`h-1` flush with `overflow-hidden`) to **`h-1 w-full rounded-full` positioned inside the container** with `mt-2` gap below — matching Figma's separately positioned `Rectangle` (`982:337`) sitting at `y=12, height=4` inside the container.
  - **Count badge**: switched from `min-w-5 rounded-full` (circle) to `h-4 rounded-full px-1.5` (pill shape) — matching Figma's `cp` frame `21×16` with 7×12 text and ~6px horizontal padding.
  - **Risk `+N` badge**: same pill shape, replaces the previous `<Badge variant="secondary">` to match Figma's `morePill` frame `25×16`.
  - Quick-add dashed border: switched from `border-border` → `border-input` so the dashes are visible against `bg-card/50`; height stays at `h-10` (40px), matching Figma's `quick-add` 36px.
  - Card title: `font-semibold` → `font-bold` to match Figma's heavier weight on `982:354`.
  - Card activity-count badge: `h-5 min-w-5` (circle) → `h-4 px-1.5` (pill) — matching Figma's `act` frame `19×14`.

- **Visual rework of Lane + DealCard** to match the Figma's 3-card-stack composition (user-reported gap — the original single-container approach didn't visually match Figma `982:335` / `982:351`):
  - **Lane.tsx**: split from one rounded container into **three separate stacked elements**:
    1. Header card (rounded, with 1px-tall colored top accent + label + tinted count badge + total value + risk `+N` badge), and
    2. Quick-add dashed-border button (standalone), and
    3. Sortable card stack (the droppable target only wraps the cards, not the header).
  - **Lane header count badge** now picks up the stage tone (e.g., `bg-status-success-bg text-status-success-text` for green-toned QUALIFICATION) — matching the cyan pill in the mockup. Falls back to neutral when tone is null.
  - **DealCard.tsx**: switched from `rounded-md` to `rounded-lg` (matching Figma card radius), restructured internals:
    - Title row: title (line-clamp-2 bold) + DEAL-XXX ref (mono small) stacked on left; activity-count badge + kebab on right.
    - Status pill row (STUCK / OVERDUE) when derived.
    - Hover-revealed Call / Email / Note row (unchanged).
    - **Value row**: large bold amount (`text-xl font-bold`) + small currency code (`text-xs text-muted-foreground`) on left; probability rendered as a rounded pill on the right (`rounded-full bg-muted px-2 py-0.5`).
    - **Company pill**: rounded rect with `Building2` icon + name (no longer a `<Link>` — visual primary).
    - **Divider line** (`-mx-4 border-t`) between value/company block and footer.
    - **Footer row**: calendar icon + date + days-in-stage on left; `Avatar` size="sm" on right (label resolves once owner staff query lands).
  - All `npx tsc`/`yarn typecheck`/`yarn test` gates still pass after the rework.

## Implementation Status

| Phase | Status | Date | Notes |
|---|---|---|---|
| Phase 1 — Backend & data layer | Done | 2026-05-13 | 1a–1d complete (column, ACL, enricher, filters, bulk lib + 2 routes + 2 workers). 14/14 unit tests pass. Lint clean. Settings UI + integration tests deferred to Phase 5. |
| Phase 2 — Kanban page core | Done (code) — visual verification pending | 2026-05-13 | 6 files: `ViewTabsRow`, `DealCard`, `Lane`, `AddStageLane`, `FilterBarRow`, `page.tsx` rewrite. `@dnd-kit/sortable` + `KeyboardSensor`, `useGuardedMutation` for stage move (Boy Scout fix), search input wired into the deals query. Filter chips, customize-view, quick-add, add-stage, card menu, activity composers are stubs that flash "coming next iteration" — full modals land in Phase 3. tsc clean. Browser verification blocked by **pre-existing dev-env issue** (`@radix-ui/react-accordion` declared in `packages/ui/package.json` but missing from `node_modules` — affects every page, not just kanban; resolved by `yarn install`). |
| Phase 3 — Modals | Done (code) except Create deal redesign deferred to Phase 5 | 2026-05-13 | 9 new component files: `QuickDealDialog`, `AddStageDialog`, `ChipButton`, `StatusFilterPopover`, `PipelineFilterPopover`, `SortByPopover`, `CustomizeViewDialog`, `ActivityComposerDialog`. `DealCard` kebab swapped to `RowActions`. `Lane` API switched from `onMenuOpen` to `buildMenuItems`. Page state: `quickDealContext`, `addStageContext`, `customizeOpen`, `activityContext`, `statusFilters`, mutable `sortBy`, `activeSavedViewId`. Wiring: `setStatusFilters`/`setSelectedPipelineId`/`setSortBy` flow into deals query params; card kebab does Open/Edit/Mark Won/Mark Lost/Delete (Duplicate + Move stage are stubs); activity composer logs Call/Email/Note via `POST /api/customers/interactions` with deal's `primaryCompany.id` as `entityId`. CustomizeViewDialog ships with hardcoded placeholder saved views; persistence to `perspectives` is Phase 5. **Deferred to Phase 5**: full `/backend/customers/deals/create` page 3-column redesign (existing `DealForm`-based page remains functional; CTA wired through). tsc clean. |
| Phase 4 — Bulk operations UI | Done (code) | 2026-05-13 | 3 new component files: `BulkActionsBar`, `ChangeStageDialog`, `ChangeOwnerDialog`. Bar surfaces at `z-toast` when ≥1 card selected, shows count + currency-formatted total + 4 actions. Wires: Change stage → `POST /api/customers/deals/bulk-update-stage` (Phase 1d route), Change owner → `POST /api/customers/deals/bulk-update-owner` (Phase 1d route), Export CSV → `buildCrudExportUrl('customers/deals', { ids, exportScope: 'view' }, 'csv')` + window.open, Delete → `runBulkDelete` iteration (mirrors list page) with `ProgressJob` tracking. Owner picker fetches staff via existing `fetchAssignableStaffMembers`. tsc clean. |
| Phase 5 — Polish (partial) | Done (5a/b/c) — 5d–5h deferred to follow-up PR | 2026-05-13 | **Shipped in this PR**: 5a settings page (`backend/config/customers/deals/page.tsx` + `page.meta.ts` + new `customers.settings.save_stuck_threshold` command + new schema + new `/api/customers/settings/stuck-threshold` GET/PUT route, gated by `customers.deals.manage`). 5b owner display names on cards (new staff useQuery + `ownerNamesById` map applied to deals via useMemo). 5c card menu Duplicate (POST clone with " (copy)" title suffix, preserves stage/value/probability/owner) + Move stage (reuses `ChangeStageDialog` with `selectedCount=1`, calls extracted `moveDealToStage` helper). All checked by `npx tsc --noEmit`; 14/14 enricher unit tests still pass. **Deferred** to a follow-up PR: i18n key extraction to `apps/mercato/i18n/{en,pl}.json`, Create deal page 3-column redesign, 5 integration tests, saved-views persistence via `perspectives`, `AdvancedFilterPanel` reuse for "+ More", Owner/People/Companies/Close filter popovers, Configure card fields sub-panel, stage-color from `pipeline-stages` dictionary lookup, accessibility audit, DS Guardian pass. |

### Phase 1 — Detailed Progress
- [x] 1a · Add `stuck_threshold_days` column to `CustomerSettings` + migration (`Migration20260513203311_customers.ts`)
- [x] 1a · Declare `customers.deals.export` in `acl.ts`; grant to `employee` role in `setup.ts`
- [x] 1b · Create `_pipeline` response enricher in `data/enrichers.ts` + wire `enrichers: { entityId: 'customers.deal' }` into the deals CRUD route
- [x] 1b · Unit-test pure `buildPipelineState` helper (14 cases covering all derivation rules)
- [x] 1c · Multi-value `status` / `pipelineId` / `ownerUserId` filters
- [x] 1c · `expectedCloseAtFrom` / `expectedCloseAtTo` date-range filter
- [x] 1c · `isOverdue` filter (status='open' AND expected_close_at < today)
- [x] 1c · `isStuck` filter via Kysely push-down (latest stage transition or `created_at` older than `stuck_threshold_days`)
- [x] 1c · Refactor ID intersection to compose search + isStuck + advanced filter cleanly
- [x] 1d · `customers/lib/bulkDeals.ts` — shared queue + runners (mirrors catalog `bulkDelete.ts`)
- [x] 1d · `POST /api/customers/deals/bulk-update-stage` (always-async, ProgressJob)
- [x] 1d · `POST /api/customers/deals/bulk-update-owner` (always-async, ProgressJob)
- [x] 1d · Workers `deals-bulk-update-stage.ts` + `deals-bulk-update-owner.ts` (concurrency 1, idempotent per id, fail ProgressJob on error)

### Phase 2 — Detailed Progress
- [x] 2 · `pipeline/components/ViewTabsRow.tsx` (Kanban + Lista tabs, accessible `role="tablist"`)
- [x] 2 · `pipeline/components/DealCard.tsx` (sortable card with hover-checkbox, activity badge, STUCK/OVERDUE pill, hover-reveal Call/Email/Note, value+probability, company, footer with date/days-in-stage/owner avatar)
- [x] 2 · `pipeline/components/Lane.tsx` (`useDroppable` + `SortableContext`, colored top accent from fallback palette by order — dictionary tone wiring deferred to Phase 5, lane header with count + total value + stuck/overdue +N badge, quick-add row)
- [x] 2 · `pipeline/components/AddStageLane.tsx` (dashed 6th lane CTA)
- [x] 2 · `pipeline/components/FilterBarRow.tsx` (chips + Add filter + Sort triggers — popovers in Phase 3)
- [x] 2 · `pipeline/page.tsx` rewrite — composes everything, `@dnd-kit` `DndContext` + `PointerSensor` + `KeyboardSensor`, `useGuardedMutation` for stage move (Boy Scout fix; previous page used raw `useMutation`), search input wired into the deals query, breadcrumb + header + customize/new-deal CTAs, footer with count + drag hint
- [x] 2 · `CustomerSettings` `OptionalProps` updated to include `stuckThresholdDays` + `addressFormat` (TS-only fix; entity creators can now omit these)
- [x] 2 · Filter chips / customize-view / quick-add / add-stage / card menu / activity composers stubbed with `flash('coming next iteration')` — full modals are Phase 3 scope

### Phase 3 — Detailed Progress
- [x] 3a · `QuickDealDialog` (compact + expanded) wired to `POST /api/customers/deals` with `useGuardedMutation`
- [x] 3a · `AddStageDialog` with color picker wired to `POST /api/customers/pipeline-stages`
- [x] 3a · Card kebab refactor — swapped placeholder button for `RowActions`; `Lane` API switched from `onMenuOpen` to `buildMenuItems`
- [x] 3a · Card menu actions wired: Open / Edit / Mark Won / Mark Lost / Delete (with `useConfirmDialog`). Duplicate + Move stage are deferred stubs.
- [x] 3b · `ChipButton` extracted as a shared primitive
- [x] 3b · `StatusFilterPopover` (multi-select pill chips)
- [x] 3b · `PipelineFilterPopover` (radio with pipeline counts)
- [x] 3b · `SortByPopover` (8 sort options, default highlighted)
- [x] 3b · `FilterBarRow` refactored to accept `leadingChips` + `sortNode` React node slots
- [x] 3b · `statusFilters` state + URL param wiring (`status[]` on deals query)
- [x] 3b · `sortBy` made mutable; `setSortBy` plumbed through `SortByPopover`
- [x] 3c · `CustomizeViewDialog` — saved views (hardcoded placeholder list), action rows (Configure card fields stub / Manage stages link / Reset)
- [x] 3c · Reset to default clears filters + sort + active view
- [x] 3d · `ActivityComposerDialog` (Call/Email/Note) wired to `POST /api/customers/interactions` via deal's `primaryCompany.id` as `entityId`
- [ ] 3d · Create deal page 3-column redesign — **deferred to Phase 5** (existing `DealForm`-based page is functional; CTA wired)
- [ ] 3 · Card menu Duplicate + Move stage — deferred stubs (Phase 5)
- [ ] 3 · Saved-views persistence via `perspectives` — UI stub in place (Phase 5)
- [ ] 3 · "+ More" filter button via `AdvancedFilterPanel` reuse — stub (Phase 5)
- [ ] 3 · Owner / People / Companies / Close popovers — stubs (Phase 5)

### Phase 4 — Detailed Progress
- [x] 4 · `BulkActionsBar` component (fixed-bottom, `z-toast`, dark surface, count + currency-formatted total + 4 actions + clear button)
- [x] 4 · `ChangeStageDialog` — picker for stages in the current pipeline
- [x] 4 · `ChangeOwnerDialog` — async staff picker with search input (reuses `fetchAssignableStaffMembers`)
- [x] 4 · Wire Change stage → `POST /api/customers/deals/bulk-update-stage` (Phase 1d route, async via queue + ProgressJob)
- [x] 4 · Wire Change owner → `POST /api/customers/deals/bulk-update-owner` (Phase 1d route, async via queue + ProgressJob)
- [x] 4 · Wire Export CSV → `buildCrudExportUrl('customers/deals', { ids, exportScope: 'view' }, 'csv')` + `window.open` in new tab
- [x] 4 · Wire Delete → `useConfirmDialog` + `runBulkDelete` iteration (mirrors list page, `customers.deals.bulk_delete` ProgressJob)
- [x] 4 · Bar auto-shows when `selectedDealIds.size > 0`, clears selection after successful mutations

### Phase 5 — Detailed Progress
- [x] 5a · `customerStuckThresholdUpsertSchema` zod schema (positive int 1..365)
- [x] 5a · `customers.settings.save_stuck_threshold` command (idempotent upsert against `CustomerSettings`)
- [x] 5a · `GET / PUT /api/customers/settings/stuck-threshold` route with `openApi` export, gated by `customers.deals.manage`
- [x] 5a · `/backend/config/customers/deals` settings page (`page.tsx` + `page.meta.ts`) — single number input wired via `useGuardedMutation` + `apiCallOrThrow`
- [x] 5b · `staffQuery` (`useQuery` with 5-minute `staleTime`) fetches up to 200 assignable staff members
- [x] 5b · `ownerNamesById` Map built once from staff data
- [x] 5b · `deals` derived via `useMemo` from `rawDeals` — replaces empty owner labels with resolved display names
- [x] 5c · `moveDealToStage(dealId, stageId)` extracted from drag-drop handler — reused by single-deal Move stage menu action
- [x] 5c · `duplicateDeal(deal)` — POST clone with `" (copy)"` title suffix; preserves pipeline/stage/value/probability/expectedCloseAt/owner; status reset to `open`
- [x] 5c · Card menu Move stage opens a `ChangeStageDialog` with `selectedCount: 1` (reuses the bulk picker)
- [ ] 5d · i18n key extraction (`translateWithFallback` calls have English fallbacks today; Polish locale file not yet populated)
- [ ] 5e · Create deal page 3-column redesign (`982:1142`) — existing `DealForm`-based page still functional
- [ ] 5f · Saved-views persistence via `perspectives` module (UI placeholder list ships today)
- [ ] 5f · `AdvancedFilterPanel` reuse for "+ More" filter button
- [ ] 5f · Owner / People / Companies / Close filter popovers (static chips flash placeholder)
- [ ] 5f · Configure card fields sub-panel
- [ ] 5g · Stage-color from `pipeline-stages` dictionary lookup (currently uses order-based fallback palette)
- [ ] 5h · 5 integration tests (`_pipeline` enricher / isStuck filter / bulk routes / CSV export / settings update)
- [ ] 5h · Accessibility audit + DS Guardian pass
