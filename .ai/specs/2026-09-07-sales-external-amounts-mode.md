# Sales `external` amounts — an opt-in mode for documents priced elsewhere

Status: **proposed — decision requested**. No implementation lands until § Decision Requested is answered.
Scope: `packages/core/src/modules/sales/{lib/calculations.ts,lib/types.ts,lib/lineSnapshots.ts,commands/documents.ts,commands/returns.ts,data/entities.ts,data/validators.ts,components/documents/*}`
Related: [#5644](https://github.com/open-mercato/open-mercato/issues/5644), [#5707](https://github.com/open-mercato/open-mercato/pull/5707),
[#5853](https://github.com/open-mercato/open-mercato/issues/5853), [#3757](https://github.com/open-mercato/open-mercato/issues/3757),
[#5640](https://github.com/open-mercato/open-mercato/pull/5640), and
[`.ai/specs/2026-08-07-sales-line-discount-amount-contract.md`](2026-08-07-sales-line-discount-amount-contract.md).
Verified against: `develop` @ `3076e5ccf` (2026-09-08). Line numbers are a convenience pinned to that
commit and drift; the symbol or command id beside each is the durable identifier.

## TLDR

Core's sales module is authoritative over money: a line's net is derived from `unitPriceNet × quantity`
minus the discount, and a document's header totals are derived from its lines. A caller that **mirrors**
documents already priced, rounded and taxed in an external book of record cannot transmit either figure —
both are recomputed over on every write, and there is no shape for a line whose net is *above*
`unitPrice × quantity`.

This spec proposes one opt-in, **persisted** mode — `sales_orders.totals_mode` and
`sales_order_lines.amounts_mode`, each `computed` (default) | `external` — under which the caller's
amounts are stored and served verbatim, and no recalculation path can move them — including the two
extension registries, which keep running but have the caller's amounts re-applied after them. It is
deliberately
**not** "honour a supplied `totalNetAmount`": that was #5644's option 1 and it was not taken, correctly,
because it freezes exactly the legacy rows #5640 heals. The distinguishing property here is that the
caller's authority is explicit and persisted, so recalculation can tell *a stored value that must be
healed* from *a stored value that is the truth*.

Zero behaviour change for any caller that never sets the mode. One default-valued column per table, no
backfill.

## Overview

Two questions need maintainer sign-off before an implementation PR exists, because both add a persisted
contract surface: whether the mode is worth a column at all (§ Proposed Solution 1), and what a command
that would rewrite an external document's header must do (§ Proposed Solution 6). Everything else follows
mechanically.

This is spec-only, on the same route
[`2026-08-07-sales-line-discount-amount-contract.md`](2026-08-07-sales-line-discount-amount-contract.md)
took: the contract is agreed first, the code follows in a separate change.

## Problem Statement

### What core owns today

`buildBaseLineResult` (`lib/calculations.ts:118`) derives a line's net from its own columns and nothing
else:

```ts
const netSubtotalBeforeDiscount = toNumber(unitNet, 0) * quantity          // :126
const discountTotal = Math.min(
  Math.max(resolveLineDiscountTotal(line, netSubtotalBeforeDiscount, quantity), 0),
  netSubtotalBeforeDiscount,                                               // :127-130
)
const netSubtotal = Math.max(netSubtotalBeforeDiscount - discountTotal, 0) // :131
```

`line.totalNetAmount` is never read. `line.totalGrossAmount`, by contrast, **is** honoured verbatim
(`:168-171`) — the asymmetry #5644 opened and #5853 still carries.

`buildBaseDocumentResult` (`:192`) then derives the header from the line *results*:

```ts
for (const line of lines) {
  subtotalNet += toNumber(line.netAmount, 0)                               // :213-222
  subtotalGross += toNumber(line.grossAmount, 0)
  discountTotal += toNumber(line.discountAmount, 0)
  taxTotal += toNumber(line.taxAmount, 0)
}
```

`applyOrderTotals` (`commands/documents.ts:3653`) writes **only** from `calculation.totals` onto the order
header; there is no branch anywhere that reads a caller-supplied header total for an order or a quote.

Every command that touches one line recalculates the whole document and re-persists every line:
`sales.orders.lines.upsert` builds `calcLines` from *all* the order's lines (`documents.ts:7297-7300`),
calls `calculateDocumentTotals` (`:7314`), then `applyOrderLineResults` (`:3230`) rewrites each row from
the result via `convertLineCalculationToEntityInput` (`:3142`) — `totalNetAmount: lineResult.netAmount`
at `:3185`, `totalGrossAmount: lineResult.grossAmount` at `:3186`. A persisted line re-enters calculation
through `mapPersistedLine` (`lib/lineSnapshots.ts:14`), rebuilt from its columns.

This is correct for a system that **composes** orders. It is wrong for one that **mirrors** orders whose
figures are the legally filed ones.

### Three consequences for a mirroring caller

1. **The line net cannot be transmitted.** A source that authors prices in gross stores a 2-decimal unit
   net which, multiplied by quantity, does not reproduce its own line net. The caller knows the true net
   and has nowhere to put it: `totalNetAmount` is accepted and validated (`data/validators.ts:349`) and
   then never read, and since #5640 a non-zero `discountPercent` takes precedence over any supplied
   `discountAmount` (`lib/calculations.ts:102-105`), so the amount channel is not available either.

2. **The header cannot be transmitted either.** Where the source rounds VAT per rate group, its own header
   net legitimately differs from the sum of its lines. `orderCreateSchema` *accepts* the header fields —
   `orderTotalsSchema.shape` is spread in at `data/validators.ts:731`, `quoteTotalsSchema.shape` at `:776`
   — and every write path then discards them and rewrites the header from the rollup. The difference is
   unrepresentable **regardless of how well the lines are fixed**. This is the same validated-then-ignored
   shape as #5644, one level up.

3. **Markups are unrepresentable.** `discountAmount` is `decimal({ min: 0 })` (`data/validators.ts:342`)
   and the engine clamps the resolved discount with `Math.max(…, 0)` (`lib/calculations.ts:128`), so a line
   whose net is *above* `unitPrice × quantity` — upward source rounding, a surcharge priced into the line —
   has no shape at either layer.

### How often this bites

Measured on one production-scale mirror of a several-million-line order history:

| observation | proportion |
|---|---:|
| lines where the derived line net differs from the source's | ~7% of all lines |
| the same, restricted to discounted lines | ~93% of discounted lines |
| orders where the source's own header net differs from the sum of its own lines | ~23% of orders |

Differences are typically one minor unit, occasionally larger. The structural point, not the magnitude, is
the argument: a difference of one minor unit on a legally filed document is a reconciliation failure, and
no amount of rounding-mode tuning closes a gap that the source deliberately introduced.

### Core already has caller-asserted amounts — on invoices

This is not a new principle for the module, only a new place to apply it. `sales.invoices.create`
(`commands/documents.ts:8977`) writes the header straight from request input:

```ts
subtotalNetAmount: toNumericString(parsed.subtotalNetAmount ?? 0),        // :9042
grandTotalNetAmount: toNumericString(parsed.grandTotalNetAmount ?? 0),    // :9046
```

`sales.invoices.update` (`:9256`), `sales.credit_memos.create` (`:9628`, `:9631`) and
`sales.credit_memos.update` (`:9802`) do the same. The discount contract's D1 records the matching
line-level position: `sales_invoice_lines.discount_amount` is *"caller-asserted and unenforced"* and stays
outside its normative contract.

So core already ships a document kind whose amounts belong to the caller. What it lacks is a way to say so
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

- The line calculation is a pure function of one `SalesLineSnapshot` (`lib/calculations.ts:118`) with no
  document in scope. The snapshot is the only channel through which the engine can learn a line is
  external, and `mapPersistedLine` (`lib/lineSnapshots.ts:14`) is handed a line entity alone. A
  document-only mode would have to be fetched through a relation inside the mapper.
- A line-only mode cannot express the per-rate-group rounding difference, which exists only at the header.

The redundancy is real and is the cost of this shape. It is paid for by an invariant and a guard test:

> **Invariant.** `sales_orders.totals_mode = 'external'` **iff** every one of that order's lines has
> `amounts_mode = 'external'`. Mixed documents are rejected at the command layer.

Enforced in commands, not as a database constraint — a cross-table `CHECK` is not expressible and a trigger
would put document math outside `salesCalculationService`, against
`packages/core/src/modules/sales/AGENTS.md` rule 1.

**Quotes are deliberately excluded.** `sales_quotes` / `sales_quote_lines` get no column and
`quoteCreateSchema` gets no field: a quote is core *composing* a proposal, not mirroring a book of record.
The type and engine changes below are shared, so adding quotes later is one column and one optional schema
field — purely additive. Invoices and credit memos are excluded because they already behave this way
(§ Problem Statement → *Core already has caller-asserted amounts*); making their caller-asserted amounts
explicit is worthwhile and is separate work.

### 2. `amountsMode` on the snapshot — a third, orthogonal signal

`SalesLineSnapshot` already carries two fields that look adjacent and are not:

| field | question it answers | set by |
|---|---|---|
| `discountAmountBasis` (`lib/types.ts:66`) | *how* to read a supplied `discountAmount` — per unit or per line | callers only |
| `discountAmountFromStoredRow` (`:72`) | *where* the discount came from — a request or a persisted row | mappers only |
| `totalsFromStoredRow` (`:84`) | *where* the net and gross came from — same question, different field, added by #5707 | mappers only |
| **`amountsMode`** (new) | *who is authoritative* for this line's amounts | callers and mappers |

Three of these already exist, and the third is the precedent: #5707 needed an origin signal for the totals
and **added its own field rather than reusing the discount's**, because `lib/lineSnapshots.ts:33-38` is
emphatic that a mapper must not answer one origin question with the other's. `amountsMode` is the same
discipline applied once more — it is not an origin signal, and none of the other three is an authority
signal. Unlike the others, it **is** legitimately set by both producers: a caller declares it on create,
and `mapPersistedLine` reads it back off the column.

```ts
// packages/core/src/modules/sales/lib/types.ts
export type SalesAmountsMode = 'computed' | 'external'

export type SalesLineSnapshot = {
  // …
  /**
   * Who owns this line's amounts. `external` means the supplied net, gross and
   * tax are the caller's assertion: the engine returns them verbatim and never
   * derives them from unit price, quantity or discount. Omitted means
   * 'computed', which is the only behaviour the engine has ever had.
   */
  amountsMode?: SalesAmountsMode | null
}
```

Additive optional field on a public type → ADDITIVE-ONLY under `BACKWARD_COMPATIBILITY.md` § 2.

### 3. Line calculation under `external`

`buildBaseLineResult` gains one early branch, before any derivation:

```
if line.amountsMode === 'external':
    netAmount   = line.totalNetAmount
    grossAmount = line.totalGrossAmount
    taxAmount   = line.taxAmount
    discountAmount = round(unitPriceNet × quantity − totalNetAmount)   # derived, signed
    return
```

Three properties of that block are load-bearing.

**No clamp.** The `Math.max(…, 0)` at `:128` and the `Math.min(…, netSubtotalBeforeDiscount)` at `:127` do
not run, so a line net *above* `unitPrice × quantity` is expressible. The markup arrives as a **negative
derived `discountAmount`**, which the `numeric(18,4)` column holds without a schema change.

**No validator change for the markup.** `discountAmount: decimal({ min: 0 })` (`data/validators.ts:342`)
constrains a *caller input*, and under `external` the caller does not supply `discountAmount` — it is
derived from the net it did supply. The `min: 0` bound therefore stays exactly as it is. This is a
deliberate improvement on the obvious fix of relaxing the bound, which would also loosen the computed path.

**`discountAmount` stays derived** rather than becoming a fourth supplied field, so an items table that
renders both a percent and an amount keeps agreeing with itself, and the document rollup keeps summing a
quantity-inclusive line total exactly as D1 fixed it.

**Registered line calculators still run, and cannot move the amounts.** `calculateLine` (`:359`) runs
`buildBaseLineResult` first (`:361`), then the `sales.line.calculate.before` event, then the hook registry
(`:375-378`), then `.after`. Substituting at the first stage only would leave any later stage free to
overwrite the caller's figures, so `calculateLine` **re-applies** an external line's supplied `netAmount`,
`grossAmount` and `taxAmount` after the registry, immediately before returning.

That is not a new pattern: `calculateDocument` already does exactly this for `paidTotalAmount` /
`refundedTotalAmount` (`:456-467`), for exactly this reason — *"Totals calculators rebuild the document
result from lines+adjustments and would otherwise reset paid/refunded to 0"* (`:450-455`). Authoritative
inputs are re-applied last. A supplied amount under `external` is an authoritative input by definition.

Hooks keep running, so the extension point `BACKWARD_COMPATIBILITY.md` treats as stable is not silently
disabled, and a hook may still attach line-level `adjustments`. It simply cannot change what the caller
asserted. § Decision Requested question 3 asks whether that is the right trade against commercetools'
blunter *"Cart Discounts are deactivated for Line Items with this price mode"*.

### 4. Document totals under `external`

The supplied header reaches the engine through two additive fields on `CalculateDocumentOptions`
(`lib/types.ts:175`), which today has no channel for it at all:

```ts
export type CalculateDocumentOptions = {
  // …
  totalsMode?: SalesAmountsMode | null
  suppliedTotals?: Partial<SalesDocumentAmounts> | null
}
```

`buildBaseDocumentResult` (`:192`) then takes the supplied header instead of the line rollup, for every
field `orderTotalsSchema` (`data/validators.ts:662`) already accepts: `subtotalNetAmount`,
`subtotalGrossAmount`, `discountTotalAmount`, `taxTotalAmount`, `shippingNetAmount`,
`shippingGrossAmount`, `surchargeTotalAmount`, `grandTotalNetAmount`, `grandTotalGrossAmount`.

**Substituting there is necessary and not sufficient**, because a totals calculator runs afterwards and
rebuilds the header from scratch. Core registers one itself, and it arrives by import rather than by call:
`lib/providers/index.ts:5` runs `ensureProviderTotalsCalculator()` (`lib/providers/totals.ts:179`) at
module-evaluation time. Two independent paths evaluate that barrel:

- `packages/core/src/modules/sales/index.ts:2` — a bare `import './lib/providers'` in the **module entry
  point**, so loading the sales module at all registers the hook;
- `data/validators.ts:6` — a **value** import of `getPaymentProvider` / `getShippingProvider`, which
  `commands/documents.ts` pulls in transitively when it imports `orderLineCreateSchema` and friends
  (`:82-98`).

The type-only import at `commands/documents.ts:122-125` is *not* one of them — `import type` is erased and
triggers nothing. Worth stating, because it is the reference a grep for `lib/providers` in the command file
surfaces first, and it is the one that does not count.

So the hook at `lib/providers/totals.ts:183` is live on **every** order and quote write. Its first act
discards the base result entirely:

```ts
let working = rebuildDocumentResult({            // totals.ts:191
  documentKind, currencyCode: current.currencyCode, lines,
  adjustments: runningAdjustments, metadata: current.metadata,
})
```

`rebuildDocumentResult` (`calculations.ts:505`) calls `buildBaseDocumentResult` with lines and adjustments
only — there is no channel for supplied totals — and the hook returns `working` at `totals.ts:370`
whether or not a shipping or payment method is set. `calculateDocument` runs the registered totals
calculators after the base result (`:425-434`) and returns their output, which is what `applyOrderTotals`
persists. Left unaddressed, the caller's header is replaced by the sum of its lines before anything is
written, and acceptance criterion 3 cannot pass.

Two changes close it, and neither disables the registry:

1. **`calculateDocument` re-applies the supplied header after the totals-calculator stage**, in the same
   final block that already re-applies `paidTotalAmount` / `refundedTotalAmount` (`:456-467`) — today gated
   on `existingTotals`, extended to run whenever `totalsMode === 'external'`. `outstandingAmount` is then
   recomputed against the restored gross, exactly as that block already does. This is the belt: whatever a
   third-party calculator does, the caller's header is restored last.
2. **Core's own provider totals calculator returns `current` unchanged for an external document.** This is
   the braces, and it is a correctness point rather than a defensive one: the hook exists to generate
   shipping and payment *provider adjustments*, and generating an adjustment whose amount cannot move a
   header the caller already supplied would put a shipping charge on the document that is visible in the
   itemised breakdown and absent from the total.

Third-party totals calculators still run and may still append adjustments; they cannot move an external
header. A calculator that needs to must switch the document to `computed` first.

`paidTotalAmount`, `refundedTotalAmount` and `outstandingAmount` stay **core-owned** and derived, unchanged:
`outstandingAmount = max(grandTotalGross − paid + refunded, 0)` (`lib/calculations.ts:314`, re-applied at
`:456-467`; `commands/payments.ts:317` recomputes it from `order.grandTotalGrossAmount` and the payment
rows). Because payments derive outstanding from the *persisted* header gross and never re-derive the
header, **`sales.payments.*` needs no rule and no change at all** — under `external` it simply derives from
the caller's gross instead of core's.

Choosing `external` **requires** a complete specification: net, gross and tax on every line, and the header
totals on the document. Partial specification is not a mode. This mirrors commercetools' rule for
`TaxMode: ExternalAmount` — *"A Cart can be ordered only if the Cart and all Line Items, Custom Line Items,
and the Shipping Method have an external tax amount and rate set."*

### 5. Round trip

`mapPersistedLine` (`lib/lineSnapshots.ts:14`) reads `amounts_mode` off the column onto the snapshot, so
every rehydration is self-describing. Combined with § 3 and § 4:

- Recalculation triggered by a sibling line's write returns the external line's stored amounts unchanged.
- The persisted-totals reconciliation and the #5707 divergence warning skip external rows — structurally,
  because § 3's branch returns before `lib/calculations.ts:143` ever runs (§ Out of Scope).
- The read path needs no change at all: `sales.orders` single-row `GET` already serves persisted totals
  rather than recomputing, since *"fix(sales): serve persisted order totals on single-row GET (#5438)"*
  (`136748c73`) removed the display recalculation from `api/documents/factory.ts`.
  `recalculateOrderTotalsForDisplay` (`commands/returns.ts:176`) survives as an export with **no production
  caller** on `develop` @ `3076e5ccf`.

**This is the property that separates the proposal from every write-time-only variant.** A request flag can
make one write correct; only a persisted column survives the next write to a sibling row.

### 6. Every place that writes header totals, and its rule

Exhaustive at `3076e5ccf`. **Seventeen sites: sixteen command-layer writers, and one inside the calculation
engine** — the totals-calculator stage of § 4, which is not reachable by grepping the command files because
it is registered as a module side effect. The rule is one sentence, applied uniformly:

> A command that would rewrite an external document's header either **refuses**, or **leaves the header
> untouched** and records its own non-monetary effect. Nothing recomputes an external header implicitly.

**`commands/documents.ts` — recalculate-and-persist via `applyOrderTotals` (`:3641`) / `applyQuoteTotals` (`:3634`)**

| command | decl | writes at | rule under `external` |
|---|---:|---:|---|
| `sales.orders.create` | 5714 | 5990 | accepts `amountsMode: 'external'` + complete lines + header totals; incomplete input is a 4xx |
| `sales.orders.update` | 5470 | 5603 | if the request carries lines or totals it must carry **both**; a request carrying neither leaves the persisted header untouched |
| `sales.orders.lines.upsert` | 7076 | 7340 | **reject** unless the request also carries the document header totals — which today's schema cannot express, so § API Contracts widens it |
| `sales.orders.lines.delete` | 7396 | 7522 | **reject** unless the request also carries the document header totals — same schema widening |
| `sales.orders.adjustments.upsert` | 8047 | 8284 | **refuse** — an adjustment exists only to change money |
| `sales.orders.adjustments.delete` | 8341 | 8449 | **refuse** — same |
| `sales.quotes.create` | 4718 | 4960 | unchanged — quotes are always `computed` (§ 1) |
| `sales.quotes.update` | 5237 | 5380 | unchanged |
| `sales.quotes.lines.upsert` | 7578 | 7837 | unchanged |
| `sales.quotes.lines.delete` | 7893 | 7991 | unchanged |
| `sales.quotes.adjustments.upsert` | 8506 | 8741 | unchanged |
| `sales.quotes.adjustments.delete` | 8798 | 8905 | unchanged |

**`commands/documents.ts` — copies a header rather than deriving one**

| command | decl | writes at | rule |
|---|---:|---:|---|
| `sales.quotes.convert_to_order` | 6326 | 6500–6515 | copies the quote's persisted totals onto the new order without recalculating; the produced order is `computed`, because its source was |

**`commands/returns.ts` — recalculate-and-persist via the returns-local `applyOrderTotals` (`:121`)**

| site | enclosing symbol | reached from | rule under `external` |
|---:|---|---|---|
| 395 → `em.persist(order)` 397 | `reverseReturnEffects` (`:314`) | `sales.returns.create` (`:796`), `sales.returns.delete` (`:1027`) | record the return; **skip the header write** |
| 545 → `em.persist(order)` 547 | `restoreReturnEffects` (`:411`) | `sales.returns.create` (`:811`), `sales.returns.delete` (`:1085`) | same |
| 731 → `tx.persist(order)` 733 | `sales.returns.create` (`:571`) | — | same |

**Inside the engine — the seventeenth site**

| site | symbol | reached from | rule under `external` |
|---|---|---|---|
| `lib/providers/totals.ts:183`, rebuild at `:191`, returns at `:370` | the provider totals calculator, registered by `ensureProviderTotalsCalculator` (`:179`) via the `lib/providers/index.ts:5` module side effect | every order and quote write — the barrel is evaluated by `sales/index.ts:2` and by `data/validators.ts:6` (§ 4) | return `current` unchanged; and `calculateDocument` re-applies the supplied header after the whole registry regardless (§ 4) |

This one is the reason § 4 is written as belt *and* braces. Every other site in this section is a command
that can be guarded where it is called; this one is a hook installed by *importing a module*, so a guard
placed at any call site would miss it, and so would a review that only reads the command files.

`sales.returns.update` (`:859`) writes no header totals today and needs no rule.

A return against an external order still creates its return document, its line-level `return` adjustments
and its `returned_quantity` update — it simply does not rewrite the header. **This is the most surprising
rule in the spec and it is deliberate**: the header belongs to the source system, which issues its own
credit document and pushes the corrected header. Silently moving a legally filed total because core
computed a credit would be worse than leaving it. § Decision Requested question 2 offers the alternative
(refuse returns on external orders outright).

### 7. UI

`components/documents/DocumentTotals.tsx` and `components/documents/ItemsSection.tsx`, reached from
`backend/sales/orders/[id]/page.tsx` and `backend/sales/documents/[id]/page.tsx`:

- an "amounts from source" badge on the document header when `totals_mode = 'external'`, its label routed
  through `t('sales.documents.amountsExternal')` per the i18n rule;
- amount fields rendered read-only on an external document, since a write would be rejected anyway
  (§ 6) and a form that submits into a guaranteed 4xx is a defect;
- switching back to `computed` is an explicit, confirmed action (§ Proposed Solution 8), never a side
  effect of an edit.

Status colours use `{property}-status-{status}-{role}` tokens; no hardcoded Tailwind shades.

### 8. Leaving the mode, and what is not kept

Setting `amountsMode: 'computed'` on `sales.orders.update` flips the order and **all** its lines
(the § 1 invariant forbids the mixed state), runs `calculateDocumentTotals` normally, and rewrites the
header and every line from `unit_price_net`, `quantity` and `discount_*`.

**The switch is lossy and the spec does not pretend otherwise.** Two things change and neither is
recoverable:

- Every line net returns to `unitPriceNet × quantity − discount`, so the differences the mode existed to
  preserve are gone, and the header returns to the rollup.
- A markup line's negative derived `discount_amount` (§ 3) meets `Math.max(…, 0)` at
  `lib/calculations.ts:128` on the way back, so its discount clamps to `0` and its net **rises**.

The supplied values are **not** retained in shadow columns. A shadow copy is a second source of truth that
nothing reads and nothing keeps correct, and the caller's own book of record still holds the originals.
`totals_snapshot` (`data/entities.ts`, jsonb) holds the last calculation result and is overwritten like any
other derived field. The UI confirmation in § 7 is what makes the loss deliberate rather than accidental.

## Architecture

```
                  amountsMode: 'external'  (caller assertion, persisted)
                              │
DocumentLineCreateInput ──────┤
                              ▼
                     createLineSnapshotFromInput
                     lines.upsert payload build
                              │
                              ▼
                     ┌────────────────────┐
SalesOrderLine   ───▶│  SalesLineSnapshot │───▶ buildBaseLineResult (calculations.ts:118)
  via mapPersistedLine│  + amountsMode    │        │
  (lineSnapshots.ts:14)└────────────────────┘      ├─ external → net/gross/tax verbatim, no clamp (§3)
        ▲                                          └─ computed → today's derivation, unchanged
        │                                                   │
        │                                    line calculator registry (:334-337) — runs either way
        │                                                   │
        │                                    external → re-apply supplied amounts (§3)
        │                                                   ▼
        │                                          SalesLineCalculationResult
        │                                                   │
        ├──── persist (documents.ts:3185-3186) ◀────────────┤
        │                                                   ▼
        │                                       buildBaseDocumentResult (:151)
        │                                          ├─ external → supplied header (§4)
        │                                          └─ computed → line rollup, unchanged
        │                                                   │
        │                            totals calculator registry (:384-393) — runs either way
        │                            └─ provider hook (providers/totals.ts:183) no-ops if external
        │                                                   │
        │                            external → re-apply supplied header, recompute
        │                                       outstanding against it (:456-467)
        │                                                   │
        └──── applyOrderTotals ◀────────────────────────────┘
              documents.ts:3653 (12 sites) / returns.ts:121 (3 sites), all guarded per §6
```

The two `re-apply` stages are the load-bearing part, and they are why the seventeenth site in § 6 exists.
Substituting only at `buildBaseLineResult` / `buildBaseDocumentResult` leaves both registries free to
overwrite the caller's figures afterwards — and core installs a totals calculator into its own registry by
module side effect, so that is not a hypothetical third-party concern but the default path.

`salesCalculationService` remains the sole owner of document math (`sales/AGENTS.md` rule 1): the mode is
read inside the engine, and no call site recomputes anything inline. The command-layer guards in § 6 decide
whether a write is *permitted*, never what the numbers are.

## Data Models

Two new columns, each with a default. No backfill, no data migration.

| entity | column | definition |
|---|---|---|
| `SalesOrder` (`data/entities.ts:333`, table `sales_orders`) | `totals_mode` | `text NOT NULL DEFAULT 'computed'` |
| `SalesOrderLine` (`data/entities.ts:555`, table `sales_order_lines`) | `amounts_mode` | `text NOT NULL DEFAULT 'computed'` |

Declared in the style the module already uses for `kind` (`data/entities.ts:571`):

```ts
export type SalesAmountsMode = 'computed' | 'external'

@Property({ name: 'totals_mode', type: 'text', default: 'computed' })
totalsMode: SalesAmountsMode = 'computed'
```

Unchanged, and listed because § 3 depends on their existing shape:

| entity | column | definition (unchanged) |
|---|---|---|
| `SalesOrderLine` | `discount_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` (`:634`) — now signed on external rows |
| `SalesOrderLine` | `total_net_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` (`:646`) |
| `SalesOrderLine` | `total_gross_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` (`:649`) |
| `SalesOrder` | `grand_total_gross_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` |
| `SalesOrder` | `outstanding_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` — stays derived (§ 4) |

`numeric` is signed, so the markup case (§ 3) needs no type change.

The generated migration adds two `ALTER TABLE … ADD COLUMN … DEFAULT 'computed' NOT NULL` statements and
updates `packages/core/src/modules/sales/migrations/.snapshot-open-mercato.json`. Existing rows take the
default in place; PostgreSQL has not rewritten a table for a defaulted column add since 11.

## API Contracts

No route is added, removed or renamed. No response shape changes beyond two additive fields.

| route | methods | change |
|---|---|---|
| `/api/sales/orders` (`api/documents/factory.ts`) | `POST` `PUT` | accepts `amountsMode` on the document and on each line; header total fields, already accepted (`validators.ts:731`), become meaningful under `external` |
| `/api/sales/orders` | `GET` | responses gain `totalsMode` on the document and `amountsMode` on each line |
| `/api/sales/order-lines` (`api/order-lines/route.ts` → `sales.orders.lines.*`) | `POST` `PUT` `DELETE` | on an external order, requires the document header totals in the same request (§ 6); otherwise unchanged |
| `/api/sales/order-adjustments` → `sales.orders.adjustments.*` | `POST` `PUT` `DELETE` | refuses on an external order (§ 6) |
| `/api/sales/returns` → `sales.returns.*` | `POST` `DELETE` | succeeds on an external order; leaves the header untouched (§ 6) |
| `/api/sales/quotes`, `/api/sales/quote-lines` | all | unchanged |

Request schema additions — two in `data/validators.ts`:

```ts
// linePricingSchema (:332-351), spread into orderLineCreateSchema and its update partial
amountsMode: z.enum(['computed', 'external']).optional(),   // new; omitted ⇒ 'computed'

// orderCreateSchema (:687), alongside the existing ...orderTotalsSchema.shape (:731)
amountsMode: z.enum(['computed', 'external']).optional(),   // new; omitted ⇒ 'computed'
```

— and two in `commands/documents.ts`, without which § 6's rule for the line commands is one **no caller
can satisfy**. Neither schema can carry a header total today:

```ts
const orderLineUpsertSchema = orderLineCreateSchema.extend({   // :6781 — line fields only
  id: z.string().uuid().optional(),
})
const orderLineDeleteSchema = z.object({                        // :6785
  id: z.string().uuid(),
  orderId: z.string().uuid(),
})
```

Both gain the header totals as an optional group, required only when the target order is `external`:

```ts
const orderLineUpsertSchema = orderLineCreateSchema.extend({
  id: z.string().uuid().optional(),
  orderTotals: orderTotalsSchema.optional(),   // new; required iff the order is external
})
const orderLineDeleteSchema = z.object({
  id: z.string().uuid(),
  orderId: z.string().uuid(),
  orderTotals: orderTotalsSchema.optional(),   // new; required iff the order is external
})
```

A nested `orderTotals` object rather than spreading `orderTotalsSchema.shape` flat: a line command's own
payload already carries `totalNetAmount` and `totalGrossAmount` for the *line*, and flattening
document-level fields beside them would put two different meanings of "total" in one object.
`orderTotalsSchema` is currently module-private (`data/validators.ts:662`) and needs exporting.

`quoteLineUpsertSchema` / `quoteLineDeleteSchema` are unchanged — quotes stay `computed` (§ 1).

`linePricingSchema` is shared with `quoteLineCreateSchema`. Per § 1 quotes stay `computed`, so the quote
line commands must reject a supplied `amountsMode` rather than silently ignore it — silently ignoring an
accepted field is the exact failure #5644 exists to name.

Omitting the field reproduces today's behaviour exactly, so no existing caller changes.

New error keys, routed through i18n per the project rule:
`sales.errors.externalAmountsIncomplete`, `sales.errors.externalTotalsRequired`,
`sales.errors.externalAdjustmentRefused`, `sales.errors.externalModeMixed`.

## Migration & Backward Compatibility

Contract surfaces touched, classified per `BACKWARD_COMPATIBILITY.md`:

| surface | classification | note |
|---|---|---|
| `SalesLineSnapshot`, `SalesAmountsMode` (public types) | **ADDITIVE-ONLY** | one optional field; no deprecation bridge required |
| `CalculateDocumentOptions` (public type) | **ADDITIVE-ONLY** | two optional fields, `totalsMode` and `suppliedTotals` (§ 4) |
| `SalesTotalsCalculationHook` contract | **STABLE, unchanged signature** | the hook's *output* stops being final for an external document, because the supplied header is re-applied after the registry (§ 4). No third-party calculator has to change; one that deliberately moved an external header would stop being able to — see § Risks |
| Line and document validators | **ADDITIVE-ONLY** | optional field; omission = today's behaviour |
| `orderLineUpsertSchema`, `orderLineDeleteSchema` (`commands/documents.ts:6793`, `:6797`) | **ADDITIVE-ONLY** | one optional nested `orderTotals` group each |
| DB schema | **ADDITIVE-ONLY** | two new columns with defaults — explicitly permitted: *"MAY add new columns with defaults (non-breaking)"* (§ 8) |
| API routes / URLs | unchanged | — |
| API responses | **ADDITIVE-ONLY** | two new fields |
| Event ids, DI keys, ACL features, notification ids, CLI commands | unchanged | — |

**There is no behavioural break.** Every rule in § 6 is gated on `totals_mode = 'external'`, which no
existing row holds and no existing caller sets. That is stated as acceptance criterion 1 rather than left
as a hope.

Two consequences are worth an `UPGRADE_NOTES.md` line even so, because both are visible to code that never
opts in:

| what | who sees it |
|---|---|
| `sales_order_lines.discount_amount` can be **negative** on external rows | a third-party module or report that assumed the column is non-negative |
| `GET /api/sales/orders` responses gain `totalsMode` / `amountsMode` | a consumer with a strict response schema |

**The migration-cost objection, answered directly.** The discount contract's § Alternatives rejected its
variant D — a persisted assertion via a nullable column — *"on migration cost only"*, with
*"revisit only if § Proposed Solution 2's cost is judged unacceptable"*. This spec is that revisit,
generalised from one column to the document, and the cost objection does not carry across: D needed
`discount_amount` migrated to nullable **and** `0 → NULL` backfilled across every existing row, rewriting
data whose meaning was already ambiguous. This needs one default-valued column per table, no backfill, no
rewrite of any existing value, and no behaviour change for a caller that never sets it. The nullable-column
cost was the whole of the objection, and it is not incurred here.

## Prior Art

The shape is standard in platforms that must interoperate with an external book of record. Every source
below was opened and quoted verbatim.

### commercetools — the closest precedent

Authoritative by default, with an explicit, persisted opt-out at both levels. This is the same two-level
structure § 1 proposes, arrived at independently.

**`LineItemPriceMode`** ([type definition](https://github.com/commercetools/commercetools-api-reference/blob/be3dc3f9e725eef0c85f8e6084f096878d4a354c/api-specs/api/types/cart/LineItemPriceMode.raml),
rendered at [docs.commercetools.com/api/projects/carts](https://docs.commercetools.com/api/projects/carts#lineitempricemode)):

> `Platform`: The price is selected from the Product Variant. This is the default mode.
>
> `ExternalTotal`: The Line Item price with the total is set externally. Cart Discounts are deactivated for
> Line Items with this price mode […]. Although a Line Item with this price mode has both `price` and
> `totalPrice` set externally, only `totalPrice` is used to calculate the total price of a Cart.

Two things to take from it. The mode is a persisted enum on the line with `Platform` as the default —
§ 1's shape exactly. And *"Cart Discounts are deactivated"* is precedent for suppressing the platform's own
line-level extensions on an external line, which § 3 declines and § Decision Requested question 3 puts to
the maintainer.

**`TaxMode: ExternalAmount`** ([type definition](https://github.com/commercetools/commercetools-api-reference/blob/be3dc3f9e725eef0c85f8e6084f096878d4a354c/api-specs/api/types/cart/TaxMode.raml)):

> Tax amounts, Tax Rates, and tax portions are set externally with `ExternalTaxAmountDraft`. A Cart can be
> ordered only if the Cart **and all** Line Items, Custom Line Items, and the Shipping Method have an
> external tax amount and rate set.
>
> Price-affecting update actions on Carts require external recalculation of the total gross price. In these
> cases, `taxedPrice` and `taxRate` are removed and must be set again.

The first sentence is § 4's completeness requirement. The second is the same problem § Decision Requested
question 1 answers, resolved the other way — see there.

**`Set Cart Total Tax`** ([type definition](https://github.com/commercetools/commercetools-api-reference/blob/4c16ce73d5391802f2cf109581ac962749c027a5/api-specs/api/types/cart/updates/CartSetCartTotalTaxAction.raml)):

> Can be used if the Cart has the `ExternalAmount` `TaxMode`. This update action adds the `taxedPrice`
> field to the Cart. It sets the `totalGross` amount […]. **You must use this update action after any
> price-affecting change occurs within the Cart.**
>
> `externalTaxPortions?` — Set if the `externalTotalGross` price is a sum of portions with different tax
> rates.

A header total supplied separately from the lines, carrying per-rate portions, precisely because the two do
not have to agree. That is § Problem Statement consequence 2 as a shipped API.

And, from the tax-integration guide
([docs.commercetools.com/tutorials/tax-integration](https://docs.commercetools.com/tutorials/tax-integration)):

> **To eliminate any possible rounding discrepancies between the commercetools Cart and the tax provider
> reporting, we recommend that you use `ExternalAmount`.**

A platform that owns money by default recommends its external mode *specifically* for the rounding problem
this spec opens with.

### Shopify and Saleor — the ceiling

Import-first paths that take supplied amounts as facts with no mode at all.

Shopify's `orderCreate`
([shopify.dev](https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCreate)):

> Use the `orderCreate` mutation to programmatically generate orders in scenarios where orders aren't
> created through the standard checkout process, such as when importing orders from an external system or
> creating orders for wholesale customers.

Saleor's `orderBulkCreate`
([docs.saleor.io](https://docs.saleor.io/developer/bulks/bulk-orders)):

> `totalPrice` and `undiscountedTotalPrice` are the primary sources of truth about the order pricing. Based
> on the fields, Saleor calculates unit price, undiscounted unit price, unit discount amount, order total
> and subtotal.
>
> […] it doesn't trigger any price recalculation. Prices are based only on line totals.

Saleor **inverts** core's derivation: the totals are the input and the unit price is derived. These set the
ceiling, not the target — platforms that import give up derivation entirely. This proposal asks for far
less: derivation stays the default and stays untouched for every caller that does not opt out.

### Odoo — the cautionary case

A bill's tax total can be edited to match the supplier's paper document. The field is
`account.move.tax_totals`
([`addons/account/models/account_move.py`, tag `18.0`](https://github.com/odoo/odoo/blob/18.0/addons/account/models/account_move.py)):

```python
tax_totals = fields.Binary(
    string="Invoice Totals",
    compute='_compute_tax_totals',
    inverse='_inverse_tax_totals',
    help='Edit Tax amounts if you encounter rounding issues.',
    exportable=False,
)
```

The help text names this spec's problem exactly. But the field is **computed**, and the edit is not stored
as an assertion: `_inverse_tax_totals` pushes the delta back onto a tax line
(`first_tax_line.amount_currency -= delta_amount * sign`) and then calls `self._compute_amount()`. Nothing
on the record says "these amounts are the supplier's", so the next recomputation from the lines governs.

That is the failure mode of **every write-time-only variant**, including the discount contract's
Alternative E, and it is why § Proposed Solution 1 insists on a persisted column rather than a request
flag.

## Out of Scope

**#5644 option 1 — "honour a supplied `totalNetAmount`" — is not being asked for, and must not be.**
#5644 offered three directions; option 1 was not taken; #5707 implemented option 3, validate-and-warn, and merged on 2026-09-08.
Honouring a supplied net *by default* would freeze exactly the legacy rows the discount contract heals on
recalculation (`.ai/specs/2026-08-07-…` § Row reconciliation). That objection is correct. Under this
proposal a supplied net is honoured **only** on a row that carries an explicit, persisted `external` mode;
every `computed` row keeps recalculating and keeps healing.

**The discount contract's Alternative E is not being reopened.** D4 declined it on the grounds that
precedence would key off a field's *presence* rather than its value, and recorded that it stays adoptable
later as a purely additive change. Nothing here depends on it or revisits it. E is also, on its own merits,
insufficient for this problem: it is write-time only, so the next write to a sibling line recalculates from
the stored percent and overwrites the value — the Odoo failure above.

**#5853 is referenced, not decided.** Whether a caller-supplied `totalGrossAmount` should keep being
honoured verbatim on the `computed` path stays open. One observation, offered as input rather than as an
answer: today's net/gross asymmetry (`lib/calculations.ts:168-171` honours gross, nothing honours net) is
an argument for a single explicit mode over per-field verbatim rules, because under `external` net and
gross are symmetric by construction and there is no asymmetry left to justify.

**The #5707 divergence warning must skip external rows**, and that is not a hole. The warning exists to
catch *implicit* divergence — a caller that supplied a net and had it silently recomputed. Under `external`
the supplied net is not recomputed, so there is nothing to diverge from; the mode is the caller's explicit,
persisted assertion, which is strictly more information than the warning was built to recover. #5707's
`totalsFromStoredRow` flag answers an *origin* question and must not be overloaded to answer this
*authority* one — the same separation `lib/lineSnapshots.ts:33-38` already insists on, and § 2 restates.

**#5707 merged on 2026-09-08** (`5f3843eb7`), which settles the landing order an earlier revision of this
spec had to hedge. The warning now lives inside `buildBaseLineResult` at `lib/calculations.ts:143-163`,
gated on `line.totalsFromStoredRow !== true`, with a half-minor-unit
`NET_RECONCILIATION_TOLERANCE` (`:33`).

Nothing further is needed to suppress it: § 3's external branch returns at the **top** of
`buildBaseLineResult`, before `:143`, so an external line never reaches the reconciliation at all. The
suppression is structural rather than a second gate someone has to remember to add — and it is the reason
§ 3 specifies an early return rather than a late override.

**Quotes, invoices and credit memos** — see § 1.

## Alternatives Considered

| option | effect | verdict |
|---|---|---|
| **A. Persisted mode columns on document and line** (this spec) | caller authority survives every sibling write; no behaviour change without opt-in; two defaulted columns | **chosen** |
| B. Honour a supplied `totalNetAmount` unconditionally (#5644 option 1) | no new column, no new field | rejected — freezes legacy rows the discount contract heals; explicitly not taken upstream |
| C. A per-request flag (`amountsMode` on the input only, nothing persisted) | no migration at all | rejected — the next write to any sibling line recalculates the whole document and overwrites it. This is the Odoo `_inverse_tax_totals` failure, verbatim |
| D. Document-level mode only | one column instead of two | rejected — the line calculation is a pure function of one `SalesLineSnapshot` with no document in scope (`calculations.ts:118`), and `mapPersistedLine` is handed a line entity alone. The mode would have to be reached through a relation inside the mapper |
| E. Line-level mode only | one column instead of two | rejected — cannot express a header that legitimately differs from the sum of its lines, which is ~23% of orders in the measurement above and the harder half of the problem |
| F. Shadow columns retaining the caller's values through a switch back to `computed` | switching back is reversible | rejected — a second source of truth that nothing reads and nothing keeps correct; the caller's book of record already holds the originals (§ 8) |
| G. A separate "mirrored document" entity alongside `sales_orders` | perfect isolation | rejected — duplicates the whole document surface (lines, adjustments, returns, payments, shipments, UI, search, exports) to change how nine numeric columns are populated |

## Acceptance Criteria

1. **Compatibility, stated as a criterion rather than a hope.** For every existing test and every caller
   that never sends `amountsMode`, output is byte-identical before and after: the same stored line
   amounts, the same header totals, the same response payloads. A migration that only adds defaulted
   columns and a code path gated on a value no existing row holds must be observably inert.
2. **Round trip.** Writing one line of an external order via `sales.orders.lines.upsert` leaves **every
   other line byte-identical** — including a line whose net differs from `unitPriceNet × quantity`, which
   is the case the property exists for.
3. **Header preservation.** After a create with a header net that differs from the sum of the supplied line
   nets, the persisted header is the supplied one, and it is still the supplied one after a sibling line
   write, a return create, and a return delete.
3a. **Header preservation survives the registries**, which criterion 3 alone does not prove. Two cases,
   both required: with core's provider totals calculator live — that is, with `commands/documents.ts`
   imported normally, so `providers/index.ts:5` has run — an external create persists the supplied header
   and not the line rollup; and with an additional test-registered totals calculator that returns a
   deliberately wrong header, the persisted header is *still* the supplied one. The second case is what
   distinguishes "we stopped our own hook" from "the supplied header is re-applied last", and only the
   latter is what § 4 claims. The same pair at line level for `registerSalesLineCalculator`.
4. **Markup.** A line with `totalNetAmount > unitPriceNet × quantity` round-trips exactly, and its derived
   `discount_amount` is negative. Covered explicitly, not incidentally — no clamp, at either the validator
   or the engine.
5. **Completeness is enforced.** `amountsMode: 'external'` without a net, gross or tax on some line, or
   without the header totals on the document, is a 4xx naming the missing field. Partial specification is
   not a mode.
6. **No mixed documents.** The § 1 invariant holds: an external order has no computed line, a computed
   order has no external line, in both directions, on create and on update.
7. **All seventeen sites covered.** The twelve `documents.ts` writers, the `convert_to_order` copy, the
   three `returns.ts` writers, and the provider totals calculator each behave per its § 6 row. A change
   covering `documents.ts` only would satisfy criteria 1–6 while leaving the return flows rewriting
   external headers — the exact shape of defect the discount contract's D6 exists to prevent — and a change
   covering all sixteen *command* sites would still fail criterion 3a, because the seventeenth is installed
   by importing a module rather than by being called.
8. **Payments are untouched.** Recording, updating and deleting a payment against an external order changes
   `paid`, `refunded` and `outstanding` and nothing else; `outstanding` derives from the caller's
   `grand_total_gross_amount`.
9. **Adjustments refuse** on an external order, with an i18n-routed error, and the document is unchanged
   afterwards.
10. **Returns record without rewriting.** Creating and deleting a return against an external order updates
    `returned_quantity` and the return document, and leaves the order header byte-identical to its
    pre-return values.
11. **Switch-back is explicit and complete.** Setting `computed` on an external order flips every line,
    recomputes header and lines, and is never triggered as a side effect of any other write.
12. **The #5707 warning does not fire for an external line** — asserted against the logger, not assumed
    from code reading, since the suppression is positional (§ Out of Scope). And `amountsMode` is never
    conflated with `totalsFromStoredRow`, `discountAmountFromStoredRow` or `discountAmountBasis` — no
    producer sets one to mean another (§ 2).
13. **No `any`, no hardcoded user-facing strings, no hardcoded status colours** in the UI of § 7.

## Testing Strategy

Unit — `packages/core/src/modules/sales/lib/__tests__/calculations.test.ts`:

- external line returns supplied net/gross/tax verbatim across a table of
  `(quantity, unitPriceNet, discountPercent, discountAmount, totalNetAmount)` cases, including ones where
  every derivation would produce a different answer;
- the markup case, asserting the negative derived `discountAmount` and the absence of both clamps;
- idempotency: `calculate(calculate(x)) === calculate(x)` for external lines, the same property the
  discount contract pinned for computed ones;
- a document whose supplied header differs from the sum of its supplied lines keeps the supplied header;
- `computed` behaviour unchanged — the existing suite passes untouched, which is criterion 1.

Unit — the registry stages, which is where criterion 3a lives and where the first draft of this spec was
wrong. Both need a *registered* calculator, not a mocked one:

- with a totals calculator registered via `registerSalesTotalsCalculator` that returns a deliberately wrong
  header, `calculateDocumentTotals` on an external document still returns the supplied header, and
  `outstandingAmount` is recomputed against the restored gross;
- the same for `registerSalesLineCalculator` and an external line;
- core's provider totals calculator (`lib/providers/totals.ts:183`) returns `current` unchanged for an
  external document and generates no provider adjustment, with a shipping and a payment method set — the
  case where it otherwise would.

Unit — `lib/__tests__/lineSnapshots.test.ts`: `mapPersistedLine` carries `amounts_mode` and sets no other
origin field; the § 2 separation invariant.

Command — `commands/__tests__/`: one case per § 6 row. The three `returns.ts` sites need their own cases;
they are not reachable from the `documents.ts` command tests.

Integration — `packages/core/src/modules/sales/__integration__/`, self-contained per `.ai/qa/AGENTS.md`
(fixtures created in setup, cleaned up in teardown, no reliance on seeded data): create an external order
over `POST /api/sales/orders` with a header that disagrees with its lines, read it back over
`GET /api/sales/orders?id=…`, upsert one line, read back and assert every sibling is unchanged; then a
return create/delete cycle asserting the header is untouched; then the switch back to `computed`.

## Risks & Impact Review

| risk | severity | affected | mitigation | residual |
|---|---|---|---|---|
| **Core's own totals calculator rebuilds the header from the line rollup after the base result** (`lib/providers/totals.ts:191`, returning at `:370`), registered by a module side effect (`providers/index.ts:5`) that fires from both `sales/index.ts:2` and `data/validators.ts:6` | **high** | **every** external document, not a subset — this is the default path, not a deployment-specific one | § 4's two changes: the provider hook no-ops for external documents, and `calculateDocument` re-applies the supplied header after the whole registry (`:456-467`); § 6 lists it as the seventeenth site; criterion 3a pins it | none once both land. Missing only the first would leave a third-party calculator able to clobber; missing only the second would leave core's own hook doing it |
| A registered line calculator (`calculations.ts:375-378`) mutates an external line | medium | deployments with custom line calculators | § 3 re-applies the supplied line amounts after the registry, the same way § 4 does for the header; criterion 2 pins the round trip | a hook's work on an external line's amounts is silently discarded rather than silently applied — the safer direction, but still silent. § Decision Requested q3 asks whether skipping the registry outright would be more honest |
| A third-party totals calculator that deliberately moved an external document's header stops being able to | low | third-party modules | § 4 states the rule; the documented escape is to switch the document to `computed` first | a calculator written against a mode that does not exist yet cannot regress; the risk is only for code written after this ships |
| A return moves no header total on an external order, surprising an operator | **high** | any external-mode deployment that takes returns | § 6 states the rule; § 7's badge marks the document; criterion 10 pins it | intended, and the rule most likely to be overruled — see § Decision Requested q2 |
| A caller opts in with incomplete data and gets a 4xx it did not expect | medium | new integrations | § 4 completeness rule; criterion 5 requires the error to name the missing field | a stricter contract than the `computed` path, deliberately |
| Switching back to `computed` silently changes a legally filed total | medium | operators who use the switch | § 8 makes the loss explicit; § 7 requires a confirmation; criterion 11 forbids implicit switches | unrecoverable by design; the source system holds the originals |
| A third-party module or report reads `discount_amount` assuming non-negative | medium | third-party modules, custom reports | `UPGRADE_NOTES.md` entry; only occurs on rows a caller explicitly opted in | a report that sums the column across mixed rows understates the discount total |
| Two orthogonal mode-ish flags (`amountsMode`, `totalsFromStoredRow`) get conflated during implementation | medium | core | § 2's three-field table; criterion 12; the precedent comment at `lineSnapshots.ts:33-38` | the discount contract already lost a draft to exactly this conflation |
| The § 1 invariant is enforced in commands only, so a direct DB write can produce a mixed document | low | direct SQL, seeds | criterion 6 covers the command layer; the engine treats an unknown/absent mode as `computed`, so a mixed row degrades to today's behaviour rather than to nonsense | a direct writer can still create a document whose header and lines disagree — as it can today |
| Seventeen guard sites, one missed | low | core | § 6 enumerates all of them by `file:line`; criterion 7 names the returns flows and the engine-side hook specifically. The seventeenth was itself missed by this spec's first draft, which is the evidence that grepping the command files is not a sufficient method here | — |

Contract-surface classification: see § Migration & Backward Compatibility.

## Final Compliance Report

- No cross-tenant exposure: every touched command already carries `{ tenantId, organizationId }` and every
  read stays inside the existing scoped `findWithDecryption` calls. The new columns are not scope-bearing.
- No direct cross-module ORM relations introduced; no new module dependency.
- Document math stays inside `salesCalculationService` (`packages/core/src/modules/sales/AGENTS.md`
  rule 1) — the mode is read inside the engine and no call site recomputes inline.
- No `any`; `SalesAmountsMode` is a union and the validators are `z.enum`, with types derived via
  `z.infer`.
- All new user-facing strings routed through locale files; error keys listed in § API Contracts.
- Two new columns → `yarn db:generate` produces one migration per affected module plus the
  `.snapshot-open-mercato.json` update; no `yarn db:migrate` is run as part of preparing the change.
- No generated registry changes, so no `yarn generate` run is required beyond the migration step.

## Decision Requested

Three questions need a maintainer answer before an implementation PR exists. Each changes what the code has
to do; none can be deferred to review.

| # | decision | if rejected |
|---|---|---|
| 1 | **Persisted columns at all** (§ Proposed Solution 1) — two defaulted `text` columns, no backfill | § Alternatives C, a request-only flag — which the Odoo precedent shows does not survive a sibling write, so rejecting 1 is effectively rejecting the feature |
| 2 | **A return on an external order records itself and leaves the header untouched** (§ 6) | refuse `sales.returns.create` / `sales.returns.delete` outright on an external order, and require the caller to mirror the credit document instead. Cleaner rule, blocks a real workflow |
| 3 | **Both registries still run on an external row, and the supplied amounts are re-applied afterwards** (§ 3, § 4) — the extension points stay live, but a hook cannot move a caller-asserted amount | suppress the registries for external rows outright, as commercetools does — *"Cart Discounts are deactivated for Line Items with this price mode"*. Same end state for the numbers; more honest, because a hook that cannot affect anything does not run at all, rather than running and having its output discarded. The cost is that a hook doing non-amount work on external rows (attaching an adjustment, writing metadata) stops running too |

Question 1 additionally has a scope sub-question worth answering explicitly rather than rediscovering at
implementation time: § 1 excludes quotes. If the maintainers would rather have symmetry now, it is one more
column pair and one more schema field, and the § 6 quote rows change from *unchanged* to mirrors of the
order rows.

On question 2 there is a third possibility this spec does not recommend but records: commercetools
*invalidates* rather than refusing — *"`taxedPrice` and `taxRate` are removed and must be set again"*. That
works for a cart, which is not yet an order and can sit un-orderable. An order that has already been placed
has no equivalent state, and a header total that is transiently absent on a legally filed document is worse
than either alternative above. Hence reject-or-preserve, not invalidate.

## Decision Record

*Empty pending maintainer sign-off. Record decisions here in the style of
[`2026-08-07-sales-line-discount-amount-contract.md`](2026-08-07-sales-line-discount-amount-contract.md)
§ Decision Record: one subsection per decision, stating what was decided, what follows from it for the
implementation, and what it leaves open.*

## Implementation Plan

Deliberately absent. As with the discount contract, no implementation plan exists until § Decision
Requested is answered — the three decisions change the shape of the change, not just its details.

## Changelog

### 2026-09-08 (later)

- Rebased onto `develop` @ `3076e5ccf` and re-verified every citation against it. #5707 merged in the
  meantime (`5f3843eb7`), moving `lib/calculations.ts` by 41 lines, `commands/documents.ts` by 12–14,
  `lib/types.ts` by 9 and `lib/lineSnapshots.ts` by 23, so every line number in this spec was restated.
- #5707 having landed settles what an earlier revision had to hedge as a landing-order dependency: the
  reconciliation warning now sits at `lib/calculations.ts:143-163` behind `totalsFromStoredRow`, and § 3's
  early return means an external line never reaches it. No second gate is needed, and § Out of Scope says
  so instead of describing two possible futures.
- § 2's orthogonal-signals table gains `totalsFromStoredRow` (`lib/types.ts:84`) as a fourth row. It is
  now the strongest argument in that section: faced with the same question, #5707 added its own origin
  field rather than reusing the discount's.

### 2026-09-08

- Added the totals-calculator stage as the seventeenth site in § 6. Core registers its own totals
  calculator by module side effect (`lib/providers/index.ts:5` → `lib/providers/totals.ts:183`); it
  rebuilds the header from the line rollup (`:191`) and returns it (`:370`), so honouring the supplied
  header in `buildBaseDocumentResult` alone would have been overwritten before anything persisted.
  § 4 now re-applies the supplied header after the whole registry, following the precedent
  `calculateDocument` already sets for paid/refunded (`calculations.ts:456-467`), and core's provider hook
  no-ops for external documents. § 3 gains the same re-application at line level, which also sharpens
  § Decision Requested question 3.
- Specified the channel the supplied header reaches the engine through: `totalsMode` and `suppliedTotals`
  on `CalculateDocumentOptions`. It had no channel before, which § 4 had left implicit.
- § API Contracts now widens `orderLineUpsertSchema` (`commands/documents.ts:6793`) and
  `orderLineDeleteSchema` (`:6797`) with an optional nested `orderTotals` group. Without it § 6's rule for
  the line commands was one no caller could satisfy.
- Added acceptance criterion 3a and the matching registry tests; updated criterion 7 and the § Risks table.

### 2026-09-07

- Initial proposal. Verified against `develop` @ `19bf96975`.
