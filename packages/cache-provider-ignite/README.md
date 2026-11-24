# @open-mercato/cache-provider-ignite

Apache Ignite **2.x** cache provider for the Open Mercato cache service. It plugs into the v1 provider
host (`@open-mercato/cache/provider`) and is selected with `CACHE_PROVIDER=open-mercato/ignite`. The
existing tenant wrapper, `cache` DI service, tag invalidation, readiness and cache administration paths
stay unchanged.

- Provider id: `open-mercato/ignite` · placement: `shared`
- Client: [`apache-ignite-client`](https://www.npmjs.com/package/apache-ignite-client) **1.0.0** (Ignite
  Node.js thin client, binary protocol 1.2.0). Verified on Node.js 22+ (qualified on Node 26.12).
- Server-only ESM package with TypeScript declarations.
- Apache Ignite **3.x is not supported** (different protocol and client).

## Install

```bash
yarn add @open-mercato/cache-provider-ignite
```

`@open-mercato/cache` (with the v1 provider host) is a peer dependency.

**Also pin the client's transitive dependencies in your app.** `apache-ignite-client` declares `long` and `decimal.js` as `latest`. Add the `overrides` (npm) or `resolutions` (yarn) entries from [Supply-chain notes](#supply-chain-notes) to your app's `package.json`.

## Register the provider (`mercato.cache.ts`)

Add the registration to `<app root>/mercato.cache.ts` (next to `package.json`), then run `yarn generate`.

```ts
import { readFileSync } from 'node:fs'
import type { CacheProviderRegistration } from '@open-mercato/cache/provider'

export const cacheProviders: CacheProviderRegistration[] = [
  {
    id: 'open-mercato/ignite',
    load: () => import('@open-mercato/cache-provider-ignite').then((mod) => mod.provider),
    settings: () => ({
      endpoints: (process.env.IGNITE_ENDPOINTS ?? '127.0.0.1:10800').split(','),
      username: process.env.IGNITE_USERNAME,
      password: process.env.IGNITE_PASSWORD,
      tls: process.env.IGNITE_TLS_CA_FILE
        ? { ca: readFileSync(process.env.IGNITE_TLS_CA_FILE, 'utf8') }
        : undefined,
    }),
  },
]
```

```bash
CACHE_PROVIDER=open-mercato/ignite
CACHE_PROVIDER_NAMESPACE=prod-eu-1        # stable deployment namespace; selects the Ignite cache
IGNITE_ENDPOINTS=ignite-1:10800,ignite-2:10800
```

`username` and `password` must be given together. Leave `tls` undefined for a plaintext connector.

## Settings

The schema is strict: unknown keys are rejected, and errors report field paths only, never values.

| Setting | Type / default | Meaning |
|---|---|---|
| `endpoints` | `string[]` (1–32), required | Thin-client endpoints `host:port` (IPv6 as `[::1]:10800`). The client fails over across them. |
| `username`, `password` | strings, optional, both or neither | Ignite built-in authentication. |
| `tls` | object, optional | Presence enables TLS: `ca`, `cert`, `key` (PEM strings; `cert`/`key` together), `servername`, `rejectUnauthorized` (default `true`). Minimum TLS 1.2. |
| `cacheNamePrefix` | default `om-cache-` | The Ignite cache name is `<prefix><namespace>`, and must match the server template (see below). |
| `createCache` | default `true` | `getOrCreateCache` for the namespace cache. With `false`, the cache must already exist. |
| `connectTimeoutMs` | default `5000` (100–120000) | Bound on connect and cache resolution. |
| `commandTimeoutMs` | default `5000` (50–120000) | Bound on every command and every scan page. On expiry the session is dropped and rebuilt on next use. |
| `scanPageSize` | default `256` (1–10000) | `ScanQuery` page size for enumeration (`keys`, `stats`, `deleteByTags`, `clear`, `cleanup`). |
| `scanTimeoutMs` | default `120000` (1000–3600000) | Bound on one whole namespace scan. On expiry the call fails with code `timeout`. |
| `mutationConcurrency` | default `16` (1–256) | Parallel conditional removals per scanned batch. |
| `casAttempts` | default `8` (1–64) | Conditional-delete retries per entry before the call fails loudly. |
| `maxValueBytes` | default `4 MiB` (1 KiB–256 MiB) | Larger records are refused with `IgniteCacheValueTooLargeError` (`code: 'value_too_large'`). The previous copy of the key is deleted first, so a stale value is never served after a failed overwrite. Through the cache service the error arrives as a sanitized `CacheProviderError` (`code: 'unavailable'`) with the original as its non-enumerable `originalError`. |

