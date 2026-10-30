## 📸 UI QA evidence — PASS

QA head: 50c684412b12715b45b5b2180e0fb0a375014106

Fresh production build after the final base merge; tracked worktree clean, source tree `5c178d2ac6fc3edc725bdc821bfc526642dd5921`. Isolated demo admin, Playwright 1.62.1 / Chromium 1228, Europe/Warsaw and Asia/Tokyo reader zones. Cold bootstrap 341 seconds; authenticated readiness and warm environment reuse passed.

**25/25 browser checkpoints and all 4 committed integration cases passed without retry.** The four owned manual fixtures bracket Warsaw midnight by 1 ms; all were deleted and zero active leftovers verified. The owned app and disposable database were stopped.

| # | Action | Expected | Observed | Result / screenshot |
|---|---|---|---|---|
| 1 | companies-default-long | Two owned records show distinct local Created dates, long names remain usable. | Both records and local10/23,10/24dates visible; long fixture present. | PASS / [01-companies-default-long.png](01-companies-default-long.png) |
| 2 | companies-sort-asc | Created sort updates URL and orders actual records. | sortField=createdAt;sortDir=asc;actual row order correct. | PASS / [02-companies-sort-asc.png](02-companies-sort-asc.png) |
| 3 | companies-sort-desc | Created sort updates URL and orders actual records. | sortField=createdAt;sortDir=desc;actual row order correct. | PASS / [03-companies-sort-desc.png](03-companies-sort-desc.png) |
| 4 | companies-date-editor | The real Created is date editor filters the displayed local day. | Date is10/24 includes local-midnight record and excludes preceding instant; URL retains bare day. | PASS / [04-companies-date-editor.png](04-companies-date-editor.png) |
| 5 | companies-reload | Filter and displayed results survive reload. | Same local-day result and bare URL value after reload. | PASS / [05-companies-reload.png](05-companies-reload.png) |
| 6 | companies-narrow | At390px the Created date and table controls remain usable. | 390px viewport, Created column reachable through table horizontal scroll. | PASS / [06-companies-narrow.png](06-companies-narrow.png) |
| 7 | companies-controlled-500 | Failed requests show visible error feedback and a usable page. | ControlledHTTP500 displayed visible load failure; shell remains usable. | PASS / [07-companies-controlled-500.png](07-companies-controlled-500.png) |
| 8 | companies-controlled-403 | Failed requests show visible error feedback and a usable page. | ControlledHTTP403 displayed visible load failure; shell remains usable. | PASS / [08-companies-controlled-403.png](08-companies-controlled-403.png) |
| 9 | companies-empty | An empty successful list has a helpful empty state. | Successful empty payload renders the localized No results found state. | PASS / [09-companies-empty.png](09-companies-empty.png) |
| 10 | companies-loading | A delayed list request shows the loading shell. | Loading table status visible while owned request is delayed. | PASS / [10-companies-loading.png](10-companies-loading.png) |
| 11 | people-default-long | Two owned records show distinct local Created dates, long names remain usable. | Both records and local10/23,10/24dates visible; long fixture present. | PASS / [11-people-default-long.png](11-people-default-long.png) |
| 12 | people-sort-asc | Created sort updates URL and orders actual records. | sortField=createdAt;sortDir=asc;actual row order correct. | PASS / [12-people-sort-asc.png](12-people-sort-asc.png) |
| 13 | people-sort-desc | Created sort updates URL and orders actual records. | sortField=createdAt;sortDir=desc;actual row order correct. | PASS / [13-people-sort-desc.png](13-people-sort-desc.png) |
| 14 | people-date-editor | The real Created is date editor filters the displayed local day. | Date is10/24 includes local-midnight record and excludes preceding instant; URL retains bare day. | PASS / [14-people-date-editor.png](14-people-date-editor.png) |
| 15 | people-reload | Filter and displayed results survive reload. | Same local-day result and bare URL value after reload. | PASS / [15-people-reload.png](15-people-reload.png) |
| 16 | people-narrow | At390px the Created date and table controls remain usable. | 390px viewport, Created column reachable through table horizontal scroll. | PASS / [16-people-narrow.png](16-people-narrow.png) |
| 17 | people-controlled-500 | Failed requests show visible error feedback and a usable page. | ControlledHTTP500 displayed visible load failure; shell remains usable. | PASS / [17-people-controlled-500.png](17-people-controlled-500.png) |
| 18 | people-controlled-403 | Failed requests show visible error feedback and a usable page. | ControlledHTTP403 displayed visible load failure; shell remains usable. | PASS / [18-people-controlled-403.png](18-people-controlled-403.png) |
| 19 | people-empty | An empty successful list has a helpful empty state. | Successful empty payload renders the localized No results found state. | PASS / [19-people-empty.png](19-people-empty.png) |
| 20 | people-loading | A delayed list request shows the loading shell. | Loading table status visible while owned request is delayed. | PASS / [20-people-loading.png](20-people-loading.png) |
| 21 | company-dst-preset | Recently created starts at local midnight seven calendar days back through autumn DST. | Warsaw10/31late evening:10/24midnight included;preceding instant excluded. | PASS / [21-company-dst-preset.png](21-company-dst-preset.png) |
| 22 | company-preset-reopened | Reopening the real editor shows a selectable is after operator. | Operator displays is after and can be reselected; cutoff10/23. | PASS / [22-company-preset-reopened.png](22-company-preset-reopened.png) |
| 23 | company-editor-narrow-keyboard | Editor fits390px and Escape cancels. | Editor within390px; Escape closes it. | PASS / [23-company-editor-narrow-keyboard.png](23-company-editor-narrow-keyboard.png) |
| 24 | companies-tokyo-boundary | The same bare day follows the reader timezone. | Tokyo10/24 includes both adjacent UTC instants; Warsaw included only one. | PASS / [24-companies-tokyo-boundary.png](24-companies-tokyo-boundary.png) |
| 25 | people-tokyo-boundary | The same bare day follows the reader timezone. | Tokyo10/24 includes both adjacent UTC instants; Warsaw included only one. | PASS / [25-people-tokyo-boundary.png](25-people-tokyo-boundary.png) |

The controlled HTTP 500/403 cases verify rendering, including the no-permission response, rather than server authorization. Both list routes cover default, long content, sorting, actual date editor, reload persistence, empty/loading/error states and 390px layout. The recently-created preset crosses autumn DST, reopens with the supported `is after` operator, and supports Escape in the narrow editor. The same bare day follows each reader timezone. Existing DataTable/semantic styling was visually inspected. No production data, credentials or browser storage are included.

Self-QA signoff is explicitly authorized for this risk-medium scope; this exact-head PASS and attached screenshots support `qa-approved` + `qa-self-verified`. Hosted CI remains a separate gate. Parent d663d9fd owns independent validation and final merge. This supersedes the historical QA at 7ab940016.
