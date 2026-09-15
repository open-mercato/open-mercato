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
validates that the invoice actually balances, rather than assuming it
does.** Checked directly against `sales`'s real, shipped code, not
assumed (external review, 2026-09-14, independently re-verified
against `sales/commands/documents.ts:9030-9048` and
`sales/data/validators.ts:938-946`): `sales.invoices.create`/`.update`
write every header total (`subtotalNetAmount`, `discountTotalAmount`,
`taxTotalAmount`, `grandTotalNetAmount`, `grandTotalGrossAmount`)
straight from caller input (`toNumericString(parsed.<field> ?? 0)`) —
unlike the quote/order paths, invoices never call
`salesCalculationService.calculateDocumentTotals`, and
`invoiceCreateSchema` marks every one of those fields `.optional()`
with no `.superRefine` tying them to the line sums. So
`grandTotalGrossAmount` is not derived from lines — it is
independent, caller-supplied data that can disagree with Σ(line
`totalNetAmount`) + Σ(line `taxAmount`) for reasons far more common
than a header discount: an operator omitting header totals entirely
(they default to `'0'`), a header discount, or plain bad data entry.
Unlike Accounts Payable — which enforces "sum of lines = header
total" at `createVendorInvoice`/`updateVendorInvoice` time, because
AP owns `VendorInvoice` end to end — this module cannot rely on that
invariant already holding, since it never wrote the invoice and
`sales` enforces no such identity. Resolution:
`postSalesInvoiceToLedger` validates
`grandTotalGrossAmount === Σ(line.totalNetAmount) + Σ(line.taxAmount)`
immediately before posting — compared as decimals (the repo's
decimal/`toNumber` helper), never with a bare `===` on the
numeric-string columns, since Postgres returns e.g. `'0.0000'` — and
rejects with a readable error on any mismatch. This replaces, and is
strictly stronger than, an earlier `discountTotalAmount === 0` guard:
that guard caught only header discounts, while the real precondition
is the line/header identity itself, whatever its cause. Apportioning
a mismatch automatically (a per-line discount split, a
contra-revenue account) remains a real design question this document
does not answer — it would need its own configured account and
method neither `sales` nor any sibling document specifies anywhere;
this module rejects rather than guesses.

**Line-kind scope: Phase 1 posts only `product`/`service`/
`shipping` lines — `discount` and `adjustment` lines are rejected,
not guessed at.** `SalesLineKind` includes `discount`/`shipping`/
`adjustment` alongside `product`/`service`, and every posted line is
credited to its assigned account exactly the same way regardless of
kind. `shipping` is unambiguous — genuine revenue for a service
rendered, just to a different account than a product line, no
different treatment needed. `discount` is not: Kieso's *Intermediate
Accounting* (Ch.7, "Cash and Receivables," pp.7-9–7-11, verified
directly) distinguishes three fundamentally different things a
"discount" can be — a trade/catalog discount, netted into the unit
price before the invoice ever exists, with no separate line or
account ("the manufacturer simply deducts the trade discount from
the list price and bills the customer net"); a cash/settlement
discount for prompt payment, not recognized until payment arrives
and booked only then (`Cash` / `Sales Discounts` (Dr) /
`Accounts Receivable`), never at invoice-posting time; or an
invoice-time allowance, the one case Kieso labels explicitly —
"Sales Returns and Allowances is a contra revenue account to Sales
Revenue and offsets sales revenue on the income statement" —
debited immediately, the same moment this module posts.
`SalesLineKind` does not distinguish which of these three a given
`'discount'` line represents. Fowler's *Analysis Patterns* (§6.4,
"Memo Account," p.104) confirms a contra account is a legitimate,
well-established modeling answer when the case actually calls for
one — it does not resolve which of the three cases applies here.
Since two of the three would be wrong to post at all in this module
(the first has no line to post; the second belongs to a future
payments-side module, not this one), `postSalesInvoiceToLedger`
rejects any invoice containing a `discount` or `adjustment` line
(`adjustment`'s semantics are equally undefined in `sales`) until
`sales` — or a future revision of this module — can distinguish
them. Hay's *Data Model Patterns* has nothing on contra accounts or
sales discounts anywhere in the book (checked directly, full text)
— no pattern to reconcile against.

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

## Literature & Prior Art

Per the financial-spec-writing-process. Verification trail recorded in
full in `financial-module-knowledge-base.md` §3.

**Cross-spec consistency (Step 1) — re-verified, no corrections
needed.** Three of this document's own internal citations were checked
directly against the cited sibling specs rather than trusted from
memory: Accounts Payable's "Input VAT gets its own account — it is not
silently absorbed into the expense account" (quoted exactly);
Accounts Payable's Alternatives table entry "No precedent whatsoever in
the repo for this kind of mapping (verified — nothing similar exists);
building AP's own rules engine would duplicate the future Posting Rules
Engine" (quoted exactly); and #5663's `documentType` enum
(`external_foreign`/`external_own`/`internal`/`collective`/`corrective`/
`substitute`, art. 20 ust. 2–3) (confirmed exactly). This is now the
third spec in the family with a clean re-check on its own citations.

**Literature grounding (Step 2) — a real citation gap, now closed.**
This document uses "receivable control account" four times (TLDR,
Problem Statement, Proposed Solution, Invariants) with **no citation
anywhere for the concept** — a gap the process is meant to catch. It
already exists, verified, in this knowledge base: Kieso, *Intermediate
Accounting*, 17th Ed., Ch.7 "Cash and Receivables," p.7-12, footnote 5,
names the exact risk of "a lack of correspondence between the control
account and the subsidiary ledger related to accounts receivable" —
more directly on-point here than the general Ch.3 "Basic Terminology"
definition used for Accounts Payable's payable side, since this is the
receivable side by name. Legally: **Ustawa o rachunkowości, art. 13
ust. 1 pkt 3 and art. 16**, already established in this knowledge base
as the stronger, directly-applicable citation for the control-
account/subsidiary-ledger pattern generally, applies identically here —
this document's Invariant 2 ("the receivable control account's balance
equals the sum of `outstandingAmount` across every posted
`SalesInvoice`") is precisely the reconciliation both sources describe,
with `sales.SalesInvoice` itself serving as the subsidiary ledger (see
Design decisions, "No new subsidiary ledger").

**Comparison against real systems (Step 3).** Checked how ERPNext
handles the equivalent moment (docs.frappe.io/erpnext/sales-invoice,
verified 2026-09-12): "When it is submitted, ERPNext records the
receivable, income, and taxes in the general ledger" — debiting the
customer's receivable account (party-scoped, the same control-account +
per-party-subsidiary structure as this document's
`outstandingAmount`-based one), crediting income and tax accounts. The
real divergence: ERPNext's GL posting happens **automatically, in the
same action** as invoice submission — there is no separate posting step
to call. This document deliberately splits that into an explicit,
separate `postSalesInvoiceToLedger` command, for a reason specific to
this codebase (`sales.SalesInvoice.status` is a free-form tenant
dictionary value with no generic "finalized" signal — see Design
decisions) that ERPNext's own fixed `docstatus` lifecycle (Draft →
Submitted → Cancelled) doesn't have to solve, because Frappe's
submission mechanism already **is** the trigger ERPNext needs. This
also explains why `SalesInvoiceGlPosting` needs to exist here at all: it
substitutes for the idempotency/audit guarantee Frappe's own
`docstatus` field gives ERPNext for free. Odoo's customer-invoice
posting flow was not independently re-verified this pass (its
documentation didn't yield a fetchable primary-source confirmation in
this session) — flagged as not done, not silently assumed.

