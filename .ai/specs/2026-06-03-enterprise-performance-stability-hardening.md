# Enterprise Performance & Stability Hardening — Research & Roadmap

**Status:** research / roadmap — never previously merged; recovered from snapshot history 2026-08-29 via PR #5777; issue cohort #2958–#2983 filed (see Recovery addendum)
**Owner:** core / shared / platform
**Date:** 2026-06-03
**Related:** [`2026-05-24-crud-api-performance-quick-wins.md`](2026-05-24-crud-api-performance-quick-wins.md), [`implemented/2026-05-07-lazy-auto-spawn-queue-workers.md`](implemented/2026-05-07-lazy-auto-spawn-queue-workers.md), [`2026-05-27-dev-mode-memory-quick-wins.md`](2026-05-27-dev-mode-memory-quick-wins.md)

> **How to read this document (2026-08-29).** This is the recovered June 2026 research roadmap, kept for program context and for the section anchors the #2958–#2983 issue cohort cites. It is **not** an implementation specification: per-item current status lives in the Recovery addendum's status table, `> [2026-08 status]` notes below mark findings that have since shipped or prescriptions that are superseded, and architectural units (P2.1, P2.2, P3.1–P3.4) each require a focused spec — with migration/BC analysis, rollback, and acceptance criteria — before implementation. The per-item tracker issues carry the actionable guidance.

## TLDR

A read-only audit of the whole monorepo (8 parallel domain audits + existing perf specs) for an **enterprise deployment serving thousands of concurrent users across many tenants on multiple horizontally-scaled instances**.

**Headline:** the platform has the *right primitives* (singleton ORM pool, tag-invalidated cache, queue abstraction, RBAC cache layer, cross-process event bridge, SSRF-safe webhooks, async bcrypt, fail-closed tenant scoping). The enterprise gap is **not** missing architecture — it's that the system **ships single-instance defaults**, and a single config-time bug **silently disables its own caches**. Most of the highest-impact wins are therefore *config/default* fixes and small guardrails, not rewrites.

**The one finding that matters most:** in the default configuration the RBAC cache, org-scope cache, and CF-def cache are **dead** — every authenticated request re-runs full ACL resolution + scope + CF-def SQL. Three independent agents (caching, HTTP-lifecycle, tenancy/RBAC) found this from different directions. Root cause: `packages/core/src/bootstrap.ts` constructs the cache with **no `globalThis` singleton guard** (the rate limiter has one; the cache does not), and `OM_BOOTSTRAP_CACHE` defaults **off**, so `createRequestContainer()` rebuilds an empty in-memory cache **per request**.

