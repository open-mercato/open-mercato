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
- [x] 2.2 Implement and test all four Sales document extension hosts for #7782. — 6d44a2d59; 17 focused UI tests passed with the real shared injection loader and full page mounts.
- [x] 2.3 Implement and test quote response enrichment for #7783. — 197cbd0da; 45 route/factory tests and 22 CLI activation tests passed. Explicit route options preserve generated activation provenance.
- [x] 2.4 Update existing specs and compatibility documentation. — 5990cf71c; documents actual host contracts, render-only semantics, quote activation and migration review.

### Phase 3: Verification and delivery

- [x] 3.1 Generate registries and run focused unit/integration/UI verification. — generation and focused suites passed; managed WMS API 1/1 and final native order/quote browser smoke 2/2 passed. UI regression: fe8ac421a.
- [x] 3.2 Run the ordered full validation gate and standalone harness coverage audit. — ordered local gate passed; audit report records deterministic 239-case validation and generated-fact evidence.
- [x] 3.3 Review, resolve actionable findings, and finalize the PR with evidence. — independent re-review clean after fixing the E2E fixture assumption; PR #7784 carries the review, verification and screenshot evidence. External approval, CI and manual QA remain merge gates.


## Verification evidence

- Local prepare chain: package build 39/39, generation, final package build 39/39 passed.
- i18n sync passed; usage audit exited zero with existing unused-key advisory output.
- Workspace typecheck: 39/39 passed.
- Full workspace tests: 48/48 tasks passed; existing conditional skips remain. Production application build passed.
- Focused tests: AI definitions 71; UI hosts/page 17; document routes/factory 45; CLI activations 22 passed.
- Docs production build, targeted ESLint, client-boundary check, template parity, and agent budget checks passed.
- Managed ephemeral WMS regression `TC-WMS-STOCK-COL-002`: 1 passed, zero skipped/flaky/unexpected; real quotes retain order-only WMS isolation.
- Standalone dry-run audit confirms both bound host patterns and exact order/quote activation provenance in CLI/create-app facts; 239-case deterministic evaluator and two fact/scaffold tests passed. No model/release certification is claimed.
- Managed browser smoke passed both order/quote cases; the final rerun also passed 2/2 with zero skipped/flaky/unexpected cases. Screenshot-readiness assertions wait for each fixture's actual item state and custom-data loading completion. Synthetic order/quote screenshots are attached to PR #7784 via a separate evidence branch.
- Independent implementation analysis was clean. Review caught an incorrect empty-order assumption in a later screenshot wait; fixed to expect the fixture's seed line, with no unresolved source-analysis findings.
- Review validation source: GitHub checks plus the already-completed local implementation gate. Pending checks were not replaced with redundant local reruns. GitHub disallows author self-approval, so the analysis verdict is recorded as COMMENT and the pipeline remains `review`.
- Delivery: all three issues are linked by closing references; implementation is complete. `needs-qa` remains without `qa-approved`, and no merge is performed.
