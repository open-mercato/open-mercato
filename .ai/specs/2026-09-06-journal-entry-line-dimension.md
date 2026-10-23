# Journal Entry Line Dimension — multi-dimensional tag on a journal line

**Related:** [General Ledger core engine](https://github.com/open-mercato/open-mercato/pull/5663)
(GL's own Out of Scope section anticipates this table, and this
document is the future spec it points to), [Posting Rules Engine](https://github.com/open-mercato/open-mercato/pull/6015)
(first consumer — the 490 engine needs a CostCenter dimension on a
line — see Design Decisions), [Fixed Assets](https://github.com/open-mercato/open-mercato/pull/6014)
(second future consumer — Phase 2's `transferAsset` reassigns the
cost centre (MPK) — see Design Decisions), [Contractor Registry](https://github.com/open-mercato/open-mercato/pull/5955)
and [Accounts Payable](https://github.com/open-mercato/open-mercato/pull/5962)
(the counterparty exclusion below rests on both), and the pending
`.ai/specs/SPEC-024-2026-02-11-financial-module.md` on `develop` (its
GL sketch puts a `dimensions` map on the journal line — see
Alternatives Considered)
, [Fixed Assets](https://github.com/open-mercato/open-mercato/pull/6014)
(second, independent future consumer — Phase 2's `transferAsset` —
see Design Decisions)

**Depends on unmerged PRs.** #5663, #6015, #6014, #5955 and #5962 are
open, unmerged PRs, not files in `.ai/specs/` yet, so they are linked by
PR number rather than by filename. `ledger` (this module's hard
dependency, `requires: ['ledger']`) is likewise not yet present under
`packages/core/src/modules/`. The counterparty exclusion (Design
Decisions, "Excludes the counterparty") is consistent across this
document, Contractor Registry and Accounts Payable only as long as #5955
and #5962 merge with their 2026-09-08 edits intact (counterparty held
only in `contractorSnapshot`; per-contractor balance in the AP
subsidiary ledger against one control account); if either changes, that
section must be re-checked. Once the siblings land on `develop`, swap
the PR links back to relative filenames.


## TLDR

A dedicated `journal_entry_line_dimensions` table that lets a journal
entry line carry analytical dimensions as separate rows instead of
through the chart of accounts, without exploding the chart into a
cartesian product of combinations. The table is shaped for more than one
independent dimension per line, but Phase 1 ships exactly one type,
`CostCenter` (cost centre/project); further types are added when a
consumer that writes them exists. This document builds only the table,
its own write command, and a directly-queryable entity for
hard-dependency consumers to read; no module writes or reads it yet.

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

A single journal entry line (`JournalEntryLine`) needs an analytical
dimension that the chart of accounts cannot carry without exploding.
Example: a cost line posted for a department needs its cost centre/
department (which cost bucket it belongs to, for the 490 engine /
Posting Rules Engine), and a later asset transfer may need to change
that cost centre (Fixed Assets Phase 2, `transferAsset`). Phase 1 needs
only this one dimension, but the same line can later need a second,
independent one at the same time. Trying to
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

A new, small, standalone module (`journal_entry_line_dimensions`) that
owns exactly one entity. Writes go through one Command, scoped to a
single dimension type at a time, and each consumer tags only lines of
entries it posted itself (see Design Decisions, "Writes are scoped per
dimension type" and "Writers and line ownership"). Reads are a direct
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
support **one** dimension per line — it cannot solve "cost centre
*and* a second dimension at the same time." One-to-many structure instead:

```typescript
JournalEntryLineDimension {
  id: uuid
  journalEntryLineId: uuid   // FK-id to ledger.JournalEntryLine
  dimensionType: string       // Phase 1: 'CostCenter' (see DIMENSION_TYPES)
  dimensionId: string
  writer: string              // owning consumer's module id: 'posting_rules' | 'fixed_assets'
  tenantId: uuid
  organizationId: uuid
  createdAt: timestamp
}
```

One line can have several rows in this table — one per dimension type
(and, for a type that needs it, several values) — so a second dimension
type later needs no schema change.

**Excludes the counterparty.** The counterparty on a journal entry
line is already handled by `contractorSnapshot: json` (nullable)
directly on `JournalEntryLine` (see Contractor Registry, #5955;
`json`, not `jsonb`, per #5663's Design Decisions) — for audit
reasons (a snapshot at posting time, not a live reference). This table
handles the remaining dimensions, of which Phase 1 ships only the cost
centre/project. This table
is not the place to compute a per-contractor running balance — that
lives in `accounts_payable`'s own subsidiary-ledger-shaped tables
(`VendorInvoice` and `accounts_payable_payments`, both keyed by
`vendorId`), reconciled against the single shared control account
(`accounts_payable.liabilityAccountId`; see
Accounts Payable, #5962, Design decisions).
`contractorSnapshot` here is audit-only (a point-in-time copy), not a
queryable balance mechanism.

**Why this is a separate document from Posting Rules Engine.** #5663's
Out of Scope section says the table "ships together with the
posting-rules/konto 490 engine in a future spec, not here", so #5663
anticipated one combined future document and is not the justification
for a split. The real reason to keep this as its own document is that
the table has **more than one independent consumer**: #6015 (Posting
Rules Engine) consumes it now (the 4→5 engine), and #6014 (Fixed
Assets, Design Decisions, `transferAsset`) commits its Phase 2 to the
same table independently of Posting Rules Engine. Both are open PRs that
have been through their own maintainer reviews. If this table's entity
lived inside the `posting_rules` module, Fixed Assets Phase 2 would need
a hard dependency on the entire `posting_rules` module (its event
subscriber, its reconciliation sweeper, its fiscal-period guard) just to
write one dimension tag it has no other use for. A separate, minimal
module with no logic of its own avoids that coupling for either
consumer.

**Cross-module access: a direct entity read for hard-dependency
consumers, matching real precedent.** None of `packages/core/AGENTS.md`'s
three Cross-Module Coupling mechanisms (Events, Widget injection/
enrichers, FK-id + snapshot) is aimed at a hard-dependency backend read,
and the codebase already has shipped precedent for a direct entity read
in that case: `sales/commands/documents.ts` (`sales` declares
`requires: ['catalog', 'customers', 'dictionaries']`) imports
`CatalogProduct`/`CatalogProductUnitConversion` from
`../../catalog/data/entities` and queries them with its own
`entityManager` via `findOneWithDecryption`/`findWithDecryption`.
Hard-dependency consumers (`posting_rules`, later `fixed_assets`)
therefore import `JournalEntryLineDimension` from this module's
`data/entities.ts` and query it themselves, scoped by
`tenantId`/`organizationId`, exactly like `sales` does for
`CatalogProduct`. This does **not** change how *writes* work (see next
decision): root `AGENTS.md`'s Command Side Effects rule ("write
operations via the Command pattern") is about mutation, and nothing in
the `sales`/`catalog` precedent shows a foreign module writing another
module's entity directly; every real write in this codebase still goes
through the owning module's own command.

**Writes are scoped per `(line, dimensionType)` pair, not a full-line
replace.** The command is `setJournalEntryLineDimension(journalEntryLineId,
dimensionType, dimensionIds: string[])`. It replaces only the rows
matching that one pair and leaves every other dimension type on the line
untouched. A full-line replace would make a consumer that tags one type
delete the tags of another type it knows nothing about, which defeats
the purpose of independent dimensions. `dimensionIds` is an array to
leave room for a type that genuinely needs more than one value per line
(none identified yet); the common case is an array of length one, and
nothing in Phase 1 enforces a maximum (tracked in Out of Scope). Per-type
scoping separates *different types* from each other; it does not by
itself separate two writers of the *same* type — that is the job of the ownership claim below.

**Writers and line ownership.** The writer map, checked against the
current heads of the sibling documents:

| Dimension type | Writer (`writer` value) | Source |
|----------------|-------------------------|--------|
| `CostCenter` | Posting Rules Engine, `posting_rules` (tags the zespół 5 line of the reclassification entry it posts), Phase 1 | #6015 |
| `CostCenter` | Fixed Assets, `fixed_assets` (`transferAsset`, MPK reassignment), Phase 2 | #6014 |
| `CostCenter` | Accounts Payable — not a writer today; #6015 only reads tags "entered manually in AP, once that field exists" | #6015 |
| `BankAccount`, `FixedAsset`, `Currency` | none — not shipped | — |

Two consumers write the same type, so per-type scoping alone does not
separate them: a `transferAsset` that re-tagged a line already tagged by
Posting Rules would replace that tag with no conflict policy and no
error. The module therefore enforces ownership of each `(line,
dimensionType)` pair. Every row carries `writer`, the module id of the
consumer (a closed set, `DIMENSION_WRITERS = ['posting_rules',
'fixed_assets']`), and the command rejects a write when rows for that
pair already exist with a different `writer`. The first writer to tag a
pair owns it; the owner replaces its own rows freely; any other writer
gets an error instead of silently replacing the tag. Consumers tag lines
of entries they posted themselves, so claims never collide in normal
operation and a violation fails loudly. `writer` is declared by the
in-process caller (the command has no HTTP surface), so it guards
against accidental overwrite between trusted modules, not against a
hostile caller. A change of cost centre on a pair owned by another
writer, or after the period is closed, is a correcting entry with its
own tags, not a re-tag.

**Undo contract, using the real `prepare`/`buildLog`/`undo` hooks.**
The command bus calls `prepare?(input, ctx): Promise<{ before?: unknown }
| null>` before `execute()` runs (`packages/shared/src/lib/commands/
types.ts`), and `customers/commands/people.ts`'s update command uses
exactly that: `async prepare(rawInput, ctx) { ...; return snapshot ? {
before: snapshot } : {} }`. `setJournalEntryLineDimension`'s `prepare()`
loads the line's current rows for the one `(journalEntryLineId,
dimensionType)` pair before the replace and returns `{ before:
existingRows }`; `buildLog` records `payload: { undo: { before, after }
}` (mirroring the real `snapshotBefore`/`snapshotAfter` shape); `undo`
reads `extractUndoPayload` and restores exactly the `before` rows for
that type (delete the current rows for that type, reinsert `before`). It
must read the payload through `extractUndoPayload(logEntry)`: reading
`logEntry.payload` directly is always `undefined` and silently turns the
undo into a no-op (`packages/shared/src/lib/commands/types.ts`, issue
#2504). `undo` runs the same line and locked-period checks as `execute`.
Every write is content-idempotent (calling it twice with the same
`dimensionIds` array leaves the same rows in place, modulo fresh
`id`/`createdAt` on the reinsert — see Testing Strategy) but not
row-identity-idempotent: nothing today reads a dimension row's own
`id`, so this is harmless in Phase 1.

**No events in Phase 1.** No module reacts to a dimension being set
yet — Posting Rules Engine calls `setJournalEntryLineDimension`
synchronously as part of its own reclassification flow and needs no
notification. Adding
`journal_entry_line_dimensions.line_dimension_set` now, with zero
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
string) nor `dimensionId` (an opaque reference to another entity's id) is
PII or GDPR-sensitive on its own — the sensitive data those ids point
to (a specific contractor's bank account, say) already has its own
encryption map in the module that owns it. This table stores only
references.

**Zod validation on the write command's input.** Root `AGENTS.md`
requires "validate all inputs with zod; place validators in
`data/validators.ts`", and the rule applies to command inputs generally,
not only HTTP routes (real precedent: `sales/commands/documents.ts`
defines `z.object({...})` schemas directly for its own custom, non-CRUD
commands, e.g. `quoteConvertToOrderSchema`).

**`dimensionType` is a closed enum, not a free string.**
`data/validators.ts` exports a module-owned constant
`DIMENSION_TYPES = ['CostCenter'] as const` and validates against it
with `z.enum(DIMENSION_TYPES)`, so a typo'd or made-up type fails at the
command boundary instead of a consumer's read silently finding nothing.
Phase 1 lists only a type that has a named writer (see "Writers and line
ownership"); `BankAccount`, `FixedAsset` and `Currency` are added when a
consumer that writes them exists. `Currency` is not a candidate,
and since 2026-10-23 for a different reason: #5663 gives every
`JournalEntryLine` its own `currencyId`, `exchangeRate` and
`amountCurrency`, so currency is a column of the line and not a
dimension, and a dimension tag would duplicate that column and could
contradict it. The `dimension_type` database column itself stays `text`,
not a Postgres enum — adding a type is a one-line change to
`DIMENSION_TYPES` plus a validation-layer deploy, not a migration; the enum lives at the validation layer, not the schema layer.

`DIMENSION_WRITERS = ['posting_rules', 'fixed_assets'] as const` is the
closed set of consumers allowed to own a `(line, dimensionType)` pair
(see "Writers and line ownership"); a new consumer adds its module id
there, a validation-layer change like adding a dimension type.

`data/validators.ts` declares
`setJournalEntryLineDimensionSchema = z.object({ journalEntryLineId:
z.string().uuid(), dimensionType: z.enum(DIMENSION_TYPES), writer: z.enum(DIMENSION_WRITERS), dimensionIds: z.array(z.string().min(1)).min(1) }).refine((v) => new
Set(v.dimensionIds).size === v.dimensionIds.length, { message:
'dimensionIds must not contain duplicates', path: ['dimensionIds'] })`.
`dimensionIds` is validated as a non-empty string, not `.uuid()`:
`dimension_id` is stored as `text` and treated as an opaque reference
resolved by the caller (Phase 1's `CostCenter` ids are uuids, but a
later type need not be, and widening the column later would be a
migration). The `.refine()` makes a caller passing the same id twice in
one call fail validation instead of relying on the database's
`ON CONFLICT DO NOTHING` to silently absorb it. The command's `execute`
parses input through it before touching the
database.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| A single `dimensionType`/`dimensionId` pair directly on `JournalEntryLine` | Cannot represent more than one dimension per line (the whole reason this table exists) |
| Build this table as part of the Posting Rules Engine document (#6015, one combined document) | Rejected 2026-09-08 after checking #5663's real text and Fixed Assets' own Phase 2 plans — see Design Decisions, "Why this is a separate document" |
| Full-line replace (`setJournalEntryLineDimensions`, replacing every dimension type on a line in one call) | Rejected: silently drops another independent consumer's dimensions on the same line — see Design Decisions, "Writes are scoped per dimension type" |
| Expose reads as a `commandBus` command (`getJournalEntryLineDimensions`) | Rejected: real precedent (`sales` reading `catalog`'s `CatalogProduct` directly) already covers a hard-dependency direct entity read; wrapping it as a command solves a problem this codebase doesn't actually have — see Design Decisions, "Cross-module access" |
| A `dimensions: Record<string, string>` map and `costCenterId` column on `JournalEntryLine` (the GL sketch in `.ai/specs/SPEC-024-2026-02-11-financial-module.md`, pending on `develop`) | Rejected. A map answers the "several dimensions per line" objection that rules out the single `dimensionType`/`dimensionId` pair, but #5663 makes `JournalEntryLine` append-only and immutable once posted, and consumers tag lines *after* the entry is posted (Posting Rules tags the line of the reclassification entry it posts; `transferAsset` re-tags later). A column or map on an immutable line cannot be written afterwards, so tags need their own table with their own lifecycle. A separate table also keeps each dimension type's replace and undo scoped, which one map rewritten as a whole would not. #5663 points to this document for that divergence rationale. The tag-after-post flow is as specified in #6015 (it posts through `ledger.postJournalEntry` and, on success, tags the new line) and #6014 (`transferAsset` re-tags posted lines in Phase 2). |
| A `writer` column that lets several consumers write the *same* `(line, dimensionType)` side by side | Rejected: two cost centres on one line is ambiguous for every report that cuts by cost centre. `writer` is used instead as an ownership claim: one writer per `(line, dimensionType)`, other writers rejected (see Design Decisions, "Writers and line ownership") |
| Direct `entityManager` write from a consumer module against this module's entity | Never seriously considered: every real write in this document family goes through the owning module's own Command (undo, validation, transaction discipline live there) — no precedent anywhere for a foreign module writing another module's entity directly |

## Literature & Prior Art

This section grounds this document's multi-dimensional tagging design
against Fowler and Hay and adds a real-system comparison. Citations were
checked against the full extracted text of each book rather than against
chapter or figure titles, and the page numbers below are from that
extraction.

**Fowler's Booking Entries to Multiple Accounts (§6.15, pp.127-131) is
the strongest match found in either book — confirmed, and precisely
the shape of this document's own core problem.** Fowler's own framing
example is a consulting expense simultaneously "ACM's expense" *and*
"an airfare expense" — one value needing classification along more
than one simultaneous dimension, exactly this document's own Problem
Statement (a fixed-asset invoice line needing both a cost centre *and*
a fixed-asset tag at once). Fowler names three solutions: a DAG of
overlapping summary accounts (Figure 6.32) — which he flags with a
double-counting risk when two summary accounts' components overlap
(Figure 6.33), a risk this document doesn't share, since its dimension
types are independent and never overlap in membership the way two
summary accounts might; memo entries (§6.15.1) — an extra posting
into a second account purely for reporting, needing "an account for
every combination," precisely the chart-of-accounts explosion this
document's own Problem Statement rejects; and derived accounts
(§6.15.2, Figure 6.34, building on §6.9 "Choosing Entries," p.118) — an
account defined by a filter over entries by attribute, not a real
postable account at all. Fowler's own closing line states the exact
tradeoff this document made explicitly: "whenever we are trying to
represent an aspect of an entry, we have a choice between an attribute
of the entry or a new account level... If it is simply the reporting
side, we can use an attribute." `journal_entry_line_dimensions` is
precisely that attribute-based path, generalized to more than one
simultaneous attribute per line — the closest structural match to this
document's design found anywhere in either book.

**Hay's Cost Center Assignment (Figure 7.19 "Allocating Expenses,"
pp.150-151) is a closer match than the 7.21
citation below for the `CostCenter` dimension type this
document names literally.** Hay models a COST CENTER ASSIGNMENT that
can be "of" a broad, open-ended set of entities — an internal
organization, work centre, piece of equipment or product, a project,
or "(something else)" — explicitly because "the possibilities for
allocating expenses are so broad, COST CENTER could refer to virtually
anything in the organization." That open "(something else)" is what
this document's own `DIMENSION_TYPES` enum bounds explicitly (Phase 1:
`CostCenter` only; further types as writers appear) instead of
leaving unbounded — worth naming precisely, not just as a match: Hay's
assignment is anchored on the EXPENSE ACCOUNT ("each EXPENSE ACCOUNT
must be for a COST CENTER" — an account-level tag), while this
document's dimension row is anchored on the individual
`JournalEntryLine` — one level more granular than Hay's own model.
Figure 7.19 itself only models the one COST CENTER dimension, not
several co-occurring ones; for that broader claim, Fowler's §6.15
above remains the closer match.

**Hay's Account Categories and Structure (Figure 7.21, pp.153-154) —
two mechanisms, not only a roll-up.** Describing 7.21 only as "a
simple hierarchical account roll-up" is incomplete: the figure shows
two distinct mechanisms. The "pig's ear" roll-up (an ACCOUNT that is "part
of" another ACCOUNT) is the single-parent hierarchy that description
suggests, and Hay explicitly notes that generalizing it to a DAG
("replace the loop with a 'structure' entity") "would be extremely
difficult to administer" — independent confirmation, from a second Hay
figure, of the same single-parent-over-DAG caution cited
elsewhere (Fowler §6.15/Hay's Summarization section) for
`parentAccountId`. But the same figure also shows ACCOUNT CATEGORY /
ACCOUNT CLASSIFICATION — an explicit many-to-many join ("one ACCOUNT
may be in more than one ACCOUNT CATEGORY, and one ACCOUNT CATEGORY may
be a classification for more than one ACCOUNT") that description
misses entirely. ACCOUNT CLASSIFICATION is real precedent for "more
than one independent tag on the same thing at once" — the same shape
this document's own dimension table has — but, like Hay's COST CENTER
ASSIGNMENT above, it tags the ACCOUNT, not the individual line. This
document's own contribution, now confirmed across both Hay figures, is
doing the same multi-tag idea one level down, at the transaction line
rather than the account.

**Confirmed absence: Kieso has nothing on cost centres, responsibility
accounting, or any per-transaction analytical dimension.** A full-text
search for "cost center," "responsibility accounting," and
"dimension" (in the accounting sense) returns zero on-topic matches
anywhere in *Intermediate Accounting*. Kieso is a financial-reporting
text, not a managerial/cost-accounting one; this document's own design
question sits entirely outside its scope — a genuine gap in that
source, not a missed citation.

**Real-system comparison.**

- **ERPNext** (Accounting Dimensions, docs.frappe.io, verified
  2026-09-15): the strongest real-system validation found for this
  document's own design. ERPNext supports an open-ended number of
  custom accounting dimensions beyond its two built-in ones (Cost
  Center, Project), and — critically — supports attaching dimension
  values at the individual transaction-row level, not just the
  document level ("use row-level values when one document belongs to
  multiple departments or segments"), confirming this document's own
  line-level, not document-level, choice against a mature, real
  production ERP. A genuine divergence in mechanism, not outcome:
  ERPNext implements a new dimension as a dynamically generated schema
  field (a real column added to the transaction doctype per
  dimension), while this document stores every dimension type as rows
  in one table — precisely the tradeoff this document's own Data
  Models section already cites `text` over a Postgres enum for, so a
  new dimension type is a one-line constant change, not a migration;
  ERPNext's schema-per-dimension approach doesn't get that for free.
- **Comarch ERP Optima** ("Opis Analityczny," sklep-optima.pl product
  page, verified 2026-09-15): explicitly described as "rozbijanie
  pozycji dokumentów na wiele wymiarów" (breaking document line items
  down across multiple dimensions) at the individual line level — a
  second real system confirming line-level, not document- or
  account-level, multi-dimensional tagging is a real, marketed
  capability in this exact market, not a design this document invented
  in isolation.
- **enova365** (enova.pl, Księga Handlowa module page, verified
  2026-09-15): names "Opisy analityczne" (analytical descriptions) as
  a feature of its general ledger module, but the public marketing
  page doesn't document whether more than one independent dimension
  can be attached to a single line simultaneously, or only one
  analytical tag per entry — recorded as a similarly-named feature
  exists, not confirmed as matching this document's specific
  multi-dimension-per-line design.

Together, ERPNext and Comarch confirm this document's central design
bet — that multi-dimensional tagging belongs at the individual line,
not the account or the document — is exactly how two real,
independently-built systems in this market (one global open-source,
one Polish-market commercial) already solve the identical problem,
while ERPNext's schema-per-dimension approach highlights, by contrast,
exactly why this document chose a flexible dimension-type column
instead.

## Architecture

### Entities (`data/entities.ts`)

- `JournalEntryLineDimension` — `journalEntryLineId` (FK-id to
  `ledger.JournalEntryLine`, no ORM relation), `dimensionType`, `dimensionId`, `writer`, `tenantId`, `organizationId`, `createdAt`. No
  `updatedAt`/`deletedAt`: rows are never individually edited or soft-
  deleted — a `(line, dimensionType)` pair's rows are replaced
  atomically by `setJournalEntryLineDimension` (old rows for that pair
  hard-deleted, new rows inserted, in the same transaction), matching the exemption already used for real, shipped sub-resource
  rows: `customers/data/entities.ts`'s `CustomerDealPersonLink`/
  `CustomerTagAssignment`/`CustomerLabelAssignment` and
  `auth/data/entities.ts`'s `UserRole` all carry `createdAt` with no
  `updatedAt`/`deletedAt`. Exported from this module so hard-dependency consumers
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
  name: 'journal_entry_line_dimensions',
  title: 'Journal Entry Line Dimensions',
  version: '0.1.0',
  description:
    'Analytical dimension tags (Phase 1: cost centre) on a journal entry line.',
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
until a real UI need adds some. **Not dead boilerplate:** `packages/core/AGENTS.md`'s own convention (*"When adding
features to `acl.ts`, also add them to `setup.ts` —
`defaultRoleFeatures`..."*) treats `acl.ts` and `setup.ts` as a paired
contract, verified against real minimal modules (`api_keys`, `auth`,
`business_rules`, `entities`, `query_index` all ship a short `setup.ts`
alongside their `acl.ts`). An empty `acl.ts` with no matching
`setup.ts` would be the actual convention break; this file exists so
the pairing holds from Phase 1, ready for Phase 2's real features with
no structural change needed.

### Commands (Command Pattern, `commands/`)

- `setJournalEntryLineDimension` (command id
  `journal_entry_line_dimensions.dimensions.set`, the repo's
  `module.entity.action` shape; handler file
  `commands/setJournalEntryLineDimension.ts`) — replaces the dimension
  rows for one `(journalEntryLineId, dimensionType)` pair on behalf of
  one `writer`. Input: `{ journalEntryLineId, dimensionType, writer,
  dimensionIds: string[], tenantId?, organizationId? }`, validated
  through `data/validators.ts`'s `setJournalEntryLineDimensionSchema`,
  always scoped by `tenantId`/`organizationId`. The scope comes from the
  command context (`ctx.auth.tenantId`, the selected organization); the
  optional input `tenantId`/`organizationId` are read only when the
  context carries no `auth`, i.e. for a trusted in-process `systemActor`
  caller such as the Posting Rules engine (`ctx.auth: null`) — the same
  shape `warranty_claims`' system-actor subscriber uses for
  `create_vendor_recovery`. With `ctx.auth`, an input
  `tenantId`/`organizationId` that differs from the context's scope is
  rejected (`403`) and nothing is written, and a context that lacks its
  tenant or organization is rejected, never completed from the input. A
  system-actor caller also sets `ctx.selectedOrganizationId` to the target
  organization: under `OM_ENFORCE_ORG_SCOPE_STRICT` the shared
  `ensureOrganizationScope` rejects a system actor without one. Implementation: the handler sets
  `prepareSnapshotInsideTransaction`, so the command bus runs `prepare()`
  inside the write transaction, right after the pair's advisory lock
  (step 4), on the transaction's own EntityManager; it loads the existing
  rows for that pair (`{ before: existingRows }`). `execute`
  (1) parses the input; (2) loads the `ledger.JournalEntryLine` by id
  under the caller's tenant and organization
  (`findOneWithDecryption`, because `ledger:journal_entry_line` has an
  encrypted `contractor_snapshot` column) and rejects when it does not
  exist, so a
  mistyped or cross-tenant id never creates a row; (3) inside `withAtomicFlush(fn, {
  transaction: true })`, loads the line's entry and the `FiscalPeriod`
  covering the entry's `operationDate` with `PESSIMISTIC_READ` (`for
  share`) — the lookup and lock mode `postJournalEntry` uses
  (`requireCoveringUnlockedFiscalPeriod`, #6340), so a concurrent period
  lock, which takes the conflicting `for update` lock, serializes with
  this write — and rejects with a translated `422` (the status ledger
  uses for the same condition) when that period `isLocked` or no period
  covers the date; (4) in the same transaction
  takes the advisory lock on the pair (see Risks), loads the pair's
  existing rows and rejects when any of them has a `writer` other than
  the input's, then hard-deletes the existing rows
  and inserts the new `dimensionIds` set with the input's `writer` and
  `ON CONFLICT DO NOTHING`. The `{ transaction: true }` option is named
  explicitly because `withAtomicFlush` does not open a transaction unless
  told to (same call shape as the update command in
  `customers/commands/deals.ts`). `buildLog` records `{ undo: { before,
  after } }`; `undo` restores the `before` rows for that pair and re-runs
  checks (2), (3) and the ownership check, so undoing a tag change in a
  locked period, or over rows another writer has since claimed, is
  rejected. Content-idempotent (see Design Decisions). Every other
  dimension type already set on the same line is left untouched.

This is a plain custom command (like AP's
`postVendorInvoice`/`markPaymentBatchSent`), not built on
`makeCrudRoute` — there is no HTTP route or form behind it. There is
no separate read-side command; see Cross-module integration for how
consumers read.

### Events (`events.ts`)

**None in Phase 1.** See Design Decisions.

### Cross-module integration

- **`ledger` — a hard, declared dependency, not an optional peer.**
  `journalEntryLineId` is a plain FK-id (no ORM relation). The command
  reads `ledger`'s `JournalEntryLine`, `JournalEntry` and `FiscalPeriod`
  entities directly through its own `entityManager` (to check that the
  line exists in the caller's tenant and that its period is not locked —
  the same direct-read shape consumers use for this module's entity,
  precedent: `sales` reading `catalog`'s `CatalogProduct`). It never
  writes a `ledger` entity and never calls a `ledger` service or
  command.
- **Consumers (`posting_rules` now, `fixed_assets` later) — hard
  dependencies on this module.** A consumer declares `requires:
  ['journal_entry_line_dimensions']` (alongside whatever else it
  needs). For writes, it calls
  `container.resolve('commandBus').execute('journal_entry_line_dimensions.dimensions.set',
  input, ctx)` — the same generic mechanism `workflows`'
  `UPDATE_ENTITY` already uses for a hard-dependency call by string
  `commandId`. For reads, it imports `JournalEntryLineDimension` from
  `journal_entry_line_dimensions/data/entities` and queries it directly
  with its own `entityManager` (scoped by `tenantId`/`organizationId`),
  matching the real, verified precedent of `sales` reading `catalog`'s
  `CatalogProduct` the same way. No degradation to design for either
  call: if this module were disabled, neither consumer has a
  functional meaning without it, exactly like AP without `ledger`.
- **This module never imports or resolves anything belonging to its
  consumers.** One-way dependency direction (consumer →
  `journal_entry_line_dimensions`), matching `packages/core/AGENTS.md`'s
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
| `dimension_type` | text | Phase 1: `'CostCenter'` only (closed set enforced by `DIMENSION_TYPES` in validation; `text`, not a DB enum, so a later type needs no migration) |
| `dimension_id` | text | References an entity in another module by id; which module depends on `dimension_type` and is resolved by the caller, not by this table. `text`, not `uuid`, so it stays an opaque reference and a later type with a non-uuid identifier needs no migration; Phase 1's `CostCenter` ids are uuids |
| `writer` | text | Module id of the consumer that owns this `(line, dimension_type)` pair (`'posting_rules'` \| `'fixed_assets'`, closed set `DIMENSION_WRITERS` in validation); a write by a different writer to an already-tagged pair is rejected |
| `tenant_id` | uuid | |
| `organization_id` | uuid | |
| `created_at` | timestamp | |

Index: `(journal_entry_line_id, dimension_type)` — the only query
shape this module serves today: `setJournalEntryLineDimension` deletes
by this pair, and every consumer read filters by this same pair (plus
tenant/org). No second index on `(tenant_id, organization_id, dimension_type,
dimension_id)` is created: it would serve a hypothetical future
reporting query with no identified caller, inconsistent with this
document's own YAGNI reasoning for deferring ACL/UI/events. Add it in
Phase 2 if and when a real reporting screen needs it (tracked in Out of
Scope).
The tenant columns are not in this index: the line uuid already selects
only a handful of rows, and tenant/organization are applied as a filter
on them.

**Unique constraint on the insert.** A separate,
non-speculative `UNIQUE` constraint on `(journal_entry_line_id,
dimension_type, dimension_id, tenant_id, organization_id)` (distinct
in purpose from the dropped reporting index above — this one enforces
integrity, not a query shape) with `ON CONFLICT DO NOTHING` on the
command's insert step. This makes a duplicate `dimensionId` within one
call, or the same call retried, a no-op instead of a second identical
row for the same tag — see Risks & Impact Review for what it does and
does not protect against under real concurrency.

## API Contracts

**None.** This module exposes no HTTP routes — the write happens
through its one command, called in-process by other modules' own
backend code; reads happen through a direct entity query by those same
trusted, hard-dependency modules. See Design Decisions and
Architecture → Backend Pages.

## Migration & Deployment

One new, additive table (`journal_entry_line_dimensions`), zero changes
to any existing table. No backfill: the table starts empty and stays
empty until a consumer (Posting Rules Engine) starts calling
`setJournalEntryLineDimension`. No `onTenantCreated` hook needed —
nothing to seed (no default role features, no module config).

## Implementation Plan

**Hard prerequisite**: `requires: ['ledger']` (step 2 below)
means Phase 1 is not buildable until #5663 ships the `ledger` module —
`ModuleInfo.requires` is validated at generation time
(`packages/cli/src/lib/generators/module-registry.ts`), so `yarn
generate` rejects a module naming a `requires` entry that doesn't
exist yet. Expected for a design document describing a future module,
but worth stating explicitly rather than leaving the plan reading as
immediately actionable on its own.

### Phase 1: table + write command, zero consumers

1. `JournalEntryLineDimension` entity + migration (FK-id to
   `ledger.journal_entry_line`, the `(journal_entry_line_id,
   dimension_type)` index and the `UNIQUE (journal_entry_line_id,
   dimension_type, dimension_id, tenant_id, organization_id)` constraint
   above).
2. `index.ts` with `ModuleInfo.requires: ['ledger']`.
3. `acl.ts` with an empty features array (paired with step 6 per `packages/core/AGENTS.md`'s
   `acl.ts`/`setup.ts` convention).
4. `data/validators.ts` with `DIMENSION_TYPES` and
   `setJournalEntryLineDimensionSchema`.
5. `setJournalEntryLineDimension` command (type-scoped replace;
   rejects a line that does not exist in the caller's tenant and a line
   whose entry falls in a locked fiscal period, and a write by a writer other than the pair's owner (translated rejection messages in `i18n/`); transaction-wrapped via
   `withAtomicFlush(fn, { transaction: true })`; undo-capable via
   `prepare`/`buildLog`/`undo` per Design Decisions).
6. `setup.ts` with an empty `defaultRoleFeatures.admin: []` (see
   Module Setup for why this pairs with step 3 rather than being dead
   weight).
7. Unit tests for the command and for consumer-style direct reads (see
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
packages/core/src/modules/journal_entry_line_dimensions/
├── index.ts
├── acl.ts                          (empty features array)
├── setup.ts
├── i18n/
│   ├── en.json                     (rejection messages: line not found, locked or missing period, written by another writer)
│   ├── pl.json
│   ├── de.json
│   ├── es.json
│   └── ko.json
├── data/
│   ├── entities.ts                 (JournalEntryLineDimension)
│   └── validators.ts               (DIMENSION_TYPES, setJournalEntryLineDimensionSchema)
├── migrations/
│   ├── ...                         (create table + index + unique constraint)
│   └── .snapshot-open-mercato.json
└── commands/
    └── setJournalEntryLineDimension.ts
```

## Testing Strategy

- `setJournalEntryLineDimension` replaces only the rows for the given
  `(journalEntryLineId, dimensionType)` pair — a different type
  already set on the same line is left untouched (regression test: a full-line replace would delete the other type).
- Calling it twice with the same `dimensionIds` leaves the same
  *content* in place (content-idempotent); row `id`/`createdAt` are
  not asserted to be stable across the two calls (not
  row-identity-idempotent, see Design Decisions).
- `undo` restores exactly the pre-replace rows for that
  `(journalEntryLineId, dimensionType)` pair (unit test against the
  real `prepare`/`buildLog`/`undo` contract).
- `setJournalEntryLineDimensionSchema` rejects a non-UUID
  `journalEntryLineId`, an unknown `dimensionType` (e.g. `'costcenter'`,
  `'Currency'`, an empty string — the closed `DIMENSION_TYPES` boundary,
  not merely a non-empty check), an empty `dimensionIds` array, and a
  `dimensionIds` array containing a duplicate.
- Scope: with `ctx.auth` the context scope is used, and an input
  `tenantId`/`organizationId` that differs from it is rejected with `403`
  and writes nothing; with `ctx.auth: null` (system actor) the input
  scope is used; with neither the call is rejected and writes nothing.
  Under `OM_ENFORCE_ORG_SCOPE_STRICT`, a system actor without
  `ctx.selectedOrganizationId` is rejected.
- The command rejects a `journalEntryLineId` that does not exist, and one
  that belongs to another tenant/organization — no row is written in
  either case.
- The command rejects a write (and an `undo`) for a line whose entry's
  `operationDate` falls in a locked `FiscalPeriod`, and accepts it in an
  unlocked one.
- Rollback: when the insert phase throws, the delete phase is rolled
  back with it and the pair's previous rows are still present
  (`{ transaction: true }`).
- The unique constraint plus `ON CONFLICT DO NOTHING`: calling the
  command twice with the same ids leaves one row per id, not two.
- A write whose `writer` differs from the writer of the existing rows for
  that `(line, dimensionType)` is rejected and leaves the rows untouched;
  the same writer replaces its own rows; a `writer` outside
  `DIMENSION_WRITERS` fails validation.
- Two concurrent calls for the same pair serialize on the advisory lock:
  the result is one writer's complete set, never a union.
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

#### Orphan lifecycle
- **Question**: nothing in this design removes a dimension row when
  its `journalEntryLineId` is deleted, an entry is reversed, or a
  fiscal period closes — is that a real gap?
- **Answer**: no, for rows written through the command. The command
  loads the line under the caller's tenant and organization before it
  writes, so a row never starts out pointing at a missing or foreign
  line. After that, GL core engine (#5663) makes `JournalEntryLine`
  append-only and immutable once posted — *"a posted entry is
  immutable"*, *"`JournalEntry` is always immutable"* (Design
  Decisions) — a line is never edited or hard-deleted, and a correction
  posts a new `REVERSAL` entry with its own new lines. A row's
  `journalEntryLineId` therefore never becomes a dangling FK. A
  reversal's own new lines carry no dimension tags unless a consumer
  tags them too, which is the consumer's responsibility, not a
  lifecycle bug here. A row written by direct SQL or a future code path
  that bypasses the command is outside this guarantee.
- **Severity**: Low
- **Affected area**: `journal_entry_line_dimensions` only
- **Mitigation**: line-existence check in the command; ledger's
  immutability for the rest
- **Residual risk**: none for command-written rows

#### Tags changing on lines in a locked fiscal period
- **Scenario**: after year-end close, a consumer retags a December line
  from cost centre A to cost centre B, and the closed year's P&L by cost
  centre silently changes. Posted lines and the locked period protect
  amounts, but a tag lives in a separate table that ledger's lock never
  sees.
- **Severity**: High for a module whose purpose is cost-centre
  analytics
- **Affected area**: cost-centre reporting for closed periods
- **Mitigation**: the command (and its `undo`) rejects any write for a
  line whose entry falls in a locked `FiscalPeriod` — or in no period at
  all. The covering period is found by the same lookup as
  `postJournalEntry` (#5663/#6340, keyed on the entry's `operationDate`)
  and read `for share` inside the write's transaction, so a concurrent
  `lockFiscalPeriod` (which takes the conflicting `for update` lock)
  serializes with the write. Tags are therefore part of what a period
  close freezes. A consumer that needs to change a closed period's
  cost-centre allocation posts a correcting entry with its own tags
  instead of editing a tag.
- **Decision and legal basis**: tags of a closed period are frozen. The
  tags are the analytical description of a posted entry; if a close
  froze the amounts but not the cost-centre cut, the closed period's
  cost-centre report could change while the ledger stays locked. Ustawa
  o rachunkowości art. 25: after a month is closed, or when the books
  are kept on a computer, an error in an entry may be corrected only by
  a correcting document entered into the books (art. 25 ust. 1 pkt 2,
  ust. 2: entries that are all positive or all negative), not by
  overwriting the earlier entry. Treating the cost-centre tag as part of
  the booked entry, a change after the period lock is a correcting entry
  with its own tags. Source: tekst jednolity Dz.U. 2026 poz. 522,
  art. 25 ust. 1 pkt 2 and ust. 2 (eli.gov.pl, p. 37); closing the books
  as the irreversible exclusion of entries is art. 12 ust. 5. That the
  tag counts as part of the entry, rather than as reporting metadata
  outside the books, is the author's reading.
- **Residual risk**: none for correctness. The guard sits in this
  module's command, so a consumer that bypassed the command and wrote
  `JournalEntryLineDimension` rows directly would bypass it too; every
  real write in this document family goes through the owning module's
  command.

#### Several consumers writing `CostCenter` to lines
- **Scenario**: Posting Rules Engine (#6015) and Fixed Assets Phase 2
  `transferAsset` (#6014) write the same dimension type, `CostCenter`.
  A consumer that re-tags a line another consumer already tagged would
  replace that tag with no conflict policy and no error.
- **Severity**: Medium — silent loss of another module's tag
- **Affected area**: `journal_entry_line_dimensions` and every report
  that reads `CostCenter` tags
- **Mitigation**: the ownership claim enforced by the command (Design
  Decisions, "Writers and line ownership"): rows carry `writer`, and a
  write by a different writer to an already-tagged `(line,
  dimensionType)` is rejected with a translated error, never a silent
  replace.
- **Residual risk**: `writer` is declared by the caller, so the guard
  stops accidental overwrite between trusted in-process modules but does
  not authenticate the caller; the command has no HTTP surface. A new
  consumer adds its module id to `DIMENSION_WRITERS`.

#### Concurrent `setJournalEntryLineDimension` calls for the same `(line, type)` pair
- **Scenario**: two calls replace the same pair's rows at nearly the
  same time (same writer), or two different writers claim the same
  untagged pair at once.
- **Severity**: Low
- **Affected area**: `journal_entry_line_dimensions` only — no
  financial data, no ledger balance is affected
- **Mitigation**: inside its transaction the command first takes a
  transaction-scoped advisory lock keyed on `(journalEntryLineId,
  dimensionType)` (`pg_advisory_xact_lock`, issued through
  `em.execute(...)` so it runs on the transaction's own connection, not
  on the pool), then checks ownership and does the delete-then-insert.
  Concurrent calls for the same pair serialize: the second sees the
  first's committed rows, so a second writer is rejected and a second
  call by the same writer replaces the first call's set cleanly (last
  committed call wins). Without the lock, two deletes could both run
  before either insert and leave the union of both sets; the unique
  constraint + `ON CONFLICT DO NOTHING` alone only prevents an
  *identical* row from being inserted twice.
- **Residual risk**: none for correctness; the lock is held only for
  the one short delete-then-insert. The undo snapshot (`prepare`) is
  read under the same lock, inside the same transaction, so undo
  restores exactly the rows this call replaced, never a set a concurrent
  call wrote in between.

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
`JournalEntryLine`), matching the pattern already used for real,
shipped sub-resource rows (`CustomerDealPersonLink`,
`CustomerTagAssignment`, `CustomerLabelAssignment`, `UserRole`). Every consumer read is required to filter by
both, exactly as `sales`'s own direct `catalog` reads do.

### Migration & deployment

One new, additive table. No backfill, no default config, no
`onTenantCreated` hook — see Migration & Deployment above.

## Out of scope (tracked separately)

- ACL features and a reporting/admin backend page, plus the reporting
  index left out of Phase 1 — deferred until a real need
  appears (Phase 2).
- Events for dimension changes — no identified subscriber yet (Phase
  2, revisit when one emerges).
- A maximum-`dimensionIds`-per-type constraint — no identified need
  yet (Phase 2, if one surfaces).
- Handing a pair's tags from one writer to another (releasing an
  ownership claim): not supported; a change after the fact is a
  correcting entry with its own tags.
- Dimension types `BankAccount`, `FixedAsset` and `Currency` — added to
  `DIMENSION_TYPES` when a consumer that writes them exists (`Currency`
  only if GL's one-currency-per-entry model changes).
- The posting-rule logic that decides *which* dimension to attach
  (e.g. "check `DefaultAccountPostingRule` if no explicit dimension
  exists") — that decision logic belongs to each consumer
  (Posting Rules Engine, #6015), not to this table.
- Reporting/aggregation by dimension (e.g. a P&L cut by cost centre)
  — a future reporting-layer concern, not this module's.

## Final Compliance Report — 2026-09-08 (self-review snapshot)

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `.ai/skills/om-spec-writing/SKILL.md` (Quick Rule Reference, cited in
  the Compliance Matrix below )

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `journalEntryLineId`, `dimensionId` are both plain FK-id, no relation decorators |
| root AGENTS.md | Filter by organization_id | Compliant | Own `tenant_id`/`organization_id` columns, not just inherited through the FK |
| `packages/core/AGENTS.md` → Cross-Module Coupling | Hard dependency uses direct resolution, not `tryResolve` | Compliant | Write via direct `commandBus.execute` (real `workflows`/`UPDATE_ENTITY` precedent); reads via a direct entity query (real `sales`/`catalog` precedent) — see Design Decisions, "Cross-module access" |
| `packages/core/AGENTS.md` → Cross-Module Coupling (hard dependency mechanism) | Hard dependency declared through `ModuleInfo.requires` | Compliant | `index.ts` with `metadata.requires: ['ledger']` |
| `packages/core/AGENTS.md` → Database Entities | User-editable entities MUST include `updated_at`/`deleted_at` | N/A, exempt | Rows are never individually edited or soft-deleted — a `(line, type)` pair's rows are replaced atomically, matching the exemption real, shipped sub-resource rows already use (`CustomerDealPersonLink`/`CustomerTagAssignment`/`CustomerLabelAssignment`, `UserRole`) |
| `packages/core/AGENTS.md` → Command Side Effects | Write operations via the Command pattern | Compliant | `setJournalEntryLineDimension` is a command, not a direct mutation from a route handler or a foreign module (there is no route, and no foreign module writes this entity directly) |
| `packages/core/AGENTS.md` → Entity Update Safety | Multi-phase mutations use `withAtomicFlush` | Compliant | Delete-then-insert (for one type) wrapped in one transaction via `withAtomicFlush(fn, { transaction: true })` — the option named explicitly, not merely asserted as an outcome |
| Quick Rule Reference (`om-spec-writing` SKILL.md) | Undoability is the default for state changes | Compliant | `prepare`/`buildLog`/`undo` contract using the real hook names, verified against `packages/shared/src/lib/commands/types.ts` and `customers/commands/people.ts` |
| Quick Rule Reference (`om-spec-writing` SKILL.md) | Zod validation for all inputs, in `data/validators.ts` | Compliant | `setJournalEntryLineDimensionSchema` |
| `packages/core/AGENTS.md` → Encryption | GDPR/PII fields declared in `<module>/encryption.ts` | N/A | No PII/GDPR-sensitive field — see Encryption |
| `packages/core/AGENTS.md` → Access Control (RBAC) | Features declared per module | N/A | No UI/API surface in Phase 1 — nothing to gate, see Access Control |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | One new table only |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match architecture | Pass | One entity, matches the Architecture section |
| Commands defined for the module's mutating operation | Pass | The one write operation has a named command; reads are a direct query, not a command (see Design Decisions) |
| Undo contract present for the state-changing command | Pass | Uses the real `prepare`/`buildLog`/`undo` hooks |
| Risks cover all write operations | Pass | Multi-consumer collision (now architecturally prevented) and `ledger`-unavailable cascade both addressed |
| Scope cohesion vs. other modules | Pass | Single, narrow capability (multi-dimensional tagging), independently deployable given its one hard dependency (`ledger`); has zero consumers on its own by design, but that's a Phase-1 characteristic, not a scope-bundling problem (see Design Decisions on why it's split from Posting Rules Engine) |
| Scope cohesion *within* this document | Pass | One entity, one write command, one integration seam (`ledger`) |
| Cross-module coupling mechanism matches dependency type | Pass | Hard dependency (`ledger`) via FK-id only; write via `commandBus` (real precedent); read via direct entity query (real precedent) — no invented mechanism |

### Non-Compliant Items

None outstanding against this pass's own checklist (2026-09-08). Findings
from the external review are tracked in the PR #5972 thread, not here.

### Verdict

This file is the design of the `journal_entry_line_dimensions` module.
Review status and the resolution of each finding live in the PR #5972
thread; the Changelog below records what changed in the design and why.

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

### 2026-09-09 — fixes from external maintainer PR review (#5972)

Applied the technical fixes agreed during that review round, each
checked directly against the current file state before editing (not
taken at the reviewer's word):

- **Dimension-pair examples corrected.** The TLDR, Problem Statement
  example, dedicated-table rationale, and the "one line can have
  several rows" sentence all previously paired *counterparty* with
  *cost centre* as the motivating example — directly contradicting
  this same document's own "Excludes the counterparty" Design
  Decision two sections later. All four now use **CostCenter +
  FixedAsset**, dimension types this table actually owns.
- **Unique constraint + `ON CONFLICT DO NOTHING` added** on
  `(journal_entry_line_id, dimension_type, dimension_id, tenant_id,
  organization_id)` (Data Models), distinct in purpose from the
  reporting index already dropped from Phase 1. A `.refine()` was
  added to `setJournalEntryLineDimensionSchema` (Design Decisions) so
  a caller passing a duplicate `dimensionId` in one call fails
  validation rather than relying on the database to absorb it. The
  "Concurrent `setJournalEntryLineDimension` calls" risk entry's
  earlier "last call to commit wins" claim was checked against the
  actual delete-then-insert shape and corrected: real interleaving can
  produce a **union** of both calls' rows, which the new constraint
  does not prevent (it only blocks an identical row from being
  inserted twice).
- **`dimensionType` validated against a closed enum, not
  `z.string().min(1)`.** Added a module-owned `DIMENSION_TYPES`
  constant (`data/validators.ts`) and switched the schema to
  `z.enum(DIMENSION_TYPES)`; the database column itself stays `text`
  so a new type is still a one-line constant change, not a migration.
- **Untracked-draft caveat extended to `posting-rules-engine.md`.**
  This document already flagged `fixed-assets.md`, wherever cited, as
  an untracked sibling draft rather than an externally-authored
  source. Checked `posting-rules-engine.md` the same way this round
  (`git log`/`git ls-tree` against `upstream/develop` and this fork:
  no commit history on either) and found it is equally untracked but
  had never carried the same caveat — asymmetric treatment of two
  equally-unverified sources. Extended the caveat to every place this
  document cites `posting-rules-engine.md` (header Related section,
  Design Decisions "Why this is a separate document").
- Re-checked this document's one existing changelog claim that a
  "corresponding correction" was made in `posting-rules-engine.md`
  (2026-09-08 entry, re: the #5663 split-rationale citation) directly
  against that file's current text — confirmed accurate (see its
  "Korekta (2026-09-08)" note); left as-is.

### 2026-09-15 — literature grounding and real-system comparison

- Merged `upstream/develop` (166 commits) first; one conflict this
  time (unlike the clean auto-merges for AP/GL Account Balances/Fixed
  Assets): both branches added a new row to `.ai/specs/README.md`'s
  Pending Specifications table at the same position. Resolved by
  keeping both rows, in date order; commit `65c6a15e4`.
- Added this document's first "Literature & Prior Art" section.
  Verified two citations against the books' full text: Fowler §6.15 "Booking Entries to Multiple Accounts" (confirmed
  accurate — the strongest match in either book for this document's
  own "more than one simultaneous dimension" problem); Hay §7.21
  "Account Categories and Structure" (corrected for completeness —
  the figure shows more than the single-parent roll-up: it also shows an
  ACCOUNT CATEGORY/ACCOUNT CLASSIFICATION many-to-many join, real
  precedent for "more than one independent tag on one thing," just at
  the account level rather than this document's line level). Added one
  further citation: Hay's Cost Center
  Assignment (Figure 7.19, pp.150-151) — a more precise match than 7.21
  for the `CostCenter` dimension type this document names literally,
  and confirmation that Hay's own open "(something else)" placeholder
  for cost-center-assignable entities is what this document's
  `DIMENSION_TYPES` enum enumerates concretely. Also recorded a genuine
  absence: Kieso has nothing on cost centres, responsibility
  accounting, or per-transaction analytical dimensions anywhere.
- Added a real-system comparison (this document had none before):
  ERPNext (Accounting Dimensions — the strongest validation found,
  confirming line-level multi-dimensional tagging against a mature
  open-source ERP, though via a different mechanism, dynamically
  generated schema fields rather than this document's flexible
  dimension-type rows), Comarch ERP Optima ("Opis Analityczny" —
  explicitly breaks document lines into multiple dimensions, a second
  real confirmation of line-level tagging in this exact market), and
  enova365 (a similarly-named "Opisy analityczne" feature exists, but
  public documentation doesn't confirm multi-dimension-per-line
  support specifically — recorded as unverified, not a match).
- No structural changes to Architecture/Data Models/Commands from this
  pass; a cross-spec consistency check against the sibling documents
  found no conflicts at the time.

### 2026-09-25 — M3 resolved: unmerged siblings linked by PR, "untracked draft" caveat lifted

The second review round (2026-09-08 re-review) found the header's
three `Related:` links all 404 on `develop` (they point at same-repo
filenames for #5663/#6015/#6014, none of which are merged), and that
the two-independent-consumers justification for staying split from
Posting Rules Engine leaned on Fixed Assets while both were untracked,
no-commit-history drafts. Fix: the header now links each sibling by
PR number instead of filename, with an explicit "Depends on unmerged
PRs" paragraph (matching the fix already applied to
sales-invoice-gl-posting.md's identical M2). Separately, #6015 and
#6014 are no longer untracked drafts — both have since gone through
their own maintainer review rounds (2026-09-14) with every finding
fixed and verified — so the caveat qualifying their two-consumers
claim (Design Decisions, Verdict) is updated to say so rather than
still describing them as unverified same-session drafts. Once
#5663/#6015/#6014 land on `develop`, these three links should be
swapped back to relative filenames.

### 2026-09-25 (cont.) — m1, m2, m3, m4, m5, m6, m7, m8 resolved

Closed every remaining open item from PR #5972's second review round
(2026-09-08 re-review), all verified directly against the real
repository before editing:

- **m1** — `withAtomicFlush` now names its `{ transaction: true }`
  option explicitly (Architecture, Implementation Plan, Compliance
  Matrix) instead of asserting atomicity as a bare outcome; the option
  is not the default, matching `customers/commands/deals.ts`'s
  own call shape.
- **m2** — the `updated_at`/`deleted_at` exemption now cites real,
  shipped precedent (`CustomerDealPersonLink`, `CustomerTagAssignment`,
  `CustomerLabelAssignment`, `UserRole`) instead of two entities
  (`VendorInvoiceLine`, `PaymentBatchLine`) that don't exist in this
  codebase.
- **m3** — `dimension_id` widened from `uuid` to `text` (Data Models,
  the write schema's `dimensionIds` validator dropped `.uuid()`),
  since `'Currency'`, the one advertised dimension type with a real
  shipped target entity, is identified by ISO code here, not a uuid.
  Confirmed with the maintainer: widen the type rather than drop
  `'Currency'` from the list.
- **m4** — added an explicit "Orphan lifecycle" Risk entry: GL core
  engine (#5663) makes `JournalEntryLine` append-only and immutable
  once posted, so a `journal_entry_line_dimensions` row's
  `journalEntryLineId` can never become a dangling FK — not a gap,
  but previously unstated.
- **m5** — added `acl.ts` (empty features array) as its own
  Implementation Plan step; it was already in the File Manifest and
  Architecture but missing from the plan.
- **m6** — justified `setup.ts` as the required pairing for `acl.ts`
  per `packages/core/AGENTS.md`'s own convention, verified against
  five real minimal modules that ship the same pairing, rather than
  leaving it looking like a file that does nothing.
- **m7** — added an explicit note that `requires: ['ledger']` blocks
  `yarn generate` until #5663 ships, since `ModuleInfo.requires` is
  validated at generation time.
- **m8** — date-stamped the 2026-09-08 Final Compliance Report as a
  self-review snapshot and added a current-status paragraph to the
  Verdict recording that the external review's findings are now fixed,
  rather than leaving "None outstanding"/"Ready for maintainer review"
  reading as an up-to-date claim after a maintainer review had already
  found real defects.

**m9** (branch 1451 commits behind `develop`) was resolved by merging
`develop` into the branch.

### 2026-10-13 — third review round (PR #5972)

Applied the findings of the 2026-10-07 specification review at head
`544ef441a`, each checked against the sibling documents at their current
heads (#5663, #6015, #6014) before editing:

- **B1** — the premise "no two consumers share a dimension type" was
  false: #6015 and #6014's `transferAsset` both write `CostCenter`; no
  cited consumer writes `FixedAsset`. Added the writer map and made
  ownership a module guarantee: rows carry `writer` (closed set
  `DIMENSION_WRITERS`), the first writer owns a `(line, dimensionType)`
  pair and the command rejects any other writer instead of silently
  replacing its tag. The command also serializes per pair with an
  advisory lock, which removes the union-of-two-calls outcome the earlier
  concurrency entry accepted. #6015 passes `writer: 'posting_rules'`;
  #6014's `transferAsset` passes `writer: 'fixed_assets'`. Rewrote the
  motivating example, the same-type risk entry and the Out of Scope item
  accordingly.
- **M1** — added SPEC-024's `dimensions` map / `costCenterId` column to
  Related and Alternatives Considered, with the rejection reason (posted
  lines are immutable, tags are written after posting, as #6015 does).
- **M2** — the command and its `undo` reject writes for a line in a
  locked (or no) fiscal period; new risk entry; ledger entities are read
  directly under the hard dependency. Decision: tags of a closed period
  are frozen, on the basis of Ustawa o rachunkowości art. 25 (post-close
  corrections only by a correcting entry), checked against the
  official tekst jednolity (Dz.U. 2026 poz. 522); that a cost-centre tag
  is part of the booked entry is the author's reading.
- **m1** — the command loads the line under the caller's tenant and
  organization and rejects a miss; Orphan lifecycle entry corrected.
- **m2** — Testing Strategy, Implementation Plan and File Manifest cover
  the closed enum, duplicate rejection, unique constraint, rollback, line
  existence, locked-period guard, writer ownership and the advisory lock;
  the module gains `i18n/` rejection messages.
- **m3** — removed stale text (`dimensionId` as a UUID, "m9 remains
  open", the self-certifying "fully compliant" status); the Verdict no
  longer narrates review status.
- **m4** — `DIMENSION_TYPES = ['CostCenter']`; `BankAccount`,
  `FixedAsset` and `Currency` wait for a writer, and `Currency`
  duplicates the entry header (`JournalEntry.currencyId`). `dimension_id`
  stays `text`.
- **m5** — #5955 and #5962 added to the dependency paragraph and linked
  by PR number, with the merge-order sentence.
- **m6** — removed references to process documents that are not in this
  repository from the Literature section.
- **Implementation finding (#6711, applied to #6708)** — the Posting Rules
  engine runs as a system actor with `ctx.auth: null`, so a scope taken
  from the context alone rejected every real call. The command accepts an
  optional input `tenantId`/`organizationId`, consulted only when the
  context has no `auth`; documented in Commands and covered by Testing
  Strategy.
- Nits: tenant columns in the index explained; `extractUndoPayload`
  footgun stated; `deals.ts` cite no longer points at a line number;
  blank line before the 2026-09-25 (cont.) heading; module and table
  renamed to the plural (`journal_entry_line_dimensions`, per root
  `AGENTS.md`) and the command given the `module.entity.action` id
  `journal_entry_line_dimensions.dimensions.set`, with the same rename in
  #6015, #6014 and #5663; review-history markers and "earlier draft"
  narrative removed from the design sections, the history living in this
  Changelog only.

### 2026-10-20 — aligned with the #6708 implementation

- File Manifest: migrations live in `migrations/` (repo convention) with
  the module's `.snapshot-open-mercato.json`; i18n ships en, pl, de, es
  and ko. The `index.ts` snippet's title is plural, like the module.
- Commands: a locked or missing fiscal period is a `422`, the status
  ledger uses for the same condition.
- Commands and Risks: `prepare()` runs inside the write transaction
  under the pair's advisory lock (`prepareSnapshotInsideTransaction`), so
  undo cannot restore a set a concurrent call wrote in between.
- Commands and Testing Strategy: with `ctx.auth`, an input scope that
  differs from the context's is rejected (`403`) instead of being
  ignored; a system-actor caller sets `ctx.selectedOrganizationId`, which
  `OM_ENFORCE_ORG_SCOPE_STRICT` requires.

### 2026-10-23 — currency is a column of the line

- **Currency stays out of `DIMENSION_TYPES`, for a new reason.** The text said a
  line-level currency tag would duplicate the entry header
  (`JournalEntry.currencyId`). #5663 now puts `currencyId`, `exchangeRate` and
  `amountCurrency` on every `JournalEntryLine`, and one entry may mix
  currencies, so the line's currency is a first-class column and a `Currency`
  dimension would duplicate it. The 2026-09-25 m4 entry above that gives the
  header as the reason is kept as history and superseded by this one.
- No change to the data model, the commands or the `CostCenter` writers.
