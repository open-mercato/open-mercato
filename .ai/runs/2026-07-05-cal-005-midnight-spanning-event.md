# Execution plan: fix failing CI integration tests on PR #3594

## Goal

Fix the integration test failure that blocks the `ephemeral-integration` CI check on
PR #3594 (release v0.6.6, develop → main) at the root cause, and document the chronic
standalone-only failures so they can be tackled as a scoped follow-up.

## Investigation summary

PR #3594 CI shows two distinct failure clusters:

1. **`ephemeral-integration (7/15)`** (the PR's own `ci.yml` required check) — a single
   failure: `TC-CAL-005`. This is the only failure that is **new** to this release
   (prior develop snapshot runs did not have it).
   - Root cause: the calendar editor defaults a new event's start to the **next full
     hour**. When CI runs late in the evening the default becomes `11:00 PM`, so the
     90-minute meeting spans **past midnight** (`11:00 PM – 12:30 AM next day`). A
     meeting that crosses midnight legitimately renders in **two** day cells (the day it
     starts and the day it ends). The test's `itemLocator`
     (`getByRole('button', { name: /^QA Cal Editor .../ })`) then matches **2 elements**
     and `expect(locator).toBeVisible()` fails with a Playwright **strict-mode
     violation**, not a real regression.
   - The test already anticipates midnight/week-boundary rolling (it guards the week-grid
     assertion behind an in-current-week check) but never made the locator tolerant of an
     event rendering across two cells.

2. **`Standalone App Integration Tests`** (the `snapshot.yml` post-merge job, **not** the
   PR's blocking CI) — `TC-CRM-068 / 069 / 079`. These are **chronic** (red on develop
   for many consecutive commits) and reproduce **only** in the standalone (scaffolded,
   dist-package) environment where `AUTO_SPAWN_WORKERS=false`.
   - Root cause (from the uploaded trace's `resultSummary`): the bulk-deal worker's
     `commandBus.execute('customers.deals.update', …)` throws for every deal with
     `"Command handler not registered for id customers.deals.update. No commands or
     command loaders registered for module \"customers\""`, so the progress job completes
     with `affectedCount: 0, failedCount: N`.
   - The integration-test queue-drain harness (`bootstrapFromAppRoot` in
     `packages/core/src/helpers/integration/queue-runner.ts`, and the inline `drainQueue`
     in `TC-CRM-068`) bootstraps the app in a **CLI-style** context that registers
     commands only through the generated **lazy command loaders**
     (`command-loaders.generated.ts`). The Next.js app server works because it registers
     commands eagerly via static imports; the drain does not. In the standalone
     (dist-based) generated app the `customers` command loaders are absent, so any worker
     that dispatches a command fails. This also implies a real gap for standalone
     deployments running `yarn mercato worker`.
   - Fixing this correctly is a deep generator/bootstrap change that cannot be verified in
     this environment without publishing a snapshot and scaffolding a full standalone app
     via `create-mercato-app`. It is **risk-high** and out of scope for the release
     blocker. Tracked as a follow-up; the CRM tests are **not** weakened to force green.

## Scope

- In scope: root-cause fix for `TC-CAL-005` (unblocks the PR's `ephemeral-integration`
  check).
- Non-goal: the chronic standalone command-loader generator/bootstrap gap
  (`TC-CRM-068/069/079`) — documented as a follow-up.

## Risks

- Low. The change is confined to one integration spec's assertion locators; it makes them
  tolerant of an event that legitimately renders in two day cells, without loosening what
  is actually asserted (the event still must render without a reload).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix TC-CAL-005 midnight-spanning locator

- [x] 1.1 Make the created-event locator assertions tolerant of the event rendering across two day cells — f54c73d91
- [x] 1.2 Clarify the spec docblock to record why the locator uses `.first()` — f54c73d91

### Phase 2: Validate and ship

- [x] 2.1 Run targeted validation (core lint/typecheck for the changed spec) — tsc: no syntax errors; `playwright test --list` collects the 1 test cleanly
- [ ] 2.2 Open PR against develop, apply labels, run auto-review
