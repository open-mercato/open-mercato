## Post-cap local validation — PASS

Head: `e8923204ed712796435b84663218c00453f01b29`. Runner:local; OSS module mode.

| Configured command | Scope | Result |
| --- | --- | --- |
| `yarn build:packages` | core/shared packages | PASS |
| `yarn generate` | configured repository command | PASS |
| `yarn build:packages` | core/shared packages | PASS |
| `yarn i18n:check-sync` | configured repository command | PASS |
| `yarn i18n:check-usage` | configured repository command | PASS |
| `yarn typecheck` | core/shared packages | PASS |
| `yarn test` | auth/API-key unit suites in core/shared; repository built-in concurrency=2 retained | PASS |
| `yarn build:app` | full configured app build | PASS |

129 suites /1,245 tests passed;1 suite /2 opt-in PostgreSQL tests skipped. Some build tasks used valid Turbo caches. The full configured app-build command passed.

Some package/app tasks used valid Turbo caches.

Opt-in PostgreSQL migration cases were skipped in this gate; earlier real migration evidence remains linked and migration source is unchanged.

A duplicate concurrency option in the local launcher was corrected before any tests executed; the repository built-in setting and assertions were unchanged.

Local evidence does not substitute for required GitHub checks.

The single CI watch ended at07:32UTC and was not restarted.
