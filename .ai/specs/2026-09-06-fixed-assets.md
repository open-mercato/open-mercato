# Fixed Assets — asset register, depreciation, OT, RMK

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(the posting engine this spec books into; `LedgerAccount.parentAccountId`
already exists for the chart-of-accounts hierarchy), [Accounts Payable](2026-09-06-accounts-payable.md)
(the usual asset-entry source — purchase from a vendor), [Journal Entry Line Dimension](2026-09-06-journal-entry-line-dimension.md)
(a Phase 2 prerequisite for `transferAsset`/MPK — built as a separate,
earlier document, not part of this spec), [Posting Rules Engine](2026-09-06-posting-rules-engine.md)
(an independent downstream consumer of the same `ledger.journal_entry.posted`
event this spec's depreciation postings emit — see Architecture → Events)

## TLDR

**Key Points:**
- An asset register, a depreciation schedule, an OT document (asset
  acceptance/put-into-service), an LT document (asset disposal/retirement),
  and monthly depreciation accrual + RMK (rozliczenia międzyokresowe kosztów
  — accrued/deferred costs), posting to GL.
- Identified as new scope from the event-storming wall (HS-05), outside
  #5663's original Month 1-3 categorization. Closes two High-priority gaps
  SPEC-024's feature matrix flags against the pre-existing draft:
  capitalization thresholds (low-value assets) and disposal/retirement.

**Scope:**
- Asset register (`FixedAsset`) with its own acquisition, depreciation and
  ledger-account fields — not just a tag on `LedgerAccount.parentAccountId`.
- Straight-line depreciation, materialized as a schedule, accrued through a
  manual trigger.
- Low-value asset one-time write-off (art. 32 ust. 6 Ustawy o rachunkowości),
  threshold configurable per organization, defaulting to the 10 000 PLN tax
  threshold (art. 22f ust. 3 ustawy o PIT).
- Disposal (LT document) removing an asset's gross value and accumulated
  depreciation from the ledger and booking the resulting gain/loss.
- Manual and AP-linked asset entry.

**Concerns (if any):**
- Tax depreciation (a second, CIT/PIT schedule diverging from book
  depreciation) is deliberately deferred to Phase 2 — this spec's schedule
  is book-only. See Out of Scope.
- `transferAsset` (MPK reassignment) and `revalueAsset` both wait on the
  `journal_entry_line_dimension` table (a separate, earlier document) and
  are Phase 2.

## Overview

Module id: `fixed_assets`.

Every organization that owns machinery, vehicles, computers, or office
equipment needs to track what it owns, what it's worth net of use, and when
it stops owning it. Today nothing in Open Mercato models this: `ledger`
(#5663) gives every module a place to post double-entry transactions, but it
has no concept of an asset with an acquisition date, a useful life, and a
depreciation schedule — `LedgerAccount.parentAccountId` only models where an
account sits in the chart-of-accounts hierarchy, not what a specific physical
asset is worth today. `accounts_payable` records what a vendor invoice owes,
not what was bought with it.

This spec builds the missing register and its lifecycle: acquire (`OT` —
przyjęcie środka trwałego do używania), depreciate on a schedule, and dispose
(`LT` — likwidacja środka trwałego), each producing the journal entries
`ledger` expects. Depreciation expense lands in zespół 4 (costs by nature)
the same account-group check Posting Rules Engine already uses for
Accounts Payable's cost lines, so mechanically it reclassifies to zespół 5
the same way — with one caveat worth stating plainly, not glossing over:
Posting Rules Engine's own spec scopes its Phase 1 explicitly to
"AP only as the cost source," naming Fixed Assets' *own* Phase 2 as when
that integration is expected to be exercised — see Architecture → Events
for the full reasoning and what Phase 1 actually commits to here.

> **Market Reference**: GnuCash's business-accounts module and Odoo's
> `account_asset` were both consulted for the asset-lifecycle shape
> (register → depreciation schedule → disposal). Adopted: a materialized
> depreciation schedule generated at acceptance rather than computed on
> read (matches this codebase's own `JournalEntry` append-only philosophy
> more closely than either reference implementation, which both allow
> schedule rows to be regenerated in place). Rejected: Odoo's single
> `account.asset` model that also serves as the depreciation *method*
> configuration object — this spec keeps the asset register
> (`FixedAsset`) and the depreciation calculation strategy
> (`DepreciationCalculator`, SPEC-024) separate, so a Phase 2
> declining-balance method is an additional strategy, not a rewrite of
> the entity.

## Problem Statement

- No entity anywhere in `packages/core` represents a fixed asset, a
  depreciation schedule, or an asset disposal. Confirmed by searching for
  `asset`, `depreciation`, and `OT`/`LT` document semantics — the only
  existing hit is `LedgerAccount.parentAccountId`, which is structural
  chart-of-accounts placement, not an asset register (see
  `.ai/specs/2026-08-18-general-ledger-core-engine.md` → Design decisions,
  "Its own asset register, not just `parentAccountId`").
- `accounts_payable`'s `VendorInvoiceLine.accountId` is validated at the
  command level to a group 3 or group 4 account (`2026-09-06-accounts-payable.md`
  → Data Models) — a vendor invoice can never post directly to a
  fixed-asset account, so even a purchase clearly meant to become a fixed
  asset lands, at posting time, on a clearing or cost account with no
  register, no useful life, and no depreciation schedule attached to it.
- SPEC-024 (the financial-module epic) names two High-priority gaps in the
  feature matrix that the pre-existing Fixed Assets draft (9 Design
  Decisions, 2026-09-07) did not address: **capitalization thresholds**
  (auto-expensing below a threshold) and **disposal/retirement**. HS-05 on
  the event-storming wall independently flags "typ i kwota amortyzacji" —
  the *type* of depreciation is covered by the existing draft's
  `DepreciationCalculator` decision, but the *amount* ("kwota") half of
  that note was left unaddressed until this revision.
- Without a disposal flow, an asset sold, scrapped, or donated stays on the
  books forever at its last book value — Ustawa o rachunkowości's own
  asset definition (art. 3 ust. 1 pkt 12) ties an asset's balance-sheet
  presence to it still meeting that definition; once it doesn't, keeping it
  on the register misstates the balance sheet.

## Proposed Solution

A new module (`fixed_assets`) providing:

1. An **asset register** (`FixedAsset`): acquisition data, ledger-account
   assignments, and lifecycle status, entered either through a linked
   Accounts Payable invoice line or manually.
2. A **depreciation schedule** (`DepreciationScheduleEntry`), materialized
   in full at acceptance (`OT`), straight-line in Phase 1.
3. A **manual accrual trigger** (`accrueDepreciation`) that posts due,
   unposted schedule entries to `ledger`, pre-checking the covering fiscal
   period's lock state.
4. A **low-value one-time write-off path**: an asset at or below a
   configurable threshold (`FixedAssetSettings.lowValueThresholdAmount`,
   defaulting to 10 000 PLN) is expensed in full at acceptance instead of
   scheduled — art. 32 ust. 6 Ustawy o rachunkowości.
5. A **disposal flow** (`AssetDisposal`, `disposeAsset`), removing the
   asset's gross value and accumulated depreciation from the ledger and
   booking the net-book-value gain/loss to pozostałe koszty/przychody
   operacyjne — art. 3 ust. 1 pkt 32 lit. b) Ustawy o rachunkowości.

### Design Decisions (2026-09-07 — resolved, unless marked otherwise)

**Asset entry: both through AP (linked) and manually.** An opening
balance, an in-kind contribution, and migrating existing fixed assets all
need a path independent of AP — Fixed Assets has no hard dependency on AP
being built first. `FixedAsset.entrySource` (`AP_LINKED` / `MANUAL` /
`OPENING_BALANCE` / `IN_KIND_CONTRIBUTION`) records which; only
`AP_LINKED` carries a `sourceReferenceId` (a plain FK-id to
`accounts_payable.VendorInvoiceLine.id` — no ORM relation, per
`AGENTS.md`'s cross-module rule).

**AP-linked entry is a manual cross-reference, not an event-driven
capitalization pipeline — and `acceptFixedAsset` always posts the
capitalization entry itself, even for `AP_LINKED` assets (corrected
2026-09-09).** An earlier revision of this decision assumed
`VendorInvoiceLine.accountId` could point directly at an asset account
(e.g. `010`), so that AP's own posting would already capitalize the
purchase and `acceptFixedAsset` would only need to skip posting for that
source. Checked against `accounts_payable`'s actual command-level
validation and found wrong: `VendorInvoiceLine.accountId` is "expected in
group 3 [account 300] or group 4 — validated at the command level"
(`2026-09-06-accounts-payable.md` → Data Models,
`VendorInvoiceLine`) — group 0 (fixed-asset accounts) is not a legal
value there. A vendor invoice for a fixed asset is therefore always
posted by AP to a clearing account (typically `300` — Rozliczenie
zakupu) or a cost account, never directly to the asset's own `0xx`
account; standard Polish practice reclassifies that value onto the asset
register at the moment of OT acceptance, not at invoice-posting time.
`acceptFixedAsset` reflects this: it **always** posts one capitalization
journal entry (debit `ledgerAssetAccountId` for `acquisitionValue`),
regardless of `entrySource` — for `AP_LINKED`, the credit side is the
linked `VendorInvoiceLine.accountId` itself (resolved by a soft,
try/catch lookup into `accounts_payable`, since that module is optional —
see Migration & Compatibility); for the other three sources, the credit
side is the caller-supplied `offsetAccountId`. The accountant still picks
the originating `VendorInvoiceLine` explicitly (see API Contracts,
`createFixedAsset`) — this spec does not subscribe to any AP event or
infer asset purchases automatically, only the *posting* behavior changed,
not the manual-linking posture.

**Depreciation method: straight-line in Phase 1, pluggable for a
declining-balance method later.** Straight-line covers the large majority
of real cases; `DepreciationCalculator` as a swappable strategy
(SPEC-024) leaves room to extend without a rewrite. `FixedAsset.
depreciationMethod` is an enum with three Phase 1 values —
`STRAIGHT_LINE`, `ONE_TIME` (see the low-value decision below), and a
reserved `DECLINING_BALANCE` value that Phase 1 rejects at the command
layer (kept in the enum now so Phase 2 doesn't need a data migration to
add it, the same empty-table-costs-nothing logic `ledger` used for
`referenceType`/`referenceId`).

**The depreciation schedule is a materialized entity, not an on-the-fly
calculation.** Consistent with GL's own philosophy (`JournalEntry`
append-only/immutable) — historical depreciation entries must not change
retroactively when someone edits the asset's parameters later; an audit
requirement. `DepreciationScheduleEntry` rows for the asset's entire
useful life are generated in one batch by `acceptFixedAsset` (see
Architecture → Commands); editing `usefulLifeMonths`/`acquisitionValue`
after acceptance is rejected (`FixedAsset` fields affecting the schedule
become immutable once `status != 'DRAFT'`, the same immutability class
`ledger.LedgerAccount.accountTypeId` uses once posted entries exist).

**Depreciation accrual: a manual trigger in Phase 1.** An automated
scheduler is Phase 2 — this reduces operational risk, matching how #5663
itself deferred automated year-end closing.

**Locked-`FiscalPeriod` rejection on accrual — resolved (2026-09-09,
supersedes the prior "not yet designed" note).** `accrueDepreciation`
checks `FiscalPeriod.isLocked` for the schedule entry's period *before*
calling `ledger.postJournalEntry`, the same pre-check pattern Posting
Rules Engine's period-close guard uses (`2026-09-06-posting-rules-engine.md`
→ Design Decisions, "Period-close guard") rather than only catching
`postJournalEntry`'s own rejection after the fact. A locked period is
skipped, not treated as an error — see Architecture → Commands,
`accrueDepreciation`, and Risk Register.

