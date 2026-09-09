# General Ledger core engine — Chart of Accounts, double-entry posting, fiscal periods

## TLDR

Adds the missing accounting foundation for Open Mercato: a double-entry
General Ledger (Chart of Accounts + Journal Entries) with fiscal-period
locking. No module in core or in any published
official module currently books financial transactions — `sales`
tracks invoices as documents, `financial-pl` adds Polish VAT/KSeF
compliance on top of those documents, but neither maintains a ledger
of accounts and balanced debit/credit entries. This spec covers that
gap in isolation: a standalone posting engine with no dependency on
`sales`, invoicing, or country-specific tax logic. The first concrete
consumer of the engine — posting Accounts Receivable entries from
`sales` invoices — ships as its own dependent spec (not yet drafted;
planned path `.ai/specs/2026-08-18-sales-invoice-gl-posting.md`), once
this one is implemented; see Out of scope.

## Overview

Module id: `ledger`.

A General Ledger is the record every other financial capability writes
to. Accounts Payable, Accounts Receivable, and Cash Management don't
exist without somewhere to post their entries; a country tax plugin
can't report VAT without ledger data to report on. This spec builds
that write target first, deliberately narrow: accounts, journal
entries, and fiscal periods — nothing that depends on a document type
from another module.

The engine follows standard double-entry bookkeeping: every posted
transaction is a set of debit and credit lines that must sum to zero
on the base currency. Accounts are typed (Asset, Liability, Equity,
Revenue, Expense) and each type carries a normal balance side, which
is what the accounting equation is built on — this isn't a design
choice, it's how double-entry accounting works.

## Problem Statement

- No entity, table, or command anywhere in `packages/core` represents
  a ledger account, a chart of accounts, or a journal entry. Confirmed
  by searching `packages/core/src` for `ledger`, `journal`, and
  `accounting` — zero matches.
- `sales` invoices are documents with amounts and statuses; they are
  not accounting entries and don't touch any notion of a chart of
  accounts.
- Without a ledger, no downstream capability (AP, AR, Cash Management,
  country tax plugins) has anywhere to post to, and no financial
  report (trial balance, balance sheet, P&L) can be produced.

## Proposed Solution

A new module (`ledger`) providing:

1. A **Chart of Accounts**: hierarchical account types with a normal
   balance side, and concrete accounts scoped to tenant/organization.
2. A **posting engine**: `JournalEntry` (header) +
   `JournalEntryLine[]` (debit/credit lines), enforced balanced both
   in application code and at the database level.
3. **Fiscal periods** with a lock flag, checked before any posting.
   Closing a year is represented as an ordinary `JournalEntry` with
   `type: 'CLOSING'`, posted manually or by a script — there is no
   automated closing-entry generator (that stays in Out of scope).
   Opening a year's balances is the same mechanism run in reverse,
   `type: 'OPENING'` — see Design decisions.
4. **Reversal**, not undo — correcting a posted entry means posting a
   new, opposite entry that references the original. The original is
   never mutated or deleted.

### Design decisions

**Normal balance lives on the account type, not the account.**
Whether an account's balance normally increases on the debit or credit
side is a property of its category (Asset/Expense: debit; Liability/
Equity/Revenue: credit), not of the individual account. Storing it on
the type avoids every account needing to independently get this right,
and makes the accounting equation enforceable in one place.

