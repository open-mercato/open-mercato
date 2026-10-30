## QA disposition — UI not applicable; local timezone checks PASS

Published PR head `33c3a05dfb898b59f6b203b2729dfa8caaaa3b98` has successful exact-head CI, including the standard test and non-UTC core-timezone legs. All four changed suites explicitly pass in both logs; non-UTC core total:2567suites/25319tests passed,11suites/221tests skipped.

Latest main advanced to `3b2ea82ea78fc478a6b71a99033e27463b0716cd`. Clean local merge `17cb5c3dfe94dd273157951389d7ff3c020609e4` is retained on `repair/batch-a-8110-b5ce1395`. Because this unpublished head has no CI, narrowly verified all four changed timezone suites locally: **55/55 tests,4/4suites under UTC (2.784s), and55/55,4/4 under Pacific/Auckland (0.984s)**. `yarn workspace @open-mercato/core typecheck` passed. Logs/JSON in `local-merge-17cb5c3dfe9/`. No assertions, tests, timeouts, retries, or checks weakened.

`om-auto-qa-pr`: UI rendering n/a; existing `skip-qa` exemption retained because rendering, DB and API schemas are unchanged and changed command behavior is covered by automated regressions. Real planner HTTP/editor/browser QA is **not exercised**, and no such PASS is claimed. Existing editor/UTC-default issues#6371/#5877 remain outside this PR. No new UI-test follow-up is required for a non-rendering change.

Publication is pending: shared/evidence branch pushes require cockpit Guard confirmation unavailable to this scheduled run. New-head remote CI and independent non-author review remain required. No merge or QA approval. Run b5ce1395.
