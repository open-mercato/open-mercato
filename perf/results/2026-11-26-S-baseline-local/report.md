# Perf report: 2026-11-26-S-baseline-local (local-validation)

## 1. Environment

| Item | Value |
|---|---|
| Run | 2026-11-26-S-baseline-local |
| Scenario / profile | baseline / baseline |
| Tier / dataset | S (anchor 2026-11-26, age 0 d, snapshot S-1263504e-202611260809) |
| Git SHA | 6eeb57c15663b79028476d0dae9fcd94896b5dbe |
| Image | sha256:13b0372a5fcd9e780a26ed9f38e74a3077f906c027a7bc22d947debcbeb6ee7e |
| Migration head | 55e7311bf363f4af (latest Migration20261120120000_auth) |
| Env hash | 6e4f356a568ee55a9baed3b10b071f74fc505cfafe6dc0b7a3a7916602eb68eb |
| Notable overrides | OM_INIT_SUPERADMIN_EMAIL=superadmin@perf.local, TENANT_DATA_ENCRYPTION=true, ENABLE_CRUD_API_CACHE=true, NODE_ENV=production, RATE_LIMIT_LOGIN_IP_POINTS=10000, TELEMETRY_SAMPLING_RATIO=0.01, DB_POOL_MAX=20, DB_POOL_MIN=2, NODE_OPTIONS=--max-old-space-size=3072, WORKER_DB_POOL_MAX=8, WORKER_NODE_OPTIONS=--max-old-space-size=2048, REDIS_MAXMEMORY=512mb, PG_MAX_CONNECTIONS=200, PG_SHARED_BUFFERS=2GB, PG_EFFECTIVE_CACHE_SIZE=6GB, PG_WORK_MEM=16MB, PG_MAINTENANCE_WORK_MEM=512MB |
| Hardware | local-mac nproc=16 kernel=Darwin 27.2.0 dockerCpus=16 dockerMemBytes=17247232000 |
| Generator | laptop-local, RTT p50 5.37 ms / p95 10.19 ms |
| k6 | k6 v1.8.2 (commit/682f083071, go1.26.4, linux/arm64) |
| Window | 2026-11-26T08:20:23.269Z → 2026-11-26T08:31:33.878Z |
| Modules | 75 static (9 env-gated not counted) |

## 2. Summary

> **local-validation** run: a check of the test harness on one laptop (k6, app and monitoring on the same machine). **This is not a performance result for this tier** and does not replace the VPS run; the latencies are distorted by the shared laptop.

- Saturation point: not reached in this run
- Worst endpoints by p95: `heavy.deals.map:page` 9598 ms, `search.list:noHit` 7833 ms, `heavy.encrypted.sort:people.name` 2967 ms
- Error budget: 3520 requests, 0.00% errors, 0.00% optimistic-lock conflicts
- Previous comparable run: none

## 3. Latency per tag

Reference lines (non-failing): read p95 < 500 ms, errors < 1.00%. Warmup excluded. Source: k6 CSV output.

### Load steps

| Step | VUs | Requests | Req/s | Read p95 ms | Errors | Started |
|---|---|---|---|---|---|---|
| baseline | 1 | 3520 | 5.8 | 203 | 0.00% | 2026-11-26T08:21:30.000Z |

### All measured steps

