# Customers CrudForm persistence coverage

Source doc: .ai/specs/2026-11-27-customers-crudform-persistence.md

## Goal

Verify that create and update preserve CRM form values for people, companies, and deals.

## Scope

Add three Playwright API round trips and shared test-local fixture support in the customers module. Use synthetic, per-test fixtures and the sweep's opt-out.

| Sweep row | Module | Coverage | Tracking |
| --- | --- | --- | --- |
| A4 | customers | Person, company, deal | [Issue #2556](https://github.com/open-mercato/open-mercato/issues/2556), [design PR #10930](https://github.com/open-mercato/open-mercato/pull/10930) |

The June sweep ledger was archived in #8652. This row tracks its customers entry for the replacement delivery.

## Implementation Plan

### Phase 1: Customer persistence coverage

1.1 Add fixture support and the person create and update round trip.

1.2 Add the company create and update round trip.

1.3 Add the deal create and update round trip.

1.4 Run the focused suite, verify the opt-out, and record validation results.

## Risks

Use detail reads for the persisted relationship and custom-field values. Delete the primary record before its configured options and related records.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Customer persistence coverage

- [ ] 1.1 Add fixture support and the person create and update round trip.
- [ ] 1.2 Add the company create and update round trip.
- [ ] 1.3 Add the deal create and update round trip.
- [ ] 1.4 Run the focused suite, verify the opt-out, and record validation results.
