# Warranty & RMA Claims Desk

## TLDR

**Key Points:**
- Core module `warranty_claims`: a claims desk for B2B distributors covering warranty claims, non-warranty RMAs, core returns, and vendor recovery in one case workflow (intake → triage → receiving → disposition → resolution execution → audit trail).
- Replaces the email + spreadsheet workflow with deep reuse of existing platform machinery: sales orders/returns/credit memos (FK-id links + command dispatch), catalog, customers, attachments, dictionaries, notifications, search, customer portal, queue workers, and AI tools.

**Scope:**
- One claim aggregate with a `claimType` discriminator (`warranty | return | core_return | vendor_recovery`), line-level partial approvals and dispositions, condition grading and quarantine, and an immutable timeline.
- Staff Claims Desk (list, KPI strip, triage workspace), customer portal intake and tracking, headless API-key intake, sales-order and customer-detail tabs via widget injection, dashboard queue widget.
- Command-driven status machine with optimistic locking, typed events, notifications, search indexing, tenant-configurable dictionaries and settings, SLA pause/escalation, risk signals, adjudication, and three resolution-execution bridges into `sales`.

**Concerns:**
- No vendor master-data entity exists in core — vendor recovery claims and vendor policies match on a `vendorName` snapshot.
- Several capabilities degrade to no-ops when an optional peer module (`sales`, `catalog`, `inbox_ops`, `shipping_carriers`, `business_rules`, `ai_assistant`) is absent; every such path is soft-optional by design.

## Overview

B2B distributors process warranty claims, advance replacements, vendor recovery, and core returns through email threads and spreadsheets. This module provides a first-class claims desk: structured intake (portal, staff, or API), a triage queue with SLA visibility and escalation, per-line dispositions with partial approvals and condition grading, entitlement resolution from product registrations, supplier-recovery automation, a customer-visible timeline, and an auditable lifecycle that executes its own sales documents — built entirely from the platform's existing primitives.

> **Market reference**: Benchmarked against ERPNext, NetSuite, Dynamics 365 SCM, Adobe Commerce, Salesforce Manufacturing Cloud, SAP B1, Odoo, Shopify, Sylius, Saleor, Zoho, Cin7, the returns-SaaS group (Loop, ReturnGO, AfterShip, Narvar, Happy Returns, Redo, ReturnLogic, Rich Returns), and the warranty-platform group (Extend, Cover Genius, Mulberry, OnPoint, Tavant, PTC iWarranty, Pega, Registria, Syncron). **Adopted:** a single claim object with a type discriminator (Salesforce/D365); line-level disposition codes including credit-only and field-destroy (D365); partial per-line authorization (Adobe Commerce); vendor-recovery claims linked to the source customer claim (Syncron); warranty status computed at intake (ERPNext); no stock or credit effect before physical receipt (Zoho/NetSuite); registration-based entitlement (ReturnLogic/Registria); RMA-generated documents with zero-priced replacement lines (NetSuite/D365). **Rejected:** separate entities per claim type; dictionary-driven *statuses* (a code-enforced state machine needs frozen status ids — configurability lives in dictionaries and settings instead); auto-deny adjudication.

## Problem Statement

- Claims arrive by email; nothing links them to orders, serials, or prior claims. Distributors lose recoverable vendor dollars because customer claims and vendor claims live in different spreadsheets.
- No SLA visibility: triage queues are inbox-ordered, not due-date-ordered, and nothing escalates a breach.
- Partial resolutions (approve 3 of 5 units, reject the rest) cannot be represented in ad-hoc tools, so staff over-credit or over-communicate.
- Customers have no self-service view of claim progress, generating "any update?" email load.
- Core charges (auto parts, remanufacturables) are tracked outside the return flow entirely.
- A resolved claim produces no documents: staff leave the system to hand-build the sales return, the replacement order, and the credit memo, then hand-paste ids back.
- Quantity honesty is unenforced: nothing checks a claimed quantity against what the linked order line actually sold, on one claim or cumulatively across claims.
- Time-based eligibility exists only for warranty; a plain return claim has no notion of a merchant return-policy window.

## Proposed Solution

A self-contained core module `packages/core/src/modules/warranty_claims/` following the `customers` reference-module layout. One claim aggregate (header + lines + immutable timeline events) with a command-driven state machine, plus supporting entities for settings, registrations, vendor policies, troubleshooting guides, and number sequences. Cross-module coupling uses only sanctioned mechanisms: FK-id + snapshot to sales/catalog/customers, widget injection into peer detail pages, attachments by `(entityId, recordId)` convention, dictionaries for tenant-configurable codes, typed events consumed by module-local subscribers, and `commandBus` dispatch of the peer module's own commands for cross-module writes.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| One entity + `claimType` discriminator | One lifecycle serves all four types; unified triage queue, comments, attachments, and reporting. Per-type behavior is data (number prefix, allowed dispositions, portal visibility), not schema. |
| Fixed status enum, dictionary-backed fault/reason codes | Transitions are enforced in a command (state-machine integrity, frozen ids). Tenant configurability goes where it is safe: dictionaries `warranty-claim-fault-code`, `warranty-claim-reason`, `warranty-claim-rejection-reason` (kebab-case singular kinds, per the sales `order-status` precedent), seeded in `setup.ts`. |
| Advance replacement = resolution attributes, not a claim type | Any approved claim can ship a replacement ahead (`advanceReplacement` flag + `replacementOrderId`), avoiding a fifth lifecycle. |
| Vendor recovery = linked child claim (`sourceClaimId`) | Recoverable resolved lines are copied into a `vendor_recovery` claim, keeping the money trail connected. |
| Vendor snapshot fields instead of FK | Core has no vendor master entity. A text snapshot (`vendorName`/`vendorRef`) keeps the module decoupled; vendor policies match on the same key. |
| Cross-module writes only via peer commands | The three resolution bridges dispatch `sales.returns.create`, `sales.orders.create`, and `sales.credit_memos.create` so the peer module's own validation, totals, and side effects run. No warranty code touches sales tables. |
| Type-adaptivity is UI-guidance plus a server-side disposition gate | Labels and disposition menus switch on `claimType`; the server enforces only that a disposition is legal for the type. No per-type required fields — that would reject legitimate serial-less B2B claims. |
| Signals inform, humans decide | Risk signals and adjudication never auto-deny, and no automation mints a sales document. Execution is one click, never zero clicks. |
| Module-local `WarrantyClaimNumberGenerator` | Mirrors `SalesDocumentNumberGenerator`; per tenant/org/type sequences with `WTY-`, `RMA-`, `COR-`, `VRC-` prefixes and 6-digit zero-pad. |
| Timeline as immutable event rows | Audit-trail requirement; `visibility: internal|customer` gates what the portal sees. No `updated_at` — events are append-only. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Extend `sales.SalesReturn` with claim fields | Returns are financial/goods documents; claims are cases. Conflating them breaks both lifecycles. Claims *link to* and *create* returns instead. |
| Build on the `workflows` module engine | Workflow instances are automation runs, not user-facing case records with lines and amounts. |
| Separate `rma` + `warranty` modules | Duplicate triage UI, timeline, and notifications; the discriminator costs one column. |
| Dictionary-driven statuses | Claim statuses gate transitions and business rules in code. A frozen enum is safer. |
| Hard cross-claim "remaining returnable quantity" gate | Rejected/appealed history and legitimate re-claims (failed repair, second fault) make a cross-claim hard block wrong more often than right; an advisory risk signal plus manual review is the module's answer. |

## User Stories / Use Cases

