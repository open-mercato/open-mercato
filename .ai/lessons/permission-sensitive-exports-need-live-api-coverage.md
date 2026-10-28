---
title: "Permission-sensitive exports need live API coverage"
modules: ["staff", "auth"]
areas: ["testing", "integration"]
topics: ["access-control", "testing", "route-coverage"]
---

# Permission-sensitive exports need live API coverage

Review of #7834 / PR #7988 found that handler and serializer tests proved redaction with mocked report loading, but a green integration job with scope `none` did not exercise the live permission boundary.

For exports containing protected data, create a rated fixture through the API and compare callers with explicitly controlled grants. Assert both denied output and authorized output, including monetary values as well as column labels. Isolate authentication contexts, clean up fixtures in `finally`, and verify the integration runner actually selects the new test before claiming live coverage.

Evidence: `packages/core/src/modules/staff/__integration__/TC-TT-026-report-export-money-permissions.spec.ts`; [review](https://github.com/open-mercato/open-mercato/pull/7988#pullrequestreview-5651555940).