| Tag | Group | Step | Count | p50 ms | p95 ms | p99 ms | Max ms | Errors | Conflicts | Ref |
|---|---|---|---|---|---|---|---|---|---|---|
| companies.list:assignable.staff | read | all | 20 | 71.4 | 204 | 206 | 206 | 0.00% | 0.00% | – |
| companies.list:definitions | read | all | 20 | 77.5 | 108 | 130 | 135 | 0.00% | 0.00% | – |
| companies.list:dictionary.lifecycle-stages | read | all | 20 | 78.3 | 129 | 133 | 134 | 0.00% | 0.00% | – |
| companies.list:dictionary.sources | read | all | 20 | 91.6 | 146 | 154 | 156 | 0.00% | 0.00% | – |
| companies.list:dictionary.statuses | read | all | 20 | 89.7 | 134 | 146 | 149 | 0.00% | 0.00% | – |
| companies.list:list | read | all | 40 | 78.7 | 115 | 182 | 192 | 0.00% | 0.00% | – |
| companies.list:perspectives | read | all | 20 | 61.0 | 138 | 191 | 204 | 0.00% | 0.00% | – |
| company.360:counts | read | all | 20 | 69.9 | 97.5 | 113 | 116 | 0.00% | 0.00% | – |
| company.360:detail | read | all | 20 | 180 | 398 | 405 | 406 | 0.00% | 0.00% | – |
| company.360:dictionary.lifecycle-stages | read | all | 20 | 80.3 | 271 | 295 | 301 | 0.00% | 0.00% | – |
| company.360:dictionary.sources | read | all | 20 | 83.7 | 273 | 302 | 309 | 0.00% | 0.00% | – |
| company.360:dictionary.statuses | read | all | 20 | 81.4 | 235 | 269 | 278 | 0.00% | 0.00% | – |
| company.360:people | read | all | 20 | 101 | 270 | 309 | 319 | 0.00% | 0.00% | – |
| company.360:planned | read | all | 20 | 87.4 | 140 | 159 | 164 | 0.00% | 0.00% | – |
| company.360:roles | read | all | 20 | 86.4 | 131 | 151 | 157 | 0.00% | 0.00% | – |
| company.360:tab.addresses | read | all | 20 | 92.2 | 148 | 150 | 150 | 0.00% | 0.00% | – |
| company.360:tab.changelog | read | all | 20 | 69.7 | 115 | 127 | 130 | 0.00% | 0.00% | – |
| company.360:tab.customer_accounts | read | all | 20 | 47.2 | 53.0 | 53.4 | 53.5 | 0.00% | 0.00% | – |
| company.360:tab.customer_groups | read | all | 20 | 91.7 | 134 | 147 | 150 | 0.00% | 0.00% | – |
| company.360:tab.deals | read | all | 20 | 132 | 152 | 174 | 179 | 0.00% | 0.00% | – |
| company.360:tab.eudr | read | all | 20 | 42.1 | 50.1 | 53.2 | 54.0 | 0.00% | 0.00% | – |
| company.360:tab.files | read | all | 20 | 64.5 | 111 | 125 | 129 | 0.00% | 0.00% | – |
| company.360:tab.tasks | read | all | 20 | 73.8 | 135 | 152 | 156 | 0.00% | 0.00% | – |
| company.360:tab.warranty_claims | read | all | 20 | 57.4 | 64.4 | 66.4 | 66.9 | 0.00% | 0.00% | – |
| company.360:timeline | read | all | 20 | 85.1 | 119 | 126 | 128 | 0.00% | 0.00% | – |
| company.360:timeline.page | read | all | 1 | 27.8 | 27.8 | 27.8 | 27.8 | 0.00% | 0.00% | – |
| dashboard:layout | read | all | 20 | 83.8 | 97.8 | 99.4 | 99.8 | 0.00% | 0.00% | – |
| dashboard:widget.customer-todos | read | all | 20 | 119 | 131 | 133 | 133 | 0.00% | 0.00% | – |
| dashboard:widget.new-customers | read | all | 20 | 83.7 | 94.8 | 98.3 | 99.2 | 0.00% | 0.00% | – |
| dashboard:widget.new-deals | read | all | 20 | 69.4 | 78.1 | 83.0 | 84.2 | 0.00% | 0.00% | – |
| dashboard:widget.next-interactions | read | all | 20 | 62.2 | 71.6 | 73.1 | 73.5 | 0.00% | 0.00% | – |
| deal.detail:comments | read | all | 20 | 79.1 | 172 | 218 | 229 | 0.00% | 0.00% | – |
| deal.detail:companies | read | all | 20 | 77.7 | 165 | 210 | 222 | 0.00% | 0.00% | – |
| deal.detail:detail | read | all | 20 | 136 | 279 | 316 | 325 | 0.00% | 0.00% | – |
| deal.detail:interactions | read | all | 20 | 19.2 | 39.2 | 39.2 | 39.2 | 0.00% | 0.00% | – |
| deal.detail:people | read | all | 20 | 76.9 | 172 | 229 | 243 | 0.00% | 0.00% | – |
| deal.detail:planned | read | all | 20 | 105 | 228 | 263 | 272 | 0.00% | 0.00% | – |
| deals.list:definitions | read | all | 20 | 63.4 | 78.9 | 80.6 | 81.0 | 0.00% | 0.00% | – |
| deals.list:list | read | all | 40 | 104 | 147 | 154 | 158 | 0.00% | 0.00% | – |
| deals.list:perspectives | read | all | 20 | 64.8 | 78.8 | 80.7 | 81.2 | 0.00% | 0.00% | – |
| deals.list:pipelines | read | all | 20 | 62.4 | 70.2 | 73.6 | 74.4 | 0.00% | 0.00% | – |
| deals.list:summary | read | all | 20 | 252 | 271 | 275 | 276 | 0.00% | 0.00% | – |
| deals.pipeline:aggregate | read | all | 20 | 28.2 | 36.5 | 38.6 | 39.1 | 0.00% | 0.00% | – |
| deals.pipeline:companies | read | all | 20 | 109 | 158 | 171 | 174 | 0.00% | 0.00% | – |
| deals.pipeline:dictionary.currency | read | all | 20 | 92.8 | 127 | 135 | 137 | 0.00% | 0.00% | – |
| deals.pipeline:lane | read | all | 160 | 74.1 | 144 | 241 | 242 | 0.00% | 0.00% | – |
| deals.pipeline:pipelines | read | all | 20 | 57.2 | 89.5 | 95.0 | 96.4 | 0.00% | 0.00% | – |
| deals.pipeline:stages | read | all | 20 | 25.7 | 31.7 | 32.8 | 33.1 | 0.00% | 0.00% | – |
| heavy.bulk.owner:post.100 | heavy | all | 20 | 28.8 | 68.2 | 158 | 181 | 0.00% | 0.00% | – |
| heavy.calendar.month:page | heavy | all | 100 | 104 | 114 | 124 | 127 | 0.00% | 0.00% | – |
| heavy.deals.map:page | heavy | all | 100 | 8809 | 9598 | 9696 | 9698 | 0.00% | 0.00% | – |
| heavy.deals.summary:needsAttention | heavy | all | 20 | 219 | 262 | 300 | 309 | 0.00% | 0.00% | – |
| heavy.deals.summary:stuck | heavy | all | 20 | 233 | 300 | 310 | 313 | 0.00% | 0.00% | – |
| heavy.deals.summary:summary | heavy | all | 20 | 261 | 318 | 338 | 343 | 0.00% | 0.00% | – |
| heavy.encrypted.sort:companies.name | heavy | all | 20 | 27.1 | 31.6 | 32.1 | 32.2 | 0.00% | 0.00% | – |
| heavy.encrypted.sort:deals.title | heavy | all | 20 | 1485 | 1556 | 1578 | 1583 | 0.00% | 0.00% | – |
| heavy.encrypted.sort:people.name | heavy | all | 20 | 2670 | 2967 | 2981 | 2985 | 0.00% | 0.00% | – |
| heavy.encrypted.sort:people.primaryEmail | heavy | all | 20 | 2605 | 2754 | 2793 | 2803 | 0.00% | 0.00% | – |
| login:login | auth | all | 20 | 74.5 | 97.1 | 198 | 223 | 0.00% | 0.00% | – |
| people.list:assignable.staff | read | all | 20 | 103 | 122 | 208 | 229 | 0.00% | 0.00% | – |
| people.list:definitions | read | all | 20 | 78.9 | 101 | 117 | 121 | 0.00% | 0.00% | – |
| people.list:dictionary.lifecycle-stages | read | all | 20 | 93.3 | 114 | 163 | 175 | 0.00% | 0.00% | – |
| people.list:dictionary.sources | read | all | 20 | 92.5 | 113 | 122 | 124 | 0.00% | 0.00% | – |
| people.list:dictionary.statuses | read | all | 20 | 89.9 | 124 | 125 | 126 | 0.00% | 0.00% | – |
| people.list:list | read | all | 40 | 111 | 179 | 237 | 274 | 0.00% | 0.00% | – |
| people.list:perspectives | read | all | 20 | 81.8 | 104 | 204 | 229 | 0.00% | 0.00% | – |
| person.360:counts | read | all | 20 | 52.8 | 77.7 | 205 | 237 | 0.00% | 0.00% | – |
| person.360:detail | read | all | 20 | 149 | 351 | 358 | 360 | 0.00% | 0.00% | – |
| person.360:dictionary.lifecycle-stages | read | all | 20 | 77.4 | 95.2 | 146 | 159 | 0.00% | 0.00% | – |
| person.360:dictionary.sources | read | all | 20 | 77.0 | 98.5 | 156 | 171 | 0.00% | 0.00% | – |
| person.360:dictionary.statuses | read | all | 20 | 79.1 | 100 | 169 | 187 | 0.00% | 0.00% | – |
| person.360:planned | read | all | 20 | 64.8 | 117 | 234 | 263 | 0.00% | 0.00% | – |
| person.360:roles | read | all | 20 | 77.3 | 114 | 218 | 244 | 0.00% | 0.00% | – |
| person.360:tab.addresses | read | all | 20 | 101 | 126 | 137 | 140 | 0.00% | 0.00% | – |
| person.360:tab.changelog | read | all | 20 | 75.9 | 98.5 | 101 | 101 | 0.00% | 0.00% | – |
| person.360:tab.companies | read | all | 20 | 94.2 | 111 | 132 | 137 | 0.00% | 0.00% | – |
| person.360:tab.customer_accounts | read | all | 20 | 42.0 | 85.9 | 171 | 192 | 0.00% | 0.00% | – |
| person.360:tab.customer_groups | read | all | 20 | 61.1 | 121 | 197 | 217 | 0.00% | 0.00% | – |
| person.360:tab.deals | read | all | 20 | 99.1 | 153 | 247 | 271 | 0.00% | 0.00% | – |
| person.360:tab.files | read | all | 20 | 68.3 | 80.7 | 88.5 | 90.4 | 0.00% | 0.00% | – |
| person.360:tab.tasks | read | all | 20 | 85.0 | 118 | 124 | 125 | 0.00% | 0.00% | – |
| person.360:tab.warranty_claims | read | all | 20 | 54.4 | 111 | 190 | 210 | 0.00% | 0.00% | – |
| person.360:timeline | read | all | 20 | 63.9 | 143 | 270 | 301 | 0.00% | 0.00% | – |
| person.360:timeline.page | read | all | 1 | 56.5 | 56.5 | 56.5 | 56.5 | 0.00% | 0.00% | – |
| search.global:query | read | all | 20 | 117 | 249 | 673 | 779 | 0.00% | 0.00% | – |
| search.list:common | read | all | 20 | 86.9 | 282 | 863 | 1008 | 0.00% | 0.00% | – |
| search.list:noHit | read | all | 20 | 7072 | 7833 | 7865 | 7873 | 0.00% | 0.00% | over ref |
| search.list:prefix | read | all | 20 | 75.1 | 160 | 188 | 196 | 0.00% | 0.00% | – |
| search.list:unique | read | all | 20 | 36.9 | 110 | 177 | 194 | 0.00% | 0.00% | – |
| shell:ai.actions | shell | all | 160 | 75.7 | 110 | 238 | 262 | 0.00% | 0.00% | – |
| shell:feature.check | shell | all | 160 | 52.9 | 72.7 | 199 | 209 | 0.00% | 0.00% | – |
| shell:messages.unread | shell | all | 160 | 56.6 | 95.6 | 202 | 233 | 0.00% | 0.00% | – |
| shell:notifications | shell | all | 160 | 69.9 | 116 | 228 | 271 | 0.00% | 0.00% | – |
| shell:notifications.unread | shell | all | 160 | 70.0 | 126 | 223 | 269 | 0.00% | 0.00% | – |
| shell:organization.switcher | shell | all | 160 | 57.2 | 105 | 198 | 224 | 0.00% | 0.00% | – |
| shell:progress.active | shell | all | 160 | 91.7 | 150 | 244 | 290 | 0.00% | 0.00% | – |
| write.deal.comment:create | write | all | 20 | 28.3 | 46.8 | 49.5 | 50.2 | 0.00% | 0.00% | – |
| write.deal.comment:detail | write | all | 20 | 63.5 | 75.2 | 77.6 | 78.2 | 0.00% | 0.00% | – |
| write.deal.create:create | write | all | 20 | 39.5 | 51.4 | 66.8 | 70.7 | 0.00% | 0.00% | – |
| write.deal.stage:detail | write | all | 20 | 66.0 | 84.8 | 85.0 | 85.1 | 0.00% | 0.00% | – |
| write.deal.stage:update | write | all | 20 | 50.9 | 66.7 | 66.8 | 66.9 | 0.00% | 0.00% | – |
| write.interaction:create | write | all | 20 | 51.2 | 70.1 | 79.8 | 82.3 | 0.00% | 0.00% | – |
| write.interaction:timeline | write | all | 20 | 27.8 | 56.2 | 58.9 | 59.5 | 0.00% | 0.00% | – |
| write.person.create:address | write | all | 20 | 29.4 | 42.2 | 45.0 | 45.7 | 0.00% | 0.00% | – |
| write.person.create:create | write | all | 20 | 42.5 | 48.3 | 49.3 | 49.6 | 0.00% | 0.00% | – |
| write.person.edit:detail | write | all | 20 | 37.5 | 69.4 | 73.4 | 74.4 | 0.00% | 0.00% | – |
| write.person.edit:update | write | all | 20 | 78.7 | 106 | 113 | 115 | 0.00% | 0.00% | – |
| write.tag.assign:assign | write | all | 20 | 27.6 | 35.8 | 38.0 | 38.5 | 0.00% | 0.00% | – |
| write.task.complete:complete | write | all | 20 | 35.4 | 41.6 | 45.3 | 46.3 | 0.00% | 0.00% | – |
| write.task.complete:create | write | all | 18 | 33.6 | 48.3 | 85.1 | 94.3 | 0.00% | 0.00% | – |
| write.task.complete:tasks | write | all | 20 | 18.5 | 25.5 | 30.2 | 31.4 | 0.00% | 0.00% | – |

## 4. Journeys and Web Vitals

