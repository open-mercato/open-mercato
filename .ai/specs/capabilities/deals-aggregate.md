# Capability: deals-aggregate

CRM integrations use the deals aggregate API to display stage totals for the complete set of visible matching deals.

## Requirement: Filtered stage totals

The aggregate endpoint SHALL calculate stage counts and amounts using the deals list's advanced filter tree and attention flag, combined with supplied deal criteria.

### Scenario: Nested filter and a pipeline

- WHEN the caller submits a v2 tree with nested groups and a pipeline ID
- THEN totals include every deal in that pipeline that matches the tree and is visible in the request scope

### Scenario: Deals needing attention

- WHEN the caller passes `needsAttention=true`
- THEN the aggregate includes matching open deals that are overdue or stuck, using the list's attention predicate and its precedence over the individual overdue and stuck flags

### Scenario: Filter selects no deals

- WHEN the filter excludes all visible deals
- THEN the response contains an empty `perStage` array

Source: .ai/specs/2026-11-24-deals-aggregate-filters.md
