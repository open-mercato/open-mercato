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
- Locked documents render a disabled editor instead of an editable one
- Type-aware indexing/display policy for tax ids
- `name` → `label` rename on address entities (deprecation protocol)

**Concerns:**
- Two new frozen exports (`formatAddressContactPairs`, `AddressContactLabels`) per `BACKWARD_COMPATIBILITY.md` — this spec is the reference its §"Spec requirement" demands.
- Tax ids are PII-adjacent and already treated as sensitive by search (`customers/search.ts:713`, `:805`).
- `AddressesSection.tsx` carries `// @ts-nocheck` — the file is invisible to `tsc`, so everything added there is unchecked by CI until the directive is lifted.

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
> **Adopted:** a phone on the address (universal); a tax identifier carrying an explicit type (Stripe). Stripe is also the precedent for the ownership split — the customer owns the identifier, the document freezes the value it was issued under.
>
> **Rejected:** an email on the address — two of the three commerce platforms deliberately keep it on the order, and an order-level email is the better home; splicing contact details into the postal address lines — nobody does this, and it corrupts every one-line summary built from those lines.

**Touched:** `packages/core/src/modules/customers/utils/addressFormat.tsx`, `packages/ui/src/backend/detail/addressFormat.tsx` (near-identical twin — the two files differ only in the import and the `AddressFormatStrategy` alias, so they must be edited in parallel rather than copied over one another), `packages/core/src/modules/sales/components/documents/AddressesSection.tsx`, sales i18n (5 locales), Phase 3 only: `customers` address entities + migration.

**Not touched:** `sales_document_addresses` schema (explicitly rejected — see Alternatives), `addressSnapshotSchema` (stays free-form), search indexing config outside the tax-id rules, per-country address formats, VIES calls, address filterability (blocked by encryption at rest), `buildingNumber`/`flatNumber` logic (house numbers are conventionally written into the street line, and the field is near-empty in practice — see Appendix).

## Problem Statement

1. **The fields cannot be modelled.** `AddressValue` has nine postal fields; `formatAddressJson` / `formatAddressLines` / `formatAddressString` / `AddressView` all derive from those. There is nowhere to put a phone number.
2. **The fields cannot be shown.** On the sales side the document address snapshot is schemaless jsonb, so an integration posting `{ addressLine1, city, phone, taxId }` **does** get those keys persisted today — they simply have no read path, and render as if absent.
3. **Contact details are per-address, not per-customer.** One customer has a home address, an office address and a warehouse, each with a different person to call. Holding one phone on the customer answers the wrong question.
4. **A bare tax identifier is ambiguous.** `1234567890` may be a Polish NIP, an EU VAT number missing its country prefix, or a local tax number of a business that is not VAT-registered at all. Stripe treats these as *distinct types* (`pl_nip` vs `eu_vat`, examples `1234567890` vs `PL1234567890`) precisely because display, tax calculation and validation all diverge on the answer.
5. **Locked documents render an editable editor.** `AddressEditor` does accept a `disabled` prop (`customers/components/AddressEditor.tsx:82`, and its `ui` twin at `:97`), but neither snapshot call site passes it (`AddressesSection.tsx:1070`, `:1137`) — while every sibling control in that component is already locked (`:1057`, `:1082`, `:1113`, `:1132`) and a `lockedReason` banner renders above them at `:1018-1026`. A deployment that locks document addresses (`order_address_editable_statuses = []`) therefore presents a fully editable form over data the API will refuse to change.
6. **Unknown snapshot keys do not survive a save.** `normalizeAddressDraft` (`AddressesSection.tsx:78-99`) rebuilds the snapshot from the twelve fields the editor models, destroying every other key on the first manual save — silent data loss for exactly the keys this feature depends on. A second copy of the helper exists on `SalesDocumentForm.tsx:438-459`, but that component is mounted only by `backend/sales/documents/create/page.tsx` and submits through `createCrud`: on a document that does not exist yet there is no prior snapshot to preserve, so the defect is not reachable there. The duplication is worth collapsing on its own merits; it is not a second instance of this bug. *(Outstanding in this repository — Phase 0.)*

## Proposed Solution

