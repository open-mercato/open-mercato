# Execution plan — sales line `discount_amount` contract

**Slug:** `sales-line-discount-amount-contract`
**Branch:** `fix/sales-line-discount-amount-contract`
**Base:** `develop`
**Engine:** om-auto-create-pr-loop (steps: 24, --loop: no)
**Source spec:** `.ai/specs/2026-08-07-sales-line-discount-amount-contract.md`
**Refs:** #3757 (open, de facto tracker) · #5019 (closed twin) · #5200 (spec PR) · #5550 (parked, superseded by this run)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 0 | 0.1 | Flip the spec status to approved | inline | done | d9523ecde |
| 0 | 0.2 | Add the Decision Record section (D1–D6) | inline | done | 19be24efc |
| 0 | 0.3 | Add the Implementation Plan section to the spec | inline | done | 152b47448 |
| 0 | 0.4 | Record the D5 deferral and the changelog entry | inline | done | 91a2e4d13 |
| 1 | 1.1 | Add the discount-basis types to `lib/types.ts` | inline | done | 6d2a702fe |
| 1 | 1.2 | Percentage-first, basis-aware discount in `buildBaseLineResult` | inline | done | 376d6aad6 |
| 1 | 1.3 | Unit tests for the calculation engine | inline | done | 993d11b3f |
| 2 | 2.1 | Extract the shared order-line entity→snapshot mapper | inline | done | f0da7848f |
| 2 | 2.2 | Point `commands/documents.ts` at the shared mapper | inline | done | 734810446 |
| 2 | 2.3 | Point `commands/returns.ts` at it and delete the duplicate | inline | done | 5411e155f |
| 2 | 2.4 | Tag `mapQuoteLineEntityToSnapshot` as stored-row sourced | inline | done | landed in 2.1 |
| 3 | 3.1 | Add `discountAmountBasis` to the shared `linePricingSchema` | inline | done | d374465c8 |
| 3 | 3.2 | Decompose the coalescing chain at `sales.orders.lines.upsert` | inline | done | 721b8df24 |
| 3 | 3.3 | Decompose the coalescing chain at `sales.quotes.lines.upsert` | inline | done | landed with 3.2 |
| 3 | 3.4 | Carry the caller basis through `createLineSnapshotFromInput` | inline | done | c12d509ed |
| 3 | 3.4-fix | Preserve stored-row origin when re-mapping a snapshot | inline | done | 1f5a84340 |
| 4 | 4.1 | Command tests — order and quote upsert idempotency | inline | done | — |
| 4 | 4.2 | Command test — upsert-existing without re-sending the amount | inline | done | landed with 4.1 |
| 4 | 4.3 | Command test — return create/delete leaves header totals identical | inline | todo | — |
| 4 | 4.4 | Command test — the § 3 producer invariant (criterion 9) | inline | todo | — |
| 5 | 5.1 | Resolve the per-unit reading in `SalesOrderDraftLines.tsx` | inline | todo | — |
| 5 | 5.2 | `UPGRADE_NOTES.md` entry for the three behaviour changes | inline | todo | — |
| 6 | 6.1 | Integration spec — line-discount idempotency across the API | inline | todo | — |
| 7 | 7.1 | File the D5 operator-CLI follow-up issue and link it | inline | todo | — |
| 7 | 7.2 | File the adjacent `totalNetAmount` follow-up issue | inline | todo | — |

## Goal

Make `sales_order_lines.discount_amount` and `sales_quote_lines.discount_amount` mean one thing on the read path and the write path — the discount for the whole line — so that recalculating a document is idempotent and an order containing a discounted multi-unit line stops reporting a net subtotal inconsistent with its gross.

## Root cause (verified on `develop@97319f09f`, not quoted from the spec)

`buildBaseLineResult` in `packages/core/src/modules/sales/lib/calculations.ts` names its local `discountPerUnit`, seeds it from `line.discountAmount`, and computes `discountTotal = Math.min(Math.max(discountPerUnit * quantity, 0), netSubtotalBeforeDiscount)`. Every writer stores a line total in that column — `mapOrderLineEntityToSnapshot` (`commands/documents.ts:2972`), `mapQuoteLineEntityToSnapshot` (`:3003`) and the returns-local duplicate (`commands/returns.ts:137`) all feed the persisted value straight back in — so each round trip multiplies the discount by the quantity again. The `??` in that expression also means a stored `0` counts as a supplied amount and suppresses a correct `discount_percent` sitting in the same row.

