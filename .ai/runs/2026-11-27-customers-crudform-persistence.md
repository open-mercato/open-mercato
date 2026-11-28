# Customers CrudForm persistence coverage

Source doc: .ai/specs/2026-11-27-customers-crudform-persistence.md

## Goal

Verify that create and update preserve CRM form values for people, companies, and deals.

## Scope

Add three Playwright API round trips and shared test-local fixture support in the customers module. Use synthetic, per-test fixtures and the sweep's opt-out.

| Sweep row | Module | Coverage | Tracking |
| --- | --- | --- | --- |
| A4 | customers | Person, company, deal | [Issue #2556](https://github.com/open-mercato/open-mercato/issues/2556), [design PR #10930](https://github.com/open-mercato/open-mercato/pull/10930), [implementation PR #10931](https://github.com/open-mercato/open-mercato/pull/10931) |

The June sweep ledger was archived in #8652. This row tracks its customers entry for the replacement delivery.

## Implementation Plan

### Phase 1: Customer persistence coverage

1.1 Add fixture support and the person create and update round trip.

1.2 Add the company create and update round trip.

1.3 Add the deal create and update round trip.

1.4 Run the focused suite, verify the opt-out, and record validation results.

## Risks

Use detail reads for the persisted relationship and custom-field values. Delete the primary record before its configured options and related records.

## Verification

- The managed app build and all three CRM persistence specs passed on the local runner with a disposable Postgres database.
- With `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED=1`, Playwright discovered and skipped all three specs.
- Package builds, generation, locale checks, and workspace typecheck passed. The shared harness unit suite passed all 21 tests.
- The configured full unit gate failed on the existing onboarding verification mock. The separate core run reproduced nine catalog price test failures. Both areas match the upstream base. [Upstream CI repair #10899](https://github.com/open-mercato/open-mercato/pull/10899)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Customer persistence coverage

- [x] 1.1 Add fixture support and the person create and update round trip. — c9f661d061
- [x] 1.2 Add the company create and update round trip. — c9f661d061
- [x] 1.3 Add the deal create and update round trip. — c9f661d061
- [x] 1.4 Run the focused suite, verify the opt-out, and record validation results. — c9f661d061
