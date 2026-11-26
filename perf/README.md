# CRM performance harness — runbook

Repeatable load tests for the CRM (`customers`) and every module a CRM request touches.
Spec: [`.ai/specs/2026-11-26-crm-performance-test-plan.md`](../.ai/specs/2026-11-26-crm-performance-test-plan.md).
Contracts between the seeder, k6 and the scripts: [`docs/contracts.md`](docs/contracts.md). Agent rules: [`AGENTS.md`](AGENTS.md).

The goal is exploration and a baseline, not pass/fail. Thresholds are reference lines; only the safety
aborts (error rate > 20% for 2 min, or p95 > 30 s) stop a run.

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
- Disk: tier S ≈ 10 GB free, M ≈ 40 GB, L ≈ 150 GB (database + template copy + Meilisearch copy).
- Local: Docker Desktop with ≥ 8 vCPU and ≥ 16 GB RAM assigned.
- VPS: SUT and generator in the same region, SSH key access from the operator, `SUT_SSH` reachable non-interactively (`ssh -o BatchMode=yes`).

## Safety rules (read first)

1. Only targets in `perf/config/target.local.env`. The first state-changing command on a new target needs `--yes-this-is-a-perf-target`.
2. Never point the harness at a shared, staging or production stack. It seeds, mutates and overloads it.
3. Phases run one at a time. Restore before every load phase (`run` refuses otherwise).
4. Secrets live only in `perf/config/sut.local.env` and `perf/.state/` (gitignored). Reports redact env values.

## Phase 2 — local validation (tier S, laptop)

These numbers are not baseline numbers; every report is marked `local-validation`.

```bash
cp perf/config/target.example.env perf/config/target.local.env   # defaults target the local stack
perf/bin/perf init-secrets                                        # writes perf/config/sut.local.env (mode 600)
perf/bin/perf build                                               # docker compose build app (20–40 min first time)
perf/bin/perf up --yes-this-is-a-perf-target                      # first boot runs mercato init: 5–15 min
perf/bin/perf tenant                                              # measured tenant via `mercato auth setup --json` + `mercato seed:defaults`
perf/bin/perf users                                               # 200 users + staff team members: ~2–5 min
perf/bin/perf seed --background --tier S                          # 2 background tenants × 5%
perf/bin/perf seed --tier S                                       # seed-perf + reindex + Meilisearch + VACUUM
perf/bin/perf snapshot --tier S
perf/bin/perf lint                                                # k6 inspect of every scenario

perf/bin/perf restore --tier S && perf/bin/perf run smoke --label local
perf/bin/perf restore --tier S && perf/bin/perf run baseline --samples 20 --label local
perf/bin/perf restore --tier S && perf/bin/perf run step --profile mini --label local
```

UIs (loopback only): Grafana http://127.0.0.1:3300 (anonymous viewer; admin password in `sut.local.env`),
Prometheus http://127.0.0.1:9090, Mailpit http://127.0.0.1:8025, app https://localhost:8443.

Exit criteria: smoke, mini-baseline and mini step finish; every tag has samples; 0 unexpected errors in
smoke; Grafana shows k6, host, containers, Postgres and OM runtime data for the run window; `report.md`
is generated; seed, snapshot and restore durations are copied into `config/hardware.md`.

## Phase 0 and 3 — VPS provisioning

1. Pick machines per `config/hardware.md` and confirm the profile row.
2. Firewall (Docker bypasses `ufw`): use the provider's cloud firewall, `DOCKER-USER` iptables rules, or bind to the private IP.
   Only `PERF_TLS_PORT` is reachable, only from the generator. SSH from the operator.
3. On the SUT: clone the repo at the chosen commit into `SUT_REPO_DIR`.
4. On the generator: clone the same commit, then create `perf/config/target.local.env`:
   ```
   PERF_TARGET_NAME=vps-round1
   PERF_TARGET_KIND=vps
   BASE_URL=https://<sut-private-ip>:8443
   CONTROL_BASE_URL=https://<sut-private-ip>:8443
   SUT_SSH=perf@<sut-host>
   SUT_REPO_DIR=/srv/open-mercato
   GENERATOR_LOCATION=<provider>-<region>-generator
   HARDWARE_PROFILE=vps-8c32g
   K6_NETWORK=
   PROM_RW_URL=http://127.0.0.1:19090/api/v1/write
   PROM_QUERY_URL=http://127.0.0.1:19090
   ```
5. `perf/bin/perf init-secrets` on the generator generates the secrets and pushes `sut.local.env` to the SUT.
   Then edit `sut.local.env` with the `vps-6c16g` column of `hardware.md` (the decided SUT), set `PERF_TLS_BIND` and
   `PERF_TLS_HOST` to the SUT private IP and `APP_URL=https://<sut-private-ip>:8443`, and run `init-secrets` again to push it.
