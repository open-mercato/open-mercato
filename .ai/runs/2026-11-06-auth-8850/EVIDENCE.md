# Auth user creation rollback — issue #8850

Runner: local; HTTP regressions use the repository-managed ephemeral app and PostgreSQL.

## Before production changes

Baseline: `df20d84e8581643ba81f211281a7da3fbbccb332`.

`OM_INTEGRATION_MODULES=auth yarn mercato test:integration TC-AUTH-8850`:
- HTTP creation returned 400 after a role tenant move committed while the INSERT waited.
- Hash-aware PostgreSQL inspection found `{ users: 1, memberships: 0 }`, on both attempt and retry.
- Successful creation controls with and without roles passed, including duplicate rejection and assignment notification.
- Regression result: 1 failed, 2 passed. Cleanup removes the rejected account in `finally`.

`yarn workspace @open-mercato/core test --runInBand --runTestsByPath src/modules/auth/commands/__tests__/users.create-tenant-scope.test.ts`:
- Before fix: transaction ordering regressions failed (2 failed, 4 passed).

## After the fix

The same request data-engine insertion and role reconciliation now share `withAtomicFlush` on the request entity manager. Invitation delivery, CRUD/indexer side effects and role notifications remain after commit. Public API/schema contracts are unchanged.

- Targeted native auth unit tests: 4 suites, 23 tests passed (creation scope, destination scope, tenant-scoped email, invitations).
- `OM_INTEGRATION_MODULES=auth yarn mercato test:integration 'TC-AUTH-(8850|048|052|068)'`: 6 passed; rejected HTTP 400 now leaves `{ users: 0, memberships: 0 }`.
- Existing tenant and organization denial/success cases passed; successful creation with/without roles, duplicate rejection, and notification delivery passed.
- Unit regression asserts rollback and no email/CRUD effects on rejection, plus commit-before-effects on success.

## Validation

Final configured gate: all stages passed, in configured order. Runner: local, with a short local `TMPDIR`; the unit command uses Turbo `--env-mode=loose` so that setting reaches package tests.

| Command | Result |
| --- | --- |
| `yarn build:packages` | PASS (exit 0) |
| `yarn generate` | PASS (exit 0) |
| `yarn build:packages` | PASS (exit 0) |
| `yarn i18n:check-sync` | PASS (exit 0) |
| `yarn i18n:check-usage` | PASS (exit 0) |
| `yarn typecheck` | PASS (exit 0) |
| `yarn test --env-mode=loose` | PASS (exit 0) |
| `yarn build:app` | PASS (exit 0) |

The full unit run completed 51/51 tasks successfully. Core: 2,691 active suites and 27,056 tests passed; 15 suites/241 tests skipped by the existing configuration. CLI: 114 suites passed; shared: 259 active suites passed.

Initial runs encountered macOS `tsx` socket-path failures and temporary-fixture failures under strict Turbo environment filtering. The final pass-through run above clears those failures without source edits outside auth. Translation usage reports unused keys as advisory and exits 0.

## QA scope

No UI-rendering file, database structure or API surface changes. Unit and real HTTP/PostgreSQL coverage qualify for the repository automated-verification exemption. No `qa-approved` label is added. Independent role-row serialization work in #8735 is outside this fix.
