# Sales — Recurring Orders

| Field | Value |
|-------|-------|
| **Status** | Draft — for review with the sales maintainers |
| **Created** | 2026-10-21 |
| **Module** | `sales` (`packages/core/src/modules/sales`) — additive change |
| **Touches** | `scheduler` (one module-registered system schedule, optional peer) |
| **First consumer** | `property_management` leases (`.ai/specs/2026-10-15-property-management.md`) |

## 📝 TLDR

**Key Points:**
- A sales order can be **recurring**: a **start date**, a **frequency** (weekly, monthly, quarterly, yearly) and either a **number of periods** or no end. The end date is derived, never typed, so every period is whole.
- A scheduled sales job issues the **invoice for each period** once its **anniversary** arrives, in advance, for the period that starts that day. Customers **pay per invoice**; the order's paid and outstanding amounts are derived from its invoices.
- A recurring order can be **cancelled** with an effective date (today, past or future). The effective date is the first day no longer served. The person cancelling chooses how the partly served period before it is settled — **prorate**, **credit or skip it entirely**, or **bill it in full** — pre-set to the organization's default.
- **Quotes carry the same recurrence**; a recurring quote cannot be accepted once its start date has passed.

**Scope:** recurrence on quotes and orders; conversion; invoice generation; per-invoice payment model; cancellation with settlement; organization default; UI; events.

**Out of scope:** changing a recurring order's schedule, lines or adjustments after its first invoice (a new recurring order is created instead); pausing; usage-based billing; automatic payment collection; payment terms and due dates (`dueDate` stays as today); refunds of credited amounts already paid (handled by the existing refund flows); daily frequency.

## Overview

Open Mercato's sales module turns quotes into orders and orders into invoices, one document at a time. Recurring orders add a schedule to that flow: an order (or the quote it comes from) can say "bill this every month from 1 October for 24 months", and sales issues those invoices itself. Operators of subscriptions, rentals and service contracts get repeat billing without each module building its own; the first consumer is `property_management`, whose leases each become one monthly recurring order.

## Decisions

Settled with the maintainer (2026-10-21):

| # | Decision |
|---|----------|
| R1 | Recurring orders are a sales feature with their own spec; consumers reference it. |
| R2 | Each invoice is issued once the period's anniversary has arrived and pays for the period that starts that day (in advance). |
| R3 | The term is a number of periods or open-ended; the end date is calculated and always closes a whole period. |
| R4 | Cancelling settles the partly served period before the effective date (the first day no longer served) in one of three ways — prorate by days, credit (or skip) it entirely, or bill it in full — defaulting to the organization's setting and overridable per cancellation. |
| R5 | Nothing that changes what is billed can be edited after the first invoice; a new recurring order is created instead. |
| R6 | Monthly and quarterly anniversaries on the 29th–31st fall on the last day of shorter months; a yearly one on 29 Feb falls on 28 Feb in common years. A recurrence may take an explicit anchor day so a follow-on order keeps the original billing day. |
| R7 | Quotes carry the recurrence; `sales.quotes.convert_to_order` copies it. A recurring quote whose start date has passed cannot be accepted or converted — a new quote is needed. |
| R8 | Customers pay per invoice. For a recurring order, the order's paid and outstanding amounts are derived from its issued invoices, credit memos and payments; payment gateways charge the oldest unpaid invoice. |
| R9 | Order-level adjustments (discounts, surcharges, shipping) apply to every period's invoice. |
| R10 | Only *Cancel recurring order* stops a recurring order: setting an active recurring order to the canceled or on-hold status is refused, with a pointer to the cancel action. There is no pause. |

## 📝 Problem Statement

Anything sold by subscription or by term — a lease, a maintenance contract, a membership — needs one agreement billed repeatedly. Today a sales order is billed once, or by hand invoice by invoice: sales has no recurrence, no schedule and no job that issues invoices. Each module that needs it would build its own ledger, worker and crash recovery around `sales.invoices.create`, which commits on its own — the property-management spec had to design exactly that, and its reviews kept finding races in it. Recurring billing belongs in sales, where invoice creation and its bookkeeping can share one transaction.

## 📝 Proposed Solution

