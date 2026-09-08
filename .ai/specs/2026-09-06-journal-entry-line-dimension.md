# Journal Entry Line Dimension — multi-dimensional tag on a journal line

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(GL's own Out of Scope section anticipates this table, and this
document is the future spec it points to), [Posting Rules Engine](2026-09-06-posting-rules-engine.md)
(first consumer — the 490 engine needs a CostCenter dimension on a
line), [Fixed Assets](2026-09-06-fixed-assets.md) (second, independent
future consumer — Phase 2's `transferAsset`; still an untracked
sibling draft in this same working tree, not an externally-authored
source — see Design Decisions)

## TLDR

A dedicated `journal_entry_line_dimension` table that lets **more than
one** independent dimension (counterparty, cost centre/project, bank
account, fixed asset, currency) be attached to a single journal entry
line — without exploding the chart of accounts into a cartesian
product of combinations. This document builds only the table, its own
write command, and a directly-queryable entity for hard-dependency
consumers to read; no module writes or reads it yet.

## Overview

`JournalEntryLine` (GL, #5663) already has `parentAccountId` for the
static, single-dimension Chart-of-Accounts hierarchy, and a
`contractorSnapshot` (nullable `json`) column for a denormalized,
point-in-time audit copy of the counterparty at posting time. Neither
can hold a second, independent, queryable dimension (e.g. a cost
centre) on the same line, and neither is meant to: a hierarchy models
one tree, and a snapshot is an audit copy, not a reporting dimension.
This document adds the third, missing piece: a one-to-many table so
one line can carry several independent dimensions simultaneously.

This is a schema-and-command-only document. It has no UI, no HTTP API
surface, and (deliberately) no first consumer wired up yet — it exists
so that two separate, later documents (Posting Rules Engine now, Fixed
Assets Phase 2 later) can each depend on it independently, without
depending on each other.

## Problem Statement

A single journal entry line (`JournalEntryLine`) can need **more than
one** analytical dimension at the same time. Example: a purchase
invoice posted to a cost account — the line needs both a counterparty
(who we owe, for AP) and a cost centre/department (which cost bucket
it belongs to, for the 490 engine / Posting Rules Engine). Trying to
solve this through the chart-of-accounts hierarchy (`parentAccountId`,
already in #5663) would explode the number of accounts — a separate
account for every "department × project × region" combination, which
after a year of operation turns the chart of accounts into an
unmanageable graveyard of dead entries.

Separation of concerns: `parentAccountId` models the static,
single-dimension Chart-of-Accounts hierarchy (e.g. `130 Rachunki
bieżące` → `130-1 mBank`). This table models the multi-dimensional,
contextual cross-section (who/where/which project), independent of
the chart-of-accounts structure.

## Proposed Solution

A new, small, standalone module (`journal_entry_line_dimension`) that
owns exactly one entity. Writes go through one Command, scoped to a
single dimension type at a time so that two independent consumers
never clobber each other's tags on the same line (see Design
Decisions, "Writes are scoped per dimension type"). Reads are a direct
entity query by hard-dependency consumers — real, shipped precedent
for exactly this shape exists in this codebase (`sales` reading
`catalog`'s `CatalogProduct` directly, see Design Decisions,
"Cross-module access") — so this document does not invent a
"read-as-command" indirection that has no real analogue in how this
codebase actually reads across a hard dependency today.

## Design Decisions

**A dedicated table, not a field on `JournalEntryLine`.** A single
pair of columns (`dimensionType`/`dimensionId`, analogous to
`referenceType`/`referenceId` elsewhere in the codebase) would only
support **one** dimension per line — it cannot solve "counterparty
*and* cost centre at the same time." One-to-many structure instead:

```typescript
JournalEntryLineDimension {
  id: uuid
  journalEntryLineId: uuid   // FK-id to ledger.JournalEntryLine
  dimensionType: string       // 'CostCenter' | 'BankAccount' | 'FixedAsset' | 'Currency'
  dimensionId: string
  tenantId: uuid
  organizationId: uuid
  createdAt: timestamp
}
```

One line can have several rows in this table — a counterparty and a
cost centre at once, with no conflict.

**Excludes the counterparty.** The counterparty on a journal entry
line is already handled by `contractorSnapshot: json` (nullable)
directly on `JournalEntryLine` (see `2026-09-06-contractor-registry.md`;
`json`, not `jsonb` — #5663's own Design Decisions specify `json`
explicitly, and an earlier draft of this document mistyped it as
`jsonb`, the identical mistake `contractor-registry.md` already caught
and fixed in itself the day before — corrected here) — for audit
reasons (a snapshot at posting time, not a live reference). This table
handles the remaining dimensions: cost centre/project, bank account,
fixed asset, currency. This table
is not the place to compute a per-contractor running balance — that
lives in `accounts_payable`'s own subsidiary-ledger-shaped tables
(`VendorInvoice` and `accounts_payable_payments`, both keyed by
`vendorId`), reconciled against the single shared control account
(`accounts_payable.liabilityAccountId`; see
`2026-09-06-accounts-payable.md`, Design decisions).
`contractorSnapshot` here is audit-only (a point-in-time copy), not a
queryable balance mechanism.

**Why this is a separate document from Posting Rules Engine, and why
that split is now justified differently than an earlier draft claimed
(2026-09-08, this review round).** An earlier draft of this section
justified the split by citing #5663's Out of Scope section as already
treating the dimension table as a separate concern from the engine
that uses it. That citation was checked directly against #5663's real
text and found to be wrong: #5663 says the table "ships together with
the posting-rules/konto 490 engine in a future spec, not here" — i.e.
#5663 anticipated *one* combined future document, not two. The real,
verified reason to keep this as its own document is different and
stronger: this table has **more than one independent consumer**.
`2026-09-06-posting-rules-engine.md` consumes it now (the 4→5 engine).
Separately, `2026-09-06-fixed-assets.md` (Design Decisions,
`transferAsset`) already commits its own future Phase 2 to consuming
this same table, independent of Posting Rules Engine. **Caveat, added
this round**: unlike the #5663 check (an externally-authored,
already-merged source on its own branch), `fixed-assets.md` is an
untracked draft sitting in this same working tree, plausibly authored
in the same pass as this document — it confirms the two-consumers
claim textually, but carries less independent weight than the #5663
check, and is worth re-confirming once `fixed-assets.md` itself goes
through its own fresh-context review. Taking it at face value for now:
if this table's entity lived inside the `posting_rules` module, Fixed
Assets Phase 2 would need a hard dependency on the entire
`posting_rules` module (its event subscriber, its reconciliation
sweeper, its fiscal-period guard) just to write one dimension tag it
has no other use for. A separate, minimal module with no logic of its
own avoids that coupling for either consumer.

