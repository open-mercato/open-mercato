# Posting Rules Engine — cost reclassification engine, account 490

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(the engine posts into it), [Journal Entry Line Dimension](2026-09-06-journal-entry-line-dimension.md)
(a prerequisite — the MPK/cost-centre dimension table, built as a
separate, earlier document, not part of this spec), [Accounts Payable](2026-09-06-accounts-payable.md)
(the first real source of zespół 4 costs)

## TLDR

Automatic reclassification of costs from zespół 4 (costs by nature) to
zespół 5 (functional/costing costs by MPK/cost centre) through
technical account 490 — required by the "P&L consistency" rule from
the wall (both the 4xx and 5xx variants must net to the same result).
Decided 2026-09-06: its own spec, a prerequisite for Accounts Payable's
*production* readiness, not a blocker for building it — sequenced
directly after AP.

## Overview

Polish statutory accounting (art. 40–41 UoR) lets a company keep costs
in two parallel views: **rodzajowy** (zespół 4 — costs by nature: raw
materials, salaries, depreciation) and **kalkulacyjny/funkcjonalny**
(zespół 5 — costs by function/cost-centre: production, sales,
administration). A company that keeps both must, at any point in time,
be able to derive the same P&L result from either view — the "P&L
consistency" invariant from the Event Storming wall. Today, `ledger`
(#5663) posts a zespół 4 entry (via Accounts Payable, `postVendorInvoice`)
and stops there: nothing reclassifies that cost into its zespół 5
counterpart. This module is that reclassification engine — an
automatic, real-time subscriber that mirrors every zespół 4 posting
into zespół 5 through the technical clearing account 490 ("Rozliczenie
kosztów"), tagged with a cost centre (MPK) dimension via
`journal_entry_line_dimension`.

It is deliberately narrow: it does not compute or present the P&L in
either variant (that is #6013/ZSiO's job, a reporting-layer concern,
different owner — see Design Decisions), it does not let a user record
an MPK on a purchase invoice yet (a future AP UI change consumes this
module's `journal_entry_line_dimension` write path once it exists, no
change needed here), and it does not manage the chart of accounts
itself (`ledger` owns that). Its only job is to make sure that once a
zespół 4 entry lands, a correct, tagged zespół 5 mirror entry exists
for it — reliably, not just "usually."

## Problem Statement

Without this engine, three things are true that shouldn't be, once
Accounts Payable goes to production for a Polish tenant that needs
both cost views:

1. **The two variants silently diverge.** A cost posted to zespół 4
   (e.g. account 401, "Zużycie materiałów") has no corresponding
   zespół 5 entry — the functional/costing P&L is permanently missing
   that cost, with nothing to detect or flag the gap.
2. **There is no reliable place to hang a cost centre.** Even once a
   zespół 5 mirror exists, "which department/cost-centre does this
   cost belong to" has no answer unless every cost is manually tagged
   at entry time — unrealistic for Phase 1, where AP has no MPK field
   yet.
3. **A fiscal period can be locked with the two views already
   disagreeing.** #5663's `lockFiscalPeriod` has no concept of zespoły
   or reclassification — it will happily lock a period that has
   zespół 4 postings with no zespół 5 mirror, closing the window to
   fix it later without a reversal.

## Proposed Solution

An event-driven subscriber (`PostingRulesEngineSubscriber`, declared
`persistent: true` — see Design Decisions, "Real-time, not batch")
listens for `ledger.journal_entry.posted` (#5663). It reacts only to
entries of `type: 'NORMAL'` or `'REVERSAL'` (never `OPENING` or
`CLOSING`) and, within them, only to lines whose account resolves to
zespół 4 (`LedgerAccountType.accountGroupId` →
`LedgerAccountGroup{jurisdiction: 'PL', code: '4'}`) and is not the
clearing account itself (see Design Decisions, "Which entries and lines
the engine reacts to"). For each such line it posts one second, linked
`JournalEntry`: a debit to the zespół 5 account named by that source
account's `DefaultAccountPostingRule` and a credit to the technical
clearing account 490, for the same amount (a contra-side line, such as
a storno or a credit note, gets the mirror image) — tagged with a
`CostCenter` dimension (via `journal_entry_line_dimension`) resolved
through a three-step priority hybrid (explicit tag → default rule → the
seeded sentinel `CostCenter`; see Design Decisions). Each
reclassification is keyed on its source *line*, so "already
reclassified" is decided per line. Two supporting mechanisms make the
result converge: a reconciliation sweeper (`reconcileCostRing`) that
finds and repairs any source line left without its reclassification,
and a period-close guard (`posting_rules.lockFiscalPeriod`) that
refuses to lock a fiscal period while any remain. Full reasoning for
every one of these choices is in Design Decisions below; this section
is the map of how they fit together.

## Design Decisions (2026-09-07 — resolved)

**4→5 rules: admin-configured from Phase 1 — no hardcoded default
template, because account numbering isn't standardized across
tenants.** An earlier draft of this decision assumed a ready-made
Polish default template (e.g. "401 → 500"), on the premise that
#5663 already seeds a standard chart of accounts to hang it off of.
**Corrected (2026-09-14):** #5663 seeds only `LedgerAccountGroup`
(the zespoły 0–8 buckets, not real, postable accounts); no
`LedgerAccount` row is seeded for any tenant, and importing a real
chart of accounts (a separate, `ledger`-owned concern — see Out of
scope) deliberately lets each accountant keep their own account
numbering, the same way Comarch Optima/Symfonia/enova365 all let a
company customize its imported plan kont. There is therefore no
universal "401"/"500" this module could hardcode a seed template
against — what one tenant calls 401, another may call something
else entirely. `createDefaultAccountPostingRule`/
`updateDefaultAccountPostingRule` therefore ship in **Phase 1**,
not deferred: without them, a tenant with its own numbering would
have no way to ever create a single 4→5 mapping. See
"`DefaultAccountPostingRule` does double duty" below for the
resulting entity shape (it now carries `updatedAt` from its own
Phase 1 migration, since Phase 1 itself writes to it).

**Detecting "zespół 4" resolved through
`LedgerAccountType.accountGroupId`.** Instead of parsing the `slug`
(doesn't generalize beyond Poland — German SKR03, French PCG, and US
GAAP each use different schemes), the engine checks relationally:
`account.type.accountGroupId` points to a `LedgerAccountGroup` with
`jurisdiction: 'PL'`, `code: '4'` (see
`.ai/specs/2026-08-18-general-ledger-core-engine.md` → Design
decisions, Architecture → Entities). `LedgerAccountGroup` is a
per-jurisdiction reference dictionary, seeded, not tenant-editable —
Phase 1 seeds only `PL` (zespoły 0–8); other jurisdictions (the US and
onward, per the platform plan: country plugins) are later pure data,
zero schema change. `accountGroupId` is immutable once the first entry
is posted to an account of that type, same as `normalBalance`.

**The dimension table (`journal_entry_line_dimension`) is a separate,
earlier document, not part of this spec.** Originally planned as
"Phase 1 of this spec" — split out after review. **Correction
(2026-09-08)**: the earlier justification ("#5663 already treats this
as a separate change") was a misquote — #5663's actual text says the
dimension table and this engine "ship together... in a future spec"
(one, shared document). The real justification for splitting it out:
the table has more than one independent consumer — this engine now,
and, independently of it, `2026-09-06-fixed-assets.md` Phase 2
(`transferAsset`) later — so it lives as its own, "empty" schema
module rather than inside `posting_rules`, so that Fixed Assets
doesn't have to take a hard dependency on this entire engine just to
write one dimension tag (full justification:
`2026-09-06-journal-entry-line-dimension.md` → Where this document's
need came from). This spec **consumes** the finished table (through
its own commands, see this document's Cross-module integration — not
by reading its entities directly), it does not build it.

**Real-time, not batch — through an event, not a shared
transaction.** The ZSiO invariant from the wall requires consistency
"at any point in time" — an end-of-month batch would leave a window
where the 4xx and 5xx variants disagree. An earlier version of this
decision assumed "the same transaction" as the cost's source
`postJournalEntry` — unreachable in this system:
`packages/events/AGENTS.md` bans direct cross-module calls, and the
only permitted mechanism is events + subscribers, so a subscriber's
failure can neither block nor roll back the emitting command.
Resolution: #5663's `postJournalEntry` and `reverseJournalEntry` emit
`ledger.journal_entry.posted` after commit;
`PostingRulesEngineSubscriber` receives it and posts the
reclassification with its own `postJournalEntry` call (`referenceType:
'PostingRulesEngineReclassification'`, `referenceId` of the source
*line* — see Design Decisions, "The engine's own postings carry a
distinct `referenceType`"). **Corrected 2026-10-09 (re-review M3):**
an earlier version called the event "ephemeral — immediate, in-process,
no retry". #5663 has since corrected that (core engine → Events,
2026-09-18): persistence is a property the *subscriber* declares
(`metadata.persistent`), not the event, and #5663 names this subscriber
as one that "must subscribe with `persistent: true`". It therefore
declares `persistent: true` (`packages/events/AGENTS.md` → Subscription
Types: retried on failure). The payload is `{ journalEntryId,
sequenceNumber, type, operationDate, organizationId, tenantId,
referenceType, referenceId, lines: { id, accountId, debit, credit }[]
}`, so the subscriber does not re-read the entry's lines; it reads the
`JournalEntry` once, only for `currencyId`, which the payload does not
carry (⚠ NEEDS HUMAN CONFIRMATION: ask #5663 to add `currencyId` to the
payload, which would remove that read).

Because delivery is retried, **the subscriber must be idempotent**, and
that is a requirement of this module, not something the event
provides: a retry after a partial success (the reclassification
posted, a later step such as `setJournalEntryLineDimension` failed)
must neither post a second reclassification nor leave the first one
untagged. Per source line the subscriber (1) takes a transaction-scoped
advisory lock on the source line id and, in that same transaction,
(2) looks for an existing reclassification keyed on that line (the
marker below) and posts only if there is none — using the
composed-transaction mechanism of #5663's `postJournalEntry` so that
lock and posting commit together (⚠ NEEDS HUMAN CONFIRMATION against
#6340) — and (3) always runs the tag step as "ensure the `CostCenter`
tag exists", whether or not step (2) posted anything. The sweeper and
the subscriber share this one code path, so a retry, a concurrent
sweeper run and a re-delivery converge on one reclassification per
line. Errors that a retry cannot fix (clearing account unset, no
target account resolvable, locked period) are logged with their named
error and the handler returns without throwing; the line stays in the
sweeper's and the guard's result set. Only transient errors (database,
lock timeout) are thrown, so that delivery retries them.

**A repair mechanism: `ReconcileCostRingCommand` (a sweeper).** A
scheduled / CLI-invoked command that finds source lines (see "Which
entries and lines the engine reacts to") with no reclassification
keyed on them and posts the missing ones through the same idempotent
code path as the subscriber. Persistent delivery retries transient
failures, but it cannot repair what a retry cannot fix: a line posted
before the module was enabled or before an admin configured
`PostingRulesSettings`, or one whose handler returned on a named
configuration error. **Corrected 2026-10-09:** this paragraph used to
justify the sweeper by the "no-retry risk of the ephemeral
subscriber".

**Which entries and lines the engine reacts to — an explicit trigger
set (added 2026-10-09, re-review M1).** #5663 produces more contra-side
zespół 4 lines than the storno of a source cost, and an earlier draft
treated every one of them as a storno of an engine reclassification.
The *source set* is now defined once, and the subscriber, the sweeper's
finder and the period-close guard all use that same definition. A line
is in the source set when:

- its entry's `type` is `NORMAL` or `REVERSAL`. `CLOSING` and `OPENING`
  are skipped: the year-end closing entry credits each 4xx account
  against 490 (or 860), and reclassifying those lines would wipe the
  functional view at year end and post against the clearing account
  again; an opening entry restates balances, it is not a cost incurred.
  The event payload's `type` makes this a check on the event itself.
- its entry's `referenceType` is not
  `'PostingRulesEngineReclassification'` (the engine's own output);
- its account resolves to zespół 4 **and is not
  `PostingRulesSettings.clearingAccountId`**. Account 490 resolves to
  `code: '4'` like any other zespół 4 account, so without this rule any
  entry touching it that the engine did not post — a closing entry, a
  manual adjustment, a `REVERSAL` of one of the engine's own
  reclassifications — would enter the reclassification path. The
  clearing account is never a source.

A contra-side line in the source set that does *not* come from a
reversal of a reclassified cost — a vendor credit note, a 4xx→4xx
reclassification, or a `REVERSAL` whose original was never
reclassified — has no reclassification to mirror. It is handled like a
normal-side line with the direction inverted: target account and
`CostCenter` are resolved through the rule and the hybrid as for a
cost, then posted as credit target account / debit clearing account.
Nothing is rejected for want of an original; if the original is
reclassified later (by the sweeper), the two converge to the same net
result.

**The engine's own postings carry a distinct `referenceType`, and the
marker points at the source line — this is what stops
re-reclassification, the sweeper's collision with storno, and
per-line double-posting.** An earlier draft relied on account-group
codes alone to keep the subscriber from reacting to its own output,
assuming account 490's `LedgerAccountType.accountGroupId` would
resolve to a non-existent "zespół 4x9" — real bug caught during
review: #5663 seeds only single-digit `LedgerAccountGroup.code`s
(zespoły 0–8), so a correctly typed account 490 resolves to `code: '4'`
like any other zespół 4 account. **Corrected (2026-09-14):** every
reclassification this engine posts carries `referenceType:
'PostingRulesEngineReclassification'` (not the generic
`'JournalEntry'`), and the subscriber ignores any entry that already
carries it. The same marker fixes a second bug: the finder used to
treat "any entry pointing back to the source with the generic
reference type" as proof of an existing reclassification, but
#5663's `reverseJournalEntry` links a `REVERSAL` entry back to what it
reverses the same way (`type: 'REVERSAL'`, `referenceType:
'journal_entry'`), so a reversed-but-never-reclassified entry satisfied
that predicate and was wrongly skipped. **Corrected (2026-10-09,
re-review M2):** `referenceId` is the id of the *source
`JournalEntryLine`*, not of the source entry. The engine reclassifies
per line, so "already reclassified" has to be decided per line; an
entry-level marker cannot tell a fully reclassified multi-line entry
from a partly reclassified one (a 401 line reclassified, a 402 line
rejected for want of a rule: once the settings are fixed the entry
still looks done, and the period could be locked with line 402
unreclassified). `referenceId` is a `uuid` column in #5663, which a
line id satisfies; no `ledger` schema change. A contra-side mirror is
keyed on the contra line's own id the same way. `referenceType` is a
free-form field in #5663 (unlike the closed `JournalEntry.type` enum) —
other modules already write their own source-entity name there.

**Reversals are mirrored, not duplicated — the subscriber checks each
line's side against its account's `normalBalance`.** An earlier draft
reacted identically to every posted line whose account resolves to
zespół 4, regardless of debit/credit side — real bug caught during
review: #5663's `reverseJournalEntry` "posts a new REVERSAL entry with
inverted lines," so a storno of a cost (a credit to a normally-debit
zespół 4 account) would have been reclassified the *same* way as the
original cost, doubling the cost in the functional P&L instead of
correcting it. **Corrected (2026-09-14):** the subscriber compares each
source line's side against `LedgerAccountType.normalBalance`; a line on
the *normal* side (a cost incurred) is reclassified as described
(debit zespół 5 / credit 490). **Corrected (2026-10-09, re-review
M1/M2):** a contra-side line in a `REVERSAL` entry is mirrored (credit
zespół 5 / debit 490), reusing the original reclassification's target
account and `CostCenter` rather than re-running the hybrid (Invariant
5: re-resolving could credit the correction to a different department
than the original charged). The original is found per line, not per
entry: from the reversal entry (`referenceType: 'journal_entry'`,
`referenceId` = the reversed entry) take the reversed entry's
source-set lines on the same account with the same amount that have a
reclassification keyed on them, and pair them with the reversal's
contra lines in a stable order (by line id on both sides). Contra-side
lines with no such original (a `NORMAL` credit note, or a reversal
whose original was never reclassified) follow the inverted-direction
rule in "Which entries and lines the engine reacts to". Residual
limitation, disclosed: #5663 records no per-line link between a
reversal line and the line it reverses, so for several lines with the
*same* account and amount but different explicit `CostCenter` tags the
pairing can swap which of them a mirror reuses; ledger totals are
unaffected, only the cost-centre attribution between those equal lines.
⚠ NEEDS HUMAN CONFIRMATION: closing this fully needs
`reverseJournalEntry` to record which original line each reversal line
inverts (a #5663 change).

**Period-close guard: a dedicated entry point in `posting_rules`, not
a subscriber veto.** A subscriber cannot block #5663's
`lockFiscalPeriod` — subscriber errors are only logged, never
propagated to the emitting command (see the event-driven-communication
decision above). Instead, `posting_rules` (the consumer, depending on
`ledger`) gets its own, higher-level period-close command, which first
checks `findUnreclassifiedEntries() === 0` for the given period and
only then calls the existing `ledger.lockFiscalPeriod` — an ordinary
downward call (consumer → dependency), the same way the engine already
calls `postJournalEntry`. `ledger.lockFiscalPeriod` itself knows
nothing about zespoły or account 490 and works standalone when
`posting_rules` isn't installed (e.g. a different jurisdiction) — with
no guarantee of this guard in that installation.

**Phase 1: AP only as the cost source.** Fixed Assets joins naturally
once its own Phase 2 (`transferAsset`/MPK) is ready.

**A locked `FiscalPeriod` stops the entire 4→5 reclassification
chain, not just the source posting.** Since reclassification is its
own, separate `postJournalEntry` call (see the event-driven-
communication decision above — not the same transaction as the source
posting), a locked period rejects independently: the source posting
(AP/Fixed Assets) *and* — in a separate call — this engine's
account-490 reclassification, if the source `postJournalEntry` had
already committed just before the period was locked. These are two
independent invocations of the same rule in #5663
(`.ai/specs/2026-08-18-general-ledger-core-engine.md` → Design
decisions), not one shared point of failure. Still to design once the
full Architecture is written: whether the rejection propagates back to
the source call with a legible message, or this engine needs its own,
additional error handling — mitigated in practice by the period-close
guard above, meant to prevent a period from being locked with
unreclassified entries before this ever becomes a problem.

**The MPK (cost centre) dimension: a priority hybrid — Explicit Line
Dimension → `DefaultAccountPostingRule` → a real, seeded sentinel
`CostCenter`, not a fabricated suspense account.** Where does the MPK
for a cost line come from, given that AP doesn't yet have a field to
set it manually: the engine checks, in order — (1) whether the line
already has an MPK dimension recorded in `journal_entry_line_dimension`
(entered manually in AP, once that field exists); (2) if not, whether a
`DefaultAccountPostingRule` exists for that account (a new reference
entity, e.g. a mapping like "account 401 → MPK Administration"); (3)
if not — whether because no rule exists at all, or a rule exists but
its `defaultCostCenterId` is `null` — the line is tagged with a
seeded, non-deletable sentinel `CostCenter` (`code: 'UNALLOCATED'`,
see Module Setup) instead of being left untagged, which
`journal_entry_line_dimension`'s own `dimensionIds: z.array(...).min(1)`
validator would reject outright (see Final Compliance Report — a real
review-caught bug, not a hypothetical). **Corrected (2026-09-14):**
an earlier draft of this decision posted case (3) to a fabricated
"technical suspense account 500-99" that names no real
`FixedAssetSettings`-style settings field and does not correspond to
any real Polish plan kont checked against this project (zespołu 5
accounts don't reserve a `-99` suffix for "unallocated" — that
suffix is conventionally NKUP, a distinct, tax-specific meaning, in
real charts of accounts this project has checked). The *account* a
case-(3) reclassification targets is a separate question from the
*tag*: when no `DefaultAccountPostingRule` exists at all, the engine
also has no known target zespół-5 account, so it posts to
`PostingRulesSettings.unallocatedCostAccountId` (see "New settings:
PostingRulesSettings" below) instead; when a rule exists but only its
`defaultCostCenterId` is unset, the correctly-resolved `targetAccountId`
from that rule is kept, and only the tag falls back to the sentinel
`CostCenter`. This lets the engine work from day zero once an admin has
configured `PostingRulesSettings` (see below) and at least the
sentinel `CostCenter` exists (seeded automatically — see Module
Setup) — without waiting for an MPK field in the AP invoice UI; once
that field exists, it simply starts feeding path (1), with no change
to the engine.

**The sentinel `CostCenter` is protected by the commands, not by a flag
(added 2026-10-09, re-review m3).** The sentinel is "a normal row like
any other, distinguished only by its well-known `code`", with no
"system row" column, so the guarantee that hybrid step (3) always has
something to tag with has to come from the commands: `updateCostCenter`
rejects any change to `code` or `isActive` on the row whose `code` is
`'UNALLOCATED'`, `deleteCostCenter` rejects deleting it, and the
generated `DELETE` route reaches the same command, so it is covered
too. `seedDefaults` looks the sentinel up by `code` among non-deleted
rows and creates it only when absent, so a re-run never adds a second
one. The same fallback applies when a rule's `defaultCostCenterId`
points at a cost centre that has since been deactivated or deleted: the
engine treats it as unset and uses the sentinel (the tag is a
point-in-time value, Invariant 5). An explicit
`journal_entry_line_dimension` tag on the source line is honoured as
written, even when that cost centre is now inactive.

**`DefaultAccountPostingRule` does double duty: the 4→5 account mapping
and the default cost centre, in one row.** Two earlier decisions each
named a need for this entity without specifying its actual shape:
"4→5 rules" (above) needs, for a given zespół 4 account, which
zespół 5 account to debit; the MPK priority hybrid (below) needs, for
a given account, which `CostCenter` to default to when nothing more
specific is set. Splitting these into two tables would mean looking up
two rows per reclassification for what is, in practice, one fact per
source account ("this cost, by default, goes to *this* function, in
*this* department"). One entity instead:
`DefaultAccountPostingRule { id, tenantId, organizationId,
sourceAccountId (FK-id to ledger.LedgerAccount, a zespół 4 account),
targetAccountId (FK-id to ledger.LedgerAccount, a zespół 5 account),
defaultCostCenterId (FK-id to this module's own CostCenter, nullable —
some accounts may have no sensible default and always fall through to
the sentinel `CostCenter` — see the MPK hybrid above), createdAt,
updatedAt }`. **Corrected (2026-09-14):** an earlier draft carried no
`updatedAt`, matching `LedgerAccountGroup`'s immutable-seed-row shape
— the wrong precedent once account numbering isn't standardized (see
"4→5 rules" above): `createDefaultAccountPostingRule`/
`updateDefaultAccountPostingRule` ship in **Phase 1**, not Phase 2, so
this entity is user-editable from its own first migration and needs
`updatedAt` (default-ON optimistic lock, per
`packages/core/AGENTS.md`'s standard column contract) the same way
`CostCenter` already has it — not the `LedgerAccountGroup` shape this
document originally borrowed. Requires
`posting_rules.cost_centers.manage` (the same feature already gates
`CostCenter`, since both are the same "reference data an accountant
configures" concern).

**New settings: `PostingRulesSettings` — account 490 and the
unallocated-cost account are pointed at, never assumed by code.**
Neither the technical clearing account ("account 490" in the TLDR/
Overview prose) nor the unallocated-cost fallback account names an
actual settings field anywhere in this document until now — the same
gap `2026-09-06-fixed-assets.md` already closed for its own "a cash/
receivable account" prose with `FixedAssetSettings.saleProceedsAccountId`.
Same posture here: `PostingRulesSettings { id, tenantId,
organizationId, clearingAccountId (nullable FK-id to
ledger.LedgerAccount, no default), unallocatedCostAccountId (nullable
FK-id to ledger.LedgerAccount, no default), updatedAt }`. Both start
`null` — not seeded with a default, because there is no tax-law- or
convention-derived starting figure once account numbering is entirely
the tenant's own choice (see "4→5 rules" above); an admin sets them
once, after importing or otherwise creating their own chart of
accounts, through a settings page/API upserted via
`updatePostingRulesSettings` (not user-creatable directly, matching
`FixedAssetSettings`'s own "upserted, seeded empty on organization
creation" precedent — see Module Setup). The subscriber and
`reconcileCostRing` both reject with a named error, rather than
guessing or silently skipping, if the relevant one is unset when they
run (see Events & Subscribers, Risks).

**`CostCenter` is a new, minimal master-data entity — Phase 1 needs
somewhere for an MPK to actually exist.** `journal_entry_line_dimension`
(#5972) defines the *tagging* mechanism (`dimensionType: 'CostCenter'`,
`dimensionId: string`) but, checked directly against that document's
own Data Models and Architecture, never defines what a valid cost
centre *is* — `dimensionId` there is a bare `string` with no FK, no
relation, and no owning entity anywhere in that spec, explicitly a
reference for its own command to filter by, nothing more. That is a
description of what the document does, not a quote from it — no
document in this project phrases the distinction this way itself.
Without a real entity behind
`dimensionId`, `DefaultAccountPostingRule.defaultCostCenterId` above
has nothing concrete to point at, and there is no way to even create
"MPK Administration" for the seed data to reference. Minimal shape:
`CostCenter { id, tenantId, organizationId, code, name, isActive,
createdAt, updatedAt, deletedAt }` — a plain, tenant-editable reference
list (unlike `LedgerAccountGroup`, cost centres are inherently
company-specific: two tenants never share the same department
structure). Ships with basic CRUD (`createCostCenter`/
`updateCostCenter`) and a simple backend list page in Phase 1 — not
scope creep: without it, nobody can create the cost centre values
Phase 1's own seed data and (once it exists) AP's MPK field need to
reference.

**Generating the P&L in both variants belongs to task #4/ZSiO, not
this spec.** This spec is responsible only for the source data
existing (correctly reclassified, tagged entries) — the report itself
is a reporting-layer concern, a different owner. **Update
(2026-09-17):** that owner is now drafted —
`2026-09-17-annual-financial-statements.md` reads this spec's own
account-490 invariant as the thing it *validates* (not re-derives) when
generating RZiS's two variants: a same-net-result check between the
porównawczy (zespół 4) and kalkulacyjny (zespół 5) variants, failing
generation with a diagnostic pointing back here if `reconcileCostRing`
hasn't caught up yet. Not yet reviewed.

## User Stories

- As an accountant closing the month, I need every zespół 4 cost to
  have a corresponding, correctly-tagged zespół 5 mirror entry, so
  that the functional P&L and the by-nature P&L agree without manual
  reconciliation work.
- As an accountant, when a cost has no cost-centre information
  anywhere (no explicit tag, no default rule), I need it posted
  somewhere visible and flagged ("Unallocated costs"), not silently
  dropped or guessed at, so I know it needs manual review before the
  period closes.
- As an operator closing a fiscal period, I need the close to fail
  with a clear reason if any zespół 4 posting in that period is still
  unreclassified, rather than silently locking a period the two P&L
  variants already disagree on.
- As a developer running Accounts Payable in a non-Polish tenant
  (`posting_rules` not installed), I need `ledger.postJournalEntry`
  and `ledger.lockFiscalPeriod` to work exactly as #5663 specifies,
  with zero behavior change — this module must be fully optional.

## Invariants

Properties that must always hold once this engine is running for a
tenant with `posting_rules` installed:

1. **Reclassification completeness (eventual, not immediate).** Every
   line in the source set (see Design Decisions, "Which entries and
   lines the engine reacts to") eventually has exactly one
   reclassification entry keyed on that line — debit the
   `DefaultAccountPostingRule`-mapped zespół 5 account / credit the
   clearing account for a normal-side line, the mirror image for a
   contra-side line — for the same amount. "Eventual" because the
   subscriber can be delayed, retried, or return on a named
   configuration error; `reconcileCostRing` is what makes this true
   within a bounded window rather than indefinitely. "Exactly one" is
   the idempotency requirement of Design Decisions, "Real-time, not
   batch".
2. **The clearing account's engine-posted balance is net, not zero.**
   Over the entries this engine posted (those carrying the marker), the
   clearing account's credit balance equals the sum of normal-side
   source lines reclassified minus the sum of contra-side source lines
   mirrored, over the same source set. **Restated 2026-10-09** (re-review
   m1): the engine does post a debit to the clearing account, on the
   contra side (a storno or credit note), so "490 never receives a debit
   from this engine" no longer holds; the by-nature variant still needs
   the original zespół 4 balances left untouched. The check is
   restricted to the engine's own entries on purpose: other entries
   legitimately post to the same account (the year-end closing entry, a
   manual adjustment), so the account's *total* balance is not expected
   to equal this sum. Clearing the account to zero at year end is the
   standard period-end P&L-closing procedure, not something this module
   does (see Out of scope). A mismatch between the engine-posted net and
   the source-set net indicates a mapping or amount bug.
3. **A reclassification entry is never the cause of a re-reclassification,
   and the clearing account is never a source.** The subscriber and
   the finder ignore (a) any entry that carries `referenceType:
   'PostingRulesEngineReclassification'` — a positive marker on the
   engine's own output, not a claim about which
   `LedgerAccountGroup.code` an account happens to resolve to (account
   490 legitimately resolves to `code: '4'` like any other zespół 4
   account — **corrected 2026-09-14**); (b) any line on
   `PostingRulesSettings.clearingAccountId`; and (c) entries of type
   `OPENING` and `CLOSING` (**extended 2026-10-09**, re-review M1).
4. **A fiscal period cannot be locked through `posting_rules.lockFiscalPeriod`
   while `reconcileCostRing` would find unreclassified entries in it.**
   Locking through `ledger.lockFiscalPeriod` directly bypasses this
   guard by design (see Design Decisions) — the invariant only holds
   for callers that go through this module's guard.
5. **`CostCenter`/`DefaultAccountPostingRule` changes never rewrite
   history.** The target account and the `CostCenter` tag of a
   reclassification are both fixed when it is posted and never
   recomputed: deactivating or deleting a `CostCenter`, or changing a
   `DefaultAccountPostingRule`, affects only reclassifications made
   after the change, and a contra-side mirror reuses the original's
   target account and tag rather than the current rule's
   (**corrected 2026-10-09**: the "(Phase 2)" qualifier is dropped, rule
   updates ship in Phase 1, and the target account is now covered as
   well as the tag).

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| End-of-month batch reclassification | Rejected: leaves a window where the two P&L variants disagree "at any point in time," the exact invariant the wall requires (see Design Decisions, "Real-time, not batch") |
| Reclassify inside the same transaction/command as the source posting (e.g. `postVendorInvoice` calls this engine directly) | Rejected: requires a direct cross-module call from `accounts_payable` (or any future cost source) into `posting_rules`, which `packages/events/AGENTS.md` bans; also couples every cost-source module to this engine's existence, defeating the "AP works standalone without `posting_rules`" requirement (see Design Decisions, "Real-time, not batch") |
| A subscriber-side veto on `lockFiscalPeriod` (subscriber returns an error that blocks the lock) | Rejected: subscriber errors are only logged, never propagated to the emitting command — architecturally impossible in this event system, not just undesirable (see Design Decisions, "Period-close guard") |
| Store the 4→5 mapping and default cost centre as two separate reference tables | Rejected: both are one fact per source account in practice; two tables means two lookups and two places to keep in sync for no separation of concerns that matters here (see Design Decisions, "`DefaultAccountPostingRule` does double duty") |
| Let `CostCenter` be a free-standing string with no entity at all (just whatever `AP` or a rule types in) | Rejected: nothing to reference from `DefaultAccountPostingRule`, no way to rename a department consistently, no place to mark one inactive — `journal_entry_line_dimension` (#5972) explicitly leaves this identity question to its consumers, and this is the first consumer that needs an answer |

## Literature & Prior Art

Per the project's financial-spec-writing-process, this section records
what the accounting/data-modeling literature and comparable real
systems say about the two core mechanisms above — the 4→5
reclassification itself, and the `CostCenter`/`DefaultAccountPostingRule`
shape — rather than re-deriving them from a Polish-only quirk. All
citations below were verified against full extracted text (not chapter
titles alone); see `2026-09-08-financial-module-knowledge-base.md` §3 for the
verification trail.

**The reclassification mechanism (zespół 4 → zespół 5) is a real,
internationally-recognized pattern, not a Polish-only oddity.** Kieso,
*Intermediate Accounting*, 17th Ed., IFRS Insights supplement to Ch. 4
("Income Statement and Related Information"), pp. 4-45–4-46, confirmed:
"Companies are required to present an analysis of expenses classified
either by their nature... or their function," and notes that "many
companies believe both approaches have merit. These companies use the
function-of-expense approach on the income statement but provide detail
of the expenses... in the notes," adding that the IASB/FASB discussion
paper on financial statement presentation "also recommends the dual
approach." Account 490's zespół 4 → zespół 5 reclassification is exactly
this dual approach implemented as a ledger mechanism: zespół 4 captures
expenses by nature (as incurred), and this engine derives the
zespół 5 function-of-expense view from it in real time, rather than
forcing a choice between the two presentations.

**`DefaultAccountPostingRule` matches Fowler's Derived Account pattern,
not a new invention.** Fowler, *Analysis Patterns*, §6.15.2 "Derived
Accounts," pp. 130–131 (verified by full-text search — neither Fowler
nor Hay use "control account" or "subsidiary ledger" verbatim anywhere
in either book, so this is the closest structural analog, not a
terminology match): a Derived Account is one whose balance is computed
by a filter over entries carrying a given attribute, rather than being
posted to directly. `DefaultAccountPostingRule`'s zespół 5 side is
exactly this — its balance is never posted to directly by any
cost-source module; it only ever receives entries the engine derives
from a zespół 4 posting matching the rule's `sourceAccountId` filter.

**`CostCenter` is deliberately flatter than Hay's general cost-center
model — a documented divergence, not an oversight.** Hay, *Data Model
Patterns*, §7.19 "Cost Center Assignment," pp. 150–151, models COST
CENTER ASSIGNMENT polymorphically: a cost center can be assigned to an
internal organization, a work center, a piece of equipment, a product,
or a project, with the assignment itself as a first-class, timestamped
entity. This spec's `CostCenter` is intentionally flatter (`code`,
`name`, `isActive`, no assignment history, no polymorphic target) — see
Alternatives Considered above ("Let `CostCenter` be a free-standing
string with no entity at all"), which already rejected going the other
direction (no entity at all). Hay's model is the natural Phase 2
extension if a cost center ever needs to attach to more than a
`journal_entry_line_dimension` row (e.g. direct equipment or project
costing) — noted here so that extension has prior art to build from
rather than inventing one.

**ERPNext has no direct analog for the reclassification mechanism
itself — a genuine, useful absence, not a gap in this research.**
ERPNext's Cost Center is a hierarchical tree (group / non-group nodes
under a Parent Cost Center), assigned per transaction line item, with a
"Cost Center Allocation" feature for percentage-based distribution
across centers (docs.frappe.io, `/erpnext/v12/user/manual/en/accounts/
cost-center`, verified 2026-09-12). None of that includes an automatic
nature-to-function reclassification comparable to zespół 4 → zespół 5 —
ERPNext simply doesn't solve this problem, because it doesn't carry the
IFRS dual-presentation requirement Kieso describes above as a ledger-
level concern. This confirms the reclassification engine is solving a
problem specific to dual nature/function presentation, not one every
general-ledger ERP already has a ready-made answer for, and that
`CostCenter`'s tree-shaped ERPNext cousin is available as a Phase 2
reference if hierarchy is ever needed here.

## Architecture

### Entities (`data/entities.ts`)

- `CostCenter` — `code`, `name`, `isActive`, tenant/org-scoped,
  `updatedAt`/`deletedAt` (user-editable reference data — optimistic
  locking and soft delete, per `packages/core/AGENTS.md`'s standard
  column contract). The seeded sentinel row (`code: 'UNALLOCATED'`,
  see Module Setup) is a normal row like any other, distinguished
  only by its well-known `code` — no separate "system row" flag; its
  protection lives in the commands (see Design Decisions, "The sentinel
  `CostCenter` is protected by the commands").
- `DefaultAccountPostingRule` — `sourceAccountId` (FK-id to
  `ledger.LedgerAccount`), `targetAccountId` (FK-id to
  `ledger.LedgerAccount`), `defaultCostCenterId` (FK-id to this
  module's own `CostCenter`, nullable), tenant/org-scoped,
  `updatedAt` (user-editable, default-ON optimistic lock —
  **corrected 2026-09-14**: an earlier draft carried no `updatedAt`,
  matching `LedgerAccountGroup`'s immutable-seed-row shape, on the
  premise that rows were seed-only in Phase 1; see Design Decisions,
  "4→5 rules" — `createDefaultAccountPostingRule`/
  `updateDefaultAccountPostingRule` ship in Phase 1 itself, so the
  entity needs `updatedAt` from its own first migration, not a later
  Phase 2 one).
- `PostingRulesSettings` — `clearingAccountId`/
  `unallocatedCostAccountId` (both nullable FK-ids to
  `ledger.LedgerAccount.id`, no default — see Design Decisions, "New
  settings: `PostingRulesSettings`"), `updatedAt`. Not user-creatable
  — upserted via `updatePostingRulesSettings`, seeded empty on
  organization creation (see Module Setup), the same shape as
  `FixedAssetSettings`.

No entity represents a reclassification itself — it *is* a
`JournalEntry`/`JournalEntryLine` pair in `ledger`, created through
`ledger.postJournalEntry` like any other posting, tagged as such only
via `referenceType: 'PostingRulesEngineReclassification'`/
`referenceId` pointing at the source *line* (see API Contracts;
**corrected 2026-09-14** — see Design Decisions, "The engine's own
postings carry a distinct `referenceType`"). This module owns no
ledger data of its own beyond the three reference tables above.

### Access Control (`acl.ts`)

- `posting_rules.cost_centers.manage` — required by
  `createCostCenter`/`updateCostCenter` and, since both are the same
  "reference data an accountant configures" concern, by
  `createDefaultAccountPostingRule`/`updateDefaultAccountPostingRule`
  too (**corrected 2026-09-14** — an earlier draft gated neither, on
  the premise that `DefaultAccountPostingRule` was Phase-2-only; see
  Design Decisions, "4→5 rules").
- `posting_rules.settings.manage` — required by
  `updatePostingRulesSettings` (see Design Decisions, "New settings:
  `PostingRulesSettings`"). Separate from `cost_centers.manage`
  because pointing the module at the tenant's own account 490/
  unallocated-cost account is a one-time configuration step, not a
  day-to-day reference-data edit.
- `posting_rules.periods.manage` — required by this module's
  `lockFiscalPeriod` guard command (see API Contracts). Deliberately a
  separate feature from `ledger.periods.manage`: a tenant may want an
  operator who can run the *guarded* close without also holding raw
  `ledger` period-management rights, and vice versa.
- `posting_rules.reconcile.run` — required by `reconcileCostRing`,
  since it posts entries on a caller's behalf and should not be open
  to every authenticated role by default.

### Module Dependency (`index.ts`)

```typescript
export const metadata: ModuleInfo = {
  name: 'posting_rules',
  title: 'Posting Rules Engine',
  version: '0.1.0',
  description:
    'Automatic zespół 4 → zespół 5 cost reclassification (account 490) for Polish dual-view accounting.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger', 'journal_entry_line_dimension'],
  ejectable: true,
}
```

A hard dependency on both, expressed the same generation-time-validated
way `journal_entry_line_dimension` itself declares its dependency on
`ledger` (see that document's Architecture → Module Dependency).

### Encryption (`encryption.ts`)

None needed. `CostCenter.name`/`code` and account mappings are
organizational reference data, not personal or financial-secret
information — no field here meets this codebase's encryption bar.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: [
    'posting_rules.cost_centers.manage',
    'posting_rules.settings.manage',
    'posting_rules.periods.manage',
    'posting_rules.reconcile.run',
  ],
}
```

`seedDefaults` seeds two things, neither of them assuming any
particular account numbering (**corrected 2026-09-14** — an earlier
draft seeded a fabricated "401 → 500" `DefaultAccountPostingRule`
template against accounts #5663 never actually creates; see Design
Decisions, "4→5 rules"): a single, non-deletable sentinel
`CostCenter` (`code: 'UNALLOCATED'`, `name: 'Unallocated'`,
`isActive: true`) so the MPK priority hybrid's third path always has
something real to tag with from day one (see Design Decisions, MPK
priority hybrid); and an empty `PostingRulesSettings` row
(`clearingAccountId`/`unallocatedCostAccountId` both `null`),
mirroring `FixedAssetSettings`'s own "seeded empty on organization
creation" precedent. No `DefaultAccountPostingRule` rows and no
further `CostCenter` rows are seeded — a tenant creates its own
department structure and 4→5 mappings once its own chart of accounts
exists (see Design Decisions, "4→5 rules"), and
`PostingRulesSettings.clearingAccountId`/`unallocatedCostAccountId`
stay `null` until an admin configures them, exactly like
`FixedAssetSettings`'s own account fields.

### Commands (Command Pattern, `commands/`)

- `createCostCenter` / `updateCostCenter` / `deleteCostCenter` —
  standard CRUD via `runCrudCommandWrite`, following `ledger`'s own
  `LedgerAccount` command conventions. Requires
  `posting_rules.cost_centers.manage`. `updateCostCenter` rejects a
  change to `code` or `isActive` on the sentinel row, and
  `deleteCostCenter` rejects deleting it (Design Decisions, "The
  sentinel `CostCenter` is protected by the commands"; **corrected
  2026-10-09**: the delete command was not listed, although #6711 ships
  it and the CRUD route exposes it).
- `createDefaultAccountPostingRule` / `updateDefaultAccountPostingRule` /
  `deleteDefaultAccountPostingRule` — standard CRUD, same conventions,
  shipping in **Phase 1**
 (**corrected 2026-09-14**, see Design Decisions, "4→5 rules"): an
  admin wires up each source-account-to-target-account (and optional
  default `CostCenter`) mapping explicitly, since no universal
  template can be assumed. Requires `posting_rules.cost_centers.manage`.
- `updatePostingRulesSettings` — upserts `PostingRulesSettings`
  (`clearingAccountId`/`unallocatedCostAccountId`), the same
  upsert-only-no-create shape as `updateFixedAssetSettings`. Requires
  `posting_rules.settings.manage`.
- `reconcileCostRing` — the sweeper (`ReconcileCostRingCommand` from
  Design Decisions). Finds every source-set line (Design Decisions,
  "Which entries and lines the engine reacts to") with no
  reclassification keyed on it (`referenceType:
  'PostingRulesEngineReclassification'`, `referenceId` = the source
  *line's* id — **corrected 2026-10-09**: it used to be the source
  entry, which cannot tell a fully from a partly reclassified entry;
  see Design Decisions, "The engine's own postings carry a distinct
  `referenceType`") and posts the missing reclassification for each,
  via the same idempotent code path as the subscriber (see
  Cross-module integration). The finder's predicate is at line
  granularity: for each source-set line, does an entry exist whose
  marker `referenceId` is that line's id? It is **not** a comparison of
  the number of reclassification entries per source entry with the
  number of zespół 4 lines. Selection is defined purely by absence of a
  matching reference — not a time-windowed "since the last run" scan,
  which would need a persisted checkpoint this module has no entity
  for. Idempotent: a line already reclassified no longer matches and is
  never picked up twice, and a line whose reclassification exists but
  whose `CostCenter` tag is missing is repaired by the same pass (the
  "ensure tag" step). Lines that cannot be reclassified (no clearing
  account, no target account resolvable, locked period) are reported in
  the command's result by line id with their named error, not thrown,
  so one bad line does not stop the rest. Requires
  `posting_rules.reconcile.run`.
- `lockFiscalPeriod` (this module's own, distinct from `ledger`'s) —
  the period-close guard. Calls `reconcileCostRing`'s underlying finder
  (`findUnreclassifiedEntries(periodId)`, which works at the line
  granularity above and reports the entry id of each line); if it
  returns a non-empty result, rejects with a list of the offending
  entry and line ids and does not proceed. If empty, calls
  `container.resolve('commandBus').execute('ledger.lockFiscalPeriod', {
  input, ctx })` — the real, two-argument `execute(commandId, options)`
  signature (`CommandBus.execute` in
  `packages/shared/src/lib/commands/command-bus.ts`, cited by symbol
  because line numbers drift), an ordinary downward call, the same
  mechanism this module already uses for `postJournalEntry`.
  `ledger.lockFiscalPeriod` still separately enforces its own
  `ledger.periods.manage` when invoked this way, exactly as it would
  for any other caller. **Corrected 2026-10-09** (re-review m4):
  `posting_rules.periods.manage` is *not* checked inside this command.
  The repo's convention is that ACL features are enforced on the route
  or UI layer, and #6711 follows it, but no route or UI calls this
  command yet (see Known integration gap), so the feature is declared
  in `acl.ts` and not yet enforced anywhere. The check belongs on the
  route or button that will call this guard, and must be required there
  when it is added.

### Events & Subscribers (`events.ts`, `subscribers/`)

- **Subscribes to** `ledger.journal_entry.posted` (#5663), declared
  `persistent: true` (**corrected 2026-10-09**, re-review M3: #5663's
  Events section, corrected 2026-09-18, names this subscriber as a
  write-side, idempotent consumer that must be persistent; delivery is
  retried on failure — `packages/events/AGENTS.md` → Subscription
  Types). The payload, as #5663 specifies it, is `{ journalEntryId,
  sequenceNumber, type, operationDate, organizationId, tenantId,
  referenceType, referenceId, lines: { id, accountId, debit, credit }[]
  }` (`debit`/`credit` as numeric strings). The subscriber works from
  the payload and does not re-read the lines; it reads the
  `JournalEntry` once, for `currencyId` only, which the payload does
  not carry. Per event, in this order:
  - **Trigger set.** Returns without processing any line unless `type`
    is `'NORMAL'` or `'REVERSAL'` (so `OPENING` and `CLOSING` are
    skipped), and returns when `referenceType` is
    `'PostingRulesEngineReclassification'`, the engine's own prior
    output (Design Decisions, "Which entries and lines the engine
    reacts to"; Invariant 3).
  - **Per line.** Skips a line whose account is
    `PostingRulesSettings.clearingAccountId` (never a source). For each
    remaining line whose `account.type.accountGroupId` resolves to
    `LedgerAccountGroup{jurisdiction: 'PL', code: '4'}`: takes the
    per-line advisory lock; if a reclassification keyed on this line
    already exists, only ensures its `CostCenter` tag (see "Idempotency
    and errors" below) and moves on; otherwise determines the line's
    side relative to its account's `LedgerAccountType.normalBalance`.
  - **On the normal side:** resolves the target account and default
    `CostCenter` from the `DefaultAccountPostingRule` matching
    `sourceAccountId`, if one exists (`targetAccountId`;
    `defaultCostCenterId`, itself possibly `null`); if no rule exists at
    all, uses `PostingRulesSettings.unallocatedCostAccountId` as the
    target account, and logs a named error and returns if that is unset
    too (see Design Decisions, "New settings: `PostingRulesSettings`").
    Resolves the `CostCenter` tag via the priority hybrid (explicit
    `journal_entry_line_dimension` tag → the rule's
    `defaultCostCenterId`, when that cost centre is still active → the
    seeded sentinel `CostCenter`, `code: 'UNALLOCATED'`; see Design
    Decisions, MPK priority hybrid and the sentinel paragraph). Calls
    `ledger.postJournalEntry` with a debit to the resolved target
    account and a credit to `PostingRulesSettings.clearingAccountId`
    (logging a named error and returning if unset) for the line's
    amount.
  - **On the contra side, in a `REVERSAL` entry:** finds the original
    reclassification per line (Design Decisions, "Reversals are
    mirrored, not duplicated") and posts the mirror image — credit to
    that reclassification's target account, debit to `clearingAccountId`
    — reusing its `CostCenter` tag. If no original is found (it was
    never reclassified), it falls through to the next case instead of
    failing.
  - **On the contra side, in any other entry** (a `NORMAL` entry such as
    a vendor credit note or a 4xx→4xx reclassification), and as the
    fallback above: resolves target account and `CostCenter` exactly as
    on the normal side and posts the inverted direction (credit target
    account / debit clearing account). Nothing needs an original to
    mirror.
  - **Either way:** `operationDate` copied from the source entry (#5663
    requires it as non-nullable on every `JournalEntry` — the
    reclassification's business date is the same business event as the
    source, not "today"), `currencyId` from the source entry,
    `referenceType: 'PostingRulesEngineReclassification'`, `referenceId`
    = the **source line's id** (**corrected 2026-10-09**; it was the
    source entry). Then **ensures** the new zespół 5 line carries the
    resolved `CostCenter` tag via
    `journal_entry_line_dimension.setJournalEntryLineDimension` — always
    a real `CostCenter` id (the sentinel row when nothing more specific
    resolved), never an empty array, which that command's own
    `dimensionIds: z.array(...).min(1)` validator would reject.
  - **Idempotency and errors.** A re-delivery, a retry after partial
    success and a concurrent sweeper run all take the same lock and
    make the same existence check, so a line is reclassified once; the
    tag step runs on every pass and sets the tag only when it is
    missing. Errors a retry cannot fix (clearing account unset, no
    target account resolvable, locked period) are logged with their
    named error and the handler returns; the line stays visible to the
    sweeper and the guard. Transient errors (database, lock timeout) are
    thrown, so that delivery retries them. A subscriber failure cannot
    reject the source posting, so with the module unconfigured source
    postings succeed and the two P&L views diverge until the sweeper
    runs (see Risks).

  **The payload contract is no longer an open gap.** #5663 specifies it
  (core engine → Events, added 2026-09-18) and this section follows it.
- Declares no events of its own in Phase 1 — nothing downstream
  reacts to a reclassification today (Fixed Assets Phase 2 reacts to
  `journal_entry_line_dimension` writes directly, not to this module).

### Cross-module integration

- **`ledger` (hard dependency).** Reads `LedgerAccountType`/
  `LedgerAccountGroup` directly via its own `entityManager` (same
  precedent `journal_entry_line_dimension` and `sales`/`catalog`
  already establish for hard-dependency reads — see that document's
  Design Decisions, "Cross-module access"). Writes exclusively through
  `commandBus.execute('ledger.postJournalEntry', { input, ctx })` and,
  for the guarded close,
  `commandBus.execute('ledger.lockFiscalPeriod', { input, ctx })` — the
  real, two-argument `execute(commandId, options)` signature, never a
  direct write to `ledger`'s entities, matching AP's own
  `postVendorInvoice → ledger.postJournalEntry` precedent.
- **`journal_entry_line_dimension` (hard dependency) — both a direct
  read and a command write, not writes-only.** For the MPK priority
  hybrid's step (1), this module imports `JournalEntryLineDimension`
  from `journal_entry_line_dimension/data/entities` and queries it
  directly with its own `entityManager` — the same hard-dependency
  direct-entity-read precedent `journal_entry_line_dimension` itself
  documents for `fixed_assets` later (and, before that, for `sales`
  reading `catalog`'s `CatalogProduct`). Once the `CostCenter` is
  resolved (by whichever step of the hybrid), it is *written* back
  onto the new zespół 5 line the normal way — through
  `commandBus.execute('journal_entry_line_dimension.setJournalEntryLineDimension',
  { input: { journalEntryLineId, dimensionType: 'CostCenter',
  dimensionIds: [costCenterId] }, ctx })`. Reads bypass the command
  layer (matching real precedent); writes never do (matching root
  `AGENTS.md`'s Command Side Effects rule) — the same split this
  module already follows for `ledger`.
- **This module is never imported or resolved by `ledger` or
  `journal_entry_line_dimension`.** One-way dependency direction only,
  matching `packages/core/AGENTS.md`.
- **Known integration gap, not addressed in this document**: #5663's
  own Fiscal Periods backend page calls `ledger.lockFiscalPeriod`
  directly from its Lock button. Wiring that button to call this
  module's guarded `lockFiscalPeriod` instead, when `posting_rules` is
  installed, is a UI-layer change to #5663 not scoped here — until it
  ships, this guard only protects callers that explicitly invoke
  `posting_rules.lockFiscalPeriod` themselves (an ops runbook or CLI
  script), not a user clicking the existing Lock button.

### Backend Pages

- A minimal `CostCenter` list/create/edit page (Phase 1) — the
  smallest possible UI needed to give `DefaultAccountPostingRule` and,
  later, AP's MPK field something real to reference.
- A minimal `DefaultAccountPostingRule` list/create/edit page (Phase
  1, **corrected 2026-09-14** — an earlier draft deferred this to
  Phase 2; see Design Decisions, "4→5 rules") — where an admin wires
  up each source-to-target account mapping once their own chart of
  accounts exists.
- A single-row `PostingRulesSettings` edit page (Phase 1) — where an
  admin points `clearingAccountId`/`unallocatedCostAccountId` at real
  `LedgerAccount` rows, the same shape as Fixed Assets' own settings
  page.
- **Unconfigured-module banner (added 2026-10-09, re-review m2).**
  While `PostingRulesSettings.clearingAccountId` is unset, the settings
  page and the `CostCenter`/`DefaultAccountPostingRule` pages show a
  banner saying that zespół 4 postings are not being reclassified yet
  and why (⚠ NEEDS HUMAN CONFIRMATION: banner versus a notification).

## Data Models

```typescript
CostCenter {
  id: uuid
  tenantId: uuid
  organizationId: uuid
  code: string
  name: string
  isActive: boolean
  createdAt: timestamp
  updatedAt: timestamp
  deletedAt: timestamp | null
}

DefaultAccountPostingRule {
  id: uuid
  tenantId: uuid
  organizationId: uuid
  sourceAccountId: uuid   // FK-id to ledger.LedgerAccount (zespół 4)
  targetAccountId: uuid   // FK-id to ledger.LedgerAccount (zespół 5)
  defaultCostCenterId: uuid | null   // FK-id to this module's CostCenter
  createdAt: timestamp
  updatedAt: timestamp
  // updatedAt present from Phase 1 (corrected 2026-09-14) --
  // createDefaultAccountPostingRule/updateDefaultAccountPostingRule
  // ship in Phase 1 itself, not Phase 2 -- see Design Decisions,
  // "4->5 rules".
}

PostingRulesSettings {
  id: uuid
  tenantId: uuid
  organizationId: uuid
  clearingAccountId: uuid | null   // FK-id to ledger.LedgerAccount (account 490 equivalent)
  unallocatedCostAccountId: uuid | null   // FK-id to ledger.LedgerAccount (suspense equivalent)
  updatedAt: timestamp
  // Both null until an admin configures them -- no default,
  // same posture as FixedAssetSettings's own account fields.
}
```

All three tenant/org-scoped per `packages/core/AGENTS.md`. Table
names: `posting_rules_cost_centers`,
`posting_rules_default_account_posting_rules`,
`posting_rules_settings`. Unique keys (all include `tenant_id`):
`(organization_id, tenant_id, source_account_id)` on
`DefaultAccountPostingRule` — Phase 1 assumes exactly one default target
per source account; `(organization_id, tenant_id, code)` on `CostCenter`,
as a partial unique index `where deleted_at is null` so a deleted code
can be reused; `(organization_id, tenant_id)` on `PostingRulesSettings`
(one row per organization, upserted). **Corrected 2026-10-09** (re-review
m4): names and keys now match #6711's migration; the earlier draft
listed `cost_center`, `default_account_posting_rule` and keys without
`tenant_id`.

## API Contracts

Every mutation in this module is reached through `commandBus`, not
HTTP, with the exceptions below that follow #5663's own pattern for
non-`CrudForm` actions. **Corrected 2026-09-14**: an earlier draft
used `/api/posting-rules/...` for these — with module id
`posting_rules`, the generator's `/api/${modId}/...` template
(`packages/cli/src/lib/generators/openapi.ts:196`) actually produces a
doubled `/api/posting_rules/posting-rules/...` for a route file under
`api/posting-rules/...`; every route below is now filed directly
under `api/` with no redundant subfolder, matching real sibling
examples (`data_sync`'s `api/mappings/route.ts` →
`/api/data_sync/mappings`).

- `GET` / `POST` / `PUT` / `DELETE /api/posting_rules/cost-centers` —
  `makeCrudRoute` wrappers around `createCostCenter`/`updateCostCenter`/
  `deleteCostCenter`, backing the Phase 1 list/edit page (**corrected
  2026-10-09**: an earlier draft listed only `POST` and `PATCH /:id`).
  Requires `posting_rules.cost_centers.manage`.
- `GET` / `POST` / `PUT` / `DELETE
  /api/posting_rules/default-account-posting-rules` — the same, around
  `createDefaultAccountPostingRule`/`updateDefaultAccountPostingRule`/
  `deleteDefaultAccountPostingRule` (Phase 1, see Design Decisions, "4→5
  rules"). Requires `posting_rules.cost_centers.manage`.
- `GET` / `PATCH /api/posting_rules/settings` — thin wrapper around
  `updatePostingRulesSettings`. Requires `posting_rules.settings.manage`.
- `POST /api/posting_rules/reconcile` — triggers `reconcileCostRing`
  on demand (for an operator who doesn't want to wait for the next
  scheduled run). Requires `posting_rules.reconcile.run`. Returns the
  count of lines reconciled and the lines that could not be, each with its named error.

`lockFiscalPeriod` (this module's guard) is invoked the same
non-route way #5663 documents for its own lock/unlock actions — a
`commandBus`-only action behind a UI button, not a public route in
Phase 1 (see Known integration gap above for why no button calls it
yet).

## Migration & Deployment

Three new tables (`posting_rules_cost_centers`,
`posting_rules_default_account_posting_rules`, `posting_rules_settings`), zero changes to any existing `ledger` or
`journal_entry_line_dimension` table. `seedDefaults` runs once per
organization at module-enable time, the same lifecycle point #5663's
`seedPolishAccountGroups` uses — safe to re-run (upserts the sentinel
`CostCenter` by its well-known `code` and the single
`PostingRulesSettings` row by organization, never duplicates either;
**corrected 2026-09-14**, an earlier draft described upserting
`DefaultAccountPostingRule` rows “by `sourceAccountId`”, a template
this document no longer seeds — see Design Decisions, "4→5 rules").
No backfill: a tenant enabling this module after already having
zespół 4 postings relies on `reconcileCostRing`'s first run to catch
up, not a migration script (and, separately, on an admin having
already configured `PostingRulesSettings` and at least one
`DefaultAccountPostingRule` — see Risks).

## Implementation Plan

1. `CostCenter`, `DefaultAccountPostingRule`, and
   `PostingRulesSettings` entities + migration (**corrected
   2026-09-14**: all three ship together in Phase 1 — see Design
   Decisions, "4→5 rules"/"New settings: `PostingRulesSettings`").
2. `data/validators.ts` for all three entities' CRUD input.
3. `createCostCenter`/`updateCostCenter`,
   `createDefaultAccountPostingRule`/`updateDefaultAccountPostingRule`,
   and `updatePostingRulesSettings` commands + `acl.ts` + `setup.ts`'s
   `defaultRoleFeatures`.
4. `seedDefaults` — the sentinel `CostCenter` (`code: 'UNALLOCATED'`)
   and an empty `PostingRulesSettings` row (**corrected 2026-09-14**:
   no `DefaultAccountPostingRule` template is seeded — see Design
   Decisions).
5. `PostingRulesEngineSubscriber` (the event path) — the module's core
   behavior; depends on steps 1–4 existing so there's something to
   resolve against.
6. `reconcileCostRing` command, reusing the subscriber's reclassify-one-line
   logic as a shared internal helper (not duplicated).
7. `posting_rules.lockFiscalPeriod` guard command.
8. Backend `CostCenter`, `DefaultAccountPostingRule`, and
   `PostingRulesSettings` pages + `api/cost-centers`,
   `api/default-account-posting-rules`, `api/settings`, and
   `api/reconcile` routes (with `openApi`, per
   `packages/core/AGENTS.md`; **corrected 2026-09-14** — no
   `posting-rules/` subfolder, see API Contracts).
9. Integration test: post a zespół 4 `VendorInvoice` line through AP,
   assert the mirror entry and its `CostCenter` tag exist.

## File Manifest

| File | Change | Notes |
|------|--------|-------|
| `data/entities.ts` | Create | `CostCenter`, `DefaultAccountPostingRule`, `PostingRulesSettings` |
| `data/validators.ts` | Create | Zod schemas for all three entities' commands |
| `data/migrations/*.ts` | Create | `posting_rules_cost_centers`, `posting_rules_default_account_posting_rules`, `posting_rules_settings` tables (**added 2026-09-14** — previously unlisted despite Implementation Plan step 1) |
| `commands/costCenters.ts` | Create | `createCostCenter`/`updateCostCenter` |
| `commands/defaultAccountPostingRules.ts` | Create | `createDefaultAccountPostingRule`/`updateDefaultAccountPostingRule` (Phase 1, **corrected 2026-09-14**) |
| `commands/postingRulesSettings.ts` | Create | `updatePostingRulesSettings` |
| `commands/reconcileCostRing.ts` | Create | The sweeper, sharing reclassify-one-line logic with the subscriber |
| `commands/lockFiscalPeriod.ts` | Create | The guarded period-close, calling `ledger.lockFiscalPeriod` on success |
| `lib/reclassify.ts` | Create | `reclassifyLine`, the shared per-line helper (subscriber and sweeper): trigger-set check, advisory lock, existence check, post, ensure tag (**added 2026-10-09**) |
| `lib/findUnreclassifiedEntries.ts` | Create | The shared finder behind the sweeper and the guard, at source-line granularity (**added 2026-10-09**) |
| `subscribers/postingRulesEngineSubscriber.ts` | Create | Reacts to `ledger.journal_entry.posted`, ignoring its own `'PostingRulesEngineReclassification'`-marked output |
| `lib/seedDefaults.ts` | Create | Seeds the sentinel `CostCenter` and an empty `PostingRulesSettings` row (**corrected 2026-09-14** — no 4→5 template) |
| `acl.ts` | Create | Four features (see Architecture) |
| `setup.ts` | Create | `defaultRoleFeatures` + calls `seedDefaults` |
| `index.ts` | Create | `requires: ['ledger', 'journal_entry_line_dimension']` |
| `api/cost-centers/route.ts` | Create | `makeCrudRoute`, with `openApi` (**corrected 2026-09-14**: no `posting-rules/` subfolder — see API Contracts) |
| `api/default-account-posting-rules/route.ts` | Create | `makeCrudRoute`, with `openApi` |
| `api/settings/route.ts` | Create | Thin wrapper around `updatePostingRulesSettings`, with `openApi` |
| `api/reconcile/route.ts` | Create | Triggers `reconcileCostRing`, with `openApi` |
| `backend/cost-centers/page.tsx` | Create | Minimal list/create/edit UI |
| `backend/default-account-posting-rules/page.tsx` | Create | Minimal list/create/edit UI (Phase 1) |
| `backend/settings/page.tsx` | Create | Single-row settings edit UI |
| `i18n/en.json` (+ `pl.json`) | Create | User-facing rejection messages (missing settings, missing rule, locked period, etc.) — **added 2026-09-14**, previously unlisted despite root `AGENTS.md`'s "never hard-code user-facing strings" |

## Testing Strategy

- Assert a zespół 4 posting on the normal side (via a stub
  `postJournalEntry` call, not going through AP) produces exactly one
  mirror `JournalEntry` (debit the account resolved from
  `DefaultAccountPostingRule.targetAccountId`, credit
  `PostingRulesSettings.clearingAccountId`) with matching amount and
  `referenceType: 'PostingRulesEngineReclassification'` and a
  `referenceId` equal to the source *line's* id
  (**corrected 2026-09-14, 2026-10-09** — both accounts are now settings/rule-
  resolved, not the fixed `targetAccountId`/"490" pair an earlier
  draft assumed).
- Assert the MPK priority hybrid in order: explicit
  `journal_entry_line_dimension` tag wins over
  `DefaultAccountPostingRule.defaultCostCenterId`; the rule's default
  wins over the seeded sentinel `CostCenter` (`code: 'UNALLOCATED'`);
  no rule, no tag, and no matching `DefaultAccountPostingRule` at all
  falls through to the sentinel `CostCenter` **and**
  `PostingRulesSettings.unallocatedCostAccountId` as the target
  account (**corrected 2026-09-14** — replaces the earlier, fabricated
  "suspense account 500-99, entry flagged"; see Design Decisions, MPK
  priority hybrid).
- Assert that when no `DefaultAccountPostingRule` matches the source
  account and `PostingRulesSettings.unallocatedCostAccountId` is also
  unset, the subscriber and `reconcileCostRing` both reject with a
  named error rather than posting anywhere (**added 2026-09-14** —
  see Design Decisions, "New settings: `PostingRulesSettings`").
- Assert both the subscriber and `reconcileCostRing` reject with a
  named error when `PostingRulesSettings.clearingAccountId` is unset,
  regardless of whether a `DefaultAccountPostingRule` matched (**added
  2026-09-14**).
- Assert `reconcileCostRing` finds and repairs an entry whose
  subscriber-driven reclassification never happened (simulate by
  posting the source entry with the subscriber disabled), and that
  running it twice never double-posts.
- Assert `posting_rules.lockFiscalPeriod` rejects when
  `findUnreclassifiedEntries` is non-empty, and that it successfully
  delegates to `ledger.lockFiscalPeriod` when empty.
- Assert a locked `FiscalPeriod` rejects both the source posting *and*
  a reclassification attempted against it independently (two separate
  `postJournalEntry` calls, two separate rejections).
- Tenant/org-isolation: `CostCenter`/`DefaultAccountPostingRule`/
  `PostingRulesSettings` reads and writes never cross
  tenant/organization boundaries — same discipline as every other
  entity in this codebase (**corrected 2026-09-14** — adds
  `PostingRulesSettings`, an entity introduced after this bullet was
  first written).
- Assert `ledger.postJournalEntry` and `ledger.lockFiscalPeriod` are
  fully unaffected (no subscriber side effects, no guard) when
  `posting_rules` is not installed for a tenant.
- Assert that, over the entries carrying the marker, the clearing
  account's credit balance equals the sum of normal-side source lines
  reclassified minus the sum of contra-side lines mirrored, after N
  reclassifications of each kind (the restated Invariant 2 — a net
  balance over the engine's own entries, not zero, and not the account's
  total balance; **restated 2026-10-09**, re-review m1).
- Assert the subscriber ignores its own output: posting a
  `JournalEntry` whose `referenceType` is already
  `'PostingRulesEngineReclassification'` never triggers a second
  reclassification, regardless of which accounts its lines resolve to
  (Invariant 3; **corrected 2026-09-14** — replaces an earlier
  assertion that relied on the zespół-5/zespół-4 account-group split
  alone, a mechanism Design Decisions now flags as the actual,
  previously-buggy premise).
- Assert the reversal path: reversing a posted zespół 4 line (via
  `ledger.reverseJournalEntry`) produces a mirror-image
  reclassification (credit the original's target account, debit
  `clearingAccountId`) tagged with the *same* `CostCenter` the
  original reclassification carried, even when the matching
  `DefaultAccountPostingRule`'s `defaultCostCenterId` has since
  changed — never a freshly re-resolved hybrid (**added 2026-09-14**
  — see Design Decisions, "Reversals are mirrored, not duplicated";
  Invariant 5).
- Assert `reconcileCostRing`/`lockFiscalPeriod`'s shared finder
  searches specifically for `referenceType:
  'PostingRulesEngineReclassification'`, and that a
  reversed-but-never-reclassified entry (linked only via #5663's own
  `type: 'REVERSAL'`, `referenceType: 'journal_entry'`) is correctly treated as *not yet
  reclassified*, not wrongly skipped (**added 2026-09-14** — the bug
  the marker fix resolves; see Design Decisions).
- Assert deactivating a `CostCenter` (`isActive: false`) or changing a
  `DefaultAccountPostingRule` row does not alter any
  `JournalEntryLineDimension` tag already written by a prior
  reclassification (Invariant 5 — lookups are point-in-time, not
  retroactive; **corrected 2026-09-14** — drops the parenthetical
  "(Phase 2)", since `DefaultAccountPostingRule` updates ship in
  Phase 1 — see Design Decisions, "4→5 rules").
- Assert the unique constraints reject a duplicate: a second
  `DefaultAccountPostingRule` for the same `(organizationId,
  sourceAccountId)`, a second `CostCenter` for the same
  `(organizationId, code)`, and a second `PostingRulesSettings` row
  for the same `organizationId` (**corrected 2026-09-14** — adds
  `PostingRulesSettings`).
- Assert `updateCostCenter`, `updateDefaultAccountPostingRule`, and
  `updatePostingRulesSettings` all enforce optimistic locking (reject
  a stale `x-om-ext-optimistic-lock-expected-updated-at` header with a
  409), matching the same test this codebase already runs for every
  other user-editable entity (`LedgerAccount`, `LedgerAccountType`,
  `FiscalPeriod` in #5663; **corrected 2026-09-14** — adds the two
  commands that ship in Phase 1 alongside `updateCostCenter`).
- **Trigger set (added 2026-10-09, re-review M1).** Assert the
  subscriber and the finder skip a `CLOSING` entry that credits every
  4xx account against 490 (no reclassification is posted and the clearing
  account is not touched again) and an `OPENING` entry; skip a line on the
  clearing account that the engine did not post (a manual adjustment, or
  a `REVERSAL` of one of the engine's own reclassifications, which
  carries `type: 'REVERSAL'` and `referenceType: 'journal_entry'`, not
  the marker); and that none of these appears in
  `findUnreclassifiedEntries`.
- Assert a `NORMAL` entry with a contra-side zespół 4 line (a vendor
  credit note referencing an AP document, a 4xx→4xx reclassification)
  gets the inverted-direction reclassification, resolved through the rule
  and the hybrid; that a `REVERSAL` whose original was never reclassified
  does too; and that the later reclassification of the original brings
  the net to zero.
- **Per-line marker (added 2026-10-09, re-review M2).** Assert the
  reproduction from the review: an entry with a 401 line that has a rule
  and a 402 line that has none, `unallocatedCostAccountId` unset. Line
  401 is reclassified and line 402 is reported, not posted; after the
  settings are fixed, `reconcileCostRing` posts line 402 only, and
  `posting_rules.lockFiscalPeriod` rejects until it has. Assert the
  marker's `referenceId` is the source line's id; that changing a rule
  after posting does not make the finder re-post a line that already
  has its reclassification; and that a contra-side mirror, whose debit
  line is the clearing account, is matched to its contra line and never
  reclassified a second time.
- **Idempotent delivery (added 2026-10-09, re-review M3).** Assert that
  delivering the same event twice posts one reclassification per line;
  that a failure of `setJournalEntryLineDimension` after the posting,
  followed by a retry, ends with one reclassification that carries its
  tag; that a concurrent `reconcileCostRing` run and subscriber delivery
  for the same line produce one reclassification; and that a
  configuration error (clearing account unset) is logged and does not
  throw, while a transient database error does.
- Assert the sentinel `CostCenter` cannot be renamed (`code`),
  deactivated or deleted through `updateCostCenter`, `deleteCostCenter`
  or the `DELETE` route; that re-running `seedDefaults` does not add a
  second one; and that a rule whose `defaultCostCenterId` points at a
  deactivated cost centre resolves to the sentinel (**added 2026-10-09**,
  re-review m3).

## Risks & Impact Review

**Corrected 2026-09-14**: every risk below now carries the explicit
Severity / Affected area / Mitigation / Residual risk labels
`.ai/specs/AGENTS.md`'s Spec Content Checklist requires ("Risks must
document concrete failure scenarios, severity, affected area,
mitigation, and residual risk") — an earlier draft covered the
failure scenario and mitigation in prose but never labeled severity
or residual risk.

- **Data integrity.** The main risk: a bug in the account/cost-centre
  resolution logic posts a reclassification with the wrong amount, to
  the wrong account, or with the wrong `CostCenter` tag — silently
  wrong numbers in the functional P&L. Severity: high (an undetected
  misstatement in a reported financial view). Affected area: every
  zespół 4 posting across every tenant with this module enabled.
  Mitigation: the Testing Strategy's amount-matching assertions and
  comparing the configured clearing account's running credit balance
  against the sum of reclassified zespół 4 source lines (see
  Invariants, corrected — the clearing account does not net to zero
  during the period, it accumulates; a mismatch against that sum, not
  against zero, is what signals a bug). Residual risk: low once those
  assertions run in CI, since the balance comparison catches drift
  regardless of its specific cause.
- **Cascading failures.** The subscriber runs after the source commit;
  a slow or failing reclassification does not roll back or block the
  source posting (by design — see Design Decisions). Because it is
  `persistent: true`, delivery is retried on failure (**corrected
  2026-10-09**: it used to be described as in-process with no retry), so
  a handler that fails on something a retry cannot fix would be retried
  pointlessly, and a non-idempotent one would post duplicates. Severity:
  medium. Affected area: AP/AR posting latency and ledger correctness
  for tenants with this module enabled. Mitigation: the subscriber is
  idempotent per source line (advisory lock, existence check, ensure
  tag), only transient errors are thrown, and its work is minimal (one
  lookup, one `postJournalEntry` call, one tag write). Residual risk:
  low.
- **Tenant & data isolation.** Same profile as every other module here
  — `CostCenter`/`DefaultAccountPostingRule`/`PostingRulesSettings`
  are tenant/org-scoped (**corrected 2026-09-14** — adds
  `PostingRulesSettings`), and the subscriber/sweeper always operate
  within the source entry's own tenant/organization, never
  cross-tenant. Severity: high if violated, though this reuses a
  well-established codebase-wide pattern rather than introducing new
  surface area. Affected area: cross-tenant data leakage. Mitigation:
  the same tenant/org-scoping discipline and tests every other entity
  in this codebase already carries. Residual risk: low.
- **Migration & deployment.** Low — three new, empty-by-default
  tables (**corrected 2026-09-14**: adds `posting_rules_settings`,
  previously described as two tables), no change to any existing
  schema. The one real deployment risk is enabling this module for a
  tenant that already has unreclassified zespół 4 history:
  `reconcileCostRing`'s first run does the catch-up, and should be run
  once manually right after enabling the module rather than waiting
  for its schedule, to avoid a long window with a visibly wrong
  functional P&L (an operational note, not a schema risk). Severity:
  low. Affected area: onboarding an existing tenant onto this module.
  Mitigation: a documented manual `reconcileCostRing` run as part of
  enablement. Residual risk: low.
- **Until an admin configures the module, source postings succeed and
  the two P&L views quietly diverge.** **Rewritten 2026-10-09**
  (re-review m2): an earlier version said "the module rejects every
  posting" and that "the rejection is a named, actionable error". A
  subscriber cannot reject the source posting (subscriber failures are
  never propagated to the emitting command — see "Period-close guard"),
  so in an unconfigured tenant every AP posting succeeds, the subscriber
  logs a named error and returns, and the by-nature and by-function
  variants disagree with no error shown to the person posting. This is a
  direct consequence of the settings-based redesign (no seeded template,
  empty `PostingRulesSettings`; see Design Decisions, "4→5 rules").
  Severity: medium — a deliberate scope boundary, but a silent one.
  Affected area: every zespół 4 posting after enabling the module, until
  configuration is complete. Where an accountant sees it: the result of
  `reconcileCostRing` (lines that could not be reclassified, each with
  its named error) and the offending-line list of
  `posting_rules.lockFiscalPeriod`, which refuses to lock. Both are
  pulled, not pushed, so Phase 1 adds a visible signal: a banner while
  `clearingAccountId` is unset (see Backend Pages). Residual risk: medium
  until a chart-of-accounts import exists (see Out of scope), since until
  then an admin must already know their `LedgerAccount` ids.
- **The event contract (see Events & Subscribers).** **Closed
  2026-10-09** (re-review M3): #5663 now specifies the payload and this
  subscriber's `persistent: true`, and this module's text follows it.
  What remains is that `currencyId` is not in the payload, so the
  subscriber reads the entry once (⚠ NEEDS HUMAN CONFIRMATION: whether to
  ask #5663 to add it). Severity: low. Affected area: #6711's
  `reclassifyLine`, which still declares `persistent: false` and keys on
  the source entry, and must be aligned with this text before either PR
  merges (see the 2026-10-09 Changelog entry). Mitigation: that
  alignment. Residual risk: none once aligned.
- **The period-close guard doesn't protect the existing UI button**
  (see Known integration gap, Cross-module integration) — a real,
  named gap until #5663's Fiscal Periods page is updated separately.
  Severity: medium. Affected area: any tenant that closes periods
  through #5663's existing UI rather than this module's guarded
  command. Mitigation: documented as a known gap with a named owner
  (#5663's own page); no workaround exists inside this module alone.
  Residual risk: medium until that UI change lands.

## Out of scope

- Generating the P&L in either variant — #6013/ZSiO's job (see Design
  Decisions).
- Letting a user set an MPK manually on a purchase invoice line — a
  future Accounts Payable UI change; this module's write path
  (`journal_entry_line_dimension`) is already the right shape for it,
  no change needed here when it lands.
- A general chart-of-accounts import mechanism — bulk-loading a
  tenant's own accountant-maintained numbering scheme into
  `ledger.LedgerAccount`/`LedgerAccountType` (e.g. from an Excel
  "plan kont") — a distinct, `ledger`-owned feature this module
  depends on existing (see Risks, "The module rejects every posting
  until an admin configures it") but does not itself build.
  **Added 2026-09-14**, deliberately deferred as a separate future
  topic rather than folded into this module, since numbering is not
  standardized across tenants and importing/mapping a chart of
  accounts is a `ledger`-level concern independent of any one
  downstream reclassification engine. **Update (2026-09-15)**: a
  related, but narrower, `ledger`-owned feature now exists —
  `2026-09-15-default-chart-of-accounts.md` (PR #6137) ships one
  fixed, hardcoded Polish starter template via an opt-in
  `ledger.importDefaultChartOfAccounts` command. This does not close
  this bullet: that document explicitly ships a single fixed template,
  not the general "bulk-load a tenant's own arbitrary numbering
  scheme" mechanism described here — a tenant with pre-existing
  accounting-system numbering still has no way to import it. The gap
  this bullet names remains open.
- Enforcing leaf-postability — rejecting a direct post to a
  `LedgerAccount` that has child accounts, restricting posts to its
  analytic leaves. **Added 2026-09-14**: #5663 itself names this as
  future scope ("only its analytic leaves are postable... [t]his
  ships together with the posting-rules/konto 490 engine in a future
  spec, not here"), which reads as though this document should
  implement it — but the enforcement point is `ledger.postJournalEntry`
  itself, since it must apply uniformly to every poster (AP, AR,
  Fixed Assets, this module's own reclassifications), not only to
  zespół 4/5 traffic. #5663 remains the owner of that guard; this
  document assumes it exists by the time this module ships, and does
  not implement any part of it here.
- Phase 2 configurability of `DefaultAccountPostingRule` — superseded
  (**corrected 2026-09-14**): its create/update commands and
  management UI now ship in Phase 1 itself, since no universal
  template can be assumed once account numbering isn't standardized
  (see Design Decisions, "4→5 rules"). There is no remaining Phase 2
  scope for this entity to defer.
- Non-Polish jurisdictions' cost-classification schemes (German SKR03,
  French PCG, US GAAP) — `LedgerAccountGroup` already generalizes the
  *detection* mechanism (see Design Decisions), but this module's own
  reclassification rules (zespół 4/5, konto 490-equivalent) are
  Polish-specific by construction; a different jurisdiction plugin
  would need its own equivalent engine, not a configuration of this
  one.
- Wiring #5663's existing Fiscal Periods Lock button to this module's
  guard (see Known integration gap).
- Fixed Assets as a cost source (`transferAsset`, Phase 2 there) —
  joins once that module's own Phase 2 lands; no design change needed
  here, since the subscriber reacts to `ledger.journal_entry.posted`
  regardless of which module emitted the underlying posting.

## Final Compliance Report

Went through one independent, fresh-context adversarial review pass
against #5663, `journal_entry_line_dimension`, and `2026-09-06-accounts-payable.md`
before this draft settled, which found and fixed: two uses of a
non-existent three-argument `commandBus.execute(commandId, input, ctx)`
form — the exact stale signature AP's own spec had already caught and
corrected, missed here because the first draft's citation-verification
claim never named AP as checked; a fabricated quote attributed to
`journal_entry_line_dimension`'s "own Design Decisions" that doesn't
exist there; a stated "writes only" relationship to
`journal_entry_line_dimension` directly contradicted, one paragraph
later, by a description of reading that same table; a wrong invariant
claiming account 490 "nets to zero" when the design as written only
ever credits it (490 accumulates a running balance instead — the P&L
close, not this module, is what zeroes it); a self-contradictory
`reconcileCostRing` selection rule (a time-windowed scan with no
checkpoint entity to back it, alongside a reference-absence scan);
`DefaultAccountPostingRule` claiming `LedgerAccountGroup`'s
"seeded, not tenant-editable" precedent while carrying an `updatedAt`
column that precedent explicitly doesn't have; a missing
`operationDate` on the engine's own postings, required non-nullable by
#5663; and five Testing Strategy gaps (the corrected balance
invariant, no-recursion, point-in-time lookups, both unique
constraints, and `updateCostCenter`'s optimistic-lock check). All
fixed in place above; full review trail matches the convention
established in `2026-09-10-general-ledger-bulk-read-service.md`'s own
Final Compliance Report. The one gap this report used to flag
is closed (2026-10-09): #5663 now documents
`ledger.journal_entry.posted`'s payload and the subscriber's
persistence (see Events & Subscribers); the three majors of the
2026-10-09 re-review are recorded in the Changelog. Compliance Matrix and a formal pass/fail verdict against
`AGENTS.md` are deferred to a maintainer review, matching this
project's established practice.

## Changelog

### 2026-09-06 — Initial TLDR and scope decision

Decided this needs its own document, sequenced after Accounts Payable,
not a blocker for AP itself.

### 2026-09-07 — Design Decisions resolved

Account-group detection, event-driven (not batch/same-transaction)
reclassification, the reconciliation sweeper, the period-close guard,
Phase 1 scope (AP only), and the MPK priority hybrid all decided and
recorded with reasoning.

### 2026-09-08 — Dimension-table split corrected

Corrected a misquoted citation of #5663 justifying
`journal_entry_line_dimension` as a separate document; replaced with
the real, verified reason (more than one independent consumer).

### 2026-09-10 — Full first draft

Added Overview, Problem Statement, Proposed Solution, User Stories,
Invariants, Alternatives Considered, Architecture, Data Models, API
Contracts, Migration & Deployment, Implementation Plan, File Manifest,
Testing Strategy, Risks & Impact Review, Out of scope, and this
Changelog. Resolved two previously-named-but-unshaped entities
(`DefaultAccountPostingRule`, and the new `CostCenter`) into a concrete
Data Model. Flagged one open gap honestly rather than guessing past it:
`ledger.journal_entry.posted`'s exact payload shape isn't specified in
#5663 today.

### 2026-09-10 (cont.) — Independent review pass, nine issues fixed

Fresh-context adversarial review against #5663, `journal_entry_line_dimension`,
and Accounts Payable found and fixed: a stale three-argument
`commandBus.execute` form (the same bug AP's own spec had already
caught elsewhere); a fabricated quote attributed to
`journal_entry_line_dimension`; a "writes only" claim contradicted by
this same document's own MPK-hybrid read; a wrong "490 nets to zero"
invariant (490 accumulates a running credit balance — corrected, with
the actual checkable invariant restated); a self-contradictory
`reconcileCostRing` selection rule (dropped the unsupported
time-windowed framing, kept the reference-absence one);
`DefaultAccountPostingRule` claiming a precedent its own schema
diverged from (`updatedAt` removed to match `LedgerAccountGroup`
exactly); a missing `operationDate` on the engine's own postings; and
five Testing Strategy gaps. Full detail in Final Compliance Report.

### 2026-09-12 — Literature & Prior Art grounding applied

Per the financial-spec-writing-process: cross-checked against
`2026-09-08-financial-module-knowledge-base.md` §2/§3 (no conflicts), then verified
via full-text search of the primary literature rather than titles alone.
Confirmed the zespół 4 → zespół 5 reclassification implements Kieso's
IFRS "dual approach" (nature- and function-of-expense presented
together, IFRS Insights supplement to Ch. 4, pp. 4-45–4-46) rather than
being a Poland-only mechanism; confirmed `DefaultAccountPostingRule`
matches Fowler's Derived Account pattern (§6.15.2, pp. 130-131);
compared `CostCenter` against Hay's polymorphic Cost Center Assignment
(§7.19, pp. 150-151) and recorded the divergence as deliberate, not an
oversight; compared against ERPNext's Cost Center model and confirmed it
has no reclassification analog at all — a genuine absence, not a
research gap. Findings recorded in full in `financial-module-knowledge-
base.md` §3 and above in Literature & Prior Art.

### 2026-09-14 — PR review response (pkarw, om-auto-review-pr): settings-based account resolution replaces hardcoded templates
Full response to the CHANGES REQUESTED review (2 blockers, 3 majors,
2 minors, 1 nit) — every finding verified against #5663, #5972, and
the real codebase before being accepted (per
`financial-spec-citation-check`), none were false alarms:

- Blocker (B1): `seedDefaults`' premise contradicted #5663 head-on —
  #5663 seeds only `LedgerAccountGroup` (zespoły 0–8), never a
  tenant's actual `LedgerAccount` rows ("tenants build their own"),
  so the fabricated "401 → 500" seed template had no ids to point at,
  and neither konto 490 nor the "500-99 (Unallocated costs)" suspense
  account was ever created by any spec in the family. Resolved by a
  full design change, not a point-fix: a real client chart of
  accounts (380 rows, confirmed account numbering is accountant-
  specific, not standardized across tenants) ruled out both
  auto-creating hardcoded accounts and seeding any universal
  template. `posting_rules` now gets its own `PostingRulesSettings`
  entity (`clearingAccountId`/`unallocatedCostAccountId`, nullable,
  no default, reject-if-unset), mirroring `FixedAssetSettings`'s
  established pattern; `DefaultAccountPostingRule`'s own
  create/update commands move from a deferred "Phase 2" into Phase 1
  itself, since no template can be assumed; and the fabricated
  "500-99" account — which would have collided with the real chart's
  own `-99 = NKUP` (non-tax-deductible cost) convention — is replaced
  by a seeded sentinel `CostCenter` (`code: 'UNALLOCATED'`) plus
  `PostingRulesSettings.unallocatedCostAccountId`, illustrated against
  a real, non-colliding account (509 – Koszty nieprzypisane).
- Blocker (B2): Invariant 3's anti-recursion claim was false — account
  490 genuinely resolves to `LedgerAccountGroup{code: '4'}` like any
  other zespół 4 account (there is no "zespół 4x9"), so the engine's
  own credit line to 490 would re-enter the subscriber and loop
  unbounded real postings into the ledger. Fixed by giving every
  reclassification this engine posts a distinct `referenceType:
  'PostingRulesEngineReclassification'` (replacing the generic
  `'JournalEntry'` literal used throughout) and having the subscriber
  check that marker first, independent of account-group resolution.
  `referenceType` is confirmed free-form in #5663, so this needed no
  cross-spec schema change.
- Major (M1): the MPK hybrid's third path switched the target account
  to the non-existent "500-99" and "flagged" the entry for manual
  review, but no flag exists anywhere in the data model, and
  #5972's `dimensionIds: z.array(...).min(1)` would reject the empty
  tag that path left behind. Resolved as part of the B1 redesign: the
  third path now always resolves to a real, non-empty tag (the seeded
  sentinel `CostCenter`) and a real, settings-configured target
  account (`unallocatedCostAccountId`, rejecting with a named error
  if unset) — no "flag" concept needed.
- Major (M2): the engine ignored debit/credit direction, so a storno
  (credit to a normally-debit zespół 4 account, per #5663's
  `reverseJournalEntry`) would have been mirrored as another debit
  5xx/credit 490 — doubling the cost instead of relieving it. Fixed:
  the subscriber now compares each posted line's side against its
  account's `LedgerAccountType.normalBalance`; a contra-side line
  posts the mirror-image entry instead, reusing the *original*
  reclassification's `CostCenter` tag (via `referenceId`) rather than
  re-resolving the hybrid, consistent with Invariant 5 (lookups are
  point-in-time, not retroactive).
- Major (M3): `reconcileCostRing`/`lockFiscalPeriod`'s shared
  "already reclassified" finder searched `referenceType:
  'JournalEntry'`, the same pair #5663's own `reverseJournalEntry`
  uses to link a `REVERSAL` back to its source — so a
  reversed-but-never-reclassified entry would have been wrongly
  treated as already handled, letting the period-close guard report a
  dirty period clean. The same `'PostingRulesEngineReclassification'`
  marker introduced for B2 fixes this too: the finder now searches
  specifically for it, which no `REVERSAL` entry can ever satisfy.
- Minor (m1): the File Manifest's API routes
  (`api/posting-rules/cost-centers/route.ts`) would have produced the
  doubled path `/api/posting_rules/posting-rules/cost-centers` under
  the real route-generation rule
  (`packages/cli/src/lib/generators/openapi.ts:196`,
  `/api/${modId}${routeSegs...}`, confirmed against
  `packages/cli/src/lib/resolver.ts`). Every route in this document is
  now filed directly under `api/` with no redundant `posting-rules/`
  subfolder, matching real sibling examples (`data_sync`'s
  `api/mappings/route.ts` → `/api/data_sync/mappings`).
- Minor (m2): #5663 defers leaf-postability enforcement ("reject a
  direct post to an account that has children") to "the
  posting-rules/konto 490 engine in a future spec," but this document
  never claimed it, leaving it unowned across #5663/#5972/this spec.
  Resolved by adding it to Out of scope, naming its real owner
  explicitly: `ledger.postJournalEntry` itself, since the guard must
  apply to every poster (AP, AR, Fixed Assets, this engine), not only
  zespół 4/5 traffic — #5663 remains responsible for building it.
- Nit (n1): the File Manifest omitted a migration-file row despite
  the Implementation Plan promising one, and omitted an `i18n/` entry
  despite shipping a backend page and user-facing rejection messages
  (root `AGENTS.md`: "Never hard-code user-facing strings"); the
  Risks & Impact Review had failure scenarios and mitigations but no
  explicit severity or residual-risk labels, despite
  `.ai/specs/AGENTS.md`'s Spec Content Checklist requiring both. Both
  gaps fixed: File Manifest gained its migration and `i18n/` rows;
  every Risks & Impact Review bullet now states Severity, Affected
  area, Mitigation, and Residual risk explicitly.

A general chart-of-accounts import mechanism — needed to turn
`PostingRulesSettings`/`DefaultAccountPostingRule`'s configuration
step from a manual one into a practical one for a real tenant — was
discussed and deliberately deferred as a separate, `ledger`-owned
future topic, not folded into this module's scope; noted explicitly
in Out of scope and Risks. **Update (2026-09-15)**: a narrower,
related feature (a single hardcoded starter template, not a general
import of a tenant's own numbering) has since shipped as
`2026-09-15-default-chart-of-accounts.md` — see the annotation on the
Out of scope bullet above for the precise distinction.

### 2026-09-29 — Full-module implementation shipped, PR #6711

Implemented in [PR #6711](https://github.com/open-mercato/open-mercato/pull/6711)
(branch `feat/posting-rules-engine`, stacked on the still-unmerged GL
core engine and JELD branches): the full module — engine, sweeper, guard,
CRUD, UI, migration, seed, ACL, en/pl i18n — in one PR, matching the
JELD precedent. Implementation-session details (type-check findings,
test counts) belong in that PR's description, not here. Divergences
between this document and that PR are recorded in the 2026-10-09 entry
below.

### 2026-10-09 — Re-review response (om-auto-review-pr, reviewed head `7160f379`)

The review confirmed all eight findings of the 2026-09-14 review as
resolved and raised 0 blockers, 3 majors, 4 minors and 2 nits, addressed
in the text above:

- **M1, trigger set.** New Design Decisions paragraph "Which entries and
  lines the engine reacts to": `NORMAL` and `REVERSAL` only; the clearing
  account is never a source; contra-side lines with no original to mirror
  (credit notes, 4xx→4xx, a reversal whose original was never
  reclassified) are posted inverted through the rule and the hybrid.
  Invariant 3 extended, Testing Strategy cases added.
- **M2, per-line marker.** A reclassification's `referenceId` is the
  source line's id; the finder, the sweeper and the guard decide per
  line; the contra-side original is found per line (stable pairing,
  residual limitation disclosed).
- **M3, event contract.** `persistent: true`, the payload as #5663
  specifies it, an idempotency requirement (advisory lock, existence
  check, ensure tag) and non-throwing handling of errors a retry cannot
  fix.
- **m1.** Invariants 1, 2, 3 and 5, the Proposed Solution and the
  Testing Strategy restated (net clearing-account balance over the
  engine's own entries; point-in-time now covers the target account).
- **m2.** The "rejects every posting" risk rewritten as the
  silent-divergence scenario, with a visible signal added to Phase 1.
- **m3.** Sentinel `CostCenter` protection moved into the commands;
  inactive-cost-centre fallback stated.
- **m4.** Text aligned with #6711 where #6711 is right: reversal linkage
  literal (`type: 'REVERSAL'`, `referenceType: 'journal_entry'`),
  `posting_rules.periods.manage` not enforced inside the command, table
  names and unique keys, `GET`/`PUT`/`DELETE` routes and delete commands.
- **n1, n2.** Citation by symbol; knowledge-base file name; the
  2026-09-29 entry reduced to a pointer.

**Divergences still open in #6711** (checked against the author's branch
on 2026-10-09). The code does not yet follow this text in five places:
the subscriber declares `persistent: false`; `referenceId` is the source
entry; `findUnreclassifiedEntries` compares counts per entry; the trigger
set is not restricted (`CLOSING`/`OPENING` entries and clearing-account
lines are processed); the sentinel `CostCenter` is not protected. Either
#6711 changes to follow this document or this document changes, before
either PR merges.
