# Notify — 2026-05-27 dev-mode-package-watch-consolidation

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-27T05:45:00Z — run started

- Brief: "find quick wins like lazy load components or so to save memory usage in the dev mode … at least saving 1-2 Gb of memory; focus on one such a low hanging fruit … implement it as a PR".
- External skill URLs: none.
- Mode: Spec-implementation (multi-phase profile → POC → measure → implement).

## 2026-05-27T05:55:00Z — profiling complete (Step 1.1)

- POC scripts at `/tmp/poc-memwatch/` measured 18 idle per-package watchers at 1 129 MB total RSS, vs 125 MB for a single consolidated watcher → ~1.0 GB savings target met.
- Decision: implement consolidated `scripts/watch-packages.mjs` and keep the Turbo per-package path behind `OM_WATCH_PACKAGES_MODE=legacy`. Plan locked.
