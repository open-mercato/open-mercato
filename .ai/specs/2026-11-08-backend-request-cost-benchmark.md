# Backend request-cost benchmark

## TLDR

Add two repository scripts that make the cost of one API request measurable and comparable across
commits: `scripts/bench/dataset.mjs` builds a deterministic dataset of companies through the API, and
`scripts/bench/request-cost.mjs` reports queries per request, SQL time per request and latency for
five customers-companies scenarios, using `pg_stat_statements`. Tooling only: no runtime, API, data
model or dependency change.

## Overview

Request-path issues such as #8989 (a DI container built per request) and #8990 (no unit of work per
request) were found with ad-hoc measurements outside the repository. Reviewers cannot reproduce the
numbers, and nobody can check whether a change made a request cheaper. The same gap blocks the CI
budgets proposed in #8993: a budget needs a measurement the repository owns.

The scripts follow the pattern of `scripts/profile-dev-rss.mjs`: a labelled JSON report per run under
`.mercato/`, and a `--report` mode that prints a Markdown comparison.

## Problem Statement

- There is no in-repo way to count the SQL statements behind a request. At `586cee8389` a single
  company lookup (`GET /api/customers/companies?id=…`) runs about 50 statements, which only shows up
  with database-level instrumentation.
- Latency alone is a poor review signal on developer machines: it moves with load. Statement counts
  are deterministic for a given dataset and code, so a single extra statement is visible.
- Realistic numbers need realistic data. Encryption, search tokens, entity indexes and custom fields
  are only produced by the application's write path, so SQL-inserted fixtures under-represent the
  read cost.

## Proposed Solution

### In scope

1. `scripts/bench/dataset.mjs`: builds companies from a plan through `POST /api/customers/companies`.
   Records are a pure function of (plan seed, tenant key, org key, index); progress is logged per
   target, so reruns resume and two builds of a plan are identical. Extra tenants are created with
   `mercato auth setup` (CLI overridable with `BENCH_MERCATO_CLI`), extra organizations through the
   directory API.
2. Two plans: `companies-smoke` (1,000 companies, one organization) and `companies-v1` (20,000
   companies over five tenants and six organizations, 10,000 in the measured one).
3. `scripts/bench/request-cost.mjs`: for each scenario it warms up, resets `pg_stat_statements`,
   sends N sequential requests and records per-request queries, SQL time, latency percentiles,
   response size and every statement with its calls per request. It first waits for a quiet
   database window and refuses to measure without one.
4. Scenarios `R1_list`, `R2_filter`, `R3_lookup`, `R4_picker`, `R5_search` on
   `GET /api/customers/companies`, driven by a seeded PRNG so a run is reproducible. Search terms and
   email prefixes come from the generator because the stored values are encrypted.
5. `scripts/bench/compose.pg-stat-statements.yml`: an opt-in compose override that loads
   `pg_stat_statements` into the repository's Postgres service.
6. `yarn bench:dataset`, `yarn bench:request-cost`, `yarn bench:request-cost:report`,
   `yarn bench:request-cost:html`.
7. `--report --html`: a self-contained HTML view of the saved reports (inline SVG charts, no
   scripts or external resources), so results can be attached to a PR or kept as a CI artifact.
8. Unit tests for the generator, scenarios, summaries and the HTML report in `scripts/__tests__/bench-request-cost.test.mjs`
   (picked up by `yarn test:scripts`).

### Out of scope (follow-ups)

- Throughput/load testing (k6) and CPU cost per request.
- Scenarios for other modules and for writes.
- Running the benchmark in CI or enforcing budgets; #8993 can build on the JSON reports.
- Frontend timing.

## Architecture

