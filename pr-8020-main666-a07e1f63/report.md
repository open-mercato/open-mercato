# Published-head QA — PASS

PR#8020, head `082660dc1e11e31170bb6251dce8a04bffef3b22`, main `666ed40a1887e3076adaf49c6a75257f32d392cf`. 16 cases passed, zero skipped/retried.

| Executed case | Result |
|---|---|
| product description with fenced and tagged code blocks loads in rich-text mode | PASS |
| changing a code block language from the dropdown is saved without typing afterward | PASS |
| deleting a code block with the trash icon is saved without typing afterward | PASS |
| a non-owner gets the same 404 as for an unknown message or reaction | PASS |
| the reaction bar shows the localized refusal to the mailbox owner | PASS |
| TC-CRM-8020: company detail orders contributed tabs without changing its default | PASS |
| TC-CRM-8020: person detail orders contributed tabs without changing its default | PASS |
| TC-CRM-8020: deal detail orders contributed tabs without changing its default | PASS |
| people loads, saves and reloads native and owning-module fields | PASS |
| companies loads, saves and reloads native and owning-module fields | PASS |
| deals loads, saves and reloads native and owning-module fields | PASS |
| TC-CRM-UMES-PRIORITY-002: Owning-module failure remains visible after native save | PASS |
| TC-CRM-UMES-PRIORITY-002: Create failure feedback survives the successful native redirect | PASS |
| TC-CRM-UMES-SIDEBAR-001: person external IDs remain fresh and fit the responsive sidebar | PASS |
| TC-CRM-UMES-SIDEBAR-001: company external IDs remain fresh and fit the responsive sidebar | PASS |
| TC-CRM-UMES-SIDEBAR-001: deal external IDs remain fresh and fit the responsive sidebar | PASS |

Fresh evidence-only OSS run on this exact published head, including main666ed40a (created-at lists, staff team assignment and shared rich-text fixes). All cases passed once, zero retries/skips; original assertions/timeouts/checks unchanged.

Real production app and disposable PostgreSQL were provisioned by the generated test-environment entrypoint. Fixtures have test-owned cleanup. The environment is stopped; no enterprise runtime exercise or human QA signoff is claimed.

The PR feature code is byte-identical across this clean main merge. Shared new-base integration was validated on082660dc with354focused core/shared/UI tests, package builds, generation and typechecks before publication. This is separate from this PR’s required current-head GitHub CI.

Three rich-text cases prove fenced/tagged code blocks load and language-change/deletion saves without additional typing. Their automatic final screenshots scrolled to unrelated panels and are omitted from the curated visual evidence; assertions are in the actual executed case list.

The13customer/channel cases cover contributed-tab priority/defaults/ties/negative/absent-module behavior, real native/owning-module save+reload, controlled module-failure feedback, responsive external-ID freshness and real localized stale-reaction404 refusal. Stale-read snapshot and controlled failures are explicit test fixtures.

Representative priority/mobile, reloaded native fields and Polish refusal captures were visually inspected. Historical complete screenshots and failure-feedback captures remain linked in the previous QA report; no old screenshot is presented as this head.

## Screenshots

- [reaction-refusal-pl.png](reaction-refusal-pl.png)
- [company-priority-desktop.png](company-priority-desktop.png)
- [company-priority-mobile.png](company-priority-mobile.png)
- [person-priority-desktop.png](person-priority-desktop.png)
- [person-priority-mobile.png](person-priority-mobile.png)
- [deal-priority-desktop.png](deal-priority-desktop.png)
- [deal-priority-mobile.png](deal-priority-mobile.png)
- [person-reloaded-fields.png](person-reloaded-fields.png)
- [company-reloaded-fields.png](company-reloaded-fields.png)
- [deal-reloaded-fields.png](deal-reloaded-fields.png)
