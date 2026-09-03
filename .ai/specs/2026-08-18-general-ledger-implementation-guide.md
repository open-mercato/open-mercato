# General Ledger core engine — implementation guide

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md) (full spec — read this for the *why* behind every decision below; this document is the *what* and *in what order*, for someone about to write the code)

## What you're building, in one paragraph

A module (`ledger`) with three things a developer touches directly: a
**Chart of Accounts** (a hierarchy of account types, and concrete
accounts under them), a **posting engine** (`JournalEntry` +
`JournalEntryLine`, always in balanced debit/credit pairs), and
**fiscal periods** (a date range with an `isLocked` flag that blocks
posting into it). Nothing else calls into `sales`, invoicing, or any
other module — this is a standalone engine other modules will post to
later, not built yet.

## The five entities, one sentence each

- **`FiscalPeriod`** — an accounting period (`startDate`, `endDate`)
  with an `isLocked` flag; `postJournalEntry` rejects a post whose
  `postedAt` falls in a locked one. User-editable, so it carries
  `updatedAt` / optimistic locking.
- **`LedgerAccountType`** — a category (e.g. "Cash", "Revenue").
  Hierarchical (`parentAccountTypeId`), carries `normalBalance`
  (`DEBIT`/`CREDIT`) — locked once any account of that type has posted
  entries.
- **`LedgerAccount`** — a concrete account (e.g. "mBank — main"),
  belongs to one `LedgerAccountType`.
- **`JournalEntry`** — the header of one posted transaction: date,
  description, currency, `sequenceNumber` (per-organization,
  gapless), `type` (`NORMAL`/`OPENING`/`CLOSING`/`REVERSAL`),
  `referenceType`/`referenceId` (unused this phase, don't populate).
- **`JournalEntryLine`** — one side of one transaction: `accountId`,
  `debit`, `credit` (exactly one non-zero), `amountCurrency`.

For exact fields/types, see the full spec's Architecture → Entities.
Don't re-derive them here — copy from there.

## One transaction, start to finish

Posting "paid 500 PLN for internet from company bank account":

1. Caller invokes `postJournalEntry` with two lines: `{ accountId:
   internetExpenseAccount, debit: 500 }` and `{ accountId:
   mbankAccount, credit: 500 }`.
2. Command checks the `FiscalPeriod` covering `postedAt` is not
   `isLocked` — rejects before any write if it is — then validates
   `SUM(debit) === SUM(credit)` for the whole entry, rejecting if not.
3. Command atomically allocates the next `sequenceNumber` for this
   `(tenant_id, organization_id)` from `journal_entry_sequence` (the
   counter table introduced in Build order step 1 — full mechanics
   below, under "Don't use a native Postgres `SEQUENCE`"), in the
   same transaction as the insert (so a failed post doesn't burn a
   number).
4. Entry + both lines persist in one transaction. A `DEFERRABLE
   INITIALLY DEFERRED` Postgres constraint trigger
   (`assert_journal_entry_balanced()`, added in the Build order step 1
   migration; exact SQL: full spec → Migration) re-checks the balance
   at commit — this is the backstop, not the primary check; don't skip
   step 2 and rely on the trigger alone.
5. If someone made a mistake, they don't edit this entry. A new call
   to `reverseJournalEntry` posts a second entry, `type: 'REVERSAL'`,
   with inverted lines, linked back via `referenceType: 'JournalEntry'`
   / `referenceId: <original id>`. The original is untouched forever.

That's the whole write path. Everything else in the spec (ACL,
optimistic locking, hierarchy) supports this, doesn't replace it.

## Build order

Follow `Implementation Plan` in the full spec — it's already numbered
1–11 and matches the `File Manifest` table 1:1. Don't reorder it;
steps 1–2 (entities/migration, ACL/setup) have to exist before
anything else compiles or is reachable. High-level shape:

1. Entities + migration (incl. `FiscalPeriod`, the balance-check
   trigger and the `journal_entry_sequence` counter table — read the
   two pitfalls below, `Currency` and `SEQUENCE`, before you write
   this migration)
