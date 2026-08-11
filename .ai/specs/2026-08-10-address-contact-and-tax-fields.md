# Address-Level Contact Details and Tax Identifiers

## TLDR

**Key Points:**
- An address in Open Mercato cannot carry a phone number or a tax identifier. `AddressValue` models nine postal fields, and every formatter and renderer derives from those.
- Both are ordinary requirements of order fulfilment. A carrier needs a contact number to deliver — mandatory for parcel-locker and pickup-point delivery. A B2B invoice address is incomplete without the tax identifier the document was issued under, and under the EU OSS scheme the destination country and the buyer's VAT-registration status decide the rate.
- They belong on the **address**, not on the customer: one customer keeps several addresses, each with its own recipient and its own contact. Shopify, Medusa and commercetools all model a phone on the address; Open Mercato is the outlier that does not.

**Proposed solution:**
- Additive optional fields on `AddressValue` (`phone`, `taxId`, `taxIdType`), rendered by `AddressView` as an opt-in contact block — omit the labels and output is byte-identical to today.
- On the sales side the document address snapshot is the carrier. It is already schemaless and encrypted at rest, so no schema change is needed there; customer-address columns arrive later and additively.

**Scope:**
- `AddressValue` contact fields + opt-in `AddressView` contact block
- Tax-id typing (`taxIdType`) and EU-VAT normalization on write
- Read-only snapshot view for locked documents
- Type-aware indexing/display policy for tax ids
- `name` → `label` rename on address entities (deprecation protocol)

**Concerns:**
- Two new frozen exports (`formatAddressContactPairs`, `AddressContactLabels`) per `BACKWARD_COMPATIBILITY.md` — this spec is the reference its §"Spec requirement" demands.
- Tax ids are PII-adjacent and already treated as sensitive by search (`customers/search.ts:713`, `:805`).
- `AddressesSection.tsx` carries `// @ts-nocheck` (13 pre-existing type errors) — everything added there is unchecked by CI until that is lifted.

## Overview

Open Mercato models an address as nine postal fields and nothing else. That is enough to print a label and not enough to fulfil an order: no phone for the carrier, no tax identifier for the invoice. Both are routine facts about an address in commerce, and both are already modelled by every comparable platform.

The gap is felt by any deployment that ships physical goods (a delivery without a contact number fails at the door, and cannot be sent to a parcel locker at all) or sells to businesses (an invoice address without its tax identifier is commercially, and in most EU jurisdictions legally, incomplete).

