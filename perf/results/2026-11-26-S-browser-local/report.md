# Perf report: 2026-11-26-S-browser-local (local-validation)

## 1. Environment

| Item | Value |
|---|---|
| Run | 2026-11-26-S-browser-local |
| Scenario / profile | browser / browser |
| Tier / dataset | S (anchor 2026-11-26, age 0 d, snapshot S-1263504e-202611260809) |
| Git SHA | 908553084ac6b88a9a914f092d312981738c54cb-dirty |
| Image | sha256:13b0372a5fcd9e780a26ed9f38e74a3077f906c027a7bc22d947debcbeb6ee7e |
| Migration head | 55e7311bf363f4af (latest Migration20261120120000_auth) |
| Env hash | 6e4f356a568ee55a9baed3b10b071f74fc505cfafe6dc0b7a3a7916602eb68eb |
| Notable overrides | OM_INIT_SUPERADMIN_EMAIL=superadmin@perf.local, TENANT_DATA_ENCRYPTION=true, ENABLE_CRUD_API_CACHE=true, NODE_ENV=production, RATE_LIMIT_LOGIN_IP_POINTS=10000, TELEMETRY_SAMPLING_RATIO=0.01, DB_POOL_MAX=20, DB_POOL_MIN=2, NODE_OPTIONS=--max-old-space-size=3072, WORKER_DB_POOL_MAX=8, WORKER_NODE_OPTIONS=--max-old-space-size=2048, REDIS_MAXMEMORY=512mb, PG_MAX_CONNECTIONS=200, PG_SHARED_BUFFERS=2GB, PG_EFFECTIVE_CACHE_SIZE=6GB, PG_WORK_MEM=16MB, PG_MAINTENANCE_WORK_MEM=512MB |
| Hardware | local-mac nproc=16 kernel=Darwin 27.2.0 dockerCpus=16 dockerMemBytes=17247232000 |
| Generator | laptop-local, RTT p50 4.62 ms / p95 8.56 ms |
| k6 | k6 v1.8.2 (commit/682f083071, go1.26.4, linux/arm64) |
| Window | 2026-11-26T09:15:42.279Z → 2026-11-26T09:25:56.664Z |
| Modules | 75 static (9 env-gated not counted) |

## 2. Summary

> **local-validation** run: script and runbook check on a laptop. These are not baseline numbers.

- Saturation point: not reached in this run
- Worst endpoints by p95: –
- Error budget: 0 requests, 0.00% errors, 0.00% optimistic-lock conflicts
- Previous comparable run: none

## 3. Latency per tag

Reference lines (non-failing): read p95 < 500 ms, errors < 1.00%. Warmup excluded. Source: k6 CSV output.

### Load steps

_No data._

### All measured steps

_No data._

## 4. Journeys and Web Vitals

| Journey | Count | p50 ms | p95 ms | Max ms |
|---|---|---|---|---|
| browser.crm | 77 | 15.5 s | 16.7 s | 21.1 s |

Reference: LCP < 2500 ms, INP < 200 ms, CLS < 0.1.

| Vital | Count | p50 | p95 |
|---|---|---|---|
| ttfb | 462 | 144 | 365 |
| fcp | 462 | 232 | 492 |
| lcp | 385 | 524 | 1011 |
| fid | 308 | 0.8 | 5.4 |
| cls | 77 | 0.492 | 0.640 |

## 5. Resources by window

