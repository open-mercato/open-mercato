# Customers Lead Funnel

## TLDR
**Key Points:**
- Add a first-class `lead` capability inside the existing `customers` module as a separate CRM area with its own list, detail page, pipelines, qualification workflow, conversion flow, analytics, and automation support.
- `Lead` is a dedicated staging object, not just `customer_entity.lifecycleStage = lead`. It exists to stop spam, bots, and low-quality inbound traffic from polluting canonical CRM records too early.
- A lead has its own ID, source payload, history, duplicate-check state, and explicit lineage to `person`, `company`, and `deal` records created or linked during qualification and conversion.
- Leads support multiple configurable pipelines from v1.
- Some lead fields are lead-only, while some are shared views of fields owned by downstream objects (`company`, `person`, `deal`). Shared fields must prefill created records and stay synchronized after linking/conversion.

**Scope:**
- New lead domain model, API, ACL, events, search, and setup defaults in `customers`
- Dedicated backend lead list, lead detail, and pipeline board
- Configurable multi-pipeline lead model with stages and lost reasons
- Tenant-level enable/disable setting for the lead capability
- Conversion flow to create or link `person`, `company`, `deal`, or combinations of them
- Duplicate detection against existing `people` / `companies` by email, phone, VAT ID
- Raw inbound payload retention for audit, analytics, and future remapping
- Manual create/link of person/company before final lead closure
- Dashboard, reporting, search, and automation support

**Concerns:**
- Shared fields must not create a second competing source of truth after link/conversion.
- Conversion and manual linking must preserve lineage without breaking existing `customers` / `deals` contracts.
- Pipeline and stage design must be future-proof without overcomplicating the MVP shape.

## Overview
This specification introduces a dedicated lead funnel inside the `customers` CRM domain. Leads represent inbound commercial signals that are not yet canonical CRM records. They may come from forms, API ingestion, external CRM sync, campaign captures, and similar sources where data quality is uncertain and where spam or duplicates are common.

Instead of creating `person`, `company`, or `deal` objects immediately, the system stores the signal as a `lead`, routes it through a configurable qualification pipeline, and only then allows operators to create or link downstream CRM objects.

The lead area lives inside `customers`, similar in product weight to `deals`, but with a different purpose:
- `leads`: intake, triage, qualification, anti-spam buffer, provenance, source analytics
- `people` / `companies`: canonical CRM records
- `deals`: commercial opportunities

The platform must support two tenant-selectable CRM operating models:
- **Direct CRM model**: `deal -> person/persons -> company`
- **Lead-first CRM model**: `lead -> deal -> person/persons -> company`

Leads are therefore an optional capability, not a mandatory CRM layer for every tenant.

> **Market Reference**: The closest reference model is the dedicated lead object found in Salesforce, HubSpot, and OroCRM. Open Mercato should adopt the dedicated pre-CRM object and explicit conversion lineage, while keeping implementation aligned with existing `customers` CRUD, command, event, dictionary, and UI patterns.

## Problem Statement
Current CRM primitives are optimized for canonical records, not noisy inbound intake.

This creates several problems:
- Spam, bots, and low-quality submissions can pollute `people` and `companies`.
- Teams lack a structured qualification space before creating real CRM objects.
- Conversion attribution is weak when a downstream record originated from inbound acquisition.
- Reporting on lead quality, source effectiveness, lost reasons, and funnel conversion is difficult.
- Existing `status`, `lifecycleStage`, and `source` fields on customer entities do not model a full lead intake and conversion workflow.
- Some business fields conceptually belong to downstream objects, but users still need to see and edit them during the lead process.

## Proposed Solution
Introduce a dedicated `customer_lead` domain inside `customers` with its own storage, APIs, UI, search coverage, events, and conversion contract.

