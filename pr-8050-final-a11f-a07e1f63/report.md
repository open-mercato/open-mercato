## 📸 UI/API QA evidence — PASS

QA head: c64447a08eb689061367de9d540a89f2c0bcb0c7

Fresh published-head build: 15 native CLI cases and17 independent browser/API checkpoints passed.

| Step | Action | Expected / observed | Result / image |
|---|---|---|---|
| 1 | POST external order-lines without either unit price in default/net/gross modes | 400 naming unitPriceNet; header25.23 unchanged; one original line remains | PASS · [image](00-missing-source-price-modes.png) |
| 2 | POST explicit zero unit prices in net and gross modes | Both201; header25.23 unchanged | PASS · [image](00-explicit-zero-source-prices.png) |
| 3 | POST batch missing headers, mixed mode and partially valid missing-price batches | All400; original3lines and source gross25.23 unchanged | PASS · [image](00-batch-refusals-atomic.png) |
| 4 | POST batch of explicit net/gross zero lines, then batch-delete one | Both operations200;4lines remain, deleted ID absent and source gross25.23 preserved | PASS · [image](00-batch-explicit-zero-and-delete.png) |
| 5 | Open external order with source markup | Source badge; gross25.23; line mutation controls disabled | PASS · [image](01-source-default.png) |
| 6 | Open conversion confirmation then Escape | Dialog dismissed; mode remains external | PASS · [image](02-confirmation-Escape.png) |
| 7 | Open empty adjustments | Empty copy; both creation controls disabled | PASS · [image](03-empty-read-only-adjustments.png) |
| 8 | 390px viewport; horizontally scroll long item table | Table scrolls within overflow-auto wrapper; conversion action remains in viewport | PASS · [image](04-long-content-mobile-scroll.png) |
| 9 | Hold document response during reload | Loading document shell appears, then source view | PASS · [image](05-loading.png) |
| 10 | Inject document GET500 | Retry control visible; conversion control absent | PASS · [image](06-read-error-500.png) |
| 11 | Inject document GET403 | Retry control visible; conversion control absent | PASS · [image](06-read-error-403.png) |
| 12 | Open missing UUID | Document not found with back link | PASS · [image](07-missing-record.png) |
| 13 | Real view-only account reads then attempts conversion | GET200; PUT403; external mode preserved | PASS · [image](08-real-view-only403.png) |
| 14 | Real account with no sales grants opens order | Access Denied; source totals absent | PASS · [image](09-real-no-permission.png) |
| 15 | Concurrent API update then stale browser conversion | PUT409; Record changed alert; gross25.23 preserved | PASS · [image](10-real-stale409.png) |
| 16 | Reload; confirm conversion with Ctrl+Enter | PUT200; computed net20/tax4/gross24; line editing enabled | PASS · [image](11-CtrlEnter-switch-correct-money.png) |
| 17 | Restore external; inject conversion PUT500 | Failure message; mode stays external | PASS · [image](12-switch-error500.png) |

Fresh production build of publishedc64447a08eb689061367de9d540a89f2c0bcb0c7; native CLI 15cases passed, including mixed batch/single concurrency, native order/quote line/surcharge concurrency, external source amounts/migration, organization refusal, sequential equivalence, atomic refusal and undo. No retries or assertions were changed.

Both single and batch writers use the main transaction-bound scoped row lock; parent version is refreshed under the lock, graph snapshots share that transaction, and totals events publish after commit.102focusedunit tests, generation andcoretypecheck passed, including3deterministic batch/single overlap permutations.

Initial provisioning failed before tests because an old node_modules marker skipped installation after main added gateway-autopay. The generated local entrypoint now runs immutable install on force-rebuild; the same entrypoint was rerun successfully. No generated app registry was edited by hand and no module was disabled.

All17 independent Chromium/API checkpoints passed. Owned order/users/roles deleted successfully; zero remaining fixtures. Controlled500/403 reads and500 mutation failures are simulated; viewer403 and stale409 are real server responses.

OSS environment only; no fresh enterprise runtime coverage is claimed. Evidence-only: no independent review or human QA approval. Current-head GitHub CI is reported separately.
