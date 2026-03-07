# SPEC-053: B2B PRM Starter

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Open Mercato Team |
| **Created** | 2026-03-02 |
| **Related** | SPEC-052 (Use-Case Starters Framework), SPEC-053a (Matching Data Foundation), SPEC-053b (B2B PRM Operations), SPEC-041 (UMES), SPEC-013 (setup.ts) |

## TLDR
**Key Points:**
- Deliver the first production-grade use-case starter: `b2b_prm`.
- Target companies running partner/channel programs that need onboarding, tiering, KPI tracking, and basic RFP operations.
- Build the PRM foundation (Company Profiles, Tiers) as an **extensible CRM core** that can be reused by other future workflows.
- Build entirely as additive app modules and UMES extensions to keep core architecture stable.

**Scope:**
- Starter profile for B2B Partner Relationship Management.
- Core PRM entities, APIs, role presets, dashboard, and onboarding flow.
- Seeded dictionaries, custom entities, and demo fixtures for fast pilot launch through CLI bootstrap.

**Concerns:**
- Keep boundary between generic core and PRM-specific behavior explicit.
- Keep advanced matching, reconciliation, and commission automation as phased add-ons.

## Detailed Workstream Specs
This document is the parent starter contract. Detailed implementation contracts are split into child specs:

| Workstream | Spec | Purpose |
|------------|------|---------|
| Data foundation workstream (POC prerequisite, API-only) | [SPEC-053a](./SPEC-053a-2026-03-02-b2b-prm-matching-data-phase0-api-only.md) | Detailed company profile + case-study data model and API-only rollout |
| B2B PRM operations (KPI, tier lifecycle, RFP, phased rollout) | [SPEC-053b](./SPEC-053b-2026-03-02-b2b-prm-operations-kpi-rfp.md) | Full operational domain contract with phased API/data details |

## Overview
This starter productizes the partnership operations direction into a reusable launch package. The goal is that an Engineer can initialize OM with `b2b_prm` and get a coherent, demo-ready partner operations system instead of assembling modules manually.

Canonical role set used across this spec family:
- Engineer
- Maintainer
- Partnership Manager,
- Agency Business Developer
- Agency's Contributor

Primary runtime personas:
- Partnership Manager
- Agency Business Developer
- Agency's Contributor

Business outcome:
- shorter implementation cycle for partner program use cases,
- consistent baseline architecture across pilots,
- direct path from PoC to production configuration.

## Problem Statement
Teams currently build PRM repeatedly from scratch:
- inconsistent data model for partner tiers and metrics,
- duplicated setup effort for dictionaries/entities/ACL/workflows,
- weak repeatability across demos and pilots,
- long lead time before customer-visible value.

## Proposed Solution
Create `b2b_prm` as a starter profile with three content layers:
1. **Domain module**: `partnerships` (app-level) for partner operations.
2. **Extension layer**: UMES widgets/enrichers into customers/sales surfaces.
3. **Starter seed pack**: role features, dictionaries, custom entities, workflow defaults, demo data.

### Scope Boundaries
In scope for initial starter:
- agency onboarding and profile baseline (built on standard Company Profiles for future reuse),
- partner tier definitions and assignments (manual manager control),
- **Extensibility Hooks:** Ensure Tiers and Profiles can be easily referenced by other modules via events or standard entity lookups, without hardcoding external domain logic into the PRM starter itself,
- KPI snapshots (`WIC`, `WIP`, `MIN`) with manual/ingest paths; MIN source data is manager-controlled with manager-assigned agency attribution,
- basic RFP lifecycle (broadcast + selected agencies),
- starter dashboard for partner health and tier progress.

Out of scope in first release:
- automated matching engine,
- full commission settlement engine,
- advanced sales handoff orchestration,
- native implementation of other future workflows – these are separate use cases that will *consume* the PRM foundation, rather than be built inside it.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Keep `partnerships` in app-level modules first | Faster iteration and safer core boundary |
| Extend customers/sales via UMES slots and enrichers | Preserves host-module ownership |
| Manual tier assignment in MVP | Business control and lower automation risk |
| Starter seeds for defaults and examples | Reliable "day-0" usability |
| CLI-first starter activation (`mercato init`) | Fits current developer workflow and avoids premature UI scope |

## User Stories / Use Cases
### 1. Program Governance & KPI
- A Partnership Manager wants to assign and renew partner tiers manually so the program governance stays auditable.
- A Partnership Manager wants to track `WIC/WIP/MIN` snapshots per period with manager-controlled MIN attribution so partner performance is measurable.
- An Agency's Contributor wants to see `WIC` and request refresh when enabled.