Add a recurrence to quotes and orders, stored in two small sales-owned tables. A sales worker, scheduled once for the whole system, finds recurring orders whose next anniversary has arrived and issues each due period's invoice — invoice and period ledger row in **one transaction**, through the regular `sales.invoices.create` command running on the worker's transaction. Cancellation records an effective date; billing continues until it, and the period containing it is settled as chosen.

> **Market Reference:**
> - **Odoo Subscriptions** — a subscription is a sale order with a recurrence plan; invoices are generated on the "next invoice date", in advance; payments are against invoices. **Adopted:** recurrence on the order, generation in advance, pay per invoice. **Rejected:** subscription templates and upsell flows.
> - **Stripe Billing** — anchor-date billing with month-end clamping; cancel at period end or immediately, with or without proration. **Adopted:** anchor clamping and an explicit anchor (R6), future-dated cancellation with a settlement choice (R4). **Rejected:** mid-period plan changes with automatic proration (R5).
> - **ERPNext Subscription** — scheduler-generated sales invoices per period, with a "prorate" switch. **Adopted:** scheduler-driven generation; prorate as one settlement.

### Alternatives Considered

| Alternative | Why rejected |
|-------------|--------------|
| Each consuming module bills on its own schedule | Duplicates a ledger, worker and recovery in every module, each needing cross-module compensation. |
| Recurrence columns on `sales_orders` / `sales_quotes` | Widens two hot tables for a minority of orders; separate 1:1 tables keep the existing entities untouched. |
| Editable schedule and price after the first invoice | Needs period-splitting rules for every edit; R5 keeps each recurring order immutable once billing starts. |
| Writing invoices from the worker through extracted helpers | Bypasses the command bus — no action log, undo, interceptors or mutation guards. The commands accept the caller's transaction instead, as `convert_to_order` already does. |

## 📝 Architecture

```
quote (+ SalesQuoteRecurrence) ──convert_to_order──▶ order (+ SalesOrderRecurrence)
                                                             │
scheduler (system scope, hourly) ──▶ queue sales.recurring_invoicing ──▶ worker
                                                             │  per due period, one transaction:
                                                             │  lock recurrence → re-check cutoff → ledger row → sales.invoices.create (same tx)
                                                             ▼
                                              SalesInvoice (+ SalesRecurringPeriod)
cancel ──▶ sales.orders.recurrence.cancel ──▶ record effective date + settlement; settle what is already invoiced
```

| Component | Responsibility |
|-----------|----------------|
| `lib/recurrence.ts` (pure) | `anniversary(startsOn, anchorDay, frequency, index)` with clamping (R6); `endsOn(…, periodCount)`; `periodBounds(index)`; `prorationFactor(effectiveOn, periodStart, periodEnd)` (days used ÷ days in period, 4 decimals); `settlementFor(period, effectiveOn, settlement)`. |
| `commands/recurrence.ts` | Recurrence set/replace/remove on quotes and orders before the first invoice; `sales.orders.recurrence.cancel`. |
| `sales.invoices.create`, `sales.credit_memos.create` | Gain `ctx.transactionalEm` support, as `sales.quotes.convert_to_order` has (`documents.ts` ~6721–6727, 7069–7074): when the caller supplies a transaction they write on it and their post-commit work runs after the caller commits. Behaviour without it is unchanged. |
| `workers/recurring-invoicing.ts` | Queue `sales.recurring_invoicing`, concurrency 1; issues every due period across organizations, oldest first. |
| `setup.ts` | Registers **one system-scope schedule** with the optional `schedulerService` (`scopeType: 'system'`, `interval` `3600s`, `targetType: 'queue'`, `sourceModule: 'sales'`; precedent: `registerDomainSchedules` in `customer_accounts/setup.ts` `seedDefaults`, the pattern `payment_gateways`, `checkout` and `ai-assistant` follow), from `seedDefaults` and idempotently on every worker start. The schedule is one system row, not per tenant, so no tenant-creation hook registers it; the worker-start registration covers existing deployments and tenants added later without re-running `seedDefaults`. The CLI `mercato sales run-recurring-invoicing` runs the same path. |
| `services/paymentOrderTotalResolver.ts` | For recurring orders, the amount due is the oldest unpaid invoice's outstanding amount (R8). |