| Journey | Count | p50 ms | p95 ms | Max ms |
|---|---|---|---|---|
| people.list | 20 | 304 | 450 | 464 |
| person.360 | 20 | 349 | 607 | 613 |
| companies.list | 20 | 239 | 400 | 409 |
| company.360 | 20 | 369 | 590 | 595 |
| deals.pipeline | 20 | 546 | 757 | 825 |
| deals.list | 20 | 386 | 409 | 417 |
| dashboard | 20 | 193 | 210 | 228 |
| search.list | 20 | 7353 | 8259 | 8603 |
| search.global | 20 | 117 | 250 | 779 |
| write.interaction | 20 | 80.5 | 111 | 120 |
| write.person.edit | 20 | 117 | 160 | 162 |
| write.deal.stage | 20 | 118 | 140 | 152 |
| write.person.create | 20 | 74.0 | 82.7 | 96.0 |
| write.deal.create | 20 | 39.5 | 52.0 | 71.0 |
| write.task.complete | 20 | 86.5 | 107 | 173 |
| write.deal.comment | 20 | 93.0 | 111 | 111 |
| write.tag.assign | 20 | 28.0 | 36.2 | 39.0 |
| heavy.deals.summary | 20 | 262 | 319 | 344 |
| heavy.encrypted.sort | 20 | 6801 | 7271 | 7320 |
| heavy.calendar.month | 20 | 532 | 569 | 576 |
| heavy.deals.map | 20 | 11.5 s | 12.1 s | 12.2 s |
| heavy.bulk.owner | 20 | 30.0 | 69.0 | 182 |

Reference: LCP < 2500 ms, INP < 200 ms, CLS < 0.1.

_No data._

## 5. Resources by window

| Metric | Series | Window | Avg | Peak |
|---|---|---|---|---|
| CPU cores | app | run | 0.79 | 0.94 |
| CPU cores | meilisearch | run | 0.16 | 0.23 |
| CPU cores | monitoring (sum) | run | 0.04 | 0.08 |
| CPU cores | postgres | run | 0.44 | 0.69 |
| CPU cores | redis | run | 0.01 | 0.01 |
| CPU cores | tls | run | 0.00 | 0.00 |
| CPU cores | worker | run | 0.15 | 0.26 |
| Working set | app | run | 1.8 GiB | 2.6 GiB |
| Working set | meilisearch | run | 739.4 MiB | 805.8 MiB |
| Working set | monitoring (sum) | run | 1.3 GiB | 1.3 GiB |
| Working set | postgres | run | 2.3 GiB | 2.4 GiB |
| Working set | redis | run | 22.9 MiB | 24.2 MiB |
| Working set | scheduler | run | 6.7 MiB | 6.7 MiB |
| Working set | tls | run | 53.1 MiB | 56.3 MiB |
| Working set | worker | run | 923.1 MiB | 980.0 MiB |
| DB pool used | om-app | run | 0 | 0 |
| DB pool used | om-worker | run | 0 | 0 |
| DB pool pending | om-app | run | 0 | 0 |
| DB pool pending | om-worker | run | 0 | 0 |
| DB pool wait p95 | om-app | run | 182 ms | 683 ms |
| DB pool wait p95 | om-scheduler | run | 4.8 ms | 4.8 ms |
| DB pool wait p95 | om-worker | run | 1.0 ms | 1.0 ms |
| Event loop utilization | om-app | run | 42.6% | 74.5% |
| Event loop utilization | om-worker | run | 30.2% | 38.2% |
| Event loop delay p99 | om-app | run | 110 ms | 514 ms |
| Event loop delay p99 | om-worker | run | 25.1 ms | 25.6 ms |
| V8 heap used | om-app | run | 883.7 MiB | 1.5 GiB |
| V8 heap used | om-worker | run | 376.5 MiB | 432.5 MiB |
| BullMQ active | total | run | 1.4 | 2 |
| Redis memory | total | run | 6.9 MiB | 8.4 MiB |
| Postgres backends | total | run | 17.0 | 25 |
| Postgres cache hit | total | run | 99.4% | 100.0% |
| Disk busy | total | run | 4.3% | 6.2% |
| CPU steal | total | run | 0.0% | 0.0% |
| Server-side p95 (Caddy) | total | run | 1473 ms | 4094 ms |

## 6. Database

- Cache hit ratio: 99.74%; temp files: 1 (15.1 MiB); deadlocks: 0; lock waits logged: 0; slow statements (> 500 ms) logged: 53
- Connections at capture: idle=13, active=1 (max_connections 200)

### Top statements by total time

| queryid | Calls | Total ms | Mean ms | Rows | Calls/req | Statement |
|---|---|---|---|---|---|---|
| -7658084786845483524 | 12 | 45.2 s | 3770 | 12 | – | `select count(*) as "count" from (select $107 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."dele` |
| -799267487938736476 | 10 | 41.4 s | 4144 | 10 | – | `select count(*) as "count" from (select $117 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."dele` |
| 3914069155369902734 | 12 | 38.1 s | 3178 | 0 | – | `select "b"."id" as "id", "b"."display_name" as "display_name", "b"."description" as "description", "b"."owner_user_id" as "owner_user_id", "b"."primary_email" a` |
| -6084591751651921644 | 10 | 35.8 s | 3577 | 0 | – | `select "b"."id" as "id", "b"."display_name" as "display_name", "b"."description" as "description", "b"."owner_user_id" as "owner_user_id", "b"."primary_email" a` |
| 616253865520972456 | 110 | 11.9 s | 109 | 1564090 | – | `select "c0"."id", "c0"."entity_id" from "customer_addresses" as "c0" where "c0"."latitude" is not null and "c0"."longitude" is not null and "c0"."tenant_id" = $` |
| 6141459673647058178 | 110 | 9874 | 89.8 | 1507000 | – | `select "c0"."id", "c0"."deal_id" from "customer_deal_companies" as "c0" where "c0"."company_entity_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $1` |
| 3037293489916930624 | 110 | 3251 | 29.6 | 374 | – | `select "deal_id", count(*) as "count" from "customer_interactions" where "deal_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $1` |
| -23224490264822389 | 88 | 2983 | 33.9 | 8888 | – | `select "id", "entity_id", "deal_id", "interaction_type", "title", "body", "status", "scheduled_at", "occurred_at", "priority", "author_user_id", "owner_user_id"` |
| -5068238819091377900 | 110 | 2799 | 25.4 | 363220 | – | `select "c0"."id", "c0"."deal_id" from "customer_deal_people" as "c0" where "c0"."person_entity_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $` |
| -29729472750234842 | 77 | 1843 | 23.9 | 14 | – | `select "deal_id", count(*) as "count" from "customer_interactions" where "deal_id" in ($1) and "organization_id" = $2 and "tenant_id" = $3 and "deleted_at" is n` |

### Top statements by mean time (calls >= 5)

| queryid | Calls | Total ms | Mean ms | Rows | Calls/req | Statement |
|---|---|---|---|---|---|---|
| -799267487938736476 | 10 | 41.4 s | 4144 | 10 | – | `select count(*) as "count" from (select $117 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."dele` |
| -7658084786845483524 | 12 | 45.2 s | 3770 | 12 | – | `select count(*) as "count" from (select $107 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."dele` |
| -6084591751651921644 | 10 | 35.8 s | 3577 | 0 | – | `select "b"."id" as "id", "b"."display_name" as "display_name", "b"."description" as "description", "b"."owner_user_id" as "owner_user_id", "b"."primary_email" a` |
| 3914069155369902734 | 12 | 38.1 s | 3178 | 0 | – | `select "b"."id" as "id", "b"."display_name" as "display_name", "b"."description" as "description", "b"."owner_user_id" as "owner_user_id", "b"."primary_email" a` |
| -4505896698322519283 | 5 | 1349 | 270 | 2695 | – | `select "entity_id" from "search_tokens" where "entity_type" = $1 and "token_hash" in ($2, $3, $4) and "field" in ($5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $` |
| 616253865520972456 | 110 | 11.9 s | 109 | 1564090 | – | `select "c0"."id", "c0"."entity_id" from "customer_addresses" as "c0" where "c0"."latitude" is not null and "c0"."longitude" is not null and "c0"."tenant_id" = $` |
| 6141459673647058178 | 110 | 9874 | 89.8 | 1507000 | – | `select "c0"."id", "c0"."deal_id" from "customer_deal_companies" as "c0" where "c0"."company_entity_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $1` |
| 25789684004546580 | 22 | 1618 | 73.6 | 825253 | – | `select "b"."id" as "id", "b"."tenant_id" as "tenant_id", "b"."organization_id" as "organization_id", "b"."display_name" as "display_name" from "customer_entitie` |
| -8443961795080402671 | 22 | 1381 | 62.8 | 825253 | – | `select "b"."id" as "id", "b"."tenant_id" as "tenant_id", "b"."organization_id" as "organization_id", "b"."primary_email" as "primary_email" from "customer_entit` |
| 8652475631258937768 | 11 | 602 | 54.8 | 110 | – | `select "entity_type", "entity_id", "organization_id", count(*) as "match_count" from "search_tokens" where "token_hash" in ($1, $2) and ("search_tokens"."entity` |

### Plans

<details><summary>auto_explain 4291 ms at 2026-11-26 08:26:40.397 UTC</summary>

