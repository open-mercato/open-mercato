# SPEC-053c: B2B PRM Partner Portal & Module Slimming

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Open Mercato Team |
| **Created** | 2026-03-18 |
| **Parent** | [SPEC-053](./SPEC-053-2026-03-02-b2b-prm-starter.md) |
| **Related** | SPEC-053a (Data Foundation), SPEC-053b (Operations/KPI/RFP), SPEC-060 (Customer Identity & Portal Auth), SPEC-062 (Use-Case Starters Framework) |

## TLDR
**Key Points:**
- Wire `customer_accounts` (SPEC-060) as a core dependency of the `starter-b2b-prm` example, closing the gap between the PRM spec family and the customer identity spec.
- Slim the starter's module set from ~50 (full OM) to 13 purpose-selected core modules + the `partnerships` app module.
- Add a partner-facing portal with dashboard, KPI view, RFP inbox/response, case study management, and team management — gated by `portal.partner.access` RBAC feature.
- All portal infrastructure uses existing `customer_accounts` + `portal` core modules. Partner-specific pages and RBAC live in the app-level `partnerships` module.

**Scope:**
- Module composition: define the minimal core module set for a PRM starter.
- Partner RBAC: 3 partner roles with `portal.partner.*` feature namespace.
- Partner portal pages: 6 pages covering KPIs, RFP, case studies, and team management.
- Integration: auto-role assignment on customer user creation, RFP notification delivery to portal.
- Bootstrap: `setup.ts` seeds partner roles, dictionaries, and example data.

**Concerns:**
- Agency-to-CustomerUser linking depends on CRM company match — agencies that sign up before their company exists in CRM will need manual linking by staff.
- RFP `all` distribution requires resolving all companies with PartnerAgency records and their linked CustomerUsers — could be slow with large agency pools.

## Overview

SPEC-053 defined the PRM starter as a staff-side operations tool. SPEC-060 built the customer identity and portal authentication infrastructure. These two specs were written concurrently (March 2-4, 2026) and the dependency between them was never formalized — SPEC-060 mentions SPEC-053 as a downstream consumer, but SPEC-053 never references `customer_accounts` or portal auth.

This spec closes that gap. It defines:
1. Which core modules the PRM starter actually needs (13 core, not ~50).
2. How partner agencies access a self-service portal using `customer_accounts` auth.
3. What partner-facing pages and RBAC features the `partnerships` module provides.

## Problem Statement

1. **No portal for partners**: Agency Business Developers and Contributors have no self-service access. All interactions require staff mediation.
2. **Bloated module set**: `test-prm` enables ~50 modules (the full OM stack). The PRM starter needs ~13 core modules. Shipping everything adds confusion, attack surface, and startup time.
3. **Missing dependency declaration**: `starter-b2b-prm` does not register `customer_accounts` or `portal` in its `modules.ts`, despite SPEC-053b user stories requiring partner-facing features.
4. **No partner RBAC**: No roles or features exist for controlling what agency users can do in the portal.

## User Stories / Use Cases

### Partner Self-Service
- **As a Partner Member**, I want to see my agency's tier status and KPI scores (WIC/MIN/WIP) on a dashboard so that I understand our standing in the program.
- **As a Partner Member**, I want to view RFP campaigns and submit responses so that my agency can bid on new opportunities.
- **As a Partner Member**, I want to view our agency's case studies so that I can see what evidence we've submitted.
- **As a Partner Viewer**, I want read-only access to KPIs and case studies so that I can stay informed without editing capabilities.

### Partner Admin
- **As a Partner Admin**, I want to invite colleagues to the portal and assign them roles so that my team can collaborate on RFPs and track KPIs.
- **As a Partner Admin**, I want to manage case studies so that our agency profile stays current.

### Staff / Partnership Manager
- **As a Partnership Manager**, I want to invite agency contacts directly so that key partners get portal access during onboarding.
- **As a Partnership Manager**, I want to send RFP campaigns to all or selected agencies so that qualified partners see opportunities.
- **As a Staff Admin**, I want to manually link a self-signup user to their CRM company and assign partner roles when auto-linking fails.

