# Checkpoint 1 — provider extension through real entry points

Date: 2026-11-24 · Branch: `feat/pluggable-cache-providers` · Runner: **local mode** (no compose `app` container; ephemeral Postgres via testcontainers)

Fixture: `packages/cache/fixtures/cache-provider-fixture` (`acme/fixture-fs`, placement `shared`), installed the operator way:
`npm pack` → extracted into `apps/mercato/node_modules/@acme/cache-provider-fixture` (temporary, removed).
Temporary `apps/mercato/mercato.cache.ts` (removed afterwards):

```ts
defineCacheProviderRegistration({
  id: 'acme/fixture-fs',
  load: () => import('@acme/cache-provider-fixture').then((m) => m.provider),
  settings: () => ({ directory: process.env.ACME_FIXTURE_CACHE_DIR ?? '' }),
})
```

Provider env used: `CACHE_PROVIDER=acme/fixture-fs CACHE_PROVIDER_NAMESPACE=checkpoint ACME_FIXTURE_CACHE_DIR=/tmp/ckpt-fixture-run`.

## Results

| # | Check | Result |
|---|-------|--------|
| 0 | `TMPDIR=/tmp yarn build:packages` | PASS (42/42) |
| 1 | `yarn generate` re-exports the app manifest | PASS — `cache-providers.generated.ts` → `import { cacheProviders as appCacheProviders } from '../../mercato.cache'` |
| 2 | Ephemeral env (`yarn test:integration:ephemeral:start:verbose`) with provider env: initialize (CLI) + generate + `build:packages` + `next build` + `mercato server start` | PASS — app ready on :5001; ephemeral sqlite cache file never created |
| 2a | `GET /api/healthz` | PASS — `200 {"status":"ok","ts":…}` |
| 2b | Files in fixture dir after boot / cached CRUD reads; `/api/configs/cache` stats; purge | PASS — `ns-checkpoint/` had 146 entries after boot; after 3 CRUD list reads stats = `totalKeys 3 (companies:1, people:1, products:1)`; `POST {action:'purgeAll'}` → `totalKeys 0`, file count 176 → 132 (non-CRUD entries kept) |
| 2c | `chmod 000` fixture dir → healthz | PASS — `503 {"status":"degraded","ts":…}` (body only status/ts); log: `[healthz] Infrastructure probe failed { component: 'redis', error: 'Cache provider healthcheck failed' }` (no path/settings leaked); after `chmod 755` → 200 |
| 2d | `CACHE_PROVIDER=acme/does-not-exist` | PASS — `mercato server start` aborts: `💥 Failed: Cache provider "acme/does-not-exist" is selected but not registered by the application`. Bypassing the CLI with `next start`: healthz `503`, log `[healthz] Healthcheck setup failed { error: 'Cache provider "acme/does-not-exist" is selected but not registered by the application' }` — no memory fallback |
| 2e | `CACHE_PROVIDER` unset (stock) | PASS — `next start` healthz `200 {"status":"ok"}`; full managed ephemeral run (stock, empty manifest) TC-CONF-001..007 14/14 passed |
| 3a | CLI `yarn mercato configs cache stats --all-tenants` with provider | PASS — sees the server-written keys cross-process: `scope=tenant:… totalKeys=2 (companies, people)`; same command without provider (stock sqlite from `.env`) → `totalKeys=0` |
| 3b | CLI `configs cache purge --all --all-tenants` with provider | PASS — `scope=global deleted=67`, `scope=tenant:… deleted=8`; stats afterwards 0 |
| 3c | CLI with unregistered provider | PASS — `💥 Failed: Cache provider "acme/does-not-exist" is selected but not registered by the application` |
| 3d | Post-generate structural purge through provider (`apps/mercato` `yarn generate`, outputs changed) | PASS — `[generate] Structural invalidation completed (1 cache entry, 385 generated artifacts refreshed).` With unregistered id: `Structural cache purge skipped: Cache provider "acme/does-not-exist" is selected but not registered…` (generation still succeeds) |
| 3e | Root `yarn generate` (turbo) | **FINDING** — see below: `CACHE_PROVIDER` is stripped by turbo strict env mode |
| 3f | `OM_MULTI_INSTANCE=1 NODE_ENV=production mercato server start` | PASS — provider: offenders list only `QUEUE_STRATEGY=local`, `RATE_LIMIT_STRATEGY=memory` (cache treated as safe); stock control: `CACHE_STRATEGY=sqlite` listed as an offender |
| 4 | New spec `TC-CONF-007` (healthz body + admin stats/purge + employee purge denied) | PASS — 14/14 TC-CONF under provider env (reused env) and 14/14 under stock (managed run). Committed `48fa8d9422` |
| 5 | Production `next build` with `mercato.cache.ts` + literal `import('@acme/cache-provider-fixture')` | PASS — ephemeral `Building application completed in 88s`; production server then served provider-backed cache (2a–2c) |
| 6 | Cleanup | DONE — manifest/fixture removed, `yarn generate` → `export const cacheProviders: CacheProviderRegistration[] = []`, ephemeral env stopped via SIGINT (container removed), ad-hoc servers killed by process group, chmod restored |

## Findings

1. **Root `yarn generate` drops `CACHE_PROVIDER` (turbo strict env mode).** `turbo.json` `generate` task (lines ~60–63) declares no `env`/`passThroughEnv`, and Turbo 2.10 runs in strict mode, so shell-exported `CACHE_PROVIDER`, `CACHE_PROVIDER_NAMESPACE` and provider-settings vars never reach `mercato generate`. Repro: with the fixture registered, `echo "// x" >> apps/mercato/.mercato/generated/cache-providers.generated.ts; CACHE_PROVIDER=acme/does-not-exist CACHE_PROVIDER_NAMESPACE=x yarn generate` at the repo root → `Structural invalidation completed (0 cache entries…)` with no provider error (it purged the stock `.env` backend), while the same command from `apps/mercato` reports the `not registered` skip. Effect: post-generate purge targets the stock backend instead of the selected provider when env is exported in the shell (values in `apps/mercato/.env` are still read by the CLI, so file-configured deployments work). Same pre-existing behavior applies to `CACHE_STRATEGY`. Suggested fix: add `"passThroughEnv": ["CACHE_*", …]` (provider settings env names are arbitrary, so also document "put provider env in `.env`" or loosen env mode for `generate`). Standalone apps (no turbo) are unaffected.
2. Minor (cosmetic, internal): provider readiness failures log `component: 'redis'` (`apps/mercato/src/app/api/healthz/route.ts` probe name). Plan says the probe name stays internal, so not a contract issue, but it is misleading for operators reading logs.
3. Process note: during the run the index gained intent-to-add (`git add -N`) entries for the temporary `apps/mercato/mercato.cache.ts` and the new spec (not done by this verifier's commands; possibly another executor touching this worktree — a docs commit `48805b4a2b` also landed on this branch mid-run). The `mercato.cache.ts` entry was removed with `git rm --cached`; it never reached a commit.

## Not covered

- Freshly scaffolded Verdaccio standalone install, worker/scheduler processes with the provider (ephemeral auto-spawned workers ran under the provider env during 2a–2c without errors, but were not separately exercised), webhook/other runtime-dependent cache consumers.
