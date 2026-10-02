# Accessibility audit materials

Product contract: [WCAG 2.2 AA specification](../../specs/2026-10-01-wcag-22-aa-accessibility.md). Related plans: [WCAG Guardian](../../specs/2026-10-01-wcag-guardian-pr-review.md) and [Storybook quality gates](../../specs/2026-10-01-storybook-wcag-quality-gates.md).

- [Criterion index](wcag-22-aa-matrix.csv): all 55 WCAG 2.2 A/AA criteria with the surface family they usually concern and the planned evaluation methods. It carries no status or evidence columns; it is not the product evaluation ledger.
- [Scope manifest template](scope-manifest.template.json): release/build, delivered modules, supported configurations, complete processes, owners and required checks. Populate and approve before the baseline audit.
- [Evaluation ledger template](evaluation-records.template.csv): one record per criterion, surface, flow, configuration, state, method and snapshot. Missing or stale required evidence prevents a pass.

Method values in `plannedMethods` (joined with `+`) and in the ledger `method` column are `source`, `automated`, `browser`, `measurement`, `manual` and `manual_at`, as defined in the [report contract](../../skills/om-wcag-guardian/references/review.md#methods). `automated` covers only the part of a criterion a tool can detect and never closes a criterion alone. Ledger `status` values are `not_evaluated`, `pass`, `fail` and `not_applicable`; a record that does not exist is `not_evaluated`.

These are versioned instructions and empty templates, not collected audit evidence or a conformance claim. Keep executable integration tests in module `__integration__` directories. Keep heavy or private operational evidence in an approved artifact store, sanitized and referenced by hash; do not commit customer data, credentials, local paths or session reports.

The skill source is at `.ai/skills/om-wcag-guardian/`, registered in the opt-in `analysis` tier. Default installation, review routing and CI integration remain unimplemented.
