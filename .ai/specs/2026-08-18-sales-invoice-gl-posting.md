# Sales Invoice GL Posting

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(the engine this posts into — depended on for `postJournalEntry`,
`documentType`, `LedgerAccount`, and `JournalEntryLine.contractorSnapshot`),
[Accounts Payable](2026-09-06-accounts-payable.md) (the closest
structural analog — the buy-side mirror of this document, and the
source of the posting-mechanics pattern reused here), [Contractor
Registry](2026-09-06-contractor-registry.md) (optional peer — names
this document as an indirect, not-yet-designed consumer; see Design
decisions for what "indirect" actually means and what is resolved
here)

## TLDR

Posts real `sales.SalesInvoice` records to `ledger` as balanced
`JournalEntry` postings: debit the receivable control account for the
gross total, credit a configured revenue account for the net amount,
credit a configured output-VAT account for the tax amount. Unlike
Accounts Payable, this module does not own or duplicate the invoice —
`sales.SalesInvoice`/`SalesInvoiceLine` already exist as real,
shipped entities; this document is the thin write path from that real
data into `ledger`, plus the minimal additive bookkeeping needed to
track what has been posted. Named and blocked-pending in #5663's Out
of scope and referenced by #5962 and Contractor Registry since
2026-09-06 — never written until now.

## Overview

