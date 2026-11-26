# Hardware profiles and derived settings

`HARDWARE_PROFILE` in `perf/config/target.local.env` names one row below. It is a comparability key:
two runs compare only when the profile matches. The same profile always yields the same settings, so
copy the derived values into `perf/config/sut.local.env` and never tune one run by hand.

## Profiles

| Profile | Role | CPU | RAM | Disk | OS | Status |
|---|---|---|---|---|---|---|
| `local-mac` | Phase 2 local validation (SUT, monitoring and k6 on one laptop) | Docker Desktop VM, 8 vCPU assigned | 16 GB assigned to the VM | Apple SSD (virtiofs) | macOS + Docker Desktop | numbers are `local-validation` only |
| `vps-8c32g` | Originally recommended SUT (reference only; not the decided machine) | 8 dedicated vCPU | 32 GB | NVMe | Ubuntu 24.04 LTS, Docker Engine + compose plugin | to be confirmed in Phase 0 |
| `vps-4c8g` | Generator (and a minimal SUT for dry runs) | 4 vCPU | 8 GB | NVMe | Ubuntu 24.04 LTS | **not used**: there is no generator VPS (k6 runs on the tester's laptop) |
| `vps-6c16g` | **SUT** (decided 2026-11-26) | 6 vCPU (dedicated? to confirm) | 16 GB | 80 GB, fixed — cannot be increased (type to confirm) | to confirm | S and M (100k) fit, one at a time; **L cannot run** (see Disk budget) |

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

| Setting | `local-mac` | `vps-8c32g` | `vps-4c8g` | `vps-6c16g` |
|---|---|---|---|---|
| `DB_POOL_MAX` | 20 | 40 | 20 | 20 |
| `WORKER_DB_POOL_MAX` | 8 | 12 | 8 | 8 |
| `PG_MAX_CONNECTIONS` | 200 | 200 | 100 | 100 |
| `PG_SHARED_BUFFERS` | 2GB | 8GB | 2GB | 2GB |
| `PG_EFFECTIVE_CACHE_SIZE` | 6GB | 20GB | 5GB | 6GB |
| `PG_WORK_MEM` | 16MB | 32MB | 8MB | 32MB |
| `PG_MAINTENANCE_WORK_MEM` | 512MB | 1GB | 512MB | 512MB |
| `NODE_OPTIONS` | `--max-old-space-size=3072` | `--max-old-space-size=8192` | `--max-old-space-size=3072` | `--max-old-space-size=4096` |
| `WORKER_NODE_OPTIONS` | `--max-old-space-size=2048` | `--max-old-space-size=4096` | `--max-old-space-size=2048` | `--max-old-space-size=2048` |
| `REDIS_MAXMEMORY` | 512mb | 2gb | 1gb | 1gb |
| `PG_SHM_SIZE` | 1gb | 2gb | 1gb | 1gb |

## Measured durations

Filled in during Phase 2 (S, local) and Phase 3 (S and M on the VPS). `perf/.state/seed-<tier>.json`, `snapshots/<tier>.json`
and `last-restore.json` hold the raw numbers.

| Profile | Tier | Seed (seed-perf) | Query index reindex | Fulltext reindex | Snapshot | Restore | Dataset size |
|---|---|---|---|---|---|---|---|
| `local-mac` | S | 79 s (≈ 630 entities/s) | 362 s | 921 s (Meilisearch, 113k docs) | 64 s | 65 s | 12 GB Postgres (11 GB `search_tokens`), ~0.9 GB Meilisearch |
| `vps-6c16g` | S | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| `vps-6c16g` | M | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| `vps-6c16g` | L | not runnable (disk) | | | | | |

## Disk budget

Measured on `local-mac` at tier S: Postgres 12 GB, of which `search_tokens` is ~11 GB (heap ~2.5× larger than live rows after the reindex pipeline); Meilisearch ~0.9 GB. The template snapshot doubles both. Estimates for M and L scale linearly from S.

| Tier | Postgres | + template snapshot | Meilisearch (×2) | Image + OS + Docker + Prometheus | Total (est.) |
|---|---|---|---|---|---|
| S | 12 GB (measured) | 12 GB | 2 GB | ~20 GB | **~45–50 GB** |
| M (100k + 2 × 5%) | ~24 GB | ~24 GB | ~4 GB | ~20 GB | **~70 GB** (fits 80 GB; no room for S alongside) |
| L | ~240 GB | ~240 GB | ~36 GB | ~20 GB | **~540 GB — cannot run on `vps-6c16g`** |

**Decision (2026-11-26): the 80 GB disk cannot be increased.** Tier M was therefore reduced from 250k to 100k customer entities with 2 background tenants (the 250k version needed ~60 GB for the live database alone). Only one tier fits on disk at a time, so S and M run one after the other (`perf/README.md`, Phase 3). **L cannot run on this VPS.** If the disk gets tight during the soak, `VACUUM FULL search_tokens` before the snapshot recovers ~2.5× of that table's heap, but it changes the dataset state and must be recorded in the run notes.
