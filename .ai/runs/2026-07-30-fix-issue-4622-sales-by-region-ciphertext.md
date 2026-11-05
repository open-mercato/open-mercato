# Fix #4622 — salesByRegion renders ciphertext when the shipping address is encrypted

Issue: https://github.com/open-mercato/open-mercato/issues/4622
Branch: `fix/issue-4622-sales-by-region-ciphertext`

## Root cause

`WidgetDataService.executeQuery` delegates every grouped widget query to
`buildAggregationQuery`, which emits a SQL `GROUP BY` over a JSONB path expression
(`shipping_address_snapshot->>'region'`). Neither builder knows anything about tenant data
encryption.

With `TENANT_DATA_ENCRYPTION=yes`, `TenantEncryptionSubscriber` encrypts the whole
`shipping_address_snapshot` value (`packages/core/src/modules/sales/encryption.ts` lists the
column in `defaultEncryptionMaps`), so the column stores an AES-GCM payload
(`<iv>:<ct>:<tag>:v1`) instead of an address object. Grouping over it in SQL therefore returns
ciphertext-derived keys — which travel straight into the chart legend and into
`resolveGroupLabels`, whose no-resolver branch stringifies the group key verbatim.

Only *labels* for FK group keys ever get decrypted (`resolveGroupLabels` → `labelResolvers`);
the group **key** never does. That is the asymmetry the issue reports against `topCustomers`.

The same exposure exists for every analytics groupBy over an encrypted column, not only
`salesByRegion` (e.g. `sales:quotes` `shippingAddressSnapshot` / `customerSnapshot`).

## Approach

Decrypt before grouping, as the issue's first expected option asks:

1. `lib/aggregations.ts` — factor the scope/date/filter clause building out of
   `buildAggregationQuery` and add `buildGroupSourceRowsQuery`, which selects the raw group
   source column plus the metric column per row (same WHERE, bounded by a row cap).
2. `services/widgetDataService.ts` — when the groupBy field resolves to a column that is
   encrypted for the entity/tenant, take a row-level path: fetch rows, decrypt the column via
   `TenantDataEncryptionService`, extract the JSONB path from the decrypted object, then
   aggregate/sort/limit in JS. Rows that cannot be decrypted collapse into the `null`
   ("Unknown") bucket — ciphertext is never emitted.
3. Fail loudly rather than silently truncate: exceeding the scan cap throws
   `WidgetDataScanLimitError` so the widget shows its error state instead of a wrong chart.
4. Defense in depth: `resolveGroupLabels` never uses a ciphertext-shaped key as a label.

## Review round 2 (2026-07-31)

Follow-up to the `changes-requested` review on PR #4690:

1. **Fail closed instead of fail open.** `resolveEncryptedGroupSource` no longer keys off
   `TenantDataEncryptionService.isEnabled()`, which folds the environment toggle together with KMS
   health and therefore reports "nothing is encrypted" whenever the KMS is down. The toggle alone
   decides whether encryption is configured (fail-open is correct there); when it is configured, the
   encryption **map** — an on-disk fact, read through the new `ignoreRuntimeHealth` option — decides
   whether the column holds ciphertext. An unreadable map, a missing encryption service, or a
   missing tenant DEK with ciphertext rows now raises `WidgetDataEncryptionUnavailableError`
   (HTTP 503, per-request error in the batch route) instead of falling back to the SQL path.
2. **Exact money.** Application-side aggregation folds `numeric` values through
   `lib/exactDecimal.ts` (scaled-`bigint` accumulator) and converts once at the response boundary,
   so `0.10 + 0.20` returns `0.3` like the SQL path rather than `0.30000000000000004`.
   `SUM`/`AVG`/`MIN`/`MAX` over an empty value set now return `null`, matching PostgreSQL.
3. **Integration coverage.** `__integration__/TC-DASH-009-encrypted-group-source.spec.ts` drives the
   real boundary — encrypting subscriber → tenant DEK → encrypted JSONB → single and batch routes —
   with self-created orders and organizations, asserting plaintext buckets, exact totals,
   organization scoping and the absence of ciphertext, and cleaning up in `finally`.
4. **Typed call sites.** The `resolveTenantEncryptionService(this.em as any)` casts are gone.
5. **Explicit NULL ordering.** Both paths state `value DESC NULLS LAST` (PostgreSQL defaults DESC to
   NULLS FIRST), so a group limit keeps the highest-value buckets in either path.
6. **Streaming min/max.** Buckets fold values as they are scanned, so no `Math.min(...rows)` spread
   over a 20,000-element array.

## Progress

- [x] Root-cause analysis
- [x] `lib/aggregations.ts` — shared clause builder + `buildGroupSourceRowsQuery`
- [x] `services/widgetDataService.ts` — encrypted groupBy path
- [x] Regression tests (aggregations + widgetDataService)
- [x] Validation gate
- [x] PR opened
- [x] Review round 2 — fail-closed encryption detection, exact decimal aggregation, integration spec
