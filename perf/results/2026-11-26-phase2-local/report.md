# Phase 2 — Local validation report (tier S)

- **Date:** 2026-11-26
- **Hardware profile:** `local-mac` (Docker Desktop VM, 16 GB assigned, containerd image store; SUT, monitoring and k6 on one laptop)
- **Dataset:** `perf-v1`, tier S, seed 42, anchor 2026-11-26, manifest checksum `1263504e…` (identical across two independent seeds)
- **Branch / PR:** `docs/crm-performance-test-plan`, draft PR #10747 (not for merge)
- **Status:** Phase 2 exit criteria met: smoke, baseline, mini step, browser, dashboards, report. Runbook fixes are applied.

> These are `local-validation` numbers. k6, the app and monitoring share one laptop, so absolute latencies are not baseline values. The *relative* signals below (what is slow at 1 VU, what degrades at 26 VUs, where time goes) are strong enough to rank hypotheses before the VPS rounds.

## 1. Runs

| Run | Scenario | VUs | Requests | Errors | p50 / p95 / p99 | Notes |
|---|---|---|---|---|---|---|
| [`2026-11-26-S-smoke-local`](../2026-11-26-S-smoke-local/report.md) | smoke | 2 | 1,060 | 0.28% | 85 ms / 6.5 s / 9.3 s | Errors: 1× `deals/map` 500 (DB pool connect timeout) + 2× shell 503 at the same moment |
| [`2026-11-26-S-baseline-local`](../2026-11-26-S-baseline-local/report.md) | baseline (20 samples) | 1 | 3,874 | **0%** | 75 ms / 1.5 s / 9.0 s | All checks pass |
| [`2026-11-26-S-step-local`](../2026-11-26-S-step-local/report.md) | step `mini` (10 → 25) | 12 → 26 | 7,054 | 0.04% | 84 ms / 2.6 s / 9.6 s | Saturation at step 2: read p95 241 ms → 2,261 ms. 3× 502 = proxy keep-alive race (fixed after the run) |
| `2026-11-26-S-browser-local` | browser | 2 | _see §5_ | | | Web Vitals |

Setup timings on `local-mac` (tier S) are in `perf/config/hardware.md`:
- seed-perf 79 s (≈ 630 entities/s),
- query_index reindex 6 min, Meilisearch indexing 15 min,
- snapshot 64 s, restore 65 s,
- full clean rebuild (stack up → snapshot) ≈ 28 min.

## 2. Findings — prioritized

Priority: **P1** = blocks meaningful VPS results or is a likely production incident; **P2** = large, clearly attributable latency; **P3** = smaller or operational. No GitHub issues were filed; a human decides which items become issues.

### P1-1 — `deals/map` is unbounded and CPU-bound in Node (H3 confirmed)

- **Evidence:**
  - At 1 VU: p50 8.8 s, p95 9.6 s. At 26 VUs: p95 13.3 s.
  - Its address query takes 109 ms in Postgres, but it returns **all 14,219 geocoded addresses of the tenant on every page request**.
  - It then builds `$in` lists over all located entity ids for the deal links.
  - Almost the whole request time is spent in the Node process (ORM hydration + decryption), not in the database.
  - In smoke, one map request coincided with `timeout exceeded when trying to connect` (DB pool of 20, with only 2 VUs) and two 503s on unrelated shell endpoints.
- **Code:** `packages/core/src/modules/customers/api/deals/map/route.ts:266-300`.
- **Scaling risk:**
  - At L, about 240k geocoded addresses go into one `$in`. That exceeds the Postgres bind-parameter limit (65,535), so the endpoint errors out.
  - Before that, it monopolizes the event loop for tens of seconds.
- **Recommendation:**
  - Resolve located deals in SQL, e.g. a join or `EXISTS` on addresses with coordinates, page-bounded.
  - Fetch and decrypt only the page's rows.

### P1-2 — One Next.js process saturates on CPU-heavy requests; everything queues behind them (H6, head-of-line blocking)

- **Evidence (step `mini`):** read p95 rises 9× from 12 to 26 VUs (241 ms → 2.26 s), while:
  - app CPU stays ≤ 0.8 core,
  - Postgres CPU stays ≤ 0.2 core,
  - there are **0 lock waits**, 0 deadlocks and 0 temp files,
  - there were no pool connect timeouts in this run.
- **Collateral damage:**
  - Shell endpoints (notifications, progress, switcher) go from p95 ≈ 120 ms at 1 VU to 3.7 s at 26 VUs.
  - `write.person.edit` goes from 178 ms to 16.8 s.
  - Response enrichers hit their timeouts: `integrations.external-id-mapping` (500 ms), `example.customer-todo-count`, `customers.private-email-count` and others (1.5–2 s).
  - In smoke, app event-loop utilization peaked at 85% and event-loop delay p99 at 1.15 s.