### Core Rules
1. A lead is a first-class CRM record with its own ID and history.
2. A lead may contain person-side data, company-side data, deal-side data, and lead-only data in one workspace.
3. Leads are created primarily from external sources, but manual creation is supported.
4. Leads support multiple configurable pipelines from v1.
5. The lead capability can be enabled or disabled per tenant from settings.
5. Duplicate detection checks existing CRM data by email, phone, and VAT ID, warns the operator, and links to possible matches without blocking creation.
6. Operators may manually create and link `person` / `company` objects during qualification before final lead closure.
7. A successful lead conversion allows choosing whether to create new records or link to existing ones.
8. Losing a lead requires a configurable lost reason.
9. Raw source payload and ingest metadata are retained.
10. The lead remains in the system after conversion as the source record for analytics, attribution, and audit.
11. Some fields are lead-only. Some are shared with `person`, `company`, or `deal` and must behave as surfaced views of canonical downstream fields after a link exists.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Separate `lead` entity instead of `customer_entity.lifecycleStage = lead` | Prevents premature CRM pollution and preserves intake lineage |
| Lead stays after conversion | Needed for analytics, attribution, and audit |
| Multi-pipeline support in v1 | Explicit user requirement and avoids immediate redesign |
| Lead capability is tenant-optional | Some customers want a direct deal-driven CRM without lead qualification |
| Duplicate detection is advisory, not blocking | Sales intake is messy; false positives must not block work |
| Retain raw source payload | Supports debugging, provenance, remapping, and analytics |
| Allow manual create/link before closure | Matches real qualification workflows |
| Shared fields are projections of downstream-owned fields after link | Prevents dual truth while keeping the lead UI practical |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Use only `customer_entities` with `lifecycleStage = lead` | Pollutes canonical CRM and weakens conversion lineage |
| Auto-create `person` / `company` first, then qualify | Defeats the anti-spam staging purpose |
| Block duplicates hard | Too rigid for real sales operations |
| Copy shared fields once at conversion and never sync again | Violates user requirement and creates drift |

## User Stories / Use Cases
- **Sales ops** wants inbound traffic to land in a lead queue so spam does not pollute CRM.
- **Sales rep** wants to review, assign, qualify, enrich, and convert a lead into the right CRM objects.
- **Sales rep** wants to create or link a person/company during qualification without closing the lead.
- **Manager** wants to measure pipeline throughput, source quality, conversion rate, and lost reasons.
- **Admin** wants to configure pipelines, stages, lost reasons, custom fields, and shared-field exposure rules without code changes.
- **Integrator** wants to send leads into OM through APIs/forms and keep full source provenance.

## Architecture
Lead capability is implemented inside `packages/core/src/modules/customers/` and follows existing `customers` patterns:
- undoable commands for mutations
- `makeCrudRoute` + `openApi` for CRUD/list routes
- dictionary/config patterns for configurable values
- `DataTable` and `CrudForm` for backend UI
- events/subscribers for side effects
- additive schema only

### Domain Layers
1. **Lead Core**
   - `customer_leads`
   - lead validators
   - lead commands
   - lead CRUD/list/detail APIs
   - lead search/index coverage
2. **Lead Configuration**
   - lead pipelines
   - pipeline stages
   - lost reasons
   - shared-field exposure rules
   - tenant-level enable/disable setting
3. **Lead Linkage & Conversion**
   - link/create person
   - link/create company
   - convert to configured target set
   - persistent lineage
4. **Lead Analytics & Automation**
   - dashboard widgets
   - reporting dimensions
   - events for workflows/subscribers

### Canonical Ownership Model
The spec distinguishes three field categories:

1. **Lead-only fields**
   - exist only on the lead
   - never synchronize to downstream objects
   - examples: raw source metadata, qualification notes, spam score, campaign capture payload

2. **Prefill-only fields**
   - entered on the lead
   - copied into a new downstream object on create
   - after conversion/link, they are no longer synchronized

3. **Shared surfaced fields**
   - conceptually belong to downstream objects such as `company`, `person`, or `deal`
   - displayed on the lead form inside dedicated sections
   - once the downstream object is linked/created, the lead field becomes a projection/proxy to the canonical field
   - changing it on the lead updates the canonical object

Default rule:
- after a link exists, the canonical downstream object is the storage owner
- the lead page may still edit the field, but that mutation writes through to the owner object

Section storage rule:
- `person_data`, `company_data`, and `deal_data` are persistent lead-side section stores, not temporary conversion buffers
- these sections always exist as the lead workspace, before and after link/conversion
- field binding rules define per field whether the value is:
  - stored only on the lead
  - copied once into a target on create
  - rendered on the lead as a live proxy to a canonical target field

Custom field rule:
- field binding behavior applies to both standard fields and custom fields
- when an admin exposes a custom field from `company`, `person`, or `deal` on the lead card, the admin must choose binding mode explicitly
- example:
  - `company.annualRevenue` exposed on lead as `shared` means the lead shows the company-owned field and editing it on the lead updates the linked company
  - `company.comments` exposed on lead as `lead_only` means the lead may show a similarly named field in the company section, but it remains local to the lead and does not affect the company record

