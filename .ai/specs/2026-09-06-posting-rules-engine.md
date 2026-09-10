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

An event-driven subscriber (`PostingRulesEngineSubscriber`) listens for
`ledger.journal_entry.posted` (#5663). For every posted line whose
account resolves to zespół 4 (`LedgerAccountType.accountGroupId` →
`LedgerAccountGroup{jurisdiction: 'PL', code: '4'}`), it immediately
posts a second, linked `JournalEntry`: a debit to the zespół 5 account
named by that source account's `DefaultAccountPostingRule` and a
credit to the technical clearing account 490, for the same amount —
tagged with a `CostCenter` dimension (via
`journal_entry_line_dimension`) resolved through a three-step priority
hybrid (explicit tag → default rule → suspense account; see Design
Decisions). Two supporting mechanisms cover the event's fire-and-forget
nature: a reconciliation sweeper (`reconcileCostRing`) that finds and
repairs any zespół 4 posting left without its mirror, and a
period-close guard (`posting_rules.lockFiscalPeriod`) that refuses to
lock a fiscal period while unreclassified entries remain. Full
reasoning for every one of these choices is in Design Decisions below;
this section is the map of how they fit together.

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

**`DefaultAccountPostingRule` does double duty: the 4→5 account mapping
and the default cost centre, in one row — resolved while writing this
document's Architecture.** Two earlier decisions each named a need for
this entity without specifying its actual shape: "4→5 rules: a default
template" (above) needs, for a given zespół 4 account, which zespół 5
account to debit; the MPK priority hybrid (below) needs, for a given
account, which `CostCenter` to default to when nothing more specific
is set. Splitting these into two tables would mean looking up two
rows per reclassification for what is, in practice, one fact per
source account ("this cost, by default, goes to *this* function, in
*this* department"). One entity instead:
`DefaultAccountPostingRule { id, tenantId, organizationId,
sourceAccountId (FK-id to ledger.LedgerAccount, a zespół 4 account),
targetAccountId (FK-id to ledger.LedgerAccount, a zespół 5 account),
defaultCostCenterId (FK-id to this module's own CostCenter, nullable —
some accounts may have no sensible default and always fall through to
the suspense account), createdAt }` — no `updatedAt`, matching
`LedgerAccountGroup`'s own immutable-seed-row shape exactly (see Data
Models). Phase 1: rows are
inserted only by this module's `seedDefaults` (the "ready-made Polish
chart-of-accounts template" from the wall, e.g. 401 → 500 with no
default cost centre) — no create/update command, no ACL feature, no UI
— matching `LedgerAccountGroup`'s own "seeded, not tenant-editable in
Phase 1" precedent in #5663. Phase 2 (the "configurability" half of
the same decision) adds `createDefaultAccountPostingRule` /
`updateDefaultAccountPostingRule` and a management screen; nothing in
Phase 1's shape needs to change for that — it is additive.

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
is a reporting-layer concern, a different owner.

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
   `JournalEntryLine` posted to a zespół 4 account eventually has a
   corresponding debit line on its `DefaultAccountPostingRule`-mapped
   zespół 5 account and a credit line on account 490, for the same
   amount — "eventual" because the event path is fire-and-forget;
   `reconcileCostRing` is what makes this true within a bounded window
   rather than indefinitely.
2. **Account 490's running credit balance always equals the sum of
   reclassified zespół 4 costs to date — not zero.** Every
   reclassification this engine posts is a single entry, debit
   `targetAccountId` (zespół 5) / credit 490, for the source line's
   amount; 490 never receives a debit from this engine, so its balance
   accumulates rather than nets to zero during the period. **Corrected
   from an earlier, wrong draft of this invariant**, which claimed 490
   "nets to zero" — that would only be true if this engine also posted
   an offsetting debit to 490 somewhere, which it deliberately does
   not (the by-nature P&L variant needs the original zespół 4 balances
   left untouched). Clearing 490 to zero is the standard period-end
   P&L-closing procedure that applies to every result-affecting
   account, not something this module does itself — out of scope here
   (see Out of scope). The invariant this module *can* actually check:
   at any point in time, 490's credit balance equals the sum of every
   zespół 4 posting reclassified so far; a mismatch (checked by
   comparing 490's balance against the sum of reclassified source
   lines, not against zero) indicates a mapping or amount bug.
