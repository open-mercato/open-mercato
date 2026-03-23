# SPEC-053b: B2B PRM Operations (KPI, Tier Lifecycle, RFP)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Open Mercato Team |
| **Created** | 2026-03-02 |
| **Parent** | [SPEC-053](./SPEC-053-2026-03-02-b2b-prm-starter.md) |
| **Related** | SPEC-068 (Use-Case Examples Framework), SPEC-041 (UMES), SPEC-013 (setup.ts) |

## TLDR
**Key Points:**
- Define a full operational contract for B2B partner program management: agency onboarding, tier governance, KPI (`WIC/WIP/MIN`), and phased RFP flow.
- Keep rollout phased: POC baseline, MVP operations, v1 matching/fit automation, v2 commissions and sales handoff.
- Example is bootstrapped via `create-mercato-app --example b2b-prm` + `yarn initialize` (per SPEC-068); runtime operations are API/UI based.

**Scope:**
- PRM operational domain model.
- KPI computation contracts and ingestion rules.
- Tier lifecycle and RFP lifecycle API contracts.

**Concerns:**
- KPI data quality and attribution integrity.
- Strict tenant/organization isolation for partner data.

## Overview
This spec is the detailed implementation contract for the B2B PRM operations layer behind starter `b2b_prm`.

Canonical role set used across this spec family:
- Engineer
- Maintainer
- Partnership Manager
- Agency Business Developer
- Agency's Contributor

Target runtime users:
- Partnership Manager (governance, KPI review, tier decisions, RFP operations)
- Agency Business Developer (RFP and profile maintenance)
- Agency's Contributor (individual `WIC` visibility and optional refresh requests)

The model is intentionally phased so teams can ship value with manual-heavy POC processes and progressively automate once data quality and governance are stable.

Market reference:
- Modern PRM systems prioritize operational consistency: onboarding, partner scoring, lifecycle governance, and RFP orchestration.
- OM adopts this with explicit, auditable contracts and phased automation instead of opaque scoring engines in phase 1.

## Problem Statement
Without a clear operational contract:
- partner onboarding and tiering decisions are ad hoc,
- KPI metrics are inconsistent across teams,
- RFP handling lacks auditability and comparability,
- onboarding-to-sales handoff is slow and not standardized.

The system needs deterministic rules for:
- who sees what,
- how metrics are computed,
- how tier decisions are made,
- how partner responses are tracked from campaign to final outcome.

## Proposed Solution
Implement `partnerships` as the operational owner for partner governance and KPI/RFP workflows.

### Phase Boundaries
| Phase | Scope |
|-------|-------|
| POC | Self-onboarding, manual tier assignment, weekly local WIC import, WIP from CRM SQL-stage, MIN manual license counting from manager-owned license records with manager-set agency attribution |
| MVP | Tier definitions + live progress, basic RFP distribution (`all`/`selected`), agency profile visibility |
| v1 | Matching and fit process, conflict resolution, MIN automation + reconciliation |
| v2 | Commission ledger and formal sales handoff flow |

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| One tenant with organization hierarchy for partner agencies | Simple RBAC and consistent tenant operations |
| Tier assignment remains manual in POC/MVP | Governance control and explainability |
| `WIP` is CRM-derived from SQL stage | Deterministic and auditable pipeline source |
| `MIN` is manual in POC/MVP, automated later | Manager-owned MIN source data and manager-set agency attribution keep KPI governance auditable before automation |
| WIC computed in external batch, not synchronous UI runtime | Operational reliability and auditability |

## User Stories / Use Cases
### 1. Agency Onboarding & Baseline Operations
- **As an Agency Business Developer**, I want self-onboarding so the agency can join the program without manual provisioning delays.
- **As a System Operator**, I want to securely import batch WIC (Wildly Important Contribution) run data via a machine-to-machine API so that partner agencies have up-to-date contribution scores without manual data entry.
- **As a Partnership Manager**, I want the system to automatically derive the WIP score by counting active 'Sales Qualified Lead' deals for each agency in the CRM so that pipeline contribution is measured deterministically.
- **As a Partnership Manager**, I want to manually review an Enterprise license deal and assign an Agency to it so that I control which partner gets MIN credit before automated attribution is built.
- **As a Partnership Manager**, I want to assign partner tier with explicit validity and reason so governance is auditable.