Conversion multiplicity rule:
- lead conversion is one-time only
- after a lead reaches converted/won state, the system must not allow a second conversion workflow creating a new target plan
- post-conversion edits may still update lead data and shared bound fields, subject to permissions, but they do not reopen conversion

### Commands & Events
**Commands**
- `customers.lead.create`
- `customers.lead.update`
- `customers.lead.assign`
- `customers.lead.advance_stage`
- `customers.lead.mark_lost`
- `customers.lead.link_person`
- `customers.lead.link_company`
- `customers.lead.link_deal`
- `customers.lead.create_person`
- `customers.lead.create_company`
- `customers.lead.create_deal`
- `customers.lead.convert`
- `customers.lead.delete`

**Events**
- `customers.lead.created`
- `customers.lead.updated`
- `customers.lead.assigned`
- `customers.lead.stage_changed`
- `customers.lead.lost`
- `customers.lead.person_linked`
- `customers.lead.company_linked`
- `customers.lead.deal_linked`
- `customers.lead.person_created`
- `customers.lead.company_created`
- `customers.lead.deal_created`
- `customers.lead.converted`

### Transaction & Undo Contract
- Lead-local mutations are undoable through standard command history.
- Link/create actions are explicit commands with before/after snapshots.
- Conversion is a compound command:
  - validate lead state
  - resolve duplicate and target selections
  - create/link downstream records
  - persist lineage
  - transition lead outcome
- Undo for conversion is limited by downstream side effects:
  - unlinking/reverting lead metadata is required
  - hard-delete of created downstream records is allowed only if they have no independent modifications after creation
  - when safe full rollback is impossible, the system must record partial compensation and surface it in audit history

## Data Models
### CustomerLead (Singular)
Table: `customer_leads`

- `id`: UUID PK
- `organization_id`: UUID required
- `tenant_id`: UUID required
- `pipeline_id`: UUID required
- `stage_id`: UUID required
- `outcome`: text nullable (`open`, `won`, `lost`)
- `lost_reason_id`: UUID nullable
- `display_name`: text required
- `owner_user_id`: UUID nullable
- `source`: text nullable
- `source_channel`: text nullable
- `source_external_id`: text nullable
- `source_payload_raw`: jsonb nullable
- `source_received_at`: timestamptz nullable
- `primary_email`: text nullable
- `primary_phone`: text nullable
- `vat_id`: text nullable
- `spam_score`: numeric nullable
- `qualification_notes`: text nullable
- `person_data`: jsonb nullable
- `company_data`: jsonb nullable
- `deal_data`: jsonb nullable
- `created_person_id`: UUID nullable
- `created_company_id`: UUID nullable
- `created_deal_id`: UUID nullable
- `linked_person_id`: UUID nullable
- `linked_company_id`: UUID nullable
- `linked_deal_id`: UUID nullable
- `converted_at`: timestamptz nullable
- `converted_by_user_id`: UUID nullable
- `conversion_locked_at`: timestamptz nullable
- `created_at`: timestamptz required
- `updated_at`: timestamptz required
- `deleted_at`: timestamptz nullable

Indexes:
- `(organization_id, tenant_id, pipeline_id, stage_id, created_at)`
- `(organization_id, tenant_id, outcome, created_at)`
- `(organization_id, tenant_id, primary_email)`
- `(organization_id, tenant_id, primary_phone)`
- `(organization_id, tenant_id, vat_id)`
- `(organization_id, tenant_id, source, source_channel)`

### CustomerLeadPipeline
Table: `customer_lead_pipelines`

- `id`: UUID PK
- `organization_id`: UUID required
- `tenant_id`: UUID required
- `name`: text required
- `code`: text required stable internal identifier
- `is_default`: boolean required
- `is_active`: boolean required
- `created_at`: timestamptz required
- `updated_at`: timestamptz required

### Lead Capability Setting
Lead usage must be tenant-configurable through module/customer settings.

Required behavior:
- tenant can enable or disable leads without disabling the whole `customers` module
- when disabled:
  - lead navigation is hidden
  - lead create/list/detail/pipeline pages are inaccessible
  - lead APIs reject standard UI usage unless used for migration/admin purposes explicitly allowed by policy
  - direct CRM flow remains available: `deal -> person/persons -> company`
