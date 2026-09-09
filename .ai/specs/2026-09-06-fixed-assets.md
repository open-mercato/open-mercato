# Fixed Assets — asset register, depreciation, OT, RMK

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(the posting engine this spec books into; `LedgerAccount.parentAccountId`
already exists for the chart-of-accounts hierarchy), [Accounts Payable](2026-09-06-accounts-payable.md)
(the usual asset-entry source — purchase from a vendor)

## TLDR

An asset register, a depreciation schedule, an OT document (asset
acceptance/put-into-service), and monthly depreciation accrual + RMK
(rozliczenia międzyokresowe kosztów — accrued/deferred costs), posting
to GL. Identified as new scope from the event-storming wall (HS-05),
outside #5663's original Month 1-3 categorization.

## Design Decisions (2026-09-07 — resolved)

**Asset entry: both through AP (linked) and manually.** An opening
balance, an in-kind contribution, and migrating existing fixed assets
all need a path independent of AP — Fixed Assets has no hard
dependency on AP being built first.

**Depreciation method: straight-line in Phase 1, pluggable for a
declining-balance method later.** Straight-line covers the large
majority of real cases; `DepreciationCalculator` as a swappable
strategy (SPEC-024) leaves room to extend without a rewrite.

**The depreciation schedule is a materialized entity, not an
on-the-fly calculation.** Consistent with GL's own philosophy
(`JournalEntry` append-only/immutable) — historical depreciation
entries must not change retroactively when someone edits the asset's
parameters later; an audit requirement.

**Depreciation accrual: a manual trigger in Phase 1.** An automated
scheduler is Phase 2 — this reduces operational risk, matching how
#5663 itself deferred automated year-end closing.

**Rejection by a locked `FiscalPeriod` on manual accrual — handling
not yet designed.** Since accrual is a manual trigger, someone can run
it for a period that was just locked — #5663's `postJournalEntry` will
reject the write (see `.ai/specs/2026-08-18-general-ledger-core-engine.md`
→ Design decisions). Still to design: checking the lock state *before*
attempting to post, not just catching the raw command error after the
fact — so the error is legible to whoever triggered the accrual.

**RMK shares a mechanism with the future Revenue Recognition
module — stays inside Fixed Assets for now, as a deliberate
architectural debt.** Structural symmetry: both capabilities are "an
amount recognized gradually on a schedule" — the strongest signal, of
everything considered in this review round, for extracting a generic
mechanism. Even so, it stays here in Phase 1: Revenue Recognition is,
for now, only the name of a future module, with no skeleton of its
own — extracting a shared scheduling mechanism now, with no second,
real consumer in view, risks designing the wrong abstraction (guessing
an API's shape from a single use case). This deliberately accepts the
risk of rewriting RMK once Revenue Recognition actually exists and
reveals whether a shared mechanism genuinely fits both cases — safer
than designing a generic abstraction blind.

**Its own asset register, not just `parentAccountId`.** A fixed asset
needs far more data than a position in the account hierarchy
(acquisition date, value, rate, accumulated depreciation) —
`parentAccountId` is only an optional reporting link to an analytic
account in GL.

**Tax depreciation: deliberately outside Phase 1, but designed for
extension.** Book and tax depreciation can differ under Polish law
(CIT/PIT vs. UoR — the Accounting Act) — Phase 1 handles only book
depreciation, with the gap explicitly flagged and the architecture
ready for a second schedule.

**`revalueAsset` and `transferAsset` — both Phase 2.** Revaluation is
a rare, annual event (wycena majątku — asset appraisal); transfer to a
cost centre (MPK) is waiting on the dimension table
(`2026-09-06-journal-entry-line-dimension.md`) anyway, which is itself
being built as a separate, earlier step ahead of Fixed Assets Phase 2.
