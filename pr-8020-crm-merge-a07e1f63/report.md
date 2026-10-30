# Merged CRM browser/API QA — PASS

Head: `d90d49bd17325c6e0e7a32b6c0780c4de1c02c9f`.13cases passed; zero skipped.

| # | Actual executed case | Result |
|---|---|---|
| 1 | TC-CHANNEL-API-009: reaction routes mask other users' personal mailboxes › a non-owner gets the same 404 as for an unknown message or reaction | PASS (1.3s) |
| 2 | TC-CHANNEL-API-009: reaction routes mask other users' personal mailboxes › the reaction bar shows the localized refusal to the mailbox owner | PASS (5.2s) |
| 3 | TC-CRM-8020: company detail orders contributed tabs without changing its default | PASS (3.9s) |
| 4 | TC-CRM-8020: person detail orders contributed tabs without changing its default | PASS (4.0s) |
| 5 | TC-CRM-8020: deal detail orders contributed tabs without changing its default | PASS (3.3s) |
| 6 | TC-CRM-UMES-PRIORITY-001: Real contributor detail round trips › people loads, saves and reloads native and owning-module fields | PASS (5.1s) |
| 7 | TC-CRM-UMES-PRIORITY-001: Real contributor detail round trips › companies loads, saves and reloads native and owning-module fields | PASS (4.5s) |
| 8 | TC-CRM-UMES-PRIORITY-001: Real contributor detail round trips › deals loads, saves and reloads native and owning-module fields | PASS (4.8s) |
| 9 | TC-CRM-UMES-PRIORITY-002: Owning-module failure remains visible after native save | PASS (3.6s) |
| 10 | TC-CRM-UMES-PRIORITY-002: Create failure feedback survives the successful native redirect | PASS (2.7s) |
| 11 | TC-CRM-UMES-SIDEBAR-001: person external IDs remain fresh and fit the responsive sidebar | PASS (5.5s) |
| 12 | TC-CRM-UMES-SIDEBAR-001: company external IDs remain fresh and fit the responsive sidebar | PASS (4.9s) |
| 13 | TC-CRM-UMES-SIDEBAR-001: deal external IDs remain fresh and fit the responsive sidebar | PASS (4.6s) |

This exact published merged head passed45scoped unit tests/6suites (including3new loading/dedup/priority/default-selection regressions), core/shared/UI package builds, generation/typechecks and normal commit/template hooks.

The4conflicts against mainCRM8269 were resolved by retaining its loading flags/native-ID exports/deduplication/recovery/event/custom-field fixes AND this PR’s priority propagation/stable order/native defaults. Two page mocks now import the real native-ID constants; original assertions remain intact.

All13native CLI cases passed, zero skipped:2channel isolation/refusal cases,3original customer priority cases,3real owning-module/native field roundtrips,2owning-module failure-feedback cases,3responsive fresh external-ID sidebar cases.

The channel stale-view test retains its real initial GET response to model a stale client; authorization and reaction mutations remain real and actual UI DELETE404 is asserted. Owning-module save/create failures in PRIORITY002 are controlled fixtures, not production failures. No original assertion, test timeout or retry policy was weakened.

22fresh PNGs were captured by the actual browser cases. Representative reloaded fields, controlled failure banners, narrow/empty sidebars and Polish reaction refusal were visually inspected. Test fixtures use per-test finally cleanup; the disposable environment is stopped.

This is evidence-only OSS validation. No enterprise runtime exercise, independent review, human QA approval or PR merge is claimed. Required GitHub CI on this head remains separate.

## Captures

- [deals-priority-reloaded.png](deals-priority-reloaded.png)
- [person-tab-priority-mobile.png](person-tab-priority-mobile.png)
- [person-tab-priority.png](person-tab-priority.png)
- [company-desktop.png](company-desktop.png)
- [company-empty.png](company-empty.png)
- [company-narrow-long.png](company-narrow-long.png)
- [deal-desktop.png](deal-desktop.png)
- [deal-empty.png](deal-empty.png)
- [deal-narrow-long.png](deal-narrow-long.png)
- [priority-owning-save-failure.png](priority-owning-save-failure.png)
- [reaction-refusal-pl.png](reaction-refusal-pl.png)
- [priority-owning-create-failure.png](priority-owning-create-failure.png)
- [person-desktop.png](person-desktop.png)
- [person-empty.png](person-empty.png)
- [person-narrow-long.png](person-narrow-long.png)
- [people-priority-reloaded.png](people-priority-reloaded.png)
- [person-priority-narrow.png](person-priority-narrow.png)
- [companies-priority-reloaded.png](companies-priority-reloaded.png)
- [deal-tab-priority-mobile.png](deal-tab-priority-mobile.png)
- [deal-tab-priority.png](deal-tab-priority.png)
- [company-tab-priority-mobile.png](company-tab-priority-mobile.png)
- [company-tab-priority.png](company-tab-priority.png)
