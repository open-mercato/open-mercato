## 📸 UI/API QA evidence — PASS

QA head: 2373aa6050d1495feec542d0d6c54a16e2f7d2d8

All17 fresh production browser/API checkpoints and11 native CLI cases passed.

| Step | Action | Expected / observed | Result / evidence |
|---|---|---|---|
| 1 | POST external order-lines without either unit price in default/net/gross modes | 400 naming unitPriceNet; header25.23 unchanged; one original line remains | PASS · [screenshot](00-missing-source-price-modes.png) |
| 2 | POST explicit zero unit prices in net and gross modes | Both201; header25.23 unchanged | PASS · [screenshot](00-explicit-zero-source-prices.png) |
| 3 | POST batch missing headers, mixed mode and partially valid missing-price batches | All400; original3lines and source gross25.23 unchanged | PASS · [screenshot](00-batch-refusals-atomic.png) |
| 4 | POST batch of explicit net/gross zero lines, then batch-delete one | Both operations200;4lines remain, deleted ID absent and source gross25.23 preserved | PASS · [screenshot](00-batch-explicit-zero-and-delete.png) |
| 5 | Open external order with source markup | Source badge; gross25.23; line mutation controls disabled | PASS · [screenshot](01-source-default.png) |
| 6 | Open conversion confirmation then Escape | Dialog dismissed; mode remains external | PASS · [screenshot](02-confirmation-Escape.png) |
| 7 | Open empty adjustments | Empty copy; both creation controls disabled | PASS · [screenshot](03-empty-read-only-adjustments.png) |
| 8 | 390px viewport; horizontally scroll long item table | Table scrolls within overflow-auto wrapper; conversion action remains in viewport | PASS · [screenshot](04-long-content-mobile-scroll.png) |
| 9 | Hold document response during reload | Loading document shell appears, then source view | PASS · [screenshot](05-loading.png) |
| 10 | Inject document GET500 | Retry control visible; conversion control absent | PASS · [screenshot](06-read-error-500.png) |
| 11 | Inject document GET403 | Retry control visible; conversion control absent | PASS · [screenshot](06-read-error-403.png) |
| 12 | Open missing UUID | Document not found with back link | PASS · [screenshot](07-missing-record.png) |
| 13 | Real view-only account reads then attempts conversion | GET200; PUT403; external mode preserved | PASS · [screenshot](08-real-view-only403.png) |
| 14 | Real account with no sales grants opens order | Access Denied; source totals absent | PASS · [screenshot](09-real-no-permission.png) |
| 15 | Concurrent API update then stale browser conversion | PUT409; Record changed alert; gross25.23 preserved | PASS · [screenshot](10-real-stale409.png) |
| 16 | Reload; confirm conversion with Ctrl+Enter | PUT200; computed net20/tax4/gross24; line editing enabled | PASS · [screenshot](11-CtrlEnter-switch-correct-money.png) |
| 17 | Restore external; inject conversion PUT500 | Failure message; mode stays external | PASS · [screenshot](12-switch-error500.png) |

Fresh production build at the published2373head containing main5cf. All17 checkpoints executed independently from the native suite. Owned users/roles/order deleted successfully; zero remaining fixtures.

Native CLI:11 cases passed without retries, comprising8bulk cases (including the new external batch regression) and3external-order cases. Native covers source-header preservation, missing/mixed/incomplete refusal atomicity, explicit zero, deletion, tenant/organization guards, equivalent sequential results, undo and migration round-trip on disposable PostgreSQL.

Conflict resolution retains the shared builder and main external rules. Header totals are optional for computed callers and required/restated for external writes; source price presence is captured before tax fallback.68focusedunit tests/generation/coretypecheck passed; hooks passed.

Controlled browser500/403 read and500 conversion errors are simulated; view-only403 and stale409 are real server responses. Enterprise runtime was not exercised in this OSS environment.

Evidence-only; no new independent review or QA approval. New-head CI is reported separately.
