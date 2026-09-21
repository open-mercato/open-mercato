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
   are actually is-sold. **Resequenced, maintainer-review round**: this
   confirmation now gates Implementation Plan Step 0, before any
   command, API, or UI work begins — the initial draft deferred it to
   the last implementation step (after `stop` itself, its API, and its
   UI were already built on the unconfirmed assumption), which the
   review correctly flagged as backwards: an implementer would have
   had to redo commands/API/UI if the confirmed answer differed. See
   Implementation Plan.
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
9. **The RMP liability account is frozen on the deferral, not re-read
   from config — added, maintainer-review round.** Only
   `originalRevenueAccountId` was snapshotted in the initial draft;
   `deferredRevenueLiabilityAccountId` (the credit side of the
   reclassification entry) was being re-read live from
   `ModuleConfigService` by every later `accrueRevenueRecognition`/
   `stopRevenueRecognitionSchedule` call. If a tenant reconfigures
   `deferredRevenueLiabilityAccountId` from account A to B after a
   deferral was created (and already reclassified into A), every
   subsequent recognition entry would debit B instead of A — leaving
   A's balance permanently uncleared and B debited for amounts it was
   never credited for, a real balance-sheet break, not a cosmetic one.
   **Fix**: `RevenueDeferral.deferredRevenueLiabilityAccountId` (new
   field, see Data Model) is read once from `ModuleConfigService` and
   snapshotted at `deferRevenueRecognition` time, exactly like
   `originalRevenueAccountId`. `accrueRevenueRecognition` and
   `stopRevenueRecognitionSchedule` always post against the two
   snapshotted account ids on the parent `RevenueDeferral` — neither
   command reads `ModuleConfigService` at all. A later configuration
   change only affects deferrals created after the change.
10. **Currency basis restricted to bookkeeping (base) currency —
    added, maintainer-review round.** `SalesInvoiceLine` carries its
    own `currencyCode` (a foreign-currency invoice is a real,
    supported case elsewhere in the system), but this draft's
    `totalAmount` snapshot on `RevenueDeferral` stores only a bare
    `numeric`, with no currency or FX-rate field to interpret it by.
    Checked directly against `sales-invoice-gl-posting.md` (Out of
    scope): *"every invoice this module posts is assumed to be in the
    tenant's own bookkeeping currency for Phase 1"* — the sibling
    module this one reclassifies output from already drew this exact
    line. `deferRevenueRecognition` inherits the same restriction
    rather than silently reinterpreting a foreign-currency amount as
    if it were base-currency, or applying a current FX rate to a
    historical, already-posted reclassification (which would invent
    an FX gain/loss this module has no design for recognizing — see
    Out of scope). **Fix**: `deferRevenueRecognition` reads
    `SalesInvoice.currencyCode` (via the same direct-entityManager
    read already used for `SalesInvoiceLineRevenueAccount`) and
    rejects — **422 `DEFERRED_REVENUE_CURRENCY_UNSUPPORTED`** — unless
    it equals the tenant's base currency (`currencies.Currency.isBase`,
    per Multi-Currency's #6190 own Design decision 8 treatment of base
    currency as a per-tenant given). Multi-currency deferral is
    explicitly out of scope for Phase 1 (see Out of scope) — a narrow,
    correct restriction rather than new FX-handling scope, matching
    the review's own "simplest solution" framing.
11. **Schedule boundary rule: anniversary-month, not calendar-month —
    added, maintainer-review round.** The initial draft's
    `totalAmount / numberOfPeriods` never defined `numberOfPeriods`
    itself, so two different, equally plausible readings of the same
    `serviceStartDate`/`serviceEndDate` pair (calendar-month buckets
    vs. anniversary-month buckets) produce different schedules for the
    same input — not acceptable for a preview-before-commit UI that
    promises the accountant a deterministic result. **Rule chosen**:
    anniversary-month, anchored to `serviceStartDate`, because the
    wall's own worked example ("sprzedaż licencji rocznej") and
    Odoo's own worked example (a 24-month contract from an arbitrary
    purchase date, not aligned to a calendar year) are both
    purchase-date-anchored subscriptions, not calendar-year
    subscriptions — a calendar-month rule would incorrectly split a
    true one-month contract that happens to straddle a calendar-month
    boundary (e.g. Jan 15 – Feb 14) into two rows. Precise definition,
    using a month-add helper `addMonths(date, n)` that adds `n`
    calendar months and clamps to the last day of the resulting month
    when the source day-of-month doesn't exist there (standard
    month-add-with-clamp, e.g. `addMonths(2026-01-31, 1) = 2026-02-28`
    in a non-leap year):
    - `numberOfPeriods` (`N`) = the smallest positive integer such
      that `addMonths(serviceStartDate, N) >= serviceEndDate`.
    - Row `k` (`1 <= k < N`): `periodStartDate = addMonths(serviceStartDate, k-1)`
      (with `addMonths(d, 0) = d`), `periodEndDate =
      addMonths(serviceStartDate, k) - 1 day`.
    - Row `N` (the final row): `periodStartDate =
      addMonths(serviceStartDate, N-1)`, `periodEndDate =
      serviceEndDate` — always clamped to the actual contract end, the
      same place the existing rounding-remainder rule (Design decision
      3) already lives, now extended to dates as well as amounts.
    - Each row's recognition due date and `ledger.postJournalEntry`
      `operationDate` is that row's own `periodEndDate` — this is what
      "due" means for `accrueRevenueRecognition`'s `asOf` filter
      (`periodEndDate <= asOf`, `accruedAt IS NULL`) and what
      determines which `FiscalPeriod`'s lock state governs that row.
    - `plannedAmount` per row stays `totalAmount / N`, last row
      absorbing the rounding remainder in cents (Design decision 3,
      unchanged).

    Worked examples (all computed by the rule above):

    | Case | `serviceStartDate` | `serviceEndDate` | `N` | Rows |
    |---|---|---|---|---|
    | 12-month contract | 2026-01-01 | 2026-12-31 | 12 | `2026-01-01..01-31`, `02-01..02-28`, … `12-01..12-31` — 12 equal rows |
    | One-month, calendar-straddling | 2026-01-15 | 2026-02-14 | 1 | single row `01-15..02-14`, full amount (matches the existing "one-month service period" Edge Case) |
    | Short, month-boundary-straddling | 2026-01-31 | 2026-02-01 | 1 | `addMonths(01-31,1)=02-28 >= 02-01`, so single row `01-31..02-01`, full amount — a 2-day contract stays one row because it never reaches a full anniversary month |
    | Leap-year boundary | 2028-01-30 | 2028-02-29 | 1 | `addMonths(01-30,1)` clamps to `2028-02-29` (2028 is leap, Feb has 29 days) `>= 02-29`, so single row `01-30..02-29` |
    | Rounding remainder | `totalAmount = 1000.00`, `N = 12` | | | rows 1–11 = `83.33` each (`= 916.63`), row 12 = `83.37` (absorbs the `0.04` remainder) — sums to exactly `1000.00` |
