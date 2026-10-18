# Sales order due date: update, read, sort and filter

## TLDR

- `SalesOrder.dueAt` (`sales_orders.due_at`) is accepted on order create but cannot be changed afterwards, is never returned by the documents API, and cannot be sorted or filtered.
- `PUT /api/sales/orders` accepts `dueAt` (`YYYY-MM-DD` or `null`); `GET /api/sales/orders` returns it, sorts on it (`sortField=dueAt`) and bounds it (`dueFrom` / `dueTo`).
- Additive only: no migration (the column exists), no removed or renamed fields, no UI change.

## Overview

An order paid on terms — the invoice is due N days after the order — carries a payment due date. A client that keeps orders in sync with an external system sets that date on create and must be able to move or clear it later, read it back, and list the orders past it ("overdue"). The column and the create input already exist; every later step was missing.

The reference for every step is `expectedDeliveryAt`, the order-only date column handled the same way on update, projection and response.

## Problem Statement

1. **Not writable on update.** `documentUpdateSchema` (`commands/documents.ts`) is a closed `z.object` without `dueAt`, so the key is stripped and the update reports success having written nothing.
2. **Not served.** `due_at` is in neither `commonFields` nor `orderOnlyFields` in `api/documents/factory.ts`, so a client that wrote it cannot read it back.
3. **Not sortable or filterable.** The list has no sort key and no range parameter on `due_at`, so "orders past their payment due date" cannot be expressed.

## Proposed Solution

- Add `dueAt` to `documentUpdateSchema`'s order-only group and to its empty-payload `.refine()`. `applyDocumentUpdate` sets it from a calendar date, clears it on `null`, and leaves it untouched when omitted.
- Reject `dueAt` on a quote update with a 400, like `internalNotes`, `exchangeRate` and the status entry ids.
- Report `dueAt` in the update's audit change keys. Snapshots and undo already carry it.
- Add `due_at` to the order-only projection; map it to `dueAt` on list items, the update response and the OpenAPI item schema.
- Add `sortField=dueAt` and `dueFrom` / `dueTo` for orders.

### Design Decisions

| Decision | Rationale |
|---|---|
| Reject `dueAt` on quotes rather than drop it as `expectedDeliveryAt` is dropped | `dueAt` satisfies the empty-payload refine on its own. Dropping it would let a payload carrying only `dueAt` reach execution, and `updateQuoteCommand` reverts a sent quote to draft and clears its acceptance link on any update that gets that far. |
| Ignore `dueFrom` / `dueTo` / `sortField=dueAt` on the quotes list rather than reject them | No earlier order-only list parameter exists to copy; ignoring matches how the query engine already drops a sort on a column the table lacks, and list parsing elsewhere ignores unparseable values rather than failing. |
| A date-only `dueTo` covers the whole UTC day | Order create accepts a full timestamp for `dueAt`, so an order can be due at 15:00. A date-only `dueTo=D` therefore becomes `due_at < D+1 00:00Z` rather than `<= D 00:00Z`, which would drop it. A timestamp `dueTo` is used as given (`$lte`). `dueFrom` needs no expansion: a date-only lower bound already starts at the day's midnight. An unparseable bound is ignored, like `dateFrom` / `dateTo`. |
| Validate the update date as a real calendar day | `new Date("2026-02-31")` rolls over to 2026-03-03. The shared `dateOnlySchema` (also used by `placedAt` and `expectedDeliveryAt`) now round-trips the parsed date, so a nonexistent day is a 400 instead of a silently different day. |

## Architecture

No new modules, routes, commands, events or entities. Changes are confined to `packages/core/src/modules/sales`:

- `commands/documents.ts` — update schema, `applyDocumentUpdate`, `buildDocumentUpdateChangeKeys`, `dateOnlySchema`.
- `api/documents/factory.ts` — list query schema, `buildFilters`, `buildSortMap`, order-only projection, `transformItem`, `mapUpdateResponse`, OpenAPI item schema.
- `i18n/{en,pl,de,es,ko}.json` — `sales.quotes.due_at_unsupported`.

## Data Models

Unchanged. `sales_orders.due_at timestamptz null` already exists. A date-only input is stored as midnight UTC, like `expected_delivery_at`.

## API Contracts

### `PUT /api/sales/orders`

| Field | Type | Behaviour |
|---|---|---|
| `dueAt` | `"YYYY-MM-DD" \| null`, optional | Sets the due date; `null` clears it; omitted leaves it unchanged. A nonexistent calendar day returns 400. |

