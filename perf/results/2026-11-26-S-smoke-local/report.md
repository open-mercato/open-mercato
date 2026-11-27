# Perf report: 2026-11-26-S-smoke-local (local-validation)

## 1. Environment

| Item | Value |
|---|---|
| Run | 2026-11-26-S-smoke-local |
| Scenario / profile | smoke / smoke |
| Tier / dataset | S (anchor 2026-11-26, age 0 d, snapshot S-1263504e-202611260809) |
| Git SHA | 710956ca53bf912d0dc0561a35c1e8eebc735e29 |
| Image | sha256:13b0372a5fcd9e780a26ed9f38e74a3077f906c027a7bc22d947debcbeb6ee7e |
| Migration head | 55e7311bf363f4af (latest Migration20261120120000_auth) |
| Env hash | 6e4f356a568ee55a9baed3b10b071f74fc505cfafe6dc0b7a3a7916602eb68eb |
| Notable overrides | OM_INIT_SUPERADMIN_EMAIL=superadmin@perf.local, TENANT_DATA_ENCRYPTION=true, ENABLE_CRUD_API_CACHE=true, NODE_ENV=production, RATE_LIMIT_LOGIN_IP_POINTS=10000, TELEMETRY_SAMPLING_RATIO=0.01, DB_POOL_MAX=20, DB_POOL_MIN=2, NODE_OPTIONS=--max-old-space-size=3072, WORKER_DB_POOL_MAX=8, WORKER_NODE_OPTIONS=--max-old-space-size=2048, REDIS_MAXMEMORY=512mb, PG_MAX_CONNECTIONS=200, PG_SHARED_BUFFERS=2GB, PG_EFFECTIVE_CACHE_SIZE=6GB, PG_WORK_MEM=16MB, PG_MAINTENANCE_WORK_MEM=512MB |
| Hardware | local-mac nproc=16 kernel=Darwin 27.2.0 dockerCpus=16 dockerMemBytes=17247232000 |
| Generator | laptop-local, RTT p50 5.46 ms / p95 9.29 ms |
| k6 | k6 v1.8.2 (commit/682f083071, go1.26.4, linux/arm64) |
| Window | 2026-11-26T08:11:27.600Z → 2026-11-26T08:16:40.748Z |
| Modules | 75 static (9 env-gated not counted) |

## 2. Summary

> **local-validation** run: a check of the test harness on one laptop (k6, app and monitoring on the same machine). **This is not a performance result for this tier** and does not replace the VPS run; the latencies are distorted by the shared laptop.

> k6 exited with code 99 (a threshold or safety abort fired).

- Saturation point: not reached in this run
- Worst endpoints by p95: `heavy.deals.map:page` 9711 ms, `search.list:noHit` 8047 ms, `shell:notifications` 7972 ms
- Error budget: 1060 requests, 0.28% errors, 0.00% optimistic-lock conflicts
- Previous comparable run: none

## 3. Latency per tag

Reference lines (non-failing): read p95 < 500 ms, errors < 1.00%. Warmup excluded. Source: k6 CSV output.

### Load steps

| Step | VUs | Requests | Req/s | Read p95 ms | Errors | Started |
|---|---|---|---|---|---|---|
| smoke | 2 | 1060 | 3.4 | 1271 | 0.28% | 2026-11-26T08:11:28.000Z |

### All measured steps

