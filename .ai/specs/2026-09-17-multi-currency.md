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
missing unrealized/period-end half, as a small new module that posts its valuation, and a reversing entry for the next period, through General Ledger's existing posting commands rather than inventing a new entry type.

## Problem Statement

The financial-module Event Storming recording named Multi-Currency as
priority #2 of the five topics still open after Annual Financial
Statements (#6188), Tax Management (#6168) and Compliance & Audit
(#6038 Phase 2) were proposed — all three are open spec PRs, not shipped. Unlike topic #1, the recording itself doesn't
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
GL account balances and Posting Rules Engine when Annual Financial Statements (#6188) was proposed (an open spec PR).

**B. A new, deliberately small Core module, `fx_revaluation`**, whose
only job is: at period end, find every AP/AR document still open in a
non-base currency, get the valuation-date rate from the existing
`ExchangeRateService`, compute the unrealized gain/loss against each
document's booked `exchangeRate`, and post one balanced `JournalEntry`
— together with a reversing entry dated the first day of the next period, in the same transaction, so the valuation never outlives its period (no new `JournalEntry.type`; Design decisions 5 and 12), as Kieso describes reversing entries: *"A reversing entry is the exact
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
   sub-ledger, not a rewrite of AP/AR balances.** The open
   amounts of vendor and sales invoices (Design decisions 18 and 17) stay
   denominated in the document's own currency, untouched — the revaluation entry
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

5. **No new `JournalEntry.type` value — the valuation and its reversing
   entry are both ordinary `NORMAL` entries.** GL core engine's `type`
   enum is `NORMAL` / `CLOSING` / `OPENING` / `REVERSAL`, each already
   justified by an existing design decision ("Corrections are reversals,
   not undo"). Adding a fifth value (e.g. `ADJUSTING`) would touch
   `ledger`'s own schema and every place that switches on `type`.
   Instead, the valuation posts as a `NORMAL` entry tagged
   `referenceType: 'fx_revaluation:period_end'`, `referenceId:
   <FxRevaluationRun.id>` — the same tagging convention Cash & Bank
   Management already uses (`referenceType:
   'cash_bank_management:bank_statement_line'`) — and the entry that
   unwinds it on the first day of the next period (Design decision 12)
   is a second `NORMAL` entry with the lines inverted, tagged
   `referenceType: 'fx_revaluation:period_end_reversal'` and the same
   `referenceId`. The unwinding entry is deliberately **not** posted
   through `ledger.reverseJournalEntry`: GL core engine lets an entry be
   reversed once and does not let a reversal be reversed, so an
   automatic `REVERSAL` could not be cancelled when the same period is
   revalued again (Design decision 6); as ordinary entries, both can.
   `reverseJournalEntry` stays the only way this module *cancels* a
   posted entry — never `postJournalEntry` with a `type: 'REVERSAL'`
   override, which is not the documented contract. Kieso, Ch. 3,
   "Reversing Entries—An Optional Step" (p. 3-35 — the section
   introducing Appendix 3B, not the appendix's own worked pages): *"A
   reversing entry is the exact opposite of the adjusting entry made in
   the previous period. Use of reversing entries is an optional
   bookkeeping procedure..."* — the pattern is applied here to a new use
   case, not introduced.

6. **A run posts the valuation and its reversing entry together; running
   again for the same period supersedes the earlier run.**
   `fx_revaluation.revalueOpenBalances` for a fiscal period, in one
   command and one transaction, (a) posts the valuation as a `NORMAL`
   entry dated `valuationDate` and (b) posts its reversing entry dated
   the first day of the next period (Design decision 12). If a `POSTED`
   run already exists for the same fiscal period, the command first
   cancels it: `ledger.reverseJournalEntry` on each of its two entries,
   each dated with that entry's own date so that both periods net to
   zero, and the run is marked `SUPERSEDED`; then it posts a new pair.
   That keeps the operation idempotent under re-runs before close. A run
   for a later period never touches an earlier one — the earlier
   valuation is already unwound by its own reversing entry. The order of
   validation and writes is Design decision 10. This replaces the first
   version of this decision (the next run reverses "the most recent
   unreversed prior run"), which left the prior valuation on the books
   until that next run and is the cause of the settlement deadlock
   described in Design decision 12.

7. **Realized gain/loss stays exactly as Cash & Bank Management (#6055)
   already designed it — this spec does not re-derive that formula.**
   `matchBankStatementLine`'s `sales_invoice` path computes
   `statementLineAmountInBankCurrency - (settledAmount * bookedExchangeRate)
   - overpaymentAmount` at settlement (`settledAmount` is an explicit input
   since #6055's 2026-10-09 correction; the earlier derived
   `matchedAmountInInvoiceCurrency` made the figure zero for partial
   payments), consistent with
   `currencies.AGENTS.md`'s own canonical formula `(payment rate −
   invoice rate) × foreign amount`. Once `VendorInvoice.exchangeRate`/
   `SalesInvoice.exchangeRate` exist (this spec, part A), that
   `bookedExchangeRate` input can be defaulted from the invoice's own
   stored rate instead of always requiring manual entry — a coordination
   note for #6055, not a redesign (see Risks).

8. **Legal grounding for base currency, and Art. 30 now Confirmed —
   closed 2026-09-21** (was flagged ⚠ NEEDS HUMAN CONFIRMATION; the
   session's earlier extracted statute text ran only Art. 9 through
   roughly Art. 25, not Rozdział 4 where Art. 30 lives). Ustawa o
   rachunkowości, Art. 9 (checked directly against the extracted
   statute text): *"Księgi rachunkowe prowadzi się w języku polskim i w
   walucie polskiej"* (accounting books are kept in Polish and in
   Polish currency) — confirms a Polish-registered tenant's base/
   functional currency is a legal given (PLN), not a UI-configurable
   preference, which is why `currencies.Currency.isBase` is treated as
   fixed per tenant throughout this spec. **Art. 30 checked directly
   against the current consolidated text** (Dz.U.2026.0.522, effective
   21 August 2026; cross-checked across two independent sources,
   lexlege.pl and przepisy.gofin.pl). Ust. 1: *"Nie rzadziej niż na
   dzień bilansowy wycenia się wyrażone w walutach obcych: 1) składniki
   aktywów (z wyłączeniem udziałów w jednostkach podporządkowanych
   wycenianych metodą praw własności) i pasywów – po obowiązującym na
   ten dzień średnim kursie ogłoszonym dla danej waluty przez Narodowy
   Bank Polski, z zastrzeżeniem pkt 2; ..."* — confirms both halves of
   this spec's working assumption were correct: valuation is required
   **at least as of the balance-sheet date** ("nie rzadziej niż," this
   spec's periodic revaluation trigger), at the **NBP average rate**
   ("średni kurs ogłoszony... przez Narodowy Bank Polski"). Ust. 4:
   *"Różnice kursowe dotyczące inwestycji długoterminowych wyrażonych w
   walutach obcych... rozlicza się w sposób określony w art. 35, ust. 2
   i 4. Różnice kursowe, z zastrzeżeniem ust. 5–7, dotyczące
   pozostałych aktywów i pasywów wyrażonych w walutach obcych...
   zalicza się odpowiednio do przychodów lub kosztów finansowych..."*
   — confirms this spec's P&L-recognition design (financial income/
   costs, no equity/OCI deferral) is correct for everything **except**
   long-term investments (Art. 35 terms instead — out of scope here,
   no long-term-investment revaluation designed in this spec). **New,
   load-bearing consequence of this confirmation**: Art. 30 ust. 1
   names the NBP **average rate** specifically — the exact "Table A"
   rate this spec's own Design decision 9c already flagged
   `NBPProvider` as never fetching (it fetches only Table C, bid/ask
   commercial rates). That gap is now a **confirmed statutory
   non-compliance risk**, not a speculative one — see the Risks entry
   below, upgraded accordingly, and Implementation Plan Step 0, now
   resolved.

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
      base-currency code**, matching the Data Model's
      `unrealizedGainLoss = outstanding × (valuationRate − bookedRate)`
      formula, which only balances if `exchangeRate` means "base-currency
      units per one document-currency unit." Checked against both
      providers' source comments: for this direction (`XXX → PLN`) NBP
      (Table C) and Raiffeisen tag the row `type: 'buy'`. `ExchangeRate`'s
      uniqueness key (`organizationId, tenantId, fromCurrencyCode,
      toCurrencyCode, date, source`) does **not** contain `type`, so for a
      fixed direction and date there is at most one row per `source`; the
      selection key `fx_revaluation` uses is therefore **`source`** (with
      the pair and the date), never `type`.
   c. **The statutory rate is stored under its own `source`, so `currencies`
      needs no schema change.** Art. 30 ust. 1 requires the NBP average
      rate (Table A; Design decision 8). `NBPProvider` does not fetch it
      (it reads only `tables/c`, bid/ask), and a Table A row cannot share
      the `NBP` source: an `EUR → PLN` Table A row for a date would
      violate the unique key against the Table C row already written for
      that date. Adding `type` to the key would be a schema and contract
      change in `currencies` — an "Ask First" item under
      `currencies/AGENTS.md` and `BACKWARD_COMPATIBILITY.md` — and is not
      proposed. Instead Implementation Plan Step 0 adds a Table A provider
      with its own `source: 'NBP_A'` (rows `type: null`), and
      `fx_revaluation.ratePriority` (an ordered `source` list in
      `ModuleConfigService`) defaults to `['NBP_A']`. **The module
      refuses to post — 422 `EXCHANGE_RATE_UNAVAILABLE` naming the source
      — rather than fall back to Table C or Raiffeisen** when no `NBP_A`
      row is resolvable for a currency and date; another source enters
      `ratePriority` only by an explicit tenant decision. Any ambiguity
      left after priority ordering (two manual entries from
      differently-named sources, both listed) is rejected — **422
      `EXCHANGE_RATE_AMBIGUOUS`**. Both bundled providers require PLN on
      one side of the pair (`providerBaseCurrency = 'PLN'`), so the policy
      is written for the PLN-base case this spec treats as the working
      assumption (Design decision 8).

      **Checked against `currencies` on `develop` (2026-10-15).** The Table
      A provider fits the module as it is; what the code allows and what it
      does not:
      - *A public extension point exists.* `RateFetchingService` takes any
        `RateProvider` (`source`, `providerBaseCurrency`, `fetchRates`,
        `isAvailable`), and `registerCurrencyRateProvider(provider)`
        (`services/providers/registry.ts`, used by the `example` module's
        `di.ts`) adds one from any module, keyed by `source`. The bundled
        providers are registered in `currencies/di.ts` the same way.
      - *No schema change.* The `exchange_rates` unique key is
        `(organization, tenant, from, to, date, source)` and persistence
        matches rows on the same key, so `NBP_A` rows never collide with
        `NBP` (Table C) rows. `ExchangeRate.type` is free text.
      - *No type change either.* Table A rows are stored with
        `type = null` and recognised by `source = 'NBP_A'`. A `'mid'` value
        would need a change in `currencies`: `RateProviderResult.type` is
        `'buy' | 'sell' | null`, and the manual-entry validator
        (`exchangeRateCreateSchema`) accepts only `buy`, `sell` or `null`.
        `null` is valid on both paths, so `currencies` is untouched apart
        from the new provider file and its registration. Rates are not
        entered by hand: the provider fetches them.
      - *On-demand fetching needs nothing else.* `ExchangeRateService`
        with `autoFetch` calls every registered provider for the date, so
        `NBP_A` is fetched when a valuation asks for it. Scheduled fetching
        goes through `CurrencyFetchConfig`, whose `providerSchema` is a
        fixed enum (`NBP`, `Raiffeisen Bank Polska`, `Custom`) with a
        hard-coded provider list in `CurrencyFetchingConfig.tsx`; making
        `NBP_A` schedulable there is optional and not needed for this
        module.
      - *Fallback caveat.* `findRateWithFallback` steps back a day only when
        **no** source has a row for that date. If `NBP` rows exist for a day
        but `NBP_A` rows do not, the lookup does not continue to the
        previous day for `NBP_A`; the run then ends in 422
        `EXCHANGE_RATE_UNAVAILABLE` (the intended refusal), and the
        operator retries once the table is published.
      - *Placement.* The same Table A default rate is needed by AP/AR for
        booking-day rates (decision of 2026-10-12: resolving the default
        rate belongs to `currencies`), so the provider is written in
        `currencies` (`services/providers/nbpTableA.ts`, registered in
        `di.ts`) as the first commit of the implementation PR, not as a
        separate PR. If OM Core does not want it there, the same class can
        be registered from `fx_revaluation`'s `di.ts` through
        `registerCurrencyRateProvider` without touching `currencies` —
        a supported mechanism, not a workaround — at the cost of AP/AR
        not getting Table A from `currencies`.

        **Decided 2026-10-15 (team): the provider lives in `currencies`.**
        Reasons: (1) AP/AR need the same Table A rate for booking-day
        defaults, so a provider owned by `fx_revaluation` would make them
        depend on the valuation module or duplicate it, reversing the
        one-way dependency direction; (2) the provider registry is a
        process-wide map, so a provider registered by `fx_revaluation`
        would change `autoFetch` behaviour for every consumer as a hidden
        side effect; (3) `currencies` already owns the other rate sources
        (`NBP`, Raiffeisen). This is presented to OM Core on #6190 as the
        proposed final design, not as a question.

        **Provider contract (the format being proposed).**
        - *Class and wiring:* `NBPTableAProvider implements RateProvider` in
          `currencies/services/providers/nbpTableA.ts`; `name = 'NBP Table A
          (average rates)'`, `source = 'NBP_A'`, `providerBaseCurrency =
          'PLN'`; registered in `currencies/di.ts` next to the two bundled
          providers. `isAvailable()` is `true` (public API), like `NBPProvider`.
        - *Fetch:* NBP API `exchangerates/tables/a/{date}`. HTTP 404 (weekend,
          holiday) returns `[]`; other non-2xx responses throw, as in
          `NBPProvider`. Skips when `PLN` is not among the available
          currencies.
        - *Rows written:* one row per currency, **`XXX → PLN` only**, `rate =
          mid` (PLN for one unit of `XXX`), `source = 'NBP_A'`, `type = null`.
          No `PLN → XXX` inverse: `ExchangeRateService` looks up the exact
          pair and Design decision 9b fixes the query direction, so an
          inverse row would only add a rounding-lossy duplicate.
        - *Date:* the table's `effectiveDate` as `00:00:00Z` (UTC midnight),
          the form `ExchangeRateService.normalizeDate` and the manual-entry
          validator use. ⚠ The existing `NBPProvider` stores Warsaw
          midnight (`fromZonedTime`), which is not UTC midnight; whether its
          rows are found by the exact-date lookup is not shown by any test
          on `develop`. The implementation PR proves the `NBP_A` round trip
          (store, then `getRate`) with a test, and reports the `NBP` result
          to OM Core without changing `NBPProvider` in that PR.
        - *Precision:* NBP publishes four decimals; stored in
          `numeric(18,8)` as given, no recomputation.
        - *Unit check (Unverified):* that NBP's JSON returns `mid` per one
          unit for currencies the printed table quotes per 100 (JPY, HUF)
          has not been checked against a real response here. The provider's
          contract test must assert it before the provider is relied on.
        - *Existing consumers (checked on `develop`).* The only consumer of
          `ExchangeRateService` outside `currencies` is the customers deals
          aggregate (`api/deals/aggregate/route.ts`), which reads
          `autoFetch: false` and takes `rates[0]` ("sources are equivalent
          for display purposes"). `findExactRates` has no ordering, and an
          `XXX → PLN` pair will now have an `NBP` (Table C bid) row and an
          `NBP_A` (mid) row, so that display total may use either; the
          difference is small and display-only, the same situation Raiffeisen
          rows already create. The implementation PR notes it in
          `services/README.md` ("Choosing Between Multiple Providers") and
          does not change the consumer.
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

10. **Validate before any ledger write, serialize per tenant, and keep
    external I/O out of the locked transaction.** An earlier draft
    reversed the prior run before checking for missing rates, so a later
    `422` could delete a valid valuation while posting no replacement.
    The order is: (a) **before the transaction**, resolve the in-scope
    currency codes and every needed rate (Design decision 9) with
    `ExchangeRateService.getRates()` as it is: with its default
    `autoFetch: true` this may call a provider over HTTP and insert rate
    rows, which is the only side effect and is idempotent; a failure
    here ends the call with no ledger effect. (b) Open
    `em.transactional()` and take
    `pg_advisory_xact_lock(hashtextextended('fx_revaluation:' ||
    organizationId || ':' || tenantId, 0))` through `em.execute(...)`
    (not `em.getConnection().execute`, which would run outside the
    transaction). A row lock on "the current `POSTED` run" is not
    enough: for a tenant's first run there is no row, and two concurrent
    first runs would both post. A partial unique index on
    `FxRevaluationRun (organization_id, tenant_id, fiscal_period_id)
    WHERE status = 'POSTED'` is the backstop (a violation answers **409
    `FX_RUN_CONFLICT`**; unreachable while the lock holds). (c) Inside
    the transaction, read the documents and their open amounts as of
    `valuationDate` (Design decision 13), validate that every in-scope
    document has a non-null `exchangeRate`, and re-read the rates with
    `autoFetch: false` — the rows (a) made available; any failure aborts
    before anything is written. (d) If a `POSTED` run exists for this
    fiscal period, supersede it (Design decision 6):
    `ledger.reverseJournalEntry` for each of its entries, skipped for an
    entry id that is null (a no-op run), and mark it `SUPERSEDED`. (e)
    Post the valuation and its reversing entry (Design decision 12) — or
    neither, if every individual delta is exactly zero (Design decision
    11) — and insert the new `FxRevaluationRun`/`FxRevaluationLine`
    rows. The ledger commands are called through `commandBus.execute`
    with the open EntityManager as `ctx.transactionalEm`
    (`CommandRuntimeContext` in `@open-mercato/shared`); the ledger
    commands treat a call that carries it as composed, running inside
    the caller's transaction and not emitting their own events before it
    commits (GL core engine implementation, #6340). A failure anywhere
    rolls back the whole step: the supersede, the two postings and the
    inserts commit together or not at all.

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

12. **The valuation reverses itself on the first day of the next period,
    in the same transaction — so a settlement in the new period needs no
    gate.** The previous draft let the unrealized valuation stand until
    "the next revaluation run" and made `matchBankStatementLine` reject
    (`409 PRIOR_VALUATION_NOT_REVERSED`) any document in an unreversed
    run. Review of `d9bf77e1e` found the flaw: the only thing that
    reverses a run is the next run, which Design decision 13 accepts
    only for the period being closed, so an EUR receivable valued on 31
    December and paid on 3 January could not be matched until the 31
    January run — a month of foreign-currency collections and payments
    blocked. The fix is the one Kieso describes (Design decision 5):
    `revalueOpenBalances` posts the valuation dated `valuationDate` and,
    in the same transaction, a reversing entry (a `NORMAL` entry with
    inverted lines) dated the first day of the next period. Worked
    example: an invoice booked at 400 PLN is valued at 420 on 31
    December (+20 unrealized gain); on 1 January the reversing entry
    posts −20; when the customer pays 420 on 3 January, Cash & Bank
    Management clears the booked 400 and recognizes a realized gain of
    20 — the control account carries no stale 20 and the gain over both
    periods is 20, not 40. A settlement dated after `valuationDate` but
    before the run executes is also handled, because the balance is
    valued as of `valuationDate` (Design decision 13), not as of the
    run. Consequences: Cash & Bank Management's settlement path needs
    **no** new precondition, so the cross-module coupling into
    `cash-bank-management.md` and its `409 PRIOR_VALUATION_NOT_REVERSED`
    are removed from this spec (Patches to sibling specs, Risks); and
    the reversing entry needs an unlocked `FiscalPeriod` covering the
    day after the period's end — if there is none, the call fails **409
    `NEXT_PERIOD_UNAVAILABLE`** before anything is written (API
    Contracts).

13. **The balance is valued as of `valuationDate`: later settlements are
    added back and later documents excluded; a grace window still bounds
    what the module cannot reconstruct.** An earlier draft used
    current-state open amounts, bounded only by `valuationGraceDays`.
    Review of `d9bf77e1e` showed that the window limits the cutoff error
    but does not remove it: a 31 December run executed on 5 January
    would drop a payment made on 3 January, understate a partial payment
    made on 4 January, and include an invoice issued on 2 January, with
    nothing to reject or flag it. The rule is now: the open amount of a
    document is the formula of Design decisions 17 and 18 taken over the
    settlements dated **on or before `valuationDate`**, and a document
    whose posting date is after `valuationDate` is excluded. The
    settlement dates already exist as data (`BankStatementLine.lineDate`
    for sales invoices; the batch's `sentOn` for vendor invoices, see
    Design decision 18) — this is a dated filter on existing rows, not a
    historical-snapshot engine. What the module still cannot reconstruct
    is a change that leaves no dated trace — for example a document
    cancelled or re-priced after the valuation date — and that is what
    the grace window is for: **`valuationDate` must fall within
    `fx_revaluation.valuationGraceDays` of today** (default `10`, a
    realistic month-end close cycle) and `fiscalPeriodId` must be the
    tenant's **latest unlocked period whose end date is not after
    today**. Outside that, **422 `VALUATION_DATE_TOO_STALE`**. A locked
    period is a different answer — **409 `FISCAL_PERIOD_LOCKED`** —
    because revaluation is a pre-close step; the earlier text spoke of a
    "closed-or-closing" period here and "409 if already `CLOSED`" in the
    API, which contradicted each other, and both now say "locked"
    (`FiscalPeriod.isLocked`).

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
    `exchangeRate`, and the commands that set a rate belong to the
    module that owns the document.** `SalesInvoice` rows that predate
    this feature have `currencyCode` but neither `currencyId` nor
    `exchangeRate`; `VendorInvoice` rows already carry `currencyId`
    (Design decision 3) and lack only `exchangeRate`. A one-time
    migration backfills `SalesInvoice.currencyId` (a pure,
    rate-independent `currencyCode` → `Currency.id` lookup, scoped per
    `organizationId`/`tenantId`) — safe because it needs no historical
    rate. `exchangeRate` is **not** backfilled automatically: a rate
    resolved retroactively for a document issued months ago would be a
    guess, not the rate the party actually saw. Pre-existing
    foreign-currency documents therefore make a run fail loudly (**422
    `EXCHANGE_RATE_MISSING_ON_DOCUMENT`**, Edge Cases) until an operator
    sets the rate per document. **Ownership (2026-10-15 review round):**
    `fx_revaluation` never writes `SalesInvoice` or `VendorInvoice` (its
    `AGENTS.md` says so). An earlier draft put a
    `fx_revaluation.backfillDocumentRate` command here; it wrote the
    owners' entities directly, bypassing their command pipeline
    (audit/undo, CRUD events, query-index refresh, optimistic locking),
    and inverted the one-way dependency this spec claims. Each owning
    module now exposes the command on its own pipeline: `sales` — `POST
    /api/sales/invoices/:id/exchange-rate/backfill`; `accounts_payable`
    — `POST
    /api/accounts_payable/invoices/:id/exchange-rate/backfill`
    (path as defined in `accounts-payable.md`, 2026-10-15). Contract, the same for
    both: body `{}`; requires the owning module's own invoice-manage
    feature, not an `fx_revaluation` one; resolves `exchangeRate` with
    the same rule as a new document (Design decision 2:
    `ExchangeRateService` against the document's own `issueDate`, source
    priority per Design decision 9); **200** `{ exchangeRate,
    rateSource, rateDate }`; **409 `EXCHANGE_RATE_ALREADY_SET`** when
    the rate is not null; **404** when the document is not in the
    caller's scope; **422 `EXCHANGE_RATE_UNAVAILABLE`**. Once
    `currencyId` and `exchangeRate` exist on a document (new or
    backfilled), both are **immutable after the document posts**; the
    guard allows exactly one transition, `exchangeRate` null → value,
    through this command. A draft (pre-posting) edit to `currencyCode`
    or `issueDate` (both still editable per `sales.invoices.update`'s
    current contract, checked directly against
    `packages/core/src/modules/sales/commands/documents.ts`) triggers
    re-resolution of both fields — inside `sales.invoices.update` (and
    its `accounts_payable` equivalent), not in `fx_revaluation` — since
    the document is not booked yet; once posted, `currencyCode`,
    `issueDate`, `currencyId` and `exchangeRate` are frozen together
    (correcting a posted document means reversing it, the same "reversal
    not undo" discipline as GL core engine — see Out of scope), so the
    three fields can never silently diverge. The guard is a new
    coordination point for `sales-invoice-gl-posting.md` (or wherever
    `sales.invoices.update` is next revised) and for the
    `accounts-payable.md` equivalent, added to Patches to sibling specs.

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

17. **The open amount of a sales invoice is read ledger-side, never from
    `SalesInvoice.outstandingAmount`, and only for invoices that are in the
    ledger.** `sales` does not maintain that column for invoices (a payment
    recalculates the order's totals only; a created invoice carries whatever
    the caller wrote, default `0`), so reading it would exclude every
    default-created invoice as "fully settled" and misstate the rest. The
    revaluation entry adjusts the receivable control account, so its base
    must be what the ledger actually holds for the invoice:
    `grandTotalGrossAmount − Σ BankStatementLine.settledAmount` over the invoice's `sales_invoice` matches dated on or before `valuationDate` (`BankStatementLine.lineDate`; Design decision 13) in Cash & Bank Management (#6055; a
    soft read: no `cash_bank_management`, no settlements), and only for an invoice posted on or before `valuationDate` with an unreversed `JournalEntry` carrying
    `referenceType: 'sales:sales_invoice'`, `referenceId: invoice.id` (the
    reference #6046 writes). An unposted invoice is not in the ledger and is
    never revalued. This is consistent with the settlement path:
    `matchBankStatementLine` clears the receivable by `settledAmount` and
    checks the same remaining balance. Known gap: a payment recorded in
    `sales` by hand never credits the receivable in `ledger`, so it does not
    reduce this open amount either (see #6046, Risks). An overpayment goes to
    a separate liability account in #6055 and is not revalued here. Vendor
    invoices follow Design decision 18. (Alternative rejected: wait for
    `sales` to maintain invoice balances and read the column — that change
    is wanted for aging and display, but a column fed by payments the ledger
    never saw would revalue amounts the ledger does not hold.)

18. **The open amount of a vendor invoice is derived from `accounts_payable`
    and `accounts_payable_payments` data, because `VendorInvoice` has no
    `outstandingAmount` column.** (An earlier draft assumed
    `accounts_payable` maintains one; its specs define `VendorInvoice` with
    `total_gross` only, no `PAID` status and no settlement flag, and record
    payments on `PaymentBatchLine`.) For an invoice with `status = 'POSTED'`
    (it is in the ledger, posted on or before `valuationDate`; an unposted or cancelled invoice is never revalued) the open amount as of `valuationDate` is
    `total_gross − Σ PaymentBatchLine.amount` over its lines on payment batches with `status = 'SENT'` and `sentOn` on or before `valuationDate` (only `markPaymentBatchSent` posts the
    payment; a line on a `DRAFT` or `CONFIRMED` batch has paid nothing). In
    Phase 1 of `accounts_payable_payments` a line always carries the full
    invoice amount, so the open amount is `total_gross` or `0`; the formula
    is already right for the Phase 2 partial payments. The read is a soft,
    FK-id-only read of `accounts_payable_payments` (no ORM relation); with
    the module absent no payment exists and every posted invoice is fully
    open. **Decided (2026-10-12): the open amount of a vendor invoice stays
derived from `accounts_payable` / `accounts_payable_payments` data; it is
not moved ledger-side.** The per-invoice detail is the subsidiary ledger
(the knowledge base's control-account + subsidiary-ledger convention): the
shared liability account is the control account and the per-invoice
breakdown lives in the consuming module's own tables. None of the three
tagging mechanisms fits "this line settled that invoice" (the chart-of-accounts
parent is static, `journal_entry_line_dimensions` deliberately excludes the
counterparty, `contractorSnapshot` is a counterparty audit copy), and posting
one entry per invoice would break the one-entry-per-batch shape that bank
statement matching relies on. Sales invoices differ for a different reason:
`sales` does not maintain invoice balances (decision 17), so their open amount
is read ledger-side as a workaround, not as the pattern to follow. The
`fx_revaluation` read of `PaymentBatchLine` is allowed under these conditions:
it is an optional peer (module absent: every posted invoice fully open); it is
FK-id-only with the tenant/organization scope applied and no ORM relation
(the precedent is `communication_channels` reading `messages`); and the
columns it relies on (`vendorInvoiceId`, `amount`, the batch `status`) are listed as
a contract in the payments spec, so a change to them is a visible spec change.
Decided by the team (2026-10-12): no external review of this direction; the reasoning rests on the knowledge base's conventions and the two AP specs. **Added 2026-10-15 (as-of valuation, Design decision 13):** the as-of filter needs the date a batch was sent. The payments spec defines no such field — `PaymentBatch` has `scheduledPaymentDate` only — so the read contract lists `sentOn` (the `operationDate` of the payment entry `markPaymentBatchSent` posts) beside `vendorInvoiceId`, `amount` and the batch `status`. **Done 2026-10-15:** the payments spec (`docs/accounts-payable`) now has `PaymentBatch.sentOn`, an optional `sentOn` input on `markPaymentBatchSent` (default today, not later than today) and a "Read contract for other modules" section listing these columns, with this module as the first consumer. The read-contract paragraph itself (three columns) had been added on 2026-10-12 (`6dea4561d`); only `sentOn` is new.

## Architecture

### New module: `fx_revaluation` (Core)

- `data/entities.ts` — `FxRevaluationRun`, `FxRevaluationLine` (see
  Data Model).
- `commands/revalueOpenBalances.ts` — the one command this module
  exists for. Its order of work is Design decision 10: rates are
  resolved before the transaction; inside `em.transactional()` it takes
  the per-tenant advisory lock through `em.execute`, re-validates, and
  supersedes the fiscal period's `POSTED` run if there is one (two
  `ledger.reverseJournalEntry` calls); then it posts the valuation entry
  and its reversing entry (two `ledger.postJournalEntry` calls, Design
  decisions 5 and 12) and inserts the run and its lines. The ledger
  commands are called through `commandBus.execute` with the open
  EntityManager as `ctx.transactionalEm` (`CommandRuntimeContext`), so
  they run inside this transaction; this module emits no event of its
  own (Canonical Mechanisms). It reads open `VendorInvoice`/`SalesInvoice`
  data directly through `entityManager` (scoped by `tenantId` and
  `organizationId`, FK-id reads, no ORM relation), calls
  `currencies.ExchangeRateService.getRates()` (batch) for the valuation
  date, and computes per-document unrealized gain/loss per Design
  decisions 9 and 11. It reads; it never writes another module's
  entities.
- API route files (auto-discovery layout; `preview` is a literal segment
  and is not shadowed by `[id]`): `api/runs/route.ts` — `POST` and `GET`
  (list); `api/runs/preview/route.ts` — `GET`;
  `api/runs/[id]/route.ts` — `GET` (detail).
- `acl.ts` — `fx_revaluation.runs.create` and `fx_revaluation.runs.read`;
  `setup.ts` — default role features for both.
- `AGENTS.md` — module rules: MUST NOT write to `VendorInvoice` or
  `SalesInvoice`, and MUST NOT read `SalesInvoice.outstandingAmount` (open
  amounts follow Design decisions 17 and 18); MUST reject (not skip) a
  document whose `currencyId` differs from base but whose `exchangeRate` is
  null; MUST read the `FiscalPeriod` lock state before posting; MUST refuse
  to post when no rate from a `ratePriority` source is resolvable (Design
  decision 9c).
- **Depends on**: `currencies` (hard — rate lookups), `ledger` (hard —
  posts `JournalEntry`, reads the `sales:sales_invoice` posting),
  `accounts_payable`/`accounts_payable_payments`/`sales`/
  `cash_bank_management` (soft, direct reads only — no ORM relations,
  matching the root AGENTS.md "no direct ORM relationships between modules"
  rule). Status of each: Implementation Plan, "Blocked on".

### Patches to sibling specs (small, forward-pointer style)

- `accounts-payable.md` — add `VendorInvoice.exchangeRate`
  (`numeric(18,8)`, nullable) with a pointer to this document for the
  resolution rule; the `backfill` command and route, the draft-edit
  re-resolution, and the post-posting immutability guard (Design decision
  15).
- The spec owning `SalesInvoice` (`sales-invoice-gl-posting.md`, since it
  already documents `SalesInvoice`'s current currency handling in detail) —
  add `SalesInvoice.currencyId`/`exchangeRate`, the same `backfill` command
  and route, the draft-edit re-resolution in `sales.invoices.update`, the
  post-posting immutability guard (Design decision 15), and a note that
  `postSalesInvoiceToLedger`'s `currencyCode` → `currencyId` resolution
  should read the stored `currencyId` once this ships.
- `accounts-payable-payments.md` — the read contract for other modules (paragraph of 2026-10-12) lists:
  `PaymentBatchLine.vendorInvoiceId` and `amount`, and, from
  `PaymentBatch`, `status` and `sentOn` (the `operationDate` of the entry
  `markPaymentBatchSent` posts). `sentOn` was added to it on 2026-10-15 (Design decision 18).
- `cash-bank-management.md` — note that `bookedExchangeRate` can default
  from `SalesInvoice.exchangeRate` once populated, **only when the bank
  account's currency equals the tenant's base currency** (Design decision
  14); and list `BankStatementLine.settledAmount`, `lineDate` and the
  match's invoice reference as the read contract (Design decision 17).
  **No settlement precondition is needed** — the earlier
  `PRIOR_VALUATION_NOT_REVERSED` patch is withdrawn (Design decision 12).

## Data Model

### `fx_revaluation.FxRevaluationRun`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organizationId` / `tenantId` | `uuid` | scope, as everywhere else |
| `fiscalPeriodId` | `uuid` (FK-id, no ORM relation) | the period this run values as of |
| `baseCurrencyId` | `uuid` (FK-id → `currencies.Currency`) | the base currency actually used for this run, snapshotted at creation (Design decision 16) |
| `valuationDate` | `date` | the date requested (may differ from `valuationRateDate` after fallback) |
| `supersedesRunId` | `uuid`, nullable (FK-id) | the earlier run for the same fiscal period this one replaced, if any (Design decision 6) |
| `journalEntryId` | `uuid`, nullable (FK-id) | the posted `NORMAL` valuation entry, dated `valuationDate`; `null` for a no-op run (Edge Cases) |
| `reversingJournalEntryId` | `uuid`, nullable (FK-id) | the posted `NORMAL` reversing entry, dated the first day of the next period (Design decision 12); `null` exactly when `journalEntryId` is |
| `status` | `'POSTED' \| 'SUPERSEDED'` | `SUPERSEDED` once a later run for the same fiscal period has cancelled both entries (Design decision 6) |
| `totalUnrealizedGainLoss` | `numeric(18,4)` | base currency, signed net of gains and losses (P&L total; individual control-account legs are on `FxRevaluationLine`, Design decision 11) |
| `createdBy` | `uuid` | acting user |
| `createdAt` | `timestamptz` | |

Partial unique index `(organization_id, tenant_id, fiscal_period_id) WHERE
status = 'POSTED'`: at most one live run per fiscal period (the backstop
for Design decision 10b).

### `fx_revaluation.FxRevaluationLine`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organizationId` / `tenantId` | `uuid` | scope, copied from the run (the line is read directly, so it carries its own) |
| `runId` | `uuid` (FK-id) | parent `FxRevaluationRun` |
| `documentType` | `'vendor_invoice' \| 'sales_invoice'` | drives the sign convention, Design decision 11 |
| `documentId` | `uuid` (FK-id, no ORM relation) | |
| `currencyId` | `uuid` (FK-id → `currencies.Currency`) | the document's own currency |
| `outstandingAmountInDocumentCurrency` | `numeric(18,4)` | for a `vendor_invoice` the open amount of Design decision 18, for a `sales_invoice` the ledger-side open amount (Design decision 17), computed at run time |
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
- **404** if the `FiscalPeriod` is not found in the caller's scope.
  **409 `FISCAL_PERIOD_LOCKED`** if it is locked (revaluation is a
  pre-close step, not a post-close one). **409 `NEXT_PERIOD_UNAVAILABLE`**
  if no unlocked `FiscalPeriod` covers the day after the period's end —
  the reversing entry needs one (Design decision 12); nothing is written.
- **422 `VALUATION_DATE_TOO_STALE`** if `valuationDate` falls outside
  `fx_revaluation.valuationGraceDays` of today, or `fiscalPeriodId` isn't
  the tenant's latest unlocked period ending on or before today (Design
  decision 13).
- **422 `BASE_CURRENCY_CHANGED`** if the tenant's current `Currency.isBase`
  row doesn't match the most recent prior run's `baseCurrencyId` (Design
  decision 16).
- **Rates are resolved first, outside the transaction** (Design decision
  10a): **422 `EXCHANGE_RATE_UNAVAILABLE`** (no row from a `ratePriority`
  source after lookback and auto-fetch — never a fallback to Table C) or
  **422 `EXCHANGE_RATE_AMBIGUOUS`**, with the specific currency and date;
  no ledger write has happened.
- **In the transaction** (Design decision 10b–e): takes the per-tenant
  advisory lock; reads all vendor invoices (posted, open amount `> 0` as of
  `valuationDate`, `currencyId` ≠ tenant base currency; Design decision 18)
  and all posted sales invoices (ledger-side open amount `> 0` as of
  `valuationDate`, `currencyId` ≠ base; Design decision 17); rejects **422
  `EXCHANGE_RATE_MISSING_ON_DOCUMENT`** if any in-scope document has
  `exchangeRate: null` — a data problem to surface, not paper over with an
  assumed rate of `1` (remedy: the owning module's `backfill` command,
  Design decision 15); supersedes the fiscal period's `POSTED` run if there
  is one; then posts the valuation entry and its reversing entry with
  per-control-account, per-side legs (Design decisions 11 and 12). Both
  entries are omitted only if every individual document delta is exactly
  `0`; the run is then recorded with `journalEntryId: null` and
  `reversingJournalEntryId: null`.
- **409 `FX_RUN_CONFLICT`**: the partial unique index fired (unreachable
  while the advisory lock holds; Design decision 10b).
- **Response 201**: `{ runId, journalEntryId, reversingJournalEntryId,
  supersedesRunId?, totalUnrealizedGainLoss, lineCount }`.
- **Response 403**: caller lacks `fx_revaluation.runs.create`.

### `GET /api/fx_revaluation/runs/preview`

- **Query**: `{ fiscalPeriodId: string, valuationDate?: string }` — same
  inputs and same validation as `POST /runs` (period, next period,
  staleness, base currency, rates), but read-only: computes and returns the
  line list without posting or superseding anything.
- **Response 200**: `{ lines: FxRevaluationLinePreview[],
  totalUnrealizedGainLoss, wouldSupersedeRunId? }` — the same shape the UI's
  preview table renders (UI/UX below). A preview is **not** cached and
  **not** guaranteed to still be valid by the time `POST /runs` executes
  (rates, a document's open amount, or the fiscal period's `POSTED` run can
  change between the two calls) — the UI must re-preview, not silently
  repost, if the user waits before confirming.
- **Response 403**: caller lacks `fx_revaluation.runs.create` (same feature
  as posting — previewing a run a caller can't post has no use case here).

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

- **No open foreign-currency documents at all.** The run completes with
  `lineCount: 0`, `journalEntryId: null`, `reversingJournalEntryId: null`,
  `status: 'POSTED'` (a no-op run is still recorded, so period-end history
  shows revaluation was checked, not skipped).
- **AR and AP deltas exactly offset (net P&L is `0`, but neither control
  account moved by `0`).** Still posts all four legs (Design decision 11) —
  only a single document's own delta being exactly `0` is omitted from the
  entry; the "no documents at all" no-op above is the only case with no
  entry at all.
- **Revaluing the same fiscal period again, the earlier run being a
  no-op** (both entry ids null). Marked `SUPERSEDED` with no call to
  `ledger.reverseJournalEntry` — nothing was posted, so nothing needs
  cancelling (Design decision 10d).
- **A document's `exchangeRate` is `null` because it predates this
  feature.** Rejected outright (**422 `EXCHANGE_RATE_MISSING_ON_DOCUMENT`**)
  rather than silently assuming rate `1`; the supported remedy is the
  owning module's explicit, one-document `backfill` command (Design
  decision 15), not automatic bulk backfill.
- **Exchange rate for `valuationDate` genuinely doesn't exist** (e.g. a
  weekend/holiday with no published NBP rate). Relies on
  `ExchangeRateService`'s own `maxDaysBack` recursive lookback before
  surfacing `EXCHANGE_RATE_UNAVAILABLE` — this spec does not reimplement
  that fallback.
- **No `NBP_A` (Table A) row for a currency and date, but a Table C or
  Raiffeisen row exists.** Not used: **422 `EXCHANGE_RATE_UNAVAILABLE`**
  naming the source (Design decision 9c). The statutory rate class is not
  traded for availability.
- **Two sources both listed in `ratePriority` return a rate for the same
  pair and date.** Resolved deterministically by the list order (Design
  decision 9c); a genuine tie (two equally-ranked manual entries) is
  rejected (**422 `EXCHANGE_RATE_AMBIGUOUS`**), never picked arbitrarily.
- **Two concurrent `POST /runs` calls for the same tenant/org.** The second
  waits on the advisory lock (Design decision 10b) until the first
  commits, then supersedes it — also on a tenant's first run, which a row
  lock could not serialize.
- **A document settled after `valuationDate` but before the run executes**
  (31 December run, executed 5 January, payment on 3 January). The balance
  is valued as of `valuationDate`, so the payment is added back and the
  document is revalued on its 31 December open amount (Design decision 13);
  the reversing entry on 1 January then unwinds exactly what was posted.
- **A document issued after `valuationDate` but before the run executes.**
  Excluded (Design decision 13).
- **A revalued document is settled in the new period.** No gate and no
  rejection: the valuation was reversed on the first day of the new period,
  so the settlement sees only the booked rate and the realized gain/loss
  posts once (Design decision 12).
- **The day after the period's end has no unlocked `FiscalPeriod`** (the
  next fiscal year's periods were not generated yet, or the next period is
  already locked). Rejected (**409 `NEXT_PERIOD_UNAVAILABLE`**) before any
  write; the valuation is never posted without its reversing entry.
- **`valuationDate` is more than `valuationGraceDays` in the past, or the
  period is no longer the latest unlocked one.** Rejected (**422
  `VALUATION_DATE_TOO_STALE`**, Design decision 13) — the module does not
  reconstruct changes that leave no dated trace.
- **The tenant's base currency changed since the prior run.** Rejected
  (**422 `BASE_CURRENCY_CHANGED`**, Design decision 16) rather than
  silently mixing a stored rate against the old base with a fresh lookup
  against the new one.
- **Cross-currency settlement (bank currency ≠ base ≠ invoice currency).**
  `bookedExchangeRate` cannot default from the invoice's own stored rate
  (different units) — entered explicitly or derived via the two-hop
  cross-rate `cash-bank-management.md` would need to implement (Design
  decision 14); this spec does not silently substitute one for the other.
- **Partial settlement between the document's issue date and the valuation
  date.** Revaluation uses the open amount as of `valuationDate`, not the
  original total. For a vendor invoice that is `total_gross` less its lines
  on `SENT` batches sent on or before that date (Design decision 18); for a
  sales invoice it is the ledger-side open amount at that date (Design
  decision 17), because `sales` does not maintain
  `SalesInvoice.outstandingAmount`. Fully-settled documents (open amount =
  0) are excluded.
- **Running the command twice for the same period before close.** The
  second call cancels the first run's two entries (each dated with its own
  date) and posts a fresh pair — no manual cleanup, no double-counted
  unrealized balance in either period.
- **A locked `FiscalPeriod`.** Rejected (**409 `FISCAL_PERIOD_LOCKED`**) —
  revaluation belongs to the closing checklist, before the period is locked.

## Risks & Impact Review

- **UoR Art. 30 is now Confirmed (closed 2026-09-21, Design decision
  8) — and it confirms a real, previously-speculative gap.** Art. 30
  ust. 1 names the NBP **average rate** ("średni kurs... przez
  Narodowy Bank Polski") as the required valuation rate, but
  `NBPProvider` only fetches NBP's Table C (commercial bid/ask), never
  Table A (the average rate). This is no longer a "confirm before
  implementation" open question — it is a **confirmed statutory
  non-compliance in this design as written**: `fx_revaluation`'s
  Design decision 9 rate-selection policy would post period-end
  valuations at the wrong rate class until `currencies` gains a Table A
  fetcher (out of this document's own module boundary, Design decision
  1). **Severity: High** — this is a correctness gap in the amounts
  the module posts, not a cosmetic one, though it is caught before any
  implementation exists. **Mitigation**: Implementation Plan Step 0 is a concrete, scoped task (add a Table A provider to `currencies` under its own `source: 'NBP_A'`, so the unique key and `currencies`' schema stay as they are — checked against the code on `develop`, Design decision 9c; it can also be registered from `fx_revaluation` through the public provider registry if OM Core prefers); `fx_revaluation` refuses to post (422 `EXCHANGE_RATE_UNAVAILABLE`) until a Table A row is resolvable, instead of falling back to Table C, so the gap can delay the module but cannot produce a wrong posting. **Detection**: none
  needed pre-implementation; once built, a valuation run using Table C
  instead of Table A would be caught by comparing posted rates against
  NBP's own published Table A for the same date — a reconciliation
  check worth adding to Testing Strategy when `currencies`' Table A
  support is designed.
- **The reversing entry needs an unlocked next period (Design decision 12).**
  A tenant that locks the next fiscal year's periods early, or has not
  generated them, cannot run the valuation (409 `NEXT_PERIOD_UNAVAILABLE`).
  Intended — the alternative is a valuation with no reversing entry — but it
  adds a step to the year-end checklist: generate the new year's periods
  before the last run of the old one. **Severity: Low** (explicit error, no
  wrong posting).
- **The as-of valuation (Design decision 13) rests on settlement dates in
  two sibling specs.** `BankStatementLine.lineDate` is in #6055; the batch's
  `sentOn` was missing from the payments spec and was added on 2026-10-15
  (Design decision 18); it is in the spec, not yet implemented, so
  vendor-invoice valuation waits for the payments implementation.
  **Severity: Low** — a spec gap, closed before implementation.
- **Cash & Bank Management needs no change for revaluation (Design decision
  12)** — only the optional `bookedExchangeRate` default (Design decision
  14). The earlier `PRIOR_VALUATION_NOT_REVERSED` precondition, which would
  have blocked settlement of every revalued document, is withdrawn.
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
- **Sibling contracts are proposed, not shipped.** Every contract this design calls is in an open spec PR and none is on `main` (Implementation Plan, "Blocked on"). **None of `accounts_payable`, `sales`'s invoice-GL-posting, `ledger`, or `fixed_assets`' currency handling has shipped code yet** — this
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
  commands) before being addressed; see Changelog for the full list and citations. A second review (PR #6190, reviewed head `d9bf77e1e`) raised one blocker (the settlement gate), five majors and minors; each was re-verified against the spec and the `currencies` source and is recorded in the 2026-10-15 changelog entry.

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
  noted as a real alternative treatment in general accounting practice;
  **rejected, now confirmed correct rather than pending** — Art. 30
  ust. 4 (Confirmed, Design decision 8) routes exchange differences on
  everything except long-term investments (Art. 35 terms instead, out
  of this spec's scope) to financial income/costs, i.e. P&L, matching
  how realized FX already posts in Cash & Bank Management.
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
- Point-in-time reconstruction of AP/AR balances beyond the dated filter of Design decision 13 — a change that leaves no dated trace (a document cancelled or re-priced after the valuation date) is not reconstructed; revaluation must run within `valuationGraceDays` of the period it values.
- Automatic bulk backfill of `exchangeRate` on documents that predate this feature (Design decision 15) — the explicit, per-document `backfill` command of the owning module (`sales`, `accounts_payable`) is the supported path.
- Preventing (rather than detecting after the fact) a tenant's base
  currency from changing once foreign-currency documents exist
  (Design decision 16) — that guard belongs to the `currencies`
  module's own spec, not this one.

## Implementation Plan

**Blocked on (gate before Step 1).** Every contract this design calls is
proposed in an open spec PR; none is on `main`. Implementation does not
start for a step until the contract it uses is merged or pinned to a commit.
Proposed: `ledger` — `postJournalEntry`, `reverseJournalEntry`,
`FiscalPeriod` (#5663 spec, #6340 implementation); `accounts_payable` —
`VendorInvoice` (#5962) and `accounts_payable_payments` — `PaymentBatchLine`
and `PaymentBatch.sentOn` (in the payments spec since 2026-10-15, Design decision 18);
`cash_bank_management` — bank statement lines and matches (#6055);
`sales_invoices_gl_posting` — the `sales:sales_invoice` reference and the
receivable-account config (#6046); `currencies` — Table A provider (Step 0,
not started). Each is to be recorded here with its PR and commit when
implementation starts. This PR's base branch is to be aligned with the
sibling spec PRs.

0. **Add NBP Table A (average-rate) support to `currencies` before the
   commands/UI steps below — resolved 2026-09-21, Design decision 8.**
   Art. 30 ust. 1 requires the NBP average rate specifically, and
   `NBPProvider` fetches only Table C. This step is a provider of its own
   (`source: 'NBP_A'`, rows `type: null`; Design decision 9c) added to
   `currencies` (`services/providers/nbpTableA.ts`, registered in `di.ts`;
   no change to `RateProviderResult` or the validators) as the first
   commit of the implementation PR — no separate PR, no change to the
   `exchange_rates` unique key. The fallback, if OM Core objects, is to
   register the same provider from `fx_revaluation` via
   `registerCurrencyRateProvider`. `fx_revaluation.ratePriority` then defaults
   to `['NBP_A']`.
1. Patch `accounts-payable.md`, the `SalesInvoice`-owning spec,
   `accounts-payable-payments.md` and `cash-bank-management.md` as listed
   in Patches to sibling specs: the field additions (Design decision 3),
   the owner-side `backfill` command and route, the draft-edit
   re-resolution and post-posting immutability guard (Design decision 15),
   the payments read contract with `sentOn`, and the cash-bank read
   contract.
2. Scaffold `fx_revaluation` module: entities (including
   `FxRevaluationRun.baseCurrencyId` and the partial unique index),
   `AGENTS.md`, `acl.ts`, `setup.ts`, module registration, dependency
   declarations (`currencies`, `ledger`), and the `ratePriority`,
   `valuationGraceDays`, `unrealizedGainAccountId`,
   `unrealizedLossAccountId` Module Config keys.
3. Implement `revalueOpenBalances`: rate resolution outside the
   transaction (Design decision 9, 10a), the advisory-lock transaction
   (Design decision 10), the as-of open amounts (Design decisions 13, 17,
   18), the sign convention and per-control-account aggregation (Design
   decision 11), the supersede step (Design decision 6), the valuation and
   reversing entries (Design decisions 5, 12), and the staleness,
   next-period and base-currency guards (Design decisions 12, 13, 16).
4. Implement `POST /api/fx_revaluation/runs`, `GET
   /api/fx_revaluation/runs/preview`, `GET /api/fx_revaluation/runs` and
   `GET /api/fx_revaluation/runs/:id` in the route-file layout of
   Architecture, with the rejection rules from API Contracts.
5. Implement the `backfill` commands and routes in `sales` and
   `accounts_payable` (Design decision 15) — in those modules, on their own
   command pipelines.
6. Implement the admin preview/run UI and read-only history under Ledger →
   Period-End (UI/UX).
7. Wire `VendorInvoice`/`SalesInvoice` creation commands to resolve and
   store `exchangeRate` (and, for `SalesInvoice`, `currencyId`) at creation
   time, once those modules exist.
8. Coordinate the `cash-bank-management.md` patch: the
   base-currency-equals-bank-currency restriction on defaulting (Design
   decision 14) and the read contract. There is no settlement precondition
   to coordinate (Design decision 12).

## File Manifest

| File | Change |
|---|---|
| `.ai/specs/2026-09-17-multi-currency.md` | New (this document) |
| `packages/core/src/modules/fx_revaluation/data/entities.ts` | New — `FxRevaluationRun` (incl. `baseCurrencyId`, `supersedesRunId`, `reversingJournalEntryId`), `FxRevaluationLine` (incl. `organizationId`/`tenantId`, `valuationRateSource`/`valuationRateDate`) |
| `packages/core/src/modules/fx_revaluation/migrations/` | New — both tables, the partial unique index (generated, not hand-written) |
| `packages/core/src/modules/fx_revaluation/AGENTS.md` | New |
| `packages/core/src/modules/fx_revaluation/acl.ts` | New — `fx_revaluation.runs.create`, `fx_revaluation.runs.read` |
| `packages/core/src/modules/fx_revaluation/setup.ts` | New — default role features, Module Config defaults |
| `packages/core/src/modules/fx_revaluation/commands/revalueOpenBalances.ts` | New |
| `packages/core/src/modules/fx_revaluation/api/runs/route.ts` | New — `POST /runs`, `GET /runs` |
| `packages/core/src/modules/fx_revaluation/api/runs/preview/route.ts` | New — `GET /runs/preview` |
| `packages/core/src/modules/fx_revaluation/api/runs/[id]/route.ts` | New — `GET /runs/:id` |
| `packages/core/src/modules/fx_revaluation/backend/` | New — Ledger → Period-End page (preview, run, history) |
| `packages/core/src/modules/fx_revaluation/i18n/` | New — locale keys (Internationalization section) |
| `packages/core/src/modules/fx_revaluation/**/__tests__/` | New — the Testing Strategy matrix |
| `packages/core/src/modules/currencies/services/providers/nbpTableA.ts` | New (Implementation Plan Step 0) — Table A provider, `source: 'NBP_A'`, `type = null`; lives in `currencies`, not in this module (Design decision 9c) |
| `packages/core/src/modules/currencies/di.ts` | Patch (Step 0) — register the Table A provider next to `NBPProvider` and `RaiffeisenPolandProvider` |
| `packages/core/src/modules/currencies/services/README.md` | Patch (Step 0) — document `NBP_A` (source, `type = null`, fetched by `autoFetch` with the other providers) |
| `.ai/specs/2026-09-06-accounts-payable.md` | Patch — `VendorInvoice.exchangeRate`, `backfill` command/route, immutability guard (done 2026-10-15) |
| `.ai/specs/2026-09-06-accounts-payable-payments.md` | Patch — read contract incl. `PaymentBatch.sentOn` (done 2026-10-15) |
| sales-invoice-GL-posting spec | Patch — `SalesInvoice.currencyId`/`exchangeRate`, `backfill` command/route, post-posting immutability guard (Design decision 15) (done 2026-10-15: the spec lists what `sales` must do; the code belongs to `sales`) |
| `.ai/specs/2026-09-10-cash-bank-management.md` | Patch — default `bookedExchangeRate` from invoice only when bank currency = base (Design decision 14), read contract (Design decision 17). No settlement precondition. (done 2026-10-15: the withdrawn `PRIOR_VALUATION_NOT_REVERSED` paragraph removed) |

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
  `exchangeRate` backfill (per-document, admin-triggered, the owning module's `backfill` command) is optional and can happen any time
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
| 1 | No open foreign-currency documents | `lineCount: 0`, both entry ids `null`, `status: 'POSTED'` |
| 2 | One open AR invoice, rate up | Gain posted: debit AR control, credit unrealized-gain account |
| 3 | One open AP invoice, same rate move | Loss posted: debit unrealized-loss account, credit AP control (opposite legs from #2) |
| 4 | AR gain and AP loss of equal magnitude | Four lines posted (Design decision 11 worked example), `totalUnrealizedGainLoss: 0` |
| 5 | Document `exchangeRate: null` (pre-existing, not yet backfilled) | `422 EXCHANGE_RATE_MISSING_ON_DOCUMENT` |
| 6 | The owning module's `backfill` command on that same document (and `409 EXCHANGE_RATE_ALREADY_SET` on a second call), then re-run | Succeeds; document now included |
| 7 | Rate unavailable even after lookback | `422 EXCHANGE_RATE_UNAVAILABLE` |
| 8 | Two listed sources return conflicting manual entries for the same pair/date | `422 EXCHANGE_RATE_AMBIGUOUS` |
| 9 | Second `POST /runs` call for the same fiscal period | Both entries of run #1 cancelled via `ledger.reverseJournalEntry` (each dated with its own date), run #1 `SUPERSEDED`, fresh pair posted; `supersedesRunId` set; each period nets to the new valuation only |
| 10 | Earlier run for the period was a no-op (both entry ids `null`) | Marked `SUPERSEDED` with no `reverseJournalEntry` call |
| 11 | Two concurrent first-ever `POST /runs` calls (no `POSTED` row exists) | Serialized by the advisory lock; the second supersedes the first; exactly one `POSTED` run remains |
| 12 | `valuationDate` older than `valuationGraceDays` | `422 VALUATION_DATE_TOO_STALE` |
| 13 | Base currency changed since the prior run | `422 BASE_CURRENCY_CHANGED` |
| 14 | A valuation is posted | Two entries exist: the valuation dated `valuationDate` and the reversing entry (inverted lines) dated the first day of the next period, same `referenceId` |
| 15 | Document revalued on 31 Dec, settled on 3 Jan | Settlement accepted with no gate; control account carries no stale unrealized amount; gain recognized once across both periods (Design decision 12 example) |
| 16 | Three-currency settlement (PLN base, EUR invoice, USD bank) | `bookedExchangeRate` is not defaulted from the invoice; explicit entry or cross-rate required (Design decision 14) |
| 17 | Run for 31 Dec executed 5 Jan; payment on 3 Jan; partial payment on 4 Jan; invoice issued 2 Jan | Open amount as of 31 Dec: payments added back, the 2 Jan invoice excluded (Design decision 13) |
| 18 | `FiscalPeriod` locked | `409 FISCAL_PERIOD_LOCKED` |
| 19 | Preview (`GET /runs/preview`) then a change to a document's open amount before posting | Posting reflects the *new* state; UI must re-preview, not reuse the stale one |
| 20 | No unlocked `FiscalPeriod` covers the day after the period's end | `409 NEXT_PERIOD_UNAVAILABLE`; nothing written |
| 21 | Only a Table C (`NBP`) or Raiffeisen row exists for the date | `422 EXCHANGE_RATE_UNAVAILABLE` naming `NBP_A`; no fallback |
| 22 | Failure after the supersede step (e.g. the second posting rejected) | Whole transaction rolled back: the earlier run is still `POSTED`, no new entry exists |
| 23 | Second `POST /runs` for a tenant with a `POSTED` run for a different period | The earlier period's run is untouched (already unwound by its own reversing entry) |

## Canonical Mechanisms

- **API routes**: `POST /runs` is a custom, mutation-guard-wired route (`openApi` export, `requireAuth`/`requireFeatures` metadata; the `backfill` routes live in `sales` and `accounts_payable`); `GET /runs` and `GET
  /runs/:id` are plain `makeCrudRoute` `list`/`get` handlers — no
  hand-rolled read logic for a case the framework's CRUD factory
  already covers.
- **Writes**: the admin UI's "Run FX Revaluation" action goes through `useGuardedMutation(...).runMutation(...)`
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
Currency codes, provider `source` names ("NBP", "NBP Table A",
"Raiffeisen Bank Polska"), and GL account names are data, not UI copy, and
are not translated. The API error codes added by the 2026-10-15 review round
(`FISCAL_PERIOD_LOCKED`, `NEXT_PERIOD_UNAVAILABLE`, `FX_RUN_CONFLICT`,
`EXCHANGE_RATE_UNAVAILABLE`, `EXCHANGE_RATE_ALREADY_SET`) each get a locale
key under `fx_revaluation.errors.*` (the `backfill` one in the owning
module's namespace), resolved with `translate(key, fallback)`; the preview
and run-history columns for rate source/date and run status
(`POSTED`/`SUPERSEDED`) are keyed the same way.

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
Exchange System"). Journal Entry Line Dimension (#5972) listed "Currency"
as a dimension type when this was checked; since 2026-10-13 its Phase 1
carries `CostCenter` only, because a currency tag would duplicate
`JournalEntry.currencyId`. Nothing in this document relied on it. `accounts_payable`, `ledger`, and
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
  assumption (Design decision 8). **Art. 30 ("wycena bilansowa," the
  period-end FX revaluation mandate) — Confirmed, closed 2026-09-21**
  (was Unverified; not present in this session's earlier extracted
  range). Checked directly against the current consolidated text
  (Dz.U.2026.0.522), cross-checked across two independent sources —
  see Design decision 8 for the literal quotes (ust. 1: NBP average
  rate, no less often than the balance-sheet date; ust. 4: P&L
  recognition except long-term investments). Closing this citation
  surfaced a load-bearing consequence: `NBPProvider`'s Table C (not
  Table A) rate source is now a confirmed gap, not a speculative one —
  see Risks and Implementation Plan Step 0.

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
| root AGENTS.md → UI & HTTP | Non-`CrudForm` writes use `useGuardedMutation(...).runMutation(...)` | Compliant | Canonical Mechanisms + UI/UX: "Run FX Revaluation" goes through `useGuardedMutation`/`apiCall()`. The per-document rate backfill UI belongs to `sales`/`accounts_payable`, not here. |
| packages/core/AGENTS.md → API Routes | Every API route file exports `openApi`; custom write routes wire the mutation-guard registry | Compliant | API Contracts header note + Canonical Mechanisms: `POST /runs` is custom and mutation-guard-wired (the `backfill` routes live in `sales` and `accounts_payable`); `GET /runs`/`GET /runs/:id` are `makeCrudRoute`. |
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
| Risks cover all write operations | Pass | Risks & Impact Review names the first-round findings and the 2026-10-15 round (concurrency under the advisory lock, supersede, Table A source, next-period availability, sibling-spec contracts). |
| Commands defined for all mutations | Pass | `revalueOpenBalances` is the only write this module owns, behind a mutation-guard-wired route; it posts through `ledger.postJournalEntry`/`reverseJournalEntry` on the caller's transaction. Per-document rate backfill is a command of the owning module (`sales`, `accounts_payable`), not of `fx_revaluation`. |
| Cache strategy covers all read APIs | Pass (N/A, justified) | See Compliance Matrix. |

### Non-Compliant Items

- **High, open until Implementation Plan Step 0 (extension mechanism
  verified 2026-10-15, Design decision 9c):** `currencies` has no
  Table A (`NBP_A`) provider yet, and the spec refuses to post rather than
  fall back to Table C (Design decision 9). The design is complete; the
  prerequisite is not built.
- **Open, owned by other specs:** ledger #5663/#6340 and the
  sales/AP/payments/cash-bank specs this one depends on are still open PRs.
  The sibling-spec patches are written (AP invoices, AP payments incl.
  `sentOn`, sales GL posting, cash-bank), pending their own review.

### Verdict

**Design consistent after the 2026-10-15 review round; implementation is
blocked on Step 0 and on the sibling-spec contracts above** (Implementation
Plan, "Blocked on"). Previous "fully compliant / approved" wording withdrawn;
re-review requested.

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

## Changelog addendum — 2026-09-21 (cont. — UoR Art. 30 literature grounding closed)

Closed the Art. 30 Unverified flag from Design decision 8 (Literature &
Prior Art; Implementation Plan Step 0 had already gated on this
confirmation, per the prior maintainer-review round). Checked directly
against the current consolidated statute text (Dz.U.2026.0.522,
effective 21 August 2026), cross-checked across two independent
sources (lexlege.pl, przepisy.gofin.pl): ust. 1 confirms the NBP
average rate ("Table A") is the required valuation rate, at least as
of the balance-sheet date; ust. 4 confirms P&L recognition (no equity/
OCI deferral) for everything except long-term investments, matching
this spec's design exactly. Updated: Design decision 8 (main citation),
Design decision 9c (provider-priority note), the Alternatives-considered
OCI/equity entry (now "confirmed correct" rather than "pending"), the
Risks entry (Table A/Table C gap upgraded from speculative to a
confirmed statutory non-compliance risk, with severity/mitigation/
detection added), Implementation Plan Step 0 (now a concrete scoped
task — add Table A support to `currencies` — rather than an open
confirmation to ask a human), and the Literature & Prior Art entry.
**Net effect**: this spec's own design was already correct on both
points Art. 30 governs (trigger timing, P&L recognition); the one real,
now-confirmed consequence is that `currencies`' `NBPProvider` needs
Table A support before `fx_revaluation` can post statutorily-correct
valuations — a `currencies`-module task, out of this document's own
boundary, now blocking Implementation Plan Step 3 instead of an
unresolved legal question blocking it.

## Changelog addendum — 2026-10-09 (sales invoice open amount, #6055 alignment)

Found while aligning #6046/#6055: this spec read
`SalesInvoice.outstandingAmount` as the revaluation base and described it as
"the same field Cash & Bank Management already reads". Neither holds:
`sales` does not maintain that column for invoices (default `0`), and #6055
no longer reads it (it sizes settlements ledger-side). Added Design decision
17: a sales invoice's open amount is its gross total less the settled amounts
of its #6055 matches, and only invoices posted by #6046 are revalued. Updated
the run's read step, the line's source column, two edge cases, the dependency
list (`cash_bank_management`, soft) and the quoted settlement formula
(`settledAmount`, `overpaymentAmount`). Vendor invoices are unchanged. Not yet
reviewed by a maintainer.


## Changelog addendum — 2026-10-12 (vendor invoice open amount)

Checked the assumption left open on 2026-10-09 that `accounts_payable`
maintains `VendorInvoice.outstandingAmount`. It does not: the AP specs (#5962
and the payments document) define `VendorInvoice` without that column, with no
`PAID` status and no settlement flag, and record payments on
`PaymentBatchLine`; Phase 1 payments are full-amount only. Replaced every
reference to the column. New Design decision 18: a posted vendor invoice's
open amount is `total_gross` less its lines on `SENT` payment batches, read
from `accounts_payable_payments` (soft dependency, added to the list). Reading
it ledger-side is recorded as the direction, blocked on the payments spec
tagging the invoice on the payment's DR line. Not yet reviewed by a maintainer.

## Changelog addendum — 2026-10-12 (cont. — vendor invoice open amount: direction decided)

Decision 18 recorded the ledger-side read as a future direction, blocked on the
payments spec tagging the invoice on the payment's DR line. That direction is
dropped: the per-invoice detail is the subsidiary ledger and stays in
`accounts_payable_payments`; the `fx_revaluation` read of `PaymentBatchLine` is
allowed as an optional, FK-id-only, scoped read with the used columns listed as
a contract in the payments spec. No change to `ledger`, `accounts_payable` or
`accounts_payable_payments` is needed. Not yet reviewed by a maintainer.

### 2026-10-12 — Art. 30 re-read against the consolidated text

Checked against the Sejm print of 2026-10-08. Ust. 1 (NBP average rate, no less
often than the balance-sheet date) and ust. 4 (exchange differences to financial
income or costs, long-term investments under art. 35) hold. Three points the
spec did not carry:

- Ust. 4 also allows, in justified cases, capitalising exchange differences into
  production cost, purchase price, or the cost of fixed assets and intangibles;
  and it covers differences arising on payment of receivables and payables, not
  only on balance-sheet valuation. Phase 1 posts them to financial income or
  costs; capitalisation is out of scope.
- Ust. 2: foreign-currency operations are booked at the rate of the day of the
  operation: pkt 1 the rate actually applied (currency sales and purchases,
  payments), pkt 2 the NBP average rate of the **preceding day** for payments
  where pkt 1 is not justified and for other operations. This spec had no rule
  for the booking-day rate; the rule is decided below (2026-10-12).
- Art. 23 ust. 3 (both the Polish and the foreign amount must be determinable)
  supports keeping `amountCurrency` on the line. Not yet reviewed by a maintainer.

### 2026-10-12 (cont. — booking-day rate rule decided)

Decided by the team, on the text of art. 30 ust. 2 only (no external accounting
source):

- **Documents:** the default rate is the NBP average rate (Table A) published for
  the last day before the operation date (art. 30 ust. 2 pkt 2).
- **Payments:** the caller (AP, AR, bank reconciliation) passes the rate the bank
  actually applied (pkt 1). Where it has none, the document default above is used.
- **The ledger does not derive rates.** `postJournalEntry` takes `exchangeRate` from
  the caller. Resolving the default rate belongs to `currencies`, which needs
  Table A support first (Implementation Plan Step 0).
- **`fx_revaluation`** posts only the period-end valuation (art. 30 ust. 1), not
  booking-day rates.

A tenant that books at a different documented rate sets it per document; the
default is only the starting value. Not yet reviewed by a maintainer.

### 2026-10-12 (cont. — decision 18 closed)

The ⚠ marker on decision 18 is replaced by a note that it is a team decision. The
condition that the read columns are listed as a contract in the payments spec was
not met when decision 18 was written; it now is (`accounts-payable-payments.md`,
"Read contract for other modules"). Not yet reviewed by a maintainer.

### 2026-10-15 — Review round (PR #6190, @adeptofvoltron, reviewed head d9bf77e1e)

Every finding was re-checked against the spec and the sibling code/specs
before being addressed.

- **Blocker — settlement deadlock.** Valid. The valuation now reverses itself
  in the same transaction (reversing `NORMAL` entry dated the first day of the
  next period); the `PRIOR_VALUATION_NOT_REVERSED` gate and the patch to
  `cash-bank-management.md` are withdrawn (Design decisions 6, 12; Architecture;
  Risks).
- **High — Table A.** Valid. Table A gets its own source `NBP_A`, default
  `ratePriority ['NBP_A']`; no Table C fallback — the run refuses to post
  (422 `EXCHANGE_RATE_UNAVAILABLE`). Implementation Plan Step 0 and the
  compliance report now state this as a blocker (Design decision 9).
- **As-of balances.** Valid. Open amounts are computed as of `valuationDate`
  (settlements dated up to it added back, documents posted after it excluded);
  `sentOn` is stated as a contract the payments spec still has to list
  (Design decisions 13, 17, 18 — marked ⚠).
- **Concurrency.** Valid. Per-tenant `pg_advisory_xact_lock` via `em.execute`,
  rates resolved before the transaction and re-read inside it, partial unique
  index on POSTED runs → 409 `FX_RUN_CONFLICT`; same-period re-run supersedes
  both entries via `reverseJournalEntry` (Design decision 10; Data Model).
- **Cross-module writes.** Valid. `backfillDocumentRate` removed from
  `fx_revaluation`; the owning modules (`sales`, `accounts_payable`) get their
  own backfill commands (Design decision 15; Architecture patches).
- **Dependencies.** Wording now says the sibling specs are open PRs, with an
  explicit "Blocked on" list in the Implementation Plan.
- **Minors.** "Locked" used consistently (409 `FISCAL_PERIOD_LOCKED`); 404 for a
  missing period; 409 `NEXT_PERIOD_UNAVAILABLE`; route layout, ACL and `setup.ts`
  aligned; Testing Strategy extended to 23 cases; i18n keys listed.
- **Nit.** Self-issued "Approved" review block and "Fully compliant" verdict
  removed.
- **Not addressed in this spec (needs action outside it):** CI/base-branch
  alignment of the PR; whether Table A provider work lands in `currencies`
  as proposed. Not yet reviewed by a maintainer.

### 2026-10-15 (cont. — Table A provider checked against `currencies`)

Checked `currencies` on `develop` (`services/providers/{base,nbp,registry}.ts`,
`rateFetchingService.ts`, `exchangeRateService.ts`, `di.ts`, `data/entities.ts`,
`data/validators.ts`, `CurrencyFetchingConfig.tsx`). Result, recorded in Design
decision 9c: a provider registry already exists, the unique key includes
`source`, so `NBP_A` needs no schema change; only the `type` union in
Table A rows use `type = null` (corrected the same day: `'mid'` would have needed a type change and fails the manual-entry validator). Step 0 is the first commit of the
implementation PR, not a separate PR. Fallback: register the provider from
`fx_revaluation` via `registerCurrencyRateProvider`. Correction of an earlier
statement in the review thread: that fallback does not duplicate rate logic or
cross a module boundary. Open ⚠: OM Core's preference on placement. Not yet
reviewed by a maintainer.

### 2026-10-15 (cont. — `sentOn` closed)

`accounts-payable-payments.md` (branch `docs/accounts-payable`) now defines
`PaymentBatch.sentOn` and the optional `sentOn` input of `markPaymentBatchSent`,
and the read-contract paragraph of 2026-10-12 lists `sentOn` too. The ⚠ on Design decision 18
is removed and the "Blocked on" entry for the payments spec now refers to open
PRs only. Not yet reviewed by a maintainer.

### 2026-10-15 (cont. — sibling-spec patches written)

- `accounts-payable.md`: `backfillVendorInvoiceExchangeRate` (route
  `POST /api/accounts_payable/invoices/:id/exchange-rate/backfill`), draft
  re-resolution, freeze after posting.
- Sales GL posting spec: lists what `sales` must do (backfill command,
  re-resolution in `sales.invoices.update`, freeze after posting).
- `cash-bank-management.md`: the withdrawn `PRIOR_VALUATION_NOT_REVERSED`
  paragraph is removed (it contradicted Design decision 12) and the read
  contract for `fx_revaluation` is added.
- The AP route path in Design decision 15 is now the one defined in the AP spec.
Not yet reviewed by a maintainer.