3. **A reclassification entry is never the cause of a re-reclassification.**
   The subscriber acts only on lines whose account resolves to zespół
   4; the zespół 5 debit and 490 credit it posts never themselves
   trigger another reclassification (their accounts resolve to zespół
   5 and zespół 4x9 respectively, neither matches `code: '4'`).
4. **A fiscal period cannot be locked through `posting_rules.lockFiscalPeriod`
   while `reconcileCostRing` would find unreclassified entries in it.**
   Locking through `ledger.lockFiscalPeriod` directly bypasses this
   guard by design (see Design Decisions) — the invariant only holds
   for callers that go through this module's guard.
5. **`CostCenter`/`DefaultAccountPostingRule` changes never rewrite
   history.** Both are looked up at reclassification time, not
   snapshotted retroactively; deactivating a `CostCenter`
   (`isActive: false`) or changing a `DefaultAccountPostingRule` row
   (Phase 2) affects only postings made after the change.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| End-of-month batch reclassification | Rejected: leaves a window where the two P&L variants disagree "at any point in time," the exact invariant the wall requires (see Design Decisions, "Real-time, not batch") |
| Reclassify inside the same transaction/command as the source posting (e.g. `postVendorInvoice` calls this engine directly) | Rejected: requires a direct cross-module call from `accounts_payable` (or any future cost source) into `posting_rules`, which `packages/events/AGENTS.md` bans; also couples every cost-source module to this engine's existence, defeating the "AP works standalone without `posting_rules`" requirement (see Design Decisions, "Real-time, not batch") |
| A subscriber-side veto on `lockFiscalPeriod` (subscriber returns an error that blocks the lock) | Rejected: subscriber errors are only logged, never propagated to the emitting command — architecturally impossible in this event system, not just undesirable (see Design Decisions, "Period-close guard") |
| Store the 4→5 mapping and default cost centre as two separate reference tables | Rejected: both are one fact per source account in practice; two tables means two lookups and two places to keep in sync for no separation of concerns that matters here (see Design Decisions, "`DefaultAccountPostingRule` does double duty") |
| Let `CostCenter` be a free-standing string with no entity at all (just whatever `AP` or a rule types in) | Rejected: nothing to reference from `DefaultAccountPostingRule`, no way to rename a department consistently, no place to mark one inactive — `journal_entry_line_dimension` (#5972) explicitly leaves this identity question to its consumers, and this is the first consumer that needs an answer |

## Architecture

### Entities (`data/entities.ts`)

- `CostCenter` — `code`, `name`, `isActive`, tenant/org-scoped,
  `updatedAt`/`deletedAt` (user-editable reference data — optimistic
  locking and soft delete, per `packages/core/AGENTS.md`'s standard
  column contract).
- `DefaultAccountPostingRule` — `sourceAccountId` (FK-id to
  `ledger.LedgerAccount`), `targetAccountId` (FK-id to
  `ledger.LedgerAccount`), `defaultCostCenterId` (FK-id to this
  module's own `CostCenter`, nullable), tenant/org-scoped. **No
  `updatedAt`, no `deletedAt` in Phase 1** — matching
  `LedgerAccountGroup`'s own precedent exactly (#5663: "No `updatedAt`
  — immutable, system-seeded rows"), not just loosely: rows are
  seed-only, never user-editable, in Phase 1. Phase 2's
  `createDefaultAccountPostingRule`/`updateDefaultAccountPostingRule`
  commands add `updatedAt` (and optimistic locking) via their own
  migration at that point — not carried speculatively in this phase's
  schema.

No entity represents a reclassification itself — it *is* a
`JournalEntry`/`JournalEntryLine` pair in `ledger`, created through
`ledger.postJournalEntry` like any other posting, tagged as such only
via `referenceType: 'JournalEntry'`/`referenceId` pointing at the
source entry (see API Contracts). This module owns no ledger data of
its own beyond the two reference tables above.

### Access Control (`acl.ts`)

- `posting_rules.cost_centers.manage` — required by
  `createCostCenter`/`updateCostCenter`.
- `posting_rules.periods.manage` — required by this module's
  `lockFiscalPeriod` guard command (see API Contracts). Deliberately a
  separate feature from `ledger.periods.manage`: a tenant may want an
  operator who can run the *guarded* close without also holding raw
  `ledger` period-management rights, and vice versa.
- `posting_rules.reconcile.run` — required by `reconcileCostRing`,
  since it posts entries on a caller's behalf and should not be open
  to every authenticated role by default.

No feature gates `DefaultAccountPostingRule` in Phase 1 — there is no
command that writes to it yet (see Design Decisions).

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
    'posting_rules.periods.manage',
    'posting_rules.reconcile.run',
  ],
}
```

`seedDefaults` seeds the Phase 1 Polish default template into
`DefaultAccountPostingRule` (e.g. 401 → 500, keyed off the same
`LedgerAccountGroup`-seeded PL chart of accounts #5663 already
provides) — mirrors `seedPolishAccountGroups`'s own seeding pattern in
#5663, called for the same `jurisdiction: 'PL'` tenants. No
`CostCenter` rows are seeded — a tenant creates its own department
structure; `DefaultAccountPostingRule.defaultCostCenterId` starts
`null` for every seeded row until an admin sets defaults or a
`CostCenter` is created and wired up (Phase 2 UI) — until then, every
zespół 4 posting without an explicit tag falls through to the suspense
account (see Design Decisions, MPK priority hybrid).

### Commands (Command Pattern, `commands/`)

- `createCostCenter` / `updateCostCenter` — standard CRUD via
  `runCrudCommandWrite`, following `ledger`'s own `LedgerAccount`
  command conventions. Requires `posting_rules.cost_centers.manage`.
- `reconcileCostRing` — the sweeper (`ReconcileCostRingCommand` from
  Design Decisions). Finds every zespół 4 `JournalEntryLine` with no
  corresponding zespół 5/490 reclassification entry
  (`referenceType: 'JournalEntry'`, `referenceId` pointing back to it)
  and posts the missing reclassification for each, via the same logic
  path as the subscriber (see Cross-module integration). Selection is
  defined purely by absence of a matching reference — **not** a
  time-windowed "since the last run" scan, which would need a
  persisted checkpoint this module doesn't have any entity for; an
  unbounded absence-based scan needs none and is what
  `findUnreclassifiedEntries` (shared with `lockFiscalPeriod`'s guard)
  already implements. Idempotent for the same reason: an entry already
  reclassified no longer matches the "no corresponding entry" search
  and is never picked up twice. Requires `posting_rules.reconcile.run`.
- `lockFiscalPeriod` (this module's own, distinct from `ledger`'s) —
  the period-close guard. Calls `reconcileCostRing`'s underlying
  finder (`findUnreclassifiedEntries(periodId)`); if it returns a
  non-empty result, rejects with a list of the offending entry ids and
  does not proceed. If empty, calls
  `container.resolve('commandBus').execute('ledger.lockFiscalPeriod', {
  input, ctx })` — the real, two-argument `execute(commandId, options)`
  signature (`packages/shared/src/lib/commands/command-bus.ts:223-226`,
  per AP's own corrected citation of it), an ordinary downward call,
  the same mechanism this module already uses for `postJournalEntry`.
  Requires
  `posting_rules.periods.manage` (checked here) — `ledger.lockFiscalPeriod`
  still separately enforces its own `ledger.periods.manage` when
  invoked this way, exactly as it would for any other caller.

### Events & Subscribers (`events.ts`, `subscribers/`)

- **Subscribes to** `ledger.journal_entry.posted` (#5663, ephemeral).
  `PostingRulesEngineSubscriber` receives the event, loads the posted
  entry's lines, and for each line whose `account.type.accountGroupId`
  resolves to `LedgerAccountGroup{jurisdiction: 'PL', code: '4'}`:
  resolves the target `DefaultAccountPostingRule` by
  `sourceAccountId`; resolves the `CostCenter` via the priority hybrid
  (explicit `journal_entry_line_dimension` tag → rule's
  `defaultCostCenterId` → suspense account 500-99); and calls
  `ledger.postJournalEntry` with a debit to `targetAccountId` and a
  credit to account 490 for the line's amount, `operationDate` copied
  from the source entry (#5663 requires it as non-nullable on every
  `JournalEntry` — the reclassification's business date is the same
  business event as the source, not "today"), `referenceType:
  'JournalEntry'`, `referenceId` of the source entry. On success, tags
  the new zespół 5 line with the resolved `CostCenter` via
  `journal_entry_line_dimension.setJournalEntryLineDimension`. **Open
  gap, honestly flagged, not resolved in this document**: #5663 does
  not yet specify the exact payload shape of
  `ledger.journal_entry.posted` — this document assumes it carries at
  minimum `journalEntryId`, `tenantId`, `organizationId` (enough to
  re-fetch the lines), consistent with every other ephemeral event in
  this codebase, but that payload contract should be confirmed against
  #5663's own implementation before this module is built, not assumed
  from this spec alone.
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
  later, AP's MPK field something real to reference. No page for
  `DefaultAccountPostingRule` in Phase 1 (no command backs one yet —
  see Design Decisions).

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
  // No updatedAt in Phase 1 — immutable, seed-only rows,
  // matching LedgerAccountGroup's precedent (#5663). Phase 2's
  // update command adds it via its own migration.
}
```

