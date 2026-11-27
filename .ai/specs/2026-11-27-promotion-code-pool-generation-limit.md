# Promotion code pool limit and batched generation

Issue: [#10699](https://github.com/open-mercato/open-mercato/issues/10699)<br>
Review follow-up: [PR #10790](https://github.com/open-mercato/open-mercato/pull/10790)

## Behavior

- Dynamic pools accept at most 100,000 codes.
- A worker transaction generates at most 500 codes, reconciles the persisted count,
  commits, and clears the EntityManager before beginning another batch.
- Any committed batch invalidates the promotions-code cache even if a later batch
  fails. A retry recounts persisted generated codes and continues without duplication.
- Existing pools above the limit are left intact but are not topped up. Jobs for them
  are skipped until an operator reduces the target amount.

## Migration & Backward Compatibility

This narrows a stable create/update API input and declines legacy queued work for
oversized pools. Preserving unbounded input and generation would retain the resource
exhaustion risk; there is no bridge that accepts larger pools or lets their jobs
continue. This is the Emergency Security Exception recorded in
`BACKWARD_COMPATIBILITY.md`.

Operators should lower an existing dynamic pool's target to 100,000 or less through
the promotion-code editor/API, then trigger `POST /api/promotions/codes/{id}/generate`.
The worker recounts existing generated codes and fills only the remaining quantity.
Already generated codes remain redeemable. To meet a campaign requirement above the
per-pool limit, divide inventory among multiple pools capped at 100,000 each. No data
or schema migration is required. These steps are documented in `UPGRADE_NOTES.md`.

Named human maintainer acknowledgement for the exception is required before merge and
is pending; automated review does not satisfy this requirement.

## Regression coverage

- A failed later batch still invalidates the cache after earlier batches committed.
- Oversized legacy pools are skipped without generating additional codes.
- Validator, worker, and API coverage enforce the 100,000-code maximum and 500-code
  transaction batches.
