# Run: Ensure ephemeral integration environment provisions pgvector

## Goal

Make sure the ephemeral integration-test PostgreSQL provisioned by `startEphemeralEnvironment`
ships and enables the `vector` (pgvector) extension, so vector-search code paths and any
`CREATE EXTENSION vector` calls succeed under integration tests — matching the dev/prod
docker-compose stacks that already use a pgvector-enabled image.

## Context / Root Cause

- Dev/prod and the dev container use `pgvector/pgvector:pg17-trixie` (see `docker-compose*.yml`,
  `docker/postgres-init.sh`, `.devcontainer/docker-compose.yml`), which preinstalls pgvector and
  creates the extension in the default DB and `template1`.
- The ephemeral integration environment, however, starts a plain `postgres:16` Testcontainer
  (`packages/cli/src/lib/testing/integration.ts:2948`). That image does **not** ship the pgvector
  extension files, so `CREATE EXTENSION IF NOT EXISTS vector` (run by
  `packages/search/src/vector/drivers/pgvector/index.ts`) fails with "could not open extension
  control file …vector.control". The driver only special-cases the superuser error (`42501`),
  not the missing-extension error, so vector indexing breaks in the ephemeral env.
- Standalone apps reuse the same compiled CLI code path, so this single fix covers them too.

## Scope

- `packages/cli/src/lib/testing/integration.ts` — swap the ephemeral Postgres image to a
  pgvector-enabled one (env-overridable) and eagerly create the `vector`/`pgcrypto` extensions
  via an initdb script so the extension is guaranteed present, not merely available.
- Unit test the new image/init resolver helpers.

## Non-goals

- Do not change dev/prod/devcontainer docker-compose files (already pgvector).
- Do not change the pgvector driver's runtime extension-creation logic.
- Do not bump the Postgres major version of the ephemeral DB (stay on pg16 to avoid behavioral
  drift in the test suite); only add the pgvector layer.
- Do not touch the reusable-environment path (caller supplies an external `DATABASE_URL`).

## Risks

- A pgvector image pull adds first-run latency in CI; mitigated by Docker layer caching and the
  fact that the image is `postgres:16` + a small extension layer.
- Image tag drift: pin to `pgvector/pgvector:pg16` and allow `OM_INTEGRATION_POSTGRES_IMAGE`
  override for environments that mirror a different Postgres major.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Provision pgvector in the ephemeral DB

- [x] 1.1 Add an env-overridable `resolveEphemeralPostgresImage()` helper defaulting to a pgvector-enabled image — 4c0168e65
- [x] 1.2 Add an initdb SQL constant that creates `vector` + `pgcrypto`, and wire both into the GenericContainer start — 4c0168e65
- [x] 1.3 Add unit tests for the image resolver (default + override) and the init SQL contents — 4c0168e65

### Phase 2: Validation

- [ ] 2.1 Run targeted CLI unit tests + typecheck for changed package
- [ ] 2.2 Full validation gate and self-review