Response gains `dueAt: string \| null` (ISO timestamp).

### `PUT /api/sales/quotes`

`dueAt` returns 400 `sales.quotes.due_at_unsupported` ("Due date is not available on quotes.").

### `GET /api/sales/orders`

| Parameter | Behaviour |
|---|---|
| `sortField=dueAt` | Orders by `due_at`, with `sortDir`. |
| `dueFrom` | `due_at >= dueFrom`, inclusive. Unparseable → ignored. |
| `dueTo` | Date-only `YYYY-MM-DD`: `due_at < dueTo + 1 day` (the whole UTC day). Timestamp: `due_at <= dueTo`. Unparseable → ignored. |

An order with no due date never matches `dueFrom` / `dueTo`. Each item gains `dueAt: string \| null`, in both the grid projection and the `?id=` detail projection.

### `GET /api/sales/quotes`

`dueFrom`, `dueTo` and `sortField=dueAt` are accepted by the shared query schema and ignored. Items carry no `dueAt`.

## Integration Coverage

`packages/core/src/modules/sales/__integration__/TC-SALES-045-order-due-at.spec.ts`:

| Path | Covered behaviour |
|---|---|
| `GET /api/sales/orders?ids=` | List serves `dueAt`, `null` for an order without one |
| `GET /api/sales/orders?id=` | Detail serves `dueAt` |
| `PUT /api/sales/orders` | Set → move → untouched when omitted → clear |
| `GET /api/sales/orders?sortField=dueAt` | Ascending and descending order |
| `GET /api/sales/orders?dueFrom=&dueTo=` | Inclusive bounds; an order without a due date is excluded |
| `POST` → `GET /api/sales/orders?dueTo=` | An order created with a non-midnight due timestamp matches a date-only `dueTo` on its day and a timestamp `dueTo` at or after its time, not before |
| `PUT /api/sales/quotes` | `dueAt` returns 400 |

No UI path changes.

## Migration & Backward Compatibility

- **API routes (STABLE, `BACKWARD_COMPATIBILITY.md` §7):** only new optional request fields (`dueAt` on update, `dueFrom` / `dueTo` on list) and a new optional response field (`dueAt`). No route, method or field is removed or renamed.
- **Database schema:** unchanged; no migration.
- **Behaviour change for invalid input:** `placedAt` and `expectedDeliveryAt` on `PUT /api/sales/orders|quotes` now reject a nonexistent calendar day (for example `2026-02-31`) with a 400. Previously such a value was accepted and stored as a different day, so no valid caller is affected.
- **Behaviour change on quotes:** a quote update carrying `dueAt` returns 400. Before this change the key was stripped and, when it was the only field, the payload failed the empty-payload check with a 400 as well; callers sending it alongside other fields previously had it dropped silently.
- No `UPGRADE_NOTES.md` entry: nothing is deprecated or removed.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| A caller relied on `2026-02-31`-style input being accepted for `placedAt` / `expectedDeliveryAt` | Low | Order/quote update API | Such input already stored a different day than requested; a 400 surfaces the bug instead | Low |
| A quote client sends `dueAt` alongside other fields and now gets a 400 | Low | Quote update API | Quotes never had the column; the error message names the field | Low |
| `sortField=dueAt` on quotes | Low | Quote list | Not mapped; the query engine drops a sort on a column the table lacks | None |
| Timezone of a date-only `dueTo` | Low | Order list filter | A date-only `dueTo=D` covers all of `D` in UTC, including due timestamps written by create; a caller in another zone passes an explicit timestamp bound | Low |

## Final Compliance Report — 2026-10-14

- Tenant/organization scoping: unchanged — the list and update routes keep their existing scope handling.
- Commands: writes stay in `sales.orders.update`; audit change keys and undo snapshots cover `dueAt`.
- i18n: the new user-facing error is translated in all five locales.
- No generated files, migrations, ACL features, events or UI touched.
- Tests: unit tests for the schema, command, audit, undo, factory and routes; integration test TC-SALES-045.

## Changelog

- 2026-10-14 — Spec written alongside the implementation. Added the calendar-day check to `dateOnlySchema` after review found that nonexistent days were silently rolled over.
- 2026-10-18 — A date-only `dueTo` now covers the whole UTC day (exclusive next-day bound); timestamp bounds are kept as given. Review found that an order created with a non-midnight due timestamp fell outside `dueTo` for its own day.