- **A CS agent** triages a queue ordered by SLA due date so no claim breaches the promised response time.
- **A CS agent** approves 3 of 5 claimed units and rejects 2 with a reason code so the customer gets an accurate partial resolution.
- **A customer (portal user)** submits a claim against one of their orders with serials and photos, tracks its status, and withdraws it before review.
- **A receiving clerk** grades arriving units A–D, quarantines the ones that need holding, and records received quantities.
- **A warranty manager** spins resolved warranty lines into a vendor recovery claim so supplier-recoverable dollars are not lost.
- **A parts distributor** tracks core charges and core credits on return lines so core exchanges stop living in a spreadsheet.
- **A CS agent** mints the sales return, the replacement order, and the credit memo directly from the resolved claim.
- **An organization** files claims from its own website through an API-key-secured intake endpoint and tracks them without a portal session.
- **An admin** configures fault codes, claim reasons, SLA hours, business hours, escalation tiers, auto-approval limits, and the return window per tenant.
- **A CS agent** asks the AI assistant to suggest triage, summarize a claim, or draft a customer reply.

## Architecture

### Module placement & discovery

`packages/core/src/modules/warranty_claims/` — module id `warranty_claims`. Standard auto-discovery files: `index.ts`, `di.ts`, `acl.ts`, `setup.ts`, `events.ts`, `search.ts`, `ce.ts`, `encryption.ts`, `notifications.ts`, `notifications.client.ts`, `ai-agents.ts`, `ai-tools.ts`, `data/{entities,validators,constants,enrichers}.ts`, `commands/`, `services/`, `lib/`, `api/`, `backend/`, `frontend/`, `subscribers/`, `workers/`, `widgets/`, `i18n/`, `migrations/`, `__tests__/`, `__integration__/`.

### Cross-module coupling (all sanctioned mechanisms; no direct ORM relations)

| Peer | Mechanism | Detail |
|------|-----------|--------|
| sales (read) | FK-id + snapshot | `orderId`, `orderLineId`, `salesReturnId`, `replacementOrderId`, `creditMemoId`; snapshots `orderNumber`, `productName`, `sku`. Reads go through scoped kysely lookups (`querySalesReferenceRow`) with `42P01` degradation — not the QueryEngine. |
| sales (write) | `commandBus` dispatch | `sales.returns.create/delete`, `sales.orders.create/delete`, `sales.credit_memos.create/delete`, dispatched with a scrubbed context so the claim's optimistic-lock header never leaks onto the nested write. |
| sales UI | widget injection | Claims tab at `sales.document.detail.order:tabs`. |
| catalog | FK-id + snapshot | `productId`, `variantId` + `sku`/`productName` on lines; product/variant pickers on every line editor. |
| customers | FK-id + snapshot + enricher | `customerId` on the header with a `customerName` snapshot; `_warranty_claims` metrics enriched onto `customers.person`/`customers.company`; Claims tab at `detail:customers.person:tabs` and `detail:customers.company:tabs`. |
| attachments | id convention | Files stored with `entityId: 'warranty_claims:warranty_claim'`, `recordId: <claimId>`; portal uploads carry a `customer-visible` metadata tag so staff uploads stay internal. |
| dictionaries | seeded dictionaries + reused components | Three dictionaries seeded in `setup.ts`; settings page reuses `DictionaryForm`/`DictionaryTable`. |
| customer portal | portal page convention | `frontend/[orgSlug]/portal/claims/**` with `page.meta.ts` (`requireCustomerAuth`). |
| shipping_carriers | event-id subscriber | `shipment.delivered` auto-advances a matching `awaiting_return` claim; soft-optional, no import. |
| inbox_ops | event-id subscriber | `email.received` bridges inbound mail to a claim; opt-in and off by default. |
| business_rules | `tryResolve` seam | Adjudication delegates to a rule set when enabled and present; falls back to the built-in light rule otherwise. |
| ai_assistant | `ai-agents.ts` / `ai-tools.ts` | Claims assistant agent + tool pack; degrades cleanly when no model is configured. |

### Contract surfaces

**ACL features** (12, declared in `acl.ts`, granted in `setup.ts` `defaultRoleFeatures`):
`warranty_claims.claim.view`, `.claim.create`, `.claim.manage`, `.claim.delete`, `.settings.manage`, `.external.submit`, `.external.view`, `.registration.view`, `.registration.manage`, `.vendor_policy.manage`, `.troubleshooting.manage`, `.receiving.manage`.

**Event ids** (14, declared in `events.ts`):
`warranty_claims.claim.created` / `.updated` / `.deleted` / `.submitted` / `.status_changed` (`clientBroadcast`) / `.portal_status_changed` (`portalBroadcast`, `excludeFromTriggers`) / `.assigned` / `.comment_added` (`portalBroadcast`) / `.sla_at_risk` (`clientBroadcast`) / `.sla_breached` (`clientBroadcast`) / `.escalated` (`clientBroadcast`) / `.return_label_created`; plus `warranty_claims.registration.created` and `warranty_claims.claim_line.quarantined`.

Staff and portal audiences are carried by two separate events: `status_changed` broadcasts to the tenant/org staff stream without a recipient pin, while `portal_status_changed` carries the customer-pinned payload. A single event cannot be both customer-pinned and staff-visible, because both bridges filter on the same audience keys.

**Command ids** (20, registered under `commands/`):
`warranty_claims.claim.create` / `.update` / `.delete` / `.submit` / `.transition` / `.assign` / `.comment` / `.escalate` / `.create_vendor_recovery` / `.set_return_label` / `.create_sales_return` / `.create_replacement_order` / `.create_credit_memo`; `warranty_claims.claim_line.create` / `.update` / `.delete` / `.receive` / `.release_quarantine` / `.set_assessment`; `warranty_claims.settings.save`.

**DI seam keys** (`di.ts`): `warrantyClaimNumberGenerator`, `warrantyEntitlementResolver`, `warrantyReturnLabelProvider`, `warrantyAdjudicationEvaluator` — all default in-core and DI-overridable. Entity classes are registered as values.

**Notification type ids** (`notifications.ts`): `warranty_claims.claim.submitted`, `.assigned`, `.status_changed`, `.escalated`, `.customer_replied` — each with a `view` click-through action and a client renderer.

**AI surfaces**: agent `warranty_claims.claims_assistant`; tools `warranty_claims.list_claims`, `.get_claim`, `.suggest_triage`, `.transition_claim` (approval-gated), `.draft_customer_reply`, `.summarize_claim`, `.assess_damage_photo`, `.extract_proof_of_purchase`.

**Widget spots consumed**: `sales.document.detail.order:tabs`, `detail:customers.person:tabs`, `detail:customers.company:tabs`, `data-table:warranty_claims.claims.list:search-trailing`. Dashboard widget `warranty_claims.dashboard.claimsQueue`.

**Worker**: `workers/sla-escalation-sweep.ts` on queue `warranty_claims.sla_sweep`, driven by a scheduler-registered periodic producer.

### Status state machine (header)

```
draft ──▶ submitted ──▶ in_review ──▶ approved ──▶ awaiting_return ──▶ received ──▶ inspecting ──▶ resolved ──▶ closed
            │              │ ▲            │                                                                      │
            │              ▼ │            └──▶ resolved (credit-only / field-destroy: skip goods flow)            │
            │        info_requested                                                                              │
            ▼              ▼                                                                                     ▼
        cancelled      rejected ──▶ in_review (appeal)  |  rejected ──▶ closed                        closed ──▶ in_review (reopen)
```

Exact transition map (`data/constants.ts`): `draft → submitted|cancelled`; `submitted → in_review|cancelled`; `in_review → info_requested|approved|rejected|cancelled`; `info_requested → in_review|rejected|cancelled`; `approved → awaiting_return|resolved|cancelled`; `awaiting_return → received|cancelled`; `received → inspecting`; `inspecting → resolved`; `resolved → closed`; `rejected → in_review|closed`; `closed → in_review`; `cancelled → []` (terminal).

