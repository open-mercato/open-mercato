# Notify — 2026-06-04-crudform-integration-tests

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-06-04T20:10:00Z — run started
- Brief: author automated CrudForm field-persistence integration tests (incl. custom fields),
  one stacked PR per module, gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED`
  (default false → run; set → skip). Resumable. Source: #2466 + prior manual-QA run folder.
- External skill URLs: none
- Decisions (user-confirmed via AskUserQuestion):
  1. Foundation PR first (shared harness + flag + docs + 1 reference module), then stacked
     per-module PRs branched off it.
  2. Tier-A rich-field modules first (resources/staff/catalog/customers/auth/sales/workflows),
     then sweep the rest.
- Base: origin/develop @ 0bd8b3aab (user asked to use latest develop).

## 2026-06-04T20:55:00Z — foundation complete + final gate green
- Steps 1.1–1.5 landed (5 lean commits). Harness + skip-gate + jest unit tests + currencies
  reference spec + docs.
- Final gate: build:packages ✅, generate ✅, typecheck 21/21 ✅, i18n:check-sync ✅,
  core jest 21/21 ✅. build:app/test:create-app/ds-guardian skipped (tests+docs only — justified).
- Integration smoke on live :3000: TC-CUR-CRUDFORM-001 passes (default) and skips when
  OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED=1. Harness proven end-to-end + skippable.
- Opening foundation PR; per-module rollout tracked in MODULE-LEDGER.md.

## 2026-06-04T21:45:00Z — 3 green PRs shipped; per-module pattern proven
- #2548 foundation (currencies A5), #2551 resources (A1), #2553 staff (A2). All verified green
  vs live :3000 (create→read→assert→update→read→assert→delete) AND skip with the disable flag.
- Coverage proven across the hardest cases: custom fields (text/int/select/boolean/date/float/
  currency), multiselect arrays (role_ids/tags), FK prerequisites, partial-update CF retention.
- Used research+live-probe subagents per module (resources, staff) — fast, accurate contracts.
- Remaining Tier-A/B/C modules are mechanical applications of the same harness; recipe + gotchas
  captured in HANDOFF.md, status in MODULE-LEDGER.md. Resumable.