- when enabled:
  - lead-first CRM flow is available: `lead -> deal -> person/persons -> company`

Config storage options to finalize in implementation:
- customer module setting row in `configs` / module setup area
- or dedicated customer lead settings entity if more lead-specific switches are expected

### CustomerLeadPipelineStage
Table: `customer_lead_pipeline_stages`

- `id`: UUID PK
- `organization_id`: UUID required
- `tenant_id`: UUID required
- `pipeline_id`: UUID required
- `name`: text required
- `code`: text required
- `position`: int required
- `kind`: text required (`open`, `won`, `lost`)
- `is_active`: boolean required
- `created_at`: timestamptz required
- `updated_at`: timestamptz required

Rules:
- multiple `open` stages allowed
- exactly one or more terminal `won` / `lost` stages allowed per pipeline
- `won` stages trigger conversion flow, not immediate silent conversion

### CustomerLeadLostReason
Table: `customer_lead_lost_reasons`

- `id`: UUID PK
- `organization_id`: UUID required
- `tenant_id`: UUID required
- `pipeline_id`: UUID nullable
- `name`: text required
- `code`: text required
- `is_active`: boolean required
- `sort_order`: int required
- `created_at`: timestamptz required
- `updated_at`: timestamptz required

Rules:
- reasons may be global or pipeline-scoped
- add/remove/reorder must be admin-configurable

### CustomerLeadFieldBinding
Table: `customer_lead_field_bindings`

Purpose:
- declares which lead-visible fields are lead-only, prefill-only, or shared surfaced fields
- defines the target object owner and target path

Fields:
- `id`: UUID PK
- `organization_id`: UUID required
- `tenant_id`: UUID required
- `pipeline_id`: UUID nullable
- `lead_field_key`: text required
- `binding_mode`: text required (`lead_only`, `prefill_only`, `shared`)
- `target_entity_kind`: text nullable (`person`, `company`, `deal`)
- `target_field_key`: text nullable
- `section_kind`: text required (`lead`, `person`, `company`, `deal`)
- `is_active`: boolean required
- `created_at`: timestamptz required
- `updated_at`: timestamptz required

Notes:
- for shared bindings, the canonical target field remains source-of-truth after link/create
- UI uses binding metadata to render field origin badges/icons
- bindings apply to custom fields as well as standard fields
- bindings are resolved per field, not per section, so two fields in the same visual section may use different modes
- binding validation must prevent ambiguous ownership for a single lead field

### CustomerLeadHistory
Table: `customer_lead_history`

Purpose:
- timeline of stage transitions, assignment, duplicate warnings, links, conversion actions, and ingestion events

Fields:
- `id`: UUID PK
- `organization_id`: UUID required
- `tenant_id`: UUID required
- `lead_id`: UUID required
- `entry_type`: text required (`created`, `updated`, `stage_changed`, `duplicate_detected`, `person_linked`, `company_linked`, `deal_linked`, `person_created`, `company_created`, `deal_created`, `lost`, `converted`, `source_ingested`, `note`)
- `actor_user_id`: UUID nullable
- `message`: text nullable
- `payload`: jsonb nullable
- `created_at`: timestamptz required

Rules:
- history is append-only
- history is user-visible on the lead detail page
- conversion, link, create, and duplicate-detection actions must write explicit history entries

## API Contracts
All routes MUST export `openApi`.

### Lead CRUD
#### `GET /api/customers/leads`
- Query:
  - `page`, `pageSize<=100`
  - `search`
  - `pipelineId`
  - `stageId`
  - `outcome`
  - `ownerUserId`
  - `source`
  - `hasDuplicates`
  - `createdFrom`, `createdTo`
- Response:
  - paged list of lead rows
  - duplicate summary
  - linked/created object summary

#### `POST /api/customers/leads`
- Body:
  - lead core fields
  - section payloads
  - source metadata
  - optional initial pipeline/stage
- Response:
  - `{ id }`

#### `PUT /api/customers/leads`
- Body:
  - `id`
  - mutable lead fields
  - surfaced shared-field edits
- Response:
  - `{ ok: true }`

#### `DELETE /api/customers/leads?id=<uuid>`
- Soft delete lead record

### Qualification Actions
#### `POST /api/customers/leads/assign`
- Body: `id`, `ownerUserId`

