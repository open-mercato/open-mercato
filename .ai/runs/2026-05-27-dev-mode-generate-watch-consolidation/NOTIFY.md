# Notify — 2026-05-27 dev-mode-generate-watch-consolidation

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-27T07:20:00Z — run started
- Brief: find another dev-mode memory quick win beyond PR 2102.
- External skill URLs: none.
- Investigation summary:
  - PR 2102 already harvested the `watch:packages` consolidation (~1.1 GB).
  - Lazy worker / lazy scheduler supervisors already in place.
  - Heavy UI libraries already mostly dynamic-imported (Phase D partially done — see `packages/ui/src/backend/__tests__/lazy-heavy-libraries.test.ts`).
  - Stripe `loadStripe` already uses `/pure` entry.
  - `newrelic` is already gated by `NEW_RELIC_LICENSE_KEY`.
- Selected candidate: consolidate `mercato generate watch --skip-initial` into `mercato server dev` (in-process polling). Measured win on this machine: 193 MB.
- Deferred candidates (recorded in PLAN.md → Follow-up candidates): `serverExternalPackages` extension, per-queue worker consolidation, `ClientBootstrap` registry slimming.