**Low-value asset one-time write-off — new, resolved 2026-09-09.**
Art. 32 ust. 6 Ustawy o rachunkowości lets a unit's accounting policy
depreciate "składniki majątku o niskiej jednostkowej wartości" through a
simplified, one-time write-off rather than a multi-period schedule.
Rather than inventing an arbitrary policy amount, Phase 1 defaults the
threshold to the 10 000 PLN net value already established by tax law
(art. 22f ust. 3 ustawy o PIT, mirrored for CIT taxpayers by art. 16f
ust. 3 ustawy o CIT) — the amount below which a taxpayer may deduct an
asset's full value in the month put into use or the following month.
Aligning the accounting-policy threshold to the tax threshold by default
avoids a permanent book-tax difference for the common case, while
`FixedAssetSettings.lowValueThresholdAmount` stays organization-editable
for units whose accounting policy sets a different figure. An asset whose
`acquisitionValue` is at or below the threshold in effect at acceptance
gets `depreciationMethod: 'ONE_TIME'`; `acceptFixedAsset` posts its full
value to depreciation expense — a second, separate journal entry from the
capitalization entry above (debit `ledgerDepreciationExpenseAccountId`,
credit `ledgerAccumulatedDepreciationAccountId`) — in the same
transaction as acceptance, and generates a single, already-accrued
`DepreciationScheduleEntry` (so the schedule view stays the one place
that explains "why is this asset's net book value zero" — no
special-cased UI path for one-time assets). `FixedAsset.
lowValueThresholdSnapshot` (nullable numeric, always in the threshold's
own currency) records the threshold actually applied at acceptance time,
so a later change to `FixedAssetSettings` never retroactively
reclassifies an already-accepted asset — the same point-in-time-snapshot
reasoning `JournalEntryLine.contractorSnapshot` already established in
`ledger`. **Currency conversion (added 2026-09-09):** `FixedAsset.
currencyId` and `FixedAssetSettings.lowValueThresholdCurrencyId` are
independent — an asset acquired in EUR must not be compared raw against
a PLN-denominated threshold. `FixedAsset` gains an `exchangeRate` field
(nullable, mirroring `ledger.JournalEntry.exchangeRate`) recording the
rate to the organization's base currency at `acquisitionDate`;
`acceptFixedAsset` converts `acquisitionValue` to the threshold's
currency via that rate (resolved from `currencies.ExchangeRate` the same
way `ledger` resolves rates for `JournalEntry`) before comparing against
`lowValueThresholdAmount`. If no rate is resolvable (the threshold's
currency and the asset's currency share no recorded exchange rate for
that date), `acceptFixedAsset` rejects rather than silently skipping the
comparison.

**Disposal / retirement — new, resolved 2026-09-09.** Modeled as its own
entity, `AssetDisposal`, plus a dedicated command, `disposeAsset` — not a
status flag alone, because a disposal is itself an accounting event with
its own document (`LT` — likwidacja środka trwałego) and its own journal
entry, not merely a UI state change. `disposeAsset` computes the asset's
net book value at the disposal date from its actual accrued
`DepreciationScheduleEntry` rows (not the original schedule's plan — an
asset disposed mid-schedule has fewer accrued periods than planned), then
posts one journal entry that: debits the accumulated-depreciation account
for the total accrued so far, debits or credits "pozostałe koszty/
przychody operacyjne" for the resulting gain or loss (and, for a `SALE`,
debits cash/receivable for the proceeds), and credits the asset account
for the full original `acquisitionValue`. Legal basis: an asset ceasing
to meet art. 3 ust. 1 pkt 12's definition (no longer expected to bring
future economic benefit to the unit) is derecognized, and the resulting
gain/loss falls under art. 3 ust. 1 pkt 32 lit. b) Ustawy o rachunkowości
(pozostałe koszty/przychody operacyjne) — there is no single dedicated
"disposal article"; the mechanics come from applying the asset
definition and the operating-result classification together, as
confirmed by the LT document's standard account set (01/07/09/75/76)
used in Polish practice. `AssetDisposal.disposalType` covers `SALE`,
`LIQUIDATION`, `DONATION`, and `SHORTAGE` (niedobór) — all four share the
same core mechanic (remove gross value + accumulated depreciation, book
the NBV difference to pozostałe koszty/przychody operacyjne); `SALE`
additionally records `proceedsAmount`. `disposeAsset` sets `FixedAsset.
status = 'DISPOSED'`; a disposed asset accepts no further accrual
(`accrueDepreciation` skips it) and cannot be re-disposed.

**Disposal always catches up due-but-unposted depreciation through the
disposal date first — added 2026-09-09.** Net book value is only correct
if every schedule entry due on or before `disposalDate` has actually been
accrued; since accrual is a manual trigger (see above), an asset disposed
mid-month simply because nobody ran that month's accrual yet would
otherwise understate accumulated depreciation and misstate the
disposal's gain/loss — a live failure mode distinct from (and not covered
by) the already-mitigated planned-vs-actual basis risk. `disposeAsset`
closes this by running the same due-entry accrual logic
`accrueDepreciation` uses — scoped to this one asset, up to
`disposalDate` — as its own first step, inside the same transaction,
before computing `netBookValueAtDisposal`. A due entry whose covering
`FiscalPeriod` is locked is skipped exactly as `accrueDepreciation` would
skip it; `disposeAsset` then proceeds using whatever accrued total
actually exists at that point (the same actual-not-planned basis as
always), reported to the caller so a locked-period gap isn't silently
absorbed into the disposal figures (see API Contracts).