`provider.redact(config)` returns endpoints and tuning values. It replaces the username, password, CA
and key material with `[redacted]`/`configured`.

Failures use the host's sanitized `CacheProviderError`: `unavailable` for transport, authentication,
TLS or missing-cache failures, and `timeout` for deadlines. Messages never contain credentials.

## Server configuration (required)

Ready-to-run Spring XML files ship in `docker/` (also in the npm tarball):

- `docker/ignite-config.xml`: in-memory, no authentication, plaintext connector on `10800`.
- `docker/ignite-secure-config.xml`: native persistence, built-in authentication and a TLS-only
  thin-client connector. The PKCS#12 key store goes at `/opt/om-tls/server.p12`, with its password
  in `OM_IGNITE_KEYSTORE_PASSWORD`.

Both configs register the **`om-cache-*` cache template** that every namespace cache matches:

- `groupName=om-cache` and `RendezvousAffinityFunction(partitions=64)`. **Required.** With one cache per
  namespace and Ignite's default 1024 partitions per cache, partition metadata exhausted a 128 MiB data
  region after a few dozen caches, and the node halted (`IgniteOutOfMemoryException`, observed during
  qualification). The shared cache group keeps per-cache overhead small.
- `CreatedExpiryPolicy` bounds the **physical** lifetime of every record (`OM_IGNITE_MAX_TTL_SECONDS`,
  default 86400). The thin client has no per-entry expiry API, so this is the only server-side bound.
- `ATOMIC`, `PARTITIONED`, `backups=0`, and `eagerTtl=true`.

The plain profile uses `RANDOM_2_LRU` page eviction in the default data region (`OM_IGNITE_REGION_MB`,
default 128). Capacity pressure evicts whole entries, which read as misses, instead of failing writes.

```bash
docker run -d -p 10800:10800 \
  -e JVM_OPTS="-Xms512m -Xmx512m -XX:MaxMetaspaceSize=256m" \
  -e CONFIG_URI=/opt/om/ignite-config.xml \
  -v "$PWD/node_modules/@open-mercato/cache-provider-ignite/docker:/opt/om:ro" \
  apacheignite/ignite:2.17.0-arm64        # use apacheignite/ignite:2.17.0 on amd64
```

**Authenticated profile:** Ignite 2.x built-in authentication requires native persistence, so the
cluster starts `INACTIVE`. Activate it once, then create a dedicated user. The default superuser is
`ignite`/`ignite`; change its password.

```bash
./bin/control.sh --set-state ACTIVE --yes --user ignite --password '<superuser password>' \
  --host 127.0.0.1 --port 10800 \
  --keystore /opt/om-tls/server.p12 --keystore-type PKCS12 --keystore-password '<ks password>' \
  --truststore /tmp/trust.jks --truststore-password '<ts password>'
# then over SQL (any cache, schema PUBLIC):  CREATE USER "om_cache" WITH PASSWORD '<password>'
```

The persistent profile's data survives restarts until the template TTL or a namespace change.

## How it works

- **Namespace fencing:** one Ignite cache per deployment namespace (`om-cache-<namespace>`). The thin
  client has no remote scan filter, so all enumeration is a `ScanQuery` over the namespace's own cache
  only. Foreign caches and other namespaces are never read or mutated. There is no global clear and no
  cache destroy.
- **Records:** every physical key (the host wrapper writes a value and a metadata record per logical
  entry) maps to one string record `{v, n, t, e, c, f, p}`. The fields are the layout version, a random
  nonce, tags, logical `expiresAt`, creation time, payload encoding (text or base64 for compressed
  codec output) and the payload.
- **Expiry:** logical. An expired record is a miss (it stays readable with `returnExpired`) until
  `cleanup()` reclaims it with a conditional delete. The server template TTL bounds physical lifetime.
- **Tag invalidation:** a bounded scan of the namespace cache. Each matching record is removed with
  `removeIfEquals(key, exactPriorValue)`. If the record changed in between, it is re-read and removed
  only if it still carries a requested tag (up to `casAttempts`). A concurrently retagged entry
  therefore survives. There is **no separate tag index**: index entries would be evictable and
  expirable independently of the values (page eviction, the template TTL) and could lose membership.
  The scan stays complete by construction.
- **Corrupt records** are misses, dropped on read and on cleanup.
- **Transport warnings:** `create` logs one warning when `tls.rejectUnauthorized` is `false` or when a password is configured without `tls` (credentials over plaintext). Both are accepted for local development only.
- **Connections:** connect and command deadlines. A deadline, lost connection or missing cache discards
  the session and rebuilds it on next use, so it recovers after a node restart and recreates the
  namespace cache. `healthcheck()` is a single `containsKey` (non-mutating). `close()` is idempotent.