12. **Concurrency: locked/rechecked claim, shared with `stop` —
    added, maintainer-review round (Blocker).** The initial draft's
    idempotency guarantee ("the second run only selects rows still
    matching `accruedAt IS NULL`") is a plain `SELECT` filter, not a
    concurrency guarantee: two concurrent `/accrue` calls (or an
    `/accrue` racing a `/stop`) can both read the same row with
    `accruedAt IS NULL` before either has written anything, and both
    then post. Checked directly against GL core engine's own schema
    (`2026-08-18-general-ledger-core-engine.md`): the
    `(organization_id, reference_type, reference_id)` index on
    `journal_entry` is a plain (non-unique) supporting index for list
    filters, not a uniqueness constraint — `postJournalEntry` itself
    provides no deduplication for a caller that posts the same logical
    event twice. This module cannot rely on the ledger to catch a
    double-post; it has to prevent one. **Fix, reusing Multi-Currency's
    (#6190) own concurrency-safe shape (Design decision 10 there)**:
    every command that touches a given `RevenueDeferral`'s schedule —
    `accrueRevenueRecognition`, per entry, and
    `stopRevenueRecognitionSchedule`, for its own final step — opens
    `em.transactional()` and, as its **first** statement, `SELECT ...
    FOR UPDATE` the parent `RevenueDeferral` row by id. This is the one
    lock-acquisition site both commands share, so an `/accrue` call
    processing one entry of a deferral and a `/stop` call finalizing
    the same deferral serialize against each other — the second
    blocks on the row lock exactly as Multi-Currency's own
    "two concurrent `POST /runs` calls" Testing Strategy case already
    established works for that shape of race (#6190, Testing Strategy).
    Inside the lock, before any write: re-`SELECT` the schedule
    entry and re-check `accruedAt IS NULL` (defends against the entry
    having been claimed or voided since the caller's original,
    unlocked due-entry query), and re-check
    `RevenueDeferral.status === 'ACTIVE'` (defends against a `/stop`
    that committed and released the lock between this call's due-entry
    query and its lock acquisition — that entry is reported `skipped`,
    not `failed`, the same three-bucket posture Design decision 1
    already borrows from `accrueDepreciation`). Only then does the
    transaction call `commandBus.execute('ledger.postJournalEntry',
    ...)` and set `accruedAt`/`journalEntryReferenceId` on the entry —
    **in the same transaction as the post**, reusing Cash & Bank
    Management's (#6055) already-established fact that a nested
    `commandBus.execute()` call joins the caller's own
    `em.transactional()` block rather than opening a second one (see
    knowledge base §3, "cross-module transaction pattern"). This gives
    the finding's required transaction/recovery boundary for free: a
    crash between the ledger post and the marker write is a crash
    *before commit*, so the whole transaction — ledger entry included
    — never lands; a retry reprocesses the entry cleanly from
    `accruedAt IS NULL`, with no double-post and no orphaned
    half-accrued row. Per-entry locking (not one lock held across an
    entire `/accrue` run) preserves Fixed Assets' own reason for
    per-entry transactions in the first place — one entry's failure
    must not roll back or block already-processed entries in the same
    run (Design decision 1). See Testing Strategy for the two-contender
    and crash-after-post retry tests this finding explicitly requires.
13. **`stop`'s period preflight and atomic final step — added,
    maintainer-review round.** The initial draft's `stop` command ran
    catch-up (each entry individually committed, per Design decision
    1) and only then attempted a final posting for the remaining
    balance — so a locked `FiscalPeriod` covering `stopDate` would only
    be discovered *after* real, already-committed catch-up entries
    existed, with no way to undo them (they are individually committed,
    per-entry transactions, not part of one all-or-nothing `stop`
    transaction). This is exactly the failure mode Fixed Assets'
    `disposeAsset` (`2026-09-06-fixed-assets.md:1226-1233`) already
    solved once, for the structurally identical disposal-period
    problem, by checking the *final* period's lock **before** running
    any catch-up: *"First rejects if the FiscalPeriod covering
    disposalDate itself is locked — checked before anything is posted,
    so a locked disposal period can never be discovered only after the
    catch-up step below has already posted real, individually-committed
    journal entries."* **Fix**: `stopRevenueRecognitionSchedule`
    copies this exact step order, not only `disposeAsset`'s per-entry
    mechanics (the gap the review specifically flagged): (1) reject
    **409 `FISCAL_PERIOD_LOCKED`** if the `FiscalPeriod` covering
    `stopDate` is locked, before touching anything; (2) run
    `accrueRevenueRecognition`'s own due-entry logic scoped to this one
    deferral, up to `stopDate` — reusing the exact locking/claim
    mechanism from Design decision 12 (so a concurrent `/accrue` call
    on the same deferral is excluded automatically, satisfying the
    finding's "shared exclusion against concurrent accrual"); a locked
    period *among the catch-up entries themselves* (as opposed to the
    `stopDate` period, already cleared in step 1) is skipped and
    reported, not silently absorbed, matching `disposeAsset`'s own
    distinction between the two; (3) **then**, in one final
    `em.transactional()` block that re-acquires the same
    `SELECT ... FOR UPDATE` lock on `RevenueDeferral` (Design decision
    12) held across catch-up's last entry: post the final recognition
    `JournalEntry` for the remaining schedule balance, delete the
    now-fully-superseded unaccrued `RevenueRecognitionScheduleEntry`
    rows, and set `status = 'STOPPED'`/`stoppedAt` — all three writes
    in that one transaction, so a failure in the final posting rolls
    back the deletes and the status change together and **never voids
    a row whose liability was not actually recognized** (the finding's
    explicit requirement). The `200` response's
    `remainingScheduleEntriesVoided` count is only ever emitted once
    that transaction has actually committed. A partial catch-up
    failure (an unexpected error on one entry, not a lock skip) is
    reported in a `catchUpFailed` count (see API Contracts) and the
    whole `stop` call is safely retryable — re-calling `/stop` with the
    same `stopDate` re-runs the same idempotent catch-up claim logic
    and then re-attempts the final step, which is itself guarded by the
    existing `409` "already `STOPPED`/`COMPLETED`" check.
14. **Phase 1 guard against a correction/credit-memo on an
    already-deferred line — added, maintainer-review round.** The
    initial draft named this gap in Risks but designed nothing against
    it, leaving `accrueRevenueRecognition` free to keep recognizing the
    original `totalAmount` even after the underlying sale was reduced
    elsewhere — a real, silent overstatement of revenue, not a
    theoretical one. A full reconciliation (adjusting the remaining
    schedule to match a partial credit) is genuinely out of scope for
    Phase 1 (see Out of scope — no signal for the correct treatment in
    the source material, and `sales`/`sales_invoice_gl_posting` are
    soft, read-only dependencies with no event this module could
    subscribe to yet). What **is** in scope, and enforceable today
    without new cross-module infrastructure: inside the same locked
    transaction Design decision 12 already opens for each schedule
    entry (after the `accruedAt IS NULL` and `status === 'ACTIVE'`
    re-checks, before posting), `accrueRevenueRecognition` reads
    (direct `entityManager`, scoped by `organizationId`/`tenantId`,
    the same soft-dependency posture as every other cross-module read
    in this module) for any `sales.SalesCreditMemo`/`sales.SalesReturn`
    row referencing this deferral's `invoiceLineId`. If one exists,
    the entry is **not** posted; it is reported in a new
    `blockedByCorrection` bucket (see API Contracts) rather than
    silently succeeding or silently failing, and the parent
    `RevenueDeferral` is left `ACTIVE` with a note that it needs manual
    review — true reconciliation stays a human decision, exactly the
    same posture Design decision 6 takes for early-stop policy. This
    converts an undesigned silent-overstatement gap into an explicit,
    reported stop condition — narrowing, not closing, the risk (see
    Risks & Impact Review, updated).

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

### Access Control

Feature list, following GL core engine's own `{ id, title, module,
dependsOn }` shape (`2026-08-18-general-ledger-core-engine.md`,
Access Control) — **added, maintainer-review round** (the initial
draft named no features at all):

```
{ id: 'deferred_revenue.deferrals.view', title: 'View revenue deferrals and schedules', module: 'deferred_revenue' },
{ id: 'deferred_revenue.deferrals.manage', title: 'Create and stop revenue deferrals', module: 'deferred_revenue', dependsOn: ['deferred_revenue.deferrals.view'] },
{ id: 'deferred_revenue.accrue', title: 'Run revenue recognition accrual', module: 'deferred_revenue', dependsOn: ['deferred_revenue.deferrals.view'] },
```

`deferRevenueRecognition` and `stopRevenueRecognitionSchedule` require
`deferred_revenue.deferrals.manage`; `accrueRevenueRecognition`
requires `deferred_revenue.accrue` (separated from `.manage` because,
matching `accrueDepreciation`'s own precedent, accrual is typically run
by a different operational role than the one deciding what to defer or
stop); all read routes require `deferred_revenue.deferrals.view`.

### Tenant & Organization Scoping

Every entity carries `organizationId`/`tenantId` (Data Model) and every
command/query filters by both — no exception. The two soft-dependency
cross-module reads (`SalesInvoiceLineRevenueAccount`,
`SalesInvoice.currencyCode`, and, per Design decision 14,
`SalesCreditMemo`/`SalesReturn`) are scoped by the same
`organizationId`/`tenantId` pair as the calling command's own entity
manager context, never a separate or trusted-by-default lookup — the
same posture Cash & Bank Management already established for reading
`SalesInvoice` across the module boundary.

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
| `deferredRevenueLiabilityAccountId` | `uuid` (FK-id → `ledger.LedgerAccount`) | **added, maintainer-review round** (Design decision 9) — snapshot, read once from `ModuleConfigService` at deferral time; `accrueRevenueRecognition`/`stopRevenueRecognitionSchedule` always post against this field, never a live config read |
| `currencyCode` | `string(3)` | **added, maintainer-review round** (Design decision 10) — denormalized from `SalesInvoice.currencyCode` at deferral time, for audit/display; always equal to the tenant's base currency at creation (enforced, not merely recorded — see Design decision 10) |
| `totalAmount` | `numeric(19,4)` | snapshot of the line's `totalNetAmount` at deferral time, in `currencyCode` |
| `serviceStartDate` / `serviceEndDate` | `date` | the period the amount actually covers |
| `reclassificationJournalEntryReferenceId` | `uuid` (FK-id) | the entry that moved the amount from income to RMP |
| `status` | `'ACTIVE' \| 'STOPPED' \| 'COMPLETED'` | |
| `stoppedAt` | `date`, nullable | set by `stopRevenueRecognitionSchedule` |
| `createdAt` | `timestamptz` | |
| `updatedAt` | `timestamptz` | **added, maintainer-review round** — backs the default-ON optimistic lock on `status`/`stoppedAt` (see API Contracts, `POST .../stop`), matching every other mutable entity in the financial-module family (e.g. `FiscalPeriod.updatedAt`) |

### `deferred_revenue.RevenueRecognitionScheduleEntry`

One row per period per deferral, generated in full by
`deferRevenueRecognition` — never computed on read, the same posture
`DepreciationScheduleEntry` already established. Row boundaries follow
the anniversary-month rule in Design decision 11 (**precise definition
added, maintainer-review round** — the initial draft left
`numberOfPeriods` undefined).

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `deferralId` | `uuid` (FK-id) | parent `RevenueDeferral` |
| `periodStartDate` / `periodEndDate` | `date` | per Design decision 11; `periodEndDate` is also the row's recognition due date and its `ledger.postJournalEntry` `operationDate` |
| `plannedAmount` | `numeric(19,4)` | straight-line, last row absorbs the rounding remainder |
| `accruedAt` | `timestamptz`, nullable | null until posted |
| `journalEntryReferenceId` | `uuid` (FK-id), nullable | set atomically with `accruedAt` |

An unaccrued row (`accruedAt IS NULL`) may be deleted only by
`stopRevenueRecognitionSchedule`, and only after that command's own
catch-up step has run — never edited in place, matching `JournalEntry`'s
append-only posture once a row is accrued.

## API Contracts

### `GET /api/deferred_revenue/deferrals/preview`

**Added, maintainer-review round** (the initial draft's UI/UX promised
a preview-before-commit schedule with no backing read contract).

- **Query**: `{ invoiceLineId, serviceStartDate, serviceEndDate }`.
- Computes the schedule exactly as `deferRevenueRecognition` would
  (Design decision 11) **without writing anything** — same
  validation/error codes as `POST .../deferrals` below, returned
  instead of thrown where the UI needs them inline.
- **200**: `{ numberOfPeriods, rows: { periodStartDate, periodEndDate,
  plannedAmount }[] }`.

### `POST /api/deferred_revenue/deferrals`

- **Body**: `{ invoiceLineId, serviceStartDate, serviceEndDate }`.
- **400**: `serviceEndDate <= serviceStartDate`; the invoice line
  already has a `RevenueDeferral` (one per line, no re-deferral).
- **404**: no `SalesInvoiceLineRevenueAccount` row for this line (line
  not yet posted to GL — nothing to reclassify).
- **422 `DEFERRED_REVENUE_ACCOUNT_UNSET`**: `deferredRevenueLiabilityAccountId`
  not configured.
- **422 `DEFERRED_REVENUE_CURRENCY_UNSUPPORTED`**: **added,
  maintainer-review round** (Design decision 10) — the invoice's
  `currencyCode` is not the tenant's base currency.
- **201**: `{ deferralId, reclassificationJournalEntryId, scheduleEntryCount }`.

### `GET /api/deferred_revenue/deferrals`

**Added, maintainer-review round.** List route, filterable by
`status`/`invoiceId`, scoped by `organizationId`/`tenantId` (Access
Control). **200**: paged array of `RevenueDeferral` summaries.

### `GET /api/deferred_revenue/deferrals/:id`

**Added, maintainer-review round.** Detail route: the `RevenueDeferral`
plus its full `RevenueRecognitionScheduleEntry` list (accrued and
pending), backing the read-only schedule view (UI/UX). **404**: not
found or out of scope for the caller's organization/tenant.

### `POST /api/deferred_revenue/accrue`

- **Body**: `{ asOf: string, deferralId?: string }`.
- A row is **due** when `periodEndDate <= asOf` and `accruedAt IS
  NULL` (Design decision 11 — **made explicit, maintainer-review
  round**; the initial draft left "due" undefined).
- **200**: `{ accrued: number, skipped: number, blockedByCorrection:
  number, failed: number }` — extends `accrueDepreciation`'s own
  three-bucket shape with a fourth bucket, `blockedByCorrection`
  (**added, maintainer-review round**, Design decision 14): a row held
  by a matching `SalesCreditMemo`/`SalesReturn`, reported separately
  from both a lock-skip and an unexpected-error failure so the
  response distinguishes "will post later" (`skipped`), "needs human
  reconciliation" (`blockedByCorrection`), and "broke, investigate"
  (`failed`).

### `POST /api/deferred_revenue/deferrals/:id/stop`

- **Headers**: `x-om-ext-optimistic-lock-expected-updated-at:
  <RevenueDeferral.updatedAt>` — **added, maintainer-review round**
  (Data Model); enforced via `enforceCommandOptimisticLock`, the same
  non-`CrudForm` contract GL core engine's own `lockFiscalPeriod`/
  `unlockFiscalPeriod` already use for a status-flag mutation outside
  `CrudForm`.
- **Body**: `{ stopDate: string }`.
- **409 `OptimisticLockConflictBody`**: `updatedAt` mismatch — the
  deferral changed concurrently; the client refetches and retries.
- **409**: deferral already `STOPPED`/`COMPLETED`.
- **409 `FISCAL_PERIOD_LOCKED`**: **added, maintainer-review round**
  (Design decision 13) — the `FiscalPeriod` covering `stopDate` is
  locked; checked before any catch-up posting, never discovered after.
- **200**: `{ catchUpAccrued: number, catchUpSkipped: number,
  catchUpFailed: number, finalRecognitionJournalEntryId,
  remainingScheduleEntriesVoided: number }` — `catchUpSkipped`/
  `catchUpFailed` **added, maintainer-review round** (Design decision
  13) to report a partial catch-up outcome instead of silently
  folding it into a single count; the call is safely retryable with
  the same `stopDate` if any catch-up entries failed.

## UI/UX

A "Defer recognition" action on an already-posted `SalesInvoiceLine`
row (visible only once `SalesInvoiceLineRevenueAccount` exists for it),
asking for the service period and showing the computed monthly schedule
before confirming — backed by `GET .../deferrals/preview` (**added,
maintainer-review round** — API Contracts), the same preview-before-commit
pattern already used by `generateAnnualStatements` (#6188) and the FX
revaluation run (#6190). A read-only schedule view per deferral (backed
by `GET .../deferrals/:id`), and a "Stop" action with a confirmation
showing exactly what will be recognized immediately.

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
- **`stopRevenueRecognitionSchedule` called with a `stopDate` in a
  locked `FiscalPeriod`.** **Added, maintainer-review round** (Design
  decision 13) — rejected (**409 `FISCAL_PERIOD_LOCKED`**) before any
  catch-up posting runs, never discovered only after catch-up entries
  are already committed.
- **Two concurrent `/accrue` calls select the same due row, or an
  `/accrue` races a `/stop` on the same deferral.** **Added,
  maintainer-review round** (Design decision 12) — the second call
  blocks on the `SELECT ... FOR UPDATE` row lock, then correctly
  re-reads the now-current state (entry already accrued, or deferral
  already stopped) and skips rather than double-posting.
- **Re-running `accrueRevenueRecognition` for the same `asOf` twice.**
  Idempotent: the second run only selects rows still matching
  `accruedAt IS NULL`, so nothing double-posts — same idempotency
  guarantee `accrueDepreciation` already provides, now made
  concurrency-safe rather than merely sequentially-safe (Design
  decision 12).
- **A `SalesCreditMemo`/`SalesReturn` exists against an already-deferred
  line by the time `accrueRevenueRecognition` reaches its schedule
  entry.** **Added, maintainer-review round** (Design decision 14) —
  the entry is held, not posted, and reported in the `blockedByCorrection`
  bucket for manual reconciliation, rather than silently continuing to
  recognize the original, now-stale `totalAmount`.

## Risks & Impact Review

- **A `SalesCreditMemo`/`SalesReturn` against an already-deferred line
  has no defined *reconciliation* with this module — narrowed,
  maintainer-review round (Design decision 14).** The initial draft
  had no interaction at all; `accrueRevenueRecognition` now detects a
  matching credit memo/return and holds the entry
  (`blockedByCorrection`) instead of silently continuing to post the
  original amount. What remains unsolved, and stays a real gap: no
  command adjusts the remaining schedule's `plannedAmount` to match a
  partial reversal, and a held deferral needs a human to resolve it —
  there is no automated reconciliation path yet.
- **Design decision 6's "recognize immediately" policy on early stop is
  an assumption, not a confirmed business rule** — flagged **⚠ NEEDS
  HUMAN CONFIRMATION**, now gating Implementation Plan Step 0
  (**resequenced, maintainer-review round** — see Design decision 6
  and Implementation Plan) rather than the last implementation step.
- **The concurrency fix (Design decision 12) adds a row lock shared by
  `accrue` and `stop` — added, maintainer-review round.** Under high
  contention (many schedule entries due for the same deferral at once,
  or an `/accrue` sweep overlapping a `/stop`), callers serialize on
  that lock rather than running in parallel. Acceptable for Phase 1's
  manual-trigger, no-scheduler scope (Design decision 7) — no evidence
  of a throughput requirement this would violate — but worth
  monitoring once real accrual volume exists.
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

**Resequenced, maintainer-review round** — Design decision 6's
confirmation moved from last (step 7) to first (step 0), since steps 3,
5, and 6 all build on that assumption; confirming it after the fact
risked rebuilding commands, API, and UI if the answer differed.

0. Confirm Design decision 6's early-stop policy ("recognize
   immediately, no refund path") with the user — **⚠ NEEDS HUMAN
   CONFIRMATION**, blocks every step below.
1. Patch `2026-09-15-default-chart-of-accounts.md` with the `840` account
   (Design decision 8).
2. Scaffold `deferred_revenue`: entities (including
   `deferredRevenueLiabilityAccountId`, `currencyCode`, `updatedAt` —
   Design decisions 9/10 and Data Model), `AGENTS.md`, module
   registration, `ledger`/`sales`/`sales_invoice_gl_posting` dependency
   declarations, Access Control feature list.
3. Implement `deferRevenueRecognition` (reclassification post +
   schedule generation), including the base-currency rejection (Design
   decision 10) and the anniversary-month schedule rule (Design
   decision 11).
4. Implement `accrueRevenueRecognition`, mirroring `accrueDepreciation`'s
   paging/lock-skip mechanics plus the locked-claim concurrency
   contract (Design decision 12) and the correction guard (Design
   decision 14).
5. Implement `stopRevenueRecognitionSchedule`, including the period
   preflight and atomic final step (Design decision 13) and the
   optimistic-lock header on `.../stop`.
6. Implement the read routes (`GET .../deferrals/preview`, `GET
   .../deferrals`, `GET .../deferrals/:id`).
7. Build the preview-before-commit and schedule-view UI.
8. Execute the Testing Strategy's concurrency and integration cases
   (two-contender accrue, accrue-vs-stop, crash-after-post retry,
   locked-period preflight) before merge.

## Migration & Backward Compatibility

**New section, added maintainer-review round** (finding 6 / Backward
compatibility note — the initial draft had none).

- **No existing API, event, entity, or dependency changes.** This is a
  wholly new module plus one additive patch (the `840` account) to
  `2026-09-15-default-chart-of-accounts.md`; nothing already running
  is touched.
- **Dependency/activation order.** `deferred_revenue` depends on
  `ledger` (hard) and `sales`/`sales_invoice_gl_posting` (soft); it
  must activate after all three exist, matching the dependency
  direction already declared in Architecture. The `840` chart-of-accounts
  patch must land (and be provisioned per tenant, next bullet) before
  `deferred_revenue` is enabled for that tenant — `deferRevenueRecognition`
  otherwise fails closed with **422 `DEFERRED_REVENUE_ACCOUNT_UNSET`**
  (Design decision 5), never defaults.
- **Existing-tenant account provisioning.** A tenant already running
  `default-chart-of-accounts` before this patch does not get `840`
  automatically — the chart-of-accounts seed only runs at initial
  module activation, matching `640`'s own precedent when it was added.
  An existing tenant that wants to use `deferred_revenue` must add the
  `840` account (or an equivalent) and configure
  `deferredRevenueLiabilityAccountId` before first use; this is an
  operational/deployment step, not a data migration, since no
  `RevenueDeferral` rows can exist yet for a tenant that has never run
  this module.
- **Unconfigured-module behavior.** With
  `deferredRevenueLiabilityAccountId` unset, every
  `deferRevenueRecognition` call rejects (**422**); `sales_invoice_gl_posting`
  keeps posting full revenue at invoice time exactly as it does today
  — the module is fully opt-in per tenant, and its absence changes no
  existing posting behavior.
- **Invoice amounts never change.** `deferred_revenue`'s `AGENTS.md`
  MUST NOT rule (Architecture) means `SalesInvoiceLine`/`SalesInvoice`
  totals are immutable from this module's perspective for the life of
  a tenant, migration or not — only GL-side reclassification entries
  move value between accounts.
- **Reversal/rollback of an erroneous deferral.** Not designed as a
  dedicated command in Phase 1 (no `undeferRevenueRecognition`); the
  general-purpose mechanism is the same one `ledger` already exposes
  for any wrong posting — a manual `reverseJournalEntry` against the
  reclassification entry — but that alone does not restore
  `RevenueDeferral.status`/undo the generated schedule rows, since
  those are this module's own state, not `ledger`'s. **Before first
  accrual** (all `RevenueRecognitionScheduleEntry` rows still
  `accruedAt IS NULL`), the schedule rows can be deleted and the
  `RevenueDeferral` row itself removed alongside a manual ledger
  reversal, with no downstream state depending on them yet. **After
  first accrual**, no defined recovery exists — named here as a gap,
  not designed around, matching the "no redeferral" one-per-line rule
  (Data Model) that already makes a clean re-attempt impossible without
  it.

## Testing Strategy

**New section, added maintainer-review round** (finding 1's explicit
"require a two-contender and crash-after-post retry test" plus finding
6's integration-matrix ask — the initial draft had no test plan at
all). This is a specification of the required test coverage, not
implementation tests in this documentation-only PR (matching the
review's own framing).

### Concurrency (Design decision 12/13 — required by finding 1)

| # | Case | Expected outcome |
|---|---|---|
| 1 | Two concurrent `POST /accrue` calls both select the same due entry | Second call blocks on the `RevenueDeferral` row lock, re-reads `accruedAt IS NULL` as false, skips — exactly one `JournalEntry` posted |
| 2 | `POST /accrue` racing `POST .../stop` on the same deferral | Whichever acquires the lock first completes; the other re-reads the now-current `status`/`accruedAt` state and reacts accordingly (accrue skips an entry `stop` already caught up or voided; stop's catch-up step correctly picks up an entry `accrue` just posted) — never a double-post, never a lost update |
| 3 | Crash (process kill) after `ledger.postJournalEntry` commits internally but before the outer transaction commits | Not reachable — the ledger post and the `accruedAt` write share one `em.transactional()` block (Design decision 12); a crash before that block's own commit means neither lands. Simulate by killing the process mid-transaction and asserting neither the `JournalEntry` nor the `accruedAt` write survived |
| 4 | Retry after case 3 | Re-running `/accrue` with the same `asOf` posts exactly once — the entry is still `accruedAt IS NULL` |
| 5 | `POST .../stop` with a locked `stopDate` period, after some catch-up entries already exist as `ACTIVE`-period entries | Rejects **409 `FISCAL_PERIOD_LOCKED`** before any catch-up posting — no catch-up entries exist afterward that wouldn't have existed before the call |
| 6 | Partial catch-up failure inside `stop` (one entry's `ledger.postJournalEntry` throws an unexpected error) | Reported in `catchUpFailed`; the final recognition step does not run; the deferral stays `ACTIVE`; retrying `/stop` with the same `stopDate` is safe |

### Integration matrix (finding 6)

| Scenario | Covered by |
|---|---|
| Competing accrue/accrue requests | Concurrency #1 |
| Competing accrue/stop requests | Concurrency #2 |
| Interrupted posting + retry | Concurrency #3/#4 |
| Rounding (12-period, non-divisible amount) | Design decision 11 worked example |
| Locked periods (accrue) | Edge Cases — skipped, not failed |
| Locked periods (stop) | Concurrency #5 |
| Source correction (`SalesCreditMemo`/`SalesReturn`) | Design decision 14 — `blockedByCorrection` |
| Configuration change mid-schedule (liability account) | Design decision 9 — snapshot unaffected by later config change |
| Currency rejection | Design decision 10 — `422 DEFERRED_REVENUE_CURRENCY_UNSUPPORTED` |
| Scope/permission denial | Access Control feature checks per route |
| Preview/commit agreement | `GET .../deferrals/preview` output must equal the schedule `POST .../deferrals` actually persists for the same input |
| Restoration/correction after an erroneous pre-accrual deferral | Migration & Backward Compatibility — manual delete + reversal path |

## Canonical Mechanisms

**New section, added maintainer-review round**, per `om-spec-writing`'s
Review Heuristic 6.

- **CRUD routes**: none — every write is a custom command route
  (`deferRevenueRecognition`, `accrueRevenueRecognition`,
  `stopRevenueRecognitionSchedule`), matching
  `sales_invoice_gl_posting`'s own precedent for a posting action that
  isn't a `makeCrudRoute` list/detail surface. The two list/detail read
  routes (`GET .../deferrals`, `GET .../deferrals/:id`) use
  `makeCrudRoute`'s read side with `indexer: { entityType:
  'deferred_revenue.RevenueDeferral' }`.
- **Forms**: the "Defer recognition" and "Stop" actions are
  non-`CrudForm` writes (they trigger commands with side effects
  beyond a field edit) and so use `useGuardedMutation`, matching
  `lockFiscalPeriod`/`unlockFiscalPeriod`'s own precedent for the same
  reason.
- **HTTP**: all client calls go through `apiCall`/`apiCallOrThrow`,
  never raw `fetch`.
- **Cache**: read routes (`GET .../deferrals`, `GET .../deferrals/:id`)
  are DI-resolved-cache-backed, tenant-scoped tags, invalidated on
  every write command (`deferRevenueRecognition`,
  `accrueRevenueRecognition`, `stopRevenueRecognitionSchedule`) for the
  affected `deferralId` and the list tag.
- **Events**: none declared in Phase 1 — no downstream consumer named
  yet, the same explicit "named, not silently skipped" posture
  `sales_invoice_gl_posting` already adopted for the identical
  situation.
- **Design System**: the schedule preview/read views use `DataTable`
  for the row list, `StatusBadge` for `RevenueDeferral.status`, and
  `Alert` for the `blockedByCorrection`/locked-period states — no
  hardcoded status colors, no arbitrary text sizes, no inline `<svg>`.
  The "Stop" confirmation dialog follows Cmd/Ctrl+Enter submit /
  Escape cancel with `aria-label` on its icon-only close control, the
  same DS contract every other financial-module dialog in this family
  already follows.

## File Manifest

| File | Change |
|---|---|
| `.ai/specs/2026-09-17-deferred-revenue.md` | New (this document) |
| `packages/core/src/modules/deferred_revenue/data/entities.ts` | New — `RevenueDeferral`, `RevenueRecognitionScheduleEntry` |
| `packages/core/src/modules/deferred_revenue/AGENTS.md` | New |
| `packages/core/src/modules/deferred_revenue/commands/deferRevenueRecognition.ts` | New |
| `packages/core/src/modules/deferred_revenue/commands/accrueRevenueRecognition.ts` | New |
| `packages/core/src/modules/deferred_revenue/commands/stopRevenueRecognitionSchedule.ts` | New |
| `packages/core/src/modules/deferred_revenue/api/deferrals/route.ts` | New — list/create/preview routes (**added, maintainer-review round**) |
| `packages/core/src/modules/deferred_revenue/api/deferrals/[id]/route.ts` | New — detail route (**added, maintainer-review round**) |
| `packages/core/src/modules/deferred_revenue/api/deferrals/[id]/stop/route.ts` | New |
| `packages/core/src/modules/deferred_revenue/api/accrue/route.ts` | New |
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

## Final Compliance Report — 2026-09-21

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
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `deferred_revenue` reads `SalesInvoiceLineRevenueAccount`/`SalesInvoice`/`SalesCreditMemo`/`SalesReturn` via direct `entityManager` reads only, no ORM relations (Architecture, Design decision 14) |
| root AGENTS.md | Filter by organization_id / tenant_id | Compliant | All entities carry both (Data Model); Tenant & Organization Scoping (Architecture) states every command/query and cross-module read is scoped by both |
| root AGENTS.md (Design System Rules) | No hardcoded Tailwind status colors / arbitrary text sizes; semantic tokens | Compliant | Canonical Mechanisms — `StatusBadge` for `status`, `Alert` for blocked/locked states |
| `.ai/ds-rules.md` + `.ai/ui-components.md` | Shared UI primitives; dialog Cmd/Ctrl+Enter + Escape; `aria-label` on icon-only buttons | Compliant | Canonical Mechanisms — `DataTable`, Stop dialog contract |
| packages/core/AGENTS.md → API Routes | CRUD routes use `makeCrudRoute` with `indexer: { entityType }` | Compliant | Canonical Mechanisms — read routes only; writes are custom command routes, matching `sales_invoice_gl_posting`'s own precedent |
| packages/core/AGENTS.md → Encryption | Sensitive/GDPR fields declared in `encryption.ts`, read via `findWithDecryption` | N/A | No PII/GDPR/free-text-about-people fields — `RevenueDeferral`/`RevenueRecognitionScheduleEntry` are pure financial/date/amount records, same posture as `DepreciationScheduleEntry` |
| packages/ui/AGENTS.md | Backend forms use `CrudForm`; lists use `DataTable`; non-`CrudForm` writes use `useGuardedMutation` | Compliant | Canonical Mechanisms |
| packages/ui/src/backend/AGENTS.md | All HTTP via `apiCall`/`apiCallOrThrow` | Compliant | Canonical Mechanisms |
| packages/cache/AGENTS.md | Cache resolved via DI; tenant-scoped tags; tag-based invalidation declared per write path | Compliant | Canonical Mechanisms |
| packages/events/AGENTS.md | Cross-module side effects via `createModuleEvents`, not direct imports | Compliant | No events in Phase 1 (named explicitly, not silently skipped, Canonical Mechanisms); the only cross-module traffic is the sanctioned direct-entity-read pattern (soft dependency) and `commandBus.execute('ledger.postJournalEntry'/'ledger.reverseJournalEntry', ...)` — a command call, not a service import |
| root AGENTS.md | Singular naming | Compliant | `RevenueDeferral`, `RevenueRecognitionScheduleEntry` — singular throughout |
| root AGENTS.md | FK IDs only for cross-module links | Compliant | `invoiceLineId`, `invoiceId`, `originalRevenueAccountId`, `deferredRevenueLiabilityAccountId` — all FK-ids, no ORM relations |
| root AGENTS.md | Undoability is the default for state changes | Compliant / Non-compliant | Reversal of the reclassification entry is possible via `ledger.reverseJournalEntry` (any time); full undo of `deferRevenueRecognition`'s own state is only defined pre-accrual (Migration & Backward Compatibility) — **flagged as a named gap, not silently missing**, matching this module's own "no redeferral" one-per-line constraint |
| root AGENTS.md | Zod validation for all API inputs | Compliant | All API Contracts bodies are typed, finite shapes suitable for Zod schemas (dates, uuids, enums) |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `deferredRevenueLiabilityAccountId`/`currencyCode`/`updatedAt` (Data Model) are exactly the fields the new error codes and optimistic-lock header (API Contracts) depend on |
| API contracts match UI/UX section | Pass | `GET .../deferrals/preview` and `GET .../deferrals/:id` (API Contracts) back the preview and schedule-view UI (UI/UX) exactly |
| Risks cover all write operations | Pass | `deferRevenueRecognition` (currency/config risk — Design decisions 9/10), `accrueRevenueRecognition` (concurrency, correction risk — Design decisions 12/14), `stopRevenueRecognitionSchedule` (concurrency, period-lock risk — Design decisions 12/13) all have a corresponding Risks & Impact Review entry |
| Commands defined for all mutations | Pass | Three commands (`deferRevenueRecognition`, `accrueRevenueRecognition`, `stopRevenueRecognitionSchedule`) cover every write path; no direct entity writes bypass them |
| Cache strategy covers all read APIs | Pass | Canonical Mechanisms declares tag-based invalidation for both new read routes |

### Non-Compliant Items

None outstanding. The one partial item (Undoability, post-accrual) is
recorded as an explicit, reasoned gap in Migration & Backward
Compatibility rather than an unaddressed rule violation — matching how
Annual Financial Statements (#6188) and Multi-Currency (#6190) each
recorded their own remaining ⚠-flagged open points in this same report
rather than treating "Fully compliant" as requiring every business
question to be pre-answered.

### Verdict

- **Fully compliant** for architectural/AGENTS.md rules — approved for
  implementation **once Implementation Plan Step 0 (Design decision 6
  confirmation) is resolved**, per this document's own resequencing.

## Changelog

- **2026-09-17** — Initial draft. Step 1 corrected a scope
  misattribution from an earlier informal summary (no leasing/loan
  signal in the actual Event Storming source files — see Problem
  Statement); scope narrowed to exactly what the wall names ("own
  spec": revenue recognized over time for sales/AR). Steps 2–3
  completed; Design decision 6 (early-stop policy) flagged **⚠ NEEDS
  HUMAN CONFIRMATION**.
- **2026-09-21 (maintainer-review round, PR #6193)** — Addressed all 7
  maintainer-review findings: added Design decisions 9–14 (liability
  account snapshot, currency-basis restriction, anniversary-month
  schedule rule with worked examples, shared locked-claim concurrency
  contract for `accrue`/`stop`, `stop`'s period preflight + atomic
  final step, and a Phase 1 correction/credit-memo guard); resequenced
  Design decision 6's confirmation to Implementation Plan Step 0; added
  `deferredRevenueLiabilityAccountId`/`currencyCode`/`updatedAt` to
  `RevenueDeferral` (Data Model); added `GET .../deferrals/preview`,
  `GET .../deferrals`, `GET .../deferrals/:id`, and an
  optimistic-lock header + new error codes on `.../stop` and
  `.../deferrals` (API Contracts); added Access Control and Tenant &
  Organization Scoping subsections (Architecture); added Migration &
  Backward Compatibility, Testing Strategy, and Canonical Mechanisms
  sections; ran the `om-spec-writing` Compliance Gate for the first
  time (Final Compliance Report). Findings verified directly against
  primary sources per `financial-spec-citation-check`: GL core engine's
  `journal_entry` reference index (confirmed non-unique), Fixed Assets'
  `disposeAsset` period-preflight text (`:1226-1233`), Multi-Currency's
  (#6190) `SELECT ... FOR UPDATE` concurrency pattern (Design decision
  10), and `sales-invoice-gl-posting.md`'s Phase 1 base-currency
  restriction (`:1007`).