## Proposed Solution

### 1. Module Composition (13 core modules)

The starter's `modules.ts` declares exactly these core modules:

| Module | PRM use case |
|--------|-------------|
| `directory` | Multi-tenant infrastructure |
| `auth` | Staff login + RBAC |
| `entities` | Custom fields, encryption |
| `query_index` | Required by entities |
| `customer_accounts` | Partner portal auth (SPEC-060) |
| `portal` | Customer-facing shell (requires `customer_accounts`) |
| `customers` | CRM company/person records, auto-linking |
| `notifications` | Email flows (verify, reset, invite, RFP alerts) |
| `dashboards` | WIC/MIN/WIP KPI dashboard widgets |
| `workflows` | RFP lifecycle orchestration |
| `attachments` | RFP documents, agency branding, case study files |
| `audit_logs` | Tier/KPI/RFP change tracking |
| `dictionaries` | Industries, Services, Tech dropdowns (SPEC-053a) |

App-level module:
| `partnerships` | Partner governance, KPI, tier lifecycle, RFP, portal pages |

**Explicitly excluded** (~36 modules): `catalog`, `sales`, `currencies`, `integrations`, `data_sync`, `shipping_carriers`, `payment_gateways`, `business_rules`, `feature_toggles`, `perspectives`, `planner`, `resources`, `staff`, `inbox_ops`, `messages`, `translations`, `api_docs`, `api_keys`, `configs`, `progress`, `widgets`, and others.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| 13 core modules, not full stack | PRM starter should be focused and fast to bootstrap. Users can add modules later. |
| `customer_accounts` as hard dependency | Partner portal requires authenticated customer users. No alternative path. |
| Partner roles created in `partnerships/setup.ts` `seedDefaults`, not in `customer_accounts` | Keeps core module clean. Partnerships creates `CustomerRole` + `CustomerRoleAcl` rows directly in `seedDefaults` (same pattern as `customer_accounts/setup.ts` uses for its default roles). `defaultCustomerRoleFeatures` is only used for merging additional features into existing roles — it cannot create new roles. |
| Portal pages in `partnerships/frontend/`, not separate module | One module owns the full partner domain. Portal pages are just another surface of the partnerships module. |
| No direct ORM relationship between partnerships and customer_accounts | Join through shared CRM company entity (`CustomerUser.customerEntityId` = `PartnerAgency.agencyOrganizationId`). Follows OM cross-module isolation rules. |
| Workflows for RFP, not custom state machine | Reuses existing `workflows` module. Only Partnership Manager can configure RFP workflows. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Ship full ~50 module set | Bloated, confusing for PRM-focused users, unnecessary attack surface |
| Separate `partnerships_portal` module for portal pages | Over-modularization. Portal pages are part of the partnerships domain. |
| Custom auth instead of `customer_accounts` | Duplicates SPEC-060 work. `customer_accounts` is purpose-built for this. |
| Skip portal, keep staff-only | Blocks SPEC-053b user stories for Agency Business Developer and Contributor. |

## Architecture

### Partner Portal Pages

| Page | Route | Who sees it | What it shows |
|------|-------|-------------|---------------|
| Partner Dashboard | `/portal/partnerships` | All partner users | Tier status, KPI summary (WIC/MIN/WIP), active RFP count |
| KPI Detail | `/portal/partnerships/kpi` | All partner users | WIC contribution breakdown, MIN attribution, WIP pipeline |
| RFP Inbox | `/portal/partnerships/rfp` | Agency Business Developer | Open RFP campaigns they're invited to |
| RFP Response | `/portal/partnerships/rfp/[id]` | Agency Business Developer | View RFP details, submit/edit response, upload attachments |
| Case Studies | `/portal/partnerships/case-studies` | Agency Business Developer | Submit/manage structured case studies |
| Team Management | `/portal/partnerships/team` | Portal Admin (agency) | Invite/remove colleagues, assign roles |

All portal pages gated by `portal.partner.access` feature. Individual pages check additional features as listed below.

### Partner RBAC