### 2. RFP Lifecycle & Engagement
- **As a Partnership Manager**, I want to create an RFP campaign and invite a specific shortlist of agencies so that only qualified partners see the opportunity.
- **As an Agency Business Developer**, I want to view RFP details and submit my agency's response so that we can bid on new projects.
- **As an Agency's Contributor**, I want to see personal `WIC` and request refresh when feature-flag is enabled.

### 3. Handoff & Maintenance
- **As a Maintainer**, I want a formal handoff contract from selected response to sales flow so downstream operations are traceable.
## Architecture
### Module Context
- `directory` + `auth`: organization and RBAC boundary.
- `customers`: end-customer entities and pipeline context.
- `partnerships` (app module): partner governance, KPI, tier lifecycle, RFP.
- `workflows` (optional v1+): fit orchestration.
- `onboarding`: base patterns reused for self-onboarding in existing tenant.

### Bounded Contexts
1. Partner Governance
2. KPI & Performance
3. Tier Lifecycle & Eligibility
4. RFP Distribution and Response
5. Fit Pipeline (v1)
6. Commission and Sales Handoff (v2)

### Commands & Events
Commands:
- `partnerships.partner_agency.self_onboard`
- `partnerships.partner_tier.define`
- `partnerships.partner_tier.assign`
- `partnerships.partner_tier.downgrade`
- `partnerships.partner_metric.ingest`
- `partnerships.partner_rfp.issue`
- `partnerships.partner_rfp.respond`
- `partnerships.partner_fit_case.create` (v1)
- `partnerships.partner_commission.settle` (v2)
- `partnerships.partner_sales_handoff.create` (v2)

Events:
- `partnerships.partner_agency.self_onboarded`
- `partnerships.partner_tier.assigned`
- `partnerships.partner_tier.downgraded`
- `partnerships.partner_tier.expiring`
- `partnerships.partner_metric.snapshot_recorded`
- `partnerships.partner_rfp.issued`
- `partnerships.partner_rfp.responded`
- `partnerships.partner_fit_case.status_changed` (v1)
- `partnerships.partner_commission.calculated` (v2)
- `partnerships.partner_sales_handoff.created` (v2)

### Transaction and Undo Contract
- Tier assignment/downgrade writes are atomic and history-preserving.
- KPI ingest is batch-atomic with per-row validation status.
- RFP status transitions are optimistic and command-driven.
- Undo behavior:
  - tier rollback via compensating assignment command,
  - KPI correction via corrective ingest run,
  - RFP undo via explicit status transitions (`withdrawn`, `reopened`), not direct row edits,
  - fit case undo via status rollback command (`partner_fit_case.status_changed`) with prior state preserved in history,
  - commission undo via compensating ledger reversal entries (`partner_commission.settle` never hard-deletes rows),
  - sales handoff undo via explicit cancellation command and audit trail link to original handoff record.
- Side-effect reversibility:
  - notifications and outbound integrations run through outbox/subscribers and are compensated with follow-up events,
  - already delivered external notifications are treated as non-reversible and require explicit corrective events.

## KPI Computation Contracts
### WIC (external batch)
- Source: automated `wic_assessment.mjs` background script run after each release (or weekly as Friday baseline in POC).
- Required gate: contribution must be merged, pre-approved unmerged, or accepted issue.
- Unitization: `person + month + feature_key` (anti-double-counting).
- Score formula:
  - `wic_pre_bounty = base_score + impact_bonus`
  - `wic_final = wic_pre_bounty * bounty_multiplier`
- Audit output includes per-unit evidence links, verification status, bonuses, and optional override trace.
- The external script outputs a strictly formatted Markdown table mapped to `partner_agency_id` during ingest.

### WIP (CRM-derived)
- `WIP(period)` = unique deals in `Sales Qualified Lead` stage for partner organization within period.
- Non-qualifying stages do not contribute.
- System records source metadata (`crm_pipeline_sql`, stage key/label) per snapshot.

### MIN (manual first, automated later)
- POC/MVP source: manager-maintained `PartnerLicenseDeal` records.
- Ownership rule: agency users cannot create/update/delete MIN source records and cannot change agency attribution on those records.
- Attribution rule: Partnership Manager reviews manager-level customer/agency evidence and assigns each license deal to one `partner_agency_id` in the manager panel.
- Rule: count unique `enterprise` + `won` + `is_renewal=false` in calendar year from attributed license deals.
- v1: switch to automated source with reconciliation report against manual history.

