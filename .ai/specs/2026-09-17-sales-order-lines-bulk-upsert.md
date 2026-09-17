# Sales Order Lines — Bulk Upsert Command

## TLDR

`sales.orders.lines.upsert` writes one line per call and reloads the whole order
aggregate each time, so writing N lines costs O(N²) row reads. This spec adds
`sales.orders.lines.upsert_many`: the same per-line bodies as a list, one
aggregate load, one totals calculation, one flush, one audit entry — O(N) — with
the guards, errors and undo semantics of the per-line command preserved so a
caller can replace N single calls with one.

## Overview

A new command handler in `packages/core/src/modules/sales/commands/documents.ts`,
its input schema in `packages/core/src/modules/sales/data/validators.ts`, and the
per-line snapshot logic extracted into a helper both commands share. No route, no
schema change, no change to the per-line command's observable behavior.

## Problem Statement

`orderLineUpsertCommand` is per line. Every call:

1. loads the order with decryption,
2. loads **all** of its lines and **all** of its adjustments,
3. resolves UoM and converts unit prices for the one line being written,
4. rebuilds the whole snapshot list, sorts it and renumbers it `1..n`,
5. recalculates document totals over the whole set,
6. flushes atomically,

and `prepare` / `captureAfter` each run `loadOrderSnapshot` on top of that (the
cost issue #2979 tracks). A caller writing N lines issues N commands, so the rows
read grow with N². An adopter mirroring an ERP into sales orders measured one
order of ~1,100 lines taking ~10 minutes and ~28,000 `SELECT`s to re-sync.

The create path does not have this problem: `sales.orders.create` takes `lines[]`
and writes them in one pass. Only the incremental path — the one every
order-syncing integration uses after the first import — lacks a batch form.

[`SPEC-021`](SPEC-021-2026-02-07-compound-commands-graph-save.md) named this as
"Problem 4: No API for Bulk Line Submission" and proposed solving it as part of a
whole-aggregate graph save (`sales.orders.save`, header + lines + adjustments +
addresses + tags). That spec is unimplemented. This spec takes the line-set slice
of it, which is what an integration actually needs, and leaves the graph-save
design open and unprejudiced.

## Proposed Solution

One new undoable command:

```
sales.orders.lines.upsert_many
```

It accepts an order id and a list of line upserts, loads the aggregate once,
resolves every line in memory against one shared UoM resolver, applies the
deletes, renumbers `1..n`, calculates totals once, and flushes once.

All-or-nothing: any refused line or delete aborts the whole batch. There is no
partial-success reporting.

### Why not extend the per-line command

The per-line command's cost is structural: the aggregate load, the recalculation
and the flush are per invocation. Batching has to happen inside one invocation.
Making the existing command accept a list would change its result shape
(`lineId` → `lineIds`), which is a contract break for every current caller.

## Architecture

### Shared per-line helper

`buildUpsertedOrderLineSnapshot(dependencies, parsed, existingSnapshot, fallbackLineNumber)`
resolves one upsert entry into the `SalesPersistedLineSnapshot` it should become:

- price-mode net/gross fallback through `taxCalculationService`,
- metadata merge (`priceId`, `priceMode`),
- `normalizeLineUom`, then `convertLineUnitPricesOnUnitChange` and a
  re-normalization when a unit change converted the prices,
- the discount-origin and totals-origin resolution
  (`resolveUpsertDiscountFields`, `resolveUpsertTotalsOrigin`),
- the merged snapshot, including `statusEntryId`, `catalogSnapshot` and
  `promotionSnapshot`.

Both commands call it, so the per-line semantics cannot drift between them. It
builds a value and touches nothing; guards, numbering, totals and persistence stay
with the callers. `orderLineUpsertCommand` was rewritten to call it and is
otherwise unchanged — its existing tests pass untouched.

Two collaborators are now injected rather than created inline so a batch can share
them:

- `uomResolver` — a pure cache of the unit dictionary and per-product UoM state.
  One per batch instead of one per line removes the repeated dictionary and
  product-conversion lookups.
- `resolveTaxCalculationService` — a memoized lazy resolver. Resolving eagerly
  would instantiate the service for writes that already carry both prices, which
  the per-line command never does; the lazy form keeps that property.

### Guards

`assertShippedOrderLineEditable` was split so the guard itself works from an
already-loaded shipped-quantity map
(`assertShippedOrderLineEditableAgainst`). The per-line command still loads the
map itself, unchanged; the batch loads it once for the whole order, and only when
at least one entry targets a line that exists.

Guards applied per batch, in order:

| Guard | Scope | Error |
|---|---|---|
| `ensureOrderScope` | batch | tenant/organization scope violation |
| `enforceSalesDocumentOptimisticLock` | batch | 409 optimistic-lock conflict |
| unknown `deleteIds` entry | per delete | 404 `sales.documents.detail.error` |
| `SalesShipmentItem` exists for a deleted line | per delete, one query | 409 `sales.documents.items.errorDeleteShipped` |
| `assertOrderAcceptsNewLine` | per added line | 409 `sales.documents.items.errorAddToFulfilled` |
| `assertShippedOrderLineEditableAgainst` | per edited line | 409 `errorQuantityBelowShipped` / `errorPriceShipped` |
| resulting line set is empty | batch | 409 `sales.documents.items.errorDeleteLast` |

The empty-set check is evaluated on the **final** line set, not on the deletes
alone: deleting an order's only line and supplying a replacement in the same
batch is allowed, while a delete-only batch that would empty the order is refused
with the error the per-line delete command raises today.

### Line numbering

`lineNumber` on an entry is a **1-based destination**, not a sort key: the line is
pulled out of its current slot and spliced back in at that index, then the whole
set is renumbered `1..n`. An entry without `lineNumber` keeps an existing line in
its slot and appends a new one.

The per-line command cannot express an adjacent transposition, because it sorts a
list whose `lineNumber`s tie after the edit. That is tracked separately
(GSM-503); this spec does not change it.

### Cost

| | per-line × N | `upsert_many` |
|---|---|---|
| order loads | N | 1 |
| line + adjustment loads | N | 1 |
| `loadOrderSnapshot` (prepare + captureAfter) | 2N | 2 |
| totals calculations | N | 1 |
| flushes / transactions | N | 1 |
| audit entries | N | 1 |
| shipped-quantity loads | ≤ N | ≤ 1 |
| UoM dictionary / product-state lookups | per line | per batch (cached) |

Rows read go from O(N²) to O(N). Line `INSERT`/`UPDATE` statements stay O(N) —
that is the work itself. Custom-field writes remain one call per line that carries
`customFields`, unchanged from the per-line path.

## Data Models

Unchanged. No entity, column, index or migration is touched.

## API Contracts

### Command input

```ts
{
  organizationId: string,   // uuid
  tenantId: string,         // uuid
  orderId: string,          // uuid
  lines: Array<OrderLineUpsertEntry>,   // default []
  deleteIds: string[],                  // uuid[], default []
}
```

`OrderLineUpsertEntry` is `orderLineCreateSchema` minus `organizationId`,
`tenantId` and `orderId` (the envelope carries them), plus an optional `id`:
present updates that line in place, absent appends a new one. An `id` that is not
on the order creates a line with that id, matching the per-line command.

Schema-level refusals (zod, before any query):

- neither `lines` nor `deleteIds` carries an entry,
- the same line `id` appears twice in `lines`,
- an id appears in both `lines` and `deleteIds`.

### Command result

```ts
{ orderId: string, lineIds: string[] }   // lineIds in input order
```

### Audit and undo

One `ActionLog` entry per call, with `snapshotBefore` / `snapshotAfter` order
graphs and an undo that restores the before graph via `restoreOrderGraph` —
identical in shape to the per-line command. Action label key
`sales.audit.orders.lines.upsert_many`.

The id is deliberately **not** added to `DOCUMENT_LINE_UPSERT_COMMANDS` in
`lib/historyHelpers.ts`. That set makes the document timeline diff every line in
the before/after snapshots with `JSON.stringify` across 18 fields — per rendered
entry. For a batch of ~1,100 lines that is ~20,000 comparisons per entry on a
page that may show several. A batch entry shows its action label without
changed-field chips instead.

### Not in scope

- **No REST route.** The adopter calls the command bus. A route would live at
  `POST /api/sales/order-lines/batch` behind `sales.orders.manage` (the feature
  the existing order-lines route already uses) and would need a payload cap; it is
  a follow-up, not part of this change.
- **No quote twin.** `sales.quotes.lines.upsert` has the same shape and the same
  cost. Adding `sales.quotes.lines.upsert_many` is a mechanical follow-up once the
  order form is agreed.
- **No payload cap.** SPEC-021's open question 3 proposed capping a graph save at
  100 children. A cap defeats the case this command exists for (a single order
  carrying ~1,100 lines), and the command bus is not an anonymous surface. A REST
  route, if one is added, is where a cap belongs.

## Risks & Impact Review

| Risk | Failure scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|---|
| Extracting the shared helper changes per-line behavior | An order line written through the existing command gets different prices, UoM or metadata than before | High | `sales.orders.lines.upsert` | The extraction is mechanical: the same expressions, with `uomResolver` and the tax-service resolver injected instead of constructed inline, and both still constructed per call by the per-line command. Its existing test suites pass unmodified. | Low |
| A long batch holds one transaction open | A 1,100-line batch holds a write transaction for the duration of 1,100 inserts, blocking concurrent writers to the same order | Medium | sales writes | Atomicity is the requirement, so the transaction cannot be split. The aggregate lock is per order, and the batch is far shorter in wall-clock time than the N sequential transactions it replaces. | Accepted |
| Unbounded `lines` array | A caller sends a batch large enough to exhaust memory building the snapshot list | Low | sales writes | Memory is O(N) in lines already held by the aggregate load. The command bus is reachable only by server-side callers; the absent REST route is where an external cap belongs. | Accepted |
| Coarser undo | Undoing a batch reverts every line in it, not one line | Low | audit/undo | Intended: one caller action is one undo entry, matching SPEC-021's stated goal. The per-line command remains for granular edits. | Accepted |
| Divergence from SPEC-021's body shape | A later graph save uses `lines: { upsert, delete }` while this uses `lines` / `deleteIds` | Low | contract surface | Flagged for maintainers on the PR; the shape is cheap to align before anything depends on it. | Open |

### Carried over from the base branch

`mapOrderLineEntityToSnapshot` moved to `lib/lineSnapshots.ts` and now returns
`SalesPersistedLineSnapshot`, which carries `statusEntryId`, `catalogSnapshot`
and `promotionSnapshot` back to the row (#5911). The bulk command builds its
working line set from that mapper and reuses its type, so untouched lines keep
those columns; a test pins it.

The shared helper also carries the discount-origin contract: caller-supplied and
stored-row discounts mean different things, so the merged snapshot resolves them
through `resolveUpsertDiscountFields`, and a caller-supplied net total is tagged
through `resolveUpsertTotalsOrigin` (#5644). Both live in the shared helper, so
the batch path and the per-line path apply them identically.

## Testing

`packages/core/src/modules/sales/commands/__tests__/documents.line-bulk-upsert.test.ts`:

- N new lines in one batch produce the same line projections and the same order
  totals and `lineItemCount` as the equivalent sequence of per-line upserts (the
  change's central claim),
- `SalesOrderLine` is loaded once per batch regardless of line count,
- update by id, append without id, mixed in one call; the updated line keeps its id,
- `deleteIds` alongside upserts, with the surviving lines renumbered `1..n`,
- a batch that would empty the order is refused with the per-line delete command's error,
- deleting a line with shipped items is refused with the per-line delete command's error,
- `lineNumber` as a destination: move earlier, move later, no-op,
- `statusEntryId` survives on lines the batch does not touch,
- a refusal anywhere in the batch writes nothing,
- one audit entry per call, carrying the pre-batch graph in its undo payload,
- unknown order id and tenant-scope mismatch fail as the per-line command does,
- schema refusals: empty batch, duplicate id, id both upserted and deleted.

No integration test path: the command adds no API route and no UI surface, so
there is nothing for the Playwright suite or a QA reviewer to exercise beyond what
the unit suite proves.

## Final Compliance Report

- Tenant/organization scoping: `ensureOrderScope` on both `prepare` and `execute`,
  as in the per-line command. Covered by a test.
- Optimistic locking: `enforceSalesDocumentOptimisticLock` on the order aggregate,
  before any mutation.
- Backward compatibility: additive. New command id, new schema exports, no change
  to an existing signature, route, event id, DI key, ACL feature or entity.
  `orderLineUpsertCommand`'s observable behavior is unchanged.
- Generated files: none edited by hand; `yarn generate` run.
- i18n: `sales.audit.orders.lines.upsert_many` and
  `sales.orders.lines.upsert_many` added to all five locales;
  `yarn i18n:check-sync` clean.
- No new production dependency.

## Changelog

### 2026-09-17

- Initial specification.
- Added `sales.orders.lines.upsert_many` with schema, guards, destination-style
  line numbering, audit and undo.
- Extracted `buildUpsertedOrderLineSnapshot` and split
  `assertShippedOrderLineEditable`, both shared with the per-line command.
- Rebased onto the current base branch: the helper reuses
  `SalesPersistedLineSnapshot` and `mapOrderLineEntityToSnapshot` from
  `lib/lineSnapshots.ts`, and carries `resolveUpsertDiscountFields` /
  `resolveUpsertTotalsOrigin` so both commands apply the discount-origin
  contract identically.