**Feature namespace** (`portal.partner.*`):

```
portal.partner.access          — gate to partner portal
portal.partner.kpi.view        — see own agency KPIs
portal.partner.rfp.view        — see RFP invitations
portal.partner.rfp.respond     — submit RFP responses
portal.partner.profile.view    — view agency profile, case studies (read-only)
portal.partner.profile.manage  — edit agency profile, case studies
portal.partner.users.manage    — invite/remove team members
```

Partner roles also receive `portal.users.manage` and `portal.users.view` from the `customer_accounts` feature namespace where needed, since team management delegates to existing `customer_accounts` portal APIs which check those features.

**Default partner roles** (created by `partnerships/setup.ts` `seedDefaults` via direct `em.create(CustomerRole, ...)` + `em.create(CustomerRoleAcl, ...)`):

Note: `defaultCustomerRoleFeatures` cannot create new roles — it only merges features into existing roles. Partner roles must be created explicitly in `seedDefaults`, following the same pattern as `customer_accounts/setup.ts` `seedDefaultRoles`.

| Role | Slug | Features | customer_assignable |
|------|------|----------|---------------------|
| Partner Admin | `partner_admin` | `portal.partner.*`, `portal.users.manage`, `portal.users.view` | false |
| Partner Member | `partner_member` | `portal.partner.access`, `portal.partner.kpi.view`, `portal.partner.rfp.view`, `portal.partner.rfp.respond`, `portal.partner.profile.view` | true |
| Partner Viewer | `partner_viewer` | `portal.partner.access`, `portal.partner.kpi.view`, `portal.partner.profile.view` | true |

`partner_admin` is `customer_assignable: false` — only staff can assign it. Partner Admins can assign `partner_member` and `partner_viewer` to their colleagues. Partner Admin also receives `portal.users.manage` and `portal.users.view` (from `customer_accounts` namespace) to enable team management via existing portal user APIs.

### Integration: partnerships <-> customer_accounts

#### Agency Onboarding Flow

