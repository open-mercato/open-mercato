# Deferred Revenue — Scheduled Recognition Over Time (RMP)

> **Temporary location.** This document lives at
> `.ai/specs/2026-09-17-deferred-revenue.md` on branch `docs/deferred-revenue`
> pending review and merge.

## TLDR

The Event Storming wall (AR/Sales section) names one concrete, currently
unhandled path: an accountant sells something (an annual license, a
subscription, a fixed-price service milestone) that GL already books as
revenue in full at invoice time, but should instead be recognized 1/12
per month over the period it actually covers — suspended in the meantime
on a balance-sheet liability account (RMP, rozliczenia międzyokresowe
przychodów). The wall itself flags this as **"own spec"**, not part of
any existing document's scope. This spec builds it as a small, standalone
module (`deferred_revenue`) modeled directly on the one proven precedent
already in this codebase for "an amount recognized gradually on a
schedule" — Fixed Assets' `DepreciationScheduleEntry`/`accrueDepreciation`
mechanism — reused by shape, not by code (see Design decisions). Scope is
deliberately narrow: straight-line only, one source document type
(`sales.SalesInvoiceLine`), manual trigger, no scheduler. Percent-of-
completion, multi-element contracts, and any reuse by a future
leasing/loan module are explicitly out — none of that has a signal in
the source material this spec was checked against (see Literature &
Prior Art, Step 1).

## Problem Statement

Event Storming wall, section "03. Sprzedaż, Należności i Przychody w
Czasie": *"Rozpoznano przychód w czasie → Zawieszono na koncie
bilansowym (RMP) → Wygenerowano harmonogram rozliczeń (1/12 co
miesiąc); wariant: przerwanie harmonogramu."* With the rule: *"Harmonogram
rozliczania przychodu, np. sprzedaż licencji rocznej → księgujemy 1/12
co miesiąc."* Filed under "New relative to current scope — to consider
in future phases": **"Harmonogram rozliczania przychodu w czasie
(subskrypcje/POC) — własny spec."**

Today, `sales_invoice_gl_posting` posts a `SalesInvoiceLine`'s full
`totalNetAmount` straight to whatever `LedgerAccount` the accountant
picked in `lineAccounts` at posting time (recorded per line in
`SalesInvoiceLineRevenueAccount`) — there is no mechanism, anywhere in
this codebase, for spreading that recognition across future periods.
An annual license invoiced in January currently books 100% of the
revenue in January, overstating January's income and understating
every following month's, exactly the "deferral" case Kieso's Ch.3
adjusting-entries framework describes (see Literature & Prior Art).

**A note on scope, corrected during this spec's own Step 1**: an
earlier framing of this topic (before this document was drafted)
described it as one generic mechanism meant to be reused for RMK,
leasing installments, and loan/bond principal-and-interest schedules.
Checked directly against the actual Event Storming source files
(`eventstormingpodsumowanie.md`, `eventstormingfinal.md`,
`eventstormingwall.html`) — none of them mention leasing, credit, or
bond installments anywhere. RMK appears only inside Fixed Assets' own
asset-purchase path (already fully covered by `2026-09-06-fixed-assets.md`).
The only "own spec" the wall actually names is this one: revenue
recognized over time for sales/AR. This document scopes to exactly
that; leasing/loan reuse is not designed here (see Alternatives
considered, Out of scope).

## Proposed Solution

A new, small Core module, `deferred_revenue`:

1. **`deferRevenueRecognition`** — given an already-posted
   `SalesInvoiceLine` and a service period (`serviceStartDate`/
   `serviceEndDate`), reclassifies that line's already-booked revenue
   from its original income account into a configured RMP liability
   account with one `JournalEntry`, and materializes the full
   straight-line monthly schedule in one shot — mirroring
   `acceptFixedAsset`'s combined "post + generate schedule" shape.
2. **`accrueRevenueRecognition`** — given an `asOf` date, finds every
   due, unaccrued schedule entry and posts its recognition entry
   (debit the RMP liability, credit the original income account) —
   mirroring `accrueDepreciation`'s exact mechanics: paged, one
   transaction per entry, idempotent, skips (not fails) entries whose
   period is locked.