- Transitions are validated in `warranty_claims.claim.transition`; illegal moves return 400 `warranty_claims.errors.invalidTransition`.
- The header cannot enter `resolved` while any non-deleted line is outside `{resolved, rejected}`. Entering `rejected` requires a `rejectionReasonCode`.
- Line statuses: `pending → approved|rejected`; `approved → received|resolved` (the `resolved` edge carries the credit-only / field-destroy flow); `received → inspected`; `inspected → resolved`.
- `status` is never writable through the generic update route — only through `transition`. `claimType` is immutable after creation.

### Dispositions (line-level enum)

`restock`, `repair`, `replace`, `credit`, `refund`, `field_destroy`, `scrap`, `return_to_vendor`, `deny`. Each claim type permits a subset (`lib/claimTypeConfig.ts`); a disposition outside the type's set returns 400 `warranty_claims.errors.dispositionTypeConflict`. Once a line is graded, `C`/`D` grades reject `restock` with 400 `warranty_claims.errors.dispositionGradeConflict`.

### SLA, risk, and adjudication

- **SLA**: `slaDueAt` is stamped at submit in business time (`lib/businessHours.ts`) from the tenant's `slaHours` and optional `businessHours` calendar. Entering `info_requested` pauses the clock (`slaPausedAt`) when enabled; leaving it re-anchors the remaining *business* time. A queue worker sweeps non-terminal, non-paused claims, emits `sla_at_risk` / `sla_breached` once per cycle (persisted notification stamps), and applies every crossed escalation tier in ascending order, bumping `escalationLevel` so each tier fires at most once.
- **Risk signals** (`lib/risk.ts`, deterministic and tenant-scoped): `duplicate_serial`, `repeat_claimer`, `value_velocity`, `duplicate_order_claim`, `over_quantity_claim`, `outside_return_window`. Signals are advisory; a high signal forces manual review through the adjudication path but never denies.
- **Adjudication**: default-off auto-approval evaluated synchronously inside the `submit` command's atomic flush, so a claim is never externally observable in a transient pre-adjudication state. Eligibility requires the setting enabled, at least one line, every line in warranty (when required), the claimed total within the configured maximum and matching currency, and zero risk flags. With `adjudicationUseRules` on and `business_rules` present, the decision delegates to a rule set. Auto-deny does not exist.

### Resolution execution bridges

Three staff-invoked bridges create the sales documents a resolved claim implies. All three share one shape: validate and optimistic-lock the claim outside any transaction; dispatch the peer `create` command with a scrubbed context; read the created document's `updated_at` as an undo token; stamp the claim inside a short `PESSIMISTIC_WRITE` transaction that re-checks the link is still empty; append an internal `system` timeline event; emit the claim CRUD-updated side effect. Any failure after the peer document exists triggers a compensating peer `delete`; if compensation itself fails, the command surfaces a 500-class orphan error carrying the orphaned document id, and the peer document embeds the claim number so the orphan is discoverable from either side.

Undo compares the stored version token against the document's current `updated_at`: an exact match deletes the document and restores the claim snapshot; a mismatch or missing token aborts with 409; a definitively absent row (the lookup returns null) skips the delete and restores anyway. A degraded lookup is treated as a mismatch, not an absence, so a transient failure can never clear the claim link while the document still lives.

| Bridge | Eligible lines | Notes |
|--------|----------------|-------|
| `create_sales_return` | `lineStatus ∈ approved\|received\|inspected\|resolved`, `orderLineId` present, whole-unit effective quantity > 0 | Sales caps each line at its shipped quantity; the rejection is translated to 400 `salesReturnQuantityRejected`. |
| `create_replacement_order` | `disposition = replace`, `lineStatus ∈ approved\|received\|inspected\|resolved`, `orderLineId` present, whole units, source line carries an identity | Zero-priced by default (`pricing: 'original'` copies catalog pre-discount prices); copies customer/address ids and channel so sales rebuilds snapshots decryption-aware; sets `advanceReplacement` when executed pre-receipt. |
| `create_credit_memo` | `disposition ∈ credit\|refund`, `lineStatus ∈ received\|inspected\|resolved`, credited qty = `min(qtyApproved ?? qtyClaimed, qtyReceived ?? 0) > 0`, line currency equals order currency | Receipt-proven: credit follows the goods. |

**Credit-memo amount contract.** All arithmetic runs in scaled integers at the `numeric(18,4)` column scale; no intermediate value is rounded, each prorated amount is one fused multiply-then-divide with half-up rounding applied exactly once at the final division, and header totals are exact sums of line values. `tax_rate` on a sales order line is expressed in **percentage points (0–100)**, so every net-from-gross derivation divides by `1 + rate/100`. A legacy order line with positive gross but non-positive net has its net basis re-derived first, restoring the `net > 0 ⟺ gross > 0` invariant. Proration uses the order line's discounted **totals**, not unit price × quantity, so discounted lines are not over-credited. Per line: `lineGross = max(0, (creditAmount ?? proratedGross) − restockingFee + coreCreditAmount)`, mirroring the module's own approved-rollup clamp; unit prices are derived from the totals so `unitPrice × quantity ≈ total`. Sales stores these values verbatim — no recalculation service runs on credit memos — so this arithmetic is the document of record. Order-level adjustments and discounts are not prorated into the credit in this version.

`creditMemoId`, `salesReturnId`, and `replacementOrderId` are each a single link; a bridge executes once per claim, and a partial-receipt memo consumes that execution.

### Quantity and window guards

- **Hard gate**: `assertClaimedQtyWithinSold` runs on every line-write path — `claim_line.create`, `claim_line.update`, and the inline `lines` array of `claim.create` (which the desk create page, portal intake, external API, and email bridge all flow through). For a line carrying `orderLineId`, the claim's summed `qtyClaimed` across all its non-deleted lines referencing that order line must not exceed the sold quantity, else 400 `warranty_claims.errors.qtyExceedsOrdered`. Degrades to no-check when sales is absent or the quantity is unresolvable.
- **Advisory signal**: `over_quantity_claim` sums claimed quantities across *other* non-cancelled claims for the same order line and flags cumulative over-claiming.
- **Return window**: `returnWindowDays` (null = off) applies to `return` and `core_return` claims with an order, anchored on `placed_at ?? created_at`, surfacing `outside_return_window`. Advisory only.

## Data Models

Eight entities. Common columns (`organization_id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`) are omitted from the per-entity lists below except where behavior differs.

### WarrantyClaim — table `warranty_claims`

