# Warranty & RMA Claims Desk

## TLDR
**Key Points:**
- New core module `warranty_claims`: a claims desk for B2B distributors covering warranty claims, non-warranty RMAs, core returns, and vendor recovery in one case-workflow (intake → triage → disposition → resolution → audit trail).
- Replaces the email + spreadsheet workflow OM's ICP uses today; deep reuse of existing machinery: sales orders/returns (FK-id links), attachments, dictionaries, notifications, customer portal, AI tools.

**Scope:**
- One claim entity with a `claimType` discriminator (`warranty | return | core_return | vendor_recovery`), line-level partial approvals and dispositions, immutable timeline/audit events.
- Staff Claims Desk (list + triage workspace detail), customer portal intake and claim tracking, sales-order detail "Claims" tab via UMES injection.
- Command-driven status machine with optimistic locking, typed events, notifications, search indexing, tenant-configurable fault/reason dictionaries, AI triage tools.

**Concerns (if any):**
- No vendor master-data entity exists in core — vendor recovery claims store a vendor name/ref snapshot (see Design Decisions).
- Financial documents (credit memos, replacement orders) are NOT auto-generated in v1 — claims link to sales documents created through existing sales flows by id.

## Overview
B2B distributors (OM's primary ICP) process warranty claims, advance replacements, vendor recovery, and core returns through email threads and spreadsheets. This module gives them a first-class claims desk: structured intake (portal or staff), a triage queue with SLA visibility, per-line dispositions with partial approvals, a customer-visible timeline, and an auditable lifecycle — built entirely from OM's existing primitives (`makeCrudRoute`, commands, events, dictionaries, attachments, portal pages, AI tools).

> **Market Reference**: Studied ERPNext (Warranty Claim doctype), NetSuite (Return Authorization + Vendor RA), Adobe Commerce RMA, Dynamics 365 F&O return orders, Salesforce Manufacturing Cloud Claims, SAP B1 Return Request, Zoho Inventory, Cin7 Core, Loop/ReturnGO/AfterShip, and Syncron/Tavant warranty suites. **Adopted:** Salesforce/D365's single claim object with a type discriminator; D365's line-level disposition codes (incl. credit-only/field-destroy); Magento's partial authorization (per-line statuses); Syncron's vendor-recovery claim linked to the source customer claim; ERPNext's warranty-status-computed-at-intake; Zoho's "no stock/credit effect before physical receipt" gate. **Rejected:** separate entities per claim type (Salesforce's ClaimCoverage/ClaimParticipant complexity is enterprise-adjudication overkill); dictionary-driven *statuses* (a code-enforced state machine needs frozen status ids — configurability lives in fault/reason dictionaries instead); auto-adjudication rules engines (v2 candidate via `business_rules`).

## Problem Statement
- Claims arrive by email; nothing links them to orders, serials, or prior claims. Distributors lose recoverable vendor dollars (industry estimate: ~40% of warranty cost is supplier-recoverable) because customer claims and vendor claims live in different spreadsheets.
- No SLA visibility: triage queues are inbox-ordered, not due-date-ordered.
- Partial resolutions (approve 3 of 5 units, reject the rest) can't be represented in ad-hoc tools, so staff over-credit or over-communicate.
- Customers have no self-service view of claim progress, generating "any update?" email load.
- Core charges (auto parts, remanufacturables) are tracked outside the return flow entirely.

## Proposed Solution
A self-contained core module `packages/core/src/modules/warranty_claims/` following the `customers` reference-module layout. One claim aggregate (header + lines + immutable timeline events) with a command-driven state machine. Cross-module coupling only via sanctioned mechanisms: FK-id + snapshot to sales/catalog/customers, UMES widget injection into the sales order detail, attachments by `(entityId, recordId)` convention, dictionaries for tenant-configurable codes, typed events consumed by module-local notification subscribers.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| One entity + `claimType` discriminator | Salesforce (`ClaimTypeCode`) and D365 prove one lifecycle serves all four types; unified triage queue, comments, attachments, and reporting. Per-type behavior is data (number prefix, portal visibility), not schema. |
| Fixed status enum, dictionary-backed fault/reason codes | Transitions are enforced in a command (state-machine integrity, BC-frozen ids). Tenant configurability goes where it's safe: dictionaries `warranty-claim-fault-code`, `warranty-claim-reason`, `warranty-claim-rejection-reason` (kebab-case kinds per sales `'order-status'` precedent), seeded in `setup.ts` (mirrors `seedSalesStatusDictionaries`). |
| Advance replacement = resolution attributes, not a claim type | Any approved claim can ship a replacement ahead (`advanceReplacement` flag + `replacementOrderId`). Avoids a fifth lifecycle. |
| Vendor recovery = linked child claim (`sourceClaimId`) | Syncron's highest-ROI pattern: recoverable resolved lines are copied into a `vendor_recovery` claim, keeping the money trail connected. v1 creates it via an explicit command (no auto-matching). |
| Vendor snapshot fields (`vendorName`, `vendorRef`) instead of FK | Core has no vendor master entity. A text snapshot keeps the module decoupled; when a vendor module lands, an additive `vendor_id` column can join it. |
| No auto financial documents in v1 | Credit memos / replacement orders are created through existing sales flows and linked by id (`salesReturnId`, `replacementOrderId`). Avoids cross-module writes into sales aggregates. |
| Module-local `WarrantyClaimNumberGenerator` | Mirrors `SalesDocumentNumberGenerator` (`sales/services/salesDocumentNumberGenerator.ts` — lives in `services/`, DI-registered). Per tenant/org/type sequences: `WTY-`, `RMA-`, `COR-`, `VRC-` prefixes. |
| Timeline as immutable event rows | Audit-trail requirement; `visibility: internal|customer` gates what the portal sees. No `updated_at` — events are append-only. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Extend `sales.SalesReturn` with claim fields | Returns are financial/goods documents; claims are cases. Conflating them breaks both lifecycles and violates minimal-impact on a busy module. Claims *link* to returns instead. |
| Build on the `workflows` module engine | Workflow instances are automation runs, not user-facing case records with lines/amounts. v2 can trigger workflows from claim events. |
| Separate `rma` + `warranty` modules | Duplicate triage UI, duplicated timeline/notifications; the discriminator costs one column. |
| Dictionary-driven statuses (like sales document statuses) | Sales statuses are display metadata; claim statuses gate transitions and business rules in code. Frozen enum + BC contract is safer. |

## User Stories / Use Cases
- **A distributor's CS agent** wants to **triage a queue of claims ordered by SLA due date** so that **no claim breaches the promised response time**.
- **A CS agent** wants to **approve 3 of 5 claimed units and reject 2 with a reason code** so that **the customer gets an accurate partial resolution**.
- **A customer (portal user)** wants to **submit a claim against one of their orders with serials and photos, and track its status** so that **they don't have to email for updates**.
- **A warranty manager** wants to **spin resolved warranty lines into a vendor recovery claim** so that **supplier-recoverable dollars are not lost**.
- **A parts distributor** wants to **track core charges and core credits on return lines** so that **core exchanges stop living in a spreadsheet**.
- **A staff user** wants to **see all claims for an order on the order's detail page** so that **context is one click away**.
- **An admin** wants to **configure fault codes and claim reasons per tenant** so that **the desk matches their product domain**.
- **A CS agent** wants to **ask the AI assistant to suggest triage (priority, eligibility, per-line disposition)** so that **routine claims move faster**.

## Architecture

### Module placement & discovery
`packages/core/src/modules/warranty_claims/` — plural snake_case module id `warranty_claims`. Standard auto-discovery files (all FROZEN-convention names): `index.ts`, `di.ts`, `acl.ts`, `setup.ts`, `events.ts`, `search.ts`, `ce.ts`, `notifications.ts`, `ai-tools.ts`, `data/{entities,validators}.ts`, `commands/`, `api/`, `backend/`, `frontend/`, `subscribers/`, `widgets/`, `i18n/`, `migrations/`. Run `yarn generate` after scaffolding.

### Cross-module coupling (all sanctioned mechanisms; no direct ORM relations)
| Peer | Mechanism | Detail |
|------|-----------|--------|
| sales | FK-id + snapshot | `orderId`, `orderLineId`, `salesReturnId`, `replacementOrderId` (uuid columns, validated existence at write time via QueryEngine lookup; snapshots: `productName`, `sku`). |
| sales UI | UMES widget injection | Claims tab registered into existing frozen spot `sales.document.detail.order:tabs`; renders claims filtered by `orderId`. Degrades to nothing when spot absent. |
| catalog | FK-id + snapshot | `productId`, `variantId` + `sku`/`productName` snapshot on lines. |
| customers | FK-id | `customerId` on header; portal scopes by the session's customer id. |
| attachments | id convention | Files stored via attachments module API with `entityId: 'warranty_claims:claim'`, `recordId: <claimId>`. |
| dictionaries | seeded dictionaries + reused components | Three dictionaries seeded in `setup.ts`; settings page reuses `DictionaryForm`/`DictionaryTable` components (same as sales `StatusSettings`). |
| notifications | module-local subscribers | Subscribers on own events create notifications; failures never block commands. |
| customer portal | portal page convention | `frontend/[orgSlug]/portal/claims/**` with `page.meta.ts` (`requireCustomerAuth`), mirroring the portal module's page metadata. |
| ai-assistant | `ai-tools.ts` | Query tools + `prepareMutation`-gated transition tool. |

### Commands & Events
Commands (id = `module.entity.action`, registered in `commands/index.ts`; writes via DataEngine/command pipeline):
- **Command**: `warranty_claims.claim.create` (undoable), `warranty_claims.claim.update` (undoable), `warranty_claims.claim.delete` (undoable, soft-delete)
- **Command**: `warranty_claims.claim.submit` (draft → submitted; stamps `submittedAt`, computes `slaDueAt`, generates timeline event)
- **Command**: `warranty_claims.claim.transition` (validated state-machine move; snapshot-undo restores prior status fields; appends timeline event)
- **Command**: `warranty_claims.claim.assign` (assignee change + timeline event)
- **Command**: `warranty_claims.claim.comment` (appends a timeline comment, `visibility: internal|customer`)
- **Command**: `warranty_claims.claim.create_vendor_recovery` (copies selected resolved lines into a new linked `vendor_recovery` claim; **duplicate-safe**: rejects lines whose `vendor_claim_line_id` is already set, and re-checks inside the write transaction so concurrent/double submits cannot double-claim a line)
- **Subscriber (same-module)**: on `warranty_claims.claim.status_changed` — when a `vendor_recovery` claim enters `resolved`, roll its approved credit total up into the source claim's `total_recovered_amount` (keeps the recovery audit trail live without cross-module writes)
- **Command**: `warranty_claims.claim_line.create` / `.update` / `.delete` (undoable; recomputes header claimed/approved totals inside one atomic flush)

Events (declared via `createModuleEvents`; singular entity, past-tense action):
- **Event**: `warranty_claims.claim.created` / `.updated` / `.deleted`
- **Event**: `warranty_claims.claim.submitted`
- **Event**: `warranty_claims.claim.status_changed` (`clientBroadcast: true`, `portalBroadcast: true`)
- **Event**: `warranty_claims.claim.assigned`
- **Event**: `warranty_claims.claim.comment_added` (`portalBroadcast: true`, customer-visible comments only)

Portal-broadcast payloads MUST carry a recipient audience pinned to the claim's `customerId` — the portal SSE bridge (`customer_accounts/api/portal/events/stream.ts`) filters by tenant/org plus an *optional* recipient list, so an audience-less event would be visible to every portal customer of the organization. TC-WC-005 asserts another customer's session does not receive these events/entries.

### Status state machine (header)
```
draft ──▶ submitted ──▶ in_review ──▶ approved ──▶ awaiting_return ──▶ received ──▶ inspecting ──▶ resolved ──▶ closed
            │              │ ▲            │                                                            
            │              ▼ │            └──▶ resolved (credit-only / field-destroy: skip goods flow)
            │        info_requested                                                                    
            │              │                                                                           
            ▼              ▼                                                                           
        cancelled      rejected ──▶ in_review (appeal)  |  rejected ──▶ closed                         
```
- `cancelled` reachable from any state before `received`. `closed`/`cancelled` terminal.
- Transitions validated in `warranty_claims.claim.transition`; illegal moves → 400 with `warranty_claims.errors.invalidTransition`.
- Guard: header cannot enter `resolved` while any non-rejected line has `lineStatus` ∉ {`resolved`, `rejected`}.
- Line statuses: `pending → approved|rejected`, `approved → received → inspected → resolved` (line-level partials are first-class).

### Dispositions (line-level enum)
`restock`, `repair`, `replace`, `credit`, `refund`, `field_destroy` (credit without physical return), `scrap`, `return_to_vendor`, `deny`.

## Data Models

### WarrantyClaim (singular) — table `warranty_claims`
- `id`: uuid PK
- `claim_number`: text, unique per tenant **and organization** (unique index on `(tenant_id, organization_id, claim_number)`; sequences are per tenant/org/type, so uniqueness scope matches generation scope) (generated: `WTY-000123` / `RMA-` / `COR-` / `VRC-`)
- `claim_type`: text enum `warranty|return|core_return|vendor_recovery` — **immutable after creation** (excluded from the update validator/command whitelist; unit test asserts PUT cannot change it)
- `status`: text enum (see state machine), default `draft`
- `channel`: text enum `portal|staff|api`, default `staff`
- `priority`: text enum `low|normal|high|urgent`, default `normal`
- `customer_id`: uuid null (customers module, FK-id only); `customer_name`: text null (snapshot captured when `customer_id` is set — the desk list renders it without cross-module joins, and history survives customer deletion/merges)
- `vendor_name`: text null; `vendor_ref`: text null (vendor recovery snapshot)
- `order_id`: uuid null (sales order); `sales_return_id`: uuid null; `replacement_order_id`: uuid null
- `source_claim_id`: uuid null (vendor recovery ← originating claim, same table)
- `advance_replacement`: boolean default false; `advance_shipped_at`: timestamptz null
- `reason_code`: text null (dictionary `warranty_claim_reasons`)
- `rejection_reason_code`: text null (dictionary `warranty_claim_rejection_reasons`)
- `resolution_summary`: text null; `notes`: text null
- `currency_code`: text null
- `total_claimed_amount` / `total_approved_amount` / `total_recovered_amount`: numeric(18,4) null (rollups from lines; recovered set on vendor-recovery reconciliation)
- `sla_due_at`: timestamptz null (set at submit: `submittedAt + tenant config hours`, default 48h)
- `submitted_at` / `resolved_at` / `closed_at`: timestamptz null
- `assignee_user_id`: uuid null (auth user)
- `organization_id`: uuid; `tenant_id`: uuid; `created_at`; `updated_at` (optimistic lock, returned in list/detail); `deleted_at` null

### WarrantyClaimLine (singular) — table `warranty_claim_lines`
- `id`: uuid PK; `claim_id`: uuid FK (same module)
- `line_no`: int
- `product_id`: uuid null; `variant_id`: uuid null; `sku`: text null; `product_name`: text null (snapshot)
- `order_line_id`: uuid null (sales order line, FK-id)
- `serial_number`: text null; `lot_number`: text null
- `purchase_date`: date null; `warranty_months`: int null; `warranty_expires_at`: date null
- `warranty_status`: text enum `in_warranty|out_of_warranty|unknown`, default `unknown` (computed at intake when purchase date + months present)
- `fault_code`: text null (dictionary `warranty_claim_fault_codes`); `fault_description`: text null
- `qty_claimed`: numeric(18,4) default 1; `qty_approved`: numeric(18,4) null; `qty_received`: numeric(18,4) null
- `condition_on_receipt`: text null; `inspection_notes`: text null
- `disposition`: text enum null (see list)
- `line_status`: text enum `pending|approved|rejected|received|inspected|resolved`, default `pending`
- `credit_amount` / `restocking_fee` / `core_charge_amount` / `core_credit_amount`: numeric(18,4) null
- `vendor_claim_line_id`: uuid null (link to the recovery claim's line)
- `organization_id`; `tenant_id`; `created_at`; `updated_at`; `deleted_at`

### WarrantyClaimEvent (singular) — table `warranty_claim_events` (append-only timeline)
- `id`: uuid PK; `claim_id`: uuid FK
- `kind`: text enum `status_changed|comment|assignment|system`
- `visibility`: text enum `internal|customer`, default `internal`
- `body`: text null (comment text)
- `payload`: jsonb null (e.g. `{from, to}` for status changes)
- `actor_user_id`: uuid null; `actor_customer_id`: uuid null (portal authors)
- `organization_id`; `tenant_id`; `created_at` (no `updated_at`/`deleted_at` — immutable)

### WarrantyClaimSequence — table `warranty_claim_sequences`
- `id`: uuid PK; `tenant_id`; `organization_id`; `claim_type`: text; `next_number`: int — locked row per generate (mirrors sales generator)

Custom fields: `ce.ts` registers the claim entity so tenants can add fields (e.g. dealer code, core weight). Encryption: `encryption.ts` declares `defaultEncryptionMaps` for all free-text/correspondence fields, mirroring `sales/encryption.ts` (which encrypts `comments`, `internal_notes`, note `body`): `warranty_claims.notes`, `warranty_claims.resolution_summary`, `warranty_claim_lines.fault_description`, `warranty_claim_lines.inspection_notes`, `warranty_claim_events.body`. All reads of these entities go through `findWithDecryption`/QueryEngine decryption paths; writes go through `em.flush()` (never `nativeUpdate`, which bypasses the encryption subscriber). Search indexing keeps `claimNumber` and serials indexed, while `faultDescription`, `resolutionSummary`, and `inspectionNotes` are excluded from the search source because they are encrypted at rest and intentionally kept out of the search engine.

Guard-test registration: `WarrantyClaim` and `WarrantyClaimLine` are user-editable entities and MUST be added to the audit maps in `optimistic-lock-editable-entities.test.ts`; `WarrantyClaimEvent` (append-only) and `WarrantyClaimSequence` (internal counter) belong to the excluded classes.

## API Contracts
All staff routes: `requireAuth` + `requireFeatures` guards, zod-validated (`data/validators.ts`), export `openApi`, tenant/organization scoped, `updatedAt` in every list/detail item. Module prefix means files below map to `/api/warranty_claims/...`.

### Claims CRUD — `api/route.ts` (makeCrudRoute)
- `GET /api/warranty_claims` — filters: `?status=&claimType=&priority=&customerId=&orderId=&assigneeUserId=&ids=&search=&page=&pageSize=` (pageSize ≤ 100); sortable by `slaDueAt`, `createdAt`, `updatedAt`. Feature `warranty_claims.claim.view`.
- `POST /api/warranty_claims` — create (header + optional initial lines array, atomic). Feature `warranty_claims.claim.create`.
- `PUT /api/warranty_claims` — update header via per-status field whitelists: **intake fields** (customer, order refs, reason, priority, notes) editable in `draft|submitted|in_review|info_requested`; **fulfillment fields** (`advanceReplacement`, `replacementOrderId`, `advanceShippedAt`, `salesReturnId`, `vendorName`, `vendorRef`, `resolutionSummary`) editable in `approved|awaiting_return|received|inspecting` (this is how advance-replacement facts get recorded after approval). `status` and `claimType` are never updatable here. Feature `warranty_claims.claim.manage`. Optimistic lock default ON.
- `DELETE /api/warranty_claims` — soft delete (draft/cancelled only). Feature `warranty_claims.claim.delete`.
- `list.entityId` + `indexer.entityType` declared (query-index + search integration).

### Lines — `api/lines/route.ts` (makeCrudRoute, flat sub-resource)
- `GET /api/warranty_claims/lines?claimId=` · `POST` · `PUT` · `DELETE` — features `view`/`manage`; parent-claim status guard (lines mutable only while claim ∈ {draft, submitted, in_review, info_requested, approved, received, inspecting}); optimistic lock header carries the **line's** `updatedAt` (per-child override rule).

### Actions (command endpoints, hand-written)
Every hand-written write endpoint (a) enforces `enforceCommandOptimisticLock` on the parent claim (except append-only comment posts), and (b) wires the server-side mutation-guard registry exactly like existing sales action routes: `validateCrudMutationGuard(ctx.container, …)` (see `sales/api/settings/document-numbers/route.ts:106`) / `runMutationGuards` (see `sales/api/quotes/send/route.ts:55`), including after-success callbacks — hand-written writes must never bypass platform mutation guards.
- `POST /api/warranty_claims/submit` — `{id}` → `claim.submit`
- `POST /api/warranty_claims/transition` — `{id, toStatus, rejectionReasonCode?, resolutionSummary?}` → `claim.transition`; 400 invalid move, 409 stale `updatedAt`
- `POST /api/warranty_claims/assign` — `{id, assigneeUserId}` → `claim.assign`
- `POST /api/warranty_claims/vendor-recovery` — `{claimId, lineIds[], vendorName, vendorRef?}` → returns new claim id
- `GET /api/warranty_claims/events?claimId=` — timeline (staff sees all) · `POST /api/warranty_claims/events` — `{claimId, body, visibility}` → `claim.comment`

### Portal (customer-session guarded, scoped to session customer)
Auth mechanism: routes declare `metadata = { requireAuth: false }` and resolve the customer session via `getCustomerAuthFromRequest` from `@open-mercato/core/modules/customer_accounts/lib/customerAuth` (the established portal guard; `warranty_claims` is its first consumer outside `customer_accounts` — same cross-module import class as sales → dictionaries components). Missing/invalid session → 401; claims are pinned to the session's customer id server-side.
- `GET /api/warranty_claims/portal/claims` — own claims only (customer_id = session customer)
- `POST /api/warranty_claims/portal/claims` — intake: `{orderId?, reasonCode, lines: [{productId?|sku?, serialNumber?, faultCode?, faultDescription, qtyClaimed}], notes?}` → creates `channel: 'portal'`, status `submitted` claim (server sets customerId from session). **Ownership validation:** any provided `orderId`/`orderLineId` MUST resolve, via a tenant/org-scoped QueryEngine lookup, to a sales order belonging to the session's customer — otherwise 404 (no existence leak). Cross-customer orderId rejection is asserted in TC-WC-005.
- `GET /api/warranty_claims/portal/events?claimId=` — customer-visible timeline entries only (ownership checked)
- `POST /api/warranty_claims/portal/events` — customer comment (`visibility: 'customer'`, `actorCustomerId` from session)
- `GET /api/warranty_claims/portal/attachments?claimId=` · `POST /api/warranty_claims/portal/attachments` — module-owned portal attachment endpoints (claim ownership checked against the session customer; size/type limits inherited); they delegate storage to the attachments module service internally so portal users never touch the staff-guarded attachments API.

Response envelope/error shapes follow `makeCrudRoute` defaults; hand-written routes use `zod.safeParse` → 400, scoped lookups → 404, feature guard → 403 (before lookup).

## Internationalization (i18n)
Locale files `i18n/{en,de,es,pl}.json` (flat dotted keys, codepoint-sorted). Key groups: `warranty_claims.nav.*`, `warranty_claims.list.*` (columns/filters), `warranty_claims.detail.*` (tabs, action bar), `warranty_claims.status.*` (12 statuses), `warranty_claims.claimType.*`, `warranty_claims.disposition.*`, `warranty_claims.lineStatus.*`, `warranty_claims.form.*`, `warranty_claims.portal.*`, `warranty_claims.notifications.*`, `warranty_claims.errors.*` (invalidTransition, lineLocked, notFound, vendorRecoveryNeedsResolvedLines), `warranty_claims.ai.*`, `warranty_claims.settings.*`. No hardcoded user-facing strings; internal-only throws prefixed `[internal]`.

## UI/UX
DS-token-only styling (no hardcoded status colors, no arbitrary values, lucide-react icons, `aria-label` on icon buttons, dialogs submit on Cmd/Ctrl+Enter and cancel on Escape).

- **Claims Desk list** (`backend/page.tsx` → `/backend/warranty_claims`): `DataTable` with columns claim number, type (Badge), status (`StatusBadge` mapped to semantic status tokens: draft/info_requested→neutral, submitted/in_review→info, approved/awaiting_return/received/inspecting→warning, resolved/closed→success, rejected/cancelled→danger), priority, customer, order, **SLA due** (relative time; overdue rendered with `text-status-danger-*` token), assignee, updatedAt. Filters: status, type, priority, assignee, overdue-only. Row actions: open, assign, cancel. Primary action "New claim".
- **Triage workspace** (`backend/[id]/page.tsx`): header strip — claim number + type + `StatusBadge` + SLA countdown + totals (claimed/approved); **transition action bar** showing only legal next statuses as buttons (guarded by state machine; confirm dialog for reject/cancel with reason dictionary select). Tabs: **Lines** (table with per-line status, qty claimed/approved/received, disposition select, credit/fee/core amounts, inline edit via `CrudForm`-backed dialog), **Timeline** (chronological events; internal/customer visibility badge; comment composer with visibility toggle), **Attachments** (attachments module pattern for `warranty_claims:warranty_claim`), **AI assist** (renders `suggest_triage` output: eligibility per line, suggested disposition, draft reply; apply buttons dispatch guarded mutations).
- **Create/edit** (`backend/create/page.tsx`, edit dialog): `CrudForm` (auto optimistic-lock header from `initialValues.updatedAt`); create captures header + first line inline.
- **Settings** (`backend/settings/page.tsx`): three dictionary editors reusing `DictionaryForm`/`DictionaryTable` (fault codes, claim reasons, rejection reasons) — feature `warranty_claims.settings.manage`.
- **Sales order tab** (widget → spot `sales.document.detail.order:tabs`): "Claims" tab listing the order's claims (count badge), link to desk filtered by order, "New claim from order" prefill.
- **Portal** (`frontend/[orgSlug]/portal/claims/page.tsx` + `claims/[id]/page.tsx` + `claims/new/page.tsx`): claims list (status chips), claim detail (status stepper, customer-visible timeline, comment box, attachment upload), guided intake wizard (pick order → pick lines/serials → fault code + description + photos → review & submit). `page.meta.ts` with `requireCustomerAuth` + portal nav entry.
- Loading/error/empty states: `LoadingMessage` / `ErrorMessage` / `EmptyState`; all data calls via `apiCall`; non-CrudForm writes via `useGuardedMutation`.

## Configuration (Optional)
- v1 hard-codes module defaults in code constants: SLA 48h, portal intake enabled. A tenant-editable settings surface (mirroring sales settings) is a v2 follow-up — no config mechanism is introduced in v1.

## Migration & Compatibility
- Purely additive: 4 new tables via module `migrations/` (`yarn db:generate`, snapshot committed). No changes to sales/catalog/customers schemas.
- New FROZEN surfaces introduced (from day one): event ids above, ACL ids `warranty_claims.claim.{view,create,manage,delete}` + `warranty_claims.settings.manage`, notification type ids, API routes `/api/warranty_claims/**`, widget usage of existing frozen spot `sales.document.detail.order:tabs` (consumer only — no spot contract change).
- No BC deprecations required — nothing existing is modified except registering the injection widget into the sales spot table (additive).

## Implementation Plan

### Phase 1: Data layer & module scaffold
1. Scaffold module files (`index.ts`, `di.ts`, `acl.ts`, `setup.ts` with `defaultRoleFeatures` + dictionary seeding, `events.ts`, `ce.ts`, `encryption.ts`).
2. `data/entities.ts` (4 entities), `data/validators.ts` (zod, types via `z.infer`), number generator in `services/claimNumberGenerator.ts` (DI-registered); register `WarrantyClaim`/`WarrantyClaimLine` in `optimistic-lock-editable-entities.test.ts` audit maps.
3. `yarn db:generate` → module migration + snapshot; `yarn generate`.

### Phase 2: Commands & APIs
1. `commands/claims.ts`, `commands/claim-lines.ts`, `commands/index.ts` — CRUD (undoable, snapshot-based), submit/transition/assign/comment/vendor-recovery; state machine + line rollups in `lib/stateMachine.ts` (unit-tested).
2. `api/route.ts`, `api/lines/route.ts` (makeCrudRoute + openApi), action routes, portal routes; `enforceCommandOptimisticLock` on action endpoints.

### Phase 3: Backend UI
1. Claims Desk list, triage workspace (tabs), create page, settings page.
2. Sales order "Claims" tab injection widget (`widgets/injection/…` + `widgets/injection-table.ts` registration).

### Phase 4: Portal intake
1. Portal pages (list/detail/new) + `page.meta.ts`, portal nav registration; render smoke test (first non-`portal` module shipping portal pages).
2. Portal API routes incl. the module-owned portal attachment endpoints.

### Phase 5: Notifications, search, AI
1. `notifications.ts` (+ client renderers) + `subscribers/` for submitted/assigned/status_changed, plus the same-module vendor-recovery reconciliation subscriber (`total_recovered_amount` rollup).
2. `search.ts` (claimNumber and serials indexed; `faultDescription`, `resolutionSummary`, and `inspectionNotes` excluded from the search source).
3. `ai-tools.ts`: `list_claims`, `get_claim`, `suggest_triage` (read-only heuristics + LLM summary), `transition_claim` (mutating — declared via `defineAiTool`'s pending-action contract so the AI-assistant runtime routes it through `prepareMutation` approval; modules do not call `prepareMutation` directly).

### Phase 6: Tests & i18n polish
1. Unit tests (state machine, rollups, number generator, command undo).
2. Integration tests (below), 4 locale files, `yarn i18n:check-sync` clean.

### Testing Strategy
- Unit: transition matrix (legal/illegal), line rollup math, sequence generator (per-type prefixes, org-scoped uniqueness), vendor-recovery line copy + duplicate rejection, undo snapshots, `status`/`claimType` immutability via generic update.
- Integration (Playwright API-first, module `__integration__/`, self-contained fixtures created via API and cleaned up in teardown, no seeded-data reliance).

## Integration Test Coverage (mandatory)
| TC | Path(s) | Assertions |
|----|---------|-----------|
| TC-WC-001 CRUD | `GET/POST/PUT/DELETE /api/warranty_claims` | 401 unauth; 403 without feature; create w/ initial lines; list filters (`status`, `claimType`, `orderId`, `ids=`); `updatedAt` present; optimistic-lock 409 on stale PUT; soft-delete only from draft |
| TC-WC-002 Lines & partials | `POST/PUT /api/warranty_claims/lines` | partial approve (qtyApproved < qtyClaimed); line locked when claim closed (400); header totals rollup; per-line lock header honored |
| TC-WC-003 Lifecycle | `POST /api/warranty_claims/submit`, `/transition` | full happy path draft→…→closed; credit-only skip path approved→resolved; illegal move 400; reject requires reason code; stale lock 409; timeline events written |
| TC-WC-004 Vendor recovery | `POST /api/warranty_claims/vendor-recovery` | only resolved lines accepted (400 otherwise); child claim `VRC-` number, `sourceClaimId` set, lines linked |
| TC-WC-005 Portal | `GET/POST /api/warranty_claims/portal/claims`, `/portal/events`, `/portal/attachments` | customer session required; sees only own claims (cross-customer 404); intake creates `submitted` claim w/ `channel=portal`; **intake with another customer's `orderId` → 404**; customer comment visible, internal events hidden; attachment upload/list gated by claim ownership; portal-broadcast events unseen by another customer's session |
| TC-WC-006 Timeline & comments | `GET/POST /api/warranty_claims/events` | staff comment internal vs customer visibility; status change appends event; events immutable (no PUT route) |
| TC-WC-007 Tenant isolation | all list endpoints | second-org token sees zero rows |
| Key UI path (Playwright) | `/backend/warranty_claims` | list renders, create claim via form, transition via action bar, line disposition edit |

## Risks & Impact Review

### Data Integrity Failures
- Claim + initial lines creation is atomic (single command, one flush/transaction). Line mutations recompute header totals in the same atomic flush (`withAtomicFlush` phases: mutate line → recompute rollup).
- Concurrent edits: optimistic locking default ON for CRUD; action endpoints enforce `enforceCommandOptimisticLock` against the parent claim → structured 409 + conflict bar.
- Deleted references (order deleted after claim created): FK-ids are soft references — UI renders "missing reference" fallback; no cascade.

### Cascading Failures & Side Effects
- Events are emitted after successful command commit; notification subscribers are isolated (one side effect per subscriber, failures logged, never block the write).
- No cross-module writes: sales documents are never mutated by this module (v1), eliminating the largest blast-radius risk.

### Tenant & Data Isolation Risks
- Every query filters `organization_id`/`tenant_id` (QueryEngine scoped access); portal routes additionally pin `customer_id` from the session — cross-customer access returns 404. Covered by TC-WC-005/007.

### Migration & Deployment Risks
- Additive-only migration; re-runnable; no backfill. Rollback = drop unused tables (no other module reads them).

### Operational Risks
- Timeline table grows with activity — bounded per claim; same growth class as `audit_logs` (acceptable; index on `claim_id, created_at`).
- Notification volume: status-change notifications target creator/assignee only (no org-wide floods).

### Risk Register

#### Stale sales references on claims
- **Scenario**: An order or order line referenced by a claim is deleted/archived; claim UI would dangle.
- **Severity**: Low
- **Affected area**: claim detail, order tab widget
- **Mitigation**: soft references resolved defensively at read (enricher returns null → UI fallback label); existence validated at write time only.
- **Residual risk**: historical claims may show unresolvable refs — acceptable (audit value preserved via snapshots).

#### State machine bypass via raw entity update
- **Scenario**: A future contributor mutates `status` through the generic PUT instead of `transition`.
- **Severity**: Medium
- **Affected area**: lifecycle integrity, SLA metrics
- **Mitigation**: `status` excluded from update validator/command whitelist; transitions only through `claim.transition`; unit test asserts PUT cannot change `status`.
- **Residual risk**: direct DB writes remain possible (as everywhere) — acceptable.

#### Optimistic-lock gaps on action endpoints
- **Scenario**: Two agents transition the same claim concurrently; second write silently overwrites.
- **Severity**: Medium
- **Affected area**: triage integrity
- **Mitigation**: `enforceCommandOptimisticLock` on submit/transition/assign/vendor-recovery; UI sends `buildOptimisticLockHeader(claim.updatedAt)`; conflicts surface via `surfaceRecordConflict`.
- **Residual risk**: comment posts are append-only and exempt by design.

#### Portal intake abuse
- **Scenario**: A portal user floods claims or attaches junk.
- **Severity**: Low
- **Affected area**: triage queue hygiene
- **Mitigation**: portal intake creates `submitted` claims visible in a filterable queue; `portalIntakeEnabled` config kill-switch; attachment limits inherited from attachments module.
- **Residual risk**: no rate limiting in v1 — acceptable for authenticated B2B portal users.

## Final Compliance Report — 2026-07-03

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md` (reference module)
- `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | FK-id + snapshot only |
| root AGENTS.md | Tenant/organization scoping on every query | Compliant | QueryEngine scoped; portal adds customer pin |
| root AGENTS.md | Optimistic locking on new editable entities | Compliant | `updated_at` + returned `updatedAt`; command endpoints use `enforceCommandOptimisticLock` |
| root AGENTS.md | Modules plural snake_case; events `module.entity.action` | Compliant | `warranty_claims`; `warranty_claims.claim.status_changed` |
| packages/core/AGENTS.md | CRUD via `makeCrudRoute` + `openApi` export | Compliant | claims + lines routes |
| packages/core/AGENTS.md | Writes dispatch registered commands | Compliant | all mutations are commands; CRUD undoable |
| packages/core/AGENTS.md | ACL declarative guards, feature ids in `acl.ts`, defaults in `setup.ts` | Compliant | 5 features + role defaults |
| packages/core/AGENTS.md | Events declared before emit; one side effect per subscriber | Compliant | `events.ts` + isolated subscribers |
| packages/ui/AGENTS.md | `CrudForm`/`DataTable`/`apiCall`/`useGuardedMutation`; no raw fetch | Compliant | all UI data calls |
| root AGENTS.md (DS) | Semantic status tokens; no arbitrary values; dialogs Cmd+Enter/Escape | Compliant | StatusBadge mapping documented |
| root AGENTS.md | i18n — no hardcoded user-facing strings; 4 locales | Compliant | key groups listed |
| packages/core/AGENTS.md (Encryption) | Encryption maps for PII/free-text | Compliant | `encryption.ts` covers notes, resolution summary, fault/inspection text, timeline bodies; reads via `findWithDecryption` |
| .ai/qa/AGENTS.md | Self-contained integration tests shipped with feature | Compliant | TC-WC-001…007 in module `__integration__/` |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | fields ↔ validators ↔ routes |
| API contracts match UI/UX section | Pass | desk/list/detail/portal use listed endpoints |
| Risks cover all write operations | Pass | CRUD, transitions, portal intake, vendor recovery |
| Commands defined for all mutations | Pass | incl. line CRUD and comments |
| Cache strategy covers read APIs | Pass (N/A) | no module cache in v1; QueryEngine/index defaults |

### Non-Compliant Items
None identified.

### Verdict
- **Fully compliant**: Approved — ready for implementation

## Changelog
### 2026-07-03
- Initial specification
- Pre-implement audit amendments: portal SSE recipient-audience requirement, optimistic-lock guard-test registration, exact portal auth mechanism (`getCustomerAuthFromRequest`), kebab-case dictionary kinds, number generator in `services/`, v1 config as code constants
- Spec-stage cross-model jury amendments (codex+kimi+deepseek, all confirmed): `encryption.ts` for free-text fields (sales precedent verified — sales DOES encrypt notes/comments), mutation-guard registry on hand-written writes (`validateCrudMutationGuard`/`runMutationGuards`), portal orderId ownership validation, module-owned portal attachment endpoints, org-scoped claim-number uniqueness, `customer_name` snapshot, `claimType` immutability, per-status update whitelists (fixes advance-replacement recording), vendor-recovery reconciliation subscriber, duplicate-safe vendor recovery
- Code-review cross-model jury fixes (Phase 8, confirmed blockers): **command-layer tenant scoping** — the scoped claim/line loaders trusted `findOneWithDecryption`'s scope arg (decryption-only, not a WHERE filter), so command action endpoints could operate on another tenant's claim by UUID; every command/lib/subscriber loader now filters `tenant_id`/`organization_id` in the WHERE (guarded by a cross-tenant transition/comment assertion in TC-WC-007). Also: initial-line `qtyApproved ≤ qtyClaimed` refinement on the create path, vendor-recovery `total_recovered_amount` aggregation across all resolved child claims + source-line cache invalidation, staff comment route strips client-supplied `actorCustomerId`, portal attachment download proxy (`?attachmentId=`, ownership-checked) with TC-WC-005 coverage
- Code-review cross-model jury round 2 fixes: **ACL feature ids aligned to the three-segment `<module>.<entity>.<action>` convention** used by catalog/sales/customers (`warranty_claims.claim.{view,create,manage,delete}` + `warranty_claims.settings.manage`); `loadLineSnapshot` scoped; `vendorClaimLineId` removed from client-writable line schemas (server-managed by the vendor-recovery command only); generic create rejects `claimType: 'vendor_recovery'` and drops client `sourceClaimId`; encrypted free-text (`resolution_summary`, `fault_description`, `inspection_notes`) excluded from the search source/searchable policy (conservative — the DB index doc is encrypted at rest, but a fresh module stays out of the search engine for these); `lineStatusGuards.approved` gains `resolved` so the credit-only/field-destroy flow resolves lines without the goods lifecycle; portal comment `actorCustomerId` uses the customer entity id

### 2026-07-04
- Independent full-harness audit pass on the committed module (competition analysis across 12+ platforms — Salesforce, Dynamics 365, NetSuite, SAP S/4HANA & B1, Odoo, ReverseLogix, Shopify/Loop/AfterShip, Epicor P21/Kinetic/Eclipse, Infor SX.e/M3, Acumatica, JD Edwards — confirmed the single-object + `claimType` discriminator, line-level dispositions, and linked vendor-recovery child claim are industry-aligned, and that a *unified native* core-charge + vendor/warranty supplier-recovery model is a genuine differentiator: near-universally non-native or ISV-only across the market). Full CI gate green (generate 0-drift, typecheck, 7297 core tests, i18n in-sync, build:app compiled); mandatory fresh-context reviewer PASS with all high-priority invariants re-confirmed (tenant/org scoping in every loader, portal customer pinning + recipient-audience sentinel, optimistic locking on all action endpoints, state-machine integrity, mutation guards, encryption of free-text, no cross-module ORM relations, atomic + duplicate-safe money rollups); cross-model jury (Codex + Kimi + DeepSeek).
- i18n coverage fixes (reviewer-confirmed minors): added `warranty_claims.errors.fieldLocked` (thrown on the per-status field-whitelist violation, previously undefined with no fallback) and `warranty_claims.errors.save_failed` (the action-route catch-all, previously English-only via an inline fallback) to all four locales (en/de/es/pl); the delete-eligibility guard now throws a dedicated `warranty_claims.errors.deleteNotAllowed` instead of the misleading `invalidTransition`.
- Cross-model jury (Codex + Kimi + DeepSeek) findings adjudicated against real code and reconciled — 5 confirmed majors + several minors fixed; 3 hallucinated findings (non-existent `lib/loaders.ts`/`commands/transition.ts`, a false "portal does not pin the customer", a false "`transition_claim` bypasses AI approval") rejected. **Fixed:** (E) removed client-writable `lineStatus` from the line **create** schemas and forced new lines to `pending`, closing a state-machine bypass where a POST could create an already-`resolved` line (still writable on the update path via `assertLineStatusMove`); (F) portal attachment links now use the ownership-checked portal `downloadUrl` (`/api/warranty_claims/portal/attachments?attachmentId=`) instead of the staff `/api/attachments/file/:id` route (which returns 401 to portal customers); (G) vendor-recovery reconciliation now aggregates `resolved` **and** `closed` child claims (and re-fires on `closed`) so a recovered child that later closes is not dropped from `total_recovered_amount`; (A) every `WarrantyClaimLine` **collection** load now filters `tenant_id`/`organization_id` in the WHERE (defense-in-depth — the parent claim is always scope-verified first and `claim_id` is globally unique, so it was not exploitable, but it makes the "every read is tenant-scoped" convention categorical); (I) portal intake soft-deletes the just-created draft if `submit` fails (no orphaned `channel: 'portal'` draft); (N) AI triage panel priority/eligibility values routed through `t()` (added `warranty_claims.eligibility.*` keys to all four locales); (P) added a TC-WC-002 case asserting a stale per-line `updatedAt` → 409; (R) reconciled §Encryption/§Phase-5 wording with the final "encrypted free-text excluded from search" decision. **Verified end-to-end:** typecheck, 22 unit tests, i18n in-sync, `build:app`, and the **full live ephemeral integration suite TC-WC-001…007 (8/8 green, incl. the new stale-lock case)**; fresh-context re-review PASS with no regressions.
- TC-WC-007 refactored from full second-**tenant** provisioning — whose freshly-API-created-tenant user JWT is rejected by RBAC-protected routes (a test-fixture/platform limitation, **not** a `warranty_claims` defect) — to the reliable second-**organization** isolation pattern (matching the spec's "second-org token sees zero rows" wording and `currencies` TC-CUR-010): an org-B user in the seeded tenant sees zero org-A claims and gets 404 on cross-org detail/transition/comment.
- **Deferred to follow-ups (documented, non-blocking):** (C) portal write endpoints (intake/comment/upload) do not wire the platform mutation-guard registry, and (D) staff action endpoints use the `@deprecated` single-service `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess` path instead of the registry-backed `runRouteMutationGuards` — both are contract-hygiene items with nil practical impact today (no additional registry guards are registered for `warranty_claims`) and carry a genuine open design question: how customer-context portal writes (no `userId`) map onto the user-feature-based guard model. (H) staff claim create/update do not validate `orderId`/`salesReturnId`/`replacementOrderId` existence + tenant scope at write time (portal intake does) — minor, staff-authenticated + feature-gated. **Accepted as-is (platform-consistent):** float-based money rollups and the parent-total recompute race both mirror the `sales` module's established pattern (do not diverge unilaterally); the number-generator DI fallback (`new …`) is dead code in a correctly-wired app.