> **Market Reference**
>
> | Platform | `phone` on the address | `email` on the address | Tax identifier |
> |---|---|---|---|
> | [Shopify `MailingAddress`](https://shopify.dev/docs/api/admin-graphql/latest/objects/MailingAddress) | yes (with `company`) | no | on the customer / order |
> | [Medusa v2 `Address`](https://docs.medusajs.com/v1/references/entities/classes/Address) | yes (with `address_name`, `first_name`/`last_name`) | no | — |
> | [commercetools `Address`](https://docs.commercetools.com/api/types) | yes (with `mobile`, `fax`) | yes | — |
> | [Stripe](https://docs.stripe.com/billing/customer/tax-ids) | — | — | `tax_id` value + `type` enum, held as a **list** on the customer and rendered onto invoices |
> | **Open Mercato** | **no** | **no** | **no** |
>
> **Adopted:** a phone on the address (universal); a tax identifier carrying an explicit type (Stripe). Stripe is also the precedent for Q6 — the customer owns the identifier, the document freezes the value it was issued under.
>
> **Rejected:** an email on the address — two of the three commerce platforms deliberately keep it on the order, and an order-level email is the better home (see Q2); splicing contact details into the postal address lines — nobody does this, and it corrupts every one-line summary built from those lines.

**Touched:** `packages/core/src/modules/customers/utils/addressFormat.tsx`, `packages/ui/src/backend/detail/addressFormat.tsx` (byte-identical twin), `packages/core/src/modules/sales/components/documents/AddressesSection.tsx`, sales i18n (5 locales), Phase 3 only: `customers` address entities + migration.

**Not touched:** `sales_document_addresses` schema (explicitly rejected — see Alternatives), `addressSnapshotSchema` (stays free-form), search indexing config outside the tax-id rules, per-country address formats, VIES calls, address filterability (blocked by encryption at rest), `buildingNumber`/`flatNumber` logic (house numbers are conventionally written into the street line, and the field is near-empty in practice — see Appendix).

## Problem Statement

1. **The fields cannot be modelled.** `AddressValue` has nine postal fields; `formatAddressJson` / `formatAddressLines` / `formatAddressString` / `AddressView` all derive from those. There is nowhere to put a phone number.
2. **The fields cannot be shown.** On the sales side the document address snapshot is schemaless jsonb, so an integration posting `{ addressLine1, city, phone, taxId }` **does** get those keys persisted today — they simply have no read path, and render as if absent.
3. **Contact details are per-address, not per-customer.** One customer has a home address, an office address and a warehouse, each with a different person to call. Holding one phone on the customer answers the wrong question.
4. **A bare tax identifier is ambiguous.** `1234567890` may be a Polish NIP, an EU VAT number missing its country prefix, or a local tax number of a business that is not VAT-registered at all. Stripe treats these as *distinct types* (`pl_nip` vs `eu_vat`, examples `1234567890` vs `PL1234567890`) precisely because display, tax calculation and validation all diverge on the answer.
5. **Locked documents render an editor.** Address snapshots render exclusively through `AddressEditor`, which takes no `disabled` prop. A deployment that locks document addresses (`order_address_editable_statuses = []`) shows an editable form over read-only data.
6. **Unknown snapshot keys did not survive a save.** `normalizeAddressDraft` rebuilt the snapshot from the twelve fields the editor models, destroying every other key on the first manual save — silent data loss for exactly the keys this feature depends on. *(Fixed; see Phase 0.)*

## Proposed Solution

Model the contact details as **optional fields on `AddressValue`**, rendered by `AddressView` as a trailing contact block that is **opt-in per field via caller-supplied labels** — omit `contactLabels` and the component is byte-identical to today. `formatAddressContactPairs(address, labels)` is exported so callers can ask "anything to show?" without rendering. On the sales side the **document snapshot is the carrier**: it already persists the keys, is encrypted at rest, and is the frozen per-document fact. Tax identifiers carry a `taxIdType`; EU VAT numbers are normalized to the ISO-2-prefixed form on write.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Contact block outside `formatAddressLines` | `formatAddressString` joins lines with `", "` into picker labels and table cells; a tax id spliced into `"Baker Street 10, NW1 London"` is wrong in every one. A test pins postal-line purity. |
| Labels-as-opt-in, caller-translated | The util module is deliberately i18n-free; callers have `useT()`. Also enables phone-without-tax-id, which is the common delivery-address case. |
| Snapshot as carrier on the sales side, not typed columns | The snapshot is where the per-document value is frozen and where integrations already write. Typed columns would need a write path and a backfill to reach the same place. |
| Tax identifier carries an explicit type | Follows Stripe; without it the value cannot be interpreted, validated or gated. Shape is Q3/Q4. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Columns on `sales_document_addresses` | Wrong on two counts: the per-document frozen fact belongs on the snapshot, and that table is a document's *additional* address list, which most deployments never populate. |
| Splice contacts into `formatAddressLines` | Corrupts every one-line summary downstream — picker options, entry labels, table cells. |
| Bare `taxId: string`, type added later | The identifier is uninterpretable without its type, and the field freezes as public surface on merge. |
| `email` on the address | Two of three comparable platforms hold it on the order instead; see Q2. |
| Hardcoded translated labels in the util | Breaks the module's i18n-free contract and forces all-or-nothing field display. |

## Open Questions

*Scaffolding — to be resolved and removed before this spec is finalized.* **Q0 and Q3/Q4 block implementation past Phase 0**; the rest carry a recommendation and default to it if unchallenged.

- **Q0 — one spec or two?** Does this bundle two independently deployable capabilities, contact-detail rendering and tax-id semantics? *Recommendation: one spec, phased.* Both freeze the same `AddressValue` surface, so splitting would commit to `taxId: string` in the first and regret it in the second. The phases below are independently shippable, which captures the split's benefit without the surface risk.

- **Q3/Q4 — the shape of `taxIdType`.** *Presented as a genuine fork; no recommendation.* This one is architectural and worth your call.

  | | **(a) Stripe-shaped `{country}_{kind}`** | **(b) Minimal `eu_vat \| local \| other`** |
  |---|---|---|
  | Seed values | `eu_vat`, `pl_nip`, `other`, widened as observed | the three, fixed |
  | For | Matches the industry vocabulary; distinguishes `pl_nip` from `eu_vat`, which is the ambiguity in Problem 4; widens naturally one country at a time | Smallest surface to freeze; nothing speculative |
  | Against | More public surface committed up front for cases not yet observed | `local` is uninterpretable without a country, and `country` is unconstrained free text (Q8, deferred) — so the ambiguity moves rather than resolves |

  *Note:* an earlier comment on PR #66 recommended (b). Reading Stripe's actual type table — where `pl_nip` and `eu_vat` are separate types with exactly the `1234567890` / `PL1234567890` examples — weakened that argument enough to withdraw the recommendation rather than defend it.

- **Q7 — is displaying a tax identifier ACL-gated?** *Recommendation: type-aware, matching what search already does.* An EU VAT number is a public business identifier (VIES is an open lookup) and renders ungated; a local or personal tax number renders only behind the customer-PII feature the deployment already applies to `tax_id`. Exact feature id settled in Phase 2 review.

- **Q9 — rename `name` to `label`.** `name` on address entities is the address *label* ("Home", "Warehouse"); putting a recipient name beside it is a trap. Medusa makes the same split explicitly — `address_name` for the label, `first_name`/`last_name` for the person. *Recommendation: rename under the deprecation protocol* (bridge both for ≥1 minor, `UPGRADE_NOTES.md` entry); snapshot storage keys are untouched and the bridge maps them.

- **Q1 refinement — one `recipientName`, or `firstName`/`lastName`?** Shopify and Medusa both split the person into two fields. Splitting is better for salutation and sorting; a single field is friendlier to sources that only ever supply a full name. *Recommendation: single `recipientName` in Phase 3, since `AddressValue` has no person field at all today and splitting can be layered additively.*

**Resolved on the evidence, no longer open:**

- **Q2 — email is dropped from `AddressValue`.** Shopify and Medusa both keep email off the address and hold it on the order/customer; only commercetools carries it on the address. Two of three, plus the fact that a delivery email is a per-order rather than per-address fact, is enough to leave it out rather than freeze a contested field. Scope shrinks to `phone` + `taxId` + `taxIdType`.
- **Q5** — normalize EU VAT to the ISO-2-prefixed form on write. Stripe validates `eu_vat` against VIES and `gb_vat` against HMRC on exactly that form, so normalizing makes any future validation a pass-through.
- **Q6** — the customer is the master of a tax identifier; the document freezes the value it was issued under. This is Stripe's model (identifiers live on the customer as a list, and are rendered onto invoice PDFs).
- **Q8** (`country` constraint — separate change), **Q10** (read-only snapshot view — Phase 1), **Q11** (no core backfill), **Q12** (the duplicate `addressFormat.tsx` copies — out of scope).

## User Stories / Use Cases

- A **warehouse operator** dispatching an order sees the phone the carrier needs, on the delivery address that carries it — not a number belonging to a different address of the same customer.
- An **accountant** sees the tax identifier a B2B invoice was issued under, on the billing address, exactly as frozen at document time.
- An **integration author** posting an address with a phone number sees it rendered, and sees it survive a subsequent manual edit.
- A **third-party module author** calls `AddressView` exactly as before and observes zero change until they opt in with labels.

## Architecture

Data flow (read): `writer → *_address_snapshot (jsonb, encrypted at rest per sales/encryption.ts) → document detail UI → AddressView contact block`.
Data flow (write/edit): `AddressEditor draft → normalizeAddressDraft(draft, previousSnapshot) → snapshot` — keys the editor does not own are merged back rather than dropped (Phase 0).

No new commands, events, routes, or DI registrations. The snapshot rides the existing order/quote update payload. Cross-module surface: `customers` owns the util, `sales` consumes it, `ui` holds the byte-identical twin (kept in sync here; collapsing them is out of scope, Q12).

## Data Models

### Address snapshot (informal contract — schema stays `z.record(z.string(), z.unknown())`)

Documented well-known keys, all optional strings: the nine postal fields (unchanged), plus `phone`, `taxId`, `taxIdType` (shape per Q3/Q4), and in Phase 3 `recipientName`. Unknown keys MUST survive an editor round-trip (Phase 0's guarantee).

### `AddressValue` (type, frozen surface)

Adds optional `phone`, `taxId`, `taxIdType`, later `recipientName` — additive, all `?: string | null`.

### `CustomerAddress` (Phase 3, additive migration)

`recipient_name text NULL`, `phone text NULL`. Both declared in `customers` `defaultEncryptionMaps` with reads through `findWithDecryption`; if phone becomes equality-searchable it declares a sibling `hashField`. No tax-id column on `CustomerAddress` — customer-level tax id stays where it is (master on the customer entity), per Q6.

## API Contracts

No new endpoints; no request/response shape changes. `addressSnapshotSchema` deliberately stays free-form — constraining it would break the very integrations this feature serves. The documented-keys table above is the contract.

## Internationalization (i18n)

`sales.documents.detail.addresses.{taxId,phone}` in `en`, `pl`, `de`, `es`, `ko`. The corresponding `…addresses.email` key is removed in Phase 1 along with the field (Q2). Phase 3 adds `recipientName`.

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
- **No core backfill.** Existing snapshots keep whatever they carry; a writer that wants the fields on historical documents re-emits them.

## Implementation Plan

### Phase 0 — snapshot key preservation *(shipped, PR #69)*
`normalizeAddressDraft` merges back keys outside the twelve it owns; cleared address still normalizes to `null`.

### Phase 1 — contact fields, render, read-only view *(PR #66)*
1. `AddressValue` + `formatAddressContactPairs` + `AddressView` contact block, with postal-purity and self-hiding tests.
2. Wire to the shipping/billing snapshot tiles.
3. Add `taxIdType` to the type and the pair-formatter (pending the Q3/Q4 call).
4. Remove `email` from the field set and from the five locale files (see Q2).
5. Read-only snapshot view for locked documents.
6. Lift `// @ts-nocheck` from `AddressesSection.tsx`.

### Phase 2 — tax-id semantics
1. `normalizeEuVatId()` util — ISO-2 prefix on write.
2. Type-aware display gate per Q7; align search config so a public VAT number may index where local/personal numbers stay `hashOnly` or excluded.

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

#### Frozen enum too small, or too coarse
- **Scenario**: Under option (b), a value typed `local` cannot be interpreted because `country` is unconstrained free text; under either option, a tax-id class appears that the seeded set does not name.
- **Severity**: Low
- **Affected area**: tax-id display, future validation
- **Mitigation**: enums widen additively under the BC contract; the coarseness risk is the explicit trade-off recorded in Q3/Q4 and is one input to that decision.
- **Residual risk**: a second small migration, accepted.

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
| root AGENTS.md | No inline comments / self-documenting code | Compliant | |
| om-spec-writing SKILL | Challenge the design against OSS market leaders | Compliant | §Overview → Market Reference, four platforms, sourced |
| .ai/specs/AGENTS.md | Naming `{YYYY-MM-DD}-{kebab}.md`, no `SPEC-*` prefix | Compliant | |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Snapshot keys ↔ documented contract |
| API contracts match UI/UX | Pass | Render-only; no shape change |
| Risks cover all write operations | Pass | Save path + Phase 3 migration |
| Commands defined for all mutations | Pass | No new mutations |
| Field set consistent after dropping `email` | Pass | TLDR, Data Models, Phases and Integration Coverage all read `phone` + `taxId` + `taxIdType` |

### Non-Compliant Items
None at spec level.

### Verdict
**Blocked — Open Questions Q0 and Q3/Q4 must be resolved before implementation proceeds past Phase 0.** All other sections are implementation-ready.

## Appendix — field prevalence in one production dataset

The justification above stands on the market comparison, not on any single deployment. These figures are offered only as evidence that the fields are **populated in practice** rather than theoretically useful, measured on one production e-commerce dataset of ~1.4M orders whose documents originate in an external system of record:

| Signal | Coverage |
|---|---|
| Phone on the document address | 99.7% |
| Tax identifier on the document billing address (placeholders excluded) | 12.9% of orders |
| Tax identifier at customer level | 5.6% of customers |

Two observations that shaped decisions above: the order-level tax-id rate exceeds the customer-level rate because business buyers reorder more often (an input to Q6), and `buildingNumber` was populated on ~1% of addresses because house numbers are conventionally written into the street line — which is why this spec adds no further logic there.

## Changelog

### 2026-08-10
- Initial specification.
- Reframed after review: the driver is now the general commerce gap — every comparable platform models a phone on the address and Open Mercato does not — with the single-deployment measurements demoted to an appendix. Open Questions moved below Problem Statement and Proposed Solution. `email` dropped from the field set on market evidence (Q2). The `taxIdType` shape (Q3/Q4) is presented as an open fork after Stripe's type table showed `pl_nip` and `eu_vat` to be distinct types, withdrawing an earlier recommendation for a minimal enum.
