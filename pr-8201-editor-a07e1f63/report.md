## 📸 UI QA evidence — PASS

QA head: 07f4d18bd52fdbba4ef6baa1087718f109337dc5

Fresh production app, admin role, Chromium, Europe/Warsaw; desktop1440px and mobile390px.

| Step | Action | Expected | Observed | Result |
| --- | --- | --- | --- | --- |
| 1 | Load the companies list with an owned long-name company | Owned record and Created column render | Owned record and Created column render | PASS |
| 2 | Apply Recently created and reopen the actual editor | Operator displays is after and the calendar date remains editable | Operator displays is after and the calendar date remains editable | PASS |
| 3 | Open the real operator dropdown | The current is after value is present as a selectable option | The current is after value is present as a selectable option | PASS |
| 4 | Reselect the operator, close with Escape and reload/reopen | Operator and date persist through URL serialization and reload | Operator and date persist through URL serialization and reload | PASS |
| 5 | View the reopened preset at 390px | Operator and editable calendar date remain accessible at narrow width | Operator and editable calendar date remain accessible at narrow width | PASS |
| 6 | Search a unique absent marker | The empty list state renders without stale fixture rows | The empty list state renders without stale fixture rows | PASS |
| 7 | Hold the list response while cold-loading the route | Useful heading and loading state render before data resolves | Useful heading and loading state render before data resolves | PASS |
| 8 | Render a controlled HTTP 500 list response | The failure message is visible | Controlled rendering check passed; this does not prove server authorization | PASS |
| 9 | Render a controlled HTTP 403 list response | The failure message is visible | Controlled rendering check passed; this does not prove server authorization | PASS |

Fresh production build of the exact published head.

Controlled HTTP 500/403 responses test rendering only; real API integration coverage is reported separately.

Owned API fixture deleted and absence verified in finally.

Evidence only; no QA approval granted.

Heading visible in 622ms (observation, no performance threshold).

### Resolved QA harness failures

| Failing check | Evidence | Diagnosis / owner | Correction |
| --- | --- | --- | --- |
| Exploratory operator pointer selection | Playwright call log and live editor screenshot; committed native pointer case passed | Animation/re-render detached an exploratory locator after screenshot capture; Agent/QA | Selected the verified active option with Enter; reload and editor assertions stayed intact |
| Exploratory empty-state assertion | Live accessibility snapshot | Search-with-filters has its own empty-state copy; Agent/QA | Asserted its observed Clear search and filters control |
| Loading-response interception | Route-is-already-handled stack | Harness removed a handler while a held request was settling; Agent/QA | Awaited route-handler completion and ignored only an already-handled transport cancellation |

The native regression passed with its original assertions, pointer interaction, shared timeouts and retries unchanged. Unscoped local discovery was stopped before test execution; the supported customers module filter completed the same native case in 45.2s including discovery (test:4.6s). Exploratory leftovers were deleted and their absence verified.