**Time.** Anniversaries are calendar dates; "today" is the deployment's local date (`TZ`), computed in Node and passed to SQL as a parameter — never the database's `now()`/`current_date`, which follow the session `TimeZone`. Deployments set `TZ` to the organizations' business timezone (containers default to UTC). A period is due from 00:00 on its anniversary and is issued at the next hourly run. There is no per-organization timezone: an organization whose local day differs from the deployment's sees its invoices issued, and its cancellation cutoffs applied, on the deployment's day — up to one calendar day early or late near midnight. This is the same documented limitation as in `2026-10-15-property-management.md`; an optional organization timezone can be added later as a nullable `sales_settings` column without migrating stored dates (see Risks).

## 📝 Data Model

All new tables carry `organization_id`, `tenant_id`, `created_at`, `updated_at`; existing tables gain only one additive `sales_settings` column.

### SalesQuoteRecurrence (`sales_quote_recurrences`)
`quote_id` (unique, `on delete cascade`), `frequency` (`weekly|monthly|quarterly|yearly`), `starts_on` (date), `anchor_day` (int 1–31, nullable = day of `starts_on`), `period_count` (int ≥ 1, null = open-ended). Removed inside `convert_to_order`'s transaction when the quote is deleted.

### SalesOrderRecurrence (`sales_order_recurrences`)
`order_id` (unique), `frequency`, `starts_on`, `anchor_day`, `period_count`, `ends_on` (derived; null when open-ended), `next_period_index` (0-based), `next_invoice_on`, `status` (`scheduled|active|cancelling|completed|cancelled`), `schedule_version` (int, the optimistic-lock token for schedule actions), cancellation fields — `cancel_requested_at`, `cancel_effective_on`, `cancel_settlement` (`prorate|credit_full|keep`), `cancelled_by_user_id`, `cancel_idempotency_key`, `cancel_result` (json: credit memo ids). Index `(status, next_invoice_on)` for the system-wide scan, and `(organization_id, status)`.

Order lines and order-level adjustments describe **one period's charge**; the order's own totals are therefore the per-period amount, labelled "per month" (etc.) on the order. What the customer owes overall lives on the invoices (R8).

### SalesRecurringPeriod (`sales_recurring_periods`) — the ledger
`order_id`, `period_index`, `period_start`, `period_end`, `invoice_id` (nullable — null when a cancellation skipped the period), `billed_factor` (1, or the prorated factor when the period was issued already prorated), `credit_memo_id`, `credited_factor`, `events_emitted_at`. **Unique `(order_id, period_index)`**, inserted with `ON CONFLICT DO NOTHING` (a conflict means the period exists — skip it).

### SalesSettings — additive column
`recurring_cancel_settlement` (`prorate|credit_full|keep`, default `keep`). Saved through `sales.settings.save`; the dedicated route merges the existing number formats into the payload, as `api/settings/order-editing` does.

## 📝 Behaviour

### Creating
- `sales.quotes.create/update` and `sales.orders.create/update` accept `recurrence: { frequency, startsOn, anchorDay?, periodCount? } | null` (`null` removes it before the first invoice). `periodCount ≥ 1` when present; `anchorDay` defaults to the day of `startsOn`. A recurring quote needs at least one line **when it is sent or converted**, not when created.
- The order recurrence is written inside `sales.orders.create`'s own `withAtomicFlush` and, during conversion, on the caller-supplied EntityManager, so it commits with the order.
- **Acceptance and conversion after the start date are refused** (`422 recurring_quote_started`): the public accept route, `convert_to_order` and any caller check `starts_on ≥ today` (R7). The quote page and the quote email show the schedule ("Monthly from 1 Oct 2026, 24 payments").
- The order recurrence is `scheduled` until its first invoice, then `active`.

### What is locked (R5, R10)
Once a recurrence has an issued period, these are refused with `409 recurring_order_locked`: `sales.orders.update` changes to currency, channel, customer, tax info or methods; `sales.orders.lines.upsert/delete`; `sales.orders.adjustments.upsert/delete`; recurrence set/replace/remove. Setting the order's status to `canceled` or `on_hold` is refused with `409 recurring_order_use_cancel` while the recurrence is `scheduled`, `active` or `cancelling`. `sales.orders.delete` is refused with `409 recurring_order_invoiced` while any period exists — checked under the recurrence row lock; an order with an unbilled recurrence is deleted together with it.

