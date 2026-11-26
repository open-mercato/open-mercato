# CRM performance harness — runbook

Repeatable load tests for the CRM (`customers`) and every module a CRM request touches.
Spec: [`.ai/specs/2026-11-26-crm-performance-test-plan.md`](../.ai/specs/2026-11-26-crm-performance-test-plan.md).
Contracts between the seeder, k6 and the scripts: [`docs/contracts.md`](docs/contracts.md). Agent rules: [`AGENTS.md`](AGENTS.md).

The goal is exploration and a baseline, not pass/fail. Thresholds are reference lines; only the safety
aborts (error rate > 20% for 2 min, or p95 > 30 s) stop a run.

## Status: what has and has not been tested

> **No performance test has run on the target VPS yet. No tier — not S, not M — has been measured on the target hardware.**
>
> The only runs so far are **Phase 2 local validation**: on 2026-11-26, the harness was exercised on one laptop.
> k6, the app and monitoring shared that machine, with tier S data.
> Their purpose was to prove the scripts, seeder, snapshot/restore, dashboards and reports work end to end.
> The latencies in `results/2026-11-26-S-*-local/` are distorted by the shared laptop and are **not results for tier S**.
> The Phase 2 report (`results/2026-11-26-phase2-local/report.md`) lists hypotheses those runs surfaced; each one still has to be measured on the VPS.
> The VPS work (Phases 0, 1 and 3–10) is still to do, starting with tier S.

## Quickstart for a new tester (or the agent guiding them)

**Decided setup:**
- The app runs on **one VPS** (`vps-6c16g`: 6 vCPU / 16 GB / 80 GB).
- The load is generated **from the tester's laptop** over the internet. There is no generator VPS.
- Everything is driven from the laptop with `perf/bin/perf`. Commands reach the VPS over SSH, and the tester never works on the VPS by hand except for the one-time provisioning.

**Collect these first.** An agent asks for them before running anything:
1. VPS public IP, the SSH user, and confirmation that the tester's SSH key works (`ssh -o BatchMode=yes <user>@<ip> true`).
2. Whether the vCPUs are dedicated, and the disk type. These go into `config/hardware.md`, row `vps-6c16g`.
3. The tester's public IP (`curl -s https://ifconfig.me`), for the VPS firewall rule.
4. The laptop that will be used for **every** run of the round, and where it will be (wired, no VPN). This becomes `GENERATOR_LOCATION`.

**Laptop prerequisites:**
- Docker Desktop (or Docker Engine) with the compose plugin,
- Node.js 20+, bash, an SSH client,
- a clone of this branch,
- ~5 GB free for the k6 image and results.

**VPS prerequisites:**
- Ubuntu 24.04, Docker Engine 24+ with the compose plugin, Node.js 20+,
- a `perf` user in the `docker` group,
- this branch cloned at `SUT_REPO_DIR`.

**Order of work.** Do not skip steps; the quickstart is only a map.
1. Phase 0 and 1 below, steps 1–7:
   - confirm the hardware,
   - set the firewall,
   - prepare the VPS,
   - create the target file,
   - generate the secrets, **edit `sut.local.env` and push it again**,
   - open the SSH tunnel,
   - `build` + `up`, then the exposure check.
2. Phase 3, tier S: seed and snapshot.
3. Phases 4–5 on S: smoke, then baseline twice.
4. Phase 3, switch to M: remove S, then seed and snapshot M.
5. Phases 4–9 on M.
6. Phase 10: the round report comparing S and M.

**Same laptop as an earlier local run?** If this laptop ran the Phase 2 local validation before, move its state aside first: `mv perf/.state perf/.state-local && mv perf/config/sut.local.env perf/config/sut.local.env.local`. `perf/bin/perf` refuses to use state that belongs to another target.

Grafana is at http://127.0.0.1:13300 while the SSH tunnel is open.

## Layout

