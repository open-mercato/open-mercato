# @open-mercato/cache-redis-protocol

Shared RESP (Redis protocol) cache strategy for Open Mercato cache provider packages. **This is a library, not a provider**: apps install an engine package (`@open-mercato/cache-provider-valkey`, `-redis`, `-keydb`, or an Enterprise managed-service provider) which depends on it.

It implements the v1 `CacheStrategy` over already tenant-scoped physical keys (see `@open-mercato/cache/provider`) on top of [ioredis](https://github.com/redis/ioredis) 6.x.

## API

```ts
import {
  createRespCacheStrategy,
  createIoredisClientFactory,
  createRespCacheProvider,
  createRespStandaloneSettingsSchema,
  createRespSettingsSchema,
  redactRespSettings,
} from '@open-mercato/cache-redis-protocol'
```

| Export | Purpose |
|---|---|
| `createRespCacheStrategy(clientFactory, { namespace, helpers, logger?, defaultTtl?, batchSize?, maxValueBytes?, timeouts? })` | The strategy. `clientFactory` returns an ioredis `Redis`/`Cluster` (or `{ client, dispose }`), so client construction stays injectable. |
| `createIoredisClientFactory(settings, { credentialsProvider?, refreshIntervalMs?, redisOptions?, clusterOptions?, onError? })` | Standalone or cluster client with TLS, ACL credentials, bounded connect/command timeouts and capped reconnect backoff. `credentialsProvider` supplies fresh credentials before connecting, on every reconnect, and every `refreshIntervalMs` (re-`AUTH` of live connections) — the hook managed providers use for token-based auth. |
| `createRespCacheProvider({ id, settings, expectedEngine?, clientOptions? })` | Everything a provider definition needs except `apiVersion`; provider packages pass it to `defineCacheProvider`. |
| `createRespStandaloneSettingsSchema()` / `createRespSettingsSchema()` | Strict zod settings (standalone only / standalone or cluster). |
| `redactRespSettings(settings)` | Operator-safe view: endpoints and tuning, never credentials or key material. |
| `buildRespKeyLayout(namespace)` | The physical key layout (below). |

## Storage layout (version 1)

With `<ns>` the deployment namespace (`CACHE_PROVIDER_NAMESPACE`):

| Key | Type | Content |
|---|---|---|
| `om:{<ns>}:v:<physicalKey>` | string | `helpers.encode(JSON {v:1, value, tags, expiresAt})` with a native `PX` TTL |
| `om:{<ns>}:t:<tag>` | set | physical keys indexed under the tag (no TTL) |

- **Single-slot trade-off.** The `{<ns>}` hash tag places every key of a namespace in one cluster slot. That is what makes the value + tag-set write a single `MULTI`, lets one Lua script compare and delete a value and its memberships, and keeps `MGET` batches legal on a cluster. The cost: a namespace never spreads across shards — one namespace's data and traffic live on one primary. Use several namespaces (or deployments) if one primary cannot hold the cache.
- **Writes**: `MULTI { SET value [PX ttl]; SADD tag-set member … }`. A retag does not touch old tag sets; stale memberships are reaped lazily.
- **Tag invalidation**: `SSCAN` each tag set in `batchSize` pages, `MGET` the members, decode them, then one `EVALSHA` per batch that deletes a value (and removes it from all its tag sets) **only if its bytes still hash to the observed SHA-1**. A concurrent rewrite or retag therefore survives, and stale members are removed only while the value is still absent or unchanged — membership of a concurrently re-tagged entry is never lost. `NOSCRIPT` falls back to `EVAL`.
- **Enumeration** (`keys`, `stats`, `clear`) uses `SCAN MATCH om:{<ns>}:v:<literal prefix>*` with `COUNT batchSize`; never `KEYS`, `FLUSHDB` or `FLUSHALL`. On a cluster every primary is scanned.
- **Expiry** is native: expired entries are gone, so `returnExpired` is not supported and `stats().expired` is always 0. `cleanup()` reaps tag-set members whose value expired.
- **Reads** go to primaries only (`scaleReads: 'master'` on clusters, a single writable endpoint otherwise).
- **Corrupt values** (undecodable bytes) are a miss and are deleted with the same compare-and-delete.
- **Oversize writes** (encoded entry larger than `maxValueBytes`) are skipped with a warning and the previous value is deleted so no stale value is served.

### Least-privilege ACL

The strategy needs only `@read @write @keyspace @scripting @transaction @connection` minus `@dangerous`, fenced to `~om:*`:

```
user om-cache on >… ~om:* resetchannels -@all +@read +@write +@keyspace +@scripting +@transaction +@connection -@dangerous
```

`INFO` (used only for an optional engine-mismatch warning) is not required; the ioredis ready check is disabled for that reason. A cluster client additionally needs topology discovery: `+cluster|slots +cluster|shards +cluster|info`.

### Cluster behaviour

Multi-key commands (the write `MULTI`, invalidation scripts, `MGET`) receive `TRYAGAIN` while their slot is being migrated; the strategy retries them up to `tryAgainAttempts` (default 40) × 50 ms, so writes wait out a short migration instead of failing. Single-key commands follow `MOVED`/`ASK` through ioredis.

## Settings (shared by the engine packages)

| Key | Default | Notes |
|---|---|---|
| `mode` | `standalone` | `cluster` only through `createRespSettingsSchema()` (needs `nodes`) |
| `host`, `port`, `db` | –, `6379`, `0` | standalone endpoint |
| `nodes[]` | – | cluster seeds `{ host, port }` |
| `username`, `password` | – | ACL credentials; a username requires a password |
| `tls` | off | `{ ca?, cert?, key?, servername?, rejectUnauthorized = true }` (PEM strings) |
| `connectTimeoutMs` | `5000` | 100–120000 |
| `commandTimeoutMs` | `2000` | 50–120000 |
| `maxRetriesPerRequest` | `1` | 0–10 |
| `batchSize` | `500` | 1–5000; SCAN/SSCAN COUNT and per-script batch |
| `maxValueBytes` | `8 MiB` | 1 KiB–512 MiB |

Unknown keys are rejected.

## Tests

- `yarn workspace @open-mercato/cache-redis-protocol test` — Docker-free unit tests (layout, settings, redaction, scripts).
- `test-support/` holds the shared real-engine harness used by every provider package: pinned containers with an ACL file and throwaway TLS CA (`engine.ts`), an independent-process conformance host (`host.ts`, `conformance-child.mjs`), packed installation (`packed.ts`) and the latency/command-count qualification (`qualify.ts`). It is not published.
- `OM_CACHE_PROVIDER_CONTAINER_TESTS=1 yarn workspace @open-mercato/cache-redis-protocol test:containers` — protocol-level container tests (Valkey Cluster profile).

## Evidence — Valkey Cluster profile (protocol level)

| Image | Topology | Auth / transport | Suite | Date |
|---|---|---|---|---|
| `valkey/valkey:8.1` | 3 primaries (3 `valkey-server` processes, 0 replicas) in one container, announced on 127.0.0.1 | ACL user fenced to `~om:*` (+ cluster topology commands), plain TCP | **19/19 passed**: v1 conformance (16, incl. independent process, 601-entry batch crossing with `batchSize` 64, corrupt value), namespaces spread over ≥2 primaries with one slot each, live slot migration under concurrent reads/writes (MOVED/ASK + TRYAGAIN: 412 keys moved, 642 live ops, 0 errors), reconnect after `CLIENT KILL` on every node | 2026-11-24 |

**Not verified:** replica failover (no replicas in the test topology), TLS on cluster bus/client, Redis Cluster and KeyDB cluster/active-active. The Valkey provider package therefore still accepts only the standalone profile.