```
scripts/bench/
  dataset.mjs              plan → API writes, resumable (state + progress under .mercato/bench/)
  request-cost.mjs         scenarios → requests → pg_stat_statements → .mercato/bench/request-cost/<label>.json
  lib/generator.mjs        deterministic company records (fnv1a + mulberry32)
  lib/scenarios.mjs        request paths per scenario
  lib/stats.mjs            percentiles, per-request summaries, Markdown comparison
  lib/html-report.mjs      self-contained HTML comparison (charts, table, top statements)
  lib/db.mjs               DATABASE_URL resolution (env, then apps/mercato/.env), pg_stat_statements access
  lib/http.mjs             staff login and timed GETs
  plans/*.json             dataset plans
  compose.pg-stat-statements.yml
  README.md                how to run and how to read the numbers
```

- Database access uses `pg` and `dotenv`, already root dependencies. Statements issued by the script
  carry a `/* om-bench */` marker and are excluded from the counts, as is everything mentioning
  `pg_stat_statements`; counts are restricted to the current database, so other databases on the same
  server do not leak in.
- Credentials come from `BENCH_EMAIL` / `BENCH_PASSWORD` (or flags). The scripts never print tokens or
  passwords; generated tenant-admin passwords are stored only in the git-ignored state file.

## Data Models

No application data model changes. File formats owned by the scripts:

- Plan: `{ name, seed, description, measuredTarget, tenants[{ key, provision: init|setup, orgName?, orgs[{ key, provision: init|setup|api, name?, companies }] }], distribution{ status, lifecycleStage, source, nullRates } }`.
- State (`.mercato/bench/dataset-state.json`): the plan plus tenant and organization ids per key.
- Report (`.mercato/bench/request-cost/<label>.json`): `{ label, base, n, warmup, acceptLanguage, startedAt, finishedAt, scope, scenarios{ <name>: { description, example, statuses, latencyMs{p50,p95,p99,mean}, avgResponseBytes, queriesPerRequest, sqlMsPerRequest, distinctStatements, statements[] } } }`.

Changing the generator changes the dataset; it must come with a new plan name. A unit test pins the
first generated record of `companies-v1`.

## API Contracts

No API changes. The scripts call existing endpoints: `POST /api/auth/login`,
`POST /api/customers/companies`, `POST /api/directory/organizations`, `GET /api/customers/companies`,
and the CLI commands `auth setup`, `auth set-password`, `entities install`,
`customers seed-dictionaries`.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| Seeding against a shared or production database | High | data | Defaults point at `localhost:3000` and the local `DATABASE_URL`; README and script header say to use a disposable dev database; writes go only through the public API as the given user | An operator can still point it elsewhere on purpose |
| Background traffic counted as request cost | Medium | accuracy | Idle-window check before measuring; exit code 2 when the database never goes quiet | Traffic that starts mid-run is not detected |
| `pg_stat_statements` not available | Low | usability | Clear error with the compose override command; extension created on demand | Managed databases may forbid it |
| Generated passwords leaking | Medium | security | Only in the git-ignored `.mercato/` state file, never logged | Local file readable by the developer account |
| Comparing runs from different datasets or machines | Medium | interpretation | Report stores scope and dataset; README explains which numbers are comparable | Judgement still needed |

## Final Compliance Report

- No production code, API, entity, migration or dependency change; root `package.json` gains three
  scripts.
- No new integration tests: the change adds no API or UI path. Unit tests cover the pure parts; the
  scripts were run end to end against a production build (see Changelog).
- No `AGENTS.md` change (the root file is at its byte budget); the README in `scripts/bench/` is the
  entry point.

## Changelog

- 2026-11-08: Initial spec and implementation. Verified against a production build of `586cee8389`:
  `companies-smoke` built in 77 s (13 companies/s) on a fresh `mercato init` database and resumed as
  complete on rerun; `request-cost` on a `companies-v1` dataset measured `R3_lookup` at 50.0 queries
  per request (1.4 ms SQL) and `R1_list` at 101 queries per request.
- 2026-11-08: Added `--report --html` (`lib/html-report.mjs`): one self-contained page with the
  per-run comparison, the latency split and the top statements. Rendered from the saved
  `companies-v1` reports and checked in a browser.