### Invoicing (R2)
The worker selects recurrences with `status in (scheduled, active, cancelling)` and `next_invoice_on ≤ today`, oldest first, across organizations. For each due period, **one transaction**:
1. lock the recurrence (`SELECT … FOR UPDATE`), re-read `status`, `cancel_effective_on`, `cancel_settlement` and `next_period_index`;
2. compute the period; if a cancellation cutoff applies, settle it here (see Cancelling) — the period may be skipped, issued prorated, or issued in full;
3. insert the ledger row (`ON CONFLICT DO NOTHING`; conflict → skip the period);
4. dispatch `sales.invoices.create` with `ctx.transactionalEm` — lines from the order lines, order-level adjustments applied (R9), quantities scaled by the period's billed factor, totals from `salesCalculationService.calculateDocumentTotals({ documentKind: 'invoice' })`, `issueDate` = **today** (the actual issue day), `outstandingAmount` = grand total gross, `metadata.recurringPeriod = { index, start, end }`; the command keeps its action log, interceptors and guards;
5. advance `next_period_index` / `next_invoice_on`; after a finite recurrence's last period, set `next_invoice_on = ends_on + 1 day` so the next run marks it `completed`.

Commit; the invoice command's post-commit work and `sales.recurring_order.invoice_issued` then run. If the process dies after commit and before those events, the next run re-emits `invoice_issued` for ledger rows with `events_emitted_at` unset (an `events_emitted_at` column on the ledger row). Missed runs catch up oldest first, each invoice issued with today's date and the period it covers in `metadata.recurringPeriod`.

Invoice numbers come from the existing number generator, whose Postgres sequence is not transactional: a rolled-back period leaves a gap in invoice numbers, as any rolled-back invoice does today.

