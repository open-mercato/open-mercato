# Terminal Deal outcome without a supplier decision

## Problem and decision

`closureOutcome` has a binary `won | lost | null` contract. A completed buying process in
which no supplier was chosen is neither won nor lost. `status = no_decision` is therefore
a terminal Deal status while `closureOutcome` stays null. Silence alone does not establish
that a buying process has ended.

`updatedAt` is not a close date: editing a closed Deal moves it to a new reporting period.
New terminal transitions persist `closedAt` in the same command write as the status.
Reopening clears it; retries and ordinary closed-Deal edits preserve it. Historical rows
without a reliable timestamp remain null. `preCloseStatus` preserves the active status for
reopening a No decision Deal without guessing.

## Surfaces

- The Deal entity adds nullable `closed_at` and `pre_close_status` columns. The migration
  does not backfill dates or reclassify existing Deals.
- Status classification treats `no_decision` as terminal; Won/Lost classification remains
  unchanged. Active metrics and the pipeline summary exclude it.
- The Deal detail UI offers a confirmed No decision action and a reopen action. The
  pipeline stage is not changed by No decision: it records where the process ended.
- Deal list/detail responses and analytics expose the actual `closedAt`. The list accepts
  `closedAtFrom`/`closedAtTo` and can sort by `closedAt`.
- Closed-period statistics use `closed_at`, not `updated_at`; rows with unknown historical
  dates are excluded from period denominators until a reliable date is supplied.

## Migration & Backward Compatibility

The schema migration is additive, nullable, and leaves legacy records untouched. Existing
`closureOutcome` values and status aliases remain accepted. API response fields are
additive, as are date filters. The stats endpoint retains its legacy string `closedAt`
field for existing clients and adds nullable `actualClosedAt`; new consumers must use the
latter. It may be null for a historical Deal. The legacy field is deprecated because it
is derived from `updatedAt` and can move after an edit. For `no_decision`, the endpoint
returns null `closureOutcome`, which is a new case of a closed Deal, not a reinterpretation
of an existing Won or Lost response.

This status is initially a built-in canonical value in the dictionary; future tenant
vocabulary configuration must preserve its terminal classification. Deployment requires
the new migration before any writer uses the new columns. Existing apps pinned to an older
Open Mercato release do not gain this behavior until they update their dependency.
The tenant-scoped status-semantics setting requested in #5546 is still open; this change
does not provide a general way to classify arbitrary tenant-created statuses as terminal.

## Verification

Test close, retry, unrelated edit, reopen, Won/Lost compatibility, null historical date,
active metrics, and Deal detail rendering. Do not infer production behavior from a local
checkout; verify the deployed package version before ERP rollout.
