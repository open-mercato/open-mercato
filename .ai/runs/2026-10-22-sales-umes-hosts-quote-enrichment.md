# Sales UMES hosts, quote enrichment, and agent guidance

## Goal

Resolve #7781, #7782, and #7783. The user's reference to #77882 means #7782: implement all four advertised stage-bar/closure hosts rather than removing or disabling their documentation.

## Scope

- Correct Customers/Catalog agent mutation-policy guidance without runtime policy changes.
- Bind order/quote stage-bar and closure injection hosts to the Sales document detail page, publish their real contracts, and test widget rendering.
- Enable quote-header response enrichment through the existing entity-targeted CRUD runner, preserving order/WMS isolation.
- Update existing specifications, upgrade notes, and generated discovery through the generator. Audit standalone harness coverage against the committed change range.

## Implementation plan

1. Confirm installed contracts and existing specs. Define additive UI context/data and read-only host behavior; preserve native stage/status mutations and document lifecycle.
2. Implement the three scoped repairs with focused regression and integration coverage. Each executor owns separate files; the coordinator owns specifications and validation.
3. Run generator, focused tests, relevant integration/UI checks, the ordered configured validation gate, and a standalone harness refresh audit. Review the final PR and report precise remaining limitations.

## Source documents

- `.ai/specs/2026-04-06-crm-detail-pages-ux-enhancements.md`
- `.ai/specs/implemented/SPEC-041d-response-enrichers.md`
- `.ai/specs/2026-08-01-module-extension-point-catalog.md`
- `.ai/specs/implemented/2026-04-11-unified-ai-tooling-and-subagents.md`
- `BACKWARD_COMPATIBILITY.md`

## Compatibility and decisions

- User authorization explicitly covers adding the advertised hosts and enabling quote enrichment; no rename/removal of existing contracts is intended.
- Empty hosts add no placeholder UI and must not change status/closure semantics or bypass guarded mutations.
- Quote enrichers are selected by `sales:sales_quote`; order-only enrichers remain isolated. Wildcard contributions and cached responses require regression coverage.
- No database schema changes, new production dependencies, migrations, or unrelated module fixes.
- Runner: local (compose probe found no running app container).
- The user workspace has an unrelated untracked local file; all work happens in an isolated worktree.

## Risks

- Advertised host IDs have no previous mounted context. Document a narrow additive contract and preserve all existing tabs/details/shipping spots.
- Quote enrichment intentionally activates matching registered contributions. Preserve scoping, feature gates, fallback, response shape, and list/detail cache semantics.
- Full validation and standalone certification may encounter pre-existing environment or containment limitations; report actual outcomes without claiming unavailable checks passed.

## Progress

PR: #7784

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Contracts and preparation

- [x] 1.1 Confirm current defects, additive contracts, source specs, and test runner. — e5fcb3e14

### Phase 2: Implementation

- [x] 2.1 Correct Customers and Catalog agent guidance for #7781. — 251a9a14c; 71 focused tests and instruction budget passed.
- [ ] 2.2 Implement and test all four Sales document extension hosts for #7782.
- [ ] 2.3 Implement and test quote response enrichment for #7783.
- [ ] 2.4 Update existing specs and compatibility documentation.

### Phase 3: Verification and delivery

- [ ] 3.1 Generate registries and run focused unit/integration/UI verification.
- [ ] 3.2 Run the ordered full validation gate and standalone harness coverage audit.
- [ ] 3.3 Review, resolve actionable findings, and finalize the PR with evidence.
