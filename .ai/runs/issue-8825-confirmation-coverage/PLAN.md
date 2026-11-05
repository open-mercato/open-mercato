# Issue 8825 execution plan

Summary: Retry/Cancel confirmation scenarios from #7907 lacked module-native browser regression.
Root cause: workflows/backend/instances/page.tsx had only translator-backed unit coverage; row-targeting, real keyboard shortcuts, dismissals and mobile layout were not exercised in a committed browser test.
Approach: Reuse the original authored #7907 prerequisite, API-create own failed/signal-paused fixtures and controls; run EN/PL and Control/Meta matrix; remove all fixtures in finally.
Scope: workflows module and issue-8825 run/evidence artifacts. #8805 temporary validation overlay was authorized by parent and restored before commits; no warranty fix ships here.

- [x] Recheck concurrency, claim issue, restore supported runtime and Docker.
- [x] Reuse original authored #7907 prerequisite.
- [x] Promote candidate to module-native self-contained browser coverage.
- [x] Browser regression: all four cases passed with the authorized #8805 overlay.
- [x] Run configured gate; disclose #8805 and create-app OMH-057 external blockers.
- [x] Publish PR #8836 and run review/QA evidence chain. Review requests changes on external gates; QA is PARTIAL with 4/4 scenario passes.
- [ ] External merge gates: #8805, create-app OMH-057 and manual QA approval remain outstanding.