| Path | What |
|---|---|
| `bin/perf` | Entrypoint (bash → `scripts/cli.mjs`, Node ≥ 20, no npm dependencies) |
| `config/` | `target.example.env`, `sut.example.env`, `hardware.md`, `tiers.json`, `workload.json` |
| `sut/compose.perf.yml` | Overlay on `docker-compose.fullapp.yml`: async queue, `worker` + `scheduler` containers, Postgres flags, Caddy `tls`, Mailpit |
| `monitoring/` | Prometheus, Grafana (6 provisioned dashboards), node-exporter, cAdvisor, postgres/redis exporters, OTLP collector |
| `generator/` | Pinned `grafana/k6:1.8.2-with-browser` compose service |
| `k6/` | Journeys and scenarios (`smoke`, `baseline`, `mixed`, `interference`, `browser`) |
| `scripts/` | Orchestration, `provision-users`, `calibrate`, `pg-snapshot`, `report`, `compare`, `build-dashboards` |
| `data/<tier>/` | `manifest.json` + `catalog.json` from the seeder (gitignored) |
| `.state/` | Tenant, user pool, snapshot and restore markers (gitignored, mode 700) |
| `results/<run-id>/` | `run.json`, `report.md`, `report.json` committed; `raw/` gitignored |

Compose project `om-perf`, `DEPLOY_ENV=perf`, network `mercato-network-perf-v2`. Files, in order:
`docker-compose.fullapp.yml`, `perf/sut/compose.perf.yml`, `perf/monitoring/compose.monitoring.yml`, env file `perf/config/sut.local.env`.

### Deviation from the spec: TLS

TLS is terminated by a small Caddy service `tls` (in `sut/compose.perf.yml`), not by the Traefik overlay.
The stock overlay needs Let's Encrypt plus a customer-domain forward-auth middleware that adds a request
per request. Caddy uses `tls internal` (self-signed; k6 runs with `INSECURE_TLS=1` and browser VUs with
`ignoreHTTPSErrors`) or, with `PERF_TLS_CADDYFILE=Caddyfile.domain`, an ACME certificate for `PERF_TLS_DOMAIN`.
The `app` port is never published; Caddy publishes `PERF_TLS_BIND:PERF_TLS_PORT` (default `127.0.0.1:8443`).
Caddy also exports server-side request durations (`caddy_http_request_duration_seconds`) to Prometheus.

## Prerequisites

- Docker Engine 24+ with the compose plugin 2.24+ (`!reset`/`!override` tags), Node.js 20+, bash. Secrets are generated with `node:crypto` (no openssl needed).
- Disk on the SUT, measured at S (see `config/hardware.md` → Disk budget). Only one tier is kept on disk at a time:

  | Tier | Disk needed | Note |
  |---|---|---|
  | S | ~45–50 GB | |
  | M (100k) | ~70 GB | |
  | L | ~540 GB | **does not run on `vps-6c16g`** |
- Local laptop validation: Docker Desktop with ≥ 8 vCPU, ≥ 16 GB RAM and ≥ 40 GB free in its virtual disk.
- VPS: SSH key access from the tester's laptop, reachable non-interactively (`ssh -o BatchMode=yes`).

## Safety rules (read first)

1. Only targets in `perf/config/target.local.env`. The first state-changing command on a new target needs `--yes-this-is-a-perf-target`.
2. Never point the harness at a shared, staging or production stack. It seeds, mutates and overloads it.
3. Phases run one at a time. Restore before every load phase (`run` refuses otherwise).
4. Secrets live only in `perf/config/sut.local.env` and `perf/.state/` (gitignored). Reports redact env values.

## Phase 2 — local validation (tier S, laptop) — done on 2026-11-26

This phase checks the harness, not the app. Its numbers are not baseline numbers, and every report is marked `local-validation`.
It was completed once; repeat it only after changing the harness. The sequence is kept here for that purpose.

```bash
cp perf/config/target.example.env perf/config/target.local.env   # defaults target the local stack
perf/bin/perf init-secrets                                        # writes perf/config/sut.local.env (mode 600)
perf/bin/perf build                                               # docker compose build app (15–40 min)
perf/bin/perf up --yes-this-is-a-perf-target                      # first boot runs mercato init: 1–15 min
perf/bin/perf tenant                                              # measured tenant via `mercato auth setup --json` + `mercato seed:defaults`
perf/bin/perf users                                               # 200 users + staff team members: ~1 min
perf/bin/perf seed --background --tier S                          # 2 background tenants × 5%: ~2 min
perf/bin/perf seed --tier S                                       # seed-perf + reindex + Meilisearch + VACUUM: ~25 min
perf/bin/perf snapshot --tier S                                   # ~1 min
perf/bin/perf lint                                                # k6 inspect of every scenario

perf/bin/perf restore --tier S && perf/bin/perf run smoke --label local
perf/bin/perf restore --tier S && perf/bin/perf run baseline --samples 20 --label local
perf/bin/perf restore --tier S && perf/bin/perf run step --profile mini --label local
perf/bin/perf restore --tier S && perf/bin/perf run browser --label local
```

