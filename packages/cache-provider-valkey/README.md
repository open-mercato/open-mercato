# @open-mercato/cache-provider-valkey

Open Mercato's server-only **Valkey** cache provider (`open-mercato/valkey`) uses the shared RESP strategy in [`@open-mercato/cache-redis-protocol`](../cache-redis-protocol/README.md) and the v1 provider API in `@open-mercato/cache/provider`.

## Install

```bash
yarn add @open-mercato/cache-provider-valkey
```

Peer dependency: `@open-mercato/cache` (>= 0.11.0). Runtime dependency: `@open-mercato/cache-redis-protocol` only (it pins the `ioredis` client exactly) — no other provider package or engine client is pulled in.

## Register and select

Add the registration to the app's `src/providers/cache.ts`, then run `yarn generate`.

```ts
import { readFileSync } from 'node:fs'
import { defineCacheProviderRegistration } from '@open-mercato/cache/provider'

export const cacheProviders = [
  defineCacheProviderRegistration({
    id: 'open-mercato/valkey',
    load: () => import('@open-mercato/cache-provider-valkey').then((module) => module.provider),
    settings: () => ({
      host: process.env.CACHE_VALKEY_HOST ?? 'localhost',
      port: Number(process.env.CACHE_VALKEY_PORT ?? 6379),
      username: process.env.CACHE_VALKEY_USERNAME,
      password: process.env.CACHE_VALKEY_PASSWORD,
      tls: process.env.CACHE_VALKEY_TLS_CA_FILE
        ? { ca: readFileSync(process.env.CACHE_VALKEY_TLS_CA_FILE, 'utf8') }
        : undefined,
    }),
  }),
]
```

```bash
CACHE_PROVIDER=open-mercato/valkey
CACHE_PROVIDER_NAMESPACE=prod-eu-1   # stable per deployment; change it for an incompatible layout
```

The variable names above are only an example — the package reads no environment variables itself; `settings()` decides.

## Settings

Validated by a strict zod schema (`settings` export); unknown keys are rejected and errors report field paths only.

| Key | Default | Notes |
|---|---|---|
| `host` | — (required) | Single writable endpoint |
| `port` | `6379` | |
| `db` | `0` | Logical database |
| `username` / `password` | — | ACL credentials; a username requires a password. Redacted by `redact()` |
| `tls` | off | `{ ca?, cert?, key?, servername?, rejectUnauthorized = true }` — PEM strings; presence enables TLS |
| `connectTimeoutMs` | `5000` | Initial connect bound (100–120000) |
| `commandTimeoutMs` | `2000` | Per-command bound (50–120000) |
| `maxRetriesPerRequest` | `1` | Retries of a command across reconnects (0–10) |
| `batchSize` | `500` | SCAN/SSCAN COUNT and entries per invalidation script (1–5000) |
| `maxValueBytes` | `8388608` | Encoded entries above this are not stored; the previous value is deleted |

`mode: "cluster"` is **not** accepted by this package (see unverified profiles). Storage layout, invalidation algorithm and the least-privilege ACL are documented in the protocol library README. Minimal ACL for the cache user:

```
user om-cache on >… ~om:* resetchannels -@all +@read +@write +@keyspace +@scripting +@transaction +@connection -@dangerous
```

## Supported matrix

| Engine image | Topology | Auth / transport | Status |
|---|---|---|---|
| `valkey/valkey:8.1` | standalone, single writable endpoint | ACL user (default user disabled) + TLS with CA verification | **Supported** (32/32 real-engine tests) |

First profile: One writable Valkey endpoint (standalone), ACL username + password, TLS (server verification against a configured CA), bounded connect/command timeouts.

### Unverified profiles (not supported until qualified)

- **Valkey Cluster** — qualified at the protocol level (see `@open-mercato/cache-redis-protocol` README: 3 primaries, real sharding, MOVED/ASK + live slot migration, reconnect; 19/19), but replica **failover** is not yet verified, so this package's settings schema does not accept `mode: "cluster"` yet.
- Sentinel-managed endpoints, replicas as read endpoints (reads always go to the primary by design).
- Valkey 7.2 / 8.0 / 9.x — only 8.1 was run.
- Mutual TLS (client certificates) — supported by the settings (`tls.cert`/`tls.key`) but not exercised against a container requiring client certs.

## Licensing

Valkey is BSD-3-Clause. `ioredis` (client) is MIT.

## Limitations

- Native TTL: expired entries disappear, so `returnExpired` is not supported and `stats().expired` is always `0`.
- One namespace lives in one hash slot (`om:{<namespace>}:…`); on a cluster it cannot spread over shards.
- Tag sets carry a native TTL no shorter than their longest-lived member (persistent while they hold a member written without TTL). Members of expired, overwritten or retagged entries are reaped by `cleanup()` (schedule it periodically) and lazily by `deleteByTags()`.
- Oversize writes are dropped (with a warning) rather than stored or truncated.
- After an engine restart without persistence the cache is empty; the same service reconnects (capped backoff, ≤ 2 s) without being recreated.
- Commands fail fast while the endpoint is unreachable (bounded by `commandTimeoutMs` × `maxRetriesPerRequest`); the cache service surfaces those errors.
- `INFO` is optional; without it the engine-mismatch warning is skipped.