### 2. Extensibility & Reuse
- A Platform Engineer wants the PRM Tier and Profile entities to be cleanly exposed via APIs or events so that future workflows can seamlessly consume them without modifying the PRM core.

### 3. RFP Lifecycle
- An onboarded Agency Business Developer wants to answer RFPs in one place so delivery capabilities can be compared consistently.

### 4. Rollout
- An Engineer wants to bootstrap this use case with a single CLI command so local pilot setup is repeatable.
- A Maintainer wants to re-apply or upgrade starter baseline safely across tenants.

## Architecture
### Module Topology
```text
apps/mercato/src/modules/
  partnerships/                 # Domain module (entities, API, ACL, setup)
  partnerships_customers_ext/   # UMES enrichers/widgets into customers
  partnerships_sales_ext/       # UMES widgets for RFP -> sales handoff visibility
```

### Integration Pattern (UMES-safe)
1. `partnerships` owns PRM entities and APIs.
2. Customer pages are extended through response enrichers + field/column widgets.
3. Sales pages are extended through read-only status widgets and actions.
4. Side effects use events/subscribers; no direct cross-module ORM relations.

### Event and Command Contract (initial set)
- Commands:
  - `partnerships.partner_agency.self_onboard`
  - `partnerships.partner_tier.define`
  - `partnerships.partner_tier.assign`
  - `partnerships.partner_tier.downgrade`
  - `partnerships.partner_metric.ingest`
  - `partnerships.partner_rfp.issue`
  - `partnerships.partner_rfp.respond`
- Events:
  - `partnerships.partner_agency.self_onboarded`
  - `partnerships.partner_tier.assigned`
  - `partnerships.partner_tier.downgraded`
  - `partnerships.partner_tier.expiring`
  - `partnerships.partner_metric.snapshot_recorded`
  - `partnerships.partner_rfp.issued`
  - `partnerships.partner_rfp.responded`

### Transaction and Undo Contract
- `partner_agency.self_onboard`: atomic create/update per agency onboarding record.
  - Undo: deactivate agency onboarding state (soft status change), not hard delete.
- `partner_tier.assign` and `partner_tier.downgrade`: atomic insert of assignment history + close previous active assignment.
  - Undo: append compensating assignment event to previous tier with reason.
- `partner_metric.ingest`: atomic upsert per `(partner_agency_id, metric_key, period_start, period_end)`.
  - Undo: re-ingest corrected snapshot or append correction snapshot.
- `partner_rfp.issue` and `partner_rfp.respond`: atomic state transitions with version checks.
  - Undo: explicit status transition (`withdrawn`/`reopened`) through commands, never direct row edits.

### Service Wiring and Isolation
- All write paths execute through DI-registered services (Awilix), not inline handler logic.
- Cross-module references use IDs only (`customer_id`, `agency_organization_id`) with separate fetches.
- Side effects (notifications, downstream sync) run via events/subscribers.

## Data Models
### PartnerAgency (singular, table: `partner_agencies`)
- `id`: uuid
- `tenant_id`: uuid
- `organization_id`: uuid
- `agency_organization_id`: uuid
- `status`: text
- `onboarded_at`: timestamptz
- `created_at`: timestamptz
- `updated_at`: timestamptz

### PartnerTierDefinition (singular, table: `partner_tier_definitions`)
- `id`: uuid
- `tenant_id`: uuid
- `organization_id`: uuid
- `key`: text
- `label`: text
- `wic_threshold`: integer
- `wip_threshold`: integer
- `min_threshold`: integer
- `is_active`: boolean
- `created_at`: timestamptz
- `updated_at`: timestamptz

### PartnerTierAssignment (singular, table: `partner_tier_assignments`)
- `id`: uuid
- `tenant_id`: uuid
- `organization_id`: uuid
- `partner_agency_id`: uuid
- `tier_key`: text
- `granted_at`: timestamptz
- `valid_until`: timestamptz
- `reason`: text nullable
- `assigned_by_user_id`: uuid nullable
- `created_at`: timestamptz
- `updated_at`: timestamptz

### PartnerMetricSnapshot (singular, table: `partner_metric_snapshots`)
- `id`: uuid
- `tenant_id`: uuid
- `organization_id`: uuid
- `partner_agency_id`: uuid
- `metric_key`: text (`wic`, `wip`, `min`)
- `period_start`: date
- `period_end`: date
- `value`: numeric
- `source`: text (`ingest`, `crm`, `manual`)
- `created_at`: timestamptz
- `updated_at`: timestamptz