**Correcting a mis-accepted asset: `reopenFixedAsset`, reversal-based,
permitted only before any accrual — added 2026-09-09.** Making the
financial fields immutable once `status != 'DRAFT'` (see "Its own asset
register" below and Data Models) protects posted history, but a
mis-keyed OT — wrong `usefulLifeMonths`, wrong ledger account — is a
routine data-entry error, not an edge case, and disposing a wrongly
-accepted asset just to fix a typo would falsely record a real disposal
event that never happened. `reopenFixedAsset` reverts `ACTIVE` → `DRAFT`,
permitted only while **zero** `DepreciationScheduleEntry` rows for the
asset have `accruedAt` set (i.e. nothing from its schedule has ever
posted to `ledger`) — the same "immutable once real history exists"
boundary this spec uses everywhere else. It calls `ledger.
reverseJournalEntry` against the capitalization entry (never mutating or
deleting it — the "reversal, not undo" posture #5663 established),
deletes the still-unaccrued `DepreciationScheduleEntry` rows, and clears
`otDocumentNumber`/`otDate`/`lowValueThresholdSnapshot`/`exchangeRate` so
a corrected `acceptFixedAsset` call regenerates them cleanly. Requires
`fixed_assets.assets.manage` — the same feature as acceptance itself,
since this is acceptance's own correction path, not a distinct
capability.

**RMK shares a mechanism with the future Revenue Recognition module —
stays inside Fixed Assets for now, as a deliberate architectural debt.**
Structural symmetry: both capabilities are "an amount recognized
gradually on a schedule" — the strongest signal, of everything considered
in this review round, for extracting a generic mechanism. Even so, it
stays here in Phase 1: Revenue Recognition is, for now, only the name of
a future module, with no skeleton of its own — extracting a shared
scheduling mechanism now, with no second, real consumer in view, risks
designing the wrong abstraction (guessing an API's shape from a single
use case). This deliberately accepts the risk of rewriting RMK once
Revenue Recognition actually exists and reveals whether a shared
mechanism genuinely fits both cases — safer than designing a generic
abstraction blind. Concretely in Phase 1, `DepreciationScheduleEntry` *is*
the RMK mechanism for depreciation — there is no separate RMK entity;
"RMK" in this spec names the accounting concept the schedule implements,
not a distinct table.

**Its own asset register, not just `parentAccountId`.** A fixed asset
needs far more data than a position in the account hierarchy (acquisition
date, value, rate, accumulated depreciation) — `parentAccountId` is only
an optional reporting link to an analytic account in GL.

**Tax depreciation: deliberately outside Phase 1, but designed for
extension.** Book and tax depreciation can differ under Polish law
(CIT/PIT vs. UoR — the Accounting Act) — Phase 1 handles only book
depreciation, with the gap explicitly flagged and the architecture ready
for a second schedule. Note the low-value threshold decision above
already reuses the tax-law figure as the *default* book threshold purely
for practical alignment — it does not imply Phase 1 tracks a separate tax
depreciation schedule; an organization whose accounting policy diverges
from the tax threshold simply edits `FixedAssetSettings`.

**`revalueAsset` and `transferAsset` — both Phase 2.** Revaluation is a
rare, annual event (wycena majątku — asset appraisal); transfer to a cost
centre (MPK) is waiting on the dimension table
(`2026-09-06-journal-entry-line-dimension.md`) anyway, which is itself
being built as a separate, earlier step ahead of Fixed Assets Phase 2.
Phase 2's `transferAsset` will declare `requires: ['journal_entry_line_dimension']`
and write through that module's own `journal_entry_line_dimension.
setJournalEntryLineDimension` command — the same integration shape
`posting_rules` already documents for the same table
(`2026-09-06-posting-rules-engine.md` → Design Decisions) — not by
reading its entities directly.

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Auto-detect AP-linked assets by matching `VendorInvoiceLine.account_id` against known asset accounts | `VendorInvoiceLine` carries no marker distinguishing "this line is an asset purchase" from an ordinary cost posted to the same account by coincidence; guessing risks silently registering the wrong lines as assets. Manual linking, chosen instead, costs the accountant one extra click and is unambiguous. |
| A single status flag (`isDisposed: boolean`) instead of `AssetDisposal` + `disposeAsset` | A disposal is itself an accounting event with its own document (LT), date, type, and journal entry — a boolean can't carry that, and SPEC-024 explicitly scores this a High-priority, not cosmetic, gap. |
| Hardcoding the low-value threshold at 10 000 PLN with no settings entity | Ties Phase 1 to one jurisdiction's current tax figure with no path to change it if the law changes or an organization's accounting policy differs from the tax minimum — `FixedAssetSettings` costs one small table and keeps the number editable, matching how `LedgerAccountGroup` avoided hardcoding zespoły into an enum. |
| Computing net book value at disposal from the *planned* schedule rather than actual accrued entries | Silently wrong for any asset disposed before its schedule completes (the common case) — would overstate accumulated depreciation and misstate the disposal gain/loss. |

## User Stories

- An accountant registers a fixed asset purchased through Accounts
  Payable, linking it to the vendor invoice line that recorded the
  purchase; accepting it (OT) reclassifies that value from wherever AP
  posted it onto the asset's own ledger account, the same capitalization
  moment Polish practice already expects.
- An accountant registers a fixed asset with no AP invoice — an opening
  balance carried over from a prior system, an in-kind contribution, or a
  migration — and Fixed Assets posts its initial value to GL directly.
- An accountant accepts an asset into use (`OT`), which generates its full
  depreciation schedule (or, for a low-value asset, expenses it in full
  immediately) and assigns the ledger accounts it will post to.
- An accountant runs the monthly depreciation accrual for a period and
  sees exactly which assets were posted, which were skipped because their
  period is locked, and can re-run the skipped ones once the period
  reopens.
- An accountant disposes of an asset — sold, scrapped, donated, or written
  off as a shortage — and sees the resulting gain/loss booked to GL, with
  the asset's net book value at the moment of disposal, not its original
  cost.
- A financial controller reviewing the trial balance sees depreciation
  expense reclassified from zespół 4 to zespół 5 by Posting Rules Engine
  the same way an Accounts Payable cost line would be — mechanically
  automatic, with the caveat about that module's own Phase 1 scoping
  language noted in Architecture → Events.

## Architecture

### Entities (`data/entities.ts`)

- `AssetClass` — `code`, `name`, `suggestedUsefulLifeMonths` (nullable),
  `suggestedAnnualRatePercent` (nullable), tenant/org scoped,
  user-editable (`updatedAt`, `deletedAt` — soft delete, blocked once any
  `FixedAsset` references it). A KŚT-equivalent reference list
  (SPEC-024's `AssetClass`); unlike `LedgerAccountGroup`, this is
  user-manageable rather than system-seeded, since KŚT rates are
  starting points an organization commonly adjusts.
- `FixedAssetSettings` — one row per organization, `lowValueThresholdAmount`
  (`numeric(19,4)`), `lowValueThresholdCurrencyId` (FK-id to
  `currencies.Currency.id`), `updatedAt`. Not user-creatable — upserted
  via `updateFixedAssetSettings`, seeded on organization creation (see
  Module Setup).
- `FixedAsset` — `name`, `description`, `assetClassId` (FK-id to
  `AssetClass`), `acquisitionDate`, `acquisitionValue` (`numeric(19,4)`),
  `currencyId` (FK-id to `currencies.Currency.id`), `exchangeRate`
  (nullable — rate to the organization's base currency at
  `acquisitionDate`, mirroring `ledger.JournalEntry.exchangeRate`; see
  Design Decisions, low-value threshold currency conversion),
  `entrySource` (`AP_LINKED` / `MANUAL` / `OPENING_BALANCE` /
  `IN_KIND_CONTRIBUTION`), `sourceReferenceId` (nullable FK-id to
  `accounts_payable.VendorInvoiceLine.id` — only set when `entrySource:
  'AP_LINKED'`), `depreciationMethod` (`STRAIGHT_LINE` / `ONE_TIME` /
  `DECLINING_BALANCE` reserved — see Design Decisions),
  `usefulLifeMonths` (nullable — unused for `ONE_TIME`),
  `depreciationStartDate`, `lowValueThresholdSnapshot` (nullable
  `numeric(19,4)` — see Design Decisions), `ledgerAssetAccountId`,
  `ledgerAccumulatedDepreciationAccountId`,
  `ledgerDepreciationExpenseAccountId` (three FK-ids to `ledger.
  LedgerAccount.id` — no ORM relation; all three are used for every
  `entrySource`, including `AP_LINKED` — see Design Decisions,
  "`acceptFixedAsset` always posts the capitalization entry"),
  `otDocumentNumber`, `otDate` (both nullable until accepted), `status`
  (`DRAFT` / `ACTIVE` / `FULLY_DEPRECIATED` / `DISPOSED`), tenant/org
  scoped, `updatedAt`, `deletedAt` (soft delete, blocked once `status !=
  'DRAFT'`). `acquisitionValue`, `depreciationMethod`, `usefulLifeMonths`,
  `depreciationStartDate`, and the three ledger-account fields become
  immutable once `status != 'DRAFT'` (enforced by `updateFixedAsset` —
  same immutability class as `ledger.LedgerAccount.accountTypeId`);
  `reopenFixedAsset` is the one documented path back to `DRAFT` (see
  Design Decisions, Commands).
- `DepreciationScheduleEntry` — `assetId` (FK-id to `FixedAsset`),
  `periodStartDate`, `periodEndDate`, `plannedAmount` (`numeric(19,4)`),
  `accruedAt` (nullable — null until posted), `journalEntryReferenceId`
  (nullable FK-id to `ledger.JournalEntry.id`, set atomically with
  `accruedAt`), tenant/org scoped. Generated in full by `acceptFixedAsset`;
  rows with `accruedAt IS NULL` may be deleted and regenerated only while
  the asset is still `ACTIVE` and unposted (e.g. after a correction to a
  not-yet-effective schedule) — never after `accruedAt` is set, matching
  `JournalEntry`'s own append-only posture.
- `AssetDisposal` — `assetId` (FK-id to `FixedAsset`), `disposalDate`,
  `disposalType` (`SALE` / `LIQUIDATION` / `DONATION` / `SHORTAGE`),
  `proceedsAmount` (nullable `numeric(19,4)` — `SALE` only),
  `netBookValueAtDisposal` (`numeric(19,4)`, snapshot — see Design
  Decisions), `documentNumber` (`LT-` prefixed, sequential per
  organization — same numbering posture as `JournalEntry.sequenceNumber`,
  a separate counter scoped to this document type), `notes` (nullable —
  free text; a `SHORTAGE`/niedobór note or a `SALE` note can plausibly
  name a person, so it is declared in `fixed_assets/encryption.ts`
  preemptively rather than asserted PII-free — see Final Compliance
  Report), `journalEntryReferenceId` (FK-id to `ledger.JournalEntry.id`), tenant/org
  scoped. No `updatedAt` — immutable once created, matching `JournalEntry`
  (correcting a disposal means posting a `ledger` reversal against its
  `journalEntryReferenceId`, the same "reversal, not undo" posture #5663
  established; the `AssetDisposal` record itself is never edited).

### Access Control (`acl.ts`)

Following the `ledger`/`customers` module convention
(`<module>.<resource>.view` / `.manage`, `manage` depends on `view`):

```typescript
export const features = [
  { id: 'fixed_assets.assets.view', title: 'View fixed assets', module: 'fixed_assets' },
  { id: 'fixed_assets.assets.manage', title: 'Register and accept fixed assets', module: 'fixed_assets', dependsOn: ['fixed_assets.assets.view'] },
  { id: 'fixed_assets.depreciation.view', title: 'View depreciation schedules', module: 'fixed_assets' },
  { id: 'fixed_assets.depreciation.accrue', title: 'Run depreciation accrual', module: 'fixed_assets', dependsOn: ['fixed_assets.depreciation.view'] },
  { id: 'fixed_assets.disposals.manage', title: 'Dispose fixed assets', module: 'fixed_assets', dependsOn: ['fixed_assets.assets.view'] },
  { id: 'fixed_assets.classes.manage', title: 'Manage asset classes', module: 'fixed_assets' },
  { id: 'fixed_assets.settings.manage', title: 'Manage fixed asset settings', module: 'fixed_assets' },
]
```

`createFixedAsset`/`updateFixedAsset`/`acceptFixedAsset`/
`reopenFixedAsset` require `fixed_assets.assets.manage`;
`accrueDepreciation` requires `fixed_assets.depreciation.accrue`;
`disposeAsset` requires `fixed_assets.disposals.manage`;
`createAssetClass`/`updateAssetClass` require `fixed_assets.classes.manage`;
`updateFixedAssetSettings` requires `fixed_assets.settings.manage`.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: ['fixed_assets.*'],
  employee: [
    'fixed_assets.assets.view',
    'fixed_assets.depreciation.view',
  ],
},

async seedDefaults({ em, tenantId, organizationId }) {
  // Seeds one FixedAssetSettings row with the statutory PLN low-value
  // threshold (10 000 PLN — art. 22f ust. 3 ustawy o PIT). Organizations
  // whose accounting policy uses a different figure edit it afterwards;
  // this is a starting default, not a hardcoded rule (see Design
  // Decisions). Resolves the base-currency Currency for this org via
  // `currencies` the same way `ledger`'s own seeding resolves references
  // to already-seeded modules.
  await seedFixedAssetSettings(em, { tenantId, organizationId, defaultThreshold: 10000 })
},
```

Employees get read access to the register and schedules; registering,
accepting, accruing, and disposing stay admin-only by default, consistent
with `ledger`'s own `defaultRoleFeatures` posture.

### Migration (`migrations/`)

Standard MikroORM-generated tables for the entities above. Supporting
indexes: `(organization_id, status)` on `fixed_asset` backs the assets
list's status filter and the accrual command's "all `ACTIVE` assets"
scan; `(organization_id, asset_id, accrued_at)` on
`depreciation_schedule_entry` backs both the per-asset schedule view and
`accrueDepreciation`'s "find due, unposted entries" query
(`WHERE accrued_at IS NULL AND period_end_date <= :asOf`);
`(organization_id, asset_id)` on `asset_disposal` (at most one row per
asset, enforced at the application layer in `disposeAsset` by checking
`FixedAsset.status != 'DISPOSED'` before proceeding). A separate counter
table, `asset_disposal_sequence` (`tenant_id`, `organization_id`,
`next_value`), backs `AssetDisposal.documentNumber` — same
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` allocation pattern as
`journal_entry_sequence` in `ledger`, chosen for the identical
correctness reason (a failed disposal attempt must not burn a document
number).

### Commands (`commands/`)

- `createAssetClass` / `updateAssetClass` — standard CRUD. Requires
  `fixed_assets.classes.manage`.
- `updateFixedAssetSettings` — upserts the org's single
  `FixedAssetSettings` row. Requires `fixed_assets.settings.manage`.
- `createFixedAsset` — inserts a `FixedAsset` in `status: 'DRAFT'`. For
  `entrySource: 'AP_LINKED'`, requires `sourceReferenceId`; does not post
  anything to `ledger` (the purchase was already posted, or will be, by
  `accounts_payable` itself against whichever account the invoice line
  names). For `MANUAL` / `OPENING_BALANCE` / `IN_KIND_CONTRIBUTION`, no
  posting happens at this step either — capitalization is deferred to
  `acceptFixedAsset` (see below), so a `DRAFT` asset never has a
  half-posted GL footprint. Requires `fixed_assets.assets.manage`.
- `updateFixedAsset` — standard CRUD; rejects a change to
  `acquisitionValue`, `depreciationMethod`, `usefulLifeMonths`,
  `depreciationStartDate`, or any of the three ledger-account fields once
  `status != 'DRAFT'` (the invariant the Testing Strategy checks).
  Requires `fixed_assets.assets.manage`.
All write commands validate their input with a zod schema before any
business logic or persistence, per `packages/core/AGENTS.md` → Commands;
a validation failure returns the standard 400 shape (see API Contracts).

- `acceptFixedAsset` (OT) — transitions `DRAFT` → `ACTIVE`. Reads the
  org's current `FixedAssetSettings.lowValueThresholdAmount`/
  `lowValueThresholdCurrencyId`; converts `acquisitionValue` to that
  currency via `exchangeRate` when the currencies differ (rejecting if no
  rate is resolvable — see Design Decisions); if the converted value is
  `<= threshold`, sets `depreciationMethod: 'ONE_TIME'` (overriding a
  `DRAFT`-stage choice of `STRAIGHT_LINE`, since the policy is mandatory
  once the threshold applies, not optional per-asset) and records
  `lowValueThresholdSnapshot`. **Always** posts one `ledger.
  postJournalEntry` call (type `NORMAL`, `referenceType: 'FixedAsset'`,
  `referenceId: asset.id`) debiting `ledgerAssetAccountId` for
  `acquisitionValue`, crediting — for `AP_LINKED`, the linked
  `VendorInvoiceLine.accountId` (resolved via a soft, try/catch
  `container.resolve` into `accounts_payable`, per Migration &
  Compatibility); for the other three sources, the caller-supplied
  `offsetAccountId` (see Design Decisions, "always posts the
  capitalization entry"). Then either generates the full
  `DepreciationScheduleEntry` set for `STRAIGHT_LINE` (one row per month
  from `depreciationStartDate` for `usefulLifeMonths`, `plannedAmount =
  acquisitionValue / usefulLifeMonths`, a final row absorbing any
  rounding remainder so the schedule sums exactly to `acquisitionValue`),
  or, for `ONE_TIME`, posts a second, separate `ledger.postJournalEntry`
  call in the same transaction (debit `ledgerDepreciationExpenseAccountId`,
  credit `ledgerAccumulatedDepreciationAccountId`, for the full value) and
  inserts one already-`accruedAt`-set `DepreciationScheduleEntry` row
  referencing that second posting. Sets `otDocumentNumber`/`otDate`.
  Rejects if the `FiscalPeriod` covering `acquisitionDate` (for the
  capitalization posting, always attempted) or `depreciationStartDate`
  (for a `ONE_TIME` posting only) is locked — the lock check now applies
  uniformly across all `entrySource` values, since the capitalization
  posting is no longer skipped for any of them. Requires
  `fixed_assets.assets.manage`.
- `reopenFixedAsset` — reverts `ACTIVE` → `DRAFT`. Rejects unless every
  `DepreciationScheduleEntry` for the asset has `accruedAt IS NULL` (see
  Design Decisions). Calls `ledger.reverseJournalEntry` against the
  capitalization entry, deletes the unaccrued schedule rows, clears
  `otDocumentNumber`/`otDate`/`lowValueThresholdSnapshot`/`exchangeRate`.
  Requires `fixed_assets.assets.manage`.
- `accrueDepreciation` — given a target `asOf` date (and optionally a
  single `assetId` to scope to one asset), finds every `ACTIVE`,
  non-`ONE_TIME` asset's `DepreciationScheduleEntry` rows with
  `accruedAt IS NULL` and `periodEndDate <= asOf`, in pages of 500 (see
  Risk Register, "Unbounded accrual scan at scale"). **Each schedule entry is processed in its
  own transaction** — one entry's failure never rolls back or blocks
  already-processed entries earlier in the same run, and a run over many
  assets is not one giant all-or-nothing transaction. For each entry:
  checks the covering `FiscalPeriod.isLocked` *before* attempting to post
  (resolves the prior open Design Decision — see above); if locked, the
  entry is skipped and reported back as skipped, not failed. If unlocked,
  calls `ledger.postJournalEntry` (type `NORMAL`, `referenceType:
  'FixedAssetDepreciationScheduleEntry'`, `referenceId: entry.id`)
  debiting `ledgerDepreciationExpenseAccountId` and crediting
  `ledgerAccumulatedDepreciationAccountId` for `plannedAmount`, then sets
  `accruedAt`/`journalEntryReferenceId` on the entry in the same
  transaction as the post (idempotent: a retried call only ever selects
  rows still matching `accruedAt IS NULL`, so a partial-failure retry
  cannot double-post — see Risk Register). A `postJournalEntry` failure
  for a reason other than a locked period (an unexpected validation
  error) is caught per-entry and reported in a third bucket, `failed`,
  rather than aborting the rest of the run (see API Contracts). If an
  asset's last schedule entry is accrued, sets `FixedAsset.status =
  'FULLY_DEPRECIATED'`. Requires `fixed_assets.depreciation.accrue`.
- `disposeAsset` — given `assetId`, `disposalDate`, `disposalType`, and
  (for `SALE`) `proceedsAmount`: rejects if `status == 'DISPOSED'`.
  **First** runs `accrueDepreciation`'s own due-entry logic scoped to
  this asset, up to `disposalDate` (see Design Decisions, "always catches
  up due-but-unposted depreciation") — locked-period skips here are
  reported back to the caller in the response (see API Contracts), not
  silently absorbed. **Then** rejects if the `FiscalPeriod` covering
  `disposalDate` itself is locked. Computes `netBookValueAtDisposal =
  acquisitionValue - SUM(accrued DepreciationScheduleEntry.plannedAmount
  for this asset)` (actual accrued total after the catch-up step, not the
  original planned schedule — see Design Decisions). Posts one `ledger.
  postJournalEntry` (type `NORMAL`, `referenceType: 'AssetDisposal'`,
  `referenceId` set after the `AssetDisposal` row is allocated its
  `documentNumber`) debiting `ledgerAccumulatedDepreciationAccountId` for
  the accrued total, crediting `ledgerAssetAccountId` for the full
  `acquisitionValue`, and booking `netBookValueAtDisposal` (net of
  `proceedsAmount` for `SALE`) to the org's configured "pozostałe koszty/
  przychody operacyjne" account as a debit (loss) or credit (gain)
  depending on sign; `SALE` additionally debits a cash/receivable account
  for `proceedsAmount`. Inserts the `AssetDisposal` row (allocating
  `documentNumber` via the counter table) and sets `FixedAsset.status =
  'DISPOSED'`. Requires `fixed_assets.disposals.manage`.
- *(Phase 2, not built in Phase 1 — see Design Decisions and Out of
  Scope)*: `revalueAsset`, `transferAsset`.

### Events (`events.ts`)

None in Phase 1. `fixed_assets` neither emits nor subscribes to any
event: AP-linking is a manual cross-reference the accountant sets
explicitly (Design Decisions), not something this module reacts to, and
every GL posting this module makes goes through `ledger.postJournalEntry`
directly (a downward call, consumer → dependency — the same shape
`posting_rules` already uses to call the same command).

**On the Posting Rules Engine interaction — stated honestly, not
assumed.** `postJournalEntry` emits `ledger.journal_entry.posted`
regardless of caller, and Posting Rules Engine's subscriber
(`PostingRulesEngineSubscriber`, `2026-09-06-posting-rules-engine.md` →
Design Decisions) reacts to *any* posted line whose account resolves to
`account.type.accountGroupId` → `jurisdiction: 'PL'`, `code: '4'` — the
check is account-based, not caller-based, so mechanically a
depreciation-expense posting against a zespół-4 account (e.g. `400`
Amortyzacja) is indistinguishable to that subscriber from an Accounts
Payable cost line. That said, `2026-09-06-posting-rules-engine.md`'s own
Design Decisions state its Phase 1 scope as **"AP only as the cost
source. Fixed Assets joins naturally once its own Phase 2 (`transferAsset`/
MPK) is ready"** — meaning the Posting Rules Engine author has not
targeted, and this spec's authors have not confirmed with them, the exact
scenario this module's Phase 1 `accrueDepreciation` creates. This spec
takes the position that the mechanism should work as designed (the
account-group check has no dependency on an MPK dimension being present —
its own priority-hybrid decision falls back to
`DefaultAccountPostingRule` or the `500-99` suspense account when no
explicit dimension exists, exactly the case here, since `fixed_assets`
writes no `journal_entry_line_dimension` row until its own Phase 2), but
does **not** claim this as a verified, zero-risk guarantee. Concretely:
this is called out as an explicit manual-QA step in Testing Strategy
(confirm the reclassification actually fires against a real
`posting_rules` installation before Phase 1 ships), and if it does not
work as expected, the fallback is unchanged and low-cost — depreciation
still posts correctly to `ledger` either way; only the zespół-5
functional-cost view would be incomplete until Posting Rules Engine's own
scope is explicitly extended, which is a one-line change on that side
(dropping the "AP only" qualifier), not a `fixed_assets` change.

### Queries / API

- Every route file under `api/` exports `openApi` (via
  `buildModuleCrudOpenApi` for the `makeCrudRoute` resources, plus
  hand-written schemas for the custom write routes and the two read-only
  lists) per `packages/core/AGENTS.md` → API Routes. See File Manifest
  (`api/openapi.ts`).
- `api/asset-classes/route.ts` — standard `makeCrudRoute` CRUD. URL:
  `/api/fixed_assets/asset-classes`.
- `api/settings/route.ts` — `GET`/`PUT` (not `makeCrudRoute` — a
  singleton, not a list) wired through the mutation guard registry
  (mapped to `update`). URL: `/api/fixed_assets/settings`.
- `api/assets/route.ts` — `makeCrudRoute` list/create (`createFixedAsset`)
  /update (`updateFixedAsset`); soft-delete blocked once
  `status != 'DRAFT'`. URL: `/api/fixed_assets/assets`.
- `api/assets/[id]/accept/route.ts` — custom write route → `acceptFixedAsset`,
  mapped to `update` in the mutation guard registry. URL:
  `/api/fixed_assets/assets/:id/accept`.
- `api/assets/[id]/dispose/route.ts` — custom write route → `disposeAsset`,
  mapped to `update`. URL: `/api/fixed_assets/assets/:id/dispose`.
- `api/depreciation-schedule/route.ts` — read-only `makeCrudRoute` list
  (no `create`) over `DepreciationScheduleEntry`, filterable by `assetId`,
  `accrued` (boolean — `accruedAt IS NULL`/`IS NOT NULL`). URL:
  `/api/fixed_assets/depreciation-schedule`.
- `api/depreciation/accrue/route.ts` — custom write route → `accrueDepreciation`,
  mapped to `update`. URL: `/api/fixed_assets/depreciation/accrue`.
- `api/disposals/route.ts` — read-only `makeCrudRoute` list (no `create`
  — disposals are only created via `disposeAsset`) over `AssetDisposal`,
  filterable by `assetId`. URL: `/api/fixed_assets/disposals`.

### Backend Pages (`backend/fixed_assets/`)

- `assets/page.tsx` (+ `create/page.tsx`, `[id]/page.tsx`) — `DataTable`
  + `CrudForm` for `FixedAsset`, with `<StatusBadge>` for `status` and
  row actions "Accept (OT)" and "Dispose" (both `useGuardedMutation`, not
  `CrudForm` — neither is a field-level edit), gated on
  `fixed_assets.assets.manage` / `fixed_assets.disposals.manage`
  respectively, each behind a confirmation dialog (`useConfirmDialog()`)
  since both are one-way transitions.
- `asset-classes/page.tsx` (+ create/edit) — `DataTable` + `CrudForm` for
  `AssetClass`.
- `depreciation-schedule/page.tsx` — read-only `DataTable` over
  `listDepreciationScheduleEntries`, filterable by asset and accrual
  status, plus a toolbar "Accrue depreciation" action (opens a dialog to
  pick an `asOf` date, calls `accrueDepreciation`, and reports posted vs.
  skipped-locked-period counts via `flash(...)`).
- `disposals/page.tsx` — read-only `DataTable` over `listAssetDisposals`;
  no create form (see API Contracts).
- `settings/page.tsx` — a single-record settings form (not `CrudForm`'s
  list-backed pattern — a bespoke small form calling `useGuardedMutation`
  against `api/fixed_assets/settings`, the same shape
  `ledger`'s non-`CrudForm` `FiscalPeriod` lock action uses) for
  `lowValueThresholdAmount`/`lowValueThresholdCurrencyId`.

## Data Models

### AssetClass

Tenant/org scoped reference list, user-manageable (unlike `ledger.
LedgerAccountGroup`, which is system-seeded). `suggestedUsefulLifeMonths`/
`suggestedAnnualRatePercent` pre-fill `FixedAsset`'s equivalent fields on
create but do not constrain them — an accountant can override per asset.
Soft delete blocked once any `FixedAsset` references the class.

### FixedAssetSettings

One row per organization. `lowValueThresholdAmount`/
`lowValueThresholdCurrencyId` govern the low-value one-time write-off
decision (see Design Decisions); read by `acceptFixedAsset` at the moment
of acceptance and snapshotted onto the asset (`FixedAsset.
lowValueThresholdSnapshot`) so a later change here never retroactively
reclassifies an already-accepted asset.

### FixedAsset

One row per physical asset. `entrySource` determines whether
`sourceReferenceId` is populated (`AP_LINKED` only) and which account
`acceptFixedAsset`'s capitalization entry credits (the linked
`VendorInvoiceLine.accountId` for `AP_LINKED`, a caller-supplied
`offsetAccountId` otherwise) — `acceptFixedAsset` posts that
capitalization entry for **every** `entrySource`, including `AP_LINKED`
(see Design Decisions; AP posts vendor invoice lines only to group 3/4
accounts, never directly to an asset account, so the reclassification
onto the asset register always happens at acceptance). `acquisitionValue`,
`depreciationMethod`, `usefulLifeMonths`, `depreciationStartDate`, and
the three ledger-account fields are immutable once `status != 'DRAFT'` —
enforced by `updateFixedAsset`, the same immutability class `ledger.
LedgerAccount.accountTypeId` uses once posted entries exist, for the
identical reason: changing them after depreciation has started would
silently reinterpret history already posted to GL. `status` moves
`DRAFT` → `ACTIVE` (via `acceptFixedAsset`) → `FULLY_DEPRECIATED` (via
`accrueDepreciation`, automatic once the last schedule entry accrues) or
→ `DISPOSED` (via `disposeAsset`, from either `ACTIVE` or
`FULLY_DEPRECIATED`); `reopenFixedAsset` moves `ACTIVE` back to `DRAFT`,
but only before any schedule entry has accrued (see Design Decisions).

### DepreciationScheduleEntry

One row per depreciation period per asset, generated in full by
`acceptFixedAsset` — never computed on read. `accruedAt`/
`journalEntryReferenceId` are set together, atomically, by
`accrueDepreciation` (or immediately by `acceptFixedAsset` itself for a
`ONE_TIME` asset's single row). An unaccrued row (`accruedAt IS NULL`)
may be deleted and regenerated if the asset's schedule needs correction
before that period is reached; an accrued row never changes — matching
`JournalEntry`'s append-only posture, since each accrued row already has
a real, posted `JournalEntry` behind it.

### AssetDisposal

One row per disposed asset (at most one — enforced by `disposeAsset`
checking `status != 'DISPOSED'` before proceeding). `netBookValueAtDisposal`
is a snapshot computed from the asset's *actual* accrued depreciation at
the moment of disposal, after `disposeAsset`'s own catch-up accrual step
(see Design Decisions) — not the original planned schedule, and not
whatever happened to be accrued before that catch-up ran. An asset
disposed before its schedule completes, or disposed with unrun accrual
still pending, both resolve to the same correct, up-to-date figure. `documentNumber`
is allocated atomically per organization (same allocation pattern as
`ledger.JournalEntry.sequenceNumber`), gapless in disposal order. No
`updatedAt` — immutable once created; a correction is a `ledger` reversal
against `journalEntryReferenceId`, not an edit to this row.

## API Contracts

### `POST /api/fixed_assets/assets`

Standard `makeCrudRoute` create (`createFixedAsset`).

- **Request body**: `{ name, description?, assetClassId?, acquisitionDate,
  acquisitionValue, currencyId, entrySource, sourceReferenceId?,
  depreciationMethod, usefulLifeMonths?, depreciationStartDate,
  ledgerAssetAccountId, ledgerAccumulatedDepreciationAccountId,
  ledgerDepreciationExpenseAccountId }`. `sourceReferenceId` required iff
  `entrySource === 'AP_LINKED'`; `usefulLifeMonths` required iff
  `depreciationMethod === 'STRAIGHT_LINE'`.
- **Response 201**: `FixedAssetDto` — the fields above plus `id`,
  `status: 'DRAFT'`, `updatedAt`.
- **Response 400**: zod validation error, or `sourceReferenceId` present
  without `entrySource: 'AP_LINKED'` (or vice versa).
- **Response 403**: caller lacks `fixed_assets.assets.manage`.

### `POST /api/fixed_assets/assets/:id/accept`

Custom write route (`acceptFixedAsset`), mapped to `update` in the
mutation guard registry.

- **Request body**: `{ otDocumentNumber, otDate, offsetAccountId? }`.
  `offsetAccountId` (FK-id to `ledger.LedgerAccount.id`) is required iff
  the asset's `entrySource !== 'AP_LINKED'` (the capitalization entry's
  credit side); rejected as extraneous otherwise.
- **Headers**: `x-om-ext-optimistic-lock-expected-updated-at` (optional,
  enforced per the repo's default-ON optimistic-lock contract).
- **Response 200**: `FixedAssetDto` with `status: 'ACTIVE'`,
  `otDocumentNumber`, `otDate`, and (if the low-value threshold applied)
  `depreciationMethod: 'ONE_TIME'` reflecting the override.
- **Response 400**: zod validation error (e.g. `offsetAccountId` missing
  for a non-`AP_LINKED` asset, or present for an `AP_LINKED` one), or no
  exchange rate resolvable for the low-value threshold comparison (see
  Design Decisions).
- **Response 409**: `OptimisticLockConflictBody`, or the covering
  `FiscalPeriod` is locked (a distinct, named error code — see
  Internationalization).
- **Response 403**: caller lacks `fixed_assets.assets.manage`.

### `POST /api/fixed_assets/assets/:id/reopen`

Custom write route (`reopenFixedAsset`), mapped to `update`.

- **Request body**: none.
- **Response 200**: `FixedAssetDto` with `status: 'DRAFT'`.
- **Response 409**: at least one `DepreciationScheduleEntry` for this
  asset already has `accruedAt` set (a distinct, named error code — see
  Internationalization).
- **Response 403**: caller lacks `fixed_assets.assets.manage`.

### `POST /api/fixed_assets/depreciation/accrue`

Custom write route (`accrueDepreciation`), mapped to `update`.

- **Request body**: `{ asOf, assetId? }` — zod-validated (`asOf` a valid
  date, `assetId` a valid uuid when present).
- **Response 200**: `{ posted: { assetId, scheduleEntryId,
  journalEntryReferenceId }[], skippedLockedPeriod: { assetId,
  scheduleEntryId, periodId }[], failed: { assetId, scheduleEntryId,
  error }[] }` — three lists, never a bare success boolean, so the caller
  can act on partial completion (see UI/UX). `failed` covers a
  `postJournalEntry` rejection for a reason other than a locked period;
  it is expected to stay empty in normal operation.
- **Response 400**: zod validation error.
- **Response 403**: caller lacks `fixed_assets.depreciation.accrue`.

### `POST /api/fixed_assets/assets/:id/dispose`

Custom write route (`disposeAsset`), mapped to `update`.

- **Request body**: `{ disposalDate, disposalType, proceedsAmount?,
  notes? }`. `proceedsAmount` required iff `disposalType === 'SALE'`,
  rejected otherwise — zod-validated.
- **Response 200**: `AssetDisposalDto` — `{ id, assetId, disposalDate,
  disposalType, proceedsAmount, netBookValueAtDisposal, documentNumber,
  journalEntryReferenceId, catchUpAccrual: { posted: { scheduleEntryId,
  journalEntryReferenceId }[], skippedLockedPeriod: { scheduleEntryId,
  periodId }[] } }` — `catchUpAccrual` surfaces the pre-disposal accrual
  step's own results (see Design Decisions) so a locked-period gap in the
  final net book value is visible to the caller, not silently absorbed.
- **Response 400**: zod validation error.
- **Response 409**: the asset is already `DISPOSED`, or the `FiscalPeriod`
  covering `disposalDate` itself is locked (the catch-up step's own
  per-entry locked periods are reported in `catchUpAccrual`, not a 409).
- **Response 403**: caller lacks `fixed_assets.disposals.manage`.

`AssetClass`/`FixedAssetSettings` list/create/update, and the two
read-only lists (`depreciation-schedule`, `disposals`), follow the
standard `makeCrudRoute` request/response shape (see `packages/core/
AGENTS.md` → CRUD Routes) — not repeated here since none of it is unique
to this module. Both read-only lists use cursor pagination, `pageSize <=
100`, per `AGENTS.md` → Pagination.

## Internationalization (i18n)

All user-facing strings resolve through `useT()` client-side /
`resolveTranslations()` server-side — no hard-coded labels. Keys needed:

- Status labels: `fixed_assets.status.draft`, `.active`,
  `.fully_depreciated`, `.disposed`.
- Entry source labels: `fixed_assets.entry_source.ap_linked`, `.manual`,
  `.opening_balance`, `.in_kind_contribution`.
- Depreciation method labels: `fixed_assets.depreciation_method.
  straight_line`, `.one_time`.
- Disposal type labels: `fixed_assets.disposal_type.sale`, `.liquidation`,
  `.donation`, `.shortage`.
- Action labels: `fixed_assets.actions.accept`, `.dispose`, `.accrue`,
  `.reopen`.
- Error messages: `fixed_assets.errors.period_locked`,
  `.already_disposed`, `.source_reference_required`,
  `.offset_account_required`, `.useful_life_required`,
  `.exchange_rate_unavailable`, `.cannot_reopen_after_accrual`.
- Confirmation copy: `fixed_assets.confirm.accept_body`,
  `.dispose_body`, `.reopen_body` (all interpolate the asset name).
- Accrual result toast: `fixed_assets.accrue.result` (interpolates
  posted/skipped/failed counts).
- Disposal result copy: `fixed_assets.dispose.catch_up_warning`
  (interpolates the skipped-locked-period count from `catchUpAccrual`,
  shown only when non-zero).

## UI/UX

- **Assets list** (`assets/page.tsx`): `DataTable` columns — name, asset
  class, acquisition date/value, `<StatusBadge>` for status, useful life,
  net book value (derived client-side from acquisition value minus
  accrued schedule total, not a stored column). Row actions "Accept
  (OT)" (visible only for `DRAFT`), "Reopen" (visible only for `ACTIVE`
  assets with zero accrued schedule entries — see Design Decisions,
  `reopenFixedAsset`), and "Dispose" (visible only for
  `ACTIVE`/`FULLY_DEPRECIATED`) — all three text-labeled row actions, not
  icon-only, so no `aria-label` is required by the DS rule for icon-only
  controls; the icon each carries is decorative alongside its visible
  label. Each action is `useGuardedMutation(...).runMutation(...)` behind
  `useConfirmDialog()` with `Cmd/Ctrl+Enter` to confirm and `Escape` to
  cancel, passing `retryLastMutation` in the injection context and
  surfacing a 409 via `surfaceRecordConflict` — the same guarded-row-action
  pattern `ledger`'s `FiscalPeriod` lock/unlock action already uses, since
  none of Accept/Reopen/Dispose is a field-level `CrudForm` edit.
- **Asset create/edit form** (`CrudForm`): acquisition fields, an
  entry-source selector that conditionally reveals either a
  `VendorInvoiceLine` picker (`AP_LINKED`) or nothing extra (the other
  three sources), a depreciation-method selector (`ONE_TIME` shown as
  disabled/informational once the low-value threshold applies — decided
  by the server at acceptance, not user-selectable), and three
  `LedgerAccount` pickers. Once `status != 'DRAFT'`, the financial fields
  render read-only with an inline note explaining why (`fixed_assets.
  errors` copy), rather than silently rejecting a submit.
- **Accept (OT) dialog**: collects `otDocumentNumber`/`otDate` and, when
  required, the offset account; on success shows an `<Alert
  variant="success">` summarizing whether the low-value threshold applied.
- **Depreciation schedule view** (`depreciation-schedule/page.tsx`):
  per-asset schedule as a `DataTable`, accrued rows showing a link to
  their `JournalEntry` (via `referenceType`/`referenceId`), unaccrued
  rows showing planned amount and period only. Toolbar "Accrue
  depreciation" action opens a date picker, then reports results via
  `flash('...', 'success')` when everything posted, `flash('...',
  'warning')` when some entries were skipped for a locked period, and
  `flash('...', 'error')` alongside an `<Alert variant="error">` result
  detail when any entry lands in `failed` (see API Contracts) — each
  naming its count.
- **Dispose dialog**: `disposalType` selector, conditional
  `proceedsAmount` field for `SALE`, a read-only computed net-book-value
  preview before submit so the accountant sees the gain/loss impact
  before confirming. On success, if the response's `catchUpAccrual.
  skippedLockedPeriod` is non-empty, an `<Alert variant="warning">` names
  the count so the accountant knows the booked net book value may not
  reflect a still-locked period's depreciation (`fixed_assets.dispose.
  catch_up_warning`).
- **Reopen dialog**: a single confirmation (`useConfirmDialog()`) naming
  the asset and warning that this reverses its capitalization entry —
  hidden entirely once any schedule entry has accrued, so the accountant
  never reaches a 409 in the common case.
- **Disposals list** (`disposals/page.tsx`): read-only `DataTable`, no
  create button (per `EmptyState` copy explaining disposals originate
  from an asset's "Dispose" action).
- **Settings page**: a small `<FormField label error>`-wrapped form for
  the threshold amount/currency, gated behind
  `fixed_assets.settings.manage`.
- All icons from `lucide-react` at the `size-{4}` scale; all status
  coloring via semantic tokens (`text-status-*`, never `text-red-500`-style
  literals) per `.ai/ds-rules.md`.

## Configuration

- `FixedAssetSettings.lowValueThresholdAmount` /
  `.lowValueThresholdCurrencyId` — per-organization, editable via the
  settings page/API; seeded to 10 000 in the organization's base currency
  by `seedDefaults` (see Module Setup). No environment variables or
  global config — this is tenant/org data, not deployment config, per the
  same reasoning `ledger.LedgerAccountGroup` already established for
  jurisdiction-specific values.

## Migration & Compatibility

- Entirely new module (`fixed_assets`); no existing table is modified.
  All new tables ship empty — no backfill.
- Hard dependencies: `ledger` (`postJournalEntry`, `LedgerAccount`,
  `FiscalPeriod`) and `currencies` (`Currency`, `ExchangeRate`) — both
  required at install time, declared in `module.json`'s `requires`.
  `accounts_payable` is a soft, optional reference: `sourceReferenceId`
  is a plain FK-id with no `requires` entry, since an organization can
  use `fixed_assets` with manual/opening-balance entry only, never
  installing `accounts_payable` at all — the `AP_LINKED` entry source and
  its picker UI degrade gracefully (hidden) when `accounts_payable` isn't
  installed, per `packages/core/AGENTS.md` → cross-module touchpoints.
  `acceptFixedAsset`'s capitalization posting resolves the linked
  `VendorInvoiceLine.accountId` through a `try/catch container.resolve`
  soft lookup (the sanctioned pattern for optional-peer service use per
  the checklist) — an `AP_LINKED` asset cannot exist without
  `accounts_payable` having been installed at creation time in the first
  place, so this lookup is expected to always succeed for that source in
  practice, but the code path never assumes the module is present.
- No breaking API changes (new module, new routes only).
- Bulk migration of a large existing fixed-asset register (e.g. from a
  legacy system) is out of scope for Phase 1 — `entrySource:
  'OPENING_BALANCE'` supports one-by-one manual entry only; a bulk-import
  tool is a natural Phase 2 addition once real migration volume is
  observed (see Out of Scope).

## Implementation Plan

### Phase 1: Register, depreciation, disposal

1. Add `AssetClass`, `FixedAssetSettings`, `FixedAsset`,
   `DepreciationScheduleEntry`, `AssetDisposal` entities (with
   `updated_at` on the three user-editable ones) and their migration,
   including the `asset_disposal_sequence` counter table and the indexes
   named in Migration. Add `encryption.ts` declaring
   `defaultEncryptionMaps` for `AssetDisposal.notes` (potentially
   PII-bearing free text — see Data Models, Final Compliance Report) in
   the same step, since the column and its encryption declaration ship
   together, matching `ledger`'s own precedent for
   `JournalEntryLine.contractorSnapshot`.
2. Add `acl.ts` (seven features) and `setup.ts` (`defaultRoleFeatures`
   for `admin`/`employee`, `seedDefaults` for `FixedAssetSettings`); run
   `yarn mercato auth sync-role-acls`.
3. Implement `createAssetClass`/`updateAssetClass`,
   `updateFixedAssetSettings`.
4. Implement `createFixedAsset`, `updateFixedAsset` (with the
   post-`DRAFT` immutability guard on the financial fields).
5. Implement `acceptFixedAsset`: the low-value threshold check
   (including currency conversion via `exchangeRate`) and
   `lowValueThresholdSnapshot`, the capitalization posting for every
   `entrySource` (resolving the AP-linked credit account via a soft
   `container.resolve` into `accounts_payable`), straight-line schedule
   generation (with the rounding-remainder rule on the final row), and
   the second, separate one-time-write-off posting plus immediate one-row
   accrual for `ONE_TIME` assets.
6. Implement `reopenFixedAsset`: the zero-accrued-entries guard, the
   `ledger.reverseJournalEntry` call, and the unaccrued-schedule-row
   cleanup.
7. Implement `accrueDepreciation`: the due/unposted schedule-entry scan
   in pages of 500, the per-entry transaction boundary, the per-entry
   `FiscalPeriod.isLocked` pre-check, the idempotent accrual posting, the
   `failed` bucket for non-lock post failures, and the automatic
   `FULLY_DEPRECIATED` transition.
8. Implement `disposeAsset`: the pre-disposal catch-up accrual step,
   actual-accrued net-book-value calculation (post-catch-up), the
   `AssetDisposal` insert with atomic `documentNumber` allocation, the
   gain/loss posting (including the `SALE` proceeds line), and the
   `DISPOSED` status transition.
9. Implement `api/asset-classes/route.ts`, `api/settings/route.ts`,
   `api/assets/route.ts` + `[id]/accept/route.ts` +
   `[id]/reopen/route.ts` + `[id]/dispose/route.ts`,
   `api/depreciation-schedule/route.ts`,
   `api/depreciation/accrue/route.ts`, `api/disposals/route.ts`, and
   `api/openapi.ts` exporting `openApi` for every route above.
10. Build the backend pages: `assets/` (`CrudForm`/`DataTable` + Accept/
    Reopen/Dispose row actions), `asset-classes/` (`CrudForm`/`DataTable`),
    `depreciation-schedule/` (read-only `DataTable` + Accrue toolbar
    action), `disposals/` (read-only `DataTable`), `settings/` (small
    form).
11. Add regression coverage per Testing Strategy.
12. Add integration test coverage for every custom write route (accept,
    reopen, accrue, dispose) and the two read-only lists, per
    `AGENTS.md:164` / `.ai/qa/AGENTS.md`.
13. Run `yarn generate`, typecheck, focused unit + integration tests, and
    manual QA against a fresh local database (register a manual asset,
    accept it, run accrual across two periods, lock the second period
    and confirm accrual for it is reported as skipped rather than
    failed, dispose the asset and confirm the GL entries and net book
    value).

### Phase 2: Tax depreciation, revaluation, transfer, automation

1. `revalueAsset`, `transferAsset` (the latter depending on
   `journal_entry_line_dimension` shipping first).
2. A second, tax-basis depreciation schedule alongside the book schedule
   this spec builds.
3. An automated depreciation-accrual scheduler, replacing the manual
   trigger.
4. A bulk asset-import tool for large legacy-register migrations.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/fixed_assets/data/entities.ts` | Create | `AssetClass`, `FixedAssetSettings`, `FixedAsset`, `DepreciationScheduleEntry`, `AssetDisposal` |
| `packages/core/src/modules/fixed_assets/migrations/*.ts` | Create | Tables + indexes + `asset_disposal_sequence` counter |
| `packages/core/src/modules/fixed_assets/acl.ts` | Create | Seven ACL features |
| `packages/core/src/modules/fixed_assets/setup.ts` | Create | `defaultRoleFeatures`, `seedDefaults` |
| `packages/core/src/modules/fixed_assets/encryption.ts` | Create | `defaultEncryptionMaps` for `AssetDisposal.notes` |
| `packages/core/src/modules/fixed_assets/commands/*.ts` | Create | All commands listed in Architecture → Commands (including `reopenFixedAsset`) |
| `packages/core/src/modules/fixed_assets/api/asset-classes/route.ts` | Create | `makeCrudRoute` CRUD |
| `packages/core/src/modules/fixed_assets/api/settings/route.ts` | Create | Singleton get/update |
| `packages/core/src/modules/fixed_assets/api/assets/route.ts` | Create | `makeCrudRoute` list/create/update |
| `packages/core/src/modules/fixed_assets/api/assets/[id]/accept/route.ts` | Create | `acceptFixedAsset` write route |
| `packages/core/src/modules/fixed_assets/api/assets/[id]/reopen/route.ts` | Create | `reopenFixedAsset` write route |
| `packages/core/src/modules/fixed_assets/api/assets/[id]/dispose/route.ts` | Create | `disposeAsset` write route |
| `packages/core/src/modules/fixed_assets/api/depreciation-schedule/route.ts` | Create | Read-only list |
| `packages/core/src/modules/fixed_assets/api/depreciation/accrue/route.ts` | Create | `accrueDepreciation` write route |
| `packages/core/src/modules/fixed_assets/api/disposals/route.ts` | Create | Read-only list |
| `packages/core/src/modules/fixed_assets/api/openapi.ts` | Create | `openApi` exports for every route |
| `packages/core/src/modules/fixed_assets/backend/fixed_assets/**/*.tsx` | Create | Backend pages listed in Architecture → Backend Pages |

### Testing Strategy

- Unit: straight-line schedule generation math (even and remainder-row
  cases), low-value threshold boundary (`acquisitionValue` exactly at,
  one below, one above the threshold) including cross-currency comparison
  via `exchangeRate` and rejection when no rate is resolvable,
  `lowValueThresholdSnapshot` isolation from a later `FixedAssetSettings`
  change, post-`DRAFT` immutability rejection on `updateFixedAsset`,
  `reopenFixedAsset` accepted only with zero accrued schedule entries and
  rejected with one, `AP_LINKED` capitalization crediting the linked
  `VendorInvoiceLine.accountId` (with a soft-resolve failure when
  `accounts_payable` isn't installed handled gracefully), `ONE_TIME`
  posting a second, distinct journal entry from the capitalization entry
  (not conflated into one), `disposeAsset`'s pre-disposal catch-up
  accrual actually running before the net-book-value calculation,
  disposal net-book-value calculation from partial (post-catch-up)
  accrual, `accrueDepreciation` idempotency under a simulated retry (no
  double-post) and its per-entry transaction isolation (one entry's
  failure doesn't roll back others in the same run), locked-period skip
  (not error) on `acceptFixedAsset`, `accrueDepreciation`, and
  `disposeAsset`'s catch-up step, atomic `AssetDisposal.documentNumber`
  allocation under concurrency (mirroring `ledger.JournalEntry.
  sequenceNumber`'s own concurrency test).
- Integration: every custom write route's 200/403/409 cases; the two
  read-only lists' filter and pagination behavior; cross-tenant isolation
  (an asset/schedule/disposal from tenant A never appears in tenant B's
  queries, including via `sourceReferenceId` joins).
- Manual QA: the full lifecycle end-to-end (register → accept → accrue
  across a locked and unlocked period → dispose), once for a
  `STRAIGHT_LINE` asset and once for a `ONE_TIME` low-value asset, and
  once for an `AP_LINKED` asset confirming the capitalization entry
  correctly credits the originating `VendorInvoiceLine.accountId`. **A
  required, explicit verification step (not assumed passing — see
  Architecture → Events):** with `posting_rules` installed, confirm its
  subscriber actually reclassifies this module's depreciation-expense
  postings from zespół 4 to zespół 5; if it does not fire, file that as a
  `posting_rules` scope gap rather than a `fixed_assets` defect, and
  confirm depreciation still posts correctly to `ledger` regardless.

## Risks & Impact Review

### Data Integrity Failures

Covered by the Risk Register below (`accrueDepreciation` idempotency,
disposal-before-schedule-completion, threshold-change reclassification).
Every mutating command in this module posts through `ledger.
postJournalEntry`'s own transaction, so a crash mid-command leaves either
a fully-posted journal entry with the local status update, or neither —
`ledger`'s own transaction boundary is reused, not a second one layered
on top.

### Cascading Failures & Side Effects

`fixed_assets` has no subscribers of its own (see Architecture → Events)
and depends on `ledger`/`currencies` only through direct downward
commands — if `ledger.postJournalEntry` rejects (locked period, or an
unexpected validation failure), the calling `fixed_assets` command
returns that rejection to the caller synchronously; no side effect is
left half-applied because the local status/entity update happens in the
same transaction as the posting attempt. Posting Rules Engine reacting to
this module's depreciation postings is a one-way, best-effort
consequence — its own reconciliation sweeper (`ReconcileCostRingCommand`,
`2026-09-06-posting-rules-engine.md`) covers a missed reclassification,
not something `fixed_assets` needs to compensate for.

### Tenant & Data Isolation Risks

Every entity is tenant/org scoped; every query filters by
`organization_id`. `sourceReferenceId` is a plain FK-id, never joined
across tenants (the picker UI only ever queries
`accounts_payable.VendorInvoiceLine` within the caller's own
organization).

### Migration & Deployment Risks

New module, all-new tables, no backfill — see Migration & Compatibility.

### Operational Risks

The manual accrual trigger means a forgotten period-end accrual run is
silent unless someone checks the schedule view — mitigated by the
accrual toolbar surfacing a running "N assets not yet accrued for
&lt;period&gt;" count is a natural Phase 2 dashboard addition, not built
in Phase 1 (see Out of Scope); Phase 1 relies on the accountant's own
month-end checklist, the same operational posture #5663 already accepts
for its own manual `CLOSING`/`OPENING` entries.

### Risk Register

#### Double-posted depreciation accrual on retry
- **Scenario**: `accrueDepreciation` is called twice for the same period
  (e.g. a client retry after a timeout whose server-side call actually
  succeeded), risking two journal entries for the same schedule entry.
- **Severity**: High
- **Affected area**: `fixed_assets.accrueDepreciation`, `ledger` trial
  balance accuracy.
- **Mitigation**: The command's selection query filters
  `accruedAt IS NULL`; `accruedAt`/`journalEntryReferenceId` are set in
  the same transaction as the `ledger.postJournalEntry` call. A retried
  call re-runs the same selection and finds the row already excluded —
  idempotent by construction, not by a separate deduplication check.
- **Residual risk**: A concurrent second `accrueDepreciation` call
  racing the first for the *same* entry (not a sequential retry) could
  both pass the `accruedAt IS NULL` read before either commits — accepted
  for Phase 1 since this command is a manual, low-frequency,
  admin-triggered action (not a hot path), matching the concurrency
  posture already accepted for `ledger.lockFiscalPeriod`.

#### Locked fiscal period silently blocking accrual
- **Scenario**: A period is locked after some, but not all, of that
  period's assets have accrued; the remaining assets' depreciation is
  never posted and nobody notices.
- **Severity**: Medium
- **Affected area**: `fixed_assets.accrueDepreciation`, period-end
  close accuracy.
- **Mitigation**: Skipped entries are returned explicitly in the
  response (`skippedLockedPeriod`), surfaced as a named `warning` toast
  in the UI (not silently swallowed) — resolves the prior open Design
  Decision.
- **Residual risk**: Whether to re-run the skipped entries after
  unlocking is still a manual accountant decision, not automated — an
  automated "catch-up" run is a natural Phase 2 addition alongside the
  scheduler (see Out of Scope).

#### Disposal net book value computed from the wrong basis
- **Scenario**: A naive implementation computes net book value from the
  *planned* schedule total-to-date instead of *actually accrued* entries
  — or from whatever happened to be accrued before disposal, without
  first catching up any due-but-unposted periods — overstating
  accumulated depreciation for an asset disposed with unposted (locked-
  period-skipped, or simply not-yet-run) schedule rows.
- **Severity**: High
- **Affected area**: `fixed_assets.disposeAsset`, disposal gain/loss
  accuracy, balance sheet.
- **Mitigation**: `disposeAsset` first runs its own catch-up accrual for
  this asset up to `disposalDate`, then sums only `DepreciationScheduleEntry`
  rows with `accruedAt IS NOT NULL` for the net-book-value calculation
  (see Architecture → Commands, Data Models, Design Decisions).
- **Residual risk**: A period the catch-up step itself finds locked is
  still reported in `catchUpAccrual.skippedLockedPeriod` rather than
  silently fixed — disposing through a locked period still requires
  unlocking it first, the same posture #5663 takes everywhere else. A
  Phase 2 second (tax) schedule would need its own, separate NBV
  calculation, out of scope here.

#### Low-value threshold compared across mismatched currencies
- **Scenario**: `FixedAsset.currencyId` (e.g. EUR) differs from
  `FixedAssetSettings.lowValueThresholdCurrencyId` (e.g. PLN); comparing
  `acquisitionValue` to `lowValueThresholdAmount` without conversion
  silently misclassifies the asset's depreciation method in either
  direction.
- **Severity**: Medium
- **Affected area**: `fixed_assets.acceptFixedAsset`, low-value
  classification correctness.
- **Mitigation**: `acceptFixedAsset` converts `acquisitionValue` to the
  threshold's currency via `FixedAsset.exchangeRate` before comparing,
  and rejects rather than silently skipping the comparison when no rate
  is resolvable (see Design Decisions).
- **Residual risk**: None identified — an organization whose base
  currency never changes and whose `currencies.ExchangeRate` data is kept
  current (the same assumption `ledger`'s own multi-currency posting
  already depends on) always has a resolvable rate.

#### Unbounded accrual scan at scale
- **Scenario**: An organization with a very large asset register (tens
  of thousands of `ACTIVE` assets) runs `accrueDepreciation` for a period
  where most are due, producing a single API call that scans and posts
  far more rows than a synchronous request should reasonably hold open.
- **Severity**: Medium
- **Affected area**: `fixed_assets.accrueDepreciation`, request latency
  and timeout risk.
- **Mitigation**: The due-entry scan pages in batches of 500 rather than
  loading the full due set at once, and each entry's post is its own
  transaction (see Architecture → Commands) — a request timeout mid-run
  leaves already-processed entries correctly accrued, not rolled back,
  so a re-run naturally continues where it left off (the same idempotency
  the double-post mitigation above already relies on).
- **Residual risk**: Phase 1 still runs the whole scan synchronously
  within the request/command; a background-worker migration for
  organizations that exceed a practical row-count threshold in one call
  is a natural Phase 2 addition once real volume is observed (see Out of
  Scope) — the per-entry transaction and paged-scan design already make
  that migration mechanical rather than a rewrite.

#### Mis-accepted asset with no correction path short of a real disposal
- **Scenario**: An accountant accepts an asset (OT) with a wrong
  `usefulLifeMonths` or the wrong ledger account; without a correction
  path, fixing it would mean either living with wrong data forever or
  recording a fictitious disposal just to reopen the register — falsely
  implying the asset was actually sold or scrapped.
- **Severity**: Medium
- **Affected area**: `fixed_assets.FixedAsset` data quality, `ledger`
  audit trail (a fictitious `AssetDisposal`/reversal pair would otherwise
  be the only workaround).
- **Mitigation**: `reopenFixedAsset` (see Design Decisions, Commands)
  gives a real, GL-correct path back to `DRAFT` — but only before any
  schedule entry has accrued, so it can never be used to quietly erase
  real posted depreciation history.
- **Residual risk**: A mis-acceptance discovered only after the first
  accrual has already posted has no equivalent shortcut — the accountant
  must dispose the asset (an honest record of "this registration was
  wrong," even if awkward) and re-register it correctly. Accepted: once
  real depreciation history exists, this spec's "reversal, not undo"
  posture applies, matching `ledger.JournalEntry`'s own stance.

#### Low-value threshold changed after related assets were already classified
- **Scenario**: An organization lowers `FixedAssetSettings.
  lowValueThresholdAmount` after several assets were already accepted
  under the higher, prior threshold as `ONE_TIME`; a naive
  implementation re-evaluates the threshold on every read and
  incorrectly reclassifies historical assets.
- **Severity**: Medium
- **Affected area**: `fixed_assets.acceptFixedAsset`, audit consistency
  of already-posted depreciation.
- **Mitigation**: `lowValueThresholdSnapshot` is written once at
  acceptance and never re-evaluated; `depreciationMethod` is immutable
  post-`DRAFT` (see Data Models).
- **Residual risk**: None — the snapshot makes this a closed question by
  construction, the same reasoning `contractorSnapshot` already
  established in `ledger`.

#### Orphaned `sourceReferenceId` after the linked AP invoice line is voided
- **Scenario**: An `accounts_payable` invoice line linked to a
  `FixedAsset` is voided or corrected after the link was made;
  `sourceReferenceId` now points at a record whose own posting may have
  been reversed, while the `FixedAsset` itself is unaffected.
- **Severity**: Low
- **Affected area**: `fixed_assets.FixedAsset.sourceReferenceId`
  traceability.
- **Mitigation**: `sourceReferenceId` is a plain FK-id with no
  cross-module ORM relation and no cascading behavior — voiding the AP
  line cannot delete or corrupt the `FixedAsset` row. The UI resolves
  and displays the linked line's current state at view time (a live
  lookup, not a cached copy), so a voided line is visible as such rather
  than silently stale.
- **Residual risk**: No automated reconciliation flags this case in
  Phase 1 (e.g. "asset linked to a reversed invoice line"); accepted
  since it's a rare, audit-visible edge case, not a data-corruption risk.

#### `accounts_payable` uninstalled between linking and acceptance
- **Scenario**: A `FixedAsset` is created with `entrySource: 'AP_LINKED'`
  while `accounts_payable` is installed, but the module is uninstalled
  before `acceptFixedAsset` runs — the soft `container.resolve` lookup
  for the linked `VendorInvoiceLine.accountId` then fails.
- **Severity**: Low
- **Affected area**: `fixed_assets.acceptFixedAsset` for `AP_LINKED`
  assets only.
- **Mitigation**: The soft resolve is wrapped in `try/catch`, per the
  sanctioned optional-peer pattern; a failed resolve rejects
  `acceptFixedAsset` with a clear, named error rather than posting an
  incomplete or wrongly-credited capitalization entry.
- **Residual risk**: The asset stays `DRAFT` until either
  `accounts_payable` is reinstalled or the accountant edits the asset to
  a different `entrySource` (permitted while still `DRAFT`) and supplies
  an `offsetAccountId` manually. Accepted as a rare operational edge case
  no worse than the module simply never having been installed.

## Out of Scope

- **Tax depreciation** (a second, CIT/PIT-basis schedule diverging from
  book depreciation) — Phase 2 (see Design Decisions).
- **`revalueAsset`** (asset appraisal/wycena majątku) — Phase 2.
- **`transferAsset`** (MPK/cost-centre reassignment) — Phase 2, depends
  on `journal_entry_line_dimension` shipping first.
- **Automated depreciation-accrual scheduler** — Phase 1 is a manual
  trigger only (see Design Decisions).
- **Bulk asset-import tooling** for large legacy-register migrations —
  Phase 1's `OPENING_BALANCE` entry source supports one-by-one manual
  entry only.
- **Generic RMK/scheduled-recognition extraction** shared with a future
  Revenue Recognition module — deliberately deferred architectural debt
  (see Design Decisions).
- **Automated "catch-up" re-run of accrual entries skipped for a locked
  period** — Phase 1 requires the accountant to manually re-trigger
  `accrueDepreciation` after unlocking (see Risk Register).
- **Physical inventory / barcode tracking, insurance, and maintenance
  scheduling** for fixed assets — genuinely separate capabilities with no
  event-storming or SPEC-024 basis for inclusion here.

## Final Compliance Report — 2026-09-09

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `sourceReferenceId`, the three `ledgerAccountId` fields, and `currencyId` are all plain FK-ids |
| root AGENTS.md | Filter by organization_id | Compliant | Every entity tenant/org scoped; every query filters accordingly |
| packages/core/AGENTS.md | API routes MUST export openApi | Compliant | Listed per route in Architecture → Queries / API and File Manifest |
| packages/core/AGENTS.md | metadata export with per-method requireAuth/requireFeatures | Compliant | Every route requires the ACL feature named in Access Control |
| packages/core/AGENTS.md | CRUD via makeCrudRoute | Compliant | `asset-classes`, `assets`, `depreciation-schedule`, `disposals` all use it; the five custom write routes (accept/reopen/accrue/dispose) go through the mutation guard registry, mapped to `update`, as non-CRUD actions |
| packages/core/AGENTS.md | Input validated with zod before persistence | Compliant | Stated explicitly for every write command (Architecture → Commands) and every write route's 400 response (API Contracts) |
| packages/core/AGENTS.md | Encryption maps for PII | Compliant | `AssetDisposal.notes` (free text that can plausibly name a person) is declared in `fixed_assets/encryption.ts`; every other field is structured, non-personal data — see Data Models |
| packages/core/AGENTS.md | Optimistic locking on user-editable entities | Compliant | `FixedAsset`, `AssetClass`, `FixedAssetSettings` carry `updatedAt`; `DepreciationScheduleEntry`/`AssetDisposal` are exempt as append-only/immutable, matching `JournalEntry`'s precedent |
| packages/core/AGENTS.md | Cross-module touchpoints name their mechanism, owner, and module-absent behavior | Compliant | `accounts_payable` (soft `try/catch` resolve, degrades to a rejected `acceptFixedAsset` — see Migration & Compatibility, Risk Register) and `ledger`/`currencies` (hard `requires`) are both named explicitly |
| packages/events/AGENTS.md | No direct cross-module calls; events for side effects | Compliant | Zero direct cross-module calls for writes; the one soft read (`accounts_payable` account lookup) uses `try/catch container.resolve`, not an event, which is the sanctioned pattern for optional-peer service *reads* (events are for side effects, not this) |
| packages/cache/AGENTS.md | Cache via DI, tenant-scoped tags | N/A | No cached read endpoints defined in Phase 1 (all lists are direct paginated queries against low-cardinality, indexed tables) |
| packages/ui/AGENTS.md | CrudForm/DataTable, apiCall, semantic DS tokens | Compliant | See Architecture → Backend Pages, UI/UX |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Every field in API Contracts traces to a Data Models entity, including `exchangeRate` and the `reopen` endpoint |
| API contracts match UI/UX section | Pass | Every dialog/form maps to a documented endpoint, including Reopen and the `catchUpAccrual`/`failed` result surfacing |
| Risks cover all write operations | Pass | `createFixedAsset`, `acceptFixedAsset`, `reopenFixedAsset`, `accrueDepreciation`, `disposeAsset` each have at least one Risk Register entry or an explicit justification |
| Commands defined for all mutations | Pass | Every state transition in Data Models → `FixedAsset.status` traces to a named command, including the `ACTIVE → DRAFT` correction path (`reopenFixedAsset`) |
| Cache strategy covers all read APIs | N/A | No caching declared (see Compliance Matrix) |

### Non-Compliant Items

None outstanding — see the 2026-09-09 Review entry in the Changelog for
the items this section previously flagged and how each was resolved
before this Verdict was reached.

### Verdict

- **Fully compliant** — approved for implementation.

## Changelog

### 2026-09-07
- Initial specification (Polish draft), 9 Design Decisions covering
  entry source, depreciation method, schedule materialization, manual
  accrual, RMK/Revenue Recognition boundary, asset register scope, tax
  depreciation deferral, and Phase 2 `revalueAsset`/`transferAsset`.

### 2026-09-08
- Translated to English, matching repo convention; no content changes.

### 2026-09-09
- Added the low-value asset one-time write-off Design Decision
  (`FixedAssetSettings`, `lowValueThresholdSnapshot`, `ONE_TIME`
  depreciation method) — resolves SPEC-024's "Capitalization thresholds"
  High-priority gap and HS-05's "kwota" note.
- Added the disposal/retirement Design Decision (`AssetDisposal`,
  `disposeAsset`) — resolves SPEC-024's "Disposal/Retirement"
  High-priority gap.
- Resolved the prior "Rejection by a locked `FiscalPeriod` on manual
  accrual — handling not yet designed" Design Decision: `accrueDepreciation`
  now pre-checks lock state and reports skipped entries explicitly rather
  than failing.
- Filled in the full Architecture, Data Models, API Contracts, i18n,
  UI/UX, Configuration, Migration & Compatibility, Implementation Plan,
  Risks & Impact Review (with Risk Register), Out of Scope, and Final
  Compliance Report sections against the om-spec-writing template and
  checklist.

### Review — 2026-09-09
- **Reviewer**: Agent (adversarial, fresh-context)
- **Security**: Passed after revision — zod validation is now stated for
  every write command/route (was only stated for `createFixedAsset`);
  `AssetDisposal.notes` is now declared in `encryption.ts` instead of the
  module being asserted PII-free without examining it.
- **Performance**: Passed after revision — `accrueDepreciation`'s
  previously-unbounded per-organization scan now pages in batches of 500
  and is explicitly analyzed against the >1000-row foreground-execution
  question (Risk Register, "Unbounded accrual scan at scale").
- **Cache**: Passed — correctly N/A, no caching required for this
  module's read patterns.
- **Commands**: Passed after revision — three real defects found and
  fixed: (1) `acceptFixedAsset` was written to skip the capitalization
  posting for `AP_LINKED` assets on the mistaken assumption that
  `accounts_payable` could post directly to an asset account; checked
  against `accounts_payable`'s actual `VendorInvoiceLine.accountId`
  validation (group 3/4 only) and corrected — the capitalization posting
  now always happens, crediting the linked line's own account for
  `AP_LINKED`. (2) The locked-period check on `acceptFixedAsset` was
  scoped inconsistently with which postings it actually protects —
  corrected now that the capitalization posting is unconditional. (3) No
  correction path existed for a mis-accepted asset short of a fictitious
  disposal — added `reopenFixedAsset`, permitted only before any accrual.
  Also added the previously-missing `retryLastMutation`/
  `surfaceRecordConflict` wiring for the module's guarded row actions.
- **Risks**: Passed after revision — two real, previously-unmitigated
  gaps closed: disposal computed net book value without first catching up
  due-but-unposted depreciation (`disposeAsset` now runs its own catch-up
  accrual step first), and the low-value threshold comparison didn't
  account for `FixedAsset.currencyId` and `FixedAssetSettings.
  lowValueThresholdCurrencyId` potentially differing (added `exchangeRate`
  and an explicit conversion step). The cross-module claim that Posting
  Rules Engine automatically reclassifies this module's depreciation
  postings in Phase 1 is now stated as a mechanically-sound but
  unconfirmed expectation, not a guarantee, with an explicit manual-QA
  verification step added (Architecture → Events, Testing Strategy) —
  Posting Rules Engine's own spec scopes its Phase 1 to "AP only," and
  that scoping was not coordinated with this document before this review.
- **Verdict**: Approved — the Non-Compliant Items this review round
  surfaced were resolved in the spec body above before this Verdict was
  recorded; see Final Compliance Report for the current, post-fix state.