### Money (R8)
- For a recurring order, `paid_total`, `refunded_total` and `outstanding` on the order are **derived**: sums over its invoices (outstanding after credits and payments). They are recomputed when an invoice, credit memo, payment or allocation of the order changes.
- `sales.credit_memos.create` against an invoice reduces that invoice's `outstanding` by the memo's gross amount, floored at zero (for every invoice, not only recurring ones — today a credit memo leaves the invoice's outstanding untouched). A credit beyond what is still outstanding is credit the customer is owed; refunding it uses the existing refund flows.
- `resolveOrderAmountDue` returns the oldest unpaid invoice's outstanding for a recurring order; payments are allocated to invoices. This is a new branch: the current implementation (`services/paymentOrderTotalResolver.ts`) reads only the order's own totals and stays unchanged for non-recurring orders.
- Sales analytics and the new-orders widget count a recurring order's **invoiced** amounts, not its per-period grand total.

### Cancelling (R4)
`sales.orders.recurrence.cancel { orderId, effectiveOn?, settlement?, idempotencyKey }` — `effectiveOn` defaults to today; `settlement` defaults to `sales_settings.recurring_cancel_settlement`. `effectiveOn` is the **first day no longer served** (exclusive): a customer who leaves on 14 March has `effectiveOn` = 15 March. It locks the recurrence (`SELECT … FOR UPDATE`, waiting for a running worker), then:
- **Cutoff:** no period starting on or after `effectiveOn` will be billed. Periods already issued that start on or after it are credited in full.
- **Final period:** the period that contains `effectiveOn` and **starts before it** (days used = from its start to the day before `effectiveOn`). When `effectiveOn` is a period start there is no final period: the period starting that day is cut like any later one, the period before it was fully served, and the settlement has nothing to settle — so `keep` can never bill a period that the cutoff excludes.
- **Settlement of the final period**:
  - already issued → `prorate`: credit memo for (1 − days used ÷ days in period) of each line; `credit_full`: credit memo for the whole invoice; `keep`: nothing;
  - not yet issued (future effective date) → recorded; when the worker reaches it, `prorate` issues it already prorated (billed factor = days used ÷ days in period), `credit_full` skips it (ledger row, no invoice), `keep` issues it in full.
- **Status:** `cancelled` when the final period is settled (immediately for today or a past date), otherwise `cancelling` — billing continues up to the cutoff. With no final period (`effectiveOn` is a period start), it becomes `cancelled` at once when `effectiveOn` ≤ today, and otherwise when the worker reaches `effectiveOn` and finds nothing left to bill.
- A `cancelling` recurrence can be cancelled again with an **earlier** effective date (re-settles as above); a later date is refused.
- Credit memos are created with `sales.credit_memos.create` on the cancel's transaction. The result (credit memo ids) is stored on the recurrence with the idempotency key: a repeat call with the same key returns it with `200`; a different key on a cancelled recurrence gets `409 recurring_order_already_cancelled`.

## 📝 API Contracts

- Quote and order create/update: optional `recurrence` (above). Responses include `recurrence` with `endsOn`, `nextInvoiceOn`, `status`, `scheduleVersion`.
- `GET /api/sales/orders/{id}/recurrence` → schedule, cancellation, and periods (`periodIndex`, `periodStart`, `periodEnd`, `billedFactor`, `invoiceId`, `creditMemoId`, `creditedFactor`). `sales.orders.view`.
- `POST /api/sales/orders/{id}/recurrence/cancel` `{ effectiveOn?, settlement?: 'prorate'|'credit_full'|'keep', idempotencyKey, scheduleVersion }` → `200 { status, cancelEffectiveOn, creditMemoIds }`. `409` on a stale `scheduleVersion`, a later effective date than a pending one, or another key after cancellation. Requires `sales.orders.manage` **and** `sales.credit_memos.manage`. Mutation guards apply.
- `GET`/`PUT /api/sales/settings/recurring` `{ cancelSettlement }` — `sales.settings.manage`.
- CLI `mercato sales run-recurring-invoicing [--org <id>]`.

**Events (additive):** `sales.recurring_order.invoice_issued` (`orderId`, `invoiceId`, `periodIndex`, `periodStart`, `periodEnd`), `sales.recurring_order.cancelled` (`orderId`, `effectiveOn`, `settlement`, `creditMemoIds`, `final`), `sales.recurring_order.completed`. No broadcast flags.

## 📝 UI/UX

- **Quote and order create/edit**: a *Recurring* switch with frequency, start date and *Number of periods* (or *No end date*), showing the calculated end and first invoice dates; disabled once locked.
- **Order detail**: a *Recurrence* section (spot `sales.document.detail.order:details`) — schedule, next invoice date, status (including *Cancelling — billing ends 31 Dec*), periods with invoice and credit links, outstanding across invoices, and *Cancel recurring order*.
- **Cancel dialog**: effective date (default today; past and future allowed), settlement radio pre-set to the organization default, and a preview of what happens — "credit 1,240 zł on INV-…", "the December invoice will be prorated (16/31)", "the December invoice will not be issued". `Cmd/Ctrl+Enter` confirms, `Escape` cancels.
- **Quote page and email**: the schedule line.
- **Orders list**: *Recurring* column and filter. **Sales settings**: *Default settlement when a recurring order is cancelled*.
- A banner on recurring order details when the scheduler is missing **or** the system schedule row is absent.
- i18n under `sales.recurring.*`; DS tokens and primitives only.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|----------|-----------|
| Worker crashes mid-period | The transaction rolls back (an invoice-number gap may remain); the next run issues the period. |
| Two workers or the CLI run at once | Row lock on the recurrence plus the unique ledger key: each period is issued once. |
| Cancel while the worker issues a period | The cancel waits for the recurrence lock; the worker re-reads the cutoff inside each period's transaction. |
| Quote accepted after its start date | `422 recurring_quote_started`; a new quote is needed. |
| Generated invoice deleted | `sales.invoices.delete` is refused for an invoice linked to a ledger row (`409 recurring_invoice`); corrections use credit memos. |
| Order set to canceled / on hold | Refused while the recurrence is not finished (R10). |
| Order deleted | Refused while any period exists; otherwise deleted with its recurrence. |
| Scheduler absent or schedule row missing | No automatic invoices; banner; the CLI issues due periods. |
| Credit on an invoice already paid | The invoice's outstanding floors at zero; the excess is customer credit, refunded through existing flows. |

## 📝 Risks & Impact Review

| Risk | Affected area | Severity | Mitigation | Residual |
|------|---------------|----------|------------|----------|
| Duplicate invoice for a period | invoicing | High | One transaction for ledger row + invoice; recurrence row lock; `ON CONFLICT DO NOTHING` | Low |
| Unbilled months after a future-dated cancellation | invoicing, consumers | High | `cancelling` keeps billing until the cutoff; tests with future effective dates | Low |
| Payment gateways or KPIs misread a recurring order | payments, analytics | High | Derived order money fields; resolver uses invoices; analytics use invoiced amounts | Low |
| Missed invoices when the schedule is missing | invoicing | Medium | System schedule registered on worker start; banner; CLI | Low |
| Organizations in different timezones in one deployment | invoicing, cancellation | Medium | Anniversaries are calendar dates and "today" is the deployment clock (`TZ`), so an organization in another timezone gets invoices and cutoffs up to one day off near midnight — documented limitation, as in the property-management spec; an optional organization timezone can be added later as a nullable `sales_settings` column without migrating stored dates | Low |
| Behaviour change: credit memos now reduce invoice outstanding | invoices, payments | Medium | Documented in UPGRADE_NOTES; previously outstanding stayed overstated after a credit | Low |
| Lost post-commit events after a crash | integrations, consumers | Low | `events_emitted_at` on the ledger row; re-emission on the next run | Low |

## Migration & Backward Compatibility

- New tables; one additive `sales_settings` column; an additive `events_emitted_at` on the new ledger. No existing column or index changes.
- Optional `recurrence` on existing create/update schemas and responses; optional `ctx.transactionalEm` support in `sales.invoices.create` and `sales.credit_memos.create` (behaviour without it unchanged).
- **Behaviour changes, documented in `UPGRADE_NOTES.md`:** (1) a credit memo against an invoice now reduces that invoice's `outstanding`; (2) `sales.invoices.delete` refuses invoices generated by a recurrence; (3) `sales.orders.delete` and the canceled/on-hold status changes are refused for recurring orders as described. None affects non-recurring orders except (1), which corrects an overstated outstanding.
- New events, routes, CLI command, queue and settings field are additive surfaces, frozen once released.

## 📋 Phasing

1. **Recurrence on quotes and orders** — tables, `lib/recurrence.ts`, create/update/convert, the locks, start-date guard, form fields, quote page/email line, read-only order section.
2. **Invoicing and money** — transactional-EM support in the invoice and credit-memo commands, worker, system schedule, CLI, derived order money fields, resolver, analytics, events.
3. **Cancellation** — command with past/today/future effective dates, settlement, idempotency, settings default, cancel dialog.

## 📋 Implementation Plan

### Phase 1
1. Entities and migration; `lib/recurrence.ts`. *Unit tests:* anniversaries per frequency including 31 Jan monthly, 31 Aug quarterly, 29 Feb yearly and an explicit anchor day 31 starting on 30 Apr; `endsOn` for 1, 12 and 24 periods; proration factors.
2. `recurrence` on quote and order create/update (`null` removes it); convert copies it and removes the quote recurrence in the same transaction. *Integration:* a recurring quote converts to a recurring order with the same schedule; an order without recurrence is unchanged; converting or accepting after the start date → `422`.
3. Locks and status guards. *Integration:* after a period exists, line/adjustment/order edits → `409`; status change to canceled → `409 recurring_order_use_cancel`; delete → `409 recurring_order_invoiced`.
4. Form fields, order-detail section, quote page and email line. *Playwright:* creating a monthly order shows the calculated end date; the public quote page shows the schedule.

### Phase 2
1. `ctx.transactionalEm` in `sales.invoices.create` / `sales.credit_memos.create`. *Integration:* with a caller transaction that rolls back, no invoice and no events exist; without one, behaviour is unchanged.
2. Worker, system schedule (registered on worker start), CLI. *Integration:* a monthly order whose start was two anniversaries ago at creation time (created through the internal command, bypassing the quote guard) gets two invoices issued today, each with its period in metadata; a second run issues nothing; two concurrent runs issue each period once; order adjustments appear on every invoice; totals equal `salesCalculationService`'s.
3. Money: derived order totals, credit memos reduce invoice outstanding, resolver, analytics. *Integration:* after month 1 is paid, the amount due is month 2's invoice; a credit memo reduces its invoice's outstanding; analytics count invoiced amounts.
4. Events, re-emission, completion. *Integration:* a 3-period order is `completed` after its third period ends; a crash between commit and events re-emits `invoice_issued` once.

### Phase 3
1. `sales.orders.recurrence.cancel`. *Integration:* today + prorate → credit memo for the remainder; past date → later issued periods credited in full; **future date** + prorate → billing continues, the final period is issued prorated, then `cancelled`; future + `credit_full` → the final period is not issued; moving a pending cancellation earlier re-settles; **boundaries** — `effectiveOn` equal to a period start with `keep` issues nothing for that period and no credit for the one before it, and `effectiveOn` the day after a period's last day behaves the same; a repeat call with the same idempotency key returns the stored result; a stale `scheduleVersion` → `409`; without `sales.credit_memos.manage` → `403`.
2. Settings default (merging number formats) and cancel dialog. *Integration:* `GET`/`PUT /settings/recurring`. *Playwright:* the dialog previews the credit and creates it.

## Final Compliance Report — 2026-10-21

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| sales AGENTS.md | `salesCalculationService` for document math | Compliant | Invoice and credit-memo totals, proration per line with tax |
| sales AGENTS.md | Quote → Order → Invoice; channel scoping | Compliant | Recurrence rides on existing documents and the order's channel |
| sales AGENTS.md | Never skip configured workflow states | Compliant | Status changes that would bypass the recurrence are refused (R10) |
| core AGENTS.md / root | Commands for writes; never bypass command side effects | Compliant | The worker dispatches `sales.invoices.create` / `sales.credit_memos.create` through the bus on its transaction |
| core AGENTS.md | Idempotent workers via `@open-mercato/queue` | Compliant | Ledger key, row lock, re-emission marker |
| root AGENTS.md | Optimistic locking on editable entities | Compliant | `schedule_version` on schedule actions; `updated_at` on the tables |
| BACKWARD_COMPATIBILITY.md | Behaviour changes documented | Compliant | Three behaviour changes listed for `UPGRADE_NOTES.md` |
| root AGENTS.md | Ask before cross-module or contract changes | Pending | Requires the sales maintainers' agreement (this spec) |

## Changelog

### 2026-10-21
- Initial specification from the property-management review: recurrence on quotes and orders, anniversary invoicing in advance, cancellation with an organization-default settlement (R1–R7, decided with the maintainer).
- Revised after an adversarial review (maintainer decisions R8–R10): pay per invoice with derived order totals; adjustments apply to every period; a recurring quote cannot be accepted after its start date; only *Cancel recurring order* stops a recurring order. Future-dated cancellations keep billing until the cutoff (`cancelling`) and settle the final period when it comes due; the worker dispatches the invoice and credit-memo commands on its own transaction instead of bypassing the bus; one system-scope schedule covers existing deployments; recurrence row locking shared by cancel and worker; explicit anchor day; idempotent cancel; issue date is the actual issue day; invoices generated by a recurrence cannot be deleted; credit memos reduce invoice outstanding.

### 2026-10-22
- Review of #7765 by `om-auto-review-pr`: the single-deployment `TZ` assumption is documented in Architecture → Time and as a Risks row (mirroring the property-management spec); the system schedule's registration now cites `seedDefaults` (`customer_accounts/setup.ts` `registerDomainSchedules`) plus worker start, with no tenant-creation hook; the recurring-order branch of `resolveOrderAmountDue` is marked as new logic.

### 2026-10-26
- From the review of #7472: `effectiveOn` is defined as the first day no longer served (decision R4 and the overview reworded to match); the final period is the one containing it that starts before it, so a cancellation at a period start settles nothing and `keep` can never bill a cut-off period (boundary tests added); a cancellation with no final period becomes `cancelled` at the cutoff. "Today" is computed in Node and passed to SQL; deployments set `TZ` to the business timezone.
