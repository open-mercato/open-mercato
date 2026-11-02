# Cache Value Compression with zstd

## 📝 TLDR

Operators running `@open-mercato/cache` on Redis or SQLite store every value as plain JSON text, so large entries (CRUD list pages, entity definitions, dashboard payloads) cost their full size in Redis memory and app↔Redis network transfer. This proposal (future behavior) adds opt-in compression: when `CACHE_COMPRESSION=zstd` (fastest) or `CACHE_COMPRESSION=gzip` (stable Node API), serialized values of at least `CACHE_COMPRESSION_MIN_BYTES` (default 1024) are compressed with Node's built-in `node:zlib` (no new dependency), and existing uncompressed entries keep being read. Measured on `develop` (Phase 0), a 100-record CRUD list page of 95 KB compresses to about 6 KB in about 0.1 ms, and the whole cache shrinks about 10×.

## 📝 Overview

Opt-in, threshold-based zstd compression inside the two serializing cache strategies (Redis, SQLite), with in-band format detection so compressed and plain entries coexist. No public contract changes; one internal codec module plus two env vars.

## 📝 Problem Statement

- The Redis strategy (`packages/cache/src/strategies/redis.ts`, `set`) stores `JSON.stringify({ key, value, tags, expiresAt, createdAt })` as a UTF-8 string per key. The SQLite strategy (`strategies/sqlite.ts`, `set`) stores `JSON.stringify(value)` in a `TEXT` column, with tags and expiry in their own columns.
- About 20 modules use the cache (entities, customers, auth, directory, configs, perspectives, dashboards, sales, search, webhooks, agent orchestrator, …), plus the opt-in CRUD list cache (`ENABLE_CRUD_API_CACHE`), whose entries are whole list responses.
- Cached payloads are repetitive JSON (repeated keys, ids, enum values) and compress 4–40×. Redis memory is the usual cost driver in multi-tenant deployments, and larger values mean more bytes on every app↔Redis round trip.
- Redis has no transparent value compression, so compression has to happen in the client.
- Phase 0 measured real entries on `develop` (see **Phase 0 results**): CRUD list pages of 25/50/100 records are 24/47/95 KB of JSON each and compress 11–16×; across all entries ≥ 1 KB the cache shrinks about 10×. In Redis with 500 active users, memory falls from 650 MB to 82 MB, and over a ~1 Gbps link read p95 falls from 15.3 ms to 5.7 ms.

## 📝 Prior Art

