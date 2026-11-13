# Pool-40 HTTP concurrency: final-head pre-PR comparison

Final-head rerun recorded 2026-11-13: both applications passed 2,000 operations across 20/30/50/100 distinct authenticated users with zero errors, zero isolation violations and unchanged sentinels. At100 users, elapsed time increased **5.5%**, while p95 increased **30.3%**. This pair does not reproduce the earlier approximately2x elapsed result, but **does not establish no performance regression**. No rollout acceptance or threshold waiver is inferred.

## Final-head results

| Users | Operations | Before p50 ms | RLS p50 ms | Before p95 ms | RLS p95 ms | p95 change | Before elapsed ms | RLS elapsed ms | Elapsed change |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 200 | 136.82 | 122.79 | 1080.43 | 874.95 | -19.0% | 2954.27 | 2734.96 | -7.4% |
| 30 | 300 | 172.69 | 166.26 | 354.73 | 430.37 | +21.3% | 2333.47 | 2395.94 | +2.7% |
| 50 | 500 | 271.75 | 257.90 | 583.91 | 696.97 | +19.4% | 3762.76 | 3769.09 | +0.2% |
| 100 | 1000 | 494.71 | 487.53 | 1101.55 | 1435.18 | +30.3% | 7122.23 | 7511.60 | +5.5% |

Current application: production source through c1f597e218 (approved OSS-neutral discovery, quota connection and awaited indexing fixes included), native build before this pair; attachment checkout a077e28a0796ff5f3e0bbef60d4d65cde2d847af differs only by documentation. Baseline: independently built genuine pre-PR bf633ea9329915e36d37f44a5e0ce2ffd87f8841. Both use DB_POOL_MAX=40, the same workload and disposable fixture privileges. Per-level backend connection snapshots were40; these are neither peak active SQL counts nor a direct measurement of the primary ORM pool.

Current ran first (Playwright start21:35:36 UTC), baseline second (21:39:35 UTC). Each test:1 expected,0 unexpected,0 skipped,0 flaky. Native launches exited0 in238.56s and239.30s, respectively; both retained a secondary Next server shutdown143 diagnostic. The host power log records no sleep between these runs; the last recorded thermal sleep ended22:17 local (21:17 UTC). This removes a recorded interruption for this pair, not all shared-host variability.

The ten waves include own/foreign reads, rejected foreign PUT/DELETE, successful own create/read/update/read/delete/read, and privileged persisted-row/sentinel oracles. Each application has100 persisted non-superadmin users across two tenants. Security guards were not relaxed. Current uses the FORCE-RLS canary; pre-PR isolation relies on existing application filters.

This remains a single sequential current-then-baseline pair, without randomized repeated trials, confidence intervals or SQL/pool-wait profiling. Higher p95 persists at30/50/100 users (+21.3%,+19.4%,+30.3%); attribution to policy evaluation alone is unsupported. The older pair below used earlier production code and is retained rather than erased. Do not compare these two pairs as a controlled causal optimization experiment.

Credential-free raw samples and Playwright reports are retained under `pr-9424/final-pool40-{current,baseline}-v6/` on the QA evidence branch. Reproduction commands and workload limits below still apply.

## Earlier pair — historical evidence

The following original report describes the earlier build and remains for provenance; its measurements are superseded for the final-head comparison above.

# Earlier pool-40 HTTP concurrency: genuine pre-PR comparison

Measured 2026-11-13 on local Node 24.22.3 with disposable PostgreSQL and production Next applications. Both runs passed one Playwright test, 2,000 operations, no skips, zero request errors and zero isolation violations. All retained sentinel rows remained unchanged. **These measurements show overhead; they do not support a no-performance-regression claim.**

## Workload and configuration

Both runs use TC-RLS-002, identical 100 persisted distinct users across two tenants and ten synchronized waves at 20/30/50/100 users: own/foreign reads, denied foreign update/delete, own create/read/update/read/delete/read. Samples per level: 200/300/500/1,000. Both secondary applications use DB_POOL_MAX=40, matching restricted database-role privileges and fixture construction. Backend connection snapshots were 40 after every level; this is not a peak-active-SQL measurement. Latencies include full HTTP response-body consumption; elapsed time also includes privileged fixture oracles.

