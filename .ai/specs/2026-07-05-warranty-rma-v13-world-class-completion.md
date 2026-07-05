# Warranty & RMA Claims Desk — v1.3 World-Class Completion

> **Parent spec:** [`2026-07-03-warranty-rma-claims-desk.md`](./2026-07-03-warranty-rma-claims-desk.md). This spec implements the deferred **v1.3 Roadmap** from that document plus four correctness bugs and a full type-adaptive intake form. Everything is additive; no v1/v1.1/v1.2 contract surface changes shape (the whole module ships unreleased in the same `feat/warranty-claims-desk` branch).

## TLDR
**Key Points:**
- Fix the four field-reported correctness bugs (empty order picker, English reason labels on non-EN locales, intermittent create-500, non-type-adaptive line header).
- Make the claim intake genuinely **type-adaptive**: labels, required fields, reason taxonomy, and resolution/disposition menus all switch on `claimType` (`warranty | return | core_return | vendor_recovery`).
- Build the entire **v1.3 roadmap** in one branch — receiving/grading, warranty entitlement + registration, per-vendor policy + auto supplier recovery, `business_rules` adjudication + risk-tier policy, SLA escalation + business-hours, return-label + carrier seam, email-to-claim, quarantine, LLM photo/document intelligence, guided troubleshooting, and a customer-detail claim-count enricher.

**Scope boundary (architecture-mandated):** third-party integrations ship as **in-core DI-overridable seams + soft-optional `tryResolve` bridges** (carrier label provider, inbound-email intake, inventory quarantine, LLM vision). Concrete carrier adapters remain separate `carrier-*` packages per root `AGENTS.md` — core ships the framework, never a provider.

**Concerns:** large additive migration set (new entities + columns); several features degrade to no-ops when an optional peer module is absent (must be tested via reduced-registry / absent-module paths).

## Problem Statement
The module is mature (v1/v1.1/v1.2, three jury-reviewed passes) but (a) four defects make the shipped desk feel broken on first use, (b) the intake form does not adapt to claim type — the single most consistent pattern across every RMA/warranty leader benchmarked — and (c) the operational depth features (grading, entitlement, supplier-policy recovery, escalation, labels, email intake, quarantine, AI vision, decision trees) were deferred. This spec closes all three.

## Grounded invariants (from `wc-grounding.md` — do not violate)
- `claimType` = `['warranty','return','core_return','vendor_recovery']`; number prefixes WTY/RMA/COR/VRC, 6-digit zero-pad. `claimType` is immutable after create.
- **Money columns are `numeric(18,4)` → `string | null`. Never introduce BigInt.**
- State machine: `rejected → ['in_review','closed']`, `closed → ['in_review']`, `cancelled → []`. `resolved` requires every non-deleted line `rejected|resolved`. `rejected` requires `rejectionReasonCode`.
- i18n is **flat dotted**, 4 locales (`en/pl/de/es`) at parity; add every new leaf to all four. No `warranty_claims.reason.*` group exists (reasons come from dictionaries).
- Optimistic lock is command-level via `enforceWarrantyClaimOptimisticLock(ctx, record, resourceKind?)`; `WarrantyClaim`/`WarrantyClaimLine`/`WarrantyClaimSettings` carry `updated_at`. Events/sequence are exempt.
- Commands (exact ids): `warranty_claims.claim.{create,update,delete,submit,transition,assign,comment,create_vendor_recovery}`, `warranty_claims.claim_line.{create,update,delete}`, `warranty_claims.settings.save`.
- Indexer entity ids: `E.warranty_claims.warranty_claim`, `E.warranty_claims.warranty_claim_line`.
- Encrypted (use `findWithDecryption`): claim `notes`/`resolution_summary`/`contact_email`; line `fault_description`/`inspection_notes`; event `body`. New free-text/PII fields added here must be declared in `encryption.ts`.
- Migration files `Migration<YYYYMMDDHHMMSS>_warranty_claims.ts`; latest `Migration20260704230000_warranty_claims.ts`; update `migrations/.snapshot-open-mercato.json` in the same commit. Never run `yarn db:migrate` unless asked.
- Cross-module reads use scoped kysely/em (NOT QueryEngine — the module already hit the hybrid-engine routing trap twice); optional peers via a local `tryResolve` wrapper (returns `undefined` when absent).