#### `POST /api/customers/leads/advance-stage`
- Body: `id`, `stageId`
- Validation:
  - target stage must belong to lead pipeline
  - transition to terminal won stage may require conversion readiness checks
  - transition to lost stage requires `lostReasonId`
  - once a lead is converted, stage changes must not trigger a second conversion flow

#### `POST /api/customers/leads/mark-lost`
- Body: `id`, `lostReasonId`, optional `note`

### Duplicate Detection
#### `POST /api/customers/leads/duplicate-check`
- Body:
  - `primaryEmail`
  - `primaryPhone`
  - `vatId`
  - optional current lead id
- Response:
  - possible matching `people`
  - possible matching `companies`
  - confidence buckets by exact field match

### Link / Create Before Final Conversion
#### `POST /api/customers/leads/link-person`
- Body: `leadId`, `personId`

#### `POST /api/customers/leads/link-company`
- Body: `leadId`, `companyId`

#### `POST /api/customers/leads/link-deal`
- Body: `leadId`, `dealId`

#### `POST /api/customers/leads/create-person`
- Body:
  - `leadId`
  - optional override payload
  - selected field bindings to use for prefill

#### `POST /api/customers/leads/create-company`
- Body analogous to create person

#### `POST /api/customers/leads/create-deal`
- Body analogous to create person

### Conversion
#### `POST /api/customers/leads/convert`
- Body:
  - `leadId`
  - target plan describing which objects to create vs link
  - optional overrides
  - selected field transfers / shared bindings
  - target won stage confirmation
- Response:
  - created/linked object refs
  - conversion summary

Conversion contract:
- conversion is explicit and reviewable
- user must choose or confirm targets
- UI must show field origins and target ownership clearly
- default suggestions are allowed, silent conversion is not
- conversion is single-use; if the lead is already converted, the endpoint must reject a new conversion request
- at least one target object must be linked or created during conversion
- if a `deal` is part of the target plan, the spec implementation must define whether it may be newly created, linked, or both
- successful conversion sets lead outcome/state and stores immutable conversion lineage metadata

### Configuration APIs
#### `GET/POST/PUT/DELETE /api/customers/lead-pipelines`
#### `GET/POST/PUT/DELETE /api/customers/lead-pipeline-stages`
#### `GET/POST/PUT/DELETE /api/customers/lead-lost-reasons`
#### `GET/POST/PUT/DELETE /api/customers/lead-field-bindings`
#### `GET/PUT /api/customers/lead-settings`

## Internationalization (i18n)
Need i18n keys for:
- navigation and page titles
- list columns, filters, row actions
- pipeline board labels
- lead detail sections
- duplicate warnings
- link/create/convert actions
- field origin badges/icons
- pipeline and lost-reason configuration
- validation and error messages

## UI/UX
Lead UI should follow existing `customers` and `deals` conventions:
- `DataTable` for list views
- `CrudForm` for create/edit/detail flows
- `FormHeader` / `FormFooter` patterns
- `ConfirmDialog` for destructive or terminal actions

### Backend Routes
- `/backend/customers/leads`
- `/backend/customers/leads/create`
- `/backend/customers/leads/[id]`
- `/backend/customers/leads/pipeline`
- `/backend/config/customers/leads` for admin configuration

### Navigation
- add `Leads` under `customers`
- add `Lead Pipelines` config entry under customer configuration for admins
- both entries appear only when lead capability is enabled and the user has access

### Lead List
Main list view:
- columns:
  - display name
  - pipeline
  - stage
  - owner
  - source
  - duplicate indicator
  - linked/created object summary
  - created at
- filters:
  - pipeline
  - stage
  - outcome
  - owner
  - source
  - duplicate present
- exports supported

### Lead Pipeline Board
Board view similar in spirit to deals pipeline:
- one board per pipeline
- columns by stage
- cards show owner, source, duplicate flags, and quick links
- drag/drop may be added if consistent with existing board patterns

### Lead Detail Page
The lead detail page is the primary workspace.

Recommended form sections:
- `Lead Overview`
- `Potential Person`
- `Potential Company`
- `Potential Deal`
- `Lead-only Metadata`
- `Source Payload / Intake`
- `Links & Conversion`
- `History`

### Shared Field Rendering
Fields surfaced from target objects must be visually marked:
- company-origin field: company icon/badge
- person-origin field: person icon/badge
- deal-origin field: deal icon/badge

The marker must communicate:
- where the field belongs canonically
- whether it is lead-only, prefill-only, or shared live field
- whether a linked target already exists
- for custom fields, which module/entity owns the canonical value