### PartnerRfpCampaign (singular, table: `partner_rfp_campaigns`)
- `id`: uuid
- `tenant_id`: uuid
- `organization_id`: uuid
- `title`: text
- `customer_id`: uuid nullable
- `status`: text
- `published_at`: timestamptz nullable
- `created_at`: timestamptz
- `updated_at`: timestamptz

### PartnerRfpResponse (singular, table: `partner_rfp_responses`)
- `id`: uuid
- `tenant_id`: uuid
- `organization_id`: uuid
- `rfp_campaign_id`: uuid
- `partner_agency_id`: uuid
- `status`: text
- `score`: numeric nullable
- `submitted_at`: timestamptz nullable
- `created_at`: timestamptz
- `updated_at`: timestamptz

## API Contracts
### Request/Response/Error Conventions
- Request and response bodies follow the platform `ApiResult` envelope.
- Validation failures return `400/422` with machine-readable field errors.
- Authorization failures return `401/403`.
- Not found resources return `404`.
- Conflict on optimistic transitions (for example duplicate issue/respond) returns `409`.

### Agency Onboarding
- `POST /api/partnerships/agencies/self-onboard`
- `GET /api/partnerships/agencies`

Representative request:
```json
{
  "agencyOrganizationId": "uuid",
  "displayName": "Agency Alpha"
}
```

