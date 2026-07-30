# Standalone development-memory baseline

Date: 2026-07-30

## Fixture and candidate identity

- Fixture: `/tmp/open-mercato-standalone-memory-baseline`
- Generated package: `open-mercato-standalone-memory-baseline@0.1.0`, using Node `v24.13.1` and Yarn `4.17.1`.
- The fixture depends on the current built `@open-mercato/*` packages, all at `0.6.6` (18 packages: ai-assistant, cache, channel-gmail, channel-imap, checkout, cli, content, core, events, gateway-stripe, onboarding, queue, scheduler, search, shared, sync-akeneo, ui, and webhooks).
- Registry: an isolated, clean Verdaccio 6 container (`verdaccio/verdaccio:6`, image digest `sha256:8b18576ae085baad6d1f12f5bdcc74ec099a1a1bf063bba899d1405412982394`) mapped `localhost:4875` to container port `4873`. The fixture's `.yarnrc.yml` maps the `open-mercato` scope to that endpoint; Verdaccio had no uplinks and a `100mb` request-body limit, so packages were resolved only from the freshly published local build.
- Database: an isolated `pgvector/pgvector:pg17-trixie` container (image digest `sha256:a3a53761856ec77ae33f9d5cf401598caf2c781f52cd9aa7677ceb39a2ab5dc4`) mapped `localhost:5433` to `5432`, with a dedicated `open_mercato_standalone` database. A Node PostgreSQL query succeeded before migrations and initialization.

## Method

- Current workspace packages were built in the required order (`yarn build:packages`, `yarn generate`, `yarn build:packages`) and published to the isolated registry before scaffolding the fixture with agentic setup disabled.
- Each of three clean `yarn dev` restarts was profiled with `scripts/profile-dev-rss.mjs --pid <dev-pid> --duration 180000 --interval 1000`.
- For every run, an authenticated real browser first navigated to `/backend/memory-probe` and confirmed `Baseline marker A`. The mounted probe is a client component. Its source was edited to marker B, then the browser was polled/snapshotted after six seconds. No navigation, reload, click, or server restart was issued after the edit; the same page URL instead showed `Baseline marker B` and logged Fast Refresh completion.

## Results

| Run | Report | Samples | Peak total RSS | Mean total RSS | Dominant class | Top process at peak |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 1 | `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-1.json` | 173 | 9,692.97 MB | 8,309.03 MB | `next-turbopack` | `next-server (v16.2.11)` — 7,330.03 MB |
| 2 | `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-2.json` | 173 | 10,094.50 MB | 9,431.21 MB | `next-turbopack` | `next-server (v16.2.11)` — 7,051.50 MB |
| 3 | `/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/baseline-3.json` | 172 | 10,519.56 MB | 9,854.28 MB | `next-turbopack` | `next-server (v16.2.11)` — 7,468.78 MB |

**Median peak RSS: 10,094.50 MB.**

## Peak attribution

All three runs were dominated by `next-turbopack`; the top process was `next-server (v16.2.11)`. Run 3 was the high-water mark: `next-turbopack` accounted for the dominant share of the 10,519.56 MB peak, with the Next server using 7,468.78 MB. The profiler reports retain the complete process-class attribution and sample series.

## In-place Fast Refresh evidence

The reload-based evidence from the initial baseline was superseded by these three fresh runs. Their root dev PIDs remained alive for the full profiler windows: Run 1 `65804`, Run 2 `68417`, and Run 3 `71100`.

| Run | Initial browser artifact (marker A) | Post-edit evidence (same URL, no reload/navigation) |
| --- | --- | --- |
| 1 | `.playwright-cli/page-2026-07-30T20-56-39-607Z.yml` | Playwright snapshot/find output reported marker B; `.playwright-cli/console-2026-07-30T20-56-37-605Z.log` records `[Fast Refresh] rebuilding` and `done` after the edit. |
| 2 | `.playwright-cli/page-2026-07-30T21-01-11-655Z.yml` | Playwright snapshot/find output reported marker B; `.playwright-cli/console-2026-07-30T21-01-11-226Z.log` records Fast Refresh completion. |
| 3 | `.playwright-cli/page-2026-07-30T21-05-39-017Z.yml` | Playwright snapshot/find output reported marker B; `.playwright-cli/console-2026-07-30T21-05-38-642Z.log` records Fast Refresh completion. |

Each before/after assertion retained the URL `http://localhost:3000/backend/memory-probe`. The `Baseline marker B` assertions occurred only after the source edit and a six-second wait; the browser commands between those points were `snapshot` and `find`, not `goto` or `reload`.