Model the contact details as **optional fields on `AddressValue`**, rendered by `AddressView` as a trailing contact block that is **opt-in per field via caller-supplied labels** — omit `contactLabels` and the component is byte-identical to today. `formatAddressContactPairs(address, labels)` is exported so callers can ask "anything to show?" without rendering. On the sales side the **document snapshot is the carrier**: it already persists the keys, is encrypted at rest, and is the frozen per-document fact. Tax identifiers carry a `taxIdType`; EU VAT numbers are normalized to the ISO-2-prefixed form on write.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Contact block outside `formatAddressLines` | `formatAddressString` joins lines with `", "` into picker labels and table cells; a tax id spliced into `"Baker Street 10, NW1 London"` is wrong in every one. A test pins postal-line purity. |
| Labels-as-opt-in, caller-translated | The util module is deliberately i18n-free; callers have `useT()`. Also enables phone-without-tax-id, which is the common delivery-address case. |
| Snapshot as carrier on the sales side, not typed columns | The snapshot is where the per-document value is frozen and where integrations already write. Typed columns would need a write path and a backfill to reach the same place. |
| Tax identifier carries an explicit type | Follows Stripe; without it the value cannot be interpreted, validated or gated. Shape is `{country}_{kind}` — see Design Decisions. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Columns on `sales_document_addresses` | Wrong on two counts: the per-document frozen fact belongs on the snapshot, and that table holds a document's *additional* addresses — it is not where the primary shipping and billing addresses live, so columns there would not reach the addresses this feature is about. |
| A new read-only render path for locked documents | Rejected as a standalone step. `AddressEditor` already accepts `disabled`, so `disabled={locked}` at `AddressesSection.tsx:1070` and `:1137` — beside the `locked` value that already flows to every sibling control — delivers the stated outcome in two lines with no second rendering path to keep in step. A read-only `AddressView` summary would read better than greyed-out inputs and stays open as a later improvement; it is not a prerequisite for the contact block, which renders beside the editor either way. |
| Splice contacts into `formatAddressLines` | Corrupts every one-line summary downstream — picker options, entry labels, table cells. |
| Bare `taxId: string`, type added later | The identifier is uninterpretable without its type, and the field freezes as public surface on merge. |
| `email` on the address | Two of three comparable platforms hold it on the order instead; see Design Decisions. |
| Hardcoded translated labels in the util | Breaks the module's i18n-free contract and forces all-or-nothing field display. |

## Design Decisions Taken During Review

Every question raised while this spec was drafted is settled. They are recorded with their reasoning because each one constrains an implementation phase below.

- **Scope — one spec, phased.** Contact-detail rendering and tax-id semantics freeze the same `AddressValue` surface, so splitting them would commit to a bare `taxId: string` in the first spec and regret it in the second. The phases below are independently shippable, which is what a split would have bought.

- **`taxIdType` is Stripe-shaped `{country}_{kind}`, seeded `eu_vat`, `pl_nip`, `other`, widened one case at a time as they are observed.** A minimal `eu_vat | local | other` enum was considered and rejected: `local` cannot be interpreted without a constrained country, `country` stays unconstrained free text (see the deferred-work list below), and the display gate would then have nothing reliable to key on — so the ambiguity in Problem 4 would move rather than resolve. The larger seed set is a smaller commitment than it looks, because the backward-compatibility contract makes these enums additive-only; only the seed values freeze. It also makes the display gate implementable immediately.

- **Displaying a tax identifier is gated by type.** An EU VAT number is a public business identifier — VIES is an open lookup — and renders ungated; a local or personal tax number renders only behind the customer-PII feature the deployment already applies to `tax_id`. This is the split `customers/search.ts:713` (`excluded` for people) and `:805` (`hashOnly` for companies) already draws. Exact feature id settled in Phase 2 review.

- **`name` → `label` on address entities, under the deprecation protocol.** `name` is the address *label* ("Home", "Warehouse"); putting a recipient name beside it is a trap. Medusa makes the same split explicitly — `address_name` for the label, `first_name`/`last_name` for the person. Bridge both for ≥1 minor with an `UPGRADE_NOTES.md` entry; snapshot storage keys are untouched and the bridge maps them.

- **One `recipientName`, not `firstName`/`lastName`.** Shopify and Medusa both split the person in two, which is better for salutation and sorting, but `AddressValue` has no person field at all today and a split can be layered additively later. A single field is also friendlier to sources that only ever supply a full name.

