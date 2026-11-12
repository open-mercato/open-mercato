## 📸 UI QA evidence — FAIL

**Targeted refund-lock fix: PASS in exercised cases. Complex QA: FAIL** because the earlier reader-action and return-tax failures reproduce in unchanged source. This is evidence-only; no QA approval is granted.

QA head: 07d5f2ca2979fcf98bf9c893377b446ef5dd00d2

Production Chromium1.61.1; local runner; independent tenant/role/user/order fixtures; English and explicitly selected Polish. App/database/browser stopped and source clean. Fifteen actual current-head PNGs are attached below.

### Findings

- **F1 / medium:** Reader can open enabled Addshipment without shipment-manage permission; server correctly403. [Unchanged source](https://github.com/open-mercato/open-mercato/blob/07d5f2ca2979fcf98bf9c893377b446ef5dd00d2/packages/core/src/modules/sales/components/documents/ShipmentsSection.tsx#L389).
- **F2 / high:** Return subtracts net/gross but tax remains27.60 rather than4.60; detail/API/CSV fail reconciliation. [Unchanged source](https://github.com/open-mercato/open-mercato/blob/07d5f2ca2979fcf98bf9c893377b446ef5dd00d2/packages/core/src/modules/sales/lib/calculations.ts#L352).

The historical review race is addressed by07d5f2ca: **ten real-PostgreSQL suite runs,30/30 tests**, plus focused14/14 and TC-SALES-0543/3 passed. These results do not close the human financial gate. #9364 concerns remaining pre-lock version/update reads; #9365 concerns update-guard policy; neither is the return-tax or reader-UI finding.

### Scenario results

| # | Action | Expected | Observed | Result |
|---|---|---|---|---|
| 1 | CLI: exact-head preparation and production boot | Packages build → generate → packages build; production app and authenticated readiness | All preparation passed; app build198s, readiness13s; cold and warm authenticated probes passed; WRITE flock1535124 held through teardown; listener1586338 cwd own apps/mercato at exact head. Boot RSS peak10.14GiB below21GiB; Rayon2/Nextworkers2. | PASS |
| 2 | CLI: focused refund guards and cancellation regression | Guard and cancellation tests pass | 2 suites /14 tests passed with core Jest config. | PASS |
| 3 | CLI: real PostgreSQL create/redo refund races, ten invocations | Create and redo see committed refund after waiting; non-refund control ships | 10 runs,30/30 tests passed on real PostgreSQL16. Each run independently creates/stops its test container. Encryption/side effects are mocked in this repository test; order locks and persistence are real. | PASS |
| 4 | CLI: TC-SALES-054 via repository environment runner | Full-refund API422, partial-refund control201, Addshipment UI refusal | 3/3 passed with OM_INTEGRATION_MODULES=sales. CLI reused exact owned production environment and provided complete test env. | PASS |
| 5 | UI: own tenant empty order list and own taxed order | 2×net50 at23%=net100+tax23=gross123 | Empty list rendered; VAT23 and zero-cost shipping method created through settings UI; custom line and order created through UI. Detail/API/DB agree100/23/123. | PASS / step-02-taxed-order-en.png |
| 6 | UI: record payment123, then prepaid shipment | Paid123/outstanding0, shipment201/fulfilled1 | Payment entered through UI keyboard submit; prepaid shipment created201. No-refund paid orders remain shippable. | PASS / step-04-prepaid-shipment-en.png |
| 7 | API: shipment create undo→redo→undo, then refund123 and redo | Fulfilled1→0→1→0; refunded redo422 with no domain writes | Initial stale undo-token reuse was rejected400 by audit API; after using the newly issued redo undo-token, lifecycle completed. Refund redo422; order/line/shipment/payment/item rows byte-equivalent before/after refusal. | PASS |
| 8 | UI English: refunded shipment create, keyboard retry, double submit, focus, Escape | Translated422; form remains usable; no writes | English message shown, keyboard submit422; focused quantity input and double-click retry422; Escape closed form; complete domain unchanged. | PASS / step-05-refunded-create-refused-en.png |
| 9 | UI Polish: explicitly select Polski, repeat refusal, long note and390px viewport | Polish message and usable mobile controls; no writes | Locale cookiepl; exact Polish refusal422; domain unchanged. Dialog width390 in390×844 viewport; long notes retained; Escape works. | PASS / step-07-refused-mobile-pl.png |
| 10 | API: full/excess/partial/deposit/unpaid/zero controls and ten refused retries | Full/excess422; partial/deposit/unpaid/zero201; repeated refusals atomic | All six statuses matched. Full/excess and ten repeats left all scoped domain rows unchanged; allowed controls fulfilled1. | PASS |
| 11 | UI/API: second actor changes reference while A has shipment-note draft | Stale shipment refuses without losing B reference; retry remains safe | B UI reference save persisted; mixed UI/API second-actor retry surfaced Record changed and closed A dialog. Full post-B domain unchanged; both B references preserved. Same-open-dialog second retry could not run because dialog closed; ten fresh direct API attempts subsequently422. | PARTIAL / step-08-second-actor-conflict-en.png |
| 12 | UI: reader has sales.orders.view and no sales.shipments.manage | Addshipment hidden/disabled | On canonical /backend/sales/orders/:id route, reader sees enabled Addshipment and can open dialog. Same prior finding; ShipmentsSection.tsx389/478 unchanged. Generic /documents/:id correctly denies reader because it additionally requires quotes.view. | FAIL / step-10-reader-opens-shipment-dialog.png |
| 13 | API: reader and other tenant negative controls | Reader mutation403; positive read200; tenantB sees no target and cannot write | Reader read200/1item; shipment POST403. TenantB GET200/0items and POST403 Cross-tenant relation forbidden. Whole target domain unchanged. | PASS |
| 14 | UI Polish: decimal-comma payment, reload, partial-refund shipment | 10,25 stores10.25; paid133.25-refund61.50=71.75; outstanding51.25; shipment201 | 10,25 USD redisplayed after reload. Stored10.2500; paid133.25/refund61.50/outstanding51.25. Remaining unit shipped201, fulfilled2/two active shipments; no main alert after10s. | PASS / step-12-partial-refund-shipment-success-pl.png |
| 15 | API: delete existing shipment after full refund, undo-delete, redo-delete; reverse main refund and retry refused create redo | Delete/restore semantics and money preserved; refund reversal permits redo | Delete/undo/redo all200; fulfillment1→0→1→0; paid/refunded123 preserved. Main refund reversed0, redo200/fulfilled1, then undo/restored refund123. | PASS |
| 16 | API: returned expensive goods refunded while cheap goods remain; return undo/redo | Refund123<paid147.60 allows remaining shipment; paid/refunded preserved | Correctly allowed remaining cheap line201 even though refund123 exceeds remaining total24.60. Return undo/redo200; paid147.60/refunded123 preserved. | PASS |
| 17 | UI/API/DB/CSV: reconcile return totals | Remaining net20+tax4.60=gross24.60 | Actual net20/tax27.60/gross24.60 in current production UI, API, database and full CSV. Undo restores initial total; redo reproduces tax27.60. Same prior failure; calculations.ts352 unchanged. | FAIL / step-13-return-tax-mismatch-pl.png |
| 18 | API: independent PLN discounted totals | 3×50×0.9=135; tax31.05; gross166.05 | PLN order persisted135/31.05/166.05; API/DB and list display agree. Discounted return variant not repeated in this run. | PASS |
| 19 | UI: full orders CSV, list/detail consistency and loading state | Same stored money in list/detail/export; useful loading shell | Full CSV confirms baseline100/23/123 and returned20/27.60/24.60. List net/gross agrees. Injected1600ms orders-response delay displayed Ładowanie shell; useful record in2675ms. | PASS / step-15-loading-shell-pl.png |
| 20 | CLI: locale coverage, source/readiness and cleanup | All five dictionaries include new message; source unchanged; own env removed | i18n sync and usage passed (8121 unused-key advisory). New key present en/pl/es/de/ko. No product500/infra503 observed. Own environment/PIDs/db removed; source clean; globalflock released. | PASS |

### Coverage and limits

- External payment-gateway webhooks, live carrier dispatch/labels, email delivery and catalog/WMS reservation/stock counters were not exercised. No live providers or credentials were enabled; custom lines/manual payments used.
- Refund setup, API boundary fixtures, return lifecycle, audit undo/redo/delete, other-tenant controls and one second-actor reference mutation were API-driven. Main order/line/settings/payment/prepaid shipment/refusal/partial shipment/locale flows were UI-driven.
- Same-open-dialog second stale UI retry not exercised: first conflict closed the dialog. Record integrity and preserved second-actor references were checked; fresh direct retries all422. Full two-UI-session repeat was interrupted by harness failure; mixed UI/API second-actor control ran afterward.
- Discounted PLN return variant, live optional subscribers, print/PDF and additional module consumers were not exercised. No shared component was changed; new helper is local to create/redo. No separate cancel route was identified in shipment route surface; delete/undo/redo covered.
- Spanish/German/Korean translation presence was checked statically; browser coverage en/pl. Empty/loading/error/no-permission/long-content/mobile states covered; no .uxproof directory exists.
- Exploratory browser driver is not a green standalone regression suite: first driver failed from an unhandled response timeout; subsequent driver was stopped during a networkidle wait; final driver ended after an in-flight route.continue raced unroute during the loading probe. Successful checkpoints have individual command-result artifacts and real PNGs. None of these harness errors is reported as a product defect.

### Validation commands

- `yarn workspace @open-mercato/core test --runInBand --runTestsByPath src/modules/sales/commands/__tests__/shipments.create-refunded-guard.test.ts src/modules/sales/commands/__tests__/orderCancellation.bypass-guard.test.ts` with `OM_PG_INTEGRATION=1`. Log: `focused-tests.log`.
- `yarn workspace @open-mercato/core test --runInBand --runTestsByPath src/modules/sales/commands/__tests__/shipments.create-refund-race.integration.test.ts` with `OM_PG_INTEGRATION=1`, ten invocations. Log: `focused-tests.log`.
- `python3 .ai/scripts/test-env-owned-command.py timeout 600 env OM_INTEGRATION_MODULES=sales yarn mercato test:integration TC-SALES-054`. Log: `tc-sales-054-scoped.log`.
- `timeout 90 env TMPDIR=/tmp yarn i18n:check-sync`. Log: `i18n-sync-retry.log`.
- `timeout 90 env TMPDIR=/tmp yarn i18n:check-usage`. Log: `i18n-usage.log`.

All five locale files contain the new key; i18n sync/usage passed. Runtime prep was install → packages build → generate → packages build → realPG checks → full production build. No production500 or infra503 observed. Existing `screenshots` is informational; `needs-qa`, human holds and pipeline labels remain intact.
