# Custom Field Regex ReDoS Hardening

## Overview

Goal: prevent attacker-controlled custom-field values from blocking Open Mercato through catastrophic backtracking in administrator-configured regex validation rules.

Source: `~/Downloads/attack/` contains a PDF report and PoC script demonstrating a ReDoS against `PUT /api/customers/companies` through a custom field regex rule.

Affected modules/packages:
- `packages/shared`: shared custom-field validation schema and runtime evaluator.
- `packages/core`: consumers of server-side custom-field validation.
- `packages/ui`: consumers of client-side `CrudForm` custom-field validation.

Smallest safe scope:
- Replace native `RegExp` execution for custom-field regex rules with a linear-time regex engine.
- Cap regex validation input length so very large values fail closed before regex evaluation.
- Add focused tests for the reported pattern and oversized input behavior.

Non-goals:
- Do not change custom-field storage schema or API response contracts.
- Do not alter customers, sales, or other CRUD route behavior except through shared validation.
- Do not migrate existing tenant data or rewrite saved custom-field definitions.

## Implementation Plan

### Phase 1: Central Regex Hardening

1. Add a linear-time regex dependency to `@open-mercato/shared`.
2. Update `packages/shared/src/modules/entities/validation.ts` so custom-field regex rules compile and run through RE2JS rather than JavaScript `RegExp`.
3. Enforce a bounded regex input length and fail closed for unsupported or invalid regex patterns.
4. Keep the exported validation function signature unchanged.

### Phase 2: Regression Coverage

1. Extend shared custom-field validation tests to cover the reported VAT-style pattern and payload.
2. Add tests for unsupported regex syntax and oversized input failure.
3. Run focused shared package tests and typecheck.

### Phase 3: Verification And Review

1. Run the auto-create-pr full validation gate.
2. Perform code-review and backward-compatibility self-review.
3. Open the PR, normalize labels, run `auto-review-pr` in autofix mode, and post the required summary comment.

### Phase 4: Follow-up ReDoS Surface Plan

This phase is intentionally saved in this PR for a later `auto-continue-pr` run. It should continue after the custom-field fix lands on the branch.

Audit findings from `rg "new RegExp\\(|operator.*regex|rule.*regex"`:
- `packages/core/src/modules/business_rules/lib/expression-evaluator.ts`: high priority. Business rule `MATCHES` accepts rule-authored patterns and still executes native `RegExp` after heuristic checks. The post-execution timeout cannot prevent a blocking event-loop stall. Replace with the shared linear regex helper from Phase 1 and add a ReDoS regression for the reported `([0-9A-Za-z]+)*` pattern.
- `packages/core/src/modules/workflows/lib/event-trigger-service.ts`: medium priority. Workflow trigger regex filters already reject many unsafe constructs and cap input length, but still execute native `RegExp`. Migrate to the shared helper for consistency and keep the existing workflow-specific tests.
- `packages/shared/src/lib/events/patterns.ts`, `packages/shared/src/lib/crud/sync-event-runner.ts`, `packages/shared/src/modules/widgets/injection-loader.ts`, `packages/ui/src/backend/injection/useAppEvent.ts`: low priority. These convert wildcard identifiers to escaped regular expressions rather than executing arbitrary regex syntax. Replace with non-regex wildcard matching or add strict pattern length caps to reduce residual algorithmic DoS risk.
- `packages/cache/src/**/*.ts`: low priority. Cache key wildcard matching escapes regex syntax before converting `*`, but patterns may come from CLI/admin maintenance paths. Replace with shared wildcard matching or cap pattern/key length before matching large key sets.
- Test and integration helper regexes are out of production scope for this security fix unless they consume unescaped user strings in a way that destabilizes CI.

## Risks

- RE2-compatible regex syntax is intentionally narrower than JavaScript `RegExp`; unsupported regex validation rules will now fail closed instead of executing with a backtracking engine.
- Existing saved custom-field definitions with unsupported regex constructs may reject values until an administrator updates the pattern.
- RE2JS adds a browser-consumable dependency because `CrudForm` imports the shared validator for client-side validation.
- Phase 4 is implemented in this PR: the remaining production regex surfaces now use linear regex helpers or non-regex wildcard matching.
- Full validation now passes on this branch after merging the current `origin/develop`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

Current PR: https://github.com/open-mercato/open-mercato/pull/1996
Current status: ready for review.

### Phase 1: Central Regex Hardening

- [x] 1.1 Add RE2JS dependency to shared package — 0e3a6b745
- [x] 1.2 Replace custom-field RegExp execution with linear-time matching — 0e3a6b745
- [x] 1.3 Enforce fail-closed regex input and pattern handling — 0e3a6b745

### Phase 2: Regression Coverage

- [x] 2.1 Add regression tests for the reported ReDoS payload — 0e3a6b745
- [x] 2.2 Add tests for unsupported regex syntax and oversized input — 0e3a6b745
- [x] 2.3 Run focused shared validation checks — 0e3a6b745
- [x] 2.4 Stabilize timing-sensitive ReDoS regression assertion — a5d31041d
- [x] 2.5 Keep exported regex rule schema backward-compatible while enforcing runtime caps — 1c6190c5a

### Phase 3: Verification And Review

- [x] 3.1 Run full validation gate — d6612378a
- [x] 3.2 Complete code-review and BC self-review — d6612378a
- [x] 3.3 Open PR, label it, run auto-review-pr, and post summary — PR label/comment handoff completed; `auto-review-pr` was not run because this continuation was asked to make the PR ready for review, not to submit the review.

### Phase 4: Follow-up ReDoS Surface Plan

- [x] 4.1 Harden business_rules MATCHES with the shared linear regex helper — 9279e36e1
- [x] 4.2 Migrate workflow trigger regex filters to the shared linear regex helper — 9279e36e1
- [x] 4.3 Replace escaped wildcard RegExp matchers with non-regex matching or strict caps — 9279e36e1
- [x] 4.4 Add focused regression tests for each migrated regex surface — 9279e36e1

## Final Validation Notes

- `yarn build:packages` — PASS
- `yarn generate` — PASS (structural cache purge warning is non-fatal and unrelated to this change)
- `yarn build:packages` after generation — PASS
- `yarn i18n:check-sync` — PASS
- `yarn i18n:check-usage` — PASS after adding missing data sync translations; advisory unused-key output remains non-blocking
- `yarn typecheck` — PASS
- `yarn test --concurrency=3` — PASS
- `yarn build:app` — PASS
- `yarn template:sync` — PASS

## Self-review Notes

- Backward compatibility: no public function signatures, event IDs, widget spot IDs, API URLs, database schema, DI names, ACL feature IDs, or public import paths were removed or renamed.
- Security: the PR removes native `RegExp` execution from attacker-influenced custom-field validation, business-rule `MATCHES`, workflow regex filters, wildcard event/widget matching, and cache wildcard matching. Added diff grep confirms no new production `em.find(` / `em.findOne(` calls.
- Coverage: focused regression tests cover custom-field ReDoS payloads, unsupported regex syntax, oversized inputs, business-rule matching, workflow trigger matching, wildcard helpers, event/sync/widget matching, UI app-event matching, and cache wildcard behavior.