## Architecture — new surfaces

### New entities (additive migration)
| Entity | Table | Purpose |
|--------|-------|---------|
| `WarrantyClaimRegistration` | `warranty_claim_registrations` | Product/serial registration = the entitlement base. `serial_number`, `product_id`/`variant_id`/`sku`/`product_name` (snapshot), `customer_id`, `order_id`, `purchase_date`, `warranty_months`, `warranty_expires_at`, `coverage_type` (`standard|extended|none`), `source` (`order|manual|third_party`), `proof_attachment_id`, `notes` (encrypted), org/tenant/`updated_at`/`deleted_at`. |
| `WarrantyVendorPolicy` | `warranty_claim_vendor_policies` | Per-vendor warranty policy for supplier recovery. `vendor_name` (match key), `vendor_ref`, `coverage_months`, `claimable_reason_codes` (jsonb array), `recovery_rate_pct`, `contact_email` (encrypted), `auto_generate_recovery` (bool), `is_active`, org/tenant/`updated_at`/`deleted_at`. |
| `WarrantyTroubleshootingGuide` | `warranty_claim_troubleshooting_guides` | Config-driven guided decision tree. `claim_type` (null=any), `reason_code` (null=any), `title`, `steps` (jsonb tree of `{prompt, options:[{label,next|resolution|reasonCode}]}`), `is_active`, org/tenant/`updated_at`/`deleted_at`. |

### New columns (additive)
- `warranty_claim_lines`: `condition_grade` (`A|B|C|D` null), `quarantine_status` (`none|held|released` default `none`), `assessment_payload` (jsonb null — AI/vision facts), `vendor_name` (text null — supplier attribution snapshot for auto-recovery matching, Phase 4).
- `warranty_claims`: `return_label_url` (text null), `return_tracking_number` (text null), `return_carrier` (text null), `escalation_level` (int default 0), `escalated_at` (timestamptz null), `intake_message_ref` (text null — inbound email/channel correlation), `entitlement_source` (text null — `registration|order|manual|resolver`).
- `warranty_claim_settings`: `business_hours` (jsonb null — weekly calendar + holidays), `escalation_tiers` (jsonb null — `[{atPct, action:'notify'|'reassign', toUserId?}]`), `adjudication_use_rules` (bool default false), `quarantine_grades` (jsonb null — grades that auto-hold), `return_label_provider` (text null — provider key for the seam).

### DI seams (all DI-overridable, default in-core, per the `createCommandOptimisticLockGuardService` precedent)
- `warrantyEntitlementResolver` — `resolveEntitlement(input, scope) → { warrantyStatus, coverageType, expiresAt, source }`. Default: registration lookup by serial → order/date compute (existing `computeWarrantyEntitlementPreview`). Enterprise tenants override for external warranty DBs.
- `warrantyReturnLabelProvider` — `createReturnLabel({claim, lines}, scope) → { labelUrl, trackingNumber, carrier } | { status:'notConfigured' }`. Default: `tryResolve('shippingCarrierService')` → generate via the platform carrier framework if present, else `notConfigured` (manual entry stays first-class). Concrete carriers = separate packages.
- `warrantyAdjudicationEvaluator` — `evaluate(claim, lines, settings, risk) → { decision:'auto_approve'|'manual_review', facts }`. Default: the existing light rule; when `adjudication_use_rules` and `business_rules` is present, delegate to a `tryResolve`'d rule-set evaluation; risk-tier thresholds fold in.

### New events (declared before emit; broadcast flags per convention)
`warranty_claims.claim.sla_at_risk`, `.sla_breached`, `.escalated` (clientBroadcast), `.registration_created`, `.line_quarantined`, `.return_label_created`. No portal broadcast except status changes already covered.

### New ACL features (added to `acl.ts` + `setup.ts` defaults + `sync-role-acls`)
`warranty_claims.registration.{view,manage}`, `warranty_claims.vendor_policy.manage`, `warranty_claims.troubleshooting.manage`, `warranty_claims.receiving.manage` (grading/quarantine). Reuse `claim.view`/`claim.manage`/`settings.manage` elsewhere.

## Implementation Plan (phased; one commit per phase)

