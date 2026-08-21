# Sales line `discount_amount` — a single, idempotent contract

Status: draft — design decision requested
Scope: `packages/core/src/modules/sales/{lib/calculations.ts,lib/types.ts,commands/documents.ts,commands/returns.ts,data/validators.ts}`
Tracking: [#5019](https://github.com/open-mercato/open-mercato/issues/5019); related display-only PR [#5006](https://github.com/open-mercato/open-mercato/pull/5006)
Verified against: `develop` @ `33a7d00c4` (2026-08-21). Line numbers are a convenience pinned to that
commit and drift; the symbol or command id beside each is the durable identifier.

## TLDR

`discount_amount` on sales order/quote lines is **read as a per-unit amount and written as a
line-total amount, through the same column**. Every recalculation round trip therefore multiplies
the discount by the line quantity again, and a second defect (`?? 0` coalescing at the two line
upsert sites) silently kills the percentage path so the discount is dropped entirely.

This spec fixes the meaning of the column, adds the idempotency property that pins it, and specifies
the code changes needed on **both** the order and quote paths. It is spec-only: no implementation
lands until the contract below is approved.

## Overview

One column, `discount_amount`, is written with one meaning and read with another. This spec picks the
meaning (line total), specifies the four code changes that make every path agree on it, and states
the acceptance property — idempotent recalculation — that makes the choice checkable rather than a
matter of taste.

Two decisions need maintainer sign-off before an implementation PR exists, because both change
observable behaviour on an unversioned contract: the column's meaning (§ Proposed Solution 1) and
percentage-first precedence (§ Proposed Solution 2). Everything else follows mechanically from them.

## Problem Statement

### The defect in one sentence

`discountAmount` is consumed as **per-unit** and produced as **line-total** by the same calculation
function, so `calculate(calculate(x)) ≠ calculate(x)` for any line with `quantity ≠ 1`.

### Verified source sites

Verified against `develop` @ `33a7d00c4` (2026-08-21). Sites are named by **symbol or command id
first** and line number second: the `commands/documents.ts` anchors have drifted twice during this
spec's review alone, so the symbol is the durable identifier and the line number is a convenience
pinned to that commit.

`packages/core/src/modules/sales/lib/calculations.ts` — stable across every revision so far

| line | what |
|---|---|
| 80 | `buildBaseLineResult` — the whole defect lives here |
| 88–92 | `discountPerUnit = line.discountAmount ?? (discountPercent/100 × unitNet)` — amount wins over percent, and `0` counts as a supplied amount |
| 94–96 | `discountTotal = clamp(discountPerUnit × quantity, 0, netSubtotalBeforeDiscount)`; `netSubtotal = before − discountTotal` |
| 101–104 | `grossSubtotal` — a **supplied** `totalGrossAmount` wins verbatim, unlike net, so gross and net can disagree on the same row |
| 120 | `discountAmount: round(discountTotal)` — the **line total** leaves the function through the same field name that entered it as per-unit |
| 153 | document rollup: `discountTotal += toNumber(line.discountAmount, 0)` over the *results*, i.e. line totals |

`packages/core/src/modules/sales/commands/documents.ts`

Line numbers are the **declaration** of each symbol; where the interesting expression sits elsewhere
in the body it is given in the description.

| symbol / command id | decl. | what |
|---|---|---|
| `mapOrderLineEntityToSnapshot` / `mapQuoteLineEntityToSnapshot` | 2888 / 2919 | feed the stored line total straight back in, where it is read as per-unit (`discountAmount` at 2906 / 2937) |
| `createLineSnapshotFromInput` | 3006 | create path: `discountAmount: line.discountAmount ?? null` at **3036** — coalesces to **`null`** |
| line entity payload build | — | persist: `discountAmount: toNumericString(lineResult.discountAmount) ?? "0"` at **3124** — writes the **line total** |
| `sales.orders.lines.upsert` | 7010 | `parsed.discountAmount ?? existingSnapshot?.discountAmount ?? 0` at **7176–7177**; the inherited percent at 7178–7179 |
| `sales.quotes.lines.upsert` | 7508 | identical, at **7670–7671** (percent 7672–7673) — **any fix must cover both** |
| `sales.invoices.create` line loop | 8903 | `discountAmount: toNumericString(line.discountAmount ?? 0)` at 9014, where `line` is `parsed.lines[i]` — see § Out of Scope → Invoice lines |

`packages/core/src/modules/sales/commands/returns.ts` — **a second, independent copy of the mapper**

| symbol | line | persists? |
|---|---|---|
| `mapOrderLineEntityToSnapshot` (returns-local) | 137, `discountAmount` at 155 | — the same defect as `documents.ts:2906`, byte for byte |
| `recalculateOrderTotalsForDisplay` | 204–238 | **no** — forked `EntityManager` |
| return **delete** → recompute order totals | 414 → `applyOrderTotals` 423 → `em.persist(order)` 425 | **yes** |
| return **create** → recompute order totals | 562 → `applyOrderTotals` 573 → `em.persist(order)` 575 | **yes** |
| return create, transactional path | 750 → `applyOrderTotals` 759 → `tx.persist(order)` 761 | **yes** |

`applyOrderTotals` (`:120`) writes `discountTotalAmount`, `grandTotal*`, `outstandingAmount` and
`totalsSnapshot` onto the order header. So **creating or deleting a return on an order that has any
percentage-discounted line persists inflated document totals** — a fourth exposed path, reachable
without `lines.upsert` ever being called.

Read path: `packages/core/src/modules/sales/api/documents/factory.ts:632-653` →
`recalculateOrderTotalsForDisplay`. It fires on every **single-order GET** (`items.length === 1`,
i.e. `GET /api/sales/orders?id=…`); multi-item list responses do not trigger it. That call runs on a
forked `EntityManager` and never persists — but `returns.ts` is **not** a display-only file, per the
table above.

### Why it stayed invisible: the create/upsert asymmetry

One column produces three different behaviours depending on which command touched the line last.

- **Create** (`:3036`) coalesces a missing amount to **`null`** → `null ?? percent` → the percentage
  path runs → **the initial write is correct**. Every create-path test passes.
- **Upsert on a new line** (`:7177`, `:7671`) coalesces to **`0`** → `0 ?? percent` → the percentage
  is dead → **the discount is dropped entirely**, and `total_net_amount` is stored as the full
  undiscounted subtotal.
- **Upsert on an existing line** picks up `existingSnapshot.discountAmount` — the stored **line
  total** — and feeds it back as per-unit → **re-inflation** by a further factor of `quantity`.

That asymmetry is why the defect survived: it is unreachable from the code path the test suite
exercises most.

A fourth behaviour, structurally separate, comes from the duplicate mapper in `returns.ts`: any
return create or delete recomputes and **persists** the order header totals from per-unit-misread
snapshots. Two copies of the same defect in two files is the reason a fix scoped to `documents.ts`
would look complete and pass every acceptance criterion while leaving the return flows broken — so
§ Proposed Solution 3 treats de-duplication as part of the change, not a follow-up.

### Worked example

Deterministic from the code paths above. One line: `quantity: 60`, `unitPriceNet: 50.00`,
`discountPercent: 10`, VAT 8%. Correct figures are `discountAmount: 300.00`, `totalNetAmount: 2700.00`,
`totalGrossAmount: 2916.00`.

| path | stored `discount_amount` | stored `total_net_amount` | |
|---|---:|---:|---|
| `orders.create` | 300.00 | 2700.00 | correct — `?? null` lets the percentage run |
| `lines.upsert`, new line | 0.00 | 3000.00 | **discount dropped** — `0 ?? percent` kills the percentage path |
| `lines.upsert`, existing line | 3000.00 | 0.00 | **re-inflated** — the stored 300.00 line total re-enters as per-unit, `300 × 60 = 18000` clamps to the 3000.00 subtotal, and the line's net collapses to zero |

The third row is the idempotency violation stated concretely: one further round trip through a
command that was supposed to change nothing zeroes the line's net.

### Detecting affected rows

The defect is self-detecting without instrumentation, because a supplied `totalGrossAmount` is kept
verbatim (`calculations.ts:101-104`) while net is recomputed from the defective discount. Any line
where `total_net_amount × (1 + taxRate)` diverges materially from `total_gross_amount` is a
candidate; the divergence rate among discounted lines, compared against undiscounted lines as a
baseline, is the measurement any operator can run against their own data.

**Who is exposed.** Two independent populations, and the second is easy to miss:

1. **In-place line reconcilers.** Consumers that recreate orders wholesale never reach the defective
   path — every line goes through create, which is the correct branch, which is also why the test
   suite is green. Consumers whose integration reconciles lines **in place** — the normal shape for an
   order importer once it grows past re-appending everything — write through `lines.upsert` and are
   exposed on every line carrying a percentage discount.
2. **Anyone who uses returns.** The `returns.ts` flows persist recomputed order totals regardless of
   how the lines were originally written, so an order created entirely through the correct create path
   still gets inflated header totals the moment a return is created or deleted against it. This
   population does not depend on the integration shape at all.

That structural asymmetry, not any particular deployment's numbers, is the severity argument.

## Proposed Solution

### 1. The column contract (normative)

> `sales_order_lines.discount_amount` and `sales_quote_lines.discount_amount` store the **discount for
> the whole line** — net, in the line's `currency_code`, quantity-inclusive. It is a **derived cache**
> of `discount_percent` when a percentage is set, and an authoritative override when it is not.
>
> `SalesLineCalculationResult.discountAmount` carries the same meaning: a line total.

This is the meaning the write path (`:3124`) and the document rollup (`:153`) already assume, the
meaning every existing correct row already holds, and the meaning the API/UI/export surfaces already
present. Redefining the column as per-unit instead would require rewriting every stored row and
every downstream consumer; that alternative is rejected in § Alternatives.

Storage is unambiguous. **Input** stays flexible — see the basis flag below.

**`sales_invoice_lines.discount_amount` is deliberately excluded from the normative contract.** Its
only writer is unrecalculated caller input in the `sales.invoices.create` line loop (`:9014`); nothing
in core derives it, recalculates it, or validates it against the line's own net, and § API Contracts
correspondingly leaves `invoiceCreateSchema` without a basis flag. Declaring a contract the platform
does not enforce anywhere would be decoration. The invoice column's value is **caller-asserted and
unenforced**, and this spec leaves it that way; making it a first-class derived column is a separate
piece of work, because it needs an order→invoice derivation path that does not currently exist.

### 2. Read precedence: percentage first

`buildBaseLineResult` derives the discount as:

```
if discountPercent is set and ≠ 0:
    discountTotal = clamp(discountPercent/100 × unitNet × quantity)
else if discountAmount is set and ≠ 0:
    discountTotal = clamp(discountAmount interpreted per its basis)
else:
    discountTotal = 0
```

Rationale for percentage-first, and for treating `0` as absent: the column is
`numeric NOT NULL DEFAULT '0'` (`data/entities.ts:634, 1071, 1521`). A stored `0` cannot be
distinguished from "no discount supplied", so `discountAmount` can never be a reliable *presence*
signal on the read-back path. The percentage is the operator's intent; the amount is its cached
result. Making intent win is the only rule that is stable across a round trip.

**Consequence, deliberate:** this self-heals every dropped-discount row — a row with
`discount_amount = 0` and a non-zero `discount_percent` — without a data migration, because it still
carries the percentage the discount is derived from, and the next recalculation restores it. See § Migration & Backward Compatibility → Row reconciliation for the rows it does *not* heal.

**Cost, deliberate.** Two caller shapes lose an explicit amount, and the second is much the larger:

1. A caller who sends **both** a percent and a deliberately different amount (an ERP rounding its own
   figure) loses the amount.
2. A caller who sends **only** `discountAmount` on `PUT /api/sales/order-lines`, never supplying a
   percent on any request, *also* loses it — because the upsert path inherits the percent from the
   stored row: `discountPercent: parsed.discountPercent ?? existingSnapshot?.discountPercent ?? 0`
   (`documents.ts:7179`, quote path `:7673`). If that row carries a non-zero `discount_percent` from
   an earlier write, percentage-first silently overrides the amount just sent.

Shape 2 is the ordinary "push my own rounded figure" integration, and it is strictly larger than shape
1. Worse, such a caller has no local signal that anything is wrong: from its side it never supplied a
percent, so the documented escape — send `discountPercent: 0` alongside the amount — is not something
it would know it needs.

This is the behaviour change that most needs maintainer sign-off, and shape 2 is the reason: it, not
shape 1, sets the true size of the affected caller population. § Alternatives D is the fallback if the
price is judged too high.

### 3. `discountAmountBasis` — input compatibility without storage ambiguity

**Two distinct signals, not one.** An earlier draft used a single `discountAmountBasis` field and had
the mappers set it to `'line'`. That conflates two different statements — *"the caller told us how to
read this"* and *"we rebuilt this from a stored row"* — and the conflation is load-bearing: it makes
§ Alternatives E unimplementable and, built literally, would reverse § 2's self-heal. So the type
carries the origin separately:

```ts
// packages/core/src/modules/sales/lib/types.ts
export type SalesLineDiscountBasis = 'unit' | 'line'

export type SalesLineSnapshot = {
  // …
  discountAmount?: number | null
  /**
   * Caller-supplied ONLY. How to interpret a supplied `discountAmount`.
   * Omitted ⇒ 'unit'. Entity→snapshot mappers MUST NOT set this.
   */
  discountAmountBasis?: SalesLineDiscountBasis | null
  /**
   * Set by entity→snapshot mappers ONLY. Marks `discountAmount` as reconstructed
   * from a persisted row: it is therefore a line total (§ 1) and is NOT a caller
   * assertion. Never persisted; never accepted from a request.
   */
  discountAmountFromStoredRow?: boolean
}
```

`buildBaseLineResult` reads them in this order:

- `discountAmountFromStoredRow === true` → the amount is a **line total**; do not multiply by
  `quantity`; it is **not** a caller assertion.
- otherwise → the amount came from a caller; interpret per `discountAmountBasis`, defaulting to
  `'unit'` (today's meaning).

| producer | file | sets | why |
|---|---|---|---|
| `createLineSnapshotFromInput` (`:3006`) and the `parsed.*` operand of both `lines.upsert` paths | `documents.ts` | `discountAmountBasis` — `'unit'` when omitted | today's documented API input meaning; existing callers unaffected |
| `mapOrderLineEntityToSnapshot` / `mapQuoteLineEntityToSnapshot` (`:2906`, `:2937`) | `documents.ts` | **`discountAmountFromStoredRow: true`** | reconstructing from a persisted row, which by § Proposed Solution 1 holds a line total |
| `existingSnapshot?.discountAmount` operand inside the upsert paths | `documents.ts` | **`discountAmountFromStoredRow: true`** | same origin as above — see the § 4 sketch, the two operands must not be merged |
| `mapOrderLineEntityToSnapshot` (**returns-local duplicate**, `:137`) | `returns.ts` | **`discountAmountFromStoredRow: true`** | same origin; feeds `recalculateOrderTotalsForDisplay` **and** the three persisting return flows (`:414`, `:562`, `:750`) |

**Invariant, and it must be tested:** no entity→snapshot mapper ever sets `discountAmountBasis`, and no
request schema ever populates `discountAmountFromStoredRow`. That is what makes a populated
`discountAmountBasis` a reliable *caller* signal — the property § Alternatives E depends on. Without
it, E's first precedence branch fires on every read-back and the stored line total outranks
`discount_percent` forever.

Under § 2 as written this second field changes nothing observable — precedence is percentage-first
regardless of origin — so the type is identical whichever way Decision 2 goes. That is deliberate:
the maintainer's choice on § 2 should not carry a type consequence.

**De-duplicate the mapper as part of this change.** `returns.ts:137` is a byte-for-byte copy of
`documents.ts:2906`, and that duplication is the mechanical reason the return flows were missed in the
first draft of this spec — a fix applied to one file passes every acceptance criterion while the other
stays broken. Extract one shared `mapOrderLineEntityToSnapshot` (module-local `lib/`, both commands
importing it) rather than tagging two copies with `discountAmountFromStoredRow` and leaving the next
reader the same trap. If the maintainers would rather keep that refactor out of a behaviour fix, the alternative is an
explicit test asserting the two mappers produce identical snapshots for the same entity.

Together these are what close re-inflation: the value only ever gets multiplied by `quantity` on the
path where it genuinely arrived per-unit.

Additive optional field on a public type → ADDITIVE-ONLY under `BACKWARD_COMPATIBILITY.md`; no
deprecation bridge required.

### 4. Decompose the coalescing chain at both upsert sites

Today both sites collapse two differently-originated values into one expression:

```ts
// documents.ts:7177 (orders) and :7671 (quotes) — today
discountAmount: parsed.discountAmount ?? existingSnapshot?.discountAmount ?? 0,
```

`?? 0` → `?? null` alone is **not** sufficient, and this is the easiest thing in the spec to get wrong.
The two operands have different origins per § 3: `parsed.discountAmount` is a caller value (basis
`'unit'` by default), while `existingSnapshot?.discountAmount` is a stored line total. Tagging the
merged result with a single origin re-inflates on the upsert-existing path — the headline row of the
worked example — while looking correct. So the chain has to be split:

```ts
// after §3 + §4 — origin is decided per operand, not per expression
const callerAmount = parsed.discountAmount ?? null

const discountFields = callerAmount !== null
  ? {
      discountAmount: callerAmount,
      discountAmountBasis: parsed.discountAmountBasis ?? 'unit',
    }
  : {
      discountAmount: existingSnapshot?.discountAmount ?? null,
      discountAmountFromStoredRow: existingSnapshot != null,
    }
```

Keeping `?? null` rather than `?? 0` is what preserves the distinction between "explicitly zero" and
"not supplied" for as long as the value is in flight, which is also what makes the `discountAmount: 0`
case in § Migration & Backward Compatibility *detectable* rather than merely fixed. Apply the same
split at `:7671` for quotes.

## Architecture

The change is confined to the boundary where persisted rows re-enter the calculation engine — but that
boundary exists in **two** files, and both must be tagged. No new service, no change to who calls what.

```
                        basis 'unit'  (API input meaning — unchanged)
                              │
DocumentLineCreateInput ──────┤
  (parsed.discountAmount)     │
                              ▼
                     createLineSnapshotFromInput  (:3006, ?? null)
                     lines.upsert payload build   (:7177 / :7671, ?? null after §4)
                              │
                              ▼
                     ┌───────────────────────┐
SalesOrderLine   ────▶│  SalesLineSnapshot    │────▶ buildBaseLineResult (calculations.ts:80)
SalesQuoteLine   ────▶│  + discountAmountBasis│         │
  via map*EntityToSnapshot                    │         │  percentage-first (§2)
  documents.ts (:2906 / :2937)                │         │  × quantity ONLY when basis = 'unit'
  returns.ts   (:137, duplicate)              │         ▼
        ▲             └───────────────────────┘   SalesLineCalculationResult
        │  basis 'line'  (persisted rows hold           .discountAmount = line total
        │                 a line total, §1)                     │
        ├───────────── persist (:3124) ◀───────────────────────┤  order/quote LINE totals
        │                                                       │
        └───────────── applyOrderTotals + persist(order) ◀──────┘  order HEADER totals
                       returns.ts :414 / :562 / :750
```

The two arrows back into `SalesLineSnapshot` are the round trip that is currently non-idempotent: each
carries a line total, and `buildBaseLineResult` multiplies it by quantity again. Tagging both closes it.

The bottom arrow is the path the first draft of this spec missed. `recalculateOrderTotalsForDisplay`
runs on a forked `EntityManager` and cannot persist, which made `returns.ts` look read-only — but the
other three consumers of the same returns-local mapper call `applyOrderTotals` and then
`persist(order)`, writing `discountTotalAmount`, `grandTotal*`, `outstandingAmount` and
`totalsSnapshot` onto the order header.

Downstream consumers **not** changed by this spec:

- Document rollup (`calculations.ts:153`) sums `SalesLineCalculationResult.discountAmount` — already
  line totals, correct before and after.
- Invoice line creation (`:9014`) writes caller-supplied input and derives nothing; see § Out of Scope.

`salesCalculationService` remains the sole owner of document math
(`packages/core/src/modules/sales/AGENTS.md` rule 1); nothing is recomputed inline at any call site.

## Data Models

**No schema change. No migration. No new column.**

The columns keep their exact definitions. Only the first two carry the § Proposed Solution 1 contract:

| entity | column | definition (unchanged) |
|---|---|---|
| `SalesOrderLine` (`data/entities.ts:634`) | `discount_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` |
| `SalesQuoteLine` (`data/entities.ts:1071`) | `discount_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` |
| `SalesInvoiceLine` (`data/entities.ts:1521`) | `discount_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` — outside the § 1 contract; caller-asserted |

The `NOT NULL DEFAULT '0'` is load-bearing for § Proposed Solution 2: it is *why* a stored `0` cannot
be read as a presence signal, and therefore why precedence has to key off `discount_percent`.

The only type change is additive, in `packages/core/src/modules/sales/lib/types.ts`:

```ts
export type SalesLineDiscountBasis = 'unit' | 'line'

export type SalesLineSnapshot = {
  // …
  discountAmount?: number | null
  /** Caller-supplied ONLY; omitted ⇒ 'unit'. Mappers MUST NOT set this. */
  discountAmountBasis?: SalesLineDiscountBasis | null
  /** Mapper-set ONLY; marks the amount as a line total rebuilt from a stored row. */
  discountAmountFromStoredRow?: boolean
}
```

Both fields are optional, in-memory only, and never persisted or accepted from a request payload — see
§ Proposed Solution 3 for why the origin needs its own field rather than an extra `basis` value, and
for the invariant that keeps them separable.

`SalesLineCalculationResult.discountAmount` is unchanged in shape; § Proposed Solution 1 documents
the meaning it already had.

## API Contracts

No route is added, removed, or renamed. No response shape changes. No OpenAPI path changes.

| route | methods | change |
|---|---|---|
| `/api/sales/order-lines` (`api/order-lines/route.ts` → `sales.orders.lines.*`) | `POST` `PUT` `DELETE` | accepts optional `discountAmountBasis`; stored/returned values become correct for `quantity > 1` |
| `/api/sales/quote-lines` (`api/quote-lines/route.ts` → `sales.quotes.lines.*`) | `POST` `PUT` `DELETE` | identical |
| `/api/sales/orders`, `/api/sales/quotes` (`api/documents/factory.ts`) | `POST` `PUT` | line arrays accept the same optional field |
| `/api/sales/orders?id=…` | `GET` | display recalc (`factory.ts:632-653`) returns totals that now agree with the persisted state |

Request schema addition — **one edit**, in the shared `linePricingSchema`
(`data/validators.ts:332-348`, `discountAmount` at `:342`):

```ts
discountAmount: decimal({ min: 0 }).optional(),
discountAmountBasis: z.enum(['unit', 'line']).optional(),   // new; omitted ⇒ 'unit'
discountPercent: percentage().optional(),
```

That fragment is spread into `orderLineCreateSchema` (`:398`) and `quoteLineCreateSchema` (`:412`),
and through them into the `*UpdateSchema` partials and `DocumentLineCreateInput`
(`commands/documents.ts:665`). So the single addition covers every order and quote line surface the
calculation engine sees — there is no per-route schema edit and no risk of the order and quote
schemas drifting apart, which is exactly the failure mode that produced the duplicated `?? 0` at
`:7177` and `:7671`.

**Not** changed: `invoiceCreateSchema`'s inline line shape (`:899`, `discountAmount` at `:925`).
Invoice lines are persisted straight from request input (`:9014`) and never pass through
`buildBaseLineResult`, so a basis field there would be inert — there is nothing to interpret the basis
*for*. Flagged because a naive grep-and-edit would add it, and because it is the same asymmetry that
keeps `sales_invoice_lines.discount_amount` outside the § Proposed Solution 1 contract.

Omitting the field reproduces today's documented input meaning exactly, so no existing caller has to
change. Response payloads gain nothing — the basis describes how an *input* is interpreted and is not
persisted.

## Migration & Backward Compatibility

Contract surfaces touched, classified per `BACKWARD_COMPATIBILITY.md`:

| surface | classification | note |
|---|---|---|
| `SalesLineSnapshot`, `SalesLineDiscountBasis` (public types) | **ADDITIVE-ONLY** | two optional fields (`discountAmountBasis`, `discountAmountFromStoredRow`); no deprecation bridge required |
| Line create/update validators | **ADDITIVE-ONLY** | optional field; omission = today's behaviour |
| API routes / URLs | unchanged | — |
| DB schema | unchanged | no migration, no snapshot update |
| Event ids, DI keys, ACL features, notification ids, CLI commands | unchanged | except the optional new CLI below, which is purely additive |

The **behavioural** break is percentage-first precedence (§ Proposed Solution 2). It is not
expressible as a type change, so it needs an `UPGRADE_NOTES.md` entry rather than a deprecation
bridge, and the entry has to cover **three** cases, not one:

| caller sends | today | after this spec |
|---|---|---|
| percent **and** an overriding amount | amount wins | percent wins — amount lost |
| amount only, onto a row with a stored non-zero percent | amount wins | **inherited** percent wins — amount lost, with no local signal (`documents.ts:7179`) |
| `discountPercent: 12`, `discountAmount: 0` | **no discount** | **12% applied** |

The third row is the sharpest and the most dangerous, because it inverts rather than drops. `0`
currently counts as a supplied amount and wins, so `discountAmount: 0` is today a working way to
*suppress* a percentage. Anyone relying on that silently starts discounting after the change — and on
a unit price that may already be net of it, producing a double discount. That is precisely the shape
an integration would build to work around this very defect. Such an integration is wrong and this
spec is right, but "you lose your amount" and "you gain a discount you did not ask for" are different
severities, and the upgrade note must carry both. § Proposed Solution 4's `?? 0` → `?? null` change is
what makes the zero case *detectable* rather than merely fixed: it preserves the distinction between
"explicitly zero" and "not supplied" long enough for a migration guard or a warning log to see it.

The documented escape for the first two rows is to send `discountPercent: 0` alongside the explicit
amount.

### Row reconciliation

The issue's "no migration" claim is true for schema and true for code. It is **not** true for data.

| bucket | heals automatically? | how |
|---|---|---|
| dropped (`discount_amount = 0`, `discount_percent > 0`) | **yes** | percentage-first (§ Proposed Solution 2); the next recalculation of the document restores it |
| re-inflated (`discount_amount > qty-correct value`, `discount_percent > 0`) | **yes** | § Proposed Solution 2 ignores the stored amount entirely and re-derives from the percent |
| amount-only, no percent, re-inflated | **no** | the new reading cannot distinguish an inflated line total from a legitimate one; nothing in the row records how many times it was multiplied |

The third bucket needs an explicit, opt-in operator tool — proposed as
`yarn mercato sales recompute-line-discounts --dry-run [--tenant <id>]`, which reports lines whose
stored `total_net_amount` is inconsistent with `unit_price_net × quantity − discount_amount` and,
without `--dry-run`, rewrites the totals from the stored inputs. It must not run automatically and
must not touch rows it cannot prove wrong.

**Open question for the maintainer:** whether that CLI belongs in this change, in a follow-up, or not
in core at all. It is the one piece of scope that is arguably a deployment concern rather than a
platform one.

## Out of Scope

### Adjacent: `totalNetAmount` is accepted, validated, then ignored

`SalesLineSnapshot.totalNetAmount` (`lib/types.ts:56`) and the line schemas
(`data/validators.ts:342, 887`) accept and validate `totalNetAmount`, but `buildBaseLineResult` never
reads it — only `totalGrossAmount` is honoured (`:101-104`). A caller supplying a correct net watches
it be silently discarded and recomputed from the defective discount.

Same root-cause family; a schema that rejected unused fields would have surfaced #5019 as a failing
test years earlier. **No upstream issue exists for it yet.** Worth filing separately.

### Invoice lines

**Core does not derive invoice lines from order lines.** At `:9014` the loop variable is
`parsed.lines[i]` — an element of the `sales.invoices.create` **request payload** — and there is no
`createFromOrder`-style derivation path anywhere in `packages/core/src/modules/sales/`. `orderLineId`
is stored as a reference, but nothing reads the order line to populate the figures.

So whether affected values reach invoices depends entirely on a caller that reads order lines and
posts them back, which is a plausible integration shape but not a platform behaviour. This spec
therefore makes no claim about invoice propagation, and `sales_invoice_lines.discount_amount` stays
outside the § Proposed Solution 1 contract (see the note there).

Already-issued invoices are not retro-fixed in any case: they are immutable by design, and correcting
them is a finance-process decision rather than a platform one.

### Consumer-side mitigation

An affected consumer can work around the defect today by sending an explicit per-unit
`discountAmount` computed from its own line net, and by teaching its line-diff comparator that
`discount_amount` is a field whose stored value will not match what it sent. That mitigation is
independent of this spec and does not wait on it.

## Alternatives Considered

| option | effect | verdict |
|---|---|---|
| **A. Column = line total** (this spec) | read path stops multiplying by quantity on the entity→snapshot path; write path unchanged; existing correct rows stay correct | **chosen** |
| B. Column = per-unit | read path unchanged; write path must persist `discountTotal / quantity`; every existing row's meaning flips; UI, exports and the document rollup all need updating | rejected — maximal blast radius for no gain |
| C. Add a second column (`discount_unit_amount`) | unambiguous, but a schema migration, a new contract surface, and two columns that can disagree | rejected — the ambiguity is a reading bug, not a missing field |
| D. Amount-first precedence with a nullable column | keeps an explicit amount authoritative, but requires migrating `discount_amount` to `NULL`-able and backfilling `0 → NULL`, which is exactly the migration the issue wants to avoid | rejected — revisit only if § Proposed Solution 2's cost is judged unacceptable |
| **E. A caller-supplied basis acts as the presence signal** — see the mechanism below | **the strongest alternative to §2 as written**; removes both cost rows at no migration cost. Recommend adopting unless maintainers prefer the simpler value-only rule |

### E, specified

E rests on being able to tell a caller-supplied amount from one rebuilt off a stored row. § 3's two
fields are exactly that distinction, and E is **only** safe because of the invariant stated there —
mappers set `discountAmountFromStoredRow` and never `discountAmountBasis`:

```
if discountAmountFromStoredRow !== true and discountAmountBasis was supplied:
    discountTotal = clamp(discountAmount interpreted per that basis)   # caller asserted it
else if discountPercent is set and ≠ 0:
    discountTotal = clamp(discountPercent/100 × unitNet × quantity)
else if discountAmount is set and ≠ 0:
    discountTotal = clamp(discountAmount per its origin)
else:
    discountTotal = 0
```

A snapshot from any mapper carries `discountAmountFromStoredRow: true` and no basis, so the first
branch cannot fire on read-back and percentage-first still governs there. **§ 2's self-heal is
preserved**: a dropped-discount row (`discount_amount = 0`, `discount_percent > 0`) still recovers on
the next recalculation, and a re-inflated row is still re-derived from the percent.

If the single-field version of § 3 were used instead — mappers setting `discountAmountBasis: 'line'` —
E would be actively harmful: the first branch would fire on *every* read-back, the stored line total
would outrank `discount_percent` permanently, and both self-healing buckets in § Row reconciliation
would turn from **yes** to **no**, leaving the operator CLI as the only remedy for all three. That
failure is invisible to acceptance criteria 1–3, because an implementation that treats the stored line
total as authoritative is internally consistent and perfectly idempotent — it is merely wrong.
Criterion 10 exists to catch it.

Costs of E, honestly: precedence keys off a field's *presence* rather than its value, which is subtler
to document and to test than § 2's rule; and the § 3 invariant becomes load-bearing rather than
merely tidy, so it needs its own guard test.

## Acceptance Criteria

1. **Idempotency (the property that pins the contract).** For any document, recalculating N times
   equals recalculating once:
   `calculateDocumentTotals(map(entities)) === calculateDocumentTotals(map(persist(calculateDocumentTotals(map(entities)))))`.
   This is the criterion #5019 is missing.
2. A percentage-only line keeps its discount across **create → upsert → display recalc**, with
   `quantity > 1`.
3. An amount-only line (`discountPercent` absent or `0`) keeps its amount across the same three
   steps, at both bases.
4. **All four paths covered**: create, `lines.upsert`, display read
   (`recalculateOrderTotalsForDisplay`), and the persisting return flows (`returns.ts:414`, `:562`,
   `:750`).
5. **Order and quote** (`:7177` **and** `:7671`), and **both mappers** (`documents.ts:2906`/`:2937`
   **and** the returns-local duplicate `returns.ts:137`) — a fix covering one file only would satisfy
   every other criterion here while leaving the return flows broken.
6. Creating and then deleting a return against an order with a percentage-discounted line leaves the
   order header totals byte-identical to their pre-return values.
7. `net × (1 + taxRate)` reconciles with the stored gross for every line the calculation writes.
8. `discountPercent: 12` with `discountAmount: 0` resolves per the decision recorded in
   § Migration & Backward Compatibility, and is covered by an explicit test either way — it must not be
   left as incidental behaviour.
9. **The § 3 invariant holds**: no entity→snapshot mapper sets `discountAmountBasis`, and no request
   schema populates `discountAmountFromStoredRow`.
10. **If § Alternatives E is adopted**, a dropped-discount row (`discount_amount = 0`,
   `discount_percent > 0`) still self-heals on the next recalculation. Criteria 1–3 cannot catch a
   violation here — an implementation that treats the stored line total as authoritative is idempotent
   and internally consistent, just wrong — so this one is not optional under E.
11. No new migration, no new column.

## Testing Strategy

Unit — `packages/core/src/modules/sales/lib/__tests__/calculations.test.ts`:

- idempotency property over a table of `(quantity, unitNet, discountPercent, discountAmount, basis)`
  cases, including `quantity = 1` (where the bug is invisible) and `quantity > 1`
- percentage-first precedence, including `discountAmount: 0` with `discountPercent: 10`
- `discountAmountFromStoredRow: true` does not multiply by quantity; a caller amount with
  `discountAmountBasis: 'unit'` (or omitted) does; `discountAmountBasis: 'line'` does not
- `clamp` still bounds the discount at the undiscounted subtotal

Command — `packages/core/src/modules/sales/commands/__tests__/`:

- `sales.orders.lines.upsert` and `sales.quotes.lines.upsert`: create-then-upsert a percentage-only
  line with `quantity > 1`, assert `discount_amount` and `total_net_amount` are unchanged by the
  upsert
- upsert with neither `discountAmount` nor `discountPercent` in the payload preserves the existing
  line's discount
- upsert sending **only** `discountAmount` onto a line whose stored `discount_percent` is non-zero —
  asserts the § Migration & Backward Compatibility decision for the inherited-percent case
- `sales.returns.create` then `sales.returns.delete` against an order with a percentage-discounted
  line, `quantity > 1`: assert the order header's `discountTotalAmount`, `grandTotal*`,
  `outstandingAmount` and `totalsSnapshot` return to their pre-return values (covers `returns.ts:414`,
  `:562`, `:750`)
- a guard test asserting the `documents.ts` and `returns.ts` mappers produce identical snapshots for
  the same entity — required if the duplicate is kept rather than extracted (§ Proposed Solution 3)
- an invariant test over every `SalesLineSnapshot` producer: mappers never set `discountAmountBasis`,
  request schemas never populate `discountAmountFromStoredRow` (criterion 9)
- upsert-existing without re-sending the amount, asserting the stored line total is **not** multiplied
  by quantity — the case that fails if § 4's coalescing chain is left merged
- under § Alternatives E only: a dropped-discount row self-heals on the next recalculation
  (criterion 10)

Integration — `packages/core/src/modules/sales/__integration__/TC-SALES-5019-line-discount-idempotency.spec.ts`
(self-contained fixtures created via API, cleaned up in teardown, per `.ai/qa/AGENTS.md`):

| path | assertion |
|---|---|
| `POST /api/sales/order-lines` | percentage-only line, `quantity = 60` → stored `discount_amount` is the line total, net is discounted |
| `PUT /api/sales/order-lines` | re-upserting the same line changes neither `discount_amount` nor `total_net_amount` |
| `PUT /api/sales/quote-lines` | same, on the quote path |
| `GET /api/sales/orders?id=…` | display recalc returns the same `discountTotalAmount` as the persisted state, twice in a row |
| `POST` then `DELETE /api/sales/returns` | order header totals return to their pre-return values on an order with a percentage-discounted line |
| order detail page | line discount and order totals match the API response |

## Risks & Impact Review

| risk | severity | affected | mitigation | residual |
|---|---|---|---|---|
| A caller loses an explicit `discountAmount` to a percentage — either one it supplied, or one **inherited from the stored row** on upsert (`documents.ts:7179`) | **high** | any integration pushing its own rounded discount; the inherited-percent shape is the larger population and gets no local signal | `UPGRADE_NOTES.md` entry covering all three cases; escape is `discountPercent: 0`; § Alternatives E removes the cost outright, D reverses the decision | behaviour change on a path with no test coverage today — this is the decision needing sign-off |
| `discountAmount: 0` flips from *suppressing* a percentage to *applying* it | **high** | any integration that used `discountAmount: 0` to work around this very defect, on a unit price already net of the discount → double discount | must be called out explicitly in `UPGRADE_NOTES.md`; § Proposed Solution 4's `?? null` keeps the case detectable | inverts rather than drops, so it fails loud in the wrong direction — silently larger totals |
| Return create/delete persists inflated order header totals | **high** | every consumer that uses returns, regardless of how lines were written | covered by tagging the returns-local mapper (§ Proposed Solution 3) and by the return-flow acceptance criterion | none once fixed; unbounded until then — this path needs no unusual integration shape to hit |
| Recalculation now *changes* totals on documents whose rows are currently wrong | medium | deployments carrying dropped/re-inflated rows | intended (that is the fix), but it lands on the next write to each document, not at deploy time | totals move under operators without an explicit trigger; call it out in the release note |
| Amount-only re-inflated rows stay wrong | medium | ERP importers that send amounts, not percentages | the opt-in CLI in § Migration & Backward Compatibility | needs the scope decision above |
| Invoice-line figures are caller-supplied and unenforced (`:9014` writes request input, no order→invoice derivation exists in core) | low | deployments whose own integration copies order lines into invoice payloads | out of scope and explicitly excluded from the § 1 contract; issued invoices are immutable by design | a caller can still post inconsistent invoice figures; nothing in core validates them, before or after this change |
| A third party reading `discount_amount` as per-unit today (matching the *read* path, not the docs) breaks | low | third-party modules | § Proposed Solution 1 documents the meaning the persisted data already had; the read path was the outlier | low |

Contract-surface classification: see § Migration & Backward Compatibility.

## Final Compliance Report

- No cross-tenant exposure: every touched path already carries `{ tenantId, organizationId }`;
  `recalculateOrderTotalsForDisplay` keeps its scoped `findWithDecryption` calls.
- No direct cross-module ORM relations introduced.
- Document math stays inside `salesCalculationService` (`packages/core/src/modules/sales/AGENTS.md`
  rule 1) — no inline recomputation is added at any call site.
- No user-facing strings added; the CLI in § Migration & Backward Compatibility is operator-facing and its output is `[internal]`.
- No migration, no generated-file change, therefore no `yarn db:generate` / `yarn generate` run.

## Decision Requested

Issue #5019 ends with *"Suggested direction (for maintainer input before any work starts)"*. This
spec is that direction written out far enough to be accepted or rejected on specifics rather than in
principle — §§ Proposed Solution 1–3 formalise the issue's own three points; the idempotency
property, the row reconciliation, and the alternatives table are what it adds.

**No implementation should land until § Proposed Solution 1 and 2 are approved**, because both change
observable behaviour on an unversioned contract:

| # | decision | if rejected |
|---|---|---|
| 1 | `discount_amount` means a **line total** | § Alternatives B or C; both need a data migration |
| 2 | **percentage-first** precedence, treating a stored `0` as absent | § Alternatives **E** (an explicitly-supplied basis acts as the presence signal — no migration, removes both cost cases) or **D** (amount-first with a nullable column) |

A third question is now worth an explicit answer rather than being folded into decision 2: **should
`discountAmount: 0` alongside a non-zero percent suppress the discount or apply the percentage?**
Today it suppresses. § Proposed Solution 2 as written makes it apply, which inverts the meaning of
existing integration code rather than merely dropping a value. Either answer is defensible; the spec
should not leave it as a side effect.

Everything else follows mechanically from those decisions. Note that the fix surface is larger than
the first draft implied: the returns-local mapper duplicate means the implementation touches
`commands/returns.ts` as well, and § Proposed Solution 3 recommends extracting the shared mapper
rather than tagging two copies.

## Changelog

- 2026-08-07 — Initial draft.
- 2026-08-11 — Grounded the severity argument in the create-vs-upsert asymmetry in the code, stated
  as a deterministic worked example plus a detection recipe operators can run against their own data.
  Source sites re-verified against `develop` @ `af45bc96e`.
- 2026-08-18 — Review response. Added the fourth exposed path: `commands/returns.ts` holds a second,
  independent copy of `mapOrderLineEntityToSnapshot` whose three non-display consumers persist
  recomputed order header totals, so returns break independently of `lines.upsert`; the mapper is now
  in the § 3 producer table and de-duplication is part of the change. Corrected the § 2 cost analysis:
  the upsert path inherits `discount_percent` from the stored row, so a caller sending only an amount
  also loses it. Withdrew the invoice-propagation claim — `:9014` writes request input and no
  order→invoice derivation exists in core — and excluded `sales_invoice_lines.discount_amount` from the
  § 1 contract rather than declaring a meaning nothing enforces. Added the `discountAmount: 0`
  inversion case to the upgrade notes and as its own decision. Added § Alternatives E. Citations are
  now symbol-led and re-pinned to `develop` @ `00c90fecf`.
- 2026-08-21 — Second review response. Split the single `discountAmountBasis` into a caller-only basis
  and a mapper-only `discountAmountFromStoredRow`: the earlier draft had the mappers setting the basis,
  which made § Alternatives E's premise false and, built literally, would have made a stored line total
  outrank `discount_percent` on every recalculation — silently reversing § 2's self-heal in a way
  acceptance criteria 1–3 cannot detect. E is now specified rather than merely recommended, with the
  invariant it depends on stated in § 3 and pinned by criteria 9 and 10. § 4 rewritten around a code
  sketch showing the coalescing chain decomposed per operand, since `?? 0` → `?? null` alone leaves
  re-inflation alive on the upsert-existing path. Header pin corrected and all anchors re-verified
  against `develop` @ `33a7d00c4`; merged `develop` to clear two unrelated red checks.
- 2026-08-21 — Re-pinned the `documents.ts` table in § Verified source sites, which had kept its
  pre-merge numbers while the rest of the document moved to `33a7d00c4`, and switched that table to
  citing declaration lines throughout rather than mixing declarations with body lines.