## Evidence

Manual runs on a developer machine (macOS arm64, Docker Desktop), not CI. No CI job runs the container suites yet (see `packages/cache-redis-protocol/README.md` → *Proposed CI job*). Command: `yarn workspace @open-mercato/cache-provider-valkey test:containers` (or `yarn test:cache-providers:containers` from the repo root).

| Image | Topology | Auth / TLS | Suite | Date |
|---|---|---|---|---|
| `valkey/valkey:8.1` (linux/arm64) | standalone | ACL user fenced to `~om:*`, default user off, TLS-only listener with throwaway CA | **33 passed / 0 failed / 33 total** container tests; unit (Docker-free default `yarn test`): 5 passed, container tests skipped there | 2026-11-24 |

Container suite (`OM_CACHE_PROVIDER_CONTAINER_TESTS=1 yarn workspace @open-mercato/cache-provider-valkey test:containers`, Testcontainers, real engine — no emulator, nothing skipped):

- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > reports healthy through the service healthcheck
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > round-trips get/set/has/delete for JSON values
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > expires entries after a per-entry TTL
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > applies the default TTL and lets a per-entry TTL override it
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > cleanup removes expired entries and keeps live ones
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > deleteByTags removes each entry carrying any tag exactly once
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > retagging an entry drops its old tag membership
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > enumerates logical keys with glob patterns and reports scoped stats
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > scoped clear leaves other tenants and foreign namespaces intact
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > isolates foreign namespaces on the same backing store
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > keeps interleaved tenant contexts isolated
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > propagates writes and invalidations across separate service instances
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > propagates writes and invalidations to and from an independent process
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > treats a corrupt stored value as a miss and recovers on rewrite
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > crosses the batch boundary with 601 entries
- ✅ cache provider conformance: valkey/valkey:8.1 · standalone · ACL + TLS > closes idempotently and a closed service reconnects or fails cleanly
- ✅ engine-specific behaviour > stores entries under the hash-tagged layout with native TTL on values and tag sets
- ✅ engine-specific behaviour > keeps a tag set alive as long as its longest-lived member and persistent for members without TTL
- ✅ engine-specific behaviour > stays inside its namespace and ACL key fence
- ✅ engine-specific behaviour > rejects wrong credentials without leaking them
- ✅ engine-specific behaviour > requires TLS and verifies the server certificate
- ✅ engine-specific behaviour > healthcheck does not mutate the keyspace
- ✅ engine-specific behaviour > cleanup reaps tag members of natively expired entries
- ✅ engine-specific behaviour > skips oversize writes and removes the previous value
- ✅ engine-specific behaviour > runs scripts through EVALSHA and recovers after SCRIPT FLUSH
- ✅ engine-specific behaviour > keeps retagged entries and their new membership under concurrent invalidation from two processes
- ✅ engine-specific behaviour > compare-and-delete keeps an entry retagged between the invalidation read and its delete
- ✅ engine-specific behaviour > reconnects after the server drops its connections
- ✅ packed installation > installs the provider without sibling adapters
- ✅ packed installation > type-checks an app registration against the installed types
- ✅ packed installation > resolves through a registration and serves a cache workflow
- ✅ performance qualification > records latency and command counts under tag churn with two clients
- ✅ server restart > recovers the same service after the engine restarts (cache emptied)

Concurrent retag vs. invalidation across two processes (300 races): 200 of 300 v0 entries invalidated before the retag landed, 100 retagged first; final values v1=300, missing=0 — every survivor carried the new value and was removed by its new tag.

### Performance qualification

Two independent service instances (separate connections) through the tenant-aware cache service, TLS + ACL, laptop Docker (Apple Silicon, linux/arm64 VM): 2000 ops per client, 512-byte payloads, 2 tags per write from a pool of 25, 400 keys per client, one `deleteByTags` every 20 ops.

| Operation | Count | p50 (ms) | p95 (ms) | max (ms) |
|---|---|---|---|---|
| `set` | 2000 | 0.302 | 0.497 | 2.786 |
| `get` | 1800 | 0.138 | 0.233 | 2.228 |
| `deleteByTags` | 200 | 0.81 | 1.446 | 3.132 |

Throughput 7233 logical ops/s, 0 errors, 15.05 server commands per logical op (each service `set` writes a value and a metadata record through one `EVALSHA`; commands inside scripts are counted, so the per-tag `PTTL`/`PEXPIRE` of the tag-set TTL rule add server work but no round trips). Server command counts: srem=13030, pttl=11838, sadd=11838, get=7519, evalsha=4314, del=4118, set=4000, pexpire=3158, sscan=200, mget=198. Manual run, 2026-11-24, same command as above.

Accepted operating envelope for this profile: entries ≤ `maxValueBytes` (8 MiB default), tag sets up to the tested 601+ members per tag with `batchSize` 64–500, p95 budget ≈ 1 ms for `get`/`set` and ≈ 3 ms for a `deleteByTags` of ~20 entries on a local network.

## Tests

```bash
yarn workspace @open-mercato/cache-provider-valkey test                                   # unit, Docker-free
OM_CACHE_PROVIDER_CONTAINER_TESTS=1 yarn workspace @open-mercato/cache-provider-valkey test:containers
```