Baseline is the independently installed and built checkout bf633ea9329915e36d37f44a5e0ce2ffd87f8841 at /private/tmp/mercato-baseline-4e0b1fa0/apps/mercato, with RLS disabled. All workspace links and application imports resolve inside that checkout. It is genuine pre-PR production code, rather than this PR toggled off. Current application was built at b77541d968; the attachment records live checkout HEAD 2541f22ba5da6426472c145cd54fc7d1edb1169b because unrelated lifecycle fixes landed after that build. Neither changes the benchmark workload. Later final gates are separate evidence.

## Results

| Users | Operations | Before p50 ms | RLS p50 ms | Before p95 ms | RLS p95 ms | p95 change | Before elapsed ms | RLS elapsed ms | Elapsed change |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 200 | 148.38 | 179.59 | 1122.21 | 1043.32 | -7.0% | 2997.94 | 3412.53 | +13.8% |
| 30 | 300 | 174.55 | 245.11 | 364.66 | 636.71 | +74.6% | 2397.02 | 3396.30 | +41.7% |
| 50 | 500 | 285.12 | 418.86 | 633.88 | 978.79 | +54.4% | 3953.64 | 5908.69 | +49.4% |
| 100 | 1000 | 503.06 | 1107.88 | 1134.66 | 2941.81 | +159.3% | 7228.99 | 14784.68 | +104.5% |

At 100 concurrent users, elapsed time increased from 7.23s to 14.78s (+104.5%); p95 increased from 1,134.66ms to 2,941.81ms (+159.3%). Isolation passed in both applications, but baseline isolation is provided by existing application filters; it does not prove database enforcement. The RLS run additionally uses the FORCE canary.

## Reproduction and process outcome

Local environment: MISE_NODE_VERSION=24.22.3, TMPDIR=/tmp, TURBO_ENV_MODE=loose, enterprise modules enabled. Current command:

```sh
OM_ENABLE_ENTERPRISE_MODULES=true OM_RLS_CONCURRENCY_POOL_MAX=40 timeout 900 yarn mercato test:integration TC-RLS-002 --verbose --no-reuse-env
```

Baseline adds `OM_RLS_BENCHMARK_BASELINE_APP_ROOT=/private/tmp/mercato-baseline-4e0b1fa0/apps/mercato` to the same command. The native runner supplies disposable DATABASE_URL and authentication fixtures privately. Do not run against a developer or production database.

Current Playwright: 1 pass, 0 fail, 0 skip, 148.31s including discovery/setup. Baseline Playwright: 1 pass, 0 fail, 0 skip, 131.99s. Both enclosing launches returned exit 0 but logged a Next.js exit 143 during intentional shutdown; preserve this cleanup warning rather than describing those runner logs as entirely clean. The first baseline launch failed at a current-app TypeScript build before the benchmark; narrowed callback captures fixed that build, and the second launch produced the results above.

## Interpretation

This is one sequential pair on a shared local machine, with current measured before baseline. It has no repeated randomized trials, confidence intervals, dedicated load host, SQL timing/checkout count trace or pool-wait profile. Cold-start/JIT/cache/order and concurrent host work can affect results. The table describes the measured application-level difference, not a causal estimate of PostgreSQL policy cost alone. Authentication, authority validation, per-checkout transaction/context guards and the rest of this PR all contribute. A read-only hot-path review is tracked separately. Do not relax scope, liveness, mutation or role guards to improve this benchmark.

Raw credential-free configuration, per-request samples and complete Playwright reports are published alongside this document on the QA evidence branch under `pr-9424/pool40-{baseline,current}/`. The prior pool-1 and SQL checkout microbenchmark remain separate experiments; neither substitutes for this requested pool-40 comparison.


## Focused source review after measurement

The independent read-only review found one required parameterized `set_config`
round trip for every physical checkout. Pool readiness and manifest validation are
cached; role validation runs once per new physical client. It found no global
lease serialization or newly repeated staff API identity lookup in the measured
handler path. These findings do not attribute the measured slowdown to a single
cause or approve the performance result.

Successful own mutations were slower in this pair, while rejected foreign writes
were similar. The next useful experiment is repeated alternating baseline/current
runs with separate cold and warmed pools, recording checkout wait, context-setting,
first-client role checks and mutation side-effect SQL timings. Batching the four
cold role-validation catalog queries is an optional hypothesis, not a measured
remedy. No guard was relaxed and no performance recovery is claimed.