| Tag | Group | Step | Count | p50 ms | p95 ms | p99 ms | Max ms | Errors | Conflicts | Ref |
|---|---|---|---|---|---|---|---|---|---|---|
| companies.list:assignable.staff | read | all | 6 | 76.1 | 1235 | 1533 | 1608 | 0.00% | 0.00% | over ref |
| companies.list:definitions | read | all | 6 | 78.2 | 142 | 153 | 156 | 0.00% | 0.00% | – |
| companies.list:dictionary.lifecycle-stages | read | all | 6 | 76.6 | 96.5 | 100 | 101 | 0.00% | 0.00% | – |
| companies.list:dictionary.sources | read | all | 6 | 73.2 | 104 | 110 | 112 | 0.00% | 0.00% | – |
| companies.list:dictionary.statuses | read | all | 6 | 75.7 | 106 | 111 | 113 | 0.00% | 0.00% | – |
| companies.list:list | read | all | 12 | 90.0 | 847 | 1524 | 1693 | 0.00% | 0.00% | over ref |
| companies.list:perspectives | read | all | 6 | 63.6 | 1222 | 1522 | 1597 | 0.00% | 0.00% | over ref |
| company.360:counts | read | all | 6 | 60.4 | 79.3 | 79.8 | 80.0 | 0.00% | 0.00% | – |
| company.360:detail | read | all | 6 | 160 | 221 | 228 | 230 | 0.00% | 0.00% | – |
| company.360:dictionary.lifecycle-stages | read | all | 6 | 72.7 | 97.5 | 102 | 103 | 0.00% | 0.00% | – |
| company.360:dictionary.sources | read | all | 6 | 70.5 | 88.5 | 91.5 | 92.2 | 0.00% | 0.00% | – |
| company.360:dictionary.statuses | read | all | 6 | 66.9 | 89.0 | 91.9 | 92.6 | 0.00% | 0.00% | – |
| company.360:people | read | all | 6 | 89.8 | 118 | 123 | 124 | 0.00% | 0.00% | – |
| company.360:planned | read | all | 6 | 80.5 | 113 | 115 | 115 | 0.00% | 0.00% | – |
| company.360:roles | read | all | 6 | 81.3 | 97.6 | 99.5 | 100.0 | 0.00% | 0.00% | – |
| company.360:tab.addresses | read | all | 6 | 79.8 | 93.6 | 94.8 | 95.1 | 0.00% | 0.00% | – |
| company.360:tab.changelog | read | all | 6 | 61.4 | 84.7 | 86.9 | 87.4 | 0.00% | 0.00% | – |
| company.360:tab.customer_accounts | read | all | 6 | 43.9 | 62.4 | 66.2 | 67.1 | 0.00% | 0.00% | – |
| company.360:tab.customer_groups | read | all | 6 | 81.4 | 93.6 | 94.8 | 95.1 | 0.00% | 0.00% | – |
| company.360:tab.deals | read | all | 6 | 119 | 147 | 153 | 155 | 0.00% | 0.00% | – |
| company.360:tab.eudr | read | all | 6 | 36.0 | 52.6 | 54.8 | 55.3 | 0.00% | 0.00% | – |
| company.360:tab.files | read | all | 6 | 61.4 | 72.9 | 74.3 | 74.7 | 0.00% | 0.00% | – |
| company.360:tab.tasks | read | all | 6 | 77.0 | 82.0 | 82.5 | 82.6 | 0.00% | 0.00% | – |
| company.360:tab.warranty_claims | read | all | 6 | 53.7 | 86.8 | 94.7 | 96.7 | 0.00% | 0.00% | – |
| company.360:timeline | read | all | 6 | 71.1 | 120 | 121 | 122 | 0.00% | 0.00% | – |
| dashboard:layout | read | all | 6 | 82.7 | 112 | 118 | 120 | 0.00% | 0.00% | – |
| dashboard:widget.customer-todos | read | all | 6 | 122 | 138 | 141 | 142 | 0.00% | 0.00% | – |
| dashboard:widget.new-customers | read | all | 6 | 78.2 | 94.9 | 97.0 | 97.5 | 0.00% | 0.00% | – |
| dashboard:widget.new-deals | read | all | 6 | 70.9 | 87.9 | 90.0 | 90.5 | 0.00% | 0.00% | – |
| dashboard:widget.next-interactions | read | all | 6 | 63.9 | 87.8 | 88.5 | 88.7 | 0.00% | 0.00% | – |
| deal.detail:comments | read | all | 6 | 79.4 | 96.7 | 99.3 | 99.9 | 0.00% | 0.00% | – |
| deal.detail:companies | read | all | 6 | 74.5 | 90.9 | 91.8 | 92.0 | 0.00% | 0.00% | – |
| deal.detail:detail | read | all | 6 | 141 | 160 | 160 | 161 | 0.00% | 0.00% | – |
| deal.detail:interactions | read | all | 6 | 20.3 | 24.1 | 24.4 | 24.5 | 0.00% | 0.00% | – |
| deal.detail:people | read | all | 6 | 76.7 | 97.9 | 98.3 | 98.4 | 0.00% | 0.00% | – |
| deal.detail:planned | read | all | 6 | 97.0 | 120 | 124 | 125 | 0.00% | 0.00% | – |
| deals.list:definitions | read | all | 6 | 53.0 | 865 | 1080 | 1134 | 0.00% | 0.00% | over ref |
| deals.list:list | read | all | 12 | 114 | 626 | 1105 | 1224 | 0.00% | 0.00% | over ref |
| deals.list:perspectives | read | all | 6 | 57.0 | 858 | 1070 | 1122 | 0.00% | 0.00% | over ref |
| deals.list:pipelines | read | all | 6 | 55.0 | 832 | 1037 | 1089 | 0.00% | 0.00% | over ref |
| deals.list:sort.asc | read | all | 1 | 2015 | 2015 | 2015 | 2015 | 0.00% | 0.00% | over ref |
| deals.list:sort.desc | read | all | 1 | 1759 | 1759 | 1759 | 1759 | 0.00% | 0.00% | over ref |
| deals.list:sortField.asc | read | all | 1 | 1654 | 1654 | 1654 | 1654 | 0.00% | 0.00% | over ref |
| deals.list:sortField.desc | read | all | 1 | 1713 | 1713 | 1713 | 1713 | 0.00% | 0.00% | over ref |
| deals.list:summary | read | all | 6 | 243 | 1115 | 1348 | 1406 | 0.00% | 0.00% | over ref |
| deals.pipeline:aggregate | read | all | 6 | 34.5 | 68.0 | 74.1 | 75.6 | 0.00% | 0.00% | – |
| deals.pipeline:companies | read | all | 6 | 159 | 1201 | 1253 | 1265 | 0.00% | 0.00% | over ref |
| deals.pipeline:dictionary.currency | read | all | 6 | 108 | 180 | 181 | 181 | 0.00% | 0.00% | – |
| deals.pipeline:lane | read | all | 48 | 72.8 | 138 | 145 | 149 | 0.00% | 0.00% | – |
| deals.pipeline:pipelines | read | all | 6 | 68.2 | 154 | 160 | 161 | 0.00% | 0.00% | – |
| deals.pipeline:stages | read | all | 6 | 31.5 | 62.8 | 69.1 | 70.7 | 0.00% | 0.00% | – |
| heavy.bulk.owner:post.100 | heavy | all | 5 | 1374 | 1562 | 1575 | 1579 | 0.00% | 0.00% | – |
| heavy.calendar.month:page | heavy | all | 30 | 579 | 4812 | 5035 | 5055 | 0.00% | 0.00% | – |
| heavy.deals.map:page | heavy | all | 30 | 9214 | 9711 | 9968 | 10.1 s | 3.33% | 0.00% | – |
| heavy.deals.summary:needsAttention | heavy | all | 6 | 259 | 307 | 309 | 309 | 0.00% | 0.00% | – |
| heavy.deals.summary:stuck | heavy | all | 6 | 276 | 337 | 348 | 351 | 0.00% | 0.00% | – |
| heavy.deals.summary:summary | heavy | all | 6 | 302 | 379 | 390 | 393 | 0.00% | 0.00% | – |
| heavy.encrypted.sort:companies.name | heavy | all | 6 | 34.6 | 993 | 995 | 996 | 0.00% | 0.00% | – |
| heavy.encrypted.sort:deals.title | heavy | all | 6 | 1605 | 1648 | 1648 | 1648 | 0.00% | 0.00% | – |
| heavy.encrypted.sort:people.name | heavy | all | 6 | 2812 | 2960 | 2987 | 2994 | 0.00% | 0.00% | – |
| heavy.encrypted.sort:people.primaryEmail | heavy | all | 6 | 2711 | 2837 | 2844 | 2846 | 0.00% | 0.00% | – |
| login:features | auth | all | 2 | 229 | 237 | 237 | 237 | 0.00% | 0.00% | – |
| login:login | auth | all | 5 | 413 | 423 | 424 | 424 | 0.00% | 0.00% | – |
| people.list:assignable.staff | read | all | 6 | 107 | 136 | 142 | 143 | 0.00% | 0.00% | – |
| people.list:definitions | read | all | 6 | 167 | 426 | 466 | 476 | 0.00% | 0.00% | – |
| people.list:dictionary.lifecycle-stages | read | all | 6 | 111 | 141 | 143 | 143 | 0.00% | 0.00% | – |
| people.list:dictionary.sources | read | all | 6 | 141 | 223 | 234 | 237 | 0.00% | 0.00% | – |
| people.list:dictionary.statuses | read | all | 6 | 115 | 278 | 300 | 305 | 0.00% | 0.00% | – |
| people.list:list | read | all | 12 | 171 | 1454 | 1522 | 1539 | 0.00% | 0.00% | over ref |
| people.list:perspectives | read | all | 6 | 87.5 | 114 | 120 | 121 | 0.00% | 0.00% | – |
| person.360:counts | read | all | 6 | 43.9 | 1274 | 1597 | 1678 | 0.00% | 0.00% | over ref |
| person.360:detail | read | all | 6 | 137 | 1452 | 1788 | 1872 | 0.00% | 0.00% | over ref |
| person.360:dictionary.lifecycle-stages | read | all | 6 | 69.4 | 122 | 130 | 132 | 0.00% | 0.00% | – |
| person.360:dictionary.sources | read | all | 6 | 70.6 | 126 | 133 | 135 | 0.00% | 0.00% | – |
| person.360:dictionary.statuses | read | all | 6 | 70.8 | 137 | 147 | 150 | 0.00% | 0.00% | – |
| person.360:planned | read | all | 6 | 62.9 | 1289 | 1613 | 1694 | 0.00% | 0.00% | over ref |
| person.360:roles | read | all | 6 | 68.1 | 1293 | 1612 | 1692 | 0.00% | 0.00% | over ref |
| person.360:tab.addresses | read | all | 6 | 102 | 1284 | 1591 | 1668 | 0.00% | 0.00% | over ref |
| person.360:tab.changelog | read | all | 6 | 65.1 | 124 | 127 | 128 | 0.00% | 0.00% | – |
| person.360:tab.companies | read | all | 6 | 101 | 173 | 178 | 179 | 0.00% | 0.00% | – |
| person.360:tab.customer_accounts | read | all | 6 | 54.3 | 1204 | 1504 | 1579 | 0.00% | 0.00% | over ref |
| person.360:tab.customer_groups | read | all | 6 | 67.7 | 1247 | 1557 | 1635 | 0.00% | 0.00% | over ref |
| person.360:tab.deals | read | all | 6 | 116 | 1330 | 1646 | 1725 | 0.00% | 0.00% | over ref |
| person.360:tab.files | read | all | 6 | 61.7 | 108 | 110 | 110 | 0.00% | 0.00% | – |
| person.360:tab.tasks | read | all | 6 | 75.6 | 146 | 157 | 160 | 0.00% | 0.00% | – |
| person.360:tab.warranty_claims | read | all | 6 | 60.2 | 1233 | 1540 | 1617 | 0.00% | 0.00% | over ref |
| person.360:timeline | read | all | 6 | 59.7 | 1299 | 1624 | 1705 | 0.00% | 0.00% | over ref |
| search.global:query | read | all | 6 | 154 | 381 | 429 | 441 | 0.00% | 0.00% | – |
| search.list:common | read | all | 6 | 96.0 | 624 | 697 | 715 | 0.00% | 0.00% | over ref |
| search.list:noHit | read | all | 6 | 7582 | 8047 | 8095 | 8107 | 0.00% | 0.00% | over ref |
| search.list:prefix | read | all | 6 | 108 | 192 | 213 | 218 | 0.00% | 0.00% | – |
| search.list:unique | read | all | 6 | 71.3 | 101 | 103 | 104 | 0.00% | 0.00% | – |
| shell:ai.actions | shell | all | 48 | 73.3 | 1548 | 2086 | 2484 | 0.00% | 0.00% | – |
| shell:feature.check | shell | all | 48 | 72.8 | 7885 | 8076 | 8158 | 0.00% | 0.00% | – |
| shell:messages.unread | shell | all | 48 | 76.7 | 6584 | 8057 | 8263 | 0.00% | 0.00% | – |
| shell:notifications | shell | all | 48 | 93.8 | 7972 | 8292 | 8379 | 0.00% | 0.00% | – |
| shell:notifications.unread | shell | all | 48 | 90.5 | 6642 | 8266 | 8392 | 0.00% | 0.00% | – |
| shell:organization.switcher | shell | all | 48 | 81.3 | 7441 | 7850 | 7874 | 2.08% | 0.00% | – |
| shell:progress.active | shell | all | 48 | 114 | 7431 | 8145 | 8378 | 2.08% | 0.00% | – |
| write.deal.comment:create | write | all | 6 | 31.6 | 48.7 | 52.4 | 53.3 | 0.00% | 0.00% | – |
| write.deal.comment:detail | write | all | 6 | 85.0 | 103 | 107 | 108 | 0.00% | 0.00% | – |
| write.deal.create:create | write | all | 6 | 52.5 | 63.4 | 63.9 | 64.0 | 0.00% | 0.00% | – |
| write.deal.stage:detail | write | all | 6 | 87.2 | 107 | 111 | 111 | 0.00% | 0.00% | – |
| write.deal.stage:update | write | all | 6 | 89.2 | 95.6 | 96.0 | 96.2 | 0.00% | 0.00% | – |
| write.interaction:create | write | all | 6 | 43.0 | 99.4 | 113 | 116 | 0.00% | 0.00% | – |
| write.interaction:timeline | write | all | 6 | 27.3 | 39.0 | 40.3 | 40.6 | 0.00% | 0.00% | – |
| write.person.create:address | write | all | 6 | 38.7 | 44.9 | 45.4 | 45.5 | 0.00% | 0.00% | – |
| write.person.create:create | write | all | 6 | 64.4 | 83.6 | 86.3 | 87.0 | 0.00% | 0.00% | – |
| write.person.edit:detail | write | all | 6 | 55.3 | 68.5 | 69.0 | 69.1 | 0.00% | 0.00% | – |
| write.person.edit:update | write | all | 6 | 111 | 141 | 142 | 142 | 0.00% | 0.00% | – |
| write.tag.assign:assign | write | all | 6 | 45.6 | 74.5 | 75.6 | 75.8 | 0.00% | 0.00% | – |
| write.task.complete:complete | write | all | 6 | 44.4 | 48.4 | 48.5 | 48.5 | 0.00% | 0.00% | – |
| write.task.complete:create | write | all | 6 | 49.0 | 59.8 | 62.4 | 63.1 | 0.00% | 0.00% | – |
| write.task.complete:tasks | write | all | 6 | 38.9 | 43.6 | 44.3 | 44.5 | 0.00% | 0.00% | – |

