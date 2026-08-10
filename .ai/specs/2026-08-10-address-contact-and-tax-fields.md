# Address-Level Contact Details and Tax Identifiers

## TLDR

**Key Points:**
- A sales document's address snapshots (`billing_address_snapshot` / `shipping_address_snapshot`) are free-form JSON, so integrations already persist `phone`, `email` and tax-id keys on them — but nothing models, renders, protects, or preserves those keys. This spec gives them a first-class model (`taxId` + `taxIdType`), a render path, and survival guarantees.
- Grew out of PR #66 and its reviews: the first wiring targeted `sales_document_addresses` (typed table, no such columns, 6 rows on prod against 1.42M orders) and rendered nothing; the save path destroyed the keys (fixed separately in PR #69).

**Scope:**
- `AddressValue` contact fields + opt-in `AddressView` contact block (implemented on `feat/address-contact-fields-render`, carries over)
- Tax-id typing (`taxIdType`) and EU-VAT normalization
- Read-only snapshot view for locked documents
- Type-aware indexing/display policy for tax ids
- `name` → `label` rename on address entities (deprecation protocol)

**Concerns:**
- Two new frozen exports (`formatAddressContactPairs`, `AddressContactLabels`) per `BACKWARD_COMPATIBILITY.md` — this spec is the reference its §"Spec requirement" demands.
- Tax ids are PII-adjacent and already treated as sensitive by search (`customers/search.ts:713`, `:805`).
- `AddressesSection.tsx` carries `// @ts-nocheck` (13 pre-existing type errors) — everything added there is unchecked by CI until that is lifted.

## Open Questions

Numbered per the review thread on PR #66. Each carries our recommendation; **Q0 and Q3/Q4 block the design**, the rest default to the recommendation if unchallenged.

- **Q0 (split?)**: Does this bundle two capabilities — contact-detail rendering and tax-id semantics? **Recommendation: one spec, phased.** Both ride the same frozen `AddressValue` surface; splitting would freeze `taxId: string` in phase 1 and regret it in phase 2. The phases below are independently shippable, which captures the split's benefit without the surface risk.
- **Q2 (email on the address?)**: Shopify/Medusa keep email on the order; commercetools puts it on the address. **Recommendation: document snapshot only, not `CustomerAddress`.** In the motivating dataset the delivery email is a per-order fact (95–98% coverage on shipments/notes), not a property of an address-book entry.
- **Q3/Q4 (tax-id type)**: Bare digits are ambiguous — a PL NIP of a non-VAT-registered business is not a VAT ID. **Recommendation: `taxId` + `taxIdType` from the start, minimal enum `eu_vat | local | other`** (Stripe-shaped `gb_vat`/`ch_vat`/… rejected for now; enum widens additively later). Needs an explicit call — this is the expensive-to-reverse decision.
- **Q7 (ACL gate)**: Should rendering a tax id be feature-gated? **Recommendation: type-aware, matching search's existing stance** — `eu_vat` is a public business identifier (VIES is an open lookup) and renders ungated; `local`/`other` render only behind the existing customer-PII feature the deployment already uses for `tax_id`. Exact feature id to be settled in Phase 2 review.
- **Q9 (rename)**: `name` on address entities is the address *label* ("Home"/"Warehouse"); a future `recipientName` beside it is a trap. **Recommendation: rename to `label` under the deprecation protocol** (bridge both names for one minor, `UPGRADE_NOTES.md` entry). Storage key in existing snapshots stays `name`; the bridge maps it.

Answered on the PR thread and treated as decided here: Q1 (`recipientName` — in scope, Phase 3), Q5 (normalize EU VAT to ISO-2-prefixed on write), Q6 (address-level authoritative for the document; customer stays master), Q8 (`country` constraint — separate change), Q10 (read-only snapshot view — Phase 1), Q11 (no core backfill), Q12 (the duplicate `addressFormat.tsx` copies — out of scope).

---

## Overview

Sales documents imported from an ERP carry a frozen billing/delivery address including the phone and tax id the document was issued under. Open Mercato persists these (snapshots are schemaless jsonb, encrypted at rest) but cannot display them, and until PR #69 destroyed them on the first manual save. Target audience: any deployment whose documents originate in an external system of record; the motivating case is a Subiekt GT ERP with 99.7% phone and 12.9% tax-id coverage on document addresses.