**Account types are hierarchical from day one.** A flat list of
account types cannot support grouped reporting (e.g. "all Fixed Asset
sub-accounts summed") without ad-hoc query logic wherever a report is
built. `parentAccountTypeId` (self-referencing) is added now, while
the table is empty — retrofitting a hierarchy onto a chart of accounts
that already has posted history is a much harder migration than
shipping it from the start.

**`LedgerAccountType` classifies additionally through a new reference
entity, `LedgerAccountGroup`, seeded per tenant/organization — not a
global table, not a hardcoded enum.** Driven by the platform brief:
Phase 1 targets Poland, USA later, further markets as plugins.
Poland's own "zespół" numbering (0–8) doesn't generalize — German
SKR03/SKR04, French PCG, and US GAAP each use different classification
schemes — so the mechanism needs to be identical everywhere while the
dictionary of values varies per country. `LedgerAccountGroup`
(`jurisdiction`, `code`, `name`) is tenant/org scoped like every other
entity in this module: core `AGENTS.md` § Never states "Never expose
cross-tenant data or omit tenant/organization scoping" — no entity may
be a single table shared across tenants, reference data included.
Seeded through `setup.ts`'s `seedDefaults` hook, the same mechanism
`currencies` already uses for its own reference data
(`currencies/setup.ts` → `seedDefaults` → `seedExampleCurrencies(ctx.em,
{ tenantId, organizationId })`; `Currency` itself is tenant/org scoped,
not global — corrects an earlier draft of this decision that
mischaracterized it as unscoped). `LedgerAccountType` gets a nullable
`accountGroupId` FK to it.

**Phase 1 hardcodes `jurisdiction: 'PL'` — choosing a jurisdiction per
tenant/organization is explicitly out of scope, deferred.**
`seedDefaults` always seeds the Polish dictionary (zespoły 0–8) for
every organization, with no selection logic. Picking the right
jurisdiction per organization (not per tenant — `directory.Organization`
already models a tree, so a single tenant's organizations could in
principle span countries) has no existing mechanism anywhere in the
system: `directory.Tenant`/`Organization` carry no country/locale
field today, and the `country`/`countryCode` fields found elsewhere
(`customers`, `sales`, `staff`, `wms`) describe addresses of
counterparties, warehouses, and tax rates — not the accounting
jurisdiction of the organization itself. Solving this would mean
adding a field (e.g. `accountingJurisdiction`) to `directory.
Organization`, a shared core entity `ledger` doesn't own — genuinely
out of scope for Phase 1 (Poland-only), to be designed when USA/other-
jurisdiction support is actually built. See Module Setup below for the
resulting `seedDefaults` hook.

**`accountGroupId` is immutable once any account of that type has
posted entries — same guard as `normalBalance`.** Enforced by
`updateLedgerAccountType`, same check as the `normalBalance` guard
above. Changing a type's statutory group mid-year would break the
consistency of historical ZSiO/balance-sheet reports.

**`LedgerAccount` gets a self-referencing `parentAccountId` too —
structural only, no logic reads it yet.** Multi-dimensional analytics
(kontrahent, MPK/cost-centre, rachunek bankowy, środek trwały, waluta)
can't be solved by one mechanism: a single `JournalEntryLine` can need
more than one dimension at once (e.g. a counterparty on the credit
line and a cost centre on the debit line of the same purchase). Two
different concerns get two different homes. `parentAccountId` models
the static, single-dimension Chart-of-Accounts hierarchy (e.g. `130
Rachunki bieżące` → `130-1 mBank`, `010 Środki trwałe` → `010-1
Samochody`) — the shape ZSiO and Balance calculation aggregate over.
The contextual, multi-dimensional tagging is a separate, future
mechanism (see Out of scope). Added now on the same logic as
`parentAccountTypeId` above and `referenceType`/`referenceId`: cheap
while the table is empty, and it unblocks the tree shape that Bank
Management (`130-x`) and Fixed Assets (`010-x`) will need later.

**When a future consumer (Bank Management or Fixed Assets) starts
reading `parentAccountId`, `updateLedgerAccount` should gain a guard
of the same class as `accountTypeId`'s above — the exact trigger
condition is intentionally left open here (2026-09-08).** Nothing
enforces this today, deliberately: no Phase 1 logic aggregates over
the hierarchy yet, so changing `parentAccountId` now has no reporting
consequence to protect against, and adding an active guard for a
mutation surface nothing reads would itself be the kind of
speculative, not-yet-needed scope the review checklist's anti-pattern
check flags. This is a documented placeholder for whichever future
spec adds that reader, not a settled mechanism: `accountTypeId`'s
guard only checks for posted entries on the account itself, but
`parentAccountId` may also need to consider whether the account has
child accounts (re-parenting a subtree, not just a leaf, is a
different blast radius) — that question is explicitly left to whoever
designs the actual guard, once there is a real reader to protect
against silent, retroactive rollup changes.

**`LedgerAccount.accountTypeId` is immutable once the account has
posted entries — same class of guard as `normalBalance`/
`accountGroupId` on `LedgerAccountType`.** `normalBalance` and
`accountGroupId` live on the type, not on the account or on
`JournalEntryLine`, so reassigning an account to a different type
after it has posted history would silently reinterpret every one of
its past entries (e.g. a DEBIT-normal account retroactively becoming
CREDIT-normal). `updateLedgerAccount` rejects an `accountTypeId`
change once the account has any posted `JournalEntryLine`, mirroring
the existing `updateLedgerAccountType` guard one level up.

**`JournalEntryLine` gets a nullable `contractorSnapshot` (`json`)
column.** Resolved while designing `.ai/specs/2026-09-06-contractor-
registry.md`: Accounts Payable needs a point-in-time copy of the
counterparty's name, NIP, bank account and Biała Lista verification
status at posting time, so a later correction to the contractor's
current data never silently rewrites what a historical journal entry
was posted against. This is a different mechanism from the future
`journal_entry_line_dimension` table (see Out of scope) — a denormalized
audit snapshot, not a queryable reporting dimension — and exists to
avoid an audit gap between Accounts Payable shipping and the
posting-rules/dimension engine being built later. Precedent for the
column shape: `messages.MessageObject.entity_snapshot` (`json`, nullable)
already does the same point-in-time-copy job elsewhere in the
codebase. Added now on the same empty-table logic as the two decisions
above; nothing in this phase populates or reads it.

**`JournalEntryLine` gets its own `organizationId`/`tenantId` columns,
not just inherited scope through `journalEntryId`.** An earlier draft
of this spec left `JournalEntryLine` without its own tenant/org
columns, relying on a join through `journalEntryId` to `JournalEntry`
for scoping. Checked against precedent: `sales.SalesInvoiceLine` — the
same shape, a line under a parent document — carries its own
`organization_id`/`tenant_id` despite also having a parent FK
(`invoice_id`). The established convention in this codebase is that
line/detail tables get their own scope columns, not just a derivable
one through the parent; `JournalEntryLine` now matches it.

**`contractorSnapshot` carries PII and MUST be declared in `ledger`'s
own `encryption.ts`.** It duplicates the same NIP/name/bank-account
data that `.ai/specs/2026-09-06-contractor-registry.md` already
requires encrypting on the `Contractor` entity — denormalizing it onto
`JournalEntryLine` doesn't reduce the sensitivity, so it needs its own
`defaultEncryptionMaps` entry: `{ entityId: 'ledger:journal_entry_line',
fields: [contractor_snapshot] }`. Whole-`json`-column encryption is
already a precedented pattern in this codebase, not something new
being invented here — `messages:message.action_data`/`action_result`
(also `type: 'json'` columns) are declared exactly this way in
`messages/encryption.ts`. Reads go through `findWithDecryption` /
`findOneWithDecryption` like any other encrypted field.

**`debit` and `credit` are separate columns on the line, not one
`direction` enum plus an amount.** A single enum+amount column is
marginally simpler to write, but every balance query then needs a
`CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END` instead of a
plain `SUM(debit)`/`SUM(credit)`. Reporting is the primary consumer of
this data, so the schema optimizes for it. A check constraint
(`(debit = 0 OR credit = 0) AND (debit > 0 OR credit > 0)`) plus an
application-level guard keeps a line from ever having both or neither
side populated.

**Fiscal period closing is a lock flag plus an entry type, not a
separate "closing" subsystem.** `FiscalPeriod.isLocked` is checked in
the `postJournalEntry` command handler before any write and blocks new
postings into a closed period. Actually closing a period (moving
Revenue/Expense balances to Retained Earnings) is represented as a
normal `JournalEntry` with `type: 'CLOSING'` — posted manually or by a
script — rather than a bespoke voucher-generation subsystem. This
keeps Phase 1 scoped to the posting engine itself; an automated
closing-entry generator is a natural, separate follow-up that this
schema doesn't block (it stays in Out of scope). It also means a
closed period's effects are always visible as ordinary ledger entries,
not a flag with no traceable cause — required for audit, not just
convenient.

**Opening balances are the same mechanism as closing, run in
reverse — an ordinary `JournalEntry` with `type: 'OPENING'`, not a
first-entry special case.** Establishing an account's beginning-of-year
balance (or, for a brand-new ledger, its balance at go-live) is a
normal, balanced journal entry that debits/credits each permanent
(balance-sheet: Asset/Liability/Equity) account for its carried-forward
figure — posted manually or by a script, the same posture already
taken for `CLOSING` above, not a bespoke initialization subsystem.
Nominal (Revenue/Expense) accounts are not usually opened this way:
`CLOSING` already zeroes them at the prior year-end (Design decisions
above), so they start the new year at zero by construction, with no
opening entry needed for them. `postJournalEntry` does not special-case
`type: 'OPENING'` at all — it validates and persists it exactly like
any other entry: balanced, subject to the covering `FiscalPeriod`'s
lock check, atomically numbered by the same per-organization
`sequenceNumber` counter. The one operational expectation worth naming
explicitly, so it isn't left to be discovered later: an `OPENING`
entry for fiscal year N+1 must be dated within — and therefore posted
before locking — the first `FiscalPeriod` of year N+1, the same rule
that governs every other entry. An automated opening-balance generator
(deriving each account's carried-forward figures from the prior year's
post-closing trial balance and emitting the entry automatically) is
out of scope here, for the identical reason the equivalent
`CLOSING`-generator is excluded below: computing "the prior year's
closing figures" needs a real balance/trial-balance read side, which
this phase does not build (see Out of scope, Balance calculation) —
`2026-09-09-general-ledger-account-balances.md`'s Phase 2 is what makes
that generator buildable later, not this one.

**`referenceType`/`referenceId` are added now even though nothing
populates them in this phase.** With no integration into `sales` or
any other document type in scope here, every journal entry in this
phase is posted directly, not generated from another module. The
fields exist anyway: adding a nullable column to an empty table costs
nothing; adding one to a ledger table that already has production rows
is a real migration. The dependent `sales-invoice-gl-posting` spec
(planned, not yet drafted) is the first real consumer, and it needs no
schema change to use them.

**Currency is reused from the existing `currencies` module, not
reinvented.** `packages/core/src/modules/currencies` already owns
tenant/org-scoped `Currency` (code, symbol, decimal precision,
base-currency flag) and `ExchangeRate`. This spec originally proposed
a second `Currency` entity inside the ledger module; that was a
mistake — it would have created two disagreeing sources of truth for
currency master data and silently ignored the currencies module's own
rules (4-decimal precision, date-based rate resolution, realized
gain/loss formula). `JournalEntry.currencyId` is a plain FK-id
(`uuid`, no ORM relation) to `currencies.Currency.id`, fetched
separately when needed — the same "FK-id, no cross-module ORM
relation" pattern this spec already uses for `LedgerAccount`/
`LedgerAccountType` references. No `Currency` entity ships with this
module.

**ACL features are scoped per capability, not one blanket
`ledger.manage`.** Following the `customers` module's `acl.ts`
convention (`<module>.<resource>.view` / `<module>.<resource>.manage`,
with `manage` depending on `view`), this module declares six features
across three resources — accounts/types, entries, periods — so a role
can, for example, view the chart of accounts without being able to
post entries or lock a period. See Architecture → Access Control for
the full list.

**User-editable entities get `updated_at` and go through
`CrudForm`/optimistic locking, matching every other module.**
`LedgerAccount`, `LedgerAccountType`, and `FiscalPeriod` are all
user-editable (created, and updated after creation), so per core
`AGENTS.md` § Database Entities they get an `updated_at` column and
participate in the default-ON optimistic lock: `CrudForm`-based edit
pages auto-derive the lock header from `initialValues.updatedAt`; the
non-`CrudForm` `lockFiscalPeriod`/`unlockFiscalPeriod` actions call
`enforceCommandOptimisticLock` with the client-supplied
`x-om-ext-optimistic-lock-expected-updated-at` header. `JournalEntry`/
`JournalEntryLine` stay exempt — they're append-only and immutable by
design (see "Corrections are reversals, not undo" below), matching the
exemption already carved out for append-only logs.

**Phase 1 ships basic API + backend pages for accounts, account
types, and fiscal periods — not command-only.** The User Stories below
describe an accountant managing the chart of accounts and locking a
fiscal period; a command with no caller isn't a shipped capability.
Rather than invent a new UI pattern, this reuses the canonical one:
`makeCrudRoute` + `CrudForm`/`DataTable` for `LedgerAccount` and
`LedgerAccountType` (standard create/edit/list), and a small
non-`CrudForm` list page with lock/unlock row actions for
`FiscalPeriod` (locking isn't a field edit, so it goes through
`useGuardedMutation` instead of `CrudForm`, per `AGENTS.md` → UI &
HTTP). `JournalEntry` stays read-only in the UI in this phase
(`listJournalEntries` only) — nothing in the User Stories asks an
accountant to post entries by hand through a form; every posting in
Phase 1 comes from `postJournalEntry` called programmatically by a
downstream integration (see Out of scope).

**Balance integrity is enforced twice: application and database.**
The command layer validates that debits equal credits before
attempting a write. A deferred constraint trigger on
`journal_entry_line`, checked at transaction commit rather than after
each row insert, additionally makes an unbalanced entry impossible to
persist regardless of what wrote it — including a bug in a command
handler, or code generated by an AI agent that missed the validation
path. Belt-and-suspenders here is deliberate: this is the one table in
the system where "the database quietly went out of balance" is not a
recoverable failure mode.

**`JournalEntry.sequenceNumber` numbers entries consecutively per
organization, allocated atomically — not derived from the UUID
primary key.** Art. 14 ust. 2 Ustawy o rachunkowości requires
journal-book entries to be "kolejno numerowane" (consecutively
numbered) with sums calculated on a continuous basis ("sumy liczone w
sposób ciągły"); a UUID satisfies neither — it isn't sequential, and
offers no way to answer "which entry number is this." `sequenceNumber`
(`bigint`, unique per `(tenant_id, organization_id)`) is allocated
inside the same transaction as `postJournalEntry` via a per-organization
counter row (`journal_entry_sequence`, one row per `(tenant_id,
organization_id)`, incremented with an atomic
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), functionally
equivalent to a Postgres `SEQUENCE` per organization without the
operational overhead of provisioning one `SEQUENCE` object per
organization as organizations are created. This also beats a native
`SEQUENCE`/`nextval()` on correctness: `nextval()` doesn't roll back on
transaction abort, so a failed post would still burn a number and
leave a gap; the counter-row update, being an ordinary row in the same
transaction as the entry insert, rolls back together with a failed
post — no gaps from failed attempts, which honors "sumy liczone w
sposób ciągły" more faithfully than a native sequence would.

**Scoped per organization, not per tenant.** An earlier draft scoped
the counter per `tenant_id` alone, pooling every organization under a
tenant into one shared sequence. That's wrong for this repo's data
model: per the same tenant/organization convention other modules
follow (e.g. `customers`), an `Organization` is where independent
business data actually lives, not a mere subdivision — the safer
assumption is that an `Organization` is a distinct unit under the
Accounting Act, each with its own obligation to keep a continuously
numbered journal, rather than risk pooling numbering across what could
be separate legal entities. Scoping per `(tenant_id, organization_id)`
costs nothing extra (the counter table already needs a composite key
either way) and avoids that risk entirely.

**Numbering stays scoped per organization, not per fiscal year — even
though `FiscalPeriod` is in scope this phase.** Extending the sequence
to reset or partition per fiscal year is a separate scope change that
nobody has asked for now. Per-organization numbering already satisfies
art. 14 ust. 2 (continuous, consecutive numbering); scoping it more
narrowly per period can be added later as a reversible change that
does not invalidate or renumber entries already posted under the
per-organization scheme.

**Corrections are reversals, not undo.** The module deliberately does
not use the generic command undo/redo mechanism to reverse a posted
entry. Undo semantics (restoring prior state, potentially removing a
record) are wrong for accounting data — a posted entry is immutable.
Reversing one means posting a new `JournalEntry` with `type:
'REVERSAL'`, linked to the original via `referenceType`/`referenceId`.
The original stays exactly as posted.

*Art. 25 ust. 2 Ustawy o rachunkowości — decided:* the Act ties the
*obligation* to reverse (storno) rather than correct an entry directly
to a closed accounting period — before a period is closed a direct
correction is permitted, after closure only a storno is allowed. This
spec deliberately keeps the stricter policy: **always a reversal,
never a direct edit, regardless of the covering period's lock state.**
That is more restrictive than Art. 25 ust. 2 requires pre-closure, but
being stricter than the statutory minimum is not a violation, and it
buys one simple invariant — `JournalEntry` is always immutable —
instead of a conditional edit path whose behavior depends on period
state. The conditional pre-closure edit path was considered and
rejected (see Alternatives considered).

**Multi-currency: single currency per entry in this phase, but the
line retains the original-currency amount.** The header
(`JournalEntry.currencyId`, `exchangeRate`) fixes one currency per
transaction; balance validation runs only in the base-currency
`debit`/`credit` columns, which keeps Phase 1 posting logic simple.
`JournalEntryLine.amountCurrency` — the amount in the entry's original
currency — is captured from day one regardless. FX revaluation and
multi-currency reporting are out of scope here, but when that work
starts it reads from data that already exists rather than requiring a
backfill.

**`FiscalPeriod`/`LedgerAccount`/`LedgerAccountType` get a nullable
`deletedAt`, even though no delete route ships for `FiscalPeriod` in
Phase 1.** `packages/core/AGENTS.md`'s standard column contract lists
`deleted_at` for soft delete on user-editable entities.
`LedgerAccount`/`LedgerAccountType`'s `makeCrudRoute` delete operation
is a soft delete (sets `deletedAt`), not a real `DELETE`, blocked once
the account/type has posted entries (see Queries / API) — this makes
the existing "no hard delete once posted" language literal (there was
no column to back any delete at all before this fix) rather than
ambiguous about which kind of delete is even possible. `FiscalPeriod`
gets the column for the same empty-table-costs-nothing reason as
`JournalEntry.referenceType`/`referenceId` above: no delete route is
planned for it in Phase 1, but adding the column to an already-
populated production table later is a real migration, while adding it
to an empty one is free.

**`FiscalPeriod` (fiscal-period locking) stays in this document — not
split into its own dependent spec (resolved 2026-09-07).** An
independent, fresh-context re-run of the checklist's scope-cohesion
check (item 1.2) returned SPLIT, not COHESIVE, for the current scope,
arguing the coupling between posting and period-locking is a single
integration seam (one `isLocked` check inside `postJournalEntry`) and
pointing at this document's own 2026-09-01 (removed, "not a technical
obstacle") → 2026-09-03 (restored on stakeholder correction, not
technical necessity) history as evidence the two are separable — the
same grounds the AR/`sales` integration was already split out on.
Decided anyway to keep both in one document: unlike AR/`sales`,
fiscal-period locking is a core, load-bearing accounting control for
this exact module — Poland's Ustawa o rachunkowości ties period-
closing directly to posting/correction behavior (see the art. 25
ust. 2 discussion below) — not an optional integration with a separate
module. Splitting it would ship a posting engine with no way to lock a
period against further posting: a materially weaker MVP than what's
already been reviewed and stakeholder-approved twice. The SPLIT
finding is accurate as a scope-cohesion observation; it just doesn't
outweigh shipping a complete accounting control in one reviewable unit.

### Alternatives considered

- **Single `direction` enum + `amount` per line** instead of separate
  `debit`/`credit` columns — rejected for the reporting-ergonomics
  reason above; the extra column is a one-time schema cost against a
  recurring query-complexity cost.
- **`reportType` (balance sheet vs. P&L) stored on the account type** —
  rejected. The mapping from account category to financial statement
  is fixed by accounting rules, not configurable per deployment;
  storing a value that's a deterministic function of another column is
  redundant state that can drift. Derived in code instead
  (`mapAccountTypeToStatement`).
- **A conditional pre-closure direct-edit path for journal entries**
  (permitted by Art. 25 ust. 2 before the covering period is locked) —
  rejected. It would make `JournalEntry` mutability depend on the
  covering `FiscalPeriod`'s lock state; a single unconditional "always
  reversal, never edit" invariant is simpler to implement and reason
  about, and remains lawful (stricter than the Act's pre-closure
  minimum). See the Art. 25 ust. 2 note above.
- **A ledger-owned `Currency` entity** instead of reusing
  `currencies.Currency` — rejected; see "Currency is reused..." above.
- **Building the `sales` invoice integration in this spec** instead of
  a dependent follow-up — rejected on scope-cohesion grounds: the
  posting engine is independently useful and testable without any
  document-producing module wired to it (that's the whole point of
  User Story 1), so bundling an integration in would mix two
  independently-deployable capabilities into one spec and one PR. See
  Out of scope.

## User Stories

- An implementer of a downstream financial capability (AP, AR, Cash
  Management, a country tax plugin) can post a balanced journal entry
  against the ledger without knowing anything about `sales` or any
  other document-producing module.
- An accountant manages the chart of accounts (account types,
  accounts) through the backend UI.
- An accountant locks a fiscal period so that no further postings land
  in it (and unlocks it again if a correction is needed before final
  closure), seeing exactly which entry closed the year if a `CLOSING`
  entry was posted.
- An accountant correcting a mistake posts a reversal and still sees
  the original, unmodified entry in the ledger — nothing about a
  posted entry's history is ever hidden or overwritten.
- A future integrator (an invoice-posting flow, a legacy-data import)
  can trace a journal entry back to the record that caused it via
  `referenceType`/`referenceId`, without a schema change.

## Architecture

### Entities (`data/entities.ts`)

- `FiscalPeriod` — `startDate`, `endDate`, `isLocked`, `updatedAt`,
  `deletedAt` (nullable — see Design decisions), tenant/org scoped.
  User-editable, so it carries `updated_at` and participates in the
  default-ON optimistic lock like `LedgerAccount`/`LedgerAccountType`
  (see Design decisions). No `Currency` entity — see Design decisions.
- `LedgerAccountGroup` — `jurisdiction`, `code`, `name`, tenant/org
  scoped like every other entity here (see Design decisions). Seeded
  via `setup.ts`'s `seedDefaults` (Phase 1: `jurisdiction: 'PL'` only,
  hardcoded — no jurisdiction-selection mechanism exists yet), not
  user-editable through any command. No `updatedAt` — immutable,
  system-seeded rows.
