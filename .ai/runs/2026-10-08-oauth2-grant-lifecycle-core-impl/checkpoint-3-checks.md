# Checkpoint 3 — Step 4.5

- **Steps covered:** 4.5 (P4e)
- **Touched areas:** `packages/core/src/modules/integrations` (`lib/oauth/grant-service.ts` disconnect, `lib/credentials-service.ts` bundle fallthrough, `api/[id]/credentials/route.ts` 404 for `…__oauth_grant` ids)
- **Runner:** local (no compose `app` container)
- **Why now:** Phase 4 closed (5 Steps)

| Check | Result |
|---|---|
| `yarn workspace @open-mercato/core typecheck` | ✅ pass |
| core Jest: `src/modules/integrations`, `src/modules/data_sync`, `src/helpers/integration`, module-decoupling | ✅ 87 suites, 849 passed (174 skipped: the gated real-Postgres suites) |
| `yarn workspace @open-mercato/core test:pg-integration` (`postgres:16` via testcontainers) | ✅ 6 suites, 174 passed |
| i18n checks | ⏭️ skipped: no locale file or user-facing string changed |
| UI verification | ⏭️ skipped: no UI touched before Step 5.1 |

Acceptance criteria covered in this window: A23 (disconnect), A25 (disconnect logs), A26 (`disconnect`), A29–A35, A39.
