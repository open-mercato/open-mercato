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

## Authoritative stable CPU/RSS cohort (2026-08-02, timestamp-strengthened)

This replacement three-run cohort is the authoritative denominator for final
acceptance. It supersedes both the historical RSS-only median below and the first
CPU-capable cohort recorded earlier on 2026-08-02. That first CPU cohort was withdrawn
because its equal Next identities lacked contemporaneous capture timestamps; none of
its values are used for acceptance.

### Identity and seed gates

- Runtime identity: template runtime commit `77c0a5591b1faba5781b91ed102c89950ac66e7c`, Node executable `/Users/andrzejewsky/.nvm/versions/node/v24.13.1/bin/node`, Node `v24.13.1`, Next/`@next` `16.2.11`, and React/ReactDOM `19.2.7`.
- No dependency, manifest, lockfile, or runtime-version change was used. The prohibited-file diff was empty before and after the cohort.
- Authoritative seed: `5,629` `.mercato/next/dev` entries. Its canonical digest is SHA-256 of the exact newline-terminated, path-sorted `dev-sha256.txt` file bytes: `27ed25b9dacd68c8b8f249086e4bb2e7b6096638e573ff99cfb75ac627a422ae`.
- Marker-A source SHA-256: `8672e3cd23e43756f1a885b20724915c98110fff70a7c26da3cd756dcf516a6b`.
- Before each measured dev process started, all `5,629` restored files were rehashed and compared entry-for-entry with the retained manifest, the canonical manifest digest was recomputed, and marker A was rehashed. The validity envelope records both ISO timestamps and a monotonic ordering gap.
- The preparatory seed workflow authenticated successfully, displayed marker A, hot-reloaded A→B without navigation, retained the same Next PID/start identity, stopped gracefully, and passed its zero-state post-audit. One earlier preparatory attempt was withdrawn before capture when browser automation was temporarily obscured; it produced no seed or measured report.

| Run | Seed verified (UTC) | Dev spawned (UTC) | ISO ordering gap | Monotonic gap | Entries / digest / marker |
| --- | --- | --- | ---: | ---: | --- |
| 1 | `2026-08-02T15:57:39.046Z` | `2026-08-02T15:57:39.053Z` | +7 ms | +6.25 ms | 5,629 / match / match |
| 2 | `2026-08-02T16:06:32.644Z` | `2026-08-02T16:06:32.649Z` | +5 ms | +4.79 ms | 5,629 / match / match |
| 3 | `2026-08-02T16:10:34.285Z` | `2026-08-02T16:10:34.292Z` | +7 ms | +6.27 ms | 5,629 / match / match |

CPU core-seconds are the sum of positive per-PID CPU-time deltas over the sampled
process tree. Mean total CPU percentage is the arithmetic mean of the valid
per-interval process-tree CPU percentages. Peak total CPU percentage is the highest
valid one-interval process-tree delta rate.

| Run | Evidence label | Report duration | Samples | Peak total RSS | Mean total RSS | CPU core-s | Mean CPU | Peak CPU | Dominant class |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `stable-cpu-baseline-v2-1` | 180,003 ms | 173 | 9,717.54 MB | 6,409.73 MB | 126.25 | 70.58% | 940.04% | `next-turbopack` |
| 2 | `stable-cpu-baseline-v2-2-retry` | 180,002 ms | 174 | 8,607.89 MB | 6,643.70 MB | 130.24 | 72.43% | 876.91% | `next-turbopack` |
| 3 | `stable-cpu-baseline-v2-3` | 180,002 ms | 173 | 8,504.21 MB | 6,863.81 MB | 131.39 | 73.32% | 855.36% | `next-turbopack` |
| **Median** | — | **180,002 ms** | **173** | **8,607.89 MB** | **6,643.70 MB** | **130.24** | **72.43%** | **876.91%** | **`next-turbopack`** |

The hard memory target is therefore a candidate median peak total RSS at or below
`6,025.52 MB` (`8,607.89 × 0.70`). CPU is a non-blocking optimization target and
must be reported against the `130.24` core-second, `72.43%` mean, and `876.91%`
peak medians.

### Fixed-timing browser and lifecycle evidence

Offsets are relative to the first successful profiler sample. Every Next identity
capture includes both an ISO `capturedAt` timestamp and the offset below. Validity
requires the pre-edit capture before T+100, the post-HMR capture between the edit and
T+140, and an independent deadline capture from T+140 through T+142.

| Run | Profiler attach | Browser signal | Marker A | Edit | Marker B | Next before | Next after HMR | Next at deadline | Next PID/start | Shutdown / audits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | 70.81 ms | T+60,001 | T+75,356 | T+100,001 | T+108,576 | T+89,989 | T+121,830 | T+140,070 | `31651` / `Sun Aug 2 17:57:46 2026` | graceful; pre/post pass |
| 2 | 71.49 ms | T+60,002 | T+67,758 | T+100,001 | T+108,077 | T+90,593 | T+125,985 | T+140,075 | `44710` / `Sun Aug 2 18:06:40 2026` | graceful; pre/post pass |
| 3 | 71.18 ms | T+60,002 | T+73,992 | T+100,002 | T+104,722 | T+86,550 | T+115,963 | T+140,081 | `52091` / `Sun Aug 2 18:10:42 2026` | graceful; pre/post pass |
| **Median** | **71.18 ms** | **T+60,002** | **T+73,992** | **T+100,001** | **T+108,077** | **T+89,989** | **T+121,830** | **T+140,075** | **unchanged in 3/3** | **pass in 3/3** |

The corresponding before / post-HMR / deadline `capturedAt` triples were
`15:59:09.164Z` / `15:59:41.005Z` / `15:59:59.245Z` for run 1,
`16:08:03.366Z` / `16:08:38.758Z` / `16:08:52.848Z` for run 2, and
`16:12:00.966Z` / `16:12:30.379Z` / `16:12:54.497Z` for run 3, all on
2026-08-02. The browser JSON retains the full ISO strings on both the capture fields
and embedded identity objects.

Each run retained the same actual Next PID/start, Node 24 executable, and
`next-server (v16.2.11)` command across all three captures. Marker B was observed on
the already-mounted page with no post-edit navigation or reload. The normal lazy
scheduler/shared-worker startup path was exercised in every run; no due schedule was
present during the bounded windows. Complete-tree shutdown and port/process
post-audits passed in all three runs.

One attempted run, `stable-cpu-baseline-v2-2`, was correctly rejected and retained as
withdrawn evidence: marker B appeared at T+130,603, but the post-HMR Next capture
completed at T+140,150 and therefore missed the T+140 gate by 150 ms. Its values are
excluded from every median. A separate preflight attempt was stopped before browser
timing when seed verification and dev launch initially shared the same millisecond;
its cleanup audit passed and it produced no accepted report.

Canonical evidence is under
`/private/tmp/open-mercato-standalone-memory-baseline/.mercato/dev-rss/`:

- Accepted reports: `stable-cpu-baseline-v2-1.json`, `stable-cpu-baseline-v2-2-retry.json`, and `stable-cpu-baseline-v2-3.json`.
- Accepted validity envelopes: matching `evidence/stable-cpu-baseline/*-validity.json` files.
- Browser timing/identity JSON: matching `evidence/stable-cpu-baseline/browser/*-browser.json` files.
- Marker screenshots: matching `evidence/stable-cpu-baseline/browser/*-marker-{a,b}.png` files.
- Identity, canonical seed manifest, lifecycle logs, withdrawal evidence, and bounded pre/post audits: `evidence/stable-cpu-baseline/`.

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
