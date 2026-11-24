# Deals aggregate filter parity

Source doc: .ai/specs/2026-11-24-deals-aggregate-filters.md

The aggregate endpoint should use the deals list's advanced filters and attention flag when calculating totals across the authorized organization scope. See issue #8385 and spec PR #10532.

## Implementation Plan

1. Share the scoped deal predicates and apply them to stage aggregation.
2. Add API parity coverage and focused coverage for cache and scope behavior.
3. Run validation and archive the capability requirement.

## Risks

An incomplete ID set or a cache collision could present incorrect totals. Preserve the query engine's fail-closed limit and bypass the aggregate cache for the new filters.

## Progress

PR: #10533

### Phase 1 — Aggregate filter parity

- [x] 1.1 Share the scoped deal predicates and apply them to stage aggregation — e4fce7d303
- [x] 1.2 Add API parity coverage and focused coverage for cache and scope behavior — e4fce7d303
- [ ] 1.3 Run validation and archive the capability requirement
