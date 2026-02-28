# SPEC-050: Example Module UMES Alignment for Customer Tasks

## TLDR
**Key Points:**
- Keep `example` as a self-contained demo module (`example.todo`), but remove its implicit role as customers task provider.
- Move customer-task synchronization to an explicit UMES-style extension module around canonical `customer_interactions` from `SPEC-049-2026-02-27-customers-interactions-unification.md`.
- Make `/backend/customer-tasks` owned by customers domain, so it works even when `example` is disabled.

**Scope:**
- Define module boundary split: `example` (demo domain) vs `example_customers_sync` (cross-module extension behavior).
- Add event-driven sync contract between `customers.interaction.*` and `example.todo.*` with idempotent mapping.
- Add compatibility plan so no task drift is introduced during transition.

**Concerns:**
- Avoiding sync loops and duplicate objects when bidirectional sync is enabled.
- Preserving backward compatibility for existing `example` routes and data.

## Overview
`example` currently mixes two responsibilities:
1. A standalone demo module (`example.todo`, demo pages/widgets/APIs).
2. A de facto customers task provider role in legacy flows (`todoSource`, `customer_todo_links`, `/backend/customer-tasks` route placement in `example`).

After `SPEC-049-2026-02-27-customers-interactions-unification.md`, customers tasks become canonical `customer_interactions`. Keeping cross-module task-provider behavior inside `example` as an implicit provider creates unclear ownership and upgrade risk.

This spec aligns `example` with UMES by separating concerns:
- `example` remains demo/self-contained.
- Customer-task integration becomes explicit extension logic (`example_customers_sync`) around customers core events and contracts.

> **Market Reference**: Open ecosystems (Shopify apps, Odoo addons, Medusa providers) separate core domain ownership from connector/extensions. We adopt the same split: canonical domain in core, optional sync via extension modules.

## Problem Statement
1. `example` currently couples demo module lifecycle with customer-task behavior.
2. Disabling `example` risks removing behavior users perceive as core (`/backend/customer-tasks` placement).
3. Legacy provider delegation (`todoSource -> example.todos.create`) is opposite to UMES direction (core + extension side effects).
4. Cross-module logic in a demo module blurs maintenance boundaries and release ownership.
5. Without explicit mapping/sync contract, bidirectional updates can drift or loop.

## Proposed Solution
Introduce a dedicated extension module `example_customers_sync` and redefine responsibilities:

1. `customers` owns canonical tasks/interactions and `/backend/customer-tasks`.
2. `example` owns only its own todo demo domain and demo UI.
3. `example_customers_sync` subscribes to events and syncs between canonical interactions and `example.todos` as optional behavior.
4. Sync uses explicit mapping rows (1:1 interaction <-> todo) with idempotency and loop guards.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Create separate `example_customers_sync` module | Makes cross-module behavior explicit and optional |
| Keep `example.todo` API unchanged | Preserves demo module value and BC |
| Customers owns `/backend/customer-tasks` | Prevents route/functionality loss when `example` is disabled |
| Event-driven async sync | No provider calls in customers write transaction |
| Dedicated mapping table in sync module | Simple OSS path without hard dependency on integrations hub rollout timing |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Keep all behavior inside `example` | Continues ownership ambiguity and coupling |
| Make `example.todo` authoritative and mirror to customers | Conflicts with SPEC-049 canonical interaction model |
| Hard-delete old route and flows in one release | Breaks compatibility for existing setups |

## User Stories / Use Cases
- **CRM user** wants customer tasks to work even if demo module is disabled.
- **Developer** wants `example` to remain a clean reference module without hidden production coupling.
- **Integrator** wants optional sync behavior through explicit extension contracts and events.
- **Admin** wants safe rollout with fallback and reconciliation if sync fails.