1. **Staff-initiated (primary path)**: Partnership Manager invites agency contact via staff admin (existing `customer_accounts` admin invite API with `customer_entity_id` set to the agency's CRM company). At invitation acceptance, the user is created with `customerEntityId` already set. The `autoAssignPartnerRole` subscriber fires on `customer_accounts.user.created`, finds the matching `PartnerAgency`, and assigns `Partner Member` role.
2. **Self-signup (secondary path)**: Agency contact signs up via portal. `autoLinkCrm` subscriber (SPEC-060) links them to CRM person/company by email match using `em.nativeUpdate` (no event emitted). Since `autoLinkCrm` does not emit `user.updated` or `user.crm_linked`, the `autoAssignPartnerRole` subscriber also fires on `user.created` but may find no company link yet. If no `customerEntityId` is set at that point, the subscriber exits silently. Staff must then manually link the user via admin UI and trigger role assignment.
3. **Manual link + role assignment**: When staff links a self-signup user to their CRM company via the admin UI, a separate staff action assigns the partner role. This is acceptable for the self-signup edge case where email auto-linking fails or is delayed.
4. **Upgrade path**: Partnership Manager can upgrade user to `Partner Admin` via staff backend.

**Note on event sequencing**: The `autoLinkCrm` subscriber uses `em.nativeUpdate` (raw SQL) which does not trigger ORM lifecycle events. A future improvement could add explicit event emission after CRM linking (e.g., `customer_accounts.user.crm_linked`), which would enable fully automatic role assignment for self-signup users. For MVP, the staff-initiated invitation flow handles the common case, and manual linking handles the edge case.

#### Data Link (no direct ORM relationship)

```text
PartnerAgency
  agencyOrganizationId ──────► CustomerEntity (kind='company')
                                      ▲
CustomerUser                          │
  customerEntityId ───────────────────┘
```

Note: `PartnerAgency.organizationId` is the tenant org scoping field (standard OM convention). `PartnerAgency.agencyOrganizationId` is the FK to the agency's CRM company entity — this is the join point with `CustomerUser.customerEntityId`.

The join is through the shared CRM company entity. Partnerships module queries `CustomerUser` records by `customerEntityId` matching `PartnerAgency.agencyOrganizationId` when resolving portal users for an agency. Uses separate fetches, not ORM relations.

#### RFP Notification Flow

1. Partnership Manager creates RFP campaign with audience: `all` or `selected` agencies.
2. Partnerships module emits `partnerships.partner_rfp.issued` event.
3. Subscriber `notifyAgenciesOnRfp.ts` resolves target agencies:
   - If `all`: all companies with `PartnerAgency` records.
   - If `selected`: only the specified agencies.
4. For each target agency, find `CustomerUser` records linked to that company.
5. Send portal notification to each user with `portal.partner.rfp.view` feature.
6. Agency Business Developer sees RFP in their portal inbox.

### Bootstrap Flow

When `create-mercato-app --example b2b-prm` + `yarn initialize` runs:

1. **Core modules seed defaults**: auth roles, `customer_accounts` default roles (Portal Admin, Buyer, Viewer), dictionaries infrastructure.
2. **Partnerships `setup.ts` runs `seedDefaults`**:
   - 3 tier definitions (bronze/silver/gold) — already exists.
   - Partner RBAC roles created via direct `em.create(CustomerRole, ...)` + `em.create(CustomerRoleAcl, ...)` (Partner Admin, Partner Member, Partner Viewer). Note: `defaultCustomerRoleFeatures` cannot create new roles.
   - Dictionaries: Industries, Services, Tech from SPEC-053a.
   - Staff role features for partnership management.
3. **Partnerships `setup.ts` runs `seedExamples`** (optional):
   - Example agency with linked CRM company.
   - Example RFP campaign template.
   - Example KPI data.
4. **Result**: Staff can log in to backend and manage partners. Agency contacts can be invited to portal immediately.

## Data Models

No new entities. This spec wires existing entities from `customer_accounts` (SPEC-060) and `partnerships` (SPEC-053/053b) through the shared CRM company entity.

**Existing entity reuse:**

| Entity | Module | Role in this spec |
|--------|--------|-------------------|
| `CustomerUser` | customer_accounts | Partner portal login identity |
| `CustomerRole` / `CustomerRoleAcl` | customer_accounts | Partner roles and features |
| `CustomerUserInvitation` | customer_accounts | Staff-initiated partner invitations |
| `PartnerAgency` | partnerships | Agency record, links to CRM company via `organizationId` |
| `PartnerTierDefinition` / `PartnerTierAssignment` | partnerships | Tier display on portal dashboard |
| `PartnerMetricSnapshot` / `PartnerWicRun` / `PartnerWicContributionUnit` | partnerships | KPI data shown on portal |
| `PartnerLicenseDeal` | partnerships | MIN attribution shown on portal |

## API Contracts

### Portal API Routes (new, under partnerships module)

All routes require customer auth (`customer_auth_token`) + `portal.partner.access` feature. All routes return `403` if the user has no `customerEntityId` (no company link). List endpoints support `?page=1&pageSize=25` pagination (max `pageSize: 100`, per SPEC-053 convention).

| Method | Route | Feature | Description |
|--------|-------|---------|-------------|
| GET | `/api/partnerships/portal/dashboard` | `portal.partner.kpi.view` | Tier status + KPI summary for user's agency |
| GET | `/api/partnerships/portal/kpi` | `portal.partner.kpi.view` | Detailed KPI breakdown (WIC/MIN/WIP) |
| GET | `/api/partnerships/portal/rfp` | `portal.partner.rfp.view` | List RFP campaigns user's agency is invited to (paginated) |
| GET | `/api/partnerships/portal/rfp/[id]` | `portal.partner.rfp.view` | RFP campaign detail |
| POST | `/api/partnerships/portal/rfp/[id]/respond` | `portal.partner.rfp.respond` | Submit/update RFP response |
| GET | `/api/partnerships/portal/case-studies` | `portal.partner.profile.view` | List agency's case studies (paginated) |
| POST | `/api/partnerships/portal/case-studies` | `portal.partner.profile.manage` | Create case study |
| PUT | `/api/partnerships/portal/case-studies/[id]` | `portal.partner.profile.manage` | Update case study |
| DELETE | `/api/partnerships/portal/case-studies/[id]` | `portal.partner.profile.manage` | Delete case study |

**Standard error responses for all portal routes:**
- `401` — missing or invalid `customer_auth_token`
- `403` — missing required feature OR user has no `customerEntityId` (no company link)
- `404` — requested resource not found or not scoped to user's agency

Team management uses existing `customer_accounts` portal APIs (`/api/customer-accounts/portal/users/*`). Partner Admin role includes `portal.users.manage` and `portal.users.view` features from the `customer_accounts` namespace, which these routes check.

### Auth Helpers in Portal Routes

Portal API routes use `requireCustomerAuth` and `requireCustomerFeature` from `customer_accounts/lib/customerAuth`. The route resolves the user's `customerEntityId` to find the matching `PartnerAgency` and scopes all data queries to that agency.

All portal API routes MUST:
- Export `openApi` for documentation generation (per root AGENTS.md convention).
- Validate inputs with Zod schemas from `partnerships/data/validators.ts`.
- Follow the `route.ts` convention with named `GET`/`POST`/`PUT`/`DELETE` exports (matching existing `api/tiers/route.ts` pattern).

### Commands for Portal Write Operations

| Command | Trigger | Undo |
|---------|---------|------|
| `partnerships.partner_rfp.respond` | Partner submits RFP response | Status transition to `withdrawn` (per SPEC-053b) |
| `partnerships.partner_case_study.create` | Partner creates case study | Soft delete (`deletedAt`) |
| `partnerships.partner_case_study.update` | Partner updates case study | Undo via command history (standard OM pattern) |
| `partnerships.partner_case_study.delete` | Partner deletes case study | Soft delete — recoverable by staff |

RFP response submission emits `partnerships.partner_rfp.responded` event. Notifications sent on RFP response are not reversible (acceptable — notification indicates action taken, not action undone).

### Internationalization (i18n)

Portal pages use `partnerships.portal.*` i18n key namespace. Keys added to `i18n/en.json` and `i18n/pl.json`:
- `partnerships.portal.dashboard`, `partnerships.portal.tier`, `partnerships.portal.noTier`
- `partnerships.portal.kpiDetail`, `partnerships.portal.activeRfps`
- `partnerships.portal.rfpInbox`, `partnerships.portal.rfpResponse`, `partnerships.portal.rfpResponsePlaceholder`
- `partnerships.portal.caseStudies`, `partnerships.portal.teamManagement`

### Performance, Cache & Scale

- **Portal dashboard query**: 3 queries (tier assignment, metric snapshots, RFP count) — all scoped by `tenantId + organizationId + partnerAgencyId`. Existing indexes on `partner_tier_assignments`, `partner_metric_snapshots`, `partner_rfp_campaigns` cover these patterns.
- **KPI detail query**: 3 queries (metrics, WIC contributions, license deals) with pagination (`pageSize <= 100`). Existing indexes sufficient.
- **RFP list**: Filtered by `status IN ('published', 'closed')` then client-side filtered by `audience='all' OR agency in invitedAgencyIds`. For large agency pools, the `invitedAgencyIds` JSONB check is O(n) per campaign — acceptable for MVP volumes.
- **RFP notification fan-out**: `notifyAgenciesOnRfp` subscriber is persistent and processes all agencies in a single batch query. For >1000 agencies, notifications are emitted in a loop — async, no blocking. Acceptable for MVP.
- **`customerEntityId` → `PartnerAgency` join**: Point lookup on `(tenantId, organizationId, agencyOrganizationId)` — covered by existing unique index `uq_partner_agencies_agency_org`.
- **No portal-specific caching for MVP**: Dashboard data changes infrequently but staleness risk is low. Cache can be added later with tag-based invalidation.

### Migration & Backward Compatibility

All changes are **additive-only** — no breaking changes:
- New portal API routes: no conflict with existing staff routes (different path prefix).
- New subscriber registrations: additive, no effect on existing subscribers.
- New customer roles: seeded idempotently in `seedDefaults` (skipped if slug already exists).
- Entity schema additions (Task 0): new nullable columns on existing tables — no migration risk.
- No changes to core modules (`customer_accounts`, `portal`, etc.).
- No renamed/removed contract surfaces.

## Implementation Plan

### Phase 1: Module Slimming & Dependency Wiring
**Effort**: 1 day

1. Update `starter-b2b-prm/modules.ts.snippet` with the 13 core modules + partnerships.
2. Verify `test-prm` boots with only the 14 modules enabled (trim its `modules.ts`).
3. Run `yarn generate` + `yarn db:migrate` + `yarn initialize` to confirm no missing dependencies.
4. Update `starter-b2b-prm/README.md` to reflect the full PRM module (replace hello module description).

### Phase 2: Partner RBAC & Auto-Role Assignment
**Effort**: 2-3 days

1. Add partner role creation to `partnerships/setup.ts` `seedDefaults`: create `CustomerRole` + `CustomerRoleAcl` rows for Partner Admin, Partner Member, Partner Viewer (following `customer_accounts/setup.ts` `seedDefaultRoles` pattern). Must be idempotent — skip if roles already exist.
2. Implement `partnerships/subscribers/autoAssignPartnerRole.ts`: subscribes to `customer_accounts.user.created`. For staff-invited users, `customerEntityId` is set at creation time and the subscriber assigns `Partner Member` immediately. For self-signup users, `customerEntityId` may be null (CRM linking is async via `nativeUpdate` with no event), so the subscriber exits silently — staff handles linking manually.
3. Run `yarn initialize` and verify 3 partner roles are seeded alongside the 3 default `customer_accounts` roles.
4. Test: create a customer user linked to an agency company, confirm Partner Member role auto-assigned after CRM linking.

### Phase 3: Portal Dashboard & KPI Pages
**Effort**: 2-3 days

1. Implement portal API routes: `portal/dashboard`, `portal/kpi`.
2. Build portal frontend pages: Partner Dashboard, KPI Detail.
3. Wire `requireCustomerAuth` + `requireCustomerFeature('portal.partner.kpi.view')`.
4. Scope all queries by `customerEntityId` → `PartnerAgency.agencyOrganizationId`.
5. Test: partner user logs in, sees tier status and KPI data for their agency only.

### Phase 4: RFP Portal Pages
**Effort**: 2-3 days

1. Implement portal API routes: `portal/rfp` (list), `portal/rfp/[id]` (detail), `portal/rfp/[id]/respond`.
2. Build portal frontend pages: RFP Inbox, RFP Response (with attachment upload via `attachments` module).
3. Implement `partnerships/subscribers/notifyAgenciesOnRfp.ts`: resolves target agencies, sends portal notifications.
4. Test: Partnership Manager creates RFP, agency user sees it in inbox, submits response.

### Phase 5: Case Studies & Polish
**Effort**: 1-2 days

1. Implement portal API routes: `portal/case-studies` (CRUD).
2. Build portal frontend page: Case Studies management.
3. End-to-end test of full flow: agency signup → auto-role → portal login → view KPIs → respond to RFP → manage case studies → invite team member.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `starter-b2b-prm/modules.ts.snippet` | Modify | 13 core modules + partnerships app module |
| `starter-b2b-prm/README.md` | Modify | Full PRM module documentation |
| `partnerships/setup.ts` | Modify | Add partner role creation in `seedDefaults` (CustomerRole + CustomerRoleAcl rows) |
| `partnerships/subscribers/autoAssignPartnerRole.ts` | Create | Auto-assign Partner Member on `customer_accounts.user.created` (works for staff-invited users with pre-set company link) |
| `partnerships/subscribers/notifyAgenciesOnRfp.ts` | Create | Notify agencies on `partnerships.partner_rfp.issued` |
| `partnerships/api/portal/dashboard.ts` | Create | Portal dashboard API |
| `partnerships/api/portal/kpi.ts` | Create | Portal KPI detail API |
| `partnerships/api/portal/rfp.ts` | Create | Portal RFP list API |
| `partnerships/api/portal/rfp/[id].ts` | Create | Portal RFP detail API |
| `partnerships/api/portal/rfp/[id]/respond.ts` | Create | Portal RFP response API |
| `partnerships/api/portal/case-studies.ts` | Create | Portal case studies CRUD API |
| `partnerships/frontend/partnerships/page.tsx` | Create | Portal dashboard page |
| `partnerships/frontend/partnerships/kpi/page.tsx` | Create | Portal KPI page |
| `partnerships/frontend/partnerships/rfp/page.tsx` | Create | Portal RFP inbox page |
| `partnerships/frontend/partnerships/rfp/[id]/page.tsx` | Create | Portal RFP response page |
| `partnerships/frontend/partnerships/case-studies/page.tsx` | Create | Portal case studies page |
| `partnerships/frontend/partnerships/team/page.tsx` | Create | Portal team management page |

### Testing Strategy

- **Unit**: Partner role feature resolution, agency-to-CustomerUser scoping logic.
- **API integration**: Portal API routes return correct data scoped to agency, reject unauthorized access, handle missing agency gracefully.
- **E2E (Playwright)**: Full partner journey — signup → auto-role → login → dashboard → RFP response → case study → team invite.
- **RBAC**: Partner Viewer cannot submit RFP. Partner Member cannot manage team. Partner Admin can do everything. Staff can assign Partner Admin.

## Risks & Impact Review

### Data Integrity Failures

#### Agency user signs up but company not in CRM
- **Scenario**: Agency contact signs up before their company exists as a CRM entity. `autoLinkCrm` finds no match. `autoAssignPartnerRole` finds no `PartnerAgency`.
- **Severity**: Low
- **Affected area**: User exists but has no portal access (no partner role, no company link).
- **Mitigation**: Staff can manually link user to company via admin UI, then trigger role assignment. Document this in the starter README.
- **Residual risk**: Minor manual overhead for edge case onboarding.

#### RFP notification delivery to large agency pool
- **Scenario**: `all` distribution with 1000+ agencies, each with multiple users.
- **Severity**: Low
- **Affected area**: Notification delivery latency.
- **Mitigation**: `notifyAgenciesOnRfp` subscriber is persistent (retried on failure) and processes agencies in batches. Notifications are async — no blocking on campaign creation.
- **Residual risk**: Delivery delay for large pools, acceptable for RFP use case.

### Security

#### Cross-agency data leak in portal
- **Scenario**: Portal route missing `customerEntityId` scoping returns another agency's KPIs or RFP responses.
- **Severity**: Critical
- **Affected area**: All portal API routes.
- **Mitigation**: Every portal route resolves user's `customerEntityId`, finds matching `PartnerAgency`, and scopes all queries to that agency. Routes return 403 if user has no company link. Code review checklist item for all portal routes.
- **Residual risk**: None if scoping is correctly applied.

#### Partner Admin self-escalation
- **Scenario**: Partner Admin tries to assign roles beyond `customer_assignable` scope.
- **Severity**: Medium
- **Affected area**: Role assignment in team management.
- **Mitigation**: `customer_assignable: false` on `partner_admin` role (SPEC-060 mechanism). Portal role assignment API validates this flag. Only staff can assign Partner Admin.
- **Residual risk**: None — enforced at API level by `customer_accounts`.

## Final Compliance Report

### AGENTS.md Files Reviewed
- Root `AGENTS.md` (module conventions, DI, RBAC, API routes)
- `packages/core/AGENTS.md` (auto-discovery, events, subscribers, setup.ts, widgets)
- `packages/core/src/modules/customer_accounts/AGENTS.md` (customer auth, RBAC, portal patterns)

### Compliance Checklist

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Join through shared CRM company entity via FK IDs |
| root AGENTS.md | Tenant/org scoping on all entities and APIs | Compliant | All portal routes scope by customerEntityId → PartnerAgency |
| root AGENTS.md | Command pattern for write operations | Compliant | Portal writes defined: rfp.respond, case_study CRUD |
| root AGENTS.md | Validate all inputs with Zod | Compliant | Portal schemas in `data/validators.ts` |
| root AGENTS.md | API routes MUST export `openApi` | Compliant | Required for all portal routes |
| root AGENTS.md | Use DI (Awilix) to inject services | Compliant | Services resolved via `createRequestContainer()` |
| root AGENTS.md | i18n for user-facing strings | Compliant | `partnerships.portal.*` key namespace |
| root AGENTS.md | Use `apiCall` not raw `fetch` | Compliant | Portal frontend pages use `apiCall()` |
| packages/core | Events declared with `as const` | Compliant | Uses existing `partnerships/events.ts` declarations |
| packages/core | Subscribers export `metadata` + default handler | Compliant | Both new subscribers follow pattern |
| SPEC-060 | Portal access as RBAC feature | Compliant | `portal.partner.access` gates partner portal |
| SPEC-060 | customer_assignable flag | Compliant | `partner_admin` not customer-assignable |
| SPEC-053 | Additive app modules only | Compliant | No core module changes |
| SPEC-053b | RFP distribution: all/selected | Compliant | Both modes supported via subscriber |
| Backward Compatibility | All changes additive-only | Compliant | New routes, subscribers, roles — no removals or renames |

### Non-Compliant Items
None.

## Changelog

### 2026-03-18 (v3 — OM Spec Review Fixes)
- Fixed critical event issue: `autoAssignPartnerRole` now subscribes to `customer_accounts.user.created` (not `user.updated`). The `autoLinkCrm` subscriber uses `em.nativeUpdate` which does not emit events, so `user.updated` would not fire after CRM linking. Staff-initiated invitations (primary path) set `customerEntityId` at creation time, making `user.created` sufficient. Self-signup edge case requires manual staff linking.
- Added User Stories section with stories for all 3 partner roles + staff.
- Added Commands section defining undo contracts for portal write operations (H1 fix).
- Added `openApi` + Zod validation requirement for all portal API routes (H3 fix).
- Added Internationalization section with `partnerships.portal.*` key namespace (M3 fix).
- Added Performance, Cache & Scale section covering query patterns and indexes (M2 fix).
- Added Migration & Backward Compatibility section confirming additive-only changes (M5 fix).
- Expanded Final Compliance Report with full checklist, AGENTS.md files reviewed, and non-compliant items (M6 fix).
- Fixed `organizationId` vs `agencyOrganizationId` note (M1 fix).

### 2026-03-18 (v2 — Post-Review Fixes)
- Fixed critical issue: partner roles must be created via direct `em.create(CustomerRole, ...)` in `seedDefaults`, not via `defaultCustomerRoleFeatures` (which can only merge features into existing roles).
- Fixed module count: 13 core modules, not 14.
- Added `portal.partner.profile.view` feature for read-only case study/profile access.
- Fixed data link: join uses `PartnerAgency.agencyOrganizationId` (not `organizationId` which is tenant scoping).
- Fixed RFP event name: `partnerships.partner_rfp.issued` (matching existing events.ts declaration).
- Fixed team management auth: Partner Admin gets `portal.users.manage` + `portal.users.view` from `customer_accounts` namespace.
- Added pagination spec and standard error responses to portal API contracts.
- Note: SPEC-060's feature table lists `portal.partner.access` and `portal.partner.rfp.respond` as examples. This spec extends that set — SPEC-060's table is a minimum, not exhaustive.

### 2026-03-18 (v1 — Initial)
- Created SPEC-053c to formalize the dependency between SPEC-053 (PRM) and SPEC-060 (Customer Identity).
- Defined minimal 13 core module composition for PRM starter.
- Designed partner portal with 6 pages, 3 roles, and `portal.partner.*` feature namespace.
- Defined integration patterns: auto-role assignment subscriber, RFP notification subscriber, CRM company entity as join point.
- 5-phase implementation plan targeting module slimming, RBAC, portal dashboard/KPI, RFP pages, and case studies.
