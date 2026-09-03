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
`sales` invoices — ships as its own dependent spec,
`.ai/specs/2026-08-18-sales-invoice-gl-posting.md`, once this one is
implemented; see Out of scope.

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

**`referenceType`/`referenceId` are added now even though nothing
populates them in this phase.** With no integration into `sales` or
any other document type in scope here, every journal entry in this
phase is posted directly, not generated from another module. The
fields exist anyway: adding a nullable column to an empty table costs
nothing; adding one to a ledger table that already has production rows
is a real migration. The dependent `sales-invoice-gl-posting` spec is
the first real consumer, and it needs no schema change to use them.

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
  tenant/org scoped. User-editable, so it carries `updated_at` and
  participates in the default-ON optimistic lock like `LedgerAccount`/
  `LedgerAccountType` (see Design decisions). No `Currency` entity —
  see Design decisions.
- `LedgerAccountType` — `slug`, `name`, `normalBalance`
  (`DEBIT`/`CREDIT`), `parentAccountTypeId` (nullable, self-reference),
  `updatedAt`.
- `LedgerAccount` — `slug`, `accountTypeId`, tenant/org scoped,
  `description`, `updatedAt`.
- `JournalEntry` — `sequenceNumber` (`bigint`, unique per
  `(tenant_id, organization_id)`, allocated atomically — see Design
  decisions), `postedAt`,
  `description`, `type` (`NORMAL`/`OPENING`/`CLOSING`/`REVERSAL`), `currencyId`
  (FK-id, `uuid`, references `currencies.Currency.id` — no ORM
  relation), `exchangeRate`, `referenceType`, `referenceId`,
  tenant/org scoped. No `updatedAt` — append-only, immutable once
  posted (exempt from optimistic locking, see Design decisions).