```
	Query Text: select count(*) as "count" from (select 1 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."deleted_at" is null and "b"."kind" = $3 and exists (select 1 as "one" from (select 1) as "om_count_seed" left join "entity_indexes" as "ei" on "ei"."entity_type" = $4 and "ei"."entity_id" = ("b"."id"::text) and "ei"."organization_id" = "b"."organization_id" and "ei"."organization_id" is not null and "ei"."tenant_id" = "b"."tenant_id" and "ei"."tenant_id" is not null and "ei"."deleted_at" is null left join "customer_people" as "person_profile" on "person_profile"."entity_id" = "b"."id" left join "entity_indexes" as "ei_person_profile" on "ei_person_profile"."entity_type" = $5 and "ei_person_profile"."entity_id" = ("person_profile"."id"::text) and "ei_person_profile"."organization_id" = "b"."organization_id" and "ei_person_profile"."organization_id" is not null and "ei_person_profile"."tenant_id" = "b"."tenant_id" and "ei_person_profile"."tenant_id" is not null and "ei_person_profile"."deleted_at" is null where ((exists (select 1 as "one" from "search_tokens" as "st_0" where "st_0"."entity_type" = $6 and "st_0"."field" = $7 and "st_0"."entity_id" = "b"."id"::text and "st_0"."token_hash" in ($8, $9, $10, $11, $12, $13) and "st_0"."tenant_id" is not distinct from $14 and "st_0"."organization_id" in ($15) group by "st_0"."entity_id", "st_0"."field" having count(distinct "st_0"."token_hash") >= $16) or exists (select 1 as "one" from "search_tokens" as "st_1" where "st_1"."entity_type" = $17 and "st_1"."field" = $18 and "st_1"."entity_id" = "person_profile"."id"::text and "st_1"."token_hash" in ($19, $20, $21, $22, $23, $24) and "st_1"."tenant_id" is not distinct from $25 and "st_1"."organization_id" in ($26) group by "st_1"."entity_id", "st_1"."field" having count(distinct "st_1"."token_hash") >= $27)) or (exists (select 1 as "one" from "search_tokens" as "st_2" where "st_2"."entity_type" = $28 and "st_2"."field" = $29 and "st_2"."entity_id" = "b"."id"::text and "st_2"."token_hash" in ($30, $31, $32, $33, $34, $35) and "st_2"."tenant_id" is not distinct from $36 and "st_2"."organization_id" in ($37) group by "st_2"."entity_id", "st_2"."field" having count(distinct "st_2"."token_hash") >= $38) or exists (select 1 as "one" from "search_tokens" as "st_3" where "st_3"."entity_type" = $39 and "st_3"."field" = $40 and "st_3"."entity_id" = "person_profile"."id"::text and "st_3"."token_hash" in ($41, $42, $43, $44, $45, $46) and "st_3"."tenant_id" is not distinct from $47 and "st_3"."organization_id" in ($48) group by "st_3"."entity_id", "st_3"."field" having count(distinct "st_3"."token_hash") >= $49)) or (exists (select 1 as "one" from "search_tokens" as "st_4" where "st_4"."entity_type" = $50 and "st_4"."field" = $51 and "st_4"."entity_id" = "b"."id"::text and "st_4"."token_hash" in ($52, $53, $54, $55, $56, $57) and "st_4"."tenant_id" is not distinct from $58 and "st_4"."organization_id" in ($59) group by "st_4"."entity_id", "st_4"."field" having count(distinct "st_4"."token_hash") >= $60) or exists (select 1 as "one" from "search_tokens" as "st_5" where "st_5"."entity_type" = $61 and "st_5"."field" = $62 and "st_5"."entity_id" = "person_profile"."id"::text and "st_5"."token_hash" in ($63, $64, $65, $66, $67, $68) and "st_5"."tenant_id" is not distinct from $69 and "st_5"."organization_id" in ($70) group by "st_5"."entity_id", "st_5"."field" having count(distinct "st_5"."token_hash") >= $71)) or (exists (select 1 as "one" from "search_tokens" as "st_6" where "st_6"."entity_type" = $72 and "st_6"."field" = $73 and "st_6"."entity_id" = "b"."id"::text and "st_6"."token_hash" in ($74, $75, $76, $77, $78, $79) and "st_6"."tenant_id" is not distinct from $80 and "st_6"."organization_id" in ($81) group by "st_6"."entity_id", "st_6"."field" having count(distinct "st_6"."token_hash") >= $82) or exists (select 1 as "one" from "search_tokens" as "st_7" where "st_7"."entity_type" = $83 and "st_7"."field" = $84 and "st_7"."entity_id" = "person_profile"."id"::text and "st_7"."token_hash" in ($85, $86, $87, $88, $89, $90) and "st_7"."tenant_id" is not distinct from $91 and "st_7"."organization_id" in ($92) group by "st_7"."entity_id", "st_7"."field" having count(distinct "st_7"."token_hash") >= $93)) or (exists (select 1 as "one" from "search_tokens" as "st_8" where "st_8"."entity_type" = $94 and "st_8"."field" = $95 and "st_8"."entity_id" = "b"."id"::text and "st_8"."token_hash" in ($96, $97, $98, $99, $100, $101) and "st_8"."tenant_id" is not distinct from $102 and "st_8"."organization_id" in ($103) group by "st_8"."entity_id", "st_8"."field" having count(distinct "st_8"."token_hash") >= $104) or exists (select 1 as "one" from "search_tokens" as "st_9" where "st_9"."entity_type" = $105 and "st_9"."field" = $106 and "st_9"."entity_id" = "person_profile"."id"::text and "st_9"."token_hash" in ($107, $108, $109, $110, $111, $112) and "st_9"."tenant_id" is not distinct from $113 and "st_9"."organization_id" in ($114) group by "st_9"."entity_id", "st_9"."field" having count(distinct "st_9"."token_hash") >= $115)))) limit $116) as "om_count_probe"
	Aggregate  (cost=7161621.12..7161621.13 rows=1 width=8) (actual time=4291.325..4291.328 rows=1 loops=1)
	  Buffers: shared hit=5443658
	  ->  Limit  (cost=0.29..7161496.11 rows=10001 width=4) (actual time=4291.298..4291.301 rows=0 loops=1)
	        Buffers: shared hit=5443658
	        ->  Index Scan using customer_entities_org_tenant_kind_idx on customer_entities b  (cost=0.29..12183350.94 rows=17014 width=4) (actual time=3777.560..3777.563 rows=0 loops=1)
	              Index Cond: ((organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (tenant_id = '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid) AND (kind = 'person'::text))
	              Filter: ((deleted_at IS NULL) AND EXISTS(SubPlan 11))
	              Rows Removed by Filter: 37512
	              Buffers: shared hit=5443658
	              SubPlan 11
	                ->  Nested Loop Left Join  (cost=15.14..357.92 rows=1 width=0) (actual time=0.100..0.100 rows=0 loops=37512)
	                      Buffers: shared hit=5440202
	                      InitPlan 1
	                        ->  GroupAggregate  (cost=2.81..2.83 rows=1 width=51) (actual time=0.005..0.005 rows=0 loops=37512)
	                              Filter: (count(DISTINCT st_0.token_hash) >= '6'::bigint)
	                              Buffers: shared hit=150235
	                              ->  Sort  (cost=2.81..2.81 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37512)
	                                    Sort Key: st_0.token_hash
	                                    Sort Method: quicksort  Memory: 25kB
	                                    Buffers: shared hit=150235
	                                    ->  Index Scan using search_tokens_entity_idx on search_tokens st_0  (cost=0.56..2.80 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37512)
	                                          Index Cond: ((entity_type = 'customers:customer_entity'::text) AND (entity_id = (b.id)::text))
	                                          Filter: ((NOT (tenant_id IS DISTINCT FROM '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid)) AND (field = 'display_name'::text) AND (organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (token_hash = ANY ('{3aec2d2306c02daa9ca3741e9c2260c0db6f137a0952702bd1f78d59e818c883,ef8f319fef57ebb52d26b00c547fd9069664c4cb093b2d6a269d81e241389b50,843255866f2be5e95f3662df01e6d2a5ef5e6f424b3ec5c95af3ffec100c1c0d,ac6f450a4d0e307531334a61bfa6047936e98cef4157e49d271f4c8f5119d19d,f8983db0b320da5eeae49839c81b796b53bc61d69ccdf77f7f1adad0847036a0,e0a226420834224a28fa22e06b06b415e0aca072d996411b9776569db1160d6f}'::text[])))
	                                          Rows Removed by Filter: 0
	                                          Buffers: shared hit=150235
	                      InitPlan 3
	                        
…(truncated)
```
</details>

<details><summary>auto_explain 4218 ms at 2026-11-26 08:21:05.924 UTC</summary>

