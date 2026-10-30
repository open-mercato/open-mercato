# Focused browser/API QA — PASS

Head: `fd249727960e3d32a6cb969b93ecb8443e10c3d0`. Five cases passed; zero skipped.

| Case | Observed | Result |
|---|---|---|
| Non-owner mailbox isolation and owner add/remove | Unknown and foreign targets have equal localized404 bodies; owner add201/remove204. | PASS |
| Stale reaction bar localized refusal | Initial real GET response is retained to simulate a stale client; API delete204 and real UI DELETE404 are asserted, and Polish refusal is visible. | PASS · [image](reaction-refusal-pl.png) |
| company injected tab priority | Priority/tie order, missing-module hiding, unchanged built-in default, click/deep-link and narrow viewport assertions pass. | PASS · [image](company-tab-priority.png) · [mobile](company-tab-priority-mobile.png) |
| person injected tab priority | Priority/tie order, missing-module hiding, unchanged built-in default, click/deep-link and narrow viewport assertions pass. | PASS · [image](person-tab-priority.png) · [mobile](person-tab-priority-mobile.png) |
| deal injected tab priority | Priority/tie order, missing-module hiding, unchanged built-in default, click/deep-link and narrow viewport assertions pass. | PASS · [image](deal-tab-priority.png) · [mobile](deal-tab-priority-mobile.png) |

Actual5 native CLI cases passed on this exact published head; no test skipped. The production app and disposable database came from the generated test-env entrypoint; test-only channel seeding was enabled.

Inherited Blacksmith finding https://github.com/open-mercato/open-mercato/pull/8020#issuecomment-6527087694 is fixed. Prior CI trace showed legitimate GET refetch changing reactionCount1 to0 after backend DELETE204, removing the button before the intended stale-view click. Only test setup changed; every original assertion, timeout and retry policy remains, with an additional actual UI DELETE404 assertion.

The retained GET snapshot deliberately simulates a stale read. Authorization, seeding and both reaction mutations use the real server. Customer fixture injection contributes synthetic tabs through the existing extension registry; no production module is modified.

Seven PNGs were captured by the actual native browser cases; desktop and mobile samples and the localized refusal were visually inspected. Fixtures use per-test finally cleanup; the disposable environment has been torn down.

This is focused evidence for the test correction and unchanged customer-tab behavior. Historical full-surface QA remains at its documented head. No new production UI behavior, full-surface replay, enterprise runtime coverage, independent approval or QA signoff is claimed. Current-head CI remains separate.