Both tenant/org-scoped per `packages/core/AGENTS.md`. Indexes (see API
Contracts): `(organization_id, source_account_id)` unique on
`DefaultAccountPostingRule` — Phase 1 assumes exactly one default
target per source account; `(organization_id, code)` unique on
`CostCenter`.

## API Contracts

No new API routes. Every mutation in this module is reached through
`commandBus`, not HTTP, with two exceptions that follow #5663's own
pattern for non-`CrudForm` actions:

- `POST /api/posting-rules/cost-centers` / `PATCH
  /api/posting-rules/cost-centers/:id` — thin `makeCrudRoute` wrappers
  around `createCostCenter`/`updateCostCenter`, backing the Phase 1
  list/edit page. Requires `posting_rules.cost_centers.manage`.
- `POST /api/posting-rules/reconcile` — triggers `reconcileCostRing`
  on demand (for an operator who doesn't want to wait for the next
  scheduled run). Requires `posting_rules.reconcile.run`. Returns the
  count of entries reconciled.

`lockFiscalPeriod` (this module's guard) is invoked the same
non-route way #5663 documents for its own lock/unlock actions — a
`commandBus`-only action behind a UI button, not a public route in
Phase 1 (see Known integration gap above for why no button calls it
yet).

## Migration & Deployment

Two new tables (`cost_center`, `default_account_posting_rule`), zero
changes to any existing `ledger` or `journal_entry_line_dimension`
table. `seedDefaults` runs once per organization at module-enable
time, the same lifecycle point #5663's `seedPolishAccountGroups` uses
— safe to re-run (upserts by `sourceAccountId`, never duplicates a
row). No backfill: a tenant enabling this module after already having
zespół 4 postings relies on `reconcileCostRing`'s first run to catch
up, not a migration script.

## Implementation Plan

1. `CostCenter` and `DefaultAccountPostingRule` entities + migration.
2. `data/validators.ts` for both entities' CRUD input.
3. `createCostCenter`/`updateCostCenter` commands + `acl.ts` +
   `setup.ts`'s `defaultRoleFeatures`.
4. `seedDefaults` — the Phase 1 Polish 4→5 template into
   `DefaultAccountPostingRule`.
5. `PostingRulesEngineSubscriber` (the event path) — the module's core
   behavior; depends on steps 1–4 existing so there's something to
   resolve against.
6. `reconcileCostRing` command, reusing the subscriber's reclassify-one-line
   logic as a shared internal helper (not duplicated).
7. `posting_rules.lockFiscalPeriod` guard command.
8. Backend `CostCenter` list/create/edit page + `api/posting-rules/cost-centers`
   routes (with `openApi`, per `packages/core/AGENTS.md`) +
   `api/posting-rules/reconcile`.
9. Integration test: post a zespół 4 `VendorInvoice` line through AP,
   assert the mirror entry and its `CostCenter` tag exist.

## File Manifest

| File | Change | Notes |
|------|--------|-------|
| `data/entities.ts` | Create | `CostCenter`, `DefaultAccountPostingRule` |
| `data/validators.ts` | Create | Zod schemas for both entities' commands |
| `commands/costCenters.ts` | Create | `createCostCenter`/`updateCostCenter` |
| `commands/reconcileCostRing.ts` | Create | The sweeper, sharing reclassify-one-line logic with the subscriber |
| `commands/lockFiscalPeriod.ts` | Create | The guarded period-close, calling `ledger.lockFiscalPeriod` on success |
| `subscribers/postingRulesEngineSubscriber.ts` | Create | Reacts to `ledger.journal_entry.posted` |
| `lib/seedDefaults.ts` | Create | Seeds the Phase 1 PL 4→5 template |
| `acl.ts` | Create | Three features (see Architecture) |
| `setup.ts` | Create | `defaultRoleFeatures` + calls `seedDefaults` |
| `index.ts` | Create | `requires: ['ledger', 'journal_entry_line_dimension']` |
| `api/posting-rules/cost-centers/route.ts` | Create | `makeCrudRoute`, with `openApi` |
| `api/posting-rules/reconcile/route.ts` | Create | Triggers `reconcileCostRing`, with `openApi` |
| `backend/cost-centers/page.tsx` | Create | Minimal list/create/edit UI |

## Testing Strategy

- Assert a zespół 4 posting (via a stub `postJournalEntry` call, not
  going through AP) produces exactly one mirror `JournalEntry` (debit
  `targetAccountId`, credit 490) with matching amount and
  `referenceType`/`referenceId`.
- Assert the MPK priority hybrid in order: explicit
  `journal_entry_line_dimension` tag wins over
  `DefaultAccountPostingRule.defaultCostCenterId`; the rule's default
  wins over the suspense account; no rule and no tag → suspense
  account 500-99, entry flagged.
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
- Tenant/org-isolation: `CostCenter`/`DefaultAccountPostingRule` reads
  and writes never cross tenant/organization boundaries — same
  discipline as every other entity in this codebase.
- Assert `ledger.postJournalEntry` and `ledger.lockFiscalPeriod` are
  fully unaffected (no subscriber side effects, no guard) when
  `posting_rules` is not installed for a tenant.
- Assert account 490's running credit balance equals the sum of every
  reclassified zespół 4 line's amount after N reclassifications (the
  corrected Invariant 2 — not an assertion that 490 is zero).