3. **`stopRevenueRecognitionSchedule`** — the wall's "przerwanie
   harmonogramu" variant: catches up any due-but-unposted entries,
   then recognizes the remaining balance immediately and closes the
   schedule (see Design decisions for the policy this assumes).

No new rate/scheduling infrastructure beyond what Fixed Assets already
proved works for this shape of problem — the two modules stay
independent implementations of the same pattern, not a shared library
(see Design decisions).

## Design decisions

1. **Reused by shape, not by extraction.** Fixed Assets' own spec
   (`2026-09-06-fixed-assets.md`, Design decisions) already considered
   extracting a shared "scheduled recognition" mechanism and explicitly
   declined: *"Revenue Recognition is, for now, only the name of a
   future module, with no skeleton of its own — extracting a shared
   scheduling mechanism now, with no second, real consumer in view,
   risks designing the wrong abstraction."* This spec is that second,
   real consumer arriving — but it does not go back and force Fixed
   Assets (`2026-09-06-fixed-assets.md`, PR #6014, "Fully compliant —
   approved for implementation") to migrate onto a shared library
   retroactively. Doing so now would mean editing an already-reviewed,
   approved spec for a refactor with no functional benefit to either
   module. `deferred_revenue` copies `DepreciationScheduleEntry`/
   `accrueDepreciation`'s proven shape (materialize-in-full,
   `accruedAt`/`journalEntryReferenceId`, per-entry transaction,
   fiscal-period-lock skip, `referenceType`/`referenceId` tagging) as
   its own independent implementation. A real, generic extraction
   remains a documented future option once a third consumer exists
   (see Alternatives considered) — not designed blind here either.
2. **Module name deliberately avoids "Revenue Recognition."** SPEC-024
   §3.5 already reserves that name for a much larger topic (contract-
   based billing schedules, ASC 606-style multi-element allocation,
   listed there as "Phase 3" complexity). This spec is a narrow,
   straight-line deferral mechanism — naming it `deferred_revenue`
   avoids a future reader conflating the two.
3. **Straight-line only, computed once at deferral time.** Matches the
   wall's own worked example ("sprzedaż licencji rocznej → księgujemy
   1/12 co miesiąc") exactly. `totalAmount / numberOfPeriods`, with the
   same final-period rounding-remainder rule `acceptFixedAsset` already
   uses (the last row absorbs whatever the division didn't split
   evenly), rather than reinventing a rounding rule this project
   already settled once.
4. **Percent-of-completion is out, not deferred-with-a-plan.** The
   wall's own note on POC is explicit: *"POC — Percent of Completion...
   dopisek 'Przewaga' niejasny, do wyjaśnienia z ekspertem domenowym"*
   — the source material itself flags this as unresolved and needing a
   domain-expert conversation. Building it now would mean guessing at
   an undefined "Przewaga" concept; this spec builds only the
   unambiguous straight-line case the wall actually specifies.
5. **The reclassification step reuses `SalesInvoiceLineRevenueAccount`
   instead of adding new configuration for "which income account."**
   Checked directly against `sales-invoice-gl-posting.md`: each
   invoice line's originally-credited revenue account is already
   persisted per line, not just implied. `deferRevenueRecognition`
   reads that row to learn the debit side of its reclassification
   entry — the only new tenant configuration this module needs is the
   credit side, `deferredRevenueLiabilityAccountId`, via its own
   `ModuleConfigService` entry (reject-if-unset, the same posture
   `accounts_payable`/`sales_invoice_gl_posting`/`posting_rules` all
   already use for a required-but-unseeded account).
6. **Early stop recognizes the remainder immediately; it does not
   refund.** The wall names "przerwanie harmonogramu" as a variant but
   doesn't specify its accounting treatment. Phase 1 assumes the
   common case behind the wall's own example — a non-refundable annual
   license or prepaid service where the customer keeps what they paid
   for even if they stop using it early, so the remaining RMP balance
   is simply recognized as earned now. A cancellation that requires an
   actual refund is a different, already-served flow
   (`sales.SalesCreditMemo`/`SalesReturn`) — routing a refund through
   this module as well would conflate two different customer outcomes
   behind one command. **⚠ NEEDS HUMAN CONFIRMATION** if the "recognize
   immediately" default doesn't match how these particular contracts
   are actually is-sold.
