# F. Success Metrics & Tracking

> KPI dashboard, alert thresholds, and ds-health-check.sh script for measuring migration progress.

---

## KPI Dashboard

| # | Metric | Current value | Target | Target date | How to measure |
|---|--------|--------------|--------|-------------|----------------|
| 1 | Hardcoded semantic colors | 372 | 0 | v0.6.0 (8 wk.) | `rg 'text-red-\|bg-red-\|text-green-\|bg-green-\|text-emerald-\|bg-emerald-\|text-amber-\|bg-amber-\|text-blue-[0-9]\|bg-blue-[0-9]' --type tsx -c \| awk -F: '{s+=$2} END{print s}'` |
| 2 | Arbitrary text sizes | 61 | 1 (exception: `text-[9px]`) | v0.6.0 | `rg 'text-\[\d+px\]' --type tsx -c \| awk -F: '{s+=$2} END{print s}'` |
| 3 | Empty state coverage | 21% (31/150) | 80% | v0.7.0 (12 wk.) | Manual audit + grep for EmptyState/TabEmptyState imports |
| 4 | Loading state coverage | 59% (89/150) | 90% | v0.7.0 | Grep for LoadingMessage/Spinner/isLoading patterns |
| 5 | aria-label coverage | ~50% | 95% | v0.7.0 | Automated a11y scan (axe-core in Playwright) |
| 6 | Notice component usage | 7 files | 0 | v0.6.0 | `rg "from.*Notice" --type tsx -l \| wc -l` |
| 7 | ErrorNotice usage | 2 files | 0 | v0.6.0 | `rg "ErrorNotice" --type tsx -l \| wc -l` |
| 8 | Inline SVG count | 12 files | 0 | v0.7.0 | `rg '<svg' --type tsx -l --glob '!**/__tests__/**' \| wc -l` |
| 9 | Raw fetch() count | 8 | 0 | v0.7.0 | `rg 'fetch\(' --type tsx --glob '**/backend/**' -l \| wc -l` |
| 10 | StatusBadge adoption | 0 | 100% status displays | v0.7.0 | Manual audit |

## Reporting script

```bash
bash .ai/scripts/ds-health-check.sh          # add --lint for authoritative per-rule counts
```

The script is the single source of truth for these metrics; it is intentionally
not reproduced here, because an embedded copy drifts from the implementation it
claims to document (#5095). It reports hardcoded status colors, arbitrary text
sizes, deprecated `Notice`/`ErrorNotice` usage, the legacy `Alert` variant API,
arbitrary z-index values, inline SVG, raw `fetch()` in backend code, empty-state
and loading-state coverage, semantic token adoption (including `destructive-solid`
loudness and the token parity/contrast gate), Token Snapshot Drift and DS lint
opt-outs, followed by a per-module breakdown of the top offenders.

**Tracking cadence:** Run at the beginning of every sprint. The report is saved to `.ai/reports/ds-health-latest.txt`, overwriting the previous run — the trend lives in git history (`git log -p .ai/reports/ds-health-latest.txt`). Comparison with the previous run is automatic.

---

---

## See also

- [Enforcement](./enforcement.md) — migration plan measured by these metrics
- [Success Metrics Beyond Code](./success-metrics-cx.md) — human metrics (CX, adoption)
- [Iteration](./iteration.md) — feedback cycle based on these metrics
