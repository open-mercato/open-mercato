# Enterprise RLS checkout benchmark

Specification: [.ai/specs/enterprise/2026-11-12-row-level-security.md](https://github.com/open-mercato/open-mercato/blob/cez/82462d87/.ai/specs/enterprise/2026-11-12-row-level-security.md)

Actual disposable PostgreSQL 17 run, Node24.22.3, local Docker. All 24 cases passed, 12,000 measured acquisitions, zero errors or observed isolation violations. Each case uses 10 barrier waves of identical own-tenant UPDATE RETURNING and foreign SELECT with explicit tenant predicates. Privileged counter oracle confirms every own write. Adapter off disables RLS; on enables FORCE RLS and the production checkout boundary. Runtime role is a nonowner with NOSUPERUSER/NOBYPASSRLS. Pool limits: 1, 3, 10; default pg idle settings, 10-second acquisition/query timeout. One untimed warmup checkout per case. Fixtures removed.

| Pool max | Users | Mode | Acquisitions | Queued at saturation | Peak waiting / leased | Operation p50 / p95 ms | Checkout p50 / p95 ms | Elapsed ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 20 | off | 200 | 0 | 20 / 1 | 6.65 / 12.38 | 6.05 / 11.77 | 126.57 |
| 1 | 20 | on | 200 | 0 | 0 / 1 | 8.64 / 16.11 | 8.09 / 15.53 | 166.29 |
| 1 | 30 | off | 300 | 0 | 30 / 1 | 8.83 / 16.48 | 8.32 / 15.94 | 169.91 |
| 1 | 30 | on | 300 | 0 | 0 / 1 | 12.86 / 23.73 | 12.12 / 23.15 | 246.68 |
| 1 | 50 | off | 500 | 0 | 50 / 1 | 14.09 / 26.53 | 13.58 / 26.04 | 278.32 |
| 1 | 50 | on | 500 | 0 | 0 / 1 | 20.40 / 38.14 | 19.86 / 37.62 | 398.90 |
| 1 | 100 | off | 1000 | 0 | 100 / 1 | 27.26 / 52.27 | 26.76 / 51.74 | 549.43 |
| 1 | 100 | on | 1000 | 0 | 0 / 1 | 39.81 / 74.39 | 39.29 / 73.84 | 780.04 |
| 3 | 20 | off | 200 | 0 | 20 / 3 | 2.73 / 4.71 | 2.03 / 4.08 | 47.44 |
| 3 | 20 | on | 200 | 0 | 0 / 3 | 3.80 / 7.47 | 3.13 / 6.58 | 72.28 |
| 3 | 30 | off | 300 | 0 | 30 / 3 | 4.19 / 8.87 | 3.40 / 7.74 | 82.99 |
| 3 | 30 | on | 300 | 0 | 0 / 3 | 6.21 / 13.81 | 5.33 / 12.94 | 118.52 |
| 3 | 50 | off | 500 | 0 | 50 / 3 | 6.75 / 13.51 | 6.03 / 12.56 | 129.85 |
| 3 | 50 | on | 500 | 0 | 0 / 3 | 7.99 / 14.92 | 7.30 / 14.34 | 153.80 |
| 3 | 100 | off | 1000 | 0 | 100 / 3 | 11.45 / 21.47 | 10.75 / 20.90 | 224.31 |
| 3 | 100 | on | 1000 | 0 | 0 / 3 | 16.24 / 29.30 | 15.48 / 28.64 | 305.61 |
| 10 | 20 | off | 200 | 0 | 20 / 10 | 2.10 / 6.78 | 1.10 / 4.53 | 32.07 |
| 10 | 20 | on | 200 | 0 | 0 / 10 | 3.04 / 5.83 | 1.89 / 4.06 | 40.11 |
| 10 | 30 | off | 300 | 0 | 30 / 10 | 2.57 / 5.05 | 1.29 / 3.55 | 41.71 |
| 10 | 30 | on | 300 | 0 | 0 / 10 | 3.65 / 6.35 | 2.32 / 5.09 | 59.33 |
| 10 | 50 | off | 500 | 0 | 50 / 10 | 3.96 / 7.13 | 2.58 / 5.72 | 70.06 |
| 10 | 50 | on | 500 | 0 | 0 / 10 | 5.75 / 10.70 | 4.36 / 9.55 | 96.85 |
| 10 | 100 | off | 1000 | 0 | 100 / 10 | 7.42 / 13.21 | 6.15 / 12.06 | 137.86 |
| 10 | 100 | on | 1000 | 0 | 0 / 10 | 10.21 / 18.18 | 8.88 / 17.18 | 188.74 |

Checkout timing includes pool queueing, physical connection creation when needed and tenant setup. Saturation count is observed at acquisition, not an internal pg wait counter. On adds one tenant-configuration round trip per acquisition; peak leased stayed within each configured maximum. These single local samples run off then on and are sensitive to cache/scheduling; no throughput or capacity guarantee is inferred. Startup role/catalog verification, HTTP/auth/ORM and remote network cost are excluded. The separate actual HTTP test exercised 2,000 requests at 20/30/50/100 distinct users; this connection benchmark does not replace it.

Reproduce only against a disposable admin PostgreSQL URL: `OM_RLS_TEST_DATABASE_URL=... OM_RLS_BENCHMARK_OUTPUT=results.json node --import tsx packages/enterprise/tests/rls/benchmark.run.ts`. Bound externally with `timeout 180`. No developer or production database was used.