### Conversion UX
Conversion must be explicit and reviewable.

User flow:
1. open lead detail
2. choose `Convert`
3. review which targets to create or link
4. review transferred/shared fields
5. confirm target stage/outcome
6. execute conversion

This review interaction may be a full-screen flow or structured dialog, but it must not be a silent one-click conversion.

The review UI must also:
- show, per field, whether the value is lead-local, copied once, or live shared
- show field origin icons/badges for both standard fields and custom fields
- allow admins/operators with permission to understand which target object will own the value after conversion

### Manual Create/Link During Qualification
On the lead detail page, users can:
- search and link an existing person/company/deal
- create a person/company/deal from the lead before final conversion
- keep the lead open after those actions

### Permissions
Initial scope:
- all lead administration is `admin` only
- lead custom fields are admin-managed
- pipeline, lost reason, and field-binding configuration are admin-managed
- lead capability enable/disable setting is admin-managed

## Configuration
Admin config area must support:
- enable/disable lead capability per tenant
- create/edit/archive lead pipelines
- create/edit/reorder stages
- create/edit/reorder lost reasons
- manage lead custom fields
- manage field binding rules and target ownership metadata

## ACL & Feature IDs
Initial feature set to plan in `acl.ts` / `setup.ts`:

| Feature ID | Purpose | Initial scope |
|------------|---------|---------------|
| `customers.leads.view` | View lead list/detail/pipeline | admin |
| `customers.leads.create` | Create leads manually or through internal UI flows | admin |
| `customers.leads.update` | Edit lead records and lead-local fields | admin |
| `customers.leads.assign` | Assign lead owner | admin |
| `customers.leads.stage` | Move lead between stages / mark lost | admin |
| `customers.leads.convert` | Execute one-time conversion flow | admin |
| `customers.leads.link` | Link or create person/company/deal during qualification | admin |
| `customers.leads.settings` | Enable/disable lead capability | admin |
| `customers.leads.pipeline.manage` | Manage pipelines and stages | admin |
| `customers.leads.reasons.manage` | Manage lost reasons | admin |
| `customers.leads.fields.manage` | Manage field bindings and lead custom fields | admin |
| `customers.leads.source.view` | View raw source payload and provenance | admin |

Notes:
- future role expansion may grant subsets of these permissions to sales managers or reps
- raw source payload visibility should remain separately controllable because of privacy concerns

## Search & Analytics
### Search
- add lead indexing in `customers/search.ts`
- searchable fields:
  - display name
  - email
  - phone
  - VAT ID
  - source
  - pipeline/stage labels
  - selected lead-only text fields

### Analytics
Add lead analytics dimensions:
- pipeline
- stage
- source
- owner
- won/lost outcome
- lost reason
- linked vs newly created conversion type

### Dashboard Widgets
Initial widgets:
- leads by stage
- stale leads
- recent converted leads
- lost reasons breakdown
- source conversion efficiency

## Example Field Bindings
The table below defines the initial reference set for the most important surfaced fields. It is intentionally limited to a small core set. Additional standard fields and custom fields from `person`, `company`, and later other related objects may be surfaced into lead sections through the same field-binding mechanism.

### Potential Company Section

| Lead field key | Canonical target | Default binding mode | Behavior on lead card |
|----------------|------------------|----------------------|-----------------------|
| `company.displayName` | `company.displayName` | `shared` | Main company name shown and edited from lead; after link/create it writes through to company |
| `company.primaryEmail` | `company.primaryEmail` | `shared` | Shared communication field; duplicate checks may use it |
| `company.primaryPhone` | `company.primaryPhone` | `shared` | Shared communication field; updates canonical company value after link |
| `company.vatId` | `company.taxId` or canonical VAT/tax field | `shared` | Shared company identifier used for duplicate checking and downstream consistency |
| `company.employeeCount` | `company.employeeCount` | `shared` | Shared business profile field; editing on lead updates company |
| `company.comments` | none | `lead_only` | Local lead qualification note in company context; does not update company |

### Potential Person Section