- **`email` is not added to `AddressValue`.** Shopify and Medusa keep email off the address and hold it on the order/customer; only commercetools carries it on the address. Two of three, plus the fact that a delivery email is a per-order rather than per-address fact, is enough not to freeze a contested field. Scope is `phone` + `taxId` + `taxIdType`.

- **EU VAT is normalized to the ISO-2-prefixed form on write.** Stripe validates `eu_vat` against VIES and `gb_vat` against HMRC on exactly that form, so normalizing makes any future validation a pass-through.

- **The customer is the master of a tax identifier; the document freezes the value it was issued under.** This is Stripe's model — identifiers live on the customer as a list and are rendered onto invoice PDFs.

**Deliberately deferred, not part of any phase here:** constraining `country` to ISO-3166-2 (load-bearing under OSS, but its own blast radius); collapsing the two `addressFormat.tsx` copies into one module; any core backfill of existing snapshots.

## User Stories / Use Cases

- A **warehouse operator** dispatching an order sees the phone the carrier needs, on the delivery address that carries it — not a number belonging to a different address of the same customer.
- An **accountant** sees the tax identifier a B2B invoice was issued under, on the billing address, exactly as frozen at document time.
- An **integration author** posting an address with a phone number sees it rendered, and sees it survive a subsequent manual edit.
- A **third-party module author** calls `AddressView` exactly as before and observes zero change until they opt in with labels.

## Architecture

Data flow (read): `writer → *_address_snapshot (jsonb, encrypted at rest per sales/encryption.ts) → document detail UI → AddressView contact block`.
Data flow (write/edit), **after Phase 0**: `AddressEditor draft → normalizeAddressDraft(draft, previousSnapshot) → snapshot` — keys the editor does not own are merged back rather than dropped. Today the helper takes the draft alone and drops them, on both the document detail and the document form paths.

No new commands, events, routes, or DI registrations. The snapshot rides the existing order/quote update payload. Cross-module surface: `customers` owns the util, `sales` consumes it, `ui` holds the near-identical twin (edited in parallel here; collapsing the two into one module is deferred).

## Data Models

### Address snapshot (informal contract — schema stays `z.record(z.string(), z.unknown())`)

Documented well-known keys, all optional strings: the nine postal fields (unchanged), plus `phone`, `taxId`, `taxIdType` (Stripe-shaped `{country}_{kind}`), and in Phase 3 `recipientName`. Unknown keys MUST survive an editor round-trip — a guarantee Phase 0 establishes and which does not hold today.

### `AddressValue` (type, frozen surface)

Adds optional `phone`, `taxId`, `taxIdType`, later `recipientName` — additive, all `?: string | null`.

### `CustomerAddress` (Phase 3, additive migration)

`recipient_name text NULL`, `phone text NULL`. Both declared in `customers` `defaultEncryptionMaps` with reads through `findWithDecryption`; if phone becomes equality-searchable it declares a sibling `hashField`. No tax-id column on `CustomerAddress` — the customer entity stays master of the identifier.

## API Contracts

No new endpoints; no request/response shape changes. `addressSnapshotSchema` deliberately stays free-form — constraining it would break the very integrations this feature serves. The documented-keys table above is the contract.

## Internationalization (i18n)

Two keys added: `sales.documents.detail.addresses.{taxId,phone}` in `en`, `pl`, `de`, `es`, `ko`. No existing key is removed. Phase 3 adds `recipientName`.

## UI/UX

- Contact block under the shipping/billing tiles as `text-xs text-muted-foreground` label–value lines; self-hiding when the address carries nothing.
- Phase 1 passes `disabled={locked}` to the two snapshot `AddressEditor`s, so a locked document stops presenting an editable form over data the API refuses to change.
- DS rules apply: semantic tokens only, shared primitives, no new inline comments.
- Phase 1 MUST remove `// @ts-nocheck` from `AddressesSection.tsx` and fix the type errors it hides. This is a precondition of the phase, not a preference: while the directive stands the file is invisible to `tsc`, so everything the phase adds there is unchecked by CI.

## Migration & Backward Compatibility

