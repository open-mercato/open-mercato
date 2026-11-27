# Customers CrudForm persistence coverage

## TLDR

Add Playwright round-trip tests for the customer forms used to create and edit people, companies, and deals. Each test will exercise the write API used by the form and verify saved values through a separate read.

## Problem Statement

The field-persistence sweep has no shared-harness coverage for customer records on `main`. The earlier customer coverage PR closed before merge. [Issue #2556](https://github.com/open-mercato/open-mercato/issues/2556), [prior PR #2638](https://github.com/open-mercato/open-mercato/pull/2638)

## Proposed Solution

Use the existing `runCrudFormRoundTrip` harness for writes and assertions. Each Playwright spec creates its own dictionary entries, custom-field definitions, and linked records as needed, then cleans up in reverse dependency order. The sweep uses its existing opt-out flag and runs by default. [Sweep conventions](../qa/AGENTS.md#crudform-field-persistence-sweep-2466)

## Architecture

The tests live in the `customers` module under `__integration__`. Use authenticated API requests with synthetic values and existing fixture helpers. A small test-local helper can manage fixtures shared across the three specs. Use scoped detail responses and check the returned record ID. The detail responses include tag and relationship arrays and read custom-field values independently of the list projection.

## Data Model

The specs create ordinary customers, deals, tags, dictionary entries, custom-field definitions, and pipeline records as fixtures within the current schema. Give fixtures unique keys so parallel tests and retries cannot address one another's data.

## API Contracts and Coverage

Each spec exercises the collection's POST and PUT and verifies saved values with detail GET requests after both writes. DELETE cleans up the record after the assertions. The coverage uses form-shaped requests and complements the existing browser coverage of the canonical create hosts. Embedded addresses save through the separate customer-address API and have their own integration scenarios.

| Spec | Write API | Read-back assertions |
|---|---|---|
| `TC-CRM-CRUDFORM-001` | `/api/customers/people` | Name, description, email, phone, job title, department, seniority, time zone, preferred name, social URLs, company link, status, lifecycle stage, source, tags, and text and select custom fields |
| `TC-CRM-CRUDFORM-002` | `/api/customers/companies` | Display, legal, and brand names, description, email, phone, domain, website, industry, size, annual revenue, tax ID, status, lifecycle stage, source, tags, and textarea and boolean custom fields |
| `TC-CRM-CRUDFORM-003` | `/api/customers/deals` | Title, description, status, source, owner, amount, currency, probability, close date, pipeline and stage, people, companies, and number and multi-select custom fields |

Change the company link and selected tags in the person test. Remove a tag and toggle the custom boolean from true to false in the company test. Change the deal's pipeline, stage, linked records, and custom multi-select and clear its owner. Assert that omitted fields such as the person's department, the company's legal name, and the deal's description retain their values after the partial updates. Compare relationship and multi-select values as sets.

## Risks & Impact Review

- Concurrent indexing can make immediate list reads stale. Prefer scoped detail reads for fields that use delayed projections.
- A failed write or assertion can leave dependent records behind. Acquire fixtures within a `try` block, retain their cleanup handles at creation, and delete the main customer record before its dependencies.
- Historical ticket references point to `develop` and an archived sweep ledger. Use the configured `main` base with the shared harness already present. Record the replacement PR in the current run and issue so tracking follows the new delivery.

## Final Compliance Report

The work exercises existing authenticated routes under the test tenant. Its changes are confined to tests and their tracking documents. Validate discovery, the sweep opt-out, and the focused managed integration run.

## Changelog

- 2026-11-27 — Document the three customer persistence tests and fixture requirements for #2556.
- 2026-11-27 — Record the verified update assertions and deal ownership coverage. [Implementation PR #10931](https://github.com/open-mercato/open-mercato/pull/10931)

## Implementation Plan

### Phase 1 — Customer persistence coverage

1.1 Add test-local fixture support and the person create and update round trip.

1.2 Add the company create and update round trip.

1.3 Add the deal create and update round trip.

1.4 Run the focused suite, verify the opt-out, and record results in the implementation plan.