`sales` already models orders, invoices, credit memos, shipments, and
payments as real, shipped entities (`packages/core/src/modules/sales`).
None of that is wired to `ledger` (#5663): a `SalesInvoice` can be
created, issued, and paid down entirely within `sales`, with no
journal entry ever posted for it. This document is the integration
that makes a finalized sales invoice show up in the books — the sell-
side, revenue-recognition counterpart to Accounts Payable's
`postVendorInvoice` on the buy side.

It is deliberately the mirror image of Accounts Payable in mechanics
(debit/credit reversed: AP debits an expense and credits a liability;
this credits revenue and debits a receivable) but not in ownership
shape. Accounts Payable owns its entire invoice graph
(`VendorInvoice`/`VendorInvoiceLine`) because no "purchasing" module
exists to source it from. `sales.SalesInvoice` already exists and is
real, shipped data — this module reads it directly (the same hard-
dependency direct-entity-read precedent `journal_entry_line_dimension`
and `sales` itself already establish) rather than duplicating it, and
owns only the small amount of new state a read-only consumer
genuinely needs: which invoices have been posted, to which journal
entry, and — optionally — which verified contractor stood behind the
sale.

This document is not a full Accounts Receivable subledger. Customer
statements, aging, dunning, and collections are not designed here —
`sales.SalesInvoice.outstandingAmount`/`paidTotalAmount` already track
per-invoice balances natively (see Design decisions), and this
document's only job is making sure the *books* agree with what
`sales` already knows.

## Problem Statement

Without this module, three things are true once a Polish tenant using
`sales` needs statutory books, not just a sales system:

1. **Revenue never reaches the ledger.** A `SalesInvoice` with a real
   `grandTotalGrossAmount` has no corresponding `JournalEntry` — the
   P&L and balance sheet `ledger`/#6013 can produce are missing every
   sale.
2. **There is no receivable control account.** #5663 knows nothing
   about customers or sales; nothing today debits a receivable account
   when a sale is made, so the balance sheet has no asset representing
   money owed by customers.
3. **Output VAT is not recorded as a liability.** Every sale to a VAT
   payer generates a tax liability to the tax office; nothing today
   posts it.

## Proposed Solution

An explicit command, `postSalesInvoiceToLedger`, deliberately
triggered by a user action (not an automatic subscriber — see Design
decisions for why this follows Accounts Payable's pattern, not Posting
Rules Engine's). Given a `salesInvoiceId` and a per-line revenue
account assignment, it reads the invoice and its lines directly from
`sales`, validates it hasn't already been posted, and calls
`ledger.postJournalEntry` with: one credit line per `SalesInvoiceLine`
to its assigned revenue account (net amount), one aggregated credit
line to the configured output-VAT account (sum of `taxAmount`), and
one debit line to the configured receivable control account (the
invoice's gross total). A new, minimal `SalesInvoiceGlPosting` record
tracks the link from the invoice to its `JournalEntry` (idempotency,
and the lookup a reversal needs); an optional `SalesInvoiceLineRevenueAccount`
record per line carries the manual account assignment, since
`sales.SalesInvoiceLine` is not this module's entity to extend
directly.

## Design Decisions

**An explicit command, not an event-driven subscriber — deliberately
following Accounts Payable's pattern, not Posting Rules Engine's.**
Posting Rules Engine reacts automatically to
`ledger.journal_entry.posted` because "is this a zespół 4 account" is
a clean structural fact (`LedgerAccountType.accountGroupId`), decidable
with no human judgment. "Is this sales invoice ready to be recognized
as revenue" is not the same kind of fact: `sales.SalesInvoice.status`
is a free-form, tenant-configurable dictionary value
(`resolveDictionaryEntryValue` against `statusEntryId` — verified
directly in `sales/commands/documents.ts`), with no generic, cross-
tenant way to detect "this status means finalized." Accounts Payable
faced the identical problem and resolved it the same way this document
does: `postVendorInvoice` is an explicit command a user calls after
`APPROVED`, not a subscriber on invoice creation. This document follows
that precedent rather than Posting Rules Engine's, because the
underlying fact pattern is the same as AP's, not the same as Posting
Rules Engine's.

**Reads `sales.SalesInvoice`/`SalesInvoiceLine` directly — does not
duplicate them.** Checked directly against `sales/data/entities.ts`:
`SalesInvoice` already carries `invoiceNumber`, `issueDate`,
`currencyCode`, `subtotalNetAmount`, `discountTotalAmount`,
`taxTotalAmount`, `grandTotalNetAmount`, `grandTotalGrossAmount`,
`outstandingAmount`, `paidTotalAmount` — every amount a GL posting
needs already exists as real, shipped data (though not every field
combination is handled in Phase 1 — see "Header-level discounts" and
"Currency resolution" below). Unlike Accounts Payable (which had no
"purchasing" module to read from and so built `VendorInvoice` from
scratch), duplicating this data here would create two, drifting copies
of the same invoice. This module takes a hard dependency on `sales`
and reads `SalesInvoice`/
`SalesInvoiceLine` with its own `entityManager`, the same real
precedent `journal_entry_line_dimension` documents for `fixed_assets`
and, before that, `sales` itself already establishes for reading
`catalog`'s `CatalogProduct`.

**A new entity is still needed — but a thin, additive one, not a
duplicate.** Three things this module needs have no home in `sales`'s
own schema, and cannot be added to it (this module doesn't own that
table): (1) whether an invoice has been posted and to which
`JournalEntry` — needed for idempotency and for a future reversal;
(2) which `LedgerAccount` each line's revenue should post to — `sales`
has no `accountId` concept, unlike Accounts Payable's own
`VendorInvoiceLine.accountId` (AP could add that column because it
owns the line; this module cannot add one to `sales.SalesInvoiceLine`);
(3) which verified `Contractor` (if any) stood behind the sale, for
`JournalEntryLine.contractorSnapshot` (see next decision). Two new,
purely additive entities carry these — `SalesInvoiceGlPosting` (one row
per posted invoice) and `SalesInvoiceLineRevenueAccount` (one row per
line's account assignment) — both referencing `sales`'s entities by
FK-id only, no ORM relation, the same shape
`journal_entry_line_dimension` already established for referencing
`ledger.JournalEntryLine` without owning it.

**Manual, per-line revenue account assignment in Phase 1 — no
automatic category-to-account mapping.** Closely mirrors Accounts
Payable's own explicit Phase 1 decision: "no precedent whatsoever in
the repo for this kind of mapping (verified — nothing similar
exists); building AP's own rules engine would duplicate the future
Posting Rules Engine." The same
reasoning applies here even though Posting Rules Engine's actual scope
(zespół 4→5 reclassification) has no bearing on the *initial* revenue
posting — the point AP's decision makes is architectural, not
domain-specific: this codebase has exactly one place automatic
account-mapping rules belong, and it isn't a newly-written invoice-
posting module. `postSalesInvoiceToLedger` takes an explicit
`lineAccounts: { salesInvoiceLineId, accountId }[]` array; the caller
(a person, or a future automation built elsewhere) supplies it.

**Per-line revenue, one aggregate output-VAT line, one aggregate
receivable line — the same shape AP already uses, not a
simplification of it.** AP explicitly rejected folding VAT into the
per-line expense amount ("Input VAT gets its own account — it is not
silently absorbed into the expense account") in favor of exactly this
shape: a net DR per line to its own account, one aggregated DR to
`vatInputAccountId`, one CR to the liability account. This document
mirrors that shape with debits and credits reversed — one net CR per
line to its own account, one aggregated CR to `vatOutputAccountId`,
one DR to the receivable account — not a narrower version of it.

**Header-level discounts are out of scope for Phase 1 — the command
rejects them rather than silently mis-balancing.** Checked directly
against `sales/data/entities.ts`: `SalesInvoice.discountTotalAmount`
is a separate header-level field, distinct from the sum of line
totals (`subtotalNetAmount`, `discountTotalAmount`, `taxTotalAmount`,
`grandTotalNetAmount`, `grandTotalGrossAmount` are all independent
columns — confirmed by the entity definition, not inferred). If a
header discount is applied, Σ(line `totalNetAmount`) + Σ(line
`taxAmount`) will not equal `grandTotalGrossAmount` — the debit and
credit sides of the posting described above would not balance, and
`ledger.postJournalEntry`'s own balance check would reject it (a
correct rejection, not a bug in `ledger`, but one this document must
not silently walk into). Apportioning a header discount across lines
and/or a dedicated contra-revenue account is a real design question
this document does not answer — it would need its own configured
account and an apportionment method neither `sales` nor any sibling
document specifies anywhere. Resolution: `postSalesInvoiceToLedger`
validates `discountTotalAmount === 0` before posting and rejects with
a readable error otherwise (see Commands, Testing Strategy, Out of
scope) — the same kind of explicit Phase 1 scope line Accounts Payable
draws elsewhere rather than solving everything at once.

**Currency resolution: `sales.SalesInvoice.currencyCode` (a string)
must be resolved to `ledger.JournalEntry.currencyId` (a FK-id) — a
step this document owns, since neither side already has it.** Checked
directly: `SalesInvoice` carries only `currencyCode` (`text`, e.g.
`"PLN"`), no `currencyId` and no `exchangeRate` (unlike
`SalesOrder`, which does have `exchangeRate`) — a different situation
from Accounts Payable, whose own `VendorInvoice` stores `currencyId`
directly and never needed this lookup. `currencies.Currency` (checked
directly against that module's own entities) has a `code` field,
unique per `(organizationId, tenantId, code)` — exactly what this
lookup needs. `postSalesInvoiceToLedger` resolves `currencyId` by
querying `currencies.Currency` for `{ code: invoice.currencyCode,
organizationId, tenantId }` (a direct entity read, the same
established precedent) and rejects with a readable error if no match
exists. `currencies` joins `requires` as a third hard dependency (see
Module Dependency) — multi-currency exchange-rate handling itself
stays out of scope (see Out of scope).

**`operationDate` requires a non-null `issueDate` — the command
validates this rather than guessing a substitute date.** #5663 makes
`JournalEntry.operationDate` non-nullable, "every entry has a business
operation date," never reconstructed after the fact. `SalesInvoice.issueDate`
is nullable in the schema, even though `sales`'s own
`createInvoiceCommand` defaults it to the current date when the caller
omits it — this document cannot assume every invoice in the database
went through that exact path. `postSalesInvoiceToLedger` rejects with
a readable error if `issueDate` is null, rather than substituting
`postedAt` or any other date on the invoice's behalf (see Testing
Strategy).

**Aggregating every line's tax into one output-VAT credit loses the
per-rate breakdown — a named Phase 1 limitation, not a solved
problem.** Unlike input VAT (where one aggregate deductible-VAT
account is standard), Polish output VAT reporting (JPK_V7) commonly
needs a breakdown by rate (23%/8%/5%/0%/zw.) per document. Posting one
aggregate `vatOutputAccountId` credit per invoice means the `ledger`
posting alone cannot reconstruct that breakdown — a JPK_V7 process
would need to read `sales.SalesInvoiceLine.taxRate`/`taxAmount`
directly rather than the GL posting for that specific purpose. Not
solved here: a per-rate output-VAT account structure is a real design
question with no confirmed consumer yet (see Risks, Out of scope).

**`contractorSnapshot` is populated only when a `contractorId` is
explicitly supplied — no automatic link from `sales.customers.CustomerEntity`
to `contractors.Contractor` exists, and this document does not invent
one.** Checked directly: `sales.SalesOrder.customerEntityId` points at
`customers.CustomerEntity` (a CRM entity — pipeline, deals, contacts);
Contractor Registry's own document confirms `customers.CustomerEntity`
has "zero concept of a vendor, tax verification, or GUS/VIES/Biała
Lista," and Contractor Registry itself names this document as an
"indirect… planned, not yet written" consumer without ever designing
the actual bridge between the two entities. That bridge genuinely does
not exist anywhere in this codebase today, and inventing one here —
a `SalesCustomerContractorLink` table, or a new column on either
entity this module doesn't own — would be exactly the kind of
speculative design this project's own discipline avoids (no confirmed
consumer need for *automatic* resolution has been named anywhere).
Resolution: `postSalesInvoiceToLedger` accepts an optional
`contractorId` (FK-id to `contractors.Contractor`, resolved via
`tryResolve` — the same optional-peer mechanism
`accounts_payable_payments` (the sibling of the AP document cited
above, not that document itself — corrected citation) already uses for
its own `contractorBankWhitelistCheck`, since `contractors` may not be
installed for every tenant). **The policy differs deliberately, not by
oversight**: `accounts_payable_payments` fails *closed* — a missing
module or a failed live check blocks the payment outright, because
that call is a fraud-prevention control gating a real money transfer.
This module's use of `contractorId` is an audit-trail snapshot, not a
control gating anything; failing closed here would block a legitimate
sales posting over a missing optional module for no safety reason, so
this module fails *open* instead (see next). When supplied, the
receivable line's `contractorSnapshot` is populated the same way AP
populates its own lines' snapshot. When omitted (no link exists, or
`contractors` isn't
installed), the line simply has no `contractorSnapshot` — a real,
named gap (see Risks), not a silently-guessed one.

**No new subsidiary ledger — `sales.SalesInvoice.outstandingAmount`/
`paidTotalAmount` already are one.** Accounts Payable needed its own
`VendorInvoice`/`accounts_payable_payments` tables to track "how much
do we owe vendor X" because it owns no other source of that data.
`sales.SalesInvoice` already tracks `paidTotalAmount`/
`outstandingAmount` per invoice natively (confirmed directly in
`sales/data/entities.ts`) — collated by customer, this already is the
receivable subsidiary ledger. This document adds no new subsidiary-
ledger table; the control-account invariant it must hold is: the
receivable account's `ledger` balance equals the sum of
`outstandingAmount` across every `SalesInvoice` this module has
posted (see Invariants).

**`documentType: 'external_own'` — a sales invoice is a dowód
wystawiony przez naszą firmę, the opposite case from Accounts
Payable's `external_foreign`.** #5663's art. 20 ust. 2–3 enum already
covers this distinction generically
(`external_foreign`/`external_own`/`internal`/`collective`/
`corrective`/`substitute`) — no new enum value needed, this document
simply uses the other branch of an enum AP already exercises the first
half of.

**Standalone invoices (no `order`) have no customer identity at all in
`sales`'s own schema — named, not solved.** `SalesInvoice.order` is
nullable; `customerEntityId`/`customerSnapshot` live on `SalesOrder`,
not on `SalesInvoice` itself (confirmed directly in
`sales/data/entities.ts`). An invoice created without an order has no
structural customer link anywhere in `sales` today. This does not
block a GL posting (the posting only needs amounts and accounts, not a
customer identity), but it does mean `contractorSnapshot` can only
ever be populated via the explicit, manual `contractorId` argument
above for such an invoice — never inferred. Flagged, not designed
around, since it is a pre-existing `sales` schema gap, not something
this document's scope can fix.

## User Stories

- As an accountant, once a sales invoice is finalized and ready to be
  recognized as revenue, I need to post it to the ledger with one
  action, producing a correctly balanced entry (receivable, revenue,
  output VAT) without hand-entering journal lines.
- As an accountant, I need the system to refuse to post the same
  invoice twice, so a double-click or a retried request can't create a
  duplicate revenue entry.
- As an accountant, when a sales invoice's fiscal period is locked, I
  need a clear rejection explaining why, the same way Accounts
  Payable's postings already behave.
- As an auditor, when a verified contractor stood behind a sale, I
  need that fact captured on the posting itself (`contractorSnapshot`),
  the same audit guarantee Accounts Payable already provides on the
  buy side.
- As a developer running `sales` in a tenant that hasn't installed
  this module, I need `sales`'s own invoice lifecycle to work exactly
  as today, with zero behavior change — this module must be fully
  optional from `sales`'s point of view (a one-way dependency, `sales`
  never imports or resolves it).

## Invariants

1. **Every posted `SalesInvoice` has exactly one `JournalEntry`.**
   `SalesInvoiceGlPosting` records a one-to-one link; a second
   `postSalesInvoiceToLedger` call against an already-posted invoice
   is rejected, not silently re-posted.
2. **The receivable control account's balance equals the sum of
   `outstandingAmount` across every posted `SalesInvoice`.** Since
   `sales` itself keeps `outstandingAmount` current as payments apply
   (`sales.payments.create`, outside this module's scope), this
   invariant holds only for invoices this module has posted — an
   unposted invoice's `outstandingAmount` is not reflected anywhere in
   `ledger`, by design (see Problem Statement).
3. **Every posting balances**: the debit to the receivable account
   equals the sum of the credits to revenue lines plus the credit to
   output VAT, for every `postSalesInvoiceToLedger` call —
   `ledger.postJournalEntry`'s own balance check enforces this
   independently; this module never needs its own redundant check.
4. **A locked `FiscalPeriod` rejects the posting, full stop.** Unlike
   Posting Rules Engine (which reclassifies through a *second*,
   separate `postJournalEntry` call and therefore needs its own
   period-close guard), this module posts once, directly — #5663's own
   `postJournalEntry` period-lock check is the only guard needed, with
   nothing further to design here.
5. **`contractorSnapshot` reflects the contractor at posting time, not
   retroactively.** A later change to the underlying `Contractor` row
   (name, NIP) never rewrites an already-posted line's snapshot — the
   same point-in-time guarantee Accounts Payable already documents.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|---------------|
| Duplicate `sales.SalesInvoice`/`SalesInvoiceLine` into a module-owned entity, mirroring Accounts Payable exactly | Rejected: unlike AP (no purchasing module to source from), `sales.SalesInvoice` already exists as real, shipped data — duplicating it creates two drifting copies of the same invoice for no benefit (see Design decisions) |
| An automatic subscriber on `sales.invoice.created`, mirroring Posting Rules Engine | Rejected: `sales.SalesInvoice.status` is a free-form, tenant-configurable dictionary value with no generic "this means finalized" signal — the same problem space as Accounts Payable's explicit-command choice, not Posting Rules Engine's structural-fact one (see Design decisions) |
| Add `accountId` directly to `sales.SalesInvoiceLine`, mirroring `VendorInvoiceLine.accountId` | Not this module's table to alter — `sales` owns that entity and its migrations; a thin, additive `SalesInvoiceLineRevenueAccount` table achieves the same per-line assignment without touching `sales`'s schema |
| Build the `customers.CustomerEntity` ↔ `contractors.Contractor` bridge as part of this document | Rejected as premature: no confirmed need for *automatic* resolution exists anywhere in this codebase yet (Contractor Registry itself only names this document as an undesigned, indirect consumer); an explicit, optional `contractorId` argument covers the one real, confirmed need (contractor snapshotting) without speculatively designing a mapping nobody has asked for |
| A new subsidiary-ledger table for per-customer receivable balances | Unnecessary: `sales.SalesInvoice.outstandingAmount`/`paidTotalAmount` already track this natively (see Design decisions) |

## Architecture

### Entities (`data/entities.ts`)

- `SalesInvoiceGlPosting` — `salesInvoiceId` (FK-id to
  `sales.SalesInvoice`, no ORM relation), `journalEntryId` (FK-id to
  `ledger.JournalEntry`), `contractorId` (FK-id to
  `contractors.Contractor`, nullable), `postedAt`, tenant/org-scoped,
  `createdAt`. No `updatedAt`/`deletedAt`: a posting record is never
  edited or removed once created — a correction is a new, separate
  `ledger.reverseJournalEntry` against the linked entry, not a change
  to this row (see Out of scope).
- `SalesInvoiceLineRevenueAccount` — `salesInvoiceLineId` (FK-id to
  `sales.SalesInvoiceLine`, unique per line, no ORM relation),
  `accountId` (FK-id to `ledger.LedgerAccount`), tenant/org-scoped,
  `createdAt`. Written once, at posting time, alongside
  `SalesInvoiceGlPosting`, in the same transaction.

### Access Control (`acl.ts`)

- `sales_invoice_gl_posting.invoices.post` — required by
  `postSalesInvoiceToLedger`.

No *separate* feature gates reading `SalesInvoiceGlPosting` in Phase 1
— the one read route (see API Contracts) reuses
`sales_invoice_gl_posting.invoices.post`, since there is no dedicated
read UI yet (see Backend Pages) and no confirmed need for a caller who
can check posting status but not post; a reversal, once designed,
would need its own feature.

### Module Dependency (`index.ts`)

```typescript
export const metadata: ModuleInfo = {
  name: 'sales_invoice_gl_posting',
  title: 'Sales Invoice GL Posting',
  version: '0.1.0',
  description:
    'Posts finalized sales invoices to the General Ledger as balanced journal entries.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger', 'sales', 'currencies'],
  ejectable: true,
}
```

`contractors` is a soft/optional peer, resolved via `tryResolve`, not
listed in `requires` — the same optional-dependency *shape*
`accounts_payable_payments` already uses for its own
`contractorBankWhitelistCheck` (this module's own policy on a missing
peer differs — fail open, not fail closed — see Design decisions).

### Encryption (`encryption.ts`)

None owned by this module. `contractorSnapshot`'s underlying
`Contractor` fields (`nip`, etc.) are encrypted at their source in
`contractors`, per that module's own spec — this module only copies
already-decrypted values into a point-in-time JSON snapshot, the same
pattern Accounts Payable already established, not a new encryption
surface.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: ['sales_invoice_gl_posting.invoices.post'],
}
```

No seed data — unlike Posting Rules Engine's zespół 4→5 template,
there is no natural default revenue/receivable/VAT account mapping to
seed (every tenant's chart of accounts and revenue-account structure
differs); Module Config values start unset and must be configured
before the first posting (see Migration & Deployment).

### Commands (Command Pattern, `commands/`)

- `postSalesInvoiceToLedger` — the only mutating command. Input:
  `{ salesInvoiceId: string, lineAccounts: { salesInvoiceLineId: string, accountId: string }[], contractorId?: string }`.
  Rejects if a `SalesInvoiceGlPosting` already exists for
  `salesInvoiceId` (idempotency — see Invariants). Loads the
  `SalesInvoice` and its lines directly via `entityManager`
  (`sales.SalesInvoice`/`SalesInvoiceLine`, scoped by
  `tenantId`/`organizationId`). Validates, in order, rejecting with a
  readable error on the first failure: `issueDate` is not null (see
  Design decisions, "`operationDate` requires a non-null `issueDate`");
  `discountTotalAmount === 0` (see Design decisions, "Header-level
  discounts are out of scope"); every line in `lineAccounts`
  corresponds to a real line on the invoice and every invoice line has
  an assignment (no fallback account, matching AP's own "manual
  per-line, no default" Phase 1 stance). Resolves
  `receivableAccountId`/`vatOutputAccountId` from `ModuleConfigService`
  (rejects with a readable configuration error if either is unset,
  mirroring Accounts Payable's own configuration-error handling), and
  resolves `currencyId` by querying `currencies.Currency` for
  `{ code: invoice.currencyCode, organizationId, tenantId }` (rejects
  if no match — see Design decisions, "Currency resolution"). Calls
  `commandBus.execute('ledger.postJournalEntry', { input, ctx })` with
  one credit line per `lineAccounts` entry (that line's `totalNetAmount`,
  to its assigned `accountId`), one aggregated credit line to
  `vatOutputAccountId` (sum of every line's `taxAmount`), one debit
  line to `receivableAccountId` (`grandTotalGrossAmount`), the
  resolved `currencyId`, `operationDate: invoice.issueDate`,
  `documentType: 'external_own'`, `referenceType: 'sales:sales_invoice'`,
  `referenceId: invoice.id`. Because `discountTotalAmount === 0` is
  enforced above, `grandTotalNetAmount === subtotalNetAmount ===`
  Σ(line `totalNetAmount`) and `grandTotalGrossAmount ===`
  Σ(line `totalNetAmount`) + Σ(line `taxAmount`) — the debit and
  credit sides balance by construction, not by coincidence. If
  `contractorId` is supplied and `contractors` resolves, populates
  the receivable line's `contractorSnapshot` with that contractor's
  point-in-time data (name, NIP — same shape AP already uses).
  Persists `SalesInvoiceGlPosting` and every `SalesInvoiceLineRevenueAccount`
  row in the same transaction as the `postJournalEntry` call. Requires
  `sales_invoice_gl_posting.invoices.post`.

### Events (`events.ts`)

None in Phase 1. No downstream consumer has been named for "a sales
invoice was posted to the ledger" — adding an event now would be
speculative (see this project's own discipline against designing
ahead of a real consumer, applied consistently across every document
in this family).

### Cross-module integration

- **`sales` (hard dependency, read-only).** Reads
  `SalesInvoice`/`SalesInvoiceLine` directly via `entityManager`,
  scoped by `tenantId`/`organizationId` — the same hard-dependency
  direct-entity-read precedent `sales` itself establishes for reading
  `catalog`'s `CatalogProduct`. Never writes to any `sales` entity —
  `sales`'s own invoice lifecycle (status, payments) is entirely
  outside this module's authority.
- **`ledger` (hard dependency).** Writes exclusively through
  `commandBus.execute('ledger.postJournalEntry', { input, ctx })` —
  the real, two-argument `execute(commandId, options)` signature.
  Reads `LedgerAccount` directly (to validate `lineAccounts`/config
  account ids resolve to real accounts) via the same direct-read
  precedent.
- **`contractors` (optional peer).** Resolved via
  `ctx.container.tryResolve('contractorRegistryService')` (or
  equivalent) — the same optional-dependency mechanism
  `accounts_payable_payments` already documents for its own
  `contractorBankWhitelistCheck`, deliberately used here with the
  opposite failure policy (fail open, not fail closed — see Design
  decisions, since this module has no fraud-prevention control to
  protect). If `contractors` isn't installed, `tryResolve` returns
  `undefined` and `contractorSnapshot` is simply omitted — no error,
  no degraded posting (the posting itself never depends on
  `contractors`).
- **This module is never imported or resolved by `sales`, `ledger`, or
  `contractors`.** One-way dependency direction only, matching
  `packages/core/AGENTS.md`.

### Backend Pages

**None in Phase 1.** Posting is triggered from within `sales`'s own
invoice detail page via a widget-injection action (the third of
`packages/core/AGENTS.md`'s three sanctioned cross-module coupling
mechanisms, alongside Events and FK-id+snapshot) — already used twice
elsewhere in this document family (Accounts Payable's and Contractor
Registry's own approval-task widgets, both injected into a host page's
declared spot ID the same way), not a new mechanism this document
introduces. Designing the specific UI integration is left to
implementation; this document specifies only the command it calls.

## Data Models

```typescript
SalesInvoiceGlPosting {
  id: uuid
  tenantId: uuid
  organizationId: uuid
  salesInvoiceId: uuid   // FK-id to sales.SalesInvoice
  journalEntryId: uuid   // FK-id to ledger.JournalEntry
  contractorId: uuid | null   // FK-id to contractors.Contractor
  postedAt: timestamp
  createdAt: timestamp
}

SalesInvoiceLineRevenueAccount {
  id: uuid
  tenantId: uuid
  organizationId: uuid
  salesInvoiceLineId: uuid   // FK-id to sales.SalesInvoiceLine, unique
  accountId: uuid            // FK-id to ledger.LedgerAccount
  createdAt: timestamp
}
```

Both tenant/org-scoped per `packages/core/AGENTS.md`. Indexes (see API
Contracts): `(organization_id, sales_invoice_id)` unique on
`SalesInvoiceGlPosting` (backs the idempotency check);
`(organization_id, sales_invoice_line_id)` unique on
`SalesInvoiceLineRevenueAccount`.

### Module Config

Two tenant-scoped configuration values via `ModuleConfigService`,
mirroring Accounts Payable's own `vatInputAccountId`/
`liabilityAccountId` pattern exactly: `receivableAccountId` (FK-id to
`ledger.LedgerAccount`) and `vatOutputAccountId` (FK-id to
`ledger.LedgerAccount`). Both required before the first posting (see
Migration & Deployment).

## API Contracts

No new API routes for the mutation itself — `postSalesInvoiceToLedger`
is reached through `commandBus`, called from `sales`'s own invoice
detail page action (see Backend Pages), not a public route in Phase 1.

- `GET /api/sales-invoice-gl-posting/postings/:salesInvoiceId` — thin
  read route returning the `SalesInvoiceGlPosting` row (or 404) for a
  given invoice, so `sales`'s own UI can show "posted on {date}, entry
  #{sequenceNumber}" without a second command. Requires
  `sales_invoice_gl_posting.invoices.post` (the same feature — reading
  whether an invoice a user is allowed to post has already been posted
  is not a separate privilege in Phase 1).

## Migration & Deployment

Two new tables (`sales_invoice_gl_posting`, `sales_invoice_line_revenue_account`),
zero changes to any `sales` or `ledger` table. No seed data (see
Module Setup) — `receivableAccountId`/`vatOutputAccountId` must be
configured by an admin before the first `postSalesInvoiceToLedger`
call; the command rejects with a readable error until both are set,
the same UX Accounts Payable already provides for its own unset
configuration. No backfill: invoices created before this module is
enabled are never automatically posted — an operator posts them
individually (or a future bulk-posting tool, out of scope here) once
configuration is in place.

## Implementation Plan

1. `SalesInvoiceGlPosting`/`SalesInvoiceLineRevenueAccount` entities +
   migration.
2. `data/validators.ts` for `postSalesInvoiceToLedger`'s input.
3. `ModuleConfigService` registration for `receivableAccountId`/
   `vatOutputAccountId` + a minimal settings page.
4. `postSalesInvoiceToLedger` command + `acl.ts` + `setup.ts`.
5. `GET /api/sales-invoice-gl-posting/postings/:salesInvoiceId` route
   (with `openApi`, per `packages/core/AGENTS.md`).
6. Widget-injection action on `sales`'s invoice detail page (the UI
   entry point).
7. Integration test: post a real `SalesInvoice` fixture, assert the
   `JournalEntry`, `SalesInvoiceGlPosting`, and
   `SalesInvoiceLineRevenueAccount` rows all exist and balance.

## File Manifest

| File | Change | Notes |
|------|--------|-------|
| `data/entities.ts` | Create | `SalesInvoiceGlPosting`, `SalesInvoiceLineRevenueAccount` |
| `data/validators.ts` | Create | Zod schema for `postSalesInvoiceToLedger` |
| `commands/postSalesInvoiceToLedger.ts` | Create | The only mutating command |
| `lib/moduleConfig.ts` | Create | Registers `receivableAccountId`/`vatOutputAccountId` |
| `acl.ts` | Create | One feature |
| `setup.ts` | Create | `defaultRoleFeatures`, no seed data |
| `index.ts` | Create | `requires: ['ledger', 'sales', 'currencies']` |
| `api/sales-invoice-gl-posting/postings/[salesInvoiceId]/route.ts` | Create | `openApi`-documented read route |
| `backend/settings/page.tsx` | Create | Minimal `receivableAccountId`/`vatOutputAccountId` config UI |

## Testing Strategy

- Assert `postSalesInvoiceToLedger` against a stub `SalesInvoice` (one
  line, one tax rate) produces a `JournalEntry` with a debit to
  `receivableAccountId` for the gross total, a credit to the line's
  assigned `accountId` for the net amount, and a credit to
  `vatOutputAccountId` for the tax amount — and that the three amounts
  balance.
- Assert a second `postSalesInvoiceToLedger` call for the same
  `salesInvoiceId` is rejected (idempotency, Invariant 1).
- Assert the command rejects when `lineAccounts` omits a real invoice
  line, or references a line id that doesn't belong to the invoice.
- Assert the command rejects with a readable configuration error when
  `receivableAccountId` or `vatOutputAccountId` is unset.
- Assert a locked `FiscalPeriod` rejects the posting (delegated
  entirely to `ledger.postJournalEntry` — Invariant 4).
- Assert `contractorSnapshot` is populated when `contractorId` is
  supplied and `contractors` is installed, and is absent (not
  guessed) when either is missing.
- Tenant/org-isolation: `SalesInvoiceGlPosting`/
  `SalesInvoiceLineRevenueAccount` reads and writes never cross
  tenant/organization boundaries.
- Assert `sales`'s own invoice commands/events are fully unaffected
  (no behavior change, no new validation) when
  `sales_invoice_gl_posting` is not installed for a tenant.
- Assert the command rejects with a readable error when
  `discountTotalAmount !== 0` (before attempting to post), and that a
  multi-line invoice with a nonzero `taxTotalAmount` but zero
  `discountTotalAmount` still balances (a second, deliberately
  multi-line case beyond the one-line-one-rate example above).
- Assert the command rejects with a readable error when `issueDate` is
  null, and separately when `currencies.Currency` has no row matching
  `{ code: invoice.currencyCode, organizationId, tenantId }`.
- Assert the receivable account's running balance, after posting N
  invoices, equals the sum of their `outstandingAmount` values
  (Invariant 2).
- Assert editing or deactivating a `Contractor` after a posting exists
  does not change that posting's already-written `contractorSnapshot`
  (Invariant 5 — point-in-time, not live-linked).
- Assert `GET /api/sales-invoice-gl-posting/postings/:salesInvoiceId`
  returns the posting record for a posted invoice, 404 for an unposted
  one, and 403 for a caller without
  `sales_invoice_gl_posting.invoices.post`.

## Risks & Impact Review

- **Data integrity.** The main risk mirrors Accounts Payable's own
  named one: a wrong `accountId` in `lineAccounts` posts revenue to
  the wrong place — silently wrong numbers, not a crash. Mitigated by
  validating every `accountId` resolves to a real `LedgerAccount`
  before posting, and by `ledger.postJournalEntry`'s own balance
  check catching any amount mismatch.
- **Cascading failures.** None distinct from any other single,
  synchronous `postJournalEntry` caller — no subscriber, no fire-and-
  forget step, unlike Posting Rules Engine.
- **Tenant & data isolation.** Same profile as every other module in
  this family — both new entities are tenant/org-scoped, and the
  command never crosses tenant/organization boundaries.
- **Migration & deployment.** Low — two new, empty-by-default tables,
  no change to `sales` or `ledger` schema.
- **The `customers` ↔ `contractors` gap (see Design decisions) is
  real and unresolved.** For most invoices (no `contractorId`
  supplied, or no order, or `contractors` not installed),
  `contractorSnapshot` will simply be absent — a real audit-trail gap
  on the sell side that Accounts Payable does not have on the buy
  side. Not fixed here; named explicitly so it isn't rediscovered
  later as a surprise.
- **No bulk-posting tool in Phase 1.** A tenant enabling this module
  after already having a backlog of finalized invoices must post them
  one at a time — an operational limitation, not a data-integrity one
  (see Migration & Deployment).
- **`sales` can edit a `SalesInvoice`'s lines/amounts after this
  module has posted it, silently desynchronizing the two.** This
  module never writes to `sales`, and `sales`'s own `sales.invoice.updated`
  event (confirmed in that module's generated docs) implies an edit
  path exists after creation. Nothing here locks the invoice, checks
  for a later edit, or re-validates the posting once made — the
  `JournalEntry` reflects the invoice's state at posting time only,
  with no re-sync mechanism if `sales` amounts change afterward. A
  real, unresolved audit-integrity gap this document does not fix,
  named rather than silently assumed away.
- **Output VAT loses its per-rate breakdown at the GL-posting level**
  (see Design decisions, "Aggregating every line's tax") — any
  process needing a JPK_V7-style rate breakdown (23%/8%/5%/0%/zw.)
  must read `sales.SalesInvoiceLine` directly, not this module's
  posting.

## Out of scope

- A full Accounts Receivable subledger (customer statements, aging,
  dunning, collections) — `sales.SalesInvoice.outstandingAmount`/
  `paidTotalAmount` already cover the "how much is owed" question
  natively (see Design decisions); nothing here duplicates or extends
  that.
- Reversing or voiding a posted invoice's journal entry — a future
  `reverseSalesInvoicePosting` command would call
  `ledger.reverseJournalEntry`, symmetrically with Accounts Payable's
  own (undesigned) reversal story; not needed until a real caller asks
  for it.
- Automatic per-line revenue-account mapping — Phase 1 is manual,
  matching Accounts Payable's own explicit Phase 1 stance (see Design
  decisions); a future automation belongs to Posting Rules Engine or
  its own document, not here.
- Bridging `customers.CustomerEntity` to `contractors.Contractor` —
  genuinely unresolved (see Design decisions, Risks); no confirmed
  need for automatic resolution exists anywhere in this codebase yet.
- Credit memos (`sales.SalesCreditMemo`) — a future, separate posting
  path (the natural mirror of a vendor credit note, itself undesigned
  in Accounts Payable); Phase 1 covers invoices only.
- Cost of goods sold / inventory reduction on a sale — a WMS/inventory
  concern, not a revenue-recognition one; this document posts only the
  revenue/receivable/VAT side of a sale.
- Bulk-posting a backlog of pre-existing invoices — an operational
  tool, not a schema or design concern (see Risks).
- Header-level discount apportionment — Phase 1 rejects any invoice
  with `discountTotalAmount !== 0` rather than designing an
  apportionment method or a contra-revenue account nobody has asked
  for yet (see Design decisions).
- Multi-currency exchange-rate handling — this document resolves
  `currencyCode` to a `currencyId` (a required lookup, not optional;
  see Design decisions) but does nothing with `SalesOrder.exchangeRate`
  or any FX gain/loss recognition; every invoice this module posts is
  assumed to be in the tenant's own bookkeeping currency for Phase 1.
- A per-tax-rate output-VAT account structure — the aggregation gap
  named in Risks is real but not solved here; no confirmed consumer
  for a rate-level breakdown has been named.
- Detecting or reacting to a `sales`-side edit to an already-posted
  invoice — named in Risks, not designed around.

## Final Compliance Report

Went through one independent, fresh-context adversarial review pass
against real `sales` source code (entities, commands, generated docs),
`2026-08-18-general-ledger-core-engine.md`,
`2026-09-06-accounts-payable.md`, and
`2026-09-06-contractor-registry.md` before this draft settled, which
found and fixed: three mis-citations of `contractorBankWhitelistCheck`/
`tryResolve` to the wrong AP sibling module (the pattern belongs to
`accounts_payable_payments`, not the `accounts_payable` invoices
document this spec cites — corrected, with the fail-open-vs-fail-
closed policy difference now stated explicitly rather than implied);
a false "first genuine use of widget-injection in this document
family" claim (both Accounts Payable's and Contractor Registry's own
approval-task widgets already use it); a real double-entry balance
failure for any invoice with a nonzero header-level
`discountTotalAmount` (Σ line amounts would not equal
`grandTotalGrossAmount`, and `ledger.postJournalEntry`'s own balance
check would correctly reject it) — fixed by making Phase 1 explicitly
reject such invoices rather than silently mis-designing around them;
an undesigned `currencyCode`-to-`currencyId` resolution step
(`sales.SalesInvoice` has no `currencyId`, unlike AP's own
`VendorInvoice`) — fixed by adding a `currencies.Currency` lookup and
a third hard dependency; an unhandled nullable `issueDate` mapping
into GL's non-nullable `operationDate` — fixed by an explicit
rejection rather than a guessed substitute date; an unnamed multi-tax-
rate aggregation gap (JPK_V7 needs a per-rate breakdown this posting
alone can't reconstruct) — named explicitly in Risks and Out of scope;
a missing named risk for `sales` editing an invoice's lines after this
module has posted it; a mischaracterization of Accounts Payable's own
VAT-posting design as something this document simplifies away from,
when it in fact mirrors it; an inexact "verbatim" quote claim; and six
Testing Strategy gaps (Invariant 2, Invariant 5, the new read route,
and the three new rejection paths). All fixed in place above. Every
specific claim about `sales`'s real schema (`SalesInvoice`/
`SalesInvoiceLine` fields, the `customerEntityId`/`customerSnapshot`
location, the dictionary-driven `status` mechanism, the
`sales.invoice.created`/`updated` events) was checked directly against
`packages/core/src/modules/sales/data/entities.ts`,
`commands/documents.ts`, and the module's own generated docs
(`apps/docs/docs/framework/modules/sales/*.mdx`) this session — not
recalled from memory. The Contractor Registry citation (this document
named as an "indirect… planned, not yet written" consumer) was checked
directly against that document's current, correct text on
`docs/contractor-registry` (confirmed to differ from an earlier, stale
local copy — the version used here is the one actually committed).
Compliance Matrix and a formal pass/fail verdict are deferred to a
maintainer review, matching this project's established practice.

## Changelog

### 2026-09-10 — Initial full first draft

Written from scratch — nothing existed under this filename before
today, despite being named as a future dependency by #5663 (2026-08-18),
#5962 (2026-09-08), and Contractor Registry (2026-09-06) for the past
several days. Grounded directly in `sales`'s real, shipped code
(entities, commands, events, generated docs) rather than assumption.
Key decisions: an explicit command (not an event subscriber),
mirroring Accounts Payable's posting mechanics with debits/credits
reversed, two new thin additive entities (no duplication of `sales`'s
own invoice data), and an honest, named gap on the `customers` ↔
`contractors` bridge rather than a speculative one.

### 2026-09-10 (cont.) — Independent review pass, eleven issues fixed

Went through one independent, fresh-context adversarial review pass,
grounded against the real `sales` module source (entities, the actual
`createInvoiceCommand`, generated docs) and against Accounts Payable's
and Contractor Registry's own committed specs, rather than trusting
citations at face value. Found and fixed eleven issues: a fabricated
citation attributing `contractorBankWhitelistCheck`/`tryResolve` to
`accounts_payable` when it actually lives exclusively in the sibling
`accounts_payable_payments` module (fixed in three places, with an
honest fail-open-vs-fail-closed policy contrast added instead); a false
claim that this module is the first to use widget injection, when both
Accounts Payable and Contractor Registry already do (fixed to cite
them); a real double-entry balance bug where header-level
`discountTotalAmount` was silently dropped, which would make
`ledger.postJournalEntry`'s balance check correctly reject every
discounted invoice (fixed with an explicit Phase-1 precondition —
reject non-zero discounts rather than attempting apportionment); an
unaddressed `sales.SalesInvoice.currencyCode` (string) → `ledger`'s
required `currencyId` (FK) resolution gap (fixed by adding a
`currencies.Currency` lookup step and `currencies` as a third hard
dependency); an unaddressed nullable `issueDate` → non-nullable
`operationDate` mapping (fixed by rejecting a null `issueDate`
explicitly); an unnamed multi-VAT-rate aggregation gap relevant to
JPK_V7 rate breakdowns (fixed by naming it explicitly in Design
Decisions, Risks, and Out of Scope); an unnamed risk that `sales` can
still edit invoice lines after this module has posted them, desyncing
the `JournalEntry` (fixed by adding a named Risk and Out of Scope
entry); an internal contradiction between "no feature gates reading"
and the GET route's own feature requirement (fixed the wording to "no
*separate* feature"); a mischaracterization of Accounts Payable's VAT
design as something this module simplifies away from, when it actually
mirrors it (fixed the paragraph); an inexact "verbatim" quote claim
(fixed to "closely mirrors" with the corrected exact quote); and six
Testing Strategy gaps corresponding to the fixes above (added). Full
trail in the Final Compliance Report above.

Not yet reviewed by a human/maintainer. The `customers` ↔ `contractors`
identity bridge remains a flagged, unresolved gap by design — this
document names it rather than speculatively solving it, matching this
project's "don't design ahead of a confirmed need" discipline.