- Assert the subscriber does not recurse: posting the reclassification
  entry itself (debit zespół 5, credit 490) never triggers a second
  reclassification, since neither line's account resolves to zespół 4
  (Invariant 3).
- Assert deactivating a `CostCenter` (`isActive: false`) or changing a
  `DefaultAccountPostingRule` row (Phase 2) does not alter any
  `JournalEntryLineDimension` tag already written by a prior
  reclassification (Invariant 5 — lookups are point-in-time, not
  retroactive).
- Assert the unique constraints reject a duplicate: a second
  `DefaultAccountPostingRule` for the same `(organizationId,
  sourceAccountId)`, and a second `CostCenter` for the same
  `(organizationId, code)`.
- Assert `updateCostCenter` enforces optimistic locking (rejects a
  stale `x-om-ext-optimistic-lock-expected-updated-at` header with a
  409), matching the same test this codebase already runs for every
  other user-editable entity (`LedgerAccount`, `LedgerAccountType`,
  `FiscalPeriod` in #5663).

## Risks & Impact Review

- **Data integrity.** The main risk: a bug in the account/cost-centre
  resolution logic posts a reclassification with the wrong amount or
  to the wrong account — silently wrong numbers in the functional
  P&L. Mitigated by the Testing Strategy's amount-matching assertions
  and by comparing account 490's running credit balance against the
  sum of reclassified zespół 4 source lines (see Invariants, corrected
  — 490 does not net to zero during the period, it accumulates; a
  mismatch against that sum, not against zero, is what signals a bug).
- **Cascading failures.** The subscriber runs synchronously in-process
  after the source commit; a slow or failing reclassification does not
  roll back or block the source posting (by design — see Design
  Decisions), but a broken subscriber could, in principle, degrade
  posting throughput if it blocks on something slow. Mitigated by
  keeping the subscriber's work minimal (one lookup, one
  `postJournalEntry` call) and by the sweeper existing specifically so
  the subscriber never needs a retry loop of its own.
