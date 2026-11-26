# perf/ — Agent Rules

Performance harness for the CRM. Runbook: [`README.md`](README.md). Contracts: [`docs/contracts.md`](docs/contracts.md).
Spec: `.ai/specs/2026-11-26-crm-performance-test-plan.md`.

## Current status (keep accurate)

- **No VPS phase has run.** Tier S and tier M have **not** been measured on the target hardware (`vps-6c16g`).
- The only results are the Phase 2 harness checks on a laptop (`results/2026-11-26-*-local`, `results/2026-11-26-phase2-local/report.md`). Never present them as tier S results, a baseline or "done" testing. They are hypotheses for the VPS rounds.
- Setup: one SUT VPS (`vps-6c16g`, 6 vCPU / 16 GB / 80 GB fixed disk). k6 runs on the tester's laptop over the internet (no generator VPS). The app is tested as shipped (one app process). Tiers S and M are run one at a time. **L cannot run on this VPS.**

## Guiding a tester

- Start from `README.md` → "Status" and "Quickstart for a new tester". Collect the four inputs it lists (SSH access, hardware facts, the tester's public IP, the fixed laptop and location) before running any command.
- Walk the phases in README order. Explain each command before running it and what its exit criteria are, and show the report path after each run.
- Before every load phase, check that the SSH tunnel is open, the laptop is on the agreed wired connection, and nothing heavy runs locally. Stop and re-run when the report says "Network was noisy".
- Fill in `config/hardware.md` (row `vps-6c16g`, measured durations) as facts become known.

## Always

- Drive everything through `perf/bin/perf`; follow the README phase by phase.
- Run phases serially, one load phase per SUT at a time, and `restore` before every load phase.
- Change `docs/contracts.md` first when a shared format changes, then every consumer.
- Run `node --test scripts/__tests__/perf-*.test.mjs` after touching `perf/scripts/`.
- Stop and report when a safety abort fires (k6 exit 99, error rate > 20% for 2 min, p95 > 30 s).

## Ask First

- Ask before re-seeding or deleting a snapshot, changing `tiers.json`/`workload.json` profiles, or raising load beyond the profile.
- Ask before filing issues or opening fix PRs; findings go into the report.

## Never

- Never target a host that is not in `perf/config/target.local.env`, and never a shared, staging or production stack.
- Never commit secrets, `*.local.env`, `.state/`, `data/` or `results/**/raw/`; never print secret values.
- Never edit `.state/last-restore.json` by hand to skip a restore.
- Never edit the `perf-v1` profile in place once a round used it; add `perf-v2`.

## Validation Commands

```bash
bash -n perf/bin/perf
node --test scripts/__tests__/perf-*.test.mjs
perf/bin/perf lint
```