- `id`: uuid PK
- `claim_number`: text, unique per `(tenant_id, organization_id, claim_number)` — generation is per tenant/org/type, so the uniqueness scope matches
- `claim_type`: text enum `warranty|return|core_return|vendor_recovery` — **immutable after creation**
- `status`: text enum (12 values, see state machine), default `draft`
- `channel`: text enum `portal|staff|api`, default `staff`
- `priority`: text enum `low|normal|high|urgent`, default `normal`
- `customer_id`: uuid null; `customer_name`: text null (snapshot); `contact_email`: text null (encrypted — unlinked intake)
- `external_ref`: text null (caller correlation id); `intake_message_ref`: text null (inbound message id)
- `vendor_name`, `vendor_ref`: text null (vendor recovery snapshot)
- `order_id`: uuid null; `order_number`: text null (snapshot); `sales_return_id`, `replacement_order_id`, `credit_memo_id`: uuid null
- `source_claim_id`: uuid null (vendor recovery ← originating claim, same table)
- `return_label_url`, `return_tracking_number`, `return_carrier`: text null
- `escalation_level`: int default 0; `escalated_at`: timestamptz null
- `entitlement_source`: text null (`registration|order|manual|resolver`)
- `awaiting_staff_reply`: boolean default false (customer-replied queue signal)
- `advance_replacement`: boolean default false; `advance_shipped_at`: timestamptz null
- `reason_code`, `rejection_reason_code`: text null (dictionary-backed)
- `resolution_summary`, `notes`: text null (encrypted)
- `currency_code`: text null
- `total_claimed_amount`, `total_approved_amount`, `total_recovered_amount`: numeric(18,4) null (rollups from lines)
- `sla_due_at`, `sla_paused_at`, `sla_at_risk_notified_at`, `sla_breached_notified_at`: timestamptz null
- `submitted_at`, `resolved_at`, `closed_at`: timestamptz null
- `assignee_user_id`: uuid null

Indexes: customer, order, and status composites; partial unique indexes on `(tenant_id, organization_id, external_ref)` and `(tenant_id, organization_id, intake_message_ref)` where set and not deleted (idempotent intake); a partial index on `(tenant_id, organization_id, return_tracking_number)` where set and not deleted (reverse-tracking lookup); unique `(tenant_id, organization_id, claim_number)`. Every partial index is declared on the entity via the `expression` idiom so `yarn db:generate` stays drift-free.

### WarrantyClaimLine — table `warranty_claim_lines`

