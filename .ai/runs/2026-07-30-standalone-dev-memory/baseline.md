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

## Authoritative stable CPU/RSS cohort (2026-08-02)

This fresh three-run cohort is the authoritative denominator for final acceptance. It
supersedes the historical RSS-only median below because it adds process-tree CPU-time
accounting and enforces one identical warmed cache/source seed across the baseline and
candidate cohorts. The historical `10,094.50 MB` median remains a cross-check only.

### Identity and seed gates

- Runtime identity: template runtime commit `77c0a5591b1faba5781b91ed102c89950ac66e7c`, Node executable `/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin/node`, Node `v24.13.1`, Next/`@next` `16.2.11`, and React/ReactDOM `19.2.7`.
- No dependency, manifest, lockfile, or runtime-version change was used. The prohibited-file diff was empty before the cohort.
- Authoritative seed: `5,629` `.mercato/next/dev` files; sorted manifest SHA-256 `72ce610a2f04c263dbcac221693b8dbd556635112ba1c3853741759d2dc50425`.
- Marker-A source SHA-256: `8672e3cd23e43756f1a885b20724915c98110fff70a7c26da3cd756dcf516a6b`. Every run restored and verified both the seed manifest and marker hash before launch.
- The preparatory seed workflow authenticated successfully, displayed marker A, hot-reloaded A→B without navigation, retained the same Next PID/start identity, stopped gracefully, and passed its zero-state post-audit. One earlier preparatory attempt was withdrawn before capture when browser automation was temporarily obscured; it produced no seed or measured report.

CPU core-seconds are the sum of positive per-PID CPU-time deltas over the sampled
process tree. Mean total CPU percentage is `100 × core-seconds / measured seconds`;
peak total CPU percentage is the highest one-interval process-tree delta rate.

| Run | Report duration | Samples | Peak total RSS | Mean total RSS | CPU core-s | Mean CPU | Peak CPU | Dominant class |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 180,002 ms | 174 | 8,938.19 MB | 6,138.65 MB | 121.75 | 67.61% | 948.99% | `next-turbopack` |
| 2 | 180,003 ms | 174 | 10,553.60 MB | 7,411.87 MB | 198.43 | 110.22% | 937.38% | `next-turbopack` |
| 3 | 180,001 ms | 174 | 8,073.14 MB | 6,505.71 MB | 131.11 | 73.16% | 885.74% | `next-turbopack` |
| **Median** | **180,002 ms** | **174** | **8,938.19 MB** | **6,505.71 MB** | **131.11** | **73.16%** | **937.38%** | **`next-turbopack`** |

The hard memory target is therefore a candidate median peak total RSS at or below
`6,256.73 MB` (`8,938.19 × 0.70`). CPU is a non-blocking optimization target and
must be reported against the `131.11` core-second, `73.16%` mean, and `937.38%`
peak medians.

### Fixed-timing browser and lifecycle evidence

Offsets are relative to the first successful profiler sample. All three runs started
the browser signal at T+60 seconds, edited at T+100 seconds, observed marker B before
T+140 seconds, and stopped sampling at T+180 seconds.

| Run | Profiler attach | Browser signal | Marker A observed | Edit | Marker B observed | Next identity | Post-edit navigation/reload | Shutdown / audits |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | 70.23 ms | T+60,002 ms | T+84,646 ms | T+100,002 ms | T+120,544 ms | PID `6822`, `Sun Aug 2 17:28:02 2026`, unchanged through deadline | none | graceful; pre/post pass |
| 2 | 74.06 ms | T+60,000 ms | T+71,943 ms | T+100,004 ms | T+115,281 ms | PID `12886`, `Sun Aug 2 17:31:38 2026`, unchanged through deadline | none | graceful; pre/post pass |
| 3 | 73.15 ms | T+60,001 ms | T+77,589 ms | T+100,002 ms | T+105,450 ms | PID `19205`, `Sun Aug 2 17:35:26 2026`, unchanged through deadline | none | graceful; pre/post pass |
| **Median** | **73.15 ms** | **T+60,001 ms** | **T+77,589 ms** | **T+100,002 ms** | **T+115,281 ms** | **unchanged in 3/3** | **none in 3/3** | **pass in 3/3** |

Each Next identity used the same Node 24 executable and `next-server (v16.2.11)`
command before HMR, after marker B appeared, and at the T+140 deadline. The normal
lazy scheduler and shared worker startup path was exercised in every run. No due
schedule was present during these bounded windows; complete-tree shutdown and the
port/process post-audits nevertheless passed for all three runs.

Canonical evidence is under
`/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/`:

- Reports: `stable-cpu-baseline-{1,2,3}.json`.
- Validity envelopes: `evidence/stable-cpu-baseline/stable-cpu-baseline-{1,2,3}-validity.json`.
- Browser timing/identity JSON: `evidence/stable-cpu-baseline/browser/stable-cpu-baseline-{1,2,3}-browser.json`.
- Marker screenshots: `evidence/stable-cpu-baseline/browser/stable-cpu-baseline-{1,2,3}-marker-{a,b}.png`.
- Identity, seed manifests, lifecycle logs, and bounded pre/post audits: `evidence/stable-cpu-baseline/`.

## Historical RSS-only results

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