### Phase 0 — Correctness bugs (P0)
1. **Empty order picker.** Grant `sales.orders.view` (and the sales order-lines / catalog product read features the connected-intake pickers call) to warranty desk roles in `setup.ts` `defaultRoleFeatures`; run `yarn mercato auth sync-role-acls`. In the create-form order/customer/product loaders, stop swallowing 403 into `[]` — detect `response.status === 403` and surface a "no access" hint (mirror the existing `hideOrderImport` 403 handling).
2. **Untranslated reason/fault labels.** Add `warranty_claims.reasonOption.<value>` + `warranty_claims.faultOption.<value>` i18n leaves for every seeded default (all 4 locales); in `loadDictionaryOptions`/`normalizeDictionaryOption`, resolve the display label via `t(\`warranty_claims.reasonOption.${value}\`, entry.label)` so localized labels win and the seeded English is only the fallback (dictionary data unchanged; user-added entries still show their stored label).
3. **Create-500.** In `assertCustomerExists`/`resolveCustomerName`, keep `CrudHttpError(400,'warranty_claims.errors.invalidInput')` for a genuinely-missing customer but map unexpected DB/query errors to a clean 400/422 (never a raw 500). Scope the create-form customer loaders to the selected organization so an org-A customer can't be submitted against an org-B claim. **Reproduce the exact 500 first** (org-mismatch payload) before landing.
4. **Type-adaptive line header** — folded into Phase 1.

### Phase 1 — Type-adaptive intake
- Introduce a per-type config `lib/claimTypeConfig.ts`: `claimType → { lineHeaderKey, allowedDispositions }` (extensible later). Line header per type; disposition/resolution menus filtered per type.
- Create form `groups` memo consumes config keyed by the live `claimType` value (add `claimType` to the memo deps); line header uses `t(config.lineHeaderKey)` with per-type keys `warranty_claims.form.lineHeader.<claimType>`. Detail/edit pages honor the same config for the disposition menu (preserving any already-persisted value on its own row).
- **Type-adaptivity is UI-only (labels + disposition menus) — no NEW server-side required fields are added.** (Jury reconciliation: hard per-type required fields would break TC-WC-001..013 and reject legitimate B2B claims that lack serials; adaptivity guides the operator without narrowing the contract.) The shared reason dictionary is kept (per-type reason dictionaries remain a future refinement); Bug-2 localization makes its labels locale-aware.
- All new labels in 4 locales.

### Phase 2 — Receiving workbench + condition grading
- Line columns `condition_grade` (`A|B|C|D` null), `quarantine_status`. Receiving happens in the existing `received`/`inspecting` statuses (no new statuses — the state machine already has `awaiting_return → received → inspecting → resolved`). A receiving panel captures the grade (A/B/C/D) per line.
- **Payout gate (reconciled — no "claimed condition" is captured, so there is nothing to compare against):** the grade drives a `grade → allowedDisposition` gate, not a claimed-vs-received comparison. Rule: a unit graded `C`/`D` cannot take `restock` (it is not resalable-as-new); grade `A` allows `restock`; `B` allows `restock`/`repair`/`refurbish` routing. The grade also produces a suggested disposition. Setting a disposition disallowed by the line's grade → 400 `warranty_claims.errors.dispositionGradeConflict`. New `warranty_claims.receiving.manage` feature. Grade + disposition changes append timeline events.

### Phase 3 — Warranty entitlement + registration
- `WarrantyClaimRegistration` entity + CRUD (`api/registrations/route.ts`, makeCrudRoute, indexer) + backend admin list/form + optional portal registration intake. `warrantyEntitlementResolver` DI seam; the intake entitlement chip becomes resolver-backed (registration → order → date compute), stamping `entitlement_source`. Serial lookup surfaces prior claims/registration on a serial.

### Phase 4 — Per-vendor policy + auto supplier recovery
- `WarrantyVendorPolicy` entity (matched by `vendor_name`, the same snapshot key the existing `vendor_recovery` flow already uses) + CRUD + settings UI.
- **Vendor identification (reconciled — claim lines snapshot product/order, not vendor):** add an optional `vendor_name` on the claim line (nullable snapshot, set by staff during triage or prefilled from a product→vendor mapping when one exists) so a resolved warranty line can be attributed to a supplier. Auto-recovery is **staff-confirmed, not blind-magic**: when a warranty claim reaches `resolved` and one or more resolved lines carry a `vendor_name` matching an active policy whose `claimable_reason_codes` include the claim's reason, the desk surfaces a **"Generate supplier recovery" suggested action** (and, when the policy's `auto_generate_recovery` flag is on, generates it automatically) via the existing duplicate-safe `create_vendor_recovery` command, carrying the causal fault + cost; `recovery_rate_pct` seeds expected recovery. Supplier recovery-rate rollup on the source claim. Idempotent (the existing `vendorClaimLineId` guard prevents double-generation).

