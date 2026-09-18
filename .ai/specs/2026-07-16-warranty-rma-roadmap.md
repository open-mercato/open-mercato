# Warranty & RMA Claims Desk — Roadmap

> **Implemented module spec:** [`2026-07-03-warranty-rma-claims-desk.md`](./2026-07-03-warranty-rma-claims-desk.md). This document tracks only work that is **not** implemented: the competitive benchmark that produced the gap list, the triaged candidate roadmap, and the deferred items carried forward from earlier rounds. It exists so future rounds do not re-research the market.

## TLDR

**Key Points:**
- The `warranty_claims` module leads the benchmark on receiving/grading, SLA engineering, risk signals, supplier recovery, and AI assistance, and has closed the resolution-execution gap for all three sales documents (return, replacement order, credit memo).
- What remains is a triaged candidate list: customer-facing reach (guest lookup, portal window hints), analytics depth, new sub-aggregates (repair orders), payment-dependent flows (instant exchange), and enterprise-adjacent programs (recalls, extended warranty plans).
- A handful of smaller carry-forward items are recorded separately: they are known, bounded, and deliberately unscheduled.

**Scope:** research and triage only. No item here is designed or committed; each candidate names its pattern source, its dependency, and its rough effort so a future round can scope it properly.

## Overview

A 19-product competitive benchmark (July 2026) mapped every capability the returns-SaaS, warranty-platform, and ERP groups ship against what this module does. The four highest-value, lowest-blast-radius gaps identified at the time were implemented and are documented in the module spec. This document keeps the remaining research so the next round starts from evidence rather than re-surveying the market.

## Problem Statement

Competitive research is expensive and perishable. Without a durable record, each round re-derives the same market map, re-argues the same triage, and risks re-litigating decisions that were already made deliberately (for example, why cross-claim quantity blocking stays advisory, or why concrete carrier adapters do not live in core). This document is that record.

## Market Reference (July 2026 benchmark)

Products surveyed — **returns SaaS**: Loop, AfterShip, ReturnGO, Narvar, Happy Returns, Redo, ReturnLogic, Rich Returns. **Warranty platforms**: Extend, Cover Genius/XClaim, Mulberry, OnPoint, Tavant, PTC iWarranty, Pega Warranty, Registria. **ERP/commerce**: Odoo 18/19, Dynamics 365 SCM, NetSuite 2026.1, SAP B1 10.0, Shopify, Adobe Commerce, Sylius 2.x, Saleor 3.23, Medusa.

| Capability | Returns SaaS | Warranty platforms | ERP | This module |
|---|---|---|---|---|
| Self-service portal + reasons + timeline | ✅ all | ✅ all | ⚠️ rare (back-office) | ✅ |
| Receiving / grading / disposition workbench | ⚠️ ReturnGO Item Validation, ReturnLogic | ✅ (parts inspection) | ✅ (D365 arrival + quarantine, NetSuite restock-vs-writeoff) | ✅ (A–D grade, quarantine, gates) |
| Rules adjudication + review queue + risk scoring | ✅ (Loop Workflows, ReturnGO ReturnScore, Narvar IRIS) | ✅ (Extend, Tavant) | ⚠️ approval statuses only | ✅ (auto-approve, risk tiers, six signals) |
| Warranty registration / entitlement | ⚠️ Redo, ReturnLogic | ✅ core | ⚠️ add-ons (NetSuite SuiteApp, SAP equipment cards) | ✅ (registration → order → date resolver) |
| SLA + business hours + escalation tiers | ❌ none | ⚠️ (Pega RA SLA) | ❌ | ✅ |
| Supplier recovery | ❌ | ✅ deep (proration, chargebacks) | ⚠️ (vendor RA / purchase returns) | ✅ (vendor policies + auto VRC) |
| Resolution execution (return / replacement / credit docs) | ✅ (refund orchestration, instant exchange) | ✅ (payout rails, zero-amount SO) | ✅ (credit memo, replacement order, reverse transfer) | ✅ (all three bridges) |
| Reverse-tracking auto-advance | ✅ (refund at first scan) | n/a | ✅ (carrier scans advance status) | ✅ |
| Sold-quantity validation | ✅ | ✅ (part-level coverage) | ✅ (D365/NetSuite hard-block) | ✅ (hard gate + cumulative signal) |
| Return-window policy (non-warranty) | ✅ (windows, non-returnable flags) | n/a | ✅ (D365 return item policies) | ✅ (advisory signal) |
| **Guest claim lookup** | ⚠️ (Magento, Sylius community) | ❌ | ❌ | ❌ roadmap |
| **Instant / advanced exchange with card hold** | ✅ differentiator | n/a | ⚠️ (D365 up-front replacement) | ❌ roadmap (needs payments) |
| **Defect / failure analytics** | ⚠️ (ReturnLogic serial root-cause) | ✅ (Tavant early-warning) | ❌ | ⚠️ KPI strip + dashboard widget only |

