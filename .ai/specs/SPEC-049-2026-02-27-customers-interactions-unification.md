# SPEC-049: Customers Interactions Unification

## TLDR
**Key Points:**
- Replace split model (`activities` + external `todo links` + manual `next interaction`) with one first-class object: `CustomerInteraction`.
- Compute `next interaction` automatically from the nearest open interaction date.
- Keep existing API paths (`/customers/activities`, `/customers/todos`) as deprecated adapter bridges for at least one minor release.
- Move external task providers (e.g., Trello) to UMES extension sync around canonical interactions, not into the core write path.

**Scope:**
- New `customer_interactions` entity and CRUD API.
- Automatic projection of next interaction onto `customer_entities.next_interaction_*`.
- UI migration of Tasks/Activities to one interaction backend.
- Data migration from `customer_activities` and `customer_todo_links`.
- Legacy endpoints stay available as compatibility adapters; no legacy table drops in this spec.
- UMES-ready integration contract: external ID mapping + event-driven outbound/inbound sync with idempotency.

**Concerns:**
- Migration quality when old todo providers are unavailable.
- Backward compatibility for existing clients and UI hooks.
- Temporary dual-contract maintenance (canonical + legacy adapters) during the deprecation window.
- Preventing sync loops and duplicate objects when external providers are enabled.

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
3. Tasks currently depend on provider delegation (`todoSource` -> `<module>.todos.create`), coupling core CRM writes to provider availability.
4. Dashboard "next interactions" reads from manual fields, not from source-of-truth action items.
5. Existing provider model conflicts with UMES direction where integrations extend core behavior via enrichers/interceptors/subscribers instead of owning primary core persistence.

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
6. External providers are optional mirrors implemented as UMES/integration extensions; `customer_interactions` is the only source-of-truth in OM core.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Keep `next_interaction_*` columns as projection | Avoid breaking existing list filters/widgets and keep fast reads |
| Add one canonical interaction table | Remove conceptual split and provider coupling |
| Keep old APIs as adapters for >=1 minor | Comply with backward-compatibility contract while moving all new domain writes to canonical commands |
| Compute projection synchronously on writes + background reconciler | Immediate UX consistency with recovery safety net |
| Keep legacy tables additive/read-only in this release | Schema removals are not allowed in the same release under repo BC rules |
| Use UMES extension sync for external systems | Preserves provider extensibility (Trello, etc.) without making provider calls part of core transaction |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Keep split model and add stronger UI hints | Does not remove data drift; still cognitively expensive |
| Remove projection columns, compute next on every read | Heavier queries on high-volume lists/widgets |
| Keep provider-linked todos as primary model | Preserves indirection and complexity causing current confusion |
| Make external provider authoritative (core as mirror) | Breaks offline/local reliability and makes CRM unusable when provider is unavailable |

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
4. Events emitted for indexing/audit/integration hooks (`customers.interaction.*`).

Read path:
1. Detail pages query interactions directly.
2. Legacy endpoints map to filtered interaction queries.
3. Dashboard next interactions reads projection fields (kept current by write path and reconciler).

### UMES Integration Model (Post-SPEC-041)
Authoritative model:
1. OM core persists canonical `customer_interactions`.
2. Integration modules observe interaction events and optionally sync to external providers.
3. External references are stored as mappings (e.g., `sync_external_id_mappings`) keyed by `integrationId + entityType(customers.interaction) + localId`.

Outbound sync (OM -> provider):
1. `customers.interaction.created|updated|completed|canceled|deleted` event is emitted.
2. Integration subscriber enqueues provider sync job (never blocks core transaction).
3. Job upserts provider object (e.g., Trello card), then upserts mapping row idempotently.

Inbound sync (provider -> OM):
1. Integration webhook/worker resolves mapping by `integrationId + externalId`.
2. If mapping exists, apply canonical interaction command (`update|complete|cancel`).
3. If mapping does not exist and policy allows, create canonical interaction then mapping.
4. Tag mutation metadata with `_syncOrigin=<integrationId>`; outbound subscriber skips same-origin events to prevent loops.