```
	Query Text: select count(*) as "count" from (select 1 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."deleted_at" is null and "b"."kind" = $3 and exists (select 1 as "one" from (select 1) as "om_count_seed" left join "entity_indexes" as "ei" on "ei"."entity_type" = $4 and "ei"."entity_id" = ("b"."id"::text) and "ei"."organization_id" = "b"."organization_id" and "ei"."organization_id" is not null and "ei"."tenant_id" = "b"."tenant_id" and "ei"."tenant_id" is not null and "ei"."deleted_at" is null left join "customer_people" as "person_profile" on "person_profile"."entity_id" = "b"."id" left join "entity_indexes" as "ei_person_profile" on "ei_person_profile"."entity_type" = $5 and "ei_person_profile"."entity_id" = ("person_profile"."id"::text) and "ei_person_profile"."organization_id" = "b"."organization_id" and "ei_person_profile"."organization_id" is not null and "ei_person_profile"."tenant_id" = "b"."tenant_id" and "ei_person_profile"."tenant_id" is not null and "ei_person_profile"."deleted_at" is null where ((exists (select 1 as "one" from "search_tokens" as "st_0" where "st_0"."entity_type" = $6 and "st_0"."field" = $7 and "st_0"."entity_id" = "b"."id"::text and "st_0"."token_hash" in ($8, $9, $10, $11, $12, $13) and "st_0"."tenant_id" is not distinct from $14 and "st_0"."organization_id" in ($15) group by "st_0"."entity_id", "st_0"."field" having count(distinct "st_0"."token_hash") >= $16) or exists (select 1 as "one" from "search_tokens" as "st_1" where "st_1"."entity_type" = $17 and "st_1"."field" = $18 and "st_1"."entity_id" = "person_profile"."id"::text and "st_1"."token_hash" in ($19, $20, $21, $22, $23, $24) and "st_1"."tenant_id" is not distinct from $25 and "st_1"."organization_id" in ($26) group by "st_1"."entity_id", "st_1"."field" having count(distinct "st_1"."token_hash") >= $27)) or (exists (select 1 as "one" from "search_tokens" as "st_2" where "st_2"."entity_type" = $28 and "st_2"."field" = $29 and "st_2"."entity_id" = "b"."id"::text and "st_2"."token_hash" in ($30, $31, $32, $33, $34, $35) and "st_2"."tenant_id" is not distinct from $36 and "st_2"."organization_id" in ($37) group by "st_2"."entity_id", "st_2"."field" having count(distinct "st_2"."token_hash") >= $38) or exists (select 1 as "one" from "search_tokens" as "st_3" where "st_3"."entity_type" = $39 and "st_3"."field" = $40 and "st_3"."entity_id" = "person_profile"."id"::text and "st_3"."token_hash" in ($41, $42, $43, $44, $45, $46) and "st_3"."tenant_id" is not distinct from $47 and "st_3"."organization_id" in ($48) group by "st_3"."entity_id", "st_3"."field" having count(distinct "st_3"."token_hash") >= $49)) or (exists (select 1 as "one" from "search_tokens" as "st_4" where "st_4"."entity_type" = $50 and "st_4"."field" = $51 and "st_4"."entity_id" = "b"."id"::text and "st_4"."token_hash" in ($52, $53, $54, $55, $56, $57) and "st_4"."tenant_id" is not distinct from $58 and "st_4"."organization_id" in ($59) group by "st_4"."entity_id", "st_4"."field" having count(distinct "st_4"."token_hash") >= $60) or exists (select 1 as "one" from "search_tokens" as "st_5" where "st_5"."entity_type" = $61 and "st_5"."field" = $62 and "st_5"."entity_id" = "person_profile"."id"::text and "st_5"."token_hash" in ($63, $64, $65, $66, $67, $68) and "st_5"."tenant_id" is not distinct from $69 and "st_5"."organization_id" in ($70) group by "st_5"."entity_id", "st_5"."field" having count(distinct "st_5"."token_hash") >= $71)) or (exists (select 1 as "one" from "search_tokens" as "st_6" where "st_6"."entity_type" = $72 and "st_6"."field" = $73 and "st_6"."entity_id" = "b"."id"::text and "st_6"."token_hash" in ($74, $75, $76, $77, $78, $79) and "st_6"."tenant_id" is not distinct from $80 and "st_6"."organization_id" in ($81) group by "st_6"."entity_id", "st_6"."field" having count(distinct "st_6"."token_hash") >= $82) or exists (select 1 as "one" from "search_tokens" as "st_7" where "st_7"."entity_type" = $83 and "st_7"."field" = $84 and "st_7"."entity_id" = "person_profile"."id"::text and "st_7"."token_hash" in ($85, $86, $87, $88, $89, $90) and "st_7"."tenant_id" is not distinct from $91 and "st_7"."organization_id" in ($92) group by "st_7"."entity_id", "st_7"."field" having count(distinct "st_7"."token_hash") >= $93)) or (exists (select 1 as "one" from "search_tokens" as "st_8" where "st_8"."entity_type" = $94 and "st_8"."field" = $95 and "st_8"."entity_id" = "b"."id"::text and "st_8"."token_hash" in ($96, $97, $98, $99, $100, $101) and "st_8"."tenant_id" is not distinct from $102 and "st_8"."organization_id" in ($103) group by "st_8"."entity_id", "st_8"."field" having count(distinct "st_8"."token_hash") >= $104) or exists (select 1 as "one" from "search_tokens" as "st_9" where "st_9"."entity_type" = $105 and "st_9"."field" = $106 and "st_9"."entity_id" = "person_profile"."id"::text and "st_9"."token_hash" in ($107, $108, $109, $110, $111, $112) and "st_9"."tenant_id" is not distinct from $113 and "st_9"."organization_id" in ($114) group by "st_9"."entity_id", "st_9"."field" having count(distinct "st_9"."token_hash") >= $115)))) limit $116) as "om_count_probe"
	Aggregate  (cost=7158970.22..7158970.23 rows=1 width=8) (actual time=4218.375..4218.379 rows=1 loops=1)
	  Buffers: shared hit=5403768 read=13
	  I/O Timings: shared read=0.457
	  ->  Limit  (cost=0.29..7158845.20 rows=10001 width=4) (actual time=4218.351..4218.354 rows=0 loops=1)
	        Buffers: shared hit=5403768 read=13
	        I/O Timings: shared read=0.457
	        ->  Index Scan using customer_entities_org_tenant_kind_idx on customer_entities b  (cost=0.29..12172398.83 rows=17005 width=4) (actual time=3708.552..3708.555 rows=0 loops=1)
	              Index Cond: ((organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (tenant_id = '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid) AND (kind = 'person'::text))
	              Filter: ((deleted_at IS NULL) AND EXISTS(SubPlan 11))
	              Rows Removed by Filter: 37501
	              Buffers: shared hit=5403768 read=13
	              I/O Timings: shared read=0.457
	              SubPlan 11
	                ->  Nested Loop Left Join  (cost=15.01..357.79 rows=1 width=0) (actual time=0.098..0.098 rows=0 loops=37501)
	                      Buffers: shared hit=5400330 read=13
	                      I/O Timings: shared read=0.457
	                      InitPlan 1
	                        ->  GroupAggregate  (cost=2.81..2.83 rows=1 width=51) (actual time=0.005..0.005 rows=0 loops=37501)
	                              Filter: (count(DISTINCT st_0.token_hash) >= '6'::bigint)
	                              Buffers: shared hit=150043
	                              ->  Sort  (cost=2.81..2.81 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37501)
	                                    Sort Key: st_0.token_hash
	                                    Sort Method: quicksort  Memory: 25kB
	                                    Buffers: shared hit=150043
	                                    ->  Index Scan using search_tokens_entity_idx on search_tokens st_0  (cost=0.56..2.80 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37501)
	                                          Index Cond: ((entity_type = 'customers:customer_entity'::text) AND (entity_id = (b.id)::text))
	                                          Filter: ((NOT (tenant_id IS DISTINCT FROM '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid)) AND (field = 'display_name'::text) AND (organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (token_hash = ANY ('{3aec2d2306c02daa9ca3741e9c2260c0db6f137a0952702bd1f78d59e818c883,ef8f319fef57ebb52d26b00c547fd9069664c4cb093b2d6a269d81e241389b50,843255866f2be5e95f3662df01e6d2a5ef5e6f424b3ec5c95af3ffec100c1c0d,ac6f450a4d0e307531334a61bfa6047936e98cef4157e49d271f4c8f5119d19d,f8983db0b320da5eeae49839c81b796b53bc61d69ccdf77f7f1adad0847036a0,e0a226420834224a28fa22e06b06b415e0aca072d996411b9776569db1160d6f}'::te
…(truncated)
```
</details>

<details><summary>auto_explain 4197 ms at 2026-11-26 08:30:40.789 UTC</summary>

