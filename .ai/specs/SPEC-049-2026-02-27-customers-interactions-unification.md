# SPEC-049: Customers Interactions Unification

## TLDR
**Key Points:**
- Replace split model (`activities` + external `todo links` + manual `next interaction`) with one first-class object: `CustomerInteraction`.
- Compute `next interaction` automatically from the nearest open interaction date.
- Keep existing API paths (`/customers/activities`, `/customers/todos`) as deprecated adapter bridges for at least one minor release.

**Scope:**
- New `customer_interactions` entity and CRUD API.
- Automatic projection of next interaction onto `customer_entities.next_interaction_*`.
- UI migration of Tasks/Activities to one interaction backend.
- Data migration from `customer_activities` and `customer_todo_links`.
- Legacy endpoints stay available as compatibility adapters; no legacy table drops in this spec.

**Concerns:**
- Migration quality when old todo providers are unavailable.
- Backward compatibility for existing clients and UI hooks.
- Temporary dual-contract maintenance (canonical + legacy adapters) during the deprecation window.

## Overview
Customers module currently represents follow-up work in three places:
1. `customer_activities` (timeline/log).
2. `customer_todo_links` (links to external todo providers, default `example:todo`).
3. `customer_entities.next_interaction_*` (manually edited summary).

This creates duplicate semantics and requires user discipline to keep data coherent.

This specification unifies all planned/completed customer interactions into one model and makes `next interaction` a derived projection.

> **Market Reference**: Odoo CRM uses a single activity object with typed activities and "next activity" behavior. HubSpot and Salesforce separate timeline and tasks but still rely on a single "next step" discipline. We adopt Odoo-like unification of the core object while preserving OM auditability and compatibility guarantees.

## Problem Statement
Current UX and data model issues:
1. Same business intent is split between tasks and activities.
2. `next_interaction_*` is mutable data that can drift from actual open work.
3. Tasks depend on provider link indirection (`todoSource`), adding complexity for listing, updating, and migration.
4. Dashboard "next interactions" reads from manual fields, not from source-of-truth action items.

Result: users are confused, reporting and prioritization are harder, and consistency must be maintained manually.

## Proposed Solution
Introduce a single `CustomerInteraction` domain object for both planned and completed interactions.

### Core Rules
1. Every customer-facing action or logged touchpoint is a `CustomerInteraction`.
2. Interaction type is explicit (`interactionType`) and dictionary-backed.
3. State is explicit (`status`: `planned`, `done`, `canceled`).
4. `next interaction` is derived automatically:
   - nearest `planned` interaction by `scheduledAt` (ascending),
   - scoped per customer entity,
   - with deterministic tie-breakers.
5. `customer_entities.next_interaction_*` remains as read-optimized projection, not user-authored truth.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Keep `next_interaction_*` columns as projection | Avoid breaking existing list filters/widgets and keep fast reads |
| Add one canonical interaction table | Remove conceptual split and provider coupling |
| Keep old APIs as adapters for >=1 minor | Comply with backward-compatibility contract while moving all new domain writes to canonical commands |
| Compute projection synchronously on writes + background reconciler | Immediate UX consistency with recovery safety net |
| Keep legacy tables additive/read-only in this release | Schema removals are not allowed in the same release under repo BC rules |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Keep split model and add stronger UI hints | Does not remove data drift; still cognitively expensive |
| Remove projection columns, compute next on every read | Heavier queries on high-volume lists/widgets |
| Keep provider-linked todos as primary model | Preserves indirection and complexity causing current confusion |

## User Stories / Use Cases
- **SDR** wants one place to add call/email/task follow-ups so that planning is simple.
- **Sales manager** wants "next interaction" to always show the nearest open action without manual syncing.
- **Ops/admin** wants old API clients to continue working during migration.
- **Analyst** wants reliable reporting of open/planned/completed customer interactions.

## Architecture
Unified write path:
1. UI/API create/update/complete/cancel interaction.
2. Command mutates `customer_interactions`.
3. Same command recalculates customer projection (`next_interaction_*`) for affected entity.
4. Event emitted for indexing/audit (`customers.interaction.*`).

Read path:
1. Detail pages query interactions directly.
2. Legacy endpoints map to filtered interaction queries.
3. Dashboard next interactions reads projection fields (kept current by write path and reconciler).