- **Mechanism:** a single Node main thread runs CPU-bound work (P1-1, P2-1, P2-3, ORM hydration plus decryption). Every other request waits for it. The DB pool and Postgres are not the bottleneck at this load.
- **Implication for the VPS:**
  - With one app process, a 6-vCPU SUT is effectively limited to ~1 core for request handling. The knee will appear at low DB CPU, as the 2026-08 run reported.
  - Without a multi-process app experiment, the plan would measure the deployment shape rather than the code.
- **Recommendation:**
  - Fix the CPU-heavy endpoints (P1-1, P2-1, P2-3).
  - Add an optional experiment to the plan: N app replicas behind the proxy.
  - Record the replica count as a comparability key.

### P1-3 — `search_tokens` dominates storage (11 GB of a 12 GB database at tier S) and blocks M on an 80 GB disk

- **Evidence:**
  - The measured tenant has 11.8M rows, about 84 tokens per indexed record.
  - The heap is 8.4 GB for about 3.3 GB of live rows (228 B/row), so ~2.5× bloat after the seed + reindex pipeline. The indexes take another 3.1 GB.
  - Tokenized fields that are useless for search:

    | Field | Tokens |
    |---|---|
    | `linked_in_url` | 1.20M |
    | `entityId` (a UUID) | 759k |
    | `timezone` | 338k |
- **Code:** `packages/core/src/modules/query_index/lib/search-tokens.ts:222` (`buildSearchTokenRows`), with the per-entity field selection in the customers search configuration.
- **Impact:**
  - Linear extrapolation gives ~60 GB at M and ~240 GB at L, doubled by the template snapshot.
  - On the offered 80 GB VPS, only S fits.
  - Writes also pay for every token row.
- **Recommendation:**
  - Exclude ids, URLs and enumerations from tokenization, and check whether `search_text` duplicates per-field tokens.
  - In the meantime, provision ≥ 200 GB for M (`perf/config/hardware.md` → Disk budget).
  - Changing tokenization changes the dataset, so it needs a new profile (`perf-v2`). Results across the change are not comparable.

### P2-1 — Search with no token hit falls back to `ILIKE` over encrypted columns (H4 confirmed)

- **Evidence:**
  - `search.list:noHit` takes 7.1 s at 1 VU.
  - The top statement by mean time is a `count(*)` over `customer_entities` with 117 bind parameters: 4.1 s mean.
- **Code:** `packages/core/src/modules/customers/api/people/route.ts:137-194`. The fallback applies `$ilike` to `display_name`, `primary_email`, `primary_phone` and `description` (lines 188-191).
- **To verify:** with tenant encryption on, those columns hold ciphertext. If so, the fallback both scans and cannot match plaintext, which is a correctness question as well as a performance one.
- **Recommendation:** with encryption on, skip the `ILIKE` fallback (or cap it); otherwise add a trigram index.

### P2-2 — Sorting by an encrypted column decrypts the whole match set (H1 confirmed)

- **Evidence:**

  | Sort | 1 VU | 26 VUs |
  |---|---|---|
  | `people.name` | 2.67 s | p95 13.9 s |
  | `people.primaryEmail` | 2.6 s | |
  | `deals.title` | 1.5 s | |
- **Code:** `packages/shared/src/lib/query/encrypted-sort.ts:39`. There is no cap unless `OM_ENCRYPTED_SORT_MAX_ROWS` is set.
- **Also affected:** the pipeline kanban sorts companies by encrypted `display_name`, so every kanban view pays this cost.
- **Recommendation:** add a deterministic sort key (for example a blind-index prefix) or set the cap by default for list views.

### P2-3 — Deal summary and needs-attention degrade sharply under load (H2 partially)

- **Evidence:**

  | Call | 1 VU | 26 VUs (p95) |
  |---|---|---|
  | `heavy.deals.summary:summary` | 260 ms | 15.4 s |
  | `needsAttention` | 220 ms | 12.9 s |
  | `stuck` | 230 ms | 9.8 s |
- **Code:** `packages/core/src/modules/customers/lib/stuckDeals.ts:41-87`, `lib/dealsSummaryQueries.ts:86-240`.
- **Scaling risk:** at L, the deal-id `IN (…)` lists risk the bind-parameter limit.
- **To verify at M:** whether this is queueing (P1-2) or the queries themselves.

### P3-1 — App DB-pool gauges cannot show saturation

- **Evidence:**
  - `om.db.pool.connections` and `pending_requests` are point samples taken once per OTLP export.
  - The interval is fixed at 60 s: `PeriodicExportingMetricReader` is built without an interval in `packages/telemetry/src/provider/otlp-provider.ts:299`.
  - In smoke they read 0 while the pool was timing out.
- **Recommendation:** make the export interval configurable (e.g. `OTEL_METRIC_EXPORT_INTERVAL`), or add a high-water-mark gauge.
- **Meanwhile:** the report reads `DB pool wait p95`, `Postgres backends` and app connect-timeout errors.

### P3-2 — `mercato auth setup` creates a tenant without module defaults

