# Issue 8286 validation and handoff evidence

Branch: `cez/d46c8364`
Head: `8eb0dacef336409675712bc990cab333c8e9cf28`
Production fix: `528c3576ba7df548a96311398e6e16d1601f9ad3`
PR: https://github.com/open-mercato/open-mercato/pull/8516
Current-head author re-review: https://github.com/open-mercato/open-mercato/pull/8516#pullrequestreview-5742377269

Runner: local. Node 24.22.2, Yarn 4.18.1, TMPDIR=/tmp. Invoked Yarn directly as `/Users/piotrkarwatka/.local/share/mise/installs/node/24.22.2/bin/node /Users/piotrkarwatka/.local/share/mise/installs/yarn/latest/bin/yarn.js` to avoid the mise shim choosing Node 26.

## Configured gate, in order

| Command | Result |
|---|---|
| `yarn build:packages` | PASS, exit0 |
| `yarn generate` | PASS, exit0 |
| `yarn build:packages` | PASS, exit0 |
| `yarn i18n:check-sync` | PASS, exit0, all5 locales |
| `yarn i18n:check-usage` | Incomplete, capped~300s, exit143 |
| `yarn typecheck` | PASS, exit0,42 package tasks |
| `yarn test` | FAIL, exit1,8 failures across3 unchanged CLI suites |
| `yarn build:app` | PASS, exit0,4m29s |

The CLI failures are in agent-files-extension.test.ts, resolve-environment.test.ts, resolver.enterprise.test.ts. Fixes would leave authorized customer scope, so none were attempted. The broad gate stopped other package tasks after the CLI failure; it does not establish full-repo test success.

## Focused checks

- `yarn workspace @open-mercato/core test --runInBand --testPathPatterns 'customers/components/detail/__tests__/(ActivitiesSection|ActivityTimeline|ActivityCard|ActivityHistorySection)'`: PASS,8 suites/59 tests.
- `yarn workspace @open-mercato/core test --runInBand --testPathPatterns 'customers/lib/__tests__/(interactionReadModel|interactionOrderBy)'`: PASS,3 suites/7 tests, including existing author-scope coverage.
- `yarn workspace @open-mercato/core typecheck`: PASS,no diagnostics.
- `yarn eslint` on changed TS/TSX files: PASS,zero errors,two existing hook-dependency warnings. Subsequent changed integration test lint also passes.
- `yarn template:sync`: PASS,app/template code and package dependency parity.
- `node .ai/qa/artifacts/issue-8286/reproduce-sort.cjs`: PASS. Base comparator: undated-a,dated,undated-z. Fixed comparator: dated,undated-z,undated-a.
- `yarn playwright test --config .ai/qa/tests/playwright.config.ts --list TC-CRM-8286`: initial discovery exceeded60s. Native managed test command later discovered exactly2 tests.
- DS health command capped 60s; its tracked generated report restored. No design governance files changed.

## API/UI execution

`yarn mercato test:integration TC-CRM-8286` initial run: both scenarios reached actual person/company UIs; API null-date,entity-isolation,unauthenticated checks passed before the UI assertion. Failed because the test assumed read-only legacy rows had a button role. Corrected the test only in8eb0dacef to use the observed Interaction history heading and fixture titles. Initial failure contexts preserved in `initial-selector-failure/`.

Rerun on 8eb0dacef: PASS, exit0. Exactly 2 scenarios passed (person 2.8s,company 1.6s); Playwright 1.7m including discovery; full managed run 304322ms. Screenshots visually inspected: dated Newer/Older rows precede both undated rows, Unknown date wraps cleanly with no invented time/year. API assertions passed and finally-cleanup ran. QA evidence: https://github.com/open-mercato/open-mercato/pull/8516#issuecomment-6586808168

Current-head CI prepare fails: https://github.com/open-mercato/open-mercato/actions/runs/41511397494/job/125503833838 . Logs report duplicate resolveTranslations at lines9/18 of unchanged packages/core/src/modules/audit_logs/api/audit-logs/actions/redo/route.ts. This file is outside the diff/scope; local and native app builds pass. No out-of-scope repair attempted. Parent/maintainer independent review remains required.

Issue 8286 and PR 8516 in-progress labels released and read back absent. PR retains bug,changes-requested,needs-qa,priority-medium,risk-medium,screenshots. No qa-approved or merge. Owned app/worker/runner PIDs are gone; owned ephemeral DB ports 55351/55355/55357 have no remaining containers. No ongoing CI monitoring promised.

Only .ai/qa/artifacts remains untracked; all source changes committed/pushed. Worktree retained for parent inspection. Full-repo validation is NOT green; status partial because of disclosed out-of-scope CI/local gate blockers.

Independent review dispatch refused: task tree capped at2 subtasks. Author review is COMMENTED; independent parent/maintainer review remains required. Native QA runs only through the repository CLI. No external dependency/service changes.

## Changed files

- `packages/core/src/modules/customers/__integration__/TC-CRM-8286-unknown-activity-dates.spec.ts`
- `packages/core/src/modules/customers/components/detail/ActivitiesSection.tsx`
- `packages/core/src/modules/customers/components/detail/ActivityCard.tsx`
- `packages/core/src/modules/customers/components/detail/ActivityHistorySection.tsx`
- `packages/core/src/modules/customers/components/detail/ActivityTimeline.tsx`
- `packages/core/src/modules/customers/components/detail/__tests__/ActivitiesSection.unknownDates.test.tsx`
- `packages/core/src/modules/customers/components/detail/__tests__/ActivityCard.test.tsx`
- `packages/core/src/modules/customers/components/detail/__tests__/ActivityHistorySection.test.tsx`
- `packages/core/src/modules/customers/components/detail/__tests__/ActivityTimeline.test.tsx`
- `packages/core/src/modules/customers/i18n/de.json`
- `packages/core/src/modules/customers/i18n/en.json`
- `packages/core/src/modules/customers/i18n/es.json`
- `packages/core/src/modules/customers/i18n/ko.json`
- `packages/core/src/modules/customers/i18n/pl.json`