## 4. Journeys and Web Vitals

| Journey | Count | p50 ms | p95 ms | Max ms |
|---|---|---|---|---|
| person.360 | 6 | 357 | 2956 | 3789 |
| companies.list | 6 | 317 | 1556 | 1957 |
| people.list | 6 | 8181 | 8572 | 8578 |
| company.360 | 6 | 357 | 440 | 459 |
| deals.pipeline | 6 | 678 | 1765 | 1865 |
| deals.list | 6 | 416 | 1331 | 1633 |
| dashboard | 6 | 208 | 239 | 244 |
| search.global | 6 | 154 | 381 | 442 |
| write.interaction | 6 | 73.0 | 139 | 158 |
| write.person.edit | 6 | 167 | 197 | 198 |
| search.list | 6 | 8032 | 8656 | 8757 |
| write.deal.stage | 6 | 181 | 199 | 202 |
| write.person.create | 6 | 102 | 125 | 129 |
| write.deal.create | 6 | 53.0 | 63.8 | 64.0 |
| write.task.complete | 6 | 130 | 152 | 157 |
| write.deal.comment | 6 | 117 | 143 | 143 |
| write.tag.assign | 6 | 46.5 | 75.5 | 77.0 |
| heavy.deals.summary | 6 | 304 | 381 | 394 |
| heavy.encrypted.sort | 6 | 7286 | 8203 | 8219 |
| heavy.calendar.month | 6 | 6971 | 7346 | 7356 |
| heavy.bulk.owner | 5 | 1375 | 1564 | 1580 |
| heavy.deals.map | 6 | 12.1 s | 12.3 s | 12.3 s |

Reference: LCP < 2500 ms, INP < 200 ms, CLS < 0.1.

_No data._

## 5. Resources by window