## Data Models
### Core Operational Entities (POC/MVP)
- `PartnerAgency`
- `PartnerTierDefinition`
- `PartnerTierAssignment`
- `PartnerTierProgressSnapshot`
- `PartnerMetricDefinition`
- `PartnerMetricSnapshot`
- `PartnerWicRun`
- `PartnerWicContributionUnit`
- `PartnerLicenseDeal`
- `PartnerRfpCampaign`
- `PartnerRfpInvitation`
- `PartnerRfpResponse`

### v1/v2 Entities
- `PartnerWicRefreshRequest` (MVP+ optional)
- `PartnerProspectLog` (v1)
- `PartnerFitCase` (v1)
- `PartnerCommissionLedger` (v2)

Representative fields:
- tenancy/scope: `tenant_id`, `organization_id`
- lifecycle: `created_at`, `updated_at`, optional `deleted_at`
- auditable process metadata: `assigned_by_user_id`, `source_run_id`, `quality_status`, `status`

Representative indexes:
- `partner_metric_snapshots (tenant_id, organization_id, metric_definition_id, period_start, period_end)`
- `partner_tier_assignments (tenant_id, organization_id, granted_at, status)`
- `partner_rfp_responses (tenant_id, rfp_campaign_id, organization_id, status)`
- `partner_wic_contribution_units (tenant_id, gh_profile, month_key, feature_key)` unique

## API Contracts
### Conventions
- Envelope: platform `ApiResult`.
- Validation: zod for all write endpoints.
- Auth:
  - interactive routes use `requireAuth`; Partnership Manager flows are feature-guarded,
  - machine KPI import routes use header secret auth and replay protection (no browser session auth).
- Pagination: `pageSize <= 100`.
- MIN ownership: only Partnership Manager flows may mutate MIN source records and agency attribution; agency roles are read-only for MIN inputs.

### Agency Onboarding (all phases)
- `POST /api/partnerships/agencies/self-onboard`
- `GET /api/partnerships/agencies`

### Tier Governance (POC/MVP)
- `GET /api/partnerships/tiers`
- `POST /api/partnerships/tiers`
- `PATCH /api/partnerships/tiers/{id}`
- `GET /api/partnerships/agencies/{organizationId}/tier-status`
- `POST /api/partnerships/agencies/{organizationId}/tier-assignments`
- `POST /api/partnerships/agencies/{organizationId}/tier-downgrade`
- `GET /api/partnerships/agencies/{organizationId}/tier-history`

### KPI Reporting and Ingest (POC/MVP)
- `GET /api/partnerships/kpi/me?period=YYYY-MM`
- `POST /api/partnerships/kpi/snapshots/import`
- `POST /api/partnerships/kpi/wic-runs/import`
- `POST /api/partnerships/kpi/snapshots/import/external`
- `POST /api/partnerships/kpi/wic-runs/import/external`
- `GET /api/partnerships/kpi/wic-runs/{runId}`
- `GET /api/partnerships/kpi/dashboard?period=YYYY-MM`
- `GET /api/partnerships/kpi/min?year=YYYY`

Validation rules:
- `WIP` cannot be imported manually (`crm_derived` only).
- `MIN` snapshot import rejected when MIN mode is entity-driven.
- `MIN` source record writes and attribution updates require manager-level feature guard (`partnerships.manage`).

KPI ingest auth rules:
- Interactive import endpoints (`/import`) require `requireAuth` + `partnerships.manage`.
- External import endpoints (`/import/external`) require headers:
  - `X-Om-Import-Secret: <PARTNERSHIP_KPI_IMPORT_SECRET>`
  - `X-Om-Request-Timestamp: <RFC3339 UTC>` (reject outside +/- 5 minutes)
  - `Idempotency-Key: <uuid>`
- Secret rotation supports one previous key during cutover; old key is removed after migration window.

WIC machine ingest payload contract (`POST /api/partnerships/kpi/wic-runs/import/external`):
- The payload must accept the strict Markdown table output produced by the `wic_assessment.mjs` script.
- Expected columns: `osoba | GH profile | miesiac-rok | WIC script version | Ocena WIC | WIC Level | Bounty bonus | Why bonus | What we included and why? | What we excluded and why?`.
- The API is responsible for mapping `GH profile` to `partner_agency_id` and safely upserting `PartnerWicRun` and `PartnerMetricSnapshot` records.

### Optional WIC Self-Service (MVP+)
- `GET /api/partnerships/kpi/wic/me?period=YYYY-MM`
- `POST /api/partnerships/kpi/wic/me/refresh`
- `GET /api/partnerships/kpi/wic/me/refresh/{requestId}`