UIs (loopback only):

| UI | Address |
|---|---|
| Grafana | http://127.0.0.1:3300 (anonymous viewer; admin password in `sut.local.env`) |
| Prometheus | http://127.0.0.1:9090 |
| Mailpit | http://127.0.0.1:8025 |
| App | https://localhost:8443 |

## Phase 0 and 1 — VPS provisioning (laptop → VPS)

The load comes from the tester's laptop over the internet, so plan for these four things:
- **Network time in every sample.** Every k6 latency includes the laptop → VPS round-trip time and its jitter.
  - `run` measures that round-trip time before and after each run.
  - The report shows the **server-side p95 at the proxy** (Caddy, measured on the VPS), next to the k6 numbers. Compare rounds on the server-side p95.
  - The report flags the run when the network was noisy.
- **One generator location per round.** Use the same laptop, from the same place, over the same wired connection, with no VPN and no sleep. Keep `GENERATOR_LOCATION` identical; `compare` refuses runs from different locations.
- **The laptop is the generator's ceiling.** About 200 protocol VUs are fine. Keep browser VUs at 2–5.
  - If k6 reports `dropped_iterations`, or the laptop's CPU stays above 70%, that step is invalid.
  - Close heavy applications during a run.
- **Long runs.** The soak (4–8 h) needs the laptop awake, plugged in and connected for the whole time.

Steps:

1. **Confirm the hardware.** Fill the `vps-6c16g` row of `config/hardware.md`: whether the vCPUs are dedicated, the disk type, the OS.
2. **Set the firewall** in the provider's cloud firewall. Docker bypasses `ufw`, so `ufw` rules do not protect published ports.
   - Allow SSH from the tester's IP.
   - Allow `PERF_TLS_PORT` (8443) **from the tester's public IP only**.
   - Nothing else is reachable. Grafana, Prometheus and Mailpit stay on the VPS loopback and are reached through SSH tunnels.
3. **Prepare the VPS:** install Docker and Node.js, create the `perf` user in the `docker` group, and clone this branch at the chosen commit into `SUT_REPO_DIR`.
4. **Create the target file on the laptop:** `cp perf/config/target.laptop-vps.example.env perf/config/target.local.env` and fill in the `<...>` values.
   On a Linux laptop, set `GENERATOR_NETWORK=host` and `PROM_RW_URL=http://127.0.0.1:19090/api/v1/write` instead.
5. **Generate the secrets.** `perf/bin/perf init-secrets` on the laptop generates them and pushes `sut.local.env` to the VPS.
   - Edit `perf/config/sut.local.env` on the laptop: copy the `vps-6c16g` column of `config/hardware.md`.
   - Set `PERF_TLS_BIND=0.0.0.0`, `PERF_TLS_HOST=<sut-public-ip>`, `APP_URL=https://<sut-public-ip>:8443` and `PERF_APP_ALLOWED_ORIGINS=https://<sut-public-ip>:8443`.
   - Run `init-secrets` again to push the edited file.
6. **Open the tunnel** for the whole session, in a second terminal on the laptop. It carries k6 remote write and the report queries:
   `ssh -N -L 19090:127.0.0.1:9090 -L 13300:127.0.0.1:3300 perf@<sut-public-ip>`.
   - Grafana is then at http://127.0.0.1:13300.
   - Leave this tunnel open whenever you `run`, `report` or `compare`.
7. **Check exposure.** `perf/bin/perf build`, then `perf/bin/perf up --yes-this-is-a-perf-target`. Then, from a host other than the tester's laptop, run `nmap -Pn -p- <sut-public-ip>`: it must show only SSH. From the laptop, `curl -sk https://<sut-public-ip>:8443/api/healthz` must return 200.

## Phase 3 — datasets on the VPS (S first, then M)