Both upsert sites confirmed at `commands/documents.ts:7270` (orders) and `:7764` (quotes), each collapsing a caller value and a stored line total into one `parsed.discountAmount ?? existingSnapshot?.discountAmount ?? 0` expression.

## Scope

`packages/core/src/modules/sales/` — `lib/types.ts`, `lib/calculations.ts`, a new module-local shared mapper, `commands/documents.ts`, `commands/returns.ts`, `data/validators.ts`, `components/documents/SalesOrderDraftLines.tsx`, plus unit, command and integration tests. Repository root: `UPGRADE_NOTES.md`. Spec: `.ai/specs/2026-08-07-sales-line-discount-amount-contract.md`.

## Non-goals

- **No schema change, no migration, no new column.** The columns keep their `numeric(18,4) NOT NULL DEFAULT '0'` definitions; that `NOT NULL DEFAULT '0'` is precisely why a stored `0` cannot serve as a presence signal and is therefore load-bearing for § 2. `yarn db:generate` is not run.
- **§ Alternatives E is not implemented** (D4). Acceptance criterion 10 is out of scope; criterion 9 is in scope.
- **The operator repair CLI is not implemented** (D5) — it ships as a follow-up issue.
- **`sales_invoice_lines.discount_amount` is untouched.** It stays outside the contract, caller-asserted and unenforced, and `invoiceCreateSchema` gets no basis field — invoice lines never pass through `buildBaseLineResult`, so one there would be inert.
- **Already-corrupted amount-only rows carrying no percent are not repaired.** They cannot self-heal, which is why the PR says `Refs #3757` rather than `Closes`.

## Decisions carried into this run

Recorded by @wojciechszyjka on 2026-08-26; Step 0.2 writes them into the spec.

| # | Decision |
|---|---|
| D1 | The column means a **line total** — net, in the line's currency, quantity-inclusive; a derived cache of `discount_percent` when a percentage is set, an authoritative override when it is not. |
| D2 | **Percentage-first** read precedence, treating a stored `0` as absent. The documented cost is accepted; the escape is sending `discountPercent: 0`. |
| D3 | `discountAmount: 0` alongside a non-zero percent now **applies** the percentage. Needs an explicit test and the loudest `UPGRADE_NOTES.md` paragraph — it inverts rather than drops existing behaviour. |
| D4 | § Alternatives **E is not adopted**; ship § 2's value-only rule. The § 3 type shape is identical either way, so E stays additively adoptable later. |
| D5 | The opt-in operator CLI is **deferred** to a follow-up issue. |
| D6 | **Extract** one shared `mapOrderLineEntityToSnapshot`; do not keep two copies behind an equivalence test. |

## Implementation Plan

### Phase 0 — record the approval in the spec

- **0.1 Flip the spec status to approved.** `Status: draft — design decision requested` becomes `Status: approved — implementation in progress`.
- **0.2 Add the Decision Record section (D1–D6).** Directly above `## Changelog`, with the rationale for each and attribution.
- **0.3 Add the Implementation Plan section to the spec.** The spec has none, which is why it was not machine-implementable; mirror this run's phases so a later resume can work from the spec itself.
- **0.4 Record the D5 deferral and the changelog entry.** Note the deferral in `## Migration & Backward Compatibility` where it poses the open question, linking the follow-up issue, and add a `2026-08-26` changelog entry.

### Phase 1 — types and the calculation engine

- **1.1 Add the discount-basis types to `lib/types.ts`.** `SalesLineDiscountBasis = 'unit' | 'line'`; `SalesLineSnapshot.discountAmountBasis` (caller-supplied only, omitted means `'unit'`) and `.discountAmountFromStoredRow` (mapper-set only). Both optional, in-memory only, never persisted, never accepted from a request — ADDITIVE-ONLY.
- **1.2 Percentage-first, basis-aware discount in `buildBaseLineResult`.** Resolve `netSubtotalBeforeDiscount` first; then percent-if-set-and-non-zero, else amount-interpreted-per-origin, else zero; preserve the existing clamp bounds. `discountAmountFromStoredRow === true` means a line total and is never multiplied by quantity.
- **1.3 Unit tests for the calculation engine.** The idempotency property table, percentage-first precedence, the D3 zero case, basis handling, clamping, and the salvaged five-pass round-trip and document-level clamp cases.