### RFP Lifecycle (MVP)
- `GET /api/partnerships/rfp/campaigns`
- `GET /api/partnerships/rfp/campaigns/{id}`
- `GET /api/partnerships/rfp/campaigns/{id}/invitations`
- `GET /api/partnerships/rfp/campaigns/{id}/responses`
- `GET /api/partnerships/rfp/my-invitations`
- `GET /api/partnerships/rfp/my-responses`
- `POST /api/partnerships/rfp/campaigns`
- `POST /api/partnerships/rfp/campaigns/{id}/responses`

Validation rules:
- `targetMode=selected` requires non-empty `targetOrganizationIds`.
- `targetMode=all` ignores `targetOrganizationIds`.

### v1 and v2
- `POST /api/partnerships/rfp/responses/{id}/shortlist`
- `POST /api/partnerships/fit-cases`
- `POST /api/partnerships/fit-cases/{id}/status`
- `GET /api/partnerships/prospects/conflicts`
- `POST /api/partnerships/commissions/calculate/{licenseDealId}` (v2)
- `POST /api/partnerships/rfp/responses/{id}/sales-handoff` (v2)

## Internationalization (i18n)
Required key groups:
- `partnerships.agency.*`
- `partnerships.tier.*`
- `partnerships.kpi.*`
- `partnerships.rfp.*`
- `partnerships.fit_case.*`
- `partnerships.commission.*`

## UI/UX
POC:
- agency KPI workspace (`WIC/WIP/MIN`)
- Partnership Manager console for manual tier assignment and weekly WIC run status
- Partnership Manager MIN attribution panel: review customer/agency contribution evidence and assign agency to license deal objects with audit metadata

MVP:
- Partnership Manager levels console (definitions + eligibility + history)
- Partnership Manager RFP console (campaign + invitations + responses)
- Agency Business Developer profile and case-study maintenance support

v1/v2:
- Partnership Manager fit board and response comparison
- Partnership Manager commission ledger and sales handoff monitoring

## Configuration
- `PARTNERSHIP_TIER_VALIDITY_MONTHS_DEFAULT=12`
- `PARTNERSHIP_KPI_IMPORT_SECRET=<secret>`
- `PARTNERSHIP_WIP_STAGE_LABEL=Sales Qualified Lead`
- `PARTNERSHIP_MIN_MODE=manual|auto`
- `PARTNERSHIP_WIC_UI_REFRESH_ENABLED=false` (POC default)
- `PARTNERSHIP_WIC_REFRESH_COOLDOWN_MINUTES=30`
- `PARTNERSHIP_WIC_REFRESH_DAILY_LIMIT=6`

## Migration & Compatibility
- Additive schema only under `partnerships` module.
- No breaking changes to existing core routes.
- Cross-module links are FK IDs only.
- Phase transitions (manual to automated MIN/WIC options) require explicit migration and reconciliation reports.

## Implementation Plan
### POC
1. Self-onboarding + agency KPI view.
2. Manual tier assignment and history.
3. Weekly external WIC run import workflow.
4. CRM-derived WIP and manager-controlled manual MIN from license entity with audited agency attribution.

### POC Prerequisite
1. Apply [SPEC-053a](./SPEC-053a-2026-03-02-b2b-prm-matching-data-phase0-api-only.md) data foundation workstream before POC RFP fit comparisons.

### MVP
1. Tier definitions with live progress and validity lifecycle.
2. Basic RFP campaigns (`all` / `selected`) and response tracking.
3. Manager views for agency profile and case-study context.

### v1
1. Fit case orchestration and shortlist flow.
2. Conflict resolution logic and audit.
3. MIN automation with reconciliation.

### v2
1. Commission calculation ledger.
2. Sales handoff workflow integration.

## Performance, Cache & Scale
### Query and Index Strategy
- KPI dashboard queries are period-scoped and index-backed.
- RFP response lists are campaign-scoped and paginated.
- WIC contribution units enforce uniqueness for anti-double-counting.

### Scale Controls
- KPI ingestion uses batching; runs above 1000 rows use queue workers.
- WIC refresh requests include cooldown, per-user limits, and idempotency keys.
- Enricher paths must use `enrichMany` to avoid N+1 in list surfaces.

### Cache Strategy
- Optional tenant-scoped cache keys:
  - `partnerships:kpi:dashboard:<tenant>:<org>:<period>`
  - `partnerships:agency:tier_status:<tenant>:<org>:<agency>`
