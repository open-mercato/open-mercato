# Multi-Currency: Exchange Rate Integration & Period-End FX Revaluation

> **Temporary location.** This document lives at
> `.ai/specs/2026-09-17-multi-currency.md` on branch `docs/multi-currency`
> pending review and merge, per this project's spec-authoring convention.

## TLDR

The `currencies` module (`packages/core/src/modules/currencies`) is
**already a fully implemented, production-grade module** — date-based
exchange rates, multi-provider fetching (NBP, Raiffeisen), historical
lookback, and a stable `ExchangeRateService.getRate()` API already
consumed in production by `customers/api/deals`. This spec is **not**
about designing a rate engine. Its actual, much narrower job is two
concrete gaps that four independent sibling specs have already flagged
and deferred here: (1) `accounts_payable.VendorInvoice` and
`sales.SalesInvoice` need `exchangeRate` (and, for `SalesInvoice`, a
proper `currencyId`) captured at document time so downstream GL
posting and settlement have a booked rate to work from, and (2) nothing
today revalues **open** (unsettled) foreign-currency AP/AR balances at
period end — the "wycena bilansowa" a Polish-entity's books need at
each balance-sheet date. Realized gain/loss at settlement is already
fully designed by Cash & Bank Management (#6055); this spec adds the
missing unrealized/period-end half, as a small new module that reuses
General Ledger's existing reversal mechanism rather than inventing a
new one.

## Problem Statement

The financial-module Event Storming recording named Multi-Currency as
priority #2 of the five topics still open after Annual Financial
Statements (#6188), Tax Management (#6168) and Compliance & Audit
(#6038 Phase 2) shipped. Unlike topic #1, the recording itself doesn't
discuss Multi-Currency directly — the earlier ERPNext/Odoo/Kieso
comparison had already flagged it as a real gap, and four sibling
specs, written independently over several weeks, all arrived at the
same conclusion and explicitly punted the topic here:

- **GL core engine (#5663)**, Design decisions: *"Currency is reused
  from the existing `currencies` module"* — `JournalEntry.currencyId`
  and `JournalEntry.exchangeRate` (header fields) plus
  `JournalEntryLine.amountCurrency` already exist as of Phase 1 — but
  *"Multi-currency FX revaluation and reporting"* is explicitly listed
  as deferred to **"a future Multi-Currency spec."**
- **GL account balances (#6013)**, API Contracts: `GET
  /api/ledger/accounts/:id/balance` returns `{ ..., currency: null }`
  — *"`currency` is explicitly `null` in Phase 1 (no multi-currency
  balance conversion...) rather than omitted, so a client can't
  mistake its absence for 'same as the tenant's base currency' by
  accident."* Out of scope: *"a foreign-currency-denominated balance
  view is a Multi-Currency-spec concern, same boundary #5663 already
  drew."*
- **Cash & Bank Management (#6055)**, currency/FX section: fully
  designs **realized** gain/loss at settlement
  (`matchBankStatementLine`'s `sales_invoice` path, `bookedExchangeRate`
  required and rejected with `EXCHANGE_RATE_REQUIRED` if missing when
  currencies differ) — but this only works because the accountant
  types the rate in by hand at match time, precisely *because* neither
  `VendorInvoice` nor `SalesInvoice` carries one yet.
- **Sales Invoice → GL Posting (#6046-adjacent, `docs/sales-invoice-gl-posting`)**,
  Out of scope: *"Multi-currency exchange-rate handling — this document
  resolves `currencyCode` to a `currencyId` (a required lookup, not
  optional) but does nothing with `SalesOrder.exchangeRate` or any FX
  gain/loss recognition; every invoice this module posts is assumed to
  be in the tenant's own bookkeeping currency for Phase 1."*

Four independent specs deferring to the same not-yet-written document
is a stronger signal than any single recording mention — and, checked
directly against the real (non-dated-spec) `sales` module source
(`packages/core/src/modules/sales/data/entities.ts`), `SalesOrder`
already has both `currencyCode` and `exchangeRate`
(`numeric(18,8) nullable`, lines 374–377); `SalesInvoice` and
`SalesQuote` have only `currencyCode` (lines 1412/626) — confirming the
gap firsthand rather than by secondhand reference.

## Proposed Solution

Two independent, additive pieces — no new rate infrastructure, no
rewrite of any sibling spec:

**A. `exchangeRate` (and, for `SalesInvoice`, `currencyId`) on the two
foreign-currency-capable AP/AR documents**, resolved once via
`currencies.ExchangeRateService.getRate()` at document-creation time
and stored — mirroring the precedent `fixed_assets.FixedAsset` already
set (`exchangeRate` resolved from `currencies.ExchangeRate` at
`acquisitionDate`, `acceptFixedAsset` rejecting rather than silently
skipping when no rate is resolvable). This spec proposes the field
additions and the resolution rule; the actual schema change lands as a
small patch to `accounts-payable.md` and the sales-side spec that owns
`SalesInvoice` (`sales-invoice-gl-posting.md` or wherever `SalesInvoice`
itself is next revised), the same forward-pointer pattern used for
GL account balances and Posting Rules Engine when Annual Financial
Statements (#6188) shipped.

**B. A new, deliberately small Core module, `fx_revaluation`**, whose
only job is: at period end, find every AP/AR document still open in a
non-base currency, get the valuation-date rate from the existing
`ExchangeRateService`, compute the unrealized gain/loss against each
document's booked `exchangeRate`, and post one balanced `JournalEntry`
— reusing GL core engine's existing `REVERSAL` mechanism (not a new
`JournalEntry.type`) to unwind the prior period's valuation
automatically before posting the new one, exactly as Kieso's Appendix
3B describes reversing entries: *"A reversing entry is the exact
opposite of the adjusting entry made in the previous period."*

## Design decisions

1. **No new rate engine — this is an integration spec, not an
   infrastructure spec.** `currencies.AGENTS.md` already mandates
   4-decimal-precision dual recording, date-based (not "current")
   rate lookup, multi-provider fetch with historical lookback, and
   explicitly forbids truncating to 2 decimals or hard-deleting rate
   history. Re-specifying any of this would contradict a module that
   already has three-plus years of accumulated, tested design
   decisions behind it (per its own "Ask First" list: precision,
   rate-lookup semantics, gain/loss formulas, and historical-rate
   retention are all already decided and off-limits to casually
   change). This spec only calls `ExchangeRateService.getRate()` and
   `getRates()` — it adds no new public surface to `currencies`.

2. **`exchangeRate` is captured once, at document creation — not
   re-resolved at posting time, and not optional once the currency
   differs from base.** This mirrors `FixedAsset.exchangeRate`
   exactly: resolved once against `acquisitionDate` (there) or
   `issueDate` (here), stored, and the creating command **rejects**
   (doesn't silently default to `1` or skip) if the rate-selection
   policy in Design decision 9 can't resolve a usable rate even after
   `ExchangeRateService`'s own `maxDaysBack`/`autoFetch` fallback.
   Re-resolving at posting time would let the booked rate silently
   drift from what the vendor/customer actually saw on the document —
   never re-derive a rate that was already fixed at document time.
   **Correction (maintainer-review round):** an earlier draft justified
   this by analogy to `currencies.AGENTS.md`'s `isActive` rule
   ("MUST NOT filter rate fetching by `isActive`"). Checked directly
   against the primary source: that rule governs which *currencies*
   `RateFetchingService` fetches new rates for (never skip a
   not-soft-deleted currency because it's flagged inactive for new
   *use*) — a different `isActive` flag, on `Currency`, from the one
   on `ExchangeRate` rows. `ExchangeRateService.findExactRates()` does,
   correctly, filter stored `ExchangeRate` rows by their own
   `isActive: true` (a rate record can be deactivated if superseded/
   corrected) — the code does exactly what the AGENTS.md guide says
   nothing against. The analogy was a mismatch and is dropped; the
   "never re-derive a fixed rate" rule stands on its own without it.

3. **`SalesInvoice` needs two fields, not one — `currencyId` (new) and
   `exchangeRate` (new) — because it currently has neither, only a
   free-text `currencyCode`.** `VendorInvoice` already has `currencyId`
   (per Accounts Payable's Architecture: *"`currencyId` (FK-id,
   `uuid`, like `JournalEntry.currencyId` in GL)"*) so it only needs
   `exchangeRate` added. `sales-invoice-gl-posting.md`'s own
   `postSalesInvoiceToLedger` currently resolves `currencyCode` →
   `currencyId` itself, at posting time, by querying
   `currencies.Currency` (*"a step this document owns, since neither
   side already has it"*). Once `SalesInvoice.currencyId` exists at
   creation time, that resolution becomes redundant with a value
   already on the row — **this spec does not rewrite that command**,
   it only flags the coordination point (see Risks) so whoever next
   touches `sales-invoice-gl-posting.md` reads the stored
   `currencyId` instead of re-resolving it.

4. **Period-end FX revaluation is a GL-only adjustment on top of the
   sub-ledger, not a rewrite of AP/AR balances.** `VendorInvoice.
   outstandingAmount`/`SalesInvoice.outstandingAmount` stay denominated
   in the document's own currency, untouched — the revaluation entry
   adjusts the **base-currency** book value of the relevant control
   account (via a `JournalEntry`) and posts the offsetting side to one
   of two dedicated unrealized gain/loss accounts (Design decision 11
   — gain and loss are kept separate, not netted into one account, per
   Polish statutory P&L presentation), the same "control account +
   subsidiary ledger stays independent" convention already settled
   project-wide (knowledge-base §2). It does **not** attempt to make
   `#6013`'s
   `getAccountBalance` multi-currency-aware (see Alternatives
   considered) — the revaluation command reads open AP/AR documents
   directly via `entityManager`, the same direct cross-module read
   pattern Cash & Bank Management already uses for `SalesInvoice`.

5. **No new `JournalEntry.type` value — reuse `REVERSAL` and
   `referenceType` tagging instead.** GL core engine's `type` enum is
   `NORMAL` / `CLOSING` / `OPENING` / `REVERSAL`, each already
   justified by an existing design decision ("Corrections are
   reversals, not undo"). Adding a fifth value (e.g. `ADJUSTING`)
   would touch `ledger`'s own schema and every place that switches on
   `type`. Instead, the revaluation entry posts as an ordinary
   `NORMAL` entry tagged `referenceType: 'fx_revaluation:period_end'`,
   `referenceId: <FxRevaluationRun.id>` — the same tagging convention
   Cash & Bank Management already uses
   (`referenceType: 'cash_bank_management:bank_statement_line'`) — and
   is unwound at the start of the next run via GL core engine's
   dedicated `reverseJournalEntry` command (never `postJournalEntry`
   called with a `type: 'REVERSAL'` override — that is not the
   documented contract; `reverseJournalEntry` posts the linked
   `REVERSAL` entry with inverted lines and its **own**
   `operationDate`, per GL core engine's Commands section), linked
   back via the same `referenceType`/`referenceId` pair. Kieso, Ch. 3,
   "Reversing Entries—An Optional
   Step" (p. 3-35 — the section introducing Appendix 3B, not the
   appendix's own worked pages): *"A reversing entry is the exact
   opposite of the adjusting entry made in the previous period. Use
   of reversing entries is an optional bookkeeping procedure..."* —
   GL core engine
   already made reversal its one correction mechanism, so this spec
   is applying an existing, already-adopted pattern to a new use case,
   not introducing one.

6. **Reversal-then-repost is one command, not two.** Running
   `fx_revaluation.revalueOpenBalances` for a period reverses the most
   recent *unreversed* prior run for the same tenant/organization (if
   any) and computes and posts a fresh valuation against the requested
   `valuationDate`, in one command/one transaction — never two
   separate top-level calls the caller has to sequence itself. This
   keeps the operation idempotent under re-runs before period close
   (re-running it just reverses-and-reposts) and matches the
   "reversing entries happen at the start of the next period,
   immediately before that period's entries resume" sequencing Kieso
   describes. **Correction (maintainer-review round):** the *order*
   implied above — reverse, then validate the new valuation — was
   backwards, and is corrected in Design decision 10: every check
   (rates, document data, staleness, base currency) runs first, and
   the reversal only happens once all of them pass, inside a single
   locked transaction. This decision's "one command, not two" claim
   stands; Design decision 10 fixes the internal step order.

7. **Realized gain/loss stays exactly as Cash & Bank Management (#6055)
   already designed it — this spec does not re-derive that formula.**
   `matchBankStatementLine`'s `sales_invoice` path already computes
   `statementLineAmountInBankCurrency - (matchedAmountInInvoiceCurrency
   * bookedExchangeRate)` at settlement, consistent with
   `currencies.AGENTS.md`'s own canonical formula `(payment rate −
   invoice rate) × foreign amount`. Once `VendorInvoice.exchangeRate`/
   `SalesInvoice.exchangeRate` exist (this spec, part A), that
   `bookedExchangeRate` input can be defaulted from the invoice's own
   stored rate instead of always requiring manual entry — a coordination
   note for #6055, not a redesign (see Risks).

8. **Legal grounding for base currency, and an explicit unverified
   gap on the valuation rule itself.** Ustawa o rachunkowości, Art. 9
   (checked directly against the extracted statute text): *"Księgi
   rachunkowe prowadzi się w języku polskim i w walucie polskiej"*
   (accounting books are kept in Polish and in Polish currency) —
   confirms a Polish-registered tenant's base/functional currency is a
   legal given (PLN), not a UI-configurable preference, which is why
   `currencies.Currency.isBase` is treated as fixed per tenant
   throughout this spec. **However**, the specific rule mandating
   period-end revaluation of foreign-currency monetary balances (UoR
   Art. 30, "wycena bilansowa") is **not** in the extracted statute
   text available this session (which runs Art. 9 through roughly
   Art. 25 — Rozdział 2 only, not Rozdział 4 "Wycena aktywów i
   pasywów" where Art. 30 lives). This spec's revaluation design
   (recognize unrealized gain/loss through P&L at each valuation date,
   no equity/OCI deferral) is the working assumption based on general
   double-entry practice and is flagged
   **⚠ NEEDS HUMAN CONFIRMATION** pending the actual Art. 30 text —
   same discipline as the Załącznik nr 1 flag in #6188.

9. **Rate resolution: `currencyId` → code once per run, then a
   deterministic provider-priority pick from `RateResult.rates` — not
   the first array entry.** Checked directly against
   `services/exchangeRateService.ts` and both provider
   implementations (`providers/nbp.ts`, `providers/raiffeisen.ts`):
   `getRate`/`getRates` take **codes**, not `currencyId`s, and
   `RateResult.rates` is an **array** (every provider row for that
   exact pair/date/source), not a scalar — the existing
   `customers/api/deals/aggregate/route.ts` consumer that reads
   `rates[0]` for display is not a precedent to follow for a posting
   decision. The policy this spec defines:
   a. **Code resolution.** Resolve every in-scope `currencyId` (each
      distinct document currency, plus the tenant's base currency) to
      its `Currency.code` once per run via a single scoped query
      (`organizationId`/`tenantId` + `id IN (...)`), not a per-document
      lookup.
   b. **Query direction is fixed: document-currency code →
      base-currency code**, matching the Data Model's existing
      `unrealizedGainLoss = outstanding × (valuationRate − bookedRate)`
      formula, which only balances if `exchangeRate` means "base-
      currency units per one document-currency unit." Checked against
      both providers' own source comments: for this exact direction
      (`XXX → PLN`), NBP and Raiffeisen both always tag the row
      `type: 'buy'` ("bank buys foreign currency, gives PLN") — the
      direction, not an independent choice, fixes the type for every
      provider-fetched row. `ExchangeRate`'s own uniqueness constraint
      (`organizationId, tenantId, fromCurrencyCode, toCurrencyCode,
      date, source`) confirms at most one row per source for a fixed
      direction/date — so the only real multiplicity within
      `RateResult.rates` for this query is **which provider**
      (`source`), not which `type`.
   c. **Provider priority, explicit and configurable.** Both bundled
      providers require PLN on one side of the pair (checked directly
      — `providerBaseCurrency = 'PLN'`, gated by
      `availableCurrencies.has('PLN')` in both `fetchRates`
      implementations), so this policy is written for the PLN-base
      case this spec already treats as the working assumption (Design
      decision 8). Default provider priority: `['NBP', 'Raiffeisen
      Bank Polska']` (NBP first, as the central-bank source; see
      Design decision 8's Art. 30 flag for the separate, still-open
      question of whether NBP's *Table A* average rate — which this
      module's `NBPProvider` does not fetch at all, only NBP's Table C
      bid/ask — is what Art. 30 actually requires). Configurable via
      `ModuleConfigService` under `fx_revaluation.ratePriority`
      (ordered `source` list), same cross-module config pattern Cash &
      Bank Management already uses for its own account lookups. Any
      remaining ambiguity after priority ordering (e.g., two manual
      entries from differently-named sources for the same pair/date)
      is rejected — **422 `EXCHANGE_RATE_AMBIGUOUS`** — rather than
      picked arbitrarily.
   d. **Empty/error results.** `RateResult.rates.length === 0` after
      the service's own `maxDaysBack`/`autoFetch` fallback, or a
      populated `RateResult.error` from a batched `getRates()` call,
      both surface as the existing **422
      `EXCHANGE_RATE_UNAVAILABLE`** (API Contracts) — the `error`
      case includes the underlying message for diagnosis.
   e. **Immutable provenance, stored, not re-derived.** Once selected,
      the chosen `ExchangeRate.source` and its actual resolved date
      (`RateResult.actualDate`, which can be earlier than the
      requested `valuationDate` after fallback) are persisted on
      `FxRevaluationLine` (see Data Model) — a later re-run or audit
      never has to re-guess which of several candidate rows was used.

10. **Reversal-then-repost validates everything before any write, and
    is concurrency-safe.** Fixes an ordering bug: an earlier draft's
    API Contracts reversed the prior run *before* checking for missing
    rates or missing document rates, so a later `422` could delete a
    valid prior valuation while posting no replacement — contradicting
    this document's own "no partial run" claim. Corrected order,
    inside one `em.transactional()` block (see Architecture):
    a. `SELECT ... FOR UPDATE` the current `'POSTED'`
       `FxRevaluationRun` row for this `tenantId`/`organizationId` (if
       any) — this is the concurrency guard: a second, concurrent call
       blocks here until the first transaction commits, then re-reads
       and correctly targets whatever run is current at that point,
       rather than two callers both reversing the same row.
    b. Resolve every needed rate (Design decision 9) and validate
       every in-scope document has a non-null `exchangeRate` — **no
       write yet**. Any failure here (`EXCHANGE_RATE_UNAVAILABLE`,
       `EXCHANGE_RATE_MISSING_ON_DOCUMENT`, `EXCHANGE_RATE_AMBIGUOUS`)
       aborts before touching the locked row.
    c. Only once (b) fully succeeds: if the locked prior run has a
       non-null `journalEntryId`, call
       `commandBus.execute('ledger.reverseJournalEntry', ...)` and
       mark it `REVERSED`; if it was itself a no-op run
       (`journalEntryId: null`), just mark it `REVERSED` — nothing to
       reverse (an explicit test case, per the maintainer review).
    d. Post the new `NORMAL` entry (or none, if every individual delta
       is exactly zero — see Design decision 11) and insert the new
       `FxRevaluationRun`/`FxRevaluationLine` rows, all in the same
       transaction as (a)–(c). A failure at any point rolls back the
       whole step — the prior run's `REVERSED` mark and the new run's
       insert commit together or not at all, so "no partial run" is
       now a transactional guarantee, not just a stated intent.

11. **Sign convention is document-type-dependent, and a leg is only
    ever omitted when its own delta is exactly zero — never the whole
    entry because the total nets to zero.** An earlier draft applied
    the same signed `outstanding × (valuationRate − bookedRate)` to
    both AR and AP and skipped posting whenever the **total** summed
    to zero. Both are wrong: a rate move that increases the
    base-currency value of an open position is a **gain** on a
    receivable (asset) but a **loss** on a payable (liability) — the
    same rate move, opposite P&L sign — and an AR gain of 20 netting
    against an AP loss of 20 still requires two real, nonzero postings
    (to the AR control account and the AP control account
    respectively), even though the P&L total is zero. Corrected rule:
    `unrealizedGainLoss = outstanding × (valuationRate − bookedRate) ×
    (documentType === 'sales_invoice' ? +1 : −1)` — a positive result
    is always a gain (unrealized-gain account credited, control
    account debited for the offsetting base-currency increase) and a
    negative result always a loss (unrealized-loss account debited,
    control account credited), regardless of document type. The
    journal entry aggregates per control account (one net line per
    `documentType`'s control account, not one line per document) and
    per gain/loss side, and **omits only a specific leg whose own
    amount is exactly `0`** — the whole entry is skipped only when
    every in-scope document's individual delta is `0` (i.e., no
    open foreign-currency exposure moved at all), matching the
    existing "no open documents" no-op case, not the "deltas offset
    each other" case. Worked example (PLN base, rate moves from 4.30
    to 4.50 PLN/EUR):

    | Document | Type | Outstanding (EUR) | Δrate | Unrealized Δ (PLN) | Dr | Cr |
    |---|---|---|---|---|---|---|
    | Invoice A | `sales_invoice` (AR) | 1,000 | +0.20 | **+200 (gain)** | AR control 200 | Unrealized FX gain 200 |
    | Invoice B | `vendor_invoice` (AP) | 1,000 | +0.20 | **−200 (loss)** | Unrealized FX loss 200 | AP control 200 |

    Net P&L effect is `0` (gain 200 offsets loss 200), but the entry
    still posts **four** lines, not zero — the control-account
    balances for AR and AP both genuinely moved. Control accounts are
    read the same way Cash & Bank Management already reads
    `sales_invoices_gl_posting`'s `receivableAccountId` — a scoped
    `ModuleConfigService.get('accounts_payable', 'payableAccountId',
    ...)` / `ModuleConfigService.get('sales_invoices_gl_posting',
    'receivableAccountId', ...)` call — and the unrealized gain/loss
    account(s) are this module's own `ModuleConfigService` keys,
    `fx_revaluation.unrealizedGainAccountId` /
    `fx_revaluation.unrealizedLossAccountId` (two accounts, not one,
    since gain and loss are genuinely different P&L line items in
    Polish statutory presentation, unlike Cash & Bank Management's
    single netted `gainLossAccountId` for one document's own
    settlement).

12. **The prior valuation is reversed at the start of the next run,
    which must happen before any settlement of the revalued documents
    in the new period — not merely "at the next revaluation run."**
    Closes a real gap: for an invoice booked at 400 (PLN), revalued to
    420 at period end, then **settled for 420** early in the new
    period before the next revaluation run executes, the unchanged
    Cash & Bank Management settlement design clears the booked 400 and
    recognizes a realized gain of 20 — but the prior period's
    unreversed 20 unrealized-gain entry is *still on the books*, so the
    control account carries a stale 20 on a document that no longer
    exists as an open exposure, and total recognized gain doubles (20
    unrealized + 20 realized) for what was, economically, a single
    20 movement. Fix: `fx_revaluation.AGENTS.md` gains a MUST —
    whichever process settles a foreign-currency document (Cash & Bank
    Management's `matchBankStatementLine`) MUST check, before matching,
    whether that document is a line in the current (unreversed)
    `FxRevaluationRun`, and if so, require that run to be reversed
    first (a `409 PRIOR_VALUATION_NOT_REVERSED` from
    `matchBankStatementLine`, pointing at the specific
    `FxRevaluationRun`) — coordinating with the settlement path is a
    small, additive precondition, not a redesign of Cash & Bank
    Management's own formula (Design decision 7 still holds). This is
    a new cross-spec coordination point for `cash-bank-management.md`,
    added to Patches to sibling specs and Risks below, alongside the
    existing `bookedExchangeRate`-defaulting note.

13. **`valuationDate` must be recent, not arbitrarily historical — this
    module reconstructs nothing.** An earlier draft let
    `valuationDate` default to "the period's end date" with no
    freshness check, but `VendorInvoice.outstandingAmount`/
    `SalesInvoice.outstandingAmount` are **current-state** columns, not
    a point-in-time ledger a historical run could reconstruct from —
    a document open on Dec 31 but paid Jan 3, or partially paid after
    the cutoff, would already show a changed `outstandingAmount` by
    the time a late run executes, silently misstating exposure. Per
    this document's own "simplest solution" discipline (Alternatives
    considered) — a dated-allocation/historical-snapshot engine is out
    of scope, not a gap to quietly accept — the fix is a scope
    restriction, not new infrastructure: **`valuationDate` must fall
    within a configurable grace window of "today"**
    (`fx_revaluation.valuationGraceDays`, default `10`, covering a
    realistic month-end close cycle that finishes a few business days
    into the next month) and the referenced `FiscalPeriod` must still
    be the tenant's **most recently closed-or-closing** period, not an
    arbitrarily old one. A `valuationDate`/`fiscalPeriodId` combination
    outside that window is rejected — **422
    `VALUATION_DATE_TOO_STALE`** — with the message directing the
    caller to run revaluation promptly at period-end rather than
    reconstruct exposure retroactively. This is a real, acknowledged
    capability boundary (see Out of scope), not a silent
    approximation.

14. **A cross-currency settlement (bank currency ≠ base ≠ invoice
    currency) cannot default `bookedExchangeRate` from the invoice's
    own stored rate — that rate is in the wrong units.** Design
    decision 7's default-from-invoice coordination note for Cash &
    Bank Management assumed a two-currency world. Checked directly
    against `2026-09-10-cash-bank-management.md`'s own contract:
    `bookedExchangeRate` there is **bank-currency units per
    invoice-currency unit**, while `SalesInvoice.exchangeRate`/
    `VendorInvoice.exchangeRate` (this spec) are **base-currency units
    per document-currency unit** (Design decision 9b). With PLN base,
    an EUR invoice, and a USD bank account, the invoice's stored
    `4.5` (PLN/EUR) cannot stand in for the `1.1` (USD/EUR) the
    settlement needs — different units entirely. Corrected coordination
    note for `cash-bank-management.md`: the default-from-invoice
    behavior applies **only when the bank account's currency equals
    the tenant's base currency** (the common case, and the only case
    the units actually agree); when it differs, `bookedExchangeRate`
    is either entered explicitly (unchanged current behavior) or
    derived via an explicit two-hop, dated cross-rate — invoice
    currency → base (this spec's stored rate) then base → bank
    currency (a fresh `ExchangeRateService.getRate()` call for the
    settlement date) — which `cash-bank-management.md` would need to
    implement itself as an opt-in, not something this spec silently
    assumes. Worked three-currency example: PLN base, EUR 1,000
    invoice booked at `4.30` PLN/EUR (= 4,300 PLN), settled via a USD
    bank account where PLN/USD on the settlement date is `4.00`; the
    cross-rate is `4,300 PLN ÷ 4.00 PLN/USD = 1,075 USD` — the
    `bookedExchangeRate` Cash & Bank Management's formula needs is
    `1,075 / 1,000 = 1.075` USD/EUR, not `4.30`.

15. **Pre-existing documents get `currencyId` backfilled but not
    `exchangeRate` — with a supported, explicit remediation command,
    not a permanent dead end.** `VendorInvoice`/`SalesInvoice` rows
    that predate this feature have `currencyCode` but neither
    `currencyId` nor `exchangeRate`. A one-time migration backfills
    `currencyId` for every existing row (a pure, rate-independent
    `currencyCode` → `Currency.id` lookup, scoped per
    `organizationId`/`tenantId`) — safe because it needs no historical
    rate. `exchangeRate` is **not** backfilled automatically (a
    retroactively "resolved" rate for a document issued months ago
    would be a guess, not the rate the party actually saw), so
    pre-existing foreign-currency documents stay excluded from
    revaluation scope (already covered in Edge Cases) until an
    operator explicitly runs a new, admin-triggered
    `fx_revaluation.backfillDocumentRate` command per document — which
    resolves `exchangeRate` via the **same** rule as new documents
    (Design decision 2: `ExchangeRateService.getRate()` against the
    document's own `issueDate`), an explicit, auditable, one-row-at-a-
    time action rather than a silent bulk guess. Once `currencyId`/
    `exchangeRate` exist on a document (new or backfilled), both are
    **immutable after the document posts** — a draft (pre-posting)
    edit to `currencyCode` or `issueDate` (both still editable per
    `sales.invoices.update`'s current contract, checked directly
    against `packages/core/src/modules/sales/commands/documents.ts`)
    triggers re-resolution of both fields, since the document isn't
    booked yet; once posted, `currencyCode`, `issueDate`, `currencyId`,
    and `exchangeRate` are frozen together (correcting a posted
    document means reversing it, the same "reversal not undo"
    discipline as GL core engine — see Out of scope) so the three
    fields can never silently diverge. `sales-invoice-gl-posting.md`
    (or wherever `sales.invoices.update` is next revised) needs to add
    this immutability guard once `SalesInvoice.currencyId`/
    `exchangeRate` exist — a new coordination point, added to Patches
    to sibling specs.

16. **A `FxRevaluationRun` snapshots the base currency it valued
    against — it does not trust `Currency.isBase` to still mean the
    same thing later.** Checked directly against
    `packages/core/src/modules/currencies/commands/currencies.ts`:
    `isBase` is **not** immutable — the existing `updateCurrency`
    command permits changing it, and base uniqueness is enforced only
    per `(organizationId, tenantId)` at write time, not pinned for all
    time. If an organization's base currency changed after documents
    were booked and runs were posted, re-deriving "the base currency"
    from `Currency.isBase` at read time would silently combine a
    stored rate (against the *old* base) with a fresh rate lookup
    (against the *new* base) — different units, same failure shape as
    Design decision 14. Fix: `FxRevaluationRun` stores
    `baseCurrencyId` at creation (see Data Model) — the base currency
    actually used for that run — and `revalueOpenBalances` **rejects**
    (**422 `BASE_CURRENCY_CHANGED`**) if the tenant's current
    `Currency.isBase` row doesn't match the most recent prior run's
    `baseCurrencyId`, rather than silently mixing units. This spec
    does not redesign `currencies.updateCurrency` itself (Design
    decision 1's boundary: no new public surface, no behavior change
    to that module) — it only adds the guard on its own side and
    flags, as a coordination note for whoever next revises the
    `currencies` module, that changing `isBase` for an organization
    with any posted foreign-currency AP/AR document or
    `FxRevaluationRun` is a data-migration event, not a config toggle,
    and should itself be gated once that module's own spec is next
    touched (see Risks).

## Architecture

### New module: `fx_revaluation` (Core)

- `data/entities.ts` — `FxRevaluationRun`, `FxRevaluationLine` (see
  Data Model).
- `commands/revalueOpenBalances.ts` — the one command this module
  exists for. Opens its own transaction (`em.transactional()`, the
  same "outer command owns the transaction, nested `commandBus.execute`
  calls join it" pattern Cash & Bank Management's
  `matchBankStatementLine` already uses for its own
  `ledger.postJournalEntry` call plus its own entity write in one
  commit). Inside that transaction: locks the current `'POSTED'`
  `FxRevaluationRun` row for this tenant/org with `SELECT ... FOR
  UPDATE` (if any), re-validates everything (rates, document data,
  fiscal-period lock) per Design decision 10 **before any write**,
  then — only once validation passes — calls
  `commandBus.execute('ledger.reverseJournalEntry', ...)` for the
  locked prior run's `journalEntryId` (skipped if that run was itself
  a no-op with `journalEntryId: null`), marks it `REVERSED`, and calls
  `commandBus.execute('ledger.postJournalEntry', ...)` once for the new
  valuation — never `postJournalEntry` with a `type: 'REVERSAL'`
  override for the unwind step, which is not the ledger's documented
  reversal contract (see Design decision 5 and 10). Reads open
  `VendorInvoice`/`SalesInvoice` rows directly via `entityManager`
  (scoped `tenantId`/`organizationId`, same cross-module direct-read
  precedent as Cash & Bank Management), calls
  `currencies.ExchangeRateService.getRates()` (batch) for the
  valuation date, and computes per-document unrealized gain/loss per
  Design decisions 9 and 11.
- `api/runs.ts` — `POST /api/fx_revaluation/runs` (see API Contracts).
- `AGENTS.md` — module rules: MUST NOT touch `VendorInvoice.
  outstandingAmount`/`SalesInvoice.outstandingAmount`; MUST reject
  (not skip) a document whose `currencyId` differs from base but whose
  `exchangeRate` is null; MUST read the FiscalPeriod lock state before
  posting.
- **Depends on**: `currencies` (hard — rate lookups),
  `ledger` (hard — posts `JournalEntry`), `accounts_payable`/`sales`
  (soft, direct entity reads only — no ORM relations, matching the
  root AGENTS.md "no direct ORM relationships between modules" rule
  already enforced everywhere else in this family of specs).

### Patches to sibling specs (small, forward-pointer style)

- `accounts-payable.md` — add `VendorInvoice.exchangeRate`
  (`numeric(18,8)`, nullable) to the entity's field list, with a
  pointer to this document for the resolution rule.
- The spec owning `SalesInvoice` (`sales-invoice-gl-posting.md`, since
  it already documents `SalesInvoice`'s current currency handling in
  detail) — add `SalesInvoice.currencyId`/`exchangeRate`, and a note
  that `postSalesInvoiceToLedger`'s existing `currencyCode` →
  `currencyId` resolution step should read the stored `currencyId`
  once this ships, rather than re-resolving it.
- `cash-bank-management.md` — note that `bookedExchangeRate` can
  default from `SalesInvoice.exchangeRate` once populated, **only when
  the bank account's currency equals the tenant's base currency**
  (Design decision 14) — and add the new
  `matchBankStatementLine` precondition: reject (`409
  PRIOR_VALUATION_NOT_REVERSED`) settling a document that is a line in
  the current, unreversed `FxRevaluationRun` (Design decision 12).
- The spec owning `SalesInvoice`/`sales.invoices.update`
  (`sales-invoice-gl-posting.md`) — add the post-creation immutability
  guard for `currencyId`/`exchangeRate`/`currencyCode`/`issueDate`
  once a document is posted (Design decision 15).

## Data Model

### `fx_revaluation.FxRevaluationRun`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organizationId` / `tenantId` | `uuid` | scope, as everywhere else |
| `fiscalPeriodId` | `uuid` (FK-id, no ORM relation) | the period this run values as of |
| `baseCurrencyId` | `uuid` (FK-id → `currencies.Currency`) | the base currency actually used for this run, snapshotted at creation (Design decision 16) |
| `valuationDate` | `date` | the date requested (may differ from `valuationRateDate` after fallback) |
| `reversesRunId` | `uuid`, nullable (FK-id) | the prior run this one reversed, if any |
| `journalEntryId` | `uuid`, nullable (FK-id) | the posted `NORMAL` valuation entry; `null` for a no-op run (Edge Cases) |
| `reversalJournalEntryId` | `uuid`, nullable (FK-id) | set once a later run reverses this one |
| `status` | `'POSTED' \| 'REVERSED'` | |
| `totalUnrealizedGainLoss` | `numeric(18,4)` | base currency, signed net of gains and losses (P&L total; individual control-account legs are on `FxRevaluationLine`, Design decision 11) |
| `createdBy` | `uuid` | acting user |
| `createdAt` | `timestamptz` | |

### `fx_revaluation.FxRevaluationLine`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `runId` | `uuid` (FK-id) | parent `FxRevaluationRun` |
| `documentType` | `'vendor_invoice' \| 'sales_invoice'` | drives the sign convention, Design decision 11 |
| `documentId` | `uuid` (FK-id, no ORM relation) | |
| `currencyId` | `uuid` (FK-id → `currencies.Currency`) | the document's own currency |
| `outstandingAmountInDocumentCurrency` | `numeric(18,4)` | read from the document at run time |
| `bookedExchangeRate` | `numeric(18,8)` | the document's own stored rate |
| `valuationExchangeRate` | `numeric(18,8)` | resolved for the run's valuation date |
| `valuationRateSource` | `text` | the `ExchangeRate.source` actually selected (Design decision 9c/9e provenance) |
| `valuationRateDate` | `date` | `RateResult.actualDate` — may be earlier than `FxRevaluationRun.valuationDate` after fallback (Design decision 9e) |
| `unrealizedGainLoss` | `numeric(18,4)` | base currency, signed; `outstandingAmountInDocumentCurrency * (valuationExchangeRate - bookedExchangeRate) * (documentType === 'sales_invoice' ? 1 : -1)` (Design decision 11) |

## API Contracts

All routes export `openApi` and declare
`requireAuth: true, requireFeatures: [...]` per-method metadata
(Canonical Mechanisms). `POST /runs` is a custom, mutation-guard-wired
route (it isn't CRUD — it computes and posts); `GET /runs` and
`GET /runs/:id` are plain `makeCrudRoute` `list`/`get` handlers over
`FxRevaluationRun` (read-only, no custom logic needed).

### `POST /api/fx_revaluation/runs`

- **Body**: `{ fiscalPeriodId: string, valuationDate?: string }`
  (`valuationDate` defaults to the period's end date).
- Loads the `FiscalPeriod`; **400** if not found, **409** if already
  `CLOSED`/`isLocked` (revaluation is a pre-close step, not a
  post-close one).
- **422 `VALUATION_DATE_TOO_STALE`** if `valuationDate` falls outside
  `fx_revaluation.valuationGraceDays` of today, or `fiscalPeriodId`
  isn't the tenant's most recently closed-or-closing period (Design
  decision 13).
- **422 `BASE_CURRENCY_CHANGED`** if the tenant's current
  `Currency.isBase` row doesn't match the most recent prior run's
  `baseCurrencyId` (Design decision 16).
- Locks the current `'POSTED'` `FxRevaluationRun` row for this
  tenant/org with `SELECT ... FOR UPDATE`, then validates fully before
  any write (Design decision 10):
  - Reads all open `VendorInvoice`/`SalesInvoice` rows
    (`outstandingAmount > 0`, `currencyId` ≠ tenant base currency) as
    of `valuationDate`.
  - Resolves rates per Design decision 9; **422
    `EXCHANGE_RATE_UNAVAILABLE`** (rate genuinely not found after
    lookback/auto-fetch) or **422 `EXCHANGE_RATE_AMBIGUOUS`**
    (unresolvable multi-provider tie) with the specific currency/date
    — no partial run.
  - Rejects (**422 `EXCHANGE_RATE_MISSING_ON_DOCUMENT`**) if any
    in-scope document has `currencyId` ≠ base but `exchangeRate: null`
    — a data problem to surface, not paper over with an assumed rate
    of `1` (pre-existing documents needing the backfill command,
    Design decision 15).
- Only once validation passes: reverses the locked prior run via
  `ledger.reverseJournalEntry` (skipped if it was itself a no-op —
  Design decision 10c) and posts the new `NORMAL` `JournalEntry` with
  per-control-account, per-side legs (Design decision 11) — the whole
  entry is omitted only if every individual document delta is exactly
  `0`, in which case no entry is posted and the run is recorded with
  `journalEntryId: null`.
- **Response 201**: `{ runId, journalEntryId, reversalOfRunId?,
  totalUnrealizedGainLoss, lineCount }`.
- **Response 403**: caller lacks `fx_revaluation.runs.create`.

### `GET /api/fx_revaluation/runs/preview`

- **Query**: `{ fiscalPeriodId: string, valuationDate?: string }` —
  same inputs and same validation as `POST /runs` (including the
  staleness/base-currency/rate checks), but read-only: computes and
  returns the line list without posting or reversing anything.
- **Response 200**: `{ lines: FxRevaluationLinePreview[],
  totalUnrealizedGainLoss, wouldReverseRunId? }` — the same shape the
  UI's preview table renders (UI/UX below). A preview is **not**
  cached and **not** guaranteed to still be valid by the time
  `POST /runs` executes (rates, `outstandingAmount`, or the prior
  `'POSTED'` run can change between the two calls) — the UI must
  re-preview, not silently repost, if the user waits before
  confirming (stale-preview rule, addressing the previously-missing
  contract).
- **Response 403**: caller lacks `fx_revaluation.runs.create` (same
  feature as posting — previewing a run a caller can't post has no
  use case here).

### `GET /api/fx_revaluation/runs`

- Paginated list (`pageSize <= 100`, matching `#6013`'s own
  `getTrialBalance` paging convention), filtered by `fiscalPeriodId?`.
  Read-only history of past runs.
- **Response 403**: caller lacks `fx_revaluation.runs.read` (a
  separate, narrower feature than `.create` — an accountant reviewing
  history doesn't need posting rights).

### `GET /api/fx_revaluation/runs/:id`

- Single run detail, including its `FxRevaluationLine` rows.
- **Response 404**: run not found in this tenant/org scope.
- **Response 403**: caller lacks `fx_revaluation.runs.read`.

## UI/UX

A single admin page under Ledger → Period-End: a "Run FX Revaluation"
action per open `FiscalPeriod`, backed by `GET
/api/fx_revaluation/runs/preview` for the computed line list
(document, currency, booked vs. valuation rate and its source,
gain/loss, control account) shown as a preview before posting via
`useGuardedMutation` + `apiCall()` calling `POST /runs` — mirroring the
"preview before commit" pattern already used by
`generateAnnualStatements` in #6188, and re-fetching the preview
(never reusing a stale one) if the user reopens the dialog. A
`DataTable`-backed, paginated read-only history of past runs per
period via `GET /runs`, each row linking to `GET /runs/:id` for its
line detail.

## Edge Cases & Failure Scenarios

- **No open foreign-currency documents at all.** The run completes
  with `lineCount: 0`, `journalEntryId: null`, `status: 'POSTED'`
  (a no-op run is still recorded, so period-end history shows
  revaluation was checked, not skipped).
- **AR and AP deltas exactly offset (net P&L is `0`, but neither
  control account moved by `0`).** Still posts all four legs (Design
  decision 11) — only a single document's own delta being exactly `0`
  is omitted from the entry; the "no documents at all" no-op above is
  the only case with no entry at all.
- **The prior `'POSTED'` run was itself a no-op** (`journalEntryId:
  null`, e.g. a period with no open foreign-currency documents).
  Marked `REVERSED` with no call to `ledger.reverseJournalEntry` —
  nothing was posted, so nothing needs unwinding (Design decision
  10c).
- **A document's `exchangeRate` is `null` because it predates this
  feature.** Rejected outright (**422
  `EXCHANGE_RATE_MISSING_ON_DOCUMENT`**) rather than silently assuming
  rate `1`; the supported remediation is the explicit, one-row
  `fx_revaluation.backfillDocumentRate` command (Design decision 15),
  not automatic bulk backfill.
- **Exchange rate for `valuationDate` genuinely doesn't exist** (e.g. a
  weekend/holiday with no published NBP/Raiffeisen rate). Relies on
  `ExchangeRateService`'s own `maxDaysBack` recursive lookback before
  surfacing `EXCHANGE_RATE_UNAVAILABLE` — this spec does not
  reimplement that fallback.
- **Two providers both return a rate for the same pair/date, at
  different priority positions.** Resolved deterministically by
  `fx_revaluation.ratePriority` (Design decision 9c); a genuine tie
  (two equally-ranked or equally-ambiguous manual entries) is rejected
  (**422 `EXCHANGE_RATE_AMBIGUOUS`**), never picked arbitrarily.
- **Two concurrent `POST /runs` calls for the same tenant/org.** The
  second blocks on the `SELECT ... FOR UPDATE` lock (Design decision
  10a) until the first's transaction commits, then re-reads the
  now-current run — no double-reversal, no lost update.
- **`valuationDate` is more than `valuationGraceDays` in the past, or
  the period is no longer the most recent.** Rejected (**422
  `VALUATION_DATE_TOO_STALE`**, Design decision 13) — this module does
  not reconstruct historical AP/AR aging; revaluation must run
  promptly at period-end.
- **The tenant's base currency changed since the prior run.** Rejected
  (**422 `BASE_CURRENCY_CHANGED`**, Design decision 16) rather than
  silently mixing a stored rate against the old base with a fresh
  lookup against the new one.
- **A revalued document is settled before the next revaluation run
  reverses its valuation.** `matchBankStatementLine` rejects
  (**409 `PRIOR_VALUATION_NOT_REVERSED`**, Design decision 12) until
  the covering `FxRevaluationRun` is reversed, preventing the
  unrealized-plus-realized double-count.
- **Cross-currency settlement (bank currency ≠ base ≠ invoice
  currency).** `bookedExchangeRate` cannot default from the invoice's
  own stored rate (different units) — entered explicitly or derived
  via the two-hop cross-rate `cash-bank-management.md` would need to
  implement (Design decision 14); this spec does not silently
  substitute one for the other.
- **Partial settlement between the document's issue date and
  valuation date.** Revaluation uses the document's *current*
  `outstandingAmount`, not its original total — the same field Cash &
  Bank Management already reads for partial-payment matching.
  Fully-settled documents (outstandingAmount = 0) are excluded.
- **Running the command twice for the same period before close.** The
  second call reverses the first run's entry and reposts fresh — no
  manual cleanup needed, and no double-counted unrealized balance.
- **A `FiscalPeriod` already `CLOSED`.** Rejected (**409**) —
  revaluation belongs to the closing checklist, before `CLOSING` is
  posted, not after.

## Risks & Impact Review

- **UoR Art. 30 text is unverified this session, and now has a second,
  concrete open question layered on it** (Design decisions 8 and 9c):
  even once Art. 30's wording is confirmed, `NBPProvider` only fetches
  NBP's Table C (commercial bid/ask), never Table A (the average rate
  Polish statutory practice generally associates with balance-sheet
  valuation) — if Art. 30 specifically names the average rate, this
  module's rate source would need a Table A fetcher added to
  `currencies` (out of this document's own boundary, Design decision
  1) before the rate-selection policy in Design decision 9 is fully
  correct, not just internally consistent. Both points should be
  confirmed against the actual statute (or an accountant) before
  implementation locks either in.
- **`matchBankStatementLine`'s new precondition (Design decision 12)
  is a real, if small, behavioral change to Cash & Bank Management**,
  not just a forward-pointer — settlement of a foreign-currency
  document can now be rejected (`409
  PRIOR_VALUATION_NOT_REVERSED`) depending on `fx_revaluation` run
  state, a cross-module dependency #6055's own spec didn't originally
  need to consider. Needs explicit sign-off from whoever next revises
  `cash-bank-management.md`, not silent adoption.
- **The `currencies` module's own `updateCurrency` command still
  allows changing `isBase` with no coordination with this module or
  with `accounts_payable`/`sales`** (Design decision 16) — this
  spec's own guard (`BASE_CURRENCY_CHANGED`) only detects the problem
  after the fact, on the next `fx_revaluation` run; it does not
  prevent the change itself. A real base-currency change for a live
  organization is a data-migration event this project has no process
  for yet, in any module.
- **Two sibling specs need small, coordinated patches, not just
  forward-pointers**: `accounts-payable.md` and the `SalesInvoice`-owning
  spec both currently describe entities without these fields; whoever
  implements those modules needs to pick up the field additions this
  spec proposes, and `sales-invoice-gl-posting.md`'s existing
  `currencyCode` → `currencyId` resolution logic becomes partially
  redundant once `SalesInvoice.currencyId` exists (Design decision 3)
  — a real, if small, implementation-ordering dependency between three
  specs that don't otherwise depend on each other.
- **None of `accounts_payable`, `sales`'s invoice-GL-posting, `ledger`,
  or `fixed_assets`' currency handling has shipped code yet** — this
  spec's Data Model additions are proposed against still-unimplemented
  sibling specs, so there's no running system to integration-test
  against today; the design is checked for internal consistency, not
  yet for runtime correctness.
- **Maintainer-review transparency.** An automated specification
  review (`om-auto-review-pr`, PR #6190) found ten issues across rate
  selection, sign convention, zero-netting, reversal atomicity,
  settlement timing, historical cutoff, cross-currency defaulting,
  migration semantics, and base-currency identity — every finding was
  independently re-verified against the cited primary sources
  (`exchangeRateService.ts`, both rate providers, the GL core engine
  and Cash & Bank Management specs, the live `currencies`/`sales`
  commands) before being addressed; see Changelog for the full list
  and citations.

## Alternatives considered

- **Building a dedicated Multi-Currency rate/conversion engine** —
  rejected outright once `currencies`' real, tested implementation was
  found; would duplicate three-plus years of already-solved design
  (rate fetch providers, historical retention, precision rules).
- **Extending `#6013`'s `GET /api/ledger/accounts/:id/balance` to
  return real per-currency balances instead of `currency: null`** —
  rejected; that endpoint already ships with an explicit, deliberate
  `null` contract, and the actual consumer of "what's our open FX
  exposure" is the revaluation run itself, which needs open-document
  detail (currency, rate, amount) that an account-level balance
  aggregate can't provide anyway (a mixed-currency account's balance
  isn't meaningfully "one currency").
- **Deferring unrealized FX to Other Comprehensive Income / equity**
  (an IFRS/US-GAAP pattern for certain long-term or hedged items) —
  noted as a real alternative treatment in general accounting practice
  but not adopted here pending Art. 30 confirmation (see Risks); P&L
  recognition is the simpler default and matches how realized FX
  already posts in Cash & Bank Management.
- **A brand-new `JournalEntry.type: 'ADJUSTING'`** — rejected in favor
  of reusing the existing `REVERSAL` mechanism (Design decision 5);
  avoids a schema change to `ledger` for a case its own reversal
  design already covers.
- **A general point-in-time AP/AR balance reconstruction engine**, so
  `valuationDate` could be set arbitrarily far in the past and still
  reflect exposure as of that date — rejected (Design decision 13) in
  favor of a grace-window freshness check; matches this module's own
  "small, additive, no new infrastructure" charter (Design decision 1)
  rather than building a dated-ledger-reconstruction capability this
  project has nowhere else either.
- **Automatic bulk backfill of `exchangeRate` on pre-existing
  documents** — rejected (Design decision 15) in favor of an explicit,
  auditable, one-document-at-a-time admin command; a bulk "resolve
  whatever rate existed" pass would silently manufacture historical
  rates for documents where the party never actually saw that rate.

## Out of scope

- Rebuilding, replacing, or extending the `currencies` module's rate
  providers, precision rules, or retention policy.
- Realized gain/loss at settlement — fully owned by Cash & Bank
  Management (#6055); this spec only makes its `bookedExchangeRate`
  input defaultable (Design decision 7).
- Multi-currency-aware GL account balance / trial balance reporting
  (`#6013`'s API stays `currency: null`).
- Foreign-subsidiary consolidation / functional-currency translation
  (IAS 21-style CTA) — Kieso itself scopes true FX-hedging/translation
  accounting out of its own text (Ch. 17, footnote 25); this project
  has no multi-entity/consolidation feature at all yet (5-topics list,
  "Multi-Entity/Intercompany" — zero signal, consciously deferred).
- Forward contracts, hedging instruments, or any derivative accounting.
- A UI for manually overriding a resolved exchange rate on a document
  (documents get their rate from `ExchangeRateService` at creation;
  correcting a wrong rate means correcting/reversing the document,
  same "reversal not undo" discipline as GL core engine).
- Point-in-time reconstruction of AP/AR balances for an arbitrarily
  historical `valuationDate` (Design decision 13) — revaluation must
  run within `valuationGraceDays` of the period it values.
- Automatic bulk backfill of `exchangeRate` on documents that predate
  this feature (Design decision 15) — the explicit, per-document
  `backfillDocumentRate` admin command is the supported path.
- Preventing (rather than detecting after the fact) a tenant's base
  currency from changing once foreign-currency documents exist
  (Design decision 16) — that guard belongs to the `currencies`
  module's own spec, not this one.

## Implementation Plan

0. **Confirm UoR Art. 30 text (including whether it names NBP's
   average/Table A rate specifically) before the commands/UI steps
   below** — moved earlier in this pass, per the maintainer review's
   "resolve the unverified accounting-policy prerequisite before
   implementation, rather than leaving it until the last step"
   finding; if Art. 30 requires Table A, Design decision 9c's provider
   policy needs revisiting together with `currencies`' own fetcher
   scope before Step 3 below is implemented.
1. Patch `accounts-payable.md` and the `SalesInvoice`-owning spec with
   the field additions from Design decision 3, plus the post-posting
   immutability guard (Design decision 15).
2. Scaffold `fx_revaluation` module: entities (including
   `FxRevaluationRun.baseCurrencyId`), `AGENTS.md`, module
   registration, dependency declarations (`currencies`, `ledger`),
   and the `fx_revaluation.ratePriority`/`valuationGraceDays` Module
   Config keys.
3. Implement `revalueOpenBalances` command: rate resolution (Design
   decision 9), the validate-then-write transaction with row-locking
   (Design decision 10), the sign convention and per-control-account
   aggregation (Design decision 11), and the staleness/base-currency
   guards (Design decisions 13, 16).
4. Implement `POST /api/fx_revaluation/runs`, `GET
   /api/fx_revaluation/runs/preview`, `GET /api/fx_revaluation/runs`,
   and `GET /api/fx_revaluation/runs/:id` with the rejection rules
   from API Contracts.
5. Implement the `backfillDocumentRate` admin command (Design decision
   15).
6. Implement the admin preview/run UI and read-only history under
   Ledger → Period-End (UI/UX).
7. Wire `VendorInvoice`/`SalesInvoice` creation commands to resolve
   and store `exchangeRate` (and, for `SalesInvoice`, `currencyId`) at
   creation time, once those modules exist.
8. Coordinate the `cash-bank-management.md` patches: the
   base-currency-equals-bank-currency restriction on defaulting
   (Design decision 14) and the `PRIOR_VALUATION_NOT_REVERSED`
   settlement precondition (Design decision 12).

## File Manifest

| File | Change |
|---|---|
| `.ai/specs/2026-09-17-multi-currency.md` | New (this document) |
| `packages/core/src/modules/fx_revaluation/data/entities.ts` | New — `FxRevaluationRun` (incl. `baseCurrencyId`), `FxRevaluationLine` (incl. `valuationRateSource`/`valuationRateDate`) |
| `packages/core/src/modules/fx_revaluation/AGENTS.md` | New |
| `packages/core/src/modules/fx_revaluation/commands/revalueOpenBalances.ts` | New |
| `packages/core/src/modules/fx_revaluation/commands/backfillDocumentRate.ts` | New — Design decision 15 |
| `packages/core/src/modules/fx_revaluation/api/runs.ts` | New — `POST /runs`, `GET /runs/preview` |
| `packages/core/src/modules/fx_revaluation/api/runs/[id].ts` (or route-file equivalent) | New — `GET /runs`, `GET /runs/:id` (`makeCrudRoute`) |
| `.ai/specs/2026-09-06-accounts-payable.md` | Patch — `VendorInvoice.exchangeRate` |
| sales-invoice-GL-posting spec | Patch — `SalesInvoice.currencyId`/`exchangeRate`, post-posting immutability guard (Design decision 15) |
| `.ai/specs/2026-09-10-cash-bank-management.md` | Patch — default `bookedExchangeRate` from invoice only when bank currency = base (Design decision 14), `PRIOR_VALUATION_NOT_REVERSED` settlement precondition (Design decision 12) |

## Migration & Backward Compatibility

- **New tables, no existing-table changes in this module itself.**
  `fx_revaluation.FxRevaluationRun`/`FxRevaluationLine` are brand-new;
  nothing here alters an existing schema. Deployable independently of
  the sibling patches below (additive).
- **Sibling schema changes are additive and nullable.**
  `VendorInvoice.exchangeRate`, `SalesInvoice.currencyId`, and
  `SalesInvoice.exchangeRate` are all nullable new columns — existing
  rows get `NULL`, not a default that could be mistaken for a real
  rate (Design decision 15). No existing query that doesn't already
  select these columns is affected.
- **Backfill order**: `currencyId` backfill (pure lookup, safe,
  automatic) runs before `fx_revaluation` is enabled for a tenant;
  `exchangeRate` backfill (per-document, admin-triggered,
  `backfillDocumentRate`) is optional and can happen any time
  afterward — a tenant can start using `fx_revaluation` for
  newly-created documents immediately, with older documents joining
  revaluation scope only as they're individually backfilled.
- **Rollback**: dropping the new `fx_revaluation` tables and the
  nullable sibling columns is non-destructive to existing data (no
  existing column is altered or removed) — a rollback loses only
  revaluation history, never AP/AR document data.
- **Deployment order**: `accounts-payable`/`sales-invoice-gl-posting`'s
  column additions can ship independently of `fx_revaluation` itself
  (the columns are useful — booked-rate capture — even before period-
  end revaluation exists); `fx_revaluation` depends on both existing
  first, since `revalueOpenBalances` reads them.

## Testing Strategy

Integration matrix (each row a distinct test case; unless noted, PLN
base / EUR foreign currency):

| # | Scenario | Expected |
|---|---|---|
| 1 | No open foreign-currency documents | `lineCount: 0`, `journalEntryId: null`, `status: 'POSTED'` |
| 2 | One open AR invoice, rate up | Gain posted: debit AR control, credit unrealized-gain account |
| 3 | One open AP invoice, same rate move | Loss posted: debit unrealized-loss account, credit AP control (opposite legs from #2) |
| 4 | AR gain and AP loss of equal magnitude | Four lines posted (Design decision 11 worked example), `totalUnrealizedGainLoss: 0` |
| 5 | Document `exchangeRate: null` (pre-existing, not yet backfilled) | `422 EXCHANGE_RATE_MISSING_ON_DOCUMENT` |
| 6 | `backfillDocumentRate` on that same document, then re-run | Succeeds; document now included |
| 7 | Rate unavailable even after lookback | `422 EXCHANGE_RATE_UNAVAILABLE` |
| 8 | Two providers return conflicting manual entries for the same pair/date | `422 EXCHANGE_RATE_AMBIGUOUS` |
| 9 | Second `POST /runs` call for the same period | Reverses run #1's entry via `ledger.reverseJournalEntry`, posts fresh; `reversesRunId` set |
| 10 | Prior run was a no-op (`journalEntryId: null`) | Marked `REVERSED` with no `reverseJournalEntry` call |
| 11 | Two concurrent `POST /runs` calls | Second blocks on the row lock, then correctly targets the now-current run — no double reversal |
| 12 | `valuationDate` older than `valuationGraceDays` | `422 VALUATION_DATE_TOO_STALE` |
| 13 | Base currency changed since the prior run | `422 BASE_CURRENCY_CHANGED` |
| 14 | Settling a document still covered by an unreversed run | `matchBankStatementLine` → `409 PRIOR_VALUATION_NOT_REVERSED` |
| 15 | Same settlement, after the covering run is reversed | Succeeds, realized gain/loss posts per Cash & Bank Management's existing formula |
| 16 | Three-currency settlement (PLN base, EUR invoice, USD bank) | `bookedExchangeRate` is not defaulted from the invoice; explicit entry or cross-rate required (Design decision 14) |
| 17 | Partial settlement between issue date and valuation date | Revaluation uses current `outstandingAmount`, not original total |
| 18 | `FiscalPeriod` already `CLOSED` | `409` |
| 19 | Preview (`GET /runs/preview`) then a change to a document's `outstandingAmount` before posting | Posting reflects the *new* state; UI must re-preview, not reuse the stale one |

## Canonical Mechanisms

- **API routes**: `POST /runs` and `backfillDocumentRate`'s route are
  custom, mutation-guard-wired routes (`openApi` export,
  `requireAuth`/`requireFeatures` metadata); `GET /runs` and `GET
  /runs/:id` are plain `makeCrudRoute` `list`/`get` handlers — no
  hand-rolled read logic for a case the framework's CRUD factory
  already covers.
- **Writes**: the admin UI's "Run FX Revaluation" action and the
  backfill action both go through `useGuardedMutation(...).runMutation(...)`
  + `apiCall()`, never a raw `fetch`.
- **Tables**: the run-history list is a `DataTable` with a stable
  `entityId` (`FxRevaluationRun.id`), matching
  `packages/ui/AGENTS.md`'s list convention.
- **Config**: `fx_revaluation.ratePriority` and
  `fx_revaluation.valuationGraceDays` are `ModuleConfigService` keys,
  the same DI-resolved config mechanism Cash & Bank Management already
  uses for its own account lookups — no bespoke settings table.
- **Events**: `fx_revaluation` emits no event in Phase 1 (nothing
  outside this module reacts to a posted or reversed run yet); it only
  *consumes* `ledger`'s and `currencies`' existing surface — one-way
  dependency direction, per knowledge-base §2. Flagged as a Phase 2
  candidate if a future filing/notification feature needs to react to
  a run.
- **Cache**: `GET /runs`/`GET /runs/:id` are low-frequency,
  per-fiscal-period reads (at most a handful of runs per period) — no
  new cache layer, same "N/A, justified" reasoning #6188 already
  applied to its own generation flow.

## Internationalization (i18n)

Admin UI strings (the "Run FX Revaluation" action, preview table
column headers, run-history list) live under the `fx_revaluation.*`
i18n namespace via `useT()`/`resolveTranslations()`, the same
convention `financial_pl.statements.*` established in #6188.
Currency codes, provider `source` names ("NBP", "Raiffeisen Bank
Polska"), and GL account names are data, not UI copy, and are not
translated.

## Literature & Prior Art

### Step 1 — Cross-spec consistency (exhaustive this pass)

Confirmed deferrals from four independent specs (GL core engine
#5663, GL account balances #6013, Cash & Bank Management #6055,
Sales Invoice → GL Posting) — full quotes in Problem Statement.
`sales.SalesOrder.exchangeRate`/`SalesInvoice`'s absence of it verified
directly against `packages/core/src/modules/sales/data/entities.ts`
(lines 374–377, 626, 1412), not only via secondhand spec references.
Contractor Registry (`docs/contractor-registry`) checked directly —
zero currency-relevant content beyond unrelated VIES ("VAT Information
Exchange System"). Journal Entry Line Dimension confirmed "Currency"
as one of its four open-string dimension types, not otherwise
currency-logic-relevant. `accounts_payable`, `ledger`, and
`fixed_assets` have no implemented code yet (checked — no
`entities.ts` found under those module paths); their currency handling
is verified against spec text only, consistent with project-wide
practice for not-yet-built modules.

### Step 2 — Literature grounding

- **Kieso, *Intermediate Accounting*, 17th Ed. — largely, and
  explicitly, out of scope for this topic.** No dedicated foreign-
  currency-transaction/translation chapter exists in this edition. Ch.
  17, footnote 25 (p. 17-33), verbatim: *"GAAP also addresses the
  accounting for certain foreign currency hedging transactions. In
  general, these transactions are special cases of the two hedges we
  discuss here. Understanding of foreign currency hedging transactions
  requires knowledge related to consolidation of multinational
  entities, which is beyond the scope of this text."* — **Confirmed
  absence**, stated by the book itself. One limited, conceptual
  mention survives: the "Global View" sidebar, Ch. 7 (p. 7-28):
  holding receivables in a foreign currency carries the risk "that the
  exchange rate may move against the company," discussed only as a
  hedging-motivation aside, no transaction/revaluation mechanics —
  **Confirmed but limited**.
- **Kieso, Ch. 3, "Reversing Entries—An Optional Step" (p. 3-35) —
  Confirmed, with a location correction, and directly load-bearing
  for Design decision 5/6.** *"A reversing entry is the exact
  opposite of the adjusting entry made in the previous period."*
  The quote is exact and verified directly against the
  primary-source PDF, but it sits in Ch. 3's main body (p. 3-35),
  which introduces and points forward to Appendix 3B (pp.
  3-43–3-45) — the appendix itself contains only the worked
  accrual/deferral illustration, not this defining sentence.
  Grounds reusing GL core engine's existing reversal mechanism for
  undoing the prior period's FX valuation rather than inventing a
  new entry type.
- **Fowler, *Analysis Patterns* — the stronger source for this topic,
  contrary to the usual pattern in this project.** §3.1 "Quantity" (p.
  36–38), Confirmed: *"Monetary values should also be represented as
  quantities... using a currency as the unit... monetary quantities
  can enforce the use of fixed point numbers for the amount
  attribute"* — grounds `currencies.AGENTS.md`'s own 4-decimal-
  precision, no-floating-point rule. §3.2 "Conversion Ratio" (p.
  38–39), Confirmed, closely on point: *"For monetary values, whose
  units are currencies, the conversion ratios are not constant over
  time. We can deal with this problem by giving the conversion ratios
  attributes to indicate their time of applicability."* — near-literal
  description of `currencies.ExchangeRate`'s `date`-stamped design.
  Fowler's many other "exchange rate" mentions (§9, Trading Patterns,
  p. 7356+) are a **Mismatch** — that chapter models FX as a *traded
  instrument* for a treasury/trading system, a different problem from
  recording an invoice's booked rate or revaluing an open balance;
  flagged explicitly so it isn't mistaken for on-topic material later.
- **Hay, *Data Model Patterns* — Confirmed absence.** Zero hits for
  "foreign currency," "exchange rate," "multi-currency," or
  "multicurrency" across the full extracted text — consistent with
  this book's established pattern of having no accounting-specific
  content in this project's prior research.
- **Ustawa o rachunkowości, Art. 9 — Confirmed** (checked directly
  against the extracted statute text, which runs Art. 9 through
  roughly Art. 25): *"Księgi rachunkowe prowadzi się w języku polskim
  i w walucie polskiej."* Grounds the base-currency-is-fixed-per-tenant
  assumption (Design decision 8). **Art. 30** ("wycena bilansowa,"
  the actual period-end FX revaluation mandate) is **Unverified** —
  not present in the extracted range; flagged **⚠ NEEDS HUMAN
  CONFIRMATION**.

### Step 3 — Real-system comparison (consciously narrowed)

Skipped a full ERPNext/Odoo comparison pass by explicit decision: the
internal precedent is unusually strong for this topic specifically —
a production-grade `currencies` module already in the codebase, plus
four independent sibling specs (Step 1) that already arrived at
compatible designs (same rate-direction convention, same
required-not-defaulted rule for a differing-currency rate) without
coordinating with each other. Re-deriving the same conclusions from
ERPNext/Odoo source would add process compliance without adding
design confidence. Noted here rather than silently omitted, per this
project's own discipline of recording what was deliberately not done
and why.

## Final Compliance Report — 2026-09-21

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/core/src/modules/currencies/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `FxRevaluationLine.documentId`/`currencyId`, `FxRevaluationRun.baseCurrencyId`/`fiscalPeriodId`/`journalEntryId` are all FK-ids only; `revalueOpenBalances` reads `VendorInvoice`/`SalesInvoice` via direct `entityManager` scans (Architecture), the same documented cross-module direct-read precedent Cash & Bank Management uses — never an ORM relation. |
| root AGENTS.md | Filter by `organization_id`/`tenant_id` | Compliant | Both new entities carry `organizationId`/`tenantId`; every rate/document lookup in Design decisions 9–10 is explicitly scoped. |
| root AGENTS.md → UI & HTTP | Non-`CrudForm` writes use `useGuardedMutation(...).runMutation(...)` | Compliant | Canonical Mechanisms + UI/UX: "Run FX Revaluation" and the backfill action both go through `useGuardedMutation`/`apiCall()`. |
| packages/core/AGENTS.md → API Routes | Every API route file exports `openApi`; custom write routes wire the mutation-guard registry | Compliant | API Contracts header note + Canonical Mechanisms: `POST /runs` and `backfillDocumentRate`'s route are custom, mutation-guard-wired; `GET /runs`/`GET /runs/:id` are `makeCrudRoute`. |
| packages/core/AGENTS.md → API Routes | Route metadata declares per-method `requireAuth`/`requireFeatures` | Compliant | API Contracts header note: `fx_revaluation.runs.create` (write paths) vs. `fx_revaluation.runs.read` (the two `GET` history routes) — a narrower read feature than #6188's single manage-only ACL, since a review-only accountant role has a real use case here (reading past runs without posting new ones). |
| packages/core/AGENTS.md → Encryption | PII/GDPR fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | N/A | No PII/GDPR-relevant column in either entity — amounts, rates, currency/document/account references only. |
| packages/ui/AGENTS.md | Backend forms use `<CrudForm>`; lists use `<DataTable>` with stable `entityId` | Compliant | UI/UX + Canonical Mechanisms: run history is a `DataTable` keyed by `FxRevaluationRun.id`; the preview table is a read-only computed list, not a form (nothing to edit before posting). |
| packages/ui/src/backend/AGENTS.md | All HTTP goes through `apiCall`/`apiCallOrThrow`, never raw `fetch` | Compliant | UI/UX + Canonical Mechanisms. |
| packages/cache/AGENTS.md | Read-heavy endpoints declare a caching strategy; cache resolved via DI | N/A, justified | Canonical Mechanisms: at most a handful of runs per fiscal period per tenant — no new cache layer, same reasoning #6188 applied to its own low-frequency generation flow. |
| packages/events/AGENTS.md | Cross-module side effects go through `createModuleEvents`, never direct imports | N/A, justified | Canonical Mechanisms: `fx_revaluation` emits no event in Phase 1; it only consumes `ledger`'s/`currencies`' existing surface. Flagged as a Phase 2 candidate. |
| `currencies/AGENTS.md` | MUST use date-based exchange rates, never "current" rate | Compliant | Design decision 9 resolves against `valuationDate` (or its `RateResult.actualDate` fallback), never "now." |
| `currencies/AGENTS.md` | MUST NOT filter rate *fetching* by `Currency.isActive` | N/A | This module never calls `RateFetchingService` directly or filters currency selection — it only calls `ExchangeRateService.getRate()`/`getRates()`, which already owns that policy internally (Design decision 2's correction). |
| `currencies/AGENTS.md` → Ask First | Ask before changing exchange-rate lookup semantics or realized gain/loss formulas | Compliant | Design decision 1: no new public surface added to `currencies`; Design decision 7: realized gain/loss formula is unchanged, only its input source gains an optional default. |
| Spec-checklist §5 | i18n keys planned, never hard-coded strings | Compliant | Internationalization (i18n) section (added this pass). |
| Spec-checklist §5 | Pagination `pageSize <= 100` | Compliant | `GET /runs` (API Contracts, added this pass). |
| Spec-checklist §5 | Migration/backward-compatibility strategy is explicit | Compliant | Migration & Backward Compatibility section (added this pass). |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | `FxRevaluationRun.baseCurrencyId`/`FxRevaluationLine.valuationRateSource`/`valuationRateDate` (Data Model) are exactly what Design decisions 9 and 16 require the API's rejection/response contracts to carry. |
| API contracts match UI/UX section | Pass | The preview/history split in UI/UX now matches `GET /runs/preview` vs. `GET /runs`/`GET /runs/:id` in API Contracts. |
| Risks cover all write operations | Pass | Risks & Impact Review names all ten maintainer-review findings plus the two residual coordination risks (Cash & Bank Management's new precondition, `currencies`' still-unguarded `isBase` change). |
| Commands defined for all mutations | Pass | `revalueOpenBalances` and the new `backfillDocumentRate` are both commands behind mutation-guard-wired routes; no bare `makeCrudRoute` write exists for either. |
| Cache strategy covers all read APIs | Pass (N/A, justified) | See Compliance Matrix. |

### Non-Compliant Items

None outstanding.

### Verdict

**Fully compliant** — approved for the re-review requested on PR
#6190, pending a maintainer's second look.

## Changelog

- **2026-09-17** — Initial draft. Steps 1–2 of the standard process
  completed in full; Step 3 consciously narrowed per above. Scope
  confirmed with the user as: `exchangeRate`/`currencyId` field
  additions to `VendorInvoice`/`SalesInvoice`, plus a new, minimal
  `fx_revaluation` module for period-end unrealized FX revaluation —
  explicitly not a new rate/currency engine.
- **2026-09-21** — Kieso reversing-entry citation corrected from
  "Appendix 3B" to Ch. 3, "Reversing Entries—An Optional Step" (p.
  3-35) — the quote is exact, only the section attribution was wrong
  (caught during a literature-comparison verification pass on the
  sibling Annual Financial Statements spec, which had reused this same
  citation).

### 2026-09-21 (cont.) — Maintainer-review correction round

An automated specification review (`om-auto-review-pr`, PR #6190,
commit `3cd6367b4bc362728138585dccfc20a0852f2866`) requested changes;
every finding was independently re-verified against the cited
primary sources — not accepted on the review's word alone — before
being addressed:

- **Major, Confirmed** — rate selection from `ExchangeRateService`'s
  actual result shape was unspecified (`getRate`/`getRates` take
  codes and return an array, not a scalar; checked directly against
  `exchangeRateService.ts` and both provider files). Fixed:
  `currencyId`→code resolution, a fixed query direction, explicit
  provider-priority selection, and stored provenance — Design decision
  9.
- **Blocker, Confirmed** — reversal-then-repost validated *after*
  reversing the prior run, so a later rejection could delete a valid
  valuation and post nothing in its place; two concurrent runs could
  also target the same prior run. Fixed: validate-then-write inside
  one transaction with a `SELECT ... FOR UPDATE` lock — Design
  decision 10.
- **Major, Confirmed** — the same signed formula was applied to both
  AR (asset) and AP (liability), and the whole entry was skipped when
  the *total* happened to net to zero even though both control
  accounts had genuinely moved. Fixed: document-type-dependent sign,
  and a leg is only omitted when its own delta is `0` — Design
  decision 11.
- **Major, Confirmed** — "reversed at the next revaluation run" didn't
  guarantee reversal before a settlement in the new period, risking a
  double-counted gain/loss (unrealized left on the books plus
  realized at settlement). Fixed: a new `matchBankStatementLine`
  precondition rejecting settlement of a still-covered document —
  Design decision 12.
- **Major, Confirmed** — `outstandingAmount` is current-state, not a
  point-in-time balance, so an arbitrarily historical `valuationDate`
  could silently misstate exposure once documents settle or appear
  after the nominal cutoff. Fixed: a freshness/grace-window
  restriction rather than a new historical-reconstruction engine
  (matching this document's own "simplest solution" charter) — Design
  decision 13.
- **Major, Confirmed** — the invoice's own booked rate (base-currency
  units per document-currency unit) was proposed as a default for
  Cash & Bank Management's `bookedExchangeRate` (bank-currency units
  per document-currency unit) — different units whenever the bank
  account's currency isn't the base currency. Fixed: default only
  applies when bank currency = base currency; otherwise an explicit
  two-hop cross-rate is needed — Design decision 14, with a worked
  three-currency example.
- **Major, Confirmed (backward compatibility)** — no defined migration/
  edit semantics for existing `SalesInvoice`/`VendorInvoice` rows or
  for `sales.invoices.update`'s existing ability to change
  `currencyCode`/`issueDate` post-creation. Fixed: automatic
  `currencyId` backfill, explicit per-document `exchangeRate` backfill
  command, and a post-posting immutability guard tying all four
  currency-related fields together — Design decision 15.
- **Major, Confirmed (backward compatibility)** — `Currency.isBase` is
  mutable (checked directly against `currencies/commands/
  currencies.ts`), but nothing recorded which base currency a run or
  document was valued against, so a later base-currency change could
  silently combine old and new units. Fixed: `FxRevaluationRun`
  snapshots `baseCurrencyId` and rejects a run once it no longer
  matches — Design decision 16.
- **Minor, Confirmed (what's missing)** — no preview/read/history
  endpoint contracts, no rollout/backfill/rollback section, no final
  compliance section, and the Art. 30 policy prerequisite sat at the
  last Implementation Plan step instead of the first. Fixed: `GET
  /runs/preview`, `GET /runs`, `GET /runs/:id` (API Contracts),
  Migration & Backward Compatibility and Testing Strategy sections
  (added), Art. 30 confirmation moved to Implementation Plan Step 0.

No scope change: still exactly the two pieces from the TLDR
(`exchangeRate`/`currencyId` field additions, plus the minimal
`fx_revaluation` module) — every fix above sharpens those two pieces'
correctness rather than growing their footprint. Re-requesting review
against this revision.

### 2026-09-21 (cont.) — `om-spec-writing` compliance pass

Run properly end to end after the maintainer-review round above, per
the same gap this project's Annual Financial Statements spec found in
itself: the maintainer-review round fixed all ten reported findings
with verified citations, but had not run the `om-spec-writing` skill's
own Compliance Gate. Added this pass: Migration & Backward
Compatibility, Testing Strategy (19-case integration matrix), Canonical
Mechanisms (naming `makeCrudRoute`/`useGuardedMutation`/`DataTable`/
`ModuleConfigService` explicitly, a checklist §5 gap this document
previously had — routes/forms were described in prose without naming
the actual framework primitives), Internationalization (i18n), and this
Final Compliance Report.

### Review — 2026-09-21

- **Reviewer**: Agent (`om-spec-writing` skill, this compliance pass)
- **Security**: Passed — no PII/GDPR fields introduced; `organization_id`/`tenantId` scoping explicit throughout Data Model; separate `.create`/`.read` ACL features declared on every route.
- **Performance**: Passed — no N+1 pattern; rate resolution batches via `getRates()`, currency-code resolution batches via one scoped `IN (...)` query (Design decision 9a).
- **Cache**: Passed (N/A, justified) — no new cache layer; low-frequency per-fiscal-period reads.
- **Commands**: Passed — `revalueOpenBalances`/`backfillDocumentRate` are commands behind mutation-guard-wired routes; no bare CRUD write bypasses them.
- **Concurrency**: Passed — `SELECT ... FOR UPDATE` row-locking (Design decision 10a) makes the reversal-then-repost sequence safe under concurrent calls, verified against the same "`CommandBus.execute` doesn't itself create a cross-command transaction" constraint the maintainer review cited.
- **Risks**: Passed — Risks & Impact Review covers all ten maintainer-review findings plus the two residual cross-module coordination risks (Cash & Bank Management's new precondition, `currencies`' still-unguarded `isBase` change) with no residual risk left undocumented.
- **Verdict**: Approved — re-requesting review against this revision.