- **Everything in Phases 0–2 is additive.** No DB migration; snapshots are schemaless. With no `contactLabels` supplied, `AddressView` output is byte-identical — pinned by test.
- **New frozen exports**: `formatAddressContactPairs`, `AddressContactLabels` freeze on merge per `BACKWARD_COMPATIBILITY.md`; this spec is the required reference.
- **`name` → `label` rename (Phase 4)** follows the deprecation protocol: add `label`, keep `name` as a deprecated bridge for ≥1 minor, `@deprecated` JSDoc with target removal version, `UPGRADE_NOTES.md` entry. Snapshot storage keys are untouched.
- **Phase 3 migration** is additive nullable columns — deployable without downtime, safely re-runnable.
- **No core backfill.** Existing snapshots keep whatever they carry; a writer that wants the fields on historical documents re-emits them.

## Implementation Plan

### Phase 0 — snapshot key preservation *(outstanding; first implementable step)*
1. `normalizeAddressDraft` in `AddressesSection.tsx:78-99` takes the previous snapshot and merges back keys outside the twelve it owns; a cleared address still normalizes to `null`.
2. A round-trip test on that save path, asserting an unowned key survives.

The `SalesDocumentForm.tsx:438-459` copy is deliberately left alone: it runs only on document creation, where no prior snapshot exists, so a merge-back there would be permanently inert. Collapsing the two copies is separate work with its own justification.

### Phase 1 — contact fields and render
1. `AddressValue` + `formatAddressContactPairs` + `AddressView` contact block, with postal-purity and self-hiding tests.
2. Wire to the shipping/billing snapshot tiles.
3. Add `taxIdType` to the type and the pair-formatter.
4. Pass `disabled={locked}` at `AddressesSection.tsx:1070` and `:1137`.
5. Remove `// @ts-nocheck` from `AddressesSection.tsx` and fix the errors it hides.

