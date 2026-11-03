# Checkpoint 2 — steps 2.3, 3.2 (this resume)

**UTC:** 2026-06-17
**Steps covered:** 2.3 (ac8f842d9), 3.2 (6022d92fc)
**Touched packages:** `@open-mercato/webhooks` (entities migration + dispatch worker/queue)

## Checks

| Check | Result | Notes |
|-------|--------|-------|
| `yarn generate` | ✅ pass | exit 0; created gitignored entity-id artifacts for `webhook_ingestion_entity` + `inbound_endpoint_config_entity`; cleared the prior `#generated/entities.ids.generated` typecheck error |
| `yarn build:packages` (x2, around generate) | ✅ pass | exit 0 |
| `yarn db:generate` (against docker Postgres) | ✅ pass | produced exactly one migration `Migration20260617141327_webhooks.ts` + snapshot; all other modules "no changes" (no unrelated churn) |
| Migration DDL validation | ✅ pass | applied in a `BEGIN…ROLLBACK` transaction against `mercato-postgres-local` (localhost:5432) — both tables, unique constraint, 3 indexes create cleanly; rolled back (no DB mutation). `yarn db:migrate` deliberately NOT run (per "ask before applying migrations"). |
| `tsc --noEmit` (shared) | ✅ pass | 0 errors |
| `tsc --noEmit` (webhooks) | ✅ pass | 0 errors |
| `yarn workspace @open-mercato/webhooks test` | ✅ pass | 16 suites / 117 tests (was 105; +8 inbound-registry, +4 inbound-dispatch) |
| UI / Playwright | n/a | no UI touched this window |

## Environment
- Full docker stack up: `mercato-postgres-local` healthy on localhost:5432, app `openmercatotest-app-1`, redis/meilisearch healthy. DB used for `db:generate` + DDL validation.

## Carry-forward
- Phase 4 (generator auto-discovery) and Phase 5 (route unification) deferred to the next resume — see HANDOFF.md for the precise edit-map and design notes. Both are higher-risk than the steps landed here and were intentionally left to a full-budget pass.
