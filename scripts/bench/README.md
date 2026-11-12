# Backend request-cost benchmark

Two scripts that answer "what does one API request cost?" in a way you can compare across commits:

- `dataset.mjs` builds a deterministic dataset of companies through the API, so encryption, search
  tokens, entity indexes and custom fields are written by the application itself.
- `request-cost.mjs` sends sequential requests per scenario and reads `pg_stat_statements` to report
  queries per request, SQL time per request, latency and the statements behind them.

Concurrency is 1 on purpose. These numbers describe the work one request does, which is what
regressions like "a container per request" or "N+1 statements in an enricher" change. They are not a
throughput or capacity test.

## Prerequisites

1. The app running and reachable (`BENCH_BASE_URL`, default `http://localhost:3000`), with `mercato init`
   done. A production build (`yarn build && yarn start`) gives stable latency; `yarn dev` works for
   statement counts.
2. Postgres with `pg_stat_statements` loaded. For the repo compose file:

   ```bash
   docker compose -f docker-compose.yml -f scripts/bench/compose.pg-stat-statements.yml up -d postgres
   ```

   The script creates the extension itself. It connects with `DATABASE_URL` from the environment or
   `apps/mercato/.env` (or `--database-url`), so Postgres must be reachable from the host.
3. Credentials of a staff user in the measured tenant, usually the `mercato init` admin:

   ```bash
   export BENCH_EMAIL=... BENCH_PASSWORD=...
   ```

4. No other database traffic while measuring. `pg_stat_statements` is database-wide, so workers,
   schedulers or an open browser tab would be counted as request cost. The script waits for a quiet
   10-second window and refuses to measure without one. With `AUTO_SPAWN_WORKERS` on, stop the workers
   or let the queue drain first.

## Build a dataset

```bash
node scripts/bench/dataset.mjs                                              # companies-smoke: 1,000 companies
node scripts/bench/dataset.mjs --plan scripts/bench/plans/companies-v1.json # 20,000 companies, 5 tenants
```

| Plan | Companies | Tenants / orgs | Measured org | Use it for |
| --- | ---: | --- | ---: | --- |
| `companies-smoke` | 1,000 | 1 / 1 | 1,000 | checking that everything runs |
| `companies-v1` | 20,000 | 5 / 6 | 10,000 | numbers you compare or publish |

Every record is a pure function of the plan seed, tenant key, org key and index. A rerun continues
where it stopped and two builds of the same plan contain the same data. When a create's outcome is
unknown (lost response, 5xx, or the script stopped mid-request), the script looks the record up by
its generated domain before retrying, so retries and reruns never create it twice. Extra tenants in `companies-v1`
are created with `mercato auth setup`; set `BENCH_MERCATO_CLI` if the CLI is not `yarn mercato`
from the repo root (for Docker: `BENCH_MERCATO_CLI="node scripts/docker-exec.mjs mercato"`).
State, including the generated tenant admins' passwords, is kept in `.mercato/bench/` (git-ignored).

## Measure

```bash
node scripts/bench/request-cost.mjs --label baseline
# change something, restart the app
node scripts/bench/request-cost.mjs --label my-change
node scripts/bench/request-cost.mjs --report
node scripts/bench/request-cost.mjs --report --html   # .mercato/bench/request-cost/report.html
```

Options: `--n` requests per scenario (200), `--warmup` (50), `--only R3_lookup,R1_list`,
`--accept-language "en-US,en;q=0.9"` (browsers send it; it adds entity-translation lookups),
`--target t1/eu` (another org of the dataset), `--out-dir`.

| Scenario | Request |
| --- | --- |
| `R1_list` | `GET /api/customers/companies`, 50 rows sorted by name, random page |
| `R2_filter` | status + lifecycle stage filter, 50 rows |
| `R3_lookup` | one company by `id` (what detail pages and pickers resolve) |
| `R4_picker` | `emailStartsWith` prefix, 20 rows |
| `R5_search` | `search` term, 50 rows |

Each run writes `.mercato/bench/request-cost/<label>.json` with the scope, per-scenario latency
percentiles, queries and SQL time per request, and every statement with its calls per request. The
first request of each scenario is recorded as an example path. Only successful responses are
measured: any status other than 2xx, during warmup or measurement, stops the run with exit code 3
and writes no report (an expired token or a server error would otherwise look like a cheaper
request). `--report` prints a Markdown table of
all saved runs, with the change in queries per request against the oldest run.

`--report --html` writes the same comparison as one self-contained HTML file (no scripts or external
resources, so it opens from disk or as a CI artifact): queries per request per run as a chart, the
comparison table, the latest run's latency split into SQL and the rest, and its top statements per
scenario. `--html-out <file>` picks another path.

## Reading the numbers

- **Queries per request** is deterministic for a given dataset and code, so a change of even one
  statement is real. Use it to review request-path changes.
- **SQL ms per request** depends on cache state and the machine, but is comparable between runs on
  the same machine.
- **Latency** includes everything the app does around SQL (auth, DI container, enrichers,
  serialization). Compare p50 between runs on the same machine; treat p95 on a laptop as indicative.