- `LedgerAccountType` — `slug`, `name`, `normalBalance`
  (`DEBIT`/`CREDIT`), `parentAccountTypeId` (nullable, self-reference),
  `accountGroupId` (nullable FK to `LedgerAccountGroup`, immutable
  once any account of that type has posted entries — see Design
  decisions), `updatedAt`, `deletedAt` (nullable, soft delete — see
  Design decisions).
- `LedgerAccount` — `slug`, `accountTypeId` (immutable once the
  account has posted entries — see Design decisions), `parentAccountId`
  (nullable, self-reference — see Design decisions), tenant/org
  scoped, `description`, `updatedAt`, `deletedAt` (nullable, soft
  delete — see Design decisions).
- `JournalEntry` — `sequenceNumber` (`bigint`, unique per
  `(tenant_id, organization_id)`, allocated atomically — see Design
  decisions), `postedAt`,
  `description`, `type` (`NORMAL`/`OPENING`/`CLOSING`/`REVERSAL`), `currencyId`
  (FK-id, `uuid`, references `currencies.Currency.id` — no ORM
  relation), `exchangeRate`, `referenceType`, `referenceId`,
  tenant/org scoped. No `updatedAt` — append-only, immutable once
  posted (exempt from optimistic locking, see Design decisions).
- `JournalEntryLine` — `journalEntryId`, `accountId`, `debit`,
  `credit` (`numeric(19,4)`), `amountCurrency`,
  `contractorSnapshot` (nullable `json` — see Design decisions),
  `organizationId`, `tenantId` (own scope columns, not just inherited
  via `journalEntryId` — see Design decisions). Same exemption as
  `JournalEntry`.

### Access Control (`acl.ts`)

Following the `customers` module convention (`<module>.<resource>.view`
/ `.manage`, `manage` depends on `view`):

```typescript
export const features = [
  { id: 'ledger.accounts.view', title: 'View chart of accounts', module: 'ledger' },
  { id: 'ledger.accounts.manage', title: 'Manage chart of accounts', module: 'ledger', dependsOn: ['ledger.accounts.view'] },
  { id: 'ledger.entries.view', title: 'View journal entries', module: 'ledger' },
  { id: 'ledger.entries.post', title: 'Post and reverse journal entries', module: 'ledger', dependsOn: ['ledger.entries.view'] },
  { id: 'ledger.periods.view', title: 'View fiscal periods', module: 'ledger' },
  { id: 'ledger.periods.manage', title: 'Create, lock and unlock fiscal periods', module: 'ledger', dependsOn: ['ledger.periods.view'] },
]
```

`createLedgerAccount`/`updateLedgerAccount`/`createLedgerAccountType`/
`updateLedgerAccountType` require `ledger.accounts.manage`;
`postJournalEntry`/`reverseJournalEntry` require `ledger.entries.post`;
`createFiscalPeriod`/`lockFiscalPeriod`/`unlockFiscalPeriod` require
`ledger.periods.manage`.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: ['ledger.*'],
  employee: [
    'ledger.accounts.view',
    'ledger.entries.view',
    'ledger.periods.view',
  ],
},

async seedDefaults({ em, tenantId, organizationId }) {
  // Seeds `LedgerAccountGroup` rows for jurisdiction 'PL' (zespoły
  // 0-8) into this organization's scope. Hardcoded to 'PL' in Phase
  // 1 — no jurisdiction-selection mechanism exists yet (see Design
  // decisions).
  await seedPolishAccountGroups(em, { tenantId, organizationId })
},
```

Employees get read access (viewing the chart of accounts, journal, and
period status); posting, chart-of-accounts edits, and period
locking/unlocking stay admin-only by default, consistent with the
customers module's `admin: ['customers.*']` pattern.
`onTenantCreated` still has no hook in Phase 1 — no default chart of
accounts (`LedgerAccountType`/`LedgerAccount`) is seeded; tenants build
their own. `seedDefaults` is the one exception: it seeds
`LedgerAccountGroup` (system reference data, not the tenant's own
chart of accounts) into every organization's scope, following the same
convention `currencies/setup.ts` already uses for its own reference
data.

### Migration (`migrations/`)

Standard MikroORM-generated tables for the entities above, plus a hand-
written SQL block (consistent with how this repo already mixes
generated and raw SQL in migrations) adding:

```sql
CREATE CONSTRAINT TRIGGER journal_entry_line_balanced
  AFTER INSERT OR UPDATE ON journal_entry_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE PROCEDURE assert_journal_entry_balanced();