Representative response:
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "status": "active"
  }
}
```

### Tier Management
- `GET /api/partnerships/tiers`
- `POST /api/partnerships/tiers`
- `PATCH /api/partnerships/tiers/{id}`
- `GET /api/partnerships/agencies/{organizationId}/tier-status`
- `POST /api/partnerships/agencies/{organizationId}/tier-assignments`
- `POST /api/partnerships/agencies/{organizationId}/tier-downgrade`
- `GET /api/partnerships/agencies/{organizationId}/tier-history`

Representative assignment request:
```json
{
  "tierKey": "om_ai_native",
  "grantedAt": "2026-03-02T00:00:00.000Z",
  "reason": "Quarterly review"
}
```

### KPI Management
- `GET /api/partnerships/kpi/me?period=YYYY-MM`
- `POST /api/partnerships/kpi/snapshots/import`
- `POST /api/partnerships/kpi/wic-runs/import`
- `POST /api/partnerships/kpi/snapshots/import/external`
- `POST /api/partnerships/kpi/wic-runs/import/external`
- `GET /api/partnerships/kpi/wic-runs/{runId}`
- `GET /api/partnerships/kpi/dashboard?period=YYYY-MM`
- `GET /api/partnerships/kpi/min?year=YYYY`

MIN governance:
- MIN snapshots are derived from manager-maintained license deal records with manager-assigned agency attribution.
- Agency roles are read-only for MIN source records and cannot alter attribution used for MIN.

KPI ingest auth modes:
- Interactive mode (`/import`): `requireAuth` + feature guard `partnerships.manage`.
- Machine mode (`/import/external`): no session cookie; required headers:
  - `X-Om-Import-Secret: <PARTNERSHIP_KPI_IMPORT_SECRET>`
  - `X-Om-Request-Timestamp: <RFC3339 UTC>` (reject outside +/- 5 minutes)
  - `Idempotency-Key: <uuid>`
- Rotation policy: `PARTNERSHIP_KPI_IMPORT_SECRET` rotates at least every 90 days with overlap support for one previous key during cutover.

Representative ingest request:
```json
{
  "partnerAgencyId": "uuid",
  "metricKey": "wic",
  "periodStart": "2026-03-01",
  "periodEnd": "2026-03-07",
  "value": 6,
  "source": "ingest"
}
```

### RFP Baseline
- `GET /api/partnerships/rfp/campaigns`
- `GET /api/partnerships/rfp/campaigns/{id}`
- `GET /api/partnerships/rfp/campaigns/{id}/responses`
- `GET /api/partnerships/rfp/my-invitations`
- `GET /api/partnerships/rfp/my-responses`
- `POST /api/partnerships/rfp/campaigns`
- `POST /api/partnerships/rfp/campaigns/{id}/responses`

Validation rules:
- `targetMode=selected` requires non-empty `targetOrganizationIds`.
- `targetMode=all` ignores `targetOrganizationIds`.

Representative response listing result:
```json
{
  "ok": true,
  "data": {
    "items": [],
    "total": 0,
    "page": 1,
    "pageSize": 50
  }
}
```

### Starter Bootstrap (CLI Contract)
- `mercato init --starter b2b_prm`
- `mercato init --starter b2b_prm --starter-profile <profile_id>`
- `mercato init --starter b2b_prm --no-examples` (uses structural defaults only)

All routes require zod validation and `openApi` exports.

Auth and security requirements:
- Interactive manager/user endpoints require `requireAuth`.
- Machine KPI import endpoints use header-based secret auth and never use browser sessions.
- Manager-only routes require feature guards such as `partnerships.manage`.
- Partner self-view routes require organization-scoped access checks.
- Machine import routes enforce replay protection using `(Idempotency-Key, X-Om-Request-Timestamp)` uniqueness windows.
- API responses and logs must not expose secrets/tokens used by external KPI ingest jobs.
- MIN source record mutations and MIN attribution changes are manager-only actions.

Pagination:
- List routes must enforce `pageSize <= 100`.

## Internationalization (i18n)
Starter-owned keys:
- `partnerships.*` (labels, actions, statuses)
- `partnerships.kpi.*`
- `partnerships.rfp.*`
- `partnerships.tier.*`

No hardcoded user-facing strings.

## UI/UX
Starter UI surfaces:
1. `/backend/partnerships` manager dashboard, including MIN license attribution workflow.
2. Agency self-view for current tier + KPI snapshots.
3. RFP list/detail with invitation and response status.
4. Customers and sales pages extended with PRM context using UMES widgets.

## Configuration
- `PARTNERSHIP_TIER_VALIDITY_MONTHS_DEFAULT=12`
- `PARTNERSHIP_KPI_IMPORT_SECRET=<secret>`
- `PARTNERSHIP_WIP_STAGE_LABEL=Sales Qualified Lead`
- `PARTNERSHIP_MIN_MODE=manual|auto`
- `PARTNERSHIP_WIC_UI_REFRESH_ENABLED=false` (POC default)
- `PARTNERSHIP_WIC_REFRESH_COOLDOWN_MINUTES=30`
- `PARTNERSHIP_WIC_REFRESH_DAILY_LIMIT=6`
- Starter CLI flags:
  - `--starter b2b_prm`
  - `--starter-profile <profile_id>`
  - existing `--no-examples`

## Migration & Compatibility
Compatibility commitments:
- no changes to existing core route paths,
- additive schema and API only,
- UMES extension points consumed but not renamed or removed,
- migration path from manual local specs to canonical starter spec.

## Implementation Plan
### POC
1. Implement `partnerships` module with agency, tier, KPI entities.
2. Implement self-onboarding and KPI import APIs, plus manager-only MIN attribution workflow for license records.
3. Add CLI starter profile wiring in `mercato init` for `b2b_prm` and profile-specific seeds.
4. Seed dictionaries and custom entities for company profile + case study data.

### MVP
1. Implement tier assignment lifecycle and dashboard status views.
2. Implement basic RFP campaign/invitation/response flow.
3. Add UMES-based customer and sales contextual widgets.

### v1
1. Add starter verification checks and health diagnostics.
2. Add integration test suite for full starter bootstrap flow.
3. Implement fit-case/shortlist flow and MIN automation transition path per `SPEC-053b`.

### v2
1. Implement commission and sales handoff add-ons per `SPEC-053b`.
2. Document v1 -> v2 upgrade path for active starter tenants.

### Testing Strategy
- Unit: KPI computation contracts and tier lifecycle rules.
- API integration: onboarding, tiers, metrics, RFP endpoints.
- UI integration: dashboard flows and UMES extension rendering.
- Starter E2E: blank tenant -> `mercato init --starter b2b_prm --starter-profile demo_agency` -> verify demo-ready state.

## Performance, Cache & Scale
### Query and Index Strategy
- Partner agency lookups: `(tenant_id, organization_id, agency_organization_id)`.
- Active tier lookup: `(tenant_id, organization_id, partner_agency_id, valid_until)`.
- Metric snapshots: unique `(tenant_id, organization_id, partner_agency_id, metric_key, period_start, period_end)`.
- RFP responses: `(tenant_id, organization_id, rfp_campaign_id, partner_agency_id)`.

### Scale Controls
- KPI ingestion processes records in batches; workloads exceeding 1000 records are queued.
- RFP response listing uses paginated queries (`pageSize <= 100`) to avoid unbounded reads.
- UMES enrichers use bulk `enrichMany` patterns to avoid N+1 on list pages.

### Cache Strategy
- Read-heavy dashboards may use tenant-scoped cache keys:
  - `partnerships:dashboard:<tenant>:<org>`
  - `partnerships:agency:<tenant>:<org>:<agency_id>`
- Invalidation on writes:
  - tier assignment invalidates dashboard + agency summary tags,
  - KPI ingest invalidates metric snapshot and dashboard tags,
  - RFP issue/respond invalidates campaign and response list tags.
- Cache miss fallback remains direct DB query; no cross-tenant cache sharing is allowed.

## Risks & Impact Review
### Data Integrity Failures
#### KPI ingestion duplicates snapshot rows
- **Scenario**: repeated batch ingest creates duplicate period snapshots.
- **Severity**: High
- **Affected area**: KPI reporting accuracy
- **Mitigation**: unique constraints per metric/agency/period + upsert semantics
- **Residual risk**: backfill corrections may still be needed for early runs

### Cascading Failures & Side Effects
#### PRM extension widgets break host pages
- **Scenario**: injected widget throws and blocks customer/sales page render.
- **Severity**: High
- **Affected area**: customers/sales usability
- **Mitigation**: UMES error boundaries and isolated widget failure handling
- **Residual risk**: degraded PRM view while core page remains available

### Tenant & Data Isolation Risks
#### Agency sees data from other agencies
- **Scenario**: missing organization filter in partner self-view APIs.
- **Severity**: Critical
- **Affected area**: confidentiality and trust
- **Mitigation**: enforced org/tenant scoping in all queries + integration tests
- **Residual risk**: low after coverage on every list/detail API

### Migration & Deployment Risks
#### Starter upgrades break active pilot tenants
- **Scenario**: schema or config assumptions change between starter versions.
- **Severity**: Medium
- **Affected area**: pilot continuity
- **Mitigation**: explicit versioned starter upgrade plan and reversible migrations
- **Residual risk**: temporary maintenance windows for major upgrades

### Operational Risks
#### Manual KPI dependencies create stale signals
- **Scenario**: weekly WIC ingest not run on time.
- **Severity**: Medium
- **Affected area**: tier readiness and partner trust
- **Mitigation**: ingestion freshness dashboard + alerting on stale snapshots
- **Residual risk**: manual dependency remains until automation phase

## Final Compliance Report — 2026-03-02
### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/onboarding/AGENTS.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | PRM stores FK IDs only |
| root AGENTS.md | Tenant/org scoping on all entities and APIs | Compliant | Included in all PRM models and routes |
| root AGENTS.md | Command pattern for write operations | Compliant | Commands defined for onboarding/tier/metric/RFP writes |
| root AGENTS.md | i18n for user-facing strings | Compliant | Dedicated `partnerships.*` translation keys |
| packages/core/AGENTS.md | API routes export `openApi` | Compliant | Mandatory in all starter routes |
| packages/core/AGENTS.md | Use setup.ts for initialization defaults/examples | Compliant | Starter bootstrap uses setup hook lifecycle |
| SPEC-041 contract | Extend via UMES, not host rewrites | Compliant | Customer/sales extensions are UMES-only |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Entity coverage aligns with onboarding/tier/kpi/rfp APIs |
| API contracts match UI/UX | Pass | Runtime dashboard flows map to listed endpoints; starter selection is CLI-first |
| Risks cover all write operations | Pass | Onboarding, assignment, ingest, RFP covered |
| Commands defined for all mutations | Pass | self_onboard/assign/downgrade/ingest/issue/respond commands declared |
| Cache strategy covers all read APIs | Pass | Tenant-scoped cache and invalidation chains defined |
| Starter scope matches phased plan | Pass | MVP excludes advanced matching and commissions |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved for implementation as first starter profile.

## Changelog
### 2026-03-02
- Initial specification for `b2b_prm` starter.
- Defined phased scope and UMES-safe integration boundaries.
- Refactored as a parent starter contract with detailed child specs `SPEC-053a` and `SPEC-053b`.
- Normalized parent command/event/API/config terminology to match `SPEC-053b` as source of truth.
- Added explicit KPI ingest auth split (interactive vs machine) and full RFP read API coverage for UI parity.
- Normalized implementation phase naming to `POC`, `MVP`, `v1`, `v2`.
- Clarified MIN governance: source records and agency attribution are manager-controlled; agency users cannot alter MIN inputs.

### Review — 2026-03-02
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