## Supported matrix (qualified profiles only)

| Profile | Status | Evidence |
|---|---|---|
| Ignite 2.17.0, single node, in-memory, no auth, plaintext thin client | **Supported** | Conformance 16/16, engine 9/9, limits 2/2, packed install 4/4 |
| Ignite 2.17.0, single node, native persistence, built-in authentication, TLS thin-client connector (server cert; no client cert) | **Supported** | Conformance 16/16 + 3 negative cases (19/19) |

### Not verified (not supported until qualified)

- Multi-node clusters, `backups > 0`, `REPLICATED` caches, rebalancing and node failover across
  endpoints. Multiple endpoints are accepted, but failover is untested.
- Mutual TLS (client certificates via `tls.cert`/`tls.key`). The setting is accepted but unexercised.
- Ignite versions other than 2.17.0, and the amd64 image (`apacheignite/ignite:2.17.0`).
- `createCache: false` with operator-created caches.
- Long-running stability and memory behaviour beyond the qualification runs.

## Limitations and operating envelope

- **Invalidation cost is O(namespace size):** `deleteByTags`, `clear`, `keys`, `stats` and `cleanup`
  scan every record in the namespace cache and transfer values over the wire. The measurements below
  are in the qualification table. Keep namespaces in the tens of thousands of logical entries, or raise
  `scanTimeoutMs` knowingly.
- A scan is weakly consistent. Entries written concurrently with an invalidation may be observed either
  before or after it. That is linearizable with the invalidation. Unmodified entries are always seen.
- Capacity eviction drops whole records, value or metadata independently. A missing record is a miss.
  An orphaned value record is still removed by tag invalidation and `clear`.
- Old namespace caches are **not destroyed** when you change `CACHE_PROVIDER_NAMESPACE`. Drop
  `om-cache-<old namespace>` manually after a safe cutover. The template TTL drains its records anyway.
- Each namespace cache costs partition metadata in the data region. The cache group and 64 partitions
  keep this small, but do not create namespaces dynamically.
- Under host contention, one run during qualification (a sibling engine container running on the same
  8 GB Docker VM) showed a 30 s command timeout and a 560 s namespace scan. This was not reproduced on a
  quiet host, and the root cause was not isolated. `scanTimeoutMs` now bounds any single scan.

## Supply-chain notes

`apache-ignite-client@1.0.0` is the only published version (released 2018, metadata last modified
2022, Apache-2.0, maintained under `apache/ignite` `modules/platforms/nodejs`). It declares its own
dependencies as **`long: "latest"`** and **`decimal.js: "latest"`**, so every fresh npm install resolves
whatever those tags point to at install time. At qualification time that was `long@5.3.2` and
`decimal.js@10.6.0`, and those are locked in this monorepo's `yarn.lock`. A library cannot pin its
transitive dependencies for consumers. **Pin them in your app** and requalify when you change them:

```jsonc
// package.json (npm)
"overrides": { "long": "5.3.2", "decimal.js": "10.6.0" }
// package.json (yarn)
"resolutions": { "long": "5.3.2", "decimal.js": "10.6.0" }
```

The package depends on that client, plus `zod` for the settings schema.

The package pins `apache-ignite-client` to exactly `1.0.0` because it relies on a **private field** of that client: `src/connection.ts` reaches `client._socket._socket._socket` to destroy the TCP/TLS socket when a deadline expires, since `disconnect()` alone does not abort a stalled socket. That access is wrapped (optional chaining inside a `try`), so a changed client shape loses only the forced close, not correctness. Re-check that path and requalify (`test:containers`, especially the paused-node tests) before changing the client version.

## Qualification evidence

Manual runs on a developer machine, not CI. No CI job runs the container suites yet (see `packages/cache-redis-protocol/README.md` → *Proposed CI job*). Command: `yarn workspace @open-mercato/cache-provider-ignite test:containers` (or `yarn test:cache-providers:containers` from the repo root).

Date: 2026-11-24 · Host: macOS arm64, Docker Desktop (8 GB VM) · Node.js 26.12.1 · Testcontainers 12 ·
images pinned: `apacheignite/ignite:2.17.0-arm64`, reference `redis:7.4-alpine`.