**Only one tier fits on the 80 GB `vps-6c16g` disk at a time.** Run the S phases first, then switch to M. **Tier L cannot run on `vps-6c16g`** (≈ 540 GB of disk; see `config/hardware.md`).

1. **Tier S.** Run `tenant`, `users`, `seed --background --tier S`, `seed --tier S`, `snapshot --tier S`.
   - Record the seed, snapshot and restore durations in `config/hardware.md`.
   - Verify a restore round trip: `restore --tier S`, then compare row counts against the `seed-perf` manifest and the catalog.
2. **Run Phases 4–5 on S** (smoke, then baseline twice). These give the S-versus-M comparison on the same hardware.
3. **Switch to M:** `perf/bin/perf down --volumes --purge-secrets`, `ssh perf@<sut-public-ip> docker volume rm meili_s_template`, then `up`, `tenant`, `users`, `seed --background --tier M`, `seed --tier M`, `snapshot --tier M`.
   M seeding takes about an hour. Run it inside `tmux` on the laptop, or keep the laptop awake.
4. **Verify the M restore round trip** the same way as for S.

## Phases 4–9 — measurement runs

Every phase is `restore` then `run`. Phases never overlap. `<T>` is the tier currently on disk: S during the S pass (Phases 4–5 only), then M (Phases 4–9).

| Phase | Command | Duration | Exit criteria |
|---|---|---|---|
| 4 smoke (S, then M) | `perf/bin/perf restore --tier <T> && perf/bin/perf run smoke --tier <T>` | ~10 min (5 min load + restore and report) | 0 unexpected errors; every journey and tag has samples |
| 5 baseline (S, then M) | `perf/bin/perf restore --tier <T> && perf/bin/perf run baseline --tier <T> --label r1` (twice per tier; `r2` for the second run) | 30–60 min | ≥ 50 samples per tag after warmup; p50 of the two runs within 10% (`compare`) |
| 6 step (M) | `perf/bin/perf restore --tier M && perf/bin/perf run step --tier M` | ~65 min | saturation step identified, or 200 VUs reached |
| 7 interference (M) | `perf/bin/perf restore --tier M && perf/bin/perf run interference --tier M --knee <VUs>` | ~35 min | read p95 delta vs control, bulk completion time, queue backlog reported |
| 8 stress (M) | `perf/bin/perf restore --tier M && perf/bin/perf run stress --tier M --knee <VUs>` | ~35 min | recovery to the Phase 6 25-VU values within 5 min, or the failure mode documented |
| 9 soak (M) | `perf/bin/perf restore --tier M && perf/bin/perf run soak --tier M --knee <VUs>` | 4–8 h | heap, RSS, connections, queue depth, Redis memory flat or the leak quantified |

`--knee` is the saturation VU count from the Phase 6 report (omit it when no knee was found; the profiles fall back to 300/400/600 and 50 VUs).
Each run writes `perf/results/<date>-<tier>-<scenario>-<label>/` with `run.json`, `report.md`, `report.json` and `raw/`.

What `run` does: checks the target confirmation and the restore marker → writes `run.json` (git SHA, image
digest, modules, env hash, migration head, dataset age, hardware facts, k6 version) → calibrates RTT with
30 × `GET /api/healthz` (again after k6, to detect network drift) → resets `pg_stat_statements` → marks the restore as used → runs k6 (CSV +
Prometheus remote write) → captures `pg-snapshot.json` (top statements, generic plans, auto_explain plans,
lock waits, temp files) and service logs → generates the report.

## Phase 10 — round analysis

```bash
perf/bin/perf report perf/results/<run-id>             # regenerate a report (Prometheus must still hold the window)
perf/bin/perf compare perf/results/<a> perf/results/<b> [--force] [--out perf/results/<a>-vs-<b>.md]
```

`compare` refuses runs whose scenario, tier, profile, hardware profile, generator location or module set
differ (`--force` overrides). It flags a migration-head difference, datasets older than 7 days and marks
time-relative tags (summary, stuck/needs-attention, dashboard, calendar, planned interactions) as not
comparable when dataset ages differ by more than 7 days. Fill section 7 of each report with ranked
findings (`file:line`, mechanism, P1/P2/P3). Issues and fix PRs only on human request.

## Command reference

