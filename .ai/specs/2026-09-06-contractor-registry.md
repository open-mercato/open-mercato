# Contractor Registry — shared contractor registry (AP + AR)

**Related:** [Accounts Payable](2026-09-06-accounts-payable.md) (consumer
— vendors), sales-invoice-gl-posting (consumer — customers, indirectly
through `sales`; **planned, not yet written** spec — see
`2026-08-18-general-ledger-core-engine.md` Out of scope), [General
Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(`JournalEntryLine` gets a new `contractorSnapshot` field from this
spec)

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

**VAT Act, Art. 96b** — the Head of the National Revenue
Administration maintains a public, electronic register of VAT
taxpayers (the so-called Biała Lista / VAT whitelist), which includes
bank account numbers reported by the taxpayer to the tax office.
Paying into an account outside this register, for transactions above
the PLN 15,000 threshold, exposes the payer (not just the invoice
issuer) to joint-and-several liability for the contractor's VAT
arrears — i.e. the paying company can be held liable for someone
else's tax debt if it doesn't check the account before the transfer.
Protection from this liability requires verification on the day the
transfer is ordered — checking once, at contractor registration, is
not enough.

**Consequence for the project:** bank account verification against the
Biała Lista must repeat at every payment, not just once at
registration — this is not an open design question, it's a hard legal
requirement.

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
Art. 96b of the VAT Act ("on the day of transfer", not "within the
last N days") — an account could have disappeared from the Biała
Lista this morning, and yesterday's cache wouldn't catch that,
restoring exactly the joint-liability risk this whole feature exists
to eliminate. `checkBankAccountWhitelist` (see Commands) **always**
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
consequence of Art. 96b of the VAT Act.

**Recommendation (not confirmed by evidence from the Event Storming
wall or from SPEC-024): a light, one-step new-vendor approval step in
Phase 1.** Adding a fake, nonexistent vendor to the system is a common
invoice-fraud vector (someone impersonates a vendor, swaps the bank
account) — a light approval of a new contractor before first use
reduces this risk, and is consistent with the fact that Accounts
Payable already has its own approval flow for invoices themselves.
**This is a security proposal pending explicit sign-off from
Łukasz/the team before implementation — it is not confirmed by source
material.** Modeled below (Architecture/Commands/Backend Pages) so it
can be cut without redesigning the rest of the module, if the team
decides otherwise.

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
same implementation cycle; if/when Łukasz/the team confirms this step,
it should ship together with the rest of Phase 1, not as a separate
follow-up. The per-section "pending team confirmation" markers stay —
they, not a separate document, are what carries the "this isn't
approved yet" signal.

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
`contact_phone`; `nip` additionally gets `hashField: 'nip_hash'`
(pattern: `messages:message.external_email` → `external_email_hash`,
verified in `packages/core/src/modules/messages/encryption.ts`) —
registration must detect a duplicate by NIP, and searching an
encrypted column without a hash doesn't work.
`contractors:contractor_bank_account` encrypts `account_number`
(financial data, PII). Reads go through
`findWithDecryption`/`findOneWithDecryption`, never hand-rolled crypto.

### Alternatives considered

| Alternative | Why Rejected |
|-------------|---------------|
| Extend `customers.CustomerEntity` with tax fields instead of a new module | Violates single responsibility — `customers` is CRM (pipeline, deals), not tax identity; GUS/VIES/Biała Lista is a completely different data lifecycle |
| Separate `Vendor`/`Customer` entities instead of one `Contractor` with flags | Would duplicate GUS/VIES/account data for an entity that is simultaneously a vendor and a customer of the same company |
| Contractor snapshot based on the future `journal_entry_line_dimension` instead of a field on `JournalEntryLine` | Would create a transitional audit gap — AP invoices posted before the Posting Rules Engine even exists would have no protection at all for contractor history |
| Bank account as a single field/JSON array on `Contractor` | Violates the project's rule against unbounded arrays/nested JSON; doesn't reflect the reality of multiple registered accounts per NIP |
| `lastVerifiedAt`/`lastVerificationStatus` as a shortcut skipping the live check when the cache is "fresh" | Directly violates Art. 96b of the VAT Act ("on the day of transfer"); restores the joint-liability risk this module exists to eliminate |
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

## Architecture

### Entities (`data/entities.ts`)

- `Contractor` — `isVendor` (bool), `isCustomer` (bool), `name`,
  `nip` (+ `nipHash` for lookup on the encrypted column, unique per
  `(tenant_id, organization_id)` — duplicate detection), `address`,
  `contactEmail`, `contactPhone`, `verificationStatus`
  (`PENDING`/`VERIFIED`/`FAILED`), `gusData`/`viesData` (`jsonb`, the
  raw response from the last check — diagnostics, not a source of
  truth), tenant/org scoped, `updatedAt` (user-editable → optimistic
  lock), `deletedAt` (soft delete — per the standard column contract;
  deletion blocked if the contractor has any `JournalEntryLine`
  references via snapshot or any active `ContractorBankAccount`).
- `ContractorBankAccount` — `contractorId` (FK to `Contractor`),
  `accountNumber` (encrypted), `isPrimary` (bool — exactly one primary
  per contractor, enforced in the command), `lastVerifiedAt` (nullable,
  UX cache — see Design decisions), `lastVerificationStatus`
  (`WHITELISTED`/`NOT_WHITELISTED`/`UNKNOWN`, UX cache), its own
  `organizationId`/`tenantId` (own scope columns, matching the
  `JournalEntryLine`/`SalesInvoiceLine` precedent — see Design
  decisions), `updatedAt`, `deletedAt` (soft "deactivate" rather than
  actual deletion — account history has audit value).

### Access Control (`acl.ts`)

Following the `customers` module convention
(`<module>.<resource>.view` / `.manage`, `manage` depends on `view`):

```typescript
export const features = [
  { id: 'contractors.view', title: 'View contractors', module: 'contractors' },
  { id: 'contractors.manage', title: 'Manage contractors', module: 'contractors', dependsOn: ['contractors.view'] },
]
```

`createContractor`/`updateContractor`/`createContractorBankAccount`/
`updateContractorBankAccount`/`approveContractor` require
`contractors.manage`; `checkBankAccountWhitelist` requires
`contractors.view` (read-only check, callable by anyone who can see
the contractor — the actual payment-blocking decision belongs to AP's
own guard, not to this module's ACL).

### Module Setup (`setup.ts`)

`defaultRoleFeatures` for `admin`/`employee` (mirroring GL's `acl.ts`
sync pattern). No `seedDefaults` hook — unlike GL's jurisdiction
dictionaries, there is no system reference data to seed here;
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

### Commands (Command Pattern, `commands/`)

- `createContractor` — validates NIP uniqueness (via `nipHash` lookup)
  per `(tenant, organization)`, persists with `verificationStatus:
  'PENDING'`, enqueues `verifyContractorRegistry` worker.
- `updateContractor` — rejects any change to `nip` unconditionally
  (see Design decisions); everything else editable; enforces
  optimistic lock via `updated_at`.
- `createContractorBankAccount` / `updateContractorBankAccount` —
  standard CRUD; `isPrimary: true` on one account automatically
  unsets it on any other account for the same contractor (single
  invariant enforced in the command, not left to the client).
- `checkBankAccountWhitelist` — **not a plain query**: performs a live
  call to the Ministry of Finance's Biała Lista API for the given
  `accountNumber` and `nip`, returns the fresh result to the caller,
  and — as a side effect only — updates
  `lastVerifiedAt`/`lastVerificationStatus` on the matching
  `ContractorBankAccount` for UX display. Never reads
  `lastVerifiedAt` to short-circuit the live call (see Design
  decisions). Idempotent to call repeatedly. Registered in `di.ts` as
  a resolvable service (see DI Registrar above) — this is the
  sanctioned entry point for another module to call it synchronously
  in the same request; the HTTP route below wraps the same command
  only for this module's own backend UI.
- `approveContractor` — **pending team confirmation, see Design
  decisions.** One approver, binary decision (approve/reject),
  mirroring AP's own one-step invoice approval. Sets
  `approvalStatus`/`approvedByUserId`/`approvedAt` (fields added to
  `Contractor` only if this command is confirmed in scope — see
  Data Models note).

### Events

None declared in Phase 1. AP consumes `Contractor`/
`ContractorBankAccount` by resolving this module's `di.ts`-registered
service directly (see DI Registrar and Cross-module integration below)
at the moment it needs an answer — payment approval and vendor
registration are both synchronous, user-initiated flows, not something
a downstream module needs to react to automatically after the fact.
Revisit if a real asynchronous consumer emerges (YAGNI — matches the
same reasoning already used for cross-organization sharing).

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
- `api/contractors/[id]/approve/route.ts` — pending team confirmation
  (see Design decisions); custom write route calling `approveContractor`.

### Cross-module integration

AP does not call the HTTP route above at payment time. Per
`packages/core/AGENTS.md` → Cross-Module Coupling, a same-request
synchronous need on an optional peer resolves that peer's service
locally via a `tryResolve`-in-`try/catch` helper (precedent:
`inbox_ops/subscribers/extractionWorker.ts`,
`shipping_carriers/api/webhook/[provider]/route.ts`) — never a hard
`container.resolve(...)` and never an HTTP call to itself. AP's
payment command resolves `contractorBankWhitelistCheck` (the DI token
registered in this module's `di.ts`) this way and calls it in-process.
Two distinct degradation cases follow from this, both resolving to the
same policy (block the payment, never proceed without a live check —
see Risks & Impact Review):
- **`contractors` module disabled/absent** — `tryResolve` returns
  `undefined`; AP's own guard treats a missing whitelist-check service
  as "cannot verify," and blocks the payment.
- **`contractors` module present, but the live Biała Lista API call
  itself fails** — `checkBankAccountWhitelist` throws or returns an
  error result; AP catches it and blocks the payment the same way.
This module never imports or resolves anything belonging to AP —
the dependency direction is one-way (AP → `contractors`), matching
`packages/core/AGENTS.md`'s "upstream module MUST NOT import, resolve,
or hard-require the consumer."

### Backend Pages (`backend/contractors/`)

- `contractors/page.tsx` (+ `create/page.tsx`, `[id]/page.tsx`) —
  `DataTable` + `CrudForm` for `Contractor`; `nip` field disabled on
  edit (immutable, see Design decisions).
- `contractors/[id]/page.tsx` also lists the contractor's
  `ContractorBankAccount` rows inline (own mini `DataTable`), each
  showing the UX-only "last checked: N days ago" badge, plus a
  "Verify now" button per row that calls the live-check route above
  and refreshes the badge.
- Pending team confirmation: an "Approve contractor" guarded row
  action on the list, using `useGuardedMutation`, visible only for
  contractors not yet approved — same interaction pattern as GL's
  fiscal-period lock/unlock row action.

## Data Models

### Contractor

One row per contractor. `nip`/`nipHash` unique per
`(tenant_id, organization_id)` — enforces one registration per tax
identity within an organization and backs duplicate detection at
`createContractor`. `verificationStatus` starts `PENDING`, moves to
`VERIFIED`/`FAILED` asynchronously via the `verifyContractorRegistry`
worker. `gusData`/`viesData` store the raw response from the most
recent check for diagnostics — never read as a source of truth by any
command, only surfaced in the UI. `deletedAt` blocks deletion while any
`JournalEntryLine.contractorSnapshot` references this contractor or any
active `ContractorBankAccount` exists (enforced in `updateContractor`'s
delete path — see Commands).

*If `approveContractor` is confirmed in scope:* add
`approvalStatus` (`PENDING`/`APPROVED`/`REJECTED`), `approvedByUserId`,
`approvedAt` to this entity.

Supporting index for the `contractors` list filters (see API
Contracts / Queries-API): `(tenant_id, organization_id, is_vendor,
is_customer, verification_status)` on `contractor` backs the
`isVendor`/`isCustomer`/`verificationStatus` filters together (mirrors
the composite-index approach in #5663's `journal_entry`/
`journal_entry_line` indexes).

### ContractorBankAccount

One row per bank account registered for a contractor. `accountNumber`
encrypted at rest. `isPrimary` — exactly one `true` per contractor,
enforced by the command layer, not a database constraint (a partial
unique index would work too but the command-level invariant is
simpler and matches this repo's general preference for
command-enforced business rules over database-level ones beyond raw
integrity). `lastVerifiedAt`/`lastVerificationStatus` — UX cache only,
written only as a side effect of `checkBankAccountWhitelist`, never
read by any command to skip the live check (see Design decisions).
Own `organizationId`/`tenantId` (see Design decisions).

Supporting index: `(tenant_id, organization_id, contractor_id)` on
`contractor_bank_account` backs the inline-list lookup from a
contractor's detail page and the primary-account uniqueness check in
`createContractorBankAccount`/`updateContractorBankAccount`.

## API Contracts

### `GET /api/contractors` / `POST /api/contractors`

Standard `makeCrudRoute` list + create.

- **Query**: `page?`, `pageSize?` (≤100), `isVendor?`, `isCustomer?`,
  `verificationStatus?`.
- **Create body**: `{ isVendor, isCustomer, name, nip, address,
  contactEmail, contactPhone }`. `verificationStatus` not settable —
  always starts `PENDING`.
- **Response 403**: caller lacks `contractors.view` (list) or
  `contractors.manage` (create).
- **Response 409** (create): `nip` already registered for this
  organization (duplicate, detected via `nipHash`).

### `PUT /api/contractors/:id`

Standard `makeCrudRoute` update.

- **Response 400**: attempted change to `nip` — rejected
  unconditionally (see Design decisions), distinct from GL's
  posted-entries-gated immutability guards.
- **Response 409**: `OptimisticLockConflictBody` on a stale
  `updated_at`.

### `GET /api/contractors/:id/bank-accounts` / `POST .../bank-accounts`

Standard `makeCrudRoute` list + create, scoped to the parent
contractor.

- **Create body**: `{ accountNumber, isPrimary? }`.

### `POST /api/contractors/:id/bank-accounts/:bankAccountId/verify`

Custom write route (mutation guard registry, mapped to `update`).

- **Response 200**: `{ status: 'WHITELISTED' | 'NOT_WHITELISTED', checkedAt: string }` —
  always the result of a live call made during this request, never a
  cached value.
- **Response 403**: caller lacks `contractors.view`.
- **Response 502**: Biała Lista API unavailable — see Risks.

### `POST /api/contractors/:id/approve`

Pending team confirmation (see Design decisions). Custom write route,
`contractors.manage` required.

## Implementation Plan

### Phase 1: Core registry, verification, snapshotting

1. Add `Contractor`, `ContractorBankAccount` entities and their
   migration (additive only). Add `encryption.ts` declaring
   `defaultEncryptionMaps` for both entities (`nip` with `hashField:
   'nip_hash'`, `account_number` on the bank account entity).
2. Add `acl.ts` (two features) and `setup.ts`
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

### Phase 2 (deferred, pending team confirmation)

- `approveContractor` one-step approval flow, if confirmed — or a
  more elaborate multi-step/threshold-based approval if the team
  decides the light version isn't sufficient (mirrors AP's own
  Phase 2 deferral of multi-step invoice approval).
- Cross-organization contractor sharing, if a real business need
  emerges (currently YAGNI — see Design decisions).

### File Manifest

| File | Action | Purpose |
| --- | --- | --- |
| `data/entities.ts` | Create | `Contractor`, `ContractorBankAccount` |
| `migrations/MigrationXXXXXXXXXXXXXX.ts` | Create | Tables for both entities above |
| `encryption.ts` | Create | `defaultEncryptionMaps` for `contractors:contractor` (incl. `nip` → `nip_hash`) and `contractors:contractor_bank_account` |
| `di.ts` | Create | Registers `contractorBankWhitelistCheck` (`checkBankAccountWhitelist`) for cross-module resolution — see DI Registrar |
| `acl.ts` | Create | Two `contractors.*` features |
| `setup.ts` | Create | `defaultRoleFeatures` for `admin`/`employee`; no `seedDefaults` |
| `commands/contractors.ts` | Create | `createContractor` / `updateContractor` |
| `commands/contractorBankAccounts.ts` | Create | `createContractorBankAccount` / `updateContractorBankAccount` / `checkBankAccountWhitelist` |
| `workers/verifyContractorRegistry.ts` | Create | Async GUS/VIES lookup, updates `verificationStatus` |
| `api/contractors/route.ts` | Create | `Contractor` CRUD (`makeCrudRoute`) |
| `api/contractors/[id]/bank-accounts/route.ts` | Create | `ContractorBankAccount` CRUD (`makeCrudRoute`) |
| `api/contractors/[id]/bank-accounts/[bankAccountId]/verify/route.ts` | Create | Live Biała Lista check |
| `api/openapi.ts` | Create | `openApi` exports for every route above |
| `backend/contractors/page.tsx` (+ create/[id]) | Create | List/create/edit UI with inline bank-account sub-list |
| `commands/__tests__/*` | Create | Regression coverage |
| `__integration__/*` | Create | Integration coverage |

### Testing Strategy

- Assert the module-decoupling test
  (`packages/core/src/__tests__/module-decoupling.test.ts`) passes with
  `contractors` disabled, and that AP's own `tryResolve` wrapper around
  `contractorBankWhitelistCheck` degrades to "block the payment" in
  that case rather than throwing unhandled (see Cross-module
  integration, Risks & Impact Review).
- Assert `createContractor` rejects a duplicate `nip` within the same
  `(tenant, organization)` (via `nipHash` lookup), and allows the same
  `nip` across different organizations.
- Assert `updateContractor` rejects any `nip` change, unconditionally
  (not gated on any related data existing — unlike GL's guards).
- Assert `createContractorBankAccount`/`updateContractorBankAccount`
  enforce exactly one `isPrimary: true` per contractor.
- **Assert `checkBankAccountWhitelist` always performs a live call and
  never short-circuits based on `lastVerifiedAt` freshness** — this is
  the single most safety-critical test in this module, given the
  explicit rejection of cache-as-shortcut in Design decisions.
  Regression test: seed a `ContractorBankAccount` with
  `lastVerifiedAt: now()`, call `checkBankAccountWhitelist`, assert the
  live API client was actually invoked.
- Assert `verifyContractorRegistry` worker is idempotent — running it
  twice for the same contractor does not duplicate or corrupt
  `gusData`/`viesData`.
- Assert encryption round-trip: `nip`/`address`/`contactEmail`/
  `contactPhone`/`accountNumber` are stored encrypted and returned in
  plaintext only through `findWithDecryption`.
- Assert optimistic-lock 409 on `updateContractor`/
  `updateContractorBankAccount` with a stale `updated_at`.
- Integration: `GET /api/contractors` filters and 403s without
  `contractors.view`; the verify route returns 200 with a fresh
  `checkedAt` on each call (not a cached timestamp) and 502 when the
  Biała Lista API is unavailable.

## Risks & Impact Review

### Data integrity failures

- **Scenario**: two concurrent `createContractor` calls for the same
  NIP within the same organization race past an application-level
  uniqueness check before either commits.
  **Severity**: Medium. **Affected area**: `Contractor` registration.
  **Mitigation**: `nipHash` carries a `UNIQUE (tenant_id,
  organization_id, nip_hash)` database constraint, not just an
  application-level check — the second insert fails at the database
  regardless of the race. **Residual risk**: none; this is exactly
  the failure mode a DB unique constraint is for.
- **Scenario**: `createContractorBankAccount` sets `isPrimary: true`
  concurrently on two different accounts for the same contractor.
  **Severity**: Low. **Affected area**: `ContractorBankAccount`.
  **Mitigation**: command re-reads and unsets any existing primary
  inside the same transaction as the insert/update. **Residual risk**:
  a genuine race could still produce two primaries momentarily under
  extreme concurrency (no DB-level partial unique index) — acceptable
  for a low-frequency, human-initiated action; revisit if it proves to
  matter in practice.

### Cascading failures & side effects

- **Scenario**: GUS or VIES API is down when `verifyContractorRegistry`
  runs. **Severity**: Low. **Affected area**: `Contractor.verificationStatus`.
  **Mitigation**: worker sets `verificationStatus: 'FAILED'`, queue
  retry policy (per `@open-mercato/queue`) re-attempts later; contractor
  remains usable (registration is never blocked on this — see Design
  decisions) but AP's own workflow should surface unverified
  contractors before payment. **Residual risk**: a contractor could
  stay `FAILED` indefinitely if GUS/VIES are down long-term — no
  automatic re-enqueue beyond the queue's own retry window; manual
  re-trigger needed (out of scope for this document's Phase 1 UI).
- **Scenario**: Biała Lista API is down at the exact moment AP needs
  to execute a payment (AP has resolved `checkBankAccountWhitelist` via
  `tryResolve` — see Cross-module integration — and the in-process call
  itself fails). **Severity**: High (business-blocking, not
  data-corrupting). **Affected area**: AP's payment execution flow.
  **Mitigation**: `checkBankAccountWhitelist` throws/returns an error
  result; AP is expected to block the payment rather than proceed
  without a live check (this module cannot make that policy decision
  for AP — noted explicitly as AP's own responsibility, see Out of
  scope). **Residual risk**: legitimate payments could be delayed
  during a Biała Lista outage; accepted as the safer failure mode given
  the legal exposure of paying without verification.
- **Scenario**: the `contractors` module itself is disabled or absent
  when AP tries to resolve `contractorBankWhitelistCheck`.
  **Severity**: High (business-blocking). **Affected area**: AP's
  payment execution flow. **Mitigation**: AP's local `tryResolve`
  wrapper (per `packages/core/AGENTS.md` → Cross-Module Coupling)
  returns `undefined` instead of throwing; AP treats a missing service
  identically to a failed live check — block the payment. Covered by
  `packages/core/src/__tests__/module-decoupling.test.ts` per repo
  convention (see Testing Strategy). **Residual risk**: none identified
  — this is the sanctioned degrade-gracefully path, not a gap.

### Tenant & data isolation

`Contractor` and `ContractorBankAccount` are both tenant/organization
scoped, with `ContractorBankAccount` carrying its own scope columns
rather than relying only on a join through `contractorId` (matching
the `JournalEntryLine`/`SalesInvoiceLine` precedent — see Design
decisions). No cross-organization sharing exists in Phase 1 (YAGNI,
see Design decisions), so there is no shared/global resource for a
noisy-neighbor scenario to exploit.

### Migration & deployment

Additive only — two new tables (with the indexes named in Data
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
  not know what a payment is).
- **Multi-step or threshold-based vendor approval.** Phase 2, pending
  the same team confirmation as the Phase 1 one-step version — see
  Design decisions.
- **Cross-organization contractor sharing.** YAGNI — no precedent in
  the codebase, no confirmed business requirement (see Design
  decisions).
- **Purchase order / three-way matching, invoice lifecycle, payment
  execution.** Accounts Payable's concern, not this module's.
- **`journal_entry_line_dimension` (cost-center/MPK tagging).**
  Separate, earlier-sequenced document; unrelated to contractor
  identity.
- **Full historical versioning of contractor data.** Deliberately
  replaced by the `JournalEntryLine.contractorSnapshot` point-in-time
  copy (see Design decisions) — no separate audit-log table for every
  field change.

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
| `AGENTS.md` / core `AGENTS.md` | Declarative feature guards; `acl.ts` synced to `setup.ts` | Compliant | Two `contractors.*` features, `defaultRoleFeatures` in `setup.ts`, `sync-role-acls` in Implementation Plan step 2 |
| Core `AGENTS.md` § Database Entities | User-editable entities MUST include `updated_at` | Compliant | Both entities have `updatedAt`; `CrudForm` auto-derives the lock header |
| Core `AGENTS.md` § Database Entities | Standard column contract includes `deleted_at` | Compliant | Both entities have `deletedAt` (soft delete); deletion of `Contractor` blocked while snapshot references or active bank accounts exist |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant | `api/openapi.ts` in File Manifest and Implementation Plan step 7, covering every route in this module |
| `packages/core/AGENTS.md` → Encryption | GDPR/PII fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | Compliant | `contractors:contractor` (name, address, contact, `nip`+`nipHash`) and `contractors:contractor_bank_account` (`account_number`) both declared |
| `packages/queue/AGENTS.md` | Workers MUST be idempotent; MUST export `metadata: { queue, id?, concurrency? }` | Compliant | `verifyContractorRegistry.ts` follows the exact shape verified against `customers/workers/*.ts` |
| `packages/ui/AGENTS.md` | `CrudForm`/`DataTable`; guarded row actions via `useGuardedMutation` | Compliant | Contractor list/create/edit use `CrudForm`+`DataTable`; the pending-confirmation "approve" row action follows the same guarded-row-action pattern already verified for GL's fiscal-period lock/unlock |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | Two new tables only |
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

None. One item is explicitly **not yet decided** rather than
non-compliant: `approveContractor` (the one-step vendor approval
workflow) is marked throughout as pending confirmation from
Łukasz/the team — it is designed so it can be dropped without
reworking any other section, not silently assumed as approved.

### Verdict

**Ready for maintainer review, with one item flagged for explicit
team confirmation before implementation (not a compliance blocker):**
the `approveContractor` one-step vendor acceptance workflow. Every
AGENTS.md rule checked is compliant — an independent review round
(2026-09-07, second pass) found and fixed a real cross-module-coupling
gap (`checkBankAccountWhitelist` was designed as an HTTP-only call with
no degrade path; now also a `di.ts`-resolvable service behind
`tryResolve`) and a missing supporting-index gap (now added to Data
Models), and corrected several factual citation errors (see Changelog).
A separate scope-cohesion check flagged `approveContractor` as
bundled-but-severable; resolved as a deliberate choice to keep it
threaded through the same sections rather than split out (see Design
decisions). The two design decisions worked through with the team
earlier this session — `ContractorBankAccount` as its own entity, and
its verification cache as strictly UX-only, never a compliance
shortcut — remain fully threaded through Design decisions, Data
Models, Commands, Testing Strategy, and Risks. This document unblocks
the full expansion of `2026-09-06-accounts-payable.md`, which already
assumed this registry's existence.

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
  cache freshness, per Art. 96b's "on the day of transfer" requirement.
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