| Suite (`src/__tests__/…`) | Image@tag | Topology | Auth / TLS | Result |
|---|---|---|---|---|
| `ignite.conformance.container.test.ts`: shared v1 conformance kit incl. independent process + corrupt value | `apacheignite/ignite:2.17.0-arm64` | 1 node, in-memory | none / none | 16/16 pass (repeated 4×) |
| `ignite.secure.container.test.ts`: same kit + wrong password, untrusted CA, plaintext client | `apacheignite/ignite:2.17.0-arm64` | 1 node, native persistence | built-in auth (SQL-created user) / TLS 1.2+ with throwaway CA | 19/19 pass |
| `ignite.engine.container.test.ts`: two-process retag race, two-process tag churn, foreign-cache fencing, non-mutating healthcheck, oversize values (previous copy dropped), paused node → command timeout → recovery, paused node → scan budget, restart → reconnect + cache recreated | `apacheignite/ignite:2.17.0-arm64` | 1 node | none / none | 9/9 pass |
| `ignite.limits.container.test.ts`: 3 s `CreatedExpiryPolicy` template reclaims un-TTL'd entries; 656 × 200 KiB into a 64 MiB region (336 survived) with no write failure | `apacheignite/ignite:2.17.0-arm64` | 1 node, 64 MiB region | none / none | 2/2 pass |
| `ignite.packed.container.test.ts`: `npm pack` → install tarball into a fresh app outside the workspace (no sibling adapters) → registration + `resolveCacheProvider` → workflow on Ignite; consumer type-check | `apacheignite/ignite:2.17.0-arm64` | 1 node | none / none | 4/4 pass |
| Unit (Docker-free, default `yarn test`): settings schema, redaction, transport warnings, key/record layout, CAS retry semantics on a fake transport, oversize overwrite drops the previous copy | none | none | none | 41/41 pass |

Latest full run (2026-11-24, after the oversize and transport-warning changes): `test:containers` 50/50 in 33.6 s plus unit 41/41. An earlier full sequential run of all seven suites passed 89/89 in 42.8 s. Two earlier full runs that day
failed: one with 20 failures, one with 2, all connect errors or timeouts. Both ran while another
engine's container was using about 230% CPU on the same 8 GB Docker VM. Every suite passed when rerun
on a quieter host. Treat the container suites as sensitive to Docker host contention.

Run them:

```bash
yarn workspace @open-mercato/cache-provider-ignite test                    # unit, no Docker
yarn workspace @open-mercato/cache-provider-ignite test:containers         # all container suites (sequential)
yarn workspace @open-mercato/cache-provider-ignite qualify                 # performance (below)
```

In the packed test, `@open-mercato/cache` is supplied as a bundle of this monorepo's sources, because
the v1 provider host is not yet published.

### Performance (`scripts/qualify.mjs`)

Workload: 2 independent client processes on one tenant, each doing 2000 × (`set` with 2 tags + `get`),
plus `deleteByTags` of a random tag group every 20 iterations. 500 keys, 50 tag groups, ~280 B values.
Run on a fresh node with a 256 MiB region. Stock Redis strategy is the reference.

| Engine | set p50 / p95 / p99 | get p50 / p95 / p99 | deleteByTags p50 / p95 / p99 | errors |
|---|---|---|---|---|
| Ignite 2.17.0 (this provider), worker 0 | 0.72 / 1.21 / 1.80 ms | 0.34 / 0.54 / 0.74 ms | 2.03 / 4.83 / 10.29 ms | 0 |
| Ignite 2.17.0 (this provider), worker 1 | 0.69 / 1.14 / 1.84 ms | 0.33 / 0.54 / 0.73 ms | 1.89 / 3.88 / 15.72 ms | 0 |
| Redis 7.4 (stock strategy), worker 0 | 0.42 / 0.83 / 1.68 ms | 0.19 / 0.38 / 0.72 ms | 1.07 / 2.07 / 2.51 ms | 0 |
| Redis 7.4 (stock strategy), worker 1 | 0.43 / 0.83 / 1.69 ms | 0.19 / 0.37 / 0.76 ms | 1.03 / 1.86 / 2.39 ms | 0 |

Scan envelope: the cost of one tag invalidation that matches nothing, which is a full namespace scan.

| Logical entries (physical records) | no-match `deleteByTags` p50 / max | invalidate all |
|---|---|---|
| 1,000 (2,000) | 9 / 13 ms | 85 ms |
| 10,000 (20,000) | 88 / 97 ms | 624 ms |
| 50,000 (100,000) | 400 / 497 ms | 3.5 s |

Command counts are derived, not instrumented. `set` = 1 `put` per physical record, and the wrapper
writes 2 per logical entry. `get`/`has` = 1 `get`. `delete` = 1 `removeKey`. A scan = 1 `query` +
⌈records / `scanPageSize`⌉ page fetches. Each removal = 1 `removeIfEquals`, plus 1 `get` per lost CAS
race.
