# Payment transaction sorting

Status: Proposed
Tracking issue: #7788

## TLDR
Payment operators cannot sort the Payment Transactions list to locate recently changed payments or group them by status, amount or provider. Add server-side sorting through the existing DataTable and transactions API. Preserve the default newest-created order for existing callers.

## Problem Statement
Issue #7788 reports noninteractive headers at `/backend/payment-gateways`. The list route unconditionally orders by `createdAt desc, id desc`; the page supplies no sorting props. Sorting only the visible page would mislead operators about the rest of the results.

## Resolved assumptions (autonomous defaults)

| Question | Default | Reason |
| --- | --- | --- |
| Convert currencies for Amount sorting? | Compare stored numeric face values; show each existing currency. | Conversion would introduce exchange-rate policy beyond list sorting. |
| Persist after leaving the page? | Keep the selected order through paging, search and filters while mounted; existing perspective behavior remains available. | The ticket requests continuity within the list, not a new URL/storage contract. |
| Multi-column sorting? | Apply one chosen field, with UUID as deterministic tie breaker. | Matches existing server-paged lists without a larger query contract. |

No unresolved questions or changes to monetary calculations.

## Proposed Solution
Add optional `sortField` and `sortDir` query parameters. Allow `createdAt`, `updatedAt`, `unifiedStatus`, `amount`, and `providerKey`; direction is `asc` or `desc`. Default to `createdAt` / `desc`. Validate before accessing the database and build ordering only from these enum values, never raw SQL supplied by the caller. Append `id` in the same direction to make equal values deterministic across offset pages.

Use existing DataTable controlled `sorting`, `onSortingChange`, `sortable` and `manualSorting`. Enable sorting on Provider, Status, Amount and Updated only. Sort changes reset the page to 1; subsequent pagination, search and provider/status filter requests retain the selection. Clearing sorting restores the API's existing default.

## Architecture and Data Model
Only the `payment_gateways` module changes. Reuse the existing query builder, scope predicates, shared DataTable, translated headers, and `apiCall`. Amount is already a database decimal, so SQL sorting compares numbers rather than formatted currency strings. No entities, migrations, writes, dependencies or permission changes are needed.

The design follows [TanStack's server-side sorting guidance](https://tanstack.com/table/v8/docs/guide/sorting): server-paged data must be sorted before pagination, with manual sorting preventing a second client-only reordering.

## API Contracts
`GET /api/payment_gateways/transactions?sortField=amount&sortDir=asc&page=1&pageSize=20`

The response shape is unchanged. Existing callers without sort parameters retain identical order. Unsupported fields or directions return the existing invalid-query 400 before container resolution. Tenant, organization, soft-delete, search, provider and status predicates remain applied before ordering, count and pagination. Authentication and `payment_gateways.view` remain mandatory.

## UI/UX
The four existing translated headers become keyboard-accessible DataTable sort controls with shared direction indicators. The initial list stays newest-created. Users can switch direction and sort fields without changing status/provider selections. Existing loading, empty, error and detail-panel behavior remain in place. At narrow widths the existing table scroll container continues to own overflow; no new controls or styles are introduced.

## Edge Cases & Failure Scenarios
- Duplicate sort values use UUID ordering; a static dataset must not skip or duplicate records across pages.
- Amounts such as 2, 10 and 100 sort numerically. Mixed-currency amounts are face values, with existing currencies visible.
- Invalid parameters return 400 and cannot select arbitrary database columns.
- Foreign tenant/organization and deleted rows remain excluded under every ordering.
- A sort or filter change resets pagination, while page changes retain sorting.
- A failed list request retains the existing error surface and must not pretend to have sorted successfully.

## Migration & Backward Compatibility
This is an additive query contract. Defaults, response fields, route path, feature IDs and schema remain unchanged. No migration or deprecation is required. Rollback removes the optional sorting behavior without changing stored data.

## Risks & Impact Review
Sorting large datasets may cost more than creation-order queries; keep the existing page-size cap and avoid speculative indexes without measured need. Amount sorting does not imply a common-currency valuation. Shared DataTable behavior must be exercised in-browser in addition to mocked page tests.

## Phasing
One bounded feature: transaction-list sorting. No independently deployable ancillary capability is included.

## Implementation Plan
1. Add validated sort parameters and server ordering, with unit tests for all fields/directions, invalid inputs, default order and scope preservation.
2. Wire the four existing headers to controlled server sorting; test request continuity after sort, pagination and filters, and default restoration.
3. Ship self-contained integration coverage: PostgreSQL numeric/tie order and tenant isolation; real page clicks in English and Polish, pagination/filter retention, and cleanup. Run generation, configured validation and design review.

## Integration Coverage
- Existing list API: numeric ascending/descending, provider/status/updated ordering, deterministic paging and legacy default; invalid sort input; foreign tenant/org exclusion.
- `/backend/payment-gateways`: click header and reverse direction, change page and filter while retaining sort, inspect requested query and displayed owned rows; EN/PL and narrow/desktop layouts.
- Fixtures own their records and clean up in `finally`; no demo transaction dependency.

## Review
Scope cohesion and compatibility reviewed against the code and repository rules. The two-subtask limit was consumed by prior issue triage, so a fresh-agent scope review is unavailable and is not claimed. Implementation must preserve every default and scoping predicate above.

## Changelog
- 2026-11-14: Initial autonomous design for #7788; assumptions resolved above.
