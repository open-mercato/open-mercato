# Develop CI Stabilization

## Goal

Stabilize the latest `develop` branch feeding release PR #2425 by fixing the current standalone Snapshot Release failures at root cause, then prove two independent full ephemeral integration rounds with retries disabled and wait for GitHub CI to go green.

## Scope

- Fix CRM advanced-filter chip visibility after manual Status rule editing in TC-CRM-059, TC-CRM-060, and TC-CRM-061.
- Fix sales-channel offer stale list-delete conflict surfacing in TC-LOCK-OSS-029 / SAL-13.
- Keep proof runs on the newest `origin/develop` head before each full validation round.

## Evidence

- Previous failing Snapshot Release runs: `27055019655`, `27055020838`.
- CRM failures: active filter chips were hidden because the advanced filter popover remained open after Escape from a portalled select interaction.
- Sales failure: stale offer list-delete sent a 409 but `SalesChannelOffersPanel` only logged the error, so the conflict bar did not surface; the UI test also renamed the searched row during the stale-version bump.
- Current base at branch creation: `origin/develop` `115785d8d7d6fb0d604070f7b3c2a2adcab54fe4`.
- Unit validation: `yarn workspace @open-mercato/ui test packages/ui/src/backend/filters/__tests__/AdvancedFilterPanel.test.tsx --runInBand` passed, 7 tests.
- Targeted integration validation: `BASE_URL=http://127.0.0.1:55343 OM_OPTIMISTIC_LOCK=all npx playwright test --config .ai/qa/tests/playwright.config.ts packages/core/src/modules/customers/__integration__/TC-CRM-059.spec.ts packages/core/src/modules/customers/__integration__/TC-CRM-060.spec.ts packages/core/src/modules/customers/__integration__/TC-CRM-061.spec.ts packages/core/src/modules/sales/__integration__/TC-LOCK-OSS-029.spec.ts --retries=0` passed, 19 tests.

## Resume Notes

- Branch: `fix/ci-2425-develop-stabilization`.
- Targeted ephemeral app used for verification: `http://127.0.0.1:55343`, DB port `55147`.
- Next required proof: run two independent full `yarn test:integration:coverage --no-reuse-env --retries=0` rounds from this branch after rebasing/merging the newest `origin/develop`.
- If another failure appears, inspect Playwright artifacts in `.ai/qa/test-results/` and fix root cause before counting either full round.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Root-Cause Known Failures

- [x] 1.1 Stabilize CRM advanced-filter chip close behavior — fe790ef3f
- [x] 1.2 Surface sales offer stale list-delete conflicts and stabilize SAL-13 fixture — fe790ef3f

### Phase 2: Verification

- [x] 2.1 Run targeted unit validation
- [x] 2.2 Run targeted CRM and sales integration validation with retries disabled
- [ ] 2.3 Run full ephemeral proof round 1 with retries disabled
- [ ] 2.4 Run full ephemeral proof round 2 with retries disabled

### Phase 3: GitHub CI

- [ ] 3.1 Open stabilization PR against develop
- [ ] 3.2 Confirm GitHub CI green on stabilization PR
- [ ] 3.3 Confirm release PR #2425 / develop CI green