- `id`: uuid PK; `claim_id`: uuid FK (same module); `line_no`: int (auto-incremented on create)
- `product_id`, `variant_id`: uuid null; `sku`, `product_name`: text null (snapshot)
- `order_line_id`: uuid null
- `serial_number`, `lot_number`: text null
- `purchase_date`: date null; `warranty_months`: int null; `warranty_expires_at`: date null
- `warranty_status`: text enum `in_warranty|out_of_warranty|unknown`, default `unknown` (computed at intake; an explicit value is never clobbered)
- `fault_code`: text null (dictionary); `fault_description`: text null (encrypted)
- `qty_claimed`: numeric(18,4) default 1; `qty_approved`, `qty_received`: numeric(18,4) null
- `condition_on_receipt`: text null; `condition_grade`: text enum `A|B|C|D` null; `quarantine_status`: text enum `none|held|released` default `none`
- `inspection_notes`: text null (encrypted); `assessment_payload`: jsonb null (AI/vision facts)
- `disposition`: text enum null (9 values); `line_status`: text enum `pending|approved|rejected|received|inspected|resolved`, default `pending` (forced to `pending` on create)
- `credit_amount`, `restocking_fee`, `core_charge_amount`, `core_credit_amount`: numeric(18,4) null
- `vendor_claim_line_id`: uuid null (server-managed link to the recovery claim's line); `vendor_name`: text null (supplier attribution snapshot)

### WarrantyClaimEvent — table `warranty_claim_events` (append-only timeline)

- `id`: uuid PK; `claim_id`: uuid FK
- `kind`: text enum `status_changed|comment|assignment|system`
- `visibility`: text enum `internal|customer`, default `internal`
- `body`: text null (encrypted); `payload`: jsonb null
- `actor_user_id`, `actor_customer_id`: uuid null
- `created_at` only — no `updated_at`/`deleted_at`; indexed on `(claim_id, created_at)`

### WarrantyClaimSettings — table `warranty_claim_settings`

One row per tenant/org (unique on `(organization_id, tenant_id)`). Fourteen configurable columns: `sla_hours` (default 48), `sla_pause_on_info_requested` (default true), `sla_at_risk_threshold_pct` (default 75), `auto_approve_enabled` (default false), `auto_approve_max_amount`, `auto_approve_currency_code`, `auto_approve_require_in_warranty` (default true), `default_warranty_months`, `business_hours` (jsonb weekly calendar + holidays), `escalation_tiers` (jsonb), `adjudication_use_rules` (default false), `quarantine_grades` (jsonb), `return_label_provider`, `return_window_days`. With `auto_approve_enabled` true but the amount or currency null, auto-adjudication is inactive and the save command rejects the merged state with 400 `warranty_claims.errors.autoApproveConfigIncomplete`.

### WarrantyClaimRegistration — table `warranty_claim_registrations`

Product/serial registration as the entitlement base: `serial_number` (required — the resolver matches on it), `product_id`, `variant_id`, `sku`, `product_name`, `customer_id`, `order_id`, `purchase_date`, `warranty_months`, `warranty_expires_at`, `coverage_type` (`standard|extended|none`), `source` (`order|manual|third_party`), `proof_attachment_id`, `notes` (encrypted). Indexed on serial and customer.

### WarrantyVendorPolicy — table `warranty_claim_vendor_policies`

Per-vendor policy for supplier recovery, matched on `vendor_name`: `vendor_ref`, `coverage_months`, `claimable_reason_codes` (jsonb array), `recovery_rate_pct` (0–100, ≤2 decimals), `contact_email` (encrypted), `auto_generate_recovery` (bool), `is_active`.

### WarrantyTroubleshootingGuide — table `warranty_claim_troubleshooting_guides`

Config-driven decision tree: `claim_type` (null = any), `reason_code` (null = any), `title`, `steps` (jsonb tree of `{prompt, options:[{label, next|resolution|reasonCode}]}`), `is_active`.

### WarrantyClaimSequence — table `warranty_claim_sequences`

`claim_type`, `next_number` — one locked row per generate, unique per tenant/org/type.

### Custom fields, encryption, and search

`ce.ts` registers the claim entity so tenants can add fields. `encryption.ts` declares maps for `warranty_claims:warranty_claim` (`notes`, `resolution_summary`, `contact_email`), `warranty_claims:warranty_claim_line` (`fault_description`, `inspection_notes`), `warranty_claims:warranty_claim_event` (`body`), `warranty_claims:warranty_claim_registration` (`notes`), and `warranty_claims:warranty_vendor_policy` (`contact_email`). All reads of these entities go through `findWithDecryption` or QueryEngine decryption paths; writes go through `em.flush()` — never `nativeUpdate`, which bypasses the encryption subscriber.

Search (`search.ts`) indexes `warranty_claims:warranty_claim` with `claim_number` as title. Searchable fields: `claim_number`, `claim_type`, `status`, `priority`, `customer_name`, `vendor_name`, `vendor_ref`. Hash-only: the uuid reference columns. Excluded: scope/actor columns plus every encrypted free-text field (`notes`, `resolution_summary`, `contact_email`, `fault_description`, `inspection_notes`) and `rejection_reason_code`. Desk search additionally matches line serial/SKU and order number through a tenant-scoped subquery.

`WarrantyClaim`, `WarrantyClaimLine`, and `WarrantyClaimSettings` are user-editable and registered in the `optimistic-lock-editable-entities.test.ts` audit maps. `WarrantyClaimEvent` (append-only) and `WarrantyClaimSequence` (internal counter) are excluded classes.

## API Contracts

All staff routes carry `requireAuth` + `requireFeatures`, are zod-validated (`data/validators.ts`), export `openApi`, are tenant/organization scoped, and return `updatedAt` on every list/detail item. Hand-written write endpoints enforce `enforceWarrantyClaimOptimisticLock` on the parent claim (append-only comment posts excepted) and wire the mutation-guard registry through `runRouteMutationGuards`. Portal routes declare `requireAuth: false` and resolve the customer session via `getCustomerAuthFromRequest`, pinning the claim to the session's customer server-side; a missing or invalid session returns 401, and cross-customer access returns 404 without an existence leak. Error shapes: `zod.safeParse` → 400, scoped lookup miss → 404, feature guard → 403 (before lookup), stale version → 409.

| Route | Methods | Features / auth | Purpose |
|-------|---------|-----------------|---------|
| `/api/warranty_claims` | GET, POST, PUT, DELETE | `claim.view` / `claim.create` / `claim.manage` / `claim.delete` | Claims CRUD (`makeCrudRoute`). Filters include status, claimType, priority, channel, customerId, orderId, sourceClaimId, assigneeUserId, `unassignedOnly`, `overdueOnly`, `slaAtRiskOnly`, `needsAttention`, submitted/created date ranges, `serialNumber`, `ids=`, `search`. Update uses per-status field whitelists; `status` and `claimType` are never updatable. Soft delete from draft/cancelled only. |
| `/api/warranty_claims/lines` | GET, POST, PUT, DELETE | `claim.view` / `claim.manage` ×3 | Line sub-resource (`makeCrudRoute`). Parent-status guard; the optimistic-lock header carries the **line's** own `updatedAt`. |
| `/api/warranty_claims/submit` | POST | `claim.manage` | Draft → submitted; stamps `submittedAt`, computes `slaDueAt`, runs adjudication. |
| `/api/warranty_claims/transition` | POST | `claim.manage` | Validated state-machine move; accepts an optional `systemNote` constrained to a `warranty_claims.`-prefixed i18n key. |
| `/api/warranty_claims/assign` | POST | `claim.manage` | Assignee change; validates the user is active in the tenant. |
| `/api/warranty_claims/events` | GET, POST | `claim.view` / `claim.manage` | Timeline read and staff comment (`visibility: internal|customer`). No mutation routes — events are immutable. |
| `/api/warranty_claims/receiving` | POST | `receiving.manage` | Condition grade, received quantity, quarantine capture. |
| `/api/warranty_claims/vendor-recovery` | POST | `claim.manage` | Copies selected resolved lines into a linked `vendor_recovery` claim; duplicate-safe. |
| `/api/warranty_claims/vendor-recovery-suggestions` | GET | `claim.manage` | Policy-matched recovery candidates with `lineNo`/`productName`/`sku` for humanized rendering. |
| `/api/warranty_claims/return-label` | POST | `claim.manage` | Return-label generation via the provider seam, or manual entry; `notConfigured` when no provider resolves. |
| `/api/warranty_claims/sales-return` | POST | `claim.manage` + `sales.returns.create` | Creates and links a sales return from eligible lines. |
| `/api/warranty_claims/replacement-order` | POST | `claim.manage` + `sales.orders.manage` | Creates and links a replacement sales order from `replace`-disposition lines. |
| `/api/warranty_claims/credit-memo` | POST | `claim.manage` + `sales.credit_memos.manage` | Creates and links a credit memo from received `credit`/`refund` lines. |
| `/api/warranty_claims/settings-general` | GET, PUT | `settings.manage` | Tenant settings singleton; GET returns effective values with defaults. |
| `/api/warranty_claims/stats` | GET | `claim.view` | KPI strip: open-by-status-group, overdue, SLA-at-risk, avg resolution days, approval rate, recovered total. |
| `/api/warranty_claims/risk` | GET | `claim.view` | Deterministic risk signals for a claim, plus `relatedClaimNumbers`. |
| `/api/warranty_claims/entitlement` | GET | `claim.view` | Resolver-backed entitlement by serial/order/product, with prior-claim history (`excludeClaimId` avoids self-counting). |
| `/api/warranty_claims/registrations` | GET, POST, PUT, DELETE | `registration.view` / `registration.manage` ×3 | Registration CRUD (`makeCrudRoute`); filters by coverage type, source, expiry window. |
| `/api/warranty_claims/vendor-policies` | GET, POST, PUT, DELETE | `vendor_policy.manage` | Vendor policy CRUD (`makeCrudRoute`). |
| `/api/warranty_claims/troubleshooting-guides` | GET, POST, PUT, DELETE | `troubleshooting.manage` | Guide CRUD (`makeCrudRoute`). |
| `/api/warranty_claims/ai/suggest` | GET, POST | `claim.view` | Deterministic, rule-based triage recommendation — no LLM call. |
| `/api/warranty_claims/ai/draft-reply` | POST | `claim.manage` | LLM-drafted customer reply for human review; 422 `notConfigured` / 502 `aiUnavailable` degradations. |
| `/api/warranty_claims/ai/assess` | POST | `claim.manage` | Damage-photo / proof-of-purchase assessment; requires the attachment be linked to the claim (400 otherwise). Never mutates money. |
| `/api/warranty_claims/external/claims` | POST, GET | `external.submit` / `external.view` | Headless intake for API-key principals. POST requires `externalRef` (idempotent replay returns the existing claim); resolves the order by id or number, derives the customer from the order, and rejects a conflicting explicit `customerId`; an unlinked submission requires `contactEmail`. GET returns the header, all lines, and customer-visible timeline entries. |
| `/api/warranty_claims/portal/claims` | GET, POST | customer session | Own claims list; guided intake creating a `channel: portal` claim with server-pinned customer and validated order ownership. |
| `/api/warranty_claims/portal/claims/[id]` | GET | customer session | Own claim detail. |
| `/api/warranty_claims/portal/claims/[id]/submit` | POST | customer session | Customer submits their own draft (draft only). |
| `/api/warranty_claims/portal/claims/[id]/withdraw` | POST | customer session | Customer withdraws a pre-review claim (draft/submitted only). |
| `/api/warranty_claims/portal/events` | GET, POST | customer session | Customer-visible timeline entries and customer comments (`actorCustomerId` from session). A reply on an `info_requested` claim auto-resumes it to `in_review`. |
| `/api/warranty_claims/portal/attachments` | GET, POST | customer session | Module-owned portal attachment list/upload/download proxy; only `customer-visible`-tagged files are served, and pagination runs after the visibility filter. |
| `/api/warranty_claims/portal/options` | GET | customer session | Active fault/reason dictionary entries for the intake wizard. |
| `/api/warranty_claims/portal/orders` | GET | customer session | The session customer's own orders. |
| `/api/warranty_claims/portal/orders/lines` | GET | customer session | Ownership-checked product-kind order lines with `estimatedWarrantyStatus`. |
| `/api/warranty_claims/portal/troubleshooting` | GET | customer session | Active guide matching claim type / reason. |

Outbound webhooks need no module code: the webhooks module's wildcard dispatcher already delivers declared, non-excluded module events to tenant subscriptions, so `warranty_claims.claim.submitted` and `.status_changed` are webhook-subscribable today. Both payloads carry `claimNumber` and `externalRef` so consumers correlate deliveries without a follow-up GET.

## Internationalization (i18n)

Locale files `i18n/{en,de,es,pl}.json` (flat dotted keys, codepoint-sorted, at parity). Key groups: `warranty_claims.nav.*`, `.list.*`, `.detail.*`, `.lines.*`, `.status.*` (12), `.claimType.*`, `.disposition.*`, `.lineStatus.*`, `.eligibility.*`, `.form.*` (including per-type `form.lineHeader.<claimType>`), `.reasonOption.*` / `.faultOption.*` (localized labels for seeded dictionary defaults, with the stored label as fallback), `.portal.*`, `.timeline.*`, `.triage.*`, `.settings.*`, `.widgets.*`, `.notifications.*`, `.ai.*`, `.errors.*`. No hardcoded user-facing strings; internal-only throws are prefixed `[internal]`.

## UI/UX

DS-token-only styling (no hardcoded status colors, no arbitrary values, lucide-react icons, `aria-label` on icon buttons, dialogs submit on Cmd/Ctrl+Enter and cancel on Escape). All data calls go through `apiCall`; non-`CrudForm` writes go through `useGuardedMutation` with `retryLastMutation` in the injection context.

Backend pages live under `backend/warranty_claims/…` (the module list page is `backend/page.tsx`, which the router maps to `/backend/warranty_claims`):

- **Claims Desk list** (`backend/page.tsx` → `/backend/warranty_claims`): `DataTable` with claim number, type, status (`StatusBadge` on semantic tokens), priority, customer, order number, SLA indicator (normal / at-risk / overdue / paused, with absolute-time tooltip), channel, assignee name, and `updatedAt`. Filters: status, type, priority, channel, assignee (with "Unassigned"), overdue-only, SLA-at-risk-only, needs-attention, submitted/created date ranges — all URL-synced. Status/overdue count chips and a KPI strip above the list. Row actions include open, assign, "Assign to me", "Start review", and cancel; bulk assign / cancel / start-review fan out client-side over the single-claim endpoints, each carrying that row's own lock header, and report `n succeeded / m failed`. CSV export, saved views, and column chooser. An "Ask AI" trigger is injected at the table's `search-trailing` spot.
- **Triage workspace** (`backend/warranty_claims/[id]/page.tsx`): header strip with claim number, type, status, SLA countdown, risk chips, awaiting-reply badge, totals, copy-link and copy-number buttons, and a customer link. A transition action bar shows only legal next statuses, with a reason-dictionary confirm dialog for reject and cancel. Tabs: **Lines** (per-line status, quantities, disposition, grade, credit/fee/core amounts, inline hot-path editing for `qtyApproved`/`disposition`/`lineStatus`, product picker, add-from-order), **Timeline** (segmented filter across all/comments/status changes/customer-visible, actor display names, `from → to` labels, comment composer with visibility toggle and "Draft with AI"), **Attachments**, and **AI assist** (deterministic triage card labeled as rule-based, alongside the embedded `<AiChat>` copilot). A fulfillment action block offers "Create sales return", "Create replacement order", and "Create credit memo", each gated on the operator actually holding the corresponding sales feature.
- **Create / edit** (`backend/warranty_claims/create/page.tsx`, `backend/warranty_claims/[id]/edit/page.tsx`): `CrudForm` with auto-derived optimistic-lock headers. Multi-line create; every reference is a searchable picker (customer, order, replacement order, sales return, credit memo, catalog product/variant) — no type-an-ID inputs. Labels and disposition menus adapt to the live `claimType`.
- **Settings** (`backend/warranty_claims/settings/page.tsx`): a General section (SLA hours, pause toggle, at-risk threshold, auto-approve knobs, default warranty months, return window, quarantine grades, return-label provider), a structured business-hours editor (per-weekday windows including `24:00`, timezone combobox, holidays, advanced-JSON fallback that preserves unknown keys), a structured escalation-tier row editor with a staff picker, and three dictionary editors reusing `DictionaryForm`/`DictionaryTable`.
- **Secondary lists** (`backend/warranty_claims/{registrations,vendor-policies,troubleshooting-guides}/…`): full list/create/edit parity with filters, export, saved views, column chooser, and bulk delete reporting through shared progress events.
- **Injected surfaces**: a Claims tab on the sales order detail (count badge, "New claim from order" prefill); a Claims tab on customer person/company detail; a `claimsQueue` dashboard widget with open/at-risk/overdue tiles and status breakdown that deep-links into the pre-filtered desk.
- **Portal** (`frontend/[orgSlug]/portal/claims/…`): claims list on `DataTable` with search and status filter; claim detail with a status stepper, order number, customer-visible timeline, comment box, attachment upload, and Submit/Withdraw actions; a connected intake wizard (pick order → pick lines → details → review) with dictionary-backed reason/fault selects, entitlement chips, duplicate-serial warnings, client-side attachment validation, and a manual fallback at every step.
- Loading, error, empty, and record-not-found states use `LoadingMessage` / `ErrorMessage` / `EmptyState` / `RecordNotFoundState`.

## Integration Test Coverage

Playwright API-first specs in `packages/core/src/modules/warranty_claims/__integration__/`, self-contained with API-created fixtures and teardown cleanup.

| TC | Coverage |
|----|----------|
| TC-WC-001 | Claims CRUD API: auth, feature gates, filters, locking, immutable status, draft-only delete |
| TC-WC-002 | Line partial approvals: partial quantities, header rollups, closed-claim locking; stale per-line lock → 409; auto-assigned next line number |
| TC-WC-003 | Lifecycle commands: happy path, invalid transitions, rejection reason, credit-only skip, stale locks |
| TC-WC-004 | Vendor recovery: linked child claims only from unresolved-unlinked resolved lines |
| TC-WC-005 | Portal API: session required, customer-scoped claims, order-ownership validation, timeline/attachment filtering |
| TC-WC-006 | Timeline: staff comment visibility, status payloads, no mutable event routes |
| TC-WC-007 | Tenant isolation: a second-organization user sees no org-A claims |
| TC-WC-008 | SLA and reopen: submit stamp, `info_requested` pause, resume shift; pause disabled honored; closed reopens, cancelled stays terminal |
| TC-WC-009 | Settings and auto-adjudication: settings CRUD, locking, validation, risk-gated auto-approval; business-hours JSON persisted verbatim incl. `24:00`, holidays, timezone, unknown extras |
| TC-WC-010 | Stats and risk: gates, stats deltas, deterministic risk signals |
| TC-WC-011 | External API: API-key auth, order/customer resolution, idempotency, timeline visibility filtering |
| TC-WC-012 | Portal order pickers: customer-owned orders, warranty estimation, cross-customer line rejection, picked-line snapshot persistence |
| TC-WC-013 | AI draft reply: auth/manage gates, clean degradation with no LLM, 404 on unknown claims |
| TC-WC-014 | Type-adaptive intake: warranty and return creation, **type-constrained line dispositions**, generic vendor-recovery create blocked |
| TC-WC-015 | Bug regressions: order-picker grants reachable, order-less core-exchange intake validation; order-number snapshot matched in desk search |
| TC-WC-016 | Receiving grading: condition grade recorded, timeline written, **restock rejected for C/D grades** |
| TC-WC-017 | Registration and entitlement: registration CRUD locking, entitlement precedence, claim entitlement stamping |
| TC-WC-018 | Vendor policy auto-recovery: exactly one VRC child auto-generated for a resolved claim matching an active policy |
| TC-WC-019 | Adjudication: delegates to business rules when enabled, falls back to the light rule when disabled |
| TC-WC-020 | SLA escalation sweep: at-risk and breached events, paused claims skipped, each tier applied once |
| TC-WC-021 | Return-label seam: degrades without a provider, persists manual label fields, gates generated labels by status |
| TC-WC-022 | Email-to-claim: one unlinked API claim from inbound email, redelivery of the same message id ignored |
| TC-WC-023 | Quarantine: configured grades held, quarantine event emitted, hold released |
| TC-WC-024 | AI assess: auth/manage gates, documented degradation shapes |
| TC-WC-025 | Troubleshooting guides: admin CRUD, active matching guides returned to the portal walker |
| TC-WC-026 | Customer enricher: batched claim metrics on people lists, hidden without `claim.view` |
| TC-WC-027 | Desk filters: unassigned filter, assignee-name enrichment, detail-only ids trimmed from grid rows and exports; submitted/created date ranges with inclusive UTC day bounds; `slaAtRiskOnly` excludes overdue, paused, fresh, and draft claims |
| TC-WC-028 | Portal actions: customers submit own drafts and withdraw pre-review claims only; oversize and executable uploads rejected server-side; attachment list and download serve only customer-visible files |
| TC-WC-029 | Secondary list filters: registrations by coverage type, source, and expiry window (excluding null-expiry rows); vendor policies by `isActive`; guides by claim type and `isActive` |
| TC-WC-030 | Sales-return bridge: unauthenticated rejected; return created and linked from approved lines, duplicates blocked; shipped-quantity cap translated and skipped lines reported |
| TC-WC-031 | Over-claim guards: sold-quantity hard gate on every write path; lines without an order-line reference unaffected; cross-claim cumulative over-claiming surfaced as an advisory signal |
| TC-WC-032 | Return window: setting round-trips; out-of-window returns flagged without blocking |
| TC-WC-033 | Replacement-order bridge: unauthenticated rejected; zero-priced replacement order created from `replace`-disposition lines, duplicates blocked; ineligible statuses and no-`replace`-line claims rejected |
| TC-WC-034 | Credit-memo bridge: unauthenticated rejected; receipt-capped, discount-aware memo at a 23% tax rate, duplicates blocked; restocking fees deducted, receipt evidence and status gates enforced, manual links validated |

Unit coverage (`__tests__/`) pins the transition matrix, line rollups, number generation, command undo snapshots, `status`/`claimType` immutability, type-config resolution, grade→disposition gating, entitlement precedence, vendor-policy matching and auto-recovery idempotency, adjudication fallback, business-hours math and pause preservation, return-label `notConfigured`, enricher batch shape, decision-tree traversal, quantity gates, return-window math, the tracking subscriber (multi-match skip, absent table, infrastructure rethrow), and all three bridges (guards, header scrubbing, lost-race compensation, double-failure orphan precedence, the four undo branches, and the full credit amount contract).

Certain paths are covered at unit level by design: the dual-feature 403 variants on the three bridge routes (role-token fragility on unsynced development databases — a route-metadata assertion pins the feature list instead), bridge undo paths, `pricing: 'original'` line building, per-line memo persistence assertions (no sales API exposes memo lines), and the detail-page action visibility. The tracking-auto-advance end-to-end path is queue-worker-dependent and likewise lives in focused unit tests.

## Risks & Impact Review

### Data Integrity Failures

- Claim and initial lines are created atomically in one command and flush. Line mutations recompute header rollups inside the same atomic flush, clamping each approved line contribution at ≥ 0 and rounding to the column scale.
- Concurrent edits: optimistic locking is default ON for CRUD; every mutating command enforces `enforceWarrantyClaimOptimisticLock`, surfacing a structured 409 through the unified conflict bar. Comment posts are append-only and no-op without a header.
- Deleted references: FK-ids are soft references — the UI renders a missing-reference fallback and existence is validated at write time only, with unchanged fields skipped on update so historical claims stay editable.

### Cascading Failures & Side Effects

- Events are emitted after successful command commit; notification subscribers are isolated, and failures are logged without blocking the write.
- Cross-module writes exist only through the three bridges, each dispatching the peer module's own commands so peer validation and side effects run. Every bridge has an explicit compensation path and never reports silent success.
- The reverse-tracking subscriber swallows business no-ops and rethrows only infrastructure errors, so the persistent queue's bounded retry handles transients and a poison event exhausts retries without wedging the shipping pipeline.

### Tenant & Data Isolation Risks

- Every query filters `organization_id`/`tenant_id` in the WHERE clause, including every line-collection load. Portal routes additionally pin `customer_id` from the session; cross-customer access returns 404. Covered by TC-WC-005 and TC-WC-007.

### Migration & Deployment Risks

- All migrations are additive and re-runnable, with no backfill beyond the guarded `order_number` snapshot fill. Rollback drops the module's own tables and columns; no other module reads them.
- Existing installs must run `yarn mercato query_index rebuild --entity warranty_claims:warranty_claim` after migrating so desk search and filters see newly added columns on old rows, and `yarn mercato auth sync-role-acls` so existing tenants receive the module's role grants.

### Operational Risks

- The timeline table grows with activity but is bounded per claim, in the same growth class as audit logs; indexed on `(claim_id, created_at)`.
- Notification volume targets the creator and assignee only, never the whole organization.
- The escalation sweep is idempotent and tenant/org-scoped, and only notifies or reassigns — it moves no money.
- Source order-line lookups in the bridges are sequential per line, bounded by claim-line counts; batching is a recorded performance follow-up.

### Risk Register

#### Stale sales references on claims
- **Scenario**: An order or order line referenced by a claim is deleted or archived; the claim UI would dangle.
- **Severity**: Low
- **Affected area**: claim detail, order tab widget
- **Mitigation**: soft references resolved defensively at read with a fallback label; existence validated at write time only, and only for changed fields on update.
- **Residual risk**: historical claims may show unresolvable references — acceptable, since snapshots preserve audit value.

#### State machine bypass via raw entity update
- **Scenario**: A contributor mutates `status` through the generic PUT instead of `transition`.
- **Severity**: Medium
- **Affected area**: lifecycle integrity, SLA metrics
- **Mitigation**: `status` is excluded from the update validator and command whitelist; transitions happen only through `claim.transition`; a unit test asserts PUT cannot change it.
- **Residual risk**: direct database writes remain possible, as everywhere.

#### Orphaned sales document after a bridge failure
- **Scenario**: A peer document is created, the claim stamp fails, and the compensating delete also fails.
- **Severity**: Medium
- **Affected area**: resolution execution, sales document hygiene
- **Mitigation**: the command always surfaces a 500-class orphan error carrying the document id, logs it, and best-effort appends an orphan timeline entry on a fresh EntityManager; the peer document itself embeds the claim number, so the orphan is discoverable from the sales side even if the timeline write fails.
- **Residual risk**: an operator must resolve the orphan manually, with the evidence visible. Accepted.

#### Credit-memo arithmetic correctness
- **Scenario**: Sales stores the bridge's amounts verbatim, so a rounding or tax error persists as the document of record.
- **Severity**: Medium
- **Affected area**: money movement
- **Mitigation**: the amount contract is fully deterministic (scaled-integer, half-up once, percentage-correct tax, fused multiply-divide, derived unit prices, a consistency clamp so persisted values always equal bridge values); a dedicated unit suite pins every branch; the total surfaces in the success flash and timeline payload for immediate inspection; staff retain full edit rights on the memo in sales.
- **Residual risk**: order-level adjustments are not prorated into the credit in this version — documented in the API description.

#### Portal intake abuse
- **Scenario**: A portal user floods claims or attaches junk.
- **Severity**: Low
- **Affected area**: triage queue hygiene
- **Mitigation**: portal intake creates `submitted` claims in a filterable queue; attachment size, type, executable-content, and quota limits are enforced server-side.
- **Residual risk**: no rate limiting yet — acceptable for authenticated B2B portal users.

#### Optional-peer coupling
- **Scenario**: An optional peer (`sales`, `catalog`, `inbox_ops`, `shipping_carriers`, `business_rules`, `ai_assistant`) is absent or unreachable.
- **Severity**: Low
- **Affected area**: bridges, intake pickers, tracking, adjudication, AI
- **Mitigation**: every peer is referenced by event-id string or `tryResolve`; lookups degrade through `to_regclass`/`42P01` guards; bridges answer a named 400 `*SalesUnavailable`; UI actions hide when the operator lacks the peer feature. Absent-module paths are unit-tested.
- **Residual risk**: reduced functionality without the peer, by design.

## Final Compliance Report

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `packages/core/AGENTS.md`, `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`, `packages/shared/AGENTS.md`, `packages/search/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/events/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md` (reference module), `packages/core/src/modules/sales/AGENTS.md`, `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | FK-id + snapshot; cross-module writes via `commandBus` only |
| root AGENTS.md | Tenant/organization scoping on every query | Compliant | Scoped in the WHERE clause everywhere; portal adds a customer pin |
| root AGENTS.md | Optimistic locking on new editable entities | Compliant | `updated_at` on claim/line/settings, returned as `updatedAt`; every mutating command enforces the check |
| root AGENTS.md | Modules plural snake_case; events `module.entity.action` | Compliant | `warranty_claims`; 14 declared event ids |
| packages/core/AGENTS.md | CRUD via `makeCrudRoute` + `openApi` export | Compliant | Claims, lines, registrations, vendor policies, guides |
| packages/core/AGENTS.md | Writes dispatch registered commands | Compliant | 20 commands; CRUD and bridges undoable |
| packages/core/AGENTS.md | Mutation-guard registry on hand-written writes | Compliant | `runRouteMutationGuards` on staff and portal write routes |
| packages/core/AGENTS.md | ACL feature ids in `acl.ts`, defaults in `setup.ts` | Compliant | 12 features + role defaults |
| packages/core/AGENTS.md | Events declared before emit; one side effect per subscriber | Compliant | `events.ts` + nine isolated subscribers |
| packages/core/AGENTS.md | Encryption maps for PII/free-text | Compliant | Five entity maps; reads via `findWithDecryption`; encrypted fields excluded from search |
| packages/core/AGENTS.md | `withAtomicFlush` for multi-phase writes | Compliant | Rollups, stamps, and undo restores |
| packages/queue/AGENTS.md | Background work through the worker contract | Compliant | `warranty_claims.sla_sweep` with a scheduler producer |
| packages/ui/AGENTS.md | `CrudForm`/`DataTable`/`apiCall`/`useGuardedMutation`; no raw fetch | Compliant | All UI data calls |
| root AGENTS.md (DS) | Semantic status tokens; no arbitrary values; dialog shortcuts | Compliant | Status/priority variant maps exported once |
| root AGENTS.md | i18n — no hardcoded user-facing strings; 4 locales | Compliant | Flat dotted keys at parity |
| .ai/qa/AGENTS.md | Self-contained integration tests shipped with the feature | Compliant | TC-WC-001…034 |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Fields ↔ validators ↔ routes ↔ projections |
| API contracts match UI/UX section | Pass | Desk, detail, settings, portal, and injected surfaces use listed endpoints |
| Risks cover all write operations | Pass | CRUD, transitions, receiving, portal intake, external intake, vendor recovery, three bridges |
| Commands defined for all mutations | Pass | Including line CRUD, receiving, comments, and settings |
| Cache strategy covers read APIs | Pass | Commands emit CRUD side effects so the list cache and query index stay consistent |

### Non-Compliant Items

None identified.

### Verdict

Fully compliant — implemented and verified against the full validation gate.

## Changelog

### 2026-07-03 — Foundation
- Introduced the `warranty_claims` module: one claim aggregate with a `claimType` discriminator, claim lines with partial approvals and dispositions, an append-only timeline, and per-tenant/org/type claim numbering.
- Shipped the command-driven state machine (create/update/delete/submit/transition/assign/comment/vendor-recovery plus line CRUD), tenant-scoped CRUD and action APIs, dictionary-backed fault and reason codes, and encryption for all free-text and correspondence fields.
- Added the staff Claims Desk list and triage workspace, the customer portal intake and tracking pages with module-owned attachment endpoints, and a Claims tab on the sales order detail.
- Established the isolation guarantees the module keeps everywhere: every loader filters tenant and organization in the WHERE clause, and portal routes pin the claim to the session's customer.

### 2026-07-04 — Desk upgrade
- Split the status broadcast so staff and portal audiences each receive their own event, making realtime refresh work on both sides.
- Added tenant-configurable settings (SLA hours, pause behavior, at-risk threshold, auto-approval limits), an SLA pause/resume engine, deterministic risk signals, default-off risk-gated auto-adjudication, and a KPI strip with queue chips.
- Reworked desk ergonomics: staff-picker assignment, bulk actions that carry per-row lock headers and report partial failures, three-tier SLA display, inline hot-path line triage, readable timelines, multi-line create with an order picker, and dictionary-backed portal selects.
- Closed lifecycle gaps: a customer reply on an `info_requested` claim auto-resumes it, closed claims can reopen, claim delete cascades to lines, and quantity/warranty-date math was corrected.

### 2026-07-04 — Connected intake, external API, and AI copilot
- Connected staff and portal intake to real data: catalog product/variant pickers on every line editor, add-lines-from-order prefill, module-owned portal order and order-line endpoints, and an entitlement chip driven by a configurable default warranty period.
- Added a headless, API-key-secured external intake API with least-privilege features, order-first customer resolution, required correlation ids for idempotent replay, contact-snapshot unlinked claims, and a status-page GET returning lines plus customer-visible timeline entries.
- Added the staff AI copilot: a claims assistant agent embedded in the triage workspace, read-only draft-reply and summarize tools, and a composer "Draft with AI" action that degrades cleanly when no model is configured.
- Made API-intake claims visible as a first-class channel on the desk.

### 2026-07-05 — Operational depth
- Made intake type-adaptive across labels, reason taxonomy, and disposition menus, with the server enforcing type-legal dispositions.
- Added the receiving workbench with A–D condition grading, grade-driven disposition gating, and quarantine holds; warranty registrations as the entitlement base behind an overridable resolver; per-vendor policies with idempotent, staff-confirmable supplier-recovery generation; rules-backed adjudication behind a seam; an SLA escalation worker with business-hours math and once-per-tier escalation; a return-label provider seam with manual entry as a first-class path; an opt-in email-to-claim bridge with message-id idempotency; AI photo and document assessment that never mutates money; guided troubleshooting decision trees; and claim metrics enriched onto customer detail.
- Eliminated raw identifiers from every surface: an order-number snapshot, batched assignee display names, searchable pickers in place of type-an-ID inputs, and humanized vendor-recovery suggestions.
- Added desk velocity and visibility features: server-backed filters for assignee, date ranges, and SLA risk; a "customer replied" queue signal; CSV export; a claims-queue dashboard widget; portal submit and withdraw actions; and an attachment visibility split so staff uploads stay internal.

### 2026-07-16 — Competitive refinements
- Wired reverse-tracking auto-advance: a delivered return shipment moves an unambiguously matching `awaiting_return` claim to `received` with an explanatory timeline note, skipping ambiguous matches for manual receiving.
- Added quantity honesty guards — a hard gate on every line-write path preventing a claim from claiming more than the linked order line sold, and an advisory cross-claim cumulative signal.
- Shipped the first resolution-execution bridge: create a sales return from approved claim lines in one action, with pessimistic-locked stamping, compensation on failure, and version-token undo.
- Added a tenant-configurable return window that flags out-of-window non-warranty claims as an advisory risk signal without ever auto-denying.

### 2026-07-17 — Resolution execution
- Completed resolution execution with two more bridges: a zero-priced replacement sales order built from `replace`-disposition lines (setting the advance-replacement flag when executed pre-receipt), and a receipt-proven credit memo built from `credit`/`refund` lines whose credited quantity is capped by what was actually received.
- Added `creditMemoId` to the claim so the money document is tracked, manually linkable, reference-validated, and round-tripped through undo.
- Specified and implemented the credit amount contract: discount-aware proration from order-line totals, percentage-correct tax conversion, single half-up rounding, derived unit prices, and a consistency clamp so persisted values always equal computed values.
- Fixed the peer-side gap where a credit memo validated but never persisted its order link, making bridge-created memos traceable from sales.
