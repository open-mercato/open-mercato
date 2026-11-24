# @open-mercato/cache-provider-memcached

Open Mercato cache provider (`open-mercato/memcached`) for **one self-hosted Memcached server**. It plugs into the `@open-mercato/cache` v1 provider host: tenant scoping, tag invalidation, TTL, enumeration, stats, cleanup and readiness all keep working through the regular `cache` DI service.

Memcached has no tags, no key enumeration and no server-side sets, so this provider stores entries in **fixed CAS buckets**: a namespace owns `bucketCount` memcached items, each holding its own entries, tags and per-entry logical expiry. Every mutation reads a bucket and writes it back with compare-and-swap.

- Server-only and ESM, with types. The only runtime dependency is `zod`. `@open-mercato/cache` is a peer dependency.
- Uses its own small client over `node:net`, speaking the memcached text/meta protocol (`mg`/`ms`/`md`/`mn` plus `gets`/`cas`/`add`). It is exported as `@open-mercato/cache-provider-memcached/protocol` for reuse. The npm clients were not usable here: `memjs` has no `gets`/`cas`, and `memcached` has been unmaintained since 2016.

## Install

```bash
yarn add @open-mercato/cache-provider-memcached
```

Register it in the app's `mercato.cache.ts`, which lives next to `package.json`, not under `src/`:

```ts
import type { CacheProviderRegistration } from '@open-mercato/cache/provider'

export const cacheProviders: CacheProviderRegistration[] = [
  {
    id: 'open-mercato/memcached',
    load: () => import('@open-mercato/cache-provider-memcached').then((mod) => mod.provider),
    settings: () => ({
      host: process.env.MEMCACHED_HOST ?? '127.0.0.1',
      port: Number(process.env.MEMCACHED_PORT ?? 11211),
      bucketCount: 64,
    }),
  },
]
```

Then select it:

```bash
CACHE_PROVIDER=open-mercato/memcached
CACHE_PROVIDER_NAMESPACE=prod-eu-1   # stable per deployment; 1-64 chars [A-Za-z0-9._-]
```

Docker recipe (the qualified image):

```bash
docker run -d --name om-memcached -p 11211:11211 memcached:1.6.45-alpine memcached -m 256
```

## Settings

