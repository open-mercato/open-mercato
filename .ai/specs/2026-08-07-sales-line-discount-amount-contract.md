# Sales line `discount_amount` — a single, idempotent contract

Status: draft — design decision requested
Scope: `packages/core/src/modules/sales/{lib/calculations.ts,lib/types.ts,commands/documents.ts,commands/returns.ts,data/validators.ts}`
Tracking: [#5019](https://github.com/open-mercato/open-mercato/issues/5019); related display-only PR [#5006](https://github.com/open-mercato/open-mercato/pull/5006)
Verified against: `develop` @ `af45bc96e` (2026-08-11)

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

All line numbers verified against `develop` @ `af45bc96e` (2026-08-11).

`packages/core/src/modules/sales/lib/calculations.ts`

| line | what |
|---|---|
| 80 | `buildBaseLineResult` — the whole defect lives here |
| 88–92 | `discountPerUnit = line.discountAmount ?? (discountPercent/100 × unitNet)` — amount wins over percent, and `0` counts as a supplied amount |
| 94–96 | `discountTotal = clamp(discountPerUnit × quantity, 0, netSubtotalBeforeDiscount)`; `netSubtotal = before − discountTotal` |
| 101–104 | `grossSubtotal` — a **supplied** `totalGrossAmount` wins verbatim, unlike net, so gross and net can disagree on the same row |
| 120 | `discountAmount: round(discountTotal)` — the **line total** leaves the function through the same field name that entered it as per-unit |
| 153 | document rollup: `discountTotal += toNumber(line.discountAmount, 0)` over the *results*, i.e. line totals |

`packages/core/src/modules/sales/commands/documents.ts`

| line | what |
|---|---|
| 2873 / 2904 | `mapOrderLineEntityToSnapshot` / `mapQuoteLineEntityToSnapshot` — feed the stored line total straight back in, where it is read as per-unit |
| 2973 | `createLineSnapshotFromInput` |
| **3003** | create path: `discountAmount: line.discountAmount ?? null` — coalesces to **`null`** |
| 3091 | persist: `discountAmount: toNumericString(lineResult.discountAmount) ?? "0"` — writes the **line total** |
| **7094** | `sales.orders.lines.upsert`: `parsed.discountAmount ?? existingSnapshot?.discountAmount ?? 0` |
| **7588** | `sales.quotes.lines.upsert`: identical — **any fix must cover both** |
| 8931 | invoice line creation copies `discountAmount` verbatim from its source line — wrong values propagate downstream into invoices |

Read path: `packages/core/src/modules/sales/api/documents/factory.ts:544-566` →
`recalculateOrderTotalsForDisplay` (`packages/core/src/modules/sales/commands/returns.ts:204-238`).
It fires on every **single-order GET** (`items.length === 1`, i.e. `GET /api/sales/orders?id=…`);
multi-item list responses do not trigger it. It runs on a forked `EntityManager`, so it never
persists — the wrong number is display-only *on that path*, but the same snapshot mappers feed the
persisting upsert path.

### Why it stayed invisible: the create/upsert asymmetry

One column produces three different behaviours depending on which command touched the line last.

- **Create** (`:3003`) coalesces a missing amount to **`null`** → `null ?? percent` → the percentage
  path runs → **the initial write is correct**. Every create-path test passes.
- **Upsert on a new line** (`:7094`, `:7588`) coalesces to **`0`** → `0 ?? percent` → the percentage
  is dead → **the discount is dropped entirely**, and `total_net_amount` is stored as the full
  undiscounted subtotal.
- **Upsert on an existing line** picks up `existingSnapshot.discountAmount` — the stored **line
  total** — and feeds it back as per-unit → **re-inflation** by a further factor of `quantity`.

That asymmetry is why the defect survived: it is unreachable from the code path the test suite
exercises most.

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

**Who is exposed.** Consumers that recreate orders wholesale never reach the defective path — every
line goes through create, which is the correct branch, which is also why the test suite is green.
Consumers whose integration reconciles lines **in place** — the normal shape for an order importer
once it grows past re-appending everything — write through `lines.upsert` and are exposed on every
line carrying a percentage discount. That asymmetry, not any particular deployment's numbers, is the
severity argument.

## Proposed Solution

### 1. The column contract (normative)

> `sales_order_lines.discount_amount`, `sales_quote_lines.discount_amount` and
> `sales_invoice_lines.discount_amount` store the **discount for the whole line** — net, in the
> line's `currency_code`, quantity-inclusive. It is a **derived cache** of
> `discount_percent` when a percentage is set, and an authoritative override when it is not.
>
> `SalesLineCalculationResult.discountAmount` carries the same meaning: a line total.

This is the meaning the write path (`:3091`) and the document rollup (`:153`) already assume, the
meaning every existing correct row already holds, and the meaning the API/UI/export surfaces already
present. Redefining the column as per-unit instead would require rewriting every stored row and
every downstream consumer; that alternative is rejected in § Alternatives.

Storage is unambiguous. **Input** stays flexible — see the basis flag below.

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

**Cost, deliberate:** a caller who sends both a percent and a deliberately different amount (an ERP
rounding its own figure) loses the amount. That caller must send `discountPercent: 0` alongside the
explicit amount. This is the behaviour change that most needs maintainer sign-off.

### 3. `discountAmountBasis` — input compatibility without storage ambiguity

```ts
// packages/core/src/modules/sales/lib/types.ts
export type SalesLineDiscountBasis = 'unit' | 'line'

export type SalesLineSnapshot = {
  // …
  discountAmount?: number | null
  /** How to interpret a supplied `discountAmount`. Defaults to 'unit' for API input. */
  discountAmountBasis?: SalesLineDiscountBasis | null
}
```

| producer | basis | why |
|---|---|---|
| `createLineSnapshotFromInput` (`:2973`) and the two `lines.upsert` paths, from `parsed.*` | `'unit'` (default) | today's documented API input meaning; existing callers unaffected |
| `mapOrderLineEntityToSnapshot` / `mapQuoteLineEntityToSnapshot` (`:2873`, `:2904`) | **`'line'`** | reconstructing from a persisted row, which by § Proposed Solution 1 holds a line total |
| `existingSnapshot?.discountAmount` fallback inside the upsert paths | **`'line'`** | same origin as above |

This is the single change that closes re-inflation: the value only ever gets multiplied by
`quantity` on the path where it genuinely arrived per-unit.

Additive optional field on a public type → ADDITIVE-ONLY under `BACKWARD_COMPATIBILITY.md`; no
deprecation bridge required.

### 4. Fix the `?? 0` coalescing at both upsert sites

`:7094` and `:7588` become `?? null`, mirroring the create path (`:3003`), so "not supplied" stays
distinguishable from "explicitly zero" for as long as the value is in flight. With § Proposed Solution 2 in place this
is belt-and-braces rather than load-bearing, but leaving `?? 0` in the tree preserves a live trap for
the next reader.

## Architecture

The change is confined to the boundary where persisted rows re-enter the calculation engine. No new
service, no new call site, no change to who calls what.

```
                        basis 'unit'  (API input meaning — unchanged)
                              │
DocumentLineCreateInput ──────┤
  (parsed.discountAmount)     │
                              ▼
                     createLineSnapshotFromInput  (:2973, ?? null)
                     lines.upsert payload build   (:7094 / :7588, ?? null after §4)
                              │
                              ▼
                     ┌──────────────────────┐
SalesOrderLine   ────▶│  SalesLineSnapshot   │────▶ buildBaseLineResult (calculations.ts:80)
SalesQuoteLine   ────▶│  + discountAmountBasis│         │
  via map*EntityToSnapshot                    │         │  percentage-first (§2)
  (:2873 / :2904)     └──────────────────────┘         │  × quantity ONLY when basis = 'unit'
        ▲                                               ▼
        │  basis 'line'  (persisted rows hold a line total, §1)
        │                                    SalesLineCalculationResult
        │                                     .discountAmount = line total
        │                                               │
        └───────────── persist (:3091) ◀────────────────┘
```

The loop above is exactly the round trip that is currently non-idempotent: the arrow back into
`SalesLineSnapshot` carries a line total, and `buildBaseLineResult` multiplies it by quantity again.
Tagging that one arrow with `basis: 'line'` closes it.

Two consumers sit downstream and are **not** changed by this spec:

- Document rollup (`calculations.ts:153`) sums `SalesLineCalculationResult.discountAmount` — already
  line totals, correct before and after.
- Invoice line creation (`commands/documents.ts:8931`) copies `discountAmount` verbatim from its
  source line. It inherits correctness from the order line rather than deriving anything.

`salesCalculationService` remains the sole owner of document math
(`packages/core/src/modules/sales/AGENTS.md` rule 1); nothing is recomputed inline at any call site.

## Data Models

**No schema change. No migration. No new column.**

The three affected columns keep their exact definitions:

| entity | column | definition (unchanged) |
|---|---|---|
| `SalesOrderLine` (`data/entities.ts:634`) | `discount_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` |
| `SalesQuoteLine` (`data/entities.ts:1071`) | `discount_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` |
| `SalesInvoiceLine` (`data/entities.ts:1521`) | `discount_amount` | `numeric(18,4) NOT NULL DEFAULT '0'` |

The `NOT NULL DEFAULT '0'` is load-bearing for § Proposed Solution 2: it is *why* a stored `0` cannot
be read as a presence signal, and therefore why precedence has to key off `discount_percent`.

The only type change is additive, in `packages/core/src/modules/sales/lib/types.ts`:

```ts
export type SalesLineDiscountBasis = 'unit' | 'line'

export type SalesLineSnapshot = {
  // …
  discountAmount?: number | null
  /** How to interpret a supplied `discountAmount`. Defaults to 'unit' for API input. */
  discountAmountBasis?: SalesLineDiscountBasis | null
}
```

`SalesLineCalculationResult.discountAmount` is unchanged in shape; § Proposed Solution 1 documents
the meaning it already had.

## API Contracts

No route is added, removed, or renamed. No response shape changes. No OpenAPI path changes.

| route | methods | change |
|---|---|---|
| `/api/sales/order-lines` (`api/order-lines/route.ts` → `sales.orders.lines.*`) | `POST` `PUT` `DELETE` | accepts optional `discountAmountBasis`; stored/returned values become correct for `quantity > 1` |
| `/api/sales/quote-lines` (`api/quote-lines/route.ts` → `sales.quotes.lines.*`) | `POST` `PUT` `DELETE` | identical |
| `/api/sales/orders`, `/api/sales/quotes` (`api/documents/factory.ts`) | `POST` `PUT` | line arrays accept the same optional field |
| `/api/sales/orders?id=…` | `GET` | display recalc (`factory.ts:544-566`) returns totals that now agree with the persisted state |

Request schema addition — **one edit**, in the shared `linePricingSchema`
(`data/validators.ts:332-348`, `discountAmount` at `:342`):

```ts
discountAmount: decimal({ min: 0 }).optional(),
discountAmountBasis: z.enum(['unit', 'line']).optional(),   // new; omitted ⇒ 'unit'
discountPercent: percentage().optional(),
```

That fragment is spread into `orderLineCreateSchema` (`:398`) and `quoteLineCreateSchema` (`:412`),
and through them into the `*UpdateSchema` partials and `DocumentLineCreateInput`
(`commands/documents.ts:658`). So the single addition covers every order and quote line surface the
calculation engine sees — there is no per-route schema edit and no risk of the order and quote
schemas drifting apart, which is exactly the failure mode that produced the duplicated `?? 0` at
`:7094` and `:7588`.

**Not** changed: `invoiceCreateSchema`'s inline line shape (`:899`, `discountAmount` at `:925`).
Invoice lines are persisted verbatim (`commands/documents.ts:8931`) and never pass through
`buildBaseLineResult`, so a basis field there would be inert. Flagged only because a naive
grep-and-edit would add it.

Omitting the field reproduces today's documented input meaning exactly, so no existing caller has to
change. Response payloads gain nothing — the basis describes how an *input* is interpreted and is not
persisted.

## Migration & Backward Compatibility

Contract surfaces touched, classified per `BACKWARD_COMPATIBILITY.md`:

| surface | classification | note |
|---|---|---|
| `SalesLineSnapshot`, `SalesLineDiscountBasis` (public types) | **ADDITIVE-ONLY** | optional field; no deprecation bridge required |
| Line create/update validators | **ADDITIVE-ONLY** | optional field; omission = today's behaviour |
| API routes / URLs | unchanged | — |
| DB schema | unchanged | no migration, no snapshot update |
| Event ids, DI keys, ACL features, notification ids, CLI commands | unchanged | except the optional new CLI below, which is purely additive |

The **behavioural** break is percentage-first precedence (§ Proposed Solution 2): a caller sending
both a percent and an overriding amount loses the amount. That is not expressible as a type change,
so it needs an `UPGRADE_NOTES.md` entry rather than a deprecation bridge. The documented escape is to
send `discountPercent: 0` alongside the explicit amount.

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

### Already-issued invoices

Invoice lines created from an affected order line (`commands/documents.ts:8931`) hold the wrong
figures and are not retro-fixed. Issued invoices are immutable by design; correcting them is a
finance-process decision, not a platform one. It belongs in the release note, not in this change.

### Consumer-side mitigation

An affected consumer can work around the defect today by sending an explicit per-unit
`discountAmount` computed from its own line net, and by teaching its line-diff comparator that
`discount_amount` is a field whose stored value will not match what it sent. That mitigation is
independent of this spec and does not wait on it.

## Alternatives Considered

| option | effect | verdict |
|---|---|---|
| **A. Column = line total** (this spec) | read path stops multiplying by quantity on the entity→snapshot path; write path unchanged; existing correct rows stay correct | **chosen** |
| B. Column = per-unit | read path unchanged; write path must persist `discountTotal / quantity`; every existing row's meaning flips; UI, exports, invoice copy (`:8931`) and the document rollup all need updating | rejected — maximal blast radius for no gain |
| C. Add a second column (`discount_unit_amount`) | unambiguous, but a schema migration, a new contract surface, and two columns that can disagree | rejected — the ambiguity is a reading bug, not a missing field |
| D. Amount-first precedence with a nullable column | keeps an explicit amount authoritative, but requires migrating `discount_amount` to `NULL`-able and backfilling `0 → NULL`, which is exactly the migration the issue wants to avoid | rejected — revisit only if § Proposed Solution 2's cost is judged unacceptable |

## Acceptance Criteria

1. **Idempotency (the property that pins the contract).** For any document, recalculating N times
   equals recalculating once:
   `calculateDocumentTotals(map(entities)) === calculateDocumentTotals(map(persist(calculateDocumentTotals(map(entities)))))`.
   This is the criterion #5019 is missing.
2. A percentage-only line keeps its discount across **create → upsert → display recalc**, with
   `quantity > 1`.
3. An amount-only line (`discountPercent` absent or `0`) keeps its amount across the same three
   steps, at both bases.
4. All three paths covered: write, read (`recalculateOrderTotalsForDisplay`), precedence.
5. **Order and quote** (`:7094` **and** `:7588`), not one of them.
6. `net × (1 + taxRate)` reconciles with the stored gross for every line the calculation writes.
7. No new migration, no new column.

## Testing Strategy

Unit — `packages/core/src/modules/sales/lib/__tests__/calculations.test.ts`:

- idempotency property over a table of `(quantity, unitNet, discountPercent, discountAmount, basis)`
  cases, including `quantity = 1` (where the bug is invisible) and `quantity > 1`
- percentage-first precedence, including `discountAmount: 0` with `discountPercent: 10`
- `basis: 'line'` does not multiply by quantity; `basis: 'unit'` (and omitted basis) does
- `clamp` still bounds the discount at the undiscounted subtotal

Command — `packages/core/src/modules/sales/commands/__tests__/`:

- `sales.orders.lines.upsert` and `sales.quotes.lines.upsert`: create-then-upsert a percentage-only
  line with `quantity > 1`, assert `discount_amount` and `total_net_amount` are unchanged by the
  upsert
- upsert with neither `discountAmount` nor `discountPercent` in the payload preserves the existing
  line's discount

Integration — `packages/core/src/modules/sales/__integration__/TC-SALES-5019-line-discount-idempotency.spec.ts`
(self-contained fixtures created via API, cleaned up in teardown, per `.ai/qa/AGENTS.md`):

| path | assertion |
|---|---|
| `POST /api/sales/order-lines` | percentage-only line, `quantity = 60` → stored `discount_amount` is the line total, net is discounted |
| `PUT /api/sales/order-lines` | re-upserting the same line changes neither `discount_amount` nor `total_net_amount` |
| `PUT /api/sales/quote-lines` | same, on the quote path |
| `GET /api/sales/orders?id=…` | display recalc returns the same `discountTotalAmount` as the persisted state, twice in a row |
| order detail page | line discount and order totals match the API response |

## Risks & Impact Review

| risk | severity | affected | mitigation | residual |
|---|---|---|---|---|
| A caller that deliberately sends both `discountPercent` and an overriding `discountAmount` loses the amount (§ Proposed Solution 2) | **high** | any integration mirroring an external system's rounded discount | document in `UPGRADE_NOTES.md`; the documented escape is `discountPercent: 0`; option D if rejected | behaviour change on a path with no test coverage today — this is the decision needing sign-off |
| Recalculation now *changes* totals on documents whose rows are currently wrong | medium | deployments carrying dropped/re-inflated rows | intended (that is the fix), but it lands on the next write to each document, not at deploy time | totals move under operators without an explicit trigger; call it out in the release note |
| Amount-only re-inflated rows stay wrong | medium | ERP importers that send amounts, not percentages | the opt-in CLI in § Migration & Backward Compatibility | needs the scope decision above |
| Invoices already issued from affected orders keep the wrong figures (`:8931` copies verbatim) | medium | finance/reporting | out of scope — issued invoices are immutable by design | must be stated in the release note, not silently fixed |
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
| 2 | **percentage-first** precedence, treating a stored `0` as absent | § Alternatives D — amount-first with a nullable column |

Everything else in this spec follows mechanically from those two and needs no separate call.

## Changelog

- 2026-08-07 — Initial draft.
- 2026-08-11 — Grounded the severity argument in the create-vs-upsert asymmetry in the code, stated
  as a deterministic worked example plus a detection recipe operators can run against their own data.
  Source sites re-verified against `develop` @ `af45bc96e`.
