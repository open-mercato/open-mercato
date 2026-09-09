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

## Design Decisions (2026-09-07 — resolved)

**4→5 rules: a default template in Phase 1, configurability in
Phase 2.** A ready-made Polish chart-of-accounts template is needed
anyway (HS-03) — a rule-customization UI is an extension, added once
it's clear what actually needs adjusting.

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
only permitted mechanism (events + subscribers) is fire-and-forget by
design ("Inline delivery logs each handler error and continues" — a
subscriber's error neither blocks nor rolls back the emitting
command). Resolution: #5663's `postJournalEntry` emits
`ledger.journal_entry.posted` (ephemeral — immediate, in-process, no
retry — see `.ai/specs/2026-08-18-general-ledger-core-engine.md` →
Architecture → Events); `PostingRulesEngineSubscriber` receives it,
checks `account.type.accountGroupId` → `jurisdiction: 'PL'`,
`code: '4'`, and immediately posts the 490→5xx reclassification with
its own `postJournalEntry` call (`referenceType: 'JournalEntry'`,
`referenceId` of the original entry). This is not atomic with the
source posting — there is a microscopic window between the two
commits, and no automatic retry if the reclassification fails. Hence
the two additional mechanisms below.

**A repair mechanism: `ReconcileCostRingCommand` (a sweeper).** A
scheduled / CLI-invoked command that finds "orphaned" zespół 4 entries
with no corresponding reclassification on account 490 (e.g. after a
server restart mid-event-handling) and generates the missing entries
for them. Closes the no-retry risk of the ephemeral subscriber above.

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
Dimension → `DefaultAccountPostingRule` → suspense account.** Where
does the MPK for a cost line come from, given that AP doesn't yet have
a field to set it manually: the engine checks, in order — (1) whether
the line already has an MPK dimension recorded in
`journal_entry_line_dimension` (entered manually in AP, once that
field exists); (2) if not, whether a `DefaultAccountPostingRule`
exists for that account (a new reference entity, e.g. a mapping like
"account 401 → MPK Administration"); (3) if not, it posts to the
technical suspense account 500-99 ("Unallocated costs") and flags the
entry for manual verification. This lets the engine work from day zero
on default rules alone, without waiting for an MPK field in the AP
invoice UI — once that field exists, it simply starts feeding path
(1), with no change to the engine.

**Generating the P&L in both variants belongs to task #4/ZSiO, not
this spec.** This spec is responsible only for the source data
existing (correctly reclassified, tagged entries) — the report itself
is a reporting-layer concern, a different owner.