```
	Query Text: select count(*) as "count" from (select 1 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."deleted_at" is null and "b"."kind" = $3 and exists (select 1 as "one" from (select 1) as "om_count_seed" left join "entity_indexes" as "ei" on "ei"."entity_type" = $4 and "ei"."entity_id" = ("b"."id"::text) and "ei"."organization_id" = "b"."organization_id" and "ei"."organization_id" is not null and "ei"."tenant_id" = "b"."tenant_id" and "ei"."tenant_id" is not null and "ei"."deleted_at" is null left join "customer_people" as "person_profile" on "person_profile"."entity_id" = "b"."id" left join "entity_indexes" as "ei_person_profile" on "ei_person_profile"."entity_type" = $5 and "ei_person_profile"."entity_id" = ("person_profile"."id"::text) and "ei_person_profile"."organization_id" = "b"."organization_id" and "ei_person_profile"."organization_id" is not null and "ei_person_profile"."tenant_id" = "b"."tenant_id" and "ei_person_profile"."tenant_id" is not null and "ei_person_profile"."deleted_at" is null where ((exists (select 1 as "one" from "search_tokens" as "st_0" where "st_0"."entity_type" = $6 and "st_0"."field" = $7 and "st_0"."entity_id" = "b"."id"::text and "st_0"."token_hash" in ($8, $9, $10, $11, $12, $13) and "st_0"."tenant_id" is not distinct from $14 and "st_0"."organization_id" in ($15) group by "st_0"."entity_id", "st_0"."field" having count(distinct "st_0"."token_hash") >= $16) or exists (select 1 as "one" from "search_tokens" as "st_1" where "st_1"."entity_type" = $17 and "st_1"."field" = $18 and "st_1"."entity_id" = "person_profile"."id"::text and "st_1"."token_hash" in ($19, $20, $21, $22, $23, $24) and "st_1"."tenant_id" is not distinct from $25 and "st_1"."organization_id" in ($26) group by "st_1"."entity_id", "st_1"."field" having count(distinct "st_1"."token_hash") >= $27)) or (exists (select 1 as "one" from "search_tokens" as "st_2" where "st_2"."entity_type" = $28 and "st_2"."field" = $29 and "st_2"."entity_id" = "b"."id"::text and "st_2"."token_hash" in ($30, $31, $32, $33, $34, $35) and "st_2"."tenant_id" is not distinct from $36 and "st_2"."organization_id" in ($37) group by "st_2"."entity_id", "st_2"."field" having count(distinct "st_2"."token_hash") >= $38) or exists (select 1 as "one" from "search_tokens" as "st_3" where "st_3"."entity_type" = $39 and "st_3"."field" = $40 and "st_3"."entity_id" = "person_profile"."id"::text and "st_3"."token_hash" in ($41, $42, $43, $44, $45, $46) and "st_3"."tenant_id" is not distinct from $47 and "st_3"."organization_id" in ($48) group by "st_3"."entity_id", "st_3"."field" having count(distinct "st_3"."token_hash") >= $49)) or (exists (select 1 as "one" from "search_tokens" as "st_4" where "st_4"."entity_type" = $50 and "st_4"."field" = $51 and "st_4"."entity_id" = "b"."id"::text and "st_4"."token_hash" in ($52, $53, $54, $55, $56, $57) and "st_4"."tenant_id" is not distinct from $58 and "st_4"."organization_id" in ($59) group by "st_4"."entity_id", "st_4"."field" having count(distinct "st_4"."token_hash") >= $60) or exists (select 1 as "one" from "search_tokens" as "st_5" where "st_5"."entity_type" = $61 and "st_5"."field" = $62 and "st_5"."entity_id" = "person_profile"."id"::text and "st_5"."token_hash" in ($63, $64, $65, $66, $67, $68) and "st_5"."tenant_id" is not distinct from $69 and "st_5"."organization_id" in ($70) group by "st_5"."entity_id", "st_5"."field" having count(distinct "st_5"."token_hash") >= $71)) or (exists (select 1 as "one" from "search_tokens" as "st_6" where "st_6"."entity_type" = $72 and "st_6"."field" = $73 and "st_6"."entity_id" = "b"."id"::text and "st_6"."token_hash" in ($74, $75, $76, $77, $78, $79) and "st_6"."tenant_id" is not distinct from $80 and "st_6"."organization_id" in ($81) group by "st_6"."entity_id", "st_6"."field" having count(distinct "st_6"."token_hash") >= $82) or exists (select 1 as "one" from "search_tokens" as "st_7" where "st_7"."entity_type" = $83 and "st_7"."field" = $84 and "st_7"."entity_id" = "person_profile"."id"::text and "st_7"."token_hash" in ($85, $86, $87, $88, $89, $90) and "st_7"."tenant_id" is not distinct from $91 and "st_7"."organization_id" in ($92) group by "st_7"."entity_id", "st_7"."field" having count(distinct "st_7"."token_hash") >= $93)) or (exists (select 1 as "one" from "search_tokens" as "st_8" where "st_8"."entity_type" = $94 and "st_8"."field" = $95 and "st_8"."entity_id" = "b"."id"::text and "st_8"."token_hash" in ($96, $97, $98, $99, $100, $101) and "st_8"."tenant_id" is not distinct from $102 and "st_8"."organization_id" in ($103) group by "st_8"."entity_id", "st_8"."field" having count(distinct "st_8"."token_hash") >= $104) or exists (select 1 as "one" from "search_tokens" as "st_9" where "st_9"."entity_type" = $105 and "st_9"."field" = $106 and "st_9"."entity_id" = "person_profile"."id"::text and "st_9"."token_hash" in ($107, $108, $109, $110, $111, $112) and "st_9"."tenant_id" is not distinct from $113 and "st_9"."organization_id" in ($114) group by "st_9"."entity_id", "st_9"."field" having count(distinct "st_9"."token_hash") >= $115)))) limit $116) as "om_count_probe"
	Aggregate  (cost=7161831.48..7161831.49 rows=1 width=8) (actual time=4196.856..4196.867 rows=1 loops=1)
	  Buffers: shared hit=5295061
	  ->  Limit  (cost=0.29..7161706.47 rows=10001 width=4) (actual time=4196.819..4196.829 rows=0 loops=1)
	        Buffers: shared hit=5295061
	        ->  Index Scan using customer_entities_org_tenant_kind_idx on customer_entities b  (cost=0.29..12190153.70 rows=17023 width=4) (actual time=3698.420..3698.430 rows=0 loops=1)
	              Index Cond: ((organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (tenant_id = '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid) AND (kind = 'person'::text))
	              Filter: ((deleted_at IS NULL) AND EXISTS(SubPlan 11))
	              Rows Removed by Filter: 37520
	              Buffers: shared hit=5295061
	              SubPlan 11
	                ->  Nested Loop Left Join  (cost=15.14..357.92 rows=1 width=0) (actual time=0.098..0.098 rows=0 loops=37520)
	                      Buffers: shared hit=5291596
	                      InitPlan 1
	                        ->  GroupAggregate  (cost=2.81..2.83 rows=1 width=51) (actual time=0.004..0.004 rows=0 loops=37520)
	                              Filter: (count(DISTINCT st_0.token_hash) >= '6'::bigint)
	                              Buffers: shared hit=150327
	                              ->  Sort  (cost=2.81..2.81 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37520)
	                                    Sort Key: st_0.token_hash
	                                    Sort Method: quicksort  Memory: 25kB
	                                    Buffers: shared hit=150327
	                                    ->  Index Scan using search_tokens_entity_idx on search_tokens st_0  (cost=0.56..2.80 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37520)
	                                          Index Cond: ((entity_type = 'customers:customer_entity'::text) AND (entity_id = (b.id)::text))
	                                          Filter: ((NOT (tenant_id IS DISTINCT FROM '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid)) AND (field = 'display_name'::text) AND (organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (token_hash = ANY ('{bf6d4e43f780d5137284bad3061596a6bf79e908997d6a441444661d762e6377,55531d7dcdeb5c2a871f7d0d95fa49190e6e5f207f59bda9bd9178abcabc6791,95d475def03be9df91b662f622efc2038ca9bcfb846e6757d26f43e2b229a729,b809d7351fa0fb2b73eac1216d88f3999e4763ba233a8ceb593934ed922d7317,bc244539642e7b8fd4a45e1257e91a9114cd9b18e19438ea1fccea6ca29af914,39d68503048de27b6a4139c0e842b339e72c2964d25013df14445bd2160dfe2f}'::text[])))
	                                          Rows Removed by Filter: 0
	                                          Buffers: shared hit=150327
	                      InitPlan 3
	                        
…(truncated)
```
</details>

<details><summary>generic plan for queryid -7658084786845483524</summary>