| Metric | Series | Window | Avg | Peak |
|---|---|---|---|---|
| CPU cores | app | run | 1.11 | 1.24 |
| CPU cores | meilisearch | run | 0.00 | 0.00 |
| CPU cores | monitoring (sum) | run | 0.05 | 0.09 |
| CPU cores | postgres | run | 0.25 | 0.60 |
| CPU cores | redis | run | 0.01 | 0.01 |
| CPU cores | tls | run | 0.10 | 0.11 |
| CPU cores | worker | run | 0.02 | 0.29 |
| Working set | app | run | 2.2 GiB | 3.9 GiB |
| Working set | meilisearch | run | 76.7 MiB | 86.3 MiB |
| Working set | monitoring (sum) | run | 1.4 GiB | 1.4 GiB |
| Working set | postgres | run | 2.4 GiB | 2.4 GiB |
| Working set | redis | run | 26.1 MiB | 27.9 MiB |
| Working set | scheduler | run | 6.6 MiB | 6.6 MiB |
| Working set | tls | run | 81.8 MiB | 90.3 MiB |
| Working set | worker | run | 709.7 MiB | 1.5 GiB |
| DB pool used | om-app | run | 0.7 | 6 |
| DB pool used | om-worker | run | 0 | 0 |
| DB pool pending | om-app | run | 0 | 0 |
| DB pool pending | om-worker | run | 0 | 0 |
| DB pool wait p95 | om-app | run | 1.0 ms | 1.0 ms |
| DB pool wait p95 | om-worker | run | 2.9 ms | 7.3 ms |
| Event loop utilization | om-app | run | 64.2% | 83.1% |
| Event loop utilization | om-worker | run | 0.6% | 1.3% |
| Event loop delay p99 | om-app | run | 61.4 ms | 70.8 ms |
| Event loop delay p99 | om-worker | run | 25.0 ms | 25.1 ms |
| V8 heap used | om-app | run | 1.5 GiB | 1.9 GiB |
| V8 heap used | om-worker | run | 484.5 MiB | 987.5 MiB |
| Redis memory | total | run | 9.0 MiB | 10.2 MiB |
| Postgres backends | total | run | 32.3 | 36 |
| Postgres cache hit | total | run | 98.8% | 100.0% |
| Disk busy | total | run | 2.1% | 3.7% |
| CPU steal | total | run | 0.0% | 0.0% |
| Server-side p95 (Caddy) | total | run | 430 ms | 773 ms |

## 6. Database

- Cache hit ratio: 98.74%; temp files: 0 (0 B); deadlocks: 0; lock waits logged: 0; slow statements (> 500 ms) logged: 1
- Connections at capture: idle=8, active=1 (max_connections 200)

### Top statements by total time

| queryid | Calls | Total ms | Mean ms | Rows | Calls/req | Statement |
|---|---|---|---|---|---|---|
| -8829675414887134388 | 462 | 14.7 s | 31.9 | 1848 | – | `select "deal_id", count(*) as "count" from "customer_interactions" where "deal_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $1` |
| -3048045920252186600 | 121 | 4672 | 38.6 | 2420 | – | `select "c0".* from "customer_interactions" as "c0" where "c0"."tenant_id" = $1 and "c0"."interaction_type" = $2 and "c0"."organization_id" in ($3) order by "c0"` |
| -29729472750234842 | 102 | 2372 | 23.3 | 6 | – | `select "deal_id", count(*) as "count" from "customer_interactions" where "deal_id" in ($1) and "organization_id" = $2 and "tenant_id" = $3 and "deleted_at" is n` |
| -1834966430576178371 | 77 | 2212 | 28.7 | 0 | – | `select "id", "entity_id", "deal_id", "interaction_type", "title", "body", "status", "scheduled_at", "occurred_at", "priority", "author_user_id", "owner_user_id"` |
| 8308472885243591271 | 197929 | 2139 | 0.0 | 79076 | – | `select entity_id, tenant_id, organization_id, fields_json from encryption_maps where entity_id = $1 and is_active = $2 and deleted_at is null and ((tenant_id is` |
| -4505896698322519283 | 17 | 2128 | 125 | 3698 | – | `select "entity_id" from "search_tokens" where "entity_type" = $1 and "token_hash" in ($2, $3, $4) and "field" in ($5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $` |
| 5362125060465940722 | 68587 | 1810 | 0.0 | 617283 | – | `select distinct "entity_id" from "custom_field_defs"` |
| 4333009774245272910 | 121 | 1495 | 12.4 | 605 | – | `select "c0".*, "c1"."id" as "c1__id", "c2"."id" as "c2__id" from "customer_entities" as "c0" left join "customer_people" as "c1" on "c0"."id" = "c1"."entity_id"` |
| -1766141586565961298 | 117 | 1046 | 8.9 | 585 | – | `select "c0".*, "c1"."id" as "c1__id", "c2"."id" as "c2__id" from "customer_entities" as "c0" left join "customer_people" as "c1" on "c0"."id" = "c1"."entity_id"` |
| 4932349014677696289 | 122 | 627 | 5.1 | 610 | – | `select "c0".* from "customer_deals" as "c0" where "c0"."tenant_id" = $1 and "c0"."deleted_at" is null and "c0"."organization_id" = $2 order by "c0"."created_at"` |