- `JournalEntryLine` — `journalEntryId`, `accountId`, `debit`,
  `credit` (`numeric(19,4)`), `amountCurrency`. Same exemption as
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
}
```

Employees get read access (viewing the chart of accounts, journal, and
period status); posting, chart-of-accounts edits, and period
locking/unlocking stay admin-only by default, consistent with the
customers module's `admin: ['customers.*']` pattern. No
`onTenantCreated`/`seedDefaults` hooks in Phase 1 — no default chart of
accounts is seeded; tenants build their own.

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

### Commands (Command Pattern, `commands/`)

- `postJournalEntry` — validates the `FiscalPeriod` covering
  `postedAt` is not `isLocked` (rejects before any write), validates
  debit/credit balance, atomically allocates the next per-organization
  `sequenceNumber`, persists entry + lines in one transaction.
  Requires `ledger.entries.post`.
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
  conventions. Requires `ledger.accounts.manage`.
- `createLedgerAccountType` / `updateLedgerAccountType` — standard
  CRUD; `updateLedgerAccountType` rejects a `normalBalance` change
  when any account of that type has posted entries (the invariant the
  Testing Strategy checks). Requires `ledger.accounts.manage`.

### Queries / API

- `api/journal-entries/route.ts` — `listJournalEntries`, standard
  `makeCrudRoute` read-only list (no `create`), filterable by account,
  period, type, reference. Requires `ledger.entries.view`. See API
  Contracts.
- `api/accounts/route.ts`, `api/account-types/route.ts` — standard
  `makeCrudRoute` CRUD (list/create/update; no hard delete once an
  account/type has posted entries), backing the `CrudForm` pages
  below. URLs: `/api/ledger/accounts`, `/api/ledger/account-types`.
- `api/fiscal-periods/route.ts` — `makeCrudRoute` list/create; lock/
  unlock are separate custom write routes
  (`api/fiscal-periods/[id]/lock/route.ts`, `.../unlock/route.ts`,
  URLs `/api/ledger/fiscal-periods/:id/lock` etc.) wired through the
  mutation guard registry (mapped to the `update` operation) per
  `AGENTS.md` → API Routes, since toggling `isLocked` isn't a
  field-level CRUD edit.

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
optimistic lock on the lock/unlock actions.

### LedgerAccountType

Hierarchical. `normalBalance` is required and immutable once any
account of that type has posted entries — enforced by
`updateLedgerAccountType`, which checks for posted `JournalEntryLine`
rows against accounts of that type before allowing the change.

### LedgerAccount

One row per account; `slug` unique per (tenant, organization).

### JournalEntry / JournalEntryLine

A `JournalEntry` with zero or one line is invalid — every posted entry
must have at least two lines and must balance. Enforced by the
application layer and the database trigger described above.
`sequenceNumber` is unique per organization and gapless in posting order —
allocated atomically as part of the same transaction that inserts the
entry, so a failed post never consumes a number (see Design
decisions).

## Implementation Plan

### Phase 1: Posting engine

1. Add `FiscalPeriod`, `LedgerAccountType`, `LedgerAccount`,
   `JournalEntry` (including `sequenceNumber`), `JournalEntryLine`
   entities (with `updated_at` on the three editable ones) and their
   migration, including the deferred balance-check constraint trigger
   and the per-organization `journal_entry_sequence` counter table. No
   `Currency` entity — `JournalEntry.currencyId` is a plain FK-id
   column to `currencies.Currency.id`.
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
7. Implement `api/journal-entries/route.ts` (`listJournalEntries`),
   `api/accounts/route.ts`, `api/account-types/route.ts`,
   `api/fiscal-periods/route.ts` + the lock/unlock custom routes.
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
| `data/entities.ts` | Create | `FiscalPeriod`, `LedgerAccountType`, `LedgerAccount`, `JournalEntry` (incl. `sequenceNumber`), `JournalEntryLine` |
| `migrations/MigrationXXXXXXXXXXXXXX.ts` | Create | Tables for the entities above plus the deferred balance-check constraint trigger and the per-organization `journal_entry_sequence` counter table |
| `acl.ts` | Create | Six `ledger.*` features |
| `setup.ts` | Create | `defaultRoleFeatures` for `admin`/`employee` |
| `commands/postJournalEntry.ts` | Create | Validate the covering period is unlocked, validate and persist a balanced journal entry, atomically allocating the next per-organization `sequenceNumber` |
| `commands/reverseJournalEntry.ts` | Create | Post a linked reversal without mutating the original |
| `commands/fiscalPeriods.ts` | Create | `createFiscalPeriod`, `lockFiscalPeriod` / `unlockFiscalPeriod` with optimistic-lock enforcement |
| `commands/ledgerAccounts.ts` | Create | `createLedgerAccount` / `updateLedgerAccount` |
| `commands/ledgerAccountTypes.ts` | Create | `createLedgerAccountType` / `updateLedgerAccountType` with the `normalBalance`-immutability guard |
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
- Assert `updateLedgerAccountType` rejects a `normalBalance` change
  once an account of that type has posted entries, and allows it
  beforehand.
- Assert `lockFiscalPeriod`/`unlockFiscalPeriod` and
  `updateLedgerAccount`/`updateLedgerAccountType` return a 409 with
  `OptimisticLockConflictBody` on a stale `updated_at`, and succeed
  with the current one.
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
in this spec — see the dependent `sales-invoice-gl-posting` spec,
which is the first consumer and owns that failure-isolation story.

### Tenant & data isolation

`FiscalPeriod`, `LedgerAccount`, and `JournalEntry` are all
tenant/organization scoped, following the same pattern used elsewhere
in the repo.

### Migration & deployment

Additive only — new tables, no changes to existing schema. Safe to
deploy independently of any other module.

## Out of scope (tracked separately)

- Integration with `sales` invoices (auto-posting Accounts Receivable
  on invoice issue/payment) — a dependent follow-up spec,
  `.ai/specs/2026-08-18-sales-invoice-gl-posting.md`, once this engine
  is implemented. Kept separate from this spec on scope-cohesion
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
- **Automated period-closing entry generation.** The `CLOSING`
  `JournalEntry` type *is* in scope (see Proposed Solution / Design
  decisions) — a year-end close is posted as an ordinary `CLOSING`
  entry, by hand or by a script. What stays out of scope is an
  automated generator that identifies the result accounts, computes
  the transfer to Retained Earnings, and emits the closing entry's
  lines. That generator is a distinct piece of work from the posting
  engine and returns in a future phase; the `CLOSING` type keeps the
  door open for it without requiring it now.
- **Subsidiary ledgers (księgi pomocnicze).** Per-counterparty
  (kontrahent) sub-ledgers tracking receivables/payables in natural
  and monetary units (art. 13 ust. 1 pkt 3, art. 16 Ustawy o
  rachunkowości) are out of scope for this phase — they fall naturally
  out of a future Accounts Payable / Accounts Receivable module built
  on top of this engine, not out of the posting engine itself.
- Multi-currency FX revaluation and reporting.
- Country-specific tax/compliance plugins.

## Final Compliance Report — 2026-08-27 (updated 2026-09-03)

The 2026-09-01 update was a consistency pass reflecting the Fiscal
Period / Balance calculation scope reduction; the 2026-09-03 update
restores Fiscal Period (locking) to scope per stakeholder correction
(see Changelog), leaving Balance calculation out. Neither was a full
compliance audit rerun from scratch.

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/currencies/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| `AGENTS.md` | No direct ORM relationships between modules | Compliant | No entity references another module's entity by ORM relation; `currencyId` and `referenceType`/`referenceId` are plain FK-id columns, fetched separately |
| `AGENTS.md` | Filter by tenant/organization | Compliant | `FiscalPeriod`, `LedgerAccount`, `LedgerAccountType`, `JournalEntry` are all tenant/org scoped |
| `AGENTS.md` | Write operations via Command pattern | Compliant | All mutations go through `postJournalEntry`, `reverseJournalEntry`, `createFiscalPeriod`/`lockFiscalPeriod`/`unlockFiscalPeriod`, `createLedgerAccount`/`updateLedgerAccount`, `createLedgerAccountType`/`updateLedgerAccountType` |
| `AGENTS.md` / core `AGENTS.md` | Declarative feature guards; `acl.ts` features synced to `setup.ts` `defaultRoleFeatures` | Compliant | `acl.ts` (six features across accounts/entries/periods) + `setup.ts` added (Architecture → Access Control / Module Setup); `yarn mercato auth sync-role-acls` in Implementation Plan step 2 |
| Core `AGENTS.md` § Database Entities | User-editable entities MUST include `updated_at` for optimistic locking | Compliant | `FiscalPeriod`, `LedgerAccount`, `LedgerAccountType` have `updatedAt`; `CrudForm` auto-derives the lock header, `lockFiscalPeriod`/`unlockFiscalPeriod` call `enforceCommandOptimisticLock` explicitly. `JournalEntry`/`JournalEntryLine` are exempt (append-only) |
| Root `AGENTS.md:164` / `.ai/qa/AGENTS.md` | New feature MUST list integration coverage for affected API paths, shipped in the same change | Compliant | Implementation Plan step 10 + Testing Strategy cover `journal-entries` list and `fiscal-periods` lock/unlock as integration tests |
| `currencies/AGENTS.md` | MUST NOT reinvent currency/exchange-rate storage | Compliant | No `Currency` entity in this module; `currencyId` is an FK-id to the existing `currencies.Currency` |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | New tables only; no existing schema touched |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data models match architecture | Pass | Entities in Architecture and Data Models sections agree |
| Commands defined for all mutations | Pass | Posting, reversal, fiscal-period create/lock/unlock, and account/type create+update all have commands, including `updateLedgerAccountType` |
| Every Testing Strategy item has a corresponding implementation step | Pass | `normalBalance`-immutability test maps to `updateLedgerAccountType`; locked-period rejection maps to `postJournalEntry`; optimistic-lock tests map to period lock/unlock and account/type update commands |
| User Stories match Implementation Plan | Pass | The accountant-facing chart-of-accounts and fiscal-period-locking stories have backend pages + API routes, not commands with no caller |
| Risks cover all write operations | Pass | Balance integrity, tenant isolation, and migration risk addressed |
| Scope cohesion | Pass | A fresh-context subagent verified the original five-piece scope (accounts, posting, periods, balance, reversal) as mutually dependent and independently deployable, with the `sales` integration excluded. The current scope (accounts, posting, periods, reversal) drops only balance calculation from that verified set — a strict subset cannot introduce coupling that wasn't already accounted for — so it inherits the same verdict as a logical consequence, not a fresh subagent pass |

### Non-Compliant Items

None remaining. Prior findings from the `om-spec-writing` review (Currency
duplication, missing ACL/`setup.ts`, missing optimistic locking, unresolved
module name, User Stories/Implementation Plan mismatch, untestable
`normalBalance` test, shallow compliance report, missing API Contracts
section) are addressed above.

### Verdict

**Ready for maintainer review.** The module id is decided (`ledger`);
every finding from the `om-spec-writing` review is resolved and
re-verified against the current document: `acl.ts`/`setup.ts` are
concrete deliverables (Architecture → Access Control / Module Setup,
Implementation Plan step 2), `FiscalPeriod`/`LedgerAccount`/
`LedgerAccountType` carry `updated_at` with optimistic-lock
enforcement wired into their commands and routes, `currencyId` is an
FK-id to the existing `currencies` module with no duplicate `Currency`
entity, `updateLedgerAccountType` makes the `normalBalance`-immutability
test real, backend pages + API routes exist for every User Story that
needs one, and a dedicated API Contracts section documents the unique
endpoints (`journal-entries` list, `fiscal-periods` lock/unlock). No
open questions remain.

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
