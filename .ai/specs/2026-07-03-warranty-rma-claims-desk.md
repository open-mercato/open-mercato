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
- Financial documents (credit memos, replacement orders) are NOT auto-generated initially — claims link to sales documents created through existing sales flows by id.

## Overview
B2B distributors (OM's primary ICP) process warranty claims, advance replacements, vendor recovery, and core returns through email threads and spreadsheets. This module gives them a first-class claims desk: structured intake (portal or staff), a triage queue with SLA visibility, per-line dispositions with partial approvals, a customer-visible timeline, and an auditable lifecycle — built entirely from OM's existing primitives (`makeCrudRoute`, commands, events, dictionaries, attachments, portal pages, AI tools).

> **Market Reference**: Studied ERPNext (Warranty Claim doctype), NetSuite (Return Authorization + Vendor RA), Adobe Commerce RMA, Dynamics 365 F&O return orders, Salesforce Manufacturing Cloud Claims, SAP B1 Return Request, Zoho Inventory, Cin7 Core, Loop/ReturnGO/AfterShip, and Syncron/Tavant warranty suites. **Adopted:** Salesforce/D365's single claim object with a type discriminator; D365's line-level disposition codes (incl. credit-only/field-destroy); Magento's partial authorization (per-line statuses); Syncron's vendor-recovery claim linked to the source customer claim; ERPNext's warranty-status-computed-at-intake; Zoho's "no stock/credit effect before physical receipt" gate. **Rejected:** separate entities per claim type (Salesforce's ClaimCoverage/ClaimParticipant complexity is enterprise-adjudication overkill); dictionary-driven *statuses* (a code-enforced state machine needs frozen status ids — configurability lives in fault/reason dictionaries instead); auto-adjudication rules engines (future candidate via `business_rules`).

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
| Vendor recovery = linked child claim (`sourceClaimId`) | Syncron's highest-ROI pattern: recoverable resolved lines are copied into a `vendor_recovery` claim, keeping the money trail connected. The initial scope creates it via an explicit command (no auto-matching). |
| Vendor snapshot fields (`vendorName`, `vendorRef`) instead of FK | Core has no vendor master entity. A text snapshot keeps the module decoupled; when a vendor module lands, an additive `vendor_id` column can join it. |
| No auto financial documents initially | Credit memos / replacement orders are created through existing sales flows and linked by id (`salesReturnId`, `replacementOrderId`). Avoids cross-module writes into sales aggregates. |
| Module-local `WarrantyClaimNumberGenerator` | Mirrors `SalesDocumentNumberGenerator` (`sales/services/salesDocumentNumberGenerator.ts` — lives in `services/`, DI-registered). Per tenant/org/type sequences: `WTY-`, `RMA-`, `COR-`, `VRC-` prefixes. |
| Timeline as immutable event rows | Audit-trail requirement; `visibility: internal|customer` gates what the portal sees. No `updated_at` — events are append-only. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Extend `sales.SalesReturn` with claim fields | Returns are financial/goods documents; claims are cases. Conflating them breaks both lifecycles and violates minimal-impact on a busy module. Claims *link* to returns instead. |
| Build on the `workflows` module engine | Workflow instances are automation runs, not user-facing case records with lines/amounts. A future pass can trigger workflows from claim events. |
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
- The initial scope hard-codes module defaults in code constants: SLA 48h, portal intake enabled. A tenant-editable settings surface (mirroring sales settings) is a follow-up — no config mechanism is introduced initially.

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
- No cross-module writes: sales documents are never mutated by this module (initially), eliminating the largest blast-radius risk.

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
- **Residual risk**: no rate limiting yet — acceptable for authenticated B2B portal users.

## Desk Upgrade Scope — World-Class Desk (second pass, 2026-07-04)

A second full-harness pass over the first-pass module: (a) close every defect and deferred item from the 2026-07-04 audits, (b) close the desk-ergonomics gaps found by the UI/UX depth review, and (c) ship four competitive differentiators (benchmarked against Syncron/Tavant/ServiceNow/ReturnLogic/Claimlane operational features) that reuse in-tenant data and existing platform primitives. Everything is additive; no earlier contract surface changes shape.

### Hardening (audit findings — all fixed, none re-deferred)
1. **Staff realtime fix (P1).** `claim.status_changed` currently emits `recipientUserIds` = portal customer-user ids (or the `__no_portal_recipients__` sentinel), and the staff DOM bridge (`packages/events/src/modules/events/api/stream/route.ts`) filters on the same field — so staff never receive it. Both bridges read the SAME audience keys from one payload, so a single event cannot be simultaneously customer-pinned (portal requirement) and staff-visible. Fix (the module is unreleased in this same PR, so the event surface may still be restructured): split the broadcast — `warranty_claims.claim.status_changed` becomes `clientBroadcast: true` only and emits WITHOUT `recipientUserIds` (tenant/org-scoped staff audience), and a new `warranty_claims.claim.portal_status_changed` (`portalBroadcast: true` only) carries the customer-user-pinned payload for the portal stream. `comment_added` stays portal-pinned as-is. Backend list + triage pages subscribe via `useAppEvent('warranty_claims.claim.*', …)` (import `@open-mercato/ui/backend/injection/useAppEvent`) and refresh.
2. **(D) closed.** All 5 staff action routes swap the `@deprecated` `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess` pair for registry-backed `runRouteMutationGuards` (`packages/shared/src/lib/crud/route-mutation-guard.ts`), honoring `modifiedPayload`/`runAfterSuccess`.
3. **(C) closed.** Portal writes (intake, comment, attachment upload) wire `runRouteMutationGuards` with `userId: auth.sub` (customer-account user id) and `userFeatures: []`, so staff-feature-gated guards skip deterministically; design note recorded here — portal guard identity is the customer-account user, not a staff user.
4. **(H) closed.** Staff create/update validate `orderId`/`orderLineId`/`salesReturnId`/`replacementOrderId` existence + tenant/org scope via QueryEngine at write time (absent-module-tolerant: lookup skipped when the sales module isn't installed). On **update**, a ref is validated only when its value actually changes — claims holding historical refs that were later deleted remain editable without re-validation of unchanged fields. `claim.assign` validates `assigneeUserId` is an active user of the tenant.
5. **Decoupling.** Direct cross-module entity imports (`CustomerEntity` in commands, `SalesOrder`/`SalesOrderLine` in portal intake) are replaced with QueryEngine lookups so the module tolerates absent peers. Absent-module degradation is unit-tested in the module's own `__tests__/claim-commands.test.ts` (create with `orderId` while the QueryEngine throws → validation skipped, claim created) — the command-path equivalent of `module-decoupling.test.ts`, whose reduced-registry harness cannot exercise command internals.
6. **Flow fixes.** Portal customer reply on an `info_requested` claim auto-transitions it back to `in_review` (system timeline event) and notifies the assignee; `closed → in_review` reopen transition added (staff `manage` feature; timeline event; `cancelled` stays terminal); claim soft-delete cascades to its lines.
7. **Validation/math fixes.** `qtyReceived`/`qtyApproved` bounds enforced on line **update** (not just create); lines-API create assigns `lineNo = max(existing)+1` instead of defaulting to 1; explicit `warrantyExpiresAt`/`warrantyStatus` no longer clobbered when `purchaseDate`+`warrantyMonths` are co-present; `addMonths` month-end overflow fixed (Jan 31 + 1m → Feb 28/29).
8. **Cleanups.** Untranslated flash of raw i18n keys fixed (`flash(t(message))`); `lib/triage.ts` reason strings i18n-keyed; vendor-recovery reconciliation re-runs on undo of a child transition (subscriber also listens to the crud `updated` event); dead code removed (`claimListQuerySchema`, unused `loadScopedClaim` import, wrong default `recipientUserIds=[customerId]` in `claimEventPayload`); module `AGENTS.md` + `notifications.client.ts` click-through renderers added.

### Desk ergonomics (UI/UX review — all P1/P2 fixed)
- **Assignment**: assign dialog becomes a staff picker (reuse `fetchAssignableStaffMembers` from `@open-mercato/core/modules/customers/components/detail/assignableStaff`, the customers deal-owner pattern); the module's `setup.ts` `defaultRoleFeatures` additionally grants the same user-directory read feature the customers module grants its desk roles, so the picker works out of the box. Triage workspace header shows the assignee and allows reassign; "My claims" quick filter.
- **Queue**: status/overdue count chips above the desk list (fed by the stats endpoint), bulk actions (assign, cancel) via DataTable `bulkActions`, URL-synced filters/sort/page, overdue-first default sort toggle. **Bulk mutation contract**: bulk actions fan out client-side over the existing single-claim endpoints (`/assign`, `/transition`), each request carrying that row's own `updatedAt` optimistic-lock header; per-row failures (409/400/403) are collected, the action reports `n succeeded / m failed (first error)` via flash, and the list refetches afterwards — no new bulk API surface, no partial-write ambiguity.
- **SLA display**: three-tier rendering — normal / at-risk (elapsed ≥ threshold, warning token) / overdue (danger token); absolute-time tooltip on relative countdowns; paused chip while `info_requested`.
- **Triage**: inline hot-path editing (qtyApproved, disposition, lineStatus) directly in the lines grid — full dialog stays for the long tail; timeline shows actor display names and `from → to` status labels (reusing the portal `formatEventBody` approach); priority rendered as `StatusBadge` (urgent=danger, high=warning, normal=neutral, low=muted).
- **Consistency**: status/lineStatus/priority→variant maps exported once from `ClaimStatusBadge.tsx` (fixes the drifted portal `approved` mapping); detail tab strip switches to the sales-desk underline pattern; local `relativeTime`/`formatDateTime` copies replaced by `@open-mercato/shared/lib/time`; widget icons moved onto the documented icon scale.
- **Create**: multi-line create (repeatable line rows) and order picker (customer-scoped order search select) replacing the free-text UUID field; order ids render as links to the sales document detail.
- **Portal**: intake selects for reason/fault codes fed by a new portal options endpoint (no more free-text codes); wizard steps become real steps (order → lines → details → review); stepper handles `draft`/`info_requested`/`rejected` states explicitly; client-side attachment size/type validation. The claims list stays on `DataTable` — `packages/ui/AGENTS.md` mandates DataTable for portal lists (the card pattern is dashboard-only).

### Differentiators
1. **`WarrantyClaimSettings`** (new entity, table `warranty_claim_settings`, one row per tenant/org — unique index on `(organization_id, tenant_id)` mirroring `sales_settings`): `sla_hours` (int, default 48), `sla_pause_on_info_requested` (bool, default true), `sla_at_risk_threshold_pct` (int, default 75), `auto_approve_enabled` (bool, default false), `auto_approve_max_amount` (numeric null), `auto_approve_currency_code` (text null), `auto_approve_require_in_warranty` (bool, default true). Surface mirrors the sales settings precedent exactly (`sales/api/settings/order-editing/route.ts` + `loadSalesSettings` + `sales.settings.save`): hand-written GET/PUT `api/settings-general/route.ts` (→ `/api/warranty_claims/settings-general`, feature `warranty_claims.settings.manage`, `runRouteMutationGuards`, zod-validated, GET returns effective values with defaults), upsert command `warranty_claims.settings.save`, loader `lib/settings.ts` (`loadWarrantyClaimSettings(em, scope)` + `resolveEffectiveSettings` with the initial code constants as fallbacks). Guard-test registration follows however `SalesSettings` is classified in `optimistic-lock-editable-entities.test.ts`. Editable in a new "General" section of the existing settings page.
2. **SLA pause/resume engine**: new claim columns `sla_paused_at` (timestamptz null). Entering `info_requested` (when pause enabled) stamps `sla_paused_at`; leaving it shifts `sla_due_at` by the paused duration and clears the stamp. Overdue/at-risk computations treat paused claims as neither. Timeline records pause/resume as system events. Proactive breach escalation (cron sweep + manager notify) is explicitly deferred to the connected-intake pass — it needs the scheduler-integration decision documented in the roadmap.
3. **Risk signals** (`lib/risk.ts`, staff-only endpoint `GET /api/warranty_claims/risk?claimId=`, feature `warranty_claims.claim.view`): deterministic, tenant-scoped checks — duplicate serial (same serial on other non-cancelled claims, with claim numbers), repeat claimer (customer claim count in the last 90 days ≥ 3 medium / ≥ 5 high), claim-value velocity (customer's summed claimed amount over 90 days). Rendered as risk chips in the triage header; `suggest_triage` folds the same signals into its heuristics. Thresholds are code constants for now.
4. **Light auto-adjudication** (default OFF): evaluated **synchronously inside the `claim.submit` command's atomic flush** (never a subscriber — a claim is never externally observable in a transient pre-adjudication state; submit + auto-approve timeline events commit together, events emit after commit). Straight-through-eligible = settings enable it AND every line `in_warranty` (when required) AND `total_claimed_amount ≤ auto_approve_max_amount` with `currency_code` equal to `auto_approve_currency_code` AND **zero risk flags**. The claim lands in `approved` with a system timeline event (`autoApproved` + rule facts). **Null-knob semantics**: with `auto_approve_enabled = true` but `auto_approve_max_amount` or `auto_approve_currency_code` null, auto-adjudication is INACTIVE (nothing auto-approves), and the `settings.save` command rejects a merged state of enabled-with-null-knobs with 400 `warranty_claims.errors.autoApproveConfigIncomplete` — misconfiguration is impossible to persist. Auto-deny is deliberately excluded (human rejection only). The full tenant-configurable rules engine remains a follow-up (via `business_rules`).
5. **KPI strip** (`GET /api/warranty_claims/stats`, feature `warranty_claims.claim.view`): open-by-status-group counts, overdue count, avg resolution days (last 30d), approval rate (last 30d), recovered total (last 30d) — rendered as cards above the desk list and powering the queue chips. Computed live per tenant/org scope (no materialization yet).

### Desk-upgrade API additions (all additive, tenant/org-scoped, `requireAuth` + features)
- `GET/PUT /api/warranty_claims/settings-general` (hand-written, singleton-per-scope semantics, `settings.manage`, sales-settings precedent)
- `GET /api/warranty_claims/stats` (`claim.view`)
- `GET /api/warranty_claims/risk?claimId=` (`claim.view`)
- `GET /api/warranty_claims/portal/options` (customer session; active fault/reason dictionary entries only)

### Desk-upgrade Integration Test Coverage (mandatory additions)
| TC | Path(s) | Assertions |
|----|---------|-----------|
| TC-WC-008 SLA pause/resume + reopen | `/transition`, `/api/warranty_claims` | info_requested pauses (slaPausedAt set, overdue excluded), reply/staff-move resumes with shifted slaDueAt; closed→in_review reopen works, cancelled stays terminal |
| TC-WC-009 Settings + auto-adjudication | `/settings-general`, `/submit` | settings CRUD + optimistic lock; auto-approve ON → eligible claim lands `approved` with system event; ineligible (out-of-warranty / over max / risk-flagged / currency mismatch) stays `submitted`; OFF by default |
| TC-WC-010 Stats + risk | `/stats`, `/risk` | 401/403 gates; duplicate-serial flag across two fixture claims; repeat-claimer flag at ≥3 claims; stats counts/overdue reflect fixtures |
| TC-WC-005 (extend) | `/portal/options`, `/portal/events` | options returns seeded dictionary entries; customer reply on info_requested claim → claim back to `in_review` + staff notification row |
| TC-WC-002 (extend) | `/lines` | qtyReceived > qtyClaimed rejected on update; lineNo auto-increments on lines-API create |
| TC-WC-001 (extend) | `/api/warranty_claims`, `/assign` | staff create with dangling orderId → 400; assign with non-tenant user id → 400 |

### Desk-upgrade Migration & BC
- Additive migration only: `warranty_claim_settings` table + `warranty_claims.sla_paused_at` column. No column drops/renames; pre-existing rows behave identically with settings absent (code-constant fallbacks).
- New FROZEN surfaces: routes above; no new ACL features (reuses `claim.view`/`settings.manage`); one new event id `warranty_claims.claim.portal_status_changed` plus the broadcast-flag restructuring of `status_changed` (legitimate because the initial event surface ships unreleased in this same PR — nothing external ever consumed it); one new notification type id for the customer-reply staff alert; renderer ids in `notifications.client.ts` match the module's notification type ids.
- Existing integration tests TC-WC-001…007 must stay green unmodified except the listed extensions.

## Connected Intake, External API & AI Copilot Scope (third pass, 2026-07-04)

A third full-harness pass closing the remaining "forms that save to the database" gaps: product/order data now flows INTO claims from the catalog and sales modules instead of being retyped; organizations get a headless, API-key-secured intake API (plus signed webhooks) to build their own claim-filing pages; and the desk gains an LLM copilot. Benchmarked against a fresh 2026 SOTA sweep (Loop/ReturnGO/AfterShip/Narvar/ReturnLogic/Claimlane/Syncron/Tavant/PTC/ServiceNow/Shopify/D365): connected intake with entitlement pre-check is the industry baseline we lacked; a genuinely public self-service intake API is a differentiator (the ERP-tier products publish none); agent copilots with drafted replies are the shipped-AI pattern (Zendesk/D365). Everything is additive; no earlier surface changes shape (all still unreleased in this same PR).

### Connected staff intake (kill manual product entry)
1. **Line product picker.** Every claim-line editor (create page `LineItemsEditor`, triage add/edit line dialog, edit page) gains a catalog product picker mirroring `sales/components/documents/LineItemDialog.tsx`: async Combobox over `GET /api/catalog/products?search=` (thumbnail via `default_media_url`, title, sku), then variant select over `GET /api/catalog/variants?productId=` when the product has variants; picking fills `productId`/`variantId`/`sku`/`productName` (snapshot-first — fields stay editable). Free-text entry remains a first-class fallback (B2B distributors claim uncataloged vendor items).
2. **Add lines from order.** When the claim has an `orderId` (picked or `?orderId=` prefill from the sales-order tab), an "Add from order" action fetches `GET /api/sales/order-lines?orderId=&pageSize=100`, shows the product-kind lines (name, sku, ordered qty), and inserts selected lines as prefilled claim rows: `productId`/`variantId`/`sku`/`productName`/`qtyClaimed` (=ordered qty, editable)/`orderLineId`, `purchaseDate` defaulted from the order's `placedAt`. Sales lines carry no serials — serial stays manual.
3. **Warranty defaults + entitlement chip.** New setting `default_warranty_months` (int null, `warranty_claim_settings`): line editors prefill an empty `warrantyMonths` from it; when `purchaseDate` + `warrantyMonths` are present the row shows an instant client-side in/out-of-warranty chip (preview only — the server compute at intake remains the source of truth).

### Connected portal intake
1. **Module-owned portal order endpoints** (customer session, server-pinned; same QueryEngine ownership pattern as intake validation, proven by TC-WC-005):
   - `GET /api/warranty_claims/portal/orders?search=&page=` — the session customer's own orders: `{id, orderNumber, placedAt, currencyCode, grandTotalGrossAmount}` (filters `customer_entity_id` + tenant/org + `deleted_at`).
   - `GET /api/warranty_claims/portal/orders/lines?orderId=` — ownership-checked (cross-customer → 404); product-kind lines `{orderLineId, productId, variantId, sku, name, quantity, estimatedWarrantyStatus}` where `estimatedWarrantyStatus` = compute(`placedAt` + `default_warranty_months`), `unknown` when no default configured.
2. **Wizard becomes connected.** Step 1: real order picker fed by `portal/orders` (manual `orderReference` text stays as explicit "my order isn't listed" fallback). Step 2: when an order is picked, a line picker inserts prefilled item rows (product name/sku/qty + `orderLineId`, entitlement chip from `estimatedWarrantyStatus`); manual item add remains. `portalClaimLineInputSchema` gains optional `orderLineId` + `productName`; the server re-validates `orderLineId` belongs to the claim's order via the existing shared sales-reference validation.

### External intake API + webhooks (headless claim filing)
The platform's API keys already authenticate as first-class principals on `requireAuth`+`requireFeatures` routes (`X-Api-Key: omk_…` / `Authorization: ApiKey omk_…` → auth context with role-derived features, tenant/org-scoped — `packages/shared/src/lib/auth/server.ts:244`). The external surface is therefore pure module code:
1. **New ACL features** `warranty_claims.external.submit` and `warranty_claims.external.view` (in `setup.ts` granted to `admin` only) — orgs mint a least-privilege role carrying exactly these two and bind it to an API key for their website backend.
2. **`POST /api/warranty_claims/external/claims`** (hand-written, `external.submit`, zod, `runRouteMutationGuards`, OpenAPI): body `{externalRef (REQUIRED, 1–190 chars — the caller's correlation id; makes every retry idempotent), orderId? | orderNumber?, customerId?, contactName?, contactEmail?, reasonCode?, notes?, lines[1..]: {productId?|sku?, productName?, serialNumber?, faultCode?, faultDescription, qtyClaimed, purchaseDate?, warrantyMonths?}}`. Resolution (all tenant/org-scoped): order by `orderId` or `orderNumber` (unresolvable → 400, no cross-tenant leak); customer := the order's `customerEntityId` — and when an explicit `customerId` is ALSO supplied and disagrees with the order's customer → 400 `warranty_claims.errors.customerOrderMismatch` (never silently relink); else validated explicit `customerId`, else **unlinked** with contact snapshot — an unlinked submission REQUIRES `contactEmail` (schema-refined 400 otherwise; the org must be able to reach the filer). Customers' `primary_email` is encrypted with no hash column, so email-based lookup is deliberately NOT attempted. Per-line `sku` resolves a catalog product only on a strict single active match (tenant/org-scoped); zero or multiple matches keep the line snapshot-only. `reasonCode`/`faultCode` are validated identically to the portal intake path (shared behavior, no stricter and no looser). **Webhook correlation:** the `claim.submitted` / `claim.status_changed` event payloads carry `claimNumber` and `externalRef` (when set), so webhook consumers can match deliveries to their own records without a follow-up GET. Creates via the existing `claim.create` + `claim.submit` commands — `channel: 'api'`, identical risk/auto-adjudication path as portal; when `submit` fails after `create`, the just-created draft is soft-deleted exactly like the portal intake (no orphaned `channel: 'api'` drafts). **Idempotency:** new claim column `external_ref` (text null in schema; always set on this path) with a **partial UNIQUE index** on (`tenant_id`, `organization_id`, `external_ref`) `WHERE external_ref IS NOT NULL AND deleted_at IS NULL`; a replay with the same `externalRef` returns the existing claim (200), and a concurrent duplicate resolves via the unique-violation catch → return-existing path (race-safe; a replay landing inside the create→submit window may return the claim still in `draft` — callers observe the settled status via GET). Response: `{id, claimNumber, status, externalRef, lines: [{id, warrantyStatus}]}`.
3. **`GET /api/warranty_claims/external/claims?id=|claimNumber=|externalRef=`** (`external.view`): claim header + **all claim lines** (`lineStatus`, `disposition`, `qtyClaimed`/`qtyApproved`, product refs, `warrantyStatus`) + the **customer-visible timeline entries** (internal entries excluded per portal visibility rules) — enough to render a full status page for the org's client without a portal session.
4. **New claim columns** (additive migration + snapshot): `external_ref` text null (indexed with tenant/org), `contact_email` text null (declared in `encryption.ts`), reusing `customer_name` for the contact-name snapshot.
5. **Outbound webhooks — no code needed (spec-jury correction).** The webhooks module's wildcard dispatcher (`packages/webhooks/src/modules/webhooks/subscribers/outbound-dispatch.ts`, `event: '*'`) already delivers every declared, non-excluded module event to tenant subscriptions — `warranty_claims.claim.submitted` / `.status_changed` are webhook-subscribable today via the webhooks admin UI. A module-local bridge would double-deliver; deliberately NOT built. The external-API docs simply reference the existing event ids as the webhook vocabulary.
6. **Desk visibility:** the desk list/detail render the claim `channel` (badge + filter) so API-intake claims are distinguishable.

### AI copilot (staff-side, human-in-the-loop)
1. **`ai-agents.ts`**: agent `warranty_claims.claims_assistant` (`defineAiAgent`, `requiredFeatures: ['warranty_claims.claim.view']`) with `allowedTools`: existing `list_claims`/`get_claim`/`suggest_triage`/`transition_claim` (approval-gated) plus new `draft_customer_reply` and `summarize_claim`; prompt sections describe the desk workflow (triage → entitlement → disposition → recovery).
2. **New read-only AI tools** (`ai-tools.ts`) backed by `lib/aiAssist.ts` using the ai-assistant model factory per the `inbox_ops` precedent (`createModelFactory(container).resolveModel({ moduleId: 'warranty_claims' })`, per-tenant provider selection, graceful "not configured" degradation): `draft_customer_reply` (claim + customer-visible timeline → suggested reply text; staff sends it manually) and `summarize_claim` (full history → tight summary with open questions).
3. **`POST /api/warranty_claims/ai/draft-reply`** `{claimId, tone?}` (feature `claim.manage`, LLM-gated): powers a "Draft with AI" button in the timeline comment composer — the draft lands in the textarea for human review/edit, never auto-sends. Returns a structured not-configured status when no LLM is set up; the UI hides the button accordingly.
4. **Embedded copilot:** the triage workspace AI tab embeds `<AiChat agent="warranty_claims.claims_assistant" pageContext={{ recordId: claimId }}>` (`@open-mercato/ui/ai/AiChat`; direct embed — own-module page, no injection widget) alongside the existing deterministic suggestion card.

### Connected-intake API additions (all additive)
- `GET /api/warranty_claims/portal/orders`, `GET /api/warranty_claims/portal/orders/lines` (customer session)
- `POST/GET /api/warranty_claims/external/claims` (`external.submit`/`external.view`, API-key-friendly)
- `POST /api/warranty_claims/ai/draft-reply` (`claim.manage`, LLM-gated)

### Connected-intake Integration Test Coverage (mandatory additions)
| TC | Path(s) | Assertions |
|----|---------|-----------|
| TC-WC-011 External API | `/external/claims` | 401 without/invalid key; 403 key lacking external features; missing `externalRef` → 400; create with `orderNumber` resolves order + customer, `channel=api`; `externalRef` replay returns same claim id (no duplicate); unresolvable/cross-tenant orderNumber → 400; unlinked create keeps contact snapshot; GET by claimNumber returns lines + customer-visible timeline only (internal entries absent); fixtures create the role + API key via `/api/api_keys/keys` |
| TC-WC-012 Portal orders | `/portal/orders`, `/portal/orders/lines` | lists only the session customer's orders; cross-customer `orderId` on lines → 404; `estimatedWarrantyStatus` populated when `default_warranty_months` set; intake with an `orderLineId` from another order → 400 |
| TC-WC-013 AI draft | `/ai/draft-reply` | 401/403 gates; LLM-unconfigured → documented degradation shape (LLM-gated skip pattern for live drafting) |
| TC-WC-009 (extend) | `/settings-general` | `default_warranty_months` round-trip |
| TC-WC-005 (extend) | `/portal/claims` | intake accepts picked `orderLineId` lines and persists the product refs |

Unit: external resolution precedence (order > explicit customerId > unlinked), idempotent replay + unique-violation return-existing path, submit-failure draft soft-delete, `estimatedWarrantyStatus` math (month-end safe via existing `addMonths`), draft-reply lib prompt assembly + not-configured path (mocked model factory).

### Connected-intake Migration & BC
- Additive migration only: `warranty_claims.external_ref` + `warranty_claims.contact_email` columns, `warranty_claim_settings.default_warranty_months` column, partial unique index on (`tenant_id`,`organization_id`,`external_ref`) where set and not deleted.
- Staff "Add from order" depends on the caller holding sales read features (same class as the order picker); the UI degrades by hiding the action on 403 — documented, not a BC issue.
- New FROZEN surfaces: the 5 routes above, ACL ids `warranty_claims.external.{submit,view}`, agent id `warranty_claims.claims_assistant`, AI tool ids `warranty_claims.{draft_customer_reply,summarize_claim}`. No existing surface changes shape; TC-WC-001…010 stay green unmodified except the listed extensions.

### Deferred roadmap (implemented by the completion spec)
Implemented in [`2026-07-05-warranty-rma-claims-desk-completion.md`](./2026-07-05-warranty-rma-claims-desk-completion.md).
Receiving workbench (dock scan/match/mismatch capture); RMA return-label generation + carrier tracking auto-advance (carrier-integration framework; enables first-scan-triggered dispositions); proactive SLA escalation tiers + business-hours calendars (scheduler integration decision); email-to-claim intake (communication channels); warranty registration & third-party purchase registration as the entitlement base (ReturnLogic pattern); quarantine hold (inventory blast radius); per-vendor warranty policy catalog with auto-generated supplier-recovery claims (PTC iWarranty pattern); full auto-adjudication rules via `business_rules`; response enricher exposing claim counts on customer detail; photo damage assessment + attachment document intelligence (LLM vision); guided per-category troubleshooting decision trees; dynamic policy by customer risk tier.

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
| Cache strategy covers read APIs | Pass (N/A) | no module cache yet; QueryEngine/index defaults |

### Non-Compliant Items
None identified.

### Verdict
- **Fully compliant**: Approved — ready for implementation

## Changelog
### 2026-07-03
- Initial specification
- Pre-implement audit amendments: portal SSE recipient-audience requirement, optimistic-lock guard-test registration, exact portal auth mechanism (`getCustomerAuthFromRequest`), kebab-case dictionary kinds, number generator in `services/`, initial config as code constants
- Spec-stage cross-model jury amendments (codex+kimi+deepseek, all confirmed): `encryption.ts` for free-text fields (sales precedent verified — sales DOES encrypt notes/comments), mutation-guard registry on hand-written writes (`validateCrudMutationGuard`/`runMutationGuards`), portal orderId ownership validation, module-owned portal attachment endpoints, org-scoped claim-number uniqueness, `customer_name` snapshot, `claimType` immutability, per-status update whitelists (fixes advance-replacement recording), vendor-recovery reconciliation subscriber, duplicate-safe vendor recovery
- Code-review cross-model jury fixes (Phase 8, confirmed blockers): **command-layer tenant scoping** — the scoped claim/line loaders trusted `findOneWithDecryption`'s scope arg (decryption-only, not a WHERE filter), so command action endpoints could operate on another tenant's claim by UUID; every command/lib/subscriber loader now filters `tenant_id`/`organization_id` in the WHERE (guarded by a cross-tenant transition/comment assertion in TC-WC-007). Also: initial-line `qtyApproved ≤ qtyClaimed` refinement on the create path, vendor-recovery `total_recovered_amount` aggregation across all resolved child claims + source-line cache invalidation, staff comment route strips client-supplied `actorCustomerId`, portal attachment download proxy (`?attachmentId=`, ownership-checked) with TC-WC-005 coverage
- Code-review cross-model jury round 2 fixes: **ACL feature ids aligned to the three-segment `<module>.<entity>.<action>` convention** used by catalog/sales/customers (`warranty_claims.claim.{view,create,manage,delete}` + `warranty_claims.settings.manage`); `loadLineSnapshot` scoped; `vendorClaimLineId` removed from client-writable line schemas (server-managed by the vendor-recovery command only); generic create rejects `claimType: 'vendor_recovery'` and drops client `sourceClaimId`; encrypted free-text (`resolution_summary`, `fault_description`, `inspection_notes`) excluded from the search source/searchable policy (conservative — the DB index doc is encrypted at rest, but a fresh module stays out of the search engine for these); `lineStatusGuards.approved` gains `resolved` so the credit-only/field-destroy flow resolves lines without the goods lifecycle; portal comment `actorCustomerId` uses the customer entity id

### 2026-07-04
- Independent full-harness audit pass on the committed module (competition analysis across 12+ platforms — Salesforce, Dynamics 365, NetSuite, SAP S/4HANA & B1, Odoo, ReverseLogix, Shopify/Loop/AfterShip, Epicor P21/Kinetic/Eclipse, Infor SX.e/M3, Acumatica, JD Edwards — confirmed the single-object + `claimType` discriminator, line-level dispositions, and linked vendor-recovery child claim are industry-aligned, and that a *unified native* core-charge + vendor/warranty supplier-recovery model is a genuine differentiator: near-universally non-native or ISV-only across the market). Full CI gate green (generate 0-drift, typecheck, 7297 core tests, i18n in-sync, build:app compiled); mandatory fresh-context reviewer PASS with all high-priority invariants re-confirmed (tenant/org scoping in every loader, portal customer pinning + recipient-audience sentinel, optimistic locking on all action endpoints, state-machine integrity, mutation guards, encryption of free-text, no cross-module ORM relations, atomic + duplicate-safe money rollups); cross-model jury (Codex + Kimi + DeepSeek).
- i18n coverage fixes (reviewer-confirmed minors): added `warranty_claims.errors.fieldLocked` (thrown on the per-status field-whitelist violation, previously undefined with no fallback) and `warranty_claims.errors.save_failed` (the action-route catch-all, previously English-only via an inline fallback) to all four locales (en/de/es/pl); the delete-eligibility guard now throws a dedicated `warranty_claims.errors.deleteNotAllowed` instead of the misleading `invalidTransition`.
- Cross-model jury (Codex + Kimi + DeepSeek) findings adjudicated against real code and reconciled — 5 confirmed majors + several minors fixed; 3 hallucinated findings (non-existent `lib/loaders.ts`/`commands/transition.ts`, a false "portal does not pin the customer", a false "`transition_claim` bypasses AI approval") rejected. **Fixed:** (E) removed client-writable `lineStatus` from the line **create** schemas and forced new lines to `pending`, closing a state-machine bypass where a POST could create an already-`resolved` line (still writable on the update path via `assertLineStatusMove`); (F) portal attachment links now use the ownership-checked portal `downloadUrl` (`/api/warranty_claims/portal/attachments?attachmentId=`) instead of the staff `/api/attachments/file/:id` route (which returns 401 to portal customers); (G) vendor-recovery reconciliation now aggregates `resolved` **and** `closed` child claims (and re-fires on `closed`) so a recovered child that later closes is not dropped from `total_recovered_amount`; (A) every `WarrantyClaimLine` **collection** load now filters `tenant_id`/`organization_id` in the WHERE (defense-in-depth — the parent claim is always scope-verified first and `claim_id` is globally unique, so it was not exploitable, but it makes the "every read is tenant-scoped" convention categorical); (I) portal intake soft-deletes the just-created draft if `submit` fails (no orphaned `channel: 'portal'` draft); (N) AI triage panel priority/eligibility values routed through `t()` (added `warranty_claims.eligibility.*` keys to all four locales); (P) added a TC-WC-002 case asserting a stale per-line `updatedAt` → 409; (R) reconciled §Encryption/§Phase-5 wording with the final "encrypted free-text excluded from search" decision. **Verified end-to-end:** typecheck, 22 unit tests, i18n in-sync, `build:app`, and the **full live ephemeral integration suite TC-WC-001…007 (8/8 green, incl. the new stale-lock case)**; fresh-context re-review PASS with no regressions.
- TC-WC-007 refactored from full second-**tenant** provisioning — whose freshly-API-created-tenant user JWT is rejected by RBAC-protected routes (a test-fixture/platform limitation, **not** a `warranty_claims` defect) — to the reliable second-**organization** isolation pattern (matching the spec's "second-org token sees zero rows" wording and `currencies` TC-CUR-010): an org-B user in the seeded tenant sees zero org-A claims and gets 404 on cross-org detail/transition/comment.
- **Deferred to follow-ups (documented, non-blocking):** (C) portal write endpoints (intake/comment/upload) do not wire the platform mutation-guard registry, and (D) staff action endpoints use the `@deprecated` single-service `validateCrudMutationGuard`/`runCrudMutationGuardAfterSuccess` path instead of the registry-backed `runRouteMutationGuards` — both are contract-hygiene items with nil practical impact today (no additional registry guards are registered for `warranty_claims`) and carry a genuine open design question: how customer-context portal writes (no `userId`) map onto the user-feature-based guard model. (H) staff claim create/update do not validate `orderId`/`salesReturnId`/`replacementOrderId` existence + tenant scope at write time (portal intake does) — minor, staff-authenticated + feature-gated. **Accepted as-is (platform-consistent):** float-based money rollups and the parent-total recompute race both mirror the `sales` module's established pattern (do not diverge unilaterally); the number-generator DI fallback (`new …`) is dead code in a correctly-wired app. *(Superseded 2026-07-04: C, D, and H are all closed by the desk-upgrade scope below.)*

### 2026-07-04 (desk-upgrade pass — cross-model jury round)
- Code-diff jury (Codex + Kimi + DeepSeek; Codex down-weighted as implementer). Confirmed and fixed: explicit `warrantyExpiresAt` was clobbered by the computed value on BOTH create paths (initial claim lines + lines API) — explicit values now win on create like they do on update; the lines sub-resource create/update never validated `orderLineId` — both now run the shared sales-reference validation (changed-only on update, belongs-to-claim-order when the claim has an order); the triage page's transition/assign handlers flashed SUCCESS after surfacing an optimistic-lock conflict (operation returned the failed call instead of aborting) — conflict now short-circuits; the staff "Add line" dialog sent `lineStatus` which the strict create schema rejects, 400-ing every dialog-create — `lineStatus` now rides edit mode only and the field is hidden on create. Rejected as spurious: Kimi's three findings and several DeepSeek findings were diff-split artifacts (voters saw partial areas); "portal E.sales deref crashes when sales absent" — the access is inside the try/catch and conservative-reject on unverifiable orderId is this spec's documented portal behavior. **Accepted residual (documented):** the customer-reply auto-resume inside `claim.comment` cannot carry an optimistic-lock token (customers have none); a concurrent staff transition committing in the same instant can be overwritten by the resume — narrow window, benign outcome (claim lands `in_review`), same class as the platform's other last-write races.

### 2026-07-04 (desk-upgrade pass — verification loops)
- Live-suite loop (14 specs against the ephemeral env) surfaced two runtime defects in the QueryEngine-based lookups that unit tests could not catch: assignee validation on `auth:user` and portal options on `dictionaries:*` silently returned empty for seeded rows (hybrid engine routing). Both switched to the platform's own proven mechanisms — a tenant-scoped kysely `users` existence probe (`inbox_ops` precedent) and an em-based `loadWarrantyClaimDictionaryOptions` in `lib/dictionaries.ts` (sales precedent). Lesson recorded: QueryEngine is not a universal cross-module read path; prefer em/kysely where the platform itself does.
- Fresh-context adversarial review (fail → all findings fixed): (1) undo-path vendor-recovery reconciliation was dead code — the crud `claim.updated` payload lacked `claimType`; `claimCrudEvents` now declares `buildPayload` carrying `claimType`/`status` (unit-guarded); (2) removed the unauthorized `customers.activities.manage` grant from `setup.ts` (both staff-picker endpoints gate on `customers.roles.view` alone); (3) `sla_at_risk_threshold_pct` is now actually consumed — exposed via `/stats` (claim.view) and passed to the SLA indicator on the desk list and triage header; (4) auto-approve additionally requires ≥1 line; (5) reference validation reads `E.sales`/`E.customers` via optional chaining (absent-module-safe in reduced registries) and a changed/dangling `customerId` again 400s (`strict` resolve on create and on customer change, tolerant refresh otherwise); (6) portal intake/comment honor `guarded.modifiedPayload` with server-owned fields re-pinned (attachment upload is multipart — transform N/A by design); (7) migration `down()` drops `warranty_claim_settings`; (8) TC-WC-001 asserts the dangling-orderId 400 unconditionally and TC-WC-005 asserts the assignee's customer-replied notification row. Cosmetic deviation documented: priority badge uses `normal=info`/`low=neutral` because `StatusBadge` has no `muted` variant.

### 2026-07-05 (connected-intake pass — code review round)
- Live-suite verification loop surfaced and fixed three runtime defect classes unit tests could not catch: (1) every cross-module sales/catalog QueryEngine read replaced with scoped kysely table reads (the documented fresh-row/doc-routing trap — the QE success path had never been live-exercised because the rejection tests pass even when the lookup is blind); customers `display_name` reads now decrypt via `tenantEncryptionService` (raw kysely was snapshotting ciphertext into `customer_name` — caught by TC-WC-011); (2) API-key principals dispatching commands crashed the audit writer (`api_key:<id>` into a uuid actor column) — the external route now maps the command actor to the key's own uuid (`auth.keyId`); (3) cross-bundle `instanceof` broke the AI not-configured detection (name-based guards now) and the draft route gained a third documented outcome — 502 `aiUnavailable` for provider-call failures, distinct from 422 `notConfigured` (the seeded env has a configured-but-broken provider).
- Fresh-context adversarial review (fail → all 7 blockers fixed): desk channel filter was column-only (FilterBar + URL state now wired, verified live via `?channel=api`); triage line dialog gained `purchaseDate`/`warrantyMonths` fields, entitlement chip, and default-months prefill; portal order picker no longer permanently degrades to manual entry on a zero-result search; switching/clearing the picked order (or choosing "no order") prunes imported line drafts so stale `orderLineId`s cannot 404 the submit or silently re-attach the old order; portal intake with an owned line from a DIFFERENT order now returns 400 (`orderLineMismatch`) per the spec table, with a TC-WC-012 case pinning it; the mandated unit rows landed via an extracted `createAndSubmitExternalClaim` orchestration seam (submit-failure soft-delete, unique-violation return-existing race, customerId-without-order precedence, direct `computeWarrantyEntitlementPreview`/`addWarrantyMonths` math tests); settings dictionary delete/edit no longer flash success after a surfaced 409 (same conflict-short-circuit class fixed earlier on the triage page). Also fixed from Codex review: "Add from order" no longer submits the pristine default blank line.
- Cross-model code jury: Codex 2 confirmed (both fixed above) / 2 spurious (LLM prompt facts are intended reply substance with internal timeline + encrypted notes excluded; `sales_order_lines.sku` column does not exist — snapshot-derived by design); DeepSeek 5/5 spurious (diff-split artifacts claiming implemented files were missing); Kimi (run per-area via `OM_XMR_PATHSPEC`) 1 confirmed — the settings General panel omitted a `defaultWarrantyMonths` UI field entirely (API/tests supported it but staff could not configure it; now wired through type/defaults/form/validation/payload/render + 4-locale keys) — and 1 spurious (claimed duplicate stepper ids; `CLAIM_STATUS_ORDER` starts at `submitted`, no branch duplicates). Fixture hardening: bounded 5xx retry in the shared sales fixture (documented ephemeral `max_connections` flake). Full suite 17/17 green post-fixes.

### 2026-07-04 (connected-intake pass — spec-stage cross-model jury)
- Kimi round (2 criticals confirmed): explicit `customerId` disagreeing with the resolved order's customer now 400s (`customerOrderMismatch` — never silently relink an external claim); `claim.submitted`/`claim.status_changed` payloads carry `claimNumber` + `externalRef` so webhook consumers correlate deliveries without a GET round-trip. Adopted from notes: unlinked external claims require `contactEmail`; per-line SKU resolution is strict-single-match; the add-from-order 100-line cap is surfaced in the UI. Rejected: URL versioning (no OM API is versioned — platform consistency).
- Spec jury (Codex + DeepSeek confirmed; 4 blockers fixed before implementation): `externalRef` made REQUIRED (optional correlation id broke idempotency for retries without it); the planned module webhook-dispatch subscriber REMOVED — the webhooks module's wildcard `outbound-dispatch` subscriber already delivers declared events to tenant subscriptions, so a module bridge would double-deliver (claim events are webhook-subscribable today with zero new code); external GET now explicitly returns claim lines alongside the customer-visible timeline (status pages need line detail); external create soft-deletes the draft when `submit` fails after `create` (portal-intake precedent — no orphaned `channel: 'api'` drafts).

### 2026-07-04 (connected-intake scope added)
- Added the **Connected Intake, External API & AI Copilot Scope** section from a third harness pass driven by user-reported gaps (manual product entry, no external claim-filing API, weak order linkage, no LLM features) plus a fresh 2026 SOTA sweep (Loop, ReturnGO, AfterShip, Narvar, ReturnLogic, Claimlane, Syncron, Tavant, PTC iWarranty, ServiceNow, Shopify Customer Account API, D365). Scope: connected staff intake (catalog product/variant picker on all line editors, add-lines-from-order prefill with `purchaseDate` from `placedAt`, `default_warranty_months` setting + instant entitlement chip), connected portal intake (module-owned customer-pinned `portal/orders` + `portal/orders/lines` endpoints with `estimatedWarrantyStatus`, wizard order/line pickers with manual fallback), headless external intake API (API-key-native `external/claims` POST/GET with least-privilege `external.{submit,view}` features, order-first customer resolution, `external_ref` idempotency, contact-snapshot unlinked claims, `channel: 'api'` live, outbound webhooks bridge per `packages/webhooks/AGENTS.md`, channel badge/filter on the desk), staff AI copilot (`claims_assistant` agent + AiChat embed on the triage AI tab, `draft_customer_reply`/`summarize_claim` tools + composer "Draft with AI" via the ai-assistant model factory with LLM-gated degradation per the `inbox_ops` precedent). New tests TC-WC-011/012/013 + TC-WC-005/009 extensions; additive-only migration (2 claim columns, 1 settings column); roadmap extended with the research-derived deferrals (photo damage assessment, document intelligence, registration-based entitlement, decision trees, risk-tier policy).

### 2026-07-04 (desk-upgrade scope added)
- Added the **Desk Upgrade Scope — World-Class Desk** section from a second full-harness pass: three parallel audits (fresh-eyes code audit, UI/UX depth review, competitive operational research across Syncron/Tavant/ServiceNow/ReturnLogic/ReturnGO/Claimlane/PTC iWarranty/D365/Loop/Zendesk). Scope: hardening (staff-SSE audience defect, deferred items C/D/H closed, decoupling of direct cross-module entity imports, info_requested resume flow, reopen, validation/math fixes, cleanups), desk ergonomics (assignment UX, queue chips + bulk actions, three-tier SLA display, inline hot-path line triage, timeline readability, portal dictionary selects + card-list restyle, multi-line create + order picker), differentiators (`WarrantyClaimSettings`, SLA pause/resume engine, deterministic risk signals, default-off risk-gated auto-adjudication, KPI strip), new tests TC-WC-008/009/010 + extensions, additive-only migration, and an explicit follow-up roadmap for the larger competitive features (receiving workbench, labels, escalation cron, email intake, registration, quarantine, vendor policy catalog).