**Structure (Step 4).** Checked against `om-spec-writing`'s required
sections — TLDR, Overview, Problem Statement, Proposed Solution, Design
Decisions, User Stories, Invariants, Alternatives Considered,
Architecture, Data Models, API Contracts, Migration & Deployment,
Implementation Plan, File Manifest, Testing Strategy, Risks & Impact
Review, Out of scope, Final Compliance Report, Changelog — all present,
and the Final Compliance Report already carries a structured Compliance
Matrix from an earlier independent review pass. No gaps found.

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

- `sales_invoices_gl_posting.invoices.post` — required by
  `postSalesInvoiceToLedger`.

No *separate* feature gates reading `SalesInvoiceGlPosting` in Phase 1
— the one read route (see API Contracts) reuses
`sales_invoices_gl_posting.invoices.post`, since there is no dedicated
read UI yet (see Backend Pages) and no confirmed need for a caller who
can check posting status but not post; a reversal, once designed,
would need its own feature.

### Module Dependency (`index.ts`)

```typescript
export const metadata: ModuleInfo = {
  name: 'sales_invoices_gl_posting',
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
  admin: ['sales_invoices_gl_posting.invoices.post'],
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
  Input shape is validated against a zod schema (`data/validators.ts`)
  before any business-rule check below runs. Rejects if a
  `SalesInvoiceGlPosting` already exists for
  `salesInvoiceId` (idempotency — see Invariants). Loads the
  `SalesInvoice` and its lines directly via `entityManager`
  (`sales.SalesInvoice`/`SalesInvoiceLine`, scoped by
  `tenantId`/`organizationId`, excluding soft-deleted rows —
  `deletedAt: null` on both). Validates, in order, rejecting with a
  readable error on the first failure: `issueDate` is not null (see
  Design decisions, "`operationDate` requires a non-null `issueDate`");
  `grandTotalGrossAmount === Σ(line.totalNetAmount) + Σ(line.taxAmount)`,
  compared as decimals, not `===` on the raw numeric-string columns
  (see Design decisions, "Header-level discounts are out of scope");
  every `SalesInvoiceLine.kind` is `'product'`, `'service'`, or
  `'shipping'` (see Design decisions, "Line-kind scope");
  every line in `lineAccounts`
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
  `referenceId: invoice.id`. Because the line/header balance identity
  is validated above, the debit and credit sides of this posting are
  guaranteed equal before `ledger.postJournalEntry` ever sees them —
  a checked precondition on `sales`'s own, unvalidated data, not an
  assumption (see Design decisions). If
  `contractorId` is supplied and `contractors` resolves, populates
  the receivable line's `contractorSnapshot` with that contractor's
  point-in-time data (name, NIP — same shape AP already uses).
  Persists `SalesInvoiceGlPosting` and every `SalesInvoiceLineRevenueAccount`
  row in the same transaction as the `postJournalEntry` call. Requires
  `sales_invoices_gl_posting.invoices.post`.

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
- **`contractors` (optional peer).** Resolved via a per-module local
  `tryResolve` helper wrapping `container.resolve('contractorRegistryService')`
  in a try/catch — the exact mechanism `packages/core/AGENTS.md` →
  Cross-Module Coupling specifies (citing `inbox_ops/subscribers/
  extractionWorker.ts` as precedent), not a raw
  `ctx.container.tryResolve(...)` call. The same optional-dependency
  mechanism `accounts_payable_payments` already documents for its own
  `contractorBankWhitelistCheck`, deliberately used here with the
  opposite failure policy (fail open, not fail closed — see Design
  decisions, since this module has no fraud-prevention control to
  protect). If `contractors` isn't installed, the helper returns
  `undefined` and `contractorSnapshot` is simply omitted — no error,
  no degraded posting (the posting itself never depends on
  `contractors`).
- **This module is never imported or resolved by `sales`, `ledger`, or
  `contractors`.** One-way dependency direction only, matching
  `packages/core/AGENTS.md`.

### Backend Pages

**None owned by this module in Phase 1** — no page under its own route.
Two pieces of UI, both hosted by other modules:

- **The posting action** is triggered from within `sales`'s own invoice
  detail page via a widget-injection action (the third of
  `packages/core/AGENTS.md`'s three sanctioned cross-module coupling
  mechanisms, alongside Events and FK-id+snapshot) — already used twice
  elsewhere in this document family (Accounts Payable's and Contractor
  Registry's own approval-task widgets, both injected into a host
  page's declared spot ID the same way), not a new mechanism this
  document introduces. The action reads posting status via `apiCall`
  against the `GET` route above and renders it with `<StatusBadge>`
  (semantic status tokens only — `bg-status-success-bg` for "posted,"
  no hardcoded `bg-green-*`); the "Post to ledger" trigger itself is a
  labelled button (not icon-only, so no `aria-label` gap) wrapped in
  `useGuardedMutation(...).runMutation(...)` against the `POST` route
  above (see API Contracts) — `postSalesInvoiceToLedger` is reached
  through that route's own `commandBus.execute` call, never directly
  from the browser — with `retryLastMutation`
  passed in the injection context, since it's a custom, non-`CrudForm`
  write. All labels and the posted/not-posted
  status text go through `useT()` (client-side), matching every
  sibling module in this family — no hard-coded strings.
- **The module-config settings page** (`backend/settings/page.tsx`,
  File Manifest) is a minimal `<CrudForm>` (from
  `@open-mercato/ui/backend/CrudForm`) with two `<FormField>`-wrapped
  `LedgerAccount` pickers (`receivableAccountId`, `vatOutputAccountId`),
  submitted via `updateCrud` against `ModuleConfigService`'s own config
  endpoint — the same construction Accounts Payable's own
  `vatInputAccountId`/`liabilityAccountId` settings page already uses.
  Field labels and validation errors go through `resolveTranslations()`
  server-side / `useT()` client-side.

Designing the exact placement/spot ID of the widget injection is left
to implementation; this document specifies the mechanism and the
primitives it must use, not the pixel layout.

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
Contracts): `(organization_id, tenant_id, sales_invoice_id)` unique on
`SalesInvoiceGlPosting` (backs the idempotency check);
`(organization_id, tenant_id, sales_invoice_line_id)` unique on
`SalesInvoiceLineRevenueAccount` — both include `tenant_id` alongside
`organization_id`, matching every comparable scoped-uniqueness
constraint elsewhere in the repo (e.g.
`currencies_code_scope_unique = (organizationId, tenantId, code)`).

### Module Config

Two tenant-scoped configuration values via `ModuleConfigService`,
mirroring Accounts Payable's own `vatInputAccountId`/
`liabilityAccountId` pattern exactly: `receivableAccountId` (FK-id to
`ledger.LedgerAccount`) and `vatOutputAccountId` (FK-id to
`ledger.LedgerAccount`). Both required before the first posting (see
Migration & Deployment).

## API Contracts

- `POST /api/sales-invoices-gl-posting/postings/:salesInvoiceId/post`
  — the only mutating route. A custom write route, mapped to `update`
  in the mutation guard registry per `packages/core/AGENTS.md` → API
  Routes (this isn't a field edit, so it doesn't go through
  `makeCrudRoute`) — the same construction Accounts Payable's own
  `POST /api/accounts_payable/invoices/:id/post` uses. Dispatches
  `postSalesInvoiceToLedger` via `commandBus.execute`; never called
  directly from the browser. **Body**:
  `{ lineAccounts: { salesInvoiceLineId, accountId }[], contractorId?: string }`.
  The route file exports `metadata` with `POST: { requireAuth: true,
  requireFeatures: ['sales_invoices_gl_posting.invoices.post'] }` (no
  top-level `export const requireAuth`), and is `openApi`-documented
  per File Manifest and Implementation Plan step 5. **Response 200**:
  `{ salesInvoiceId, journalEntryId, postedAt }`. **Response 409**:
  a `SalesInvoiceGlPosting` already exists for this invoice
  (idempotency, Invariant 1). **Response 422**: the balance-identity
  check fails, any line's `kind` is `'discount'`/`'adjustment'`,
  `issueDate` is null, `lineAccounts` is incomplete or
  references a line not on the invoice, or
  `receivableAccountId`/`vatOutputAccountId`/`currencyId` cannot be
  resolved (see Design decisions, Commands) — one discriminated error
  code per cause, the same typed-error precedent Accounts Payable
  sets with `FISCAL_PERIOD_LOCKED`. Called from the widget-injection
  action (see Backend Pages) via `useGuardedMutation(...).runMutation(...)`,
  never raw `fetch`.
- `GET /api/sales-invoices-gl-posting/postings/:salesInvoiceId` — thin
  read route returning the `SalesInvoiceGlPosting` row (or 404) for a
  given invoice, so `sales`'s own UI can show "posted on {date}, entry
  #{sequenceNumber}" without a second command. The route file exports
  `metadata` with `GET: { requireAuth: true, requireFeatures:
  ['sales_invoices_gl_posting.invoices.post'] }` (no top-level `export
  const requireAuth`), per `packages/core/AGENTS.md` — the same feature
  the command itself requires (reading whether an invoice a user is
  allowed to post has already been posted is not a separate privilege
  in Phase 1). Called from the widget-injection action (see Backend
  Pages) via `apiCall`, never raw `fetch`.

**Caching:** none in Phase 1. The one read route is a point lookup
keyed by the same unique index (`organization_id, tenant_id,
sales_invoice_id`) that backs the idempotency check in the command —
low cardinality, no list/aggregate query — so no cache layer, tags, or
TTL are declared; see the Compliance Matrix below.

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
5. `GET /api/sales-invoices-gl-posting/postings/:salesInvoiceId` route
   and `POST /api/sales-invoices-gl-posting/postings/:salesInvoiceId/post`
   route (dispatches `postSalesInvoiceToLedger` via `commandBus`,
   mapped to `update` in the mutation guard registry) — both with
   `openApi`, per `packages/core/AGENTS.md`.
6. Widget-injection action on `sales`'s invoice detail page (the UI
   entry point).
7. Integration test: post a real `SalesInvoice` fixture, assert the
   `JournalEntry`, `SalesInvoiceGlPosting`, and
   `SalesInvoiceLineRevenueAccount` rows all exist and balance.

## File Manifest

All paths below are relative to
`packages/core/src/modules/sales_invoices_gl_posting/` — this module
lands under `packages/core`, not `apps/mercato/src/modules/`, per root
AGENTS.md → Where to Put Code, which forbids new module code there.

| File | Change | Notes |
|------|--------|-------|
| `data/entities.ts` | Create | `SalesInvoiceGlPosting`, `SalesInvoiceLineRevenueAccount` |
| `data/validators.ts` | Create | Zod schema for `postSalesInvoiceToLedger` |
| `commands/postSalesInvoiceToLedger.ts` | Create | The only mutating command |
| `lib/moduleConfig.ts` | Create | Registers `receivableAccountId`/`vatOutputAccountId` |
| `acl.ts` | Create | One feature |
| `setup.ts` | Create | `defaultRoleFeatures`, no seed data |
| `index.ts` | Create | `requires: ['ledger', 'sales', 'currencies']` |
| `api/sales-invoices-gl-posting/postings/[salesInvoiceId]/route.ts` | Create | `openApi`-documented read route |
| `api/sales-invoices-gl-posting/postings/[salesInvoiceId]/post/route.ts` | Create | Custom write route, dispatches `postSalesInvoiceToLedger` via `commandBus`, mapped to `update` |
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
  `sales_invoices_gl_posting` is not installed for a tenant.
- Assert the command rejects with a readable error when
  `grandTotalGrossAmount !== Σ(line.totalNetAmount) + Σ(line.taxAmount)`
  (before attempting to post) — covering both a header discount and a
  header left at its `'0'` default with real line data, since `sales`
  enforces neither case (see Design decisions) — and that a multi-line
  invoice with a nonzero `taxTotalAmount` but a header that correctly
  sums its lines still balances (a second, deliberately multi-line
  case beyond the one-line-one-rate example above).
- Assert the command rejects with a readable error when any posted
  line's `kind` is `'discount'` or `'adjustment'` (Design decisions,
  "Line-kind scope") — and that an otherwise-identical invoice with
  only `product`/`service`/`shipping` lines posts normally.
- Assert a soft-deleted `SalesInvoice` (or one with a soft-deleted
  line) is treated as not found, not posted (Design decisions,
  Commands).
- Assert the command rejects with a readable error when `issueDate` is
  null, and separately when `currencies.Currency` has no row matching
  `{ code: invoice.currencyCode, organizationId, tenantId }`.
- Assert the receivable account's running balance, after posting N
  invoices, equals the sum of their `outstandingAmount` values
  (Invariant 2).
- Assert editing or deactivating a `Contractor` after a posting exists
  does not change that posting's already-written `contractorSnapshot`
  (Invariant 5 — point-in-time, not live-linked).
- Assert `GET /api/sales-invoices-gl-posting/postings/:salesInvoiceId`
  returns the posting record for a posted invoice, 404 for an unposted
  one, and 403 for a caller without
  `sales_invoices_gl_posting.invoices.post`.
- Assert `POST /api/sales-invoices-gl-posting/postings/:salesInvoiceId/post`
  returns 200 with `{ salesInvoiceId, journalEntryId, postedAt }` on a
  valid first call, 409 on a second call against the same invoice
  (Invariant 1), and 422 with a discriminated error code for each of
  the rejection causes above (balance mismatch, null `issueDate`,
  incomplete `lineAccounts`, unresolved config/currency).

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
  module has posted it, silently desynchronizing the two — and the
  same is true of a soft-delete.** This
  module never writes to `sales`, and `sales`'s own `sales.invoice.updated`
  event (confirmed in that module's generated docs) implies an edit
  path exists after creation. Nothing here locks the invoice, checks
  for a later edit, or re-validates the posting once made — the
  `JournalEntry` reflects the invoice's state at posting time only,
  with no re-sync mechanism if `sales` amounts change afterward.
  Reads exclude `deletedAt` rows going forward (see Commands), but an
  invoice soft-deleted in `sales` *after* this module has already
  posted it leaves the `JournalEntry` standing with no corresponding
  live invoice — whether that should trigger a reversal is a real,
  unresolved question, named here rather than designed around. A
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
  whose header total doesn't match Σ(lines) (which a header discount
  is one, but not the only, way to cause) rather than designing an
  apportionment method or a contra-revenue account nobody has asked
  for yet (see Design decisions).
- Per-line `discount`/`adjustment` posting — Phase 1 rejects any
  invoice containing such a line rather than guessing which of three
  distinct accounting treatments (trade discount, settlement
  discount, invoice-time allowance) a generic `kind` value represents
  (see Design decisions, "Line-kind scope").
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

## Final Compliance Report — 2026-09-10 (rev. 2 — structured Compliance Matrix)

The initial draft's Final Compliance Report (see Changelog, "Initial
full first draft" and "Independent review pass, eleven issues fixed")
documented one independent, fresh-context adversarial review pass
against real `sales` source code (entities, commands, generated docs),
`2026-08-18-general-ledger-core-engine.md`,
`2026-09-06-accounts-payable.md`, and
`2026-09-06-contractor-registry.md`, and fixed eleven issues there
(mis-cited `contractorBankWhitelistCheck` ownership, a real
double-entry balance bug from an unhandled header discount, an
undesigned currency-resolution gap, and eight others — full list in
the Changelog entries below). That pass verified every specific claim
about `sales`'s real schema directly against
`packages/core/src/modules/sales/data/entities.ts`,
`commands/documents.ts`, and the module's own generated docs — not
recalled from memory — and confirmed the Contractor Registry citation
against that document's current, correct committed text.

That report was narrative only; it did not follow this skill's own
[Final Compliance Review](../skills/om-spec-writing/references/compliance-review.md)
gate in its required form (an AGENTS.md-by-AGENTS.md Compliance
Matrix, an Internal Consistency Check, and an explicit Verdict) — the
gap Fixed Assets' own Final Compliance Report correctly fills and
this revision now closes. A separate,
fresh-context scope-cohesion check (checklist §1.2, delegated per the
skill's own requirement — "the author cannot adversarially re-read its
own spec") returned **COHESIVE — one capability, ship as one module**:
every piece (the command, the two entities, the settings page, the
read route, the contractor-snapshot handling) exists solely to support
the one integration seam named in the TLDR, and no text in the
document ever admits a part functions independently of the others.

This revision also added, rather than retroactively claimed, the
concrete spec content the matrix below cites: the settings page's and
widget-injection action's actual construction (`<CrudForm>`,
`<StatusBadge>`, `useGuardedMutation`, `apiCall`, `useT()` — Backend
Pages), the `GET` route's `metadata`/`requireFeatures` export and its
explicit no-caching rationale (API Contracts), and the command's
zod-validation step (Commands) — none of that UI/route detail existed
in the draft this matrix would otherwise have to mark non-compliant.

One workflow step this document did not follow: the skill's Step
3–4 Skeleton Spec + Open Questions gate. The full draft was written
directly, per the maintainer's explicit go-ahead, on the strength of
Accounts Payable's already-proven, directly-analogous pattern (same
posting shape, same Phase-1 manual-mapping stance) — not because the
gate was overlooked. Writing a skeleton retroactively, after a
reviewed full draft already exists, would not surface anything the
review above hasn't already covered.

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `SalesInvoiceGlPosting.salesInvoiceId`/`journalEntryId`/`contractorId` and `SalesInvoiceLineRevenueAccount.salesInvoiceLineId`/`accountId` are all plain FK-ids, explicitly "no ORM relation" (Architecture → Entities) |
| root AGENTS.md | Filter by `organization_id` | Compliant | Both new entities are tenant/org-scoped (Data Models); the command scopes every `sales`/`ledger`/`currencies` read by `tenantId`/`organizationId` (Commands) |
| packages/core/AGENTS.md → API Routes | API routes MUST export `openApi` | Compliant | Both routes (`GET`/`POST /api/sales-invoices-gl-posting/postings/:salesInvoiceId[/post]`) are `openApi`-documented per File Manifest and Implementation Plan step 5 |
| packages/core/AGENTS.md → API Routes | `metadata` export with per-method `requireAuth`/`requireFeatures` | Compliant | Both routes export `metadata` with `{ requireAuth: true, requireFeatures: ['sales_invoices_gl_posting.invoices.post'] }` on their respective method (`GET`/`POST`), no top-level `export const requireAuth` |
| packages/core/AGENTS.md → CRUD Factory | CRUD APIs use `makeCrudRoute` | N/A | No CRUD collection in Phase 1 — the mutation is a custom write route (`POST .../post`, mapped to `update` in the mutation guard registry, mirroring Accounts Payable's own `.../post` route) dispatching `postSalesInvoiceToLedger` via `commandBus`, not a `makeCrudRoute` list/detail surface; the other route is a bespoke single-record GET |
| packages/core/AGENTS.md | All user input validated with zod before persistence | Compliant | `postSalesInvoiceToLedger`'s input shape is validated via `data/validators.ts` before any business-rule check runs (Commands, updated this revision) |
| packages/core/AGENTS.md → Encryption | Encryption maps for PII/GDPR columns | N/A | Neither new entity carries a free-text or PII field (FK-ids + timestamps only); the one PII value in this flow (`contractorSnapshot`: name, NIP) is written onto `ledger.JournalEntryLine.contractorSnapshot` — that module's own column and encryption surface, not this module's, mirroring Accounts Payable's established precedent exactly |
| packages/core/AGENTS.md | Optimistic locking (`updatedAt`) on user-editable entities | N/A | Both entities are write-once/append-only by design — no `updatedAt` on either, matching `JournalEntry`'s own immutable-posting precedent (a correction is a new `ledger.reverseJournalEntry`, never an edit to these rows) |
| packages/core/AGENTS.md | Cross-module touchpoints name mechanism, owner, and module-absent behavior | Compliant | `sales`/`ledger` (hard `requires`, direct-entity-read / `commandBus`) and `contractors` (optional peer, `tryResolve`, fails open, degrades to "no `contractorSnapshot`") are all named explicitly in Cross-module integration |
| packages/events/AGENTS.md | No direct cross-module calls; events for side effects | Compliant | No direct cross-module *service* calls; writes into `ledger` go through `commandBus.execute('ledger.postJournalEntry', ...)`; reads of `sales.SalesInvoice`/`SalesInvoiceLine` and `ledger.LedgerAccount` are the sanctioned hard-dependency direct-entity-read pattern (see Cross-module integration), not a rule violation; no events declared in Phase 1 since no downstream consumer exists yet (named explicitly, not silently skipped) |
| packages/cache/AGENTS.md | Cache resolved via DI; tenant-scoped tags; invalidation declared per write path | N/A | No caching declared — the one read route is a point lookup on the same unique index backing the idempotency check (`organization_id, sales_invoice_id`), not a list/aggregate query (added explicitly to API Contracts this revision) |
| packages/ui/AGENTS.md | Backend forms use `<CrudForm>`; non-`CrudForm` writes use `useGuardedMutation` | Compliant | Added this revision (Backend Pages): the settings page uses `<CrudForm>`/`<FormField>`; the widget-injection posting action uses `useGuardedMutation(...).runMutation(...)` with `retryLastMutation` in the injection context |
| packages/ui/src/backend/AGENTS.md | All HTTP goes through `apiCall`/`apiCallOrThrow` (never raw `fetch`) | Compliant | The widget's status read, its posting trigger (`useGuardedMutation`, itself built on `apiCall`, against the `POST` route), and the settings page's save all go through `apiCall` — no raw `fetch` |
| root AGENTS.md (Design System Rules) | Semantic status tokens, Tailwind text scale, shared primitives, `aria-label` on icon-only buttons | Compliant | Added this revision: `<StatusBadge>` for posted/not-posted status (semantic tokens only, e.g. `bg-status-success-bg`, never `bg-green-*`); neither new control is icon-only, so no `aria-label` gap applies |
| checklist §5 | i18n keys planned for all user-facing strings | Compliant | Added this revision: settings-page labels/errors and the widget's status text go through `useT()` (client) / `resolveTranslations()` (server) — no hard-coded strings |
| checklist §1.2 | Spec covers ONE independently deployable capability (fresh-context subagent check) | Compliant | **COHESIVE** verdict from an isolated, fresh-context review given only this spec file — no text in the document admits any part functions independently of the others (see narrative above) |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Every field the `GET` route returns traces to a `SalesInvoiceGlPosting` column; no field appears in one section and not the other |
| API contracts match UI/UX section | Pass | The `GET` route (posting status) is exactly what the widget-injection status pill reads, and the `POST` route is exactly what its "Post to ledger" trigger calls via `useGuardedMutation`; the settings page maps 1:1 to the two Module Config values |
| Risks cover all write operations | Pass | The sole mutating command (`postSalesInvoiceToLedger`) has named Risk entries covering wrong-account misposting, the discount rejection, post-posting `sales`-side edits desyncing the entry, and the VAT per-rate aggregation gap |
| Commands defined for all mutations | Pass | `postSalesInvoiceToLedger` is the only mutation; both new entities are written exclusively by it, in one transaction |
| Cache strategy covers all read APIs | N/A | No caching declared (see Compliance Matrix) |

### Non-Compliant Items

None outstanding. This revision's additions (the `metadata`/
`requireFeatures` wording, the zod-validation sentence, the settings-
page and widget UI construction, the i18n plan, and the explicit
no-caching rationale) closed every gap the prior narrative-only report
had left implicit rather than explicitly answered or marked N/A. See
the Changelog entry below for the full list of what changed this
revision.

### Verdict

- **Fully compliant** — approved for implementation. Not yet reviewed
  by a human/maintainer. The `customers` ↔ `contractors` identity
  bridge remains a flagged, unresolved gap by design (see Design
  decisions, Risks, Out of scope) — a named gap, not a compliance
  failure.

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

### 2026-09-10 (cont., again) — Structured Compliance Matrix, UI/route detail, scope-cohesion check

The prior "eleven issues fixed" pass verified every technical claim
directly but never actually ran this project's own
`om-spec-writing`/`compliance-review.md` gate in its required
structured form — a real process gap, not just a documentation one,
caught by comparing this document against Fixed Assets' own Final
Compliance Report. This pass closes it:

- Ran an isolated, fresh-context scope-cohesion check (checklist §1.2)
  against this spec file alone. Verdict: **COHESIVE** — no text in the
  document admits any part (command, settings page, read route,
  contractor snapshot) functions independently of the others.
- Added concrete spec content that had been silently absent rather
  than marked N/A: the settings page's and widget-injection action's
  actual UI construction (`<CrudForm>`, `<FormField>`, `<StatusBadge>`
  with semantic tokens, `useGuardedMutation`, `apiCall`, `useT()`/
  `resolveTranslations()` for i18n — Backend Pages), the `GET` route's
  `metadata`/`requireFeatures` export (API Contracts), an explicit
  no-caching rationale for that same route (API Contracts), and the
  command's zod-validation step (Commands).
- Replaced the narrative-only Final Compliance Report with the
  skill's actual required structure: an AGENTS.md Files Reviewed list,
  a rule-by-rule Compliance Matrix (16 rows, all Compliant or N/A with
  justification, zero silently-skipped items), an Internal Consistency
  Check, a Non-Compliant Items section (none outstanding), and an
  explicit Verdict (fully compliant).
- Named, rather than silently skipped, the one workflow step not
  followed: the Skeleton Spec + Open Questions gate (Steps 3–4) — the
  full draft was written directly on Accounts Payable's already-proven
  pattern, per the maintainer's explicit go-ahead, not by oversight.

Not yet reviewed by a human/maintainer.

### 2026-09-12 — Literature & Prior Art applied

Per the financial-spec-writing-process: re-verified three of this
document's own citations (AP's input-VAT-own-account quote, AP's
no-precedent-for-mapping quote, #5663's `documentType` enum) directly
against source — all exact, no corrections. Closed a real gap: this
document uses "receivable control account" four times with no citation
anywhere — added Kieso Ch.7 "Cash and Receivables," p.7-12, footnote 5
(more directly on-point than the general Ch.3 definition, since it
names accounts *receivable* specifically) and Ustawa o rachunkowości
art. 13/16, both already verified in `financial-module-knowledge-base.md`.
Compared against ERPNext (docs.frappe.io — GL posting happens
automatically on Sales Invoice submission, not a separate command;
`SalesInvoiceGlPosting` here substitutes for the idempotency guarantee
Frappe's own `docstatus` gives ERPNext for free). Odoo not
independently re-verified this pass. Findings recorded in full in
`financial-module-knowledge-base.md` §3.

### 2026-09-14 — External review (PR #6046) addressed: two blockers, one major, four minors, four nits

`om-auto-review-pr` (@pkarw) found 2 blockers, 2 majors, 4 minors, 4
nits and returned the PR for a next pass. Deliberately did not
autofix the blockers or M1 on a carry-forward branch (the review's
own carve-out for architecture decisions) — worked through them with
the maintainer first, then applied:

- **B1 (blocker) — fixed.** "The debit and credit sides balance by
  construction" was false: independently re-verified directly against
  `sales/commands/documents.ts:9030-9048` and
  `sales/data/validators.ts:938-946` that `sales.invoices.create`/
  `.update` write every header total straight from caller input, with
  no `calculateDocumentTotals` call and no `.superRefine` tying totals
  to line sums — so `grandTotalGrossAmount` can silently disagree with
  Σ(lines) for reasons far more common than a header discount alone.
  Replaced the narrower `discountTotalAmount === 0` guard with an
  explicit `grandTotalGrossAmount === Σ(line.totalNetAmount) +
  Σ(line.taxAmount)` precondition (decimal-safe comparison, not a bare
  `===` — folds in m1), the same invariant Accounts Payable enforces
  at invoice-creation time, checked here at posting time instead since
  this module doesn't own invoice creation. Updated: Design decisions,
  Commands, Testing Strategy, Out of scope.
- **B2 (blocker) — fixed.** The design had no reachable entry point
  for the module's only mutation — Backend Pages described a
  `useGuardedMutation` HTTP call that API Contracts said didn't exist.
  Added `POST /api/sales-invoices-gl-posting/postings/:salesInvoiceId/post`,
  a custom write route mapped to `update`, mirroring Accounts
  Payable's own `.../invoices/:id/post`. Updated: API Contracts,
  Backend Pages, File Manifest, Implementation Plan, Compliance
  Matrix, Internal Consistency Check.
- **M1 (major) — not fixed, deliberately.** `SalesLineKind` includes
  `discount`/`shipping`/`adjustment`, and a `discount` line's positive
  `totalNetAmount` would be credited to a revenue account exactly like
  a product line, inflating revenue. B1's balance-identity check does
  not catch this (a mis-categorized line can still sum correctly) —
  it needs its own architecture decision (a contra-revenue account,
  or a Phase-1 rejection of non-product/service lines) that this pass
  does not make. Left for a separate, dedicated decision.
- **M2 (major) — separately tracked.** Every `Related:` link and the
  `requires` array name modules/documents genuinely unmerged
  (`#5663`, `#5962`, `#5955`) — a real merge-ordering question for the
  maintainer, out of scope for this pass.