```
Aggregate  (cost=37452.15..37452.16 rows=1 width=8)
  ->  Limit  (cost=0.29..37450.23 rows=153 width=32)
        ->  Index Scan using customer_entities_org_tenant_kind_idx on customer_entities b  (cost=0.29..374499.73 rows=1530 width=32)
              Index Cond: ((organization_id = $1) AND (tenant_id = $2) AND (kind = $3))
              Filter: ((deleted_at IS NULL) AND EXISTS(SubPlan 11))
              SubPlan 11
                ->  Nested Loop Left Join  (cost=58.12..121.81 rows=1 width=0)
                      InitPlan 1
                        ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                              Filter: (count(DISTINCT st_0.token_hash) >= $15)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_0  (cost=0.56..11.38 rows=1 width=112)
                                    Index Cond: ((entity_type = $6) AND (field = $7) AND (token_hash = ANY (ARRAY[$8, $9, $10, $11, $12])) AND (organization_id = $14))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $13)) AND (entity_id = (b.id)::text))
                      InitPlan 3
                        ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                              Filter: (count(DISTINCT st_2.token_hash) >= $35)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_2  (cost=0.56..11.38 rows=1 width=112)
                                    Index Cond: ((entity_type = $26) AND (field = $27) AND (token_hash = ANY (ARRAY[$28, $29, $30, $31, $32])) AND (organization_id = $34))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $33)) AND (entity_id = (b.id)::text))
                      InitPlan 5
                        ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                              Filter: (count(DISTINCT st_4.token_hash) >= $55)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_4  (cost=0.56..11.38 rows=1 width=112)
                                    Index Cond: ((entity_type = $46) AND (field = $47) AND (token_hash = ANY (ARRAY[$48, $49, $50, $51, $52])) AND (organization_id = $54))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $53)) AND (entity_id = (b.id)::text))
                      InitPlan 7
                        ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                              Filter: (count(DISTINCT st_6.token_hash) >= $75)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_6  (cost=0.56..11.38 rows=1 width=112)
                                    Index Cond: ((entity_type = $66) AND (field = $67) AND (token_hash = ANY (ARRAY[$68, $69, $70, $71, $72])) AND (organization_id = $74))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $73)) AND (entity_id = (b.id)::text))
                      InitPlan 9
                        ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                              Filter: (count(DISTINCT st_8.token_hash) >= $95)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_8  (cost=0.56..11.38 rows=1 width=112)
                                    Index Cond: ((entity_type = $86) AND (field = $87) AND (token_hash = ANY (ARRAY[$88, $89, $90, $91, $92])) AND (organization_id = $94))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $93)) AND (entity_id = (b.id)::text))
                      ->  Nested Loop Left Join  (cost=0.71..62.17 rows=1 width=16)
                            Filter: ((InitPlan 1).col1 OR EXISTS(SubPlan 2) OR (InitPlan 3).col1 OR EXISTS(SubPlan 4) OR (InitPlan 5).col1 OR EXISTS(SubPlan 6) OR (InitPlan 7).col1 OR EXISTS(SubPlan 8) OR (InitPlan 9).col1 OR EXISTS(SubPlan 10))
                            ->  Nested Loop Left Join  (cost=0.42..2.67 rows=1 width=0)
                                  ->  Result  (cost=0.00..0.01 rows=1 width=0)
                                  ->  Index Scan using entity_indexes_type_entity_org_coalesced_unique on entity_indexes ei  (cost=0.42..2.65 rows=1 width=0)
                                        Index Cond: ((entity_type = $4) AND (entity_id = (b.id)::text))
                                        Filter: ((organization_id IS NOT NULL) AND (tenant_id IS NOT NULL) AND (deleted_at IS NULL) AND (organization_id = b.organization_id) AND (tenant_id = b.tenant_id))
                            ->  Index Scan using idx_customer_people_entity_id on customer_people person_profile  (cost=0.29..2.51 rows=1 width=16)
                                  Index Cond: (entity_id = b.id)
                            SubPlan 2
                              ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                    Filter: (count(DISTINCT st_1.token_hash) >= $25)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_1  (cost=0.56..11.38 rows=1 width=112)
                                          Index Cond: ((entity_type = $16) AND (field = $17) AND (token_hash = ANY (ARRAY[$18, $19, $20, $21, $22])) AND (organization_id = $24))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $23)) AND (entity_id = (person_profile.id)::text))
                            SubPlan 4
                              ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                    Filter: (count(DISTINCT st_3.token_hash) >= $45)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_3  (cost=0.56..11.38 rows=1 width=112)
                                          Index Cond: ((entity_type = $36) AND (field = $37) AND (token_hash = ANY (ARRAY[$38, $39, $40, $41, $42])) AND (organization_id = $44))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $43)) AND (entity_id = (person_profile.id)::text))
                            SubPlan 6
                              ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                    Filter: (count(DISTINCT st_5.token_hash) >= $65)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_5  (cost=0.56..11.38 rows=1 width=112)
                                          Index Cond: ((entity_type = $56) AND (field = $57) AND (token_hash = ANY (ARRAY[$58, $59, $60, $61, $62])) AND (organization_id = $64))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $63)) AND (entity_id = (person_profile.id)::text))
                            SubPlan 8
                              ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                    Filter: (count(DISTINCT st_7.token_hash) >= $85)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_7  (cost=0.56..11.38 rows=1 width=112)
                                          Index Cond: ((entity_type = $76) AND (field = $77) AND (token_hash = ANY (ARRAY[$78, $79, $80, $81, $82])) AND (organization_id = $84))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $83)) AND (entity_id = (person_profile.id)::text))
                            SubPlan 10
                              ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                    Filter: (count(DISTINCT st_9.token_hash) >= $105)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_9  (cost=0.56..11.38 rows=1 width=112)
                                          Index Cond: ((entity_type = $96) AND (field = $97) AND (token_hash = ANY (ARRAY[$98, $99, $100, $101, $102])) AND (organization_id = $104))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $103)) AND (entity_id = (person_profile.id)::text))
                      ->  Index Scan using entity_indexes_type_entity_org_coalesced_unique on entity_indexes ei_person_profile  (cost=0.42..2.65 rows=1 width=37)
                            Index Cond: ((entity_type = $5) AND (entity_id = (person_profile.id)::text))
                            Filter: ((organization_id IS NOT NULL) AND (tenant_id IS NOT NULL) AND (deleted_at IS NULL) AND (organization_id = b.organization_id) AND (tenant_id = b.tenant_id))
```
</details>

<details><summary>generic plan for queryid -799267487938736476</summary>

```
Aggregate  (cost=45395.02..45395.03 rows=1 width=8)
  ->  Limit  (cost=0.29..45393.11 rows=153 width=32)
        ->  Index Scan using customer_entities_org_tenant_kind_idx on customer_entities b  (cost=0.29..453928.46 rows=1530 width=32)
              Index Cond: ((organization_id = $1) AND (tenant_id = $2) AND (kind = $3))
              Filter: ((deleted_at IS NULL) AND EXISTS(SubPlan 11))
              SubPlan 11
                ->  Nested Loop Left Join  (cost=71.10..147.77 rows=1 width=0)
                      InitPlan 1
                        ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                              Filter: (count(DISTINCT st_0.token_hash) >= $16)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_0  (cost=0.56..13.98 rows=1 width=112)
                                    Index Cond: ((entity_type = $6) AND (field = $7) AND (token_hash = ANY (ARRAY[$8, $9, $10, $11, $12, $13])) AND (organization_id = $15))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $14)) AND (entity_id = (b.id)::text))
                      InitPlan 3
                        ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                              Filter: (count(DISTINCT st_2.token_hash) >= $38)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_2  (cost=0.56..13.98 rows=1 width=112)
                                    Index Cond: ((entity_type = $28) AND (field = $29) AND (token_hash = ANY (ARRAY[$30, $31, $32, $33, $34, $35])) AND (organization_id = $37))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $36)) AND (entity_id = (b.id)::text))
                      InitPlan 5
                        ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                              Filter: (count(DISTINCT st_4.token_hash) >= $60)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_4  (cost=0.56..13.98 rows=1 width=112)
                                    Index Cond: ((entity_type = $50) AND (field = $51) AND (token_hash = ANY (ARRAY[$52, $53, $54, $55, $56, $57])) AND (organization_id = $59))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $58)) AND (entity_id = (b.id)::text))
                      InitPlan 7
                        ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                              Filter: (count(DISTINCT st_6.token_hash) >= $82)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_6  (cost=0.56..13.98 rows=1 width=112)
                                    Index Cond: ((entity_type = $72) AND (field = $73) AND (token_hash = ANY (ARRAY[$74, $75, $76, $77, $78, $79])) AND (organization_id = $81))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $80)) AND (entity_id = (b.id)::text))
                      InitPlan 9
                        ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                              Filter: (count(DISTINCT st_8.token_hash) >= $104)
                              ->  Index Scan using search_tokens_lookup_idx on search_tokens st_8  (cost=0.56..13.98 rows=1 width=112)
                                    Index Cond: ((entity_type = $94) AND (field = $95) AND (token_hash = ANY (ARRAY[$96, $97, $98, $99, $100, $101])) AND (organization_id = $103))
                                    Filter: ((NOT (tenant_id IS DISTINCT FROM $102)) AND (entity_id = (b.id)::text))
                      ->  Nested Loop Left Join  (cost=0.71..75.15 rows=1 width=16)
                            Filter: ((InitPlan 1).col1 OR EXISTS(SubPlan 2) OR (InitPlan 3).col1 OR EXISTS(SubPlan 4) OR (InitPlan 5).col1 OR EXISTS(SubPlan 6) OR (InitPlan 7).col1 OR EXISTS(SubPlan 8) OR (InitPlan 9).col1 OR EXISTS(SubPlan 10))
                            ->  Nested Loop Left Join  (cost=0.42..2.67 rows=1 width=0)
                                  ->  Result  (cost=0.00..0.01 rows=1 width=0)
                                  ->  Index Scan using entity_indexes_type_entity_org_coalesced_unique on entity_indexes ei  (cost=0.42..2.65 rows=1 width=0)
                                        Index Cond: ((entity_type = $4) AND (entity_id = (b.id)::text))
                                        Filter: ((organization_id IS NOT NULL) AND (tenant_id IS NOT NULL) AND (deleted_at IS NULL) AND (organization_id = b.organization_id) AND (tenant_id = b.tenant_id))
                            ->  Index Scan using idx_customer_people_entity_id on customer_people person_profile  (cost=0.29..2.51 rows=1 width=16)
                                  Index Cond: (entity_id = b.id)
                            SubPlan 2
                              ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                                    Filter: (count(DISTINCT st_1.token_hash) >= $27)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_1  (cost=0.56..13.98 rows=1 width=112)
                                          Index Cond: ((entity_type = $17) AND (field = $18) AND (token_hash = ANY (ARRAY[$19, $20, $21, $22, $23, $24])) AND (organization_id = $26))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $25)) AND (entity_id = (person_profile.id)::text))
                            SubPlan 4
                              ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                                    Filter: (count(DISTINCT st_3.token_hash) >= $49)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_3  (cost=0.56..13.98 rows=1 width=112)
                                          Index Cond: ((entity_type = $39) AND (field = $40) AND (token_hash = ANY (ARRAY[$41, $42, $43, $44, $45, $46])) AND (organization_id = $48))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $47)) AND (entity_id = (person_profile.id)::text))
                            SubPlan 6
                              ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                                    Filter: (count(DISTINCT st_5.token_hash) >= $71)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_5  (cost=0.56..13.98 rows=1 width=112)
                                          Index Cond: ((entity_type = $61) AND (field = $62) AND (token_hash = ANY (ARRAY[$63, $64, $65, $66, $67, $68])) AND (organization_id = $70))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $69)) AND (entity_id = (person_profile.id)::text))
                            SubPlan 8
                              ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                                    Filter: (count(DISTINCT st_7.token_hash) >= $93)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_7  (cost=0.56..13.98 rows=1 width=112)
                                          Index Cond: ((entity_type = $83) AND (field = $84) AND (token_hash = ANY (ARRAY[$85, $86, $87, $88, $89, $90])) AND (organization_id = $92))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $91)) AND (entity_id = (person_profile.id)::text))
                            SubPlan 10
                              ->  GroupAggregate  (cost=0.56..13.99 rows=1 width=79)
                                    Filter: (count(DISTINCT st_9.token_hash) >= $115)
                                    ->  Index Scan using search_tokens_lookup_idx on search_tokens st_9  (cost=0.56..13.98 rows=1 width=112)
                                          Index Cond: ((entity_type = $105) AND (field = $106) AND (token_hash = ANY (ARRAY[$107, $108, $109, $110, $111, $112])) AND (organization_id = $114))
                                          Filter: ((NOT (tenant_id IS DISTINCT FROM $113)) AND (entity_id = (person_profile.id)::text))
                      ->  Index Scan using entity_indexes_type_entity_org_coalesced_unique on entity_indexes ei_person_profile  (cost=0.42..2.65 rows=1 width=37)
                            Index Cond: ((entity_type = $5) AND (entity_id = (person_profile.id)::text))
                            Filter: ((organization_id IS NOT NULL) AND (tenant_id IS NOT NULL) AND (deleted_at IS NULL) AND (organization_id = b.organization_id) AND (tenant_id = b.tenant_id))
```
</details>

