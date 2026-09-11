# Cash & Bank Management (Bank Statement Reconciliation & Settlement)

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(#5663 — `postJournalEntry`; `JournalEntry.currencyId`/`exchangeRate`
as the transactional-FX primitive; its own Out of scope note that a
realized-FX-gain/loss *line* is supported by a normal balanced posting
but never computed by the engine itself), [Accounts Payable
payments](2026-09-06-accounts-payable-payments.md) (#5962,
`docs/accounts-payable` — `PaymentBatch.bankAccountId` is a named,
currently-unresolvable FK to "a future Bank Management entity", and
`accounts_payable_payments.defaultCashAccountId` is an explicitly
temporary fallback for the same gap), [Sales Invoice GL
Posting](2026-08-18-sales-invoice-gl-posting.md) (#6046 — owns
`sales.payments.create`'s only accounting-side caller once this
document exists; see Design decisions), [Contractor
Registry](2026-09-06-contractor-registry.md) (`ContractorBankAccount`
— the *vendor's* bank account, a distinct concept from this
document's `BankAccount`, which is the tenant's own account — see
Design decisions), Event Storming record (`Claude
outputs/eventstormingfinal.md`, workshop 2026-09-05, Iteo Katowice,
facylitator Mariusz Gil, ekspert domenowy Mateusz Duda) — the
validated scope this document follows, narrower than SPEC-024's own
"Cash & Bank Management" epic (see TLDR and the Skeleton/Open
Questions this draft resolves, recorded in the Changelog).

## TLDR

Owns the tenant's own bank accounts — the entity
`PaymentBatch.bankAccountId` was always meant to resolve against, per
Accounts Payable payments' own dangling-FK note (wiring that FK to a
real row is a named follow-up, see Design decisions and Out of scope,
not something this document alone finishes) — and the manual
bank-statement-to-invoice reconciliation flow the Event Storming
workshop actually asked for: import (Phase 1: manual entry) a bank
statement, match each line against an open `PaymentBatch` (Accounts
Payable's outgoing-payment unit) or `SalesInvoice`, compute the
realized (transactional) foreign-exchange gain/loss when the matched
amount was booked in a different currency or at a different rate, and
post one balanced `JournalEntry` — but only for the `SalesInvoice`
case (see Design decisions for why an Accounts Payable match posts
nothing new). A matched `SalesInvoice` line emits an event so
`sales_invoice_gl_posting` can record the payment against `sales`
(the only accounting-side path that actually needs one — Accounts
Payable already settles at `markPaymentBatchSent` time, so its side of
matching is a confirmation/audit function, not a settlement trigger).
Deliberately excludes three things SPEC-024's own "Cash & Bank
Management" epic asks for but the actual workshop with the domain
expert never discussed: dunning/interest (its own, separately decided
future document), cash-flow forecasting/liquidity planning (the
workshop only ever has Cash Flow as a report fed by `#6013`'s ZSiO),
and payment *initiation* (already Accounts Payable's job, via
`PaymentBatch`).

## Overview

Two real gaps exist today, both already named by sibling documents
rather than invented here. First, `accounts_payable_payments.PaymentBatch.bankAccountId`
is a FK to an entity that doesn't exist — that document's own
`defaultCashAccountId` config is an explicitly temporary fallback,
"to be removed once a real bank-account-to-ledger-account mapping
exists." Second, `sales.payments.create` is a real, shipped command
(`packages/core/src/modules/sales/commands/payments.ts`,
`POST /api/sales/payments`) that records a payment against a
`SalesOrder`/`SalesInvoice` and updates `outstandingAmount`/
`paidTotalAmount` — but nothing today calls it automatically when a
customer pays directly into the tenant's bank account rather than
through any flow `sales` itself initiates. This document supplies the
entity the first gap needs (`BankAccount`) and is the trigger that
turns "money arrived in the bank" into a real `sales.payments.create`
call for the second — actually wiring `accounts_payable_payments`'s
own validators/config to this module's `BankAccount` is a small,
explicitly named follow-up (see Design decisions, Out of scope), the
same shape as the `sales_invoice_gl_posting` subscriber this document
also specifies but doesn't itself implement.

It is not a general ledger reporting tool, a cash-flow forecaster, or
a payment-initiation system — `sales`/`accounts_payable_payments`
already own invoicing and outgoing payments respectively; this
document's only job is reconciling what the bank says actually
happened against what those modules expect, and recording the one
settlement path (incoming customer payments) that has no other home.

## Problem Statement

Three things are true without this module:

1. **Incoming customer payments leave no trace.** `sales.payments.create`
   exists, but nothing calls it when a customer pays by bank transfer
   directly into the tenant's account — an accountant would have to
   notice the bank balance changed and manually record a payment,
   with no reconciled link back to a specific bank transaction.
2. **Nothing confirms an outgoing payment actually happened as
   expected.** `accounts_payable_payments.markPaymentBatchSent` posts
   the vendor-liability-clearing `JournalEntry` the moment a batch is
   marked `SENT` — before any bank confirmation exists. If the real
   transfer fails, is short by a bank fee, or never arrives, nothing
   today catches that; the books already show it as paid.
3. **Realized FX gain/loss is never computed anywhere.** `SalesInvoice`/
   `VendorInvoice` can be booked in a foreign currency
   (`SalesInvoice.currencyCode`, `VendorInvoice.currencyId`); if the
   bank settles at a different day's rate than the invoice was booked
   at, `ledger`'s own Out of scope confirms the engine supports
   posting a realized-gain/loss *line* but computes nothing itself —
   today, nobody does.

## Proposed Solution

A `BankAccount` entity (one row per tenant bank account, one currency
per row — see Design decisions) is the row `PaymentBatch.bankAccountId`
resolves against once AP payments is wired to it (a named follow-up,
see Design decisions). A manually-entered `BankStatement` (one per
import) and its `BankStatementLine`s (Phase 1: an accountant types in
date/amount/description per line, plus an opening and closing
balance) represent what the bank actually reports. A single command,
`matchBankStatementLine`, lets an accountant pair one statement line
with either an open `PaymentBatch` (the outgoing-payment unit
Accounts Payable already posts and sends as one wire transfer — not
an individual `VendorInvoice`, since a batch, not a single invoice, is
what actually appears as one bank-statement line) or an open
`SalesInvoice`; mark it `INTERNAL_TRANSFER`; or, for a line that
matches no document at all (a bank fee, bank-collected interest),
`MANUAL_GL_ENTRY` against a directly-picked `LedgerAccount`. The
`PaymentBatch`/`SalesInvoice` pair do fundamentally different
accounting work, by design (see Design
decisions): a `PaymentBatch` match posts **nothing new** — Accounts
Payable already posted the full liability-clearing entry at
`markPaymentBatchSent` time, so this is a confirmation/audit record,
optionally flagging an amount mismatch against `PaymentBatch.total_amount`.
A `SalesInvoice` match is genuinely new money nobody has recorded yet,
and models only an incoming payment (a customer paying the tenant — an
outgoing line matched to a `SalesInvoice` is rejected, see Commands,
Out of scope): this command computes the realized gain/loss (if the
settled amount's currency or rate differs from the invoice's own
booked rate) and posts one balanced `JournalEntry` itself (bank
account debit, `sales_invoice_gl_posting`'s own `receivableAccountId`
credit, plus a gain/loss line when non-zero), then emits
`cash_bank_management.statement_line.matched` so
`sales_invoice_gl_posting`'s own subscriber can call
`commandBus.execute('sales.payments.create', ...)` and keep `sales`'s
`outstandingAmount`/`paidTotalAmount` correct — a `sales`-side
bookkeeping update, not a second `ledger` posting. `INTERNAL_TRANSFER`
is one of two match types that can go either direction (debit or
credit the bank account, following the line's own sign) — it also
posts, but against a configured suspense account rather than a
document's control account (see Commands). The fourth type,
`MANUAL_GL_ENTRY` (added after a literature check, see Design
decisions), covers the other case every real bank statement contains
that isn't a document match at all: an ordinary bank fee or
bank-collected interest, posted against whichever `LedgerAccount` the
accountant picks directly rather than one resolved from a matched
document.

## Design Decisions

**`BankAccount`: one currency per row, not multi-currency accounts.**
Resolved via Open Question Q1. A real bank account can technically
hold multiple currencies, but nothing in the Event Storming record
asked for that, and `VendorInvoice`/`SalesInvoice` are both already
single-currency-per-document (`currencyId`/`currencyCode`) — a
`BankAccount` row per currency (e.g. two rows for the same physical
mBank account, one PLN and one EUR) keeps every statement line's
currency unambiguously the account's own currency (`BankStatementLine`
itself carries no `currencyId` — it inherits its parent `BankAccount`'s,
see Architecture → Entities) and needs no new multi-currency-per-entity
concept anywhere else in this document family. A tenant with a
genuinely multi-currency physical account models it as separate
`BankAccount` rows sharing the same `accountNumber`/IBAN — an explicit,
named simplification, not an oversight.

**Settlement mechanism, corrected after review: this module posts the
`SalesInvoice` side's `JournalEntry` itself; a `PaymentBatch` match
posts nothing.** Resolved via Open Question Q2, then corrected during
this document's own adversarial review (see Final Compliance Report,
Changelog) — the first draft tried to have both match types post
against a shared "clearing account" that nothing ever zeroed out, and
contradicted itself about whether this module posts the counterparty
leg at all. The corrected design, per match type:
- **`PaymentBatch` match** (Accounts Payable): posts **nothing** to
  `ledger`. `accounts_payable_payments.markPaymentBatchSent` already
  posted the full liability-clearing entry when the batch was marked
  `SENT`, before any bank statement existed — matching the resulting
  line is a confirmation/audit record (see next decision), not a
  second write.
- **`SalesInvoice` match** (Accounts Receivable): this is genuinely
  new money nobody has recorded. This module posts one balanced
  `JournalEntry` itself — debit `BankAccount.ledgerAccountId`, credit
  `sales_invoice_gl_posting`'s own `receivableAccountId` (read via a
  scoped `ModuleConfigService` call, the same soft cross-module-config
  read `accounts_payable_payments` already uses for
  `accounts_payable.liabilityAccountId` — no hard `requires` needed for
  a read), plus a gain/loss line when the settled amount's currency or
  rate differs from the invoice's own. It then emits
  `cash_bank_management.statement_line.matched` purely so
  `sales_invoice_gl_posting`'s own subscriber can call
  `commandBus.execute('sales.payments.create', ...)` — a `sales`-side
  bookkeeping update (`outstandingAmount`/`paidTotalAmount`), not
  another `ledger` posting. No event is emitted for a `PaymentBatch`
  or `internal_transfer` match — there is no Phase 1 consumer for
  either, and promising a payload nobody consumes was itself a defect
  in the first draft.

This still avoids a hard `requires` on `sales`/`accounts_payable_payments`:
reading a sibling module's `ModuleConfigService` value and emitting an
event are both softer than the rejected alternative of calling
`commandBus.execute('sales.payments.create', ...)` directly from this
module (see Alternatives Considered) — this module still never
imports or resolves either module's services.