### Top statements by mean time (calls >= 5)

| queryid | Calls | Total ms | Mean ms | Rows | Calls/req | Statement |
|---|---|---|---|---|---|---|
| -4505896698322519283 | 17 | 2128 | 125 | 3698 | – | `select "entity_id" from "search_tokens" where "entity_type" = $1 and "token_hash" in ($2, $3, $4) and "field" in ($5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $` |
| -5283699363119754786 | 9 | 444 | 49.3 | 2647 | – | `select "entity_id" from "search_tokens" where "entity_type" = $1 and "token_hash" in ($2, $3) and "field" in ($4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $` |
| -3048045920252186600 | 121 | 4672 | 38.6 | 2420 | – | `select "c0".* from "customer_interactions" as "c0" where "c0"."tenant_id" = $1 and "c0"."interaction_type" = $2 and "c0"."organization_id" in ($3) order by "c0"` |
| -8829675414887134388 | 462 | 14.7 s | 31.9 | 1848 | – | `select "deal_id", count(*) as "count" from "customer_interactions" where "deal_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $1` |
| -1834966430576178371 | 77 | 2212 | 28.7 | 0 | – | `select "id", "entity_id", "deal_id", "interaction_type", "title", "body", "status", "scheduled_at", "occurred_at", "priority", "author_user_id", "owner_user_id"` |
| 2453910191195726282 | 9 | 242 | 26.8 | 2 | – | `select "deal_id", count(*) as "count" from "customer_interactions" where "deal_id" in ($1, $2) and "organization_id" = $3 and "tenant_id" = $4 and "deleted_at" ` |
| -29729472750234842 | 102 | 2372 | 23.3 | 6 | – | `select "deal_id", count(*) as "count" from "customer_interactions" where "deal_id" in ($1) and "organization_id" = $2 and "tenant_id" = $3 and "deleted_at" is n` |
| 4333009774245272910 | 121 | 1495 | 12.4 | 605 | – | `select "c0".*, "c1"."id" as "c1__id", "c2"."id" as "c2__id" from "customer_entities" as "c0" left join "customer_people" as "c1" on "c0"."id" = "c1"."entity_id"` |
| -1766141586565961298 | 117 | 1046 | 8.9 | 585 | – | `select "c0".*, "c1"."id" as "c1__id", "c2"."id" as "c2__id" from "customer_entities" as "c0" left join "customer_people" as "c1" on "c0"."id" = "c1"."entity_id"` |
| 7544619809669482201 | 12 | 91.1 | 7.6 | 300 | – | `select "b"."id" as "id", "b"."title" as "title", "b"."description" as "description", "b"."status" as "status", "b"."pipeline_stage" as "pipeline_stage", "b"."pi` |

### Plans

<details><summary>auto_explain 1253 ms at 2026-11-26 09:16:49.331 UTC</summary>