| Metric | Series | Window | Avg | Peak |
|---|---|---|---|---|
| CPU cores | app | run | 0.52 | 0.64 |
| CPU cores | meilisearch | run | 0.09 | 0.17 |
| CPU cores | monitoring (sum) | run | 0.05 | 0.09 |
| CPU cores | postgres | run | 0.31 | 0.58 |
| CPU cores | redis | run | 0.01 | 0.01 |
| CPU cores | tls | run | 0.00 | 0.00 |
| CPU cores | worker | run | 0.12 | 0.25 |
| Working set | app | run | 1.9 GiB | 2.3 GiB |
| Working set | meilisearch | run | 710.2 MiB | 765.5 MiB |
| Working set | monitoring (sum) | run | 1.2 GiB | 1.2 GiB |
| Working set | postgres | run | 2.3 GiB | 2.4 GiB |
| Working set | redis | run | 22.2 MiB | 23.0 MiB |
| Working set | scheduler | run | 6.7 MiB | 6.7 MiB |
| Working set | tls | run | 46.9 MiB | 47.9 MiB |
| Working set | worker | run | 931.5 MiB | 977.7 MiB |
| DB pool used | om-app | run | 0 | 0 |
| DB pool used | om-worker | run | 0 | 0 |
| DB pool pending | om-app | run | 0 | 0 |
| DB pool pending | om-worker | run | 0 | 0 |
| DB pool wait p95 | om-app | run | 91.7 ms | 145 ms |
| DB pool wait p95 | om-scheduler | run | 10.0 ms | 10.0 ms |
| DB pool wait p95 | om-worker | run | 1.0 ms | 1.0 ms |
| Event loop utilization | om-app | run | 42.3% | 84.9% |
| Event loop utilization | om-worker | run | 8.3% | 31.1% |
| Event loop delay p99 | om-app | run | 351 ms | 1149 ms |
| Event loop delay p99 | om-worker | run | 25.1 ms | 25.2 ms |
| V8 heap used | om-app | run | 1.7 GiB | 2.1 GiB |
| V8 heap used | om-worker | run | 752.8 MiB | 799.4 MiB |
| BullMQ active | total | run | 1 | 1 |
| Redis memory | total | run | 5.9 MiB | 7.8 MiB |
| Postgres backends | total | run | 18.9 | 24 |
| Postgres cache hit | total | run | 97.7% | 99.9% |
| Disk busy | total | run | 2.8% | 4.0% |
| CPU steal | total | run | 0.0% | 0.0% |
| Server-side p95 (Caddy) | total | run | 5040 ms | 6614 ms |

## 6. Database

- Cache hit ratio: 99.38%; temp files: 0 (0 B); deadlocks: 0; lock waits logged: 0; slow statements (> 500 ms) logged: 13
- Connections at capture: idle=6, active=1 (max_connections 200)

### Top statements by total time

| queryid | Calls | Total ms | Mean ms | Rows | Calls/req | Statement |
|---|---|---|---|---|---|---|
| -799267487938736476 | 3 | 12.5 s | 4160 | 3 | – | `select count(*) as "count" from (select $117 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."dele` |
| -7658084786845483524 | 3 | 11.1 s | 3710 | 3 | – | `select count(*) as "count" from (select $107 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."dele` |
| -6084591751651921644 | 3 | 11.1 s | 3694 | 0 | – | `select "b"."id" as "id", "b"."display_name" as "display_name", "b"."description" as "description", "b"."owner_user_id" as "owner_user_id", "b"."primary_email" a` |
| 3914069155369902734 | 3 | 9840 | 3280 | 0 | – | `select "b"."id" as "id", "b"."display_name" as "display_name", "b"."description" as "description", "b"."owner_user_id" as "owner_user_id", "b"."primary_email" a` |
| 6141459673647058178 | 30 | 1772 | 59.1 | 411000 | – | `select "c0"."id", "c0"."deal_id" from "customer_deal_companies" as "c0" where "c0"."company_entity_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $1` |
| 616253865520972456 | 30 | 1590 | 53.0 | 426570 | – | `select "c0"."id", "c0"."entity_id" from "customer_addresses" as "c0" where "c0"."latitude" is not null and "c0"."longitude" is not null and "c0"."tenant_id" = $` |
| -5068238819091377900 | 29 | 1034 | 35.7 | 95580 | – | `select "c0"."id", "c0"."deal_id" from "customer_deal_people" as "c0" where "c0"."person_entity_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $` |
| -4505896698322519283 | 5 | 1026 | 205 | 2675 | – | `select "entity_id" from "search_tokens" where "entity_type" = $1 and "token_hash" in ($2, $3, $4) and "field" in ($5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $` |
| 3037293489916930624 | 34 | 1010 | 29.7 | 120 | – | `select "deal_id", count(*) as "count" from "customer_interactions" where "deal_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $1` |
| -23224490264822389 | 24 | 835 | 34.8 | 2424 | – | `select "id", "entity_id", "deal_id", "interaction_type", "title", "body", "status", "scheduled_at", "occurred_at", "priority", "author_user_id", "owner_user_id"` |

### Top statements by mean time (calls >= 5)

| queryid | Calls | Total ms | Mean ms | Rows | Calls/req | Statement |
|---|---|---|---|---|---|---|
| -4505896698322519283 | 5 | 1026 | 205 | 2675 | – | `select "entity_id" from "search_tokens" where "entity_type" = $1 and "token_hash" in ($2, $3, $4) and "field" in ($5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $` |
| 25789684004546580 | 6 | 638 | 106 | 225021 | – | `select "b"."id" as "id", "b"."tenant_id" as "tenant_id", "b"."organization_id" as "organization_id", "b"."display_name" as "display_name" from "customer_entitie` |
| -8443961795080402671 | 6 | 533 | 88.9 | 225021 | – | `select "b"."id" as "id", "b"."tenant_id" as "tenant_id", "b"."organization_id" as "organization_id", "b"."primary_email" as "primary_email" from "customer_entit` |
| 6141459673647058178 | 30 | 1772 | 59.1 | 411000 | – | `select "c0"."id", "c0"."deal_id" from "customer_deal_companies" as "c0" where "c0"."company_entity_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $1` |
| 616253865520972456 | 30 | 1590 | 53.0 | 426570 | – | `select "c0"."id", "c0"."entity_id" from "customer_addresses" as "c0" where "c0"."latitude" is not null and "c0"."longitude" is not null and "c0"."tenant_id" = $` |
| -5283699363119754786 | 7 | 307 | 43.8 | 9734 | – | `select "entity_id" from "search_tokens" where "entity_type" = $1 and "token_hash" in ($2, $3) and "field" in ($4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $` |
| -3048045920252186600 | 6 | 242 | 40.3 | 120 | – | `select "c0".* from "customer_interactions" as "c0" where "c0"."tenant_id" = $1 and "c0"."interaction_type" = $2 and "c0"."organization_id" in ($3) order by "c0"` |
| -262554626930076100 | 10 | 397 | 39.7 | 247451 | – | `select "b"."id" as "id", "b"."tenant_id" as "tenant_id", "b"."organization_id" as "organization_id", "b"."title" as "title" from "customer_deals" as "b" left jo` |
| 3727806880550354268 | 6 | 215 | 35.8 | 606 | – | `select "id", "entity_id", "deal_id", "interaction_type", "title", "body", "status", "scheduled_at", "occurred_at", "priority", "author_user_id", "owner_user_id"` |
| -5068238819091377900 | 29 | 1034 | 35.7 | 95580 | – | `select "c0"."id", "c0"."deal_id" from "customer_deal_people" as "c0" where "c0"."person_entity_id" in ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $` |

### Plans

<details><summary>auto_explain 4301 ms at 2026-11-26 08:15:18.329 UTC</summary>

