# Checkpoint 1 Checks

**Timestamp:** 2026-07-07T12:39:28Z
**Branch:** `fix/integration-auth-login-redirect-loop`

## Results

| Command | Result | Notes |
|---------|--------|-------|
| `git diff --check` | pass | No whitespace errors. |
| `yarn workspace @open-mercato/core test` | pass | 954 suites, 7375 tests passed. |
| `yarn workspace @open-mercato/cli test packages/cli/src/lib/testing/__tests__/integration.test.ts --runInBand` | pass | 21 tests passed. |
| `yarn workspace @open-mercato/cli test` | pass outside sandbox | 59 suites, 1030 tests passed when run outside sandbox. In sandbox it failed on `listen EPERM ::` and `EMFILE: too many open files, watch`, both environment constraints unrelated to this change. |
| `yarn test:integration:ephemeral --filter packages/core/src/modules/auth/__integration__/TC-AUTH-053-login-helper-backend-cookie-flow.spec.ts` | pass | Fresh ephemeral readiness completed in 4s; 1 Playwright test passed. |

## Remediation During Checkpoint

- Fixed repo-wide explicit comparator guard failures by replacing new diagnostic `.sort()` calls with `localeCompare` comparators.
- Stabilized the existing CLI build-cache fingerprint unit test so it changes file size as well as content, avoiding same-millisecond mtime flakes.
- Reverted validation-generated churn in `apps/mercato/src/module-facts.generated.json`.