Conflict policy:
1. Core fields (`status`, `scheduledAt`, `occurredAt`) use last-write-wins with source timestamp.
2. Provider-specific fields stay in extension namespace (`_integrations.<integrationId>.*`) via enrichers.
3. If conflict cannot be auto-resolved, keep core state and record integration warning for manual resolution.

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
  - `customers.interaction.deleted`
  - `customers.next_interaction.updated`

### Transaction & Undo Contract
Write atomicity:
1. Canonical interaction mutation + projection recompute run in one DB transaction.
2. Event enqueue happens after commit (no external provider call inside core transaction).

Undo policy:
1. `create` undo -> hard delete created interaction + recompute projection.
2. `update` undo -> restore previous mutable fields + recompute projection.
3. `complete`/`cancel` undo -> restore previous status/timestamps + recompute projection.
4. `delete` undo -> restore interaction snapshot + recompute projection.

External side effects:
1. Provider sync is asynchronous and not part of command transaction.
2. Undo does not synchronously call provider APIs; instead emits compensating lifecycle event and lets extension workers converge state.
3. Failed provider compensation is retried and surfaced as integration warning, without rolling back canonical core state.

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

### External Mapping (UMES/Integrations)
- Use integration mapping storage (per SPEC-045b / SPEC-041l pattern) to link `customer_interactions.id` to external task IDs.
- Mapping records are additive and tenant/org scoped; they do not duplicate interaction business state.
- Canonical interaction payload is provider-agnostic; provider-specific metadata is exposed via enrichers (`_integrations` namespace).

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
- Notes:
  - No provider-specific required fields in canonical contract.
  - Extension sync runs asynchronously through event subscribers/queues.

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

### UMES integration response contract
- Detail/list endpoints MAY include enriched integration data under `_integrations`.
- Canonical shape remains stable even when no integrations are installed.
- Example namespace:
  - `_integrations.trello.externalId`
  - `_integrations.trello.externalUrl`
  - `_integrations.trello.syncStatus`
  - `_integrations.trello.lastSyncedAt`

### Security & Validation Contract
1. Every request body/query for canonical and compatibility endpoints is validated with zod before business logic.
2. Route metadata uses declarative guards:
   - read: `requireAuth`, `requireFeatures: ['customers.view']`
   - write: `requireAuth`, `requireFeatures: ['customers.create'|'customers.edit'|'customers.delete']` as applicable
3. Custom write handlers (non-CRUD factory routes like `complete`/`cancel`) must run mutation guard hooks before/after success.
4. Interaction `title`/`body` are treated as plain text; UI rendering forbids unsafe raw HTML injection.
5. Integration secrets/tokens are never stored in interaction payloads and never logged by customers module routes/commands.
6. Error payloads must not reveal provider credentials or internal stack traces.
7. Persistence/query layer uses ORM parameterized queries only; no dynamic SQL string interpolation for user input.
8. External URLs surfaced in `_integrations.*.externalUrl` must be validated and encoded before rendering/navigation.

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

### UMES extension widgets (optional)
- Integration status badges (SPEC-041l) can expose per-provider health.
- External ID mapping widget can show linked provider object for an interaction/customer.
- Disabling an integration extension does not remove local interactions.

## Configuration
- Feature flag: `customers.interactions.unified` (default off in first release, on by default after migration validation).
- Feature flag: `customers.interactions.legacy-adapters` (default on during transition, removable later).
- Feature flag: `customers.interactions.external-sync` (default off; enabled per integration rollout).

## Performance & Cache Strategy
### Query and N+1 Strategy
1. `GET /api/customers/interactions` uses keyset pagination and returns at most `100` rows per request.
2. List endpoint target query budget:
   - 1 query for interaction rows,
   - 1 optional dictionary join/batch lookup for type labels,
   - 1 optional enrichment batch query (`enrichMany`) when integrations are enabled.
3. Detail endpoint with `include=interactions` fetches interactions in one scoped query; no per-row provider lookups.
4. Integration mapping enrichment must use batch lookup (`enrichMany`) to avoid N+1 across list responses.

