# Accounts Payable — Payments

**Related:** [Accounts Payable — invoices](2026-09-06-accounts-payable.md)
(sibling document, open PR #5962 — purchase invoice lifecycle; this
document has a hard, declared dependency on it, see Architecture →
Module Dependency; split out of it 2026-09-08, see Changelog),
[General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(open, PR #5663 — the posting engine this spec books into),
[Contractor Registry](2026-09-06-contractor-registry.md) (open, PR
#5955 — vendor registry and VAT-whitelist verification — this spec
consumes it as an optional peer, does not duplicate it). None of the
above have merged as of this writing (2026-09-08, maintainer review).

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
`.ai/specs/2026-09-06-fixed-assets.md` — planned, not written yet;
no such file or PR exists today, 2026-09-08 maintainer review), (D)
outbound payments (grouping approved invoices into payment batches,
sending). **This
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
Act). **Correction (2026-09-08, this review round)**: no other spec in
this repo documents this legal basis — `2026-09-06-contractor-registry.md`
does not mention MPP, Annex 15, or the PLN 15,000 threshold anywhere,
despite owning the underlying whitelist-check mechanism
(`contractorBankWhitelistCheck`) this document consumes. An earlier
draft pointed there for "the full legal justification"; that pointer
was wrong. This document is the sole owner of this legal justification
in the repo today — the specifics above should be confirmed with
Finance/Legal before implementation, not treated as already verified
elsewhere.

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
`contractors` module through a local `tryResolve`, fail-closed — the
same mechanism and the same policy Contractor Registry's own spec
already documents for this exact integration.** `contractors` **is**
an optional peer here (unlike `ledger`/`accounts_payable`, both hard
dependencies). **Correction (2026-09-08, this review round)**: an
earlier draft characterized Contractor Registry as "fail-open" here;
that was wrong. Contractor Registry's own Cross-module integration
section specifies, for this exact call, that both degradation cases —
`contractors` absent (`tryResolve` returns `undefined`) and the live
Biała Lista API call itself failing — resolve to the same policy:
block the payment, never proceed without a live check. This document
simply implements the consumer side of that already-designed contract;
it does not introduce a different or stricter policy. (Contractor
Registry's own backend UI separately has a "verify now" button for
manually re-checking one bank account from its own screen; that button
doing nothing when `contractors` can't reach the API is a UX detail of
that module's own page, unrelated to payment confirmation and with no
bearing on this module's fail-closed policy.) This module never treats
a missing result as "assume WHITELISTED".

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

**Invoice eligibility predicate, made explicit (2026-09-08, external
maintainer review — closes a double-payment gap).** Every prior
mention of the batch-eligibility rule used the phrase "not yet
attached to another unfinished batch" — ambiguous on its face, and
read literally it excludes the wrong thing: a `SENT` batch is
"finished" by ordinary English, so the literal reading stops
protecting an invoice the moment its batch is sent, letting the same
`POSTED` invoice (there is no `PAID` status — see Data Models — and no
other settlement flag on `VendorInvoice`) enter a second batch and be
paid twice. `cancelPaymentBatch` was always the only command that
"frees" a batch's invoices (see Commands) — which only makes sense if
non-cancelled batches, `SENT` included, hold the claim — so the intent
was never in question, only the wording. The rule, stated
unambiguously everywhere it's used: **an invoice is ineligible for a
new `PaymentBatchLine` while it is attached to a line on any
`PaymentBatch` whose `status` is not `CANCELLED`** — `DRAFT`,
`CONFIRMED` and `SENT` all block re-attachment; only `CANCELLED`
(via `cancelPaymentBatch`, which removes the line) releases it.

**A new mechanism introduced by the split: two direct cross-module
reads, without `commandBus`.**
`createPaymentBatch`/`updatePaymentBatch` need to find approved
(`status === 'POSTED'`), not-yet-batched invoices for the same vendor/
currency, that aren't attached to any batch whose status isn't
`CANCELLED` (corrected 2026-09-08, external maintainer review — see
below, "invoice eligibility predicate, made explicit");
`markPaymentBatchSent` needs the vendor liability account, configured
on the sibling module. As long as both entity groups lived in one
module, both were ordinary intra-module reads; the split makes this
document the first place where a module reads another module's entity
*and* another module's configuration value directly, rather than
through `commandBus`. **Decision**: (1) a direct `entityManager` query
against the `VendorInvoice` entity (importing the type, **without**
declaring an ORM relation — root `AGENTS.md`'s ban concerns
relations/joins, not simply importing a type for a query), and (2) a
direct `moduleConfigService.getValue('accounts_payable',
'liabilityAccountId', { scope: { tenantId, organizationId } })` call —
both always scoped by `tenantId`/`organizationId`. Rationale:
`accounts_payable` is a hard, always-co-present dependency of this
module (validated at generation time through `ModuleInfo.requires`,
see Module Dependency) — not an optional peer like `contractors` — so
there's no degradation scenario to design for either read, just as
there isn't for `ledger`. **The direct entity query has a real repo
precedent — an earlier claim that it didn't was wrong (corrected
2026-09-08, external maintainer review).** A prior draft of this
section claimed "no existing module in the repo today queries another
hard-dependency module's entity directly" and escalated that as a
first-of-its-kind coupling category needing explicit team sign-off.
That's false: `staff` (`requires: ['planner', 'resources']`) imports
`PlannerAvailabilityRuleSet` from `planner`'s own `data/entities.ts`
and queries it directly, tenant/org-scoped, with no ORM relation
(`packages/core/src/modules/staff/lib/messageObjectPreviews.ts:7,294-303`);
`communication_channels` does the same against `messages`'s `Message`
entity (`commands/deliver-outbound-message.ts:131`). Both are exactly
this pattern — type-import plus scoped query, no relation — applied
across a hard-dependency boundary. The `ModuleConfigService` half of
the original claim does hold: every real call site today (`entities`,
`entity-settings`, `notifications/lib/deliveryConfig.ts`) reads only
its own module's value, so `markPaymentBatchSent`'s read of
`accounts_payable.liabilityAccountId` genuinely is a first-of-its-kind
config read. **Correction (2026-09-08, prior review round)**: an
earlier draft cited `ModuleConfigService.get('accounts_payable.liabilityAccountId',
{ tenantId })` as if it were already-established precedent for the
entity-query decision above; that citation was wrong twice over — the
real method is `getValue(moduleId, name, options)` (`.get` doesn't
exist, and `moduleId`/`name` are separate arguments, not one dotted
string), and it wasn't precedent at all, since this document is
introducing that exact call itself. With a real precedent now cited
for the entity query, the "thin query command" alternative needs no
further ceremony — see Alternatives considered, now closed rather than
left open. The `ModuleConfigService` cross-module read remains
genuinely new and stays a routine implementation choice for code
review, not a question requiring team sign-off — narrower in scope
than the original draft claimed, since it's the only piece of this
pair that's actually unprecedented.

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
| A thin query command on `accounts_payable` (`listPayable`) instead of a direct `entityManager` query across the module boundary | **Closed, 2026-09-08 maintainer review** — the direct query has a real repo precedent (`staff`→`planner`, `communication_channels`→`messages`; see Design decisions), so the extra indirection layer buys no encapsulation this repo doesn't already accept elsewhere. Rejected in favor of the direct `entityManager` query |

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
  name: 'accounts_payable_payments',
  title: 'Accounts Payable — Payments',
  version: '0.1.0',
  description:
    'Payment batching, VAT-whitelist verification, and posting of vendor payments to the general ledger.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger', 'accounts_payable'],
  ejectable: true,
}
```

**Correction (2026-09-08, this review round)**: the real `ModuleInfo`
type has no `id` field — the identifying field is `name`, exactly as
`sales`/`wms` use it. An earlier draft used `id:`, which would not
compile against the real type.

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
  invoices with status `POSTED` in `accounts_payable`, not attached to
  any batch whose status isn't `CANCELLED` — i.e. `DRAFT`, `CONFIRMED`
  **and** `SENT` all block re-attachment, not just `DRAFT`/`CONFIRMED`
  (corrected 2026-09-08, maintainer review — see "invoice eligibility
  predicate, made explicit" below for why `SENT` must count: without
  it, a `SENT` batch's invoices become payable again, i.e. payable
  twice) — read directly through `entityManager`, see Design decisions
  and Cross-module integration), and matching the batch's own
  `vendor_id`/`currency_id` (set from the first line added; every
  subsequent line must match both, rejected otherwise — a real,
  enforced invariant as of 2026-09-08, maintainer review; previously
  only "same vendor/currency" prose with no backing column, see Data
  Models), only while `PaymentBatch.status === 'DRAFT'`.
- `confirmPaymentBatch` — `DRAFT` → `CONFIRMED`. For each line,
  resolves `contractorBankWhitelistCheck` from the `contractors`
  module through a local `tryResolve` (the same pattern, and the same
  fail-closed policy, Contractor Registry's own Cross-module
  integration section already specifies for this exact call —
  `contractors` **is** an optional peer here, unlike `ledger`/
  `accounts_payable`). A missing module, or a failed live check,
  **blocks confirmation of the entire batch**; the module never
  treats a missing result as "assume WHITELISTED".
- `markPaymentBatchSent` — `CONFIRMED` → `SENT`. Resolves `commandBus`
  from the container and calls `ledger.postJournalEntry` with one DR
  line **per invoice in the batch** (resolved 2026-09-08, maintainer
  review — an earlier draft left this as an unresolved "per
  `VendorInvoiceLine` sum, or one line per invoice" either/or; per-line
  granularity is unnecessary here, since the payment side settles the
  invoice's already-posted total rather than re-deriving
  `postVendorInvoice`'s net/VAT split, and summing
  `VendorInvoiceLine` would itself be a second cross-module entity
  read this design doesn't otherwise need) to the configured liability
  account (`accounts_payable.liabilityAccountId` — read directly
  through `ModuleConfigService` scoped by the sibling module's
  `tenantId`, see Data Models → Module Config), one CR line to the
  configured bank/cash account
  (`accounts_payable_payments.defaultCashAccountId`),
  `currencyId: batch.currencyId` (see Data Models — added 2026-09-08,
  maintainer review; `PaymentBatch` previously had no currency column
  to post with), `referenceType:
  'accounts_payable_payments:payment_batch'`, `referenceId: batch.id`.
  **Does not execute a real bank transfer** — see Out of scope. Sets
  `postedJournalEntryId` (idempotency guard, mirroring
  `postVendorInvoice`).
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
source, GL is (see `2026-09-06-posting-rules-engine.md` — planned,
not written yet; no such file or PR exists today, 2026-09-08
maintainer review). This module
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
  `container.resolve('commandBus').execute('ledger.postJournalEntry', { input, ctx })`
  — the real, two-argument `execute(commandId, options)` signature
  (`packages/shared/src/lib/commands/command-bus.ts:223-226`; corrected
  2026-09-08, maintainer review — an earlier draft cited a
  non-existent three-argument form, the same fix applied to the
  sibling document) — the same generic mechanism `accounts_payable`
  already uses for exactly the same purpose, and that `workflows`'
  `UPDATE_ENTITY` already uses to call any command by string
  `commandId`.
- **`accounts_payable` — a hard, declared dependency, with a new
  pattern: a direct entity query across the module boundary.**
  `updatePaymentBatch` queries `VendorInvoice` directly through
  `entityManager` (status `POSTED`, vendor, currency, excluding
  invoices attached to any batch whose status isn't `CANCELLED` —
  always scoped by `tenantId`/`organizationId`), and
  `markPaymentBatchSent`
  reads `accounts_payable.liabilityAccountId` directly through
  `ModuleConfigService` scoped by `tenantId` (not through
  `commandBus` — this is a configuration value, not a command).
  Rationale and the rejected alternative (a thin query command) — see
  Design decisions, "A new mechanism introduced by the split".
- **Contractors (`contractorBankWhitelistCheck`) — an optional peer,
  with a fail-closed policy.** This module resolves through a local
  `tryResolve` in a `try/catch`, exactly as Contractor Registry's own
  spec already designs for this integration: whether `contractors` is
  missing or the live check fails, `confirmPaymentBatch` **blocks** —
  because it's a hard legal blocker (VAT whitelist/MPP), not a UX
  convenience. This module never treats a missing result as "assume
  WHITELISTED" — always as "I can't verify, so I block" (fail-closed).

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
- `vendor_id`: uuid, nullable (FK-id, same target as
  `VendorInvoice.vendorId` → `contractors.Contractor`, no ORM relation
  — added 2026-09-08, maintainer review). Nullable only while `DRAFT`
  and empty; set from the first `PaymentBatchLine` added by
  `updatePaymentBatch` and immutable afterward. Backs the "same
  vendor" invariant (previously prose only, see Commands) and the
  `vendorId` list filter (previously a join through
  `PaymentBatchLine`, see API Contracts) with a real column.
- `currency_id`: uuid, nullable (FK-id → `currencies.Currency`, no ORM
  relation, same target as `VendorInvoice.currencyId` — added
  2026-09-08, maintainer review). Same lifecycle as `vendor_id`: set
  from the first line added, immutable afterward. Backs the "same
  currency" invariant and gives `markPaymentBatchSent` a real
  `currencyId` to post to `ledger.postJournalEntry` with — previously
  missing entirely, so a multi-currency tenant had no way to produce a
  correct posting from this schema.
- `bank_account_id`: uuid (FK-id, reference to a future Bank Management entity)
- `status`: text (`DRAFT`/`CONFIRMED`/`SENT`/`CANCELLED`)
- `scheduled_payment_date`: date
- `total_amount`: numeric(19,4)
- `posted_journal_entry_id`: uuid, nullable
- `updated_at`: timestamptz, nullable (optimistic lock while `status` is `DRAFT`/`CONFIRMED`)
- `deleted_at`: timestamptz, nullable

Supporting index: `(tenant_id, organization_id, status,
scheduled_payment_date)` for the batch list; `(tenant_id,
organization_id, vendor_id)` backing the `vendorId` list filter (added
2026-09-08, maintainer review, now that `vendor_id` is a real
column).

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
quickly exclude invoices attached to any batch whose status isn't
`CANCELLED`.

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

- **Request (list)**: standard `makeCrudRoute` list params —
  `page`/`pageSize` for pagination, plus filters on `status` and
  `vendorId`. **Added explicitly (prior review round)**: an earlier
  draft left these undocumented. **Corrected (2026-09-08, maintainer
  review)**: `vendorId` filters directly on `PaymentBatch.vendor_id` —
  an earlier draft described it as "via the attached invoices' vendor"
  (a join through `PaymentBatchLine`) because `PaymentBatch` had no
  `vendor_id` column of its own yet; see Data Models.
- **Response 403**: caller lacks `accounts_payable_payments.payments.view` (list) / `.manage` (create).

### `POST /api/accounts_payable_payments/payments/:id/lines` / `DELETE /api/accounts_payable_payments/payments/:id/lines/:lineId`

Custom write routes (both mapped to `update`) adding/removing a
`PaymentBatchLine`. **Added (this review round)**: an earlier draft
documented `updatePaymentBatch` as removing lines (see Commands) with
no corresponding route — the `DELETE` route above closes that gap.

- **Request (POST)**: `{ vendorInvoiceId, contractorBankAccountId, amount }`.
- **Response 409 (POST)**: `PaymentBatch.status !== 'DRAFT'`, or the invoice
  isn't `POSTED` (in `accounts_payable`), or the invoice is attached
  to another batch whose status isn't `CANCELLED` (`DRAFT`/`CONFIRMED`/
  `SENT` all count).
- **Response 409 (DELETE)**: `PaymentBatch.status !== 'DRAFT'`.
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

#### No reversal path once a payment batch is SENT
- **Scenario**: a payment batch reaches `SENT` (posted to `ledger`)
  with incorrect data — wrong amount, wrong account, wrong invoice —
  discovered only after sending.
- **Severity**: Medium-High
- **Affected area**: `accounts_payable_payments`, `ledger`
- **Mitigation**: none in Phase 1. `cancelPaymentBatch` is explicitly
  blocked for `SENT` (see Commands); there is no `reversePaymentBatch`
  command and no unwind of the posted journal entry. The only path
  today is a manual, out-of-band correcting journal entry directly in
  `ledger`.
- **Residual risk**: real, and currently accepted as a Phase 1 gap,
  symmetric to the same gap in the sibling invoices document — a
  genuine reversal/void flow is deferred to Phase 2. Flagged
  explicitly here (this review round) rather than left implicit.

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
| `packages/core/AGENTS.md` → Cross-Module Coupling | Direct entity query across a hard-dependency module boundary | **Compliant, precedented (corrected 2026-09-08, maintainer review)** | `staff`→`planner` (`messageObjectPreviews.ts:7,294-303`) and `communication_channels`→`messages` (`deliver-outbound-message.ts:131`) already do exactly this — type-import plus tenant/org-scoped query, no ORM relation. An earlier draft claimed no precedent existed and escalated this to a team-sign-off question; that was wrong — see Design decisions |
| `packages/core/AGENTS.md` → Cross-Module Coupling (new pattern) | Direct `ModuleConfigService` read of another module's config value | **Compliant, genuinely new — flagged, not silently assumed** | Every real `ModuleConfigService.getValue` call site today (`entities`, `entity-settings`, `notifications/lib/deliveryConfig.ts`) reads only its own module's value; `markPaymentBatchSent`'s read of `accounts_payable.liabilityAccountId` is the first cross-module one — see Design decisions |
| `packages/core/AGENTS.md` → Database Entities | User-editable entities MUST include `updated_at` | Compliant | `PaymentBatch` has `updatedAt`; `PaymentBatchLine` is a sub-resource guarded by its parent aggregate (exempt, per the same rule's own exemption list) |
| `packages/core/AGENTS.md` → Database Entities | Standard column contract includes `deleted_at` | Compliant | `PaymentBatch` has `deletedAt`; `PaymentBatchLine` exempt as sub-resource. Status guard blocking delete after `SENT` enforced at the command layer (`cancelPaymentBatch`) |
| `packages/core/AGENTS.md` → Encryption | GDPR/PII fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | N/A | No PII/GDPR-sensitive field in this module's entities — `whitelistCheckResult` deliberately excludes the bank account number (already encrypted in `contractors/encryption.ts`), see Encryption |
| `packages/core/AGENTS.md` → Access Control (RBAC) | Features declared per module, naming `<module>.<action>` | Compliant | Three features (`view`/`manage`/`execute`) |
| `packages/events/AGENTS.md` | Events declared with `as const`; subscribers export `metadata` | Compliant | Two events declared; no persistent subscriber needed in Phase 1 |
| `packages/queue/AGENTS.md` | Workers idempotent, export `metadata` | N/A | This module ships no queue worker in Phase 1 — no background job crosses a request boundary |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | Two new tables only, zero changes to existing modules' schemas |
| `BACKWARD_COMPATIBILITY.md` | API Route URLs (STABLE) — MUST NOT rename or remove an existing route URL | **N/A, not Compliant/Non-Compliant** — added this review round, an earlier draft's matrix omitted this rule entirely | `/api/accounts_payable/payments/...` becomes `/api/accounts_payable_payments/payments/...` under the split (see Design decisions, "API path change"). This rule protects real deployed consumers of an *existing* route; neither `accounts_payable` nor `accounts_payable_payments` has shipped as code yet (both are still specs), so there is no real external caller to break today. Flagged here so the maintainer decides consciously rather than the omission going unnoticed: if any code lands under the pre-split path before this split is approved, the rename would then be a real, rule-covered break requiring a deprecation window. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match architecture | Pass | Entities in Architecture and Data Models agree |
| API contracts match data models | Pass (corrected 2026-09-08, maintainer review) | Every documented field/filter has a backing column, including the `.../cancel` route and the `vendorId` list filter / "same vendor or currency" invariant, which had none until `PaymentBatch.vendor_id`/`currency_id` were added this round (see Data Models) |
| Commands defined for all mutations | Pass | Every status transition has a named command, including `cancelPaymentBatch` for `CANCELLED` |
| Double-entry postings balance | Pass | `markPaymentBatchSent` posts DR liability / CR cash, both to configured accounts |
| Risks cover all write operations | Pass | Double-posting, `contractors`/`ledger`/`accounts_payable` cascades, tenant isolation, migration all addressed |
| Scope cohesion vs. other modules | Pass | Single capability (payment batching and sending), independently deployable given its two hard dependencies (`ledger`, `accounts_payable`) — invoices split out per Q1 resolution, see the sibling document |
| Scope cohesion *within* this document | Pass | One entity group, one lifecycle, one GL integration seam — this is exactly the half of the original combined document that both independent reviews identified as its own cohesive capability |
| Cross-module coupling mechanism matches dependency type | Pass, with one flagged new pattern | Hard dependencies (`ledger`, `accounts_payable`) via `ModuleInfo.requires`; `ledger` calls via `commandBus` (existing precedent); `accounts_payable`'s entity query is precedented (`staff`→`planner`, `communication_channels`→`messages` — corrected 2026-09-08); its `ModuleConfigService` read is the one genuinely new pattern, explicitly flagged — see Compliance Matrix above; optional peer (`contractors`) via `tryResolve`, fail-closed |

### Non-Compliant Items

None outstanding after this review round's fixes. **This review round
(2026-09-08, post-split, English translation + fresh-context review)
found and fixed five real defects** in the previous version of this
document, none caught by this document's own prior self-assessment:
an `index.ts` sample using a non-existent `ModuleInfo.id` field (real
field is `name`); a `ModuleConfigService.get(...)` citation using a
method and argument shape that don't exist (real: `getValue(moduleId,
name, options)`); that same citation being circular (it cited this
document's own new mechanism as if it were pre-existing precedent);
a false characterization of Contractor Registry's design as
"fail-open" for the `contractorBankWhitelistCheck` degradation case,
when Contractor Registry's own spec documents the identical
fail-closed policy this document also uses; and a dangling citation
claiming Contractor Registry contains "the full legal justification"
for Annex 15/MPP, when Contractor Registry's spec never mentions
either. Additionally fixed: a missing `DELETE` route for
`PaymentBatchLine` removal, undocumented list pagination params, a
missing Risks entry for "no reversal path once `SENT`", and a missing
Compliance Matrix row for the API-route-rename rule. See Changelog for
the full list with sources.

One item remains a **newly introduced design pattern flagged for
maintainer confirmation, not a compliance gap** — narrower than a
prior draft claimed (corrected 2026-09-08, external maintainer
review): the direct `ModuleConfigService.getValue` read of
`accounts_payable.liabilityAccountId` is genuinely new coupling, with
no existing repo precedent. The direct entity query against
`accounts_payable.VendorInvoice`, previously escalated alongside it as
equally unprecedented, is not — `staff`→`planner` and
`communication_channels`→`messages` already establish exactly that
pattern (see Compliance Matrix and Design decisions); it needs no
further flag or team sign-off, only routine code-review confirmation
like any other cross-module read.

### Verdict

**Ready for maintainer review, with one item flagged for explicit
confirmation (not a compliance blocker, a genuine open question this
document does not resolve alone) — narrowed from two, 2026-09-08
maintainer review:** whether `markPaymentBatchSent`'s direct
`ModuleConfigService` read of `accounts_payable.liabilityAccountId`
needs anything beyond routine code-review confirmation, given it's the
only piece of this pair genuinely without repo precedent (see Design
decisions). `updatePaymentBatch`'s direct entity query against
`accounts_payable.VendorInvoice` — previously flagged alongside it as
an equally open, possibly team-sign-off-worthy question — is not: it
matches an established repo pattern (`staff`→`planner`,
`communication_channels`→`messages`) and the "thin query command"
alternative is closed, not left open, for that reason (see
Alternatives considered). The API-route-rename question above remains
open on its own terms. Every AGENTS.md rule checked is compliant. This
document is the narrower, payments-only half of what was originally a
single combined Accounts Payable specification — two independent,
fresh-context reviews found the combined document's own scope-cohesion
self-assessment unreliable (it cited a misrepresented GL precedent)
and recommended a split; the team confirmed the split on 2026-09-08. A
further pair of fresh-context reviews of the post-split, translated
document (this round) found the five defects listed above, now fixed.
This document carries forward, unchanged, every fix from the combined
document's own earlier independent-review round that applies to the
payments half (the `cancelPaymentBatch`/unreachable-`CANCELLED` fix,
the `whitelistCheckResult` encryption-avoidance design) — see
Changelog for the full history. The invoice half, its own risks, and
its own compliance report live in `2026-09-06-accounts-payable.md`.

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

### 2026-09-08 (cont. — fresh-context review of the post-split, English
document; this pass)

Ran the `om-spec-writing` skill's Step 8 (checklist review, with the
scope-cohesion item delegated to a fresh-context subagent) and Step 9
(Compliance Gate) on this document for the first time since the split
— the split itself had never been through this formal process before.
Findings, each personally re-verified against the real repository
before being accepted (not taken on the reviewing agent's word alone):

- Fixed `index.ts`: real `ModuleInfo` has no `id` field (real field is
  `name`); added the full metadata shape matching `sales`/`wms`
  precedent.
- Fixed the `ModuleConfigService` citation in Design decisions: the
  real method is `getValue(moduleId, name, options)`, not
  `.get('module.field', { tenantId })`; also removed the circular
  framing that cited this document's own new mechanism as if it were
  established precedent — clarified that both the entity query and
  the config read are new, unprecedented coupling introduced together.
- Fixed a false characterization of Contractor Registry's design as
  "fail-open" (three occurrences: Design decisions, Commands,
  Cross-module integration) — verified directly against Contractor
  Registry's own spec text (`docs/contractor-registry` branch), which
  documents the identical fail-closed policy for this exact
  integration. Corrected all three to state the shared policy
  accurately instead of a false contrast.
- Fixed a dangling citation claiming Contractor Registry contains "the
  full legal justification" for Annex 15/MPP — verified (grep across
  the full Contractor Registry spec text) that it contains no mention
  of Annex 15, MPP, or the PLN 15,000 threshold anywhere. This
  document is now recorded as the sole owner of that legal
  justification.
- Added a `DELETE /api/accounts_payable_payments/payments/:id/lines/:lineId`
  route — `updatePaymentBatch` was documented as removing lines with
  no corresponding route.
- Added explicit pagination params to the payments list route.
- Added a Risks entry for "no reversal path once a batch is `SENT`" —
  previously undocumented, symmetric to the same gap in the sibling
  invoices document (also fixed this round).
- Added a Compliance Matrix row for `BACKWARD_COMPATIBILITY.md`'s API
  route rename rule, previously omitted entirely, with an explicit note
  that it doesn't bind today only because neither module has shipped
  as code yet.
- Updated the Final Compliance Report (Non-Compliant Items, Verdict) to
  record all of the above, and to raise explicitly — rather than
  silently settle — whether the new direct-cross-module-read pattern
  needs team-level sign-off (a Q-style decision) rather than routine
  code-review confirmation.

### 2026-09-08 (cont. — external maintainer review of PR #5962, four
majors)

An external maintainer review of the split PR (invoices + payments,
review scope: both documents together) found four majors and six
minors/nits. This entry covers the fixes affecting this document (the
payments half); the sibling invoices document's Changelog covers the
rest. Every finding personally re-verified against the real repository
before being fixed, not accepted on the review's word alone:

- **Double-payment predicate (major)**: every mention of the
  batch-eligibility rule used the ambiguous phrase "not yet attached
  to another unfinished batch" — read literally, a `SENT` batch (no
  longer "unfinished") stops protecting its own invoices, and since
  `VendorInvoice` has no `PAID` status or settlement flag, the same
  invoice could re-enter a second batch and be paid twice. Rewrote the
  rule everywhere (Design decisions, Commands, index rationale, API
  Contracts) to the unambiguous form: an invoice is ineligible while
  attached to a line on any batch whose status isn't `CANCELLED` —
  `DRAFT`/`CONFIRMED`/`SENT` all block re-attachment.
- **False "no repo precedent" claim (major)**: this document escalated
  the direct cross-module entity query
  (`updatePaymentBatch`/`VendorInvoice`) as a first-of-its-kind
  coupling category needing possible team sign-off. It isn't:
  `staff`→`planner` (`messageObjectPreviews.ts:7,294-303`) and
  `communication_channels`→`messages` (`deliver-outbound-message.ts:131`)
  already do exactly this. Narrowed the claim to what's actually new —
  the direct `ModuleConfigService` cross-module read — and closed the
  "thin query command" alternative as rejected rather than left open,
  across Design decisions, Alternatives considered, Compliance Matrix,
  Internal Consistency Check, Non-Compliant Items, and Verdict.
- **`PaymentBatch` missing `currencyId`/`vendorId` (major)**: the
  "same vendor/currency" invariant, the `vendorId` list filter, and
  `markPaymentBatchSent`'s GL posting were all load-bearing on columns
  that didn't exist. Added `vendor_id` and `currency_id` to
  `PaymentBatch` (set from the first line added, immutable after),
  backing the invariant and the filter with real columns and giving
  the GL posting a `currencyId` to use.
- **`commandBus.execute` signature (minor)**: corrected the
  three-argument citation to the real
  `execute(commandId, { input, ctx })` two-argument signature, same
  fix as the sibling document.
- **Debit-side ambiguity (minor)**: `markPaymentBatchSent` left "per
  `VendorInvoiceLine` sum (or one line per invoice in the batch)" as
  an open either/or. Resolved to one DR line per invoice — the payment
  side settles the already-posted total and doesn't need
  `postVendorInvoice`'s net/VAT granularity, and summing
  `VendorInvoiceLine` would be an unnecessary second cross-module read.
- **Dangling links (minor)**: annotated the Related header's AP
  invoices/GL/Contractor Registry links with their open PR numbers
  (#5962/#5663/#5955 — none merged as of this writing); marked
  `fixed-assets.md` and `posting-rules-engine.md` explicitly as
  planned, not written yet, wherever cited by path.
- Updated the Final Compliance Report (Compliance Matrix, Internal
  Consistency Check, Non-Compliant Items, Verdict) to record all of
  the above.
