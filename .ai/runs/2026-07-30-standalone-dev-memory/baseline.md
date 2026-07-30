# Standalone development-memory baseline

Date: 2026-07-30

## Fixture and method

- Fixture: `/tmp/open-mercato-standalone-memory-baseline`
- Registry: current workspace packages were built in the required order and published to an isolated local Verdaccio instance.
- Database: isolated PostgreSQL 17 fixture on port `5433`. The shared port `5432` accepted TCP but reset PostgreSQL protocol connections; the isolated fixture passed a Node PostgreSQL query before migration and initialization.
- Each run used a full `yarn dev` restart, then `scripts/profile-dev-rss.mjs --pid <dev-pid> --duration 180000 --interval 1000`.
- Each run logged in as `superadmin@acme.com`, loaded `/backend/memory-probe`, verified `Baseline marker A`, edited the local module to `Baseline marker B`, and reloaded the browser page. The marker B assertion passed without restarting the dev server or writing to the database.

## Results

| Run | Report | Samples | Peak total RSS | Mean total RSS | Dominant class | Top process at peak |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 1 | `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-1.json` | 173 | 10,614.28 MB | 9,905.80 MB | `next-turbopack` | `next-server (v16.2.11)` — 7,661.28 MB |
| 2 | `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-2.json` | 173 | 10,480.30 MB | 9,726.64 MB | `next-turbopack` | `next-server (v16.2.11)` — 7,370.06 MB |
| 3 | `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-3.json` | 173 | 10,540.19 MB | 9,760.63 MB | `next-turbopack` | `next-server (v16.2.11)` — 7,413.78 MB |

**Median peak RSS: 10,540.19 MB.**

## Peak attribution

All three runs were dominated by `next-turbopack`; the top process was `next-server (v16.2.11)`. At the third run's peak, the `next-turbopack` class accounted for 8,027.21 MB of 10,540.19 MB total RSS, while other processes accounted for 2,317.91 MB and the dev orchestrators for 195.07 MB.

## Hot-reload evidence

The authenticated real-browser workflow passed three times. The browser displayed marker A before each edit and marker B after the edit plus a browser reload; the corresponding dev server PID remained alive until its profiler window completed, so no server restart occurred during any marker change. The profiler's lifecycle marker fields are empty because it was attached to an already-running process; the retained browser snapshots and profiler logs are in the fixture's `.playwright-cli/` and `.mercato/dev-rss/` directories.