7. **No automated scheduler — manual trigger only, Phase 1.** Matches
   this project's own established discipline (knowledge base §2,
   "Phase 1/Phase 2 scope discipline") and Fixed Assets' own identical
   choice for `accrueDepreciation`. Confirmed against two real systems
   (see Literature & Prior Art, Step 3) that this is not a foundational
   requirement: Odoo ships the equivalent capability as a separately
   *enabled* module, not a default; a working accounting system
   functions without it, recognizing deferred amounts via manual
   journal entries in the meantime, exactly as this project's own GL
   core engine already supports from Phase 1.
8. **A new liability-side account, `840`, is needed — the seeded chart
   has the asset side (`640`, RMK) but not the liability side.**
   Checked directly against `2026-09-15-default-chart-of-accounts.md`:
   Zespół 6 has `640 Rozliczenia międzyokresowe kosztów czynne` but
   Zespół 8 has no equivalent RMP row. Proposed as a forward-pointer
   patch (`840 Rozliczenia międzyokresowe przychodów`, CREDIT normal
   side), mirroring `640`'s own addition.

## Architecture

### `deferred_revenue` (Core)

- `data/entities.ts` — `RevenueDeferral` (header, one per deferred
  invoice line), `RevenueRecognitionScheduleEntry` (one row per period,
  see Data Model).
- `commands/deferRevenueRecognition.ts`, `commands/
  accrueRevenueRecognition.ts`, `commands/
  stopRevenueRecognitionSchedule.ts`.
- `lib/moduleConfig.ts` — registers `deferredRevenueLiabilityAccountId`.
- `AGENTS.md` — MUST NOT touch `SalesInvoiceLine`/`SalesInvoice` amount
  fields (the deferral is a GL-only reclassification, the invoice's own
  totals never change); MUST reject rather than default when
  `deferredRevenueLiabilityAccountId` is unset; MUST check the covering
  `FiscalPeriod` lock before every post, same as `accrueDepreciation`.
- **Depends on**: `ledger` (hard — posts `JournalEntry`), `sales` and
  `sales_invoice_gl_posting` (soft — direct `entityManager` reads only,
  no ORM relations, the same cross-module read posture Cash & Bank
  Management already established for reading `SalesInvoice`).

### Patch to sibling spec

- `2026-09-15-default-chart-of-accounts.md` — add the `840` `LedgerAccountType`
  row (Design decision 8).

## Data Model

### `deferred_revenue.RevenueDeferral`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organizationId` / `tenantId` | `uuid` | scope |
| `invoiceLineId` | `uuid` (FK-id, no ORM relation, unique) | the `sales.SalesInvoiceLine` this deferral covers — one deferral per line |
| `invoiceId` | `uuid` (FK-id) | denormalized for list/filter queries, matching `AssetDisposal`'s own convenience-FK precedent |
| `originalRevenueAccountId` | `uuid` (FK-id → `ledger.LedgerAccount`) | snapshot, read once from `SalesInvoiceLineRevenueAccount` at deferral time |
| `totalAmount` | `numeric(19,4)` | snapshot of the line's `totalNetAmount` at deferral time |
| `serviceStartDate` / `serviceEndDate` | `date` | the period the amount actually covers |
| `reclassificationJournalEntryReferenceId` | `uuid` (FK-id) | the entry that moved the amount from income to RMP |
| `status` | `'ACTIVE' \| 'STOPPED' \| 'COMPLETED'` | |
| `stoppedAt` | `date`, nullable | set by `stopRevenueRecognitionSchedule` |
| `createdAt` | `timestamptz` | |

### `deferred_revenue.RevenueRecognitionScheduleEntry`