```
	Query Text: select count(*) as "count" from (select 1 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."deleted_at" is null and "b"."kind" = $3 and exists (select 1 as "one" from (select 1) as "om_count_seed" left join "entity_indexes" as "ei" on "ei"."entity_type" = $4 and "ei"."entity_id" = ("b"."id"::text) and "ei"."organization_id" = "b"."organization_id" and "ei"."organization_id" is not null and "ei"."tenant_id" = "b"."tenant_id" and "ei"."tenant_id" is not null and "ei"."deleted_at" is null left join "customer_people" as "person_profile" on "person_profile"."entity_id" = "b"."id" left join "entity_indexes" as "ei_person_profile" on "ei_person_profile"."entity_type" = $5 and "ei_person_profile"."entity_id" = ("person_profile"."id"::text) and "ei_person_profile"."organization_id" = "b"."organization_id" and "ei_person_profile"."organization_id" is not null and "ei_person_profile"."tenant_id" = "b"."tenant_id" and "ei_person_profile"."tenant_id" is not null and "ei_person_profile"."deleted_at" is null where ((exists (select 1 as "one" from "search_tokens" as "st_0" where "st_0"."entity_type" = $6 and "st_0"."field" = $7 and "st_0"."entity_id" = "b"."id"::text and "st_0"."token_hash" in ($8, $9, $10, $11, $12, $13) and "st_0"."tenant_id" is not distinct from $14 and "st_0"."organization_id" in ($15) group by "st_0"."entity_id", "st_0"."field" having count(distinct "st_0"."token_hash") >= $16) or exists (select 1 as "one" from "search_tokens" as "st_1" where "st_1"."entity_type" = $17 and "st_1"."field" = $18 and "st_1"."entity_id" = "person_profile"."id"::text and "st_1"."token_hash" in ($19, $20, $21, $22, $23, $24) and "st_1"."tenant_id" is not distinct from $25 and "st_1"."organization_id" in ($26) group by "st_1"."entity_id", "st_1"."field" having count(distinct "st_1"."token_hash") >= $27)) or (exists (select 1 as "one" from "search_tokens" as "st_2" where "st_2"."entity_type" = $28 and "st_2"."field" = $29 and "st_2"."entity_id" = "b"."id"::text and "st_2"."token_hash" in ($30, $31, $32, $33, $34, $35) and "st_2"."tenant_id" is not distinct from $36 and "st_2"."organization_id" in ($37) group by "st_2"."entity_id", "st_2"."field" having count(distinct "st_2"."token_hash") >= $38) or exists (select 1 as "one" from "search_tokens" as "st_3" where "st_3"."entity_type" = $39 and "st_3"."field" = $40 and "st_3"."entity_id" = "person_profile"."id"::text and "st_3"."token_hash" in ($41, $42, $43, $44, $45, $46) and "st_3"."tenant_id" is not distinct from $47 and "st_3"."organization_id" in ($48) group by "st_3"."entity_id", "st_3"."field" having count(distinct "st_3"."token_hash") >= $49)) or (exists (select 1 as "one" from "search_tokens" as "st_4" where "st_4"."entity_type" = $50 and "st_4"."field" = $51 and "st_4"."entity_id" = "b"."id"::text and "st_4"."token_hash" in ($52, $53, $54, $55, $56, $57) and "st_4"."tenant_id" is not distinct from $58 and "st_4"."organization_id" in ($59) group by "st_4"."entity_id", "st_4"."field" having count(distinct "st_4"."token_hash") >= $60) or exists (select 1 as "one" from "search_tokens" as "st_5" where "st_5"."entity_type" = $61 and "st_5"."field" = $62 and "st_5"."entity_id" = "person_profile"."id"::text and "st_5"."token_hash" in ($63, $64, $65, $66, $67, $68) and "st_5"."tenant_id" is not distinct from $69 and "st_5"."organization_id" in ($70) group by "st_5"."entity_id", "st_5"."field" having count(distinct "st_5"."token_hash") >= $71)) or (exists (select 1 as "one" from "search_tokens" as "st_6" where "st_6"."entity_type" = $72 and "st_6"."field" = $73 and "st_6"."entity_id" = "b"."id"::text and "st_6"."token_hash" in ($74, $75, $76, $77, $78, $79) and "st_6"."tenant_id" is not distinct from $80 and "st_6"."organization_id" in ($81) group by "st_6"."entity_id", "st_6"."field" having count(distinct "st_6"."token_hash") >= $82) or exists (select 1 as "one" from "search_tokens" as "st_7" where "st_7"."entity_type" = $83 and "st_7"."field" = $84 and "st_7"."entity_id" = "person_profile"."id"::text and "st_7"."token_hash" in ($85, $86, $87, $88, $89, $90) and "st_7"."tenant_id" is not distinct from $91 and "st_7"."organization_id" in ($92) group by "st_7"."entity_id", "st_7"."field" having count(distinct "st_7"."token_hash") >= $93)) or (exists (select 1 as "one" from "search_tokens" as "st_8" where "st_8"."entity_type" = $94 and "st_8"."field" = $95 and "st_8"."entity_id" = "b"."id"::text and "st_8"."token_hash" in ($96, $97, $98, $99, $100, $101) and "st_8"."tenant_id" is not distinct from $102 and "st_8"."organization_id" in ($103) group by "st_8"."entity_id", "st_8"."field" having count(distinct "st_8"."token_hash") >= $104) or exists (select 1 as "one" from "search_tokens" as "st_9" where "st_9"."entity_type" = $105 and "st_9"."field" = $106 and "st_9"."entity_id" = "person_profile"."id"::text and "st_9"."token_hash" in ($107, $108, $109, $110, $111, $112) and "st_9"."tenant_id" is not distinct from $113 and "st_9"."organization_id" in ($114) group by "st_9"."entity_id", "st_9"."field" having count(distinct "st_9"."token_hash") >= $115)))) limit $116) as "om_count_probe"
	Aggregate  (cost=7326120.32..7326120.33 rows=1 width=8) (actual time=4301.284..4301.287 rows=1 loops=1)
	  Buffers: shared hit=5442037 read=4
	  I/O Timings: shared read=0.370
	  ->  Limit  (cost=0.29..7325995.30 rows=10001 width=4) (actual time=4301.259..4301.262 rows=0 loops=1)
	        Buffers: shared hit=5442037 read=4
	        I/O Timings: shared read=0.370
	        ->  Index Scan using customer_entities_org_tenant_kind_idx on customer_entities b  (cost=0.29..12499828.20 rows=17064 width=4) (actual time=3801.512..3801.515 rows=0 loops=1)
	              Index Cond: ((organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (tenant_id = '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid) AND (kind = 'person'::text))
	              Filter: ((deleted_at IS NULL) AND EXISTS(SubPlan 11))
	              Rows Removed by Filter: 37504
	              Buffers: shared hit=5442037 read=4
	              I/O Timings: shared read=0.370
	              SubPlan 11
	                ->  Nested Loop Left Join  (cost=15.14..366.14 rows=1 width=0) (actual time=0.101..0.101 rows=0 loops=37504)
	                      Buffers: shared hit=5438593 read=4
	                      I/O Timings: shared read=0.370
	                      InitPlan 1
	                        ->  GroupAggregate  (cost=2.81..2.83 rows=1 width=51) (actual time=0.005..0.005 rows=0 loops=37504)
	                              Filter: (count(DISTINCT st_0.token_hash) >= '6'::bigint)
	                              Buffers: shared hit=150117
	                              ->  Sort  (cost=2.81..2.81 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37504)
	                                    Sort Key: st_0.token_hash
	                                    Sort Method: quicksort  Memory: 25kB
	                                    Buffers: shared hit=150117
	                                    ->  Index Scan using search_tokens_entity_idx on search_tokens st_0  (cost=0.56..2.80 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37504)
	                                          Index Cond: ((entity_type = 'customers:customer_entity'::text) AND (entity_id = (b.id)::text))
	                                          Filter: ((NOT (tenant_id IS DISTINCT FROM '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid)) AND (field = 'display_name'::text) AND (organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (token_hash = ANY ('{0a8962c3e8cee0e67a368656dee7917dbe665135595b13872024c1e8d9f6fe67,4c604a01d0d71ef0b3f8a0512502c6d25fa24ca5bbb0ecad23d7338e3d10bdde,c527943eb4b469743f311372c39a862a74956f57474393adf1690a48809f7fff,cefc0f57540a9da157a4877f789a47b8e46f9c82fa6b47d8be96a71158301fb1,fb08046b521a93b08adc4fdd11ccd9d3783a828158ce4891b593cb23cea676aa,4768b1154e27d4f87d45cb22993ce5eacf11f8499524bb2e0894b0bfb3ab659b}'::text[]
…(truncated)
```
</details>

