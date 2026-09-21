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
   (doesn't silently default to `1` or skip) if
   `ExchangeRateService.getRate()` can't resolve a rate even after its
   own `maxDaysBack`/`autoFetch` fallback. Re-resolving at posting time
   would let the booked rate silently drift from what the vendor/
   customer actually saw on the document, which is exactly the
   "silently wrong direction" failure `currencies.AGENTS.md` warns
   about for the *lookup* direction (never filter by `isActive`) — the
   analogous discipline here is: never re-derive a rate that was
   already fixed at document time.

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
   account (via a `JournalEntry`) and nets against an unrealized
   FX gain/loss account, the same "control account + subsidiary
   ledger stays independent" convention already settled project-wide
   (knowledge-base §2). It does **not** attempt to make `#6013`'s
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
   is unwound at the start of the next run via GL's existing
   `REVERSAL` type, linked back via the same `referenceType`/
   `referenceId` pair. Kieso, Ch. 3, "Reversing Entries—An Optional
   Step" (p. 3-35 — the section introducing Appendix 3B, not the
   appendix's own worked pages): *"A reversing entry is the exact
   opposite of the adjusting entry made in the previous period. Use
   of reversing entries is an optional bookkeeping procedure..."* —
   GL core engine
   already made reversal its one correction mechanism, so this spec
   is applying an existing, already-adopted pattern to a new use case,
   not introducing one.

6. **Reversal-then-repost is one command, not two.** Running
   `fx_revaluation.revalueOpenBalances` for a period first reverses
   the most recent *unreversed* prior run for the same tenant/
   organization (if any), then computes and posts a fresh valuation
   against the requested `valuationDate`. This keeps the operation
   idempotent under re-runs before period close (re-running it just
   reverses-and-reposts) and matches the "reversing entries happen at
   the start of the next period, immediately before that period's
   entries resume" sequencing Kieso describes, rather than needing a
   separate "did we already reverse?" step the caller has to remember.

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

## Architecture

### New module: `fx_revaluation` (Core)

- `data/entities.ts` — `FxRevaluationRun`, `FxRevaluationLine` (see
  Data Model).
- `commands/revalueOpenBalances.ts` — the one command this module
  exists for. Reads open `VendorInvoice`/`SalesInvoice` rows directly
  via `entityManager` (scoped `tenantId`/`organizationId`, same
  cross-module direct-read precedent as Cash & Bank Management),
  calls `currencies.ExchangeRateService.getRates()` (batch) for the
  valuation date, computes per-document unrealized gain/loss, and
  calls `commandBus.execute('ledger.postJournalEntry', ...)` twice at
  most (one `REVERSAL` for the prior run, one `NORMAL` for the new
  valuation).
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
  default from `SalesInvoice.exchangeRate` once populated, rather than
  always requiring manual entry at match time.

## Data Model

### `fx_revaluation.FxRevaluationRun`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `organizationId` / `tenantId` | `uuid` | scope, as everywhere else |
| `fiscalPeriodId` | `uuid` (FK-id, no ORM relation) | the period this run values as of |
| `valuationDate` | `date` | the date rates are resolved against |
| `reversesRunId` | `uuid`, nullable (FK-id) | the prior run this one reversed, if any |
| `journalEntryId` | `uuid` (FK-id) | the posted `NORMAL` valuation entry |
| `reversalJournalEntryId` | `uuid`, nullable (FK-id) | set once a later run reverses this one |
| `status` | `'POSTED' \| 'REVERSED'` | |
| `totalUnrealizedGainLoss` | `numeric(18,4)` | base currency, signed |
| `createdBy` | `uuid` | acting user |
| `createdAt` | `timestamptz` | |

### `fx_revaluation.FxRevaluationLine`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `runId` | `uuid` (FK-id) | parent `FxRevaluationRun` |
| `documentType` | `'vendor_invoice' \| 'sales_invoice'` | |
| `documentId` | `uuid` (FK-id, no ORM relation) | |
| `currencyId` | `uuid` (FK-id → `currencies.Currency`) | the document's own currency |
| `outstandingAmountInDocumentCurrency` | `numeric(18,4)` | read from the document at run time |
| `bookedExchangeRate` | `numeric(18,8)` | the document's own stored rate |
| `valuationExchangeRate` | `numeric(18,8)` | resolved for `valuationDate` |
| `unrealizedGainLoss` | `numeric(18,4)` | base currency, signed; `outstandingAmountInDocumentCurrency * (valuationExchangeRate - bookedExchangeRate)` |

## API Contracts

### `POST /api/fx_revaluation/runs`

- **Body**: `{ fiscalPeriodId: string, valuationDate?: string }`
  (`valuationDate` defaults to the period's end date).
- Loads the `FiscalPeriod`; **400** if not found, **409** if already
  `CLOSED`/`isLocked` (revaluation is a pre-close step, not a
  post-close one).
- Finds the most recent `FxRevaluationRun` for this tenant/org with
  `status: 'POSTED'`; if found, posts its `REVERSAL` `JournalEntry`
  first and marks it `REVERSED`.
- Reads all open `VendorInvoice`/`SalesInvoice` rows (`outstandingAmount
  > 0`, `currencyId` ≠ tenant base currency) as of `valuationDate`.
- Calls `ExchangeRateService.getRates()` for every distinct
  `(currencyId → base)` pair needed; **422
  `EXCHANGE_RATE_UNAVAILABLE`** with the specific currency/date if any
  pair can't be resolved even after the service's own lookback/
  auto-fetch — no partial run.
- Rejects (**422 `EXCHANGE_RATE_MISSING_ON_DOCUMENT`**) if any
  in-scope document has `currencyId` ≠ base but `exchangeRate: null`
  — a data problem to surface, not paper over with an assumed rate of
  `1`.
- Posts one `NORMAL` `JournalEntry` (zero lines omitted if the net
  unrealized amount is exactly `0`, in which case no entry is posted
  and the run is recorded with `journalEntryId: null`).
- **Response 201**: `{ runId, journalEntryId, reversalOfRunId?,
  totalUnrealizedGainLoss, lineCount }`.
- **Response 403**: caller lacks `fx_revaluation.runs.create`.

## UI/UX

A single admin page under Ledger → Period-End: a "Run FX Revaluation"
action per open `FiscalPeriod`, showing the computed line list
(document, currency, booked vs. valuation rate, gain/loss) as a
preview before posting — mirroring the "preview before commit" pattern
already used by `generateAnnualStatements` in #6188. Read-only history
of past runs per period.

## Edge Cases & Failure Scenarios

- **No open foreign-currency documents at all.** The run completes
  with `lineCount: 0`, `journalEntryId: null`, `status: 'POSTED'`
  (a no-op run is still recorded, so period-end history shows
  revaluation was checked, not skipped).
- **A document's `exchangeRate` is `null` because it predates this
  feature.** Rejected outright (see API Contracts) rather than
  silently assuming rate `1`, which would understate/overstate the
  real exposure.
- **Exchange rate for `valuationDate` genuinely doesn't exist** (e.g. a
  weekend/holiday with no published NBP/Raiffeisen rate). Relies on
  `ExchangeRateService`'s own `maxDaysBack` recursive lookback before
  surfacing `EXCHANGE_RATE_UNAVAILABLE` — this spec does not
  reimplement that fallback.
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

- **UoR Art. 30 text is unverified this session** (see Design
  decision 8) — the P&L-recognition assumption should be confirmed
  against the actual statute (or an accountant) before implementation
  locks it in; if Art. 30 turns out to require different treatment for
  specific balance classes (e.g., long-term vs. current), this
  document's Phase 1 scope (Design decisions) would need revisiting.
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

## Implementation Plan

1. Patch `accounts-payable.md` and the `SalesInvoice`-owning spec with
   the field additions from Design decision 3.
2. Scaffold `fx_revaluation` module: entities, `AGENTS.md`, module
   registration, dependency declarations (`currencies`, `ledger`).
3. Implement `revalueOpenBalances` command (reversal-then-repost,
   Design decision 6) against `currencies.ExchangeRateService`.
4. Implement `POST /api/fx_revaluation/runs` with the rejection rules
   from API Contracts.
5. Implement the admin preview/run UI under Ledger → Period-End.
6. Wire `VendorInvoice`/`SalesInvoice` creation commands to resolve
   and store `exchangeRate` (and, for `SalesInvoice`, `currencyId`) at
   creation time, once those modules exist.
7. Coordinate the `cash-bank-management.md` default-from-invoice patch
   (Design decision 7).
8. Confirm UoR Art. 30 text and revisit Design decision 8 if the
   statute requires a different treatment.

## File Manifest

| File | Change |
|---|---|
| `.ai/specs/2026-09-17-multi-currency.md` | New (this document) |
| `packages/core/src/modules/fx_revaluation/data/entities.ts` | New — `FxRevaluationRun`, `FxRevaluationLine` |
| `packages/core/src/modules/fx_revaluation/AGENTS.md` | New |
| `packages/core/src/modules/fx_revaluation/commands/revalueOpenBalances.ts` | New |
| `packages/core/src/modules/fx_revaluation/api/runs.ts` | New |
| `.ai/specs/2026-09-06-accounts-payable.md` | Patch — `VendorInvoice.exchangeRate` |
| sales-invoice-GL-posting spec | Patch — `SalesInvoice.currencyId`/`exchangeRate` |
| `.ai/specs/2026-09-10-cash-bank-management.md` | Patch — default `bookedExchangeRate` from invoice |

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

## Changelog

- **2026-09-17** — Initial draft. Steps 1–2 of the standard process
  completed in full; Step 3 consciously narrowed per above. Scope
  confirmed with the user as: `exchangeRate`/`currencyId` field
  additions to `VendorInvoice`/`SalesInvoice`, plus a new, minimal
  `fx_revaluation` module for period-end unrealized FX revaluation —
  explicitly not a new rate/currency engine.