**Cross-module access: a direct entity read for hard-dependency
consumers, matching real precedent — corrected this round.** An
earlier draft of this document argued that none of
`packages/core/AGENTS.md`'s three sanctioned Cross-Module Coupling
mechanisms (Events, Widget injection/enrichers, FK-id + snapshot)
fits a hard-dependency backend read, and that a direct `entityManager`
read across a module boundary is "new, unprecedented coupling" —
inheriting that characterization from the Accounts Payable Payments
document's own review, which flagged its own read of
`accounts_payable.VendorInvoice` as having "zero existing repo
precedent." **That characterization does not hold up once checked
against the wider codebase, not just against `ModuleConfigService`
call sites** (which is what the AP Payments check actually verified).
Real, shipped counter-example: `sales/commands/documents.ts` (`sales`
declares `requires: ['catalog', 'customers', 'dictionaries']`) directly
imports `CatalogProduct`/`CatalogProductUnitConversion` from
`../../catalog/data/entities` and queries them with its own
`entityManager` via `findOneWithDecryption`/`findWithDecryption` —
exactly the "hard-dependency module reads another hard-dependency
module's entity directly" shape this document previously claimed had
no precedent. Given that real precedent exists, this document adopts
it directly rather than inventing a "read exposed as a command"
workaround for a problem the codebase doesn't actually have: hard-
dependency consumers (`posting_rules`, later `fixed_assets`) import
`JournalEntryLineDimension` from this module's `data/entities.ts` and
query it themselves, scoped by `tenantId`/`organizationId`, exactly
like `sales` does for `CatalogProduct`. This does **not** change how
*writes* work (see next decision) — root `AGENTS.md`'s Command Side
Effects rule ("write operations via the Command pattern") is about
mutation, and nothing in the `sales`/`catalog` precedent shows a
foreign module writing to another module's entity directly; every
real write in this codebase still goes through the owning module's own
command.

**Writes are scoped per dimension type, not a full-line replace —
corrected this round.** An earlier draft of `setJournalEntryLineDimensions`
replaced *every* dimension row for a line in one call, justified by
"every real caller has the complete target set in hand." That
assumption directly contradicts this document's own reason for
existing: Posting Rules Engine and Fixed Assets Phase 2 are
independent, decoupled consumers of the same table. If Fixed Assets'
future `transferAsset` called a full-line replace with only
`{CostCenter: X}`, it would silently delete a `{FixedAsset: assetId}`
tag Posting Rules Engine (or anything else) had already set on that
same line — neither consumer has the other's dimensions "in hand" by
design. Corrected: the command is
`setJournalEntryLineDimension(journalEntryLineId, dimensionType,
dimensionIds: string[])` — replaces only the rows matching that one
`(journalEntryLineId, dimensionType)` pair, leaving every other
dimension type on the line untouched. Each consumer owns and replaces
only the dimension type(s) it's responsible for; two consumers writing
different types to the same line never collide. `dimensionIds` is an
array (not a single id) to leave room for a dimension type that
genuinely needs more than one value per line (none identified yet) —
the common case (one `CostCenter`, one `FixedAsset`) is simply an
array of length one; nothing in Phase 1 enforces a maximum, since no
real case needing a limit has been identified (tracked in Out of
Scope if one ever does).