<details><summary>auto_explain 4110 ms at 2026-11-26 08:12:44.430 UTC</summary>

```
	Query Text: select count(*) as "count" from (select 1 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."deleted_at" is null and "b"."kind" = $3 and exists (select 1 as "one" from (select 1) as "om_count_seed" left join "entity_indexes" as "ei" on "ei"."entity_type" = $4 and "ei"."entity_id" = ("b"."id"::text) and "ei"."organization_id" = "b"."organization_id" and "ei"."organization_id" is not null and "ei"."tenant_id" = "b"."tenant_id" and "ei"."tenant_id" is not null and "ei"."deleted_at" is null left join "customer_people" as "person_profile" on "person_profile"."entity_id" = "b"."id" left join "entity_indexes" as "ei_person_profile" on "ei_person_profile"."entity_type" = $5 and "ei_person_profile"."entity_id" = ("person_profile"."id"::text) and "ei_person_profile"."organization_id" = "b"."organization_id" and "ei_person_profile"."organization_id" is not null and "ei_person_profile"."tenant_id" = "b"."tenant_id" and "ei_person_profile"."tenant_id" is not null and "ei_person_profile"."deleted_at" is null where ((exists (select 1 as "one" from "search_tokens" as "st_0" where "st_0"."entity_type" = $6 and "st_0"."field" = $7 and "st_0"."entity_id" = "b"."id"::text and "st_0"."token_hash" in ($8, $9, $10, $11, $12, $13) and "st_0"."tenant_id" is not distinct from $14 and "st_0"."organization_id" in ($15) group by "st_0"."entity_id", "st_0"."field" having count(distinct "st_0"."token_hash") >= $16) or exists (select 1 as "one" from "search_tokens" as "st_1" where "st_1"."entity_type" = $17 and "st_1"."field" = $18 and "st_1"."entity_id" = "person_profile"."id"::text and "st_1"."token_hash" in ($19, $20, $21, $22, $23, $24) and "st_1"."tenant_id" is not distinct from $25 and "st_1"."organization_id" in ($26) group by "st_1"."entity_id", "st_1"."field" having count(distinct "st_1"."token_hash") >= $27)) or (exists (select 1 as "one" from "search_tokens" as "st_2" where "st_2"."entity_type" = $28 and "st_2"."field" = $29 and "st_2"."entity_id" = "b"."id"::text and "st_2"."token_hash" in ($30, $31, $32, $33, $34, $35) and "st_2"."tenant_id" is not distinct from $36 and "st_2"."organization_id" in ($37) group by "st_2"."entity_id", "st_2"."field" having count(distinct "st_2"."token_hash") >= $38) or exists (select 1 as "one" from "search_tokens" as "st_3" where "st_3"."entity_type" = $39 and "st_3"."field" = $40 and "st_3"."entity_id" = "person_profile"."id"::text and "st_3"."token_hash" in ($41, $42, $43, $44, $45, $46) and "st_3"."tenant_id" is not distinct from $47 and "st_3"."organization_id" in ($48) group by "st_3"."entity_id", "st_3"."field" having count(distinct "st_3"."token_hash") >= $49)) or (exists (select 1 as "one" from "search_tokens" as "st_4" where "st_4"."entity_type" = $50 and "st_4"."field" = $51 and "st_4"."entity_id" = "b"."id"::text and "st_4"."token_hash" in ($52, $53, $54, $55, $56, $57) and "st_4"."tenant_id" is not distinct from $58 and "st_4"."organization_id" in ($59) group by "st_4"."entity_id", "st_4"."field" having count(distinct "st_4"."token_hash") >= $60) or exists (select 1 as "one" from "search_tokens" as "st_5" where "st_5"."entity_type" = $61 and "st_5"."field" = $62 and "st_5"."entity_id" = "person_profile"."id"::text and "st_5"."token_hash" in ($63, $64, $65, $66, $67, $68) and "st_5"."tenant_id" is not distinct from $69 and "st_5"."organization_id" in ($70) group by "st_5"."entity_id", "st_5"."field" having count(distinct "st_5"."token_hash") >= $71)) or (exists (select 1 as "one" from "search_tokens" as "st_6" where "st_6"."entity_type" = $72 and "st_6"."field" = $73 and "st_6"."entity_id" = "b"."id"::text and "st_6"."token_hash" in ($74, $75, $76, $77, $78, $79) and "st_6"."tenant_id" is not distinct from $80 and "st_6"."organization_id" in ($81) group by "st_6"."entity_id", "st_6"."field" having count(distinct "st_6"."token_hash") >= $82) or exists (select 1 as "one" from "search_tokens" as "st_7" where "st_7"."entity_type" = $83 and "st_7"."field" = $84 and "st_7"."entity_id" = "person_profile"."id"::text and "st_7"."token_hash" in ($85, $86, $87, $88, $89, $90) and "st_7"."tenant_id" is not distinct from $91 and "st_7"."organization_id" in ($92) group by "st_7"."entity_id", "st_7"."field" having count(distinct "st_7"."token_hash") >= $93)) or (exists (select 1 as "one" from "search_tokens" as "st_8" where "st_8"."entity_type" = $94 and "st_8"."field" = $95 and "st_8"."entity_id" = "b"."id"::text and "st_8"."token_hash" in ($96, $97, $98, $99, $100, $101) and "st_8"."tenant_id" is not distinct from $102 and "st_8"."organization_id" in ($103) group by "st_8"."entity_id", "st_8"."field" having count(distinct "st_8"."token_hash") >= $104) or exists (select 1 as "one" from "search_tokens" as "st_9" where "st_9"."entity_type" = $105 and "st_9"."field" = $106 and "st_9"."entity_id" = "person_profile"."id"::text and "st_9"."token_hash" in ($107, $108, $109, $110, $111, $112) and "st_9"."tenant_id" is not distinct from $113 and "st_9"."organization_id" in ($114) group by "st_9"."entity_id", "st_9"."field" having count(distinct "st_9"."token_hash") >= $115)))) limit $116) as "om_count_probe"
	Aggregate  (cost=7323733.99..7323734.00 rows=1 width=8) (actual time=4110.399..4110.403 rows=1 loops=1)
	  Buffers: shared hit=4953756 read=15
	  I/O Timings: shared read=0.641
	  ->  Limit  (cost=0.29..7323608.97 rows=10001 width=4) (actual time=4110.378..4110.381 rows=0 loops=1)
	        Buffers: shared hit=4953756 read=15
	        I/O Timings: shared read=0.641
	        ->  Index Scan using customer_entities_org_tenant_kind_idx on customer_entities b  (cost=0.29..12492095.13 rows=17059 width=4) (actual time=3608.100..3608.103 rows=0 loops=1)
	              Index Cond: ((organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (tenant_id = '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid) AND (kind = 'person'::text))
	              Filter: ((deleted_at IS NULL) AND EXISTS(SubPlan 11))
	              Rows Removed by Filter: 37501
	              Buffers: shared hit=4953756 read=15
	              I/O Timings: shared read=0.641
	              SubPlan 11
	                ->  Nested Loop Left Join  (cost=15.01..366.01 rows=1 width=0) (actual time=0.095..0.095 rows=0 loops=37501)
	                      Buffers: shared hit=4950318 read=15
	                      I/O Timings: shared read=0.641
	                      InitPlan 1
	                        ->  GroupAggregate  (cost=2.81..2.83 rows=1 width=51) (actual time=0.005..0.005 rows=0 loops=37501)
	                              Filter: (count(DISTINCT st_0.token_hash) >= '6'::bigint)
	                              Buffers: shared hit=150043
	                              ->  Sort  (cost=2.81..2.81 rows=1 width=112) (actual time=0.005..0.005 rows=0 loops=37501)
	                                    Sort Key: st_0.token_hash
	                                    Sort Method: quicksort  Memory: 25kB
	                                    Buffers: shared hit=150043
	                                    ->  Index Scan using search_tokens_entity_idx on search_tokens st_0  (cost=0.56..2.80 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37501)
	                                          Index Cond: ((entity_type = 'customers:customer_entity'::text) AND (entity_id = (b.id)::text))
	                                          Filter: ((NOT (tenant_id IS DISTINCT FROM '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid)) AND (field = 'display_name'::text) AND (organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (token_hash = ANY ('{607652608b9b816a17101caf94bdfbecf4c388fa2f6ad7e651967a572152b668,5ffc91297dce03e3dbf56f483dc705517b0238cab75432a4f005c45e2f657519,2c5cc904f9d7c3d1b5268c0c2d1cce9d89564bf72e4dd1361374fd0c75692293,e7df31479a085f55b481149fda493c508274dc792dd307b97e65633ce9a8cfc9,232eded3fdc273de43d073f6302e0cc5ac565d002ae9b105a0fcf0fa718f4408,47f320ed92a2a5a151b6c130757428d936f94dd4d35630aab3e219b4b1e510bf}'::te
…(truncated)
```
</details>

