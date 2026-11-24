# @open-mercato/cache-provider-infinispan

Open Mercato cache provider (`open-mercato/infinispan`) that stores the shared application cache in a **dedicated remote cache on an Infinispan Server** over Hot Rod. It plugs into the v1 cache-provider host of `@open-mercato/cache`; modules keep using the `cache` DI service, tenant scoping and tag invalidation unchanged.

Server-only. ESM with TypeScript types. Placement: `shared` (all app instances see the same entries and invalidations).

## Install

```bash
yarn add @open-mercato/cache-provider-infinispan
```

Peer dependency: `@open-mercato/cache` (>= 0.11.0). Runtime dependencies: the Apache-2.0 Hot Rod client [`infinispan`](https://www.npmjs.com/package/infinispan) (pinned to `0.16.3`, see [Client defects worked around](#client-defects-worked-around)) and `zod`. No other provider package or engine client is pulled in.

## Prepare the server

Create a **dedicated** distributed cache for Open Mercato with `text/plain` encoding and **no eviction** (no `memory.max-count` / `max-size`; see [Limitations](#limitations)). Expiry is handled per entry by the provider.

```json
{
  "distributed-cache": {
    "mode": "SYNC",
    "owners": 2,
    "statistics": true,
    "encoding": { "media-type": "text/plain; charset=UTF-8" }
  }
}
```

For example `POST /rest/v2/caches/open-mercato` with that body, the CLI (`create cache --file=...`) or a server configuration file. Give the application user read/write permissions on that cache only.

## Register (`mercato.cache.ts`)

```ts
import { defineCacheProviderRegistration } from '@open-mercato/cache/provider'

export const cacheProviders = [
  defineCacheProviderRegistration({
    id: 'open-mercato/infinispan',
    load: () => import('@open-mercato/cache-provider-infinispan').then((module) => module.provider),
    settings: () => ({
      servers: [
        { host: process.env.INFINISPAN_HOST_1!, port: 11222 },
        { host: process.env.INFINISPAN_HOST_2!, port: 11222 },
      ],
      cacheName: 'open-mercato',
      auth: {
        username: process.env.INFINISPAN_USER!,
        password: process.env.INFINISPAN_PASSWORD!,
        mechanism: 'SCRAM-SHA-256',
      },
      tls: { enabled: true, caFiles: ['/etc/ssl/infinispan-ca.pem'], serverName: 'infinispan.internal' },
    }),
  }),
]
```

Select it with `CACHE_PROVIDER=open-mercato/infinispan` and a stable `CACHE_PROVIDER_NAMESPACE` per deployment (all instances of one deployment share it; use a new namespace for an incompatible layout change).

## Settings

The schema is strict (unknown keys are rejected) and exported as `infinispanSettingsSchema`.

| Setting | Default | Notes |
|---|---|---|
| `servers` | required | 1–32 `{ host, port }` (port default `11222`). The client fails over between them. |
| `cacheName` | required | Dedicated cache (letters, digits, `.`, `_`, `-`). |
| `auth.username`, `auth.password` | required | Never logged; `redact()` hides them. |
| `auth.mechanism` | `SCRAM-SHA-256` | `SCRAM-SHA-256`, `SCRAM-SHA-384`, `SCRAM-SHA-512`, `DIGEST-MD5`. `PLAIN` is not accepted. |
| `tls` | off | `{ enabled: true, caFiles: [absolute PEM paths], serverName? }`. Server certificates are verified against `caFiles`; `serverName` sets SNI and the name checked against the certificate. |
| `protocolVersion` | `4.1` | `4.1`, `4.0`, `3.1`. Protocol auto-negotiation is deliberately unavailable (it crashes the client). |
| `topologyUpdates` | `true` | Set `false` when the addresses the servers advertise are not reachable from the app (Docker port mapping, NAT). Requests then go to the configured servers and the cluster forwards them. |
| `connectTimeoutMs` | `5000` | Bound on connecting and authenticating. |
| `commandTimeoutMs` | `5000` | Bound on every Hot Rod command. A timed-out connection is discarded and re-established on the next call. |
| `iteratorBatchSize` | `256` | Entries per iterator page for `keys`/`stats`/`clear`/`cleanup`, and keys per bulk read. |
| `concurrency` | `16` | Parallel commands per provider call. |
| `maxCasAttempts` | `64` | Versioned retry budget for one tag-index update or conditional remove. |
| `tagIndexShards` | `64` | Tag-index shards per tag. Part of the layout: change it only together with a new namespace. |
| `maxTagsPerEntry` | `64` | Entries above this (or above `maxValueBytes`) are not stored; the previous copy is removed and a warning is logged. |
| `maxValueBytes` | `4 MiB` | Encoded payload limit per entry. |
| `indexPruneGraceMs` | `120000` | Window after which a tag-index member whose entry is gone or rewritten may be pruned. Must be at least `6 × commandTimeoutMs`. A `set` refuses to write its entry later than `indexPruneGraceMs − 4 × commandTimeoutMs` after its index update, so clock skew between app hosts must stay below `3 × commandTimeoutMs` (see [Limitations](#limitations)). |

Errors use the shared `CacheProviderError` contract: `timeout` (connect or command bound exceeded), `unavailable` (transport, authentication, TLS, contention beyond `maxCasAttempts`), `load_failed` (unsupported client version), `invalid_settings` (field paths only). Messages never contain hosts, credentials or certificate paths.

## Supported matrix

Only profiles with passing real-engine evidence are listed.

| Profile | Status |
|---|---|
| Infinispan Server `15.2.6.Final`, distributed cache, 2 clustered nodes, SCRAM-SHA-256 over TLS, `topologyUpdates: false` | Supported (conformance, engine suite, failover of one node) |
| Infinispan Server `15.2.6.Final`, single node, DIGEST-MD5 over plaintext Hot Rod | Supported (conformance, engine suite) |
| DIGEST-MD5 over TLS | Supported (engine suite check) |

Not verified (do not advertise): `topologyUpdates: true` with client-side routing to advertised addresses (could not be exercised behind Docker port mapping); SCRAM-SHA-384/512 (accepted by the schema, same SASL code path, not run); clusters larger than two nodes; cross-site replication; Infinispan versions other than 15.2.6; protocol versions `4.0`/`3.1` beyond decoder unit tests; client certificate (mutual TLS) authentication (not offered by the schema).

## Storage layout

All keys live in the dedicated cache under the deployment prefix `{namespace}:v2:`; enumeration, `clear` and `cleanup` only touch keys with that prefix.

- **Entry** `{ns}:v2:k:{physicalKey}` → JSON `{ f, w, t, x, e, d }`: format, unique write id, tags, logical expiry, encoding and the codec payload (base64 when compressed). TTLs are native per-entry Hot Rod lifespans, so expired entries disappear on the server.
- **Tag index shard** `{ns}:v2:t:{shards}:{i}:{tag}` → JSON map `physicalKey → [writeId, writtenAt, expiresAt]`. The shard is `sha1(physicalKey) mod tagIndexShards`. A shard's lifespan follows its longest-lived member (plus the grace window) and it has none while any member is immortal.
- **Tenant scope tag (not indexed).** The host wrapper adds `tenant:<id>:tag:__scope__` to every record of a tenant, and every such record's physical key starts with `tenant:<id>:key:`. Indexing that tag would make every write rewrite a shard whose size grows with the tenant. Layout v2 therefore never indexes the scope tag for keys under its tenant prefix: the entry key itself is the membership. A scope-tag record whose key is outside that prefix (not produced by the host) is still indexed normally.

Writes and invalidation:

1. `set` adds `key → writeId` to every indexed tag's shard **before** writing the entry, with `getWithMetadata` + `replaceWithVersion` retry loops (`putIfAbsent` creates a shard). An entry is therefore never visible under an indexed tag that does not index it. The entry is written only inside the grace window after the index update. Index work per `set` depends on the number of ordinary tags, not on how many entries the tenant holds.
2. `deleteByTags` reads the shards with bulk `getAll`, re-reads each candidate entry with `getWithMetadata`, and removes it with `removeWithVersion` only if its **current** tags still match. A concurrently retagged entry is left alone. Each removed record is counted once. For a tenant scope tag (tenant `clear()`), it additionally pages through the cache with the Hot Rod iterator, takes every entry key under `{ns}:v2:k:tenant:<id>:key:`, and applies the same re-read + `removeWithVersion` check. Every entry that existed before the call is returned by the iterator (Infinispan iterates segment by segment and returns every entry not modified during the iteration), so no membership can be lost through index races. An entry written concurrently with the clear may survive or be removed, as with any concurrent write.
3. A member is pruned only with a versioned replace that re-checks its write id: immediately when this call removed exactly that write, and otherwise only after `indexPruneGraceMs` if the entry is gone or was rewritten. A pending write is never unindexed. `set` also drops members whose own TTL passed the grace window, and `cleanup()` garbage-collects index shards.
4. Corrupt or undecodable entries are misses and are removed with a versioned delete.

## Protocol choice (spike, 2026-11-24)

The spike ran against `quay.io/infinispan/server:15.2.6.Final` (arm64) with `infinispan@0.16.3`:

- Hot Rod `getWithMetadata`, `putIfAbsent`, `replaceWithVersion` and `removeWithVersion` are atomic: a 20-way concurrent increment via versioned replace ended at exactly 20, with 190 retries on one node and 162 retries across clients on different cluster members. Stale versions are refused for both replace and remove.
- `iterator(batchSize)` enumerates in bounded pages (1 001 entries in batches of 100), skips expired entries and works across both cluster members.
- Per-entry `lifespan` works at millisecond granularity (a 300 ms entry is gone after 450 ms).
- **REST v2 was rejected:** `PUT`/`DELETE` with a stale `If-Match` ETag still return `204` and apply unconditionally, and `?action=keys` has a `limit` but no cursor or offset for resumable paging. `POST` only gives create-if-absent.

## Migration

- **Layout `v1` → `v2` (this release).** Keys moved from `{ns}:v1:` to `{ns}:v2:` because the tenant scope tag is no longer indexed. The provider ignores `v1` keys: after upgrading, the cache starts empty for the deployment (a cold cache, no wrong results). `v1` entries and shards that had a lifespan expire on their own. Shards with immortal members do not, so remove the `{ns}:v1:` keys once (or recreate the dedicated cache) after all app instances run the new version. Do not run old and new versions against the same namespace at the same time. Their invalidations would not see each other's writes.

## Client defects worked around

`infinispan@0.16.3` has defects that break this provider unless handled. The package pins the exact version and refuses to load (`load_failed`) if it cannot apply its fix.

1. **`getWithMetadata` and iterator pages split across socket reads.** A truncated value decodes as `value: undefined` and desynchronizes the connection, so later commands hang. Locally this hits values from about 64 KiB; over TLS or real networks it hits much smaller ones. In a TLS repro with 60 KiB values and 16 concurrent readers, the unpatched client returned 0 of 640 reads correctly and the patched one returned all 640. A truncated lifespan timestamp throws a `TypeError` inside the socket data handler, which **crashes the Node process**. The iterator page decoder shares the timestamp decoding and crashed the same way on a 5 000-entry tenant `clear()` of entries with a TTL. The provider wraps both decoders at load (`src/hotrodPatch.ts`) so a truncated frame waits for more bytes, as the transport already supports. Only out-of-bounds reads count as a truncated frame. Any other decoder error is rethrown. If the installed client does not expose the decoders in the expected shape, the provider fails with `load_failed` instead of running unpatched. The iterator also runs without per-entry metadata, which the provider never needed. Unit tests reproduce both upstream failures, and any versioned read that still arrives incomplete is a transport error, never a corrupt entry.
2. **Protocol auto-negotiation (`version: 'auto'`) throws inside the socket handler** and crashes the process, so the settings only accept explicit versions.
3. **No connect or command timeouts.** After a server restart the old connection hangs forever. The provider bounds every call and replaces the connection after a timeout or transport error.

These should be reported upstream. Re-qualify before changing the pinned client version.

## Limitations

- **No eviction on the dedicated cache.** If the server evicts a tag-index shard, entries it indexed survive an invalidation of that tag until their TTL. Bound memory with TTLs (`CACHE_TTL` / per-entry `ttl`) and server sizing, not `max-count`/`max-size`.
- `keys`, `stats`, `clear`, `cleanup` and a tenant `clear()` (scope-tag `deleteByTags`) page through the whole dedicated cache with the Hot Rod iterator and filter by prefix client-side. The JS client cannot run server-side key filters. Their cost grows with the cache, not only the namespace or tenant. Keep one cache per Open Mercato deployment.
- An ordinary tag that a very large share of a tenant carries still grows its shards with its member count. Raise `tagIndexShards` (with a new namespace) if one tag spans tens of thousands of live entries.
- `returnExpired` is not supported: entries expire natively on the server.
- Index pruning uses wall-clock timestamps from the app hosts. A member is pruned only when its `writtenAt + indexPruneGraceMs` lies in the pruner's past, and a writer stops writing its entry `4 × commandTimeoutMs` before that point. The margin covers the entry `put` (up to one `commandTimeoutMs`) plus clock skew, so app-host clocks must agree within `3 × commandTimeoutMs` (use NTP).
- A command that times out may still be applied by the server later. Callers see a `timeout` error, and the cache remains consistent because every index change is versioned.

## Evidence

These are **manual runs** on a developer machine, not CI. No CI job runs the container suites yet (see `packages/cache-redis-protocol/README.md` → *Proposed CI job*). All runs were on 2026-11-24 on a macOS arm64 Docker host with Node 26.12, `infinispan@0.16.3` and image `quay.io/infinispan/server:15.2.6.Final` (arm64) with `JAVA_OPTIONS=-Xmx512m`. Container suites are gated by `OM_CACHE_PROVIDER_CONTAINER_TESTS=1` and stop their containers in `afterAll`.

Command: `yarn workspace @open-mercato/cache-provider-infinispan test:containers` (or `yarn test:cache-providers:containers` from the repo root for every provider). Result: 3 suites, 45/45 passed, 54.4 s, layout `v2`.

| Suite | Topology / auth / transport | Result |
|---|---|---|
| `cluster-tls.container.test.ts` | 2-node distributed cache (`owners: 1`, real `cluster_members = 2`), SCRAM-SHA-256 + DIGEST-MD5 over TLS (throwaway CA, PKCS#12 server identity) | 21/21 passed: v1 conformance (16, incl. independent process and corrupt value), namespace fencing + native lifespan, untrusted CA and wrong password refused without leaking secrets, two-process retag race (30 rounds) and chaos run (2 writer processes + 1 invalidator, **0 missing index memberships**), failover after stopping one member |
| `single-node.container.test.ts` | 1 node, DIGEST-MD5 over plaintext Hot Rod | 21/21 passed: v1 conformance (16), native TTL, 300 KiB round-trip through versioned reads + 1 MiB oversize skip, scope-tag load test (below), frozen server (`docker pause`) → `timeout` within bound → reconnect, server restart → reconnect without app restart |
| `packed.container.test.ts` | 1 node, SCRAM-SHA-256 | 3/3 passed: `yarn pack` tarball installed into a fresh app (no sibling adapters, no tests in the tarball), consumer `tsc` type-check of a registration, `resolveCacheProvider` + `createCacheService` workflow against the server |
| Unit (`yarn test`, no Docker) | in-memory versioned fake | 41 passed: settings/redaction, layout, decoder guards (reproduce both upstream defects, rethrow real decode errors, refuse an unexpected client shape), strategy logic incl. scope-tag prefix invalidation, conformance kit over the fake (logic only, not engine evidence) |

### Scope-tag load test (`single-node.container.test.ts`)

4 services with separate connections, 10 concurrent writers each (40 concurrent `set` calls). They write 5 000 entries into one tenant through the tenant wrapper, which means 10 000 physical records carrying the scope tag plus one of 10 ordinary tags, ~1 KiB each, 10 min TTL. Then 2 writers keep writing into the tenant while a third client runs the tenant `clear()`.

| Measure | Result |
|---|---|
| `set` p50 / p95, first 500 entries | 12.8 / 16.3 ms |
| `set` p50 / p95, last 500 entries (tenant at ~5 000) | 11.7 / 13.2 ms |
| Fill of 5 000 entries | 1.48 s |
| Scope-tag index shards in the cache | **0** (642 shards for the 10 ordinary tags) |
| Tenant `clear()` with 2 concurrent writers | 1.03 s. All 5 000 pre-existing entries removed, 390 concurrent writes during the clear, other tenant untouched |

Write latency is flat in tenant size. With layout `v1` the same scope tag sat in every write and its shards grew with the tenant.

### Performance qualification (`qualify.container.test.ts`)

Command: `OM_QUALIFY_OUT=/tmp/qualify.json OM_QUALIFY_SHARDS=64 OM_QUALIFY_CARDINALITY=1000,5000,20000 yarn workspace @open-mercato/cache-provider-infinispan qualify` (manual run, 2026-11-24, layout `v2`).

2-node TLS cluster above, `topologyUpdates: false`, `tagIndexShards: 64`, 2 clients with separate connections running concurrently, 600 ops each (60% get / 30% set of a ~1 KiB JSON value with 2 of 20 tags / 10% `deleteByTags`) over 300 keys in one tenant. Latency is wall-clock per service call including the tenant wrapper (two physical records per logical entry). Commands are Hot Rod commands per call.

| Operation | p50 | p95 | Hot Rod commands per call |
|---|---|---|---|
| `get` | 0.48 ms | 1.05 ms | 1.0 |
| `set` (2 tags + tenant scope tag) | 4.58 ms | 7.06 ms | 10.0 (v1: 14.0) |
| `deleteByTags` | 1.34 ms | 1.93 ms | 2.8 |

Throughput of the mixed run was 1 042 ops/s across both clients (sequential per client). Per-tenant cardinality (50-way concurrent fill with one ordinary tag, 100 probe `set` calls into the populated tenant, then `clear`):

| Entries in tenant | `set` p50 / p95 | `clear` |
|---|---|---|
| 1 000 | 2.47 / 4.99 ms | 367 ms |
| 5 000 | 2.25 / 3.80 ms | 1.30 s |
| 20 000 | 3.72 / 5.49 ms | 3.99 s |

With layout `v1`, 20 000 entries per tenant (even with 256 shards) and 5 000 with 16 shards hit the 10 s command timeout during the fill. With `v2` all three sizes pass with the default 64 shards. `clear` grows linearly because it pages through the cache. Stock Redis was not measured side by side in this package. Compare with the Redis provider's evidence.


## Development

```bash
yarn workspace @open-mercato/cache-provider-infinispan test        # unit tests, no Docker
yarn workspace @open-mercato/cache-provider-infinispan test:containers   # real Infinispan via Testcontainers
OM_QUALIFY_OUT=/tmp/qualify.json OM_QUALIFY_SHARDS=64 OM_QUALIFY_CARDINALITY=1000,5000 \
  yarn workspace @open-mercato/cache-provider-infinispan qualify   # perf qualification (2-node TLS cluster)
```

The container suites need Docker (about 0.3 GB RSS per Infinispan node with `-Xmx512m`). They generate a throwaway CA and server certificate with `openssl` and stop their containers afterwards.