6. Open the tunnel the generator keeps for the whole session (remote write and report queries):
   `ssh -N -L 19090:127.0.0.1:9090 -L 13300:127.0.0.1:3300 perf@<sut-host>`.
   The operator reaches Grafana with `ssh -L 3300:127.0.0.1:3300 perf@<sut-host>`.
7. Same sequence as Phase 2 with `--tier S` (`build`, `up --yes-this-is-a-perf-target`, `tenant`, `users`, `seed --background --tier S`, `seed --tier S`, `snapshot --tier S`).
   **Only one tier fits on the 80 GB `vps-6c16g` disk at a time.** After the S runs, switch to M:
   `perf/bin/perf down --volumes --purge-secrets`, `docker volume rm meili_s_template`, then repeat the sequence with `--tier M`.
   M seeding takes about an hour; run it inside `tmux`. **Tier L cannot run on `vps-6c16g`** (≈ 540 GB of disk; see `perf/config/hardware.md`).
8. Verify a restore round trip: `restore --tier <T>`, then compare row counts (`seed-perf` manifest) and the catalog.
9. Port probe from a third host: `nmap -Pn -p- <sut-public-ip>` reaches nothing but SSH; from the generator only `PERF_TLS_PORT`.

## Phases 4–9 — measurement runs

Every phase is `restore` then `run`. Phases never overlap.

| Phase | Command | Duration | Exit criteria |
|---|---|---|---|
| 4 smoke | `perf/bin/perf restore --tier M && perf/bin/perf run smoke --tier M` | ~10 min | 0 unexpected errors; every journey and tag has samples |
| 5 baseline | `perf/bin/perf restore --tier M && perf/bin/perf run baseline --tier M --label r1` (twice; also S, before switching tiers) | 30–60 min | ≥ 50 samples per tag after warmup; p50 of the two runs within 10% (`compare`) |
| 6 step | `perf/bin/perf restore --tier M && perf/bin/perf run step --tier M` | ~65 min | saturation step identified, or 200 VUs reached |
| 7 interference | `perf/bin/perf restore --tier M && perf/bin/perf run interference --tier M --knee <VUs>` | ~35 min | read p95 delta vs control, bulk completion time, queue backlog reported |
| 8 stress | `perf/bin/perf restore --tier M && perf/bin/perf run stress --tier M --knee <VUs>` | ~35 min | recovery to the Phase 6 25-VU values within 5 min, or the failure mode documented |
| 9 soak | `perf/bin/perf restore --tier M && perf/bin/perf run soak --tier M --knee <VUs>` | 4–8 h | heap, RSS, connections, queue depth, Redis memory flat or the leak quantified |

`--knee` is the saturation VU count from the Phase 6 report (omit it when no knee was found; the profiles fall back to 300/400/600 and 50 VUs).
Each run writes `perf/results/<date>-<tier>-<scenario>-<label>/` with `run.json`, `report.md`, `report.json` and `raw/`.

What `run` does: checks the target confirmation and the restore marker → writes `run.json` (git SHA, image
digest, modules, env hash, migration head, dataset age, hardware facts, k6 version) → calibrates RTT with
30 × `GET /api/healthz` → resets `pg_stat_statements` → marks the restore as used → runs k6 (CSV +
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
| k6 `dropped_iterations` > 0 or generator CPU > 70% | The generator is the bottleneck; that step is invalid. Use a larger generator or fewer browser VUs |
| Pool exhaustion: `om_db_pool_pending_requests` > 0, timeouts after 6 s | `DB_POOL_MAX` too small for the step, or slow statements hold connections. Check section 6 of the report before raising the pool |
| `restore` fails with "source database is being accessed by other users" | Something still connects to the template or the DB. `restore` terminates backends, but a manual `psql` session or a running `mcp`/`opencode` profile can hold one. Stop it and retry |
| `run` says a load phase already ran since the last restore | Expected: restore first. Never edit `last-restore.json` by hand |
| `up` refuses to start | A secret is unset, a placeholder, or still the compose default. Run `init-secrets` |
| Browser VUs cannot log in | Cookies are `Secure`; the browser must use `https://`. Check `PERF_APP_ALLOWED_ORIGINS` contains the origin k6 uses |
| Meilisearch count never settles during `seed` | The `worker` service must run the fulltext-indexing queue: `docker compose … logs worker`. The wait times out after 4 h |
| No OM runtime metrics in Grafana | `TELEMETRY_BACKEND=otlp` must reach the app; the OTLP reader exports every 60 s, so wait two minutes; check `otel-collector` logs |
| Empty BullMQ panels | Queue keys use the `bull:<queue>:<state>` prefix; check with `redis-cli --scan --pattern 'bull:*' \| head` |
| cAdvisor shows no containers on macOS | Docker Desktop hides cgroup paths; container panels may be partial locally. They work on a Linux VPS |
| Template database missing after `down --volumes` | Templates live inside the Postgres volume. Re-seed and re-snapshot |