- **Evidence:** `seedDefaults` does not run, so the tenant has no currency dictionary. As a result, `GET /api/customers/dictionaries/currency` returned 404 in the pipeline journey.
- **Workaround:** `mercato seed:defaults` (the harness now runs it after `auth setup`).
- **Recommendation:** either `auth setup` runs `seedDefaults`, or its help text says to run `seed:defaults` afterwards.

### P3-3 — A reverse proxy in front of Next.js needs an upstream keep-alive shorter than Node's

- **Evidence:** 3× 502 with `connection reset by peer` on `/api/auth/feature-check`. The proxy reused an idle upstream connection that Node closed after its 5 s `keepAliveTimeout`.
- **Fixed in the harness:** Caddy `transport http { keepalive 4s }`.
- **Recommendation:** add this to the deployment docs (Traefik, nginx and Caddy all need it), or raise the server's `keepAliveTimeout`.

### P3-4 — The app image is 14.3 GB and the build context ~20 GB

- **Evidence:**
  - A 6.1 GB layer copies `apps/mercato/.mercato/next`, which includes local Next.js caches.
  - `.mercato` and `.ai` (16 GB) are not in `.dockerignore`.
  - A fresh clone (VPS) is much smaller, but laptop-built images are 14 GB to ship.
- **Recommendation:** dockerignore `apps/mercato/.mercato` and `.ai`.

### P3-5 — Smaller items seen while building the journeys

- **Permissions:** the employee role lacks `customers.interactions.manage`, so k6 employees log notes as comments (`packages/core/src/modules/customers/setup.ts:95-117`).
- **Deals list sort parameters:** the UI sends `sort`/`order` (`backend/customers/deals/page.tsx:368`) while the route validates `sortField`/`sortDir` (`api/deals/route.ts:72-73`). Both variants are measured. They cost the same, about 1.6–2.0 s at 1 VU.
- **Calendar:** the month view has no owner filter, so it loads every owner's interactions.
- **Refresh token:** only returned with `remember=1`.

## 3. Hypotheses status after Phase 2

| ID | Status | Note |
|---|---|---|
| H1 encrypted sort | **confirmed** | P2-2 |
| H2 `IN (…)` bind limit | open (needs L) | P2-3 shows load sensitivity at S |
| H3 `deals/map` unbounded | **confirmed** | P1-1 |
| H4 `ILIKE` fallback | **confirmed** | P2-1 |
| H5 360 detail fan-out | weak at S | `company.360:detail` 269 ms → 8.8 s at 26 VUs; likely queueing (P1-2) |
| H6 per-request overhead / single process | **confirmed as the knee mechanism** | P1-2 |
| H7 missing indexes | not visible at S | DB is idle; re-test at M |
| H8 write path | partially | `write.interaction:create` 1.8 s → 11 s; queueing vs. write path to split at M |
| H9 bulk owner update | not exercised enough | 5 samples only |
| H10 interaction encrypted search | not measured separately | |

## 4. Harness and runbook fixes made during Phase 2

All of these are pushed to PR #10747.

| Problem | Fix |
|---|---|
| node-exporter would not start on Docker Desktop (`rslave`) | `NODE_EXPORTER_ROOT_MOUNT_OPTS` |
| Staff creation returned 400 (missing org scope) | `provision-users` sends `organizationId`/`tenantId` |
| Meilisearch settle check never settled (counted BullMQ repeatable jobs) | delayed jobs counted only when overdue; `--skip-query-index` for resume |
| Tenant had no module defaults | `perf tenant` runs `mercato seed:defaults` |
| Kanban opened the empty "Default Pipeline" | seeder makes the first perf pipeline the default |
| CI: `.sort()` without comparator (#3620) | explicit code-unit comparators (identical output) |
| cAdvisor saw no containers under the containerd image store | `ghcr.io/google/cadvisor:v0.60.6` + docker/containerd sockets |
| `EXPLAIN` failed on 4000-char truncated statements | EXPLAIN uses the full text |
| Report noise: monitoring rows, duplicated single-step rows, "s ms" | grouped / deduplicated / fixed |
| Grafana error-rate and conflict panels empty (`rate()` misses counters born at 1) | cumulative panels |
| 502s from the proxy keep-alive race | Caddy upstream `keepalive 4s` |
| Report escaping (CodeQL) | backslashes escaped |

## 5. Browser journeys and Web Vitals

_Filled in from `2026-11-26-S-browser-local`._

## 6. Readiness for the VPS

**Offered SUT:** 6 vCPU / 16 GB / 80 GB. A provisional profile `vps-6c16g` is in `perf/config/hardware.md`.

**To confirm in Phase 0:**
1. Are the vCPUs dedicated?
2. Disk type.
3. Is there a second VPS for the generator? The plan's default is a generator VPS in the same datacenter. A laptop generator is a fallback whose numbers include internet RTT.
4. Disk ≥ 200 GB if tier M is in scope (P1-3).

**Recommended before the VPS rounds:**
- Decide on the single-process question (P1-2). Either accept it as "deployment as shipped", or add the replica experiment.
- Optional: a dry run of the remote path (SSH, tunnels, exposure check) on the 8 GB personal VPS with a reduced dataset, not used for comparison.
