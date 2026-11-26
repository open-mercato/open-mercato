# perf/ — Agent Rules

Performance harness for the CRM. Runbook: [`README.md`](README.md). Contracts: [`docs/contracts.md`](docs/contracts.md).
Spec: `.ai/specs/2026-11-26-crm-performance-test-plan.md`.

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