- Invalidations:
  - tier assignment invalidates agency status + dashboard keys,
  - KPI ingest invalidates KPI dashboard keys,
  - RFP update invalidates campaign and response list keys.

## Risks & Impact Review
### Data Integrity Failures
#### Partial KPI import
- **Scenario**: KPI import stops mid-batch and leaves inconsistent snapshots.
- **Severity**: High
- **Affected area**: dashboard accuracy, tier decisions
- **Mitigation**: idempotent run IDs, unique constraints, per-batch transaction boundaries
- **Residual risk**: delayed reporting until rerun

#### WIC misclassification
- **Scenario**: contribution wrongly categorized and scored.
- **Severity**: High
- **Affected area**: fairness, trust, tier governance
- **Mitigation**: strict verification gate + auditable unit scoring + override reason trail
- **Residual risk**: edge disputes requiring manual review

#### External KPI import replay or secret misuse
- **Scenario**: leaked import secret or replayed signed request mutates KPI snapshots.
- **Severity**: High
- **Affected area**: KPI integrity and tier governance decisions
- **Mitigation**: secret rotation policy, timestamp window checks, idempotency-key dedupe, scoped audit logs
- **Residual risk**: short-lived exposure during secret compromise window

### Cascading Failures & Side Effects
#### RFP delivery outage
- **Scenario**: notifications fail and agencies do not receive invitations.
- **Severity**: Medium
- **Affected area**: campaign execution timeline
- **Mitigation**: retry queues, invitation status tracking, re-send action
- **Residual risk**: temporary response delays

### Tenant & Data Isolation Risks
#### Cross-agency data leak
- **Scenario**: missing `organization_id` filters expose other agencies' KPI/RFP data.
- **Severity**: Critical
- **Affected area**: confidentiality and compliance
- **Mitigation**: mandatory tenant/org scoping + integration tests for each endpoint
- **Residual risk**: regression risk without test enforcement

### Migration & Deployment Risks
#### MIN mode transition errors
- **Scenario**: move from manual to automated MIN yields discrepancies.
- **Severity**: Medium
- **Affected area**: KPI history and tier calculations
- **Mitigation**: reconciliation report and staged rollout with rollback flag
- **Residual risk**: short-lived manual correction workload

### Operational Risks
#### Weekly WIC run missed
- **Scenario**: manager does not execute scheduled weekly run.
- **Severity**: Medium
- **Affected area**: KPI freshness and planning cadence
- **Mitigation**: freshness alerts and run SLA dashboard
- **Residual risk**: one-cycle stale KPI data

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
| root AGENTS.md | No direct ORM relationships between modules | Compliant | FK-ID links only |
| root AGENTS.md | Organization scoping required | Compliant | All operational entities and endpoints scoped |
| root AGENTS.md | Command pattern for writes | Compliant | Tier/KPI/RFP writes mapped to commands |
| root AGENTS.md | i18n for user-facing strings | Compliant | Dedicated `partnerships.*` key groups |
| packages/core/AGENTS.md | API routes export `openApi` | Compliant | Mandatory for all route specs in scope |
| packages/core/AGENTS.md | setup.ts lifecycle usage | Compliant | Starter bootstraps through setup hooks |
| SPEC-041 contract | Use UMES for cross-module UI extension | Compliant | Host module modifications avoided |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Entity set covers all phase APIs |
| API contracts match UI/UX section | Pass | Console/workspace flows map to endpoints |
| Risks cover all write operations | Pass | Onboarding/tier/KPI/RFP covered |
| Commands defined for all mutations | Pass | Explicit command list provided |
| Cache strategy covers read APIs | Pass | Scoped cache keys and invalidation listed |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved for phased implementation.

## Changelog
### 2026-03-17
- Aligned with SPEC-068 (was SPEC-062): replaced `mercato init --starter` reference in TLDR with `create-mercato-app --example b2b-prm` + `yarn initialize` flow.
- Updated Related field: SPEC-052 → SPEC-068.

### 2026-03-02
- Initial detailed operations contract extracted for `b2b_prm` starter.
- Added KPI computation contracts (`WIC`, `WIP`, `MIN`) and phased API lifecycle.
- Added explicit machine-ingest auth contract, RFP read endpoints for UI parity, and full undo coverage for v1/v2 commands.
- Normalized phase naming to `POC`, `MVP`, `v1`, `v2`.
- Clarified MIN governance: source records and agency attribution are manager-controlled; agency users cannot alter MIN inputs.

### Review — 2026-03-02
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