## Architecture
### Module Boundaries
| Module | Owns | Does Not Own |
|--------|------|--------------|
| `customers` | `customer_interactions`, next-interaction projection, `/backend/customer-tasks` | Example todo persistence |
| `example` | `example.todo` CRUD/UI/events, demo widgets | Customers task domain semantics |
| `example_customers_sync` | Cross-module mapping + sync workers/subscribers | Primary source-of-truth for either domain |

### Data Flow
Outbound (customers -> example):
1. `customers.interaction.created|updated|completed|canceled|deleted` emitted.
2. `example_customers_sync` subscriber enqueues sync job.
3. Worker upserts/deletes `example.todo`.
4. Worker upserts mapping row idempotently.

Inbound (example -> customers):
1. `example.todo.updated|deleted` emitted.
2. `example_customers_sync` resolves mapping.
3. Worker executes canonical customers command (`update|complete|cancel|delete`) as needed.
4. `_syncOrigin` metadata prevents bounce-loop.

### Sync Rules
1. Canonical business status lives in `customer_interactions`.
2. Example-specific task decorations can live in `example.todo` custom fields.
3. For collisions, core fields use last-write-wins with source timestamp.
4. If conflict is not auto-resolvable, keep customers state and mark mapping as `error`.

### Commands & Events
- **Commands** (`example_customers_sync`)
  - `example_customers_sync.mapping.upsert`
  - `example_customers_sync.mapping.delete`
  - `example_customers_sync.sync.from_interaction`
  - `example_customers_sync.sync.from_todo`
  - `example_customers_sync.reconcile`
- **Events consumed**
  - `customers.interaction.created`
  - `customers.interaction.updated`
  - `customers.interaction.completed`
  - `customers.interaction.canceled`
  - `customers.interaction.deleted`
  - `example.todo.created`
  - `example.todo.updated`
  - `example.todo.deleted`
- **Events emitted**
  - `example_customers_sync.mapping.created`
  - `example_customers_sync.mapping.updated`
  - `example_customers_sync.mapping.deleted`
  - `example_customers_sync.sync.failed`

### Transaction, Idempotency, and Compensation Contract
1. `example_customers_sync.mapping.upsert`:
   - idempotent by unique keys `(org, tenant, interaction_id)` and `(org, tenant, todo_id)`,
   - on retry, same input must converge to one mapping row.
2. `example_customers_sync.mapping.delete`:
   - idempotent delete (safe if row already missing),
   - optional compensation path restores mapping from snapshot when invoked by replay tooling.
3. `example_customers_sync.sync.from_interaction` and `example_customers_sync.sync.from_todo`:
   - never run in customers/example core write transaction,
   - on failure set mapping `sync_status='error'`, persist `last_error`, emit `example_customers_sync.sync.failed`,
   - retries must not create duplicate todos/interactions.
4. `example_customers_sync.reconcile`:
   - operational command (no business undo requirement),
   - safe to rerun with cursor/idempotency key.
5. External side effects are eventually consistent:
   - canonical writes remain committed even if sync fails,
   - reconciliation/worker retries provide compensation to convergence.

## Data Models
### ExampleCustomerInteractionMapping (Singular)
New table: `example_customer_interaction_mappings`

- `id`: UUID PK
- `organization_id`: UUID, required
- `tenant_id`: UUID, required
- `interaction_id`: UUID, required (FK ID reference to customers interaction; no cross-module ORM relation)
- `todo_id`: UUID, required (FK ID reference to example todo; no cross-module ORM relation)
- `sync_status`: text enum (`synced`, `pending`, `error`), required
- `last_synced_at`: timestamptz, nullable
- `last_error`: text, nullable
- `source_updated_at`: timestamptz, nullable
- `created_at`: timestamptz
- `updated_at`: timestamptz

Indexes:
- unique `(organization_id, tenant_id, interaction_id)`
- unique `(organization_id, tenant_id, todo_id)`
- index `(organization_id, tenant_id, sync_status, updated_at)`

## API Contracts
### Existing contracts preserved
1. Keep `/api/example/todos` contract unchanged.
2. Keep customers canonical interactions API from SPEC-049 unchanged.