- **m1 — folded into B1** (decimal-safe comparison, not bare `===`,
  on the new balance-identity check).
- **m2 — fixed.** Added `deletedAt: null` to the Commands read of
  `SalesInvoice`/`SalesInvoiceLine`; named the remaining open question
  (a soft-delete *after* posting) explicitly in Risks rather than
  silently resolving it.
- **m3 — fixed.** Both unique indexes (Data Models) now include
  `tenant_id` alongside `organization_id`, matching
  `currencies_code_scope_unique` and every other comparable
  scoped-uniqueness constraint in the repo.
- **m4 — fixed.** Reworded the `packages/events/AGENTS.md` Compliance
  Matrix row: "no direct cross-module *service* calls", with the
  sanctioned hard-dependency direct-entity-read pattern named
  explicitly rather than left to read as a contradiction.
- **n1 — fixed.** Module id renamed `sales_invoice_gl_posting` →
  `sales_invoices_gl_posting` (plural, per root AGENTS.md → 
  Conventions), cascaded through the permission scope, both API route
  paths, module metadata, `setup.ts`, and every citing sentence. The
  entity/table name `sales_invoice_gl_posting` (singular — one row per
  posting) is intentionally unchanged; it names a table, not the
  module.
- **n2 — fixed.** File Manifest now states its base path explicitly
  (`packages/core/src/modules/sales_invoices_gl_posting/`).
