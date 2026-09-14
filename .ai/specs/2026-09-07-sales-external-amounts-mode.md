# Sales `external` amounts — an opt-in mode for documents priced elsewhere

Status: **implemented in this fork** on branch `implement-pr-5991-spec`. The upstream proposal
([open-mercato/open-mercato#5991](https://github.com/open-mercato/open-mercato/pull/5991)) is still
spec-only and awaiting a maintainer decision; § Decision Record below records the answers this fork
adopted so the code could land, and it is the section to revisit if upstream answers differently.

Scope: `packages/core/src/modules/sales/{lib/calculations.ts,lib/types.ts,lib/externalAmounts.ts,lib/providers/totals.ts,lib/makeSalesLineRoute.ts,commands/documents.ts,commands/returns.ts,data/entities.ts,data/validators.ts,api/documents/factory.ts,api/order-lines/route.ts,components/documents/*,backend/sales/documents/[id]/page.tsx}`

Related: upstream issues #5644, #5853, #3757 and PRs #5640, #5707, #5438 — all of which are already in
this fork's `develop`, so the upstream spec's premises hold here as written. Verified against
`fullstackhouse/open-mercato` `develop` @ `00d039184`.

## TLDR

Core's sales module is authoritative over money: a line's net is derived from `unitPriceNet × quantity`
minus the discount, and a document's header totals are derived from its lines. A caller that **mirrors**
documents already priced, rounded and taxed in an external book of record cannot transmit either figure —
both are recomputed on every write — and there is no shape for a line whose net is *above*
`unitPrice × quantity`.

This adds one opt-in, **persisted** mode — `sales_orders.totals_mode` and
`sales_order_lines.amounts_mode`, each `computed` (default) | `external` — under which the caller's
amounts are stored and served verbatim, and no recalculation path can move them, including the two
extension registries: they keep running and have the caller's amounts re-applied after them.

Zero behaviour change for any caller that never sets the mode. One default-valued column per table, no
backfill.

## Problem Statement

### What core owns today

`buildBaseLineResult` (`lib/calculations.ts`) derives a line's net from its own columns and nothing else:
`netSubtotalBeforeDiscount = unitNet × quantity`, then a discount clamped into `[0, netSubtotalBeforeDiscount]`,
then `netSubtotal = max(before − discount, 0)`. `line.totalNetAmount` is never read.
`line.totalGrossAmount`, by contrast, **is** honoured verbatim — the asymmetry upstream #5644 opened.

`buildBaseDocumentResult` then derives the header from the line *results*, and `applyOrderTotals`
(`commands/documents.ts`) writes the order header **only** from `calculation.totals`. Every command that
touches one line recalculates the whole document and re-persists every line, and a persisted line
re-enters calculation through `mapOrderLineEntityToSnapshot`, rebuilt from its columns.

That is correct for a system that **composes** orders. It is wrong for one that **mirrors** orders whose
figures are the legally filed ones.

### Three consequences for a mirroring caller

1. **The line net cannot be transmitted.** A source that authors prices in gross stores a 2-decimal unit
   net which, multiplied by quantity, does not reproduce its own line net. `totalNetAmount` is accepted and
   validated (`data/validators.ts` → `linePricingSchema`) and then never read.
2. **The header cannot be transmitted either.** Where the source rounds VAT per rate group, its own header
   net legitimately differs from the sum of its lines. `orderCreateSchema` *accepts* the header fields —
   `orderTotalsSchema.shape` is spread into it — and every write path then discards them and rewrites the
   header from the rollup. The difference is unrepresentable **regardless of how well the lines are fixed**.
3. **Markups are unrepresentable.** `discountAmount` is `decimal({ min: 0 })` and the engine clamps the
   resolved discount with `Math.max(…, 0)`, so a line whose net is *above* `unitPrice × quantity` — upward
   source rounding, a surcharge priced into the line — has no shape at either layer.

How often this bites, measured against a production-scale mirror of a real order history, is quantified in
[upstream PR #5991](https://github.com/open-mercato/open-mercato/pull/5991); the structural point, not the
magnitude, is the argument here. A difference of one minor unit on a legally filed document is a
reconciliation failure, and no amount of rounding-mode tuning closes a gap the source deliberately
introduced.

### Core already has caller-asserted amounts — on invoices

This is not a new principle for the module, only a new place to apply it. `sales.invoices.create` writes
the header straight from request input (`subtotalNetAmount: toNumericString(parsed.subtotalNetAmount ?? 0)`),
and so do `sales.invoices.update`, `sales.credit_memos.create` and `sales.credit_memos.update`. Core
already ships a document kind whose amounts belong to the caller. What it lacked was a way to say so
**explicitly**, on the document kind where it matters, and to have that statement survive the next write.

## Proposed Solution

### 1. Two persisted mode columns (normative)

> `sales_orders.totals_mode` and `sales_order_lines.amounts_mode` each hold `'computed'` (default) or
> `'external'`.
>
> `computed` — core derives the row's amounts, exactly as today.
>
> `external` — the amounts stored on the row are the caller's assertion. Core stores them, serves them,
> and never recomputes them. Core remains authoritative over everything that is not an amount:
> identifiers, statuses, quantities, `returned_quantity`, and the payment-derived
> `paid_total_amount` / `refunded_total_amount` / `outstanding_amount`.

Both columns, not one. The header finding and the line finding are independent, and neither column is
derivable from the other at the point of use:

- The line calculation is a pure function of one `SalesLineSnapshot` with no document in scope, and
  `mapOrderLineEntityToSnapshot` is handed a line entity alone. A document-only mode would have to be
  fetched through a relation inside the mapper.
- A line-only mode cannot express the per-rate-group rounding difference, which exists only at the header.

The redundancy is real and is the cost of this shape. It is paid for by an invariant and a guard test:

> **Invariant.** `sales_orders.totals_mode = 'external'` **iff** every one of that order's lines has
> `amounts_mode = 'external'`. Mixed documents are rejected at the command layer.

Enforced in commands, not as a database constraint — a cross-table `CHECK` is not expressible and a trigger
would put document math outside `salesCalculationService`, against `packages/core/src/modules/sales/AGENTS.md`
rule 1.

In practice the caller declares the mode **once, on the document**, and every line inherits it
(`sales.orders.create`); a line that explicitly declares the other mode is a 4xx, not a silent coercion.

**Quotes are deliberately excluded.** `sales_quotes` / `sales_quote_lines` get no column. A quote is core
*composing* a proposal, not mirroring a book of record. Because `linePricingSchema` is shared, the quote
commands **reject** a supplied mode — `amountsMode` on a line, `totalsMode` on the document update schema
they share with orders — rather than ignoring it. Silently ignoring an accepted field is the exact failure
this mode exists to stop repeating. Invoices and credit memos are excluded because
they already behave this way; making their caller-asserted amounts explicit is separate work.

### 2. `amountsMode` on the snapshot

`SalesLineSnapshot` gains one optional field, `amountsMode?: SalesAmountsMode | null`, set by both
producers: a caller declares it on create (`createLineSnapshotFromInput`), and
`mapOrderLineEntityToSnapshot` reads it back off the column. It answers *who is authoritative* for this
line's amounts — a different question from the three fields that look adjacent to it and are not:
`discountAmountBasis` (*how* to read a supplied discount), `discountAmountFromStoredRow` and
`totalsFromStoredRow` (*where* a value came from). None of those is an authority signal and `amountsMode`
is not an origin signal; see § Relationship to the neighbouring contracts.

Additive optional field on a public type → ADDITIVE-ONLY under `BACKWARD_COMPATIBILITY.md` § 2.

### 3. Line calculation under `external`

`buildBaseLineResult` gains one early branch, before any derivation:

```
if line.amountsMode === 'external':
    netAmount      = line.totalNetAmount
    grossAmount    = line.totalGrossAmount
    taxAmount      = line.taxAmount
    discountAmount = round(unitPriceNet × quantity − totalNetAmount)   # derived, signed
    return
```

Three properties of that block are load-bearing.

**No clamp.** Neither `Math.max(…, 0)` nor `Math.min(…, netSubtotalBeforeDiscount)` runs, so a line net
*above* `unitPrice × quantity` is expressible. The markup arrives as a **negative derived
`discountAmount`**, which the `numeric(18,4)` column holds without a schema change.

**No validator change for the markup.** `discountAmount: decimal({ min: 0 })` constrains a *caller input*,
and under `external` the caller does not supply `discountAmount` — it is derived from the net it did
supply. The `min: 0` bound therefore stays exactly as it is, rather than being loosened for the computed
path too.

**`discountAmount` stays derived** rather than becoming a fourth supplied field, so an items table that
renders both a percent and an amount keeps agreeing with itself.

**Registered line calculators still run, and cannot move the amounts.** `calculateLine` runs
`buildBaseLineResult`, then `sales.line.calculate.before`, then the hook registry, then `.after`.
Substituting at the first stage only would leave any later stage free to overwrite the caller's figures, so
`calculateLine` **re-applies** an external line's supplied `netAmount`, `grossAmount`, `taxAmount` and the
derived `discountAmount` after the registry, immediately before returning.

That is not a new pattern: `calculateDocument` already does exactly this for `paidTotalAmount` /
`refundedTotalAmount`, for exactly this reason — authoritative inputs are re-applied last. A supplied
amount under `external` is an authoritative input by definition.

### 4. Document totals under `external`

The supplied header reaches the engine through two additive fields on `CalculateDocumentOptions`:

```ts
totalsMode?: SalesAmountsMode | null
suppliedTotals?: Partial<SalesDocumentAmounts> | null
```

`buildBaseDocumentResult` then takes the supplied header instead of the line rollup, for nine of the ten
fields `orderTotalsSchema` accepts: `subtotalNetAmount`, `subtotalGrossAmount`, `discountTotalAmount`,
`taxTotalAmount`, `shippingNetAmount`, `shippingGrossAmount`, `surchargeTotalAmount`,
`grandTotalNetAmount`, `grandTotalGrossAmount`.

The tenth, `lineItemCount`, stays **core-owned** and is not caller-supplied. It is not money — it is a
count of rows core itself persisted, derived from `calculation.lines.length` — and a caller that could
assert it could make a document disagree with its own line rows. Named here because it sits in the same
schema as the nine, so an implementer wiring "the header totals" through wholesale would carry it along.

**Substituting there is necessary and not sufficient**, because a totals calculator runs afterwards and
rebuilds the header from scratch — and core registers one itself, by module side effect rather than by
call: `lib/providers/index.ts` runs `ensureProviderTotalsCalculator()` at module-evaluation time, reached
both from the module entry point (`sales/index.ts`) and from a value import in `data/validators.ts`. Its
first act is `rebuildDocumentResult({ lines, adjustments })`, which has no channel for supplied totals. So
the hook is live on **every** order and quote write, and honouring the supplied header in
`buildBaseDocumentResult` alone would have been overwritten before anything was persisted.

Two changes close it, and neither disables the registry:

1. **`calculateDocument` re-applies the supplied header after the totals-calculator stage**, in the same
   final block that already re-applies `paidTotalAmount` / `refundedTotalAmount`. `outstandingAmount` is
   then recomputed against the restored gross. This is the belt: whatever a third-party calculator does,
   the caller's header is restored last.
2. **Core's own provider totals calculator returns `current` unchanged for an external document.** This is
   the braces, and it is a correctness point rather than a defensive one: the hook exists to generate
   shipping and payment *provider adjustments*, and generating an adjustment whose amount cannot move a
   header the caller already supplied would put a charge on the document that is visible in the itemised
   breakdown and absent from the total. The hook learns the mode from a new optional `totalsMode` field on
   its params — additive; no third-party calculator has to change.

`paidTotalAmount`, `refundedTotalAmount` and `outstandingAmount` stay **core-owned** and derived. Because
payments derive outstanding from the *persisted* header gross and never re-derive the header,
`sales.payments.*` needs no rule and no change at all — under `external` it simply derives from the
caller's gross instead of core's.

Choosing `external` **requires** a complete specification: `unitPriceNet`, net, gross and tax on every
line, and `subtotalNetAmount`, `subtotalGrossAmount`, `discountTotalAmount`, `taxTotalAmount`,
`grandTotalNetAmount` and `grandTotalGrossAmount` on the document (shipping and surcharge default to zero).
Partial specification is not a mode; it is a 4xx naming the missing fields.

**`unitPriceNet` is on that list because § 3's derivation consumes it**, not for symmetry. It is optional on
the request and coerced to zero on rehydration, so an external line that omitted it would derive
`discountAmount = 0 × quantity − totalNetAmount`: the line's entire net, persisted into
`sales_order_lines.discount_amount` and rendered in the items table as a discount — indistinguishable from
a legitimate markup. It has its own rejection test for that reason.

### 5. Round trip

`mapOrderLineEntityToSnapshot` (in both `commands/documents.ts` and `commands/returns.ts`) reads
`amounts_mode` off the column onto the snapshot, so every rehydration is self-describing. Recalculation
triggered by a sibling line's write returns the external line's stored amounts unchanged.

**This is the property that separates the proposal from every write-time-only variant.** A request flag can
make one write correct; only a persisted column survives the next write to a sibling row.

### 6. Every place that writes header totals, and its rule

The rule is one sentence, applied uniformly:

> A command that would rewrite an external document's header either **refuses**, or **leaves the header
> untouched** (or restates it from what the caller supplied), and records its own non-monetary effect.
> Nothing recomputes an external header implicitly.

**Which mode the rules are evaluated against, because every row below depends on it:** the **persisted**
`totals_mode`, as it stands when the command starts — *except* for a request that sets `totalsMode` itself,
which is a mode transition and is governed by § 8 rather than by the row for the command carrying it.
Without that carve-out the § 8 switch-back falls through `sales.orders.update`'s row below (it carries
neither lines nor totals) and is told to leave the header untouched, which would leave a document holding
externally-asserted amounts while both columns say `computed` — the same end state the undo discussion
below exists to prevent, reached through a different door.

Both transitions are legal, and both rewrite:

| transition | how | effect |
|---|---|---|
| `computed → external` | `totalsMode: 'external'` with a complete header (§ 4) | the supplied header is stored verbatim, every line flips and its persisted amounts become the caller's assertion; incomplete input is a 400 and the document stays `computed` |
| `external → computed` | `totalsMode: 'computed'`, carrying nothing else | § 8's switch-back: every line flips, header and lines are recomputed, and the caller's figures are gone |

**`commands/documents.ts` — recalculate-and-persist via `applyOrderTotals` / `applyQuoteTotals`**

| command | rule under `external` |
|---|---|
| `sales.orders.create` | accepts `totalsMode: 'external'` + complete lines + header totals; incomplete input is a 400 |
| `sales.orders.update` | a request carrying a mode change or header totals must carry the **complete** header; a request carrying neither leaves the persisted header untouched — **unless it sets `totalsMode`, which is a transition and follows § 8, not this row** |
| `sales.orders.lines.upsert` | **rejects** unless the request also carries `orderTotals` — which today's schema could not express, so § API Contracts widens it |
| `sales.orders.lines.delete` | **rejects** unless the request also carries `orderTotals` — same schema widening |
| `sales.orders.adjustments.upsert` | **refuses** (409) — an adjustment exists only to change money |
| `sales.orders.adjustments.delete` | **refuses** (409) — same |
| `sales.quotes.*` | unchanged — quotes are always `computed` (§ 1), and a supplied mode is rejected under either name |

**`commands/documents.ts` — copies a header rather than deriving one**

`sales.quotes.convert_to_order` copies the quote's persisted totals onto the new order without
recalculating. The produced order is `computed`, because its source was: the column takes its default.

**`commands/returns.ts` — the three `applyOrderTotals` sites** (`reverseReturnEffects`,
`restoreReturnEffects`, and the create path) all go through `applyOrderTotalsUnlessExternal`, which returns
early for an external order. A return still creates its return document, its line-level `return`
adjustments and its `returned_quantity` update — it simply does not rewrite the header.

**This is the most surprising rule here and it is deliberate**: the header belongs to the source system,
which issues its own credit document and pushes the corrected header. Silently moving a legally filed
total because core computed a credit would be worse than leaving it. See § Decision Record, decision 2.

**`commands/documents.ts` — undo/rollback via `restoreOrderGraph`**, which bypasses `applyOrderTotals`
entirely: it calls `applyOrderSnapshot`, which assigns the header field by field. Every order command has a
second, unlisted header write behind it.

**The amounts are not the hazard there — the mode columns are.** An undo restores the row's own previously
persisted values, which for an external order are the caller's. But `OrderGraphSnapshot` and its nested
`OrderLineSnapshot` are hand-maintained explicit field lists, captured by `loadOrderSnapshot` and restored
by `applyOrderSnapshot` field by field at both ends, so a new column is not picked up implicitly. Both now
carry the mode.

The concrete failure this prevents: an operator uses § 8's switch-back to flip an external order to
`computed`, then undoes that update. `restoreOrderGraph` puts the caller's amounts back but, with the
columns absent from the snapshot, would leave `totals_mode = 'computed'` — a document holding the caller's
legally filed header while advertising that core owns it, which the next write to any sibling line would
recalculate away, silently. The mirror-image miss produces the mixed state § 1 forbids. So the rule is not
"restore the mode" but **restore the mode and the amounts as one unit**.

**The read path needs no change at all.** `sales.orders` single-row `GET` serves persisted totals rather
than recomputing, since #5438 removed the display recalculation from `api/documents/factory.ts`.
`recalculateOrderTotalsForDisplay` (`commands/returns.ts`) survives as an export with no production caller;
it is passed the mode and the persisted header anyway, so it answers with the stored figures if anything
starts calling it again.

**Inside the engine — the provider totals calculator** (`lib/providers/totals.ts`), registered by importing
a module rather than by being called, returns `current` unchanged for an external document, and
`calculateDocument` re-applies the supplied header after the whole registry regardless (§ 4). This is the
one site a guard placed at any call site would miss, and so would a review that only reads the command
files.

`sales.returns.update` writes no header totals and needs no rule.

### 7. UI

`components/documents/DocumentTotals.tsx`, `components/documents/ItemsSection.tsx` and
`backend/sales/documents/[id]/page.tsx`:

- an "Amounts from source" badge on the totals card when `totals_mode = 'external'`, routed through
  `t('sales.documents.amountsExternal')`;
- line add / edit / delete disabled on an external document, since the backend UI cannot restate the
  document header in a line write and the request would be rejected (§ 6) — a form that submits into a
  guaranteed 4xx is a defect. The amounts stay visible; they are just not the operator's to change;
- switching back to `computed` is an explicit, confirmed action of its own (§ 8), never a side effect of an
  edit.

Status colours use `{property}-status-{status}-{role}` tokens; no hardcoded Tailwind shades.

### 8. Leaving the mode, and what is not kept

Setting `totalsMode: 'computed'` on `sales.orders.update` flips the order and **all** its lines (the § 1
invariant forbids the mixed state), runs `calculateDocumentTotals` normally, and rewrites the header and
every line from `unit_price_net`, `quantity` and `discount_*`.

**The switch is lossy, and how lossy depends on the line.** The header returns to the line rollup in every
case, so the per-rate-group difference the mode existed to carry is gone. At line level there are three
outcomes and only the first is exact:

- **A discount line with `discount_percent = 0` round-trips exactly**, because the stored amount is read
  back as a line total (see § Relationship to the neighbouring contracts, point 3).
- **A markup line loses the markup, and its net falls.** Its derived `discount_amount` is negative,
  `Math.max(…, 0)` clamps it to `0`, and the net becomes `unitPriceNet × quantity` — which for a markup
  line is *below* the external net by definition.
- **A line carrying a non-zero `discount_percent` re-derives from the percent**, since percentage-first
  precedence outranks the stored amount. `discount_percent` is persisted as supplied but unused while the
  line is external, which makes it a latent trap: a caller that sends one alongside external amounts gets
  an exact round trip while external and a silently different net the moment the document is switched
  back.

The supplied values are **not** retained in shadow columns. A shadow copy is a second source of truth that
nothing reads and nothing keeps correct, and the caller's own book of record still holds the originals. The
UI confirmation in § 7 is what makes the loss deliberate rather than accidental.

## Data Models

Two new columns, each with a default. No backfill, no data migration.

| entity | column | definition |
|---|---|---|
| `SalesOrder` (table `sales_orders`) | `totals_mode` | `text NOT NULL DEFAULT 'computed'` |
| `SalesOrderLine` (table `sales_order_lines`) | `amounts_mode` | `text NOT NULL DEFAULT 'computed'` |

Both entities gain `[OptionalProps]` for the new property so existing `em.create(SalesOrder, …)` callers —
including third-party ones — keep compiling without setting it.

Unchanged, and listed because § 3 depends on their shape: `sales_order_lines.discount_amount`
(`numeric(18,4)`, now **signed** on external rows), `total_net_amount`, `total_gross_amount`,
`sales_orders.grand_total_gross_amount`, and `outstanding_amount` (stays derived).

Two module-private types gain the columns too, or the undo path drops them (§ 6): `OrderGraphSnapshot`
(`totalsMode`) and `OrderLineSnapshot` (`amountsMode`) in `commands/documents.ts`. Neither is exported, so
this is not a contract change — but the undo *behaviour* it drives is observable.

Migration: `migrations/Migration20260910120000_sales_external_amounts_mode.ts` adds two
`ALTER TABLE … ADD COLUMN … DEFAULT 'computed' NOT NULL` statements, plus the matching
`migrations/.snapshot-open-mercato.json` update. Existing rows take the default in place; PostgreSQL has
not rewritten a table for a defaulted column add since 11.

## API Contracts

No route is added, removed or renamed. No response shape changes beyond two additive fields.

| route | methods | change |
|---|---|---|
| `/api/sales/orders` | `POST` `PUT` | accepts `totalsMode` on the document and `amountsMode` on each line; header total fields, already accepted, become meaningful under `external` |
| `/api/sales/orders` | `GET` | order responses gain `totalsMode` |
| `/api/sales/order-lines` | `GET` | line responses gain `amounts_mode` |
| `/api/sales/order-lines` | `POST` `PUT` `DELETE` | on an external order, requires `orderTotals` in the same request; otherwise unchanged |
| `/api/sales/order-adjustments` | `POST` `PUT` `DELETE` | refuses (409) on an external order |
| `/api/sales/returns` | `POST` `DELETE` | succeeds on an external order; leaves the header untouched |
| `/api/sales/quotes`, `/api/sales/quote-lines` | all | unchanged, except that a supplied mode is rejected under either name |

**Each field is named after the column it sets, and is returned under the name it is accepted under.** The
document carries `totalsMode` (`sales_orders.totals_mode`); a line carries `amountsMode`
(`sales_order_lines.amounts_mode`). Two names rather than one is deliberate: a document has *totals* and a
line has *amounts*, they are separate columns (§ 1), and a field accepted under one name and returned under
another is the adjacent shape to the bug this whole document is about.

`totalsMode` is the caller-facing switch and **cascades**: setting it writes the document column and every
line's, which is what makes § 1's invariant hold by construction rather than by validation, and what makes
§ 8's switch-back a single field on a single request rather than one per line. A line-level `amountsMode`
is still accepted — it has to be, because `sales.orders.lines.upsert` addresses one line without the
document — and if an explicitly supplied line mode disagrees with the document's, the request is rejected
(`sales.errors.externalModeMixed`) rather than one silently winning.

**A line that omits `amountsMode` inherits the document's mode, and is not a 400.** On a document write
that is the request's `totalsMode`; on `sales.orders.lines.upsert` it is the order's *persisted*
`totals_mode`. Defaulting such a line to `computed` would build exactly the mixed document § 1 forbids, and
rejecting it would make every line write on an external order restate a mode the caller already declared
once, on the document. Pinned by its own test rather than left to the invariant to catch.

Request schema additions in `data/validators.ts`:

```ts
export const amountsModeSchema = z.enum(['computed', 'external'])

// linePricingSchema — spread into orderLineCreateSchema and quoteLineCreateSchema
amountsMode: amountsModeSchema.optional(),   // omitted ⇒ inherit the document's mode

// orderCreateSchema, alongside the existing ...orderTotalsSchema.shape
totalsMode: amountsModeSchema.optional(),    // omitted ⇒ 'computed'
```

`orderTotalsSchema` is now exported, because two schemas in `commands/documents.ts` need it:

```ts
const orderHeaderTotalsSchema = orderTotalsSchema.omit({ lineItemCount: true })

const orderLineUpsertSchema = orderLineCreateSchema.extend({
  id: z.string().uuid().optional(),
  orderTotals: orderHeaderTotalsSchema.optional(),   // required iff the order is external
})
const orderLineDeleteSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderTotals: orderHeaderTotalsSchema.optional(),   // required iff the order is external
})
```

`lineItemCount` is omitted from that group deliberately: it is `orderTotalsSchema`'s tenth field and the
one a caller does **not** own — it is core's count of the rows core persisted, derived from
`calculation.lines.length`, and a caller that could assert it could make a document disagree with its own
line rows. It is named here because an implementer wiring "the header totals" through wholesale would
carry it along.

A nested `orderTotals` object rather than a flat spread: a line command's own payload already carries
`totalNetAmount` and `totalGrossAmount` for the *line*, and flattening document-level fields beside them
would put two different meanings of "total" in one object. `makeSalesLineRoute` gains an optional
`writeExtensionShape` so the order-line route can accept the group while the quote-line route does not.

`documentUpdateSchema` (module-private, `commands/documents.ts`) gains `totalsMode` and the
`orderTotalsSchema` fields minus `lineItemCount`, and its non-empty-payload refine accepts them — without
that, `sales.orders.update` would never see the mode, because zod stripped it before the command read it.
One consequence is worth naming rather than discovering: a payload of `{ id, <header totals only> }` used
to fail that refine and now parses. On an **external** order it does what it says — it restates the header.
On a `computed` order or a quote it is a no-op, which is what those header fields already were when sent
alongside any other field; no payload that used to succeed behaves differently.

New error keys, routed through i18n and translated into all five shipped locales:
`sales.errors.externalAmountsIncomplete`, `sales.errors.externalTotalsRequired`,
`sales.errors.externalAdjustmentRefused`, `sales.errors.externalModeMixed`,
`sales.errors.externalModeUnsupportedOnQuote`.

## Migration & Backward Compatibility

| surface | classification | note |
|---|---|---|
| `SalesLineSnapshot`, `SalesAmountsMode` (public types) | **ADDITIVE-ONLY** | one optional field; no deprecation bridge required |
| `CalculateDocumentOptions` (public type) | **ADDITIVE-ONLY** | two optional fields, `totalsMode` and `suppliedTotals` |
| `SalesTotalsCalculationHook` params | **ADDITIVE-ONLY** | one optional `totalsMode` field; the hook's *output* stops being final for an external document, because the supplied header is re-applied after the registry |
| `SalesOrder` / `SalesOrderLine` entity create types | **ADDITIVE-ONLY** | `[OptionalProps]` keeps the new columns out of `RequiredEntityData` |
| Line and document validators | **ADDITIVE-ONLY** | optional field; omission = today's behaviour |
| `makeSalesLineRoute` config | **ADDITIVE-ONLY** | one optional `writeExtensionShape` |
| DB schema | **ADDITIVE-ONLY** | two new columns with defaults — explicitly permitted by `BACKWARD_COMPATIBILITY.md` § 8 |
| API routes / URLs | unchanged | — |
| API responses | **ADDITIVE-ONLY** | `totalsMode` on orders, `amounts_mode` on order lines |
| Event ids, DI keys, ACL features, notification ids, CLI commands | unchanged | — |

**There is no behavioural break.** Every rule in § 6 is gated on `totals_mode = 'external'`, which no
existing row holds and which no caller reaches without sending `totalsMode` on a document or `amountsMode`
on a line — both fields being new. For a caller that sends neither, output is byte-identical: the same
stored line amounts, the same header totals, the same response payloads. Two consequences are visible to code that never opts in and
are worth an `UPGRADE_NOTES.md` line:

| what | who sees it |
|---|---|
| `sales_order_lines.discount_amount` can be **negative** on external rows | a third-party module or report that assumed the column is non-negative |
| `GET /api/sales/orders` and `/api/sales/order-lines` gain `totalsMode` / `amounts_mode` | a consumer with a strict response schema |

## Prior Art

The shape is standard in platforms that must interoperate with an external book of record; the upstream
proposal quotes each source verbatim and those quotes are not repeated here.

- **commercetools** is the closest precedent and the same two-level structure arrived at independently:
  `LineItemPriceMode: ExternalTotal` is a persisted enum on the line with `Platform` as the default, and
  `TaxMode: ExternalAmount` requires the cart **and all** its line items to carry external amounts before
  the cart can be ordered — § 4's completeness rule. `Set Cart Total Tax` supplies a header total separately
  from the lines with per-rate portions, precisely because the two do not have to agree. Its tax-integration
  guide recommends `ExternalAmount` *specifically* for the rounding problem this spec opens with.
- **Shopify** (`orderCreate`) and **Saleor** (`orderBulkCreate`) take supplied amounts as facts with no mode
  at all — Saleor inverts core's derivation entirely, deriving the unit price from the totals. These set the
  ceiling, not the target.
- **Odoo** is the cautionary case: `account.move.tax_totals` is editable *"if you encounter rounding
  issues"*, but the field is computed and the edit is not stored as an assertion, so the next recomputation
  from the lines governs. That is the failure mode of every write-time-only variant, and it is why § 1
  insists on a persisted column rather than a request flag.

## Out of Scope

- **"Honour a supplied `totalNetAmount`" unconditionally.** Honouring a supplied net *by default* would
  freeze exactly the legacy rows a recalculation heals. Here a supplied net wins only on a row carrying an
  explicit, persisted mode; every `computed` row keeps recalculating and keeps healing.
- **Whether a supplied `totalGrossAmount` should keep being honoured verbatim on the `computed` path**
  (upstream #5853) stays open. One observation as input rather than an answer: today's net/gross asymmetry
  is an argument for a single explicit mode over per-field verbatim rules, because under `external` net and
  gross are symmetric by construction.
- **Quotes, invoices and credit memos** — see § 1.

## Alternatives Considered

| option | effect | verdict |
|---|---|---|
| **A. Persisted mode columns on document and line** (this spec) | caller authority survives every sibling write; no behaviour change without opt-in; two defaulted columns | **chosen** |
| B. Honour a supplied `totalNetAmount` unconditionally | no new column, no new field | rejected — freezes legacy rows that recalculation heals |
| C. A per-request flag, nothing persisted | no migration at all | rejected — the next write to any sibling line recalculates the whole document and overwrites it: the Odoo `_inverse_tax_totals` failure, verbatim |
| D. Document-level mode only | one column instead of two | rejected — the line calculation is a pure function of one `SalesLineSnapshot` with no document in scope |
| E. Line-level mode only | one column instead of two | rejected — cannot express a header that legitimately differs from the sum of its lines, which is the harder half of the problem |
| F. Shadow columns retaining the caller's values through a switch back | switching back is reversible | rejected — a second source of truth that nothing reads and nothing keeps correct |
| G. A separate "mirrored document" entity alongside `sales_orders` | perfect isolation | rejected — duplicates the whole document surface to change how nine numeric columns are populated |

## Decision Record

The upstream proposal left three questions to a maintainer. This fork answered them as follows so the
implementation could land; each is revisitable, and each is where to look first if upstream decides
differently.

### 1. Persisted columns — **yes**

Two defaulted `text` columns, no backfill. The alternative (a request-only flag) does not survive a sibling
write, which is the entire property the mode exists to provide, so rejecting this would have been rejecting
the feature. The migration cost objection that was raised against a nullable-column variant does not carry
across: this adds one default-valued column per table, rewrites no existing value, and needs no backfill.

**Scope sub-question:** quotes stay excluded. Adding them later is one more column pair and one more schema
field — purely additive — and the type and engine changes are already shared.

### 2. Returns — **record without rewriting**

A return against an external order creates its return document, its line-level `return` adjustments and its
`returned_quantity` update, and leaves the header alone. The alternative (refuse returns outright on
external orders) is a cleaner rule but blocks a real workflow, and a header total that is transiently
absent or refused on a legally filed document is worse than one that stays as filed while the source
system issues its own credit. This is the rule most likely to be overruled; it is isolated in
`applyOrderTotalsUnlessExternal` (`commands/returns.ts`), so reversing it is a one-function change plus its
tests.

### 3. Registries — **keep running, re-apply afterwards**

Both the line-calculator and totals-calculator registries still run on external rows, and the caller's
amounts are re-applied after them. Suppressing the registries outright (as commercetools does for cart
discounts) would reach the same numbers more honestly, but it would also stop a hook doing non-amount work
— attaching an adjustment, writing metadata — from running at all, and `BACKWARD_COMPATIBILITY.md` treats
these hooks as a stable extension point. The residual risk is accepted and named: a hook's work on an
external line's amounts is silently discarded rather than silently applied, which is the safer of the two
silences.

## Relationship to the neighbouring contracts

The base branch already carries #5640, #5707 and #5438, so three things the upstream proposal had to hedge
are settled here rather than divergent.

1. **`amountsMode` lives beside two origin flags and must never be conflated with them.**
   `mapPersistedLine` (`lib/lineSnapshots.ts`) sets `discountAmountFromStoredRow` and `totalsFromStoredRow`
   to answer *where* a value came from; `amountsMode` answers *who owns it*. It is set on the order-side
   wrapper `mapOrderLineEntityToSnapshot` only, because `amounts_mode` is an order-line column and the same
   mapper serves quote lines. That file's own comment is emphatic that a mapper must not answer one origin
   question with the other's; this is the same discipline applied once more.
2. **The #5707 reconciliation warning is skipped structurally, not by a second gate.** § 3's branch returns
   at the *top* of `buildBaseLineResult`, before the reconciliation runs, so an external line never reaches
   it. Because that suppression is positional, it is asserted against the logger in the unit tests rather
   than assumed from reading the code — together with the converse case, where the same numbers on a
   `computed` line still warn.
3. **#5640's line-total discount basis is what makes the switch-back exact for a discount line.**
   `mapPersistedLine` sets `discountAmountFromStoredRow: true`, so `resolveLineDiscountTotal` reads the
   stored amount as a line total rather than multiplying it out. Since § 3 derived that amount as
   `unitPriceNet × quantity − totalNetAmount`, a line with `discount_percent = 0` recomputes to exactly the
   caller's net when the document returns to `computed`. That is the reason § 3 derives the discount
   instead of storing zero, and it would not hold on a tree without #5640.

## Testing Strategy

Shipped with the change:

- **`lib/__tests__/calculations.external-amounts.test.ts`** (18 cases) — supplied net/gross/tax returned
  verbatim across a table of contradicting inputs; the signed derived discount; the markup case with
  neither clamp; idempotency; a supplied header that disagrees with the sum of its lines; outstanding
  derived from the supplied gross; a *registered* totals calculator returning a deliberately wrong header
  and the supplied header still winning; the same at line level; a line calculator still able to change a
  computed line; core's own provider totals calculator generating no adjustment and moving no total on an
  external document, with a shipping and a payment method set — the case where it otherwise would; and the
  #5707 reconciliation warning staying silent for an external line while still firing for the same numbers
  on a computed one.
- **`commands/__tests__/documents.external-amounts.test.ts`** (25 cases) — create persisting the supplied
  header and line amounts, the markup line's negative discount, the four rejections (missing
  `unitPriceNet`, absent header, partial header, mixed document), the compatibility case where a caller
  that never sets the mode is on exactly the old path, line upsert/delete rejecting and accepting
  `orderTotals` with siblings byte-identical, adjustment refusal on both commands, the four
  `sales.orders.update` mode-crossing cases, the undo round trip asserting the mode columns and the amounts
  come back together, a new line on an external order inheriting the order's mode rather than defaulting to
  `computed`, a line explicitly declaring the mode the order does not have being rejected, and three quote
  cases: a quote line declaring a mode is rejected, a quote update carrying `totalsMode` is rejected, and
  no `amountsMode` key leaks onto a quote line through the shared line-entity converter.
- **`commands/__tests__/returns.external-amounts.test.ts`** — a full return leaving an external header
  byte-identical while still recording `returned_quantity` and the `return` adjustment, and the same return
  still rewriting a computed order's header.
- **`__integration__/TC-SALES-EXT-001.spec.ts`** — the whole round trip over HTTP: create with a header
  that disagrees with the lines, read back, refuse a line write without `orderTotals`, accept one with it
  and assert the sibling is untouched, refuse an adjustment, switch back to `computed`. Self-contained;
  deletes its order in `finally`.

## Risks & Impact Review

| risk | severity | mitigation | residual |
|---|---|---|---|
| Core's own totals calculator rebuilds the header from the line rollup after the base result, registered by a module side effect | **high** — this is the default path, not a deployment-specific one | § 4's two changes: the provider hook no-ops for external documents, and `calculateDocument` re-applies the supplied header after the whole registry | none once both land; both are pinned by tests that use a *registered* calculator, not a mock |
| A registered line calculator mutates an external line | medium | § 3 re-applies the supplied line amounts after the registry | a hook's work on an external line's amounts is silently discarded rather than silently applied — see § Decision Record 3 |
| A return moves no header total on an external order, surprising an operator | **high** for any external-mode deployment that takes returns | § 6 states the rule; § 7's badge marks the document | intended — see § Decision Record 2 |
| A caller opts in with incomplete data and gets a 4xx it did not expect | medium | the error names the missing fields | a stricter contract than the `computed` path, deliberately |
| Switching back to `computed` silently changes a legally filed total | medium | § 8 makes the loss explicit; § 7 requires a confirmation | unrecoverable by design; the source system holds the originals |
| A third-party module or report reads `discount_amount` assuming non-negative | medium | `UPGRADE_NOTES.md` entry; only occurs on rows a caller explicitly opted into | a report that sums the column across mixed rows understates the discount total |
| The § 1 invariant is enforced in commands only, so a direct DB write can produce a mixed document | low | the engine treats an absent/unknown mode as `computed`, so a mixed row degrades to today's behaviour rather than to nonsense | a direct writer can still create a document whose header and lines disagree — as it can today |
| A header-writing site is missed | medium | § 6 enumerates every one, including the two reached by importing a module and by restoring a snapshot rather than by being called | the enumeration was found incomplete twice upstream, both times for the same reason: it was built by grepping for `applyOrderTotals`, and neither missed site calls it |

## Final Compliance Report

- No cross-tenant exposure: every touched command already carries `{ tenantId, organizationId }`; the new
  columns are not scope-bearing.
- No direct cross-module ORM relations introduced; no new module dependency.
- Document math stays inside `salesCalculationService` — the mode is read inside the engine and no call
  site recomputes inline. The command-layer guards decide whether a write is *permitted*, never what the
  numbers are.
- No `any`; `SalesAmountsMode` is a union and the validators are `z.enum`.
- All new user-facing strings routed through locale files, in all five shipped locales.
- Two new columns → one migration plus the `.snapshot-open-mercato.json` update. `yarn db:migrate` was not
  run.
- `yarn generate`, `yarn typecheck`, `yarn lint` and `yarn test` all pass.

## Changelog

### 2026-09-10

- Implemented in this fork. Two persisted mode columns, the engine branches and both re-application stages,
  the command-layer rules for every header-writing site, the API and UI surfaces, five new i18n keys in
  five locales, and 45 unit/command tests plus one integration spec.
- § Decision Record filled with the three answers this fork adopted (persisted columns; returns record
  without rewriting; registries keep running).
- § Relationship to the neighbouring contracts added: the base carries #5640, #5707 and #5438, so
  `amountsMode` sits beside two origin flags it must not be conflated with, the #5707 warning is skipped
  positionally (and asserted against the logger), and #5640's line-total basis is what makes a
  zero-percent discount line round-trip exactly on switch-back.

### 2026-09-14

Tracked upstream head `4dd1efd96`, which settled two things after this branch was written:

- **The document-level field is `totalsMode`, not `amountsMode`.** One field per column — `totalsMode` on
  the document, `amountsMode` on a line — each returned under the name it is accepted under. The
  implementation had been posting `amountsMode` and reading back `totalsMode`, which is the shape of the
  bug this document is about. `totalsMode` cascades to every line; an explicitly supplied line mode that
  disagrees with the document's is rejected.
- **§ 6 now says which mode its rules are evaluated against** — the persisted one, except for a request
  that sets `totalsMode`, which is a transition governed by § 8 — and both transitions are tabulated. The
  implementation already behaved this way; the spec did not say so.
- **`lineItemCount` is named as the tenth field of `orderTotalsSchema` and is not caller-supplied.** It is
  now omitted from the `orderTotals` group a line write restates, rather than accepted and ignored.
- Answered the two questions the upstream review left open for the implementation: the compatibility
  criterion names both fields, and a line that omits `amountsMode` **inherits** the document's mode rather
  than being rejected or defaulting to `computed`, with the reasoning and a test.

### 2026-09-07

- Initial proposal, upstream [#5991](https://github.com/open-mercato/open-mercato/pull/5991).