**Undo contract, using the real `prepare`/`buildLog`/`undo` hooks —
corrected this round.** An earlier draft cited a `captureBefore` hook
as "the real pattern already used in `customers/commands/people.ts`."
Checked directly against `packages/shared/src/lib/commands/types.ts`
and against `people.ts` itself: no `captureBefore` hook exists
anywhere in the codebase (a repo-wide grep returns zero matches); the
real `CommandHandler` interface defines `prepare?(input, ctx):
Promise<{ before?: unknown } | null>`, called by the command bus
before `execute()` runs, and `people.ts`'s own update command uses
exactly that — `async prepare(rawInput, ctx) { ...; return snapshot ?
{ before: snapshot } : {} }`. Corrected:
`setJournalEntryLineDimension`'s `prepare()` loads the line's current
rows for that one `(journalEntryLineId, dimensionType)` pair before
the replace and returns `{ before: existingRows }`; `buildLog` records
`payload: { undo: { before, after } }` (mirroring the real
`snapshotBefore`/`snapshotAfter` shape); `undo` reads
`extractUndoPayload` and restores exactly the `before` rows for that
type (delete the current rows for that type, reinsert `before`). Every
write is content-idempotent (calling it twice with the same
`dimensionIds` array leaves the same rows in place, modulo fresh
`id`/`createdAt` on the reinsert — see Testing Strategy) but not
row-identity-idempotent: nothing today reads a dimension row's own
`id`, so this is harmless in Phase 1.

**No events in Phase 1.** No module reacts to a dimension being set
yet — Posting Rules Engine calls `setJournalEntryLineDimension`
synchronously as part of its own reclassification flow and needs no
notification. Adding
`journal_entry_line_dimension.line_dimension_set` now, with zero
subscribers, would be speculative (YAGNI, same reasoning already used
elsewhere in this document family for cross-organization sharing and
async contractor verification). Revisit if a real asynchronous
consumer emerges.