### Cache Policy
1. MVP introduces no mandatory new cache layer; correctness-first path is direct DB reads plus projection columns.
2. If endpoint-level cache is enabled later, keys/tags must include tenant and organization scope.
3. Recommended invalidation tags:
   - `customers:interaction:entity:<entityId>`
   - `customers:next-interaction:entity:<entityId>`
   - `customers:interaction:list:<tenantId>:<organizationId>`
   - `integrations:interaction-mapping:<integrationId>:<tenantId>:<organizationId>`
4. Every interaction write invalidates entity and list tags in the same request cycle.
5. Mapping upsert/delete invalidates related integration mapping tags and affected detail/list tags.
6. Cache TTL is N/A in MVP (no new read cache enabled); when enabled later, default TTL must be explicit per endpoint.
7. Cache miss behavior in MVP is direct scoped DB read (no stale fallback response).

### Heavy Operation Threshold
1. Backfill and recompute jobs touching >1000 interaction rows run in workers.
2. Foreground request path is limited to single-interaction mutations and bounded list reads.

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
4. For resolvable external links, upsert integration mappings to canonical interaction IDs (idempotent).
5. Recompute `next_interaction_*` for all customer entities.
6. Enable compatibility adapters.
7. Switch UI to canonical interactions API.
8. Freeze legacy tables to read-only compatibility/audit role; do not drop in this release.
9. Enable outbound sync per integration after backfill validation to avoid duplicate provider objects.
10. Publish deprecation timeline and release notes, then schedule dedicated legacy-removal spec for a later release.

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
- UMES-compatible sync contract for external providers (async, idempotent, non-blocking).

### Future Work (out of scope here)
- Hard removal of legacy APIs (`/customers/activities`, `/customers/todos`) after deprecation window.
- Hard removal/archival strategy for legacy tables in a dedicated breaking-change spec.
- Optional dedicated worker-only mode for very large-tenant projection recompute.
- Provider-specific setup wizards/status dashboards beyond baseline sync contract (delivered by integration modules).

## Implementation Plan
### Phase 1: Domain foundation
1. Add `CustomerInteraction` entity + validator schemas.
2. Add commands + undo support for interaction lifecycle.
3. Add projection recompute service and invoke from commands.
4. Register services in customers `di.ts` (recompute service, interaction repository helpers).

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

### Phase 5: UMES integration bridge
1. Emit full interaction lifecycle events (including `deleted`) for sync subscribers.
2. Add integration enricher contract for `_integrations` payload on interaction-aware endpoints.
3. Implement sync subscriber/webhook reference flow with `_syncOrigin` loop protection.
4. Ensure integration failures are non-blocking for canonical writes (queue + retry).