2. `acl.ts` (six features) + `setup.ts`
3. `postJournalEntry` (incl. the locked-period check)
4. `reverseJournalEntry`
5. `createFiscalPeriod` / `lockFiscalPeriod` / `unlockFiscalPeriod`
6. Account/account-type CRUD commands
7. API routes (`journal-entries` read-only, `accounts`,
   `account-types` via `makeCrudRoute`, `fiscal-periods` +
   lock/unlock custom routes)
8. Backend pages (`CrudForm`/`DataTable` for accounts/types,
   `fiscal-periods` list with a lock/unlock row action, read-only
   list for journal entries)
9–10. Unit + integration test coverage
11. `yarn generate`, typecheck, manual QA

## Things that will bite you if you skip them

- **Don't add a `Currency` entity.** One already exists in
  `packages/core/src/modules/currencies`. `JournalEntry.currencyId` is
  a plain FK-id to it — no ORM relation, no new entity. This was a
  real mistake in an earlier draft of the full spec; don't repeat it.
- **`sequenceNumber` is per `(tenant_id, organization_id)`, not per
  tenant.** Two organizations under the same tenant each start their
  own counter at 1. Test this explicitly — it's easy to get right by
  accident with a single-org test and wrong in multi-org production.
- **Don't use a native Postgres `SEQUENCE` for `sequenceNumber`.**
  `nextval()` doesn't roll back on transaction abort — a failed post
  would still burn a number and leave a gap, which is exactly what the
  legal requirement (Art. 14 ust. 2 Ustawy o rachunkowości, continuous
  numbering — full legal rationale in the full spec's Design
  decisions) forbids. Use the counter-row pattern instead: a
  `journal_entry_sequence(tenant_id, organization_id, next_value)`
  table, incremented atomically in the same transaction as the entry
  insert via `INSERT ... ON CONFLICT (tenant_id, organization_id) DO
  UPDATE SET next_value = next_value + 1 RETURNING next_value - 1`
  (exact DDL: full spec → Migration).
- **`JournalEntry`/`JournalEntryLine` never get `updated_at` or an
  edit path.** They're append-only. If you find yourself writing an
  `updateJournalEntry` command, stop — that's not in this spec, and
  it shouldn't be; corrections are reversals (see above).
- **`LedgerAccountType.normalBalance` is immutable once used.**
  `updateLedgerAccountType` must reject a change to it if any account
  of that type has posted entries. This is a real check, not just
  documentation — there's a test for it.
- **`postJournalEntry` must check the fiscal-period lock — but there
  is no automated year-end close.** The `isLocked` check before
  posting is in scope (restored 2026-09-03, see full spec's Changelog).
  A year-end close is posted as an ordinary `JournalEntry` with `type:
  'CLOSING'` by hand or a script — do *not* build an automated
  closing-entry generator (identifying result accounts, computing the
  transfer to Retained Earnings); that stays out of scope.
- **No `getAccountBalance` this phase.** Don't add a
  balance-calculation query or a `.../balance` route — explicitly out
  of scope (stakeholder-directed, see full spec's Changelog). It comes
  back in a later phase; don't pre-build it.
- **`debit`/`credit` are `numeric(19,4)`, not `bigint` minor units —
  don't cast them to a JS `number`.** node-postgres returns `numeric`
  columns as strings specifically to avoid float rounding; running
  them through `parseFloat`/`Number()` reintroduces the exact
  precision bug the column type exists to prevent. Keep them as
  strings (or a `Decimal` type) end to end — in the command handler,
  in `SUM(debit)`/`SUM(credit)` aggregations, and in API responses.
  The worked example above (`debit: 500`) is illustrative only; treat
  it as `"500.0000"`, not `500`.

## When you're done with this spec

The next piece — posting Accounts Receivable entries when a `sales`
invoice is issued or paid — is a separate, dependent spec:
`.ai/specs/2026-08-18-sales-invoice-gl-posting.md`. It depends on
everything above existing; don't start it early.