- **Tenant & data isolation.** Same profile as every other module here
  — `CostCenter`/`DefaultAccountPostingRule` are tenant/org-scoped,
  and the subscriber/sweeper always operate within the source entry's
  own tenant/organization, never cross-tenant.
- **Migration & deployment.** Low — two new, empty-by-default tables,
  no change to any existing schema. The one real deployment risk is
  enabling this module for a tenant that already has unreclassified
  zespół 4 history: `reconcileCostRing`'s first run does the catch-up,
  and should be run once manually right after enabling the module
  rather than waiting for its schedule, to avoid a long window with a
  visibly wrong functional P&L (an operational note, not a schema
  risk).
- **The event-payload assumption (see Events & Subscribers).** If
  `ledger.journal_entry.posted`'s real payload turns out not to carry
  enough to re-fetch the lines cheaply, the subscriber's design (not
  its correctness) needs revisiting before implementation — flagged
  explicitly rather than guessed past.
- **The period-close guard doesn't protect the existing UI button**
  (see Known integration gap, Cross-module integration) — a real,
  named gap until #5663's Fiscal Periods page is updated separately.

## Out of scope

- Generating the P&L in either variant — #6013/ZSiO's job (see Design
  Decisions).
- Letting a user set an MPK manually on a purchase invoice line — a
  future Accounts Payable UI change; this module's write path
  (`journal_entry_line_dimension`) is already the right shape for it,
  no change needed here when it lands.
- Phase 2 configurability of `DefaultAccountPostingRule` (its own
  create/update commands and management UI) — Phase 1 ships seed-only
  rows (see Design Decisions).
- Non-Polish jurisdictions' cost-classification schemes (German SKR03,
  French PCG, US GAAP) — `LedgerAccountGroup` already generalizes the
  *detection* mechanism (see Design Decisions), but this module's own
  reclassification rules (490, zespół 4/5) are Polish-specific by
  construction; a different jurisdiction plugin would need its own
  equivalent engine, not a configuration of this one.
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
Final Compliance Report. One gap remains flagged, not resolved, by
design: #5663 does not document `ledger.journal_entry.posted`'s exact
payload shape (see Events & Subscribers, Risks) — confirming it is
implementation-time work, not something this document can settle by
itself. Compliance Matrix and a formal pass/fail verdict against
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