### New operational endpoints (sync module)
#### `GET /api/example-customers-sync/mappings`
- Query: `interactionId?`, `todoId?`, `cursor?`, `limit?`
- Response: paged mapping rows (`limit <= 100`)
- Guard: `requireAuth`, `requireFeatures: ['example_customers_sync.view']`

#### `POST /api/example-customers-sync/reconcile`
- Body: optional filters (`organizationId`, `tenantId`, `limit`, `cursor`)
- Response: `{ queued: number }`
- Guard: `requireAuth`, `requireFeatures: ['example_customers_sync.manage']`

### Route ownership change
1. Create canonical `/backend/customer-tasks` page in customers module.
2. Remove conflicting `example` page file for the same route in the same release (single owner, no duplicate route registration).
3. Keep backward compatibility at URL level because path stays `/backend/customer-tasks`; only module ownership changes.
4. Mark ownership move in docs/release notes.

## Internationalization (i18n)
New keys:
- `exampleCustomersSync.*` for sync status/errors/reconcile actions.
- Deprecation notice keys for legacy example-owned customer-tasks route.
- Mapping state labels (`synced`, `pending`, `error`, `resolving`).

## UI/UX
1. `/backend/customer-tasks` must be available without `example` module.
2. If `example` is enabled and sync module enabled, task rows can show optional badge:
   - `Synced to Example Todo`
   - link to `/backend/todos/[id]/edit`
3. `example` keeps its own `/backend/todos` UX unchanged.
4. Sync errors surface as non-blocking warning badges/actions in task detail/list.

## Configuration
- Feature flag: `example.customers_sync.enabled` (default `false`)
- Feature flag: `example.customers_sync.bidirectional` (default `false` initially)

### ACL features (new module)
- `example_customers_sync.view`
- `example_customers_sync.manage`

## Migration & Compatibility
### Backward compatibility contract
1. Do not remove `/api/example/todos` or `/backend/todos`.
2. Do not remove `example` module todo schema in this release.
3. Move `/backend/customer-tasks` ownership to customers with no URL change (module/file ownership only).
4. Keep legacy behavior behind feature flags until sync validation passes.
5. Publish deprecation/migration notes in `RELEASE_NOTES.md`.

### Migration plan
1. Create `example_customer_interaction_mappings` table.
2. Add customers-owned `/backend/customer-tasks`.
3. Remove conflicting example page file for `/backend/customer-tasks`.
4. Enable outbound sync first (`customers -> example`) with bidirectional off.
5. Run reconcile job to map/create missing example todos for active interactions.
6. Enable bidirectional sync after validation in staging.
7. Monitor `sync.failed` rate and mapping error backlog before broad enablement.

## Implementation Plan
### Phase 1: Route and ownership decoupling
1. Create `/backend/customer-tasks` in customers module.
2. Remove conflicting `/backend/customer-tasks` page from `example`.
3. Update docs and navigation ownership.

### Phase 2: Sync module foundation
1. Scaffold `example_customers_sync` module (`index.ts`, `di.ts`, `events.ts`, `data/entities.ts`, `data/validators.ts`, `acl.ts`, `setup.ts`).
2. Add mapping entity and zod schemas.
3. Register module in app modules list behind feature flag.
4. Run `npm run modules:prepare` after adding events/subscribers/workers/routes.

### Phase 3: Event-driven sync
1. Add subscribers for customers interaction lifecycle events.
2. Add subscribers for example todo lifecycle events.
3. Add workers with idempotent upsert/delete semantics.
4. Add `_syncOrigin` loop guard handling.

### Phase 4: Operational APIs and UX wiring
1. Add mappings list/reconcile APIs with OpenAPI docs.
2. Add optional sync badges/links in customer tasks UI.
3. Add admin diagnostics for failed mappings.