> **[2026-08 status]** Fixed — `bootstrap()` now has a default-on `globalThis` cache singleton (#2961) and the memory cache is LRU-bounded (#2962). The org-scope cache remains opt-in (`OM_ORG_SCOPE_CACHE_TTL_MS`, default 0) and `OM_BOOTSTRAP_CACHE` remains off pending #2963. See the Recovery addendum's status table before acting on anything in this document.

## Method

Eight independent read-only audits, one per performance/stability domain, each hunting enterprise-scale anti-patterns (unbounded queries, N+1, per-request expensive setup, cache gaps, connection exhaustion, real-time fan-out, external-I/O without timeouts, event-loop blocking, unbounded memory, horizontal-scale hazards, missing per-tenant fairness). Findings below cite real `file:line` evidence. Severities are the auditors' calls, harmonized.

## Workload model & goals (assumptions for this analysis)

Since this was run autonomously, these are the assumptions used to rank severity. Correct any that are wrong and the priorities shift.

- **Scale:** low-thousands of concurrent authenticated users (staff + portal customers), hundreds–thousands of tenants, one shared Postgres (+ pgvector), Redis available, Meilisearch optional.
- **Topology:** N stateless Node app instances behind a load balancer; ideally a separate worker fleet. **This is the critical assumption** — most CRITICAL findings are "correct on 1 instance, silently wrong on N."
- **Profile:** read-heavy CRUD with write bursts (imports/bulk ops), some SSE real-time, AI assistant + search as expensive opt-in features.
- **Goals:** (1) stability — no OOM, no cascading failure when one dependency slows; (2) latency — CRUD p50 < 100 ms warm (the existing spec's target); (3) horizontal-scale **correctness** — no cross-instance cache/permission staleness, no job double-processing; (4) per-tenant fairness — no noisy neighbor; (5) graceful degradation when Redis/search/LLM is slow.

## The big picture — convergent root causes

Five cross-cutting themes, each independently surfaced by multiple audits:

### Theme A — The system disables its own caches by default
`bootstrap()` has no process-level singleton guard for the cache, and `OM_BOOTSTRAP_CACHE` is off by default, so the memory cache is reallocated per request and the cache service is also rebuilt 2–3× per request (see Theme D). RBAC (`rbacService.ts:250`), org-scope (`organizationScope.ts:414`), and CF-def (`custom-field-definition-index.ts:359`) all miss every time. The 5-minute TTLs the code carefully implements never take effect. **Found by: caching, HTTP, tenancy.**

### Theme B — Single-instance defaults are silently wrong behind a load balancer
`CACHE_STRATEGY=memory`, `RATE_LIMIT_STRATEGY=memory`, `QUEUE_STRATEGY=local`, and the event bus's in-process + Postgres `LISTEN/NOTIFY` transport are all process-local. On N instances:
- **Cache:** invalidation only clears the local pod → stale RBAC/permissions on other pods until TTL → **privilege-revocation lag (security)**, not just perf.
- **Rate limit:** each pod counts independently → effective limit is N× → brute-force/flood protection collapses.
- **Queue (local):** **no job leasing → every job double-processed** by each pod's auto-spawned worker (CRITICAL — duplicate emails/notifications/indexing).
- **Events:** broadcasts ride PG `NOTIFY` (global, un-sharded) on the request hot path; and persistent events handled in a worker process never reach SSE clients.

**Found by: caching, queue, events, HTTP, tenancy.**

### Theme C — Heavy work runs synchronously on the request / write path
- Query-index upsert + search-token rewrite + coverage adjustments run **inline inside every CRUD mutation** (`bus.ts:173` awaits ephemeral handlers; `query_index/subscribers/upsert_one.ts` is `persistent:false`), and with `QUEUE_STRATEGY=local` each enqueue takes a global file lock and rewrites `queue.json`.
- Access-log inserts are awaited N-per-list (already flagged in the CRUD spec, Phase 1).
- SSE broadcast + PG NOTIFY are `await`ed in `emit()` on the triggering request.
- Encrypted-field **sort** fetches the *entire* scoped result set (no SQL LIMIT) and decrypts every row in Node (`engine.ts:823-883`) — defeats the pageSize≤100 cap; OOM/timeout risk.

**Found by: search, DB, HTTP, events.**

### Theme D — Per-request framework overhead is paid 2–3×
`createRequestContainer()` is invoked 2–3 times per authenticated request (canonical auth, authorization check, CRUD `withCtx`) with no memoization — each forks an EM, builds an Awilix container, runs all 38 DI registrars, and (default config) re-runs the full `bootstrap()` body (event bus, subscriber re-registration, KMS/encryption service). The customer portal does it **twice** in one request. **Found by: HTTP, tenancy.**

### Theme E — Expensive external I/O lacks per-tenant fairness and ceilings
AI chat dispatcher has **no rate limit** and **no default wall-clock/token budget** (only a 10-step cap); Akeneo retries HTTP 429 in an **unbounded** loop; Gmail `fetch` has no timeout; the global `event:'*'` webhook subscriber runs a decrypting tenant-wide query on **every** domain event even for tenants with zero webhooks. One tenant can starve the shared LLM key / worker pool / DB. **Found by: AI/webhooks/integrations.**

## Prioritized roadmap

Ordered by impact ÷ (effort × risk). P0/P1 are mostly **config + small guards** — the bulk of enterprise readiness. P2 is write-path async + fairness. P3 is genuine architecture work.

### P0 — Correctness & the cache landmine (ship first)
| # | Action | Evidence | Effort · Risk |
|---|--------|----------|---------------|
| 0.1 | **Singleton-guard the cache in `bootstrap()`** (mirror the rate-limiter `globalThis` pattern) so RBAC/org-scope/CF-def caches persist across requests. Single highest-leverage change. | `bootstrap.ts:52-61` vs rate limiter `:24-50` | S · Med |
| 0.2 | **Bound the memory cache** with LRU + `maxEntries` (port `rbacDefaultCache.ts:64-70`); optional reaper for `cleanup()`. Stops unbounded RSS → OOM. | `strategies/memory.ts:9-11,155-164` | M · Low |
| 0.3 | **Fail-closed on `local` queue at scale**: refuse/loud-warn when `QUEUE_STRATEGY=local` + auto-spawn in a multi-replica/prod context (no job leasing → double-processing). | `strategies/local.ts:195-272`, `mercato.ts:2234` | S · Low |
| 0.4 | **Cap the encrypted-sort path**: sort on `*_hash` companion column where deterministic, else hard-cap rows / fall back to id-sort. Removes full-table-fetch+decrypt-all. | `query/engine.ts:507,823-883` | M · Med |
| 0.5 | **Add `statement_timeout` + `lock_timeout`** to the ORM driver options so one runaway query can't exhaust the 20-connection pool. | `db/mikro.ts:107-122` | S · Low |

> **[2026-08 status]** P0.1–P0.4 shipped (#2961, #2962, #2987, #3386 cohort); P0.5 is wired but unset by default (#2964). ⚠️ P0.4's "sort on `*_hash` companion column" prescription is **superseded and was never valid** — a hash does not preserve plaintext ordering; the shipped fix is the two-phase slim-projection bounded sort (`OM_ENCRYPTED_SORT_MAX_ROWS`).

### P1 — Horizontal-scale-correct defaults
| # | Action | Evidence | Effort · Risk |
|---|--------|----------|---------------|
| 1.1 | **Require/default Redis** for `CACHE_STRATEGY`, `RATE_LIMIT_STRATEGY`, `QUEUE_STRATEGY` in production; **fail-loud at boot** when memory/local is combined with >1 instance. Fixes cross-instance ACL staleness, brute-force N×, queue double-processing in one stroke. | `service.ts:218`, `ratelimit/config.ts:7`, `queue/factory.ts:62` | S–M · Low |
| 1.2 | **Short-TTL cache for canonical staff auth** (user + roles + super-admin) keyed by `sid`+`sub`, invalidated on RBAC tags; keep only the session-existence check uncached. Removes 3–6 uncached queries from *every* interactive request. | `sessionIntegrity.ts:29-144` (no cache); mirror `apiKeyAuthCache.ts` | M · Med |
| 1.3 | **Broad default rate limiting** (tenant+user keyed, opt-out per route) across authenticated routes, with cost-weighted buckets for export/search/AI/bulk. Today ~30 of 457 routes are limited, IP-keyed only. | dispatcher `route.ts:342-366` | M · Med |
| 1.4 | **Memoize the request container** (build once per request via `AsyncLocalStorage` / attach to `NextRequest`); thread it through auth, authz, scope, handler. Collapses Theme D's 2–3× overhead; portal's double-build. | `auth/server.ts:263`, dispatcher `:153`, `factory.ts:1264`, `customerAuth.ts:24,60` | M–L · Med |
| 1.5 | Pass already-resolved `isSuperAdmin` into `loadAcl`/`userHasAllFeatures` to drop the redundant per-request super-admin probe (2–3 queries). | `rbacService.ts:253-258` | M · Med |

> **[2026-08 status]** P1.1 shipped with the P0.3 guard (#2987). P1.2–P1.5 remain open (#2978, #2977) — the 2026-08 benchmarks identify this cluster, with #2958 and #2967, as the strongest remaining lever.

### P2 — Write-path async + throughput + per-tenant fairness
| # | Action | Evidence | Effort · Risk |
|---|--------|----------|---------------|
| 2.1 | **Move indexing off the write thread**: make `query_index.upsert_one` → vectorize/search fan-out `persistent:true` (or emit one "record changed" event consumed by a worker). Mandate `QUEUE_STRATEGY=async` for multi-tenant. | `bus.ts:173`, `query_index/subscribers/upsert_one.ts` | M · Med |
| 2.2 | **Fire-and-forget** access-log writes (spec Phase 1: `logMany` + non-blocking) and SSE broadcast/NOTIFY (don't `await` in `emit()`). | spec `2026-05-24` Phase 1; `bus.ts:172-181` | S–M · Low |
| 2.3 | **Batch + dedup indexing**: `embedMany` instead of per-record `embed`; coalesce per-`(entity,id)` index jobs; query-embedding LRU+TTL cache (kills repeated 3 s embed calls on interactive search). | `vector-index.service.ts:429`, `vector.strategy.ts:80` | M · Med |
| 2.4 | **Per-tenant ceilings for expensive I/O**: AI chat rate limit + default `loop.budget` (wall-clock + tokens); bound Akeneo 429 retries + clamp sleep; Gmail `fetch` timeout; cache "tenant has active webhooks?" before the decrypting `*` query. | `ai/chat/route.ts`, `agent-runtime.ts:202`, `sync-akeneo/client.ts:328`, `gmail-client.ts:193`, `outbound-dispatch.ts:60` | S–M · Low–Med |
| 2.5 | **Events throughput**: raise `events` worker concurrency default 1→5; add DLQ + configurable retry/`removeOnFail`; job dedup keys; supervisor restart backoff. | `events.worker.ts:6`, `async.ts:134-140` | S–M · Med |
| 2.6 | **SSE scaling**: coalesce progress emits (min-interval/min-delta, always emit terminal); index connections by `tenantId`; one shared heartbeat interval; per-user/instance connection cap (429); pin `runtime='nodejs'`. | `progressServiceImpl.ts:107`, `stream/route.ts:108,131` | M · Low |

> **[2026-08 status & corrections]** P2.4a–c shipped (#2976/#3014); P2.6's progress coalescing shipped (#2972); the rest is open or partial — see the addendum table. Two prescriptions are corrected:
> - ⚠️ **P2.1 as written is superseded.** The synchronous boundary is intentional: the projection-row write and coverage accounting stay on the request path for read-your-writes consistency (documented in `query_index/subscribers/upsert_one.ts`), and only the tokens/vector/fulltext tail belongs off-thread (partially shipped as a deferred tail in #3236). The correct design is a **durable, idempotent tail event** consumed by a worker — not flipping the whole `upsert_one` subscriber to `persistent: true`.
> - ⚠️ **P2.2's "fire-and-forget" needs an event-delivery contract before implementation.** Naked fire-and-forget can lose work at process termination. A focused spec must distinguish best-effort delivery (browser refresh signals) from correctness-critical coordination, and define buffering, retries, deduplication, shutdown flush, failure metrics, and backpressure.

### P3 — Deeper architecture (design-level)
| # | Action | Evidence | Effort · Risk |
|---|--------|----------|---------------|
| 3.1 | **Redis pub/sub transport for the event bridge** (per-tenant channels), replacing per-event Postgres `NOTIFY`; make instances interchangeable and stop using the OLTP DB as the message broker. Also fixes "persistent worker events never reach SSE." | `bridge.ts:150-172`, `bus.ts:175-181`, `events.worker.ts:88` | L · Med |
| 3.2 | **Search at tenant scale:** pgvector ivfflat→HNSW (filtered ANN) with per-query `probes`/`ef_search` by tenant size; move Meilisearch from **index-per-tenant** (won't scale to thousands of indexes) to a shared index with a `tenant_id` filter + tenant tokens. | `pgvector/index.ts:189`, `meilisearch/index.ts:57` | L · High |
| 3.3 | **Bootstrap refactor** so cached services resolve `em`/container lazily from the *current* request instead of closing over the first one — unlocks `OM_BOOTSTRAP_CACHE=on` safely (the deep version of 0.1/1.4). | `container.ts:48-55`, `bootstrap.ts:52-177` | L · Med |
| 3.4 | **Index-doc & token query indexes**: add GIN on `entity_indexes.doc` (rewrite `doc->>field` filters to containment) and verify the composite index backing the token `GROUP BY/HAVING`. | `engine.ts:1145-1198`, `token.strategy.ts:80-93` | M · Med |

> **[2026-08 corrections]** These are design sketches, not buildable prescriptions — each needs a focused spec. Specifically:
> - ⚠️ **P3.1**: Redis pub/sub by itself provides no durability and does not fix producer/worker routing — it only replaces the transport. The focused spec must define the delivery contract (trusted scope fields, retries, dedup, failure metrics, backpressure) per the P2.2 correction above.
> - ⚠️ **P3.2 is security-incomplete as written.** A shared Meilisearch index gated only by a `tenant_id` filter would be a **cross-organization disclosure path within a tenant**. The current driver enforces organization scoping (`_organizationId` filters and filterable attributes, `packages/search/src/fulltext/drivers/meilisearch/index.ts:71-109`) with defense-in-depth result filtering, and results are additionally gated by per-entity `aclFeatures` (`packages/shared/src/lib/search/entityAccess.ts`). Any shared-index design MUST enforce trusted tenant **and** organization filters plus the ACL-feature gate — never tenant-only.
> - ⚠️ **P3.4's GIN/containment rewrite cannot cover encrypted fields.** `entity_indexes.doc` is encrypted at rest (`encryptIndexDocForStorage`, `packages/core/src/modules/query_index/lib/indexer.ts:207`): encryption-mapped entity and custom fields are ciphertext, so containment predicates would be unindexable or wrong. A focused spec must separate indexable non-sensitive projections (GIN candidates) from encrypted fields, which continue through hashed search tokens or purpose-built companion projections. The token composite-index half already shipped (#2966/#3000).

## Per-domain findings (condensed, for traceability)

### Database / ORM / Query engine
- **[CRIT]** Encrypted-field sort → no-LIMIT full fetch + decrypt-all (`engine.ts:823-883`).
- **[HIGH]** `doc->>field` index-doc filters seq-scan; no GIN on `entity_indexes.doc`.
- **[HIGH]** `information_schema` column/table probes per list (engine is per-request → caches cold) — `engine.ts:965-998`.
- **[HIGH]** Unconditional `console.info` search logging (JSON.stringify on hot path + PII) — `engine.ts:1240`.
- **[HIGH]** All per-request CRUD caches ship disabled by default (Theme A).
- **[MED]** No `statement_timeout`/`lock_timeout`; pool max 20. CF aggregation = 2 LEFT JOINs/cf + forced GROUP BY + COUNT(DISTINCT), `includeCustomFields:true` always. `globalSuperAdminCache` unbounded. Deep org trees → huge `IN (...)`.
- *Solid:* tenant scoping fail-closed; pageSize≤100 enforced; big index tables indexed; index sync fire-and-forget.

### Caching
- **[HIGH]** Memory strategy unbounded (no LRU/eviction; `cleanup()` never scheduled). No single-flight/stampede protection on any miss. **Nav cache not tenant-scoped** (writes under `global`, per-tenant invalidation misses).
- **[MED]** Hot caches set no TTL (tag-only). Redis uses blocking `KEYS`; N+1 `deleteByTags`; double-write meta key. Memory strategy silently wrong multi-instance. Per-request cache construction → memory strategy is a no-op (Theme A/D).
- *Solid:* tenant key namespacing; Redis refcounted pooling; dependency fallback to memory.

### Queue / Workers
- **[CRIT]** Local strategy has **no leasing** → multi-instance/worker double-processing.
- **[HIGH]** No DLQ + hardcoded `attempts:3`/`removeOnFail:1000`; no idempotency/dedup key; `events` default concurrency 1 (global serialization); `worker --all` shares one container + serial per-queue handlers (CPU starves I/O).
- **[MED]** Each replica auto-spawns full fleet; `--all` async can silently fall back to localhost Redis; local rewrites whole file per poll; no backpressure/depth visibility.
- *Solid:* clean strategy abstraction; lazy supervisor; hardened local fs; graceful shutdown.

### Events / Real-time (SSE)
- **[HIGH]** Fan-out rides PG `NOTIFY` (global, un-sharded, on request path); per-record progress broadcasts (no coalescing); unbounded in-process connection `Set` + O(N) scan + per-conn heartbeat; **persistent (worker) events never reach SSE clients**.
- **[MED]** Broadcast awaited on request hot path; global tap fires for *every* emit; inconsistent payload caps (4096 vs 7000 vs PG 8000) silently drop; SSE pins clients to an instance (deploy → reconnect stampede).
- *Solid:* server-side audience filtering; cross-process delivery exists; connection lifecycle hygiene; `allSettled` subscriber isolation.

### Search / Indexing
- **[CRIT]** Index + token write chain synchronous inside every CRUD mutation; per-record jobs, no `embedMany`.
- **[HIGH]** Fresh 3 s embedding per query, no cache; ivfflat `lists=100`/`probes=1` fights tenant filter; **Meilisearch index-per-tenant** won't scale; token `GROUP BY/HAVING count(distinct)` per query.
- **[MED]** Per-record scope SELECT + full re-fetch + per-job config reload; `useQueue:false` reindex runs in-request and blanks the index.
- *Solid:* async indexing when `QUEUE_STRATEGY=async`; checksum skip; parallel strategies with availability cache; batched token writes.

### HTTP / API request lifecycle
- **[HIGH]** `createRequestContainer()` 2–3×/request, no memo; `bootstrap()` re-runs per build in prod; rate limiting on ~30/457 routes, IP-only.
- **[MED]** Rate-limit default in-memory (multi-instance N×); no response compression / body-size limit (`req.clone().json()` double-parse); up to 8 lifecycle emits/request.
- **[LOW]** OpenAPI rebuilt per request (`force-dynamic`); enricher timeout `setTimeout` never cleared.
- *Solid:* singleton ORM pool; RBAC/org-scope/api-key cache layers exist; enricher runner anti-N+1 with batch/timeout/fallback; parallelized canonical-auth reads; pageSize cap.

### Multi-tenancy / Auth / RBAC
- **[CRIT]** RBAC/org-scope cache disabled by default (Theme A); canonical staff auth = 3–6 uncached queries/request.
- **[HIGH]** Unbounded memory cache → RSS + cross-instance **privilege-revocation lag**; rate-limit memory default; portal builds container **twice**.
- **[MED]** Per-request super-admin probe; redundant container/scope/`loadAcl` (2–3×/request).
- *Solid:* constant-time JWT verify, per-audience secrets, uniform auth errors; async bcrypt cost 10 with pre-DB rate limit; fail-closed tenant scoping; working session revocation.

### AI / Webhooks / Integrations / Sync
- **[HIGH]** Akeneo unbounded 429 retry; no default AI wall-clock/token budget; **no per-tenant AI rate limit** (noisy neighbor / shared-key 429s).
- **[MED]** Global `event:'*'` webhook subscriber decrypting query on every domain event; in-process webhook worker competes with requests unless `QUEUE_STRATEGY=async`; Stripe webhook/health clients un-timeout'd; Gmail `fetch` no timeout.
- **[LOW]** Uncached per-turn allowlist/override lookups.
- *Solid:* webhook delivery is the strongest external path (AbortController, jittered backoff, DLQ via `exhausted`, auto-disable breaker, SSRF-safe); email polling bounded/single-flight; data-sync never on request path; AI step-cap + mutation-approval enforced.

## Risks of the changes themselves

| Change | Risk | Mitigation |
|--------|------|------------|
| 0.1 cache singleton | Cached service captures per-request `em`/container (the reason it's off today) | Resolve `em` lazily from current request; bound TTLs; this is why 3.3 exists as the deep fix |
| 1.1 Redis-required defaults | Smaller deployments / dev need memory/local | Keep memory/local as explicit opt-in; gate the boot assertion on `NODE_ENV=production` + instance count |
| 1.2 auth cache | Revocation latency | Low TTL (10–30 s) + tag invalidation; keep session-existence check live |
| 2.1 async indexing | Search lag after write; requires async queue | Acceptable eventual consistency; document `QUEUE_STRATEGY=async` requirement |
| 1.4 container memo | Must preserve fresh-EM-per-request | Share only within one request (ALS scope); keep EM fork semantics |

## Verification

The profiler infra already exists (`OM_PROFILE=*`, `packages/shared/src/lib/profiler`) with per-mark timings, and the CRUD spec defines acceptance criteria. For each item: measure before/after with `OM_PROFILE=*` + `OM_DB_POOL_DEBUG=1` (query count/request), and add a small load test (k6/autocannon) at representative concurrency to validate p50/p99 and confirm no RSS growth / no cross-instance staleness on a 2-instance + Redis setup.

## Open questions / decisions needed

1. **Topology:** confirmed N-instance app + separate worker fleet + Redis? (Drives whether P1.1 is "default" or "hard-require".)
2. **Acceptable staleness windows** for auth/RBAC/org-scope caches (sets TTLs).
3. **Search backend** at target tenant count — commit to HNSW + shared Meilisearch index now, or defer (3.2 is the biggest single effort)?
4. Is `OM_BOOTSTRAP_CACHE` safe to flip on today (quick win) pending the 3.3 refactor, or treat as blocked?

## Recovery & status addendum (2026-08-29)

Everything above this section is the original 2026-06-03 document with its prose, tables, findings, and open questions intact — augmented only by the reading-guidance banner under the header and clearly marked `> [2026-08 …]` blockquote annotations that record shipped status and supersede prescriptions now known to conflict with current isolation, encryption, or consistency contracts. No headings were renamed, so the section identifiers the tracker issues cite (e.g. P3.3, P1.5) still resolve; the untouched original is recoverable at blob `5d69640d9bb325ca7c3a6cb58c887eaad884af6c`.

### Provenance

This file was referenced by fifteen tracker issues but absent from the repository — the situation documented in #4635. It was never on `develop` and was never deleted: it existed only in the author's working tree, and survived solely in local Codex CLI crash-recovery refs (`refs/codex/snapshots/*`). The identical blob (`5d69640d9bb325ca7c3a6cb58c887eaad884af6c`) exists in seven `Codex worktree snapshot: startup-cleanup` commits (`cc2fdd68f2` … `0df10c165e`, 2026-06-20 through 2026-07-07), none of which is an ancestor of `develop` — and such snapshot refs never reach GitHub, which is why #4635's search found nothing. Landing it resolves #4635 through that issue's first option: the spec existed and never made it to the OSS tree.

Two of the document's references need correction as of 2026-08-29:

- `.ai/analysis/2026-06-10-perf-stability-backlog.md` (cited by the issue cohort's provenance footers) is absent from the repository and from the snapshot history — it is not recoverable; the fifteen issue bodies themselves are the surviving record of the audit backlog.
- The original `Related:` link to `2026-05-07-lazy-auto-spawn-queue-workers.md` pointed at the specs root, but that spec was implemented and moved to [`implemented/2026-05-07-lazy-auto-spawn-queue-workers.md`](implemented/2026-05-07-lazy-auto-spawn-queue-workers.md) — the header link has been corrected in place. #2971 tracks the remaining fleet-bounding follow-ups.

Scope clarification: "Enterprise" in the title means enterprise-grade deployment scale. Every finding targets OSS packages (`packages/shared`, `packages/core`, `packages/search`, `packages/events`, `packages/queue`, `packages/cli`), so the spec correctly lives in `.ai/specs/`, not `.ai/specs/enterprise/`.

### Roadmap → tracker mapping

The 2026-06-10 audit filed fifteen issues from this research. Eleven map to items in the roadmap tables above; four came out of the same audit's per-domain findings but extend beyond the P-tables. Each issue is the unit of implementation and (per its issue body) carries its own file:line evidence, flag names, and BC notes; this spec is the program-level context they defer to. States below are as of 2026-08-29.

| Spec anchor | Issue | State (2026-08-29) |
|---|---|---|
| Theme D / P1.4 companion — attach dispatcher-resolved auth via the trusted-auth seam (`OM_DISPATCHER_TRUSTED_AUTH`) | #2958 | open, priority-high |
| P3.3 — bootstrap services cross-request safe, unlock `OM_BOOTSTRAP_CACHE` (finishes #2044 Phase 5) | #2963 | open |
| DB [HIGH] "information_schema probes per list / caches cold" — process-scope query_index metadata caches + once-guarded event wiring (`OM_QUERY_INDEX_META_CACHE_MS`) | #2967 | open, priority-high |
| Audit cohort, beyond the P-tables — query_index coverage-snapshot thundering herd, single-flight refresh | #2968 | open |
| P0.3 / P2.5 / Queue [MED] auto-spawn fleet — bound the worker fleet (idle reap, spawn ceiling, heap cap) | #2971 | open |
| P2.6 — coalesce progress `job.updated` flush + broadcast (`OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS`) | #2972 | **closed / implemented** |
| Events [MED] payload-cap inconsistency + portalBroadcast cross-process gap | #2973 | open, bug |
| P2.4 — negative "has active webhooks" cache before the decrypting `event:'*'` query | #2974 | open |
| P1.4 — memoize the request container per HTTP request via AsyncLocalStorage (`OM_REQUEST_CONTAINER_MEMO`) | #2977 | open, priority-high |
| P1.2 + P1.5 — short-TTL canonical staff-auth cache (`OM_STAFF_AUTH_TTL_MS`) | #2978 | open |
| Audit cohort, beyond the P-tables — sales shipment/payment snapshot N+1 in `loadOrderSnapshot` | #2979 | open |
| Audit cohort, beyond the P-tables — `action_logs` retention prune + drop sales' duplicated undo snapshots | #2980 | open |
| Search [CRIT/HIGH] per-request infra — hoist stateless search services to process singletons | #2981 | open, bug, priority-high |
| Search [CRIT] synchronous token chain — checksum-skip unchanged search-token rewrites | #2982 | open in tracker; substance largely shipped (batch path via #4681, single-record path via #5650, off-request deferral via #3236) |
| Audit cohort, beyond the P-tables — server-first data delivery (`initialData` seam seeding react-query) | #2983 | open, priority-high |

Adjacent newer issues from the 2026-08 load-test round extend the same themes: #5604 (sequence hot-row locks), #5605 (queryEngine per-request caches), #5606 (Meilisearch per-document sync), #5607 (bulk-create endpoint gap), #5619 (information_schema probe memoization).

### Roadmap status as of 2026-08-29 (verified against `develop@421cefe668`)

The audit's candidate numbering had gaps (2–5, 7–9, 12–13, 18–19); those candidates were filed as sibling issues (e.g. #2961, #2962, #2964, #2966, #2976, #2987) and have largely shipped since June. Verified current state of the roadmap items themselves — readers should not re-implement the Done rows:

| Item | State | Evidence on `develop` |
|---|---|---|
| P0.1 cache singleton in `bootstrap()` | **Done** | `getCachedCacheService()` globalThis guard, default-on (`packages/core/src/bootstrap.ts`; #2961/#3031) |
| P0.2 bounded memory cache | **Done** | LRU, `DEFAULT_MEMORY_MAX_ENTRIES=50_000`, amortized expiry sweep (#2962/#2995, #3070) |
| P0.3 + P1.1 single-instance strategy guard | **Done** | `packages/cli/src/lib/single-instance-strategy-guard.ts` fails loud in production multi-instance for local/memory queue, cache, and rate-limit strategies (#2987/#3030) |
| P0.4 encrypted-sort cap | **Done** | two-phase slim-projection bounded sort + `OM_ENCRYPTED_SORT_MAX_ROWS` (#3386 cohort) |
| P0.5 statement/lock timeouts | Partial | `DB_STATEMENT_TIMEOUT_MS` / `DB_LOCK_TIMEOUT_MS` wired (#2964/#3033) but unset by default |
| P1.2 staff-auth cache | Open | `sessionIntegrity.ts` still uncached (#2978) |
| P1.3 rate-limit breadth | Open | opt-in per route, IP-keyed; ~24 of ~408 API route files declare it |
| P1.4 request-container memo | Open | `createRequestContainer()` still unmemoized, no AsyncLocalStorage (#2977) |
| P1.5 super-admin probe | Open | instance-scoped `globalSuperAdminCache` on a `.scoped()` service (#2978) |
| P2.1 indexing off the write thread | Partial | heavy tail (tokens/vector/search) deferred off-request by default (#3236); projection write still inline, subscriber still ephemeral |
| P2.2 fire-and-forget | Partial | access-log writes async (#2044 Phase 1); `emit()` still awaits SSE fan-out + `pg_notify` |
| P2.3 batch embeddings / query-embedding cache | Open | no `embedMany`, no job coalescing, no query-embedding cache |
| P2.4 per-tenant ceilings | Mostly done | AI chat rate limit + default loop budgets, Akeneo 429 bound + timeout, Gmail timeout (#2976/#3014); webhooks negative cache still open (#2974) |
| P2.5 events throughput | Partial | async-strategy abandoned-job sweep/DLQ landed; events worker concurrency default still 1; local strategy still has no DLQ |
| P2.6 SSE scaling | Partial | progress coalescing landed (#2972); connection indexing by tenant, shared heartbeat, and connection caps still open |
| P3.1 Redis pub/sub bridge | Open | transport still `pg_notify`/`LISTEN` |
| P3.2 HNSW + shared Meilisearch index | Open | still ivfflat `lists=100`; still index-per-tenant |
| P3.3 bootstrap cross-request safety | Open | `OM_BOOTSTRAP_CACHE` still default-off (#2963) |
| P3.4 index work | Partial | token composite index landed (#2966/#3000); GIN on `entity_indexes.doc` still open |
| DB [HIGH] hot-path search `console.info` | **Done** | level-gated `logger.debug` |
| Caching [HIGH] nav cache tenant scoping | **Done** | tenant/org/user/locale-keyed cache with scoped invalidation tags |

The org-scope cross-request cache also remains opt-in (`OM_ORG_SCOPE_CACHE_TTL_MS`, default 0 per `organizationScope.ts`).

### Empirical validation (2026-08 benchmarks)

A local production-topology benchmark (4 vCPU / 8 GB app container, separate PostgreSQL/Redis/Meilisearch containers, k6 protocol + Chromium journeys, 2.08M-row seeded dataset) produced results consistent with this spec's diagnosis:

- A sharp latency knee near 20 offered business journeys/s (~50 HTTP req/s): p95 3.2 s, p99 14.9 s, dropped work — while the app peaked at ~40% of its CPU allocation and PostgreSQL at ~25%. Repeating the same ramp on a 13× smaller dataset did not move the knee — consistent with dataset size and database CPU not being the first constraint, and pointing at Themes A, C, and D (per-request framework overhead, synchronous fan-out, dead caches).
- Code-level verification against `develop@421cefe668` (branch tip as of 2026-08-29) located the mechanisms at current positions: dispatcher auth at `apps/mercato/src/app/api/[...slug]/route.ts:369` with a second full canonical resolution via `packages/shared/src/lib/crud/factory.ts:1397` → `packages/shared/src/lib/auth/server.ts:357`; unconditional registrar replay per container at `packages/shared/src/lib/di/container.ts:248`; the `custom_field_defs` discovery query at `packages/core/src/modules/query_index/di.ts:255-257` (observed ~4× per HTTP request under load); serial response-enricher execution at `packages/shared/src/lib/crud/enricher-runner.ts:228` (2,104 slow-enricher threshold events in one 3-minute run at 20 journeys/s, with the unthrottled warning itself adding load).
- The per-request `query_index` `setup()` also re-registers event-bus listeners on the process-shared bus on every request (listener accumulation) — an aggravator of the #2967/#2963 cluster not called out in the 2026-06 audit.

The 2026-08 evidence also revises two of the original assessments upward. Theme D's "2–3×" container count measures ~4 builds on a normal CRUD request. And the enricher runner — listed under *Solid* in the HTTP findings with only a [LOW] item — behaves as a first-order list-tail amplifier under load (serial execution, no per-request field opt-in, read-through cache plumbing present but unused by any shipped enricher); none of that is covered by the original fifteen issues.

Priority implication: the benchmarked build already contained the shipped P0 fixes (the cache singleton and the two-phase encrypted sort are ancestors of the benchmarked commit), so the measured knee characterizes what is **still open** — the request-container/auth duplication cluster (#2958/#2977/#2978), the query_index metadata caches (#2967), and enricher execution — not the items the June–July wave already fixed. The measurements therefore strengthen the remaining-P1 ordering rather than re-litigating P0.

## Changelog
- **2026-06-03** — initial research + roadmap from 8 parallel domain audits; no code change.
- **2026-08-29** — recovered from the local `refs/codex/snapshots/*` history (identical blob in all seven `startup-cleanup` snapshots) and submitted to `develop` for the first time via PR #5777, resolving #4635. Added the Recovery & status addendum: provenance, roadmap→tracker mapping for #2958–#2983 (#2972 implemented), a develop-verified roadmap status table (P0 largely shipped since June — P0.1–P0.4 and P1.1 done, P0.5 partial; P1.2–P1.5, P2.2b, P2.3, P2.4d, P3.1–P3.3 still open), pointers to the 2026-08 follow-up issues, and empirical validation from the 2026-08 production-topology benchmarks.
- **2026-08-29 (review round)** — architectural-review corrections applied inline as marked annotations: reading-guidance banner (research roadmap, not an implementation spec; architectural units P2.1/P2.2/P3.1–P3.4 require focused specs); superseded P0.4's hash-column sort (a hash does not preserve ordering; the shipped two-phase bounded sort is the fix); corrected P2.1 (projection/coverage stay synchronous for read-your-writes — durable idempotent tail event, not a wholesale persistent subscriber); required an event-delivery contract for P2.2/P3.1; flagged P3.2 as security-incomplete (shared index must enforce tenant + organization filters and ACL-feature gating, never tenant-only); constrained P3.4's GIN idea to non-encrypted projections (`entity_indexes.doc` is encrypted at rest); fixed the `2026-05-07` Related link to its `implemented/` location.