### Phase 5 — `business_rules` adjudication + risk-tier policy
- `warrantyAdjudicationEvaluator` seam. When `adjudication_use_rules` is on and `business_rules` is present (tryResolve), `claim.submit` evaluates a claim-eligibility rule set → `auto_approve | manual_review`, folding risk tier (existing `lib/risk.ts`) and dynamic per-customer-risk thresholds. Degrades to the existing light rule when the module/flag is absent. No auto-deny.

### Phase 6 — SLA escalation + business hours
- `business_hours` + `escalation_tiers` settings. New events `sla_at_risk`/`sla_breached`/`escalated`.
- **Schedulability + idempotency (reconciled):** a queue worker `workers/sla-escalation-sweep.ts` (queue name `warranty_claims.sla_sweep`, `metadata = { queue: 'warranty_claims.sla_sweep' }`) is driven by a periodic producer registered via the platform scheduler (`configs`/scheduler cron entry, e.g. every 15 min) — the producer enqueues one tenant/org-scoped sweep job; the worker is the consumer. **Paused = `sla_paused_at IS NOT NULL`** (existing v1.1 column — no new pause flag). The sweep loads non-terminal, non-paused claims past their at-risk/breach thresholds and, per claim, emits `sla_at_risk`/`sla_breached` and applies tier actions (notify assignee/manager, reassign), then bumps `escalation_level` + stamps `escalated_at`. **Idempotency:** each claim is escalated at most once per tier — the sweep only fires a tier action when `escalation_level < tierIndex`, so a re-run (or duplicate job) is a no-op. Notifications + timeline entries per action.

### Phase 7 — Return-label + carrier seam
- Claim columns `return_label_url`/`return_tracking_number`/`return_carrier`. `warrantyReturnLabelProvider` seam + a "Generate return label" action on `approved`/`awaiting_return` (soft-optional via `tryResolve` into the carrier framework; manual entry stays first-class; `notConfigured` hides the button). Reverse-tracking webhook (if the carrier framework delivers scans) can auto-advance `awaiting_return → received`. Concrete adapters = separate packages (documented, not built here).

### Phase 8 — Email-to-claim intake
- Soft-optional subscriber bridging inbound customer email/communication events (tryResolve into `inbox_ops`/communication channels) into a `channel:'api'` claim with `intake_message_ref` correlation. No-op when the peer is absent (absent-module test).
- **Context derivation (reconciled):** tenant/org come from the inbound event's own scope (inbound channel events are already tenant/org-scoped). The **customer is left UNLINKED with a contact snapshot** (`contact_email` + `customer_name` from the sender) — customer `primary_email` is encrypted with no hash column, so email→customer lookup is deliberately not attempted (identical to the external-intake unlinked path). The claim requires `contact_email` (always present on an email).
- **Idempotency (reconciled):** `intake_message_ref` (the inbound message id) gets a **partial scoped unique index** on (`tenant_id`, `organization_id`, `intake_message_ref`) `WHERE intake_message_ref IS NOT NULL AND deleted_at IS NULL`, plus find-before-create: a redelivered inbound event with the same message id returns the existing claim (no duplicate), and a concurrent duplicate resolves via the unique-violation → return-existing path (mirrors the v1.2 `external_ref` idempotency).

### Phase 9 — Quarantine hold
- On a grade in `quarantine_grades`, set line `quarantine_status='held'` and emit `warranty_claims.line_quarantined`; an inventory module (if present) reacts via its own subscriber. Emit-side only in this module (no inventory import). Release action clears the hold.

