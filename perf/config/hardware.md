# Hardware profiles and derived settings

`HARDWARE_PROFILE` in `perf/config/target.local.env` names one row below. It is a comparability key:
two runs compare only when the profile matches. The same profile always yields the same settings, so
copy the derived values into `perf/config/sut.local.env` and never tune one run by hand.

## Profiles

| Profile | Role | CPU | RAM | Disk | OS | Status |
|---|---|---|---|---|---|---|
| `local-mac` | Phase 2 local validation (SUT, monitoring and k6 on one laptop) | Docker Desktop VM, 8 vCPU assigned | 16 GB assigned to the VM | Apple SSD (virtiofs) | macOS + Docker Desktop | numbers are `local-validation` only |
| `vps-8c32g` | **Recommended SUT** | 8 dedicated vCPU | 32 GB | NVMe | Ubuntu 24.04 LTS, Docker Engine + compose plugin | to be confirmed in Phase 0 |
| `vps-4c8g` | Generator (and a minimal SUT for dry runs) | 4 vCPU | 8 GB | NVMe | Ubuntu 24.04 LTS | to be confirmed in Phase 0 |

Shared-vCPU plans add steal-time noise; if one is used, the report's `CPU steal` row must be read before any comparison.

## Derivation rules

| Setting | Rule |
|---|---|
| `PG_MAX_CONNECTIONS` | `DB_POOL_MAX` (app) + `WORKER_DB_POOL_MAX` + 2 (scheduler) + 10 (exporter, psql, maintenance) + ≥ 30% headroom |
| `DB_POOL_MAX` | ≈ 4–5 × app CPU share; never above `PG_MAX_CONNECTIONS` − worker − headroom |
| `PG_SHARED_BUFFERS` | ≈ 25% of RAM available to Postgres |
| `PG_EFFECTIVE_CACHE_SIZE` | ≈ 60–70% of RAM |
| `PG_WORK_MEM` | (RAM − shared_buffers) × 0.25 / `PG_MAX_CONNECTIONS`, rounded down to a power of two, 4–64 MB |
| `PG_MAINTENANCE_WORK_MEM` | ≈ 5% of RAM, max 2 GB (speeds up the seeder's index builds and VACUUM) |
| `NODE_OPTIONS` (app) | `--max-old-space-size` ≈ 25% of RAM, max 8192 |
| `WORKER_NODE_OPTIONS` | ≈ half of the app heap |
| `REDIS_MAXMEMORY` | cache + BullMQ peak during soak × 2; Redis uses `noeviction`, so a full Redis fails writes |
| `PG_SHM_SIZE` | ≥ 1 GB (parallel query workers use `/dev/shm`) |

## Derived settings

| Setting | `local-mac` | `vps-8c32g` | `vps-4c8g` |
|---|---|---|---|
| `DB_POOL_MAX` | 20 | 40 | 20 |
| `WORKER_DB_POOL_MAX` | 8 | 12 | 8 |
| `PG_MAX_CONNECTIONS` | 200 | 200 | 100 |
| `PG_SHARED_BUFFERS` | 2GB | 8GB | 2GB |
| `PG_EFFECTIVE_CACHE_SIZE` | 6GB | 20GB | 5GB |
| `PG_WORK_MEM` | 16MB | 32MB | 8MB |
| `PG_MAINTENANCE_WORK_MEM` | 512MB | 1GB | 512MB |
| `NODE_OPTIONS` | `--max-old-space-size=3072` | `--max-old-space-size=8192` | `--max-old-space-size=3072` |
| `WORKER_NODE_OPTIONS` | `--max-old-space-size=2048` | `--max-old-space-size=4096` | `--max-old-space-size=2048` |
| `REDIS_MAXMEMORY` | 512mb | 2gb | 1gb |
| `PG_SHM_SIZE` | 1gb | 2gb | 1gb |

## Measured durations

Filled in during Phase 2 (S) and Phase 3 (M, L). `perf/.state/seed-<tier>.json`, `snapshots/<tier>.json`
and `last-restore.json` hold the raw numbers.

| Profile | Tier | Seed (seed-perf) | Query index reindex | Fulltext reindex | Snapshot | Restore | Dataset size |
|---|---|---|---|---|---|---|---|
| `local-mac` | S | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| `vps-8c32g` | M | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| `vps-8c32g` | L | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
