# Handoff: edit select initial values

## PR

- PR: https://github.com/open-mercato/open-mercato/pull/2608
- Branch: `fix/edit-select-initial-values`

## Current scope

- Shared UI:
  - `CrudForm` single-select fields now resolve and render the selected option label explicitly. This fixes the browser-visible placeholder when the saved value and options arrive in different async renders.
- Staff edit forms:
  - Team member edit seeds saved `Team` option by id when the saved team is outside the initial option page.
  - Team role edit renders the `Team` select during async option loading and seeds the nested saved team label.
  - Team role option refresh preserves a separately seeded selected option instead of replacing it with the first teams page.
- Resources:
  - Resource edit seeds saved `Resource type` by id when the saved type is outside the initial option page.
  - Resource edit seeds saved dictionary-backed `Capacity unit`.
- Checkout:
  - Checkout template gateway settings now normalize JSON-string readback before form hydration so `captureMethod` is displayed and saved.
- Example/TODO:
  - Edit page fetches by `ids` instead of unsupported `id`.
  - TODO list API supports the shared `ids` filter used by edit-page hydration.
  - Browser coverage checks saved severity is visible on edit.
- Customers:
  - Browser coverage verifies deal pipeline/stage edit prefill. No customer source fix is currently included because the reproduced path passed.
- Example smoke page:
  - `/backend/generate-watch-smoke` was removed.

## Verification run so far

- `yarn workspace @open-mercato/ui test CrudForm.render --runInBand` passed.
- `yarn build:packages` passed.
- `yarn generate` passed.
- `yarn exec tsc -p packages/ui/tsconfig.json --noEmit` passed.
- `yarn exec tsc -p packages/core/tsconfig.json --noEmit` passed.
- `yarn exec tsc -p packages/checkout/tsconfig.json --noEmit` passed.
- Focused Playwright coverage passed:
  `BASE_URL=http://localhost:3010 npx playwright test --config .ai/qa/tests/playwright.config.ts apps/mercato/src/modules/example/__integration__/todo-priority-validation.spec.ts packages/checkout/src/modules/checkout/__integration__/TC-CHKT-040-gateway-settings-select.spec.ts packages/core/src/modules/customers/__integration__/TC-CRM-075-edit-select-prefill.spec.ts packages/core/src/modules/resources/__integration__/TC-RESO-003-edit-select-prefill.spec.ts packages/core/src/modules/staff/__integration__/TC-STAFF-025-edit-select-prefill.spec.ts --retries=0`

## Next steps

1. Wait for the broader select-prefill browser verification subagents.
2. Create follow-up GitHub issues only for candidates reproduced as real saved-option prefill bugs.
3. Re-check PR CI and remove `in-progress` once checks are green and no further PR-local work is needed.