### Phase 10 — LLM photo/document intelligence
- New AI tools (`ai-tools.ts`) `assess_damage_photo` (claim attachment image → damage type/severity/probable-cause + misuse flag) and `extract_proof_of_purchase` (receipt attachment → date/serial/amount) via the ai-assistant model factory (vision), soft-optional with the documented `notConfigured`/`aiUnavailable` degradation. Results land in line `assessment_payload` + a suggestion card; never auto-mutate money.

### Phase 11 — Guided troubleshooting decision trees
- `WarrantyTroubleshootingGuide` entity + admin CRUD + a guided walker on portal intake and staff triage that records the traversed path and can pre-fill reason/resolution. Config-driven; no hardcoded trees.

### Phase 12 — Customer-detail claim enricher
- `data/enrichers.ts` enriching `customers.person`/`customers.company` with `_warranty_claims` (open count, last claim date, lifetime count) via `enrichMany` (no N+1), feature-gated on `warranty_claims.claim.view`, `cacheableOnListHit:false` (cross-module).

### Phase 13 — i18n, tests, DS, gate
- All new leaves in 4 locales at parity; `yarn i18n:check-sync` clean. Unit + integration tests (below). DS-guardian on all touched UI. Full CI gate.

## API additions (all additive, tenant/org-scoped, `requireAuth` + features, `openApi`)
- `GET/POST/PUT/DELETE /api/warranty_claims/registrations` (`registration.*`)
- `GET/POST/PUT/DELETE /api/warranty_claims/vendor-policies` (`vendor_policy.manage`)
- `GET/POST/PUT/DELETE /api/warranty_claims/troubleshooting-guides` (`troubleshooting.manage`)
- `POST /api/warranty_claims/receiving` (grade/quarantine capture; `receiving.manage`)
- `POST /api/warranty_claims/return-label` (`claim.manage`; seam-gated)
- `GET /api/warranty_claims/entitlement?serialNumber=|orderId=|productId=` (`claim.view`; resolver-backed)
- `POST /api/warranty_claims/ai/assess` (`claim.manage`, LLM-gated)
- Portal: `GET /api/warranty_claims/portal/troubleshooting?claimType=&reasonCode=` (customer session)

## Integration Test Coverage (mandatory)
| TC | Path(s) | Assertions |
|----|---------|-----------|
| TC-WC-014 Type-adaptive intake | `/api/warranty_claims` create + form | per-type required-field validation (warranty needs serial+purchaseDate; vendor_recovery blocked from generic create as today); disposition set filtered per type on PUT |
| TC-WC-015 Bugs regression | `/api/warranty_claims`, `/settings-general` | order-picker feature grant present (role has `sales.orders.view`); create with valid in-scope customer + `orderId:null` + `reasonCode:'core-exchange'` + order-less line → 201 (no 500); out-of-scope customer → 400 not 500 |
| TC-WC-016 Grading | `/receiving`, `/lines` | grade capture; grade-worse-than-claimed blocks refund disposition (400); timeline event written |
| TC-WC-017 Entitlement + registration | `/registrations`, `/entitlement` | CRUD + optimistic lock; entitlement resolves registration → order → date; `entitlement_source` stamped |
| TC-WC-018 Vendor policy + auto recovery | `/vendor-policies`, `/transition` | policy CRUD; resolving a matching warranty claim auto-creates a `VRC-` child with causal facts; no double-generate |
| TC-WC-019 Adjudication (rules) | `/settings-general`, `/submit` | `adjudication_use_rules` on with business_rules present → rule decision; absent → light-rule fallback (no crash) |
| TC-WC-020 SLA escalation | worker + `/api/warranty_claims` | at-risk/breach events emitted against business hours; paused excluded; tier reassignment applied; escalation_level bumped |
| TC-WC-021 Return-label seam | `/return-label` | notConfigured when no provider; label/tracking persisted when seam resolves (mocked); manual entry path |
| TC-WC-022 Email-to-claim | subscriber (reduced registry) | inbound-email bridge creates `channel:'api'` claim with `intake_message_ref`; **no-op when peer absent** |
| TC-WC-023 Quarantine | `/receiving` | quarantine grade sets `quarantine_status='held'` + emits `line_quarantined`; release clears |
| TC-WC-024 AI assess | `/ai/assess` | 401/403 gates; notConfigured/aiUnavailable degradation shape (LLM-gated skip) |
| TC-WC-025 Troubleshooting | `/troubleshooting-guides`, `/portal/troubleshooting` | admin CRUD; portal walker returns active guide for type/reason |
| TC-WC-026 Enricher | `/api/customers/people?...` | `_warranty_claims` open/lifetime counts present; feature-gated; no N+1 |
Unit: type-config resolution; grade→disposition gating; entitlement resolver precedence (registration>order>date); vendor-policy match + auto-recovery idempotency; adjudication seam fallback; SLA business-hours elapsed math + pause; return-label seam notConfigured; enricher batch shape; decision-tree traversal.