### Phase 2 — one shared mapper (D6)

- **2.1 Extract the shared order-line entity→snapshot mapper** into module-local `lib/`, tagged `discountAmountFromStoredRow: true`.
- **2.2 Point `commands/documents.ts` at the shared mapper**, removing its local copy.
- **2.3 Point `commands/returns.ts` at it and delete the duplicate** — the byte-for-byte copy whose three persisting consumers (`:414`, `:562`, `:750`) write recomputed order header totals.
- **2.4 Tag `mapQuoteLineEntityToSnapshot` as stored-row sourced.** The quote mapper stays its own function (different entity type) but carries the same origin flag.

### Phase 3 — request schema and upsert decomposition

- **3.1 Add `discountAmountBasis` to the shared `linePricingSchema`** in `data/validators.ts` only. It is spread into the order and quote line schemas and through them into the update partials and `DocumentLineCreateInput`, so one edit covers every surface the engine sees.
- **3.2 Decompose the coalescing chain at `sales.orders.lines.upsert`** (`documents.ts:7270`) per operand — a caller amount carries its basis, a stored amount carries the stored-row flag. `?? 0` becomes `?? null` so "explicitly zero" stays distinguishable from "not supplied".
- **3.3 Decompose the coalescing chain at `sales.quotes.lines.upsert`** (`:7764`), identically.
- **3.4 Carry the caller basis through `createLineSnapshotFromInput`**, defaulting to `'unit'` so no existing caller changes.

### Phase 4 — command tests

- **4.1 Order and quote upsert idempotency** — create then upsert a percentage-only line at quantity above 1 and assert neither the stored amount nor the net moves.
- **4.2 Upsert-existing without re-sending the amount** — asserts the stored line total is not multiplied by quantity; this is the case that fails if the chain is left merged.
- **4.3 Return create then delete** leaves the order header's `discountTotalAmount`, `grandTotal*`, `outstandingAmount` and `totalsSnapshot` byte-identical to their pre-return values.
- **4.4 The § 3 producer invariant** — mappers never set `discountAmountBasis`, request schemas never populate `discountAmountFromStoredRow` (criterion 9).

### Phase 5 — the draft-lines site and the upgrade note

- **5.1 Resolve the per-unit reading in `SalesOrderDraftLines.tsx`** and document the reasoning rather than leaving it ambiguous.
- **5.2 `UPGRADE_NOTES.md` entry** covering all three behaviour-change rows, with D3 called out as the inverting one.

### Phase 6 — integration

- **6.1 Integration spec** `packages/core/src/modules/sales/__integration__/TC-SALES-5019-line-discount-idempotency.spec.ts`, self-contained with API-created fixtures and teardown cleanup.

### Phase 7 — follow-ups

- **7.1 File the D5 operator-CLI follow-up issue** and link it from the spec and the PR body.
- **7.2 File the adjacent `totalNetAmount` follow-up issue** — the spec's § Out of Scope notes that `totalNetAmount` is accepted and validated but never read by `buildBaseLineResult`, and that no upstream issue exists for it.

## Risks

- **Percentage-first is a real behaviour change on an unversioned contract.** It is not expressible as a type change, which is why Step 5.2 exists; the escape (`discountPercent: 0`) has to be documented, not merely implemented.
- **D3 inverts rather than drops.** An integration that used `discountAmount: 0` to work around this very defect starts discounting, potentially on a unit price already net of it. Loud upgrade note, explicit test.
- **The returns-local mapper is the easy miss.** A fix scoped to `documents.ts` satisfies every other acceptance criterion while leaving the return flows broken; Step 2.3 and test 4.3 exist specifically to close that.
- **Recalculation now changes totals on documents whose rows are currently wrong.** That is the fix, but it lands on the next write to each document rather than at deploy time.

## External References

None. No `--skill-url` was passed.