One row per period per deferral, generated in full by
`deferRevenueRecognition` — never computed on read, the same posture
`DepreciationScheduleEntry` already established.

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `deferralId` | `uuid` (FK-id) | parent `RevenueDeferral` |
| `periodStartDate` / `periodEndDate` | `date` | |
| `plannedAmount` | `numeric(19,4)` | straight-line, last row absorbs the rounding remainder |
| `accruedAt` | `timestamptz`, nullable | null until posted |
| `journalEntryReferenceId` | `uuid` (FK-id), nullable | set atomically with `accruedAt` |

An unaccrued row (`accruedAt IS NULL`) may be deleted only by
`stopRevenueRecognitionSchedule`, and only after that command's own
catch-up step has run — never edited in place, matching `JournalEntry`'s
append-only posture once a row is accrued.

## API Contracts

### `POST /api/deferred_revenue/deferrals`

- **Body**: `{ invoiceLineId, serviceStartDate, serviceEndDate }`.
- **400**: `serviceEndDate <= serviceStartDate`; the invoice line
  already has a `RevenueDeferral` (one per line, no re-deferral).
- **404**: no `SalesInvoiceLineRevenueAccount` row for this line (line
  not yet posted to GL — nothing to reclassify).
- **422 `DEFERRED_REVENUE_ACCOUNT_UNSET`**: `deferredRevenueLiabilityAccountId`
  not configured.
- **201**: `{ deferralId, reclassificationJournalEntryId, scheduleEntryCount }`.

### `POST /api/deferred_revenue/accrue`

- **Body**: `{ asOf: string, deferralId?: string }`.
- **200**: `{ accrued: number, skipped: number, failed: number }` —
  same three-bucket shape `accrueDepreciation`'s own API already uses,
  for the same reason (a locked period is a skip, not a failure; an
  unexpected posting error is a failure, not silently dropped).

### `POST /api/deferred_revenue/deferrals/:id/stop`

- **Body**: `{ stopDate: string }`.
- **409**: deferral already `STOPPED`/`COMPLETED`.
- **200**: `{ catchUpAccrued: number, finalRecognitionJournalEntryId,
  remainingScheduleEntriesVoided: number }`.

## UI/UX