## Migration & BC
- Additive only: 3 new tables + the listed columns; partial/scoped indexes for registration serial lookup, vendor-policy `vendor_name` match, and a partial UNIQUE index on (`tenant_id`,`organization_id`,`intake_message_ref`) `WHERE intake_message_ref IS NOT NULL AND deleted_at IS NULL` (email-intake idempotency). `down()` drops the new tables/columns/indexes. v1.2 rows behave identically (all new fields nullable/defaulted). No existing column drop/rename. **No new claim statuses** — every new feature reuses the existing state machine (`awaiting_return → received → inspecting → resolved`, `rejected↔in_review`, `closed→in_review`). TC-WC-001…013 stay green (only listed extensions).
- New FROZEN surfaces: the routes/ACL ids/events/DI keys above. Seams are additive DI registrations (overridable). No deprecations.

## Risks & Impact Review
- **Blast radius:** largest change to the module to date — many entities/columns. Mitigation: strict per-phase commits + tests; every new query tenant/org-scoped; new free-text/PII in `encryption.ts`.
- **Optional-peer coupling:** carrier/email/inventory/LLM are `tryResolve` soft-optional — absent-module paths unit-tested; no hard `requires`, no upstream import of the consumer.
- **Auto-generation side effects (vendor recovery):** idempotent + duplicate-safe (reuse the existing `create_vendor_recovery` duplicate guard); auto-generate is opt-in per policy.
- **Worker/escalation:** the sweep is idempotent, tenant/org-scoped, and only notifies/reassigns (no money movement); business-hours math is pure + unit-tested.
- **Money:** all amounts stay `numeric(18,4)` strings; no BigInt drift.