> **Market Reference**: Stripe (tax id + type enum — adopted, minimal variant), commercetools (email on address — considered for Q2), Shopify/Medusa (email on order — recommended for Q2). Rejected: splicing contact details into postal address lines (no marketplace does this; it corrupts one-line summaries).

**Touched:** `packages/core/src/modules/customers/utils/addressFormat.tsx`, `packages/ui/src/backend/detail/addressFormat.tsx` (byte-identical twin), `packages/core/src/modules/sales/components/documents/AddressesSection.tsx`, sales i18n (5 locales), Phase 3 only: `customers` address entities + migration.

**Not touched:** `sales_document_addresses` schema (explicitly rejected — see Alternatives), `addressSnapshotSchema` (stays free-form), search indexing config outside the tax-id rules, pickup points, per-country address formats, VIES calls, address filterability (blocked by encryption at rest), `buildingNumber`/`flatNumber` logic (1.1% fill in the motivating dataset; house numbers live in the street string).

## Problem Statement

1. **No read path.** `AddressValue` models nine postal fields; `formatAddressJson` / `formatAddressLines` / `formatAddressString` / `AddressView` are all built from those. A snapshot carrying `phone`/`taxId` renders as if it didn't.
2. **A B2B invoice address without its tax id is incomplete**, and "who to call about this delivery" is a property of the delivery address, not the customer — one customer, several addresses, different contacts.
3. **Bare tax ids are ambiguous.** `1234567890` could be an EU VAT ID, a local tax number of a non-VAT-registered business, or neither. Display, indexing policy, and future VIES validation all depend on knowing which.
4. **No read-only snapshot render exists.** Snapshots render exclusively through `AddressEditor`, which takes no `disabled` prop — deployments that lock document addresses (`order_address_editable_statuses = []`) show an editable form for read-only data.
5. **(Fixed, PR #69)** `normalizeAddressDraft` rebuilt the snapshot from the editor's twelve fields on save, silently destroying every key the editor cannot show.

## Proposed Solution

Model the contact details as **optional fields on `AddressValue`**, rendered by `AddressView` as a trailing contact block that is **opt-in per field via caller-supplied labels** — omit `contactLabels` and the component is byte-identical to today. `formatAddressContactPairs(address, labels)` is exported so callers can ask "anything to show?" without rendering. The **document snapshot is the carrier**: it already persists the keys, is encrypted at rest, and is the frozen per-document fact. Tax ids carry a `taxIdType`; EU VAT IDs are normalized to the ISO-2-prefixed form on write by the emitting integration.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Contact block outside `formatAddressLines` | `formatAddressString` joins lines with `", "` into picker labels and table cells; a tax id spliced into `"Baker Street 10, NW1 London"` is wrong in every one. A test pins postal-line purity. |
| Labels-as-opt-in, caller-translated | The util module is deliberately i18n-free; callers have `useT()`. Also enables phone-without-tax-id (the common delivery-address case). |
| Snapshot as carrier, not typed columns | Snapshots have the data (99.6% of 1.42M prod orders); `sales_document_addresses` has 6 rows and would need columns + write paths + backfill for nothing. |
| `taxIdType` minimal enum | Widens additively; no non-EU data justifies the Stripe-shaped list today. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Columns on `sales_document_addresses` | Wrong path twice over: no data flows there (6 prod rows), and the document-level frozen fact lives in the snapshot. This was PR #66's original wiring; it rendered nothing. |
| Splice contacts into `formatAddressLines` | Corrupts every one-line summary downstream. |
| Bare `taxId: string`, type later | The one decision that is expensive to walk back once frozen; ambiguity documented in Problem 3. |
| Hardcoded translated labels in the util | Breaks the module's i18n-free contract; forces all-or-nothing field display. |

## User Stories / Use Cases

- An **operations user** viewing an imported order sees the phone the courier should call, on the delivery address that carries it.
- An **accountant** sees the tax id a B2B invoice was issued under, on the billing address, exactly as frozen at document time.
- A **third-party module author** calls `AddressView` exactly as before and observes zero change until they opt in with labels.

## Architecture

Data flow (read): `integration → *_address_snapshot (jsonb, encrypted at rest per sales/encryption.ts) → document detail UI → AddressView contact block`.
Data flow (write/edit): `AddressEditor draft → normalizeAddressDraft(draft, previousSnapshot) → snapshot` — unowned keys merged back (PR #69).

No new commands, events, routes, or DI registrations. The snapshot rides the existing order/quote update payload. Cross-module surface: `customers` owns the util, `sales` consumes it, `ui` holds the byte-identical twin (kept in sync here; collapsing them is out of scope, Q12).

## Data Models

### Address snapshot (informal contract — schema stays `z.record(z.string(), z.unknown())`)

Documented well-known keys, all optional strings: the nine postal fields (unchanged), plus `phone`, `email`, `taxId`, `taxIdType` (`'eu_vat' | 'local' | 'other'`), Phase 3: `recipientName`. Unknown keys MUST survive an editor round-trip (PR #69's guarantee).

### `AddressValue` (type, frozen surface)

Adds optional `phone`, `email`, `taxId`, `taxIdType`, later `recipientName` — additive, all `?: string | null`.

### `CustomerAddress` (Phase 3, additive migration)

`recipient_name text NULL`, `phone text NULL`. Both declared in `customers` `defaultEncryptionMaps` with reads through `findWithDecryption`; if phone becomes equality-searchable it declares a sibling `hashField`. No tax-id column on `CustomerAddress` — customer-level tax id stays where it is (master on the customer entity), per Q6.

## API Contracts

No new endpoints; no request/response shape changes. `addressSnapshotSchema` deliberately stays free-form — constraining it would break the very integrations this feature serves. The documented-keys table above is the contract.

## Internationalization (i18n)

`sales.documents.detail.addresses.{taxId,phone,email}` in `en`, `pl`, `de`, `es`, `ko` (exists on the branch). Phase 3 adds `recipientName`.

## UI/UX

- Contact block under the shipping/billing tiles as `text-xs text-muted-foreground` label–value lines; self-hiding when the address carries nothing.
- Phase 1 adds a **read-only snapshot view**: when the document is locked, render `AddressView` (postal + contact) instead of `AddressEditor`.
- DS rules apply: semantic tokens only, shared primitives, no new inline comments.
- The UI phase MUST remove `// @ts-nocheck` from `AddressesSection.tsx` (13 pre-existing errors to fix) or, failing that, MUST NOT be accepted on eyeball-only review — the file is invisible to `tsc`.

## Migration & Backward Compatibility

- **Everything in Phases 0–2 is additive.** No DB migration; snapshots are schemaless. With no `contactLabels` supplied, `AddressView` output is byte-identical — pinned by test.
- **New frozen exports**: `formatAddressContactPairs`, `AddressContactLabels` freeze on merge per `BACKWARD_COMPATIBILITY.md`; this spec is the required reference.
- **`name` → `label` rename (Q9, Phase 4)** follows the deprecation protocol: add `label`, keep `name` as a deprecated bridge for ≥1 minor, `@deprecated` JSDoc with target removal version, `UPGRADE_NOTES.md` entry. Snapshot storage keys are untouched.
- **Phase 3 migration** is additive nullable columns — deployable without downtime, safely re-runnable.
- **No core backfill.** Existing snapshots keep whatever they carry; integrations that want the fields on historical documents re-emit them (the motivating deployment re-runs its sync, which re-reads every document).

## Implementation Plan

### Phase 0 — snapshot key preservation *(shipped: PR #69)*
`normalizeAddressDraft` merges back keys outside the twelve it owns; cleared address still normalizes to `null`.

### Phase 1 — contact fields, render, read-only view *(branch `feat/address-contact-fields-render` / PR #66 carries over)*
1. `AddressValue` + `formatAddressContactPairs` + `AddressView` contact block (done on branch, incl. postal-purity and self-hiding tests).
2. Wire to the shipping/billing snapshot tiles (done on branch).
3. Add `taxIdType` to the type and the pair-formatter (pending Q3/Q4 call).
4. Read-only snapshot view for locked documents.
5. Lift `// @ts-nocheck` from `AddressesSection.tsx`.

### Phase 2 — tax-id semantics
1. `normalizeEuVatId()` util (ISO-2-prefix on write) for emitting integrations.
2. Type-aware display gate per Q7; align search config so `eu_vat` may index where `local`/`other` stay `hashOnly`/excluded.

### Phase 3 — recipient name + customer address book *(separable)*
1. `recipientName` on `AddressValue`/`AddressView`; `recipient_name`, `phone` columns on `CustomerAddress` with encryption-map entries.
2. `TC-CRM-CRUDFORM-*` sweep update for the new editable fields.

### Phase 4 — rename + docs
1. `name` → `label` bridge per Migration section; `BACKWARD_COMPATIBILITY.md` + `UPGRADE_NOTES.md` entries.

## Integration Coverage

Unit (`packages/core`, exists on branch): postal lines unchanged when contacts present (**the safety property**); per-field label gate; null-render preserved; snapshot round-trip keeps unowned keys.

Route/UI level (Phase 1): `packages/core/src/modules/sales/__integration__/TC-SALES-ADDR-CONTACT-001.spec.ts` — order created via API with a snapshot carrying `phone`/`taxId`; detail page renders both; editor save round-trips them; locked document shows the read-only view. Self-contained fixtures, no seeded data.

Phase 3: `TC-CRM-CRUDFORM-*` proves `recipient_name`/`phone` save-and-reload on customer address create + update.

## Risks & Impact Review

Write operations are limited to the existing document-update path (Phase 0/1) and one additive migration (Phase 3); no events, no cross-module writes, tenant scoping unchanged (snapshots live on tenant-scoped rows, encrypted at rest).

#### Tax id shown to under-privileged users
- **Scenario**: A personal (non-VAT) tax number renders in the document detail to a user who shouldn't see PII.
- **Severity**: Medium
- **Affected area**: sales document detail
- **Mitigation**: type-aware gate (Q7) before anything beyond the locked read-only view ships; `local`/`other` behind the existing PII feature.
- **Residual risk**: `eu_vat` renders ungated by design — it is a public identifier (VIES).

#### Editor merge-back resurrects a stale key
- **Scenario**: Integration updates the snapshot while a user edits; save merges the user's postal fields with the pre-edit contact keys.
- **Severity**: Low
- **Affected area**: document addresses tab
- **Mitigation**: document-level optimistic locking already rejects the stale save (409).
- **Residual risk**: none beyond existing conflict UX.

#### Frozen enum too small
- **Scenario**: A `gb_vat`-class need appears after `taxIdType` freezes.
- **Severity**: Low
- **Mitigation / Residual**: enums widen additively under the BC contract; a second small migration is the accepted trade-off, recorded in Q3/Q4.

#### Rename breaks third-party address consumers
- **Scenario**: A module reads `name` from the API after Phase 4 removal.
- **Severity**: Medium
- **Affected area**: customers + sales address APIs
- **Mitigation**: ≥1-minor bridge, `@deprecated` JSDoc, `UPGRADE_NOTES.md`; storage keys unchanged.
- **Residual risk**: consumers that ignore deprecation warnings break at the announced removal — accepted per protocol.

## Final Compliance Report — 2026-08-10

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/skills/om-spec-writing/SKILL.md` + references

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| BACKWARD_COMPATIBILITY.md | Contract-surface change references a spec with Migration & BC section | Compliant | This document |
| BACKWARD_COMPATIBILITY.md | DB schema additive-only | Compliant | Phase 3 nullable columns only |
| om-spec-writing checklist | PII/address/contact columns declare encryption maps + `findWithDecryption` | Compliant (design) | Phase 3 columns declared; snapshots already encrypted |
| root AGENTS.md | Integration coverage listed per affected API/UI path, ships with the change | Compliant | §Integration Coverage |
| root AGENTS.md | No inline comments / self-documenting code | Compliant | Branch cleaned in `9841df8d5` |
| .ai/specs/AGENTS.md | Naming `{YYYY-MM-DD}-{kebab}.md`, no `SPEC-*` prefix | Compliant | |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Snapshot keys ↔ documented contract |
| API contracts match UI/UX | Pass | Render-only; no shape change |
| Risks cover all write operations | Pass | Save path + Phase 3 migration |
| Commands defined for all mutations | Pass | No new mutations |

### Non-Compliant Items
None at spec level.

### Verdict
**Blocked — Open Questions Q0 and Q3/Q4 must be resolved before implementation proceeds past Phase 0.** All other sections are implementation-ready.

## Changelog

### 2026-08-10
- Initial specification, following review of PR #66 by @maxidragon and @jtomaszewski. Phase 0 shipped as PR #69; Phase 1 exists on `feat/address-contact-fields-render` pending Q3/Q4.
