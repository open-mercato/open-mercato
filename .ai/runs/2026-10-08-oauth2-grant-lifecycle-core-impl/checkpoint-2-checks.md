# Checkpoint 2 — Steps 3.1..4.4

- **Steps covered:** 3.1 (P3), 4.1 (P4a), 4.2 (P4b), 4.3 (P4c), 4.4 (P4d)
- **Touched areas:** `packages/core/src/modules/integrations` (credentials and log services, `lib/oauth/{grant-service,grant-blob,pin-tenant-dek,health}.ts`, the flag-gated test route and test integration, `di.ts`, the real-Postgres harness `__tests__/support/pgTestOrm.ts`), `packages/core/src/helpers/integration/oauthGrantTestRoute.ts`, `packages/core/package.json`, `packages/cli/src/lib/testing/integration.ts`, `.github/workflows/ci.yml`, `yarn.lock`
- **Runner:** local (no compose `app` container)
- **Why now:** 5 Steps landed in this resume

| Check | Result |
|---|---|
| `yarn build:packages` | ✅ pass |
| `yarn generate` | ✅ pass, no tracked file changed |
| `yarn workspace @open-mercato/{shared,core,cli} typecheck` | ✅ pass |
| core Jest: `src/modules/integrations`, `src/helpers/integration`, module-decoupling | ✅ 40 suites, 455 passed (132 skipped: the gated real-Postgres suites) |
| cli Jest: `src/lib/testing` | ✅ 56 passed |
| shared Jest: `src/lib/db` | ✅ 145 passed (7 skipped: the gated suite) |
| `yarn workspace @open-mercato/core test:pg-integration` (`postgres:16` via testcontainers) | ✅ 4 suites, 132 passed |
| `yarn workspace @open-mercato/shared test:pg-integration` | ✅ 7 passed |
| `yarn check:classic-di-injection` | ✅ pass |
| i18n checks | ⏭️ skipped: no locale file or user-facing string changed |
| UI verification | ⏭️ skipped: no UI touched before Step 5.1 |

Acceptance criteria covered in this window: A7, A8, A9–A25, A26 (`updateProviderData`), A27, A28, A40.