A "Defer recognition" action on an already-posted `SalesInvoiceLine`
row (visible only once `SalesInvoiceLineRevenueAccount` exists for it),
asking for the service period and showing the computed monthly schedule
before confirming — the same preview-before-commit pattern already used
by `generateAnnualStatements` (#6188) and the FX revaluation run
(#6190). A read-only schedule view per deferral, and a "Stop" action
with a confirmation showing exactly what will be recognized immediately.

## Edge Cases & Failure Scenarios

- **A one-month service period** (`serviceStartDate`/`serviceEndDate`
  span less than a full period). Produces a single schedule row for
  the whole amount — deferring something that resolves to "recognize
  it all next period" is a legitimate, if trivial, case, not an error.
- **Deferring a line whose invoice is later corrected** (a sales
  correction/credit memo against an already-deferred line). Not
  designed here — flagged in Risks, since `deferRevenueRecognition`
  has no awareness of a later `SalesCreditMemo` reducing the same
  line's amount.
- **`accrueRevenueRecognition` run against a locked `FiscalPeriod`.**
  Skipped, not failed — reported in the `skipped` bucket, exactly
  `accrueDepreciation`'s existing behavior for the same situation.
- **`stopRevenueRecognitionSchedule` called after the schedule has
  already fully accrued.** Rejected (**409**, already `COMPLETED`) —
  nothing left to stop.
- **Re-running `accrueRevenueRecognition` for the same `asOf` twice.**
  Idempotent: the second run only selects rows still matching
  `accruedAt IS NULL`, so nothing double-posts — same idempotency
  guarantee `accrueDepreciation` already provides.

## Risks & Impact Review

- **A `SalesCreditMemo`/`SalesReturn` against an already-deferred line
  has no defined interaction with this module** — the remaining
  schedule keeps recognizing the original amount even if the
  underlying sale was partially reversed elsewhere. Named here, not
  designed around; a real gap for whoever builds the first case that
  needs it.
- **Design decision 6's "recognize immediately" policy on early stop is
  an assumption, not a confirmed business rule** — flagged **⚠ NEEDS
  HUMAN CONFIRMATION**.
- **No code exists yet for `deferred_revenue`, `sales_invoice_gl_posting`,
  or `ledger`** — this spec's integration points
  (`SalesInvoiceLineRevenueAccount`, `ledger.postJournalEntry`) are
  checked against sibling specs' text, not a running system.

## Alternatives considered

- **Extracting a shared generic scheduling module now, covering both
  this and Fixed Assets' RMK** — rejected for the reason Fixed Assets'
  own spec already gave for not doing this the first time: one clean
  extraction needs at least two real consumers whose actual shapes are
  known, and this document was specifically checked against the source
  material to confirm leasing/loan reuse has no signal there (see
  Problem Statement) — building a generic abstraction for a third
  consumer that doesn't exist yet would repeat the exact mistake Fixed
  Assets avoided. A real extraction is a legitimate future step once
  this module and Fixed Assets' both exist as real, running code and
  their actual overlap can be measured instead of guessed.
- **Intercepting `postSalesInvoiceToLedger` itself** so a deferred line
  never touches the income account in the first place (ERPNext/Odoo's
  approach) — rejected for Phase 1: it would require editing
  `sales-invoice-gl-posting.md`'s own posting logic, a sibling spec
  this document has no need to touch. The two-step reclassify-then-
  recognize approach costs one extra `JournalEntry` per deferral but
  keeps this module fully additive.
- **Percent-of-completion revenue recognition** — rejected per Design
  decision 4; the source material itself calls this undefined.

## Out of scope

- Percent-of-completion / milestone-based recognition.
- Multi-element contract allocation (SPEC-024 §3.5's larger "Revenue
  Recognition" topic).
- Reuse by a future leasing or loan/bond installment module — no
  signal for this in the source material this spec was checked
  against (see Problem Statement).
- An automated accrual scheduler (Phase 2, matching Fixed Assets'
  identical deferral).
- Refund-triggered early stop (routes through `SalesCreditMemo`/
  `SalesReturn` instead, per Design decision 6).
- A generic, shared scheduling library covering both this module and
  Fixed Assets' RMK (see Alternatives considered).

## Implementation Plan

1. Patch `2026-09-15-default-chart-of-accounts.md` with the `840` account
   (Design decision 8).
2. Scaffold `deferred_revenue`: entities, `AGENTS.md`, module
   registration, `ledger`/`sales`/`sales_invoice_gl_posting` dependency
   declarations.
3. Implement `deferRevenueRecognition` (reclassification post +
   schedule generation).
4. Implement `accrueRevenueRecognition`, mirroring `accrueDepreciation`'s
   paging/idempotency/lock-skip mechanics.
5. Implement `stopRevenueRecognitionSchedule`.
6. Build the preview-before-commit UI.
7. Confirm Design decision 6's early-stop policy with the user before
   implementation locks it in.

## File Manifest

| File | Change |
|---|---|
| `.ai/specs/2026-09-17-deferred-revenue.md` | New (this document) |
| `packages/core/src/modules/deferred_revenue/data/entities.ts` | New — `RevenueDeferral`, `RevenueRecognitionScheduleEntry` |
| `packages/core/src/modules/deferred_revenue/AGENTS.md` | New |
| `packages/core/src/modules/deferred_revenue/commands/deferRevenueRecognition.ts` | New |
| `packages/core/src/modules/deferred_revenue/commands/accrueRevenueRecognition.ts` | New |
| `packages/core/src/modules/deferred_revenue/commands/stopRevenueRecognitionSchedule.ts` | New |
| `.ai/specs/2026-09-15-default-chart-of-accounts.md` | Patch — `840` RMP account |

## Literature & Prior Art

### Step 1 — Cross-spec consistency

Checked directly against the actual Event Storming source files
(`Claude outputs/eventstormingpodsumowanie.md`, `eventstormingfinal.md`,
`eventstormingwall.html`) rather than an earlier, informal paraphrase of
them — see Problem Statement for the correction this produced (no
leasing/loan signal anywhere in the source; RMP/AR is the only "own
spec" the wall actually names). Fixed Assets
(`2026-09-06-fixed-assets.md`) is the direct structural precedent —
its own Design decisions and Out of scope ("Generic RMK/scheduled-
recognition extraction... deliberately deferred architectural debt")
are the basis for Design decisions 1 and the Alternatives-considered
entry on shared extraction. `sales-invoice-gl-posting.md` checked
directly for `SalesInvoiceLineRevenueAccount`'s existence (Design
decision 5) and confirmed `SalesInvoiceLine`/`SalesInvoice` have no
service-period or deferral fields of their own (checked directly
against `packages/core/src/modules/sales/data/entities.ts`).
`2026-09-15-default-chart-of-accounts.md` checked directly for the
missing `840` account (Design decision 8).

### Step 2 — Literature grounding

- **Kieso, Ch.3, Illustration 3.21 "Categories of Adjusting Entries" —
  Confirmed.** Prepaid expenses and unearned revenues named as the two
  deferral categories, mirror images of each other. Ch.3, "Unearned
  Revenues" section — Confirmed, directly on point: *"When companies
  receive cash before services are performed, they record a liability
  by increasing (crediting) a liability account called unearned
  revenues... Intel subsequently recognizes revenue when it performs
  the service. However, making daily entries to record this revenue is
  impractical. Instead, Intel delays recognition of revenue until the
  adjustment process."* — grounds this spec's core mechanism almost
  word for word (defer to a liability, recognize periodically, exactly
  the wall's own "Zawieszono na koncie bilansowym → Wygenerowano
  harmonogram").
- **Ustawa o rachunkowości — the accrual principle itself (Art. 6) is
  Unverified this session.** The extracted statute text available
  (`/tmp/uor.txt`) runs Art. 9 through roughly Art. 25; Art. 6, which
  would state the memoriał (accrual) principle directly, is not in
  range. This spec's premise (revenue must be recognized in the period
  it's earned, not when cash arrives) is not sourced from the statute
  directly this session — flagged rather than assumed.
- **Fowler, Hay — Confirmed absence**, consistent with the established
  pattern for both books: zero hits for "deferred revenue," "unearned
  revenue," "prepaid," or "amortization schedule" in either full text.

### Step 3 — Real-system comparison

- **ERPNext, "Deferred Accounting"** (docs.frappe.io/erpnext/deferred-accounting,
  docs.erpnext.com/docs/user/manual/en/deferred-accounting, verified
  2026-09-17): a native, built-in feature handling deferred revenue and
  deferred expense with the same underlying logic — mirrored debit/
  credit direction, not two separate mechanisms. Confirms Design
  decision 2's implicit assumption (a deferral mechanism is naturally
  direction-symmetric) even though this spec only builds the revenue
  side. Offers both a manual trigger ("Process Deferred Accounting")
  and an optional scheduler — the same duality this spec's own Design
  decision 7 adopts.
- **Odoo, "Deferred revenues"** (odoo-users.readthedocs.io/en/latest/accounting/receivables/customer_invoices/deferred_revenues.html,
  verified 2026-09-17): confirmed to be an **optional, separately
  enabled** module ("Assets management & revenue recognition" — not
  part of default accounting), directly supporting Design decision 7's
  claim that this capability is not foundational. Once enabled, the
  mechanism matches this spec's own shape closely: a deferred-revenue
  liability account credited at invoice time, drawn down monthly
  against the income account, worked example given as a $24,000/24-month
  contract recognizing $1,000/month — the same straight-line, "1/12
  per period" shape as this spec and the Event Storming wall's own
  example.

## Changelog

- **2026-09-17** — Initial draft. Step 1 corrected a scope
  misattribution from an earlier informal summary (no leasing/loan
  signal in the actual Event Storming source files — see Problem
  Statement); scope narrowed to exactly what the wall names ("own
  spec": revenue recognized over time for sales/AR). Steps 2–3
  completed; Design decision 6 (early-stop policy) flagged **⚠ NEEDS
  HUMAN CONFIRMATION**.