### Commands & Events
- **Commands**
  - `customers.interaction.create`
  - `customers.interaction.update`
  - `customers.interaction.complete`
  - `customers.interaction.cancel`
  - `customers.interaction.delete`
  - `customers.interaction.recompute_next` (internal/repair)
- **Events**
  - `customers.interaction.created`
  - `customers.interaction.updated`
  - `customers.interaction.completed`
  - `customers.interaction.canceled`
  - `customers.next_interaction.updated`

## Data Models
### CustomerInteraction (Singular)
New table: `customer_interactions`

- `id`: UUID PK
- `organization_id`: UUID, required
- `tenant_id`: UUID, required
- `entity_id`: UUID FK -> `customer_entities.id`, required
- `deal_id`: UUID FK -> `customer_deals.id`, nullable
- `interaction_type`: text, required (dictionary-backed, normalized)
- `title`: text, nullable
- `body`: text, nullable
- `status`: text enum (`planned`, `done`, `canceled`), required
- `scheduled_at`: timestamptz, nullable (planning axis)
- `occurred_at`: timestamptz, nullable (actual completion axis)
- `priority`: int, nullable
- `author_user_id`: UUID, nullable
- `owner_user_id`: UUID, nullable
- `appearance_icon`: text, nullable
- `appearance_color`: text, nullable
- `source`: text, nullable (`manual`, `migration:activity`, `migration:todo_link`, etc.)
- `created_at`: timestamptz
- `updated_at`: timestamptz

Indexes:
- `(entity_id, status, scheduled_at, created_at)`
- `(organization_id, tenant_id, status, scheduled_at)`
- `(tenant_id, organization_id, interaction_type)`

Projection table/columns:
- Keep existing `customer_entities.next_interaction_at`, `next_interaction_name`, `next_interaction_ref_id`, `next_interaction_icon`, `next_interaction_color`.
- Mark as derived in code/docs. Manual editing is removed from detail UI.

Legacy tables:
- `customer_activities`: deprecated (read-only compatibility window).
- `customer_todo_links`: deprecated (read-only compatibility window).

## API Contracts
### New canonical endpoints
#### `GET /api/customers/interactions`
- Query: `entityId`, `status`, `interactionType`, `from`, `to`, `cursor`, `limit`, `sortField`, `sortDir`
  - `limit` max: `100` (default `25`)
  - keyset cursor mode (`cursor`) is canonical for scale
- Response: keyset list of `CustomerInteraction` + `nextCursor`.

#### `POST /api/customers/interactions`
- Body: `entityId`, `interactionType`, optional `title`, `body`, `scheduledAt`, `ownerUserId`, `priority`, `dealId`.
- Response: `{ id: "<uuid>" }` + undo metadata header.

#### `PUT /api/customers/interactions`
- Body: `id` + mutable fields.
- Response: `{ ok: true }`.

#### `POST /api/customers/interactions/complete`
- Body: `id`, optional `occurredAt`.
- Response: `{ ok: true }`.

#### `POST /api/customers/interactions/cancel`
- Body: `id`.
- Response: `{ ok: true }`.

#### `DELETE /api/customers/interactions?id=<uuid>`
- Query: `id`.
- Response: `{ ok: true }`.

### Compatibility endpoints
#### `GET /api/customers/activities`
- Backed by `customer_interactions` filter:
  - includes non-task interaction types or completed/planned interactions per current activity semantics.
- Response includes deprecation headers (`Deprecation`, `Sunset`) and migration docs link.

#### `POST/PUT/DELETE /api/customers/activities`
- Translate payloads to interaction commands.
- No writes to `customer_activities` table.
- Response includes deprecation headers (`Deprecation`, `Sunset`) and migration docs link.

#### `GET /api/customers/todos`
- Backed by `customer_interactions` filter:
  - interaction types classified as actionable,
  - include done/open status compatibility fields.
- Response includes deprecation headers (`Deprecation`, `Sunset`) and migration docs link.

#### `POST/PUT/DELETE /api/customers/todos`
- Translate payloads to interaction commands.
- `todoSource` retained as optional compatibility field, no longer used as provider delegate in new writes.
- No writes to `customer_todo_links` table.
- Response includes deprecation headers (`Deprecation`, `Sunset`) and migration docs link.

