# Contractor Registry — shared contractor registry (AP + AR)

**Related:** [Accounts Payable](2026-09-06-accounts-payable.md)
(consumer — vendor registration/verification; **pending, not yet
merged into `develop` — PR #5962**), [Accounts Payable —
Payments](2026-09-06-accounts-payable-payments.md) (consumer — the
module that actually resolves `contractorBankWhitelistCheck` via
`tryResolve` at payment time, per AP's own split; **added
2026-09-08**, see Changelog; **pending, not yet merged — PR #5962**),
sales-invoice-gl-posting (consumer — customers, indirectly through
`sales`; **written, open PR #6046** —
[sales-invoice-gl-posting](2026-08-18-sales-invoice-gl-posting.md),
`docs/sales-invoice-gl-posting`), [General
Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(`JournalEntryLine` gets a new `contractorSnapshot` field from this
spec; **pending, not yet merged — PR #5663**)

## TLDR

One shared contractor registry module — tax-identity verification
(GUS, VIES, VAT whitelist/Biała Lista), contact data, bank accounts as
a separate entity, a light new-vendor approval step. Used both by
Accounts Payable (vendors) and by the sales path (customers).

## Overview

`contractors` is a new, independent module modeling the **tax
identity** of an entity the company does business with — as opposed
to `customers`, which models the sales relationship (CRM, pipeline,
deals). Consumers of this module: Accounts Payable staff (registering
and verifying vendors before the first payment), accounting (a
historical, immutable copy of contractor data on posted documents),
and — indirectly, through the future `sales-invoice-gl-posting` — the
sales path. Core value: one source of truth for a contractor, one
GUS/VIES/Biała Lista verification regardless of whether the entity is
a vendor, a customer, or both at once — instead of two, drifting
copies of the same data in AP and AR.

> **Market Reference**: The open-source reference studied was Odoo's
> `res.partner` — a single partner entity with `customer_rank`/
> `supplier_rank` flags instead of separate Customer/Vendor models,
> exactly the same pattern as our `isVendor`/`isCustomer` below.
> Rejected from Odoo: `res.partner` is also a CRM entity (shipping
> addresses, contacts, portal access), which in our system is already
> covered by `customers` — duplicating that in `contractors` would
> duplicate `customers`' responsibility, so `contractors` deliberately
> narrows itself to tax identity and verification, leaving CRM where
> it already lives.

## Problem Statement

Today the repo has no module responsible for a contractor's tax
identity. Checked directly against
`packages/core/src/modules/customers`: this is a mature CRM module —
person/company entities with a `kind` field (enum), a sales pipeline
(deals), role assignment. Zero concept of a vendor, tax verification,
or GUS/VIES/Biała Lista. "vendor" appears in this module only as free
text in demo data (`cli.ts`) and as a sample value in one integration
test (`__integration__/TC-CRM-078.spec.ts`) — `roleType` is a
`z.string()` field (free text, not an enum; see `data/validators.ts`),
so "vendor" isn't a recognized domain concept there, just a sample
free-text value.

Verification (GUS/VIES/whitelist) genuinely has no existing surface
anywhere in the repo. Tax-ID *data entry*, however, is not entirely
new: `customers`' `AddressEditor` already offers a `taxIdType` of
`plNip`/`euVat`/`other` with a `taxId` value on an address, carried
through `sales` document addresses, and `customers/search.ts` already
treats `tax_id`/`registration_number` as hash-only fields. This module
deliberately leaves that address-level field alone — it doesn't
attempt to migrate or unify with it — and introduces a second place a
NIP can be entered. Accepted as a real but minor duplication, not a
reason to delay a dedicated registry.

All entities in `customers` carry both `organizationId` and
`tenantId` (a separate `Tenant` lives in `modules/directory`), and
none of them has a mechanism for sharing a single entity across
organizations of the same tenant. (Exception in the repo: `ApiKey` has
both fields `nullable` for tenant-/system-wide keys — but that's not a
pattern for a domain, tenant/org-scoped entity like `Contractor`, just
a deliberate exception for one, different use case.)

**Conclusion:** `customers` models leads/clients from a CRM angle
(sales pipeline), not a contractor's tax identity. Forcing
GUS/VIES/Biała Lista onto the existing `CustomerEntity` would violate
the module's single-responsibility principle.

While writing `2026-09-06-accounts-payable.md` we recorded a Design
Decision: "The contractor is a shared entity, not duplicated in AP and
AR" — but AP itself doesn't design this registry, it just assumes one
exists somewhere. Without this document, AP and the future, expanded
AR module would risk two independent, drifting implementations of the
same "contractor" concept.

### Legal context — why contractor verification is a requirement at all

**VAT Act, Art. 96b, and the tax-cost rule in CIT Art. 15d / PIT Art. 22p**
(checked 2026-10-12 against the consolidated texts: VAT Dz. U. z 2025 r.
poz. 775 as amended through 2026 poz. 846; CIT Dz. U. z 2026 r. poz. 554 and
later; PIT Dz. U. z 2026 r. poz. 592 and later). Art. 96b VAT Act is the
register itself: the Head of the National Revenue Administration keeps an
electronic list (wykaz) of entities registered, or refused/struck off, as VAT
taxpayers (the so-called Biała Lista / VAT whitelist). It contains the
settlement-account numbers of the entity (ust. 3 pkt 13), can be queried for a
chosen day (ust. 2) and is updated once per business day (ust. 8). Art. 96b
does not itself oblige anyone to check the list and contains no liability rule.

The consequence that makes the check matter is in income-tax law: art. 15d
ust. 1 pkt 2 CIT and art. 22p ust. 1 pkt 2 PIT exclude the cost from tax-deductible
costs when the payment for a supply confirmed by an invoice from an active VAT
taxpayer (a transaction within art. 19 Prawo przedsiębiorców) is made to an
account other than the one in the wykaz "na dzień zlecenia przelewu" (on the
day the transfer is ordered). There are exceptions, notably a notification to
the tax office within 7 days of ordering the transfer (art. 15d ust. 4 CIT /
art. 22p ust. 4 PIT, referring to art. 117ba § 3 pkt 2 Ordynacji podatkowej),
payments to certain bank accounts, and payments made by split payment. So
paying to an account outside the list is not prohibited; the paying company
loses the cost deduction unless an exception applies.

**Joint liability and the PLN 15,000 amount (checked 2026-10-12, Ordynacja
podatkowa Dz. U. z 2026 r. poz. 622, state of 21 April 2026; Prawo
przedsiębiorców t.j. Dz. U. z 2025 r. poz. 1480 and later amendments).** Art.
117ba § 1–2 Ordynacji podatkowej makes the payer (a VAT taxpayer under art. 15)
liable jointly, with its whole property, with the supplier (an active VAT
taxpayer) for the supplier's VAT arrears proportional to that supply, when the
invoice-confirmed payment was made by transfer to an account other than the one
in the wykaz "na dzień zlecenia przelewu". Art. 117ba § 3 lists the cases where
this does not apply: a transaction other than one under art. 19 Prawo
przedsiębiorców (§ 3 pkt 1), a notification to the tax office within 7 days of
ordering the transfer, made at the first payment to that account (pkt 2),
payments to certain bank accounts (pkt 3), split payment (pkt 4), and
intra-Community acquisition, import and reverse-charge invoices (pkt 5). Art.
19 Prawo przedsiębiorców applies to transactions with another entrepreneur whose
one-off value exceeds PLN 15,000 (or the equivalent, foreign-currency
transactions converted at the NBP average rate of the last working day before
the transaction day).

**Consequence for the project:** bank account verification against the Biała
Lista must be done as of the day the transfer is ordered, at every payment, not
once at registration. This is a design requirement that follows from the
tax-cost rule and the joint liability above (a payment outside the list is
allowed but costly), not a legal prohibition on paying. Checking on the day is
not the only way out the law provides (the 7-day notification and split payment
also remove the liability), but it is the one this module can enforce
automatically; the 7-day notification and split payment are not modelled here.

**GUS (Polish Central Statistical Office)** — the REGON register, used
to verify that a given NIP (tax ID) corresponds to an existing,
registered business entity, and to pull basic company data (name,
address) without manual entry.

**VIES (VAT Information Exchange System)** — the EU-wide VAT-number
verification system, needed for transactions with contractors from
other EU member states (to confirm the contractor is a registered
VAT-UE taxpayer, which affects how an intra-Community transaction is
settled).

## Proposed Solution

A new, independent `contractors` module with one `Contractor` entity
(`isVendor`/`isCustomer` flags, GUS/VIES data, verification status)
and a separate `ContractorBankAccount` entity (bank accounts, 0..N per
contractor). GUS/VIES verification happens asynchronously through a
queue (`@open-mercato/queue`), with a visible status
(`PENDING`/`VERIFIED`/`FAILED`). Biała Lista verification is always
**live** — on the day the transfer is ordered — and is never replaced
by a cache. PII data (NIP, name, address, bank account, contact) is
encrypted per the `encryption.ts` convention.

### Design decisions (2026-09-07 — resolved)

**Independent module, no integration with
`packages/core/src/modules/customers`.** Rationale: see Problem
Statement.

**GUS/VIES verification: asynchronous, via `@open-mercato/queue`, with
a status.** A `verificationStatus: PENDING | VERIFIED | FAILED` field
on `Contractor`. Blocking contractor creation on the availability of an
external API (GUS/VIES are sometimes unavailable) is bad practice.
`createContractor` persists the contractor with status `PENDING` and
enqueues `workers/verifyContractorRegistry.ts` (`metadata: { queue, id,
concurrency }` per `packages/queue/AGENTS.md`), which calls GUS/VIES
and updates the status. Idempotent — safe to retry.

**One `Contractor` entity with `isVendor`/`isCustomer` flags.** The
same entity is often both a vendor and a customer of the same company
(e.g. we buy materials from someone we also sell services to) — one
entity with non-exclusive flags avoids duplicating GUS/VIES/account
data for the same NIP.

**`NIP` is immutable once the contractor is created.** NIP is the
identity key (hash-indexed, see below) and the basis for duplicate
detection and historical snapshots on `JournalEntryLine`. Allowing a
NIP change after the fact would undermine both mechanisms —
`updateContractor` rejects a `nip` change regardless of whether the
contractor already has linked documents (unlike GL's guards, which
unlock editing as long as there are no posted entries — here the block
is unconditional, because `nip` is identity, not an operational
attribute). Changing the NIP requires creating a new contractor.
**Updated 2026-10-20:** `nip` is now nullable (a foreign supplier may
have only a VAT-UE number), so the rule reads "immutable once set": a
missing NIP may be added, a set one never changes; `euVatNumber`
follows the same rule (see Design decisions, 2026-10-20).

**Contractor bank accounts: a separate `ContractorBankAccount` entity,
not a field/array on `Contractor` (resolved after discussion on
2026-09-07).** Three reasons: (1) the project checklist explicitly
forbids `unbounded arrays`/`nested JSON blobs` in the schema; (2) the
Biała Lista publishes a **list** of accounts registered for a given
NIP — "one field" doesn't reflect reality, a contractor can legally
have and use several accounts; (3) the same, proven pattern already
used elsewhere in this repo as `JournalEntryLine`/`SalesInvoiceLine` —
"a line owns its own scope" (`ContractorBankAccount` carries its own
`organizationId`/`tenantId`, not just scope inherited via
`contractorId`).

**`ContractorBankAccount.lastVerifiedAt`/`lastVerificationStatus` is a
UX cache only — it never replaces the mandatory, live verification at
payment time, even if it's "fresh" (resolved after discussion on
2026-09-07).** Two possible uses of the cache were considered: (A)
purely informational — e.g. a "last checked: 3 days ago" badge on the
contractor list, before anyone attempts to pay; (B) an optimization —
skipping the live check at payment time if the cache is "fresh".
**Chosen: (A) only.** (B) would directly violate the requirement in
art. 15d ust. 1 pkt 2 CIT / art. 22p ust. 1 pkt 2 PIT ("na dzień
zlecenia przelewu", i.e. the day the transfer is ordered, not "within the
last N days") — an account could have disappeared from the Biała
Lista this morning, and yesterday's cache wouldn't catch that,
restoring exactly the risk (loss of the cost deduction, and the payer's
liability under art. 117ba Ordynacji podatkowej) this whole
feature exists to eliminate. `checkBankAccountWhitelist` (see Commands) **always**
performs a live call to the Biała Lista API, regardless of the cache
value; the cache is updated as a side effect of every live check,
never as its substitute.

**History of contractor data changes: a snapshot on
`JournalEntryLine`, not full versioning.** A contractor's NIP is
fixed, but its name, address, and bank account can change over time.
Without a safeguard, a contractor's bank account change would silently
alter what's shown when browsing old, already-posted invoices — an
audit problem. Solution: a `contractorSnapshot` field (`json`, matching
the type declared in the GL core engine — see below) directly on
`JournalEntryLine` in the GL core engine (#5663) — it records the
name, NIP, account, and verification status exactly as of the moment
the transaction was posted. This is the third field added to
`JournalEntryLine` "just in case," in the same spirit as the earlier
`referenceType`/`referenceId` (link to the source document) and
`parentAccountId` (chart-of-accounts hierarchy) — a cheap, structural
change on an empty/growing table, expensive to add later on a table
with production data. **Who populates the snapshot and stores proof of
a specific live check for a specific payment is Accounts Payable's
job, not this module's** (see Out of scope); this module only provides
`checkBankAccountWhitelist` as a callable service and
`Contractor`/`ContractorBankAccount` as the source data for
snapshotting.

**Bank account verification against the Biała Lista: at account
registration + mandatory, live, on every payment.** A direct
consequence of art. 15d CIT / art. 22p PIT (the register itself is Art. 96b
of the VAT Act). The registration half is a background check that only
warns (see Design decisions, 2026-10-20).

**Resolved (2026-09-08): a light, one-step new-vendor approval gate
is confirmed in scope for Phase 1.** This started as an unconfirmed
recommendation (not backed by the Event Storming wall or SPEC-024) —
it is now backed by explicit research done before committing to it,
not assumption:

- *What it adds, given the mandatory live Biała Lista check already
  in Accounts Payable.* That check only confirms a NIP and a bank
  account are registered together in the Ministry of Finance's
  registry (Art. 96b VAT Act) — it says nothing about whether the
  request that produced that data was genuine. A Polish industry
  source ([ksbot.pl](https://ksbot.pl/bezpieczenstwo/ksef-bezpieczenstwo-bialy-wykaz-vat-a-oszustwo/))
  is explicit that the whitelist alone is not sufficient protection
  against invoice fraud, and recommends exactly the complementary
  controls a human approval gate provides: independent-channel
  verification of account changes, a four-eyes principle, and a
  documented internal approval procedure. A one-step approval at
  first use is that control at the *vendor-onboarding* moment
  specifically — distinct from the *payment* moment, which the
  mandatory live check already covers.
- *The threat is real and growing, not hypothetical.* The three
  vendor-fraud schemes documented by Trustpair — BEC/phishing
  impersonating a supplier, an internal employee registering a
  fictitious vendor, and a compromised real vendor requesting a
  bank-detail change — all attack exactly the moment this gate sits
  at (registering/first-using a contractor), and none is detectable
  by a registry lookup. The AFP's 2025 Payments Fraud and Control
  Survey found 45% of organizations hit by vendor-impersonation fraud
  (up from 34% the prior year), against 63% hit by BEC overall, and
  explicitly recommends streamlining vendor verification as a
  control.
- *This is standard industry practice, not a bespoke control.*
  Segregating "who registers a vendor" from "who approves it for use"
  is a textbook Purchase-to-Pay internal control; SAP Ariba's
  supplier-onboarding module and ApprovalMax's dedicated "Vendor
  Workflows" both ship it as a named feature, not an edge case.

Decision: implement it as part of Phase 1, not defer it — the cost is
low (the `workflows` engine already exists and is reused, not built
new; see Workflow definition below) and it closes a documented gap the
mandatory Biała Lista check does not close. This resolves the scope
question every "pending team confirmation" marker below referred to;
the mechanism itself was already resolved separately (see below).
Final sign-off still happens through the normal PR review with
Łukasz, same as every other decision in this document — this is no
longer an unconfirmed proposal awaiting a business case, since the
business case has now been made and documented (see Changelog).

**Resolved (2026-09-07, after an independent scope-cohesion check):
`approveContractor` stays threaded as a conditional through the same
sections as the rest of the module, rather than being extracted into a
separate document/block.** A fresh-context scope-cohesion check
returned a SPLIT verdict for this item — the document itself admits it
can be cut without redesigning the rest. Even so, the decision is: keep
it together. Rationale: in practice this isn't a separate,
independently deployable capability — it concerns the same entity
(`Contractor`), the same ACL feature (`contractors.manage`), and the
same screen (contractor list/edit), so it naturally belongs to the
same implementation cycle — now confirmed (see the resolution
above), it ships together with the rest of Phase 1, not as a separate
follow-up. The per-section markers below are updated accordingly to
no longer read as conditional on scope.

**`approveContractor`'s mechanism is now resolved: the `workflows`
engine (`defineWorkflow`/`USER_TASK`), 1:1 with `sales.order-approval`
and `accounts_payable.invoice-approval` — not `useGuardedMutation`
(2026-09-08, this round).** The scope question (whether this feature
ships at all) is now resolved too (see above) — this decision
settles *how* it is built, so the document stops carrying a
half-fixed citation (see Changelog,
"approval-pattern citation corrected," which removed the false GL
comparison but left no replacement design). Verified directly: the
repo's only implemented approve/reject precedent is
`sales.order-approval`, and it uses the full workflow engine, not a
guarded row action — `useGuardedMutation` is real, but only for a
simple, *reversible* toggle (GL's fiscal-period lock/unlock), which is
a structurally different decision shape from a one-time approve/reject
gate. `approveContractor` is exactly the second shape, same as AP's
own invoice approval, so this document now adopts the identical
pattern AP already adopted for the identical problem: a
`contractors.vendor-approval` workflow, triggered on
`contractors.contractor.created` (immediate, like
`sales.order.created` — this module has no separate "draft" contractor
state before approval, unlike AP's invoice, which has `DRAFT` before
`PENDING_APPROVAL`; see Workflow definition), `USER_TASK` with a
`formSchema: {decision: approve | reject}`, and completion through the
existing generic `POST /api/workflows/tasks/:id/complete` — not a
custom `/api/contractors/:id/approve` route (removed, see API
Contracts). One deliberate departure from `sales.order-approval`,
carried over from AP's own review: the workflow's transition calls a
**dedicated** `applyContractorApprovalDecision` command, not the
general-purpose `updateContractor` — AP independently found that
`sales.order-approval` reusing its own generic `update` command for
this exact purpose is a latent, unresolved contradiction risk
(`updateContractor` has its own guards — e.g. the NIP-immutability
guard above — that were never designed with a workflow-originated call
in mind), and this document avoids repeating it rather than copying
the same latent issue a third time.

**Registry is per-organization, not shared across a tenant's
organizations.** No precedent for such a pattern for a domain,
tenant/org-scoped entity in the code — the only nullable
`organizationId` in the repo belongs to `ApiKey` (a deliberate
exception for tenant-/system-wide API keys, not for domain entities
like `Contractor`). Sharing a contractor across a tenant's
organizations is new architecture, for which there is today neither a
code precedent nor a confirmed business requirement — deliberately
deferred (YAGNI) until it actually emerges as a requirement.

**Encryption maps: two declarations, one per entity.**
`contractors:contractor` encrypts `name`, `address`, `contact_email`,
`eu_vat_number` (added 2026-10-20, with `hashField: 'eu_vat_number_hash'`),
`contact_phone`; `nip` additionally gets `hashField: 'nip_hash'`
(pattern: `messages:message.external_email` → `external_email_hash`,
verified in `packages/core/src/modules/messages/encryption.ts`) —
registration must detect a duplicate by NIP, and searching an
encrypted column without a hash doesn't work.
`contractors:contractor_bank_account` encrypts `account_number`
(financial data, PII), with `hashField: 'account_number_hash'` since
2026-10-20 (see Design decisions, "Lookup hashes"). Reads go through
`findWithDecryption`/`findOneWithDecryption`, never hand-rolled crypto.

**Delete guard: drop the `JournalEntryLine` half (2026-09-08,
maintainer review).** The original design blocked `Contractor`
deletion "if it has any `JournalEntryLine` references via snapshot" —
but `JournalEntryLine` belongs to `ledger`, a downstream consumer of
this module, and checking it from here would require `contractors` to
import or resolve something belonging to its own consumer, exactly the
direction `packages/core/AGENTS.md` forbids ("the upstream/depended-on
module MUST NOT import, resolve, or hard-require the consumer") — the
same rule this document already quotes correctly for the
`accounts_payable_payments` relationship (see Cross-module
integration). It would also fail `module-decoupling.test.ts` the
moment `ledger` is disabled, since the referenced table wouldn't
exist. Dropped entirely: `contractorSnapshot` exists specifically so a
historical journal entry never needs the `Contractor` row to still
exist (a denormalized, point-in-time copy — see
`2026-08-18-general-ledger-core-engine.md`), and deletion here is a
soft delete (`deletedAt`) besides, so the row remains physically
present regardless. The only delete guard this module enforces is its
own: an active `ContractorBankAccount`. Whether `accounts_payable`'s
open `VendorInvoice.vendorId` references should also block a
contractor's deletion is a legitimate question, but belongs to AP's
own design (it owns that FK), not to this module's ACL.

**`gusData`/`viesData` narrowed to non-PII diagnostics (2026-09-08,
maintainer review).** The original design stored the raw GUS/VIES API
response verbatim (`jsonb`) for diagnostics. For a sole proprietorship
(JDG), that raw response carries the owner's personal name and often a
residential address — the exact fields this module's own encryption
map already encrypts on `Contractor.name`/`Contractor.address` — so
the raw blob silently duplicated the same PII in plaintext beside its
encrypted counterpart, reducing the encryption to decoration for
anyone with table or backup access. Narrowed to typed, non-PII fields
only: `lastCheckStatus` (the registry's own status/response code),
`lastCheckedAt`, `lastCheckRequestId` — enough to debug a failed
lookup without persisting the underlying personal data a second time,
in a form this module cannot redact on a GDPR erasure request. If a
raw payload genuinely proves necessary for diagnostics later, it must
be declared in the encryption map like every other PII field, with a
stated retention/purge policy — not assumed safe because it's "just
diagnostics."

**Approval gate gets a real enforcement point: `checkBankAccountWhitelist`
(2026-09-08, maintainer review).** Confirming the vendor-approval gate
in scope (2026-09-08 as it happened) settled the workflow's
*mechanism* but left its *consequence* undefined: `approvalStatus` and
`verificationStatus` were specified as independent fields with
"nothing in Phase 1 blocks Accounts Payable from using a
`PENDING_APPROVAL` contractor" left as an open question for AP. A
control nothing consults is documentation, not a control — the entire
fraud-prevention argument in Problem Statement/Design decisions would
fire zero times in practice. Resolved: `checkBankAccountWhitelist` —
already the sanctioned, DI-resolved choke point every payment goes
through (see Commands, Cross-module integration) — now also rejects
with a typed error when the contractor's `approvalStatus` is not
`APPROVED`, before it makes the live Biała Lista call. This folds the
human-approval gate into the same call site AP already depends on,
rather than requiring AP to separately read and interpret
`approvalStatus` itself. This closes the Out of scope item below of
the same name. **Updated 2026-10-20:** the gate stays at the same call
site, but a non-approved contractor is reported as the `NOT_APPROVED`
reason of the eligibility result instead of a typed error (see Design
decisions, 2026-10-20, "Payment eligibility").

**Four-eyes needs its own permission: `contractors.approve`
(2026-09-08, maintainer review).** The original ACL required
`contractors.manage` for both `createContractor` and
`applyContractorApprovalDecision` — the same single feature on both
sides of the split the approval gate exists to create, so the user who
registers a vendor can also approve their own registration, defeating
the four-eyes rationale in Problem Statement/Design decisions outright
(the exact internal fictitious-vendor scheme the fraud research warns
about). Split: `applyContractorApprovalDecision` now requires a
distinct `contractors.approve` feature, not `contractors.manage`.
`applyContractorApprovalDecision` additionally rejects a decision
where the acting user is the same as the contractor's
`createdByUserId` — explicit self-approval is blocked even for a user
who happens to hold both features. `Contractor` gains a
`createdByUserId` column to make this check possible.

This deliberately diverges from `sales.order-approval` and
`2026-09-06-accounts-payable.md`'s own `applyVendorInvoiceApprovalDecision`,
both of which explicitly accept self-approval as a documented Phase-1
risk rather than an oversight (see `2026-09-06-accounts-payable.md`,
"No maker-checker control (self-approval) in Phase 1"). That
acceptance is consistent with *their* stated rationale — an ordinary
authorization/oversight step, not a fraud control. It would not be
consistent here: this document's own Problem Statement justifies the
entire approval gate specifically as a four-eyes control against
internal fictitious-vendor registration (see Problem Statement,
Non-Compliant Items). Accepting self-approval while citing four-eyes
as the reason for existing would be a direct contradiction within this
document, not a repo-wide inconsistency — the other two modules never
made that specific claim.

**`isPrimary` and the `nip`/`nipHash` uniqueness constraint get
partial indexes, not the reasoning originally given (2026-09-08,
maintainer review).** Two corrections. First,
`ContractorBankAccount.isPrimary`'s command-only invariant was
justified by "this repo's general preference for command-enforced
business rules over database-level ones" — that preference doesn't
exist; both real precedents for an "exactly one primary" invariant in
this repo (`communication_channels_one_primary_per_user_uq`,
`customer_deal_people_primary_uq`) use a partial unique index. Added:
`create unique index "contractor_bank_account_one_primary_uq" on
"contractor_bank_account" ("contractor_id") where "is_primary" and
"deleted_at" is null`, keeping the command's unset-the-other-primary
logic as the ergonomic path (so a normal request never hits the
constraint) and removing the previously accepted concurrent-race
residual risk, which the index now closes at the database level.
Second, the `nipHash` uniqueness constraint (`UNIQUE (tenant_id,
organization_id, nip_hash)`) didn't account for this entity's own
`deletedAt` soft delete: a soft-deleted row still occupies the unique
tuple, so re-registering the same NIP — including by the legitimate
contractor it actually belongs to — would 409 forever, with no
correction path since `nip` is unconditionally immutable. Changed to a
partial index scoped `where "deleted_at" is null`, the same shape as
`communication_channels_one_primary_per_user_uq`: a soft-deleted
registration frees its NIP for re-registration.

### Design decisions (2026-10-20 — requirements from a customer implementation)

These decisions close gaps found when the registry was compared with a
customer's requirements and with the sibling specs (Accounts Payable
#5962, GL #5663). Each one is decided; none is open.

**The whitelist check returns the Ministry's request identifier:
`{ status, checkedAt, requestId }`.** The Ministry of Finance API
(`wl-api.mf.gov.pl`, checked 2026-10-20) returns `requestId` and
`requestDateTime` in every search and check response
(`EntityCheckResponse` for `/api/check/nip/{nip}/bank-account/{bank-account}`,
`EntityResponse` for `/api/search/nip/{nip}`, `EntryListResponse` for the
batch searches). The `requestId` is the Ministry's own identifier of that
query, so it is the piece of evidence that ties a payment to the list as it
stood on the day the transfer was ordered. `checkBankAccountWhitelist`
passes it through unchanged, and `checkedAt` is the Ministry's
`requestDateTime`, not the server clock. Both are `null` only when no
answer arrived (see the eligibility decision below).
`accounts_payable_payments` already stores exactly these three fields on
`PaymentBatchLine.whitelistCheckResult`; until now this module did not
return `requestId`, so that field had no source.

**Payment eligibility: the check returns `eligible` and `reasons[]`
instead of throwing.** The full result of `checkBankAccountWhitelist`
(and of the `contractorBankWhitelistCheck` DI service, which is the same
command) is:

```ts
type ContractorBankAccountPaymentCheck = {
  eligible: boolean
  reasons: Array<
    | 'NOT_APPROVED'
    | 'VERIFICATION_FAILED'
    | 'ACCOUNT_INACTIVE'
    | 'WHITELIST_NEGATIVE'
    | 'WHITELIST_UNAVAILABLE'
  >
  status: 'WHITELISTED' | 'NOT_WHITELISTED' | 'NOT_CHECKED' | 'NOT_APPLICABLE'
  checkedAt: string | null
  requestId: string | null
  accountNumberLast4: string
  currencyCode: string | null
}
```

(`accountNumberLast4` and `currencyCode` added with `purpose`/`currencyCode`
below.)

- `eligible` is `true` exactly when `reasons` is empty.
- **Local reasons, evaluated first, without a network call:**
  `NOT_APPROVED` (`approvalStatus` is not `APPROVED`),
  `VERIFICATION_FAILED` (`verificationStatus` is `FAILED`),
  `ACCOUNT_INACTIVE` (the bank account or the contractor that owns it is
  deactivated or soft-deleted, see "Reversible deactivation" below). All
  local reasons that apply are listed; the live call is then skipped and
  `status` is `NOT_CHECKED`, the same "no network call before the gate"
  property the 2026-09-08 approval decision introduced.
- **Only `FAILED` blocks; `PENDING` and `NOT_APPLICABLE` do not.**
  Registration is asynchronous and a registry outage must not stop
  payments to a contractor a person has already approved; the live
  whitelist check still runs for every payment. For the rule to mean
  something, `FAILED` now means that a registry answered negatively (the
  NIP is not in GUS, the VAT-UE number is not valid in VIES). A registry
  that does not answer leaves the status `PENDING` and the worker retries
  (see Risks & Impact Review); it no longer sets `FAILED`.
- **Live reasons:** the Ministry answers that the account is not
  assigned to the NIP (`accountAssigned` is `NIE`) → `WHITELIST_NEGATIVE`,
  `status: 'NOT_WHITELISTED'`; no answer (timeout, HTTP error, malformed
  body) → `WHITELIST_UNAVAILABLE`, `status: 'NOT_CHECKED'`,
  `checkedAt`/`requestId` `null`.
- **It blocks Accounts Payable Payments.** `accounts_payable_payments`
  confirms a payment batch only when every line is `eligible`, and maps
  each reason to its own error code (see #5962). This replaces the
  earlier `422 CONTRACTOR_NOT_APPROVED` rejection: a non-approved
  contractor is now one reason among five, returned in the same shape as
  the others, so the consumer can show all of them at once instead of
  learning them one failed call at a time. The HTTP "verify now" route
  returns the same result with `200`.

**A new bank account is checked against the whitelist in the background,
and a negative answer only warns.** The 2026-09-07 decision already said
"at account registration + mandatory, live, on every payment", but no
command did the registration half. Now `createContractorBankAccount`,
and `updateContractorBankAccount` when `accountNumber` changes, enqueue
`workers/verifyContractorBankAccount.ts` after the account is saved. The
worker makes the same live Ministry call as `checkBankAccountWhitelist`
(without the eligibility gate: an account of a contractor still waiting
for approval is checked too, because the answer is useful to the person
who approves it), writes the result to the verification history (see
the next decision) and updates `lastVerifiedAt`/`lastVerificationStatus`.
- **A negative answer does not reject the account.** The account stays
  saved, and `lastVerificationStatus: 'NOT_WHITELISTED'` is its warning
  flag, shown as a warning badge on the contractor's page ("not on the
  whitelist as of <date>"). There is no separate flag column: the badge
  reads the cached status, which stays informational. Rejecting would be
  wrong, because a payment may still go to that account legally (the
  7-day notification or split payment, see Legal context) and because the
  answer can change the next business day; the payment-time check
  decides.
- **An unavailable registry** writes a `NOT_CHECKED` history row, leaves
  the cached status unchanged and lets the queue retry.
- **Idempotent:** the job key is the bank account id plus the hash of
  the number being checked (see "Lookup hashes" below), so a retried job
  for an unchanged number does not query the Ministry twice.
- **The registration check never replaces the payment-time check**: it
  is history and a UX signal, exactly like the cache (see the 2026-09-07
  decision on `lastVerifiedAt`).

**Verification history: an append-only `ContractorVerificationCheck`
table, whose rows survive edits and soft deletes of the bank account.**
Until now the registry kept only the latest result (`lastCheck*` on
`Contractor`, `lastVerified*` on the account), so the evidence of a
check disappeared with the next one, and a changed or soft-deleted
account left nothing to show which number had been checked. One row is
written for every registry call this module makes: each live call of
`checkBankAccountWhitelist` (payment time and "verify now"), the
registration check above, each GUS/VIES lookup of
`verifyContractorRegistry` and each on-demand VIES check. Columns: the
contractor, the bank account (optional — `null` for GUS/VIES), `kind`
(`WHITELIST`/`GUS`/`VIES`), `status`, `checkedAt`, `requestId`, and for
whitelist rows the last four digits and the lookup hash of the number
actually checked (see Data Models).
- **Why the number is stored as last four digits plus a hash, not
  copied.** The full number stays encrypted only on
  `ContractorBankAccount`; the history must not become a second,
  plaintext copy (the same reasoning as AP's `whitelistCheckResult`). The
  last four digits let a person recognise the account; the hash proves
  which exact number was checked and matches `accountNumberHash` (see
  "Lookup hashes" below) even after the account row was edited or
  soft-deleted.
- **The hash is the platform's lookup hash, `hashForLookup`**
  (`packages/shared/src/lib/encryption/aes.ts`): HMAC-SHA256 keyed with
  the installation's lookup pepper (`LOOKUP_HASH_PEPPER`, falling back to
  the tenant-data encryption keys), with a `v2:` prefix. Without any
  configured key it falls back to an unkeyed SHA-256 (see Risks).
- **Append-only.** No update or delete command and no write route exist
  for this entity; it has no `updatedAt` and no `deletedAt`, a deliberate
  departure from the standard column contract, because evidence that can
  be edited or soft-deleted is not evidence. It is not user-editable, so
  optimistic locking does not apply. One exception, decided later the
  same day: retention may clear the account digits and hash to `null`
  (see "Retention of the verification history").
- **Written outside the caller's transaction.** The row is inserted in
  its own short transaction (a forked entity manager), so a payment
  confirmation in AP that rolls back still leaves the record that the
  Ministry was queried.
- **What it does not do.** It does not link a check to a payment; AP
  stores `requestId` on its own `PaymentBatchLine` (see Out of scope).
  The `lastCheck*` fields on `Contractor` stay as the latest GUS/VIES
  result for the list view, copied from the newest history row.

**Bank account numbers are validated by one shared function, IBAN and
NRB, format and checksum.** `validateBankAccountNumber(raw)` lives in
`packages/shared/src/lib/bank-accounts/accountNumber.ts`, so any module
can use it; this module calls it in `createContractorBankAccount` and
`updateContractorBankAccount` and rejects an invalid number with `400`
and a field error.

```ts
validateBankAccountNumber(raw: string):
  | { valid: true; normalized: string; format: 'NRB' | 'IBAN'; countryCode: string }
  | { valid: false; error: 'FORMAT' | 'COUNTRY_LENGTH' | 'CHECKSUM' }
```

- **Normalization:** spaces and dashes removed, letters upper-cased.
- **NRB:** exactly 26 digits. It is the Polish IBAN without its `PL`
  prefix, so it is checked as `PL` + the 26 digits.
- **IBAN:** two letters, two check digits, then the country's BBAN; the
  length must match the country's entry in the ISO 13616 IBAN registry
  (`COUNTRY_LENGTH` otherwise).
- **Checksum:** ISO 7064 MOD 97-10 — the first four characters moved to
  the end, letters replaced by numbers (A = 10 … Z = 35), and the
  result modulo 97 must equal 1 (`CHECKSUM` otherwise). Odoo's
  `base_iban` uses the same rule (see Literature & Prior Art).
- **Stored form:** always the IBAN form (`PL` + 26 digits for a Polish
  account), so the same account typed as NRB or as IBAN normalizes to
  one value and one lookup hash. The whitelist client strips `PL` before
  calling the Ministry, whose check endpoint takes the 26-digit number.
- **Only IBAN and NRB in Phase 1.** An account from a country outside
  the IBAN registry fails with `FORMAT`; such accounts are out of scope
  (see Out of scope).
- **Reusable for Cash & Bank.** `BankAccount.accountNumber` in
  `2026-09-10-cash-bank-management.md` (#6055) is free text today
  ("IBAN or local format"); that module can call the same function
  without any dependency on `contractors`, because the function lives in
  `shared`. Whether it does is that spec's decision; this document only
  places the validator where both can reach it.

**EU VAT number on the contractor, checked in VIES in the background at
registration and on demand, synchronously, with a 10-second timeout.**
A supplier from another member state has a VAT-UE number and no Polish
NIP, and a Polish contractor's VAT-UE status matters for
intra-Community supplies; until now the registry modelled only `nip`.
- **New field `euVatNumber`** (nullable): normalized to the two-letter
  VIES country prefix plus the number, upper-case, without spaces (a
  Polish one is `PL` + the NIP). Encrypted like `nip`, with a lookup hash
  `eu_vat_number_hash` and a partial unique index per `(tenant_id,
  organization_id)` while `deleted_at` is null, the same shape as
  `nip_hash`.
- **`nip` becomes nullable.** A contractor may have a `nip`, an
  `euVatNumber`, both, or neither (a supplier from outside the EU).
  Each of the two identifiers is set-once: it may be added while it is
  `null`, and once set it cannot change (the 2026-09-07 immutability
  rule, which assumed a NIP was always present at creation, now reads
  "once set"). Changing a set identifier still means a new contractor.
- **`verificationStatus` gains `NOT_APPLICABLE`** and is derived from
  the registries that apply: GUS for `nip`, VIES for `euVatNumber`.
  `FAILED` when any of them answered negatively; `VERIFIED` when every
  applicable one answered positively; `PENDING` while any answer is
  still missing; `NOT_APPLICABLE` when the contractor has neither
  identifier, so no registry applies — possible only when `countryCode`
  is not `PL` (see "`Contractor.countryCode` is required" below).
  `NOT_APPLICABLE` does not block a payment (see "Payment eligibility").
- **Background check at registration.** `createContractor`, and
  `updateContractor` when it adds an `euVatNumber`, enqueue
  `verifyContractorRegistry`, which now runs VIES for `euVatNumber` next
  to GUS for `nip`. Neither blocks registration.
- **On demand:** `checkContractorVies` behind
  `POST /api/contractors/:id/verify-vies` calls VIES synchronously with a
  10-second timeout and returns `{ status: 'VALID' | 'INVALID' |
  'NOT_CHECKED', checkedAt, requestId }`. A `VALID`/`INVALID` answer
  updates `verificationStatus` by the rule above. After the timeout, or
  on any VIES error, the result is `NOT_CHECKED`, the status is left as
  it was, and a `verifyContractorRegistry` job (VIES only) is enqueued to
  retry. Ten seconds keeps the request inside what a person will wait for
  in a form; the retry covers the slow case without a second click.
- **History.** Every VIES call, background or on demand, writes a `VIES`
  row to `ContractorVerificationCheck`; `requestId` is stored when VIES
  returns a request identifier and is `null` otherwise.

**A foreign tax id finds no contractor through the NIP lookup, without
an error, and a contractor without a NIP is outside the whitelist.**
A module importing a supplier document passes the seller's tax id as
printed; for a foreign seller that is a VAT-UE number or a local tax id,
not a NIP.
- **`contractorLookupByNip` returns `null`** for any input that does not
  normalize to a valid Polish NIP (a German `DE…` number, a US EIN, a
  ten-digit string with a wrong checksum), exactly as the 2026-10-08
  normalization note already says; it never throws for such input, and
  it never tries to interpret the value as a VAT-UE number. The caller
  treats `null` as "no match" and decides what to do (for AP: keep the
  printed tax id in `vendorSnapshot.taxId` unchanged and let the user
  pick or register the contractor).
- **No lookup by VAT-UE number in Phase 1.** No consumer needs it yet;
  `euVatNumberHash` is used only for duplicate detection.
- **Whitelist status `NOT_APPLICABLE`.** The Ministry's list is searched
  by NIP or REGON (its check and search endpoints take one of them), so a
  contractor without a `nip` cannot be checked — which, since
  `countryCode` is required and `PL` requires a NIP, happens only for a
  contractor outside Poland. `checkBankAccountWhitelist`
  then makes no call and returns `status: 'NOT_APPLICABLE'`,
  `checkedAt`/`requestId` `null`, with only the local reasons; the
  registration check is skipped and no history row is written. A foreign
  supplier registered for Polish VAT has a NIP and is checked like any
  other.

**Reversible deactivation of a contractor and of a bank account, on the
pattern of `lockFiscalPeriod`/`unlockFiscalPeriod`.** Soft delete
(`deletedAt`) removes a row for good from the UI's point of view; what
was missing is a way to stop using a contractor or an account for a
while and bring it back — a vendor relationship paused, an account the
vendor asked not to use until further notice.
- **`isActive` (boolean, default `true`)** on `Contractor` and on
  `ContractorBankAccount`.
- **Commands** `deactivateContractor`/`reactivateContractor` and
  `deactivateContractorBankAccount`/`reactivateContractorBankAccount`
  toggle `isActive` and enforce `enforceCommandOptimisticLock` against
  the caller's `x-om-ext-optimistic-lock-expected-updated-at` header,
  exactly as `lockFiscalPeriod`/`unlockFiscalPeriod` do in
  `2026-08-18-general-ledger-core-engine.md` (Commands). A call that would
  not change the state (deactivating an inactive row) returns `409`.
  Requires `contractors.manage`.
- **Routes:** custom write routes `POST /api/contractors/:id/deactivate`,
  `.../reactivate`, `POST /api/contractors/:id/bank-accounts/:bankAccountId/deactivate`
  and `.../reactivate`, wired through the mutation guard registry
  (mapped to `update`), because toggling is not a field edit — the same
  reasoning as GL's lock/unlock routes. The UI uses `RowActions` +
  `useGuardedMutation` with `retryLastMutation` and surfaces 409s via
  `surfaceRecordConflict`, like GL's fiscal-period list.
- **Effects.** An inactive contractor or account makes every payment
  check return `ACCOUNT_INACTIVE` (see "Payment eligibility").
  Deactivating the primary account clears its `isPrimary`; reactivating
  does not restore it. Lists hide inactive rows by default and offer an
  `isActive` filter. `contractorLookupByNip` still finds an inactive
  contractor and returns `isActive`, so an importing module can tell the
  user the supplier exists but is paused instead of registering it
  twice.
- **Not a substitute for approval or deletion.** Reactivation does not
  reopen the approval decision (`approvalStatus` stays as it is), and a
  soft-deleted row cannot be reactivated. The delete guard still counts
  every bank account that is not soft-deleted, active or not.

**Lookup hashes: the existing `nipHash` mechanism is reused for the
account number (`accountNumberHash`), not a new one.** Checked first:
this document already has a deterministic hash of the NIP for
uniqueness under encryption — the encryption map declares `nip` with
`hashField: 'nip_hash'`, the encryption service writes
`hashForLookup(value)` into that column on every write, and the partial
unique index `(tenant_id, organization_id, nip_hash) where deleted_at is
null` and `contractorLookupByNip` both use it. So the path taken is to
extend that mechanism, not to add a parallel `nipHash`/HMAC design:
- **`account_number` gets `hashField: 'account_number_hash'`** in the
  `contractors:contractor_bank_account` encryption map. The value
  hashed is the normalized IBAN form (see "Bank account numbers are
  validated"), so `"61 1090 1014 0000 0712 1981 2874"` and
  `"PL61109010140000071219812874"` give the same hash. The same
  function writes the history's `account_number_hash`, which is what
  lets a history row be matched to an account after edits.
- **Uniqueness:** a partial unique index `(contractor_id,
  account_number_hash) where deleted_at is null` — one contractor
  cannot hold the same account twice, which would also break the
  one-primary rule. The same number under two different contractors is
  allowed (a factoring company and its client, a group's shared
  account), the same choice Odoo makes with `unique(sanitized_acc_number,
  partner_id)` (see Literature & Prior Art).
- **Search by full value:** a third read-only DI service,
  `contractorLookupByBankAccount({ tenantId, organizationId,
  accountNumber })`, normalizes the input with
  `validateBankAccountNumber`, matches `account_number_hash` (through
  the platform's `lookupHashCandidates`, so values written before a
  pepper was configured still match) among rows with `deleted_at` null,
  and returns `Array<{ contractorId, contractorBankAccountId, purpose,
  isActive }>` — an array, because one number may belong to several
  contractors; `[]` for no match or input that does not validate. No
  PII, unguarded by design like the other two services. The intended
  consumer is rule-based statement matching in Cash & Bank (#6055,
  deferred to its Phase 2), which needs to find the contractor behind a
  counterparty account. There is still no REST filter by number or NIP,
  for the same reason as the 2026-10-08 decision.
- **What the hash is:** HMAC-SHA256 with the installation's lookup
  pepper (see "Verification history" and Risks); `nipHash` is the same
  kind of value, not a plain digest.

**`ContractorBankAccount` gains `currencyCode` (informational) and
`purpose` (`SETTLEMENT` | `VAT`, default `SETTLEMENT`).**
- **`currencyCode`:** optional text, an ISO 4217 alphabetic code
  (three upper-case letters, checked for shape only), with no FK to
  `currencies`. It records the currency the vendor says the account is
  held in. Nothing is converted or blocked on it; Accounts Payable
  Payments uses it to warn when a payment batch's currency differs (see
  #5962). No FK because the registry must not depend on `currencies`
  being enabled and because the value is the vendor's statement, not a
  reference to the tenant's own currency table.
- **`purpose: 'VAT'` marks the contractor's VAT account** (the account
  the bank keeps for split-payment VAT amounts). Such an account gets
  only the format validation (`validateBankAccountNumber`); it is never
  checked against the whitelist (the registration check skips it, the
  "verify now" button is not shown), it can never be `isPrimary`, and it
  is never a payment target for Accounts Payable: `checkBankAccountWhitelist`
  refuses it with a typed error `{ code:
  'CONTRACTOR_BANK_ACCOUNT_NOT_SETTLEMENT' }` (`422`) before any
  evaluation, and the bank-account list offers a `purpose` filter so AP's
  account picker lists only `SETTLEMENT` accounts. Recording it at all is
  useful because a customer's master data contains it and a person
  comparing documents needs to see it; split payment itself is still not
  modelled (see Legal context).
- **Two more fields in the payment-check result,** so the consumer never
  has to read the encrypted number: `accountNumberLast4` (the last four
  digits of the number checked) and `currencyCode` (the account's, or
  `null`). Accounts Payable uses the first for the masked account in
  `JournalEntryLine.contractorSnapshot` and the second for its currency
  warning (see #5962, #5663).

**A contractor draft does not enter the registry.** A half-filled
contractor is form state on the consumer's side (an unsaved `CrudForm`,
or an AP draft invoice that names a supplier not registered yet), not a
row here. The registry already has its own "exists but not usable yet"
state, `approvalStatus: 'PENDING_APPROVAL'`, which blocks payments (see
"Payment eligibility"). A `DRAFT` row would occupy the NIP's unique slot
before anyone committed to it, start GUS/VIES calls and the approval
workflow for data nobody confirmed, and add a second meaning of "not
usable" next to approval. The 2026-09-08 Workflow definition already
notes that this module has no draft state; this decision makes it final.

**Phase 2: `importBankAccountsFromWhitelist`.** Importing a contractor's
accounts from the Ministry's list, by NIP, is deferred to Phase 2 (see
Implementation Plan → Phase 2): Polish NIPs only, and the first imported
account becomes the primary one when the contractor has none.

**`Contractor.countryCode` is required, and a Polish contractor always
has a NIP and is always checked against the whitelist.** With `nip`
optional and no country on the contractor, a Polish company could be
saved with only a `PL…` VAT-UE number or with no identifier at all, and
its accounts would then get `NOT_APPLICABLE` — a Polish supplier paid
with no whitelist check, the exact case this module exists to stop.
- **`countryCode`:** required at creation, ISO 3166-1 alpha-2,
  upper-case, no default (a default of `PL` would silently mislabel a
  foreign supplier, and the reverse would skip the whitelist).
- **`countryCode: 'PL'` requires `nip` at creation**, normalized and
  checksum-validated by `normalizeNip` (`400` with a field error for an
  invalid NIP, `422 CONTRACTOR_NIP_REQUIRED` when it is missing). Since
  `nip` is set-once, a Polish contractor never loses it.
- **A `PL`-prefixed `euVatNumber` requires `countryCode: 'PL'` and must
  equal `"PL"` + `nip`**, otherwise `422 CONTRACTOR_EU_VAT_NUMBER_MISMATCH`.
  The Polish VAT-UE number is the NIP with the prefix, so a different
  value is a typing error or a wrong contractor.
- **Whitelist `NOT_APPLICABLE` only for `countryCode` other than `PL`**
  and no `nip`. A Polish contractor is always checked (it always has a
  NIP); a contractor from another country with a Polish NIP (registered
  for Polish VAT) is checked too.
- **`verificationStatus: 'NOT_APPLICABLE'`** (no identifier at all) is
  therefore possible only outside Poland.
- **Changing `countryCode`** later is allowed only when the result still
  satisfies these rules (`422` with the same codes otherwise), so a
  Polish contractor cannot be moved abroad to escape the check without
  its NIP rule still holding.

**Retention of the verification history: after a tenant-set period, or
on request, the account digits and hash are cleared; the rest of the
row stays.** The history keeps, per whitelist row, the last four digits
and the lookup hash of a bank account number, which is personal data for
a sole proprietor. Keeping them forever has no legal basis; deleting the
rows would destroy the evidence that a payment was checked.
- **Setting `verificationHistoryRetentionYears`** (tenant scope, through
  `ModuleConfigService` as `contractors.verificationHistoryRetentionYears`),
  an integer of at least 6, default **6**, counted from each row's
  `checkedAt`.
- **Why 6 by default.** Two five-year periods apply to the payment the
  check supports, and both start at a year boundary after the event, so
  the evidence must outlive the event by more than five calendar years:
  - Ordynacja podatkowa, art. 70 § 1 (Dz. U. z 2026 r. poz. 622, tekst
    jednolity): "Zobowiązanie podatkowe przedawnia się z upływem 5 lat,
    licząc od końca roku kalendarzowego, w którym upłynął termin
    płatności podatku." The tax that the check protects (the cost
    deduction, the payer's joint liability) can be assessed until then.
  - Ustawa o rachunkowości, art. 74 ust. 2 pkt 8 and ust. 3 (Dz. U. z
    2026 r. poz. 522, tekst jednolity): "pozostałe dowody księgowe i
    sprawozdania, których obowiązek sporządzenia wynika z ustawy – 5 lat",
    and "Okresy przechowywania ustalone w ust. 2 oblicza się od początku
    roku następującego po roku obrotowym, którego dane zbiory dotyczą."
  Six years from the check covers a check made late in a year whose tax
  is due early the next one; a tenant with a longer horizon (an open tax
  proceeding, a fiscal year that is not the calendar year) raises the
  setting. A value below 6 is rejected.
- **What is cleared:** `accountNumberLast4` and `accountNumberHash` are
  set to `null`. `requestId`, `kind`, `status` and `checkedAt` stay, so
  the history still shows that, when and with which Ministry request id
  a check was made.
- **When:** a daily worker `workers/expireVerificationHistory.ts` clears
  rows older than the setting; the command `anonymizeContractorHistory`
  clears all rows of one contractor at once, regardless of age (an
  erasure request). The command requires a new feature,
  `contractors.erase`, granted by default to `admin` only, and is
  recorded in the command audit log like any other command.
- **The only update the history ever receives.** Both paths only turn
  the two columns from a value to `null`; no path writes any other
  column or deletes a row, so the append-only rule above still holds for
  everything that carries evidential weight.
- **Out of scope:** the snapshots kept by other modules —
  `PaymentBatchLine.whitelistCheckResult.accountNumberLast4` in AP and
  `JournalEntryLine.contractorSnapshot` in GL — follow those modules'
  own rules; this module does not reach into them.

### Alternatives considered

| Alternative | Why Rejected |
|-------------|---------------|
| Extend `customers.CustomerEntity` with tax fields instead of a new module | Violates single responsibility — `customers` is CRM (pipeline, deals), not tax identity; GUS/VIES/Biała Lista is a completely different data lifecycle |
| Separate `Vendor`/`Customer` entities instead of one `Contractor` with flags | Would duplicate GUS/VIES/account data for an entity that is simultaneously a vendor and a customer of the same company |
| Contractor snapshot based on the future `journal_entry_line_dimensions` instead of a field on `JournalEntryLine` | Would create a transitional audit gap — AP invoices posted before the Posting Rules Engine even exists would have no protection at all for contractor history |
| Bank account as a single field/JSON array on `Contractor` | Violates the project's rule against unbounded arrays/nested JSON; doesn't reflect the reality of multiple registered accounts per NIP |
| `lastVerifiedAt`/`lastVerificationStatus` as a shortcut skipping the live check when the cache is "fresh" | Directly violates the "na dzień zlecenia przelewu" rule (art. 15d CIT / art. 22p PIT); restores the cost-deduction and liability risk this module exists to eliminate |
| Sharing a contractor across a tenant's organizations | No precedent in the code and no confirmed business requirement — YAGNI |

## User Stories

- An AP staff member registers a new vendor by entering a NIP — the
  system automatically pulls the name and address from GUS, with no
  manual entry.
- An AP staff member cannot approve a transfer to an account that is
  not on the Biała Lista **today** — the system blocks the payment and
  shows a warning about joint VAT liability risk, regardless of what
  the cache showed the last time the contractor list was visited.
- An accountant reviewing an invoice from six months ago sees exactly
  the vendor's bank account as it was current on the day that invoice
  was posted — even if the vendor later changed accounts.
- The same entity can be registered simultaneously as a vendor (AP)
  and a customer (AR) without duplicating its tax data.
- An AP staff member sees on the contractor list when a given account
  was last checked against the Biała Lista — as helpful information,
  not as a guarantee of current status.

## Literature & Prior Art

Per the financial-spec-writing-process. Verification trail recorded in
full in `financial-module-knowledge-base.md` §3/§4b.

**Cross-spec consistency (Step 1) — one real staleness bug found and
fixed.** This document's own "Related" header still described
`sales-invoice-gl-posting` as "planned, not yet written" — that spec
now exists, has gone through two independent review passes plus its
own literature-verification pass, and has an open PR (#6046,
`docs/sales-invoice-gl-posting`). Corrected above. Everything else in
the header re-verified against the current knowledge-base module map:
Accounts Payable (#5962) and the GL core engine (#5663) are both still
open, unmerged — no change needed there. Separately: this module was
missing entirely from `financial-module-knowledge-base.md`'s own §1
module map table despite having a complete spec, an implementation
guide, and a closed external maintainer review (PR #5955) — fixed
there, not here (see that document's own Changelog).

**Literature grounding (Step 2) — the knowledge base's own flagged
Fowler lead, verified and applied; an independent second confirmation
found; a real, un-actioned gap recorded.**

- Fowler, *Analysis Patterns*, Ch.2 "Accountability," §2.1 "Party"
  (pp.17-19) — read in full, not just the chapter intro: "party as the
  supertype of a person or organization... both organizations and
  people carry out actions, have bank accounts, file taxes." This is
  exactly `Contractor`'s own `isVendor`/`isCustomer`-flagged,
  tax-identity-first design — a GUS-registered company and a
  NIP-registered sole proprietorship (JDG) are both parties in exactly
  this sense. One gap the pattern surfaces that this document doesn't
  model explicitly: Fowler's Party has no built-in person/organization
  discriminator column either (he leaves that to a subtype), and
  neither does `Contractor` — the JDG-vs-company distinction only
  surfaces indirectly, through the `gusData`/`viesData` PII-narrowing
  decision (a JDG's registry response carries personal data a
  company's doesn't), rather than as a queryable field. Not a defect —
  Phase 1 doesn't need to query on it — but worth naming as the
  concrete place this document already leans on the distinction
  without declaring it.
- Hay, *Data Model Patterns*, Ch.3 "The Enterprise and Its World,"
  "Parties" (pp.23-24) — read in full: arrives at the identical
  PERSON/ORGANIZATION → PARTY generalization independently of Fowler
  ("both people and organizations have 'names' and 'addresses' as
  attributes, and both may be parties to contracts"), and names "a
  vendor" explicitly as an ORGANIZATION example. Two independent
  sources converging on the same pattern for the same kind of entity
  is a stronger confirmation than either alone — this closes the
  second half of the knowledge base's flagged lead (previously only
  Fowler's had been spot-checked).
- Fowler, Ch.5 "Referring to Objects," §5.3 "Object Merge" (pp.90-92)
  — read in full, the other lead the knowledge base had flagged and
  left unchecked. Confirms this document has no equivalent mechanism
  today for the case Fowler describes: two `Contractor` rows later
  discovered to be the same real-world entity (a duplicate created
  before `nipHash` uniqueness caught it, or — a case specific to this
  domain, not Fowler's hospital example — a company that re-registers
  under a new NIP after a legal reorganization). NIP uniqueness
  prevents the exact-duplicate case but not the two-different-NIPs-
  same-entity case, and `nip`'s unconditional immutability (see Design
  decisions) forecloses fixing it in place. Fowler names three
  strategies — copy-and-replace, superseding, essence/appearance — and
  recommends essence/appearance specifically when a merge might later
  need undoing, which fits this module's own risk-averse posture
  toward `Contractor` identity (a NIP change requires a new contractor
  rather than editing one, precisely to avoid a similarly irreversible
  mistake). **Recorded as a real, currently un-addressed gap, not
  applied to the spec**: no Phase 1 user story or Design decision names
  this need, and there's no evidence in the codebase that it has come
  up yet — consistent with this document's own YAGNI stance elsewhere
  (cross-org sharing, async consumers of
  `contractors.contractor.created`). Flagged here as a candidate
  Phase 2/Out-of-scope item for a future pass, not added unilaterally.

**Comparison against real systems (Step 3) — ERPNext, Comarch ERP
Optima/XL, enova365.**

- **ERPNext** (docs verified 2026-09-12): Customer and Supplier are
  **separate doctypes**, not one shared entity — the opposite of this
  document's own `isVendor`/`isCustomer`-flagged `Contractor`, and of
  Odoo's `res.partner` (already this document's cited Market
  Reference). ERPNext instead offers "Common Party Accounting," a
  bridge that links an existing Customer to an existing Supplier
  record after the fact (fosserp.com, "Common Party Accounting in
  ERPNext") — two drifting records kept in sync by a pointer, not one
  row. Genuine, checkable divergence worth recording: this document's
  single-entity design avoids the two-drifting-copies problem ERPNext's
  bridge has to manage, at the cost of a `Contractor` that isn't purely
  "vendor" or purely "customer" shaped. Separately, ERPNext's generic
  rename tool ships a "Merge with existing" option across master
  doctypes (Customer, Supplier, Item, Account) that "merge[s] all the
  linked documents of both documents" into the surviving record —
  functionally Fowler's copy-and-replace strategy (§5.3.1 above),
  applied generically rather than per-domain. This is the concrete,
  real-system evidence that the Object Merge gap above is a genuine,
  solvable feature class, not a hypothetical one.
- **Comarch ERP Optima** (pomoc.comarch.pl, "Weryfikacja statusu
  VAT/VAT-UE kontrahenta," verified 2026-09-12): VAT/VIES status
  re-verification is automatic **on every commercial document** a
  kontrahent is used on (invoice, receipt — not just once at
  registration), with a manual button reserved for backdated documents.
  This document's own `verificationStatus` (GUS/VIES) only ever runs
  once, asynchronously, at `createContractor` time — a real, narrower
  Phase 1 scope than Optima's baseline. Not a defect — nothing in
  Problem Statement claims otherwise — but a genuine candidate for a
  future re-verification trigger, worth naming rather than silently
  matching.
- **Comarch ERP Optima/XL, Biała Lista** (elte-s.com, "Biała Lista
  Podatników w systemach Comarch ERP Optima i XL," verified
  2026-09-12): the whitelist is re-checked at multiple transaction
  points (purchase invoice, bank payment export) with the result
  "zapisane na karcie kontrahenta" (saved on the contractor's card) —
  the same UX-cache shape as this document's
  `lastVerifiedAt`/`lastVerificationStatus`. One useful, previously
  unstated nuance: the Ministry's own source data refreshes only once
  per business day, so a "live" call at transfer time is, in practice,
  only as fresh as that day's publication regardless of how it's
  implemented — worth a one-line awareness note, not a design change,
  since the requirement ("na dzień zlecenia przelewu", art. 15d CIT /
  art. 22p PIT) is about *when you check*, not the source's own refresh
  cadence (the once-per-business-day refresh is itself stated in art. 96b
  ust. 8 VAT Act), and this document already gets that distinction right.
- **No four-eyes/approval-gate precedent found** in either Optima's or
  enova365's public documentation for vendor/kontrahent registration —
  the one-step `contractors.vendor-approval` gate this document adds is
  confirmed to be a control **beyond** the real Polish ERP baseline,
  not a reproduction of one. This strengthens, rather than weakens, the
  case already made in Design decisions (the AFP's 2025 survey,
  Trustpair's fraud-scheme research, SAP Ariba/ApprovalMax precedent):
  the gate is this project's own choice to exceed local market
  practice, backed by evidence, not an assumption that "everyone
  already does this."

**Bank accounts and verification evidence (2026-10-20), for Design
decisions 2026-10-20.**

- **Ministry of Finance whitelist API** (`wl-api.mf.gov.pl`, checked
  2026-10-20): the check endpoints
  (`/api/check/nip/{nip}/bank-account/{bank-account}`, and the REGON
  variant) return `accountAssigned` ("Czy rachunek przypisany do
  podmiotu czynnego"), `requestDateTime` and `requestId`; the search
  endpoints (`/api/search/nip/{nip}`, `/api/search/bank-accounts/{…}`
  and the plural NIP/REGON searches, at most 30 identifiers per call)
  return `requestDateTime` and `requestId` too. **Confirmed** — the
  basis of the `{ status, checkedAt, requestId }` contract.
- **Odoo 18** (`odoo/addons/base/models/res_bank.py`,
  `addons/base_iban/models/res_partner_bank.py`, read 2026-10-20):
  `res.partner.bank` has `acc_number`, a stored `sanitized_acc_number`,
  an optional `currency_id`, `active` (default `True`),
  `allow_out_payment`, and the constraint `unique(sanitized_acc_number,
  partner_id)`. `base_iban` validates the length per country template and
  the mod-97 rule (`digits % 97 != 1` fails), and only for accounts whose
  type is IBAN. Directly comparable to this document's normalized number
  + per-contractor uniqueness, optional currency and reversible
  `isActive`; Odoo has no whitelist or VIES evidence on the bank account
  itself. **Partially comparable.**
- **ERPNext** (docs.frappe.io, "Bank Account", read 2026-10-20): a bank
  account can belong to a Customer or Supplier; IBAN is a separate
  field ("Leave it empty when the country does not use IBAN"); "Is
  Default" — "Maintain only one intended default". The page does not
  state an IBAN checksum rule. **Comparable** for party-owned accounts
  and one default; checksum **Unverified** from the documentation.
- **Comarch ERP Optima** (pomoc.comarch.pl, version 2025, "Ogólne i
  Kasa/Bank", read 2026-10-20): the "Historia weryfikacji rachunków
  bankowych" table stores "Data sprawdzenia", "NIP", "W Wykazie" and
  "Identyfikator wyszukiwania – unikalny identyfikator otrzymany po
  sprawdzeniu", and a serial operation "Zweryfikuj status VAT i rachunki
  bankowe" runs on the contractor list. **Confirmed** as the closest
  real-system precedent for `ContractorVerificationCheck`. An "import
  accounts from the VAT list" button appears in search-result summaries
  of the same help site but was not on the page read — **Unverified**.
- **Comarch ERP XL:** no public help page on contractor bank-account
  verification was found this pass — **Unverified**.
- **Fowler, Hay, Kieso:** not re-read this pass (the PDFs were not
  readable in this session). From the passages already verified on
  2026-09-12 and quoted above, Fowler's Party says only that parties
  "have bank accounts" — no account structure, validation or
  verification. Whether any of the three books covers account
  validation or registry verification is **Unverified**; recorded as
  such in `financial-module-knowledge-base.md`.

**Structure (Step 4) — already compliant, no gaps.** Checked against
`om-spec-writing`'s required sections (TLDR, Overview, Problem
Statement, Proposed Solution, Architecture, Data Models, API Contracts,
Risks & Impact Review, Final Compliance Report, Changelog) plus this
project's fuller convention (Design decisions, Alternatives considered,
User Stories, Implementation Plan, File Manifest, Testing Strategy, Out
of scope): all present. The Open Questions section that existed
briefly on 2026-09-07 (Q1, the `approveContractor` scope-cohesion SPLIT
finding) was resolved and removed the same round, per the template's
own instruction — no open questions remain.


## Architecture

### Entities (`data/entities.ts`)

- `Contractor` — `isVendor` (bool), `isCustomer` (bool), `name`,
  `countryCode` (required ISO 3166-1 alpha-2, no default, added
  2026-10-20 — `PL` requires `nip`, see Design decisions),
  `nip` (nullable since 2026-10-20, set-once; + `nipHash` for lookup on the encrypted column, unique per
  `(tenant_id, organization_id)` while `deletedAt` is null — a partial
  index, see Design decisions — duplicate detection), `euVatNumber`
  (added 2026-10-20 — nullable, set-once, encrypted, + `euVatNumberHash`
  with the same partial uniqueness), `address`,
  `contactEmail`, `contactPhone`, `verificationStatus`
  (`PENDING`/`VERIFIED`/`FAILED`/`NOT_APPLICABLE`, derived from GUS and
  VIES, see Design decisions, 2026-10-20), `lastCheckStatus`/`lastCheckedAt`/
  `lastCheckRequestId` (typed, non-PII registry-check diagnostics —
  see Design decisions; **not** the raw GUS/VIES response),
  `createdByUserId` (see Design decisions — backs the self-approval
  guard on `applyContractorApprovalDecision`), tenant/org scoped,
  `updatedAt` (user-editable → optimistic lock), `isActive` (added
  2026-10-20 — reversible deactivation, see Design decisions), `deletedAt` (soft
  delete — per the standard column contract; deletion blocked only
  while a not-deleted `ContractorBankAccount` exists — a `JournalEntryLine`
  check was considered and dropped, see Design decisions).
  Confirmed in scope, 2026-09-08 (see Design decisions):
  `approvalStatus`
  (`PENDING_APPROVAL`/`APPROVED`/`REJECTED`), `approvedByUserId`,
  `approvedAt` — set only by `applyContractorApprovalDecision` from
  inside the workflow, never through `updateContractor` (see Design
  decisions, Workflow definition). `verificationStatus` (GUS/VIES) and
  `approvalStatus` (human approve/reject) are independent, parallel
  fields — Phase 1 does not gate registration or verification on
  approval, but `checkBankAccountWhitelist` does gate on it (see
  Design decisions, Commands): a `PENDING_APPROVAL`/`REJECTED`
  contractor's bank account can never pass the live whitelist call a
  payment depends on.
- `ContractorBankAccount` — `contractorId` (FK to `Contractor`),
  `accountNumber` (encrypted, stored in normalized IBAN form) +
  `accountNumberHash` (lookup hash, added 2026-10-20), `currencyCode`
  (optional ISO 4217 text, informational, no FK, added 2026-10-20),
  `purpose` (`SETTLEMENT`/`VAT`, default `SETTLEMENT`, added 2026-10-20 —
  a `VAT` account is format-validated only, never whitelist-checked,
  never primary, never a payment target), `isPrimary` (bool — exactly one primary
  among `SETTLEMENT` accounts
  per contractor, enforced by both the command and a partial unique
  index, see Design decisions), `lastVerifiedAt` (nullable,
  UX cache — see Design decisions), `lastVerificationStatus`
  (`WHITELISTED`/`NOT_WHITELISTED`/`UNKNOWN`, UX cache), its own
  `organizationId`/`tenantId` (own scope columns, matching the
  `JournalEntryLine`/`SalesInvoiceLine` precedent — see Design
  decisions), `updatedAt`, `isActive` (added 2026-10-20 — reversible
  deactivation, distinct from deletion), `deletedAt` (soft delete rather than
  actual deletion — account history has audit value; not reversible
  from the UI, unlike `isActive`).
- `ContractorVerificationCheck` (added 2026-10-20) — append-only history
  of every GUS, VIES and Biała Lista call: `contractorId`,
  `contractorBankAccountId` (nullable), `kind`, `status`, `checkedAt`,
  `requestId`, `accountNumberLast4`, `accountNumberHash`, own
  `organizationId`/`tenantId`, `createdAt`; no `updatedAt`/`deletedAt`
  (see Design decisions, 2026-10-20).

### Access Control (`acl.ts`)

Following the `customers` module convention
(`<module>.<resource>.view` / `.manage`, `manage` depends on `view`):

```typescript
export const features = [
  { id: 'contractors.view', title: 'View contractors', module: 'contractors' },
  { id: 'contractors.manage', title: 'Manage contractors', module: 'contractors', dependsOn: ['contractors.view'] },
  { id: 'contractors.approve', title: 'Approve contractors', module: 'contractors', dependsOn: ['contractors.view'] },
  { id: 'contractors.erase', title: 'Anonymize contractor verification history', module: 'contractors', dependsOn: ['contractors.view'] },
]
```

`contractors.erase` (added 2026-10-20) guards `anonymizeContractorHistory`
(see Design decisions, "Retention of the verification history").

`createContractor`/`updateContractor`/`createContractorBankAccount`/
`updateContractorBankAccount` require `contractors.manage` at the
route/page level (a plain `registerCommand` carries no ACL of its
own — enforcement is declarative, via `metadata.requireFeatures` on
the API route and on the backend page). `applyContractorApprovalDecision`
requires `contractors.approve`, not `contractors.manage` (see Design
decisions) — enforced via `registerWorkflowSafeCommands`'s
`requiredFeatures`, the one command-adjacent ACL mechanism that
actually exists in this repo. `checkBankAccountWhitelist`'s own HTTP
route (this module's "verify now" button) requires `contractors.view`.
The DI-resolved path used by `accounts_payable_payments` (see DI
Registrar, Cross-module integration) bypasses this route entirely and
is unguarded by design — the caller owns authorization for its own
request, the same as any other `tryResolve`d service call.

### Module Setup (`setup.ts`)

`defaultRoleFeatures` for `admin`/`employee`, split deliberately
(2026-09-08, second review pass — the four-eyes fix has no teeth if
this table isn't spelled out): `admin` gets all three features
(`contractors.view`/`.manage`/`.approve`); `employee` gets
`contractors.view`/`.manage` only, **not** `.approve` — the person who
can register a vendor is, by default, never also the person who can
approve one. This is the concrete wiring the `contractors.approve`
feature (see Access Control, Design decisions) depends on; declaring
the feature without this split would ship the four-eyes fix granted to
nobody, or worse, silently re-bundled onto the same role as
`contractors.manage`. Added 2026-10-20: `admin` also gets
`contractors.erase`; `employee` does not. Mirrors GL's `acl.ts` sync pattern otherwise. No
`seedDefaults` hook — unlike GL's jurisdiction dictionaries, there is
no system reference data to seed here;
contractors are entirely tenant-authored.

### DI Registrar (`di.ts`)

Registers `checkBankAccountWhitelist` as a resolvable service (DI
token `contractorBankWhitelistCheck`) — this is what makes it usable
as a synchronous, in-process cross-module call per
`packages/core/AGENTS.md` → Cross-Module Coupling, instead of forcing
a consumer into an HTTP round-trip to its own app for a same-request
need (see Queries / API and Cross-module integration below for the
resolved design; this was corrected during independent compliance
review — see Changelog).

**Added 2026-10-08 — `contractorLookupByNip`, a second DI-resolvable,
read-only service.** Registered in `di.ts` next to
`contractorBankWhitelistCheck`, for the same reason (a synchronous,
in-process, same-request need that must not become an HTTP round-trip
to the app itself). Signature:

```ts
contractorLookupByNip(params: {
  tenantId: string
  organizationId: string
  nip: string
}): Promise<{
  id: string
  isVendor: boolean
  isCustomer: boolean
  approvalStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
  verificationStatus: 'PENDING' | 'VERIFIED' | 'FAILED' | 'NOT_APPLICABLE'
  isActive: boolean
} | null>
```

- **Lookup key is `nipHash`**, scoped to `(tenant, organization)` and
  `deleted_at is null` — the same partial unique index
  `createContractor`'s duplicate detection already uses, so at most one
  row can match.
- **Returns no PII.** Never `nip`, name, address, contact or bank data;
  those stay behind `findWithDecryption` in this module's own routes. A
  consumer that needs the contractor's name or tax id for its own
  snapshot reads them through this module's authorized API, not through
  this service.
- **Read-only.** It never writes, never calls GUS/VIES/Biała Lista and
  never reads `lastVerifiedAt` as a source of truth (same rule as
  `checkBankAccountWhitelist`).
- **Unguarded by design,** like `contractorBankWhitelistCheck`: the
  caller owns authorization for its own request.
- **NIP normalization (decided 2026-10-08).** One shared function,
  `normalizeNip(raw)`, used by `createContractor`, `updateContractor`
  (which rejects a change anyway) and this lookup, so `"PL 123-456-78-90"`
  and `"1234567890"` resolve to the same `nipHash`. It strips spaces,
  dashes and a leading `PL` (case-insensitive) and accepts the result only
  if it is ten digits with a valid checksum (weights 6, 5, 7, 2, 3, 4, 5,
  6, 7; the weighted sum modulo 11 must equal the tenth digit; a remainder
  of 10 is invalid). `contractorLookupByNip` returns `null`, without an
  error, for input that does not normalize (a malformed or non-Polish tax
  id): Phase 1 matches Polish NIPs only, and the caller decides what to do
  with a supplier it cannot match (confirmed for foreign tax ids,
  2026-10-20, see Design decisions). This note does not change what
  `createContractor` already accepts or rejects; it only fixes the form
  that is hashed.
- **Not found returns `null`.** The caller decides what to do next; if
  it wants the contractor to exist it calls `createContractor` (through
  the command bus), which starts `PENDING_APPROVAL` and triggers the
  `contractors.vendor-approval` workflow exactly as a manual registration
  does.

**Added 2026-10-20 — `contractorLookupByBankAccount`, a third
DI-resolvable, read-only service** (see Design decisions, 2026-10-20,
"Lookup hashes"):

```ts
contractorLookupByBankAccount(params: {
  tenantId: string
  organizationId: string
  accountNumber: string
}): Promise<Array<{
  contractorId: string
  contractorBankAccountId: string
  purpose: 'SETTLEMENT' | 'VAT'
  isActive: boolean
}>>
```

Normalizes the input with `validateBankAccountNumber`, matches
`account_number_hash` among rows with `deleted_at` null in the caller's
tenant and organization, returns no PII, writes nothing, calls no
registry, and is unguarded by design like the other two services. An
input that does not validate returns `[]`, not an error.

### Commands (Command Pattern, `commands/`)

- `createContractor` — validates NIP uniqueness (via `nipHash` lookup)
  and VAT-UE number uniqueness (via `euVatNumberHash`, added 2026-10-20)
  per `(tenant, organization)`, enforces the country rules (added
  2026-10-20: `countryCode: 'PL'` requires a valid `nip`, `422
  CONTRACTOR_NIP_REQUIRED` when missing; a `PL`-prefixed `euVatNumber`
  requires `countryCode: 'PL'` and must equal `"PL"` + `nip`, `422
  CONTRACTOR_EU_VAT_NUMBER_MISMATCH` otherwise), persists with
  `verificationStatus: 'PENDING'` (`'NOT_APPLICABLE'` when it has
  neither identifier, possible only outside Poland),
  enqueues `verifyContractorRegistry` worker (GUS for `nip`, VIES for
  `euVatNumber`). `updateContractor` applies the same country rules to
  a changed `countryCode`.
- `updateContractor` — rejects any change to a set `nip` or
  `euVatNumber` (adding a missing one is allowed and enqueues the
  matching check, 2026-10-20; see Design decisions); everything else editable; enforces
  optimistic lock via `updated_at`.
- `createContractorBankAccount` / `updateContractorBankAccount` —
  standard CRUD; `isPrimary: true` on one account automatically
  unsets it on any other account for the same contractor (single
  invariant enforced in the command, not left to the client). Both
  commands validate and normalize `accountNumber` with
  `validateBankAccountNumber` (IBAN/NRB, checksum; `400` otherwise, see
  Design decisions, 2026-10-20). After
  saving a new account, or a changed `accountNumber`, the command
  enqueues, for a `SETTLEMENT` account of a contractor with a `nip`,
  `workers/verifyContractorBankAccount.ts` (background whitelist
  check; a negative answer only sets the warning status, see Design
  decisions, 2026-10-20).
- `checkBankAccountWhitelist` — **not a plain query**: returns the
  payment-eligibility result `{ eligible, reasons, status, checkedAt,
  requestId, accountNumberLast4, currencyCode }` (see Design decisions,
  2026-10-20, "Payment eligibility"). A `VAT`-purpose account is refused
  before anything else, with `422 CONTRACTOR_BANK_ACCOUNT_NOT_SETTLEMENT`.
  It then evaluates the local reasons (`NOT_APPROVED`,
  `VERIFICATION_FAILED`, `ACCOUNT_INACTIVE`); if any applies it returns
  `eligible: false` with `status: 'NOT_CHECKED'` before any network
  call — otherwise performs a live call to the Ministry of
  Finance's Biała Lista API for the given `accountNumber` and `nip`,
  returns the fresh result to the caller (the Ministry's own
  `requestDateTime` and `requestId`, see Design decisions, 2026-10-20),
  with `WHITELIST_NEGATIVE` or `WHITELIST_UNAVAILABLE` as the reason when
  it fails, and — as a side effect
  only — updates `lastVerifiedAt`/`lastVerificationStatus` on the
  matching `ContractorBankAccount` for UX display. Never reads
  `lastVerifiedAt` to short-circuit the live call (see Design
  decisions). Idempotent to call repeatedly. Registered in `di.ts` as
  a resolvable service (see DI Registrar above) — this is the
  sanctioned entry point for another module to call it synchronously
  in the same request; the HTTP route below wraps the same command
  only for this module's own backend UI.
- `checkContractorVies` (added 2026-10-20) — on-demand VIES check of
  `euVatNumber`, synchronous with a 10-second timeout; returns
  `{ status: 'VALID' | 'INVALID' | 'NOT_CHECKED', checkedAt, requestId }`,
  writes a `VIES` history row, updates `verificationStatus` on a
  `VALID`/`INVALID` answer, and on `NOT_CHECKED` enqueues a VIES-only
  `verifyContractorRegistry` retry (see Design decisions, 2026-10-20).
  Rejects with `422` when the contractor has no `euVatNumber`.
- `deactivateContractor` / `reactivateContractor` and
  `deactivateContractorBankAccount` / `reactivateContractorBankAccount`
  (added 2026-10-20) — toggle `isActive`, enforce
  `enforceCommandOptimisticLock` against the caller's
  `x-om-ext-optimistic-lock-expected-updated-at` header (the
  `lockFiscalPeriod`/`unlockFiscalPeriod` pattern), `409` when the row is
  already in the target state; deactivating the primary account clears
  `isPrimary`. Require `contractors.manage`.
- `anonymizeContractorHistory` (added 2026-10-20) — sets
  `accountNumberLast4` and `accountNumberHash` to `null` on every
  `ContractorVerificationCheck` row of one contractor, whatever their
  age; leaves `requestId`, `kind`, `status` and `checkedAt`. Requires
  `contractors.erase`; idempotent (a second call changes nothing). The
  daily `workers/expireVerificationHistory.ts` does the same for rows
  whose `checkedAt` is older than `verificationHistoryRetentionYears`
  (see Design decisions, 2026-10-20).
- `applyContractorApprovalDecision` — **confirmed in scope,
  see Design decisions.** Called **only** from inside the
  `contractors.vendor-approval` workflow (not directly from the UI),
  via `UPDATE_ENTITY`, `PENDING_APPROVAL` → `APPROVED` or `REJECTED`
  and nothing else (accepts no other fields). Registered separately in
  `registerWorkflowSafeCommands`, requires `contractors.approve`, a
  distinct feature from `contractors.manage` (see Design decisions,
  2026-09-08) — and additionally rejects with `{ code:
  'SELF_APPROVAL_NOT_ALLOWED' }` (`422`, surfaced through the generic
  `POST /api/workflows/tasks/:id/complete` route's error passthrough —
  this module has no dedicated approval route, see API Contracts) if
  the acting user equals the contractor's own `createdByUserId`
  (self-approval guard, see Design decisions). **Deliberately not
  `updateContractor`**
  — see Design decisions
  ("`approveContractor`'s mechanism is now resolved") for the
  contradiction this avoids, mirroring AP's identical fix to the same
  latent issue in `sales.order-approval`. **Reversibility (added
  2026-09-08, flagged by review):** this transition is final — once
  `APPROVED`/`REJECTED`, there is no resubmission path back to
  `PENDING_APPROVAL` on the same task, mirroring
  `accounts_payable_payments`'s own explicit stance for
  `applyVendorInvoiceApprovalDecision` ("the decision is documented
  and irreversible without a trace"). A rejected contractor that
  should be reconsidered is corrected and re-registered as a new
  pending case, not resubmitted onto the same approval task.

### Events

**`contractors.contractor.created` (persistent), emitted by
`createContractor` — confirmed in scope, 2026-09-08 (see Design
decisions).** Its sole purpose is triggering the
`contractors.vendor-approval` workflow (see Workflow definition) —
exactly mirroring `sales.order.created` triggering
`sales.order-approval`, not a general-purpose "contractor created"
notification for other consumers. This event exists solely for that
trigger; nothing else in this module needs it. AP
still consumes `Contractor`/`ContractorBankAccount` by resolving this
module's `di.ts`-registered service directly (see DI Registrar and
Cross-module integration below) at the moment it needs an answer —
payment approval and vendor registration are both synchronous,
user-initiated flows, not something a downstream module needs to react
to automatically after the fact. Revisit further async use if a real
consumer emerges (YAGNI — matches the same reasoning already used for
cross-organization sharing).

### Workflow definition (`workflows.ts`)

**Confirmed in scope, 2026-09-08** (see Design decisions). A 1:1
mirror of the `sales.order-approval` pattern
(`packages/core/src/modules/sales/workflows.ts`) — not a new
mechanism, the same one AP already adopted for its own invoice
approval:

```typescript
import { defineWorkflow, createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

registerWorkflowSafeCommands([
  { commandId: 'contractors.contractor.applyApprovalDecision', requiredFeatures: ['contractors.approve'] },
])

const vendorApproval = defineWorkflow({
  workflowId: 'contractors.vendor-approval',
  workflowName: 'Contractor Vendor Approval Workflow',
  steps: [
    { stepId: 'start', stepType: 'START' },
    {
      stepId: 'pending_approval',
      stepType: 'USER_TASK',
      userTaskConfig: {
        formSchema: {
          type: 'object',
          required: ['decision'],
          properties: {
            comments: { type: 'string' },
            decision: { enum: ['approve', 'reject'], type: 'string' },
          },
        },
        slaDuration: 'PT24H',
      },
    },
    { stepId: 'approved', stepType: 'AUTOMATED' },
    { stepId: 'rejected', stepType: 'AUTOMATED' },
    { stepId: 'end', stepType: 'END' },
  ] as const,
  transitions: [ /* start→pending_approval (auto), pending_approval→approved
                    (preCondition: decision === 'approve'), pending_approval→rejected
                    (preCondition: decision === 'reject'), both →end — identical
                    structure to sales.order-approval, see that file */ ],
  triggers: [{
    triggerId: 'vendor_approval_trigger',
    eventPattern: 'contractors.contractor.created',
    config: { entityType: 'Contractor' },
    enabled: true,
    priority: 0,
  }],
})

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'contractors',
  workflows: [vendorApproval],
})

export default workflowsConfig
```

One structural difference from AP's own `accounts_payable.invoice-approval`,
not from `sales.order-approval`: AP triggers on a separate "submitted"
event because a vendor invoice has an explicit `DRAFT` state before
approval. A contractor has no equivalent draft state — `createContractor`
persists it immediately (already true today, for the unrelated
GUS/VIES check) — so this workflow triggers directly on
`contractors.contractor.created`, exactly like `sales.order-approval`
triggers on `sales.order.created`.

### Queries / API

- `api/contractors/route.ts` — standard `makeCrudRoute` CRUD
  (list/create/update/soft-delete), filterable by `isVendor`,
  `isCustomer`, `verificationStatus`. List/detail responses never
  return raw `nip`/`accountNumber` in plaintext logs (decrypted only
  for the authenticated, authorized caller via `findWithDecryption`).
- `api/contractors/[id]/bank-accounts/route.ts` — standard
  `makeCrudRoute` CRUD for `ContractorBankAccount`, scoped to the
  parent contractor.
- `api/contractors/[id]/bank-accounts/[bankAccountId]/verify/route.ts`
  — custom write route (mapped to `update` in the mutation guard
  registry) invoking `checkBankAccountWhitelist` synchronously and
  returning the live result. This route backs only this module's own
  backend UI (the per-row "verify now" button) — it is **not** the
  integration path for AP. See Cross-module integration below.
- `api/contractors/[id]/deactivate/route.ts`, `.../reactivate/route.ts`,
  `api/contractors/[id]/bank-accounts/[bankAccountId]/deactivate/route.ts`,
  `.../reactivate/route.ts` (added 2026-10-20) — custom write routes
  (mapped to `update` in the mutation guard registry) for the
  deactivation commands, like GL's fiscal-period lock/unlock routes.
- `api/contractors/[id]/verification-checks/route.ts` (added
  2026-10-20) — read-only list of the verification history (see API
  Contracts); no write route.
- **Removed 2026-09-08**: no dedicated approve route. See API
  Contracts, "Contractor approval — no dedicated route" — approval
  (confirmed in scope, 2026-09-08) completes through the generic
  `POST /api/workflows/tasks/:id/complete`.

- **No `nip` filter on `GET /api/contractors` (decided 2026-10-08).**
  `nip` is encrypted and only `nipHash` is queryable; a REST filter would
  add a second lookup path without a consumer that needs it. Lookup by
  NIP for other modules goes through `contractorLookupByNip` (see DI
  Registrar). Revisit only if this module's own list UI needs it.

### Cross-module integration

**Corrected 2026-09-08**: the consumer named below is
`accounts_payable_payments`, not `accounts_payable` (invoices) — AP
split into the two modules on 2026-09-08 (see
`2026-09-06-accounts-payable-payments.md`), and that document is
explicit that `contractorBankWhitelistCheck` integration lives
exclusively in the payments module, not the invoices one. This
section previously said "AP" generically; corrected for accuracy.

`accounts_payable_payments` does not call the HTTP route above at
payment time. Per `packages/core/AGENTS.md` → Cross-Module Coupling, a
same-request synchronous need on an optional peer resolves that peer's
service locally via a `tryResolve`-in-`try/catch` helper (precedent:
`inbox_ops/subscribers/extractionWorker.ts`,
`shipping_carriers/api/webhook/[provider]/route.ts`) — never a hard
`container.resolve(...)` and never an HTTP call to itself.
`accounts_payable_payments`'s `confirmPaymentBatch` command resolves
`contractorBankWhitelistCheck` (the DI token registered in this
module's `di.ts`) this way and calls it in-process. Two distinct
degradation cases follow from this, both resolving to the same policy
(block the payment, never proceed without a live check — see Risks &
Impact Review):
- **`contractors` module disabled/absent** — `tryResolve` returns
  `undefined`; `accounts_payable_payments`'s own guard treats a
  missing whitelist-check service as "cannot verify," and blocks the
  payment.
- **`contractors` module present, but the live Biała Lista API call
  itself fails** — `checkBankAccountWhitelist` returns `eligible:
  false` with `WHITELIST_UNAVAILABLE` (an unexpected exception is
  treated the same way by the consumer); `accounts_payable_payments`
  blocks the payment the same way.
This module never imports or resolves anything belonging to
`accounts_payable_payments` — the dependency direction is one-way
(`accounts_payable_payments` → `contractors`), matching
`packages/core/AGENTS.md`'s "upstream module MUST NOT import, resolve,
or hard-require the consumer."

**Added 2026-10-08 — second consumer shape: lookup by NIP.** Any module
that imports supplier documents (for example a country plugin turning an
e-invoice into an `accounts_payable` draft) resolves
`contractorLookupByNip` through its own `tryResolve` wrapper and treats
`undefined` (module absent) as "cannot match": it hides or disables the
matching step instead of failing. A `null` result is a normal answer,
not an error. This module never imports or resolves anything belonging
to such a consumer; the dependency direction stays one-way
(consumer → `contractors`).

**Added 2026-10-20 — third consumer shape: lookup by bank account
number.** A module that sees a counterparty account and needs the
contractor behind it (Cash & Bank's deferred rule-based statement
matching, #6055) resolves `contractorLookupByBankAccount` through its own
`tryResolve` wrapper, with the same "module absent means cannot match"
rule. An empty array is a normal answer.

### Backend Pages (`backend/contractors/`)

- `contractors/page.tsx` (+ `create/page.tsx`, `[id]/page.tsx`) —
  `DataTable` + `CrudForm` for `Contractor`; `nip` and `euVatNumber`
  fields disabled on edit once set (immutable once set, see Design
  decisions); a "Check in VIES" button next to `euVatNumber` calls
  `POST /api/contractors/:id/verify-vies` (added 2026-10-20).
- `contractors/[id]/page.tsx` also lists the contractor's
  `ContractorBankAccount` rows inline (own mini `DataTable`; added
  2026-10-20: a Deactivate/Reactivate row action per account, and the
  same action on the contractor list, through `RowActions` +
  `useGuardedMutation`, like GL's fiscal-period lock/unlock), each
  showing the UX-only "last checked: N days ago" badge, plus a
  "Verify now" button per row that calls the live-check route above
  and refreshes the badge.
- `contractors/[id]/page.tsx` also shows the verification history
  (added 2026-10-20): a read-only `DataTable` of
  `ContractorVerificationCheck` rows (kind, status, date, request id,
  last four digits of the account).
- Confirmed in scope, 2026-09-08: an injected approval-task widget at a
  `contractors.contractor.detail:details` spot ID, visible when
  `approvalStatus === 'PENDING_APPROVAL'` and there's a task assigned
  to the current user. **Resolved 2026-09-08** (see Design decisions,
  Workflow definition): this is no longer a `useGuardedMutation` row
  action — mirroring the corrected pattern already used in
  `2026-09-06-accounts-payable.md`, the widget itself is owned and
  defined by `workflows` (real precedent:
  `workflows/widgets/injection/order-approval/`, injected into
  `sales.document.detail.order:details`), not by this module. This
  module only needs to declare and document the spot ID above; the
  widget component and its injection-table entry belong to
  `workflows`.

## Data Models

### Contractor

One row per contractor. `nip`/`nipHash` unique per
`(tenant_id, organization_id)` while `deletedAt` is null — a partial
index, see Design decisions — enforces one registration per tax
identity within an organization and backs duplicate detection at
`createContractor`, while letting a soft-deleted registration free its
NIP for re-registration. `nip` is nullable (2026-10-20); a `null`
`nip_hash` is outside the index. `euVatNumber`/`euVatNumberHash` (added
2026-10-20) carries the same partial unique index on
`(tenant_id, organization_id, eu_vat_number_hash) where deleted_at is null`.
`country_code` (added 2026-10-20): text, not null, `^[A-Z]{2}$`
(ISO 3166-1 alpha-2), no default; a row with `country_code = 'PL'`
always has a `nip` (enforced by the commands, and by a check constraint
`country_code <> 'PL' or nip_hash is not null`).
`verificationStatus` starts `PENDING` (`NOT_APPLICABLE` with neither
identifier, only outside Poland), moves
to `VERIFIED`/`FAILED` asynchronously via the `verifyContractorRegistry`
worker (GUS for `nip`, VIES for `euVatNumber`; derivation rule in
Design decisions, 2026-10-20) or through `checkContractorVies`.
`lastCheckStatus`/`lastCheckedAt`/`lastCheckRequestId` —
typed, non-PII diagnostics only, never the raw GUS/VIES payload (see
Design decisions) — never read as a source of truth by any command,
only surfaced in the UI. `deletedAt` blocks deletion only while an
active `ContractorBankAccount` exists (enforced in `updateContractor`'s
delete path — see Commands); a `JournalEntryLine`-based guard was
considered and dropped (see Design decisions).

Confirmed in scope, 2026-09-08 (see Design decisions):
`approvalStatus` (`PENDING_APPROVAL`/`APPROVED`/`REJECTED`),
`approvedByUserId`, `approvedAt` on this entity — also listed
directly in Architecture → Entities. Added 2026-09-08, second review
pass: `createdByUserId` (set once, at `createContractor` time, to the
authenticated caller) — backs the self-approval guard on
`applyContractorApprovalDecision` (see Design decisions, Commands),
also listed directly in Architecture → Entities.

Supporting index for the `contractors` list filters (see API
Contracts / Queries-API): `(tenant_id, organization_id, is_vendor,
is_customer, verification_status)` on `contractor` backs the
`isVendor`/`isCustomer`/`verificationStatus` filters together (mirrors
the composite-index approach in #5663's `journal_entry`/
`journal_entry_line` indexes).

### ContractorBankAccount

One row per bank account registered for a contractor. `accountNumber`
encrypted at rest. `isPrimary` — exactly one `true` per contractor,
enforced by both the command (unsets any existing primary in the same
transaction) and a partial unique index at the database level (see
Design decisions), closing the concurrent-race gap a command-only
invariant would leave open. `lastVerifiedAt`/`lastVerificationStatus` — UX cache only,
written only as a side effect of `checkBankAccountWhitelist`, never
read by any command to skip the live check (see Design decisions).
Own `organizationId`/`tenantId` (see Design decisions). `is_active`:
boolean, default `true` (added 2026-10-20), also on `contractor`.
`currency_code`: text, nullable, `^[A-Z]{3}$` (added 2026-10-20).
`purpose`: text, `SETTLEMENT` | `VAT`, not null, default `SETTLEMENT`
(added 2026-10-20); `contractor_bank_account_one_primary_uq` is unchanged
and the command rejects `isPrimary: true` on a `VAT` account.

Supporting index: `(tenant_id, organization_id, contractor_id)` on
`contractor_bank_account` backs the inline-list lookup from a
contractor's detail page and the primary-account uniqueness check in
`createContractorBankAccount`/`updateContractorBankAccount`. Added
2026-10-20: a partial unique index `(contractor_id, account_number_hash)
where deleted_at is null` (one contractor cannot hold the same account
twice), and `(tenant_id, organization_id, account_number_hash)` backing
`contractorLookupByBankAccount`.

### ContractorVerificationCheck

Added 2026-10-20 (see Design decisions). One row per registry call,
never updated or deleted.

- `id`: uuid (PK)
- `tenant_id`, `organization_id`: uuid (own)
- `contractor_id`: uuid (FK → `contractor`)
- `contractor_bank_account_id`: uuid, nullable (FK →
  `contractor_bank_account`; set for `WHITELIST` rows, `null` for
  `GUS`/`VIES`). The row stays valid after the account is edited or
  soft-deleted, because it carries its own copy of what was checked.
- `kind`: text (`WHITELIST` / `GUS` / `VIES`)
- `status`: text — `WHITELIST`: `WHITELISTED` / `NOT_WHITELISTED` /
  `NOT_CHECKED`; `GUS`: `FOUND` / `NOT_FOUND` / `NOT_CHECKED`; `VIES`:
  `VALID` / `INVALID` / `NOT_CHECKED`. `NOT_CHECKED` means the call was
  made and no answer arrived.
- `checked_at`: timestamptz — the registry's own timestamp when it
  returns one (the Ministry's `requestDateTime`), otherwise the time of
  the call
- `request_id`: text, nullable — the registry's identifier of the query
  (the Ministry's `requestId`); `null` when the registry returned none
- `account_number_last4`: text, nullable — last four digits of the
  normalized number that was checked (`WHITELIST` rows only)
- `account_number_hash`: text, nullable — `hashForLookup` of the
  normalized number that was checked (`WHITELIST` rows only), the same
  value as `contractor_bank_account.account_number_hash` for that number
- `created_at`: timestamptz

`account_number_last4` and `account_number_hash` are the only columns
ever changed after insert, and only to `null`, by retention or by
`anonymizeContractorHistory` (added 2026-10-20). Supporting index for
the daily retention worker: `(tenant_id, checked_at) where
account_number_hash is not null`.

Supporting index: `(tenant_id, organization_id, contractor_id,
checked_at)` for the history list on the contractor's page;
`(contractor_bank_account_id, checked_at)` for one account's history.

## API Contracts

### `GET /api/contractors` / `POST /api/contractors`

Standard `makeCrudRoute` list + create.

- **Query**: `page?`, `pageSize?` (≤100), `isVendor?`, `isCustomer?`,
  `verificationStatus?`, `isActive?` (added 2026-10-20; the backend list
  sends `isActive=true` unless the user turns the filter off).
- **Create body**: `{ isVendor, isCustomer, name, countryCode, nip?,
  euVatNumber?, address, contactEmail, contactPhone }` (`nip` optional
  and `euVatNumber` added 2026-10-20; `countryCode` required, added
  2026-10-20 — `nip` is required when it is `PL`). `verificationStatus` not settable —
  starts `PENDING`, or `NOT_APPLICABLE` with neither identifier (only
  outside Poland).
- **Response 400** (create/update, added 2026-10-20): `countryCode` is
  not two upper-case letters; `nip` fails the NIP checksum.
- **Response 422** (create/update, added 2026-10-20):
  `CONTRACTOR_NIP_REQUIRED` — `countryCode: 'PL'` without `nip`;
  `CONTRACTOR_EU_VAT_NUMBER_MISMATCH` — a `PL`-prefixed `euVatNumber`
  with another `countryCode`, or not equal to `"PL"` + `nip`.
- **Response shape** (list/detail): includes `updatedAt` on every
  row, per root `AGENTS.md`'s requirement so `CrudForm` can
  auto-derive the optimistic-lock header for `PUT` below.
- **Response 403**: caller lacks `contractors.view` (list) or
  `contractors.manage` (create).
- **Response 409** (create): `nip` already registered for this
  organization (duplicate, detected via `nipHash`), or `euVatNumber`
  already registered (via `euVatNumberHash`, added 2026-10-20).

### `PUT /api/contractors/:id`

Standard `makeCrudRoute` update.

- **Response 400**: attempted change to a set `nip` (or, since
  2026-10-20, a set `euVatNumber`) — rejected
  unconditionally (see Design decisions), distinct from GL's
  posted-entries-gated immutability guards. Adding a missing one is
  accepted.
- **Response 409**: `OptimisticLockConflictBody` on a stale
  `updated_at`.

### `GET /api/contractors/:id/bank-accounts` / `POST .../bank-accounts`

Standard `makeCrudRoute` list + create, scoped to the parent
contractor. **Response shape** (list): includes `updatedAt` per row,
same rationale as `GET /api/contractors` above.

- **Query** (list, added 2026-10-20): `purpose?`, `isActive?`.
- **Create body**: `{ accountNumber, isPrimary?, currencyCode?, purpose? }`
  (`currencyCode` and `purpose` added 2026-10-20; `purpose` defaults to
  `SETTLEMENT`).
- **Response 400** (create/update, added 2026-10-20): `accountNumber`
  fails `validateBankAccountNumber` — a field error with `FORMAT`,
  `COUNTRY_LENGTH` or `CHECKSUM`; `currencyCode` is not three upper-case
  letters; `isPrimary: true` on a `VAT` account.

### `POST /api/contractors/:id/bank-accounts/:bankAccountId/verify`

Custom write route (mutation guard registry, mapped to `update`).

- **Response 200**: the eligibility result `{ eligible, reasons,
  status, checkedAt, requestId }` (see Design decisions, 2026-10-20,
  "Payment eligibility"). When the live call is made, it is made during
  this request, never served from the cache; `checkedAt` and `requestId`
  are the Ministry's `requestDateTime` and `requestId`. A non-approved
  contractor (`NOT_APPROVED`) and an unavailable Biała Lista API
  (`WHITELIST_UNAVAILABLE`) are reported in `reasons` with `200`.
  **Changed 2026-10-20:** this replaces the earlier
  `422 CONTRACTOR_NOT_APPROVED` and `502` responses.
- **Response 422 `CONTRACTOR_BANK_ACCOUNT_NOT_SETTLEMENT`** (added
  2026-10-20): the account's `purpose` is `VAT`; it is never checked
  against the whitelist.
- **Response 403**: caller lacks `contractors.view`.

### `POST /api/contractors/:id/verify-vies`

Added 2026-10-20. Custom write route (mutation guard registry, mapped to
`update`, because it writes a history row and may change
`verificationStatus`), invoking `checkContractorVies`.

- **Response 200**: `{ status: 'VALID' | 'INVALID' | 'NOT_CHECKED',
  checkedAt: string, requestId: string | null }`. `NOT_CHECKED` after
  the 10-second timeout or a VIES error; a background retry is already
  enqueued.
- **Response 422**: the contractor has no `euVatNumber`.
- **Response 403**: caller lacks `contractors.view` (the same feature as
  the whitelist "verify now" route).

### `GET /api/contractors/:id/verification-checks`

Added 2026-10-20. Read-only list of `ContractorVerificationCheck` rows
for one contractor, newest first; no create, update or delete route
exists.

- **Query**: `page?`, `pageSize?` (≤100), `kind?`,
  `contractorBankAccountId?`.
- **Response** (per row): `{ id, kind, status, checkedAt, requestId,
  contractorBankAccountId, accountNumberLast4 }` — never
  `accountNumberHash`.
- **Response 403**: caller lacks `contractors.view`.

### `POST /api/contractors/:id/deactivate` / `.../reactivate` and `POST /api/contractors/:id/bank-accounts/:bankAccountId/deactivate` / `.../reactivate`

Added 2026-10-20. Custom write routes (mutation guard registry, mapped
to `update`) for the four deactivation commands.

- **Request header**: `x-om-ext-optimistic-lock-expected-updated-at`.
- **Response 200**: `{ id, isActive, updatedAt }`.
- **Response 409**: stale `updatedAt` (`OptimisticLockConflictBody`), or
  the row is already in the target state.
- **Response 403**: caller lacks `contractors.manage`.

### `POST /api/contractors/:id/anonymize-history`

Added 2026-10-20. Custom write route (mutation guard registry, mapped to
`update`) invoking `anonymizeContractorHistory`.

- **Response 200**: `{ contractorId, clearedRows: number }`.
- **Response 403**: caller lacks `contractors.erase`.

The retention setting `contractors.verificationHistoryRetentionYears` is
edited in the module's configuration screen; a value below 6 is
rejected with `400`.

### Contractor approval — no dedicated route

**Removed 2026-09-08** (see Design decisions, Workflow definition): an
earlier draft proposed a custom `POST /api/contractors/:id/approve`
route. Once the mechanism moved to the `workflows` engine, approval no
longer needs a module-specific route — completing the decision goes
through the existing, generic `POST /api/workflows/tasks/:id/complete`,
exactly as `sales.order-approval` and
`accounts_payable.invoice-approval` already do. Confirmed in scope,
2026-09-08 (see Design decisions).

## Implementation Plan

### Phase 1: Core registry, verification, snapshotting

1. Add `Contractor`, `ContractorBankAccount` entities and their
   migration (additive only). Add `encryption.ts` declaring
   `defaultEncryptionMaps` for both entities (`nip` with `hashField:
   'nip_hash'`, `account_number` on the bank account entity).
2. Add `acl.ts` (three features — `.view`/`.manage`/`.approve`) and `setup.ts`
   (`defaultRoleFeatures` for `admin`/`employee`); run
   `yarn mercato auth sync-role-acls`.
3. Implement `createContractor` / `updateContractor` (NIP
   immutability, duplicate detection, optimistic lock).
4. Implement `createContractorBankAccount` /
   `updateContractorBankAccount` (single-`isPrimary` invariant).
5. Implement the GUS/VIES integration as
   `workers/verifyContractorRegistry.ts` (queue-backed, idempotent,
   per `packages/queue/AGENTS.md`), enqueued from `createContractor`.
6. Implement `checkBankAccountWhitelist` — live Biała Lista call,
   never short-circuited by cache (see Design decisions).
7. Implement `api/contractors/route.ts`, `.../bank-accounts/route.ts`,
   `.../bank-accounts/[id]/verify/route.ts`, and `api/openapi.ts`
   exporting `openApi` for every route above.
8. Build backend pages: `contractors/` (list/create/edit) with the
   inline bank-account sub-list and per-row "verify now" action.
9. In #5663 (GL core engine): add `contractorSnapshot` (`json`,
   nullable) to `JournalEntryLine` — **this is already specified in
   #5663's own Design Decisions and File Manifest (2026-09-07)**, but
   #5663 itself is still spec-only (no `ledger` module exists in code
   yet), so nothing has actually "landed" in running code; listed here
   only for traceability against the sibling spec.
10. Regression + integration test coverage (see Testing Strategy).
11. **Confirmed in scope, 2026-09-08** (not deferred to Phase 2 —
    see Design decisions, "stays threaded... same implementation
    cycle"): add `approvalStatus`/
    `approvedByUserId`/`approvedAt` to `Contractor`; implement
    `workflows.ts` (`contractors.vendor-approval`) and `events.ts`
    (`contractors.contractor.created`); implement
    `applyContractorApprovalDecision`; add the injected approval-task
    widget in `workflows` (see Backend Pages). **Corrected 2026-09-08**:
    an earlier draft of this Implementation Plan listed the one-step
    approval flow under "Phase 2 (deferred)" below, contradicting
    Design decisions' own resolution that it belongs to Phase 1's
    implementation cycle once confirmed, not a separate follow-up —
    moved here.
12. **Added 2026-10-20** (Design decisions, 2026-10-20), built into the
    steps above rather than after them: `validateBankAccountNumber` in
    `shared` before step 4; `euVatNumber`, `isActive`, `currencyCode`,
    `purpose`, `account_number_hash` and the `ContractorVerificationCheck`
    table in step 1's migration and encryption map; the eligibility
    result in step 6; `verifyContractorBankAccount`, VIES in
    `verifyContractorRegistry` and `checkContractorVies` next to step 5;
    the deactivation commands and routes, `verify-vies`,
    `verification-checks` and `contractorLookupByBankAccount` with steps
    3, 4 and 7; their UI with step 8 and their tests with step 10.

### Phase 2 (deferred)

- A more elaborate multi-step/threshold-based approval, if the team
  decides the light, one-step version (Phase 1, step 11) isn't
  sufficient (mirrors AP's own Phase 2 deferral of multi-step invoice
  approval).
- Cross-organization contractor sharing, if a real business need
  emerges (currently YAGNI — see Design decisions).
- **`importBankAccountsFromWhitelist`** (decided 2026-10-20, see Design
  decisions): a command that searches the Ministry's list by the
  contractor's NIP and creates a `SETTLEMENT` account for every listed
  account number the contractor does not hold yet, each validated with
  `validateBankAccountNumber` and recorded in the verification history
  with the search's `requestId`. Polish NIPs only (a contractor without
  a `nip` is refused). The first imported account becomes primary when
  the contractor has no primary account; otherwise the primary is left
  alone.

### File Manifest

| File | Action | Purpose |
| --- | --- | --- |
| `data/entities.ts` | Create | `Contractor`, `ContractorBankAccount`, `ContractorVerificationCheck` (append-only history, added 2026-10-20) |
| `migrations/MigrationXXXXXXXXXXXXXX.ts` | Create | Tables for the three entities above, plus the partial indexes `contractor_bank_account_one_primary_uq` and the `nip_hash` uniqueness index scoped `where deleted_at is null` (see Design decisions) and the history indexes (see Data Models) |
| `api/contractors/[id]/verification-checks/route.ts` | Create | Read-only verification history list (added 2026-10-20) |
| `packages/shared/src/lib/bank-accounts/accountNumber.ts` | Create | `validateBankAccountNumber` — IBAN/NRB format, ISO 13616 length, MOD 97-10 checksum, normalization to the IBAN form; shared so Cash & Bank can reuse it (added 2026-10-20) |
| `encryption.ts` | Create | `defaultEncryptionMaps` for `contractors:contractor` (incl. `nip` → `nip_hash`, `eu_vat_number` → `eu_vat_number_hash`) and `contractors:contractor_bank_account` |
| `di.ts` | Create | Registers `contractorBankWhitelistCheck` (`checkBankAccountWhitelist`), `contractorLookupByNip` (read-only, `nipHash` lookup, no PII) and `contractorLookupByBankAccount` (read-only, `accountNumberHash` lookup, no PII, added 2026-10-20) for cross-module resolution — see DI Registrar |
| `acl.ts` | Create | Four `contractors.*` features (`.view`/`.manage`/`.approve`, and `.erase` added 2026-10-20) |
| `setup.ts` | Create | `defaultRoleFeatures` for `admin`/`employee` (`.erase` admin only); no `seedDefaults`; the default `verificationHistoryRetentionYears` of 6 applies when the tenant has no value (added 2026-10-20) |
| `commands/contractors.ts` | Create | `createContractor` / `updateContractor` / `checkContractorVies` (on-demand VIES, added 2026-10-20) |
| `api/contractors/[id]/verify-vies/route.ts` | Create | On-demand VIES check, 10-second timeout (added 2026-10-20) |
| `api/contractors/[id]/{deactivate,reactivate}/route.ts`, `api/contractors/[id]/bank-accounts/[bankAccountId]/{deactivate,reactivate}/route.ts` | Create | Reversible deactivation, guarded write routes (added 2026-10-20) |
| `commands/contractorActivation.ts` | Create | `deactivateContractor`/`reactivateContractor`/`deactivateContractorBankAccount`/`reactivateContractorBankAccount` with `enforceCommandOptimisticLock` (added 2026-10-20) |
| `commands/contractorBankAccounts.ts` | Create | `createContractorBankAccount` / `updateContractorBankAccount` / `checkBankAccountWhitelist` |
| `workers/verifyContractorRegistry.ts` | Create | Async GUS/VIES lookup, updates `verificationStatus` |
| `workers/verifyContractorBankAccount.ts` | Create | Background whitelist check of a new or changed bank account; writes the history row and the warning status, never rejects the account (added 2026-10-20) |
| `workers/expireVerificationHistory.ts` | Create | Daily: clears `accountNumberLast4`/`accountNumberHash` on history rows older than `verificationHistoryRetentionYears` (added 2026-10-20) |
| `commands/verificationHistory.ts` | Create | `anonymizeContractorHistory` (`contractors.erase`) (added 2026-10-20) |
| `api/contractors/[id]/anonymize-history/route.ts` | Create | Guarded write route for `anonymizeContractorHistory` (added 2026-10-20) |
| `api/contractors/route.ts` | Create | `Contractor` CRUD (`makeCrudRoute`) |
| `api/contractors/[id]/bank-accounts/route.ts` | Create | `ContractorBankAccount` CRUD (`makeCrudRoute`) |
| `api/contractors/[id]/bank-accounts/[bankAccountId]/verify/route.ts` | Create | Live Biała Lista check |
| `workflows.ts` | Create | **Confirmed in scope, 2026-09-08** — the `contractors.vendor-approval` definition, `registerWorkflowSafeCommands` on `applyContractorApprovalDecision` |
| `events.ts` | Create | **Confirmed in scope, 2026-09-08** — `contractors.contractor.created`, the workflow's sole trigger |
| `widgets/injection/vendor-approval/` | Create | **In `workflows`, not this module** — approval-task widget injected into `contractors.contractor.detail:details`, mirroring `workflows/widgets/injection/order-approval/` |
| `commands/contractors.ts` | Update | Adds `applyContractorApprovalDecision`, called only from inside the workflow |
| `i18n/` | Create | Locale keys for status labels (`PENDING`/`VERIFIED`/`FAILED`/`NOT_APPLICABLE`, `WHITELISTED`/`NOT_WHITELISTED`/`UNKNOWN`, `PENDING_APPROVAL`/`APPROVED`/`REJECTED`), the "last checked: N days ago" badge, the "Verify now" button, and 400/409/422 error copy — per root `AGENTS.md`'s "never hard-code user-facing strings" rule. **Added 2026-10-20:** the eligibility reasons, the history kinds and statuses (`FOUND`/`NOT_FOUND`, `VALID`/`INVALID`, `NOT_CHECKED`), the "not on the whitelist" warning badge, the "Check in VIES" button and the account-number validation errors |
| `api/openapi.ts` | Create | `openApi` exports for every route above |
| `backend/contractors/page.tsx` (+ create/[id]) | Create | List/create/edit UI with inline bank-account sub-list |
| `commands/__tests__/*` | Create | Regression coverage |
| `__integration__/*` | Create | Integration coverage |

### Testing Strategy

- Assert the module-decoupling test
  (`packages/core/src/__tests__/module-decoupling.test.ts`) passes with
  `contractors` disabled, and that `accounts_payable_payments`'s own
  `tryResolve` wrapper around `contractorBankWhitelistCheck` degrades
  to "block the payment" in that case rather than throwing unhandled
  (see Cross-module integration, Risks & Impact Review; **corrected
  2026-09-08** — the consumer is the payments module, not AP's
  invoices module, per AP's own split).
- Assert `createContractor` rejects a duplicate `nip` within the same
  `(tenant, organization)` (via `nipHash` lookup), and allows the same
  `nip` across different organizations.
- Assert `updateContractor` rejects any change to a set `nip`, unconditionally
  (not gated on any related data existing — unlike GL's guards).
- EU VAT number and VIES (added 2026-10-20): a contractor with only an
  `euVatNumber` is created and enqueues a VIES check; a duplicate
  `euVatNumber` in one organization returns 409; adding a missing `nip`
  or `euVatNumber` succeeds and changing a set one returns 400; a
  contractor outside Poland with neither identifier gets `verificationStatus:
  'NOT_APPLICABLE'`; `verify-vies` returns `VALID`/`INVALID` and updates
  `verificationStatus`; a mocked VIES that answers after more than 10
  seconds yields `NOT_CHECKED`, leaves `verificationStatus` unchanged and
  enqueues one retry; every VIES call writes one `VIES` history row.
- Assert `createContractorBankAccount`/`updateContractorBankAccount`
  enforce exactly one `isPrimary: true` per contractor.
- **Assert `checkBankAccountWhitelist` always performs a live call and
  never short-circuits based on `lastVerifiedAt` freshness** — this is
  the single most safety-critical test in this module, given the
  explicit rejection of cache-as-shortcut in Design decisions.
  Regression test: seed a `ContractorBankAccount` with
  `lastVerifiedAt: now()`, call `checkBankAccountWhitelist`, assert the
  live API client was actually invoked.
- Assert `checkBankAccountWhitelist` returns the `requestId` and the
  `requestDateTime` (as `checkedAt`) of the mocked Ministry response
  unchanged, and that two calls return two different `requestId`s.
- Confirmed in scope, 2026-09-08: assert
  `applyContractorApprovalDecision` is only reachable through the
  `contractors.vendor-approval` workflow (via `registerWorkflowSafeCommands`),
  not directly callable to bypass the approval task, and that it moves
  `approvalStatus` `PENDING_APPROVAL` → `APPROVED`/`REJECTED` only —
  never any other transition.
- Assert `verifyContractorRegistry` worker is idempotent — running it
  twice for the same contractor does not duplicate or corrupt
  `lastCheckStatus`/`lastCheckedAt`/`lastCheckRequestId`.
- Assert encryption round-trip: `nip`/`address`/`contactEmail`/
  `contactPhone`/`accountNumber` are stored encrypted and returned in
  plaintext only through `findWithDecryption`.
- Assert optimistic-lock 409 on `updateContractor`/
  `updateContractorBankAccount` with a stale `updated_at`.
- Integration: `GET /api/contractors` filters and 403s without
  `contractors.view`; the verify route returns 200 with a fresh
  `checkedAt` on each call (not a cached timestamp), and 200 with
  `eligible: false`, `reasons: ['WHITELIST_UNAVAILABLE']` and
  `status: 'NOT_CHECKED'` when the Biała Lista API is unavailable.
- **Confirmed 2026-09-08 (maintainer review), updated 2026-10-20:** assert
  `checkBankAccountWhitelist` returns `eligible: false` with
  `NOT_APPROVED` — never reaching the live API client — when
  `approvalStatus` is `PENDING_APPROVAL` or `REJECTED`, and proceeds
  normally once `APPROVED`.
- `validateBankAccountNumber` (added 2026-10-20): a valid NRB and the
  same account as `PL` IBAN, with spaces or dashes, normalize to the
  same value; one changed digit fails with `CHECKSUM`; a German IBAN of
  the wrong length fails with `COUNTRY_LENGTH`; a number that is neither
  fails with `FORMAT`; `createContractorBankAccount` returns `400` with a
  field error for each.
- History retention (added 2026-10-20), acceptance:
  - with the default (6), a row with `checkedAt` 6 years and 1 day ago
    has `accountNumberLast4`/`accountNumberHash` `null` after the worker
    runs, and a row 5 years 364 days old is untouched;
  - with the setting at 8, the 6-year-old row is untouched;
  - setting the value to 5 → 400;
  - after clearing, `requestId`, `kind`, `status` and `checkedAt` are
    unchanged and the row still appears in the history list;
  - `anonymizeContractorHistory` clears every row of that contractor,
    including today's, and no row of another contractor; a second call
    returns `clearedRows: 0`; without `contractors.erase` → 403;
    `employee` lacks the feature by default;
  - no code path deletes a history row or changes any other column;
  - AP's `whitelistCheckResult` and GL's `contractorSnapshot` are not
    touched by either path.
- Verification history (added 2026-10-20): every live whitelist call,
  GUS/VIES lookup and on-demand VIES check writes exactly one
  `ContractorVerificationCheck` row with `requestId` and `checkedAt` from
  the registry; a whitelist row carries the last four digits and the
  hash of the number checked, never the number; editing the account's
  number or soft-deleting the account leaves earlier rows unchanged and
  their hash still equal to the old number's hash; a payment
  confirmation whose transaction rolls back still leaves the row; no
  route or command updates or deletes a row.
- Registration check (added 2026-10-20): creating an account, and
  changing its `accountNumber`, enqueues `verifyContractorBankAccount`;
  a negative Ministry answer leaves the account saved with
  `lastVerificationStatus: 'NOT_WHITELISTED'`; an unavailable API writes a
  `NOT_CHECKED` history row and leaves the cached status unchanged; a
  retried job for the same number makes no second Ministry call; an
  account of a `PENDING_APPROVAL` contractor is checked too.
- Contractor outside Poland without a NIP (added 2026-10-20): `checkBankAccountWhitelist`
  makes no Ministry call and returns `status: 'NOT_APPLICABLE'` with
  `checkedAt`/`requestId` `null`; an approved, active such contractor is
  `eligible`; creating its bank account enqueues no registration check
  and writes no history row.
- Country rules (added 2026-10-20), acceptance:
  - create without `countryCode` → 400; `countryCode: 'pl'` → 400;
  - `countryCode: 'PL'` without `nip` → `422 CONTRACTOR_NIP_REQUIRED`;
    with a NIP that fails the checksum → 400;
  - `countryCode: 'PL'`, `nip: '1234563218'`, `euVatNumber:
    'PL1234563218'` → created; the same with `euVatNumber:
    'PL9999999999'` → `422 CONTRACTOR_EU_VAT_NUMBER_MISMATCH`;
  - `countryCode: 'DE'` with `euVatNumber: 'PL1234563218'` →
    `422 CONTRACTOR_EU_VAT_NUMBER_MISMATCH`;
  - `countryCode: 'DE'` with only a `DE…` number → created; its account
    gets whitelist status `NOT_APPLICABLE`;
  - `countryCode: 'DE'` with a Polish `nip` → its account is checked
    against the whitelist (never `NOT_APPLICABLE`);
  - every account of a `PL` contractor gets a real Ministry check — no
    `PL` contractor ever yields `NOT_APPLICABLE`;
  - changing a `PL` contractor to `DE` keeps its `nip` (set-once) and
    its accounts are still checked; changing a `DE` contractor without a
    `nip` to `PL` → `422 CONTRACTOR_NIP_REQUIRED`;
  - a raw insert of a `PL` row without `nip_hash` fails on the check
    constraint.
- Eligibility (added 2026-10-20): `verificationStatus` `FAILED` yields
  `VERIFICATION_FAILED` without a live call; `PENDING` and
  `NOT_APPLICABLE` yield no reason; a contractor that is both not
  approved and `FAILED` gets both reasons in one result; a negative
  Ministry answer yields `WHITELIST_NEGATIVE` with
  `status: 'NOT_WHITELISTED'`; `eligible` is `true` only with an empty
  `reasons`; a GUS/VIES outage leaves `verificationStatus` `PENDING`,
  not `FAILED`.
- Assert `applyContractorApprovalDecision` rejects a decision where
  the acting user equals `createdByUserId`, even when that user holds
  both `contractors.manage` and `contractors.approve`.
- Assert `Contractor.lastCheckStatus`/`lastCheckedAt`/
  `lastCheckRequestId` never contain the raw GUS/VIES response, and
  that no `gusData`/`viesData` column exists.
- Deactivation (added 2026-10-20): deactivating and reactivating a
  contractor and an account toggles `isActive`; a stale header returns
  409; deactivating an inactive row returns 409; an inactive contractor
  or account makes `checkBankAccountWhitelist` return `ACCOUNT_INACTIVE`
  without a Ministry call; deactivating the primary account clears
  `isPrimary` and reactivating does not restore it; reactivation leaves
  `approvalStatus` unchanged; `contractorLookupByNip` returns an inactive
  contractor with `isActive: false`.
- Assert deleting a contractor with a not-deleted `ContractorBankAccount`
  (active or inactive)
  is blocked; assert deleting a contractor with `JournalEntryLine`
  history but no active bank accounts succeeds — the corrected
  behavior after the ledger-side guard was dropped (see Design
  decisions).
- Assert `contractor_bank_account_one_primary_uq` and the NIP partial
  uniqueness index both exist and are exercised at the database level
  (a raw insert bypassing the command still fails for two primaries or
  two live NIPs), and that re-registering a soft-deleted NIP succeeds.
- `contractorLookupByNip` (added 2026-10-08): returns the contractor for
  the same NIP written as `"1234567890"` and `"PL 123-456-78-90"`; returns
  `null` for a ten-digit string with a wrong checksum and for a non-Polish
  tax id (a `DE…` VAT-UE number and a US EIN, added 2026-10-20 — without
  throwing); returns
  `null` for a soft-deleted contractor, for another organization and for
  another tenant; the returned object has exactly the documented keys and
  never `nip`, name, address, contact or bank data; calling it twice
  writes nothing.
- `purpose` and `currencyCode` (added 2026-10-20): an account created
  without `purpose` is `SETTLEMENT`; a `VAT` account passes the format
  validation, enqueues no registration check, is refused by
  `checkBankAccountWhitelist` with `CONTRACTOR_BANK_ACCOUNT_NOT_SETTLEMENT`
  and cannot be set primary; the list filter `purpose=SETTLEMENT`
  excludes it; `currencyCode: 'eur'` returns 400 and `'EUR'` is stored;
  the payment-check result carries `accountNumberLast4` and the
  account's `currencyCode`.
- Account number hash (added 2026-10-20): `account_number_hash` is equal
  for the NRB and IBAN spellings of one account; adding the same number
  twice to one contractor fails at the database (partial unique index)
  and succeeds for a second contractor; `contractorLookupByBankAccount`
  returns both contractors for a shared number, `[]` for an unknown or
  invalid number and for a soft-deleted account, nothing from another
  organization or tenant, and never the number itself; a value hashed
  before a pepper was configured still matches.
- Reserved integration test category: `TC-CONTRACTOR-*`, including a
  `__integration__/TC-CONTRACTOR-CRUDFORM-001.spec.ts` covering the
  `Contractor` create/update `CrudForm` flow end to end (list → create
  → edit → optimistic-lock conflict), per `.ai/qa/AGENTS.md`'s
  mandatory CRUDFORM convention for every module shipping one.

## Edge Cases & Failure Scenarios

Added 2026-10-20.

**Country and identifiers** (see Design decisions, "`Contractor.countryCode`
is required"):

- **Polish contractor without a NIP.** Rejected at creation with
  `422 CONTRACTOR_NIP_REQUIRED`; it can never reach the whitelist check
  without a NIP, so it never gets `NOT_APPLICABLE`.
- **Polish VAT-UE number that does not match the NIP** (`PL` +
  different digits), or a `PL…` VAT-UE number on a contractor from
  another country. `422 CONTRACTOR_EU_VAT_NUMBER_MISMATCH`.
- **Foreign contractor registered for Polish VAT** (`countryCode: 'DE'`
  with a Polish `nip`). Checked against the whitelist like a Polish one;
  `NOT_APPLICABLE` needs both a non-`PL` country and no NIP.
- **Foreign contractor without any identifier** (e.g. a US supplier).
  Allowed; `verificationStatus` and whitelist status `NOT_APPLICABLE`;
  payment eligibility depends on approval and active status only.
- **Country changed after creation.** Allowed only if the new
  combination satisfies the same rules; a set `nip` never disappears, so
  moving a Polish contractor abroad does not stop the whitelist check.
- **Lower-case or three-letter country code.** `400`; the value is
  stored as given, two upper-case letters, never guessed.

**History retention** (see Design decisions, "Retention of the
verification history"):

- **Account soft-deleted long ago, history still within the period.**
  Rows keep their digits and hash until their own `checkedAt` passes the
  retention period; deleting the account does not shorten it.
- **Erasure request for one contractor.** `anonymizeContractorHistory`
  clears every row of that contractor at once; dates, statuses and
  request ids remain, so the list still shows each check.
- **Retention setting raised.** Rows already cleared stay cleared;
  nothing can restore them. Rows not yet cleared follow the new value.
- **Non-whitelist rows (`GUS`, `VIES`).** They never had digits or a
  hash; retention leaves them as they are.

## Risks & Impact Review

### Data integrity failures

- **Scenario**: two concurrent `createContractor` calls for the same
  NIP within the same organization race past an application-level
  uniqueness check before either commits.
  **Severity**: Medium. **Affected area**: `Contractor` registration.
  **Mitigation**: `nipHash` carries a partial `UNIQUE (tenant_id,
  organization_id, nip_hash) where deleted_at is null` database index
  (see Design decisions), not just an application-level check — the
  second insert fails at the database regardless of the race.
  **Residual risk**: none; this is exactly the failure mode a DB
  unique index is for.
- **Scenario (found in maintainer review, 2026-09-08)**: a contractor
  is registered with a NIP, has no bank accounts or ledger references,
  and is soft-deleted (`deletedAt` set). The organization later tries
  to register that same NIP again — including the legitimate
  contractor it actually belongs to. **Severity**: Medium. **Affected
  area**: `Contractor` registration. **Mitigation**: the uniqueness
  index above is scoped `where deleted_at is null` (see Design
  decisions, Data Models) — a soft-deleted row no longer occupies the
  unique tuple, so re-registration succeeds. **Residual risk**: none —
  this was a real gap in an earlier draft (a plain, unscoped unique
  constraint would have burned the NIP permanently, since `nip` is
  unconditionally immutable and cannot be corrected on the old row
  either), closed by scoping the index to match this entity's own
  soft-delete column.
- **Scenario**: `createContractorBankAccount` sets `isPrimary: true`
  concurrently on two different accounts for the same contractor.
  **Severity**: Low. **Affected area**: `ContractorBankAccount`.
  **Mitigation**: command re-reads and unsets any existing primary
  inside the same transaction as the insert/update, backed by a
  partial unique index at the database level (see Design decisions).
  **Residual risk**: none — the index closes the concurrent-race gap
  the command alone would leave open; the command's unset-the-other
  logic stays as the ergonomic path so a normal request never hits the
  constraint.
- **Scenario (found in maintainer review, 2026-09-08)**: the same user
  who registers a fictitious vendor (holding `contractors.manage`)
  also completes its own approval task. **Severity**: High — this is
  precisely the internal fraud scheme the approval gate exists to
  prevent. **Affected area**: `applyContractorApprovalDecision`.
  **Mitigation**: `contractors.approve` is a distinct feature from
  `contractors.manage` (see Design decisions, Access Control), and the
  command additionally rejects a decision where the acting user equals
  the contractor's `createdByUserId`, regardless of which features
  they hold. **Residual risk**: none identified beyond two different
  colluding accounts, which is an organizational control, not a
  technical one.
- **Scenario (found in maintainer review, 2026-09-08)**: a contractor
  is registered and left `PENDING_APPROVAL` indefinitely;
  `accounts_payable_payments` attempts a payment to it before anyone
  acts on the approval task. **Severity**: High — defeats the entire
  fraud-prevention rationale for the gate. **Affected area**:
  `checkBankAccountWhitelist`, `accounts_payable_payments`'s payment
  flow. **Mitigation**: `checkBankAccountWhitelist` returns
  `eligible: false` with `NOT_APPROVED`, before making the live Biała
  Lista call, whenever `approvalStatus !== 'APPROVED'` (see Design
  decisions, 2026-10-20, Commands) — `accounts_payable_payments` blocks
  every line that is not `eligible` (see #5962). **Residual risk**: none
  identified — every payment path already goes through this single choke
  point.

- **Scenario (added 2026-10-20)**: the installation has no lookup
  pepper configured, so `hashForLookup` falls back to an unkeyed
  SHA-256 for `nip_hash`, `account_number_hash` and the history's
  `account_number_hash`. **Severity**: Medium. **Affected area**: the
  hash columns of `contractor`, `contractor_bank_account` and
  `contractor_verification_check`. **Mitigation**: deployment sets
  `LOOKUP_HASH_PEPPER` (or one of the tenant-data encryption keys the
  helper falls back to); the platform's own `lookupHashCandidates`
  matches both formats until a backfill rewrites old values.
  **Residual risk**: with no key at all, a NIP (ten digits with a
  checksum) can be recovered from its hash by trying every value; an
  account number is harder but not safe. Accepted as a deployment
  requirement shared with every other hashed column in the platform.
  Even with a pepper, NIPs and IBAN/NRB numbers have low entropy (a NIP
  is ten digits with a checksum, a Polish account number starts with a
  published bank code and carries check digits) and the one pepper is
  shared by every tenant of the installation, so anyone holding the
  pepper and a copy of the database can recover them by enumeration,
  and the same value hashes identically in every tenant.
- **Scenario (added 2026-10-20)**: `anonymizeContractorHistory` is run
  for a contractor while a tax period its payments affect can still be
  examined. **Severity**: Medium. **Affected area**: the evidence of
  which account was checked. **Mitigation**: the command needs a
  separate feature (`contractors.erase`, admin only by default), is in
  the command audit log, and leaves `requestId`, status and date, so
  the Ministry's own record of the request can still be referred to;
  AP keeps its own last four digits on the payment line. **Residual
  risk**: after anonymization the registry alone can no longer show
  which number was checked; accepted, because an erasure request is the
  case where that is the intended outcome.
- **Scenario (added 2026-10-20)**: the retention worker does not run for
  a while (queue down). **Severity**: Low. **Affected area**: personal
  data kept longer than the setting. **Mitigation**: the worker selects
  by `checkedAt`, so the next run catches up with every overdue row.
  **Residual risk**: data kept for the length of the outage.
- **Scenario (added 2026-10-20)**: a tenant needs the evidence longer
  than 6 years (an open tax proceeding, a non-calendar fiscal year).
  **Severity**: Medium. **Affected area**: history retention.
  **Mitigation**: the setting can be raised, never lowered below 6.
  **Residual risk**: a tenant who does not raise it in time loses the
  digits and hash of older rows; `requestId` and dates remain.

### Cascading failures & side effects

- **Scenario**: GUS or VIES API is down when `verifyContractorRegistry`
  runs. **Severity**: Low. **Affected area**: `Contractor.verificationStatus`.
  **Mitigation** (**changed 2026-10-20**): the worker leaves
  `verificationStatus` `PENDING` and the queue retry policy (per
  `@open-mercato/queue`) re-attempts later; `FAILED` is set only when a
  registry answers negatively (see Design decisions, 2026-10-20,
  "Payment eligibility"), because `FAILED` now blocks payments and an
  outage must not. The contractor remains usable (registration is never
  blocked on this) and `PENDING` does not block payments. **Residual
  risk**: a contractor could stay `PENDING` for a long time if GUS/VIES
  are down long-term — no automatic re-enqueue beyond the queue's own
  retry window; manual re-trigger needed (out of scope for this
  document's Phase 1 UI). Accepted: the live whitelist check still runs
  for every payment.
- **Scenario**: Biała Lista API is down at the exact moment
  `accounts_payable_payments` needs to execute a payment
  (`accounts_payable_payments` has resolved `checkBankAccountWhitelist`
  via `tryResolve` — see Cross-module integration — and the in-process
  call itself fails; **corrected 2026-09-08** — this was "AP" generically
  before AP's own split into invoices/payments). **Severity**: High
  (business-blocking, not data-corrupting). **Affected area**:
  `accounts_payable_payments`'s payment execution flow. **Mitigation**:
  `checkBankAccountWhitelist` returns `eligible: false` with
  `WHITELIST_UNAVAILABLE` (changed 2026-10-20 from "throws/returns an
  error result");
  `accounts_payable_payments` is expected to block the payment rather
  than proceed without a live check (this module cannot make that
  policy decision for its consumer — noted explicitly as
  `accounts_payable_payments`'s own responsibility, see Out of scope).
  **Residual risk**: legitimate payments could be delayed during a
  Biała Lista outage; accepted as the safer failure mode given the
  legal exposure of paying without verification.
- **Scenario**: the `contractors` module itself is disabled or absent
  when `accounts_payable_payments` tries to resolve
  `contractorBankWhitelistCheck`. **Severity**: High
  (business-blocking). **Affected area**:
  `accounts_payable_payments`'s payment execution flow. **Mitigation**:
  its local `tryResolve` wrapper (per `packages/core/AGENTS.md` →
  Cross-Module Coupling) returns `undefined` instead of throwing;
  `accounts_payable_payments` treats a missing service identically to
  a failed live check — block the payment. Covered by
  `packages/core/src/__tests__/module-decoupling.test.ts` per repo
  convention (see Testing Strategy). **Residual risk**: none identified
  — this is the sanctioned degrade-gracefully path, not a gap.

### Tenant & data isolation

`Contractor`, `ContractorBankAccount` and `ContractorVerificationCheck`
are all tenant/organization scoped, with `ContractorBankAccount` and
`ContractorVerificationCheck` carrying their own scope columns
rather than relying only on a join through `contractorId` (matching
the `JournalEntryLine`/`SalesInvoiceLine` precedent — see Design
decisions). No cross-organization sharing exists in Phase 1 (YAGNI,
see Design decisions), so there is no shared/global resource for a
noisy-neighbor scenario to exploit.

### Migration & deployment

Additive only — three new tables (the history table added 2026-10-20; with the indexes named in Data
Models), no changes to existing schema (except the
`JournalEntryLine.contractorSnapshot` (`json`, nullable) addition
already specified in #5663's own design — see Implementation Plan
step 9). #5663 is itself still spec-only (not yet implemented), so
this module's Phase 1 does not have a hard runtime dependency on it;
it becomes relevant once GL is actually implemented. Safe to deploy
independently of AP, which does not yet exist.

## Out of scope (tracked separately)

- **Attaching a specific verification result to a specific payment
  for legal audit trail.** This module exposes
  `checkBankAccountWhitelist` as a callable, live check — persisting
  its result against a particular payment/invoice record is Accounts
  Payable's concern (AP owns the "payment" concept; this module does
  not know what a payment is). **Updated 2026-10-20:** this module now
  keeps its own append-only history of every check, with the Ministry's
  `requestId` (see Design decisions, 2026-10-20); AP links a payment to a
  check by storing that `requestId` on `PaymentBatchLine`.
- **Bank accounts outside the IBAN registry** (added 2026-10-20) —
  e.g. a US account number with a routing number. Phase 1 accepts only
  IBAN and NRB (see Design decisions, 2026-10-20).
- **Multi-step or threshold-based vendor approval.** Phase 2,
  deferred unless the team later decides the Phase 1 one-step version
  (confirmed in scope, 2026-09-08) isn't sufficient — see Design
  decisions.
- **Cross-organization contractor sharing.** YAGNI — no precedent in
  the codebase, no confirmed business requirement (see Design
  decisions).
- **Purchase order / three-way matching, invoice lifecycle, payment
  execution.** Accounts Payable's concern, not this module's.
- **`journal_entry_line_dimensions` (cost-center/MPK tagging).**
  Separate, earlier-sequenced document; unrelated to contractor
  identity.
- **Full historical versioning of contractor data.** Deliberately
  replaced by the `JournalEntryLine.contractorSnapshot` point-in-time
  copy (see Design decisions) — no separate audit-log table for every
  field change.
- ~~Whether Accounts Payable should block using a contractor still
  in `PENDING_APPROVAL` status.~~ **Resolved 2026-09-08, no longer out
  of scope** — `checkBankAccountWhitelist` itself now reports a
  non-`APPROVED` contractor as `NOT_APPROVED` (not eligible) before AP's
  payment flow ever reaches the live check (see Design decisions,
  2026-10-20, Commands). AP does not need to separately read or
  interpret `approvalStatus`.

## Final Compliance Report — 2026-09-07

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `.ai/docs/module-development.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/ui/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| `AGENTS.md` | No direct ORM relationships between modules | Compliant | `contractorSnapshot` on `JournalEntryLine` is a plain `json` copy, not a relation; AP will reference `Contractor` by FK-id only, never an ORM relation |
| `AGENTS.md` | Filter by tenant/organization | Compliant | `Contractor` and `ContractorBankAccount` both carry their own `organizationId`/`tenantId`, matching the `sales.SalesInvoiceLine` precedent |
| `AGENTS.md` | Write operations via Command pattern | Compliant | All mutations go through `createContractor`/`updateContractor`, `createContractorBankAccount`/`updateContractorBankAccount`, `checkBankAccountWhitelist` |
| `AGENTS.md` / core `AGENTS.md` | Declarative feature guards; `acl.ts` synced to `setup.ts` | **Compliant (fixed 2026-09-08, second review pass)** | Three `contractors.*` features (`contractors.approve` added for four-eyes, see Design decisions) — `admin` gets all three, `employee` gets `.view`/`.manage` only, so approval always requires a different role than registration even within this repo's two-role default set; `defaultRoleFeatures` in `setup.ts`, `sync-role-acls` in Implementation Plan step 2 |
| Core `AGENTS.md` § Database Entities | User-editable entities MUST include `updated_at` | Compliant | Both entities have `updatedAt`; `CrudForm` auto-derives the lock header |
| Core `AGENTS.md` § Database Entities | Standard column contract includes `deleted_at` | Compliant | Both entities have `deletedAt` (soft delete); deletion of `Contractor` blocked only while an active `ContractorBankAccount` exists — a `JournalEntryLine`-based check was dropped, see Design decisions |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant | `api/openapi.ts` in File Manifest and Implementation Plan step 7, covering every route in this module |
| `packages/core/AGENTS.md` → Encryption | GDPR/PII fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | **Compliant (fixed 2026-09-08, maintainer review)** | `contractors:contractor` (name, address, contact, `nip`+`nipHash`) and `contractors:contractor_bank_account` (`account_number`) both declared. Originally, `gusData`/`viesData` stored the raw GUS/VIES payload — which duplicates the same PII in plaintext for a JDG contractor — outside this map entirely; narrowed to typed, non-PII diagnostic fields instead (see Design decisions) |
| `packages/core/AGENTS.md` → Cross-Module Coupling | Upstream module MUST NOT import, resolve, or hard-require its own consumer | **Compliant (fixed 2026-09-08, maintainer review)** | The `Contractor` delete guard originally checked `ledger`'s `JournalEntryLine` from inside this (upstream) module — the exact inverted direction this same rule forbids, and a `module-decoupling.test.ts` failure waiting to happen. Dropped; `contractorSnapshot` already makes this unnecessary (see Design decisions) |
| Problem Statement / fraud-prevention rationale (four-eyes) | The approval gate must actually separate "who registers" from "who approves" | **Compliant (fixed 2026-09-08, maintainer review)** | Both were gated on the same `contractors.manage` feature, permitting self-approval. Split into `contractors.manage` / `contractors.approve`, plus an explicit `createdByUserId` self-approval check (see Design decisions, Access Control) |
| Problem Statement / fraud-prevention rationale (approval enforcement) | A control must have an actual enforcement point, not just a status field | **Compliant (fixed 2026-09-08, maintainer review)** | `approvalStatus` was previously read by nothing — `checkBankAccountWhitelist` now reports a non-`APPROVED` contractor as not eligible (`NOT_APPROVED`, 2026-10-20) before any payment can reach the live check (see Design decisions, Commands, Out of scope) |
| Root `AGENTS.md` | Never hard-code user-facing strings — use locale files | **Compliant (fixed 2026-09-08, maintainer review)** | File Manifest was missing an `i18n/` entry entirely, unlike every other core module; added |
| `packages/queue/AGENTS.md` | Workers MUST be idempotent; MUST export `metadata: { queue, id?, concurrency? }` | Compliant | `verifyContractorRegistry.ts` follows the exact shape verified against `customers/workers/*.ts` |
| `packages/ui/AGENTS.md` | `CrudForm`/`DataTable`; guarded row actions via `useGuardedMutation` | Compliant | Contractor list/create/edit use `CrudForm`+`DataTable`. **Resolved 2026-09-08** (superseding the 2026-09-07 correction, which only removed a false citation without replacing the design): the approval step (confirmed in scope, 2026-09-08) now uses the `workflows` engine (`defineWorkflow`/`USER_TASK`), 1:1 with `sales.order-approval`/`accounts_payable.invoice-approval`, not `useGuardedMutation` — consistent with the same principle already settled for `accounts_payable.invoice-approval`: a guarded row action is a real pattern only for a simple, reversible toggle (GL's fiscal-period lock/unlock), not a one-time approve/reject decision. See Design decisions, Workflow definition |
| `packages/core/AGENTS.md` → Command Side Effects | The workflow's own transition calls a command dedicated to that transition, not the entity's general-purpose update command | **Compliant (fixed this round)** | Carried over from AP's own fix to the identical latent issue in `sales.order-approval` (which reuses `sales.orders.update` for its transition): `applyContractorApprovalDecision` is a separate, narrow command, not `updateContractor` — see Design decisions |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | New tables only (three since 2026-10-20) |
| `packages/core/AGENTS.md` → Cross-Module Coupling | Optional-peer sync calls resolve via a local `tryResolve` in `try/catch`; never a hard `requires`; upstream MUST NOT resolve the consumer | **Compliant (fixed this round)** | Originally designed as a plain HTTP route AP would call — an independent review caught this as the wrong mechanism (no degrade path if `contractors` is disabled). Corrected: `checkBankAccountWhitelist` is now also registered in `di.ts`; AP resolves it via `tryResolve`; the HTTP route is now scoped to this module's own UI only. See DI Registrar, Cross-module integration, Risks & Impact Review. |
| Checklist § Performance | Every query pattern names its supporting index | **Compliant (fixed this round)** | Missing from the first draft of this expansion; added to Data Models for both entities' list/lookup filters. |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match architecture | Pass | Entities in Architecture and Data Models agree |
| API contracts match data models | Pass | Every documented field/filter has a backing column; no `periodId`-style undesigned filter (learned directly from #5663's independent review this same day) |
| Commands defined for all mutations | Pass | Every entity and every side-effecting check (`checkBankAccountWhitelist`) has a named command |
| Risks cover all write operations | Pass | Registration race, primary-account race, GUS/VIES outage, Biała Lista outage all addressed |
| Scope cohesion vs. other modules | Pass | Single capability (contractor tax identity + verification), independently deployable without AP or AR existing — verified by construction: this document has zero write path into any other module's tables |
| Scope cohesion *within* this document | Pass | A fresh-context scope-cohesion check flagged `approveContractor` as bundled-but-severable; resolved 2026-09-07 as a deliberate choice to keep it threaded through the same sections (same entity, same ACL feature, same screen) rather than split into a separate document — see Design decisions |
| Encryption maps declared before any PII column ships | Pass | Both entities' encryption maps written in the same Implementation Plan step as their migration (step 1), not deferred |

### Non-Compliant Items

None outstanding. An external maintainer review (PR #5955, 2026-09-08)
found two blockers (unencrypted PII duplicated in `gusData`/`viesData`;
the `Contractor` delete guard reading `ledger`'s `JournalEntryLine`,
inverting the cross-module dependency direction) and six majors (no
enforcement point for the approval gate; four-eyes defeated by a
shared ACL feature; missing `i18n/` in the File Manifest; the
`Contractor Registry` and implementation-guide README rows filed under
"Fully implemented and deployed"; the implementation guide describing
the approval gate as still pending after the spec resolved it; the
`isPrimary` command-only-invariant rationale citing a repo preference
that doesn't exist), plus five minors/nits (the NIP unique index not
accounting for soft delete; no reserved `TC-` integration test IDs;
"Related" documents linking to specs not yet merged; ACL requirements
attributed to the command layer rather than routes; the existing
`plNip` address field and `updatedAt` response-shape omissions). All
addressed in this round — see Design decisions and Changelog. Prior to
this, `approveContractor` (now `applyContractorApprovalDecision`) was
the one item carried as **not yet decided**; both its scope and its
mechanism were resolved 2026-09-08 — see Design decisions, backed by
explicit research (the AFP's 2025 Payments Fraud and Control Survey,
the documented limits of the mandatory Biała Lista check, and existing
ERP precedent in SAP Ariba/ApprovalMax). Final sign-off with Łukasz
happens through the normal PR review, same as every other decision in
this document.

### Verdict

**Ready for maintainer review — no items outstanding.** The
`approveContractor` one-step vendor acceptance workflow (now
`applyContractorApprovalDecision`) is confirmed in scope for Phase 1
(2026-09-08), on the strength of explicit research rather than
assumption: the mandatory Biała Lista check already in Accounts
Payable verifies NIP-to-account registry data but, per a documented
Polish industry source, is explicitly not sufficient alone against
invoice/vendor fraud, and the AFP's 2025 Payments Fraud and Control
Survey found vendor-impersonation fraud at 45% of organizations
surveyed (up from 34% the prior year) — a growing threat this gate
targets specifically at the vendor-onboarding moment the whitelist
check doesn't cover. The pattern mirrors existing ERP practice (SAP
Ariba's supplier onboarding, ApprovalMax's Vendor Workflows) and this
module's own sibling document, `2026-09-06-accounts-payable.md`. Its
mechanism was resolved the same day: the `workflows` engine
(`defineWorkflow`/`USER_TASK`), 1:1 with `sales.order-approval` and
AP's own `accounts_payable.invoice-approval`, with the same
dedicated-command departure AP made from `sales.order-approval`'s one
latent issue (see Design decisions, Workflow definition).
Every AGENTS.md rule checked is compliant — an independent review
round (2026-09-07, second pass) found and fixed a real
cross-module-coupling gap (`checkBankAccountWhitelist` was designed as
an HTTP-only call with no degrade path; now also a `di.ts`-resolvable
service behind `tryResolve`) and a missing supporting-index gap (now
added to Data Models), and corrected several factual citation errors
(see Changelog). A separate scope-cohesion check flagged
`approveContractor` as bundled-but-severable; resolved as a deliberate
choice to keep it threaded through the same sections rather than
split out (see Design decisions). The two design decisions worked through with the team
earlier this session — `ContractorBankAccount` as its own entity, and
its verification cache as strictly UX-only, never a compliance
shortcut — remain fully threaded through Design decisions, Data
Models, Commands, Testing Strategy, and Risks. This document unblocks
the full expansion of `2026-09-06-accounts-payable.md`, which already
assumed this registry's existence.

**Updated 2026-09-08, after an external maintainer review (PR
#5955).** The review found real defects this document's own
self-review and fresh-context checklist passes had missed — precisely
because they only surface when the design is checked against the
codebase's actual module-isolation and ACL mechanisms, not against the
document's own citations. Two blockers and six majors, all now
resolved (see Design decisions, Compliance Matrix, Non-Compliant
Items, Changelog): the `gusData`/`viesData` PII duplication, the
inverted-direction delete guard, the missing approval-gate enforcement
point, the four-eyes-defeating shared ACL feature, the missing `i18n/`
manifest entry, the README miscategorization, the implementation-guide
drift, and the `isPrimary` invariant's mistaken rationale. The
document's core shape — the separate `ContractorBankAccount` entity,
the DI/`tryResolve` cross-module design, the workflow-engine approval
mechanism, the YAGNI deferrals — was not in question; every finding
was a correction within that shape, not a challenge to it.

## Changelog

### 2026-09-06

- Initial specification: TLDR, legal context (Art. 96b, GUS, VIES),
  research into the `customers` module, Design Decisions (resolved),
  User Stories, Implementation Plan (sketch).

### 2026-09-07

- Full expansion to the `om-spec-writing` template: added Overview,
  formalized Problem Statement, Proposed Solution (with Alternatives
  considered), full Architecture (Entities/Access Control/Module
  Setup/Commands/Events/Queries-API/Backend Pages), Data Models, API
  Contracts, full Implementation Plan with File Manifest and Testing
  Strategy, Risks & Impact Review, Out of scope, Final Compliance
  Report.
- Resolved, after discussion: `ContractorBankAccount` is a separate
  entity (own tenant/org scope columns), not a field/array on
  `Contractor` — matches the `JournalEntryLine`/`SalesInvoiceLine`
  "line has its own scope" precedent and avoids the project's
  anti-pattern of unbounded arrays/nested JSON.
- Resolved, after discussion: `ContractorBankAccount.lastVerifiedAt`/
  `lastVerificationStatus` is strictly a UX cache — `checkBankAccountWhitelist`
  always performs a live Biała Lista check and never short-circuits on
  cache freshness, per the "na dzień zlecenia przelewu" rule (art. 15d CIT /
  art. 22p PIT; the original wording here cited Art. 96b VAT Act, corrected 2026-10-12).
  Flagged as the single most safety-critical test in Testing Strategy.
- Added `NIP` immutability as an explicit Design Decision (unconditional,
  unlike GL's posted-entries-gated guards) — was implicit before, now
  a named invariant with its own test.
- Clarified module boundary: this document exposes
  `checkBankAccountWhitelist` as a callable service; attaching its
  result to a specific payment for legal audit-trail purposes belongs
  to Accounts Payable, not this module (added to Out of scope).

### 2026-09-07 (cont. — independent review round)

- Independent compliance/checklist review (fresh-context subagent,
  re-verified against source, not the spec's own citations) found and
  fixed: (1) a real cross-module-coupling gap — `checkBankAccountWhitelist`
  was designed as a plain HTTP route with no degrade path if `contractors`
  is disabled; corrected to also be a `di.ts`-resolvable service that AP
  reaches via a local `tryResolve` wrapper, per `packages/core/AGENTS.md`
  → Cross-Module Coupling (new DI Registrar subsection; Events,
  Queries/API, Risks & Impact Review, File Manifest, Testing Strategy all
  updated to match); (2) a missing supporting-index for both entities'
  list/lookup filters (added to Data Models, mirroring #5663's index
  documentation style); (3) an overclaimed "`organizationId` is nowhere
  nullable in the whole repo" citation (refuted by `ApiKey`; narrowed to
  the accurate claim about tenant/org-scoped domain entities); (4) an
  inaccurate "only occurrence of 'vendor'" citation in Problem Statement;
  (5) a real cross-spec inconsistency — this document typed
  `JournalEntryLine.contractorSnapshot` as `jsonb` and claimed it "already
  landed," when #5663 itself specifies `json` and is still spec-only, not
  implemented; (6) a stale/incorrect citation of a nonexistent
  `packages/core/src/modules/messages/AGENTS.md` file in the Final
  Compliance Report's file list. Two candidate findings were investigated
  and ruled out as non-issues after checking real precedent: the
  `contractors.view`/`contractors.manage` ACL feature IDs (bare
  `<module>.<action>`, not `<module>.<resource>.<action>`) exactly match
  the documented convention in `packages/core/AGENTS.md` §RBAC and the
  real `currencies.view`/`currencies.manage` precedent; and the absence of
  a `packages/cache/AGENTS.md`-style caching-strategy section is not a gap,
  since that file governs *how* to use the cache service when one is
  added, not a mandate that every list endpoint must add one.
- A separate, narrow fresh-context scope-cohesion check (same protocol as
  #5663's Q2) returned **SPLIT**: not for the module's core (tax identity
  + GUS/VIES + bank accounts + Biała Lista verification, judged cohesive),
  but specifically for `approveContractor`, which the document itself
  already flags as severable yet threads as a conditional through five
  separate sections instead of isolating it. Per `spec-checklist.md`, a
  SPLIT verdict goes back to the maintainer as an open question, not an
  automatic rewrite — recorded as **Q1** (pending resolution).

### 2026-09-07 (cont. — Q1 resolved)

- Resolved Q1 (scope-cohesion SPLIT finding on `approveContractor`):
  keep it threaded through the same sections as the rest of the module
  (Architecture → Commands, Data Models, Queries/API, Backend Pages,
  Implementation Plan) rather than extracting it into a separate
  "proposal" block. Decision: it shares the same entity (`Contractor`),
  the same ACL feature (`contractors.manage`), and the same screen
  (contractor list/edit) as the rest of Phase 1, so it belongs to the
  same implementation cycle once confirmed — not a separate follow-up.
  The per-section "pending team confirmation" flags remain the
  mechanism that signals it isn't approved yet. Folded into Design
  decisions; removed the temporary Open Questions section;
  Internal Consistency Check and Verdict rewritten to be unconditional
  again.
- Translated the full document from Polish to English (matching
  #5663's language) ahead of committing to git.

### 2026-09-07 (cont. — approval-pattern citation corrected)

- Cross-module verification while drafting Accounts Payable's own
  invoice-approval design found this document's Compliance Matrix and
  Backend Pages sections overclaiming: the "approve contractor" row
  action was described as following "the same guarded-row-action
  pattern already verified for GL's fiscal-period lock/unlock." That
  citation doesn't hold — the repo's only implemented approve/reject
  precedent (`sales.order-approval`) uses a full workflow engine
  (`defineWorkflow`/`USER_TASK`), not `useGuardedMutation`; the GL
  lock/unlock action is a simple reversible toggle, not a one-time
  approve/reject decision, so it isn't the right comparison either.
  Both sections corrected to flag `useGuardedMutation` here as an
  unverified Phase-1 simplification instead of a proven pattern.
  `approveContractor` remains pending team confirmation either way —
  this changes only how its eventual mechanism is justified, not its
  scope status.

### 2026-09-08 — approval mechanism resolved, matching AP's own fix to the identical problem

The previous round's correction removed a false citation ("verified
GL precedent") from the approval design but did not replace it with a
real one, leaving `approveContractor` sketched as a `useGuardedMutation`
row action with no justification. Meanwhile,
`2026-09-06-accounts-payable.md` independently faced and fully
resolved the identical problem for its own one-step invoice approval.
This round applies that same, now-proven resolution here:

- `approveContractor` renamed `applyContractorApprovalDecision` and
  redesigned as a command called only from inside a `workflows` engine
  definition (`contractors.vendor-approval`), not a directly-callable
  `useGuardedMutation` toggle — 1:1 mirroring `sales.order-approval`
  and `accounts_payable.invoice-approval`.
- Added the `contractors.vendor-approval` Workflow definition section
  (new), triggered on a new, conditional `contractors.contractor.created`
  event (Events section updated) — immediate trigger, like
  `sales.order.created`, since (unlike AP's invoice) a contractor has
  no separate draft state before approval.
- `Contractor` now lists `approvalStatus`/`approvedByUserId`/
  `approvedAt` directly in Architecture → Entities, not only as a
  footnote in Data Models.
- Removed the custom `POST /api/contractors/:id/approve` route (API
  Contracts, Queries/API, File Manifest) — completion now goes through
  the existing, generic `POST /api/workflows/tasks/:id/complete`,
  exactly as `sales.order-approval`/AP's invoice approval already do.
- Backend Pages: replaced the guarded-row-action sketch with an
  injected approval-task widget, owned by `workflows` (real precedent:
  `workflows/widgets/injection/order-approval/`), matching the
  corrected pattern already applied to
  `2026-09-06-accounts-payable.md`'s own Backend Pages this same week.
- Carried over AP's own deliberate departure from `sales.order-approval`:
  the workflow's transition calls a dedicated
  `applyContractorApprovalDecision` command, not the general-purpose
  `updateContractor` — `sales.order-approval` reusing its own generic
  `update` command for this exact purpose is a latent, unverified
  contradiction risk AP found and avoided; this document avoids it too
  rather than repeating it a third time.
- Updated Compliance Matrix, Non-Compliant Items, and Verdict to
  record the above. The scope question itself — whether
  `approveContractor` ships at all — remains unchanged: still pending
  Łukasz/the team's confirmation.

### 2026-09-08 (cont. — business case for vendor approval resolved, scope confirmed)

Following the mechanism resolution above (same day), the remaining
open question — whether `approveContractor` ships at all — was
resolved through explicit research rather than assumption, per an
explicit request to properly answer what vendor approval means, how
it should work, what it adds given the already-mandatory Biała Lista
check, whether other systems have it, and whether it's worth
implementing:

- Confirmed the mandatory live Biała Lista check (Art. 96b VAT Act,
  already in Accounts Payable) is explicitly documented as
  insufficient alone against invoice/vendor fraud by a Polish
  industry source
  ([ksbot.pl](https://ksbot.pl/bezpieczenstwo/ksef-bezpieczenstwo-bialy-wykaz-vat-a-oszustwo/))
  — it verifies NIP-to-account registry data only, not the
  authenticity of the request, the legitimacy of the transaction, or
  whether a registered company is itself a fraud front. The same
  source recommends independent-channel verification, a four-eyes
  principle, and a documented approval procedure — exactly what a
  one-step approval gate provides at vendor onboarding.
- Confirmed via Trustpair's vendor-fraud research that the three main
  vendor-fraud schemes (BEC/phishing impersonation, internal
  fictitious-vendor registration, and compromised-vendor bank-detail
  changes) all target the vendor-registration/first-use moment, none
  of which the whitelist check detects.
- Confirmed via the AFP's 2025 Payments Fraud and Control Survey that
  vendor-impersonation fraud hit 45% of organizations surveyed (up
  from 34% the prior year) against 63% for BEC overall — a real,
  growing threat class, not a hypothetical one.
- Confirmed vendor-onboarding approval is standard, not bespoke,
  practice in existing ERP/AP tooling (SAP Ariba's supplier
  onboarding module, ApprovalMax's dedicated "Vendor Workflows"
  feature).
- Decision: implement the one-step approval gate as part of Phase 1
  (not deferred). Updated Design decisions, Commands, Events,
  Architecture → Entities, Backend Pages, Implementation Plan (step
  11 and the Phase 2 heading), File Manifest, Testing Strategy,
  Compliance Matrix, Non-Compliant Items, and Verdict to drop every
  "pending team confirmation"/"conditional" marker tied to *scope* —
  the mechanism markers (already resolved earlier the same day) were
  untouched. Final sign-off with Łukasz still happens through the
  normal PR review, same as every other decision in this document —
  this was a recommendation backed by evidence, not a unilateral
  decision.

### 2026-09-08 (cont. — fresh-context review, per om-spec-writing Step 8)

The prior two rounds today (mechanism resolution, then scope
resolution) were self-verified against real code but never run
through the `om-spec-writing` skill's actual Step 8 process — a
fresh-context subagent given only this file, applying
`spec-checklist.md`. Ran it. Six findings, all confirmed against the
real repo before being accepted (per this engagement's standing
practice of never taking a subagent's claim at face value):

- **High — stale cross-module consumer name.** Cross-module
  integration, both Risks scenarios, and Testing Strategy all said
  "AP" resolves `contractorBankWhitelistCheck`. AP itself split into
  `accounts_payable` (invoices) and `accounts_payable_payments` on
  2026-09-08 at 08:29 UTC — *before* either of today's edit rounds to
  this document — and AP's own spec is explicit that the whitelist
  integration lives exclusively in `accounts_payable_payments`, not
  the invoices module. Verified directly against
  `2026-09-06-accounts-payable-payments.md` on `docs/accounts-payable`
  (commit `7677a3ea3`). Fixed: Related header now links both AP
  documents; Cross-module integration, Risks & Impact Review, and
  Testing Strategy all name `accounts_payable_payments` specifically.
- **High — command-ID naming inconsistency.** The workflow's
  `registerWorkflowSafeCommands` entry used `contractors.applyApprovalDecision`
  — missing the resource segment both real precedents use
  (`sales.orders.update`, verified in
  `packages/core/src/modules/sales/workflows.ts`;
  `accounts_payable.vendor_invoices.applyApprovalDecision`, verified
  in AP's own spec) — and inconsistent with this same document's own
  event name, `contractors.contractor.created`. Fixed:
  `contractors.contractor.applyApprovalDecision`.
- **Medium — stale Out of scope bullet.** Still read "pending the same
  team confirmation as the Phase 1 one-step version" after Phase 1 was
  confirmed. Fixed to read as deferred pending a *future* decision
  that the confirmed one-step version isn't sufficient.
- **Medium — orphaned cross-reference.** Architecture → Entities
  pointed to "(see Out of scope)" for whether AP should block use of a
  `PENDING_APPROVAL` contractor; no matching bullet existed. Added
  one.
- **Medium — missing reversibility statement.** `spec-checklist.md`
  §4 requires undo/reversibility to be documented for every mutation;
  `applyContractorApprovalDecision` had none, unlike
  `accounts_payable_payments`'s explicit stance for the identical
  mechanism. Added: the transition is final, no resubmission path.
- **Low — typo.** `contracts.contractor.created` (missing "or") in the
  prior round's changelog entry. Fixed.

No new violation found in the checklist items directly touched by
today's edits (naming, undo contract, cross-module coupling) beyond
the above. Scope-cohesion re-check: confirming `approveContractor` as
a permanent Phase-1 commitment (rather than conditional) strengthens,
not weakens, the earlier case for keeping it threaded rather than
split — no new split argument found. Research-citation honesty
re-check: the AFP/ksbot.pl/Trustpair/SAP-Ariba/ApprovalMax claims are
stated identically everywhere they recur, and the document
consistently frames the vendor-approval decision as a recommendation
for the normal PR review, not an already-audited fact overriding
Łukasz's sign-off.

### 2026-09-08 (cont. — external maintainer review, PR #5955)

An external maintainer review on the open PR found real defects this
document's own review rounds had missed, each independently
re-verified against the real repository before being accepted:

- **Blocker**: `gusData`/`viesData` stored the raw GUS/VIES response
  verbatim, duplicating PII (a JDG contractor's personal name/address)
  in plaintext beside the encrypted `name`/`address` columns. Narrowed
  to typed, non-PII diagnostic fields (`lastCheckStatus`,
  `lastCheckedAt`, `lastCheckRequestId`); dropped the raw payload.
- **Blocker**: the `Contractor` delete guard checked `ledger`'s
  `JournalEntryLine` from inside this upstream module — the exact
  inverted dependency direction `packages/core/AGENTS.md` forbids, and
  a document that itself quotes that rule correctly elsewhere.
  Dropped; `contractorSnapshot` already makes it unnecessary, and
  deletion here is a soft delete regardless.
- **Major**: the confirmed approval gate had no enforcement point —
  nothing blocked AP from using a `PENDING_APPROVAL` contractor.
  `checkBankAccountWhitelist` now rejects non-`APPROVED` contractors
  before the live check.
- **Major**: `createContractor` and `applyContractorApprovalDecision`
  shared one ACL feature (`contractors.manage`), permitting
  self-approval and defeating the four-eyes rationale. Split into
  `contractors.manage`/`contractors.approve` plus an explicit
  `createdByUserId` self-approval check.
- **Major**: File Manifest omitted `i18n/` entirely. Added, with the
  key groups named.
- **Major**: both README rows filed this and the implementation guide
  under "Fully implemented and deployed" despite neither being merged.
  Moved to Pending Specifications (see `.ai/specs/README.md`).
- **Major**: the implementation guide still described the approval
  gate as "pending team confirmation" and a 10-step Phase 1, both
  superseded by this document's own 2026-09-08 resolution (11 steps).
  Re-synced (see `2026-09-06-contractor-registry-implementation-guide.md`).
- **Major**: the `isPrimary` command-only-invariant rationale cited
  "this repo's general preference for command-enforced business rules
  over database-level ones" — a preference that doesn't exist; both
  real repo precedents for this exact invariant use a partial unique
  index. Added `contractor_bank_account_one_primary_uq`.
- **Minor**: the `nipHash` unique constraint didn't account for this
  entity's own soft delete, permanently burning a NIP on
  re-registration after a soft-deleted row. Scoped to a partial index
  `where deleted_at is null`.
- **Minor**: no reserved `TC-` integration-test category/IDs, no
  `CRUDFORM` coverage row despite shipping a full `CrudForm`. Reserved
  `TC-CONTRACTOR-*`, added the CRUDFORM row.
- **Minor**: three of four "Related" documents link to specs not yet
  merged into `develop`. Annotated each with its PR number.
- **Minor**: ACL requirements were attributed to the command layer;
  restated as route/page guards, with the DI-resolved path explicitly
  marked as unguarded by design.
- **Nit**: Problem Statement didn't acknowledge the existing
  address-level `plNip` field in `customers`. Added a sentence.
- **Nit**: API Contracts didn't document `updatedAt` in list/detail
  response shapes, needed for the optimistic-lock 409 path to be
  reachable from `CrudForm`. Added.

Updated the Compliance Matrix, Non-Compliant Items, and Verdict to
record all of the above.

### 2026-09-12 — financial-spec-writing-process applied (cross-spec, literature, real-system comparison)

Ran this repo's standing five-step process end to end for the first
time on this document:

- **Step 1 (cross-spec consistency):** the "Related" header's
  `sales-invoice-gl-posting` reference ("planned, not yet written") was
  stale — that spec has existed since 2026-09-10, with two review
  passes and an open PR (#6046); corrected. Separately found this
  module missing entirely from `financial-module-knowledge-base.md`'s
  own module map (fixed there, not here — see that document's
  Changelog).
- **Step 2 (literature grounding):** verified, in full, the two Fowler
  leads this knowledge base had already flagged for this document —
  Ch.2 "Party" (pp.17-19, confirmed and applied) and Ch.5 "Object
  Merge" (pp.90-92, confirmed as a real, currently un-addressed gap:
  no reconciliation path exists if two `Contractor` rows are later
  found to represent the same real-world entity). Added an independent
  second confirmation of the Party pattern from Hay, Ch.3 "Parties"
  (pp.23-24), not previously checked for this document.
- **Step 3 (real-system comparison):** ERPNext (separate Customer/
  Supplier doctypes plus a "Common Party Accounting" bridge, and a
  generic cross-doctype "Merge with existing" tool — real precedent for
  the Object Merge gap above), Comarch ERP Optima/XL (VAT/VIES
  re-verification on every commercial document, a wider scope than
  this document's registration-time-only check; Biała Lista re-checked
  at multiple transaction points, cached on the contractor card, same
  shape as `lastVerifiedAt`), and a confirmed absence: no four-eyes/
  approval-gate precedent found in Optima's or enova365's public
  documentation, meaning this document's `contractors.vendor-approval`
  gate is a control added beyond the real Polish ERP baseline, not a
  reproduction of one.
- **Step 4 (structure):** re-checked against `om-spec-writing`'s
  required sections — no gaps; the temporary Open Questions section
  (Q1) was already resolved and removed on 2026-09-07.
- All findings written directly into this document's new "Literature &
  Prior Art" section (placed before Architecture, matching sibling
  specs' convention) and cross-referenced in
  `financial-module-knowledge-base.md`. No Design decisions, Data
  Models, or Compliance Matrix rows changed — every finding either
  confirmed existing design choices or was recorded as an explicit,
  un-actioned gap for a future pass, not applied unilaterally.

### 2026-10-08 — NIP lookup service for cross-module consumers

- **Gap found while mapping `financial_pl` integrations (#6061).** A
  module that imports supplier documents (a KSeF received invoice, for
  example) needs to find the contractor by NIP, and this document offered
  no such path: the REST list filters only by `isVendor`, `isCustomer`
  and `verificationStatus`, `nipHash` was used only inside
  `createContractor`, and the only DI service was
  `contractorBankWhitelistCheck`.
- **Decision (working, pending maintainer review).** Add
  `contractorLookupByNip` as a second read-only DI service (DI Registrar,
  Cross-module integration, File Manifest, Testing Strategy); no REST
  `nip` filter (Queries / API). Returns no PII. NIP normalization
  (`normalizeNip`, checksum included) is decided in DI Registrar.
- No change to the data model, ACL, events or workflows.

### 2026-10-12 — Legal context checked against consolidated VAT, CIT and PIT texts

- Checked against the consolidated texts supplied as PDFs (VAT Dz. U. z 2025 r.
  poz. 775 and later amendments through 2026 poz. 846; CIT Dz. U. z 2026 r.
  poz. 554 and later; PIT Dz. U. z 2026 r. poz. 592 and later).
- **Correction.** Art. 96b VAT Act is the register (the whitelist), not the
  source of the duty to check "on the day of transfer" or of any liability.
  The "na dzień zlecenia przelewu" wording is in art. 15d ust. 1 pkt 2 CIT and
  art. 22p ust. 1 pkt 2 PIT, and its consequence is loss of the cost deduction
  (with exceptions, e.g. notification within 7 days). Citations in Legal
  context, the cache Design Decision, the Alternatives table and the Literature
  notes were updated; this changelog's earlier entries keep the original wording.
- **Joint liability and the PLN 15,000 amount:** unverified when this entry was
  written, checked later the same day (next entry).
- **Not applied.** Art. 96b ust. 2 provides for checking the list as of a chosen
  day, so the check could be run for the transfer date; the API client design
  is unchanged. No change to the design decisions, data model or tests. Not yet
  reviewed by a maintainer.

### 2026-10-12 (cont. — Ordynacja podatkowa and Prawo przedsiębiorców checked)

- Checked against the consolidated texts: Ordynacja podatkowa (Dz. U. z 2026 r.
  poz. 622, state of 21 April 2026) and Prawo przedsiębiorców (t.j. Dz. U. z 2025 r.
  poz. 1480 and later amendments through 2026 poz. 507).
- **Confirmed.** Art. 117ba § 1–2 (payer's joint liability for the supplier's VAT
  arrears) and § 3 (exceptions: other transaction, 7-day notification, bank
  accounts, split payment, intra-Community and import cases); art. 19 Prawo
  przedsiębiorców (PLN 15,000, other entrepreneur, NBP average rate of the last
  working day before the transaction).
- **Nuance added.** The earlier text said protection requires checking on the day
  of the transfer; the law also removes the liability through a 7-day
  notification or split payment. The design (live check on every payment) is
  unchanged; the other two routes are not modelled and are noted as such. Not
  yet reviewed by a maintainer.

### 2026-10-20 — Requirements from a customer implementation, aligned with AP (#5962) and GL (#5663)

New section Design decisions (2026-10-20); every item below is decided.

- **Whitelist check returns `requestId`.** `checkBankAccountWhitelist`
  returns `{ status, checkedAt, requestId }`, taken from the Ministry's
  response (`requestId`, `requestDateTime`; confirmed in the
  `wl-api.mf.gov.pl` documentation). Commands, API Contracts and Testing
  Strategy updated. Closes the mismatch with
  `PaymentBatchLine.whitelistCheckResult` in #5962.
- **Payment eligibility.** The result gains `eligible` and `reasons[]`
  (`NOT_APPROVED`, `VERIFICATION_FAILED`, `ACCOUNT_INACTIVE`,
  `WHITELIST_NEGATIVE`, `WHITELIST_UNAVAILABLE`); only
  `verificationStatus` `FAILED` blocks, `PENDING` and `NOT_APPLICABLE` do
  not; `FAILED` now means a negative registry answer, an outage leaves
  `PENDING`. Replaces `422 CONTRACTOR_NOT_APPROVED` and `502` on the
  verify route. Commands, API Contracts, Cross-module integration,
  Testing Strategy, Risks and Out of scope updated. Consumed by #5962,
  which maps each reason to its own error code.
- **Whitelist check at account registration.** `createContractorBankAccount`
  (and a changed `accountNumber`) enqueues
  `workers/verifyContractorBankAccount.ts`; the result goes to the
  verification history; a negative answer keeps the account with the
  `NOT_WHITELISTED` warning status. Commands, File Manifest, Testing
  Strategy updated.
- **Verification history.** New append-only entity
  `ContractorVerificationCheck` (table `contractor_verification_check`):
  contractor, optional bank account, kind (`WHITELIST`/`GUS`/`VIES`),
  status, `checkedAt`, `requestId`, last four digits and `hashForLookup`
  HMAC of the checked number; written in its own transaction; no
  `updatedAt`/`deletedAt`, no write route. Read-only
  `GET /api/contractors/:id/verification-checks`. Entities, Data Models,
  Queries / API, API Contracts, Backend Pages, File Manifest, Testing
  Strategy, Risks (unkeyed hash without a pepper), Tenant isolation,
  Migration, Compliance Matrix and Out of scope updated.
- **Account number validation.** One shared
  `validateBankAccountNumber` in `packages/shared/src/lib/bank-accounts/`
  (IBAN/NRB, ISO 13616 length, MOD 97-10, stored in IBAN form), called
  by both bank-account commands (`400` on failure); noted as reusable for
  Cash & Bank's `BankAccount.accountNumber` (#6055). Non-IBAN accounts
  out of scope. Commands, API Contracts, File Manifest, Testing Strategy,
  Out of scope updated.
- **EU VAT number and VIES.** New `euVatNumber` (encrypted,
  `eu_vat_number_hash`, partial unique); `nip` nullable; both set-once;
  `verificationStatus` gains `NOT_APPLICABLE` and is derived from GUS and
  VIES; VIES runs in the background at registration and on demand through
  `checkContractorVies` / `POST /api/contractors/:id/verify-vies`
  (synchronous, 10-second timeout, `NOT_CHECKED` plus a worker retry
  after it). Earlier NIP-immutability decision, Encryption, Entities, DI
  Registrar, Commands, Data Models, API Contracts, Backend Pages, File
  Manifest (incl. `i18n/`), Testing Strategy updated.
- **Foreign tax id.** `contractorLookupByNip` returns `null` without an
  error for any input that is not a valid Polish NIP; AP keeps such a
  `vendorSnapshot.taxId` as printed. A contractor without a NIP gets
  whitelist status `NOT_APPLICABLE` (no Ministry call, no history row).
  DI Registrar and Testing Strategy updated.
- **Reversible deactivation.** `isActive` on `Contractor` and
  `ContractorBankAccount`; four commands
  (`deactivate`/`reactivate` × contractor/account) with
  `enforceCommandOptimisticLock`, guarded custom routes mapped to
  `update` and `RowActions` + `useGuardedMutation` in the UI — the
  `lockFiscalPeriod`/`unlockFiscalPeriod` pattern from #5663. Inactive
  means `ACCOUNT_INACTIVE` at payment time. Entities, DI Registrar,
  Commands, Queries / API, Data Models, API Contracts, Backend Pages,
  File Manifest, Testing Strategy updated.
- **Lookup hashes — path chosen: the existing mechanism.** The document
  already had a deterministic NIP hash for uniqueness under encryption
  (`nip` → `hashField: 'nip_hash'`, written with `hashForLookup`, an
  HMAC-SHA256 with the installation pepper). Extended to the account
  number: `account_number` → `hashField: 'account_number_hash'` over the
  normalized IBAN form, a partial unique index per contractor, and a
  third read-only DI service `contractorLookupByBankAccount` for search
  by full value (consumer: Cash & Bank's deferred statement matching).
  No new `nipHash` was added. Encryption, Entities, DI Registrar,
  Cross-module integration, Data Models, File Manifest, Testing
  Strategy updated.
- **`currencyCode` and `purpose` on the bank account.** `currencyCode`
  optional ISO 4217 text, informational, no FK; `purpose`
  `SETTLEMENT`/`VAT` (default `SETTLEMENT`). A VAT account is
  format-validated only, never whitelist-checked, never primary, and
  refused as a payment target (`422
  CONTRACTOR_BANK_ACCOUNT_NOT_SETTLEMENT`). The payment-check result
  gains `accountNumberLast4` and `currencyCode` for AP's snapshot and
  currency warning. Entities, Commands, Data Models, API Contracts,
  Testing Strategy updated.
- **No contractor draft in the registry; Phase 2 import.** A draft is
  form state on the consumer's side; the registry's not-yet-usable state
  is `approvalStatus`. Phase 2 gains `importBankAccountsFromWhitelist`
  (by NIP, Polish NIPs only, first imported account primary when there
  is none). Implementation Plan → Phase 2 updated.
- **Literature & Prior Art** gains a 2026-10-20 block: the Ministry API
  (`requestId`, `requestDateTime` — Confirmed), Odoo 18
  `res.partner.bank`/`base_iban`, ERPNext Bank Account, Comarch Optima's
  verification history (Confirmed), Comarch XL (Unverified); Fowler, Hay
  and Kieso not re-read (PDFs unreadable in this session).
- **Implementation Plan step 12** lists where the 2026-10-20 pieces fit
  into steps 1–10; the implementation guide is synced (three entities,
  the flow's eligibility result, deactivation versus soft delete,
  history and VAT-account pitfalls).

### 2026-10-20 (cont. — Risks: low entropy of hashed identifiers)

- Risks & Impact Review: the unkeyed-hash risk now also states that NIPs
  and IBAN/NRB numbers have low entropy and that the one pepper is
  shared by all tenants of an installation (enumeration with the pepper
  and a database copy; identical hashes across tenants). No design
  change.

### 2026-10-20 (cont. — required `countryCode`; Polish contractors always checked)

- **Decided.** `Contractor.countryCode` is required (ISO 3166-1
  alpha-2, no default). `PL` requires a checksum-valid `nip` at creation
  (`422 CONTRACTOR_NIP_REQUIRED`); a `PL`-prefixed `euVatNumber` requires
  `PL` and must equal `"PL"` + `nip` (`422
  CONTRACTOR_EU_VAT_NUMBER_MISMATCH`). Whitelist `NOT_APPLICABLE` only
  for a contractor outside Poland without a NIP; a Polish contractor is
  always checked. Closes the gap where a Polish supplier saved without a
  NIP would have been paid without a whitelist check.
- Design decisions, Entities, Commands, Data Models (column and check
  constraint), API Contracts, a new Edge Cases & Failure Scenarios
  section, Testing Strategy (acceptance cases) and every
  `NOT_APPLICABLE` reference updated.

### 2026-10-20 (cont. — verification history retention)

- **Decided.** Tenant setting `verificationHistoryRetentionYears`
  (default 6, at least 6, counted from `checkedAt`). After the period, a
  daily worker sets `accountNumberLast4` and `accountNumberHash` to
  `null`; the command `anonymizeContractorHistory` (new feature
  `contractors.erase`, admin by default) does the same for one
  contractor on request. `requestId`, `kind`, `status` and `checkedAt`
  stay. AP and GL snapshots are out of scope.
- **Legal basis checked** in the consolidated texts on eli.gov.pl:
  Ordynacja podatkowa art. 70 § 1 (Dz. U. z 2026 r. poz. 622) — 5 years
  from the end of the calendar year in which the tax payment deadline
  passed; ustawa o rachunkowości art. 74 ust. 2 pkt 8 and ust. 3 (Dz. U.
  z 2026 r. poz. 522) — 5 years from the beginning of the year following
  the fiscal year. Both quoted in Design decisions as the basis of the
  default of 6.
- Design decisions, Access Control, Module Setup, Commands, Data Models,
  API Contracts, File Manifest, Edge Cases, Risks and Testing Strategy
  updated.