*Prior art: a first cut of steps 1–2 exists on the fork as [fullstackhouse/open-mercato#66](https://github.com/fullstackhouse/open-mercato/pull/66), not merged in this repository.*

### Phase 2 — tax-id semantics
1. `normalizeEuVatId()` util — ISO-2 prefix on write.
2. Type-aware display gate; align search config so a public VAT number may index where local/personal numbers stay `hashOnly` or excluded.

### Phase 3 — recipient name + customer address book *(separable)*
1. `recipientName` on `AddressValue`/`AddressView`; `recipient_name`, `phone` columns on `CustomerAddress` with encryption-map entries.
2. `TC-CRM-CRUDFORM-*` sweep update for the new editable fields.

### Phase 4 — rename + docs
1. `name` → `label` bridge per Migration section; `BACKWARD_COMPATIBILITY.md` + `UPGRADE_NOTES.md` entries.

## Integration Coverage

Unit (`packages/core`): postal lines unchanged when contacts present (**the safety property**); per-field label gate; null-render preserved; snapshot round-trip keeps unowned keys, asserted through the document detail save path — the only path on which a prior snapshot exists.

Route/UI level (Phase 1): `packages/core/src/modules/sales/__integration__/TC-SALES-ADDR-CONTACT-001.spec.ts` — order created via API with a snapshot carrying `phone`/`taxId`; detail page renders both; save round-trips them from the detail tab and from the document form; a locked document renders the address inputs in their disabled state. Self-contained fixtures, no seeded data.

Phase 3: `TC-CRM-CRUDFORM-*` proves `recipient_name`/`phone` save-and-reload on customer address create + update.

## Risks & Impact Review

Write operations are limited to the existing document-update path (Phase 0/1) and one additive migration (Phase 3); no events, no cross-module writes, tenant scoping unchanged (snapshots live on tenant-scoped rows, encrypted at rest).

#### Tax id shown to under-privileged users
- **Scenario**: A personal (non-VAT) tax number renders in the document detail to a user who shouldn't see PII.
- **Severity**: Medium
- **Affected area**: sales document detail
- **Mitigation**: the type-aware gate ships with Phase 2, before any tax id renders to a non-privileged user; `pl_nip`/`other` sit behind the existing PII feature.
- **Residual risk**: `eu_vat` renders ungated by design — it is a public identifier (VIES).

#### Editor merge-back resurrects a stale key
- **Scenario**: Integration updates the snapshot while a user edits; save merges the user's postal fields with the pre-edit contact keys.
- **Severity**: Low
- **Affected area**: document addresses tab
- **Mitigation**: document-level optimistic locking already rejects the stale save (409).
- **Residual risk**: none beyond existing conflict UX.

#### A tax-id class appears that the seed set does not name
- **Scenario**: A deployment meets an identifier that is neither `eu_vat` nor `pl_nip`, and stores it as `other`, losing the distinction.
- **Severity**: Low
- **Affected area**: tax-id display, future validation
- **Mitigation**: the enum widens additively under the BC contract, one observed case at a time; only the seed values freeze on merge.
- **Residual risk**: values already stored as `other` need re-typing when their class is named — a data touch-up, not a migration of surface.

#### Rename breaks third-party address consumers
- **Scenario**: A module reads `name` from the API after Phase 4 removal.
- **Severity**: Medium
- **Affected area**: customers + sales address APIs
- **Mitigation**: ≥1-minor bridge, `@deprecated` JSDoc, `UPGRADE_NOTES.md`; storage keys unchanged.
- **Residual risk**: consumers that ignore deprecation warnings break at the announced removal — accepted per protocol.

## Final Compliance Report — 2026-08-11

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
| Field set consistent throughout | Pass | TLDR, Data Models, Phases and Integration Coverage all read `phone` + `taxId` + `taxIdType` |
| Every claim about current behaviour re-read at `develop` | Pass | Verified against `39412fdd5`: `normalizeAddressDraft` single-argument in both copies, `AddressEditor` `disabled` prop present and unpassed at `AddressesSection.tsx:1070`/`:1137`, no `…addresses.email` key in any of the five locales |
| No open decisions left to the implementer | Pass | §Design Decisions Taken During Review; deferred items listed explicitly |

### Non-Compliant Items
None at spec level.

### Verdict
**Implementation-ready**, starting at Phase 0. No question in this document is left open; the deferred items named under Design Decisions are outside every phase here and block none of them.

## Appendix — field prevalence in one production dataset

The justification above stands on the market comparison, not on any single deployment. These figures are offered only as evidence that the fields are **populated in practice** rather than theoretically useful, measured on one production e-commerce dataset of ~1.4M orders whose documents originate in an external system of record:

| Signal | Coverage |
|---|---|
| Phone on the document address | 99.7% |
| Tax identifier on the document billing address (placeholders excluded) | 12.9% of orders |
| Tax identifier at customer level | 5.6% of customers |

Two observations that shaped decisions above: the order-level tax-id rate exceeds the customer-level rate because business buyers reorder more often — an input to keeping the customer as master while the document freezes what it was issued under — and `buildingNumber` was populated on ~1% of addresses because house numbers are conventionally written into the street line, which is why this spec adds no further logic there.

## Changelog

### 2026-08-12
- Corrected the scope of Problem 6. The second `normalizeAddressDraft`, on `SalesDocumentForm.tsx`, is not a second instance of the data loss: that component is mounted only by the document *create* page and submits through `createCrud`, so no prior snapshot exists for it to drop. Phase 0 covers the document detail path alone; the duplication is recorded as work that needs its own justification.

### 2026-08-11
- Every claim about current behaviour re-verified against `develop` and corrected. Phase 0 is stated as outstanding work in this repository rather than shipped; a second `normalizeAddressDraft` on `SalesDocumentForm.tsx` is examined and recorded; Problem 5 is restated as the narrower true defect — `AddressEditor` accepts `disabled` and the two snapshot call sites simply do not pass it — and the two-line fix replaces the proposed read-only render path, which moves to Alternatives; the removal of a nonexistent `…addresses.email` i18n key is dropped; fork pull requests are labelled and linked as such.
- Open Questions resolved and the block replaced by a decisions record: one spec phased, and `taxIdType` takes the Stripe-shaped `{country}_{kind}` seeded `eu_vat` / `pl_nip` / `other`, because a minimal enum's `local` is uninterpretable while `country` stays unconstrained and leaves the display gate nothing to key on. Compliance verdict moves from Blocked to implementation-ready.

### 2026-08-10
- Initial specification.
- Reframed after review: the driver is the general commerce gap — every comparable platform models a phone on the address and Open Mercato does not — with the single-deployment measurements demoted to an appendix. `email` dropped from the field set on market evidence.