### Phase 6: Data migration and rollout
1. Generate DB migration via `yarn db:generate` (no hand-written migration files).
2. Backfill interaction + mapping data and run recompute/consistency checks.
3. Enable feature flags progressively.
4. Publish release notes with deprecation timeline and adapter sunset target.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/customers/data/entities.ts` | Modify | Add `CustomerInteraction`; deprecate old references |
| `packages/core/src/modules/customers/data/validators.ts` | Modify | Add interaction schemas and compatibility schemas |
| `packages/core/src/modules/customers/di.ts` | Modify | Register interaction services via DI container |
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
| `packages/core/src/modules/customers/events.ts` | Modify | Ensure full lifecycle events (including `deleted`) for integration hooks |
| `packages/core/src/modules/integrations/data/enrichers.ts` | Modify | Add `_integrations` mapping enrichment for interaction-backed views |
| `packages/core/src/modules/<integration>/subscribers/*interaction*` | Create | Outbound sync subscriber from interaction events |
| `packages/core/src/modules/<integration>/workers/*sync*` | Create | Provider sync workers with retry/idempotency |
| `packages/core/src/modules/<integration>/api/post/webhooks/*` | Create | Inbound provider updates mapped to canonical interaction commands |
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
11. Verify interaction lifecycle events trigger integration sync enqueue (when extension enabled)
12. Verify inbound provider webhook update is idempotent and loop-safe (`_syncOrigin` guard)
13. Verify `_integrations` enrichment appears when mapping exists and is absent when extension disabled
14. Verify write routes reject invalid payloads with zod validation errors
15. Verify write routes enforce `requireFeatures` guards for unauthorized users
16. Verify list/detail enrichment remains N+1-safe under 100-row page

Key UI paths:
1. `/backend/customers/people/[id]` (tabs: tasks/activities)
2. `/backend/customers/companies/[id]` (tabs: tasks/activities)
3. `/backend/customer-tasks`
4. Dashboard widget: next interactions
5. Integration status badge and external mapping section (if extension installed)

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

#### Sync Loop / Duplicate External Objects
- **Scenario**: outbound sync triggers inbound webhook that re-triggers outbound sync, creating loop or duplicates.
- **Severity**: High
- **Affected area**: external provider data quality, queue load.
- **Mitigation**: `_syncOrigin` tag, idempotent mapping upserts, dedupe keys in queue jobs.
- **Residual risk**: provider-side eventual consistency may still create short-lived duplicate attempts.

#### Provider Outage Affecting Core Writes
- **Scenario**: provider API outage during sync attempts.
- **Severity**: High
- **Affected area**: integration freshness.
- **Mitigation**: async non-blocking sync with retries; core interaction write succeeds independently.
- **Residual risk**: delayed external consistency until provider recovery.

#### Mapping Drift
- **Scenario**: local interaction exists but external mapping is stale or missing.
- **Severity**: Medium
- **Affected area**: deep links/status rendering for integrated providers.
- **Mitigation**: periodic reconciliation worker and missing-mapping repair flow.
- **Residual risk**: stale badge/status until next successful reconcile.

## Final Compliance Report — 2026-02-28

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/events/AGENTS.md`

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
| root `AGENTS.md` | Module isolation via events, not direct cross-module coupling | Compliant | UMES sync uses subscribers/enrichers + mapping IDs, not direct provider coupling in core commands |
| root `AGENTS.md` | Validate all inputs with zod | Compliant | Security contract requires zod validation for canonical + compatibility routes |
| root `AGENTS.md` | Prefer declarative guards (`requireAuth`, `requireFeatures`) | Compliant | Security contract defines route guard matrix for read/write |
| `.ai/specs/AGENTS.md` | Include required spec sections | Compliant | All mandatory sections included |
| `customers/AGENTS.md` | Use customers module CRUD patterns | Compliant | Commands/routes follow existing customers conventions |
| `packages/ui/AGENTS.md` | Non-`CrudForm` writes use guarded mutation | Compliant | UI migration section requires existing guarded mutation patterns for adapter writes |
| `packages/events/AGENTS.md` | Event-driven side effects and durable subscribers | Compliant | External sync flows are event-driven and retryable by worker/subscriber design |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Canonical interaction fields are reflected in API section |
| API contracts match UI/UX section | Pass | UI consumes interactions; legacy routes retained |
| Risks cover all write operations | Pass | Create/update/complete/cancel/delete and migration risks covered |
| Commands defined for all mutations | Pass | Full mutation set listed |
| Cache/projection strategy covers read APIs | Pass | `next_interaction_*` remains read projection |
| Backward-compatibility contract is explicit | Pass | Deprecation protocol and release-note requirement documented |
| UMES integration path preserves core source-of-truth | Pass | External providers are extensions around canonical interactions |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved for implementation planning.

## Changelog
### 2026-02-28 (rev 3)
- Reframed spec as UMES-native: canonical interactions remain core source-of-truth, providers become optional extension mirrors.
- Added integration contract for outbound/inbound sync (events, queue retries, idempotent mapping upserts, `_syncOrigin` loop protection).
- Added external mapping/enrichment model (`_integrations` namespace) aligned with integration specs.
- Expanded phases, file manifest, tests, risks, and compliance to include UMES integration behavior.
- Added explicit transaction/undo contract and non-blocking external side-effect compensation model.
- Added explicit security/validation contract (`zod`, guards, mutation guard hooks, XSS-safe rendering constraints).
- Added performance/cache section with N+1 expectations, tenant-scoped invalidation tags, and worker thresholds.

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

### Review — 2026-02-28
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