## Changelog
### 2026-07-05 (v1.3 implementation complete — full CI gate green + code-diff cross-model jury reconciled)
- All 13 phases implemented on `feat/warranty-claims-desk`: Phase 0 bug fixes (order-picker 403 surfacing, localized dictionary labels; the reported create-500's actual repro — an org-mismatch/nonexistent customer — is already a clean 400 via the missing-row path, and `customerId` is zod-`uuid()`-validated so a malformed id 400s at validation, so a speculative DB-error→4xx remap was **reverted** per `.ai/lessons.md` to keep infra errors 500-class), Phase 1 type-adaptive intake (create + detail), Phase 2 receiving/grading + grade→disposition gate, Phase 3 registration CRUD + `warrantyEntitlementResolver` seam + entitlement API + `entitlement_source` stamp, Phase 4 vendor-policy CRUD + idempotent auto supplier recovery, Phase 5 `warrantyAdjudicationEvaluator` seam (default byte-identical to the prior light rule; never auto-denies), Phase 6 SLA sweep worker + business-hours math + scheduler producer + escalate-once-per-tier, Phase 7 `warrantyReturnLabelProvider` seam + generate/manual API + detail action, Phase 8 email-to-claim bridge, Phase 9 quarantine hold, Phase 10 AI vision tools (`assess_damage_photo`/`extract_proof_of_purchase`) + assess API (never mutates money), Phase 11 troubleshooting-guide CRUD + portal walker, Phase 12 customer-detail `_warranty_claims` enricher.
- Verification: full CI gate green (build:packages → generate → build:packages → i18n:check-sync → typecheck → **7363 repo tests** → db:generate `no drift` → build:app); DS-guardian clean; i18n at parity across en/pl/de/es. One additive migration `Migration20260705121601_warranty_claims` (3 tables + additive columns + partial indexes); the only cross-module edit is a 1-line `customers.company` enricher opt-in.
- Cross-model code-diff jury (Opus fresh-reviewer PASS + codex/kimi/deepseek): reconciled — **fixed** the AI-assess attachment→claim ownership check (400 `attachmentNotLinked`, 3-voter agreement) and made the email-to-claim bridge **opt-in/safe-by-default** (`moduleConfigService` `emailIntakeEnabled` flag + `OM_WARRANTY_EMAIL_INTAKE` env fallback, default off). Refuted with code evidence: vendor-recovery `.strict()` (route narrows to 4 fields), settings optimistic-lock (header forwarded), `closed→in_review` (documented invariant, no new status), AI soft-optional (sanctioned import + graceful degrade; module-decoupling guard passes).
### 2026-07-05 (Phase 8 backend packet)
- Implemented the email-to-claim intake bridge: `createOrGetClaimFromInboundMessage`, a persistent `warranty_claims:email-to-claim` subscriber on `inbox_ops.email.received`, create-command `intakeMessageRef` support, and unit coverage for first create, redelivery, unique-violation race recovery, and missing-field guards. The bridge stays soft-optional by using only the event-id string and runtime payload.
### 2026-07-05 (Phase 7 backend packet)
- Implemented the return-label backend seam: `warranty_claims.claim.set_return_label`, `POST /api/warranty_claims/return-label`, provider-default documentation, and pure unit coverage for default `notConfigured` behavior plus the manual-entry schema guard. UI action wiring and TC-WC-021 integration coverage remain pending.
### 2026-07-05 (spec-stage cross-model jury — reconciled)
- Spec-stage jury (Codex + DeepSeek `fail`, both with valid design findings; Kimi skipped — oversized artifact). Reconciled before any feature-phase coding: **(Phase 1)** type-adaptivity clarified as UI-only (no new server-required fields — would break TC-WC-001..013 + reject legitimate serial-less B2B claims); **(Phase 2)** grading payout gate reframed to a `grade → allowedDisposition` rule (no "claimed condition" exists to compare against — a `C/D` grade blocks `restock`, 400 `dispositionGradeConflict`); **(Phase 4)** vendor identification defined via an optional line `vendor_name` snapshot + staff-confirmed/`auto_generate_recovery`-flagged generation through the existing duplicate-safe command; **(Phase 6)** SLA worker made schedulable (queue `warranty_claims.sla_sweep` + scheduler cron producer) and idempotent (escalate-once-per-tier via `escalation_level`; paused = existing `sla_paused_at IS NOT NULL`); **(Phase 8)** email intake made idempotent (partial unique index on `intake_message_ref` + find-before-create) with tenant/org from the event scope and an UNLINKED contact snapshot (encrypted email has no hash → no email→customer lookup); clarified **no new claim statuses** are introduced.
### 2026-07-05
- Initial v1.3 world-class-completion spec: 4 bug fixes, type-adaptive intake, and the full v1.3 roadmap (grading, entitlement+registration, vendor policy + auto supplier recovery, business_rules adjudication + risk-tier policy, SLA escalation + business hours, return-label/carrier seam, email-to-claim bridge, quarantine, LLM photo/doc intelligence, troubleshooting decision trees, customer-detail enricher). Integrations ship as in-core DI-overridable seams + soft-optional tryResolve bridges; concrete carrier adapters remain separate packages per root AGENTS.md.

## Progress
- [x] Phase 0 — bugs (order ACL/403, dict i18n, create-500, prep type-adaptive)
- [x] Phase 1 — type-adaptive intake form + per-type validators + localized labels
- [x] Phase 2 — receiving workbench + condition grading
- [x] Phase 3 — entitlement resolver seam + registration entity/CRUD/UI
- [x] Phase 4 — vendor policy catalog + auto supplier recovery
- [x] Phase 5 — business_rules adjudication + risk-tier policy
- [x] Phase 6 — SLA escalation worker + business hours
- [x] Phase 7 — return-label + carrier seam (backend command/API/provider + detail UI action + TC-WC-021)
- [x] Phase 8 — email-to-claim intake bridge (opt-in/safe-by-default after jury reconcile)
- [x] Phase 9 — quarantine hold
- [x] Phase 10 — LLM photo/document intelligence tools (attachment→claim ownership check after jury reconcile)
- [x] Phase 11 — guided troubleshooting decision trees
- [x] Phase 12 — customer-detail claim enricher
- [x] Phase 13 — i18n parity, tests (unit + TC-WC-014..026), DS-guardian, full CI gate