<details><summary>generic plan for queryid 3914069155369902734</summary>

```
Limit  (cost=7655.66..7656.43 rows=306 width=727)
  ->  Sort  (cost=7654.90..7662.54 rows=3057 width=727)
        Sort Key: b.id
        ->  Hash Left Join  (cost=3273.98..7477.93 rows=3057 width=727)
              Hash Cond: ((person_profile.id)::text = ei_person_profile.entity_id)
              ->  Hash Left Join  (cost=2534.08..6627.15 rows=3057 width=1526)
                    Hash Cond: ((b.id)::text = ei.entity_id)
                    ->  Hash Right Join  (cost=1794.17..5868.08 rows=3057 width=647)
                          Hash Cond: (person_profile.entity_id = b.id)
                          Filter: (EXISTS(SubPlan 1) OR EXISTS(SubPlan 2) OR EXISTS(SubPlan 3) OR EXISTS(SubPlan 4) OR EXISTS(SubPlan 5) OR EXISTS(SubPlan 6) OR EXISTS(SubPlan 7) OR EXISTS(SubPlan 8) OR EXISTS(SubPlan 9) OR EXISTS(SubPlan 10))
                          ->  Seq Scan on customer_people person_profile  (cost=0.00..3851.62 rows=41262 width=32)
                          ->  Hash  (cost=1755.92..1755.92 rows=3060 width=631)
                                ->  Index Scan using customer_entities_org_tenant_kind_idx on customer_entities b  (cost=0.29..1755.92 rows=3060 width=631)
                                      Index Cond: ((organization_id = $15) AND (tenant_id = $16) AND (kind = $17))
                                      Filter: (deleted_at IS NULL)
                          SubPlan 1
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_10.token_hash) >= $27)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_10  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $18) AND (field = $19) AND (token_hash = ANY (ARRAY[$20, $21, $22, $23, $24])) AND (organization_id = $26))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $25)) AND (entity_id = (b.id)::text))
                          SubPlan 2
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_11.token_hash) >= $37)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_11  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $28) AND (field = $29) AND (token_hash = ANY (ARRAY[$30, $31, $32, $33, $34])) AND (organization_id = $36))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $35)) AND (entity_id = (person_profile.id)::text))
                          SubPlan 3
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_12.token_hash) >= $47)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_12  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $38) AND (field = $39) AND (token_hash = ANY (ARRAY[$40, $41, $42, $43, $44])) AND (organization_id = $46))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $45)) AND (entity_id = (b.id)::text))
                          SubPlan 4
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_13.token_hash) >= $57)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_13  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $48) AND (field = $49) AND (token_hash = ANY (ARRAY[$50, $51, $52, $53, $54])) AND (organization_id = $56))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $55)) AND (entity_id = (person_profile.id)::text))
                          SubPlan 5
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_14.token_hash) >= $67)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_14  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $58) AND (field = $59) AND (token_hash = ANY (ARRAY[$60, $61, $62, $63, $64])) AND (organization_id = $66))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $65)) AND (entity_id = (b.id)::text))
                          SubPlan 6
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_15.token_hash) >= $77)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_15  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $68) AND (field = $69) AND (token_hash = ANY (ARRAY[$70, $71, $72, $73, $74])) AND (organization_id = $76))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $75)) AND (entity_id = (person_profile.id)::text))
                          SubPlan 7
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_16.token_hash) >= $87)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_16  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $78) AND (field = $79) AND (token_hash = ANY (ARRAY[$80, $81, $82, $83, $84])) AND (organization_id = $86))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $85)) AND (entity_id = (b.id)::text))
                          SubPlan 8
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_17.token_hash) >= $97)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_17  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $88) AND (field = $89) AND (token_hash = ANY (ARRAY[$90, $91, $92, $93, $94])) AND (organization_id = $96))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $95)) AND (entity_id = (person_profile.id)::text))
                          SubPlan 9
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_18.token_hash) >= $107)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_18  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $98) AND (field = $99) AND (token_hash = ANY (ARRAY[$100, $101, $102, $103, $104])) AND (organization_id = $106))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $105)) AND (entity_id = (b.id)::text))
                          SubPlan 10
                            ->  GroupAggregate  (cost=0.56..11.40 rows=1 width=79)
                                  Filter: (count(DISTINCT st_19.token_hash) >= $117)
                                  ->  Index Scan using search_tokens_lookup_idx on search_tokens st_19  (cost=0.56..11.38 rows=1 width=112)
                                        Index Cond: ((entity_type = $108) AND (field = $109) AND (token_hash = ANY (ARRAY[$110, $111, $112, $113, $114])) AND (organization_id = $116))
                                        Filter: ((NOT (tenant_id IS DISTINCT FROM $115)) AND (entity_id = (person_profile.id)::text))
                    ->  Hash  (cost=736.24..736.24 rows=293 width=948)
                          ->  Bitmap Heap Scan on entity_indexes ei  (cost=414.55..736.24 rows=293 width=948)
                                Recheck Cond: ((entity_type = $13) AND (tenant_id IS NOT NULL) AND (tenant_id = $16) AND (organization_id IS NOT NULL) AND (organization_id = $15))
                                Filter: (deleted_at IS NULL)
                                ->  BitmapAnd  (cost=414.55..414.55 rows=293 width=0)
                                      ->  Bitmap Index Scan on entity_indexes_type_tenant_idx  (cost=0.00..17.56 rows=1195 width=0)
                                            Index Cond: ((entity_type = $13) AND (tenant_id IS NOT NULL) AND (tenant_id = $16))
                                      ->  Bitmap Index Scan on entity_indexes_org_idx  (cost=0.00..396.60 rows=35120 width=0)
                                            Index Cond: ((organization_id IS NOT NULL) AND (organization_id = $15))
              ->  Hash  (cost=736.24..736.24 rows=293 width=948)
                    ->  Bitmap Heap Scan on entity_indexes ei_person_profile  (cost=414.55..736.24 rows=293 width=948)
                          Recheck Cond: ((entity_type = $14) AND (tenant_id IS NOT NULL) AND (tenant_id = $16) AND (organization_id IS NOT NULL) AND (organization_id = $15))
                          Filter: (deleted_at IS NULL)
                          ->  BitmapAnd  (cost=414.55..414.55 rows=293 width=0)
                                ->  Bitmap Index Scan on entity_indexes_type_tenant_idx  (cost=0.00..17.56 rows=1195 width=0)
                                      Index Cond: ((entity_type = $14) AND (tenant_id IS NOT NULL) AND (tenant_id = $16))
                                ->  Bitmap Index Scan on entity_indexes_org_idx  (cost=0.00..396.60 rows=35120 width=0)
                                      Index Cond: ((organization_id IS NOT NULL) AND (organization_id = $15))
```
</details>

### Lock waits

_No data._

## 7. Findings

Candidates ranked by p95 (rank finally by latency share × traffic share during the round analysis):

1. `heavy.deals.map:page` p95 9598 ms over 100 samples. Evidence, code location (`file:line`), mechanism and P1/P2/P3 recommendation: _to be filled in the round analysis._
2. `search.list:noHit` p95 7833 ms over 20 samples. Evidence, code location (`file:line`), mechanism and P1/P2/P3 recommendation: _to be filled in the round analysis._
3. `heavy.encrypted.sort:people.name` p95 2967 ms over 20 samples. Evidence, code location (`file:line`), mechanism and P1/P2/P3 recommendation: _to be filled in the round analysis._

## 8. Limitations of this run

- local-validation: k6, the SUT and monitoring share one laptop; latency includes Docker Desktop virtualization and generator contention.
- Protocol VUs do not hold SSE connections (core k6 has no EventSource); only browser VUs do, so SSE fan-out is under-represented.
- App runtime metrics (pool, event loop, heap) are exported by the OTLP metric reader every 60 s (the telemetry package builds the reader without an interval), so short spikes are averaged. The pool gauges are point samples at export time and can read 0 while the pool is saturated in between; use `DB pool wait p95`, `Postgres backends` and app `timeout exceeded when trying to connect` errors for pool saturation.
- Seeded records have no action_logs history; the changelog tab is sparse for them.