The schema is strict: unknown keys are rejected, including TLS, SASL and multi-server options. Those profiles are not qualified yet (see [Supported matrix](#supported-matrix)).

| Setting | Default | Bounds | Meaning |
|---|---|---|---|
| `host` | — (required) | hostname or IP | Memcached server |
| `port` | `11211` | 1–65535 | |
| `bucketCount` | `64` | 1–4096 | Fixed number of bucket items per namespace. Part of the key layout (see below). |
| `maxItemBytes` | `1048576` | 4 KiB–128 MiB | Upper bound for one encoded bucket. The lower of this and the server's `item_size_max` (`-I`) is used. |
| `casRetries` | `16` | 1–100 | Compare-and-swap attempts per bucket commit before failing with `cas_conflict` |
| `casBackoffMs` | `4` | 0–1000 | Base for randomized exponential backoff between CAS attempts |
| `poolSize` | `2` | 1–32 | Pipelined TCP connections |
| `connectTimeoutMs` | `2000` | 50–60000 | Connect deadline |
| `commandTimeoutMs` | `2000` | 50–60000 | Per-command deadline. A timeout resets the connection. |
| `maxCommandBytes` | `16384` | 256–16384 | Upper bound on the command text of one batched multi-get |
| `enumerationBatchSize` | `16` | 1–256 | Buckets fetched per enumeration round trip. This bounds memory during `keys`, `stats`, `deleteByTags`, `clear` and `cleanup`. |

`redact()` reports `host`, `port`, `transport`, `bucketCount`, `maxItemBytes`, `casRetries`, `poolSize` and the timeouts. There are no credentials in this profile.

## Data model

- **Bucket key:** `{namespace}:v1:b{bucketCount}:{index}`, where `index = sha256(routingKey)[0..4] mod bucketCount`. Including the bucket count in the key means a changed count starts an empty layout. It can never read entries routed by a different modulus. Still, treat a bucket-count change like a layout change and use a new namespace for it (see the spec's cutover rules).
- **Bucket item:** JSON `{"v":1,"e":{ "<physicalKey>": { p, b?, t, x, c } }}`:
  - `p`: payload, encoded by the host codec. Compressed frames are stored as base64 with `b: 1`.
  - `t`: scoped tags.
  - `x`: logical expiry in epoch ms.
  - `c`: creation time.

  The memcached item itself is stored without an expiry.
- **Coherent records:** the tenant wrapper writes a value record and a metadata record for each logical key. The provider routes both by the shared tenant and key hash, so they always land in the **same bucket**. Eviction, corruption and invalidation therefore never split them.
- **Writes:** mutations to one bucket within a process are coalesced (up to 64 per commit) and committed with these steps:
  1. `mg` (value + CAS).
  2. Apply the queued mutations, then reclaim entries whose logical expiry has passed.
  3. `ms … C<cas>`. A bucket that does not exist yet is created with `ms … ME` (atomic add). A bucket that becomes empty is removed with `md … C<cas>`.
  4. On `EX`, `NS` or `NF`, re-read the latest state and retry with jittered backoff, up to `casRetries`.
- **Concurrent retagging:** invalidation predicates (`deleteByTags`, `clear`, `cleanup`) are evaluated against the bucket state read inside the CAS loop. An entry that another process retagged in the meantime is therefore never deleted.
- **Enumeration** (`keys`, `stats`, `deleteByTags`, `clear`, `cleanup`) fetches every bucket key of the namespace with quiet `mg … k q` pipelines terminated by `mn`. Each batch holds at most `enumerationBatchSize` buckets and at most 16 KiB of command text.
- **A missing or evicted bucket** is a miss for all its entries. An undecodable bucket is treated as empty and overwritten on the next write. An undecodable entry is a miss and is removed with a conditional write.
- **Logical expiry:** expired entries remain readable with `returnExpired` until the next write to their bucket or `cleanup()` reclaims them.

## Errors

Errors never include endpoints, keys or values.

| Condition | Error |
|---|---|
| Server unreachable or connection lost | `CacheProviderError` `unavailable` |
| Command or connect deadline exceeded | `CacheProviderError` `timeout`. The outcome of an in-flight write is unknown. |
| Value too large for one item (after encoding) | `MemcachedCacheError` `item_too_large`. Existing entries are untouched. |
| Bucket still contended after `casRetries` | `MemcachedCacheError` `cas_conflict` |
| Server item limit smaller than the bucket envelope | `MemcachedCacheError` `incompatible_server` (from `healthcheck`) |
| Unexpected or malformed server reply | `MemcachedCacheError` `protocol_error`. The connection is reset. |
| Invalid settings | `CacheProviderError` `invalid_settings`, with field paths only |

## Supported matrix

| Profile | Status | Evidence |
|---|---|---|
| One self-hosted memcached 1.6 server, plain TCP, no auth | **Supported** | `memcached:1.6.45-alpine` (linux/arm64), see Evidence |
| Multiple servers (client-side routing) | Unverified, not offered | No settings for it. Needs identical routing across clients and per-server qualification. |
| SASL authentication | Unverified, not offered | Not implemented. The meta protocol over the text port has no SASL. |
| TLS (`-Z`, memcached built with TLS) | Unverified, not offered | `createTlsTransport` exists in `./protocol` for later profiles but is not reachable from settings or qualified |
| Memcached < 1.6 (no meta commands) | Not supported | The bucket layout needs `mg`/`ms`/`md` |

## Limitations and operating envelope

- **Capacity per namespace** is roughly `bucketCount × min(maxItemBytes, -I)`: 64 MiB with the defaults. When a bucket would exceed its item limit, the provider evicts that bucket's **oldest value+metadata pairs** to make room and logs a rate-limited warning (`capacityEvictions` in `diagnostics()`). A single value that cannot fit even in an empty bucket fails with `item_too_large`.
- **Memcached LRU eviction** drops whole buckets, so every entry routed to an evicted bucket becomes a miss at once. Under memory pressure, any bucket rewrite (including one done by `deleteByTags`) may cause the server to evict other buckets. Size `-m` well above the working set of `bucketCount × typical bucket size`.
- **Restarts and flushes** lose the whole cache. After a server restart the provider reconnects on the next command. The suite shows a whole-namespace miss followed by normal operation.
- **Write cost:** each logical `set` updates two physical records (value and metadata) in one bucket: two CAS round trips, each re-sending the bucket. Large buckets therefore make writes more expensive. Raise `bucketCount` for larger working sets.
- **Enumeration cost:** `deleteByTags`, `clear`, `keys`, `stats` and `cleanup` read the whole namespace (`bucketCount` items). Their latency grows with total namespace bytes, not with the number of matches. The host's `keys()` then reads one bucket per listed key.
- **Logical expiry** is reclaimed on bucket writes and by `cleanup()`. Schedule `cleanup()` if many entries expire without being rewritten.
- **Contention:** at most one commit per bucket is in flight per process. Cross-process conflicts are resolved by CAS retries. With 1 bucket and 2 processes × 16 concurrent writers, the suite had conflicts but no retries were exhausted.

## Evidence

Recorded 2026-11-24 on Docker 29.9.2 (linux/arm64, macOS host, 8 GB VM), Node v26.12.1, Testcontainers 12.1.0.

| Suite | Image@tag | Topology / server flags | Auth/TLS | Result |
|---|---|---|---|---|
| Shared conformance kit, 64 buckets (default): 16 tests incl. independent process, corrupt value, `returnExpired`, 601-entry batch boundary | `memcached:1.6.45-alpine` | 1 server, `-m 64` | none | 16/16 pass |
| Shared conformance kit, 1 bucket (maximum contention) | `memcached:1.6.45-alpine` | 1 server, `-m 64` | none | 16/16 pass |
| Engine: logical TTL + reclaim + cleanup counts, CAS contention from 2 processes on 1 bucket (600 writes, conflicts > 0, 0 lost, 0 exhausted), concurrent retag vs invalidation across 2 processes, unreachable server | `memcached:1.6.45-alpine` | 1 server, `-m 64` | none | 4/4 pass |
| Engine: oversize writes (`item_too_large`, existing entries intact), server-side oversize rejection keeps the connection, bucket capacity eviction | `memcached:1.6.45-alpine` | 1 server, `-m 64 -I 128k -o slab_chunk_max=64` | none | 3/3 pass |
| Engine: coherent whole-bucket eviction (6000 × 2 KiB entries, 1024 buckets; server `evictions > 0`; every listed key readable and vice versa; tag invalidation afterwards) | `memcached:1.6.45-alpine` | 1 server, `-m 8 -I 128k -o slab_chunk_max=64` | none | 1/1 pass |
| Engine: server restart (whole-namespace miss, reconnect, recovery on next writes) | `memcached:1.6.45-alpine` | 1 server, `-m 32`, fixed host port, `docker restart` | none | 1/1 pass |
| Packed install: `npm pack` of this package and of `@open-mercato/cache` into a fresh app (npm install, no sibling adapters), consumer type-check, registration → `resolveCacheProvider` → cache workflow | `memcached:1.6.45-alpine` | 1 server, `-m 32` | none | 3/3 pass |
| Unit (no Docker): settings schema, redaction, key layout and routing, protocol parser and batching | — | — | — | 21/21 pass |

Full run: **65/65 tests passed**: `OM_CACHE_PROVIDER_CONTAINER_TESTS=1 jest --runInBand` (container suite about 15 s). The container suite has passed four consecutive runs since its last change.

### Performance qualification

Produced by `node scripts/qualify.mjs`:

- **Setup:** two independent client processes run concurrently, each doing 4000 operations at concurrency 8. The mix is 70% `get`, 25% `set` (2 tags from a pool of 50) and 5% `deleteByTags` (1 random tag), over 2000 keys with a 512 B payload, in one tenant. Server: `memcached:1.6.45-alpine -m 256`. Reference: `redis:7.4.2-alpine` running the stock strategy.
- **How to read it:** latencies are in ms. Each percentile is the worse of the two clients.

| Profile | Errors | Throughput (ops/s, both clients) | get p50 / p95 | set p50 / p95 | deleteByTags p50 / p95 | CAS conflicts (exhausted) | memcached commands / op |
|---|---|---|---|---|---|---|---|
| memcached, 64 buckets (default) | 0 | 16 234 | 0.40 / 0.71 | 1.70 / 4.43 | 3.23 / 7.16 | 209 (0) | 2.35 |
| memcached, 256 buckets | 0 | 14 011 | 0.41 / 0.65 | 1.65 / 2.38 | 8.05 / 10.47 | 56 (0) | 2.97 |
| memcached, 16 buckets | 0 | 11 733 | 0.44 / 0.86 | 2.25 / 9.78 | 3.20 / 15.58 | 598 (0) | 2.21 |
| stock redis strategy (reference) | 0 | 33 154 | 0.30 / 0.52 | 0.72 / 1.22 | 1.07 / 1.81 | — | — |

Command mix for the 64-bucket profile across both clients: `mg` 13 144, `ms` 5 345, `md` 329.

The trade-off: more buckets mean cheaper writes and fewer conflicts, but more expensive namespace enumeration (`deleteByTags`). Fewer buckets mean the opposite. Redis stays roughly 2–3× faster because it updates tag indexes server-side. This is local-loopback data, so re-run it on your own network before relying on it.

## Development

```bash
yarn workspace @open-mercato/cache-provider-memcached test            # unit tests, no Docker
yarn workspace @open-mercato/cache-provider-memcached test:container  # real memcached via Testcontainers
yarn workspace @open-mercato/cache-provider-memcached qualify         # performance qualification (Docker)
yarn workspace @open-mercato/cache-provider-memcached build
```