`perf/bin/perf help` lists every command. State files are documented in `docs/contracts.md`.

| Command | Notes |
|---|---|
| `init-secrets` | Generates missing secrets only; existing values are kept. Pushes the file to the SUT when `SUT_SSH` is set |
| `up [--build]` | Refuses default/placeholder secrets; waits for `/api/healthz` through TLS; creates `pg_stat_statements` |
| `down [--volumes] [--purge-secrets]` | `--purge-secrets` deletes the user pool and tenant credentials; keys stay (snapshots need them) |
| `seed --tier T` | Requires `tenant` and `users`. Exit codes of `seed-perf`: 2 usage, 3 verification failed, 4 resumable (`--resume`). If the seeder finished but a later step failed, re-run with `--resume --skip-query-index` (the seeder no-ops on a completed checkpoint) |
| `snapshot --tier T` | Only after a verified seed (`.state/seed-<T>.json`); stops app/worker/scheduler; `CREATE DATABASE … STRATEGY FILE_COPY` |
| `restore --tier T` | Refuses when the encryption-key fingerprint differs; flushes Redis; re-runs migrations via the app start |
| `run <scenario>` | `smoke`, `baseline`, `step`, `stress`, `soak`, `interference`, `browser`; `--profile mini` for Phase 2 |
| `lint` | `k6 inspect` of every `k6/scenarios/*.js` in the pinned image |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Login 429 for many VUs | Login IP rate limit. `RATE_LIMIT_LOGIN_IP_POINTS` (10000) must reach the app: `docker compose … exec app env \| grep RATE_LIMIT`; restart after editing `sut.local.env` |
| k6 `dropped_iterations` > 0 or generator CPU > 70% | The laptop is the bottleneck; that step is invalid. Close other applications, use fewer browser VUs, or stop at the previous step |
| Pool exhaustion: `om_db_pool_pending_requests` > 0, timeouts after 6 s | `DB_POOL_MAX` too small for the step, or slow statements hold connections. Check section 6 of the report before raising the pool |
| `restore` fails with "source database is being accessed by other users" | Something still connects to the template or the DB. `restore` terminates backends, but a manual `psql` session or a running `mcp`/`opencode` profile can hold one. Stop it and retry |
| `run` says a load phase already ran since the last restore | Expected: restore first. Never edit `last-restore.json` by hand |
| `up` refuses to start | A secret is unset, a placeholder, or still the compose default. Run `init-secrets` |
| Browser VUs cannot log in | Cookies are `Secure`; the browser must use `https://`. Check `PERF_APP_ALLOWED_ORIGINS` contains the origin k6 uses |
| Meilisearch count never settles during `seed` | The `worker` service must run the fulltext-indexing queue: `docker compose … logs worker`. The wait times out after 4 h |
| No OM runtime metrics in Grafana | `TELEMETRY_BACKEND=otlp` must reach the app; the OTLP reader exports every 60 s, so wait two minutes; check `otel-collector` logs |
| Empty BullMQ panels | Queue keys use the `bull:<queue>:<state>` prefix; check with `redis-cli --scan --pattern 'bull:*' \| head` |
| cAdvisor shows no containers | Older cAdvisor cannot read the containerd image store (default in Docker Desktop and fresh Docker Engine 29). The pinned `ghcr.io/google/cadvisor:v0.60.6` with the docker/containerd socket mounts handles it; check `docker logs mercato-cadvisor-perf` for `failed to identify the read-write layer ID` |
| Report says "Network was noisy" | The laptop → VPS round-trip time rose or jittered during the run. Check Wi-Fi/VPN/other traffic and re-run; compare on the server-side p95 |
| k6 cannot reach `host.docker.internal:19090` | The SSH tunnel is not open, or (Linux laptop) use `GENERATOR_NETWORK=host` with `PROM_RW_URL=http://127.0.0.1:19090/api/v1/write` |
| App never becomes healthy after a restart, log says `Another Open Mercato production server is already running` | Stale `.mercato/server-start.lock` after an unclean stop (Phase 2 finding P1-4). `restore` recreates the containers; otherwise `docker compose … up -d --force-recreate app worker scheduler` |
| Template database missing after `down --volumes` | Templates live inside the Postgres volume. Re-seed and re-snapshot |
