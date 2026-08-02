# Sync and File Branches

Load for `DataSyncAdapter`, imports, or exports.

1. Stream pages/rows with bounded memory. Validate mappings, formats, encoding, locale, decimals, dates, and maximum sizes.
2. Isolate item errors and report them without stopping safe siblings; define batch-atomic versus item-atomic semantics.
3. Save external ID mappings and cursor only after the durable batch commits. A transient page failure leaves the previous cursor intact.
4. Prevent overlapping scoped runs or define safe concurrency. Support cancellation, retry, resume, progress, and final reconciliation.
5. Neutralize spreadsheet formulas, reject archive/path traversal, and clean temporary files in `finally`/retention while preserving declared artifacts.
6. Test first run, rerun, partial error, duplicate item, page failure, retry/resume, cancellation, and provider variant.

Use mocked contract endpoints unless the user explicitly supplies and approves live test credentials.