```
	Query Text: select "entity_id" from "search_tokens" where "entity_type" = $1 and "token_hash" in ($2, $3, $4) and "field" in ($5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) and tenant_id is not distinct from $24 and "organization_id" = $25 group by "entity_id" having count(distinct token_hash) >= $26
	GroupAggregate  (cost=8875.60..9002.56 rows=1935 width=37) (actual time=1245.208..1253.393 rows=221 loops=1)
	  Group Key: entity_id
	  Filter: (count(DISTINCT token_hash) >= '3'::bigint)
	  Rows Removed by Filter: 37279
	  Buffers: shared hit=7892 read=40161
	  I/O Timings: shared read=1127.049
	  ->  Sort  (cost=8875.60..8893.73 rows=7252 width=102) (actual time=1245.157..1247.239 rows=47706 loops=1)
	        Sort Key: entity_id, token_hash
	        Sort Method: quicksort  Memory: 7127kB
	        Buffers: shared hit=7892 read=40161
	        I/O Timings: shared read=1127.049
	        ->  Index Scan using search_tokens_lookup_idx on search_tokens  (cost=0.56..8410.59 rows=7252 width=102) (actual time=0.904..1201.716 rows=47706 loops=1)
	              Index Cond: ((entity_type = 'customers:customer_person_profile'::text) AND (field = ANY ('{search_text,display_name,primary_email,primary_phone,status,lifecycle_stage,source,first_name,last_name,preferred_name,job_title,department,seniority,timezone,linked_in_url,twitter_url,cf:buying_role,cf:preferred_pronouns,cf:newsletter_opt_in}'::text[])) AND (token_hash = ANY ('{2f48b881ea7073f1c6f083b296a360bd4c9cf51edaacba1cd9c34d8ae3d994ec,a79c356d145709bd95d78ad05e792cc221c1276dd09b67c12d8c058bb5a2d924,0471f3b21f92ac5f3cbdb8f361c725162391128d440108488c1c5da8cea488cc}'::text[])) AND (organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid))
	              Filter: (NOT (tenant_id IS DISTINCT FROM '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid))
	              Buffers: shared hit=7892 read=40161
	              I/O Timings: shared read=1127.049
```
</details>

<details><summary>generic plan for queryid -8829675414887134388</summary>

```
GroupAggregate  (cost=16295.77..16295.81 rows=2 width=24)
  Group Key: deal_id
  ->  Sort  (cost=16295.77..16295.78 rows=2 width=16)
        Sort Key: deal_id
        ->  Index Scan using customer_interactions_type_idx on customer_interactions  (cost=0.42..16295.76 rows=2 width=16)
              Index Cond: ((tenant_id = $27) AND (organization_id = $26))
              Filter: ((deleted_at IS NULL) AND (status <> ALL (ARRAY[$28, $29, $30])) AND (deal_id = ANY (ARRAY[$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25])))
```
</details>

<details><summary>generic plan for queryid -3048045920252186600</summary>

```
Limit  (cost=5901.03..5903.96 rows=1170 width=766)
  ->  Sort  (cost=5901.03..5930.29 rows=11702 width=766)
        Sort Key: created_at DESC
        ->  Index Scan using customer_interactions_type_idx on customer_interactions c0  (cost=0.42..5110.30 rows=11702 width=766)
              Index Cond: ((tenant_id = $1) AND (organization_id = $3) AND (interaction_type = $2))
```
</details>

<details><summary>generic plan for queryid -29729472750234842</summary>

```
GroupAggregate  (cost=0.42..14613.67 rows=1 width=24)
  ->  Index Scan using customer_interactions_type_idx on customer_interactions  (cost=0.42..14613.66 rows=1 width=16)
        Index Cond: ((tenant_id = $3) AND (organization_id = $2))
        Filter: ((deleted_at IS NULL) AND (deal_id = $1) AND (status <> ALL (ARRAY[$4, $5, $6])))
```
</details>

### Lock waits

_No data._

## 7. Findings

Candidates ranked by p95 (rank finally by latency share × traffic share during the round analysis):

_None._

## 8. Limitations of this run

- local-validation: k6, the SUT and monitoring share one laptop; latency includes Docker Desktop virtualization and generator contention.
- Protocol VUs do not hold SSE connections (core k6 has no EventSource); only browser VUs do, so SSE fan-out is under-represented.
- App runtime metrics (pool, event loop, heap) are exported by the OTLP metric reader every 60 s (the telemetry package builds the reader without an interval), so short spikes are averaged. The pool gauges are point samples at export time and can read 0 while the pool is saturated in between; use `DB pool wait p95`, `Postgres backends` and app `timeout exceeded when trying to connect` errors for pool saturation.
- Seeded records have no action_logs history; the changelog tab is sparse for them.
