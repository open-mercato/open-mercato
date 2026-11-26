# Perf results

One folder per run: `<YYYY-MM-DD>-<tier>-<scenario>-<label>/`, created by `perf/bin/perf run`.

| File | Committed | Content |
|---|---|---|
| `run.json` | yes | Run metadata: git SHA, image digest, modules, env hash (secrets redacted), migration head, dataset anchor and age, hardware, generator location, RTT calibration, k6 version, window, parameters, `localValidation` |
| `report.md` | yes | Report per the spec template: environment, summary, per-tag latency by step, journeys and Web Vitals, resources, database, findings, limitations |
| `report.json` | yes | Aggregated statistics read by `perf/bin/perf compare` (no secrets, statement text truncated) |
| `raw/` | no (gitignored) | k6 `summary.json` and `metrics.csv.gz`, `pg-snapshot.json`, service logs |

Rules:

- Commit `run.json`, `report.md` and `report.json` only; review them for secrets first.
- Runs marked `local-validation` are harness checks on a laptop, never baseline numbers. The `2026-11-26-S-*-local` folders are such checks. **No VPS run exists yet**, and tier S has not been measured on the target hardware.
- Round reports go to `<YYYY-MM-DD>-round-<n>/report.md` with ranked findings (`file:line`, mechanism, P1/P2/P3).
- Compare runs with `perf/bin/perf compare <a> <b>`; it refuses incomparable runs unless `--force`.
