## 📸 UI QA evidence — PASS

QA head: 7ab9400167e0c75e9c600207f3742ff083d32c82

Verified People and Companies Created-date behavior in a fresh production build at this exact published head. Role: disposable admin; Playwright1.62.1/Chromium1228; reader zones Europe/Warsaw and Asia/Tokyo. Cold bootstrap295s and authenticated readiness passed; warm invocation reused the healthy environment. Source tree 0e83a79734925d4e794088816a00309c2a0770ee captured before browser QA; tracked worktree clean.

25/25 browser checkpoints PASS. The4 committed Created-list integration cases PASS through the repository CLI, no retry. Owned fixture timestamps bracket Warsaw midnight by1ms; all4 manual fixtures deleted and zero active leftovers verified. No production data or credentials are included in this evidence.

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

The controlledHTTP500/403 cases prove error/no-permission rendering, not server authorization. No shared contract, route, schema, permission, dependency, or workflow change was introduced. Existing DataTable/semantic styling was inspected visually, including long names and390px layouts. This supersedes the prior local-environment QA blocker. Current-head CI remains a separate gate; no CI green claim is made here.

Self-QA is explicitly requested/permitted for this risk-medium scope. Both qa-approved and qa-self-verified may be applied only with this exact-head evidence attached. Parentd663d9fd retains independent validation and final merge.

Teardown verified: no app listener on5001 and the owned disposable database container was removed.