- **n3 — fixed.** Cross-module integration now cites the real
  mechanism (`packages/core/AGENTS.md` → Cross-Module Coupling's
  per-module local `tryResolve` helper, precedent
  `inbox_ops/subscribers/extractionWorker.ts`) instead of a
  non-existent `ctx.container.tryResolve(...)` call.
- **n4 — fixed.** Removed both dangling `(`docs/fixed-assets`)`
  pseudo-paths (Final Compliance Report intro, Changelog) — the
  branch is real but isn't a resolvable path in this document's own
  tree, and the sentence needs no path to make its point.

Not yet re-reviewed by `om-auto-review-pr`.

### 2026-09-14 (cont.) — M1 resolved: literature-grounded
line-kind scope

Revisited M1 the same day after checking it against real literature
instead of leaving it as an open architecture question. Kieso's
*Intermediate Accounting* (Ch.7, "Cash and Receivables,"
pp.7-9–7-11, verified directly against the PDF) distinguishes three
genuinely different things a `discount` line could mean — a trade
discount (never a separate line at all), a settlement discount
(booked only at payment, not at invoice posting), or an invoice-time
allowance (the one case Kieso explicitly calls a contra revenue
account) — and `sales`'s own `SalesLineKind` doesn't distinguish
which. Fowler's *Analysis Patterns* (§6.4, "Memo Account," p.104)
confirmed the contra-account pattern itself is legitimate but
doesn't resolve which of the three applies here. Hay's *Data Model
Patterns* has nothing on this anywhere in the book (checked
directly, full text). Since two of the three meanings would be
wrong to post in this module at all, **M1 (major) — fixed**:
`postSalesInvoiceToLedger` now rejects any invoice containing a
`discount` or `adjustment` line (same undefined-semantics problem)
rather than guessing, matching this document's existing "rejects
rather than guesses" stance from B1. `shipping` is unaffected —
unambiguous revenue, posted as before. Updated: Design decisions
(new "Line-kind scope" decision), Commands, API Contracts (new 422
cause), Testing Strategy, Out of Scope.