### Source-cited vendor conventions (reusable research)

These two conventions were verified directly against vendor documentation and are worth keeping, since any future execution or pricing work depends on them:

- **Replacement pricing.** NetSuite documents that for RMA-generated replacement sales orders "the amount of the warranty item is set to zero", with *Ship Replacement in Advance* covering pre-receipt dispatch ([Creating a Sales Order for a Replacement Claim](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_3938326430.html), [Managing Refund, Repair, and Replacement Claims](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4391753773.html)). Dynamics 365 disposition actions (`Replace and credit`, `Replace and scrap`) attach a second sales order to the RMA, created manually before receipt for immediate shipment or automatically after inspection ([Sales returns](https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/sales-returns), [Set up disposition codes](https://learn.microsoft.com/en-us/dynamics365/supply-chain/service-management/set-up-disposition-codes)).
- **Credit-memo gating.** NetSuite exposes the credit-memo action on the RMA only **after** the item receipt; the memo is then applied to balance or refunded. Both platforms treat memo creation as an explicit staff action on a received return — never automatic. This is the precedent behind the module's receipt-proven credit rule.

## Proposed Solution

Nothing is proposed for implementation here. Each candidate below is triaged with its pattern source, dependency, and effort so a future round can pick one, write a scoped spec, and implement it against the constraints in the Architecture section.

## Architecture — constraints any future round must honor

These are the module's grounded invariants. A candidate that cannot be built within them needs an explicit architecture decision before it is scheduled.

- Money and quantity columns are `numeric(18,4)` mapped to `string | null`; never BigInt in storage. Scaled-integer arithmetic is fine transiently.
- No new claim statuses. The 12-state machine and the line-status guards are frozen; new capability reuses the existing lifecycle.
- No auto-deny anywhere in adjudication, and no automation mints a sales document. Signals inform, humans decide; execution is one click, never zero.
- Cross-module reads use scoped kysely or the EntityManager with `to_regclass` / `42P01` degradation and `tryResolve` for optional peers — never the QueryEngine for cross-module rows. Cross-module writes go only through `commandBus` dispatch of the peer module's own commands, with the claim's optimistic-lock header scrubbed from the nested context.
- Optimistic locking on every mutating command; i18n flat dotted keys across four locales at parity; events declared in `events.ts` before first emit; new PII or free-text declared in `encryption.ts`.
- Concrete integration providers (carriers, payment gateways) ship as dedicated workspace packages, never inside `packages/core`. Core ships the seam.

## Data Models

No schema changes are proposed. Each candidate specifies its own entities and migrations when scoped. Items likely to need new tables are flagged in the roadmap table (repair orders, recall campaigns, extended-warranty plans, an incremental-credit ledger).

## API Contracts

No routes are proposed. Each candidate specifies its own endpoints when scoped, following the module's established conventions: `requireAuth` + `requireFeatures`, zod validation, exported `openApi`, tenant/organization scoping, and the peer module's exact feature alongside the warranty feature on any route that dispatches a peer command.

## Roadmap — benchmarked candidates

| Candidate | Pattern source | Dependency / effort | Notes |
|---|---|---|---|
| Guest claim lookup + tokenized public tracking page | Adobe Commerce guest RMA; Narvar tracking pages | signed short-lived token route outside portal auth | High customer-experience value for B2C tenants |
| Portal return-window hint + delivery-date anchoring | Shopify return rules (delivery-anchored) | customer-scoped window endpoint; shipment-date resolution | The staff-side signal ships today; the risk endpoint is staff-authed, so a portal hint needs its own customer-scoped endpoint. Delivery-date anchoring is stricter than the current placement anchor |
| Insights / analytics page (return rate by product, reason, vendor; cost; cycle-time trends; serial root-cause) | ReturnLogic serial root-cause; Tavant early-warning | query-index aggregations; new page | The KPI strip and dashboard widget are the seed |
| Repair orders (parts + labor lines, technician assignment) | Odoo Repairs; Pega repair orders; PTC labor rates | significant new sub-aggregate | Only worth it with field-service demand |
| Instant exchange with card hold; catalog exchange | Loop, AfterShip, ReturnGO, Redo | payment-gateway hold API | Flagship returns-SaaS differentiator; large |
| RTV batch consolidation for vendor recovery | D365 purchase-return chains | vendor shipping documents | The current per-claim VRC flow is the seed |
| Recall / service campaigns | Tavant, PTC, Pega | campaign entity + notifications | Enterprise-adjacent |
| Extended-warranty plan catalog and checkout upsell | Extend, Redo, Registria | commerce checkout surface | A revenue feature, not a claims feature |
| Registration by photo (label OCR) | Registria Photoregister | existing AI vision tools | Cheap MVP: reuse the proof-of-purchase extraction tool |
| Credit before receipt (goodwill credits) | D365 `Credit only` disposition | policy decision on when goodwill is allowed | Deliberately excluded from the receipt-proven credit rule; needs a product decision |
| Replacement-pricing picker in the UI | — | small | The API already accepts zero vs. original pricing; the UI always sends zero until a picker earns its place |
| Order-level adjustment and discount proration into credits | — | product decision on which adjustment kinds allocate, and how shipping interacts | Current credits prorate line-level discounted totals only; order-level adjustments live on the document, not its lines |
| Incremental credit (per-line credited-quantity ledger) | — | new sub-entity | Today each claim mints at most one memo; a partial-receipt memo consumes that execution and later arrivals are handled in sales |
| Sales memo-line read API | — | peer module (`sales`) | Would let the credit-memo bridge's line-level test assertions move from unit to integration level |
| Deep links into created sales documents | — | blocked on standalone sales detail routes | Sales returns and credit memos render inside the order detail, so there is no route to link to yet |

## Deferred items carried forward

Known, bounded, and deliberately unscheduled:

- **Concrete carrier adapters.** The return-label provider seam ships in core with manual entry as a first-class path; concrete carrier integrations belong in dedicated `carrier-*` workspace packages and are not built.
- **Per-type reason dictionaries.** Claim intake shares one reason dictionary across all four claim types. Type-adaptivity currently covers labels and disposition menus; splitting the reason taxonomy per type is a future refinement.
- **Risk thresholds as configuration.** Repeat-claimer counts, value-velocity windows, and severity escalations are code constants. Making them tenant-configurable is deferred until there is evidence tenants disagree with the defaults.
- **Stats materialization.** The KPI endpoint computes live per tenant/organization scope. Materialization is deferred until a tenant's claim volume makes it necessary.
- **Batched source-line lookups in the resolution bridges.** Each bridge resolves its source order lines sequentially, bounded by claim-line counts. Batching is a recorded performance follow-up, not a correctness issue.
- **Cross-claim quantity hard-blocking.** Deliberately not built: rejected and appealed history plus legitimate re-claims (a failed repair, a second fault) make a cross-claim hard block wrong more often than right. The advisory `over_quantity_claim` signal plus manual review is the module's answer, and this decision should not be revisited without new evidence.

## Risks & Impact Review

This document changes no code and carries no runtime risk. The risks it manages are process risks:

- **Stale research.** The benchmark reflects July 2026. Competitor capability moves; treat the table as a starting point and spot-check the two or three products most relevant to a candidate before scoping it.
- **Re-litigating settled decisions.** The deferred-items section records decisions made with reasoning, not oversights. Reversing one is legitimate but should be argued from new evidence, not from the absence of the feature.
- **Scope creep into core.** Several candidates (instant exchange, carrier adapters, extended-warranty plans) pull toward provider-specific or payment-specific code. The Architecture constraints above are the guardrail: core ships seams, packages ship providers.

## Final Compliance Report

| Rule | Status |
|---|---|
| Lives in `.ai/specs/` root as pending, unimplemented scope | ✅ |
| Filename follows `{date}-{title}.md` with no legacy prefix | ✅ |
| No enterprise-only scope in the OSS specs directory | ✅ |
| No stale endpoints, entities, or assumptions (nothing is asserted as shipped) | ✅ |
| Implemented behavior documented in the module spec, not duplicated here | ✅ |

## Changelog

### 2026-07-16
- Established the roadmap from a 19-product competitive benchmark: market map, triaged candidate list with pattern sources and dependencies, and the deferred items carried forward from earlier rounds.
- Recorded the source-cited replacement-pricing and credit-gating conventions so future execution work does not re-verify them.

### 2026-07-17
- Removed the resolution-execution items (replacement-order and credit-memo bridges) from the candidate list — both shipped and are documented in the module spec.
- Added the candidates surfaced while building them: credit before receipt, a replacement-pricing picker, order-level discount proration, an incremental-credit ledger, a sales memo-line read API, and deep links into created sales documents.