<details><summary>auto_explain 4068 ms at 2026-11-26 08:13:34.984 UTC</summary>

```
	Query Text: select count(*) as "count" from (select 1 as "one" from "customer_entities" as "b" where "b"."organization_id" in ($1) and "b"."tenant_id" = $2 and "b"."deleted_at" is null and "b"."kind" = $3 and exists (select 1 as "one" from (select 1) as "om_count_seed" left join "entity_indexes" as "ei" on "ei"."entity_type" = $4 and "ei"."entity_id" = ("b"."id"::text) and "ei"."organization_id" = "b"."organization_id" and "ei"."organization_id" is not null and "ei"."tenant_id" = "b"."tenant_id" and "ei"."tenant_id" is not null and "ei"."deleted_at" is null left join "customer_people" as "person_profile" on "person_profile"."entity_id" = "b"."id" left join "entity_indexes" as "ei_person_profile" on "ei_person_profile"."entity_type" = $5 and "ei_person_profile"."entity_id" = ("person_profile"."id"::text) and "ei_person_profile"."organization_id" = "b"."organization_id" and "ei_person_profile"."organization_id" is not null and "ei_person_profile"."tenant_id" = "b"."tenant_id" and "ei_person_profile"."tenant_id" is not null and "ei_person_profile"."deleted_at" is null where ((exists (select 1 as "one" from "search_tokens" as "st_0" where "st_0"."entity_type" = $6 and "st_0"."field" = $7 and "st_0"."entity_id" = "b"."id"::text and "st_0"."token_hash" in ($8, $9, $10, $11, $12, $13) and "st_0"."tenant_id" is not distinct from $14 and "st_0"."organization_id" in ($15) group by "st_0"."entity_id", "st_0"."field" having count(distinct "st_0"."token_hash") >= $16) or exists (select 1 as "one" from "search_tokens" as "st_1" where "st_1"."entity_type" = $17 and "st_1"."field" = $18 and "st_1"."entity_id" = "person_profile"."id"::text and "st_1"."token_hash" in ($19, $20, $21, $22, $23, $24) and "st_1"."tenant_id" is not distinct from $25 and "st_1"."organization_id" in ($26) group by "st_1"."entity_id", "st_1"."field" having count(distinct "st_1"."token_hash") >= $27)) or (exists (select 1 as "one" from "search_tokens" as "st_2" where "st_2"."entity_type" = $28 and "st_2"."field" = $29 and "st_2"."entity_id" = "b"."id"::text and "st_2"."token_hash" in ($30, $31, $32, $33, $34, $35) and "st_2"."tenant_id" is not distinct from $36 and "st_2"."organization_id" in ($37) group by "st_2"."entity_id", "st_2"."field" having count(distinct "st_2"."token_hash") >= $38) or exists (select 1 as "one" from "search_tokens" as "st_3" where "st_3"."entity_type" = $39 and "st_3"."field" = $40 and "st_3"."entity_id" = "person_profile"."id"::text and "st_3"."token_hash" in ($41, $42, $43, $44, $45, $46) and "st_3"."tenant_id" is not distinct from $47 and "st_3"."organization_id" in ($48) group by "st_3"."entity_id", "st_3"."field" having count(distinct "st_3"."token_hash") >= $49)) or (exists (select 1 as "one" from "search_tokens" as "st_4" where "st_4"."entity_type" = $50 and "st_4"."field" = $51 and "st_4"."entity_id" = "b"."id"::text and "st_4"."token_hash" in ($52, $53, $54, $55, $56, $57) and "st_4"."tenant_id" is not distinct from $58 and "st_4"."organization_id" in ($59) group by "st_4"."entity_id", "st_4"."field" having count(distinct "st_4"."token_hash") >= $60) or exists (select 1 as "one" from "search_tokens" as "st_5" where "st_5"."entity_type" = $61 and "st_5"."field" = $62 and "st_5"."entity_id" = "person_profile"."id"::text and "st_5"."token_hash" in ($63, $64, $65, $66, $67, $68) and "st_5"."tenant_id" is not distinct from $69 and "st_5"."organization_id" in ($70) group by "st_5"."entity_id", "st_5"."field" having count(distinct "st_5"."token_hash") >= $71)) or (exists (select 1 as "one" from "search_tokens" as "st_6" where "st_6"."entity_type" = $72 and "st_6"."field" = $73 and "st_6"."entity_id" = "b"."id"::text and "st_6"."token_hash" in ($74, $75, $76, $77, $78, $79) and "st_6"."tenant_id" is not distinct from $80 and "st_6"."organization_id" in ($81) group by "st_6"."entity_id", "st_6"."field" having count(distinct "st_6"."token_hash") >= $82) or exists (select 1 as "one" from "search_tokens" as "st_7" where "st_7"."entity_type" = $83 and "st_7"."field" = $84 and "st_7"."entity_id" = "person_profile"."id"::text and "st_7"."token_hash" in ($85, $86, $87, $88, $89, $90) and "st_7"."tenant_id" is not distinct from $91 and "st_7"."organization_id" in ($92) group by "st_7"."entity_id", "st_7"."field" having count(distinct "st_7"."token_hash") >= $93)) or (exists (select 1 as "one" from "search_tokens" as "st_8" where "st_8"."entity_type" = $94 and "st_8"."field" = $95 and "st_8"."entity_id" = "b"."id"::text and "st_8"."token_hash" in ($96, $97, $98, $99, $100, $101) and "st_8"."tenant_id" is not distinct from $102 and "st_8"."organization_id" in ($103) group by "st_8"."entity_id", "st_8"."field" having count(distinct "st_8"."token_hash") >= $104) or exists (select 1 as "one" from "search_tokens" as "st_9" where "st_9"."entity_type" = $105 and "st_9"."field" = $106 and "st_9"."entity_id" = "person_profile"."id"::text and "st_9"."token_hash" in ($107, $108, $109, $110, $111, $112) and "st_9"."tenant_id" is not distinct from $113 and "st_9"."organization_id" in ($114) group by "st_9"."entity_id", "st_9"."field" having count(distinct "st_9"."token_hash") >= $115)))) limit $116) as "om_count_probe"
	Aggregate  (cost=7326070.31..7326070.32 rows=1 width=8) (actual time=4067.662..4067.665 rows=1 loops=1)
	  Buffers: shared hit=5291508 read=12
	  I/O Timings: shared read=0.567
	  ->  Limit  (cost=0.29..7325945.30 rows=10001 width=4) (actual time=4067.636..4067.640 rows=0 loops=1)
	        Buffers: shared hit=5291508 read=12
	        I/O Timings: shared read=0.567
	        ->  Index Scan using customer_entities_org_tenant_kind_idx on customer_entities b  (cost=0.29..12499742.88 rows=17064 width=4) (actual time=3582.947..3582.950 rows=0 loops=1)
	              Index Cond: ((organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (tenant_id = '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid) AND (kind = 'person'::text))
	              Filter: ((deleted_at IS NULL) AND EXISTS(SubPlan 11))
	              Rows Removed by Filter: 37502
	              Buffers: shared hit=5291508 read=12
	              I/O Timings: shared read=0.567
	              SubPlan 11
	                ->  Nested Loop Left Join  (cost=15.13..366.13 rows=1 width=0) (actual time=0.095..0.095 rows=0 loops=37502)
	                      Buffers: shared hit=5288066 read=12
	                      I/O Timings: shared read=0.567
	                      InitPlan 1
	                        ->  GroupAggregate  (cost=2.81..2.83 rows=1 width=51) (actual time=0.004..0.004 rows=0 loops=37502)
	                              Filter: (count(DISTINCT st_0.token_hash) >= '6'::bigint)
	                              Buffers: shared hit=150066
	                              ->  Sort  (cost=2.81..2.81 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37502)
	                                    Sort Key: st_0.token_hash
	                                    Sort Method: quicksort  Memory: 25kB
	                                    Buffers: shared hit=150066
	                                    ->  Index Scan using search_tokens_entity_idx on search_tokens st_0  (cost=0.56..2.80 rows=1 width=112) (actual time=0.004..0.004 rows=0 loops=37502)
	                                          Index Cond: ((entity_type = 'customers:customer_entity'::text) AND (entity_id = (b.id)::text))
	                                          Filter: ((NOT (tenant_id IS DISTINCT FROM '9c4d5751-d45c-4949-8357-1a2fd03dbd97'::uuid)) AND (field = 'display_name'::text) AND (organization_id = '6289f52a-86ce-4cdd-86fa-8140f56f3dbb'::uuid) AND (token_hash = ANY ('{bf6d4e43f780d5137284bad3061596a6bf79e908997d6a441444661d762e6377,55531d7dcdeb5c2a871f7d0d95fa49190e6e5f207f59bda9bd9178abcabc6791,95d475def03be9df91b662f622efc2038ca9bcfb846e6757d26f43e2b229a729,b809d7351fa0fb2b73eac1216d88f3999e4763ba233a8ceb593934ed922d7317,bc244539642e7b8fd4a45e1257e91a9114cd9b18e19438ea1fccea6ca29af914,39d68503048de27b6a4139c0e842b339e72c2964d25013df14445bd2160dfe2f}'::te
…(truncated)
```
</details>