### Detail endpoint include tokens
- Add `include=interactions`.
- Keep `include=activities` and `include=todos|tasks` as filtered views over interactions.
- Existing include tokens are preserved in this release (additive-only API change).

## Internationalization (i18n)
New keys:
- `customers.interactions.*` for list/form/status/actions/errors.
- Deprecation helper keys for legacy tasks/activities labels.
- Next interaction computed-state labels (`derived`, `no_open_interactions`).

## UI/UX
### Customer detail pages
- Replace separate data backends for Tasks and Activities with one interaction source.
- Transitional UI (recommended):
  - Keep tabs `Activities` and `Tasks` for familiarity,
  - both read from interactions with different default filters.
- Remove manual `onNextInteractionSave` editing control.
- Show computed next interaction badge with link to source interaction.

### Global customer tasks page (`/backend/customer-tasks`)
- Keep route name for compatibility.
- Back by interactions filtered to actionable types.

### Dashboard widgets
- `next-interactions` widget continues reading projection fields.
- `customer-todos` widget queries interactions filtered as actionable.

## Configuration
- Feature flag: `customers.interactions.unified` (default off in first release, on by default after migration validation).
- Feature flag: `customers.interactions.legacy-adapters` (default on during transition, removable later).

## Migration & Compatibility
### Backward compatibility contract
This spec follows the deprecation protocol for contract surfaces (API routes, response shapes, includes, and schema):
1. Do not remove legacy APIs or legacy tables in this release.
2. Mark legacy adapters as deprecated in docs and response headers.
3. Keep adapter bridge for at least one minor release.
4. Document migration in `RELEASE_NOTES.md`.
5. Prepare follow-up removal spec for legacy surfaces in a later release.

### Migration plan
1. Create `customer_interactions`.
2. Backfill from `customer_activities`:
   - map `activity_type` -> `interaction_type`
   - map `occurred_at` and metadata fields
   - set `status = done` when `occurred_at` is set, otherwise `planned`.
3. Backfill from `customer_todo_links`:
   - resolve linked todo records using query engine where possible,
   - map title/status/due/priority/severity to interaction fields,
   - set `source = migration:todo_link`.
4. Recompute `next_interaction_*` for all customer entities.
5. Enable compatibility adapters.
6. Switch UI to canonical interactions API.
7. Freeze legacy tables to read-only compatibility/audit role; do not drop in this release.
8. Publish deprecation timeline and release notes, then schedule dedicated legacy-removal spec for a later release.

### Next interaction derivation algorithm
Given all interactions for one `entity_id`:
1. Candidate set = `status = planned` and `scheduled_at IS NOT NULL`.
2. Sort by:
   - `scheduled_at ASC`,
   - `priority DESC NULLS LAST`,
   - `created_at ASC`,
   - `id ASC` (deterministic tie-break).
3. First row becomes projection:
   - `next_interaction_at = scheduled_at`
   - `next_interaction_name = interaction_type label or title fallback`
   - `next_interaction_ref_id = interaction.id`
   - icon/color from interaction/dictionary defaults.
4. If no candidate exists, projection fields are set to `NULL`.

## MVP & Future Work
### MVP (this spec)
- Canonical `customer_interactions` data model and commands as the only write source.
- Derived `next_interaction_*` projection maintained on every write.
- Legacy API adapters (`/activities`, `/todos`) preserved with deprecation headers for compatibility.
- Backfill + reconciler rollout with feature flags and integration coverage.

### Future Work (out of scope here)
- Hard removal of legacy APIs (`/customers/activities`, `/customers/todos`) after deprecation window.
- Hard removal/archival strategy for legacy tables in a dedicated breaking-change spec.
- Optional dedicated worker-only mode for very large-tenant projection recompute.

## Implementation Plan
### Phase 1: Domain foundation
1. Add `CustomerInteraction` entity + validator schemas.
2. Add commands + undo support for interaction lifecycle.
3. Add projection recompute service and invoke from commands.

### Phase 2: API and adapters
1. Add `/api/customers/interactions` route with OpenAPI.
2. Add canonical cancel/delete operations (`POST /interactions/cancel`, `DELETE /interactions`).
3. Re-implement `/api/customers/activities` as deprecated adapter (headers + translation to interaction commands).
4. Implement `/api/customers/todos` as deprecated adapter (headers + translation to interaction commands).
5. Enforce `limit <= 100` and keyset cursor contract on canonical list endpoint.

