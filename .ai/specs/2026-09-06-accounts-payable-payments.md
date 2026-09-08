# Accounts Payable — Payments

**Related:** [Accounts Payable — invoices](2026-09-06-accounts-payable.md)
(sibling document — purchase invoice lifecycle; this document has a
hard, declared dependency on it, see Architecture → Module Dependency;
split out of it 2026-09-08, see Changelog),
[General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(the posting engine this spec books into), [Contractor
Registry](2026-09-06-contractor-registry.md) (vendor registry and VAT-
whitelist verification — this spec consumes it as an optional peer,
does not duplicate it)

## TLDR

Module handling the grouping of approved, posted purchase invoices
into payment batches and posting their send. Hard, declared
dependency on `accounts_payable` (reads invoice status and totals) and
on `ledger` (posts the batch send). Verifies the VAT whitelist/
mandatory split payment (MPP) before confirming a batch — an optional
peer, `contractors`, with a fail-closed policy. Does not execute a
real bank transfer — that's Phase 2 (see Out of scope).

## Overview

On the event-storming wall the AP process is four parallel paths: (A)
vendor registration and verification (GUS/VIES/VAT whitelist — pulled
out to `Contractor Registry`), (B) purchasing materials (goods receipt
→ invoice → posted — pulled out to `2026-09-06-accounts-payable.md`),
(C) purchasing a fixed asset (asset capitalization, depreciation
schedule — pulled out to a separate Fixed Assets spec, see
`.ai/specs/2026-09-06-fixed-assets.md`), (D) outbound payments
(grouping approved invoices into payment batches, sending). **This
document covers only D** — A, B, and C are deliberately pulled out
(their own, independent capabilities; D itself was, until 2026-09-08,
part of the same document as B, see Changelog).

> **Market Reference**: SPEC-024 (the pre-workshop brief, "Cash
> Management Module" section) defines no `PaymentOrder`/
> `PaymentInstruction`-style type — only `BankTransaction` with a
> `matchedEntryId: Option<EntryId>` field, which shows reconciliation
> logic (matching an imported statement line to an entry that already
> exists), not payment-**initiation** logic. The wall (the verified
> source) settles this in favor of the split: this module initiates
> and posts the payment batch's send; the future Bank Management
> (SPEC-024) only imports the statement and matches it back to what
> this module already executed — see Design decisions.

## Problem Statement

Today there is no module responsible for the payment side — approved,
posted purchase invoices (`2026-09-06-accounts-payable.md`) have no
mechanism for grouping into payment batches or posting the send.
Confirmed directly in the repo: no `PaymentBatch`/`PaymentOrder`/
`PaymentInstruction` entity exists anywhere in the code, and the
`contractors` module (Contractor Registry) has `ContractorBankAccount`
with a (encrypted) account number and VAT-whitelist verification as
part of the vendor registry, but no logic for grouping invoices into
payments.

**This document was originally part of one combined `accounts_payable`
module** together with the invoice half (`VendorInvoice`/
`VendorInvoiceLine`). Two independent, fresh-context reviews
(compliance/checklist + architectural) both independently reached a
SPLIT verdict: separate ACL groups, separate `postJournalEntry` calls
to GL, coupling only through an FK (the same shape as referencing the
fully separate Contractor Registry module), a separate legal-risk
domain (the VAT whitelist/MPP applies only to payments, not invoice
receipt). The team confirmed the split on 2026-09-08 — see Design
decisions and Changelog.

## Proposed Solution

A new, independent `accounts_payable_payments` module with one entity
group: **payment batches** (`PaymentBatch`/`PaymentBatchLine`, grouping
approved, posted invoices from `accounts_payable` into batches,
confirmation with VAT-whitelist verification, send with posting). The
module does not post directly to the database — the transition to
`SENT` calls `postJournalEntry` from GL through the generic
`commandBus`, the same way `accounts_payable` itself does (see
Architecture → Cross-module integration). It has a hard, declared
dependency on two modules: `ledger` (posting) and `accounts_payable`
(reads invoice status and the configured liability account) — unlike
`contractors`, which remains an optional peer with a fail-closed
policy.

### Design decisions (2026-09-07 — resolved at the workshop)

**Payments: this module creates the proposal and executes the
transfer; Bank Management does statement import and reconciliation.**
Confirmed directly in SPEC-024's own source text (a `grep` on
`.ai/specs/SPEC-024-...md`, "Cash Management Module" section):

```typescript
type BankTransaction = {
  id: TransactionId
  bankAccountId: BankAccountId
  transactionDate: LocalDate
  valueDate: LocalDate
  amount: Money
  reference: string
  matchedEntryId: Option<EntryId>
}
```

The `matchedEntryId: Option<EntryId>` field shows that Cash Management
**matches** a bank transaction to an entry that already exists — that's
reconciliation logic (an imported statement line ↔ something already
posted), not payment-**initiation** logic. SPEC-024 defines no
`PaymentOrder`/`PaymentInstruction`-style type in the Cash Management
module. This settles the open review question (whether payments stay
in AP or move to Bank Management) in favor of the current split: this
module initiates and executes the transfer (grouping invoices into
payment batches — this requires a close relationship with approved
invoices), Bank Management only imports the statement and matches it
back to what this module already executed.

**VAT-whitelist and mandatory split payment (MPP) verification is a
hard Phase 1 blocker, not a warning.** Real legal risk (joint-and-
several VAT liability, the PLN 15,000 threshold, Annex 15 of the VAT
Act) — see the full legal justification in
`2026-09-06-contractor-registry.md`.

**Real bank integration (calling a bank's API / a transfer file) —
Phase 2.** No precedent whatsoever in the repo — SPEC-024's Cash
Management defines no `PaymentOrder`/`PaymentInstruction`/
`PaymentBatch` type. Phase 1 ends at creating and posting the payment
batch; executing the transfer itself (a file to the bank, an API) is
Phase 2 — see Out of scope.

**Partial payments — Phase 2.** Phase 1: `PaymentBatchLine.amount` is
always the full remaining invoice amount; no support for settling one
invoice with multiple partial payments.

### Design decisions (2026-09-07 — added during the full spec expansion, at the time still combined with invoices)

**`confirmPaymentBatch` calls `contractorBankWhitelistCheck` from the
`contractors` module through a local `tryResolve`, fail-closed — a
different policy than in Contractor Registry, the same mechanism.**
`contractors` **is** an optional peer here (unlike `ledger`/
`accounts_payable`, both hard dependencies). The difference from
Contractor Registry: there, a missing module only degrades the UI (the
"verify now" button stops working, fail-open — safe, because it's a
UX convenience, not a legal blocker); here, a missing module **blocks
confirmation of the entire batch** (fail-closed), because it's a hard
legal blocker (VAT whitelist/MPP), not a convenience. The same
mechanism (`tryResolve`), a different business policy when there's no
result — the module never treats a missing result as "assume
WHITELISTED".

**`PaymentBatchLine.whitelistCheckResult` does not duplicate the bank
account number.** The account number is already encrypted on
`ContractorBankAccount.accountNumber` (`contractors/encryption.ts`);
duplicating it here in unencrypted form would be a second,
uncontrolled copy of data already covered by encryption. Only the
verification result is stored (`status`, `checkedAt`, `requestId`) —
this is **compliance evidence**, not a UX cache like
`ContractorBankAccount.lastVerifiedAt` (never read in place of a fresh
call for the next batch). Consequence for this document: no
`encryption.ts` of its own is needed — see Architecture → Encryption
below.

### Design decisions (2026-09-08 — Q1 resolved: split into two modules)

**Split into `accounts_payable` (sibling document — invoices) and
`accounts_payable_payments` (this document — payments).** Two
independent, fresh-context reviews independently reached a SPLIT
verdict: separate ACL groups (`invoices.*` vs `payments.*`), separate
`postJournalEntry` calls to GL (two different postings, two different
moments), coupling only through an FK
(`PaymentBatchLine.vendorInvoiceId` — the same shape as referencing
the fully separate Contractor Registry module), a separate legal-risk
domain (the VAT whitelist/MPP applies only to this document, not
invoice receipt). The counter-argument for COHESIVE (a shared
liability account, live access to approved invoices when building a
batch) was real, but didn't win out — see the sibling document's
Design decisions for the full justification (the same analysis, the
same verdict, not repeated here in full). The team confirmed SPLIT on
2026-09-08.

**A new mechanism introduced by the split: a direct cross-module
query for `VendorInvoice`, without `commandBus`.**
`createPaymentBatch`/`updatePaymentBatch` need to find approved
(`status === 'POSTED'`), not-yet-batched invoices for the same vendor/
currency, that aren't already attached to another, unfinished batch.
As long as both entity groups lived in one module, this was an
ordinary intra-module query; the split makes it the first place in
this whole document where the module reads someone else's entity (not
just an FK-id) across a module boundary. **Decision**: a direct
`entityManager` query against the `VendorInvoice` entity (importing the
type, **without** declaring an ORM relation — root `AGENTS.md`'s ban
concerns relations/joins, not simply importing a type for a query),
always scoped by `tenantId`/`organizationId` (mirroring how
`ModuleConfigService.get('accounts_payable.liabilityAccountId',
{ tenantId })` already reads someone else's configuration value
directly, without wrapping it in `commandBus`). Rationale:
`accounts_payable` is a hard, always-co-present dependency of this
module (validated at generation time through `ModuleInfo.requires`,
see Module Dependency) — not an optional peer like `contractors` — so
there's no degradation scenario to design here, just as there isn't
for `ledger`. **This is a new pattern, not an existing repo
precedent** — unlike `commandBus.execute('ledger.postJournalEntry', ...)`,
which has a direct precedent (`workflows`'
`UPDATE_ENTITY`), no existing module in the repo today queries another
hard-dependency module's entity directly. Rejected alternative: a thin
query command on `accounts_payable`
(`accounts_payable.vendorInvoices.listPayable`, called through the
same `commandBus`) — would give stricter encapsulation at the cost of
an extra indirection layer for something that always co-exists with
`accounts_payable` anyway; flagged as an open implementation decision
(not a Q-style architectural fork requiring escalation — both options
are correct and low-risk), for maintainers to confirm at code review,
see Alternatives considered.

**API path change**: the HTTP route base path changes from
`/api/accounts_payable/payments/...` (when this was one module) to
`/api/accounts_payable_payments/payments/...` (mirroring the "API
routes live under their own module's prefix" convention, the same way
`/api/accounts_payable/invoices` lives under `accounts_payable`) — see
API Contracts. An external contract change caused by the split,
documented explicitly, not glossed over.

### Alternatives considered

| Alternative | Why Rejected |
|-------------|-------------|
| Real bank integration (calling a bank's API / a transfer file) in Phase 1 | No precedent whatsoever in the repo — SPEC-024's Cash Management defines no `PaymentOrder`/`PaymentInstruction`/`PaymentBatch` type. Phase 1 ends at creating and posting the payment batch; executing the transfer itself is Phase 2 |
| Keep invoices and payments in one `accounts_payable` module | Rejected 2026-09-08 after two independent reviews — see Design decisions, "Q1 resolved" |
| A thin query command on `accounts_payable` (`listPayable`) instead of a direct `entityManager` query across the module boundary | Considered as a safer, more encapsulated alternative (the same mechanism as `postJournalEntry`) — not rejected, only deferred as an open implementation decision: either this is chosen at code review, or the direct query is (both have the same functional effect, neither requires reworking entities/commands) |

## User Stories

- **AP clerk** wants to **group several approved invoices for the same
  vendor into one payment batch**, so they can **execute one transfer
  instead of many separate ones**.
- **AP clerk** wants the **system to block sending a payment if the
  vendor's bank account isn't on the VAT whitelist that day**, so the
  **company doesn't incur joint-and-several VAT liability for the
  vendor**.
- **Chief accountant** wants **certainty that a posted invoice (in
  `accounts_payable`) never disappears from account 202 without a
  matching payment entry recorded by this module**, so **vendor
  reconciliation always balances** — this is exactly the cross-module
  relationship both documents must keep consistent despite the split
  (see Design decisions, "Q1 resolved").

## Architecture

### Entities (`data/entities.ts`)

- `PaymentBatch` — `bankAccountId` (FK-id, `uuid` — a reference to a
  future Bank Management/SPEC-024 entity; this module does not
  implement it, exactly the same way AP references `Contractor`/
  `LedgerAccount` from modules that, at the time this spec was
  written, may themselves be only a spec), `status`
  (`DRAFT`/`CONFIRMED`/`SENT`/`CANCELLED`), `scheduledPaymentDate`,
  `totalAmount` (`numeric(19,4)`, computed from the lines),
  `postedJournalEntryId` (nullable FK-id, set after
  `markPaymentBatchSent` — the same idempotency guard as
  `VendorInvoice.postedJournalEntryId`, see the sibling document),
  tenant/org scoped, `updatedAt` (optimistic lock as long as `status`
  is `DRAFT`/`CONFIRMED`), `deletedAt` (soft delete, blocked after
  `SENT`).
- `PaymentBatchLine` — `paymentBatchId` (FK), `vendorInvoiceId`
  (FK-id → `accounts_payable.VendorInvoice`, `uuid`, no ORM relation —
  see Design decisions, "A new mechanism... direct query"),
  `contractorBankAccountId` (FK-id → `ContractorBankAccount` from
  Contractor Registry — the specific account this particular transfer
  goes to), `amount` (`numeric(19,4)` — Phase 1: always the full
  remaining invoice amount, no partial payments, see Out of scope),
  `whitelistCheckResult` (nullable `json` — the result of the live
  VAT-whitelist verification at `confirmPaymentBatch` time: `status`,
  `checkedAt`, `requestId` — **without** the account number, see
  Design decisions and Encryption below), its own
  `organizationId`/`tenantId`.

### Access Control (`acl.ts`)

Following the `customers`/`ledger` module convention
(`<module>.<resource>.<action>`, `manage`/`execute` depending on
`view`):

```typescript
export const features = [
  { id: 'accounts_payable_payments.payments.view', title: 'View payment batches', module: 'accounts_payable_payments' },
  { id: 'accounts_payable_payments.payments.manage', title: 'Create and edit payment batches', module: 'accounts_payable_payments', dependsOn: ['accounts_payable_payments.payments.view'] },
  { id: 'accounts_payable_payments.payments.execute', title: 'Confirm and send payment batches', module: 'accounts_payable_payments', dependsOn: ['accounts_payable_payments.payments.view'] },
]
```

`createPaymentBatch`/`updatePaymentBatch`/`cancelPaymentBatch` require
`accounts_payable_payments.payments.manage` (cancelling an unsent
batch isn't a movement of money, so `.manage` is enough — mirroring
the decision for `cancelVendorInvoice` in the sibling document).
`confirmPaymentBatch`/`markPaymentBatchSent` require
`accounts_payable_payments.payments.execute` (separate from `.manage`
— an actual movement of money deserves its own, narrower gate).

The feature name repeats the word "payments" (both the module name
and the resource name) — a deliberately accepted redundancy, not a
mistake: the resource really is "payments" (payment batches),
regardless of the module's name, and the `<module>.<resource>.<action>`
convention applies whether or not the module name already contains
the resource name.

### Module Dependency (`index.ts`)

Two hard, declared dependencies — `ledger` (posting) and
`accounts_payable` (invoice status, the configured liability account —
see Cross-module integration) — expressed through the same real,
generation-time-validated `ModuleInfo.requires` mechanism
(`packages/shared/src/modules/registry.ts`), already used by `sales`
(`requires: ['catalog','customers','dictionaries']`) and `wms`:

```typescript
// index.ts
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  id: 'accounts_payable_payments',
  requires: ['ledger', 'accounts_payable'],
}
```

`contractors` is not on this list deliberately — it's an optional peer
(see Cross-module integration), not a hard dependency; declaring it
here would break the very degradation mechanism `tryResolve` is meant
to provide.

### Encryption (`encryption.ts`)

**This module needs no `encryption.ts` of its own.**
`PaymentBatchLine.whitelistCheckResult` stores only the verification
result (`status`/`checkedAt`/`requestId`), deliberately without the
bank account number — that's already encrypted on
`ContractorBankAccount.accountNumber` in `contractors/encryption.ts`
(see Design decisions). No other field on `PaymentBatch`/
`PaymentBatchLine` carries PII/GDPR-sensitive data.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: ['accounts_payable_payments.*'],
  employee: [
    'accounts_payable_payments.payments.view',
    'accounts_payable_payments.payments.manage',
  ],
  // employee deliberately without '.execute' — confirming/sending a
  // batch (an actual movement of money) is a narrower gate, mirroring
  // employee not getting '.post' in accounts_payable
},

async seedDefaults({ em, tenantId, organizationId }) {
  // Writes an empty module_configs row for
  // accounts_payable_payments.defaultCashAccountId — see Migration &
  // Deployment. Does not write a value for
  // accounts_payable.liabilityAccountId — that belongs to the sibling
  // document (see Data Models → Module Config).
}
```

### Commands (Command Pattern, `commands/`)

- `createPaymentBatch` — creates a `PaymentBatch` in `DRAFT`, empty.
- `updatePaymentBatch` — adds/removes `PaymentBatchLine` (only
  invoices with status `POSTED` in `accounts_payable`, not yet
  attached to another unfinished batch — read directly through
  `entityManager`, see Design decisions and Cross-module integration),
  only while `PaymentBatch.status === 'DRAFT'`.
- `confirmPaymentBatch` — `DRAFT` → `CONFIRMED`. For each line,
  resolves `contractorBankWhitelistCheck` from the `contractors`
  module through a local `tryResolve` (the same pattern as in
  Contractor Registry — `contractors` **is** an optional peer here,
  unlike `ledger`/`accounts_payable`). **The degradation policy differs
  from Contractor Registry**: there, a missing module safely skipped
  only the UI's "verify now" button; here, because it's a hard legal
  blocker (VAT whitelist/MPP), a missing module **blocks confirmation
  of the entire batch** (fail-closed), instead of silently proceeding
  (fail-open) — the same mechanism (`tryResolve`), a different
  business policy when there's no result.
- `markPaymentBatchSent` — `CONFIRMED` → `SENT`. Resolves `commandBus`
  from the container and calls `ledger.postJournalEntry` with one DR
  line to the configured liability account
  (`accounts_payable.liabilityAccountId` — read directly through
  `ModuleConfigService` scoped by the sibling module's `tenantId`, see
  Data Models → Module Config) per `VendorInvoiceLine` sum (or one
  line per invoice in the batch), one CR line to the configured
  bank/cash account
  (`accounts_payable_payments.defaultCashAccountId`),
  `referenceType: 'accounts_payable_payments:payment_batch'`,
  `referenceId: batch.id`. **Does not execute a real bank transfer** —
  see Out of scope. Sets `postedJournalEntryId` (idempotency guard,
  mirroring `postVendorInvoice`).
- `cancelPaymentBatch` — `DRAFT`/`CONFIRMED` → `CANCELLED` (soft
  delete via `deletedAt`; frees the attached invoices so they can go
  into another batch — logically, by removing `PaymentBatchLine`, not
  by writing back to `VendorInvoice` itself). Blocked for `SENT`.

**This module defines no workflow of its own.** Unlike
`accounts_payable`'s invoice approval flow (a one-off approve/reject
decision, `defineWorkflow`/`USER_TASK`), confirming and sending a
payment batch are simple, cancel-reversible state transitions, gated
by plain `.execute`/`.manage` ACL and `useGuardedMutation` at the UI
level (see Backend Pages) — not a one-off, irreversible decision
requiring a `USER_TASK`. This is exactly the first case ("a simple,
reversible toggle") distinguished in `accounts_payable`'s Design
decisions from the second ("a one-off approve/reject decision").

### Events (`events.ts`)

```typescript
const events = [
  { id: 'accounts_payable_payments.payment_batch.confirmed', label: 'Payment Batch Confirmed', entity: 'payment_batch', category: 'lifecycle' },
  { id: 'accounts_payable_payments.payment_batch.sent', label: 'Payment Batch Sent', entity: 'payment_batch', category: 'lifecycle' },
] as const
```

`.sent` is ephemeral (mirroring `ledger.journal_entry.posted`) — no
persistent subscriber is needed yet in Phase 1; the future Posting
Rules Engine subscribes directly to `ledger.journal_entry.posted`
(from GL), not to this module's events — this module isn't its data
source, GL is (see `2026-09-06-posting-rules-engine.md`). This module
does **not** subscribe to any event from `accounts_payable` — it reads
`VendorInvoice` status directly (a query, not an event) when building a
payment batch, see Cross-module integration.

### Cross-module integration

Three different relationships with three different modules —
deliberately different mechanisms, not by oversight:

- **GL (`ledger.postJournalEntry`) — a hard, declared dependency, not
  an optional peer.** `packages/core/AGENTS.md` → Cross-Module
  Coupling describes `tryResolve` for **optional** integration; GL
  isn't optional here. This module calls
  `container.resolve('commandBus').execute('ledger.postJournalEntry', input, ctx)`
  — the same generic mechanism `accounts_payable` already uses for
  exactly the same purpose, and that `workflows`'
  `UPDATE_ENTITY` already uses to call any command by string
  `commandId`.
- **`accounts_payable` — a hard, declared dependency, with a new
  pattern: a direct entity query across the module boundary.**
  `updatePaymentBatch` queries `VendorInvoice` directly through
  `entityManager` (status `POSTED`, vendor, currency, excluding
  invoices already attached to another unfinished batch — always
  scoped by `tenantId`/`organizationId`), and `markPaymentBatchSent`
  reads `accounts_payable.liabilityAccountId` directly through
  `ModuleConfigService` scoped by `tenantId` (not through
  `commandBus` — this is a configuration value, not a command).
  Rationale and the rejected alternative (a thin query command) — see
  Design decisions, "A new mechanism introduced by the split".
- **Contractors (`contractorBankWhitelistCheck`) — an optional peer,
  with a fail-closed policy.** This module resolves through a local
  `tryResolve` in a `try/catch`, exactly as designed in Contractor
  Registry. The difference from that spec: there, a missing module
  degrades only the UI (`verify now` stops working); here, a missing
  module **blocks** `confirmPaymentBatch` entirely — because it's a
  hard legal blocker (VAT whitelist/MPP), not a UX convenience. This
  module never treats a missing result as "assume WHITELISTED"
  (fail-open) — always as "I can't verify, so I block" (fail-closed).

### Backend Pages (`backend/accounts_payable_payments/`)

- `payments/page.tsx` — payment batch `DataTable`.
- `payments/create/page.tsx`, `payments/[id]/page.tsx` — batch
  creation (choosing approved, posted, unpaid invoices for the same
  vendor/currency from `accounts_payable`), a guarded row action
  "Confirm" (`useGuardedMutation` on `confirmPaymentBatch` — this is a
  plain, toggle-like state transition, not an approve/reject decision,
  so `useGuardedMutation` is the right pattern here, unlike invoice
  approval in the sibling document) and "Send" (`markPaymentBatchSent`).

## Data Models

### PaymentBatch

- `id`: uuid (PK)
- `tenant_id`, `organization_id`: uuid
- `bank_account_id`: uuid (FK-id, reference to a future Bank Management entity)
- `status`: text (`DRAFT`/`CONFIRMED`/`SENT`/`CANCELLED`)
- `scheduled_payment_date`: date
- `total_amount`: numeric(19,4)
- `posted_journal_entry_id`: uuid, nullable
- `updated_at`: timestamptz, nullable (optimistic lock while `status` is `DRAFT`/`CONFIRMED`)
- `deleted_at`: timestamptz, nullable

Supporting index: `(tenant_id, organization_id, status,
scheduled_payment_date)` for the batch list.

### PaymentBatchLine

- `id`: uuid (PK)
- `payment_batch_id`: uuid (FK)
- `vendor_invoice_id`: uuid (FK-id → `accounts_payable.VendorInvoice`, no ORM relation)
- `contractor_bank_account_id`: uuid (FK-id → `contractors.ContractorBankAccount`, no ORM relation)
- `amount`: numeric(19,4)
- `whitelist_check_result`: json, nullable
- `tenant_id`, `organization_id`: uuid (own)

Supporting index: `(payment_batch_id)` for loading batch lines;
`(vendor_invoice_id)` so `createPaymentBatch`/`updatePaymentBatch` can
quickly exclude invoices already attached to another unfinished batch.

### Module Config (`ModuleConfigService`, tenant scope)

- `accounts_payable_payments.defaultCashAccountId` — the default
  bank/cash account (e.g. "130"), used as the CR in
  `markPaymentBatchSent` when `PaymentBatch.bankAccountId` doesn't yet
  map to a specific ledger account (Bank Management doesn't exist in
  code — this is a temporary fallback, to be removed once a real
  bank-account-to-ledger-account mapping exists). Owned by this
  document, set in its config UI.
- **`accounts_payable.liabilityAccountId` — read, not owned.** The
  vendor liability account, used as the DR in `markPaymentBatchSent`.
  Set in the sibling document's config UI; this module reads it
  directly through `ModuleConfigService` scoped by `tenantId` (see
  Cross-module integration) — the one intentional, documented shared
  configuration point between the two documents (see Design
  decisions, "Q1 resolved").

Both are read without `tenantId` in scope only as a fallback (a global
row) — in practice every tenant sets them during onboarding, through
`onTenantCreated` (see Migration & Deployment).

## API Contracts

### `GET /api/accounts_payable_payments/payments` / `POST /api/accounts_payable_payments/payments`

Standard `makeCrudRoute` for `PaymentBatch` (create makes an empty
`DRAFT`; lines are added separately). Base path changed from
`/api/accounts_payable/payments/...` (when this was one module, see
Design decisions, "API path change") to
`/api/accounts_payable_payments/payments/...`, mirroring the "API
routes live under their own module's prefix" convention.

- **Response 403**: caller lacks `accounts_payable_payments.payments.view` (list) / `.manage` (create).

### `POST /api/accounts_payable_payments/payments/:id/lines`

Custom write route adding a `PaymentBatchLine` (mapped to `update`).

- **Request**: `{ vendorInvoiceId, contractorBankAccountId, amount }`.
- **Response 409**: `PaymentBatch.status !== 'DRAFT'`, or the invoice
  isn't `POSTED` (in `accounts_payable`), or the invoice is already
  attached to another unfinished batch.
- **Response 403**: caller lacks `accounts_payable_payments.payments.manage`.

### `POST /api/accounts_payable_payments/payments/:id/confirm`

Custom write route (mapped to `update`).

- **Response 200**: `{ id, status: 'CONFIRMED' }`.
- **Response 422 `WHITELIST_CHECK_FAILED`**: `{ code:
  'WHITELIST_CHECK_FAILED', failedLines: { vendorInvoiceId, reason
  }[] }` — at least one line failed the live VAT-whitelist
  verification (or the `contractors` module is unavailable — see
  Cross-module integration, fail-closed).
- **Response 403**: caller lacks `accounts_payable_payments.payments.execute`.

### `POST /api/accounts_payable_payments/payments/:id/send`

Custom write route (mapped to `update`).

- **Response 200**: `{ id, status: 'SENT', postedJournalEntryId }`.
- **Response 409**: `status !== 'CONFIRMED'`.
- **Response 403**: caller lacks `accounts_payable_payments.payments.execute`.

### `POST /api/accounts_payable_payments/payments/:id/cancel`

Custom write route (mapped to `update`).

- **Response 200**: `{ id, status: 'CANCELLED' }`.
- **Response 409**: `status === 'SENT'`.
- **Response 403**: caller lacks `accounts_payable_payments.payments.manage`.

## Migration & Deployment

New, additive tables: `accounts_payable_payments_payment_batches`,
`accounts_payable_payments_payment_batch_lines` — zero changes to
existing tables in other modules (GL, Contractor Registry,
`accounts_payable`). `onTenantCreated` in `setup.ts` writes an empty
default value for `accounts_payable_payments.defaultCashAccountId` (a
row in `module_configs` with `tenant_id` set) — it can't pick a
sensible value automatically (it depends on the tenant's actual chart
of accounts), so `markPaymentBatchSent` rejects the call with a
readable configuration error until the accountant sets this value
(and `accounts_payable.liabilityAccountId` in the sibling document)
through the module configuration screen.

## Implementation Plan

### Phase 1: Payment batches, VAT-whitelist verification, send posting

1. `index.ts` (`metadata.requires: ['ledger', 'accounts_payable']`) +
   entities + migration (the two tables above) + indexes from Data
   Models.
2. `acl.ts` + `setup.ts` (roles, `defaultRoleFeatures`,
   `onTenantCreated` writing an empty `defaultCashAccountId` value).
3. `createPaymentBatch` / `updatePaymentBatch` / `cancelPaymentBatch`
   (querying for approved, unattached invoices from
   `accounts_payable` — see Cross-module integration, an
   implementation decision to be confirmed at code review: direct
   query vs. a thin query command).
4. `confirmPaymentBatch` (the `contractorBankWhitelistCheck`
   integration through `tryResolve`, fail-closed) + `events.ts`.
5. `markPaymentBatchSent` (the `commandBus` call →
   `ledger.postJournalEntry`, reading
   `accounts_payable.liabilityAccountId` from the sibling module).
6. API routes + `api/openapi.ts` (including `.../cancel`).
7. Backend pages (payments list/create/edit).
8. Module config UI (setting `defaultCashAccountId`).
9. Unit + integration test coverage (see Testing Strategy).

### Phase 2 (deferred)

- Real bank integration (calling a bank's API, or exporting a transfer
  file) — today `markPaymentBatchSent` only posts, doesn't send money.
- Partial payments (today: the full invoice amount or nothing).
- Budgets/payment amount limits — the pre-workshop brief (SPEC-024,
  "Budgeting & Forecasting" section, the "Finance Manager wants to set
  budget limits" role) suggests a separate, future Budgeting module —
  not confirmed at the workshop as part of this document, so
  deliberately out of scope.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `index.ts` | Create | `metadata.requires: ['ledger', 'accounts_payable']` — two hard dependencies |
| `data/entities.ts` | Create | `PaymentBatch`, `PaymentBatchLine` |
| `acl.ts` | Create | Three features (view/manage/execute) |
| `setup.ts` | Create | `defaultRoleFeatures`; `onTenantCreated` writing an empty `defaultCashAccountId` |
| `events.ts` | Create | Two events (see Events) |
| `commands/paymentBatches.ts` | Create | `createPaymentBatch`, `updatePaymentBatch`, `confirmPaymentBatch`, `markPaymentBatchSent`, `cancelPaymentBatch` |
| `lib/whitelistCheck.ts` | Create | Local `tryResolve` wrapper around `contractorBankWhitelistCheck`, fail-closed policy |
| `lib/vendorInvoiceQueries.ts` | Create | Direct `entityManager` queries against `accounts_payable.VendorInvoice` (or a call to a thin query command, if that's decided at code review — see Design decisions) |
| `api/openapi.ts` | Create | `openApi` exports for every `accounts_payable_payments` route |
| `api/payments/route.ts` | Create | `PaymentBatch` CRUD (`makeCrudRoute`) |
| `api/payments/[id]/lines/route.ts`, `.../confirm/route.ts`, `.../send/route.ts`, `.../cancel/route.ts` | Create | Custom guarded write routes |
| `backend/accounts_payable_payments/payments/page.tsx` (+ create/[id]) | Create | Payment batch list/create/edit UI |
| `backend/config/accounts_payable_payments/page.tsx` | Create | `defaultCashAccountId` config UI |
| `commands/__tests__/*` | Create | Regression coverage for all commands above |
| `__integration__/*` | Create | Integration coverage: full batch build→confirm→send flow; whitelist fail-closed path; `accounts_payable` unavailable path |

## Testing Strategy

- Build a payment batch from two approved, posted invoices for the
  same vendor (from `accounts_payable`); confirm it (mock
  `contractorBankWhitelistCheck` returns `WHITELISTED` for both); send
  it; assert a balanced `JournalEntry` on the liability/bank account.
- Confirm a batch when one line fails VAT-whitelist verification;
  assert a `422 WHITELIST_CHECK_FAILED` response, the batch stays
  `DRAFT`.
- Confirm a batch when the `contractors` module is disabled (a
  module-decoupling test, see `packages/core/AGENTS.md` → Testing
  with Disabled Modules); assert fail-closed — the batch does **not**
  move to `CONFIRMED`.
- Build a batch when the `accounts_payable` module is disabled (a
  module-decoupling test); assert that `createPaymentBatch`/
  `updatePaymentBatch` can't find any qualifying invoice — unlike the
  `contractors` test above, this scenario is in practice impossible to
  trigger in production (`accounts_payable` is a generation-time-
  validated hard dependency), but the regression test documents the
  expected behavior if that validation ever fails.
- Cancel a payment batch in `DRAFT` and in `CONFIRMED`; assert
  `CANCELLED`, attached invoices freed (available for another batch);
  cancelling a `SENT` batch must return 409.
- Send the same batch twice (a retry after a network timeout); assert
  the second `markPaymentBatchSent` call is a no-op, doesn't duplicate
  the entry (idempotency guard, mirroring `postVendorInvoice`'s test in
  the sibling document).

## Risks & Impact Review

### Data integrity failures

#### Double posting of the same payment batch
- **Scenario**: `markPaymentBatchSent` called twice for the same batch
  (e.g. a retry after a network timeout), before the first call
  manages to set `postedJournalEntryId`.
- **Severity**: High
- **Affected area**: `accounts_payable_payments`, `ledger` (a
  duplicate, unbalanced entry on the liability/bank account)
- **Mitigation**: `postedJournalEntryId` is checked and set in the
  same transaction as the `commandBus` call
  (`withAtomicFlush`/transaction wrapping); a second, concurrent
  attempt on the same batch must see `postedJournalEntryId` already
  set and return a no-op instead of calling `postJournalEntry` again —
  mirroring `postVendorInvoice`'s mitigation in the sibling document.
- **Residual risk**: a theoretical race window between reading and
  writing `postedJournalEntryId` under two simultaneous requests —
  requires a unique constraint or a select-for-update on
  `PaymentBatch.id` inside the command; to be confirmed at
  implementation time.

### Cascading failures & side effects

#### The `contractors` module missing blocks all payments
- **Scenario**: the `contractors` module is disabled or unavailable (a
  DI error); `confirmPaymentBatch` can't resolve
  `contractorBankWhitelistCheck`.
- **Severity**: High (operationally), but intentional
- **Affected area**: `accounts_payable_payments.payments.*`
- **Mitigation**: fail-closed by design — no batch can move to
  `CONFIRMED` without a fresh verification result. This is correct
  legal behavior, not a bug to fix.
- **Residual risk**: none — this is a designed, acceptable outcome
  (blocking payments beats a joint-and-several VAT liability breach).

#### `ledger.postJournalEntry` unavailable (the `ledger` module disabled)
- **Scenario**: `commandBus.execute('ledger.postJournalEntry', ...)`
  throws, because `ledger` isn't registered.
- **Severity**: Critical
- **Affected area**: the whole module — it can't post any batch's
  send.
- **Mitigation**: no degradation to design — this is a hard
  dependency (see Cross-module integration), declared through
  `index.ts`'s `metadata.requires`.
- **Residual risk**: none — expected behavior for a missing hard
  dependency.

#### The `accounts_payable` module unavailable
- **Scenario**: the `accounts_payable` module is disabled or
  unavailable; a direct query for `VendorInvoice` (see Cross-module
  integration) returns no rows, or throws if the entity isn't
  registered.
- **Severity**: Critical, but intentional
- **Affected area**: the whole module — it can't build or send any
  batch (no invoices to attach, no
  `accounts_payable.liabilityAccountId` to post the send against).
- **Mitigation**: no degradation to design — this is a generation-
  time-validated hard dependency (`ModuleInfo.requires`), analogous to
  `ledger`. **A new risk introduced by the split** (before 2026-09-08
  this was one module — this scenario simply didn't exist), but
  symmetric to the already-accepted risk of a missing `ledger`.
- **Residual risk**: none — expected behavior for a missing hard
  dependency; in practice impossible to trigger, since module
  registration validates `requires` at generation time.

### Tenant & data isolation

Both entities have their own `tenant_id`/`organization_id`
(`PaymentBatchLine` has its own scope columns, not just inherited
through the FK, mirroring `ContractorBankAccount`).
`ModuleConfigService` with an explicit `tenantId` in scope guarantees
that one tenant's bank/cash account never leaks as a fallback to
another — the same applies to reading
`accounts_payable.liabilityAccountId` (see Data Models → Module
Config).

### Migration & deployment

See the Migration & Deployment section above — two new, additive
tables, zero changes to existing ones. `onTenantCreated` is idempotent
(can run multiple times without duplicating `module_configs` rows —
`ModuleConfigService`'s partial unique indexes guarantee this).

## Out of scope (tracked separately)

- Real bank integration (an actually executed transfer) — no
  precedent whatsoever in the repo; `markPaymentBatchSent` in this
  document only posts, doesn't send money. A separate, future spec
  (a Bank Management/SPEC-024 expansion).
- Budgets/payment amount limits — a pre-workshop concept (SPEC-024),
  not confirmed at the workshop as part of this document; a separate,
  future Budgeting module, if it ever exists.
- Partial payments — Phase 2.
- Invoice receipt and the approval flow — see
  `2026-09-06-accounts-payable.md`.

## Final Compliance Report — 2026-09-08

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `vendorInvoiceId`, `contractorBankAccountId`, `bankAccountId` all FK-id only, no relation decorators — including the new direct-query pattern against `accounts_payable.VendorInvoice` (see Design decisions) |
| root AGENTS.md | Filter by organization_id | Compliant | Both entities tenant/org scoped; `PaymentBatchLine` carries own scope columns |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant | `api/openapi.ts` covers every route, per File Manifest |
| `packages/core/AGENTS.md` → API Routes | Custom write routes wire the mutation guard registry | Compliant | `lines`/`confirm`/`send`/`cancel` routes all mapped to `update` operation |
| `packages/core/AGENTS.md` → Cross-Module Coupling | Optional-peer sync calls resolve via `tryResolve` in `try/catch`; hard dependency uses direct resolution | Compliant | `contractorBankWhitelistCheck` via `tryResolve` (optional peer, fail-closed policy); `ledger.postJournalEntry` via direct `commandBus.execute` (hard dependency) |
| `packages/core/AGENTS.md` → Cross-Module Coupling (hard dependency mechanism) | Hard dependency declared through `ModuleInfo.requires` | Compliant | `index.ts` with `metadata.requires: ['ledger', 'accounts_payable']` |
| `packages/core/AGENTS.md` → Cross-Module Coupling (new pattern) | Direct entity query across a hard-dependency module boundary | **Compliant, but a new pattern introduced by this split — flagged, not silently assumed** | No existing repo module today queries another hard-dependency module's entity directly (the closest precedent, `commandBus.execute`, is for command calls, not reads); this document's own Design decisions record the reasoning and the rejected thin-query-command alternative, and recommend maintainer confirmation at code review rather than treating this as a settled, verified precedent |
| `packages/core/AGENTS.md` → Database Entities | User-editable entities MUST include `updated_at` | Compliant | `PaymentBatch` has `updatedAt`; `PaymentBatchLine` is a sub-resource guarded by its parent aggregate (exempt, per the same rule's own exemption list) |
| `packages/core/AGENTS.md` → Database Entities | Standard column contract includes `deleted_at` | Compliant | `PaymentBatch` has `deletedAt`; `PaymentBatchLine` exempt as sub-resource. Status guard blocking delete after `SENT` enforced at the command layer (`cancelPaymentBatch`) |
| `packages/core/AGENTS.md` → Encryption | GDPR/PII fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | N/A | No PII/GDPR-sensitive field in this module's entities — `whitelistCheckResult` deliberately excludes the bank account number (already encrypted in `contractors/encryption.ts`), see Encryption |
| `packages/core/AGENTS.md` → Access Control (RBAC) | Features declared per module, naming `<module>.<action>` | Compliant | Three features (`view`/`manage`/`execute`) |
| `packages/events/AGENTS.md` | Events declared with `as const`; subscribers export `metadata` | Compliant | Two events declared; no persistent subscriber needed in Phase 1 |
| `packages/queue/AGENTS.md` | Workers idempotent, export `metadata` | N/A | This module ships no queue worker in Phase 1 — no background job crosses a request boundary |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | Two new tables only, zero changes to existing modules' schemas |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match architecture | Pass | Entities in Architecture and Data Models agree |
| API contracts match data models | Pass | Every documented field/filter has a backing column, including the `.../cancel` route |
| Commands defined for all mutations | Pass | Every status transition has a named command, including `cancelPaymentBatch` for `CANCELLED` |
| Double-entry postings balance | Pass | `markPaymentBatchSent` posts DR liability / CR cash, both to configured accounts |
| Risks cover all write operations | Pass | Double-posting, `contractors`/`ledger`/`accounts_payable` cascades, tenant isolation, migration all addressed |
| Scope cohesion vs. other modules | Pass | Single capability (payment batching and sending), independently deployable given its two hard dependencies (`ledger`, `accounts_payable`) — invoices split out per Q1 resolution, see the sibling document |
| Scope cohesion *within* this document | Pass | One entity group, one lifecycle, one GL integration seam — this is exactly the half of the original combined document that both independent reviews identified as its own cohesive capability |
| Cross-module coupling mechanism matches dependency type | Pass, with one flagged new pattern | Hard dependencies (`ledger`, `accounts_payable`) via `ModuleInfo.requires`; `ledger` calls via `commandBus` (existing precedent); `accounts_payable` reads via direct entity query and direct `ModuleConfigService` read (new pattern, explicitly flagged — see Compliance Matrix above); optional peer (`contractors`) via `tryResolve`, fail-closed |

### Non-Compliant Items

None. One item is a **newly introduced design pattern flagged for
maintainer confirmation, not a compliance gap**: the direct
cross-module entity query against `accounts_payable.VendorInvoice`
(see Compliance Matrix and Design decisions).

### Verdict

**Ready for maintainer review, with one implementation detail
flagged for confirmation at code review (not a compliance blocker):**
whether `updatePaymentBatch`'s read of `accounts_payable.VendorInvoice`
should go through a thin query command on `commandBus` (stricter
encapsulation, no new pattern) or the direct `entityManager` query
this document designs (simpler, no new command surface) — see Design
decisions and Alternatives considered. Every AGENTS.md rule checked
is compliant. This document is the narrower, payments-only half of
what was originally a single combined Accounts Payable
specification — two independent, fresh-context reviews found the
combined document's own scope-cohesion self-assessment unreliable
(it cited a misrepresented GL precedent) and recommended a split; the
team confirmed the split on 2026-09-08. This document carries
forward, unchanged, every fix from that combined document's own
independent-review round that applies to the payments half (the
`cancelPaymentBatch`/unreachable-`CANCELLED` fix, the
`whitelistCheckResult` encryption-avoidance design) — see Changelog
for the full history. The invoice half, its own risks, and its own
compliance report live in `2026-09-06-accounts-payable.md`.

## Changelog

### 2026-09-06

- Initial specification (Design Decisions only, from event-storming
  wall — at this point part of one combined `accounts_payable`
  document with the invoice half).

### 2026-09-07

- Full expansion from skeleton to complete `om-spec-writing` template
  (at this point still combined with invoices in one document).
  Research pass against the real repo (not the pre-workshop SPEC-024
  brief) before writing: confirmed no `PaymentOrder`/`PaymentInstruction`
  entity exists anywhere; confirmed SPEC-024's `BankTransaction` type
  (`matchedEntryId: Option<EntryId>`) shows reconciliation logic, not
  payment-initiation logic, settling the payments-vs-Bank-Management
  boundary question in favor of this module initiating and posting
  the payment batch.

### 2026-09-07 (cont. — independent review round, while still combined with invoices)

Two fresh-context reviews (compliance/checklist + architectural
sanity) were run against the full expansion, per the same protocol
used for GL and Contractor Registry. Findings verified against the
real repo before acting on them; fixes applied in this same round
(only the ones affecting the payments half are listed here — the
invoice-half fixes from this same round are recorded in
`2026-09-06-accounts-payable.md`'s own Changelog):

- **Unreachable status + missing route (fixed)**: `PaymentBatch.CANCELLED`
  had no producing command. Added `cancelPaymentBatch` command +
  `.../cancel` route.
- **Encryption avoided by design, not a gap**: `PaymentBatchLine.whitelistCheckResult`
  was designed from the start to exclude the bank account number
  (already encrypted on `ContractorBankAccount`) rather than needing
  its own `encryption.ts` entry — confirmed correct by the encryption
  review pass alongside the invoice half's genuine gap.
- **Scope-cohesion SPLIT (escalated, then resolved 2026-09-08 — see
  below)**: both reviews independently leaned SPLIT for invoices vs.
  payments, and one of them found the combined document's own
  justification (an analogy to how GL kept `FiscalPeriod` bundled)
  misrepresented that precedent. Recorded as **Q1** pending
  resolution, per `spec-checklist.md`'s escalation protocol.

### 2026-09-08 — Q1 resolved: split into two documents

- Resolved Q1: split the combined `accounts_payable` document into
  this document (`accounts_payable_payments` — payment batches,
  VAT-whitelist verification, payment posting) and
  `2026-09-06-accounts-payable.md` (`accounts_payable` — vendor
  invoice lifecycle only, kept as the sibling document's title).
  Carried over verbatim: `PaymentBatch`/`PaymentBatchLine` entities,
  `payments.*` ACL (renamed to `accounts_payable_payments.payments.*`
  for the new module id), `createPaymentBatch`/`updatePaymentBatch`/
  `confirmPaymentBatch`/`markPaymentBatchSent`/`cancelPaymentBatch`
  commands, `payment_batch.*` events (renamed with the new module
  prefix), the `contractorBankWhitelistCheck` `tryResolve`
  integration, and `defaultCashAccountId`.
- Declared a new hard dependency on `accounts_payable` (alongside the
  existing hard dependency on `ledger`) via `index.ts`'s
  `metadata.requires: ['ledger', 'accounts_payable']` — this dependency
  didn't need to exist as a *cross-module* mechanism before the split,
  since both entity groups lived in one module.
- Designed, for the first time in this document family, a direct
  cross-module entity query (`updatePaymentBatch` reading
  `accounts_payable.VendorInvoice` directly, and `markPaymentBatchSent`
  reading `accounts_payable.liabilityAccountId` directly) — recorded
  as a new pattern requiring explicit justification, not silently
  assumed to be covered by existing precedent (`commandBus.execute`
  covers command calls, not reads). Recorded the rejected alternative
  (a thin query command on `commandBus`) as an open implementation
  detail for maintainer confirmation, not a blocking question.
  Documented `accounts_payable.liabilityAccountId` explicitly as the
  one intentionally shared config value between the two documents,
  to avoid drift.
  Renamed the API base path from `/api/accounts_payable/payments/...`
  to `/api/accounts_payable_payments/payments/...`, matching the
  per-module route-prefix convention — flagged explicitly as an
  external contract change caused by the split, not glossed over.
  Rewrote Overview, Problem Statement, Proposed Solution, User
  Stories, Risks, Out of scope, and the Final Compliance Report for
  the narrower payments-only scope; removed the Open Questions
  section (Q1 resolved).
- Translated the document to English (this pass) — the Polish version
  is superseded by this one; no content change beyond translation.