<details><summary>generic plan for queryid 616253865520972456</summary>

```
Seq Scan on customer_addresses c0  (cost=0.00..2361.77 rows=1040 width=32)
  Filter: ((latitude IS NOT NULL) AND (longitude IS NOT NULL) AND (tenant_id = $1) AND (organization_id = $2))
```
</details>

<details><summary>generic plan for queryid -4505896698322519283</summary>

```
GroupAggregate  (cost=112.94..113.04 rows=2 width=37)
  Group Key: entity_id
  Filter: (count(DISTINCT token_hash) >= $26)
  ->  Sort  (cost=112.94..112.95 rows=5 width=102)
        Sort Key: entity_id, token_hash
        ->  Index Scan using search_tokens_lookup_idx on search_tokens  (cost=0.56..112.88 rows=5 width=102)
              Index Cond: ((entity_type = $1) AND (field = ANY (ARRAY[$5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23])) AND (token_hash = ANY (ARRAY[$2, $3, $4])) AND (organization_id = $25))
              Filter: (NOT (tenant_id IS DISTINCT FROM $24))
```
</details>

<details><summary>generic plan for queryid 3037293489916930624</summary>

```
GroupAggregate  (cost=15926.50..15926.54 rows=2 width=24)
  Group Key: deal_id
  ->  Sort  (cost=15926.50..15926.51 rows=2 width=16)
        Sort Key: deal_id
        ->  Index Scan using customer_interactions_type_idx on customer_interactions  (cost=0.42..15926.49 rows=2 width=16)
              Index Cond: ((tenant_id = $22) AND (organization_id = $21))
              Filter: ((deleted_at IS NULL) AND (status <> ALL (ARRAY[$23, $24, $25])) AND (deal_id = ANY (ARRAY[$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20])))
```
</details>

### Lock waits

_No data._

## 7. Findings

Candidates ranked by p95 (rank finally by latency share × traffic share during the round analysis):

1. `heavy.deals.map:page` p95 9711 ms over 30 samples. Evidence, code location (`file:line`), mechanism and P1/P2/P3 recommendation: _to be filled in the round analysis._
2. `search.list:noHit` p95 8047 ms over 6 samples. Evidence, code location (`file:line`), mechanism and P1/P2/P3 recommendation: _to be filled in the round analysis._
3. `shell:notifications` p95 7972 ms over 48 samples. Evidence, code location (`file:line`), mechanism and P1/P2/P3 recommendation: _to be filled in the round analysis._

## 8. Limitations of this run

- local-validation: k6, the SUT and monitoring share one laptop; latency includes Docker Desktop virtualization and generator contention.
- Protocol VUs do not hold SSE connections (core k6 has no EventSource); only browser VUs do, so SSE fan-out is under-represented.
- App runtime metrics (pool, event loop, heap) are exported by the OTLP metric reader every 60 s (the telemetry package builds the reader without an interval), so short spikes are averaged. The pool gauges are point samples at export time and can read 0 while the pool is saturated in between; use `DB pool wait p95`, `Postgres backends` and app `timeout exceeded when trying to connect` errors for pool saturation.
- Seeded records have no action_logs history; the changelog tab is sparse for them.