| Lead field key | Canonical target | Default binding mode | Behavior on lead card |
|----------------|------------------|----------------------|-----------------------|
| `person.displayName` | `person.displayName` | `shared` | Shared person name after link/create |
| `person.primaryEmail` | `person.primaryEmail` | `shared` | Shared identity/contact field used in duplicate checks |
| `person.primaryPhone` | `person.primaryPhone` | `shared` | Shared contact field after link/create |
| `person.jobTitle` | `person.jobTitle` | `shared` | Shared role/title field surfaced in lead qualification |
| `person.linkedinUrl` | `person.linkedinUrl` | `prefill_only` | Copied when creating person if present, but not kept in sync by default |
| `person.comments` | none | `lead_only` | Lead-local context note about the contact; independent from person notes/comments |

### Extensibility Rule
- the initial surfaced set should stay intentionally small and high-value
- additional standard fields from `company`, `person`, or future related objects may be exposed later through `CustomerLeadFieldBinding`
- custom fields are first-class citizens of this mechanism
- for each newly surfaced field, admin must choose one binding mode:
  - `lead_only`
  - `prefill_only`
  - `shared`

## Migration & Compatibility
This change is additive and must not break existing contract surfaces.

Backward compatibility rules:
- no existing `customers` or `deals` routes are renamed or removed
- no existing event IDs are renamed or removed
- no existing ACL feature IDs are renamed or removed
- no existing tables/columns are renamed or removed
- all additions are new routes, events, entities, and config surfaces

Lineage requirements:
- downstream records created from a lead must preserve link back to the lead
- existing `person`, `company`, and `deal` APIs may gain additive optional fields showing lead origin references

Future-proofing:
- direct CRM flow without leads remains supported
- lead-first flow is optional and tenant-controlled
- multi-pipeline is supported from v1
- field binding rules are additive and configurable
- lead detail sections must use stable IDs for future widget injection

## Implementation Plan
### Phase 1: Lead Core
1. Add entities, validators, ACL, setup defaults, events, search config, and command registry.
2. Add lead capability setting and tenant-level gating.
3. Add CRUD/list/detail APIs with `openApi`.
4. Add lead list and detail UI under `customers`.
5. Add admin configuration pages for lead enablement, pipelines, and lost reasons.

### Phase 2: Qualification Workflow
1. Add multi-pipeline board view and stage transitions.
2. Add duplicate detection by email, phone, VAT ID.
3. Add assignment and lost-reason flow.
4. Add lead history timeline.

### Phase 3: Linking & Shared Fields
1. Add manual link/create of person/company/deal from lead detail.
2. Add field-binding configuration and surfaced field indicators.
3. Implement write-through behavior for shared fields after link/create.

### Phase 4: Conversion & Analytics
1. Implement explicit conversion review flow.
2. Persist lineage to downstream records.
3. Add dashboard/reporting support.
4. Add integration tests and finalize compliance review.

## Testing Strategy
### Integration Coverage
Required scenarios:
- disable leads in settings and verify lead navigation/pages are hidden or blocked
- enable leads in settings and verify lead flow becomes available
- create lead manually
- create lead via API source payload
- duplicate warning on existing person/company
- move lead across stages in a selected pipeline
- mark lead lost with required reason
- create company from lead before final conversion
- link existing person/company to lead
- verify conversion can happen only once
- convert lead to:
  - person
  - company
  - person + deal
  - person + company + deal
- verify lineage from target objects back to lead
- verify shared company/person field edits on lead update canonical record after link
- verify custom field binding modes:
  - lead-only custom field stays local
  - prefill-only custom field copies once on create
  - shared custom field updates canonical target object when edited on lead
- verify admin configuration for pipelines and lost reasons

### Non-Functional Checks
- tenant and organization scoping on every query
- page size remains `<= 100`
- no raw fetch in backend pages
- zod validation for every mutation

## Risks & Impact Review
#### Shared Field Drift
- **Scenario**: A field visible on the lead and on the linked company diverges because both persist separate values.
- **Severity**: Critical
- **Affected area**: Lead detail, company/person/deal data integrity, conversion trust
- **Mitigation**: After link/create, shared bindings become write-through projections to canonical target fields; no second independent value remains for shared mode.
- **Residual risk**: Misconfigured field bindings may still expose wrong target ownership; admin UI needs clear validation.

#### Conversion Re-entry
- **Scenario**: An already converted lead is converted again with a new target plan, creating duplicate canonical records and broken lineage.
- **Severity**: High
- **Affected area**: Lead conversion, people/company/deal integrity, analytics
- **Mitigation**: Conversion is single-use only; endpoint and UI must reject repeated conversion attempts once conversion metadata is set.
- **Residual risk**: Admin-level repair tooling may still need to handle historical bad data imported from external systems.