### Phase 3: UI migration
1. Update people/company detail pages to fetch interactions.
2. Refactor TasksSection and ActivitiesSection hooks to shared interactions client.
3. Remove manual next-interaction editing controls from highlights.

### Phase 4: Dashboard and list views
1. Update customer todos table query source to interactions.
2. Validate next interactions widget correctness with derived projection.

### Phase 5: Data migration and rollout
1. Generate DB migration via `yarn db:generate` (no hand-written migration files).
2. Run recompute and consistency checks.
3. Enable feature flag progressively.
4. Publish release notes with deprecation timeline and adapter sunset target.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/customers/data/entities.ts` | Modify | Add `CustomerInteraction`; deprecate old references |
| `packages/core/src/modules/customers/data/validators.ts` | Modify | Add interaction schemas and compatibility schemas |
| `packages/core/src/modules/customers/commands/interactions.ts` | Create | Canonical interaction commands |
| `packages/core/src/modules/customers/commands/todos.ts` | Modify | Convert to adapter behavior |
| `packages/core/src/modules/customers/commands/activities.ts` | Modify | Convert to adapter behavior |
| `packages/core/src/modules/customers/api/interactions/route.ts` | Create | Canonical interactions CRUD API |
| `packages/core/src/modules/customers/api/activities/route.ts` | Modify | Compatibility adapter |
| `packages/core/src/modules/customers/api/todos/route.ts` | Create/Restore | Compatibility adapter over interactions |
| `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx` | Modify | Remove manual next edit, load interactions |
| `packages/core/src/modules/customers/backend/customers/companies/[id]/page.tsx` | Modify | Remove manual next edit, load interactions |
| `packages/core/src/modules/customers/components/detail/hooks/usePersonTasks.ts` | Modify | Use interactions API |
| `packages/core/src/modules/customers/components/detail/*Activities*` | Modify | Use interactions API |
| `packages/core/src/modules/customers/api/dashboard/widgets/next-interactions/route.ts` | Modify | Ensure projection contract stays stable |
| `packages/core/src/modules/customers/migrations/<generated>.ts` | Generate | DB schema/backfill generated by `yarn db:generate` |
| `RELEASE_NOTES.md` | Modify | Add deprecation notice and migration timeline for legacy endpoints |

### Integration Test Coverage (required)
API paths:
1. `GET/POST/PUT/DELETE /api/customers/interactions`
2. `POST /api/customers/interactions/complete`
3. `POST /api/customers/interactions/cancel`
4. `GET/POST/PUT/DELETE /api/customers/activities` (deprecated adapter + headers)
5. `GET/POST/PUT/DELETE /api/customers/todos` (deprecated adapter + headers)
6. `GET /api/customers/dashboard/widgets/next-interactions`
7. `GET /api/customers/people/{id}?include=activities,todos,interactions`
8. `GET /api/customers/companies/{id}?include=activities,todos,interactions`
9. Cursor pagination contract on `GET /api/customers/interactions` (`limit <= 100`, `nextCursor`)
10. Verify legacy adapter writes do not persist to legacy tables

Key UI paths:
1. `/backend/customers/people/[id]` (tabs: tasks/activities)
2. `/backend/customers/companies/[id]` (tabs: tasks/activities)
3. `/backend/customer-tasks`
4. Dashboard widget: next interactions

## Risks & Impact Review
### Data Integrity Failures
Risk of projection drift if interaction write succeeds but projection update fails. Mitigation: same transaction where possible + async reconciler.

### Cascading Failures & Side Effects
Search/index and dashboard widgets depend on current fields. Mitigation: preserve projection schema and legacy APIs until migration completes.

### Tenant & Data Isolation Risks
Unified table increases blast radius of query bugs. Mitigation: enforce tenant/org filters in every command and route; add integration tests for cross-tenant isolation.

### Migration & Deployment Risks
Backfill from provider-linked todos may be partial if provider records are missing. Mitigation: mark partial migrations with source and fallback title; keep old tables for audit window.

### Operational Risks
Large tenants may face expensive initial recompute. Mitigation: batch recompute job with checkpoints and resumable cursor.

### Risk Register
#### Projection Drift on Write
- **Scenario**: interaction is written, but `next_interaction_*` fields are not updated because of partial failure.
- **Severity**: High
- **Affected area**: dashboard next interactions, list sorting/filtering.
- **Mitigation**: transactional update path and scheduled `recompute_next` repair job.
- **Residual risk**: short-lived inconsistency before repair job.

#### Incomplete Todo Backfill
- **Scenario**: linked provider todo record cannot be resolved during migration.
- **Severity**: Medium
- **Affected area**: migrated task details accuracy.
- **Mitigation**: fallback interaction with minimal metadata and migration markers.
- **Residual risk**: some historic fields (priority/custom) may be missing.

#### Legacy Client Contract Break
- **Scenario**: existing UI/client expects old todo/activity payload shape.
- **Severity**: High
- **Affected area**: customer detail tabs, custom integrations.
- **Mitigation**: adapter routes preserve response shape during transition.
- **Residual risk**: unknown third-party clients may rely on undocumented fields.

#### Premature Legacy Removal
- **Scenario**: removing legacy APIs/tables in the same release breaks existing clients and violates BC contract.
- **Severity**: Critical
- **Affected area**: external integrations, extension modules, upgrade safety.
- **Mitigation**: keep adapter bridge for >=1 minor, mark deprecated, and defer removals to dedicated follow-up spec.
- **Residual risk**: temporary maintenance overhead during deprecation window.

#### Query Cost Regression
- **Scenario**: canonical interactions queries become heavier than split-table queries.
- **Severity**: Medium
- **Affected area**: detail pages and work-plan list latency.
- **Mitigation**: dedicated indexes and strict page-size caps.
- **Residual risk**: hotspots for very large tenants until tuning.

## Final Compliance Report — 2026-02-27

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | No direct ORM relationships between modules | Compliant | Interactions remain inside customers module; external links are IDs only |
| root `AGENTS.md` | Filter by `organization_id` for tenant-scoped entities | Compliant | Included in model, API, and command requirements |
| root `AGENTS.md` | API routes MUST export `openApi` | Compliant | Required for new interactions route and adapters |
| root `AGENTS.md` | Undoability is default for state changes | Compliant | Commands defined with undo contracts |
| root `AGENTS.md` | Backward-compatibility deprecation protocol | Compliant | Legacy APIs/tables bridged for >=1 minor; removal deferred to follow-up spec |
| root `AGENTS.md` | Database schema is additive-only | Compliant | No table drop in this release |
| root `AGENTS.md` | Keep `pageSize` at or below 100 | Compliant | Canonical list contract enforces `limit <= 100` |
| root `AGENTS.md` | Never hand-write migrations | Compliant | Migration files generated via `yarn db:generate` |
| `.ai/specs/AGENTS.md` | Include required spec sections | Compliant | All mandatory sections included |
| `customers/AGENTS.md` | Use customers module CRUD patterns | Compliant | Commands/routes follow existing customers conventions |
| `packages/ui/AGENTS.md` | Non-`CrudForm` writes use guarded mutation | Compliant | UI migration section requires existing guarded mutation patterns for adapter writes |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Canonical interaction fields are reflected in API section |
| API contracts match UI/UX section | Pass | UI consumes interactions; legacy routes retained |
| Risks cover all write operations | Pass | Create/update/complete/cancel/delete and migration risks covered |
| Commands defined for all mutations | Pass | Full mutation set listed |
| Cache/projection strategy covers read APIs | Pass | `next_interaction_*` remains read projection |
| Backward-compatibility contract is explicit | Pass | Deprecation protocol and release-note requirement documented |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved for implementation planning.

## Changelog
### 2026-02-27 (rev 2)
- Switched rollout strategy to bridge mode: legacy APIs remain as deprecated adapters for >=1 minor release.
- Removed legacy table drop from this release scope; marked as follow-up removal spec.
- Added explicit backward-compatibility protocol section (deprecation headers, release notes, timeline).
- Extended canonical API contract with `cancel`/`delete`, cursor pagination, and `limit <= 100`.
- Updated test coverage plan to validate deprecation headers and no writes to legacy tables.
- Expanded compliance matrix to include BC contract, additive schema rule, generated migrations, and UI guarded-mutation rules.

### 2026-02-27
- Initial specification for unifying customer activities and tasks into one interaction model.
- Added derived `next interaction` algorithm and migration strategy.

### Review — 2026-02-27
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
