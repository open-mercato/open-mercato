Scope review: all production changes are customer-local display/sort/filter logic plus five customer locale entries. No API shape, entity, migration, event, shared UI, message module or dependency changes.

Before/after reproduction from actual HEAD/current ActivitiesSection comparator: base orders undated-a, dated, undated-z using createdAt; fixed orders dated, undated-z, undated-a. Regression fixtures include both null and omitted timestamps, real scheduled entries, equal occurrence dates and preserved creation/source metadata.

Targeted evidence: 8 component suites / 59 tests pass; 3 existing author-scope/read-model/order suites / 7 tests pass; core typecheck passed with an empty diagnostic log; changed-source ESLint has zero errors and two existing hook-dependency warnings. Translation sync passes all five locales.

Limits pending: full repository gate; actual API/UI execution and screenshot evidence. Native Playwright --list exceeded 60 seconds during discovery (no tests ran). No QA pass claimed.
