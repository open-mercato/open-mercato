# Customers Leads Phase 1

## TLDR

**Key Points:**

- Add a first phase of first-class `lead` records inside the existing `customers` module.  
- Phase 1 keeps leads separate from deals, supports manual CRUD, table/detail/kanban views, and one-time conversion from lead to deal.  
- This spec intentionally narrows the broader [`2026-04-03-customers-lead-funnel.md`](http://2026-04-03-customers-lead-funnel.md) concept to a reviewable MVP PR.

**Scope:**

- New `CustomerLead` domain model, validators, commands, CRUD API, ACL, default role grants, search/index integration, setup defaults, and i18n.  
- Backend UI for `/backend/customers/leads`, `/backend/customers/leads/create`, `/backend/customers/leads/[id]`, and `/backend/customers/leads/kanban`.  
- Status-based kanban with `open`, `in_progress`, `qualified`, and `rejected`.  
- Qualification flow that opens a conversion dialog with checkboxes for creating a deal, person/contact, and company from lead candidate fields.  
- One-time conversion lineage for every record created during qualification.

**Out of Scope for Phase 1:**

- Lead-specific configurable pipelines/stages, duplicate detection, raw source payload retention, lead field bindings, lead analytics, AI widgets, dashboard widgets, inbound form/API ingestion, and lead settings screens.  
- Lead-specific activities, todos, timeline entries, and scheduled follow-ups on active leads. In Phase 1, calls/meetings/tasks are recorded only after qualification on the created person, company, or deal. A later phase should add lead-level follow-up handling so operators can schedule actions such as a call on a still-active lead.

**Concerns:**

- The first implementation must not copy the full deals implementation blindly; it should reuse deals patterns only where they fit the smaller lead MVP.  
- Conversion must be atomic enough that a lead cannot be converted twice or left pointing at a missing deal.  
- Lead fields include PII/free text and must follow Open Mercato encryption/decryption rules.

## Overview

Leads are an early-stage sales intake object in `customers`. They represent a commercial signal before it becomes a full sales opportunity. Unlike `CustomerDeal`, a lead is used for qualification: deciding whether the topic is worth turning into a deal.

Phase 1 favors a pragmatic CRM workflow:

- create or import a lead manually,  
- assign an owner,  
- qualify it through a simple status flow,  
- review it in table, detail, and kanban views,  
- optionally create a deal, person/contact, and company from the lead when qualification succeeds.

While the lead is active, it is not linked to a person, company, or deal. It stores candidate data that may later be mapped into canonical CRM objects.

Phase 1 intentionally keeps active leads operationally lightweight: it does not add a lead timeline or lead-specific activity/task storage. This means a salesperson cannot yet schedule a call directly on an unqualified lead; after qualification, follow-up work is recorded on the created person, company, or deal. Lead-level activities and scheduled follow-ups are planned as a later expansion once the core lead object and conversion flow are stable.

The broader April lead-funnel spec remains the long-term direction. This Phase 1 spec is the implementation slice intended for the first PR.

**Market Reference**: Salesforce, HubSpot, and OroCRM all model leads as separate pre-opportunity records. Phase 1 adopts that separation and conversion lineage, but rejects configurable lead pipelines, duplicate intelligence, and source-ingestion complexity for the first PR.

## Problem Statement

Open Mercato currently has people, companies, and deals, but no dedicated place for early commercial signals. Users either create deals too early or overload people/companies with lead-like status fields. This makes it harder to separate qualification work from real sales opportunities and weakens reporting around incoming topics.

Phase 1 solves the operational gap without introducing the full inbound marketing stack.

## Proposed Solution

Add a `CustomerLead` entity inside `packages/core/src/modules/customers` using existing customers patterns:

- singular entity/command/event naming: `customers.lead.*`,  
- `organization_id` and `tenant_id` on every scoped table,  
- zod validators for create/update/convert,  
- command-backed mutations with undo snapshots where applicable,  
- `makeCrudRoute` for CRUD/list API with `indexer: { entityType }`,  
- custom write route for conversion with mutation guards,  
- `DataTable` for the list,  
- `CrudForm` for create/edit where practical,  
- `useGuardedMutation` for kanban drag/drop and conversion.

When a lead is moved into qualification, the UI opens a conversion dialog. The user chooses which canonical records to create:

- create sales opportunity (`CustomerDeal`);  
- create person/contact (`CustomerEntity` kind `person` \+ `CustomerPersonProfile`);  
- create company (`CustomerEntity` kind `company` \+ `CustomerCompanyProfile`).

When multiple boxes are selected, created records are linked together. If all three boxes are selected, the result is:

- a deal created from lead/deal candidate fields;  
- a person created from potential-contact fields;  
- a company created from potential-company fields;  
- person linked to company;  
- deal linked to person and company;  
- lead updated with conversion lineage to all created records.

The three conversion choices are independent. The user may create only a person, only a company, only a deal, or any combination. Links are created only between records produced in the same conversion payload.

A converted lead remains readable as source history and cannot run the same conversion flow again.

For Phase 1, `qualified` is a concrete conversion outcome, not just a label. A lead may move to `qualified` only when the conversion flow creates at least one downstream record: person, company, or deal. If the operator wants to keep evaluating the lead without creating anything, the lead remains `open` or `in_progress`.

`qualified` is conversion-owned. Normal create, update, and status-update commands must reject attempts to set `status = qualified`; only `customers.lead.convert` may set it, and only after at least one selected downstream record has been created and lineage is ready to persist. This prevents list edits, direct API writes, or kanban drag/drop from creating a false qualified lead with no person/company/deal outcome.

Leads are visible by default for standard CRM users after the feature ships. Phase 1 does not include an admin setting to turn the Leads area on/off; that can be added later if some customers need to hide the workflow.

## User Stories / Use Cases

- **Sales rep** wants to capture a lead without creating a customer or deal too early.  
- **Sales rep** wants to see leads in a table for scanning, filtering, and sorting.  
- **Sales rep** wants to manage lead flow in a kanban board similar to Deals.  
- **Sales rep** wants to qualify a lead and choose whether to create a deal, a person/contact, a company, or any combination.  
- **Manager** wants a simple, consistent workflow where `qualified` means the lead produced at least one real CRM record.

## Architecture

Lead capability lives entirely inside `packages/core/src/modules/customers/` and follows the existing customers module contract.

### Commands & Events

**Commands**

- `customers.lead.create`  
- `customers.lead.update`  
- `customers.lead.update_status`  
- `customers.lead.convert`  
- `customers.lead.delete`

**Events**

- `customers.lead.created`  
- `customers.lead.updated`  
- `customers.lead.status_changed`  
- `customers.lead.converted`  
- `customers.lead.deleted`

Conversion is a compound command inside the customers module. It creates downstream customers/deals through existing customers command/service patterns and performs the lead lineage update in the same logical operation.

Implementation constraint: conversion must not simply call the existing `customers.people.create`, `customers.companies.create`, and `customers.deals.create` commands one after another if that would split the operation into multiple transactions or emit side effects before the lead lineage commit. The conversion command should use shared internal builders/helpers or a dedicated transaction-aware path so all selected records, links, lead status, and lineage fields commit together. CRUD/index/events for the created downstream records and the lead conversion event should fire only after the transaction succeeds.

### Transaction and Undo Contract

- Lead create/update/delete/status changes are undoable through command snapshots.  
- Conversion is atomic for database writes: either all selected records and lineage fields are persisted, or none are.  
- Conversion validates the selected target records before the transaction starts:  
  - `createPerson` requires enough lead/contact data to satisfy the current person contract: `contact_first_name` and `contact_last_name`.  
  - `createCompany` requires `company_name`.  
  - `createDeal` uses the optional deal title override when provided, otherwise defaults to the lead `title`; any pipeline/stage/value overrides must pass the existing deal validation rules.  
- Conversion undo is limited to lead lineage/status rollback plus best-effort compensation for records created in the conversion. If a created person/company/deal has been independently modified after conversion, the undo path must not silently delete it.  
- Events and indexing side effects fire after successful persistence through existing CRUD side-effect helpers.

## Data Models

### CustomerLead

Table: `customer_leads`

- `id`: UUID primary key  
- `organization_id`: UUID required  
- `tenant_id`: UUID required  
- `title`: text required  
- `description`: text nullable  
- `status`: text required, one of `open`, `in_progress`, `qualified`, `rejected`  
- `source`: text nullable  
- `owner_user_id`: UUID nullable  
- `estimated_value_amount`: numeric nullable  
- `estimated_value_currency`: text nullable, 3-letter code  
- `company_name`: text nullable  
- `company_vat_id`: text nullable  
- `contact_first_name`: text nullable  
- `contact_last_name`: text nullable  
- `contact_phone`: text nullable  
- `contact_email`: text nullable  
- `created_deal_id`: UUID nullable  
- `created_person_entity_id`: UUID nullable  
- `created_company_entity_id`: UUID nullable  
- `converted_at`: timestamptz nullable  
- `converted_by_user_id`: UUID nullable  
- `created_at`: timestamptz required  
- `updated_at`: timestamptz required  
- `deleted_at`: timestamptz nullable

Indexes:

- `(organization_id, tenant_id, status, created_at)`  
- `(organization_id, tenant_id, owner_user_id, created_at)`  
- `(organization_id, tenant_id, created_at)`  
- `(organization_id, tenant_id, converted_at)`  
- optional search-supporting indexes for `contact_email`, `contact_phone`, and `company_vat_id` if query plans require them.

No active foreign-key relationship to person/company/deal is used before qualification. Lineage IDs are populated only after conversion creates records.

### Custom Entity Registration

Add `customers:customer_lead` in `ce.ts` with label `Customer Lead`, `labelField: 'title'`, and `showInSidebar: false`.

### Encryption

Update `packages/core/src/modules/customers/encryption.ts` with a `customers:customer_lead` map.

Encrypted fields:

- `title`  
- `description`  
- `source`  
- `company_name`  
- `company_vat_id`  
- `contact_first_name`  
- `contact_last_name`  
- `contact_phone`  
- `contact_email`

Reads that return lead rows/details must use `findWithDecryption` / `findOneWithDecryption` with tenant and organization scope.

## API Contracts

### List/Create/Update/Delete Leads

Route: `GET/POST/PUT/DELETE /api/customers/leads`

Metadata:

- `GET`: `requireAuth: true`, `requireFeatures: ['customers.leads.view']`  
- `POST`, `PUT`, `DELETE`: `requireAuth: true`, `requireFeatures: ['customers.leads.manage']`

Implementation:

- use `makeCrudRoute`;  
- set `indexer: { entityType: E.customers.customer_lead }`;  
- export `openApi`;  
- support `page`, `pageSize <= 100`, `search`, `status`, `ownerUserId`, `source`, `sortField`, and `sortDir`.

Create/update payload fields:

- lead basics: `title`, `description`, `status`, `source`, `ownerUserId`, estimated value/currency;  
- potential company: `companyName`, `companyVatId`;  
- potential contact: `contactFirstName`, `contactLastName`, `contactPhone`, `contactEmail`.

Create/update status rules:

- `POST` may omit status or set `open`, `in_progress`, or `rejected`; it must reject `qualified`.  
- `PUT` may update status to `open`, `in_progress`, or `rejected`; it must reject `qualified`.  
- A converted lead (`convertedAt` set) remains readable and may not be converted again. Any edit behavior after conversion must preserve lineage fields and must not reopen the conversion flow.

List/detail/kanban responses must expose camelCase fields, including:

- identity/scope: `id`, `organizationId`, `tenantId`;  
- editable lead fields: `title`, `description`, `status`, `source`, `ownerUserId`, `estimatedValueAmount`, `estimatedValueCurrency`;  
- candidate company/contact fields: `companyName`, `companyVatId`, `contactFirstName`, `contactLastName`, `contactPhone`, `contactEmail`;  
- conversion lineage: `createdDealId`, `createdPersonEntityId`, `createdCompanyEntityId`, `convertedAt`, `convertedByUserId`;  
- timestamps: `createdAt`, `updatedAt`, `deletedAt`.

`updatedAt` is required in every list/detail/kanban payload used by edit, delete, status change, or conversion UI so optimistic locking can be derived by `CrudForm` or passed through custom guarded mutations.

### Lead Detail

Route: `GET/PUT/DELETE /api/customers/leads/[id]`

Returns one lead with decrypted fields, optimistic-lock `updatedAt`, and conversion lineage IDs.

### Convert Lead

Route: `POST /api/customers/leads/[id]/convert`

Metadata:

- `requireAuth: true`  
- `requireFeatures: ['customers.leads.manage']`

Request:

{

  "createDeal": true,

  "createPerson": true,

  "createCompany": true,

  "deal": {

    "title": "Optional override",

    "pipelineId": "uuid-or-null",

    "pipelineStageId": "uuid-or-null",

    "valueAmount": 1000,

    "valueCurrency": "PLN"

  }

}

Rules:

- reject when `createDeal`, `createPerson`, and `createCompany` are all false;  
- reject if `convertedAt` is already set;  
- reject if the optimistic-lock expected `updatedAt` header does not match the current lead version when optimistic locking is enabled;  
- reject `createPerson` when the lead lacks `contactFirstName` or `contactLastName`;  
- reject `createCompany` when the lead lacks `companyName`;  
- use the lead title as the deal title unless `deal.title` is supplied;  
- successful conversion sets `status = qualified`;  
- if a company and person are created in the same request, link the person to the company;  
- if a deal and person/company are created in the same request, link the deal to those records;  
- if only a deal is created, the deal is created without customer links. This matches the current Deals contract where `personIds` and `companyIds` are optional.  
- custom write route implementation must call `validateCrudMutationGuard` before conversion and `runCrudMutationGuardAfterSuccess` after successful conversion when requested by the platform guard context.  
- route and command implementation must preserve the one-transaction conversion contract described in Architecture; downstream create side effects must not be emitted before lead lineage is committed.

## Internationalization

Add PL/EN/DE/ES keys for:

- navigation: Leads, Leads kanban;  
- list columns, filters, empty state, loading/error text;  
- form labels for lead basics, potential company, potential contact;  
- status labels: open, in progress, qualified, rejected;  
- qualification dialog title, description, checkbox labels, validation message, submit/cancel labels;  
- success/error flash messages for create/update/delete/status change/conversion.

## UI/UX

The Leads list and kanban should feel like the existing Deals list and Deals kanban. Reuse the same interaction model, density, navigation patterns, status presentation, row/card actions, loading/error/empty states, and toolbar conventions unless a lead-specific workflow requires a smaller variant.

### Routes

- `/backend/customers/leads`  
- `/backend/customers/leads/create`  
- `/backend/customers/leads/[id]`  
- `/backend/customers/leads/kanban`

### Backend UI Design Requirements

- Use `Page`, `PageHeader`/`FormHeader`, and `PageBody` for backend page structure; no custom page chrome.  
- Use `DataTable` for the leads table with stable IDs: `entityId="customers:customer_lead"` and `extensionTableId="customers.leads.list"`.  
- Use `RowActions` with stable action IDs such as `open`, `edit`, `qualify`, and `delete`; row click should resolve through the standard `open`/`edit` action pattern.  
- Use `CrudForm` for create/edit flows where practical. Any non-`CrudForm` write, including kanban status changes and qualification conversion, must use `useGuardedMutation`.  
- For custom non-`CrudForm` writes, wrap the API call with `withScopedApiRequestHeaders(buildOptimisticLockHeader(lead.updatedAt), ...)` and let `useGuardedMutation`/`surfaceRecordConflict(err, t)` surface stale-record 409 conflicts.  
- Put the qualification action in the detail `FormHeader` actions menu. The dialog must use shared `Dialog` primitives and support `Cmd/Ctrl+Enter` submit plus `Escape` cancel.  
- Use shared primitives only: `Button`/`IconButton`, `StatusBadge` or `EnumBadge` for lead status, `EmptyState`, `LoadingMessage`, `ErrorMessage`, `ErrorNotice`, and `flash()`.  
- Use `PhoneNumberField` for contact phone and standard email/text inputs through `CrudForm` field definitions.  
- Use `apiCall`/`apiCallOrThrow`/CRUD helpers for UI HTTP. Do not use raw `fetch`.  
- All visible strings must use i18n keys via `useT()` or server translation helpers.  
- No hardcoded status colors, arbitrary text sizes, inline SVG icons, raw buttons, raw checkboxes, `window.confirm`, or custom toast implementations.

### Kanban

- One fixed Phase 1 lead funnel with lanes: `open`, `in_progress`, `qualified`, `rejected`.  
- Dragging to `qualified` opens the qualification dialog before persisting the status.  
- Dragging between `open`, `in_progress`, and `rejected` updates status directly through guarded mutation.  
- The kanban must not persist a raw status update to `qualified`; only the qualification dialog submit calls the convert route.  
- Future work may add editable lead funnels/stages; Phase 1 does not include lead pipeline configuration.

## Frontend Architecture Contract

### Server/Client Boundary Map

| Route / surface | Server root | Client islands | Data owner | Notes |
| :---- | :---- | :---- | :---- | :---- |
| `/backend/customers/leads` | page wrapper/meta | Leads list client | `/api/customers/leads` | Mirror Deals list pattern; keep DataTable island scoped |
| `/backend/customers/leads/create` | page wrapper/meta | CrudForm client | `/api/customers/leads` | Create-only form |
| `/backend/customers/leads/[id]` | page wrapper/meta | Lead detail/form client, QualificationDialog | `/api/customers/leads/[id]`, convert route | Must distinguish loading/not-found/error/ready |
| `/backend/customers/leads/kanban` | page wrapper/meta | LeadsKanbanClient, QualificationDialog | `/api/customers/leads` and convert/status routes | May reuse deals kanban patterns but not full deals KPI surface |

### `"use client"` Ledger

| File | Reason | Heavy deps? | Guardrail |
| :---- | :---- | :---- | :---- |
| `LeadsListClient` | DataTable state, filters, row actions | DataTable only | Keep under route-local client island |
| `LeadFormClient` | form state and guarded writes | CrudForm only | Reuse shared field builders across create/detail |
| `LeadDetailClient` | detail state, status actions, qualification dialog host | CrudForm/detail primitives only | Must render loading/notFound/error/ready states distinctly |
| `LeadsKanbanClient` | drag/drop and lane state | dnd-kit if reused from deals kanban | Avoid copying unrelated Deals KPI/filter complexity |
| `LeadQualificationDialog` | checkbox state and guarded submit | no | Embedded dialog only |

### Budgets

- 0 new global providers.  
- 0 page-root client blobs where a route-local island can be used.  
- Page/client files over 300 LOC require extraction or explicit justification.  
- No new heavy browser libraries beyond the existing deals kanban dependency set.  
- Each interactive route needs a hydration/smoke test before PR.

## Configuration

No admin enable/disable setting in Phase 1\. Leads are visible by default to CRM users with leads view permission.

## Migration & Compatibility

- Additive schema only.  
- No changes to existing people/company/deal behavior.  
- Existing tenants need role ACL sync so standard users receive `customers.leads.view` / `customers.leads.manage`.  
- No backfill is required.  
- Existing broader April lead-funnel spec remains future direction; Phase 1 does not implement its configurable pipeline/source-payload/binding sections.

### Backward Compatibility Surface Review

| Surface | Phase 1 impact |
| :---- | :---- |
| Auto-discovery files | Additive edits only; keep existing export names in `acl.ts`, `setup.ts`, `ce.ts`, `events.ts`, `search.ts`, and `encryption.ts`. |
| Types/interfaces | Add new lead schemas/types only; do not narrow existing customers/deals contracts. |
| Function signatures | No public signature changes. |
| Import paths | No moved imports or removed re-exports. |
| Event IDs | Add new `customers.lead.*` event IDs only. |
| Widget spot IDs | Add new stable DataTable/Form surfaces only. |
| API routes | Add new `/api/customers/leads` routes only. |
| Database schema | Add new `customer_leads` table/indexes only. |
| DI service names | No new DI key required unless implementation explicitly introduces a narrow additive service. |
| ACL feature IDs | Add `customers.leads.view` and `customers.leads.manage`; do not rename existing IDs. |
| Notification IDs | No notification type changes in Phase 1\. |
| CLI commands | No CLI command changes in Phase 1\. |
| Generated file contracts | Run `yarn generate`; do not hand-edit generated files or change generated export contracts. |

## Cache, Indexing, and Search

- CRUD list/detail routes rely on the existing CRUD/query-index integration with `indexer: { entityType: E.customers.customer_lead }`.  
- Lead writes must use existing CRUD side-effect helpers so query index updates, events, and cache invalidation follow the customers module pattern.  
- No new Redis/SQLite cache is introduced in Phase 1\.  
- Any cache tags used by shared CRUD helpers must remain tenant/org scoped.  
- Search should include lead title, source, and potential company/contact names when query-index field policy is wired.  
- PII/exact-match fields (`contact_email`, `contact_phone`, `company_vat_id`) must be configured as `fieldPolicy.hashOnly` for search. They may support exact-match/filtering but must not be used for fuzzy/vector text indexing.  
- Vector `buildSource` must not include email, phone, VAT ID, or other sensitive contact identifiers. If `description` or `source` are indexed semantically, the implementation must document why the privacy risk is acceptable for tenant-scoped search; otherwise exclude them from vector text and keep them in encrypted CRUD responses only.

## Implementation Plan

### Phase 1: Data, ACL, and Spec-safe Foundation

1. Add `CustomerLead` entity, validators, encryption map, custom entity registration, migration, and snapshot.  
2. Add `customers.leads.view` / `customers.leads.manage` to ACL and default role grants.  
3. Add lead events to `events.ts`.

### Phase 2: Commands and API

1. Implement lead CRUD commands and route via `makeCrudRoute`.  
2. Implement status update command that rejects `qualified`; `qualified` is convert-only.  
3. Implement convert command and `/api/customers/leads/[id]/convert` route with mutation guards.  
4. Add OpenAPI exports.

### Phase 3: UI

1. Add page metadata/navigation for list, create, detail, and kanban.  
2. Build leads list using DataTable and Deals-like layout.  
3. Build lead create/detail using CrudForm/FormHeader.  
4. Build qualification dialog.  
5. Build simple status kanban.

### Phase 4: Tests and Polish

1. Add unit/API tests for validators, CRUD, status, conversion, and ACL.  
2. Add UI/component tests for list/detail/dialog/kanban critical interactions.  
3. Add one integration or QA scenario covering create lead \-\> qualify \-\> create person/company/deal.  
4. Run final build/check commands and local smoke.

## Testing Strategy

- `yarn build:packages`  
- targeted `@open-mercato/core` tests for customers leads API/commands  
- `git diff --check`  
- i18n sync check if available in the repo workflow  
- API/unit coverage:  
  - create lead with default `open` status;  
  - reject create/update/status update to `qualified`;  
  - update lead candidate company/contact fields and return fresh `updatedAt`;  
  - list filters for `status`, `ownerUserId`, `source`, and search;  
  - convert person-only, company-only, deal-only, person+company, deal+person, deal+company, and all three;  
  - reject conversion with all checkboxes false;  
  - reject duplicate conversion when `convertedAt` is already set;  
  - reject selected person/company conversion when required candidate fields are missing;  
  - reject stale optimistic-lock conversion/status writes with structured 409 conflict;  
  - verify tenant/organization scoping on every read/write.  
- UI/component coverage:  
  - list renders DataTable columns/actions and opens detail/create paths;  
  - detail has dedicated loading/not-found/error/ready states;  
  - qualification dialog validates checkbox requirements and supports `Cmd/Ctrl+Enter` / `Escape`;  
  - kanban drag to `qualified` opens dialog and does not persist raw qualified status;  
  - kanban drag to `open`, `in_progress`, or `rejected` sends guarded status mutation with optimistic-lock header.  
- local smoke on `localhost:3000`:  
  - create lead;  
  - edit potential company/contact fields;  
  - view in list;  
  - move in kanban;  
  - qualify with only person;  
  - qualify with all three selected;  
  - verify created records and links.

## Risks & Impact Review

#### Partial Conversion Writes

- **Scenario**: Conversion creates a person or deal but fails before lead lineage is saved.  
- **Severity**: High  
- **Affected area**: Lead conversion, CRM data integrity  
- **Mitigation**: Run conversion in one transaction and persist lineage in the same command.  
- **Residual risk**: After-commit events/indexing can still lag, but canonical records remain consistent.

#### Duplicate Real-world Customers

- **Scenario**: Operator creates a new person/company from a lead that matches an existing CRM record.  
- **Severity**: Medium  
- **Affected area**: CRM data quality  
- **Mitigation**: Duplicate detection is explicitly out of Phase 1; UI labels must make "create new" clear.  
- **Residual risk**: Manual duplicates can happen until a later duplicate-check phase.

#### Sensitive Lead Data Exposure

- **Scenario**: Lead contact/company fields contain PII and are read without decryption scope or shown to users without permission.  
- **Severity**: High  
- **Affected area**: Privacy, tenant isolation  
- **Mitigation**: Add encryption map, use scoped `findWithDecryption`, gate routes with `customers.leads.view/manage`, and filter every query by `organization_id` and `tenant_id`.  
- **Residual risk**: Free-text descriptions can contain unexpected sensitive content; encryption mitigates at-rest exposure.

#### Kanban Scope Creep

- **Scenario**: Implementers copy the full Deals kanban including KPIs, filters, bulk actions, and AI widgets, making PR too large.  
- **Severity**: Medium  
- **Affected area**: Reviewability, performance, delivery time  
- **Mitigation**: Phase 1 kanban is fixed-lane status workflow only; advanced Deals features are explicitly out of scope.  
- **Residual risk**: Some Deals behavior may still be desirable later and should be split into future PRs.

#### Deal-only Conversion Produces Unlinked Deal

- **Scenario**: User selects only `createDeal`, producing a deal without a person/company link.  
- **Severity**: Low  
- **Affected area**: Sales follow-up workflow  
- **Mitigation**: This is allowed in Phase 1 because conversion choices are intentionally independent and the current Deals contract supports optional `personIds` / `companyIds`.  
- **Residual risk**: Teams may later decide that deals should always have a customer link; that would be a separate business rule change.

## Final Compliance Report \- 2026-06-13

### AGENTS.md Files Reviewed

- root workspace `AGENTS.md`  
- `packages/core/AGENTS.md`  
- `packages/core/src/modules/customers/AGENTS.md`  
- `packages/ui/AGENTS.md`  
- `packages/ui/src/backend/AGENTS.md`  
- `.ai/skills/om-spec-writing/SKILL.md`  
- `.ai/skills/om-backend-ui-design/SKILL.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| :---- | :---- | :---- | :---- |
| customers AGENTS.md | Use customers module as CRUD reference | Compliant | Leads follows customers commands/API/UI pattern |
| core AGENTS.md | API routes export `openApi` | Compliant | Required for CRUD and convert routes |
| core AGENTS.md | Use `makeCrudRoute` with `indexer` | Compliant | Required for `/api/customers/leads` |
| core AGENTS.md | Custom write routes use mutation guards | Compliant | Convert route requires before/after mutation guard calls |
| core AGENTS.md | Encrypt sensitive customer data | Compliant | Lead encryption map required |
| core AGENTS.md | No cross-module ORM relationships | Compliant | All downstream links are UUID lineage IDs |
| UI AGENTS.md | Use DataTable/CrudForm/apiCall/useGuardedMutation | Compliant | Required in UI section |
| backend UI skill | Backend pages mirror DS patterns | Compliant | Explicit design requirements added |

### Internal Consistency Check

| Check | Status | Notes |
| :---- | :---- | :---- |
| Data models match API contracts | Pass | Candidate fields and lineage fields are represented in APIs |
| API contracts match UI/UX | Pass | List/detail/kanban/convert routes support planned UI |
| Risks cover write operations | Pass | CRUD/status/conversion risks covered |
| Commands defined for mutations | Pass | All write flows mapped to commands |
| Scope is reviewable | Pass | AI, dashboards, duplicate detection, configurable pipelines deferred |
| Cache strategy covers read APIs | Pass | No new cache; CRUD/query-index and tenant/org-scoped invalidation required |

### Non-Compliant Items

- None at spec stage.

### Verdict

- **Fully compliant**: Approved for Phase 1 implementation.

## Changelog

### Review \- 2026-06-13

- **Reviewer**: Agent  
- **Security**: Passed after requiring customer lead encryption map and scoped decrypted reads.  
- **Performance**: Passed with fixed Phase 1 kanban scope, page-size limits, and lead list indexes.  
- **Cache**: Passed; no new cache introduced, shared CRUD/query-index side effects required.  
- **Commands**: Passed after requiring command-backed CRUD/status/conversion and mutation guards for the custom convert route.  
- **Risks**: Passed; conversion, duplicate, PII, scope creep, and deal-only conversion risks documented.  
- **Verdict**: Approved.

### 2026-06-13

- Clarified that Phase 1 does not include lead-specific activities/todos/timeline or scheduled follow-ups on active leads; this is planned for a later phase.  
- Completed final checklist/compliance review and resolved the deal-only conversion ambiguity against the current Deals contract.  
- Expanded skeleton into a full Phase 1 implementation specification with data model, API contracts, frontend architecture contract, implementation plan, testing strategy, risks, and compliance report.  
- Clarified that Leads list and kanban should mirror the established Deals list/kanban UX, with lead-specific simplifications only where needed.  
- Added backend UI design requirements from `om-backend-ui-design`, `packages/ui/AGENTS.md`, and `packages/ui/src/backend/AGENTS.md`.  
- Resolved qualification semantics: `qualified` requires successful creation of at least one downstream record.  
- Resolved rollout default: Leads is visible by default for standard CRM users in Phase 1; no admin enable/disable setting in this PR.  
- Resolved conversion scope: deal/person/company creation choices are independent, including person-only or company-only conversion.  
- Resolved Phase 1 kanban direction: one fixed lead funnel at `/backend/customers/leads/kanban`; editable lead funnels are future work.  
- Captured the Phase 1 active-lead model: no active links to person/company/deal, candidate company/contact fields stored on lead, and qualification dialog with create deal/person/company checkboxes.  
- Initial Phase 1 skeleton created from user decisions and narrowed from the broader April lead-funnel spec.

