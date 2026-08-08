# Global Search Linked-Result Deduplication

## TLDR

Global search can return both a canonical customer entity and its person or company profile, even though the profile presenter navigates to the canonical entity page and both entries have the same title. After request-time presenter enrichment, merge that linked profile hit into the matching navigation-less entity hit. Keep the canonical entity identity, copy the profile presenter and navigation, and leave distinct content results intact.

## Overview

Issue #5046 reports people and companies appearing multiple times in the global search dropdown. The token strategy can return `customers:customer_entity` because the query index contains its searchable fields. The customers search configuration also registers `customers:customer_person_profile` and `customers:customer_company_profile`, whose presenters resolve to the same person or company detail page.

The index rows are valid and remain useful to search and query-engine consumers. The defect is limited to presentation of multiple records that represent one navigable customer result.

## Problem Statement

The cross-strategy merger deduplicates by organization, entity type, and record ID. That correctly merges the same indexed record across fulltext, vector, and token strategies, but it cannot identify an entity/profile pair because those records have different entity types and IDs.

The request-time presenter enricher has the information needed to identify the pair:

- the base entity result has no navigation target;
- the profile result has the same presenter title;
- the profile's direct URL ends with the base entity's record ID;
- both results have the same organization scope.

Without a second presentation-level merge, the UI shows both entries and the base result can be non-interactive.

## Proposed Solution

After presenter and navigation enrichment:

1. Index results by organization scope and record ID.
2. Inspect only direct navigation URLs without query strings or page anchors.
3. When a linked result's URL ends with exactly one other navigation-less result's record ID, require the presenter titles to match.
4. Keep the base result's `entityId` and `recordId`, copy the linked result's presenter, URL, and links, and retain the higher score.
5. Remove only the linked duplicate.
6. Sort the reduced result list by score descending so the merged score and rendered position remain consistent.

This is deliberately stricter than title-based deduplication. Two different customers with the same display name remain separate because their record IDs and URLs differ.

## Architecture

The merge runs in `packages/search/src/lib/presenter-enricher.ts` after all configured presenters and navigation links have been recomputed for the request locale. It does not alter indexing, strategy queries, the RRF entity/record merge, or the public search contracts.

The existing presenter enricher is the correct boundary because it is the first stage where token-only base results and configured profile navigation are available together.

## Data Models

No database, index, or stored-document changes. No reindex is required.

## API Contracts

The `/api/search/search/global` response shape remains unchanged. A customer entity/profile pair now produces one result instead of two:

- canonical identity: the base entity's `entityId` and `recordId`;
- display and navigation: the linked profile presenter's values;
- score: the higher of the two pre-merge scores.

The response remains ordered by score descending after linked results are merged.

Other search endpoints using `SearchService` receive the same presentation-level behavior.

## Testing

- Presenter-enricher regression coverage for both person and company entity/profile pairs.
- Reverse-order regression coverage proving a higher-scoring profile moves the merged entity to the correct position.
- Route-level coverage proving the global search API returns one navigable result per customer.
- Integration coverage using created person and company records to verify real presenter titles collapse to one canonical result.
- Negative coverage proving anchored content results such as customer notes are not merged into the base entity.

Manual QA should search for a known person and company through Cmd+K and confirm each appears once and opens the expected v2 detail page.

## Risks & Impact Review

### Incorrectly merging different records with the same title

- Severity: medium.
- Mitigation: a title match alone is insufficient; organization scope and the terminal URL record ID must also identify exactly one navigation-less result.
- Residual risk: low.

### Hiding customer content hits

- Severity: medium.
- Mitigation: URLs with query strings or anchors are excluded, so notes and activity results targeting sections on the customer page remain distinct.
- Residual risk: low.

### Cross-organization merging

- Severity: high.
- Mitigation: candidate lookup includes `organizationId`; results from different organizations cannot be paired.
- Residual risk: low.

### Ranking changes

- Severity: low.
- Mitigation: the merged result keeps the higher existing score instead of summing both scores, avoiding an artificial relevance boost, and the reduced list is re-sorted so each result's position continues to reflect its score.
- Residual risk: low.

## Final Compliance Report

- No public type, function signature, API route, or response shape change.
- Tenant and organization scoping is preserved.
- No indexing, persistence, migration, or generated-file changes.
- Focused unit and route-level tests cover the positive and negative branches.
- Manual UI QA remains required because the visible global-search result list changes.

## Changelog

### 2026-08-07

- Preserved score-descending order after merging linked results.
- Added reverse-order and real customer integration coverage for the ranking and title-equality invariants.

### 2026-08-06

- Added strict post-enrichment merging for linked customer entity/profile search results.
- Added person, company, anchored-content, and global-route regression coverage.
