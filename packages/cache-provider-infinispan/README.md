# @open-mercato/cache-provider-infinispan

Open Mercato cache provider (`open-mercato/infinispan`) that stores the shared application cache in a **dedicated remote cache on an Infinispan Server** over Hot Rod. It plugs into the v1 cache-provider host of `@open-mercato/cache`; modules keep using the `cache` DI service, tenant scoping and tag invalidation unchanged.

Server-only. ESM with TypeScript types. Placement: `shared` (all app instances see the same entries and invalidations).

## Install

```bash
yarn add @open-mercato/cache-provider-infinispan
```

Peer dependency: `@open-mercato/cache` `^0.11.0`. Runtime dependencies: the Apache-2.0 Hot Rod client [`infinispan`](https://www.npmjs.com/package/infinispan) (pinned to `0.16.3`, see [Client defects worked around](#client-defects-worked-around)) and `zod`. No other provider package or engine client is pulled in.

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
| `indexPruneGraceMs` | `120000` | Window after which a tag-index member whose entry is gone or rewritten may be pruned. Must be at least `4 × commandTimeoutMs` and well above clock skew between app hosts. |

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

All keys live in the dedicated cache under the deployment prefix `{namespace}:v1:`; enumeration, `clear` and `cleanup` only touch keys with that prefix.

- **Entry** `{ns}:v1:k:{physicalKey}` → JSON `{ f, w, t, x, e, d }`: format, unique write id, tags, logical expiry, encoding and the codec payload (base64 when compressed). TTLs are native per-entry Hot Rod lifespans, so expired entries disappear on the server.
- **Tag index shard** `{ns}:v1:t:{shards}:{i}:{tag}` → JSON map `physicalKey → [writeId, writtenAt, expiresAt]`. The shard is `sha1(physicalKey) mod tagIndexShards`. A shard's lifespan follows its longest-lived member (plus the grace window) and it has none while any member is immortal.

Writes and invalidation:

1. `set` adds `key → writeId` to every tag's shard **before** writing the entry, with `getWithMetadata` + `replaceWithVersion` retry loops (`putIfAbsent` creates a shard). An entry is therefore never visible under a tag that does not index it. The entry is written only inside the grace window after the index update.
2. `deleteByTags` reads the shards with bulk `getAll`, re-reads each candidate entry with `getWithMetadata`, and removes it with `removeWithVersion` only if its **current** tags still match. A concurrently retagged entry is left alone. Each removed record is counted once.
3. A member is pruned only with a versioned replace that re-checks its write id: immediately when this call removed exactly that write, and otherwise only after `indexPruneGraceMs` if the entry is gone or was rewritten. A pending write is never unindexed. `set` also drops members whose own TTL passed the grace window, and `cleanup()` garbage-collects index shards.
4. Corrupt or undecodable entries are misses and are removed with a versioned delete.

## Protocol choice (spike, 2026-11-24)

The spike ran against `quay.io/infinispan/server:15.2.6.Final` (arm64) with `infinispan@0.16.3`:

- Hot Rod `getWithMetadata`, `putIfAbsent`, `replaceWithVersion` and `removeWithVersion` are atomic: a 20-way concurrent increment via versioned replace ended at exactly 20, with 190 retries on one node and 162 retries across clients on different cluster members. Stale versions are refused for both replace and remove.
- `iterator(batchSize)` enumerates in bounded pages (1 001 entries in batches of 100), skips expired entries and works across both cluster members.
- Per-entry `lifespan` works at millisecond granularity (a 300 ms entry is gone after 450 ms).
- **REST v2 was rejected:** `PUT`/`DELETE` with a stale `If-Match` ETag still return `204` and apply unconditionally, and `?action=keys` has a `limit` but no cursor or offset for resumable paging. `POST` only gives create-if-absent.

## Client defects worked around

`infinispan@0.16.3` has defects that break this provider unless handled. The package pins the exact version and refuses to load (`load_failed`) if it cannot apply its fix.

1. **`getWithMetadata` responses split across socket reads.** A truncated value decodes as `value: undefined` and desynchronizes the connection, so later commands hang. Locally this hits values from about 64 KiB; over TLS or real networks it hits much smaller ones. In a TLS repro with 60 KiB values and 16 concurrent readers, the unpatched client returned 0 of 640 reads correctly and the patched one returned all 640. A truncated lifespan timestamp throws a `TypeError` inside the socket data handler, which **crashes the Node process**. The provider wraps that decoder at load (`src/hotrodPatch.ts`) so a truncated frame waits for more bytes, as the transport already supports. Unit tests reproduce both upstream failures, and any versioned read that still arrives incomplete is a transport error, never a corrupt entry.
2. **Protocol auto-negotiation (`version: 'auto'`) throws inside the socket handler** and crashes the process, so the settings only accept explicit versions.
3. **No connect or command timeouts.** After a server restart the old connection hangs forever. The provider bounds every call and replaces the connection after a timeout or transport error.

These should be reported upstream. Re-qualify before changing the pinned client version.

## Limitations

- **No eviction on the dedicated cache.** If the server evicts a tag-index shard, entries it indexed survive an invalidation of that tag until their TTL. Bound memory with TTLs (`CACHE_TTL` / per-entry `ttl`) and server sizing, not `max-count`/`max-size`.
- `keys`, `stats`, `clear` and `cleanup` page through the whole dedicated cache with the Hot Rod iterator and filter by prefix client-side. Their cost grows with the cache, not only the namespace. Keep one cache per Open Mercato deployment.
- The tenant scope tag indexes every entry of a tenant, so its shards grow with per-tenant cardinality. Writes rewrite one shard per tag. The measured envelope is in the evidence below. Raise `tagIndexShards` (with a new namespace) for larger tenants.
- `returnExpired` is not supported: entries expire natively on the server.
- Index pruning uses wall-clock timestamps. Keep app-host clock skew far below `indexPruneGraceMs`.
- A command that times out may still be applied by the server later. Callers see a `timeout` error, and the cache remains consistent because every index change is versioned.

## Evidence

All runs on 2026-11-24, macOS arm64 Docker host, Node 26.12, `infinispan@0.16.3`, image `quay.io/infinispan/server:15.2.6.Final` (arm64) with `JAVA_OPTIONS=-Xmx512m`. Container suites are gated by `OM_CACHE_PROVIDER_CONTAINER_TESTS=1` and stop their containers in `afterAll`.

| Suite | Topology / auth / transport | Result |
|---|---|---|
| `cluster-tls.container.test.ts` | 2-node distributed cache (`owners: 1`, real `cluster_members = 2`), SCRAM-SHA-256 + DIGEST-MD5 over TLS (throwaway CA, PKCS#12 server identity) | 21/21 passed: v1 conformance (16, incl. independent process and corrupt value), namespace fencing + native lifespan, untrusted CA and wrong password refused without leaking secrets, two-process retag race (30 rounds) and chaos run (2 writer processes + 1 invalidator, 166 invalidations, **0 missing index memberships**), failover after stopping one member |
| `single-node.container.test.ts` | 1 node, DIGEST-MD5 over plaintext Hot Rod | 20/20 passed: v1 conformance (16), native TTL, 300 KiB round-trip through versioned reads + 1 MiB oversize skip, frozen server (`docker pause`) → `timeout` within bound → reconnect, server restart → reconnect without app restart |
| `packed.container.test.ts` | 1 node, SCRAM-SHA-256 | 3/3 passed: `yarn pack` tarball installed into a fresh app (no sibling adapters, no tests in the tarball), consumer `tsc` type-check of a registration, `resolveCacheProvider` + `createCacheService` workflow against the server |
| Unit (`yarn test`, no Docker) | in-memory versioned fake | 36 passed: settings/redaction, layout, decoder guard (reproduces both upstream defects), strategy logic, conformance kit over the fake (logic only, not engine evidence) |

Full container run: `yarn test:containers` → 3 suites, 44/44 passed, 67.8 s.

### Performance qualification (`qualify.container.test.ts`)

2-node TLS cluster above, `topologyUpdates: false`, `tagIndexShards: 64`, 2 clients with separate connections running concurrently, 600 ops each (60% get / 30% set of a ~1 KiB JSON value with 2 of 20 tags / 10% `deleteByTags`) over 300 keys in one tenant. Latency is wall-clock per service call including the tenant wrapper (two physical records per logical entry). Commands are Hot Rod commands per call.

| Operation | p50 | p95 | Hot Rod commands per call |
|---|---|---|---|
| `get` | 0.64 ms | 1.27 ms | 1.0 |
| `set` (2 tags + tenant scope tag) | 6.06 ms | 9.62 ms | 14.0 |
| `deleteByTags` | 1.52 ms | 2.33 ms | 3.7 |

Throughput of the mixed run was 773 ops/s across both clients (sequential per client). Per-tenant cardinality (100 probe `set` calls into a populated tenant, then `clear`):

| Entries in tenant | `set` p50 / p95 | `clear` |
|---|---|---|
| 1 000 | 4.46 / 6.12 ms | 265 ms |
| 5 000 | 4.47 / 7.55 ms | 1.18 s |

Operating envelope: up to 5 000 entries per tenant with the default 64 shards. Outside it, with **16 shards at 5 000 entries** and **256 shards at 20 000 entries**, single commands exceeded the 10 s command timeout during the 50-way concurrent fill. That surfaced as `timeout` errors, not wrong results. It is not qualified, and the probe at 20 000 could not be repeated cleanly on the shared Docker host. Stock Redis was not measured side by side in this package. Compare with the Redis provider's evidence.


## Development

```bash
yarn workspace @open-mercato/cache-provider-infinispan test        # unit tests, no Docker
yarn workspace @open-mercato/cache-provider-infinispan test:containers   # real Infinispan via Testcontainers
OM_QUALIFY_OUT=/tmp/qualify.json OM_QUALIFY_SHARDS=64 OM_QUALIFY_CARDINALITY=1000,5000 \
  yarn workspace @open-mercato/cache-provider-infinispan qualify   # perf qualification (2-node TLS cluster)
```

The container suites need Docker (about 0.3 GB RSS per Infinispan node with `-Xmx512m`). They generate a throwaway CA and server certificate with `openssl` and stop their containers afterwards.