#### Conversion Partial Failure
- **Scenario**: Conversion creates one target object but fails on a second target or lineage write.
- **Severity**: High
- **Affected area**: Lead conversion, audit, downstream CRM consistency
- **Mitigation**: Use compound command with transaction boundaries for local writes; defer non-core side effects until after commit.
- **Residual risk**: If future integrations react asynchronously, external compensation may be delayed.

#### Duplicate Misclassification
- **Scenario**: Duplicate detection suggests the wrong record or misses a real duplicate.
- **Severity**: Medium
- **Affected area**: Operator workflow, data cleanliness
- **Mitigation**: Advisory-only model, explicit linking, visible evidence for why a duplicate was suggested.
- **Residual risk**: Human operators may still create duplicates intentionally or accidentally.

#### Pipeline Overconfiguration
- **Scenario**: Admin creates overly complex pipelines that are hard to operate or report on.
- **Severity**: Medium
- **Affected area**: Lead operations, analytics consistency
- **Mitigation**: Stable defaults, admin validation, one default pipeline, stage kind constraints.
- **Residual risk**: Cross-tenant variability will still complicate product support and documentation.

#### Lead Capability Toggle Drift
- **Scenario**: Lead capability is disabled in settings but lead menu items, routes, or APIs remain partially accessible.
- **Severity**: High
- **Affected area**: Navigation, route guards, admin UX, tenant configuration consistency
- **Mitigation**: Single tenant-level source of truth for lead enablement, checked by navigation builders, page metadata/guards, and API handlers.
- **Residual risk**: Existing bookmarked URLs may still hit disabled pages and must return a clear access/configuration error.

#### Source Payload Sensitivity
- **Scenario**: Raw inbound payload contains sensitive or noisy data that is shown too broadly.
- **Severity**: High
- **Affected area**: Privacy, UI, audit surfaces
- **Mitigation**: Restrict source payload access to authorized users, sanitize known secret-like keys in logs/UI.
- **Residual risk**: Third-party payload schemas are unpredictable.

## Final Compliance Report
## Final Compliance Report — 2026-04-04

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Spec uses linkage IDs and lineage refs, not cross-module ORM |
| root AGENTS.md | Always filter by `organization_id` | Compliant | Included in all entities and non-functional checks |
| root AGENTS.md | Validate all inputs with zod | Compliant | Required for all mutations |
| root AGENTS.md | API/UI use shared patterns | Compliant | `DataTable`, `CrudForm`, shared dialogs, shared API helpers |
| `.ai/specs/AGENTS.md` | Include TLDR, Overview, Problem, Solution, Architecture, Data Models, API Contracts, Risks, Compliance, Changelog | Compliant | All required sections present |
| `packages/core/AGENTS.md` | API routes MUST export `openApi` | Compliant | Explicitly required in API section |
| `packages/core/AGENTS.md` | Events declared with `createModuleEvents()` | Compliant | Event family specified for declaration |
| `packages/core/src/modules/customers/AGENTS.md` | Use customers module as reference CRUD pattern | Compliant | Lead implemented inside customers using existing CRUD/command patterns |
| `packages/ui/AGENTS.md` | Use `DataTable` for list views | Compliant | Lead list and pipeline UX follow backend patterns |
| `packages/ui/AGENTS.md` | Use `CrudForm` for create/edit flows | Compliant | Lead detail/create flows use `CrudForm` |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | CRUD, config, linking, and conversion endpoints align with entities |
| API contracts match UI/UX section | Pass | List, detail, pipeline, config, and conversion are represented in both |
| Risks cover all write operations | Pass | Lead update, stage changes, linking, conversion, shared fields covered |
| Commands defined for all mutations | Pass | All core mutations mapped to commands |
| Cache strategy covers all read APIs | Pass | No dedicated cache introduced in spec; read paths remain direct/query-driven |

### Non-Compliant Items
- None identified at spec stage.

### Verdict
- **Partially compliant**: Needs one more refinement pass before implementation, mainly around field-binding examples, target-plan validation, and endpoint metadata/ACL detail.

## Changelog
### 2026-04-04
- Expanded the skeleton into a full working specification for the customers lead funnel.
- Added multi-pipeline support, shared-field binding model, manual pre-conversion linking/creation, and lineage rules.

### 2026-04-03
- Initial skeleton specification created for customers lead funnel.