**A `PaymentBatch` match is a confirmation/audit function, not a
settlement trigger — the real asymmetry the Event Storming wall's
"Rozliczenie należności" / "Rozliczyć zobowiązanie" pairing obscures by
listing them side by side.** `accounts_payable_payments.markPaymentBatchSent`
posts the vendor-liability-clearing `JournalEntry` the moment a batch
is marked `SENT` — from the books' point of view, the vendor invoices
in that batch are *already* settled before any bank statement exists.
Matching the resulting bank line back to that `PaymentBatch` (not to
an individual `VendorInvoice` — a batch, not a single invoice, is what
actually appears as one line on a real bank statement) therefore only
needs to confirm the amount that actually left the account matches
`PaymentBatch.total_amount`; a mismatch is recorded on the match itself
(`amountMismatch: true`, surfaced to the UI, see Commands) rather than
silently accepted or blocked — a Risk (see Risks & Impact Review), not
a missing write. `sales`, by contrast, has no equivalent "we already
posted it" moment for an *incoming* payment: a customer paying
directly into the tenant's bank account is invisible to `sales` until
something calls `sales.payments.create`, and this module's own posting
plus emitted event is the only thing that ever will make that happen.
Building an `accounts_payable_payments` subscriber for confirmation-only
value beyond the mismatch flag above is explicitly deferred (see Out of
scope) rather than folded into Phase 1 of a document already scoped
narrowly per the workshop.

**Phase 1 import method: manual entry, not automated parsing.**
Resolved via Open Question Q3. SPEC-024 asks for MT940/CAMT/BAI2
import as a country-specific plugin, but the Event Storming record
never discusses statement formats at all — only "zaimportowano/
pobrano wyciąg bankowy" as a single domain event, with no format
detail. Matching this project's own "manual first, automation later"
phasing (Accounts Payable's manual account mapping, Fixed Assets'
manual depreciation trigger), Phase 1's `createBankStatement` command
takes a hand-entered opening balance, closing balance, and an array of
lines (date, amount, description) — no file parser, no format
plugin. Automated import is a named Phase 2 (see Out of scope).

**This module computes the realized FX gain/loss, on the settled
amount only — never the invoice's full gross total.** Resolved via
Open Question Q4, then corrected during review: the first draft's
formula compared the statement line against the matched
`SalesInvoice`'s full `grandTotalGrossAmount`, which silently
misstates every partial payment. `sales` already supports partial/
multi-payment settlement natively (`SalesInvoice.outstandingAmount`/
`paidTotalAmount`, plus `SalesPayment`'s own allocation to specific
documents/amounts) — a customer paying a foreign-currency invoice in
two installments must have each installment's gain/loss computed
against *that installment's own amount*, not the invoice total. The
corrected formula: `gainLoss = statementLineAmountInBankCurrency -
(matchedAmountInInvoiceCurrency * bookedExchangeRate)`, where
`matchedAmountInInvoiceCurrency` is the portion of the invoice this
specific statement line settles (equal to the full outstanding amount
only when it is paid in one line). `ledger`'s own Out of scope
confirms `JournalEntry.currencyId`/`exchangeRate` support "a normal
balanced posting with a realized-FX-gain/loss line" as a primitive,
but the engine itself never computes the figure — it only accepts
whatever lines a caller constructs, which is why this module owns the
calculation.

**`bookedExchangeRate` is required whenever the matched invoice's
currency differs from the `BankAccount`'s own — never silently
defaulted.** Corrected during review: the first draft left this input
optional with no stated rejection behavior, which would have let a
genuine foreign-currency match silently skip the gain/loss calculation
entirely (an implicit, wrong 1:1 rate) if the field were omitted.
Confirmed: neither `VendorInvoice` nor `SalesInvoice` stores a
booking-date exchange rate today (checked directly against both
sibling documents' Data Models — `VendorInvoice` has `currencyId`
only, `SalesInvoice` has `currencyCode` only, neither has
`exchangeRate`, unlike `SalesOrder.exchangeRate`) — Phase 1 therefore
requires the accountant to enter the invoice's original booking-date
rate manually at match time when currencies differ, and
`matchBankStatementLine` rejects with a readable error if it's
omitted in that case (see Commands, Testing Strategy), rather than
inventing a historical-rate lookup this document has no source for.

**`BankAccount` is a distinct concept from `contractors.ContractorBankAccount`
— the tenant's own account, not a vendor's.** `ContractorBankAccount`
(Contractor Registry, already used by
`accounts_payable_payments.PaymentBatchLine.contractorBankAccountId`)
is the account *money is sent to* — a vendor's. This document's
`BankAccount` is the account money is sent *from* or *received into*
— the tenant's own. The two never reference each other; a
`PaymentBatch` carries both FK-ids independently (`bankAccountId`
resolving here, `contractorBankAccountId` resolving to `contractors`).

**Manual matching only in Phase 1 — no auto-matching rules.** A
natural Phase 2 (rule-based matching by amount/reference/vendor),
deliberately deferred: the workshop's own domain events name
"Wykonano rekoncyliację/uzgodnienie" as one step with no rule detail,
and every other document in this family defers its "engine"/automation
half to a later phase behind a working manual slice first (see Out of
scope).

**No new subsidiary ledger for bank balances.** `BankAccount`'s own
running balance is derived, not stored redundantly: it equals its
linked `LedgerAccount`'s ledger balance (via `#6013`'s balance
calculation), reconciled against the latest `BankStatement.closingBalance`
by the `reconcileBankAccount` read (see Testing Strategy, Invariants)
— the same "control account, no duplicate ledger" discipline this
family already applies elsewhere (e.g. `sales-invoice-gl-posting`'s
own "no new subsidiary ledger" decision).