### Phase 5: Rollout and verification
1. Run reconciliation in staging and validate no drift.
2. Enable outbound sync in production.
3. Enable bidirectional sync after stability criteria are met.

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/customers/backend/customer-tasks/page.tsx` | Create | Canonical customer tasks page ownership |
| `apps/mercato/src/modules/example/backend/customer-tasks/page.tsx` | Delete | Remove duplicate route owner to avoid path collision |
| `apps/mercato/src/modules/example_customers_sync/index.ts` | Create | Module metadata |
| `apps/mercato/src/modules/example_customers_sync/acl.ts` | Create | Feature declarations |
| `apps/mercato/src/modules/example_customers_sync/di.ts` | Create | Service/worker wiring via DI |
| `apps/mercato/src/modules/example_customers_sync/events.ts` | Create | Sync module event declarations |
| `apps/mercato/src/modules/example_customers_sync/data/entities.ts` | Create | Mapping entity |
| `apps/mercato/src/modules/example_customers_sync/data/validators.ts` | Create | zod schemas for APIs/commands |
| `apps/mercato/src/modules/example_customers_sync/subscribers/*` | Create | Cross-module event handlers |
| `apps/mercato/src/modules/example_customers_sync/workers/*` | Create | Retryable sync workers |
| `apps/mercato/src/modules/example_customers_sync/api/get/mappings/route.ts` | Create | Mapping inspection API |
| `apps/mercato/src/modules/example_customers_sync/api/post/reconcile/route.ts` | Create | Reconciliation trigger API |
| `apps/mercato/src/modules.ts` | Modify | Register new extension module |
| `RELEASE_NOTES.md` | Modify | BC/deprecation notes |

### Integration Test Coverage (required)
API paths:
1. `GET /api/customers/interactions` (baseline canonical list still works)
2. `POST /api/customers/interactions` triggers sync enqueue when flag enabled
3. `POST /api/customers/interactions/complete` reflects done status to mapped example todo
4. `DELETE /api/customers/interactions` removes/archives mapped example todo per policy
5. `GET/POST/PUT/DELETE /api/example/todos` still works standalone when sync disabled
6. `GET /api/example-customers-sync/mappings`
7. `POST /api/example-customers-sync/reconcile`
8. Loop-guard test: example update from sync origin does not re-enqueue reverse sync
9. Tenant isolation test: mappings and sync events never cross `organization_id`
10. Feature-disabled test: no sync side effects when `example.customers_sync.enabled=false`

Key UI paths:
1. `/backend/customer-tasks` with `example` enabled
2. `/backend/customer-tasks` with `example` disabled
3. `/backend/customers/people/[id]` tasks/interactions section with sync badges
4. `/backend/todos` (example standalone todo UX remains functional)

## Risks & Impact Review
### Data Integrity Failures
Risk of partial sync state (interaction written, mapping not yet written). Mitigation: idempotent worker retries + reconcile endpoint.

### Cascading Failures & Side Effects
Sync queue failures can delay example todo updates. Mitigation: non-blocking retries and visible sync error state.

### Tenant & Data Isolation Risks
Cross-module mapping bugs could leak references across orgs. Mitigation: strict tenant/org filters in all mapping queries and tests.

### Migration & Deployment Risks
Moving route ownership may confuse docs/navigation assumptions. Mitigation: same URL is preserved and release notes call out ownership change.

### Operational Risks
Bidirectional sync may produce event storms if guards fail. Mitigation: `_syncOrigin` + dedupe keys + alerting on failure rate.

### Risk Register
#### Route Ownership Regression
- **Scenario**: `/backend/customer-tasks` fails when `example` is disabled.
- **Severity**: High
- **Affected area**: daily task planning UX.
- **Mitigation**: customers-owned canonical route + integration test with example disabled.
- **Residual risk**: stale external links to old page variant during transition.

#### Sync Loop
- **Scenario**: customers->example sync triggers example->customers sync repeatedly.
- **Severity**: Critical
- **Affected area**: queue load, duplicate updates, data stability.
- **Mitigation**: `_syncOrigin` marker, dedupe job keys, idempotent mapping updates.
- **Residual risk**: short-lived duplicate attempts under concurrent retries.

#### Duplicate Todo Creation
- **Scenario**: concurrent workers create multiple todos for one interaction.
- **Severity**: High
- **Affected area**: example todo list quality.
- **Mitigation**: unique mapping constraints + upsert-first lookup + transactional mapping writes.
- **Residual risk**: manual cleanup needed for already-created duplicates before constraint enforcement.

#### Mapping Drift
- **Scenario**: todo deleted manually, mapping still points to missing record.
- **Severity**: Medium
- **Affected area**: sync badge/link reliability.
- **Mitigation**: reconcile API/worker and periodic repair scans.
- **Residual risk**: temporary stale UI indicators.

#### Provider-like Failure Coupling
- **Scenario**: example sync worker outage blocks customers writes.
- **Severity**: High
- **Affected area**: perceived system reliability.
- **Mitigation**: strict async boundary; customers command transactions never depend on sync worker success.
- **Residual risk**: eventual consistency delay until workers recover.

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
| root `AGENTS.md` | No direct ORM relationships between modules | Compliant | Mapping table stores FK IDs only (`interaction_id`, `todo_id`) |
| root `AGENTS.md` | Filter by `organization_id` for tenant-scoped entities | Compliant | Mapping model and sync APIs require tenant/org scope |
| root `AGENTS.md` | Validate all inputs with zod | Compliant | Sync APIs/commands require zod validators |
| root `AGENTS.md` | API routes MUST export `openApi` | Compliant | New sync operational routes include OpenAPI docs |
| root `AGENTS.md` | Undoability default for state changes | Compliant | Sync commands are idempotent and compensating via events/reconcile |
| root `AGENTS.md` | Keep pageSize at or below 100 | Compliant | Mapping list endpoint enforces `limit <= 100` |
| root `AGENTS.md` | Backward-compatibility deprecation protocol | Compliant | `/backend/customer-tasks` URL remains stable; ownership moves to customers without route removal |
| `packages/core/AGENTS.md` | Event declarations in `events.ts` with `as const` | Compliant | Sync and customers events explicitly declared |
| `packages/core/AGENTS.md` | Run `npm run modules:prepare` after event/subscriber changes | Compliant | Explicit implementation step added in Phase 2 |
| `packages/events/AGENTS.md` | Persistent subscribers must be idempotent | Compliant | Sync workers/subscribers use mapping upsert + dedupe keys |
| `customers/AGENTS.md` | Follow customers CRUD/UI patterns | Compliant | Customer tasks page ownership moved to customers module conventions |
| `packages/ui/AGENTS.md` | Use guarded mutations for non-`CrudForm` writes | Compliant | Any custom sync-trigger UI actions must use guarded mutation path |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Mapping entity aligns with list/reconcile API surfaces |
| API contracts match UI/UX section | Pass | Route ownership and sync badge behavior align with APIs |
| Risks cover all write operations | Pass | Interaction writes, todo writes, reconcile writes covered |
| Commands defined for all mutations | Pass | Upsert/delete/sync/reconcile command set defined |
| Cache strategy covers all read APIs | Pass | No mandatory new cache; scoped DB reads and limits defined |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved — ready for implementation planning.

## Changelog
### 2026-02-28 (rev 2)
- Removed conflicting dual-owner route strategy for `/backend/customer-tasks`; defined single ownership in customers module.
- Added explicit idempotency/compensation contract for sync commands and side effects.
- Split sync module ACL from `example.todos.*` to `example_customers_sync.*`.
- Added required `npm run modules:prepare` step for generator registration after event/subscriber changes.
- Clarified explicit dependency on `SPEC-049-2026-02-27-customers-interactions-unification.md`.

### 2026-02-28
- Initial specification for splitting `example` demo ownership from customers task integration behavior.
- Added UMES-aligned sync extension design (`example_customers_sync`) with explicit mapping, loop guards, and route ownership migration.

### Review — 2026-02-28
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