| Framework | Mechanism | Default | Takeaway for this spec |
|---|---|---|---|
| Rails `ActiveSupport::Cache` | `compress` + `compress_threshold`, Zlib, pluggable `compressor` | **On**, threshold `1.kilobyte`; keeps the compressed form only if smaller than the original | Adopt the 1 KB threshold and the "keep only if smaller" rule |
| Symfony Cache | `DeflateMarshaller` wrapping the serializer | **Off**, because it "might break cache pools that are shared between different applications" | Supports opt-in by default; a format change needs explicit operator choice |
| django-valkey | Compressors incl. zstd; `CACHE_COMPRESS_MIN_LENGTH` (default 15), `CACHE_COMPRESS_LEVEL` | Off | A level knob exists elsewhere, but is rarely needed; a threshold is the essential knob |
| Laravel + phpredis | `Redis::COMPRESSION_ZSTD` / `LZ4` at the client level | Off | Changing the format required flushing Redis for some users (laravel/framework#54221); this spec avoids that with in-band detection |

## 📝 Proposed Solution

A small codec, `packages/cache/src/codec.ts`, shared by the Redis and SQLite strategies:

- `encodeCacheText(json: string, config): string | Buffer`
  - Returns `json` unchanged when compression is off or `Buffer.byteLength(json) < minBytes`.
  - Otherwise compresses with the configured codec: `zstd` at level 1 (`ZSTD_c_compressionLevel: 1`), or `gzip` at zlib's default level 6. The compressed form is kept only if it is smaller than the input (Rails rule); otherwise `json` is returned.
  - Level choice comes from Phase 0: on real entries zstd level 1 gives practically the same size as level 3 (11.0× vs 11.1×) at twice the compression speed (971 vs 498 MB/s). gzip-6 is the best gzip size/speed point (10.6×, 237 MB/s).
- `decodeCacheText(raw: string | Buffer): string`
  - A `Buffer` that starts with the zstd frame magic `28 B5 2F FD` is decompressed with zstd, and one that starts with the gzip magic `1F 8B` with gunzip. Anything else is read as UTF-8 JSON. Detection never depends on the current `CACHE_COMPRESSION` value, so switching between `zstd`, `gzip` and `off` keeps every stored entry readable.
  - Neither magic can collide with a legacy entry. `0x28` is ASCII `(` and `0x1F` is a control character, and `JSON.stringify` output never starts with either (it starts with `{`, `[`, `"`, a digit, `-`, `t`, `f` or `n`). No extra marker, no column and no migration are needed. Entries written before the change, or with compression off, are read exactly as today.
  - Decompression output is bounded by a fixed cap (`MAX_DECOMPRESSED_BYTES`, 64 MiB, passed as `maxOutputLength`) so a corrupt or hostile frame cannot exhaust memory; failure is treated like today's unparseable JSON. The encode side never compresses JSON larger than the same cap (it is stored uncompressed), so a legitimate entry can never exceed the decode limit and get deleted on every read.
- Reads always run `decodeCacheText`, even when `CACHE_COMPRESSION` is off. Turning compression off therefore never strands compressed entries; they are read until they expire.

Strategy changes:

- **Redis.** Read with `getBuffer` instead of `get` in every place that parses an entry (`get`, the old-tag cleanup in `set`, `has`, `deleteKey`, `stats`, `cleanup`). Write the `Buffer` when compressed and the string otherwise. The whole entry is compressed, since tags and expiry live inside it.
- **SQLite.** Bind a `Buffer` when compressed. SQLite stores it as a BLOB even in the `TEXT`-affinity `value` column. `get` reads through `decodeCacheText`. Tags and `expires_at` are untouched.
- **memory** and **jsonfile** are unchanged. Memory holds live objects, and jsonfile is a human-readable dev file.

Configuration, resolved in `service.ts` next to `CACHE_TTL` and passed to the two strategy factories:

| Env | Values | Default |
|---|---|---|
| `CACHE_COMPRESSION` | `off` \| `zstd` \| `gzip` | `off` |
| `CACHE_COMPRESSION_MIN_BYTES` | positive integer | `1024` |

An unknown `CACHE_COMPRESSION` value is treated as `off` and logged once as a warning. `CacheServiceOptions` gains matching optional `compression` / `compressionMinBytes` fields. This change is additive.

Alternatives considered:
- **gzip only.** On real payloads gzip-6 is nearly as small as zstd (10.6× vs 11.0×) but compresses about 4× slower than zstd level 1. It is kept as a second option because its Node API is stable while zstd's is experimental, not as the default recommendation.
- **brotli.** Quality 4 is slightly smaller (11.6×) but compresses about 4× slower than zstd level 1; higher qualities are far slower. Not offered, to keep the surface small.
- **Per-call opt-in (`set(..., { compress: true })`).** This puts the decision on about 20 call sites. A threshold inside the strategy is automatic and leaves `CacheStrategy` unchanged.
- **On by default (the Rails choice).** Rejected for now: the format changes for every shared Redis pool, and older app versions would read compressed entries as misses (Symfony's reason). It can be revisited once real-world data exists.
- **Exposing the compression level.** Rejected. Phase 0 shows the level barely moves the size of real entries (zstd 1 vs 3: 124 KB vs 123 KB), and high levels cost about 150× the CPU for about 9% smaller output (synthetic benchmark).

### Synthetic benchmark (Node 24.13, 249 KB JSON list of 3000 records; overstates zstd vs gzip, see Phase 0 for real payloads)

| Codec | Output | Time |
|---|---|---|
| gzip level 6 | 25,055 B | 1.2 ms |
| brotli quality 4 | 7,507 B | 2.0 ms |
| brotli quality 11 | 9,863 B | 199 ms |
| **zstd level 3** | **6,534 B** | **1.3 ms** |
| zstd level 19 | 5,968 B | 202 ms |

## 📝 Architecture

All changes stay inside `packages/cache`: one new internal module (`codec.ts`), two strategies and the service's option resolution. No module, DI token, event or `CacheStrategy` method changes. The tenant-aware wrapper and the dependency fallback in `service.ts` are unaffected, because they work on decoded values.

## 📝 Data Model

No schema change. Redis values become either UTF-8 JSON (as today) or a zstd frame. SQLite `cache_entries.value` holds either TEXT (as today) or a BLOB. No migration is needed, since the cache is disposable and both formats are read.

## 📝 API Contracts

No HTTP or `CacheStrategy` contract changes. Additive only:
- Env vars `CACHE_COMPRESSION` and `CACHE_COMPRESSION_MIN_BYTES`, documented in `apps/mercato/.env.example` and the create-app template (via `yarn template:sync:fix`).
- Optional `CacheServiceOptions.compression` and `compressionMinBytes`.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Entry written before enabling compression | Read as JSON, as today; rewritten compressed on the next `set` |
| Compression switched off with compressed entries present | Still decoded (reads always detect); the entries age out by TTL |
| Older app version (rollback) reads a compressed entry | Its `JSON.parse` fails. Redis `get` and `deleteKey` already delete unparseable entries, and SQLite `get` does too, so this degrades to a cache miss and re-population. No manual flush is needed. |
| Older version's `cleanup()` runs while compressed entries exist | It deletes every compressed entry it scans (`redis.ts` `cleanup` treats unparseable as invalid). This costs only misses; see the rollout rule. |
| Older version's `set()` overwrites a compressed entry | It cannot parse the previous entry, so it skips removing the old tag memberships. The key stays indexed under tags it no longer carries until that tag is invalidated, which then drops it one extra time (an extra miss, never stale data). The existing orphan reaper in `deleteByTags` cleans up members whose key is gone. |
| Mixed old/new versions during a rolling deploy with compression on | Instances keep deleting and rewriting each other's entries for the whole window, so the hit rate drops while it lasts. Avoided by the rollout rule. |
| Corrupt or truncated zstd frame | Decode throws, and the entry is handled like invalid JSON today (deleted, returned as a miss) |
| Value below the threshold, or compression does not shrink it | Stored uncompressed |
| Very large value | One synchronous compress per write (~1.3 ms per 250 KB), the same order as the `JSON.stringify` already paid. Decompression output is capped. |
| Mixed `CACHE_COMPRESSION` settings across instances sharing one Redis | Safe: every instance can read both formats |

### Rollout rule (documented in `packages/cache/AGENTS.md` and `.env.example`)

1. Deploy the version containing this change with `CACHE_COMPRESSION` unset (`off`). Every instance can now read both formats.
2. Enable `CACHE_COMPRESSION=zstd` (or `gzip`) only once every instance runs that version.
3. Before rolling back to an older version, set `CACHE_COMPRESSION=off` first. Compressed entries left over only cause misses.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| zstd APIs in `node:zlib` are marked **Stability: 1 – Experimental** in the Node 24 docs (added v23.8.0 / v22.15.0). An API change in a future Node release could break the codec. | Medium | Opt-in only. `CACHE_COMPRESSION=gzip` gives operators a stable-API alternative at about 95% of the size benefit. The codec is isolated in one file with unit tests that would catch a signature change. A feature check (`typeof zlib.zstdCompressSync === 'function'`) makes `zstd` fall back to `gzip` with a single warning when zstd is unavailable. | Low. Node 22 LTS and 24 ship it, and no runtime warning is emitted on 24.13. |
| CPU overhead on hot write paths | Low | Threshold of 1 KB, zstd level 1, compressed form kept only if smaller | Measured in Phase 0 and Phase 1 tests |
| Compression before storing sensitive values (compression-oracle attacks such as CRIME/BREACH) | Low | Entry sizes are not observable by request senders, and the package rule "never cache sensitive data without encryption" is unchanged | None identified |
| `ioredis` binary round trip (`getBuffer`, `Buffer` writes in pipelines) | Low | The connection uses RESP2 (`REDIS_WIRE_PROTOCOL` is the constant `2` in `packages/shared/src/lib/redis/connection.ts`); a Redis test gated on `CACHE_REDIS_URL` covers the binary round trip | — |
| Operators inspecting Redis with `redis-cli` see binary values | Low | Documented, and the threshold keeps small entries readable | — |

## 📊 Phase 0 results (2026-10-15, `develop` @ `3346415f9`)

Setup: ephemeral integration app (`yarn test:integration:ephemeral:start`: SQLite cache, `ENABLE_CRUD_API_CACHE=true`, `NODE_ENV=production`), Node 24.13.1, Apple Silicon. Sizes are the serialized JSON values as stored today; Redis stores the same value wrapped in a small entry envelope. Measurement scripts were scratch-only.

**Run A — after the CRM, sales and catalog integration suites** (728 tests; small, self-cleaning fixtures):

| Key group | Entries | Typical size | zstd-3 ratio |
|---|---|---|---|
| `nav:sidebar` | 2 | 104 KB | 6.9× |
| `notifications:list` | 1 | 47 KB | 12.6× |
| `customers:activity-types` | 1 | 17 KB | 17.7× |
| `crud:customers.company` / `.person` | 2 | 7–12 KB | 4.7–6.9× |
| `customers:dictionaries` | 12 | 1.8–3.5 KB | 3.7× |
| `entities:definitions` | 18 | 0.3–6.4 KB | 2.7× |
| `crud:sales.*` dictionaries | 13 | 1.9–4.3 KB | 3.6–4.3× |
| **All entries** | **440** (44 ≥ 1 KB) | p50 15 B, p95 2.3 KB | **300 KB → 67 KB (4.5×)** |

**Run B — plus synthetic data at production scale**: 500 people and 100 companies created through the API, list pages browsed at `pageSize` 25/50/100:

| Entry | Raw | zstd-3 | Ratio | Compress | Decompress |
|---|---|---|---|---|---|
| people, pageSize 100 | 95 KB | 6.0–6.7 KB | 14–16× | 0.08–0.12 ms | 0.05–0.08 ms |
| people, pageSize 50 | 47 KB | 3.4 KB | 13.7× | 0.06–0.11 ms | 0.03–0.05 ms |
| people, pageSize 25 | 24 KB | 2.1 KB | 11× | ~0.1 ms | ~0.05 ms |
| companies, pageSize 50 / 25 | 49 / 25 KB | 3.2–3.4 / 1.8–2.1 KB | 12–15.5× | ≤0.16 ms | ≤0.06 ms |
| **All entries** | **1,379 KB** (63 entries ≥ 1 KB hold 1,360 KB) | **141 KB** | **9.8×** | 13.8 ms for all 919 rows | |

**Codec comparison on the 63 real entries ≥ 1 KB (1,360 KB):**

| Codec | Output | Ratio | Compress | Decompress |
|---|---|---|---|---|
| gzip level 6 | 128 KB | 10.6× | 237 MB/s | 1,279 MB/s |
| gzip level 1 | 146 KB | 9.3× | 448 MB/s | 1,234 MB/s |
| brotli quality 4 | 117 KB | 11.6× | 262 MB/s | 1,309 MB/s |
| **zstd level 3** | **123 KB** | **11.1×** | **498 MB/s** | **1,384 MB/s** |
| zstd level 1 | 124 KB | 11.0× | 971 MB/s | 1,922 MB/s |

**Run C — Redis at scale and over a constrained network.** The real entries from Run B were loaded into Redis 7.4.1 in the strategy's entry envelope. Per-user entries (keys carrying `user:`, the sidebar navigation, notification lists and perspectives: 114 entries) were replicated for N users, and shared entries (346) were stored once. A reader then issued random `GET` + decode + `JSON.parse` for 8–10 s from 64 concurrent workers over 8 connections (ioredis, RESP2). The constrained network used Toxiproxy 2.9.0 with 1 ms of added latency and a bandwidth cap on each connection.

| Scenario | Codec | Redis memory | Reads/s | p50 | p95 | p99 | Redis egress |
|---|---|---|---|---|---|---|---|
| 100 users, localhost | off | 131 MB | 37,562 | 1.61 ms | 3.02 ms | 3.98 ms | 387 MB/s |
| | zstd-1 | **17.6 MB** | 32,759 | 1.84 ms | 3.25 ms | 4.14 ms | 40 MB/s |
| | gzip-6 | 17.9 MB | 31,316 | 1.93 ms | 3.33 ms | 4.25 ms | 38 MB/s |
| 500 users, localhost | off | 650 MB | 37,613 | 1.61 ms | 3.12 ms | 4.03 ms | 395 MB/s |
| | zstd-1 | **81.8 MB** | 32,200 | 1.86 ms | 3.29 ms | 4.24 ms | 39 MB/s |
| | gzip-6 | 82.9 MB | 30,159 | 1.99 ms | 3.44 ms | 4.48 ms | 38 MB/s |
| 100 users, ~1 Gbps (8 × 125 Mbps) + 1 ms | off | 131 MB | 8,595 | 6.67 ms | 15.32 ms | 19.89 ms | 90 MB/s |
| | zstd-1 | 17.6 MB | **22,868** | **2.30 ms** | **5.69 ms** | **7.79 ms** | 28 MB/s |
| | gzip-6 | 17.9 MB | 22,839 | 2.35 ms | 5.67 ms | 7.57 ms | 28 MB/s |
| 100 users, ~100 Mbps (8 × 12.5 Mbps) + 1 ms | off | 131 MB | 1,129 | 48.0 ms | 136.4 ms | 189.7 ms | 12 MB/s |
| | zstd-1 | 17.6 MB | **8,011** | **7.24 ms** | **15.68 ms** | **21.13 ms** | 9.5 MB/s |
| | gzip-6 | 17.9 MB | 7,809 | 7.36 ms | 16.34 ms | 21.51 ms | 9.5 MB/s |

Writing all entries (pipelined) took 1.8 s uncompressed, 2.4 s with zstd-1 and 4.3 s with gzip-6 at 500 users.

Findings:
- Compression pays off: a small number of large entries (about 10–14% of keys) holds 85–99% of cache bytes, and they shrink about 10×. The 1 KB threshold leaves the many tiny entries (flags, versions, ids) untouched, and the share of entries ≥ 1 KB does not change the result.
- On real payloads zstd's size advantage over gzip is small (11.1× vs 10.6×). The synthetic benchmark above overstated it. zstd's real advantage is speed: level 3 compresses about 2× faster than gzip-6, and level 1 about 4× faster at practically the same size.
- Per-entry cost is well under a millisecond even for 100-record pages, which is negligible next to the database query the cache replaces.
- Redis memory drops 7.5–8× and scales linearly with active users: per-user entries (sidebar navigation about 104 KB, CRUD list pages 24–95 KB) dominate, so 500 active users take 650 MB uncompressed versus 82 MB compressed.
- Read latency depends on the network. On localhost, where there is no transfer cost, compression costs about 0.25 ms at p50 and about 13% of read throughput (decode CPU in a single client process). On a ~1 Gbps link, as with Redis on another host, reads get 2.7× faster at p95 and throughput rises 2.7×. On a ~100 Mbps link, p95 falls from 136 ms to 16 ms and throughput rises 7×. Egress from Redis falls about 10× in every case.
- zstd-1 and gzip-6 give the same memory and network results. zstd-1 writes about 1.8× faster, which matches the codec table.
- Side observation: while 10 people were being created in parallel, 2 of 500 `POST /api/customers/people` returned `500 DATABASE_ERROR`. This is unrelated to caching and worth a separate investigation.

## 📊 Phase 1 whole-app load test (2026-10-16, implementation branch)

Setup: the production build (`mercato server start`) with `CACHE_STRATEGY=redis` and `ENABLE_CRUD_API_CACHE=true`, Redis 7.4.1 behind Toxiproxy 2.9.0, a freshly initialized database plus 497 synthetic people and 100 companies. One process per codec; Redis flushed between codecs. Load: one admin session, 32 concurrent clients for 30 s per network profile, reading 18 people/company list pages (`pageSize` 25/50/100), all served from the CRUD cache. Network profiles apply bandwidth and +1 ms latency to Redis replies only.

| Codec | Redis memory after warm-up (562 keys) | Profile | req/s | p50 | p95 | p99 | Redis egress |
|---|---|---|---|---|---|---|---|
| off | 2.8 MB | localhost | 29 | 1,099 ms | 1,432 ms | 1,497 ms | 1.9 MB/s |
| | | ~1 Gbps + 1 ms | 32 | 1,008 ms | 1,232 ms | 1,316 ms | 2.0 MB/s |
| | | ~100 Mbps + 1 ms | 30 | 1,094 ms | 1,403 ms | 1,476 ms | 1.9 MB/s |
| zstd | 1.8 MB | localhost | 30 | 1,100 ms | 1,413 ms | 1,496 ms | 0.2 MB/s |
| | | ~1 Gbps + 1 ms | 31 | 1,073 ms | 1,274 ms | 1,329 ms | 0.3 MB/s |
| | | ~100 Mbps + 1 ms | 30 | 1,092 ms | 1,341 ms | 1,455 ms | 0.2 MB/s |
| gzip | 1.8 MB | localhost | 28 | 1,136 ms | 1,425 ms | 1,506 ms | 0.2 MB/s |
| | | ~1 Gbps + 1 ms | 31 | 1,044 ms | 1,322 ms | 1,399 ms | 0.3 MB/s |
| | | ~100 Mbps + 1 ms | 30 | 1,083 ms | 1,368 ms | 1,522 ms | 0.3 MB/s |

Findings:
- No error in any run, and every codec reads entries written by the others (checked by the strategy tests).
- End-to-end latency and throughput do not change measurably with compression: differences stay within run-to-run noise (about ±5%). In this single-host setup the application spends about 33 ms of CPU per request, so the request rate (about 30/s) is bound by the app, not by Redis.
- Redis egress falls 7–10× (about 1.9 MB/s to 0.2–0.3 MB/s), and Redis memory used by entries falls from about 1.8 MB to about 0.8 MB (each total includes about 1 MB of Redis baseline). With a single user this is small; Phase 0 shows how it scales with active users.
- At about 2 MB/s of cache traffic even the ~100 Mbps link is not saturated, so the latency gains measured at the Redis client in Phase 0 Run C only appear once cache traffic approaches the link's capacity (many app instances or many active users sharing a remote Redis).
- Side observation, reproduced on two fresh databases: creating people 10 at a time, 3–6 of 500 `POST /api/customers/people` return `500 DATABASE_ERROR`. It is unrelated to caching (it happens with the SQLite cache too) and is left for a separate issue.

## 📋 Phasing

- **Phase 0 — Evidence (no shipped code). ✅ Done 2026-10-15**, see **Phase 0 results**.
- **Phase 1 — Codec and strategies.** Codec, Redis and SQLite integration, env/options, tests, docs.

## 📋 Implementation Plan

### Phase 1
1. Add `codec.ts` (`encodeCacheText`, `decodeCacheText`, config resolution, feature check, output cap), with unit tests per codec (`zstd`, `gzip`) for round-trip, threshold, "keep only if smaller", legacy JSON, magic detection of both formats, reading gzip entries with `zstd` configured and vice versa, corrupt frames and the unavailable-zstd fallback to gzip.
2. Resolve `CACHE_COMPRESSION` / `CACHE_COMPRESSION_MIN_BYTES` and the new options in `service.ts`, and pass them to `createRedisStrategy` and `createSqliteStrategy`, with service-level tests.
3. Redis strategy: `getBuffer` plus the codec in `get`, `set`, `has`, `deleteKey`, `stats` and `cleanup`. Add `getBuffer` to the `RedisClient` shim and widen `RedisClient.set/setex` and `RedisPipeline.set/setex` values to `string | Buffer`. Update the test fake in `redis.strategy.test.ts` (today a `Map<string, string>` without `getBuffer`) to store raw `string | Buffer`, then cover mixed legacy and compressed entries plus tag cleanup.
4. SQLite strategy: Buffer bind plus codec in `get`; widen `EntryRow.value` to `string | Buffer`. Update the mock in `sqlite.strategy.test.ts` (today it stores `String(value)`, which would corrupt a Buffer) and add a test against a real `better-sqlite3` file covering mixed TEXT and BLOB rows.
5. Docs: `packages/cache/AGENTS.md` (a Compression section with when to enable it: Redis on another host or memory-bound Redis yes; Redis on localhost or SQLite brings memory and disk savings only, at a small read cost), `apps/mercato/.env.example` with commented vars, template sync, and the service JSDoc env list. Add a changelog entry to this spec.

Integration coverage: there is no HTTP or UI path change. Strategy-level tests against real SQLite, plus a Redis test gated on `CACHE_REDIS_URL`, cover the behavior. The existing integration suite runs unchanged as a regression check with compression off (the default).

## Final Compliance Report

| Check | Result |
|---|---|
| `BACKWARD_COMPATIBILITY.md` surfaces | No change to types, signatures, DI token `cache`, events, routes, DB schema or CLI. `CacheServiceOptions` and env vars are additive. Default behavior unchanged (compression off). |
| `packages/cache/AGENTS.md` | Uses the strategy pattern; no raw Redis/SQLite outside strategies; tag invalidation semantics unchanged; no new backend. |
| Dependencies | None added (`node:zlib`). |
| Sensitive data | No new storage of sensitive data; encryption rule unchanged. |
| Tests | Unit tests per step; real SQLite test; Redis test gated on `CACHE_REDIS_URL`; existing integration suite as regression with the default (off). |
| Docs | `packages/cache/AGENTS.md`, `apps/mercato/.env.example` + template sync, service JSDoc. |

## Changelog

- 2026-10-16: Phase 1 whole-app load test recorded: no measurable change in end-to-end latency, Redis egress down 7–10×, entry memory roughly halved for a single active user.
- 2026-10-16: Phase 1 implemented: `codec.ts`, `CACHE_COMPRESSION` / `CACHE_COMPRESSION_MIN_BYTES` resolved in `service.ts`, Redis (`getBuffer`) and SQLite (BLOB) strategies wired, unit tests per codec, a real `better-sqlite3` test with mixed TEXT/BLOB rows and a live Redis test gated on `CACHE_REDIS_URL`. Docs in `packages/cache/AGENTS.md` and `ENV.md`.
- 2026-10-15: Dropped the HTTP-compression and web-research zstd follow-ups: Phase 0 shows zstd's size gain over gzip is about 5%, too small to justify them.
- 2026-10-15: Phase 0 Run C: Redis memory and read latency at 100/500 users, on localhost and over ~1 Gbps / ~100 Mbps links.
- 2026-10-15: Codec decisions from Phase 0: zstd level 1 instead of 3 (same size, 2× faster); `CACHE_COMPRESSION=gzip` added as a stable-API alternative and as the fallback when zstd is unavailable.
- 2026-10-15: Phase 0 measurement recorded (real cache entries, codec comparison).
- 2026-10-15: Draft. Open Questions Q1–Q5 resolved as recommended: opt-in, Redis and SQLite only, fixed level 3 with a 1 KB threshold, Phase 0 measurement first, and older-version reads accepted as misses. Prior art and the Node zstd stability risk added. Adversarial review applied: rollout rule for mixed versions, decompression cap tied to the encode side, RESP2-only Redis note, corrected magic-byte argument, test-fake and shim-type updates, Overview and Final Compliance Report added.