**Grounded in the literature, not just internal convention: Fowler's
Corresponding Account (*Analysis Patterns*, 6.13, p.124).** Verified
directly against the primary text (not recalled or taken from this
project's own knowledge-base summary at face value): Fowler describes
exactly this module's core mechanic — "I have a checking account that
is an asset within my personal system of accounts. The bank has an
account within its system of accounts that looks remarkably similar,"
posted possibly on different dates (his example: an ATM withdrawal I
post on March 1, the bank posts on March 2), the two considered
"corresponding" rather than "the same account," reconciled by a
process that "may be precise, or it may allow some imprecision, such
as slight differences in dates." That is precisely
`BankStatementLine` (the bank's own corresponding account, arriving as
a statement) reconciled against `BankAccount.ledgerAccountId` (this
tenant's own book) via `matchBankStatementLine` — the first real
Tier-3 literature citation this document has, added after this
revision's literature-verification pass (earlier revisions cited
nothing external). Not a compliance-authority citation (see the
knowledge base's own source-tier ranking) — it validates *how to
model* the reconciliation relationship, not *what's compliant*.

**A fourth match type, `manual_gl_entry`, added after a literature
check surfaced a real Phase 1 gap: Kieso, *Intermediate Accounting*
17th Ed., Appendix 7A ("Reconciliation of Bank Balances," p.7-33–7-35).**
Verified directly against the primary text. Kieso's own standard bank
reconciliation identifies five categories of reconciling item: (1)
deposits in transit, (2) outstanding checks, (3) bank charges, (4)
bank credits/collections (e.g. interest the bank collected on the
depositor's behalf), and (5) bank/depositor errors. Only (3), (4), and
error corrections attributable to the depositor's own books (part of
(5)) — things the *bank* already knows about that the *company's
books* don't yet — require an adjusting entry; the pure timing
differences, (1) and (2), require none, since the books are already
correct and only waiting on the bank to catch up. `manual_gl_entry`
specifically closes the gap for (3) and (4) — a bank fee or
bank-collected interest — since (1)/(2) need no posting at all and (5)
is a correction to an existing entry, not a new match type. Before this
revision, this document's
`matchedDocumentType` enum had no path for an ordinary bank fee or
bank-collected interest at all — every one of its three original match
types (`sales_invoice`, `payment_batch`, `internal_transfer`) assumes a
pre-existing document or transfer, and a bank fee has neither. Since
every real bank statement contains this category of line, its absence
was a real, material gap, not a hypothetical one — caught by checking
a canonical accounting textbook against the spec's own claimed
completeness, exactly the discipline this project's citation-check
convention exists for. `manual_gl_entry` closes it: the accountant
picks the offsetting `LedgerAccount` directly (there is no document to
resolve one from), and the command posts a normal two-line entry
against it (see Commands). Kieso's own "clearing account" usage
(imprest bank accounts, p.7-33; the `Income Summary` clearing account
elsewhere in the same book) describes a different concept in both
cases — a dedicated bank account for a specific disbursement purpose,
and a temporary period-close account — neither is the shared
reconciliation clearing account this document's own earlier draft
proposed and rejected (see Alternatives Considered); Kieso's text
offers no support for that rejected design either, reinforcing the
correction rather than complicating it.

**Hay's *Data Model Patterns* checked and found not applicable to bank
reconciliation.** Verified directly: the word "reconcil-" does not
appear anywhere in the 277-page book. Its one bank-related pattern
(Figure 4.17, "The Bank Version," p.66, extended in ch.12, p.250)
models a **bank's own product catalog** — `ACCOUNT`/`ACCOUNT TYPE`
with variable `PARAMETER`s (interest rate, minimum balance) per
product type, the same generic type/attribute pattern used earlier in
the book for manufactured-goods types. That's the bank modeling what
it sells; this document's `BankAccount` is the tenant modeling an
account it holds elsewhere — a different problem, correctly not
adopted as a citation here.

## User Stories

- As an accountant, when a customer pays an invoice by bank transfer,
  I need to match that bank statement line to the invoice with one
  action and have `sales`'s own payment records update automatically,
  instead of manually re-entering a payment `sales` never knew about.
- As an accountant, when I match a bank statement line to the
  `PaymentBatch` I sent it for, I need to be shown immediately if the
  amount doesn't match what I sent — a wrong amount should not go
  unnoticed just because the GL already shows it as paid (Phase 1:
  flagged at match time, not continuously monitored — see Design
  decisions, Out of scope).
- As an accountant, when an invoice was booked in a foreign currency
  and settles at a different rate, I need the realized gain or loss
  posted automatically as part of the match, not calculated by hand
  outside the system.
- As a developer running `accounts_payable_payments` or
  `sales_invoice_gl_posting` in a tenant that hasn't installed this
  module, I need both to keep working exactly as today — this module
  is optional from both of their points of view (a one-way dependency;
  neither ever requires it).

## Invariants

1. **Every `BankStatementLine` is matched to at most one document (or
   none).** `matchBankStatementLine` rejects a line that already has a
   match; a second call against the same line is rejected, not
   silently re-matched. (A `SalesInvoice`, unlike a statement *line*,
   may be matched across several different lines over time — one per
   partial payment; see Design decisions.)
2. **Every posting this module makes balances.** For a `SalesInvoice`
   match: the bank-side leg, the `receivableAccountId` leg, and the
   gain/loss line (when present) always sum to zero. For an
   `internal_transfer` match: the bank-side leg and the
   `internalTransferSuspenseAccountId` leg sum to zero. For a
   `manual_gl_entry` match: the bank-side leg and the accountant-picked
   `ledgerAccountId` leg sum to zero. `ledger.postJournalEntry`'s own
   balance check enforces this independently in all three cases; this
   module never needs a redundant check of its own. (A `PaymentBatch`
   match posts nothing — see Design decisions — so this invariant does
   not apply to it.)
3. **A `BankAccount`'s ledger balance never diverges from its latest
   reconciled `BankStatement.closingBalance` without a named,
   unresolved discrepancy.** `reconcileBankAccount` (a read, not a
   command) surfaces any gap explicitly rather than hiding it.
4. **A matched `SalesInvoice` line's event fires exactly once, after
   its posting commits, never before.** `cash_bank_management.statement_line.matched`
   is emitted synchronously inside the same command, after
   `ledger.postJournalEntry` succeeds — a failed posting emits
   nothing. No event is emitted for a `PaymentBatch`, `internal_transfer`,
   or `manual_gl_entry` match (see Design decisions, Events).
5. **A locked `FiscalPeriod` rejects any match that posts (`SalesInvoice`,
   `internal_transfer`, or `manual_gl_entry`), full stop.** Same guard
   every other document in this family relies on —
   `ledger.postJournalEntry`'s own period-lock check, nothing further
   to design here. (A `PaymentBatch` match never calls
   `postJournalEntry` at all, so it is never subject to this check —
   see Design decisions.)

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|---------------|
| Automated statement import (MT940/CAMT/BAI2) in Phase 1 | Rejected: never discussed at the Event Storming workshop (Q3); this project's own "manual first" phasing applies here as everywhere else |
| Direct `commandBus.execute('sales.payments.create', ...)` call instead of an event | Rejected: would force a hard `requires` on `sales` (and, symmetrically, `accounts_payable_payments`) just to reconcile a statement — a tenant should be able to use this module without either installed (Q2) |
| A single shared "clearing account" both match types post against | Rejected during review: nothing was ever designed to zero it for a `PaymentBatch` match (Accounts Payable already posted the real cash movement at send time), so it would accumulate a permanent, unreconciled balance while double-recording the same cash movement — see Design decisions, Changelog |
| Matching against an individual `VendorInvoice` instead of its `PaymentBatch` | Rejected: a `PaymentBatch`, not a single invoice, is what actually appears as one line on a real bank statement (a batch groups invoices into one wire transfer) — matching per-invoice would need an extra, undocumented aggregation step this module has no reason to own |
| Fold dunning/interest into this document (it's adjacent on the Event Storming wall) | Rejected 2026-09-10, already decided: interest/dunning runs entirely off `sales.SalesInvoice`'s own due date and `outstandingAmount`, with no dependency on a bank statement existing — its own, separate future document |
| Fold Cash Flow forecasting / liquidity planning into this document (SPEC-024's framing) | Rejected: the workshop only ever has Cash Flow as a report fed by `#6013`'s ZSiO, never as a forecasting feature; no domain event on the wall asks for it |
| A historical exchange-rate lookup service, computing FX gain/loss automatically | Rejected for Phase 1: neither `VendorInvoice` nor `SalesInvoice` stores a booking-date rate today: manual rate entry at match time is the honest Phase 1 answer (see Design decisions) |
| An `accounts_payable_payments` subscriber mirroring the `sales_invoice_gl_posting` one | Deferred, not rejected outright: Accounts Payable already settles at `markPaymentBatchSent` time, so a subscriber here would only add confirmation/audit value, not a missing write (see Out of scope) |
| Leave bank fees/interest to a manual `PK` (Polecenie Księgowania) entry outside this module, since Phase 1's original three match types didn't cover them | Rejected after a literature check (Kieso Appendix 7A — see Design decisions): every real bank statement contains this category of line, and requiring the accountant to leave the reconciling module to record it defeats the point of matching a statement inside `cash_bank_management` in the first place — added `manual_gl_entry` as a fourth match type instead |

## Architecture

### Entities (`data/entities.ts`)

- `BankAccount` — `accountNumber` (text, IBAN or local format),
  `currencyId` (FK-id to `currencies.Currency`), `ledgerAccountId`
  (FK-id to `ledger.LedgerAccount` — the GL posting target, e.g. the
  workshop's own `130-1 mBank` example), `label` (text, e.g. "mBank
  PLN"), `isActive` (boolean), tenant/org-scoped, `updatedAt`/
  `deletedAt` (user-editable master data, unlike this document's other
  two entities).
- `BankStatement` — `bankAccountId` (FK-id), `statementDate`,
  `openingBalance`, `closingBalance` (numeric(19,4)), tenant/org-scoped,
  `createdAt`. No `updatedAt`: once created, a statement's own header
  is immutable (a correction is a new statement, not an edit — see Out
  of scope); its lines can still be matched over time (see below).
- `BankStatementLine` — `bankStatementId` (FK), `lineDate`, `amount`
  (numeric(19,4), signed — positive for incoming, negative for
  outgoing), `description` (text), `matchedDocumentType` (nullable
  enum: `sales_invoice` / `payment_batch` / `internal_transfer` /
  `manual_gl_entry` — corrected after review: the AP-side match target
  is a `PaymentBatch`, not an individual `VendorInvoice`, since a batch
  is what actually appears as one line on a real bank statement, see
  Design decisions; `manual_gl_entry` added after a literature check
  against Kieso's own bank-reconciliation treatment surfaced a real
  Phase 1 gap — see Design decisions, Commands), `matchedDocumentId`
  (nullable uuid, FK-id — no ORM relation, meaning depends on
  `matchedDocumentType`; `null` for `internal_transfer` and
  `manual_gl_entry`, neither of which has a matched document, only a
  posted entry), `matchedLedgerAccountId` (nullable FK-id to
  `ledger.LedgerAccount` — set only for `manual_gl_entry`, the one
  path where the accountant picks the offsetting account directly
  rather than it being resolved from a matched document; `null`
  otherwise), `matchedJournalEntryId` (nullable FK-id to
  `ledger.JournalEntry` — set for every path that actually posts
  (`sales_invoice`, `internal_transfer`, `manual_gl_entry`); stays
  `null` only for `payment_batch`, which posts nothing — corrected
  after review, an earlier revision's wording incorrectly lumped
  `internal_transfer` in with `payment_batch`'s non-posting case, which
  would have left an `internal_transfer` posting with no recorded
  back-reference to its own `JournalEntry`, see Commands),
  `amountMismatch` (nullable boolean, default `null` until matched —
  added after review: set only on a `payment_batch` match, `true` when
  the statement line's absolute amount differs from
  `PaymentBatch.total_amount`, `false` when it agrees; stays `null` for
  `sales_invoice`/`internal_transfer`/`manual_gl_entry` matches, where
  no comparable "expected amount" exists), `matchedAt` (nullable timestamp),
  tenant/org-scoped, `createdAt`. No `updatedAt`: a line is written
  once (unmatched) and matched at most once (Invariant 1) — a
  correction reverses the `JournalEntry` (when one exists) and creates
  a new line, not an edit (see Out of scope).

### Access Control (`acl.ts`)

- `cash_bank_management.accounts.manage` — required by
  `createBankAccount`/`updateBankAccount`.
- `cash_bank_management.statements.manage` — required by
  `createBankStatement`/`matchBankStatementLine`.

### Module Dependency (`index.ts`)

```typescript
export const metadata: ModuleInfo = {
  name: 'cash_bank_management',
  title: 'Cash & Bank Management',
  version: '0.1.0',
  description:
    'Bank account master data and manual bank-statement reconciliation against Accounts Payable and Accounts Receivable.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger', 'currencies'],
  ejectable: true,
}
```

`sales`/`accounts_payable`/`accounts_payable_payments` are never
imported or resolved by this module — it only reads `PaymentBatch`/
`SalesInvoice` far enough to validate a match target exists (see
Cross-module integration) and, for a `sales_invoice` match, to read a
sibling module's `ModuleConfigService` value; it never hard-depends on
either.

### Encryption (`encryption.ts`)

```typescript
export const defaultEncryptionMaps = {
  BankAccount: ['accountNumber'],
}
```

`BankAccount.accountNumber` (an IBAN) is declared encrypted from the
start, not deferred to implementation time — the same precedent
`contractors.ContractorBankAccount` (Contractor Registry) already sets
for a structurally identical field (a bank account number belonging to
a party the tenant transacts with). Read exclusively via
`findWithDecryption`, per `packages/core/AGENTS.md` → Encryption;
`createBankAccount`/`updateBankAccount` write it through the same
encrypted-field path.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: [
    'cash_bank_management.accounts.manage',
    'cash_bank_management.statements.manage',
  ],
}
```

No seed data — chart-of-accounts/bank-account mapping is tenant-specific.

### Commands (Command Pattern, `commands/`)

- `createBankAccount` — input `{ accountNumber, currencyId, ledgerAccountId, label }`.
  Validates `currencyId`/`ledgerAccountId` resolve to real rows.
  Requires `cash_bank_management.accounts.manage`.
- `createBankStatement` — input
  `{ bankAccountId, statementDate, openingBalance, closingBalance, lines: { lineDate, amount, description }[] }`.
  Rejects if `bankAccountId` doesn't resolve. Persists the statement
  and its lines, all `matchedDocumentType: null`. Requires
  `cash_bank_management.statements.manage`.
- `matchBankStatementLine` — the only command that can post to
  `ledger`, and does so on three of its four paths (`payment_batch` is
  the one exception — corrected after review, see Design decisions for
  why it isn't symmetric with `sales_invoice`). Input:
  `{ bankStatementLineId, matchedDocumentType: 'sales_invoice' | 'payment_batch' | 'internal_transfer' | 'manual_gl_entry', matchedDocumentId?: string, ledgerAccountId?: string, description?: string, bookedExchangeRate?: number }`.
  Rejects if the line is already matched (Invariant 1). Branches on
  `matchedDocumentType`:
  - **`payment_batch` (confirmation/audit only, no `ledger` write).**
    Loads the target `PaymentBatch` directly via `entityManager`
    (scoped by `tenantId`/`organizationId`), validates it resolves to a
    real batch with `status: 'SENT'` (rejects otherwise — an
    unsent/draft batch has nothing to confirm against). Compares
    `Math.abs(bankStatementLine.amount)` to `PaymentBatch.total_amount`;
    sets `amountMismatch: true` when they differ (beyond a fixed
    rounding tolerance, e.g. one cent), `false` when they agree. Posts
    **nothing** to `ledger` —
    `accounts_payable_payments.markPaymentBatchSent` already posted the
    full liability-clearing entry when the batch was sent (see Design
    decisions). Persists `matchedDocumentType: 'payment_batch'`,
    `matchedDocumentId`, `amountMismatch`, `matchedAt`;
    `matchedJournalEntryId` stays `null`. No event emitted (see
    Events).
  - **`sales_invoice` (the only path that posts).** Rejects if the
    statement line is outgoing (`amount < 0`) — a `SalesInvoice` match
    models a customer paying the tenant, always incoming money, matching
    every mention of this flow in Problem Statement/User Stories; a
    refund or credit-note settlement paid back to a customer is a
    different, unmodeled flow, explicitly out of scope (see Out of
    scope) rather than silently handled with an undefined posting
    direction. Loads the target `SalesInvoice` directly via
    `entityManager` (scoped by `tenantId`/`organizationId`), validates
    it resolves to a real, non-`CANCELLED` invoice, and reads its
    `currencyCode` and `outstandingAmount` (not
    `grandTotalGrossAmount` — see Design decisions, partial-payment
    correction).

    `bookedExchangeRate` is defined as *units of the `BankAccount`'s
    own currency per 1 unit of the invoice's currency* (the same
    direction `SalesOrder.exchangeRate` already uses elsewhere in
    `sales`) — so an amount in invoice currency converts to bank
    currency by **multiplying** by `bookedExchangeRate`, and an amount
    in bank currency converts to invoice currency by **dividing** by
    it. The portion of the invoice this line settles,
    `matchedAmountInInvoiceCurrency`, is therefore the lesser of
    `outstandingAmount` and `(statementLineAmount / bookedExchangeRate)`
    (same-currency case: `bookedExchangeRate` is implicitly `1`, so
    dividing is a no-op). If the invoice's `currencyCode` differs from
    the `BankAccount`'s own `currencyId`, `bookedExchangeRate` is
    **required**; a same-currency match with a supplied
    `bookedExchangeRate` that isn't `1` is also rejected (nothing to
    convert). Missing/invalid rate → rejects with a readable
    `EXCHANGE_RATE_REQUIRED` error, no partial write (see Design
    decisions, Testing Strategy). Computes the realized gain/loss as
    `statementLineAmountInBankCurrency - (matchedAmountInInvoiceCurrency * bookedExchangeRate)`
    (the same multiplication direction, converting the settled invoice
    amount back into bank currency for comparison) and, when non-zero,
    adds a line to `gainLossAccountId` (Module Config) on whichever
    side keeps the posting balanced. Reads `sales_invoice_gl_posting`'s
    own `receivableAccountId` via a scoped
    `ModuleConfigService.get('sales_invoice_gl_posting', 'receivableAccountId', { tenantId, organizationId })`
    call (see Cross-module integration) — rejects with a readable
    configuration error if unset, rather than posting to an
    undetermined account. Calls
    `commandBus.execute('ledger.postJournalEntry', { input, ctx })`
    with: a debit to the bank account's `ledgerAccountId` (always a
    debit — the line is always incoming, per the rejection above), a
    credit line to `sales_invoice_gl_posting`'s `receivableAccountId`
    for `matchedAmountInInvoiceCurrency * bookedExchangeRate` (i.e.
    converted to the bank account's own currency), and the gain/loss
    line when present; `referenceType: 'cash_bank_management:bank_statement_line'`,
    `referenceId: bankStatementLineId` (no `type` override — defaults
    to GL's own `'NORMAL'`, the same pattern Accounts Payable's
    `postVendorInvoice` call already uses). Persists
    `matchedDocumentType: 'sales_invoice'`, `matchedDocumentId`,
    `matchedJournalEntryId`, `matchedAt` on the line in the same
    transaction; `amountMismatch` stays `null` — there is no
    independent "expected amount" to compare against, the invoice's own
    `outstandingAmount` is the source of truth. Emits
    `cash_bank_management.statement_line.matched` after the transaction
    commits.
  - **`internal_transfer`.** Posts a balanced two-line `JournalEntry` —
    the bank-account leg (debit/credit following the line's sign, same
    convention as `sales_invoice`) against a configured
    `internalTransferSuspenseAccountId` (Module Config) — with
    `referenceType: 'cash_bank_management:bank_statement_line'`,
    `referenceId: bankStatementLineId`, same as the `sales_invoice`
    path. Persists `matchedJournalEntryId` on the line (this path does
    post, unlike `payment_batch` — see Data Models, corrected after
    review), but `matchedDocumentId` stays `null` (no matched document
    of any type) and `amountMismatch` stays `null`. No event emitted —
    there is no Phase 1 consumer for an internal-transfer posting.
  - **`manual_gl_entry`** (added after a literature check against Kieso's
    own bank-reconciliation treatment — Appendix 7A, "Reconciliation of
    Bank Balances" — surfaced a real Phase 1 gap: an ordinary bank fee
    or bank-collected interest has no matched `SalesInvoice`,
    `PaymentBatch`, or internal-transfer counterpart, yet appears on
    essentially every real bank statement; see Design decisions).
    Requires `ledgerAccountId` (the offsetting account the accountant
    picks directly — no document to resolve one from) and rejects if
    it doesn't resolve to a real `LedgerAccount`; `matchedDocumentId` is
    not accepted here (there is no document). Posts a balanced two-line
    `JournalEntry` — the bank-account leg (debit/credit following the
    line's sign, same convention as `internal_transfer`: a bank charge
    is an outgoing line, bank-collected interest an incoming one)
    against the supplied `ledgerAccountId` — with
    `referenceType: 'cash_bank_management:bank_statement_line'`,
    `referenceId: bankStatementLineId`. The optional `description` input
    becomes the `JournalEntry`'s own description when supplied,
    otherwise falls back to the statement line's own `description`
    (e.g. whatever text the bank itself printed, such as "Opłata za
    prowadzenie rachunku"). Persists `matchedDocumentType:
    'manual_gl_entry'`, `matchedLedgerAccountId: ledgerAccountId`,
    `matchedJournalEntryId`, `matchedAt`; `matchedDocumentId` and
    `amountMismatch` stay `null`. No event emitted — there is no Phase 1
    consumer for a manual GL entry, the same reasoning as
    `internal_transfer`.

  Requires `cash_bank_management.statements.manage`.

### Events (`events.ts`)

- `cash_bank_management.statement_line.matched` — payload
  `{ documentType: 'sales_invoice', documentId, matchedAmount, bankAccountId, currencyId, bookedExchangeRate, matchedAt }`.
  `documentType` is fixed to the literal `'sales_invoice'` in this
  payload shape — corrected after review: a `payment_batch` match posts
  no `ledger` entry and has no `sales`-side consumer to notify (Accounts
  Payable's own state already reflects `SENT`/`amountMismatch` via the
  match record itself, read directly, not via an event); an
  `internal_transfer` match has no downstream consumer at all; and a
  `manual_gl_entry` match (added after the literature-verification
  pass, see Design decisions) is purely an internal GL posting with no
  document and, likewise, no consumer — none of the other three match
  types has anything to notify. Emitted
  only when a `sales_invoice` match's `JournalEntry` commits
  successfully. Ephemeral, in-process, no-retry — the same shape
  `ledger.journal_entry.posted` already establishes for this family. A
  consumer that needs guaranteed processing after a crash needs its own
  reconciliation sweeper, the same precedent Posting Rules Engine's
  `reconcileCostRing` already sets — not designed here since only one
  real Phase 1 consumer exists (see below).

### Cross-module integration

- **`ledger` (hard dependency).** Writes exclusively through
  `commandBus.execute('ledger.postJournalEntry', { input, ctx })`.
- **`currencies` (hard dependency).** Reads `Currency` directly to
  validate `BankAccount.currencyId` and to compare a matched
  invoice's currency against the bank account's own.
- **`sales` (read-only, scoped, no hard dependency).** Reads
  `SalesInvoice` directly (scoped by `tenantId`/`organizationId`) to
  validate a match target and read `outstandingAmount`/`currencyCode`
  during `matchBankStatementLine`'s `sales_invoice` path — the same
  direct-entity-read precedent this document family already
  establishes. Never calls `sales.payments.create` itself (see Design
  decisions) and never appears in `requires`.
- **`accounts_payable_payments` (read-only, scoped, no hard
  dependency).** Reads `PaymentBatch` directly the same way, during
  `matchBankStatementLine`'s `payment_batch` path — to validate the
  batch resolves, confirm `status: 'SENT'`, and read `total_amount` for
  the `amountMismatch` comparison. Never reads an individual
  `VendorInvoice` (see Design decisions, Alternatives Considered) and
  never appears in `requires`.
- **`sales_invoice_gl_posting` (read-only `ModuleConfigService` read,
  no hard dependency).** Reads that module's own `receivableAccountId`
  Module Config value during the `sales_invoice` path — the same soft,
  scoped cross-module-config read `accounts_payable_payments` already
  uses for `accounts_payable.liabilityAccountId` (see Design
  decisions). Also the one real Phase 1 event consumer, but owned by
  that module, not this one: it subscribes to
  `cash_bank_management.statement_line.matched` and calls
  `commandBus.execute('sales.payments.create', { input, ctx })`. This
  document does not implement that subscriber — it is a follow-up
  change to `sales_invoice_gl_posting`'s own spec, out of this
  document's own file boundary (see Out of scope, Risks).
- **This module is never imported or resolved by `ledger`, `currencies`,
  `sales`, `accounts_payable`, `accounts_payable_payments`, or
  `sales_invoice_gl_posting`.** One-way dependency direction, matching
  `packages/core/AGENTS.md`.

### Backend Pages

Two pages, both owned by this module (added this revision — the prior
draft deferred this detail rather than designing it):

- **`backend/accounts/page.tsx`** — a bank-account list/settings page.
  List view uses `<DataTable>` (stable `entityId: 'cash_bank_management:bank_account'`)
  with columns for `label`, `accountNumber` (masked — see Encryption;
  full value never rendered in the list), `currencyId`, `ledgerAccountId`,
  and an `isActive` `<StatusBadge>` (semantic tokens —
  `bg-status-success-bg`/`bg-status-neutral-bg`, never `bg-green-*`).
  Create/edit is a `<CrudForm>` (`@open-mercato/ui/backend/CrudForm`)
  with `<FormField>`-wrapped inputs: a text field for `accountNumber`, a
  `Currency` picker for `currencyId`, a `LedgerAccount` picker for
  `ledgerAccountId`, a text field for `label`. All labels, placeholders,
  and validation errors go through `useT()` (client) /
  `resolveTranslations()` (server) — no hard-coded strings, matching
  every sibling module in this family.
- **`backend/statements/page.tsx`** — statement entry + line matching.
  Statement creation is a `<CrudForm>` with a `BankAccount` picker,
  `statementDate`, `openingBalance`/`closingBalance` numeric fields, and
  a repeatable line-entry section (`lineDate`/`amount`/`description`
  per row) — a custom, non-`CrudForm` sub-widget for the repeatable
  rows, since `CrudForm` itself has no first-class array-of-rows input;
  its own add/remove-row actions go through `useGuardedMutation` only
  where they call `createBankStatement` (client-side row add/remove
  before submit is local state, not a mutation). The line list for an
  existing statement uses `<DataTable>`
  (`entityId: 'cash_bank_management:bank_statement_line'`) with a
  `<StatusBadge>` per line for match state (unmatched / matched /
  `amountMismatch` — a distinct warning-tone badge, semantic tokens
  only) and a row action opening the match dialog. The match dialog is
  a small custom form (document-type selector, then conditionally: a
  document-id lookup for `sales_invoice`/`payment_batch`, a
  `bookedExchangeRate` field shown only when the picked document's
  currency differs from the `BankAccount`'s own, or — for the added
  `manual_gl_entry` type — a `LedgerAccount` picker plus an optional
  free-text description field, in place of any document lookup)
  submitted via `useGuardedMutation(...).runMutation(...)` against
  `matchBankStatementLine` (not `CrudForm` — this is a domain action,
  not a plain entity edit), honoring the `Cmd/Ctrl+Enter` submit /
  `Escape` cancel convention and an `aria-label` on its icon-only close
  control. All reads go through `apiCall`/`apiCallOrThrow` (never raw
  `fetch`); all labels/errors (including the `EXCHANGE_RATE_REQUIRED`
  and `amountMismatch` messaging) go through `useT()`/
  `resolveTranslations()`.

## Data Models

```typescript
BankAccount {
  id: uuid
  tenantId: uuid
  organizationId: uuid
  accountNumber: text        // IBAN or local format
  currencyId: uuid           // FK-id to currencies.Currency
  ledgerAccountId: uuid      // FK-id to ledger.LedgerAccount
  label: text
  isActive: boolean
  createdAt: timestamp
  updatedAt: timestamp | null
  deletedAt: timestamp | null
}

BankStatement {
  id: uuid
  tenantId: uuid
  organizationId: uuid
  bankAccountId: uuid        // FK-id to BankAccount
  statementDate: date
  openingBalance: numeric(19,4)
  closingBalance: numeric(19,4)
  createdAt: timestamp
}

BankStatementLine {
  id: uuid
  tenantId: uuid
  organizationId: uuid
  bankStatementId: uuid      // FK-id to BankStatement
  lineDate: date
  amount: numeric(19,4)      // signed
  description: text
  matchedDocumentType: 'sales_invoice' | 'payment_batch' | 'internal_transfer' | 'manual_gl_entry' | null
  matchedDocumentId: uuid | null              // null for internal_transfer/manual_gl_entry (no document)
  matchedLedgerAccountId: uuid | null          // FK-id to ledger.LedgerAccount — set only for manual_gl_entry
  matchedJournalEntryId: uuid | null   // FK-id to ledger.JournalEntry — set for sales_invoice, internal_transfer, and manual_gl_entry matches (all three post); stays null for payment_batch (never posts)
  amountMismatch: boolean | null       // set only for a payment_batch match, see Design decisions
  matchedAt: timestamp | null
  createdAt: timestamp
}
```

### Module Config

`internalTransferSuspenseAccountId`, `gainLossAccountId` (both FK-id to
`ledger.LedgerAccount`) via `ModuleConfigService`, owned by this
module. Both required before the first `matchBankStatementLine` call
against `internal_transfer` (`internalTransferSuspenseAccountId`) or a
foreign-currency `sales_invoice` match
(`gainLossAccountId`). **`bankReconciliationClearingAccountId` is
dropped** — corrected after review: the shared clearing-account design
it backed was rejected (see Design decisions, Alternatives Considered);
no replacement config value is owned here for the `sales_invoice`
posting's control-account side, since that value
(`receivableAccountId`) is owned and configured by
`sales_invoice_gl_posting`, read here only via `ModuleConfigService`
(see Architecture → Commands, Cross-module integration).

## API Contracts

- `POST /api/cash-bank-management/accounts` — creates a `BankAccount`
  (thin wrapper over `createBankAccount`). `metadata: { requireAuth: true, requireFeatures: ['cash_bank_management.accounts.manage'] }`.
  Body validated by `data/validators.ts` (zod) before
  `createBankAccount` runs.
- `GET /api/cash-bank-management/accounts` — paginated list, via
  `makeCrudRoute`. `metadata: { requireAuth: true, requireFeatures: ['cash_bank_management.accounts.manage'] }`.
- `POST /api/cash-bank-management/statements` — creates a
  `BankStatement` with its lines (`createBankStatement`, zod-validated
  input). `metadata: { requireAuth: true, requireFeatures: ['cash_bank_management.statements.manage'] }`.
- `POST /api/cash-bank-management/statements/:id/lines/:lineId/match` —
  `matchBankStatementLine` (zod-validated input, including the
  conditional `bookedExchangeRate` requirement for `sales_invoice`, the
  required `ledgerAccountId` for `manual_gl_entry`, and the optional
  `description` accepted only for `manual_gl_entry` — falls back to the
  statement line's own `description` when omitted, see Commands).
  `metadata: { requireAuth: true, requireFeatures: ['cash_bank_management.statements.manage'] }`.
  Returns `422 EXCHANGE_RATE_REQUIRED` when a currency mismatch has no
  `bookedExchangeRate` (mirrors Accounts Payable's own
  `422 FISCAL_PERIOD_LOCKED` pattern for a typed, documented rejection
  code); returns the persisted line (including `amountMismatch` when
  set) on success.
- `GET /api/cash-bank-management/statements/:id` — statement + lines
  with match status. `metadata: { requireAuth: true, requireFeatures: ['cash_bank_management.statements.manage'] }`.
  No caching declared — a point lookup on the statement's own primary
  key, not a list/aggregate query, the same no-caching rationale
  `sales_invoice_gl_posting`'s own single-record `GET` route already
  documents.

All five routes are `openApi`-documented, per `packages/core/AGENTS.md`
→ API Routes.

## Migration & Deployment

Three new tables (`bank_account`, `bank_statement`,
`bank_statement_line`), zero changes to any `sales`/`accounts_payable`/
`ledger` table. No seed data — `internalTransferSuspenseAccountId`/
`gainLossAccountId` must be configured before first use (see Module
Config); `sales_invoice_gl_posting.receivableAccountId` is that
module's own configuration, not this one's, but must also be set
before a `sales_invoice` match can complete (see Risks). No backfill:
bank statements from before this module is enabled are never imported
automatically.

## Implementation Plan

1. `BankAccount`/`BankStatement`/`BankStatementLine` entities +
   migration.
2. `data/validators.ts` for all three commands' inputs.
3. `ModuleConfigService` registration for the two owned account-id
   settings (`internalTransferSuspenseAccountId`, `gainLossAccountId`)
   + a minimal settings page.
4. `createBankAccount`, `createBankStatement`, `matchBankStatementLine`
   commands (the latter's four branches — `payment_batch` audit-only,
   `sales_invoice`/`internal_transfer`/`manual_gl_entry` full posting)
   + `acl.ts` + `setup.ts` + `encryption.ts`.
5. The five API routes (with `openApi`, per `packages/core/AGENTS.md`).
6. Bank-account list page + statement-entry/matching page.
7. Follow-up (separate PR, this document's own boundary ends here):
   add the `cash_bank_management.statement_line.matched` subscriber
   to `sales_invoice_gl_posting`.
8. Integration tests: (a) match one line to a real `SalesInvoice`
   fixture, assert the `JournalEntry` and the emitted event both exist
   and balance, with the correct DR/CR direction; (b) match one line to
   a real `PaymentBatch` fixture, assert no `JournalEntry` is created
   and `amountMismatch` is set correctly for both an agreeing and a
   disagreeing amount; (c) match an `internal_transfer` line against
   `internalTransferSuspenseAccountId`, assert the posted `JournalEntry`
   balances with the correct DR/CR direction for both an incoming and
   an outgoing line; (d) match a line to a `manual_gl_entry` with a
   real `LedgerAccount` fixture, assert the posted `JournalEntry`
   balances with the correct DR/CR direction for both an incoming and
   an outgoing line.

## File Manifest

| File | Change | Notes |
|------|--------|-------|
| `data/entities.ts` | Create | `BankAccount`, `BankStatement`, `BankStatementLine` |
| `data/validators.ts` | Create | Zod schemas for all three commands |
| `commands/createBankAccount.ts` | Create | |
| `commands/createBankStatement.ts` | Create | |
| `commands/matchBankStatementLine.ts` | Create | Posts to `ledger` on its `sales_invoice`/`internal_transfer`/`manual_gl_entry` branches; the `payment_batch` branch never posts |
| `lib/moduleConfig.ts` | Create | Registers the two suspense/gain-loss account settings (`internalTransferSuspenseAccountId`, `gainLossAccountId`) |
| `acl.ts` | Create | Two features |
| `setup.ts` | Create | `defaultRoleFeatures`, no seed data |
| `events.ts` | Create | `cash_bank_management.statement_line.matched` |
| `index.ts` | Create | `requires: ['ledger', 'currencies']` |
| `api/cash-bank-management/accounts/route.ts` | Create | `openApi`-documented |
| `api/cash-bank-management/statements/route.ts` | Create | `openApi`-documented |
| `api/cash-bank-management/statements/[id]/lines/[lineId]/match/route.ts` | Create | `openApi`-documented |
| `api/cash-bank-management/statements/[id]/route.ts` | Create | `GET`, statement + lines with match status; `openApi`-documented (added — missing from an earlier revision despite being specified in API Contracts) |
| `backend/accounts/page.tsx` | Create | Bank account list/settings |
| `backend/statements/page.tsx` | Create | Statement entry + line matching |

## Testing Strategy

- Assert a `sales_invoice` match against a same-currency `SalesInvoice`
  fixture produces a balanced `JournalEntry` with the correct DR/CR
  direction (debit `BankAccount.ledgerAccountId`, credit
  `sales_invoice_gl_posting`'s `receivableAccountId` — a `sales_invoice`
  match is always incoming, see Commands) and emits
  `cash_bank_management.statement_line.matched` with the right payload.
- Assert a `sales_invoice` match against an outgoing (`amount < 0`)
  statement line is rejected outright, with no partial write.
- Assert an `internal_transfer` match against an outgoing line debits
  `internalTransferSuspenseAccountId` and credits
  `BankAccount.ledgerAccountId` (the reverse of the incoming case),
  and the posting still balances.
- Assert a foreign-currency `sales_invoice` match with a supplied
  `bookedExchangeRate` computes the gain/loss on the **settled portion
  only** (`matchedAmountInInvoiceCurrency`, not the invoice's full
  `outstandingAmount`) against a partially-paid fixture, adds a
  correctly signed gain/loss line, and the posting still balances.
- Assert a foreign-currency `sales_invoice` match with **no**
  `bookedExchangeRate` supplied is rejected with
  `EXCHANGE_RATE_REQUIRED`, and persists nothing (no line update, no
  `JournalEntry`).
- Assert a same-currency `sales_invoice` match with a
  `bookedExchangeRate` other than `1` supplied is rejected (nothing to
  convert).
- Assert a `payment_batch` match against a `PaymentBatch` fixture whose
  `total_amount` equals the statement line's amount posts **no**
  `JournalEntry`, sets `amountMismatch: false`, and emits no event.
- Assert a `payment_batch` match against a mismatched amount posts no
  `JournalEntry` (unchanged from the agreeing case — this path never
  posts) but sets `amountMismatch: true` and surfaces it on the
  persisted line.
- Assert a `payment_batch` match rejects a `PaymentBatch` that is not
  `status: 'SENT'`.
- Assert a second `matchBankStatementLine` call against an
  already-matched line is rejected regardless of match type (Invariant
  1).
- Assert `matchBankStatementLine` rejects a `matchedDocumentId` that
  doesn't resolve to a real, non-`CANCELLED` `SalesInvoice` (for
  `sales_invoice`) or a real `PaymentBatch` (for `payment_batch`).
- Assert an `internal_transfer` match posts only the bank-account/
  suspense-account line, with `amountMismatch` staying `null` and no
  event emitted.
- Assert a `manual_gl_entry` match against an outgoing line (a bank
  fee) debits the supplied `ledgerAccountId` and credits
  `BankAccount.ledgerAccountId`; against an incoming line (bank-collected
  interest) the reverse; the posting balances either way, and
  `matchedLedgerAccountId`/`matchedJournalEntryId` persist while
  `matchedDocumentId`/`amountMismatch` stay `null` and no event is
  emitted.
- Assert a `manual_gl_entry` match rejects a `ledgerAccountId` that
  doesn't resolve to a real `LedgerAccount`, with no partial write.
- Assert a `manual_gl_entry` match without a supplied `description`
  falls back to the statement line's own `description` as the
  `JournalEntry`'s description.
- Assert a locked `FiscalPeriod` rejects a `sales_invoice` match, full
  stop (Invariant 5); assert a `payment_batch` match against the same
  locked period is unaffected (no `ledger` write is ever attempted);
  assert `internal_transfer` and `manual_gl_entry` matches are equally
  rejected against a locked period, since both post.
- Assert `sales`'s and `accounts_payable_payments`'s own commands/events
  are fully unaffected when `cash_bank_management` is not installed for
  a tenant.
- Tenant/org isolation: all three entities' reads and writes, and both
  cross-module reads (`SalesInvoice`, `PaymentBatch`), never cross
  tenant/organization boundaries.
- Assert `reconcileBankAccount`'s read surfaces a real discrepancy
  when a `BankAccount`'s ledger balance and its latest
  `BankStatement.closingBalance` disagree (Invariant 3).
- Assert `matchBankStatementLine`'s `sales_invoice` path rejects when
  `sales_invoice_gl_posting`'s `receivableAccountId` Module Config
  value is unset, with a readable configuration error and no partial
  write.
- Assert `BankAccount.accountNumber` round-trips correctly through
  `findWithDecryption` and is never returned in plaintext by the list
  route (masked, per Backend Pages).

## Risks & Impact Review

- **`manual_gl_entry` has no independent check on the picked
  `LedgerAccount` beyond "does it exist."** Unlike `sales_invoice`
  (whose control account is read from `sales_invoice_gl_posting`'s own
  config) or `internal_transfer`/`payment_batch` (fixed or
  document-derived targets), `manual_gl_entry` lets the accountant pick
  *any* real `LedgerAccount` — a wrong pick (e.g. posting a bank fee
  against a revenue account by mistake) is possible and undetected by
  this module; the same class of risk Kieso's own reconciliation
  process ultimately relies on human review to catch, not a system
  guard. No account-type restriction (e.g. "expense accounts only for
  outgoing lines") is designed in Phase 1 — flagged here rather than
  silently assumed safe.
- **This module only computes realized FX gain/loss on the
  `sales_invoice` path — the `VendorInvoice`/AP side is not
  addressed.** Problem Statement names unrecorded FX gain/loss as
  affecting both directions, but a `payment_batch` match posts nothing
  and never revisits the rate: Accounts Payable already posted the
  vendor-liability entry (at whatever rate was booked then) before any
  bank statement exists, and this module has no mechanism to compute or
  post a correction against it. A tenant paying foreign-currency vendor
  invoices gets no automated realized-gain/loss posting from this
  module at all — a real, named gap (see Out of scope), not silently
  assumed solved because the `sales_invoice` side is handled.
- **`amountMismatch` is surfaced, not acted on.** A `payment_batch`
  match that disagrees with `PaymentBatch.total_amount` is flagged on
  the line (`amountMismatch: true`) and shown in the UI (Backend
  Pages), but nothing blocks the match, alerts anyone proactively, or
  reverses the already-posted liability-clearing entry — an
  accountant must notice the flag. Corrected from the first draft's
  unverified clearing-account posting pattern (see Changelog); this is
  a narrower, honestly-scoped Phase 1 gap, not an unresolved accounting
  question.
- **No `accounts_payable_payments` subscriber in Phase 1.** Beyond the
  `amountMismatch` flag set at match time, nothing continuously
  monitors for a batch that was sent but never shows up on a
  statement at all — that requires a sweep this document does not
  design (see Out of scope).
- **Manual exchange-rate entry is error-prone.** Since neither
  `VendorInvoice` nor `SalesInvoice` stores a booking-date rate, the
  accountant must recall or look up the original rate at match time —
  a wrong entry produces a wrong (but still balanced) gain/loss
  posting, silently. Made somewhat safer this revision:
  `bookedExchangeRate` is now a required, validated input on a
  currency mismatch (rejected outright if missing — see Design
  decisions, Commands) rather than a silently-defaulted optional one,
  but a *wrong* rate entered deliberately is still undetectable by the
  system.
- **Cross-module integration depends on a sibling document's future
  change, in two ways.** The AR settlement path only works once
  `sales_invoice_gl_posting` actually implements the subscriber this
  document specifies — until that follow-up ships, matched
  `sales_invoice` lines emit an event nobody consumes, and `sales`'s
  own `outstandingAmount` never updates from a bank match. It also
  depends on that module's `receivableAccountId` Module Config value
  being set — `matchBankStatementLine`'s `sales_invoice` path rejects
  cleanly when it isn't (see Commands, Testing Strategy), but a tenant
  that installs this module without ever configuring
  `sales_invoice_gl_posting` cannot complete a `sales_invoice` match at
  all.
- **`BankAccount.accountNumber` encryption is new for this document
  family's write path, not just its data model.** Declaring the
  encryption map (this revision) is necessary but not sufficient — the
  masked-in-list-view behavior (Backend Pages) and the
  `findWithDecryption` read path are new code, unlike sibling modules
  that had no comparable encrypted master-data field to introduce.
- **Tenant & data isolation.** Same profile as every other module in
  this family — all three entities are tenant/org-scoped.
- **Migration & deployment.** Low — three new, empty-by-default
  tables, no change to any existing module's schema.

## Out of scope

- **Realized FX gain/loss on the AP (`VendorInvoice`/`PaymentBatch`)
  side** — this module computes and posts it only on the
  `sales_invoice` path (see Risks); a `payment_batch` match never
  recomputes or corrects the rate Accounts Payable already booked. An
  AP-side equivalent, if ever needed, is a future extension to
  `accounts_payable`/`accounts_payable_payments`, not this module.
- **Refunds / credit-note settlements paid back to a customer** — a
  `sales_invoice` match only ever models an incoming payment (see
  Commands); an outgoing line is rejected rather than posted with an
  unverified reversed direction. Not designed here, no confirmed need
  yet.
- **Dunning/interest (windykacja, odsetki, noty odsetkowe)** —
  decided 2026-09-10: its own, separate future document (see Related,
  Alternatives Considered).
- **Cash-flow forecasting, liquidity planning, what-if scenarios** —
  not asked for anywhere in the Event Storming record; Cash Flow
  remains a report (`#6013`) fed by ZSiO, not a feature of this
  document.
- **Payment initiation / outgoing payment batching** — already
  Accounts Payable's job (`PaymentBatch`); this document only
  reconciles the bank side after the fact.
- **Automated statement import (MT940/CAMT/BAI2) and rule-based
  auto-matching** — Phase 2, per Design decisions. Includes
  auto-suggesting a `manual_gl_entry` match for a recurring bank fee
  (e.g. the same monthly maintenance charge, same description, similar
  amount) — Phase 1 requires the accountant to pick the account by hand
  every time, with no memory of past picks.
- **Account-type validation on a `manual_gl_entry` match** — the
  accountant may pick any real `LedgerAccount`; nothing restricts the
  choice by account type or direction (see Risks). Not designed here,
  no confirmed need yet.
- **A historical exchange-rate lookup/provider** — Phase 1 requires
  manual rate entry at match time (see Design decisions).
- **An `accounts_payable_payments` confirmation subscriber (proactive
  alerting beyond the `amountMismatch` flag)** — deferred; Accounts
  Payable already settles at send time, and Phase 1's `payment_batch`
  match already flags a disagreement at match time (`amountMismatch`,
  see Design decisions, Commands) — a subscriber would add continuous,
  unprompted monitoring on top of that, not a missing write (see
  Risks).
- **The `sales_invoice_gl_posting` subscriber itself** — specified
  here (Cross-module integration, Events) but implemented as a
  follow-up change to that document, not this one (see Implementation
  Plan step 7).
- **Reversing a matched line** — a future `unmatchBankStatementLine`
  would call `ledger.reverseJournalEntry`; not designed here, no
  confirmed need yet.

## Final Compliance Report — 2026-09-10

An independent, fresh-context adversarial review of the full first
draft (against this document's own cited sources: `sales`,
`accounts_payable`/`accounts_payable_payments`, `ledger`,
`sales_invoice_gl_posting`, and Fixed Assets as the family's compliance
bar) returned 14 findings, three Critical/High-severity: DR/CR
direction reversed on the bank-account posting leg; a shared
"clearing-account" mechanism that would never net to zero and would
double-post Accounts Payable's already-recorded cash movement; and a
direct internal contradiction between the Proposed
Solution/Invariant 2 and the Commands section's own note about whether
this module posts the matched document's control-account line. All
three, plus the remaining Medium-severity findings, are fixed in this
revision — see Changelog. A separate, fresh-context scope-cohesion
check (checklist §1.2, delegated per the skill's own requirement — "the
author cannot adversarially re-read its own spec") returned
**COHESIVE**: every piece (BankAccount master data, statement entry,
line matching, the two match-type postings, the settlement-asymmetry
design) exists solely to support the one integration seam named in the
TLDR, and no text in the document admits any part functions
independently of the others.

This revision also added, rather than retroactively claimed, the
concrete spec content the matrix below cites: Backend Pages' actual UI
construction (`<CrudForm>`/`<DataTable>`/`<StatusBadge>`/
`useGuardedMutation`/`apiCall`/`useT()`), API Contracts' `metadata`/
`requireFeatures` exports and no-caching rationale, and the Encryption
section's `defaultEncryptionMaps` declaration — none of that existed in
the draft this matrix would otherwise have to mark non-compliant.

One workflow step this document's history departs from: the skill's
own Skeleton Spec + Open Questions gate (Steps 3–4) *was* followed
first (see Changelog, "Skeleton + Open Questions gate") — unlike
`sales-invoice-gl-posting`, which skipped it on the strength of an
already-proven analogous pattern. This document could not do the same,
since the maintainer's own instruction this round was specifically to
verify scope against the Event Storming record before drafting at all
(see Changelog).

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
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `BankStatement.bankAccountId`, `BankStatementLine.bankStatementId`/`matchedDocumentId`/`matchedJournalEntryId` are all plain FK-ids, explicitly "no ORM relation" (Architecture → Entities) |
| root AGENTS.md | Filter by `organization_id` | Compliant | All three entities are tenant/org-scoped (Data Models); the `matchBankStatementLine` command scopes every `sales`/`accounts_payable_payments`/`ledger`/`currencies` read by `tenantId`/`organizationId` (Commands, Testing Strategy) |
| packages/core/AGENTS.md → Cross-Module Coupling | Hard dependencies via `requires` + direct calls; optional peers via scoped reads/`tryResolve`, degrading safely if absent | Compliant | `ledger`/`currencies` are the only `requires` (hard — this module has no function without them); `sales`, `accounts_payable_payments`, `sales_invoice_gl_posting` are all read-only, scoped, no hard dependency, named explicitly with their degrade-safely behavior (Cross-module integration, Module Dependency) |
| packages/core/AGENTS.md → API Routes | API routes MUST export `openApi` | Compliant | All five routes documented as `openApi`-documented (API Contracts, File Manifest) |
| packages/core/AGENTS.md → API Routes | `metadata` export with per-method `requireAuth`/`requireFeatures` | Compliant | Added this revision: each of the five routes lists its own `metadata: { requireAuth, requireFeatures }` (API Contracts) |
| packages/core/AGENTS.md → CRUD Factory | CRUD APIs use `makeCrudRoute` | Compliant / N/A | `GET /accounts` is a plain paginated list via `makeCrudRoute` (Compliant); `POST /statements`, `POST .../match` are bespoke command-invoking routes, not CRUD collections (N/A — same shape as `sales_invoice_gl_posting`'s own single bespoke route) |
| packages/core/AGENTS.md | All user input validated with zod before persistence | Compliant | `data/validators.ts` validates all three commands' inputs before any business-rule check runs (Commands, API Contracts, File Manifest) |
| packages/core/AGENTS.md → Encryption | Sensitive/GDPR fields declared in `<module>/encryption.ts` `defaultEncryptionMaps`, read via `findWithDecryption` | Compliant | Fixed this revision (was a deferred gap in the prior draft): `BankAccount.accountNumber` declared in `defaultEncryptionMaps`, matching `contractors.ContractorBankAccount`'s existing precedent for a structurally identical field (Architecture → Encryption, Risks) |
| packages/core/AGENTS.md | Optimistic locking (`updatedAt`) on user-editable entities | Compliant / N/A | `BankAccount` (user-editable master data) has `updatedAt`; `BankStatement`/`BankStatementLine` are explicitly write-once/append-only by design (header immutable; a line is matched at most once — corrections reverse or add a new line, not edit), matching `JournalEntry`'s own immutable-posting precedent (Architecture → Entities, Data Models) |
| packages/core/AGENTS.md | Cross-module touchpoints name mechanism, owner, and module-absent behavior | Compliant | `sales` (scoped read), `accounts_payable_payments` (scoped read), `sales_invoice_gl_posting` (scoped `ModuleConfigService` read + event subscriber owned by that module) are each named with their exact mechanism and "never appears in `requires`" behavior (Cross-module integration) |
| packages/events/AGENTS.md | No direct cross-module calls; events for side effects | Compliant | The only cross-module write is `commandBus.execute('ledger.postJournalEntry', ...)` (the sanctioned generic mechanism, same as every sibling document); `cash_bank_management.statement_line.matched` is the one declared event, emitted only where a real Phase 1 consumer exists (Events, corrected this revision to drop the payload's dead `payment_batch`/`internal_transfer` cases) |
| packages/cache/AGENTS.md | Cache resolved via DI; tenant-scoped tags; invalidation declared per write path | N/A | No caching declared on any route — the one `GET` beyond the list is a point lookup on a statement's own primary key, not a list/aggregate query, the same no-caching rationale `sales_invoice_gl_posting`'s single-record `GET` route already documents (API Contracts, added explicitly this revision) |
| packages/ui/AGENTS.md | Backend forms use `<CrudForm>`; lists use `<DataTable>` with stable `entityId`; non-`CrudForm` writes use `useGuardedMutation` | Compliant | Added this revision (Backend Pages): `<CrudForm>` for account create/edit and statement creation; `<DataTable>` with `entityId: 'cash_bank_management:bank_account'`/`'cash_bank_management:bank_statement_line'`; the match dialog (a domain action, not a plain entity edit) uses `useGuardedMutation(...).runMutation(...)` |
| packages/ui/src/backend/AGENTS.md | All HTTP goes through `apiCall`/`apiCallOrThrow` (never raw `fetch`) | Compliant | Added this revision (Backend Pages): all reads/writes on both pages go through `apiCall`/`apiCallOrThrow` |
| root AGENTS.md (Design System Rules) | Semantic status tokens, Tailwind text scale, shared primitives, `aria-label` on icon-only buttons | Compliant | Added this revision: `<StatusBadge>` for `isActive`/match-status/`amountMismatch` (semantic tokens only, e.g. `bg-status-success-bg`/`bg-status-warning-bg`, never `bg-green-*`); the match dialog's icon-only close control carries an `aria-label` |
| checklist §5 | i18n keys planned for all user-facing strings | Compliant | Added this revision: both pages' labels, validation errors, and the `EXCHANGE_RATE_REQUIRED`/`amountMismatch` messaging go through `useT()` (client) / `resolveTranslations()` (server) — no hard-coded strings |
| checklist §1.2 | Spec covers ONE independently deployable capability (fresh-context subagent check) | Compliant | **COHESIVE** verdict from an isolated, fresh-context review given only this spec file (see narrative above) |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match architecture | Pass | `BankStatementLine`'s `matchedDocumentType` enum and `amountMismatch` field agree across Entities and Data Models (fixed this revision — the two had drifted in the prior draft) |
| Commands defined for all mutations | Pass | `createBankAccount`, `createBankStatement`, `matchBankStatementLine` (all four of its branches — `payment_batch`, `sales_invoice`, `internal_transfer`, `manual_gl_entry`) all have commands; no mutation is UI-only |
| API contracts match data models | Pass | All five routes' request/response shapes trace to the entities and command inputs above; the `422 EXCHANGE_RATE_REQUIRED` contract matches the command's own rejection behavior |
| User Stories match Implementation Plan | Pass | The AR-match, `amountMismatch`-flagging, and FX-gain/loss stories each have a corresponding command + page + test; no story lacks a caller |
| Risks cover all write operations | Pass | Both `matchBankStatementLine` branches (posting and non-posting), the encryption write path, and the cross-module config dependency are each named in Risks |
| Every Testing Strategy item has a corresponding implementation step | Pass | DR/CR-direction, `amountMismatch`, `EXCHANGE_RATE_REQUIRED`, partial-settlement gain/loss, and no-event-for-`payment_batch`/`internal_transfer` assertions all map to `matchBankStatementLine`'s corrected design (Implementation Plan step 4) |
| Design Decisions/Invariants/Commands agree on which match type posts | Pass | Fixed in an earlier revision — the original draft's self-contradiction (Proposed Solution/Invariant 2 claiming both match types post a control-account line vs. Commands' own note that they don't) is resolved: `sales_invoice`, `internal_transfer`, and `manual_gl_entry` post (each against its own target — a document's control account, a suspense account, or an accountant-picked account, respectively), `payment_batch` never does — stated identically in Proposed Solution, Design Decisions, Commands, Events, Invariants 2/4/5, and Testing Strategy |

### Non-Compliant Items

None. The two items still carrying real residual risk — the
`sales_invoice_gl_posting` subscriber not yet existing, and that
module's `receivableAccountId` needing to be configured before a
`sales_invoice` match can complete — are cross-module sequencing and
operational risks, not gaps against any AGENTS.md rule this document
is responsible for; both are named explicitly in Risks & Impact Review
and Out of scope, not hidden.

### Verdict

**Fully compliant** — approved, ready for implementation.

**Note (post-verdict addition):** after this Verdict was reached, a
separate literature-verification pass (per this project's
`financial-spec-citation-check` convention) checked this document's
claims against Kieso's *Intermediate Accounting* and Fowler's
*Analysis Patterns* directly, and added the `manual_gl_entry` match
type plus a Fowler citation in Design Decisions as a result (see
Changelog). This did not reopen the Compliance Matrix or Internal
Consistency Check above — the addition is a new command branch
following the same patterns (`acl.ts` feature, zod validation,
`postJournalEntry` via `commandBus`, `openApi` route, i18n, DR/CR
balance) already covered by the existing rows, not new AGENTS.md
surface area — but a reader should treat the Verdict as reaffirmed by,
not blind to, this addition.

## Changelog

### 2026-09-10 — Skeleton + Open Questions gate

Initial Skeleton Spec written per this project's own `om-spec-writing`
workflow (Step 3), after discovering that SPEC-024's "Cash & Bank
Management" epic (§4.1–4.4: Bank Account Management, Bank
Reconciliation, Cash Flow Management, Payment Processing) does not
match what was actually discussed at the Event Storming workshop
(2026-09-05, ekspert domenowy Mateusz Duda) — confirmed by a full,
three-file re-read (`eventstormingfinal.md`, `eventstormingpodsumowanie.md`,
`eventstormingwall.html`) finding zero mentions of a bank-account
subsystem, cash-flow forecasting, or payment processing outside
Accounts Payable. Four Open Questions raised (BankAccount
multi-currency shape, cross-module settlement mechanism, Phase 1
import method, FX gain/loss ownership) and presented for maintainer
answers, per the skill's hard gate — no further drafting done until
answered.

### 2026-09-10 (cont.) — Open Questions resolved, full first draft

All four Open Questions answered (one currency per `BankAccount` row;
an emitted event rather than a direct cross-module command call;
manual statement entry in Phase 1; this module computes realized FX
gain/loss). A separate, explicit decision (asked and confirmed
independently of the Skeleton's own questions): dunning/interest is
its own future document, not part of this one and not reopened into
`sales-invoice-gl-posting` (#6046). Expanded into a full first draft —
Overview, Problem Statement, Proposed Solution, Design Decisions
(including the real AP-vs-AR settlement asymmetry the Event Storming
wall's side-by-side framing obscures), User Stories, Invariants,
Alternatives Considered, Architecture, Data Models, API Contracts,
Migration & Deployment, Implementation Plan, File Manifest, Testing
Strategy, Risks & Impact Review, Out of scope. Final Compliance
Report deliberately left as "not yet run" — the adversarial review,
scope-cohesion check, and structured Compliance Matrix this family's
other recent documents went through are the explicit next step, not
done in this same pass.

### 2026-09-10 (cont.) — Independent review pass, 14 issues fixed

An independent, fresh-context adversarial review of the full first
draft returned 14 findings, three Critical/High-severity, all
stemming from one root cause: the draft treated the `PaymentBatch`
(Accounts Payable) and `SalesInvoice` (Accounts Receivable) match
paths as symmetric when they are not — Accounts Payable already
settles (posts GL) at `markPaymentBatchSent` time, so a later bank
match on that side is a confirmation/audit function only, while
Accounts Receivable has no equivalent prior settlement moment and the
bank match is the only trigger that will ever post it. Fixed,
end to end:

- **DR/CR direction reversed on the bank-account posting leg** —
  corrected in Commands: debit `BankAccount.ledgerAccountId` for an
  incoming line, credit for an outgoing one, matching
  `BankStatementLine.amount`'s own sign convention.
- **A shared "clearing account" mechanism that never nets to zero and
  double-posts Accounts Payable's already-recorded cash movement** —
  rejected outright, not patched: a `payment_batch` match now posts
  **nothing** to `ledger` (it only sets `amountMismatch`); a
  `sales_invoice` match posts the full entry itself, directly against
  `sales_invoice_gl_posting`'s own `receivableAccountId` (read via
  `ModuleConfigService`), with no intermediate clearing account at all.
  `bankReconciliationClearingAccountId` dropped from Module Config.
  See Design decisions, Alternatives Considered.
- **A direct internal contradiction about whether this module posts
  the counterparty leg** — resolved by the same fix: Proposed
  Solution, Design Decisions, Commands, Events, and Invariants 2/4 now
  all say the same thing (only `sales_invoice` posts) instead of
  disagreeing with each other.
- **AP match target changed from `VendorInvoice` to `PaymentBatch`** —
  a batch, not a single invoice, is what actually appears as one line
  on a real bank statement; `matchedDocumentType`'s enum, the
  `BankStatementLine` data model, Cross-module integration, and
  Testing Strategy all updated accordingly.
- **FX gain/loss corrected to the settled amount, not the invoice's
  full gross total** — `sales`'s own partial/multi-payment support
  (`SalesInvoice.outstandingAmount`, `SalesPayment`'s allocation) means
  a two-installment foreign-currency payment needs each installment's
  own gain/loss, not one computed against the invoice total.
- **`bookedExchangeRate` made required, not silently optional, on a
  currency mismatch** — a missing rate now rejects
  (`EXCHANGE_RATE_REQUIRED`) instead of silently implying a wrong 1:1
  rate.
- **`amountMismatch` field added** to `BankStatementLine`, replacing
  the dropped clearing-account mechanism as the Phase 1 answer to "did
  the bank amount match what Accounts Payable sent" — surfaced at
  match time, not continuously monitored (an explicit, named Phase 1
  gap, not a silent one).
- **`BankAccount.accountNumber` encryption declared now**, not deferred
  to implementation time — matching `contractors.ContractorBankAccount`'s
  existing precedent for the same kind of field.
- **Backend Pages and API Contracts fleshed out** with real UI/route
  construction detail (`CrudForm`/`DataTable`/`StatusBadge`/
  `useGuardedMutation`/`apiCall`/`useT()`, `metadata`/`requireFeatures`,
  no-caching rationale, zod-validation step) — the prior draft deferred
  this to "the Compliance Matrix pass," which cannot honestly mark
  anything compliant against content that doesn't exist yet.
- The remaining Medium/Low-severity findings (documentation
  completeness, missing Alternatives-Considered rows for the rejected
  clearing-account and per-invoice-matching designs, Risks/Out-of-scope
  wording drift) fixed alongside the above.

A separate, fresh-context scope-cohesion check (checklist §1.2)
returned **COHESIVE** — no action needed. Final Compliance Report
replaced with a full structured Compliance Matrix + Internal
Consistency Check + Verdict (**Fully compliant**), per this project's
`om-spec-writing`/`compliance-review.md` gate, matching the bar
already applied to `sales-invoice-gl-posting` and Fixed Assets.

### 2026-09-10 (cont.) — Second, narrower verification pass, five issues fixed

A second independent, fresh-context review — given only this file, with
no memory of drafting it — was run specifically to check the previous
round's own fixes for new defects, rather than trusting them as final.
It found five real issues the fix pass itself had introduced or left
unresolved, all now fixed:

- **`internal_transfer` incorrectly grouped with `payment_batch` as
  "does not post."** It does post (against
  `internalTransferSuspenseAccountId`), so `matchedJournalEntryId` must
  be set for it too — the prior wording would have left an
  internal-transfer posting with no recorded back-reference to its own
  `JournalEntry`. Fixed in Architecture → Entities, Commands, Data
  Models, Invariants 2 and 5.
- **`bookedExchangeRate`'s conversion direction was stated
  inconsistently.** Defined explicitly now as units of the
  `BankAccount`'s own currency per 1 unit of invoice currency (matching
  `SalesOrder.exchangeRate`'s own direction) — invoice-currency amounts
  multiply by it, bank-currency amounts divide by it. The
  `matchedAmountInInvoiceCurrency` computation was updated to actually
  divide, rather than leaving "converted at" ambiguous between the two
  directions (see Commands).
- **A `sales_invoice` match's posting direction for an outgoing line
  was never specified.** Rather than inventing an unverified reversed
  posting for a scenario (a refund/credit-note settlement) that
  Problem Statement and User Stories never describe, `matchBankStatementLine`
  now rejects an outgoing line matched to `sales_invoice` outright — a
  `SalesInvoice` match models a customer paying the tenant, always
  incoming, and a refund flow is named explicitly in Out of scope
  instead of left as an undefined edge case (see Commands, Testing
  Strategy).
- **File Manifest was missing the route file for
  `GET /api/cash-bank-management/statements/:id`**, which API
  Contracts already specified. Added.
- **Problem Statement named unrecorded FX gain/loss on both
  `SalesInvoice` and `VendorInvoice`, but the delivered solution only
  computes it on the `SalesInvoice` path.** A `PaymentBatch` match
  posts nothing and never computes a gain/loss figure — Accounts
  Payable's own invoice-time posting already used whatever rate was
  booked then, and this module does not revisit it at settlement time.
  Named explicitly now in Risks & Impact Review and Out of scope
  instead of left as an implicit, undisclosed scope gap.

The Final Compliance Report's Compliance Matrix, Internal Consistency
Check, and Verdict were not regenerated after this pass — the fixes
above are corrections within sections the matrix already covers, not
new AGENTS.md-relevant surface area — but a reader should treat the
Verdict as reaffirmed by, not blind to, this second pass.

### 2026-09-11 — Literature-verification pass (Kieso, Hay, Fowler): one citation added, one real gap closed

Per this project's `financial-spec-citation-check` convention, checked
this document's claims and design directly against three newly
available primary sources — Kieso, Weygandt, Warfield, *Intermediate
Accounting*, 17th Ed.; Hay, *Data Model Patterns*; Fowler, *Analysis
Patterns* — rather than accepting any prior summary (including this
project's own knowledge-base doc) at face value. Extracted full text
(`pdftotext -layout`) and grepped/read in context, not just section
titles. Two real findings, both resolved with the maintainer's explicit
go-ahead before editing:

- **Added a citation: Fowler, *Analysis Patterns*, 6.13 "Corresponding
  Account" (p.124).** Verified directly — describes exactly this
  module's reconciliation mechanic (two independent parties' own
  records of the same real-world asset, posted possibly on different
  dates, reconciled with tolerance for imprecision). This document had
  zero external-literature citations before this pass, unlike its
  siblings (Fixed Assets, GL core, the knowledge-base's own AP/AR
  citations) — now added to Design Decisions.
- **Closed a real gap: added a fourth match type, `manual_gl_entry`.**
  Kieso's own Appendix 7A ("Reconciliation of Bank Balances,"
  p.7-33–7-35) enumerates the standard reconciling items on any real
  bank statement, including bank charges and bank-collected interest —
  neither has a matched `SalesInvoice`, `PaymentBatch`, or internal
  transfer, and this document's original three match types had no path
  for either. Since this line type appears on essentially every real
  bank statement, its absence was a genuine, material Phase 1 gap, not
  a hypothetical one. `manual_gl_entry` lets the accountant post
  directly against a `LedgerAccount` they pick, with no document to
  resolve one from — updated throughout: Proposed Solution, Design
  Decisions, Commands, Entities, Data Models, Invariants 2/4/5, Backend
  Pages, API Contracts, Testing Strategy, Risks & Impact Review, Out of
  scope, Alternatives Considered, Implementation Plan, File Manifest.

Also checked and found **not applicable**, so not cited: Hay's *Data
Model Patterns* has zero occurrences of "reconcil-" in its full
277-page text, and its one bank-related pattern (Figure 4.17/ch.12,
p.66/250) models a bank's own product catalog (`ACCOUNT`/`ACCOUNT
TYPE`/`PARAMETER`), a different problem from this module's own
`BankAccount`. Also checked and left honestly unresolved: Kieso 17th
Ed. has no mechanical foreign-currency-transaction/settlement-date
gain-loss chapter — only a one-paragraph risk-disclosure note on
receivables (p.7-28) — so this document's own FX gain/loss formula
remains grounded in `sales`'s internal partial-payment logic, neither
confirmed nor contradicted by this literature pass.

Re-confirmed, via the freshly re-uploaded `eventstormingpodsumowanie.md`
(a condensed version of the three files already read in full earlier
in this document's history): no new scope divergence from the Event
Storming record — §04's scope (bank statement → reconciliation → FX →
posting → AR/AP settlement, dunning separate) still matches this
document exactly.

A fresh-context check of this pass's own threading (given only this
file, no memory of writing it) found six loose ends the `manual_gl_entry`
edit had left behind in the document's own "meta" sections describing
its completeness, all fixed: the Final Compliance Report's Internal
Consistency Check table had two rows left describing the pre-addition
state as if it were still current ("Commands defined for all
mutations" citing only 2 of 4 branches; the posting-agreement row still
saying "only `sales_invoice` posts," now false with two more posting
branches); Events never explained why `manual_gl_entry` gets no event,
though Invariant 4 already assumed it doesn't; the Kieso citation
paragraph miscounted which reconciling-item categories need an
adjusting entry ("the middle three" when the correct set is items 3–4
plus depositor-side corrections within 5, not item 2); Implementation
Plan step 8's integration-test list covered three posting paths but
skipped `internal_transfer`; and the match route's API Contracts entry
never mentioned the optional `description` input. None changed the
underlying design — `manual_gl_entry` itself was correct throughout —
but a compliance report contradicting the spec it certifies is worth
catching before a maintainer reads it.