**No ACL features, no API routes, no backend pages in Phase 1.**
Nothing in this module is user-facing yet — the write command is
called by other modules' own backend logic, never directly by a
person through a screen or a raw HTTP call, and reads are a direct
entity query by trusted hard-dependency code, not an exposed endpoint.
Adding `view`/`manage` features or CRUD routes now, with no page to
gate, would be speculative surface with nothing to protect. Revisit
once a real admin need appears (e.g. "show me every line tagged with
cost centre X" as a reporting screen) — tracked in Out of Scope.

**No encryption.ts.** Neither `dimensionType` (a closed enum-like
string) nor `dimensionId` (a UUID reference to another entity) is
PII or GDPR-sensitive on its own — the sensitive data those ids point
to (a specific contractor's bank account, say) already has its own
encryption map in the module that owns it. This table stores only
references.

**Zod validation on the write command's input — added this round.**
An earlier draft specified no input schema anywhere for
`setJournalEntryLineDimension`, missing root `AGENTS.md`'s "Validate
all inputs with zod; place validators in `data/validators.ts`" rule —
a rule that applies to command inputs generally, not only HTTP API
routes (real precedent: `sales/commands/documents.ts` defines
`z.object({...})` schemas directly for its own custom, non-CRUD
commands, e.g. `quoteConvertToOrderSchema`). Corrected:
`data/validators.ts` declares
`setJournalEntryLineDimensionSchema = z.object({ journalEntryLineId:
z.string().uuid(), dimensionType: z.string().min(1), dimensionIds:
z.array(z.string().uuid()).min(1) })`, and the command's `execute`
parses input through it before touching the database.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| A single `dimensionType`/`dimensionId` pair directly on `JournalEntryLine` | Cannot represent more than one dimension per line (the whole reason this table exists) |
| Build this table as part of `2026-09-06-posting-rules-engine.md` (one combined document) | Rejected 2026-09-08 after checking #5663's real text and Fixed Assets' own Phase 2 plans — see Design Decisions, "Why this is a separate document" |
| Full-line replace (`setJournalEntryLineDimensions`, replacing every dimension type on a line in one call) | Rejected this round: silently drops another independent consumer's dimensions on the same line — see Design Decisions, "Writes are scoped per dimension type" |
| Expose reads as a `commandBus` command (`getJournalEntryLineDimensions`) | Rejected this round: real precedent (`sales` reading `catalog`'s `CatalogProduct` directly) already covers a hard-dependency direct entity read; wrapping it as a command solves a problem this codebase doesn't actually have — see Design Decisions, "Cross-module access" |
| Direct `entityManager` write from a consumer module against this module's entity | Never seriously considered: every real write in this document family goes through the owning module's own Command (undo, validation, transaction discipline live there) — no precedent anywhere for a foreign module writing another module's entity directly |

## Architecture

### Entities (`data/entities.ts`)

- `JournalEntryLineDimension` — `journalEntryLineId` (FK-id to
  `ledger.JournalEntryLine`, no ORM relation), `dimensionType`,
  `dimensionId`, `tenantId`, `organizationId`, `createdAt`. No
  `updatedAt`/`deletedAt`: rows are never individually edited or soft-
  deleted — a `(line, dimensionType)` pair's rows are replaced
  atomically by `setJournalEntryLineDimension` (old rows for that pair
  hard-deleted, new rows inserted, in the same transaction), matching
  the exemption already used for sub-resource rows like
  `VendorInvoiceLine`/`PaymentBatchLine` guarded by their parent
  aggregate. Exported from this module so hard-dependency consumers
  can import and query it directly (see Design Decisions,
  Cross-module access).

### Access Control (`acl.ts`)

**No features in Phase 1.** No UI, no API route — nothing to gate.
See Design Decisions.

### Module Dependency (`index.ts`)

A hard, declared dependency on `ledger` (the FK target), expressed
through the real, generation-time-validated `ModuleInfo.requires`
mechanism (`packages/shared/src/modules/registry.ts`), already used by
`sales`/`wms`:

```typescript
// index.ts
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'journal_entry_line_dimension',
  title: 'Journal Entry Line Dimension',
  version: '0.1.0',
  description:
    'Multi-dimensional analytical tags (cost centre, bank account, fixed asset, currency) on a journal entry line.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger'],
  ejectable: true,
}
```

### Encryption (`encryption.ts`)

**None needed.** See Design Decisions.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: [],
}
```

No features exist yet to grant (see Access Control); this stays empty
until a real UI need adds some.

### Commands (Command Pattern, `commands/`)

- `setJournalEntryLineDimension` — replaces the dimension rows for one
  `(journalEntryLineId, dimensionType)` pair. Input:
  `{ journalEntryLineId, dimensionType, dimensionIds: string[] }`,
  validated through `data/validators.ts`'s
  `setJournalEntryLineDimensionSchema`, always scoped by
  `tenantId`/`organizationId`. Implementation: `prepare()` loads the
  existing rows for that pair (`{ before: existingRows }`); `execute`
  runs, inside `withAtomicFlush`, a hard-delete of that pair's existing
  rows followed by inserting the new `dimensionIds` set; `buildLog`
  records `{ undo: { before, after } }`; `undo` restores the `before`
  rows for that pair. Content-idempotent (see Design Decisions).
  Every other dimension type already set on the same line is left
  untouched.

This is a plain custom command (like AP's
`postVendorInvoice`/`markPaymentBatchSent`), not built on
`makeCrudRoute` — there is no HTTP route or form behind it. There is
no separate read-side command; see Cross-module integration for how
consumers read.

### Events (`events.ts`)

**None in Phase 1.** See Design Decisions.

### Cross-module integration

- **`ledger` — a hard, declared dependency, not an optional peer.**
  `journalEntryLineId` is a plain FK-id (no ORM relation); this module
  never resolves or calls any `ledger` service — it only stores a
  reference for its own command to filter by.
- **Consumers (`posting_rules` now, `fixed_assets` later) — hard
  dependencies on this module.** A consumer declares `requires:
  ['journal_entry_line_dimension']` (alongside whatever else it
  needs). For writes, it calls
  `container.resolve('commandBus').execute('journal_entry_line_dimension.setJournalEntryLineDimension',
  input, ctx)` — the same generic mechanism `workflows`'
  `UPDATE_ENTITY` already uses for a hard-dependency call by string
  `commandId`. For reads, it imports `JournalEntryLineDimension` from
  `journal_entry_line_dimension/data/entities` and queries it directly
  with its own `entityManager` (scoped by `tenantId`/`organizationId`),
  matching the real, verified precedent of `sales` reading `catalog`'s
  `CatalogProduct` the same way. No degradation to design for either
  call: if this module were disabled, neither consumer has a
  functional meaning without it, exactly like AP without `ledger`.
- **This module never imports or resolves anything belonging to its
  consumers.** One-way dependency direction (consumer →
  `journal_entry_line_dimension`), matching `packages/core/AGENTS.md`'s
  "upstream module MUST NOT import, resolve, or hard-require the
  consumer."

### Backend Pages

**None in Phase 1.** See Design Decisions.

## Data Models

### JournalEntryLineDimension

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid, PK | |
| `journal_entry_line_id` | uuid | FK-id to `ledger.journal_entry_line`, no ORM relation |
| `dimension_type` | text | `'CostCenter'` \| `'BankAccount'` \| `'FixedAsset'` \| `'Currency'` (open string, not a DB enum, so a future dimension type needs no migration) |
| `dimension_id` | uuid | References an entity in another module by id; which module depends on `dimension_type` and is resolved by the caller, not by this table |
| `tenant_id` | uuid | |
| `organization_id` | uuid | |
| `created_at` | timestamp | |

Index: `(journal_entry_line_id, dimension_type)` — the only query
shape this module serves today: `setJournalEntryLineDimension` deletes
by this pair, and every consumer read filters by this same pair (plus
tenant/org). **Corrected this round**: an earlier draft also added a
second, speculative index (`tenant_id, organization_id, dimension_type,
dimension_id`) for a hypothetical future reporting query with no
identified caller — inconsistent with this same document's own YAGNI
reasoning for deferring ACL/UI/events. Dropped; add it in Phase 2 if
and when a real reporting screen needs it (tracked in Out of Scope).

## API Contracts

**None.** This module exposes no HTTP routes — the write happens
through its one command, called in-process by other modules' own
backend code; reads happen through a direct entity query by those same
trusted, hard-dependency modules. See Design Decisions and
Architecture → Backend Pages.

## Migration & Deployment

One new, additive table (`journal_entry_line_dimension`), zero changes
to any existing table. No backfill: the table starts empty and stays
empty until a consumer (Posting Rules Engine) starts calling
`setJournalEntryLineDimension`. No `onTenantCreated` hook needed —
nothing to seed (no default role features, no module config).

## Implementation Plan

### Phase 1: table + write command, zero consumers

1. `JournalEntryLineDimension` entity + migration (FK-id to
   `ledger.journal_entry_line`, the `(journal_entry_line_id,
   dimension_type)` index above).
2. `index.ts` with `ModuleInfo.requires: ['ledger']`.
3. `data/validators.ts` with `setJournalEntryLineDimensionSchema`.
4. `setJournalEntryLineDimension` command (type-scoped replace,
   transaction-wrapped via `withAtomicFlush`, undo-capable via
   `prepare`/`buildLog`/`undo` per Design Decisions).
5. `setup.ts` with an empty `defaultRoleFeatures.admin: []`.
6. Unit tests for the command and for consumer-style direct reads (see
   Testing Strategy).

### Phase 2 (deferred)

- ACL features + a minimal read-only backend page, once a real
  reporting need appears (e.g. "list every line tagged with cost
  centre X") — add the dropped reporting index (see Data Models) at
  the same time, once that query shape is real.
- Events, once a real asynchronous consumer emerges.
- A maximum-`dimensionIds`-per-type constraint, if a real case
  requiring "exactly one" per type ever surfaces (none identified in
  Phase 1).

## File Manifest

```
packages/core/src/modules/journal_entry_line_dimension/
├── index.ts
├── acl.ts                          (empty features array)
├── setup.ts
├── data/
│   ├── entities.ts                 (JournalEntryLineDimension)
│   └── validators.ts               (setJournalEntryLineDimensionSchema)
├── data/migrations/
│   └── ...                         (create table + index)
└── commands/
    └── setJournalEntryLineDimension.ts
```

## Testing Strategy

- `setJournalEntryLineDimension` replaces only the rows for the given
  `(journalEntryLineId, dimensionType)` pair — a different type
  already set on the same line is left untouched (regression test for
  the full-line-replace bug this round fixed).
- Calling it twice with the same `dimensionIds` leaves the same
  *content* in place (content-idempotent); row `id`/`createdAt` are
  not asserted to be stable across the two calls (not
  row-identity-idempotent, see Design Decisions).
- `undo` restores exactly the pre-replace rows for that
  `(journalEntryLineId, dimensionType)` pair (unit test against the
  real `prepare`/`buildLog`/`undo` contract).
- `setJournalEntryLineDimensionSchema` rejects a non-UUID
  `journalEntryLineId`, an empty `dimensionType`, and an empty
  `dimensionIds` array.
- A direct consumer-style read (querying `JournalEntryLineDimension`
  with an `entityManager`, as `posting_rules`/`fixed_assets` will)
  returns rows scoped to the correct `tenantId`/`organizationId` only
  — a row from another tenant never leaks.
- `packages/core/src/__tests__/module-decoupling.test.ts` — the app
  still boots with this module disabled (only `posting_rules`, not yet
  built, would be affected; nothing in Phase 1 depends on this module
  being present for the app itself to function).

## Risks & Impact Review

### Data integrity failures

#### Two independent consumers writing different dimension types to the same line
- **Scenario**: Posting Rules Engine sets `{CostCenter: X}` and,
  independently, Fixed Assets Phase 2 sets `{FixedAsset: Y}` on the
  same `journalEntryLineId`.
- **Severity**: Low — this is the expected, designed-for case, not a
  failure
- **Affected area**: `journal_entry_line_dimension` only
- **Mitigation**: `setJournalEntryLineDimension` is scoped to one
  `(journalEntryLineId, dimensionType)` pair per call (see Design
  Decisions, "Writes are scoped per dimension type") — the two calls
  touch disjoint rows and never collide. This risk entry exists to
  record that the earlier, full-line-replace design would **not** have
  been safe here; the corrected design is.
- **Residual risk**: none for disjoint types. If two consumers ever
  need to write the *same* `dimensionType` for the *same* line with
  different values, that is a genuine business-rule conflict (not a
  technical race) requiring its own resolution policy — not identified
  in Phase 1, since no two consumers share a dimension type today.

#### Concurrent `setJournalEntryLineDimension` calls for the same `(line, type)` pair
- **Scenario**: two calls replace the same pair's rows at nearly the
  same time.
- **Severity**: Low
- **Affected area**: `journal_entry_line_dimension` only — no
  financial data, no ledger balance is affected either way
- **Mitigation**: `withAtomicFlush`/transaction wrapping around the
  delete-then-insert makes each call atomic; the last call to commit
  wins, an acceptable outcome for a tagging table with no independent
  semantic ordering.
- **Residual risk**: none identified — unlike a financial posting, two
  callers racing here produce "the last one's tags for that type
  stick," not a corrupted or unbalanced financial record.

### Cascading failures & side effects

#### The `ledger` module unavailable
- **Scenario**: `ledger` is disabled or unavailable.
- **Severity**: Critical, but intentional
- **Affected area**: the whole module — `journalEntryLineId` values
  reference rows that no longer resolve to anything meaningful.
- **Mitigation**: no degradation to design — this is a generation-
  time-validated hard dependency (`ModuleInfo.requires`), analogous to
  every other hard dependency on `ledger` in this document family.
- **Residual risk**: none — expected behavior for a missing hard
  dependency; in practice impossible to trigger, since module
  registration validates `requires` at generation time.

### Tenant & data isolation

`JournalEntryLineDimension` carries its own `tenant_id`/
`organization_id` columns (not just inherited through the FK to
`JournalEntryLine`), matching the pattern already used for
`VendorInvoiceLine`/`PaymentBatchLine`/`ContractorBankAccount`. Every
consumer read is required to filter by both, exactly as
`sales`'s own direct `catalog` reads do.

### Migration & deployment

One new, additive table. No backfill, no default config, no
`onTenantCreated` hook — see Migration & Deployment above.

## Out of scope (tracked separately)

- ACL features and a reporting/admin backend page, plus the reporting
  index this round dropped from Phase 1 — deferred until a real need
  appears (Phase 2).
- Events for dimension changes — no identified subscriber yet (Phase
  2, revisit when one emerges).
- A maximum-`dimensionIds`-per-type constraint — no identified need
  yet (Phase 2, if one surfaces).
- A conflict-resolution policy for two consumers writing the *same*
  dimension type to the same line — not needed today (no two
  consumers share a type), tracked as a future risk if that ever
  changes (see Risks & Impact Review).
- The posting-rule logic that decides *which* dimension to attach
  (e.g. "check `DefaultAccountPostingRule` if no explicit dimension
  exists") — that decision logic belongs to each consumer
  (`2026-09-06-posting-rules-engine.md`), not to this table.
- Reporting/aggregation by dimension (e.g. a P&L cut by cost centre)
  — a future reporting-layer concern, not this module's.

## Final Compliance Report — 2026-09-08

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `.ai/skills/om-spec-writing/SKILL.md` (Quick Rule Reference, cited in
  the Compliance Matrix below — added this round; an earlier draft's
  reviewed-files list omitted it despite citing it)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `journalEntryLineId`, `dimensionId` are both plain FK-id, no relation decorators |
| root AGENTS.md | Filter by organization_id | Compliant | Own `tenant_id`/`organization_id` columns, not just inherited through the FK |
| `packages/core/AGENTS.md` → Cross-Module Coupling | Hard dependency uses direct resolution, not `tryResolve` | Compliant | Write via direct `commandBus.execute` (real `workflows`/`UPDATE_ENTITY` precedent); reads via a direct entity query (real `sales`/`catalog` precedent) — **corrected this round**, see Design Decisions, "Cross-module access" |
| `packages/core/AGENTS.md` → Cross-Module Coupling (hard dependency mechanism) | Hard dependency declared through `ModuleInfo.requires` | Compliant | `index.ts` with `metadata.requires: ['ledger']` |
| `packages/core/AGENTS.md` → Database Entities | User-editable entities MUST include `updated_at`/`deleted_at` | N/A, exempt | Rows are never individually edited or soft-deleted — a `(line, type)` pair's rows are replaced atomically, matching the existing sub-resource exemption used for `VendorInvoiceLine`/`PaymentBatchLine` |
| `packages/core/AGENTS.md` → Command Side Effects | Write operations via the Command pattern | Compliant | `setJournalEntryLineDimension` is a command, not a direct mutation from a route handler or a foreign module (there is no route, and no foreign module writes this entity directly) |
| `packages/core/AGENTS.md` → Entity Update Safety | Multi-phase mutations use `withAtomicFlush` | Compliant | Delete-then-insert (for one type) wrapped in one transaction |
| Quick Rule Reference (`om-spec-writing` SKILL.md) | Undoability is the default for state changes | Compliant | `prepare`/`buildLog`/`undo` contract using the real hook names, verified against `packages/shared/src/lib/commands/types.ts` and `customers/commands/people.ts` — **corrected this round** (an earlier draft cited a non-existent `captureBefore` hook) |
| Quick Rule Reference (`om-spec-writing` SKILL.md) | Zod validation for all inputs, in `data/validators.ts` | Compliant | `setJournalEntryLineDimensionSchema` — **added this round**, an earlier draft had no validator anywhere |
| `packages/core/AGENTS.md` → Encryption | GDPR/PII fields declared in `<module>/encryption.ts` | N/A | No PII/GDPR-sensitive field — see Encryption |
| `packages/core/AGENTS.md` → Access Control (RBAC) | Features declared per module | N/A | No UI/API surface in Phase 1 — nothing to gate, see Access Control |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | One new table only |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match architecture | Pass | One entity, matches the Architecture section |
| Commands defined for the module's mutating operation | Pass | The one write operation has a named command; reads are a direct query, not a command (see Design Decisions) |
| Undo contract present for the state-changing command | Pass | Uses the real `prepare`/`buildLog`/`undo` hooks — corrected this round |
| Risks cover all write operations | Pass | Multi-consumer collision (now architecturally prevented) and `ledger`-unavailable cascade both addressed |
| Scope cohesion vs. other modules | Pass | Single, narrow capability (multi-dimensional tagging), independently deployable given its one hard dependency (`ledger`); has zero consumers on its own by design, but that's a Phase-1 characteristic, not a scope-bundling problem (see Design Decisions on why it's split from Posting Rules Engine) |
| Scope cohesion *within* this document | Pass | One entity, one write command, one integration seam (`ledger`) |
| Cross-module coupling mechanism matches dependency type | Pass | Hard dependency (`ledger`) via FK-id only; write via `commandBus` (real precedent); read via direct entity query (real precedent) — no invented mechanism |

### Non-Compliant Items

None outstanding after this round's fixes.

### Verdict

**Ready for maintainer review, with the caveat below made explicit
rather than glossed over.** This document went through the
`om-spec-writing` Step 8 checklist (including a fresh-context
subagent review) and Step 9 Compliance Gate twice: once producing the
version described in the first Changelog entry below, and a second
time — this entry — after the fresh-context reviewer found, and this
review round personally verified against the real repository, six
concrete errors in that first version: a non-existent `captureBefore`
undo hook (real hook is `prepare`), a false "no precedent for direct
cross-module reads" claim (real counter-example: `sales` reading
`catalog`'s `CatalogProduct`), a full-line-replace write design that
would have silently deleted one consumer's tags when a second,
independent consumer wrote to the same line, a `jsonb`/`json` type
error on `contractorSnapshot` already caught and fixed once before in
a sibling document, a missing Zod validator, and a speculative index
inconsistent with this document's own YAGNI reasoning elsewhere. All
six are fixed in this version; the fixes are load-bearing, not
cosmetic — the undo hook and the direct-read design would not have
worked as originally specified, and the full-line-replace design would
have caused real data loss the moment a second consumer existed. One
caveat remains open, not a defect: this document's own "two
independent consumers" justification for staying split from
`2026-09-06-posting-rules-engine.md` leans partly on
`2026-09-06-fixed-assets.md`, an untracked sibling draft rather than an
independently-authored source — worth reconfirming once
`fixed-assets.md` itself goes through its own fresh-context review.

## Changelog

### 2026-09-06

Initial skeleton (Polish): TLDR, split rationale from
`posting-rules-engine.md` (citing #5663's Out of Scope section),
Design Decisions (dedicated table, excludes counterparty, empty
structure), a sketch Implementation Plan.

### 2026-09-08 — full expansion, written directly in English, `om-spec-writing` Step 8/9 applied

- Verified the original split rationale's citation of #5663 directly
  against #5663's real, already-committed text
  (`docs/spec-072-general-ledger-core-engine` branch) and found it
  wrong — #5663 anticipates one combined future document, not a split.
  Replaced it with the real, verified justification: two independent
  future consumers (Posting Rules Engine now, Fixed Assets Phase 2
  later), confirmed directly against `2026-09-06-fixed-assets.md`'s
  own Design Decisions. Made the same correction in the corresponding
  note in `2026-09-06-posting-rules-engine.md`.
- Designed the write side as a command on `commandBus`
  (`setJournalEntryLineDimensions`, full-line-replace) and the read
  side as a second command on the same bus
  (`getJournalEntryLineDimensions`), to avoid reproducing a direct
  cross-module entity read the AP Payments document had flagged as
  unprecedented.
- Designed an undo contract for the write command citing a
  `captureBefore` hook, said to mirror `customers/commands/people.ts`.
- Wrote the full spec: Overview, Proposed Solution, Alternatives
  Considered, Architecture, Data Models, API Contracts (N/A,
  justified), Migration & Deployment, Implementation Plan, File
  Manifest, Testing Strategy, Risks & Impact Review, Out of Scope,
  Final Compliance Report.
- Ran the `om-spec-writing` skill's Step 8 (checklist, including a
  fresh-context subagent review) and Step 9 (Compliance Gate).

### 2026-09-08 (cont. — fixes from the fresh-context review of the above pass)

The fresh-context subagent review (Step 8) found, and this round
personally re-verified against the real repository before accepting,
six concrete defects in the pass above — none caught by that pass's
own self-authored compliance report:

- The `captureBefore` hook does not exist anywhere in the codebase
  (repo-wide grep: zero matches). The real `CommandHandler` hook is
  `prepare?(input, ctx): Promise<{ before?: unknown } | null>`
  (`packages/shared/src/lib/commands/types.ts`), and
  `customers/commands/people.ts`'s real update command uses exactly
  that. As originally specified, the undo path would have silently
  failed to capture any "before" state. Fixed: the command now uses
  `prepare`/`buildLog`/`undo` with the real signature.
- The claim that a direct cross-module entity read has "zero existing
  repo precedent" was checked only against `ModuleConfigService` call
  sites (correct for that specific claim, made in the AP Payments
  document) but was over-generalized here to all direct entity reads.
  Verified counter-example: `sales/commands/documents.ts` imports
  `CatalogProduct`/`CatalogProductUnitConversion` from
  `../../catalog/data/entities` and queries them directly via
  `findOneWithDecryption`/`findWithDecryption` — real, shipped
  precedent for exactly this shape. Fixed: removed the
  `getJournalEntryLineDimensions` command; hard-dependency consumers
  now read the entity directly, matching that precedent.
- The full-line-replace write design directly contradicted this
  document's own justification for existing (independent consumers of
  the same table) — a second consumer writing a different dimension
  type to a line would have silently deleted the first consumer's
  tags. Fixed: the command is now scoped to one
  `(journalEntryLineId, dimensionType)` pair per call
  (`setJournalEntryLineDimension`, singular).
- `JournalEntryLine.contractorSnapshot` was typed `jsonb`; #5663
  specifies `json`. `2026-09-06-contractor-registry.md` had already
  caught and fixed the identical mistake in itself one day earlier;
  this document repeated it. Fixed.
- No Zod validator existed for the command's input, missing root
  `AGENTS.md`'s "Validate all inputs with zod... in `data/validators.ts`"
  rule (a rule the Compliance Matrix itself didn't check against).
  Fixed: added `setJournalEntryLineDimensionSchema`.
- A second database index, justified only by a hypothetical future
  reporting query with no identified caller, was inconsistent with
  this same document's own YAGNI reasoning for deferring ACL/UI/events
  in Phase 1. Dropped; deferred to Phase 2 alongside the reporting
  screen that would need it.

Also softened one claim rather than treating it as settled: this
document's "two independent consumers" split justification partly
relies on `2026-09-06-fixed-assets.md`, an untracked sibling draft
rather than an independently-authored source like #5663 — flagged in
Design Decisions and the Verdict as worth reconfirming once
`fixed-assets.md` gets its own fresh-context review, not treated with
the same confidence as the #5663 check.

### 2026-09-08 (cont. — control-account / subsidiary-ledger
clarification)

Added a clarifying note to "Excludes the counterparty": this table is
deliberately not where a per-contractor running balance is computed —
that lives in `accounts_payable`'s own tables (`VendorInvoice.vendorId`
against the shared `liabilityAccountId` control account), the standard
control-account / subsidiary-ledger pattern. Written in the same round
as the corresponding Design Decision added to
`2026-09-06-accounts-payable.md` and the correction to
`2026-08-18-general-ledger-core-engine.md`'s "Multi-dimensional
posting tags" bullet (which had listed kontrahent as a candidate
dimension type before this document settled on excluding it) — all
three kept consistent.
