## 📸 UI QA evidence — PASS

QA head: f8c17df7f2e141a755e328f911454ea8049bb995

Fresh production build at the published head. All15 browser/API checkpoints pass. Source prices cannot be omitted and explicit zero remains valid.

| Step | Action | Expected / observed | Result / screenshot |
|---|---|---|---|
| 1 | POST external order-lines without either unit price in default/net/gross modes | 400 naming unitPriceNet; header25.23 unchanged; one original line remains | PASS · [image](00-missing-source-price-modes.png) |
| 2 | POST explicit zero unit prices in net and gross modes | Both201; header25.23 unchanged | PASS · [image](00-explicit-zero-source-prices.png) |
| 3 | Open external order with source markup | Source badge; gross25.23; line mutation controls disabled | PASS · [image](01-source-default.png) |
| 4 | Open conversion confirmation then Escape | Dialog dismissed; mode remains external | PASS · [image](02-confirmation-Escape.png) |
| 5 | Open empty adjustments | Empty copy; both creation controls disabled | PASS · [image](03-empty-read-only-adjustments.png) |
| 6 | 390px viewport; horizontally scroll long item table | Table scrolls within overflow-auto wrapper; conversion action remains in viewport | PASS · [image](04-long-content-mobile-scroll.png) |
| 7 | Hold document response during reload | Loading document shell appears, then source view | PASS · [image](05-loading.png) |
| 8 | Inject document GET500 | Retry control visible; conversion control absent | PASS · [image](06-read-error-500.png) |
| 9 | Inject document GET403 | Retry control visible; conversion control absent | PASS · [image](06-read-error-403.png) |
| 10 | Open missing UUID | Document not found with back link | PASS · [image](07-missing-record.png) |
| 11 | Real view-only account reads then attempts conversion | GET200; PUT403; external mode preserved | PASS · [image](08-real-view-only403.png) |
| 12 | Real account with no sales grants opens order | Access Denied; source totals absent | PASS · [image](09-real-no-permission.png) |
| 13 | Concurrent API update then stale browser conversion | PUT409; Record changed alert; gross25.23 preserved | PASS · [image](10-real-stale409.png) |
| 14 | Reload; confirm conversion with Ctrl+Enter | PUT200; computed net20/tax4/gross24; line editing enabled | PASS · [image](11-CtrlEnter-switch-correct-money.png) |
| 15 | Restore external; inject conversion PUT500 | Failure message; mode stays external | PASS · [image](12-switch-error500.png) |

Fresh production environment at exact published f8 head using om-prepare-test-env; Playwright provider. Owned order, users and roles deleted (all200), zero remaining fixtures.

Three existing TC-SALES-EXT-001 native cases passed in exact-head GitHub CI41013513148 (744ms/1.6s/26ms), not rerun locally. Three external-amount unit suites passed there.

Review5708311183 findings are resolved by f8: detect absent input price before tax-service zero fallback, preserve explicit zero; finally cleanup removes return before order and verifies absence.

Controlled500/403 read and500 mutation errors are simulated browser responses; view-only403 and stale409 are real server responses.

Evidence-only: no new independent review or QA approval. Earlier enterprise quote-session evidence remains historical; no fresh enterprise runtime exercise in this OSS QA.