```

`assert_journal_entry_balanced()` raises if
`SUM(debit) != SUM(credit)` for the affected `journal_entry_id` at
commit time.

The same migration adds a per-organization counter table backing
`JournalEntry.sequenceNumber` (see Design decisions):

```sql
CREATE TABLE journal_entry_sequence (
  tenant_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, organization_id)
);
```

`postJournalEntry` allocates the next value inside the posting
transaction via
`INSERT INTO journal_entry_sequence (tenant_id, organization_id, next_value) VALUES ($1, $2, 2)
ON CONFLICT (tenant_id, organization_id) DO UPDATE SET next_value = journal_entry_sequence.next_value + 1
RETURNING next_value - 1`, storing the result on
`journal_entry.sequence_number`, which carries a
`UNIQUE (tenant_id, organization_id, sequence_number)` constraint.

Supporting indexes for the `journal-entries` list filters (see API
Contracts): `(organization_id, posted_at)` on `journal_entry` backs the
`periodId` date-range filter and default post-date ordering;
`(organization_id, account_id)` on `journal_entry_line` backs the
`accountId` filter; `(organization_id, reference_type, reference_id)`
on `journal_entry` backs the `referenceType`/`referenceId` pair.

### Commands (Command Pattern, `commands/`)

- `postJournalEntry` — validates the `FiscalPeriod` covering
  `postedAt` is not `isLocked` (rejects before any write), validates
  debit/credit balance, atomically allocates the next per-organization
  `sequenceNumber`, persists entry + lines in one transaction. Emits
  `ledger.journal_entry.posted` (ephemeral) after commit — see Events
  below; this is the only way other modules (e.g. Posting Rules
  Engine) may react, per `packages/events/AGENTS.md`'s ban on direct
  cross-module calls. Requires `ledger.entries.post`.
- `reverseJournalEntry` — posts a new `REVERSAL` entry with inverted
  lines, referencing the original; does not mutate the original.
  Requires `ledger.entries.post`.
- `createFiscalPeriod` — creates a period (`startDate`, `endDate`,
  `isLocked: false`). Requires `ledger.periods.manage`.
- `lockFiscalPeriod` / `unlockFiscalPeriod` — toggles `isLocked`,
  enforces `enforceCommandOptimisticLock` against the caller's
  `x-om-ext-optimistic-lock-expected-updated-at` header. Requires
  `ledger.periods.manage`.
- `createLedgerAccount` / `updateLedgerAccount` — standard CRUD via
  `runCrudCommandWrite`, following the module's existing command
  conventions; `updateLedgerAccount` rejects an `accountTypeId` change
  once the account has posted entries (the invariant the Testing
  Strategy checks). Requires `ledger.accounts.manage`.
- `createLedgerAccountType` / `updateLedgerAccountType` — standard
  CRUD; `updateLedgerAccountType` rejects a `normalBalance` or
  `accountGroupId` change when any account of that type has posted
  entries (the invariant the Testing Strategy checks). Requires
  `ledger.accounts.manage`.

### Events (`events.ts`)

- `ledger.journal_entry.posted` — emitted by `postJournalEntry` after
  the entry commits. Ephemeral (in-process, no retry) — matches the
  "real-time UI updates" use case in `packages/events/AGENTS.md`, not
  a durability guarantee. This module has no subscribers of its own;
  it exists so a downstream module (e.g. Posting Rules Engine) can
  react without `ledger` importing or resolving that module — `ledger`
  stays fully generic and has no knowledge of zespoły, konto 490, or
  any jurisdiction-specific concept.

### Queries / API

- Every route file under `api/` exports `openApi` (via
  `buildModuleCrudOpenApi` for the three `makeCrudRoute` resources,
  plus a hand-written schema for the read-only `journal-entries` list
  and the custom lock/unlock routes) per `packages/core/AGENTS.md` →
  API Routes. See File Manifest (`api/openapi.ts`).
- `api/journal-entries/route.ts` — `listJournalEntries`, standard
  `makeCrudRoute` read-only list (no `create`), filterable by account,
  period, type, reference. `accountId` joins through
  `JournalEntryLine.accountId` (no such column on `JournalEntry`
  itself); `periodId` resolves the named `FiscalPeriod`'s
  `startDate`/`endDate` and filters by `postedAt` within that range —
  an application-layer range filter, not a stored FK (see API
  Contracts, Data Models). Requires `ledger.entries.view`. See API
  Contracts.
- `api/accounts/route.ts`, `api/account-types/route.ts` — standard
  `makeCrudRoute` CRUD (list/create/update/soft-delete via
  `deletedAt`; delete blocked once an account/type has posted
  entries), backing the `CrudForm` pages below. URLs:
  `/api/ledger/accounts`, `/api/ledger/account-types`.
- `api/fiscal-periods/route.ts` — `makeCrudRoute` list/create; lock/
  unlock are separate custom write routes
  (`api/fiscal-periods/[id]/lock/route.ts`, `.../unlock/route.ts`,
  URLs `/api/ledger/fiscal-periods/:id/lock` etc.) wired through the
  mutation guard registry (mapped to the `update` operation) per
  `AGENTS.md` → API Routes, since toggling `isLocked` isn't a
  field-level CRUD edit. No delete route ships for `FiscalPeriod` in
  Phase 1; its `deletedAt` column exists for column-contract
  consistency only (see Design decisions).

### Backend Pages (`backend/ledger/`)

- `accounts/page.tsx` (+ `create/page.tsx`, `[id]/page.tsx`) —
  `DataTable` + `CrudForm` for `LedgerAccount`.
- `account-types/page.tsx` (+ create/edit) — same pattern for
  `LedgerAccountType`.
- `fiscal-periods/page.tsx` (+ `create/page.tsx`) — `DataTable` with a
  lock/unlock row action. Locking isn't a field edit, so the action
  goes through `RowActions` + `useGuardedMutation` (not `CrudForm`),
  passing `retryLastMutation` in the injection context and surfacing
  409s via `surfaceRecordConflict` — the same guarded-row-action
  pattern
  `packages/core/src/modules/resources/backend/resources/resources/page.tsx`
  already uses.
- `journal-entries/page.tsx` — read-only `DataTable` over
  `listJournalEntries`; no create/edit UI in Phase 1.

## API Contracts

### `GET /api/ledger/journal-entries`

Standard `makeCrudRoute` paginated list.

- **Query**: `page?`, `pageSize?` (≤100), `accountId?`, `periodId?`,
  `type?` (`NORMAL|OPENING|CLOSING|REVERSAL`), `referenceType?`,
  `referenceId?`.
- `accountId` filters to entries with at least one matching
  `JournalEntryLine.accountId` (a join through `journal_entry_line` —
  `JournalEntry` itself carries no `accountId` column; see Data
  Models). `periodId` is resolved server-side to the named
  `FiscalPeriod`'s `startDate`/`endDate` and applied as a `postedAt`
  range filter — `JournalEntry` has no `periodId` column or FK either
  (see Data Models). Both are supported by indexes named in Migration.
- **Response 200**: `{ items: JournalEntryDto[], total: number, page: number, pageSize: number }`
  where `JournalEntryDto` is `{ id, sequenceNumber, postedAt, description, type, currencyId, exchangeRate, referenceType, referenceId, lines: { id, accountId, debit, credit, amountCurrency }[] }`.
- **Response 403**: caller lacks `ledger.entries.view`.
- No `POST`/`PUT`/`DELETE` on this route — posting only happens
  through `postJournalEntry`/`reverseJournalEntry`.

### `POST /api/ledger/fiscal-periods` / `GET /api/ledger/fiscal-periods`

Standard `makeCrudRoute` create + paginated list.

- **Create body**: `{ startDate, endDate }` — `isLocked` defaults to
  `false`; not settable on create.
- **List response 200**: `{ items: FiscalPeriodDto[], total, page, pageSize }`
  where `FiscalPeriodDto` is `{ id, startDate, endDate, isLocked, updatedAt }`.
- **Response 403**: caller lacks `ledger.periods.view` (list) or
  `ledger.periods.manage` (create).

### `POST /api/ledger/fiscal-periods/:id/lock` / `.../unlock`

Custom write routes wired through the mutation guard registry
(mapped to `update`).

- **Headers**: `x-om-ext-optimistic-lock-expected-updated-at:
  <FiscalPeriod.updatedAt>` (optional; enforced per the repo's
  default-ON optimistic-lock contract).
- **Response 200**: `{ id, isLocked, updatedAt }`.
- **Response 409**: `OptimisticLockConflictBody` — the period was
  edited concurrently; client refetches and retries via
  `retryLastMutation`.
- **Response 403**: caller lacks `ledger.periods.manage`.

`LedgerAccount`/`LedgerAccountType`/`FiscalPeriod` list/create/update
follow the standard `makeCrudRoute` request/response shape (see
`packages/core/AGENTS.md` → CRUD Routes) — not repeated here since
none of it is unique to this module.

## Data Models

### FiscalPeriod

One row per accounting period (`startDate`, `endDate`). `isLocked`
starts `false`; `postJournalEntry` rejects any entry whose `postedAt`
falls within a locked period, before any write. `updatedAt` backs the
optimistic lock on the lock/unlock actions. `deletedAt` exists for
column-contract consistency; no delete route is exposed for
`FiscalPeriod` in Phase 1 (see Design decisions).

### LedgerAccountGroup

Tenant/org scoped (`jurisdiction`, `code`, `name`) — not created or
edited by tenants through any command; populated only by `setup.ts`'s
`seedDefaults` hook. Phase 1 hardcodes `jurisdiction: 'PL'` for every
organization (zespoły 0–8); choosing a jurisdiction per organization is
explicitly deferred (see Design decisions) — adding another
jurisdiction's dictionary later needs only new seed data, not a schema
change.

### LedgerAccountType

Hierarchical. `normalBalance` is required and immutable once any
account of that type has posted entries — enforced by
`updateLedgerAccountType`, which checks for posted `JournalEntryLine`
rows against accounts of that type before allowing the change.
`accountGroupId` (nullable FK to `LedgerAccountGroup`) carries the
same immutability guard, for the same reason (see Design decisions).
`deletedAt` backs a soft delete via `makeCrudRoute`, blocked once the
type has posted entries.

### LedgerAccount

One row per account; `slug` unique per (tenant, organization).
`parentAccountId` (nullable, self-reference) models the Chart-of-
Accounts hierarchy — e.g. a bank or fixed-asset account under its
synthetic parent. Structural only this phase: nothing enforces or
reads it yet (see Design decisions, Out of scope). `accountTypeId` is
immutable once the account has posted entries — enforced by
`updateLedgerAccount`, the same class of guard as `normalBalance`/
`accountGroupId` on `LedgerAccountType` (see Design decisions).
`deletedAt` backs a soft delete via `makeCrudRoute`, blocked once the
account has posted entries.

### JournalEntry / JournalEntryLine

A `JournalEntry` with zero or one line is invalid — every posted entry
must have at least two lines and must balance. Enforced by the
application layer and the database trigger described above.
`sequenceNumber` is unique per organization and gapless in posting order —
allocated atomically as part of the same transaction that inserts the
entry, so a failed post never consumes a number (see Design
decisions).

`JournalEntryLine.contractorSnapshot` (nullable `json`) captures a
point-in-time copy of the counterparty's name, NIP, bank account and
Biała Lista verification status at posting time — see Design decisions
and `.ai/specs/2026-09-06-contractor-registry.md`. Not populated by
anything in this phase; it exists so Accounts Payable can write to it
without a follow-up migration.

`JournalEntryLine` carries its own `organizationId`/`tenantId`
(matching `sales.SalesInvoiceLine`'s precedent — see Design decisions),
not only the scope inherited through `journalEntryId`.

Neither `periodId` nor `accountId` is a column on `JournalEntry` — the
`journal-entries` list's `periodId` and `accountId` query filters
resolve via `FiscalPeriod.startDate`/`endDate` and
`JournalEntryLine.accountId` respectively (see API Contracts,
Queries / API).

## Implementation Plan

### Phase 1: Posting engine

1. Add `FiscalPeriod`, `LedgerAccountType`, `LedgerAccount`
   (including the nullable, self-referencing `parentAccountId`),
   `JournalEntry` (including `sequenceNumber`), `JournalEntryLine`
   (including the nullable `contractorSnapshot` `json` column)
   entities (with `updated_at` on the three editable ones) and their
   migration, including the deferred balance-check constraint trigger
   and the per-organization `journal_entry_sequence` counter table. No
   `Currency` entity — `JournalEntry.currencyId` is a plain FK-id
   column to `currencies.Currency.id`. Add `encryption.ts` declaring
   `defaultEncryptionMaps` for `JournalEntryLine.contractorSnapshot`
   (PII — see Design decisions) in the same step, since the column and
   its encryption declaration ship together.
2. Add `acl.ts` (six features) and `setup.ts` (`defaultRoleFeatures`
   for `admin`/`employee`); run `yarn mercato auth sync-role-acls`.
3. Implement `postJournalEntry`, validating the covering fiscal
   period's lock state and debit/credit balance, and atomically
   allocating the next per-organization `sequenceNumber`, before
   persisting entry + lines in one transaction.
4. Implement `reverseJournalEntry`, posting a linked `REVERSAL` entry
   without mutating the original.
5. Implement `createFiscalPeriod`, `lockFiscalPeriod` /
   `unlockFiscalPeriod` (with `enforceCommandOptimisticLock`) behind
   `ledger.periods.manage`.
6. Implement `createLedgerAccount` / `updateLedgerAccount`,
   `createLedgerAccountType` / `updateLedgerAccountType` (with the
   `normalBalance`-immutability check) behind `ledger.accounts.manage`.
7. Implement `api/journal-entries/route.ts` (`listJournalEntries`,
   including the `periodId` date-range resolution and the
   `accountId` join through `JournalEntryLine`), `api/accounts/route.ts`,
   `api/account-types/route.ts`, `api/fiscal-periods/route.ts` + the
   lock/unlock custom routes, and `api/openapi.ts` exporting `openApi`
   for every route above.
8. Build the backend pages: `accounts/`, `account-types/`
   (`CrudForm`/`DataTable`), `fiscal-periods/` (`DataTable` +
   lock/unlock row action), `journal-entries/` (read-only
   `DataTable`).
9. Add regression coverage for balanced/unbalanced posting,
   locked-period rejection, reversal linkage, per-organization
   `sequenceNumber` allocation under concurrency, and optimistic-lock
   conflicts on period lock/unlock and account/type updates.
10. Add integration test coverage for `api/journal-entries/route.ts`
    (list/filter, 403 without `ledger.entries.view`) and the
    `fiscal-periods` lock/unlock routes (200, 409 on stale
    `updated_at`, 403 without `ledger.periods.manage`) per
    `AGENTS.md:164` / `.ai/qa/AGENTS.md`.
11. Run `yarn generate`, typecheck, focused unit + integration tests,
    and manual QA against a fresh local database (create a chart of
    accounts, post a manual journal entry, lock a period and confirm a
    further post is rejected, confirm entries appear correctly in the
    journal entries list).

### File Manifest

| File | Action | Purpose |
| --- | --- | --- |
| `data/entities.ts` | Create | `FiscalPeriod`, `LedgerAccountGroup`, `LedgerAccountType` (incl. `accountGroupId`), `LedgerAccount` (incl. `parentAccountId`), `JournalEntry` (incl. `sequenceNumber`), `JournalEntryLine` (incl. `contractorSnapshot`) |
| `lib/seeds.ts` | Create | `seedPolishAccountGroups(em, { tenantId, organizationId })` — seeds tenant/org-scoped `LedgerAccountGroup` rows for `jurisdiction: 'PL'` (zespoły 0–8), called from `setup.ts`'s `seedDefaults`; other jurisdictions added later as pure data |
| `encryption.ts` | Create | `defaultEncryptionMaps` for `ledger:journal_entry_line.contractor_snapshot` (PII duplicated from Contractor Registry — see Design decisions) |
| `migrations/MigrationXXXXXXXXXXXXXX.ts` | Create | Tables for the entities above plus the deferred balance-check constraint trigger and the per-organization `journal_entry_sequence` counter table |
| `acl.ts` | Create | Six `ledger.*` features |
| `setup.ts` | Create | `defaultRoleFeatures` for `admin`/`employee`; `seedDefaults` seeding `LedgerAccountGroup` (jurisdiction `'PL'`, hardcoded) into each organization |
| `commands/postJournalEntry.ts` | Create | Validate the covering period is unlocked, validate and persist a balanced journal entry, atomically allocating the next per-organization `sequenceNumber` |
| `events.ts` | Create | Declares `ledger.journal_entry.posted` (ephemeral), emitted by `postJournalEntry` after commit |
| `commands/reverseJournalEntry.ts` | Create | Post a linked reversal without mutating the original |
| `commands/fiscalPeriods.ts` | Create | `createFiscalPeriod`, `lockFiscalPeriod` / `unlockFiscalPeriod` with optimistic-lock enforcement |
| `commands/ledgerAccounts.ts` | Create | `createLedgerAccount` / `updateLedgerAccount` with the `accountTypeId`-immutability guard |
| `commands/ledgerAccountTypes.ts` | Create | `createLedgerAccountType` / `updateLedgerAccountType` with the `normalBalance`/`accountGroupId`-immutability guard |
| `api/openapi.ts` | Create | `openApi` exports for all `ledger` routes — `buildModuleCrudOpenApi` for the three `makeCrudRoute` resources, hand-written schema for `journal-entries` (read-only) and the lock/unlock custom routes |
| `api/journal-entries/route.ts` | Create | `listJournalEntries`, paginated and filterable, read-only |
| `api/accounts/route.ts` | Create | `LedgerAccount` CRUD (`makeCrudRoute`) |
| `api/account-types/route.ts` | Create | `LedgerAccountType` CRUD (`makeCrudRoute`) |
| `api/fiscal-periods/route.ts` | Create | `FiscalPeriod` list/create (`makeCrudRoute`) |
| `api/fiscal-periods/[id]/lock/route.ts`, `.../unlock/route.ts` | Create | Custom guarded write routes toggling `isLocked` |
| `backend/ledger/accounts/page.tsx` (+ create/[id]) | Create | `LedgerAccount` list/create/edit UI |
| `backend/ledger/account-types/page.tsx` (+ create/[id]) | Create | `LedgerAccountType` list/create/edit UI |
| `backend/ledger/fiscal-periods/page.tsx` (+ create) | Create | Period list with lock/unlock row action |
| `backend/ledger/journal-entries/page.tsx` | Create | Read-only journal entry list |
| `commands/__tests__/*` | Create | Regression coverage for all commands above |
| `__integration__/*` | Create | Integration coverage for `journal-entries` list and `fiscal-periods` lock/unlock routes |

## Testing Strategy

- Post a balanced entry (debits equal credits) and assert it persists
  with all lines.
- Attempt to post an unbalanced entry and assert both the application-
  layer validation and the database trigger reject it.
- Attempt to post an entry whose `postedAt` falls in a locked fiscal
  period and assert the command rejects it before any write; assert
  the same entry posts successfully once the period is unlocked.
- Assert `createFiscalPeriod`/`lockFiscalPeriod`/`unlockFiscalPeriod`
  return 403 without `ledger.periods.manage` and succeed with it.
- Reverse a posted entry and assert a new, linked `REVERSAL` entry is
  created while the original is unchanged.
- Post a balanced `OPENING` entry establishing a permanent account's
  beginning-of-year balance and assert it persists and posts exactly
  like a `NORMAL` entry — same balance check, same locked-period
  rejection, same `sequenceNumber` allocation — since `postJournalEntry`
  has no special-casing for `type: 'OPENING'` (Design decisions).
- Post two journal entries concurrently for the same organization and
  assert they receive different, consecutive `sequenceNumber` values
  with no gap or collision; assert a failed post (e.g. unbalanced)
  does not consume a `sequenceNumber`.
- Post entries for two different organizations under the same tenant
  and assert their `sequenceNumber` series are independent — each
  organization starts at 1 and neither organization's postings advance
  or are visible in the other's sequence (numbering never mixes across
  organizations within a tenant).
- Assert `referenceType`/`referenceId` persist correctly when
  provided, and remain null when omitted.
- Assert `updateLedgerAccountType` rejects a `normalBalance` or
  `accountGroupId` change once an account of that type has posted
  entries, and allows either beforehand.
- Assert `updateLedgerAccount` rejects an `accountTypeId` change once
  the account has posted entries, and allows it beforehand.
- Assert `lockFiscalPeriod`/`unlockFiscalPeriod` and
  `updateLedgerAccount`/`updateLedgerAccountType` return a 409 with
  `OptimisticLockConflictBody` on a stale `updated_at`, and succeed
  with the current one.
- Assert deleting a `LedgerAccount`/`LedgerAccountType` sets
  `deletedAt` (not a real row removal) and is rejected once the
  account/type has posted entries; assert a soft-deleted account/type
  is excluded from list results.
- Assert `GET /api/ledger/journal-entries?periodId=` returns only
  entries whose `postedAt` falls within that `FiscalPeriod`'s
  `startDate`/`endDate`, and `?accountId=` returns only entries with a
  matching `JournalEntryLine.accountId`.
- Integration: `GET /api/ledger/journal-entries` returns filtered
  results and 403s without `ledger.entries.view`; the `fiscal-periods`
  lock/unlock routes return 200 / 409 (stale `updated_at`) / 403
  (missing `ledger.periods.manage`) as specified in API Contracts.

## Risks & Impact Review

### Data integrity failures

Covered by the two-layer balance check (application + deferred
constraint trigger). The trigger is the backstop for any code path
that bypasses the command layer.

### Cascading failures & side effects

None expected — this module has no write path into any other module's
tables in this phase. `referenceType`/`referenceId` are stored but not
validated against other modules' data, since nothing populates them
in this spec — see the dependent `sales-invoice-gl-posting` spec
(planned, not yet drafted), which will be the first consumer and will
own that failure-isolation story.

### Tenant & data isolation

`FiscalPeriod`, `LedgerAccount`, `LedgerAccountType`,
`LedgerAccountGroup`, `JournalEntry`, and `JournalEntryLine` are all
tenant/organization scoped, following the same pattern used elsewhere
in the repo (`JournalEntryLine` and `LedgerAccountGroup` carry their
own scope columns rather than relying only on a parent join — see
Design decisions).

### Migration & deployment

Additive only — new tables, no changes to existing schema. Safe to
deploy independently of any other module.

## Out of scope (tracked separately)

- Integration with `sales` invoices (auto-posting Accounts Receivable
  on invoice issue/payment) — a dependent follow-up spec (not yet
  drafted; planned path `.ai/specs/2026-08-18-sales-invoice-gl-posting.md`),
  once this engine is implemented. Kept separate from this spec on
  scope-cohesion
  grounds (see Alternatives considered): the posting engine is
  independently useful and independently reviewable without it.
- Accounts Payable / Cash Management modules — depend on this engine,
  not built here.
- **Balance calculation.** `getAccountBalance` and the
  `GET /api/ledger/accounts/:id/balance` route are cut from Phase 1 —
  a stakeholder-directed scope reduction (@lchrusciel, PR #5663) — to
  validate Chart of Accounts + Journal Entries first. Balance
  computation is a read-model concern that layers on later without
  changing the posting schema. Not listed as required by the Event
  Storming brief.
- **Automated period-closing and period-opening entry generation.**
  Both the `CLOSING` and `OPENING` `JournalEntry` types *are* in scope
  (see Proposed Solution / Design decisions) — a year-end close and a
  new year's opening balances are each posted as an ordinary entry, by
  hand or by a script. What stays out of scope, symmetrically for both,
  is an automated generator: for `CLOSING`, one that identifies the
  result accounts, computes the transfer to Retained Earnings, and
  emits the closing entry's lines; for `OPENING`, one that reads the
  prior year's post-closing trial balance and emits the opening
  entry's lines automatically. Both generators are a distinct piece of
  work from the posting engine, need a real balance/trial-balance read
  side to compute from (Balance calculation, above), and return in a
  future phase; the `CLOSING`/`OPENING` types keep the door open for
  them without requiring either now.
- **Subsidiary ledgers (księgi pomocnicze).** Per-counterparty
  (kontrahent) sub-ledgers tracking receivables/payables in natural
  and monetary units (art. 13 ust. 1 pkt 3, art. 16 Ustawy o
  rachunkowości) are out of scope for this phase — they fall naturally
  out of a future Accounts Payable / Accounts Receivable module built
  on top of this engine, not out of the posting engine itself. **Realized
  (2026-09-08):** this is exactly what `2026-09-06-accounts-
  payable.md` implements — `liabilityAccountId` as the single shared
  control account, with `VendorInvoice`/`accounts_payable_payments`
  (application tables, keyed by `vendorId`) as the subsidiary ledger,
  not a second GL-level mechanism. Confirms this prediction rather
  than changing it.
- **Multi-dimensional posting tags (`journal_entry_line_dimension`).**
  Contextual analytics — MPK/cost-centre, rachunek bankowy, środek
  trwały, waluta — often apply more than one at a time to the same
  line (e.g. a cost centre on the debit line and a bank account tag
  on the credit line of one purchase), so they can't be modelled by
  `LedgerAccount.parentAccountId` alone without exploding the chart of
  accounts into dead combinations. Needs a dedicated table
  (`dimensionType`, `dimensionId`, FK to the line — many rows per
  line) plus the posting-rule logic that uses it (e.g. reject a direct
  post to an account that has children — only its analytic leaves are
  postable). Ships together with the posting-rules/konto 490 engine in
  a future spec, not here. Distinct from `JournalEntryLine.contractorSnapshot`
  (see Design decisions): the snapshot is a denormalized, point-in-time
  audit copy on the line itself; this table is the queryable,
  structured reporting dimension used for per-MPK summaries. The two
  coexist for different purposes once both exist. **Correction
  (2026-09-08):** kontrahent was originally listed here too as a
  candidate dimension type. Once `2026-09-06-journal-entry-line-
  dimension.md` was actually drafted, it deliberately excluded the
  counterparty from this table — it's handled entirely by
  `contractorSnapshot`, not a dimension row, for audit reasons (a
  snapshot at posting time, not a live reference). The list above and
  the example are corrected accordingly; this table's actual dimension
  types are cost centre/project, bank account, fixed asset, and
  currency.
- **Multi-currency FX revaluation and reporting.** Scoped narrowly:
  this is period-end revaluation of open foreign-currency balances to
  a current rate (wycena bilansowa), not the transactional exchange-
  rate difference realized when a foreign-currency document settles
  at a different rate than it was booked at — that case is already
  covered by `JournalEntry.currencyId`/`exchangeRate` (a normal
  balanced posting with a realized-FX-gain/loss line) and needs no
  change here. Revaluation is a scheduled, balance-level recompute —
  a future Multi-Currency spec, not this posting engine.
- Country-specific tax/compliance plugins.

## Final Compliance Report — 2026-08-27 (updated 2026-09-03, 2026-09-07)

The 2026-09-01 update was a consistency pass reflecting the Fiscal
Period / Balance calculation scope reduction; the 2026-09-03 update
restores Fiscal Period (locking) to scope per stakeholder correction
(see Changelog), leaving Balance calculation out. Neither was a full
compliance audit rerun from scratch. The 2026-09-07 update **is** a
full re-verification: it accounts for everything added since 2026-09-03
— `LedgerAccountGroup` (multi-country account classification),
`LedgerAccount.accountTypeId`/`LedgerAccountType.accountGroupId`
immutability guards, the new `events.ts` (`ledger.journal_entry.posted`),
and `JournalEntryLine.organizationId`/`tenantId` — and catches two
compliance issues introduced by this session's own earlier drafts
before they could reach review (see Compliance Matrix and Changelog).
A same-day follow-up round, prompted by running an independent,
fresh-context verification against this checklist and against the
real `AGENTS.md`/source files on disk (not against this document's own
prior self-report), found and fixed four further gaps — missing
`openApi` compliance, undesigned `periodId`/`accountId` API filters, a
dangling reference to a spec file that does not exist
(`sales-invoice-gl-posting.md`), and a missing `deletedAt` column on
three user-editable entities. It also surfaced a genuine scope-
cohesion question (SPLIT vs. COHESIVE for `FiscalPeriod`), resolved the
same day by explicit stakeholder decision to keep this document as one
spec — see Design decisions and Changelog.

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/currencies/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/ui/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| `AGENTS.md` | No direct ORM relationships between modules | Compliant | No entity references another module's entity by ORM relation; `currencyId` and `referenceType`/`referenceId` are plain FK-id columns, fetched separately |
| `AGENTS.md` | Filter by tenant/organization | Compliant | `FiscalPeriod`, `LedgerAccount`, `LedgerAccountType`, `LedgerAccountGroup`, `JournalEntry`, `JournalEntryLine` are all tenant/org scoped (`JournalEntryLine` carries its own columns, matching the `sales.SalesInvoiceLine` precedent, not only scope inherited via `journalEntryId`) |
| `AGENTS.md` | Write operations via Command pattern | Compliant | All mutations go through `postJournalEntry`, `reverseJournalEntry`, `createFiscalPeriod`/`lockFiscalPeriod`/`unlockFiscalPeriod`, `createLedgerAccount`/`updateLedgerAccount`, `createLedgerAccountType`/`updateLedgerAccountType` |
| `AGENTS.md` / core `AGENTS.md` | Declarative feature guards; `acl.ts` features synced to `setup.ts` `defaultRoleFeatures` | Compliant | `acl.ts` (six features across accounts/entries/periods) + `setup.ts` added (Architecture → Access Control / Module Setup); `yarn mercato auth sync-role-acls` in Implementation Plan step 2 |
| Core `AGENTS.md` § Database Entities | User-editable entities MUST include `updated_at` for optimistic locking | Compliant | `FiscalPeriod`, `LedgerAccount`, `LedgerAccountType` have `updatedAt`; `CrudForm` auto-derives the lock header, `lockFiscalPeriod`/`unlockFiscalPeriod` call `enforceCommandOptimisticLock` explicitly. `JournalEntry`/`JournalEntryLine` are exempt (append-only) |
| Root `AGENTS.md:164` / `.ai/qa/AGENTS.md` | New feature MUST list integration coverage for affected API paths, shipped in the same change | Compliant | Implementation Plan step 10 + Testing Strategy cover `journal-entries` list and `fiscal-periods` lock/unlock as integration tests |
| `currencies/AGENTS.md` | MUST NOT reinvent currency/exchange-rate storage | Compliant | No `Currency` entity in this module; `currencyId` is an FK-id to the existing `currencies.Currency` |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | New tables only; no existing schema touched |
| `packages/core/AGENTS.md` → Encryption | GDPR-relevant fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | Compliant | `contractorSnapshot` (PII: name/NIP/bank account) declared in new `ledger/encryption.ts` — see Design decisions and File Manifest |
| `packages/events/AGENTS.md` | Cross-module side effects only via declared events + subscribers; upstream module MUST NOT import/resolve a downstream consumer | Compliant | `ledger.journal_entry.posted` (ephemeral) declared in new `events.ts`; `ledger` has no subscribers of its own and no knowledge of any consumer (e.g. Posting Rules Engine) — see Architecture → Events |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant (fixed 2026-09-07) | `api/openapi.ts` added to File Manifest and Implementation Plan step 7; every route, including the read-only `journal-entries` list and the custom lock/unlock routes, exports `openApi` — gap found by an independent review, absent from every earlier draft/round |
| `packages/core/AGENTS.md` → Database Entities | Standard column contract includes `deleted_at` for soft delete | Compliant (fixed 2026-09-07) | `deletedAt` added to `FiscalPeriod`/`LedgerAccount`/`LedgerAccountType`; `LedgerAccount`/`LedgerAccountType` delete is now specified as a soft delete via `makeCrudRoute`, blocked once posted — gap found by an independent review |
| `.ai/specs/AGENTS.md` | Never leave stale endpoints, entities, or assumptions in an updated spec; keep specs implementation-accurate | Compliant (fixed 2026-09-07) | `periodId`/`accountId` `journal-entries` filters now documented as resolving via `FiscalPeriod`'s date range / a `JournalEntryLine` join rather than nonexistent `JournalEntry` columns; the `sales-invoice-gl-posting.md` cross-reference (5 instances in this file, 1 in `2026-09-06-contractor-registry.md`, 1 in `2026-08-18-general-ledger-implementation-guide.md`) corrected to state it is planned, not yet drafted — gap found by an independent review |
| `packages/ui/AGENTS.md` | Backend forms use `<CrudForm>`; lists use `<DataTable>` with stable `entityId`; non-`CrudForm` writes use `useGuardedMutation` | Compliant | `accounts`/`account-types` pages use `CrudForm`+`DataTable`; `fiscal-periods` lock/unlock row action uses `useGuardedMutation`+`retryLastMutation`, matching the `resources` guarded-row-action precedent (see Backend Pages) — this file was missing from AGENTS.md Files Reviewed until an independent review caught it |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match architecture | Pass | Entities in Architecture and Data Models sections agree |
| Commands defined for all mutations | Pass | Posting, reversal, fiscal-period create/lock/unlock, and account/type create+update all have commands, including the `normalBalance`/`accountGroupId` guard on `updateLedgerAccountType` and the `accountTypeId` guard on `updateLedgerAccount` |
| Every Testing Strategy item has a corresponding implementation step | Pass | `normalBalance`/`accountGroupId`-immutability test maps to `updateLedgerAccountType`; `accountTypeId`-immutability test maps to `updateLedgerAccount`; locked-period rejection maps to `postJournalEntry`; optimistic-lock tests map to period lock/unlock and account/type update commands |
| User Stories match Implementation Plan | Pass | The accountant-facing chart-of-accounts and fiscal-period-locking stories have backend pages + API routes, not commands with no caller |
| Risks cover all write operations | Pass | Balance integrity, tenant isolation, and migration risk addressed |
| API contracts match data models | Pass (fixed 2026-09-07) | `periodId`/`accountId` `journal-entries` filters now documented as resolving via `FiscalPeriod`/`JournalEntryLine` rather than implying nonexistent `JournalEntry` columns — gap found by an independent, fresh-context review that cross-referenced the real data model instead of trusting this document's own prior claims |
| Scope cohesion | Pass (resolved 2026-09-07) | A fresh-context subagent was re-run against the *current* scope (not the pre-2026-09-01 five-piece set this row previously, inaccurately, claimed as still verified by inheritance) and returned SPLIT, not COHESIVE: fiscal-period locking is separable from posting, evidenced by this document's own 2026-09-01 → 2026-09-03 changelog. Escalated per the checklist and explicitly decided by the stakeholder: keep `FiscalPeriod` in this document — see Design decisions |
| Every `JournalEntry.type` enum value is explained somewhere in Proposed Solution / Design decisions | Pass (fixed 2026-09-09) | `OPENING` appeared in the `type` enum (Architecture → Entities, API Contracts) since the first draft but was never otherwise discussed, unlike `NORMAL` (default case), `CLOSING` ("Fiscal period closing is a lock flag plus an entry type"), and `REVERSAL` ("Corrections are reversals, not undo") — caught while cross-referencing this document for `2026-09-09-general-ledger-account-balances.md`'s turnover design. Added the symmetric "Opening balances are the same mechanism as closing, run in reverse" Design decision |

### Non-Compliant Items

None remaining against AGENTS.md rules. Prior findings from the
`om-spec-writing` review (Currency duplication, missing ACL/`setup.ts`,
missing optimistic locking, unresolved module name, User
Stories/Implementation Plan mismatch, untestable `normalBalance` test,
shallow compliance report, missing API Contracts section) are addressed
above. Two additional issues surfaced and were fixed during the
2026-09-07 re-verification, both caught before this report was
re-run: an earlier draft of `LedgerAccountGroup` described it as not
tenant/org scoped (violates `AGENTS.md` § Never — see Changelog), and
`JournalEntryLine` was missing its own `organizationId`/`tenantId`
(found against the `sales.SalesInvoiceLine` precedent — see
Changelog). A same-day independent, fresh-context review — not primed
with any of this document's own conclusions, cross-referencing the
real `AGENTS.md` and source files rather than trusting this document's
self-report — found four more, all now fixed (see Compliance Matrix,
Changelog): missing `openApi` compliance, undesigned `periodId`/
`accountId` API filters, the dangling `sales-invoice-gl-posting.md`
cross-reference (across this file and two sibling specs), and the
missing `deletedAt` column. That same independent review also re-ran
the checklist's scope-cohesion check against the *current* scope and
returned SPLIT, not COHESIVE — not an AGENTS.md rule violation, so it
isn't listed here as non-compliant; it was escalated per the
checklist's own instruction and resolved the same day by explicit
stakeholder decision to keep this document as one spec (see Design
decisions, Changelog).

### Verdict

**Ready for maintainer review.** The module id is decided (`ledger`);
every finding from every review round to date — including a same-day
independent, fresh-context pass that cross-referenced the real
`AGENTS.md`/source files rather than trusting this document's own
prior self-report — is resolved and re-verified against the current
document: `acl.ts`/`setup.ts` are concrete deliverables (Architecture
→ Access Control / Module Setup, Implementation Plan step 2),
`FiscalPeriod`/`LedgerAccount`/`LedgerAccountType`/`LedgerAccountGroup`/
`JournalEntryLine` all carry correct tenant/org scoping and now a
consistent `deletedAt` soft-delete story, `updateLedgerAccountType` and
`updateLedgerAccount` both make their respective immutability
invariants (`normalBalance`/`accountGroupId`, `accountTypeId`) real,
`currencyId` is an FK-id to the existing `currencies` module with no
duplicate `Currency` entity, `ledger.journal_entry.posted` gives
downstream modules a compliant way to react to postings without
`ledger` importing or resolving them, every API route — including the
previously-missing `api/openapi.ts` — documents its contract, the
`journal-entries` list's `periodId`/`accountId` filters now match the
real data model instead of implying nonexistent columns, and the
`sales-invoice-gl-posting.md` cross-references across this document
and two sibling specs now accurately describe it as planned rather
than existing.

An independent, fresh-context re-run of the checklist's scope-cohesion
check (item 1.2) returned SPLIT, not COHESIVE, for the current scope —
arguing fiscal-period locking is separable from posting (this
document's own 2026-09-01/2026-09-03 changelog shows posting shipped,
worked, and was reviewed with `FiscalPeriod` entirely absent, restored
only on an unrelated stakeholder correction). Per the checklist, this
was escalated rather than silently resolved by rewriting the document;
it was then explicitly decided (2026-09-07) to keep `FiscalPeriod` in
this document rather than split it out — see Design decisions for the
full reasoning on both sides. `LedgerAccountGroup`'s jurisdiction-
selection mechanism (which jurisdiction a given organization seeds)
remains explicitly out of scope for Phase 1 (hardcoded to `PL`) and
deferred by design, not an oversight — see Design decisions. Downstream
specs that consume this module (Posting Rules Engine, in particular)
carry their own, separate open design items; those do not block this
document.

## Changelog

### 2026-08-18

- Initial specification.

### 2026-08-27

- Reviewed via `om-spec-writing` (review mode); addressed all findings:
  removed the duplicate `Currency` entity in favor of an FK-id to the
  existing `currencies` module; added `acl.ts`/`setup.ts`; added
  `updated_at`/optimistic locking to the three editable entities; moved
  module naming to a formal `Open Questions` block (Q1, blocking); added
  backend pages + API routes for accounts/account types/fiscal periods;
  added `updateLedgerAccountType` so the `normalBalance`-immutability
  test is real; expanded the Compliance Matrix; added a dedicated API
  Contracts section.
- Briefly added, then split back out: Accounts Receivable / `sales`
  invoice posting was drafted directly into this spec at stakeholder
  request, then moved to its own dependent spec,
  `.ai/specs/2026-08-18-sales-invoice-gl-posting.md`, for independent
  review — per the same scope-cohesion split the `om-spec-writing`
  review verified for this spec (the posting engine is independently
  deployable without the `sales` integration). AR is back in Out of
  scope, pointing at the dependent spec.
- Resolved Q1: module id is `ledger`.

### 2026-09-01

- Scope reduction per stakeholder direction (@lchrusciel, PR #5663,
  official GitHub suggestion): Phase 1 now covers Chart of Accounts +
  Journal Entries only. Removed `FiscalPeriod` (entity, `isLocked`,
  lock/unlock commands, routes, backend page, ACL features, optimistic
  locking on the entity) and `getAccountBalance`/balance calculation
  (query, HTTP route, backend surfacing) everywhere in this spec —
  Overview, Proposed Solution, Design Decisions, Architecture,
  Access Control, Commands, Queries/API, Backend Pages, API Contracts,
  User Stories, Implementation Plan, File Manifest, Testing Strategy,
  Risks, and the Compliance Matrix. Dropped `CLOSING` from the
  `JournalEntry.type` enum (`NORMAL`/`OPENING`/`REVERSAL` only in this
  phase) since it was defined solely in terms of fiscal-period closing.
  Both fiscal periods and balance calculation move to Out of scope as
  an explicit, stakeholder-directed reduction — not a technical
  obstacle — so Chart of Accounts + Journal Entries can be verified
  against the real requirements of Poland's Accounting Act (Ustawa o
  rachunkowości) before period-locking semantics are layered on top.
  `JournalEntry.currencyId`/`exchangeRate`/`referenceType`/
  `referenceId`, `acl.ts`/`setup.ts`, optimistic locking on
  `LedgerAccount`/`LedgerAccountType`, and reversal are unchanged.
- Checked this spec against art. 9–25 Ustawy o rachunkowości (the
  Polish Accounting Act) and made two decided, no-further-discussion
  updates: added `JournalEntry.sequenceNumber` — a per-organization,
  atomically-allocated sequential integer required by art. 14 ust. 2
  ("kolejne numerowanie" with "sumy liczone w sposób ciągły"), which a
  UUID alone can't satisfy (Design decisions, Architecture → Entities
  / Migration, Implementation Plan, File Manifest, Testing Strategy,
  API Contracts, Data Models); and documented, without changing scope
  or code, that art. 25 ust. 2's rule tying mandatory reversal to a
  closed period is currently moot (no `FiscalPeriod` this phase) but
  must be designed for when `FiscalPeriod` returns (note appended to
  the "Corrections are reversals, not undo" decision). Also added
  subsidiary ledgers (księgi pomocnicze, art. 13 ust. 1 pkt 3 / art.
  16) to Out of scope as a natural AP/AR-module concern, not a gap in
  this engine. No business scope change beyond the `sequenceNumber`
  field — this is a technical legal-compliance fix, decided without
  further stakeholder discussion.
- Follow-up correction: an `om-spec-writing` review flagged that
  `journal_entry_sequence` was keyed by `tenant_id` alone, which would
  pool journal numbering across every `Organization` under a tenant —
  risky if an `Organization` is a distinct legal entity under the
  Accounting Act, each with its own art. 14 ust. 2 obligation. Rescoped
  the counter table, `sequenceNumber`'s uniqueness, and the Design
  Decision to `(tenant_id, organization_id)`, matching this repo's
  convention (e.g. `customers`) that `Organization` is where
  independent business data lives, not a mere subdivision.

### 2026-09-03

- Restored Fiscal Period (locking) to scope: @lchrusciel reversed the
  earlier decision to cut it (@lchrusciel: "To chyba powinniśmy jednak
  go dodać. Mój błąd") after checking the removal against the Event
  Storming brief, which lists accounting periods ("okresy obrachunkowe")
  as in scope for the GL. Balance calculation stays out of scope,
  unchanged — the brief does not list it as required. Restored the
  `FiscalPeriod` entity (`startDate`, `endDate`, `isLocked`,
  `updatedAt`), the `ledger.periods.view` / `ledger.periods.manage` ACL
  features (back to six features), `employee` read access to periods in
  `setup.ts`, the `createFiscalPeriod` / `lockFiscalPeriod` /
  `unlockFiscalPeriod` commands, the `isLocked` check in
  `postJournalEntry` (rejects a post into a locked period before any
  write), `api/fiscal-periods/route.ts` + the lock/unlock custom
  routes, the `backend/ledger/fiscal-periods/page.tsx` page with a
  guarded lock/unlock row action, the "Fiscal period closing is a lock
  flag plus an entry type" design decision, and `CLOSING` in the
  `JournalEntry.type` enum (`NORMAL`/`OPENING`/`CLOSING`/`REVERSAL`) —
  updated across Overview, Proposed Solution, Design Decisions,
  Architecture, Access Control, Module Setup, Commands, Queries/API,
  Backend Pages, API Contracts, Data Models, User Stories,
  Implementation Plan, File Manifest, Testing Strategy, Risks, and the
  Compliance Report. The `Out of scope` "Fiscal periods (locking)"
  bullet is removed; "Automated period-closing entry generation" is
  reworded to distinguish the `CLOSING` entry type (in scope — posted
  by hand or a script) from an automated closing-entry generator (still
  out of scope).
- Two consistency decisions that follow from Fiscal Period being back
  in scope, decided without further discussion:
  - `JournalEntry.sequenceNumber` **stays scoped per organization, not
    per fiscal year**. Extending numbering to reset/partition per
    fiscal year is a separate, unrequested scope change;
    per-organization already satisfies art. 14 ust. 2 (continuous,
    consecutive numbering) and can be narrowed to per-period later
    without invalidating or renumbering existing entries. Replaces the
    now-false "FiscalPeriod is out of scope so a per-period sequence
    isn't buildable yet" note.
  - The art. 25 ust. 2 note is no longer a hypothetical "forward-
    looking" one. Decided policy: **always a reversal, never a direct
    edit, regardless of the covering period's lock state** — stricter
    than art. 25 ust. 2 requires pre-closure (which permits a direct
    correction before the period is locked), but lawful, and it keeps
    the single invariant "`JournalEntry` is always immutable" instead
    of a period-state-dependent edit path. The rejected conditional
    pre-closure edit path is now a bullet in Alternatives considered.


### 2026-09-06

- Added `LedgerAccount.parentAccountId` (nullable, self-reference).
  Resolves the "Rozróżnienie syntetyka/analityka jako osobny wymiar
  raportowania" (HS-11) item from the Event Storming comparison. Split
  the concern in two: `parentAccountId` models the static,
  single-dimension Chart-of-Accounts hierarchy (synthetic → analytic,
  e.g. `130` → `130-1 mBank`) and ships now, structural only, on the
  same empty-table-is-cheaper-than-later logic already used for
  `parentAccountTypeId`. The contextual, multi-dimensional tagging
  (kontrahent/MPK/rachunek bankowy/środek trwały/waluta) is a
  different mechanism (`journal_entry_line_dimension`), added to Out
  of scope, and ships later together with the posting-rules/konto 490
  engine. Updated Design decisions, Architecture → Entities, Data
  Models, Implementation Plan, File Manifest, and Out of scope.


### 2026-09-06 (cont.)

- Clarified the "Multi-currency FX revaluation and reporting"
  Out-of-scope bullet (HS: różnice kursowe, Event Storming Sekcja 04):
  distinguishes transactional exchange-rate differences (already
  buildable via `currencyId`/`exchangeRate`, no scope change) from
  period-end balance revaluation (genuinely out of scope, future
  Multi-Currency spec).
- Resolved the posting-rules/konto 490 open item (HS-06): stays out
  of #5663 as its own future spec (single-capability test — #5663
  works standalone without it; it cannot work without #5663), but is
  a hard prerequisite for Accounts Payable's *production* completeness
  once AP ships, not for #5663 itself. Justification: the Event
  Storming "Spójność P&L" rule (Sekcja 05 — both the 4xx and 5xx P&L
  variants must return the same net result) requires the 4→5
  reclassification engine whenever costs are recorded in zespół 4,
  which AP will do. Sequenced immediately after AP, not blocking AP's
  own build.


### 2026-09-07

- Added `JournalEntryLine.contractorSnapshot` (nullable `json`), a
  point-in-time audit copy of the counterparty's name/NIP/bank
  account/verification status at posting time. Resolved while
  designing `.ai/specs/2026-09-06-contractor-registry.md` (new spec,
  identified as a missing dependency of Accounts Payable's "Kontrahent
  jest współdzieloną encją" decision). Avoids an audit gap between AP
  shipping and the posting-rules/`journal_entry_line_dimension` engine
  being built later; the Out-of-scope bullet for that table now notes
  the two are distinct, complementary mechanisms. Updated Design
  decisions, Architecture → Entities, Data Models, Implementation
  Plan, File Manifest, and Out of scope.
- Flagged and closed a compliance gap introduced by the field above:
  it carries the same PII (name/NIP/bank account) as the `Contractor`
  entity in `.ai/specs/2026-09-06-contractor-registry.md`, so it needs
  its own `encryption.ts` declaration in the `ledger` module, following
  the existing whole-json-column precedent
  (`messages:message.action_data`/`action_result`). Added to Design
  decisions, File Manifest, and the Compliance Matrix.
- Added `LedgerAccountGroup` (new entity) and `LedgerAccountType.
  accountGroupId` (nullable FK, immutable once posted). Resolved while
  reviewing Posting Rules Engine's need to detect "zespół 4" postings
  in real time: parsing a `slug`/account-number convention doesn't
  generalize past Poland (SKR03, PCG, US GAAP use different schemes),
  and the platform brief calls for Poland now, other jurisdictions
  (USA, others) later as plugins. `LedgerAccountGroup` is system
  reference data seeded per jurisdiction, not tenant-authored — Phase
  1 seeds only `PL` (zespoły 0–8). Updated Design decisions,
  Architecture → Entities, Data Models, Commands, Testing Strategy,
  and File Manifest. Also updated
  `.ai/specs/2026-09-06-posting-rules-engine.md`'s open item to point
  at this new field instead of an undesigned slug convention.
- Corrected `LedgerAccountGroup`'s scoping: an earlier draft of this
  decision described it as "not tenant/org scoped" (a single table
  shared across tenants) — this violates core `AGENTS.md` § Never
  ("Never expose cross-tenant data or omit tenant/organization
  scoping") and mischaracterized the `currencies` module precedent it
  cited (`Currency` is itself tenant/org scoped, seeded per
  tenant/organization via `setup.ts` → `seedDefaults`). Fixed:
  `LedgerAccountGroup` is now tenant/org scoped like every other
  entity in this module, seeded via the same `seedDefaults` mechanism.
  Also flagged and explicitly deferred a new gap this exposed: no
  mechanism exists anywhere in the system to select a tenant's/
  organization's accounting jurisdiction (`directory.Tenant`/
  `Organization` carry no country/locale field) — Phase 1 hardcodes
  `jurisdiction: 'PL'` for every organization; solving jurisdiction
  selection is deferred to when USA/other-jurisdiction support is
  actually built, and will likely require a new field on
  `directory.Organization` (a shared core entity `ledger` doesn't
  own). Updated Design decisions, Architecture → Entities, Data
  Models, Module Setup, File Manifest, and the Compliance Matrix.
- Added `events.ts` declaring `ledger.journal_entry.posted` (ephemeral),
  emitted by `postJournalEntry` after commit. Resolved while reviewing
  Posting Rules Engine's implementation plan: nothing in this spec
  declared any event, yet a downstream module reacting to every
  posting is only possible through the platform's mandatory
  event/subscriber mechanism (`packages/events/AGENTS.md` — direct
  cross-module calls are forbidden in both directions). `ledger`
  itself gains no dependency on any consumer — it just declares a
  domain-lifecycle event about its own entity, the same shape as
  every other module's `events.ts`. Updated Commands and added a new
  Architecture → Events subsection, plus File Manifest.
- Added `JournalEntryLine.organizationId`/`tenantId` (own scope
  columns). Found while reviewing whether the Final Compliance Report
  was still accurate: the tenant/org-scoping compliance row listed
  every entity except `JournalEntryLine`, which relied only on a join
  through `journalEntryId`. Checked against `sales.SalesInvoiceLine` —
  the same "line under a parent document" shape — which carries its
  own `organization_id`/`tenant_id` despite also having a parent FK;
  `JournalEntryLine` now matches that established convention. Updated
  Design decisions, Architecture → Entities, Data Models, and the
  Compliance Matrix.
- Added an `accountTypeId`-immutability guard to `updateLedgerAccount`,
  mirroring the existing `normalBalance`/`accountGroupId` guard on
  `updateLedgerAccountType`. Found while reviewing `LedgerAccount`:
  `normalBalance`/`accountGroupId` live on the type, not the account
  or `JournalEntryLine`, so reassigning an account's type after it has
  posted history would silently reinterpret its past entries. Updated
  Design decisions, Architecture → Entities, Data Models, Commands,
  Testing Strategy, and File Manifest.

### 2026-09-07 (cont. — independent review round)

- Fixed two remaining stale spots caught during a careful, adversarial
  self-re-read of the whole document (no subagent involved yet): the
  "Tenant & data isolation" list under Risks & Impact Review still
  named only `FiscalPeriod`/`LedgerAccount`/`JournalEntry`, omitting
  `LedgerAccountType`/`LedgerAccountGroup`/`JournalEntryLine`; and the
  "AGENTS.md Files Reviewed" list omitted `packages/events/AGENTS.md`
  despite the Compliance Matrix already citing it. Both corrected.
- Ran a genuinely independent, fresh-context review (no prior framing,
  cross-referencing the real `AGENTS.md` files and source on disk
  rather than trusting this document's own self-report) against the
  full `om-spec-writing` checklist and compliance-review process. It
  found, and this round fixes:
  - Missing `openApi` export compliance (`packages/core/AGENTS.md` →
    API Routes, a hard MUST, satisfied everywhere else in the repo).
    Added `api/openapi.ts` (File Manifest, Implementation Plan step 7,
    Queries / API, Compliance Matrix).
  - An undesigned `periodId` filter on `GET /api/ledger/journal-entries`
    with no backing `JournalEntry` column, and the same latent gap on
    `accountId` (which actually lives on `JournalEntryLine`). Both now
    documented as resolving via `FiscalPeriod.startDate`/`endDate` and
    a `JournalEntryLine.accountId` join respectively, with supporting
    indexes named in Migration. Updated API Contracts, Queries / API,
    Data Models, Migration, Testing Strategy, Internal Consistency
    Check.
  - A dangling cross-reference: `.ai/specs/2026-08-18-sales-invoice-gl-posting.md`
    was cited as an existing dependent spec in 5 places in this
    document (TLDR, Design decisions, Risks, Out of scope ×2) and in
    `2026-09-06-contractor-registry.md` and
    `2026-08-18-general-ledger-implementation-guide.md` — the file does
    not exist anywhere in the repo. All 7 references corrected to state
    it is planned, not yet drafted.
  - A missing `deletedAt` column on `FiscalPeriod`/`LedgerAccount`/
    `LedgerAccountType`, despite the "no hard delete once posted"
    language implying a delete path exists pre-posting and
    `packages/core/AGENTS.md`'s standard column contract listing
    `deleted_at` for soft delete. Added to Design decisions,
    Architecture → Entities, Data Models, Queries / API, Testing
    Strategy, Compliance Matrix.
  - A citation error: the `contractorSnapshot` precedent was attributed
    to `messages.Message.entity_snapshot`; the column actually lives on
    `messages.MessageObject`. Corrected.
  - `packages/ui/AGENTS.md` was missing from AGENTS.md Files Reviewed
    despite this module's reliance on `CrudForm`/`DataTable`/
    `useGuardedMutation`. Added, with a new Compliance Matrix row.
- The same independent review also flagged, as a process gap rather
  than an AGENTS.md violation, that the Internal Consistency Check's
  "Scope cohesion: Pass" row had never actually been re-verified
  against the current (post-2026-09-01/09-03) scope — it inherited a
  verdict from the original five-piece scope by logical argument
  instead. A dedicated fresh-context subagent was then run against the
  *current* scope specifically, and returned **SPLIT**: fiscal-period
  locking is separable from posting, per this document's own
  2026-09-01 (removed) → 2026-09-03 (restored on stakeholder
  correction, not technical necessity) history. Per the checklist, a
  SPLIT verdict is escalated to the maintainer, not silently resolved —
  added as **Q2** in a new Open Questions section; Internal Consistency
  Check, Non-Compliant Items, and Verdict updated to reflect that this
  one item is not resolved by this document on its own authority.

### 2026-09-07 (cont. — Q2 resolved)

- Resolved the scope-cohesion SPLIT finding from the independent
  review round above: decided to keep `FiscalPeriod` (fiscal-period
  locking) in this document rather than extract it into its own
  dependent spec, despite the fresh-context subagent's SPLIT verdict
  being evidentially accurate (this document's own 2026-09-01 removal
  / 2026-09-03 restoration genuinely shows the two are separable).
  Reasoning: unlike the AR/`sales` integration already split out on
  the same grounds, fiscal-period locking is a core, load-bearing
  accounting control for this module under Poland's Ustawa o
  rachunkowości, not an optional cross-module integration — splitting
  it would ship a materially weaker MVP than what's already been
  reviewed and stakeholder-approved twice. Folded the full argument
  (both for SPLIT and for keeping it COHESIVE) into a new Design
  Decision instead of leaving it as a standalone `Open Questions`
  section, matching how Q1 was retired once resolved. Updated Design
  decisions, Internal Consistency Check, Non-Compliant Items, and
  Verdict; removed the temporary `## Open Questions` section.

### 2026-09-08 (cont. — control-account / subsidiary-ledger
cross-check)

Two corrections to the Out of Scope section, prompted by a maintainer
question about the accounting archetype for contractor account/
bank-detail changes, resolved by cross-checking `2026-09-06-accounts-
payable.md` and `2026-09-06-journal-entry-line-dimension.md` once both
existed:
- "Subsidiary ledgers" bullet: added a note confirming this was
  realized as predicted, in `accounts_payable`
  (`liabilityAccountId` + `VendorInvoice.vendorId`).
- "Multi-dimensional posting tags" bullet: this document originally
  listed kontrahent as a candidate `journal_entry_line_dimension`
  type. `2026-09-06-journal-entry-line-dimension.md`, once drafted,
  deliberately excluded the counterparty from that table (handled by
  `contractorSnapshot` instead). Corrected the list and the
  co-occurrence example here to match what was actually built, and
  fixed the stale "per-MPK/per-kontrahent summaries" phrase to
  "per-MPK summaries".

No architectural change — both documents' actual designs already
implement the standard control-account / subsidiary-ledger pattern;
this only fixes this document's own text to stop describing a
kontrahent dimension row that was never built.

### 2026-09-08 (cont. — documented the planned `parentAccountId`
guard)

A maintainer's Slack message described `130-1 mBank` as "faktycznie
nieedytowalne" (actually non-editable) — true in intent but not yet
true in this spec: `parentAccountId` has no mutability guard today,
deliberately, since nothing in Phase 1 reads or aggregates over the
Chart-of-Accounts hierarchy yet. Added a Design Decision making the
deferral explicit: when a future consumer (Bank Management / Fixed
Assets) starts reading `parentAccountId`, `updateLedgerAccount` should
gain the same *class* of guard already specified for `accountTypeId`
— but, unlike a first draft of this entry, the exact trigger condition
is left explicitly open rather than prescribed. `accountTypeId`'s
guard only checks for posted entries; whether `parentAccountId`'s
guard also needs to account for existing child accounts (re-parenting
a subtree vs. a leaf) is a real open design question, not settled
here. Not implemented now — adding an active guard for a field
nothing reads would itself be speculative scope per the review
checklist's anti-pattern check. This turns a silent gap into an
intentional, documented one, without overstating how much of the
eventual mechanism is actually decided.

### 2026-09-09 (documented the `OPENING` entry type)

While cross-referencing this document for
`2026-09-09-general-ledger-account-balances.md` (Phase 2, ZSiO), found
that `JournalEntry.type`'s `OPENING` value — present in the enum since
the very first draft (Architecture → Entities, API Contracts) — had
never been explained anywhere else in this document, unlike its three
siblings: `NORMAL` (the implicit default), `CLOSING` ("Fiscal period
closing is a lock flag plus an entry type"), and `REVERSAL`
("Corrections are reversals, not undo"). A real gap, not a stylistic
one: nothing here said who posts an `OPENING` entry, what it
represents, or whether `postJournalEntry` treats it specially. Fixed:
- Added a Design Decision, "Opening balances are the same mechanism as
  closing, run in reverse" — an `OPENING` entry establishes an
  account's beginning-of-year (or ledger-go-live) balance, posted
  manually or by a script against permanent accounts only (nominal
  accounts start the year at zero once `CLOSING` has run), with
  `postJournalEntry` applying no special-casing to it (same balance
  check, same locked-period rejection, same `sequenceNumber`
  allocation as any other entry).
- Extended the Out of scope "Automated period-closing entry
  generation" bullet to cover both `CLOSING` and `OPENING`
  generators symmetrically — renamed it "Automated period-closing and
  period-opening entry generation."
- Added a Proposed Solution cross-reference (point 3) and a Testing
  Strategy assertion that an `OPENING` entry posts exactly like a
  `NORMAL` one.
- Added an Internal Consistency Check row recording the gap and its
  fix.
No architectural or scope change — this document already assumed
`OPENING` entries exist (the enum has carried the value from the
start); this only makes the assumption explicit instead of leaving the
`2026-09-09` ZSiO spec's readers to infer it.
