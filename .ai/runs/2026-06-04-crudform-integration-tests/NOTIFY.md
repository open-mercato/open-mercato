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
