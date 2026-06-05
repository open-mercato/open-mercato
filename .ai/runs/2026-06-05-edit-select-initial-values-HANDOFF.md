# Handoff: edit select initial values

## PR

- PR: https://github.com/open-mercato/open-mercato/pull/2608
- Branch: `fix/edit-select-initial-values`
- Issue: https://github.com/open-mercato/open-mercato/issues/2529

## Final scope

- Shared UI:
  - `CrudForm` single-select fields resolve and render selected option labels when values and options hydrate in separate async renders.
  - `DictionaryEntrySelect` ignores synthetic empty select changes when there is no explicit clear option.
- Staff:
  - Team member edit seeds the saved `Team` option by id.
  - Team role edit keeps the saved nested `Team` option visible during async option refresh.
- Resources:
  - Resource edit seeds saved `Resource type` by id.
  - Resource edit seeds saved dictionary-backed `Capacity unit`.
  - The custom resource-type select ignores synthetic empty hydration changes.
- Checkout:
  - Checkout gateway settings normalize JSON-string readback so `captureMethod` displays and persists.
- Example/TODO:
  - TODO edit loads by `ids`.
  - TODO list API supports the shared `ids` filter.
  - Severity prefill is browser-covered.
- Catalog:
  - Product and variant tax selects seed saved tax classes outside the first async option page.
  - Variant tax select ignores synthetic empty hydration changes.
- Customers:
  - Browser coverage verifies deal pipeline/stage and person company edit-prefill paths.
- Sales:
  - Browser coverage verifies line-item tax, adjustment tax, shipment method/status, and address selectors.
- Auth:
  - User edit hydrates saved role tags outside the first loaded role page.
- Planner:
  - Availability rules editor hydrates saved rulesets outside the first loaded schedule page.
- Removed stale smoke page:
  - `/backend/generate-watch-smoke` and its metadata were deleted.

## Broader-impact follow-ups

- Related capped picker/role-picker follow-ups were created, marked in progress, and linked to PR #2608:
  - https://github.com/open-mercato/open-mercato/issues/2615
  - https://github.com/open-mercato/open-mercato/issues/2616

## Local verification

- `yarn generate`
- `git diff --check`
- `yarn exec tsc -p packages/core/tsconfig.json --noEmit`
- `yarn exec tsc -p packages/ui/tsconfig.json --noEmit`
- `yarn exec tsc -p packages/checkout/tsconfig.json --noEmit`
- `yarn workspace @open-mercato/ui test CrudForm.render --runInBand`
- Browser tests:
  - `BASE_URL=http://localhost:3010 npx playwright test --config .ai/qa/tests/playwright.config.ts packages/core/src/modules/staff/__integration__/TC-STAFF-025-edit-select-prefill.spec.ts packages/core/src/modules/resources/__integration__/TC-RESO-003-edit-select-prefill.spec.ts packages/checkout/src/modules/checkout/__integration__/TC-CHKT-040-gateway-settings-select.spec.ts apps/mercato/src/modules/example/__integration__/todo-priority-validation.spec.ts --retries=0`
  - `BASE_URL=http://localhost:3010 npx playwright test --config .ai/qa/tests/playwright.config.ts packages/core/src/modules/catalog/__integration__/TC-CAT-034-edit-select-prefill.spec.ts packages/core/src/modules/auth/__integration__/TC-AUTH-050-edit-role-prefill.spec.ts packages/core/src/modules/planner/__integration__/TC-PLAN-005-ruleset-prefill.spec.ts packages/core/src/modules/sales/__integration__/TC-SALES-031-edit-select-prefill.spec.ts packages/core/src/modules/customers/__integration__/TC-CRM-075-edit-select-prefill.spec.ts --retries=0`

## PR status

- Latest local validation is green.
- GitHub CI was still running after the final code push when this handoff was updated.
- Keep `needs-qa`; remove `in-progress` after CI is green and PR comments are updated.
