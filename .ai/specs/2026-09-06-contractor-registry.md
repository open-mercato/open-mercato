# Contractor Registry — shared contractor registry (AP + AR)

**Related:** [Accounts Payable](2026-09-06-accounts-payable.md) (consumer
— vendor registration/verification), [Accounts Payable —
Payments](2026-09-06-accounts-payable-payments.md) (consumer — the
module that actually resolves `contractorBankWhitelistCheck` via
`tryResolve` at payment time, per AP's own split; **added
2026-09-08**, see Changelog), sales-invoice-gl-posting (consumer —
customers, indirectly through `sales`; **planned, not yet written**
spec — see `2026-08-18-general-ledger-core-engine.md` Out of scope),
[General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
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
  Confirmed in scope, 2026-09-08 (see Design decisions):
  `approvalStatus`
  (`PENDING_APPROVAL`/`APPROVED`/`REJECTED`), `approvedByUserId`,
  `approvedAt` — set only by `applyContractorApprovalDecision` from
  inside the workflow, never through `updateContractor` (see Design
  decisions, Workflow definition). `verificationStatus` (GUS/VIES) and
  `approvalStatus` (human approve/reject) are independent, parallel
  fields — Phase 1 does not gate one on the other, and nothing in
  Phase 1 blocks Accounts Payable from using a `PENDING_APPROVAL`
  contractor; whether it should is a real, still-open question this
  document does not resolve (see Out of scope).
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
`updateContractorBankAccount`/`applyContractorApprovalDecision` require
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
- `applyContractorApprovalDecision` — **confirmed in scope,
  see Design decisions.** Called **only** from inside the
  `contractors.vendor-approval` workflow (not directly from the UI),
  via `UPDATE_ENTITY`, `PENDING_APPROVAL` → `APPROVED` or `REJECTED`
  and nothing else (accepts no other fields). Registered separately in
  `registerWorkflowSafeCommands`, requires `contractors.manage`.
  **Deliberately not `updateContractor`** — see Design decisions
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
  { commandId: 'contractors.contractor.applyApprovalDecision', requiredFeatures: ['contractors.manage'] },
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
- **Removed 2026-09-08**: no dedicated approve route. See API
  Contracts, "Contractor approval — no dedicated route" — approval
  (confirmed in scope, 2026-09-08) completes through the generic
  `POST /api/workflows/tasks/:id/complete`.

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
  itself fails** — `checkBankAccountWhitelist` throws or returns an
  error result; `accounts_payable_payments` catches it and blocks the
  payment the same way.
This module never imports or resolves anything belonging to
`accounts_payable_payments` — the dependency direction is one-way
(`accounts_payable_payments` → `contractors`), matching
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

Confirmed in scope, 2026-09-08 (see Design decisions):
`approvalStatus` (`PENDING_APPROVAL`/`APPROVED`/`REJECTED`),
`approvedByUserId`, `approvedAt` on this entity — also listed
directly in Architecture → Entities.

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

### Phase 2 (deferred)

- A more elaborate multi-step/threshold-based approval, if the team
  decides the light, one-step version (Phase 1, step 11) isn't
  sufficient (mirrors AP's own Phase 2 deferral of multi-step invoice
  approval).
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
| `workflows.ts` | Create | **Confirmed in scope, 2026-09-08** — the `contractors.vendor-approval` definition, `registerWorkflowSafeCommands` on `applyContractorApprovalDecision` |
| `events.ts` | Create | **Confirmed in scope, 2026-09-08** — `contractors.contractor.created`, the workflow's sole trigger |
| `widgets/injection/vendor-approval/` | Create | **In `workflows`, not this module** — approval-task widget injected into `contractors.contractor.detail:details`, mirroring `workflows/widgets/injection/order-approval/` |
| `commands/contractors.ts` | Update | Adds `applyContractorApprovalDecision`, called only from inside the workflow |
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
- Confirmed in scope, 2026-09-08: assert
  `applyContractorApprovalDecision` is only reachable through the
  `contractors.vendor-approval` workflow (via `registerWorkflowSafeCommands`),
  not directly callable to bypass the approval task, and that it moves
  `approvalStatus` `PENDING_APPROVAL` → `APPROVED`/`REJECTED` only —
  never any other transition.
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
- **Scenario**: Biała Lista API is down at the exact moment
  `accounts_payable_payments` needs to execute a payment
  (`accounts_payable_payments` has resolved `checkBankAccountWhitelist`
  via `tryResolve` — see Cross-module integration — and the in-process
  call itself fails; **corrected 2026-09-08** — this was "AP" generically
  before AP's own split into invoices/payments). **Severity**: High
  (business-blocking, not data-corrupting). **Affected area**:
  `accounts_payable_payments`'s payment execution flow. **Mitigation**:
  `checkBankAccountWhitelist` throws/returns an error result;
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
- **Multi-step or threshold-based vendor approval.** Phase 2,
  deferred unless the team later decides the Phase 1 one-step version
  (confirmed in scope, 2026-09-08) isn't sufficient — see Design
  decisions.
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
- **Whether Accounts Payable should block using a contractor still in
  `PENDING_APPROVAL` status.** Phase 1 does not gate on this — `Contractor`
  exposes `approvalStatus` as a field AP can read, but this document
  doesn't mandate AP enforce it before a first payment. Left as an
  open question for AP's own design (see Architecture → Entities).

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
| `packages/ui/AGENTS.md` | `CrudForm`/`DataTable`; guarded row actions via `useGuardedMutation` | Compliant | Contractor list/create/edit use `CrudForm`+`DataTable`. **Resolved 2026-09-08** (superseding the 2026-09-07 correction, which only removed a false citation without replacing the design): the approval step (confirmed in scope, 2026-09-08) now uses the `workflows` engine (`defineWorkflow`/`USER_TASK`), 1:1 with `sales.order-approval`/`accounts_payable.invoice-approval`, not `useGuardedMutation` — consistent with the same principle already settled for `accounts_payable.invoice-approval`: a guarded row action is a real pattern only for a simple, reversible toggle (GL's fiscal-period lock/unlock), not a one-time approve/reject decision. See Design decisions, Workflow definition |
| `packages/core/AGENTS.md` → Command Side Effects | The workflow's own transition calls a command dedicated to that transition, not the entity's general-purpose update command | **Compliant (fixed this round)** | Carried over from AP's own fix to the identical latent issue in `sales.order-approval` (which reuses `sales.orders.update` for its transition): `applyContractorApprovalDecision` is a separate, narrow command, not `updateContractor` — see Design decisions |
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

None. `approveContractor` (the one-step vendor approval workflow,
now `applyContractorApprovalDecision`) was the one item carried as
**not yet decided** in the prior round; both its scope and its
mechanism are now resolved (2026-09-08) — see Design decisions,
backed by explicit research (the AFP's 2025 Payments Fraud and
Control Survey, the documented limits of the mandatory Biała Lista
check, and existing ERP precedent in SAP Ariba/ApprovalMax). Final
sign-off with Łukasz happens through the normal PR review, same as
every other decision in this document.

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
