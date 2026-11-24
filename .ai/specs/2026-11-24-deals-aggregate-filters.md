# Deals aggregate filter parity

Extends: .ai/specs/implemented/2026-05-10-crm-list-filter-redesign.md

## 📝 TLDR

CRM integrations that share a filter bar between the deals list and a board need lane totals for the same deals. The aggregate endpoint will accept the list's advanced filter tree and `needsAttention` flag.

## 📝 Problem Statement

Issue #8385 reports that filtered cards and lane totals disagree because the aggregate route ignores the tree and attention flag. A client that sums its loaded cards can only report a lower bound when a lane is paginated.

## 📝 Proposed Solution

Accept the list's existing filter URL encoding and optional `needsAttention` boolean. Use the same deal predicate builder for both endpoints when either filter is active. Stage counts and amounts reflect all matching deals within the request's tenant and organization scope.

Twenty exposes record filters through its workspace API client. Reusing Open Mercato's existing filter vocabulary likewise lets consumers retain one filter state when they request deals and totals. [Twenty's typed workspace APIs](https://docs.twenty.com/developers/extend/apps/logic-functions)

## 📝 Delta

### Capability: deals-aggregate

#### ADDED Requirement: Filtered stage totals

The aggregate endpoint SHALL calculate stage counts and amounts using the deals list's advanced filter tree and attention flag, combined with supplied deal criteria.

##### Scenario: Nested filter and a pipeline

- WHEN the caller submits a v2 tree with nested groups and a pipeline ID
- THEN totals include every deal in that pipeline that matches the tree and is visible in the request scope

##### Scenario: Deals needing attention

- WHEN the caller passes `needsAttention=true`
- THEN the aggregate includes matching open deals that are overdue or stuck, using the list's attention predicate and its precedence over the individual overdue and stuck flags

##### Scenario: Filter selects no deals

- WHEN the filter excludes all visible deals
- THEN the response contains an empty `perStage` array

## 📝 Architecture

The Customers module owns the change. The aggregate route uses the list's query-parameter and predicate helpers. Resolve matching IDs through the scoped query engine when the request uses the new filters. Apply a parameterized ID restriction to the existing grouped SQL, alongside tenant, organization and soft-delete predicates. The grouped query keeps exact monetary sums and feeds the existing currency conversion. The shared attention lookup checks every organization covered by the request, including an all-organizations selection. Each organization uses its own stuck threshold.

The aggregate cache remains available to legacy requests. Requests carrying an advanced tree or active attention flag bypass it, since the current cache signature has no filter tree and the attention result can depend on elapsed time.

## 📝 Data Model

The implementation reads the existing deals, stage transitions and query indexes. It requires no migration.

## 📝 API Contracts

`GET /api/customers/deals/aggregate` accepts the optional boolean `needsAttention` and the list-compatible `filter[...]` encoding, including v2 trees and the list parser's accepted legacy form. The shared parser supplies the same validation and operator semantics as the list. The OpenAPI description documents the tree encoding and the schema describes the boolean.

The aggregate's existing flat-parameter validation applies when the new filters are combined with those parameters. A single UUID remains the accepted flat `pipelineId`. List pagination and sorting stay specific to the list.

The permission remains `customers.deals.view`. Existing flat query parameters and response fields remain supported. An omitted or false flag without a filter tree retains the existing aggregate path.

## 📝 Risks & Impact Review

| Risk | Impact | Mitigation |
| --- | --- | --- |
| An ignored or miscompiled predicate inflates lane totals | Medium, board totals | Reuse the list predicate builder and compare both API responses in integration tests |
| A legacy cached response is reused for a filtered request | Medium, board totals | Bypass the aggregate cache for the new filter paths |
| A broad tree resolves many IDs | Medium, request latency | Use the query engine's paged ID lookup and its existing fail-closed page bound. Pass the ID set as one bound value to the grouping query |
| A request references a deal outside its scope | High, tenant isolation | Scope both the ID lookup and the grouping query and keep the existing permission |

## Resolved assumptions (autonomous defaults)

The issue describes a shared filter bar in a consumer-owned board. Deliver the optional API inputs without changing the shipped board's controls.

## 📋 Implementation Plan

### Phase 1 — Support filters on the aggregate endpoint

1. Reuse the list's predicate construction for the aggregate ID lookup. Preserve legacy aggregation and ensure a zero-match filter returns empty stages.
2. Add a self-contained API integration test with fixture deals. Compare the deals list and aggregate results for a nested v2 tree, attention values, a combined request and a zero-match filter. Cover explicit false, cache isolation and tenant and organization predicates in focused aggregate tests.
3. Run the aggregate and list filter suites and the configured validation gate. Record the resulting requirement in `.ai/specs/capabilities/deals-aggregate.md`.

## Final Compliance Report

The change adds optional read parameters, uses existing scoped query and aggregation primitives, and needs no data migration. The acceptance coverage exercises both API paths.

## Changelog

- 2026-11-24 — Proposed filter parity for deals stage aggregation in #8385.
